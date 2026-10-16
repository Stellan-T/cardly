/**
 * Pure game logic for Blast: options, waves of answer asteroids, movement,
 * hit testing, scoring and fitting answer text inside an asteroid.
 * Coordinates are CSS pixels with the origin at the top-left of the asteroid field.
 */
import type { AnswerWith, Card, Side } from '../types'
import { otherSide, pickDistractors, sideText } from './questions'
import { shuffle, type Rng } from './random'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type BlastSpeed = 'slow' | 'normal' | 'fast'

export interface BlastOptions {
  speed: BlastSpeed
  /** Asteroids per wave (the correct answer + distractors), 2–5. */
  choices: number
  /** Game length in minutes, 1–5. */
  minutes: number
  answerWith: AnswerWith
  starredOnly: boolean
}

export const DEFAULT_BLAST_OPTIONS: BlastOptions = {
  speed: 'normal',
  choices: 4,
  minutes: 2,
  answerWith: 'term',
  starredOnly: false,
}

export const MIN_CHOICES = 2
export const MAX_CHOICES = 5
export const MIN_MINUTES = 1
export const MAX_MINUTES = 5

/** Base drift speed in px/s for a 400px-wide field (see `speedFor`). */
export const SPEED_PRESETS: Record<BlastSpeed, number> = { slow: 20, normal: 34, fast: 54 }
export const SPEED_LABELS: Record<BlastSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' }

const ANSWER_WITH: readonly AnswerWith[] = ['term', 'definition', 'both']
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const intIn = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : fallback

/** Fills in defaults and clamps values saved by older versions or other devices. */
export function normalizeBlastOptions(o: Partial<BlastOptions> | null | undefined): BlastOptions {
  const d = DEFAULT_BLAST_OPTIONS
  const v = o ?? {}
  return {
    speed: v.speed && v.speed in SPEED_PRESETS ? v.speed : d.speed,
    choices: intIn(v.choices, MIN_CHOICES, MAX_CHOICES, d.choices),
    minutes: intIn(v.minutes, MIN_MINUTES, MAX_MINUTES, d.minutes),
    answerWith: v.answerWith && ANSWER_WITH.includes(v.answerWith) ? v.answerWith : d.answerWith,
    starredOnly: !!v.starredOnly,
  }
}

export interface Bounds {
  width: number
  height: number
}

