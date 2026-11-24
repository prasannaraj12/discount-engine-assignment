/**
 * PricingResults.jsx — the customer-facing checkout breakdown.
 * Everything displayed comes from calculateCart() + explanationEngine.
 */

import Icon from './Icon.jsx'
import { explainItem, explainCartOffer, explainNudge } from '../engine/explanationEngine.js'
import { getThresholdNudge } from '../engine/cartRuleEvaluator.js'
import { getCartInsights } from '../engine/cartInsights.js'
import { formatINR, round2 } from '../utils/money.js'

export default function PricingResults({ pricing, rules = [], lastChange, onDismissChange }) {
  const changedIds = new Set(lastChange?.diff.changedItems.map((c) => c.itemId) ?? [])
  return (
    <div>
      {lastChange && <ChangeBanner change={lastChange} onDismiss={onDismissChange} />}
      <div className="results-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Your cart</h2>
              <p className="card-sub">
                {pricing.items.length} item{pricing.items.length === 1 ? '' : 's'} · the best available offer is applied to each product
              </p>
            </div>
          </div>
          <ul className="line-items" style={{ marginTop: 12 }}>
            {pricing.items.map((r) => (
              <LineItem key={r.itemId} result={r} rules={rules} changed={changedIds.has(r.itemId)} />
            ))}
          </ul>
        </div>
        <CartSummary pricing={pricing} />
      </div>
    </div>
  )
}

