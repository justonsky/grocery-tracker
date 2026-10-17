import { describe, expect, it } from 'vitest'
import type { ReceiptLine } from '../api/types'
import type { DraftItem } from '../components/TripItemList'
import { mergeReceipt, nameScore, pairWithPlanned } from './merge'

const line = (id: string, text: string, amount: number, extra: Partial<ReceiptLine> = {}): ReceiptLine => ({
  id, text, code: null, name: null, quantity: 1, unit: 'each', unitPrice: null, amount, discount: 0, kind: 'item', match: null, candidates: [], ...extra,
})
const item = (key: string, itemName: string, extra: Partial<DraftItem> = {}): DraftItem => ({
  key, id: key, itemName, categoryId: 'cat', storeName: 'Aldi', checked: false, estimate: '', price: '', quantity: '', unit: 'each', locked: false, priceLocksAt: null, ...extra,
})
let n = 0
const newKey = () => `new${++n}`

describe('nameScore', () => {
  it('matches abbreviations and prefixes', () => {
    expect(nameScore('Redcd Sodium Broth', 'Reduced Sodium Chicken Broth')).toBeGreaterThan(0.6)
    expect(nameScore('Roma Tomatoes LRW', 'Roma Tomatoes')).toBe(1)
  })
  it('scores unrelated names low', () => expect(nameScore('3D Kite', 'Kiwi')).toBeLessThan(0.3))
})

describe('pairWithPlanned', () => {
  it("pairs receipt lines with the trip's unbought lines at that store, closest price first", () => {
    const items = [item('a', 'Large Eggs', { estimate: '2.50' }), item('b', 'Mayonnaise'), item('c', 'Popcorn', { storeName: "BJ's" }), item('d', 'Garlic', { checked: true })]
    const pairs = pairWithPlanned([line('1', 'Large Eggs', 2.64), line('2', 'Mayonnaise', 3.29), line('3', 'Popcorn', 2.99), line('4', 'Garlic', 1.59)], items, 'Aldi')
    expect([...pairs]).toEqual([['1', 'a'], ['2', 'b']]) // Popcorn is planned at BJ's; Garlic is already bought
  })
  it('uses each trip line once', () => {
    const pairs = pairWithPlanned([line('1', 'Garden Salad', 0.89), line('2', 'Garden Salad', 0.89)], [item('a', 'Garden Salad')], 'Aldi')
    expect(pairs.size).toBe(1)
  })
  it('ignores tax lines', () => {
    expect(pairWithPlanned([line('1', 'Tax', 0.38, { kind: 'tax' })], [item('a', 'Tax')], 'Aldi').size).toBe(0)
  })
})

describe('mergeReceipt', () => {
  it('prices and ticks the planned line, adds the rest as new ticked lines, and drops the blank starter row', () => {
    const items = [item('a', 'Large Eggs', { estimate: '2.50' }), item('blank', '', { storeName: null })]
    const result = mergeReceipt(items, {
      storeName: 'Aldi',
      rows: [
        { itemName: 'Large Eggs', categoryId: 'dairy', amount: 2.64, quantity: 1, unit: 'each', plannedKey: 'a' },
        { itemName: 'Zucchini', categoryId: 'produce', amount: 2.25, quantity: 1.55, unit: 'lb' },
      ],
      extras: [{ itemName: 'Tax', categoryId: 'other', amount: 0.38 }, { itemName: 'Unlisted purchases', categoryId: 'other', amount: 0 }],
      newKey,
    })
    expect(result.updated).toBe(1)
    expect(result.added).toBe(2)
    const eggs = result.items.find((i) => i.key === 'a')!
    expect([eggs.price, eggs.checked, eggs.quantity, eggs.estimate]).toEqual(['2.64', true, '', '2.50'])
    const zucchini = result.items.find((i) => i.itemName === 'Zucchini')!
    expect([zucchini.price, zucchini.quantity, zucchini.unit, zucchini.storeName, zucchini.checked]).toEqual(['2.25', '1.55', 'lb', 'Aldi', true])
    expect(result.items.some((i) => i.key === 'blank')).toBe(false)
    expect(result.items.some((i) => i.itemName === 'Unlisted purchases')).toBe(false) // nothing to add
  })

  it('adds the same item twice on the receipt into one line', () => {
    const result = mergeReceipt([], {
      storeName: 'Aldi',
      rows: [
        { itemName: 'Mixed Nuts', categoryId: 'pantry', amount: 4.99, quantity: 1, unit: 'each' },
        { itemName: 'mixed nuts', categoryId: 'pantry', amount: 4.99, quantity: 1, unit: 'each' },
      ],
      extras: [],
      newKey,
    })
    expect(result.items).toHaveLength(1)
    expect([result.items[0].price, result.items[0].quantity]).toEqual(['9.98', '2'])
  })

  it('never touches a locked line', () => {
    const locked = item('a', 'Popcorn', { locked: true })
    const result = mergeReceipt([locked], { storeName: 'Aldi', rows: [{ itemName: 'Popcorn', categoryId: 'p', amount: 2.99, quantity: 1, unit: 'each', plannedKey: 'a' }], extras: [], newKey })
    expect(result.items.find((i) => i.key === 'a')!.price).toBe('')
    expect(result.added).toBe(1)
  })
})
