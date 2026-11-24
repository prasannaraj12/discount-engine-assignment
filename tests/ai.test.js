import { describe, it, expect } from 'vitest'
import { handleParseRule } from '../server/parseRule.js'
import { ProviderError } from '../server/llm/anthropicProvider.js'
import { adaptLlmResult, crossCheck, numbersInText, thresholdWording } from '../src/adapters/naturalLanguageAdapter.js'
import { validateDiscountRule } from '../src/validation/discountRuleSchema.js'
import { requestRuleParse } from '../src/services/aiRuleParser.js'
import { calculateCart, diffPricing } from '../src/engine/pricing.js'

const fakeProvider = (output) => ({ model: 'fake', parseRule: async () => (typeof output === 'function' ? output() : output) })
const ok = (rule, interpretation = 'x') => ({ status: 'ok', interpretation, clarification: null, missing_fields: [], rule })
const llmRule = (o) => ({ scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 20, stackable: true, min_cart_value: null, threshold_inclusive: null, ...o })

const cartItems = [
  { itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 },
  { itemId: 'ITEM-06', product: 'Desk Organiser', brand: 'Nordic Basics', platform: 'Flipkart', basePrice: 899 },
]

describe('server handler (LLM output is never trusted blindly)', () => {
  it('returns 503 with a clear message when no provider is configured', async () => {
    const r = await handleParseRule({ text: '10% off Flipkart' }, { provider: null })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('not_configured')
  })

  it('rejects empty and oversized input before calling the model', async () => {
    expect((await handleParseRule({ text: ' ' }, { provider: fakeProvider({}) })).status).toBe(400)
    expect((await handleParseRule({ text: 'x'.repeat(501) }, { provider: fakeProvider({}) })).status).toBe(400)
  })

  it('rejects malformed model output', async () => {
    const r = await handleParseRule({ text: '10% off' }, { provider: fakeProvider({ status: 'ok', rule: { scope: 'category' } }), ip: 'a' })
    expect(r).toMatchObject({ status: 502, body: { error: 'invalid_model_output' } })
  })

  it('rejects "ok" with no rule', async () => {
    const r = await handleParseRule({ text: '10% off' }, { provider: fakeProvider({ ...ok(null) }), ip: 'b' })
    expect(r.status).toBe(502)
  })

  it('maps provider failures to user-facing errors', async () => {
    const provider = fakeProvider(() => {
      throw new ProviderError('provider_unreachable', 'Could not reach the AI service.', 503)
    })
    const r = await handleParseRule({ text: '10% off' }, { provider, ip: 'c' })
    expect(r).toMatchObject({ status: 503, body: { message: 'Could not reach the AI service.' } })
  })

  it('passes valid output through', async () => {
    const r = await handleParseRule({ text: '20% off Natura Casa, stackable' }, { provider: fakeProvider(ok(llmRule())), ip: 'd' })
    expect(r.status).toBe(200)
    expect(r.body.result.rule.value).toBe(20)
  })
})

describe('domain validation of AI-generated rules', () => {
  const base = { ruleId: 'R', scope: 'brand', appliesTo: 'X', type: 'percentage', value: 10, stackable: false }
  it.each([
    [{ value: 200 }, 'outside the supported range'],
    [{ value: -5 }, 'greater than zero'],
    [{ value: 0 }, 'greater than zero'],
    [{ value: NaN }, 'must be a number'],
    [{ appliesTo: '' }, 'needs the brand name'],
    [{ minCartValue: 1000 }, 'only supported on cart-level rules'],
    [{ scope: 'category' }, 'Scope must be'],
    [{ scope: 'cart', minCartValue: -1 }, 'cannot be negative'],
  ])('rejects %o', (patch, message) => {
    const r = validateDiscountRule({ ...base, ...patch })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain(message)
  })

  it('accepts a flat amount above 100 (only percentages are capped)', () => {
    expect(validateDiscountRule({ ...base, type: 'flat', value: 250 }).ok).toBe(true)
  })
})

