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
