import { describe, it, expect } from 'vitest'
import { applyDiscounts, calculateDiscountAmount } from '../src/engine/discountEngine.js'
import { calculateCart, diffPricing } from '../src/engine/pricing.js'
import { getThresholdNudge } from '../src/engine/cartRuleEvaluator.js'

const rule = (o) => ({ stackable: false, minCartValue: null, thresholdInclusive: true, appliesTo: null, ...o })
const item = (o) => ({ itemId: 'I1', product: 'Lamp', brand: 'Acme', platform: 'Flipkart', basePrice: 1000, ...o })
const cartRule = (o) => rule({ ruleId: 'C1', scope: 'cart', type: 'percentage', value: 10, minCartValue: 4000, ...o })

describe('item-level selection', () => {
  it('picks the highest-saving non-stackable rule regardless of scope', () => {
    const rules = [
      rule({ ruleId: 'A', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 120 }),
      rule({ ruleId: 'B', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 15 }),
      rule({ ruleId: 'C', scope: 'brand', appliesTo: 'acme', type: 'percentage', value: 5 }),
    ]
    const r = applyDiscounts(item(), rules)
    expect(r.appliedRules).toEqual(['B'])
    expect(r.finalPrice).toBe(850)
    expect(r.skippedRules).toEqual(['A', 'C'])
  })

  it('applies a stackable rule on its own when no non-stackable rule matches', () => {
    const r = applyDiscounts(item(), [rule({ ruleId: 'S', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true })])
    expect(r.finalPrice).toBe(900)
    expect(r.steps[0].role).toBe('stacked')
  })

  it('stacks percentage on the price after the winning discount', () => {
    const r = applyDiscounts(item(), [
      rule({ ruleId: 'W', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 200 }),
      rule({ ruleId: 'S', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true }),
    ])
    expect(r.finalPrice).toBe(720) // (1000 - 200) × 0.9
  })

  it('returns the base price and "No offers available" when nothing matches', () => {
    const r = applyDiscounts(item(), [rule({ ruleId: 'X', scope: 'brand', appliesTo: 'Other', type: 'flat', value: 50 })])
    expect(r).toMatchObject({ finalPrice: 1000, totalDiscount: 0, reasoning: 'No offers available' })
  })

  it('never lets a flat discount push the price below zero', () => {
    expect(calculateDiscountAmount(100, rule({ type: 'flat', value: 150 }))).toBe(100)
    const r = applyDiscounts(item({ basePrice: 100 }), [rule({ ruleId: 'F', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 150 })])
    expect(r.finalPrice).toBe(0)
  })

  it('keeps the first listed rule on an exact tie', () => {
    const r = applyDiscounts(item(), [
      rule({ ruleId: 'FIRST', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 100 }),
      rule({ ruleId: 'SECOND', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10 }),
    ])
    expect(r.appliedRules).toEqual(['FIRST'])
  })

  it('handles duplicate products as independent line items', () => {
    const p = calculateCart(
      [item({ itemId: 'A' }), item({ itemId: 'B' })],
      [rule({ ruleId: 'P', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10 })]
    )
    expect(p.items.map((r) => r.finalPrice)).toEqual([900, 900])
    expect(p.subtotal).toBe(1800)
  })
})

describe('cart-level offers', () => {
  const cartOf = (price) => [item({ basePrice: price })]

  it('applies when the threshold is met', () => {
    const p = calculateCart(cartOf(5000), [cartRule()])
    expect(p.cartDiscount).toBe(500)
    expect(p.finalTotal).toBe(4500)
  })

  it('does not apply below the threshold and produces a nudge', () => {
    const p = calculateCart(cartOf(3940), [cartRule()])
    expect(p.cartOffers).toEqual([])
    expect(p.finalTotal).toBe(3940)
    expect(getThresholdNudge(p)).toMatchObject({ remaining: 60, required: 4000, strict: false })
  })

  it('applies at exactly the threshold for "at least" rules', () => {
    const p = calculateCart(cartOf(4000), [cartRule()])
    expect(p.cartDiscount).toBe(400)
    expect(getThresholdNudge(p)).toBeNull()
  })

  it('does not apply at exactly the threshold for strict "more than" rules', () => {
    const p = calculateCart(cartOf(5000), [cartRule({ minCartValue: 5000, thresholdInclusive: false })])
    expect(p.cartDiscount).toBe(0)
    expect(getThresholdNudge(p)).toMatchObject({ strict: true, remaining: 0 })
    expect(calculateCart(cartOf(5000.5), [cartRule({ minCartValue: 5000, thresholdInclusive: false })]).cartDiscount).toBe(500)
  })

  it('checks the threshold against discounted item prices, not base prices', () => {
    const rules = [cartRule(), rule({ ruleId: 'P', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10 })]
    const p = calculateCart(cartOf(4400), rules) // 4400 → 3960 after item discount
    expect(p.subtotal).toBe(3960)
    expect(p.cartDiscount).toBe(0)
  })

  it('handles an empty cart safely', () => {
    const p = calculateCart([], [cartRule({ minCartValue: 0 })])
    expect(p).toMatchObject({ items: [], subtotal: 0, cartDiscount: 0, finalTotal: 0 })
    expect(getThresholdNudge(p)).toBeNull()
  })

  it('picks the best qualifying non-stackable cart rule and stacks stackable ones', () => {
    const p = calculateCart(cartOf(10000), [
      cartRule({ ruleId: 'C10', value: 10 }),
      cartRule({ ruleId: 'CFLAT', type: 'flat', value: 1500, minCartValue: 8000 }),
      cartRule({ ruleId: 'CS', value: 5, stackable: true, minCartValue: null }),
    ])
    expect(p.cartOffers.map((o) => o.ruleId)).toEqual(['CFLAT', 'CS'])
    expect(p.finalTotal).toBe(8075) // 10000 - 1500 = 8500, - 5% (425)
  })

  it('nudges toward the nearest unmet threshold when several exist', () => {
    const p = calculateCart(cartOf(3000), [cartRule({ ruleId: 'BIG', minCartValue: 8000 }), cartRule({ ruleId: 'SMALL', minCartValue: 3500 })])
    expect(getThresholdNudge(p)).toMatchObject({ remaining: 500, required: 3500 })
  })
})

describe('recalculation after adding a rule', () => {
  it('reports only items whose price actually changed', () => {
    const cart = [item({ itemId: 'A', brand: 'Acme' }), item({ itemId: 'B', brand: 'Other', platform: 'Noon' })]
    const base = [rule({ ruleId: 'P', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 20 })]
    const before = calculateCart(cart, base)
    // A weaker non-stackable brand rule on item A loses to the 20% offer → no change.
    const weaker = calculateCart(cart, [...base, rule({ ruleId: 'N', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 50 })])
    expect(diffPricing(before, weaker).changedItems).toEqual([])
    // A stackable rule does change it.
    const stacked = calculateCart(cart, [...base, rule({ ruleId: 'S', scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 50, stackable: true })])
    const d = diffPricing(before, stacked)
    expect(d.changedItems).toEqual([expect.objectContaining({ itemId: 'A', before: 800, after: 750, delta: 50 })])
    expect(d.additionalSavings).toBe(50)
  })
})
