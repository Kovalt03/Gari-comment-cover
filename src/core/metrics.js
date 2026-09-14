/*
 * Measurement for Day 4. Latency from "comment node seen" to "verdict applied",
 * plus cumulative layout shift caused by revealing comments.
 *
 * Read it from the console (pick this extension's context in the dropdown):
 *   Gari.metrics.report()
 *   Gari.metrics.reset()
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const WARMUP = 5; // dropped from the summary; first runs include setup cost

  let latencies = [];
  let shift = 0;

  /* Layout shift is the numeric version of "the page jumps". Entries within
   * 500ms of a click or keypress are skipped (hadRecentInput), which covers
   * click-to-reveal. Scrolling does not count as input, and YouTube's own
   * shifts are included — compare with a run where the dummy filter is off. */
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) shift += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // layout-shift is not available everywhere; the rest still works
    }
  }

  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  function report() {
    const sample = latencies.slice(WARMUP).sort((a, b) => a - b);
    if (!sample.length) {
      console.log('%c[gari] metrics', 'color:#4a9', `not enough samples (${latencies.length})`);
      return null;
    }

    const out = {
      samples: sample.length,
      median: +percentile(sample, 0.5).toFixed(1),
      p95: +percentile(sample, 0.95).toFixed(1),
      max: +sample[sample.length - 1].toFixed(1),
      layoutShift: +shift.toFixed(4),
    };
    console.table(out);
    return out;
  }

  Gari.metrics = {
    record: (ms) => latencies.push(ms),
    report,
    reset: () => {
      latencies = [];
      shift = 0;
    },
  };
})();
