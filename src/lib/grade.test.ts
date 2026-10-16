import { describe, expect, it } from 'vitest'
import {
  answerVariants,
  canonical,
  defaultGradingLevel,
  grade,
  letterDiff,
  osaDistance,
  splitAlternatives,
  stripPunctuation,
} from './grade'

const ok = (response: string, answer: string, level: 'strict' | 'moderate' | 'relaxed', requireOne = false) =>
  grade(response, answer, { level, requireOne }).correct

describe('normalisation (all levels)', () => {
  it('ignores case, surrounding whitespace, repeated spaces and trailing punctuation', () => {
    expect(ok('  the   DOG ', 'The dog.', 'strict')).toBe(true)
    expect(ok('photosynthesis!', 'Photosynthesis', 'strict')).toBe(true)
  })

  it('treats curly and straight quotes the same', () => {
    expect(ok("it's", 'it’s', 'strict')).toBe(true)
    expect(ok('"hello"', '“hello”', 'strict')).toBe(true)
  })

  it('treats & and "and" the same', () => {
    expect(ok('salt & pepper', 'salt and pepper', 'strict')).toBe(true)
    expect(ok('salt and pepper', 'salt&pepper', 'strict')).toBe(true)
  })

  it('accepts answers that omit a parenthesised part', () => {
    expect(ok('run', '(to) run', 'strict')).toBe(true)
    expect(ok('to run', '(to) run', 'strict')).toBe(true)
    expect(ok('glucose', 'glucose (C6H12O6)', 'strict')).toBe(true)
    expect(answerVariants('(to) run')).toEqual(['to run', 'run'])
  })

  it('keeps punctuation that belongs to numbers', () => {
    expect(stripPunctuation('3.14')).toBe('3.14')
    expect(stripPunctuation('-5 degrees')).toBe('-5 degrees')
    expect(stripPunctuation('1,000')).toBe('1,000')
    expect(ok('314', '3.14', 'strict')).toBe(false)
    expect(canonical('U.S.A.')).toBe('usa')
  })

  it('rejects empty answers', () => {
    expect(grade('   ', 'dog', { level: 'relaxed' })).toMatchObject({ correct: false, reason: 'empty' })
  })
})

describe('strict', () => {
  it('rejects accents and typos', () => {
    expect(ok('cafe', 'café', 'strict')).toBe(false)
    expect(ok('photosynthsis', 'photosynthesis', 'strict')).toBe(false)
  })
  it('forgives punctuation differences', () => {
    expect(ok('well known', 'well-known', 'strict')).toBe(true)
    expect(ok('dont', "don't", 'strict')).toBe(true)
  })
})

describe('moderate', () => {
  it('accepts accent differences', () => {
    expect(grade('cafe', 'café', { level: 'moderate' })).toMatchObject({ correct: true, reason: 'accent' })
    expect(ok('reunie', 'reünie', 'moderate')).toBe(true)
    expect(ok('strasse', 'Straße', 'moderate')).toBe(true)
  })

  it('accepts one typo in short answers and two in longer ones', () => {
    expect(ok('hause', 'house', 'moderate')).toBe(true) // 1 substitution, ≤ 6 chars
    expect(ok('hosue', 'house', 'moderate')).toBe(true) // transposition
    expect(ok('hxusx', 'house', 'moderate')).toBe(false) // 2 errors in a short word
    expect(ok('photosynthsis', 'photosynthesis', 'moderate')).toBe(true) // missing letter
    expect(ok('fotosynthsis', 'photosynthesis', 'moderate')).toBe(false) // 3 edits
    expect(ok('mitochondira', 'mitochondria', 'moderate')).toBe(true) // swapped letters
  })

  it('requires very short answers and numbers to be exact', () => {
    expect(ok('ox', 'ax', 'moderate')).toBe(false)
    expect(ok('1948', '1984', 'moderate')).toBe(false)
    expect(ok('in 1948', 'in 1984', 'moderate')).toBe(false)
  })

  it('does not accept word reordering', () => {
    expect(ok('dog the', 'the dog', 'moderate')).toBe(false)
  })
})