describe('natural-language adapter', () => {
  const ctx = (text) => ({ text, existingRules: [], cartItems })

  it('turns the brief\'s example into a validated rule', () => {
    const text = '20% off for Natura Casa brand, stackable with other offers'
    const v = adaptLlmResult(ok(llmRule()), ctx(text))
    expect(v.kind).toBe('review')
    expect(v.validation.ok).toBe(true)
    expect(v.validation.rule).toMatchObject({ ruleId: 'RULE-01', scope: 'brand', appliesTo: 'Natura Casa', value: 20, stackable: true, source: 'ai' })
    expect(v.warnings).toEqual([])
  })

  it('surfaces an ambiguous request as a clarification, not a rule', () => {
    const v = adaptLlmResult(
      { status: 'needs_clarification', interpretation: 'A large-order discount', clarification: 'What percentage, and from what cart value?', missing_fields: ['value', 'min_cart_value'], rule: null },
      ctx('Give a discount for big orders')
    )
    expect(v).toMatchObject({ kind: 'clarify', missing: ['value', 'min_cart_value'] })
  })

  it('reports 200% as an invalid rule instead of fixing it', () => {
    const v = adaptLlmResult(ok(llmRule({ value: 200, stackable: false })), ctx('Give 200% off Natura Casa'))
    expect(v.validation.ok).toBe(false)
    expect(v.validation.errors[0]).toContain('outside the supported range')
  })

  it('flags a value that is not in the text (possible hallucination)', () => {
    const { warnings } = crossCheck({ scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 25, stackable: false }, ctx('20% off Natura Casa'))
    expect(warnings.join(' ')).toContain('25 doesn\'t appear')
  })

  it('flags strict wording mapped to an inclusive threshold', () => {
    const draft = { scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 5000, thresholdInclusive: true }
    expect(crossCheck(draft, ctx('10% off if cart value is more than Rs.5,000')).warnings.join(' ')).toContain('more than/above')
    expect(crossCheck({ ...draft, thresholdInclusive: false }, ctx('10% off if cart value is more than Rs.5,000')).warnings).toEqual([])
  })

  it('detects duplicates of existing rules', () => {
    const existing = [{ ruleId: 'RULE-02', scope: 'brand', appliesTo: 'natura casa', type: 'percentage', value: 20, stackable: true, minCartValue: null, thresholdInclusive: true }]
    const { duplicateOf } = crossCheck({ scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null }, { ...ctx('20% off Natura Casa stackable'), existingRules: existing })
    expect(duplicateOf).toBe('RULE-02')
  })

  it('reads numbers and threshold wording', () => {
    expect(numbersInText('10% off above Rs.5,000 or 2.5k')).toEqual([10, 5000, 2500])
    expect(thresholdWording('orders of Rs.4000 and above')).toBe('inclusive')
    expect(thresholdWording('above Rs.5,000')).toBe('strict')
    expect(thresholdWording('carts over 5000')).toBe('strict')
    expect(thresholdWording('carts of 5000+')).toBe('inclusive')
  })

  it('end to end: confirmed AI rule recalculates the cart', () => {
    const v = adaptLlmResult(ok(llmRule()), ctx('20% off for Natura Casa brand, stackable with other offers'))
    const before = calculateCart(cartItems, [])
    const after = calculateCart(cartItems, [v.validation.rule])
    const d = diffPricing(before, after)
    expect(d.changedItems.map((c) => c.itemId)).toEqual(['ITEM-01'])
    expect(after.items[0].finalPrice).toBe(1039) // 1299 − 20% (259.8 → 260)
  })
})

describe('browser AI client', () => {
  it('handles network failure', async () => {
    const r = await requestRuleParse('x', {}, { fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    expect(r).toMatchObject({ ok: false, code: 'network_error' })
  })
  it('handles non-JSON responses', async () => {
    const r = await requestRuleParse('x', {}, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error() } }) })
    expect(r).toMatchObject({ ok: false, code: 'bad_response' })
  })
  it('surfaces server error messages', async () => {
    const r = await requestRuleParse('x', {}, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_configured', message: 'not configured' }) }) })
    expect(r).toMatchObject({ ok: false, code: 'not_configured', message: 'not configured' })
  })
})
