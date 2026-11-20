import type { DB } from './db'

export function getSetting<T>(db: DB, key: string): T | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined
  return row === undefined ? null : (JSON.parse(row) as T)
}

export function setSetting<T>(db: DB, key: string, value: T): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}
