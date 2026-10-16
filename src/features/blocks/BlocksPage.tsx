/**
 * Blocks: an 8×8 block puzzle. Drag (or pick and tap, or use the keyboard) the
 * three tray pieces onto the board; full rows and columns clear for points.
 * Once the tray is empty, a correct answer to a question about the set earns
 * the next three pieces. Games don't change term progress, only the top score.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Confetti } from '../../components/Confetti'
import { Segmented } from '../../components/controls'
import { useHotkeys } from '../../components/hotkeys'
import { RotateCcw, Trophy, Zap } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import {
  GRID_SIZE,
  TRAY_SIZE,
  canPlace,
  dealPieces,
  emptyGrid,
  findFit,
  fitsAnywhere,
  isGameOver,
  linesCleared,
  nextCombo,
  place,
  scoreFor,
  type Grid,
  type Piece,
} from '../../lib/blocks'
import { grade } from '../../lib/grade'
import { otherSide, sideText } from '../../lib/questions'
import { createRng, randomSeed, type Rng } from '../../lib/random'
import { playSound } from '../../lib/sound'
import type { AnswerWith, Card } from '../../types'
import { useStudySet } from '../sets/StudySetContext'
import { AnswerWithOption, GradingOptions, StarredOnlyOption } from '../study/CommonOptions'
import { OptionGroup, StudyLayout } from '../study/StudyLayout'
import { useGrading, useHasStarred, useModeOptions, useProgress, useSpeech, useStudyActivity, useStudyCards } from '../study/hooks'
import { PieceView } from './PieceView'
import { QuestionPanel, type Answered } from './QuestionPanel'
import { buildQuestion, drawFromDeck, exactish, type BlocksQuestion, type QuestionFormat } from './questions'
import { usePieceDrag } from './useDrag'
import styles from './BlocksPage.module.css'

interface BlocksOptions {
  starredOnly: boolean
  format: QuestionFormat
  answerWith: AnswerWith
}

const DEFAULTS: BlocksOptions = { starredOnly: false, format: 'mc', answerWith: 'term' }
const MIN_CARDS = 6

type Phase = 'play' | 'question' | 'over'

interface Game {
  grid: Grid
  tray: (Piece | null)[]
  score: number
  combo: number
  phase: Phase
  /** Counts deals; keys the tray so every deal gets fresh slots. */
  deal: number
}

interface Spot {
  row: number
  col: number
}

interface Pop {
  key: number
  points: number
  label: string
  big: boolean
  /** Centre of the placed piece, in % of the board. */
  x: number
  y: number
}

interface QuestionState {
  id: number
  q: BlocksQuestion
  answered: Answered | null
}

interface Result {
  score: number
  best: number
  record: boolean
}

type FocusTarget = 'tray' | 'board' | 'question' | 'playAgain'

const newGame = (rng: Rng): Game => ({ grid: emptyGrid(), tray: dealPieces(rng), score: 0, combo: 0, phase: 'play', deal: 1 })

const fmt = (n: number) => n.toLocaleString()
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const MULTI_LABEL: Record<number, string> = { 2: 'Double!', 3: 'Triple!' }

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true'

function pieceName({ shape }: Piece): string {
  if (shape.cells.length === 1) return shape.name
  return `${shape.name}, ${plural(shape.cells.length, 'block')}, ${shape.rows} tall by ${shape.cols} wide`
}

/** Top-left spot that centres the shape on a cell, kept on the board. */
function centredOn(piece: Piece, row: number, col: number): Spot {
  const { rows, cols } = piece.shape
  return {
    row: clamp(row - Math.floor((rows - 1) / 2), 0, GRID_SIZE - rows),
    col: clamp(col - Math.floor((cols - 1) / 2), 0, GRID_SIZE - cols),
  }
}

function cellOf(target: EventTarget): Spot | null {
  const el = (target as Element).closest?.<HTMLElement>('[data-cell]')
  return el ? { row: Number(el.dataset.r), col: Number(el.dataset.c) } : null
}

