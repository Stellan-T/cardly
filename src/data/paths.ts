import { collection, doc } from 'firebase/firestore'
import { db } from '../firebase'

export const userRef = (uid: string) => doc(db, 'users', uid)
export const setsCol = (uid: string) => collection(db, 'users', uid, 'sets')
export const setRef = (uid: string, setId: string) => doc(db, 'users', uid, 'sets', setId)
export const cardsCol = (uid: string, setId: string) => collection(db, 'users', uid, 'sets', setId, 'cards')
export const cardRef = (uid: string, setId: string, cardId: string) =>
  doc(db, 'users', uid, 'sets', setId, 'cards', cardId)
export const progressRef = (uid: string, setId: string) => doc(db, 'users', uid, 'progress', setId)
export const sessionRef = (uid: string, setId: string) => doc(db, 'users', uid, 'sessions', setId)
export const foldersCol = (uid: string) => collection(db, 'users', uid, 'folders')
export const folderRef = (uid: string, folderId: string) => doc(db, 'users', uid, 'folders', folderId)
export const testsCol = (uid: string) => collection(db, 'users', uid, 'tests')
export const imagesCol = (uid: string) => collection(db, 'users', uid, 'images')
export const imageRef = (uid: string, imageId: string) => doc(db, 'users', uid, 'images', imageId)
export const publicSetRef = (setId: string) => doc(db, 'publicSets', setId)
export const publicImageRef = (setId: string, imageId: string) => doc(db, 'publicSets', setId, 'images', imageId)
export const leaderboardCol = (setId: string) => collection(db, 'leaderboards', setId, 'match')
export const leaderboardRef = (setId: string, uid: string) => doc(db, 'leaderboards', setId, 'match', uid)

/** A fresh Firestore document id (generated client-side, works offline). */
export const newId = () => doc(collection(db, '_ids')).id
