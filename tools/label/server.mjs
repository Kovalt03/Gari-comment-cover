/*
 * Local labelling server. Development only.
 *
 *   npm run label
 *
 * Binds to 127.0.0.1. Every label is written the moment it is pressed, so
 * closing the tab halfway through costs nothing.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { open, stats, LABELS } from './db.mjs';

const PORT = Number(process.env.PORT ?? 4173);
const db = open();

const putLabel = db.prepare(`
  INSERT INTO labels (key, label, obfuscated, labeled_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    label = excluded.label, obfuscated = excluded.obfuscated, labeled_at = excluded.labeled_at
`);
const dropLabel = db.prepare('DELETE FROM labels WHERE key = ?');

/* Grouped by video so the context does not change on every comment, with the
 * video order shuffled so a long session does not end up spent on one genre. */
const queueRows = db.prepare(`
  SELECT c.key, c.text, c.is_reply, c.likes_text, c.ago_text,
         v.video_id, v.title, v.category
  FROM comments c
  JOIN occurrences o ON o.key = c.key
  JOIN videos v ON v.video_id = o.video_id
  WHERE c.key NOT IN (SELECT key FROM labels)
  GROUP BY c.key
`);

function queue(limit) {
  const byVideo = new Map();
  for (const row of queueRows.all()) {
    if (!byVideo.has(row.video_id)) byVideo.set(row.video_id, []);
    byVideo.get(row.video_id).push({
      key: row.key,
      text: row.text,
      isReply: !!row.is_reply,
      likesText: row.likes_text,
      agoText: row.ago_text,
      video: { id: row.video_id, title: row.title, category: row.category },
    });
  }
  const videos = [...byVideo.values()].sort(() => Math.random() - 0.5);
  return videos.flat().slice(0, limit);
}

const json = (res, body, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(err);
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(new URL('app.html', import.meta.url)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') {
      json(res, { items: queue(Number(url.searchParams.get('limit') ?? 200)), ...stats(db) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/label') {
      const { key, label, obfuscated } = await readBody(req);
      if (!key || !LABELS.includes(label)) return json(res, { error: 'bad label' }, 400);
      putLabel.run(key, label, obfuscated ? 1 : 0, new Date().toISOString());
      json(res, stats(db));
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/label') {
      const { key } = await readBody(req);
      dropLabel.run(key);
      json(res, stats(db));
      return;
    }

    json(res, { error: 'not found' }, 404);
  } catch (err) {
    json(res, { error: String(err.message ?? err) }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const { total, labeled } = stats(db);
  console.log(`labelling ${labeled}/${total} done — http://127.0.0.1:${PORT}`);
});
