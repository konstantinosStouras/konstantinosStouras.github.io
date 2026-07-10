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
    N_TASKS: 10,        // number of real (paid-eligible) rounds
    N_PRACTICE: 1,      // number of unpaid practice rounds
    PAID_TASKS: 2,      // rounds drawn for payment at the end

    // ---- assistant (Arm B only) ------------------------------------------
    // The single interval where the assistant's training data lives. It is
    // ACCURATE here (it interpolates between its nearest training points) and it
    // ALWAYS answers everywhere else too (flat-extrapolating beyond its points —
    // confident but unreliable), never refusing. See assistant.js. This region is
    // NOT revealed to participants; it only drives where training points are
    // placed, the RICH/POOR strata, and the admin/debrief overlays. Kept as a
    // one-element list of [start,end] so the (multi-interval-capable) machinery
    // still works — set two entries here if you ever want disjoint regions again.
    COVERAGE_PATCHES: [[30, 70]], // inclusive interval the assistant is "trained on"
    K_DOTS: 7,          // (reference) training-point count guide; dots are placed
                        // by gap size, so this is not used directly

    // ---- landscape pool (offline generation) -----------------------------
    POOL_PER_STRATUM: 60, // landscapes generated per stratum
    RICH_INTERIOR_MIN: 85, // RICH: max value inside the coverage patches must be >= this
    POOR_INTERIOR_MAX: 55, // POOR: max value inside the coverage patches must be <= this
    POOR_OUTSIDE_MIN: 85,  // POOR: max value outside all coverage patches must be >= this
    MEAN_MIN: 25,          // soft comparability screen: mean of all 100 values...
    MEAN_MAX: 50,          // ...must fall in [MEAN_MIN, MEAN_MAX]
    SAMPLE_RICH: 5,        // RICH landscapes drawn per subject (of N_TASKS)
    SAMPLE_POOR: 5,        // POOR landscapes drawn per subject (of N_TASKS)

    // ---- obfuscation (deters casual DevTools peeking only) ---------------
    OBFUSCATION_KEY: 90,   // fixed byte XOR'd into shipped value arrays (0x5A)

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
