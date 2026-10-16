/**
 * Sync status for the indicator in the top bar. Firestore write promises only
 * resolve once the server has acknowledged the write, so "pending" counts
 * writes that are still waiting to sync (e.g. while offline).
 */
import { create } from 'zustand'

interface SyncState {
  online: boolean
  pending: number
  lastError: string | null
}

export const useSync = create<SyncState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  lastError: null,
}))

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useSync.setState({ online: true }))
  window.addEventListener('offline', () => useSync.setState({ online: false }))
}

/**
 * Tracks a write for the sync indicator. Never await a write in UI code: with
 * offline persistence the local cache updates immediately, and the promise only
 * settles when the server confirms.
 */
export function track<T>(promise: Promise<T>, label = 'save'): Promise<T | undefined> {
  useSync.setState((s) => ({ pending: s.pending + 1 }))
  return promise
    .then((v) => {
      useSync.setState({ lastError: null })
      return v
    })
    .catch((err: unknown) => {
      console.error(`Failed to ${label}`, err)
      useSync.setState({ lastError: err instanceof Error ? err.message : String(err) })
      return undefined
    })
    .finally(() => useSync.setState((s) => ({ pending: Math.max(0, s.pending - 1) })))
}
