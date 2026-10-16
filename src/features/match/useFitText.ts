import { useLayoutEffect, useRef } from 'react'

/**
 * Shrinks an element's font size (from `max` down to `min` px) until its
 * content fits the element's box; re-fits when `key` or the box size changes.
 * If the content doesn't fit even at `min`, sets `data-overflow="true"` so CSS
 * can let the box grow instead of clipping the text.
 */
export function useFitText<T extends HTMLElement>(key: string, max: number, min = 12) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fits = () => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
    const fit = () => {
      // Without data-overflow, CSS wraps only between words, so a long word that
      // would have to be split counts as "not fitting" and the text shrinks instead.
      delete el.dataset.overflow
      let lo = min
      let hi = max
      let best = min
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        el.style.fontSize = `${mid}px`
        if (fits()) {
          best = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      el.style.fontSize = `${best}px`
      // Even the smallest size is too big: CSS then breaks words and lets the tile grow.
      if (!fits()) el.dataset.overflow = 'true'
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    let height = el.clientHeight
    const ro = new ResizeObserver(() => {
      // A grown (overflowing) box changes height because of its own content: only a new width matters then.
      const resized =
        Math.abs(el.clientWidth - width) >= 1 || (el.dataset.overflow !== 'true' && Math.abs(el.clientHeight - height) >= 1)
      if (resized) fit()
      width = el.clientWidth
      height = el.clientHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key, max, min])
  return ref
}
