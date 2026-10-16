import { describe, expect, it } from 'vitest'
import { exportCards } from './exportSet'
import { parseImport } from './parseImport'

const cards = [
  { term: 'perro', definition: 'dog' },
  { term: 'a, b', definition: 'say "hi"\nthen leave' },
]

describe('exportCards', () => {
  it('uses Quizlet-style tab/newline by default and round-trips through the importer', () => {
    const text = exportCards(cards.slice(0, 1), { termSep: 'tab', cardSep: 'newline' })
    expect(text).toBe('perro\tdog')
    expect(parseImport(text).cards[0]).toMatchObject({ term: 'perro', definition: 'dog' })
  })

  it('quotes CSV fields that need it and round-trips', () => {
    const text = exportCards(cards, { termSep: 'comma', cardSep: 'newline' })
    expect(text).toBe('perro,dog\n"a, b","say ""hi""\nthen leave"')
    const back = parseImport(text, { termSep: 'comma' }).cards
    expect(back.map((c) => [c.term, c.definition])).toEqual([
      ['perro', 'dog'],
      ['a, b', 'say "hi"\nthen leave'],
    ])
  })

  it('supports custom separators and round-trips them', () => {
    const text = exportCards(cards.slice(0, 1).concat({ term: 'gato', definition: 'cat' }), {
      termSep: 'custom',
      customTermSep: '##',
      cardSep: 'custom',
      customCardSep: '####',
    })
    expect(text).toBe('perro##dog####gato##cat')
    expect(parseImport(text).cards.map((c) => c.term)).toEqual(['perro', 'gato'])
  })

  it('flattens line breaks when cards are separated by new lines', () => {
    expect(exportCards([cards[1]], { termSep: 'colon', cardSep: 'newline' })).toBe('a, b: say "hi" then leave')
  })
})
