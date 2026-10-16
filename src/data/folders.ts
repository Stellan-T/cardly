import { arrayRemove, deleteDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import type { Folder } from '../types'
import { folderRef, newId, setRef } from './paths'
import { track } from './sync'

/** Folder names are capped at 255 characters by firestore.rules. */
const cleanName = (name: string) => (name.trim() || 'Untitled folder').slice(0, 255)

export function createFolder(uid: string, name: string, setIds: string[] = []): string {
  const id = newId()
  const now = Date.now()
  void track(setDoc(folderRef(uid, id), { name: cleanName(name), setIds, createdAt: now, updatedAt: now }), 'create folder')
  return id
}

export function renameFolder(uid: string, folderId: string, name: string) {
  void track(updateDoc(folderRef(uid, folderId), { name: cleanName(name), updatedAt: Date.now() }), 'rename folder')
}

export function deleteFolder(uid: string, folder: Folder) {
  const batch = writeBatch(db)
  for (const setId of folder.setIds) batch.update(setRef(uid, setId), { folderIds: arrayRemove(folder.id) })
  batch.delete(folderRef(uid, folder.id))
  void track(batch.commit().catch(() => deleteDoc(folderRef(uid, folder.id))), 'delete folder')
}
