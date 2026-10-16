/**
 * Learn: adaptive mastery, as a pure state machine (persisted after every answer).
 *
 *  - Work in rounds of N terms (default 7). Each term must be answered
 *    correctly twice: the first correct answer (normally multiple choice)
 *    makes it familiar, the second (normally written) masters it.
 *  - A wrong answer moves the term back a level and requeues it later in the
 *    same round. A round ends once every term in it has been answered
 *    correctly once; then a progress checkpoint is shown.
 *  - First-try correct answers build a streak (shown from 5 on); a wrong
 *    answer or changing the question types resets it.
 */
import type { AnswerWith, Card, LearnLevel, Side } from '../types'
import { answerSideFor, buildMultipleChoice, buildTrueFalse, type Choice } from './questions'
import { createRng, shuffle, type Rng } from './random'

export type LearnQType = 'flashcard' | 'mc' | 'tf' | 'written' | 'spell'

export interface LearnTypes {
  flashcard: boolean
  mc: boolean
  tf: boolean
  written: boolean
}

export interface LearnOptions {
  answerWith: AnswerWith
  types: LearnTypes
  /** Written questions only (the former Write mode). */
  writeMode: boolean
  /** Hear the answer with TTS and type it (replaces written questions). */
  spellMode: boolean
  starredOnly: boolean
  shuffle: boolean
  /** Speak the prompt automatically. */
  audio: boolean
  /** Short sound on correct/incorrect. */
  sfx: boolean
  roundSize: number
  /** After a wrong written answer, type the correct answer before continuing. */
  retype: boolean
}

export const DEFAULT_LEARN_OPTIONS: LearnOptions = {
  answerWith: 'term',
  types: { flashcard: false, mc: true, tf: false, written: true },
  writeMode: false,
  spellMode: false,
  starredOnly: false,
  shuffle: true,
  audio: false,
  sfx: true,
  roundSize: 7,
  retype: false,
}

export type LearnGoal = 'review' | 'memorize' | 'test'

export const LEARN_GOALS: Record<LearnGoal, { title: string; description: string; options: Partial<LearnOptions> }> = {
  review: {
    title: 'Quickly review',
    description: 'Recognise the answers: multiple choice, true/false and flashcards, in bigger rounds.',
    options: { types: { flashcard: true, mc: true, tf: true, written: false }, roundSize: 10, writeMode: false, retype: false },
  },
  memorize: {
    title: 'Memorise it all',
    description: 'Multiple choice first, then type each answer from memory.',
    options: { types: { flashcard: false, mc: true, tf: false, written: true }, roundSize: 7, writeMode: false, retype: false },
  },
  test: {
    title: 'Get ready for a test',
    description: 'Every question type, and retype answers you miss so they stick.',
    options: { types: { flashcard: false, mc: true, tf: true, written: true }, roundSize: 7, writeMode: false, retype: true },
  },
}

export interface LearnQuestion {
  /** Unique per question (used for keys/resume). */
  qid: number
  cardId: string
  type: LearnQType
  answerSide: Side
  choices?: Choice[]
  correctIndex?: number
  shown?: Choice
  isTrue?: boolean
}

export interface LearnState {
  version: 1
  /** Terms in this Learn session (fingerprinted so a changed filter starts fresh). */
  termIds: string[]
  levels: Record<string, LearnLevel>
  round: number
  roundIds: string[]
  /** Card ids still to ask in this round, next first. */
  queue: string[]
  roundResults: Record<string, ('correct' | 'incorrect')[]>
  current: LearnQuestion | null
  phase: 'question' | 'checkpoint' | 'complete'
  streak: number
  typesKey: string
  answered: number
  correctCount: number
  missed: string[]
  elapsedMs: number
  lastActionAt: number
  seed: number
  qCounter: number
}

/** The question types actually used, given the options. */
export function enabledTypes(o: Pick<LearnOptions, 'types' | 'writeMode' | 'spellMode'>): LearnQType[] {
  const written: LearnQType = o.spellMode ? 'spell' : 'written'
  if (o.writeMode) return [written]
  const list: LearnQType[] = []
  if (o.types.flashcard) list.push('flashcard')
  if (o.types.mc) list.push('mc')
  if (o.types.tf) list.push('tf')
  if (o.types.written) list.push(written)
  if (!list.length) list.push('mc', written)
  return list
}

export const typesKeyOf = (o: Pick<LearnOptions, 'types' | 'writeMode' | 'spellMode'>) => enabledTypes(o).join(',')

const RECOGNITION: LearnQType[] = ['mc', 'tf', 'flashcard']
const PRODUCTION: LearnQType[] = ['written', 'spell']

/** New terms get recognition questions; familiar ones get typed answers when enabled. */
export function chooseType(level: LearnLevel, enabled: LearnQType[], rng: Rng): LearnQType {
  const recog = enabled.filter((t) => RECOGNITION.includes(t))
  const prod = enabled.filter((t) => PRODUCTION.includes(t))
  const list = level === 0 ? (recog.length ? recog : prod) : prod.length ? prod : recog
  return list[Math.floor(rng() * list.length)]
}

