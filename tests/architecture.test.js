import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { calculateCart } from '../src/engine/pricing.js'
import { validateCartRow } from '../src/validation/cartItemSchema.js'

describe('engine is independent of input methods', () => {
  it('engine files import no parsing or LLM libraries', () => {
    const dir = new URL('../src/engine/', import.meta.url)
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      expect(src, f).not.toMatch(/from ['"](papaparse|pdfjs-dist|@anthropic-ai\/sdk|zod)/)
      expect(src, f).not.toMatch(/\.\.\/(adapters|services|validation)\//)
    }
  })

  it('a brand-new input adapter (JSON order export) works without touching the engine', () => {
    // A third input mode is just: raw data → validated CartItem[] → calculateCart.
    const jsonAdapter = (json) =>
      JSON.parse(json).lines.flatMap((l, i) => {
        const r = validateCartRow({ product: l.title, brand: l.vendor, platform: l.channel, basePrice: l.price })
        return r.ok ? [{ itemId: `ITEM-${i + 1}`, ...r.item }] : []
      })
    const items = jsonAdapter(JSON.stringify({ lines: [{ title: 'Cushion Cover', vendor: 'Natura Casa', channel: 'Amazon India', price: '₹1,299' }] }))
    const rules = [{ ruleId: 'RULE-01', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: null, thresholdInclusive: true }]
    expect(calculateCart(items, rules).finalTotal).toBe(1104)
  })
})
