/**
 * Practice-test generation and scoring. Pure and deterministic for a given seed.
 *
 * `generateTest` picks distinct terms, spreads them as evenly as possible over
 * the enabled question types and builds True/False, Multiple choice, Matching
 * (lettered blocks of at most 6 prompts) and Written questions, numbered
 * continuously in section order. `scoreTest` grades a set of answers, including
 * "I was correct" overrides on written answers.
 */
import type { AnswerWith, Card, Side } from '../types'
import { grade, type GradeOptions, type GradeReason } from './grade'
import { answerSideFor, buildMultipleChoice, buildTrueFalse, otherSide, sameText, sideText, type Choice } from './questions'
import { createRng, shuffle, type Rng } from './random'

export type TestQuestionType = 'tf' | 'mc' | 'matching' | 'written'

/** Section order on the test page. */
export const TEST_QUESTION_TYPES: readonly TestQuestionType[] = ['tf', 'mc', 'matching', 'written']
export const MATCHING_BLOCK_SIZE = 6
/** Small matching blocks get extra answers from other terms so they are never a give-away. */
export const MIN_MATCHING_OPTIONS = 3
const MC_OPTIONS = 4
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface TestSettings {
  count: number
  answerWith: AnswerWith
  types: readonly TestQuestionType[]
}

interface BaseQuestion {
  /** Unique within the test ("q1", "q2", …). */
  id: string
  /** 1-based, continuous across sections. */
  number: number
  cardId: string
  /** The side the learner has to produce. */
  answerSide: Side
  prompt: string
  /** The correct answer's text. */
  answer: string
}

export interface TfTestQuestion extends BaseQuestion {
  type: 'tf'
  /** The candidate answer shown next to the prompt. */
  shown: Choice
  isTrue: boolean
}

export interface McTestQuestion extends BaseQuestion {
  type: 'mc'
  choices: Choice[]
  correctIndex: number
}

export interface MatchingOption {
  letter: string
  cardId: string
  text: string
}

export interface MatchingTestQuestion extends BaseQuestion {
  type: 'matching'
  blockId: string
  /** The block's lettered answers (shared by every prompt in the block). */
  options: readonly MatchingOption[]
  correctLetter: string
}

export interface WrittenTestQuestion extends BaseQuestion {
  type: 'written'
}

export type TestQuestion = TfTestQuestion | McTestQuestion | MatchingTestQuestion | WrittenTestQuestion

export interface MatchingBlock {
  id: string
  answerSide: Side
  questions: MatchingTestQuestion[]
  options: MatchingOption[]
}

export interface TestSection {
  type: TestQuestionType
  questions: TestQuestion[]
  /** Matching only: the lettered blocks (their questions are also in `questions`). */
  blocks: MatchingBlock[]
}

export interface GeneratedTest {
  seed: number
  /** The settings actually used (count clamped to the available terms, types in section order). */
  settings: TestSettings
  sections: TestSection[]
  /** Every question in display order. */
  questions: TestQuestion[]
}

/** Splits `total` over `types` as evenly as possible; the remainder goes to randomly chosen types. */
export function distributeCounts(total: number, types: readonly TestQuestionType[], rng: Rng): Record<TestQuestionType, number> {
  const out: Record<TestQuestionType, number> = { tf: 0, mc: 0, matching: 0, written: 0 }
  if (!types.length || total <= 0) return out
  const base = Math.floor(total / types.length)
  for (const t of types) out[t] = base
  for (const t of shuffle(types, rng).slice(0, total - base * types.length)) out[t]++
  return out
}

/** Block sizes for `n` matching prompts: as few blocks of at most `max` as possible, sized evenly (7 → 4 + 3). */
export function matchingBlockSizes(n: number, max = MATCHING_BLOCK_SIZE): number[] {
  if (n <= 0) return []
  const blocks = Math.ceil(n / max)
  const base = Math.floor(n / blocks)
  return Array.from({ length: blocks }, (_, i) => base + (i < n % blocks ? 1 : 0))
}

const base = (card: Card, side: Side) => ({
  id: '',
  number: 0,
  cardId: card.id,
  answerSide: side,
  prompt: sideText(card, otherSide(side)),
  answer: sideText(card, side),
})

