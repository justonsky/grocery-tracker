import { api, ApiError } from '../api/client'
import type { GroceryListInput, TripInput } from '../api/types'
import { getOutboxDb } from './db'
import { classifyFailure } from './errors'
import { getAllOps, getOpsByStatus, removeOp, updateOp } from './outbox'
import type { OutboxOp } from './types'

const MAX_ATTEMPTS_ON_TRANSIENT = 5

export interface DrainDeps {
  execute: (op: OutboxOp) => Promise<void>
  // Called on a category name-conflict (409): looks up the real server
  // category id so other queued ops referencing the failed client-side id
  // can be remapped. Injected (rather than calling `api` directly) so the
  // core drain loop stays unit-testable without a network layer.
  resolveCategoryConflict: (op: OutboxOp) => Promise<string | null>
}

export interface DrainSummary {
  succeeded: string[]
  failed: string[]
  blocked: string[]
  orphaned: string[]
  stoppedEarly: boolean
}

// Drains the outbox strictly sequentially, ascending seq (= enqueue order),
// one request at a time. Sequential (not parallel) because:
//   - causal order falls out for free (a category is always created in the
//     UI before a trip can reference it, so seq order already respects it)
//   - parallel drain would reintroduce, at the request level, the same
//     same-payload-duplicate-name race LookupService.*.Local fixed server-side
//   - payloads are ~3 kB on a LAN; parallelism buys single-digit ms
// Aborts the whole drain on the first transient failure rather than
// continuing to the next op — don't hammer a server that just went down.
export async function drainOnce(deps: DrainDeps): Promise<DrainSummary> {
  const summary: DrainSummary = { succeeded: [], failed: [], blocked: [], orphaned: [], stoppedEarly: false }

  // Ops left `inflight` by a crashed/interrupted previous drain are safe to
  // retry — every op is an idempotent upsert, or a delete that tolerates 404.
  await resetInflightToPending()

  const ops = await getPendingOpsInSeqOrder()

  for (const op of ops) {
    const current = await getOpBySeq(op.seq!)
    if (!current || current.status !== 'pending') continue // coalesced/removed mid-loop

    const blockerId = await findBlockingDependency(current)
    if (blockerId) {
      await updateOp({ ...current, status: 'blocked', updatedAt: Date.now() })
      summary.blocked.push(current.opId)
      continue
    }

    await updateOp({ ...current, status: 'inflight', updatedAt: Date.now() })

    try {
      await deps.execute(current)
      await removeOp(current)
      summary.succeeded.push(current.opId)
    } catch (error) {
      const outcome = classifyFailure(error, current.action)

      if (outcome.kind === 'delete-success') {
        await removeOp(current)
        summary.succeeded.push(current.opId)
        continue
      }

      if (outcome.kind === 'transient') {
        const attempts = current.attempts + 1
        if (attempts >= MAX_ATTEMPTS_ON_TRANSIENT) {
          await updateOp({
            ...current,
            status: 'failed',
            attempts,
            lastError: { detail: 'This kept failing after several tries and needs your attention.', at: Date.now() },
            updatedAt: Date.now(),
          })
          summary.failed.push(current.opId)
          continue
        }
        await updateOp({ ...current, status: 'pending', attempts, updatedAt: Date.now() })
        summary.stoppedEarly = true
        return summary
      }

      if (outcome.kind === 'orphaned') {
        await orphanOpsForProfile(current.profileId)
        summary.orphaned.push(current.opId)
        continue
      }

      if (outcome.kind === 'auto-heal-category') {
        const resolvedId = await deps.resolveCategoryConflict(current)
        if (resolvedId) {
          await remapCategoryId(current.entityId, resolvedId)
          await removeOp(current)
          summary.succeeded.push(current.opId)
        } else {
          await updateOp({
            ...current,
            status: 'failed',
            lastError: { detail: 'A category with this name already exists and could not be linked automatically.', at: Date.now() },
            updatedAt: Date.now(),
          })
          summary.failed.push(current.opId)
        }
        continue
      }

      // permanent
      await updateOp({
        ...current,
        status: 'failed',
        lastError: {
          httpStatus: error instanceof ApiError ? error.status : undefined,
          problemType: error instanceof ApiError ? error.problemType : undefined,
          detail: outcome.message,
          at: Date.now(),
        },
        updatedAt: Date.now(),
      })
      summary.failed.push(current.opId)
    }
  }

  return summary
}

