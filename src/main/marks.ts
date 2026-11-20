import type { Status, UndoResult } from '@shared/types'
import type { DB } from './db'

export const STATUSES: readonly Status[] = ['unreviewed', 'like', 'meh']

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

export interface MarkOptions {
  /** 'user' for keypresses; bulk actions use their own name (e.g. 'dedupe'). */
  source?: string
  /** Events sharing a batch id are undone together. */
  batchId?: number | null
}

/**
 * Sets a photo's status and appends to `mark_events`, in one transaction.
 * Setting the status it already has is a no-op (nothing is logged). Returns false if the photo doesn't exist.
 */
export function setStatus(db: DB, photoId: number, status: Status, opts: MarkOptions = {}): boolean {
  return db.transaction(() => {
    const old = db.prepare('SELECT status FROM photos WHERE id = ?').pluck().get(photoId) as Status | undefined
    if (old === undefined) return false
    if (old === status) return true
    db.prepare("UPDATE photos SET status = ?, status_at = datetime('now') WHERE id = ?").run(status, photoId)
    db.prepare('INSERT INTO mark_events (photo_id, old_status, new_status, source, batch_id) VALUES (?, ?, ?, ?, ?)').run(
      photoId,
      old,
      status,
      opts.source ?? 'user',
      opts.batchId ?? null
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
 * action's batch. Statuses go back to what they were; the events are flagged `undone`, not deleted.
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

    const events = (
      last.batch_id === null
        ? db.prepare('SELECT id, photo_id, old_status FROM mark_events WHERE id = ?').all(last.id)
        : db
            .prepare('SELECT id, photo_id, old_status FROM mark_events WHERE batch_id = ? AND undone = 0 ORDER BY id DESC')
            .all(last.batch_id)
    ) as { id: number; photo_id: number; old_status: Status }[]

    const restore = db.prepare("UPDATE photos SET status = ?, status_at = datetime('now') WHERE id = ?")
    const flag = db.prepare('UPDATE mark_events SET undone = 1 WHERE id = ?')
    for (const e of events) {
      restore.run(e.old_status, e.photo_id)
      flag.run(e.id)
    }
    return { changes: events.map((e) => ({ photoId: e.photo_id, status: e.old_status })) }
  })()
}
