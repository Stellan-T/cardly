/**
 * Match: a timed game. Tap a term and then its definition to clear the pair;
 * a wrong pair adds a second. Games don't change term progress, but each set
 * keeps the player's best times (plus a shared leaderboard for shared sets).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Switch } from '../../components/controls'
import { useHotkeys } from '../../components/hotkeys'
import { Play, RotateCcw, Timer, Trophy } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import { submitMatchTime } from '../../data/leaderboard'
import { formatTenths, plural } from '../../lib/format'
import {
  buildTiles,
  clearMiss,
  finalTimeMs,
  matchOrder,
  newGame,
  pairsLeft,
  PENALTY_MS,
  pickRound,
  recordRun,
  ROUND_SIZE,
  selectTile,
  type MatchState,
} from '../../lib/match'
import { createRng, randomSeed } from '../../lib/random'
import { playSound } from '../../lib/sound'
import type { AnswerWith } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'
import { AnswerWithOption, StarredOnlyOption } from '../study/CommonOptions'
import { useHasStarred, useModeOptions, useProgress, useSessionState, useSpeech, useStudyActivity, useStudyCards } from '../study/hooks'
import { OptionGroup, StudyLayout } from '../study/StudyLayout'
import { MatchBoard } from './MatchBoard'
import { MatchClock } from './MatchClock'
import styles from './MatchPage.module.css'
import { MatchResults, type MatchResult } from './MatchResults'

interface MatchOptions {
  /** The "answer" side: shown larger and read aloud. 'both' treats both sides alike. */
  answerWith: AnswerWith
  starredOnly: boolean
  /** Read a tile aloud when it's tapped. */
  audio: boolean
}

const DEFAULTS: MatchOptions = { answerWith: 'both', starredOnly: false, audio: false }
const COUNTDOWN_FROM = 3
const COUNTDOWN_STEP_MS = 700
/** How long a wrong pair stays red. */
const MISS_FLASH_MS = 600
/** How long the "+1" by the clock stays up. */
const PENALTY_TOAST_MS = 900
/** Lets the last pair's clear animation play before the results. */
const FINISH_DELAY_MS = 450

type Phase = { kind: 'intro' } | { kind: 'countdown'; count: number } | { kind: 'playing' } | { kind: 'done' }

