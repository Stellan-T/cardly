/**
 * Per-term progress and the three buckets shown everywhere:
 *   Not studied   never answered in a tracked activity
 *   Still learning answered at least once but not mastered
 *   Mastered      correct on the last two attempts in a row, or Mastered in Learn
 * A wrong answer anywhere drops a mastered term back to Still learning.
 * Tracked activities: Flashcards (sorting / spaced repetition), Learn and Test.
 */
import type { LearnLevel, ProgressSummary, SetStats, TermProgress } from '../types'

export type Outcome = 'correct' | 'incorrect' | 'hard'
export type Bucket = 'notStudied' | 'learning' | 'mastered'

export const BUCKET_LABELS: Record<Bucket, string> = {
  notStudied: 'Not studied',
  learning: 'Still learning',
  mastered: 'Mastered',
}

export function emptyProgress(now = 0): TermProgress {
  return { seen: 0, correct: 0, incorrect: 0, streak: 0, lastResult: null, level: 0, srs: null, lastAt: now }
}

export function emptyStats(): SetStats {
  return {
    studyMs: 0,
    sessions: 0,
    lastStudiedAt: null,
    bestMatchMs: null,
    matchRuns: [],
    bestBlocks: null,
    bestBlast: null,
  }
}

/**
 * Records one answer.
 *  - correct: counts toward mastery (two in a row = mastered)
 *  - hard: remembered with difficulty (spaced repetition "Hard"), breaks the streak
 *  - incorrect: resets the streak and drops a mastered Learn level to familiar
 */
export function applyOutcome(prev: TermProgress | undefined, outcome: Outcome, now: number): TermProgress {
  const p = prev ? { ...prev } : emptyProgress(now)
  p.seen += 1
  p.lastAt = now
  if (outcome === 'incorrect') {
    p.incorrect += 1
    p.streak = 0
    p.lastResult = 'incorrect'
    if (p.level === 2) p.level = 1
  } else {
    p.correct += 1
    p.lastResult = 'correct'
    p.streak = outcome === 'hard' ? 0 : p.streak + 1
  }
  return p
}

export function withLevel(prev: TermProgress | undefined, level: LearnLevel, now: number): TermProgress {
  const p = prev ? { ...prev } : emptyProgress(now)
  p.level = level
  p.lastAt = now
  return p
}

export function bucketOf(p: TermProgress | undefined): Bucket {
  if (!p || p.seen === 0) return 'notStudied'
  if (p.level === 2 || p.streak >= 2) return 'mastered'
  return 'learning'
}

export function summarize(cardIds: string[], progress: Record<string, TermProgress | undefined>): ProgressSummary {
  const s: ProgressSummary = { notStudied: 0, learning: 0, mastered: 0 }
  for (const id of cardIds) s[bucketOf(progress[id])]++
  return s
}

export function masteredPct(summary: ProgressSummary | undefined, total: number): number {
  if (!summary || total === 0) return 0
  return Math.round((summary.mastered / total) * 100)
}

/** Keeps the 10 fastest Match runs. */
export function addMatchRun(runs: { ms: number; at: number }[], ms: number, at: number) {
  return [...runs, { ms, at }].sort((a, b) => a.ms - b.ms || a.at - b.at).slice(0, 10)
}
