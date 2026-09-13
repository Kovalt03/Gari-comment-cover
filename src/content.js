/*
 * Entry point. Wires an adapter to the pipeline and drives the observer.
 *
 * Hiding is done by hide.css; this only reveals. If this script throws,
 * comments stay covered.
 */

'use strict';

(() => {
  const adapter = Gari.adapters.youtube;
  const pipeline = Gari.pipeline;
  const { Kind } = pipeline;

  const log = (...args) => console.log('%c[gari]', 'color:#4a9', ...args);

  let seen = new Set(); // ids on the current page
  let observer = null;
  let watcher = null;

  function handle(entry) {
    if (entry.id) seen.add(entry.id);

    // The pipeline gets no element. Keep it that way.
    const verdict = pipeline.classify({ id: entry.id, text: entry.text });

    if (verdict.kind === Kind.PASS) adapter.reveal(entry);
    else if (verdict.kind === Kind.HIDE) adapter.collapse(entry, verdict.reason);
    // Kind.UNSURE leaves it covered

    log(
      `${seen.size.toString().padStart(3)} ${entry.isReply ? '  └ reply' : 'comment'}`,
      `[${entry.id ? entry.id.slice(0, 12) : 'no id'}]`,
      verdict.kind,
      entry.text.slice(0, 50).replace(/\s+/g, ' ') || '(no text)',
    );
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
    if (!observer) waitForRoot();
  });

  // Demo behaviour: any covered comment opens on click.
  adapter.onRevealRequest((entry) => {
    adapter.reveal(entry);
    log('revealed:', entry.text.slice(0, 50).replace(/\s+/g, ' '));
  });

  log('loaded. readyState =', document.readyState);
  waitForRoot();
})();
