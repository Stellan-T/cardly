import { describe, expect, it } from 'vitest'
import {
  GRID_SIZE,
  PIECE_COLORS,
  SHAPES,
  anyFits,
  canPlace,
  dealPieces,
  emptyGrid,
  findFit,
  isGameOver,
  linesCleared,
  nextCombo,
  place,
  scoreFor,
  shapeById,
  type Piece,
} from './blocks'
import { createRng } from './random'

/** "#" = filled (colour 1), "." = empty. */
const gridFrom = (rows: string[]) => rows.map((line) => [...line].map((ch) => (ch === '#' ? 1 : 0)))
const asText = (grid: readonly (readonly number[])[]) => grid.map((r) => r.map((v) => (v ? '#' : '.')).join(''))
const piece = (id: string): Piece => ({ shape: shapeById(id), color: 1 })

const dot = shapeById('dot-0')
const line2h = shapeById('i2-0')
const line3h = shapeById('i3-0')
const line5h = shapeById('i5-0')
const line5v = shapeById('i5-1')
const square2 = shapeById('o2-0')

describe('shapes', () => {
  it('includes the classic shapes in every distinct rotation', () => {
    const ids = SHAPES.map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['dot-0', 'o2-0', 'o3-0']))
    for (const n of [2, 3, 4, 5]) {
      const lines = SHAPES.filter((s) => s.id.startsWith(`i${n}-`))
      expect(lines.map((s) => [s.rows, s.cols])).toEqual([
        [1, n],
        [n, 1],
      ])
    }
    for (const key of ['l', 'j', 't']) expect(SHAPES.filter((s) => s.id.startsWith(`${key}-`))).toHaveLength(4)
    for (const key of ['s', 'z']) expect(SHAPES.filter((s) => s.id.startsWith(`${key}-`))).toHaveLength(2)
  })

  it('normalises every shape to its bounding box with unique cells', () => {
    for (const s of SHAPES) {
      expect(Math.min(...s.cells.map(([r]) => r))).toBe(0)
      expect(Math.min(...s.cells.map(([, c]) => c))).toBe(0)
      expect(Math.max(...s.cells.map(([r]) => r))).toBe(s.rows - 1)
      expect(Math.max(...s.cells.map(([, c]) => c))).toBe(s.cols - 1)
      expect(new Set(s.cells.map(([r, c]) => `${r},${c}`)).size).toBe(s.cells.length)
    }
  })
})

describe('placement', () => {
  it('starts with an empty 8×8 grid', () => {
    const g = emptyGrid()
    expect(g).toHaveLength(GRID_SIZE)
    expect(g.every((r) => r.length === GRID_SIZE && r.every((v) => v === 0))).toBe(true)
  })

  it('rejects positions that go off the grid', () => {
    const g = emptyGrid()
    expect(canPlace(g, line5h, 0, 3)).toBe(true)
    expect(canPlace(g, line5h, 0, 4)).toBe(false)
    expect(canPlace(g, line5v, 3, 0)).toBe(true)
    expect(canPlace(g, line5v, 4, 0)).toBe(false)
    expect(canPlace(g, dot, -1, 0)).toBe(false)
    expect(canPlace(g, dot, 0, -1)).toBe(false)
    expect(canPlace(g, dot, 7, 7)).toBe(true)
    expect(canPlace(g, dot, 8, 0)).toBe(false)
  })

  it('rejects overlap but only checks the shape’s own cells', () => {
    const g = gridFrom(['.#......', '........', '........', '........', '........', '........', '........', '........'])
    expect(canPlace(g, square2, 0, 0)).toBe(false)
    expect(canPlace(g, square2, 0, 1)).toBe(false)
    expect(canPlace(g, square2, 1, 0)).toBe(true)
    expect(canPlace(g, line3h, 0, 0)).toBe(false)
    // The small corner "#./##" leaves its top-right cell open, so it can wrap around the block.
    const corner = shapeById('v3-0')
    expect(corner.cells).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
    expect(canPlace(g, corner, 0, 0)).toBe(true)
    expect(canPlace(g, corner, 0, 1)).toBe(false)
  })

  it('places a piece without mutating the input grid', () => {
    const g = emptyGrid()
    const res = place(g, square2, 2, 3, 5)
    expect(res.cellsPlaced).toBe(4)
    expect(res.clearedRows).toEqual([])
    expect(res.clearedCols).toEqual([])
    expect(res.grid[2][3]).toBe(5)
    expect(res.grid[3][4]).toBe(5)
    expect(res.grid[2][2]).toBe(0)
    expect(g[2][3]).toBe(0)
  })

  it('throws when the piece does not fit', () => {
    expect(() => place(emptyGrid(), line5h, 0, 6)).toThrow(RangeError)
    const g = place(emptyGrid(), dot, 0, 0).grid
    expect(() => place(g, line2h, 0, 0)).toThrow(RangeError)
  })
})

