import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'
import { calculateCart } from '../src/engine/pricing.js'
import { explainItem, explainCartOffer, explainNudge, describeRule } from '../src/engine/explanationEngine.js'
import { getThresholdNudge } from '../src/engine/cartRuleEvaluator.js'

const read = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')
const pricing = calculateCart(parseCartCSV(read('cart.csv')).data, parseRulesCSV(read('rules.csv')).data)
const byId = Object.fromEntries(pricing.items.map((r) => [r.itemId, r]))

describe('customer explanations', () => {
  it('explains why the Amazon offer beat the Natura Casa offer', () => {
    const e = explainItem(byId['ITEM-01'])
    expect(e.summary).toBe('You saved ₹195 with the Amazon India offer, which is ₹45 more than the Natura Casa offer (₹150).')
    expect(e.alternatives[0]).toContain('Natura Casa offer (₹150 off) would have saved ₹150')
    expect(e.technical[0]).toContain('15% × ₹1,299 = ₹194.85 → rounded to ₹195')
  })

  it('explains stacking', () => {
    const e = explainItem(byId['ITEM-02'])
    expect(e.label).toBe('Natura Casa offer: ₹150 off + Flipkart offer: 10% off')
    expect(e.summary).toContain('further ₹70 off')
  })

  it('gives a meaningful no-offer message', () => {
    expect(explainItem(byId['ITEM-04']).summary).toBe(
      'No offers available. This product is currently not eligible for any active discount.'
    )
  })

  it('labels the cart offer like the brief', () => {
    expect(explainCartOffer(pricing.cartOffers[0]).label).toBe('Cart offer: 10% off — ₹593 saved')
  })

  it('writes the threshold nudge from the computed shortfall', () => {
    const p = calculateCart([{ itemId: 'X', product: 'P', brand: 'B', platform: 'Noon', basePrice: 3940 }], [pricing.cartOffers[0].rule])
    expect(explainNudge(getThresholdNudge(p))).toBe("You're just ₹60 away from unlocking 10% off your entire cart.")
  })

  it('describes strict vs inclusive thresholds differently', () => {
    const base = { ruleId: 'R', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 5000 }
    expect(describeRule({ ...base, thresholdInclusive: false })).toContain('more than ₹5,000')
    expect(describeRule({ ...base, thresholdInclusive: true })).toContain('at least ₹5,000')
  })
})
