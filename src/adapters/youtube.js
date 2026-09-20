/*
 * YouTube site adapter.
 *
 * The only file that knows about YouTube's markup. If the extension stops
 * working, start here. How each selector was found: docs/adapters/youtube.md
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const { Reason } = Gari.pipeline;
  const { Action } = Gari.feedback;

  const SELECTORS = {
    observerRoot: 'ytd-comments#comments ytd-item-section-renderer#sections > div#contents',
    comment: 'ytd-comment-thread-renderer', // replies use the same element
    text: '#content-text',
    permalink: 'a[href*="lc="]', // carries the comment id
    repliesRoot: 'ytd-comment-replies-renderer',
    // Scoped to the thread's own comment so a parent never picks up a reply's toolbar
    toolbar: ':scope > #comment-container #action-buttons #toolbar',
    // Collection only. Both are display strings: "31만", "1년 전". YouTube does
    // not put exact counts or absolute times in the DOM.
    votes: ':scope > #comment-container #vote-count-middle',
    published: ':scope > #comment-container #published-time-text a',
    continuation: 'ytd-comments#comments ytd-continuation-item-renderer',
  };

  // Matches src/adapters/youtube-page.js
  const PAGE_REQUEST = 'gari:video-request';
  const PAGE_REPLY = 'gari:video';

  // Class and attribute names below must match hide.css
  const REVEALED_CLASS = 'gari-revealed';
  const ACTIONS_CLASS = 'gari-actions';
  const ATTR = {
    seen: 'data-gari-seen',
    reason: 'data-gari-reason',
    label: 'data-gari-label',
    unverified: 'data-gari-unverified',
    action: 'data-gari-action',
  };

  // User-facing text. Move to _locales/ when i18n is added.
  const LABELS = {
    [Reason.DUMMY]: 'Covered by test filter',
    [Reason.TIMEOUT]: 'Filter timed out',
    [Reason.ERROR]: 'Filter error',
    [Reason.USER]: 'Covered by you',
  };
  const BUTTON_TEXT = {
    [Action.HIDE]: 'Hide',
    [Action.FINE]: 'Looks fine',
  };
  const FINE_DONE_TEXT = 'Marked fine';

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

  function actionButton(action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(ATTR.action, action);
    button.textContent = BUTTON_TEXT[action];
    return button;
  }

  // Inserted into YouTube's own toolbar, next to the reply button. Confirmed to
  // survive scrolling and sort changes; rebuilt on every reveal in case a
  // re-render drops it.
  function renderActions(el, { offerFine }) {
    const toolbar = el.querySelector(SELECTORS.toolbar);
    if (!toolbar) return;

    let box = toolbar.querySelector(`:scope > .${ACTIONS_CLASS}`);
    if (!box) {
      box = document.createElement('span');
      box.className = ACTIONS_CLASS;
      toolbar.appendChild(box);
    }
    box.replaceChildren(
      actionButton(Action.HIDE),
      ...(offerFine ? [actionButton(Action.FINE)] : []),
    );
  }

  function closestComment(target) {
    return target instanceof Element ? target.closest(SELECTORS.comment) : null;
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
        if (el.hasAttribute(ATTR.seen)) return;
        el.setAttribute(ATTR.seen, '1');
        found.push(toEntry(el));
      };

      if (node.matches?.(SELECTORS.comment)) take(node);
      node.querySelectorAll?.(SELECTORS.comment).forEach(take);
      return found;
    },

    /**
     * @param {{ unverified?: boolean, offerFine?: boolean }} [options]
     *   unverified: mark the text as not confirmed by any layer
     *   offerFine: show the "Looks fine" button next to "Hide"
     */
    /* Signals that more comments exist. Not a scroll target: it measures 0x0
     * with a null offsetParent, so scrolling to it moves nothing. */
    getContinuationMarker() {
      return document.querySelector(SELECTORS.continuation);
    },

    // Every comment currently in the DOM, ignoring the seen marker. For the
    // collector's sweep; the pipeline uses extractComments instead.
    listComments() {
      return [...document.querySelectorAll(SELECTORS.comment)].map(toEntry);
    },

    reveal(entry, { unverified = false, offerFine = false } = {}) {
      const { el } = entry;
      el.removeAttribute(ATTR.reason);
      el.removeAttribute(ATTR.label);
      el.toggleAttribute(ATTR.unverified, unverified);
      el.classList.add(REVEALED_CLASS);
      renderActions(el, { offerFine });
    },

    // User said the comment is fine. Drops the unverified mark and turns the
    // button into a disabled confirmation.
    markFine(entry) {
      const { el } = entry;
      el.removeAttribute(ATTR.unverified);
      const button = el.querySelector(`${SELECTORS.toolbar} [${ATTR.action}="${Action.FINE}"]`);
      if (!button) return;
      button.disabled = true;
      button.textContent = FINE_DONE_TEXT;
    },

    collapse(entry, reason) {
      const { el } = entry;
      el.classList.remove(REVEALED_CLASS);
      el.removeAttribute(ATTR.unverified);
      el.setAttribute(ATTR.reason, reason);
      el.setAttribute(ATTR.label, LABELS[reason] ?? 'Covered');
    },

    // Collection only: approximate, locale-dependent display strings.
    metaOf(entry) {
      return {
        likesText: entry.el.querySelector(SELECTORS.votes)?.textContent?.trim() ?? '',
        agoText: entry.el.querySelector(SELECTORS.published)?.textContent?.trim() ?? '',
      };
    },

    /* Asks the page-world script for the current video. The page could reply
     * with anything, so this is used for collection, never for a verdict. */
    getVideoInfo(timeoutMs = 1000) {
      return new Promise((resolve) => {
        const done = (video) => {
          window.removeEventListener('message', onMessage);
          clearTimeout(timer);
          resolve(video);
        };
        const onMessage = (event) => {
          if (event.source !== window || event.data?.type !== PAGE_REPLY) return;
          done(event.data.video ?? null);
        };
        const timer = setTimeout(() => done(null), timeoutMs);

        window.addEventListener('message', onMessage);
        window.postMessage({ type: PAGE_REQUEST }, '*');
      });
    },

    // Fires on first load as well as on video changes, so handlers must be
    // safe to run more than once.
    onNavigate(cb) {
      document.addEventListener('yt-navigate-finish', () => cb(location.href));
    },

    // Click on a covered comment. Capture phase: its children are display:none,
    // so the click lands on the thread element and must be stopped before
    // YouTube's own handlers run.
    onRevealRequest(cb) {
      document.addEventListener(
        'click',
        (e) => {
          const el = closestComment(e.target);
          if (!el || el.classList.contains(REVEALED_CLASS)) return;
          e.preventDefault();
          e.stopPropagation();
          cb(toEntry(el));
        },
        true,
      );
    },

    // Click on one of the action buttons of a visible comment.
    // cb receives the entry and a Gari.feedback.Action.
    onFeedback(cb) {
      document.addEventListener(
        'click',
        (e) => {
          const button = e.target instanceof Element ? e.target.closest(`[${ATTR.action}]`) : null;
          if (!button) return;
          const el = closestComment(button);
          if (!el) return;
          e.preventDefault();
          e.stopPropagation();
          cb(toEntry(el), button.getAttribute(ATTR.action));
        },
        true,
      );
    },
  };

  Gari.adapters = Gari.adapters || {};
  Gari.adapters.youtube = youtube;
})();
