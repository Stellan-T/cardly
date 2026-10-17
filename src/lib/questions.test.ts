import { describe, expect, it } from 'vitest'
import type { Card } from '../types'
import { cardForAnswer, meaningLabel, otherCard } from './questions'

const card = (id: string, term: string, definition: string, order: number): Card => ({ id, term, definition, order, starred: false })

const CARDS = [card('a', 'gato', 'cat', 0), card('b', 'perro', 'dog', 1), card('c', 'casa', 'house', 2)]

describe('cardForAnswer', () => {
  it('finds the other card a typed answer belongs to', () => {
    expect(cardForAnswer('perro', 'term', CARDS, 'a')?.id).toBe('b')
    expect(cardForAnswer('  Dog ', 'definition', CARDS, 'a')?.id).toBe('b')
  })

  it('ignores the asked card, empty answers and answers that match no card', () => {
    expect(cardForAnswer('gato', 'term', CARDS, 'a')).toBeUndefined()
    expect(cardForAnswer('', 'term', CARDS, 'a')).toBeUndefined()
    expect(cardForAnswer('pájaro', 'term', CARDS, 'a')).toBeUndefined()
  })
})

describe('otherCard', () => {
  it('looks up a card by id, but never the asked card', () => {
    expect(otherCard(CARDS, 'c', 'a')?.term).toBe('casa')
    expect(otherCard(CARDS, 'a', 'a')).toBeUndefined()
    expect(otherCard(CARDS, undefined, 'a')).toBeUndefined()
  })
})

describe('meaningLabel', () => {
  it('reads naturally for both answer sides', () => {
    expect(meaningLabel('term')).toBe('Your answer means')
    expect(meaningLabel('definition', 'That')).toBe('That is the definition of')
  })
})
