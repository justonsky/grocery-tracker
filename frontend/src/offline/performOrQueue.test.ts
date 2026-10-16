import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { KNOWN_SERVER_KEY, setConnectivityStatus } from './connectivityStatus'
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

describe('performOrQueue before the first server check', () => {
  // Tests run in node, which has no localStorage; a tiny in-memory stand-in.
  const store = new Map<string, string>()
  beforeEach(async () => {
    await resetOutboxDbForTests()
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })
  afterEach(async () => {
    await resetOutboxDbForTests()
    vi.unstubAllGlobals()
    setConnectivityStatus('checking')
  })

  it('holds writes while a known server is still being checked', async () => {
    localStorage.setItem(KNOWN_SERVER_KEY, 'server-1')
    setConnectivityStatus('checking')
    const send = vi.fn().mockResolvedValue('ok')
    expect(await performOrQueue(send, input)).toEqual({ sent: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends on a first-ever visit, when there is no known server to protect', async () => {
    setConnectivityStatus('checking')
    const send = vi.fn().mockResolvedValue('ok')
    expect(await performOrQueue(send, input)).toEqual({ sent: true, result: 'ok' })
  })
})
