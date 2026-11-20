import { join } from 'node:path'
import type { DuplicateSummary } from '@shared/types'
import type { DB } from '../../db'
import { newBatchId, setHidden } from '../../marks'
import type { FilterImpl } from '../../ordering'
import type { LibraryRow, MovePair, ScanPhoto } from '../../scanner/types'
import type { Hasher } from './hash'

/** A hash is current only while the file's size and mtime still match what was hashed. */
const FRESH = 'h.size_bytes = p.size_bytes AND h.mtime_ms = p.mtime_ms'

export function saveHash(db: DB, photoId: number, hash: string, size: number, mtime: number): void {
  db.prepare(
    `INSERT INTO photo_hashes (photo_id, content_hash, size_bytes, mtime_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(photo_id) DO UPDATE SET content_hash = excluded.content_hash, size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms, hashed_at = datetime('now')`
  ).run(photoId, hash, size, mtime)
}

const NEEDS_HASH = `p.library_id = ? AND p.missing = 0 AND (h.photo_id IS NULL OR NOT (${FRESH}))`

export function countNeedingHash(db: DB, libraryId: number): number {
  return db
    .prepare(`SELECT count(*) FROM photos p LEFT JOIN photo_hashes h ON h.photo_id = p.id WHERE ${NEEDS_HASH}`)
    .pluck()
    .get(libraryId) as number
}

/**
 * Hashes every photo in the library without a current hash (PLAN.md §8). Each hash is saved as
 * soon as it's computed, so the pass resumes where it stopped. Unreadable files are skipped.
 */
