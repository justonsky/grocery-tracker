import { describe, expect, it } from 'vitest'
import type { Trip, TripInput } from '../api/types'
import type { OutboxOp } from '../offline/types'
import { isPendingLineId, summaryOf, tripFromInput, withWaiting } from './pendingTrips'

const categories = [{ id: 'dairy', name: 'Dairy', isBuiltIn: true, sortOrder: 1 }]
const NOW = Date.parse('2026-10-16T20:00:00Z')

const server: Trip = {
  id: 't1', name: 'Weekly', date: '2026-10-01', budget: null, stores: ['Aldi'], status: 'done', completedAt: null,
  total: 3, estimatedTotal: 0, savings: null,
  items: [
    { id: 'old', itemId: 'i1', itemName: 'Milk', categoryId: 'dairy', categoryName: 'Dairy', storeName: 'Aldi', checked: true, price: 3, estimate: null, priceLocksAt: '2026-10-08T00:00:00Z', priceLocked: true },
  ],
}

const op = (entityId: string, action: 'put' | 'delete', payload: TripInput | null): OutboxOp => ({
  seq: 1, opId: `op-${entityId}`, status: 'pending', entity: 'trip', action, entityId, profileId: 'p1', isCreate: false,
  payload, dependsOn: [], attempts: 0, lastError: null, createdAt: 0, updatedAt: 0, label: '',
})

describe('tripFromInput', () => {
  it('shows a queued save over the server copy, keeping locked lines as they were', () => {
    const input: TripInput = {
      name: 'Weekly', date: '2026-10-05', budget: 50, stores: ['Aldi'], status: 'done',
      items: [
        { id: 'old', itemName: 'Milk', categoryId: 'dairy', storeName: 'Aldi', checked: true, price: 9 }, // locked: can't change
        { id: null, itemName: 'Eggs', categoryId: 'dairy', storeName: 'Aldi', checked: true, price: 4.5, estimate: 5 },
      ],
    }
    const trip = tripFromInput('t1', input, server, categories, NOW)

    expect(trip.items.map((i) => [i.itemName, i.price, i.priceLocked])).toEqual([['Milk', 3, true], ['Eggs', 4.5, false]])
    expect(trip.date).toBe('2026-10-01') // a trip with locked lines keeps its date, as the server would
    expect(trip.total).toBe(7.5)
    expect(trip.estimatedTotal).toBe(5)
    expect(trip.savings).toBe(0.5)
    expect(trip.items[1].categoryName).toBe('Dairy')
    expect(trip.items[1].priceLocksAt).toBe(new Date(NOW + 7 * 24 * 3600 * 1000).toISOString())
  })

  it('builds a trip the server has never seen from the queued save alone', () => {
    const trip = tripFromInput('new', { name: null, date: '2026-10-16', budget: null, stores: [], items: [{ itemName: 'Bread', categoryId: 'dairy', storeName: null, checked: false, price: null }] }, undefined, categories, NOW)
    expect(trip.status).toBe('planned')
    expect(trip.items[0].id).toBe('pending-new-0')
    expect(isPendingLineId(trip.items[0].id)).toBe(true)
    expect(isPendingLineId('3f1c0f5e-0000-4000-8000-000000000000')).toBe(false)
    expect(summaryOf(trip)).toMatchObject({ id: 'new', itemCount: 1, checkedCount: 0, total: 0 })
  })
})

describe('withWaiting', () => {
  it('adds offline-created trips, updates changed ones and drops queued deletes', () => {
    const list = [summaryOf(server), { ...summaryOf(server), id: 'gone' }]
    const waiting = new Map([
      ['t1', op('t1', 'put', { name: 'Renamed', date: '2026-10-01', budget: null, stores: ['Aldi'], items: [] })],
      ['gone', op('gone', 'delete', null)],
      ['fresh', op('fresh', 'put', { name: 'Offline list', date: '2026-10-16', budget: null, stores: [], items: [] })],
    ])
    const result = withWaiting(list, waiting, categories)
    expect(result.map((t) => [t.id, t.name])).toEqual([['fresh', 'Offline list'], ['t1', 'Renamed']])
  })
})
