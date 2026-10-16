/** Questions asked between trays in Blocks. */
import type { GradeReason } from '../../lib/grade'
import { answerSideFor, buildMultipleChoice, buildTrueFalse, otherSide, sideText, type Choice } from '../../lib/questions'
import { pick, shuffle, type Rng } from '../../lib/random'
import type { AnswerWith, Card, Side } from '../../types'

export type QuestionFormat = 'mc' | 'written' | 'tf' | 'mixed'

interface Base {
  card: Card
  /** The side the learner must produce. */
  answerSide: Side
  prompt: string
}

export type BlocksQuestion =
  | (Base & { kind: 'mc'; choices: Choice[]; correctIndex: number })
  | (Base & { kind: 'tf'; shown: Choice; isTrue: boolean })
  | (Base & { kind: 'written'; answer: string })

export function buildQuestion(
  card: Card,
  pool: readonly Card[],
  format: QuestionFormat,
  answerWith: AnswerWith,
  rng: Rng,
): BlocksQuestion {
  const answerSide = answerSideFor(answerWith, rng)
  const kind = format === 'mixed' ? pick(['mc', 'tf', 'written'] as const, rng) : format
  if (kind === 'mc') {
    const q = buildMultipleChoice(card, pool, answerSide, rng)
    if (q.choices.length >= 2) return { kind, card, answerSide, prompt: q.prompt, choices: q.choices, correctIndex: q.correctIndex }
  }
  if (kind === 'tf') {
    const q = buildTrueFalse(card, pool, answerSide, rng)
    return { kind, card, answerSide, prompt: q.prompt, shown: q.shown, isTrue: q.isTrue }
  }
  return { kind: 'written', card, answerSide, prompt: sideText(card, otherSide(answerSide)), answer: sideText(card, answerSide) }
}

/**
 * Draws the next card id from a shuffled deck so every term comes up before
 * any repeats, never returning `exclude` (the current card) unless it's the only one.
 */
export function drawFromDeck(
  deck: readonly string[],
  ids: readonly string[],
  exclude: string | null,
  rng: Rng,
): { id: string | null; deck: string[] } {
  if (!ids.length) return { id: null, deck: [] }
  const valid = new Set(ids)
  let rest = deck.filter((id) => valid.has(id))
  if (!rest.length) rest = shuffle(ids, rng)
  let i = rest.findIndex((id) => id !== exclude)
  if (i < 0) {
    if (ids.length === 1) i = 0
    else {
      rest = [...rest, ...shuffle(ids.filter((id) => id !== exclude), rng)]
      i = rest.findIndex((id) => id !== exclude)
    }
  }
  const [id] = rest.splice(i, 1)
  return { id, deck: rest }
}

/** Correct as typed (or not a written answer), so there's nothing to point out. */
export const exactish = (reason: GradeReason | undefined) => !reason || reason === 'exact' || reason === 'format'
