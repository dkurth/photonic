import { createHash } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../../../src/main/db'
import { coreMigrations } from '../../../src/main/db/migrations'
import { createDedupeFeature } from '../../../src/main/features/dedupe'
import {
  compareKeeper,
  copiesOf,
  countNeedingHash,
  duplicateSummary,
  hideDuplicates,
  planHide,
  runHashPass
} from '../../../src/main/features/dedupe/dedupe'
import { hashFile, type Hasher } from '../../../src/main/features/dedupe/hash'
import { FeatureRegistry } from '../../../src/main/features/registry'
import { addLibrary } from '../../../src/main/library'
import { undoLast } from '../../../src/main/marks'
import { listIds } from '../../../src/main/ordering'
import { scanLibrary } from '../../../src/main/scanner/scan'
import type { LibraryRow } from '../../../src/main/scanner/types'
import { makeTree, tempDir } from '../../helpers'

/** Counts calls so tests can check how much hashing happened. */
function countingHasher(): Hasher & { calls: string[] } {
  const calls: string[] = []
  const h = (async (p: string) => (calls.push(p), hashFile(p))) as Hasher & { calls: string[] }
  h.calls = calls
  return h
}

async function setup(files: Record<string, string>, hasher: Hasher = hashFile) {
  const root = tempDir()
  makeTree(root, files)
  const db = openDatabase(':memory:')
  const registry = new FeatureRegistry()
  registry.register(createDedupeFeature({ hash: hasher }))
  migrate(db, [...coreMigrations, ...registry.migrations()])
  const lib = addLibrary(db, root)
  const scan = async (): Promise<Awaited<ReturnType<typeof scanLibrary>>> => {
    const counts = await scanLibrary(db, lib, { hooks: registry.scanHooks() })
    await runHashPass(db, lib, hasher)
    return counts
  }
  await scan()
  const idOf = (p: string): number => db.prepare('SELECT id FROM photos WHERE rel_path = ?').pluck().get(p) as number
  const statusOf = (p: string): string =>
    db.prepare('SELECT status FROM photos WHERE rel_path = ?').pluck().get(p) as string
  const setStatus = (p: string, s: string): void =>
    void db.prepare('UPDATE photos SET status = ? WHERE rel_path = ?').run(s, p)
  return { db, root, lib, registry, scan, idOf, statusOf, setStatus }
}

describe('hashFile', () => {
  it('computes SHA-256 of the file contents; null if unreadable', async () => {
    const f = join(tempDir(), 'a.jpg')
    writeFileSync(f, 'hello')
    expect(await hashFile(f)).toBe(createHash('sha256').update('hello').digest('hex'))
    expect(await hashFile(f + '.nope')).toBeNull()
  })
})

describe('runHashPass', () => {
  it('hashes everything once, re-hashes only edited files, and resumes after interruption', async () => {
    const h = countingHasher()
    const { db, root, lib, scan } = await setup({ 'a.jpg': 'a', 'b.jpg': 'b', 'c.jpg': 'c' }, h)
    expect(h.calls).toHaveLength(3)
    expect(countNeedingHash(db, lib.id)).toBe(0)

    await scan()
    expect(h.calls).toHaveLength(3) // nothing changed

    writeFileSync(join(root, 'b.jpg'), 'b edited')
    await scan()
    expect(h.calls.slice(3).map((p) => p.slice(-5))).toEqual(['b.jpg'])

    // interrupted pass resumes
    db.prepare('DELETE FROM photo_hashes').run()
    const ac = new AbortController()
    let n = 0
    const stopAfterOne: Hasher = async (p) => (++n === 1 ? (ac.abort(), hashFile(p)) : hashFile(p))
    await expect(runHashPass(db, lib, stopAfterOne, { signal: ac.signal, concurrency: 1 })).rejects.toThrow()
    expect(countNeedingHash(db, lib.id)).toBe(2)
    await runHashPass(db, lib, hashFile)
    expect(countNeedingHash(db, lib.id)).toBe(0)
  })
})

