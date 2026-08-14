/* ==========================================================================
   search-v2  ·  config.js
   Single source of truth for every tunable constant of
   "Search With and Without Generative AI".

   Loaded in the browser (window.CONFIG) and in Node
   (require('../config.js') from tools/*.js and admin/export.js), so the offline
   generators, the live app, the admin panel and the exporter can never disagree
   on a constant. Change a value HERE and nowhere else.

   DEFAULTS mirrors the design brief §17b (Screen 2: Parameters) exactly. Every
   field in DEFAULTS is a run parameter; the admin panel edits a COPY of it into
   a run document, and a run's parameters are LOCKED once the first participant
   claims a code (§17b "clone, do not edit").
   ========================================================================== */
(function (root, factory) {
  var CONFIG = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG; // Node
  if (root) root.CONFIG = CONFIG;                                               // browser
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Run parameters (§17b Screen 2). Everything here is per-RUN and frozen at
  // launch, except the `ops` group, which stays editable for the run's life.
  // --------------------------------------------------------------------------
  var DEFAULTS = {
    // ---- Environment (§8) --------------------------------------------------
    env: {
      positions: 100,          // J — positions 1..100 on the line
      prizeMin: 0,             // value range, integer, reflecting boundaries
      prizeMax: 100,
      stepBound: 10,           // L — adjacent positions differ by at most L
      seedLowMin: 20,          // walk seed value, low band  U[20,80] …
      seedLowMax: 80,
      seedHighMin: 80,         // … with prob 0.5, else the high band U[80,100]
      seedHighMax: 100,
      seedHighProb: 0.5,       // P(draw from the LOW band) — 0.5 per the brief
      rounding: 'nearest',     // rounding of the finished path
      // Mapping pool size. The brief's own value is 200. MEASURED at the default
      // parameters: only about 2% of (mapping, seed-set) pairings pass the §9
      // acceptance filter — "highest pre-opened value between 30 and 60" is a
      // hard ask on a pool that build_pool already filtered up to `max >= 80`,
      // where the highest of three seeded positions has a median of 91 — and only
      // 7% of mappings admit ANY jitter of the BALANCED seed set. With 200
      // mappings the 16 seeded specs cannot all get a distinct one, and the
      // builder would have to serve the same prize curve in two rounds, which
      // would make the instructions ("the prizes are drawn afresh") false.
      // The pool is generated, never committed, so a larger one costs nothing.
      poolSize: 600,
      generatorSeed: 20260813  // generator random seed (frozen, recorded)
    },

    // ---- Costs and limits (§7) --------------------------------------------
    // c_R = 4, not the brief's 5, and sparseK = 3, not 4. Both come from
    // tools/simulate.mjs over 1000 simulated participants; SIMULATION-FINDINGS.md
    // carries the tables. At the brief's values the AI-OFF arm is barely a search
    // arm (unaided search opens 1.88 positions and buys +5.84 over spending
    // nothing) and the sparse/dense contrast is a GRADIENT, not the sign change
    // the design rests on (+4.30 sparse against +7.85 dense — same sign). Moving
    // BOTH flips it (-1.56 against +5.83); neither alone does.
    //
    // c_R cannot go below 3.64: there s* = c_R·sqrt(2π) falls under the dense
    // mid-gap SD of 9.13, verification pays everywhere, and the density
    // manipulation has nothing left to manipulate. sparseK = 3 widens the
    // admissible window to (3.64, 6.65), so 4 sits inside it rather than on an
    // edge. Change these two together or not at all.
    costs: {
      revealCost: 4,           // c_R
      queryCost: 2,            // c_AI
      queryCap: 40,            // per round
      revealCap: 20,           // per round
      scoreFloor: false        // off: a round may end negative, and that is logged
    },

    // ---- AI (§3, §12) ------------------------------------------------------
    ai: {
      sparseK: 3,              // see the note on revealCost above
      denseK: 10,
      placement: 'stratified', // 'stratified' | 'uniform' (never use uniform)
      answerRounding: 'nearest',
      allowRequery: true,
      drawCurve: false,        // MUST stay off — see §17b
      markAnchors: false       // MUST stay off — see §17b
    },

    // ---- Round structure (§10) --------------------------------------------
    rounds: {
      warmupPerBlock: 2,
      scoredPerBlock: 12,
      openPerBlock: 4,
      seededPerBlock: 8,
      shapeMix: { FRONTIER: 2, BALANCED: 4, GAP: 2 },
      densitySeeded: { SPARSE: 4, DENSE: 4 },
      densityOpen: { SPARSE: 2, DENSE: 2 },
      seedJitter: 2,           // ± uniform integer jitter on each seed position
      shuffleWithinBlock: true
    },

    // ---- Assignment (§11) --------------------------------------------------
    assign: {
      sequenceAssignment: 'block', // 'block' (exact 50/50) | 'random'
      freezeSeeds: true,
      freezeAnchors: true,
      nextEntrantOverride: 'auto'  // 'auto' | 'A' | 'B'  (the ONE unlocked control)
    },

    // ---- Acceptance filter (§9) -------------------------------------------
    filter: {
      minGlobalMax: 80,        // seeded rounds only
      seedHighestMin: 30,      // highest pre-opened value must sit in [30, 60]
      seedHighestMax: 60,
      minHeadroom: 25,         // global max at least this far above the best seed
      applyToOpen: false       // open rounds are unfiltered by design
    },

    // ---- Operations — editable at any time (§17b) --------------------------
    ops: {
      runName: 'untitled',
      entryOpen: false,
      windowFrom: '',          // ISO date-time, '' = none
      windowTo: '',
      minViewport: 900,        // CSS pixels; refuse to start below it
      allowResume: true,
      resumeWindowH: 24,
      idleWarnMin: 10,
      exitSurvey: true,
      debrief: true,
      gateQ2: 'strict',        // must pass to continue
      gateOther: 'record',     // record attempts, do not block
      rosterMode: 'open',      // 'open' (any code, incl. platform student IDs)
                               // | 'roster' (only pre-generated codes)
      // Where the score-bearing actions are computed (§17.2). 'server' puts
      // queryAI / reveal / nominate in Cloud Functions, so the prize mapping
      // never reaches the browser — the brief's recommended architecture, and
      // available on the Blaze plan. 'client' is the fallback for a project with
      // no Functions deployed. This sits in Operations only so a run can be
      // configured before launch; it LOCKS with everything else at the first
      // entrant, because mixing the two inside one run would put two kinds of
      // row in one dataset.
      compute: 'client',
      completionCode: ''       // shown on the Done screen (blank = none needed)
    }
  };

  return {
    DEFAULTS: DEFAULTS,

    // ---- constants the code needs directly ---------------------------------
    // Per-step SD of the walk, sigma = L / sqrt(3). Every uncertainty formula in
    // §16.8 is expressed in it, so it is derived from the run's own step bound.
    sigma: function (L) { return (L == null ? DEFAULTS.env.stepBound : L) / Math.sqrt(3); },
    // Verification threshold s* = c_R * sqrt(2*pi) (§3.4).
    sStar: function (cR) { return (cR == null ? DEFAULTS.costs.revealCost : cR) * Math.sqrt(2 * Math.PI); },
    // AI gap width at which verification starts to pay, g* = (2 s* / sigma)^2.
    gStar: function (cR, L) {
      var s = (cR == null ? DEFAULTS.costs.revealCost : cR) * Math.sqrt(2 * Math.PI);
      var sg = (L == null ? DEFAULTS.env.stepBound : L) / Math.sqrt(3);
      return Math.pow(2 * s / sg, 2);
    },

    SEED_SHAPES: ['FRONTIER', 'BALANCED', 'GAP'],
    // Base seed positions per shape (§10). Each is jittered by ±seedJitter.
    SEED_BASE: {
      FRONTIER: [40, 47, 54, 61],
      BALANCED: [8, 52, 92],
      GAP: [3, 50, 97]
    },
    DENSITIES: ['SPARSE', 'DENSE'],

    // ---- logging / transport ----------------------------------------------
    BATCH_SIZE: 12,            // flush the telemetry queue after this many events…
    BATCH_MS: 10000,           // …or after this many ms, whichever comes first (§17.2)
    SLIDER_THROTTLE_MS: 250,   // §16.4
    HEARTBEAT_MS: 30000,       // §16.5

    APP_VERSION: 'v3.0.0',     // stamped on every logged event
    DEBUG_KEY: 'stouras'       // ?debug=1&key=stouras enables the testing overlay
  };
});
