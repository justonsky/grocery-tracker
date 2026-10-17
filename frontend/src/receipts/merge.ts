import type { QuantityUnit, ReceiptLine } from '../api/types'
import type { DraftItem } from '../components/TripItemList'

const normalize = (s: string) => s.trim().toLowerCase()
const NOISE = new Set(['lb', 'lbs', 'oz', 'ct', 'pk', 'ea', 'x', 'lrw', 'fa', 'fb', 'nb', 'n', 't', 'the', 'and', 'of'])
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w) && !/^\d+$/.test(w))

const isSubsequence = (small: string, big: string) => {
  let j = 0
  for (const c of big) if (j < small.length && small[j] === c) j++
  return j === small.length
}
const wordScore = (r: string, i: string) =>
  r === i ? 1 : r.length >= 3 && i.startsWith(r) ? 0.85 : i.length >= 3 && r.startsWith(i) ? 0.8 : r.length >= 3 && r[0] === i[0] && isSubsequence(r, i) ? 0.7 : 0

// How well a receipt's (often abbreviated) text fits an item name, 0–1 — the same scoring as the
// server's ItemNameMatcher, so "Redcd Sodium Broth" fits "Reduced Sodium Chicken Broth".
export function nameScore(receiptText: string, itemName: string): number {
  const r = words(receiptText)
  const it = words(itemName)
  if (!r.length || !it.length) return 0
  const used = new Set<number>()
  let matched = 0
  for (const w of r) {
    let best = 0
    let at = -1
    it.forEach((x, i) => {
      if (used.has(i)) return
      const s = wordScore(w, x)
      if (s > best) [best, at] = [s, i]
    })
    if (at >= 0) used.add(at)
    matched += best
  }
  return matched / (r.length + 0.5 * Math.max(0, it.length - used.size))
}

const sameStore = (a: string | null, b: string | null) => !a || !b || normalize(a) === normalize(b)
const unbought = (line: DraftItem) => !!line.itemName.trim() && !line.checked && !line.price.trim() && !line.locked

// Pairs receipt lines with the trip's still-unbought lines at that store (or "any store"): by name,
// helped by how close the price is to the line's estimate. Each trip line is used once, best first.
export function pairWithPlanned(lines: ReceiptLine[], items: DraftItem[], storeName: string | null): Map<string, string> {
  const pool = items.filter((it) => unbought(it) && sameStore(it.storeName, storeName))
  const scored: { line: string; key: string; score: number }[] = []
  for (const line of lines) {
    if (line.kind !== 'item') continue
    for (const it of pool) {
      const name = Math.max(nameScore(line.text, it.itemName), line.name ? nameScore(line.name, it.itemName) : 0)
      if (name < 0.5) continue
      const estimate = Number.parseFloat(it.estimate)
      const closeness = Number.isFinite(estimate) && estimate > 0 ? 1 - Math.min(1, Math.abs(line.amount - estimate) / estimate) : 0.5
      const score = 0.7 * name + 0.3 * closeness
      if (score >= 0.55) scored.push({ line: line.id, key: it.key, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const pairs = new Map<string, string>()
  const taken = new Set<string>()
  for (const s of scored) {
    if (pairs.has(s.line) || taken.has(s.key)) continue
    pairs.set(s.line, s.key)
    taken.add(s.key)
  }
  return pairs
}

// One reviewed receipt line, as it goes onto the trip.
export interface ReceiptRow {
  itemName: string
  categoryId: string
  amount: number
  quantity: number
  unit: QuantityUnit
  // The trip line it is (from pairWithPlanned or the user), if any.
  plannedKey?: string | null
}

export interface ReceiptMergeInput {
  storeName: string
  rows: ReceiptRow[]
  // Tax, fees, tips and deposits, and an unexplained difference ("Unlisted purchases"): extra lines.
  extras: { itemName: string; categoryId: string; amount: number }[]
  newKey: () => string
}

const money = (n: number) => n.toFixed(2)
const qtyText = (q: number) => (q === 1 ? '' : String(Math.round(q * 1000) / 1000))

// Puts a reviewed receipt onto the trip's lines: a planned line gets its price, quantity and a tick;
// anything else becomes a new ticked line at the store. The same item twice on the receipt is one
// line (amounts and same-unit quantities added). Locked lines are never touched.
export function mergeReceipt(items: DraftItem[], input: ReceiptMergeInput): { items: DraftItem[]; updated: number; added: number } {
  const groups = new Map<string, ReceiptRow>()
  for (const row of input.rows) {
    const key = `${normalize(row.itemName)}|${row.unit === 'each' ? 'each' : 'weight'}|${row.plannedKey ?? ''}`
    const prev = groups.get(key)
    if (!prev) groups.set(key, { ...row })
    else groups.set(key, { ...prev, amount: prev.amount + row.amount, quantity: prev.unit === row.unit ? prev.quantity + row.quantity : prev.quantity })
  }

  const next = items.map((it) => ({ ...it }))
  const used = new Set<string>()
  let updated = 0
  let added = 0
  const fresh: DraftItem[] = []
  for (const row of groups.values()) {
    // The paired line, else an unbought line for the same item at this store.
    const target =
      next.find((it) => it.key === row.plannedKey && unbought(it) && !used.has(it.key)) ??
      next.find((it) => unbought(it) && !used.has(it.key) && normalize(it.itemName) === normalize(row.itemName) && sameStore(it.storeName, input.storeName))
    if (target) {
      used.add(target.key)
      target.price = money(row.amount)
      target.quantity = qtyText(row.quantity)
      target.unit = row.unit
      target.checked = true
      target.storeName = target.storeName ?? input.storeName
      updated++
    } else {
      fresh.push({
        key: input.newKey(), id: null, itemName: row.itemName, categoryId: row.categoryId, storeName: input.storeName,
        checked: true, estimate: '', price: money(row.amount), quantity: qtyText(row.quantity), unit: row.unit,
        locked: false, priceLocksAt: null,
      })
      added++
    }
  }
  for (const extra of input.extras) {
    if (extra.amount <= 0) continue
    fresh.push({
      key: input.newKey(), id: null, itemName: extra.itemName, categoryId: extra.categoryId, storeName: input.storeName,
      checked: true, estimate: '', price: money(extra.amount), quantity: '', unit: 'each', locked: false, priceLocksAt: null,
    })
    added++
  }
  // The blank starter row of a new list makes way.
  const kept = next.filter((it) => it.itemName.trim() || it.price.trim() || it.checked)
  return { items: [...kept, ...fresh], updated, added }
}

