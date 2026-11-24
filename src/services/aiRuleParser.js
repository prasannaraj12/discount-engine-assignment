/**
 * aiRuleParser.js — browser client for POST /api/parse-rule.
 * Never talks to an LLM provider directly and never holds an API key.
 */

const TIMEOUT_MS = 30000

export async function requestRuleParse(text, context, { fetchImpl = fetch } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetchImpl('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context }),
      signal: controller.signal,
    })
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? 'The AI parser took too long to respond. Please try again.'
        : 'Could not reach the AI parser. Check your connection and try again.'
    return { ok: false, code: 'network_error', message }
  } finally {
    clearTimeout(timer)
  }

  let payload = null
  try {
    payload = await res.json()
  } catch {
    return { ok: false, code: 'bad_response', message: `The AI parser returned an unreadable response (HTTP ${res.status}).` }
  }
  if (!res.ok) {
    return { ok: false, code: payload?.error ?? 'error', message: payload?.message ?? `Request failed (HTTP ${res.status}).` }
  }
  if (!payload?.result) {
    return { ok: false, code: 'bad_response', message: 'The AI parser returned an empty response.' }
  }
  return { ok: true, result: payload.result, model: payload.model }
}
