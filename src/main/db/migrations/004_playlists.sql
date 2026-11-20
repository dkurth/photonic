-- Playlists (PLAN.md §12). Every photo is Unreviewed or in exactly one playlist. Like and Meh are
-- the two built-in playlists: they can be renamed and re-keyed but not deleted. Playlists are
-- shared by all libraries, like keyboard shortcuts.
CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  builtin    TEXT UNIQUE CHECK (builtin IN ('like', 'meh')),
  shortcut   TEXT,                -- a single key, as KeyboardEvent.key ('ArrowUp', 'm', ' ')
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX playlists_name ON playlists(name COLLATE NOCASE);
CREATE UNIQUE INDEX playlists_shortcut ON playlists(shortcut) WHERE shortcut IS NOT NULL;
INSERT INTO playlists (name, builtin, shortcut) VALUES ('Like', 'like', 'ArrowUp'), ('Meh', 'meh', 'ArrowDown');

-- photos.status ('unreviewed' | 'like' | 'meh') becomes photos.playlist_id (NULL = unreviewed).
ALTER TABLE photos ADD COLUMN playlist_id INTEGER REFERENCES playlists(id);
UPDATE photos SET playlist_id = (SELECT id FROM playlists WHERE builtin = photos.status)
  WHERE status IN ('like', 'meh');
DROP INDEX photos_library_status;
ALTER TABLE photos DROP COLUMN status;
ALTER TABLE photos RENAME COLUMN status_at TO marked_at;
CREATE INDEX photos_library_playlist ON photos(library_id, playlist_id);

-- The undo log: status changes become playlist changes ('' = unreviewed, else the playlist id).
UPDATE mark_events SET
  field = 'playlist',
  old_value = COALESCE((SELECT CAST(id AS TEXT) FROM playlists WHERE builtin = mark_events.old_value), ''),
  new_value = COALESCE((SELECT CAST(id AS TEXT) FROM playlists WHERE builtin = mark_events.new_value), '')
WHERE field = 'status';
