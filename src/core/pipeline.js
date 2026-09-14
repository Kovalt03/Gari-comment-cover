/*
 * Site-agnostic decision layer.
 *
 * Takes an id and text, returns a verdict. Must never touch the DOM — that is
 * what makes it testable without a browser. Adapters handle everything else.
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  /* Always compare against these, never a string literal — a typo on Kind.PASS
   * is undefined and fails loudly, a typo in 'pass' silently matches nothing. */
  const Kind = Object.freeze({
    PASS: 'pass',
    HIDE: 'hide',
    UNSURE: 'unsure', // no layer objected; shown, marked unverified
  });

  const Reason = Object.freeze({
    DUMMY: 'dummy',
    TIMEOUT: 'timeout', // pipeline did not finish in time
    ERROR: 'error', // a layer threw
    USER: 'user', // covered by the user, not by a filter
  });

  /**
   * @typedef {{ id: string, text: string }} Candidate
   * @typedef {{ kind: Kind.PASS }
   *         | { kind: Kind.HIDE, reason: Reason, detail?: string }
   *         | { kind: Kind.UNSURE }} Verdict
   */

  const pass = () => ({ kind: Kind.PASS });
  const hide = (reason, detail) => ({ kind: Kind.HIDE, reason, detail });
  const unsure = () => ({ kind: Kind.UNSURE });

  const settings = {
    timeoutMs: 1000, // provisional; see docs/ARCHITECTURE.md section 8
  };

  /* Ordered layers, cheapest first. Each returns a Verdict or a Promise of one;
   * Kind.UNSURE falls through to the next.
   *
   * @type {Array<(c: Candidate) => Verdict | Promise<Verdict>>} */
  const layers = [];

  async function runLayers(candidate) {
    for (const layer of layers) {
      const verdict = await layer(candidate);
      if (verdict.kind !== Kind.UNSURE) return verdict;
    }
    return unsure();
  }

  /* Async even though the cheap layers are synchronous: L2 and L3 answer over
   * messaging. Callers must assume the page can change while a verdict is in
   * flight.
   *
   * Never rejects. A timeout or a thrown layer becomes a HIDE verdict: when the
   * pipeline could not finish, the comment stays covered.
   *
   * @param {Candidate} candidate
   * @returns {Promise<Verdict>} */
  async function classify(candidate) {
    const run = runLayers(candidate);
    run.catch(() => {}); // a layer failing after the timeout must not go unhandled

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(hide(Reason.TIMEOUT)), settings.timeoutMs);
    });

    try {
      return await Promise.race([run, timeout]);
    } catch (err) {
      return hide(Reason.ERROR, String(err?.message ?? err));
    } finally {
      clearTimeout(timer);
    }
  }

  Gari.pipeline = { classify, layers, settings, Kind, Reason, pass, hide, unsure };
})();
