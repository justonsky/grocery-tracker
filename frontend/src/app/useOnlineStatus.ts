import { useConnectivity } from './ConnectivityProvider'

// Thin shim over ConnectivityProvider's real reachability probe (a `/health`
// round-trip, not navigator.onLine — see ConnectivityProvider for why),
// kept so existing disabled={!isOnline}-style call sites don't need to
// change. 'wrong-server' counts as NOT online: a server we can't verify as
// ours isn't safe to write to, even though *something* answered.
export function useOnlineStatus(): boolean {
  const { status } = useConnectivity()
  return status === 'online'
}
