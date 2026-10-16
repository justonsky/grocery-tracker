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
    <div className="flex items-center justify-between gap-2 border-b border-divider bg-accent-800 py-1.5 pr-1 pl-4 text-xs leading-snug text-accent-200">
      <span className="min-w-0 py-1.5">
        Install this app to your Home Screen (Share{' '}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="inline-block -translate-y-px align-middle"
        >
          <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>{' '}
        then Add to Home Screen) so it can safely hold onto changes you make while away from home.
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="btn btn-ghost btn-icon flex-none text-accent-200 hover:bg-accent/10">
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
