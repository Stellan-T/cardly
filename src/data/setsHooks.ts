import { query } from 'firebase/firestore'
import { useMemo } from 'react'
import type { StudySet } from '../types'
import { useLiveQuery } from './hooks'
import { toFolder, toStudySet } from './mappers'
import { foldersCol, setsCol } from './paths'

/** All of the user's sets (drafts included), newest activity first. */
export function useMySets(uid: string | null) {
  const res = useLiveQuery(uid ? query(setsCol(uid)) : null, uid ? `sets/${uid}` : null, toStudySet)
  const sorted = useMemo(
    () =>
      [...res.data].sort(
        (a, b) => Math.max(b.lastStudiedAt ?? 0, b.updatedAt) - Math.max(a.lastStudiedAt ?? 0, a.updatedAt),
      ),
    [res.data],
  )
  return { ...res, data: sorted }
}

export function useMyFolders(uid: string | null) {
  const res = useLiveQuery(uid ? query(foldersCol(uid)) : null, uid ? `folders/${uid}` : null, toFolder)
  const sorted = useMemo(() => [...res.data].sort((a, b) => a.name.localeCompare(b.name)), [res.data])
  return { ...res, data: sorted }
}

export const isStudyable = (s: StudySet) => !s.draft
