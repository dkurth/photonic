import type { PhotoList, SortOrder, Status, StatusCounts, ViewSpec } from '@shared/types'
import type { DB } from './db'
import { visibleSql } from './marks'
import { displayDate } from './photos'

/**
 * Extra filters registered by optional features: an SQL condition on `photos p` plus its params.
 * `groupBy` (an SQL expression) keeps photos with the same value next to each other — each group
 * appears where its first photo falls in the chosen sort order. `includeHidden` shows photos that
 * are hidden from review (e.g. the Duplicates view shows the hidden copies too).
 */
export type FilterImpl = (libraryId: number) => {
  where: string
  params: unknown[]
  groupBy?: string
  includeHidden?: boolean
}

/** Which features' hidden photos to leave out (PLAN.md §8): their hide reasons, e.g. ['duplicate']. */
export interface Visibility {
  hideReasons?: readonly string[]
}

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

/**
 * The ordered photo IDs for a view (PLAN.md §7). This is the one place that decides which
 * photos are in a view. Missing photos are never included.
 */
export function listIds(
  db: DB,
  view: ViewSpec,
  extraFilters: Record<string, FilterImpl> = {},
  vis: Visibility = {}
): number[] {
  return listPhotos(db, view, extraFilters, vis).ids
}

/** listIds plus each photo's status, in the same order. */
export function listPhotos(
  db: DB,
  view: ViewSpec,
  extraFilters: Record<string, FilterImpl> = {},
  vis: Visibility = {}
): PhotoList {
  let filter: ReturnType<FilterImpl>
  if (view.filter in CORE_FILTERS) filter = { where: CORE_FILTERS[view.filter], params: [] }
  else if (extraFilters[view.filter]) filter = extraFilters[view.filter](view.libraryId)
  else throw new Error(`Unknown filter: ${view.filter}`)

  const rows = db
    .prepare(
      `SELECT p.id, p.rel_path, p.taken_at, p.birthtime_ms, p.mtime_ms, p.status, ${filter.groupBy ?? 'NULL'} AS grp FROM photos p
       WHERE p.library_id = ? AND p.missing = 0 AND ${filter.where}
         AND ${filter.includeHidden ? '1 = 1' : visibleSql('p', vis.hideReasons ?? [])}`
    )
    .all(view.libraryId, ...filter.params) as {
    id: number
    rel_path: string
    taken_at: string | null
    birthtime_ms: number | null
    mtime_ms: number
    status: Status
    grp: unknown
  }[]

  let sorted = sortRows(rows, view.sort, view.seed ?? 1)
  if (filter.groupBy) sorted = clusterGroups(sorted)
  return { ids: sorted.map((r) => r.id), statuses: sorted.map((r) => r.status) }
}

/** Stable clustering: each group moves up to where its first member is. */
function clusterGroups<T extends { grp: unknown }>(rows: T[]): T[] {
  const groups = new Map<unknown, T[]>()
  for (const r of rows) {
    const g = groups.get(r.grp)
    if (g) g.push(r)
    else groups.set(r.grp, [r])
  }
  return [...groups.values()].flat()
}

/** Status counts for a library (missing and hidden photos excluded). */
export function statusCounts(db: DB, libraryId: number, vis: Visibility = {}): StatusCounts {
  return db
    .prepare(
      `SELECT count(*) AS total,
         count(*) FILTER (WHERE p.status = 'unreviewed') AS unreviewed,
         count(*) FILTER (WHERE p.status = 'like') AS "like",
         count(*) FILTER (WHERE p.status = 'meh') AS meh
       FROM photos p WHERE p.library_id = ? AND p.missing = 0 AND ${visibleSql('p', vis.hideReasons ?? [])}`
    )
    .get(libraryId) as StatusCounts
}

function sortRows<
  T extends { id: number; rel_path: string; taken_at: string | null; birthtime_ms: number | null; mtime_ms: number }
>(rows: T[], sort: SortOrder, seed: number): T[] {
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
