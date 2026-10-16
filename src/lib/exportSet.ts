/** Exports cards as text with the same separator choices as the import dialog. */

export type ExportTermSep = 'tab' | 'comma' | 'colon' | 'dash' | 'equals' | 'custom'
export type ExportCardSep = 'newline' | 'semicolon' | 'custom'

export interface ExportOptions {
  termSep: ExportTermSep
  cardSep: ExportCardSep
  customTermSep?: string
  customCardSep?: string
}

const TERM_SEPS: Record<Exclude<ExportTermSep, 'custom'>, string> = {
  tab: '\t',
  comma: ',',
  colon: ': ',
  dash: ' - ',
  equals: ' = ',
}

const unescape = (s: string | undefined) => (s ?? '').replace(/\\t/g, '\t').replace(/\\n/g, '\n')

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCards(cards: { term: string; definition: string }[], opts: ExportOptions): string {
  const termSep = opts.termSep === 'custom' ? unescape(opts.customTermSep) || '\t' : TERM_SEPS[opts.termSep]
  const cardSep =
    opts.cardSep === 'custom' ? unescape(opts.customCardSep) || '\n' : opts.cardSep === 'semicolon' ? ';\n' : '\n'
  const multiLineSafe = opts.cardSep !== 'newline'
  return cards
    .map((c) => {
      if (opts.termSep === 'comma') return `${csvField(c.term)},${csvField(c.definition)}`
      // With newline between cards, line breaks inside a card would start a new card.
      const clean = (s: string) => (multiLineSafe ? s : s.replace(/\r?\n/g, ' '))
      return `${clean(c.term)}${termSep}${clean(c.definition)}`
    })
    .join(cardSep)
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const safeFilename = (title: string) => title.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'cards'
