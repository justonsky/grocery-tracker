// The latest connectivity verdict, readable outside React. ConnectivityProvider
// writes it; performOrQueue reads it to hold writes on the device while the
// server that answers isn't this device's home server.
export type ConnectivityStatus = 'checking' | 'online' | 'offline' | 'wrong-server'

let current: ConnectivityStatus = 'checking'

export const getConnectivityStatus = () => current

// The instance id of the server this device last trusted (see ConnectivityProvider).
export const KNOWN_SERVER_KEY = 'grocery-tracker-known-server-instance-id'

export function hasKnownServer(): boolean {
  try {
    return localStorage.getItem(KNOWN_SERVER_KEY) !== null
  } catch {
    return false
  }
}
export const setConnectivityStatus = (status: ConnectivityStatus) => {
  current = status
}
