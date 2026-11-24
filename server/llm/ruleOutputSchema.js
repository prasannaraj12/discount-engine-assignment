/**
 * The JSON contract the LLM must return. Used twice:
 *   1. as the structured-output format sent to the model, and
 *   2. to re-validate whatever comes back before it leaves the server.
 *
 * Range checks (0–100%, positive amounts, required applies_to…) deliberately
 * live in src/validation/discountRuleSchema.js, not here: the model is told to
 * report what the user said, and the deterministic validator decides whether
 * it is allowed.
 */
import * as z from 'zod/v4'

export const llmRuleSchema = z.object({
  status: z.enum(['ok', 'needs_clarification', 'unsupported']),
  interpretation: z.string(),
  clarification: z.string().nullable(),
  missing_fields: z.array(z.string()),
  rule: z
    .object({
      scope: z.enum(['brand', 'platform', 'cart']),
      applies_to: z.string().nullable(),
      type: z.enum(['percentage', 'flat']),
      value: z.number(),
      stackable: z.boolean(),
      min_cart_value: z.number().nullable(),
      threshold_inclusive: z.boolean().nullable(),
    })
    .nullable(),
})
