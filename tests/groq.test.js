// Offline tests for the Groq provider. Every network response is a mock;
// global fetch is replaced so an accidental real call fails the test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGroqProvider, buildGroqRequest, supportsStrictSchema, GROQ_ENDPOINT, DEFAULT_GROQ_MODEL } from '../server/llm/groqProvider.js'
import { toProviderJsonSchema, strictSchemaViolations } from '../server/llm/jsonSchema.js'
import { llmRuleSchema } from '../server/llm/ruleOutputSchema.js'
import { ProviderError } from '../server/llm/errors.js'
import { handleParseRule, createProvider, providerConfigProblem, resolveProviderConfig } from '../server/parseRule.js'
import { adaptLlmResult } from '../src/adapters/naturalLanguageAdapter.js'

const KEY = 'gsk_test_not_a_real_key'
const ctx = { brands: ['Natura Casa'], platforms: ['Amazon India', 'Flipkart'] }
const okOutput = {
  status: 'ok',
  interpretation: '20% off Natura Casa products, stackable.',
  clarification: null,
  missing_fields: [],
  rule: { scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 20, stackable: true, min_cart_value: null, threshold_inclusive: null },
}

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => (typeof body === 'function' ? body() : body),
})
const completion = (content, extra = {}) => reply(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, ...extra } }] })

let realFetch
beforeEach(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('Real network call attempted in an offline test')
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

function provider(fetchImpl, model) {
  return createGroqProvider({ apiKey: KEY, model, fetchImpl })
}

describe('JSON Schema sent to Groq satisfies its documented strict-mode rules', () => {
  const schema = toProviderJsonSchema(llmRuleSchema)

  it('has no violations', () => {
    expect(strictSchemaViolations(schema)).toEqual([])
  })

  it('lists every property as required and closes every object', () => {
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
    expect(schema.additionalProperties).toBe(false)
    const rule = schema.properties.rule.anyOf.find((s) => s.type === 'object')
    expect(rule.required.sort()).toEqual(Object.keys(rule.properties).sort())
    expect(rule.additionalProperties).toBe(false)
    expect(schema.properties.rule.anyOf).toContainEqual({ type: 'null' })
  })

  it('uses type unions for nullable fields and drops the $schema marker', () => {
    expect(schema.properties.clarification.type).toEqual(['string', 'null'])
    expect(schema.$schema).toBeUndefined()
  })

  it('the checker really catches violations (optional field, open object, unknown keyword)', () => {
    expect(strictSchemaViolations({ type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false })[0]).toContain('must be listed in "required"')
    expect(strictSchemaViolations({ type: 'object', properties: {}, required: [] })[0]).toContain('additionalProperties: false')
    expect(strictSchemaViolations({ type: 'string', minLength: 1 })[0]).toContain('unsupported keyword "minLength"')
  })
})

describe('request shape', () => {
  it('strict json_schema for gpt-oss models', () => {
    const body = buildGroqRequest('openai/gpt-oss-120b', '20% off Natura Casa', ctx)
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'discount_rule', strict: true } })
    expect(body.response_format.json_schema.schema).toEqual(toProviderJsonSchema(llmRuleSchema))
    expect(body.stream).toBe(false)
    expect(body.messages[1].content).toContain('<rule_text>\n20% off Natura Casa\n</rule_text>')
  })

  it('json_object mode with the schema in the prompt for other models', () => {
    const body = buildGroqRequest('llama-3.3-70b-versatile', 'x', ctx)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('"additionalProperties":false')
    expect(supportsStrictSchema('llama-3.3-70b-versatile')).toBe(false)
  })

  it('sends exactly one authenticated POST to the Groq endpoint', async () => {
    const fetchImpl = vi.fn(async () => completion(JSON.stringify(okOutput)))
    await provider(fetchImpl).parseRule('20% off Natura Casa', ctx)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(GROQ_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body).model).toBe(DEFAULT_GROQ_MODEL)
  })
})

