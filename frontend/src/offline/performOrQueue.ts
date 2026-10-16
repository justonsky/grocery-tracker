import { ApiError } from '../api/client'
import { getConnectivityStatus, hasKnownServer } from './connectivityStatus'
import { newId } from './id'
import { enqueue, type EnqueueInput } from './outbox'

export type PerformOrQueueResult<T> = { sent: true; result: T } | { sent: false }

// Tries the direct API call first. On a network-class failure — a plain
// TypeError from fetch (server unreachable) or a 5xx — falls back to queuing
// the same operation in the offline outbox instead of surfacing an error to
// the user. A real 4xx (validation, conflict, etc.) is NOT network-class and
// rethrows, since that's a genuine rejection the caller's onError should show.
//
// While the server that answers isn't this device's home server (see
// WrongServerBanner) — or the first check of a server this device knows hasn't
// finished yet — nothing is sent: the write waits in the outbox until the server
// is confirmed (the drain runs as soon as it is), rather than landing on a stranger's.
export async function performOrQueue<T>(send: () => Promise<T>, queueInput: EnqueueInput): Promise<PerformOrQueueResult<T>> {
  const status = getConnectivityStatus()
  if (status === 'wrong-server' || (status === 'checking' && hasKnownServer())) {
    await enqueue(queueInput)
    return { sent: false }
  }
  try {
    const result = await send()
    return { sent: true, result }
  } catch (error) {
    const isNetworkClass = !(error instanceof ApiError) || error.status >= 500
    if (!isNetworkClass) throw error

    await enqueue(queueInput)
    return { sent: false }
  }
}

export const newClientId = newId
