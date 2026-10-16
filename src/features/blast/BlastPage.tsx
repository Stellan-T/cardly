import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router'
import { Confetti } from '../../components/Confetti'
import { Segmented } from '../../components/controls'
import { useHotkeys } from '../../components/hotkeys'
import { Pause, Play, Rocket, RotateCcw, Timer, Trophy, Volume2, Zap } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import {
  BLAST_SCORE,
  DEFAULT_BLAST_OPTIONS,
  formatClock,
  normalizeBlastOptions,
  SPEED_LABELS,
  type BlastOptions,
  type BlastSpeed,
} from '../../lib/blast'
import { randomSeed } from '../../lib/random'
import { playSound } from '../../lib/sound'
import { ttsSupported } from '../../lib/tts'
import type { Card, Side } from '../../types'
import { useStudySet } from '../sets/StudySetContext'
import { AnswerWithOption, StarredOnlyOption } from '../study/CommonOptions'
import { useHasStarred, useModeOptions, useProgress, useSpeech, useStudyActivity, useStudyCards } from '../study/hooks'
import { OptionGroup, StudyLayout } from '../study/StudyLayout'
import styles from './BlastPage.module.css'
import { BlastEngine, IDLE_STATE, type EngineState, type GameResult } from './engine'

const MIN_CARDS = 6
/** Gap between the prompt bar and the bottom of the scene (see .bar in the CSS). */
const BAR_OFFSET = 10
const SPEEDS: BlastSpeed[] = ['slow', 'normal', 'fast']
const CHOICES = ['2', '3', '4', '5']
const MINUTES = ['1', '2', '3', '4', '5']
const ANSWER_WITH_LABEL = { term: 'term', definition: 'definition', both: 'term or definition' }

const isPlayable = (c: Card) => !!c.term.trim() && !!c.definition.trim()

const prefersReducedMotion = () =>
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.reducedMotion === 'true'

/** Font size tier by length; line breaks count extra because each one costs a whole line. */
const promptSize = (text: string) => {
  const weight = text.length + (text.split('\n').length - 1) * 25
  return weight <= 35 ? styles.promptL : weight <= 75 ? styles.promptM : weight <= 150 ? styles.promptS : styles.promptXS
}

interface Result extends GameResult {
  record: boolean
  previousBest: number | null
}

