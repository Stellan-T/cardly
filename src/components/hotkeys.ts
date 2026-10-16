import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Normalises a keyboard event into "mod+z", "shift+/", " ", "arrowleft", "1", … */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === '?') return [...parts, '?'].join('+')
  parts.push(key)
  return parts.join('+')
}

/**
 * Page-level keyboard shortcuts. Ignored while typing in a field (unless the
 * handler name is listed in `allowInInputs`) and while a dialog is open.
 */
export function useHotkeys(
  map: HotkeyMap,
  options: { enabled?: boolean; allowInInputs?: string[]; /** Handle these even when a button has focus. */ force?: string[] } = {},
) {
  const ref = useRef(map)
  ref.current = map
  const { enabled = true } = options
  const allow = options.allowInInputs?.join(',') ?? ''
  const forceKeys = options.force?.join(',') ?? ''
  useEffect(() => {
    if (!enabled) return
    const allowed = new Set(allow ? allow.split(',') : [])
    const forced = new Set(forceKeys ? forceKeys.split(',') : [])
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const name = keyName(e)
      const handler = ref.current[name]
      if (!handler) return
      if (document.querySelector('dialog[open]')) return
      if (isTyping(e.target) && !allowed.has(name)) return
      // Don't hijack Space/Enter on focused buttons and links.
      if (
        (name === 'space' || name === 'enter') &&
        !forced.has(name) &&
        e.target instanceof HTMLElement &&
        e.target.closest('button,a,[role="radio"]')
      )
        return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, allow, forceKeys])
}
