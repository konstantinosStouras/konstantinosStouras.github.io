/* ==========================================================================
   search-v2  ·  assistant.js   (Arm B only)
   The interpolation-only "assistant" (Gans, jagged-intelligence AI).
   It knows K_DOTS hidden training points inside COVERAGE and answers with the
   straight line between the two nearest ones. Outside COVERAGE it refuses.
   It NEVER uses the subject's reveals — only its own dots.
   ========================================================================== */
window.Assistant = (function () {
  'use strict';
  var CFG = window.CONFIG;
  var C0 = CFG.COVERAGE[0], C1 = CFG.COVERAGE[1];

  function inCoverage(x) { return x >= C0 && x <= C1; }

  // dots: array of [pos, value], sorted ascending by pos, endpoints C0 & C1.
  // Returns { position, refused:Boolean, estimate:Number|null, text }.
  function estimate(dots, x) {
    x = Math.round(x);
    if (!inCoverage(x)) {
      return {
        position: x, refused: true, estimate: null,
        text: 'I only have data for positions ' + C0 + ' to ' + C1 +
              '. I have no data at position ' + x + '.'
      };
    }
    var est = null;
    // exact dot?
    for (var i = 0; i < dots.length; i++) {
      if (dots[i][0] === x) { est = dots[i][1]; break; }
    }
    if (est == null) {
      // bracket x between two nearest dots (guaranteed: endpoints are dots)
      var lo = null, hi = null;
      for (var j = 0; j < dots.length; j++) {
        var p = dots[j][0];
        if (p <= x && (lo === null || p > lo[0])) lo = dots[j];
        if (p >= x && (hi === null || p < hi[0])) hi = dots[j];
      }
      var frac = (x - lo[0]) / (hi[0] - lo[0]);
      est = Math.round(lo[1] + frac * (hi[1] - lo[1]));
    }
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

  return { inCoverage: inCoverage, estimate: estimate, renderLog: renderLog, C0: C0, C1: C1 };
})();
