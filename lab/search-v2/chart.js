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
    // Single click / mouse move only move the cursor; a double click reveals.
    if (opts.onSelect) {
      svg.addEventListener('click', function (ev) { opts.onSelect(posFromEvent(ev)); });
    }
    if (opts.onReveal) {
      svg.addEventListener('dblclick', function (ev) { opts.onReveal(posFromEvent(ev)); });
    }
    if (opts.onHover) {
      svg.addEventListener('mousemove', function (ev) { opts.onHover(posFromEvent(ev)); });
    }

    function render(st) {
      st = st || {};
      var arm = st.arm;
      var sel = st.selected;
      var revealed = st.revealed || [];
      var estimates = st.estimates || [];
      var parts = [];

      // clip so a steep extrapolation line is cut at the plot frame
      parts.push('<defs><clipPath id="plotclip"><rect x="' + PAD_L + '" y="' + PAD_T + '" width="' + PW + '" height="' + PH + '"/></clipPath></defs>');

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
      // training points / interpolation / extrapolation / ground truth are
      // TESTING or end-of-study DEBRIEF only — the app never sets these flags for
      // a real participant mid-play. The styling mirrors /lab/interpolation:
      // blue Brownian truth, red training points, green interpolation within the
      // region(s), amber dashed extrapolation + shaded zones beyond/between them.

      // --- extrapolation zones (amber shaded bands + label) — with interpolation
      if (st.showInterp && st.zones && st.zones.length) {
        for (var zi = 0; zi < st.zones.length; zi++) {
          var z = st.zones[zi], zx = xOf(z.x0), zx2 = xOf(z.x1);
          if (zx2 - zx < 2) continue;
          parts.push('<rect class="extrap-zone" x="' + zx + '" y="' + PAD_T + '" width="' + (zx2 - zx) + '" height="' + PH + '"/>');
          parts.push('<text class="extrap-label" x="' + ((zx + zx2) / 2) + '" y="' + (PAD_T + 12) + '" text-anchor="middle">extrapolation</text>');
        }
      }

      // --- assistant coverage / interpolation region(s) (light blue band) ---
      if (st.showCoverage && st.coverage && st.coverage.length) {
        for (var ci = 0; ci < st.coverage.length; ci++) {
          var cb = xOf(st.coverage[ci][0]), cb2 = xOf(st.coverage[ci][1]);
          parts.push('<rect class="cov-band" x="' + cb + '" y="' + PAD_T + '" width="' + (cb2 - cb) + '" height="' + PH + '"/>');
        }
        var f = st.coverage[0], fmid = (xOf(f[0]) + xOf(f[1])) / 2;
        parts.push('<text class="cov-label" x="' + fmid + '" y="' + (PAD_T + 13) + '" text-anchor="middle">assistant coverage</text>');
      }

      // --- ground-truth line (blue, thick) ---
      if (st.showTruth && st.truth) {
        var d = '';
        for (var i = 0; i < st.truth.length; i++) d += (i ? 'L' : 'M') + xOf(i + 1).toFixed(1) + ' ' + yOf(st.truth[i]).toFixed(1) + ' ';
        parts.push('<path class="gt-line" d="' + d + '"/>');
      }
      // Interp/extrap lines are clipped to the plot so a steep extrapolation that
      // leaves [0,1] is cut at the frame rather than spilling over the axes.
      var clip = ' clip-path="url(#plotclip)"';
      // --- AI extrapolation (amber dashed): edge continuations beyond/between ---
      if (st.showInterp && st.extrap && st.extrap.length) {
        for (var ei = 0; ei < st.extrap.length; ei++) {
          var s = st.extrap[ei];
          parts.push('<line class="extrap-line" x1="' + xOf(s.x0).toFixed(1) + '" y1="' + yOf(s.y0).toFixed(1) + '" x2="' + xOf(s.x1).toFixed(1) + '" y2="' + yOf(s.y1).toFixed(1) + '"' + clip + '/>');
        }
      }
      // --- AI interpolation (green): consecutive training points WITHIN a region
      if (st.showInterp && st.interp && st.interp.length) {
        for (var gi = 0; gi < st.interp.length; gi++) {
          var pl = st.interp[gi], pts = [];
          for (var pk = 0; pk < pl.length; pk++) pts.push(xOf(pl[pk][0]).toFixed(1) + ',' + yOf(pl[pk][1]).toFixed(1));
          if (pts.length) parts.push('<polyline class="interp-seg" points="' + pts.join(' ') + '"' + clip + '/>');
        }
      }
      // --- AI training points (red) ---
      if (st.showDots && st.dotGroups) {
        for (var dg = 0; dg < st.dotGroups.length; dg++) {
          var grp = st.dotGroups[dg];
          for (var k = 0; k < grp.length; k++) {
            parts.push('<circle class="train-dot" cx="' + xOf(grp[k][0]) + '" cy="' + yOf(grp[k][1]) + '" r="4.2"/>');
          }
        }
      }
      // --- search-window overlay (testing): shaded "dead zones" where the max
      //     feasible value M(x) <= best (revealing there is an obvious mistake),
      //     the ceiling M(x), and the best-so-far acceptance line. ---
      if (st.showWindow && st.windowCeiling && st.windowCeiling.length) {
        var wc = st.windowCeiling, wb = st.windowBest || 0, half = (PW / (N - 1)) / 2, rs = -1;
        for (var wp = 1; wp <= N + 1; wp++) {
          var wdead = wp <= N && wc[wp - 1] <= wb;
          if (wdead && rs < 0) rs = wp;
          if (!wdead && rs >= 0) {
            var wxa = xOf(rs) - half, wxb = xOf(wp - 1) + half;
            parts.push('<rect class="win-dead" x="' + wxa.toFixed(1) + '" y="' + PAD_T + '" width="' + Math.max(1, wxb - wxa).toFixed(1) + '" height="' + PH + '"/>');
            rs = -1;
          }
        }
        parts.push('<line class="win-best" x1="' + PAD_L + '" y1="' + yOf(wb).toFixed(1) + '" x2="' + (VW - PAD_R) + '" y2="' + yOf(wb).toFixed(1) + '"/>');
        var wceil = '';
        for (var wj = 0; wj < wc.length; wj++) wceil += (wj ? 'L' : 'M') + xOf(wj + 1).toFixed(1) + ' ' + yOf(wc[wj]).toFixed(1) + ' ';
        parts.push('<path class="win-ceil" d="' + wceil + '"/>');
        parts.push('<text class="win-lbl" x="' + (VW - PAD_R - 2) + '" y="' + (yOf(wb) - 4).toFixed(1) + '" text-anchor="end">best-so-far · window ceiling</text>');
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
