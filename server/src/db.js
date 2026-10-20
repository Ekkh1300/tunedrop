/**
 * Storage layer. Uses the built-in node:sqlite (DatabaseSync) so the project
 * has zero native dependencies — plain `npm install` is enough.
 *
 * Files (audio, covers) live on disk under DATA_DIR; only metadata lives here.
 */
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { COVER_DIR, DB_PATH, UPLOAD_DIR } from './config.js'

mkdirSync(UPLOAD_DIR, { recursive: true })
mkdirSync(COVER_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rooms (
    id             TEXT PRIMARY KEY,
    code           TEXT UNIQUE NOT NULL,
    secret         TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS join_tokens (
    id         TEXT PRIMARY KEY,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_join_tokens_room ON join_tokens(room_id);

  CREATE TABLE IF NOT EXISTS songs (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    original_name    TEXT NOT NULL,
    stored_name      TEXT UNIQUE NOT NULL,
    mime_type        TEXT NOT NULL,
    ext              TEXT NOT NULL,
    size             INTEGER NOT NULL,
    duration         REAL,
    title            TEXT,
    artist           TEXT,
    album            TEXT,
    cover_name       TEXT,
    source_type      TEXT NOT NULL DEFAULT 'upload',
    source_url       TEXT,
    uploader_device  TEXT,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_songs_room ON songs(room_id, created_at);
`)

export const queries = {
  insertRoom: db.prepare(
    `INSERT INTO rooms (id, code, secret, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  roomByCode: db.prepare(`SELECT * FROM rooms WHERE code = ?`),
  roomById: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
  touchRoom: db.prepare(`UPDATE rooms SET last_active_at = ? WHERE id = ?`),
  insertJoinToken: db.prepare(
    `INSERT INTO join_tokens (id, room_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  joinTokenByToken: db.prepare(`SELECT * FROM join_tokens WHERE token = ?`),
  deleteJoinToken: db.prepare(`DELETE FROM join_tokens WHERE id = ?`),
  pruneJoinTokens: db.prepare(`DELETE FROM join_tokens WHERE expires_at < ?`),
  insertSong: db.prepare(
    `INSERT INTO songs (id, room_id, original_name, stored_name, mime_type, ext, size,
                        duration, title, artist, album, cover_name, source_type,
                        source_url, uploader_device, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  songsByRoom: db.prepare(`SELECT * FROM songs WHERE room_id = ? ORDER BY created_at DESC`),
  songById: db.prepare(`SELECT * FROM songs WHERE id = ?`),
  deleteSong: db.prepare(`DELETE FROM songs WHERE id = ?`),
  roomStorageBytes: db.prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM songs WHERE room_id = ?`),
  roomsWithSongs: db.prepare(`SELECT DISTINCT room_id FROM songs`),
  deleteIdleRooms: db.prepare(`
    DELETE FROM rooms
    WHERE last_active_at < :cutoff
      AND id NOT IN (SELECT DISTINCT room_id FROM songs)
  `),
  countSongs: db.prepare(`SELECT COUNT(*) AS n FROM songs WHERE room_id = ?`),
}
