import type { PlaylistId, UndoChange, UndoResult } from '@shared/types'
import type { DB } from './db'

export interface MarkOptions {
  /** 'user' for keypresses; bulk actions use their own name (e.g. 'dedupe'). */
  source?: string
  /** Events sharing a batch id are undone together. */
  batchId?: number | null
}

const logEvent = (
  db: DB,
  photoId: number,
  field: 'playlist' | 'hidden',
  oldValue: string,
  newValue: string,
  opts: MarkOptions
): void =>
  void db
    .prepare(
      'INSERT INTO mark_events (photo_id, field, old_value, new_value, source, batch_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(photoId, field, oldValue, newValue, opts.source ?? 'user', opts.batchId ?? null)

const playlistValue = (id: PlaylistId): string => (id === null ? '' : String(id))

/**
 * Puts a photo in a playlist (null = back to Unreviewed) and appends to `mark_events`, in one
 * transaction. Setting the playlist it's already in is a no-op (nothing logged). Returns false if
 * the photo doesn't exist.
 */
export function setPlaylist(db: DB, photoId: number, playlistId: PlaylistId, opts: MarkOptions = {}): boolean {
  return db.transaction(() => {
    const row = db.prepare('SELECT playlist_id FROM photos WHERE id = ?').get(photoId) as
      { playlist_id: number | null } | undefined
    if (!row) return false
    if (row.playlist_id === playlistId) return true
    db.prepare("UPDATE photos SET playlist_id = ?, marked_at = datetime('now') WHERE id = ?").run(playlistId, photoId)
    logEvent(db, photoId, 'playlist', playlistValue(row.playlist_id), playlistValue(playlistId), opts)
    return true
  })()
}

/**
 * Hides a photo from review (or shows it again) without touching its playlist, logged for undo.
 * `reason` names the feature doing it (e.g. 'duplicate'); see visibleSql.
 */
export function setHidden(
  db: DB,
  photoId: number,
  hidden: boolean,
  reason: string | null,
  opts: MarkOptions = {}
): boolean {
  return db.transaction(() => {
    const row = db.prepare('SELECT hidden, hidden_reason FROM photos WHERE id = ?').get(photoId) as
      { hidden: number; hidden_reason: string | null } | undefined
    if (!row) return false
    if (row.hidden === (hidden ? 1 : 0)) return true
    db.prepare('UPDATE photos SET hidden = ?, hidden_reason = ? WHERE id = ?').run(
      hidden ? 1 : 0,
      hidden ? reason : null,
      photoId
    )
    // The value records the reason, so undoing an unhide restores the right one.
    logEvent(
      db,
      photoId,
      'hidden',
      row.hidden ? `1:${row.hidden_reason ?? ''}` : '0',
      hidden ? `1:${reason ?? ''}` : '0',
      opts
    )
    return true
  })()
}

/** A fresh id for a bulk action's events. */
export function newBatchId(db: DB): number {
  return (db.prepare('SELECT COALESCE(MAX(batch_id), 0) + 1 FROM mark_events').pluck().get() as number) ?? 1
}

/**
 * Undoes the most recent not-yet-undone change in a library: one mark, or every event of a bulk
 * action's batch. Values go back to what they were; the events are flagged `undone`, not deleted.
 */
export function undoLast(db: DB, libraryId: number): UndoResult | null {
  return db.transaction(() => {
    const last = db
      .prepare(
        `SELECT e.id, e.batch_id FROM mark_events e JOIN photos p ON p.id = e.photo_id
         WHERE p.library_id = ? AND e.undone = 0 ORDER BY e.id DESC LIMIT 1`
      )
      .get(libraryId) as { id: number; batch_id: number | null } | undefined
    if (!last) return null

    type Ev = { id: number; photo_id: number; field: 'playlist' | 'hidden'; old_value: string }
    const events = (
      last.batch_id === null
        ? db.prepare('SELECT id, photo_id, field, old_value FROM mark_events WHERE id = ?').all(last.id)
        : db
            .prepare(
              'SELECT id, photo_id, field, old_value FROM mark_events WHERE batch_id = ? AND undone = 0 ORDER BY id DESC'
            )
            .all(last.batch_id)
    ) as Ev[]

    const restorePlaylist = db.prepare("UPDATE photos SET playlist_id = ?, marked_at = datetime('now') WHERE id = ?")
    const playlistExists = db.prepare('SELECT 1 FROM playlists WHERE id = ?')
    const restoreHidden = db.prepare('UPDATE photos SET hidden = ?, hidden_reason = ? WHERE id = ?')
    const flag = db.prepare('UPDATE mark_events SET undone = 1 WHERE id = ?')
    const changes: UndoChange[] = []
    for (const e of events) {
      if (e.field === 'hidden') {
        const hidden = e.old_value.startsWith('1')
        restoreHidden.run(hidden ? 1 : 0, hidden ? e.old_value.slice(2) || null : null, e.photo_id)
        changes.push({ photoId: e.photo_id, field: 'hidden', hidden })
      } else {
        // A playlist deleted since then can't come back: such photos return to Unreviewed.
        let playlistId: PlaylistId = e.old_value === '' ? null : Number(e.old_value)
        if (playlistId !== null && !playlistExists.get(playlistId)) playlistId = null
        restorePlaylist.run(playlistId, e.photo_id)
        changes.push({ photoId: e.photo_id, field: 'playlist', playlistId })
      }
      flag.run(e.id)
    }
    return { changes }
  })()
}

/**
 * SQL condition: photo `alias` is shown for review. A photo is hidden only while the feature that
 * hid it (its reason) is active — turn the feature off and its hidden photos reappear.
 */
export function visibleSql(alias: string, hideReasons: readonly string[]): string {
  if (!hideReasons.length) return '1 = 1'
  const list = hideReasons.map((r) => `'${r.replace(/'/g, "''")}'`).join(', ')
  return `NOT (${alias}.hidden = 1 AND ${alias}.hidden_reason IN (${list}))`
}
