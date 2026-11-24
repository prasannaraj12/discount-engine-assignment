/**
 * cartItemSchema.js — what every cart row (CSV or PDF) must satisfy.
 * Returns human-readable reasons rather than throwing, so adapters can show
 * "Row 3 skipped — missing base price" instead of silently dropping data.
 */

import { round2 } from '../utils/money.js'

/**
 * Parses "Rs.1,299", "₹1,299.50", "INR 899", "1299".
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function parsePrice(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, reason: 'missing base price' }
  }
  const cleaned = String(raw)
    .replace(/rs\.?|inr|₹/gi, '')
    .replace(/[,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, reason: `unreadable base price "${String(raw).trim()}"` }
  }
  const value = Number(cleaned)
  if (value < 0) return { ok: false, reason: `negative base price "${String(raw).trim()}"` }
  if (value === 0) return { ok: false, reason: 'base price must be greater than zero' }
  return { ok: true, value: round2(value) }
}

/**
 * @param {{product?: string, brand?: string, platform?: string, basePrice?: unknown}} row
 * @returns {{ ok: true, item: Omit<CartItem,'itemId'> } | { ok: false, errors: string[] }}
 */
export function validateCartRow(row) {
  const errors = []
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const product = text(row.product)
  const brand = text(row.brand)
  const platform = text(row.platform)

  const missing = []
  if (!product) missing.push('product name')
  if (!brand) missing.push('brand')
  if (!platform) missing.push('platform')
  if (missing.length) errors.push(`missing ${missing.join(', ')}`)

  const price = parsePrice(row.basePrice)
  if (!price.ok) errors.push(price.reason)

  if (errors.length) return { ok: false, errors }
  return { ok: true, item: { product, brand, platform, basePrice: price.value } }
}

export function itemKey(item) {
  return [item.product, item.brand, item.platform, item.basePrice]
    .map((v) => String(v).trim().toLowerCase())
    .join('|')
}
