/**
 * RuleBuilder.jsx — natural-language rule input with a confirmation step.
 *
 *   text → /api/parse-rule (LLM) → adapter + schema validation
 *        → review (editable fields, warnings, impact preview from the engine)
 *        → Confirm (adds rule) | Discard
 */

import { useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { requestRuleParse } from '../services/aiRuleParser.js'
import { adaptLlmResult, finalizeView } from '../adapters/naturalLanguageAdapter.js'
import { previewRuleImpact } from '../engine/ruleImpact.js'
import { describeRule } from '../engine/explanationEngine.js'
import { formatINR } from '../utils/money.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

export default function RuleBuilder({ rules, cartItems, onConfirm }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  const inFlight = useRef(false)

  const known = useMemo(
    () => ({
      brands: [...new Set(cartItems.map((i) => i.brand))],
      platforms: [...new Set(cartItems.map((i) => i.platform))],
    }),
    [cartItems]
  )

  async function parse(e) {
    e?.preventDefault()
    const input = text.trim()
    if (!input || inFlight.current) return
    inFlight.current = true
    setState({ status: 'loading' })
    const res = await requestRuleParse(input, known)
    inFlight.current = false
    if (!res.ok) {
      setState({ status: 'error', message: res.message, code: res.code })
      return
    }
    const view = adaptLlmResult(res.result, { text: input, existingRules: rules, cartItems })
    if (view.kind === 'review') setState({ status: 'review', text: input, draft: view.draft, aiReading: view.interpretation })
    else setState({ status: view.kind, text: input, message: view.message, interpretation: view.interpretation, missing: view.missing })
  }

  function reset() {
    setState({ status: 'idle' })
    setText('')
  }

  return (
    <section className="builder" aria-labelledby="builder-title">
      <div className="builder-head">
        <Icon name="text" />
        <h3 id="builder-title">Add a rule in plain English</h3>
      </div>

      {state.status !== 'review' && (
        <form onSubmit={parse}>
          <label htmlFor="rule-text" className="sr-only">
            Describe the discount rule
          </label>
          <textarea
            id="rule-text"
            className="textarea"
            placeholder="e.g. 15% off everything on Amazon India"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) parse(e)
            }}
            disabled={state.status === 'loading'}
          />
          <div className="chips" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="chip" onClick={() => setText(ex)} disabled={state.status === 'loading'}>
                {ex}
              </button>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={!text.trim() || state.status === 'loading'}>
              {state.status === 'loading' ? (
                <>
                  <span className="spinner" /> Interpreting…
                </>
              ) : (
                'Interpret rule'
              )}
            </button>
            <span className="small muted">The AI only reads your text. Prices are always calculated by the engine.</span>
          </div>
        </form>
      )}

      {state.status === 'error' && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" />
          <div>
            <div className="alert-title">Couldn't interpret the rule</div>
            {state.message}
            {state.code === 'not_configured' && <div className="small">See README → Environment variables to enable the AI parser.</div>}
          </div>
        </div>
      )}

      {state.status === 'clarify' && (
        <div className="alert alert-warn" role="status">
          <Icon name="info" />
          <div>
            <div className="alert-title">Need a little more detail</div>
            {state.message}
            {state.missing?.length > 0 && <div className="small">Missing: {state.missing.join(', ').replace(/_/g, ' ')}</div>}
            <div className="small">Nothing was added. Edit your text above and try again.</div>
          </div>
        </div>
      )}

      {state.status === 'unsupported' && (
        <div className="alert alert-warn" role="status">
          <Icon name="info" />
          <div>
            <div className="alert-title">This kind of rule isn't supported</div>
            {state.message}
            <div className="small">
              Supported: brand, platform or whole-cart discounts — percentage or flat, optionally stackable, with an optional minimum cart value.
            </div>
          </div>
        </div>
      )}

      {state.status === 'review' && (
        <RuleReview
          key={state.text}
          initial={state}
          rules={rules}
          cartItems={cartItems}
          known={known}
          onDiscard={() => setState({ status: 'idle' })}
          onConfirm={(rule) => {
            onConfirm(rule)
            reset()
          }}
        />
      )}
    </section>
  )
}

