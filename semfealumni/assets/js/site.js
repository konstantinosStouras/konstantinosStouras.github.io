/* SEMFE Alumni: page behaviour shared by every page. No dependencies.
   The phone menu, the photo lightbox, copy-to-clipboard buttons, the
   announcements filter and the "apply online" switch on the support page.
   Written in plain ES5 so it runs in every browser the site supports. */
(function () {
  'use strict';
  var C = window.SEMFE || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  /* ---- phone menu ---- */
  var toggle = $('.nav-toggle'), nav = $('#nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Κλείσιμο μενού' : 'Άνοιγμα μενού');
    };
    toggle.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!nav.classList.contains('open')); });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !closest(e.target, '.site-header')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 1101px)');
      var onChange = function () { if (mq.matches) setOpen(false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---- copy buttons (IBAN, BIC) ---- */
  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = $(btn.getAttribute('data-copy'));
      var text = src ? src.textContent.trim() : '';
      copyText(text, function (ok) {
        if (btn._orig == null) btn._orig = btn.innerHTML;   // the label, recorded once
        clearTimeout(btn._t);                               // a second click replaces the pending reset
        var msg = ok ? 'Αντιγράφηκε ✓' : 'Επιλέξτε και αντιγράψτε';
        btn.textContent = msg;
        btn.classList.toggle('done', ok);
        announce(msg);
        btn._t = setTimeout(function () { btn.innerHTML = btn._orig; btn.classList.remove('done'); }, 2200);
      });
    });
  });

  /* ---- announcements filter ---- */
  var filter = $('[data-post-filter]'), list = $('#post-list'), count = $('[data-post-count]');
  if (filter && list) {
    filter.hidden = false;
    var buttons = $$('button', filter);
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        var cat = b.getAttribute('data-cat'), shown = 0;
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $$('.post-card', list).forEach(function (card) {
          card.hidden = !!cat && card.getAttribute('data-cat') !== cat;
          if (!card.hidden) shown++;
        });
        if (count) count.textContent = shown + (shown === 1 ? ' ανακοίνωση' : ' ανακοινώσεις');
      });
    });
  }

  /* ---- support page: apply online once sign-in is switched on ---- */
  var online = $('[data-apply-online]'), legacy = $('[data-apply-legacy]');
  if (online && legacy && firebaseConfigured()) { online.hidden = false; legacy.hidden = true; }

  /* ---- photo lightbox ---- */
  $$('[data-gallery]').forEach(function (gal) {
    var items = $$('a', gal);
    items.forEach(function (a, i) {
      // a distinct accessible name for each photo link
      var im = a.querySelector('img');
      var base = (im && im.alt) || a.getAttribute('data-caption') || 'Φωτογραφία';
      a.setAttribute('aria-label', base + ' (φωτογραφία ' + (i + 1) + ' από ' + items.length + ')');
      a.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
        e.preventDefault();
        openLightbox(items, i);
      });
    });
  });

  function openLightbox(items, start) {
    var idx = start, opener = items[start];     // Safari does not focus links on click
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Φωτογραφία');
    box.innerHTML = '<div class="lb-stage"><img alt=""></div><div class="lb-cap" aria-live="polite"></div>' +
      '<span class="lb-count" aria-live="polite"></span>' +
      '<button type="button" class="lb-prev" aria-label="Προηγούμενη φωτογραφία">' + ICON_L + '</button>' +
      '<button type="button" class="lb-next" aria-label="Επόμενη φωτογραφία">' + ICON_R + '</button>' +
      '<button type="button" class="lb-close" aria-label="Κλείσιμο">' + ICON_X + '</button>';
    document.body.appendChild(box);
    lockScroll();
    var img = $('img', box), cap = $('.lb-cap', box), count = $('.lb-count', box);
    var show = function (i) {
      idx = (i + items.length) % items.length;
      var a = items[idx];
      img.src = a.getAttribute('href');
      img.alt = (a.querySelector('img') || {}).alt || '';
      cap.textContent = a.getAttribute('data-caption') || '';
      count.textContent = (idx + 1) + ' / ' + items.length;
    };
    var close = function () {
      document.removeEventListener('keydown', onKey);
      box.parentNode.removeChild(box);
      unlockScroll();
      if (opener && opener.focus) opener.focus();
    };
    var onKey = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'Tab') trapTab(e, box);
    };
    $('.lb-close', box).addEventListener('click', close);
    $('.lb-prev', box).addEventListener('click', function () { show(idx - 1); });
    $('.lb-next', box).addEventListener('click', function () { show(idx + 1); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.className === 'lb-stage') close(); });
    // swipe on touch screens
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('keydown', onKey);
    show(idx);
    $('.lb-close', box).focus();
  }

  /* ---- helpers, shared with auth.js through window.SEMFE_UTIL ---- */
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function trapTab(e, container) {
    var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    // focus on <body> (after a click on plain text, or on a button in Safari) is pulled back in
    if (f.indexOf(document.activeElement) === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else done(fallback());
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    }
  }
  /* one shared polite live region for short confirmations */
  var live;
  function announce(msg) {
    if (!live) { live = document.createElement('span'); live.className = 'sr-only'; live.setAttribute('role', 'status'); document.body.appendChild(live); }
    live.textContent = '';
    setTimeout(function () { live.textContent = msg; }, 50);   // clear then set, so a repeat is read again
  }
  /* stop the page scrolling under a dialog; position:fixed also works on iOS 15,
     where overflow:hidden on <body> does not */
  function lockScroll() {
    var b = document.body;
    if (b.classList.contains('modal-open')) return;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    b.setAttribute('data-lock-y', String(y));
    b.style.position = 'fixed'; b.style.top = (-y) + 'px'; b.style.width = '100%';
    b.classList.add('modal-open');
  }
  function unlockScroll() {
    var b = document.body, h = document.documentElement;
    if (!b.classList.contains('modal-open')) return;
    var y = +b.getAttribute('data-lock-y') || 0;
    b.classList.remove('modal-open'); b.removeAttribute('data-lock-y');
    b.style.position = ''; b.style.top = ''; b.style.width = '';
    var sb = h.style.scrollBehavior; h.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    h.style.scrollBehavior = sb;
  }
  function firebaseConfigured() {
    var f = C.FIREBASE || {};
    return !!(f.apiKey && f.projectId && String(f.apiKey).indexOf('PASTE_') === -1 && String(f.projectId).indexOf('PASTE_') === -1);
  }
  window.SEMFE_UTIL = { closest: closest, trapTab: trapTab, copyText: copyText, firebaseConfigured: firebaseConfigured,
    announce: announce, lockScroll: lockScroll, unlockScroll: unlockScroll };
})();
