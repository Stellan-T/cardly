import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

export type MenuItem =
  | {
      label: string
      icon?: ReactNode
      onSelect?: () => void
      to?: string
      danger?: boolean
      disabled?: boolean
    }
  | 'separator'
  | { heading: string }

interface MenuProps {
  /** Contents of the trigger button. */
  trigger: ReactNode
  label: string
  items: MenuItem[]
  align?: 'left' | 'right'
  up?: boolean
  triggerClassName?: string
}

/** Dropdown menu with arrow-key navigation and Esc to close. */
export function Menu({ trigger, label, items, align = 'right', up, triggerClassName = 'btn btn-icon btn-ghost' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus())
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    const nodes = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nodes[(i + 1) % nodes.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu ${align === 'left' ? 'menu-left' : ''} ${up ? 'menu-up' : ''}`} role="menu" id={id} aria-label={label}>
          {items.map((item, i) => {
            if (item === 'separator') return <div key={i} role="separator" />
            if ('heading' in item)
              return (
                <div key={i} className="menu-label">
                  {item.heading}
                </div>
              )
            const content = (
              <>
                {item.icon}
                <span>{item.label}</span>
              </>
            )
            const close = () => setOpen(false)
            return item.to && !item.disabled ? (
              <Link key={i} role="menuitem" to={item.to} className={item.danger ? 'danger' : ''} onClick={close}>
                {content}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                onClick={() => {
                  close()
                  item.onSelect?.()
                }}
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
