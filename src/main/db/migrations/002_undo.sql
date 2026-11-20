-- Undo marks a log entry as undone instead of deleting it, so the log stays a complete history.
ALTER TABLE mark_events ADD COLUMN undone INTEGER NOT NULL DEFAULT 0;
CREATE INDEX mark_events_batch ON mark_events(batch_id);
