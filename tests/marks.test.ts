import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { newBatchId, setHidden, setPlaylist, undoLast, visibleSql } from '../src/main/marks'
import { listPhotos, statusCounts } from '../src/main/ordering'
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  renamePlaylist,
  resetShortcuts,
  setShortcut
} from '../src/main/playlists'
import { LIKE, MEH } from './helpers'

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
const playlistOf = (db: DB, id: number): number | null =>
  db.prepare('SELECT playlist_id FROM photos WHERE id = ?').pluck().get(id) as number | null
const events = (db: DB): number => db.prepare('SELECT count(*) FROM mark_events').pluck().get() as number
const keys = (db: DB): Record<string, string | null> =>
  Object.fromEntries(listPlaylists(db).map((p) => [p.name, p.shortcut]))

describe('setPlaylist', () => {
  it('puts a photo in a playlist, stamps marked_at and logs the change', () => {
    const { db, ids } = setup()
    expect(setPlaylist(db, ids[0], LIKE)).toBe(true)
    expect(playlistOf(db, ids[0])).toBe(LIKE)
    expect(db.prepare('SELECT marked_at FROM photos WHERE id = ?').pluck().get(ids[0])).not.toBeNull()
    expect(db.prepare('SELECT field, old_value, new_value, source, batch_id, undone FROM mark_events').get()).toEqual({
      field: 'playlist',
      old_value: '',
      new_value: String(LIKE),
      source: 'user',
      batch_id: null,
      undone: 0
    })
  })

  it('putting it in the playlist it is already in logs nothing', () => {
    const { db, ids } = setup()
    setPlaylist(db, ids[0], MEH)
    setPlaylist(db, ids[0], MEH)
    expect(events(db)).toBe(1)
  })

  it('returns false for an unknown photo, and refuses a playlist that does not exist', () => {
    const { db, ids } = setup()
    expect(setPlaylist(db, 9999, LIKE)).toBe(false)
    expect(() => setPlaylist(db, ids[0], 999)).toThrow(/FOREIGN KEY/)
  })
})

describe('undoLast', () => {
  it('undoes marks one at a time, most recent first', () => {
    const { db, lib, ids } = setup()
    setPlaylist(db, ids[0], LIKE)
    setPlaylist(db, ids[1], MEH)
    setPlaylist(db, ids[0], MEH) // changed my mind

    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[0], field: 'playlist', playlistId: LIKE }] })
    expect(playlistOf(db, ids[0])).toBe(LIKE)
    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[1], field: 'playlist', playlistId: null }] })
    expect(undoLast(db, lib)).toEqual({ changes: [{ photoId: ids[0], field: 'playlist', playlistId: null }] })
    expect(undoLast(db, lib)).toBeNull()
    expect(ids.map((i) => playlistOf(db, i))).toEqual([null, null, null, null])
    expect(events(db)).toBe(3) // history is kept, just flagged
  })

  it('undoes a whole batch at once, restoring each photo exactly', () => {
    const { db, lib, ids } = setup()
    setPlaylist(db, ids[3], LIKE)
    const batch = newBatchId(db)
    for (const id of ids.slice(0, 3)) setPlaylist(db, id, MEH, { source: 'folder', batchId: batch })

    const r = undoLast(db, lib)!
    expect(r.changes.map((c) => c.photoId).sort()).toEqual(ids.slice(0, 3).sort())
    expect(ids.map((i) => playlistOf(db, i))).toEqual([null, null, null, LIKE])
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
    setPlaylist(a.db, a.ids[0], LIKE)
    setPlaylist(a.db, otherPhoto, MEH)
    expect(undoLast(a.db, a.lib)!.changes[0].photoId).toBe(a.ids[0])
    expect(playlistOf(a.db, otherPhoto)).toBe(MEH)
  })
})

describe('setHidden', () => {
  it('hides without changing the playlist, logs it, and undo restores it (including the reason)', () => {
    const { db, lib, ids } = setup(2)
    setPlaylist(db, ids[0], LIKE)
    expect(setHidden(db, ids[0], true, 'duplicate')).toBe(true)
    expect(db.prepare('SELECT playlist_id, hidden, hidden_reason FROM photos WHERE id = ?').get(ids[0])).toEqual({
      playlist_id: LIKE,
      hidden: 1,
      hidden_reason: 'duplicate'
    })
    setHidden(db, ids[0], false, null)
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[0], field: 'hidden', hidden: true }])
    expect(db.prepare('SELECT hidden_reason FROM photos WHERE id = ?').pluck().get(ids[0])).toBe('duplicate')
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[0], field: 'hidden', hidden: false }])
    expect(playlistOf(db, ids[0])).toBe(LIKE)
  })

  it('hidden photos are left out of lists and counts only while their reason is active', () => {
    const { db, lib, ids } = setup(3)
    setHidden(db, ids[1], true, 'duplicate')
    const view = { libraryId: lib, filter: 'all', sort: 'filename' as const }
    expect(listPhotos(db, view, {}, { hideReasons: ['duplicate'] }).ids).toEqual([ids[0], ids[2]])
    expect(statusCounts(db, lib, { hideReasons: ['duplicate'] }).total).toBe(2)
    expect(listPhotos(db, view, {}, { hideReasons: [] }).ids).toEqual(ids)
    expect(visibleSql('p', [])).toBe('1 = 1')
    expect(visibleSql('p', ["o'brien"])).toContain("'o''brien'")
  })
})

