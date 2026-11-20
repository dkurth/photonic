import { constants } from 'node:fs'
import { copyFile, readdir, stat, utimes } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ExportNaming, ExportProgress, ExportResult } from '@shared/types'
import type { DB } from './db'
import { visibleSql } from './marks'
import { comparePaths } from './ordering'
import { displayDate, type PhotoRow } from './photos'

/** One photo to copy: where it is, its date (for naming and order) and the name it gets. */
export interface ExportItem {
  src: string
  relPath: string
  date: string // 'YYYY-MM-DD HH:MM:SS', as shown in the app
  name: string
}

/**
 * Photos in a playlist (all libraries), oldest first, then by path. Leaves out files the last scan
 * found missing and photos hidden by an active feature (e.g. extra duplicate copies).
 */
export function exportSources(db: DB, playlistId: number, hideReasons: readonly string[]): Omit<ExportItem, 'name'>[] {
  const rows = db
    .prepare(
      `SELECT p.*, l.root_path FROM photos p JOIN libraries l ON l.id = p.library_id
       WHERE p.playlist_id = ? AND p.missing = 0 AND ${visibleSql('p', hideReasons)}`
    )
    .all(playlistId) as PhotoRow[]
  return rows
    .map((r) => ({ src: join(r.root_path, r.rel_path), relPath: r.rel_path, date: displayDate(r).date }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : comparePaths(a.relPath, b.relPath)))
}

/** 'IMG_1.jpg' → 'IMG_1_2.jpg', 'IMG_1_3.jpg', … until the name is free (case-insensitively, as on macOS). */
function uniqueName(stem: string, ext: string, taken: Set<string>): string {
  let name = stem + ext
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem}_${n}${ext}`
  taken.add(name.toLowerCase())
  return name
}

/**
 * Names for the copies, in order. `existing` holds the names already in the destination folder:
 * those are never overwritten, a new name gets _2, _3… instead.
 *  - original:   IMG_0042.jpg (IMG_0042_2.jpg for the second photo with that name)
 *  - sequential: 001.jpg, 002.jpg… (at least 3 digits, more if there are ≥1000 photos)
 *  - date:       20190704_153012.jpg (…_2.jpg for a second photo taken in the same second)
 */
export function planNames(
  items: Omit<ExportItem, 'name'>[],
  naming: ExportNaming,
  existing: Iterable<string> = []
): ExportItem[] {
  const taken = new Set([...existing].map((n) => n.toLowerCase()))
  const digits = Math.max(3, String(items.length).length)
  return items.map((item, i) => {
    const original = basename(item.relPath)
    const ext = extname(original)
    const stem =
      naming === 'sequential'
        ? String(i + 1).padStart(digits, '0')
        : naming === 'date'
          ? item.date.replace(/-/g, '').replace(' ', '_').replace(/:/g, '')
          : original.slice(0, original.length - ext.length)
    return { ...item, name: uniqueName(stem, ext, taken) }
  })
}

/**
 * Copies the photos into `destDir`, flat. Never touches the originals and never overwrites a file
 * (COPYFILE_EXCL). Keeps each copy's modification time. Missing or unreadable files are skipped
 * and reported; `isCancelled` is checked between files.
 */
export async function runExport(
  items: Omit<ExportItem, 'name'>[],
  destDir: string,
  naming: ExportNaming,
  opts: { onProgress?: (p: ExportProgress) => void; isCancelled?: () => boolean } = {}
): Promise<ExportResult> {
  const d = await stat(destDir)
  if (!d.isDirectory()) throw new Error(`${destDir} is not a folder`)
  const planned = planNames(items, naming, await readdir(destDir))
  const result: ExportResult = { destDir, copied: 0, failed: [], cancelled: false }
  let lastReport = 0
  for (const [i, item] of planned.entries()) {
    if (opts.isCancelled?.()) {
      result.cancelled = true
      break
    }
    try {
      const target = join(destDir, item.name)
      await copyFile(item.src, target, constants.COPYFILE_EXCL)
      const s = await stat(item.src)
      await utimes(target, s.atime, s.mtime)
      result.copied++
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      result.failed.push({ path: item.src, reason: code === 'ENOENT' ? 'missing' : String((e as Error).message) })
    }
    const now = Date.now()
    if (opts.onProgress && (now - lastReport > 100 || i === planned.length - 1)) {
      lastReport = now
      opts.onProgress({ done: i + 1, total: planned.length })
    }
  }
  return result
}
