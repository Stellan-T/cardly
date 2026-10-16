/**
 * Blast game loop: owns the canvas, the requestAnimationFrame loop and the
 * game state, and reports discrete changes (score, wave, seconds left…) to
 * React through callbacks. All game logic lives in lib/blast.
 */
import {
  addScore,
  BLAST_SCORE,
  createCardCycle,
  cycleTarget,
  hitTest,
  layoutText,
  makeWave,
  rescaleAsteroids,
  scoreForHit,
  speedFor,
  stepAsteroids,
  type Asteroid,
  type BlastOptions,
  type Bounds,
  type TextLayout,
  type Wave,
} from '../../lib/blast'
import { answerSideFor } from '../../lib/questions'
import { createRng, type Rng } from '../../lib/random'
import { playSound } from '../../lib/sound'
import type { Card, Side } from '../../types'
import {
  addBurst,
  addFloater,
  addLaser,
  BARREL,
  drawAsteroid,
  drawBackground,
  drawEffects,
  drawShip,
  emptyEffects,
  makeStars,
  moveStars,
  stepEffects,
  type Effects,
  type Star,
} from './draw'

/** Height reserved above the prompt bar for the cannon. */
const SHIP_ZONE = 64
const SPAWN_MS = 260
const NEXT_WAVE_MS = 450
const SHAKE_MS = 280
const MIN_AIM = -Math.PI + 0.12
const MAX_AIM = -0.12

export type GamePhase = 'idle' | 'playing' | 'paused' | 'over'

export interface ChoiceView {
  id: number
  text: string
  state: 'live' | 'wrong' | 'reveal' | 'hit'
}

export interface EngineState {
  phase: GamePhase
  score: number
  remainingMs: number
  wave: { key: number; prompt: string; promptSide: Side; answerSide: Side } | null
  choices: ChoiceView[]
  /** Cannon cooling down after a wrong hit. */
  cooling: boolean
  /** Between a correct hit and the next wave. */
  busy: boolean
  targetId: number | null
  hits: number
  misses: number
}

export const IDLE_STATE: EngineState = {
  phase: 'idle',
  score: 0,
  remainingMs: 0,
  wave: null,
  choices: [],
  cooling: false,
  busy: false,
  targetId: null,
  hits: 0,
  misses: 0,
}

export interface GameResult {
  score: number
  hits: number
  misses: number
}

export interface GameConfig {
  /** Cards that become prompts. */
  cards: Card[]
  /** Cards that distractors are drawn from. */
  pool: Card[]
  options: BlastOptions
  seed: number
  reducedMotion: boolean
}

export interface EngineCallbacks {
  onChange: (state: EngineState) => void
  /** Text for a polite live region (screen readers). */
  onAnnounce: (text: string) => void
  onEnd: (result: GameResult) => void
  /** Checked every frame; the game pauses when it returns true (e.g. a dialog is open). */
  shouldPause: () => boolean
}

const clampAim = (a: number) => Math.min(MAX_AIM, Math.max(MIN_AIM, a))