/** Drift speed in px/s, scaled with the field so phones and desktops feel alike. */
export function speedFor(speed: BlastSpeed, bounds: Bounds): number {
  const scale = clamp(Math.min(bounds.width, bounds.height * 1.5) / 400, 0.75, 2)
  return SPEED_PRESETS[speed] * scale
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const BLAST_SCORE = {
  /** Points for a correct hit, before the speed bonus. */
  base: 100,
  /** Extra points for an instant hit, shrinking linearly to 0 over `bonusWindowMs`. */
  speedBonus: 100,
  bonusWindowMs: 8000,
  /** Points lost for hitting a wrong asteroid. */
  penalty: 50,
  /** Points for the correct asteroid after a miss in the same wave. */
  afterMiss: 25,
  /** Cannon cooldown after a wrong hit. */
  cooldownMs: 1000,
}

/** Score change for a hit. Faster correct answers earn more; wrong hits cost points. */
export function scoreForHit(correct: boolean, reactionMs: number, missed = false): number {
  if (!correct) return -BLAST_SCORE.penalty
  if (missed) return BLAST_SCORE.afterMiss
  const t = clamp(reactionMs / BLAST_SCORE.bonusWindowMs, 0, 1)
  return BLAST_SCORE.base + Math.round((BLAST_SCORE.speedBonus * (1 - t)) / 10) * 10
}

/** Applies a score change; the score never drops below 0. */
export const addScore = (score: number, delta: number) => Math.max(0, score + delta)

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export interface Asteroid {
  id: number
  cardId: string
  text: string
  correct: boolean
  /** Centre. */
  x: number
  y: number
  /** Velocity in px/s. */
  vx: number
  vy: number
  r: number
  /** Shape seed for drawing. */
  seed: number
  /** Already hit (wrong): ignored by hit testing and targeting. */
  disabled?: boolean
}

export interface Wave {
  cardId: string
  answerSide: Side
  promptSide: Side
  prompt: string
  asteroids: Asteroid[]
}

export const MIN_RADIUS = 30
export const MAX_RADIUS = 100
/** Minimum empty space between asteroids when a wave appears. */
export const SPAWN_GAP = 8

/** Radius for an answer: bigger for longer text, smaller when more asteroids share the field. */
export function asteroidRadius(text: string, bounds: Bounds, count: number): number {
  const base = Math.sqrt((bounds.width * bounds.height) / Math.max(count, 1)) * 0.34
  const lengthFactor = 0.82 + 0.36 * Math.min(1, text.trim().length / 48)
  const hi = Math.max(12, Math.min(MAX_RADIUS, Math.min(bounds.width, bounds.height) * 0.3))
  const lo = Math.min(MIN_RADIUS, hi)
  return clamp(base * lengthFactor, lo, hi)
}

export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

export const overlaps = (a: Asteroid, b: Asteroid, gap = 0) => distance(a, b) < a.r + b.r + gap

function tryPlace(radii: number[], bounds: Bounds, rng: Rng, gap: number): { x: number; y: number }[] | null {
  const order = radii.map((_, i) => i).sort((a, b) => radii[b] - radii[a])
  const pts: ({ x: number; y: number } | undefined)[] = []
  for (const i of order) {
    const r = radii[i]
    let placed = false
    for (let attempt = 0; attempt < 150 && !placed; attempt++) {
      const x = r + rng() * Math.max(0, bounds.width - 2 * r)
      const y = r + rng() * Math.max(0, bounds.height - 2 * r)
      const free = pts.every((p, j) => !p || Math.hypot(p.x - x, p.y - y) >= radii[j] + r + gap)
      if (free) {
        pts[i] = { x, y }
        placed = true
      }
    }
    if (!placed) return null
  }
  return radii.map((_, i) => pts[i] ?? { x: 0, y: 0 })
}

/**
 * Non-overlapping centres for circles of the given radii. Random placement,
 * shrinking the circles if they don't fit; as a last resort a grid with the
 * circles shrunk to fit their cells. May shrink `radii` in place.
 */
export function placeCircles(radii: number[], bounds: Bounds, rng: Rng, gap = SPAWN_GAP): { x: number; y: number }[] {
  for (let round = 0; round < 6; round++) {
    const pts = tryPlace(radii, bounds, rng, gap)
    if (pts) return pts
    for (let i = 0; i < radii.length; i++) radii[i] = Math.max(8, radii[i] * 0.9)
  }
  const n = radii.length
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * bounds.width) / Math.max(bounds.height, 1))))
  const rows = Math.ceil(n / cols)
  const cw = bounds.width / cols
  const ch = bounds.height / rows
  const maxR = Math.max(1, Math.min(cw, ch) / 2 - gap / 2)
  const cells = shuffle(
    Array.from({ length: cols * rows }, (_, i) => i),
    rng,
  )
  return radii.map((r, i) => {
    radii[i] = Math.min(r, maxR)
    const cell = cells[i]
    return { x: (cell % cols) * cw + cw / 2, y: Math.floor(cell / cols) * ch + ch / 2 }
  })
}

/**
 * One wave: the prompt plus asteroids carrying the correct answer and up to
 * `choices - 1` distractors from the pool (no duplicate texts), spread over
 * the field without overlapping and drifting in random directions.
 */
