/**
 * naturalLanguageAdapter.js
 *
 * Converts the LLM's structured output into a normalized DiscountRule, and
 * runs deterministic cross-checks against the user's original wording.
 * The LLM only interprets language; this module and the shared schema decide
 * whether the result is allowed. Pricing stays in the engine.
 */

import { validateDiscountRule, isSameRule, nextRuleId } from '../validation/discountRuleSchema.js'
import { formatINR } from '../utils/money.js'

/** Editable form fields, in the engine's vocabulary. */
export function draftFromLlmRule(llmRule) {
  return {
    scope: llmRule.scope,
    appliesTo: llmRule.applies_to ?? '',
    type: llmRule.type,
    value: llmRule.value,
    stackable: llmRule.stackable,
    minCartValue: llmRule.scope === 'cart' ? llmRule.min_cart_value : null,
    thresholdInclusive: llmRule.threshold_inclusive,
  }
}

/** Every number written in the text: "Rs.5,000" → 5000, "12.5%" → 12.5, "5k" → 5000. */
export function numbersInText(text) {
  const out = []
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|lakh)?\b/gi
  let m
  while ((m = re.exec(text))) {
    let n = Number(m[1].replace(/,/g, ''))
    if (m[2]?.toLowerCase() === 'k') n *= 1000
    if (m[2]?.toLowerCase() === 'lakh') n *= 100000
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

const INCLUSIVE_WORDING = /\b(at least|minimum|min\.?|or more|and above|or above|and over|or over|upwards)\b|\d\s*\+/i
const STRICT_WORDING = /\b(above|more than|over|exceeds?|exceeding|greater than|beyond)\b/i
const STACK_WORDING = /\b(stack|stackable|stacks|combin\w*|on top|in addition|together with|plus other)\b/i

/** "inclusive" | "strict" | null — what the user's own words say. */
export function thresholdWording(text) {
  if (INCLUSIVE_WORDING.test(text)) return 'inclusive'
  if (STRICT_WORDING.test(text)) return 'strict'
  return null
}

/**
 * Deterministic checks of a (possibly user-edited) draft against the original
 * text and the current state. Returns human-readable warnings; they never
 * change the rule — the user decides.
 */
export function crossCheck(draft, { text, existingRules = [], cartItems = [] }) {
  const warnings = []
  const nums = numbersInText(text)
  const lowerText = text.toLowerCase()

  if (typeof draft.value === 'number' && !nums.includes(draft.value)) {
    warnings.push(`The discount value ${draft.value} doesn't appear in your text — please double-check it.`)
  }
  if (draft.scope === 'cart' && typeof draft.minCartValue === 'number' && !nums.includes(draft.minCartValue)) {
    warnings.push(`The minimum cart value ${formatINR(draft.minCartValue)} doesn't appear in your text — please double-check it.`)
  }
  if (draft.scope === 'cart' && typeof draft.minCartValue === 'number') {
    const wording = thresholdWording(text)
    if (wording === 'strict' && draft.thresholdInclusive !== false) {
      warnings.push(`Your text says "more than/above", but the rule is set to "at least ${formatINR(draft.minCartValue)}". Check the condition below.`)
    }
    if (wording === 'inclusive' && draft.thresholdInclusive === false) {
      warnings.push(`Your text says "at least", but the rule is set to "more than ${formatINR(draft.minCartValue)}". Check the condition below.`)
    }
    if (wording === null) {
      warnings.push('Your text doesn\'t say whether the threshold amount itself qualifies. Choose "at least" or "more than" below.')
    }
  }
  if (draft.scope !== 'cart' && draft.appliesTo) {
    if (!lowerText.includes(draft.appliesTo.trim().toLowerCase())) {
      warnings.push(`Interpreted your text as referring to "${draft.appliesTo}". Make sure that's the ${draft.scope} you meant.`)
    }
    const field = draft.scope === 'brand' ? 'brand' : 'platform'
    const matches = cartItems.filter((i) => i[field].trim().toLowerCase() === draft.appliesTo.trim().toLowerCase())
    if (cartItems.length > 0 && matches.length === 0) {
      warnings.push(`No product in the current cart is from ${field} "${draft.appliesTo}", so this rule won't change today's cart.`)
    }
  }
  if (draft.stackable && !STACK_WORDING.test(text)) {
    warnings.push('The rule is marked stackable, but your text doesn\'t mention combining offers.')
  }
  if (!draft.stackable && STACK_WORDING.test(text) && !/\b(not|non|don'?t|cannot|can'?t)\b[\w\s-]{0,12}(stack|combin)/i.test(text)) {
    warnings.push('Your text mentions combining offers, but the rule is marked non-stackable.')
  }
  const duplicate = existingRules.find((r) => isSameRule(r, { ...draft, minCartValue: draft.minCartValue ?? null }))
  return { warnings, duplicateOf: duplicate?.ruleId ?? null }
}

/**
 * Turns a draft (from the LLM or the edit form) into a validated rule.
 * @returns {{ ok: true, rule } | { ok: false, errors: string[] }}
 */
export function finalizeDraft(draft, { text, existingRules }) {
  const value = draft.value === '' || draft.value === null ? NaN : Number(draft.value)
  const min =
    draft.scope === 'cart' && draft.minCartValue !== '' && draft.minCartValue !== null && draft.minCartValue !== undefined
      ? Number(draft.minCartValue)
      : null
  return validateDiscountRule({
    ruleId: nextRuleId(existingRules),
    scope: draft.scope,
    appliesTo: draft.scope === 'cart' ? null : String(draft.appliesTo ?? ''),
    type: draft.type,
    value,
    stackable: Boolean(draft.stackable),
    minCartValue: min,
    thresholdInclusive: draft.thresholdInclusive === false ? false : true,
    source: 'ai',
    sourceText: text,
  })
}

/**
 * Entry point: LLM output → UI state for the confirmation step.
 * kinds: 'clarify' | 'unsupported' | 'review'
 */
export function adaptLlmResult(llm, ctx) {
  if (llm.status === 'needs_clarification' || !llm.rule) {
    if (llm.status === 'unsupported') {
      return { kind: 'unsupported', message: llm.clarification || "That kind of rule isn't supported yet.", interpretation: llm.interpretation }
    }
    return {
      kind: 'clarify',
      message: llm.clarification || 'Could you add the missing details, such as the discount amount?',
      missing: llm.missing_fields,
      interpretation: llm.interpretation,
    }
  }
  if (llm.status === 'unsupported') {
    return { kind: 'unsupported', message: llm.clarification || "That kind of rule isn't supported yet.", interpretation: llm.interpretation }
  }
  const draft = draftFromLlmRule(llm.rule)
  return { kind: 'review', draft, interpretation: llm.interpretation, ...finalizeView(draft, ctx) }
}

/** Validation + cross-checks for the current draft; re-run after every edit. */
export function finalizeView(draft, ctx) {
  const validation = finalizeDraft(draft, ctx)
  const { warnings, duplicateOf } = crossCheck(draft, ctx)
  return { validation, warnings, duplicateOf }
}
