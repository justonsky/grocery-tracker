import { useState } from 'react'
import { useAppUpdate } from './useAppUpdate'

// Shown on every screen, the profile picker included, once a newer build of the app has been
// deployed and downloaded. Reloading keeps the open profile and page; queued offline changes
// are in IndexedDB and survive it, and an unsaved form still gets the browser's leave prompt.
export function UpdateBanner({ profileId }: { profileId: string | null }) {
  const { updateReady, applyUpdate } = useAppUpdate()
  const [busy, setBusy] = useState(false)
  if (!updateReady) return null

  return (
    <div role="status" className="border-b border-divider bg-surface px-4 py-2.5 text-sm text-text">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3">
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
          className="shrink-0 text-accent"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
        <p className="m-0 min-w-0 flex-1 leading-snug">
          <strong className="font-bold">A new version is ready.</strong> <span className="text-text/70">Reload to start using it.</span>
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm shrink-0"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            applyUpdate(profileId)
            // If the user stays on the page at the browser's "Leave site?" prompt, offer it again.
            setTimeout(() => setBusy(false), 5_000)
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
