/**
 * cartInsights.js — plain-language observations about a priced cart.
 *
 * Every number comes from the PricingResult. Suggestions only: nothing here
 * changes the cart or applies offers.
 */

import { getThresholdNudge } from './cartRuleEvaluator.js'
import { calculateDiscountAmount } from './discountEngine.js'
import { offerName, offerValue } from './explanationEngine.js'
import { formatINR, round2 } from '../utils/money.js'

/** @returns {{ kind: string, tone: 'positive'|'neutral'|'action', text: string }[]} */
export function getCartInsights(pricing) {
  if (!pricing || pricing.items.length === 0) return []
  const out = []

  // What can the customer do next? (threshold)
  const nudge = getThresholdNudge(pricing)
  if (nudge) {
    const potential = calculateDiscountAmount(nudge.required, nudge.rule)
    out.push({
      kind: 'threshold',
      tone: 'action',
      text: nudge.strict
        ? `Going above ${formatINR(nudge.required)} unlocks the cart offer (${offerValue(nudge.rule)}): at least ${formatINR(potential)} off at that total.`
        : `Adding ${formatINR(nudge.remaining)} unlocks the cart offer (${offerValue(nudge.rule)}): ${formatINR(potential)} off at ${formatINR(nudge.required)}.`,
    })
  }

  // Overall savings
  if (pricing.totalSavings > 0) {
    const pct = Math.round((pricing.totalSavings / pricing.originalTotal) * 100)
    out.push({ kind: 'savings', tone: 'positive', text: `This cart saves ${formatINR(pricing.totalSavings)} overall (${pct}% of the original price).` })
  }

  // Biggest saving
  const best = [...pricing.items].sort((a, b) => b.totalDiscount - a.totalDiscount)[0]
  if (best && best.totalDiscount > 0) {
    out.push({
      kind: 'best',
      tone: 'positive',
      text: `Biggest product saving: ${best.product}, ${formatINR(best.totalDiscount)} off (${Math.round((best.totalDiscount / best.basePrice) * 100)}%).`,
    })
  }

  // Items with no offer
  const none = pricing.items.filter((i) => i.steps.length === 0)
  if (none.length > 0) {
    const names = none.map((i) => `${i.product} (${i.brand}, ${i.platform})`)
    out.push({
      kind: 'no-offer',
      tone: 'neutral',
      text: `${none.length} of ${pricing.items.length} item${pricing.items.length > 1 ? 's' : ''} ${none.length === 1 ? 'has' : 'have'} no active offer: ${names.join(', ')}. No brand or platform offer currently covers ${none.length > 1 ? 'them' : 'it'}.`,
    })
  }

  // Offers that were outbid
  const outbid = pricing.items.filter((i) => i.competingOffers.length > 0)
  for (const item of outbid) {
    const win = item.steps.find((s) => s.role === 'best')
    const lose = [...item.competingOffers].sort((a, b) => b.amount - a.amount)[0]
    out.push({
      kind: 'conflict',
      tone: 'neutral',
      text: `${item.product}: the ${offerName(win.rule)} (${formatINR(win.amount)}) beat the ${offerName(lose.rule)} (${formatINR(lose.amount)}). Only one non-stackable offer can apply.`,
    })
  }

  // Cart offer share
  if (pricing.cartDiscount > 0 && pricing.totalSavings > 0) {
    out.push({
      kind: 'cart-offer',
      tone: 'positive',
      text: `The cart offer contributes ${formatINR(pricing.cartDiscount)}, ${Math.round(round2(pricing.cartDiscount / pricing.totalSavings) * 100)}% of total savings.`,
    })
  }

  return out
}
