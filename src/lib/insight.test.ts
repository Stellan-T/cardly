import { describe, expect, it } from 'vitest'
import { buildHintPrompt, buildInsightPrompt, hintKey, insightKey, maskAnswer, type HintRequest, type InsightRequest } from './insight'

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

const hint: HintRequest = {
  setId: 's1',
  cardId: 'c1',
  setTitle: 'Spanish',
  promptSide: 'definition',
  prompt: 'pregnant',
  answerSide: 'term',
  answer: 'embarazada',
  promptLang: 'en',
  answerLang: 'es',
}

describe('buildHintPrompt', () => {
  it('gives the model the answer to hint at, marked as hidden', () => {
    const text = buildHintPrompt(hint)
    expect(text).toContain('Definition shown (English): pregnant')
    expect(text).toContain('Term to recall, keep it hidden (Spanish): embarazada')
    expect(text.startsWith('<card>')).toBe(true)
  })
})

describe('maskAnswer', () => {
  it('blanks the answer out of a hint, ignoring case', () => {
    expect(maskAnswer('Ella está Embarazada de tres meses.', 'embarazada')).toBe('Ella está ___ de tres meses.')
  })

  it('blanks each listed option and ignores parenthesised parts', () => {
    expect(maskAnswer('A big house, a large garden.', 'big, large')).toBe('A ___ house, a ___ garden.')
    expect(maskAnswer('I like to run every day.', '(to) run')).toBe('I like to ___ every day.')
    expect(maskAnswer('Cats or dogs?', 'cat or dog')).toBe('Cats or dogs?')
  })

  it('only matches whole words and leaves very short answers alone', () => {
    expect(maskAnswer('Mitochondria make energy.', 'mito')).toBe('Mitochondria make energy.')
    expect(maskAnswer('A is for apple.', 'a')).toBe('A is for apple.')
  })

  it('handles answers with regex characters', () => {
    expect(maskAnswer('Use C++ here.', 'C++')).toBe('Use ___ here.')
  })
})

describe('hintKey', () => {
  it('is one per card and changes when the card text changes', async () => {
    const a = await hintKey(hint)
    expect(await hintKey({ ...hint })).toBe(a)
    expect(await hintKey({ ...hint, answer: 'encinta' })).not.toBe(a)
    expect(await hintKey({ ...hint, answerSide: 'definition' })).not.toBe(a)
  })

  it('never collides with an insight key for the same card', async () => {
    const insight = await insightKey({ ...base, userAnswer: '' })
    expect(await hintKey({ ...hint, prompt: base.prompt, answer: base.correctAnswer, answerSide: base.answerSide })).not.toBe(insight)
  })
})
