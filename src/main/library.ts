import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import type { Library, LibraryStats } from '@shared/types'
import type { DB } from './db'
import { visibleSql } from './marks'
import type { Visibility } from './ordering'
import type { LibraryRow } from './scanner/types'

export function toLibrary(r: LibraryRow): Library {
  return { id: r.id, rootPath: r.root_path, name: r.name, addedAt: r.added_at, lastScannedAt: r.last_scanned_at }
}

export function getLibraryRow(db: DB, id: number): LibraryRow | null {
  return (db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined) ?? null
}

/** Adds a library for `rootPath` (resolved to its real path), or returns the existing one. */
export function addLibrary(db: DB, rootPath: string): LibraryRow {
  const real = realpathSync(rootPath)
  const found = db.prepare('SELECT * FROM libraries WHERE root_path = ?').get(real) as LibraryRow | undefined
  if (found) return found
  const id = Number(
    db.prepare('INSERT INTO libraries (root_path, name) VALUES (?, ?)').run(real, basename(real) || real)
      .lastInsertRowid
  )
  return getLibraryRow(db, id)!
}

export function listLibraries(db: DB): Library[] {
  return (db.prepare('SELECT * FROM libraries ORDER BY name COLLATE NOCASE').all() as LibraryRow[]).map(toLibrary)
}

export function libraryStats(db: DB, id: number, vis: Visibility = {}): LibraryStats {
  const shown = `missing = 0 AND ${visibleSql('photos', vis.hideReasons ?? [])}`
  return db
    .prepare(
      `SELECT
         count(*) FILTER (WHERE ${shown})                              AS total,
         count(*) FILTER (WHERE missing = 0 AND NOT (${shown}))        AS hidden,
         count(*) FILTER (WHERE missing = 1)                           AS missing,
         count(*) FILTER (WHERE ${shown} AND playlist_id IS NULL)      AS unreviewed,
         count(*) FILTER (WHERE ${shown} AND playlist_id IS NOT NULL)  AS reviewed,
         count(*) FILTER (WHERE ${shown} AND meta_read_at IS NOT NULL) AS metaRead,
         count(*) FILTER (WHERE ${shown} AND taken_at IS NOT NULL)     AS withTakenAt,
         count(DISTINCT dir_path) FILTER (WHERE ${shown})              AS folders
       FROM photos WHERE library_id = ?`
    )
    .get(id) as LibraryStats
}
