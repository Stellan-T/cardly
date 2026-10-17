/**
 * AI Insight and AI Hint: what Gemini is told about a card (a wrong answer to
 * explain, or an answer to hint at) and the keys the replies are cached under.
 * Pure functions; the network side lives in data/insights.ts.
 */
import type { Side } from '../types'
import { baseNormalize, type GradeReason } from './grade'
import { languageName } from './languages'

export interface InsightRequest {
  setId: string
  cardId: string
  setTitle: string
  /** Question type as the student saw it (mc, tf, written, spell, matching). */
  questionType: string
  promptSide: Side
  prompt: string
  answerSide: Side
  correctAnswer: string
  /** What the student answered. For true/false: "True" or "False". */
  userAnswer: string
  /** The other side of the card the wrong answer belongs to, if any. */
  userAnswerMeaning?: string
  /** True/false only: the answer shown next to the prompt. */
  shown?: string
  /** Set when the answer was accepted as correct but isn't the card's exact wording: how it differed. */
  accepted?: GradeReason
  promptLang: string
  answerLang: string
}

/** Longest card text sent to the model; flashcards rarely need more and it caps cost. */
const MAX_FIELD = 1500

const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s)

const SIDE_NAME: Record<Side, string> = { term: 'Term', definition: 'Definition' }

const ACCEPTED_AS: Partial<Record<GradeReason, string>> = {
  accent: 'accents ignored',
  typo: 'small typo ignored',
  meaning: 'same key words, different wording',
}

const QUESTION_NAME: Record<string, string> = {
  mc: 'multiple choice',
  tf: 'true/false',
  written: 'written',
  spell: 'spelling (heard the answer, typed it)',
  matching: 'matching',
}

/** The user message for Gemini: the card, the question and the student's answer. */
export function buildInsightPrompt(r: InsightRequest): string {
  const lang = (code: string) => (code ? ` (${languageName(code)})` : '')
  const lines = [
    '<card>',
    r.setTitle && `Set: ${clip(r.setTitle)}`,
    `Question type: ${QUESTION_NAME[r.questionType] ?? r.questionType}`,
    `${SIDE_NAME[r.promptSide]} shown${lang(r.promptLang)}: ${clip(r.prompt)}`,
  ]
  if (r.shown !== undefined) {
    lines.push(
      `Statement: "${clip(r.prompt)}" matches "${clip(r.shown)}"`,
      `Student said: ${r.userAnswer}`,
      `Correct ${SIDE_NAME[r.answerSide].toLowerCase()}${lang(r.answerLang)}: ${clip(r.correctAnswer)}`,
    )
  } else {
    lines.push(
      `Correct ${SIDE_NAME[r.answerSide].toLowerCase()}${lang(r.answerLang)}: ${clip(r.correctAnswer)}`,
      `Student's answer: ${clip(r.userAnswer)}`,
    )
  }
  if (r.accepted) {
    lines.push(`The app accepted this answer as correct (${ACCEPTED_AS[r.accepted] ?? 'close enough'}), but it is not the exact wording.`)
  }
  if (r.userAnswerMeaning) {
    lines.push(`In this set, the student's answer belongs to: ${clip(r.userAnswerMeaning)}`)
  }
  lines.push('</card>')
  return lines.filter(Boolean).join('\n')
}

export interface HintRequest {
  setId: string
  cardId: string
  setTitle: string
  promptSide: Side
  prompt: string
  answerSide: Side
  /** The answer the student is trying to recall (never shown to them by the hint). */
  answer: string
  promptLang: string
  answerLang: string
}

/** The user message for a hint: the card the student is trying to answer. */
export function buildHintPrompt(r: HintRequest): string {
  const lang = (code: string) => (code ? ` (${languageName(code)})` : '')
  return [
    '<card>',
    r.setTitle && `Set: ${clip(r.setTitle)}`,
    `${SIDE_NAME[r.promptSide]} shown${lang(r.promptLang)}: ${clip(r.prompt)}`,
    `${SIDE_NAME[r.answerSide]} to recall, keep it hidden${lang(r.answerLang)}: ${clip(r.answer)}`,
    '</card>',
  ]
    .filter(Boolean)
    .join('\n')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces the answer with "___" wherever it appears in a hint, in case the
 * model gives it away. Checks the whole answer and each of its listed options
 * ("big, large"); very short parts are left alone, they'd match inside words.
 */
export function maskAnswer(text: string, answer: string): string {
  const parts = [answer, ...answer.split(/[,;/]|\bor\b/)]
    .map((p) => p.replace(/\([^)]*\)/g, '').trim())
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length)
  let out = text
  for (const part of new Set(parts)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, 'giu'), '___')
  }
  return out
}

async function shortHash(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return Array.from(new Uint8Array(bytes).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cache key for a hint: one per card, direction and card text. */
export const hintKey = (r: HintRequest) => shortHash(['hint', r.setId, r.cardId, r.answerSide, r.prompt, r.answer])

/**
 * Cache key for an explanation: the same card, direction and (normalised)
 * answer reuse one explanation, so repeating a mistake costs nothing.
 * "Normalised" keeps accents, so an accent slip gets its own explanation.
 */
export function insightKey(r: InsightRequest): Promise<string> {
  return shortHash([r.setId, r.cardId, r.answerSide, r.correctAnswer, r.shown ?? '', baseNormalize(r.userAnswer), r.accepted ?? ''])
}
