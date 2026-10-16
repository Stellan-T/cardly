/**
 * Turns pasted notes or uploaded text into flashcards.
 *
 * Pure and synchronous so it can run on every keystroke for the live preview.
 * The rules (see README "Import format"):
 *  - normalise line endings, strip a BOM, ignore blank lines
 *  - strip list markers (-, *, •, 1., 1), a), (1), [ ], >) and **bold** around terms
 *  - split each card on the FIRST term/definition separator only
 *  - auto-detect separators by how many lines contain them, preferring
 *    tab > colon > dash > equals > comma; colons in URLs, times and ratios don't count
 *  - a separator-less line right after a card continues that card's definition
 *  - headings are not cards (optionally used as tags)
 */
import Papa from 'papaparse'

export type TermSepOption = 'auto' | 'tab' | 'comma' | 'colon' | 'dash' | 'equals' | 'custom'
export type CardSepOption = 'auto' | 'newline' | 'semicolon' | 'custom'

export interface ParseOptions {
  termSep?: TermSepOption
  cardSep?: CardSepOption
  /** Used when termSep is "custom". "\t" and "\n" escapes are understood. */
  customTermSep?: string
  /** Used when cardSep is "custom". "\t" and "\n" escapes are understood. */
  customCardSep?: string
  /** Attach the most recent heading to each card as a tag. */
  headingsAsTags?: boolean
}

export type DetectedTermSep =
  | 'tab'
  | 'colon'
  | 'dash'
  | 'equals'
  | 'arrow'
  | 'semicolon'
  | 'comma'
  | 'custom'
  | 'linebreak'
  | 'none'
export type DetectedCardSep = 'newline' | 'semicolon' | 'custom' | 'blankline'

export interface ParsedCard {
  term: string
  definition: string
  /** 1-based line number where the card starts. */
  sourceLine: number
  /** The card's first line as written (list markers removed), used to undo a split. */
  raw?: string
  /** Lines appended to the definition because they had no separator (multi-line definitions). */
  mergedLines?: number[]
  tags?: string[]
}

export type WarningKind =
  | 'empty-term'
  | 'empty-definition'
  | 'duplicate'
  | 'term-too-long'
  | 'definition-too-long'
  | 'merged'
  | 'mixed-separator'
  | 'header-row'

export interface ParseWarning {
  /** 1-based source line. */
  line: number
  kind: WarningKind
  message: string
  /** Index into `cards` when the warning belongs to a card. */
  cardIndex?: number
}

export interface ParseResult {
  cards: ParsedCard[]
  warnings: ParseWarning[]
  detected: {
    termSep: DetectedTermSep
    cardSep: DetectedCardSep
    /** The literal separators used when they were custom (or auto-detected symbol runs). */
    customTermSep?: string
    customCardSep?: string
  }
  /** Headings found in the text, in order (the first one makes a good title). */
  headings: string[]
}

export const MAX_TERM_LENGTH = 1000
export const MAX_DEFINITION_LENGTH = 10000

export const TERM_SEP_LABELS: Record<DetectedTermSep, string> = {
  tab: 'Tab',
  colon: 'Colon (:)',
  dash: 'Dash ( - / – / — )',
  equals: 'Equals (=)',
  arrow: 'Arrow (→)',
  semicolon: 'Semicolon',
  comma: 'Comma',
  custom: 'Custom',
  linebreak: 'Line break (blank line between cards)',
  none: 'None found',
}

export const CARD_SEP_LABELS: Record<DetectedCardSep, string> = {
  newline: 'New line',
  semicolon: 'Semicolon',
  custom: 'Custom',
  blankline: 'Blank line',
}

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

interface Split {
  term: string
  definition: string
}

type SepKind = Exclude<DetectedTermSep, 'custom' | 'linebreak' | 'none'>

/** Index and length of the first usable colon, skipping URLs, times, ratios and drive letters. */
export function findColon(text: string): { index: number; length: number } | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== ':' && ch !== '：') continue
    if (ch === '：') return { index: i, length: 1 }
    const before = text[i - 1] ?? ''
    const after = text[i + 1] ?? ''
    // URL scheme (http://, https://, ftp://) or mailto:/tel:
    if (text.startsWith('//', i + 1)) continue
    if (/(?:^|[^\p{L}])(?:mailto|tel)$/iu.test(text.slice(Math.max(0, i - 7), i))) continue
    // Time (12:30), ratio (3:1), verse (3:16)
    if (/\d/.test(before) && /\d/.test(after)) continue
    // Windows drive letter (C:\)
    if (after === '\\' && /^[A-Za-z]$/.test(before) && !/[\p{L}]/u.test(text[i - 2] ?? '')) continue
    return { index: i, length: 1 }
  }
  return null
}

