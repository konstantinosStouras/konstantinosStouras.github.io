/* SEMFE Alumni: sign-in and registration (Firebase Authentication).
 *
 * Providers: Google, Facebook, LinkedIn (OpenID Connect) and e-mail +
 * password. Loads the Firebase "compat" SDK from gstatic only when
 * config.js holds a real Firebase config; until then the header's
 * "Σύνδεση" button opens the same dialog with the buttons switched off and a
 * note that registration opens soon, so the page never breaks.
 *
 * Why popups, not redirects: the site (stouras.com) and Firebase's auth
 * handler (<project>.firebaseapp.com) are different domains, and Safari,
 * Firefox and Chrome now partition third-party storage, which breaks
 * signInWithRedirect for exactly this setup. signInWithPopup works in all of
 * them, provided it is called straight from the click (no await before it),
 * which is why the SDK is loaded as soon as the page is idle.
 *
 * Accounts that share an e-mail: with Firebase's default "one account per
 * e-mail address", signing in with a second provider for an address that
 * already has an account fails with auth/account-exists-with-different-
 * credential. We keep that credential, ask the person to sign in the way
 * they did the first time, and then link it, so they end up with ONE
 * account that opens with either provider.
 *
 * Public API (window.SemfeAuth), used by account.js / members.js / admin.js:
 *   configured            true when config.js has a real Firebase config
 *   onChange(fn)          fn(user|null) now (once known) and on every change
 *   open(mode, trigger?)  open the dialog: 'signin' | 'register'; focus returns to trigger
 *   signOut()
 *   db()                  Promise<firestore> (loads Firestore on first use)
 *   isAdmin(user)         true for a verified address in ADMIN_EMAILS
 *   providers(user)       ['google','facebook','linkedin','password'] linked
 *   link(key)             Promise: link another provider to this account
 *   reauth(user)          Promise: re-prove identity (before deleting)
 *   friendly(err)         Greek message for a Firebase error
 *   root                  relative path back to the site root
 */
