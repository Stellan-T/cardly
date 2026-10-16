/**
 * Building blocks for questions shared by Learn, Test, Blocks and Blast:
 * which side is asked, multiple-choice distractors and true/false pairings.
 */
import type { AnswerWith, Card, Side } from '../types'
import { shuffle, type Rng } from './random'

export type QuestionType = 'flashcard' | 'mc' | 'tf' | 'written' | 'spell' | 'matching'

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  flashcard: 'Flashcards',
  mc: 'Multiple choice',
  tf: 'True/False',
  written: 'Written',
  spell: 'Spell',
  matching: 'Matching',
}

export const otherSide = (s: Side): Side => (s === 'term' ? 'definition' : 'term')

/** The side the learner must produce. "both" picks one per question. */
export function answerSideFor(answerWith: AnswerWith, rng: Rng): Side {
  if (answerWith === 'both') return rng() < 0.5 ? 'term' : 'definition'
  return answerWith
}

export const sideText = (card: Pick<Card, 'term' | 'definition'>, side: Side) =>
  side === 'term' ? card.term : card.definition

export interface Choice {
  cardId: string
  text: string
}

type Kind = 'number' | 'year' | 'word' | 'phrase' | 'sentence'

export function textKind(text: string): Kind {
  const t = text.trim()
  if (/^(1[0-9]{3}|20[0-9]{2})(\s*[-–]\s*(1[0-9]{3}|20[0-9]{2}))?$/.test(t)) return 'year'
  if (/^[-+]?[\d\s.,/%°]+$/.test(t)) return 'number'
  const words = t.split(/\s+/).filter(Boolean).length
  if (words <= 1) return 'word'
  if (words <= 5) return 'phrase'
  return 'sentence'
}

const norm = (s: string) => s.trim().toLocaleLowerCase()

/**
 * Picks distractors for a card: other cards' text on the same side, preferring
 * the same kind (numbers with numbers, single words with single words) and a
 * similar length. Never returns text identical to the correct answer.
 */
export function pickDistractors(
  card: Card,
  pool: readonly Card[],
  side: Side,
  count: number,
  rng: Rng,
): Choice[] {
  const answer = sideText(card, side)
  const kind = textKind(answer)
  const len = answer.length
  const seen = new Set([norm(answer)])
  const scored: { choice: Choice; score: number }[] = []
  for (const other of pool) {
    if (other.id === card.id) continue
    const text = sideText(other, side)
    const key = norm(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const lenScore = 1 - Math.min(1, Math.abs(text.length - len) / Math.max(len, text.length, 1))
    const score = (textKind(text) === kind ? 2 : 0) + lenScore * 1.5 + rng() * 1.2
    scored.push({ choice: { cardId: other.id, text }, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map((s) => s.choice)
}

export interface McQuestion {
  cardId: string
  answerSide: Side
  prompt: string
  choices: Choice[]
  correctIndex: number
}

export function buildMultipleChoice(card: Card, pool: readonly Card[], answerSide: Side, rng: Rng, options = 4): McQuestion {
  const distractors = pickDistractors(card, pool, answerSide, options - 1, rng)
  const correct: Choice = { cardId: card.id, text: sideText(card, answerSide) }
  const choices = shuffle([correct, ...distractors], rng)
  return {
    cardId: card.id,
    answerSide,
    prompt: sideText(card, otherSide(answerSide)),
    choices,
    correctIndex: choices.findIndex((c) => c.cardId === card.id),
  }
}

export interface TfQuestion {
  cardId: string
  answerSide: Side
  prompt: string
  shown: Choice
  isTrue: boolean
}

/** About half the pairings are correct. */
export function buildTrueFalse(card: Card, pool: readonly Card[], answerSide: Side, rng: Rng): TfQuestion {
  const prompt = sideText(card, otherSide(answerSide))
  const wantTrue = rng() < 0.5
  if (!wantTrue) {
    const [d] = pickDistractors(card, pool, answerSide, 1, rng)
    if (d) return { cardId: card.id, answerSide, prompt, shown: d, isTrue: false }
  }
  return { cardId: card.id, answerSide, prompt, shown: { cardId: card.id, text: sideText(card, answerSide) }, isTrue: true }
}

/** True when the response is the same text as the expected answer (TF/MC pairings with duplicate text). */
export const sameText = (a: string, b: string) => norm(a) === norm(b)
