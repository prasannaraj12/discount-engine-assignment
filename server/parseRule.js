/**
 * Framework-agnostic handler for POST /api/parse-rule.
 * Used by the Vercel function (api/parse-rule.js) and the Vite dev server.
 *
 *   { text, context: { brands[], platforms[] } } → { result: LlmRuleOutput, model }
 *
 * The API key stays on the server. The model's output is re-validated here
 * even though structured outputs were requested — it is never trusted blindly.
 */
import { llmRuleSchema } from './llm/ruleOutputSchema.js'
import { createAnthropicProvider, ProviderError } from './llm/anthropicProvider.js'

export const MAX_TEXT_LENGTH = 500

export function createProvider(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null
  return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL || undefined })
}

function cleanList(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((s) => typeof s === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 50)
}

// Best-effort per-instance limiter: keeps a public demo from being used as a free LLM proxy.
const hits = new Map()
export function isRateLimited(ip, { limit = 20, windowMs = 60_000, now = Date.now() } = {}) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > limit
}

const fail = (status, code, message) => ({ status, body: { error: code, message } })

export async function handleParseRule(body, { provider, ip = 'unknown' } = {}) {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text.length < 3) return fail(400, 'empty_input', 'Please describe the discount rule.')
  if (text.length > MAX_TEXT_LENGTH) {
    return fail(400, 'input_too_long', `Please keep the description under ${MAX_TEXT_LENGTH} characters.`)
  }
  if (!provider) {
    return fail(503, 'not_configured', 'The AI rule parser is not configured on this server (ANTHROPIC_API_KEY is missing).')
  }
  if (isRateLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.')

  const context = { brands: cleanList(body?.context?.brands), platforms: cleanList(body?.context?.platforms) }

  let raw
  try {
    raw = await provider.parseRule(text, context)
  } catch (err) {
    if (err instanceof ProviderError) return fail(err.httpStatus, err.code, err.message)
    return fail(502, 'provider_error', 'The AI service failed unexpectedly.')
  }

  const checked = llmRuleSchema.safeParse(raw)
  if (!checked.success) {
    return fail(502, 'invalid_model_output', 'The AI returned a rule in an unexpected format. Please try rephrasing.')
  }
  const result = checked.data
  if (result.status === 'ok' && !result.rule) {
    return fail(502, 'invalid_model_output', 'The AI said it understood the rule but returned no rule.')
  }
  return { status: 200, body: { result, model: provider.model } }
}
