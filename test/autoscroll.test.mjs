// The scroller drives real DOM: it reads entries from the adapter, scrolls, and
// waits for YouTube to append more comments. A previous version treated those
// entries as elements and threw on the first round, which no unit test caught
// because nothing exercised the wiring.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const root = new URL('..', import.meta.url);

const thread = (id) => `
  <ytd-comment-thread-renderer>
    <div id="comment-container">
      <ytd-comment-view-model id="comment"><div id="body"><div id="main">
        <a href="/watch?v=v&lc=${id}">t</a>
        <yt-attributed-string id="content-text">comment ${id}</yt-attributed-string>
        <ytd-comment-engagement-bar id="action-buttons"><div id="toolbar"></div></ytd-comment-engagement-bar>
      </div></div></ytd-comment-view-model>
    </div>
    <div id="replies"></div>
  </ytd-comment-thread-renderer>`;

let window;
let G;
let appended;

before(() => {
  ({ window } = new JSDOM(
    `<ytd-comments id="comments"><ytd-item-section-renderer id="sections"><div id="contents"></div>` +
      `<ytd-continuation-item-renderer></ytd-continuation-item-renderer></ytd-item-section-renderer></ytd-comments>`,
    { runScripts: 'outside-only', url: 'https://www.youtube.com/watch?v=v', pretendToBeVisual: true },
  ));
  window.console = { log() {}, warn() {} };
  // Run the animation frames immediately; the scroller walks 30 of them a round
  window.requestAnimationFrame = (cb) => window.setTimeout(cb, 0);

  for (const f of ['src/core/pipeline.js', 'src/core/normalize.js', 'src/core/feedback.js', 'src/core/collector.js', 'src/adapters/youtube.js', 'src/content.js']) {
    window.eval(readFileSync(new URL(f, root), 'utf8'));
  }
  G = window.Gari;
  // No page-world script in jsdom, so skip the postMessage round trip
  G.adapters.youtube.getVideoInfo = async () => ({ videoId: 'v1', title: 't', description: '', keywords: [], category: null });
});

beforeEach(() => {
  G.collector.stop();
  G.collector.reset();
  G.collector.config.perVideoLimit = 50;
  appended = 0;

  const contents = window.document.querySelector('#contents');
  contents.replaceChildren();
  contents.insertAdjacentHTML('beforeend', thread('a1') + thread('a2'));

  /* Stands in for YouTube: a round of scrolling brings in two more comments,
   * and after three rounds the comments run out. */
  let steps = 0;
  window.scrollBy = () => {
    if (++steps % 31 !== 0 || appended >= 3) return;
    appended += 1;
    contents.insertAdjacentHTML('beforeend', thread(`b${appended}1`) + thread(`b${appended}2`));
  };
  window.scrollTo = () => {};
});

const options = { pauseMs: 5, quietRounds: 2, maxRounds: 10 };

test('scrolling collects the comments that arrive', async () => {
  G.collector.start(); // sweeps the two already on the page
  const result = await G.collector.autoScroll(options);

  assert.equal(result.onPage, 8); // 2 to start, 2 per round for three rounds
  assert.equal(result.unique, 8);
  assert.equal(appended, 3);
});

test('it stops once nothing new arrives, and says the comments ran out', async () => {
  G.collector.start();
  const result = await G.collector.autoScroll(options);

  assert.ok(result.rounds < options.maxRounds); // stopped on its own
  assert.equal(result.stalledWithMarker, true); // this page keeps its marker
});

test('it stops at the per-video cap instead of paging on', async () => {
  G.collector.config.perVideoLimit = 4;
  G.collector.start();
  const result = await G.collector.autoScroll(options);

  assert.equal(result.unique, 4);
  assert.ok(appended < 3, `stopped early, appended ${appended}`);
});

test('a second scroller cannot start while one is running', async () => {
  G.collector.start();
  const first = G.collector.autoScroll(options);
  assert.equal(await G.collector.autoScroll(options), null);
  await first;
  assert.equal(G.collector.scrolling, false);
});

test('stopScroll ends the loop', async () => {
  G.collector.start();
  const running = G.collector.autoScroll({ ...options, pauseMs: 30, maxRounds: 100 });
  G.collector.stopScroll();
  const result = await running;
  assert.ok(result.rounds < 100);
});
