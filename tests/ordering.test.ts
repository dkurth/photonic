import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ViewSpec } from '@shared/types'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary } from '../src/main/library'
import { comparePaths, listIds, seededShuffle } from '../src/main/ordering'
import { scanLibrary } from '../src/main/scanner/scan'
import { makeTree, tempDir } from './helpers'

async function setup(files: string[]) {
  const root = tempDir()
  makeTree(root, Object.fromEntries(files.map((f) => [f, f])))
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  const lib = addLibrary(db, root)
  await scanLibrary(db, lib)
  const paths = (ids: number[]): string[] =>
    ids.map((i) => db.prepare('SELECT rel_path FROM photos WHERE id = ?').pluck().get(i) as string)
  const view = (v: Partial<ViewSpec> = {}): ViewSpec => ({
    libraryId: lib.id,
    scope: { kind: 'library' },
    filter: 'all',
    sort: 'filename',
    ...v
  })
  return { db, root, lib, paths, view }
}

const setStatus = (db: DB, path: string, status: string): void =>
  void db.prepare('UPDATE photos SET status = ? WHERE rel_path = ?').run(status, path)

describe('comparePaths', () => {
  it('sorts numbers naturally and case-insensitively', () => {
    expect(['IMG_10.jpg', 'img_2.jpg', 'IMG_1.jpg'].sort(comparePaths)).toEqual(['IMG_1.jpg', 'img_2.jpg', 'IMG_10.jpg'])
  })
  it('keeps each folder together and lists a folder’s own files before its subfolders', () => {
    const sorted = ['b/x.jpg', 'a/z/1.jpg', 'a/b.jpg', 'a-b.jpg', 'a/c.jpg', 'top.jpg'].sort(comparePaths)
    expect(sorted).toEqual(['a-b.jpg', 'top.jpg', 'a/b.jpg', 'a/c.jpg', 'a/z/1.jpg', 'b/x.jpg'])
  })
})

describe('listIds', () => {
  it('filters by status', async () => {
    const { db, paths, view } = await setup(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    setStatus(db, 'a.jpg', 'like')
    setStatus(db, 'b.jpg', 'meh')
    expect(paths(listIds(db, view({ filter: 'all' })))).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    expect(paths(listIds(db, view({ filter: 'unreviewed' })))).toEqual(['c.jpg', 'd.jpg'])
    expect(paths(listIds(db, view({ filter: 'like' })))).toEqual(['a.jpg'])
    expect(paths(listIds(db, view({ filter: 'meh' })))).toEqual(['b.jpg'])
  })

  it('never includes missing photos', async () => {
    const { db, paths, view } = await setup(['a.jpg', 'b.jpg'])
    db.prepare("UPDATE photos SET missing = 1 WHERE rel_path = 'a.jpg'").run()
    expect(paths(listIds(db, view()))).toEqual(['b.jpg'])
  })

  it('folder scope includes subfolders but not folders that only share a name prefix', async () => {
    const { db, paths, view } = await setup(['2019/a.jpg', '2019/x/b.jpg', '2019-old/c.jpg', '2019_x/d.jpg', 'e.jpg'])
    expect(paths(listIds(db, view({ scope: { kind: 'folder', dirPath: '2019' } })))).toEqual(['2019/a.jpg', '2019/x/b.jpg'])
    expect(paths(listIds(db, view({ scope: { kind: 'folder', dirPath: '2019/x' } })))).toEqual(['2019/x/b.jpg'])
    expect(listIds(db, view({ scope: { kind: 'folder', dirPath: '' } }))).toHaveLength(5)
  })

  it('folder names with SQL wildcard characters are matched literally', async () => {
    const { db, paths, view } = await setup(['50%_off/a.jpg', '50xxoff/b.jpg'])
    expect(paths(listIds(db, view({ scope: { kind: 'folder', dirPath: '50%_off' } })))).toEqual(['50%_off/a.jpg'])
  })

  it('date sort uses EXIF date, then file dates, with path as tie-breaker', async () => {
    const { db, root, paths, view } = await setup(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    db.prepare("UPDATE photos SET taken_at = '2020-01-01 00:00:00' WHERE rel_path IN ('c.jpg', 'a.jpg')").run()
    db.prepare("UPDATE photos SET taken_at = '2015-06-01 12:00:00' WHERE rel_path = 'd.jpg'").run()
    // b.jpg has no EXIF date: falls back to its (birth/mtime) file date, set far in the past
    utimesSync(join(root, 'b.jpg'), new Date(2001, 0, 1), new Date(2001, 0, 1))
    db.prepare("UPDATE photos SET birthtime_ms = NULL, mtime_ms = ? WHERE rel_path = 'b.jpg'").run(
      new Date(2001, 0, 1).getTime()
    )
    expect(paths(listIds(db, view({ sort: 'date' })))).toEqual(['b.jpg', 'd.jpg', 'a.jpg', 'c.jpg'])
  })

  it('random order is stable for a seed and differs between seeds', async () => {
    const files = Array.from({ length: 30 }, (_, i) => `p${i}.jpg`)
    const { db, view } = await setup(files)
    const a = listIds(db, view({ sort: 'random', seed: 42 }))
    expect(listIds(db, view({ sort: 'random', seed: 42 }))).toEqual(a)
    expect(listIds(db, view({ sort: 'random', seed: 7 }))).not.toEqual(a)
    expect([...a].sort((x, y) => x - y)).toEqual(listIds(db, view()).sort((x, y) => x - y))
  })

  it('rejects unknown filters, and supports filters added by features', async () => {
    const { db, paths, view } = await setup(['a.jpg', 'b.jpg'])
    expect(() => listIds(db, view({ filter: 'nope' }))).toThrow(/Unknown filter/)
    const onlyB = { onlyB: () => ({ where: 'p.rel_path = ?', params: ['b.jpg'] }) }
    expect(paths(listIds(db, view({ filter: 'onlyB' }), onlyB))).toEqual(['b.jpg'])
  })
})

describe('seededShuffle', () => {
  it('is a permutation', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    expect(seededShuffle(items, 3).sort((a, b) => a - b)).toEqual(items)
  })
})
