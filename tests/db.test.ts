import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, schemaVersion, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { getSetting, setSetting } from '../src/main/settings'
import { tempDir } from './helpers'

function freshDb(): DB {
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  return db
}

function addLibraryAndPhoto(db: DB, relPath = 'a/b.jpg'): { libraryId: number; photoId: number } {
  const libraryId = Number(
    db.prepare("INSERT INTO libraries (root_path, name) VALUES ('/photos', 'photos')").run().lastInsertRowid
  )
  const photoId = Number(
    db
      .prepare('INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms) VALUES (?, ?, ?, 1, 1)')
      .run(libraryId, relPath, 'a').lastInsertRowid
  )
  return { libraryId, photoId }
}

describe('openDatabase', () => {
  it('creates the parent directory and enables WAL + foreign keys', () => {
    const file = join(tempDir(), 'nested', 'dir', 'photonic.db')
    const db = openDatabase(file)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })
})

describe('migrate', () => {
  it('applies core migrations once and is idempotent', () => {
    const db = openDatabase(':memory:')
    expect(migrate(db, coreMigrations)).toEqual([1, 2, 3, 4])
    expect(migrate(db, coreMigrations)).toEqual([])
    expect(schemaVersion(db)).toBe(4)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all()
    expect(tables).toEqual(['libraries', 'mark_events', 'photos', 'playlists', 'schema_migrations', 'settings'])
  })

  it('upgrades an existing v1 database to the latest version, keeping its data', () => {
    const db = openDatabase(':memory:')
    migrate(
      db,
      coreMigrations.filter((m) => m.version === 1)
    )
    db.prepare("INSERT INTO libraries (root_path, name) VALUES ('/p', 'p')").run()
    const photo = db.prepare(
      "INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms, status) VALUES (1, ?, '', 1, 1, ?)"
    )
    photo.run('a.jpg', 'like')
    photo.run('b.jpg', 'meh')
    photo.run('c.jpg', 'unreviewed')
    db.prepare("INSERT INTO mark_events (photo_id, old_status, new_status) VALUES (1, 'unreviewed', 'like')").run()
    db.prepare("INSERT INTO mark_events (photo_id, old_status, new_status) VALUES (2, 'like', 'meh')").run()
    expect(migrate(db, coreMigrations)).toEqual([2, 3, 4])
    expect(db.prepare('SELECT count(*) FROM libraries').pluck().get()).toBe(1)
    const cols = (db.prepare('PRAGMA table_info(photos)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['playlist_id', 'marked_at', 'hidden', 'hidden_reason']))
    expect(cols).not.toContain('status')
    // Like/Meh marks become the built-in playlists
    expect(db.prepare('SELECT rel_path, playlist_id FROM photos ORDER BY id').all()).toEqual([
      { rel_path: 'a.jpg', playlist_id: 1 },
      { rel_path: 'b.jpg', playlist_id: 2 },
      { rel_path: 'c.jpg', playlist_id: null }
    ])
    // ...and the undo history comes along as playlist changes
    expect(db.prepare('SELECT field, old_value, new_value FROM mark_events ORDER BY id').all()).toEqual([
      { field: 'playlist', old_value: '', new_value: '1' },
      { field: 'playlist', old_value: '1', new_value: '2' }
    ])
  })

  it('applies migrations in version order regardless of array order', () => {
    const db = openDatabase(':memory:')
    const ran = migrate(db, [
      { version: 101, name: 'b', sql: 'ALTER TABLE t ADD COLUMN y INTEGER' },
      { version: 100, name: 'a', sql: 'CREATE TABLE t (x INTEGER)' }
    ])
    expect(ran).toEqual([100, 101])
  })

  it('rolls back a failing migration and does not record it', () => {
    const db = openDatabase(':memory:')
    expect(() => migrate(db, [{ version: 1, name: 'bad', sql: 'CREATE TABLE ok (x); THIS IS NOT SQL;' }])).toThrow()
    expect(schemaVersion(db)).toBe(0)
    expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'ok'").pluck().get()).toBe(0)
  })

  it('rejects duplicate versions', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      migrate(db, [
        { version: 1, name: 'a', sql: '' },
        { version: 1, name: 'b', sql: '' }
      ])
    ).toThrow(/Duplicate/)
  })
})

describe('core schema', () => {
  it('only allows existing playlists', () => {
    const db = freshDb()
    const { photoId } = addLibraryAndPhoto(db)
    const set = db.prepare('UPDATE photos SET playlist_id = ? WHERE id = ?')
    expect(() => set.run(1, photoId)).not.toThrow()
    expect(() => set.run(null, photoId)).not.toThrow()
    expect(() => set.run(999, photoId)).toThrow(/FOREIGN KEY/)
  })

  it('starts with the built-in Like (↑) and Meh (↓) playlists', () => {
    const db = freshDb()
    expect(db.prepare('SELECT id, name, builtin, shortcut FROM playlists ORDER BY id').all()).toEqual([
      { id: 1, name: 'Like', builtin: 'like', shortcut: 'ArrowUp' },
      { id: 2, name: 'Meh', builtin: 'meh', shortcut: 'ArrowDown' }
    ])
  })

  it('defaults new photos to unreviewed', () => {
    const db = freshDb()
    const { photoId } = addLibraryAndPhoto(db)
    expect(db.prepare('SELECT playlist_id FROM photos WHERE id = ?').pluck().get(photoId)).toBeNull()
  })

  it('enforces one row per path within a library', () => {
    const db = freshDb()
    const { libraryId } = addLibraryAndPhoto(db, 'x.jpg')
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms) VALUES (?, 'x.jpg', '', 1, 1)"
        )
        .run(libraryId)
    ).toThrow(/UNIQUE/)
  })

  it('cascades library deletion to photos and mark events', () => {
    const db = freshDb()
    const { libraryId, photoId } = addLibraryAndPhoto(db)
    db.prepare("INSERT INTO mark_events (photo_id, field, old_value, new_value) VALUES (?, 'playlist', '', '1')").run(
      photoId
    )
    db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId)
    expect(db.prepare('SELECT count(*) FROM photos').pluck().get()).toBe(0)
    expect(db.prepare('SELECT count(*) FROM mark_events').pluck().get()).toBe(0)
  })
})

describe('settings', () => {
  it('round-trips JSON values and overwrites', () => {
    const db = freshDb()
    expect(getSetting(db, 'ui.theme')).toBeNull()
    setSetting(db, 'ui.theme', 'arcade')
    setSetting(db, 'view', { filter: 'unreviewed', sort: 'random', seed: 42 })
    expect(getSetting(db, 'ui.theme')).toBe('arcade')
    setSetting(db, 'ui.theme', 'olive')
    expect(getSetting(db, 'ui.theme')).toBe('olive')
    expect(getSetting(db, 'view')).toEqual({ filter: 'unreviewed', sort: 'random', seed: 42 })
  })
})
