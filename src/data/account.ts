/**
 * Whole-account operations: JSON export/import, merging a guest account into a
 * signed-in one, and deleting all data.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentData,
  type WriteBatch,
} from 'firebase/firestore'
import { APP_NAME } from '../config/app'
import { db } from '../firebase'
import {
  cardRef,
  cardsCol,
  folderRef,
  foldersCol,
  imageRef,
  imagesCol,
  leaderboardRef,
  progressRef,
  sessionRef,
  setRef,
  setsCol,
  testsCol,
  userRef,
} from './paths'

export interface BackupSet {
  id: string
  data: DocumentData
  cards: { id: string; data: DocumentData }[]
}

export interface Backup {
  app: string
  version: 1
  exportedAt: number
  user: DocumentData | null
  sets: BackupSet[]
  progress: Record<string, DocumentData>
  sessions: Record<string, DocumentData>
  folders: { id: string; data: DocumentData }[]
  tests: { id: string; data: DocumentData }[]
  images: { id: string; data: DocumentData }[]
}

const sub = (uid: string, name: string) => collection(db, 'users', uid, name)

export async function exportAllData(uid: string): Promise<Backup> {
  const [userSnap, setsSnap, progressSnap, sessionsSnap, foldersSnap, testsSnap, imagesSnap] = await Promise.all([
    getDoc(userRef(uid)),
    getDocs(setsCol(uid)),
    getDocs(sub(uid, 'progress')),
    getDocs(sub(uid, 'sessions')),
    getDocs(foldersCol(uid)),
    getDocs(testsCol(uid)),
    getDocs(imagesCol(uid)),
  ])
  const sets: BackupSet[] = []
  for (const s of setsSnap.docs) {
    const cards = await getDocs(cardsCol(uid, s.id))
    sets.push({ id: s.id, data: s.data(), cards: cards.docs.map((c) => ({ id: c.id, data: c.data() })) })
  }
  return {
    app: APP_NAME,
    version: 1,
    exportedAt: Date.now(),
    user: userSnap.exists() ? userSnap.data() : null,
    sets,
    progress: Object.fromEntries(progressSnap.docs.map((d) => [d.id, d.data()])),
    sessions: Object.fromEntries(sessionsSnap.docs.map((d) => [d.id, d.data()])),
    folders: foldersSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
    tests: testsSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
    images: imagesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
  }
}

export function isBackup(value: unknown): value is Backup {
  const b = value as Backup
  return !!b && typeof b === 'object' && b.version === 1 && Array.isArray(b.sets)
}

type Op = ((b: WriteBatch) => void) & { bytes?: number }

/** Tags a write with its approximate payload size so batches stay under Firestore's 10 MiB request limit. */
const sized = (op: (b: WriteBatch) => void, data: unknown): Op => Object.assign(op, { bytes: JSON.stringify(data).length })

const MAX_BATCH_OPS = 400
const MAX_BATCH_BYTES = 8_000_000

async function commitOps(ops: Op[]) {
  let batch = writeBatch(db)
  let count = 0
  let bytes = 0
  for (const op of ops) {
    const size = op.bytes ?? 0
    if (count > 0 && (count >= MAX_BATCH_OPS || bytes + size > MAX_BATCH_BYTES)) {
      await batch.commit()
      batch = writeBatch(db)
      count = 0
      bytes = 0
    }
    op(batch)
    count++
    bytes += size
  }
  if (count > 0) await batch.commit()
}

/**
 * Writes a backup into an account (keeping document ids, so importing the same
 * backup twice overwrites rather than duplicates). Settings are only restored
 * when `includeSettings` is set.
 */
export async function importBackup(
  uid: string,
  ownerName: string,
  backup: Backup,
  options: { includeSettings?: boolean } = {},
): Promise<{ sets: number }> {
  const ops: Op[] = []
  const owner = ownerName.slice(0, 100)
  for (const set of backup.sets) {
    const data = { ...set.data, ownerUid: uid, ownerName: owner, visibility: 'private' }
    ops.push(sized((b) => b.set(setRef(uid, set.id), data), data))
    for (const c of set.cards) ops.push(sized((b) => b.set(cardRef(uid, set.id, c.id), c.data), c.data))
  }
  for (const [id, data] of Object.entries(backup.progress)) ops.push(sized((b) => b.set(progressRef(uid, id), data), data))
  for (const [id, data] of Object.entries(backup.sessions)) ops.push(sized((b) => b.set(sessionRef(uid, id), data), data))
  for (const f of backup.folders) ops.push(sized((b) => b.set(folderRef(uid, f.id), f.data), f.data))
  for (const t of backup.tests) ops.push(sized((b) => b.set(doc(testsCol(uid), t.id), t.data), t.data))
  for (const img of backup.images) ops.push(sized((b) => b.set(imageRef(uid, img.id), img.data), img.data))
  if (options.includeSettings && backup.user?.settings) {
    ops.push((b) => b.set(userRef(uid), { settings: backup.user!.settings }, { merge: true }))
  }
  await commitOps(ops)
  return { sets: backup.sets.length }
}

/** Deletes every document belonging to the user (sets, progress, shared copies, leaderboard entries). */
export async function deleteAllData(uid: string): Promise<void> {
  const backup = await exportAllData(uid)
  const ops: Op[] = []
  for (const set of backup.sets) {
    for (const c of set.cards) ops.push((b) => b.delete(cardRef(uid, set.id, c.id)))
    ops.push((b) => b.delete(setRef(uid, set.id)))
  }
  for (const id of Object.keys(backup.progress)) ops.push((b) => b.delete(progressRef(uid, id)))
  for (const id of Object.keys(backup.sessions)) ops.push((b) => b.delete(sessionRef(uid, id)))
  for (const f of backup.folders) ops.push((b) => b.delete(folderRef(uid, f.id)))
  for (const t of backup.tests) ops.push((b) => b.delete(doc(testsCol(uid), t.id)))
  for (const img of backup.images) ops.push((b) => b.delete(imageRef(uid, img.id)))
  const lbSets: string[] = Array.isArray(backup.user?.leaderboardSetIds) ? backup.user!.leaderboardSetIds : []
  for (const setId of lbSets) ops.push((b) => b.delete(leaderboardRef(setId, uid)))
  await commitOps(ops)
  const shared = await getDocs(query(collection(db, 'publicSets'), where('ownerUid', '==', uid)))
  for (const d of shared.docs) {
    const imgs = await getDocs(collection(db, 'publicSets', d.id, 'images'))
    await commitOps(imgs.docs.map((i) => (b: WriteBatch) => b.delete(i.ref)))
    await deleteDoc(d.ref)
  }
  await deleteDoc(userRef(uid))
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
