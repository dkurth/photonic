import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** Hashes one file. Returns null if it can't be read. */
export type Hasher = (absPath: string) => Promise<string | null>

/** SHA-256 of a file's bytes, streamed (PLAN.md §8). Hardware-accelerated on Apple Silicon. */
export function hashFile(absPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('sha256')
    createReadStream(absPath, { highWaterMark: 1 << 20 })
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', () => resolve(null))
  })
}
