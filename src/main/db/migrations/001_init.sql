-- Core schema. See PLAN.md §5.

CREATE TABLE libraries (
  id              INTEGER PRIMARY KEY,
  root_path       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_scanned_at TEXT
);

CREATE TABLE photos (
  id            INTEGER PRIMARY KEY,
  library_id    INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  rel_path      TEXT NOT NULL,
  dir_path      TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  birthtime_ms  INTEGER,

  taken_at      TEXT,
  width         INTEGER,
  height        INTEGER,
  camera_make   TEXT,
  camera_model  TEXT,
  lens_model    TEXT,
  exif_json     TEXT,
  meta_read_at  TEXT,

  status        TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (status IN ('unreviewed','like','meh')),
  status_at     TEXT,
  missing       INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (library_id, rel_path)
);
CREATE INDEX photos_library_status ON photos(library_id, status);
CREATE INDEX photos_library_dir    ON photos(library_id, dir_path);
CREATE INDEX photos_library_taken  ON photos(library_id, taken_at);

CREATE TABLE mark_events (
  id          INTEGER PRIMARY KEY,
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  old_status  TEXT NOT NULL,
  new_status  TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'user',
  batch_id    INTEGER,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX mark_events_photo ON mark_events(photo_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
