/** Row operations for the import preview (pure, unit-tested). */
import {
  splitBy,
  validateCards,
  type DetectedTermSep,
  type ParseResult,
  type ParseWarning,
} from '../../lib/parseImport'
import { randomId } from '../../lib/random'

export interface ImportRow {
  key: string
  term: string
  definition: string
  sourceLine: number
  raw?: string
  mergedLines?: number[]
  tags?: string[]
  edited?: boolean
}

export function rowsFromResult(result: ParseResult): ImportRow[] {
  return result.cards.map((c) => ({ key: randomId(8), ...c }))
}

/** Warnings per row index: card-level validation plus parser notes tied to a line. */
export function rowWarnings(rows: ImportRow[], parseWarnings: ParseWarning[] = []): Map<number, ParseWarning[]> {
  const map = new Map<number, ParseWarning[]>()
  for (const w of validateCards(rows)) {
    if (w.cardIndex === undefined) continue
    map.set(w.cardIndex, [...(map.get(w.cardIndex) ?? []), w])
  }
  for (const w of parseWarnings) {
    if (w.kind !== 'mixed-separator') continue
    const idx = rows.findIndex((r) => r.sourceLine === w.line && !r.edited)
    if (idx >= 0) map.set(idx, [...(map.get(idx) ?? []), w])
  }
  return map
}

/** The text a row stood for in the source, used when joining it into another row. */
function rowText(row: ImportRow): string {
  const first = !row.edited && row.raw ? row.raw : [row.term, row.definition.split('\n')[0]].filter(Boolean).join(': ')
  const rest = row.definition.split('\n').slice(1)
  return [first, ...rest].filter(Boolean).join('\n')
}

/** Joins row i into the definition of row i-1. */
export function mergeWithPrevious(rows: ImportRow[], i: number): ImportRow[] {
  if (i <= 0 || i >= rows.length) return rows
  const prev = rows[i - 1]
  const row = rows[i]
  const merged: ImportRow = {
    ...prev,
    definition: [prev.definition, rowText(row)].filter(Boolean).join('\n'),
    mergedLines: [...(prev.mergedLines ?? []), row.sourceLine, ...(row.mergedLines ?? [])],
  }
  return [...rows.slice(0, i - 1), merged, ...rows.slice(i + 1)]
}

export const mergeWithNext = (rows: ImportRow[], i: number) => mergeWithPrevious(rows, i + 1)

/**
 * Splits a row whose definition spans several lines: the first line stays,
 * every following line becomes its own card (split on the detected separator
 * when possible).
 */
export function splitRow(rows: ImportRow[], i: number, sep: DetectedTermSep, customSep?: string): ImportRow[] {
  const row = rows[i]
  if (!row) return rows
  const lines = row.definition.split('\n')
  if (lines.length < 2) return rows
  const sepKind =
    sep === 'custom' && customSep ? { custom: customSep } : sep === 'custom' || sep === 'linebreak' || sep === 'none' ? null : sep
  const extra: ImportRow[] = lines.slice(1).map((line, j) => {
    const text = line.replace(/^[-*•·▪]\s+/, '').trim()
    const s = sepKind ? splitBy(text, sepKind) : null
    return {
      key: randomId(8),
      term: s ? s.term.trim() : text,
      definition: s ? s.definition.trim() : '',
      sourceLine: row.mergedLines?.[j] ?? row.sourceLine,
      raw: text,
      tags: row.tags,
    }
  })
  const kept: ImportRow = { ...row, definition: lines[0], mergedLines: undefined }
  return [...rows.slice(0, i), kept, ...extra, ...rows.slice(i + 1)]
}

export function swapSides(rows: ImportRow[]): ImportRow[] {
  return rows.map((r) => ({ ...r, term: r.definition, definition: r.term, edited: true }))
}

export function removeDuplicates(rows: ImportRow[]): ImportRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = r.term.trim().toLowerCase()
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
