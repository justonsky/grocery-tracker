import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { setConnectivityStatus } from './connectivityStatus'
import { resetOutboxDbForTests } from './db'
import { getAllOps } from './outbox'
import { performOrQueue } from './performOrQueue'

const input = {
  entity: 'trip' as const,
  action: 'put' as const,
  entityId: 't1',
  profileId: 'p1',
  isCreate: true,
  payload: { date: '2026-08-01' },
  label: 'Trip',
}

describe('performOrQueue', () => {
  beforeEach(async () => {
    await resetOutboxDbForTests()
    setConnectivityStatus('online')
  })
  afterEach(async () => {
    await resetOutboxDbForTests()
    setConnectivityStatus('checking')
  })

  it('sends directly when the server is reachable', async () => {
    const send = vi.fn().mockResolvedValue('ok')
    expect(await performOrQueue(send, input)).toEqual({ sent: true, result: 'ok' })
    expect(await getAllOps()).toHaveLength(0)
  })

  it('queues on a network-class failure', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await performOrQueue(send, input)).toEqual({ sent: false })
    expect(await getAllOps()).toHaveLength(1)
  })

  it('rethrows a real rejection instead of queuing it', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(400, 'bad'))
    await expect(performOrQueue(send, input)).rejects.toBeInstanceOf(ApiError)
    expect(await getAllOps()).toHaveLength(0)
  })

  it("never sends to a server that isn't this device's home server", async () => {
    setConnectivityStatus('wrong-server')
    const send = vi.fn().mockResolvedValue('ok')
    expect(await performOrQueue(send, input)).toEqual({ sent: false })
    expect(send).not.toHaveBeenCalled()
    expect(await getAllOps()).toHaveLength(1)
  })
})
