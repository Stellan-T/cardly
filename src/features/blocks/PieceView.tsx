import type { Piece } from '../../lib/blocks'
import styles from './BlocksPage.module.css'

/** A piece drawn with `--cell` sized blocks (tray size, or board size while dragging). */
export function PieceView({ piece }: { piece: Piece }) {
  const { shape, color } = piece
  return (
    <div
      data-piece
      className={styles.piece}
      style={{ gridTemplateColumns: `repeat(${shape.cols}, var(--cell))`, gridTemplateRows: `repeat(${shape.rows}, var(--cell))` }}
      aria-hidden
    >
      {shape.cells.map(([r, c]) => (
        <span key={`${r}-${c}`} className={`${styles.block} ${styles[`c${color}`]}`} style={{ gridRow: r + 1, gridColumn: c + 1 }} />
      ))}
    </div>
  )
}
