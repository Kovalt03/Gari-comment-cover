/*
 * Day 4 only. Decides at random so the full path can be exercised before any
 * real filter exists. Remove once L1 rules land.
 *
 * Tunable from the console (pick this extension's context in the dropdown):
 *   Gari.dummyFilter.delayMs = 1500   // every comment times out
 *   Gari.dummyFilter.throwRatio = 0.2 // some comments hit the error path
 *   Gari.dummyFilter.enabled = false  // everything unsure, shown as unverified
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const { pass, hide, unsure, Reason } = Gari.pipeline;

  // Splits the unit interval: [0, hide) hide, [hide, hide+unsure) unsure, rest pass
  const config = {
    enabled: true,
    hideRatio: 1 / 3,
    unsureRatio: 1 / 3,
    delayMs: 0, // stands in for model inference latency; > timeoutMs to test timeouts
    throwRatio: 0, // set above 0 to test the error path
  };

  /* Deterministic per id, so a reload produces the same split and two runs can
   * be compared. Math.random would change the answer every time. */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  Gari.pipeline.layers.push(async (candidate) => {
    if (!config.enabled) return unsure();
    if (config.delayMs > 0) await sleep(config.delayMs);

    const x = hash(candidate.id || candidate.text);
    if (x < config.throwRatio) throw new Error('dummy layer failure');
    if (x < config.hideRatio) return hide(Reason.DUMMY);
    if (x < config.hideRatio + config.unsureRatio) return unsure();
    return pass();
  });

  Gari.dummyFilter = config;
})();
