/* ==========================================================================
   search-v2  ·  pool.js
   The frozen mapping pool: the prize-mapping generator of design brief §8, the
   acceptance filter of §9, and the seeded PRNG all three generators share.

   Runs in the browser (window.SVPool) and in Node (require), so the offline
   generator (tools/generate_mappings.py mirrors this bit-for-bit), the live app,
   the admin panel's validation gate and the exporter can never disagree.

   THE PRNG.  The brief's reference generator is numpy's PCG64. That cannot be
   reproduced in a browser, and the whole point of the pool is that ONE frozen
   artifact serves every participant of a run — so this file's mulberry32 is the
   canonical generator for this implementation, and tools/generate_mappings.py
   reimplements the SAME PRNG in Python (32-bit arithmetic, verified equal in
   tools/selftest.js). Seeds are recorded in SEEDS.md; the pool itself is a
   frozen artifact of the run and is never regenerated between sessions.
   ========================================================================== */
(function (root, factory) {
  var M = factory(typeof require === 'function' && typeof module !== 'undefined'
    ? require('./config.js') : (root && root.CONFIG));
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  if (root) root.SVPool = M;
})(typeof window !== 'undefined' ? window : null, function (CFG) {
  'use strict';

  // ---- seeded PRNG ---------------------------------------------------------
  // mulberry32: 32-bit state, uniform in [0,1). Deterministic and identical in
  // JS and in tools/generate_mappings.py.
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // FNV-ish string hash → 32-bit seed, so a run can be keyed by a string.
  function hashSeed(str) {
    str = String(str);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function rngFrom(seed) {
    return mulberry32(typeof seed === 'number' ? (seed >>> 0) : hashSeed(seed));
  }
  // Uniform integer in [lo, hi] inclusive.
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  // Uniform real in [lo, hi).
  function randU(rng, lo, hi) { return lo + rng() * (hi - lo); }
  // Fisher–Yates, seeded.
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- the walk (§8) -------------------------------------------------------
  // Reflect rather than clip: clipping piles probability mass on the boundaries
  // and changes the process.
  function reflect(x, lo, hi) {
    var period = 2 * (hi - lo);
    var y = (x - lo) % period;
    if (y < 0) y += period;
    if (y > (hi - lo)) y = period - y;
    return y + lo;
  }

  // One candidate mapping, or null when the post-rounding adjacency check fails
  // (rounding can in principle push a difference above L, which would make the
  // instructions literally false — reject and redraw).
  function generateOne(rng, env) {
    var J = env.positions, L = env.stepBound, lo = env.prizeMin, hi = env.prizeMax;
    var y = randInt(rng, 0, J - 1);                 // 0-based seed index
    var q = new Array(J);
    q[y] = (rng() < env.seedHighProb)
      ? randU(rng, env.seedLowMin, env.seedLowMax)
      : randU(rng, env.seedHighMin, env.seedHighMax);
    for (var j = y + 1; j < J; j++) q[j] = reflect(q[j - 1] + randU(rng, -L, L), lo, hi);
    for (var k = y - 1; k >= 0; k--) q[k] = reflect(q[k + 1] + randU(rng, -L, L), lo, hi);
    for (var i = 0; i < J; i++) q[i] = Math.round(q[i]);
    if (maxAdjacentStep(q) > L) return null;
    return q;
  }

  function maxAdjacentStep(q) {
    var m = 0;
    for (var i = 1; i < q.length; i++) { var d = Math.abs(q[i] - q[i - 1]); if (d > m) m = d; }
    return m;
  }

  // The pool: `poolSize` mappings from a fixed seed. `max(q) >= 80` mirrors the
  // brief's build_pool, so every mapping has real headroom somewhere; the
  // per-round acceptance filter of §9 is applied later, per (mapping, seeds)
  // pairing, and only to SEEDED rounds.
  function buildPool(env, seed) {
    env = withEnvDefaults(env);
    var rng = rngFrom(seed == null ? env.generatorSeed : seed);
    var pool = [], guard = 0;
    while (pool.length < env.poolSize) {
      if (++guard > env.poolSize * 200) throw new Error('pool generation did not converge');
      var q = generateOne(rng, env);
      if (q && maxOf(q) >= 80) pool.push(q);
    }
    return pool;
  }

  function withEnvDefaults(env) {
    var d = CFG.DEFAULTS.env, out = {};
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) {
      out[k] = (env && env[k] != null) ? env[k] : d[k];
    }
    return out;
  }

  function maxOf(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  function argmaxOf(a) { var m = -Infinity, at = -1; for (var i = 0; i < a.length; i++) if (a[i] > m) { m = a[i]; at = i; } return at + 1; }

  // ---- acceptance filter (§9) ---------------------------------------------
  // Applied to every (mapping, pre-opened set) pairing of a SEEDED round.
  // Returns { ok, fails:[…] }. Open rounds get the adjacency check only.
  function acceptance(mapping, preOpened, filter, env) {
    env = withEnvDefaults(env);
    var f = filter || CFG.DEFAULTS.filter;
    var fails = [];
    if (maxAdjacentStep(mapping) > env.stepBound) fails.push('adjacency');
    var seeded = preOpened && preOpened.length;
    if (seeded) {
      var gmax = maxOf(mapping);
      var best = -Infinity;
      for (var i = 0; i < preOpened.length; i++) {
        var v = mapping[preOpened[i] - 1];
        if (v > best) best = v;
      }
      if (gmax < f.minGlobalMax) fails.push('headroom');
      if (best < f.seedHighestMin || best > f.seedHighestMax) fails.push('seedMiddling');
      if (gmax - best < f.minHeadroom) fails.push('seedRoom');
    }
    return { ok: fails.length === 0, fails: fails };
  }

  // ---- pool-level statistics (admin "Consequences" + validation gate) ------
  function poolStats(pool) {
    if (!pool || !pool.length) return null;
    var n = 0, sum = 0, sumsq = 0, gmaxSum = 0, gmaxes = [], worstStep = 0;
    for (var i = 0; i < pool.length; i++) {
      var q = pool[i];
      for (var j = 0; j < q.length; j++) { n++; sum += q[j]; sumsq += q[j] * q[j]; }
      var gm = maxOf(q); gmaxSum += gm; gmaxes.push(gm);
      var st = maxAdjacentStep(q); if (st > worstStep) worstStep = st;
    }
    gmaxes.sort(function (a, b) { return a - b; });
    var mean = sum / n;
    return {
      mappings: pool.length,
      cellMean: mean,
      cellSd: Math.sqrt(Math.max(0, sumsq / n - mean * mean)),
      globalMaxMean: gmaxSum / pool.length,
      globalMaxP5: gmaxes[Math.floor(0.05 * (gmaxes.length - 1))],
      globalMaxP95: gmaxes[Math.floor(0.95 * (gmaxes.length - 1))],
      worstAdjacentStep: worstStep
    };
  }

  return {
    mulberry32: mulberry32,
    hashSeed: hashSeed,
    rngFrom: rngFrom,
    randInt: randInt,
    randU: randU,
    shuffle: shuffle,
    reflect: reflect,
    generateOne: generateOne,
    maxAdjacentStep: maxAdjacentStep,
    buildPool: buildPool,
    withEnvDefaults: withEnvDefaults,
    acceptance: acceptance,
    poolStats: poolStats,
    maxOf: maxOf,
    argmaxOf: argmaxOf
  };
});
