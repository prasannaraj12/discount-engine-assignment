/**
 * pricing.js — the single entry point every input path uses.
 *
 *   calculateCart(CartItem[], DiscountRule[]) → PricingResult
 *
 * Splits rules into item-level and cart-level, runs the existing item engine,
 * then the cart evaluator. Adapters (CSV, PDF, natural language, or any future
 * one) only need to produce normalized CartItem[] / DiscountRule[].
 */

import { processCart, cartTotal } from './discountEngine.js'
import { evaluateCartRules, isCartRule } from './cartRuleEvaluator.js'
import { round2 } from '../utils/money.js'

export function calculateCart(cartItems, rules) {
  const itemRules = rules.filter((r) => !isCartRule(r))
  const cartRules = rules.filter(isCartRule)

  const items = processCart(cartItems, itemRules)
  const originalTotal = round2(items.reduce((s, r) => s + r.basePrice, 0))
  const subtotal = cartTotal(items) // cart total before cart offer
  const cart = evaluateCartRules(subtotal, cartRules, items.length)
  const cartDiscount = round2(cart.applied.reduce((s, o) => s + o.amount, 0))

  return {
    items,
    originalTotal,
    itemDiscount: round2(originalTotal - subtotal),
    subtotal,
    cartOffers: cart.applied,
    competingCartOffers: cart.competing,
    unmetCartOffers: cart.notMet,
    cartDiscount,
    finalTotal: cart.finalTotal,
    totalSavings: round2(originalTotal - cart.finalTotal),
  }
}

/**
 * Compares two pricing results for the same cart (e.g. before/after a new
 * rule). Only items whose final price actually changed are reported.
 */
export function diffPricing(before, after) {
  const beforeById = new Map(before.items.map((r) => [r.itemId, r]))
  const changedItems = after.items
    .filter((r) => {
      const prev = beforeById.get(r.itemId)
      return prev && prev.finalPrice !== r.finalPrice
    })
    .map((r) => {
      const prev = beforeById.get(r.itemId)
      return {
        itemId: r.itemId,
        product: r.product,
        before: prev.finalPrice,
        after: r.finalPrice,
        delta: round2(prev.finalPrice - r.finalPrice),
      }
    })

  return {
    previousTotal: before.finalTotal,
    updatedTotal: after.finalTotal,
    additionalSavings: round2(before.finalTotal - after.finalTotal),
    changedItems,
    cartOfferChanged: before.cartDiscount !== after.cartDiscount,
    cartDiscountBefore: before.cartDiscount,
    cartDiscountAfter: after.cartDiscount,
  }
}
