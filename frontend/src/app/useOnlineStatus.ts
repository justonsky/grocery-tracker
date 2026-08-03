import { useEffect, useState } from 'react'

// Tracks connectivity to the local server (a shared self-hosted backend, not a
// per-device copy — see the architecture plan's local-first tradeoff). Drives
// the nav's sync-status indicator and disables mutating actions while offline
// rather than silently queuing them for later.
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}
