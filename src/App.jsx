/**
 * App.jsx
 *
 * Top-level component. Holds in-memory state for rules and cart items and
 * wires the input adapters (CSV, PDF, natural language) to the one engine
 * entry point, calculateCart(). No business logic lives here.
 */

import { useMemo, useState } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleBuilder from './components/RuleBuilder.jsx'
import PdfCartImport from './components/PdfCartImport.jsx'
import PricingResults from './components/PricingResults.jsx'
import Icon from './components/Icon.jsx'
import { parseRulesCSV, parseCartCSV } from './adapters/csvAdapter.js'
import { calculateCart, diffPricing } from './engine/pricing.js'
import { formatINR } from './utils/money.js'
import sampleRulesCsv from '../sample-data/rules.csv?raw'
import sampleCartCsv from '../sample-data/cart.csv?raw'

// ── Column definitions ───────────────────────────────────────────

const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1)

const RULES_COLUMNS = (onRemove) => [
  {
    key: 'ruleId',
    label: 'Rule',
    render: (v, row) => (
      <span style={{ whiteSpace: 'nowrap' }}>
        {v} {row.source === 'ai' && <span className="badge badge-ai" title={row.sourceText}>AI</span>}
      </span>
    ),
  },
  { key: 'scope', label: 'Scope', render: cap },
  { key: 'appliesTo', label: 'Applies to', render: (v, row) => (row.scope === 'cart' ? 'Entire cart' : v) },
  {
    key: 'value',
    label: 'Discount',
    render: (v, row) => (row.type === 'percentage' ? `${v}% off` : `${formatINR(v)} off`),
  },
  {
    key: 'minCartValue',
    label: 'Condition',
    render: (v, row) =>
      v === null || v === undefined ? <span className="muted">—</span> : `Cart ${row.thresholdInclusive === false ? '>' : '≥'} ${formatINR(v)}`,
  },
  { key: 'stackable', label: 'Stackable', render: (v) => (v ? 'Yes' : 'No') },
  {
    key: 'remove',
    label: <span className="sr-only">Remove</span>,
    render: (_, row) => (
      <button type="button" className="link-btn danger" onClick={() => onRemove(row.ruleId)} aria-label={`Remove ${row.ruleId}`}>
        Remove
      </button>
    ),
  },
]

