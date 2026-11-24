import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'
import { calculateCart } from '../src/engine/pricing.js'
import { auditPromotions } from '../src/engine/promotionAudit.js'
import { getCartInsights } from '../src/engine/cartInsights.js'
import { explainItem } from '../src/engine/explanationEngine.js'
import { applyDiscounts } from '../src/engine/discountEngine.js'
import { validateCartRow, parsePrice } from '../src/validation/cartItemSchema.js'
import { checkFile } from '../src/components/CsvUploader.jsx'

const read = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')
const rules = parseRulesCSV(read('rules.csv')).data
const cart = parseCartCSV(read('cart.csv')).data
const r = (o) => ({ ruleId: 'X', appliesTo: null, stackable: false, minCartValue: null, thresholdInclusive: true, ...o })
const titles = (f) => f.map((x) => x.title)

describe('promotion audit (deterministic)', () => {
  it('raises nothing for the brief\'s sample rules and cart', () => {
    expect(auditPromotions(rules, cart)).toEqual([])
  })

  it('flags unusually deep and free-product discounts', () => {
    const f = auditPromotions([r({ ruleId: 'A', scope: 'brand', appliesTo: 'X', type: 'percentage', value: 60 }), r({ ruleId: 'B', scope: 'brand', appliesTo: 'Y', type: 'percentage', value: 100 })])
    expect(titles(f)).toEqual(['A is an unusually deep discount', 'B makes products free'])
  })

  it('flags duplicates, and warns that stackable duplicates double-discount', () => {
    const d = r({ scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true })
    const f = auditPromotions([{ ...d, ruleId: 'A' }, { ...d, ruleId: 'B', appliesTo: 'flipkart' }])
    expect(f[0]).toMatchObject({ severity: 'warning', title: 'A and B are duplicates' })
    expect(f[0].detail).toContain('twice')
  })

  it('flags a non-stackable rule that is always beaten by a same-target rule', () => {
    const f = auditPromotions([
      r({ ruleId: 'SMALL', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 100 }),
      r({ ruleId: 'BIG', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150 }),
    ])
    expect(titles(f)).toContain('SMALL can never apply')
  })

  it('flags rules matching nothing, with a near-miss hint', () => {
    const f = auditPromotions([...rules, r({ ruleId: 'RULE-05', scope: 'platform', appliesTo: 'Amazon', type: 'percentage', value: 5 })], cart)
    expect(f.find((x) => x.ruleIds[0] === 'RULE-05').detail).toContain('Did you mean "Amazon India"?')
  })

  it('flags a rule that is outbid on every item it matches', () => {
    const f = auditPromotions([...rules, r({ ruleId: 'RULE-05', scope: 'brand', appliesTo: 'LivSpace Pro', type: 'flat', value: 50 })], cart)
    // Ceramic Vase (Noon) has no other offer, so RULE-05 wins there → not flagged
    expect(f.map((x) => x.ruleIds[0])).not.toContain('RULE-05')
    // A ₹20 Amazon India rule loses to RULE-01 (15%) on all three Amazon items.
    const g = auditPromotions([...rules, r({ ruleId: 'RULE-06', scope: 'platform', appliesTo: 'Amazon India', type: 'flat', value: 20 })], cart)
    expect(titles(g)).toContain('RULE-06 is outbid on every matching item')
  })

  it('flags heavy stacking from real engine results', () => {
    const f = auditPromotions([...rules, r({ ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 45, stackable: true })], cart)
    expect(titles(f).some((t) => /Bed Sheet Set is \d+% off after stacking/.test(t))).toBe(true)
  })
})

describe('cart insights (from engine results only)', () => {
  it('summarises the sample cart', () => {
    const texts = getCartInsights(calculateCart(cart, rules)).map((i) => i.text)
    expect(texts).toContain('This cart saves ₹1,255 overall (19% of the original price).')
    expect(texts).toContain('Biggest product saving: Bed Sheet Set, ₹220 off (26%).')
    expect(texts.join(' ')).toContain('1 of 6 items has no active offer: Ceramic Vase (LivSpace Pro, Noon)')
    expect(texts.join(' ')).toContain('Cushion Cover: the Amazon India offer (₹195) beat the Natura Casa offer (₹150)')
    expect(texts.join(' ')).toContain('The cart offer contributes ₹593')
  })

  it('offers a next step below the threshold, computed by the engine', () => {
    const p = calculateCart([{ itemId: 'A', product: 'P', brand: 'B', platform: 'Noon', basePrice: 3817 }], rules)
    const t = getCartInsights(p).find((i) => i.kind === 'threshold')
    expect(t.text).toBe('Adding ₹183 unlocks the cart offer (10% off): ₹400 off at ₹4,000.')
  })

  it('returns nothing for an empty cart', () => {
    expect(getCartInsights(calculateCart([], rules))).toEqual([])
  })
})

