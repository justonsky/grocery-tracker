import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createRealDrainDeps, runDrainWithLock } from '../offline/drain'
import { countOutstanding, discardOp, getOpsByStatus, onOutboxChanged, retryOp } from '../offline/outbox'
import { getMetaValue, setMetaValue } from '../offline/db'
import type { OutboxOp } from '../offline/types'
import { useConnectivity } from './ConnectivityProvider'
import { useToast } from '../components/ui/ToastProvider'

// Past this many queued changes, something is almost certainly wrong (a
// device left offline for weeks, or a stuck failed op silently blocking
// everything behind it) rather than normal away-from-home usage.
const OUTBOX_WARN_THRESHOLD = 500

interface SyncContextValue {
  pendingCount: number
  isDraining: boolean
  triggerSync: () => void
  failedOps: OutboxOp[]
  blockedOps: OutboxOp[]
  retryFailedOp: (op: OutboxOp) => Promise<void>
  discardFailedOp: (op: OutboxOp) => Promise<void>
  retryAllFailed: () => Promise<void>
  lastSyncAt: number | null
}

const SyncContext = createContext<SyncContextValue | null>(null)

// Owns draining the offline outbox: automatically the moment the home server
// becomes reachable again, or on demand via triggerSync() (the sync button).
// Reads connectivity from ConnectivityProvider rather than duplicating the
// reachability probe.
export function SyncProvider({ children }: { children: ReactNode }) {
  const { status, checkNow } = useConnectivity()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [pendingCount, setPendingCount] = useState(0)
  const [isDraining, setIsDraining] = useState(false)
  const [failedOps, setFailedOps] = useState<OutboxOp[]>([])
  const [blockedOps, setBlockedOps] = useState<OutboxOp[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const drainingRef = useRef(false)
  // Only warn once per crossing of the threshold, not on every refresh while
  // it stays high — re-arms once the count drops back below it.
  const warnedRef = useRef(false)

  const refreshAll = useCallback(() => {
    void countOutstanding().then((count) => {
      setPendingCount(count)
      if (count >= OUTBOX_WARN_THRESHOLD && !warnedRef.current) {
        warnedRef.current = true
        toast('error', `You have ${count} changes waiting to sync — connect to your home network soon to avoid losing work.`)
      } else if (count < OUTBOX_WARN_THRESHOLD) {
        warnedRef.current = false
      }
    })
    void getOpsByStatus('failed').then(setFailedOps)
    void getOpsByStatus('blocked').then(setBlockedOps)
  }, [toast])

  useEffect(() => {
    void getMetaValue('lastSyncAt').then((v) => setLastSyncAt(typeof v === 'number' ? v : null))
  }, [])

  useEffect(() => {
    refreshAll()
    return onOutboxChanged(refreshAll)
  }, [refreshAll])

  const runDrain = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    setIsDraining(true)
    try {
      const summary = await runDrainWithLock(createRealDrainDeps())
      // null means another tab already holds the drain lock — nothing to do
      // here; that tab's own SyncProvider will invalidate queries when done.
      if (summary && !summary.stoppedEarly) {
        // Reaching the end of the queue (rather than aborting on a transient
        // network failure) means we successfully talked to the home server
        // just now, whether or not there was anything to send.
        const now = Date.now()
        await setMetaValue('lastSyncAt', now)
        setLastSyncAt(now)
      }
      if (summary && summary.succeeded.length > 0) {
        // Something actually landed server-side — screens may have been
        // showing pre-sync stale data (this build doesn't do optimistic
        // cache splicing for queued writes; see TripEditor/ListEditor).
        await queryClient.invalidateQueries()
      }
    } finally {
      drainingRef.current = false
      setIsDraining(false)
      refreshAll()
    }
  }, [queryClient, refreshAll])

  useEffect(() => {
    if (status === 'online') {
      void runDrain()
    }
  }, [status, runDrain])

  // A manual tap should always re-check reachability, not just retry the
  // drain — otherwise tapping the pill while offline with an empty outbox
  // does nothing observable at all (nothing to drain, and the stale
  // connectivity status never gets refreshed on its own until the next
  // scheduled probe, up to 30s away).
  const triggerSync = useCallback(() => {
    checkNow()
    void runDrain()
  }, [checkNow, runDrain])

  const retryFailedOp = useCallback(
    async (op: OutboxOp) => {
      await retryOp(op)
      void runDrain()
    },
    [runDrain],
  )

  const discardFailedOp = useCallback(async (op: OutboxOp) => {
    await discardOp(op)
  }, [])

  const retryAllFailed = useCallback(async () => {
    for (const op of failedOps) {
      await retryOp(op)
    }
    void runDrain()
  }, [failedOps, runDrain])

  return (
    <SyncContext.Provider
      value={{ pendingCount, isDraining, triggerSync, failedOps, blockedOps, retryFailedOp, discardFailedOp, retryAllFailed, lastSyncAt }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within SyncProvider')
  return ctx
}
