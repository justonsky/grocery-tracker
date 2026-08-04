import { useConnectivity } from './ConnectivityProvider'
import { useSync } from './SyncProvider'
import { useToast } from '../components/ui/ToastProvider'

interface ViewState {
  label: string
  tooltip: string
  danger: boolean
  accentWork: boolean
}

// Centralizes the state → label/tooltip/color mapping so the pill and the
// strip can never disagree about what's currently true. Priority order:
// failures needing attention outrank everything else, since they're the one
// state that won't resolve on its own.
function computeView(
  status: string,
  pendingCount: number,
  isDraining: boolean,
  failedCount: number,
  blockedCount: number,
): ViewState {
  if (failedCount > 0) {
    return {
      label: `${failedCount} needs attention`,
      tooltip: `${failedCount} ${failedCount === 1 ? 'change' : 'changes'} couldn't be synced — tap for details`,
      danger: true,
      accentWork: false,
    }
  }
  if (isDraining) {
    return { label: 'Syncing…', tooltip: 'Uploading your changes to your home server…', danger: false, accentWork: true }
  }
  if (status === 'wrong-server') {
    return {
      label: 'Different server',
      tooltip: "Reached a server, but it isn't your home server",
      danger: true,
      accentWork: false,
    }
  }
  if (status === 'offline') {
    const waiting = pendingCount + blockedCount
    return {
      label: waiting > 0 ? `${waiting} waiting` : 'Offline',
      tooltip:
        waiting > 0
          ? "Can't reach your home server — these changes are saved on this device and will sync automatically once you're back online"
          : "Can't reach your home server — tap to check again",
      danger: true,
      accentWork: false,
    }
  }
  if (status === 'checking') {
    return { label: 'Checking…', tooltip: 'Checking connection…', danger: false, accentWork: false }
  }
  // online, clean or with outstanding (non-failed) work
  const waiting = pendingCount + blockedCount
  return {
    label: waiting > 0 ? `Sync ${waiting} ${waiting === 1 ? 'change' : 'changes'}` : 'Synced',
    tooltip: waiting > 0 ? 'Tap to upload your changes now' : 'Connected to your home server',
    danger: false,
    accentWork: waiting > 0,
  }
}

function useSyncStatusView() {
  const { status } = useConnectivity()
  const { pendingCount, isDraining, failedOps, blockedOps, triggerSync } = useSync()
  const toast = useToast()

  const view = computeView(status, pendingCount, isDraining, failedOps.length, blockedOps.length)

  const handleClick = (onOpenFailures: () => void) => {
    if (failedOps.length > 0) {
      onOpenFailures()
      return
    }
    if (status === 'wrong-server') {
      toast('error', "Reached a server, but it isn't your home server — check you're on the right network.")
      return
    }
    triggerSync()
  }

  return { view, isDraining, handleClick }
}

// Desktop nav pill — a real button (was a passive, non-interactive span).
export function SyncStatusPill({ onOpenFailures }: { onOpenFailures: () => void }) {
  const { view, isDraining, handleClick } = useSyncStatusView()

  return (
    <button
      type="button"
      className={`tag flex items-center gap-1.5 border-none ${!view.danger && !view.accentWork ? 'tag-accent' : 'tag-neutral'}`}
      style={view.danger ? { color: 'var(--color-danger)' } : view.accentWork ? { color: 'var(--color-accent)' } : undefined}
      onClick={() => handleClick(onOpenFailures)}
      disabled={isDraining}
      aria-live="polite"
      title={view.tooltip}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${isDraining ? 'animate-pulse' : ''}`}
        style={{ background: 'currentcolor' }}
      />
      {view.label}
    </button>
  )
}

// Mobile-only status strip above the bottom tab bar — occupies zero pixels
// when online and clean, so it doesn't compete with the pill for a single
// connectivity surface per breakpoint (desktop: pill in the nav; mobile: strip).
export function SyncStatusStrip({ onOpenFailures }: { onOpenFailures: () => void }) {
  const { status } = useConnectivity()
  const { pendingCount, isDraining, failedOps, blockedOps } = useSync()
  const { view, handleClick } = useSyncStatusView()

  const clean = status === 'online' && pendingCount === 0 && failedOps.length === 0 && blockedOps.length === 0 && !isDraining
  if (clean || status === 'checking') return null

  return (
    <button
      type="button"
      onClick={() => handleClick(onOpenFailures)}
      disabled={isDraining}
      className="w-full border-none px-4 py-2 text-center text-xs"
      style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
    >
      {view.tooltip}
    </button>
  )
}
