-- Dedupe feature (PLAN.md §8). In its own table on purpose, so the feature can be removed
-- without touching `photos`.
CREATE TABLE photo_hashes (
  photo_id     INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,              -- SHA-256 hex of the file's bytes
  size_bytes   INTEGER NOT NULL,           -- the file's size and mtime when it was hashed;
  mtime_ms     INTEGER NOT NULL,           -- if the photos row no longer matches, the hash is stale
  hashed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photo_hashes_hash ON photo_hashes(content_hash);
