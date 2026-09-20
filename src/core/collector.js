/*
 * Development-only collection mode. Off unless turned on.
 *
 * Builds the labelling dataset out of the comments the extension already
 * extracts, so the stored text is exactly the text the filter judges at run
 * time. Collecting through a separate path would make evaluation scores
 * describe something the product never sees.
 *
 * Collected data stays on this machine (docs/PRIVACY.md section 8).
 *
 * From the console (pick this extension's context in the dropdown):
 *   Gari.collector.start()      then browse, scrolling through comments
 *   Gari.collector.stats()
 *   Gari.collector.save()       downloads JSON
 *   Gari.collector.stop()
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const { basic } = Gari.normalize;

  const config = {
    perVideoLimit: 50, // keeps one talkative video from dominating the set
  };

  let enabled = false;
  let onStartCb = null;
  let onAutoScrollCb = null;
  let scrolling = false;
  const comments = new Map(); // normalized text -> record
  const videos = new Map(); // videoId -> video info
  const perVideo = new Map(); // videoId -> count

  /* Same text is stored once with a count. Repetition is itself a spam signal,
   * so it is kept, but one row per copy would put identical text on both sides
   * of a train/test split. */
  function add(comment, video) {
    if (!enabled) return false;

    const key = basic(comment.text);
    if (!key) return false;

    const videoId = video?.videoId ?? null;
    const existing = comments.get(key);

    if (!existing && videoId && (perVideo.get(videoId) ?? 0) >= config.perVideoLimit) return false;

    if (video && videoId && !videos.has(videoId)) videos.set(videoId, video);

    if (existing) {
      existing.count += 1;
      if (videoId && !existing.videos.includes(videoId)) existing.videos.push(videoId);
      return false;
    }

    comments.set(key, {
      text: comment.text, // original, not the key
      count: 1,
      isReply: !!comment.isReply,
      likesText: comment.likesText ?? '',
      agoText: comment.agoText ?? '',
      videos: videoId ? [videoId] : [],
    });
    if (videoId) perVideo.set(videoId, (perVideo.get(videoId) ?? 0) + 1);
    return true;
  }

  // Lets the scroller stop instead of paging through comments that will be dropped
  function isVideoFull(videoId) {
    return !!videoId && (perVideo.get(videoId) ?? 0) >= config.perVideoLimit;
  }

  function stats() {
    const rows = [...comments.values()];
    return {
      unique: rows.length,
      total: rows.reduce((sum, r) => sum + r.count, 0),
      replies: rows.filter((r) => r.isReply).length,
      repeated: rows.filter((r) => r.count > 1).length,
      videos: videos.size,
      perVideo: Object.fromEntries(perVideo),
    };
  }

  /* Comment ids are left out on purpose. They identify a specific post by a
   * specific account, and nothing in labelling or evaluation needs them. */
  function toJSON() {
    return JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        note: 'likesText and agoText are display strings, not exact values',
        videos: [...videos.values()],
        comments: [...comments.values()],
      },
      null,
      2,
    );
  }

  function save(filename = `comments-${new Date().toISOString().slice(0, 10)}.json`) {
    const json = toJSON();
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return stats();
    } catch (err) {
      // Downloads can be blocked; the text is still right here.
      console.warn('[gari] download failed, copy the JSON below', err);
      console.log(json);
      return stats();
    }
  }

  Gari.collector = {
    config,
    add,
    stats,
    isVideoFull,
    get scrolling() {
      return scrolling;
    },
    toJSON,
    save,
    get enabled() {
      return enabled;
    },
    /* Called when collection starts. Comments already on screen were processed
     * before it was on, so something has to go back for them. */
    onStart(cb) {
      onStartCb = cb;
    },

    /* Scrolling belongs to the adapter side; the core only holds the handle.
     * YouTube loads about twenty comments per page, so reaching a few hundred by
     * hand means hundreds of scrolls. */
    onAutoScroll(cb) {
      onAutoScrollCb = cb;
    },
    async autoScroll(options) {
      if (!onAutoScrollCb) {
        console.warn('[gari] no scroller registered');
        return null;
      }
      if (scrolling) {
        console.warn('[gari] already scrolling');
        return null;
      }
      scrolling = true;
      try {
        return await onAutoScrollCb(options ?? {});
      } finally {
        scrolling = false;
      }
    },
    stopScroll() {
      scrolling = false;
    },
    start() {
      enabled = true;
      onStartCb?.();
      console.log('%c[gari] collecting', 'color:#4a9', stats());
    },
    stop() {
      enabled = false;
      console.log('%c[gari] stopped', 'color:#4a9', stats());
    },
    reset() {
      comments.clear();
      videos.clear();
      perVideo.clear();
    },
  };
})();
