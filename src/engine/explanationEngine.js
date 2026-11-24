/**
 * explanationEngine.js
 *
 * Turns engine results into the sentences a customer reads at checkout.
 * Every number here comes from the DiscountResult / PricingResult — the UI
 * never computes or invents savings on its own.
 */

import { formatINR, round2 } from '../utils/money.js'

/** "Amazon India offer", "Natura Casa offer", "Cart offer" */
export function offerName(rule) {
  if (rule.scope === 'cart') return 'Cart offer'
  return `${rule.appliesTo} offer`
}

/** "15% off", "₹150 off" */
export function offerValue(rule) {
  return rule.type === 'percentage' ? `${rule.value}% off` : `${formatINR(rule.value)} off`
}

/** "15% off everything on Amazon India" — full description of a rule. */
export function describeRule(rule) {
  const value = offerValue(rule)
  let target
  if (rule.scope === 'brand') target = `${rule.appliesTo} products`
  else if (rule.scope === 'platform') target = `everything on ${rule.appliesTo}`
  else target = 'the entire cart'
  let condition = ''
  if (rule.scope === 'cart' && rule.minCartValue !== null && rule.minCartValue !== undefined) {
    condition = rule.thresholdInclusive === false
      ? ` when the cart total is more than ${formatINR(rule.minCartValue)}`
      : ` when the cart total is at least ${formatINR(rule.minCartValue)}`
  }
  const stack = rule.stackable ? ', stackable with other offers' : ''
  return `${value} ${target}${condition}${stack}`
}

const NO_OFFER_DETAIL = 'This product is currently not eligible for any active discount.'

/**
 * @returns {{
 *   label: string,          one-line offer label
 *   summary: string,        why this price
 *   lines: {text: string, amount: number|null}[],
 *   alternatives: string[], competing offers that lost and by how much
 *   technical: string[],    rule IDs and exact maths
 *   notApplicable: string[], active item rules that don't cover this product, and why
 * }}
 */
export function explainItem(result, activeRules = []) {
  return { ...explainApplied(result), notApplicable: explainNotApplicable(result, activeRules) }
}

/** "Flipkart offer (10% off): this item is sold on Amazon India" */
export function explainNotApplicable(result, activeRules) {
  const norm = (s) => String(s ?? '').trim().toLowerCase()
  return activeRules
    .filter((r) => r.scope === 'brand' || r.scope === 'platform')
    .filter((r) => (r.scope === 'brand' ? norm(r.appliesTo) !== norm(result.brand) : norm(r.appliesTo) !== norm(result.platform)))
    .map((r) =>
      r.scope === 'brand'
        ? `${r.ruleId} · ${offerName(r)} (${offerValue(r)}): this product's brand is ${result.brand}`
        : `${r.ruleId} · ${offerName(r)} (${offerValue(r)}): this product is sold on ${result.platform}`
    )
}

function explainApplied(result) {
  if (result.steps.length === 0) {
    return {
      label: 'No offers available',
      summary: `No offers available. ${NO_OFFER_DETAIL}`,
      lines: [],
      alternatives: [],
      technical: ['No active rule matches this brand or platform.'],
    }
  }

  const best = result.steps.find((s) => s.role === 'best')
  const stacked = result.steps.filter((s) => s.role === 'stacked')

  const label = result.steps.map((s) => `${offerName(s.rule)}: ${offerValue(s.rule)}`).join(' + ')

  const lines = result.steps.map((s) => ({
    text:
      s.role === 'stacked' && best
        ? `${offerName(s.rule)} (${offerValue(s.rule)}, stacks on top) on ${formatINR(s.priceBefore)}`
        : `${offerName(s.rule)} (${offerValue(s.rule)}) on ${formatINR(s.priceBefore)}`,
    amount: s.amount,
  }))

  let summary
  const competitors = [...result.competingOffers].sort((a, b) => b.amount - a.amount)
  if (best && competitors.length > 0) {
    const runnerUp = competitors[0]
    const diff = round2(best.amount - runnerUp.amount)
    summary =
      diff > 0
        ? `You saved ${formatINR(best.amount)} with the ${offerName(best.rule)}, which is ${formatINR(diff)} more than the ${offerName(runnerUp.rule)} (${formatINR(runnerUp.amount)}).`
        : `The ${offerName(best.rule)} and the ${offerName(runnerUp.rule)} both save ${formatINR(best.amount)}; only one of them can apply, so the ${offerName(best.rule)} was used.`
  } else if (best) {
    summary = `You saved ${formatINR(best.amount)} with the ${offerName(best.rule)} (${offerValue(best.rule)}).`
  } else {
    summary = `You saved ${formatINR(result.totalDiscount)} with the ${stacked.map((s) => offerName(s.rule)).join(' and ')}.`
  }
  if (best && stacked.length > 0) {
    summary += ` ${stacked
      .map((s) => `The ${offerName(s.rule)} can be combined, so it took a further ${formatINR(s.amount)} off.`)
      .join(' ')}`
  }

  const alternatives = competitors.map(
    (c) => `${offerName(c.rule)} (${offerValue(c.rule)}) would have saved ${formatINR(c.amount)} — not applied, because only the best non-stackable offer can be used.`
  )

  const technical = [
    ...result.steps.map((s) => {
      const maths =
        s.rule.type === 'percentage'
          ? `${s.rule.value}% × ${formatINR(s.priceBefore)} = ${formatINR(s.exactAmount)}${s.exactAmount !== s.amount ? ` → rounded to ${formatINR(s.amount)}` : ''}`
          : `flat ${formatINR(s.amount)}`
      return `${s.ruleId} (${s.rule.scope}, ${s.rule.stackable ? 'stackable' : 'non-stackable'}): ${maths}`
    }),
    ...result.competingOffers.map((c) => `${c.ruleId}: matched but not applied (would save ${formatINR(c.amount)})`),
  ]

  return { label, summary, lines, alternatives, technical }
}

/** "Cart offer: 10% off — ₹593 saved" */
export function explainCartOffer(offer) {
  return {
    label: `Cart offer: ${offerValue(offer.rule)} — ${formatINR(offer.amount)} saved`,
    detail:
      offer.rule.minCartValue !== null && offer.rule.minCartValue !== undefined
        ? `Your cart total of ${formatINR(offer.totalBefore)} ${offer.rule.thresholdInclusive === false ? 'is more than' : 'meets the minimum of'} ${formatINR(offer.rule.minCartValue)}.`
        : 'Applies to every cart.',
    technical:
      offer.rule.type === 'percentage'
        ? `${offer.ruleId}: ${offer.rule.value}% × ${formatINR(offer.totalBefore)} = ${formatINR(offer.exactAmount)}${offer.exactAmount !== offer.amount ? ` → rounded to ${formatINR(offer.amount)}` : ''}`
        : `${offer.ruleId}: flat ${formatINR(offer.amount)}`,
  }
}

/** "You're just ₹60 away from unlocking 10% off your entire cart." */
export function explainNudge(nudge) {
  const what = `${offerValue(nudge.rule)} your entire cart`
  if (nudge.strict) {
    return nudge.remaining > 0
      ? `Add more than ${formatINR(nudge.remaining)} to unlock ${what} (cart total must be above ${formatINR(nudge.required)}).`
      : `Add any item to unlock ${what} — your cart total must be above ${formatINR(nudge.required)}.`
  }
  return `You're just ${formatINR(nudge.remaining)} away from unlocking ${what}.`
}
