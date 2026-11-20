import { describe, expect, it } from 'vitest'
import type { PlaylistId } from '@shared/types'
import { firstUnreviewed, nextAfterMark } from '../src/renderer/src/viewer/navigation'

const U: PlaylistId = null // unreviewed
const L: PlaylistId = 1 // Like
const M: PlaylistId = 2 // Meh
const X: PlaylistId = 7 // some other playlist

describe('nextAfterMark', () => {
  it('in All/Unreviewed, skips photos already in a playlist', () => {
    const s = [L, X, U, M, U]
    expect(nextAfterMark(s, 1, 'all')).toBe(2)
    expect(nextAfterMark(s, 2, 'unreviewed')).toBe(4)
    expect(nextAfterMark([U, L, X, U], 0, 'all')).toBe(3)
  })
  it('in All/Unreviewed, returns null when nothing unreviewed is left after the current photo', () => {
    expect(nextAfterMark([U, U, L, M], 1, 'all')).toBeNull()
    expect(nextAfterMark([L], 0, 'unreviewed')).toBeNull()
  })
  it('when viewing a playlist (or a feature filter), goes to the next photo regardless', () => {
    expect(nextAfterMark([L, L, L], 0, 'playlist:1')).toBe(1)
    expect(nextAfterMark([M, X, M], 1, 'playlist:2')).toBe(2)
    expect(nextAfterMark([M, M], 1, 'playlist:2')).toBeNull()
    expect(nextAfterMark([U, U], 0, 'duplicates')).toBe(1)
  })
})

describe('firstUnreviewed', () => {
  it('finds the first photo not in any playlist', () => {
    expect(firstUnreviewed([L, M, U, U])).toBe(2)
    expect(firstUnreviewed([L, X])).toBe(-1)
  })
})
