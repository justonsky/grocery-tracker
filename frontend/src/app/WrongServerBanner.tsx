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
    <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider bg-danger-bg px-4 py-3 text-sm">
      <p className="m-0 flex-1 basis-80">
        <strong>This isn't the server this device last used.</strong> If you reset or reinstalled your home server, switch to it
        — this device will reload its data from it
        {pendingCount > 0 ? `, and send it the ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to sync` : ''}.
        If you don't recognize it, check you're on your home network.
      </p>
      <button
        type="button"
        className="btn btn-primary shrink-0"
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
  )
}
