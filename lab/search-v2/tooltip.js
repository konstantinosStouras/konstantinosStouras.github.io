/* ==========================================================================
   search-v2  ·  tooltip.js
   Fast hover tooltips, shared by the admin panel and the participant game page.

   The browser's native `title` tooltip only appears after a long, fixed
   built-in delay (~0.5–1.5s) that CSS/JS cannot shorten. This replaces it with
   a single styled bubble that shows almost instantly on hover.

   How it works: one delegated `mouseover` listener finds the nearest element
   carrying a tooltip. On first hover we move its `title` onto `data-tip` and
   delete `title` (so the slow native popup never fires), then position and show
   the bubble. Delegation means dynamically-injected tooltips (e.g. the content
   accordions, session cards, per-round stat strip) are covered automatically —
   no re-init needed. Requires the `.tip-pop` styles (in each page's CSS).
   ========================================================================== */
(function () {
  'use strict';

  var SHOW_MS = 40;   // near-instant; small enough to feel immediate, big enough
                      // to avoid a flash while the pointer merely passes through.
  var GAP = 8, PAD = 6;

  var tip = document.createElement('div');
  tip.className = 'tip-pop';
  tip.setAttribute('role', 'tooltip');
  (document.body || document.documentElement).appendChild(tip);

  var current = null, timer = null;

  // Pull a native `title` onto `data-tip` once, so the browser's slow tooltip
  // is suppressed forever after and we own the display. Returns the tip text.
  function textFor(el) {
    var t = el.getAttribute('title');
    if (t != null && t !== '') {
      el.setAttribute('data-tip', t);
      el.removeAttribute('title');
      // Preserve the description for assistive tech now that `title` is gone.
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
    }
    return el.getAttribute('data-tip') || '';
  }

  // Walk up to the nearest element that carries (or carried) a tooltip.
  function nearest(el) {
    while (el && el.nodeType === 1 && el !== document.body) {
      if (el.hasAttribute('title') || el.hasAttribute('data-tip')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function place(el) {
    var r = el.getBoundingClientRect();
    tip.classList.add('show');               // must be laid out to measure
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = r.left + r.width / 2 - tw / 2;
    var top = r.top - th - GAP;              // prefer above the element…
    if (top < PAD) top = r.bottom + GAP;     // …flip below if there's no room.
    left = Math.max(PAD, Math.min(left, window.innerWidth - tw - PAD));
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function open(el) {
    var text = textFor(el);
    if (!text) return;
    current = el;
    tip.textContent = text;
    place(el);
  }

  function close() {
    if (timer) { clearTimeout(timer); timer = null; }
    current = null;
    tip.classList.remove('show');
  }

  document.addEventListener('mouseover', function (e) {
    var el = nearest(e.target);
    if (!el) { if (current || timer) close(); return; }
    if (el === current) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; open(el); }, SHOW_MS);
  });

  document.addEventListener('mouseout', function (e) {
    var el = nearest(e.target);
    if (!el) return;
    // Moving to a descendant of the same tipped element is not a leave.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    close();
  });

  // A tooltip pinned to a moved element would be stale — dismiss it.
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
})();