const CART_COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'brand', label: 'Brand' },
  { key: 'platform', label: 'Platform' },
  { key: 'basePrice', label: 'Base price', align: 'right', render: (v) => formatINR(v) },
]

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState([])
  const [rulesErrors, setRulesErr] = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems] = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartFileName, setCartFileName] = useState('')
  const [cartMode, setCartMode] = useState('csv')
  const [notice, setNotice] = useState(null)

  const [calculated, setCalculated] = useState(false)
  const [lastChange, setLastChange] = useState(null)

  const pricing = useMemo(
    () => (calculated && cartItems.length > 0 ? calculateCart(cartItems, rules) : null),
    [calculated, cartItems, rules]
  )

  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setCalculated(false) // clear stale results
    setLastChange(null)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setNotice(null)
    setCalculated(false)
    setLastChange(null)
  }

  function loadSample() {
    handleRulesLoad(sampleRulesCsv, 'sample-data/rules.csv')
    handleCartLoad(sampleCartCsv, 'sample-data/cart.csv')
    setCartMode('csv')
  }

  function applyRuleChange(nextRules, title) {
    if (cartItems.length > 0) {
      const diff = diffPricing(calculateCart(cartItems, rules), calculateCart(cartItems, nextRules))
      setLastChange({ title, diff })
      setCalculated(true)
    }
    setRules(nextRules)
  }

  function handleRuleConfirmed(rule) {
    if (rules.some((r) => r.ruleId === rule.ruleId)) return // double-submit guard
    applyRuleChange([...rules, rule], `${rule.ruleId} added — cart recalculated`)
  }

  function handleRuleRemoved(ruleId) {
    applyRuleChange(
      rules.filter((r) => r.ruleId !== ruleId),
      `${ruleId} removed — cart recalculated`
    )
  }

  function handlePdfCart(items, fileName) {
    setCartItems(items)
    setCartErrors([])
    setCartFileName(fileName)
    setLastChange(null)
    setCalculated(true) // re-run automatically with the existing rules
    setNotice(`Cart replaced with ${items.length} item${items.length === 1 ? '' : 's'} from ${fileName}. Prices recalculated with ${rules.length} active rule${rules.length === 1 ? '' : 's'}.`)
  }

  const canCalculate = cartItems.length > 0

  // ── Render ──

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            O<span>pp</span>tra
          </div>
          <div className="topbar-divider" />
          <div className="topbar-title">Smart Discount Engine</div>
          <div className="topbar-spacer" />
          <button type="button" className="btn btn-sm" onClick={loadSample}>
            Load sample data
          </button>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <div>
            <h1>Checkout pricing</h1>
            <p>
              Load discount rules and a cart. Each product gets the offer that saves the customer the most, stackable offers are added on top, and
              cart-wide offers are applied last.
            </p>
          </div>
        </div>

        <div className="grid-2">
          {/* Rules */}
          <section className="card" aria-labelledby="rules-title">
            <div className="card-head">
              <div>
                <h2 className="card-title" id="rules-title">
                  Discount rules
                </h2>
                <p className="card-sub">Upload a CSV, or describe a new rule in plain English.</p>
              </div>
            </div>
            <div className="card-body">
              <CsvUploader
                label="rules.csv"
                description="rule_id, scope, applies_to, type, value, stackable, min_cart_value"
                onLoad={handleRulesLoad}
                hasData={rulesFileName !== ''}
                fileName={rulesFileName}
              />
              <ErrorBanner errors={rulesErrors} />
              {rules.length > 0 && (
                <>
                  <div className="table-meta">
                    <span>
                      {rules.length} active rule{rules.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <DataTable columns={RULES_COLUMNS(handleRuleRemoved)} rows={rules} rowKey={(r) => r.ruleId} />
                </>
              )}
              <hr className="divider" />
              <RuleBuilder rules={rules} cartItems={cartItems} onConfirm={handleRuleConfirmed} />
            </div>
          </section>

          {/* Cart */}
          <section className="card" aria-labelledby="cart-title">
            <div className="card-head">
              <div>
                <h2 className="card-title" id="cart-title">
                  Cart
                </h2>
                <p className="card-sub">Upload a cart as CSV or as a PDF order.</p>
              </div>
              <div className="tabs" role="tablist" aria-label="Cart input">
                {['csv', 'pdf'].map((m) => (
                  <button key={m} type="button" role="tab" className="tab" aria-selected={cartMode === m} onClick={() => setCartMode(m)}>
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="card-body">
              {cartMode === 'csv' ? (
                <>
                  <CsvUploader
                    label="cart.csv"
                    description="item_id, product, brand, platform, base_price"
                    onLoad={handleCartLoad}
                    hasData={cartFileName !== '' && cartFileName.toLowerCase().endsWith('.csv')}
                    fileName={cartFileName}
                  />
                  <ErrorBanner errors={cartErrors} />
                </>
              ) : (
                <PdfCartImport onConfirm={handlePdfCart} currentCount={cartItems.length} activeRuleCount={rules.length} />
              )}
              {notice && (
                <div className="alert alert-success" role="status">
                  <Icon name="checkCircle" />
                  <div>{notice}</div>
                </div>
              )}
              {cartItems.length > 0 && (
                <>
                  <div className="table-meta">
                    <span>
                      {cartItems.length} item{cartItems.length > 1 ? 's' : ''} in cart · {cartFileName}
                    </span>
                  </div>
                  <DataTable columns={CART_COLUMNS} rows={cartItems} rowKey={(r) => r.itemId} />
                </>
              )}
            </div>
          </section>
        </div>

        {/* Calculate */}
        {!pricing && (
          <div className="calc-bar">
            <button type="button" className="btn btn-accent btn-lg" onClick={() => setCalculated(true)} disabled={!canCalculate}>
              <Icon name="cart" /> Calculate discounts
            </button>
            {!canCalculate && <span className="calc-hint">Upload a cart to calculate</span>}
            {canCalculate && rules.length === 0 && <span className="calc-hint">No rules loaded — prices will show without offers</span>}
          </div>
        )}

        {/* Results */}
        {pricing && (
          <div className="section-gap">
            <PricingResults pricing={pricing} lastChange={lastChange} onDismissChange={() => setLastChange(null)} />
          </div>
        )}
      </main>
    </>
  )
}
