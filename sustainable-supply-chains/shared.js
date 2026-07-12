/* ==========================================================================
   Sustainable Supply Chains — shared.js
   Small shared UI toolkit for the student app and the admin panel: DOM
   helpers, number formatting, theme toggle, and dependency-free inline-SVG
   charts (multi-series lines and bars) used for results and the debrief.
   ========================================================================== */
window.SSCUI = (function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtInt(n) {
    if (n == null || !isFinite(n)) return '–';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return '–';
    var v = Math.round(n);
    return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
  }
  function fmtPct(x, dp) {
    if (x == null || !isFinite(x)) return '–';
    return (x * 100).toFixed(dp == null ? 0 : dp) + '%';
  }
  function fmtCO2(kg) {
    if (kg == null || !isFinite(kg)) return '–';
    return kg >= 10000 ? (kg / 1000).toFixed(1) + ' t' : fmtInt(kg) + ' kg';
  }
  function esgClass(v) { return v >= 75 ? 'esg-hi' : (v >= 60 ? 'esg-mid' : 'esg-lo'); }
  function posneg(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }

  /* ---- theme -------------------------------------------------------------- */
  function themeInit(btn) {
    var saved = null;
    try { saved = localStorage.getItem('ssc-theme'); } catch (e) {}
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    function paint() {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (btn) btn.textContent = dark ? '☀' : '☾';
    }
    paint();
    if (btn) btn.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('ssc-theme', dark ? 'light' : 'dark'); } catch (e) {}
      paint();
    });
  }

  /* ---- charts ---------------------------------------------------------------
     lineChart({ series:[{name,color,values:[y…] (index = x)}, …], labels:[x…],
                 width, height, yFmt }) → svg markup string. */
  var PALETTE = ['#c8562a', '#1f5f8b', '#2e7d32', '#8e5bc0', '#b3760f', '#4a4f55', '#c2185b', '#00838f'];

  function niceTicks(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (lo === hi) { hi = lo + 1; }
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / (n || 4))));
    var err = span / ((n || 4) * step);
    if (err >= 7.5) step *= 10; else if (err >= 3) step *= 5; else if (err >= 1.5) step *= 2;
    var t0 = Math.ceil(lo / step) * step, out = [];
    for (var t = t0; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
    return out;
  }

  function lineChart(opts) {
    var series = opts.series || [], labels = opts.labels || [];
    var W = opts.width || 520, H = opts.height || 220;
    var padL = 52, padR = 10, padT = 10, padB = 26;
    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); }); });
    if (!all.length) all = [0, 1];
    var lo = Math.min.apply(null, all.concat([0])), hi = Math.max.apply(null, all);
    if (lo === hi) hi = lo + 1;
    var ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    var n = Math.max(2, labels.length || (series[0] && series[0].values.length) || 2);
    function X(i) { return padL + (W - padL - padR) * (i / (n - 1)); }
    function Y(v) { return padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo)); }
    var fmt = opts.yFmt || function (v) { return Math.abs(v) >= 1000 ? (v / 1000) + 'k' : String(v); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" style="max-width:' + W + 'px">';
    ticks.forEach(function (t) {
      var y = Y(t);
      out += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="currentColor" stroke-opacity="0.12"/>' +
             '<text x="' + (padL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.55">' + fmt(t) + '</text>';
    });
    for (var i = 0; i < n; i++) {
      var lab = labels[i] != null ? labels[i] : (i + 1);
      out += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.55">' + esc(lab) + '</text>';
    }
    if (lo < 0 && hi > 0) {
      out += '<line x1="' + padL + '" y1="' + Y(0) + '" x2="' + (W - padR) + '" y2="' + Y(0) + '" stroke="currentColor" stroke-opacity="0.35"/>';
    }
    series.forEach(function (s, si) {
      var color = s.color || PALETTE[si % PALETTE.length];
      var d = '', started = false;
      s.values.forEach(function (v, i) {
        if (v == null || !isFinite(v)) { started = false; return; }
        d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
        started = true;
      });
      out += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>';
      s.values.forEach(function (v, i) {
        if (v == null || !isFinite(v)) return;
        out += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6" fill="' + color + '"><title>' +
               esc((s.name ? s.name + ' · ' : '') + (labels[i] != null ? labels[i] : 'x=' + (i + 1)) + ': ' + v) + '</title></circle>';
      });
    });
    out += '</svg>';
    return out;
  }

  function legendHtml(series) {
    return '<div class="legend">' + series.map(function (s, i) {
      return '<span><span class="sw" style="background:' + (s.color || PALETTE[i % PALETTE.length]) + '"></span>' + esc(s.name || '') + '</span>';
    }).join('') + '</div>';
  }

  function barChart(opts) {
    var items = opts.items || [];
    var W = opts.width || 520, rowH = 26, padL = opts.padL || 130, padR = 60;
    var H = items.length * rowH + 8;
    var vals = items.map(function (it) { return it.value; }).filter(isFinite);
    var hi = Math.max.apply(null, vals.concat([1])), lo = Math.min.apply(null, vals.concat([0]));
    var span = hi - lo || 1;
    var zeroX = padL + (W - padL - padR) * ((0 - lo) / span);
    var fmt = opts.fmt || function (v) { return String(v); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" style="max-width:' + W + 'px">';
    items.forEach(function (it, i) {
      var y = i * rowH + 5;
      var x = padL + (W - padL - padR) * ((it.value - lo) / span);
      var x0 = Math.min(zeroX, x), w = Math.abs(x - zeroX);
      // value label: right of the bar for positives, right of the zero line for
      // negatives (the area right of zero is empty there — avoids colliding
      // with the category label on the left)
      var lx = it.value >= 0 ? x + 5 : zeroX + 5;
      out += '<text x="' + (padL - 8) + '" y="' + (y + 12) + '" text-anchor="end" font-size="11" fill="currentColor" fill-opacity="0.8">' + esc(it.label) + '</text>' +
             '<rect x="' + x0.toFixed(1) + '" y="' + y + '" width="' + Math.max(1, w).toFixed(1) + '" height="16" rx="3" fill="' + (it.color || PALETTE[0]) + '" fill-opacity="0.85"><title>' + esc(it.label + ': ' + fmt(it.value)) + '</title></rect>' +
             '<text x="' + lx.toFixed(1) + '" y="' + (y + 12) + '" font-size="10.5" fill="currentColor" fill-opacity="0.7">' + esc(fmt(it.value)) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  // Clipboard with a fallback for browsers/contexts where the async Clipboard
  // API is unavailable (older Safari, some embedded webviews).
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  return { $: $, $all: $all, esc: esc, el: el,
           fmtInt: fmtInt, fmtMoney: fmtMoney, fmtPct: fmtPct, fmtCO2: fmtCO2,
           esgClass: esgClass, posneg: posneg, themeInit: themeInit, copyText: copyText,
           lineChart: lineChart, barChart: barChart, legendHtml: legendHtml,
           palette: PALETTE, download: download };
})();