export default function BlocksPage() {
  const { imageSource, progress, status } = useStudySet()
  const [opts, setOpts] = useModeOptions<BlocksOptions>('blocks', DEFAULTS)
  const hasStarred = useHasStarred()
  const pool = useStudyCards(opts.starredOnly && hasStarred)
  const { stats } = useProgress()
  const best = stats.bestBlocks ?? 0
  const { level, requireOne } = useGrading()
  const { say } = useSpeech()
  const { markStudied } = useStudyActivity('blocks')

  const rngRef = useRef<Rng | null>(null)
  const rng = () => (rngRef.current ??= createRng(randomSeed()))
  const [game, setGame] = useState<Game>(() => newGame(rng()))
  const [selected, setSelected] = useState<number | null>(null)
  const [cursor, setCursorState] = useState<Spot>({ row: 0, col: 0 })
  // Handlers read the ref so quick key repeats never act on a stale position.
  const cursorRef = useRef(cursor)
  const setCursor = (spot: Spot) => {
    cursorRef.current = spot
    setCursorState(spot)
  }
  const [question, setQuestion] = useState<QuestionState | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [flash, setFlash] = useState<{ key: number; cells: Map<number, number> } | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [live, setLive] = useState('')

  const boardRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const playAgainRef = useRef<HTMLButtonElement>(null)
  const deckRef = useRef<string[]>([])
  const keyRef = useRef(0)
  const pendingFocus = useRef<FocusTarget | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const helpId = useId()
  const overId = useId()

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }

  // ---------------------------------------------------------------------------
  // Questions
  // ---------------------------------------------------------------------------

  const askQuestion = ({ exclude = null, card, focus = true }: { exclude?: string | null; card?: Card; focus?: boolean } = {}) => {
    let next = card
    if (!next) {
      const drawn = drawFromDeck(deckRef.current, pool.map((c) => c.id), exclude, rng())
      deckRef.current = drawn.deck
      next = pool.find((c) => c.id === drawn.id)
    }
    if (!next) {
      setQuestion(null)
      return
    }
    setQuestion({ id: ++keyRef.current, q: buildQuestion(next, pool, opts.format, opts.answerWith, rng()), answered: null })
    if (focus) pendingFocus.current = 'question'
  }

  const finish = (score: number): string => {
    const prevBest = latest.current.best
    const record = score > prevBest
    if (record) progress?.patchStats({ bestBlocks: score })
    setResult({ score, best: Math.max(prevBest, score), record })
    setSelected(null)
    pendingFocus.current = 'playAgain'
    playSound(record ? 'complete' : 'incorrect')
    return `Game over: none of your pieces fit. Final score ${fmt(score)}.${record ? ' New top score!' : ` Top score ${fmt(prevBest)}.`}`
  }

  const dealNext = () => {
    const g = latest.current.game
    if (g.phase !== 'question') return
    const tray = dealPieces(rng(), g.grid)
    const over = isGameOver(g.grid, tray)
    const inPanel = !!panelRef.current?.contains(document.activeElement)
    setGame({ ...g, tray, phase: over ? 'over' : 'play', deal: g.deal + 1 })
    setQuestion(null)
    if (over) {
      setLive(finish(g.score))
      return
    }
    if (inPanel) pendingFocus.current = 'tray'
    const top = boardRef.current?.getBoundingClientRect().top ?? 0
    if (top < 70) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
    setLive(`3 new pieces: ${tray.map(pieceName).join('; ')}.`)
  }

  const answer = (a: Answered) => {
    if (!question || question.answered) return
    const { q } = question
    setQuestion({ ...question, answered: a })
    const correctText = sideText(q.card, q.answerSide)
    if (a.correct) {
      playSound('correct')
      setLive(`Correct! ${exactish(a.reason) ? '' : `The answer is ${correctText}. `}Here come 3 new pieces.`)
      later(dealNext, exactish(a.reason) ? 900 : 1800)
    } else {
      playSound('incorrect')
      setLive(`Not quite. The ${q.answerSide} is ${correctText}.`)
    }
  }

  const onChoice = (i: number) => {
    if (question?.q.kind === 'mc') answer({ correct: i === question.q.correctIndex, choice: i })
  }
  const onTrueFalse = (v: boolean) => {
    if (question?.q.kind === 'tf') answer({ correct: v === question.q.isTrue, tf: v })
  }
  const onWritten = (text: string) => {
    if (question?.q.kind !== 'written') return
    const r = grade(text, question.q.answer, { level, requireOne })
    answer({ correct: r.correct, text, reason: r.reason })
  }
  const refreshQuestion = () => {
    if (question && !question.answered) askQuestion({ exclude: question.q.card.id })
  }
  const nextQuestion = () => askQuestion({ exclude: question?.q.card.id ?? null })

  // ---------------------------------------------------------------------------
  // Placing pieces
  // ---------------------------------------------------------------------------

  const describeSpot = (piece: Piece, row: number, col: number) => {
    const where = `Row ${row + 1}, column ${col + 1}:`
    if (!canPlace(game.grid, piece.shape, row, col)) return `${where} doesn’t fit.`
    const lines = linesCleared(place(game.grid, piece.shape, row, col))
    return lines ? `${where} fits and clears ${plural(lines, 'line')}.` : `${where} fits.`
  }

  const placePiece = (slot: number, row: number, col: number): boolean => {
    const piece = game.tray[slot]
    if (game.phase !== 'play' || !piece || !canPlace(game.grid, piece.shape, row, col)) return false
    const { shape, color } = piece
    const res = place(game.grid, shape, row, col, color)
    const lines = linesCleared(res)
    const combo = nextCombo(game.combo, lines)
    const points = scoreFor(res.cellsPlaced, lines, combo)
    const score = game.score + points
    const tray = game.tray.map((p, i) => (i === slot ? null : p))
    const over = isGameOver(res.grid, tray)
    const phase: Phase = over ? 'over' : tray.some(Boolean) ? 'play' : 'question'
    const trayHadFocus = !!trayRef.current?.contains(document.activeElement)
    setGame({ ...game, grid: res.grid, tray, score, combo, phase })
    setSelected(null)
    markStudied()

    if (lines) {
      const before = game.grid.map((r) => [...r])
      for (const [dr, dc] of shape.cells) before[row + dr][col + dc] = color
      const cells = new Map<number, number>()
      for (const r of res.clearedRows) for (let c = 0; c < GRID_SIZE; c++) cells.set(r * GRID_SIZE + c, before[r][c])
      for (const c of res.clearedCols) for (let r = 0; r < GRID_SIZE; r++) cells.set(r * GRID_SIZE + c, before[r][c])
      const key = ++keyRef.current
      setFlash({ key, cells })
      later(() => setFlash((f) => (f?.key === key ? null : f)), 450)
      playSound('clear')
    } else playSound('place')

    const popKey = ++keyRef.current
    const label = [lines >= 2 ? (MULTI_LABEL[lines] ?? `${lines} lines!`) : '', combo >= 2 ? `Combo ×${combo}` : '']
    setPop({
      key: popKey,
      points,
      label: label.filter(Boolean).join(' · '),
      big: lines > 0,
      x: clamp(((col + shape.cols / 2) / GRID_SIZE) * 100, 14, 86),
      y: clamp(((row + shape.rows / 2) / GRID_SIZE) * 100, 8, 92),
    })
    later(() => setPop((p) => (p?.key === popKey ? null : p)), 1200)

    const said = [`Placed, plus ${points} points.`]
    if (lines) said.push(`Cleared ${plural(lines, 'line')}.`)
    if (combo >= 2) said.push(`Combo ${combo}.`)
    if (over) said.push(finish(score))
    else if (phase === 'question') {
      said.push('Answer a question to get 3 new pieces.')
      askQuestion()
    } else if (trayHadFocus) pendingFocus.current = 'tray'
    setLive(said.join(' '))
    return true
  }

  const selectSlot = (slot: number) => {
    const piece = game.tray[slot]
    if (game.phase !== 'play' || !piece) return
    if (selected === slot) {
      setSelected(null)
      setLive('Piece put back.')
      return
    }
    const { shape } = piece
    const from = cursorRef.current
    let spot = { row: clamp(from.row, 0, GRID_SIZE - shape.rows), col: clamp(from.col, 0, GRID_SIZE - shape.cols) }
    if (!canPlace(game.grid, shape, spot.row, spot.col)) {
      const fit = findFit(game.grid, shape)
      if (fit) spot = { row: fit[0], col: fit[1] }
    }
    setSelected(slot)
    setCursor(spot)
    pendingFocus.current = 'board'
    setLive(`${pieceName(piece)} picked. ${describeSpot(piece, spot.row, spot.col)} Move it with the arrow keys, Enter places it.`)
  }

  const cancelSelection = (focusSlot: boolean) => {
    if (selected === null) return
    if (focusSlot) slotRefs.current[selected]?.focus()
    setSelected(null)
    setLive('Piece put back.')
  }

  const { drag, bind, cancel: cancelDrag, isDragClick } = usePieceDrag({
    boardRef,
    ghostRef,
    shapeOf: (slot) => (game.phase === 'play' ? (game.tray[slot]?.shape ?? null) : null),
    onStart: () => setSelected(null),
    onDrop: (slot, row, col) => {
      if (!placePiece(slot, row, col)) setLive('Doesn’t fit there.')
    },
  })

  const onBoardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (game.phase !== 'play' || e.altKey || e.ctrlKey || e.metaKey) return
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const move = moves[e.key]
    const piece = selected !== null ? game.tray[selected] : null
    if (e.key === 'Escape') {
      if (!piece) return
      e.preventDefault()
      cancelSelection(true)
      return
    }
    if (!move && e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (selected === null || !piece) {
      const fitting = game.tray.findIndex((p) => p && fitsAnywhere(game.grid, p.shape))
      const first = fitting >= 0 ? fitting : game.tray.findIndex(Boolean)
      if (first >= 0) selectSlot(first)
      return
    }
    const at = cursorRef.current
    if (move) {
      const row = clamp(at.row + move[0], 0, GRID_SIZE - piece.shape.rows)
      const col = clamp(at.col + move[1], 0, GRID_SIZE - piece.shape.cols)
      setCursor({ row, col })
      setLive(describeSpot(piece, row, col))
    } else if (!placePiece(selected, at.row, at.col)) setLive('Doesn’t fit there.')
  }

  // Mouse: the picked piece follows the pointer. Click (or tap) inside the preview places it; elsewhere moves it there.
  const onBoardPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || drag || selected === null) return
    const piece = game.tray[selected]
    const cell = cellOf(e.target)
    if (!piece || !cell) return
    const spot = centredOn(piece, cell.row, cell.col)
    if (spot.row !== cursorRef.current.row || spot.col !== cursorRef.current.col) setCursor(spot)
  }

  const onBoardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (game.phase !== 'play' || selected === null) return
    const piece = game.tray[selected]
    const cell = cellOf(e.target)
    if (!piece || !cell) return
    const { rows, cols } = piece.shape
    const at = cursorRef.current
    const inside = cell.row >= at.row && cell.row < at.row + rows && cell.col >= at.col && cell.col < at.col + cols
    if (inside && placePiece(selected, at.row, at.col)) return
    const spot = centredOn(piece, cell.row, cell.col)
    setCursor(spot)
    setLive(describeSpot(piece, spot.row, spot.col))
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------

  const saveBestSoFar = () => {
    const { game: g, best: b } = latest.current
    if (g.phase !== 'over' && g.score > b) progress?.patchStats({ bestBlocks: g.score })
  }

  const restart = () => {
    saveBestSoFar()
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    cancelDrag()
    rngRef.current = createRng(randomSeed())
    setGame(newGame(rngRef.current))
    setSelected(null)
    setCursor({ row: 0, col: 0 })
    setQuestion(null)
    setResult(null)
    setFlash(null)
    setPop(null)
    deckRef.current = []
    pendingFocus.current = 'tray'
    setLive('New game. 3 pieces in the tray.')
  }

  const latest = useRef({ game, best, question, askQuestion, saveBestSoFar })
  latest.current = { game, best, question, askQuestion, saveBestSoFar }

  // Keep the top score when leaving mid-game; clear pending timers.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      latest.current.saveBestSoFar()
    }
  }, [])

  // Rebuild an unanswered question when the question options or the terms change.
  const poolKey = useMemo(() => pool.map((c) => c.id).join(','), [pool])
  const questionKey = `${opts.format}|${opts.answerWith}|${poolKey}`
  const lastQuestionKey = useRef(questionKey)
  useEffect(() => {
    if (lastQuestionKey.current === questionKey) return
    lastQuestionKey.current = questionKey
    const { game: g, question: cur, askQuestion: ask } = latest.current
    if (g.phase !== 'question' || cur?.answered) return
    const keep = cur && pool.find((c) => c.id === cur.q.card.id)
    ask({ card: keep || undefined, focus: false })
  }, [questionKey, pool])

  // Move focus where the game continues (after the render that shows it).
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target === 'question') {
      const fine = window.matchMedia?.('(pointer: fine)').matches
      const el = (fine && inputRef.current) || panelRef.current
      el?.focus({ preventScroll: true })
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    } else if (target === 'tray') slotRefs.current.find((el) => el && !el.disabled)?.focus({ preventScroll: true })
    else if (target === 'board') boardRef.current?.focus({ preventScroll: true })
    else playAgainRef.current?.focus()
  })

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  const openQ = question && !question.answered ? question.q : null
  const numberKey = (n: number) => () => {
    if (game.phase === 'play') {
      if (n < TRAY_SIZE) selectSlot(n)
    } else if (openQ?.kind === 'mc' && n < openQ.choices.length) onChoice(n)
    else if (openQ?.kind === 'tf' && n < 2) onTrueFalse(n === 0)
  }
  useHotkeys(
    {
      '1': numberKey(0),
      '2': numberKey(1),
      '3': numberKey(2),
      '4': numberKey(3),
      t: () => openQ?.kind === 'tf' && onTrueFalse(true),
      f: () => openQ?.kind === 'tf' && onTrueFalse(false),
      r: () => refreshQuestion(),
      a: () => question && say(question.q.prompt, otherSide(question.q.answerSide)),
      escape: () => cancelSelection(true),
    },
    { enabled: status === 'ready' && pool.length >= MIN_CARDS },
  )
  useShortcutHelp([
    {
      title: 'Blocks',
      items: [
        [
          <>
            <K>1</K> <K>2</K> <K>3</K>
          </>,
          'Pick a piece from the tray',
        ],
        [
          <>
            <K>←</K> <K>↑</K> <K>→</K> <K>↓</K>
          </>,
          'Move the picked piece on the board',
        ],
        [<K>Enter</K>, 'Place the piece'],
        [<K>Esc</K>, 'Put the piece back'],
      ],
    },
    {
      title: 'Questions',
      items: [
        [
          <>
            <K>1</K>–<K>4</K>
          </>,
          'Choose an answer',
        ],
        [
          <>
            <K>T</K> <K>F</K>
          </>,
          'True or false',
        ],
        [<K>R</K>, 'Refresh question'],
        [<K>A</K>, 'Play audio'],
      ],
    },
  ])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const active = drag ? (drag.anchor ? { slot: drag.slot, ...drag.anchor } : null) : selected !== null ? { slot: selected, ...cursor } : null
  const activePiece = active ? game.tray[active.slot] : null
  let preview: { cells: Set<number>; clear: Set<number>; valid: boolean; color: number } | null = null
  if (active && activePiece && game.phase === 'play') {
    const { shape, color } = activePiece
    const valid = canPlace(game.grid, shape, active.row, active.col)
    const cells = new Set<number>()
    for (const [dr, dc] of shape.cells) {
      const r = active.row + dr
      const c = active.col + dc
      if (r >= 0 && c >= 0 && r < GRID_SIZE && c < GRID_SIZE) cells.add(r * GRID_SIZE + c)
    }
    const clear = new Set<number>()
    if (valid) {
      const res = place(game.grid, shape, active.row, active.col)
      for (const r of res.clearedRows) for (let c = 0; c < GRID_SIZE; c++) clear.add(r * GRID_SIZE + c)
      for (const c of res.clearedCols) for (let r = 0; r < GRID_SIZE; r++) clear.add(r * GRID_SIZE + c)
    }
    preview = { cells, clear, valid, color }
  }

  const cells = []
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const i = r * GRID_SIZE + c
      const v = game.grid[r][c]
      const inShape = !!preview?.cells.has(i)
      const clearing = !!preview?.clear.has(i)
      const color = preview && (clearing || (inShape && preview.valid)) ? preview.color : v
      const flashColor = v ? undefined : flash?.cells.get(i)
      const cls = [
        styles.cell,
        v && styles.filled,
        inShape && preview?.valid && styles.preview,
        clearing && styles.willClear,
        inShape && !preview?.valid && styles.bad,
        color && styles[`c${color}`],
      ]
      cells.push(
        <div key={i} data-cell data-r={r} data-c={c} className={cls.filter(Boolean).join(' ')}>
          {flashColor ? <span key={flash!.key} className={`${styles.flash} ${styles[`c${flashColor}`]}`} /> : null}
        </div>,
      )
    }
  }

  const dragPiece = drag ? game.tray[drag.slot] : null
  const showTray = game.phase === 'play' || game.phase === 'over'

  const options = (close: () => void) => (
    <>
      <OptionGroup title="Questions">
        <StarredOnlyOption value={opts.starredOnly} onChange={(v) => setOpts({ starredOnly: v })} />
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <span>Question format</span>
          <Segmented<QuestionFormat>
            label="Question format"
            value={opts.format}
            onChange={(v) => setOpts({ format: v })}
            options={[
              { value: 'mc', label: 'Multiple choice' },
              { value: 'written', label: 'Written' },
              { value: 'tf', label: 'True/false' },
              { value: 'mixed', label: 'Mixed' },
            ]}
          />
        </div>
        <AnswerWithOption value={opts.answerWith} onChange={(v) => setOpts({ answerWith: v })} />
      </OptionGroup>
      {(opts.format === 'written' || opts.format === 'mixed') && (
        <OptionGroup title="Written answers">
          <GradingOptions />
        </OptionGroup>
      )}
      <OptionGroup title="Game">
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              close()
              restart()
            }}
          >
            <RotateCcw size={18} aria-hidden /> Restart
          </button>
        </div>
        <span className="hint">
          Games don’t change your progress on terms. Sound effects follow the sound setting in Settings.
        </span>
      </OptionGroup>
    </>
  )

  const headerExtra = (
    <span className={styles.headerScore}>
      <span className={styles.headerLabel}>Score</span>
      <strong>{fmt(game.score)}</strong>
    </span>
  )

  return (
    <StudyLayout mode="blocks" options={options} minCards={MIN_CARDS} availableCards={pool.length} headerExtra={headerExtra}>
      <div className={styles.game}>
        <div className={styles.boardCol}>
          <div className={styles.boardWrap}>
            <div
              ref={boardRef}
              className={`${styles.board} ${game.phase === 'over' ? styles.boardOver : ''}`}
              role="application"
              aria-roledescription="puzzle board"
              aria-label="Board, 8 by 8"
              aria-describedby={helpId}
              tabIndex={game.phase === 'play' ? 0 : -1}
              onKeyDown={onBoardKeyDown}
              onClick={onBoardClick}
              onPointerMove={onBoardPointerMove}
            >
              {cells}
            </div>
            {pop && (
              <div
                key={pop.key}
                className={`${styles.pop} ${pop.big ? styles.popBig : ''}`}
                style={{ left: `${pop.x}%`, top: `${pop.y}%` }}
                aria-hidden
              >
                +{fmt(pop.points)}
                {pop.label && <span className={styles.popLabel}>{pop.label}</span>}
              </div>
            )}
          </div>
          <p id={helpId} className="sr-only">
            Pick a piece with 1, 2 or 3, move it with the arrow keys and press Enter to place it. Escape puts it back. Fill a
            row or column to clear it.
          </p>
          <div className={styles.status}>
            <span className="badge">
              <Trophy size={14} aria-hidden /> Top score {best > 0 ? fmt(best) : '–'}
            </span>
            {game.combo >= 2 && game.phase !== 'over' && (
              <span className="badge badge-accent">
                <Zap size={14} aria-hidden /> Combo ×{game.combo}
              </span>
            )}
          </div>
        </div>

        <div className={styles.side}>
          {showTray && (
            <div ref={trayRef} className={styles.tray} role="group" aria-label="Pieces">
              {game.tray.map((p, i) => {
                const key = `${game.deal}-${i}`
                if (!p) return <div key={key} className={styles.slotEmpty} aria-hidden />
                const fits = fitsAnywhere(game.grid, p.shape)
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      slotRefs.current[i] = el
                    }}
                    type="button"
                    className={[styles.slot, !fits && styles.noFit, drag?.slot === i && styles.slotDragging].filter(Boolean).join(' ')}
                    aria-pressed={selected === i}
                    aria-label={`Piece ${i + 1}: ${pieceName(p)}${fits ? '' : ', doesn’t fit anywhere'}`}
                    title={`Drag onto the board, or pick it (${i + 1}) and tap where it goes`}
                    disabled={game.phase !== 'play'}
                    {...bind(i)}
                    onClick={(e) => {
                      if (!isDragClick(e)) selectSlot(i)
                    }}
                  >
                    <PieceView piece={p} />
                  </button>
                )
              })}
            </div>
          )}
          {game.phase === 'play' && game.deal === 1 && game.score === 0 && (
            <p className={`subtle ${styles.hint}`}>
              Drag a piece onto the board, or tap a piece and then the board. Fill a row or column to clear it.
            </p>
          )}

          {game.phase === 'question' &&
            (question ? (
              <QuestionPanel
                key={question.id}
                question={question.q}
                answered={question.answered}
                imageSource={imageSource}
                panelRef={panelRef}
                inputRef={inputRef}
                onChoice={onChoice}
                onTrueFalse={onTrueFalse}
                onWritten={onWritten}
                onRefresh={refreshQuestion}
                onNext={nextQuestion}
              />
            ) : (
              <div className="alert alert-warning">There are no terms to ask about. Change the options to continue.</div>
            ))}

          {game.phase === 'over' && result && (
            <section className={`panel ${styles.over}`} aria-labelledby={overId}>
              {result.record && <Confetti />}
              <h2 id={overId}>
                {result.record ? (
                  <>
                    <Trophy size={22} className={styles.record} aria-hidden /> New top score!
                  </>
                ) : (
                  'Game over'
                )}
              </h2>
              <p className="muted">None of your pieces fit on the board.</p>
              <div className={styles.overStats}>
                <div>
                  <span className="subtle">Final score</span>
                  <strong>{fmt(result.score)}</strong>
                </div>
                <div>
                  <span className="subtle">Top score</span>
                  <strong>{fmt(result.best)}</strong>
                </div>
              </div>
              <button ref={playAgainRef} type="button" className="btn btn-primary btn-lg" onClick={restart}>
                <RotateCcw size={18} aria-hidden /> Play again
              </button>
            </section>
          )}
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {live}
      </div>

      {drag &&
        dragPiece &&
        createPortal(
          <div
            ref={ghostRef}
            className={`${styles.ghost} ${drag.anchor && !preview?.valid ? styles.ghostBad : ''}`}
            style={{ '--cell': `${drag.cell}px`, '--gap': `${drag.gap}px` } as React.CSSProperties}
            aria-hidden
          >
            <PieceView piece={dragPiece} />
          </div>,
          document.body,
        )}
    </StudyLayout>
  )
}
