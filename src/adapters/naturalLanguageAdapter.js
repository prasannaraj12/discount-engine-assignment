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

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)day'
/**
 * Time-limit wording. The engine has no dates, so a rule parsed from this text
 * would apply permanently. Added after the parser evaluation, where
 * "20% off Natura Casa this weekend only" came back as a permanent rule.
 */
const TIME_LIMIT_WORDING = new RegExp(
  [
    `\\b(?:today|tonight|tomorrow|weekends?|this week|next week|this month|next month)\\b`,
    `\\b(?:until|till|untill|expires?|expiring|expiry|ends? (?:on|at|by)|valid (?:from|till|until|through|on))\\b`,
    `\\bonly on\\b`,
    `\\bfor (?:the )?(?:next |first )?\\d+\\s*(?:hours?|hrs?|days?|weeks?|months?)\\b`,
    `\\b(?:limited[- ]time|flash sale|happy hours?|midnight)\\b`,
    `\\b(?:diwali|holi|christmas|xmas|new year|black friday|cyber monday|eid|pongal|onam|navratri|festive season|festival sale)\\b`,
    `\\b${DAY}s?\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    `\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b`,
    `\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b`,
  ].join('|'),
  'i'
)

/** The matched time phrase, or null. */
export function timeLimitWording(text) {
  const m = TIME_LIMIT_WORDING.exec(text)
  return m ? m[0] : null
}

/**
 * A minus sign or the word "minus"/"negative" right before an amount:
 * "-50", "Rs.-50", "₹ -50", "minus 50". Ranges like "10-20%" don't match
 * (the hyphen must not follow a digit or letter). Added after the parser
 * evaluation, where "-50 rupees off" came back as a valid ₹50 discount.
 */
const NEGATIVE_AMOUNT =
  /(?:^|[^\w.])(?:[-−–]\s*(?:rs\.?|inr|₹)?\s*\d[\d,]*(?:\.\d+)?|(?:rs\.?|inr|₹)\s*[-−–]\s*\d[\d,]*(?:\.\d+)?|\b(?:minus|negative)\s+(?:rs\.?\s*|inr\s*|₹\s*)?\d[\d,]*(?:\.\d+)?)/i

/** The matched negative amount, or null. */
export function negativeAmountWording(text) {
  const m = NEGATIVE_AMOUNT.exec(text)
  return m ? m[0].replace(/^[^\w\-−–₹]+/, '').trim() : null
}

/** "inclusive" | "strict" | null — what the user's own words say. */
export function thresholdWording(text) {
  if (INCLUSIVE_WORDING.test(text)) return 'inclusive'
  if (STRICT_WORDING.test(text)) return 'strict'
  return null
}

/**
 * Deterministic checks of a (possibly user-edited) draft against the original
 * text and the current state. They never change the rule.
 *   warnings — shown for the user to check; confirming is still allowed
 *   blockers — the rule can't be confirmed (e.g. the text asks for a negative discount)
 */
export function crossCheck(draft, { text, existingRules = [], cartItems = [] }) {
  const warnings = []
  const blockers = []
  const nums = numbersInText(text)
  const lowerText = text.toLowerCase()

  const negative = negativeAmountWording(text)
  if (negative) {
    blockers.push(`Your text contains a negative amount ("${negative}"). A discount must be a positive amount, so this rule can't be added. Please rephrase it.`)
  }
  const timePhrase = timeLimitWording(text)
  if (timePhrase) {
    warnings.push(
      `Your text mentions a time limit ("${timePhrase}"), but this engine has no dates or schedules. If you confirm, the rule will apply permanently until you remove it.`
    )
  }

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
  return { warnings, blockers, duplicateOf: duplicate?.ruleId ?? null }
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
  const { warnings, blockers, duplicateOf } = crossCheck(draft, ctx)
  return { validation, warnings, blockers, duplicateOf }
}
