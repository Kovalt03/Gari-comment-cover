// Core pipeline: runs in plain Node, no DOM. That it can is the point of the
// core/adapter split.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
for (const f of ['src/core/pipeline.js', 'src/core/feedback.js']) {
  vm.runInThisContext(readFileSync(new URL(f, root), 'utf8'), { filename: f });
}

const { classify, layers, settings, Kind, Reason, pass, hide, unsure } = Gari.pipeline;
const candidate = { id: 'x', text: 't' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  layers.length = 0;
  settings.timeoutMs = 100;
});

test('no layers gives unsure', async () => {
  assert.deepEqual(await classify(candidate), { kind: Kind.UNSURE });
});

test('unsure falls through to the next layer', async () => {
  layers.push(() => unsure(), () => pass());
  assert.equal((await classify(candidate)).kind, Kind.PASS);
});

test('first decision wins and later layers do not run', async () => {
  layers.push(() => hide(Reason.DUMMY), () => { throw new Error('must not run'); });
  assert.equal((await classify(candidate)).kind, Kind.HIDE);
});

test('a slow layer becomes a timeout', async () => {
  layers.push(async () => { await sleep(300); return pass(); });
  const verdict = await classify(candidate);
  assert.equal(verdict.kind, Kind.HIDE);
  assert.equal(verdict.reason, Reason.TIMEOUT);
});

test('a throwing layer becomes an error verdict', async () => {
  layers.push(() => { throw new Error('boom'); });
  const verdict = await classify(candidate);
  assert.deepEqual([verdict.kind, verdict.reason, verdict.detail], [Kind.HIDE, Reason.ERROR, 'boom']);
});

test('a layer that throws after the timeout does not go unhandled', async () => {
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);

  layers.push(async () => { await sleep(200); throw new Error('late'); });
  assert.equal((await classify(candidate)).reason, Reason.TIMEOUT);
  await sleep(250);

  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, null);
});

test('feedback events hold no comment text', () => {
  Gari.feedback.record({ id: 'x', action: Gari.feedback.Action.HIDE, prior: { kind: Kind.PASS } });
  assert.deepEqual(Object.keys(Gari.feedback.events.at(-1)).sort(), ['action', 'at', 'id', 'prior', 'state']);
});
