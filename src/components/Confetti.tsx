import { useMemo } from 'react'

const COLORS = ['#0d7a6f', '#3fc2b2', '#d9583b', '#f2b8a6', '#c98a00', '#6b8cff']

/** A short burst of confetti (hidden for reduced motion). */
export function Confetti({ pieces = 80 }: { pieces?: number }) {
  const reduced =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reducedMotion === 'true')
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        color: COLORS[i % COLORS.length],
        duration: 1.4 + Math.random() * 1.2,
      })),
    [pieces],
  )
  if (reduced) return null
  return (
    <div className="confetti" aria-hidden>
      {items.map((p, i) => (
        <i
          key={i}
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
        />
      ))}
    </div>
  )
}