function buildQuestion(type: 'tf' | 'mc' | 'written', card: Card, answerWith: AnswerWith, pool: readonly Card[], rng: Rng): TestQuestion {
  const side = answerSideFor(answerWith, rng)
  if (type === 'tf') {
    const tf = buildTrueFalse(card, pool, side, rng)
    return { ...base(card, side), type, shown: tf.shown, isTrue: tf.isTrue }
  }
  if (type === 'mc') {
    const mc = buildMultipleChoice(card, pool, side, rng, MC_OPTIONS)
    return { ...base(card, side), type, choices: mc.choices, correctIndex: mc.correctIndex }
  }
  return { ...base(card, side), type }
}

function buildMatchingBlock(members: readonly Card[], id: string, answerWith: AnswerWith, pool: readonly Card[], rng: Rng): MatchingBlock {
  // One direction per block so the lettered list never mixes terms and definitions.
  const side = answerSideFor(answerWith, rng)
  const entries = members.map((c) => ({ cardId: c.id, text: sideText(c, side) }))
  if (entries.length < MIN_MATCHING_OPTIONS) {
    const ids = new Set(members.map((c) => c.id))
    for (const other of shuffle(pool, rng)) {
      if (entries.length >= MIN_MATCHING_OPTIONS) break
      const text = sideText(other, side)
      if (ids.has(other.id) || !text.trim() || entries.some((e) => sameText(e.text, text))) continue
      entries.push({ cardId: other.id, text })
    }
  }
  const options = shuffle(entries, rng).map((e, i) => ({ letter: LETTERS[i], cardId: e.cardId, text: e.text }))
  const questions = members.map(
    (card): MatchingTestQuestion => ({
      ...base(card, side),
      type: 'matching',
      blockId: id,
      options,
      correctLetter: options.find((o) => o.cardId === card.id)!.letter,
    }),
  )
  return { id, answerSide: side, questions, options }
}

/**
 * Builds a new test from `cards`. Each term is asked at most once (the count is
 * clamped to the number of cards). Distractors come from `pool` (e.g. the whole
 * set when only starred terms are tested); it defaults to `cards`.
 */
export function generateTest(cards: readonly Card[], settings: TestSettings, seed: number, pool: readonly Card[] = cards): GeneratedTest {
  const rng = createRng(seed)
  const enabled = TEST_QUESTION_TYPES.filter((t) => settings.types.includes(t))
  const types = enabled.length ? enabled : [...TEST_QUESTION_TYPES]
  const count = Math.max(0, Math.min(Math.floor(settings.count) || 0, cards.length))

  const byId = new Map(pool.map((c) => [c.id, c]))
  for (const c of cards) if (!byId.has(c.id)) byId.set(c.id, c)
  const distractors = [...byId.values()]

  const chosen = shuffle(cards, rng).slice(0, count)
  const perType = distributeCounts(count, types, rng)
  const sections: TestSection[] = []
  let offset = 0
  for (const type of types) {
    const group = chosen.slice(offset, offset + perType[type])
    offset += group.length
    if (!group.length) continue
    if (type === 'matching') {
      const blocks: MatchingBlock[] = []
      let start = 0
      for (const size of matchingBlockSizes(group.length)) {
        blocks.push(buildMatchingBlock(group.slice(start, start + size), `m${blocks.length + 1}`, settings.answerWith, distractors, rng))
        start += size
      }
      sections.push({ type, questions: blocks.flatMap((b) => b.questions), blocks })
    } else {
      sections.push({ type, questions: group.map((c) => buildQuestion(type, c, settings.answerWith, distractors, rng)), blocks: [] })
    }
  }

  const questions = sections.flatMap((s) => s.questions)
  questions.forEach((q, i) => {
    q.number = i + 1
    q.id = `q${i + 1}`
  })
  return { seed, settings: { count, answerWith: settings.answerWith, types }, sections, questions }
}

// ---------------------------------------------------------------------------
// Answers and scoring
// ---------------------------------------------------------------------------

/** True/False: boolean · Multiple choice: choice index · Matching: letter · Written: text. */
export type TestAnswer = boolean | number | string
export type TestAnswers = Readonly<Record<string, TestAnswer | undefined>>

