import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findColon, parseImport, stripMarkers } from './parseImport'

const sample = (name: string) => readFileSync(resolve(__dirname, '../../samples', name), 'utf8')
const pairs = (text: string, opts?: Parameters<typeof parseImport>[1]) =>
  parseImport(text, opts).cards.map((c) => [c.term, c.definition])
const problems = (text: string) =>
  parseImport(text).warnings.filter((w) => !['merged', 'header-row'].includes(w.kind))

describe('parseImport: colon format', () => {
  it('parses "term: definition" with spaces', () => {
    const r = parseImport('Photosynthesis: process by which plants make glucose using light\nMitosis: cell division')
    expect(r.detected.termSep).toBe('colon')
    expect(r.detected.cardSep).toBe('newline')
    expect(pairs('Photosynthesis: process by which plants make glucose using light\nMitosis: cell division')).toEqual([
      ['Photosynthesis', 'process by which plants make glucose using light'],
      ['Mitosis', 'cell division'],
    ])
  })

  it('parses colons without spaces', () => {
    expect(pairs('perro:dog\ngato:cat\ncasa : house')).toEqual([
      ['perro', 'dog'],
      ['gato', 'cat'],
      ['casa', 'house'],
    ])
  })

  it('splits on the first colon only, so definitions can contain colons', () => {
    expect(pairs('Mitochondria: the "powerhouse": makes ATP')).toEqual([['Mitochondria', 'the "powerhouse": makes ATP']])
  })

  it('ignores colons in URLs, times and ratios', () => {
    const text = [
      'Docs: see https://example.com/page for details',
      'Lunch: starts at 12:30 every day',
      'Ratio: mix in a 3:1 ratio',
      'Website https://example.org: the official site',
    ].join('\n')
    expect(pairs(text)).toEqual([
      ['Docs', 'see https://example.com/page for details'],
      ['Lunch', 'starts at 12:30 every day'],
      ['Ratio', 'mix in a 3:1 ratio'],
      ['Website https://example.org', 'the official site'],
    ])
  })

  it('findColon skips times, ratios and URL schemes', () => {
    expect(findColon('12:30')).toBeNull()
    expect(findColon('http://x.y')).toBeNull()
    expect(findColon('John 3:16 is a verse')).toBeNull()
    expect(findColon('Chapter 3: Cells')?.index).toBe(9)
  })

  it('acceptance: 30+ colon lines import with zero manual fixes', () => {
    const r = parseImport(sample('biology.txt'))
    expect(r.cards.length).toBeGreaterThanOrEqual(30)
    expect(r.cards[0]).toMatchObject({
      term: 'Photosynthesis',
      definition: 'process by which plants make glucose using light',
    })
    expect(r.warnings.filter((w) => w.kind !== 'merged')).toEqual([])
    expect(r.headings[0]).toBe('Biology: cells and energy')
    expect(r.cards.find((c) => c.term === 'Glucose')?.definition).toBe('simple sugar made in photosynthesis (C6H12O6)')
  })
})

