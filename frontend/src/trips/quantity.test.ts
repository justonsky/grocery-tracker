import { describe, expect, it } from 'vitest'
import { estimateFrom, parseQuantity, quantityLabel, validQuantity } from './quantity'

describe('parseQuantity', () => {
  it.each([
    ['2', 2], ['0.75', 0.75], ['.5', 0.5], ['3/4', 0.75], ['1 1/2', 1.5], ['¾', 0.75], ['1½', 1.5], [' 12 ', 12], ['1,5', 1.5],
  ])('%s → %s', (text, value) => expect(parseQuantity(text)).toBe(value))

  it.each(['', 'two', '1/0', '-1', '3/', '½½'])('rejects %j', (text) => expect(parseQuantity(text)).toBeNull())

  it('keeps three decimals like the server', () => expect(parseQuantity('1/3')).toBe(0.333))
})

describe('validQuantity', () => {
  it('needs more than zero and at most 9999', () => {
    expect(validQuantity(0)).toBe(false)
    expect(validQuantity(0.25)).toBe(true)
    expect(validQuantity(10000)).toBe(false)
    expect(validQuantity(null)).toBe(false)
  })
})

describe('quantityLabel', () => {
  it('says nothing for one of an item', () => expect(quantityLabel(1, 'each')).toBe(''))
  it('shows counts as ×N', () => expect(quantityLabel(2, 'each')).toBe('×2'))
  it('shows weights with their unit', () => expect(quantityLabel(0.75, 'lb')).toBe('0.75 lb'))
  it('treats missing values as 1 each', () => expect(quantityLabel(undefined, undefined)).toBe(''))
})

describe('estimateFrom', () => {
  it('multiplies a per-item average by the count', () => expect(estimateFrom(3.55, 'each', 2, 'each')).toBe(7.1))
  it('works in pounds whatever the weight unit', () => {
    expect(estimateFrom(12, 'lb', 0.75, 'lb')).toBe(9)
    expect(estimateFrom(12, 'lb', 12, 'oz')).toBe(9)
  })
  it("can't estimate a weight from a per-item price (or the reverse)", () => {
    expect(estimateFrom(8, 'each', 0.75, 'lb')).toBeNull()
    expect(estimateFrom(12, 'lb', 2, 'each')).toBeNull()
  })
})
