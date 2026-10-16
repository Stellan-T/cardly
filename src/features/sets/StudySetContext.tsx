/**
 * Loads one study set — the user's own (/sets/:id) or one shared by link
 * (/p/:id) — and provides it, plus the live progress/session stores, to the
 * set page and every study activity.
 */
import { orderBy, query } from 'firebase/firestore'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useLiveDoc, useLiveQuery } from '../../data/hooks'
import type { ImageSource } from '../../data/images'
import { toCard, toPublicSet, toStudySet } from '../../data/mappers'
import { cardsCol, publicSetRef, setRef } from '../../data/paths'
import { starMany, toggleStar as toggleStarDoc } from '../../data/sets'
import { useStoreState, useStudyStores, type ProgressStore, type SessionStore } from '../../data/studyStores'
import type { Card, PublicSetDoc, SessionDoc, StudySet } from '../../types'
import { useAuth } from '../auth/AuthProvider'

export interface SetMeta {
  title: string
  description: string
  termLang: string
  defLang: string
  ownerName: string
  ownerUid: string
  cardCount: number
  visibility: StudySet['visibility']
  createdAt: number
  updatedAt: number
}

export interface StudySetValue {
  setId: string
  status: 'loading' | 'ready' | 'missing' | 'error'
  /** Opened through a share link (read-only copy in publicSets). */
  isPublic: boolean
  isOwner: boolean
  meta: SetMeta
  /** The owner's set document (null for shared sets). */
  set: StudySet | null
  /** Cards in their saved order, with `starred` resolved for the current viewer. */
  cards: Card[]
  imageSource: ImageSource
  /** "/sets/:id" or "/p/:id" — study routes live below it. */
  basePath: string
  progress: ProgressStore | null
  session: SessionStore | null
  toggleStar: (cardId: string) => void
  setStarred: (cardIds: string[], starred: boolean) => void
}

const Ctx = createContext<StudySetValue | null>(null)

export function useStudySet(): StudySetValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudySet() must be used inside <StudySetProvider>')
  return v
}

const EMPTY_META: SetMeta = {
  title: '',
  description: '',
  termLang: 'und',
  defLang: 'und',
  ownerName: '',
  ownerUid: '',
  cardCount: 0,
  visibility: 'private',
  createdAt: 0,
  updatedAt: 0,
}

export function StudySetProvider({ setId, isPublic, children }: { setId: string; isPublic: boolean; children: ReactNode }) {
  const { uid } = useAuth()

  const own = useLiveDoc(!isPublic && uid ? setRef(uid, setId) : null, !isPublic && uid ? `set/${uid}/${setId}` : null, toStudySet, null)
  const ownCards = useLiveQuery(
    !isPublic && uid ? query(cardsCol(uid, setId), orderBy('order')) : null,
    !isPublic && uid ? `cards/${uid}/${setId}` : null,
    toCard,
  )
  const shared = useLiveDoc<PublicSetDoc | null>(
    isPublic ? publicSetRef(setId) : null,
    isPublic ? `public/${setId}` : null,
    (d) => toPublicSet(d),
    null,
  )

  const isOwner = isPublic ? !!shared.data && shared.data.ownerUid === uid : true
  const { progress, session } = useStudyStores(uid, setId, !isPublic)

  // Stars on a shared set belong to the viewer and live in their session doc.
  const sessionState = useSessionStarred(session)

  const value = useMemo<StudySetValue>(() => {
    let status: StudySetValue['status'] = 'loading'
    let meta = EMPTY_META
    let cards: Card[] = []
    if (isPublic) {
      if (shared.error) status = 'error'
      else if (!shared.loading) status = shared.data ? 'ready' : 'missing'
      if (shared.data) {
        const d = shared.data
        meta = {
          title: d.title,
          description: d.description,
          termLang: d.termLang,
          defLang: d.defLang,
          ownerName: d.ownerName,
          ownerUid: d.ownerUid,
          cardCount: d.cards.length,
          visibility: 'link',
          createdAt: d.updatedAt,
          updatedAt: d.updatedAt,
        }
        const starred = new Set(sessionState)
        cards = [...d.cards]
          .sort((a, b) => a.order - b.order)
          .map((c) => ({ ...c, starred: starred.has(c.id), imageId: c.imageId ?? null, imageUrl: c.imageUrl ?? null }))
      }
    } else {
      if (own.error || ownCards.error) status = 'error'
      else if (!own.loading && !ownCards.loading) status = own.data ? 'ready' : 'missing'
      if (own.data) {
        const s = own.data
        meta = {
          title: s.title,
          description: s.description,
          termLang: s.termLang,
          defLang: s.defLang,
          ownerName: s.ownerName,
          ownerUid: s.ownerUid,
          cardCount: s.cardCount,
          visibility: s.visibility,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }
      }
      cards = ownCards.data
    }
    return {
      setId,
      status,
      isPublic,
      isOwner,
      meta,
      set: isPublic ? null : own.data,
      cards,
      imageSource: isPublic ? { publicSetId: setId } : { ownerUid: uid },
      basePath: isPublic ? `/p/${setId}` : `/sets/${setId}`,
      progress,
      session,
      toggleStar: () => {},
      setStarred: () => {},
    }
  }, [isPublic, shared, own, ownCards, sessionState, setId, uid, isOwner, progress, session])

  const toggleStar = useCallback(
    (cardId: string) => {
      const card = value.cards.find((c) => c.id === cardId)
      if (!card || !uid) return
      if (isPublic) {
        const next = card.starred ? sessionState.filter((id) => id !== cardId) : [...sessionState, cardId]
        session?.patch('starred', next)
      } else toggleStarDoc(uid, setId, cardId, !card.starred)
    },
    [value.cards, uid, isPublic, sessionState, session, setId],
  )

  const setStarred = useCallback(
    (cardIds: string[], starred: boolean) => {
      if (!uid) return
      if (isPublic) {
        const set = new Set(sessionState)
        for (const id of cardIds) {
          if (starred) set.add(id)
          else set.delete(id)
        }
        session?.patch('starred', [...set])
      } else {
        const ids = new Set(cardIds)
        starMany(
          uid,
          setId,
          value.cards.filter((c) => ids.has(c.id)),
          starred,
          value.cards,
        )
      }
    },
    [uid, isPublic, sessionState, session, setId, value.cards],
  )

  // Keep the progress store's card list current (for the set's summary counts).
  useEffect(() => {
    if (progress && value.status === 'ready') progress.setCardIds(value.cards.map((c) => c.id))
  }, [progress, value.status, value.cards])

  const full = useMemo(() => ({ ...value, toggleStar, setStarred }), [value, toggleStar, setStarred])
  return <Ctx.Provider value={full}>{children}</Ctx.Provider>
}

const NO_STARS: string[] = []
const EMPTY_SESSION: SessionDoc = {}
function useSessionStarred(session: SessionStore | null): string[] {
  const state = useStoreState(session, EMPTY_SESSION)
  return state.starred ?? NO_STARS
}
