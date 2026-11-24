/**
 * ruleImpact.js — "what would this new rule do to the current cart?"
 *
 * Runs the real engine twice (without / with the candidate) and explains the
 * difference, including conflicts: where the candidate loses to, or replaces,
 * an existing offer. Used for the preview before a rule is confirmed.
 */

import { calculateCart, diffPricing } from './pricing.js'
import { ruleMatchesItem } from './discountEngine.js'
import { meetsThreshold } from './cartRuleEvaluator.js'
import { offerName } from './explanationEngine.js'
import { formatINR } from '../utils/money.js'

export function previewRuleImpact(cartItems, rules, candidate) {
  const before = calculateCart(cartItems, rules)
  const after = calculateCart(cartItems, [...rules, candidate])
  const diff = diffPricing(before, after)
  const notes = []

  if (candidate.scope !== 'cart') {
    const matched = cartItems.filter((i) => ruleMatchesItem(i, candidate))
    const beforeById = new Map(before.items.map((r) => [r.itemId, r]))
    for (const res of after.items.filter((r) => matched.some((m) => m.itemId === r.itemId))) {
      const prev = beforeById.get(res.itemId)
      const lost = res.competingOffers.find((c) => c.ruleId === candidate.ruleId)
      const won = res.steps.find((s) => s.ruleId === candidate.ruleId && s.role === 'best')
      if (lost) {
        const winner = res.steps.find((s) => s.role === 'best')
        notes.push(
          `${res.product}: the existing ${offerName(winner.rule)} saves ${formatINR(winner.amount)}, more than this rule's ${formatINR(lost.amount)}, so it stays applied.`
        )
      } else if (won) {
        const replaced = prev.steps.find((s) => s.role === 'best')
        notes.push(
          replaced
            ? `${res.product}: this rule saves ${formatINR(won.amount)} and replaces the ${offerName(replaced.rule)} (${formatINR(replaced.amount)}).`
            : `${res.product}: this rule saves ${formatINR(won.amount)}.`
        )
      } else {
        const step = res.steps.find((s) => s.ruleId === candidate.ruleId)
        if (step) notes.push(`${res.product}: stacks on top for a further ${formatINR(step.amount)} off.`)
      }
    }
    return { before, after, diff, matchedCount: matched.length, notes: withCartNote(notes, diff, before, after) }
  }

  // Cart-level candidate
  const applied = after.cartOffers.find((o) => o.ruleId === candidate.ruleId)
  if (cartItems.length === 0) {
    notes.push('The cart is empty, so there is nothing to apply this offer to yet.')
  } else if (!meetsThreshold(after.subtotal, candidate)) {
    notes.push(
      `The cart total (${formatINR(after.subtotal)}) is ${candidate.thresholdInclusive === false ? 'not above' : 'below'} ${formatINR(candidate.minCartValue)}, so this offer won't apply to the current cart.`
    )
  } else if (!applied) {
    const winner = after.cartOffers.find((o) => o.role === 'best')
    const mine = after.competingCartOffers.find((c) => c.ruleId === candidate.ruleId)
    notes.push(
      `The existing ${winner.ruleId} cart offer saves ${formatINR(winner.amount)}, more than this offer's ${formatINR(mine?.amount ?? 0)}, so it stays applied.`
    )
  } else {
    const replaced = before.cartOffers.find((o) => o.role === 'best')
    notes.push(
      replaced && applied.role === 'best'
        ? `This offer saves ${formatINR(applied.amount)} on the cart and replaces ${replaced.ruleId} (${formatINR(replaced.amount)}).`
        : `This offer saves ${formatINR(applied.amount)} on the cart.`
    )
  }
  return { before, after, diff, matchedCount: applied ? cartItems.length : 0, notes }
}

function withCartNote(notes, diff, before, after) {
  if (diff.cartOfferChanged && before.cartDiscount > 0 && after.cartDiscount > 0) {
    notes.push(
      `The cart offer adjusts from ${formatINR(before.cartDiscount)} to ${formatINR(after.cartDiscount)} because it's calculated on the lower item total.`
    )
  } else if (diff.cartOfferChanged && after.cartDiscount === 0) {
    notes.push(`The lower item total drops the cart below the cart-offer threshold, so the ${formatINR(before.cartDiscount)} cart discount no longer applies.`)
  }
  return notes
}
