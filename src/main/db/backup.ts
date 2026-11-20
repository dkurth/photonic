import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './index'

const NAME = /^photonic-(\d{8}T\d{6}Z)\.db$/
const DAY_MS = 24 * 60 * 60 * 1000

export interface BackupOptions {
  now?: Date
  /** How many backups to keep. */
  keep?: number
  /** Minimum age of the newest backup before a new one is made. */
  intervalMs?: number
}

function stamp(d: Date): string {
  // 2026-11-20T08:31:00.123Z → 20261120T083100Z (sorts lexicographically = chronologically)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function parseStamp(s: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s)!
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}

export function listBackups(dir: string): { file: string; at: Date }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .map((n) => ({ n, m: NAME.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .map(({ n, m }) => ({ file: join(dir, n), at: parseStamp(m[1]) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * Makes a backup of `db` into `dir` if the newest existing backup is older than `intervalMs`
 * (default 24h), then prunes to the newest `keep` (default 7). Returns the new file, or null if not due.
 * Writes to a `.partial` file first so an interrupted backup is never mistaken for a good one.
 */
export async function backupIfDue(db: DB, dir: string, opts: BackupOptions = {}): Promise<string | null> {
  const now = opts.now ?? new Date()
  const keep = opts.keep ?? 7
  const intervalMs = opts.intervalMs ?? DAY_MS

  const existing = listBackups(dir)
  const newest = existing.at(-1)
  if (newest && now.getTime() - newest.at.getTime() < intervalMs) return null

  mkdirSync(dir, { recursive: true })
  const file = join(dir, `photonic-${stamp(now)}.db`)
  const partial = `${file}.partial`
  rmSync(partial, { force: true })
  await db.backup(partial)
  renameSync(partial, file)

  const all = listBackups(dir)
  for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(old.file, { force: true })
  return file
}