describe('relaxed', () => {
  it('accepts the same key words in a different order without stopwords', () => {
    expect(grade('energy released from glucose', 'the release of energy from glucose', { level: 'relaxed' })).toMatchObject({
      correct: true,
      reason: 'meaning',
    })
    expect(ok('plants make glucose using light', 'process by which plants make glucose using light', 'relaxed')).toBe(true)
    expect(ok('plants make glucose', 'process by which plants make glucose using light', 'relaxed')).toBe(false)
  })

  it('accepts singular/plural differences', () => {
    expect(ok('membrane barrier', 'membranes barrier', 'relaxed')).toBe(true)
    expect(ok('the cells divide', 'cell divides', 'relaxed')).toBe(true)
  })

  it('still rejects wrong answers and negations', () => {
    expect(ok('makes proteins', 'stores water', 'relaxed')).toBe(false)
    expect(ok('is not soluble', 'is soluble', 'relaxed')).toBe(false)
    expect(ok('released in 1949', 'released in 1948', 'relaxed')).toBe(false)
  })

  it('includes everything moderate accepts', () => {
    expect(ok('cafe', 'café', 'relaxed')).toBe(true)
    expect(ok('photosynthsis', 'photosynthesis', 'relaxed')).toBe(true)
  })
})

describe('multiple accepted answers', () => {
  it('splits on commas, slashes and semicolons outside parentheses and numbers', () => {
    expect(splitAlternatives('big, large')).toEqual(['big', 'large'])
    expect(splitAlternatives('kat / poes; mies')).toEqual(['kat', 'poes', 'mies'])
    expect(splitAlternatives('1,000 (a, b)')).toEqual(['1,000 (a, b)'])
  })

  it('"Require 1 answer only" accepts any single option', () => {
    expect(grade('large', 'big, large', { level: 'strict', requireOne: true })).toMatchObject({
      correct: true,
      reason: 'one-of',
    })
    expect(ok('poes', 'kat / poes', 'strict', true)).toBe(true)
    expect(ok('small', 'big, large', 'strict', true)).toBe(false)
  })

  it('otherwise requires all options, in any order', () => {
    expect(ok('large', 'big, large', 'strict')).toBe(false)
    expect(ok('large, big', 'big, large', 'strict')).toBe(true)
    expect(ok('big/large', 'big, large', 'strict')).toBe(true)
    expect(ok('big, large', 'big, large', 'strict')).toBe(true)
  })
})

describe('defaultGradingLevel', () => {
  it('is strict for language pairs and Chinese/Japanese', () => {
    expect(defaultGradingLevel('es', 'en', 'en')).toBe('strict')
    expect(defaultGradingLevel('ja', 'ja', 'ja')).toBe('strict')
  })
  it('is strict for maths/chemistry content', () => {
    const samples = [
      { term: 'water', definition: 'H2O' },
      { term: '2 + 2', definition: '4' },
      { term: 'salt', definition: 'NaCl' },
    ]
    expect(defaultGradingLevel('en', 'en', 'en', samples)).toBe('strict')
  })
  it("is relaxed in the user's own language and moderate otherwise", () => {
    expect(defaultGradingLevel('en', 'en', 'en-GB')).toBe('relaxed')
    expect(defaultGradingLevel('nl', 'nl', 'en')).toBe('moderate')
  })
})

describe('helpers', () => {
  it('computes optimal string alignment distance', () => {
    expect(osaDistance('abc', 'abc')).toBe(0)
    expect(osaDistance('abc', 'acb')).toBe(1)
    expect(osaDistance('kitten', 'sitting')).toBe(3)
    expect(osaDistance('a', 'abcdef', 2)).toBe(3)
  })

  it('produces a letter diff for spell mode', () => {
    const diff = letterDiff('helo', 'hello')
    expect(diff.map((p) => p.text).join('')).toBe('hello')
    expect(diff.filter((p) => p.status !== 'ok')).toEqual([{ text: 'l', status: 'missing' }])
    expect(letterDiff('Hallo', 'hello').map((p) => p.status)).toEqual(['ok', 'wrong', 'ok'])
  })
})
