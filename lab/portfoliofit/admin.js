/* =====================================================================
   PortfolioFit for Managers — admin panel
   ---------------------------------------------------------------------
   Activates only with ?admin on the URL. Requires the admin@admin.com
   account. Lets the administrator edit all participant-facing text, the
   registration and survey questions, experiment settings, and view /
   export all collected participant data (Excel).

   Status: content + registration + survey + settings + participants/export.
   The "generate & freeze specific puzzles" tab is added in a following
   increment (it will reuse the game's generator via window.PFGame).
   ===================================================================== */
(function () {
  'use strict';
  if (!window.PF_ADMIN) return;

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDO0KqhebMC2xsijmibhL_52wGfioMb0HQ',
    authDomain: 'stouras-portfoliofit-86127.firebaseapp.com',
    projectId: 'stouras-portfoliofit-86127',
    storageBucket: 'stouras-portfoliofit-86127.firebasestorage.app',
    messagingSenderId: '346443957980',
    appId: '1:346443957980:web:d5987b2a470a401e7d5619'
  };
  var SDK = '10.12.2';
  var FB_BASE = 'https://www.gstatic.com/firebasejs/' + SDK + '/';
  var ADMIN_EMAIL = 'admin@admin.com';

  // Text fields shown in the Content tab: [key, label, kind]
  // kind: 'line' (input), 'area' (textarea), 'paras' (textarea, paragraphs -> array)
  var TEXT_FIELDS = [
    ['welcomeTitle', 'Welcome — title', 'line'],
    ['welcomeIntro', 'Welcome — intro (HTML allowed)', 'area'],
    ['welcomeBody', 'Welcome — body paragraphs (one per line, HTML allowed)', 'paras'],
    ['welcomeButton', 'Welcome — start button', 'line'],
    ['trainingTitle', 'Training — title', 'line'],
    ['trainingBody', 'Training — body', 'area'],
    ['trainingButton', 'Training — button', 'line'],
    ['registerTitle', 'Registration — title', 'line'],
    ['registerIntro', 'Registration — intro', 'area'],
    ['mainTitle', 'Game phase — title', 'line'],
    ['mainIntro', 'Game phase — intro', 'area'],
    ['statsTitle', 'Stats — title', 'line'],
    ['surveyTitle', 'Survey — title', 'line'],
    ['surveyIntro', 'Survey — intro', 'area'],
    ['thankyouTitle', 'Thank-you — title', 'line'],
    ['thankyouBody', 'Thank-you — body', 'area']
  ];
  var QUESTION_TYPES = ['text', 'email', 'password', 'number', 'select', 'country', 'radio', 'textarea'];
  // Group the text fields into collapsible "pages" for the Content tab.
  var PAGE_GROUPS = [
    { key: 'welcome', label: 'Welcome page', fields: ['welcomeTitle', 'welcomeIntro', 'welcomeBody', 'welcomeButton'] },
    { key: 'training', label: 'Training phase', fields: ['trainingTitle', 'trainingBody', 'trainingButton'] },
    { key: 'registration', label: 'Registration page', fields: ['registerTitle', 'registerIntro'] },
    { key: 'main', label: 'Game phase', fields: ['mainTitle', 'mainIntro'] },
    { key: 'stats', label: 'Stats page', fields: ['statsTitle'] },
    { key: 'survey', label: 'Survey page', fields: ['surveyTitle', 'surveyIntro'] },
    { key: 'thankyou', label: 'Thank-you page', fields: ['thankyouTitle', 'thankyouBody'] }
  ];
  var TEXT_FIELD_META = {}; TEXT_FIELDS.forEach(function (f) { TEXT_FIELD_META[f[0]] = { label: f[1], kind: f[2] }; });

  // ---- state ----
  var fb = null, XLSX = null, cfg = { texts: {}, settings: {}, registrationQuestions: [], surveyQuestions: [] }, user = null, tab = 'content', approvedPuzzles = [];
  var inited = false;
  // Top-right nav: 'admin' (the tabbed CMS) or 'analytics' (the Data analytics
  // view). Mirrors the answerarena admin. All analytics state lives in daState
  // so leaving and returning to the view preserves loaded data, ticks and code.
  var currentView = 'admin';
  var daState = { selected: {}, importedBooks: [], sessions: null, allParts: null, sheetMap: null, sheetOrder: [], code: { python: null, r: null }, lang: 'python', running: false, lastRun: null };
  var daRefs = {};   // the mounted analytics sections register their refreshers here (reset on each render)

  // ---- DOM helpers ----
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else if (k === 'value') n.value = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  // Wrap a click handler so the button itself confirms the action: it presses,
  // shows "Saving…" while the handler's promise runs, then flashes green "✓ Saved"
  // before restoring its label. fn should return a promise; on failure (a rejected
  // promise) the label restores without the green flash (the handler toasts why).
  function withFeedback(fn, okLabel) {
    return function (e) {
      var b = e && e.currentTarget;
      if (!b) { return fn(); }
      if (b._busy) return;
      b._busy = true;
      if (b._label == null) b._label = b.textContent;
      var orig = b._label;
      b.classList.remove('is-ok'); b.classList.add('is-busy'); b.setAttribute('disabled', 'true'); b.textContent = 'Saving…';
      var restore = function () { b.classList.remove('is-busy', 'is-ok'); b.textContent = orig; b.removeAttribute('disabled'); b._busy = false; };
      var ok = function () { b.classList.remove('is-busy'); b.classList.add('is-ok'); b.textContent = okLabel || '✓ Saved'; setTimeout(restore, 1100); };
      var r; try { r = fn(); } catch (err) { restore(); return; }
      Promise.resolve(r).then(ok, restore);
    };
  }
  var root;
  function clearRoot() { root.innerHTML = ''; }

  function injectStyles() {
    var css = ''
      + '#acctRoot{display:none !important;}' // hide legacy snake login widget on the admin page
      + '#infoOverlay{z-index:10050 !important;}' // game solutions/proof modal shows above the admin panel
      + '#pfa-root{--bg:#f6f3ee;--panel:#ffffff;--ink:#2b2b2b;--muted:#74726c;--line:#e7e2d8;--field:#ffffff;--fieldline:#e0dbd0;--accent:#e67e22;--accentd:#cf6f17;--qbg:#fcfbf7;position:fixed;inset:0;z-index:10000;background:var(--bg);overflow:auto;font-family:Inter,system-ui,sans-serif;color:var(--ink);}'
      + '#pfa-root.dark{--bg:#181818;--panel:#242424;--ink:#ececec;--muted:#9a978f;--line:#383838;--field:#2e2e2e;--fieldline:#474747;--qbg:#202020;}'
      + '#pfa-root *{box-sizing:border-box;}'
      + '.pfa-wrap{max-width:920px;margin:0 auto;padding:24px 18px 80px;}'
      + '.pfa-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:10px;}'
      + '.pfa-h h1{font-family:"Space Grotesk",Inter,sans-serif;font-size:1.5rem;margin:0;color:var(--ink);}'
      + '.pfa-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:18px;}'
      + '.pfa-tabs button{border:none;background:transparent;padding:9px 14px;font-weight:600;font-size:14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}'
      + '.pfa-tabs button.on{color:var(--accent);border-bottom-color:var(--accent);}'
      + '.pfa-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 6px 18px rgba(0,0,0,.06);color:var(--ink);}'
      + '.pfa-card > * + *{margin-top:14px;}'
      + '.pfa-field{margin:10px 0;}.pfa-field label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;color:var(--ink);}'
      + '.pfa-field input[type=text],.pfa-field input[type=email],.pfa-field input[type=password],.pfa-field input[type=number],.pfa-field select,.pfa-field textarea{width:100%;padding:9px 11px;border:1px solid var(--fieldline);border-radius:9px;font-size:14px;font-family:inherit;background:var(--field);color:var(--ink);}'
      + '.pfa-field textarea{resize:vertical;}'
      + '.pfa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 18px;border-radius:10px;cursor:pointer;transition:transform .06s ease,background .15s ease,opacity .15s ease,box-shadow .15s ease;}'
      + '.pfa-btn:active{transform:translateY(1px) scale(.97);}'
      + '.pfa-btn.is-busy{opacity:.6;cursor:progress;}'
      + '.pfa-btn.is-ok{background:#2faa5e !important;color:#fff !important;border-color:#2faa5e !important;box-shadow:0 4px 12px rgba(47,170,94,.35);}'
      + '.pfa-btn:hover{background:var(--accentd);}.pfa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.pfa-btn.sm{padding:7px 12px;font-size:12px;}.pfa-btn.danger{background:var(--panel);color:#e74c3c;border:1px solid #f0c7c1;}'
      + '.pfa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);}'
      + '.pfa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.pfa-q .row > *{flex:0 0 auto;}'
      + '.pfa-q .row input[type=text],.pfa-q .row select{padding:7px 9px;}'
      + '#pfa-root input:not([type=checkbox]):not([type=radio]),#pfa-root select,#pfa-root textarea{background:var(--field);color:var(--ink);border:1px solid var(--fieldline);border-radius:8px;font-size:14px;font-family:inherit;}'
      + '.pfa-note{color:var(--muted);font-size:13px;line-height:1.6;}'
      + '.pfa-msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:10003;opacity:0;transition:.2s;}'
      + '.pfa-msg.show{opacity:1;}'
      + 'table.pfa-tbl{width:100%;border-collapse:collapse;font-size:13px;}'
      + 'table.pfa-tbl th,table.pfa-tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);}'
      + 'table.pfa-tbl th{color:var(--muted);font-weight:600;}'
      + '.pfa-login{max-width:380px;margin:8vh auto 0;}'
      + '.pfa-err{color:#e74c3c;font-size:13px;min-height:18px;margin:6px 0;}'
      // ---- Data analytics view (ported from the answerarena admin) ----
      + '.pfa-wrap2{max-width:1180px;}'
      + '.pfa-btn.is-nav-on{background:var(--accent);color:#fff;border-color:var(--accent);}'
      + '.pfa-btn.green{background:#2faa5e;color:#fff;border:none;box-shadow:0 4px 12px rgba(47,170,94,.30);}.pfa-btn.green:hover{background:#268a4c;}'
      + '.pfa-btn[disabled]{opacity:.5;cursor:not-allowed;}'
      + '.pfa-sechead{display:flex;align-items:center;margin-bottom:8px;}'
      + '.pfa-secnum{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:14px;margin-right:9px;flex:0 0 auto;}'
      + '.pfa-seclist{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:2px 12px;background:var(--qbg);}'
      + '.pfa-checkrow{display:flex;align-items:flex-start;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line);cursor:pointer;}'
      + '.pfa-checkrow:last-child{border-bottom:none;}'
      + '.pfa-checkrow input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;margin-top:2px;accent-color:var(--accent);}'
      + '.pfa-checkrow .g{min-width:0;flex:1 1 auto;}'
      + '.pfa-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:99px;}'
      + '.pfa-badge.open{color:#2faa5e;background:rgba(47,170,94,.14);}.pfa-badge.closed{color:var(--muted);background:rgba(154,151,143,.16);}'
      + '.pfa-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(230,126,34,.16);color:var(--accent);}'
      + '.pfa-tag.blue{background:rgba(20,86,200,.16);color:#5b8def;}'
      + '.pfa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.pfa-statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}'
      + '.pfa-statbox{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--qbg);}'
      + '.pfa-statbox b{font-size:24px;display:block;line-height:1.1;color:var(--ink);}'
      + '.pfa-statbox span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}'
      + '.pfa-langtabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:4px 0 10px;}'
      + '.pfa-langtabs button{border:none;background:transparent;padding:8px 14px;font-weight:700;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}'
      + '.pfa-langtabs button.on{color:var(--accent);border-bottom-color:var(--accent);}'
      + '#pfa-root textarea.pfa-code{width:100%;min-height:340px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:12.5px;line-height:1.5;white-space:pre;overflow:auto;tab-size:4;-moz-tab-size:4;}'
      + '.pfa-out{background:#0c0c0c;color:#e6e6e6;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:540px;overflow:auto;margin-top:10px;}'
      + '.pfa-plots{margin-top:12px;}.pfa-plots img{display:block;max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:10px;background:#fff;}'
      + '.pfa-runstatus{font-size:13px;color:var(--muted);margin:8px 0;min-height:18px;}'
      + '.pfa-scrolltbl{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--qbg);}'
      + '.pfa-insh{font-size:15px;margin:16px 0 6px;color:var(--ink);}'
      + '.pfa-insul{margin:4px 0;padding-left:20px;}.pfa-insul li{font-size:14px;line-height:1.65;margin:5px 0;}'
      + '.pfa-insp{font-size:14px;line-height:1.65;margin:8px 0;}'
      + '.pfa-insimg{display:block;max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:12px;background:#fff;}';
    document.head.appendChild(el('style', { text: css }));
  }
  function currentTheme() { try { return localStorage.getItem('pfa-theme') || 'dark'; } catch (e) { return 'dark'; } }
  function applyTheme(t) { if (root) root.classList.toggle('dark', t === 'dark'); try { localStorage.setItem('pfa-theme', t); } catch (e) {} }
  function themeToggle() {
    var b = el('button', { class: 'pfa-btn sec sm' });
    function paint() { b.textContent = (root && root.classList.contains('dark')) ? '☀ Light' : '☾ Dark'; }
    paint();
    b.addEventListener('click', function () { applyTheme((root && root.classList.contains('dark')) ? 'light' : 'dark'); paint(); });
    return b;
  }

  var msgEl;
  function toast(t) {
    if (!msgEl) { msgEl = el('div', { class: 'pfa-msg' }); document.body.appendChild(msgEl); }
    msgEl.textContent = t; msgEl.classList.add('show');
    setTimeout(function () { msgEl.classList.remove('show'); }, 1800);
  }

  // ---- Firebase ----
  async function initFirebase() {
    var appM = await import(FB_BASE + 'firebase-app.js');
    var authM = await import(FB_BASE + 'firebase-auth.js');
    var fsM = await import(FB_BASE + 'firebase-firestore.js');
    var app;
    try { app = appM.getApp('portfoliofit'); }
    catch (e) { app = appM.initializeApp(FIREBASE_CONFIG, 'portfoliofit'); }
    fb = { app: app, auth: authM.getAuth(app), db: fsM.getFirestore(app), A: authM, F: fsM };
    authM.onAuthStateChanged(fb.auth, function (u) { user = u || null; route(); });
  }
  async function loadConfig() {
    cfg = { texts: {}, settings: {}, registrationQuestions: [], registrationConsents: [], surveyQuestions: [] };
    try {
      var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'config', 'app'));
      if (snap.exists()) { var d = snap.data(); cfg = { texts: d.texts || {}, settings: d.settings || {}, registrationQuestions: d.registrationQuestions || [], registrationConsents: d.registrationConsents || [], surveyQuestions: d.surveyQuestions || [] }; }
    } catch (e) { /* defaults empty */ }
  }
  async function saveConfig(partial) {
    await fb.F.setDoc(fb.F.doc(fb.db, 'config', 'app'),
      Object.assign({}, partial, { updatedAt: fb.F.serverTimestamp() }), { merge: true });
  }

  // ---- Routing ----
  function cachedAdmin() { try { return localStorage.getItem('pfa-admin') === '1'; } catch (e) { return false; } }
  // Which view a URL points at, so the Data analytics view is directly linkable
  // (like answerarena's ?admin=data-analytics). Recognised forms:
  //   ?admin=data-analytics · ?admin=analytics · ?admin&view=analytics · #data-analytics
  function viewFromUrl() {
    try {
      var sp = new URLSearchParams(location.search);
      var a = (sp.get('admin') || '').toLowerCase(), v = (sp.get('view') || '').toLowerCase();
      if (/analytic/.test(a) || /analytic/.test(v) || /analytic/.test((location.hash || '').toLowerCase())) return 'analytics';
    } catch (e) {}
    return 'admin';
  }
  // Keep the address bar in sync with the active view (canonical form
  // ?admin / ?admin=data-analytics), preserving any other query params + hash.
  // push=true adds a history entry so the browser Back button returns to the
  // previous view; otherwise it just replaces the current URL.
  function setViewUrl(view, push) {
    try {
      var sp = new URLSearchParams(location.search);
      sp.delete('admin'); sp.delete('view');
      var rest = sp.toString();
      var q = '?admin' + (view === 'analytics' ? '=data-analytics' : '') + (rest ? '&' + rest : '');
      var url = location.pathname + q + location.hash;
      if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    } catch (e) {}
  }
  function route() {
    if (!user) { try { localStorage.removeItem('pfa-admin'); } catch (e) {} return renderLogin(); }
    if (user.email !== ADMIN_EMAIL) { try { localStorage.removeItem('pfa-admin'); } catch (e) {} return renderNotAuthorized(); }
    try { localStorage.setItem('pfa-admin', '1'); } catch (e) {}
    currentView = viewFromUrl();          // open the view the link points at
    setViewUrl(currentView, false);       // normalise the address bar
    loadConfig().then(renderShell);
  }

  function renderLogin() {
    clearRoot();
    var email = el('input', { type: 'email', placeholder: 'admin@admin.com' });
    var pass = el('input', { type: 'password', placeholder: 'Password' });
    var err = el('div', { class: 'pfa-err' });
    var btn = el('button', { class: 'pfa-btn', on: { click: doLogin } }, ['Log in']);
    root.appendChild(el('div', { class: 'pfa-wrap' }, [
      el('div', { class: 'pfa-card pfa-login' }, [
        el('h1', { text: 'PortfolioFit admin' }),
        el('div', { class: 'pfa-field' }, [el('label', { text: 'E-mail' }), email]),
        el('div', { class: 'pfa-field' }, [el('label', { text: 'Password' }), pass]),
        err, btn,
        el('div', { style: 'margin-top:12px;' }, [themeToggle()])
      ])
    ]));
    async function doLogin() {
      err.textContent = ''; btn.setAttribute('disabled', 'true');
      try { await fb.A.signInWithEmailAndPassword(fb.auth, email.value.trim(), pass.value); }
      catch (e) { btn.removeAttribute('disabled'); err.textContent = 'Login failed: ' + ((e && e.code) || 'error'); }
    }
  }
  function renderNotAuthorized() {
    clearRoot();
    root.appendChild(el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card pfa-login' }, [
      el('h1', { text: 'Not authorized' }),
      el('p', { class: 'pfa-note', html: 'Signed in as ' + esc(user.email) + ', which is not the admin account.' }),
      el('button', { class: 'pfa-btn sec', on: { click: function () { if (fb) fb.A.signOut(fb.auth); } } }, ['Sign out'])
    ])]));
  }

  // Shared admin header: title + top-right nav (Admin | Data analytics) + theme +
  // Sign out. The nav mirrors the answerarena admin; the active view is
  // highlighted. Switching views re-renders the shell in place.
  function headerRow() {
    function nav(label, view) {
      return el('button', { class: 'pfa-btn sec sm' + (currentView === view ? ' is-nav-on' : ''), on: { click: function () { if (currentView !== view) { currentView = view; setViewUrl(view, true); renderShell(); } } } }, [label]);
    }
    return el('div', { class: 'pfa-h' }, [
      el('h1', { text: 'PortfolioFit admin' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [
        nav('Admin', 'admin'), nav('Data analytics', 'analytics'), themeToggle(),
        el('button', { class: 'pfa-btn sec sm', on: { click: function () { if (fb) fb.A.signOut(fb.auth); } } }, ['Sign out'])
      ])
    ]);
  }

  function renderShell() {
    clearRoot();
    if (currentView === 'analytics') return renderAnalytics();
    var tabs = [['content', 'Content'], ['registration', 'Registration'], ['survey', 'Survey'], ['puzzles', 'Puzzles'], ['settings', 'Settings'], ['sessions', 'Sessions'], ['participants', 'Participants']];
    var tabBar = el('div', { class: 'pfa-tabs' }, tabs.map(function (t) {
      return el('button', { class: tab === t[0] ? 'on' : '', on: { click: function () { tab = t[0]; renderShell(); } } }, [t[1]]);
    }));
    var body = el('div', {});
    var wrap = el('div', { class: 'pfa-wrap' }, [
      headerRow(),
      tabBar, body
    ]);
    root.appendChild(wrap);
    if (tab === 'content') renderContent(body);
    else if (tab === 'registration') renderQuestions(body, 'registrationQuestions', 'Registration questions');
    else if (tab === 'survey') renderQuestions(body, 'surveyQuestions', 'Survey questions');
    else if (tab === 'puzzles') renderPuzzles(body);
    else if (tab === 'settings') renderSettings(body);
    else if (tab === 'sessions') renderSessions(body);
    else if (tab === 'participants') renderParticipants(body);
  }

  // ---- Content tab (collapsible pages, each with default controls) ----
  function renderContent(body) {
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('p', { class: 'pfa-note', html: 'Edit the wording players see on each page. Each field is pre-filled with the current text (the built-in default unless you have saved a change). <b>Save</b> (or <b>Make this the default</b>) saves the page so players see it. <b>Restore built-in default</b> reverts the page to the original wording.' })
    ]));
    PAGE_GROUPS.forEach(function (g) { body.appendChild(renderPageSection(g)); });
  }
  function renderPageSection(g) {
    var section = el('div', { class: 'pfa-card', style: 'padding:0;overflow:hidden;' });
    var caret = el('span', { text: '▾', style: 'color:var(--muted);' });
    var bodyDiv = el('div', { style: 'display:none;padding:0 18px 16px;' });
    var open = false, inputs = {};
    var header = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;', on: { click: toggle } }, [
      el('b', { text: g.label, style: 'font-size:15px;' }), caret
    ]);
    section.appendChild(header); section.appendChild(bodyDiv);

    function build() {
      bodyDiv.innerHTML = ''; inputs = {};
      g.fields.forEach(function (key) {
        var meta = TEXT_FIELD_META[key]; if (!meta) return;
        // Show the current effective text: the saved override if present,
        // otherwise the built-in default (so fields are never blank).
        var dflt = (window.PF_DEFAULTS && window.PF_DEFAULTS.texts) ? window.PF_DEFAULTS.texts[key] : undefined;
        var saved = cfg.texts[key];
        var val = (saved == null || saved === '' || (Array.isArray(saved) && !saved.length)) ? dflt : saved;
        if (meta.kind === 'paras') val = Array.isArray(val) ? val.join('\n') : (val || '');
        var input = (meta.kind === 'line') ? el('input', { type: 'text', value: val || '' }) : el('textarea', { rows: meta.kind === 'paras' ? '5' : '3', value: val || '' });
        inputs[key] = { input: input, kind: meta.kind };
        bodyDiv.appendChild(el('div', { class: 'pfa-field' }, [el('label', { text: meta.label }), input]));
      });
      bodyDiv.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;' }, [
        el('button', { class: 'pfa-btn', on: { click: withFeedback(save) } }, ['Save']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(makeDefault) } }, ['Make this the default']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(restoreBuiltin, '✓ Restored') } }, ['Restore built-in default'])
      ]));
    }
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open) build(); }
    function collect() {
      var texts = {};
      Object.keys(inputs).forEach(function (key) {
        var v = inputs[key].input.value;
        texts[key] = inputs[key].kind === 'paras' ? v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : v;
      });
      return texts;
    }
    // One live config, so "Save" and "Make this the default" both persist this
    // page's text (just different confirmation wording).
    function persist(msg) {
      var merged = Object.assign({}, cfg.texts, collect());
      return saveConfig({ texts: merged }).then(function () { cfg.texts = merged; toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); throw e; });
    }
    function save() { return persist(g.label + ' saved.'); }
    function makeDefault() { return persist(g.label + ' saved as the default.'); }
    function restoreBuiltin() {
      var D = (window.PF_DEFAULTS && window.PF_DEFAULTS.texts) || {};
      var merged = Object.assign({}, cfg.texts);
      g.fields.forEach(function (key) { if (D[key] !== undefined) merged[key] = D[key]; else delete merged[key]; });
      return saveConfig({ texts: merged }).then(function () { cfg.texts = merged; build(); toast(g.label + ' restored to built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); throw e; });
    }
    return section;
  }

  // ---- Registration / Survey question editor ----
  function renderQuestions(body, field, title) {
    var list = ((cfg[field] && cfg[field].length) ? cfg[field] : ((window.PF_DEFAULTS && window.PF_DEFAULTS[field]) || [])).map(function (q) { return Object.assign({}, q); });
    var card = el('div', { class: 'pfa-card' });
    var listWrap = el('div', {});
    card.appendChild(el('p', { class: 'pfa-note', text: title + '. Drag order with the up/down buttons. The Registration form is shown after the training phase; "country" renders a full country dropdown.' }));
    card.appendChild(listWrap);
    var addBtn = el('button', { class: 'pfa-btn sec sm', on: { click: function () { list.push({ id: 'q_' + Date.now().toString(36), label: 'New question', type: 'text', required: true }); render(); } } }, ['+ Add question']);
    card.appendChild(el('div', { class: 'pfa-field' }, [addBtn]));
    card.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;' }, [
      el('button', { class: 'pfa-btn', on: { click: withFeedback(save) } }, ['Save']),
      el('button', { class: 'pfa-btn sec', on: { click: withFeedback(makeDefault) } }, ['Make this the default']),
      el('button', { class: 'pfa-btn sec', on: { click: withFeedback(restoreBuiltin, '✓ Restored') } }, ['Restore built-in default'])
    ]));
    body.appendChild(card);
    render();

    function builtinOrSaved() { return ((cfg[field] && cfg[field].length) ? cfg[field] : ((window.PF_DEFAULTS && window.PF_DEFAULTS[field]) || [])).map(function (q) { return Object.assign({}, q); }); }
    function restoreBuiltin() {
      list = ((window.PF_DEFAULTS && window.PF_DEFAULTS[field]) || []).map(function (q) { return Object.assign({}, q); });
      var patch = {}; patch[field] = list;
      return saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); render(); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); throw e; });
    }

    function render() {
      listWrap.innerHTML = '';
      list.forEach(function (q, i) {
        var qb = el('div', { class: 'pfa-q' });
        var labelI = el('input', { type: 'text', value: q.label || '', style: 'min-width:220px;flex:1 1 240px;' });
        labelI.addEventListener('input', function () { q.label = labelI.value; });
        var typeS = el('select', {}, QUESTION_TYPES.map(function (t) { return el('option', { value: t }, [t]); }));
        typeS.value = q.type || 'text';
        typeS.addEventListener('change', function () { q.type = typeS.value; render(); });
        var reqL = el('label', { style: 'font-weight:500;display:flex;align-items:center;gap:5px;' });
        var reqC = el('input', { type: 'checkbox' }); if (q.required) reqC.setAttribute('checked', 'checked');
        reqC.addEventListener('change', function () { q.required = reqC.checked; });
        reqL.appendChild(reqC); reqL.appendChild(document.createTextNode('required'));
        var up = el('button', { class: 'pfa-btn sec sm', on: { click: function () { if (i > 0) { var t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; render(); } } } }, ['↑']);
        var dn = el('button', { class: 'pfa-btn sec sm', on: { click: function () { if (i < list.length - 1) { var t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; render(); } } } }, ['↓']);
        var del = el('button', { class: 'pfa-btn danger sm', on: { click: function () { list.splice(i, 1); render(); } } }, ['delete']);
        qb.appendChild(el('div', { class: 'row' }, [labelI, typeS, reqL, up, dn, del]));
        qb.appendChild(el('div', { class: 'pfa-note', style: 'margin-top:4px;', text: 'id: ' + (q.id || '') + (q.system ? ' (system: ' + q.system + ')' : '') }));
        if (q.type === 'select' || q.type === 'radio') {
          var opt = el('textarea', { rows: '3', value: (q.options || []).join('\n'), style: 'margin-top:6px;' });
          opt.addEventListener('input', function () { q.options = opt.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
          qb.appendChild(el('div', { class: 'pfa-field' }, [el('label', { text: 'Options (one per line)' }), opt]));
        }
        if (q.help != null || q.type === 'select' || q.type === 'radio') {
          var help = el('input', { type: 'text', value: q.help || '', placeholder: 'Optional helper text' });
          help.addEventListener('input', function () { q.help = help.value; });
          qb.appendChild(el('div', { class: 'pfa-field' }, [el('label', { text: 'Helper text' }), help]));
        }
        listWrap.appendChild(qb);
      });
    }
    function persist(msg) {
      var patch = {}; patch[field] = list;
      return saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); throw e; });
    }
    function save() { return persist(title + ' saved.'); }
    function makeDefault() { return persist(title + ' saved as the default.'); }
  }

  // ---- Puzzles tab ----
  function puzzleGrid(spec, small) {
    var cell = small ? 8 : 15;
    var set = {}; (spec.region || []).forEach(function (k) { set[k] = true; });
    var grid = el('div', { style: 'display:grid;grid-template-columns:repeat(' + spec.cols + ',' + cell + 'px);gap:1px;margin:6px 0;justify-content:center;' });
    for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
      var on = set[r + ',' + c];
      grid.appendChild(el('div', { style: 'width:' + cell + 'px;height:' + cell + 'px;border-radius:2px;background:' + (on ? '#e67e22' : 'transparent') + ';' }));
    }
    return grid;
  }
  function renderPuzzles(body) {
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('p', { class: 'pfa-note', html: 'Every board is the <b>same fixed 4×4 square</b> — difficulty comes only from the per-puzzle <b>brick values</b> (Easy = Sahni κ&nbsp;1, Hard = κ&nbsp;2), never from the board\'s shape or size. Every generated puzzle has a <b>single best solution</b>: one full-cover portfolio reaches the maximum Net Value, no partial placement ties it, and it tiles the board a single way up to rotation/reflection — so the “Solutions” list shows exactly one top solution, and the “κ proof” shows the same optimum. Build the exact set every participant plays: <b>Generate set to match Settings</b> creates puzzles to match your easy/hard counts; review each (Solutions / κ proof), regenerate any you dislike, then <b>Save</b> to freeze. Every participant then plays that same frozen set in randomized order. (You can also add puzzles one at a time.)' }));
    card.appendChild(el('p', { class: 'pfa-note', html: '📄 <a href="https://www.stouras.com/lab/portfoliofit-testing/portfoliofit-difficulty.pdf" target="_blank" rel="noopener" style="color:var(--accent);">How the Sahni difficulty (κ) is measured (PDF note)</a>' }));
    if (!window.PFGame || !window.PFGame.generatePuzzle) {
      card.appendChild(el('p', { class: 'pfa-err', text: 'Puzzle generator not available. Open /lab/portfoliofit/?admin (the game must be on the page).' }));
      body.appendChild(card); return;
    }
    var per0 = (cfg.settings && cfg.settings.puzzlesPerUser) || { easy: 2, hard: 2 };
    var needE0 = Math.max(0, per0.easy | 0), needH0 = Math.max(0, per0.hard | 0);
    card.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;' }, [
      el('button', { class: 'pfa-btn', on: { click: function () { generateSetForReview(); } } }, ['✨ Generate set to match Settings (' + needE0 + ' easy + ' + needH0 + ' hard)']),
      el('button', { class: 'pfa-btn sec', on: { click: function () { generate('easy'); } } }, ['+ Generate easy']),
      el('button', { class: 'pfa-btn sec', on: { click: function () { generate('hard'); } } }, ['+ Generate hard'])
    ]));
    var preview = el('div', {});
    card.appendChild(preview);
    body.appendChild(card);
    var approvedCard = el('div', { class: 'pfa-card' });
    var activeCard = el('div', { class: 'pfa-card' });
    body.appendChild(approvedCard); body.appendChild(activeCard);
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('p', { class: 'pfa-note', text: '“Save” (or “Make this the default”) freezes your approved set as the active set for all participants. “Restore built-in default” reverts to the built-in default puzzles. (Use “Clear set” above to empty the set you are building.)' }),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
        el('button', { class: 'pfa-btn', on: { click: withFeedback(freezeGuarded) } }, ['Save']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(freezeGuarded) } }, ['Make this the default']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(clearActive, '✓ Restored') } }, ['Restore built-in default'])
      ])
    ]));
    renderApproved(); renderActive();

    function generate(diff) {
      var spec; try { spec = window.PFGame.generatePuzzle(diff); } catch (e) { spec = null; }
      preview.innerHTML = '';
      if (!spec) { preview.appendChild(el('p', { class: 'pfa-err', text: 'Generation failed; try again.' })); return; }
      var solCount = (spec.tilings && spec.tilings.count != null) ? spec.tilings.count : null;
      preview.appendChild(el('div', { class: 'pfa-q' }, [
        el('div', { class: 'pfa-note', text: diff.toUpperCase() + ' — ' + spec.rows + '×' + spec.cols + ' board, Sahni κ=' + spec.kappa + (solCount != null ? ' · ' + solCount + ' distinct solution' + (solCount === 1 ? '' : 's') : '') + ' · best $' + spec.bestValue }),
        puzzleGrid(spec),
        el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;' }, [
          el('button', { class: 'pfa-btn sec', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showSolutions(); } catch (e) {} } } }, ['📋 Full coverage solutions']),
          el('button', { class: 'pfa-btn sec', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showProof(); } catch (e) {} } } }, ['🔍 Why κ = ? (proof)'])
        ]),
        el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;' }, [
          el('button', { class: 'pfa-btn', on: { click: function () { approvedPuzzles.push(spec); preview.innerHTML = ''; renderApproved(); toast('Added to set.'); } } }, ['Approve & add']),
          el('button', { class: 'pfa-btn sec', on: { click: function () { generate(diff); } } }, ['Regenerate']),
          el('button', { class: 'pfa-btn sec', on: { click: function () { preview.innerHTML = ''; } } }, ['Discard'])
        ])
      ]));
    }
    // Generate a reviewable set sized to the Settings counts: reuse the vetted
    // built-in puzzles first, then generate the shortfall. Admin reviews/regenerates
    // and then Saves (freezes) so every participant plays this exact set.
    function generateSetForReview() {
      var per = (cfg.settings && cfg.settings.puzzlesPerUser) || { easy: 2, hard: 2 };
      var needE = Math.max(0, per.easy | 0), needH = Math.max(0, per.hard | 0);
      if (!needE && !needH) { toast('Set the puzzle counts in the Settings tab first.'); return; }
      var def = (window.PF_DEFAULTS && window.PF_DEFAULTS.defaultPuzzles) || [];
      var poolE = def.filter(function (s) { return s.diff !== 'hard'; });
      var poolH = def.filter(function (s) { return s.diff === 'hard'; });
      var set = [], failed = 0;
      [['easy', poolE, needE], ['hard', poolH, needH]].forEach(function (g) {
        var diff = g[0], pool = g[1], need = g[2];
        for (var i = 0; i < need; i++) {
          if (i < pool.length) { set.push(JSON.parse(JSON.stringify(pool[i]))); }
          else { var spec = null; try { spec = window.PFGame.generatePuzzle(diff); } catch (e) {} if (spec) set.push(spec); else failed++; }
        }
      });
      approvedPuzzles = set;
      preview.innerHTML = '';
      renderApproved(); renderActive();
      toast('Built ' + set.length + ' puzzle' + (set.length === 1 ? '' : 's') + ' for review' + (failed ? ' (' + failed + ' generation(s) failed — retry)' : '') + '. Review them, then Save to lock the set.');
    }
    function renderApproved() {
      approvedCard.innerHTML = '';
      approvedCard.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 8px;' }, [
        el('h3', { text: 'Set to freeze (' + approvedPuzzles.length + ')', style: 'margin:0;font-size:15px;' }),
        approvedPuzzles.length ? el('button', { class: 'pfa-btn sec sm', on: { click: function () { approvedPuzzles = []; renderApproved(); toast('Cleared approved set.'); } } }, ['Clear set']) : null
      ]));
      if (!approvedPuzzles.length) { approvedCard.appendChild(el('p', { class: 'pfa-note', text: 'No puzzles approved yet. Use “Generate set to match Settings” above, then review and Save.' })); return; }
      var wrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' });
      approvedPuzzles.forEach(function (spec, i) {
        var sc = (spec.tilings && spec.tilings.count != null) ? spec.tilings.count : null;
        wrap.appendChild(el('div', { class: 'pfa-q', style: 'flex:0 0 auto;text-align:center;min-width:120px;' }, [
          el('div', { class: 'pfa-note', text: '#' + (i + 1) + ' · ' + spec.diff + ' · κ=' + spec.kappa + (sc != null ? ' · ' + sc + ' sol.' : '') + ' · $' + spec.bestValue }),
          puzzleGrid(spec, true),
          el('div', { style: 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:4px;' }, [
            el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showSolutions(); } catch (e) {} } } }, ['Solutions']),
            el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showProof(); } catch (e) {} } } }, ['κ proof']),
            el('button', { class: 'pfa-btn sec sm', on: { click: function () { var ns = null; try { ns = window.PFGame.generatePuzzle(spec.diff); } catch (e) {} if (ns) { approvedPuzzles[i] = ns; renderApproved(); toast('Regenerated #' + (i + 1) + '.'); } else { toast('Generation failed; try again.'); } } } }, ['↻ regenerate']),
            el('button', { class: 'pfa-btn danger sm', on: { click: function () { approvedPuzzles.splice(i, 1); renderApproved(); } } }, ['remove'])
          ])
        ]));
      });
      approvedCard.appendChild(wrap);
    }
    function renderActive() {
      activeCard.innerHTML = '';
      activeCard.appendChild(el('h3', { text: 'Current active set', style: 'margin:0 0 8px;font-size:15px;' }));
      var ids = (cfg.settings && cfg.settings.activePuzzleIds) || [];
      if (!ids.length) {
        var def = (window.PF_DEFAULTS && window.PF_DEFAULTS.defaultPuzzles) || [];
        var per = (cfg.settings && cfg.settings.puzzlesPerUser) || { easy: 2, hard: 2 };
        var poolE = def.filter(function (sp) { return sp.diff !== 'hard'; });
        var poolH = def.filter(function (sp) { return sp.diff === 'hard'; });
        var needE = Math.max(0, per.easy | 0), needH = Math.max(0, per.hard | 0);
        if (!needE && !needH) {
          activeCard.appendChild(el('p', { class: 'pfa-note', text: 'No custom set frozen, and the Settings counts are 0 easy / 0 hard — participants would get no puzzles. Set the counts in the Settings tab.' }));
          return;
        }
        var serve = poolE.slice(0, needE).concat(poolH.slice(0, needH));
        var shortE = Math.max(0, needE - poolE.length), shortH = Math.max(0, needH - poolH.length);
        activeCard.appendChild(el('p', { class: 'pfa-note', html: 'No custom set frozen. Every participant plays the same <b>' + serve.length + '</b> built-in puzzle' + (serve.length === 1 ? '' : 's') + ' below (' + poolE.slice(0, needE).length + ' easy / ' + poolH.slice(0, needH).length + ' hard), in randomized order. Change the counts in the <b>Settings</b> tab.' }));
        if (shortE || shortH) {
          activeCard.appendChild(el('p', { class: 'pfa-note', style: 'color:#e6a23c;', html: '⚠ You asked for <b>' + needE + ' easy + ' + needH + ' hard</b>, but the built-in pool only has ' + poolE.length + ' easy / ' + poolH.length + ' hard, so only the ' + serve.length + ' above are used. Generate the rest for review and <b>freeze</b> them so every participant gets the full, vetted set:' }));
          activeCard.appendChild(el('div', { style: 'margin:0 0 8px;' }, [
            el('button', { class: 'pfa-btn', on: { click: function () { generateSetForReview(); } } }, ['✨ Generate ' + needE + ' easy + ' + needH + ' hard for review'])
          ]));
        }
        if (serve.length) {
          var dwrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;' });
          activeCard.appendChild(dwrap);
          serve.forEach(function (spec, i) {
            var sc = (spec.tilings && spec.tilings.count != null) ? spec.tilings.count : null;
            dwrap.appendChild(el('div', { class: 'pfa-q', style: 'flex:0 0 auto;text-align:center;min-width:120px;' }, [
              el('div', { class: 'pfa-note', text: '#' + (i + 1) + ' · ' + spec.diff + ' · κ=' + spec.kappa + (sc != null ? ' · ' + sc + ' sol.' : '') + ' · $' + spec.bestValue }),
              puzzleGrid(spec, true),
              el('div', { style: 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:4px;' }, [
                el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showSolutions(); } catch (e) {} } } }, ['Solutions']),
                el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showProof(); } catch (e) {} } } }, ['κ proof'])
              ])
            ]));
          });
        }
        return;
      }
      activeCard.appendChild(el('p', { class: 'pfa-note', text: ids.length + ' frozen puzzle(s) active. These are the exact puzzles every participant plays — each participant sees them in a randomized order.' }));
      var wrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;' });
      activeCard.appendChild(wrap);
      var cells = ids.map(function (id, i) {
        var c = el('div', { class: 'pfa-q', style: 'flex:0 0 auto;text-align:center;min-width:120px;' }, [el('div', { class: 'pfa-note', text: '#' + (i + 1) + ' loading…' })]);
        wrap.appendChild(c); return c;
      });
      ids.forEach(function (id, idx) {
        fb.F.getDoc(fb.F.doc(fb.db, 'puzzleSets', id)).then(function (snap) {
          var cell = cells[idx]; cell.innerHTML = '';
          if (!snap.exists()) { cell.appendChild(el('div', { class: 'pfa-note', text: '#' + (idx + 1) + ' (missing)' })); return; }
          var d = snap.data(); var spec = null; try { spec = JSON.parse(d.specJson); } catch (e) {}
          if (!spec) { cell.appendChild(el('div', { class: 'pfa-note', text: '#' + (idx + 1) + ' (unreadable)' })); return; }
          var solCount = (spec.tilings && spec.tilings.count != null) ? spec.tilings.count : null;
          cell.appendChild(el('div', { class: 'pfa-note', text: '#' + (idx + 1) + ' · ' + spec.diff + ' · κ=' + spec.kappa + (solCount != null ? ' · ' + solCount + ' sol.' : '') + ' · $' + spec.bestValue }));
          cell.appendChild(puzzleGrid(spec, true));
          cell.appendChild(el('div', { style: 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:4px;' }, [
            el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showSolutions(); } catch (e) {} } } }, ['Solutions']),
            el('button', { class: 'pfa-btn sec sm', on: { click: function () { try { window.PFGame.previewPuzzle(spec); window.PFGame.showProof(); } catch (e) {} } } }, ['κ proof']),
            el('button', { class: 'pfa-btn danger sm', on: { click: function () { removeFromActive(id); } } }, ['remove'])
          ]));
        }).catch(function () { var cell = cells[idx]; cell.innerHTML = ''; cell.appendChild(el('div', { class: 'pfa-note', text: '#' + (idx + 1) + ' (error)' })); });
      });
    }
    async function removeFromActive(id) {
      var ids = ((cfg.settings && cfg.settings.activePuzzleIds) || []).filter(function (x) { return x !== id; });
      var s = Object.assign({}, cfg.settings, { activePuzzleIds: ids });
      try { await saveConfig({ settings: s }); cfg.settings = s; renderActive(); toast('Removed from active set.'); }
      catch (e) { toast('Failed: ' + ((e && e.code) || 'error')); }
    }
    function freezeGuarded() {
      if (!approvedPuzzles.length) { toast('Approve some puzzles first.'); return Promise.reject(new Error('no approved puzzles')); }
      return freeze();
    }
    async function freeze() {
      if (!approvedPuzzles.length) return;
      try {
        var ids = [];
        for (var i = 0; i < approvedPuzzles.length; i++) {
          var spec = approvedPuzzles[i];
          var ref = await fb.F.addDoc(fb.F.collection(fb.db, 'puzzleSets'), {
            diff: spec.diff, kappa: spec.kappa, bestValue: spec.bestValue, cells: spec.region.length,
            specJson: JSON.stringify(spec), active: true, createdAt: fb.F.serverTimestamp()
          });
          ids.push(ref.id);
        }
        var settings = Object.assign({}, cfg.settings, { activePuzzleIds: ids });
        await saveConfig({ settings: settings }); cfg.settings = settings;
        approvedPuzzles = [];
        renderApproved(); renderActive();
        toast('Active set frozen (' + ids.length + ' puzzles).');
      } catch (e) { toast('Freeze failed: ' + ((e && e.code) || 'error')); throw e; }
    }
    async function clearActive() {
      try { var s = Object.assign({}, cfg.settings, { activePuzzleIds: [] }); await saveConfig({ settings: s }); cfg.settings = s; renderActive(); toast('Reverted to built-in default set.'); }
      catch (e) { toast('Failed: ' + ((e && e.code) || 'error')); throw e; }
    }
  }

  // ---- Settings tab ----
  function renderSettings(body) {
    body.innerHTML = '';
    var s = cfg.settings || {};
    var per = s.puzzlesPerUser || { easy: 2, hard: 2 };
    var tl = s.timeLimits || { easy: 120, hard: 180 };
    var easy = el('input', { type: 'number', value: String(per.easy != null ? per.easy : 2), style: 'max-width:120px;' });
    var hard = el('input', { type: 'number', value: String(per.hard != null ? per.hard : 2), style: 'max-width:120px;' });
    // Time limits are stored as total seconds, but edited as minutes + seconds.
    function splitTime(total) { total = Math.max(0, parseInt(total, 10) || 0); return { m: Math.floor(total / 60), s: total % 60 }; }
    var teE = splitTime(tl.easy != null ? tl.easy : 120), teH = splitTime(tl.hard != null ? tl.hard : 180);
    var teasyMin = el('input', { type: 'number', min: '0', value: String(teE.m), style: 'max-width:90px;' });
    var teasySec = el('input', { type: 'number', min: '0', max: '59', value: String(teE.s), style: 'max-width:90px;' });
    var thardMin = el('input', { type: 'number', min: '0', value: String(teH.m), style: 'max-width:90px;' });
    var thardSec = el('input', { type: 'number', min: '0', max: '59', value: String(teH.s), style: 'max-width:90px;' });
    // Combine a minutes + seconds pair into total seconds (seconds clamped 0-59).
    function combineTime(minInput, secInput, fallback) {
      var m = Math.max(0, parseInt(minInput.value, 10) || 0);
      var sec = Math.min(59, Math.max(0, parseInt(secInput.value, 10) || 0));
      var total = m * 60 + sec;
      return total > 0 ? total : fallback;
    }
    function timeField(labelText, minInput, secInput) {
      return el('div', { class: 'pfa-field' }, [
        el('label', { text: labelText }),
        el('div', { style: 'display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;' }, [
          el('div', { style: 'display:flex;flex-direction:column;gap:3px;' }, [el('span', { class: 'pfa-note', text: 'Minutes', style: 'margin:0;' }), minInput]),
          el('div', { style: 'display:flex;flex-direction:column;gap:3px;' }, [el('span', { class: 'pfa-note', text: 'Seconds (0–59)', style: 'margin:0;' }), secInput])
        ])
      ]);
    }
    var rnd = el('input', { type: 'checkbox' }); if (s.randomizeOrder !== false) rnd.setAttribute('checked', 'checked');
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy puzzles per participant' }), easy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard puzzles per participant' }), hard]),
      timeField('Easy time limit per puzzle', teasyMin, teasySec),
      timeField('Hard time limit per puzzle', thardMin, thardSec),
      el('div', { class: 'pfa-field' }, [el('label', { style: 'display:flex;align-items:center;gap:8px;' }, [rnd, document.createTextNode('Randomize puzzle order per participant')])]),
      el('p', { class: 'pfa-note', text: 'Puzzle counts apply when no custom set is frozen (see the Puzzles tab): each participant gets that many easy/hard puzzles, drawn at random from the built-in pool (extra puzzles are generated if the pool runs short). Time limits apply to every puzzle of that difficulty, in training and the main game.' }),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;' }, [
        el('button', { class: 'pfa-btn', on: { click: withFeedback(save) } }, ['Save']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(makeDefault) } }, ['Make this the default']),
        el('button', { class: 'pfa-btn sec', on: { click: withFeedback(restoreDefaults, '✓ Restored') } }, ['Restore built-in default'])
      ])
    ]));
    function persist(msg) {
      var settings = Object.assign({}, s, {
        puzzlesPerUser: { easy: parseInt(easy.value, 10) || 0, hard: parseInt(hard.value, 10) || 0 },
        timeLimits: { easy: combineTime(teasyMin, teasySec, 120), hard: combineTime(thardMin, thardSec, 180) },
        randomizeOrder: rnd.checked
      });
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); throw e; });
    }
    function save() { return persist('Settings saved.'); }
    function makeDefault() { return persist('Settings saved as the default.'); }
    function restoreDefaults() {
      var D = (window.PF_DEFAULTS && window.PF_DEFAULTS.settings) || {};
      var settings = Object.assign({}, cfg.settings, {
        puzzlesPerUser: D.puzzlesPerUser || { easy: 2, hard: 2 },
        timeLimits: D.timeLimits || { easy: 120, hard: 180 },
        randomizeOrder: D.randomizeOrder !== false,
        trainingDifficulty: D.trainingDifficulty || 'easy'
      });
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; renderSettings(body); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); throw e; });
    }
  }

  // ---- Sessions tab ----
  // A session is a named snapshot of the current configuration, addressable by a
  // short code. Players enter the code on the welcome screen to join that exact
  // configuration; players with no code get the default config (the other tabs).
  function renderSessions(body) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('p', { class: 'pfa-note', html: 'Create a <b>session</b>, then share its <b>Session ID</b> (or a <code>?session=CODE</code> link) with players — they enter it on the welcome screen to join (a code is required to play). A session snapshots the <b>current configuration</b> (Content, questions, Settings and the active puzzle set). Sessions are listed under <b>Active</b> (open, accepting players) and <b>Completed</b> (closed, read-only). <b>Close</b> a session to block new joins; data already collected is unaffected. Use <b>⬇ Excel</b> on any session to download a combined file of every player who has played it.' })
    ]));

    var nameIn = el('input', { type: 'text', placeholder: 'e.g. Spring MBA 2026', style: 'max-width:340px;' });
    var codeIn = el('input', { type: 'text', placeholder: '(optional) custom code', style: 'max-width:240px;text-transform:uppercase;' });
    var msg = el('div', { class: 'pfa-err' });
    var createBtn = el('button', { class: 'pfa-btn', on: { click: withFeedback(doCreate, '✓ Created') } }, ['Create session']);
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Session name' }), nameIn]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Session ID' }), codeIn,
        el('div', { class: 'pfa-note', style: 'margin-top:4px;', text: 'Leave blank to auto-generate a short code. Letters, digits and dashes only (3–40 chars).' })]),
      msg,
      el('div', {}, [createBtn])
    ]));

    var listCard = el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-note', text: 'Loading sessions…' })]);
    body.appendChild(listCard);
    loadList();

    function doCreate() {
      msg.textContent = '';
      var name = nameIn.value.trim();
      var typed = codeIn.value.trim();
      var code = sanitizeCode(typed);
      if (typed && code.length < 3) { msg.textContent = 'Session ID must be 3–40 letters, digits or dashes.'; return Promise.reject(new Error('bad-code')); }
      if (!code) code = genCode();
      var ref = fb.F.doc(fb.db, 'sessions', code);
      return fb.F.getDoc(ref).then(function (existing) {
        if (existing.exists() && !window.confirm('A session with ID "' + code + '" already exists. Overwrite it with the current configuration?')) return Promise.reject(new Error('cancel'));
        var payload = {
          name: name, label: name, status: 'open',
          texts: cfg.texts || {}, settings: cfg.settings || {},
          registrationQuestions: cfg.registrationQuestions || [],
          registrationConsents: cfg.registrationConsents || [],
          surveyQuestions: cfg.surveyQuestions || [],
          updatedAt: fb.F.serverTimestamp()
        };
        if (!existing.exists()) payload.createdAt = fb.F.serverTimestamp();
        return fb.F.setDoc(ref, payload, { merge: true }).then(function () {
          nameIn.value = ''; codeIn.value = '';
          toast('Session "' + code + '" created.');
          loadList();
        });
      }).catch(function (e) {
        if (e && (e.message === 'cancel' || e.message === 'bad-code')) throw e;
        msg.textContent = 'Could not save: ' + ((e && e.code) || 'error'); throw e;
      });
    }

    function loadList() {
      listCard.innerHTML = '';
      listCard.appendChild(el('p', { class: 'pfa-note', text: 'Loading sessions…' }));
      // Read the sessions list first; participant counts are a best-effort second
      // read so a failure there cannot blank the list. A permission-denied on the
      // sessions read almost always means this project's Firestore rules predate
      // the sessions collection and need (re)deploying — say so, don't just print
      // the bare error code.
      fb.F.getDocs(fb.F.collection(fb.db, 'sessions')).then(function (sessSnap) {
        var docs = []; sessSnap.forEach(function (d) { docs.push(Object.assign({ _id: d.id }, d.data())); });
        return fb.F.getDocs(fb.F.collection(fb.db, 'participants')).then(
          function (pSnap) { var counts = {}; pSnap.forEach(function (d) { var sid = (d.data() || {}).sessionId; if (sid) counts[sid] = (counts[sid] || 0) + 1; }); return { docs: docs, counts: counts }; },
          function () { return { docs: docs, counts: null }; }   // counts unavailable: still show the list
        );
      }).then(function (data) {
        listCard.innerHTML = '';
        var docs = data.docs, counts = data.counts;
        docs.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        // Active = open (or no status); Completed = closed.
        var active = docs.filter(function (s) { return s.status !== 'closed'; });
        var done = docs.filter(function (s) { return s.status === 'closed'; });
        listCard.appendChild(section('Active Sessions', 'Open sessions accept new players. Share the code, monitor joins, and download data anytime.', active, counts, false));
        listCard.appendChild(section('Completed Sessions', 'Closed (read-only) sessions no longer accept new players. Download their data before deleting.', done, counts, true));
      }).catch(function (e) {
        listCard.innerHTML = '';
        var code = (e && e.code) || 'error';
        listCard.appendChild(el('p', { class: 'pfa-err', text: 'Could not load sessions: ' + code + '.' }));
        if (String(code).indexOf('permission-denied') >= 0) {
          listCard.appendChild(el('p', { class: 'pfa-note', text: 'This usually means this project’s Firestore security rules have not been deployed since the Sessions feature was added. Deploy the rules from the backend folder (firebase deploy --only firestore:rules), then reload this page.' }));
        }
      });
    }

    // Render one session group (Active or Completed) as its own card, with a
    // bulk "Delete all" button and per-row Excel download.
    function section(title, sub, docs, counts, isDone) {
      var word = isDone ? 'completed' : 'active';
      var card = el('div', { class: 'pfa-card' });
      var head = el('div', { class: 'pfa-h' }, [
        el('div', {}, [
          el('h3', { text: title + ' (' + docs.length + ')', style: 'margin:0;font-size:15px;' }),
          el('p', { class: 'pfa-note', style: 'margin:3px 0 0;', text: sub })
        ]),
        docs.length ? el('button', { class: 'pfa-btn danger sm', on: { click: function () { delAllSessions(docs, word); } } }, ['Delete all ' + word + ' sessions']) : el('span', {})
      ]);
      card.appendChild(head);
      if (!docs.length) { card.appendChild(el('p', { class: 'pfa-note', text: isDone ? 'No completed sessions.' : 'No active sessions yet. Create one above.' })); return card; }
      var table = el('table', { class: 'pfa-tbl' });
      table.appendChild(el('thead', {}, [el('tr', {}, ['Session ID', 'Name', 'Participants', 'Created', ''].map(function (th) { return el('th', { text: th }); }))]));
      var tb = el('tbody', {});
      docs.forEach(function (s) {
        var actions = [
          el('button', { class: 'pfa-btn sec sm', on: { click: function () { copyText(s._id, 'Session ID copied.'); } } }, ['copy ID']),
          el('button', { class: 'pfa-btn sm', on: { click: function () { exportSession(s._id); } } }, ['⬇ Excel'])
        ];
        if (isDone) actions.push(el('button', { class: 'pfa-btn sec sm', on: { click: function () { setStatus(s._id, 'open'); } } }, ['reopen']));
        else actions.push(el('button', { class: 'pfa-btn sec sm', on: { click: function () { setStatus(s._id, 'closed'); } } }, ['close']));
        actions.push(el('button', { class: 'pfa-btn danger sm', on: { click: function () { delSession(s._id); } } }, ['delete']));
        tb.appendChild(el('tr', {}, [
          el('td', {}, [el('b', { text: s._id })]),
          el('td', { text: s.name || s.label || '' }),
          el('td', { text: counts ? String(counts[s._id] || 0) : '—' }),
          el('td', { text: fmtTs(s.createdAt) }),
          el('td', {}, [el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' }, actions)])
        ]));
      });
      table.appendChild(tb);
      card.appendChild(table);
      return card;
    }

    function setStatus(code, status) {
      fb.F.setDoc(fb.F.doc(fb.db, 'sessions', code), { status: status, updatedAt: fb.F.serverTimestamp() }, { merge: true })
        .then(function () { toast(status === 'closed' ? 'Session closed (moved to Completed).' : 'Session reopened (moved to Active).'); loadList(); })
        .catch(function (e) { toast('Failed: ' + ((e && e.code) || 'error')); });
    }
    function delSession(code) {
      if (!window.confirm('Delete session "' + code + '"? Players can no longer join with this code. (Already-collected player data is not affected.)')) return;
      fb.F.deleteDoc(fb.F.doc(fb.db, 'sessions', code)).then(function () { toast('Session deleted.'); loadList(); })
        .catch(function (e) { toast('Delete failed: ' + ((e && e.code) || 'error')); });
    }
    async function delAllSessions(docs, word) {
      if (!docs || !docs.length) return;
      if (!window.confirm('Delete ALL ' + docs.length + ' ' + word + ' session' + (docs.length === 1 ? '' : 's') + '? Players can no longer join with these codes. (Already-collected player data is not affected.)')) return;
      toast('Deleting ' + word + ' sessions…');
      var ok = 0;
      for (var i = 0; i < docs.length; i++) { try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'sessions', docs[i]._id)); ok++; } catch (e) {} }
      toast('Deleted ' + ok + ' ' + word + ' session' + (ok === 1 ? '' : 's') + '.');
      loadList();
    }
  }
  function genCode() { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
  function sanitizeCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40); }
  function copyText(t, okMsg) { try { navigator.clipboard.writeText(t); toast(okMsg || 'Copied to clipboard.'); } catch (e) { window.prompt('Copy:', t); } }

  // ---- Participants tab ----
  async function renderParticipants(body) {
    body.appendChild(el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-note', text: 'Loading participants...' })]));
    var parts = [];
    try {
      var snap = await fb.F.getDocs(fb.F.collection(fb.db, 'participants'));
      snap.forEach(function (d) { parts.push(Object.assign({ _id: d.id }, d.data())); });
    } catch (e) { body.innerHTML = ''; body.appendChild(el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-err', text: 'Could not load participants: ' + ((e && e.code) || 'error') })])); return; }
    var sortDir = 'asc';   // 'asc' = oldest first, 'desc' = newest first

    body.innerHTML = '';
    var head = el('div', { class: 'pfa-h' }, [
      el('div', { class: 'pfa-note', text: parts.length + ' participant' + (parts.length === 1 ? '' : 's') }),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
        el('button', { class: 'pfa-btn', on: { click: function () { exportExcel(parts); } } }, ['Export all to Excel']),
        parts.length ? el('button', { class: 'pfa-btn danger', on: { click: function () { deleteAllParticipants(); } } }, ['Delete all participants']) : el('span', {})
      ])
    ]);
    // "Started" is a clickable header: toggles ascending/descending by start date.
    var startedTh = el('th', { style: 'cursor:pointer;user-select:none;white-space:nowrap;', title: 'Click to sort by start date (ascending / descending)' });
    startedTh.addEventListener('click', function () { sortDir = (sortDir === 'asc') ? 'desc' : 'asc'; renderRows(); });
    var tbody = el('tbody', {});
    var table = el('table', { class: 'pfa-tbl' });
    table.appendChild(el('thead', {}, [el('tr', {},
      ['Player', 'UCD Student ID', 'Session', 'Status'].map(function (h) { return el('th', { text: h }); })
        .concat([startedTh, el('th', {})]))]));
    table.appendChild(tbody);
    body.appendChild(el('div', { class: 'pfa-card' }, [head, table]));
    renderRows();

    function renderRows() {
      startedTh.textContent = 'Started ' + (sortDir === 'asc' ? '▲' : '▼');
      parts.sort(function (a, b) { var d = tsMs(a.createdAt) - tsMs(b.createdAt); return (sortDir === 'asc') ? d : -d; });
      tbody.innerHTML = '';
      if (!parts.length) { tbody.appendChild(el('tr', {}, [el('td', { colspan: '6', text: 'No players yet.' })])); return; }
      parts.forEach(function (p) {
        var sid = p.studentId || (p.registration && p.registration.studentId) || '';
        var who = p.anonymousLabel || p.participantId || p.email || p._id;
        tbody.appendChild(el('tr', {}, [
          el('td', { text: who }),
          el('td', { text: sid || '—' }),
          el('td', { text: p.sessionId || '—' }),
          el('td', { text: p.status || '' }),
          el('td', { text: fmtTs(p.createdAt) }),
          el('td', {}, [el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' }, [
            el('button', { class: 'pfa-btn sm', on: { click: function () { exportParticipant(p); } } }, ['⬇ Excel']),
            el('button', { class: 'pfa-btn danger sm', on: { click: function () { deleteParticipant(p._id, who); } } }, ['delete'])
          ])])
        ]));
      });
    }

    async function deleteParticipant(uid, who) {
      if (!window.confirm('Delete participant "' + who + '" and all their data? This cannot be undone.')) return;
      toast('Deleting…');
      try { await deleteParticipantDeep(uid); toast('Participant deleted.'); renderParticipants(body); }
      catch (e) { toast('Delete failed: ' + ((e && e.code) || 'error')); }
    }
    async function deleteAllParticipants() {
      if (!parts.length) return;
      if (!window.confirm('Delete ALL ' + parts.length + ' participant' + (parts.length === 1 ? '' : 's') + ' and all their data (moves, rounds, survey)? This cannot be undone.')) return;
      toast('Deleting all participants…');
      var ok = 0;
      for (var i = 0; i < parts.length; i++) { try { await deleteParticipantDeep(parts[i]._id); ok++; } catch (e) {} }
      toast('Deleted ' + ok + ' participant' + (ok === 1 ? '' : 's') + '.');
      renderParticipants(body);
    }
  }

  function tsMs(ts) { if (!ts) return 0; if (typeof ts.toMillis === 'function') return ts.toMillis(); if (ts.seconds) return ts.seconds * 1000; return 0; }
  // Coerce a Firestore Timestamp / ISO string / ms number / Date into a Date.
  function toDate(x) {
    if (!x) return null;
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
    if (typeof x === 'object') { if (typeof x.toMillis === 'function') return new Date(x.toMillis()); if (x.seconds != null) return new Date(x.seconds * 1000); return null; }
    if (typeof x === 'number') return new Date(x);
    if (typeof x === 'string') { var d = new Date(x); return isNaN(d.getTime()) ? null : d; }
    return null;
  }
  // Format any time as UK (Europe/London, auto BST/GMT) like "22/6/2026, 7:37:47 AM".
  function fmtUK(x) {
    var d = toDate(x); if (!d) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(d);
      var m = {}; parts.forEach(function (p) { m[p.type] = p.value; });
      var ap = (m.dayPeriod || '').toUpperCase();
      // No leading zeros on day/month/hour; keep minute/second 2-digit (e.g. 22/6/2026, 7:37:47 AM).
      return Number(m.day) + '/' + Number(m.month) + '/' + m.year + ', ' + Number(m.hour) + ':' + m.minute + ':' + m.second + (ap ? ' ' + ap : '');
    } catch (e) { return d.toISOString(); }
  }
  function fmtTs(ts) { return fmtUK(ts); }

  // ---- Excel export ----
  async function ensureXLSX() {
    if (XLSX) return XLSX;
    XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    return XLSX;
  }
  function parseJson(s, fallback) { if (s == null) return fallback; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return fallback; } }
  // Build a rows x cols "FrameMatrix" (0 = empty, else brick name) from a list of
  // placements [{name, cells:[[r,c],...]}]. Board size is inferred from the cells
  // (PortfolioFit is a fixed 4x4, but this stays general).
  function matrixFromPlacements(placements) {
    placements = placements || [];
    var rows = 4, cols = 4, i, j, cs;
    for (i = 0; i < placements.length; i++) { cs = placements[i].cells || []; for (j = 0; j < cs.length; j++) { if (cs[j][0] + 1 > rows) rows = cs[j][0] + 1; if (cs[j][1] + 1 > cols) cols = cs[j][1] + 1; } }
    var m = []; for (i = 0; i < rows; i++) { var row = []; for (j = 0; j < cols; j++) row.push(0); m.push(row); }
    for (i = 0; i < placements.length; i++) { var p = placements[i], c2 = p.cells || []; for (j = 0; j < c2.length; j++) { var r = c2[j][0], c = c2[j][1]; if (m[r] && c < cols) m[r][c] = p.name || 1; } }
    return m;
  }
  // Auto-size columns to the longest cell value (capped), for readability.
  function autoWidth(ws, X) {
    try {
      var ref = ws['!ref']; if (!ref) return; var range = X.utils.decode_range(ref); var widths = [];
      for (var c = range.s.c; c <= range.e.c; c++) {
        var w = 10;
        for (var r = range.s.r; r <= range.e.r; r++) { var cell = ws[X.utils.encode_cell({ r: r, c: c })]; if (cell && cell.v != null) { var len = String(cell.v).length; if (len > w) w = len; } }
        widths.push({ wch: Math.min(60, w + 2) });
      }
      ws['!cols'] = widths;
    } catch (e) {}
  }
  function whoOf(p) { return p.anonymousLabel || p.participantId || p.email || p._id; }
  function sidOf(p) { return p.studentId || (p.registration && p.registration.studentId) || ''; }
  // Value/Resource (ROI) derived from a metrics snapshot, and a generic KPI reader
  // ('' when absent) — used to lay out the before↔after KPI columns of the Play log.
  function vprOf(m) { return (m && m.cost > 0) ? Math.round((m.value / m.cost) * 100) / 100 : ''; }
  function kval(m, key) { if (!m) return ''; if (key === 'vpr') return vprOf(m); var v = m[key]; return (v == null) ? '' : v; }
  function effRegQs(qs) { return (qs && qs.length) ? qs : ((window.PF_DEFAULTS && window.PF_DEFAULTS.registrationQuestions) || []); }
  function effSurveyQs(qs) { return (qs && qs.length) ? qs : ((window.PF_DEFAULTS && window.PF_DEFAULTS.surveyQuestions) || []); }
  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

  // Assemble every play-derived sheet's rows for a set of participants, reading
  // each player's events (→ Play log + Calculator + Notes + raw Events) and
  // rounds. The Play log is the single tab that collects every brick move across
  // all players: each row is one board change with its FrameMatrix snapshot.
  async function gatherExport(parts) {
    var play = [], calc = [], notes = [], rounds = [], survey = [], events = [], partInfo = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], uid = p._id, who = whoOf(p), sid = sidOf(p), sess = p.sessionId || '';
      partInfo.push(p);
      var evs = [];
      try { var es = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'events')); es.forEach(function (d) { evs.push(d.data()); }); } catch (e) {}
      evs.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
      var lastT = {};   // per-puzzle baseline timestamp, for per-move durations
      var moveNo = {};  // per-puzzle move counter (1,2,3… within each puzzle)
      for (var k = 0; k < evs.length; k++) {
        var v = evs[k], pid = v.puzzleId || '';
        events.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Move #': v.seq, 'Type': v.type, 'Phase': v.phase, 'Round': v.round, 'Puzzle': pid, 'Net Value': v.net, 'Coverage %': v.coverage, 'Time': fmtUK(v.clientTime), 'Data (JSON)': v.dataJson });
        if (v.type === 'round_start') {
          lastT[pid] = v.t; moveNo[pid] = 0;
          var ma0 = parseJson(v.metricsAfterJson, null);
          play.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Puzzle': pid, 'Difficulty': v.diff || '', 'Move #': '', 'Action': 'start (empty board)', 'Brick (Id)': '', 'Anchor': '', 'Cells': '', 'Brick Value': '',
            'Net Value (before)': '', 'Net Value (after)': kval(ma0, 'net'),
            'Total Value (before)': '', 'Total Value (after)': kval(ma0, 'value'),
            'Resource Cost (before)': '', 'Resource Cost (after)': kval(ma0, 'cost'),
            'Value/Resource (before)': '', 'Value/Resource (after)': kval(ma0, 'vpr'),
            'Coverage % (before)': '', 'Coverage % (after)': kval(ma0, 'coverage'),
            'Portfolio Fitness (before)': '', 'Portfolio Fitness (after)': kval(ma0, 'fitness'),
            'FrameMatrix (before)': '', 'FrameMatrix (after)': v.boardJson || '', 'Time': fmtUK(v.clientTime), 'Duration (s)': '' });
        } else if (v.type === 'place' || v.type === 'remove') {
          var prev = (lastT[pid] != null) ? lastT[pid] : v.t; var dur = (v.t - prev) / 1000; lastT[pid] = v.t;
          moveNo[pid] = (moveNo[pid] || 0) + 1;
          var mb = parseJson(v.metricsBeforeJson, null), ma = parseJson(v.metricsAfterJson, null);
          play.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Puzzle': pid, 'Difficulty': '', 'Move #': moveNo[pid], 'Action': v.action || (v.type === 'place' ? 'add' : 'remove'), 'Brick (Id)': v.brick || '', 'Anchor': v.anchor || '', 'Cells': v.cellsJson || '', 'Brick Value': (v.brickValue != null ? v.brickValue : ''),
            'Net Value (before)': kval(mb, 'net'), 'Net Value (after)': kval(ma, 'net'),
            'Total Value (before)': kval(mb, 'value'), 'Total Value (after)': kval(ma, 'value'),
            'Resource Cost (before)': kval(mb, 'cost'), 'Resource Cost (after)': kval(ma, 'cost'),
            'Value/Resource (before)': kval(mb, 'vpr'), 'Value/Resource (after)': kval(ma, 'vpr'),
            'Coverage % (before)': kval(mb, 'coverage'), 'Coverage % (after)': kval(ma, 'coverage'),
            'Portfolio Fitness (before)': kval(mb, 'fitness'), 'Portfolio Fitness (after)': kval(ma, 'fitness'),
            'FrameMatrix (before)': v.boardBeforeJson || '', 'FrameMatrix (after)': v.boardJson || '', 'Time': fmtUK(v.clientTime), 'Duration (s)': Math.round(dur * 10) / 10 });
        } else if (v.type === 'calc') {
          calc.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Puzzle': pid, 'Time': fmtUK(v.clientTime), 'Input': v.calcExpr || '', 'Output': v.calcResult || '' });
        } else if (v.type === 'note') {
          notes.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Puzzle': pid, 'Time': fmtUK(v.clientTime), 'Note': v.noteText || '' });
        }
      }
      try { var rs = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'rounds')); rs.forEach(function (d) { var rv = d.data(); var pls = parseJson(rv.placementsJson, []); rounds.push({ 'Player': who, 'UCD Student ID': sid, 'Session': sess, 'Puzzle #': rv.index, 'Puzzle ID': rv.puzzleId, 'Difficulty': rv.diff, 'Net Value': rv.net, 'Total Value': rv.value, 'Resource Cost': rv.cost, 'Coverage %': rv.coverage, 'Fitness %': rv.fitness, 'Bricks Placed': (rv.bricks != null ? rv.bricks : ''), 'Cells Filled': rv.placed, 'Board Cells': rv.total, 'Time (s)': rv.time, 'Best Value': rv.bestValue, 'Final FrameMatrix': JSON.stringify(matrixFromPlacements(pls)) }); }); } catch (e) {}
      try { var sd = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers')); if (sd.exists()) { var sv = sd.data(); survey.push({ _p: p, _answers: sv.answers || {}, _completedAt: fmtTs(sv.completedAt) }); } } catch (e) {}
    }
    return { play: play, calc: calc, notes: notes, rounds: rounds, survey: survey, events: events, partInfo: partInfo };
  }

  // The canonical tab order of every export (and of the analytics aggregate).
  var SHEET_ORDER = ['Play log', 'Calculator', 'Notes', 'Participants', 'Rounds', 'Survey', 'Events (raw)'];

  // Assemble the full export as a { sheetName: rows[] } map for a set of
  // participants. regQs / surveyQs set the column order for the Participants and
  // Survey sheets so each question appears as a column in the order it was
  // presented to participants. Shared by the Excel downloads (exportWorkbook)
  // and the Data-analytics loader, so the aggregate is byte-for-byte the same
  // shape as the per-session export.
  async function buildSheetMap(parts, regQs, surveyQs) {
    var data = await gatherExport(parts);
    var regList = effRegQs(regQs), sQ = effSurveyQs(surveyQs);

    var pRows = data.partInfo.map(function (p) {
      var reg = p.registration || {};
      var row = { 'Player': whoOf(p), 'UCD Student ID': sidOf(p), 'Session': p.sessionId || '', 'Status': p.status || '', 'Consent': p.consentGiven === true ? 'yes' : '', 'Started': fmtTs(p.createdAt) };
      regList.forEach(function (q) { if (q.id === 'studentId') return; row[q.label || q.id] = (reg[q.id] != null ? reg[q.id] : ''); });
      Object.keys(reg).forEach(function (kk) { if (kk === 'studentId') return; var covered = regList.some(function (q) { return q.id === kk; }); if (!covered) row['reg_' + kk] = (reg[kk] && typeof reg[kk] === 'object') ? JSON.stringify(reg[kk]) : reg[kk]; });
      var st = p.stats || {};
      row['Final Net Value'] = (st.totalNet != null ? st.totalNet : '');
      row['Final Coverage %'] = (st.coverage != null ? st.coverage : '');
      row['Total Time (s)'] = (st.totalTime != null ? st.totalTime : '');
      return row;
    });

    var sRows = data.survey.map(function (s) {
      var p = s._p, ans = s._answers;
      var row = { 'Player': whoOf(p), 'UCD Student ID': sidOf(p), 'Session': p.sessionId || '', 'Completed at': s._completedAt };
      sQ.forEach(function (q) { row[q.label || q.id] = (ans[q.id] != null ? ans[q.id] : ''); });
      Object.keys(ans).forEach(function (kk) { var covered = sQ.some(function (q) { return q.id === kk; }); if (!covered) row[kk] = ans[kk]; });
      return row;
    });

    return { 'Play log': data.play, 'Calculator': data.calc, 'Notes': data.notes, 'Participants': pRows, 'Rounds': data.rounds, 'Survey': sRows, 'Events (raw)': data.events };
  }

  // Build & download the workbook for a set of participants.
  async function exportWorkbook(parts, regQs, surveyQs, fileName) {
    if (!parts || !parts.length) { toast('No participants to export.'); return; }
    toast('Building export…');
    try {
      var X = await ensureXLSX();
      var map = await buildSheetMap(parts, regQs, surveyQs);
      var wb = X.utils.book_new();
      SHEET_ORDER.forEach(function (name) {
        var rows = map[name] || [];
        var ws = X.utils.json_to_sheet(rows.length ? rows : [{}]); autoWidth(ws, X); X.utils.book_append_sheet(wb, ws, name);
      });
      X.writeFile(wb, fileName);
      toast('Export ready.');
    } catch (e) { toast('Export failed: ' + ((e && e.message) || 'error')); console.error('[PFA] export failed', e); }
  }

  // All participants (config/app question order).
  function exportExcel(parts) { return exportWorkbook(parts, cfg.registrationQuestions, cfg.surveyQuestions, 'portfoliofit-all-' + stamp() + '.xlsx'); }
  // One participant's own data.
  function exportParticipant(p) { var tag = (sidOf(p) || whoOf(p) || p._id).toString().replace(/[^A-Za-z0-9_-]/g, '_'); return exportWorkbook([p], cfg.registrationQuestions, cfg.surveyQuestions, 'portfoliofit-user-' + tag + '-' + stamp() + '.xlsx'); }
  // Every participant who played a given session (one combined file; the session's
  // own registration/survey question order is used for those sheets).
  async function exportSession(code) {
    toast('Loading session data…');
    try {
      var sessSnap = await fb.F.getDoc(fb.F.doc(fb.db, 'sessions', code));
      var sd = sessSnap.exists() ? sessSnap.data() : {};
      var pSnap = await fb.F.getDocs(fb.F.collection(fb.db, 'participants'));
      var parts = []; pSnap.forEach(function (d) { var v = d.data(); if ((v.sessionId || '') === code) parts.push(Object.assign({ _id: d.id }, v)); });
      if (!parts.length) { toast('No participants have played session "' + code + '" yet.'); return; }
      parts.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); });
      return exportWorkbook(parts, sd.registrationQuestions, sd.surveyQuestions, 'portfoliofit-session-' + code + '-' + stamp() + '.xlsx');
    } catch (e) { toast('Session export failed: ' + ((e && e.code) || (e && e.message) || 'error')); }
  }

  /* =====================================================================
     Data analytics view (?admin=data-analytics)
     ---------------------------------------------------------------------
     Mirrors the answerarena admin's Data analytics tab. Three sections:
       1. Data source — tick any active/completed sessions and/or import an
          exported Excel/CSV; Load pulls everything into one in-memory
          sheet map (the SAME multi-tab shape as the Excel export, via
          buildSheetMap), downloadable as a single consolidated workbook.
       2. Aggregate data — headline stats from the Rounds sheet: users
          played, easy/hard puzzles completed, average completion time per
          difficulty (each user weighted equally) and the % of users who
          reached the puzzle maximum, plus a per-puzzle breakdown.
       3. Process with Python or R — edit + run a script against any loaded
          table. Python runs on Pyodide, R on WebR — both compiled entirely
          in the browser (loaded lazily from jsDelivr on first Run); no
          data leaves the page.
     ===================================================================== */
  function renderAnalytics() {
    clearRoot();
    var wrap = el('div', { class: 'pfa-wrap pfa-wrap2' });
    wrap.appendChild(headerRow());
    wrap.appendChild(el('div', { class: 'pfa-card' }, [
      el('h3', { text: 'Data analytics', style: 'margin:0 0 6px;font-size:16px;' }),
      el('p', { class: 'pfa-note', html: 'Load play data from any <b>active or completed session</b> (or import an already-exported Excel), consolidate it into a <b>single Excel file</b>, read the headline aggregates, process the data with <b>Python or R</b> — compiled entirely in your browser (nothing is uploaded) — and read the findings, with every plot explained, in <b>Insights gained</b>. Four steps:' })
    ]));
    daRefs = {};   // this render's sections register their live refreshers here
    wrap.appendChild(buildDaSection1());
    wrap.appendChild(buildDaSection2());
    wrap.appendChild(buildDaSection3());
    wrap.appendChild(buildDaSection4());
    root.appendChild(wrap);
  }

  /* ---- Section 1: data source ---- */
  function buildDaSection1() {
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('div', { class: 'pfa-sechead' }, [el('span', { class: 'pfa-secnum', text: '1' }), el('h3', { text: 'Data source', style: 'margin:0;font-size:16px;' })]));
    card.appendChild(el('p', { class: 'pfa-note', html: 'Tick the sessions to include (active and completed are both listed), and/or <b>import an exported Excel/CSV</b> (a per-session, per-player or all-data export from this admin). Press <b>Load</b> to pull everything into memory, then <b>Download consolidated Excel</b> writes it all as one workbook — tabs ' + SHEET_ORDER.join(' · ') + ', each source stacked within every tab.' }));

    var listWrap = el('div', { class: 'pfa-seclist' }, [el('p', { class: 'pfa-note', text: 'Loading sessions…' })]);
    card.appendChild(listWrap);

    var loadBtn = el('button', { class: 'pfa-btn', on: { click: doLoad } }, ['Load']);
    var dlBtn = el('button', { class: 'pfa-btn green', on: { click: download } }, ['⬇ Download consolidated Excel']);
    if (!daState.sheetMap) dlBtn.setAttribute('disabled', 'true');
    var selAll = el('button', { class: 'pfa-btn sec sm', on: { click: function () { setAll(true); } } }, ['Select all']);
    var clr = el('button', { class: 'pfa-btn sec sm', on: { click: function () { setAll(false); } } }, ['Clear']);
    var refreshB = el('button', { class: 'pfa-btn sec sm', on: { click: loadSessions } }, ['↻ Refresh']);
    var fileIn = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none;' });
    var importB = el('button', { class: 'pfa-btn sec', on: { click: function () { fileIn.click(); } } }, ['Import Excel / CSV']);
    fileIn.addEventListener('change', onImport);

    card.appendChild(el('div', { class: 'pfa-row', style: 'margin-top:10px;' }, [selAll, clr, refreshB, importB]));
    card.appendChild(el('div', { class: 'pfa-row', style: 'margin-top:10px;' }, [loadBtn, dlBtn]));
    var status = el('div', { class: 'pfa-runstatus' });
    card.appendChild(status);
    card.appendChild(fileIn);

    loadSessions();

    function loadSessions() {
      // The cached-admin early render can run before Firebase connects; route()
      // re-renders this section once the connection is up.
      if (!fb) { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'pfa-note', text: 'Connecting…' })); return; }
      // Show the cached list immediately on re-entry (no transient blank); only
      // show the loading placeholder on the very first fetch.
      if (daState.sessions) render();
      else { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'pfa-note', text: 'Loading sessions…' })); }
      var sessP = fb.F.getDocs(fb.F.collection(fb.db, 'sessions')).then(function (snap) {
        var docs = []; snap.forEach(function (d) { docs.push(Object.assign({ _id: d.id }, d.data())); }); return docs;
      });
      var partP = fb.F.getDocs(fb.F.collection(fb.db, 'participants')).then(function (snap) {
        var ps = []; snap.forEach(function (d) { ps.push(Object.assign({ _id: d.id }, d.data())); }); return ps;
      }).catch(function () { return daState.allParts || []; });
      Promise.all([sessP, partP]).then(function (res) {
        daState.sessions = res[0] || [];
        daState.allParts = res[1] || [];
        daState.sessions.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        render();
      }).catch(function (e) {
        if (daState.sessions) { toast('Could not refresh sessions: ' + ((e && e.code) || (e && e.message) || 'error')); return; }
        listWrap.innerHTML = '';
        listWrap.appendChild(el('p', { class: 'pfa-err', text: 'Could not load sessions: ' + ((e && e.code) || (e && e.message) || 'error') }));
      });
    }
    function partCounts() {
      var c = {};
      (daState.allParts || []).forEach(function (p) { var sid = p.sessionId; if (sid) c[sid] = (c[sid] || 0) + 1; });
      return c;
    }
    function setAll(on) {
      (daState.sessions || []).forEach(function (s) { if (on) daState.selected[s._id] = true; else delete daState.selected[s._id]; });
      daState.importedBooks.forEach(function (b) { b.selected = on; });
      render();
    }
    function render() {
      listWrap.innerHTML = '';
      var c = partCounts();
      var sess = daState.sessions || [];
      if (!sess.length && !daState.importedBooks.length) {
        listWrap.appendChild(el('p', { class: 'pfa-note', text: 'No sessions yet. Create one from the Admin view (Sessions tab), or import an Excel/CSV file.' }));
        updateLoadLabel(); return;
      }
      sess.forEach(function (s) {
        var cb = el('input', { type: 'checkbox' }); if (daState.selected[s._id]) cb.setAttribute('checked', 'checked');
        cb.addEventListener('change', function () { if (cb.checked) daState.selected[s._id] = true; else delete daState.selected[s._id]; updateLoadLabel(); });
        var n = c[s._id] || 0;
        var closed = s.status === 'closed';
        var meta = el('div', { class: 'g' }, [
          el('b', { text: s._id }), ' ',
          el('span', { class: 'pfa-badge ' + (closed ? 'closed' : 'open'), text: closed ? 'completed' : 'active' }),
          el('div', { class: 'pfa-note', style: 'margin-top:2px;', text: (s.name || s.label ? (s.name || s.label) + ' · ' : '') + n + ' participant' + (n === 1 ? '' : 's') + ' · created ' + (fmtTs(s.createdAt) || '—') })
        ]);
        listWrap.appendChild(el('label', { class: 'pfa-checkrow' }, [cb, meta]));
      });
      daState.importedBooks.forEach(function (b) {
        var cb = el('input', { type: 'checkbox' }); if (b.selected) cb.setAttribute('checked', 'checked');
        cb.addEventListener('change', function () { b.selected = cb.checked; updateLoadLabel(); });
        var rm = el('button', { class: 'pfa-btn danger sm', on: { click: function (e) { e.preventDefault(); daState.importedBooks = daState.importedBooks.filter(function (x) { return x !== b; }); render(); } } }, ['remove']);
        var meta = el('div', { class: 'g' }, [
          el('b', { text: b.label }), ' ', el('span', { class: 'pfa-tag blue', text: 'imported' }),
          el('div', { class: 'pfa-note', style: 'margin-top:2px;', text: b.sheets.length + ' sheet' + (b.sheets.length === 1 ? '' : 's') + ' · ' + b.totalRows + ' rows' })
        ]);
        listWrap.appendChild(el('label', { class: 'pfa-checkrow' }, [cb, meta, rm]));
      });
      updateLoadLabel();
    }
    function updateLoadLabel() {
      var ns = Object.keys(daState.selected).filter(function (k) { return daState.selected[k]; }).length;
      var nf = daState.importedBooks.filter(function (b) { return b.selected; }).length;
      var bits = []; if (ns) bits.push(ns + ' session' + (ns === 1 ? '' : 's')); if (nf) bits.push(nf + ' file' + (nf === 1 ? '' : 's'));
      loadBtn.textContent = bits.length ? ('Load ' + bits.join(' + ')) : 'Load';
    }
    function onImport() {
      var f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      var isCsv = /\.csv$/i.test(f.name);
      status.textContent = 'Reading ' + f.name + '…';
      ensureXLSX().then(function (X) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var sheets;
            if (isCsv) {
              // A bare CSV becomes one sheet named Rounds (the analysis unit).
              var wbc = X.read(e.target.result, { type: 'string' });
              sheets = [{ name: 'Rounds', rows: X.utils.sheet_to_json(wbc.Sheets[wbc.SheetNames[0]], { defval: '' }) }];
            } else {
              var wb = X.read(new Uint8Array(e.target.result), { type: 'array' });
              sheets = wb.SheetNames.map(function (nm) { return { name: nm, rows: X.utils.sheet_to_json(wb.Sheets[nm], { defval: '' }) }; });
            }
            sheets = sheets.filter(function (sh) { return sh.rows && sh.rows.length; });
            if (!sheets.length) { status.textContent = ''; toast('That file has no data rows.'); return; }
            var totalRows = sheets.reduce(function (t, sh) { return t + sh.rows.length; }, 0);
            daState.importedBooks.push({ label: f.name, sheets: sheets, totalRows: totalRows, selected: true });
            status.textContent = 'Imported ' + f.name + ' — ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') + ', ' + totalRows + ' rows. Press Load to include it.';
            render();
          } catch (err) { status.textContent = ''; toast('Could not read the file: ' + (err.message || err)); }
        };
        if (isCsv) reader.readAsText(f); else reader.readAsArrayBuffer(f);
      }).catch(function () { status.textContent = ''; toast('Could not load the Excel reader (offline?).'); });
    }
    function doLoad() {
      var ids = {}; Object.keys(daState.selected).forEach(function (k) { if (daState.selected[k]) ids[k] = true; });
      var nSess = Object.keys(ids).length;
      var books = daState.importedBooks.filter(function (b) { return b.selected; });
      if (!nSess && !books.length) { toast('Tick at least one session or import a file first.'); return; }
      if (nSess && !fb) { toast('Still connecting — try again in a moment.'); return; }
      status.textContent = 'Loading…';
      loadBtn.setAttribute('disabled', 'true');
      var done = function () { loadBtn.removeAttribute('disabled'); };
      // Participants who played any ticked session (re-fetched so data is current).
      var partsP = nSess
        ? fb.F.getDocs(fb.F.collection(fb.db, 'participants')).then(function (snap) {
            var ps = []; snap.forEach(function (d) { var v = d.data(); if (ids[v.sessionId || '']) ps.push(Object.assign({ _id: d.id }, v)); });
            ps.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); });
            return ps;
          })
        : Promise.resolve(null);
      partsP.then(function (parts) {
        // The aggregate reuses the exact export builder, so it is the same
        // multi-tab shape as any per-session/all-data Excel export.
        return parts ? buildSheetMap(parts, cfg.registrationQuestions, cfg.surveyQuestions) : emptySheetMap();
      }).then(function (sheetMap) {
        books.forEach(function (b) { mergeBookIntoSheetMap(sheetMap, b); });
        daState.sheetMap = sheetMap;
        daState.sheetOrder = orderSheetNames(sheetMap);
        status.textContent = 'Loaded ' + summarizeMap(sheetMap) + '.';
        dlBtn.removeAttribute('disabled');
        done();
        // Refresh whichever Section 2/3 are currently mounted (daRefs is reset on
        // each render), so a Load that resolves after a view switch still lands.
        if (daRefs.updateSec2) daRefs.updateSec2();
        if (daRefs.updateSec3Tables) daRefs.updateSec3Tables();
      }).catch(function (e) {
        done(); status.textContent = '';
        toast('Load failed: ' + ((e && e.message) || 'error'));
        if (window.console) console.error('[PFA analytics] load failed', e);
      });
    }
    function download() {
      var m = daState.sheetMap;
      if (!m) { toast('Load data first.'); return; }
      ensureXLSX().then(function (X) {
        var wb = X.utils.book_new(), used = {};
        daState.sheetOrder.forEach(function (name) {
          var rows = m[name] || [];
          var ws = X.utils.json_to_sheet(rows.length ? rows : [{}]); autoWidth(ws, X);
          X.utils.book_append_sheet(wb, ws, safeSheetName(name, used));
        });
        X.writeFile(wb, 'portfoliofit-consolidated-' + stamp() + '.xlsx');
        toast('Consolidated Excel downloaded.');
      }).catch(function (e) { toast('Download failed: ' + ((e && e.message) || 'error')); });
    }
    return card;
  }

  /* ---- Section 2: aggregate data ---- */
  function buildDaSection2() {
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('div', { class: 'pfa-sechead' }, [el('span', { class: 'pfa-secnum', text: '2' }), el('h3', { text: 'Aggregate data', style: 'margin:0;font-size:16px;' })]));
    card.appendChild(el('p', { class: 'pfa-note', html: 'Headline numbers from the loaded <b>Rounds</b> data (one row per completed puzzle): how many users played, how many easy/hard puzzles were completed, the <b>average time to complete</b> one (each user weighted equally — their own average is taken first), the <b>% of users who reached the maximum</b> (final Net Value ≥ the puzzle\'s Best Value) at least once, plus the % who got <b>within 5%</b> and <b>within 10%</b> of that maximum Net Value at least once (cumulative — a user at the maximum also counts as within 5% and 10%).' }));
    var stats = el('div', { class: 'pfa-statgrid', style: 'margin-top:6px;' });
    card.appendChild(stats);
    var hint = el('p', { class: 'pfa-note', text: 'Load data in Section 1 first.' });
    card.appendChild(hint);
    var tblWrap = el('div', {});
    card.appendChild(tblWrap);
    daRefs.updateSec2 = update;
    update();
    function statBox(v, l) { return el('div', { class: 'pfa-statbox' }, [el('b', { text: String(v) }), el('span', { text: l })]); }
    function update() {
      stats.innerHTML = ''; tblWrap.innerHTML = '';
      var agg = daAggStats(daState.sheetMap);
      if (!agg) {
        hint.style.display = 'block';
        hint.textContent = daState.sheetMap ? 'The loaded data has no usable Rounds rows (needs Difficulty + Player columns) — tick a session with plays, or import an export that includes the Rounds sheet.' : 'Load data in Section 1 first.';
        return;
      }
      hint.style.display = 'none';
      stats.appendChild(statBox(agg.usersPlayed, 'Users played'));
      stats.appendChild(statBox(agg.played.easy, 'Easy puzzles played'));
      stats.appendChild(statBox(agg.played.hard, 'Hard puzzles played'));
      stats.appendChild(statBox(agg.easy.avgTime != null ? fmtDur(agg.easy.avgTime) : '—', 'Avg time · easy'));
      stats.appendChild(statBox(agg.hard.avgTime != null ? fmtDur(agg.hard.avgTime) : '—', 'Avg time · hard'));
      stats.appendChild(statBox(agg.easy.pctMax != null ? agg.easy.pctMax + '%' : '—', 'Reached max · easy (users)'));
      stats.appendChild(statBox(agg.hard.pctMax != null ? agg.hard.pctMax + '%' : '—', 'Reached max · hard (users)'));
      stats.appendChild(statBox(agg.easy.pct5 != null ? agg.easy.pct5 + '%' : '—', 'Within 5% of max · easy (users)'));
      stats.appendChild(statBox(agg.hard.pct5 != null ? agg.hard.pct5 + '%' : '—', 'Within 5% of max · hard (users)'));
      stats.appendChild(statBox(agg.easy.pct10 != null ? agg.easy.pct10 + '%' : '—', 'Within 10% of max · easy (users)'));
      stats.appendChild(statBox(agg.hard.pct10 != null ? agg.hard.pct10 + '%' : '—', 'Within 10% of max · hard (users)'));
      if (agg.puzzles.length) {
        tblWrap.appendChild(el('p', { class: 'pfa-note', style: 'margin-top:12px;', html: '<b>By puzzle</b> — plays, average completion time and the share of plays that reached the maximum, or got within 5% / 10% of it:' }));
        var t = el('table', { class: 'pfa-tbl' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Puzzle', 'Difficulty', 'Plays', 'Avg time', 'Plays at max', 'Within 5%', 'Within 10%'].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody', {});
        function shareCell(k, known) { return known ? Math.round(k / known * 100) + '% (' + k + '/' + known + ')' : '—'; }
        agg.puzzles.forEach(function (pz) {
          tb.appendChild(el('tr', {}, [
            el('td', { text: pz.id }),
            el('td', { text: pz.diff }),
            el('td', { text: String(pz.n) }),
            el('td', { text: pz.timeN ? fmtDur(pz.timeSum / pz.timeN) : '—' }),
            el('td', { text: shareCell(pz.maxN, pz.knownN) }),
            el('td', { text: shareCell(pz.near5N, pz.knownN) }),
            el('td', { text: shareCell(pz.near10N, pz.knownN) })
          ]));
        });
        t.appendChild(tb);
        tblWrap.appendChild(el('div', { class: 'pfa-scrolltbl' }, [t]));
      }
    }
    return card;
  }

  // Compute the Section-2 aggregates from the loaded sheet map's Rounds rows.
  // Column lookup is tolerant (case/spacing-insensitive) so an imported export
  // — or a hand-made sheet with the same column meanings — also works.
  // "Reached the maximum" = Net Value >= Best Value; "within 5% / 10%" =
  // Net Value >= 95% / 90% of Best Value (Best Value is always positive) —
  // cumulative, so a round at the maximum also counts as within 5% and 10%.
  // Rows missing Net or Best Value are "unknown" and excluded from the rates.
  // (The Fitness % column is a geometric COMPACTNESS score, NOT net/best — it
  // must never be used as a fallback for any of these.)
  function daAggStats(map) {
    var rounds = (map && map.Rounds) || [];
    if (!rounds.length) return null;
    var kPlayer = daPickKey(rounds, ['Player', 'account_id', 'participant', 'user']);
    var kSess = daPickKey(rounds, ['Session', 'session_id']);
    var kDiff = daPickKey(rounds, ['Difficulty', 'diff']);
    var kTime = daPickKey(rounds, ['Time (s)', 'time_s', 'time', 'duration (s)']);
    var kNet = daPickKey(rounds, ['Net Value', 'net']);
    var kBest = daPickKey(rounds, ['Best Value', 'bestValue']);
    var kPuz = daPickKey(rounds, ['Puzzle ID', 'puzzleId', 'Puzzle']);
    if (!kDiff || !kPlayer) return null;
    var users = {}, puzzles = {}, played = { easy: 0, hard: 0 };
    rounds.forEach(function (r) {
      var d0 = String(r[kDiff] == null ? '' : r[kDiff]).trim().toLowerCase().charAt(0);
      var d = d0 === 'e' ? 'easy' : (d0 === 'h' ? 'hard' : null);
      if (!d) return;
      played[d]++;
      // One user = one Player within one Session (labels are unique per
      // participant, but pairing with the session keeps stacked imports apart).
      var ukey = String(r[kPlayer]) + '|' + String(kSess ? (r[kSess] || '') : '');
      var u = users[ukey] || (users[ukey] = {});
      var a = u[d] || (u[d] = { n: 0, timeSum: 0, timeN: 0, max: false, near5: false, near10: false, known: false });
      a.n++;
      var t = daNum(kTime ? r[kTime] : null);
      if (t != null) { a.timeSum += t; a.timeN++; }
      var atMax = null, near5 = null, near10 = null;
      var net = daNum(kNet ? r[kNet] : null), best = daNum(kBest ? r[kBest] : null);
      if (net != null && best != null) { atMax = net >= best; near5 = net >= 0.95 * best; near10 = net >= 0.90 * best; }
      if (atMax != null) { a.known = true; if (atMax) a.max = true; if (near5) a.near5 = true; if (near10) a.near10 = true; }
      var pid = String(kPuz ? (r[kPuz] == null ? '' : r[kPuz]) : '') || '(unknown)';
      var pz = puzzles[pid + '|' + d] || (puzzles[pid + '|' + d] = { id: pid, diff: d, n: 0, timeSum: 0, timeN: 0, maxN: 0, near5N: 0, near10N: 0, knownN: 0 });
      pz.n++;
      if (t != null) { pz.timeSum += t; pz.timeN++; }
      if (atMax != null) { pz.knownN++; if (atMax) pz.maxN++; if (near5) pz.near5N++; if (near10) pz.near10N++; }
    });
    var ukeys = Object.keys(users);
    if (!ukeys.length) return null;
    function diffStats(d) {
      var timeMeans = [], maxUsers = 0, near5Users = 0, near10Users = 0, knownUsers = 0, n = 0;
      ukeys.forEach(function (k) {
        var a = users[k][d]; if (!a) return;
        n++;
        if (a.timeN) timeMeans.push(a.timeSum / a.timeN);
        if (a.known) { knownUsers++; if (a.max) maxUsers++; if (a.near5) near5Users++; if (a.near10) near10Users++; }
      });
      var avgTime = timeMeans.length ? timeMeans.reduce(function (s, x) { return s + x; }, 0) / timeMeans.length : null;
      function pct(k) { return knownUsers ? Math.round(k / knownUsers * 1000) / 10 : null; }
      return { users: n, avgTime: avgTime, maxUsers: maxUsers, near5Users: near5Users, near10Users: near10Users, knownUsers: knownUsers, pctMax: pct(maxUsers), pct5: pct(near5Users), pct10: pct(near10Users) };
    }
    var puzzleRows = Object.keys(puzzles).map(function (k) { return puzzles[k]; });
    puzzleRows.sort(function (a, b) { return (a.diff === b.diff ? 0 : (a.diff === 'easy' ? -1 : 1)) || (b.n - a.n); });
    return { usersPlayed: ukeys.length, played: played, easy: diffStats('easy'), hard: diffStats('hard'), puzzles: puzzleRows };
  }
  function daNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9%]/g, ''); }
  // Coerce a cell to a finite number ('' / '—' / text → null).
  function daNum(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  // Find the real header matching any candidate name, scanning the union of
  // keys over the first rows (stacked imports may not all share row 1's keys).
  function daPickKey(rows, cands) {
    var seen = {}, norm = {};
    for (var i = 0; i < rows.length && i < 500; i++) {
      var ks = Object.keys(rows[i] || {});
      for (var j = 0; j < ks.length; j++) { if (!seen[ks[j]]) { seen[ks[j]] = 1; var nk = daNorm(ks[j]); if (norm[nk] === undefined) norm[nk] = ks[j]; } }
    }
    for (var c = 0; c < cands.length; c++) { var hit = norm[daNorm(cands[c])]; if (hit !== undefined) return hit; }
    return null;
  }
  // "84s" / "2m 05s" for an average number of seconds.
  function fmtDur(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    if (sec < 60) return Math.round(sec) + 's';
    var m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
    if (s === 60) { m++; s = 0; }
    return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  }
  function emptySheetMap() { var m = {}; SHEET_ORDER.forEach(function (n) { m[n] = []; }); return m; }
  // Stack every sheet of an imported workbook onto the aggregate map: matched onto
  // an existing tab by (case-insensitive) name, else added as its own tab.
  function mergeBookIntoSheetMap(map, book) {
    (book.sheets || []).forEach(function (sh) {
      var key = Object.keys(map).filter(function (k) { return k.toLowerCase() === String(sh.name).toLowerCase(); })[0];
      if (!key) { key = String(sh.name); if (!map[key]) map[key] = []; }
      map[key] = (map[key] || []).concat(sh.rows || []);
    });
  }
  // Tab order for the aggregate: the standard sheets first, then any extra
  // (imported) sheets in insertion order.
  function orderSheetNames(map) {
    var order = SHEET_ORDER.filter(function (n) { return map[n] !== undefined; });
    Object.keys(map).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    return order;
  }
  function summarizeMap(m) {
    var np = (m.Participants || []).length, nr = (m.Rounds || []).length, nm = (m['Play log'] || []).length;
    return np + ' participant' + (np === 1 ? '' : 's') + ', ' + nr + ' completed puzzle' + (nr === 1 ? '' : 's') + ', ' + nm + ' logged move' + (nm === 1 ? '' : 's');
  }
  // A valid, unique Excel sheet name (<=31 chars, no : \ / ? * [ ], no dupes).
  function safeSheetName(name, used) {
    var n = String(name).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
    var base = n, i = 2;
    while (used[n.toLowerCase()]) { var suf = ' (' + i + ')'; n = base.slice(0, 31 - suf.length) + suf; i++; }
    used[n.toLowerCase()] = true; return n;
  }

  /* ---- Section 3: run Python / R ---- */
  function buildDaSection3() {
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('div', { class: 'pfa-sechead' }, [el('span', { class: 'pfa-secnum', text: '3' }), el('h3', { text: 'Process with Python or R', style: 'margin:0;font-size:16px;' })]));
    card.appendChild(el('p', { class: 'pfa-note', html: 'Run <b>Python</b> (Pyodide: numpy / pandas / scipy / matplotlib) or <b>R</b> (WebR, base R) on the loaded data — compiled entirely in your browser (the first run downloads the runtime, ~10–30&nbsp;s). Your code always receives the table picked below as <code>DATA_CSV</code> (Python) / <code>/tmp/data.csv</code> (R), plus the <b>Play log</b> and <b>Rounds</b> sheets as <code>PLAYLOG_CSV</code> / <code>ROUNDS_CSV</code> (Python) and <code>/tmp/playlog.csv</code> / <code>/tmp/rounds.csv</code> (R). Any valid Python or R works. The bundled templates (identical results in both languages) analyse <b>how the players who reached the maximum played differently</b> (their heuristics, easy vs hard — under both the strict and the within-5% top definitions), test the <b>balanced-KPI hypothesis</b> — that top players stay close to the optimum across <i>all</i> KPIs, not just net value — and run a <b>revealed-objective test</b> of net-focused vs diversified play. Text output appears below; the <b>plots are shown in “Insights gained”</b> (§4), each beside its explanation.' }));

    var tableSel = el('select', {});
    card.appendChild(el('div', { class: 'pfa-field' }, [el('label', { text: 'Analysis table (from the loaded data)' }), tableSel]));

    var pyTabBtn = el('button', { on: { click: function () { setLang('python'); } } }, ['Python']);
    var rTabBtn = el('button', { on: { click: function () { setLang('r'); } } }, ['R']);
    card.appendChild(el('div', { class: 'pfa-langtabs' }, [pyTabBtn, rTabBtn]));

    var editor = el('textarea', { class: 'pfa-code', spellcheck: 'false' });
    card.appendChild(editor);

    var runBtn = el('button', { class: 'pfa-btn', on: { click: run } }, ['▶ Run']);
    var resetBtn = el('button', { class: 'pfa-btn sec', on: { click: resetTemplate } }, ['Reset template']);
    card.appendChild(el('div', { class: 'pfa-row', style: 'margin-top:10px;' }, [runBtn, resetBtn]));
    var statusEl = el('div', { class: 'pfa-runstatus' });
    card.appendChild(statusEl);
    card.appendChild(el('p', { class: 'pfa-note', style: 'margin:12px 0 4px;', html: '<b>Output</b>' }));
    var outWrap = el('div', {}, [el('p', { class: 'pfa-note', text: 'Run your code to see the output here.' })]);
    card.appendChild(outWrap);
    var plots = el('div', { class: 'pfa-plots' });
    card.appendChild(plots);

    var running = false, outText = '', flushQueued = false, outPre = null;

    // Restore persisted code (or the bundled templates) once. Refresh first so a
    // stale saved script from an older template version cannot shadow a fix.
    daMigrateTemplates();
    if (daState.code.python == null) daState.code.python = daLoadSaved('pfa-da:py', DA_PY_TEMPLATE);
    if (daState.code.r == null) daState.code.r = daLoadSaved('pfa-da:r', DA_R_TEMPLATE);
    editor.value = daState.code[daState.lang];
    editor.addEventListener('input', function () { daState.code[daState.lang] = editor.value; saveCode(); });

    setLang(daState.lang);
    daRefs.updateSec3Tables = updateTables;
    updateTables();
    // If a run started under an earlier render is still going, say so (the run()
    // guard below blocks a concurrent second run until it finishes).
    if (daState.running) setStatus('A run started earlier is still in progress — please wait for it to finish.');

    function setLang(lang) {
      if (running) return;
      daState.lang = lang;
      pyTabBtn.className = lang === 'python' ? 'on' : '';
      rTabBtn.className = lang === 'r' ? 'on' : '';
      editor.value = daState.code[lang];
      runBtn.textContent = lang === 'python' ? '▶ Run Python' : '▶ Run R';
    }
    function updateTables() {
      var m = daState.sheetMap;
      var prev = tableSel.value;
      tableSel.innerHTML = '';
      var names = m ? daState.sheetOrder.filter(function (n) { return (m[n] || []).length; }) : [];
      if (!names.length) { tableSel.appendChild(el('option', { value: '' }, ['(load data in Section 1 first)'])); tableSel.setAttribute('disabled', 'true'); return; }
      tableSel.removeAttribute('disabled');
      names.forEach(function (n) { tableSel.appendChild(el('option', { value: n }, [n + ' (' + (m[n] || []).length + ' rows)'])); });
      if (names.indexOf(prev) >= 0) tableSel.value = prev;
      else if (names.indexOf('Play log') >= 0) tableSel.value = 'Play log';
      else if (names.indexOf('Rounds') >= 0) tableSel.value = 'Rounds';
      else tableSel.value = names[0];
    }
    function resetTemplate() {
      if (running) return;
      var tpl = daState.lang === 'python' ? DA_PY_TEMPLATE : DA_R_TEMPLATE;
      daState.code[daState.lang] = tpl; editor.value = tpl; saveCode();
    }
    function saveCode() { try { localStorage.setItem(daState.lang === 'python' ? 'pfa-da:py' : 'pfa-da:r', daState.code[daState.lang]); } catch (e) {} }
    function pushLine(line) {
      outText += line + '\n';
      if (!flushQueued) { flushQueued = true; requestAnimationFrame(function () { flushQueued = false; if (outPre) outPre.textContent = outText; }); }
    }
    function setStatus(s) { statusEl.textContent = s || ''; }
    function run() {
      if (running) return;
      // Cross-render guard: a run started under an earlier render (before the user
      // switched views and back) shares the one Pyodide/WebR runtime, so never
      // start a second concurrent run against it.
      if (daState.running) { toast('A run is already in progress — please wait for it to finish.'); return; }
      var m = daState.sheetMap;
      if (!m) { toast('Load data in Section 1 first.'); return; }
      var name = tableSel.value;
      var rows = name && m[name] ? m[name] : [];
      if (!rows.length) { toast('The selected table is empty — pick another or load data.'); return; }
      running = true; daState.running = true; runBtn.setAttribute('disabled', 'true'); resetBtn.setAttribute('disabled', 'true');
      outText = ''; plots.innerHTML = ''; outWrap.innerHTML = '';
      outPre = el('pre', { class: 'pfa-out', text: '' }); outWrap.appendChild(outPre);
      setStatus('Preparing…');
      var lang = daState.lang, code = editor.value;
      daState.code[lang] = code; saveCode();
      ensureXLSX().then(function (X) {
        // The selected table rides along as DATA_CSV; the Play log and Rounds
        // sheets are ALWAYS handed over too (the bundled templates need both).
        var toCsv = function (rws) { return (rws && rws.length) ? X.utils.sheet_to_csv(X.utils.json_to_sheet(rws)) : ''; };
        var csvs = { dataCsv: toCsv(rows), playlogCsv: toCsv(m['Play log'] || []), roundsCsv: toCsv(m['Rounds'] || []) };
        return lang === 'python'
          ? daRunPython(code, Object.assign({ onStdout: pushLine, onStatus: setStatus }, csvs))
          : daRunR(code, Object.assign({ onOutput: pushLine, onStatus: setStatus }, csvs));
      }).then(function (result) {
        var finalOut = outText || (result && (result.stdout || result.output)) || '';
        var imgs = (result && result.images) || [];
        if (result && !result.ok && result.error) finalOut = (finalOut ? finalOut + '\n' : '') + '⚠ ' + result.error;
        if (outPre) outPre.textContent = finalOut || '(no output)';
        // Plots live in the Insights section (each beside its explanation), so
        // here we only point there rather than duplicating the figures.
        if (imgs.length) {
          plots.appendChild(el('p', { class: 'pfa-note', html: '📊 <b>' + imgs.length + ' figure' + (imgs.length === 1 ? '' : 's') + '</b> rendered — see the <b>“Insights gained”</b> section below, where each plot is shown with an explanation of how to read it.' }));
        }
        setStatus(imgs.length ? (imgs.length + ' figure' + (imgs.length === 1 ? '' : 's') + ' rendered — shown in “Insights gained” below.') : (result && result.ok ? 'Done.' : ''));
        // Snapshot the run so the Insights section can render its INSIGHTS block + plots.
        daState.lastRun = { output: finalOut, images: imgs, lang: lang, ok: !!(result && result.ok) };
        if (daRefs.updateInsights) daRefs.updateInsights();
      }).catch(function (err) {
        if (outPre) outPre.textContent = (outText ? outText + '\n' : '') + '⚠ ' + ((err && err.message) || err);
        setStatus('');
      }).then(function () {
        running = false; daState.running = false; runBtn.removeAttribute('disabled'); resetBtn.removeAttribute('disabled');
      });
    }
    return card;
  }

  /* ---- Section 4: insights gained ---- */
  function buildDaSection4() {
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('div', { class: 'pfa-sechead' }, [el('span', { class: 'pfa-secnum', text: '4' }), el('h3', { text: 'Insights gained', style: 'margin:0;font-size:16px;' })]));
    card.appendChild(el('p', { class: 'pfa-note', html: 'A readable write-up of what the Section-3 analysis found — the <b>heuristics</b> of the players who reached the maximum, the easy-vs-hard comparison, the <b>balanced-KPI hypothesis</b>, and a closing <b>data-driven verdict</b>: are the best players focused on one KPI, or balancing across the KPIs, compared to the rest? <b>Every plot is shown here</b>, each dropped in right under the paragraph that explains how to read it. It all comes from the <code>INSIGHTS</code> block the script prints, so editing the script changes it.' }));
    var body = el('div', {});
    card.appendChild(body);
    daRefs.updateInsights = render;
    render();
    function render() {
      body.innerHTML = '';
      var run = daState.lastRun;
      if (!run) { body.appendChild(el('p', { class: 'pfa-note', text: 'Run the analysis in Section 3 first — the insights and plots appear here.' })); return; }
      var text = daParseInsights(run.output);
      var images = (run.images || []).slice();
      var placed = [];               // image indices already dropped under a "Figure N" heading
      if (text) {
        var ul = null;
        text.split('\n').forEach(function (raw) {
          var t = raw.replace(/\s+$/, '');
          if (/^\s*##\s+/.test(t)) {
            ul = null;
            var head = t.replace(/^\s*##\s+/, '');
            body.appendChild(el('h4', { class: 'pfa-insh', text: head }));
            // A "Figure N …" heading pulls its plot in right here, so each figure
            // sits with the paragraph that explains how to read it.
            var fm = head.match(/^Figure\s+(\d+)\b/i);
            if (fm) {
              var idx = parseInt(fm[1], 10) - 1;
              if (idx >= 0 && idx < images.length && placed.indexOf(idx) < 0) {
                body.appendChild(el('img', { src: images[idx], class: 'pfa-insimg', alt: head }));
                placed.push(idx);
              }
            }
          }
          else if (/^\s*[-•*]\s+/.test(t)) { if (!ul) { ul = el('ul', { class: 'pfa-insul' }); body.appendChild(ul); } ul.appendChild(el('li', { html: daInlineBold(t.replace(/^\s*[-•*]\s+/, '')) })); }
          else if (t.trim() === '') { ul = null; }
          else { ul = null; body.appendChild(el('p', { class: 'pfa-insp', html: daInlineBold(t) })); }
        });
      } else {
        body.appendChild(el('p', { class: 'pfa-note', text: run.ok
          ? 'The last run printed no INSIGHTS block. Add one to your script (a line "INSIGHTS" followed by the write-up), or read the full console output in Section 3.'
          : 'The last run did not finish — see the error in Section 3.' }));
      }
      // Any plots not matched to a "Figure N" heading (e.g. a user's custom script)
      // are shown at the end so nothing is ever silently dropped.
      var leftover = images.filter(function (_, i) { return placed.indexOf(i) < 0; });
      if (leftover.length) {
        body.appendChild(el('p', { class: 'pfa-note', style: 'margin:14px 0 4px;', html: '<b>' + (placed.length ? 'More figures' : 'Figures') + '</b>' }));
        leftover.forEach(function (src) { body.appendChild(el('img', { src: src, class: 'pfa-insimg', alt: 'figure' })); });
      }
    }
    return card;
  }
  // Pull the plain-language INSIGHTS block out of a run's console output: the
  // scripts print a line "INSIGHTS" (optionally banner-wrapped) then the write-up
  // to the end, so we return everything after that marker, trimmed of banner/Done.
  function daParseInsights(output) {
    if (!output) return '';
    var lines = String(output).split('\n');
    var start = -1;
    for (var i = 0; i < lines.length; i++) { if (/^\s*#*\s*INSIGHTS\s*$/i.test(lines[i])) { start = i; break; } }
    if (start < 0) return '';
    var body = lines.slice(start + 1);
    while (body.length && /^[=\-\s]*$/.test(body[0])) body.shift();
    while (body.length && (/^[=\-\s]*$/.test(body[body.length - 1]) || /^\s*Done\b.*$/i.test(body[body.length - 1]))) body.pop();
    return body.join('\n');
  }
  // Render **bold** spans (after HTML-escaping) inside an insight line.
  function daInlineBold(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }

  function daLoadSaved(key, dflt) { try { var v = localStorage.getItem(key); return v != null ? v : dflt; } catch (e) { return dflt; } }
  // Bump PF_DA_TPL_VERSION whenever the bundled Python/R templates change. A
  // saved script from a previous version lives in localStorage and would
  // otherwise SHADOW the current template (daLoadSaved returns the saved copy).
  // On a version change we drop the saved code so the fresh template loads.
  var PF_DA_TPL_VERSION = '2026-07-08-objective-decile-views';
  function daMigrateTemplates() {
    try {
      if (localStorage.getItem('pfa-da:ver') === PF_DA_TPL_VERSION) return;
      localStorage.removeItem('pfa-da:py');
      localStorage.removeItem('pfa-da:r');
      localStorage.setItem('pfa-da:ver', PF_DA_TPL_VERSION);
    } catch (e) { /* ignore */ }
  }

  /* =====================================================================
     In-browser runtimes: Pyodide (Python) + WebR (R).
     Ported from the answerarena admin. Each loads lazily from jsDelivr on
     first Run and is then reused across runs.
     ===================================================================== */
  var DA_PYODIDE_VERSIONS = ['314.0.1', '0.29.4', '0.28.3'];
  // Only the packages the bundled template needs. A package that fails to load
  // is skipped (non-fatal) so one unavailable package never blocks Python.
  var DA_PY_PACKAGES = ['numpy', 'pandas', 'scipy', 'matplotlib'];
  var _pyodidePromise = null;
  function daPyScriptUrl(v) { return 'https://cdn.jsdelivr.net/pyodide/v' + v + '/full/pyodide.js'; }
  function daPyBaseUrl(v) { return 'https://cdn.jsdelivr.net/pyodide/v' + v + '/full/'; }
  function daInjectScript(url) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-pyodide-src="' + url + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1' && typeof globalThis.loadPyodide === 'function') return resolve();
        if (existing.dataset.loaded === '1') { existing.remove(); }
        else { existing.addEventListener('load', function () { resolve(); }); existing.addEventListener('error', function () { reject(new Error('Failed to load ' + url)); }); return; }
      }
      var s = document.createElement('script');
      s.src = url; s.async = true; s.crossOrigin = 'anonymous'; s.dataset.pyodideSrc = url;
      s.onload = function () { s.dataset.loaded = '1'; resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + url + ' (CDN / network / CSP?)')); };
      document.head.appendChild(s);
    });
  }
  function daGetPyodide(onStatus) {
    if (_pyodidePromise) return _pyodidePromise;
    _pyodidePromise = (async function () {
      var lastErr = null;
      for (var i = 0; i < DA_PYODIDE_VERSIONS.length; i++) {
        var v = DA_PYODIDE_VERSIONS[i];
        try {
          if (onStatus) onStatus('Loading Python runtime (Pyodide v' + v + ')…');
          await daInjectScript(daPyScriptUrl(v));
          var pyodide = await globalThis.loadPyodide({ indexURL: daPyBaseUrl(v) });
          if (onStatus) onStatus('Loading data-science packages (numpy, pandas, scipy, matplotlib)…');
          await daEnsurePyPackages(pyodide);
          if (onStatus) onStatus('');
          return pyodide;
        } catch (err) {
          lastErr = err;
          try { delete globalThis.loadPyodide; } catch (e) { /* non-configurable */ }
          var stale = document.querySelector('script[data-pyodide-src="' + daPyScriptUrl(v) + '"]');
          if (stale) stale.remove();
        }
      }
      throw lastErr || new Error('Pyodide failed to load from all candidate versions.');
    })();
    _pyodidePromise.catch(function () { _pyodidePromise = null; });
    return _pyodidePromise;
  }
  async function daEnsurePyPackages(pyodide) {
    try { await pyodide.loadPackage(DA_PY_PACKAGES); return; } catch (e) { /* isolate below */ }
    var fallback = [];
    for (var i = 0; i < DA_PY_PACKAGES.length; i++) {
      try { await pyodide.loadPackage(DA_PY_PACKAGES[i]); } catch (e) { fallback.push(DA_PY_PACKAGES[i]); }
    }
    if (fallback.length) {
      // Best effort via micropip; a package that still can't be installed is
      // SKIPPED (non-fatal) so one unavailable package never blocks Python.
      try {
        await pyodide.loadPackage('micropip');
        var micropip = pyodide.pyimport('micropip');
        for (var j = 0; j < fallback.length; j++) {
          try { await micropip.install(fallback[j]); } catch (e2) { if (window.console) console.warn('[PFA analytics] could not install ' + fallback[j], e2); }
        }
      } catch (e3) { if (window.console) console.warn('[PFA analytics] micropip unavailable', e3); }
    }
  }
  var DA_MPL_BACKEND = '\nimport os as __os\n__os.environ.setdefault("MPLBACKEND", "Agg")\ntry:\n    import matplotlib\n    matplotlib.use("Agg", force=True)\nexcept Exception:\n    pass\n';
  var DA_FIG_HARVEST = '\ndef __collect_figures():\n    import io, base64\n    try:\n        import matplotlib\n        import matplotlib.pyplot as plt\n    except Exception:\n        return []\n    out = []\n    for num in plt.get_fignums():\n        fig = plt.figure(num)\n        buf = io.BytesIO()\n        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")\n        buf.seek(0)\n        out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))\n        buf.close()\n    plt.close("all")\n    return out\n\n__pyo_images = __collect_figures()\n';
  async function daRunPython(code, opts) {
    opts = opts || {};
    var pyodide = await daGetPyodide(opts.onStatus);
    var collected = [];
    var emit = function (chunk) {
      var text = String(chunk); collected.push(text);
      if (typeof opts.onStdout === 'function') { var parts = text.split('\n'); for (var i = 0; i < parts.length; i++) opts.onStdout(parts[i]); }
    };
    pyodide.setStdout({ batched: emit });
    pyodide.setStderr({ batched: emit });
    pyodide.globals.set('DATA_CSV', opts.dataCsv || '');           // the table picked in Section 3
    pyodide.globals.set('PLAYLOG_CSV', opts.playlogCsv || '');     // the Play log sheet (always provided)
    pyodide.globals.set('ROUNDS_CSV', opts.roundsCsv || '');       // the Rounds sheet (always provided)
    var ok = true, error = null, images = [];
    try {
      await pyodide.runPythonAsync(DA_MPL_BACKEND + '\n' + code + '\n' + DA_FIG_HARVEST);
      var pyImages = pyodide.globals.get('__pyo_images');
      if (pyImages) { try { images = pyImages.toJs(); } finally { pyImages.destroy(); } }
    } catch (e) {
      ok = false; error = e && e.message ? e.message : String(e); emit(error);
    } finally {
      pyodide.setStdout(); pyodide.setStderr();
      try { pyodide.runPython("for __n in ('DATA_CSV','PLAYLOG_CSV','ROUNDS_CSV','__pyo_images'):\n    globals().pop(__n, None)\n"); } catch (e) { /* ignore */ }
    }
    return { ok: ok, stdout: collected.join('\n'), images: images, error: error };
  }

  var DA_WEBR_VERSIONS = ['0.6.0', '0.5.9', '0.4.4'];
  var _webRPromise = null;
  function daWebrEsmUrl(v) { return 'https://cdn.jsdelivr.net/npm/webr@' + v + '/dist/webr.mjs'; }
  function daWebrBaseUrl(v) { return 'https://cdn.jsdelivr.net/npm/webr@' + v + '/dist/'; }
  function daGetWebR(onStatus) {
    if (_webRPromise) return _webRPromise;
    _webRPromise = (async function () {
      var lastErr = null;
      for (var i = 0; i < DA_WEBR_VERSIONS.length; i++) {
        var v = DA_WEBR_VERSIONS[i], webR;
        try {
          if (onStatus) onStatus('Loading R runtime (WebR v' + v + ')… this is a large one-time download.');
          var mod = await import(daWebrEsmUrl(v));
          var WebR = mod.WebR || (mod.default && mod.default.WebR);
          if (!WebR) throw new Error('WebR export not found in module');
          webR = new WebR({ baseUrl: daWebrBaseUrl(v) });
          await webR.init();
          if (onStatus) onStatus('');
          return webR;
        } catch (err) {
          lastErr = err;
          if (webR && typeof webR.close === 'function') { try { webR.close(); } catch (e) { /* ignore */ } }
        }
      }
      throw lastErr || new Error('WebR failed to load from all candidate versions.');
    })();
    _webRPromise.catch(function () { _webRPromise = null; });
    return _webRPromise;
  }
  async function daBitmapToPng(bitmap) {
    var w = bitmap.width, h = bitmap.height;
    if (typeof OffscreenCanvas !== 'undefined') {
      var off = new OffscreenCanvas(w, h);
      off.getContext('2d').drawImage(bitmap, 0, 0);
      var blob = await off.convertToBlob({ type: 'image/png' });
      return await new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
    }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/png');
  }
  async function daRunR(code, opts) {
    opts = opts || {};
    var csvPath = '/tmp/data.csv';
    var lines = [], buffer = '';
    var push = function (text) {
      if (text == null) return; buffer += text; var idx;
      while ((idx = buffer.indexOf('\n')) !== -1) { var line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1); lines.push(line); if (typeof opts.onOutput === 'function') opts.onOutput(line); }
    };
    var flush = function () { if (buffer.length) { lines.push(buffer); if (typeof opts.onOutput === 'function') opts.onOutput(buffer); buffer = ''; } };
    var webR, shelter, images = [];
    try {
      webR = await daGetWebR(opts.onStatus);
      try { await webR.FS.mkdir('/tmp'); } catch (e) { /* exists */ }
      // /tmp/data.csv = the table picked in Section 3; the Play log and Rounds
      // sheets are always written too (empty file when absent, so a previous
      // run's data can never leak into this one).
      await webR.FS.writeFile(csvPath, new TextEncoder().encode(opts.dataCsv || ''));
      await webR.FS.writeFile('/tmp/playlog.csv', new TextEncoder().encode(opts.playlogCsv || ''));
      await webR.FS.writeFile('/tmp/rounds.csv', new TextEncoder().encode(opts.roundsCsv || ''));
      shelter = await new webR.Shelter();
      var capture = await shelter.captureR(code, { withAutoprint: true, captureGraphics: true });
      var out = capture.output || [];
      for (var i = 0; i < out.length; i++) { var evt = out[i]; if (evt && (evt.type === 'stdout' || evt.type === 'stderr')) push(evt.data + '\n'); }
      flush();
      if (Array.isArray(capture.images)) {
        for (var k = 0; k < capture.images.length; k++) { var bmp = capture.images[k]; images.push(await daBitmapToPng(bmp)); if (bmp && typeof bmp.close === 'function') bmp.close(); }
      }
      return { ok: true, output: lines.join('\n'), images: images, error: null };
    } catch (err) {
      flush();
      return { ok: false, output: lines.join('\n'), images: images, error: err && err.message ? err.message : String(err) };
    } finally {
      if (shelter) { try { await shelter.purge(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- default Python / R templates (edit-and-Run) ---- */
  var DA_PY_TEMPLATE = [
    '"""',
    '================================================================================',
    'PORTFOLIOFIT - WHAT DO TOP PLAYERS DO DIFFERENTLY, AND DO THEY BALANCE ALL KPIs?',
    '================================================================================',
    'Game. Each puzzle asks the player to pack project bricks into a fixed 4x4 frame',
    '(16 cells) to maximise Net Value = value of placed bricks - $1 per empty cell,',
    'against the clock. Every puzzle has ONE optimal portfolio worth \'Best Value\'',
    '(a full cover, so at the optimum Total Value = Best Value and Resource Cost = 0).',
    'Puzzles are EASY (Sahni kappa = 1) or HARD (kappa >= 2); the deceptive part is',
    'that the highest $/cell bricks are traps, so pure ratio-greedy play falls short.',
    '',
    'Data. This script does NOT use the table picked above - the page always hands it',
    'the two sheets it needs, as CSV strings:',
    '  PLAYLOG_CSV  the \'Play log\' sheet: ONE ROW PER BRICK MOVE (add / remove),',
    '               with every KPI snapshotted before and after the move.',
    '  ROUNDS_CSV   the \'Rounds\' sheet: ONE ROW PER COMPLETED PUZZLE, carrying the',
    '               puzzle\'s Difficulty and its maximum (\'Best Value\').',
    'Moves are joined to Rounds on (Player, Session, Puzzle); the join also drops',
    'training-phase moves, which have no Rounds row.',
    '',
    'Definitions.',
    '  TOP player (strict)   reached the maximum net value on >= 1 puzzle AT LEAST',
    '                        ONCE DURING PLAY (any move, not only the final board).',
    '  TOP player (relaxed)  came within 5% of the maximum (net >= 0.95 x Best) on',
    '                        >= 1 puzzle during play.',
    '  BALANCED KPIs         the six on-screen KPIs collapse to three INDEPENDENT',
    '                        objectives (Resource Cost is just 16 minus the covered',
    '                        cells, i.e. an inverse rescaling of Coverage; Value/',
    '                        Resource is a ratio of the others and is undefined at',
    '                        full coverage; both are therefore excluded). After every',
    '                        move, each objective is compared to ITS OPTIMAL value:',
    '                          s_net = (Net + 16) / (Best + 16)  net-value attainment',
    '                                  (0 = empty board at net -$16, 1 = the optimum)',
    '                          s_cov = Coverage / 100            resource utilisation',
    '                          s_fit = Portfolio Fitness / 100   geometric compactness',
    '                                  (100 = gap-free cluster; independent of value)',
    '                        kpi_avg  = the mean of the three = the BALANCED-KPI',
    '                                   SCORE: how well the player is doing ACROSS',
    '                                   the KPIs on that move (1 = every KPI at its',
    '                                   optimum; 1 - kpi_avg = the average',
    '                                   discrepancy from the optima).',
    '                        kpi_even = 1 - population SD of the three = EVENNESS',
    '                                   (is any one objective being neglected?).',
    '                        kpi_avg is then averaged move -> puzzle -> player, so',
    '                        the AVERAGE top user can be compared with the AVERAGE',
    '                        non-top user, separately for easy and hard puzzles.',
    '',
    'What it prints, in order:',
    '  1. Data + top-player counts under both definitions.',
    '  2. HEURISTICS: per-difficulty comparison (top vs rest) of six behavioural',
    '     markers, with Welch t-tests, then an easy-vs-hard comparison.',
    '  3. Regression R1: which heuristics predict finding the maximum (linear',
    '     probability model, SEs clustered on player).',
    '  4. THE BALANCED-KPI HYPOTHESIS (H1): "top players do not only maximise net',
    '     value - across ALL the KPIs they stay close to the optima while they play."',
    '     First the player-level comparison exactly as specified: kpi_avg averaged',
    '     move -> puzzle -> player, average top user vs average non-top user, for',
    '     easy and for hard puzzles, under both top definitions (Welch t-tests).',
    '     Then move-level regressions: kpi_avg on the top flag, play progress,',
    '     their interaction, the net-attainment level s_net (so \'balanced\' is not',
    '     just \'better at net value\'), and a hard-puzzle dummy, clustering SEs on',
    '     player. R2 = strict definition, R3 = relaxed (within-5%), R4 = R2',
    '     excluding moves at the maximum itself (where kpi_avg = 1 mechanically),',
    '     R5 = R2 with the EVENNESS outcome kpi_even (functional-form check).',
    '  5. FOCUSED OR DIVERSIFIED? A revealed-objective test: candidate objectives',
    '     are net value only, or a balanced bundle of net value with coverage and/or',
    '     compactness; we measure how fast each candidate CLIMBS per move for each',
    '     player and compare the groups (both definitions). The FOCUS GAP - net-only',
    '     climb minus all-three climb - is positive for net-focused play and',
    '     negative for diversified play.',
    '  6. THE OPENING AND THE APPROACH TO THE PEAK: each play\'s FIRST 10 moves,',
    '     and the LAST 10 moves up to and including the move where the player FIRST',
    '     reached their own maximum net value (if the same maximum was hit more',
    '     than once, the first time counts) - window metrics compared top-vs-rest',
    '     under both definitions, plus a move-by-move aligned figure.',
    '  7. HEURISTIC PROFILES - THE WITHIN-5% PLAYBOOK: a deep dive under the',
    '     relaxed definition (top = within 5% of the maximum net value). The',
    '     per-group heuristic profile in plain numbers, a ranking of WHICH habits',
    '     were most successful (success-rate lift among the players who share each',
    '     habit, two-proportion tests), and a style-score-vs-outcome correlation.',
    '  8. Fifteen figures - shown in the \'Insights gained\' section, in numerical',
    '     order and each under the paragraph that explains it, including three',
    '     extra decile views of the trajectories under alternative objective',
    '     scores (net value only; 50% net + 50% ROI; 1/3 net + 1/3 ROI + 1/3',
    '     fitness, with ROI attainment = Total Value / (Total Value + Resource',
    '     Cost) = ROI/(1+ROI)). The write-up is data-driven and ENDS',
    '     WITH A VERDICT: are the best players focused on one KPI, or balancing',
    '     across the KPIs, compared to the rest?',
    '  Every top-vs-rest comparison is run under BOTH top definitions (strict and',
    '  within-5%), and trajectories are shown at fifth- and tenth-of-play resolution.',
    'Both this Python version and the R version compute the SAME numbers.',
    '"""',
    '',
    'import io                              # to read the CSV strings as files',
    'import warnings                        # keep the report clean (remove to debug)',
    'warnings.filterwarnings("ignore")',
    'import numpy as np                     # matrix algebra for the regressions',
    'import pandas as pd                    # data frames, joins, group-bys',
    'import matplotlib',
    'matplotlib.use("Agg")                  # headless backend; the page harvests figures',
    'import matplotlib.pyplot as plt',
    'from scipy import stats as st          # Welch t-tests + t/normal distributions',
    '',
    '# ---- 0. load the two sheets the page hands over --------------------------------',
    'if not str(globals().get("PLAYLOG_CSV", "")).strip() or not str(globals().get("ROUNDS_CSV", "")).strip():',
    '    raise SystemExit("This analysis needs BOTH the \'Play log\' and \'Rounds\' sheets. In Section 1, load sessions (or import a full Excel export) that contain them, then Run again.")',
    'moves = pd.read_csv(io.StringIO(PLAYLOG_CSV))    # one row per brick move',
    'rounds = pd.read_csv(io.StringIO(ROUNDS_CSV))    # one row per completed puzzle',
    '',
    'def col(df, *names):',
    '    """Find a real column of df by any candidate name, ignoring case, spacing',
    '    and punctuation - so exports with slightly different headers still work."""',
    '    m = {"".join(ch for ch in str(c).lower() if ch.isalnum()): c for c in df.columns}',
    '    for n in names:',
    '        k = "".join(ch for ch in str(n).lower() if ch.isalnum())',
    '        if k in m:',
    '            return m[k]',
    '    return None',
    '',
    'for df, need in ((moves, ["Player", "Session", "Puzzle", "Action", "Move #", "Brick Value", "Cells", "Duration (s)", "Net Value (before)", "Net Value (after)", "Total Value (after)", "Resource Cost (after)", "Coverage % (before)", "Coverage % (after)", "Portfolio Fitness (before)", "Portfolio Fitness (after)"]),',
    '                 (rounds, ["Player", "Session", "Difficulty", "Best Value"])):',
    '    bad = [n for n in need if col(df, n) is None]',
    '    if bad:',
    '        raise SystemExit("A needed column is missing: " + ", ".join(bad) + ". Load an export made by this admin (Play log + Rounds sheets).")',
    '',
    '# ---- 1. canonical move table ----------------------------------------------------',
    '# mv: one row per add/remove, with short names. \'player\' = Player|Session so the',
    '# same label from two different sessions never merges into one person.',
    'mv = pd.DataFrame({',
    '    "player": moves[col(moves, "Player")].astype(str) + "|" + moves[col(moves, "Session")].astype(str),',
    '    "puzzle": moves[col(moves, "Puzzle")].astype(str),',
    '    "action": moves[col(moves, "Action")].astype(str).str.strip().str.lower(),',
    '    "move": pd.to_numeric(moves[col(moves, "Move #")], errors="coerce"),          # 1,2,3... within the puzzle',
    '    "brick_val": pd.to_numeric(moves[col(moves, "Brick Value")], errors="coerce"),# $ value of the brick moved',
    '    "cells": moves[col(moves, "Cells")].astype(str).str.count(r"\\[") - 1,         # brick size = number of [r,c] pairs',
    '    "sec": pd.to_numeric(moves[col(moves, "Duration (s)")], errors="coerce"),     # seconds since the previous move',
    '    "net_b": pd.to_numeric(moves[col(moves, "Net Value (before)")], errors="coerce"),',
    '    "net_a": pd.to_numeric(moves[col(moves, "Net Value (after)")], errors="coerce"),',
    '    "val_a": pd.to_numeric(moves[col(moves, "Total Value (after)")], errors="coerce"),',
    '    "cost_a": pd.to_numeric(moves[col(moves, "Resource Cost (after)")], errors="coerce"),',
    '    "cov_b": pd.to_numeric(moves[col(moves, "Coverage % (before)")], errors="coerce"),',
    '    "cov_a": pd.to_numeric(moves[col(moves, "Coverage % (after)")], errors="coerce"),',
    '    "fit_b": pd.to_numeric(moves[col(moves, "Portfolio Fitness (before)")], errors="coerce"),',
    '    "fit_a": pd.to_numeric(moves[col(moves, "Portfolio Fitness (after)")], errors="coerce"),',
    '})',
    'mv = mv[mv["action"].isin(["add", "remove"])]          # keep real moves, drop \'start\' rows',
    '',
    '# rd: one fact row per player-puzzle from Rounds - its difficulty + Best Value.',
    'rd = pd.DataFrame({',
    '    "player": rounds[col(rounds, "Player")].astype(str) + "|" + rounds[col(rounds, "Session")].astype(str),',
    '    "puzzle": rounds[col(rounds, "Puzzle ID", "Puzzle")].astype(str),',
    '    "diff": rounds[col(rounds, "Difficulty")].astype(str).str.strip().str.lower().str[:1].map({"e": "easy", "h": "hard"}),',
    '    "best": pd.to_numeric(rounds[col(rounds, "Best Value")], errors="coerce"),',
    '}).dropna().drop_duplicates(["player", "puzzle"])',
    '',
    '# the join: keeps only moves belonging to a completed main-game puzzle (training',
    '# has no Rounds row and drops out here); then sort into true play order.',
    'mv = mv.merge(rd, on=["player", "puzzle"], how="inner")',
    'mv = mv.sort_values(["player", "puzzle", "move"], kind="mergesort").reset_index(drop=True)',
    'if not len(mv):',
    '    raise SystemExit("No moves matched a completed puzzle - check that the Play log and Rounds sheets come from the same sessions.")',
    '',
    '# ---- 2. per-move KPI attainment scores and the BALANCE measure ------------------',
    'mv["s_net"] = (mv["net_a"] + 16) / (mv["best"] + 16)   # net-value attainment, 0..1',
    'mv["s_cov"] = mv["cov_a"] / 100                        # resource utilisation, 0..1',
    'mv["s_fit"] = mv["fit_a"] / 100                        # compactness, 0..1 (NaN on an empty board)',
    '# ROI attainment: a bounded 0-1 rescaling of the Value/Resource (ROI) KPI,',
    '# s_roi = Total Value / (Total Value + Resource Cost) = ROI / (1 + ROI) -',
    '# 0 = empty board, 1 = zero empty-cell penalty (the full-cover optimum). This',
    '# form stays defined at full coverage, where the raw KPI divides by zero.',
    'mv["s_roi"] = mv["val_a"] / (mv["val_a"] + mv["cost_a"])',
    'mv["mix_nr"] = (mv["s_net"] + mv["s_roi"]) / 2         # 50% net value + 50% ROI',
    'mv["mix_nrf"] = (mv["s_net"] + mv["s_roi"] + mv["s_fit"]) / 3   # 1/3 net + 1/3 ROI + 1/3 fitness',
    'S = mv[["s_net", "s_cov", "s_fit"]].to_numpy()         # the 3-KPI profile after each move',
    '# kpi_avg: the balanced-KPI score = mean attainment across the KPIs (so',
    '# 1 - kpi_avg = the average discrepancy of the KPIs from their optimal values).',
    '# kpi_even: 1 - population SD of the same three = evenness across the KPIs.',
    '# A move where a score is undefined (compactness on an emptied board) drops out.',
    'mv["kpi_avg"] = S.mean(axis=1)',
    'mv["kpi_even"] = 1 - np.sqrt(np.mean((S - S.mean(axis=1, keepdims=True)) ** 2, axis=1))',
    'mv["n_moves"] = mv.groupby(["player", "puzzle"])["move"].transform("max")   # moves in that play',
    'mv["progress"] = mv["move"] / mv["n_moves"]            # how far through the play, (0..1]',
    'mv["bin"] = np.minimum(np.ceil(mv["progress"] * 5), 5).astype(int)          # play split into fifths',
    'mv["bin10"] = np.minimum(np.ceil(mv["progress"] * 10), 10).astype(int)      # ... and into tenths (Figure 5)',
    'mv["is_rem"] = (mv["action"] == "remove").astype(float)                     # 1 = removal',
    '# Per-move CHANGE in each KPI attainment (after minus before), for the',
    '# revealed-objective test of Section 5. NOTE a mechanical fact of this game:',
    '# every placement raises Net Value (by the brick\'s value + the cells it saves',
    '# from the penalty) and Coverage, and every removal lowers them - so "did the',
    '# move improve X" is the same yes/no for any net-anchored candidate. What CAN',
    '# differ is how FAST each objective climbs, so the test below compares each',
    '# candidate\'s per-move climb rate (in attainment points, x100). Scored only on',
    '# moves where EVERY delta is defined (the compactness of an empty board is',
    '# blank, so a puzzle\'s very first placement is excluded) - that way all',
    '# candidates are compared on the SAME set of moves.',
    'mv["d_net"] = mv["s_net"] - (mv["net_b"] + 16) / (mv["best"] + 16)',
    'mv["d_cov"] = mv["s_cov"] - mv["cov_b"] / 100',
    'mv["d_fit"] = mv["s_fit"] - mv["fit_b"] / 100',
    'ok = mv["d_net"].notna() & mv["d_cov"].notna() & mv["d_fit"].notna()',
    'for nm, dd in (("u_net", mv["d_net"]), ("u_nc", (mv["d_net"] + mv["d_cov"]) / 2),',
    '               ("u_nf", (mv["d_net"] + mv["d_fit"]) / 2), ("u_all", (mv["d_net"] + mv["d_cov"] + mv["d_fit"]) / 3)):',
    '    mv[nm] = np.where(ok, 100 * dd, np.nan)   # this move\'s change in that candidate objective (points)',
    '',
    '# ---- 3. player-puzzle outcomes + the two top-player definitions -----------------',
    '# pp: one row per player-puzzle with its peak net reached DURING play.',
    'pp = mv.groupby(["player", "puzzle"], as_index=False).agg(',
    '    diff=("diff", "first"), best=("best", "first"), peak=("net_a", "max"))',
    'pp["reached_max"] = (pp["peak"] >= pp["best"]).astype(float)     # touched the optimum',
    'pp["within5"] = (pp["peak"] >= 0.95 * pp["best"]).astype(float)  # got within 5% of it',
    'top_strict = pp.groupby("player")["reached_max"].max()   # player flag, strict definition',
    'top_5pct = pp.groupby("player")["within5"].max()         # player flag, relaxed definition',
    'mv["top_strict"] = mv["player"].map(top_strict)',
    'mv["top_5pct"] = mv["player"].map(top_5pct)',
    'mv["hard"] = (mv["diff"] == "hard").astype(float)',
    '',
    'def line(ch="-"):',
    '    """Print a 78-character separator line."""',
    '    print(ch * 78)',
    '',
    'line("="); print("1. DATA"); line("=")',
    'print(f"Moves analysed: {len(mv)}   player-puzzles: {len(pp)}   players: {pp[\'player\'].nunique()}")',
    'print(f"TOP (strict, touched the maximum on >=1 puzzle during play): {int(top_strict.sum())} of {len(top_strict)} players")',
    'print(f"TOP (relaxed, within 5% of the maximum on >=1 puzzle):       {int(top_5pct.sum())} of {len(top_5pct)} players")',
    '',
    '# ---- 4. behavioural markers: HOW was each puzzle played? ------------------------',
    '# One row per player-puzzle; each marker is a simple, interpretable heuristic:',
    '#   n_moves    board changes made (exploration volume)',
    '#   rem_share  share of moves that were removals (willingness to backtrack)',
    '#   early_vpc  mean $/cell of the FIRST 3 bricks placed (ratio-chasing: the',
    '#              pricey-per-cell bricks are this game\'s deliberate traps)',
    '#   early_cov  share of the board covered after the 3rd move (early board-filling)',
    '#   sec_move   mean seconds per move (deliberation speed)',
    '# (Removing a brick always cuts net value, so rem_share doubles as \'accepted',
    '#  temporary net losses\'; a separate net-dip marker would be collinear with it.)',
    '#   peak_at    fraction of the play at which the player FIRST hit their own peak',
    '#              net value (late = kept improving; early = found it then stalled)',
    'mk = mv.groupby(["player", "puzzle"], as_index=False).agg(',
    '    diff=("diff", "first"), n_moves=("move", "max"),',
    '    rem_share=("is_rem", "mean"), sec_move=("sec", "mean"))',
    'adds = mv[mv["action"] == "add"].copy()                # placements only, in play order',
    'adds["vpc"] = adds["brick_val"] / adds["cells"]        # $ value per cell of that brick',
    'adds["k"] = adds.groupby(["player", "puzzle"]).cumcount() + 1   # 1st, 2nd, ... placement',
    'mk = mk.merge(adds[adds["k"] <= 3].groupby(["player", "puzzle"], as_index=False)["vpc"].mean().rename(columns={"vpc": "early_vpc"}), on=["player", "puzzle"], how="left")',
    'mk = mk.merge(mv[mv["move"] == np.minimum(mv["n_moves"], 3)].rename(columns={"s_cov": "early_cov"})[["player", "puzzle", "early_cov"]], on=["player", "puzzle"], how="left")',
    'mk = mk.merge(pp[["player", "puzzle", "peak", "reached_max", "within5"]], on=["player", "puzzle"])',
    'mk = mk.merge(mv[mv["net_a"] >= mv.groupby(["player", "puzzle"])["net_a"].transform("max")].groupby(["player", "puzzle"], as_index=False)["move"].min().rename(columns={"move": "peak_move"}), on=["player", "puzzle"])',
    'mk["peak_at"] = mk["peak_move"] / mk["n_moves"]',
    '',
    'MARKERS = ["n_moves", "rem_share", "early_vpc", "early_cov", "sec_move", "peak_at"]',
    '# pl: markers averaged to ONE ROW PER PLAYER x DIFFICULTY, so a player who',
    '# played more puzzles does not dominate the group comparisons below.',
    'pl = mk.groupby(["player", "diff"], as_index=False)[MARKERS].mean()',
    '# per-difficulty top flags: reached the maximum / came within 5% of it on >= 1',
    '# puzzle OF THAT difficulty (so easy and hard status are judged separately)',
    'pl = pl.merge(mk.groupby(["player", "diff"], as_index=False)["reached_max"].max().rename(columns={"reached_max": "top_d"}), on=["player", "diff"])',
    'pl = pl.merge(mk.groupby(["player", "diff"], as_index=False)["within5"].max().rename(columns={"within5": "top5_d"}), on=["player", "diff"])',
    '',
    'line("="); print("2. HEURISTICS - what did the players who found the maximum do differently?"); line("=")',
    'print("Markers (one value per player x difficulty; group test = Welch t):")',
    'print("  n_moves   board changes made          rem_share  share of moves = removals")',
    'print("  early_vpc mean $/cell, first 3 bricks early_cov  board covered after 3 moves")',
    'print("  sec_move  mean seconds per move       peak_at    when own peak was first hit (0-1)")',
    'D = {}    # Cohen\'s d per (difficulty, marker), strict definition - Figure 1',
    'D5 = {}   # the same under the within-5% definition - Figure 2',
    'for defn, flagcol, Dst in (("reached the maximum", "top_d", D), ("within 5% of the maximum", "top5_d", D5)):',
    '    for d in ("easy", "hard"):',
    '        a_n = int((pl.loc[pl["diff"] == d, flagcol] == 1).sum())',
    '        b_n = int((pl.loc[pl["diff"] == d, flagcol] == 0).sum())',
    '        print(f"\\n--- {d.upper()} puzzles: {defn} (n={a_n}) vs not (n={b_n}) ---")',
    '        print(f"{\'marker\':<11}{\'top mean\':>10}{\'rest mean\':>11}{\'diff\':>9}{\'p\':>9}")',
    '        for m in MARKERS:',
    '            a = pl.loc[(pl["diff"] == d) & (pl[flagcol] == 1), m].dropna()',
    '            b = pl.loc[(pl["diff"] == d) & (pl[flagcol] == 0), m].dropna()',
    '            if len(a) > 1 and len(b) > 1 and (a.std(ddof=1) > 1e-12 or b.std(ddof=1) > 1e-12):',
    '                sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))',
    '                Dst[(d, m)] = (a.mean() - b.mean()) / sp if sp > 0 else 0.0   # standardised gap',
    '                dv = a.mean() - b.mean()',
    '                if abs(dv) < 1e-9: dv = 0.0                 # avoid a cosmetic \'-0.000\'',
    '                print(f"{m:<11}{a.mean():>10.3f}{b.mean():>11.3f}{dv:>9.3f}{st.ttest_ind(a, b, equal_var=False).pvalue:>9.4f}")',
    '            else:',
    '                Dst[(d, m)] = 0.0',
    '                print(f"{m:<11}   (not enough players in one of the groups)")',
    '',
    'print("\\n--- EASY vs HARD: does play itself change with difficulty? (all players) ---")',
    'print(f"{\'marker\':<11}{\'easy mean\':>10}{\'hard mean\':>11}{\'diff\':>9}{\'p\':>9}")',
    'for m in MARKERS:',
    '    a = pl.loc[pl["diff"] == "easy", m].dropna()',
    '    b = pl.loc[pl["diff"] == "hard", m].dropna()',
    '    if len(a) > 1 and len(b) > 1 and (a.std(ddof=1) > 1e-12 or b.std(ddof=1) > 1e-12):',
    '        dv = a.mean() - b.mean()',
    '        if abs(dv) < 1e-9: dv = 0.0                         # avoid a cosmetic \'-0.000\'',
    '        print(f"{m:<11}{a.mean():>10.3f}{b.mean():>11.3f}{dv:>9.3f}{st.ttest_ind(a, b, equal_var=False).pvalue:>9.4f}")',
    '',
    '# ---- 5. regressions with player-clustered SEs -----------------------------------',
    'def ols_cluster(y, X, names, cluster, label):',
    '    """OLS with CR1 cluster-robust standard errors, printed as a table.',
    '    y      outcome vector (numpy)',
    '    X      predictor matrix WITH a leading column of 1s (the intercept)',
    '    names  printable name for each column of X',
    '    cluster the cluster id of every row (the player - their rows are dependent)',
    '    label  the table title. Returns the coefficient vector."""',
    '    XtXi = np.linalg.pinv(X.T @ X, rcond=1e-10)        # (X\'X)^-1 via SVD (rcond matches the R twin)',
    '    b = XtXi @ (X.T @ y)                               # OLS coefficients',
    '    e = y - X @ b                                      # residuals',
    '    meat = np.zeros((X.shape[1], X.shape[1]))          # sum of per-cluster score outer products',
    '    for c in pd.unique(cluster):',
    '        v = X[cluster == c].T @ e[cluster == c]',
    '        meat += np.outer(v, v)',
    '    G, N, k = len(pd.unique(cluster)), len(y), X.shape[1]',
    '    V = (G / (G - 1)) * ((N - 1) / (N - k)) * (XtXi @ meat @ XtXi)   # CR1 correction',
    '    se = np.sqrt(np.diag(V))',
    '    print(f"\\n{label}")',
    '    print(f"  ({N} observations, {G} player clusters; t-tests use {G - 1} df)")',
    '    print(f"  {\'term\':<22}{\'coef\':>10}{\'se\':>10}{\'t\':>8}{\'p\':>9}")',
    '    for i, nm in enumerate(names):',
    '        t = b[i] / se[i]',
    '        print(f"  {nm:<22}{b[i]:>10.4f}{se[i]:>10.4f}{t:>8.2f}{2 * (1 - st.t.cdf(abs(t), G - 1)):>9.4f}")',
    '    return b',
    '',
    'line("="); print("3. WHICH HEURISTICS PREDICT FINDING THE MAXIMUM? (regression R1)"); line("=")',
    'print("Linear probability model at the player-puzzle level. Markers are")',
    'print("STANDARDISED, so each coefficient = change in P(reached the maximum) per")',
    'print("1 SD of that marker, holding the others fixed. SEs clustered on player.")',
    'r1 = mk.dropna(subset=MARKERS).reset_index(drop=True)',
    'Z = np.column_stack([np.ones(len(r1))] + [((r1[m] - r1[m].mean()) / r1[m].std(ddof=1)).to_numpy() for m in MARKERS] + [(r1["diff"] == "hard").to_numpy().astype(float)])',
    'ols_cluster(r1["reached_max"].to_numpy(), Z, ["(intercept)"] + [m + " (z)" for m in MARKERS] + ["hard puzzle"], r1["player"].to_numpy(), "R1: reached_max ~ markers + hard")',
    'ols_cluster(r1["within5"].to_numpy(), Z, ["(intercept)"] + [m + " (z)" for m in MARKERS] + ["hard puzzle"], r1["player"].to_numpy(), "R1b: the same model for getting WITHIN 5% of the maximum")',
    '',
    'line("="); print("4. THE BALANCED-KPI HYPOTHESIS (H1)"); line("=")',
    'print("H1: top players do not only maximise net value - across ALL the KPIs they")',
    'print("stay close to the optima while they play. The metric: each KPI is taken")',
    'print("RELATIVE TO ITS OPTIMAL VALUE and averaged across KPIs -> one balanced-KPI")',
    'print("score per move (kpi_avg); then averaged move -> puzzle -> player, so the")',
    'print("AVERAGE top user is compared with the AVERAGE non-top user per difficulty.")',
    'bal = mv.dropna(subset=["kpi_avg", "kpi_even", "progress", "s_net"]).reset_index(drop=True)',
    '# the requested aggregation: moves -> one score per puzzle -> one per player x difficulty',
    'uavg = bal.groupby(["player", "puzzle"], as_index=False).agg(diff=("diff", "first"), kpi=("kpi_avg", "mean"), even=("kpi_even", "mean"), v_net=("s_net", "mean"), v_cov=("s_cov", "mean"), v_fit=("s_fit", "mean")).groupby(["player", "diff"], as_index=False)[["kpi", "even", "v_net", "v_cov", "v_fit"]].mean()',
    'def ucmp(d, flag):',
    '    """Average top user vs average non-top user on the player-level balanced-KPI',
    '    score, within difficulty d; flag = the player -> 0/1 top mapping. Returns',
    '    (top mean, rest mean, Welch p), or None if a group is too small/constant."""',
    '    a = uavg.loc[(uavg["diff"] == d) & (uavg["player"].map(flag) == 1), "kpi"].dropna()',
    '    b = uavg.loc[(uavg["diff"] == d) & (uavg["player"].map(flag) == 0), "kpi"].dropna()',
    '    if len(a) > 1 and len(b) > 1 and (a.std(ddof=1) > 1e-12 or b.std(ddof=1) > 1e-12):',
    '        return (a.mean(), b.mean(), st.ttest_ind(a, b, equal_var=False).pvalue)',
    '    return None',
    'print("\\nBalanced-KPI score of the AVERAGE top user vs the AVERAGE non-top user")',
    'print("(1 = every KPI at its optimum; per-user scores, Welch t-test):")',
    'print(f"{\'definition\':<12}{\'difficulty\':<12}{\'top mean\':>10}{\'rest mean\':>11}{\'diff\':>9}{\'p\':>9}")',
    'for lab, flag in (("strict", top_strict), ("within-5%", top_5pct)):',
    '    for d in ("easy", "hard"):',
    '        r = ucmp(d, flag)',
    '        if r:',
    '            print(f"{lab:<12}{d:<12}{r[0]:>10.3f}{r[1]:>11.3f}{r[0] - r[1]:>9.3f}{r[2]:>9.4f}")',
    '        else:',
    '            print(f"{lab:<12}{d:<12}   (not enough players in one of the groups)")',
    'print("\\nMove-level regressions. The s_net control makes the \'top player\' row read:")',
    'print("at the SAME net attainment and stage of play, do the other KPIs sit closer")',
    'print("to their optima for top players?")',
    'def h1(flag, outcome, label):',
    '    """H1 regression: outcome ~ top + progress + top x progress + s_net + hard,',
    '    SEs clustered on player; flag / outcome are column names in bal."""',
    '    X = np.column_stack([np.ones(len(bal)), bal[flag], bal["progress"], bal[flag] * bal["progress"], bal["s_net"], bal["hard"]])',
    '    return ols_cluster(bal[outcome].to_numpy(), X, ["(intercept)", "top player", "progress", "top x progress", "s_net (level)", "hard puzzle"], bal["player"].to_numpy(), label)',
    'h1("top_strict", "kpi_avg", "R2: kpi_avg ~ top(strict) x progress + s_net + hard")',
    'h1("top_5pct", "kpi_avg", "R3: kpi_avg ~ top(within-5%) x progress + s_net + hard")',
    '# Robustness: at the maximum itself every score is 1, so kpi_avg = 1 mechanically;',
    '# R4 re-runs R2 keeping only moves strictly BELOW the maximum.',
    'keep = bal["net_a"] < bal["best"]',
    'X4 = np.column_stack([np.ones(int(keep.sum())), bal.loc[keep, "top_strict"], bal.loc[keep, "progress"], bal.loc[keep, "top_strict"] * bal.loc[keep, "progress"], bal.loc[keep, "s_net"], bal.loc[keep, "hard"]])',
    'ols_cluster(bal.loc[keep, "kpi_avg"].to_numpy(), X4, ["(intercept)", "top player", "progress", "top x progress", "s_net (level)", "hard puzzle"], bal.loc[keep, "player"].to_numpy(), "R4 (robustness): R2 excluding moves AT the maximum")',
    '# Functional form: same regression with the EVENNESS outcome - if R2 and R5',
    '# agree, the conclusion does not hinge on how \'balanced\' is defined.',
    'h1("top_strict", "kpi_even", "R5 (functional form): kpi_even ~ top(strict) x progress + s_net + hard")',
    '',
    'def p4(x):',
    '    """A p-value to 4 decimals, or \'n/a\' when it cannot be computed."""',
    '    return f"{x:.4f}" if np.isfinite(x) else "n/a"',
    'def cell(x, w):',
    '    """Format one table number to width w, or \'---\' when the cell is empty',
    '    (e.g. a tenth of play in which one group happens to have no moves).',
    '    Pre-rounding to 7 decimals keeps Python and R byte-identical: the two',
    '    languages sum in different orders, and a mean sitting within ~1e-15 of a',
    '    0.0005 boundary could otherwise print a different last digit."""',
    '    return f"{round(x, 7):>{w}.3f}" if pd.notna(x) else " " * (w - 3) + "---"',
    'for binc, word, ref in (("bin", "fifth", "Figures 3-4"), ("bin10", "tenth", "Figure 5")):',
    '    print(f"\\nMean balanced-KPI score by {word} of play (the data behind {ref}):")',
    '    print(f"{word:<7}{\'top(strict)\':>12}{\'rest\':>8}{\'top(5%)\':>10}{\'rest\':>8}")',
    '    for i in range(1, (6 if binc == "bin" else 11)):',
    '        r = [bal.loc[(bal[binc] == i) & (bal[f] == v), "kpi_avg"].mean() for f, v in (("top_strict", 1), ("top_strict", 0), ("top_5pct", 1), ("top_5pct", 0))]',
    '        print(f"{i:<7}" + cell(r[0], 12) + cell(r[1], 8) + cell(r[2], 10) + cell(r[3], 8))',
    '',
    'line("="); print("5. FOCUSED OR DIVERSIFIED? WHICH OBJECTIVE DOES PLAY TRACK?"); line("=")',
    'print("A revealed-objective test. Candidate objectives: net value only, or a")',
    'print("balanced bundle of net value with coverage and/or compactness (each")',
    'print("candidate = the mean of its KPIs\' attainment scores, 0-100 points). For")',
    'print("every move we measure how much each candidate CLIMBED (its per-move change")',
    'print("in points); averaging move -> puzzle -> player gives each player\'s climb")',
    'print("rate per candidate. Mechanical note: in this game every placement raises")',
    'print("net value and coverage and every removal lowers them, so the candidates")',
    'print("separate through HOW FAST each objective rises - in particular through")',
    'print("compactness. FOCUS GAP = climb(net only) - climb(all three): positive =")',
    'print("net rises faster than the balanced bundle (net-focused play), negative =")',
    'print("the other KPIs keep pace or better (diversified play). Only moves where")',
    'print("every KPI change is defined are scored (a puzzle\'s first placement is")',
    'print("excluded: an empty board has no compactness).")',
    'CANDS = [("net value only", "u_net"), ("net + coverage", "u_nc"), ("net + compactness", "u_nf"), ("net + coverage + compactness", "u_all")]',
    '# per-player climb rate of each candidate (averaged move -> puzzle -> player)',
    'cons = mv.groupby(["player", "puzzle"], as_index=False)[["u_net", "u_nc", "u_nf", "u_all"]].mean().groupby("player", as_index=False)[["u_net", "u_nc", "u_nf", "u_all"]].mean()',
    'cons["focus_gap"] = cons["u_net"] - cons["u_all"]',
    'def focus(lab, flag):',
    '    """Print the candidate climb-rate table + the focus-gap tests for one top',
    '    definition. Returns (top gap mean, p vs 0) for the INSIGHTS verdict."""',
    '    a = cons[cons["player"].map(flag) == 1]',
    '    b = cons[cons["player"].map(flag) == 0]',
    '    if not (len(a) > 1 and len(b) > 1 and (a["focus_gap"].std(ddof=1) > 1e-12 or b["focus_gap"].std(ddof=1) > 1e-12)):',
    '        print(f"\\n--- {lab} definition: not enough players in one of the groups ---")',
    '        return None',
    '    print(f"\\n--- {lab} definition: top (n={len(a)}) vs rest (n={len(b)}) ---")',
    '    print("Per-move climb rate of each candidate objective (points per move):")',
    '    print(f"{\'candidate objective\':<30}{\'top\':>8}{\'rest\':>8}{\'diff\':>8}{\'p\':>9}")',
    '    for nm, c in CANDS:',
    '        aa, bb = a[c].dropna(), b[c].dropna()',
    '        if len(aa) > 1 and len(bb) > 1 and (aa.std(ddof=1) > 1e-12 or bb.std(ddof=1) > 1e-12):',
    '            print(f"{nm:<30}{aa.mean():>8.3f}{bb.mean():>8.3f}{aa.mean() - bb.mean():>8.3f}{st.ttest_ind(aa, bb, equal_var=False).pvalue:>9.4f}")',
    '        else:',
    '            print(f"{nm:<30}   (not enough players in one of the groups)")',
    '    bt = max(CANDS, key=lambda x: a[x[1]].mean())',
    '    br = max(CANDS, key=lambda x: b[x[1]].mean())',
    '    print(f"Fastest-climbing objective: top = {bt[0]}; rest = {br[0]}")',
    '    pa = st.ttest_1samp(a["focus_gap"].dropna(), 0).pvalue if a["focus_gap"].std(ddof=1) > 1e-12 else float("nan")',
    '    pb = st.ttest_1samp(b["focus_gap"].dropna(), 0).pvalue if b["focus_gap"].std(ddof=1) > 1e-12 else float("nan")',
    '    pw = st.ttest_ind(a["focus_gap"].dropna(), b["focus_gap"].dropna(), equal_var=False).pvalue',
    '    print(f"Focus gap: top {a[\'focus_gap\'].mean():+.3f} (p vs 0 = {p4(pa)}), rest {b[\'focus_gap\'].mean():+.3f} (p vs 0 = {p4(pb)}); top-rest difference p = {p4(pw)}")',
    '    return (a["focus_gap"].mean(), pa, a["focus_gap"].mean() - b["focus_gap"].mean(), pw)',
    'fo_s = focus("strict", top_strict)',
    'fo_5 = focus("within-5%", top_5pct)',
    '',
    'line("="); print("6. THE OPENING AND THE APPROACH TO THE PEAK"); line("=")',
    'print("Two windows of play, compared between top players and the rest:")',
    'print("  OPENING   each play\'s FIRST 10 moves.")',
    'print("  APPROACH  the LAST 10 moves up to AND INCLUDING the move where the")',
    'print("            player FIRST reached their own maximum net value of that")',
    'print("            puzzle (if the same maximum was hit more than once, only")',
    'print("            the first time counts). Short plays contribute what they")',
    'print("            have; the two windows can overlap when the peak comes early.")',
    'print("Window metrics (window moves -> one value per player-puzzle -> per player):")',
    'print("  kpi_avg   mean balanced-KPI score in the window")',
    'print("  net_rate  net-value climb per move in the window (points, Section 5)")',
    'print("  rem_share share of the window\'s moves that were removals")',
    'print("  vpc       mean $ / cell of the bricks placed in the window")',
    'print("  sec_move  mean seconds per move in the window")',
    '# tag every move with its play\'s first-peak move, then flag the two windows',
    'mv = mv.merge(mk[["player", "puzzle", "peak_move"]], on=["player", "puzzle"], how="left")',
    'mv["in_open"] = (mv["move"] <= 10).astype(float)',
    'mv["in_appr"] = ((mv["move"] <= mv["peak_move"]) & (mv["move"] >= mv["peak_move"] - 9)).astype(float)',
    'WCOLS = ["kpi_avg", "net_rate", "rem_share", "vpc", "sec_move"]',
    'def wstats(mask_col):',
    '    """One row per player with the five window metrics, built the usual way:',
    '    the window\'s moves -> a player-puzzle mean -> a player mean."""',
    '    sub = mv[mv[mask_col] == 1].copy()',
    '    sub["vpc_w"] = np.where(sub["action"] == "add", sub["brick_val"] / sub["cells"], np.nan)',
    '    agg = sub.groupby(["player", "puzzle"], as_index=False).agg(kpi_avg=("kpi_avg", "mean"), net_rate=("u_net", "mean"), rem_share=("is_rem", "mean"), vpc=("vpc_w", "mean"), sec_move=("sec", "mean"))',
    '    return agg.groupby("player", as_index=False)[WCOLS].mean()',
    'def wcmp(ws, flag, colname):',
    '    """Top vs rest on one window metric: (top mean, rest mean, Welch p), or',
    '    None when a group is too small or has no variation."""',
    '    a = ws.loc[ws["player"].map(flag) == 1, colname].dropna()',
    '    b = ws.loc[ws["player"].map(flag) == 0, colname].dropna()',
    '    if len(a) > 1 and len(b) > 1 and (a.std(ddof=1) > 1e-12 or b.std(ddof=1) > 1e-12):',
    '        return (a.mean(), b.mean(), st.ttest_ind(a, b, equal_var=False).pvalue)',
    '    return None',
    'ws_open = wstats("in_open")',
    'ws_appr = wstats("in_appr")',
    'for wlab, ws in (("OPENING (first 10 moves)", ws_open), ("APPROACH (last 10 moves to the first peak)", ws_appr)):',
    '    for lab, flag in (("strict", top_strict), ("within-5%", top_5pct)):',
    '        n_a = int((ws["player"].map(flag) == 1).sum()); n_b = int((ws["player"].map(flag) == 0).sum())',
    '        print(f"\\n--- {wlab} - {lab} definition: top (n={n_a}) vs rest (n={n_b}) ---")',
    '        print(f"{\'metric\':<10}{\'top\':>10}{\'rest\':>11}{\'diff\':>9}{\'p\':>9}")',
    '        for m in WCOLS:',
    '            r = wcmp(ws, flag, m)',
    '            if r:',
    '                dv = r[0] - r[1]',
    '                if abs(dv) < 1e-9: dv = 0.0                 # avoid a cosmetic \'-0.000\'',
    '                print(f"{m:<10}{round(r[0], 7):>10.3f}{round(r[1], 7):>11.3f}{round(dv, 7):>9.3f}{r[2]:>9.4f}")',
    '            else:',
    '                print(f"{m:<10}   (not enough players in one of the groups)")',
    '',
    'line("="); print("7. HEURISTIC PROFILES - THE WITHIN-5% PLAYBOOK"); line("=")',
    'print("Everything in this section uses TOP = came within 5% of a puzzle\'s")',
    'print("maximum net value at least once. Markers are pooled to ONE VALUE PER")',
    'print("PLAYER (their easy and hard rows averaged), so each row below compares")',
    'print("the average top player with the average rest player; \'d\' = Cohen\'s d.")',
    '# plp: one row per player with the six pooled markers + the success flag',
    'plp = pl.groupby("player", as_index=False)[MARKERS].mean()',
    'plp["top5"] = plp["player"].map(top_5pct)',
    'ok7 = int((plp["top5"] == 1).sum()) > 1 and int((plp["top5"] == 0).sum()) > 1',
    'DIRS = {}   # each marker\'s direction of the top-rest gap (+1 = top players higher)',
    'ranked = []   # (marker, direction, adopter rate, other rate, lift, p), sorted by lift',
    'r_sc = None   # style-score vs outcome correlation, when computable',
    'if ok7:',
    '    print(f"\\n--- The heuristic profile: top (n={int((plp[\'top5\'] == 1).sum())}) vs rest (n={int((plp[\'top5\'] == 0).sum())}) ---")',
    '    print(f"{\'marker\':<11}{\'top mean\':>10}{\'rest mean\':>11}{\'diff\':>9}{\'d\':>8}{\'p\':>9}")',
    '    for m in MARKERS:',
    '        a = plp.loc[plp["top5"] == 1, m].dropna()',
    '        b = plp.loc[plp["top5"] == 0, m].dropna()',
    '        if len(a) > 1 and len(b) > 1 and (a.std(ddof=1) > 1e-12 or b.std(ddof=1) > 1e-12):',
    '            sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))',
    '            DIRS[m] = 1 if a.mean() >= b.mean() else -1',
    '            dv = a.mean() - b.mean()',
    '            if abs(dv) < 1e-9: dv = 0.0                     # avoid a cosmetic \'-0.000\'',
    '            print(f"{m:<11}{round(a.mean(), 7):>10.3f}{round(b.mean(), 7):>11.3f}{round(dv, 7):>9.3f}{(dv / sp if sp > 0 else 0):>8.2f}{st.ttest_ind(a, b, equal_var=False).pvalue:>9.4f}")',
    '        else:',
    '            print(f"{m:<11}   (not enough players in one of the groups)")',
    '    # the profile in one plain-language line per group',
    '    def profile(g, label):',
    '        """Print one readable sentence describing a group\'s average play style."""',
    '        print(f"{label}: {g[\'n_moves\'].mean():.1f} moves per puzzle, {g[\'rem_share\'].mean() * 100:.0f}% of moves are removals, "',
    '              f"first-3 bricks at ${g[\'early_vpc\'].mean():.2f}/cell, {g[\'early_cov\'].mean() * 100:.0f}% of the board covered by move 3, "',
    '              f"{g[\'sec_move\'].mean():.1f} s per move, first hits their peak {g[\'peak_at\'].mean() * 100:.0f}% of the way through the play.")',
    '    print()',
    '    profile(plp[plp["top5"] == 1], "The typical TOP player ")',
    '    profile(plp[plp["top5"] == 0], "The typical REST player")',
    '    # WHICH HABITS PAY: for each marker, \'sharing the top habit\' = being on the',
    '    # top group\'s side of the all-player median; compare the within-5% success',
    '    # rate of the players who share it vs those who do not (two-proportion z).',
    '    print("\\n--- Which habits pay: within-5% success rate if you share the top habit ---")',
    '    print(f"{\'marker\':<11}{\'habit\':>8}{\'adopters\':>10}{\'others\':>9}{\'lift\':>8}{\'p\':>9}")',
    '    for m in MARKERS:',
    '        if m not in DIRS: continue',
    '        v = plp.dropna(subset=[m])',
    '        adopt = (v[m] > v[m].median()) if DIRS[m] > 0 else (v[m] < v[m].median())',
    '        k1, n1 = int(v.loc[adopt, "top5"].sum()), int(adopt.sum())',
    '        k2, n2 = int(v.loc[~adopt, "top5"].sum()), int((~adopt).sum())',
    '        if n1 > 1 and n2 > 1:',
    '            ppool = (k1 + k2) / (n1 + n2)',
    '            se = np.sqrt(ppool * (1 - ppool) * (1 / n1 + 1 / n2))',
    '            pz = 2 * (1 - st.norm.cdf(abs((k1 / n1 - k2 / n2) / se))) if se > 0 else float("nan")',
    '            ranked.append((m, DIRS[m], k1 / n1, k2 / n2, k1 / n1 - k2 / n2, pz))',
    '            print(f"{m:<11}{(\'higher\' if DIRS[m] > 0 else \'lower\'):>8}{k1 / n1 * 100:>9.1f}%{k2 / n2 * 100:>8.1f}%{(k1 / n1 - k2 / n2) * 100:>+7.1f}%{p4(pz):>9}")',
    '        else:',
    '            print(f"{m:<11}{(\'higher\' if DIRS[m] > 0 else \'lower\'):>8}   (not enough players on one side of the median)")',
    '    ranked.sort(key=lambda x: -x[4])',
    '    # a one-number style score: the six markers z-scored, each ORIENTED so higher',
    '    # = more like the top group, then averaged - how \'top-like\' a player\'s style is',
    '    for m in MARKERS:',
    '        plp["z_" + m] = ((plp[m] - plp[m].mean()) / plp[m].std(ddof=1) * DIRS[m]) if (m in DIRS and plp[m].std(ddof=1) > 0) else 0',
    '    plp["style"] = plp[["z_" + m for m in MARKERS]].mean(axis=1)',
    '    plp["best_ratio"] = plp["player"].map(pp.assign(ratio=pp["peak"] / pp["best"]).groupby("player")["ratio"].max())',
    '    sc = plp.dropna(subset=["style", "best_ratio"])',
    '    if len(sc) > 2 and sc["style"].std(ddof=1) > 1e-12 and sc["best_ratio"].std(ddof=1) > 1e-12:',
    '        r_sc = st.pearsonr(sc["style"], sc["best_ratio"])',
    '        print(f"\\nStyle score vs outcome: playing \'top-like\' correlates with a player\'s closest")',
    '        print(f"approach to the maximum (best peak / Best Value) at r = {r_sc[0]:.3f} (p = {p4(r_sc[1])}).")',
    '    else:',
    '        print("\\nStyle score vs outcome: not enough variation to compute the correlation.")',
    'else:',
    '    print("(not enough players in one of the groups - load more sessions and re-run)")',
    '',
    '# ---- 6. figures (harvested by the page; shown in \'Insights gained\') -------------',
    'BLUE, ORANGE, GREY = "#4c72b0", "#e67e22", "#888888"',
    '',
    '# Figure 1 - the heuristic fingerprint: standardised top-minus-rest differences',
    'fig, ax = plt.subplots(figsize=(7, 4))',
    'y = np.arange(len(MARKERS))',
    'ax.barh(y + 0.2, [D[("easy", m)] for m in MARKERS], height=0.36, color=BLUE, label="easy")',
    'ax.barh(y - 0.2, [D[("hard", m)] for m in MARKERS], height=0.36, color=ORANGE, label="hard")',
    'ax.axvline(0, color=GREY, lw=1)',
    'ax.set_yticks(y); ax.set_yticklabels(MARKERS); ax.invert_yaxis()',
    'ax.set_xlabel("Cohen\'s d  (top players minus the rest)")',
    'ax.set_title("How players who reached the maximum played differently")',
    'ax.legend()',
    'fig.tight_layout()',
    '',
    '# Figure 2 - the heuristic fingerprint again, under the within-5% definition',
    'fig, ax = plt.subplots(figsize=(7, 4))',
    'y = np.arange(len(MARKERS))',
    'ax.barh(y + 0.2, [D5[("easy", m)] for m in MARKERS], height=0.36, color=BLUE, label="easy")',
    'ax.barh(y - 0.2, [D5[("hard", m)] for m in MARKERS], height=0.36, color=ORANGE, label="hard")',
    'ax.axvline(0, color=GREY, lw=1)',
    'ax.set_yticks(y); ax.set_yticklabels(MARKERS); ax.invert_yaxis()',
    'ax.set_xlabel("Cohen\'s d  (within-5% players minus the rest)")',
    'ax.set_title("The fingerprint when \'top\' = within 5% of the maximum")',
    'ax.legend()',
    'fig.tight_layout()',
    '',
    'def traj(flag, title):',
    '    """Figure 3 / Figure 4 body: mean balanced-KPI score per fifth of play, top vs rest,',
    '    with +-1 standard-error bars."""',
    '    fig, ax = plt.subplots(figsize=(7, 4))',
    '    for v, c, lab in ((1, BLUE, "top"), (0, GREY, "rest")):',
    '        g = bal[bal[flag] == v].groupby("bin")["kpi_avg"]',
    '        ax.errorbar(g.mean().index, g.mean(), yerr=g.std(ddof=1) / np.sqrt(g.count()), color=c, marker="o", capsize=3, label=lab)',
    '    ax.set_xticks([1, 2, 3, 4, 5]); ax.set_xlabel("fifth of the play (1 = first moves, 5 = last)")',
    '    ax.set_ylabel("mean balanced-KPI score (1 = all KPIs at optimum)")',
    '    ax.set_title(title); ax.legend()',
    '    fig.tight_layout()',
    '',
    '# Figure 3 - the balanced-KPI score during play, strict top definition',
    'traj("top_strict", "Balanced-KPI score during play - top (reached max) vs rest")',
    '# Figure 4 - the same with the relaxed (within-5%) definition',
    'traj("top_5pct", "Balanced-KPI score during play - top (within 5% of max) vs rest")',
    '',
    'def dec2(colname, ylab):',
    '    """One decile-resolution two-panel trajectory (strict | within-5%), top vs',
    '    rest with +-1 SE bars, for any per-move score column of bal."""',
    '    fig, axs = plt.subplots(1, 2, figsize=(10, 4), sharey=True)',
    '    for ax, flag, ttl in ((axs[0], "top_strict", "top = reached max"), (axs[1], "top_5pct", "top = within 5% of max")):',
    '        for v, c, lab in ((1, BLUE, "top"), (0, GREY, "rest")):',
    '            g = bal[bal[flag] == v].groupby("bin10")[colname]',
    '            ax.errorbar(g.mean().index, g.mean(), yerr=g.std(ddof=1) / np.sqrt(g.count()), color=c, marker="o", capsize=2, label=lab)',
    '        ax.set_xticks(range(1, 11)); ax.set_xlabel("tenth of the play (1 = first moves, 10 = last)")',
    '        ax.set_title(ttl)',
    '    axs[0].set_ylabel(ylab); axs[0].legend()',
    '    fig.tight_layout()',
    '',
    '# Figure 5 - the balanced-KPI score at decile resolution ...',
    'dec2("kpi_avg", "mean balanced-KPI score")',
    '# ... and the same view under three alternative objective scores:',
    '# Figure 6 - the net-value objective alone',
    'dec2("s_net", "mean net-value attainment (s_net)")',
    '# Figure 7 - 50% net value + 50% ROI (s_roi = ROI/(1+ROI))',
    'dec2("mix_nr", "mean of s_net and s_roi")',
    '# Figure 8 - 1/3 net value + 1/3 ROI + 1/3 fitness',
    'dec2("mix_nrf", "mean of s_net, s_roi and s_fit")',
    '',
    '# Figure 9 - WHY balance differs: the three objectives separately, top vs rest',
    'fig, axs = plt.subplots(1, 2, figsize=(9, 4), sharey=True)',
    'for ax, v, ttl in ((axs[0], 1, "top players (strict)"), (axs[1], 0, "rest")):',
    '    g = bal[bal["top_strict"] == v].groupby("bin")[["s_net", "s_cov", "s_fit"]].mean()',
    '    ax.plot(g.index, g["s_net"], color=BLUE, marker="o", label="net value (s_net)")',
    '    ax.plot(g.index, g["s_cov"], color=ORANGE, marker="s", label="coverage (s_cov)")',
    '    ax.plot(g.index, g["s_fit"], color=GREY, marker="^", label="compactness (s_fit)")',
    '    ax.set_xticks([1, 2, 3, 4, 5]); ax.set_xlabel("fifth of the play"); ax.set_title(ttl)',
    'axs[0].set_ylabel("mean attainment (0-1)"); axs[0].legend()',
    'fig.tight_layout()',
    '',
    '# Figure 10 - the greedy trap: $/cell of the bricks placed, covering EVERY',
    '# placement but grouped for readability: individual placements when plays are',
    '# short, bins of 5 when players place up to ~40 bricks, bins of 10 beyond that',
    '# (long place/remove sessions produce 50+ placements and a raw per-k chart is',
    '# unreadable).',
    'fig, ax = plt.subplots(figsize=(7, 4))',
    'adds["top"] = adds["player"].map(top_strict)',
    'kmax = int(adds["k"].max())',
    'w = 1 if kmax <= 12 else (5 if kmax <= 40 else 10)          # bin width adapts to play length',
    'adds["kbin"] = ((adds["k"] - 1) // w + 1).astype(int)       # 1 = placements 1..w, 2 = w+1..2w, ...',
    'nb = int(adds["kbin"].max())',
    'for v, c, lab in ((1, BLUE, "top"), (0, GREY, "rest")):',
    '    g = adds[adds["top"] == v].groupby("kbin")["vpc"]',
    '    ax.errorbar(g.mean().index, g.mean(), yerr=g.std(ddof=1) / np.sqrt(g.count()), color=c, marker="o", capsize=3, label=lab)',
    'ax.set_xticks(range(1, nb + 1))',
    'ax.set_xticklabels([str(i) if w == 1 else f"{(i - 1) * w + 1}-{i * w}" for i in range(1, nb + 1)])',
    'ax.set_xlabel("k-th brick placed" if w == 1 else f"bricks placed (placement number, bins of {w})")',
    'ax.set_ylabel("mean $ value per cell of those bricks")',
    'ax.set_title("Do players chase the pricey-per-cell (trap) bricks first?")',
    'ax.legend()',
    'fig.tight_layout()',
    '',
    '# Figure 11 - how fast each candidate objective climbs per group (Section 5)',
    'fig, axs = plt.subplots(1, 2, figsize=(10, 4), sharey=True)',
    'x = np.arange(len(CANDS))',
    'for ax, flag, ttl in ((axs[0], top_strict, "top = reached max"), (axs[1], top_5pct, "top = within 5% of max")):',
    '    a = cons[cons["player"].map(flag) == 1]',
    '    b = cons[cons["player"].map(flag) == 0]',
    '    ax.bar(x - 0.2, [a[c].mean() for _, c in CANDS], width=0.36, color=BLUE, label="top")',
    '    ax.bar(x + 0.2, [b[c].mean() for _, c in CANDS], width=0.36, color=GREY, label="rest")',
    '    ax.set_xticks(x); ax.set_xticklabels(["net", "net+cov", "net+comp", "all 3"])',
    '    ax.set_xlabel("candidate objective"); ax.set_title(ttl)',
    'axs[0].set_ylabel("climb rate (points per move)"); axs[0].legend()',
    'fig.tight_layout()',
    '',
    '# Figure 12 - the two windows move by move: the opening aligned at move 1, the',
    '# approach aligned at the first peak (0 = the move the maximum was first hit).',
    'fig, axs = plt.subplots(1, 2, figsize=(10, 4), sharey=True)',
    'for v, c, lab in ((1, BLUE, "top"), (0, GREY, "rest")):',
    '    g = mv[(mv["top_strict"] == v) & (mv["in_open"] == 1)].groupby("move")["kpi_avg"]',
    '    axs[0].errorbar(g.mean().index, g.mean(), yerr=g.std(ddof=1) / np.sqrt(g.count()), color=c, marker="o", capsize=2, label=lab)',
    '    ap = mv[(mv["top_strict"] == v) & (mv["in_appr"] == 1)].copy()',
    '    ap["rel"] = ap["move"] - ap["peak_move"]               # -9 .. 0',
    '    g2 = ap.groupby("rel")["kpi_avg"]',
    '    axs[1].errorbar(g2.mean().index, g2.mean(), yerr=g2.std(ddof=1) / np.sqrt(g2.count()), color=c, marker="o", capsize=2, label=lab)',
    'axs[0].set_xticks(range(1, 11)); axs[0].set_xlabel("move number"); axs[0].set_title("opening: first 10 moves")',
    'axs[1].set_xticks(range(-9, 1)); axs[1].set_xlabel("moves before the first peak (0 = the peak move)")',
    'axs[1].set_title("approach: last 10 moves to the peak")',
    'axs[0].set_ylabel("mean balanced-KPI score"); axs[0].legend()',
    'fig.tight_layout()',
    '',
    'if ok7:',
    '    # Figure 13 - the heuristic profile as paired dots: each marker z-scored over',
    '    # ALL players, then the top-group mean (blue) vs the rest-group mean (grey).',
    '    fig, ax = plt.subplots(figsize=(7, 4))',
    '    for i, m in enumerate(MARKERS):',
    '        z = (plp[m] - plp[m].mean()) / plp[m].std(ddof=1) if plp[m].std(ddof=1) > 0 else plp[m] * 0',
    '        zt, zr = z[plp["top5"] == 1].mean(), z[plp["top5"] == 0].mean()',
    '        ax.plot([zr, zt], [i, i], color=GREY, lw=2, zorder=1)',
    '        ax.scatter([zt], [i], color=BLUE, s=45, zorder=2, label="top" if i == 0 else None)',
    '        ax.scatter([zr], [i], color=GREY, s=45, zorder=2, label="rest" if i == 0 else None)',
    '    ax.axvline(0, color=GREY, lw=1, ls=":")',
    '    ax.set_yticks(range(len(MARKERS))); ax.set_yticklabels(MARKERS); ax.invert_yaxis()',
    '    ax.set_xlabel("group mean, in SD units of all players (0 = the overall average)")',
    '    ax.set_title("The heuristic profile - top (within 5%) vs rest")',
    '    ax.legend()',
    '    fig.tight_layout()',
    '',
    '    # Figure 14 - which habits pay: within-5% success rate among the players who',
    '    # share each top habit vs those who do not (the Section-7 table as bars).',
    '    fig, ax = plt.subplots(figsize=(7, 4))',
    '    x = np.arange(len(ranked))',
    '    ax.bar(x - 0.2, [r[2] * 100 for r in ranked], width=0.36, color=BLUE, label="share the top habit")',
    '    ax.bar(x + 0.2, [r[3] * 100 for r in ranked], width=0.36, color=GREY, label="do not")',
    '    ax.set_xticks(x); ax.set_xticklabels([r[0] for r in ranked], rotation=20)',
    '    ax.set_ylabel("% of players within 5% of a maximum")',
    '    ax.set_title("Which habits pay (ranked by success-rate lift)")',
    '    ax.legend()',
    '    fig.tight_layout()',
    '',
    '    # Figure 15 - style vs outcome: one dot per player; x = how \'top-like\' their',
    '    # style is, y = their closest approach to a maximum; dashed line = the 95% bar.',
    '    fig, ax = plt.subplots(figsize=(7, 4))',
    '    for v, c, lab in ((1, BLUE, "top (within 5%)"), (0, GREY, "rest")):',
    '        s = plp[plp["top5"] == v]',
    '        ax.scatter(s["style"], s["best_ratio"] * 100, color=c, s=30, label=lab)',
    '    ax.axhline(95, color=GREY, lw=1, ls="--")',
    '    ax.set_xlabel("heuristic style score (higher = plays more like the top group)")',
    '    ax.set_ylabel("best peak, % of the puzzle maximum")',
    '    ax.set_title("Does playing \'top-like\' pay off?")',
    '    ax.legend()',
    '    fig.tight_layout()',
    '',
    '# ---- 7. the INSIGHTS write-up (rendered, with the figures, in Section 4) --------',
    'def gap(d, m):',
    '    """Top-minus-rest gap of marker m at difficulty d, at the player level."""',
    '    s = pl[pl["diff"] == d]',
    '    return s.loc[s["top_d"] == 1, m].mean() - s.loc[s["top_d"] == 0, m].mean()',
    'print()',
    'print("INSIGHTS")',
    'print("## Headline")',
    'print(f"- {len(top_strict)} players, {len(pp)} completed puzzles, {len(mv)} logged moves. "',
    '      f"{int(top_strict.sum())} players touched a puzzle maximum at least once (strict top); "',
    '      f"relaxing to \'within 5% of the maximum\' adds {int(top_5pct.sum()) - int(top_strict.sum())} more.")',
    'print("## What top players did differently")',
    'print(f"- On EASY puzzles, players who found the maximum made on average {gap(\'easy\',\'n_moves\'):+.1f} "',
    '      f"more moves, removed bricks {gap(\'easy\',\'rem_share\'):+.2f} more often (share of moves), and their "',
    '      f"first three bricks were {abs(gap(\'easy\',\'early_vpc\')):.2f} $/cell {\'CHEAPER\' if gap(\'easy\',\'early_vpc\') < 0 else \'PRICIER\'} than the rest\'s - "',
    '      f"see the Section-3 tables for the exact means and p-values.")',
    'print(f"- On HARD puzzles the same fingerprint holds ({gap(\'hard\',\'n_moves\'):+.1f} moves, "',
    '      f"{gap(\'hard\',\'rem_share\'):+.2f} removal share, {gap(\'hard\',\'early_vpc\'):+.2f} $/cell early bricks); "',
    '      f"regression R1 shows which of these survive jointly, per SD, with player-clustered inference.")',
    'print("- Reading the markers as HEURISTICS: n_moves = exploration volume; rem_share = treating "',
    '      "placements as reversible experiments (every removal is a deliberate, temporary net sacrifice); "',
    '      "early_vpc = ratio-chasing - a NEGATIVE top-minus-rest gap means top players resist the "',
    '      "pricey-per-cell trap bricks (check its sign in the tables and in Figure 10).")',
    'print("## Easy vs hard")',
    'print(f"- Across ALL players, hard puzzles took {pl.loc[pl[\'diff\']==\'hard\',\'n_moves\'].mean() - pl.loc[pl[\'diff\']==\'easy\',\'n_moves\'].mean():+.1f} "',
    '      f"moves and {pl.loc[pl[\'diff\']==\'hard\',\'sec_move\'].mean() - pl.loc[pl[\'diff\']==\'easy\',\'sec_move\'].mean():+.1f} s/move versus easy ones; the easy-vs-hard "',
    '      "table in Section 3 gives the p-values. The top-vs-rest gaps point the same way at both "',
    '      "difficulties (Figure 1), so the heuristics look GENERAL rather than difficulty-specific - "',
    '      "hard puzzles mainly demand MORE of the same exploration.")',
    'print("## Figure 1 - The heuristic fingerprint")',
    'print("Each bar is the standardised (Cohen\'s d) top-minus-rest difference in one behavioural marker; "',
    '      "blue = easy, orange = hard puzzles. Bars right of zero mean top players show MORE of that marker. "',
    '      "Long bars on n_moves / rem_share and a long NEGATIVE bar on early_vpc are the "',
    '      "\'explore, backtrack, and do not chase $/cell\' fingerprint; if easy and hard bars point the same "',
    '      "way, the heuristic generalises across difficulty.")',
    'print("## Figure 2 - the same fingerprint under the within-5% definition")',
    'print("Identical to Figure 1, but \'top\' = came within 5% of that difficulty\'s maximum at least once. "',
    '      "If the bars keep their sign and only shrink, the winning heuristics are a shared STYLE of the "',
    '      "near-optimal players too, not a lucky final move; the Section-3 output prints the exact means "',
    '      "and p-values for this definition as well (and regression R1b repeats R1 for it).")',
    'print("## The balanced-KPI hypothesis (H1)")',
    'print("- THE METRIC, built exactly as specified: after every move each KPI is compared to ITS OPTIMAL "',
    '      "value (net -> (net+16)/(best+16), coverage -> /100, compactness -> /100) and the discrepancies "',
    '      "are AVERAGED across the KPIs into one balanced-KPI score for that move; a puzzle\'s moves are "',
    '      "then averaged, and a player\'s puzzles are averaged per difficulty - giving how well each user "',
    '      "plays ACROSS the KPIs on an average move of an average puzzle.")',
    'r_se = ucmp("easy", top_strict); r_sh = ucmp("hard", top_strict)',
    'if r_se and r_sh:',
    '    print(f"- PLAYER-LEVEL RESULT (strict definition): on EASY puzzles the average top user scores "',
    '          f"{r_se[0]:.3f} vs {r_se[1]:.3f} for the average non-top user (gap {r_se[0] - r_se[1]:+.3f}, p = {r_se[2]:.4f}); "',
    '          f"on HARD puzzles {r_sh[0]:.3f} vs {r_sh[1]:.3f} (gap {r_sh[0] - r_sh[1]:+.3f}, p = {r_sh[2]:.4f}). "',
    '          f"A positive, significant gap supports H1 at the player level; the within-5% rows of the same "',
    '          f"table show whether it survives the relaxed definition.")',
    'else:',
    '    print("- PLAYER-LEVEL RESULT: one of the groups is too small for the comparison - see the table in "',
    '          "Section 4 of the output and re-run once more sessions are loaded.")',
    'print("- TEST DESIGN, move level: kpi_avg regressed on the top flag, play progress, their interaction "',
    '      "and - crucially - the net level s_net, with SEs clustered on player. The \'top player\' row in R2 "',
    '      "is the gap AT EQUAL net attainment and stage of play, i.e. whether the OTHER objectives are "',
    '      "closer to their optima; \'top x progress\' says whether that gap widens as play unfolds. R3 "',
    '      "relaxes who counts as top (within 5%), R4 drops the moves at the maximum itself (where the "',
    '      "score is 1 by construction), and R5 swaps in the EVENNESS outcome (1 - SD across the KPIs) - if "',
    '      "R2 and R5 agree, the finding does not hinge on how \'balanced\' is defined.")',
    'print("## Figure 3 - the balanced-KPI score during play (strict top definition)")',
    'print("Mean per-move balanced-KPI score in each fifth of the play, top (blue) vs rest (grey), with "',
    '      "+-1 SE bars. A score near 1 means net value, coverage and compactness are ALL close to their "',
    '      "optimal values. A blue line sitting above the grey one - especially in the middle fifths, "',
    '      "before anyone reaches the optimum - is H1 in picture form.")',
    'print("## Figure 4 - the same picture with the relaxed (within-5%) definition")',
    'print("If this looks like Figure 3, the finding is not an artefact of the strict cut-off: players who "',
    '      "merely came close to the maximum share the balanced style. If the gap disappears here, "',
    '      "\'balance\' distinguishes only the very best plays.")',
    'print("## Figure 5 - the balanced-KPI score at 10% resolution")',
    'print("The same trajectories as Figures 3-4 but per TENTH of the play instead of fifths - left panel: "',
    '      "top = reached the maximum; right panel: top = within 5% of it. The finer grid shows WHEN the "',
    '      "groups separate (right from the opening moves, or only in the endgame); bars are +-1 SE, and a "',
    '      "tenth in which a group happens to have no moves is simply skipped. The tables behind both "',
    '      "resolutions are printed in the Section-3 output.")',
    'print("## Figure 6 - the net-value objective alone, at 10% resolution")',
    'print("The same two panels as Figure 5 but tracking ONLY net-value attainment (s_net = (Net+16)/(Best+16)) "',
    '      "- the game\'s stated objective. If the groups separate here, the top players are simply ahead on "',
    '      "the scoreboard itself; comparing this picture with Figures 7 and 8 shows how the gap changes once "',
    '      "the other KPIs enter the score.")',
    'print("## Figure 7 - 50% net value + 50% ROI, at 10% resolution")',
    'print("The score is the even mix of net-value attainment and ROI attainment, where ROI attainment = "',
    '      "Total Value / (Total Value + Resource Cost) - a bounded 0-1 rescaling of the Value/Resource (ROI) "',
    '      "KPI equal to ROI/(1+ROI), so 0 = empty board and 1 = zero empty-cell penalty (the raw KPI divides "',
    '      "by zero at full coverage, this form does not). If the top-vs-rest gap widens here relative to "',
    '      "Figure 6, top players carry an efficiency edge beyond the scoreboard.")',
    'print("## Figure 8 - 1/3 net value + 1/3 ROI + 1/3 fitness, at 10% resolution")',
    'print("The even three-way mix adds the Portfolio Fitness (compactness) KPI (/100) to net value and ROI. "',
    '      "Note this is a DIFFERENT composite from the balanced-KPI score of Figure 5, which uses coverage "',
    '      "as the resource objective; comparing Figures 5-8 shows which ingredient - the scoreboard, "',
    '      "efficiency, or geometry - the top players\' advantage flows through, and at which stage of play.")',
    'print("## Figure 9 - the three objectives separately (what drives the score)")',
    'print("The three attainments (net = blue, coverage = orange, compactness = grey) over the fifths of "',
    '      "play, top players on the left, rest on the right. Parallel, close-together lines = an even "',
    '      "profile; a wide fan = lopsided play. The typical greedy pattern is a coverage line that lags "',
    '      "far below the others - value piles up on pricey bricks while the board stays empty.")',
    'print("## Figure 10 - the greedy trap in one picture")',
    'print("Mean $ value per cell of EVERY brick placed (the 1st, 2nd, ... k-th placement) - a brick\'s Brick Value divided by "',
    '      "the number of cells it occupies. Two terms NOT to confuse with the on-screen KPIs: this $/cell "',
    '      "is a PER-BRICK price density, not the Value/Resource (ROI) KPI (which divides the whole "',
    '      "portfolio\'s Total Value by the empty-cell penalty); and \'completing the board\' below means "',
    '      "GEOMETRIC fit, not the Portfolio Fitness compactness KPI. The game is built so the bricks with "',
    '      "the highest $/cell are traps: a grey (rest) line starting high and falling = ratio-greedy "',
    '      "ordering (grab the priciest-per-cell bricks first), while a flatter blue (top) line = top "',
    '      "players picking bricks for how well they complete the board rather than for their price per "',
    '      "cell - one of the clearest heuristics separating the groups. Later placements exist only for "',
    '      "the players who made that many, so the error bars naturally widen along the tail; and when "',
    '      "plays run long, placements are grouped into bins of 5 or 10 (see the axis labels) so the chart "',
    '      "stays readable - each point is then the mean over that bin of placements.")',
    'print("## Focused or diversified: which objective does play track?")',
    'print("- THE TEST (Section 5 of the output): candidate objectives are net value alone, net + coverage, "',
    '      "net + compactness, and all three together (each = the mean of its KPIs\' 0-100 attainment "',
    '      "scores). For every player we measure each candidate\'s per-move CLIMB RATE; the group means say "',
    '      "which objective each group\'s play is de-facto optimising. (In this game every placement raises "',
    '      "net value and coverage mechanically, so what separates the candidates is whether compactness "',
    '      "keeps pace.) The FOCUS GAP - net-only climb minus all-three climb - is positive for net-focused "',
    '      "play and negative for diversified play.")',
    'if fo_s:',
    '    print(f"- RESULT: under the strict definition the top users\' focus gap is {fo_s[0]:+.3f} (p vs 0 = {p4(fo_s[1])})"',
    '          + (f"; under the within-5% definition it is {fo_5[0]:+.3f} (p vs 0 = {p4(fo_5[1])})" if fo_5 else "")',
    '          + ". A significantly NEGATIVE gap says the best players raise the balanced bundle at least as "',
    '            "fast as net value - diversified play; a significantly POSITIVE gap says their net value "',
    '            "races ahead of their other KPIs - net-value maximisers first.")',
    'else:',
    '    print("- RESULT: not enough players in one of the groups yet - see Section 5 of the output.")',
    'print("## Figure 11 - how fast each candidate objective climbs, per group")',
    'print("Grouped bars: the mean per-move climb (attainment points) of each candidate objective, top "',
    '      "(blue) vs rest (grey); left panel = strict definition, right = within-5%. Read it two ways: "',
    '      "within a group, the tallest bar is the objective that group\'s play raises fastest; between "',
    '      "groups, compare how much the bars SHRINK from \'net\' to \'all 3\' - a big drop means compactness "',
    '      "lags behind net (focused play), similar heights mean all objectives advance together "',
    '      "(diversified play).")',
    'print("## The opening vs the approach to the peak")',
    'print("- THE WINDOWS (Section 6 of the output): the OPENING = each play\'s first 10 moves; the "',
    '      "APPROACH = the last 10 moves up to and including the move where the player FIRST reached "',
    '      "their own maximum net value of that puzzle (if the same maximum was hit more than once, only "',
    '      "the first time counts). Comparing the two says whether top players differ from the very start "',
    '      "or pull away while closing in on their peak.")',
    'r_o = wcmp(ws_open, top_strict, "kpi_avg"); r_a = wcmp(ws_appr, top_strict, "kpi_avg")',
    'if r_o and r_a:',
    '    print(f"- RESULT (strict definition, balanced-KPI score): in the OPENING the average top user scores "',
    '          f"{r_o[0]:.3f} vs {r_o[1]:.3f} for the rest (gap {r_o[0] - r_o[1]:+.3f}, p = {p4(r_o[2])}); in the "',
    '          f"APPROACH {r_a[0]:.3f} vs {r_a[1]:.3f} (gap {r_a[0] - r_a[1]:+.3f}, p = {p4(r_a[2])}). Section 6 "',
    '          f"prints the full tables - net climb, removals, $/cell and pace - for both windows and both "',
    '          f"top definitions.")',
    'else:',
    '    print("- RESULT: one of the groups is too small for the window comparison yet - see Section 6 of the output.")',
    'print("## Figure 12 - the two windows, move by move")',
    'print("Left: the first 10 moves, aligned at move 1. Right: the last 10 moves before the first peak, "',
    '      "aligned so 0 = the move the maximum was first reached. Lines are the mean balanced-KPI score at "',
    '      "each aligned move, top (blue) vs rest (grey), with +-1 SE bars (strict definition; the Section-6 "',
    '      "tables also cover within-5%). Diverging lines on the left mean top players play differently from "',
    '      "the very start; diverging lines on the right mean the difference emerges in how they close in on "',
    '      "the peak.")',
    'print("## The within-5% playbook: how the top players actually played")',
    'if ok7:',
    '    print(f"- THE TYPICAL TOP PLAYER (within 5% of a maximum at least once): "',
    '          f"{plp.loc[plp[\'top5\'] == 1, \'n_moves\'].mean():.1f} moves per puzzle, {plp.loc[plp[\'top5\'] == 1, \'rem_share\'].mean() * 100:.0f}% of them removals, "',
    '          f"first-3 bricks at ${plp.loc[plp[\'top5\'] == 1, \'early_vpc\'].mean():.2f}/cell, {plp.loc[plp[\'top5\'] == 1, \'early_cov\'].mean() * 100:.0f}% of the board covered by move 3, "',
    '          f"{plp.loc[plp[\'top5\'] == 1, \'sec_move\'].mean():.1f} s per move, first peak {plp.loc[plp[\'top5\'] == 1, \'peak_at\'].mean() * 100:.0f}% of the way in. "',
    '          f"THE TYPICAL REST PLAYER: {plp.loc[plp[\'top5\'] == 0, \'n_moves\'].mean():.1f} moves, {plp.loc[plp[\'top5\'] == 0, \'rem_share\'].mean() * 100:.0f}% removals, "',
    '          f"${plp.loc[plp[\'top5\'] == 0, \'early_vpc\'].mean():.2f}/cell early bricks, {plp.loc[plp[\'top5\'] == 0, \'early_cov\'].mean() * 100:.0f}% early coverage, "',
    '          f"{plp.loc[plp[\'top5\'] == 0, \'sec_move\'].mean():.1f} s per move, first peak {plp.loc[plp[\'top5\'] == 0, \'peak_at\'].mean() * 100:.0f}% of the way in.")',
    '    if len(ranked) > 1:',
    '        print(f"- THE HABITS THAT PAID MOST (success-rate lift when a player shares the top group\'s side of "',
    '              f"a habit): 1st {ranked[0][0]} ({\'higher\' if ranked[0][1] > 0 else \'lower\'} than the median): "',
    '              f"{ranked[0][2] * 100:.0f}% of sharers got within 5% vs {ranked[0][3] * 100:.0f}% of the others "',
    '              f"(lift {ranked[0][4] * 100:+.0f} points, p = {p4(ranked[0][5])}); 2nd {ranked[1][0]} "',
    '              f"({\'higher\' if ranked[1][1] > 0 else \'lower\'}): {ranked[1][2] * 100:.0f}% vs {ranked[1][3] * 100:.0f}% "',
    '              f"(lift {ranked[1][4] * 100:+.0f} points, p = {p4(ranked[1][5])}). The full ranking is the "',
    '              f"Section-7 table and Figure 14.")',
    '    if r_sc:',
    '        print(f"- STYLE PAYS AS A PACKAGE: a one-number style score (all six habits, oriented towards the "',
    '              f"top group and averaged) correlates with a player\'s closest approach to the maximum at "',
    '              f"r = {r_sc[0]:.3f} (p = {p4(r_sc[1])}) - see Figure 15.")',
    '    print("- WHY THESE MECHANISMS WORK (whichever direction your data shows, this is what each habit "',
    '          "measures): early_vpc is ratio-greed - the game\'s priciest-per-cell bricks are designed traps "',
    '          "that block the single full-cover optimum; rem_share is reversibility - reaching the optimum "',
    '          "usually means undoing a locked-in arrangement, so removals are invested, not wasted, moves; "',
    '          "n_moves and sec_move are exploration and deliberation - information about which bricks fit "',
    '          "together is bought with moves and time; early_cov is option preservation - grabbing board "',
    '          "space early narrows what can still be placed; peak_at separates late graft (peak found near "',
    '          "the end of a long search) from early luck.")',
    'else:',
    '    print("- Not enough players in one of the groups yet for the within-5% playbook - load more sessions "',
    '          "and re-run (Section 7 of the output).")',
    'print("## Figure 13 - the heuristic profile at a glance")',
    'print("Each row is one habit, z-scored across ALL players so the habits share one scale; the blue dot "',
    '      "is the top group\'s average (within-5% definition), the grey dot the rest\'s, and the line between "',
    '      "them is the gap. Dots far apart = a habit that separates the groups strongly; dots on opposite "',
    '      "sides of the dotted zero line = the groups sit on opposite sides of the overall average.")',
    'print("## Figure 14 - which habits pay")',
    'print("For each habit, the share of players who got within 5% of a maximum among those who SHARE the "',
    '      "top group\'s side of that habit (blue) vs those who do not (grey), ranked left-to-right by the "',
    '      "lift. A tall blue bar over a short grey one marks a habit that genuinely travels with success; "',
    '      "similar bars mean the habit is style, not substance. The p-values are in the Section-7 table.")',
    'print("## Figure 15 - does playing \'top-like\' pay off?")',
    'print("One dot per player: x = the heuristic style score (all six habits oriented towards the top "',
    '      "group and averaged - higher means playing more like the top players), y = that player\'s closest "',
    '      "approach to a puzzle maximum (best peak as % of Best Value). The dashed line is the 95% bar that "',
    '      "defines the top group. An upward-sloping cloud says the playbook works as a package; blue dots "',
    '      "far left or grey dots far right are the interesting exceptions worth a closer look.")',
    'print("## Other ways to probe this (suggestions)")',
    'print("- Survival analysis: time (in moves) until first touching the maximum, Cox or discrete-time "',
    '      "logit, with the balance of the CURRENT board as a time-varying covariate.")',
    'print("- More functional forms: a Rawlsian score min(s_net, s_cov, s_fit) (\'raise the worst "',
    '      "objective\'), or entropy of the normalised scores, next to the average (kpi_avg) and evenness "',
    '      "(kpi_even) already reported - conclusions should not depend on the choice.")',
    'print("- Sequence mining: classify each move add/remove and look for recurring n-grams (e.g. "',
    '      "add-add-remove-add \'probe\' patterns) that separate top players.")',
    'print("- Player random effects (mixed model) instead of clustered OLS, and puzzle fixed effects to "',
    '      "absorb puzzle-specific difficulty beyond easy/hard.")',
    'print("- A placebo test: re-run R2 with a fake \'top\' flag drawn at random with the same prevalence - "',
    '      "the top coefficient should collapse to zero.")',
    'print("## The verdict: one KPI, or balanced across KPIs?")',
    '# One row per player (both difficulties pooled), carrying the per-KPI attainments,',
    '# the balanced-KPI score and the evenness - all built move -> puzzle -> player.',
    'uv = uavg.groupby("player", as_index=False)[["kpi", "even", "v_net", "v_cov", "v_fit"]].mean()',
    'KPI_NAMES = {"v_net": "net value", "v_cov": "coverage", "v_fit": "compactness"}',
    'vt = uv[uv["player"].map(top_strict) == 1]   # the best players (strict definition)',
    'vr = uv[uv["player"].map(top_strict) == 0]   # everyone else',
    'if len(vt) > 1 and len(vr) > 1 and pd.concat([vt["even"], vr["even"]]).std(ddof=1) > 1e-12 and pd.concat([vt["kpi"], vr["kpi"]]).std(ddof=1) > 1e-12:',
    '    for g, nm in ((vt, "TOP players"), (vr, "The rest")):',
    '        m = {k: g[k].mean() for k in ("v_net", "v_cov", "v_fit")}',
    '        hi, lo = max(m, key=m.get), min(m, key=m.get)',
    '        print(f"- {nm}: net value {m[\'v_net\']:.3f}, coverage {m[\'v_cov\']:.3f}, compactness {m[\'v_fit\']:.3f} - "',
    '              f"strongest: {KPI_NAMES[hi]}, weakest: {KPI_NAMES[lo]}, spread {m[hi] - m[lo]:.3f} "',
    '              f"(a LARGE spread = play focused on one KPI; a SMALL spread = balanced play).")',
    '    ge, pe = vt["even"].mean() - vr["even"].mean(), st.ttest_ind(vt["even"], vr["even"], equal_var=False).pvalue',
    '    gk, pk = vt["kpi"].mean() - vr["kpi"].mean(), st.ttest_ind(vt["kpi"], vr["kpi"], equal_var=False).pvalue',
    '    print(f"- The two numbers that decide it (top minus rest, per-player values, Welch t): "',
    '          f"EVENNESS gap {ge:+.3f} (p = {pe:.4f}) - is the best players\' KPI profile more even? - and "',
    '          f"balanced-KPI score gap {gk:+.3f} (p = {pk:.4f}) - are they closer to the optima across the board?")',
    '    if fo_s:',
    '        w = ("DIVERSIFIED - the balanced bundle climbs at least as fast as net value alone"',
    '             if (np.isfinite(fo_s[1]) and fo_s[1] < 0.05 and fo_s[0] < 0)',
    '             else ("NET-FOCUSED - their net value climbs faster than their other KPIs"',
    '                   if (np.isfinite(fo_s[1]) and fo_s[1] < 0.05 and fo_s[0] > 0)',
    '                   else "neither clearly net-focused nor clearly diversified"))',
    '        rel = ""',
    '        if np.isfinite(fo_s[3]) and fo_s[3] < 0.05:',
    '            rel = f" Compared to the rest they are {\'LESS\' if fo_s[2] < 0 else \'MORE\'} net-focused (gap difference {fo_s[2]:+.3f}, p = {p4(fo_s[3])})."',
    '        print(f"- OBJECTIVE TEST: by per-move climb rates (Section 5, Figure 11), the best players look {w}.{rel}")',
    '    if ge > 0 and pe < 0.05 and gk > 0 and pk < 0.05:',
    '        print("- VERDICT: BALANCED. The best players are not chasing a single KPI: their profile across net "',
    '              "value, coverage and compactness is significantly MORE EVEN than the rest\'s AND they sit "',
    '              "significantly closer to the optima across all KPIs. Winning play here means managing the "',
    '              "whole dashboard, not maximising one number.")',
    '    elif ge < 0 and pe < 0.05 and gk > 0 and pk < 0.05:',
    '        print("- VERDICT: FOCUSED BUT EFFECTIVE. The best players do score closer to the optima on average, "',
    '              "but their profile is significantly LESS even than the rest\'s - their advantage runs through "',
    '              "one dominant KPI (their \'strongest\' above) rather than through balanced play.")',
    '    elif gk > 0 and pk < 0.05:',
    '        print("- VERDICT: PARTLY BALANCED. The best players are significantly closer to the optima across "',
    '              "the KPIs on average, but the evenness gap is not statistically significant - with the players "',
    '              "collected so far the data cannot separate \'better at everything\' from \'more balanced\'. "',
    '              "Load more sessions and re-run to sharpen this.")',
    '    elif ge > 0 and pe < 0.05:',
    '        print("- VERDICT: MORE EVEN, NOT CLOSER. The best players spread their attainment significantly "',
    '              "more evenly across net value, coverage and compactness, but their average closeness to the "',
    '              "optima is not significantly higher - what distinguishes them is the BALANCE of their play, "',
    '              "not overall dominance of every KPI.")',
    '    else:',
    '        print("- VERDICT: NO CLEAR SIGNAL. With the players collected so far, neither a significantly more "',
    '              "even KPI profile nor significantly closer-to-optimum play separates the best players from "',
    '              "the rest (the exact gaps and p-values are in the line above) - load more sessions and re-run.")',
    'else:',
    '    print("- VERDICT: not enough players in one of the groups to compare yet - load more sessions and re-run.")',
    'print()',
    'print("Done. The figures are rendered in the \'Insights gained\' section below.")'
  ].join('\n');

  var DA_R_TEMPLATE = [
    '# ==============================================================================',
    '# PORTFOLIOFIT - WHAT DO TOP PLAYERS DO DIFFERENTLY, AND DO THEY BALANCE ALL KPIs?',
    '# ==============================================================================',
    '# This is the R twin of the Python template: it computes the SAME numbers with',
    '# base R only. Read the Python template\'s long header for the full story; in',
    '# brief:',
    '#   Data      the page always writes the two sheets this analysis needs as',
    '#             /tmp/playlog.csv (one row per brick move, KPIs before/after) and',
    '#             /tmp/rounds.csv (one row per completed puzzle, with Difficulty',
    '#             and the puzzle maximum \'Best Value\'). The table picked above is',
    '#             also at /tmp/data.csv, but this script does not use it.',
    '#   TOP       strict = touched the maximum net value on >=1 puzzle AT LEAST',
    '#             ONCE DURING PLAY; relaxed = came within 5% of the maximum.',
    '#   BALANCED KPIs  the six on-screen KPIs collapse to three INDEPENDENT',
    '#             objectives (Resource Cost is an inverse rescaling of Coverage;',
    '#             Value/Resource is a ratio of the others and undefined at full',
    '#             coverage; both excluded). After every move each objective is',
    '#             compared to ITS OPTIMAL value:',
    '#               s_net = (Net + 16) / (Best + 16)   net-value attainment',
    '#               s_cov = Coverage / 100             resource utilisation',
    '#               s_fit = Portfolio Fitness / 100    geometric compactness',
    '#             kpi_avg  = mean of the three = the BALANCED-KPI SCORE (1 = every',
    '#                        KPI at its optimum; 1 - kpi_avg = the average',
    '#                        discrepancy from the optima), averaged move -> puzzle',
    '#                        -> player so the AVERAGE top user can be compared with',
    '#                        the AVERAGE non-top user, per difficulty.',
    '#             kpi_even = 1 - population SD of the three = EVENNESS.',
    '#   Output    (1) data + top counts, (2) heuristic markers top-vs-rest per',
    '#             difficulty + easy-vs-hard, (3) regression R1 (which heuristics',
    '#             predict finding the maximum), (4) the balanced-KPI hypothesis',
    '#             H1: the player-level top-vs-rest comparison (both definitions,',
    '#             easy + hard), then regressions R2 (strict), R3 (relaxed),',
    '#             R4 (robustness, moves at the maximum excluded), R5 (evenness',
    '#             outcome), all with player-clustered CR1 SEs, (5) a revealed-',
    '#             objective test: the per-move CLIMB RATE of candidate objectives',
    '#             (net only vs balanced bundles) per group, with the FOCUS GAP',
    '#             (net-only climb minus all-three climb) deciding net-focused vs',
    '#             diversified play, (6) the OPENING (first 10 moves) and the',
    '#             APPROACH (last 10 moves up to and including the FIRST time the',
    '#             player hit their own maximum net value) compared top-vs-rest',
    '#             under both definitions, (7) the WITHIN-5% PLAYBOOK: per-group',
    '#             heuristic profiles, a ranking of which habits travel with',
    '#             success (two-proportion tests) and a style-vs-outcome',
    '#             correlation, (8) fifteen figures in numerical order, incl.',
    '#             three extra decile views of the trajectories under alternative',
    '#             objective scores (net only; 50% net + 50% ROI; 1/3 net + 1/3',
    '#             ROI + 1/3 fitness, ROI attainment = Total Value / (Total Value',
    '#             + Resource Cost)) + a data-driven INSIGHTS',
    '#             write-up (rendered, with the figures, in the \'Insights gained\'',
    '#             section), ending with a VERDICT: are the best players focused on',
    '#             one KPI, or balancing across the KPIs, compared to the rest?',
    '#             Every top-vs-rest comparison runs under BOTH definitions, and',
    '#             trajectories are shown at fifth- and tenth-of-play resolution.',
    '',
    '# ---- 0. load the two sheets the page hands over ------------------------------',
    'for (f in c("/tmp/playlog.csv", "/tmp/rounds.csv")) {',
    '  if (!file.exists(f) || file.info(f)$size < 10)',
    '    stop("This analysis needs BOTH the \'Play log\' and \'Rounds\' sheets. In Section 1, load sessions (or import a full Excel export) that contain them, then Run again.")',
    '}',
    'options(warn = -1)                     # keep the report clean (remove to debug)',
    'moves  <- read.csv("/tmp/playlog.csv", check.names = FALSE, stringsAsFactors = FALSE)  # one row per brick move',
    'rounds <- read.csv("/tmp/rounds.csv",  check.names = FALSE, stringsAsFactors = FALSE)  # one row per completed puzzle',
    '',
    '# Find a real column by any candidate name, ignoring case/spacing/punctuation.',
    'col <- function(df, ...) {',
    '  want <- gsub("[^a-z0-9]", "", tolower(unlist(list(...))))',
    '  have <- gsub("[^a-z0-9]", "", tolower(names(df)))',
    '  for (w in want) { i <- match(w, have); if (!is.na(i)) return(names(df)[i]) }',
    '  NA_character_',
    '}',
    'for (need in list(list(moves, c("Player", "Session", "Puzzle", "Action", "Move #", "Brick Value", "Cells", "Duration (s)", "Net Value (before)", "Net Value (after)", "Total Value (after)", "Resource Cost (after)", "Coverage % (before)", "Coverage % (after)", "Portfolio Fitness (before)", "Portfolio Fitness (after)")),',
    '                  list(rounds, c("Player", "Session", "Difficulty", "Best Value")))) {',
    '  bad <- need[[2]][sapply(need[[2]], function(n) is.na(col(need[[1]], n)))]',
    '  if (length(bad)) stop("A needed column is missing: ", paste(bad, collapse = ", "), ". Load an export made by this admin (Play log + Rounds sheets).")',
    '}',
    'num <- function(x) suppressWarnings(as.numeric(x))   # tolerant numeric coercion',
    '',
    '# ---- 1. canonical move table --------------------------------------------------',
    '# mv: one row per add/remove. \'player\' = Player|Session so the same label from',
    '# two different sessions never merges into one person.',
    'mv <- data.frame(',
    '  player    = paste0(moves[[col(moves, "Player")]], "|", moves[[col(moves, "Session")]]),',
    '  puzzle    = as.character(moves[[col(moves, "Puzzle")]]),',
    '  action    = tolower(trimws(moves[[col(moves, "Action")]])),',
    '  move      = num(moves[[col(moves, "Move #")]]),                          # 1,2,3... within the puzzle',
    '  brick_val = num(moves[[col(moves, "Brick Value")]]),                     # $ value of the brick moved',
    '  cells     = nchar(gsub("[^[]", "", moves[[col(moves, "Cells")]])) - 1,   # brick size = number of [r,c] pairs',
    '  sec       = num(moves[[col(moves, "Duration (s)")]]),                    # seconds since the previous move',
    '  net_b     = num(moves[[col(moves, "Net Value (before)")]]),',
    '  net_a     = num(moves[[col(moves, "Net Value (after)")]]),',
    '  val_a     = num(moves[[col(moves, "Total Value (after)")]]),',
    '  cost_a    = num(moves[[col(moves, "Resource Cost (after)")]]),',
    '  cov_b     = num(moves[[col(moves, "Coverage % (before)")]]),',
    '  cov_a     = num(moves[[col(moves, "Coverage % (after)")]]),',
    '  fit_b     = num(moves[[col(moves, "Portfolio Fitness (before)")]]),',
    '  fit_a     = num(moves[[col(moves, "Portfolio Fitness (after)")]]),',
    '  stringsAsFactors = FALSE)',
    'mv <- mv[mv$action %in% c("add", "remove"), ]          # keep real moves, drop \'start\' rows',
    '',
    '# rd: one fact row per player-puzzle from Rounds - its difficulty + Best Value.',
    'd0 <- substr(trimws(tolower(rounds[[col(rounds, "Difficulty")]])), 1, 1)',
    'rd <- data.frame(',
    '  player = paste0(rounds[[col(rounds, "Player")]], "|", rounds[[col(rounds, "Session")]]),',
    '  puzzle = as.character(rounds[[col(rounds, "Puzzle ID", "Puzzle")]]),',
    '  diff   = ifelse(d0 == "e", "easy", ifelse(d0 == "h", "hard", NA)),',
    '  best   = num(rounds[[col(rounds, "Best Value")]]),',
    '  stringsAsFactors = FALSE)',
    'rd <- rd[complete.cases(rd), ]',
    'rd <- rd[!duplicated(rd[, c("player", "puzzle")]), ]',
    '',
    '# the join: keeps only moves belonging to a completed main-game puzzle (training',
    '# has no Rounds row and drops out here); then sort into true play order.',
    'mv <- merge(mv, rd, by = c("player", "puzzle"))',
    'mv <- mv[order(mv$player, mv$puzzle, mv$move), ]',
    'if (!nrow(mv)) stop("No moves matched a completed puzzle - check that the Play log and Rounds sheets come from the same sessions.")',
    '',
    '# ---- 2. per-move KPI attainment scores and the BALANCE measure -----------------',
    'mv$s_net <- (mv$net_a + 16) / (mv$best + 16)   # net-value attainment, 0..1',
    'mv$s_cov <- mv$cov_a / 100                     # resource utilisation, 0..1',
    'mv$s_fit <- mv$fit_a / 100                     # compactness, 0..1 (NA on an empty board)',
    '# ROI attainment: a bounded 0-1 rescaling of the Value/Resource (ROI) KPI,',
    '# s_roi = Total Value / (Total Value + Resource Cost) = ROI / (1 + ROI) -',
    '# 0 = empty board, 1 = zero empty-cell penalty (the full-cover optimum). This',
    '# form stays defined at full coverage, where the raw KPI divides by zero.',
    'mv$s_roi <- mv$val_a / (mv$val_a + mv$cost_a)',
    'mv$mix_nr <- (mv$s_net + mv$s_roi) / 2         # 50% net value + 50% ROI',
    'mv$mix_nrf <- (mv$s_net + mv$s_roi + mv$s_fit) / 3   # 1/3 net + 1/3 ROI + 1/3 fitness',
    'S <- as.matrix(mv[, c("s_net", "s_cov", "s_fit")])     # the 3-KPI profile after each move',
    '# kpi_avg: the balanced-KPI score = mean attainment across the KPIs (so',
    '# 1 - kpi_avg = the average discrepancy of the KPIs from their optimal values).',
    '# kpi_even: 1 - population SD of the same three = evenness across the KPIs.',
    '# A move where a score is undefined (compactness on an emptied board) drops out.',
    'mv$kpi_avg <- rowMeans(S)',
    'mv$kpi_even <- 1 - sqrt(rowMeans((S - rowMeans(S))^2))',
    'mv$n_moves <- ave(mv$move, mv$player, mv$puzzle, FUN = max)   # moves in that play',
    'mv$progress <- mv$move / mv$n_moves            # how far through the play, (0..1]',
    'mv$bin <- pmin(ceiling(mv$progress * 5), 5)    # play split into fifths',
    'mv$bin10 <- pmin(ceiling(mv$progress * 10), 10)   # ... and into tenths (Figure 5)',
    'mv$is_rem <- as.numeric(mv$action == "remove") # 1 = removal',
    '# Per-move CHANGE in each KPI attainment (after minus before), for the',
    '# revealed-objective test of Section 5. NOTE a mechanical fact of this game:',
    '# every placement raises Net Value (by the brick\'s value + the cells it saves',
    '# from the penalty) and Coverage, and every removal lowers them - so "did the',
    '# move improve X" is the same yes/no for any net-anchored candidate. What CAN',
    '# differ is how FAST each objective climbs, so the test below compares each',
    '# candidate\'s per-move climb rate (in attainment points, x100). Scored only on',
    '# moves where EVERY delta is defined (the compactness of an empty board is',
    '# blank, so a puzzle\'s very first placement is excluded) - that way all',
    '# candidates are compared on the SAME set of moves.',
    'mv$d_net <- mv$s_net - (mv$net_b + 16) / (mv$best + 16)',
    'mv$d_cov <- mv$s_cov - mv$cov_b / 100',
    'mv$d_fit <- mv$s_fit - mv$fit_b / 100',
    'ok <- !is.na(mv$d_net) & !is.na(mv$d_cov) & !is.na(mv$d_fit)',
    'mv$u_net <- ifelse(ok, 100 * mv$d_net, NA)                              # points per move',
    'mv$u_nc  <- ifelse(ok, 100 * (mv$d_net + mv$d_cov) / 2, NA)',
    'mv$u_nf  <- ifelse(ok, 100 * (mv$d_net + mv$d_fit) / 2, NA)',
    'mv$u_all <- ifelse(ok, 100 * (mv$d_net + mv$d_cov + mv$d_fit) / 3, NA)',
    '',
    '# ---- 3. player-puzzle outcomes + the two top-player definitions ----------------',
    '# pp: one row per player-puzzle with its peak net reached DURING play.',
    'pp <- merge(unique(mv[, c("player", "puzzle", "diff", "best")]),',
    '            aggregate(net_a ~ player + puzzle, mv, max))',
    'names(pp)[names(pp) == "net_a"] <- "peak"',
    'pp$reached_max <- as.numeric(pp$peak >= pp$best)          # touched the optimum',
    'pp$within5     <- as.numeric(pp$peak >= 0.95 * pp$best)   # got within 5% of it',
    'top_strict <- tapply(pp$reached_max, pp$player, max)      # player flag, strict definition',
    'top_5pct   <- tapply(pp$within5,     pp$player, max)      # player flag, relaxed definition',
    'mv$top_strict <- as.numeric(top_strict[mv$player])',
    'mv$top_5pct   <- as.numeric(top_5pct[mv$player])',
    'mv$hard <- as.numeric(mv$diff == "hard")',
    '',
    'line <- function(ch = "-") cat(strrep(ch, 78), "\\n", sep = "")   # 78-char separator',
    '',
    'line("="); cat("1. DATA\\n"); line("=")',
    'cat(sprintf("Moves analysed: %d   player-puzzles: %d   players: %d\\n", nrow(mv), nrow(pp), length(unique(pp$player))))',
    'cat(sprintf("TOP (strict, touched the maximum on >=1 puzzle during play): %d of %d players\\n", sum(top_strict), length(top_strict)))',
    'cat(sprintf("TOP (relaxed, within 5%% of the maximum on >=1 puzzle):       %d of %d players\\n", sum(top_5pct), length(top_5pct)))',
    '',
    '# ---- 4. behavioural markers: HOW was each puzzle played? -----------------------',
    '# One row per player-puzzle; each marker is a simple, interpretable heuristic:',
    '#   n_moves    board changes made (exploration volume)',
    '#   rem_share  share of moves that were removals (willingness to backtrack)',
    '#   early_vpc  mean $/cell of the FIRST 3 bricks placed (ratio-chasing: the',
    '#              pricey-per-cell bricks are this game\'s deliberate traps)',
    '#   early_cov  share of the board covered after the 3rd move (early board-filling)',
    '#   sec_move   mean seconds per move (deliberation speed)',
    '#   peak_at    fraction of the play at which the player FIRST hit their own peak',
    '# (Removing a brick always cuts net value, so rem_share doubles as \'accepted',
    '#  temporary net losses\'; a separate net-dip marker would be collinear with it.)',
    'mk <- aggregate(cbind(rem_share = is_rem, sec_move = sec) ~ player + puzzle, mv,',
    '                function(v) mean(v, na.rm = TRUE), na.action = na.pass)',
    'mk <- merge(mk, unique(mv[, c("player", "puzzle", "diff", "n_moves")]))',
    'adds <- mv[mv$action == "add", ]                       # placements only, in play order',
    'adds$vpc <- adds$brick_val / adds$cells                # $ value per cell of that brick',
    'adds$k <- ave(rep(1, nrow(adds)), adds$player, adds$puzzle, FUN = cumsum)   # 1st, 2nd, ... placement',
    'mk <- merge(mk, setNames(aggregate(vpc ~ player + puzzle, adds[adds$k <= 3, ], mean), c("player", "puzzle", "early_vpc")), all.x = TRUE)',
    'mk <- merge(mk, setNames(mv[mv$move == pmin(mv$n_moves, 3), c("player", "puzzle", "s_cov")], c("player", "puzzle", "early_cov")), all.x = TRUE)',
    'mk <- merge(mk, pp[, c("player", "puzzle", "peak", "reached_max", "within5")])',
    'pkm <- merge(mv[, c("player", "puzzle", "move", "net_a")], pp[, c("player", "puzzle", "peak")])',
    'mk <- merge(mk, setNames(aggregate(move ~ player + puzzle, pkm[pkm$net_a >= pkm$peak, ], min), c("player", "puzzle", "peak_move")))',
    'mk$peak_at <- mk$peak_move / mk$n_moves',
    '',
    'MARKERS <- c("n_moves", "rem_share", "early_vpc", "early_cov", "sec_move", "peak_at")',
    '# pl: markers averaged to ONE ROW PER PLAYER x DIFFICULTY, so a player who',
    '# played more puzzles does not dominate the group comparisons below.',
    'pl <- aggregate(mk[, MARKERS], mk[, c("player", "diff")], function(v) mean(v, na.rm = TRUE))',
    '# per-difficulty top flags: reached the maximum / came within 5% of it on >= 1',
    '# puzzle OF THAT difficulty (so easy and hard status are judged separately)',
    'pl <- merge(pl, setNames(aggregate(reached_max ~ player + diff, mk, max), c("player", "diff", "top_d")))',
    'pl <- merge(pl, setNames(aggregate(within5 ~ player + diff, mk, max), c("player", "diff", "top5_d")))',
    '',
    'line("="); cat("2. HEURISTICS - what did the players who found the maximum do differently?\\n"); line("=")',
    'cat("Markers (one value per player x difficulty; group test = Welch t):\\n")',
    'cat("  n_moves   board changes made          rem_share  share of moves = removals\\n")',
    'cat("  early_vpc mean $/cell, first 3 bricks early_cov  board covered after 3 moves\\n")',
    'cat("  sec_move  mean seconds per move       peak_at    when own peak was first hit (0-1)\\n")',
    'D <- list()    # Cohen\'s d per (difficulty, marker), strict definition - Figure 1',
    'D5 <- list()   # the same under the within-5% definition - Figure 2',
    'for (defn in c("reached the maximum", "within 5% of the maximum")) {',
    '  flagcol <- if (defn == "reached the maximum") "top_d" else "top5_d"',
    '  for (d in c("easy", "hard")) {',
    '    a_n <- sum(pl$diff == d & pl[[flagcol]] == 1); b_n <- sum(pl$diff == d & pl[[flagcol]] == 0)',
    '    cat(sprintf("\\n--- %s puzzles: %s (n=%d) vs not (n=%d) ---\\n", toupper(d), defn, a_n, b_n))',
    '    cat(sprintf("%-11s%10s%11s%9s%9s\\n", "marker", "top mean", "rest mean", "diff", "p"))',
    '    for (m in MARKERS) {',
    '      a <- pl[pl$diff == d & pl[[flagcol]] == 1, m]; a <- a[!is.na(a)]',
    '      b <- pl[pl$diff == d & pl[[flagcol]] == 0, m]; b <- b[!is.na(b)]',
    '      if (length(a) > 1 && length(b) > 1 && (sd(a) > 1e-12 || sd(b) > 1e-12)) {',
    '        sp <- sqrt(((length(a) - 1) * var(a) + (length(b) - 1) * var(b)) / (length(a) + length(b) - 2))',
    '        val <- if (sp > 0) (mean(a) - mean(b)) / sp else 0   # standardised gap',
    '        if (defn == "reached the maximum") D[[paste(d, m)]] <- val else D5[[paste(d, m)]] <- val',
    '        dv <- mean(a) - mean(b)',
    '        if (abs(dv) < 1e-9) dv <- 0                         # avoid a cosmetic \'-0.000\'',
    '        cat(sprintf("%-11s%10.3f%11.3f%9.3f%9.4f\\n", m, mean(a), mean(b), dv, t.test(a, b)$p.value))',
    '      } else {',
    '        if (defn == "reached the maximum") D[[paste(d, m)]] <- 0 else D5[[paste(d, m)]] <- 0',
    '        cat(sprintf("%-11s   (not enough players in one of the groups)\\n", m))',
    '      }',
    '    }',
    '  }',
    '}',
    'cat("\\n--- EASY vs HARD: does play itself change with difficulty? (all players) ---\\n")',
    'cat(sprintf("%-11s%10s%11s%9s%9s\\n", "marker", "easy mean", "hard mean", "diff", "p"))',
    'for (m in MARKERS) {',
    '  a <- pl[pl$diff == "easy", m]; a <- a[!is.na(a)]',
    '  b <- pl[pl$diff == "hard", m]; b <- b[!is.na(b)]',
    '  if (length(a) > 1 && length(b) > 1 && (sd(a) > 1e-12 || sd(b) > 1e-12)) {',
    '    dv <- mean(a) - mean(b)',
    '    if (abs(dv) < 1e-9) dv <- 0                             # avoid a cosmetic \'-0.000\'',
    '    cat(sprintf("%-11s%10.3f%11.3f%9.3f%9.4f\\n", m, mean(a), mean(b), dv, t.test(a, b)$p.value))',
    '  }',
    '}',
    '',
    '# ---- 5. regressions with player-clustered SEs ----------------------------------',
    '# OLS with CR1 cluster-robust standard errors, printed as a table.',
    '#   y       outcome vector',
    '#   X       predictor matrix WITH a leading column of 1s (the intercept)',
    '#   names   printable name for each column of X',
    '#   cluster the cluster id of every row (the player - their rows are dependent)',
    '#   label   the table title. Returns the coefficient vector (invisibly).',
    '# Moore-Penrose pseudoinverse via SVD (same 1e-10 tolerance as the Python twin,',
    '# so both templates behave identically even if predictors are collinear).',
    'pinv <- function(A, tol = 1e-10) {',
    '  s <- svd(A)',
    '  d <- ifelse(s$d > tol * max(s$d), 1 / s$d, 0)',
    '  s$v %*% (d * t(s$u))',
    '}',
    'ols_cluster <- function(y, X, names, cluster, label) {',
    '  XtXi <- pinv(crossprod(X))                           # (X\'X)^-1 via SVD',
    '  b <- as.numeric(XtXi %*% crossprod(X, y))            # OLS coefficients',
    '  e <- as.numeric(y - X %*% b)                         # residuals',
    '  meat <- matrix(0, ncol(X), ncol(X))                  # sum of per-cluster score outer products',
    '  for (c in unique(cluster)) {',
    '    v <- crossprod(X[cluster == c, , drop = FALSE], e[cluster == c])',
    '    meat <- meat + tcrossprod(v)',
    '  }',
    '  G <- length(unique(cluster)); N <- length(y); k <- ncol(X)',
    '  V <- (G / (G - 1)) * ((N - 1) / (N - k)) * (XtXi %*% meat %*% XtXi)   # CR1 correction',
    '  se <- sqrt(diag(V))',
    '  cat(sprintf("\\n%s\\n", label))',
    '  cat(sprintf("  (%d observations, %d player clusters; t-tests use %d df)\\n", N, G, G - 1))',
    '  cat(sprintf("  %-22s%10s%10s%8s%9s\\n", "term", "coef", "se", "t", "p"))',
    '  for (i in seq_along(names)) {',
    '    t <- b[i] / se[i]',
    '    cat(sprintf("  %-22s%10.4f%10.4f%8.2f%9.4f\\n", names[i], b[i], se[i], t, 2 * (1 - pt(abs(t), G - 1))))',
    '  }',
    '  invisible(b)',
    '}',
    '',
    'line("="); cat("3. WHICH HEURISTICS PREDICT FINDING THE MAXIMUM? (regression R1)\\n"); line("=")',
    'cat("Linear probability model at the player-puzzle level. Markers are\\n")',
    'cat("STANDARDISED, so each coefficient = change in P(reached the maximum) per\\n")',
    'cat("1 SD of that marker, holding the others fixed. SEs clustered on player.\\n")',
    'r1 <- mk[complete.cases(mk[, MARKERS]), ]',
    'Z <- cbind(1, sapply(MARKERS, function(m) (r1[[m]] - mean(r1[[m]])) / sd(r1[[m]])), as.numeric(r1$diff == "hard"))',
    'ols_cluster(r1$reached_max, Z, c("(intercept)", paste(MARKERS, "(z)"), "hard puzzle"), r1$player, "R1: reached_max ~ markers + hard")',
    'ols_cluster(r1$within5, Z, c("(intercept)", paste(MARKERS, "(z)"), "hard puzzle"), r1$player, "R1b: the same model for getting WITHIN 5% of the maximum")',
    '',
    'line("="); cat("4. THE BALANCED-KPI HYPOTHESIS (H1)\\n"); line("=")',
    'cat("H1: top players do not only maximise net value - across ALL the KPIs they\\n")',
    'cat("stay close to the optima while they play. The metric: each KPI is taken\\n")',
    'cat("RELATIVE TO ITS OPTIMAL VALUE and averaged across KPIs -> one balanced-KPI\\n")',
    'cat("score per move (kpi_avg); then averaged move -> puzzle -> player, so the\\n")',
    'cat("AVERAGE top user is compared with the AVERAGE non-top user per difficulty.\\n")',
    'bal <- mv[complete.cases(mv[, c("kpi_avg", "kpi_even", "progress", "s_net")]), ]',
    '# the requested aggregation: moves -> one score per puzzle -> one per player x difficulty',
    'uavg <- aggregate(cbind(kpi = kpi_avg, even = kpi_even, v_net = s_net, v_cov = s_cov, v_fit = s_fit) ~ player + puzzle + diff, bal, mean)',
    'uavg <- aggregate(cbind(kpi, even, v_net, v_cov, v_fit) ~ player + diff, uavg, mean)',
    '# Average top user vs average non-top user on the player-level balanced-KPI',
    '# score, within difficulty d; flag = the player -> 0/1 top mapping. Returns',
    '# c(top mean, rest mean, Welch p), or NULL if a group is too small/constant.',
    'ucmp <- function(d, flag) {',
    '  a <- uavg$kpi[uavg$diff == d & flag[uavg$player] == 1]; a <- a[!is.na(a)]',
    '  b <- uavg$kpi[uavg$diff == d & flag[uavg$player] == 0]; b <- b[!is.na(b)]',
    '  if (length(a) > 1 && length(b) > 1 && (sd(a) > 1e-12 || sd(b) > 1e-12))',
    '    return(c(mean(a), mean(b), t.test(a, b)$p.value))',
    '  NULL',
    '}',
    'cat("\\nBalanced-KPI score of the AVERAGE top user vs the AVERAGE non-top user\\n")',
    'cat("(1 = every KPI at its optimum; per-user scores, Welch t-test):\\n")',
    'cat(sprintf("%-12s%-12s%10s%11s%9s%9s\\n", "definition", "difficulty", "top mean", "rest mean", "diff", "p"))',
    'for (lab in c("strict", "within-5%")) {',
    '  flag <- if (lab == "strict") top_strict else top_5pct',
    '  for (d in c("easy", "hard")) {',
    '    r <- ucmp(d, flag)',
    '    if (!is.null(r)) cat(sprintf("%-12s%-12s%10.3f%11.3f%9.3f%9.4f\\n", lab, d, r[1], r[2], r[1] - r[2], r[3]))',
    '    else cat(sprintf("%-12s%-12s   (not enough players in one of the groups)\\n", lab, d))',
    '  }',
    '}',
    'cat("\\nMove-level regressions. The s_net control makes the \'top player\' row read:\\n")',
    'cat("at the SAME net attainment and stage of play, do the other KPIs sit closer\\n")',
    'cat("to their optima for top players?\\n")',
    '# H1 regression: outcome ~ top + progress + top x progress + s_net + hard,',
    '# SEs clustered on player; flag / outcome are column names of bal.',
    'h1 <- function(flag, outcome, label) {',
    '  X <- cbind(1, bal[[flag]], bal$progress, bal[[flag]] * bal$progress, bal$s_net, bal$hard)',
    '  ols_cluster(bal[[outcome]], X, c("(intercept)", "top player", "progress", "top x progress", "s_net (level)", "hard puzzle"), bal$player, label)',
    '}',
    'h1("top_strict", "kpi_avg", "R2: kpi_avg ~ top(strict) x progress + s_net + hard")',
    'h1("top_5pct",  "kpi_avg", "R3: kpi_avg ~ top(within-5%) x progress + s_net + hard")',
    '# Robustness: at the maximum itself every score is 1, so kpi_avg = 1 mechanically;',
    '# R4 re-runs R2 keeping only moves strictly BELOW the maximum.',
    'keep <- bal$net_a < bal$best',
    'X4 <- cbind(1, bal$top_strict[keep], bal$progress[keep], bal$top_strict[keep] * bal$progress[keep], bal$s_net[keep], bal$hard[keep])',
    'ols_cluster(bal$kpi_avg[keep], X4, c("(intercept)", "top player", "progress", "top x progress", "s_net (level)", "hard puzzle"), bal$player[keep], "R4 (robustness): R2 excluding moves AT the maximum")',
    '# Functional form: same regression with the EVENNESS outcome - if R2 and R5',
    '# agree, the conclusion does not hinge on how \'balanced\' is defined.',
    'h1("top_strict", "kpi_even", "R5 (functional form): kpi_even ~ top(strict) x progress + s_net + hard")',
    '',
    '# A p-value to 4 decimals, or \'n/a\' when it cannot be computed.',
    'p4 <- function(x) if (is.finite(x)) sprintf("%.4f", x) else "n/a"',
    '# Format one table number to width w, or \'---\' when the cell is empty',
    '# (e.g. a tenth of play in which one group happens to have no moves).',
    '# Pre-rounding to 7 decimals keeps R and Python byte-identical: the two',
    '# languages sum in different orders, and a mean sitting within ~1e-15 of a',
    '# 0.0005 boundary could otherwise print a different last digit.',
    'cell <- function(x, w) if (is.finite(x)) sprintf(paste0("%", w, ".3f"), round(x, 7)) else sprintf(paste0("%", w, "s"), "---")',
    'for (spec in list(c("bin", "fifth", "Figures 3-4"), c("bin10", "tenth", "Figure 5"))) {',
    '  binc <- spec[1]; word <- spec[2]; ref <- spec[3]',
    '  cat(sprintf("\\nMean balanced-KPI score by %s of play (the data behind %s):\\n", word, ref))',
    '  cat(sprintf("%-7s%12s%8s%10s%8s\\n", word, "top(strict)", "rest", "top(5%)", "rest"))',
    '  for (i in 1:(if (binc == "bin") 5 else 10)) {',
    '    r <- c(mean(bal$kpi_avg[bal[[binc]] == i & bal$top_strict == 1]), mean(bal$kpi_avg[bal[[binc]] == i & bal$top_strict == 0]),',
    '           mean(bal$kpi_avg[bal[[binc]] == i & bal$top_5pct == 1]),  mean(bal$kpi_avg[bal[[binc]] == i & bal$top_5pct == 0]))',
    '    cat(sprintf("%-7d%s%s%s%s\\n", i, cell(r[1], 12), cell(r[2], 8), cell(r[3], 10), cell(r[4], 8)))',
    '  }',
    '}',
    '',
    'line("="); cat("5. FOCUSED OR DIVERSIFIED? WHICH OBJECTIVE DOES PLAY TRACK?\\n"); line("=")',
    'cat("A revealed-objective test. Candidate objectives: net value only, or a\\n")',
    'cat("balanced bundle of net value with coverage and/or compactness (each\\n")',
    'cat("candidate = the mean of its KPIs\' attainment scores, 0-100 points). For\\n")',
    'cat("every move we measure how much each candidate CLIMBED (its per-move change\\n")',
    'cat("in points); averaging move -> puzzle -> player gives each player\'s climb\\n")',
    'cat("rate per candidate. Mechanical note: in this game every placement raises\\n")',
    'cat("net value and coverage and every removal lowers them, so the candidates\\n")',
    'cat("separate through HOW FAST each objective rises - in particular through\\n")',
    'cat("compactness. FOCUS GAP = climb(net only) - climb(all three): positive =\\n")',
    'cat("net rises faster than the balanced bundle (net-focused play), negative =\\n")',
    'cat("the other KPIs keep pace or better (diversified play). Only moves where\\n")',
    'cat("every KPI change is defined are scored (a puzzle\'s first placement is\\n")',
    'cat("excluded: an empty board has no compactness).\\n")',
    'CANDS <- list(c("net value only", "u_net"), c("net + coverage", "u_nc"), c("net + compactness", "u_nf"), c("net + coverage + compactness", "u_all"))',
    '# per-player climb rate of each candidate (averaged move -> puzzle -> player)',
    'cons <- aggregate(cbind(u_net, u_nc, u_nf, u_all) ~ player + puzzle, mv, function(v) mean(v, na.rm = TRUE), na.action = na.pass)',
    'cons <- aggregate(cbind(u_net, u_nc, u_nf, u_all) ~ player, cons, function(v) mean(v, na.rm = TRUE), na.action = na.pass)',
    'cons$focus_gap <- cons$u_net - cons$u_all',
    '# Print the candidate climb-rate table + the focus-gap tests for one top',
    '# definition. Returns c(top gap mean, p vs 0, top-rest gap difference, its p)',
    '# for the INSIGHTS verdict, or NULL when a group is too small/constant.',
    'focus <- function(lab, flag) {',
    '  a <- cons[flag[cons$player] == 1, ]',
    '  b <- cons[flag[cons$player] == 0, ]',
    '  if (!(nrow(a) > 1 && nrow(b) > 1 && (sd(a$focus_gap, na.rm = TRUE) > 1e-12 || sd(b$focus_gap, na.rm = TRUE) > 1e-12))) {',
    '    cat(sprintf("\\n--- %s definition: not enough players in one of the groups ---\\n", lab))',
    '    return(NULL)',
    '  }',
    '  cat(sprintf("\\n--- %s definition: top (n=%d) vs rest (n=%d) ---\\n", lab, nrow(a), nrow(b)))',
    '  cat("Per-move climb rate of each candidate objective (points per move):\\n")',
    '  cat(sprintf("%-30s%8s%8s%8s%9s\\n", "candidate objective", "top", "rest", "diff", "p"))',
    '  for (x in CANDS) {',
    '    aa <- a[[x[2]]]; aa <- aa[!is.na(aa)]',
    '    bb <- b[[x[2]]]; bb <- bb[!is.na(bb)]',
    '    if (length(aa) > 1 && length(bb) > 1 && (sd(aa) > 1e-12 || sd(bb) > 1e-12)) {',
    '      cat(sprintf("%-30s%8.3f%8.3f%8.3f%9.4f\\n", x[1], mean(aa), mean(bb), mean(aa) - mean(bb), t.test(aa, bb)$p.value))',
    '    } else {',
    '      cat(sprintf("%-30s   (not enough players in one of the groups)\\n", x[1]))',
    '    }',
    '  }',
    '  bt <- CANDS[[which.max(sapply(CANDS, function(x) mean(a[[x[2]]], na.rm = TRUE)))]][1]',
    '  br <- CANDS[[which.max(sapply(CANDS, function(x) mean(b[[x[2]]], na.rm = TRUE)))]][1]',
    '  cat(sprintf("Fastest-climbing objective: top = %s; rest = %s\\n", bt, br))',
    '  pa <- if (sd(a$focus_gap, na.rm = TRUE) > 1e-12) t.test(a$focus_gap, mu = 0)$p.value else NaN',
    '  pb <- if (sd(b$focus_gap, na.rm = TRUE) > 1e-12) t.test(b$focus_gap, mu = 0)$p.value else NaN',
    '  pw <- t.test(a$focus_gap, b$focus_gap)$p.value',
    '  cat(sprintf("Focus gap: top %+.3f (p vs 0 = %s), rest %+.3f (p vs 0 = %s); top-rest difference p = %s\\n",',
    '      mean(a$focus_gap, na.rm = TRUE), p4(pa), mean(b$focus_gap, na.rm = TRUE), p4(pb), p4(pw)))',
    '  c(mean(a$focus_gap, na.rm = TRUE), pa, mean(a$focus_gap, na.rm = TRUE) - mean(b$focus_gap, na.rm = TRUE), pw)',
    '}',
    'fo_s <- focus("strict", top_strict)',
    'fo_5 <- focus("within-5%", top_5pct)',
    '',
    'line("="); cat("6. THE OPENING AND THE APPROACH TO THE PEAK\\n"); line("=")',
    'cat("Two windows of play, compared between top players and the rest:\\n")',
    'cat("  OPENING   each play\'s FIRST 10 moves.\\n")',
    'cat("  APPROACH  the LAST 10 moves up to AND INCLUDING the move where the\\n")',
    'cat("            player FIRST reached their own maximum net value of that\\n")',
    'cat("            puzzle (if the same maximum was hit more than once, only\\n")',
    'cat("            the first time counts). Short plays contribute what they\\n")',
    'cat("            have; the two windows can overlap when the peak comes early.\\n")',
    'cat("Window metrics (window moves -> one value per player-puzzle -> per player):\\n")',
    'cat("  kpi_avg   mean balanced-KPI score in the window\\n")',
    'cat("  net_rate  net-value climb per move in the window (points, Section 5)\\n")',
    'cat("  rem_share share of the window\'s moves that were removals\\n")',
    'cat("  vpc       mean $ / cell of the bricks placed in the window\\n")',
    'cat("  sec_move  mean seconds per move in the window\\n")',
    '# tag every move with its play\'s first-peak move, then flag the two windows',
    'mv <- merge(mv, mk[, c("player", "puzzle", "peak_move")], all.x = TRUE)',
    'mv <- mv[order(mv$player, mv$puzzle, mv$move), ]',
    'mv$in_open <- as.numeric(mv$move <= 10)',
    'mv$in_appr <- as.numeric(mv$move <= mv$peak_move & mv$move >= mv$peak_move - 9)',
    'WCOLS <- c("kpi_avg", "net_rate", "rem_share", "vpc", "sec_move")',
    '# One row per player with the five window metrics, built the usual way:',
    '# the window\'s moves -> a player-puzzle mean -> a player mean.',
    'wstats <- function(mask_col) {',
    '  sub <- mv[mv[[mask_col]] == 1, ]',
    '  sub$vpc_w <- ifelse(sub$action == "add", sub$brick_val / sub$cells, NA)',
    '  agg <- aggregate(cbind(kpi_avg, net_rate = u_net, rem_share = is_rem, vpc = vpc_w, sec_move = sec) ~ player + puzzle, sub,',
    '                   function(v) mean(v, na.rm = TRUE), na.action = na.pass)',
    '  aggregate(cbind(kpi_avg, net_rate, rem_share, vpc, sec_move) ~ player, agg, function(v) mean(v, na.rm = TRUE), na.action = na.pass)',
    '}',
    '# Top vs rest on one window metric: c(top mean, rest mean, Welch p), or NULL',
    '# when a group is too small or has no variation.',
    'wcmp <- function(ws, flag, colname) {',
    '  a <- ws[[colname]][flag[ws$player] == 1]; a <- a[!is.na(a)]',
    '  b <- ws[[colname]][flag[ws$player] == 0]; b <- b[!is.na(b)]',
    '  if (length(a) > 1 && length(b) > 1 && (sd(a) > 1e-12 || sd(b) > 1e-12))',
    '    return(c(mean(a), mean(b), t.test(a, b)$p.value))',
    '  NULL',
    '}',
    'ws_open <- wstats("in_open")',
    'ws_appr <- wstats("in_appr")',
    'for (wlab in c("OPENING (first 10 moves)", "APPROACH (last 10 moves to the first peak)")) {',
    '  ws <- if (wlab == "OPENING (first 10 moves)") ws_open else ws_appr',
    '  for (lab in c("strict", "within-5%")) {',
    '    flag <- if (lab == "strict") top_strict else top_5pct',
    '    n_a <- sum(flag[ws$player] == 1); n_b <- sum(flag[ws$player] == 0)',
    '    cat(sprintf("\\n--- %s - %s definition: top (n=%d) vs rest (n=%d) ---\\n", wlab, lab, n_a, n_b))',
    '    cat(sprintf("%-10s%10s%11s%9s%9s\\n", "metric", "top", "rest", "diff", "p"))',
    '    for (m in WCOLS) {',
    '      r <- wcmp(ws, flag, m)',
    '      if (!is.null(r)) {',
    '        dv <- r[1] - r[2]',
    '        if (abs(dv) < 1e-9) dv <- 0                         # avoid a cosmetic \'-0.000\'',
    '        cat(sprintf("%-10s%10.3f%11.3f%9.3f%9.4f\\n", m, round(r[1], 7), round(r[2], 7), round(dv, 7), r[3]))',
    '      } else {',
    '        cat(sprintf("%-10s   (not enough players in one of the groups)\\n", m))',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    'line("="); cat("7. HEURISTIC PROFILES - THE WITHIN-5% PLAYBOOK\\n"); line("=")',
    'cat("Everything in this section uses TOP = came within 5% of a puzzle\'s\\n")',
    'cat("maximum net value at least once. Markers are pooled to ONE VALUE PER\\n")',
    'cat("PLAYER (their easy and hard rows averaged), so each row below compares\\n")',
    'cat("the average top player with the average rest player; \'d\' = Cohen\'s d.\\n")',
    '# plp: one row per player with the six pooled markers + the success flag',
    'plp <- aggregate(pl[, MARKERS], pl[, "player", drop = FALSE], function(v) mean(v, na.rm = TRUE))',
    'plp$top5 <- as.numeric(top_5pct[plp$player])',
    'ok7 <- sum(plp$top5 == 1) > 1 && sum(plp$top5 == 0) > 1',
    'DIRS <- list()   # each marker\'s direction of the top-rest gap (+1 = top players higher)',
    'ranked <- list() # (marker, direction, adopter rate, other rate, lift, p), sorted by lift',
    'r_sc <- NULL     # style-score vs outcome correlation, when computable',
    'if (ok7) {',
    '  cat(sprintf("\\n--- The heuristic profile: top (n=%d) vs rest (n=%d) ---\\n", sum(plp$top5 == 1), sum(plp$top5 == 0)))',
    '  cat(sprintf("%-11s%10s%11s%9s%8s%9s\\n", "marker", "top mean", "rest mean", "diff", "d", "p"))',
    '  for (m in MARKERS) {',
    '    a <- plp[[m]][plp$top5 == 1]; a <- a[!is.na(a)]',
    '    b <- plp[[m]][plp$top5 == 0]; b <- b[!is.na(b)]',
    '    if (length(a) > 1 && length(b) > 1 && (sd(a) > 1e-12 || sd(b) > 1e-12)) {',
    '      sp <- sqrt(((length(a) - 1) * var(a) + (length(b) - 1) * var(b)) / (length(a) + length(b) - 2))',
    '      DIRS[[m]] <- if (mean(a) >= mean(b)) 1 else -1',
    '      dv <- mean(a) - mean(b)',
    '      if (abs(dv) < 1e-9) dv <- 0                           # avoid a cosmetic \'-0.000\'',
    '      cat(sprintf("%-11s%10.3f%11.3f%9.3f%8.2f%9.4f\\n", m, round(mean(a), 7), round(mean(b), 7), round(dv, 7), if (sp > 0) dv / sp else 0, t.test(a, b)$p.value))',
    '    } else {',
    '      cat(sprintf("%-11s   (not enough players in one of the groups)\\n", m))',
    '    }',
    '  }',
    '  # the profile in one plain-language line per group',
    '  profile <- function(g, label) {',
    '    cat(sprintf("%s: %.1f moves per puzzle, %.0f%% of moves are removals, first-3 bricks at $%.2f/cell, %.0f%% of the board covered by move 3, %.1f s per move, first hits their peak %.0f%% of the way through the play.\\n",',
    '        label, mean(g$n_moves, na.rm = TRUE), mean(g$rem_share, na.rm = TRUE) * 100, mean(g$early_vpc, na.rm = TRUE), mean(g$early_cov, na.rm = TRUE) * 100, mean(g$sec_move, na.rm = TRUE), mean(g$peak_at, na.rm = TRUE) * 100))',
    '  }',
    '  cat("\\n")',
    '  profile(plp[plp$top5 == 1, ], "The typical TOP player ")',
    '  profile(plp[plp$top5 == 0, ], "The typical REST player")',
    '  # WHICH HABITS PAY: for each marker, \'sharing the top habit\' = being on the',
    '  # top group\'s side of the all-player median; compare the within-5% success',
    '  # rate of the players who share it vs those who do not (two-proportion z).',
    '  cat("\\n--- Which habits pay: within-5% success rate if you share the top habit ---\\n")',
    '  cat(sprintf("%-11s%8s%10s%9s%8s%9s\\n", "marker", "habit", "adopters", "others", "lift", "p"))',
    '  for (m in MARKERS) {',
    '    if (is.null(DIRS[[m]])) next',
    '    v <- plp[!is.na(plp[[m]]), ]',
    '    adopt <- if (DIRS[[m]] > 0) v[[m]] > median(v[[m]]) else v[[m]] < median(v[[m]])',
    '    k1 <- sum(v$top5[adopt]); n1 <- sum(adopt)',
    '    k2 <- sum(v$top5[!adopt]); n2 <- sum(!adopt)',
    '    if (n1 > 1 && n2 > 1) {',
    '      ppool <- (k1 + k2) / (n1 + n2)',
    '      se <- sqrt(ppool * (1 - ppool) * (1 / n1 + 1 / n2))',
    '      pz <- if (se > 0) 2 * (1 - pnorm(abs((k1 / n1 - k2 / n2) / se))) else NaN',
    '      ranked[[length(ranked) + 1]] <- list(m, DIRS[[m]], k1 / n1, k2 / n2, k1 / n1 - k2 / n2, pz)',
    '      cat(sprintf("%-11s%8s%9.1f%%%8.1f%%%+7.1f%%%9s\\n", m, if (DIRS[[m]] > 0) "higher" else "lower", k1 / n1 * 100, k2 / n2 * 100, (k1 / n1 - k2 / n2) * 100, p4(pz)))',
    '    } else {',
    '      cat(sprintf("%-11s%8s   (not enough players on one side of the median)\\n", m, if (DIRS[[m]] > 0) "higher" else "lower"))',
    '    }',
    '  }',
    '  if (length(ranked)) ranked <- ranked[order(-sapply(ranked, function(x) x[[5]]))]',
    '  # a one-number style score: the six markers z-scored, each ORIENTED so higher',
    '  # = more like the top group, then averaged - how \'top-like\' a player\'s style is',
    '  for (m in MARKERS) {',
    '    plp[[paste0("z_", m)]] <- if (!is.null(DIRS[[m]]) && sd(plp[[m]], na.rm = TRUE) > 0) (plp[[m]] - mean(plp[[m]], na.rm = TRUE)) / sd(plp[[m]], na.rm = TRUE) * DIRS[[m]] else 0',
    '  }',
    '  plp$style <- rowMeans(plp[, paste0("z_", MARKERS)], na.rm = TRUE)',
    '  br <- tapply(pp$peak / pp$best, pp$player, max)',
    '  plp$best_ratio <- as.numeric(br[plp$player])',
    '  sc <- plp[!is.na(plp$style) & !is.na(plp$best_ratio), ]',
    '  if (nrow(sc) > 2 && sd(sc$style) > 1e-12 && sd(sc$best_ratio) > 1e-12) {',
    '    ct <- cor.test(sc$style, sc$best_ratio)',
    '    r_sc <- c(as.numeric(ct$estimate), ct$p.value)',
    '    cat("\\nStyle score vs outcome: playing \'top-like\' correlates with a player\'s closest\\n")',
    '    cat(sprintf("approach to the maximum (best peak / Best Value) at r = %.3f (p = %s).\\n", r_sc[1], p4(r_sc[2])))',
    '  } else {',
    '    cat("\\nStyle score vs outcome: not enough variation to compute the correlation.\\n")',
    '  }',
    '} else {',
    '  cat("(not enough players in one of the groups - load more sessions and re-run)\\n")',
    '}',
    '',
    '# ---- 6. figures (captured by the page; shown in \'Insights gained\') -------------',
    '# NOTE: R needs 6-digit hex colours (3-digit like #888 fail).',
    'BLUE <- "#4c72b0"; ORANGE <- "#e67e22"; GREY <- "#888888"',
    '',
    '# Figure 1 - the heuristic fingerprint: standardised top-minus-rest differences',
    'M <- rbind(easy = sapply(MARKERS, function(m) D[[paste("easy", m)]]),',
    '           hard = sapply(MARKERS, function(m) D[[paste("hard", m)]]))',
    'barplot(M, beside = TRUE, horiz = TRUE, names.arg = MARKERS, col = c(BLUE, ORANGE), las = 1,',
    '        xlab = "Cohen\'s d  (top players minus the rest)",',
    '        main = "How players who reached the maximum played differently")',
    'abline(v = 0, col = GREY)',
    'legend("bottomright", c("easy", "hard"), fill = c(BLUE, ORANGE), bty = "n")',
    '',
    '# Figure 2 - the heuristic fingerprint again, under the within-5% definition',
    'M5 <- rbind(easy = sapply(MARKERS, function(m) D5[[paste("easy", m)]]),',
    '            hard = sapply(MARKERS, function(m) D5[[paste("hard", m)]]))',
    'barplot(M5, beside = TRUE, horiz = TRUE, names.arg = MARKERS, col = c(BLUE, ORANGE), las = 1,',
    '        xlab = "Cohen\'s d  (within-5% players minus the rest)",',
    '        main = "The fingerprint when \'top\' = within 5% of the maximum")',
    'abline(v = 0, col = GREY)',
    'legend("bottomright", c("easy", "hard"), fill = c(BLUE, ORANGE), bty = "n")',
    '',
    '# Figure 3 / Figure 4 body: mean balanced-KPI score per fifth of play, top vs rest,',
    '# with +-1 standard-error bars.',
    'traj <- function(flag, title) {',
    '  m <- sapply(1:5, function(i) c(mean(bal$kpi_avg[bal$bin == i & bal[[flag]] == 1]), mean(bal$kpi_avg[bal$bin == i & bal[[flag]] == 0])))',
    '  s <- sapply(1:5, function(i) c(sd(bal$kpi_avg[bal$bin == i & bal[[flag]] == 1]) / sqrt(sum(bal$bin == i & bal[[flag]] == 1)),',
    '                                 sd(bal$kpi_avg[bal$bin == i & bal[[flag]] == 0]) / sqrt(sum(bal$bin == i & bal[[flag]] == 0))))',
    '  plot(1:5, m[1, ], type = "b", pch = 19, col = BLUE, ylim = range(c(m - s, m + s), na.rm = TRUE),',
    '       xlab = "fifth of the play (1 = first moves, 5 = last)", ylab = "mean balanced-KPI score (1 = all KPIs at optimum)", main = title, xaxt = "n")',
    '  axis(1, at = 1:5)',
    '  lines(1:5, m[2, ], type = "b", pch = 19, col = GREY)',
    '  arrows(1:5, m[1, ] - s[1, ], 1:5, m[1, ] + s[1, ], angle = 90, code = 3, length = 0.03, col = BLUE)',
    '  arrows(1:5, m[2, ] - s[2, ], 1:5, m[2, ] + s[2, ], angle = 90, code = 3, length = 0.03, col = GREY)',
    '  legend("bottomright", c("top", "rest"), col = c(BLUE, GREY), pch = 19, lty = 1, bty = "n")',
    '}',
    'traj("top_strict", "Balanced-KPI score during play - top (reached max) vs rest")   # Figure 3',
    'traj("top_5pct",  "Balanced-KPI score during play - top (within 5% of max) vs rest")   # Figure 4',
    '',
    '# One decile-resolution two-panel trajectory (strict | within-5%), top vs rest',
    '# with +-1 SE bars, for any per-move score column of bal.',
    'dec2 <- function(colname, ylab) {',
    '  par(mfrow = c(1, 2))',
    '  for (flag in c("top_strict", "top_5pct")) {',
    '    m <- sapply(1:10, function(i) c(mean(bal[[colname]][bal$bin10 == i & bal[[flag]] == 1], na.rm = TRUE), mean(bal[[colname]][bal$bin10 == i & bal[[flag]] == 0], na.rm = TRUE)))',
    '    s <- sapply(1:10, function(i) c(sd(bal[[colname]][bal$bin10 == i & bal[[flag]] == 1], na.rm = TRUE) / sqrt(sum(bal$bin10 == i & bal[[flag]] == 1)),',
    '                                    sd(bal[[colname]][bal$bin10 == i & bal[[flag]] == 0], na.rm = TRUE) / sqrt(sum(bal$bin10 == i & bal[[flag]] == 0))))',
    '    plot(1:10, m[1, ], type = "b", pch = 19, col = BLUE, ylim = range(c(m - s, m + s), na.rm = TRUE, finite = TRUE), xaxt = "n",',
    '         xlab = "tenth of the play (1 = first moves, 10 = last)", ylab = if (flag == "top_strict") ylab else "",',
    '         main = if (flag == "top_strict") "top = reached max" else "top = within 5% of max")',
    '    axis(1, at = 1:10)',
    '    lines(1:10, m[2, ], type = "b", pch = 19, col = GREY)',
    '    arrows(1:10, m[1, ] - s[1, ], 1:10, m[1, ] + s[1, ], angle = 90, code = 3, length = 0.02, col = BLUE)',
    '    arrows(1:10, m[2, ] - s[2, ], 1:10, m[2, ] + s[2, ], angle = 90, code = 3, length = 0.02, col = GREY)',
    '    if (flag == "top_strict") legend("bottomright", c("top", "rest"), col = c(BLUE, GREY), pch = 19, lty = 1, bty = "n")',
    '  }',
    '  par(mfrow = c(1, 1))',
    '}',
    '# Figure 5 - the balanced-KPI score at decile resolution ...',
    'dec2("kpi_avg", "mean balanced-KPI score")',
    '# ... and the same view under three alternative objective scores:',
    '# Figure 6 - the net-value objective alone',
    'dec2("s_net", "mean net-value attainment (s_net)")',
    '# Figure 7 - 50% net value + 50% ROI (s_roi = ROI/(1+ROI))',
    'dec2("mix_nr", "mean of s_net and s_roi")',
    '# Figure 8 - 1/3 net value + 1/3 ROI + 1/3 fitness',
    'dec2("mix_nrf", "mean of s_net, s_roi and s_fit")',
    '',
    '# Figure 9 - WHY balance differs: the three objectives separately, top vs rest',
    'par(mfrow = c(1, 2))',
    'for (v in c(1, 0)) {',
    '  g <- sapply(1:5, function(i) colMeans(bal[bal$bin == i & bal$top_strict == v, c("s_net", "s_cov", "s_fit")], na.rm = TRUE))',
    '  plot(1:5, g["s_net", ], type = "b", pch = 19, col = BLUE, ylim = c(0, 1), xaxt = "n",',
    '       xlab = "fifth of the play", ylab = "mean attainment (0-1)",',
    '       main = if (v == 1) "top players (strict)" else "rest")',
    '  axis(1, at = 1:5)',
    '  lines(1:5, g["s_cov", ], type = "b", pch = 15, col = ORANGE)',
    '  lines(1:5, g["s_fit", ], type = "b", pch = 17, col = GREY)',
    '  if (v == 1) legend("bottomright", c("net value (s_net)", "coverage (s_cov)", "compactness (s_fit)"),',
    '                     col = c(BLUE, ORANGE, GREY), pch = c(19, 15, 17), lty = 1, bty = "n")',
    '}',
    'par(mfrow = c(1, 1))',
    '',
    '# Figure 10 - the greedy trap: $/cell of the bricks placed, covering EVERY',
    '# placement but grouped for readability: individual placements when plays are',
    '# short, bins of 5 when players place up to ~40 bricks, bins of 10 beyond that',
    '# (long place/remove sessions produce 50+ placements and a raw per-k chart is',
    '# unreadable).',
    'adds$top <- as.numeric(top_strict[adds$player])',
    'kmax <- max(adds$k)',
    'w <- if (kmax <= 12) 1 else if (kmax <= 40) 5 else 10       # bin width adapts to play length',
    'adds$kbin <- (adds$k - 1) %/% w + 1                         # 1 = placements 1..w, 2 = w+1..2w, ...',
    'nb <- max(adds$kbin)',
    'm5 <- sapply(1:nb, function(k) c(mean(adds$vpc[adds$kbin == k & adds$top == 1], na.rm = TRUE), mean(adds$vpc[adds$kbin == k & adds$top == 0], na.rm = TRUE)))',
    's5 <- sapply(1:nb, function(k) c(sd(adds$vpc[adds$kbin == k & adds$top == 1], na.rm = TRUE) / sqrt(sum(adds$kbin == k & adds$top == 1)),',
    '                                 sd(adds$vpc[adds$kbin == k & adds$top == 0], na.rm = TRUE) / sqrt(sum(adds$kbin == k & adds$top == 0))))',
    'plot(1:nb, m5[1, ], type = "b", pch = 19, col = BLUE, ylim = range(c(m5 - s5, m5 + s5), na.rm = TRUE, finite = TRUE), xaxt = "n",',
    '     xlab = if (w == 1) "k-th brick placed" else sprintf("bricks placed (placement number, bins of %d)", w),',
    '     ylab = "mean $ value per cell of those bricks",',
    '     main = "Do players chase the pricey-per-cell (trap) bricks first?")',
    'axis(1, at = 1:nb, labels = if (w == 1) as.character(1:nb) else paste0((1:nb - 1) * w + 1, "-", (1:nb) * w))',
    'lines(1:nb, m5[2, ], type = "b", pch = 19, col = GREY)',
    'arrows(1:nb, m5[1, ] - s5[1, ], 1:nb, m5[1, ] + s5[1, ], angle = 90, code = 3, length = 0.03, col = BLUE)',
    'arrows(1:nb, m5[2, ] - s5[2, ], 1:nb, m5[2, ] + s5[2, ], angle = 90, code = 3, length = 0.03, col = GREY)',
    'legend("topright", c("top", "rest"), col = c(BLUE, GREY), pch = 19, lty = 1, bty = "n")',
    '',
    '# Figure 11 - how fast each candidate objective climbs per group (Section 5)',
    'par(mfrow = c(1, 2))',
    'for (lab in c("strict", "within-5%")) {',
    '  flag <- if (lab == "strict") top_strict else top_5pct',
    '  a <- cons[flag[cons$player] == 1, ]; b <- cons[flag[cons$player] == 0, ]',
    '  M8 <- rbind(top = sapply(CANDS, function(x) mean(a[[x[2]]], na.rm = TRUE)),',
    '              rest = sapply(CANDS, function(x) mean(b[[x[2]]], na.rm = TRUE)))',
    '  barplot(M8, beside = TRUE, names.arg = c("net", "net+cov", "net+comp", "all 3"), col = c(BLUE, GREY),',
    '          xlab = "candidate objective", ylab = if (lab == "strict") "climb rate (points per move)" else "",',
    '          main = if (lab == "strict") "top = reached max" else "top = within 5% of max")',
    '  if (lab == "strict") legend("topright", c("top", "rest"), fill = c(BLUE, GREY), bty = "n")',
    '}',
    'par(mfrow = c(1, 1))',
    '',
    '# Figure 12 - the two windows move by move: the opening aligned at move 1, the',
    '# approach aligned at the first peak (0 = the move the maximum was first hit).',
    'par(mfrow = c(1, 2))',
    'for (panel in c("open", "appr")) {',
    '  xs <- if (panel == "open") 1:10 else -9:0',
    '  m9 <- sapply(xs, function(i) {',
    '    sel1 <- if (panel == "open") mv$in_open == 1 & mv$move == i & mv$top_strict == 1 else mv$in_appr == 1 & (mv$move - mv$peak_move) == i & mv$top_strict == 1',
    '    sel0 <- if (panel == "open") mv$in_open == 1 & mv$move == i & mv$top_strict == 0 else mv$in_appr == 1 & (mv$move - mv$peak_move) == i & mv$top_strict == 0',
    '    c(mean(mv$kpi_avg[sel1], na.rm = TRUE), mean(mv$kpi_avg[sel0], na.rm = TRUE),',
    '      sd(mv$kpi_avg[sel1], na.rm = TRUE) / sqrt(sum(sel1 & !is.na(mv$kpi_avg))), sd(mv$kpi_avg[sel0], na.rm = TRUE) / sqrt(sum(sel0 & !is.na(mv$kpi_avg))))',
    '  })',
    '  plot(xs, m9[1, ], type = "b", pch = 19, col = BLUE, ylim = range(c(m9[1, ] - m9[3, ], m9[1, ] + m9[3, ], m9[2, ] - m9[4, ], m9[2, ] + m9[4, ]), na.rm = TRUE, finite = TRUE), xaxt = "n",',
    '       xlab = if (panel == "open") "move number" else "moves before the first peak (0 = the peak move)",',
    '       ylab = if (panel == "open") "mean balanced-KPI score" else "",',
    '       main = if (panel == "open") "opening: first 10 moves" else "approach: last 10 moves to the peak")',
    '  axis(1, at = xs)',
    '  lines(xs, m9[2, ], type = "b", pch = 19, col = GREY)',
    '  arrows(xs, m9[1, ] - m9[3, ], xs, m9[1, ] + m9[3, ], angle = 90, code = 3, length = 0.02, col = BLUE)',
    '  arrows(xs, m9[2, ] - m9[4, ], xs, m9[2, ] + m9[4, ], angle = 90, code = 3, length = 0.02, col = GREY)',
    '  if (panel == "open") legend("bottomright", c("top", "rest"), col = c(BLUE, GREY), pch = 19, lty = 1, bty = "n")',
    '}',
    'par(mfrow = c(1, 1))',
    '',
    'if (ok7) {',
    '  # Figure 13 - the heuristic profile as paired dots: each marker z-scored over',
    '  # ALL players, then the top-group mean (blue) vs the rest-group mean (grey).',
    '  plot(NULL, xlim = range(sapply(MARKERS, function(m) {',
    '    z <- if (sd(plp[[m]], na.rm = TRUE) > 0) (plp[[m]] - mean(plp[[m]], na.rm = TRUE)) / sd(plp[[m]], na.rm = TRUE) else plp[[m]] * 0',
    '    c(mean(z[plp$top5 == 1], na.rm = TRUE), mean(z[plp$top5 == 0], na.rm = TRUE))',
    '  })) + c(-0.3, 0.3), ylim = c(length(MARKERS) + 0.5, 0.5), yaxt = "n",',
    '       xlab = "group mean, in SD units of all players (0 = the overall average)", ylab = "",',
    '       main = "The heuristic profile - top (within 5%) vs rest")',
    '  axis(2, at = seq_along(MARKERS), labels = MARKERS, las = 1)',
    '  abline(v = 0, col = GREY, lty = 3)',
    '  for (i in seq_along(MARKERS)) {',
    '    m <- MARKERS[i]',
    '    z <- if (sd(plp[[m]], na.rm = TRUE) > 0) (plp[[m]] - mean(plp[[m]], na.rm = TRUE)) / sd(plp[[m]], na.rm = TRUE) else plp[[m]] * 0',
    '    zt <- mean(z[plp$top5 == 1], na.rm = TRUE); zr <- mean(z[plp$top5 == 0], na.rm = TRUE)',
    '    segments(zr, i, zt, i, col = GREY, lwd = 2)',
    '    points(zt, i, col = BLUE, pch = 19, cex = 1.3)',
    '    points(zr, i, col = GREY, pch = 19, cex = 1.3)',
    '  }',
    '  legend("bottomright", c("top", "rest"), col = c(BLUE, GREY), pch = 19, bty = "n")',
    '',
    '  # Figure 14 - which habits pay: within-5% success rate among the players who',
    '  # share each top habit vs those who do not (the Section-7 table as bars).',
    '  M11 <- rbind(sapply(ranked, function(x) x[[3]] * 100), sapply(ranked, function(x) x[[4]] * 100))',
    '  barplot(M11, beside = TRUE, names.arg = sapply(ranked, function(x) x[[1]]), col = c(BLUE, GREY), las = 2,',
    '          ylab = "% of players within 5% of a maximum", main = "Which habits pay (ranked by success-rate lift)")',
    '  legend("topright", c("share the top habit", "do not"), fill = c(BLUE, GREY), bty = "n")',
    '',
    '  # Figure 15 - style vs outcome: one dot per player; x = how \'top-like\' their',
    '  # style is, y = their closest approach to a maximum; dashed line = the 95% bar.',
    '  plot(plp$style, plp$best_ratio * 100, col = ifelse(plp$top5 == 1, BLUE, GREY), pch = 19,',
    '       xlab = "heuristic style score (higher = plays more like the top group)",',
    '       ylab = "best peak, % of the puzzle maximum", main = "Does playing \'top-like\' pay off?")',
    '  abline(h = 95, col = GREY, lty = 2)',
    '  legend("bottomright", c("top (within 5%)", "rest"), col = c(BLUE, GREY), pch = 19, bty = "n")',
    '}',
    '',
    '# ---- 7. the INSIGHTS write-up (rendered, with the figures, in Section 4) -------',
    '# Top-minus-rest gap of marker m at difficulty d, at the player level.',
    'gap <- function(d, m) mean(pl[pl$diff == d & pl$top_d == 1, m], na.rm = TRUE) - mean(pl[pl$diff == d & pl$top_d == 0, m], na.rm = TRUE)',
    'cat("\\nINSIGHTS\\n")',
    'cat("## Headline\\n")',
    'cat(sprintf("- %d players, %d completed puzzles, %d logged moves. %d players touched a puzzle maximum at least once (strict top); relaxing to \'within 5%% of the maximum\' adds %d more.\\n",',
    '    length(top_strict), nrow(pp), nrow(mv), sum(top_strict), sum(top_5pct) - sum(top_strict)))',
    'cat("## What top players did differently\\n")',
    'cat(sprintf("- On EASY puzzles, players who found the maximum made on average %+.1f more moves, removed bricks %+.2f more often (share of moves), and their first three bricks were %.2f $/cell %s than the rest\'s - see the Section-3 tables for the exact means and p-values.\\n",',
    '    gap("easy", "n_moves"), gap("easy", "rem_share"), abs(gap("easy", "early_vpc")), if (gap("easy", "early_vpc") < 0) "CHEAPER" else "PRICIER"))',
    'cat(sprintf("- On HARD puzzles the same fingerprint holds (%+.1f moves, %+.2f removal share, %+.2f $/cell early bricks); regression R1 shows which of these survive jointly, per SD, with player-clustered inference.\\n",',
    '    gap("hard", "n_moves"), gap("hard", "rem_share"), gap("hard", "early_vpc")))',
    'cat("- Reading the markers as HEURISTICS: n_moves = exploration volume; rem_share = treating placements as reversible experiments (every removal is a deliberate, temporary net sacrifice); early_vpc = ratio-chasing - a NEGATIVE top-minus-rest gap means top players resist the pricey-per-cell trap bricks (check its sign in the tables and in Figure 10).\\n")',
    'cat("## Easy vs hard\\n")',
    'cat(sprintf("- Across ALL players, hard puzzles took %+.1f moves and %+.1f s/move versus easy ones; the easy-vs-hard table in Section 3 gives the p-values. The top-vs-rest gaps point the same way at both difficulties (Figure 1), so the heuristics look GENERAL rather than difficulty-specific - hard puzzles mainly demand MORE of the same exploration.\\n",',
    '    mean(pl$n_moves[pl$diff == "hard"], na.rm = TRUE) - mean(pl$n_moves[pl$diff == "easy"], na.rm = TRUE),',
    '    mean(pl$sec_move[pl$diff == "hard"], na.rm = TRUE) - mean(pl$sec_move[pl$diff == "easy"], na.rm = TRUE)))',
    'cat("## Figure 1 - The heuristic fingerprint\\n")',
    'cat("Each bar is the standardised (Cohen\'s d) top-minus-rest difference in one behavioural marker; blue = easy, orange = hard puzzles. Bars right of zero mean top players show MORE of that marker. Long bars on n_moves / rem_share and a long NEGATIVE bar on early_vpc are the \'explore, backtrack, and do not chase $/cell\' fingerprint; if easy and hard bars point the same way, the heuristic generalises across difficulty.\\n")',
    'cat("## Figure 2 - the same fingerprint under the within-5% definition\\n")',
    'cat("Identical to Figure 1, but \'top\' = came within 5% of that difficulty\'s maximum at least once. If the bars keep their sign and only shrink, the winning heuristics are a shared STYLE of the near-optimal players too, not a lucky final move; the Section-3 output prints the exact means and p-values for this definition as well (and regression R1b repeats R1 for it).\\n")',
    'cat("## The balanced-KPI hypothesis (H1)\\n")',
    'cat("- THE METRIC, built exactly as specified: after every move each KPI is compared to ITS OPTIMAL value (net -> (net+16)/(best+16), coverage -> /100, compactness -> /100) and the discrepancies are AVERAGED across the KPIs into one balanced-KPI score for that move; a puzzle\'s moves are then averaged, and a player\'s puzzles are averaged per difficulty - giving how well each user plays ACROSS the KPIs on an average move of an average puzzle.\\n")',
    'r_se <- ucmp("easy", top_strict); r_sh <- ucmp("hard", top_strict)',
    'if (!is.null(r_se) && !is.null(r_sh)) {',
    '  cat(sprintf("- PLAYER-LEVEL RESULT (strict definition): on EASY puzzles the average top user scores %.3f vs %.3f for the average non-top user (gap %+.3f, p = %.4f); on HARD puzzles %.3f vs %.3f (gap %+.3f, p = %.4f). A positive, significant gap supports H1 at the player level; the within-5%% rows of the same table show whether it survives the relaxed definition.\\n",',
    '      r_se[1], r_se[2], r_se[1] - r_se[2], r_se[3], r_sh[1], r_sh[2], r_sh[1] - r_sh[2], r_sh[3]))',
    '} else {',
    '  cat("- PLAYER-LEVEL RESULT: one of the groups is too small for the comparison - see the table in Section 4 of the output and re-run once more sessions are loaded.\\n")',
    '}',
    'cat("- TEST DESIGN, move level: kpi_avg regressed on the top flag, play progress, their interaction and - crucially - the net level s_net, with SEs clustered on player. The \'top player\' row in R2 is the gap AT EQUAL net attainment and stage of play, i.e. whether the OTHER objectives are closer to their optima; \'top x progress\' says whether that gap widens as play unfolds. R3 relaxes who counts as top (within 5%), R4 drops the moves at the maximum itself (where the score is 1 by construction), and R5 swaps in the EVENNESS outcome (1 - SD across the KPIs) - if R2 and R5 agree, the finding does not hinge on how \'balanced\' is defined.\\n")',
    'cat("## Figure 3 - the balanced-KPI score during play (strict top definition)\\n")',
    'cat("Mean per-move balanced-KPI score in each fifth of the play, top (blue) vs rest (grey), with +-1 SE bars. A score near 1 means net value, coverage and compactness are ALL close to their optimal values. A blue line sitting above the grey one - especially in the middle fifths, before anyone reaches the optimum - is H1 in picture form.\\n")',
    'cat("## Figure 4 - the same picture with the relaxed (within-5%) definition\\n")',
    'cat("If this looks like Figure 3, the finding is not an artefact of the strict cut-off: players who merely came close to the maximum share the balanced style. If the gap disappears here, \'balance\' distinguishes only the very best plays.\\n")',
    'cat("## Figure 5 - the balanced-KPI score at 10% resolution\\n")',
    'cat("The same trajectories as Figures 3-4 but per TENTH of the play instead of fifths - left panel: top = reached the maximum; right panel: top = within 5% of it. The finer grid shows WHEN the groups separate (right from the opening moves, or only in the endgame); bars are +-1 SE, and a tenth in which a group happens to have no moves is simply skipped. The tables behind both resolutions are printed in the Section-3 output.\\n")',
    'cat("## Figure 6 - the net-value objective alone, at 10% resolution\\n")',
    'cat("The same two panels as Figure 5 but tracking ONLY net-value attainment (s_net = (Net+16)/(Best+16)) - the game\'s stated objective. If the groups separate here, the top players are simply ahead on the scoreboard itself; comparing this picture with Figures 7 and 8 shows how the gap changes once the other KPIs enter the score.\\n")',
    'cat("## Figure 7 - 50% net value + 50% ROI, at 10% resolution\\n")',
    'cat("The score is the even mix of net-value attainment and ROI attainment, where ROI attainment = Total Value / (Total Value + Resource Cost) - a bounded 0-1 rescaling of the Value/Resource (ROI) KPI equal to ROI/(1+ROI), so 0 = empty board and 1 = zero empty-cell penalty (the raw KPI divides by zero at full coverage, this form does not). If the top-vs-rest gap widens here relative to Figure 6, top players carry an efficiency edge beyond the scoreboard.\\n")',
    'cat("## Figure 8 - 1/3 net value + 1/3 ROI + 1/3 fitness, at 10% resolution\\n")',
    'cat("The even three-way mix adds the Portfolio Fitness (compactness) KPI (/100) to net value and ROI. Note this is a DIFFERENT composite from the balanced-KPI score of Figure 5, which uses coverage as the resource objective; comparing Figures 5-8 shows which ingredient - the scoreboard, efficiency, or geometry - the top players\' advantage flows through, and at which stage of play.\\n")',
    'cat("## Figure 9 - the three objectives separately (what drives the score)\\n")',
    'cat("The three attainments (net = blue, coverage = orange, compactness = grey) over the fifths of play, top players on the left, rest on the right. Parallel, close-together lines = an even profile; a wide fan = lopsided play. The typical greedy pattern is a coverage line that lags far below the others - value piles up on pricey bricks while the board stays empty.\\n")',
    'cat("## Figure 10 - the greedy trap in one picture\\n")',
    'cat("Mean $ value per cell of EVERY brick placed (the 1st, 2nd, ... k-th placement) - a brick\'s Brick Value divided by the number of cells it occupies. Two terms NOT to confuse with the on-screen KPIs: this $/cell is a PER-BRICK price density, not the Value/Resource (ROI) KPI (which divides the whole portfolio\'s Total Value by the empty-cell penalty); and \'completing the board\' below means GEOMETRIC fit, not the Portfolio Fitness compactness KPI. The game is built so the bricks with the highest $/cell are traps: a grey (rest) line starting high and falling = ratio-greedy ordering (grab the priciest-per-cell bricks first), while a flatter blue (top) line = top players picking bricks for how well they complete the board rather than for their price per cell - one of the clearest heuristics separating the groups. Later placements exist only for the players who made that many, so the error bars naturally widen along the tail; and when plays run long, placements are grouped into bins of 5 or 10 (see the axis labels) so the chart stays readable - each point is then the mean over that bin of placements.\\n")',
    'cat("## Focused or diversified: which objective does play track?\\n")',
    'cat("- THE TEST (Section 5 of the output): candidate objectives are net value alone, net + coverage, net + compactness, and all three together (each = the mean of its KPIs\' 0-100 attainment scores). For every player we measure each candidate\'s per-move CLIMB RATE; the group means say which objective each group\'s play is de-facto optimising. (In this game every placement raises net value and coverage mechanically, so what separates the candidates is whether compactness keeps pace.) The FOCUS GAP - net-only climb minus all-three climb - is positive for net-focused play and negative for diversified play.\\n")',
    'if (!is.null(fo_s)) {',
    '  cat(sprintf("- RESULT: under the strict definition the top users\' focus gap is %+.3f (p vs 0 = %s)%s. A significantly NEGATIVE gap says the best players raise the balanced bundle at least as fast as net value - diversified play; a significantly POSITIVE gap says their net value races ahead of their other KPIs - net-value maximisers first.\\n",',
    '      fo_s[1], p4(fo_s[2]),',
    '      if (!is.null(fo_5)) sprintf("; under the within-5%% definition it is %+.3f (p vs 0 = %s)", fo_5[1], p4(fo_5[2])) else ""))',
    '} else {',
    '  cat("- RESULT: not enough players in one of the groups yet - see Section 5 of the output.\\n")',
    '}',
    'cat("## Figure 11 - how fast each candidate objective climbs, per group\\n")',
    'cat("Grouped bars: the mean per-move climb (attainment points) of each candidate objective, top (blue) vs rest (grey); left panel = strict definition, right = within-5%. Read it two ways: within a group, the tallest bar is the objective that group\'s play raises fastest; between groups, compare how much the bars SHRINK from \'net\' to \'all 3\' - a big drop means compactness lags behind net (focused play), similar heights mean all objectives advance together (diversified play).\\n")',
    'cat("## The opening vs the approach to the peak\\n")',
    'cat("- THE WINDOWS (Section 6 of the output): the OPENING = each play\'s first 10 moves; the APPROACH = the last 10 moves up to and including the move where the player FIRST reached their own maximum net value of that puzzle (if the same maximum was hit more than once, only the first time counts). Comparing the two says whether top players differ from the very start or pull away while closing in on their peak.\\n")',
    'r_o <- wcmp(ws_open, top_strict, "kpi_avg"); r_a <- wcmp(ws_appr, top_strict, "kpi_avg")',
    'if (!is.null(r_o) && !is.null(r_a)) {',
    '  cat(sprintf("- RESULT (strict definition, balanced-KPI score): in the OPENING the average top user scores %.3f vs %.3f for the rest (gap %+.3f, p = %s); in the APPROACH %.3f vs %.3f (gap %+.3f, p = %s). Section 6 prints the full tables - net climb, removals, $/cell and pace - for both windows and both top definitions.\\n",',
    '      r_o[1], r_o[2], r_o[1] - r_o[2], p4(r_o[3]), r_a[1], r_a[2], r_a[1] - r_a[2], p4(r_a[3])))',
    '} else {',
    '  cat("- RESULT: one of the groups is too small for the window comparison yet - see Section 6 of the output.\\n")',
    '}',
    'cat("## Figure 12 - the two windows, move by move\\n")',
    'cat("Left: the first 10 moves, aligned at move 1. Right: the last 10 moves before the first peak, aligned so 0 = the move the maximum was first reached. Lines are the mean balanced-KPI score at each aligned move, top (blue) vs rest (grey), with +-1 SE bars (strict definition; the Section-6 tables also cover within-5%). Diverging lines on the left mean top players play differently from the very start; diverging lines on the right mean the difference emerges in how they close in on the peak.\\n")',
    'cat("## The within-5% playbook: how the top players actually played\\n")',
    'if (ok7) {',
    '  cat(sprintf("- THE TYPICAL TOP PLAYER (within 5%% of a maximum at least once): %.1f moves per puzzle, %.0f%% of them removals, first-3 bricks at $%.2f/cell, %.0f%% of the board covered by move 3, %.1f s per move, first peak %.0f%% of the way in. THE TYPICAL REST PLAYER: %.1f moves, %.0f%% removals, $%.2f/cell early bricks, %.0f%% early coverage, %.1f s per move, first peak %.0f%% of the way in.\\n",',
    '      mean(plp$n_moves[plp$top5 == 1], na.rm = TRUE), mean(plp$rem_share[plp$top5 == 1], na.rm = TRUE) * 100, mean(plp$early_vpc[plp$top5 == 1], na.rm = TRUE), mean(plp$early_cov[plp$top5 == 1], na.rm = TRUE) * 100, mean(plp$sec_move[plp$top5 == 1], na.rm = TRUE), mean(plp$peak_at[plp$top5 == 1], na.rm = TRUE) * 100,',
    '      mean(plp$n_moves[plp$top5 == 0], na.rm = TRUE), mean(plp$rem_share[plp$top5 == 0], na.rm = TRUE) * 100, mean(plp$early_vpc[plp$top5 == 0], na.rm = TRUE), mean(plp$early_cov[plp$top5 == 0], na.rm = TRUE) * 100, mean(plp$sec_move[plp$top5 == 0], na.rm = TRUE), mean(plp$peak_at[plp$top5 == 0], na.rm = TRUE) * 100))',
    '  if (length(ranked) > 1) {',
    '    cat(sprintf("- THE HABITS THAT PAID MOST (success-rate lift when a player shares the top group\'s side of a habit): 1st %s (%s than the median): %.0f%% of sharers got within 5%% vs %.0f%% of the others (lift %+.0f points, p = %s); 2nd %s (%s): %.0f%% vs %.0f%% (lift %+.0f points, p = %s). The full ranking is the Section-7 table and Figure 14.\\n",',
    '        ranked[[1]][[1]], if (ranked[[1]][[2]] > 0) "higher" else "lower", ranked[[1]][[3]] * 100, ranked[[1]][[4]] * 100, ranked[[1]][[5]] * 100, p4(ranked[[1]][[6]]),',
    '        ranked[[2]][[1]], if (ranked[[2]][[2]] > 0) "higher" else "lower", ranked[[2]][[3]] * 100, ranked[[2]][[4]] * 100, ranked[[2]][[5]] * 100, p4(ranked[[2]][[6]])))',
    '  }',
    '  if (!is.null(r_sc)) {',
    '    cat(sprintf("- STYLE PAYS AS A PACKAGE: a one-number style score (all six habits, oriented towards the top group and averaged) correlates with a player\'s closest approach to the maximum at r = %.3f (p = %s) - see Figure 15.\\n", r_sc[1], p4(r_sc[2])))',
    '  }',
    '  cat("- WHY THESE MECHANISMS WORK (whichever direction your data shows, this is what each habit measures): early_vpc is ratio-greed - the game\'s priciest-per-cell bricks are designed traps that block the single full-cover optimum; rem_share is reversibility - reaching the optimum usually means undoing a locked-in arrangement, so removals are invested, not wasted, moves; n_moves and sec_move are exploration and deliberation - information about which bricks fit together is bought with moves and time; early_cov is option preservation - grabbing board space early narrows what can still be placed; peak_at separates late graft (peak found near the end of a long search) from early luck.\\n")',
    '} else {',
    '  cat("- Not enough players in one of the groups yet for the within-5% playbook - load more sessions and re-run (Section 7 of the output).\\n")',
    '}',
    'cat("## Figure 13 - the heuristic profile at a glance\\n")',
    'cat("Each row is one habit, z-scored across ALL players so the habits share one scale; the blue dot is the top group\'s average (within-5% definition), the grey dot the rest\'s, and the line between them is the gap. Dots far apart = a habit that separates the groups strongly; dots on opposite sides of the dotted zero line = the groups sit on opposite sides of the overall average.\\n")',
    'cat("## Figure 14 - which habits pay\\n")',
    'cat("For each habit, the share of players who got within 5% of a maximum among those who SHARE the top group\'s side of that habit (blue) vs those who do not (grey), ranked left-to-right by the lift. A tall blue bar over a short grey one marks a habit that genuinely travels with success; similar bars mean the habit is style, not substance. The p-values are in the Section-7 table.\\n")',
    'cat("## Figure 15 - does playing \'top-like\' pay off?\\n")',
    'cat("One dot per player: x = the heuristic style score (all six habits oriented towards the top group and averaged - higher means playing more like the top players), y = that player\'s closest approach to a puzzle maximum (best peak as % of Best Value). The dashed line is the 95% bar that defines the top group. An upward-sloping cloud says the playbook works as a package; blue dots far left or grey dots far right are the interesting exceptions worth a closer look.\\n")',
    'cat("## Other ways to probe this (suggestions)\\n")',
    'cat("- Survival analysis: time (in moves) until first touching the maximum, Cox or discrete-time logit, with the balance of the CURRENT board as a time-varying covariate.\\n")',
    'cat("- More functional forms: a Rawlsian score min(s_net, s_cov, s_fit) (\'raise the worst objective\'), or entropy of the normalised scores, next to the average (kpi_avg) and evenness (kpi_even) already reported - conclusions should not depend on the choice.\\n")',
    'cat("- Sequence mining: classify each move add/remove and look for recurring n-grams (e.g. add-add-remove-add \'probe\' patterns) that separate top players.\\n")',
    'cat("- Player random effects (mixed model) instead of clustered OLS, and puzzle fixed effects to absorb puzzle-specific difficulty beyond easy/hard.\\n")',
    'cat("- A placebo test: re-run R2 with a fake \'top\' flag drawn at random with the same prevalence - the top coefficient should collapse to zero.\\n")',
    'cat("## The verdict: one KPI, or balanced across KPIs?\\n")',
    '# One row per player (both difficulties pooled), carrying the per-KPI attainments,',
    '# the balanced-KPI score and the evenness - all built move -> puzzle -> player.',
    'uv <- aggregate(cbind(kpi, even, v_net, v_cov, v_fit) ~ player, uavg, mean)',
    'KPI_NAMES <- c(v_net = "net value", v_cov = "coverage", v_fit = "compactness")',
    'vt <- uv[top_strict[uv$player] == 1, ]   # the best players (strict definition)',
    'vr <- uv[top_strict[uv$player] == 0, ]   # everyone else',
    'if (nrow(vt) > 1 && nrow(vr) > 1 && sd(c(vt$even, vr$even)) > 1e-12 && sd(c(vt$kpi, vr$kpi)) > 1e-12) {',
    '  for (nm in c("TOP players", "The rest")) {',
    '    g <- if (nm == "TOP players") vt else vr',
    '    m <- c(v_net = mean(g$v_net), v_cov = mean(g$v_cov), v_fit = mean(g$v_fit))',
    '    hi <- names(m)[which.max(m)]; lo <- names(m)[which.min(m)]',
    '    cat(sprintf("- %s: net value %.3f, coverage %.3f, compactness %.3f - strongest: %s, weakest: %s, spread %.3f (a LARGE spread = play focused on one KPI; a SMALL spread = balanced play).\\n",',
    '        nm, m["v_net"], m["v_cov"], m["v_fit"], KPI_NAMES[hi], KPI_NAMES[lo], m[hi] - m[lo]))',
    '  }',
    '  ge <- mean(vt$even) - mean(vr$even); pe <- t.test(vt$even, vr$even)$p.value',
    '  gk <- mean(vt$kpi) - mean(vr$kpi);   pk <- t.test(vt$kpi, vr$kpi)$p.value',
    '  cat(sprintf("- The two numbers that decide it (top minus rest, per-player values, Welch t): EVENNESS gap %+.3f (p = %.4f) - is the best players\' KPI profile more even? - and balanced-KPI score gap %+.3f (p = %.4f) - are they closer to the optima across the board?\\n",',
    '      ge, pe, gk, pk))',
    '  if (!is.null(fo_s)) {',
    '    w <- if (is.finite(fo_s[2]) && fo_s[2] < 0.05 && fo_s[1] < 0) "DIVERSIFIED - the balanced bundle climbs at least as fast as net value alone"',
    '         else if (is.finite(fo_s[2]) && fo_s[2] < 0.05 && fo_s[1] > 0) "NET-FOCUSED - their net value climbs faster than their other KPIs"',
    '         else "neither clearly net-focused nor clearly diversified"',
    '    rel <- ""',
    '    if (is.finite(fo_s[4]) && fo_s[4] < 0.05)',
    '      rel <- sprintf(" Compared to the rest they are %s net-focused (gap difference %+.3f, p = %s).", if (fo_s[3] < 0) "LESS" else "MORE", fo_s[3], p4(fo_s[4]))',
    '    cat(sprintf("- OBJECTIVE TEST: by per-move climb rates (Section 5, Figure 11), the best players look %s.%s\\n", w, rel))',
    '  }',
    '  if (ge > 0 && pe < 0.05 && gk > 0 && pk < 0.05) {',
    '    cat("- VERDICT: BALANCED. The best players are not chasing a single KPI: their profile across net value, coverage and compactness is significantly MORE EVEN than the rest\'s AND they sit significantly closer to the optima across all KPIs. Winning play here means managing the whole dashboard, not maximising one number.\\n")',
    '  } else if (ge < 0 && pe < 0.05 && gk > 0 && pk < 0.05) {',
    '    cat("- VERDICT: FOCUSED BUT EFFECTIVE. The best players do score closer to the optima on average, but their profile is significantly LESS even than the rest\'s - their advantage runs through one dominant KPI (their \'strongest\' above) rather than through balanced play.\\n")',
    '  } else if (gk > 0 && pk < 0.05) {',
    '    cat("- VERDICT: PARTLY BALANCED. The best players are significantly closer to the optima across the KPIs on average, but the evenness gap is not statistically significant - with the players collected so far the data cannot separate \'better at everything\' from \'more balanced\'. Load more sessions and re-run to sharpen this.\\n")',
    '  } else if (ge > 0 && pe < 0.05) {',
    '    cat("- VERDICT: MORE EVEN, NOT CLOSER. The best players spread their attainment significantly more evenly across net value, coverage and compactness, but their average closeness to the optima is not significantly higher - what distinguishes them is the BALANCE of their play, not overall dominance of every KPI.\\n")',
    '  } else {',
    '    cat("- VERDICT: NO CLEAR SIGNAL. With the players collected so far, neither a significantly more even KPI profile nor significantly closer-to-optimum play separates the best players from the rest (the exact gaps and p-values are in the line above) - load more sessions and re-run.\\n")',
    '  }',
    '} else {',
    '  cat("- VERDICT: not enough players in one of the groups to compare yet - load more sessions and re-run.\\n")',
    '}',
    'cat("\\nDone. The figures are rendered in the \'Insights gained\' section below.\\n")'
  ].join('\n');

  // ---- Deep delete helpers (used by single + bulk delete) ----
  async function deleteParticipantDeep(uid) {
    var names = ['events', 'rounds'];
    for (var n = 0; n < names.length; n++) {
      try { var sn = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, names[n])); for (var j = 0; j < sn.docs.length; j++) { try { await fb.F.deleteDoc(sn.docs[j].ref); } catch (e) {} } } catch (e) {}
    }
    try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers')); } catch (e) {}
    await fb.F.deleteDoc(fb.F.doc(fb.db, 'participants', uid));
  }

  // ---- bootstrap ----
  async function init() {
    if (inited) return; inited = true;
    injectStyles();
    root = el('div', { id: 'pfa-root' }, [el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card' }, [el('p', { text: 'Connecting...' })])])]);
    document.body.appendChild(root);
    applyTheme(currentTheme());
    // Back/forward between the Admin and Data-analytics views (their URLs differ).
    window.addEventListener('popstate', function () {
      if (!user || user.email !== ADMIN_EMAIL) return;
      var v = viewFromUrl();
      if (v !== currentView) { currentView = v; renderShell(); }
    });
    // Returning admin on this device: render the panel immediately (no
    // 'Connecting' flash). onAuthStateChanged then confirms the session, or
    // routes to login if it has expired. Honour the view the URL points at
    // (?admin=data-analytics) so the cached render doesn't flash the wrong view.
    currentView = viewFromUrl();
    if (cachedAdmin()) { try { renderShell(); } catch (e) {} }
    try { await initFirebase(); } catch (e) { clearRoot(); root.appendChild(el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); return; }
    // Routing is driven solely by onAuthStateChanged (registered in initFirebase),
    // which fires once after the session is restored. This avoids briefly showing
    // the login screen (and the browser autofilling it) before a logged-in admin
    // is recognised.
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
