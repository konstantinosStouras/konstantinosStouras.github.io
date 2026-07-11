/* ==========================================================================
   search-v2  ·  assistant.js   (Arm B only)
   A conceptual model of an LLM (after Gans, "jagged intelligence"). The
   assistant is "trained on" hidden points inside one or two interpolation
   regions and ALWAYS answers, for any position, with the SAME confident wording
   — it never says "I don't know":
     · within a region, between its nearest known points, it INTERPOLATES (a
       straight line) → accurate, because the true curve is locally smooth there;
     · outside/between the regions it EXTRAPOLATES linearly along the nearest edge
       segment → still confident, but increasingly wrong the further out.
   So it is reliable only near its training data, with no signal to the user of
   where that is — the participant must calibrate by verifying. The heavy lifting
   (interval-aware interpolation/extrapolation) lives in landscape.js so the chart
   overlays and the answers stay in lockstep. It NEVER uses the subject's reveals.
   ========================================================================== */
window.Assistant = (function () {
  'use strict';
  var LS = window.Landscape;

  // groups: array (one per interpolation region) of [pos,value] pairs, sorted by
  // pos. Always returns an estimate (refused stays false, kept for logging).
  // Returns { position, refused:false, estimate:Number, mode:'interp'|'extrap', text }.
  function estimate(groups, x) {
    x = Math.round(x);
    var r = LS.estimate(groups || [], x);
    var est = r.estimate;
    return {
      position: x, refused: false, estimate: est, mode: r.mode,
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
