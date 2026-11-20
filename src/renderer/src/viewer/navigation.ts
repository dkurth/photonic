import type { Filter, PlaylistId } from '@shared/types'

/** Views where marking jumps to the next *unreviewed* photo; elsewhere it just goes to the next one (PLAN.md §2). */
export function jumpsToUnreviewed(filter: Filter): boolean {
  return filter === 'all' || filter === 'unreviewed'
}

/**
 * Where to go after marking the photo at `index` (`marks[i]` is each photo's playlist, null =
 * unreviewed); null means the end of the list was reached.
 */
export function nextAfterMark(marks: readonly PlaylistId[], index: number, filter: Filter): number | null {
  if (!jumpsToUnreviewed(filter)) return index + 1 < marks.length ? index + 1 : null
  for (let j = index + 1; j < marks.length; j++) if (marks[j] === null) return j
  return null
}

export function firstUnreviewed(marks: readonly PlaylistId[]): number {
  return marks.indexOf(null)
}
