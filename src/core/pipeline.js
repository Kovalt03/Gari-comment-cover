/*
 * Site-agnostic decision layer.
 *
 * Takes an id and text, returns a verdict. Must never touch the DOM — that is
 * what makes it testable without a browser. Adapters handle everything else.
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  /* Verdict kinds. Always compare against these, never a string literal —
   * a typo on Kind.PASS is undefined and fails loudly, while a typo in 'pass'
   * silently matches nothing.
   *
   * Reasons are plain strings until the first filter exists; there is nothing
   * to enumerate yet. */
  const Kind = Object.freeze({
    PASS: 'pass',
    HIDE: 'hide',
    UNSURE: 'unsure',
  });

  /**
   * @typedef {{ id: string, text: string }} Candidate
   * @typedef {{ kind: Kind.PASS }
   *         | { kind: Kind.HIDE, reason: string }
   *         | { kind: Kind.UNSURE }} Verdict
   */

  const pass = () => ({ kind: Kind.PASS });
  const hide = (reason) => ({ kind: Kind.HIDE, reason });
  const unsure = () => ({ kind: Kind.UNSURE });

  /* Ordered layers, cheapest first. Each returns a Verdict; Kind.UNSURE falls
   * through to the next one. Empty for now — the dummy filter and the L1 rules
   * go here. */
  const layers = [];

  /**
   * @param {Candidate} candidate
   * @returns {Verdict}
   */
  function classify(candidate) {
    for (const layer of layers) {
      const verdict = layer(candidate);
      if (verdict.kind !== Kind.UNSURE) return verdict;
    }
    // Nothing decided. Stays covered; never revealed on a guess.
    return unsure();
  }

  Gari.pipeline = { classify, layers, Kind, pass, hide, unsure };
})();