describe('response handling', () => {
  it('returns the parsed JSON on success', async () => {
    expect(await provider(async () => completion(JSON.stringify(okOutput))).parseRule('x', ctx)).toEqual(okOutput)
  })

  it.each([
    ['malformed JSON', () => completion('{"status": "ok", '), 'invalid_model_output', /malformed JSON/],
    ['empty content', () => completion(''), 'invalid_model_output', /empty response/],
    ['truncated (finish_reason length)', () => reply(200, { choices: [{ finish_reason: 'length', message: { content: '{"status"' } }] }), 'invalid_model_output', /incomplete/],
    ['refusal', () => completion(null, { refusal: 'I cannot help with that' }), 'provider_refused', /declined/],
    ['unreadable body', () => reply(200, () => { throw new SyntaxError('bad') }), 'invalid_model_output', /unreadable/],
    ['401 invalid key', () => reply(401, { error: { message: 'Invalid API Key' } }), 'provider_auth', /GROQ_API_KEY/],
    ['403 forbidden', () => reply(403, {}), 'provider_auth', /credentials/],
    ['429 with retry-after', () => reply(429, {}, { 'retry-after': '7' }), 'provider_rate_limited', /try again in 7 s/],
    ['429 without retry-after', () => reply(429, {}), 'provider_rate_limited', /in a moment/],
    ['400 schema mismatch', () => reply(400, { error: { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.' } }), 'invalid_model_output', /unexpected format/],
    ['400 other', () => reply(400, { error: { message: 'response_format not supported' } }), 'provider_bad_request', /GROQ_MODEL/],
    ['404 unknown model', () => reply(404, {}), 'provider_config', /GROQ_MODEL/],
    ['422', () => reply(422, {}), 'invalid_model_output', /could not produce/],
    ['498 capacity', () => reply(498, {}), 'provider_unreachable', /temporarily unavailable/],
    ['500', () => reply(500, {}), 'provider_unreachable', /temporarily unavailable/],
  ])('%s → %s', async (_, response, code, message) => {
    const fetchImpl = vi.fn(async () => response())
    const err = await provider(fetchImpl).parseRule('x', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe(code)
    expect(err.message).toMatch(message)
    expect(err.message).not.toContain(KEY)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no automatic retries
  })

  it('network failure and timeout make one attempt and fail cleanly', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await provider(down).parseRule('x', ctx).catch((e) => e)).code).toBe('provider_unreachable')
    expect(down).toHaveBeenCalledTimes(1)

    const hang = vi.fn((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    const slow = createGroqProvider({ apiKey: KEY, fetchImpl: hang, timeoutMs: 20 })
    expect((await slow.parseRule('x', ctx).catch((e) => e)).message).toMatch(/took too long/)
    expect(hang).toHaveBeenCalledTimes(1)
  })
})

describe('end to end through the server handler (mocked Groq)', () => {
  it('valid Groq output passes Zod and becomes a reviewable rule', async () => {
    const r = await handleParseRule({ text: '20% off for Natura Casa brand, stackable with other offers', context: ctx }, { provider: provider(async () => completion(JSON.stringify(okOutput))), ip: 'g1' })
    expect(r.status).toBe(200)
    const view = adaptLlmResult(r.body.result, { text: '20% off for Natura Casa brand, stackable with other offers', existingRules: [], cartItems: [] })
    expect(view.validation.ok).toBe(true)
  })

  it('JSON that parses but breaks the schema is rejected by the server Zod check', async () => {
    const bad = { ...okOutput, rule: { ...okOutput.rule, scope: 'category' } }
    const r = await handleParseRule({ text: '20% off cushions' }, { provider: provider(async () => completion(JSON.stringify(bad))), ip: 'g2' })
    expect(r).toMatchObject({ status: 502, body: { error: 'invalid_model_output' } })
  })

  it('an out-of-range value from Groq is still blocked by domain validation', async () => {
    const r = await handleParseRule({ text: 'Give 200% off Natura Casa' }, { provider: provider(async () => completion(JSON.stringify({ ...okOutput, rule: { ...okOutput.rule, value: 200, stackable: false } }))), ip: 'g3' })
    const view = adaptLlmResult(r.body.result, { text: 'Give 200% off Natura Casa', existingRules: [], cartItems: [] })
    expect(view.validation.ok).toBe(false)
  })

  it('ambiguous input stays a clarification', async () => {
    const clarify = { status: 'needs_clarification', interpretation: 'Large-order discount', clarification: 'What percentage, and from what cart value?', missing_fields: ['value', 'min_cart_value'], rule: null }
    const r = await handleParseRule({ text: 'Give a discount for big orders' }, { provider: provider(async () => completion(JSON.stringify(clarify))), ip: 'g4' })
    expect(adaptLlmResult(r.body.result, { text: 'Give a discount for big orders', existingRules: [], cartItems: [] }).kind).toBe('clarify')
  })

  it('a Groq failure is reported as an error, never replaced by another provider or a made-up rule', async () => {
    const r = await handleParseRule({ text: '10% off Flipkart' }, { provider: provider(async () => reply(500, {})), ip: 'g5' })
    expect(r.status).toBe(503)
    expect(r.body.result).toBeUndefined()
  })
})

describe('explicit provider selection', () => {
  it('defaults to anthropic when LLM_PROVIDER is unset, even if only a Groq key exists', () => {
    const env = { GROQ_API_KEY: KEY }
    expect(resolveProviderConfig(env).name).toBe('anthropic')
    expect(createProvider(env)).toBeNull()
    expect(providerConfigProblem(env)).toBe('ANTHROPIC_API_KEY is missing for LLM_PROVIDER=anthropic')
  })

  it('LLM_PROVIDER=groq needs only GROQ_API_KEY', () => {
    const p = createProvider({ LLM_PROVIDER: 'groq', GROQ_API_KEY: KEY })
    expect(p).toMatchObject({ name: 'groq', model: DEFAULT_GROQ_MODEL })
    expect(providerConfigProblem({ LLM_PROVIDER: 'groq', GROQ_API_KEY: KEY })).toBeNull()
  })

  it('LLM_PROVIDER=groq without a Groq key is not configured, and never uses the Anthropic key instead', () => {
    const env = { LLM_PROVIDER: 'Groq', ANTHROPIC_API_KEY: 'sk-ant-test' }
    expect(createProvider(env)).toBeNull()
    expect(providerConfigProblem(env)).toBe('GROQ_API_KEY is missing for LLM_PROVIDER=groq')
  })

  it('models are independent per provider; LLM_MODEL is only an Anthropic alias', () => {
    expect(createProvider({ LLM_PROVIDER: 'groq', GROQ_API_KEY: KEY, GROQ_MODEL: 'openai/gpt-oss-20b', ANTHROPIC_MODEL: 'x', LLM_MODEL: 'y' }).model).toBe('openai/gpt-oss-20b')
    expect(createProvider({ LLM_PROVIDER: 'groq', GROQ_API_KEY: KEY, LLM_MODEL: 'y' }).model).toBe(DEFAULT_GROQ_MODEL)
    expect(resolveProviderConfig({ ANTHROPIC_MODEL: 'a', LLM_MODEL: 'b' }).model).toBe('a')
    expect(resolveProviderConfig({ LLM_MODEL: 'b' }).model).toBe('b')
  })

  it('rejects unknown providers with a clear message', () => {
    expect(createProvider({ LLM_PROVIDER: 'openai', GROQ_API_KEY: KEY })).toBeNull()
    expect(providerConfigProblem({ LLM_PROVIDER: 'openai' })).toContain('not supported')
  })

  it('the not-configured response names the missing variable but never a key value', async () => {
    const env = { LLM_PROVIDER: 'groq' }
    const r = await handleParseRule({ text: '10% off Flipkart' }, { provider: createProvider(env), configProblem: providerConfigProblem(env) })
    expect(r).toMatchObject({ status: 503, body: { error: 'not_configured' } })
    expect(r.body.message).toBe('The AI rule parser is not configured on this server: GROQ_API_KEY is missing for LLM_PROVIDER=groq.')
  })
})
