/**
 * DataTable.jsx
 *
 * Renders a simple table from an array of objects.
 * Columns are defined as [{ key, label, render?, align? }].
 */

export default function DataTable({ columns, rows, emptyMessage = 'No data loaded.', rowKey = (row, i) => i, rowClassName }) {
  if (!rows || rows.length === 0) {
    return <div className="table-wrap empty-state">{emptyMessage}</div>
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.align === 'right' ? 'right' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className={rowClassName?.(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.align === 'right' ? 'right num' : undefined}>
                  {col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
