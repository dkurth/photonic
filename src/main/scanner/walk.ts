import { opendir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** File types the app shows. HEIC/RAW/video are deliberately excluded (PLAN.md §1). */
export const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'])

export interface FoundFile {
  /** Relative to the library root, POSIX separators. */
  relPath: string
  /** Folder part of relPath; '' for files directly in the root. */
  dirPath: string
  sizeBytes: number
  mtimeMs: number
  birthtimeMs: number | null
}

export interface WalkError {
  /** Relative folder that could not be read ('' = root). */
  dirPath: string
  message: string
}

export interface WalkOptions {
  signal?: AbortSignal
  onError?: (e: WalkError) => void
  /** How many files to stat in parallel. */
  statConcurrency?: number
}

export function isPhotoName(name: string): boolean {
  return !name.startsWith('.') && PHOTO_EXTENSIONS.has(extname(name).toLowerCase())
}

/**
 * Walks `root` recursively and yields the photos found, one batch per folder.
 * Skips hidden files/folders and never follows symlinks (which also rules out loops).
 * Folders that can't be read are reported through `onError` and skipped;
 * an unreadable root throws.
 */
export async function* walk(root: string, opts: WalkOptions = {}): AsyncGenerator<FoundFile[]> {
  const concurrency = opts.statConcurrency ?? 32
  const stack: string[] = ['']

  while (stack.length) {
    opts.signal?.throwIfAborted()
    const rel = stack.pop()!
    const abs = rel ? join(root, rel) : root

    const subdirs: string[] = []
    const photos: string[] = []
    try {
      const dir = await opendir(abs)
      for await (const entry of dir) {
        if (entry.name.startsWith('.')) continue
        if (entry.isDirectory()) subdirs.push(entry.name)
        else if (entry.isFile() && isPhotoName(entry.name)) photos.push(entry.name)
        // symlinks, sockets, etc. are ignored
      }
    } catch (err) {
      if (rel === '') throw err
      opts.onError?.({ dirPath: rel, message: (err as Error).message })
      continue
    }

    // Push in reverse so folders are visited in name order (deterministic, nicer progress).
    subdirs.sort().reverse()
    for (const d of subdirs) stack.push(rel ? `${rel}/${d}` : d)

    photos.sort()
    const found: FoundFile[] = []
    for (let i = 0; i < photos.length; i += concurrency) {
      opts.signal?.throwIfAborted()
      const chunk = photos.slice(i, i + concurrency)
      const stats = await Promise.all(
        chunk.map((name) => stat(join(abs, name)).catch(() => null)) // vanished mid-scan: skip
      )
      chunk.forEach((name, j) => {
        const s = stats[j]
        if (!s) return
        found.push({
          relPath: rel ? `${rel}/${name}` : name,
          dirPath: rel,
          sizeBytes: s.size,
          mtimeMs: Math.floor(s.mtimeMs),
          birthtimeMs: s.birthtimeMs > 0 ? Math.floor(s.birthtimeMs) : null
        })
      })
    }
    if (found.length) yield found
  }
}
