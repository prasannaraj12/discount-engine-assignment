/** RuleChecks.jsx — shows deterministic promotion-audit findings. */
import Icon from './Icon.jsx'

export default function RuleChecks({ findings, hasCart }) {
  const warnings = findings.filter((f) => f.severity === 'warning').length
  return (
    <section className="checks" aria-label="Rule checks">
      <div className="checks-head">
        <div className="review-label" style={{ margin: 0 }}>
          Rule checks
        </div>
        {findings.length > 0 && (
          <span className={`badge ${warnings ? 'badge-warn' : ''}`}>
            {warnings ? `${warnings} to review` : `${findings.length} note${findings.length > 1 ? 's' : ''}`}
          </span>
        )}
      </div>
      {findings.length === 0 ? (
        <div className="checks-ok">
          <Icon name="checkCircle" size={14} /> No conflicts, duplicates or unusual discounts found
          {hasCart ? '.' : ' (load a cart for item-level checks).'}
        </div>
      ) : (
        <ul>
          {findings.map((f) => (
            <li key={f.title} className={`check check-${f.severity}`}>
              <Icon name={f.severity === 'warning' ? 'alert' : 'info'} size={14} />
              <span>
                <span className="check-title">{f.title}.</span> <span className="check-detail">{f.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
