import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { DateSource, PhotoMeta, Status } from '@shared/types'
import type { DB } from './db'

export interface PhotoRow {
  id: number
  library_id: number
  rel_path: string
  dir_path: string
  size_bytes: number
  mtime_ms: number
  birthtime_ms: number | null
  taken_at: string | null
  width: number | null
  height: number | null
  camera_make: string | null
  camera_model: string | null
  lens_model: string | null
  status: Status
  missing: number
  hidden: number
  hidden_reason: string | null
  root_path: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local time as 'YYYY-MM-DD HH:MM:SS' (same shape as EXIF dates, so they sort together). */
export function localDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** EXIF capture time, else file creation time, else modification time (PLAN.md §5). */
export function displayDate(row: { taken_at: string | null; birthtime_ms: number | null; mtime_ms: number }): {
  date: string
  source: DateSource
} {
  if (row.taken_at) return { date: row.taken_at, source: 'taken' }
  if (row.birthtime_ms) return { date: localDateTime(row.birthtime_ms), source: 'created' }
  return { date: localDateTime(row.mtime_ms), source: 'modified' }
}

export function photoUrl(id: number, mtimeMs: number): string {
  // The version parameter makes the browser fetch an edited file again.
  return `photo://img/${id}?v=${mtimeMs}`
}

export function getPhotoRow(db: DB, id: number): PhotoRow | null {
  return (
    (db
      .prepare(`SELECT p.*, l.root_path FROM photos p JOIN libraries l ON l.id = p.library_id WHERE p.id = ?`)
      .get(id) as PhotoRow | undefined) ?? null
  )
}

export function toPhotoMeta(r: PhotoRow): PhotoMeta {
  const d = displayDate(r)
  return {
    id: r.id,
    libraryId: r.library_id,
    relPath: r.rel_path,
    dirPath: r.dir_path,
    absPath: join(r.root_path, r.rel_path),
    url: photoUrl(r.id, r.mtime_ms),
    status: r.status,
    displayDate: d.date,
    dateSource: d.source,
    sizeBytes: r.size_bytes,
    width: r.width,
    height: r.height,
    cameraMake: r.camera_make,
    cameraModel: r.camera_model,
    lensModel: r.lens_model,
    missing: r.missing === 1,
    hidden: r.hidden === 1,
    hiddenReason: r.hidden_reason
  }
}

/**
 * The file to serve for photo `id`, or null. Resolves symlinks and refuses anything that ends up
 * outside the library root, so the photo:// protocol can only ever serve files inside a library.
 */
export function resolvePhotoFile(db: DB, id: number): string | null {
  const row = getPhotoRow(db, id)
  if (!row) return null
  try {
    const root = realpathSync(row.root_path)
    const file = realpathSync(join(row.root_path, row.rel_path))
    return file.startsWith(root + sep) ? file : null
  } catch {
    return null
  }
}