describe('move detection (matchMoves hook)', () => {
  it('a renamed file keeps its id and mark', async () => {
    const { root, scan, idOf, setStatus, statusOf } = await setup({ 'a.jpg': 'AAA', 'b.jpg': 'BBB' })
    const id = idOf('a.jpg')
    setStatus('a.jpg', 'like')
    renameSync(join(root, 'a.jpg'), join(root, 'renamed.jpg'))
    expect((await scan()).moved).toBe(1)
    expect(idOf('renamed.jpg')).toBe(id)
    expect(statusOf('renamed.jpg')).toBe('like')
  })

  it('a file moved to another folder keeps its id and mark', async () => {
    const { root, scan, idOf, setStatus } = await setup({ 'old/a.jpg': 'AAA' })
    const id = idOf('old/a.jpg')
    setStatus('old/a.jpg', 'meh')
    makeTree(root, { 'new/deeper/a.jpg': 'AAA' })
    rmSync(join(root, 'old'), { recursive: true })
    const c = await scan()
    expect(c).toMatchObject({ moved: 1, added: 0, missing: 0 })
    expect(idOf('new/deeper/a.jpg')).toBe(id)
  })

  it('swapping two files’ names swaps their rows (marks follow the content)', async () => {
    const { root, scan, idOf, setStatus, statusOf } = await setup({ 'x.jpg': 'XXX', 'y.jpg': 'YYY' })
    setStatus('x.jpg', 'like')
    setStatus('y.jpg', 'meh')
    renameSync(join(root, 'x.jpg'), join(root, 'tmp'))
    renameSync(join(root, 'y.jpg'), join(root, 'x.jpg'))
    renameSync(join(root, 'tmp'), join(root, 'y.jpg'))
    // Same paths, different content: seen as edits in place (paths still exist), marks stay with the path.
    await scan()
    expect(statusOf('x.jpg')).toBe('like')
    expect(statusOf('y.jpg')).toBe('meh')
  })

  it('an edit in place keeps the row and gets re-hashed', async () => {
    const { db, root, scan, idOf } = await setup({ 'a.jpg': 'AAA' })
    const id = idOf('a.jpg')
    writeFileSync(join(root, 'a.jpg'), 'AAA but edited')
    const c = await scan()
    expect(c).toMatchObject({ changed: 1, moved: 0 })
    expect(idOf('a.jpg')).toBe(id)
    expect(db.prepare('SELECT content_hash FROM photo_hashes WHERE photo_id = ?').pluck().get(id)).toBe(
      createHash('sha256').update('AAA but edited').digest('hex')
    )
  })

  it('moving one of two identical copies re-attaches exactly one row', async () => {
    const { db, root, scan, idOf } = await setup({ 'a.jpg': 'SAME', 'b.jpg': 'SAME' })
    const [a, b] = [idOf('a.jpg'), idOf('b.jpg')]
    renameSync(join(root, 'b.jpg'), join(root, 'c.jpg'))
    expect((await scan()).moved).toBe(1)
    expect(idOf('c.jpg')).toBe(b)
    expect(idOf('a.jpg')).toBe(a)
    expect(db.prepare('SELECT count(*) FROM photos').pluck().get()).toBe(2)
  })

  it('a file deleted before it was ever hashed cannot be matched (becomes a new row)', async () => {
    const root = tempDir()
    makeTree(root, { 'a.jpg': 'AAA' })
    const db = openDatabase(':memory:')
    const registry = new FeatureRegistry()
    registry.register(createDedupeFeature({ hash: hashFile }))
    migrate(db, [...coreMigrations, ...registry.migrations()])
    const lib = addLibrary(db, root)
    await scanLibrary(db, lib, { hooks: registry.scanHooks() }) // no hash pass yet
    renameSync(join(root, 'a.jpg'), join(root, 'b.jpg'))
    const c = await scanLibrary(db, lib, { hooks: registry.scanHooks() })
    expect(c).toMatchObject({ moved: 0, added: 1, missing: 1 })
  })

  it('only new files whose size matches a missing photo are hashed during the scan', async () => {
    const h = countingHasher()
    const { root, scan } = await setup({ 'a.jpg': 'AAA' }, h)
    h.calls.length = 0
    rmSync(join(root, 'a.jpg'))
    makeTree(root, { 'other-size.jpg': 'a different length', 'same-size.jpg': 'ZZZ' })
    await scan()
    // during the scan only same-size.jpg was a candidate; the hash pass then hashed the other one
    expect(h.calls.map((p) => p.split('/').pop())).toEqual(['same-size.jpg', 'other-size.jpg'])
  })
})

