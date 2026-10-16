/**
 * Study set writes. Cards live in users/{uid}/sets/{setId}/cards (one small doc
 * per card) and the set doc keeps counts and summaries for cheap list views.
 * Writes are fire-and-forget (tracked for the sync indicator) so everything
 * works offline.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Card, PublicCard, StudySet, Visibility } from '../types'
import { toCard } from './mappers'
import {
  cardRef,
  cardsCol,
  folderRef,
  imageRef,
  newId,
  progressRef,
  publicImageRef,
  publicSetRef,
  sessionRef,
  setRef,
  testsCol,
} from './paths'
import { track } from './sync'

export interface CardInput {
  id?: string
  term: string
  definition: string
  imageId?: string | null
  imageUrl?: string | null
  tags?: string[]
  starred?: boolean
}

export interface SetMetaInput {
  title: string
  description?: string
  termLang: string
  defLang: string
  visibility?: Visibility
  draft?: boolean
  copiedFrom?: string | null
}

const BATCH_LIMIT = 450

/** Runs writes in batches of at most 450 operations. */
async function inBatches(ops: ((b: WriteBatch) => void)[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch)
    await batch.commit()
  }
}

function cardData(c: CardInput, order: number) {
  return {
    term: c.term,
    definition: c.definition,
    order,
    starred: c.starred ?? false,
    imageId: c.imageId ?? null,
    imageUrl: c.imageUrl ?? null,
    tags: c.tags?.length ? c.tags : [],
  }
}

/** Creates a set with its cards. Returns the new set id immediately. */
export function createSet(uid: string, ownerName: string, meta: SetMetaInput, cards: CardInput[]): string {
  const setId = newId()
  const now = Date.now()
  const starredCount = cards.filter((c) => c.starred).length
  const ops: ((b: WriteBatch) => void)[] = [
    (b) =>
      b.set(setRef(uid, setId), {
        ownerUid: uid,
        ownerName: ownerName.slice(0, 100),
        title: meta.title.trim().slice(0, 255) || 'Untitled set',
        description: meta.description ?? '',
        termLang: meta.termLang,
        defLang: meta.defLang,
        visibility: meta.visibility ?? 'private',
        cardCount: cards.length,
        starredCount,
        createdAt: now,
        updatedAt: now,
        lastStudiedAt: null,
        lastActivity: null,
        folderIds: [],
        draft: meta.draft ?? false,
        copiedFrom: meta.copiedFrom ?? null,
      }),
    ...cards.map((c, i) => (b: WriteBatch) => b.set(cardRef(uid, setId, c.id ?? newId()), cardData(c, i))),
  ]
  void track(inBatches(ops), 'create set')
  return setId
}

export function updateSet(uid: string, setId: string, patch: Partial<Omit<StudySet, 'id'>>): void {
  void track(updateDoc(setRef(uid, setId), { ...patch, updatedAt: Date.now() }), 'update set')
}

/** Writes changed/new cards and deletes removed ones, then updates the set's counts. */
export function saveCards(
  uid: string,
  setId: string,
  upserts: Card[],
  deletes: string[],
  totals: { cardCount: number; starredCount: number },
): Promise<unknown> {
  const ops: ((b: WriteBatch) => void)[] = [
    ...upserts.map((c) => (b: WriteBatch) => b.set(cardRef(uid, setId, c.id), cardData(c, c.order))),
    ...deletes.map((id) => (b: WriteBatch) => b.delete(cardRef(uid, setId, id))),
    (b) => b.update(setRef(uid, setId), { ...totals, updatedAt: Date.now() }),
  ]
  return track(inBatches(ops), 'save cards')
}

/** Appends cards at the end of an existing set. */
export function appendCards(uid: string, set: StudySet, existing: Card[], cards: CardInput[]): void {
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.order), -1)
  const ops: ((b: WriteBatch) => void)[] = [
    ...cards.map((c, i) => (b: WriteBatch) => b.set(cardRef(uid, set.id, newId()), cardData(c, maxOrder + 1 + i))),
    (b) =>
      b.update(setRef(uid, set.id), {
        cardCount: existing.length + cards.length,
        updatedAt: Date.now(),
      }),
  ]
  void track(inBatches(ops), 'add cards')
}

