import { describe, expect, it } from 'vitest'
import type { TermProgress } from '../types'
import { applyOutcome } from './progress'
import { buildSrsQueue, countDueBy, createScheduler, formatInterval, previewIntervals, rateCard, srsDueList } from './srs'

const f = createScheduler({ fuzz: false })
const now = Date.UTC(2026, 0, 1, 10)
const MIN = 60_000
const DAY = 86_400_000

describe('spaced repetition first-review intervals', () => {
  const iv = previewIntervals(null, now, f)

  it('Repeat brings the card back within minutes', () => {
    expect(iv[1]).toBeLessThan(10 * MIN)
    expect(formatInterval(iv[1])).toBe('1m')
  })
  it('Hard brings it back later in the session', () => {
    expect(iv[2]).toBeGreaterThan(iv[1])
    expect(iv[2]).toBeLessThanOrEqual(6 * 60 * MIN)
    expect(formatInterval(iv[2])).toBe('10m')
  })
  it('Okay is about one day', () => {
    expect(iv[3]).toBeGreaterThanOrEqual(0.9 * DAY)
    expect(iv[3]).toBeLessThanOrEqual(1.5 * DAY)
    expect(formatInterval(iv[3])).toBe('1d')
  })
  it('Easy is four or more days', () => {
    expect(iv[4]).toBeGreaterThanOrEqual(4 * DAY)
  })
})

describe('later reviews', () => {
  it('grow after successful reviews and shrink after a lapse', () => {
    const s1 = rateCard(null, 3, now, f)
    const s2 = rateCard(s1, 3, s1.due, f)
    expect(s2.due - s1.due).toBeGreaterThan(1.5 * DAY)
    const lapse = rateCard(s2, 1, s2.due, f)
    expect(lapse.due - s2.due).toBeLessThanOrEqual(10 * MIN)
    expect(lapse.lapses).toBe(1)
  })

  it('a repeated card stays in the learning phase', () => {
    const s = rateCard(null, 1, now, f)
    expect(s.state).toBe(1)
    const s2 = rateCard(s, 2, s.due, f)
    expect(s2.due - s.due).toBe(10 * MIN)
  })
})

describe('queue', () => {
  const p = (srs: TermProgress['srs']): TermProgress => ({ ...applyOutcome(undefined, 'correct', now), srs })

  it('orders learning cards first, caps new cards and reports the next due time', () => {
    const learning = rateCard(null, 1, now - 5 * MIN, f) // due 4 minutes ago
    const review = { ...rateCard(null, 3, now - 2 * DAY, f) } // due ~1 day ago
    const future = rateCard(null, 4, now, f)
    const q = buildSrsQueue(
      ['a', 'b', 'c', 'n1', 'n2', 'n3'],
      { a: p(review), b: p(learning), c: p(future) },
      now,
      2,
    )
    expect(q.due).toEqual(['b', 'a'])
    expect(q.fresh).toEqual(['n1', 'n2'])
    expect(q.nextDueAt).toBe(future.due)
  })

  it('lists and counts due dates', () => {
    const a = rateCard(null, 3, now, f)
    const b = rateCard(null, 4, now, f)
    const list = srsDueList({ a: p(a), b: p(b), c: undefined }, ['a', 'b', 'c'])
    expect(list).toEqual([a.due, b.due])
    expect(countDueBy(list, now + 2 * DAY)).toBe(1)
  })
})
