import { describe, expect, it } from 'vitest'
import { STORE_DEFAULT_COLORS, buildGroups, groupSlug, inkFor, resolveGroupColors, slug, type ShareItem } from './shareGroups'

const item = (itemName: string, categoryName: string, storeName: string | null): ShareItem => ({
  itemName,
  categoryName,
  storeName,
  checked: false,
  price: null,
})

const items = [
  item('Milk', 'Dairy', 'Aldi'),
  item('Kale', 'Produce', "BJ's"),
  item('Eggs', 'Dairy', null),
  item('Okra', 'Produce', 'Rt-17 Farmer’s Market'),
  item('', 'Produce', 'Aldi'), // unnamed rows never appear
]

describe('buildGroups', () => {
  it('groups by category in order of first appearance', () => {
    const groups = buildGroups(items, 'category')
    expect(groups.map((g) => [g.key, g.items.map((i) => i.itemName)])).toEqual([
      ['category:dairy', ['Milk', 'Eggs']],
      ['category:produce', ['Kale', 'Okra']],
    ])
  })

  it("groups by store in the trip's store order, unassigned last, empty stores dropped", () => {
    const groups = buildGroups(items, 'store', ["BJ's", 'Costco', 'Aldi'])
    expect(groups.map((g) => g.label)).toEqual(["BJ's", 'Aldi', 'Rt-17 Farmer’s Market', 'Any store'])
    expect(groups.map((g) => g.key)).toEqual(['store:bjs', 'store:aldi', 'store:rt17farmersmarket', 'store:any'])
  })

  it('puts everything in one group when not grouping', () => {
    expect(buildGroups(items, 'none')).toEqual([{ key: 'none', label: '', items: items.slice(0, 4) }])
  })
})

describe('resolveGroupColors', () => {
  const byStore = buildGroups([...items, item('Tofu', 'Pantry', 'HMart'), item('Rice', 'Pantry', 'Costco')], 'store', [])

  it('gives the regular stores their default colors', () => {
    const colors = resolveGroupColors(byStore, 'store', {})
    expect(colors.get('store:bjs')).toBe('#d8f3dc') // light green
    expect(colors.get('store:rt17farmersmarket')).toBe('#fbefc4') // light gold
    expect(colors.get('store:aldi')).toBe('#fde2c8') // light orange
    expect(colors.get('store:hmart')).toBe('#d7e9fb') // light blue
  })

  it('gives every other group a distinct color', () => {
    const colors = [...resolveGroupColors(byStore, 'store', {}).values()]
    expect(new Set(colors).size).toBe(colors.length)
  })

  it("honors the user's picks, including no color", () => {
    const colors = resolveGroupColors(byStore, 'store', { 'store:aldi': '#ABCDEF', 'store:bjs': 'none' })
    expect(colors.get('store:aldi')).toBe('#abcdef')
    expect(colors.get('store:bjs')).toBeNull()
  })

  it('uses no colors when not grouping', () => {
    expect([...resolveGroupColors(buildGroups(items, 'none'), 'none', {}).values()]).toEqual([null])
  })

  it("doesn't apply store defaults to categories", () => {
    const colors = resolveGroupColors([{ key: 'category:aldi', label: 'Aldi', items: [] }], 'category', {})
    expect(colors.get('category:aldi')).not.toBe(STORE_DEFAULT_COLORS.aldi)
  })
})

describe('helpers', () => {
  it('slugs names to the saved-key form', () => {
    expect(slug("BJ's")).toBe('bjs')
    expect(slug('H Mart')).toBe('hmart')
  })

  it('picks readable text for light and dark fills', () => {
    expect(inkFor('#d8f3dc')).toBe('#1d1e29')
    expect(inkFor('#1d3557')).toBe('#ffffff')
  })

  it('gives names without Latin letters (and a store called "Any") their own keys', () => {
    expect(groupSlug('한아름')).toMatch(/^h[a-z0-9]+$/)
    expect(groupSlug('한아름')).not.toBe(groupSlug('99 랜치'))
    expect(groupSlug('Any')).not.toBe('any')
    const groups = buildGroups([item('Kimchi', 'Pantry', '한아름'), item('Eggs', 'Dairy', null)], 'store', [])
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['한아름', 1], ['Any store', 1]])
  })
})
