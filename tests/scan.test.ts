import { renameSync, rmSync, utimesSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary } from '../src/main/library'
import { applyMoves, scanLibrary } from '../src/main/scanner/scan'
import type { LibraryRow, ScanHooks } from '../src/main/scanner/types'
import { makeTree, tempDir } from './helpers'

function setup(files: Record<string, string>): { db: DB; root: string; lib: LibraryRow } {
  const root = tempDir()
  makeTree(root, files)
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  return { db, root, lib: addLibrary(db, root) }
}

type Row = { id: number; rel_path: string; dir_path: string; status: string; missing: number; meta_read_at: string | null }
const rows = (db: DB): Row[] =>
  db.prepare('SELECT id, rel_path, dir_path, status, missing, meta_read_at FROM photos ORDER BY rel_path').all() as Row[]
const byPath = (db: DB, p: string): Row => rows(db).find((r) => r.rel_path === p)!

describe('scanLibrary', () => {
  it('inserts every photo as unreviewed on the first scan', async () => {
    const { db, lib } = setup({ 'a.jpg': 'a', 'x/b.jpg': 'b', 'x/y/c.png': 'c', 'skip.mov': 'm' })
    const counts = await scanLibrary(db, lib)
    expect(counts).toMatchObject({ found: 3, added: 3, changed: 0, missing: 0, restored: 0 })
    expect(rows(db).map((r) => [r.rel_path, r.dir_path, r.status])).toEqual([
      ['a.jpg', '', 'unreviewed'],
      ['x/b.jpg', 'x', 'unreviewed'],
      ['x/y/c.png', 'x/y', 'unreviewed']
    ])
    expect(db.prepare('SELECT last_scanned_at FROM libraries').pluck().get()).not.toBeNull()
  })

  it('a rescan with no changes changes nothing', async () => {
    const { db, lib } = setup({ 'a.jpg': 'a', 'b.jpg': 'b' })
    await scanLibrary(db, lib)
    const before = rows(db)
    const counts = await scanLibrary(db, lib)
    expect(counts).toMatchObject({ found: 2, added: 0, changed: 0, missing: 0 })
    expect(rows(db)).toEqual(before)
  })

  it('keeps status when a file is edited, and queues it for a metadata re-read', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'a' })
    await scanLibrary(db, lib)
    db.prepare("UPDATE photos SET status = 'like', meta_read_at = datetime('now')").run()
    writeFileSync(join(root, 'a.jpg'), 'edited and longer')
    const counts = await scanLibrary(db, lib)
    expect(counts.changed).toBe(1)
    expect(byPath(db, 'a.jpg')).toMatchObject({ status: 'like', meta_read_at: null, missing: 0 })
  })

  it('detects a change in mtime alone', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'a' })
    await scanLibrary(db, lib)
    utimesSync(join(root, 'a.jpg'), new Date('2001-01-01'), new Date('2001-01-01'))
    expect((await scanLibrary(db, lib)).changed).toBe(1)
  })

  it('flags vanished files as missing (keeping their status) and restores them when they return', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'a', 'b.jpg': 'b' })
    await scanLibrary(db, lib)
    db.prepare("UPDATE photos SET status = 'meh' WHERE rel_path = 'b.jpg'").run()

    renameSync(join(root, 'b.jpg'), join(root, '..', 'b-away.jpg'))
    let counts = await scanLibrary(db, lib)
    expect(counts.missing).toBe(1)
    expect(byPath(db, 'b.jpg')).toMatchObject({ missing: 1, status: 'meh' })

    // still missing on the next scan: not counted again
    expect((await scanLibrary(db, lib)).missing).toBe(0)

    renameSync(join(root, '..', 'b-away.jpg'), join(root, 'b.jpg'))
    counts = await scanLibrary(db, lib)
    expect(counts.restored).toBe(1)
    expect(byPath(db, 'b.jpg')).toMatchObject({ missing: 0, status: 'meh' })
  })

  it('without a move hook, a renamed file becomes a new row and the old one is missing', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'a' })
    await scanLibrary(db, lib)
    renameSync(join(root, 'a.jpg'), join(root, 'renamed.jpg'))
    const counts = await scanLibrary(db, lib)
    expect(counts).toMatchObject({ added: 1, missing: 1, moved: 0 })
  })

  it('does not flag photos missing under a folder that could not be read', async () => {
    const { db, root, lib } = setup({ 'ok/a.jpg': 'a', 'locked/b.jpg': 'b', 'locked/deeper/c.jpg': 'c' })
    await scanLibrary(db, lib)
    chmodSync(join(root, 'locked'), 0o000)
    try {
      const counts = await scanLibrary(db, lib)
      expect(counts.errors.map((e) => e.dirPath)).toEqual(['locked'])
      expect(counts.missing).toBe(0)
      expect(rows(db).every((r) => r.missing === 0)).toBe(true)
    } finally {
      chmodSync(join(root, 'locked'), 0o755)
    }
  })

  it('refuses to scan a library whose folder is gone, without touching the DB', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'a' })
    await scanLibrary(db, lib)
    rmSync(root, { recursive: true })
    await expect(scanLibrary(db, lib)).rejects.toThrow(/not found/)
    expect(byPath(db, 'a.jpg').missing).toBe(0)
  })

  it('writes in batches and reports progress', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`f${String(i).padStart(2, '0')}.jpg`] = String(i)
    const { db, lib } = setup(files)
    const seen: number[] = []
    await scanLibrary(db, lib, { batchSize: 10, onProgress: (c) => seen.push(c.found) })
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen.at(-1)).toBe(25)
    expect(rows(db)).toHaveLength(25)
  })

  it('keeps already-written batches when cancelled, and never flags missing', async () => {
    const { db, lib } = setup({ 'a/1.jpg': '1', 'b/2.jpg': '2' })
    await scanLibrary(db, lib)
    const ac = new AbortController()
    ac.abort()
    await expect(scanLibrary(db, lib, { signal: ac.signal })).rejects.toThrow()
    expect(rows(db).every((r) => r.missing === 0)).toBe(true)
  })
})

