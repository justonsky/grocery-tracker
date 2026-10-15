// The latest connectivity verdict, readable outside React. ConnectivityProvider
// writes it; performOrQueue reads it to hold writes on the device while the
// server that answers isn't this device's home server.
export type ConnectivityStatus = 'checking' | 'online' | 'offline' | 'wrong-server'

let current: ConnectivityStatus = 'checking'

export const getConnectivityStatus = () => current
export const setConnectivityStatus = (status: ConnectivityStatus) => {
  current = status
}
