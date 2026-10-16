import { describe, expect, it } from 'vitest'
import { addMatchRun, applyOutcome, bucketOf, summarize, withLevel } from './progress'

describe('progress buckets', () => {
  it('starts as not studied', () => {
    expect(bucketOf(undefined)).toBe('notStudied')
  })

  it('becomes still learning after one answer and mastered after two correct in a row', () => {
    const one = applyOutcome(undefined, 'correct', 1)
    expect(bucketOf(one)).toBe('learning')
    const two = applyOutcome(one, 'correct', 2)
    expect(bucketOf(two)).toBe('mastered')
  })

  it('a wrong answer moves a mastered term back to still learning', () => {
    let p = applyOutcome(undefined, 'correct', 1)
    p = applyOutcome(p, 'correct', 2)
    p = applyOutcome(p, 'incorrect', 3)
    expect(bucketOf(p)).toBe('learning')
    expect(p).toMatchObject({ seen: 3, correct: 2, incorrect: 1, streak: 0, lastResult: 'incorrect' })
  })

  it('Hard does not count toward the two-in-a-row rule', () => {
    let p = applyOutcome(undefined, 'correct', 1)
    p = applyOutcome(p, 'hard', 2)
    expect(bucketOf(p)).toBe('learning')
  })

  it('Learn level 2 is mastered until a wrong answer', () => {
    let p = withLevel(applyOutcome(undefined, 'incorrect', 1), 2, 2)
    expect(bucketOf(p)).toBe('mastered')
    p = applyOutcome(p, 'incorrect', 3)
    expect(p.level).toBe(1)
    expect(bucketOf(p)).toBe('learning')
  })

  it('summarises a set', () => {
    const progress = {
      a: applyOutcome(applyOutcome(undefined, 'correct', 1), 'correct', 2),
      b: applyOutcome(undefined, 'incorrect', 1),
    }
    expect(summarize(['a', 'b', 'c'], progress)).toEqual({ notStudied: 1, learning: 1, mastered: 1 })
  })

  it('keeps the ten fastest match runs', () => {
    let runs: { ms: number; at: number }[] = []
    for (let i = 0; i < 12; i++) runs = addMatchRun(runs, 20_000 - i * 1000, i)
    expect(runs).toHaveLength(10)
    expect(runs[0].ms).toBe(9000)
  })
})
