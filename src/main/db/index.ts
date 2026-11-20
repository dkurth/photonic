import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Migration } from './migrations'

export type DB = Database.Database

export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

/**
 * Applies any migrations not yet recorded in `schema_migrations`, in version order.
 * Each migration runs in its own transaction: a failing migration leaves no trace and stops the run.
 * Returns the versions that were applied.
 */
export function migrate(db: DB, migrations: Migration[]): number[] {
  const seen = new Set<number>()
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`)
    seen.add(m.version)
  }

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[])
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  const ran: number[] = []

  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.version, m.name)
    })()
    ran.push(m.version)
  }
  return ran
}

export function schemaVersion(db: DB): number {
  return (db.prepare('SELECT COALESCE(MAX(version), 0) FROM schema_migrations').pluck().get() as number) ?? 0
}