export default function MatchPage() {
  const { setId, isPublic, meta, session, progress, imageSource } = useStudySet()
  const { uid, displayName } = useAuth()
  const [options, setOptions] = useModeOptions<MatchOptions>('match', DEFAULTS)
  const hasStarred = useHasStarred()
  const pool = useStudyCards(options.starredOnly && hasStarred)
  const { matchCursor } = useSessionState()
  const { stats, loaded: statsLoaded } = useProgress()
  const { say } = useSpeech()
  const { markStudied } = useStudyActivity('match')
  const shared = isPublic || meta.visibility === 'link'
  const canPlay = pool.length >= 2

  const [phase, setPhase] = useState<Phase>({ kind: 'intro' })
  const [game, setGame] = useState<MatchState | null>(null)
  const [gameNo, setGameNo] = useState(0)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [penaltyKey, setPenaltyKey] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  // The latest game, updated synchronously so rapid taps never act on a stale board.
  const gameRef = useRef<MatchState | null>(null)

  const commit = (next: MatchState | null) => {
    gameRef.current = next
    setGame(next)
  }

  const startGame = () => {
    if (!canPlay) return
    // Walk a stable order of the cards so repeated games cover the whole set. A pool that fits on one board
    // (e.g. a small "?terms=" subset) leaves the saved cursor alone.
    const order = matchOrder(pool.map((c) => c.id))
    const { ids, nextCursor } = pickRound(order, typeof matchCursor === 'number' ? matchCursor : 0)
    if (order.length > ROUND_SIZE) session?.patch('matchCursor', nextCursor)
    commit(newGame(buildTiles(pool, ids, createRng(randomSeed()))))
    setGameNo((n) => n + 1)
    setResult(null)
    setPenaltyKey(0)
    setAnnouncement('')
    setPhase({ kind: 'countdown', count: COUNTDOWN_FROM })
    markStudied()
  }

  const backToStart = () => {
    commit(null)
    setResult(null)
    setPenaltyKey(0)
    setPhase({ kind: 'intro' })
  }

  const onSelect = (tileId: string) => {
    const g = gameRef.current
    if (!g || phase.kind !== 'playing') return
    const next = selectTile(g, tileId, performance.now())
    if (next === g || !next.last) return
    commit(next)
    const { event } = next.last
    const tile = next.tiles.find((t) => t.id === tileId)
    if (tile && event !== 'deselect' && options.audio && (options.answerWith === 'both' || options.answerWith === tile.side))
      say(tile.text, tile.side)
    if (event === 'miss') {
      playSound('incorrect')
      setPenaltyKey(next.misses)
      setAnnouncement(`Not a match, plus 1 second (${plural(next.misses, 'miss', 'misses')}).`)
    } else if (event === 'match') {
      playSound('match')
      setAnnouncement(`Match! ${plural(pairsLeft(next), 'pair')} left.`)
    } else if (event === 'finish') {
      const ms = finalTimeMs(next) ?? 0
      playSound('match')
      const pairs = next.tiles.length / 2
      setResult({ ms, at: Date.now(), misses: next.misses, pairs, saved: false, prevBest: null, isRecord: false })
      setAnnouncement(`Finished in ${formatTenths(ms)} seconds.`)
    }
  }

  // 3-2-1, then the board.
  useEffect(() => {
    if (phase.kind !== 'countdown') return
    const t = setTimeout(
      () => setPhase(phase.count > 1 ? { kind: 'countdown', count: phase.count - 1 } : { kind: 'playing' }),
      COUNTDOWN_STEP_MS,
    )
    return () => clearTimeout(t)
  }, [phase])

  // A wrong pair flashes red briefly (or until the next tap).
  const wrong = game?.wrong
  useEffect(() => {
    if (!wrong) return
    const t = setTimeout(() => {
      const g = gameRef.current
      if (g && g.wrong === wrong) commit(clearMiss(g))
    }, MISS_FLASH_MS)
    return () => clearTimeout(t)
  }, [wrong])

  useEffect(() => {
    if (!penaltyKey) return
    const t = setTimeout(() => setPenaltyKey(0), PENALTY_TOAST_MS)
    return () => clearTimeout(t)
  }, [penaltyKey])

  const finished = game?.finishedAt != null
  useEffect(() => {
    if (!finished || phase.kind !== 'playing') return
    const t = setTimeout(() => setPhase({ kind: 'done' }), FINISH_DELAY_MS)
    return () => clearTimeout(t)
  }, [finished, phase.kind])

  // Save a finished game once the stats have loaded, so the best time and runs are never overwritten blindly.
  useEffect(() => {
    if (!result || result.saved || !statsLoaded || !progress) return
    const run = recordRun(stats, result.ms, result.at)
    progress.patchStats({ bestMatchMs: run.bestMatchMs, matchRuns: run.matchRuns })
    if (shared && uid) void submitMatchTime(setId, uid, displayName, result.ms)
    if (run.isRecord) playSound('complete')
    setResult({ ...result, saved: true, prevBest: stats.bestMatchMs, isRecord: run.isRecord })
  }, [result, statsLoaded, progress, stats, shared, uid, setId, displayName])

  const changeStarredOnly = (starredOnly: boolean) => {
    setOptions({ starredOnly })
    // Different cards: a game in progress no longer fits, so go back to the start screen.
    if (phase.kind === 'countdown' || phase.kind === 'playing') backToStart()
  }

  // Closes the options sheet first so the countdown is visible.
  const restart = (close: () => void) => {
    close()
    startGame()
  }

  useHotkeys(
    {
      enter: () => {
        if (phase.kind === 'intro' || phase.kind === 'done') startGame()
      },
      r: () => {
        if (phase.kind !== 'intro') startGame()
      },
    },
    { enabled: canPlay },
  )
  useShortcutHelp([
    {
      title: 'Match',
      items: [
        [
          <>
            <K>Tab</K> <K>←</K> <K>→</K> <K>↑</K> <K>↓</K>
          </>,
          'Move between tiles',
        ],
        [
          <>
            <K>Enter</K> / <K>Space</K>
          </>,
          'Select the focused tile (again to deselect)',
        ],
        [<K key="enter">Enter</K>, 'Start a game / play again'],
        [<K key="r">R</K>, 'Restart with new pairs'],
      ],
    },
  ])

  const optionsNode = (close: () => void) => (
    <>
      <OptionGroup title="Tiles">
        <AnswerWithOption value={options.answerWith} onChange={(answerWith) => setOptions({ answerWith })} />
        <p className="hint" style={{ margin: 0 }}>
          {options.answerWith === 'both'
            ? 'Terms and definitions look alike.'
            : `${options.answerWith === 'term' ? 'Terms' : 'Definitions'} are shown larger${options.audio ? ' and read aloud' : ''}.`}
        </p>
        <StarredOnlyOption value={options.starredOnly} onChange={changeStarredOnly} />
      </OptionGroup>
      <OptionGroup title="Audio">
        <Switch
          label="Read tiles aloud"
          checked={options.audio}
          onChange={(audio) => setOptions({ audio })}
          hint="Speaks a tile when you tap it. With “Answer with” set to Term or Definition, only that side is read."
        />
      </OptionGroup>
      <OptionGroup title="Game">
        <button type="button" className="btn btn-block" onClick={() => restart(close)} disabled={!canPlay}>
          <RotateCcw size={18} aria-hidden />
          Restart
        </button>
      </OptionGroup>
    </>
  )

  let body: ReactNode
  if (phase.kind === 'countdown')
    body = (
      <div className={styles.countdown} role="status" aria-live="assertive">
        <span key={phase.count} className={styles.count}>
          {phase.count}
        </span>
      </div>
    )
  else if (phase.kind === 'playing' && game)
    body = (
      <div className={styles.play}>
        <MatchBoard key={gameNo} game={game} answerWith={options.answerWith} imageSource={imageSource} onSelect={onSelect} />
        <p className={styles.status}>
          <span>{plural(pairsLeft(game), 'pair')} left</span>
          <span>
            {game.startedAt === null ? 'The clock starts on your first tap.' : `Wrong pairs add ${formatTenths(PENALTY_MS)} s.`}
          </span>
        </p>
      </div>
    )
  else if (phase.kind === 'done' && result) body = <MatchResults result={result} shared={shared} onPlayAgain={startGame} />
  else
    body = <StartScreen cardCount={pool.length} bestMs={statsLoaded ? stats.bestMatchMs : undefined} onStart={startGame} />

  return (
    <StudyLayout
      mode="match"
      options={optionsNode}
      minCards={2}
      availableCards={pool.length}
      headerExtra={phase.kind === 'intro' ? undefined : <MatchClock key={gameNo} game={game} penaltyKey={penaltyKey} />}
    >
      {body}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </StudyLayout>
  )
}

