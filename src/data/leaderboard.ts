import { getDoc, limit, orderBy, query, setDoc } from 'firebase/firestore'
import type { LeaderboardEntry } from '../types'
import { useLiveQuery } from './hooks'
import { leaderboardCol, leaderboardRef } from './paths'
import { track } from './sync'
import { rememberLeaderboard } from './user'

/** Saves a Match time to the set's public leaderboard if it beats the user's entry. */
export async function submitMatchTime(setId: string, uid: string, displayName: string, ms: number) {
  try {
    const snap = await getDoc(leaderboardRef(setId, uid))
    const best = snap.exists() ? (snap.data().bestTimeMs as number) : Infinity
    if (ms >= best) return
  } catch {
    // Offline: write anyway; the local cache will sync later.
  }
  void track(
    setDoc(leaderboardRef(setId, uid), { displayName: displayName.slice(0, 60) || 'Anonymous', bestTimeMs: Math.round(ms), achievedAt: Date.now() }),
    'save leaderboard',
  )
  rememberLeaderboard(uid, setId)
}

export function useLeaderboard(setId: string | null, enabled: boolean) {
  const q = setId && enabled ? query(leaderboardCol(setId), orderBy('bestTimeMs', 'asc'), limit(10)) : null
  return useLiveQuery<LeaderboardEntry>(q, setId && enabled ? `lb/${setId}` : null, (d, id) => ({
    uid: id,
    displayName: String(d.displayName ?? 'Anonymous'),
    bestTimeMs: Number(d.bestTimeMs ?? 0),
    achievedAt: Number(d.achievedAt ?? 0),
  }))
}
