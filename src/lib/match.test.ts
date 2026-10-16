import { describe, expect, it } from 'vitest'
import { formatTenths } from './format'
import {
  buildTiles,
  clearMiss,
  elapsedMs,
  finalTimeMs,
  isPair,
  matchOrder,
  mergeLeaderboard,
  moveIndex,
  newGame,
  pairsLeft,
  PENALTY_MS,
  pickRound,
  recordRun,
  selectTile,
  type MatchCard,
  type MatchState,
} from './match'
import { createRng } from './random'

const makeCards = (n: number): MatchCard[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, term: `term ${i}`, definition: `definition ${i}`, imageId: null, imageUrl: null }))

const ids = (cards: MatchCard[]) => cards.map((c) => c.id)

function game(n = 6, seed = 1): MatchState {
  const cards = makeCards(n)
  return newGame(buildTiles(cards, pickRound(ids(cards), 0).ids, createRng(seed)))
}

const tileOf = (cardId: string, side: 'term' | 'definition') => `${cardId}:${side}`

/** Matches every pair in order, one tap every `step` ms from `t0`. */
function solve(g: MatchState, t0: number, step: number) {
  let t = t0
  for (const cardId of new Set(g.tiles.map((x) => x.cardId))) {
    g = selectTile(g, tileOf(cardId, 'term'), t)
    t += step
    g = selectTile(g, tileOf(cardId, 'definition'), t)
    t += step
  }
  return g
}

