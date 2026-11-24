/**
 * csvAdapter.js (formerly engine/csvParser.js)
 *
 * Converts raw CSV text into the normalized objects the discount engine
 * expects. Uses papaparse for reliable CSV parsing, then maps column names to
 * the internal data shapes and validates them with the shared schemas.
 *
 * Expected rules.csv columns:
 *   rule_id, scope, applies_to, type, value, stackable, [min_cart_value]
 *   (applies_to is left empty for scope "cart"; min_cart_value means
 *    "cart total is at least this much", as in the assignment brief)
 *
 * Expected cart.csv columns:
 *   item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { validateDiscountRule } from '../validation/discountRuleSchema.js'
import { validateCartRow } from '../validation/cartItemSchema.js'

function parseCsv(csvText) {
  return Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseRulesCSV(csvText) {
  const { data: rows, errors: parseErrors } = parseCsv(csvText)

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []
  const seenIds = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const scope = String(row.scope ?? '').trim().toLowerCase()
    const missing = []

    if (isBlank(row.rule_id)) missing.push('rule_id')
    if (isBlank(row.scope)) missing.push('scope')
    if (scope !== 'cart' && isBlank(row.applies_to)) missing.push('applies_to')
    if (isBlank(row.type)) missing.push('type')
    if (isBlank(row.value)) missing.push('value')
    if (isBlank(row.stackable)) missing.push('stackable')

    if (missing.length > 0) {
      errors.push(`Row ${rowNum}: missing fields — ${missing.join(', ')}`)
      return
    }

    const value = Number(String(row.value).trim())
    const stackableStr = String(row.stackable).trim().toLowerCase()
    const minCartValue = isBlank(row.min_cart_value) ? null : Number(String(row.min_cart_value).trim())

    const result = validateDiscountRule({
      ruleId: String(row.rule_id).trim(),
      scope,
      appliesTo: scope === 'cart' ? null : String(row.applies_to).trim(),
      type: String(row.type).trim().toLowerCase(),
      value,
      stackable: stackableStr === 'true' || stackableStr === '1' || stackableStr === 'yes',
      minCartValue,
      thresholdInclusive: true,
      source: 'csv',
    })

    if (!result.ok) {
      errors.push(`Row ${rowNum}: ${result.errors.join('; ')}`)
      return
    }
    if (seenIds.has(result.rule.ruleId.toLowerCase())) {
      errors.push(`Row ${rowNum}: duplicate rule_id "${result.rule.ruleId}" — row skipped`)
      return
    }
    seenIds.add(result.rule.ruleId.toLowerCase())
    data.push(result.rule)
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseCartCSV(csvText) {
  const { data: rows, errors: parseErrors } = parseCsv(csvText)

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []
  const seenIds = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2
    if (isBlank(row.item_id)) {
      errors.push(`Row ${rowNum}: missing fields — item_id`)
      return
    }
    const itemId = String(row.item_id).trim()
    const result = validateCartRow({
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    })
    if (!result.ok) {
      errors.push(`Row ${rowNum}: ${result.errors.join('; ')}`)
      return
    }
    if (seenIds.has(itemId.toLowerCase())) {
      errors.push(`Row ${rowNum}: duplicate item_id "${itemId}" — row skipped`)
      return
    }
    seenIds.add(itemId.toLowerCase())
    data.push({ itemId, ...result.item })
  })

  return { data, errors }
}
