import { describe, expect, it } from 'vitest'
import { rankOptions } from './Combobox'

const opts = (...labels: string[]) => labels.map((label) => ({ value: label, label }))
const ranked = (query: string, ...labels: string[]) => rankOptions(opts(...labels), query).map((o) => o.label)

describe('rankOptions', () => {
  it('puts names starting with the query first, then word starts, then anywhere', () => {
    expect(ranked('mil', 'Almond Milk', 'Chamomile Tea', 'Milk', 'Whole Milk', 'Millet')).toEqual([
      'Milk',
      'Millet',
      'Almond Milk',
      'Whole Milk',
      'Chamomile Tea',
    ])
  })

  it('ignores case and surrounding spaces, and drops non-matches', () => {
    expect(ranked('  EGG ', 'Eggs', 'Quail Eggs', 'Bread')).toEqual(['Eggs', 'Quail Eggs'])
  })

  it('returns everything for an empty query', () => {
    expect(ranked('', 'B', 'A')).toEqual(['B', 'A'])
  })
})
