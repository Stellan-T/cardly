/** Text-to-speech with the Web Speech API, using the set's languages. */

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

let voicesCache: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()

function loadVoices() {
  if (!ttsSupported()) return
  voicesCache = window.speechSynthesis.getVoices()
  listeners.forEach((l) => l())
}

if (ttsSupported()) {
  loadVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!voicesCache.length) loadVoices()
  return voicesCache
}

export function onVoicesChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const LANG_FALLBACK: Record<string, string> = { nb: 'no', und: '' }

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  const base = (LANG_FALLBACK[lang] ?? lang).toLowerCase()
  if (!base) return []
  return getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base)
}

export function chooseVoice(lang: string, preferredURI?: string): SpeechSynthesisVoice | undefined {
  const voices = voicesFor(lang)
  if (preferredURI) {
    const v = getVoices().find((x) => x.voiceURI === preferredURI)
    if (v) return v
  }
  return voices.find((v) => v.default) ?? voices.find((v) => v.localService) ?? voices[0]
}

export interface SpeakOptions {
  voiceURI?: string
  rate?: number
  onEnd?: () => void
}

/** Speaks text; cancels anything currently being spoken. */
export function speak(text: string, lang: string, options: SpeakOptions = {}): void {
  if (!ttsSupported() || !text.trim()) {
    options.onEnd?.()
    return
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 1000))
  const voice = chooseVoice(lang, options.voiceURI)
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else if (lang && lang !== 'und') u.lang = lang
  u.rate = options.rate ?? 1
  u.onend = () => options.onEnd?.()
  u.onerror = () => options.onEnd?.()
  synth.speak(u)
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}
