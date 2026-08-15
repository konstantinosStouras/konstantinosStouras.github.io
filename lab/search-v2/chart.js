/* ==========================================================================
   search-v2  ·  chart.js
   The centre panel of design brief §14: a horizontal axis of {J} positions and a
   vertical axis FIXED at 0 to 100 points — never autoscaled, so the visual
   difficulty of a round can never depend on its realised range.

   Marker vocabulary (§12, display rules):
     · pre-opened  — filled square, the true prize, free at the start of the round
     · revealed    — filled circle, the true prize the participant paid for
     · asked       — open diamond, the AI's STATED value at that position
   A position that was both asked and revealed shows BOTH markers, so the
   discrepancy between what the machine said and what was there stays on screen.

   The renderer is pure: it draws only what it is handed. Unrevealed truth and
   the AI's private anchors reach it only when the caller explicitly turns on the
   testing/debrief overlays, which the app never does for a live participant.
   ========================================================================== */
window.SVChart = (function () {
  'use strict';

  var VW = 960, VH = 400;
  var PAD_L = 48, PAD_R = 16, PAD_T = 18, PAD_B = 38;
  var PW = VW - PAD_L - PAD_R;
  var PH = VH - PAD_T - PAD_B;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function create(container, opts) {
    opts = opts || {};
    var N = opts.positions || 100;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
    svg.setAttribute('class', 'plot-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'The line of positions. Markers show what you have paid to learn.');
    container.appendChild(svg);

    function xOf(p) { return PAD_L + (p - 1) / (N - 1) * PW; }
    function yOf(v) { return PAD_T + (1 - v / 100) * PH; }

    function posFromEvent(ev) {
      var rect = svg.getBoundingClientRect();
      var clientX = (ev.touches && ev.touches.length) ? ev.touches[0].clientX : ev.clientX;
      var sx = (clientX - rect.left) / rect.width * VW;
      var p = Math.round(1 + (sx - PAD_L) / PW * (N - 1));
      return Math.max(1, Math.min(N, p));
    }
    // A click only MOVES the cursor. Every costly action lives on its own button
    // (§14), so the plot can never charge a participant by accident.
    if (opts.onSelect) svg.addEventListener('click', function (ev) { opts.onSelect(posFromEvent(ev), 'click'); });

    function render(st) {
      st = st || {};
      var parts = [];
      var i, m;

      parts.push('<defs><clipPath id="svplotclip"><rect x="' + PAD_L + '" y="' + PAD_T +
        '" width="' + PW + '" height="' + PH + '"/></clipPath></defs>');

      // ---- axes: y FIXED at 0..100, always ----------------------------------
      for (var gv = 0; gv <= 100; gv += 20) {
        var yy = yOf(gv);
        parts.push('<line class="grid" x1="' + PAD_L + '" y1="' + yy + '" x2="' + (VW - PAD_R) + '" y2="' + yy + '"/>');
        parts.push('<text class="axt" x="' + (PAD_L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + gv + '</text>');
      }
      for (var gp = 1; gp <= N; gp += (gp === 1 ? N / 5 - 1 : N / 5)) {
        var xx = xOf(Math.round(gp));
        parts.push('<line class="grid" x1="' + xx + '" y1="' + PAD_T + '" x2="' + xx + '" y2="' + (PAD_T + PH) + '"/>');
        // The selected position is printed in this same row (see below), so a
        // tick that would sit under it is dropped rather than overprinted.
        var nearSel = (st.selected != null && Math.abs(Math.round(gp) - st.selected) < N / 20);
        if (!nearSel) {
          parts.push('<text class="axt" x="' + xx + '" y="' + (VH - PAD_B + 17) + '" text-anchor="middle">' + Math.round(gp) + '</text>');
        }
      }
      parts.push('<text class="axtitle" x="' + (PAD_L + PW / 2) + '" y="' + (VH - 3) + '" text-anchor="middle">position</text>');
      parts.push('<text class="axtitle" transform="translate(12 ' + (PAD_T + PH / 2) + ') rotate(-90)" text-anchor="middle">points</text>');

      var clip = ' clip-path="url(#svplotclip)"';

      // ---- testing / debrief overlays (never on for a live participant) -----
      if (st.showTruth && st.truth) {
        var d = '';
        for (i = 0; i < st.truth.length; i++) d += (i ? 'L' : 'M') + xOf(i + 1).toFixed(1) + ' ' + yOf(st.truth[i]).toFixed(1) + ' ';
        parts.push('<path class="gt-line" d="' + d + '"' + clip + '/>');
      }
      if (st.showAiCurve && st.aiCurve) {
        var c = '';
        for (i = 0; i < st.aiCurve.length; i++) c += (i ? 'L' : 'M') + xOf(i + 1).toFixed(1) + ' ' + yOf(st.aiCurve[i]).toFixed(1) + ' ';
        parts.push('<path class="ai-line" d="' + c + '"' + clip + '/>');
      }
      if (st.showAnchors && st.anchors) {
        for (i = 0; i < st.anchors.length; i++) {
          var ap = st.anchors[i];
          parts.push('<circle class="anchor-dot" cx="' + xOf(ap.pos).toFixed(1) + '" cy="' + yOf(ap.val).toFixed(1) + '" r="4.4"><title>AI private anchor</title></circle>');
        }
      }

      // ---- selection --------------------------------------------------------
      if (st.selected != null) {
        var sxp = xOf(st.selected);
        parts.push('<line class="sel-line" x1="' + sxp.toFixed(1) + '" y1="' + PAD_T + '" x2="' + sxp.toFixed(1) + '" y2="' + (PAD_T + PH) + '"/>');
        // The selected position is labelled at BOTH ends of its line (owner
        // 2026-08). The plot is 400px tall: with the number only at the top, a
        // participant reading the x-axis at the bottom had to track a dashed
        // line the height of the chart to find out which position they were on.
        parts.push('<text class="sel-txt" x="' + sxp.toFixed(1) + '" y="' + (PAD_T - 5) + '" text-anchor="middle">' + st.selected + '</text>');
        parts.push('<text class="sel-txt" x="' + sxp.toFixed(1) + '" y="' + (VH - PAD_B + 17) +
          '" text-anchor="middle">' + st.selected + '</text>');
      }

      // ---- asked: open diamonds at the AI's STATED value --------------------
      var asked = st.asked || [];
      for (i = 0; i < asked.length; i++) {
        var ex = xOf(asked[i].pos), ey = yOf(asked[i].val), r = 6.2;
        parts.push('<path class="ask-diamond" d="M' + ex.toFixed(1) + ' ' + (ey - r).toFixed(1) +
          'L' + (ex + r).toFixed(1) + ' ' + ey.toFixed(1) +
          'L' + ex.toFixed(1) + ' ' + (ey + r).toFixed(1) +
          'L' + (ex - r).toFixed(1) + ' ' + ey.toFixed(1) + 'Z"><title>AI said ' +
          asked[i].val + ' at position ' + asked[i].pos + '</title></path>');
        // Labelled like the other marks. The side panel used to list every answer
        // in words; with that gone the plot is the only record, so it has to
        // carry the number rather than hide it in a hover tooltip.
        parts.push('<text class="mark-lbl ask" x="' + ex.toFixed(1) + '" y="' + (ey - 11).toFixed(1) +
          '" text-anchor="middle">' + asked[i].val + '</text>');
      }

      // ---- pre-opened: filled squares at the true prize ---------------------
      var pre = st.preOpened || [];
      for (i = 0; i < pre.length; i++) {
        var px = xOf(pre[i].pos), py = yOf(pre[i].val), h = 5;
        parts.push('<rect class="pre-mark" x="' + (px - h).toFixed(1) + '" y="' + (py - h).toFixed(1) +
          '" width="' + (2 * h) + '" height="' + (2 * h) + '"><title>Open at the start: ' +
          pre[i].val + ' at position ' + pre[i].pos + '</title></rect>');
        parts.push('<text class="mark-lbl" x="' + px.toFixed(1) + '" y="' + (py - 10).toFixed(1) + '" text-anchor="middle">' + pre[i].val + '</text>');
      }

      // ---- revealed: filled circles at the true prize -----------------------
      var rev = st.revealed || [];
      for (i = 0; i < rev.length; i++) {
        var rx = xOf(rev[i].pos), ry = yOf(rev[i].val);
        parts.push('<circle class="rev-mark" cx="' + rx.toFixed(1) + '" cy="' + ry.toFixed(1) + '" r="5"><title>You revealed ' +
          rev[i].val + ' at position ' + rev[i].pos + '</title></circle>');
        parts.push('<text class="mark-lbl" x="' + rx.toFixed(1) + '" y="' + (ry - 10).toFixed(1) + '" text-anchor="middle">' + rev[i].val + '</text>');
      }

      // ---- the nominated position (end-of-round reveal) ---------------------
      if (st.nominated != null) {
        var nx = xOf(st.nominated.pos), ny = yOf(st.nominated.val);
        parts.push('<line class="nom-line" x1="' + nx.toFixed(1) + '" y1="' + PAD_T + '" x2="' + nx.toFixed(1) + '" y2="' + (PAD_T + PH) + '"/>');
        parts.push('<circle class="nom-mark" cx="' + nx.toFixed(1) + '" cy="' + ny.toFixed(1) + '" r="8"/>');
        parts.push('<text class="nom-lbl" x="' + nx.toFixed(1) + '" y="' + (ny - 14).toFixed(1) + '" text-anchor="middle">' + st.nominated.val + '</text>');
      }

      if (st.tag) parts.push('<text class="dbg-txt" x="' + (VW - PAD_R) + '" y="' + (PAD_T + 11) + '" text-anchor="end">' + esc(st.tag) + '</text>');

      svg.innerHTML = parts.join('');
    }

    return { render: render, el: svg, xOf: xOf, yOf: yOf };
  }

  return { create: create };
})();
