/**
 * discountRuleSchema.js — the single definition of a valid DiscountRule.
 *
 * Used by every adapter (CSV, natural language) and by the confirmation form
 * after a user edits AI-parsed fields. Nothing reaches the engine without
 * passing through validateDiscountRule().
 */

import * as z from 'zod/v4'

export const SCOPES = ['brand', 'platform', 'cart']
export const TYPES = ['percentage', 'flat']

export const discountRuleSchema = z
  .object({
    ruleId: z.string().trim().min(1, 'Rule ID is required'),
    scope: z.enum(SCOPES, { error: 'Scope must be brand, platform or cart' }),
    appliesTo: z.string().trim().nullable(),
    type: z.enum(TYPES, { error: 'Type must be percentage or flat' }),
    value: z
      .number({ error: 'Discount value must be a number' })
      .refine(Number.isFinite, 'Discount value must be a number')
      .refine((v) => v > 0, 'Discount value must be greater than zero'),
    stackable: z.boolean({ error: 'Stackable must be yes or no' }),
    minCartValue: z
      .number({ error: 'Minimum cart value must be a number' })
      .refine(Number.isFinite, 'Minimum cart value must be a number')
      .refine((v) => v >= 0, 'Minimum cart value cannot be negative')
      .nullable(),
    thresholdInclusive: z.boolean(),
    source: z.enum(['csv', 'ai', 'manual']).optional(),
    sourceText: z.string().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.type === 'percentage' && rule.value > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `${rule.value}% is outside the supported range — a percentage discount must be between 0 and 100`,
      })
    }
    if (rule.scope !== 'cart' && !rule.appliesTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['appliesTo'],
        message: `A ${rule.scope} rule needs the ${rule.scope} name it applies to`,
      })
    }
    if (rule.scope !== 'cart' && rule.minCartValue !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['minCartValue'],
        message: 'A minimum cart value is only supported on cart-level rules',
      })
    }
  })

/**
 * Validates and normalizes a candidate rule.
 * @returns {{ ok: true, rule: DiscountRule } | { ok: false, errors: string[] }}
 */
export function validateDiscountRule(candidate) {
  const input = {
    thresholdInclusive: true,
    minCartValue: null,
    ...candidate,
  }
  if (input.scope === 'cart') input.appliesTo = null
  if (typeof input.appliesTo === 'string') input.appliesTo = input.appliesTo.trim()

  const result = discountRuleSchema.safeParse(input)
  if (!result.success) {
    return { ok: false, errors: [...new Set(result.error.issues.map((i) => i.message))] }
  }
  return { ok: true, rule: result.data }
}

/** Two rules that would behave identically in the engine. */
export function isSameRule(a, b) {
  const norm = (s) => (s ?? '').trim().toLowerCase()
  return (
    a.scope === b.scope &&
    norm(a.appliesTo) === norm(b.appliesTo) &&
    a.type === b.type &&
    a.value === b.value &&
    a.stackable === b.stackable &&
    (a.minCartValue ?? null) === (b.minCartValue ?? null) &&
    (a.scope !== 'cart' || (a.thresholdInclusive ?? true) === (b.thresholdInclusive ?? true))
  )
}

/** Next free RULE-NN id. */
export function nextRuleId(rules) {
  const max = rules.reduce((m, r) => {
    const n = /^RULE-(\d+)$/i.exec(r.ruleId)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `RULE-${String(max + 1).padStart(2, '0')}`
}
