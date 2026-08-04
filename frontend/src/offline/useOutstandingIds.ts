import { useEffect, useState } from 'react'
import { getAllOps, onOutboxChanged } from './outbox'
import type { OutboxEntity } from './types'

// Drives per-row "pending sync" chips: a row whose id shows up here has a
// queued (or currently failing/blocked) change sitting in the outbox that
// hasn't landed on the server yet, so whatever the row is showing may be
// stale relative to what the user actually asked for.
export function useOutstandingEntityIds(entity: OutboxEntity): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const refresh = () => {
      void getAllOps().then((ops) => {
        const outstanding = ops.filter(
          (op) => op.entity === entity && (op.status === 'pending' || op.status === 'inflight' || op.status === 'blocked' || op.status === 'failed'),
        )
        setIds(new Set(outstanding.map((op) => op.entityId)))
      })
    }
    refresh()
    return onOutboxChanged(refresh)
  }, [entity])

  return ids
}
