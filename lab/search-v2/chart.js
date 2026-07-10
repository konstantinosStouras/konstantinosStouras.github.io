/* ==========================================================================
   search-v2  ·  chart.js
   Inline-SVG landscape chart: axes, gridlines, selection highlight, revealed
   truth dots, (Arm B) assistant coverage bands + estimate diamonds, and a
   debug overlay (true line + dots), gated by the app.

   The chart is a pure renderer: every render() call receives ONLY values the
   subject is allowed to see. Unrevealed truth is never passed in except when
   the app explicitly enables debug. The decoded landscape lives in the app's
   closure, never here.
   ========================================================================== */
window.Chart = (function () {
  'use strict';
  var CFG = window.CONFIG;
  var N = CFG.N_POSITIONS;

  // viewBox geometry
  var VW = 960, VH = 430;
  var PAD_L = 52, PAD_R = 18, PAD_T = 16, PAD_B = 40;
  var PW = VW - PAD_L - PAD_R;      // plot width
  var PH = VH - PAD_T - PAD_B;      // plot height

  function xOf(p) { return PAD_L + (p - 1) / (N - 1) * PW; }
  function yOf(v) { return PAD_T + (1 - v / 100) * PH; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function create(container, opts) {
    opts = opts || {};
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
    svg.setAttribute('class', 'plot-svg');
    svg.setAttribute('role', 'img');
    container.appendChild(svg);

    // Map a pointer event to the nearest position (1..N), accounting for
    // viewBox<->client scaling.
    function posFromEvent(ev) {
      var rect = svg.getBoundingClientRect();
      var clientX = (ev.touches ? ev.touches[0].clientX : ev.clientX);
      var sx = (clientX - rect.left) / rect.width * VW; // to viewBox units
      var frac = (sx - PAD_L) / PW;
      var p = Math.round(1 + frac * (N - 1));
      return Math.max(1, Math.min(N, p));
    }
    if (opts.onSelect) {
      svg.addEventListener('click', function (ev) { opts.onSelect(posFromEvent(ev)); });
    }

    function render(st) {
      st = st || {};
      var arm = st.arm;
      var sel = st.selected;
      var revealed = st.revealed || [];
      var estimates = st.estimates || [];
      var parts = [];

      // --- gridlines + axis ticks ---
      // Values are stored 0..100 (cents) but shown on a [0,1] scale, which reads
      // more intuitively as a fraction of the max prize.
      for (var gv = 0; gv <= 100; gv += 20) {
        var yy = yOf(gv);
        parts.push('<line class="grid" x1="' + PAD_L + '" y1="' + yy + '" x2="' + (VW - PAD_R) + '" y2="' + yy + '"/>');
        parts.push('<text class="axt" x="' + (PAD_L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + (gv / 100).toFixed(1) + '</text>');
      }
      for (var gp = 1; gp <= N; gp += (gp === 1 ? 19 : 20)) { // 1,20,40,60,80,100
        var xx = xOf(gp);
        parts.push('<line class="grid" x1="' + xx + '" y1="' + PAD_T + '" x2="' + xx + '" y2="' + (PAD_T + PH) + '"/>');
        parts.push('<text class="axt" x="' + xx + '" y="' + (VH - PAD_B + 18) + '" text-anchor="middle">' + gp + '</text>');
      }
      parts.push('<text class="axtitle" x="' + (PAD_L + PW / 2) + '" y="' + (VH - 4) + '" text-anchor="middle">position</text>');
      parts.push('<text class="axtitle" transform="translate(14 ' + (PAD_T + PH / 2) + ') rotate(-90)" text-anchor="middle">value</text>');

      // Every overlay below is opt-in via an explicit flag. The AI region /
      // training points / interpolation line / ground truth are TESTING or
      // end-of-study DEBRIEF only — the app never sets these flags for a real
      // participant mid-play.

      // --- assistant coverage bands (patches [[a,b],...]) ---
      if (st.showCoverage && st.coverage && st.coverage.length) {
        for (var ci = 0; ci < st.coverage.length; ci++) {
          var cb = xOf(st.coverage[ci][0]), cb2 = xOf(st.coverage[ci][1]);
          parts.push('<rect class="cov-band" x="' + cb + '" y="' + PAD_T + '" width="' + (cb2 - cb) + '" height="' + PH + '"/>');
        }
        var f = st.coverage[0], fmid = (xOf(f[0]) + xOf(f[1])) / 2;
        parts.push('<text class="cov-label" x="' + fmid + '" y="' + (PAD_T + 13) + '" text-anchor="middle">assistant coverage</text>');
      }

      // --- ground-truth line ---
      if (st.showTruth && st.truth) {
        var d = '';
        for (var i = 0; i < st.truth.length; i++) d += (i ? 'L' : 'M') + xOf(i + 1).toFixed(1) + ' ' + yOf(st.truth[i]).toFixed(1) + ' ';
        parts.push('<path class="dbg-line" d="' + d + '"/>');
      }
      // --- AI estimate line: what the assistant would answer at EVERY position —
      //     piecewise-linear interpolation between its training points, and flat
      //     extrapolation (holding the nearest point) beyond the outermost ones. ---
      if (st.showInterp && st.dots && st.dots.length) {
        var ds = st.dots, seg = 'M' + xOf(1).toFixed(1) + ' ' + yOf(ds[0][1]).toFixed(1) + ' ';
        for (var si = 0; si < ds.length; si++) seg += 'L' + xOf(ds[si][0]).toFixed(1) + ' ' + yOf(ds[si][1]).toFixed(1) + ' ';
        seg += 'L' + xOf(N).toFixed(1) + ' ' + yOf(ds[ds.length - 1][1]).toFixed(1) + ' ';
        parts.push('<path class="interp-line" d="' + seg + '"/>');
      }
      // --- AI training points ---
      if (st.showDots && st.dots) {
        for (var k = 0; k < st.dots.length; k++) {
          parts.push('<circle class="dbg-dot" cx="' + xOf(st.dots[k][0]) + '" cy="' + yOf(st.dots[k][1]) + '" r="4"/>');
        }
      }
      // --- corner tag (testing: mapping id · stratum) ---
      if (st.tag) {
        parts.push('<text class="dbg-txt" x="' + (VW - PAD_R) + '" y="' + (PAD_T + 12) + '" text-anchor="end">' + esc(st.tag) + '</text>');
      }

      // --- selection highlight ---
      if (sel != null) {
        var sxp = xOf(sel);
        parts.push('<line class="sel-line" x1="' + sxp + '" y1="' + PAD_T + '" x2="' + sxp + '" y2="' + (PAD_T + PH) + '"/>');
        parts.push('<text class="sel-txt" x="' + sxp + '" y="' + (PAD_T - 3) + '" text-anchor="middle">' + sel + '</text>');
      }

      // --- assistant estimate diamonds (Arm B) ---
      for (var e = 0; e < estimates.length; e++) {
        var ex = xOf(estimates[e].pos), ey = yOf(estimates[e].val), r = 6;
        var dpath = 'M' + ex + ' ' + (ey - r) + 'L' + (ex + r) + ' ' + ey + 'L' + ex + ' ' + (ey + r) + 'L' + (ex - r) + ' ' + ey + 'Z';
        parts.push('<path class="est-diamond" d="' + dpath + '"><title>assistant estimate (not guaranteed)</title></path>');
      }

      // --- revealed truth dots + value labels ---
      // Labels use the same [0,1] scale as the y-axis they sit on.
      for (var v = 0; v < revealed.length; v++) {
        var rx = xOf(revealed[v].pos), ry = yOf(revealed[v].val);
        parts.push('<circle class="rev-dot" cx="' + rx + '" cy="' + ry + '" r="4.5"/>');
        parts.push('<text class="rev-lbl" x="' + rx + '" y="' + (ry - 8) + '" text-anchor="middle">' + (revealed[v].val / 100).toFixed(2) + '</text>');
      }

      svg.innerHTML = parts.join('');
    }

    return { render: render, el: svg };
  }

  return { create: create };
})();
