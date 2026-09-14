/*
 * User feedback events.
 *
 * In memory only for now; persisted storage comes with personalization.
 * Holds ids and verdicts, not comment text (docs/PRIVACY.md).
 *
 * Inspect from the console (pick this extension's context in the dropdown):
 *   Gari.feedback.events
 */

'use strict';

globalThis.Gari = globalThis.Gari || {};

(() => {
  const Action = Object.freeze({
    HIDE: 'hide', // negative label
    FINE: 'fine', // positive label
    PEEK: 'peek', // opened a covered comment; curiosity or disagreement, not a label
  });

  /** @type {Array<{ id: string, action: string, state: object|null, prior: object|null, at: number }>} */
  const events = [];

  /**
   * @param {{ id: string, action: string, state?: object, prior?: object }} event
   *   state: what the user was looking at; prior: the pipeline verdict
   */
  function record({ id, action, state, prior }) {
    events.push({ id, action, state: state ?? null, prior: prior ?? null, at: Date.now() });
  }

  Gari.feedback = { Action, events, record };
})();