export function toggleStar(uid: string, setId: string, cardId: string, starred: boolean): void {
  const batch = writeBatch(db)
  batch.update(cardRef(uid, setId, cardId), { starred })
  batch.update(setRef(uid, setId), { starredCount: increment(starred ? 1 : -1) })
  void track(batch.commit(), 'star card')
}

export function starMany(uid: string, setId: string, cards: Card[], starred: boolean, allCards: Card[]): void {
  const changing = cards.filter((c) => c.starred !== starred)
  if (!changing.length) return
  const starredAfter = allCards.filter((c) => (changing.some((x) => x.id === c.id) ? starred : c.starred)).length
  const ops: ((b: WriteBatch) => void)[] = [
    ...changing.map((c) => (b: WriteBatch) => b.update(cardRef(uid, setId, c.id), { starred })),
    (b) => b.update(setRef(uid, setId), { starredCount: starredAfter }),
  ]
  void track(inBatches(ops), 'star cards')
}

/** Loads a set's cards once (from cache when offline). */
export async function loadCards(uid: string, setId: string): Promise<Card[]> {
  const snap = await getDocs(cardsCol(uid, setId))
  return snap.docs.map((d) => toCard(d.data(), d.id)).sort((a, b) => a.order - b.order)
}

/** Copies image docs to new ids so each set owns its images. Returns old -> new id map. */
async function copyImages(
  fromRef: (imageId: string) => ReturnType<typeof imageRef>,
  uid: string,
  imageIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const oldId of new Set(imageIds)) {
    try {
      const snap = await getDoc(fromRef(oldId))
      if (!snap.exists()) continue
      const id = newId()
      await setDoc(imageRef(uid, id), snap.data())
      map.set(oldId, id)
    } catch (err) {
      console.warn('Could not copy image', oldId, err)
    }
  }
  return map
}

export async function duplicateSet(
  uid: string,
  ownerName: string,
  set: StudySet,
  cards: Card[],
  title = `${set.title} (copy)`,
): Promise<string> {
  const images = await copyImages((id) => imageRef(uid, id), uid, cards.flatMap((c) => (c.imageId ? [c.imageId] : [])))
  return createSet(
    uid,
    ownerName,
    { title, description: set.description, termLang: set.termLang, defLang: set.defLang },
    cards.map((c) => ({ ...c, id: undefined, imageId: c.imageId ? (images.get(c.imageId) ?? null) : null })),
  )
}

/** Copies a public set (shared by link) into the user's own library. */
export async function copyPublicSet(
  uid: string,
  ownerName: string,
  publicSetId: string,
  meta: SetMetaInput,
  cards: PublicCard[],
): Promise<string> {
  const images = await copyImages(
    (id) => publicImageRef(publicSetId, id),
    uid,
    cards.flatMap((c) => (c.imageId ? [c.imageId] : [])),
  )
  return createSet(
    uid,
    ownerName,
    { ...meta, visibility: 'private', copiedFrom: publicSetId },
    cards.map((c) => ({
      term: c.term,
      definition: c.definition,
      imageUrl: c.imageUrl ?? null,
      imageId: c.imageId ? (images.get(c.imageId) ?? null) : null,
      tags: c.tags,
    })),
  )
}

export async function deleteSet(uid: string, set: StudySet): Promise<void> {
  let cards: Card[] = []
  try {
    cards = await loadCards(uid, set.id)
  } catch (err) {
    console.warn('Could not list cards before delete', err)
  }
  let testIds: string[] = []
  try {
    const tests = await getDocs(query(testsCol(uid), where('setId', '==', set.id)))
    testIds = tests.docs.map((d) => d.id)
  } catch {
    // Test history is optional to clean up.
  }
  const ops: ((b: WriteBatch) => void)[] = [
    ...cards.map((c) => (b: WriteBatch) => b.delete(cardRef(uid, set.id, c.id))),
    ...cards.flatMap((c) => (c.imageId ? [(b: WriteBatch) => b.delete(imageRef(uid, c.imageId!))] : [])),
    ...testIds.map((id) => (b: WriteBatch) => b.delete(doc(testsCol(uid), id))),
    ...set.folderIds.map((fid) => (b: WriteBatch) => b.update(folderRef(uid, fid), { setIds: arrayRemove(set.id) })),
    (b) => b.delete(progressRef(uid, set.id)),
    (b) => b.delete(sessionRef(uid, set.id)),
    (b) => b.delete(setRef(uid, set.id)),
  ]
  void track(inBatches(ops), 'delete set')
  if (set.visibility === 'link') unpublishSet(set.id)
}

