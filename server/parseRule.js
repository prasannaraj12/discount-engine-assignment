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
import { ProviderError } from './llm/errors.js'
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './llm/anthropicProvider.js'
import { createGroqProvider, DEFAULT_GROQ_MODEL } from './llm/groqProvider.js'

export const MAX_TEXT_LENGTH = 500

/**
 * Provider selection is explicit: LLM_PROVIDER=groq | anthropic.
 * Unset means "anthropic" (the original behaviour). The app never switches
 * provider on its own because a different key happens to exist, and never
 * falls back to another provider when the selected one fails.
 *
 *   groq:      GROQ_API_KEY (required), GROQ_MODEL (default openai/gpt-oss-120b)
 *   anthropic: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL, or legacy LLM_MODEL
 */
export function resolveProviderConfig(env = process.env) {
  const name = String(env.LLM_PROVIDER ?? '').trim().toLowerCase() || 'anthropic'
  if (name === 'groq') {
    return {
      name,
      keyVar: 'GROQ_API_KEY',
      apiKey: env.GROQ_API_KEY || null,
      model: String(env.GROQ_MODEL ?? '').trim() || DEFAULT_GROQ_MODEL,
    }
  }
  if (name === 'anthropic') {
    return {
      name,
      keyVar: 'ANTHROPIC_API_KEY',
      apiKey: env.ANTHROPIC_API_KEY || null,
      model: String(env.ANTHROPIC_MODEL ?? '').trim() || String(env.LLM_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL,
    }
  }
  return { name, keyVar: null, apiKey: null, model: null, unknown: true }
}

/** Human-readable reason the parser can't run, or null. Never includes key values. */
export function providerConfigProblem(env = process.env) {
  const cfg = resolveProviderConfig(env)
  if (cfg.unknown) return `LLM_PROVIDER "${cfg.name}" is not supported; use "groq" or "anthropic"`
  if (!cfg.apiKey) return `${cfg.keyVar} is missing for LLM_PROVIDER=${cfg.name}`
  return null
}

export function createProvider(env = process.env) {
  const cfg = resolveProviderConfig(env)
  if (cfg.unknown || !cfg.apiKey) return null
  if (cfg.name === 'groq') return createGroqProvider({ apiKey: cfg.apiKey, model: cfg.model })
  return createAnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model })
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

export async function handleParseRule(body, { provider, configProblem = null, ip = 'unknown' } = {}) {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text.length < 3) return fail(400, 'empty_input', 'Please describe the discount rule.')
  if (text.length > MAX_TEXT_LENGTH) {
    return fail(400, 'input_too_long', `Please keep the description under ${MAX_TEXT_LENGTH} characters.`)
  }
  if (!provider) {
    return fail(503, 'not_configured', `The AI rule parser is not configured on this server${configProblem ? `: ${configProblem}` : ''}.`)
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