function LineItem({ result, rules, changed }) {
  const e = explainItem(result, rules)
  const hasOffer = result.steps.length > 0
  return (
    <li className={`line-item${changed ? ' li-changed' : ''}`}>
      <div className="li-main">
        <div className="li-info">
          <div className="li-name">
            {result.product} {changed && <span className="badge badge-warn">Updated</span>}
          </div>
          <div className="li-meta">
            {result.brand} · {result.platform}
          </div>
          <div className="li-offer">
            {hasOffer ? (
              result.steps.map((s) => (
                <span key={s.ruleId} className="badge badge-success">
                  <Icon name="tag" size={11} />
                  {s.rule.appliesTo} ·{s.rule.type === 'percentage' ? `${s.rule.value}% off` : `${formatINR(s.rule.value)} off`}
                  {s.role === 'stacked' && result.steps.some((x) => x.role === 'best') ? ' (stacked)' : ''}
                </span>
              ))
            ) : (
              <span className="none">No offers available</span>
            )}
          </div>
        </div>
        <div className="li-prices num">
          <div className="li-final">{formatINR(result.finalPrice)}</div>
          {hasOffer && <div className="li-base">{formatINR(result.basePrice)}</div>}
          {result.totalDiscount > 0 && <div className="li-save">You save {formatINR(result.totalDiscount)}</div>}
        </div>
      </div>

      <details className="why">
        <summary>
          <Icon name="chevron" size={12} /> Why this price?
        </summary>
        <div className="why-body">
          <p>{e.summary}</p>
          {hasOffer && (
            <table className="why-steps num">
              <tbody>
                <tr>
                  <td>Original price</td>
                  <td className="right">{formatINR(result.basePrice)}</td>
                </tr>
                {e.lines.map((l) => (
                  <tr key={l.text}>
                    <td>{l.text}</td>
                    <td className="right" style={{ color: 'var(--success)' }}>
                      −{formatINR(l.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Final price</td>
                  <td className="right">{formatINR(result.finalPrice)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {e.alternatives.length > 0 && (
            <ul className="why-alt">
              {e.alternatives.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {e.notApplicable.length > 0 && (
            <div className="why-na">
              <div className="why-na-title">Other active offers that don't cover this product</div>
              <ul>
                {e.notApplicable.map((t) => (
                  <li key={t}>{t.split(' · ')[1]}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="tech">
            <summary>Technical details</summary>
            <ul>
              <li>{result.itemId}</li>
              {e.technical.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </li>
  )
}

function CartSummary({ pricing }) {
  const nudge = getThresholdNudge(pricing)
  const bySource = savingsBySource(pricing)
  return (
    <aside className="card summary-card" aria-label="Order summary">
      <div className="card-head">
        <h2 className="card-title">Order summary</h2>
      </div>
      <div className="card-body">
        {nudge && (
          <div className="nudge" role="status">
            <div className="nudge-text">{explainNudge(nudge)}</div>
            <div className="progress" aria-hidden="true">
              <div style={{ width: `${Math.round(nudge.progress * 100)}%` }} />
            </div>
            <div className="nudge-meta num">
              <span>Cart {formatINR(nudge.current)}</span>
              <span>
                {nudge.strict ? 'Above ' : ''}
                {formatINR(nudge.required)}
              </span>
            </div>
          </div>
        )}

        <div className="sum-row num">
          <span className="k">Items (original prices)</span>
          <span className="v">{formatINR(pricing.originalTotal)}</span>
        </div>
        <div className="sum-row discount num">
          <span className="k">Product offers</span>
          <span className="v">{pricing.itemDiscount > 0 ? `−${formatINR(pricing.itemDiscount)}` : formatINR(0)}</span>
        </div>
        <div className="sum-row subtotal num">
          <span className="k">Cart total before cart offer</span>
          <span className="v">{formatINR(pricing.subtotal)}</span>
        </div>

        {pricing.cartOffers.map((o) => {
          const x = explainCartOffer(o)
          return (
            <div className="cart-offer" key={o.ruleId}>
              <div className="top num">
                <span>{x.label.split(' — ')[0]}</span>
                <span>−{formatINR(o.amount)}</span>
              </div>
              <div className="sub">{x.detail}</div>
            </div>
          )
        })}

        <div className="sum-total num">
          <span className="k">Final cart total</span>
          <span className="v">{formatINR(pricing.finalTotal)}</span>
        </div>
        {pricing.totalSavings > 0 && (
          <div className="sum-savings num">You save {formatINR(pricing.totalSavings)} on this order</div>
        )}

        <Insights pricing={pricing} />

        {pricing.totalSavings > 0 && (
          <div className="breakdown">
            <div className="review-label">Savings by offer type</div>
            <div className="bar" aria-hidden="true">
              {bySource.map((s) => (
                <div key={s.key} style={{ width: `${(s.amount / pricing.totalSavings) * 100}%`, background: s.color }} />
              ))}
            </div>
            <div className="legend num">
              {bySource.map((s) => (
                <div key={s.key}>
                  <span>
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span>{formatINR(s.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function savingsBySource(pricing) {
  const sum = { brand: 0, platform: 0 }
  for (const item of pricing.items) for (const s of item.steps) sum[s.rule.scope] += s.amount
  return [
    { key: 'platform', label: 'Platform offers', amount: round2(sum.platform), color: '#131a48' },
    { key: 'brand', label: 'Brand offers', amount: round2(sum.brand), color: '#6b74b8' },
    { key: 'cart', label: 'Cart offers', amount: pricing.cartDiscount, color: '#ff5800' },
  ].filter((s) => s.amount > 0)
}

function ChangeBanner({ change, onDismiss }) {
  const { diff } = change
  return (
    <div className="alert alert-success change-banner" role="status" style={{ marginTop: 0, marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Icon name="checkCircle" />
        <div>
          <div className="alert-title">{change.title}</div>
          <div className="change-figs num">
            <div>
              <div className="k">Previous total</div>
              <div className="v">{formatINR(diff.previousTotal)}</div>
            </div>
            <div>
              <div className="k">Updated total</div>
              <div className="v">{formatINR(diff.updatedTotal)}</div>
            </div>
            <div>
              <div className="k">{diff.additionalSavings >= 0 ? 'Additional savings' : 'Savings reduced by'}</div>
              <div className="v">{formatINR(Math.abs(diff.additionalSavings))}</div>
            </div>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {diff.changedItems.length === 0
              ? 'No product prices changed.'
              : `Changed: ${diff.changedItems.map((c) => `${c.product} (${formatINR(c.before)} → ${formatINR(c.after)})`).join(', ')}.`}
            {diff.cartOfferChanged && ` Cart offer: ${formatINR(diff.cartDiscountBefore)} → ${formatINR(diff.cartDiscountAfter)}.`}
          </div>
        </div>
      </div>
      <button type="button" className="link-btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

const TONE_ICON = { action: 'cart', positive: 'checkCircle', neutral: 'info' }

function Insights({ pricing }) {
  const insights = getCartInsights(pricing).filter((i) => i.kind !== 'threshold') // threshold already shown as the nudge
  if (insights.length === 0) return null
  return (
    <div className="insights">
      <div className="review-label">Insights</div>
      <ul>
        {insights.map((i) => (
          <li key={i.text} className={`insight insight-${i.tone}`}>
            <Icon name={TONE_ICON[i.tone]} size={14} />
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      <div className="insight-note">Calculated from your rules and cart. Suggestions only; nothing is changed automatically.</div>
    </div>
  )
}
