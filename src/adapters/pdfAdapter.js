/**
 * pdfAdapter.js
 *
 * Turns positioned text extracted from a cart PDF into CartItem objects,
 * with a per-row report. Pure function — no pdf.js import here, so it is
 * fully unit-testable and the engine never sees a PDF library.
 *
 * Expected layout (from the assignment brief): a table whose header row
 * contains Product, Brand, Platform and Base Price. Columns are located from
 * the header's x positions, so multi-word values ("Amazon India") work.
 *
 * Nothing is guessed: rows with missing or unreadable fields are reported as
 * invalid and excluded; duplicates are flagged and left to the user.
 */

import { validateCartRow, itemKey } from '../validation/cartItemSchema.js'

const HEADERS = [
  { key: 'product', match: /^product( name)?$/i },
  { key: 'brand', match: /^brand$/i },
  { key: 'platform', match: /^platform$/i },
  { key: 'basePrice', match: /^(base )?price$/i },
]

const SEPARATOR = /^[\s\-–—─_=.|]+$/
const SUMMARY_LINE = /^(sub\s*-?total|total|grand total|amount payable|tax|gst|shipping)\b/i

/** Groups text items into visual lines (top to bottom, left to right). */
export function groupIntoLines(textItems, yTolerance = 3) {
  const items = textItems.filter((t) => t.str && t.str.trim() !== '')
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const line = lines[lines.length - 1]
    if (line && line.page === it.page && Math.abs(line.y - it.y) <= yTolerance) line.items.push(it)
    else lines.push({ page: it.page, y: it.y, items: [it] })
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.text = line.items.map((i) => i.str.trim()).join(' ')
  }
  return lines
}

/** Finds header columns. Header words may arrive as one item or several. */
function findHeader(line) {
  const columns = {}
  const items = line.items
  for (let i = 0; i < items.length; i++) {
    for (let span = 1; span <= 2 && i + span <= items.length; span++) {
      const text = items.slice(i, i + span).map((t) => t.str.trim()).join(' ')
      for (const h of HEADERS) {
        if (columns[h.key] === undefined && h.match.test(text)) columns[h.key] = items[i].x
      }
    }
  }
  return HEADERS.every((h) => columns[h.key] !== undefined) ? columns : null
}

function assignToColumns(line, columns) {
  const starts = HEADERS.map((h) => ({ key: h.key, x: columns[h.key] })).sort((a, b) => a.x - b.x)
  const cells = { product: [], brand: [], platform: [], basePrice: [] }

  // A single text run with wide gaps ("Cushion Cover   Natura Casa ...") — split on the gaps.
  if (line.items.length === 1 && /\s{2,}/.test(line.items[0].str)) {
    const parts = line.items[0].str.trim().split(/\s{2,}/)
    if (parts.length === starts.length) {
      starts.forEach((s, i) => cells[s.key].push(parts[i]))
      return Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(' ')]))
    }
  }

  const TOLERANCE = 15 // right-aligned or slightly offset values
  for (const it of line.items) {
    let col = starts[0]
    for (const s of starts) if (it.x + TOLERANCE >= s.x) col = s
    cells[col.key].push(it.str.trim())
  }
  return Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(' ').trim()]))
}

/**
 * @param {{str: string, x: number, y: number, page: number}[]} textItems
 * @returns {{
 *   items: CartItem[],          valid rows (duplicates included by default)
 *   rows: RowReport[],          every table row with status and reasons
 *   ignored: string[],          non-table lines such as "Total Rs.5,932"
 *   error: string|null          fatal problem (no text, no header, no rows)
 * }}
 */
export function parseCartFromTextItems(textItems) {
  const empty = (error) => ({ items: [], rows: [], ignored: [], error })

  if (!textItems || textItems.filter((t) => t.str?.trim()).length === 0) {
    return empty('This PDF has no selectable text. It may be a scanned image — scanned PDFs need OCR, which is not supported. Please upload a text-based PDF or use the CSV upload.')
  }

  const lines = groupIntoLines(textItems)
  const headerIndex = lines.findIndex((l) => findHeader(l))
  if (headerIndex === -1) {
    return empty('Could not find the cart table. The PDF must contain a header row with the columns Product, Brand, Platform and Base Price.')
  }
  const columns = findHeader(lines[headerIndex])

  const rows = []
  const ignored = []
  const seen = new Map()
  let rowNumber = 0

  for (const line of lines.slice(headerIndex + 1)) {
    if (SEPARATOR.test(line.text)) continue
    if (findHeader(line)) continue // header repeated on a later page
    if (SUMMARY_LINE.test(line.text)) {
      ignored.push(line.text)
      continue
    }
    rowNumber++
    const cells = assignToColumns(line, columns)
    const result = validateCartRow(cells)
    if (!result.ok) {
      rows.push({ rowNumber, status: 'invalid', cells, reasons: result.errors, message: `Row ${rowNumber} skipped — ${result.errors.join('; ')}` })
      continue
    }
    const key = itemKey(result.item)
    if (seen.has(key)) {
      rows.push({
        rowNumber,
        status: 'duplicate',
        cells,
        item: result.item,
        duplicateOf: seen.get(key),
        reasons: [`same product, brand, platform and price as row ${seen.get(key)}`],
        message: `Row ${rowNumber} looks like a duplicate of row ${seen.get(key)} — kept unless you exclude duplicates`,
      })
      continue
    }
    seen.set(key, rowNumber)
    rows.push({ rowNumber, status: 'valid', cells, item: result.item, reasons: [], message: null })
  }

  if (rows.length === 0) return { ...empty('The cart table has a header but no product rows.'), ignored }
  return { items: buildItems(rows, { includeDuplicates: true }), rows, ignored, error: null }
}

/** Final CartItem[] for the rows the user accepted. */
export function buildItems(rows, { includeDuplicates }) {
  return rows
    .filter((r) => r.status === 'valid' || (includeDuplicates && r.status === 'duplicate'))
    .map((r, i) => ({ itemId: `ITEM-${String(i + 1).padStart(2, '0')}`, ...r.item }))
}