describe('duplicates', () => {
  const files = {
    'IMG_1.jpg': 'one',
    'backup/IMG_1.jpg': 'one',
    'backup/old/IMG_1 copy.jpg': 'one',
    'IMG_2.jpg': 'two',
    'x/IMG_2.jpg': 'two',
    'unique.jpg': 'unique'
  }

  it('summarizes groups and extra copies', async () => {
    const { db, lib } = await setup(files)
    expect(duplicateSummary(db, lib.id)).toEqual({ groups: 2, extraCopies: 3, hashingDone: true, hashed: 6, total: 6 })
  })

  it('reports hashing as not done while photos are unhashed', async () => {
    const { db, lib } = await setup(files)
    db.prepare('DELETE FROM photo_hashes WHERE photo_id = (SELECT min(id) FROM photos)').run()
    expect(duplicateSummary(db, lib.id).hashingDone).toBe(false)
  })

  it('lists the other copies of a photo', async () => {
    const { db, idOf } = await setup(files)
    expect(copiesOf(db, idOf('IMG_1.jpg'))).toEqual([idOf('backup/IMG_1.jpg'), idOf('backup/old/IMG_1 copy.jpg')])
    expect(copiesOf(db, idOf('unique.jpg'))).toEqual([])
  })

  it('keeper choice: shallowest folder, then shortest path, then alphabetical', () => {
    const sorted = ['backup/old/IMG_1 copy.jpg', 'backup/IMG_1.jpg', 'IMG_1 (2).jpg', 'IMG_1.jpg', 'A_1.jpg'].sort(
      compareKeeper
    )
    expect(sorted).toEqual(['A_1.jpg', 'IMG_1.jpg', 'IMG_1 (2).jpg', 'backup/IMG_1.jpg', 'backup/old/IMG_1 copy.jpg'])
  })

  it('hide: one copy of each stays; the rest become Meh', async () => {
    const { db, lib, statusOf } = await setup(files)
    const r = hideDuplicates(db, lib.id)
    expect(r.marked).toBe(3)
    expect(statusOf('IMG_1.jpg')).toBe('unreviewed')
    expect(statusOf('backup/IMG_1.jpg')).toBe('meh')
    expect(statusOf('backup/old/IMG_1 copy.jpg')).toBe('meh')
    expect(statusOf('IMG_2.jpg')).toBe('unreviewed')
    expect(statusOf('x/IMG_2.jpg')).toBe('meh')
    expect(statusOf('unique.jpg')).toBe('unreviewed')
    expect(hideDuplicates(db, lib.id).marked).toBe(0) // nothing left to do
  })

  it('hide never overrides explicit marks; a Liked copy is the one that stays', async () => {
    const { db, lib, statusOf, setStatus } = await setup(files)
    setStatus('backup/old/IMG_1 copy.jpg', 'like') // the user prefers this one
    setStatus('IMG_2.jpg', 'meh')
    setStatus('x/IMG_2.jpg', 'meh') // whole group already Meh: left alone
    expect(planHide(db, lib.id).length).toBe(2)
    hideDuplicates(db, lib.id)
    expect(statusOf('backup/old/IMG_1 copy.jpg')).toBe('like')
    expect(statusOf('IMG_1.jpg')).toBe('meh')
    expect(statusOf('backup/IMG_1.jpg')).toBe('meh')
    expect(statusOf('IMG_2.jpg')).toBe('meh')
  })

  it('a single Cmd+Z undoes the whole hide, restoring the exact previous state', async () => {
    const { db, lib } = await setup(files)
    db.prepare("UPDATE photos SET status = 'like' WHERE rel_path = 'unique.jpg'").run()
    const before = db.prepare('SELECT id, status FROM photos ORDER BY id').all()
    hideDuplicates(db, lib.id)
    const r = undoLast(db, lib.id)!
    expect(r.changes).toHaveLength(3)
    expect(db.prepare('SELECT id, status FROM photos ORDER BY id').all()).toEqual(before)
  })

  it('the duplicates filter lists only photos with copies, each group kept together', async () => {
    const { db, lib, registry, idOf } = await setup(files)
    const ids = listIds(
      db,
      { libraryId: lib.id, scope: { kind: 'library' }, filter: 'duplicates', sort: 'filename' },
      registry.filters()
    )
    const paths = ids.map((i) => db.prepare('SELECT rel_path FROM photos WHERE id = ?').pluck().get(i))
    // filename order would interleave the groups; clustering keeps each group's copies adjacent
    expect(paths).toEqual(['IMG_1.jpg', 'backup/IMG_1.jpg', 'backup/old/IMG_1 copy.jpg', 'IMG_2.jpg', 'x/IMG_2.jpg'])
    expect(ids).not.toContain(idOf('unique.jpg'))
  })
})

describe('feature registration', () => {
  it('uses migration 100 and registers its IPC channels', () => {
    const f = createDedupeFeature({ hash: hashFile })
    expect(f.migrations!.map((m) => m.version)).toEqual([100])
    const channels: string[] = []
    f.registerIpc!((c) => void channels.push(c), { db: {} as DB })
    expect(channels.sort()).toEqual([
      'duplicates:copies',
      'duplicates:hide',
      'duplicates:previewHide',
      'duplicates:summary'
    ])
  })

  it('core works without the feature: no photo_hashes table, no duplicates filter', async () => {
    const db = openDatabase(':memory:')
    migrate(db, coreMigrations)
    expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'photo_hashes'").pluck().get()).toBe(0)
    const lib: LibraryRow = addLibrary(db, tempDir())
    expect(() =>
      listIds(db, { libraryId: lib.id, scope: { kind: 'library' }, filter: 'duplicates', sort: 'filename' })
    ).toThrow(/Unknown filter/)
  })
})
