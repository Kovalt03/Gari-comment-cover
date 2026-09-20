/*
 * SQLite storage for the labelling dataset. Development only; the extension
 * itself never touches this. Uses node:sqlite so there is no dependency to
 * install.
 *
 * Labels live in their own table. Re-labelling with different criteria then
 * leaves the collected comments untouched.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const DB_PATH = new URL('../../data/gari.db', import.meta.url).pathname;

// Same normalization the extension uses for dedup (src/core/normalize.js basic)
const INVISIBLE = new RegExp(
  '[\\u00ad\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u206a-\\u206f\\ufe00-\\ufe0f\\ufeff]',
  'g',
);

export const basic = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();

/* The key is a hash of the normalized text, so the same comment collected twice
 * lands on the same row no matter which session produced it. */
export const keyOf = (text) => createHash('sha1').update(basic(text)).digest('hex').slice(0, 16);

/* Categories the user can switch on and off later, so they double as the
 * cold-start categories. Split by how much they depend on personal taste:
 * ad and toxic are broadly agreed on, the rest are this user's call. */
export const LABELS = [
  'ad',
  'toxic',
  'spoiler',
  'politics',
  'noise',
  'unwanted',
  'neutral',
  'ambiguous',
];

export function open(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS videos (
      video_id    TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category    TEXT,
      keywords    TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS comments (
      key        TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      is_reply   INTEGER NOT NULL DEFAULT 0,
      likes_text TEXT NOT NULL DEFAULT '',
      ago_text   TEXT NOT NULL DEFAULT '',
      added_at   TEXT NOT NULL
    );

    -- A comment can show up under more than one video, so occurrences are
    -- their own rows rather than a count column.
    CREATE TABLE IF NOT EXISTS occurrences (
      key      TEXT NOT NULL REFERENCES comments(key),
      video_id TEXT NOT NULL REFERENCES videos(video_id),
      PRIMARY KEY (key, video_id)
    );

    CREATE TABLE IF NOT EXISTS labels (
      key        TEXT PRIMARY KEY REFERENCES comments(key),
      label      TEXT NOT NULL,
      obfuscated INTEGER NOT NULL DEFAULT 0,
      labeled_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS occurrences_video ON occurrences(video_id);
  `);
  return db;
}

export function stats(db) {
  const one = (sql) => db.prepare(sql).get();
  const { total } = one('SELECT COUNT(*) AS total FROM comments');
  const { labeled } = one('SELECT COUNT(*) AS labeled FROM labels');
  return {
    total,
    labeled,
    remaining: total - labeled,
    videos: one('SELECT COUNT(*) AS n FROM videos').n,
    byLabel: db.prepare('SELECT label, COUNT(*) AS n FROM labels GROUP BY label ORDER BY n DESC').all(),
    obfuscated: one('SELECT COUNT(*) AS n FROM labels WHERE obfuscated = 1').n,
  };
}
