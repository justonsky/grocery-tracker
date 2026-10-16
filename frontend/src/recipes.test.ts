import { describe, expect, it } from 'vitest'
import type { Recipe } from './api/types'
import { itemsToAdd, lineKeysToDrop } from './recipes'

const recipe = (name: string, ...items: string[]): Recipe => ({
  id: name, name, description: null, photoVersion: 0, estimatedCost: null, tripCount: 0, lastPlanned: null,
  items: items.map((itemName) => ({ itemId: itemName, itemName, categoryId: null, categoryName: 'Other', amount: null, averagePrice: null })),
})
const line = (itemName: string, extra: Partial<{ checked: boolean; price: string }> = {}) => ({ itemName, checked: false, price: '', ...extra })

describe('itemsToAdd', () => {
  it('skips items already on the trip, ignoring case and spacing', () => {
    const added = itemsToAdd(recipe('Soup', 'Leeks', ' Potatoes ', 'Cream'), [{ itemName: 'leeks' }, { itemName: 'POTATOES' }])
    expect(added.map((i) => i.itemName)).toEqual(['Cream'])
  })
})

describe('lineKeysToDrop', () => {
  const soup = recipe('Soup', 'Leeks', 'Cream', 'Salt')
  const pasta = recipe('Pasta', 'Cream', 'Penne')

  it("drops the meal's unbought lines but not ones another planned meal still needs", () => {
    const lines = [line('Leeks'), line('Cream'), line('Salt'), line('Penne')]
    const dropped = lineKeysToDrop(soup, [pasta], lines)
    expect([...dropped].map((l) => l.itemName)).toEqual(['Leeks', 'Salt'])
  })

  it('keeps lines that are ticked off or already priced', () => {
    const lines = [line('Leeks', { checked: true }), line('Salt', { price: '1.20' }), line('Cream')]
    expect([...lineKeysToDrop(soup, [], lines)].map((l) => l.itemName)).toEqual(['Cream'])
  })

  it('does nothing for an unknown recipe', () => {
    expect(lineKeysToDrop(undefined, [], [line('Leeks')]).size).toBe(0)
  })
})