export class BlastEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly cb: EngineCallbacks
  private readonly font: string
  private width = 0
  private height = 0
  private reserve = 0
  private dpr = 1
  private stars: Star[] = []
  private raf = 0
  private lastFrame = 0
  private phase: GamePhase = 'idle'
  private config: GameConfig | null = null
  private rng: Rng = Math.random
  private nextCard: (() => Card) | null = null
  private reduced = false
  /** Game time in ms; only advances while playing. */
  private time = 0
  private durationMs = 0
  private lastSecond = -1
  private score = 0
  private hits = 0
  private misses = 0
  private wave: Wave | null = null
  private waveKey = 0
  private asteroids: Asteroid[] = []
  private waveStart = 0
  private waveMissed = false
  private hitId: number | null = null
  private nextWaveAt = 0
  private cooldownUntil = 0
  private shakeUntil = 0
  private targetId: number | null = null
  private hoverId: number | null = null
  private keyboard = false
  private aim = -Math.PI / 2
  private aimGoal = -Math.PI / 2
  private nextId = 1
  private note = ''
  private fx: Effects = emptyEffects()
  private layouts = new Map<number, TextLayout & { r: number }>()

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.cb = callbacks
    this.font = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Size of the canvas in CSS px, the height covered by the prompt bar, and the device pixel ratio. */
  setLayout(width: number, height: number, reserve: number, dpr: number) {
    const before = this.field()
    const resized = width !== this.width || height !== this.height || dpr !== this.dpr
    this.width = width
    this.height = height
    this.reserve = reserve
    this.dpr = dpr
    if (resized) {
      this.canvas.width = Math.max(1, Math.round(width * dpr))
      this.canvas.height = Math.max(1, Math.round(height * dpr))
      this.stars = makeStars(width, height)
    }
    const after = this.field()
    if (this.asteroids.length && (before.width !== after.width || before.height !== after.height)) {
      this.asteroids = rescaleAsteroids(this.asteroids, before, after)
      this.layouts.clear()
    }
    if (!this.raf) this.draw(performance.now())
  }

  start(config: GameConfig) {
    this.stopLoop()
    this.config = config
    this.reduced = config.reducedMotion
    this.rng = createRng(config.seed)
    this.nextCard = createCardCycle(config.cards, this.rng)
    this.time = 0
    this.durationMs = config.options.minutes * 60_000
    this.lastSecond = -1
    this.score = 0
    this.hits = 0
    this.misses = 0
    this.nextWaveAt = 0
    this.cooldownUntil = 0
    this.shakeUntil = 0
    this.targetId = null
    this.hoverId = null
    this.keyboard = false
    this.aim = this.aimGoal = -Math.PI / 2
    this.fx = emptyEffects()
    this.note = 'Game started.'
    this.phase = 'playing'
    this.spawnWave()
    this.startLoop()
  }

  pause() {
    if (this.phase !== 'playing') return
    this.phase = 'paused'
    this.stopLoop()
    this.draw(performance.now())
    this.emit()
  }

  resume() {
    if (this.phase !== 'paused') return
    this.phase = 'playing'
    this.startLoop()
    this.emit()
  }

  destroy() {
    this.stopLoop()
    this.phase = 'idle'
    this.config = null
  }

  /** Tap or click on the canvas (CSS px relative to the canvas). */
  pointerDown(x: number, y: number, touch: boolean) {
    if (this.phase !== 'playing') return
    this.keyboard = false
    const hit = hitTest(this.asteroids, x, y, touch ? 14 : 4)
    if (hit) {
      this.fireAt(hit.id)
      return
    }
    // A shot into empty space: just the laser, no penalty.
    if (this.canFire() && y < this.field().height + 8) this.shoot(x, y)
  }

  /** Mouse hover; returns true when over a live asteroid. */
  pointerMove(x: number, y: number): boolean {
    if (this.phase !== 'playing') return false
    this.hoverId = hitTest(this.asteroids, x, y, 4)?.id ?? null
    return this.hoverId !== null
  }

  pointerLeave() {
    this.hoverId = null
  }

  /** ←/→: move the target highlight to the previous/next asteroid (left to right). */
  cycle(dir: 1 | -1) {
    if (this.phase !== 'playing' || this.nextWaveAt) return
    this.keyboard = true
    this.targetId = cycleTarget(this.asteroids, this.targetId, dir, this.ship())
    const target = this.asteroids.find((a) => a.id === this.targetId)
    if (target) this.cb.onAnnounce(`Target: ${target.text}`)
    this.emit()
  }

  /** Space: fire at the target (the first press picks one). */
  fireTarget() {
    if (this.phase !== 'playing') return
    this.keyboard = true
    const target = this.asteroids.find((a) => a.id === this.targetId && !a.disabled)
    if (target) this.fireAt(target.id)
    else this.cycle(1)
  }

  /** Answer buttons and number keys. */
  choose(id: number) {
    if (this.phase !== 'playing') return
    this.fireAt(id)
  }

  // -------------------------------------------------------------------------
  // Game logic
  // -------------------------------------------------------------------------

  private field(): Bounds {
    return { width: this.width, height: Math.max(80, this.height - this.reserve - SHIP_ZONE) }
  }

  private ship() {
    return { x: this.width / 2, y: this.height - this.reserve - 12 }
  }

  private canFire() {
    return this.phase === 'playing' && !this.nextWaveAt && this.time >= this.cooldownUntil
  }

  private spawnWave() {
    const config = this.config
    if (!config || !this.nextCard) return
    const card = this.nextCard()
    const answerSide = answerSideFor(config.options.answerWith, this.rng)
    const field = this.field()
    const speed = speedFor(config.options.speed, field)
    const wave = makeWave(card, config.pool, answerSide, config.options.choices, this.rng, field, speed, this.nextId)
    this.nextId += wave.asteroids.length
    this.wave = wave
    this.waveKey++
    this.asteroids = wave.asteroids
    this.waveStart = this.time
    this.waveMissed = false
    this.hitId = null
    this.cooldownUntil = 0
    this.hoverId = null
    this.layouts.clear()
    this.targetId = this.keyboard ? cycleTarget(this.asteroids, null, 1, this.ship()) : null
    this.cb.onAnnounce(`${this.note} Find the ${wave.answerSide} for: ${wave.prompt}`.trim())
    this.note = ''
    this.emit()
  }

  private shoot(x: number, y: number) {
    const ship = this.ship()
    this.aim = this.aimGoal = clampAim(Math.atan2(y - ship.y, x - ship.x))
    addLaser(this.fx, ship.x + Math.cos(this.aim) * BARREL, ship.y + Math.sin(this.aim) * BARREL, x, y)
    playSound('blast')
    if (!this.raf) this.draw(performance.now())
  }

  private fireAt(id: number) {
    if (!this.canFire()) return
    const a = this.asteroids.find((x) => x.id === id)
    if (!a || a.disabled) return
    this.shoot(a.x, a.y)
    if (a.correct) this.hitCorrect(a)
    else this.hitWrong(a)
    this.emit()
  }

  private hitCorrect(a: Asteroid) {
    const delta = scoreForHit(true, this.time - this.waveStart, this.waveMissed)
    this.score = addScore(this.score, delta)
    this.hits++
    this.hitId = a.id
    this.asteroids = this.asteroids.filter((x) => x.id !== a.id)
    addBurst(this.fx, a.x, a.y, a.r, 'boom', this.reduced)
    addFloater(this.fx, a.x, a.y, `+${delta}`, true)
    this.nextWaveAt = this.time + NEXT_WAVE_MS
    this.targetId = null
    this.hoverId = null
    playSound('correct')
    this.note = `Correct, plus ${delta} points.`
  }

  private hitWrong(a: Asteroid) {
    const before = this.score
    this.score = addScore(this.score, scoreForHit(false, this.time - this.waveStart))
    const lost = before - this.score
    this.misses++
    a.disabled = true
    this.waveMissed = true
    this.cooldownUntil = this.time + BLAST_SCORE.cooldownMs
    if (!this.reduced) this.shakeUntil = this.time + SHAKE_MS
    addBurst(this.fx, a.x, a.y, a.r, 'sparks', this.reduced)
    addFloater(this.fx, a.x, a.y, lost ? `−${lost}` : 'Miss', false)
    const correct = this.asteroids.find((x) => x.correct)
    if (this.keyboard || this.targetId === a.id) this.targetId = correct?.id ?? null
    if (this.hoverId === a.id) this.hoverId = null
    playSound('incorrect')
    this.cb.onAnnounce(
      `Wrong${lost ? `, minus ${lost} points` : ''}. The correct answer, ${correct?.text ?? ''}, is highlighted. ` +
        'The cannon cools down for a second.',
    )
  }

  private finish() {
    this.phase = 'over'
    this.stopLoop()
    this.time = this.durationMs
    this.asteroids = []
    this.wave = null
    this.targetId = null
    this.hoverId = null
    this.nextWaveAt = 0
    this.cooldownUntil = 0
    this.emit()
    this.draw(performance.now())
    this.cb.onEnd({ score: this.score, hits: this.hits, misses: this.misses })
  }

  private update(dt: number) {
    this.time += dt * 1000
    const remaining = this.durationMs - this.time
    if (remaining <= 0) {
      this.finish()
      return
    }
    let changed = false
    const second = Math.ceil(remaining / 1000)
    if (second !== this.lastSecond) {
      this.lastSecond = second
      changed = true
      if (second === 30 || second === 10) this.cb.onAnnounce(`${second} seconds left`)
    }
    this.asteroids = stepAsteroids(this.asteroids, dt, this.field())
    if (this.nextWaveAt && this.time >= this.nextWaveAt) {
      this.nextWaveAt = 0
      this.spawnWave()
    }
    if (this.cooldownUntil && this.time >= this.cooldownUntil) {
      this.cooldownUntil = 0
      changed = true
    }
    const target = this.targetId === null ? undefined : this.asteroids.find((a) => a.id === this.targetId)
    if (target) {
      const ship = this.ship()
      this.aimGoal = clampAim(Math.atan2(target.y - ship.y, target.x - ship.x))
    }
    this.aim = this.reduced ? this.aimGoal : this.aim + (this.aimGoal - this.aim) * Math.min(1, dt * 14)
    if (!this.reduced) moveStars(this.stars, dt, this.width, this.height)
    stepEffects(this.fx, dt)
    if (changed) this.emit()
  }

  private emit() {
    const wave = this.wave
    const byId = new Map(this.asteroids.map((a) => [a.id, a]))
    const stateOf = (a: Asteroid): ChoiceView['state'] => {
      if (a.id === this.hitId) return 'hit'
      if (byId.get(a.id)?.disabled) return 'wrong'
      return a.correct && this.waveMissed ? 'reveal' : 'live'
    }
    const choices = (wave?.asteroids ?? []).map((a): ChoiceView => ({ id: a.id, text: a.text, state: stateOf(a) }))
    this.cb.onChange({
      phase: this.phase,
      score: this.score,
      remainingMs: Math.max(0, this.durationMs - this.time),
      wave: wave && {
        key: this.waveKey,
        prompt: wave.prompt,
        promptSide: wave.promptSide,
        answerSide: wave.answerSide,
      },
      choices,
      cooling: this.time < this.cooldownUntil,
      busy: this.nextWaveAt > 0,
      targetId: this.targetId,
      hits: this.hits,
      misses: this.misses,
    })
  }

  // -------------------------------------------------------------------------
  // Loop + drawing
  // -------------------------------------------------------------------------

  private startLoop() {
    if (this.raf) return
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.phase !== 'playing') return
    if (this.cb.shouldPause()) {
      this.pause()
      return
    }
    // Clamp long gaps (debugger, stalled tab) so nothing jumps.
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    this.update(dt)
    this.draw(now)
    if (this.phase === 'playing') this.raf = requestAnimationFrame(this.frame)
  }

  private layoutFor(a: Asteroid): TextLayout {
    const cached = this.layouts.get(a.id)
    if (cached && Math.abs(cached.r - a.r) < 0.5) return cached
    const ctx = this.ctx
    let font = ''
    const measure = (s: string, size: number) => {
      if (!ctx) return s.length * size * 0.6
      const f = `600 ${size}px ${this.font}`
      if (f !== font) ctx.font = font = f
      return ctx.measureText(s).width
    }
    const layout = layoutText(a.text, a.r * 1.5, a.r * 1.16, measure, {
      maxFont: Math.min(24, Math.max(12, a.r * 0.42)),
      minFont: 11,
    })
    this.layouts.set(a.id, { ...layout, r: a.r })
    return layout
  }

  private draw(now: number) {
    const ctx = this.ctx
    const w = this.width
    const h = this.height
    if (!ctx || !w || !h) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    drawBackground(ctx, w, h, this.stars, now / 1000, this.reduced)
    ctx.save()
    if (this.phase === 'playing' && this.time < this.shakeUntil) {
      const k = (this.shakeUntil - this.time) / SHAKE_MS
      ctx.translate((Math.random() - 0.5) * 8 * k, (Math.random() - 0.5) * 8 * k)
    }
    const t = this.time / 1000
    const appear = Math.min(1, Math.max(0, (this.time - this.waveStart) / SPAWN_MS))
    const leave = this.nextWaveAt ? Math.max(0, (this.nextWaveAt - this.time) / NEXT_WAVE_MS) : 1
    for (const a of this.asteroids) {
      drawAsteroid(ctx, a, this.layoutFor(a), {
        alpha: Math.min(appear, leave) * (a.disabled ? 0.75 : 1),
        scale: this.reduced ? 1 : 0.85 + 0.15 * appear,
        target: a.id === this.targetId,
        hover: a.id === this.hoverId,
        reveal: a.correct && this.waveMissed,
        wrong: !!a.disabled,
        t,
        reduced: this.reduced,
        font: this.font,
      })
    }
    drawEffects(ctx, this.fx, this.font)
    const ship = this.ship()
    const cooling = this.time < this.cooldownUntil ? (this.cooldownUntil - this.time) / BLAST_SCORE.cooldownMs : 0
    drawShip(ctx, ship.x, ship.y, this.aim, cooling)
    ctx.restore()
  }
}
