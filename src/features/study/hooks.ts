/** Hooks shared by every study activity. */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { touchStudied } from '../../data/sets'
import { useProgressState, useStoreState } from '../../data/studyStores'
import { recordStudyDay } from '../../data/user'
import { defaultGradingLevel } from '../../lib/grade'
import { userLanguage } from '../../lib/languages'
import { speak } from '../../lib/tts'
import type { ActivityKind, Card, GradingLevel, SessionDoc, Side } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'

const EMPTY_SESSION: SessionDoc = {}

export function useSessionState(): SessionDoc {
  const { session } = useStudySet()
  return useStoreState(session, EMPTY_SESSION)
}

export function useProgress() {
  const { progress } = useStudySet()
  return useProgressState(progress)
}

/**
 * Per-set, per-activity options, synced through the session doc.
 * Unknown/missing keys fall back to `defaults`.
 */
export function useModeOptions<T extends object>(mode: ActivityKind, defaults: T): [T, (patch: Partial<T>) => void, boolean] {
  const { session } = useStudySet()
  const state = useSessionState()
  const saved = state.options?.[mode] as Partial<T> | undefined
  const defaultsKey = JSON.stringify(defaults)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = useMemo(() => ({ ...defaults, ...saved }) as T, [saved, defaultsKey])
  const latest = useRef(options)
  latest.current = options
  const update = useCallback(
    (patch: Partial<T>) => {
      const next = { ...latest.current, ...patch }
      latest.current = next
      session?.patch(`options.${mode}`, next)
    },
    [session, mode],
  )
  return [options, update, !!session?.loaded]
}

/**
 * The term subset requested via "?terms=id1,id2" (e.g. "Study these with…" on
 * the set page, or "Study missed terms in Learn" after a test), or null.
 */
export function useTermFilter(): Set<string> | null {
  const [params] = useSearchParams()
  const raw = params.get('terms')
  return useMemo(() => (raw ? new Set(raw.split(',').filter(Boolean)) : null), [raw])
}

/** Cards to study: the "?terms=" subset if any, optionally only the starred ones. */
export function useStudyCards(starredOnly: boolean): Card[] {
  const { cards } = useStudySet()
  const subset = useTermFilter()
  return useMemo(() => {
    let list = subset ? cards.filter((c) => subset.has(c.id)) : cards
    if (starredOnly) list = list.filter((c) => c.starred)
    return list
  }, [cards, starredOnly, subset])
}

export function useHasStarred(): boolean {
  const { cards } = useStudySet()
  return cards.some((c) => c.starred)
}

/** Grading preferences for this set (Learn and Test share them). */
export function useGrading() {
  const { meta, cards, session } = useStudySet()
  const { settings } = useAuth()
  const state = useSessionState()
  const autoLevel = useMemo<GradingLevel>(
    () =>
      settings.defaultGrading !== 'auto'
        ? settings.defaultGrading
        : defaultGradingLevel(meta.termLang, meta.defLang, userLanguage(), cards.slice(0, 50)),
    [settings.defaultGrading, meta.termLang, meta.defLang, cards],
  )
  const level = state.grading?.level ?? autoLevel
  const requireOne = state.grading?.requireOne ?? false
  const setLevel = useCallback(
    (l: GradingLevel | null) => session?.patch('grading', { level: l, requireOne }),
    [session, requireOne],
  )
  const setRequireOne = useCallback(
    (v: boolean) => session?.patch('grading', { level: state.grading?.level ?? null, requireOne: v }),
    [session, state.grading?.level],
  )
  return { level, autoLevel, isAuto: state.grading?.level == null, requireOne, setLevel, setRequireOne }
}

/** Language + preferred voice for each side, and a speak helper. */
export function useSpeech() {
  const { meta } = useStudySet()
  const { settings } = useAuth()
  const langOf = useCallback((side: Side) => (side === 'term' ? meta.termLang : meta.defLang), [meta.termLang, meta.defLang])
  const voiceOf = useCallback((side: Side) => settings.voices[langOf(side)], [settings.voices, langOf])
  const say = useCallback(
    (text: string, side: Side, onEnd?: () => void) => speak(text, langOf(side), { voiceURI: voiceOf(side), onEnd }),
    [langOf, voiceOf],
  )
  return { langOf, voiceOf, say }
}

/**
 * Records that the user studied: the streak, "continue where you left off"
 * and study time. Call `markStudied()` on the first real answer.
 */
export function useStudyActivity(kind: ActivityKind) {
  const { uid, profile } = useAuth()
  const { setId, isPublic, progress } = useStudySet()
  const marked = useRef(false)
  const visibleSince = useRef<number | null>(typeof document !== 'undefined' && document.visibilityState === 'visible' ? Date.now() : null)

  useEffect(() => {
    if (!progress) return
    visibleSince.current = document.visibilityState === 'visible' ? Date.now() : null
    const commit = () => {
      if (visibleSince.current !== null) {
        // Cap idle stretches: count at most 10 minutes per uninterrupted visible period.
        progress.addStudyTime(Math.min(Date.now() - visibleSince.current, 10 * 60_000))
        visibleSince.current = null
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') commit()
      else visibleSince.current = Date.now()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (marked.current) commit()
    }
  }, [progress])

  const markStudied = useCallback(() => {
    if (marked.current || !uid) return
    marked.current = true
    progress?.addSession()
    recordStudyDay(uid, profile.streak)
    if (!isPublic) touchStudied(uid, setId, kind)
  }, [uid, progress, profile.streak, isPublic, setId, kind])

  return { markStudied }
}
