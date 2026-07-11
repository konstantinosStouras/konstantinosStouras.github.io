/* ==========================================================================
   search-v2  ·  Search for Knowledge, with and without AI
   config.js  ·  Single source of truth for every tunable constant.

   This file is loaded both in the browser (as window.CONFIG) and in Node
   (require('../config.js') from tools/generate_pool.js and tools/selftest.js),
   so the offline pool generator and the live app never disagree on a constant.
   Change a value HERE and nowhere else.
   ========================================================================== */
(function (root, factory) {
  var CONFIG = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG; // Node
  if (root) root.CONFIG = CONFIG;                                               // browser
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  return {
    // ---- task rules (identical in both arms) -----------------------------
    N_POSITIONS: 100,   // line length: positions 1..100
    L_STEP: 10,         // max step between adjacent true values, in cents
    REVEAL_COST: 5,     // cents charged per reveal
    N_TASKS: 1,         // number of real (paid-eligible) rounds PER PHASE (admin-overridable)
    N_PRACTICE: 0,      // number of unpaid practice rounds (0 or 1; admin-overridable)
    PAID_TASKS: 2,      // rounds drawn for payment at the end

    // ---- deterministic ground truth --------------------------------------
    // The hidden prize curve is a bounded random walk (Brownian-like) generated
    // AT RUNTIME (landscape.js), seeded so that it is IDENTICAL for every
    // participant of every session, DIFFERENT between the Without-AI (arm A) and
    // With-AI (arm B) phases, and an INDEPENDENT fresh draw for each round within
    // a phase. Change TRUTH_SEED to reshuffle every curve at once.
    TRUTH_SEED: 20260711,

    // ---- assistant (Arm B only) ------------------------------------------
    // The interval(s) where the assistant's training data lives ("interpolation
    // regions"). Inside them it INTERPOLATES between its nearest training points
    // (accurate, the true curve is locally smooth); outside/between them it
    // EXTRAPOLATES linearly along the nearest edge (confident but increasingly
    // wrong). Admin-overridable per session (one or two regions); this is the
    // built-in default. See landscape.js / assistant.js.
    COVERAGE_PATCHES: [[30, 70]], // inclusive interval(s) the assistant is "trained on"

    // ---- AI model parameters (Arm B) -------------------------------------
    // A "baseline" model is always available; an optional "frontier" model can be
    // offered alongside it for the participant to choose from. They differ in the
    // per-query COST (cents, charged like a reveal) and in how much TRAINING DATA
    // they have (denser data => finer interpolation). Baseline cost must be below
    // the reveal cost (consulting is cheaper than searching yourself); the
    // frontier costs more than the baseline (its position relative to the reveal
    // cost is the researcher's choice). Density: 'few' | 'standard' | 'lots'.
    AI: {
      baselineCost: 2,        // cents per baseline-model query (0..REVEAL_COST-1)
      baselineData: 'few',    // baseline training-data density
      frontier: false,        // offer a second, frontier model too?
      frontierCost: 4,        // cents per frontier-model query (>= baselineCost)
      frontierData: 'lots'    // frontier training-data density
    },

    // ---- logging ---------------------------------------------------------
    ENDPOINT_URL: '',      // Apps Script web-app URL; '' = local-only logging
    BATCH_SIZE: 10,        // flush the event queue after this many events...
    BATCH_MS: 15000,       // ...or after this many milliseconds, whichever first
    UPLOAD_MAX_RETRIES: 5, // POST retries before giving up on a batch
    UPLOAD_BACKOFF_MS: 1000, // base backoff; doubles each retry

    // ---- Prolific / deployment ------------------------------------------
    COMPLETION_CODE: 'SET-ME', // Prolific completion code shown on the finish page
    APP_VERSION: 'v2.0.0',     // stamped on every logged event

    // ---- debug -----------------------------------------------------------
    DEBUG_KEY: 'stouras'   // ?debug=1&key=stouras to enable the debug overlay
  };
});
