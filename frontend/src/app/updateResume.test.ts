import { describe, expect, it } from 'vitest'
import { stashProfileForUpdate, takeProfileAfterUpdate } from './updateResume'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  }
}

describe('update resume', () => {
  it('hands the stashed profile to the next load, once', () => {
    const s = memoryStorage()
    stashProfileForUpdate('p1', s, 1_000)
    expect(takeProfileAfterUpdate(s, 3_000)).toBe('p1')
    expect(takeProfileAfterUpdate(s, 3_000)).toBeNull()
  })
  it('ignores a stash left behind for longer than a reload takes', () => {
    const s = memoryStorage()
    stashProfileForUpdate('p1', s, 1_000)
    expect(takeProfileAfterUpdate(s, 1_000 + 31_000)).toBeNull()
  })
  it('stashes nothing when no profile is open', () => {
    const s = memoryStorage()
    stashProfileForUpdate('p1', s, 1_000)
    stashProfileForUpdate(null, s, 1_000)
    expect(takeProfileAfterUpdate(s, 1_000)).toBeNull()
  })
  it('ignores garbage', () => {
    const s = memoryStorage()
    s.setItem('grocery-tracker-update-resume', '{nope')
    expect(takeProfileAfterUpdate(s)).toBeNull()
  })
})
