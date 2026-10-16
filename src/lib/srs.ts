/**
 * Spaced repetition on top of FSRS (ts-fsrs).
 *
 * Target first-review behaviour (matches the four rating buttons):
 *   Repeat → back within minutes, in this session (1 min)
 *   Hard   → later in the session (10 min)
 *   Okay   → about 1 day
 *   Easy   → 4+ days
 * FSRS's initial stabilities for Good/Easy are tuned to 1 and 4.5 days; the
 * rest of the model (difficulty, later intervals, lapses) is standard FSRS.
 */
import { createEmptyCard, default_w, fsrs, generatorParameters, Rating, type Card as FsrsCard, type FSRS } from 'ts-fsrs'
import type { SrsState, TermProgress } from '../types'

export type SrsRating = 1 | 2 | 3 | 4
export const SRS_RATINGS: { rating: SrsRating; label: string; key: string }[] = [
  { rating: 1, label: 'Repeat', key: '1' },
  { rating: 2, label: 'Hard', key: '2' },
  { rating: 3, label: 'Okay', key: '3' },
  { rating: 4, label: 'Easy', key: '4' },
]

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Hard on a new/learning card brings it back later in the same session. */
export const HARD_LEARNING_DELAY_MS = 10 * MINUTE
/** Cards due within this window are shown early instead of ending the session. */
export const LEARN_AHEAD_MS = 20 * MINUTE

export function createScheduler(options: { fuzz?: boolean } = {}): FSRS {
  const w = [...default_w]
  w[2] = 1.0 // initial stability after "Okay" (Good): ~1 day
  w[3] = 4.5 // initial stability after "Easy": ~4-5 days
  return fsrs(
    generatorParameters({
      w,
      request_retention: 0.9,
      maximum_interval: 3650,
      enable_fuzz: options.fuzz ?? true,
      enable_short_term: true,
      learning_steps: ['1m'],
      relearning_steps: ['10m'],
    }),
  )
}

let defaultScheduler: FSRS | null = null
const scheduler = () => (defaultScheduler ??= createScheduler())

export function toFsrsCard(s: SrsState | null | undefined, now: number): FsrsCard {
  if (!s) return createEmptyCard(new Date(now))
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

export function fromFsrsCard(c: FsrsCard): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as SrsState['state'],
    last_review: c.last_review ? c.last_review.getTime() : null,
  }
}

const isLearningPhase = (s: SrsState | null | undefined) => !s || s.state === 0 || s.state === 1

/** Next state after rating a card. */
export function rateCard(s: SrsState | null | undefined, rating: SrsRating, now: number, f: FSRS = scheduler()): SrsState {
  const before = toFsrsCard(s, now)
  const result = f.next(before, new Date(now), rating as unknown as Rating.Again)
  const next = fromFsrsCard(result.card)
  if (rating === 2 && isLearningPhase(s)) {
    next.due = now + HARD_LEARNING_DELAY_MS
    next.state = 1
  }
  return next
}

/** Milliseconds until each rating would make the card due again. */
export function previewIntervals(s: SrsState | null | undefined, now: number, f?: FSRS): Record<SrsRating, number> {
  const out = {} as Record<SrsRating, number>
  for (const { rating } of SRS_RATINGS) out[rating] = rateCard(s, rating, now, f).due - now
  return out
}

export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1m'
  if (ms < 60 * MINUTE) return `${Math.round(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))}h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`
}

export const isNewCard = (p: TermProgress | undefined) => !p?.srs || p.srs.state === 0

export interface SrsQueue {
  /** Cards to review now, most overdue first (learning cards before reviews). */
  due: string[]
  /** New cards allowed today, in set order. */
  fresh: string[]
  /** Earliest future due time of any scheduled card, if any. */
  nextDueAt: number | null
}

export function buildSrsQueue(
  cardIds: string[],
  progress: Record<string, TermProgress | undefined>,
  now: number,
  newAllowance: number,
): SrsQueue {
  const due: { id: string; due: number; learning: boolean }[] = []
  const fresh: string[] = []
  let nextDueAt: number | null = null
  for (const id of cardIds) {
    const p = progress[id]
    if (isNewCard(p)) {
      if (fresh.length < newAllowance) fresh.push(id)
      continue
    }
    const s = p!.srs!
    if (s.due <= now) due.push({ id, due: s.due, learning: s.state === 1 || s.state === 3 })
    else if (nextDueAt === null || s.due < nextDueAt) nextDueAt = s.due
  }
  due.sort((a, b) => Number(b.learning) - Number(a.learning) || a.due - b.due)
  return { due: due.map((d) => d.id), fresh, nextDueAt }
}

/** Sorted due timestamps for every scheduled card (stored on the set doc for "due today" counts). */
export function srsDueList(progress: Record<string, TermProgress | undefined>, cardIds: string[]): number[] {
  const list: number[] = []
  for (const id of cardIds) {
    const s = progress[id]?.srs
    if (s && s.state !== 0) list.push(s.due)
  }
  return list.sort((a, b) => a - b)
}

export function countDueBy(srsDue: number[] | undefined, until: number): number {
  if (!srsDue) return 0
  let n = 0
  for (const d of srsDue) {
    if (d <= until) n++
    else break
  }
  return n
}