describe('explanations list offers that do not apply', () => {
  it('ITEM-04 lists every item-level rule and why it does not cover it', () => {
    const p = calculateCart(cart, rules)
    const e = explainItem(p.items[3], rules)
    expect(e.notApplicable).toEqual([
      'RULE-01 · Amazon India offer (15% off): this product is sold on Noon',
      "RULE-02 · Natura Casa offer (₹150 off): this product's brand is LivSpace Pro",
      'RULE-03 · Flipkart offer (10% off): this product is sold on Noon',
    ])
  })
})

describe('numeric robustness', () => {
  const item = (basePrice) => ({ itemId: 'I', product: 'P', brand: 'B', platform: 'P1', basePrice })
  const pct = (value) => r({ ruleId: 'R', scope: 'platform', appliesTo: 'P1', type: 'percentage', value })

  it('rounds a discount of exactly ₹x.50 up', () => {
    expect(applyDiscounts(item(1015), [pct(10)]).steps[0].amount).toBe(102) // 101.5 → 102
    expect(applyDiscounts(item(1001), [pct(5)]).steps[0].amount).toBe(50) // 50.05 → 50
  })

  it('handles large prices exactly', () => {
    const res = applyDiscounts(item(1_000_000), [pct(15)])
    expect(res.finalPrice).toBe(850_000)
    expect(calculateCart([item(1_000_000), item(2_500_000)], [pct(15)]).finalTotal).toBe(2_975_000)
  })

  it('keeps paise on base prices and savings always add up', () => {
    const res = applyDiscounts(item(899.5), [pct(10)])
    expect(res.finalPrice).toBe(809.5)
    expect(res.basePrice - res.totalDiscount).toBe(res.finalPrice)
  })

  it('rejects zero, negative and non-numeric prices', () => {
    expect(parsePrice('0').ok).toBe(false)
    expect(parsePrice('-10').ok).toBe(false)
    expect(parsePrice('12abc').ok).toBe(false)
    expect(validateCartRow({ product: 'P', brand: 'B', platform: '', basePrice: '10' }).errors).toEqual(['missing platform'])
  })

  it('rejects invalid CSV rows with row numbers and keeps valid ones', () => {
    const { data, errors } = parseRulesCSV(
      'rule_id,scope,applies_to,type,value,stackable\nR1,platform,Flipkart,percentage,10,false\nR2,category,X,flat,10,false\nR3,brand,,flat,10,false\nR4,brand,X,percentage,150,false\nR1,brand,Y,flat,5,false'
    )
    expect(data.map((d) => d.ruleId)).toEqual(['R1'])
    expect(errors).toHaveLength(4)
    expect(errors[0]).toMatch(/^Row 3: Scope must be/)
    expect(errors[1]).toBe('Row 4: missing fields — applies_to')
    expect(errors[2]).toMatch(/^Row 5: 150% is outside/)
    expect(errors[3]).toBe('Row 6: duplicate rule_id "R1" — row skipped')
  })
})

describe('upload checks', () => {
  const file = (name, size) => ({ name, size })
  it('rejects wrong types, empty files and oversized files', () => {
    expect(checkFile(file('cart.exe', 10), { accept: '.pdf,application/pdf', maxBytes: 100 })).toContain("isn't a supported file")
    expect(checkFile(file('cart.pdf', 0), { accept: '.pdf', maxBytes: 100 })).toBe('cart.pdf is empty.')
    expect(checkFile(file('cart.pdf', 6 * 1024 * 1024), { accept: '.pdf', maxBytes: 5 * 1024 * 1024 })).toBe('cart.pdf is 6.0 MB; the limit is 5 MB.')
    expect(checkFile(file('CART.PDF', 10), { accept: '.pdf', maxBytes: 100 })).toBeNull()
  })
})
