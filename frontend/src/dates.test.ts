import { describe, expect, it } from 'vitest'
import { localIsoDate, tripDateLabel } from './dates'

describe('localIsoDate', () => {
  it('uses the local calendar date, not UTC', () => {
    // 11:30 PM local on Oct 16 — toISOString() would say Oct 17 anywhere west of UTC.
    expect(localIsoDate(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16')
    expect(localIsoDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })
})

describe('tripDateLabel', () => {
  it('formats a trip date as that same local day', () => {
    expect(tripDateLabel('2026-08-29')).toContain('29')
    expect(tripDateLabel('2026-08-29')).toContain('2026')
    expect(tripDateLabel('2026-08-29', { year: false })).not.toContain('2026')
  })
  it('leaves unreadable text alone', () => {
    expect(tripDateLabel('soon')).toBe('soon')
  })
})
