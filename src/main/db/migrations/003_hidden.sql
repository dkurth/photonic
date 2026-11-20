-- Hiding a photo from review is separate from its Like/Meh status (e.g. an identical copy).
-- A hidden photo keeps its status; `hidden_reason` names which feature hid it, and the core only
-- treats photos as hidden while that feature is on.
ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN hidden_reason TEXT;

-- The undo log now records either a status change or a hide/unhide.
ALTER TABLE mark_events RENAME COLUMN old_status TO old_value;
ALTER TABLE mark_events RENAME COLUMN new_status TO new_value;
ALTER TABLE mark_events ADD COLUMN field TEXT NOT NULL DEFAULT 'status'; -- 'status' | 'hidden'
