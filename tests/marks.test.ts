import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { isStatus, newBatchId, setHidden, setStatus, undoLast, visibleSql } from '../src/main/marks'
import { listPhotos, statusCounts } from '../src/main/ordering'

function setup(n = 4): { db: DB; lib: number; ids: number[] } {
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  const lib = Number(db.prepare("INSERT INTO libraries (root_path, name) VALUES ('/p', 'p')").run().lastInsertRowid)
  const ids = Array.from({ length: n }, (_, i) =>
    Number(
      db
        .prepare("INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms) VALUES (?, ?, '', 1, 1)")
        .run(lib, `p${i}.jpg`).lastInsertRowid
    )
  )
  return { db, lib, ids }
}
const status = (db: DB, id: number): string =>
  db.prepare('SELECT status FROM photos WHERE id = ?').pluck().get(id) as string
const events = (db: DB): number => db.prepare('SELECT count(*) FROM mark_events').pluck().get() as number

describe('setStatus', () => {
  it('changes the status, stamps status_at and logs the change', () => {
    const { db, ids } = setup()
    expect(setStatus(db, ids[0], 'like')).toBe(true)
    expect(status(db, ids[0])).toBe('like')
    expect(db.prepare('SELECT status_at FROM photos WHERE id = ?').pluck().get(ids[0])).not.toBeNull()
    expect(db.prepare('SELECT field, old_value, new_value, source, batch_id, undone FROM mark_events').get()).toEqual({
      field: 'status',
      old_value: 'unreviewed',
      new_value: 'like',
      source: 'user',
      batch_id: null,
      undone: 0
    })
  })

  it('setting the same status again logs nothing', () => {
    const { db, ids } = setup()
    setStatus(db, ids[0], 'meh')
    setStatus(db, ids[0], 'meh')
    expect(events(db)).toBe(1)
  })

  it('returns false for an unknown photo', () => {
    expect(setStatus(setup().db, 9999, 'like')).toBe(false)
  })

  it('validates statuses', () => {
    expect(isStatus('like')).toBe(true)
    expect(isStatus('keep')).toBe(false)
    expect(isStatus(undefined)).toBe(false)
  })
})

describe('undoLast', () => {
  it('undoes marks one at a time, most recent first', () => {
    const { db, lib, ids } = setup()
    setStatus(db, ids[0], 'like')
    setStatus(db, ids[1], 'meh')
    setStatus(db, ids[0], 'meh') // changed my mind

    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[0], field: 'status', status: 'like' }] })
    expect(status(db, ids[0])).toBe('like')
    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[1], field: 'status', status: 'unreviewed' }] })
    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[0], field: 'status', status: 'unreviewed' }] })
    expect(undoLast(db, lib)).toBeNull()
    expect(ids.map((i) => status(db, i))).toEqual(['unreviewed', 'unreviewed', 'unreviewed', 'unreviewed'])
    expect(events(db)).toBe(3) // history is kept, just flagged
  })

  it('undoes a whole batch at once, restoring each photo exactly', () => {
    const { db, lib, ids } = setup()
    setStatus(db, ids[3], 'like')
    const batch = newBatchId(db)
    for (const id of ids.slice(0, 3)) setStatus(db, id, 'meh', { source: 'dedupe', batchId: batch })
    setStatus(db, ids[3], 'like') // no-op, not logged

    const r = undoLast(db, lib)!
    expect(r.changes.map((c) => c.photoId).sort()).toEqual(ids.slice(0, 3).sort())
    expect(ids.map((i) => status(db, i))).toEqual(['unreviewed', 'unreviewed', 'unreviewed', 'like'])
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[3], field: 'status', status: 'unreviewed' }])
  })

  it('only touches the given library', () => {
    const a = setup(1)
    const otherLib = Number(
      a.db.prepare("INSERT INTO libraries (root_path, name) VALUES ('/q', 'q')").run().lastInsertRowid
    )
    const otherPhoto = Number(
      a.db
        .prepare(
          "INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms) VALUES (?, 'x.jpg', '', 1, 1)"
        )
        .run(otherLib).lastInsertRowid
    )
    setStatus(a.db, a.ids[0], 'like')
    setStatus(a.db, otherPhoto, 'meh')
    expect(undoLast(a.db, a.lib)!.changes[0].photoId).toBe(a.ids[0])
    expect(status(a.db, otherPhoto)).toBe('meh')
  })

  it('batch ids increase', () => {
    const { db, ids } = setup()
    const b1 = newBatchId(db)
    setStatus(db, ids[0], 'meh', { batchId: b1 })
    expect(newBatchId(db)).toBe(b1 + 1)
  })
})

describe('setHidden', () => {
  it('hides without changing the status, logs it, and undo restores it (including the reason)', () => {
    const { db, lib, ids } = setup(2)
    setStatus(db, ids[0], 'like')
    expect(setHidden(db, ids[0], true, 'duplicate')).toBe(true)
    expect(db.prepare('SELECT status, hidden, hidden_reason FROM photos WHERE id = ?').get(ids[0])).toEqual({
      status: 'like',
      hidden: 1,
      hidden_reason: 'duplicate'
    })
    setHidden(db, ids[0], true, 'duplicate') // no-op, not logged
    setHidden(db, ids[0], false, null)
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[0], field: 'hidden', hidden: true }])
    expect(db.prepare('SELECT hidden_reason FROM photos WHERE id = ?').pluck().get(ids[0])).toBe('duplicate')
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[0], field: 'hidden', hidden: false }])
    expect(status(db, ids[0])).toBe('like')
  })

  it('hidden photos are left out of lists and counts only while their reason is active', () => {
    const { db, lib, ids } = setup(3)
    setHidden(db, ids[1], true, 'duplicate')
    const view = { libraryId: lib, scope: { kind: 'library' as const }, filter: 'all', sort: 'filename' as const }
    expect(listPhotos(db, view, {}, { hideReasons: ['duplicate'] }).ids).toEqual([ids[0], ids[2]])
    expect(statusCounts(db, lib, { kind: 'library' }, { hideReasons: ['duplicate'] }).total).toBe(2)
    expect(listPhotos(db, view, {}, { hideReasons: [] }).ids).toEqual(ids) // feature off: back in view
    expect(visibleSql('p', [])).toBe('1 = 1')
    expect(visibleSql('p', ["o'brien"])).toContain("'o''brien'")
  })
})

describe('listPhotos / statusCounts', () => {
  it('returns statuses aligned with ids, and counts by scope', () => {
    const { db, lib, ids } = setup(3)
    setStatus(db, ids[1], 'like')
    const list = listPhotos(db, { libraryId: lib, scope: { kind: 'library' }, filter: 'all', sort: 'filename' })
    expect(list).toEqual({ ids, statuses: ['unreviewed', 'like', 'unreviewed'] })
    expect(statusCounts(db, lib, { kind: 'library' })).toEqual({ total: 3, unreviewed: 2, like: 1, meh: 0 })
  })
})