describe('parseImport: tab format and Quizlet export', () => {
  it('parses the default export (tab between term and definition, newline between cards)', () => {
    const r = parseImport(sample('spanish-english.txt'))
    expect(r.detected).toMatchObject({ termSep: 'tab', cardSep: 'newline' })
    expect(r.cards).toHaveLength(20)
    expect(r.cards[0]).toMatchObject({ term: 'el perro', definition: 'the dog' })
    expect(r.cards.find((c) => c.term === 'el niño')?.definition).toBe('the boy, the child')
    expect(problems(sample('spanish-english.txt'))).toEqual([])
  })

  it('prefers tab over comma and colon', () => {
    expect(pairs('a, b\tc: d\ne, f\tg: h')).toEqual([
      ['a, b', 'c: d'],
      ['e, f', 'g: h'],
    ])
  })

  it('imports custom "##" / "####" exports with auto-detect', () => {
    const r = parseImport('perro##dog####gato##cat####casa##the house, home')
    expect(r.detected).toMatchObject({ termSep: 'custom', cardSep: 'custom', customTermSep: '##', customCardSep: '####' })
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['perro', 'dog'],
      ['gato', 'cat'],
      ['casa', 'the house, home'],
    ])
  })

  it('imports custom separators chosen explicitly without trimming them', () => {
    expect(
      pairs('a##b####c##d', { termSep: 'custom', customTermSep: '##', cardSep: 'custom', customCardSep: '####' }),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(pairs('a - b | c - d', { termSep: 'custom', customTermSep: ' - ', cardSep: 'custom', customCardSep: ' | ' })).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('understands \\t and \\n escapes in custom separators', () => {
    expect(pairs('a\tb\nc\td', { termSep: 'custom', customTermSep: '\\t', cardSep: 'custom', customCardSep: '\\n' })).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseImport: lists and markdown', () => {
  it('strips bullets, numbers, letters, checkboxes and quotes', () => {
    const text = [
      '- one: 1',
      '* two: 2',
      '• three: 3',
      '· four: 4',
      '▪ five: 5',
      '1. six: 6',
      '2) seven: 7',
      'a) eight: 8',
      '(3) nine: 9',
      '- [ ] ten: 10',
      '[x] eleven: 11',
      '> twelve: 12',
    ].join('\n')
    expect(pairs(text).map(([t]) => t)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
    ])
  })

  it('does not strip numbers that are part of the term', () => {
    expect(pairs('3.14: pi\n1.5 m: height')).toEqual([
      ['3.14', 'pi'],
      ['1.5 m', 'height'],
    ])
  })

  it('strips markdown bold around terms', () => {
    expect(pairs('**Osmosis**: diffusion of water\n**Diffusion:** spreading out\n- __Enzyme__ - biological catalyst')).toEqual([
      ['Osmosis', 'diffusion of water'],
      ['Diffusion', 'spreading out'],
      ['Enzyme', 'biological catalyst'],
    ])
  })

  it('stripMarkers reports whether a marker was present', () => {
    expect(stripMarkers('  - term: x')).toEqual({ text: 'term: x', hadMarker: true })
    expect(stripMarkers('term: x')).toEqual({ text: 'term: x', hadMarker: false })
  })
})

describe('parseImport: multi-line definitions and headings', () => {
  it('appends separator-less lines to the previous definition', () => {
    const r = parseImport('Mitosis: cell division\nproduces two identical cells\nMeiosis: makes gametes')
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['Mitosis', 'cell division\nproduces two identical cells'],
      ['Meiosis', 'makes gametes'],
    ])
    expect(r.cards[0].mergedLines).toEqual([2])
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'merged', cardIndex: 0 }))
  })

  it('keeps indented sub-bullets (even with colons) inside the definition', () => {
    const text = ['- War: a conflict', '  - cause: taxes', '  - result: independence', '- Peace: no conflict'].join('\n')
    expect(pairs(text)).toEqual([
      ['War', 'a conflict\n- cause: taxes\n- result: independence'],
      ['Peace', 'no conflict'],
    ])
  })

  it('handles the Dutch history sample (bullets, accents, multi-line definitions)', () => {
    const r = parseImport(sample('dutch-history.txt'))
    expect(r.headings[0]).toBe('Vaderlandse geschiedenis (de Republiek)')
    expect(r.cards).toHaveLength(12)
    expect(r.cards[0]).toMatchObject({
      term: 'Tachtigjarige Oorlog',
      definition: 'opstand van de Nederlanden tegen het Spaanse gezag (1568–1648).\nEindigde met de Vrede van Münster.',
    })
    expect(r.cards[4].definition.split('\n')).toHaveLength(3)
    expect(r.warnings.filter((w) => w.kind !== 'merged')).toEqual([])
  })

  it('treats markdown headings and "Heading:" lines as headings, not cards', () => {
    const text = '# Chapter 3\nCell: unit of life\n\nChapter 4:\nAtom: smallest unit of matter'
    const r = parseImport(text)
    expect(r.cards.map((c) => c.term)).toEqual(['Cell', 'Atom'])
    expect(r.headings).toEqual(['Chapter 3', 'Chapter 4'])
    expect(r.cards[0].tags).toBeUndefined()
  })

  it('can use headings as tags', () => {
    const r = parseImport('# Animals\ndog: perro\n# Food\nbread: pan', { headingsAsTags: true })
    expect(r.cards.map((c) => c.tags)).toEqual([['Animals'], ['Food']])
  })

  it('parses "term on one line, definition on the next" blocks', () => {
    const r = parseImport('Photosynthesis\nMaking glucose from light\n\nOsmosis\nDiffusion of water\nacross a membrane')
    expect(r.detected).toMatchObject({ termSep: 'linebreak', cardSep: 'blankline' })
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['Photosynthesis', 'Making glucose from light'],
      ['Osmosis', 'Diffusion of water\nacross a membrane'],
    ])
  })
})

