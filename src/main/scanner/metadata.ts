import { join } from 'node:path'
import type { DB } from '../db'
import type { PhotoMetadata } from './exif'

/** Reads metadata for one file. In the app this runs in a worker thread; tests call readMetadata directly. */
export type Extractor = (absPath: string) => Promise<PhotoMetadata>

export interface MetadataProgress {
  done: number
  total: number
}

export function saveMetadata(db: DB, photoId: number, m: PhotoMetadata): void {
  db.prepare(
    `UPDATE photos SET taken_at = ?, width = ?, height = ?, camera_make = ?, camera_model = ?,
       lens_model = ?, exif_json = ?, meta_read_at = datetime('now')
     WHERE id = ?`
  ).run(
    m.takenAt,
    m.width,
    m.height,
    m.cameraMake,
    m.cameraModel,
    m.lensModel,
    m.extra ? JSON.stringify(m.extra) : null,
    photoId
  )
}

export function countNeedingMetadata(db: DB, libraryId: number): number {
  return db
    .prepare('SELECT count(*) FROM photos WHERE library_id = ? AND missing = 0 AND meta_read_at IS NULL')
    .pluck()
    .get(libraryId) as number
}

/**
 * Reads EXIF for every photo in the library that hasn't been read yet (PLAN.md §6).
 * Each result is saved as it arrives, so an interrupted pass resumes where it stopped.
 * Files that can't be parsed are still marked as read (with empty fields) so they aren't retried
 * until the file changes.
 */
export async function runMetadataPass(
  db: DB,
  library: { id: number; root_path: string },
  extract: Extractor,
  opts: { signal?: AbortSignal; concurrency?: number; onProgress?: (p: MetadataProgress) => void } = {}
): Promise<MetadataProgress> {
  const concurrency = opts.concurrency ?? 4
  const progress: MetadataProgress = { done: 0, total: countNeedingMetadata(db, library.id) }
  const next = db.prepare(
    `SELECT id, rel_path FROM photos
     WHERE library_id = ? AND missing = 0 AND meta_read_at IS NULL AND id > ?
     ORDER BY id LIMIT 200`
  )

  let lastId = 0
  for (;;) {
    opts.signal?.throwIfAborted()
    const rows = next.all(library.id, lastId) as { id: number; rel_path: string }[]
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    for (let i = 0; i < rows.length; i += concurrency) {
      opts.signal?.throwIfAborted()
      const chunk = rows.slice(i, i + concurrency)
      const results = await Promise.all(chunk.map((r) => extract(join(library.root_path, r.rel_path))))
      db.transaction(() => chunk.forEach((r, j) => saveMetadata(db, r.id, results[j])))()
      progress.done += chunk.length
      opts.onProgress?.(progress)
    }
  }
  return progress
}

/**
 * Makes sure one photo's metadata has been read — used for the photo on screen so its
 * date is never missing (PLAN.md §6). Returns true if it had to read the file.
 */
export async function ensureMetadata(db: DB, photoId: number, extract: Extractor): Promise<boolean> {
  const row = db
    .prepare(
      `SELECT p.rel_path, p.meta_read_at, l.root_path FROM photos p
       JOIN libraries l ON l.id = p.library_id WHERE p.id = ?`
    )
    .get(photoId) as { rel_path: string; meta_read_at: string | null; root_path: string } | undefined
  if (!row || row.meta_read_at) return false
  saveMetadata(db, photoId, await extract(join(row.root_path, row.rel_path)))
  return true
}
