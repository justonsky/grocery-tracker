// Live cost math for the trip editor: totals, savings and per-store subtotals,
// computed from the draft as it's typed. Mirrors TripService.ToDto on the server
// (EstimatedTotal/Total/Savings), which is what the trips list shows after a save.

export interface CostLine {
  storeName: string | null
  estimate: number | null
  price: number | null
}

export interface CostSummary {
  lineCount: number
  // Sum of estimates, over the lines that have one.
  estimated: number
  estimatedCount: number
  // Sum of what was actually paid, over the lines that have a price.
  spent: number
  pricedCount: number
  // Estimate minus price, only over lines that have both, so an unbought item
  // can't read as money saved. Positive = under estimate; null = nothing to compare.
  savings: number | null
}

export interface StoreSubtotal extends CostSummary {
  // null groups the lines not assigned to any store.
  storeName: string | null
}

// Money is summed in whole cents so 0.1 + 0.2 never shows up as 0.30000000000000004.
const cents = (n: number) => Math.round(n * 100)

export function summarize(lines: CostLine[]): CostSummary {
  let estimated = 0
  let estimatedCount = 0
  let spent = 0
  let pricedCount = 0
  let savings = 0
  let comparedCount = 0

  for (const line of lines) {
    if (line.estimate != null) {
      estimated += cents(line.estimate)
      estimatedCount++
    }
    if (line.price != null) {
      spent += cents(line.price)
      pricedCount++
    }
    if (line.estimate != null && line.price != null) {
      savings += cents(line.estimate) - cents(line.price)
      comparedCount++
    }
  }

  return {
    lineCount: lines.length,
    estimated: estimated / 100,
    estimatedCount,
    spent: spent / 100,
    pricedCount,
    savings: comparedCount === 0 ? null : savings / 100,
  }
}

// One subtotal per store in the trip's own store order, then any store a line
// names that isn't on the trip's list, then the unassigned lines last. Stores
// with no lines are left out.
export function summarizeByStore(lines: CostLine[], storeOrder: string[]): StoreSubtotal[] {
  // Keyed ignoring case ("aldi" and "Aldi" are one store), labelled with the
  // trip's own spelling when it has one.
  const key = (name: string) => name.trim().toLowerCase()
  const groups = new Map<string | null, { label: string | null; lines: CostLine[] }>()
  for (const name of storeOrder) if (!groups.has(key(name))) groups.set(key(name), { label: name, lines: [] })
  for (const line of lines) {
    const k = line.storeName ? key(line.storeName) : null
    if (!groups.has(k)) groups.set(k, { label: line.storeName, lines: [] })
    groups.get(k)!.lines.push(line)
  }

  const unassigned = groups.get(null)
  groups.delete(null)
  if (unassigned) groups.set(null, unassigned)

  return [...groups.values()]
    .filter((group) => group.lines.length > 0)
    .map((group) => ({ storeName: group.label, ...summarize(group.lines) }))
}
