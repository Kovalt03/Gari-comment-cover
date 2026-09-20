/*
 * Loads collector exports into the database.
 *
 *   node tools/label/import.mjs data/collected-*.json
 *
 * Safe to run twice: comments are keyed by their normalized text, so a comment
 * that appears in two exports lands on one row and keeps the labels it already
 * has.
 */

import { readFileSync } from 'node:fs';
import { open, keyOf, basic } from './db.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/label/import.mjs <export.json> [...]');
  process.exit(1);
}

const db = open();

const putVideo = db.prepare(`
  INSERT INTO videos (video_id, title, description, category, keywords)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title, description = excluded.description,
    category = excluded.category, keywords = excluded.keywords
`);
const putComment = db.prepare(`
  INSERT INTO comments (key, text, is_reply, likes_text, ago_text, added_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO NOTHING
`);
const putOccurrence = db.prepare(
  'INSERT INTO occurrences (key, video_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
);

let comments = 0;
let occurrences = 0;
let videos = 0;
let skipped = 0;

db.exec('BEGIN');
for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));

  for (const video of data.videos ?? []) {
    putVideo.run(
      video.videoId,
      video.title ?? '',
      video.description ?? '',
      video.category ?? null,
      JSON.stringify(video.keywords ?? []),
    );
    videos += 1;
  }

  for (const comment of data.comments ?? []) {
    const text = basic(comment.text);
    if (!text) {
      skipped += 1;
      continue;
    }
    const key = keyOf(text);
    comments += putComment.run(
      key,
      text,
      comment.isReply ? 1 : 0,
      comment.likesText ?? '',
      comment.agoText ?? '',
      data.collectedAt ?? new Date().toISOString(),
    ).changes;

    for (const videoId of comment.videos ?? []) {
      occurrences += putOccurrence.run(key, videoId).changes;
    }
  }
}
db.exec('COMMIT');

const { total } = db.prepare('SELECT COUNT(*) AS total FROM comments').get();
console.log(
  `imported ${files.length} file(s): ${comments} new comments, ${occurrences} new occurrences, ` +
    `${videos} videos, ${skipped} empty skipped. ${total} comments in the database.`,
);
