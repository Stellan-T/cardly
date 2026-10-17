/**
 * Shared domain types. All timestamps are epoch milliseconds (numbers), which
 * keeps documents simple to compare, works offline and is easy to validate in
 * Firestore rules.
 */

export type Visibility = 'private' | 'link'
export type Side = 'term' | 'definition'
/** Which side the learner has to produce. "both" mixes per question. */
export type AnswerWith = 'term' | 'definition' | 'both'
export type GradingLevel = 'strict' | 'moderate' | 'relaxed'
export type FlashcardMethod = 'browse' | 'sort' | 'srs'
export type ThemePref = 'light' | 'dark' | 'system' | 'pink'
export type ActivityKind = 'flashcards' | 'learn' | 'test' | 'match' | 'blocks' | 'blast'

export interface Card {
  id: string
  term: string
  definition: string
  order: number
  starred: boolean
  /** Image stored in users/{uid}/images/{imageId} (or publicSets/{setId}/images/{imageId}). */
  imageId?: string | null
  /** External image URL pasted by the user. */
  imageUrl?: string | null
  tags?: string[]
}

export interface ProgressSummary {
  notStudied: number
  learning: number
  mastered: number
}

export interface StudySet {
  id: string
  ownerUid: string
  ownerName: string
  title: string
  description: string
  termLang: string
  defLang: string
  visibility: Visibility
  cardCount: number
  starredCount: number
  createdAt: number
  updatedAt: number
  lastStudiedAt: number | null
  lastActivity: ActivityKind | null
  folderIds: string[]
  /** True while a new set is still being created in the editor. */
  draft: boolean
  summary?: ProgressSummary
  /** Sorted due timestamps of every card that is in the spaced-repetition schedule. */
  srsDue?: number[]
  copiedFrom?: string | null
}

/** Serialisable FSRS card state (see ts-fsrs `Card`). */
export interface SrsState {
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  /** 0 New, 1 Learning, 2 Review, 3 Relearning */
  state: 0 | 1 | 2 | 3
  last_review: number | null
}

export type LearnLevel = 0 | 1 | 2

export interface TermProgress {
  seen: number
  correct: number
  incorrect: number
  /** Consecutive correct answers in tracked activities (resets on a wrong answer). */
  streak: number
  lastResult: 'correct' | 'incorrect' | null
  /** Learn level: 0 not studied/new, 1 familiar (still learning), 2 mastered. */
  level: LearnLevel
  srs?: SrsState | null
  lastAt: number
}

export interface MatchRun {
  ms: number
  at: number
}

export interface SetStats {
  studyMs: number
  sessions: number
  lastStudiedAt: number | null
  bestMatchMs: number | null
  /** The owner's own best Match runs (top 10, fastest first). */
  matchRuns: MatchRun[]
  bestBlocks: number | null
  bestBlast: number | null
}

export interface SetProgressDoc {
  cards: Record<string, TermProgress>
  stats: SetStats
  updatedAt: number
}

/** users/{uid}/sessions/{setId}: resumable study state and per-set options. */
export interface SessionDoc {
  flashcards?: unknown
  learn?: unknown
  /** Per-activity option objects; each feature owns its own shape and defaults. */
  options?: Partial<Record<ActivityKind, unknown>>
  /** Grading preferences that apply to Learn and Test for this set. */
  grading?: { level: GradingLevel | null; requireOne: boolean }
  /** Stars for sets the user does not own (public sets studied via a link). */
  starred?: string[]
  /** Rotating offset so repeated Match games cover every term. */
  matchCursor?: number
  updatedAt?: number
}

export interface Folder {
  id: string
  name: string
  setIds: string[]
  createdAt: number
  updatedAt: number
}

export interface TestResult {
  id: string
  setId: string
  scorePct: number
  correct: number
  total: number
  durationMs: number
  settings: Record<string, unknown>
  takenAt: number
}

export interface UserSettings {
  theme: ThemePref
  defaultGrading: 'auto' | GradingLevel
  defaultFlashcardMethod: 'auto' | FlashcardMethod
  newCardsPerDay: number
  sound: boolean
  /** BCP-47 language code -> SpeechSynthesisVoice.voiceURI */
  voices: Record<string, string>
  reducedMotion: boolean
}

export interface StreakInfo {
  current: number
  longest: number
  /** Local calendar date (YYYY-MM-DD) of the last study action. */
  lastStudyDate: string | null
}

export interface UserDoc {
  displayName: string
  email: string | null
  photoURL: string | null
  createdAt: number
  settings: UserSettings
  streak: StreakInfo
  /** Sets where this user has a leaderboard entry (so account deletion can clean up). */
  leaderboardSetIds?: string[]
}

export interface PublicCard {
  id: string
  term: string
  definition: string
  order: number
  imageId?: string | null
  imageUrl?: string | null
  tags?: string[]
}

export interface PublicSetDoc {
  ownerUid: string
  ownerName: string
  title: string
  description: string
  termLang: string
  defLang: string
  cardCount: number
  cards: PublicCard[]
  updatedAt: number
}

export interface LeaderboardEntry {
  uid: string
  displayName: string
  bestTimeMs: number
  achievedAt: number
}

export interface ImageDoc {
  dataUrl: string
  width: number
  height: number
  bytes: number
}
