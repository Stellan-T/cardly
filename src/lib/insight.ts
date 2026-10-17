/**
 * AI Insight: what Gemini is told about a wrong answer, and the key its
 * explanation is cached under. Pure functions; the network side lives in
 * data/insights.ts.
 */
import type { Side } from '../types'
import { baseNormalize } from './grade'
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
  promptLang: string
  answerLang: string
}

/** Longest card text sent to the model; flashcards rarely need more and it caps cost. */
const MAX_FIELD = 1500

const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s)

const SIDE_NAME: Record<Side, string> = { term: 'Term', definition: 'Definition' }

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
  if (r.userAnswerMeaning) {
    lines.push(`In this set, the student's answer belongs to: ${clip(r.userAnswerMeaning)}`)
  }
  lines.push('</card>')
  return lines.filter(Boolean).join('\n')
}

/**
 * Cache key for an explanation: the same card, direction and (normalised)
 * answer reuse one explanation, so repeating a mistake costs nothing.
 */
export async function insightKey(r: InsightRequest): Promise<string> {
  const parts = [r.setId, r.cardId, r.answerSide, r.correctAnswer, r.shown ?? '', baseNormalize(r.userAnswer)]
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return Array.from(new Uint8Array(bytes).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}
