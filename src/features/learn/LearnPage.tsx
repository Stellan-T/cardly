import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { confirmDialog } from '../../components/confirm'
import { ProgressBar, Segmented, Switch } from '../../components/controls'
import { Confetti } from '../../components/Confetti'
import { Check, ClipboardCheck, Flame, RotateCcw, Target, X } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import { formatDuration } from '../../lib/format'
import {
  applyOptions,
  commitAnswer,
  continueAfterCheckpoint,
  createLearnState,
  DEFAULT_LEARN_OPTIONS,
  ensureQuestion,
  LEARN_GOALS,
  roundSummary,
  STREAK_THRESHOLD,
  type LearnGoal,
  type LearnOptions,
  type LearnState,
} from '../../lib/learn'
import { BUCKET_LABELS, bucketOf, type Bucket } from '../../lib/progress'
import { QUESTION_TYPE_LABELS } from '../../lib/questions'
import { randomSeed } from '../../lib/random'
import { playSound } from '../../lib/sound'
import { ttsSupported } from '../../lib/tts'
import type { LearnLevel } from '../../types'
import { useStudySet } from '../sets/StudySetContext'
import { AnswerWithOption, GradingOptions, StarredOnlyOption } from '../study/CommonOptions'
import {
  useGrading,
  useModeOptions,
  useProgress,
  useSessionState,
  useSpeech,
  useStudyActivity,
  useStudyCards,
  useTermFilter,
} from '../study/hooks'
import { OptionGroup, StudyLayout } from '../study/StudyLayout'
import { LearnQuestionView, type Verdict } from './LearnQuestionView'
import styles from './Learn.module.css'

/** Sessions started for a subset ("?terms=") are kept apart from the main session. */
const MAIN_FIELD = 'learn'
const SUBSET_FIELD = 'learnSubset'

/** Re-aligns a saved session with the current cards (deleted/added terms). Null if it no longer fits. */
function reconcile(saved: LearnState, ids: string[], levelsFromProgress: Record<string, LearnLevel>): LearnState | null {
  const valid = new Set(ids)
  const kept = saved.termIds.filter((id) => valid.has(id))
  if (!ids.length || kept.length < Math.ceil(ids.length * 0.5)) return null
  const added = ids.filter((id) => !(id in saved.levels))
  const levels = { ...saved.levels }
  for (const id of added) levels[id] = levelsFromProgress[id] ?? 0
  const current = saved.current && valid.has(saved.current.cardId) ? saved.current : null
  return {
    ...saved,
    termIds: [...kept, ...added],
    levels,
    roundIds: saved.roundIds.filter((id) => valid.has(id)),
    queue: saved.queue.filter((id) => valid.has(id)),
    current,
  }
}

