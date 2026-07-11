/* ==========================================================================
   search-v2  ·  landscape.js
   Runtime, deterministic ground-truth generation + the assistant's
   interval-aware interpolation / linear extrapolation (after /lab/interpolation).

   The hidden prize curve is a bounded random walk in cents [0,100] with
   |Δ| ≤ L_STEP between neighbours. It is generated on the fly from an integer
   seed, so the SAME seed always yields byte-identical values. app.js seeds it
   from (arm, round) via CONFIG.TRUTH_SEED, so every participant of every session
   sees the same curves, the two phases differ, and each round is a fresh draw.

   The assistant's "training data" is a set of points placed only inside the
   interpolation region(s). Between its points (within a region) it interpolates
   linearly; outside/between regions it extrapolates linearly along the nearest
   edge segment (confident but increasingly wrong). This mirrors the teaching demo
   at /lab/interpolation. Loaded in both the browser (window.Landscape) and Node
   (require) so the app and its tools never disagree.
   ========================================================================== */
(function (root, factory) {
  var CFG = (typeof require !== 'undefined') ? require('./config.js') : (root && root.CONFIG);
  var L = factory(CFG || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = L; // Node
  if (root) root.Landscape = L;                                            // browser
})(typeof window !== 'undefined' ? window : null, function (CFG) {
  'use strict';

  var N = CFG.N_POSITIONS || 100;
  var L_STEP = CFG.L_STEP || 10;

  // ---- seeded PRNG + string hash (deterministic) ---------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return h >>> 0;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---- the walk ------------------------------------------------------------
  // One deterministic bounded random walk: pick a seed position and value, then
  // walk outward with steps in [-L_STEP, L_STEP], clamped to [0,100]. 100 ints.
  function rawWalk(seed) {
    var rng = mulberry32(seed >>> 0);
    var y = 1 + Math.floor(rng() * N);                  // seed position 1..N
    var q = new Array(N + 1);                            // 1-indexed
    q[y] = rng() < 0.5 ? 20 + 60 * rng() : 80 + 20 * rng();
    for (var j = y + 1; j <= N; j++) q[j] = clamp(q[j - 1] + (-L_STEP + 2 * L_STEP * rng()), 0, 100);
    for (var k = y - 1; k >= 1; k--) q[k] = clamp(q[k + 1] + (-L_STEP + 2 * L_STEP * rng()), 0, 100);
    var v = new Array(N);
    for (var p = 1; p <= N; p++) v[p - 1] = Math.round(q[p]);
    return v;
  }

  // Does the walk have a single, tie-free global maximum (one clear peak)?
  function hasUniqueMax(v) {
    var m = -Infinity, cnt = 0;
    for (var i = 0; i < v.length; i++) { if (v[i] > m) { m = v[i]; cnt = 1; } else if (v[i] === m) cnt++; }
    return cnt === 1;
  }

  // Candidate budget for the unique-peak preference. A single draw is tie-free
  // only ~1/3 of the time (walks that hit the 100 ceiling plateau), so this makes
  // the fallback astronomically rare (~1e-12) without ever *enforcing* uniqueness.
  var UNIQUE_MAX_TRIES = 64;

  // Deterministic bounded walk that PREFERS a unique global maximum (one clean
  // peak): it draws candidates from a deterministic seed sequence and returns the
  // first whose top value is tie-free. If none qualifies within the budget
  // (essentially never), it returns the first candidate — uniqueness is preferred,
  // never enforced. Still a pure function of `seed`, so every participant of every
  // session sees the same curve for a given (arm, round).
  function makeWalk(seed) {
    var s = seed >>> 0, first = null;
    for (var t = 0; t < UNIQUE_MAX_TRIES; t++) {
      var v = rawWalk(s);
      if (t === 0) first = v;
      if (hasUniqueMax(v)) return v;
      s = (s + 0x9E3779B9) >>> 0;   // deterministic next candidate seed
    }
    return first;
  }

  // ---- assistant training data --------------------------------------------
  // Map a density label to an average point spacing (cents). Fewer data => wider
  // spacing => coarser interpolation; more data => tighter spacing.
  var SPACING = { few: 16, standard: 10, lots: 5 };
  function spacingFor(density) { return SPACING[density] || SPACING.standard; }

  // Place training points inside one region [a,b]: evenly spaced with a little
  // deterministic jitter, endpoints pinned to a and b. Returns [[pos,value],...].
  function dotsForRegion(values, a, b, density, rng) {
    a = clamp(Math.round(a), 1, N); b = clamp(Math.round(b), 1, N);
    if (b < a) { var t = a; a = b; b = t; }
    var span = b - a;
    var n = Math.max(2, Math.round(span / spacingFor(density)) + 1);
    if (span < 2) n = 1;
    var used = {}, xs = [];
    for (var i = 0; i < n; i++) {
      var base = (n === 1) ? a : Math.round(a + i * span / (n - 1));
      var jit = (i === 0 || i === n - 1) ? 0 : Math.round((rng() - 0.5) * 4); // ±2, ends pinned
      var x = clamp(base + jit, a, b);
      var guard = 0;
      while (used[x] && guard++ < 200) { x = x + 1 > b ? a : x + 1; }
      used[x] = 1; xs.push(x);
    }
    xs.sort(function (p, qv) { return p - qv; });
    return xs.map(function (x) { return [x, values[x - 1]]; });
  }

  // Training data for every region, as GROUPS (one array of [pos,value] per
  // region, sorted left→right). `patches` is [[a,b],...]; density is a label.
  function makeDots(values, patches, density, seed) {
    var rng = mulberry32(((seed >>> 0) ^ 0x9E3779B9) >>> 0);
    var groups = [];
    for (var i = 0; i < patches.length; i++) {
      groups.push(dotsForRegion(values, patches[i][0], patches[i][1], density, rng));
    }
    return groups;
  }

  // ---- interval-aware estimate (after /lab/interpolation) ------------------
  // Interpolate within a region's point span; otherwise extrapolate linearly
  // along the nearest region's edge segment. Always answers. Returns
  // { estimate:Number (0..100), mode:'interp'|'extrap' }.
  function estimate(groups, x) {
    x = Math.round(x);
    var gi, p, n, i;
    for (gi = 0; gi < groups.length; gi++) {
      p = groups[gi]; n = p.length;
      if (n >= 1 && x >= p[0][0] && x <= p[n - 1][0]) {
        if (n === 1) return { estimate: clamp(p[0][1], 0, 100), mode: 'interp' };
        i = 0; while (i < n - 1 && !(p[i][0] <= x && x <= p[i + 1][0])) i++;
        var mI = (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]);
        return { estimate: clamp(Math.round(p[i][1] + mI * (x - p[i][0])), 0, 100), mode: 'interp' };
      }
    }
    var best = null, bd = Infinity;
    for (gi = 0; gi < groups.length; gi++) {
      p = groups[gi]; n = p.length;
      if (n < 2) { var d0 = Math.abs(x - p[0][0]); if (d0 < bd) { bd = d0; best = { ax: p[0][0], ay: p[0][1], m: 0 }; } continue; }
      if (x < p[0][0]) { var dL = p[0][0] - x; if (dL < bd) { bd = dL; best = { ax: p[0][0], ay: p[0][1], m: (p[1][1] - p[0][1]) / (p[1][0] - p[0][0]) }; } }
      if (x > p[n - 1][0]) { var dR = x - p[n - 1][0]; if (dR < bd) { bd = dR; best = { ax: p[n - 1][0], ay: p[n - 1][1], m: (p[n - 1][1] - p[n - 2][1]) / (p[n - 1][0] - p[n - 2][0]) }; } }
    }
    if (!best) return { estimate: 0, mode: 'extrap' };
    return { estimate: clamp(Math.round(best.ay + best.m * (x - best.ax)), 0, 100), mode: 'extrap' };
  }

  // ---- chart geometry (green interpolation, amber extrapolation, zones) -----
  // Everything in position/value units (1..N / 0..100); the chart maps to pixels.
  //   interp: [ [[pos,val],...], ... ]   one polyline per region
  //   extrap: [ {x0,y0,x1,y1}, ... ]     dashed edge continuations
  //   zones:  [ {x0,x1}, ... ]           extrapolation bands to shade
  function geometry(groups) {
    var interp = [], extrap = [], zones = [];
    if (!groups.length) return { interp: interp, extrap: extrap, zones: zones };
    for (var i = 0; i < groups.length; i++) interp.push(groups[i].slice());
    function edgeSlope(p, side) {
      var n = p.length; if (n < 2) return 0;
      return side === 'L' ? (p[1][1] - p[0][1]) / (p[1][0] - p[0][0])
                          : (p[n - 1][1] - p[n - 2][1]) / (p[n - 1][0] - p[n - 2][0]);
    }
    var f = groups[0], mL = edgeSlope(f, 'L');
    if (f[0][0] > 1) { extrap.push({ x0: 1, y0: f[0][1] + mL * (1 - f[0][0]), x1: f[0][0], y1: f[0][1] }); zones.push({ x0: 1, x1: f[0][0] }); }
    for (var k = 0; k < groups.length - 1; k++) {
      var gA = groups[k], gB = groups[k + 1], bi = gA[gA.length - 1], ai = gB[0], mid = (bi[0] + ai[0]) / 2;
      var mR = edgeSlope(gA, 'R'), mL2 = edgeSlope(gB, 'L');
      extrap.push({ x0: bi[0], y0: bi[1], x1: mid, y1: bi[1] + mR * (mid - bi[0]) });
      extrap.push({ x0: mid, y0: ai[1] + mL2 * (mid - ai[0]), x1: ai[0], y1: ai[1] });
      zones.push({ x0: bi[0], x1: ai[0] });
    }
    var l = groups[groups.length - 1], last = l[l.length - 1], mR3 = edgeSlope(l, 'R');
    if (last[0] < N) { extrap.push({ x0: last[0], y0: last[1], x1: N, y1: last[1] + mR3 * (N - last[0]) }); zones.push({ x0: last[0], x1: N }); }
    return { interp: interp, extrap: extrap, zones: zones };
  }

  return {
    mulberry32: mulberry32, hashSeed: hashSeed,
    makeWalk: makeWalk, hasUniqueMax: hasUniqueMax, makeDots: makeDots, estimate: estimate, geometry: geometry,
    N: N, L_STEP: L_STEP
  };
});
