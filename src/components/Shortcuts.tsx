import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Dialog } from './Dialog'
import { useHotkeys } from './hotkeys'

export interface ShortcutGroup {
  title: string
  items: [keys: ReactNode, description: string][]
}

const usePageShortcuts = create<{ groups: ShortcutGroup[] }>(() => ({ groups: [] }))
const useOverlay = create<{ open: boolean }>(() => ({ open: false }))

export const openShortcuts = () => useOverlay.setState({ open: true })

/** Registers the current page's shortcuts for the "?" overlay. */
export function useShortcutHelp(groups: ShortcutGroup[]) {
  const key = JSON.stringify(groups.map((g) => [g.title, g.items.map((i) => i[1])]))
  useEffect(() => {
    usePageShortcuts.setState({ groups })
    return () => usePageShortcuts.setState({ groups: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

const GLOBAL: ShortcutGroup = {
  title: 'Everywhere',
  items: [
    [<kbd key="q">?</kbd>, 'Show keyboard shortcuts'],
    [<kbd key="e">Esc</kbd>, 'Close dialogs and menus'],
  ],
}

export const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

export function ShortcutsOverlay() {
  const open = useOverlay((s) => s.open)
  const groups = usePageShortcuts((s) => s.groups)
  const [, force] = useState(0)
  useHotkeys({ '?': () => useOverlay.setState({ open: true }), 'shift+?': () => useOverlay.setState({ open: true }) })
  useEffect(() => {
    force((n) => n + 1)
  }, [groups])
  return (
    <Dialog open={open} onClose={() => useOverlay.setState({ open: false })} title="Keyboard shortcuts">
      <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
        {[...groups, GLOBAL].map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl className="shortcuts">
              {g.items.map(([keys, desc], i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <dt>{keys}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
