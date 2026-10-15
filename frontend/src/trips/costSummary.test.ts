import { describe, expect, it } from 'vitest'
import { summarize, summarizeByStore, type CostLine } from './costSummary'

const line = (storeName: string | null, estimate: number | null, price: number | null): CostLine => ({ storeName, estimate, price })

describe('summarize', () => {
  it('totals estimates and spend separately, each over the lines that have one', () => {
    const s = summarize([line(null, 4, 3), line(null, 6, null), line(null, null, 2)])
    expect(s).toMatchObject({ lineCount: 3, estimated: 10, estimatedCount: 2, spent: 5, pricedCount: 2 })
  })

  it('counts savings only on lines with both an estimate and a price', () => {
    // 4 - 3 = +1, 5 - 5.5 = -0.5; the unbought 6.00 estimate must not count as saved.
    expect(summarize([line(null, 4, 3), line(null, 5, 5.5), line(null, 6, null)]).savings).toBe(0.5)
  })

  it('reports negative savings when over estimate, and null when nothing compares', () => {
    expect(summarize([line(null, 3, 3.75)]).savings).toBe(-0.75)
    expect(summarize([line(null, 3, null), line(null, null, 2)]).savings).toBeNull()
  })

  it('sums in cents, without floating-point drift', () => {
    expect(summarize([line(null, 0.1, 0.1), line(null, 0.2, 0.2)]).spent).toBe(0.3)
  })
})

describe('summarizeByStore', () => {
  it("follows the trip's store order, puts unlisted stores after, and unassigned lines last", () => {
    const subtotals = summarizeByStore(
      [line(null, 1, 1), line('HMart', 2, 1.5), line('Costco', 10, 12), line('Aldi', 3, 2)],
      ['Aldi', 'Costco', 'Empty Store'],
    )
    expect(subtotals.map((s) => s.storeName)).toEqual(['Aldi', 'Costco', 'HMart', null])
    expect(subtotals.find((s) => s.storeName === 'Costco')).toMatchObject({ estimated: 10, spent: 12, savings: -2 })
  })
})