describe('parseImport: whitespace, line endings and encodings', () => {
  it('handles Windows line endings and a BOM', () => {
    expect(pairs('﻿cat: gato\r\ndog: perro\r\n')).toEqual([
      ['cat', 'gato'],
      ['dog', 'perro'],
    ])
  })

  it('ignores empty lines and trailing whitespace and collapses spaces', () => {
    expect(pairs('\n\n  cat   :   el   gato   \n\n\n dog: perro \t \n\n')).toEqual([
      ['cat', 'el gato'],
      ['dog', 'perro'],
    ])
  })

  it('keeps accents in Dutch and French text', () => {
    expect(pairs('één: one\ncafé: coffee\nça va: how are you\nreünie: reunion\nÉcole – school')).toEqual([
      ['één', 'one'],
      ['café', 'coffee'],
      ['ça va', 'how are you'],
      ['reünie', 'reunion'],
      ['École', 'school'],
    ])
  })

  it('handles non-Latin scripts, including full-width colons', () => {
    expect(pairs('猫：cat\n犬：dog\n水：water')).toEqual([
      ['猫', 'cat'],
      ['犬', 'dog'],
      ['水', 'water'],
    ])
    expect(pairs('собака - dog\nкошка - cat')).toEqual([
      ['собака', 'dog'],
      ['кошка', 'cat'],
    ])
    expect(pairs('مرحبا\thello\nشكرا\tthank you')).toEqual([
      ['مرحبا', 'hello'],
      ['شكرا', 'thank you'],
    ])
  })
})

describe('parseImport: other separators', () => {
  it('detects spaced dashes of all kinds', () => {
    const r = parseImport('cat - gato\ndog – perro\nhouse — casa\nwell-known - bekend')
    expect(r.detected.termSep).toBe('dash')
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['cat', 'gato'],
      ['dog', 'perro'],
      ['house', 'casa'],
      ['well-known', 'bekend'],
    ])
  })

  it('detects equals', () => {
    expect(pairs('H2O = water\nNaCl=salt')).toEqual([
      ['H2O', 'water'],
      ['NaCl', 'salt'],
    ])
  })

  it('detects semicolons between cards on one line', () => {
    const r = parseImport('perro, dog; gato, cat; casa, house')
    expect(r.detected).toMatchObject({ cardSep: 'semicolon', termSep: 'comma' })
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['perro', 'dog'],
      ['gato', 'cat'],
      ['casa', 'house'],
    ])
  })

  it('parses CSV with quoted commas and skips a header row', () => {
    const r = parseImport('term,definition\n"a, b",letters\n"New York","city, USA"\nplain,"multi\nline"')
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['a, b', 'letters'],
      ['New York', 'city, USA'],
      ['plain', 'multi\nline'],
    ])
    expect(r.cards[2].sourceLine).toBe(4)
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'header-row' }))
  })

  it('mixed separators: the majority wins and other lines still parse', () => {
    const r = parseImport('cat: gato\ndog: perro\nhouse: casa\nbook - libro\ntree: árbol')
    expect(r.detected.termSep).toBe('colon')
    expect(r.cards.map((c) => [c.term, c.definition])).toEqual([
      ['cat', 'gato'],
      ['dog', 'perro'],
      ['house', 'casa'],
      ['book', 'libro'],
      ['tree', 'árbol'],
    ])
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'mixed-separator', line: 4 }))

    const dashes = parseImport('a - 1\nb - 2\nc - 3\nd: 4')
    expect(dashes.detected.termSep).toBe('dash')
  })

  it('respects an explicitly chosen separator', () => {
    expect(pairs('a: b - c', { termSep: 'dash' })).toEqual([['a: b', 'c']])
    expect(pairs('a, b: c', { termSep: 'comma' })).toEqual([['a', 'b: c']])
    expect(pairs('a = b: c', { termSep: 'equals' })).toEqual([['a', 'b: c']])
  })
})

describe('parseImport: validation', () => {
  it('flags empty sides, duplicates and over-long fields', () => {
    const long = 'x'.repeat(10_001)
    const r = parseImport(`cat: gato\nCat: kat\n: nothing\nlong: ${long}\ndog:`, { termSep: 'colon' })
    const kinds = r.warnings.map((w) => [w.kind, w.line])
    expect(kinds).toContainEqual(['duplicate', 2])
    expect(kinds).toContainEqual(['empty-term', 3])
    expect(kinds).toContainEqual(['definition-too-long', 4])
    expect(kinds).toContainEqual(['empty-definition', 5])
  })

  it('returns nothing for blank input', () => {
    expect(parseImport('  \n\n ').cards).toEqual([])
  })

  it('is fast enough for live preview on large input', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `term ${i}: definition number ${i}, with a comma`).join('\n')
    const t = performance.now()
    const r = parseImport(big)
    expect(r.cards).toHaveLength(5000)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
