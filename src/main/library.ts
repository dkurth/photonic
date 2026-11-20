import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import type { FolderInfo, Library, LibraryStats } from '@shared/types'
import type { DB } from './db'
import { comparePaths } from './ordering'
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

export function libraryStats(db: DB, id: number): LibraryStats {
  const r = db
    .prepare(
      `SELECT
         count(*) FILTER (WHERE missing = 0)                              AS total,
         count(*) FILTER (WHERE missing = 1)                              AS missing,
         count(*) FILTER (WHERE missing = 0 AND status = 'unreviewed')    AS unreviewed,
         count(*) FILTER (WHERE missing = 0 AND status = 'like')          AS "like",
         count(*) FILTER (WHERE missing = 0 AND status = 'meh')           AS meh,
         count(*) FILTER (WHERE missing = 0 AND meta_read_at IS NOT NULL) AS metaRead,
         count(*) FILTER (WHERE missing = 0 AND taken_at IS NOT NULL)     AS withTakenAt,
         count(DISTINCT dir_path) FILTER (WHERE missing = 0)              AS folders
       FROM photos WHERE library_id = ?`
    )
    .get(id) as LibraryStats
  return r
}

/**
 * Folders with photo counts that include their subfolders (PLAN.md §7, the `G` folder picker).
 * Intermediate folders that only contain subfolders are included too. The root ('') is not.
 */
export function listFolders(db: DB, libraryId: number): FolderInfo[] {
  const rows = db
    .prepare(
      `SELECT dir_path, count(*) AS total, count(*) FILTER (WHERE status = 'unreviewed') AS unreviewed
       FROM photos WHERE library_id = ? AND missing = 0 GROUP BY dir_path`
    )
    .all(libraryId) as { dir_path: string; total: number; unreviewed: number }[]

  const folders = new Map<string, FolderInfo>()
  for (const r of rows) {
    // Add this folder's photos to it and to every ancestor folder.
    const parts = r.dir_path ? r.dir_path.split('/') : []
    for (let i = 1; i <= parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/')
      const f = folders.get(dirPath) ?? { dirPath, total: 0, unreviewed: 0 }
      f.total += r.total
      f.unreviewed += r.unreviewed
      folders.set(dirPath, f)
    }
  }
  // comparePaths treats the last segment as a file; compare as folders by adding a sentinel segment.
  return [...folders.values()].sort((a, b) => comparePaths(a.dirPath + '/_', b.dirPath + '/_'))
}
