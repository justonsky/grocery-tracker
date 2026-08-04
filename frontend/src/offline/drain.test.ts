import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import { resetOutboxDbForTests } from './db'
import { drainOnce, type DrainDeps } from './drain'
import { enqueue, getAllOps, updateOp } from './outbox'

function noopResolveCategoryConflict(): Promise<string | null> {
  return Promise.resolve(null)
}

describe('drainOnce', () => {
  beforeEach(async () => {
    await resetOutboxDbForTests()
  })
  afterEach(async () => {
    await resetOutboxDbForTests()
  })

  it('executes pending ops in seq order and removes them on success', async () => {
    await enqueue({ entity: 'category', action: 'put', entityId: 'c1', profileId: null, isCreate: true, payload: { name: 'Snacks' }, label: 'cat' })
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: { v: 1 }, label: 'trip' })

    const executedOrder: string[] = []
    const deps: DrainDeps = {
      execute: async (op) => {
        executedOrder.push(op.entityId)
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    const summary = await drainOnce(deps)

    expect(executedOrder).toEqual(['c1', 't1'])
    expect(summary.succeeded).toHaveLength(2)
    expect(await getAllOps()).toHaveLength(0)
  })

  it('treats a 404 on a queued delete as success', async () => {
    await enqueue({ entity: 'trip', action: 'delete', entityId: 't1', profileId: 'p1', isCreate: false, payload: null, label: 'delete' })

    const deps: DrainDeps = {
      execute: async () => {
        throw new ApiError(404, 'gone', ProblemTypes.TripNotFound)
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    const summary = await drainOnce(deps)
    expect(summary.succeeded).toHaveLength(1)
    expect(await getAllOps()).toHaveLength(0)
  })

  it('aborts the whole drain on the first transient failure, leaving later ops untouched', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'first' })
    await enqueue({ entity: 'trip', action: 'put', entityId: 't2', profileId: 'p1', isCreate: true, payload: {}, label: 'second' })

    let calls = 0
    const deps: DrainDeps = {
      execute: async () => {
        calls++
        throw new TypeError('network down')
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    const summary = await drainOnce(deps)

    expect(calls).toBe(1) // never attempted the second op
    expect(summary.stoppedEarly).toBe(true)
    const remaining = await getAllOps()
    expect(remaining).toHaveLength(2)
    expect(remaining.find((o) => o.entityId === 't1')!.status).toBe('pending')
    expect(remaining.find((o) => o.entityId === 't1')!.attempts).toBe(1)
  })

  it('marks an op failed after enough repeated transient failures across drain calls', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'flaky' })

    const deps: DrainDeps = {
      execute: async () => {
        throw new ApiError(503, 'unavailable', ProblemTypes.Unexpected)
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    let lastSummary
    for (let i = 0; i < 5; i++) {
      lastSummary = await drainOnce(deps)
    }

    expect(lastSummary!.failed).toHaveLength(1)
    const ops = await getAllOps()
    expect(ops[0].status).toBe('failed')
  })

  it('blocks an op whose dependency already failed, without attempting it', async () => {
    await enqueue({ entity: 'category', action: 'put', entityId: 'c1', profileId: null, isCreate: true, payload: { name: 'Snacks' }, label: 'cat' })
    await enqueue({
      entity: 'trip',
      action: 'put',
      entityId: 't1',
      profileId: 'p1',
      isCreate: true,
      payload: { items: [{ categoryId: 'c1' }] },
      dependsOn: ['c1'],
      label: 'trip depending on cat',
    })

    let tripAttempted = false
    const deps: DrainDeps = {
      execute: async (op) => {
        if (op.entity === 'category') {
          throw new ApiError(400, 'bad category', ProblemTypes.Validation)
        }
        tripAttempted = true
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    const summary = await drainOnce(deps)

    expect(tripAttempted).toBe(false)
    expect(summary.failed).toHaveLength(1)
    const ops = await getAllOps()
    expect(ops.find((o) => o.entity === 'category')!.status).toBe('failed')
    expect(ops.find((o) => o.entity === 'trip')!.status).toBe('blocked')
  })

  it('marks all outstanding ops for a profile orphaned when the profile is gone server-side', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'a' })
    await enqueue({ entity: 'list', action: 'put', entityId: 'l1', profileId: 'p1', isCreate: true, payload: {}, label: 'b' })

    const deps: DrainDeps = {
      execute: async () => {
        throw new ApiError(404, 'no such profile', ProblemTypes.ProfileNotFound)
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    await drainOnce(deps)

    const ops = await getAllOps()
    expect(ops.every((o) => o.status === 'orphaned')).toBe(true)
  })

  it('auto-heals a category name conflict by remapping other ops to the resolved server id', async () => {
    await enqueue({ entity: 'category', action: 'put', entityId: 'local-cat', profileId: null, isCreate: true, payload: { name: 'Snacks' }, label: 'cat' })
    await enqueue({
      entity: 'trip',
      action: 'put',
      entityId: 't1',
      profileId: 'p1',
      isCreate: true,
      payload: { items: [{ categoryId: 'local-cat', name: 'Chips' }] },
      dependsOn: ['local-cat'],
      label: 'trip',
    })

    const deps: DrainDeps = {
      execute: async (op) => {
        if (op.entity === 'category' && op.entityId === 'local-cat') {
          throw new ApiError(409, 'name taken', ProblemTypes.CategoryNameConflict)
        }
        // trip execution "succeeds" — we just want to inspect its payload beforehand
      },
      resolveCategoryConflict: async () => 'server-cat-real-id',
    }

    await drainOnce(deps)

    // The category op resolved via auto-heal and is gone; the trip op should
    // have been remapped and then itself succeeded (drain continues past the
    // resolved category, both ops removed).
    const remaining = await getAllOps()
    expect(remaining).toHaveLength(0)
  })

  it('auto-heal remaps a still-pending dependent op if the dependent is not itself drained yet', async () => {
    // Same scenario, but make the trip op fail transiently so we can inspect
    // its remapped payload afterward instead of it also being removed.
    await enqueue({ entity: 'category', action: 'put', entityId: 'local-cat', profileId: null, isCreate: true, payload: { name: 'Snacks' }, label: 'cat' })
    await enqueue({
      entity: 'trip',
      action: 'put',
      entityId: 't1',
      profileId: 'p1',
      isCreate: true,
      payload: { items: [{ categoryId: 'local-cat' }] },
      dependsOn: ['local-cat'],
      label: 'trip',
    })

    const deps: DrainDeps = {
      execute: async (op) => {
        if (op.entity === 'category') {
          throw new ApiError(409, 'name taken', ProblemTypes.CategoryNameConflict)
        }
        throw new TypeError('network down') // abort before the trip is removed
      },
      resolveCategoryConflict: async () => 'server-cat-real-id',
    }

    await drainOnce(deps)

    const remaining = await getAllOps()
    expect(remaining).toHaveLength(1)
    const trip = remaining[0]
    expect(trip.dependsOn).toEqual(['server-cat-real-id'])
    expect((trip.payload as { items: Array<{ categoryId: string }> }).items[0].categoryId).toBe('server-cat-real-id')
  })

  it('recovers ops stuck inflight from a crashed previous drain', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'a' })
    const [op] = await getAllOps()
    await updateOp({ ...op, status: 'inflight' })

    let executed = false
    const deps: DrainDeps = {
      execute: async () => {
        executed = true
      },
      resolveCategoryConflict: noopResolveCategoryConflict,
    }

    await drainOnce(deps)
    expect(executed).toBe(true)
  })
})
