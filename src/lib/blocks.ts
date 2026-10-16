/**
 * Rules of the Blocks puzzle (pure, no React): an 8×8 grid, pieces placed by
 * the top-left corner of their bounding box, and full rows and columns that
 * clear together — a cell shared by a cleared row and column is cleared once.
 */
import type { Rng } from './random'

export const GRID_SIZE = 8
export const TRAY_SIZE = 3
/** Piece colours are 1…PIECE_COLORS; 0 is an empty cell. */
export const PIECE_COLORS = 7
export const POINTS_PER_LINE = 10

export type Grid = readonly (readonly number[])[]

export interface Shape {
  /** Family key + rotation, e.g. "i3-1" (vertical line of 3). */
  id: string
  /** Readable family name ("L shape"). */
  name: string
  rows: number
  cols: number
  /** [row, col] offsets from the top-left corner. */
  cells: readonly (readonly [number, number])[]
}

export interface Piece {
  shape: Shape
  color: number
}

export interface PlaceResult {
  grid: number[][]
  clearedRows: number[]
  clearedCols: number[]
  cellsPlaced: number
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface Family {
  key: string
  name: string
  /** Relative chance of being dealt (shared by the family's rotations). */
  weight: number
  /** Rows separated by "/", "#" = block. */
  pattern: string
}

const FAMILIES: Family[] = [
  { key: 'dot', name: 'Single block', weight: 2, pattern: '#' },
  { key: 'i2', name: 'Line of 2', weight: 3, pattern: '##' },
  { key: 'i3', name: 'Line of 3', weight: 3, pattern: '###' },
  { key: 'i4', name: 'Line of 4', weight: 2, pattern: '####' },
  { key: 'i5', name: 'Line of 5', weight: 2, pattern: '#####' },
  { key: 'o2', name: '2 by 2 square', weight: 3, pattern: '##/##' },
  { key: 'o3', name: '3 by 3 square', weight: 1, pattern: '###/###/###' },
  { key: 'r23', name: 'Rectangle', weight: 1, pattern: '###/###' },
  { key: 'v3', name: 'Small corner', weight: 3, pattern: '#./##' },
  { key: 'v5', name: 'Big corner', weight: 2, pattern: '#../#../###' },
  { key: 'l', name: 'L shape', weight: 2, pattern: '#./#./##' },
  { key: 'j', name: 'J shape', weight: 2, pattern: '.#/.#/##' },
  { key: 't', name: 'T shape', weight: 2, pattern: '###/.#.' },
  { key: 's', name: 'S shape', weight: 1, pattern: '.##/##.' },
  { key: 'z', name: 'Z shape', weight: 1, pattern: '##./.##' },
]

type Cells = [number, number][]

function parse(pattern: string): Cells {
  const cells: Cells = []
  pattern.split('/').forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && cells.push([r, c])))
  return cells
}

function normalize(cells: Cells): Cells {
  const minR = Math.min(...cells.map(([r]) => r))
  const minC = Math.min(...cells.map(([, c]) => c))
  return cells.map(([r, c]) => [r - minR, c - minC] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** 90° clockwise. */
const rotate = (cells: Cells): Cells => normalize(cells.map(([r, c]) => [c, -r]))

function toShape(id: string, name: string, cells: Cells): Shape {
  return {
    id,
    name,
    rows: Math.max(...cells.map(([r]) => r)) + 1,
    cols: Math.max(...cells.map(([, c]) => c)) + 1,
    cells,
  }
}

/** Every family in each of its distinct rotations. */
const FAMILY_SHAPES: { family: Family; shapes: Shape[] }[] = FAMILIES.map((family) => {
  const shapes: Shape[] = []
  const seen = new Set<string>()
  let cells = normalize(parse(family.pattern))
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(cells)
    if (!seen.has(key)) {
      seen.add(key)
      shapes.push(toShape(`${family.key}-${shapes.length}`, family.name, cells))
    }
    cells = rotate(cells)
  }
  return { family, shapes }
})

export const SHAPES: readonly Shape[] = FAMILY_SHAPES.flatMap((f) => f.shapes)

const BY_ID = new Map(SHAPES.map((s) => [s.id, s]))

export function shapeById(id: string): Shape {
  const s = BY_ID.get(id)
  if (!s) throw new Error(`Unknown shape "${id}"`)
  return s
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function emptyGrid(size = GRID_SIZE): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
}

/** True when every cell of the shape lands inside the grid on an empty cell. */
export function canPlace(grid: Grid, shape: Shape, row: number, col: number): boolean {
  const size = grid.length
  for (const [dr, dc] of shape.cells) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || c < 0 || r >= size || c >= size || grid[r][c] !== 0) return false
  }
  return true
}

