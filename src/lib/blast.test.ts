import { describe, expect, it } from 'vitest'
import type { Card } from '../types'
import {
  addScore,
  asteroidRadius,
  BLAST_SCORE,
  createCardCycle,
  cycleTarget,
  DEFAULT_BLAST_OPTIONS,
  formatClock,
  hitTest,
  layoutText,
  makeWave,
  normalizeBlastOptions,
  placeCircles,
  rescaleAsteroids,
  scoreForHit,
  SPEED_PRESETS,
  speedFor,
  stepAsteroids,
  type Asteroid,
  type Bounds,
} from './blast'
import { createRng } from './random'

const card = (id: string, term: string, definition: string, order = 0): Card => ({
  id,
  term,
  definition,
  order,
  starred: false,
})

const CARDS: Card[] = [
  card('1', 'perro', 'dog', 0),
  card('2', 'gato', 'cat', 1),
  card('3', 'caballo', 'horse', 2),
  card('4', 'pájaro', 'bird', 3),
  card('5', 'pez', 'fish', 4),
  card('6', 'ratón', 'mouse', 5),
  card('7', 'vaca', 'cow', 6),
  card('8', 'oveja', 'a woolly farm animal that says baa', 7),
]

const PHONE: Bounds = { width: 343, height: 300 }
const DESKTOP: Bounds = { width: 900, height: 420 }

const EPS = 1e-6
const inside = (a: Asteroid, b: Bounds) =>
  a.x >= a.r - EPS && a.x <= b.width - a.r + EPS && a.y >= a.r - EPS && a.y <= b.height - a.r + EPS

function noOverlaps(asteroids: Asteroid[]) {
  for (let i = 0; i < asteroids.length; i++)
    for (let j = i + 1; j < asteroids.length; j++) {
      const a = asteroids[i]
      const b = asteroids[j]
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 1e-6)
    }
}

const asteroid = (id: number, x: number, y: number, r = 30, extra: Partial<Asteroid> = {}): Asteroid => ({
  id,
  cardId: String(id),
  text: `a${id}`,
  correct: false,
  x,
  y,
  vx: 0,
  vy: 0,
  r,
  seed: id,
  ...extra,
})

