/*
 * YouTube site adapter.
 *
 * The only file that knows about YouTube's markup. If the extension stops
 * working, start here. How each selector was found: docs/adapters/youtube.md
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const SELECTORS = {
    observerRoot: 'ytd-comments#comments ytd-item-section-renderer#sections > div#contents',
    comment: 'ytd-comment-thread-renderer', // replies use the same element
    text: '#content-text',
    permalink: 'a[href*="lc="]', // carries the comment id
    repliesRoot: 'ytd-comment-replies-renderer',
  };

  const REVEALED_CLASS = 'gari-revealed'; // must match hide.css
  const SEEN_ATTR = 'data-gari-seen';

  function readId(el) {
    const href = el.querySelector(SELECTORS.permalink)?.getAttribute('href');
    const match = href && href.match(/[?&]lc=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function toEntry(el) {
    return {
      id: readId(el) ?? '',
      text: el.querySelector(SELECTORS.text)?.textContent?.trim() ?? '',
      el,
      isReply: !!el.closest(SELECTORS.repliesRoot),
    };
  }

  /** @implements {SiteAdapter} */
  const youtube = {
    siteId: 'youtube',

    // Declared in manifest content_scripts[].css, not injected from here.
    hideStylesheet: 'src/hide.css',

    // Null until Polymer builds the comment section, which is well after
    // document_start. Callers are expected to retry.
    getObserverRoot() {
      return document.querySelector(SELECTORS.observerRoot);
    },

    // Skips nodes already returned once. YouTube never removes comment nodes,
    // so the attribute survives scrolling and sort changes.
    extractComments(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return [];

      const found = [];
      const take = (el) => {
        if (el.hasAttribute(SEEN_ATTR)) return;
        el.setAttribute(SEEN_ATTR, '1');
        found.push(toEntry(el));
      };

      if (node.matches?.(SELECTORS.comment)) take(node);
      node.querySelectorAll?.(SELECTORS.comment).forEach(take);
      return found;
    },

    reveal(entry) {
      entry.el.classList.add(REVEALED_CLASS);
    },

    collapse(entry, reason) {
      entry.el.classList.remove(REVEALED_CLASS);
      if (reason) entry.el.setAttribute('data-gari-reason', reason);
    },

    // Fires on first load as well as on video changes, so handlers must be
    // safe to run more than once.
    onNavigate(cb) {
      document.addEventListener('yt-navigate-finish', () => cb(location.href));
    },

    // Capture phase: children of a covered comment are display:none, so the
    // click lands on the thread element and must be stopped before YouTube's
    // own handlers run.
    onRevealRequest(cb) {
      document.addEventListener(
        'click',
        (e) => {
          const el = e.target instanceof Element ? e.target.closest(SELECTORS.comment) : null;
          if (!el || el.classList.contains(REVEALED_CLASS)) return;
          e.preventDefault();
          e.stopPropagation();
          cb(toEntry(el));
        },
        true,
      );
    },
  };

  Gari.adapters = Gari.adapters || {};
  Gari.adapters.youtube = youtube;
})();