const DASH_RE = /[ \t\u00A0]+(?:--?|–|—)[ \t\u00A0]+/
const EQUALS_RE = /[ \t\u00A0]*(?<![=<>!])=(?![=>])[ \t\u00A0]*/
const ARROW_RE = /[ \t\u00A0]*(?:->|→|=>|⟶|⇒)[ \t\u00A0]*/
const TAB_RE = /\t+/

function splitAt(text: string, index: number, length: number): Split {
  return { term: text.slice(0, index), definition: text.slice(index + length) }
}

function splitRegex(text: string, re: RegExp): Split | null {
  const m = re.exec(text)
  return m ? splitAt(text, m.index, m[0].length) : null
}

export function splitBy(text: string, sep: SepKind | { custom: string }): Split | null {
  if (typeof sep === 'object') {
    if (!sep.custom) return null
    const i = text.indexOf(sep.custom)
    return i >= 0 ? splitAt(text, i, sep.custom.length) : null
  }
  switch (sep) {
    case 'tab': {
      const m = TAB_RE.exec(text)
      return m ? splitAt(text, m.index, m[0].length) : null
    }
    case 'colon': {
      const c = findColon(text)
      return c ? splitAt(text, c.index, c.length) : null
    }
    case 'dash':
      return splitRegex(text, DASH_RE)
    case 'equals':
      return splitRegex(text, EQUALS_RE)
    case 'arrow':
      return splitRegex(text, ARROW_RE)
    case 'semicolon': {
      const i = text.indexOf(';')
      return i >= 0 ? splitAt(text, i, 1) : null
    }
    case 'comma': {
      const i = text.indexOf(',')
      return i >= 0 ? splitAt(text, i, 1) : null
    }
  }
}

/** Auto-detect order and weights: a higher weight wins near-ties ("tab > colon > dash > equals > comma"). */
const AUTO_CANDIDATES: { sep: SepKind; weight: number; strong: boolean }[] = [
  { sep: 'tab', weight: 1, strong: true },
  { sep: 'colon', weight: 0.97, strong: true },
  { sep: 'dash', weight: 0.94, strong: true },
  { sep: 'equals', weight: 0.91, strong: true },
  { sep: 'arrow', weight: 0.88, strong: false },
  { sep: 'semicolon', weight: 0.7, strong: false },
  { sep: 'comma', weight: 0.6, strong: false },
]

// ---------------------------------------------------------------------------
// Line clean-up
// ---------------------------------------------------------------------------

const MARKER_RES: RegExp[] = [
  /^>[ \t]?/, // blockquote
  /^[-*+•·▪◦‣●○■□➢➤►–—][ \t\u00A0]+/, // bullets
  /^\[[ xX✓✔]?\][ \t\u00A0]+/, // checkboxes
  /^\d{1,3}[.)][ \t\u00A0]+/, // 1. 1)
  /^\(\d{1,3}\)[ \t\u00A0]+/, // (1)
  /^[a-zA-Z]\)[ \t\u00A0]+/, // a)
  /^\([a-zA-Z]\)[ \t\u00A0]+/, // (a)
]

export function stripMarkers(line: string): { text: string; hadMarker: boolean } {
  let text = line.replace(/^[ \t\u00A0]+/, '')
  let hadMarker = false
  for (let guard = 0; guard < 4; guard++) {
    let changed = false
    for (const re of MARKER_RES) {
      const m = re.exec(text)
      if (m) {
        text = text.slice(m[0].length).replace(/^[ \t\u00A0]+/, '')
        hadMarker = true
        changed = true
      }
    }
    if (!changed) break
  }
  // **Term**: definition  /  __Term__ - definition  /  **Term:** definition
  const bold = /^(\*\*|__)(.+?)\1/.exec(text)
  if (bold) text = bold[2] + text.slice(bold[0].length)
  return { text, hadMarker }
}

function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ' || ch === '\u00A0') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

/** Collapse runs of spaces/tabs inside each line and trim; keep line breaks. */
export function cleanText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t\u00A0]+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function cleanTerm(text: string): string {
  let t = cleanText(text)
  // Leftover bold markers around a term, e.g. "**Term** : def" already handled; "Term**" edge cases:
  t = t.replace(/^(\*\*|__)(.*)\1$/, '$2').trim()
  return t
}

