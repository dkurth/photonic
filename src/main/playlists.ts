import type { Playlist, PlaylistId } from '@shared/types'
import { DEFAULT_SHORTCUTS, RESERVED_KEYS } from '@shared/shortcuts'
import type { DB } from './db'
import { newBatchId, setPlaylist } from './marks'

type Row = { id: number; name: string; builtin: 'like' | 'meh' | null; shortcut: string | null; photo_count: number }
const toPlaylist = (r: Row): Playlist => ({
  id: r.id,
  name: r.name,
  builtin: r.builtin,
  shortcut: r.shortcut,
  photoCount: r.photo_count
})
const SELECT = `SELECT pl.*, (SELECT count(*) FROM photos p WHERE p.playlist_id = pl.id AND p.missing = 0) AS photo_count
  FROM playlists pl`

/** All playlists, alphabetically (PLAN.md §12). Playlists are shared by all libraries. */
export function listPlaylists(db: DB): Playlist[] {
  return (db.prepare(`${SELECT} ORDER BY pl.name COLLATE NOCASE, pl.id`).all() as Row[]).map(toPlaylist)
}

export function getPlaylist(db: DB, id: number): Playlist | null {
  const r = db.prepare(`${SELECT} WHERE pl.id = ?`).get(id) as Row | undefined
  return r ? toPlaylist(r) : null
}

export function builtinId(db: DB, builtin: 'like' | 'meh'): number {
  return db.prepare('SELECT id FROM playlists WHERE builtin = ?').pluck().get(builtin) as number
}

function cleanName(db: DB, name: string, exceptId?: number): string {
  const n = name.trim().replace(/\s+/g, ' ')
  if (!n) throw new Error('A playlist needs a name')
  if (n.length > 60) throw new Error('That name is too long (60 characters at most)')
  const clash = db.prepare('SELECT id FROM playlists WHERE name = ? COLLATE NOCASE').pluck().get(n) as
    number | undefined
  if (clash !== undefined && clash !== exceptId) throw new Error(`There's already a playlist called "${n}"`)
  return n
}

export function createPlaylist(db: DB, name: string): Playlist {
  const id = Number(db.prepare('INSERT INTO playlists (name) VALUES (?)').run(cleanName(db, name)).lastInsertRowid)
  return getPlaylist(db, id)!
}

export function renamePlaylist(db: DB, id: number, name: string): Playlist {
  if (!getPlaylist(db, id)) throw new Error('Playlist not found')
  db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(cleanName(db, name, id), id)
  return getPlaylist(db, id)!
}

/**
 * Gives a playlist a single-key shortcut (null removes it). A playlist that had that key loses
 * it — the UI asks first. Clashes with the app's own shortcuts are allowed (the playlist wins);
 * the UI warns about those too.
 */
export function setShortcut(db: DB, id: number, key: string | null): void {
  if (!getPlaylist(db, id)) throw new Error('Playlist not found')
  if (key !== null && (RESERVED_KEYS as readonly string[]).includes(key)) throw new Error(`${key} can't be a shortcut`)
  db.transaction(() => {
    if (key !== null) db.prepare('UPDATE playlists SET shortcut = NULL WHERE shortcut = ? AND id <> ?').run(key, id)
    db.prepare('UPDATE playlists SET shortcut = ? WHERE id = ?').run(key, id)
  })()
}

/**
 * "Reset shortcuts": Like goes back to ↑ and Meh to ↓, and any playlist key that clashes with one
 * of the app's own shortcuts (`systemKeys`) is removed. Other keys you set up stay.
 */
export function resetShortcuts(db: DB, systemKeys: readonly string[]): void {
  const defaultKeys = Object.values(DEFAULT_SHORTCUTS)
  db.transaction(() => {
    const clear = db.prepare('UPDATE playlists SET shortcut = NULL WHERE id = ?')
    for (const p of listPlaylists(db)) {
      if (p.shortcut === null) continue
      // Clashes with an app shortcut, or holds ↑/↓, which go back to Like/Meh: removed.
      if (systemKeys.includes(p.shortcut) || defaultKeys.includes(p.shortcut)) clear.run(p.id)
    }
    const set = db.prepare('UPDATE playlists SET shortcut = ? WHERE builtin = ?')
    for (const [builtin, key] of Object.entries(DEFAULT_SHORTCUTS)) set.run(key, builtin)
  })()
}

/**
 * Deletes a playlist (not Like or Meh), first moving its photos to `moveTo` (null = Unreviewed).
 * This can't be undone: the playlist is gone, so its entries in the undo log are retired too.
 */
export function deletePlaylist(db: DB, id: number, moveTo: PlaylistId): { moved: number } {
  const p = getPlaylist(db, id)
  if (!p) throw new Error('Playlist not found')
  if (p.builtin) throw new Error(`${p.name} can't be deleted`)
  if (moveTo === id) throw new Error("Can't move photos into the playlist being deleted")
  if (moveTo !== null && !getPlaylist(db, moveTo)) throw new Error('Target playlist not found')
  return db.transaction(() => {
    const photos = db.prepare('SELECT id FROM photos WHERE playlist_id = ?').pluck().all(id) as number[]
    const batchId = newBatchId(db)
    for (const photoId of photos) setPlaylist(db, photoId, moveTo, { source: 'playlist-delete', batchId })
    const v = String(id)
    db.prepare(
      "UPDATE mark_events SET undone = 1 WHERE batch_id = ? OR (field = 'playlist' AND (old_value = ? OR new_value = ?))"
    ).run(batchId, v, v)
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    return { moved: photos.length }
  })()
}
