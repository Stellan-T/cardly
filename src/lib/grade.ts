/**
 * Client-side answer grading with three levels:
 *
 *  - strict:   exact, forgiving only case, punctuation and surrounding whitespace
 *  - moderate: strict + accents (cafe = café) + one or two typos
 *              (distance ≤ 1 for answers ≤ 6 characters, ≤ 2 for longer ones)
 *  - relaxed:  moderate + the same key words in any order, ignoring stopwords
 *              and singular/plural differences (no NLP server: honest word matching)
 *
 * Always: trim, collapse spaces, ignore case and trailing punctuation, treat
 * curly and straight quotes alike, "&" = "and", and accept answers that omit a
 * parenthesised part of the correct answer ("(to) run" accepts "run").
 * Numbers are never "typo-corrected": 1984 ≠ 1948.
 */
import type { GradingLevel } from '../types'

export type GradeReason = 'exact' | 'format' | 'accent' | 'typo' | 'meaning' | 'one-of' | 'wrong' | 'empty'

export interface GradeResult {
  correct: boolean
  reason: GradeReason
  level: GradingLevel
}

export interface GradeOptions {
  level: GradingLevel
  /** If the answer lists several options ("big, large"), any one of them is enough. */
  requireOne?: boolean
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const QUOTES: [RegExp, string][] = [
  [/[‘’‚‛′`´]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
]

/** Case, quotes, "&", whitespace. Keeps punctuation. */
export function baseNormalize(s: string): string {
  let t = s.normalize('NFKC')
  for (const [re, rep] of QUOTES) t = t.replace(re, rep)
  t = t.toLocaleLowerCase()
  t = t.replace(/\s*&\s*/g, ' and ')
  return t.replace(/\s+/g, ' ').trim()
}

const JOIN_PUNCT = /['.]/g
const SPACE_PUNCT = /[,;:!?¿¡"()[\]{}‹›…\-–—/\\|_~·•*]/g

/**
 * Removes punctuation. Punctuation between digits (3.14, 1,000, 1/2, 12:30, -5)
 * is kept so numbers keep their meaning.
 */
export function stripPunctuation(s: string): string {
  const protectedChars: string[] = []
  const guarded = s.replace(/(?<=\d)[.,/:](?=\d)|(?<![\p{L}\p{N}])-(?=\d)/gu, (m) => {
    protectedChars.push(m)
    return `\u0000${protectedChars.length - 1}\u0000`
  })
  const stripped = guarded.replace(JOIN_PUNCT, '').replace(SPACE_PUNCT, ' ').replace(/\s+/g, ' ').trim()
  // eslint-disable-next-line no-control-regex -- \u0000 marks protected characters
  return stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => protectedChars[Number(i)])
}

export function removeDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .normalize('NFC')
}

/** The comparable form of an answer: base normalisation + punctuation removed. */
export function canonical(s: string): string {
  return stripPunctuation(baseNormalize(s))
}

/** Variants of a correct answer: with the parenthesised parts, and without them. */
export function answerVariants(answer: string): string[] {
  const base = baseNormalize(answer)
  const variants = new Set<string>()
  variants.add(canonical(base))
  if (/[()]/.test(base)) {
    variants.add(canonical(base.replace(/\([^()]*\)/g, ' ')))
  }
  return [...variants].filter(Boolean)
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function osaDistance(a: string, b: string, max = Infinity): number {
  const A = [...a]
  const B = [...b]
  if (Math.abs(A.length - B.length) > max) return max + 1
  if (A.length === 0) return B.length
  if (B.length === 0) return A.length
  let prevPrev: number[] = Array.from({ length: B.length + 1 }, () => 0)
  let prev: number[] = Array.from({ length: B.length + 1 }, (_, j) => j)
  for (let i = 1; i <= A.length; i++) {
    const cur: number[] = Array.from({ length: B.length + 1 }, () => 0)
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = cur
  }
  return prev[B.length]
}

/** Allowed typos for an answer of this length. Very short answers must be exact. */
export function typoAllowance(length: number): number {
  if (length <= 2) return 0
  if (length <= 6) return 1
  return 2
}

const digitRuns = (s: string) => s.match(/\d+/g)?.join(',') ?? ''

function typoMatch(response: string, answer: string): boolean {
  if (digitRuns(response) !== digitRuns(answer)) return false
  const allowance = typoAllowance([...answer.replace(/\s/g, '')].length)
  if (allowance === 0) return false
  return osaDistance(response, answer, allowance) <= allowance
}

// ---------------------------------------------------------------------------
// Relaxed: word matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  [
    // English
    'a an the of to in on at by for from with and or as is are was were be been being it its this that these those which who whom whose what where when there their them they he she his her him we our you your i my me do does did so such than then into onto about over',
    // Dutch
    'de het een van in op aan met en of te voor door bij uit om als is zijn was waren wordt worden werd die dat deze dit er hun hij zij ze wij we je jij u mijn zich ook tot naar over',
    // German
    'der die das den dem des ein eine einer eines einem einen und oder zu im in am an auf mit von für ist sind war waren wird werden es sie er wir ihr sich',
    // French
    'le la les l un une des du de d et ou à au aux en dans par pour sur avec est sont était être que qui ce cette ces se sa son ses',
    // Spanish / Italian / Portuguese
    'el la los las un una unos unas y o de del al en con por para es son era que se su sus lo il lo gli i e di da con per è sono che o os as um uma do da dos das no na em com é',
  ]
    .join(' ')
    .split(/\s+/),
)

const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'niet', 'geen', 'nooit', 'nicht', 'kein', 'keine', 'nie', 'ne', 'pas', 'jamais', 'nunca', 'non', 'nao', 'não'])

function stem(token: string): string {
  if ([...token].length < 4 || /\d/.test(token)) return token
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.endsWith('ses') || token.endsWith('xes') || token.endsWith('ches') || token.endsWith('shes'))
    return token.slice(0, -2)
  if (token.endsWith('en') && token.length > 5) return token.slice(0, -2)
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function contentTokens(s: string): string[] {
  return removeDiacritics(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem)
}

function tokensEqual(a: string, b: string): boolean {
  if (a === b) return true
  if (/\d/.test(a) || /\d/.test(b)) return false
  const len = Math.min([...a].length, [...b].length)
  if (len < 4) return false
  const allowance = len <= 6 ? 1 : 2
  return osaDistance(a, b, allowance) <= allowance
}

function meaningMatch(response: string, answer: string): boolean {
  const respWords = response.split(' ')
  const ansWords = answer.split(' ')
  const negR = respWords.some((w) => NEGATIONS.has(w))
  const negA = ansWords.some((w) => NEGATIONS.has(w))
  if (negR !== negA) return false
  const C = contentTokens(answer)
  const U = contentTokens(response)
  if (C.length === 0 || U.length === 0) return false
  if (digitRuns(response) !== digitRuns(answer)) return false
  const used = Array.from({ length: U.length }, () => false)
  let matched = 0
  for (const c of C) {
    const idx = U.findIndex((u, i) => !used[i] && tokensEqual(c, u))
    if (idx >= 0) {
      used[idx] = true
      matched++
    }
  }
  const recall = matched / C.length
  const precision = matched / U.length
  if (recall === 1 && precision >= 0.5) return true
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision)
  return f1 >= 0.8
}

// ---------------------------------------------------------------------------
// Comparison of one response against one accepted answer
// ---------------------------------------------------------------------------

function compareOne(responseCanon: string, answer: string, level: GradingLevel): GradeReason {
  const variants = answerVariants(answer)
  for (const v of variants) {
    if (responseCanon === v) return 'format'
  }
  if (level === 'strict') return 'wrong'
  const respPlain = removeDiacritics(responseCanon)
  for (const v of variants) {
    if (respPlain === removeDiacritics(v)) return 'accent'
  }
  for (const v of variants) {
    if (typoMatch(respPlain, removeDiacritics(v))) return 'typo'
  }
  if (level === 'moderate') return 'wrong'
  for (const v of variants) {
    if (meaningMatch(responseCanon, v)) return 'meaning'
  }
  return 'wrong'
}

/**
 * Splits an answer listing several options ("big, large", "kat / poes", "a; b")
 * on commas, slashes and semicolons outside parentheses and not between digits.
 */
export function splitAlternatives(answer: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  const chars = [...answer]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    const betweenDigits = /\d/.test(chars[i - 1] ?? '') && /\d/.test(chars[i + 1] ?? '')
    if (depth === 0 && (ch === ',' || ch === '/' || ch === ';') && !betweenDigits) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

export function grade(response: string, answer: string, options: GradeOptions): GradeResult {
  const { level } = options
  const respBase = baseNormalize(response)
  if (!canonical(respBase)) return { correct: false, reason: 'empty', level }

  const exact = respBase === baseNormalize(answer) || respBase.replace(/[.!?]+$/, '') === baseNormalize(answer).replace(/[.!?]+$/, '')
  if (exact) return { correct: true, reason: 'exact', level }

  const respCanon = canonical(respBase)
  const whole = compareOne(respCanon, answer, level)
  if (whole !== 'wrong') return { correct: true, reason: whole, level }

  const alternatives = splitAlternatives(answer)
  if (alternatives.length > 1) {
    if (options.requireOne) {
      for (const alt of alternatives) {
        const r = compareOne(respCanon, alt, level)
        if (r !== 'wrong') return { correct: true, reason: 'one-of', level }
      }
    } else {
      // Every alternative must be present, in any order.
      const given = splitAlternatives(response).map(canonical)
      if (given.length === alternatives.length) {
        const used = Array.from({ length: given.length }, () => false)
        const allFound = alternatives.every((alt) => {
          const idx = given.findIndex((g, i) => !used[i] && compareOne(g, alt, level) !== 'wrong')
          if (idx < 0) return false
          used[idx] = true
          return true
        })
        if (allFound) return { correct: true, reason: 'format', level }
      }
    }
  }
  return { correct: false, reason: 'wrong', level }
}

/**
 * Accepted answers that aren't quite the card's wording (accents, a typo, a
 * rephrasing). They count as correct, but Learn pauses to show the exact
 * wording, since a small slip can hide a slightly wrong idea. Giving one of
 * several listed answers ('one-of') is fully right and isn't one of these.
 */
export const NEAR_MISS_REASONS: ReadonlySet<GradeReason> = new Set(['accent', 'typo', 'meaning'])

export const GRADE_REASON_TEXT: Record<GradeReason, string> = {
  exact: 'Correct',
  format: 'Correct',
  accent: 'Correct (accents ignored)',
  typo: 'Correct (small typo)',
  meaning: 'Correct (wording differs a little)',
  'one-of': 'Correct (one of the accepted answers)',
  wrong: 'Incorrect',
  empty: 'No answer given',
}

export const GRADING_LEVEL_INFO: Record<GradingLevel, { label: string; description: string }> = {
  strict: {
    label: 'Strict',
    description: 'Exact answer required. Only case and punctuation differences are ignored.',
  },
  moderate: {
    label: 'Moderate',
    description: 'Accepts missing accents and one or two typos.',
  },
  relaxed: {
    label: 'Relaxed',
    description: 'Relaxed grading accepts small wording differences: the same key words in any order, singular or plural.',
  },
}

// ---------------------------------------------------------------------------
// Default level
// ---------------------------------------------------------------------------

const MATHY = /^[\s\d.,+\-−×÷*/^=()<>≤≥%°√πxyz]+$|[A-Z][a-z]?\d|\d\s*[+\-×÷*/^=]\s*\d/

/**
 * Strict for language pairs, Chinese/Japanese and maths/chemistry; relaxed when
 * both sides are in the user's own language; moderate otherwise.
 */
export function defaultGradingLevel(
  termLang: string,
  defLang: string,
  userLang: string,
  samples: { term: string; definition: string }[] = [],
): GradingLevel {
  const base = (l: string) => (l || '').toLowerCase().split('-')[0]
  const t = base(termLang)
  const d = base(defLang)
  const u = base(userLang)
  const known = (l: string) => l && l !== 'und'
  if (known(t) && known(d) && t !== d) return 'strict'
  if (['zh', 'ja'].includes(t) || ['zh', 'ja'].includes(d)) return 'strict'
  if (samples.length) {
    const mathy = samples.filter((c) => MATHY.test(c.term) || MATHY.test(c.definition)).length
    if (mathy / samples.length >= 0.3) return 'strict'
  }
  const same = known(t) ? t : d
  if (known(same) && same === u && (!known(t) || !known(d) || t === d)) return 'relaxed'
  return 'moderate'
}

// ---------------------------------------------------------------------------
// Letter diff (spell mode feedback)
// ---------------------------------------------------------------------------

export interface DiffPart {
  text: string
  status: 'ok' | 'wrong' | 'missing' | 'extra'
}

/** Aligns the response to the answer, case-insensitively, for per-letter feedback. */
export function letterDiff(response: string, answer: string): DiffPart[] {
  const A = [...response]
  const B = [...answer]
  const eq = (x: string, y: string) => x.toLocaleLowerCase() === y.toLocaleLowerCase()
  const dp: number[][] = Array.from({ length: A.length + 1 }, (_, i) =>
    Array.from({ length: B.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (eq(A[i - 1], B[j - 1]) ? 0 : 1))
  const out: DiffPart[] = []
  let i = A.length
  let j = B.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (eq(A[i - 1], B[j - 1]) ? 0 : 1)) {
      out.push({ text: B[j - 1], status: eq(A[i - 1], B[j - 1]) ? 'ok' : 'wrong' })
      i--
      j--
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      out.push({ text: B[j - 1], status: 'missing' })
      j--
    } else {
      out.push({ text: A[i - 1], status: 'extra' })
      i--
    }
  }
  out.reverse()
  // Merge neighbours with the same status.
  const merged: DiffPart[] = []
  for (const p of out) {
    const last = merged[merged.length - 1]
    if (last && last.status === p.status) last.text += p.text
    else merged.push({ ...p })
  }
  return merged
}
