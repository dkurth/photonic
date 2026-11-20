import { stat } from 'node:fs/promises'
import type { DB } from '../db'
import type { LibraryRow, MovePair, ScanHooks, ScanPhoto } from './types'
import { walk, type WalkError } from './walk'

export interface ScanCounts {
  /** Photo files found on disk. */
  found: number
  /** New rows inserted (after moves are subtracted). */
  added: number
  /** Known paths whose size or mtime changed. */
  changed: number
  /** Previously-missing rows found again at the same path. */
  restored: number
  /** Rows newly flagged missing (after moves are subtracted). */
  missing: number
  /** Missing rows re-attached to a new path by a scan hook. */
  moved: number
  errors: WalkError[]
}

export interface ScanOptions {
  hooks?: ScanHooks[]
  signal?: AbortSignal
  onProgress?: (counts: ScanCounts) => void
  /** Rows written per transaction. */
  batchSize?: number
}

interface Existing {
  id: number
  size: number
  mtime: number
  missing: number
}

type Op =
  | { kind: 'insert'; relPath: string; dirPath: string; size: number; mtime: number; birth: number | null }
  | { kind: 'change'; id: number; size: number; mtime: number; birth: number | null }
  | { kind: 'restore'; id: number }

function isUnder(dirPath: string, parent: string): boolean {
  return parent === '' || dirPath === parent || dirPath.startsWith(parent + '/')
}

/**
 * Brings the `photos` table in line with what's on disk for one library (PLAN.md §6).
 * Never changes a photo's status. Rows are only ever flagged missing, never deleted.
 * If the root folder can't be read, throws before touching the DB, so an unplugged
 * drive doesn't flag the whole library as missing.
 */