function unescapeSep(sep: string | undefined): string {
  return (sep ?? '').replace(/\\t/g, '\t').replace(/\\n/g, '\n')
}

const MD_HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t#]*$/

const HEADER_ROWS = new Set([
  'term|definition',
  'terms|definitions',
  'front|back',
  'word|meaning',
  'word|definition',
  'question|answer',
  'questions|answers',
  'term|meaning',
  'begrip|definitie',
  'term|betekenis',
  'woord|betekenis',
  'vraag|antwoord',
])

// ---------------------------------------------------------------------------
// Chunking (between cards)
// ---------------------------------------------------------------------------

interface Chunk {
  /** Raw text of the chunk (one line in newline mode; may contain newlines otherwise). */
  raw: string
  line: number
  blank: boolean
}

/** Returns a function mapping a character offset to its 1-based line number (binary search). */
function lineLookup(text: string): (index: number) => number {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (index) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function chunkByLines(text: string): Chunk[] {
  return text.split('\n').map((raw, i) => ({ raw, line: i + 1, blank: raw.trim() === '' }))
}

function chunkBySeparator(text: string, sep: string): Chunk[] {
  const lineAt = lineLookup(text)
  const chunks: Chunk[] = []
  let start = 0
  while (start <= text.length) {
    const idx = sep ? text.indexOf(sep, start) : -1
    const end = idx === -1 ? text.length : idx
    const piece = text.slice(start, end)
    const leading = piece.length - piece.replace(/^\s+/, '').length
    chunks.push({ raw: piece.trim(), line: lineAt(start + leading), blank: piece.trim() === '' })
    if (idx === -1) break
    start = idx + sep.length
  }
  return chunks.filter((c) => !c.blank)
}

/** Characters whose repeated runs ("##", "||", "$$") are treated as possible custom separators. */
const SYMBOL_SEP_CHARS = '#|$@%^&+;~'

/** Detects custom symbol separators such as "term##definition####term##definition". */
function detectSymbolSeparators(text: string, nonBlankLines: number): { term?: string; card?: string } | null {
  const runs = new Map<string, Map<number, number>>()
  for (const m of text.matchAll(/([^\p{L}\p{N}\s])\1+/gu)) {
    const ch = m[1]
    if (!SYMBOL_SEP_CHARS.includes(ch)) continue
    const at = m.index ?? 0
    const lineStart = at === 0 || text[at - 1] === '\n'
    if (ch === '#' && lineStart && /^#+[ \t]/.test(text.slice(at))) continue // markdown heading
    const byLen = runs.get(ch) ?? new Map<number, number>()
    byLen.set(m[0].length, (byLen.get(m[0].length) ?? 0) + 1)
    runs.set(ch, byLen)
  }
  let best: { term?: string; card?: string; score: number } | null = null
  for (const [ch, byLen] of runs) {
    const lengths = [...byLen.keys()].sort((a, b) => a - b)
    const total = [...byLen.values()].reduce((a, b) => a + b, 0)
    if (lengths.length >= 2) {
      const term = ch.repeat(lengths[0])
      const card = ch.repeat(lengths[lengths.length - 1])
      const pieces = text.split(card).filter((p) => p.trim())
      const withTerm = pieces.filter((p) => p.includes(term)).length
      if (pieces.length >= 2 && withTerm / pieces.length >= 0.6) {
        const score = total + 100
        if (!best || score > best.score) best = { term, card, score }
      }
    } else {
      const count = byLen.get(lengths[0]) ?? 0
      const term = ch.repeat(lengths[0])
      const linesWith = text.split('\n').filter((l) => l.includes(term)).length
      if (count >= 1 && linesWith / Math.max(1, nonBlankLines) >= 0.5) {
        if (!best || count > best.score) best = { term, score: count }
      }
    }
  }
  return best ? { term: best.term, card: best.card } : null
}

function looksSemicolonSeparated(text: string, nonBlank: string[]): boolean {
  if (nonBlank.length > 2) return false
  const pieces = text.split(';').map((p) => p.trim()).filter(Boolean)
  if (pieces.length < 2) return false
  const withSep = pieces.filter((p) =>
    AUTO_CANDIDATES.some((c) => c.sep !== 'semicolon' && splitBy(p, c.sep) !== null),
  ).length
  return withSep / pieces.length >= 0.6
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

interface Prepared {
  chunk: Chunk
  text: string
  indent: number
  hadMarker: boolean
  heading: string | null
}

function prepare(chunk: Chunk): Prepared {
  if (chunk.blank) return { chunk, text: '', indent: 0, hadMarker: false, heading: null }
  const indent = indentOf(chunk.raw)
  const trimmed = chunk.raw.trim()
  const md = MD_HEADING_RE.exec(trimmed)
  if (md && trimmed.startsWith('#')) {
    return { chunk, text: trimmed, indent, hadMarker: false, heading: cleanText(md[1]) }
  }
  const { text, hadMarker } = stripMarkers(chunk.raw)
  if (!text.trim()) return { chunk: { ...chunk, blank: true }, text: '', indent: 0, hadMarker: false, heading: null }
  return { chunk, text, indent, hadMarker, heading: null }
}

export function parseImport(input: string, options: ParseOptions = {}): ParseResult {
  const termOpt = options.termSep ?? 'auto'
  const cardOpt = options.cardSep ?? 'auto'
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const nonBlank = text.split('\n').filter((l) => l.trim() !== '')

  const empty: ParseResult = {
    cards: [],
    warnings: [],
    detected: { termSep: 'none', cardSep: 'newline' },
    headings: [],
  }
  if (nonBlank.length === 0) return empty

  // ---- 1. Card separator -------------------------------------------------
  let cardSep: DetectedCardSep = 'newline'
  let customCard: string | undefined
  let customTerm: string | undefined
  let symbolTerm: string | undefined

  if (cardOpt === 'semicolon') cardSep = 'semicolon'
  else if (cardOpt === 'custom') {
    customCard = unescapeSep(options.customCardSep)
    cardSep = customCard === '\n' || customCard === '' ? 'newline' : 'custom'
  } else if (cardOpt === 'auto') {
    const symbols = termOpt === 'auto' ? detectSymbolSeparators(text, nonBlank.length) : null
    if (symbols?.card) {
      cardSep = 'custom'
      customCard = symbols.card
      symbolTerm = symbols.term
    } else if (symbols?.term) {
      symbolTerm = symbols.term
    } else if (looksSemicolonSeparated(text, nonBlank)) {
      cardSep = 'semicolon'
    }
  }

  const chunks: Chunk[] =
    cardSep === 'newline'
      ? chunkByLines(text)
      : chunkBySeparator(text, cardSep === 'semicolon' ? ';' : (customCard ?? ''))

  // ---- 2. Term separator -------------------------------------------------
  const prepared = chunks.map(prepare)
  const content = prepared.filter((p) => !p.chunk.blank && p.heading === null)

  let termSep: DetectedTermSep
  let primary: SepKind | { custom: string } | null = null
  if (termOpt === 'custom') {
    customTerm = unescapeSep(options.customTermSep)
    termSep = 'custom'
    primary = { custom: customTerm }
  } else if (termOpt !== 'auto') {
    termSep = termOpt
    primary = termOpt
  } else if (symbolTerm) {
    termSep = 'custom'
    customTerm = symbolTerm
    primary = { custom: symbolTerm }
  } else {
    let bestScore = 0
    let best: SepKind | null = null
    for (const cand of AUTO_CANDIDATES) {
      if (cand.sep === 'semicolon' && cardSep === 'semicolon') continue
      const hits = content.filter((p) => splitBy(p.text, cand.sep) !== null).length
      const score = (hits / Math.max(1, content.length)) * cand.weight
      if (score > bestScore + 1e-9) {
        bestScore = score
        best = cand.sep
      }
    }
    if (best && bestScore >= 0.2) {
      termSep = best
      primary = best
    } else {
      termSep = 'none'
    }
  }

  // Blank-line blocks: "Term\nDefinition\n\nTerm\nDefinition"
  if (termSep === 'none' && cardSep === 'newline' && termOpt === 'auto') {
    const blocks = text
      .split(/\n[ \t]*\n+/)
      .map((b) => b.replace(/^\n+|\n+$/g, ''))
      .filter((b) => b.trim())
    const multi = blocks.filter((b) => b.split('\n').filter((l) => l.trim()).length >= 2).length
    if (blocks.length >= 2 && multi / blocks.length >= 0.7) {
      return finish(parseBlocks(text), { termSep: 'linebreak', cardSep: 'blankline' }, [], options)
    }
  }

  // ---- 3. Build cards ------------------------------------------------------
  const useCsv =
    cardSep === 'newline' &&
    (termSep === 'comma' || (termSep === 'tab' && /(^|\n)"/.test(text))) &&
    /"/.test(text)

  const rows: Row[] = useCsv
    ? csvRows(text, termSep === 'tab' ? '\t' : ',')
    : prepared.map((p) => ({ ...p, split: p.heading !== null || p.chunk.blank || !primary ? null : splitBy(p.text, primary) }))

  const headings: string[] = []
  const cards: ParsedCard[] = []
  const warnings: ParseWarning[] = []
  let currentHeading: string | null = null
  let prev: { card: ParsedCard; indent: number } | null = null
  let blankSincePrev = false

  const strongSecondaries = AUTO_CANDIDATES.filter((c) => c.strong && c.sep !== primary)

  const nextContentRow = (from: number): Row | undefined => {
    for (let j = from + 1; j < rows.length; j++) if (!rows[j].chunk.blank) return rows[j]
    return undefined
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.chunk.blank) {
      blankSincePrev = true
      continue
    }
    const line = row.chunk.line

    if (row.heading !== null) {
      headings.push(row.heading)
      currentHeading = row.heading
      prev = null
      blankSincePrev = false
      continue
    }

    // "Chapter 4:" directly followed by cards is a heading, even right after a card.
    if (/[:：]\s*$/.test(row.text) && cleanTerm(row.text).length <= 61 && (!row.split || !cleanText(row.split.definition))) {
      const next = nextContentRow(i)
      if (next && next.split && !(prev && !blankSincePrev && row.indent > prev.indent)) {
        const heading = cleanTerm(row.text).replace(/[:：]\s*$/, '').trim()
        headings.push(heading)
        currentHeading = heading
        prev = null
        blankSincePrev = false
        continue
      }
    }

    const deeper = prev !== null && !blankSincePrev && row.indent > prev.indent && cardSep === 'newline'

    let split = row.split
    let mixed = false
    if (!split && !deeper && primary && !useCsv) {
      for (const cand of strongSecondaries) {
        const s = splitBy(row.text, cand.sep)
        if (s && cleanText(s.term).length <= 80 && cleanText(s.definition)) {
          split = s
          mixed = true
          break
        }
      }
    }

    const isContinuation = prev !== null && !blankSincePrev && cardSep === 'newline' && (deeper || !split)

    if (isContinuation && prev) {
      const addition = cleanText(deeper ? row.chunk.raw.trim() : row.text)
      prev.card.definition = prev.card.definition ? `${prev.card.definition}\n${addition}` : addition
      prev.card.mergedLines = [...(prev.card.mergedLines ?? []), line]
      continue
    }

    if (split) {
      const term = cleanTerm(split.term)
      const definition = cleanText(split.definition)
      const card: ParsedCard = { term, definition, sourceLine: line, raw: cleanText(row.text) }
      if (options.headingsAsTags && currentHeading) card.tags = [currentHeading]
      cards.push(card)
      if (mixed) {
        warnings.push({
          line,
          kind: 'mixed-separator',
          message: 'Split on a different separator than the rest of the text.',
        })
      }
      prev = { card, indent: row.indent }
      blankSincePrev = false
      continue
    }

    // A line without a separator that doesn't continue a card.
    const textClean = cleanTerm(row.text)
    const next = nextContentRow(i)
    if (textClean.length <= 80 && next && next.split && primary) {
      const heading = textClean.replace(/[:：]\s*$/, '')
      headings.push(heading)
      currentHeading = heading
      prev = null
      blankSincePrev = false
      continue
    }
    const card: ParsedCard = { term: textClean, definition: '', sourceLine: line, raw: textClean }
    if (options.headingsAsTags && currentHeading) card.tags = [currentHeading]
    cards.push(card)
    prev = { card, indent: row.indent }
    blankSincePrev = false
  }

  return finish(
    cards,
    { termSep, cardSep, customTermSep: customTerm, customCardSep: customCard },
    headings,
    options,
    warnings,
  )
}

interface Row {
  chunk: Chunk
  text: string
  indent: number
  hadMarker: boolean
  heading: string | null
  split: Split | null
}

function csvRows(text: string, delimiter: string): Row[] {
  const rows: Row[] = []
  // Map character offsets to line numbers by tracking the parser cursor.
  let lastCursor = 0
  const lineAt = lineLookup(text)
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    step: (result) => {
      const cursor = result.meta.cursor
      const startLine = lineAt(lastCursor)
      lastCursor = cursor
      const fields = result.data
      const nonEmpty = fields.some((f) => f.trim() !== '')
      if (!nonEmpty) {
        rows.push({ chunk: { raw: '', line: startLine, blank: true }, text: '', indent: 0, hadMarker: false, heading: null, split: null })
        return
      }
      const first = fields[0] ?? ''
      const { text: firstClean, hadMarker } = stripMarkers(first)
      const raw = fields.join(delimiter)
      if (fields.length === 1 || fields.slice(1).every((f) => f.trim() === '')) {
        const md = MD_HEADING_RE.exec(first.trim())
        rows.push({
          chunk: { raw, line: startLine, blank: false },
          text: firstClean,
          indent: indentOf(first),
          hadMarker,
          heading: md && first.trim().startsWith('#') ? cleanText(md[1]) : null,
          split: null,
        })
        return
      }
      rows.push({
        chunk: { raw, line: startLine, blank: false },
        text: firstClean,
        indent: indentOf(first),
        hadMarker,
        heading: null,
        split: { term: firstClean, definition: fields.slice(1).join(delimiter === '\t' ? ' ' : ',') },
      })
    },
  })
  return rows
}

function parseBlocks(text: string): ParsedCard[] {
  const cards: ParsedCard[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break
    const start = i
    const block: string[] = []
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++])
    const term = cleanTerm(stripMarkers(block[0]).text)
    const definition = cleanText(block.slice(1).map((l) => stripMarkers(l).text).join('\n'))
    cards.push({ term, definition, sourceLine: start + 1, raw: term })
  }
  return cards
}