export function makeWave(
  card: Card,
  pool: readonly Card[],
  answerSide: Side,
  choices: number,
  rng: Rng,
  bounds: Bounds,
  speed = SPEED_PRESETS.normal,
  firstId = 1,
): Wave {
  const promptSide = otherSide(answerSide)
  const distractors = pickDistractors(card, pool, answerSide, Math.max(1, choices) - 1, rng)
  const correct = { cardId: card.id, text: sideText(card, answerSide), correct: true }
  const answers = shuffle([correct, ...distractors.map((d) => ({ ...d, correct: false }))], rng)
  const radii = answers.map((a) => asteroidRadius(a.text, bounds, answers.length))
  const pts = placeCircles(radii, bounds, rng)
  const asteroids = answers.map((a, i): Asteroid => {
    const angle = rng() * Math.PI * 2
    const s = speed * (0.8 + rng() * 0.4)
    return {
      id: firstId + i,
      cardId: a.cardId,
      text: a.text,
      correct: a.correct,
      x: pts[i].x,
      y: pts[i].y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      r: radii[i],
      seed: Math.floor(rng() * 1e9),
    }
  })
  return { cardId: card.id, answerSide, promptSide, prompt: sideText(card, promptSide), asteroids }
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function keepInside(a: Asteroid, bounds: Bounds) {
  const minX = Math.min(a.r, bounds.width / 2)
  const maxX = Math.max(bounds.width - a.r, bounds.width / 2)
  const minY = Math.min(a.r, bounds.height / 2)
  const maxY = Math.max(bounds.height - a.r, bounds.height / 2)
  if (a.x < minX) {
    a.x = minX
    a.vx = Math.abs(a.vx)
  } else if (a.x > maxX) {
    a.x = maxX
    a.vx = -Math.abs(a.vx)
  }
  if (a.y < minY) {
    a.y = minY
    a.vy = Math.abs(a.vy)
  } else if (a.y > maxY) {
    a.y = maxY
    a.vy = -Math.abs(a.vy)
  }
}

/**
 * Advances the asteroids by `dt` seconds: they drift, push apart and bounce
 * off each other (equal-mass elastic collisions) and bounce off the edges, so
 * every asteroid stays fully inside the field.
 */
export function stepAsteroids(asteroids: readonly Asteroid[], dt: number, bounds: Bounds): Asteroid[] {
  const next = asteroids.map((a) => ({ ...a, x: a.x + a.vx * dt, y: a.y + a.vy * dt }))
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      const a = next[i]
      const b = next[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy)
      const min = a.r + b.r
      if (dist >= min) continue
      const nx = dist > 1e-6 ? dx / dist : 1
      const ny = dist > 1e-6 ? dy / dist : 0
      const push = (min - dist) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (approach < 0) {
        a.vx += approach * nx
        a.vy += approach * ny
        b.vx -= approach * nx
        b.vy -= approach * ny
      }
    }
  }
  for (const a of next) keepInside(a, bounds)
  return next
}

/** Maps asteroids onto a resized field, keeping their relative positions. */
export function rescaleAsteroids(asteroids: readonly Asteroid[], from: Bounds, to: Bounds): Asteroid[] {
  if (from.width <= 0 || from.height <= 0) return asteroids.map((a) => ({ ...a }))
  const sx = to.width / from.width
  const sy = to.height / from.height
  const k = Math.sqrt(sx * sy)
  const hi = Math.max(12, Math.min(MAX_RADIUS, Math.min(to.width, to.height) * 0.3))
  return asteroids.map((a) => {
    const next = { ...a, x: a.x * sx, y: a.y * sy, vx: a.vx * k, vy: a.vy * k, r: clamp(a.r * k, Math.min(12, hi), hi) }
    keepInside(next, to)
    return next
  })
}

// ---------------------------------------------------------------------------
// Aiming
// ---------------------------------------------------------------------------

/** The asteroid under a point (closest centre wins), ignoring disabled ones. `slop` widens the hit area for touch. */
export function hitTest(asteroids: readonly Asteroid[], x: number, y: number, slop = 0): Asteroid | null {
  let best: Asteroid | null = null
  let bestScore = Infinity
  for (const a of asteroids) {
    if (a.disabled) continue
    const d = Math.hypot(x - a.x, y - a.y)
    if (d > a.r + slop) continue
    const score = d / a.r
    if (score < bestScore) {
      best = a
      bestScore = score
    }
  }
  return best
}

