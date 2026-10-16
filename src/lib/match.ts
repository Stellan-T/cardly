/**
 * Match: pair every term with its definition as fast as possible.
 *
 * Pure game rules, so the page stays thin and the rules are unit-tested:
 * which cards a round uses (cycling through the whole set over repeated
 * games), the shuffled board, tile selection with the 1-second penalty for a
 * wrong pair, the clock (which only starts on the first tap) and the
 * leaderboard shown at the end.
 */
import { addMatchRun } from './progress'
import { shuffle, type Rng } from './random'
import type { Card, LeaderboardEntry, MatchRun, SetStats, Side } from '../types'

/** Pairs on a full board (12 tiles). */
export const ROUND_SIZE = 6
/** Time added for every wrong pair. */
export const PENALTY_MS = 1000
export const LEADERBOARD_SIZE = 10

export type MatchCard = Pick<Card, 'id' | 'term' | 'definition' | 'imageId' | 'imageUrl'>

export interface MatchTile {
  /** `${cardId}:term` or `${cardId}:definition` */
  id: string
  cardId: string
  side: Side
  text: string
  /** The card's image, shown on the definition tile only. */
  imageId: string | null
  imageUrl: string | null
  /** What the tile shows; two tiles with the same face are indistinguishable. */
  face: string
  /** Face of the same card's tile on the other side. */
  partnerFace: string
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/** FNV-1a: a cheap, stable string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A stable, well-mixed order of the cards that rounds walk through. Each id's
 * position depends only on the id, so adding a card doesn't reshuffle the rest.
 */
export function matchOrder(cardIds: readonly string[]): string[] {
  return [...cardIds].sort((a, b) => hash(a) - hash(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The cards for one game: `size` consecutive ids from `cursor` (wrapping), so
 * repeated games cover every card. Returns the cursor for the next game.
 */
export function pickRound(cardIds: readonly string[], cursor: number, size = ROUND_SIZE): { ids: string[]; nextCursor: number } {
  const n = cardIds.length
  if (n === 0 || size <= 0) return { ids: [], nextCursor: 0 }
  const count = Math.min(size, n)
  const start = Number.isFinite(cursor) ? ((Math.floor(cursor) % n) + n) % n : 0
  const ids = Array.from({ length: count }, (_, i) => cardIds[(start + i) % n])
  return { ids, nextCursor: (start + count) % n }
}

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A term tile and a definition tile for every card in `ids`, in random positions. */
export function buildTiles(cards: readonly MatchCard[], ids: readonly string[], rng: Rng = Math.random): MatchTile[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const tiles: MatchTile[] = []
  for (const id of new Set(ids)) {
    const card = byId.get(id)
    if (!card) continue
    const imageId = card.imageId ?? null
    const imageUrl = card.imageUrl ?? null
    const termFace = norm(card.term)
    const defFace = `${norm(card.definition)}\u0000${imageId ?? imageUrl ?? ''}`
    const base = { cardId: id, imageId: null, imageUrl: null }
    tiles.push(
      { ...base, id: `${id}:term`, side: 'term', text: card.term, face: termFace, partnerFace: defFace },
      { ...base, id: `${id}:definition`, side: 'definition', text: card.definition, imageId, imageUrl, face: defFace, partnerFace: termFace },
    )
  }
  return shuffle(tiles, rng)
}

/**
 * A term tile and a definition tile match when they belong to the same card —
 * or look exactly like that card's pair (duplicate terms or definitions).
 */
export function isPair(a: MatchTile, b: MatchTile): boolean {
  if (a.side === b.side) return false
  return a.cardId === b.cardId || a.partnerFace === b.face || b.partnerFace === a.face
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type MatchEvent = 'select' | 'deselect' | 'match' | 'miss' | 'finish'

export interface MatchState {
  /** Every tile on the board; positions never change (matched tiles leave a gap). */
  tiles: MatchTile[]
  /** Ids of matched tiles. */
  cleared: string[]
  selected: string | null
  /** The last wrong pair, shown in red until the next tap or `clearMiss`. */
  wrong: [string, string] | null
  /** Clock time of the first tap; the clock doesn't run before it. */
  startedAt: number | null
  finishedAt: number | null
  penaltyMs: number
  misses: number
  /** What the latest tap did (for sounds and announcements). */
  last: { event: MatchEvent; tileIds: string[] } | null
}

export function newGame(tiles: MatchTile[]): MatchState {
  return { tiles, cleared: [], selected: null, wrong: null, startedAt: null, finishedAt: null, penaltyMs: 0, misses: 0, last: null }
}

/**
 * Taps a tile at clock time `now` (e.g. `performance.now()`): the first tap
 * starts the clock; a second tile completes a pair (both disappear) or is a
 * miss (+1 second). Tapping the selected tile again deselects it.
 */
export function selectTile(state: MatchState, tileId: string, now: number): MatchState {
  if (state.finishedAt !== null || state.cleared.includes(tileId)) return state
  const tile = state.tiles.find((t) => t.id === tileId)
  if (!tile) return state
  const base: MatchState = { ...state, startedAt: state.startedAt ?? now, wrong: null }
  const first = state.selected === null ? undefined : state.tiles.find((t) => t.id === state.selected)
  if (!first) return { ...base, selected: tileId, last: { event: 'select', tileIds: [tileId] } }
  if (first.id === tileId) return { ...base, selected: null, last: { event: 'deselect', tileIds: [tileId] } }
  const tileIds = [first.id, tileId]
  if (isPair(first, tile)) {
    const cleared = [...state.cleared, ...tileIds]
    const done = cleared.length >= state.tiles.length
    return { ...base, cleared, selected: null, finishedAt: done ? now : null, last: { event: done ? 'finish' : 'match', tileIds } }
  }
  return {
    ...base,
    selected: null,
    wrong: [first.id, tileId],
    penaltyMs: state.penaltyMs + PENALTY_MS,
    misses: state.misses + 1,
    last: { event: 'miss', tileIds },
  }
}

/** Stops showing the last wrong pair in red. */
export function clearMiss(state: MatchState): MatchState {
  return state.wrong ? { ...state, wrong: null } : state
}

export const pairsLeft = (state: MatchState) => (state.tiles.length - state.cleared.length) / 2

/** Time on the clock: elapsed since the first tap (until the end) plus penalties. */
export function elapsedMs(state: MatchState, now: number): number {
  if (state.startedAt === null) return 0
  const end = state.finishedAt ?? now
  return Math.max(0, end - state.startedAt) + state.penaltyMs
}

/** The final time in whole milliseconds, or null while the game is running. */
export function finalTimeMs(state: MatchState): number | null {
  if (state.finishedAt === null) return null
  return Math.max(1, Math.round(elapsedMs(state, state.finishedAt)))
}

/** Index of the next live tile from `index` in a grid with `cols` columns, or -1. */
export function moveIndex(live: readonly boolean[], index: number, cols: number, key: string): number {
  const n = live.length
  const scan = (from: number, step: number) => {
    for (let i = from; i >= 0 && i < n; i += step) if (live[i]) return i
    return -1
  }
  switch (key) {
    case 'ArrowRight':
      return scan(index + 1, 1)
    case 'ArrowLeft':
      return scan(index - 1, -1)
    case 'ArrowDown':
      return scan(index + Math.max(1, cols), Math.max(1, cols))
    case 'ArrowUp':
      return scan(index - Math.max(1, cols), -Math.max(1, cols))
    case 'Home':
      return scan(0, 1)
    case 'End':
      return scan(n - 1, -1)
    default:
      return -1
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** The stats after a finished game, and whether it beat the previous best. */
export function recordRun(stats: Pick<SetStats, 'bestMatchMs' | 'matchRuns'>, ms: number, at: number) {
  const prev = stats.bestMatchMs
  return {
    bestMatchMs: prev === null ? ms : Math.min(prev, ms),
    matchRuns: addMatchRun(stats.matchRuns ?? [], ms, at),
    isRecord: prev === null || ms < prev,
  }
}

export interface LeaderboardRow {
  key: string
  name: string
  ms: number
  at: number
  /** One of the current user's own runs. */
  mine: boolean
}

/**
 * The set's leaderboard: the user's own runs plus other people's best times
 * (the user's own shared entry is skipped — their runs already cover it),
 * fastest first.
 */
export function mergeLeaderboard(
  ownRuns: readonly MatchRun[],
  ownName: string,
  others: readonly LeaderboardEntry[],
  uid: string | null,
  size = LEADERBOARD_SIZE,
): LeaderboardRow[] {
  const valid = (ms: number) => Number.isFinite(ms) && ms > 0
  const best = new Map<string, LeaderboardEntry>()
  for (const e of others) {
    if (e.uid === uid || !valid(e.bestTimeMs)) continue
    const prev = best.get(e.uid)
    if (!prev || e.bestTimeMs < prev.bestTimeMs) best.set(e.uid, e)
  }
  const rows: LeaderboardRow[] = [
    ...ownRuns
      .filter((r) => valid(r.ms))
      .map((r, i) => ({ key: `me/${r.at}/${i}`, name: ownName, ms: r.ms, at: r.at, mine: true })),
    ...[...best.values()].map((e) => ({
      key: `lb/${e.uid}`,
      name: e.displayName,
      ms: e.bestTimeMs,
      at: e.achievedAt,
      mine: false,
    })),
  ]
  return rows.sort((a, b) => a.ms - b.ms || a.at - b.at).slice(0, size)
}