export function addSetToFolder(uid: string, setId: string, folderId: string): void {
  const batch = writeBatch(db)
  batch.update(folderRef(uid, folderId), { setIds: arrayUnion(setId), updatedAt: Date.now() })
  batch.update(setRef(uid, setId), { folderIds: arrayUnion(folderId) })
  void track(batch.commit(), 'add to folder')
}

export function removeSetFromFolder(uid: string, setId: string, folderId: string): void {
  const batch = writeBatch(db)
  batch.update(folderRef(uid, folderId), { setIds: arrayRemove(setId), updatedAt: Date.now() })
  batch.update(setRef(uid, setId), { folderIds: arrayRemove(folderId) })
  void track(batch.commit(), 'remove from folder')
}

// ---------------------------------------------------------------------------
// Sharing by link
// ---------------------------------------------------------------------------

export const PUBLIC_DOC_LIMIT_BYTES = 900_000
/** Matches `d.cards.size() <= 5000` in firestore.rules. */
export const PUBLIC_MAX_CARDS = 5000

export function publicCardsFrom(cards: Card[]): PublicCard[] {
  return cards.map((c) => ({
    id: c.id,
    term: c.term,
    definition: c.definition,
    order: c.order,
    imageId: c.imageId ?? null,
    imageUrl: c.imageUrl ?? null,
    tags: c.tags ?? [],
  }))
}

/** Writes the read-only public copy of a set (and its images). Throws if it is too large. */
export async function publishSet(uid: string, set: StudySet, cards: Card[]): Promise<void> {
  const data = {
    ownerUid: uid,
    ownerName: (set.ownerName || 'Anonymous').slice(0, 100),
    title: set.title.slice(0, 255),
    description: set.description,
    termLang: set.termLang,
    defLang: set.defLang,
    cardCount: cards.length,
    cards: publicCardsFrom(cards),
    updatedAt: Date.now(),
  }
  if (cards.length > PUBLIC_MAX_CARDS) {
    throw new Error(`Sets with more than ${PUBLIC_MAX_CARDS.toLocaleString()} cards can’t be shared by link. Split it into smaller sets.`)
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length
  if (bytes > PUBLIC_DOC_LIMIT_BYTES) {
    throw new Error('This set is too large to share by link (over ~900 KB of text). Split it into smaller sets.')
  }
  void track(setDoc(publicSetRef(set.id), data), 'share set')
  for (const imageId of new Set(cards.flatMap((c) => (c.imageId ? [c.imageId] : [])))) {
    try {
      const snap = await getDoc(imageRef(uid, imageId))
      if (snap.exists()) void track(setDoc(publicImageRef(set.id, imageId), snap.data()), 'share image')
    } catch (err) {
      console.warn('Could not share image', imageId, err)
    }
  }
}

/** Removes the shared copy (images first: their rule checks the parent doc's owner). */
export function unpublishSet(setId: string): void {
  const run = async () => {
    try {
      const imgs = await getDocs(collection(db, 'publicSets', setId, 'images'))
      await Promise.all(imgs.docs.map((d) => deleteDoc(d.ref)))
    } catch (err) {
      console.warn('Could not remove shared images', err)
    }
    await deleteDoc(publicSetRef(setId))
  }
  void track(run(), 'stop sharing')
}

/** Marks a set as studied (shown on Home's "continue where you left off"). */
export function touchStudied(uid: string, setId: string, activity: StudySet['lastActivity']): void {
  void track(updateDoc(setRef(uid, setId), { lastStudiedAt: Date.now(), lastActivity: activity }), 'save activity')
}
