import { ApiError } from '../api/client'
import { enqueue, type EnqueueInput } from './outbox'

export type PerformOrQueueResult<T> = { sent: true; result: T } | { sent: false }

// Tries the direct API call first. On a network-class failure — a plain
// TypeError from fetch (server unreachable) or a 5xx — falls back to queuing
// the same operation in the offline outbox instead of surfacing an error to
// the user. A real 4xx (validation, conflict, etc.) is NOT network-class and
// rethrows, since that's a genuine rejection the caller's onError should show.
export async function performOrQueue<T>(send: () => Promise<T>, queueInput: EnqueueInput): Promise<PerformOrQueueResult<T>> {
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

export function newClientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}
