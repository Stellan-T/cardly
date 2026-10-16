import { describe, expect, it } from 'vitest'
import type { Card } from '../types'
import { createRng } from './random'
import {
  MATCHING_BLOCK_SIZE,
  TEST_QUESTION_TYPES,
  distributeCounts,
  generateTest,
  gradeWith,
  isAnswered,
  matchingBlockSizes,
  scoreTest,
  type MatchingTestQuestion,
  type TestAnswers,
  type TestQuestion,
  type TestQuestionType,
  type TestSettings,
} from './testGen'

const WORDS = ['apple', 'river', 'mountain', 'candle', 'window', 'garden', 'pencil', 'rocket', 'ocean', 'forest']

function makeCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    term: `term ${i}`,
    definition: `${WORDS[i % WORDS.length]} meaning number ${i}`,
    order: i,
    starred: false,
  }))
}

const ALL: TestSettings = { count: 20, answerWith: 'term', types: TEST_QUESTION_TYPES }
const settings = (patch: Partial<TestSettings> = {}): TestSettings => ({ ...ALL, ...patch })
const countByType = (qs: readonly TestQuestion[]) => {
  const out: Record<TestQuestionType, number> = { tf: 0, mc: 0, matching: 0, written: 0 }
  for (const q of qs) out[q.type]++
  return out
}

/** The answers a perfect student would give. */
function perfectAnswers(qs: readonly TestQuestion[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const q of qs) {
    if (q.type === 'tf') out[q.id] = q.isTrue
    else if (q.type === 'mc') out[q.id] = q.correctIndex
    else if (q.type === 'matching') out[q.id] = q.correctLetter
    else out[q.id] = q.answer
  }
  return out
}

const moderate = gradeWith({ level: 'moderate' })

describe('generateTest: counts and distribution', () => {
  it('asks the requested number of questions, spread evenly over all types', () => {
    const test = generateTest(makeCards(40), settings({ count: 20 }), 1)
    expect(test.questions).toHaveLength(20)
    expect(countByType(test.questions)).toEqual({ tf: 5, mc: 5, matching: 5, written: 5 })
  })

  it('gives the remainder to different types so counts differ by at most one', () => {
    for (const count of [1, 2, 3, 5, 7, 10, 13]) {
      const test = generateTest(makeCards(30), settings({ count }), count * 17)
      const counts = Object.values(countByType(test.questions))
      expect(counts.reduce((a, b) => a + b, 0)).toBe(count)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    }
  })

  it('only uses the enabled types, in section order, numbered continuously', () => {
    const test = generateTest(makeCards(30), settings({ count: 7, types: ['written', 'tf'] }), 3)
    expect(test.sections.map((s) => s.type)).toEqual(['tf', 'written'])
    const counts = countByType(test.questions)
    expect(counts.mc + counts.matching).toBe(0)
    expect([counts.tf, counts.written].sort()).toEqual([3, 4])
    expect(test.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(test.questions.map((q) => q.id)).size).toBe(7)
    expect(test.settings.types).toEqual(['tf', 'written'])
  })

  it('falls back to every type when none is enabled', () => {
    const test = generateTest(makeCards(10), settings({ count: 8, types: [] }), 4)
    expect(countByType(test.questions)).toEqual({ tf: 2, mc: 2, matching: 2, written: 2 })
  })

  it('distributeCounts handles zero and single types', () => {
    const rng = createRng(1)
    expect(distributeCounts(0, ['tf', 'mc'], rng)).toEqual({ tf: 0, mc: 0, matching: 0, written: 0 })
    expect(distributeCounts(9, ['mc'], rng)).toEqual({ tf: 0, mc: 9, matching: 0, written: 0 })
  })
})

