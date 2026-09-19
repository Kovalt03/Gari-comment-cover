// Collection rules that were decided deliberately: dedup by normalized text,
// a per-video cap, and no comment ids in the output.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
for (const f of ['src/core/normalize.js', 'src/core/collector.js']) {
  vm.runInThisContext(readFileSync(new URL(f, root), 'utf8'), { filename: f });
}
const collector = Gari.collector;
const video = (videoId) => ({ videoId, title: `t-${videoId}`, description: '', keywords: [], category: 'Music' });

beforeEach(() => {
  collector.reset();
  collector.config.perVideoLimit = 50;
  collector.start();
});

test('nothing is stored while stopped', () => {
  collector.stop();
  assert.equal(collector.add({ text: 'hello' }, video('v1')), false);
  assert.equal(collector.stats().unique, 0);
});

test('the same text is stored once and counted', () => {
  collector.add({ text: '1등' }, video('v1'));
  collector.add({ text: '1등' }, video('v1'));
  const { unique, total, repeated } = collector.stats();
  assert.deepEqual([unique, total, repeated], [1, 2, 1]);
});

test('dedup ignores invisible characters and spacing', () => {
  collector.add({ text: '  좋은 영상  ' }, video('v1'));
  collector.add({ text: '좋은​ 영상' }, video('v1'));
  assert.equal(collector.stats().unique, 1);
});

test('a repeat from another video records both videos', () => {
  collector.add({ text: '구독하고 가세요' }, video('v1'));
  collector.add({ text: '구독하고 가세요' }, video('v2'));
  const [row] = JSON.parse(collector.toJSON()).comments;
  assert.deepEqual(row.videos, ['v1', 'v2']);
  assert.equal(row.count, 2);
});

test('empty and whitespace-only comments are skipped', () => {
  assert.equal(collector.add({ text: '   ' }, video('v1')), false);
  assert.equal(collector.stats().unique, 0);
});

test('emoji-only comments are kept', () => {
  collector.add({ text: '🤡🤡' }, video('v1'));
  assert.equal(collector.stats().unique, 1);
});

test('the per-video cap stops one video from dominating', () => {
  collector.config.perVideoLimit = 3;
  for (let i = 0; i < 10; i++) collector.add({ text: `comment ${i}` }, video('v1'));
  for (let i = 0; i < 2; i++) collector.add({ text: `other ${i}` }, video('v2'));
  assert.deepEqual(collector.stats().perVideo, { v1: 3, v2: 2 });
});

test('a capped video still counts repeats of text already stored', () => {
  collector.config.perVideoLimit = 1;
  collector.add({ text: 'first' }, video('v1'));
  collector.add({ text: 'second' }, video('v1')); // over the cap, dropped
  collector.add({ text: 'first' }, video('v1')); // already stored, counts
  const { unique, total } = collector.stats();
  assert.deepEqual([unique, total], [1, 2]);
});

test('output keeps the original text, not the normalized key', () => {
  collector.add({ text: '  띄어쓰기   그대로  ' }, video('v1'));
  const [row] = JSON.parse(collector.toJSON()).comments;
  assert.equal(row.text, '  띄어쓰기   그대로  ');
});

test('output carries video metadata and no comment ids', () => {
  collector.add({ text: 'hello', isReply: true, likesText: '31만', agoText: '1년 전' }, video('v1'));
  const out = JSON.parse(collector.toJSON());
  assert.deepEqual(out.videos[0], video('v1'));
  assert.deepEqual(Object.keys(out.comments[0]).sort(), ['agoText', 'count', 'isReply', 'likesText', 'text', 'videos']);
});
