import type { Filter, Status } from '@shared/types'

/** Views where ↑/↓ jump to the next *unreviewed* photo; elsewhere they just go to the next one (PLAN.md §2). */
export function jumpsToUnreviewed(filter: Filter): boolean {
  return filter === 'all' || filter === 'unreviewed'
}

/** Where to go after marking the photo at `index`; null means the end of the list was reached. */
export function nextAfterMark(statuses: readonly Status[], index: number, filter: Filter): number | null {
  if (!jumpsToUnreviewed(filter)) return index + 1 < statuses.length ? index + 1 : null
  for (let j = index + 1; j < statuses.length; j++) if (statuses[j] === 'unreviewed') return j
  return null
}

export function firstUnreviewed(statuses: readonly Status[]): number {
  return statuses.indexOf('unreviewed')
}

export function countStatuses(statuses: readonly Status[]): Record<Status, number> {
  const c: Record<Status, number> = { unreviewed: 0, like: 0, meh: 0 }
  for (const s of statuses) c[s]++
  return c
}
