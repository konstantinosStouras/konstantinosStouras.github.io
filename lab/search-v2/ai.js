/* ==========================================================================
   search-v2  ·  ai.js
   The AI of design brief §3 and §12, plus every geometric and rationality
   measure of §16.8.

   The SAME code answers a live query and computes the offline derived fields, so
   an analysis can never disagree with what the participant was shown. Nothing
   here is stateful: every function takes the anchor set explicitly.

   Vocabulary, because two different "known" sets exist and the brief keeps them
   apart on purpose (§16.3):
     · AI anchors        — the K frozen private anchors + every pre-opened
                           position + every position the participant has revealed.
                           This defines the AI's answers.
     · Participant-known — the pre-opened positions + the participant's reveals.
                           This is what the FRONTIER / GAP outcome is measured
                           against (§5, outcome 2).

   Browser: window.SVAi.  Node: require('./ai.js').
   ========================================================================== */
(function (root, factory) {
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var M = factory(isNode ? require('./config.js') : (root && root.CONFIG));
  if (isNode) module.exports = M;
  if (root) root.SVAi = M;
})(typeof window !== 'undefined' ? window : null, function (CFG) {
  'use strict';

  // ---- anchor sets ---------------------------------------------------------
  function sortByPos(a) { return a.slice().sort(function (x, y) { return x.pos - y.pos; }); }

  // Build the AI's anchor set: private anchors + pre-opened + revealed, each at
  // its TRUE value, deduped by position and sorted ascending (§12).
  function anchorSet(privateAnchors, preOpened, revealedPositions, mapping) {
    var seen = {}, out = [];
    function add(p) {
      p = +p;
      if (!p || seen[p]) return;
      var v = mapping[p - 1];
      if (v == null) return;
      seen[p] = 1; out.push({ pos: p, val: v });
    }
    (privateAnchors || []).forEach(add);
    (preOpened || []).forEach(add);
    (revealedPositions || []).forEach(add);
    return sortByPos(out);
  }

  // What the participant knows the truth of: pre-opened + their own reveals.
  function knownSet(preOpened, revealedPositions, mapping) {
    return anchorSet([], preOpened, revealedPositions, mapping);
  }

  // ---- the answer (§12) ----------------------------------------------------
  // Exactly the brief's reference implementation. Flat beyond either outermost
  // anchor, straight-line interpolation between the two nearest inside.
  function aiAnswerRaw(anchors, p) {
    if (!anchors || !anchors.length) return null;
    var first = anchors[0], last = anchors[anchors.length - 1];
    if (p <= first.pos) return first.val;
    if (p >= last.pos) return last.val;
    var k = 0;
    while (anchors[k + 1].pos < p) k++;
    var a = anchors[k], b = anchors[k + 1];
    return a.val + (b.val - a.val) * (p - a.pos) / (b.pos - a.pos);
  }
  // Rounded to the nearest integer, so an answer is never distinguishable from a
  // true prize by its formatting.
  function aiAnswer(anchors, p, rounding) {
    var v = aiAnswerRaw(anchors, p);
    if (v == null) return null;
    return (rounding === 'none') ? v : Math.round(v);
  }

  // ---- geometry of a choice (§16.8) ---------------------------------------
  // `anchors` may be either set (AI or participant-known); the caller decides
  // which question it is asking.
  function geometry(anchors, p, J) {
    J = J || CFG.DEFAULTS.env.positions;
    var n = anchors.length;
    if (!n) {
      return {
        n_anchors: 0, x_min: null, x_max: null, choice_region: 'open',
        is_frontier: null, dist_to_nearest_anchor: null,
        gap_width: null, gap_fraction: null, tail_depth: null,
        max_gap_available: null, max_tail_available: null, exchange_ratio: null
      };
    }
    var xmin = anchors[0].pos, xmax = anchors[n - 1].pos;
    var region, gapWidth = null, gapFraction = null, tailDepth = null;
    if (p < xmin) { region = 'left_tail'; tailDepth = xmin - p; }
    else if (p > xmax) { region = 'right_tail'; tailDepth = p - xmax; }
    else {
      region = 'gap';
      var k = 0;
      while (k + 1 < n && anchors[k + 1].pos < p) k++;
      // p sits in [anchors[k].pos, anchors[k+1].pos]; a p that IS an anchor has
      // gap_fraction 0 or 1.
      var a = anchors[k], b = anchors[Math.min(k + 1, n - 1)];
      gapWidth = b.pos - a.pos;
      gapFraction = gapWidth > 0 ? (p - a.pos) / gapWidth : 0;
    }
    var dist = Infinity;
    for (var i = 0; i < n; i++) dist = Math.min(dist, Math.abs(anchors[i].pos - p));

    var maxGap = 0;
    for (var g = 1; g < n; g++) maxGap = Math.max(maxGap, anchors[g].pos - anchors[g - 1].pos);
    var maxTail = Math.max(xmin - 1, J - xmax);

    return {
      n_anchors: n, x_min: xmin, x_max: xmax,
      choice_region: region,
      is_frontier: region !== 'gap',
      dist_to_nearest_anchor: dist,
      gap_width: gapWidth,
      gap_fraction: gapFraction,
      tail_depth: tailDepth,
      max_gap_available: maxGap,
      max_tail_available: maxTail,
      exchange_ratio: maxTail > 0 ? maxGap / (4 * maxTail) : null
    };
  }

  // ---- the AI curve's uncertainty (§16.8) ---------------------------------
  // Inside a gap of width g between anchors a and b: sigma * sqrt((p-a)(b-p)/g)
  // — the Brownian-bridge standard deviation, largest at the midpoint where it
  // equals sigma*sqrt(g)/2. In a tail at distance t: sigma * sqrt(t).
  function aiSd(anchors, p, sigma) {
    if (!anchors || !anchors.length) return null;
    sigma = (sigma == null) ? CFG.sigma() : sigma;
    var n = anchors.length, first = anchors[0], last = anchors[n - 1];
    if (p <= first.pos) return sigma * Math.sqrt(first.pos - p);
    if (p >= last.pos) return sigma * Math.sqrt(p - last.pos);
    var k = 0;
    while (anchors[k + 1].pos < p) k++;
    var a = anchors[k].pos, b = anchors[k + 1].pos, g = b - a;
    if (g <= 0) return 0;
    return sigma * Math.sqrt((p - a) * (b - p) / g);
  }

  // ---- rationality benchmarks (§16.8) -------------------------------------
  // The Lipschitz window: adjacent positions differ by at most L, so every
  // anchor bounds every other position. Capped/floored at the prize range.
  function lipschitz(anchors, p, L, lo, hi) {
    L = (L == null) ? CFG.DEFAULTS.env.stepBound : L;
    lo = (lo == null) ? CFG.DEFAULTS.env.prizeMin : lo;
    hi = (hi == null) ? CFG.DEFAULTS.env.prizeMax : hi;
    if (!anchors || !anchors.length) return { upper: hi, lower: lo };
    var up = Infinity, low = -Infinity;
    for (var i = 0; i < anchors.length; i++) {
      var d = Math.abs(p - anchors[i].pos);
      up = Math.min(up, anchors[i].val + L * d);
      low = Math.max(low, anchors[i].val - L * d);
    }
    return { upper: Math.min(hi, up), lower: Math.max(lo, low) };
  }

  function phi(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
  // Abramowitz & Stegun 7.1.26 error function → standard normal CDF.
  function Phi(x) {
    var z = x / Math.SQRT2, sign = z < 0 ? -1 : 1;
    z = Math.abs(z);
    var t = 1 / (1 + 0.3275911 * z);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + sign * y);
  }

  // Expected improvement of a position over the current best known value z.
  function expectedImprovement(m, z, s) {
    if (m == null) return 0;
    var d = m - z;
    if (!s || s <= 0) return Math.max(0, d);
    var u = d / s;
    return d * Phi(u) + s * phi(u);
  }

  // The myopic expected-improvement benchmark over every position that is not
  // already revealed. Returns { max, at, ei:[…] } with ei[p-1] per position.
  function eiSurface(anchors, revealedPositions, bestKnown, J, sigma, rounding) {
    J = J || CFG.DEFAULTS.env.positions;
    var taken = {};
    (revealedPositions || []).forEach(function (p) { taken[p] = 1; });
    var ei = new Array(J), best = -Infinity, at = null;
    for (var p = 1; p <= J; p++) {
      if (taken[p]) { ei[p - 1] = null; continue; }
      var m = aiAnswer(anchors, p, rounding);
      var s = aiSd(anchors, p, sigma);
      var e = expectedImprovement(m, bestKnown, s);
      ei[p - 1] = e;
      if (e > best) { best = e; at = p; }
    }
    return { max: (at == null ? null : best), at: at, ei: ei };
  }

  // ---- the whole derived block for one decision (§16.8) -------------------
  // `state` = {
  //   aiAnchors:[{pos,val}], known:[{pos,val}], revealed:[p…], mapping:[…],
  //   privateAnchors:[p…], bestTrueKnown, position, params
  // }
  // Everything here is reconstructible offline from the raw log plus the frozen
  // mapping pool — which is exactly why none of it is computed live.
  function derive(state) {
    var P = state.params || CFG.DEFAULTS;
    var J = P.env.positions, L = P.env.stepBound;
    var sigma = CFG.sigma(L), sStar = CFG.sStar(P.costs.revealCost);
    var p = state.position;
    var out = {};

    // Geometry against the participant's own known set — the primary outcome.
    var gK = geometry(state.known || [], p, J);
    Object.keys(gK).forEach(function (k) { out[k] = gK[k]; });

    // Geometry against the AI's anchor set — the curve the AI actually draws.
    var gA = geometry(state.aiAnchors || [], p, J);
    out.ai_n_anchors = gA.n_anchors;
    out.ai_x_min = gA.x_min; out.ai_x_max = gA.x_max;
    out.ai_choice_region = gA.choice_region;
    out.ai_gap_width = gA.gap_width;
    out.dist_to_nearest_ai_anchor = gA.dist_to_nearest_anchor;

    var m = aiAnswer(state.aiAnchors || [], p, P.ai.answerRounding);
    var s = aiSd(state.aiAnchors || [], p, sigma);
    out.ai_prediction = m;
    out.ai_sd = s;
    out.verify_pays = (s != null) ? (s > sStar) : null;
    out.hit_private_anchor = (state.privateAnchors || []).indexOf(p) >= 0;
    out.ai_error = (m != null && state.mapping) ? (m - state.mapping[p - 1]) : null;
    // ai_curve_max always equals the highest anchor value, by the property in §3
    // (an interpolation of the anchors can never exceed them). Computed anyway as
    // a sanity check on the implementation.
    var curveMax = -Infinity;
    for (var q = 1; q <= J; q++) {
      var v = aiAnswerRaw(state.aiAnchors || [], q);
      if (v != null && v > curveMax) curveMax = v;
    }
    out.ai_curve_max = isFinite(curveMax) ? curveMax : null;

    var z = (state.bestTrueKnown == null) ? 0 : state.bestTrueKnown;
    var lip = lipschitz(state.known || [], p, L, P.env.prizeMin, P.env.prizeMax);
    out.lipschitz_upper = lip.upper;
    out.lipschitz_lower = lip.lower;
    out.outside_window = (state.known && state.known.length) ? (lip.upper < z) : false;

    out.expected_improvement = expectedImprovement(m, z, s);
    var surf = eiSurface(state.aiAnchors || [], state.revealed || [], z, J, sigma, P.ai.answerRounding);
    out.max_ei_available = surf.max;
    out.ei_argmax_position = surf.at;
    out.matched_benchmark = (surf.at != null) && (surf.at === p);
    out.ei_regret = (surf.max == null) ? null : (surf.max - out.expected_improvement);

    return out;
  }

  return {
    anchorSet: anchorSet,
    knownSet: knownSet,
    aiAnswer: aiAnswer,
    aiAnswerRaw: aiAnswerRaw,
    geometry: geometry,
    aiSd: aiSd,
    lipschitz: lipschitz,
    phi: phi, Phi: Phi,
    expectedImprovement: expectedImprovement,
    eiSurface: eiSurface,
    derive: derive
  };
});
