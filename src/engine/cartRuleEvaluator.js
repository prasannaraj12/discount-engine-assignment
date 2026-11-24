/**
 * cartRuleEvaluator.js
 *
 * Cart-level offers ("10% off the entire cart when the total is at least
 * Rs.4,000"). Evaluated only after every item-level discount is applied,
 * against the sum of final item prices.
 *
 * Selection mirrors the item-level logic so the two never disagree:
 *   - among qualifying non-stackable cart rules, the largest saving wins;
 *   - qualifying stackable cart rules apply on top, on the reduced total.
 */

import { calculateDiscountAmount } from './discountEngine.js'
import { round2 } from '../utils/money.js'

export function isCartRule(rule) {
  return rule.scope === 'cart'
}

/** "at least" (inclusive, default) vs "more than" (strict). */
export function meetsThreshold(total, rule) {
  if (rule.minCartValue === null || rule.minCartValue === undefined) return true
  return rule.thresholdInclusive === false ? total > rule.minCartValue : total >= rule.minCartValue
}

/**
 * @param {number} subtotal  sum of final item prices
 * @param {DiscountRule[]} cartRules  rules with scope "cart"
 * @param {number} itemCount  an empty cart never qualifies for a cart offer
 */
export function evaluateCartRules(subtotal, cartRules, itemCount = 1) {
  const qualifying = itemCount > 0 ? cartRules.filter((r) => meetsThreshold(subtotal, r)) : []
  const notMet = cartRules
    .filter((r) => !qualifying.includes(r))
    .map((rule) => ({
      ruleId: rule.ruleId,
      rule,
      shortfall: round2(Math.max(0, (rule.minCartValue ?? 0) - subtotal)),
    }))

  const nonStackable = qualifying.filter((r) => !r.stackable)
  const stackable = qualifying.filter((r) => r.stackable)

  const sorted = [...nonStackable].sort(
    (a, b) => calculateDiscountAmount(subtotal, b) - calculateDiscountAmount(subtotal, a)
  )
  const winner = sorted[0] ?? null
  const competing = sorted.slice(1).map((rule) => ({
    ruleId: rule.ruleId,
    rule,
    amount: calculateDiscountAmount(subtotal, rule),
  }))

  let total = subtotal
  const applied = []
  for (const rule of [winner, ...stackable].filter(Boolean)) {
    const amount = calculateDiscountAmount(total, rule)
    applied.push({
      ruleId: rule.ruleId,
      rule,
      role: rule === winner ? 'best' : 'stacked',
      amount,
      exactAmount: rule.type === 'percentage' ? round2((total * rule.value) / 100) : amount,
      totalBefore: total,
      totalAfter: round2(total - amount),
    })
    total = round2(total - amount)
  }

  return { applied, notMet, competing, finalTotal: total }
}

/**
 * "You're ₹60 away from unlocking 10% off your entire cart."
 * Shown only when the cart has items, no cart offer is applied yet, and an
 * offer with a threshold is still out of reach. Picks the nearest threshold.
 */
export function getThresholdNudge(pricing) {
  if (!pricing || pricing.items.length === 0) return null
  if (pricing.cartOffers.length > 0) return null

  const candidates = pricing.unmetCartOffers
    .filter((o) => o.rule.minCartValue !== null && o.rule.minCartValue !== undefined)
    .sort((a, b) => a.rule.minCartValue - b.rule.minCartValue)
  const next = candidates[0]
  if (!next) return null

  const required = next.rule.minCartValue
  const strict = next.rule.thresholdInclusive === false
  return {
    rule: next.rule,
    current: pricing.subtotal,
    required,
    remaining: round2(Math.max(0, required - pricing.subtotal)),
    strict, // strict: the customer must go *above* `required`
    progress: Math.min(1, Math.max(0, pricing.subtotal / required)),
  }
}
