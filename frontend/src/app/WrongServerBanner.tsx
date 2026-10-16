import { useState } from 'react'
import { useConnectivity } from './ConnectivityProvider'
import { useSync } from './SyncProvider'

// Shown on every screen, the profile picker included, while the server that
// answers isn't the one this device knows. Until the user decides, the app
// shows only what it had cached — nothing is refetched — which otherwise looks
// like new profiles and items silently failing to appear.
export function WrongServerBanner() {
  const { status, adoptCurrentServer } = useConnectivity()
  const { pendingCount } = useSync()
  const [busy, setBusy] = useState(false)
  if (status !== 'wrong-server') return null

  return (
    <div role="alert" className="border-b border-danger/30 bg-danger-bg px-4 py-3 text-sm text-text">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0 text-danger"
          >
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
          </svg>
          <p className="m-0 min-w-0 leading-relaxed">
            <strong className="font-bold">This isn't the server this device last used.</strong> If you reset or reinstalled your home server, switch to it
            — this device will reload its data from it
            {pendingCount > 0 ? `, and send it the ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to sync` : ''}.
            If you don't recognize it, check you're on your home network.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary shrink-0 max-sm:w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await adoptCurrentServer()
            } finally {
              setBusy(false)
            }
          }}
        >
          Use this server
        </button>
      </div>
    </div>
  )
}