// Cross-tab single-flight: two tabs draining the same queue could double-
// apply a delete or double-report a failure. Falls back to draining directly
// on browsers without the Web Locks API (Safari < 15.4).
export async function runDrainWithLock(deps: DrainDeps): Promise<DrainSummary | null> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return drainOnce(deps)
  }
  return navigator.locks.request('gt-outbox-drain', { ifAvailable: true }, async (lock) => {
    if (!lock) return null // another tab is already draining
    return drainOnce(deps)
  })
}

async function resetInflightToPending(): Promise<void> {
  const inflight = await getOpsByStatus('inflight')
  for (const op of inflight) {
    await updateOp({ ...op, status: 'pending', updatedAt: Date.now() })
  }
}

async function getPendingOpsInSeqOrder(): Promise<OutboxOp[]> {
  const pending = await getOpsByStatus('pending')
  return pending.slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

async function getOpBySeq(seq: number): Promise<OutboxOp | undefined> {
  const db = await getOutboxDb()
  return (await db.get('ops', seq)) as OutboxOp | undefined
}

async function findBlockingDependency(op: OutboxOp): Promise<string | null> {
  if (op.dependsOn.length === 0) return null
  const all = await getAllOps()
  for (const depId of op.dependsOn) {
    const blocker = all.find((o) => o.entityId === depId && (o.status === 'failed' || o.status === 'blocked'))
    if (blocker) return depId
  }
  return null
}

async function orphanOpsForProfile(profileId: string | null): Promise<void> {
  if (!profileId) return
  const all = await getAllOps()
  for (const op of all) {
    if (op.profileId === profileId && (op.status === 'pending' || op.status === 'blocked' || op.status === 'inflight')) {
      await updateOp({ ...op, status: 'orphaned', updatedAt: Date.now() })
    }
  }
}

// Rewrites every other queued op that referenced the failed client-side
// category id — both as a dependency and inside trip/list line items — to
// point at the real server category id instead.
async function remapCategoryId(oldId: string, newId: string): Promise<void> {
  const all = await getAllOps()
  for (const op of all) {
    let changed = false

    if (op.dependsOn.includes(oldId)) {
      op.dependsOn = op.dependsOn.map((id) => (id === oldId ? newId : id))
      changed = true
    }

    if ((op.entity === 'trip' || op.entity === 'list') && op.payload && typeof op.payload === 'object') {
      const payload = op.payload as { items?: Array<{ categoryId?: string }> }
      if (Array.isArray(payload.items)) {
        for (const item of payload.items) {
          if (item.categoryId === oldId) {
            item.categoryId = newId
            changed = true
          }
        }
      }
    }

    if (changed) {
      await updateOp({ ...op, updatedAt: Date.now() })
    }
  }
}

async function execute(op: OutboxOp): Promise<void> {
  if (op.action === 'delete') {
    switch (op.entity) {
      case 'trip':
        return api.trips(op.profileId!).delete(op.entityId)
      case 'list':
        return api.lists(op.profileId!).delete(op.entityId)
      case 'profile':
        return api.profiles.delete(op.entityId)
      case 'category':
        return api.categories.delete(op.entityId)
    }
  }

  switch (op.entity) {
    case 'trip':
      await api.trips(op.profileId!).upsert(op.entityId, op.payload as TripInput)
      return
    case 'list':
      await api.lists(op.profileId!).upsert(op.entityId, op.payload as GroceryListInput)
      return
    case 'profile':
      await api.profiles.upsert(op.entityId, (op.payload as { name: string }).name)
      return
    case 'category':
      await api.categories.upsert(op.entityId, (op.payload as { name: string }).name)
      return
  }
}

async function resolveCategoryConflict(op: OutboxOp): Promise<string | null> {
  const name = (op.payload as { name: string } | null)?.name
  if (!name) return null
  const categories = await api.categories.list()
  const normalized = name.trim().toLowerCase()
  return categories.find((c) => c.name.trim().toLowerCase() === normalized)?.id ?? null
}

export function createRealDrainDeps(): DrainDeps {
  return { execute, resolveCategoryConflict }
}
