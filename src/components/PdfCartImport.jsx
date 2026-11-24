/**
 * PdfCartImport.jsx — upload a cart PDF, inspect what was extracted, then
 * explicitly replace the cart. The current cart is untouched until Confirm.
 */

import { useState } from 'react'
import CsvUploader from './CsvUploader.jsx'
import DataTable from './DataTable.jsx'
import Icon from './Icon.jsx'
import { loadBrowserPdfjs, extractTextItems } from '../services/pdfExtractor.js'
import { parseCartFromTextItems, buildItems } from '../adapters/pdfAdapter.js'
import { formatINR } from '../utils/money.js'

const STATUS_BADGE = {
  valid: <span className="badge badge-success">Valid</span>,
  invalid: <span className="badge badge-error">Skipped</span>,
  duplicate: <span className="badge badge-warn">Duplicate?</span>,
}

const COLUMNS = [
  { key: 'rowNumber', label: 'Row' },
  { key: 'product', label: 'Product', render: (_, r) => r.cells.product || <em className="muted">missing</em> },
  { key: 'brand', label: 'Brand', render: (_, r) => r.cells.brand || <em className="muted">missing</em> },
  { key: 'platform', label: 'Platform', render: (_, r) => r.cells.platform || <em className="muted">missing</em> },
  {
    key: 'price',
    label: 'Base price',
    align: 'right',
    render: (_, r) => (r.item ? formatINR(r.item.basePrice) : r.cells.basePrice || <em className="muted">missing</em>),
  },
  { key: 'status', label: 'Status', render: (v) => STATUS_BADGE[v] },
]

export default function PdfCartImport({ onConfirm, currentCount, activeRuleCount }) {
  const [state, setState] = useState({ status: 'idle' })
  const [includeDuplicates, setIncludeDuplicates] = useState(true)

  async function handleLoad(buffer, fileName) {
    setState({ status: 'reading', fileName })
    try {
      const pdfjs = await loadBrowserPdfjs()
      const items = await extractTextItems(pdfjs, buffer)
      const parsed = parseCartFromTextItems(items)
      setIncludeDuplicates(true)
      setState({ status: parsed.error ? 'error' : 'preview', fileName, parsed, message: parsed.error })
    } catch (err) {
      setState({ status: 'error', fileName, message: err.message || 'Could not read this PDF.' })
    }
  }

  const parsed = state.parsed
  const items = parsed && !parsed.error ? buildItems(parsed.rows, { includeDuplicates }) : []
  const problems = parsed?.rows.filter((r) => r.status !== 'valid') ?? []
  const counts = parsed
    ? {
        valid: parsed.rows.filter((r) => r.status === 'valid').length,
        invalid: parsed.rows.filter((r) => r.status === 'invalid').length,
        duplicate: parsed.rows.filter((r) => r.status === 'duplicate').length,
      }
    : null

  return (
    <div>
      <CsvUploader
        label="Cart PDF"
        description="Table with Product, Brand, Platform, Base Price"
        accept=".pdf,application/pdf"
        readAs="arrayBuffer"
        onLoad={handleLoad}
        hasData={state.status === 'preview'}
        fileName={state.fileName}
        disabled={state.status === 'reading'}
      />

      {state.status === 'reading' && (
        <div className="alert alert-info" role="status">
          <span className="spinner dark" /> Reading {state.fileName}…
        </div>
      )}

      {state.status === 'error' && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" />
          <div>
            <div className="alert-title">Couldn't extract a cart from {state.fileName}</div>
            {state.message}
            {currentCount > 0 && <div className="small">Your current cart ({currentCount} items) was kept.</div>}
          </div>
        </div>
      )}

      {state.status === 'preview' && (
        <div className="review-block">
          <div className="table-meta">
            <span>
              Extracted {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}: {counts.valid} valid
              {counts.duplicate > 0 && `, ${counts.duplicate} possible duplicate${counts.duplicate > 1 ? 's' : ''}`}
              {counts.invalid > 0 && `, ${counts.invalid} skipped`}
            </span>
          </div>
          <DataTable
            columns={COLUMNS}
            rows={parsed.rows}
            rowKey={(r) => r.rowNumber}
            rowClassName={(r) => (r.status === 'valid' ? undefined : 'li-changed')}
          />

          {problems.length > 0 && (
            <div className="alert alert-warn" role="status">
              <Icon name="alert" />
              <div>
                <div className="alert-title">Extraction warnings</div>
                <ul>
                  {problems.map((r) => (
                    <li key={r.rowNumber}>{r.message}</li>
                  ))}
                </ul>
                {counts.duplicate > 0 && (
                  <label className="checkbox" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
                    Keep possible duplicates (a customer may have bought two)
                  </label>
                )}
              </div>
            </div>
          )}
          {parsed.ignored.length > 0 && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Ignored non-product line{parsed.ignored.length > 1 ? 's' : ''}: {parsed.ignored.map((l) => `“${l.replace(/\s{2,}/g, ' ')}”`).join(', ')}
            </div>
          )}

          {items.length === 0 ? (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" />
              <div>No valid products were found, so the current cart was kept.</div>
            </div>
          ) : (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  onConfirm(items, state.fileName)
                  setState({ status: 'idle' })
                }}
              >
                <Icon name="check" /> Replace cart with {items.length} item{items.length === 1 ? '' : 's'}
              </button>
              <button type="button" className="btn" onClick={() => setState({ status: 'idle' })}>
                Cancel
              </button>
              <span className="small muted">
                {activeRuleCount} active rule{activeRuleCount === 1 ? '' : 's'} will be re-applied.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