describe('generateTest: terms', () => {
  it('never asks the same term twice', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const test = generateTest(makeCards(25), settings({ count: 25 }), seed)
      const ids = test.questions.map((q) => q.cardId)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toHaveLength(25)
    }
  })

  it('clamps the count to the number of terms', () => {
    const test = generateTest(makeCards(6), settings({ count: 50 }), 9)
    expect(test.questions).toHaveLength(6)
    expect(test.settings.count).toBe(6)
    expect(new Set(test.questions.map((q) => q.cardId)).size).toBe(6)
  })

  it('works with the minimum of two terms', () => {
    const test = generateTest(makeCards(2), settings({ count: 2 }), 11)
    expect(test.questions).toHaveLength(2)
    for (const q of test.questions) {
      if (q.type === 'mc') expect(q.choices).toHaveLength(2)
      if (q.type === 'matching') expect(q.options.length).toBeLessThanOrEqual(2)
    }
  })
})

describe('generateTest: question types', () => {
  it('builds multiple choice with 4 distinct options and the right answer', () => {
    const test = generateTest(makeCards(20), settings({ types: ['mc'], count: 10 }), 5)
    for (const q of test.questions) {
      if (q.type !== 'mc') throw new Error('expected mc')
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices.map((c) => c.text)).size).toBe(4)
      expect(q.choices[q.correctIndex].cardId).toBe(q.cardId)
      expect(q.choices[q.correctIndex].text).toBe(q.answer)
    }
  })

  it('uses fewer multiple-choice options for small sets, with distractors from the pool', () => {
    const cards = makeCards(3)
    const small = generateTest(cards, settings({ types: ['mc'], count: 3 }), 6)
    expect(small.questions.every((q) => q.type === 'mc' && q.choices.length === 3)).toBe(true)
    // Starred subset of 2 terms, distractors from the whole set of 12.
    const pool = makeCards(12)
    const test = generateTest(pool.slice(0, 2), settings({ types: ['mc'], count: 2 }), 6, pool)
    expect(test.questions.every((q) => q.type === 'mc' && q.choices.length === 4)).toBe(true)
  })

  it('pairs true/false correctly about half the time', () => {
    let trues = 0
    let total = 0
    for (let seed = 1; seed <= 20; seed++) {
      const test = generateTest(makeCards(20), settings({ types: ['tf'], count: 20 }), seed)
      for (const q of test.questions) {
        if (q.type !== 'tf') throw new Error('expected tf')
        total++
        if (q.isTrue) {
          trues++
          expect(q.shown.text).toBe(q.answer)
        } else expect(q.shown.text).not.toBe(q.answer)
      }
    }
    expect(trues / total).toBeGreaterThan(0.35)
    expect(trues / total).toBeLessThan(0.65)
  })

  it('splits matching into lettered blocks of at most 6', () => {
    expect(matchingBlockSizes(6)).toEqual([6])
    expect(matchingBlockSizes(7)).toEqual([4, 3])
    expect(matchingBlockSizes(13)).toEqual([5, 4, 4])
    expect(matchingBlockSizes(0)).toEqual([])

    const test = generateTest(makeCards(30), settings({ types: ['matching'], count: 13 }), 8)
    const section = test.sections[0]
    expect(section.type).toBe('matching')
    expect(section.blocks.map((b) => b.questions.length)).toEqual([5, 4, 4])
    for (const block of section.blocks) {
      expect(block.questions.length).toBeLessThanOrEqual(MATCHING_BLOCK_SIZE)
      expect(block.options.map((o) => o.letter)).toEqual('ABCDEF'.slice(0, block.options.length).split(''))
      for (const q of block.questions) {
        expect(q.blockId).toBe(block.id)
        expect(q.options).toBe(block.options)
        const correct = block.options.find((o) => o.letter === q.correctLetter)!
        expect(correct.cardId).toBe(q.cardId)
        expect(correct.text).toBe(q.answer)
      }
    }
    // Blocks are flattened in order and numbered continuously.
    expect(section.questions).toEqual(section.blocks.flatMap((b) => b.questions))
  })

  it('pads a tiny matching block with answers from other terms', () => {
    const test = generateTest(makeCards(10), settings({ types: ['matching'], count: 1 }), 2)
    const [block] = test.sections[0].blocks
    expect(block.questions).toHaveLength(1)
    expect(block.options).toHaveLength(3)
    expect(new Set(block.options.map((o) => o.text)).size).toBe(3)
  })

  it('builds written questions asking for the chosen side', () => {
    const cards = makeCards(5)
    const test = generateTest(cards, settings({ types: ['written'], count: 5, answerWith: 'definition' }), 3)
    for (const q of test.questions) {
      const card = cards.find((c) => c.id === q.cardId)!
      expect(q.answerSide).toBe('definition')
      expect(q.prompt).toBe(card.term)
      expect(q.answer).toBe(card.definition)
    }
  })
})

