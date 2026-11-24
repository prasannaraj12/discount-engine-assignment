/**
 * promotionAudit.js — deterministic health checks on the active rule set.
 *
 * Flags rules a merchant probably didn't intend: unusually deep discounts,
 * duplicates, rules that can never win, heavy stacking, and rules that match
 * nothing in the current cart. Checks only — it never changes rules or prices.
 * Item-specific checks use the engine's own results, never a re-calculation.
 */

import { calculateCart } from './pricing.js'
import { ruleMatchesItem } from './discountEngine.js'
import { describeRule } from './explanationEngine.js'
import { isSameRule } from './ruleIdentity.js'
import { formatINR, round2 } from '../utils/money.js'

const HIGH_PERCENT = 50
const HEAVY_STACK_SHARE = 0.5

const norm = (s) => String(s ?? '').trim().toLowerCase()

/**
 * @returns {{ severity: 'warning'|'info', ruleIds: string[], title: string, detail: string }[]}
 */
export function auditPromotions(rules, cartItems = []) {
  const findings = []
  const add = (severity, ruleIds, title, detail) => findings.push({ severity, ruleIds, title, detail })

  // 1. Unusually deep discounts (rule-level)
  for (const r of rules) {
    if (r.type === 'percentage' && r.value >= 100) {
      add('warning', [r.ruleId], `${r.ruleId} makes products free`, `${describeRule(r)}. Check this is intended.`)
    } else if (r.type === 'percentage' && r.value >= HIGH_PERCENT) {
      add('warning', [r.ruleId], `${r.ruleId} is an unusually deep discount`, `${r.value}% off is well above typical promotions. Check this is intended.`)
    }
  }

  // 2. Exact duplicates
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (isSameRule(rules[i], rules[j])) {
        add(
          'warning',
          [rules[i].ruleId, rules[j].ruleId],
          `${rules[i].ruleId} and ${rules[j].ruleId} are duplicates`,
          rules[i].stackable
            ? 'Both are stackable, so customers get this discount twice.'
            : 'Only one can ever apply; remove one to avoid confusion.'
        )
      }
    }
  }

  // 3. Same target, same type, non-stackable: the smaller one can never win anywhere
  for (const a of rules) {
    for (const b of rules) {
      if (a === b || a.stackable || b.stackable || a.scope === 'cart' || b.scope === 'cart') continue
      if (a.scope !== b.scope || norm(a.appliesTo) !== norm(b.appliesTo) || a.type !== b.type) continue
      if (a.value < b.value) {
        add('warning', [a.ruleId, b.ruleId], `${a.ruleId} can never apply`, `${b.ruleId} gives a bigger discount to every ${a.appliesTo} item, and neither stacks.`)
      }
    }
  }

  if (cartItems.length === 0) return findings
  const pricing = calculateCart(cartItems, rules)

  // 4. Item rules that match nothing in the cart (with a near-miss hint)
  for (const r of rules.filter((r) => r.scope !== 'cart')) {
    if (cartItems.some((i) => ruleMatchesItem(i, r))) continue
    const field = r.scope === 'brand' ? 'brand' : 'platform'
    const names = [...new Set(cartItems.map((i) => i[field]))]
    const near = names.find((n) => norm(n).includes(norm(r.appliesTo)) || norm(r.appliesTo).includes(norm(n)))
    add(
      'info',
      [r.ruleId],
      `${r.ruleId} matches nothing in this cart`,
      near
        ? `No item has ${field} "${r.appliesTo}". Did you mean "${near}"? Names must match exactly (case is ignored).`
        : `No item in the current cart has ${field} "${r.appliesTo}".`
    )
  }

  // 5. Non-stackable item rules that match but always lose in this cart
  for (const r of rules.filter((r) => r.scope !== 'cart' && !r.stackable)) {
    const matched = pricing.items.filter((i) => ruleMatchesItem(i, r))
    if (matched.length === 0) continue
    const losses = matched.filter((i) => i.competingOffers.some((c) => c.ruleId === r.ruleId))
    if (losses.length === matched.length) {
      const first = losses[0]
      const winner = first.steps.find((s) => s.role === 'best')
      add(
        'info',
        [r.ruleId],
        `${r.ruleId} is outbid on every matching item`,
        `It matches ${matched.length} item${matched.length > 1 ? 's' : ''} but a bigger offer wins each time (e.g. ${first.product}: ${winner.ruleId} saves ${formatINR(winner.amount)}).`
      )
    }
  }

  // 6. Heavy stacking: an item losing half or more of its price
  for (const item of pricing.items) {
    if (item.basePrice > 0 && item.totalDiscount / item.basePrice >= HEAVY_STACK_SHARE && item.steps.length > 1) {
      add(
        'warning',
        item.steps.map((s) => s.ruleId),
        `${item.product} is ${Math.round((item.totalDiscount / item.basePrice) * 100)}% off after stacking`,
        `${item.steps.map((s) => s.ruleId).join(' + ')} combine to ${formatINR(item.totalDiscount)} off ${formatINR(item.basePrice)}. Check the stacking is intended.`
      )
    }
  }

  // 7. Cart offers stacking on top of already-discounted items
  if (pricing.cartOffers.length > 1) {
    add(
      'info',
      pricing.cartOffers.map((o) => o.ruleId),
      'Several cart offers apply together',
      `${pricing.cartOffers.map((o) => o.ruleId).join(' + ')} together take ${formatINR(round2(pricing.cartDiscount))} off the cart.`
    )
  }

  return findings
}
