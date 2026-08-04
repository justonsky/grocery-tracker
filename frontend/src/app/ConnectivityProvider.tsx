import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { api } from '../api/client'

export type ConnectivityStatus = 'checking' | 'online' | 'offline' | 'wrong-server'

interface ConnectivityContextValue {
  status: ConnectivityStatus
  lastCheckedAt: number | null
  serverInstanceId: string | null
  checkNow: () => void
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null)

// Home-LAN private addresses (192.168.x.x) are commonly reused across
// networks — "something answered on this port" is not proof it's *your*
// server. Once we've seen a real grocery-tracker instanceId, any other one
// is a distinct "wrong-server" state, not "online".
const KNOWN_SERVER_KEY = 'grocery-tracker-known-server-instance-id'

const PROBE_TIMEOUT_MS = 3000
const REACHABLE_POLL_MS = 30_000
const HIDDEN_POLL_MS = REACHABLE_POLL_MS * 4
const BACKOFF_STEPS_MS = [2000, 4000, 8000, 15_000, 30_000]

function withTimeout(ms: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) }
}

function jitter(ms: number) {
  const delta = ms * 0.2
  return ms + (Math.random() * 2 - 1) * delta
}

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: ConnectivityStatus
    lastCheckedAt: number | null
    serverInstanceId: string | null
  }>({ status: 'checking', lastCheckedAt: null, serverInstanceId: null })

  const failuresRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const probeRef = useRef<() => Promise<void>>(async () => {})
  // The effect below runs once ([] deps) — `state` inside its closures would
  // otherwise be frozen at the initial render. Mirror the live status here.
  const statusRef = useRef<ConnectivityStatus>('checking')

  useEffect(() => {
    mountedRef.current = true

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const scheduleNext = (delayMs: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        void probeRef.current()
      }, delayMs)
    }

    const probe = async () => {
      if (inFlightRef.current) return
      // Once healthy, don't poll a hidden tab at all — visibilitychange
      // re-triggers a probe the moment it becomes visible again. A tab
      // that's currently failing keeps retrying in the background (at the
      // hidden-poll cadence below) so recovery isn't missed.
      if (document.visibilityState === 'hidden' && failuresRef.current === 0 && statusRef.current === 'online') {
        return
      }

      inFlightRef.current = true
      const { signal, cancel } = withTimeout(PROBE_TIMEOUT_MS)
      try {
        const health = await api.health(signal)
        cancel()
        if (!mountedRef.current) return

        const known = localStorage.getItem(KNOWN_SERVER_KEY)
        const isKnownServer = health.service === 'grocery-tracker' && (known === null || known === health.instanceId)

        if (!isKnownServer) {
          failuresRef.current = 0
          statusRef.current = 'wrong-server'
          setState({ status: 'wrong-server', lastCheckedAt: Date.now(), serverInstanceId: health.instanceId })
          scheduleNext(REACHABLE_POLL_MS)
          return
        }

        if (known === null) {
          localStorage.setItem(KNOWN_SERVER_KEY, health.instanceId)
        }

        failuresRef.current = 0
        statusRef.current = 'online'
        setState({ status: 'online', lastCheckedAt: Date.now(), serverInstanceId: health.instanceId })
        scheduleNext(document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : REACHABLE_POLL_MS)
      } catch {
        cancel()
        if (!mountedRef.current) return
        failuresRef.current += 1
        // Two consecutive failures before declaring offline — debounces a
        // single dropped packet rather than flapping the indicator.
        const nowOffline = failuresRef.current >= 2
        if (nowOffline) statusRef.current = 'offline'
        setState((s) => ({
          status: nowOffline ? 'offline' : s.status,
          lastCheckedAt: Date.now(),
          serverInstanceId: s.serverInstanceId,
        }))
        const step = Math.min(failuresRef.current - 1, BACKOFF_STEPS_MS.length - 1)
        scheduleNext(jitter(BACKOFF_STEPS_MS[step]))
      } finally {
        inFlightRef.current = false
      }
    }

    probeRef.current = probe

    // Trust the negative signal immediately — navigator.onLine === false is
    // reliable even though `true` means nothing (cellular ≠ server reachable).
    const handleOffline = () => {
      clearTimer()
      failuresRef.current = 2
      statusRef.current = 'offline'
      setState((s) => ({ status: 'offline', lastCheckedAt: Date.now(), serverInstanceId: s.serverInstanceId }))
    }
    const handleOnlineOrVisible = () => {
      void probe()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleOnlineOrVisible()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnlineOrVisible)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    void probe()

    return () => {
      mountedRef.current = false
      clearTimer()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnlineOrVisible)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drives TanStack Query's own pause/resume behavior: with this wired,
  // queries stop firing doomed fetches while offline (and keep showing
  // cached data) instead of retrying against a server that isn't there.
  useEffect(() => {
    onlineManager.setOnline(state.status === 'online')
  }, [state.status])

  const checkNow = useCallback(() => {
    void probeRef.current()
  }, [])

  return <ConnectivityContext.Provider value={{ ...state, checkNow }}>{children}</ConnectivityContext.Provider>
}

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext)
  if (!ctx) throw new Error('useConnectivity must be used within ConnectivityProvider')
  return ctx
}