export async function scanLibrary(db: DB, library: LibraryRow, opts: ScanOptions = {}): Promise<ScanCounts> {
  const batchSize = opts.batchSize ?? 500
  const counts: ScanCounts = { found: 0, added: 0, changed: 0, restored: 0, missing: 0, moved: 0, errors: [] }

  const rootStat = await stat(library.root_path).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error(`Library folder not found: ${library.root_path}`)

  const existing = new Map<string, Existing>()
  for (const r of db
    .prepare('SELECT id, rel_path, size_bytes, mtime_ms, missing FROM photos WHERE library_id = ?')
    .all(library.id) as { id: number; rel_path: string; size_bytes: number; mtime_ms: number; missing: number }[]) {
    existing.set(r.rel_path, { id: r.id, size: r.size_bytes, mtime: r.mtime_ms, missing: r.missing })
  }

  const insert = db.prepare(
    `INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms, birthtime_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const change = db.prepare(
    `UPDATE photos SET size_bytes = ?, mtime_ms = ?, birthtime_ms = ?, missing = 0, meta_read_at = NULL
     WHERE id = ?`
  )
  const restore = db.prepare('UPDATE photos SET missing = 0 WHERE id = ?')

  const seen = new Set<number>()
  const addedIds: number[] = []
  let pending: Op[] = []

  const flush = db.transaction((ops: Op[]) => {
    for (const op of ops) {
      if (op.kind === 'insert') {
        addedIds.push(
          Number(insert.run(library.id, op.relPath, op.dirPath, op.size, op.mtime, op.birth).lastInsertRowid)
        )
      } else if (op.kind === 'change') {
        change.run(op.size, op.mtime, op.birth, op.id)
      } else {
        restore.run(op.id)
      }
    }
  })

  for await (const batch of walk(library.root_path, {
    signal: opts.signal,
    onError: (e) => counts.errors.push(e)
  })) {
    for (const f of batch) {
      counts.found++
      const known = existing.get(f.relPath)
      if (!known) {
        pending.push({
          kind: 'insert',
          relPath: f.relPath,
          dirPath: f.dirPath,
          size: f.sizeBytes,
          mtime: f.mtimeMs,
          birth: f.birthtimeMs
        })
        counts.added++
        continue
      }
      seen.add(known.id)
      if (known.size !== f.sizeBytes || known.mtime !== f.mtimeMs) {
        pending.push({ kind: 'change', id: known.id, size: f.sizeBytes, mtime: f.mtimeMs, birth: f.birthtimeMs })
        counts.changed++
      } else if (known.missing) {
        pending.push({ kind: 'restore', id: known.id })
        counts.restored++
      }
    }
    if (pending.length >= batchSize) {
      flush(pending)
      pending = []
      opts.onProgress?.(counts)
    }
  }
  flush(pending)
  pending = []
  opts.signal?.throwIfAborted()

  // Flag rows that weren't seen — except under folders we couldn't read this time.
  const unreadable = counts.errors.map((e) => e.dirPath)
  const markMissing = db.prepare('UPDATE photos SET missing = 1 WHERE id = ?')
  const flaggedNow = new Set<number>()
  db.transaction(() => {
    for (const [relPath, row] of existing) {
      if (seen.has(row.id) || row.missing) continue
      const dirPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
      if (unreadable.some((u) => isUnder(dirPath, u))) continue
      markMissing.run(row.id)
      flaggedNow.add(row.id)
    }
  })()
  counts.missing = flaggedNow.size

  // Let features re-attach moved/renamed files to their old rows (missing from this or an earlier scan).
  const matchers = (opts.hooks ?? []).filter((h) => h.matchMoves)
  if (matchers.length && addedIds.length) {
    let added = selectScanPhotos(db, 'id IN (SELECT value FROM json_each(?))', JSON.stringify(addedIds))
    let missing = selectScanPhotos(db, 'library_id = ? AND missing = 1', library.id)
    for (const hook of matchers) {
      if (!added.length || !missing.length) break
      const pairs = await hook.matchMoves!({ db, library, signal: opts.signal }, added, missing)
      const applied = applyMoves(db, library.id, pairs)
      const movedFrom = new Set(applied.map((p) => p.missingId))
      const movedTo = new Set(applied.map((p) => p.addedId))
      for (const p of applied) {
        counts.moved++
        counts.added--
        if (flaggedNow.has(p.missingId)) counts.missing--
      }
      added = added.filter((r) => !movedTo.has(r.id))
      missing = missing.filter((r) => !movedFrom.has(r.id))
    }
  }

  db.prepare("UPDATE libraries SET last_scanned_at = datetime('now') WHERE id = ?").run(library.id)
  opts.onProgress?.(counts)

  for (const h of opts.hooks ?? []) h.afterScan?.({ db, library, signal: opts.signal })
  return counts
}

function selectScanPhotos(db: DB, where: string, param: unknown): ScanPhoto[] {
  const rows = db
    .prepare(`SELECT id, rel_path, size_bytes, mtime_ms FROM photos WHERE ${where} ORDER BY id`)
    .all(param) as { id: number; rel_path: string; size_bytes: number; mtime_ms: number }[]
  return rows.map((r) => ({ id: r.id, relPath: r.rel_path, sizeBytes: r.size_bytes, mtimeMs: r.mtime_ms }))
}

/**
 * Re-attaches each missing row to the path of a newly added row, keeping the missing row's
 * id, status and history, and deletes the (brand-new, unreviewed) added row.
 * Invalid pairs are ignored. Returns the pairs that were applied.
 */
export function applyMoves(db: DB, libraryId: number, pairs: MovePair[]): MovePair[] {
  const getRow = db.prepare(
    'SELECT id, library_id, rel_path, dir_path, size_bytes, mtime_ms, birthtime_ms, missing, status FROM photos WHERE id = ?'
  )
  const hasEvents = db.prepare('SELECT 1 FROM mark_events WHERE photo_id = ? LIMIT 1')
  const del = db.prepare('DELETE FROM photos WHERE id = ?')
  const move = db.prepare(
    `UPDATE photos SET rel_path = ?, dir_path = ?, size_bytes = ?, mtime_ms = ?, birthtime_ms = ?, missing = 0
     WHERE id = ?`
  )
  type Row = {
    id: number
    library_id: number
    rel_path: string
    dir_path: string
    size_bytes: number
    mtime_ms: number
    birthtime_ms: number | null
    missing: number
    status: string
  }

  const usedMissing = new Set<number>()
  const usedAdded = new Set<number>()
  const applied: MovePair[] = []

  db.transaction(() => {
    for (const p of pairs) {
      if (usedMissing.has(p.missingId) || usedAdded.has(p.addedId) || p.missingId === p.addedId) continue
      const from = getRow.get(p.missingId) as Row | undefined
      const to = getRow.get(p.addedId) as Row | undefined
      if (!from || !to) continue
      if (from.library_id !== libraryId || to.library_id !== libraryId) continue
      if (!from.missing || to.missing) continue
      if (to.status !== 'unreviewed' || hasEvents.get(to.id)) continue

      del.run(to.id)
      move.run(to.rel_path, to.dir_path, to.size_bytes, to.mtime_ms, to.birthtime_ms, from.id)
      usedMissing.add(p.missingId)
      usedAdded.add(p.addedId)
      applied.push(p)
    }
  })()
  return applied
}
