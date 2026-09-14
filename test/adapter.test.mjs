// YouTube adapter and content.js wiring, against markup that mirrors the live
// page (docs/adapters/youtube.md section 1). Tests run in order and share state.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const root = new URL('..', import.meta.url);

const thread = (id, text, replies = '') => `
  <ytd-comment-thread-renderer>
    <div id="comment-container">
      <ytd-comment-view-model id="comment"><div id="body"><div id="main">
        <a href="/watch?v=v&lc=${id}">t</a>
        <yt-attributed-string id="content-text">${text}</yt-attributed-string>
        <ytd-comment-engagement-bar id="action-buttons"><div id="toolbar">
          <ytd-button-renderer id="reply-button-end"></ytd-button-renderer>
        </div></ytd-comment-engagement-bar>
      </div></div></ytd-comment-view-model>
    </div>
    <div id="replies">${replies && `<ytd-comment-replies-renderer>${replies}</ytd-comment-replies-renderer>`}</div>
  </ytd-comment-thread-renderer>`;

let window, G;
const byId = (id) =>
  [...window.document.querySelectorAll('ytd-comment-thread-renderer')]
    .find((t) => t.querySelector(':scope > #comment-container a').href.includes(`lc=${id}`));
const buttons = (el) =>
  [...el.querySelectorAll(':scope > #comment-container .gari-actions > button')]
    .map((b) => b.getAttribute('data-gari-action') + (b.disabled ? ':disabled' : ''));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tick = () => new Promise((r) => setTimeout(r, 20));

before(async () => {
  ({ window } = new JSDOM(
    `<ytd-comments id="comments"><ytd-item-section-renderer id="sections"><div id="contents"></div></ytd-item-section-renderer></ytd-comments>`,
    { runScripts: 'outside-only', url: 'https://www.youtube.com/watch?v=v' },
  ));
  window.console = { log() {}, warn() {} };

  // Same order as manifest.json, minus the dummy filter
  for (const f of ['src/core/pipeline.js', 'src/core/feedback.js', 'src/adapters/youtube.js', 'src/content.js']) {
    window.eval(readFileSync(new URL(f, root), 'utf8'));
  }
  G = window.Gari;

  const { pass, unsure, hide, Reason } = G.pipeline;
  const plan = { pass1: pass(), unsure1: unsure(), hide1: hide(Reason.DUMMY), reply1: unsure() };
  G.pipeline.layers.push(({ id }) => plan[id]);

  window.document.querySelector('#contents').insertAdjacentHTML(
    'beforeend',
    thread('pass1', 'hello') + thread('unsure1', 'maybe') + thread('hide1', 'nope', thread('reply1', 'a reply')),
  );
  await tick();
});

test('pass is shown with Hide only', () => {
  const el = byId('pass1');
  assert.ok(el.classList.contains('gari-revealed'));
  assert.deepEqual(buttons(el), ['hide']);
});

test('unsure is shown, marked unverified, with Hide and Looks fine', () => {
  const el = byId('unsure1');
  assert.ok(el.classList.contains('gari-revealed'));
  assert.ok(el.hasAttribute('data-gari-unverified'));
  assert.deepEqual(buttons(el), ['hide', 'fine']);
});

test('hide is covered and labelled with the reason', () => {
  const el = byId('hide1');
  assert.ok(!el.classList.contains('gari-revealed'));
  assert.equal(el.getAttribute('data-gari-label'), 'Covered by test filter');
});

test('a reply gets its own buttons and the parent does not take them', () => {
  assert.deepEqual(buttons(byId('reply1')), ['hide', 'fine']);
  assert.deepEqual(buttons(byId('hide1')), []);
});

test('Looks fine drops the unverified mark and disables the button', () => {
  const el = byId('unsure1');
  click(el.querySelector('[data-gari-action="fine"]'));
  assert.ok(!el.hasAttribute('data-gari-unverified'));
  assert.deepEqual(buttons(el), ['hide', 'fine:disabled']);
});

test('opening a covered comment offers Hide and Looks fine', () => {
  const el = byId('hide1');
  click(el);
  assert.ok(el.classList.contains('gari-revealed'));
  assert.deepEqual(buttons(el), ['hide', 'fine']);
});

test('Hide on a shown comment covers it as the user', () => {
  const el = byId('pass1');
  click(el.querySelector('[data-gari-action="hide"]'));
  assert.ok(!el.classList.contains('gari-revealed'));
  assert.equal(el.getAttribute('data-gari-label'), 'Covered by you');
});

test('events record what was on screen at the time', () => {
  // Round-trip through JSON: these arrays come from the jsdom realm, and strict
  // deep equality also compares prototypes.
  const seen = JSON.parse(JSON.stringify(
    G.feedback.events.map((e) => [e.id, e.action, e.state.view, e.state.reason ?? null]),
  ));
  assert.deepEqual(seen, [
    ['unsure1', 'fine', 'unverified', null],
    ['hide1', 'peek', 'covered', 'dummy'],
    ['pass1', 'hide', 'shown', null],
  ]);
});

test('events hold no comment text', () => {
  const json = JSON.stringify(G.feedback.events);
  for (const text of ['hello', 'maybe', 'nope']) assert.ok(!json.includes(text));
});