export default function LearnPage() {
  const { cards: allCards, session, progress, imageSource, toggleStar, basePath, status } = useStudySet()
  const [opts, setOpts, optsLoaded] = useModeOptions<LearnOptions>('learn', DEFAULT_LEARN_OPTIONS)
  const cards = useStudyCards(opts.starredOnly)
  const subset = useTermFilter()
  const field = subset ? SUBSET_FIELD : MAIN_FIELD
  const sessionState = useSessionState() as Record<string, unknown>
  const saved = sessionState[field] as LearnState | null | undefined
  const progressState = useProgress()
  const grading = useGrading()
  const { say, langOf, voiceOf } = useSpeech()
  const { markStudied } = useStudyActivity('learn')

  const [state, setState] = useState<LearnState | null>(null)
  const [initialised, setInitialised] = useState(false)
  const ready = status === 'ready' && optsLoaded && !!session?.loaded && progressState.loaded

  const ids = useMemo(() => cards.map((c) => c.id), [cards])
  const byId = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards])

  const levelsFromProgress = useCallback(() => {
    const levels: Record<string, LearnLevel> = {}
    for (const id of ids) {
      const p = progressState.cards[id]
      levels[id] = bucketOf(p) === 'mastered' ? 2 : (p?.level ?? 0)
    }
    return levels
  }, [ids, progressState.cards])

  // Resume the saved session (possibly from another device) once everything has loaded.
  useEffect(() => {
    if (!ready || initialised) return
    setInitialised(true)
    if (saved && saved.version === 1) {
      const resumed = reconcile(saved, ids, levelsFromProgress())
      if (resumed) setState(applyOptions(resumed, opts))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // A different term selection (starred only / subset) starts over at the goal screen.
  const idsKey = ids.join(',')
  useEffect(() => {
    if (!state) return
    const resumed = reconcile(state, ids, levelsFromProgress())
    if (!resumed) setState(null)
    else if (resumed.termIds.length !== state.termIds.length) setState(resumed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const save = useCallback((next: LearnState | null) => session?.patch(field, next), [session, field])

  // Build the next question whenever needed (and persist it, so resuming shows the same question).
  useEffect(() => {
    if (!state || state.phase !== 'question' || state.current) return
    const next = ensureQuestion(state, cards, allCards, opts)
    if (next !== state) {
      setState(next)
      save(next)
    }
  }, [state, cards, allCards, opts, save])

  const start = (o: LearnOptions = opts, termIds = ids, fromZero = false) => {
    const levels = fromZero ? {} : levelsFromProgress()
    const next = createLearnState(termIds, levels, o, randomSeed(), Date.now())
    setState(next)
    save(next)
  }

  const updateOptions = (patch: Partial<LearnOptions>) => {
    const next = { ...opts, ...patch }
    setOpts(patch)
    if (state) {
      const s = applyOptions(state, next)
      if (s !== state) {
        setState(s)
        save(s)
      }
    }
  }

  const onDone = (v: Verdict) => {
    if (!state?.current) return
    markStudied()
    const cardId = state.current.cardId
    const next = commitAnswer(state, { correct: v.correct, firstTry: v.firstTry, now: Date.now() })
    progress?.record(cardId, v.correct ? 'correct' : 'incorrect', { level: next.levels[cardId] })
    if (next.phase === 'complete' && opts.sfx) playSound('complete')
    setState(next)
    save(next)
  }

  const onFeedback = (correct: boolean) => {
    if (opts.sfx) playSound(correct ? 'correct' : 'incorrect')
  }

  const resetProgress = async () => {
    const ok = await confirmDialog({
      title: 'Reset Learn progress?',
      message: 'All terms in this session go back to Not studied, here and on the set page.',
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    progress?.reset(ids)
    start(opts, ids, true)
  }

  useShortcutHelp([
    {
      title: 'Learn',
      items: [
        [
          <span key="14">
            <K>1</K>–<K>4</K>
          </span>,
          'Pick a multiple-choice option',
        ],
        [
          <span key="tf">
            <K>T</K> / <K>F</K>
          </span>,
          'True / False',
        ],
        [<K key="en">Enter</K>, 'Submit / continue'],
        [<K key="sp">Space</K>, 'Show the answer (flashcard questions)'],
      ],
    },
  ])

  // ---- Options sheet ----
  const types = opts.types
  const typeSwitch = (key: keyof LearnOptions['types']) => (
    <Switch
      key={key}
      label={QUESTION_TYPE_LABELS[key === 'flashcard' ? 'flashcard' : key]}
      checked={types[key]}
      disabled={opts.writeMode || (types[key] && Object.values(types).filter(Boolean).length === 1)}
      onChange={(v) => updateOptions({ types: { ...types, [key]: v } })}
    />
  )
  const options = (
    <>
      <OptionGroup title="Questions">
        <AnswerWithOption value={opts.answerWith} onChange={(v) => updateOptions({ answerWith: v })} />
        {typeSwitch('flashcard')}
        {typeSwitch('mc')}
        {typeSwitch('tf')}
        {typeSwitch('written')}
        <Switch
          label="Write mode"
          hint="Written questions only."
          checked={opts.writeMode}
          onChange={(v) => updateOptions({ writeMode: v })}
        />
        <Switch
          label="Spell mode"
          hint={ttsSupported() ? 'Hear the answer and type what you hear (replaces written questions).' : 'Needs text-to-speech, which this browser doesn’t support.'}
          checked={opts.spellMode}
          disabled={!ttsSupported()}
          onChange={(v) => updateOptions({ spellMode: v })}
        />
        <span className="hint">Changing question types resets your answer streak.</span>
      </OptionGroup>
      <OptionGroup title="Session">
        <StarredOnlyOption value={opts.starredOnly} onChange={(v) => updateOptions({ starredOnly: v })} />
        <Switch label="Shuffle terms" checked={opts.shuffle} onChange={(v) => updateOptions({ shuffle: v })} />
        <div className="option-row">
          <span>Terms per round</span>
          <Segmented
            label="Terms per round"
            value={String(opts.roundSize)}
            onChange={(v) => updateOptions({ roundSize: Number(v) })}
            options={['5', '6', '7', '8', '9', '10'].map((n) => ({ value: n, label: n }))}
          />
        </div>
        <Switch label="Retype correct answers" hint="After a wrong written answer, type it correctly before continuing." checked={opts.retype} onChange={(v) => updateOptions({ retype: v })} />
        <Switch label="Play audio automatically" checked={opts.audio} onChange={(v) => updateOptions({ audio: v })} />
        <Switch label="Sound effects" checked={opts.sfx} onChange={(v) => updateOptions({ sfx: v })} />
      </OptionGroup>
      <OptionGroup title="Grading">
        <GradingOptions />
      </OptionGroup>
      <OptionGroup title="Progress">
        <button type="button" className="btn" onClick={() => void resetProgress()}>
          <RotateCcw size={16} /> Reset progress
        </button>
      </OptionGroup>
    </>
  )

  // ---- Header ----
  const mastered = state ? state.termIds.filter((id) => state.levels[id] === 2).length : 0
  const headerExtra = state ? (
    <span className={styles.headerStats}>
      {state.streak >= STREAK_THRESHOLD && (
        <span className={styles.streak} aria-label={`Answer streak ${state.streak}`} title="Answer streak" data-testid="learn-streak">
          <Flame size={16} /> {state.streak}
        </span>
      )}
      <span className="subtle hide-mobile">
        {mastered}/{state.termIds.length} mastered
      </span>
    </span>
  ) : null

  let body: React.ReactNode = null
  if (!ready || !initialised) body = null
  else if (!state) {
    const startGoal = (goal: LearnGoal | null) => {
      const o = goal ? { ...opts, ...LEARN_GOALS[goal].options } : opts
      if (goal) setOpts(LEARN_GOALS[goal].options)
      start(o)
    }
    body = <GoalScreen opts={opts} onStart={startGoal} count={ids.length} />
  }
  else if (state.phase === 'checkpoint')
    body = (
      <Checkpoint
        state={state}
        bucketCounts={bucketCounts(state.termIds, progressState.cards)}
        termOf={(id) => byId.get(id)?.term ?? ''}
        onContinue={() => {
          const next = continueAfterCheckpoint(state, opts)
          setState(next)
          save(next)
        }}
      />
    )
  else if (state.phase === 'complete')
    body = (
      <Complete
        state={state}
        basePath={basePath}
        onStudyAgain={() => start(opts, ids, true)}
        onMissed={() => start(opts, state.missed.filter((id) => byId.has(id)), true)}
        onReset={() => void resetProgress()}
      />
    )
  else if (state.current) {
    const card = byId.get(state.current.cardId)
    const roundDone = state.roundIds.length - new Set(state.queue).size
    body = card ? (
      <div className={styles.stage}>
        <div className={styles.roundBar}>
          <span className="subtle nowrap">Round {state.round}</span>
          <ProgressBar value={roundDone} max={state.roundIds.length} label="Round progress" />
          <span className="subtle nowrap">
            {roundDone}/{state.roundIds.length}
          </span>
        </div>
        <LearnQuestionView
          key={state.current.qid}
          question={state.current}
          card={card}
          grading={{ level: grading.level, requireOne: grading.requireOne }}
          retype={opts.retype}
          imageSource={imageSource}
          langOf={langOf}
          voiceOf={voiceOf}
          say={say}
          autoAudio={opts.audio}
          onToggleStar={() => toggleStar(card.id)}
          onDone={onDone}
          onFeedback={onFeedback}
        />
      </div>
    ) : null
  }

  return (
    <StudyLayout mode="learn" options={options} minCards={2} availableCards={ids.length} headerExtra={headerExtra}>
      {body}
    </StudyLayout>
  )
}

function bucketCounts(ids: string[], cards: Record<string, Parameters<typeof bucketOf>[0]>): Record<Bucket, number> {
  const out: Record<Bucket, number> = { notStudied: 0, learning: 0, mastered: 0 }
  for (const id of ids) out[bucketOf(cards[id])]++
  return out
}

function GoalScreen({ onStart, count, opts }: { onStart: (goal: LearnGoal | null) => void; count: number; opts: LearnOptions }) {
  return (
    <div className={styles.goals}>
      <Target size={36} color="var(--primary)" />
      <h1>Choose a goal</h1>
      <p className="muted">
        Learn takes each of your {count} terms from Not studied to Mastered with questions that get harder as you go.
      </p>
      <div className={styles.goalGrid}>
        {(Object.keys(LEARN_GOALS) as LearnGoal[]).map((g) => (
          <button key={g} type="button" className={`panel ${styles.goal}`} onClick={() => onStart(g)} data-testid={`learn-goal-${g}`}>
            <strong>{LEARN_GOALS[g].title}</strong>
            <span className="muted small">{LEARN_GOALS[g].description}</span>
          </button>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={() => onStart(null)}>
        Start with my current options ({opts.roundSize} terms per round)
      </button>
    </div>
  )
}

function Checkpoint({
  state,
  bucketCounts: counts,
  termOf,
  onContinue,
}: {
  state: LearnState
  bucketCounts: Record<Bucket, number>
  termOf: (id: string) => string
  onContinue: () => void
}) {
  const total = state.termIds.length || 1
  const summary = roundSummary(state)
  return (
    <div className={`panel ${styles.checkpoint}`}>
      <h2>Round {state.round} complete — keep going!</h2>
      <div className={styles.bucketRows}>
        {(['notStudied', 'learning', 'mastered'] as Bucket[]).map((b) => (
          <div key={b} className={styles.bucketRow}>
            <span>{BUCKET_LABELS[b]}</span>
            <ProgressBar value={counts[b]} max={total} tone={b === 'mastered' ? 'success' : b === 'learning' ? 'warning' : undefined} label={BUCKET_LABELS[b]} />
            <strong>{counts[b]}</strong>
          </div>
        ))}
      </div>
      <h3 className="small muted" style={{ marginTop: 18 }}>
        Terms in this round
      </h3>
      <ul className={styles.roundList}>
        {summary.map((r) => (
          <li key={r.id}>
            {r.ok ? <Check size={16} color="var(--success)" aria-label="Correct" /> : <X size={16} color="var(--danger)" aria-label="Missed" />}
            <span>{termOf(r.id)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-lg" onClick={onContinue} autoFocus data-testid="learn-checkpoint-continue">
        Continue
      </button>
    </div>
  )
}

function Complete({
  state,
  basePath,
  onStudyAgain,
  onMissed,
  onReset,
}: {
  state: LearnState
  basePath: string
  onStudyAgain: () => void
  onMissed: () => void
  onReset: () => void
}) {
  const accuracy = state.answered ? Math.round((state.correctCount / state.answered) * 100) : 100
  return (
    <div className={`panel ${styles.checkpoint}`}>
      <Confetti />
      <h2>You’ve mastered all {state.termIds.length} terms! 🎉</h2>
      <div className={styles.completeStats}>
        <div>
          <strong>{formatDuration(state.elapsedMs)}</strong>
          <span>Total time</span>
        </div>
        <div>
          <strong>{accuracy}%</strong>
          <span>Accuracy</span>
        </div>
        <div>
          <strong>{state.answered}</strong>
          <span>Questions</span>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={onStudyAgain}>
          <RotateCcw size={18} /> Study again
        </button>
        {state.missed.length > 0 && (
          <button type="button" className="btn btn-lg" onClick={onMissed}>
            Practise missed terms only ({state.missed.length})
          </button>
        )}
        <Link className="btn btn-lg" to={`${basePath}/test`}>
          <ClipboardCheck size={18} /> Take a test
        </Link>
      </div>
      <button type="button" className="link-btn small" onClick={onReset} style={{ marginTop: 14 }}>
        Reset progress
      </button>
    </div>
  )
}