/**
 * Keyboard targeting: the next (dir 1) or previous (dir -1) live asteroid,
 * ordered left to right as seen from the cannon at `origin`.
 */
export function cycleTarget(
  asteroids: readonly Asteroid[],
  currentId: number | null,
  dir: 1 | -1,
  origin: { x: number; y: number },
): number | null {
  const live = asteroids.filter((a) => !a.disabled)
  if (!live.length) return null
  const angle = (a: Asteroid) => Math.atan2(a.y - origin.y, a.x - origin.x)
  const sorted = [...live].sort((a, b) => angle(a) - angle(b))
  const i = sorted.findIndex((a) => a.id === currentId)
  if (i < 0) return (dir > 0 ? sorted[0] : sorted[sorted.length - 1]).id
  return sorted[(i + dir + sorted.length) % sorted.length].id
}

// ---------------------------------------------------------------------------
// Card order
// ---------------------------------------------------------------------------

/** Endless shuffled deck: every card comes up once per round, never twice in a row. */
export function createCardCycle<T extends { id: string }>(items: readonly T[], rng: Rng): () => T {
  if (!items.length) throw new Error('createCardCycle needs at least one item')
  let queue: T[] = []
  let last: string | null = null
  return () => {
    if (!queue.length) {
      queue = shuffle(items, rng)
      if (queue.length > 1 && queue[0].id === last) queue.push(...queue.splice(0, 1))
    }
    const [next, ...rest] = queue
    queue = rest
    last = next.id
    return next
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface TextLayout {
  fontSize: number
  lineHeight: number
  lines: string[]
  truncated: boolean
}

type Measure = (text: string) => number

function wrapText(text: string, maxWidth: number, measure: Measure, breakWords: boolean): string[] | null {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    if (measure(word) <= maxWidth) {
      line = word
      continue
    }
    if (!breakWords) return null
    let chunk = ''
    for (const ch of word) {
      if (chunk && measure(chunk + ch) > maxWidth) {
        lines.push(chunk)
        chunk = ch
      } else chunk += ch
    }
    line = chunk
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Fits text in a box: the largest font size (from `maxFont` down to
 * `minFont`) whose wrapped lines fit, preferring sizes that don't split
 * words. If nothing fits, the text is cut with an ellipsis at `minFont`.
 */
export function layoutText(
  text: string,
  maxWidth: number,
  maxHeight: number,
  measure: (text: string, fontSize: number) => number,
  { maxFont = 22, minFont = 11, lineHeight = 1.18 }: { maxFont?: number; minFont?: number; lineHeight?: number } = {},
): TextLayout {
  const clean = text.replace(/\s+/g, ' ').trim()
  const top = Math.max(minFont, Math.floor(maxFont))
  for (const breakWords of [false, true]) {
    for (let size = top; size >= minFont; size--) {
      const maxLines = Math.max(1, Math.floor(maxHeight / (size * lineHeight)))
      const lines = wrapText(clean, maxWidth, (s) => measure(s, size), breakWords)
      if (lines && lines.length <= maxLines)
        return { fontSize: size, lineHeight: size * lineHeight, lines, truncated: false }
    }
  }
  const size = minFont
  const m = (s: string) => measure(s, size)
  const maxLines = Math.max(1, Math.floor(maxHeight / (size * lineHeight)))
  const lines = (wrapText(clean, maxWidth, m, true) ?? [clean]).slice(0, maxLines)
  let last = lines[lines.length - 1] ?? ''
  while (last && m(`${last}…`) > maxWidth) last = last.slice(0, -1)
  lines[lines.length - 1] = `${last.trimEnd()}…`
  return { fontSize: size, lineHeight: size * lineHeight, lines, truncated: true }
}

/** Remaining time as m:ss, rounded up so 0:00 only shows at the very end. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
