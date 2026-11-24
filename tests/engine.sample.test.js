// Verification against the assignment brief's "Expected Results" table.
// These values come from the brief — never edit them to make a test pass.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'
import { calculateCart } from '../src/engine/pricing.js'

const read = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')

describe('assignment sample data', () => {
  const rules = parseRulesCSV(read('rules.csv'))
  const cart = parseCartCSV(read('cart.csv'))
  const pricing = calculateCart(cart.data, rules.data)
  const byId = Object.fromEntries(pricing.items.map((r) => [r.itemId, r]))

  it('parses both sample files without errors', () => {
    expect(rules.errors).toEqual([])
    expect(cart.errors).toEqual([])
    expect(rules.data).toHaveLength(4)
    expect(cart.data).toHaveLength(6)
  })

  it.each([
    ['ITEM-01', 1104, ['RULE-01'], ['RULE-02']],
    ['ITEM-02', 629, ['RULE-02', 'RULE-03'], []],
    ['ITEM-03', 509, ['RULE-01'], []],
    ['ITEM-04', 2499, [], []],
    ['ITEM-05', 382, ['RULE-01'], []],
    ['ITEM-06', 809, ['RULE-03'], []],
  ])('%s → Rs.%d', (id, finalPrice, applied, skipped) => {
    expect(byId[id].finalPrice).toBe(finalPrice)
    expect(byId[id].appliedRules).toEqual(applied)
    expect(byId[id].skippedRules).toEqual(skipped)
  })

  it('ITEM-04 says no offers available', () => {
    expect(byId['ITEM-04'].reasoning).toBe('No offers available')
  })

  it('ITEM-01: RULE-01 (Rs.195) beats RULE-02 (Rs.150)', () => {
    expect(byId['ITEM-01'].steps[0]).toMatchObject({ ruleId: 'RULE-01', amount: 195, exactAmount: 194.85 })
    expect(byId['ITEM-01'].competingOffers).toEqual([expect.objectContaining({ ruleId: 'RULE-02', amount: 150 })])
  })

  it('ITEM-02: Rs.150 flat, then 10% stacked on Rs.699', () => {
    const [first, second] = byId['ITEM-02'].steps
    expect(first).toMatchObject({ ruleId: 'RULE-02', role: 'best', amount: 150, priceAfter: 699 })
    expect(second).toMatchObject({ ruleId: 'RULE-03', role: 'stacked', priceBefore: 699, amount: 70, priceAfter: 629 })
  })

  it('cart: Rs.5,932 before offer, Rs.593 cart discount, Rs.5,339 final', () => {
    expect(pricing.subtotal).toBe(5932)
    expect(pricing.cartOffers).toHaveLength(1)
    expect(pricing.cartOffers[0]).toMatchObject({ ruleId: 'RULE-04', amount: 593 })
    expect(pricing.cartDiscount).toBe(593)
    expect(pricing.finalTotal).toBe(5339)
  })
})
