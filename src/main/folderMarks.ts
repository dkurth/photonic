import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FolderTarget, Status } from '@shared/types'
import type { DB } from './db'
import { getLibraryRow } from './library'
import { newBatchId, setStatus, visibleSql } from './marks'
import type { Visibility } from './ordering'

/** SQL for "photo is in this folder or below it" ('' = the whole library). */
export function folderWhere(dirPath: string): { where: string; params: unknown[] } {
  if (dirPath === '') return { where: '1 = 1', params: [] }
  // substr instead of LIKE so folder names containing % or _ need no escaping.
  return {
    where: '(p.dir_path = ? OR substr(p.dir_path, 1, ?) = ?)',
    params: [dirPath, dirPath.length + 1, dirPath + '/']
  }
}

/**
 * Turns what the user typed into a folder of the library: an absolute path, a path relative to
 * the library root, or one starting with ~. Symlinks are resolved when the folder exists.
 * Returns an error message for anything outside the library.
 */
export function resolveFolder(
  db: DB,
  libraryId: number,
  input: string,
  vis: Visibility = {}
): FolderTarget | { error: string } {
  const lib = getLibraryRow(db, libraryId)
  if (!lib) return { error: 'Library not found' }
  let typed = input.trim()
  if (!typed) return { error: 'Type or choose a folder' }
  if (typed === '~' || typed.startsWith('~/')) typed = join(homedir(), typed.slice(1))
  let abs = resolve(isAbsolute(typed) ? typed : join(lib.root_path, typed))
  try {
    abs = realpathSync(abs)
  } catch {
    // Doesn't exist on disk (any more): still allowed if the library has photos recorded there.
  }
  const rel = relative(lib.root_path, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { error: `That folder isn't inside this library (${lib.root_path})` }
  }
  const dirPath = rel.split(sep).join('/')
  const f = folderWhere(dirPath)
  const counts = db
    .prepare(
      `SELECT count(*) AS total,
         count(*) FILTER (WHERE p.status = 'unreviewed') AS unreviewed,
         count(*) FILTER (WHERE p.status = 'like') AS "like",
         count(*) FILTER (WHERE p.status = 'meh') AS meh
       FROM photos p WHERE p.library_id = ? AND p.missing = 0 AND ${f.where}
         AND ${visibleSql('p', vis.hideReasons ?? [])}`
    )
    .get(libraryId, ...f.params) as { total: number; unreviewed: number; like: number; meh: number }
  return { dirPath, absPath: abs, ...counts }
}

export type FolderMarkMode = 'all' | 'unreviewed'

/**
 * Likes or Mehs every photo in a folder (and its subfolders) as one batch, so a single ⌘Z
 * undoes it. 'unreviewed' leaves photos that already have a mark alone. Hidden photos (e.g.
 * duplicate copies) are skipped, like everywhere else.
 */
export function markFolder(
  db: DB,
  libraryId: number,
  dirPath: string,
  status: Exclude<Status, 'unreviewed'>,
  mode: FolderMarkMode,
  vis: Visibility = {}
): { changed: number; batchId: number | null } {
  const f = folderWhere(dirPath)
  return db.transaction(() => {
    const ids = db
      .prepare(
        `SELECT p.id FROM photos p WHERE p.library_id = ? AND p.missing = 0 AND ${f.where}
           AND ${visibleSql('p', vis.hideReasons ?? [])}
           AND ${mode === 'unreviewed' ? "p.status = 'unreviewed'" : 'p.status <> ?'}
         ORDER BY p.id`
      )
      .pluck()
      .all(libraryId, ...f.params, ...(mode === 'all' ? [status] : [])) as number[]
    if (!ids.length) return { changed: 0, batchId: null }
    const batchId = newBatchId(db)
    for (const id of ids) setStatus(db, id, status, { source: 'folder', batchId })
    return { changed: ids.length, batchId }
  })()
}