describe('generateTest: answer direction', () => {
  it('answers with the term: prompts are definitions', () => {
    const cards = makeCards(20)
    const test = generateTest(cards, settings({ count: 20, answerWith: 'term' }), 10)
    for (const q of test.questions) {
      const card = cards.find((c) => c.id === q.cardId)!
      expect(q.answerSide).toBe('term')
      expect(q.prompt).toBe(card.definition)
      expect(q.answer).toBe(card.term)
    }
  })

  it('"Both" mixes directions, but keeps one direction per matching block', () => {
    const test = generateTest(makeCards(60), settings({ count: 60, answerWith: 'both' }), 12)
    const sides = new Set(test.questions.map((q) => q.answerSide))
    expect(sides).toEqual(new Set(['term', 'definition']))
    for (const block of test.sections.find((s) => s.type === 'matching')!.blocks) {
      expect(block.questions.every((q) => q.answerSide === block.answerSide)).toBe(true)
    }
  })
})

describe('generateTest: randomness', () => {
  it('is deterministic for a seed and different for another seed', () => {
    const cards = makeCards(30)
    const a = generateTest(cards, settings({ answerWith: 'both' }), 42)
    const b = generateTest(cards, settings({ answerWith: 'both' }), 42)
    const c = generateTest(cards, settings({ answerWith: 'both' }), 43)
    expect(b).toEqual(a)
    expect(JSON.stringify(c.questions)).not.toBe(JSON.stringify(a.questions))
  })
})

