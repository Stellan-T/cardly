import { describe, expect, it } from 'vitest'
import { currentId, go, isDeckDone, keepReviewing, markCurrent, reconcileDeck, setShuffle, startDeck } from './flashcards'

const ids = ['a', 'b', 'c', 'd']

describe('flashcard deck', () => {
  it('browses forward and back within bounds', () => {
    let d = startDeck(ids, { shuffle: false, seed: 1 })
    expect(currentId(d)).toBe('a')
    d = go(d, -1)
    expect(d.index).toBe(0)
    d = go(go(go(go(d, 1), 1), 1), 1)
    expect(isDeckDone(d)).toBe(true)
  })

  it('sorts cards into piles and starts a round with the still-learning ones', () => {
    let d = startDeck(ids, { shuffle: false, seed: 1 })
    d = markCurrent(d, 'know')
    d = markCurrent(d, 'learning')
    d = markCurrent(d, 'know')
    d = markCurrent(d, 'learning')
    expect(d.know).toEqual(['a', 'c'])
    expect(d.learning).toEqual(['b', 'd'])
    expect(isDeckDone(d)).toBe(true)
    const next = keepReviewing(d, 2)
    expect(next.order).toEqual(['b', 'd'])
    expect(next.round).toBe(2)
    expect(next.know).toEqual([])
  })

  it('shuffles deterministically and only reorders unseen cards', () => {
    const a = startDeck(ids, { shuffle: true, seed: 42 })
    const b = startDeck(ids, { shuffle: true, seed: 42 })
    expect(a.order).toEqual(b.order)
    let d = go(startDeck(ids, { shuffle: false, seed: 1 }), 2)
    d = setShuffle(d, true, ids, 7)
    expect(d.order.slice(0, 2)).toEqual(['a', 'b'])
    expect(d.order.slice(2).sort()).toEqual(['c', 'd'])
    d = setShuffle(d, false, ids, 8)
    expect(d.order).toEqual(ids)
  })

  it('drops deleted cards when resuming', () => {
    const d = reconcileDeck(go(startDeck(ids, { shuffle: false, seed: 1 }), 2), new Set(['a', 'c', 'd']))
    expect(d.order).toEqual(['a', 'c', 'd'])
    expect(currentId(d)).toBe('c')
  })
})
