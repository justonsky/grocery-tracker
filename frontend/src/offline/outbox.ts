import { getOutboxDb } from './db'
import type { OutboxAction, OutboxEntity, OutboxOp } from './types'

function newOpId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

// Lets SyncProvider react immediately to an enqueue from anywhere in the app
// (a screen's mutationFn) without polling — it has no other reference back to
// whichever component triggered the write.
const changeListeners = new Set<() => void>()
export function onOutboxChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
function notifyOutboxChanged(): void {
  for (const listener of changeListeners) listener()
}

export interface EnqueueInput {
  entity: OutboxEntity
  action: OutboxAction
  entityId: string
  profileId: string | null
  isCreate: boolean
  payload: unknown | null
  dependsOn?: string[]
  label: string
}

// Coalesces at enqueue time, inside one IDB transaction:
//   put    + pending put             -> replace payload in place, keep seq
//            (preserves "category before the trip that uses it" ordering)
//   delete + pending put (isCreate)  -> drop both — the server never heard of it
//   delete + pending put (!isCreate) -> drop the put, append delete at tail
//   delete + pending delete          -> no-op
// Never touches an op that's inflight/failed/blocked/orphaned — a new op for
// that entity is queued alongside it instead, left for the drainer/user to
// resolve explicitly.
export async function enqueue(input: EnqueueInput): Promise<void> {
  await enqueueInternal(input)
  notifyOutboxChanged()
}

async function enqueueInternal(input: EnqueueInput): Promise<void> {
  const db = await getOutboxDb()
  const tx = db.transaction('ops', 'readwrite')
  const store = tx.objectStore('ops')
  const index = store.index('by_target')

  const existingForTarget = (await index.getAll([input.entity, input.entityId])) as OutboxOp[]
  const pending = existingForTarget.find((op) => op.status === 'pending')
  const now = Date.now()

  if (pending) {
    if (input.action === 'put') {
      pending.payload = input.payload
      pending.dependsOn = mergeDependsOn(pending.dependsOn, input.dependsOn)
      pending.updatedAt = now
      pending.label = input.label
      await store.put(pending)
      await tx.done
      return
    }

    // Coalescing a `delete` against a pending `put`/`delete`.
    if (pending.action === 'put' && pending.isCreate) {
      await store.delete(pending.seq!)
      await tx.done
      return
    }
    if (pending.action === 'delete') {
      await tx.done // no-op — already queued
      return
    }

    await store.delete(pending.seq!)
    await store.add(newOp(input, now, false))
    await tx.done
    return
  }

  await store.add(newOp(input, now, input.isCreate))
  await tx.done
}

function mergeDependsOn(a: string[], b: string[] | undefined): string[] {
  return b?.length ? Array.from(new Set([...a, ...b])) : a
}

function newOp(input: EnqueueInput, now: number, isCreate: boolean): Omit<OutboxOp, 'seq'> {
  return {
    opId: newOpId(),
    status: 'pending',
    entity: input.entity,
    action: input.action,
    entityId: input.entityId,
    profileId: input.profileId,
    isCreate,
    payload: input.payload,
    dependsOn: input.dependsOn ?? [],
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    label: input.label,
  }
}

export async function getAllOps(): Promise<OutboxOp[]> {
  const db = await getOutboxDb()
  return (await db.getAll('ops')) as OutboxOp[]
}

export async function getOpsByStatus(status: OutboxOp['status']): Promise<OutboxOp[]> {
  const db = await getOutboxDb()
  return (await db.getAllFromIndex('ops', 'by_status', status)) as OutboxOp[]
}

// "Pending" from the user's point of view includes ops actively being
// retried (inflight) and ops waiting on a blocked dependency — all three
// count toward "N changes waiting to sync".
export async function countOutstanding(): Promise<number> {
  const ops = await getAllOps()
  return ops.filter((op) => op.status === 'pending' || op.status === 'inflight' || op.status === 'blocked').length
}

export async function removeOp(op: OutboxOp): Promise<void> {
  if (op.seq === undefined) return
  const db = await getOutboxDb()
  await db.delete('ops', op.seq)
  notifyOutboxChanged()
}

export async function updateOp(op: OutboxOp): Promise<void> {
  const db = await getOutboxDb()
  await db.put('ops', op)
  notifyOutboxChanged()
}

export async function retryOp(op: OutboxOp): Promise<void> {
  await updateOp({ ...op, status: 'pending', attempts: 0, lastError: null, updatedAt: Date.now() })
}

export async function discardOp(op: OutboxOp): Promise<void> {
  await removeOp(op)
}
