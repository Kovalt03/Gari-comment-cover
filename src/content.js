/*
 * Entry point. Wires an adapter to the pipeline and drives the observer.
 *
 * Hiding is done by hide.css; this decides what to open. If this script throws,
 * comments stay covered.
 */

'use strict';

(() => {
  const adapter = Gari.adapters.youtube;
  const { classify, Kind, Reason } = Gari.pipeline;
  const feedback = Gari.feedback;

  const log = (...args) => console.log('%c[gari]', 'color:#4a9', ...args);

  let seen = new Set(); // ids on the current page
  let observer = null;
  let watcher = null;
  let epoch = 0; // bumped on navigation; see handle()
  let video = null; // current video info, for collection only

  const verdicts = new WeakMap(); // element -> last pipeline verdict
  const userDecided = new WeakSet(); // elements the user covered, opened, or marked

  /* What the user is looking at, recorded with each feedback event so a label
   * can be read against what was on screen. */
  const View = Object.freeze({
    PENDING: 'pending', // covered, no verdict yet
    SHOWN: 'shown',
    UNVERIFIED: 'unverified',
    COVERED: 'covered', // with a reason
    PEEKED: 'peeked', // was covered, opened by the user
    FINE: 'fine',
  });
  const views = new WeakMap(); // element -> { view, reason? }
  const viewOf = (el) => views.get(el) ?? { view: View.PENDING };

  function apply(entry, verdict) {
    if (verdict.kind === Kind.PASS) {
      adapter.reveal(entry);
      views.set(entry.el, { view: View.SHOWN });
    } else if (verdict.kind === Kind.UNSURE) {
      adapter.reveal(entry, { unverified: true, offerFine: true });
      views.set(entry.el, { view: View.UNVERIFIED });
    } else {
      adapter.collapse(entry, verdict.reason);
      views.set(entry.el, { view: View.COVERED, reason: verdict.reason });
    }
  }

  async function handle(entry) {
    if (entry.id) seen.add(entry.id);
    const n = seen.size; // taken before awaiting, so log numbers stay in order
    const startedIn = epoch;
    const startedAt = performance.now();

    // The pipeline gets no element. Keep it that way.
    const verdict = await classify({ id: entry.id, text: entry.text });

    // The video can change while a verdict is in flight. Applying a stale one
    // would reveal or collapse a comment that belongs to a different page.
    if (startedIn !== epoch) return;

    verdicts.set(entry.el, verdict);
    collect(entry);

    // A late verdict must not undo what the user just did to this comment.
    if (!userDecided.has(entry.el)) apply(entry, verdict);

    Gari.metrics?.record(performance.now() - startedAt);

    log(
      `${n.toString().padStart(3)} ${entry.isReply ? '  └ reply' : 'comment'}`,
      `[${entry.id ? entry.id.slice(0, 12) : 'no id'}]`,
      verdict.kind + (verdict.reason ? `:${verdict.reason}` : ''),
      entry.text.slice(0, 50).replace(/\s+/g, ' ') || '(no text)',
    );
    if (verdict.reason === Reason.ERROR) log('layer error:', verdict.detail);
  }

  /* Development-only. The collector stores what the pipeline just saw, so the
   * dataset and the running filter share one extraction path. */
  function collect(entry) {
    if (!Gari.collector?.enabled) return false;
    return Gari.collector.add(
      { text: entry.text, isReply: entry.isReply, ...adapter.metaOf(entry) },
      video,
    );
  }

  async function refreshVideo() {
    video = await adapter.getVideoInfo();
  }

  /* Comments already on screen were processed before collection was switched
   * on, so the collector asks for a sweep. Failures here are silent otherwise:
   * this runs detached from the start() call. */
  /* Scrolls to the end of the loaded comments so YouTube fetches the next page.
   *
   * What matters is that the viewport travels. Measured on a live page: walking
   * down over several frames, or a smooth scroll, or stepping back and coming
   * down again all pull in the next twenty comments. Landing on the spot in one
   * jump does not, and neither do synthetic wheel or scroll events. An earlier
   * version called scrollIntoView on the last comment, which moved almost
   * nothing once the page was already near the end, and so loaded nothing.
   *
   * The continuation marker is not a scroll target either: it measures 0x0 with
   * a null offsetParent. It only tells us more comments exist. */
  Gari.collector?.onAutoScroll(async ({ pauseMs = 1500, quietRounds = 4, maxRounds = 400 } = {}) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    if (document.visibilityState !== 'visible') {
      log('auto scroll: tab is not visible, comments will not load');
    }
    if (!document.hasFocus()) {
      log('auto scroll: page has no focus. Click the page; the devtools console holds it otherwise');
    }

    // Back up a little, then walk down. The step back matters on later rounds,
    // when the page is already sitting at the bottom and has nowhere to travel.
    async function travel() {
      window.scrollBy(0, -600);
      await frame();
      for (let i = 0; i < 30; i++) {
        window.scrollBy(0, 300);
        await frame();
      }
    }

    let count = adapter.listComments().length;
    let quiet = 0;
    let rounds = 0;
    let stalledWithMarker = false;

    for (; rounds < maxRounds; rounds++) {
      if (!Gari.collector.scrolling) break; // stopScroll()
      if (Gari.collector.isVideoFull(video?.videoId)) break;

      await travel();
      await sleep(pauseMs);

      const now = adapter.listComments().length;
      if (now > count) {
        count = now;
        quiet = 0;
      } else if (++quiet >= quietRounds) {
        // A marker still on the page means more comments exist and simply are
        // not arriving, which is different from having reached the end.
        stalledWithMarker = !!adapter.getContinuationMarker();
        break;
      }
    }

    const result = { rounds, onPage: count, stalledWithMarker, ...Gari.collector.stats() };
    log('auto scroll done', result);
    if (stalledWithMarker) log('auto scroll: more comments exist but stopped arriving. Scroll by hand.');
    return result;
  });

  Gari.collector?.onStart(async () => {
    try {
      const entries = adapter.listComments();
      log('collector sweep: found', entries.length, 'on screen');

      if (!video) await refreshVideo();
      let added = 0;
      for (const entry of entries) if (collect(entry)) added += 1;

      log('collector sweep: added', added, 'video =', video?.videoId ?? 'none');
    } catch (err) {
      log('collector sweep failed:', err);
    }
  });

  function startObserving() {
    const root = adapter.getObserverRoot();
    if (!root) return false;

    observer?.disconnect();
    observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => adapter.extractComments(node).forEach(handle));
      }
    });
    observer.observe(root, { childList: true, subtree: true }); // subtree: replies nest

    adapter.extractComments(root).forEach(handle);
    log('observing');
    return true;
  }

  // The comment section is not in the initial HTML, so there is nothing to
  // observe at document_start. Waiting is the normal path, not an error case.
  function waitForRoot() {
    if (startObserving()) return;
    if (watcher) return; // keep a single waiter

    watcher = new MutationObserver(() => {
      if (!startObserving()) return;
      watcher.disconnect();
      watcher = null;
    });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
    log('waiting for comment section');
  }

  // Container nodes are reused across videos, so the observer stays; only the
  // per-page state is cleared.
  adapter.onNavigate(() => {
    log('navigate. reset state, previous comments:', seen.size);
    seen = new Set();
    epoch++; // invalidates verdicts still in flight
    refreshVideo();
    if (!observer) waitForRoot();
  });

  const { Action } = feedback;

  function note(entry, action) {
    feedback.record({
      id: entry.id,
      action,
      state: viewOf(entry.el),
      prior: verdicts.get(entry.el),
    });
    log(`user ${action}:`, entry.text.slice(0, 50).replace(/\s+/g, ' '));
  }

  // Opening a covered comment. Not a label on its own; the buttons shown after
  // opening are how the user says what they think.
  adapter.onRevealRequest((entry) => {
    note(entry, Action.PEEK);
    userDecided.add(entry.el);
    adapter.reveal(entry, { offerFine: true });
    views.set(entry.el, { view: View.PEEKED });
  });

  adapter.onFeedback((entry, action) => {
    note(entry, action);
    userDecided.add(entry.el);

    if (action === Action.HIDE) {
      adapter.collapse(entry, Reason.USER);
      views.set(entry.el, { view: View.COVERED, reason: Reason.USER });
    } else if (action === Action.FINE) {
      adapter.markFine(entry);
      views.set(entry.el, { view: View.FINE });
    }
  });

  log('loaded. readyState =', document.readyState);
  refreshVideo();
  waitForRoot();
})();
