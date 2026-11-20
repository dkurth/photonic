import type { Scope, SortOrder, ViewSpec } from '@shared/types'
import type { DB } from './db'
import { displayDate } from './photos'

/** Extra filters registered by optional features: SQL condition on `photos p` + its params. */
export type FilterImpl = (libraryId: number) => { where: string; params: unknown[] }

const CORE_FILTERS: Record<string, string> = {
  all: '1 = 1',
  unreviewed: "p.status = 'unreviewed'",
  like: "p.status = 'like'",
  meh: "p.status = 'meh'"
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Natural sort that keeps folders together: compare path segment by segment. */
export function comparePaths(a: string, b: string): number {
  const as = a.split('/')
  const bs = b.split('/')
  const n = Math.min(as.length, bs.length)
  for (let i = 0; i < n; i++) {
    // At the last segment of the shorter path, a file sorts before a sub-folder's contents.
    const aIsFile = i === as.length - 1
    const bIsFile = i === bs.length - 1
    if (aIsFile !== bIsFile) return aIsFile ? -1 : 1
    const c = collator.compare(as[i], bs[i]) || (as[i] < bs[i] ? -1 : as[i] > bs[i] ? 1 : 0)
    if (c) return c
  }
  return as.length - bs.length
}

/** mulberry32: small, fast, seedable PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rand = rng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function scopeSql(scope: Scope): { where: string; params: unknown[] } {
  if (scope.kind === 'library' || scope.dirPath === '') return { where: '1 = 1', params: [] }
  // substr instead of LIKE so folder names containing % or _ need no escaping.
  return {
    where: '(p.dir_path = ? OR substr(p.dir_path, 1, ?) = ?)',
    params: [scope.dirPath, scope.dirPath.length + 1, scope.dirPath + '/']
  }
}

/**
 * The ordered photo IDs for a view (PLAN.md §7). This is the one place that decides which
 * photos are in a view. Missing photos are never included.
 */
export function listIds(db: DB, view: ViewSpec, extraFilters: Record<string, FilterImpl> = {}): number[] {
  let filter: { where: string; params: unknown[] }
  if (view.filter in CORE_FILTERS) filter = { where: CORE_FILTERS[view.filter], params: [] }
  else if (extraFilters[view.filter]) filter = extraFilters[view.filter](view.libraryId)
  else throw new Error(`Unknown filter: ${view.filter}`)

  const scope = scopeSql(view.scope)
  const rows = db
    .prepare(
      `SELECT p.id, p.rel_path, p.taken_at, p.birthtime_ms, p.mtime_ms FROM photos p
       WHERE p.library_id = ? AND p.missing = 0 AND ${scope.where} AND ${filter.where}`
    )
    .all(view.libraryId, ...scope.params, ...filter.params) as {
    id: number
    rel_path: string
    taken_at: string | null
    birthtime_ms: number | null
    mtime_ms: number
  }[]

  return sortRows(rows, view.sort, view.seed ?? 1).map((r) => r.id)
}

function sortRows<T extends { id: number; rel_path: string; taken_at: string | null; birthtime_ms: number | null; mtime_ms: number }>(
  rows: T[],
  sort: SortOrder,
  seed: number
): T[] {
  switch (sort) {
    case 'filename':
      return rows.sort((a, b) => comparePaths(a.rel_path, b.rel_path))
    case 'date': {
      const keyed = rows.map((r) => ({ r, k: displayDate(r).date }))
      keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : comparePaths(a.r.rel_path, b.r.rel_path)))
      return keyed.map((x) => x.r)
    }
    case 'random':
      // Shuffle from a fixed base order so the result depends only on the seed and the set of photos.
      return seededShuffle(
        rows.sort((a, b) => a.id - b.id),
        seed
      )
  }
}
