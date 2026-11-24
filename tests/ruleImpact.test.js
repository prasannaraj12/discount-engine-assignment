import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'
import { previewRuleImpact } from '../src/engine/ruleImpact.js'

const read = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')
const rules = parseRulesCSV(read('rules.csv')).data
const cart = parseCartCSV(read('cart.csv')).data
const r = (o) => ({ ruleId: 'RULE-05', appliesTo: null, stackable: false, minCartValue: null, thresholdInclusive: true, ...o })

describe('rule impact preview (uses the real engine)', () => {
  it('stackable 20% Natura Casa: changes 2 items and re-computes the cart offer', () => {
    const p = previewRuleImpact(cart, rules, r({ scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true }))
    expect(p.diff.changedItems.map((c) => c.itemId)).toEqual(['ITEM-01', 'ITEM-02'])
    // ITEM-01: 1104 → 1104 − 221 = 883; ITEM-02: 629 − 126 = 503
    expect(p.after.items[0].finalPrice).toBe(883)
    expect(p.after.items[1].finalPrice).toBe(503)
    expect(p.after.subtotal).toBe(5585)
    expect(p.after.finalTotal).toBe(5585 - 559)
    expect(p.diff.additionalSavings).toBe(5339 - 5026)
    expect(p.notes.join(' ')).toContain('cart offer adjusts from ₹593 to ₹559')
  })

  it('explains a non-stackable rule that loses to an existing offer', () => {
    const p = previewRuleImpact(cart, rules, r({ scope: 'brand', appliesTo: 'LivSpace Pro', type: 'flat', value: 50 }))
    expect(p.diff.changedItems.map((c) => c.itemId)).toEqual(['ITEM-04']) // Ceramic Vase had no offer
    expect(p.notes).toContain('Wall Shelf: the existing Amazon India offer saves ₹90, more than this rule\'s ₹50, so it stays applied.')
  })

  it('explains a rule that replaces an existing winner', () => {
    const p = previewRuleImpact(cart, rules, r({ scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 300 }))
    expect(p.notes[0]).toBe('Cushion Cover: this rule saves ₹300 and replaces the Amazon India offer (₹195).')
  })

  it('cart rule above the current total does not apply and says why', () => {
    const p = previewRuleImpact(cart, rules, r({ scope: 'cart', type: 'percentage', value: 15, minCartValue: 8000 }))
    expect(p.diff.additionalSavings).toBe(0)
    expect(p.notes[0]).toContain('below ₹8,000')
  })

  it('weaker cart rule loses to RULE-04', () => {
    const p = previewRuleImpact(cart, rules, r({ scope: 'cart', type: 'flat', value: 200, minCartValue: 1000 }))
    expect(p.notes[0]).toContain('existing RULE-04 cart offer saves ₹593')
  })
})
