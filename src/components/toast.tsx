import { create } from 'zustand'
import { X } from './icons'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let nextId = 1

export function toast(
  message: string,
  opts: { kind?: Toast['kind']; action?: Toast['action']; duration?: number } = {},
): number {
  const id = nextId++
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind: opts.kind ?? 'info', action: opts.action }] }))
  const duration = opts.duration ?? (opts.action ? 6000 : 3500)
  if (duration > 0) setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                t.action!.onClick()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-icon" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