function StartScreen({ cardCount, bestMs, onStart }: { cardCount: number; bestMs: number | null | undefined; onStart: () => void }) {
  return (
    <div className={styles.screen}>
      <section className={`panel ${styles.intro}`} aria-labelledby="match-intro-title">
        <span className={styles.introIcon} aria-hidden>
          <Timer size={28} />
        </span>
        <h1 id="match-intro-title" className={styles.heading}>
          Match
        </h1>
        <p className="muted">
          Tap a term, then its definition, to clear the pair. Clear the board as fast as you can — every wrong pair adds 1
          second.
        </p>
        <p className={styles.best}>
          <Trophy size={18} aria-hidden />
          Personal best: <strong>{bestMs === undefined ? '…' : bestMs === null ? 'none yet' : `${formatTenths(bestMs)} s`}</strong>
        </p>
        {cardCount < ROUND_SIZE ? (
          <div className={`alert alert-info ${styles.introHint}`}>
            Match works best with {ROUND_SIZE} or more terms. This game uses {plural(cardCount, 'pair')}.
          </div>
        ) : (
          cardCount > ROUND_SIZE && (
            <p className="subtle">
              Each game uses {ROUND_SIZE} of the {cardCount} terms. Keep playing to cover them all.
            </p>
          )
        )}
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart} autoFocus>
          <Play size={18} aria-hidden />
          Start game
        </button>
      </section>
    </div>
  )
}