export async function runHashPass(
  db: DB,
  library: Pick<LibraryRow, 'id' | 'root_path'>,
  hash: Hasher,
  opts: { signal?: AbortSignal; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ done: number; total: number }> {
  const concurrency = opts.concurrency ?? 4
  const total = countNeedingHash(db, library.id)
  let done = 0
  let lastId = 0
  const next = db.prepare(
    `SELECT p.id, p.rel_path, p.size_bytes, p.mtime_ms FROM photos p LEFT JOIN photo_hashes h ON h.photo_id = p.id
     WHERE ${NEEDS_HASH} AND p.id > ? ORDER BY p.id LIMIT 200`
  )
  opts.onProgress?.(0, total)
  for (;;) {
    opts.signal?.throwIfAborted()
    const rows = next.all(library.id, lastId) as {
      id: number
      rel_path: string
      size_bytes: number
      mtime_ms: number
    }[]
    if (!rows.length) break
    lastId = rows[rows.length - 1].id
    for (let i = 0; i < rows.length; i += concurrency) {
      opts.signal?.throwIfAborted()
      const chunk = rows.slice(i, i + concurrency)
      const hashes = await Promise.all(chunk.map((r) => hash(join(library.root_path, r.rel_path))))
      db.transaction(() => {
        chunk.forEach((r, j) => {
          const h = hashes[j]
          if (h) saveHash(db, r.id, h, r.size_bytes, r.mtime_ms)
        })
      })()
      done += chunk.length
      opts.onProgress?.(done, total)
    }
  }
  return { done, total }
}

/**
 * The matchMoves scan hook (PLAN.md §8): pairs newly found files with missing photos that have
 * the same content. Only new files whose size matches some missing photo get hashed here.
 */
export async function matchMoves(
  db: DB,
  library: Pick<LibraryRow, 'id' | 'root_path'>,
  hash: Hasher,
  added: ScanPhoto[],
  missing: ScanPhoto[],
  signal?: AbortSignal
): Promise<MovePair[]> {
  const known = db
    .prepare(`SELECT photo_id, content_hash FROM photo_hashes WHERE photo_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(missing.map((m) => m.id))) as { photo_id: number; content_hash: string }[]
  if (!known.length) return []

  const missingByHash = new Map<string, number[]>()
  for (const k of known) missingByHash.set(k.content_hash, [...(missingByHash.get(k.content_hash) ?? []), k.photo_id])
  const hashedIds = new Set(known.map((k) => k.photo_id))
  const sizes = new Set(missing.filter((m) => hashedIds.has(m.id)).map((m) => m.sizeBytes))

  const pairs: MovePair[] = []
  for (const a of added) {
    if (!sizes.has(a.sizeBytes)) continue
    signal?.throwIfAborted()
    const h = await hash(join(library.root_path, a.relPath))
    if (!h) continue
    saveHash(db, a.id, h, a.sizeBytes, a.mtimeMs)
    const candidates = missingByHash.get(h)
    const missingId = candidates?.shift()
    if (missingId !== undefined) pairs.push({ missingId, addedId: a.id })
  }
  return pairs
}

/** The hide reason this feature uses (photos.hidden_reason). */
export const HIDE_REASON = 'duplicate'

/** SQL for the content hashes that appear more than once among a library's present photos. */
const DUP_HASHES = `SELECT h.content_hash FROM photo_hashes h JOIN photos p ON p.id = h.photo_id
  WHERE p.library_id = ? AND p.missing = 0 AND ${FRESH}
  GROUP BY h.content_hash HAVING count(*) > 1`

export function duplicateSummary(db: DB, libraryId: number): DuplicateSummary {
  const g = db
    .prepare(
      `SELECT count(*) AS groups, COALESCE(sum(n - 1), 0) AS extraCopies FROM (
         SELECT count(*) AS n FROM photo_hashes h JOIN photos p ON p.id = h.photo_id
         WHERE p.library_id = ? AND p.missing = 0 AND ${FRESH}
         GROUP BY h.content_hash HAVING count(*) > 1)`
    )
    .get(libraryId) as { groups: number; extraCopies: number }
  const total = db
    .prepare('SELECT count(*) FROM photos WHERE library_id = ? AND missing = 0')
    .pluck()
    .get(libraryId) as number
  const pending = countNeedingHash(db, libraryId)
  const hidden = db
    .prepare('SELECT count(*) FROM photos WHERE library_id = ? AND missing = 0 AND hidden = 1 AND hidden_reason = ?')
    .pluck()
    .get(libraryId, HIDE_REASON) as number
  return {
    ...g,
    hideable: planHide(db, libraryId).length,
    hidden,
    hashingDone: pending === 0,
    hashed: total - pending,
    total
  }
}

/** Other present photos in the same library with identical content. */
export function copiesOf(db: DB, photoId: number): number[] {
  return db
    .prepare(
      `SELECT p.id FROM photo_hashes h JOIN photos p ON p.id = h.photo_id
       WHERE ${FRESH} AND p.missing = 0 AND p.id <> @id
         AND p.library_id = (SELECT library_id FROM photos WHERE id = @id)
         AND h.content_hash = (SELECT h2.content_hash FROM photo_hashes h2 JOIN photos p2 ON p2.id = h2.photo_id
                               WHERE h2.photo_id = @id AND h2.size_bytes = p2.size_bytes AND h2.mtime_ms = p2.mtime_ms)
       ORDER BY p.rel_path`
    )
    .pluck()
    .all({ id: photoId }) as number[]
}

const depth = (relPath: string): number => relPath.split('/').length

/** Which copy stays when there's no explicit Like: shallowest folder, then shortest path, then A→Z. */
export function compareKeeper(a: string, b: string): number {
  return depth(a) - depth(b) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * Copies that "Hide duplicates" would hide (PLAN.md §8). Hiding never changes which playlist a
 * photo is in, and copies you've put in a playlist are never hidden:
 * - a group with a copy in a playlist keeps those copies, and its unreviewed ones are hidden;
 * - otherwise one unreviewed copy stays (see compareKeeper) and the other copies are hidden;
 * - copies already hidden are left as they are.
 */
export function planHide(db: DB, libraryId: number): number[] {
  const rows = db
    .prepare(
      `SELECT h.content_hash AS hash, p.id, p.rel_path, p.playlist_id FROM photo_hashes h JOIN photos p ON p.id = h.photo_id
       WHERE p.library_id = ? AND p.missing = 0 AND p.hidden = 0 AND ${FRESH} AND h.content_hash IN (${DUP_HASHES})`
    )
    .all(libraryId, libraryId) as { hash: string; id: number; rel_path: string; playlist_id: number | null }[]

  const groups = new Map<string, typeof rows>()
  for (const r of rows) groups.set(r.hash, [...(groups.get(r.hash) ?? []), r])

  const toHide: number[] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue // the other copies are already hidden
    const unreviewed = g.filter((r) => r.playlist_id === null)
    if (!unreviewed.length) continue
    if (unreviewed.length < g.length) {
      toHide.push(...unreviewed.map((r) => r.id)) // a marked copy stays visible
    } else {
      const [, ...rest] = [...unreviewed].sort((a, b) => compareKeeper(a.rel_path, b.rel_path))
      toHide.push(...rest.map((r) => r.id))
    }
  }
  return toHide
}

/** Hides the extra copies as one batch, so a single Cmd+Z brings them all back. */
export function hideDuplicates(db: DB, libraryId: number): { hidden: number; batchId: number | null } {
  return db.transaction(() => {
    const ids = planHide(db, libraryId)
    if (!ids.length) return { hidden: 0, batchId: null }
    const batchId = newBatchId(db)
    for (const id of ids) setHidden(db, id, true, HIDE_REASON, { source: 'dedupe', batchId })
    return { hidden: ids.length, batchId }
  })()
}

/** The "duplicates" view filter: only photos with copies (hidden ones included), each group kept together. */
export const duplicatesFilter: FilterImpl = (libraryId) => ({
  where: `p.id IN (SELECT h.photo_id FROM photo_hashes h WHERE h.content_hash IN (${DUP_HASHES})
            AND h.size_bytes = p.size_bytes AND h.mtime_ms = p.mtime_ms)`,
  params: [libraryId],
  groupBy: '(SELECT content_hash FROM photo_hashes WHERE photo_id = p.id)',
  // Review what's hidden too: this is the one view that shows hidden copies.
  includeHidden: true
})
