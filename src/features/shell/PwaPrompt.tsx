import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from '../../components/toast'

/** Tells the user when a new version is ready and when the app works offline. */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn('Service worker registration failed', error)
    },
  })

  useEffect(() => {
    if (offlineReady) {
      toast('Ready to work offline', { kind: 'success' })
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady])

  useEffect(() => {
    if (needRefresh)
      toast('A new version is available', {
        duration: 0,
        action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      })
  }, [needRefresh, updateServiceWorker])

  return null
}
