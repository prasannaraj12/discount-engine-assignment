/**
 * discountEngine.js
 *
 * Pure item-level discount calculation logic. No UI, no I/O, no parsing
 * libraries, no LLM SDKs. All functions take plain objects and return plain
 * objects. Every input path (CSV, PDF, natural language) is converted into
 * these shapes by an adapter before it reaches the engine.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:      string       — e.g. "RULE-01"
 *   scope:       "brand" | "platform" | "cart"
 *   appliesTo:   string|null  — e.g. "Natura Casa", "Amazon India" (null for cart rules)
 *   type:        "percentage" | "flat"
 *   value:       number       — percentage as number (15 = 15%), flat in rupees
 *   stackable:   boolean
 *   minCartValue?:       number|null — cart rules only
 *   thresholdInclusive?: boolean     — cart rules only: true = "at least", false = "more than"
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId, product, brand, platform, basePrice
 *   finalPrice:     number
 *   totalDiscount:  number
 *   appliedRules:   string[]   — rule IDs, in application order
 *   skippedRules:   string[]   — matching non-stackable rules that lost
 *   reasoning:      string     — short customer-readable label
 *   steps:          AppliedStep[]    — what was applied, with amounts (for explanations)
 *   competingOffers: CompetingOffer[] — non-stackable offers that lost, with their saving
 * }
 *
 * Cart-level rules (scope "cart") never match an individual item; they are
 * evaluated afterwards by cartRuleEvaluator.js.
 */

import { round2, roundRupee } from '../utils/money.js'

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * A discount can never exceed the price it is applied to (no negative prices).
 */
export function calculateDiscountAmount(price, rule) {
  if (price <= 0) return 0
  if (rule.type === 'percentage') {
    return Math.min(roundRupee((price * rule.value) / 100), price)
  }
  if (rule.type === 'flat') {
    return round2(Math.min(rule.value, price))
  }
  return 0
}

/**
 * Builds the short customer-facing label for an applied rule.
 */
function ruleToReasoning(rule) {
  const scopeLabel = rule.scope === 'brand' ? 'Brand' : 'Platform'
  if (rule.type === 'percentage') {
    return `${scopeLabel} offer: ${rule.value}% off`
  }
  if (rule.type === 'flat') {
    return `${scopeLabel} offer: Rs.${rule.value} off`
  }
  return `${scopeLabel} offer applied`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest discount
 *      on the base price (ties keep the rule listed first).
 *   3. Apply any stackable rules on top of that price, in rule order.
 *      If no non-stackable rule matched, stackable rules apply on their own.
 *   4. Build the reasoning string from what was applied.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: 'No offers available',
      steps: [],
      competingOffers: [],
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest saving.
  // Array.prototype.sort is stable, so equal savings keep rule order.
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) -
        calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  // Apply winner first, then stack on top
  let price = item.basePrice
  const appliedRules = []
  const reasoningParts = []
  const steps = []

  const applyStep = (rule, role) => {
    const amount = calculateDiscountAmount(price, rule)
    const priceBefore = price
    price = round2(price - amount)
    appliedRules.push(rule.ruleId)
    reasoningParts.push(ruleToReasoning(rule))
    steps.push({
      ruleId: rule.ruleId,
      rule,
      role, // 'best' (winning non-stackable) | 'stacked'
      amount,
      exactAmount: rule.type === 'percentage' ? round2((priceBefore * rule.value) / 100) : amount,
      priceBefore,
      priceAfter: price,
    })
  }

  if (winner) applyStep(winner, 'best')
  for (const rule of stackable) applyStep(rule, 'stacked')

  const finalPrice = round2(price)

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: round2(item.basePrice - finalPrice),
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: reasoningParts.join(' + '),
    steps,
    competingOffers: skipped.map((rule) => ({
      ruleId: rule.ruleId,
      rule,
      amount: calculateDiscountAmount(item.basePrice, rule),
    })),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return round2(results.reduce((sum, r) => sum + r.finalPrice, 0))
}