/** Places a shape and clears every full row and column. Throws if it doesn't fit. */
export function place(grid: Grid, shape: Shape, row: number, col: number, color = 1): PlaceResult {
  if (!canPlace(grid, shape, row, col)) throw new RangeError(`${shape.id} doesn't fit at ${row},${col}`)
  const next = grid.map((r) => [...r])
  for (const [dr, dc] of shape.cells) next[row + dr][col + dc] = color
  const size = next.length
  const clearedRows: number[] = []
  const clearedCols: number[] = []
  for (let r = 0; r < size; r++) if (next[r].every((v) => v !== 0)) clearedRows.push(r)
  for (let c = 0; c < size; c++) if (next.every((r) => r[c] !== 0)) clearedCols.push(c)
  for (const r of clearedRows) next[r].fill(0)
  for (const c of clearedCols) for (const r of next) r[c] = 0
  return { grid: next, clearedRows, clearedCols, cellsPlaced: shape.cells.length }
}

export const linesCleared = (result: Pick<PlaceResult, 'clearedRows' | 'clearedCols'>) =>
  result.clearedRows.length + result.clearedCols.length

/** First position (top to bottom, left to right) where the shape fits, or null. */
export function findFit(grid: Grid, shape: Shape): [number, number] | null {
  const size = grid.length
  for (let r = 0; r + shape.rows <= size; r++) {
    for (let c = 0; c + shape.cols <= size; c++) if (canPlace(grid, shape, r, c)) return [r, c]
  }
  return null
}

export const fitsAnywhere = (grid: Grid, shape: Shape) => findFit(grid, shape) !== null

export const anyFits = (grid: Grid, shapes: readonly Shape[]) => shapes.some((s) => fitsAnywhere(grid, s))

/** Over when pieces are left in the tray and none of them fits. An empty tray (waiting for a question) is not. */
export function isGameOver(grid: Grid, tray: readonly (Piece | null)[]): boolean {
  const left = tray.filter((p): p is Piece => p !== null)
  return left.length > 0 && !anyFits(grid, left.map((p) => p.shape))
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Consecutive placements that cleared at least one line (0 after a placement that cleared nothing). */
export const nextCombo = (combo: number, lines: number) => (lines > 0 ? combo + 1 : 0)

/**
 * 1 point per cell placed; n lines cleared at once score 10 × n² (10, 40, 90, …);
 * each consecutive clear (combo ≥ 2) adds 10 × n × (combo − 1).
 */
export function scoreFor(cellsPlaced: number, linesCleared: number, combo: number): number {
  if (linesCleared <= 0) return cellsPlaced
  const lines = POINTS_PER_LINE * linesCleared * linesCleared
  const comboBonus = POINTS_PER_LINE * linesCleared * Math.max(0, combo - 1)
  return cellsPlaced + lines + comboBonus
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

const TOTAL_WEIGHT = FAMILIES.reduce((sum, f) => sum + f.weight, 0)

export function randomPiece(rng: Rng): Piece {
  let roll = rng() * TOTAL_WEIGHT
  let entry = FAMILY_SHAPES[FAMILY_SHAPES.length - 1]
  for (const f of FAMILY_SHAPES) {
    roll -= f.family.weight
    if (roll < 0) {
      entry = f
      break
    }
  }
  const shape = entry.shapes[Math.floor(rng() * entry.shapes.length)]
  return { shape, color: 1 + Math.floor(rng() * PIECE_COLORS) }
}

/** Re-deals this many times when a grid is given and no piece of the deal fits. */
export const DEAL_ATTEMPTS = 3

/**
 * Deals a tray of random pieces. With a grid, it re-deals a few times when none
 * of the pieces would fit (it softens, but doesn't rule out, a game over on the deal).
 */
export function dealPieces(rng: Rng, grid?: Grid, count = TRAY_SIZE): Piece[] {
  let pieces: Piece[] = []
  for (let attempt = 0; attempt < (grid ? DEAL_ATTEMPTS : 1); attempt++) {
    pieces = Array.from({ length: count }, () => randomPiece(rng))
    if (!grid || anyFits(grid, pieces.map((p) => p.shape))) break
  }
  return pieces
}
