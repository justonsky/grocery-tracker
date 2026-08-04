import { useEffect, useState } from 'react'

const DISMISS_KEY = 'gt-ios-install-hint-dismissed'

// iOS Safari purges IndexedDB/localStorage for sites that aren't installed
// to the Home Screen after ~7 days without interaction — exactly the outbox
// this app depends on to survive a trip away from home. Installing (Share ->
// Add to Home Screen) runs the site in "standalone" mode, which iOS exempts
// from that eviction policy.
function isEligible(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
  const nav = navigator as Navigator & { standalone?: boolean }
  const isStandalone = nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
  return isIos && !isStandalone
}

export function IosInstallHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return
    setVisible(isEligible())
  }, [])

  if (!visible) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider bg-surface px-4 py-2 text-xs text-text/80">
      <span>
        Install this app to your Home Screen (Share <span aria-hidden>⬆</span> → Add to Home Screen) so it can safely hold onto changes
        you make while away from home.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-none cursor-pointer border-none bg-transparent px-1 text-sm text-text/60"
      >
        ×
      </button>
    </div>
  )
}