describe('clearing lines', () => {
  it('clears a full row', () => {
    const g = gridFrom([
      '#.......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '######..',
    ])
    const res = place(g, line2h, 7, 6)
    expect(res.clearedRows).toEqual([7])
    expect(res.clearedCols).toEqual([])
    expect(linesCleared(res)).toBe(1)
    expect(asText(res.grid)).toEqual(['#.......', ...Array(7).fill('........')])
  })

  it('clears a full column', () => {
    const g = gridFrom([
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '........',
      '........',
      '......##',
    ])
    const res = place(g, shapeById('i3-1'), 5, 2)
    expect(res.clearedRows).toEqual([])
    expect(res.clearedCols).toEqual([2])
    expect(asText(res.grid)).toEqual([...Array(7).fill('........'), '......##'])
  })

  it('clears a row and a column at once, sharing a cell', () => {
    const g = gridFrom([
      '.#######',
      '#.......',
      '#.......',
      '#....#..',
      '#.......',
      '#.......',
      '#.......',
      '#.......',
    ])
    const res = place(g, dot, 0, 0)
    expect(res.clearedRows).toEqual([0])
    expect(res.clearedCols).toEqual([0])
    expect(linesCleared(res)).toBe(2)
    expect(res.cellsPlaced).toBe(1)
    expect(asText(res.grid)).toEqual([
      '........',
      '........',
      '........',
      '.....#..',
      '........',
      '........',
      '........',
      '........',
    ])
  })

  it('clears several rows at once', () => {
    const g = gridFrom([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '######..',
      '######..',
    ])
    const res = place(g, square2, 6, 6)
    expect(res.clearedRows).toEqual([6, 7])
    expect(res.clearedCols).toEqual([])
    expect(res.grid.flat().every((v) => v === 0)).toBe(true)
  })
})

describe('scoring', () => {
  it('awards a point per cell placed', () => {
    expect(scoreFor(1, 0, 0)).toBe(1)
    expect(scoreFor(4, 0, 0)).toBe(4)
  })

  it('awards points per cleared line', () => {
    expect(scoreFor(2, 1, 1)).toBe(2 + 10)
  })

  it('gives a bonus for clearing several lines at once', () => {
    expect(scoreFor(1, 2, 1)).toBe(1 + 40)
    expect(scoreFor(1, 3, 1)).toBe(1 + 90)
    expect(scoreFor(1, 2, 1) - 1).toBeGreaterThan(2 * (scoreFor(1, 1, 1) - 1))
  })

  it('gives a combo bonus for consecutive clears', () => {
    expect(scoreFor(3, 1, 2)).toBe(3 + 10 + 10)
    expect(scoreFor(3, 1, 3)).toBe(3 + 10 + 20)
    expect(scoreFor(3, 2, 3)).toBe(3 + 40 + 40)
    expect(scoreFor(3, 1, 3)).toBeGreaterThan(scoreFor(3, 1, 2))
    // No lines: no combo bonus.
    expect(scoreFor(3, 0, 5)).toBe(3)
  })

  it('counts consecutive clears and resets after a placement that clears nothing', () => {
    let combo = 0
    combo = nextCombo(combo, 1)
    expect(combo).toBe(1)
    combo = nextCombo(combo, 2)
    expect(combo).toBe(2)
    combo = nextCombo(combo, 0)
    expect(combo).toBe(0)
  })
})

