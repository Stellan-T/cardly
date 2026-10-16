import { useId, type ReactNode } from 'react'

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <label className="switch" htmlFor={id}>
        <span>{label}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const enabled = options.filter((x) => !x.disabled)
            const i = enabled.findIndex((x) => x.value === value)
            const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
            onChange(next.value)
            ;(e.currentTarget.parentElement?.querySelector(`[aria-checked="true"]`) as HTMLElement | null)?.focus()
          }}
          tabIndex={value === o.value ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ value, max = 100, label, tone }: { value: number; max?: number; label?: string; tone?: 'success' | 'warning' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={`progress ${tone ? `progress-${tone}` : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loading" role="status">
      <div className="stack" style={{ alignItems: 'center' }}>
        <span className="spinner spinner-lg" />
        <span className="muted">{label}</span>
      </div>
    </div>
  )
}
