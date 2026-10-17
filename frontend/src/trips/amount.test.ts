import { describe, expect, it } from 'vitest'
import { amountText, tidyAmount } from './amount'

describe('amountText', () => {
  it('shows cents for whole and fractional amounts', () => {
    expect(amountText(3)).toBe('3.00')
    expect(amountText(3.5)).toBe('3.50')
    expect(amountText(0)).toBe('0.00')
  })
  it('is blank when the amount is unknown', () => {
    expect(amountText(null)).toBe('')
    expect(amountText(undefined)).toBe('')
  })
})

describe('tidyAmount', () => {
  it('adds cents to a typed amount', () => {
    expect(tidyAmount('3')).toBe('3.00')
    expect(tidyAmount('3.5')).toBe('3.50')
    expect(tidyAmount('.99')).toBe('0.99')
  })
  it('leaves blank, negative and unreadable text alone', () => {
    expect(tidyAmount('')).toBe('')
    expect(tidyAmount('  ')).toBe('  ')
    expect(tidyAmount('-2')).toBe('-2')
    expect(tidyAmount('abc')).toBe('abc')
  })
})
