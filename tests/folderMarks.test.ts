import { mkdirSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { markFolder, resolveFolder } from '../src/main/folderMarks'
import { addLibrary } from '../src/main/library'
import { setHidden, undoLast } from '../src/main/marks'
import { scanLibrary } from '../src/main/scanner/scan'
import { makeTree, tempDir } from './helpers'

async function setup() {
  const root = tempDir()
  makeTree(root, {
    'top.jpg': '0',
    'F/a.jpg': '1',
    'F/b.jpg': '2',
    'F/c.jpg': '3',
    'F/sub/d.jpg': '4',
    'F-other/e.jpg': '5',
    '50%_off/x.jpg': '6'
  })
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  const lib = addLibrary(db, root)
  await scanLibrary(db, lib)
  const status = (p: string): string =>
    db.prepare('SELECT status FROM photos WHERE rel_path = ?').pluck().get(p) as string
  const set = (p: string, s: string): void =>
    void db.prepare('UPDATE photos SET status = ? WHERE rel_path = ?').run(s, p)
  return { db, lib, root: lib.root_path, status, set }
}

describe('resolveFolder', () => {
  it('accepts absolute paths and counts photos including subfolders', async () => {
    const { db, lib, root, set } = await setup()
    set('F/a.jpg', 'like')
    const r = resolveFolder(db, lib.id, join(root, 'F'))
    expect(r).toEqual({ dirPath: 'F', absPath: join(root, 'F'), total: 4, unreviewed: 3, like: 1, meh: 0 })
  })

  it('accepts paths relative to the library, trailing slashes, and the root itself', async () => {
    const { db, lib, root } = await setup()
    expect(resolveFolder(db, lib.id, 'F/sub/')).toMatchObject({ dirPath: 'F/sub', total: 1 })
    expect(resolveFolder(db, lib.id, `${root}/`)).toMatchObject({ dirPath: '', total: 7 })
  })

  it('does not include folders that only share a name prefix, and matches % and _ literally', async () => {
    const { db, lib } = await setup()
    expect(resolveFolder(db, lib.id, 'F')).toMatchObject({ total: 4 }) // not F-other
    expect(resolveFolder(db, lib.id, '50%_off')).toMatchObject({ total: 1 })
  })

  it('resolves symlinks to a folder inside the library', async () => {
    const { db, lib, root } = await setup()
    const link = join(tempDir(), 'link-to-F')
    symlinkSync(join(root, 'F'), link)
    expect(resolveFolder(db, lib.id, link)).toMatchObject({ dirPath: 'F', total: 4 })
  })

  it('rejects folders outside the library (including ../ tricks) and empty input', async () => {
    const { db, lib, root } = await setup()
    expect(resolveFolder(db, lib.id, tempDir())).toMatchObject({
      error: expect.stringMatching(/isn't inside this library/)
    })
    expect(resolveFolder(db, lib.id, join(root, '..'))).toHaveProperty('error')
    expect(resolveFolder(db, lib.id, 'F/../../')).toHaveProperty('error')
    expect(resolveFolder(db, lib.id, '   ')).toHaveProperty('error')
  })

  it('expands ~ to the home folder', async () => {
    const { db, lib } = await setup()
    const r = resolveFolder(db, lib.id, '~/definitely-not-a-photonic-library')
    expect(r).toMatchObject({ error: expect.stringContaining('inside this library') })
    expect(homedir()).toBeTruthy()
  })

  it('a folder with no photos resolves with a zero count', async () => {
    const { db, lib, root } = await setup()
    mkdirSync(join(root, 'empty'))
    expect(resolveFolder(db, lib.id, 'empty')).toMatchObject({ dirPath: 'empty', total: 0 })
  })
})

describe('markFolder', () => {
  it("'all' marks every photo in the folder and its subfolders, overwriting other marks", async () => {
    const { db, lib, status, set } = await setup()
    set('F/a.jpg', 'like')
    set('F/b.jpg', 'meh')
    const r = markFolder(db, lib.id, 'F', 'meh', 'all')
    expect(r.changed).toBe(3) // b was already Meh
    for (const p of ['F/a.jpg', 'F/b.jpg', 'F/c.jpg', 'F/sub/d.jpg']) expect(status(p)).toBe('meh')
    expect(status('F-other/e.jpg')).toBe('unreviewed')
    expect(status('top.jpg')).toBe('unreviewed')
  })

  it("'unreviewed' leaves already-marked photos alone", async () => {
    const { db, lib, status, set } = await setup()
    set('F/a.jpg', 'like')
    const r = markFolder(db, lib.id, 'F', 'meh', 'unreviewed')
    expect(r.changed).toBe(3)
    expect(status('F/a.jpg')).toBe('like')
    expect(status('F/c.jpg')).toBe('meh')
  })

  it('one undo reverts the whole folder, restoring each photo exactly', async () => {
    const { db, lib, set } = await setup()
    set('F/a.jpg', 'like')
    const snapshot = (): unknown => db.prepare('SELECT id, status FROM photos ORDER BY id').all()
    const before = snapshot()
    markFolder(db, lib.id, 'F', 'meh', 'all')
    expect(undoLast(db, lib.id)!.changes).toHaveLength(4)
    expect(snapshot()).toEqual(before)
  })

  it('skips hidden photos (while their feature is on) and missing ones', async () => {
    const { db, lib, status } = await setup()
    const id = (p: string): number => db.prepare('SELECT id FROM photos WHERE rel_path = ?').pluck().get(p) as number
    setHidden(db, id('F/a.jpg'), true, 'duplicate')
    db.prepare("UPDATE photos SET missing = 1 WHERE rel_path = 'F/b.jpg'").run()
    expect(markFolder(db, lib.id, 'F', 'like', 'all', { hideReasons: ['duplicate'] }).changed).toBe(2)
    expect(status('F/a.jpg')).toBe('unreviewed')
    expect(status('F/b.jpg')).toBe('unreviewed')
  })

  it('nothing to change → no batch', async () => {
    const { db, lib } = await setup()
    expect(markFolder(db, lib.id, 'empty', 'like', 'all')).toEqual({ changed: 0, batchId: null })
  })
})
