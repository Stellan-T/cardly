import { useEffect, useRef, useState } from 'react'
import { Timer } from '../../components/icons'
import { formatTenths } from '../../lib/format'
import { elapsedMs, finalTimeMs, type MatchState } from '../../lib/match'
import styles from './MatchPage.module.css'

/**
 * The game clock for the study header, in tenths of a second. It reads 0.0
 * until the first tap, and shows a short "+1" after each wrong pair
 * (`penaltyKey` changes per miss; 0 hides it). Key it by game so it resets.
 */
export function MatchClock({ game, penaltyKey }: { game: MatchState | null; penaltyKey: number }) {
  const [ms, setMs] = useState(0)
  const latest = useRef(game)
  latest.current = game
  const running = !!game && game.startedAt !== null && game.finishedAt === null

  useEffect(() => {
    if (!running) return
    let frame = 0
    let shown = -1
    const tick = () => {
      const g = latest.current
      if (g) {
        const now = elapsedMs(g, performance.now())
        const tenths = Math.floor(now / 100)
        if (tenths !== shown) {
          shown = tenths
          setMs(now)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running])

  const value = !game || game.startedAt === null ? 0 : (finalTimeMs(game) ?? ms)
  return (
    <span className={styles.clockWrap}>
      <span className={styles.clock} role="timer" aria-label="Time in seconds">
        <Timer size={16} aria-hidden />
        <span>
          {formatTenths(value)}
          <span className={styles.unit} aria-hidden>
            s
          </span>
        </span>
      </span>
      {penaltyKey > 0 && (
        <span key={penaltyKey} className={styles.penalty} aria-hidden>
          +1
        </span>
      )}
    </span>
  )
}