function RuleReview({ initial, rules, cartItems, known, onDiscard, onConfirm }) {
  const [draft, setDraft] = useState(initial.draft)
  const [submitted, setSubmitted] = useState(false)
  const ctx = { text: initial.text, existingRules: rules, cartItems }
  const { validation, warnings, blockers, duplicateOf } = finalizeView(draft, ctx)
  const impact = validation.ok && cartItems.length > 0 ? previewRuleImpact(cartItems, rules, validation.rule) : null
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const num = (v) => (v === '' ? '' : Number(v))
  const canConfirm = validation.ok && !duplicateOf && blockers.length === 0 && !submitted

  return (
    <div>
      <div className="review-block" style={{ marginTop: 0 }}>
        <div className="review-label">You wrote</div>
        <div className="quote">“{initial.text}”</div>
      </div>

      <div className="review-block">
        <div className="review-label">Parsed rule</div>
        <p className="interpretation">
          {validation.ok ? capitalize(describeRule(validation.rule)) : 'This rule needs fixing before it can be added.'}
        </p>
        {initial.aiReading && <div className="small muted">AI's reading: {initial.aiReading}</div>}
      </div>

      <div className="review-block">
        <div className="review-label">Review or edit</div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-scope">Scope</label>
            <select id="f-scope" className="select" value={draft.scope} onChange={(e) => set({ scope: e.target.value })}>
              <option value="brand">Brand</option>
              <option value="platform">Platform</option>
              <option value="cart">Entire cart</option>
            </select>
          </div>
          {draft.scope !== 'cart' && (
            <div className="field">
              <label htmlFor="f-applies">Applies to</label>
              <input
                id="f-applies"
                className="input"
                list={`known-${draft.scope}`}
                value={draft.appliesTo}
                onChange={(e) => set({ appliesTo: e.target.value })}
              />
              <datalist id={`known-${draft.scope}`}>
                {(draft.scope === 'brand' ? known.brands : known.platforms).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          )}
          <div className="field">
            <label htmlFor="f-type">Type</label>
            <select id="f-type" className="select" value={draft.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="percentage">Percentage</option>
              <option value="flat">Flat (₹)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-value">{draft.type === 'percentage' ? 'Value (%)' : 'Value (₹)'}</label>
            <input id="f-value" className="input num" type="number" step="any" value={draft.value} onChange={(e) => set({ value: num(e.target.value) })} />
          </div>
          {draft.scope === 'cart' && (
            <>
              <div className="field">
                <label htmlFor="f-cond">Condition</label>
                <select
                  id="f-cond"
                  className="select"
                  value={draft.thresholdInclusive === false ? 'gt' : 'gte'}
                  onChange={(e) => set({ thresholdInclusive: e.target.value === 'gte' })}
                >
                  <option value="gte">Cart total at least</option>
                  <option value="gt">Cart total more than</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-min">Min. cart value (₹)</label>
                <input
                  id="f-min"
                  className="input num"
                  type="number"
                  step="any"
                  placeholder="No minimum"
                  value={draft.minCartValue ?? ''}
                  onChange={(e) => set({ minCartValue: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </div>
            </>
          )}
        </div>
        <label className="checkbox" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={Boolean(draft.stackable)} onChange={(e) => set({ stackable: e.target.checked })} />
          Stackable — applies on top of the best non-stackable offer
        </label>
      </div>

      {!validation.ok && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" />
          <div>
            <div className="alert-title">Can't add this rule yet</div>
            <ul>
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {blockers.length > 0 && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" />
          <div>
            <div className="alert-title">Can't add this rule</div>
            <ul>
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {duplicateOf && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" />
          <div>This rule is identical to {duplicateOf}, which is already active.</div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="alert alert-warn" role="status">
          <Icon name="info" />
          <div>
            <div className="alert-title">Please double-check</div>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {impact && (
        <div className="review-block">
          <div className="review-label">Impact on the current cart</div>
          <div className="impact">
            <div className="impact-figures">
              <div className="impact-figure">
                <div className="k">Products affected</div>
                <div className="v num">{impact.diff.changedItems.length}</div>
              </div>
              <div className="impact-figure">
                <div className="k">Extra customer savings</div>
                <div className={`v num${impact.diff.additionalSavings > 0 ? ' good' : ''}`}>{formatINR(impact.diff.additionalSavings)}</div>
              </div>
              <div className="impact-figure">
                <div className="k">New cart total</div>
                <div className="v num">
                  {formatINR(impact.after.finalTotal)}{' '}
                  <span className="small muted" style={{ fontWeight: 400 }}>
                    was {formatINR(impact.before.finalTotal)}
                  </span>
                </div>
              </div>
            </div>
            {impact.notes.length > 0 && (
              <ul>
                {impact.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {validation.ok && cartItems.length === 0 && <div className="small muted review-block">Load a cart to preview this rule's impact.</div>}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-accent"
          disabled={!canConfirm}
          onClick={() => {
            setSubmitted(true)
            onConfirm(validation.rule)
          }}
        >
          <Icon name="check" /> Confirm rule
        </button>
        <button type="button" className="btn" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  )
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
