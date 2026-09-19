/*
 * Runs in the page's own world (manifest world: "MAIN"), which is the only way
 * to reach YouTube's player data. Content scripts share the DOM but not the
 * page's JavaScript, so title, category and keywords are out of reach from
 * there.
 *
 * Everything here is read-only. It answers requests from the content script and
 * announces page changes.
 */

'use strict';

(() => {
  const REQUEST = 'gari:video-request';
  const REPLY = 'gari:video';

  function readVideo() {
    /* ytd-watch-flexy carries the data for the video actually on screen.
     * window.ytInitialPlayerResponse is only correct for the first page load:
     * after an in-page navigation it still describes the previous video. */
    const flexy = document.querySelector('ytd-watch-flexy');
    const player = flexy?.playerData ?? window.ytInitialPlayerResponse;
    const details = player?.videoDetails;
    if (!details) return null;

    return {
      videoId: details.videoId ?? null,
      title: details.title ?? '',
      description: details.shortDescription ?? '',
      keywords: details.keywords ?? [],
      category: player?.microformat?.playerMicroformatRenderer?.category ?? null,
    };
  }

  const announce = () => window.postMessage({ type: REPLY, video: readVideo() }, '*');

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== REQUEST) return;
    announce();
  });

  document.addEventListener('yt-page-data-updated', announce);
})();
