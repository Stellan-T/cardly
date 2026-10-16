/** Canvas drawing for Blast: a fixed dark "space" palette, independent of the app theme. */
import type { Asteroid, TextLayout } from '../../lib/blast'

export const SPACE = {
  top: '#040714',
  bottom: '#0d1633',
  star: '#e2e8ff',
  rockLight: '#5d6680',
  rockDark: '#262c3e',
  rockEdge: '#8a93ab',
  text: '#f8fafc',
  target: '#7dd3fc',
  hover: 'rgb(186 230 253 / 65%)',
  reveal: '#4ade80',
  wrong: '#f87171',
  laserGlow: 'rgb(103 232 249 / 45%)',
  laserCore: '#ecfeff',
  gain: '#fde68a',
  loss: '#fca5a5',
}

const BOOM = ['#fde68a', '#fdba74', '#f87171', '#e2e8f0', '#a5b4fc']
const SPARKS = ['#fca5a5', '#f87171', '#fecaca']
const DEBRIS = ['#5d6680', '#8a93ab', '#3b4257']

export interface Star {
  x: number
  y: number
  size: number
  alpha: number
  speed: number
  twinkle: number
  phase: number
}

export function makeStars(width: number, height: number): Star[] {
  const count = Math.min(260, Math.round((width * height) / 2200))
  return Array.from({ length: count }, () => {
    const depth = Math.random()
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.6 + depth * 1.4,
      alpha: 0.35 + depth * 0.6,
      speed: 4 + depth * 16,
      twinkle: 1 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
    }
  })
}

export function moveStars(stars: Star[], dt: number, width: number, height: number) {
  for (const s of stars) {
    s.y += s.speed * dt
    if (s.y > height) {
      s.y -= height
      s.x = Math.random() * width
    }
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stars: Star[],
  t: number,
  reduced: boolean,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, SPACE.top)
  sky.addColorStop(1, SPACE.bottom)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  nebula(ctx, w * 0.82, h * 0.18, Math.max(w, h) * 0.55, '99 102 241', 0.16)
  nebula(ctx, w * 0.12, h * 0.72, Math.max(w, h) * 0.5, '45 212 191', 0.09)
  ctx.fillStyle = SPACE.star
  for (const s of stars) {
    ctx.globalAlpha = reduced ? s.alpha : s.alpha * (0.65 + 0.35 * Math.sin(t * s.twinkle + s.phase))
    ctx.fillRect(s.x, s.y, s.size, s.size)
  }
  ctx.globalAlpha = 1
}

function nebula(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgb(${rgb} / ${alpha})`)
  g.addColorStop(1, `rgb(${rgb} / 0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** Deterministic 0..1 noise for asteroid shapes. */
function noise(seed: number, i: number) {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function rockPath(ctx: CanvasRenderingContext2D, r: number, seed: number) {
  const n = 10 + (seed % 4)
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const k = 0.94 + 0.11 * noise(seed, i)
    return { x: Math.cos(a) * r * k, y: Math.sin(a) * r * k }
  })
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const start = mid(pts[n - 1], pts[0])
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y)
  }
  ctx.closePath()
}

export interface AsteroidLook {
  alpha: number
  scale: number
  target: boolean
  hover: boolean
  /** The correct answer, highlighted after a wrong hit. */
  reveal: boolean
  wrong: boolean
  t: number
  reduced: boolean
  font: string
}