describe('makeWave', () => {
  it('has exactly N choices with exactly one correct answer and no duplicate texts', () => {
    for (let choices = 2; choices <= 5; choices++) {
      for (let seed = 0; seed < 40; seed++) {
        const rng = createRng(seed)
        const wave = makeWave(CARDS[seed % CARDS.length], CARDS, seed % 2 ? 'term' : 'definition', choices, rng, PHONE)
        expect(wave.asteroids).toHaveLength(choices)
        expect(wave.asteroids.filter((a) => a.correct)).toHaveLength(1)
        const texts = wave.asteroids.map((a) => a.text.toLowerCase())
        expect(new Set(texts).size).toBe(texts.length)
        const ids = wave.asteroids.map((a) => a.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('puts the right answer on the correct asteroid and shows the other side as the prompt', () => {
    const wave = makeWave(CARDS[1], CARDS, 'term', 4, createRng(3), PHONE)
    expect(wave.prompt).toBe('cat')
    expect(wave.promptSide).toBe('definition')
    expect(wave.asteroids.find((a) => a.correct)?.text).toBe('gato')
    expect(wave.asteroids.find((a) => a.correct)?.cardId).toBe('2')
    const defWave = makeWave(CARDS[1], CARDS, 'definition', 4, createRng(3), PHONE)
    expect(defWave.prompt).toBe('gato')
    expect(defWave.asteroids.find((a) => a.correct)?.text).toBe('cat')
  })

  it('never includes a distractor with the same text as the answer', () => {
    const pool = [...CARDS, card('9', 'can', 'dog', 8), card('10', 'Perro', 'hound', 9)]
    for (let seed = 0; seed < 30; seed++) {
      const wave = makeWave(CARDS[0], pool, seed % 2 ? 'term' : 'definition', 5, createRng(seed), PHONE)
      const answer = wave.asteroids.find((a) => a.correct)?.text.toLowerCase()
      expect(wave.asteroids.filter((a) => a.text.toLowerCase() === answer)).toHaveLength(1)
    }
  })

  it('starts without overlaps, fully inside the field, with ids from firstId', () => {
    for (const bounds of [PHONE, DESKTOP, { width: 320, height: 180 }]) {
      for (let seed = 0; seed < 60; seed++) {
        const wave = makeWave(CARDS[seed % CARDS.length], CARDS, 'definition', 5, createRng(seed), bounds, 40, 100)
        noOverlaps(wave.asteroids)
        for (const a of wave.asteroids) expect(inside(a, bounds)).toBe(true)
        expect(Math.min(...wave.asteroids.map((a) => a.id))).toBe(100)
      }
    }
  })

  it('is deterministic for a seed', () => {
    const a = makeWave(CARDS[2], CARDS, 'term', 4, createRng(42), PHONE)
    const b = makeWave(CARDS[2], CARDS, 'term', 4, createRng(42), PHONE)
    expect(a).toEqual(b)
  })

  it('moves asteroids at roughly the requested speed', () => {
    const wave = makeWave(CARDS[0], CARDS, 'term', 4, createRng(1), DESKTOP, 50)
    for (const a of wave.asteroids) {
      const s = Math.hypot(a.vx, a.vy)
      expect(s).toBeGreaterThanOrEqual(40 - 1e-6)
      expect(s).toBeLessThanOrEqual(60 + 1e-6)
    }
  })
})

describe('placeCircles', () => {
  it('falls back to shrinking circles when they cannot fit as requested', () => {
    const bounds = { width: 200, height: 120 }
    const radii = [80, 80, 80, 80, 80]
    const pts = placeCircles(radii, bounds, createRng(7))
    const asteroids = pts.map((p, i) => asteroid(i, p.x, p.y, radii[i]))
    noOverlaps(asteroids)
    for (const a of asteroids) expect(inside(a, bounds)).toBe(true)
  })
})

describe('asteroidRadius', () => {
  it('grows with the text length and shrinks with more choices', () => {
    const short = asteroidRadius('cat', DESKTOP, 4)
    expect(asteroidRadius('a much longer answer text here', DESKTOP, 4)).toBeGreaterThan(short)
    expect(asteroidRadius('cat', PHONE, 5)).toBeLessThan(asteroidRadius('cat', PHONE, 2))
  })
})

describe('stepAsteroids', () => {
  it('keeps every asteroid inside the field over many steps', () => {
    for (const bounds of [PHONE, DESKTOP]) {
      for (let seed = 0; seed < 10; seed++) {
        const fast = SPEED_PRESETS.fast * 3
        const wave = makeWave(CARDS[seed % CARDS.length], CARDS, 'definition', 5, createRng(seed), bounds, fast)
        let asteroids = wave.asteroids
        for (let i = 0; i < 3000; i++) {
          asteroids = stepAsteroids(asteroids, 1 / 60, bounds)
          for (const a of asteroids) expect(inside(a, bounds)).toBe(true)
        }
      }
    }
  })

  it('does not mutate its input and moves by velocity × dt', () => {
    const input = [asteroid(1, 100, 100, 20, { vx: 30, vy: -60 })]
    const out = stepAsteroids(input, 0.5, DESKTOP)
    expect(input[0].x).toBe(100)
    expect(out[0].x).toBeCloseTo(115)
    expect(out[0].y).toBeCloseTo(70)
  })

  it('bounces off the walls', () => {
    const [a] = stepAsteroids([asteroid(1, 25, 100, 20, { vx: -100 })], 0.1, DESKTOP)
    expect(a.x).toBe(20)
    expect(a.vx).toBeGreaterThan(0)
    const [b] = stepAsteroids([asteroid(1, 100, DESKTOP.height - 21, 20, { vy: 100 })], 0.1, DESKTOP)
    expect(b.y).toBe(DESKTOP.height - 20)
    expect(b.vy).toBeLessThan(0)
  })

  it('separates overlapping asteroids and makes approaching ones bounce apart', () => {
    const [a, b] = stepAsteroids(
      [asteroid(1, 200, 200, 30, { vx: 50 }), asteroid(2, 250, 200, 30, { vx: -50 })],
      0,
      DESKTOP,
    )
    expect(b.x - a.x).toBeGreaterThanOrEqual(60 - 1e-6)
    expect(a.vx).toBeLessThan(0)
    expect(b.vx).toBeGreaterThan(0)
  })

  it('keeps overlaps small while asteroids drift for a long time', () => {
    let asteroids = makeWave(CARDS[0], CARDS, 'definition', 5, createRng(9), PHONE, SPEED_PRESETS.fast).asteroids
    let worst = 0
    for (let i = 0; i < 3000; i++) {
      asteroids = stepAsteroids(asteroids, 1 / 60, PHONE)
      for (let p = 0; p < asteroids.length; p++)
        for (let q = p + 1; q < asteroids.length; q++) {
          const a = asteroids[p]
          const b = asteroids[q]
          worst = Math.max(worst, (a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y)) / Math.min(a.r, b.r))
        }
    }
    expect(worst).toBeLessThan(0.5)
  })
})

describe('rescaleAsteroids', () => {
  it('keeps asteroids inside a smaller field', () => {
    const wave = makeWave(CARDS[0], CARDS, 'term', 4, createRng(5), DESKTOP)
    const small = { width: 340, height: 260 }
    for (const a of rescaleAsteroids(wave.asteroids, DESKTOP, small)) expect(inside(a, small)).toBe(true)
  })
})

describe('hitTest', () => {
  const field = [asteroid(1, 100, 100, 40), asteroid(2, 300, 100, 40), asteroid(3, 160, 100, 40, { disabled: true })]

  it('finds the asteroid under the point', () => {
    expect(hitTest(field, 100, 100)?.id).toBe(1)
    expect(hitTest(field, 330, 120)?.id).toBe(2)
  })

  it('misses empty space, but slop widens the target', () => {
    expect(hitTest(field, 100, 145)).toBeNull()
    expect(hitTest(field, 100, 145, 8)?.id).toBe(1)
  })

  it('ignores disabled asteroids and prefers the closest centre', () => {
    expect(hitTest(field, 135, 100)?.id).toBe(1)
    expect(hitTest([asteroid(1, 100, 100, 40), asteroid(2, 140, 100, 40)], 130, 100)?.id).toBe(2)
  })
})

describe('cycleTarget', () => {
  const origin = { x: 200, y: 400 }
  const field = [
    asteroid(1, 300, 100),
    asteroid(2, 50, 100),
    asteroid(3, 200, 50),
    asteroid(4, 120, 80, 30, { disabled: true }),
  ]

  it('cycles left to right as seen from the cannon, skipping disabled asteroids', () => {
    expect(cycleTarget(field, null, 1, origin)).toBe(2)
    expect(cycleTarget(field, 2, 1, origin)).toBe(3)
    expect(cycleTarget(field, 3, 1, origin)).toBe(1)
    expect(cycleTarget(field, 1, 1, origin)).toBe(2)
    expect(cycleTarget(field, 2, -1, origin)).toBe(1)
    expect(cycleTarget(field, null, -1, origin)).toBe(1)
  })

  it('returns null when nothing can be targeted', () => {
    expect(cycleTarget([asteroid(1, 0, 0, 10, { disabled: true })], null, 1, origin)).toBeNull()
  })
})

describe('scoring', () => {
  it('gives more points for faster correct answers', () => {
    expect(scoreForHit(true, 0)).toBe(BLAST_SCORE.base + BLAST_SCORE.speedBonus)
    expect(scoreForHit(true, 1000)).toBeGreaterThan(scoreForHit(true, 5000))
    expect(scoreForHit(true, 5000)).toBeGreaterThan(scoreForHit(true, 60_000))
    expect(scoreForHit(true, 60_000)).toBe(BLAST_SCORE.base)
    for (let ms = 0; ms < 12_000; ms += 250)
      expect(scoreForHit(true, ms)).toBeGreaterThanOrEqual(scoreForHit(true, ms + 250))
  })

  it('costs points for a wrong hit and gives few points after a miss', () => {
    expect(scoreForHit(false, 500)).toBe(-BLAST_SCORE.penalty)
    expect(scoreForHit(true, 500, true)).toBe(BLAST_SCORE.afterMiss)
    expect(scoreForHit(true, 500, true)).toBeLessThan(scoreForHit(true, 60_000))
  })

  it('never drops below 0', () => {
    expect(addScore(0, scoreForHit(false, 0))).toBe(0)
    expect(addScore(30, -50)).toBe(0)
    expect(addScore(120, -50)).toBe(70)
    expect(addScore(120, 150)).toBe(270)
  })
})

describe('speed presets', () => {
  it('are ordered slow < normal < fast', () => {
    expect(SPEED_PRESETS.slow).toBeLessThan(SPEED_PRESETS.normal)
    expect(SPEED_PRESETS.normal).toBeLessThan(SPEED_PRESETS.fast)
    for (const b of [PHONE, DESKTOP]) {
      expect(speedFor('slow', b)).toBeLessThan(speedFor('normal', b))
      expect(speedFor('normal', b)).toBeLessThan(speedFor('fast', b))
    }
  })

  it('scale with the field size within limits', () => {
    expect(speedFor('normal', DESKTOP)).toBeGreaterThan(speedFor('normal', PHONE))
    expect(speedFor('normal', { width: 5000, height: 5000 })).toBe(SPEED_PRESETS.normal * 2)
    expect(speedFor('normal', { width: 10, height: 10 })).toBe(SPEED_PRESETS.normal * 0.75)
  })
})

describe('normalizeBlastOptions', () => {
  it('fills defaults and clamps out-of-range values', () => {
    expect(normalizeBlastOptions(undefined)).toEqual(DEFAULT_BLAST_OPTIONS)
    expect(DEFAULT_BLAST_OPTIONS.choices).toBe(4)
    expect(DEFAULT_BLAST_OPTIONS.minutes).toBe(2)
    const o = normalizeBlastOptions({ choices: 9, minutes: 0, speed: 'warp' as never, answerWith: 'both' })
    expect(o).toMatchObject({ choices: 5, minutes: 1, speed: 'normal', answerWith: 'both', starredOnly: false })
  })
})

describe('createCardCycle', () => {
  it('shows every card once per round and never the same card twice in a row', () => {
    const next = createCardCycle(CARDS, createRng(11))
    const seen: string[] = []
    for (let i = 0; i < CARDS.length * 20; i++) seen.push(next().id)
    for (let round = 0; round < 20; round++) {
      const ids = seen.slice(round * CARDS.length, (round + 1) * CARDS.length)
      expect(new Set(ids).size).toBe(CARDS.length)
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
  })
})

describe('layoutText', () => {
  // Monospace stand-in for canvas measureText: each character is 0.6em wide.
  const measure = (s: string, size: number) => [...s].length * size * 0.6

  it('uses the largest font that fits', () => {
    const l = layoutText('cat', 100, 60, measure, { maxFont: 22 })
    expect(l).toMatchObject({ fontSize: 22, lines: ['cat'], truncated: false })
  })

  it('wraps on spaces and shrinks to fit', () => {
    const l = layoutText('the quick brown fox jumps over', 80, 60, measure)
    expect(l.truncated).toBe(false)
    expect(l.lines.length).toBeGreaterThan(1)
    expect(l.lines.join(' ')).toBe('the quick brown fox jumps over')
    for (const line of l.lines) expect(measure(line, l.fontSize)).toBeLessThanOrEqual(80)
    expect(l.lines.length * l.lineHeight).toBeLessThanOrEqual(60)
  })

  it('breaks very long words and truncates with an ellipsis when nothing fits', () => {
    const word = layoutText('Donaudampfschifffahrtsgesellschaft', 60, 60, measure)
    for (const line of word.lines) expect(measure(line, word.fontSize)).toBeLessThanOrEqual(60)
    const long = layoutText('word '.repeat(200), 60, 30, measure)
    expect(long.truncated).toBe(true)
    expect(long.lines[long.lines.length - 1].endsWith('…')).toBe(true)
    for (const line of long.lines) expect(measure(line, long.fontSize)).toBeLessThanOrEqual(60)
  })
})

describe('formatClock', () => {
  it('formats m:ss and rounds up', () => {
    expect(formatClock(120_000)).toBe('2:00')
    expect(formatClock(59_001)).toBe('1:00')
    expect(formatClock(9_500)).toBe('0:10')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})