export function createLearnState(
  termIds: string[],
  initialLevels: Record<string, LearnLevel>,
  options: LearnOptions,
  seed: number,
  now: number,
): LearnState {
  const rng = createRng(seed)
  const ordered = options.shuffle ? shuffle(termIds, rng) : [...termIds]
  const levels: Record<string, LearnLevel> = {}
  for (const id of ordered) levels[id] = initialLevels[id] ?? 0
  const state: LearnState = {
    version: 1,
    termIds: ordered,
    levels,
    round: 0,
    roundIds: [],
    queue: [],
    roundResults: {},
    current: null,
    phase: 'question',
    streak: 0,
    typesKey: typesKeyOf(options),
    answered: 0,
    correctCount: 0,
    missed: [],
    elapsedMs: 0,
    lastActionAt: now,
    seed,
    qCounter: 0,
  }
  return startRound(state, options)
}

export const isMastered = (s: LearnState) => s.termIds.every((id) => s.levels[id] === 2)

/** Picks the next round: familiar terms first (to finish them), then new ones. */
export function startRound(state: LearnState, options: LearnOptions): LearnState {
  if (isMastered(state)) return { ...state, phase: 'complete', current: null, queue: [], roundIds: [] }
  const size = Math.max(1, Math.min(10, options.roundSize))
  const familiar = state.termIds.filter((id) => state.levels[id] === 1)
  const fresh = state.termIds.filter((id) => state.levels[id] === 0)
  const roundIds = [...familiar, ...fresh].slice(0, size)
  const rng = createRng(state.seed + state.round * 7919)
  const queue = options.shuffle ? shuffle(roundIds, rng) : roundIds
  return { ...state, round: state.round + 1, roundIds, queue, roundResults: {}, current: null, phase: 'question' }
}

/** Builds the question for the front of the queue (or returns the state unchanged if one is pending). */
export function ensureQuestion(state: LearnState, cards: readonly Card[], pool: readonly Card[], options: LearnOptions): LearnState {
  if (state.phase !== 'question' || state.current) return state
  if (!state.queue.length) return { ...state, phase: isMastered(state) ? 'complete' : 'checkpoint' }
  const cardId = state.queue[0]
  const card = cards.find((c) => c.id === cardId)
  if (!card) return { ...state, queue: state.queue.slice(1) }
  const rng = createRng(state.seed + state.qCounter * 104729 + 1)
  const enabled = enabledTypes(options)
  let type = chooseType(state.levels[cardId] ?? 0, enabled, rng)
  const answerSide = answerSideFor(options.answerWith, rng)
  const others = pool.filter((c) => c.id !== card.id)
  // Recognition questions need at least one other term to compare with.
  if ((type === 'mc' || type === 'tf') && others.length === 0) type = enabled.includes('flashcard') ? 'flashcard' : 'written'
  const q: LearnQuestion = { qid: state.qCounter + 1, cardId, type, answerSide }
  if (type === 'mc') {
    const mc = buildMultipleChoice(card, pool, answerSide, rng, Math.min(4, pool.length))
    q.choices = mc.choices
    q.correctIndex = mc.correctIndex
  } else if (type === 'tf') {
    const tf = buildTrueFalse(card, pool, answerSide, rng)
    q.shown = tf.shown
    q.isTrue = tf.isTrue
  }
  return { ...state, current: q, qCounter: state.qCounter + 1 }
}

export interface AnswerInput {
  correct: boolean
  /** False when the user needed a retry, peeked ("Don't know?"), etc. */
  firstTry: boolean
  now: number
}

/** Commits an answer to the current question. */
export function commitAnswer(state: LearnState, input: AnswerInput): LearnState {
  const q = state.current
  if (!q) return state
  const id = q.cardId
  const level = state.levels[id] ?? 0
  const elapsed = state.elapsedMs + Math.min(Math.max(0, input.now - state.lastActionAt), 120_000)
  const results = { ...state.roundResults, [id]: [...(state.roundResults[id] ?? []), input.correct ? 'correct' : 'incorrect'] } as LearnState['roundResults']
  const base = {
    ...state,
    current: null,
    answered: state.answered + 1,
    elapsedMs: elapsed,
    lastActionAt: input.now,
    roundResults: results,
  }
  let next: LearnState
  if (input.correct) {
    next = {
      ...base,
      levels: { ...state.levels, [id]: Math.min(2, level + 1) as LearnLevel },
      queue: state.queue.slice(1),
      correctCount: state.correctCount + 1,
      streak: input.firstTry ? state.streak + 1 : state.streak,
    }
  } else {
    // Requeue later in the round (after a couple of other questions when possible).
    const rest = state.queue.slice(1)
    const at = Math.min(rest.length, 2)
    next = {
      ...base,
      levels: { ...state.levels, [id]: Math.max(0, level - 1) as LearnLevel },
      queue: [...rest.slice(0, at), id, ...rest.slice(at)],
      streak: 0,
      missed: state.missed.includes(id) ? state.missed : [...state.missed, id],
    }
  }
  if (next.queue.length === 0) next = { ...next, phase: isMastered(next) ? 'complete' : 'checkpoint' }
  return next
}

/** "Continue" on the checkpoint screen. */
export function continueAfterCheckpoint(state: LearnState, options: LearnOptions): LearnState {
  return startRound({ ...state, lastActionAt: Date.now() }, options)
}

/** Applies changed options: new question types reset the streak and the pending question. */
export function applyOptions(state: LearnState, options: LearnOptions): LearnState {
  const key = typesKeyOf(options)
  if (key === state.typesKey) return state
  return { ...state, typesKey: key, streak: 0, current: null }
}

/** ✓ when a term had no wrong answers this round. */
export function roundSummary(state: LearnState): { id: string; ok: boolean }[] {
  return state.roundIds.map((id) => ({ id, ok: !(state.roundResults[id] ?? []).includes('incorrect') }))
}

export const STREAK_THRESHOLD = 5