export function isAnswered(q: TestQuestion, a: TestAnswer | undefined): boolean {
  switch (q.type) {
    case 'tf':
      return typeof a === 'boolean'
    case 'mc':
      return typeof a === 'number' && a >= 0 && a < q.choices.length
    case 'matching':
      return typeof a === 'string' && q.options.some((o) => o.letter === a)
    case 'written':
      return typeof a === 'string' && a.trim() !== ''
  }
}

export type GradeFn = (response: string, answer: string) => { correct: boolean; reason: GradeReason }

/** A `GradeFn` using the grading level / "Require 1 answer only" preferences. */
export const gradeWith =
  (options: GradeOptions): GradeFn =>
  (response, answer) =>
    grade(response, answer, options)

export interface QuestionResult {
  questionId: string
  cardId: string
  type: TestQuestionType
  answered: boolean
  correct: boolean
  /** The learner's answer as text ("True"/"False", the chosen option, the typed text); '' when unanswered. */
  response: string
  /** The correct answer as text ("True"/"False" for True/False questions). */
  expected: string
  /** Matching: the chosen letter. */
  letter: string | null
  /** Written: how the answer was graded. */
  reason: GradeReason | null
  /** Written: marked correct by the learner ("I was correct"). */
  overridden: boolean
}

export interface TestScore {
  results: QuestionResult[]
  byId: Record<string, QuestionResult>
  correct: number
  incorrect: number
  answered: number
  unanswered: number
  total: number
  /** 0–100, rounded. */
  scorePct: number
  /** Terms answered incorrectly (or not at all), in question order. */
  missedCardIds: string[]
}

const tfText = (v: boolean) => (v ? 'True' : 'False')

export function scoreQuestion(q: TestQuestion, a: TestAnswer | undefined, gradeFn: GradeFn, overridden = false): QuestionResult {
  const answered = isAnswered(q, a)
  const result: QuestionResult = {
    questionId: q.id,
    cardId: q.cardId,
    type: q.type,
    answered,
    correct: false,
    response: '',
    expected: q.answer,
    letter: null,
    reason: null,
    overridden: false,
  }
  switch (q.type) {
    case 'tf':
      result.expected = tfText(q.isTrue)
      if (answered) {
        result.response = tfText(a as boolean)
        result.correct = a === q.isTrue
      }
      break
    case 'mc':
      result.expected = q.choices[q.correctIndex]?.text ?? q.answer
      if (answered) {
        result.response = q.choices[a as number].text
        result.correct = a === q.correctIndex || sameText(result.response, result.expected)
      }
      break
    case 'matching':
      if (answered) {
        result.letter = a as string
        result.response = q.options.find((o) => o.letter === a)!.text
        result.correct = a === q.correctLetter || sameText(result.response, q.answer)
      }
      break
    case 'written': {
      const response = typeof a === 'string' ? a.trim() : ''
      const graded = gradeFn(response, q.answer)
      result.response = response
      result.reason = answered ? graded.reason : 'empty'
      result.correct = answered && graded.correct
      if (overridden && !result.correct) {
        result.correct = true
        result.overridden = true
      }
      break
    }
  }
  return result
}

const NO_OVERRIDES: ReadonlySet<string> = new Set()

/**
 * Scores every question. Unanswered questions count as incorrect. `overrides`
 * holds ids of written questions the learner marked "I was correct".
 */
export function scoreTest(
  questions: readonly TestQuestion[],
  answers: TestAnswers,
  gradeFn: GradeFn,
  overrides: ReadonlySet<string> = NO_OVERRIDES,
): TestScore {
  const results = questions.map((q) => scoreQuestion(q, answers[q.id], gradeFn, q.type === 'written' && overrides.has(q.id)))
  const correct = results.filter((r) => r.correct).length
  const answered = results.filter((r) => r.answered).length
  const total = results.length
  return {
    results,
    byId: Object.fromEntries(results.map((r) => [r.questionId, r])),
    correct,
    incorrect: total - correct,
    answered,
    unanswered: total - answered,
    total,
    scorePct: total ? Math.round((correct / total) * 100) : 0,
    missedCardIds: [...new Set(results.filter((r) => !r.correct).map((r) => r.cardId))],
  }
}