function finish(
  rawCards: ParsedCard[],
  detected: ParseResult['detected'],
  headings: string[],
  options: ParseOptions,
  warnings: ParseWarning[] = [],
): ParseResult {
  let cards = rawCards
  // Header row ("term,definition") from spreadsheets.
  if (cards.length > 1) {
    const key = `${cards[0].term.toLowerCase()}|${cards[0].definition.toLowerCase()}`
    if (HEADER_ROWS.has(key)) {
      warnings.push({ line: cards[0].sourceLine, kind: 'header-row', message: 'Skipped a header row.' })
      cards = cards.slice(1)
    }
  }
  if (!options.headingsAsTags) for (const c of cards) delete c.tags
  return { cards, warnings: [...warnings, ...validateCards(cards)], detected, headings }
}

/** Per-card problems: empty sides, duplicates, over-long fields, merged lines. */
export function validateCards(cards: Pick<ParsedCard, 'term' | 'definition' | 'sourceLine' | 'mergedLines'>[]): ParseWarning[] {
  const warnings: ParseWarning[] = []
  const seen = new Map<string, number>()
  cards.forEach((card, cardIndex) => {
    const line = card.sourceLine
    if (!card.term.trim()) warnings.push({ line, cardIndex, kind: 'empty-term', message: 'Missing term.' })
    if (!card.definition.trim())
      warnings.push({ line, cardIndex, kind: 'empty-definition', message: 'Missing definition.' })
    if (card.term.length > MAX_TERM_LENGTH)
      warnings.push({
        line,
        cardIndex,
        kind: 'term-too-long',
        message: `Term is longer than ${MAX_TERM_LENGTH.toLocaleString()} characters.`,
      })
    if (card.definition.length > MAX_DEFINITION_LENGTH)
      warnings.push({
        line,
        cardIndex,
        kind: 'definition-too-long',
        message: `Definition is longer than ${MAX_DEFINITION_LENGTH.toLocaleString()} characters.`,
      })
    const key = card.term.trim().toLowerCase()
    if (key) {
      const first = seen.get(key)
      if (first !== undefined)
        warnings.push({ line, cardIndex, kind: 'duplicate', message: `Duplicate of card ${first + 1}.` })
      else seen.set(key, cardIndex)
    }
    if (card.mergedLines?.length)
      warnings.push({
        line,
        cardIndex,
        kind: 'merged',
        message: `Joined ${card.mergedLines.length} following line${card.mergedLines.length > 1 ? 's' : ''} into the definition.`,
      })
  })
  return warnings
}

/** Warning kinds that are problems (as opposed to information about what the parser did). */
export const PROBLEM_KINDS: ReadonlySet<WarningKind> = new Set([
  'empty-term',
  'empty-definition',
  'duplicate',
  'term-too-long',
  'definition-too-long',
])
