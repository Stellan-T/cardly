import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from './icons'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Wider dialog for tables/previews. */
  wide?: boolean
  /** Side sheet (bottom sheet on phones), used for Options panels. */
  sheet?: boolean
  /** Element to focus first (defaults to the first focusable). */
  initialFocus?: string
  className?: string
}

/** Accessible modal built on the native <dialog> element (focus trap and Esc for free). */
export function Dialog({ open, onClose, title, children, footer, wide, sheet, initialFocus, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      if (initialFocus) el.querySelector<HTMLElement>(initialFocus)?.focus()
    } else if (!open && el.open) el.close()
  }, [open, initialFocus])
  useEffect(() => () => ref.current?.close(), [])
  return (
    <dialog
      ref={ref}
      className={['dialog', wide && 'dialog-wide', sheet && 'dialog-sheet', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <>
          <div className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </>
      )}
    </dialog>
  )
}
