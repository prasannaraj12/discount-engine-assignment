/**
 * money.js — currency helpers shared by the engine and the UI.
 *
 * Rounding policy (see README → Engineering Decisions):
 *   - Each individual discount amount is rounded to the nearest whole rupee
 *     at the moment it is applied (half rounds up). This matches the
 *     assignment's worked examples (Rs.194.85 → Rs.195 saving).
 *   - Prices themselves are kept to the paise (2 decimals); round2 only
 *     removes floating-point noise such as 0.1 + 0.2.
 */

/** Removes floating-point noise; keeps paise. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Rounds a discount amount to a whole rupee (half up). */
export function roundRupee(n) {
  return Math.round(round2(n))
}

/** ₹1,299 / ₹194.85 — Indian digit grouping, paise only when present. */
export function formatINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const value = round2(n)
  const hasPaise = Math.abs(value % 1) > 0
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
