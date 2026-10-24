import type { Category, Trip, TripInput, TripItemLine, TripSummary } from '../api/types'
import { getAllOps } from '../offline/outbox'
import type { OutboxOp } from '../offline/types'

// A trip save that couldn't reach the server waits in the outbox. Until it syncs, the screens
// show the trip as it was saved, not the server's older copy (or nothing, for a new trip):
// otherwise the trip vanishes from the list, and reopening it edits a stale copy whose next
// save would replace the queued one and lose those edits.

const LOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_PREFIX = 'pending-'

// A line the server hasn't assigned an id to yet (added in a save that's still queued).
export const isPendingLineId = (id: string | null | undefined) => !!id && id.startsWith(PENDING_PREFIX)

// Trip ops still waiting to reach the server, latest per trip.
async function waitingTripOps(profileId: string): Promise<Map<string, OutboxOp>> {
  const ops = (await getAllOps()).filter((op) => op.entity === 'trip' && op.profileId === profileId && op.status !== 'orphaned')
  const latest = new Map<string, OutboxOp>()
  for (const op of ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) latest.set(op.entityId, op)
  return latest
}

// The trip as a queued save describes it. Lines keep what the server copy knew about them (ids,
// lock state); new lines get a placeholder id, which the server treats as a new line.
export function tripFromInput(id: string, input: TripInput, previous: Trip | undefined, categories: Category[] | undefined, now = Date.now()): Trip {
  const before = new Map((previous?.items ?? []).map((line) => [line.id, line]))
  const items: TripItemLine[] = input.items.map((line, index) => {
    const known = line.id ? before.get(line.id) : undefined
    if (known?.priceLocked) return known // a save can't change a locked line
    const priceLocksAt =
      line.price == null ? null : known?.price != null && known.priceLocksAt ? known.priceLocksAt : new Date(now + LOCK_WINDOW_MS).toISOString()
    return {
      id: line.id ?? `${PENDING_PREFIX}${id}-${index}`,
      itemId: known?.itemId ?? '',
      itemName: line.itemName,
      categoryId: line.categoryId,
      categoryName: categories?.find((c) => c.id === line.categoryId)?.name ?? known?.categoryName ?? '',
      storeName: line.storeName,
      checked: line.checked,
      price: line.price,
      estimate: line.estimate ?? null,
      priceLocksAt,
      priceLocked: false,
      quantity: line.quantity ?? known?.quantity ?? 1,
      unit: line.unit ?? known?.unit ?? 'each',
    }
  })
  // Locked lines a save leaves out stay on the trip (the server keeps them too).
  for (const line of previous?.items ?? []) {
    if (line.priceLocked && !items.some((i) => i.id === line.id)) items.push(line)
  }
  const priced = items.filter((i) => i.price != null)
  const both = items.filter((i) => i.price != null && i.estimate != null)
  const cents = (n: number) => Math.round(n * 100)
  return {
    id,
    name: input.name,
    date: previous && previous.items.some((i) => i.priceLocked) ? previous.date : input.date,
    budget: input.budget,
    stores: input.stores,
    items,
    total: priced.reduce((sum, i) => sum + cents(i.price!), 0) / 100,
    status: input.status ?? previous?.status ?? 'planned',
    completedAt: previous?.completedAt ?? null,
    estimatedTotal: items.reduce((sum, i) => sum + (i.estimate != null ? cents(i.estimate) : 0), 0) / 100,
    savings: both.length === 0 ? null : both.reduce((sum, i) => sum + cents(i.estimate!) - cents(i.price!), 0) / 100,
    recipes: input.recipeIds ? previous?.recipes?.filter((r) => input.recipeIds!.includes(r.id)) : previous?.recipes,
  }
}

export function summaryOf(trip: Trip): TripSummary {
  return {
    id: trip.id,
    name: trip.name,
    date: trip.date,
    stores: trip.stores,
    itemCount: trip.items.length,
    checkedCount: trip.items.filter((i) => i.checked).length,
    total: trip.total,
    budget: trip.budget,
    status: trip.status,
    estimatedTotal: trip.estimatedTotal,
    savings: trip.savings,
  }
}

// The list with every queued save applied: changed and offline-created trips as saved, queued deletes gone.
export function withWaiting(list: TripSummary[], waiting: Map<string, OutboxOp>, categories: Category[] | undefined): TripSummary[] {
  let result = list
  for (const [id, op] of waiting) {
    if (op.action === 'delete') {
      result = result.filter((t) => t.id !== id)
      continue
    }
    const summary = summaryOf(tripFromInput(id, op.payload as TripInput, undefined, categories))
    const index = result.findIndex((t) => t.id === id)
    result = index >= 0 ? result.map((t, i) => (i === index ? { ...t, ...summary, total: summary.total } : t)) : [summary, ...result]
  }
  return result
}

// cached: the list already on screen. Offline, it (or nothing, on a device that never loaded the
// list) plus the queued saves is the best there is — better than no list at all.
export async function listTrips(profileId: string, fetchList: () => Promise<TripSummary[]>, categories: Category[] | undefined, cached?: TripSummary[]) {
  const waiting = await waitingTripOps(profileId)
  try {
    return withWaiting(await fetchList(), waiting, categories)
  } catch (error) {
    if (waiting.size === 0) throw error
    return withWaiting(cached ?? [], waiting, categories)
  }
}

// One trip: the server copy with its queued save applied, or the queued save alone for a trip the
// server hasn't seen yet (its fetch is a 404 until the save lands).
// cached: the copy already on screen, whose lock states stand in while the server can't be reached.
export async function loadTrip(profileId: string, id: string, fetchTrip: () => Promise<Trip>, categories: Category[] | undefined, cached?: Trip) {
  const op = (await waitingTripOps(profileId)).get(id)
  const queued = op?.action === 'put' ? (op.payload as TripInput) : null
  try {
    const server = await fetchTrip()
    return queued ? tripFromInput(id, queued, server, categories) : server
  } catch (error) {
    if (queued) return tripFromInput(id, queued, cached, categories)
    throw error
  }
}
