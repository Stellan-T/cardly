import { useEffect, useRef, type RefObject } from 'react'
import { confirmDialog } from '../../components/confirm'

/** In-app links (the study header's X button is guarded through StudyLayout's confirmExit). */
const LEAVE_SELECTOR = 'a[href]'

/**
 * While `active`, warns before the page unloads and asks for confirmation before
 * leaving through any link outside `scope`.
 *
 * HashRouter has no navigation blocker, so link clicks are intercepted in the
 * capture phase (before React sees them) and replayed once the learner confirms.
 */
export function useLeaveGuard(active: boolean, scope: RefObject<HTMLElement | null>) {
  const bypass = useRef(false)
  useEffect(() => {
    if (!active) return
    bypass.current = false
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      if (bypass.current) {
        bypass.current = false
        return
      }
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(LEAVE_SELECTOR) : null
      if (!el || scope.current?.contains(el) || el.closest('dialog')) return
      if (el instanceof HTMLAnchorElement) {
        const href = el.getAttribute('href') ?? ''
        // New tabs, downloads and in-page anchors (e.g. the skip link) don't leave the test.
        if (el.target === '_blank' || el.hasAttribute('download') || (href.startsWith('#') && !href.startsWith('#/'))) return
      }
      e.preventDefault()
      e.stopPropagation()
      void confirmLeaveTest().then((ok) => {
        if (!ok || !el.isConnected) return
        bypass.current = true
        el.click()
      })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, scope])
}

export function confirmLeaveTest(): Promise<boolean> {
  return confirmDialog({
    title: 'Leave this test?',
    message: 'Your answers haven’t been submitted and won’t be saved.',
    confirmLabel: 'Leave test',
    cancelLabel: 'Keep going',
    danger: true,
  })
}
