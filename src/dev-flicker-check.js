/*
 * Dev only. Flags any frame where a covered comment's body is laid out, which
 * is what a hide-too-late bug would look like.
 *
 * Add to content_scripts[].js in manifest.json, reload, watch the console.
 * Remove when done — this runs every frame.
 */

'use strict';

(() => {
  let frames = 0;
  let violations = 0;
  const reported = new Set();

  function check() {
    frames++;

    for (const thread of document.querySelectorAll(
      'ytd-comment-thread-renderer:not(.gari-revealed)'
    )) {
      const body = thread.querySelector('#content-text');
      // Non-null offsetParent means it has a box in the layout tree. This is a
      // proxy for "was painted", not proof of it — false negatives are unlikely,
      // false positives are possible.
      if (!body || body.offsetParent === null) continue;

      violations++;
      const text = body.textContent.trim().slice(0, 40);
      if (reported.has(text)) continue;
      reported.add(text);

      console.warn(
        '%c[gari] EXPOSED',
        'color:#e55;font-weight:bold',
        `frame ${frames}`,
        `"${text}"`,
        thread
      );
    }

    requestAnimationFrame(check);
  }

  requestAnimationFrame(check);

  setInterval(() => {
    console.log(
      '%c[gari] flicker check',
      'color:#4a9',
      `${frames} frames checked, ${violations} exposures`,
      violations === 0 ? '(pass)' : '(fail — see warnings above)'
    );
  }, 10000);

  console.log('%c[gari] flicker checker on', 'color:#4a9');
})();