export default function BlastPage() {
  const { cards, progress, basePath } = useStudySet()
  const [saved, setOptions] = useModeOptions<BlastOptions>('blast', DEFAULT_BLAST_OPTIONS)
  const options = useMemo(() => normalizeBlastOptions(saved), [saved])
  const hasStarred = useHasStarred()
  const starredOnly = options.starredOnly && hasStarred
  const studyCards = useStudyCards(starredOnly)
  const playable = useMemo(() => studyCards.filter(isPlayable), [studyCards])
  const pool = useMemo(() => cards.filter(isPlayable), [cards])
  const { stats } = useProgress()
  const best = stats.bestBlast
  const { markStudied } = useStudyActivity('blast')
  const { say, langOf } = useSpeech()

  const [game, setGame] = useState<EngineState>(IDLE_STATE)
  const [result, setResult] = useState<Result | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const engineRef = useRef<BlastEngine | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const endedAt = useRef(0)
  const latest = useRef({ best, progress })
  latest.current = { best, progress }
  const choicesLabelId = useId()

  // A trailing no-break space makes a repeated message count as new for screen readers.
  const announce = useCallback(
    (text: string) => setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text)),
    [],
  )

  // One engine per canvas element (the canvas only exists while the set has enough terms).
  useEffect(() => {
    if (!canvas) return
    const engine = new BlastEngine(canvas, {
      onChange: setGame,
      onAnnounce: announce,
      onEnd: (r) => {
        const { best: previousBest, progress: store } = latest.current
        const record = r.score > 0 && r.score > (previousBest ?? 0)
        if (record) store?.patchStats({ bestBlast: r.score })
        endedAt.current = Date.now()
        setResult({ ...r, record, previousBest })
        playSound('complete')
        announce(`Time’s up! You scored ${r.score} points${record ? ', a new best score' : ''}.`)
      },
      shouldPause: () => !!document.querySelector('dialog[open]'),
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
      setGame(IDLE_STATE)
    }
  }, [canvas, announce])

  // Keep the canvas sized to the stage (and crisp on high-DPI screens).
  useEffect(() => {
    const stage = stageRef.current
    const bar = barRef.current
    if (!canvas || !stage || !bar) return
    const apply = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      engineRef.current?.setLayout(stage.clientWidth, stage.clientHeight, bar.offsetHeight + BAR_OFFSET, dpr)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(stage)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [canvas])

  // Pause when the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') engineRef.current?.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const phase = game.phase
  const playing = phase === 'playing'
  const paused = phase === 'paused'
  const active = playing || paused

  // Move focus to the overlay's main button, or back to the scene while playing.
  useEffect(() => {
    if (phase === 'paused') announce('Paused.')
    if (phase === 'paused' || phase === 'over') primaryRef.current?.focus()
    else if (phase === 'playing' && (!document.activeElement || document.activeElement === document.body))
      stageRef.current?.focus({ preventScroll: true })
  }, [phase, announce])

  const start = useCallback(() => {
    const engine = engineRef.current
    // Ignore a Space/Enter still held from the last shot of the previous game.
    if (!engine || playable.length < MIN_CARDS || Date.now() - endedAt.current < 800) return
    setResult(null)
    engine.start({ cards: playable, pool, options, seed: randomSeed(), reducedMotion: prefersReducedMotion() })
    markStudied()
  }, [playable, pool, options, markStudied])

  const pause = () => engineRef.current?.pause()
  const resume = () => engineRef.current?.resume()
  const choose = (i: number) => {
    const choice = game.choices[i]
    if (choice) engineRef.current?.choose(choice.id)
  }

  useHotkeys(
    {
      arrowleft: () => engineRef.current?.cycle(-1),
      arrowright: () => engineRef.current?.cycle(1),
      space: () => (paused ? resume() : engineRef.current?.fireTarget()),
      enter: () => (paused ? resume() : engineRef.current?.fireTarget()),
      p: () => (paused ? resume() : pause()),
      1: () => choose(0),
      2: () => choose(1),
      3: () => choose(2),
      4: () => choose(3),
      5: () => choose(4),
    },
    { enabled: active },
  )
  useHotkeys({ space: start, enter: start }, { enabled: !active && playable.length >= MIN_CARDS })

  useShortcutHelp([
    {
      title: 'Blast',
      items: [
        [
          <>
            <K>←</K> <K>→</K>
          </>,
          'Target the previous / next asteroid',
        ],
        [
          <>
            <K>Space</K> or <K>Enter</K>
          </>,
          'Fire at the target (the first press picks one)',
        ],
        [
          <>
            <K>1</K> – <K>5</K>
          </>,
          'Shoot answer 1–5',
        ],
        [<K key="p">P</K>, 'Pause or resume'],
      ],
    },
  ])

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const rect = e.currentTarget.getBoundingClientRect()
    engineRef.current?.pointerDown(e.clientX - rect.left, e.clientY - rect.top, e.pointerType !== 'mouse')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    const over = engineRef.current?.pointerMove(e.clientX - rect.left, e.clientY - rect.top)
    e.currentTarget.style.cursor = over ? 'pointer' : 'crosshair'
  }

  const langAttr = (side: Side) => {
    const lang = langOf(side)
    return lang && lang !== 'und' ? lang : undefined
  }

  const wave = game.wave
  const liveCount = game.choices.filter((c) => c.state === 'live' || c.state === 'reveal').length
  const sceneLabel = active
    ? `Space scene: ${liveCount} asteroid${liveCount === 1 ? '' : 's'} with answers drift above your cannon. ` +
      'Shoot one with the answer buttons below, the arrow keys and Space, or by tapping it.'
    : 'Blast play area'

  const hud = active ? (
    <div className={styles.hud}>
      <span className={styles.hudItem}>
        <Zap size={15} aria-hidden />
        <span className="sr-only">Score</span>
        {game.score.toLocaleString()}
      </span>
      <span className={`${styles.hudItem} ${game.remainingMs <= 10_000 ? styles.hudLow : ''}`}>
        <Timer size={15} aria-hidden />
        <span className="sr-only">Time left</span>
        {formatClock(game.remainingMs)}
      </span>
    </div>
  ) : undefined

  const optionsUi = (
    <>
      {active && <p className="alert alert-info">Changes apply to your next game.</p>}
      <OptionGroup title="Game">
        <div className="option-row">
          <span>Asteroid speed</span>
          <Segmented
            label="Asteroid speed"
            value={options.speed}
            onChange={(speed) => setOptions({ speed })}
            options={SPEEDS.map((s) => ({ value: s, label: SPEED_LABELS[s] }))}
          />
        </div>
        <div className="option-row">
          <span>Answer choices</span>
          <Segmented
            label="Answer choices"
            value={String(options.choices)}
            onChange={(v) => setOptions({ choices: Number(v) })}
            options={CHOICES.map((n) => ({ value: n, label: n }))}
          />
        </div>
        <div className="option-row">
          <span>Minutes</span>
          <Segmented
            label="Game length in minutes"
            value={String(options.minutes)}
            onChange={(v) => setOptions({ minutes: Number(v) })}
            options={MINUTES.map((n) => ({ value: n, label: n }))}
          />
        </div>
      </OptionGroup>
      <OptionGroup title="Questions">
        <AnswerWithOption value={options.answerWith} onChange={(answerWith) => setOptions({ answerWith })} />
        <StarredOnlyOption value={options.starredOnly} onChange={(v) => setOptions({ starredOnly: v })} />
      </OptionGroup>
    </>
  )

  return (
    <StudyLayout
      mode="blast"
      options={optionsUi}
      minCards={MIN_CARDS}
      availableCards={playable.length}
      headerExtra={hud}
    >
      <div className={styles.game}>
        <section ref={stageRef} className={styles.stage} tabIndex={-1} aria-label="Blast game">
          <canvas
            ref={setCanvas}
            className={styles.canvas}
            role="img"
            aria-label={sceneLabel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => engineRef.current?.pointerLeave()}
          />

          <div
            ref={barRef}
            className={styles.bar}
            data-hidden={!active || undefined}
            aria-hidden={!active || undefined}
          >
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Pause"
              title="Pause (P)"
              disabled={!playing}
              onClick={pause}
            >
              <Pause size={20} />
            </button>
            <div className={styles.prompt}>
              {wave && (
                <div className={styles.promptInner}>
                  <span className={styles.promptLabel}>Find the {wave.answerSide}</span>
                  <span className={`${styles.promptText} ${promptSize(wave.prompt)}`} lang={langAttr(wave.promptSide)}>
                    {wave.prompt}
                  </span>
                </div>
              )}
            </div>
            {ttsSupported() && (
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Read the prompt aloud"
                title="Read aloud"
                disabled={!wave}
                onClick={() => wave && say(wave.prompt, wave.promptSide)}
              >
                <Volume2 size={20} />
              </button>
            )}
          </div>

          {phase === 'idle' && (
            <div className={styles.overlay}>
              <div className={`panel stack ${styles.card}`}>
                <span className={styles.cardIcon} aria-hidden>
                  <Rocket size={28} />
                </span>
                <h2>Blast</h2>
                <p className="muted">
                  Shoot the asteroid that matches the prompt. Quick answers score more; a wrong hit costs{' '}
                  {BLAST_SCORE.penalty} points.
                </p>
                <div className={styles.best}>
                  <Trophy size={18} aria-hidden />
                  {best ? (
                    <span>
                      Best score <strong>{best.toLocaleString()}</strong>
                    </span>
                  ) : (
                    <span>No best score yet</span>
                  )}
                </div>
                <div className={`row ${styles.badges}`}>
                  <span className="badge">{SPEED_LABELS[options.speed]} speed</span>
                  <span className="badge">{options.choices} choices</span>
                  <span className="badge">{options.minutes} min</span>
                  <span className="badge">Answer with {ANSWER_WITH_LABEL[options.answerWith]}</span>
                  {starredOnly && <span className="badge badge-warning">Starred only</span>}
                </div>
                <button type="button" className="btn btn-primary btn-lg" onClick={start}>
                  <Play size={20} aria-hidden /> Start
                </button>
                <p className="subtle">
                  Tap or click an asteroid to fire
                  <span className="hide-mobile">
                    , or aim with <kbd>←</kbd> <kbd>→</kbd> and fire with <kbd>Space</kbd>
                  </span>
                  .
                </p>
              </div>
            </div>
          )}

          {paused && (
            <div className={styles.overlay}>
              <div className={`panel stack ${styles.card}`}>
                <h2>Paused</h2>
                <p className="muted">
                  Score {game.score.toLocaleString()} · {formatClock(game.remainingMs)} left
                </p>
                <div className={`row ${styles.actions}`}>
                  <button ref={primaryRef} type="button" className="btn btn-primary btn-lg" onClick={resume}>
                    <Play size={20} aria-hidden /> Resume
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={start}>
                    <RotateCcw size={18} aria-hidden /> Restart
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'over' && result && (
            <div className={styles.overlay}>
              <div className={`panel stack ${styles.card}`}>
                <h2>Time’s up!</h2>
                <div>
                  <div className={styles.bigScore}>{result.score.toLocaleString()}</div>
                  <div className="muted">points</div>
                </div>
                {result.record ? (
                  <span className="badge badge-success">
                    <Trophy size={14} aria-hidden /> New best score!
                    {result.previousBest ? ` (was ${result.previousBest.toLocaleString()})` : ''}
                  </span>
                ) : (
                  <div className={styles.best}>
                    <Trophy size={18} aria-hidden />
                    <span>
                      Best score <strong>{(best ?? 0).toLocaleString()}</strong>
                    </span>
                  </div>
                )}
                <p className="muted small">
                  {result.hits} correct · {result.misses} wrong
                </p>
                <div className={`row ${styles.actions}`}>
                  <button ref={primaryRef} type="button" className="btn btn-primary btn-lg" onClick={start}>
                    <RotateCcw size={20} aria-hidden /> Play again
                  </button>
                  <Link className="btn btn-lg" to={basePath}>
                    Back to set
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>

        {active && game.choices.length > 0 && (
          <div className={styles.choices} role="group" aria-labelledby={choicesLabelId}>
            <span id={choicesLabelId} className={styles.choicesLabel}>
              Or choose:
            </span>
            {game.choices.map((c, i) => {
              const done = c.state === 'wrong' || c.state === 'hit'
              const inactive = done || !playing || game.cooling || game.busy
              const tone = c.state === 'wrong' ? `is-incorrect ${styles.wrong}` : c.state === 'live' ? '' : 'is-correct'
              return (
                <button
                  // Keyed by position so focus stays put when the next wave arrives.
                  key={i}
                  type="button"
                  className={`btn btn-sm ${styles.choice} ${tone} ${inactive && !done ? styles.inactive : ''}`}
                  aria-disabled={inactive || undefined}
                  onClick={() => engineRef.current?.choose(c.id)}
                >
                  <kbd className="hide-mobile" aria-hidden>
                    {i + 1}
                  </kbd>
                  <span className={styles.choiceText} lang={wave ? langAttr(wave.answerSide) : undefined}>
                    {c.text}
                  </span>
                  {c.state === 'wrong' && <span className="sr-only"> (wrong)</span>}
                  {c.state === 'reveal' && <span className="sr-only"> (correct answer)</span>}
                </button>
              )
            })}
          </div>
        )}

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
      {phase === 'over' && result?.record && <Confetti />}
    </StudyLayout>
  )
}
