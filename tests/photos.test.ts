import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary } from '../src/main/library'
import { displayDate, getPhotoRow, localDateTime, resolvePhotoFile, toPhotoMeta } from '../src/main/photos'
import { scanLibrary } from '../src/main/scanner/scan'
import { makeTree, tempDir } from './helpers'

async function lib(files: Record<string, string>): Promise<{ db: DB; root: string; id: (p: string) => number }> {
  const root = tempDir()
  makeTree(root, files)
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  await scanLibrary(db, addLibrary(db, root))
  const id = (p: string): number => db.prepare('SELECT id FROM photos WHERE rel_path = ?').pluck().get(p) as number
  return { db, root, id }
}

describe('displayDate', () => {
  const t = new Date(2021, 0, 10, 9, 12, 5).getTime() // local time
  it('prefers the EXIF capture time', () => {
    expect(displayDate({ taken_at: '2019-07-04 14:32:10', birthtime_ms: t, mtime_ms: t })).toEqual({
      date: '2019-07-04 14:32:10',
      source: 'taken'
    })
  })
  it('falls back to file creation, then modification time (local time)', () => {
    expect(displayDate({ taken_at: null, birthtime_ms: t, mtime_ms: 0 })).toEqual({
      date: '2021-01-10 09:12:05',
      source: 'created'
    })
    expect(displayDate({ taken_at: null, birthtime_ms: null, mtime_ms: t })).toEqual({
      date: '2021-01-10 09:12:05',
      source: 'modified'
    })
  })
  it('formats local times with zero padding', () => {
    expect(localDateTime(new Date(2005, 2, 4, 5, 6, 7).getTime())).toBe('2005-03-04 05:06:07')
  })
})

describe('toPhotoMeta', () => {
  it('builds the absolute path and a versioned photo:// URL', async () => {
    const { db, root, id } = await lib({ '2019/a.jpg': 'a' })
    const m = toPhotoMeta(getPhotoRow(db, id('2019/a.jpg'))!)
    expect(m.absPath).toBe(join(addLibrary(db, root).root_path, '2019/a.jpg'))
    expect(m.url).toMatch(new RegExp(`^photo://img/${m.id}\\?v=\\d+$`))
    expect(m).toMatchObject({ playlistId: null, dirPath: '2019', missing: false })
  })
})

describe('resolvePhotoFile (photo:// protocol path check)', () => {
  it('serves files inside the library', async () => {
    const { db, id } = await lib({ 'a.jpg': 'a' })
    expect(resolvePhotoFile(db, id('a.jpg'))).toMatch(/a\.jpg$/)
  })

  it('returns null for unknown ids and files that are gone', async () => {
    const { db, root, id } = await lib({ 'a.jpg': 'a' })
    expect(resolvePhotoFile(db, 99999)).toBeNull()
    rmSync(join(root, 'a.jpg'))
    expect(resolvePhotoFile(db, id('a.jpg'))).toBeNull()
  })

  it('refuses a file that was swapped for a symlink pointing outside the library', async () => {
    const { db, root, id } = await lib({ 'a.jpg': 'a' })
    const outside = join(tempDir(), 'secret.txt')
    writeFileSync(outside, 'secret')
    rmSync(join(root, 'a.jpg'))
    symlinkSync(outside, join(root, 'a.jpg'))
    expect(resolvePhotoFile(db, id('a.jpg'))).toBeNull()
  })

  it('refuses a path that climbs out of the library with ..', async () => {
    const { db, root, id } = await lib({ 'a.jpg': 'a' })
    const sibling = join(root, '..', 'outside.jpg')
    writeFileSync(sibling, 'x')
    db.prepare("UPDATE photos SET rel_path = '../outside.jpg' WHERE id = ?").run(id('a.jpg'))
    expect(resolvePhotoFile(db, db.prepare('SELECT id FROM photos').pluck().get() as number)).toBeNull()
  })

  it('allows symlinks inside the library that stay inside it', async () => {
    const { db, root } = await lib({})
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real', 'x.jpg'), 'x')
    const row = db.prepare('SELECT id FROM libraries').pluck().get() as number
    db.prepare(
      "INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms) VALUES (?, 'alias.jpg', '', 1, 1)"
    ).run(row)
    symlinkSync(join(root, 'real', 'x.jpg'), join(root, 'alias.jpg'))
    const pid = db.prepare("SELECT id FROM photos WHERE rel_path = 'alias.jpg'").pluck().get() as number
    expect(resolvePhotoFile(db, pid)).toMatch(/real\/x\.jpg$/)
  })
})
