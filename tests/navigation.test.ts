import { describe, expect, it } from 'vitest'
import type { Status } from '@shared/types'
import { countStatuses, firstUnreviewed, nextAfterMark } from '../src/renderer/src/viewer/navigation'

const U: Status = 'unreviewed'
const L: Status = 'like'
const M: Status = 'meh'

describe('nextAfterMark', () => {
  it('in All/Unreviewed, skips photos that are already marked', () => {
    const s = [L, L, U, M, U]
    expect(nextAfterMark(s, 1, 'all')).toBe(2)
    expect(nextAfterMark(s, 2, 'unreviewed')).toBe(4)
    expect(nextAfterMark([U, L, M, U], 0, 'all')).toBe(3)
  })
  it('in All/Unreviewed, returns null when nothing unreviewed is left after the current photo', () => {
    expect(nextAfterMark([U, U, L, M], 1, 'all')).toBeNull()
    expect(nextAfterMark([L], 0, 'unreviewed')).toBeNull()
  })
  it('in Like/Meh (and feature filters), goes to the next photo regardless of status', () => {
    expect(nextAfterMark([L, L, L], 0, 'like')).toBe(1)
    expect(nextAfterMark([M, L, M], 1, 'meh')).toBe(2)
    expect(nextAfterMark([M, M], 1, 'meh')).toBeNull()
    expect(nextAfterMark([U, U], 0, 'duplicates')).toBe(1)
  })
})

describe('helpers', () => {
  it('firstUnreviewed', () => {
    expect(firstUnreviewed([L, M, U, U])).toBe(2)
    expect(firstUnreviewed([L, M])).toBe(-1)
  })
  it('countStatuses', () => {
    expect(countStatuses([L, M, U, U, L])).toEqual({ like: 2, meh: 1, unreviewed: 2 })
  })
})
