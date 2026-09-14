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
  waitForRoot();
})();
