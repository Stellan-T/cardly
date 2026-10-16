/** Languages offered for terms/definitions (TTS voice and grading defaults) and a light guesser. */

export interface Language {
  code: string
  name: string
}

export const LANGUAGES: Language[] = [
  { code: 'und', name: 'Not set' },
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Dutch' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'nb', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'el', name: 'Greek' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'la', name: 'Latin' },
]

export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code

/** The user's UI language as a base code ("en-GB" -> "en"). */
export function userLanguage(): string {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return (lang || 'en').toLowerCase().split('-')[0]
}

const SCRIPTS: [RegExp, string][] = [
  [/[぀-ヿ]/, 'ja'],
  [/[가-힯ᄀ-ᇿ]/, 'ko'],
  [/[一-鿿]/, 'zh'],
  [/[Ѐ-ӿ]/, 'ru'],
  [/[Ͱ-Ͽ]/, 'el'],
  [/[؀-ۿ]/, 'ar'],
  [/[֐-׿]/, 'he'],
  [/[฀-๿]/, 'th'],
  [/[ऀ-ॿ]/, 'hi'],
]

const WORDS: Record<string, string[]> = {
  en: ['the', 'of', 'and', 'to', 'is', 'in', 'that', 'a', 'for', 'it', 'with', 'as', 'by', 'which', 'are', 'from', 'an', 'be', 'this', 'or'],
  nl: ['de', 'het', 'een', 'van', 'en', 'is', 'dat', 'die', 'in', 'op', 'te', 'zijn', 'met', 'voor', 'niet', 'aan', 'er', 'wordt', 'uit', 'werd'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'den', 'mit', 'von', 'sich', 'auf', 'für', 'im', 'dem', 'wird', 'auch', 'es'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'un', 'une', 'du', 'en', 'que', 'qui', 'dans', 'pour', 'pas', 'au', 'sur', 'avec', 'ce'],
  es: ['el', 'la', 'los', 'las', 'de', 'y', 'que', 'en', 'un', 'una', 'es', 'por', 'con', 'para', 'del', 'se', 'no', 'al', 'lo', 'como'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'e', 'che', 'un', 'una', 'è', 'per', 'non', 'con', 'del', 'della', 'sono', 'nel', 'si', 'da'],
  pt: ['o', 'a', 'os', 'as', 'de', 'e', 'que', 'um', 'uma', 'é', 'do', 'da', 'em', 'para', 'com', 'não', 'no', 'na', 'se', 'por'],
  sv: ['och', 'att', 'det', 'som', 'en', 'är', 'på', 'av', 'för', 'med', 'till', 'den', 'har', 'inte', 'om', 'ett', 'var', 'jag'],
  id: ['yang', 'dan', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam', 'adalah', 'akan', 'pada', 'juga', 'ke'],
}

const CHAR_HINTS: [RegExp, string, number][] = [
  [/ñ|¿|¡/, 'es', 3],
  [/[çœ]|\b(?:l|d|qu)'/, 'fr', 2],
  [/[èêë]/, 'fr', 1],
  [/[ãõ]/, 'pt', 3],
  [/ß|[äöü]/, 'de', 2],
  [/ij\b|\bij|aa|oe|ui/, 'nl', 0.6],
  [/[åø]/, 'sv', 2],
  [/[ąćęłńśźż]/, 'pl', 3],
  [/[ğış]/, 'tr', 3],
  [/[ăâîșț]/, 'ro', 2],
  [/[ěščřžůý]/, 'cs', 2],
  [/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/, 'vi', 3],
]

/**
 * Guesses the language of a list of short texts (one side of a set).
 * Returns "und" when there isn't enough signal.
 */
export function guessLanguage(texts: string[]): string {
  const sample = texts.slice(0, 200).join('\n')
  if (!sample.trim()) return 'und'
  for (const [re, code] of SCRIPTS) {
    const matches = sample.match(new RegExp(re.source, 'g'))?.length ?? 0
    if (matches >= Math.max(2, sample.replace(/\s/g, '').length * 0.2)) {
      if (code === 'ru' && /[їєіґ]/i.test(sample)) return 'uk'
      return code
    }
  }
  const lower = sample.toLocaleLowerCase()
  const tokens = lower.split(/[^\p{L}']+/u).filter(Boolean)
  if (tokens.length === 0) return 'und'
  const scores: Record<string, number> = {}
  for (const [lang, words] of Object.entries(WORDS)) {
    const set = new Set(words)
    scores[lang] = tokens.filter((t) => set.has(t)).length / tokens.length
  }
  for (const [re, lang, weight] of CHAR_HINTS) {
    const hits = lower.match(new RegExp(re.source, 'g'))?.length ?? 0
    scores[lang] = (scores[lang] ?? 0) + Math.min(0.3, (hits / tokens.length) * weight)
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [best, second] = ranked
  if (!best || best[1] < 0.04) return 'und'
  if (second && best[1] - second[1] < 0.01) return 'und'
  return best[0]
}