describe('move hooks', () => {
  // A stand-in for the dedupe feature: matches by size + file name.
  const byNameAndSize: ScanHooks = {
    async matchMoves(_ctx, added, missing) {
      const name = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
      return added.flatMap((a) => {
        const m = missing.find((x) => name(x.relPath) === name(a.relPath) && x.sizeBytes === a.sizeBytes)
        return m ? [{ missingId: m.id, addedId: a.id }] : []
      })
    }
  }

  it('re-attaches a moved file to its old row, keeping id and status', async () => {
    const { db, root, lib } = setup({ 'old/a.jpg': 'aaa', 'b.jpg': 'b' })
    await scanLibrary(db, lib)
    const before = byPath(db, 'old/a.jpg')
    db.prepare("UPDATE photos SET status = 'like' WHERE id = ?").run(before.id)

    makeTree(root, { 'new/place/a.jpg': 'aaa' })
    rmSync(join(root, 'old'), { recursive: true })
    const counts = await scanLibrary(db, lib, { hooks: [byNameAndSize] })

    expect(counts).toMatchObject({ moved: 1, added: 0, missing: 0 })
    const after = byPath(db, 'new/place/a.jpg')
    expect(after).toMatchObject({ id: before.id, status: 'like', missing: 0, dir_path: 'new/place' })
    expect(rows(db)).toHaveLength(2)
  })

  it('also matches files that went missing in an earlier scan', async () => {
    const { db, root, lib } = setup({ 'a.jpg': 'aaa' })
    await scanLibrary(db, lib)
    const id = byPath(db, 'a.jpg').id
    const parked = join(root, '..', `parked-${id}.jpg`)

    renameSync(join(root, 'a.jpg'), parked) // gone from the library entirely
    expect((await scanLibrary(db, lib, { hooks: [byNameAndSize] })).missing).toBe(1)

    makeTree(root, { 'sub/a.jpg': 'aaa' }) // comes back somewhere else, a scan later
    rmSync(parked)
    const counts = await scanLibrary(db, lib, { hooks: [byNameAndSize] })
    expect(counts).toMatchObject({ moved: 1, added: 0, missing: 0 })
    expect(byPath(db, 'sub/a.jpg')).toMatchObject({ id, missing: 0 })
  })

  it('calls afterScan hooks', async () => {
    const { db, lib } = setup({ 'a.jpg': 'a' })
    let called = 0
    await scanLibrary(db, lib, { hooks: [{ afterScan: () => void called++ }] })
    expect(called).toBe(1)
  })
})

describe('applyMoves', () => {
  async function twoRows(): Promise<{ db: DB; libId: number; missingId: number; addedId: number }> {
    const { db, root, lib } = setup({ 'a.jpg': 'a' })
    await scanLibrary(db, lib)
    renameSync(join(root, 'a.jpg'), join(root, 'b.jpg'))
    await scanLibrary(db, lib)
    return { db, libId: lib.id, missingId: byPath(db, 'a.jpg').id, addedId: byPath(db, 'b.jpg').id }
  }

  it('ignores pairs that reuse a row, point the wrong way, or touch a reviewed new row', async () => {
    const { db, libId, missingId, addedId } = await twoRows()
    expect(applyMoves(db, libId, [{ missingId: addedId, addedId: missingId }])).toEqual([]) // backwards
    expect(applyMoves(db, libId + 1, [{ missingId, addedId }])).toEqual([]) // other library
    db.prepare("UPDATE photos SET status = 'like' WHERE id = ?").run(addedId)
    expect(applyMoves(db, libId, [{ missingId, addedId }])).toEqual([]) // added row already reviewed
    expect(rows(db)).toHaveLength(2)
  })

  it('applies each row at most once', async () => {
    const { db, libId, missingId, addedId } = await twoRows()
    const applied = applyMoves(db, libId, [
      { missingId, addedId },
      { missingId, addedId }
    ])
    expect(applied).toHaveLength(1)
    expect(rows(db)).toEqual([expect.objectContaining({ id: missingId, rel_path: 'b.jpg', missing: 0 })])
  })
})
