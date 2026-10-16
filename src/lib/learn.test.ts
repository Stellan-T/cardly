import { describe, expect, it } from 'vitest'
import type { Card } from '../types'
import {
  applyOptions,
  chooseType,
  commitAnswer,
  continueAfterCheckpoint,
  createLearnState,
  DEFAULT_LEARN_OPTIONS,
  enabledTypes,
  ensureQuestion,
  roundSummary,
  type LearnOptions,
  type LearnState,
} from './learn'
import { createRng } from './random'

const cards: Card[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i}`,
  term: `term ${i}`,
  definition: `definition number ${i}`,
  order: i,
  starred: false,
}))
const ids = cards.map((c) => c.id)
const opts: LearnOptions = { ...DEFAULT_LEARN_OPTIONS, shuffle: false }

const answerAll = (s: LearnState, correct: (id: string) => boolean, o = opts) => {
  let state = s
  let guard = 0
  while (state.phase === 'question' && guard++ < 200) {
    state = ensureQuestion(state, cards, cards, o)
    state = commitAnswer(state, { correct: correct(state.current!.cardId), firstTry: true, now: 1000 + guard })
  }
  return state
}

describe('Learn rounds', () => {
  it('starts with a round of 7 terms', () => {
    const s = createLearnState(ids, {}, opts, 1, 0)
    expect(s.round).toBe(1)
    expect(s.roundIds).toHaveLength(7)
    expect(s.phase).toBe('question')
  })

  it('first correct answer makes a term familiar, the second masters it', () => {
    let s = createLearnState(ids, {}, opts, 1, 0)
    s = answerAll(s, () => true)
    expect(s.phase).toBe('checkpoint')
    expect(s.roundIds.every((id) => s.levels[id] === 1)).toBe(true)
    s = continueAfterCheckpoint(s, opts)
    // Familiar terms come back first to be mastered.
    expect(s.roundIds.slice(0, 7)).toEqual(ids.slice(0, 7))
    s = answerAll(s, () => true)
    expect(ids.slice(0, 7).every((id) => s.levels[id] === 2)).toBe(true)
  })

  it('a wrong answer moves the term back a level and requeues it in the same round', () => {
    let s = createLearnState(ids, { c0: 1 }, opts, 1, 0)
    s = ensureQuestion(s, cards, cards, opts)
    expect(s.current!.cardId).toBe('c0')
    s = commitAnswer(s, { correct: false, firstTry: true, now: 10 })
    expect(s.levels.c0).toBe(0)
    expect(s.queue.indexOf('c0')).toBe(2)
    expect(s.missed).toEqual(['c0'])
    expect(s.streak).toBe(0)
    // The round only ends once c0 is answered correctly.
    let attempts = 0
    s = answerAll(s, (id) => id !== 'c0' || ++attempts > 1)
    expect(s.phase).toBe('checkpoint')
    expect(roundSummary(s).find((r) => r.id === 'c0')?.ok).toBe(false)
  })

  it('completes when every term is mastered', () => {
    let s = createLearnState(ids.slice(0, 3), {}, opts, 1, 0)
    s = answerAll(s, () => true)
    s = continueAfterCheckpoint(s, opts)
    s = answerAll(s, () => true)
    expect(s.phase).toBe('complete')
    expect(s.correctCount).toBe(6)
  })

  it('skips terms that are already mastered', () => {
    const s = createLearnState(ids.slice(0, 3), { c0: 2, c1: 2, c2: 2 }, opts, 1, 0)
    expect(s.phase).toBe('complete')
  })
})

describe('question types', () => {
  it('asks recognition questions for new terms and written for familiar ones', () => {
    const rng = createRng(3)
    const enabled = enabledTypes(opts)
    expect(enabled).toEqual(['mc', 'written'])
    expect(chooseType(0, enabled, rng)).toBe('mc')
    expect(chooseType(1, enabled, rng)).toBe('written')
  })

  it('Write mode asks only written questions; Spell mode replaces them', () => {
    expect(enabledTypes({ ...opts, writeMode: true })).toEqual(['written'])
    expect(enabledTypes({ ...opts, writeMode: true, spellMode: true })).toEqual(['spell'])
    expect(enabledTypes({ ...opts, spellMode: true })).toEqual(['mc', 'spell'])
  })

  it('builds multiple choice questions with 4 options from the set', () => {
    const s = ensureQuestion(createLearnState(ids, {}, opts, 5, 0), cards, cards, opts)
    expect(s.current!.type).toBe('mc')
    expect(s.current!.choices).toHaveLength(4)
    expect(s.current!.choices![s.current!.correctIndex!].cardId).toBe(s.current!.cardId)
  })

  it('keeps the pending question when called again (resume shows the same question)', () => {
    const s1 = ensureQuestion(createLearnState(ids, {}, opts, 5, 0), cards, cards, opts)
    const s2 = ensureQuestion(JSON.parse(JSON.stringify(s1)), cards, cards, opts)
    expect(s2.current).toEqual(s1.current)
  })
})

describe('answer streaks', () => {
  it('counts first-try correct answers and resets on a wrong one', () => {
    let s = createLearnState(ids, {}, opts, 1, 0)
    for (let i = 0; i < 5; i++) {
      s = ensureQuestion(s, cards, cards, opts)
      s = commitAnswer(s, { correct: true, firstTry: true, now: i })
    }
    expect(s.streak).toBe(5)
    s = ensureQuestion(s, cards, cards, opts)
    s = commitAnswer(s, { correct: true, firstTry: false, now: 9 })
    expect(s.streak).toBe(5)
    s = ensureQuestion(s, cards, cards, opts)
    s = commitAnswer(s, { correct: false, firstTry: true, now: 10 })
    expect(s.streak).toBe(0)
  })

  it('switching question types resets the streak', () => {
    let s = createLearnState(ids, {}, opts, 1, 0)
    s = ensureQuestion(s, cards, cards, opts)
    s = commitAnswer(s, { correct: true, firstTry: true, now: 1 })
    expect(s.streak).toBe(1)
    expect(applyOptions(s, opts).streak).toBe(1)
    const changed = applyOptions(s, { ...opts, types: { ...opts.types, tf: true } })
    expect(changed.streak).toBe(0)
  })
})
