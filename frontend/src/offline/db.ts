import { deleteDB, openDB, type IDBPDatabase } from 'idb'

export const OUTBOX_DB_NAME = 'grocery-tracker-outbox'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function openOutboxDb(): Promise<IDBPDatabase> {
  return openDB(OUTBOX_DB_NAME, DB_VERSION, {
    upgrade(db) {
      const ops = db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true })
      ops.createIndex('by_status', 'status')
      ops.createIndex('by_target', ['entity', 'entityId'])
      ops.createIndex('by_profile', 'profileId')

      // lastSyncAt, serverInstanceId (device-local sync bookkeeping)
      db.createObjectStore('meta', { keyPath: 'key' })
    },
  })
}

export function getOutboxDb(): Promise<IDBPDatabase> {
  dbPromise ??= openOutboxDb()
  return dbPromise
}

export async function getMetaValue(key: string): Promise<unknown | undefined> {
  const db = await getOutboxDb()
  const row = await db.get('meta', key)
  return row?.value
}

export async function setMetaValue(key: string, value: unknown): Promise<void> {
  const db = await getOutboxDb()
  await db.put('meta', { key, value })
}

// Test-only: closes the cached handle and wipes the underlying database so
// each test starts from a clean outbox.
export async function resetOutboxDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
  }
  dbPromise = null
  await deleteDB(OUTBOX_DB_NAME)
}
