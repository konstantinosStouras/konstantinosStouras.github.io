/* ==========================================================================
   search-v2  ·  assistant.js   (Arm B only)
   A conceptual model of an LLM (after Gans, "jagged intelligence"). The
   assistant is "trained on" a set of hidden points (its training data, all
   inside one region — see CONFIG.COVERAGE_PATCHES) and ALWAYS answers, for any
   position, with the SAME confident wording — it never says "I don't know":
     · between its two nearest known points it INTERPOLATES (a straight line) →
       accurate, because the true curve is locally smooth there;
     · beyond its outermost known points it EXTRAPOLATES FLAT (holds the nearest
       known value) → still confident, but increasingly wrong the further out.
   So it is reliable only near its training data, with no signal to the user of
   where that is — the participant must calibrate by verifying. It NEVER uses the
   subject's reveals — only its own points.
   ========================================================================== */
window.Assistant = (function () {
  'use strict';

  // dots: array of [pos, value], sorted ascending by pos. Always returns an
  // estimate (refused is always false; the field is kept for logging). Returns
  // { position, refused:false, estimate:Number, text }.
  function estimate(dots, x) {
    x = Math.round(x);
    var est = null, lo = null, hi = null;
    for (var i = 0; i < dots.length; i++) {
      var p = dots[i][0];
      if (p === x) { est = dots[i][1]; break; }            // exact known point
      if (p < x && (lo === null || p > lo[0])) lo = dots[i];
      if (p > x && (hi === null || p < hi[0])) hi = dots[i];
    }
    if (est === null) {
      if (lo && hi) est = Math.round(lo[1] + (x - lo[0]) / (hi[0] - lo[0]) * (hi[1] - lo[1])); // interpolate
      else if (hi) est = hi[1];   // before its first point → flat-extrapolate
      else if (lo) est = lo[1];   // after its last point  → flat-extrapolate
      else est = 0;               // no points at all (shouldn't happen)
    }
    est = Math.max(0, Math.min(100, est));
    return {
      position: x, refused: false, estimate: est,
      text: 'My estimate for position ' + x + ' is about ' + est +
            ' cents. This is an estimate, not a guarantee.'
    };
  }

  // Render the per-round query log (newest last) into a container element.
  function renderLog(el, queries) {
    if (!el) return;
    if (!queries.length) {
      el.innerHTML = '<div class="ai-empty muted small">No questions yet this round.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < queries.length; i++) {
      var q = queries[i];
      var cls = q.refused ? 'ai-msg refused' : 'ai-msg';
      html += '<div class="' + cls + '">' +
                '<span class="ai-q">pos ' + q.position + '</span> ' +
                '<span class="ai-a">' + q.text + '</span>' +
              '</div>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  return { estimate: estimate, renderLog: renderLog };
})();
