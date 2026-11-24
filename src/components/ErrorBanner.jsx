/**
 * ErrorBanner.jsx
 * Displays a list of parse or validation errors (or warnings).
 */
import Icon from './Icon.jsx'

export default function ErrorBanner({ errors, title, variant = 'error' }) {
  if (!errors || errors.length === 0) return null
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon name="alert" />
      <div>
        <div className="alert-title">
          {title ?? `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}
        </div>
        <ul>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
