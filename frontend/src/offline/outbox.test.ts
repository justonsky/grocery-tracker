import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetOutboxDbForTests } from './db'
import { countOutstanding, enqueue, getAllOps, updateOp } from './outbox'

describe('outbox enqueue + coalescing', () => {
  beforeEach(async () => {
    await resetOutboxDbForTests()
  })
  afterEach(async () => {
    await resetOutboxDbForTests()
  })

  it('queues a new put as a pending op', async () => {
    await enqueue({
      entity: 'trip',
      action: 'put',
      entityId: 't1',
      profileId: 'p1',
      isCreate: true,
      payload: { date: '2026-08-01' },
      label: 'Trip at Aldi',
    })

    const ops = await getAllOps()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ status: 'pending', entity: 'trip', entityId: 't1', isCreate: true })
  })

  it('coalesces put -> put into a single op, keeping the original seq', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: { v: 1 }, label: 'a' })
    const firstSeq = (await getAllOps())[0].seq

    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: { v: 2 }, label: 'b' })

    const ops = await getAllOps()
    expect(ops).toHaveLength(1)
    expect(ops[0].seq).toBe(firstSeq)
    expect(ops[0].payload).toEqual({ v: 2 })
    expect(ops[0].label).toBe('b')
  })

  it('drops both ops when a delete coalesces with a pending create', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'a' })
    await enqueue({ entity: 'trip', action: 'delete', entityId: 't1', profileId: 'p1', isCreate: false, payload: null, label: 'delete a' })

    expect(await getAllOps()).toHaveLength(0)
  })

  it('replaces a pending edit-put with a delete when the entity already existed on the server', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: false, payload: { v: 1 }, label: 'edit' })
    await enqueue({ entity: 'trip', action: 'delete', entityId: 't1', profileId: 'p1', isCreate: false, payload: null, label: 'delete' })

    const ops = await getAllOps()
    expect(ops).toHaveLength(1)
    expect(ops[0].action).toBe('delete')
  })

  it('no-ops a delete coalescing with an already-pending delete', async () => {
    await enqueue({ entity: 'trip', action: 'delete', entityId: 't1', profileId: 'p1', isCreate: false, payload: null, label: 'delete' })
    await enqueue({ entity: 'trip', action: 'delete', entityId: 't1', profileId: 'p1', isCreate: false, payload: null, label: 'delete again' })

    expect(await getAllOps()).toHaveLength(1)
  })

  it('does not coalesce with a failed op — queues a new one alongside it', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: { v: 1 }, label: 'a' })
    const [op] = await getAllOps()
    // Simulate the drainer having marked it failed.
    await updateOp({ ...op, status: 'failed' })

    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: false, payload: { v: 2 }, label: 'b' })

    const ops = await getAllOps()
    expect(ops).toHaveLength(2)
  })

  it('does not touch operations for unrelated entities', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'trip' })
    await enqueue({ entity: 'list', action: 'put', entityId: 'l1', profileId: 'p1', isCreate: true, payload: {}, label: 'list' })

    expect(await getAllOps()).toHaveLength(2)
  })

  it('countOutstanding counts pending, inflight, and blocked but not failed', async () => {
    await enqueue({ entity: 'trip', action: 'put', entityId: 't1', profileId: 'p1', isCreate: true, payload: {}, label: 'a' })
    await enqueue({ entity: 'list', action: 'put', entityId: 'l1', profileId: 'p1', isCreate: true, payload: {}, label: 'b' })
    const ops = await getAllOps()
    await updateOp({ ...ops[1], status: 'failed' })

    expect(await countOutstanding()).toBe(1)
  })
})