describe('match rounds', () => {
  it('builds 12 tiles from 6 pairs on a big set', () => {
    const cards = makeCards(20)
    const { ids: round } = pickRound(matchOrder(ids(cards)), 0)
    expect(round).toHaveLength(6)
    const tiles = buildTiles(cards, round, createRng(7))
    expect(tiles).toHaveLength(12)
    expect(new Set(tiles.map((t) => t.cardId)).size).toBe(6)
    for (const id of round) {
      expect(tiles.filter((t) => t.cardId === id).map((t) => t.side).sort()).toEqual(['definition', 'term'])
    }
  })

  it('uses every card when the set has fewer than 6', () => {
    const cards = makeCards(3)
    const { ids: round, nextCursor } = pickRound(ids(cards), 0)
    expect(round).toHaveLength(3)
    expect(nextCursor).toBe(0)
    expect(buildTiles(cards, round)).toHaveLength(6)
  })

  it('places tiles randomly but reproducibly from the seed', () => {
    const cards = makeCards(6)
    const a = buildTiles(cards, ids(cards), createRng(1)).map((t) => t.id)
    const b = buildTiles(cards, ids(cards), createRng(1)).map((t) => t.id)
    const c = buildTiles(cards, ids(cards), createRng(2)).map((t) => t.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('cycles so every term is covered over repeated games', () => {
    for (const n of [7, 12, 13, 25]) {
      const order = matchOrder(ids(makeCards(n)))
      const seen = new Set<string>()
      let cursor = 0
      const games = Math.ceil(n / 6)
      for (let i = 0; i < games; i++) {
        const { ids: round, nextCursor } = pickRound(order, cursor)
        expect(new Set(round).size).toBe(6)
        round.forEach((id) => seen.add(id))
        cursor = nextCursor
      }
      expect(seen.size).toBe(n)
    }
  })

  it('consecutive games use different pairs', () => {
    const order = matchOrder(ids(makeCards(12)))
    const first = pickRound(order, 0)
    const second = pickRound(order, first.nextCursor)
    expect(second.ids.filter((id) => first.ids.includes(id))).toEqual([])
  })

  it('tolerates a stale or invalid cursor', () => {
    const order = ids(makeCards(8))
    expect(pickRound(order, 50).ids).toEqual(['c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(pickRound(order, Number.NaN).ids[0]).toBe('c0')
    expect(pickRound([], 3)).toEqual({ ids: [], nextCursor: 0 })
  })

  it('keeps a stable order that is independent of the input order', () => {
    const a = matchOrder(['x', 'y', 'z', 'w'])
    expect(matchOrder(['w', 'z', 'y', 'x'])).toEqual(a)
    expect(matchOrder(['x', 'y', 'z', 'w', 'v']).filter((id) => id !== 'v')).toEqual(a)
  })
})

describe('match play', () => {
  it('starts the timer on the first tap only', () => {
    let g = game()
    expect(elapsedMs(g, 5000)).toBe(0)
    const [a, b] = g.tiles
    g = selectTile(g, a.id, 1000)
    expect(g.startedAt).toBe(1000)
    g = selectTile(g, a.id, 1500)
    g = selectTile(g, b.id, 2500)
    expect(g.startedAt).toBe(1000)
    expect(g.selected).toBe(b.id)
    expect(elapsedMs(g, 3200)).toBe(2200)
  })

  it('selects, then deselects when the same tile is tapped again', () => {
    let g = game()
    const id = g.tiles[0].id
    g = selectTile(g, id, 0)
    expect(g.selected).toBe(id)
    expect(g.last?.event).toBe('select')
    g = selectTile(g, id, 10)
    expect(g.selected).toBeNull()
    expect(g.last?.event).toBe('deselect')
    expect(g.penaltyMs).toBe(0)
  })

  it('removes both tiles of a correct match', () => {
    let g = game()
    g = selectTile(g, 'c0:definition', 0)
    g = selectTile(g, 'c0:term', 100)
    expect(g.cleared.sort()).toEqual(['c0:definition', 'c0:term'])
    expect(g.selected).toBeNull()
    expect(g.last?.event).toBe('match')
    expect(pairsLeft(g)).toBe(5)
    // Matched tiles can't be tapped again.
    expect(selectTile(g, 'c0:term', 200)).toBe(g)
  })

  it('adds exactly 1.0 s per wrong pair and deselects both', () => {
    let g = game()
    g = selectTile(g, 'c0:term', 0)
    g = selectTile(g, 'c1:definition', 100)
    expect(g.penaltyMs).toBe(PENALTY_MS)
    expect(PENALTY_MS).toBe(1000)
    expect(g.misses).toBe(1)
    expect(g.wrong).toEqual(['c0:term', 'c1:definition'])
    expect(g.selected).toBeNull()
    expect(g.cleared).toEqual([])
    expect(elapsedMs(g, 100)).toBe(1100)

    // Two tiles from the same side are a miss too.
    g = selectTile(g, 'c2:term', 200)
    expect(g.wrong).toBeNull()
    g = selectTile(g, 'c3:term', 300)
    expect(g.penaltyMs).toBe(2000)
    expect(clearMiss(g).wrong).toBeNull()
  })

  it('treats tiles that look identical as a match', () => {
    const cards: MatchCard[] = [
      { id: 'a', term: 'big', definition: 'groot', imageId: null, imageUrl: null },
      { id: 'b', term: 'large', definition: ' groot ', imageId: null, imageUrl: null },
      { id: 'c', term: 'large', definition: 'groot', imageId: 'img1', imageUrl: null },
    ]
    const tiles = buildTiles(cards, ids(cards))
    const t = (id: string) => tiles.find((x) => x.id === id)!
    expect(isPair(t('a:term'), t('b:definition'))).toBe(true)
    expect(isPair(t('b:term'), t('c:definition'))).toBe(true)
    // Same text, but c's definition tile shows a picture.
    expect(isPair(t('a:term'), t('c:definition'))).toBe(false)
    expect(isPair(t('a:term'), t('a:term'))).toBe(false)
  })

  it('finishes when the last pair is matched; time = elapsed + penalties', () => {
    let g = game(6)
    g = selectTile(g, 'c0:term', 1000)
    g = selectTile(g, 'c1:term', 1200)
    g = selectTile(g, 'c2:definition', 1400)
    g = selectTile(g, 'c3:term', 1600)
    expect(g.misses).toBe(2)
    expect(finalTimeMs(g)).toBeNull()
    g = solve(g, 2000, 250)
    expect(g.finishedAt).toBe(2000 + 11 * 250)
    expect(g.last?.event).toBe('finish')
    expect(pairsLeft(g)).toBe(0)
    expect(finalTimeMs(g)).toBe(g.finishedAt! - 1000 + 2 * PENALTY_MS)
    // The clock stops at the end.
    expect(elapsedMs(g, 99_999)).toBe(finalTimeMs(g))
    expect(selectTile(g, g.tiles[0].id, 99_999)).toBe(g)
  })

  it('finishes a two-card game', () => {
    const g = solve(game(2), 0, 100)
    expect(g.tiles).toHaveLength(4)
    expect(finalTimeMs(g)).toBe(300)
  })

  it('formats times in tenths of a second', () => {
    expect(formatTenths(0)).toBe('0.0')
    expect(formatTenths(99)).toBe('0.0')
    expect(formatTenths(1000)).toBe('1.0')
    expect(formatTenths(12_345)).toBe('12.3')
    expect(formatTenths(61_999)).toBe('61.9')
  })

  it('moves focus between live tiles in the grid', () => {
    const live = [true, true, true, true, false, true, true, true, true, true, true, false]
    expect(moveIndex(live, 0, 3, 'ArrowRight')).toBe(1)
    expect(moveIndex(live, 3, 3, 'ArrowRight')).toBe(5)
    expect(moveIndex(live, 5, 3, 'ArrowLeft')).toBe(3)
    expect(moveIndex(live, 1, 3, 'ArrowDown')).toBe(7)
    expect(moveIndex(live, 8, 3, 'ArrowDown')).toBe(-1)
    expect(moveIndex(live, 7, 3, 'ArrowUp')).toBe(1)
    expect(moveIndex(live, 6, 3, 'Home')).toBe(0)
    expect(moveIndex(live, 0, 3, 'End')).toBe(10)
    expect(moveIndex(live, 0, 3, 'Enter')).toBe(-1)
  })
})

describe('match results', () => {
  it('records a run and detects a new personal best', () => {
    const first = recordRun({ bestMatchMs: null, matchRuns: [] }, 20_000, 1)
    expect(first).toEqual({ bestMatchMs: 20_000, matchRuns: [{ ms: 20_000, at: 1 }], isRecord: true })
    const slower = recordRun({ bestMatchMs: first.bestMatchMs, matchRuns: first.matchRuns }, 25_000, 2)
    expect(slower.isRecord).toBe(false)
    expect(slower.bestMatchMs).toBe(20_000)
    expect(slower.matchRuns.map((r) => r.ms)).toEqual([20_000, 25_000])
    const faster = recordRun({ bestMatchMs: slower.bestMatchMs, matchRuns: slower.matchRuns }, 15_000, 3)
    expect(faster.isRecord).toBe(true)
    expect(faster.bestMatchMs).toBe(15_000)
  })

  it('merges own runs with other players, fastest first, top 10, without duplicating the user', () => {
    const own = [
      { ms: 9000, at: 10 },
      { ms: 14_000, at: 20 },
    ]
    const others = [
      { uid: 'me', displayName: 'Me (shared)', bestTimeMs: 9000, achievedAt: 10 },
      { uid: 'u1', displayName: 'Ann', bestTimeMs: 8000, achievedAt: 5 },
      { uid: 'u2', displayName: 'Bob', bestTimeMs: 12_000, achievedAt: 6 },
      { uid: 'u3', displayName: 'Bad', bestTimeMs: 0, achievedAt: 6 },
    ]
    const rows = mergeLeaderboard(own, 'Me', others, 'me')
    expect(rows.map((r) => [r.name, r.ms, r.mine])).toEqual([
      ['Ann', 8000, false],
      ['Me', 9000, true],
      ['Bob', 12_000, false],
      ['Me', 14_000, true],
    ])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)

    const many = Array.from({ length: 15 }, (_, i) => ({ uid: `p${i}`, displayName: `P${i}`, bestTimeMs: 10_000 + i * 100, achievedAt: i }))
    const top = mergeLeaderboard(own, 'Me', many, 'me')
    expect(top).toHaveLength(10)
    expect(top[0]).toMatchObject({ name: 'Me', ms: 9000 })
    expect(top.map((r) => r.ms)).toEqual(top.map((r) => r.ms).sort((a, b) => a - b))
    expect(top.some((r) => r.ms === 14_000)).toBe(false)
  })

  it('breaks ties by the earlier time', () => {
    const rows = mergeLeaderboard([{ ms: 5000, at: 50 }], 'Me', [{ uid: 'x', displayName: 'X', bestTimeMs: 5000, achievedAt: 40 }], 'me')
    expect(rows.map((r) => r.name)).toEqual(['X', 'Me'])
  })
})
