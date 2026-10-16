import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type FirestoreError,
  type Query,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

export interface LiveResult<T> {
  data: T
  loading: boolean
  error: FirestoreError | null
  /** True when the data came from the local cache and the server hasn't confirmed it yet. */
  fromCache: boolean
  exists: boolean
}

/**
 * Subscribes to one document. `key` must change whenever `ref` changes
 * (refs aren't referentially stable); pass null to skip.
 */
export function useLiveDoc<T>(
  ref: DocumentReference<DocumentData> | null,
  key: string | null,
  map: (data: DocumentData, id: string) => T,
  fallback: T,
): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T> & { key: string | null }>({
    data: fallback,
    loading: !!ref,
    error: null,
    fromCache: false,
    exists: false,
    key,
  })
  useEffect(() => {
    if (!ref) {
      setState({ data: fallback, loading: false, error: null, fromCache: false, exists: false, key })
      return
    }
    setState((s) => (s.key === key ? s : { data: fallback, loading: true, error: null, fromCache: false, exists: false, key }))
    return onSnapshot(
      ref,
      { includeMetadataChanges: false },
      (snap) =>
        setState({
          data: snap.exists() ? map(snap.data(), snap.id) : fallback,
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
          exists: snap.exists(),
          key,
        }),
      (error) => setState({ data: fallback, loading: false, error, fromCache: false, exists: false, key }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : { data: fallback, loading: !!ref, error: null, fromCache: false, exists: false }
}

/** Subscribes to a query. `key` must change whenever the query changes; pass null to skip. */
export function useLiveQuery<T>(
  query: Query<DocumentData> | null,
  key: string | null,
  map: (data: DocumentData, id: string) => T,
): LiveResult<T[]> {
  const [state, setState] = useState<LiveResult<T[]> & { key: string | null }>({
    data: [],
    loading: !!query,
    error: null,
    fromCache: false,
    exists: false,
    key,
  })
  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null, fromCache: false, exists: false, key })
      return
    }
    setState((s) => (s.key === key ? s : { data: [], loading: true, error: null, fromCache: false, exists: false, key }))
    return onSnapshot(
      query,
      (snap) =>
        setState({
          data: snap.docs.map((d) => map(d.data(), d.id)),
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
          exists: !snap.empty,
          key,
        }),
      (error) => setState({ data: [], loading: false, error, fromCache: false, exists: false, key }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : { data: [], loading: !!query, error: null, fromCache: false, exists: false }
}
