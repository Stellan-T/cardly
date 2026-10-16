/** Round logic for Flashcards "Browse" and "Basic sorting" (pure, persisted in the session doc). */
import { createRng, shuffle } from './random'

export interface DeckState {
  /** Card ids of this round, in display order. */
  order: string[]
  index: number
  round: number
  /** Sorting piles for this round. */
  know: string[]
  learning: string[]
  shuffled: boolean
  seed: number
}

export function startDeck(ids: string[], opts: { shuffle: boolean; seed: number; round?: number }): DeckState {
  return {
    order: opts.shuffle ? shuffle(ids, createRng(opts.seed)) : [...ids],
    index: 0,
    round: opts.round ?? 1,
    know: [],
    learning: [],
    shuffled: opts.shuffle,
    seed: opts.seed,
  }
}

export const currentId = (d: DeckState): string | undefined => d.order[d.index]
export const isDeckDone = (d: DeckState) => d.index >= d.order.length

export function go(d: DeckState, delta: number): DeckState {
  return { ...d, index: Math.max(0, Math.min(d.order.length, d.index + delta)) }
}

/** Sorts the current card into a pile and advances. */
export function markCurrent(d: DeckState, pile: 'know' | 'learning'): DeckState {
  const id = currentId(d)
  if (!id) return d
  const know = d.know.filter((x) => x !== id)
  const learning = d.learning.filter((x) => x !== id)
  if (pile === 'know') know.push(id)
  else learning.push(id)
  return { ...d, know, learning, index: d.index + 1 }
}

/** Next round with only the "still learning" cards. */
export function keepReviewing(d: DeckState, seed: number): DeckState {
  return startDeck(d.learning, { shuffle: d.shuffled, seed, round: d.round + 1 })
}

/** Toggles shuffle, keeping the cards already seen and reordering the rest. */
export function setShuffle(d: DeckState, on: boolean, originalOrder: string[], seed: number): DeckState {
  const seen = d.order.slice(0, d.index)
  const rest = d.order.slice(d.index)
  const restSet = new Set(rest)
  const ordered = on ? shuffle(rest, createRng(seed)) : originalOrder.filter((id) => restSet.has(id))
  return { ...d, order: [...seen, ...ordered], shuffled: on, seed }
}

/** Drops ids that no longer exist (cards deleted on another device) and keeps the index in range. */
export function reconcileDeck(d: DeckState, validIds: Set<string>): DeckState {
  const beforeIndex = d.order.slice(0, d.index).filter((id) => validIds.has(id)).length
  const order = d.order.filter((id) => validIds.has(id))
  return {
    ...d,
    order,
    index: Math.min(beforeIndex, order.length),
    know: d.know.filter((id) => validIds.has(id)),
    learning: d.learning.filter((id) => validIds.has(id)),
  }
}
