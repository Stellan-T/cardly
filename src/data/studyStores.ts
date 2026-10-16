/**
 * Live, write-behind stores for per-set progress and session state.
 *
 * Every answer updates local state immediately (so the UI never waits), and
 * changes are flushed to Firestore at most every 2 seconds, plus whenever the
 * page is hidden or the study screen closes. This keeps the app well within
 * the free-tier write quota while still syncing an unfinished session to other
 * devices within seconds.
 */
import { increment, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { applyOutcome, emptyStats, summarize, type Outcome } from '../lib/progress'
import { srsDueList } from '../lib/srs'
import type { ProgressSummary, SessionDoc, SetProgressDoc, SetStats, TermProgress } from '../types'
import { toProgressDoc, toSessionDoc } from './mappers'
import { progressRef, sessionRef, setRef } from './paths'
import { track } from './sync'

export const FLUSH_INTERVAL_MS = 2000

type Listener = () => void

abstract class WriteBehindStore<State> {
  protected listeners = new Set<Listener>()
  protected timer: ReturnType<typeof setTimeout> | null = null
  protected unsubscribe: (() => void) | null = null
  protected cached: State | null = null
  refCount = 0
  loaded = false

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getState = (): State => (this.cached ??= this.compute())

  protected abstract compute(): State
  abstract flush(): void
  abstract start(): void

  protected changed() {
    this.cached = null
    this.listeners.forEach((l) => l())
  }

  protected schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  protected clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  stop() {
    this.flush()
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressState {
  cards: Record<string, TermProgress>
  stats: SetStats
  loaded: boolean
}

export class ProgressStore extends WriteBehindStore<ProgressState> {
  private snapshot: SetProgressDoc = toProgressDoc(undefined)
  private pending = new Map<string, TermProgress>()
  /** Flushed but not yet reflected in a snapshot. */
  private inflight = new Map<string, TermProgress>()
  private statsPatch: Partial<SetStats> = {}
  private studyMs = 0
  private sessions = 0
  private resetting = false
  private cardIds: string[] = []
  private lastSummaryKey = ''
  private readonly uid: string
  private readonly setId: string
  private readonly isOwner: boolean

  constructor(uid: string, setId: string, isOwner: boolean) {
    super()
    this.uid = uid
    this.setId = setId
    this.isOwner = isOwner
  }

  start() {
    if (this.unsubscribe) return
    this.unsubscribe = onSnapshot(
      progressRef(this.uid, this.setId),
      (snap) => {
        this.snapshot = toProgressDoc(snap.data())
        if (!snap.metadata.hasPendingWrites) this.inflight.clear()
        this.resetting = false
        this.loaded = true
        this.changed()
      },
      (err) => {
        console.warn('progress listener', err)
        this.loaded = true
        this.changed()
      },
    )
  }

  setCardIds(ids: string[]) {
    this.cardIds = ids
  }

  protected compute(): ProgressState {
    const base = this.resetting ? {} : this.snapshot.cards
    const cards = { ...base }
    for (const [id, p] of this.inflight) cards[id] = p
    for (const [id, p] of this.pending) cards[id] = p
    const stats: SetStats = {
      ...emptyStats(),
      ...this.snapshot.stats,
      ...this.statsPatch,
      studyMs: (this.snapshot.stats.studyMs ?? 0) + this.studyMs,
      sessions: (this.snapshot.stats.sessions ?? 0) + this.sessions,
    }
    return { cards, stats, loaded: this.loaded }
  }

  get(cardId: string): TermProgress | undefined {
    return this.getState().cards[cardId]
  }

  /** Records an answer in a tracked activity (Flashcards sorting/SRS, Learn, Test). */
  record(cardId: string, outcome: Outcome, extra?: Partial<TermProgress>) {
    const now = Date.now()
    const next = { ...applyOutcome(this.get(cardId), outcome, now), ...extra }
    this.pending.set(cardId, next)
    this.statsPatch.lastStudiedAt = now
    this.changed()
    this.schedule()
  }

  /** Arbitrary update of a term's progress (e.g. Learn level, SRS state). */
  update(cardId: string, fn: (p: TermProgress | undefined) => TermProgress) {
    this.pending.set(cardId, fn(this.get(cardId)))
    this.changed()
    this.schedule()
  }

  addStudyTime(ms: number) {
    if (ms <= 0) return
    this.studyMs += ms
    this.schedule()
  }

  addSession() {
    this.sessions += 1
    this.statsPatch.lastStudiedAt = Date.now()
    this.changed()
    this.schedule()
  }

  patchStats(patch: Partial<SetStats>) {
    Object.assign(this.statsPatch, patch)
    this.changed()
    this.schedule()
  }

  /** Clears progress for all terms (or only the given ones). */
  reset(cardIds?: string[]) {
    this.flush()
    if (!cardIds) {
      this.pending.clear()
      this.inflight.clear()
      this.resetting = true
      void track(
        setDoc(progressRef(this.uid, this.setId), { cards: {}, updatedAt: Date.now() }, { mergeFields: ['cards', 'updatedAt'] }),
        'reset progress',
      )
      this.changed()
      this.writeSummary({})
      return
    }
    const now = Date.now()
    for (const id of cardIds)
      this.pending.set(id, { seen: 0, correct: 0, incorrect: 0, streak: 0, lastResult: null, level: 0, srs: null, lastAt: now })
    this.changed()
    this.flush()
  }

  flush() {
    this.clearTimer()
    const hasCards = this.pending.size > 0
    const hasStats = Object.keys(this.statsPatch).length > 0 || this.studyMs > 0 || this.sessions > 0
    if (!hasCards && !hasStats) return
    const cards: Record<string, TermProgress> = {}
    for (const [id, p] of this.pending) {
      cards[id] = p
      this.inflight.set(id, p)
    }
    const stats: Record<string, unknown> = { ...this.statsPatch }
    if (this.studyMs) stats.studyMs = increment(Math.round(this.studyMs))
    if (this.sessions) stats.sessions = increment(this.sessions)
    // Keep the merged view stable while the write is in flight.
    this.snapshot = {
      ...this.snapshot,
      stats: {
        ...this.snapshot.stats,
        ...this.statsPatch,
        studyMs: this.snapshot.stats.studyMs + this.studyMs,
        sessions: this.snapshot.stats.sessions + this.sessions,
      },
    }
    this.pending.clear()
    this.statsPatch = {}
    this.studyMs = 0
    this.sessions = 0
    // Never send an empty map: with merge, Firestore treats {} as a value and would wipe the field.
    const data: Record<string, unknown> = { updatedAt: Date.now() }
    if (hasCards) data.cards = cards
    if (Object.keys(stats).length) data.stats = stats
    void track(setDoc(progressRef(this.uid, this.setId), data, { merge: true }), 'save progress')
    if (hasCards) this.writeSummary(this.getState().cards)
    this.changed()
  }

  private writeSummary(cards: Record<string, TermProgress>) {
    if (!this.isOwner || !this.cardIds.length) return
    const summary: ProgressSummary = summarize(this.cardIds, cards)
    const srsDue = srsDueList(cards, this.cardIds)
    const key = JSON.stringify([summary, srsDue])
    if (key === this.lastSummaryKey) return
    this.lastSummaryKey = key
    void track(updateDoc(setRef(this.uid, this.setId), { summary, srsDue }), 'save summary')
  }
}

// ---------------------------------------------------------------------------
// Session (resumable study state + per-set options)
// ---------------------------------------------------------------------------

export class SessionStore extends WriteBehindStore<SessionDoc> {
  private snapshot: SessionDoc = {}
  private pending = new Map<string, unknown>()
  private inflight = new Map<string, unknown>()
  private readonly uid: string
  private readonly setId: string

  constructor(uid: string, setId: string) {
    super()
    this.uid = uid
    this.setId = setId
  }

  start() {
    if (this.unsubscribe) return
    this.unsubscribe = onSnapshot(
      sessionRef(this.uid, this.setId),
      (snap) => {
        this.snapshot = toSessionDoc(snap.data())
        if (!snap.metadata.hasPendingWrites) this.inflight.clear()
        this.loaded = true
        this.changed()
      },
      (err) => {
        console.warn('session listener', err)
        this.loaded = true
        this.changed()
      },
    )
  }

  protected compute(): SessionDoc {
    const out: Record<string, unknown> = structuredClone(this.snapshot) as Record<string, unknown>
    for (const [path, value] of [...this.inflight, ...this.pending]) setPath(out, path, value)
    return out as SessionDoc
  }

  /** Replaces one field, e.g. "learn", "flashcards" or "options.learn". */
  patch(path: string, value: unknown) {
    this.pending.set(path, value)
    this.changed()
    this.schedule()
  }

  flush() {
    this.clearTimer()
    if (!this.pending.size) return
    const data: Record<string, unknown> = { updatedAt: Date.now() }
    const fields = ['updatedAt']
    for (const [path, value] of this.pending) {
      setPath(data, path, value === undefined ? null : value)
      fields.push(path)
      this.inflight.set(path, value)
    }
    this.pending.clear()
    void track(setDoc(sessionRef(this.uid, this.setId), data, { mergeFields: fields }), 'save session')
  }
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.')
  let cur = obj
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = value
}

// ---------------------------------------------------------------------------
// Registry + hooks
// ---------------------------------------------------------------------------

const progressStores = new Map<string, ProgressStore>()
const sessionStores = new Map<string, SessionStore>()

function acquire<S extends WriteBehindStore<unknown>>(map: Map<string, S>, key: string, create: () => S): S {
  let store = map.get(key)
  if (!store) {
    store = create()
    map.set(key, store)
  }
  store.refCount++
  store.start()
  return store
}

function release<S extends WriteBehindStore<unknown>>(map: Map<string, S>, key: string) {
  const store = map.get(key)
  if (!store) return
  store.refCount--
  if (store.refCount <= 0) {
    store.stop()
    map.delete(key)
  }
}

export function flushAllStores() {
  progressStores.forEach((s) => s.flush())
  sessionStores.forEach((s) => s.flush())
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllStores()
  })
  window.addEventListener('pagehide', flushAllStores)
}

/** Shared progress store for a set (one per uid/set while any component uses it). */
export function getProgressStore(uid: string, setId: string, isOwner: boolean): ProgressStore {
  return acquire(progressStores, `${uid}/${setId}`, () => new ProgressStore(uid, setId, isOwner))
}
export const releaseProgressStore = (uid: string, setId: string) => release(progressStores, `${uid}/${setId}`)

export function getSessionStore(uid: string, setId: string): SessionStore {
  return acquire(sessionStores, `${uid}/${setId}`, () => new SessionStore(uid, setId))
}
export const releaseSessionStore = (uid: string, setId: string) => release(sessionStores, `${uid}/${setId}`)

const emptyProgressState: ProgressState = { cards: {}, stats: emptyStats(), loaded: false }
const noop = () => () => {}

export function useStoreState<T>(store: { subscribe: (l: Listener) => () => void; getState: () => T } | null, fallback: T): T {
  return useSyncExternalStore(store ? store.subscribe : noop, store ? store.getState : () => fallback)
}

export function useProgressState(store: ProgressStore | null): ProgressState {
  return useStoreState(store, emptyProgressState)
}

/** Keeps a progress/session store pair alive for the lifetime of a component. */
export function useStudyStores(uid: string | null, setId: string | null, isOwner: boolean) {
  const key = uid && setId ? `${uid}/${setId}` : null
  const [stores, setStores] = useState<{ key: string; progress: ProgressStore; session: SessionStore } | null>(null)
  useEffect(() => {
    if (!uid || !setId || !key) {
      setStores(null)
      return
    }
    const progress = getProgressStore(uid, setId, isOwner)
    const session = getSessionStore(uid, setId)
    setStores({ key, progress, session })
    return () => {
      releaseProgressStore(uid, setId)
      releaseSessionStore(uid, setId)
    }
  }, [uid, setId, key, isOwner])
  return stores && stores.key === key ? stores : { progress: null, session: null }
}
