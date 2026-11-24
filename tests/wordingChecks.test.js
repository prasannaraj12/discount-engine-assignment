// Deterministic wording checks added after the Groq parser evaluation found two
// misses the app did not flag. Offline: the model outputs below are copied
// verbatim from that run (evals/results/subset.json, 24 Nov 2026).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { adaptLlmResult, timeLimitWording, negativeAmountWording, crossCheck } from '../src/adapters/naturalLanguageAdapter.js'

const cart = [{ itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 }]
const view = (text, modelOutput) => adaptLlmResult(modelOutput, { text, existingRules: [], cartItems: cart })

const GROQ_TIME_MISS = {
  status: 'ok',
  interpretation: '20% off Natura Casa brand products.',
  clarification: null,
  missing_fields: [],
  rule: { scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 20, stackable: false, min_cart_value: null, threshold_inclusive: null },
}
const GROQ_NEGATIVE_MISS = {
  status: 'ok',
  interpretation: 'Rs.50 off on all Natura Casa products',
  clarification: null,
  missing_fields: [],
  rule: { scope: 'brand', applies_to: 'Natura Casa', type: 'flat', value: 50, stackable: false, min_cart_value: null, threshold_inclusive: null },
}

describe('replaying the two evaluation misses', () => {
  it('"this weekend only" turned into a permanent rule is now flagged (confirm still allowed)', () => {
    const v = view('20% off Natura Casa this weekend only', GROQ_TIME_MISS)
    expect(v.validation.ok).toBe(true)
    expect(v.blockers).toEqual([])
    expect(v.warnings[0]).toBe(
      'Your text mentions a time limit ("weekend"), but this engine has no dates or schedules. If you confirm, the rule will apply permanently until you remove it.'
    )
  })

  it('"-50 rupees off" turned into ₹50 off is now blocked', () => {
    const v = view('-50 rupees off Natura Casa', GROQ_NEGATIVE_MISS)
    expect(v.validation.ok).toBe(true) // the rule itself looks valid…
    expect(v.blockers).toEqual([
      'Your text contains a negative amount ("-50"). A discount must be a positive amount, so this rule can\'t be added. Please rephrase it.',
    ]) // …but the wording check stops it
  })
})

describe('time-limit wording', () => {
  it.each([
    ['20% off Natura Casa this weekend only', 'weekend'],
    ['10% off Flipkart till Sunday', 'till'],
    ['₹100 off valid until 31 Dec', 'valid until'],
    ['Diwali sale: 15% off Noon', 'Diwali'],
    ['20% off for 3 days', 'for 3 days'],
    ['Flat 5% off between 6pm and 9pm', '6pm'],
    ['10% off on 15/08/2026', '15/08/2026'],
    ['5% off today only', 'today'],
    ['Flash sale: 30% off Amazon India', 'Flash sale'],
    ['15% off from 1st January', '1st January'],
  ])('detects %j', (text, phrase) => {
    expect(timeLimitWording(text)).toBe(phrase)
  })

  it('does not fire on any of the other 24 evaluation instructions', () => {
    const cases = JSON.parse(readFileSync(new URL('../evals/parser-cases.json', import.meta.url), 'utf8'))
    const hits = cases.filter((c) => timeLimitWording(c.text)).map((c) => c.id)
    expect(hits).toEqual(['unsupported-time'])
  })
})

describe('negative-amount wording', () => {
  it.each([
    ['-50 rupees off Natura Casa', '-50'],
    ['Rs.-50 off Noon', 'Rs.-50'],
    ['₹ -20 off Flipkart', '₹ -20'],
    ['minus 30 rupees off', 'minus 30'],
    ['negative 10% on Noon', 'negative 10'],
    ['Give −15% off Amazon India', '−15'],
  ])('detects %j', (text, phrase) => {
    expect(negativeAmountWording(text)).toBe(phrase)
  })

  it.each(['10-20% off Flipkart', 'Nordic Basics: ₹75 off, can be combined', 'Flat Rs.250 off on orders of Rs.4000 and above', 'Take 5% off the entire cart', 'Mid-season 10% off Noon'])(
    'ignores %j',
    (text) => {
      expect(negativeAmountWording(text)).toBeNull()
    }
  )

  it('does not fire on any of the other 24 evaluation instructions', () => {
    const cases = JSON.parse(readFileSync(new URL('../evals/parser-cases.json', import.meta.url), 'utf8'))
    expect(cases.filter((c) => negativeAmountWording(c.text)).map((c) => c.id)).toEqual(['negative'])
  })

  it('blocks even after the user edits the fields, because the original text asked for a negative amount', () => {
    const draft = { scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 75, stackable: false, minCartValue: null }
    expect(crossCheck(draft, { text: '-50 rupees off Natura Casa' }).blockers).toHaveLength(1)
  })
})