describe('scoreTest', () => {
  const test = generateTest(makeCards(30), settings({ count: 20 }), 7)

  it('scores a perfect test as 100%', () => {
    const score = scoreTest(test.questions, perfectAnswers(test.questions), moderate)
    expect(score).toMatchObject({ correct: 20, incorrect: 0, answered: 20, unanswered: 0, total: 20, scorePct: 100 })
    expect(score.missedCardIds).toEqual([])
    expect(score.results.every((r) => r.correct && r.answered)).toBe(true)
  })

  it('counts unanswered questions as incorrect', () => {
    const score = scoreTest(test.questions, {}, moderate)
    expect(score).toMatchObject({ correct: 0, incorrect: 20, answered: 0, unanswered: 20, scorePct: 0 })
    expect(score.missedCardIds).toEqual(test.questions.map((q) => q.cardId))
    const written = score.results.find((r) => r.type === 'written')!
    expect(written.reason).toBe('empty')
  })

  it('rounds the percentage and lists missed terms', () => {
    const answers = perfectAnswers(test.questions)
    const tf = test.questions.find((q) => q.type === 'tf')!
    const mc = test.questions.find((q) => q.type === 'mc')!
    answers[tf.id] = !answers[tf.id]
    answers[mc.id] = ((answers[mc.id] as number) + 1) % (mc.type === 'mc' ? mc.choices.length : 1)
    delete answers[test.questions[test.questions.length - 1].id]
    const score = scoreTest(test.questions, answers, moderate)
    expect(score.correct).toBe(17)
    expect(score.scorePct).toBe(85)
    expect(score.unanswered).toBe(1)
    expect(score.missedCardIds).toEqual([tf.cardId, mc.cardId, test.questions[19].cardId])
    expect(score.byId[tf.id]).toMatchObject({ correct: false, answered: true, response: tf.type === 'tf' && tf.isTrue ? 'False' : 'True' })
  })

  it('scores each matching prompt on its own', () => {
    const matching = test.questions.filter((q): q is MatchingTestQuestion => q.type === 'matching')
    const [first, second] = matching
    const answers: Record<string, string> = { [first.id]: first.correctLetter, [second.id]: first.correctLetter }
    const score = scoreTest(matching, answers, moderate)
    expect(score.byId[first.id]).toMatchObject({ correct: true, letter: first.correctLetter, response: first.answer })
    expect(score.byId[second.id]).toMatchObject({ correct: false, letter: first.correctLetter, expected: second.answer })
    expect(score.correct).toBe(1)
    expect(score.total).toBe(matching.length)
  })

  it('accepts a matching letter whose answer has the same text', () => {
    const cards = makeCards(4).map((c) => ({ ...c, definition: c.id === 'c3' ? 'apple meaning number 0' : c.definition }))
    const t = generateTest(cards, settings({ types: ['matching'], count: 4, answerWith: 'definition' }), 1)
    const q = t.questions.find((x) => x.cardId === 'c0') as MatchingTestQuestion
    const twin = q.options.find((o) => o.cardId === 'c3')!
    expect(scoreTest([q], { [q.id]: twin.letter }, moderate).correct).toBe(1)
  })

  it('ignores invalid answers', () => {
    const mc = test.questions.find((q) => q.type === 'mc')!
    const matching = test.questions.find((q) => q.type === 'matching')!
    expect(isAnswered(mc, 9)).toBe(false)
    expect(isAnswered(matching, 'Z')).toBe(false)
    expect(scoreTest([mc, matching], { [mc.id]: 9, [matching.id]: 'Z' }, moderate).unanswered).toBe(2)
  })

  it('grades written answers with the chosen grading level', () => {
    const cards: Card[] = [
      { id: 'a', term: 'photosynthesis', definition: 'plants make glucose from light', order: 0, starred: false },
      { id: 'b', term: 'mitochondria', definition: 'organelle for respiration', order: 1, starred: false },
    ]
    const t = generateTest(cards, settings({ types: ['written'], count: 2, answerWith: 'term' }), 1)
    const q = t.questions.find((x) => x.cardId === 'a')!
    const answers: TestAnswers = { [q.id]: '  Photosyntesis ' }
    const strict = scoreTest([q], answers, gradeWith({ level: 'strict' }))
    expect(strict.correct).toBe(0)
    expect(strict.results[0]).toMatchObject({ reason: 'wrong', response: 'Photosyntesis' })
    const loose = scoreTest([q], answers, moderate)
    expect(loose.correct).toBe(1)
    expect(loose.results[0].reason).toBe('typo')
  })

  it('"I was correct" flips a written answer to correct and recomputes the score', () => {
    const written = test.questions.filter((q) => q.type === 'written')
    const answers = perfectAnswers(test.questions)
    answers[written[0].id] = 'something else entirely'
    const before = scoreTest(test.questions, answers, moderate)
    expect(before.correct).toBe(19)
    expect(before.scorePct).toBe(95)
    expect(before.missedCardIds).toEqual([written[0].cardId])

    const after = scoreTest(test.questions, answers, moderate, new Set([written[0].id]))
    expect(after.correct).toBe(20)
    expect(after.scorePct).toBe(100)
    expect(after.missedCardIds).toEqual([])
    expect(after.byId[written[0].id]).toMatchObject({ correct: true, overridden: true, reason: 'wrong' })
  })

  it('only applies overrides to written questions that were wrong', () => {
    const tf = test.questions.find((q) => q.type === 'tf')!
    const written = test.questions.find((q) => q.type === 'written')!
    const answers = perfectAnswers(test.questions)
    answers[tf.id] = !answers[tf.id]
    const score = scoreTest(test.questions, answers, moderate, new Set([tf.id, written.id]))
    expect(score.byId[tf.id].correct).toBe(false)
    expect(score.byId[written.id]).toMatchObject({ correct: true, overridden: false })
  })
})
