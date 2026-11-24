/**
 * Groq implementation of the rule-parser provider interface:
 *
 *   provider.parseRule(text, context) → Promise<unknown>   (raw parsed JSON)
 *
 * Uses Groq's OpenAI-compatible Chat Completions endpoint with Node's built-in
 * fetch (no SDK dependency). Exactly ONE HTTP request per parse — no retries.
 *
 * Output mode by model (https://console.groq.com/docs/structured-outputs):
 *   - models that support strict structured outputs → response_format json_schema, strict: true
 *     (constrained decoding: the reply is guaranteed to match the schema)
 *   - any other model → response_format json_object, with the schema in the prompt
 *     (valid JSON only; server-side Zod validation still decides)
 * Either way, handleParseRule() re-validates the result with Zod.
 */
import { ProviderError } from './errors.js'
import { llmRuleSchema } from './ruleOutputSchema.js'
import { toProviderJsonSchema } from './jsonSchema.js'
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js'

export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

/** Models Groq documents as supporting strict: true (gpt-oss are production; the others are preview). */
export const GROQ_STRICT_MODELS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'meta-models/muse-spark-open'])

const RULE_JSON_SCHEMA = toProviderJsonSchema(llmRuleSchema)

export function supportsStrictSchema(model) {
  return GROQ_STRICT_MODELS.has(model)
}

/** The exact request body sent to Groq (exported for offline tests). */
export function buildGroqRequest(model, text, context) {
  const strict = supportsStrictSchema(model)
  const system = strict
    ? SYSTEM_PROMPT
    : `${SYSTEM_PROMPT}\n\nRespond with a single JSON object that matches this JSON Schema exactly, and nothing else:\n${JSON.stringify(RULE_JSON_SCHEMA)}`
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserMessage(text, context) },
    ],
    temperature: 0,
    max_completion_tokens: 2000,
    stream: false,
    response_format: strict
      ? { type: 'json_schema', json_schema: { name: 'discount_rule', strict: true, schema: RULE_JSON_SCHEMA } }
      : { type: 'json_object' },
  }
}

async function readErrorMessage(res) {
  try {
    const body = await res.json()
    return typeof body?.error?.message === 'string' ? body.error.message : ''
  } catch {
    return ''
  }
}

/** Maps a non-2xx Groq response to a ProviderError. Never echoes the raw provider message. */
async function toProviderError(res) {
  const status = res.status
  if (status === 401 || status === 403) {
    return new ProviderError('provider_auth', 'The AI service rejected the server credentials (check GROQ_API_KEY).', 502)
  }
  if (status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Please try again in ${Math.ceil(retryAfter)} s.` : ' Please try again in a moment.'
    return new ProviderError('provider_rate_limited', `The AI service is busy (rate limit reached).${wait}`, 429)
  }
  if (status === 404) {
    return new ProviderError('provider_config', 'The AI model was not found. Check GROQ_MODEL.', 502)
  }
  if (status === 400) {
    const msg = await readErrorMessage(res)
    if (/does not match the expected schema|json_validate|failed to generate json/i.test(msg)) {
      return new ProviderError('invalid_model_output', 'The AI returned a rule in an unexpected format. Please try rephrasing.', 502)
    }
    return new ProviderError('provider_bad_request', 'The AI service rejected the request. Check GROQ_MODEL supports JSON output.', 502)
  }
  if (status === 413) return new ProviderError('provider_bad_request', 'The request was too large for the AI service.', 502)
  if (status === 422) return new ProviderError('invalid_model_output', 'The AI could not produce a valid rule. Please try rephrasing.', 502)
  if (status === 498 || status >= 500) {
    return new ProviderError('provider_unreachable', 'The AI service is temporarily unavailable. Please try again.', 503)
  }
  return new ProviderError('provider_error', `The AI service returned an error (${status}).`, 502)
}

export function createGroqProvider({ apiKey, model = DEFAULT_GROQ_MODEL, timeoutMs = 25000, fetchImpl = globalThis.fetch }) {
  return {
    name: 'groq',
    model,
    async parseRule(text, context) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetchImpl(GROQ_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildGroqRequest(model, text, context)),
          signal: controller.signal,
        })
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new ProviderError('provider_unreachable', 'The AI service took too long to respond. Please try again.', 503)
        }
        throw new ProviderError('provider_unreachable', 'Could not reach the AI service. Please try again.', 503)
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) throw await toProviderError(res)

      let data
      try {
        data = await res.json()
      } catch {
        throw new ProviderError('invalid_model_output', 'The AI service returned an unreadable response.', 502)
      }
      const choice = data?.choices?.[0]
      const message = choice?.message
      if (message?.refusal) {
        throw new ProviderError('provider_refused', 'The AI declined to interpret this text.', 422)
      }
      if (choice?.finish_reason === 'length') {
        throw new ProviderError('invalid_model_output', 'The AI returned an incomplete response.', 502)
      }
      if (typeof message?.content !== 'string' || message.content.trim() === '') {
        throw new ProviderError('invalid_model_output', 'The AI returned an empty response.', 502)
      }
      try {
        return JSON.parse(message.content)
      } catch {
        throw new ProviderError('invalid_model_output', 'The AI returned malformed JSON. Please try rephrasing.', 502)
      }
    },
  }
}
