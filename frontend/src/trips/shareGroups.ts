// Grouping and colors for the "Preview & share" card. Pure, so the card renders
// (and exports to PNG/JPG) the same from any device.

export type GroupBy = 'category' | 'store' | 'none'

export interface ShareItem {
  itemName: string
  categoryName: string
  storeName: string | null
  checked: boolean
  price: number | null
}

export interface ShareGroup {
  // "category:produce" / "store:aldi" — also the key colors are saved under.
  key: string
  label: string
  items: ShareItem[]
}

export const PRESET_COLORS = [
  { name: 'Light Green', value: '#d8f3dc' },
  { name: 'Light Gold', value: '#fbefc4' },
  { name: 'Light Orange', value: '#fde2c8' },
  { name: 'Light Blue', value: '#d7e9fb' },
  { name: 'Light Pink', value: '#fadde6' },
  { name: 'Lavender', value: '#e6defa' },
  { name: 'Mint', value: '#d3f2ec' },
  { name: 'Peach', value: '#fde4dc' },
  { name: 'Lemon', value: '#fbf6c7' },
  { name: 'Light Gray', value: '#e9ebef' },
] as const

const color = (name: (typeof PRESET_COLORS)[number]['name']) => PRESET_COLORS.find((c) => c.name === name)!.value

// The household's regular stores, by slug (so "BJ's", "BJs" and "BJ’s" all match).
export const STORE_DEFAULT_COLORS: Record<string, string> = {
  bjs: color('Light Green'),
  rt17farmersmarket: color('Light Gold'),
  aldi: color('Light Orange'),
  hmart: color('Light Blue'),
}

// Lowercase letters and digits only; matches the server's key validation.
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)

// A group's key part. A name with no Latin letters or digits ("한아름") slugs to
// nothing, and "any" is reserved for unassigned lines, so those get a stable
// hash of the name instead — never a key another group could share.
export function groupSlug(name: string): string {
  const s = slug(name)
  if (s && s !== 'any') return s
  let hash = 0x811c9dc5
  for (const ch of name.trim().toLowerCase()) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `h${hash.toString(36)}`
}

export function buildGroups(items: ShareItem[], groupBy: GroupBy, storeOrder: string[] = []): ShareGroup[] {
  const named = items.filter((i) => i.itemName.trim())
  if (groupBy === 'none') return named.length ? [{ key: 'none', label: '', items: named }] : []

  const groups = new Map<string, ShareGroup>()
  const add = (key: string, label: string, item?: ShareItem) => {
    if (!groups.has(key)) groups.set(key, { key, label, items: [] })
    if (item) groups.get(key)!.items.push(item)
  }

  if (groupBy === 'category') {
    for (const item of named) {
      const label = item.categoryName || 'Other'
      add(`category:${groupSlug(label)}`, label, item)
    }
    return [...groups.values()]
  }

  // By store: the trip's own store order, then any other store a line names,
  // then lines not tied to a store. Empty stores are left out.
  for (const store of storeOrder) add(`store:${groupSlug(store)}`, store)
  for (const item of named) {
    if (item.storeName) add(`store:${groupSlug(item.storeName)}`, item.storeName, item)
  }
  const unassigned = named.filter((i) => !i.storeName)
  if (unassigned.length) groups.set('store:any', { key: 'store:any', label: 'Any store', items: unassigned })
  return [...groups.values()].filter((g) => g.items.length > 0)
}

// The color for each group: what the user picked ("none" = no color), else the
// store's default, else the next preset not already used on this card — so
// neighbouring groups always differ.
export function resolveGroupColors(groups: ShareGroup[], groupBy: GroupBy, picked: Record<string, string>): Map<string, string | null> {
  const resolved = new Map<string, string | null>()
  if (groupBy === 'none') {
    for (const g of groups) resolved.set(g.key, null)
    return resolved
  }

  const pending: ShareGroup[] = []
  for (const g of groups) {
    const choice = picked[g.key]
    if (choice === 'none') resolved.set(g.key, null)
    else if (choice) resolved.set(g.key, choice.toLowerCase())
    else if (groupBy === 'store' && STORE_DEFAULT_COLORS[g.key.slice('store:'.length)]) {
      resolved.set(g.key, STORE_DEFAULT_COLORS[g.key.slice('store:'.length)])
    } else pending.push(g)
  }

  const used = new Set([...resolved.values()].filter((c): c is string => !!c))
  const free = PRESET_COLORS.map((c) => c.value).filter((c) => !used.has(c))
  const pool = free.length ? free : PRESET_COLORS.map((c) => c.value)
  pending.forEach((g, i) => resolved.set(g.key, pool[i % pool.length]))
  return resolved
}

// Readable text on a group's background: dark ink on light fills, white on dark ones.
export function inkFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.4 ? '#1d1e29' : '#ffffff'
}
