import { useSync } from '../../data/sync'

export function SyncIndicator() {
  const { online, pending } = useSync()
  const state = !online ? 'offline' : pending > 0 ? 'syncing' : 'synced'
  const label = state === 'offline' ? 'Offline, changes will sync' : state === 'syncing' ? 'Syncing…' : 'Synced'
  return (
    <span className={`sync-pill ${state}`} role="status" aria-live="polite" title={label}>
      <span className="dot" aria-hidden />
      <span className={state === 'synced' ? 'hide-mobile' : ''}>{state === 'offline' ? 'Offline' : label}</span>
      {state === 'offline' && <span className="sr-only">, changes will sync</span>}
    </span>
  )
}