export function drawAsteroid(ctx: CanvasRenderingContext2D, a: Asteroid, text: TextLayout, o: AsteroidLook) {
  if (o.alpha <= 0) return
  const r = a.r
  ctx.save()
  ctx.globalAlpha = o.alpha
  ctx.translate(a.x, a.y)
  if (o.scale !== 1) ctx.scale(o.scale, o.scale)

  if (o.reveal) {
    ctx.shadowColor = SPACE.reveal
    ctx.shadowBlur = o.reduced ? 20 : 16 + 10 * (0.5 + 0.5 * Math.sin(o.t * 6))
  }
  rockPath(ctx, r, a.seed)
  const fill = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05)
  fill.addColorStop(0, SPACE.rockLight)
  fill.addColorStop(1, SPACE.rockDark)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.shadowBlur = 0
  if (o.wrong) {
    ctx.fillStyle = 'rgb(220 38 38 / 28%)'
    ctx.fill()
  }
  ctx.lineWidth = o.reveal ? 2.5 : 1.5
  ctx.strokeStyle = o.wrong ? SPACE.wrong : o.reveal ? SPACE.reveal : SPACE.rockEdge
  ctx.stroke()

  // A couple of craters near the rim, clear of the text.
  ctx.fillStyle = 'rgb(0 0 0 / 22%)'
  for (const [i, base] of [
    [1, -Math.PI / 2],
    [2, Math.PI / 2],
  ]) {
    const ang = base + (noise(a.seed, i + 20) - 0.5) * 1.2
    const size = r * (0.07 + 0.05 * noise(a.seed, i + 30))
    ctx.beginPath()
    ctx.arc(Math.cos(ang) * r * 0.74, Math.sin(ang) * r * 0.74, size, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = o.wrong ? 'rgb(248 250 252 / 60%)' : SPACE.text
  ctx.font = `600 ${text.fontSize}px ${o.font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const y0 = -((text.lines.length - 1) * text.lineHeight) / 2
  text.lines.forEach((line, i) => ctx.fillText(line, 0, y0 + i * text.lineHeight))

  if (o.target || o.hover || o.reveal) {
    ctx.beginPath()
    ctx.arc(0, 0, r + 7, 0, Math.PI * 2)
    ctx.lineWidth = o.target ? 3 : 2
    ctx.strokeStyle = o.target ? SPACE.target : o.reveal ? SPACE.reveal : SPACE.hover
    if (o.target && !o.reduced) {
      ctx.setLineDash([10, 6])
      ctx.lineDashOffset = -o.t * 30
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

export const BARREL = 34

/** The cannon at the bottom centre; `cooling` (0..1) shows the remaining cooldown. */
export function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, aim: number, cooling: number) {
  ctx.save()
  ctx.translate(x, y)

  ctx.save()
  ctx.rotate(aim + Math.PI / 2)
  ctx.fillStyle = cooling > 0 ? SPACE.wrong : '#e2e8f0'
  ctx.fillRect(-4.5, -BARREL, 9, BARREL - 4)
  ctx.fillStyle = cooling > 0 ? '#fecaca' : '#67e8f9'
  ctx.fillRect(-4.5, -BARREL, 9, 4)
  ctx.restore()

  const dome = ctx.createLinearGradient(0, -18, 0, 0)
  dome.addColorStop(0, '#e2e8f0')
  dome.addColorStop(1, '#64748b')
  ctx.fillStyle = dome
  ctx.beginPath()
  ctx.ellipse(0, 0, 26, 18, 0, Math.PI, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#334155'
  ctx.fillRect(-32, 0, 64, 6)
  ctx.fillStyle = '#67e8f9'
  ctx.fillRect(-20, 2, 40, 2)

  if (cooling > 0) {
    ctx.beginPath()
    ctx.arc(0, -4, BARREL + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooling)
    ctx.lineWidth = 3
    ctx.strokeStyle = SPACE.wrong
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

interface Laser {
  x1: number
  y1: number
  x2: number
  y2: number
  life: number
  max: number
}

interface Floater {
  x: number
  y: number
  text: string
  color: string
  life: number
  max: number
}

export interface Effects {
  particles: Particle[]
  lasers: Laser[]
  floaters: Floater[]
}

export const emptyEffects = (): Effects => ({ particles: [], lasers: [], floaters: [] })

const LASER_MS = 170
const FLOATER_MS = 900

export function addLaser(fx: Effects, x1: number, y1: number, x2: number, y2: number) {
  fx.lasers.push({ x1, y1, x2, y2, life: LASER_MS, max: LASER_MS })
}

export function addFloater(fx: Effects, x: number, y: number, text: string, gain: boolean) {
  fx.floaters.push({ x, y, text, color: gain ? SPACE.gain : SPACE.loss, life: FLOATER_MS, max: FLOATER_MS })
}

/** Burst of particles: a big explosion for a correct hit, a few sparks for a wrong one. */
export function addBurst(fx: Effects, x: number, y: number, r: number, kind: 'boom' | 'sparks', reduced: boolean) {
  const big = kind === 'boom'
  const count = big ? (reduced ? 8 : 34) : reduced ? 3 : 12
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2
    const speed = (big ? 60 : 40) + Math.random() * (big ? 200 : 110)
    const debris = big && i % 3 === 0
    const palette = big ? (debris ? DEBRIS : BOOM) : SPARKS
    const max = (big ? 500 : 300) + Math.random() * 400
    fx.particles.push({
      x: x + Math.cos(ang) * r * (big ? 0.5 : 0.2),
      y: y + Math.sin(ang) * r * (big ? 0.5 : 0.2),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: max,
      max,
      size: debris ? 3 + Math.random() * 3 : 1.5 + Math.random() * 2.5,
      color: palette[i % palette.length],
    })
  }
}

export function stepEffects(fx: Effects, dt: number) {
  const ms = dt * 1000
  const drag = Math.pow(0.35, dt)
  fx.particles = fx.particles.filter((p) => {
    p.life -= ms
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= drag
    p.vy *= drag
    return p.life > 0
  })
  fx.lasers = fx.lasers.filter((l) => (l.life -= ms) > 0)
  fx.floaters = fx.floaters.filter((f) => {
    f.life -= ms
    f.y -= 34 * dt
    return f.life > 0
  })
}

export function drawEffects(ctx: CanvasRenderingContext2D, fx: Effects, font: string) {
  ctx.save()
  ctx.lineCap = 'round'
  for (const l of fx.lasers) {
    ctx.globalAlpha = Math.max(0, l.life / l.max)
    ctx.beginPath()
    ctx.moveTo(l.x1, l.y1)
    ctx.lineTo(l.x2, l.y2)
    ctx.strokeStyle = SPACE.laserGlow
    ctx.lineWidth = 8
    ctx.stroke()
    ctx.strokeStyle = SPACE.laserCore
    ctx.lineWidth = 2.5
    ctx.stroke()
  }
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max)
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
  }
  ctx.font = `700 20px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const f of fx.floaters) {
    ctx.globalAlpha = Math.min(1, (f.life / f.max) * 1.6)
    ctx.fillStyle = f.color
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}
