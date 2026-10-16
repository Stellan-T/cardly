/** The Match board: a grid of tile buttons. Arrow keys, Home and End move between tiles. */
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useCardImage, type ImageSource } from '../../data/images'
import { moveIndex, type MatchState, type MatchTile } from '../../lib/match'
import type { AnswerWith } from '../../types'
import styles from './MatchPage.module.css'
import { useFitText } from './useFitText'

type Emphasis = 'even' | 'answer' | 'prompt'
type TileState = 'idle' | 'selected' | 'wrong' | 'cleared'

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])
/** Largest font size (px) per tile style; long text shrinks from here. */
const MAX_FONT: Record<Emphasis, number> = { even: 20, answer: 22, prompt: 17 }
const MIN_FONT = 11

export function MatchBoard({
  game,
  answerWith,
  imageSource,
  onSelect,
}: {
  game: MatchState
  answerWith: AnswerWith
  imageSource: ImageSource
  onSelect: (tileId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastFocused = useRef(-1)
  const cleared = useMemo(() => new Set(game.cleared), [game.cleared])
  const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-index]') ?? [])]

  // Start with the first tile focused so keyboard players can begin right away.
  useEffect(() => {
    buttons()[0]?.focus({ preventScroll: true })
  }, [])

  // A matched tile can't keep focus: hand it to the nearest tile still in play.
  useEffect(() => {
    const i = lastFocused.current
    const tile = game.tiles[i]
    if (!tile || !cleared.has(tile.id)) return
    const active = document.activeElement
    if (active && active !== document.body && !ref.current?.contains(active)) return
    const live = game.tiles.map((t) => !cleared.has(t.id))
    const after = moveIndex(live, i, 1, 'ArrowRight')
    const next = after >= 0 ? after : moveIndex(live, i, 1, 'ArrowLeft')
    if (next >= 0) buttons()[next]?.focus({ preventScroll: true })
  }, [cleared, game.tiles])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]')
    if (!el || !ref.current) return
    e.preventDefault()
    const cols = getComputedStyle(ref.current).gridTemplateColumns.split(' ').filter(Boolean).length || 1
    const next = moveIndex(
      game.tiles.map((t) => !cleared.has(t.id)),
      Number(el.dataset.index),
      cols,
      e.key,
    )
    if (next >= 0) buttons()[next]?.focus()
  }

  const emphasisOf = (tile: MatchTile): Emphasis => (answerWith === 'both' ? 'even' : answerWith === tile.side ? 'answer' : 'prompt')
  const stateOf = (tile: MatchTile): TileState =>
    cleared.has(tile.id)
      ? 'cleared'
      : game.wrong?.includes(tile.id)
        ? 'wrong'
        : game.selected === tile.id
          ? 'selected'
          : 'idle'

  return (
    <div ref={ref} className={styles.board} role="group" aria-label="Tiles" onKeyDown={onKeyDown}>
      {game.tiles.map((tile, i) => (
        <Tile
          key={tile.id}
          tile={tile}
          index={i}
          state={stateOf(tile)}
          emphasis={emphasisOf(tile)}
          imageSource={imageSource}
          onSelect={onSelect}
          onFocus={() => (lastFocused.current = i)}
        />
      ))}
    </div>
  )
}

function Tile({
  tile,
  index,
  state,
  emphasis,
  imageSource,
  onSelect,
  onFocus,
}: {
  tile: MatchTile
  index: number
  state: TileState
  emphasis: Emphasis
  imageSource: ImageSource
  onSelect: (tileId: string) => void
  onFocus: () => void
}) {
  const url = useCardImage(tile, imageSource)
  const ref = useFitText<HTMLButtonElement>(`${tile.text}\n${url ?? ''}`, MAX_FONT[emphasis], MIN_FONT)
  const className = [
    styles.tile,
    emphasis !== 'even' && styles[emphasis],
    state === 'wrong' && `is-incorrect ${styles.wrong}`,
    state === 'cleared' && `is-correct ${styles.cleared}`,
  ]
    .filter(Boolean)
    .join(' ')
  const text = tile.text.trim()
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-index={index}
      aria-pressed={state === 'selected'}
      aria-hidden={state === 'cleared' || undefined}
      disabled={state === 'cleared'}
      onClick={() => onSelect(tile.id)}
      onFocus={onFocus}
    >
      <span className={styles.tileInner}>
        {url && (
          <img
            className={styles.tileImage}
            src={url}
            alt={text ? '' : 'Picture'}
            draggable={false}
            onError={(e) => (e.currentTarget.hidden = true)}
          />
        )}
        {text && <span className={styles.tileText}>{text}</span>}
      </span>
    </button>
  )
}
