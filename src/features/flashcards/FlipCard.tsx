import type { ReactNode } from 'react'
import styles from './FlipCard.module.css'

export interface FaceProps {
  text: string
  image?: ReactNode
  lang?: string
  label: string
}

/** One side of a flashcard: text sized to fit, optional image. */
export function Face({ text, image, lang, label }: FaceProps) {
  const len = text.length
  const size = len < 20 ? 'xl' : len < 60 ? 'lg' : len < 160 ? 'md' : len < 400 ? 'sm' : 'xs'
  return (
    <div className={styles.faceContent}>
      <span className={styles.sideLabel}>{label}</span>
      {image}
      {text && (
        <p className={`${styles.text} ${styles[size]}`} lang={lang && lang !== 'und' ? lang : undefined}>
          {text}
        </p>
      )}
    </div>
  )
}

interface FlipCardProps {
  front: ReactNode
  back: ReactNode
  flipped: boolean
  onFlip: () => void
  /** Buttons shown in the top corner of both faces (star, audio). */
  actions?: ReactNode
  /** Extra class for the outer element (e.g. size). */
  className?: string
  /** Slide direction for the enter animation when the card changes. */
  enter?: 'left' | 'right' | null
  ariaLabel?: string
  /** Shorter card (set page preview). */
  compact?: boolean
}

/** A 3D flip card. Click, tap or Space (handled by the page) flips it. */
export function FlipCard({ front, back, flipped, onFlip, actions, className = '', enter, ariaLabel, compact }: FlipCardProps) {
  return (
    <div className={`${styles.scene} ${compact ? styles.compact : ''} ${className} ${enter ? styles[`enter-${enter}`] : ''}`}>
      <div
        className={`${styles.card} ${flipped ? styles.flipped : ''}`}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel ?? (flipped ? 'Showing back. Activate to flip.' : 'Showing front. Activate to flip.')}
        aria-pressed={flipped}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          onFlip()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onFlip()
          }
        }}
      >
        <div className={`${styles.face} ${styles.front}`} aria-hidden={flipped}>
          {actions && <div className={styles.actions}>{actions}</div>}
          {front}
        </div>
        <div className={`${styles.face} ${styles.back}`} aria-hidden={!flipped}>
          {actions && <div className={styles.actions}>{actions}</div>}
          {back}
        </div>
      </div>
    </div>
  )
}
