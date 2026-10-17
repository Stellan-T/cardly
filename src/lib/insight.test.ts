import { describe, expect, it } from 'vitest'
import { buildInsightPrompt, insightKey, type InsightRequest } from './insight'

const base: InsightRequest = {
  setId: 's1',
  cardId: 'c1',
  setTitle: 'Spanish',
  questionType: 'written',
  promptSide: 'term',
  prompt: 'embarazada',
  answerSide: 'definition',
  correctAnswer: 'pregnant',
  userAnswer: 'embarrassed',
  promptLang: 'es',
  answerLang: 'en',
}

describe('buildInsightPrompt', () => {
  it('describes the card, the correct answer and the student answer as data', () => {
    const text = buildInsightPrompt(base)
    expect(text.startsWith('<card>')).toBe(true)
    expect(text.endsWith('</card>')).toBe(true)
    expect(text).toContain('Term shown (Spanish): embarazada')
    expect(text).toContain('Correct definition (English): pregnant')
    expect(text).toContain("Student's answer: embarrassed")
  })

  it('says what a wrong answer means when it belongs to another card', () => {
    const text = buildInsightPrompt({ ...base, questionType: 'mc', userAnswer: 'tired', userAnswerMeaning: 'cansada' })
    expect(text).toContain('multiple choice')
    expect(text).toContain('belongs to: cansada')
  })

  it('frames true/false questions as a statement and a verdict', () => {
    const text = buildInsightPrompt({ ...base, questionType: 'tf', userAnswer: 'True', shown: 'embarrassed' })
    expect(text).toContain('Statement: "embarazada" matches "embarrassed"')
    expect(text).toContain('Student said: True')
    expect(text).not.toContain("Student's answer")
  })

  it('caps very long card text', () => {
    const text = buildInsightPrompt({ ...base, correctAnswer: 'x'.repeat(5000) })
    expect(text.length).toBeLessThan(2500)
  })
})

describe('insightKey', () => {
  it('is stable for the same mistake, ignoring case and spacing', async () => {
    const a = await insightKey(base)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await insightKey({ ...base, userAnswer: '  Embarrassed ' })).toBe(a)
  })

  it('changes with the answer, the card text or the direction', async () => {
    const a = await insightKey(base)
    expect(await insightKey({ ...base, userAnswer: 'ashamed' })).not.toBe(a)
    expect(await insightKey({ ...base, correctAnswer: 'expecting' })).not.toBe(a)
    expect(await insightKey({ ...base, answerSide: 'term' })).not.toBe(a)
  })
})
