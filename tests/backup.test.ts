import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../src/main/db'
import { backupIfDue, listBackups } from '../src/main/db/backup'
import { coreMigrations } from '../src/main/db/migrations'
import { tempDir } from './helpers'

const HOUR = 60 * 60 * 1000

function setup() {
  const dir = tempDir()
  const db = openDatabase(join(dir, 'photonic.db'))
  migrate(db, coreMigrations)
  db.prepare("INSERT INTO settings (key, value) VALUES ('marker', '\"hello\"')").run()
  return { db, backupDir: join(dir, 'backups') }
}

describe('backupIfDue', () => {
  it('creates a valid backup when none exists', async () => {
    const { db, backupDir } = setup()
    const file = await backupIfDue(db, backupDir, { now: new Date('2026-11-20T08:31:00Z') })
    expect(file).toBe(join(backupDir, 'photonic-20261120T083100Z.db'))

    const copy = new Database(file!, { readonly: true })
    expect(copy.prepare("SELECT value FROM settings WHERE key = 'marker'").pluck().get()).toBe('"hello"')
    copy.close()
    expect(readdirSync(backupDir).some((n) => n.endsWith('.partial'))).toBe(false)
  })

  it('skips when the newest backup is less than 24h old, and runs once it is older', async () => {
    const { db, backupDir } = setup()
    const t0 = new Date('2026-11-20T08:00:00Z')
    await backupIfDue(db, backupDir, { now: t0 })
    expect(await backupIfDue(db, backupDir, { now: new Date(t0.getTime() + 23 * HOUR) })).toBeNull()
    expect(await backupIfDue(db, backupDir, { now: new Date(t0.getTime() + 25 * HOUR) })).not.toBeNull()
    expect(listBackups(backupDir)).toHaveLength(2)
  })

  it('keeps only the newest N backups', async () => {
    const { db, backupDir } = setup()
    const start = new Date('2026-11-01T00:00:00Z').getTime()
    for (let day = 0; day < 10; day++) {
      await backupIfDue(db, backupDir, { now: new Date(start + day * 24 * HOUR), keep: 7 })
    }
    const kept = listBackups(backupDir)
    expect(kept).toHaveLength(7)
    expect(kept[0].at.toISOString()).toBe('2026-11-04T00:00:00.000Z')
    expect(kept.at(-1)!.at.toISOString()).toBe('2026-11-10T00:00:00.000Z')
  })

  it('ignores unrelated and leftover partial files', async () => {
    const { db, backupDir } = setup()
    await backupIfDue(db, backupDir, { now: new Date('2026-11-20T00:00:00Z') })
    writeFileSync(join(backupDir, 'notes.txt'), 'hi')
    writeFileSync(join(backupDir, 'photonic-20261121T000000Z.db.partial'), 'junk')
    expect(listBackups(backupDir)).toHaveLength(1)
    expect(existsSync(join(backupDir, 'notes.txt'))).toBe(true)
  })
})
