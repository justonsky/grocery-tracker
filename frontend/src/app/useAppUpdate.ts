import { useCallback, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { stashProfileForUpdate } from './updateResume'

// How often an open app asks the server for a new build. Browsers only look by themselves when
// a page loads (and about daily), and this app stays open or is resumed from the background.
const CHECK_EVERY_MS = 30 * 60_000
// Coming back to the app checks again, but not more than this often.
const MIN_GAP_MS = 60_000
// If the new service worker hasn't taken over by then, reload anyway (the reload finishes it).
const TAKEOVER_TIMEOUT_MS = 4_000

// The service worker (vite-plugin-pwa, registerType 'prompt') keeps the app's shell on the
// device. A new deploy installs alongside it and waits; `updateReady` says so, and `applyUpdate`
// lets it take over and reloads this tab back into the same profile and page. Never reloads by
// itself: the user may be mid-edit, and only they know a good moment.
export function useAppUpdate() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const {
    needRefresh: [updateReady],
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      if (!r) return
      registration.current = r
      let lastCheck = Date.now()
      const check = () => {
        if (r.installing || !navigator.onLine || Date.now() - lastCheck < MIN_GAP_MS) return
        lastCheck = Date.now()
        // Rejects while the server is unreachable; the next check tries again.
        r.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('online', check)
    },
    // The plugin's default reloads every open tab when the new worker takes over. Only the tab
    // whose button was pressed reloads (applyUpdate); the others keep showing the banner.
    onNeedReload() {},
  })

  const applyUpdate = useCallback((profileId: string | null) => {
    stashProfileForUpdate(profileId)
    const waiting = registration.current?.waiting
    // Already taken over (another tab applied it): the reload alone picks up the new build.
    if (!waiting || !navigator.serviceWorker) {
      window.location.reload()
      return
    }
    let reloaded = false
    const reload = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    setTimeout(reload, TAKEOVER_TIMEOUT_MS)
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  return { updateReady, applyUpdate }
}
