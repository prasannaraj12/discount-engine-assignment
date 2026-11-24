import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractTextItems } from '../src/services/pdfExtractor.js'
import { parseCartFromTextItems, buildItems } from '../src/adapters/pdfAdapter.js'
import { parseRulesCSV } from '../src/adapters/csvAdapter.js'
import { calculateCart } from '../src/engine/pricing.js'

const read = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url))
const fromPdf = async (f) => parseCartFromTextItems(await extractTextItems(pdfjs, read(f)))
const rules = parseRulesCSV(read('rules.csv').toString()).data

describe('PDF cart extraction (real pdf.js on generated sample files)', () => {
  it('extracts the brief\'s cart and reproduces the expected totals', async () => {
    const r = await fromPdf('cart.pdf')
    expect(r.error).toBeNull()
    expect(r.rows.every((row) => row.status === 'valid')).toBe(true)
    expect(r.items).toHaveLength(6)
    expect(r.items[0]).toEqual({ itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 })
    const p = calculateCart(r.items, rules)
    expect(p.items.map((i) => i.finalPrice)).toEqual([1104, 629, 509, 2499, 382, 809])
    expect(p.finalTotal).toBe(5339)
  })

  it('reports every malformed row instead of dropping it silently', async () => {
    const r = await fromPdf('cart-malformed.pdf')
    const msg = Object.fromEntries(r.rows.map((row) => [row.rowNumber, row]))
    expect(msg[1].status).toBe('valid')
    expect(msg[2].message).toBe('Row 2 skipped — missing base price')
    expect(msg[3].message).toBe('Row 3 skipped — missing product name')
    expect(msg[4].message).toContain('unreadable base price "Rs.2,4O9"')
    expect(msg[5].message).toContain('negative base price')
    expect(msg[6]).toMatchObject({ status: 'duplicate', duplicateOf: 1 })
    expect(msg[7].message).toBe('Row 7 skipped — missing platform')
    expect(msg[8].status).toBe('valid')
    expect(r.ignored[0]).toMatch(/^Total/)
    expect(buildItems(r.rows, { includeDuplicates: false })).toHaveLength(2)
    expect(buildItems(r.rows, { includeDuplicates: true })).toHaveLength(3)
  })

  it('rejects files that are not PDFs', async () => {
    await expect(extractTextItems(pdfjs, new TextEncoder().encode('not a pdf'))).rejects.toThrow('could not be read as a PDF')
  })
})

describe('PDF table parsing edge cases', () => {
  const t = (str, x, y) => ({ str, x, y, page: 1 })
  const header = [t('Product', 50, 700), t('Brand', 190, 700), t('Platform', 310, 700), t('Base', 430, 700), t('Price', 455, 700)]

  it('treats an empty / image-only PDF as unsupported (scanned)', () => {
    expect(parseCartFromTextItems([]).error).toContain('scanned')
    expect(parseCartFromTextItems([t('  ', 1, 1)]).error).toContain('OCR')
  })

  it('requires the header row', () => {
    expect(parseCartFromTextItems([t('Cushion Cover', 50, 680)]).error).toContain('Product, Brand, Platform and Base Price')
  })

  it('reports a header with no rows', () => {
    expect(parseCartFromTextItems(header).error).toContain('no product rows')
  })

  it('handles split header words, multi-word cells and right-aligned prices', () => {
    const r = parseCartFromTextItems([
      ...header,
      t('Desk', 50, 680), t('Organiser', 75, 680), t('Nordic Basics', 190, 680), t('Flipkart', 310, 680), t('₹899.50', 422, 680),
    ])
    expect(r.items).toEqual([{ itemId: 'ITEM-01', product: 'Desk Organiser', brand: 'Nordic Basics', platform: 'Flipkart', basePrice: 899.5 }])
  })

  it('splits a single wide-gapped text run into columns', () => {
    const r = parseCartFromTextItems([...header, t('Wall Shelf    LivSpace Pro    Amazon India    Rs.599', 50, 680)])
    expect(r.items[0]).toMatchObject({ product: 'Wall Shelf', brand: 'LivSpace Pro', platform: 'Amazon India', basePrice: 599 })
  })
})