describe('game over', () => {
  // Every empty cell is isolated: only a single block fits.
  const checker = gridFrom([
    '.#.#.#.#',
    '#.###.##',
    '.#.#.#.#',
    '###.###.',
    '.#.#.#.#',
    '#.###.##',
    '.#.#.#.#',
    '###.###.',
  ])

  it('is over when no tray piece fits anywhere', () => {
    expect(anyFits(checker, [square2, line2h, line3h])).toBe(false)
    expect(isGameOver(checker, [piece('o2-0'), piece('i2-0'), piece('i2-1')])).toBe(true)
    expect(isGameOver(checker, [null, piece('i3-0'), null])).toBe(true)
  })

  it('is not over when at least one tray piece fits', () => {
    expect(anyFits(checker, [square2, dot])).toBe(true)
    expect(findFit(checker, dot)).toEqual([0, 0])
    expect(isGameOver(checker, [piece('o2-0'), piece('dot-0'), null])).toBe(false)
    expect(isGameOver(emptyGrid(), [piece('o3-0'), piece('i5-0'), piece('i5-1')])).toBe(false)
  })

  it('is not over while the tray is empty (waiting for a question)', () => {
    expect(isGameOver(checker, [null, null, null])).toBe(false)
  })

  it('finds space that only a large piece needs', () => {
    const g = gridFrom([
      '########',
      '########',
      '###...##',
      '###...##',
      '###...##',
      '########',
      '########',
      '########',
    ])
    expect(findFit(g, shapeById('o3-0'))).toEqual([2, 3])
    expect(findFit(g, line5h)).toBeNull()
    expect(isGameOver(g, [piece('i5-0'), piece('o3-0'), null])).toBe(false)
    expect(isGameOver(g, [piece('i5-0'), piece('i4-1'), null])).toBe(true)
  })
})

describe('dealing', () => {
  const ids = (pieces: Piece[]) => pieces.map((p) => `${p.shape.id}:${p.color}`)

  it('deals three valid pieces', () => {
    const pieces = dealPieces(createRng(7))
    expect(pieces).toHaveLength(3)
    for (const p of pieces) {
      expect(SHAPES).toContain(p.shape)
      expect(p.color).toBeGreaterThanOrEqual(1)
      expect(p.color).toBeLessThanOrEqual(PIECE_COLORS)
    }
  })

  it('is deterministic for a seed', () => {
    const a = createRng(1234)
    const b = createRng(1234)
    for (let i = 0; i < 5; i++) expect(ids(dealPieces(a))).toEqual(ids(dealPieces(b)))
  })

  it('differs between seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 5 }, () => ids(dealPieces(a))).flat()
    const seqB = Array.from({ length: 5 }, () => ids(dealPieces(b))).flat()
    expect(seqA).not.toEqual(seqB)
  })

  it('deals a variety of shapes over time', () => {
    const rng = createRng(99)
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) for (const p of dealPieces(rng)) seen.add(p.shape.id.split('-')[0])
    expect(seen.size).toBeGreaterThanOrEqual(12)
  })

  it('prefers a deal that fits when given the grid', () => {
    // Only a single block fits on this grid.
    const g = gridFrom([
      '.#.#.#.#',
      '#.###.##',
      '.#.#.#.#',
      '###.###.',
      '.#.#.#.#',
      '#.###.##',
      '.#.#.#.#',
      '###.###.',
    ])
    let fitsWithGrid = 0
    let fitsBlind = 0
    for (let seed = 1; seed <= 300; seed++) {
      if (anyFits(g, dealPieces(createRng(seed), g).map((p) => p.shape))) fitsWithGrid++
      if (anyFits(g, dealPieces(createRng(seed)).map((p) => p.shape))) fitsBlind++
    }
    expect(fitsWithGrid).toBeGreaterThan(fitsBlind)
    // Deterministic with a grid too.
    expect(ids(dealPieces(createRng(5), g))).toEqual(ids(dealPieces(createRng(5), g)))
  })
})