describe('listPhotos / statusCounts', () => {
  it('returns playlists aligned with ids, filters by playlist, and counts per playlist', () => {
    const { db, lib, ids } = setup(3)
    setPlaylist(db, ids[1], LIKE)
    const list = listPhotos(db, { libraryId: lib, filter: 'all', sort: 'filename' })
    expect(list).toEqual({ ids, playlists: [null, LIKE, null] })
    expect(listPhotos(db, { libraryId: lib, filter: `playlist:${LIKE}`, sort: 'filename' }).ids).toEqual([ids[1]])
    expect(statusCounts(db, lib)).toEqual({ total: 3, unreviewed: 2, byPlaylist: { [LIKE]: 1 } })
  })
})

describe('playlists', () => {
  it('lists alphabetically with photo counts; names are trimmed and unique (case-insensitive)', () => {
    const { db, ids } = setup(2)
    const memes = createPlaylist(db, '  memes  ')
    setPlaylist(db, ids[0], memes.id)
    expect(listPlaylists(db).map((p) => [p.name, p.photoCount])).toEqual([
      ['Like', 0],
      ['Meh', 0],
      ['memes', 1]
    ])
    expect(() => createPlaylist(db, 'MEMES')).toThrow(/already a playlist/)
    expect(() => createPlaylist(db, '   ')).toThrow(/needs a name/)
  })

  it('Like and Meh can be renamed', () => {
    const { db } = setup(0)
    renamePlaylist(db, LIKE, 'Keepers')
    expect(listPlaylists(db).find((p) => p.id === LIKE)).toMatchObject({ name: 'Keepers', builtin: 'like' })
    expect(() => renamePlaylist(db, MEH, 'keepers')).toThrow(/already a playlist/)
  })

  it('a key belongs to one playlist: giving it to another takes it away from the first', () => {
    const { db } = setup(0)
    const memes = createPlaylist(db, 'memes')
    setShortcut(db, memes.id, 'm')
    setShortcut(db, memes.id, 'ArrowUp') // Like loses ↑
    expect(keys(db)).toEqual({ Like: null, Meh: 'ArrowDown', memes: 'ArrowUp' })
    expect(() => setShortcut(db, memes.id, 'Escape')).toThrow(/can't be a shortcut/)
  })

  it('reset: Like = ↑, Meh = ↓, clashing keys removed, other keys kept', () => {
    const { db } = setup(0)
    const memes = createPlaylist(db, 'memes')
    const cats = createPlaylist(db, 'cats')
    const dogs = createPlaylist(db, 'dogs')
    setShortcut(db, memes.id, 'ArrowUp') // takes ↑ from Like
    setShortcut(db, cats.id, 's') // clashes with the app's "change order"
    setShortcut(db, dogs.id, 'k') // no clash: kept
    setShortcut(db, MEH, 'x') // Meh moved off ↓: goes back
    resetShortcuts(db, ['s', 'r', 'ArrowLeft'])
    expect(keys(db)).toEqual({ cats: null, dogs: 'k', Like: 'ArrowUp', Meh: 'ArrowDown', memes: null })
  })

  it('deleting moves its photos where you choose, can’t be deleted for Like/Meh, and isn’t undoable', () => {
    const { db, lib, ids } = setup(3)
    const memes = createPlaylist(db, 'memes')
    setPlaylist(db, ids[0], memes.id)
    setPlaylist(db, ids[1], memes.id)
    setPlaylist(db, ids[2], LIKE)
    expect(deletePlaylist(db, memes.id, MEH)).toEqual({ moved: 2 })
    expect(ids.map((i) => playlistOf(db, i))).toEqual([MEH, MEH, LIKE])
    expect(listPlaylists(db).map((p) => p.name)).toEqual(['Like', 'Meh'])
    // The move and everything that mentioned memes is retired from undo; undo continues with older changes.
    expect(undoLast(db, lib)!.changes).toEqual([{ photoId: ids[2], field: 'playlist', playlistId: null }])
    expect(undoLast(db, lib)).toBeNull()
    expect(() => deletePlaylist(db, LIKE, null)).toThrow(/can't be deleted/)
  })

  it('deleting can send the photos back to Unreviewed', () => {
    const { db, ids } = setup(1)
    const memes = createPlaylist(db, 'memes')
    setPlaylist(db, ids[0], memes.id)
    deletePlaylist(db, memes.id, null)
    expect(playlistOf(db, ids[0])).toBeNull()
  })
})