(function () {
  'use strict';
  var C = window.SEMFE || {};
  var U = window.SEMFE_UTIL || {};
  var FB = C.FIREBASE || {};
  var VERSION = C.FIREBASE_SDK || '12.19.0';
  var configured = !!(U.firebaseConfigured && U.firebaseConfigured());
  var HINT_KEY = 'semfe:auth-hint';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* the relative way back to the site root, read from the stylesheet link */
  var root = (function () {
    var l = $('link[href$="assets/css/site.css"]');
    return l ? l.getAttribute('href').replace(/assets\/css\/site\.css$/, '') : './';
  })();

  /* ---- provider buttons -------------------------------------------------- */
  var ICONS = {
    google: '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
    password: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>'
  };
  var LI = C.LINKEDIN || {};
  var LINKEDIN_ID = LI.providerId || 'oidc.linkedin';
  var LI_FUNCTION = LI.mode !== 'oidc';
  var liReady = !LI_FUNCTION || !!(LI.clientId && LI.functionUrl && String(LI.clientId + LI.functionUrl).indexOf('PASTE_') === -1);
  var LI_STATE = 'semfe:li';
  var PROVIDERS = {
    google: { name: 'Google', id: 'google.com', cls: 'google', make: function () {
      var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; } },
    facebook: { name: 'Facebook', id: 'facebook.com', cls: 'facebook', make: function () {
      var p = new firebase.auth.FacebookAuthProvider(); p.addScope('email'); return p; } },
    linkedin: { name: 'LinkedIn', id: LINKEDIN_ID, cls: 'linkedin', make: function () {
      var p = new firebase.auth.OAuthProvider(LINKEDIN_ID); p.addScope('openid'); p.addScope('profile'); p.addScope('email'); return p; } }
  };
  // a provider is offered only when it is listed AND (for LinkedIn) its settings are filled in
  // (while Firebase itself is not configured every listed button shows, switched off, as a preview)
  var enabled = (C.AUTH_PROVIDERS || []).filter(function (k) { return PROVIDERS[k] && (k !== 'linkedin' || liReady || !configured); });
  function keyForProviderId(id) {
    if (id === 'password') return 'password';
    for (var k in PROVIDERS) if (PROVIDERS[k].id === id) return k;
    return null;
  }

  /* ---- state ------------------------------------------------------------- */
  var auth = null, fs = null, sdkReady = false, authKnown = false, current = null;
  var listeners = [], pendingLink = null, dialog = null, lastFocus = null, lastFocusSel = '', mode = 'signin';
  var signingOut = false;

  /* ---- loading the SDK --------------------------------------------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  var base = 'https://www.gstatic.com/firebasejs/' + VERSION + '/';
  var sdkPromise = null;
  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = (window.firebase && window.firebase.auth ? Promise.resolve() :
      loadScript(base + 'firebase-app-compat.js').then(function () { return loadScript(base + 'firebase-auth-compat.js'); }))
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(FB);
        auth = firebase.auth();
        auth.languageCode = 'el';          // Greek e-mails and Google consent screen
        sdkReady = true;
        setBusy(false);
        auth.onAuthStateChanged(function (u) {
          // "Αποσύνδεση" pressed before the SDK had loaded: do not bring the
          // restored session back on screen, auth.signOut() is on its way
          if (u && signingOut) return;
          current = u; authKnown = true;
          // signed in some other way (another tab, a LinkedIn return): the dialog has nothing left to do
          if (u && dialog && !dialog.hidden && !pendingLink) close();
          if (u) saveHint(u); else clearHint();
          paintHeader();
          listeners.forEach(function (fn) { try { fn(u); } catch (e) { if (window.console) console.error(e); } });
        });
      });
    sdkPromise.catch(function () {
      authKnown = true; paintHeader();
      showStatus('Δεν ήταν δυνατή η φόρτωση της υπηρεσίας σύνδεσης. Ελέγξτε τη σύνδεσή σας στο διαδίκτυο και ανανεώστε τη σελίδα.', 'err');
      listeners.forEach(function (fn) { try { fn(null); } catch (e) {} });
    });
    return sdkPromise;
  }
  var fsPromise = null;
  function db() {
    if (!configured) return Promise.reject(new Error('not-configured'));
    if (fsPromise) return fsPromise;
    fsPromise = loadSdk().then(function () {
      return window.firebase.firestore ? null : loadScript(base + 'firebase-firestore-compat.js');
    }).then(function () { fs = fs || firebase.firestore(); return fs; });
    return fsPromise;
  }

  /* ---- header ------------------------------------------------------------ */
  function hint() { try { return JSON.parse(localStorage.getItem(HINT_KEY) || 'null'); } catch (e) { return null; } }
  function saveHint(u) { try { localStorage.setItem(HINT_KEY, JSON.stringify({ n: displayName(u), p: u.photoURL || '', e: u.email || '' })); } catch (e) {} }
  function clearHint() { try { localStorage.removeItem(HINT_KEY); } catch (e) {} }
  function displayName(u) {
    if (!u) return '';
    return u.displayName || (u.email ? u.email.split('@')[0] : 'Λογαριασμός');
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function avatarHtml(name, photo, cls) {
    // only a plain https URL: a quote, bracket or backslash could break out of the CSS url()
    var safe = /^https:\/\/[^\s"'()\\<>]+$/.test(photo || '') ? photo : '';
    return '<span class="avatar' + (cls ? ' ' + cls : '') + '"' +
      (safe ? ' style="background-image:url(&quot;' + esc(safe) + '&quot;)"' : '') + ' aria-hidden="true">' + (safe ? '' : esc(initials(name))) + '</span>';
  }
  function paintHeader() {
    var slot = $('#acct-slot');
    if (!slot) return;
    var u = current, h = !authKnown && configured ? hint() : null;
    if (!u && !h) {
      slot.innerHTML = '<a class="btn btn-primary btn-sm acct-signin" href="' + root + 'account/" data-signin>Σύνδεση</a>';
      $('[data-signin]', slot).addEventListener('click', function (e) { e.preventDefault(); open('signin', e.currentTarget); });
      return;
    }
    var name = u ? displayName(u) : h.n, photo = u ? (u.photoURL || '') : h.p, email = u ? (u.email || '') : h.e;
    var admin = u && isAdmin(u);
    slot.innerHTML = '<div class="acct-menu-wrap">' +
      '<button type="button" class="acct-chip" aria-expanded="false" aria-controls="acct-menu">' +
      avatarHtml(name, photo) + '<span class="nm">' + esc(name) + '</span>' +
      '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="acct-menu" id="acct-menu" hidden>' +
      '<div class="who">Συνδεδεμένος/η ως<strong>' + esc(name) + '</strong>' + (email ? esc(email) : '') + '</div>' +
      '<a href="' + root + 'account/">' + svg('user') + 'Ο λογαριασμός μου</a>' +
      '<a href="' + root + 'members/">' + svg('users') + 'Περιοχή μελών</a>' +
      (admin ? '<a href="' + root + 'admin/">' + svg('shield') + 'Διαχείριση μελών</a>' : '') +
      '<button type="button" data-signout>' + svg('out') + 'Αποσύνδεση</button>' +
      '</div></div>';
    var chip = $('.acct-chip', slot);
    chip.addEventListener('click', function (e) { e.stopPropagation(); setMenu($('#acct-menu').hidden); });
    // Tab out of the open menu closes it (only when focus really moved elsewhere)
    $('.acct-menu-wrap', slot).addEventListener('focusout', function (e) {
      if (e.relatedTarget && !U.closest(e.relatedTarget, '.acct-menu-wrap')) setMenu(false);
    });
    $('[data-signout]', slot).addEventListener('click', function () { setMenu(false); signOut(); });
  }
  /* the menu is redrawn on every sign-in change, so these page-wide
     listeners are registered once and look the menu up when they fire */
  function setMenu(openIt) {
    var menu = $('#acct-menu'), chip = $('.acct-chip');
    if (!menu || !chip) return;
    menu.hidden = !openIt;
    chip.setAttribute('aria-expanded', openIt ? 'true' : 'false');
  }
  document.addEventListener('click', function (e) {
    var menu = $('#acct-menu');
    if (menu && !menu.hidden && !U.closest(e.target, '.acct-menu-wrap')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    var menu = $('#acct-menu');
    if ((e.key === 'Escape' || e.key === 'Esc') && menu && !menu.hidden) { setMenu(false); $('.acct-chip').focus(); }
  });
  function svg(k) {
    var p = { user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4.6"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>' }[k];
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* ---- the dialog -------------------------------------------------------- */
  var INAPP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|MicroMessenger|Line\/|Snapchat|Pinterest|TikTok|musical_ly|Twitter/i.test(navigator.userAgent || '');
  function buildDialog() {
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">' +
      '<button type="button" class="modal-x" data-close aria-label="Κλείσιμο"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="modal-head"><h2 id="auth-title">Σύνδεση</h2><p id="auth-sub">Για τα μέλη και τους φίλους του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ.</p></div>' +
      '<div class="modal-body">' +
      '<div class="tabs2" role="group" aria-label="Σύνδεση ή εγγραφή">' +
      '<button type="button" id="tab-signin" aria-pressed="true" data-mode="signin">Σύνδεση</button>' +
      '<button type="button" id="tab-register" aria-pressed="false" data-mode="register">Εγγραφή</button></div>' +
      (configured ? '' : '<div class="notice warn" data-offline><strong>Η σύνδεση μελών ανοίγει σύντομα</strong><p>Μέχρι τότε, μπορείτε να κάνετε αίτηση μέλους μέσω της <a href="' + esc(C.legacyApplyFormUrl || '#') + '" target="_blank" rel="noopener">ηλεκτρονικής φόρμας</a>.</p></div>') +
      (INAPP ? '<div class="notice warn" data-inapp><strong>Ανοίξτε τη σελίδα στον browser σας</strong><p>Φαίνεται ότι η σελίδα άνοιξε μέσα σε εφαρμογή (π.χ. Facebook, Instagram ή LinkedIn), όπου η σύνδεση με Google δεν επιτρέπεται. Από το μενού της εφαρμογής (⋯) επιλέξτε «Άνοιγμα σε browser» (Safari ή Chrome).</p><p><button type="button" class="copy-btn" data-copy-url>Αντιγραφή συνδέσμου</button></p></div>' : '') +
      '<div class="notice" data-link-notice hidden></div>' +
      '<div class="providers">' + enabled.map(function (k) {
        var p = PROVIDERS[k];
        return '<button type="button" class="prov ' + p.cls + '" data-provider="' + k + '"' + (configured ? '' : ' disabled') + '>' + ICONS[k] + '<span>Συνέχεια με ' + p.name + '</span></button>';
      }).join('') + '</div>' +
      (enabled.length ? '<div class="or">ή με e-mail</div>' : '') +
      '<form class="form" novalidate data-email-form>' +
      '<div class="row" data-reg-only hidden>' +
      '<div class="field"><label for="auth-first">Όνομα</label><input id="auth-first" name="first" autocomplete="given-name" maxlength="80"></div>' +
      '<div class="field"><label for="auth-last">Επώνυμο</label><input id="auth-last" name="last" autocomplete="family-name" maxlength="80"></div></div>' +
      '<div class="field"><label for="auth-email">E-mail</label><input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="200"></div>' +
      '<div class="field"><label for="auth-pass">Κωδικός</label><div class="pw-wrap"><input id="auth-pass" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128"><button type="button" class="pw-toggle" data-pw aria-pressed="false">Εμφάνιση</button></div>' +
      '<span class="hint" id="auth-pass-hint" data-reg-only hidden>Τουλάχιστον 8 χαρακτήρες.</span></div>' +
      '<div class="form-error" role="alert" id="auth-status" data-status></div>' +
      '<button type="submit" class="btn btn-dark btn-block" data-submit' + (configured ? '' : ' disabled') + '>Σύνδεση</button>' +
      '<div style="text-align:center" data-signin-only><button type="button" class="link-btn" data-forgot>Ξεχάσατε τον κωδικό;</button></div>' +
      '</form>' +
      '<p class="small" style="margin:0">Συνεχίζοντας, αποδέχεστε την <a href="' + root + 'privacy/">Πολιτική απορρήτου</a> του Συλλόγου. Από τον πάροχο που επιλέγετε λαμβάνουμε μόνο το όνομα, το e-mail και τη φωτογραφία σας.</p>' +
      '</div></div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    $('[data-close]', wrap).addEventListener('click', close);
    // on the document, not the dialog: a click on plain text inside it moves
    // focus to <body>, and Escape must still close it
    document.addEventListener('keydown', function (e) {
      if (!dialog || dialog.hidden) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); }
      else if (e.key === 'Tab' && U.trapTab) U.trapTab(e, $('.modal', dialog));
    });
    $$('[data-mode]', wrap).forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    $$('[data-provider]', wrap).forEach(function (b) {
      b.addEventListener('click', function () { providerSignIn(b.getAttribute('data-provider'), b); });
    });
    $('[data-email-form]', wrap).addEventListener('submit', function (e) { e.preventDefault(); emailSubmit(); });
    $('[data-forgot]', wrap).addEventListener('click', forgot);
    $('[data-pw]', wrap).addEventListener('click', function () {
      var inp = $('#auth-pass'), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      this.textContent = show ? 'Απόκρυψη' : 'Εμφάνιση';
      this.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    var cu = $('[data-copy-url]', wrap);
    if (cu) cu.addEventListener('click', function () {
      U.copyText(location.href, function (ok) { cu.textContent = ok ? 'Αντιγράφηκε ✓' : location.href; });
    });
    return wrap;
  }
  function setMode(m) {
    mode = m === 'register' ? 'register' : 'signin';
    var reg = mode === 'register';
    $('#auth-title').textContent = reg ? 'Νέος λογαριασμός' : 'Σύνδεση';
    $('#auth-sub').textContent = reg
      ? 'Δημιουργήστε λογαριασμό για να κάνετε αίτηση μέλους και να μπείτε στην περιοχή μελών.'
      : 'Για τα μέλη και τους φίλους του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ.';
    $('#tab-signin').setAttribute('aria-pressed', reg ? 'false' : 'true');
    $('#tab-register').setAttribute('aria-pressed', reg ? 'true' : 'false');
    describe($('#auth-pass'), reg ? 'auth-pass-hint' : '');
    $$('[data-reg-only]', dialog).forEach(function (el) { el.hidden = !reg; });
    $$('[data-signin-only]', dialog).forEach(function (el) { el.hidden = reg; });
    $('#auth-pass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('[data-submit]', dialog).textContent = reg ? 'Δημιουργία λογαριασμού' : 'Σύνδεση';
    $$('[data-provider] span', dialog).forEach(function (s, i) { s.textContent = 'Συνέχεια με ' + PROVIDERS[enabled[i]].name; });
    showStatus('');
  }
  function open(m, trigger) {
    if (current) { location.href = root + 'account/'; return; }
    if (configured) loadSdk();
    if (!dialog) dialog = buildDialog();
    var ae = document.activeElement;             // Safari does not focus a clicked button: prefer the trigger
    lastFocus = trigger || (ae && ae !== document.body ? ae : $('[data-signin]'));
    // the header and the account page redraw their buttons when sign-in state
    // arrives, which can detach the trigger: keep a way to find its successor
    lastFocusSel = !lastFocus || !lastFocus.getAttribute ? '' : lastFocus.id ? '#' + lastFocus.id
      : lastFocus.hasAttribute('data-open') ? '[data-open="' + lastFocus.getAttribute('data-open') + '"]'
      : lastFocus.hasAttribute('data-signin') ? '#acct-slot [data-signin]' : '';
    if (!pendingLink) $('[data-link-notice]', dialog).hidden = true;
    setMode(m || 'signin');
    dialog.hidden = false;
    if (U.lockScroll) U.lockScroll(); else document.body.classList.add('modal-open');
    var first = $(configured ? '.prov, #auth-email' : '[data-offline] a', dialog) || $('[data-close]', dialog);
    setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
  }
  function close() {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    if (U.unlockScroll) U.unlockScroll(); else document.body.classList.remove('modal-open');
    var to = lastFocus && document.body.contains(lastFocus) ? lastFocus
      : (lastFocusSel && $(lastFocusSel)) || $('#acct-slot [data-signin], #acct-slot .acct-chip');
    if (to && to.focus) try { to.focus(); } catch (e) {}
  }
  function showStatus(msg, kind) {
    if (!dialog) return;
    var el = $('[data-status]', dialog);
    el.textContent = msg || '';
    el.className = kind === 'ok' ? 'form-ok' : 'form-error';
  }
  function setBusy(busy) {
    if (!dialog) return;
    $$('[data-provider], [data-submit]', dialog).forEach(function (b) { b.disabled = busy || !configured; });
  }

  /* ---- sign-in actions --------------------------------------------------- */
  function providerSignIn(key, btn) {
    var p = PROVIDERS[key];
    if (!p || !configured) return;
    if (key === 'linkedin' && LI_FUNCTION) { linkedinStart('signin', pendingLink ? pendingLink.name : ''); return; }
    if (!sdkReady) { showStatus('Μια στιγμή, φορτώνει η υπηρεσία σύνδεσης…'); loadSdk(); return; }
    showStatus('');
    var label = btn && $('span', btn), old = label ? label.textContent : '';
    if (btn) { btn.disabled = true; if (label) label.textContent = 'Άνοιγμα ' + p.name + '…'; }
    var restore = function () { if (btn) { btn.disabled = false; if (label) label.textContent = old; } };
    // called synchronously from the click, so the browser lets the popup open
    auth.signInWithPopup(p.make()).then(function (res) { restore(); return afterSignIn(res); })
      .catch(function (e) { restore(); handleError(e, key); });
  }
  function emailSubmit() {
    if (!configured) return;
    if (!sdkReady) { showStatus('Μια στιγμή, φορτώνει η υπηρεσία σύνδεσης…'); loadSdk(); return; }
    var email = $('#auth-email').value.trim(), pass = $('#auth-pass').value;
    var reg = mode === 'register';
    var first = reg ? $('#auth-first').value.trim() : '', last = reg ? $('#auth-last').value.trim() : '';
    $$('[aria-invalid]', dialog).forEach(function (el) { el.removeAttribute('aria-invalid'); describe(el, el.id === 'auth-pass' && mode === 'register' ? 'auth-pass-hint' : ''); });
    var bad = function (id, msg) {
      var el = $(id); el.setAttribute('aria-invalid', 'true');
      describe(el, (el.id === 'auth-pass' && mode === 'register' ? 'auth-pass-hint ' : '') + 'auth-status');
      el.focus(); showStatus(msg);
    };
    if (reg && !first) return bad('#auth-first', 'Γράψτε το όνομά σας.');
    if (reg && !last) return bad('#auth-last', 'Γράψτε το επώνυμό σας.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('#auth-email', 'Γράψτε μια έγκυρη διεύθυνση e-mail.');
    if (!pass) return bad('#auth-pass', 'Γράψτε τον κωδικό σας.');
    if (reg && pass.length < 8) return bad('#auth-pass', 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.');
    var submit = $('[data-submit]', dialog);
    submit.disabled = true;
    var job = reg
      ? auth.createUserWithEmailAndPassword(email, pass).then(function (res) {
          return res.user.updateProfile({ displayName: (first + ' ' + last).trim() })
            .then(function () { return res.user.sendEmailVerification({ url: absolute(root + 'account/') }).catch(function () {}); })
            .then(function () { return res; });
        })
      : auth.signInWithEmailAndPassword(email, pass);
    job.then(function (res) { submit.disabled = false; return afterSignIn(res, reg); })
      .catch(function (e) { submit.disabled = false; handleError(e, 'password'); });
  }
  function forgot() {
    if (!configured) return;
    if (!sdkReady) { loadSdk(); return; }
    var email = $('#auth-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('#auth-email').setAttribute('aria-invalid', 'true'); $('#auth-email').focus();
      showStatus('Γράψτε πρώτα το e-mail σας παραπάνω και πατήστε ξανά «Ξεχάσατε τον κωδικό;».');
      return;
    }
    auth.sendPasswordResetEmail(email, { url: absolute(root + 'account/') }).then(function () {
      showStatus('Αν υπάρχει λογαριασμός με αυτό το e-mail, σας στείλαμε σύνδεσμο για νέο κωδικό. Ελέγξτε και τα ανεπιθύμητα (spam).', 'ok');
    }).catch(function (e) { showStatus(friendly(e)); });
  }
  function afterSignIn(res, registered) {
    var u = res && res.user;
    var isNew = registered || !!(res && res.additionalUserInfo && res.additionalUserInfo.isNewUser);
    var chain = Promise.resolve();
    if (u && pendingLink) {
      var pl = pendingLink;
      pendingLink = null;
      chain = u.linkWithCredential(pl.credential).then(function () {
        flash('Το ' + pl.name + ' συνδέθηκε με τον λογαριασμό σας. Από εδώ και πέρα μπαίνετε με όποιον από τους δύο τρόπους θέλετε.');
      }).catch(function (e) {
        if (window.console) console.warn('link failed', e);
        flash('Συνδεθήκατε. Το ' + pl.name + ' δεν συνδέθηκε με τον λογαριασμό σας (' + friendly(e) + ').');
      });
    }
    return chain.then(function () {
      close();
      var onAccount = /\/account\/?$/.test(location.pathname);
      if (isNew && !onAccount) location.href = root + 'account/#apply';
    });
  }
  function handleError(e, key) {
    var code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;
    if (code === 'auth/account-exists-with-different-credential' && e.credential) {
      var who = key && PROVIDERS[key] ? PROVIDERS[key].name : 'αυτός ο τρόπος σύνδεσης';
      var email = e.email || (e.customData && e.customData.email) || '';
      pendingLink = { credential: e.credential, name: who, email: email };
      var box = $('[data-link-notice]', dialog);
      box.className = 'notice warn';
      box.innerHTML = '<strong>Έχετε ήδη λογαριασμό' + (email ? ' με το ' + esc(email) : '') + '</strong>' +
        '<p>Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά (π.χ. Google, LinkedIn ή e-mail και κωδικό). Αμέσως μετά θα συνδέσουμε και το ' + esc(who) + ' στον ίδιο λογαριασμό.</p>';
      box.hidden = false;
      if (email) $('#auth-email').value = email;
      setMode('signin');
      box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
      return;
    }
    showStatus(friendly(e));
  }
  function signOut() {
    clearHint();
    if (!configured) { current = null; paintHeader(); return Promise.resolve(); }
    // the SDK may still be downloading (the header was drawn from the saved
    // hint): wait for it and sign out for real, or the session comes back
    signingOut = true;
    if (!authKnown) paintHeader();
    return loadSdk().then(function () { return auth.signOut(); }).then(function () {
      signingOut = false;
      clearHint();
      if (/\/(account|members|admin)\/?$/.test(location.pathname)) location.reload();
    }, function (e) { signingOut = false; throw e; });
  }

  /* ---- account management (used by account.js) ------------------------- */
  function providers(u) {
    return (u && u.providerData || []).map(function (p) { return keyForProviderId(p.providerId); }).filter(Boolean);
  }
  /* as providers(), plus LinkedIn when it was connected through the Cloud
     Function (those accounts carry the custom claim li instead of a providerData entry) */
  function providersAsync(u) {
    var list = providers(u);
    if (!u || list.indexOf('linkedin') !== -1 || !u.getIdTokenResult) return Promise.resolve(list);
    return u.getIdTokenResult().then(function (r) {
      if (r && r.claims && r.claims.li === true) list.push('linkedin');
      return list;
    }, function () { return list; });
  }
  function link(key) {
    var p = PROVIDERS[key];
    if (!p || !current) return Promise.reject(new Error('no-user'));
    if (key === 'linkedin' && LI_FUNCTION) { linkedinStart('link'); return new Promise(function () {}); }  // the page navigates away
    return current.linkWithPopup(p.make());
  }
  function reauth(u) {
    u = u || current;
    var ids = (u.providerData || []).map(function (p) { return p.providerId; });
    for (var k in PROVIDERS) if (ids.indexOf(PROVIDERS[k].id) !== -1) return u.reauthenticateWithPopup(PROVIDERS[k].make());
    if (ids.indexOf('password') !== -1) return Promise.reject({ code: 'semfe/needs-password' });
    return Promise.reject({ code: 'semfe/relogin' });       // e.g. LinkedIn through the Cloud Function
  }

  /* ---- LinkedIn through the Cloud Function -------------------------------- */
  // Leave the page for LinkedIn. A full-page visit (not a popup) avoids popup
  // blockers and the opener being cut off by LinkedIn's security headers; the
  // member comes back to auth/linkedin/, which calls linkedinComplete().
  function linkedinStart(mode, waiting) {
    if (!liReady) return;
    var state = randomState();
    try {
      sessionStorage.setItem(LI_STATE, JSON.stringify({ state: state, mode: mode === 'link' ? 'link' : 'signin', returnTo: returnAddress(),
        waiting: String(waiting || '').slice(0, 40), t: Date.now() }));
    } catch (e) { showStatus('Ο browser σας δεν επιτρέπει την αποθήκευση δεδομένων (cookies), που χρειάζεται η σύνδεση με LinkedIn.'); return; }
    location.assign('https://www.linkedin.com/oauth/v2/authorization?response_type=code' +
      '&client_id=' + encodeURIComponent(LI.clientId) +
      '&redirect_uri=' + encodeURIComponent(linkedinRedirectUri()) +
      '&state=' + encodeURIComponent(state) +
      '&scope=' + encodeURIComponent('openid profile email'));
  }
  /* this page without its #hash and without ?signin / ?register, which would open the dialog again */
  function returnAddress() {
    try {
      var u = new URL(location.href);
      u.hash = '';
      u.searchParams.delete('signin'); u.searchParams.delete('register');
      return u.href;
    } catch (e) { return location.href.split('#')[0]; }
  }
  function linkedinRedirectUri() { return absolute(root + 'auth/linkedin/'); }
  function linkedinTakeState() {
    var v = null;
    try { v = JSON.parse(sessionStorage.getItem(LI_STATE) || 'null'); sessionStorage.removeItem(LI_STATE); } catch (e) {}
    return v && typeof v.state === 'string' ? v : null;
  }
  function linkedinComplete(code, mode) {
    if (!configured || !liReady) return Promise.reject({ code: 'auth/operation-not-allowed' });
    return loadSdk().then(function () {
      return mode === 'link' ? firstUser() : null;
    }).then(function (u) {
      if (mode === 'link' && !u) throw { code: 'semfe/relogin' };
      // a fresh token: the server checks email_verified, and a member who has
      // just confirmed their address still holds a token that says false
      var tok = u ? u.reload().then(function () { return u.getIdToken(true); }) : Promise.resolve(null);
      return tok.then(function (idToken) {
        var headers = { 'Content-Type': 'application/json' };
        if (idToken) headers.Authorization = 'Bearer ' + idToken;
        return fetch(LI.functionUrl, { method: 'POST', headers: headers, body: JSON.stringify({ code: code, redirectUri: linkedinRedirectUri() }) });
      });
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j || {} }; }, function () { return { ok: false, j: {} }; });
    }, function (e) {
      throw (e && e.code) ? e : { code: 'auth/network-request-failed' };
    }).then(function (x) {
      if (!x.ok || !x.j.token) throw { code: 'semfe/' + (x.j.error || 'linkedin-failed') };
      return auth.signInWithCustomToken(x.j.token).then(function () {
        // refresh so the new "li" claim is in the token the rules and the account page read
        return auth.currentUser ? auth.currentUser.getIdToken(true) : null;
      }).then(function () { return { isNew: !!x.j.isNew, linked: !!x.j.linked }; });
    });
  }
  function firstUser() {
    return new Promise(function (resolve) {
      var off = auth.onAuthStateChanged(function (u) { off(); resolve(u); });
    });
  }
  function randomState() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  /* only ever send the member back to a page of this site */
  function safeReturn(url) {
    var home = absolute(root);
    try { var u = new URL(url, location.href); if (u.origin === location.origin && u.href.indexOf(home) === 0 && !/\/auth\/linkedin\//.test(u.pathname)) return u.href; } catch (e) {}
    return home;
  }
  function reauthPassword(pass) {
    var cred = firebase.auth.EmailAuthProvider.credential(current.email, pass);
    return current.reauthenticateWithCredential(cred);
  }
  function isAdmin(u) {
    if (!u || !u.email || !u.emailVerified) return false;
    var e = u.email.toLowerCase();
    return (C.ADMIN_EMAILS || []).some(function (a) { return String(a).toLowerCase() === e; });
  }

  /* ---- messages ---------------------------------------------------------- */
  function friendly(e) {
    var c = (e && e.code) || '';
    var M = {
      'auth/invalid-email': 'Η διεύθυνση e-mail δεν φαίνεται σωστή.',
      'auth/missing-password': 'Γράψτε τον κωδικό σας.',
      'auth/weak-password': 'Ο κωδικός είναι πολύ αδύναμος. Χρησιμοποιήστε τουλάχιστον 8 χαρακτήρες.',
      'auth/password-does-not-meet-requirements': 'Ο κωδικός δεν πληροί τις απαιτήσεις ασφαλείας. Δοκιμάστε μακρύτερο κωδικό με γράμματα και αριθμούς.',
      'auth/email-already-in-use': 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Πατήστε «Σύνδεση» (ίσως τον δημιουργήσατε με Google, Facebook ή LinkedIn) ή ζητήστε νέο κωδικό.',
      'auth/invalid-credential': 'Λάθος e-mail ή κωδικός. Αν δημιουργήσατε τον λογαριασμό σας με Google, Facebook ή LinkedIn, συνδεθείτε με το αντίστοιχο κουμπί.',
      'auth/wrong-password': 'Λάθος e-mail ή κωδικός.',
      'auth/user-not-found': 'Λάθος e-mail ή κωδικός.',
      'auth/invalid-login-credentials': 'Λάθος e-mail ή κωδικός.',
      'auth/user-disabled': 'Ο λογαριασμός αυτός έχει απενεργοποιηθεί. Επικοινωνήστε μαζί μας.',
      'auth/too-many-requests': 'Πολλές προσπάθειες σε λίγο χρόνο. Δοκιμάστε ξανά σε λίγα λεπτά.',
      'auth/network-request-failed': 'Πρόβλημα σύνδεσης στο διαδίκτυο. Δοκιμάστε ξανά.',
      'auth/popup-blocked': 'Ο browser μπλόκαρε το παράθυρο σύνδεσης. Επιτρέψτε τα αναδυόμενα παράθυρα για αυτή τη σελίδα και πατήστε ξανά το κουμπί.',
      'auth/operation-not-allowed': 'Αυτός ο τρόπος σύνδεσης δεν έχει ενεργοποιηθεί ακόμα. Δοκιμάστε άλλον.',
      'auth/unauthorized-domain': 'Η σύνδεση δεν έχει εγκριθεί ακόμα για αυτή τη διεύθυνση του ιστότοπου.',
      'auth/operation-not-supported-in-this-environment': 'Ο browser σας δεν υποστηρίζει αυτό τον τρόπο σύνδεσης. Ανοίξτε τη σελίδα σε Safari, Chrome, Firefox ή Edge.',
      'auth/web-storage-unsupported': 'Ο browser σας έχει απενεργοποιημένη την αποθήκευση δεδομένων (cookies). Ενεργοποιήστε την ή δοκιμάστε άλλον browser.',
      'auth/internal-error': 'Κάτι πήγε στραβά στην υπηρεσία σύνδεσης. Δοκιμάστε ξανά ή επιλέξτε άλλον τρόπο σύνδεσης.',
      'auth/requires-recent-login': 'Για λόγους ασφαλείας, χρειάζεται να συνδεθείτε ξανά πριν από αυτή την ενέργεια.',
      'auth/credential-already-in-use': 'Αυτός ο λογαριασμός χρησιμοποιείται ήδη από άλλον λογαριασμό του ιστότοπου.',
      'auth/provider-already-linked': 'Αυτός ο τρόπος σύνδεσης είναι ήδη συνδεδεμένος.',
      'auth/account-exists-with-different-credential': 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά.',
      'auth/expired-action-code': 'Ο σύνδεσμος έληξε. Ζητήστε νέο.',
      'auth/invalid-action-code': 'Ο σύνδεσμος δεν ισχύει πια. Ζητήστε νέο.',
      'semfe/relogin': 'Για λόγους ασφαλείας, αποσυνδεθείτε, συνδεθείτε ξανά και επαναλάβετε μέσα σε λίγα λεπτά.',
      'semfe/needs-password': 'Γράψτε τον κωδικό σας για επιβεβαίωση.',
      'semfe/account-exists-unverified': 'Υπάρχει ήδη λογαριασμός με το e-mail του LinkedIn σας, που όμως δεν έχει επιβεβαιωθεί. Συνδεθείτε με τον τρόπο που χρησιμοποιήσατε την πρώτη φορά (π.χ. Facebook ή e-mail και κωδικό), επιβεβαιώστε το e-mail σας από τη σελίδα «Ο λογαριασμός μου» και μετά συνδέστε από εκεί το LinkedIn.',
      'semfe/link-needs-verified-email': 'Για να συνδέσετε το LinkedIn, χρειάζεται πρώτα να επιβεβαιώσετε το e-mail του λογαριασμού σας (δείτε «Τρόποι σύνδεσης» στη σελίδα «Ο λογαριασμός μου»).',
      'semfe/credential-already-in-use': 'Αυτός ο λογαριασμός LinkedIn είναι ήδη συνδεδεμένος με άλλον λογαριασμό του ιστότοπου.',
      'semfe/linkedin-code-rejected': 'Το LinkedIn δεν δέχτηκε τη σύνδεση (ίσως έληξε). Δοκιμάστε ξανά.',
      'semfe/linkedin-profile-unavailable': 'Το LinkedIn δεν έδωσε τα στοιχεία του προφίλ σας. Δοκιμάστε ξανά σε λίγο.',
      'semfe/redirect-not-allowed': 'Η σύνδεση με LinkedIn δεν έχει ρυθμιστεί σωστά (διεύθυνση επιστροφής).',
      'semfe/origin-not-allowed': 'Η σύνδεση με LinkedIn δεν έχει εγκριθεί για αυτή τη διεύθυνση του ιστότοπου.',
      'semfe/not-configured': 'Η σύνδεση με LinkedIn δεν έχει ολοκληρωθεί από τους διαχειριστές.',
      'semfe/bad-id-token': 'Η σύνδεσή σας έληξε. Συνδεθείτε ξανά και επαναλάβετε.',
      'semfe/internal': 'Κάτι πήγε στραβά στην υπηρεσία σύνδεσης LinkedIn. Δοκιμάστε ξανά αργότερα.',
      'semfe/linkedin-failed': 'Η σύνδεση με LinkedIn δεν ολοκληρώθηκε. Δοκιμάστε ξανά.',
      'permission-denied': 'Δεν έχετε δικαίωμα για αυτή την ενέργεια (ή οι κανόνες ασφαλείας της βάσης δεν έχουν δημοσιευτεί ακόμα).',
      'unavailable': 'Η βάση δεδομένων δεν είναι διαθέσιμη αυτή τη στιγμή. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.'
    };
    return M[c] || 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.' + (c ? ' (' + c + ')' : '');
  }
  function flash(msg) {
    var el = document.createElement('div');
    el.className = 'notice ok';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:400;max-width:calc(100% - 32px);width:520px;box-shadow:var(--shadow-lg)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000);
  }
  function describe(el, ids) { if (!el) return; if (ids) el.setAttribute('aria-describedby', ids); else el.removeAttribute('aria-describedby'); }
  function absolute(rel) { var a = document.createElement('a'); a.href = rel; return a.href; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- public API -------------------------------------------------------- */
  function onChange(fn) {
    listeners.push(fn);
    if (authKnown) { try { fn(current); } catch (e) {} }
    else if (!configured) { try { fn(null); } catch (e) {} }
  }
  window.SemfeAuth = {
    configured: configured, root: root, onChange: onChange, open: open, close: close, signOut: signOut,
    db: db, isAdmin: isAdmin, providers: providers, providersAsync: providersAsync, link: link, reauth: reauth, reauthPassword: reauthPassword,
    linkedinTakeState: linkedinTakeState, linkedinComplete: linkedinComplete, safeReturn: safeReturn,
    linkedinViaFunction: function () { return LI_FUNCTION; },
    friendly: friendly, flash: flash, esc: esc, avatarHtml: avatarHtml, displayName: displayName,
    enabledProviders: function () { return enabled.slice(); }, providerInfo: function (k) { return PROVIDERS[k]; },
    icon: function (k) { return ICONS[k] || ''; },
    user: function () { return current; }
  };

  /* ---- start -------------------------------------------------------------- */
  paintHeader();
  try {                                        // a message left by the page we came from
    var fl = sessionStorage.getItem('semfe:flash');
    if (fl) { sessionStorage.removeItem('semfe:flash'); flash(fl); }
  } catch (e) {}
  if (configured) {
    // load right away on the member pages; elsewhere once the page is idle
    var eager = document.body.getAttribute('data-firestore') === '1' || !!hint();
    if (eager) loadSdk();
    else if ('requestIdleCallback' in window) requestIdleCallback(loadSdk, { timeout: 2500 });
    else setTimeout(loadSdk, 1200);
  } else {
    authKnown = true;
  }
  // a link such as account/#signin or ?signin opens the dialog
  // (only once we know nobody is signed in: a member following such a link stays where they are)
  if (/(^|[?&#])(signin|register)\b/.test(location.search + location.hash) && !/\/account\/?$/.test(location.pathname)) {
    var asked = /register/.test(location.search + location.hash) ? 'register' : 'signin', handled = false;
    onChange(function (u) { if (handled) return; handled = true; if (!u) open(asked); });
  }
})();
