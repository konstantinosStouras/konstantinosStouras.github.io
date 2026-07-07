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
  var daState = { selected: {}, importedBooks: [], sessions: null, allParts: null, sheetMap: null, sheetOrder: [], code: { python: null, r: null }, lang: 'python', running: false };
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
      + '.pfa-scrolltbl{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--qbg);}';
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
      el('p', { class: 'pfa-note', html: 'Load play data from any <b>active or completed session</b> (or import an already-exported Excel), consolidate it into a <b>single Excel file</b>, read the headline aggregates, then process the data with <b>Python or R</b> — compiled entirely in your browser (nothing is uploaded). Three steps:' })
    ]));
    daRefs = {};   // this render's sections register their live refreshers here
    wrap.appendChild(buildDaSection1());
    wrap.appendChild(buildDaSection2());
    wrap.appendChild(buildDaSection3());
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
    card.appendChild(el('p', { class: 'pfa-note', html: 'Headline numbers from the loaded <b>Rounds</b> data (one row per completed puzzle): how many users played, how many easy/hard puzzles were completed, the <b>average time to complete</b> one (each user weighted equally — their own average is taken first) and the <b>% of users who reached the maximum</b> (the puzzle\'s single optimal portfolio) at least once, plus the % who got <b>within 5%</b> and <b>within 10%</b> of that maximum Net Value at least once (cumulative — a user at the maximum also counts as within 5% and 10%).' }));
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
  // "Reached the maximum" = Net Value >= Best Value when both are present,
  // else Fitness % >= 100 as a fallback, else unknown (excluded from the rate).
  // "Within 5% / 10% of the maximum" = Net Value >= 95% / 90% of Best Value
  // (Best Value is always positive), fallback Fitness % >= 95 / 90 — cumulative,
  // so a round at the maximum also counts as within 5% and within 10%.
  function daAggStats(map) {
    var rounds = (map && map.Rounds) || [];
    if (!rounds.length) return null;
    var kPlayer = daPickKey(rounds, ['Player', 'account_id', 'participant', 'user']);
    var kSess = daPickKey(rounds, ['Session', 'session_id']);
    var kDiff = daPickKey(rounds, ['Difficulty', 'diff']);
    var kTime = daPickKey(rounds, ['Time (s)', 'time_s', 'time', 'duration (s)']);
    var kNet = daPickKey(rounds, ['Net Value', 'net']);
    var kBest = daPickKey(rounds, ['Best Value', 'bestValue']);
    var kFit = daPickKey(rounds, ['Fitness %', 'fitness']);
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
      var net = daNum(kNet ? r[kNet] : null), best = daNum(kBest ? r[kBest] : null), fit = daNum(kFit ? r[kFit] : null);
      if (net != null && best != null) { atMax = net >= best; near5 = net >= 0.95 * best; near10 = net >= 0.90 * best; }
      else if (fit != null) { atMax = fit >= 100; near5 = fit >= 95; near10 = fit >= 90; }
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
    card.appendChild(el('p', { class: 'pfa-note', html: 'Pick a table from the loaded data, then run <b>Python</b> (Pyodide: numpy / pandas / scipy / matplotlib) or <b>R</b> (WebR, base R) on it — compiled entirely in your browser (the first run downloads the runtime, ~10–30&nbsp;s). The table is handed to your code as the string <code>DATA_CSV</code> (Python) or the file <code>/tmp/data.csv</code> (R). Any valid Python or R works; the bundled template computes the Section-2 aggregates with tests and plots. Output and figures appear below.' }));

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
        var csv = X.utils.sheet_to_csv(X.utils.json_to_sheet(rows));
        return lang === 'python'
          ? daRunPython(code, { dataCsv: csv, onStdout: pushLine, onStatus: setStatus })
          : daRunR(code, { dataCsv: csv, onOutput: pushLine, onStatus: setStatus });
      }).then(function (result) {
        var finalOut = outText || (result && (result.stdout || result.output)) || '';
        var imgs = (result && result.images) || [];
        if (result && !result.ok && result.error) finalOut = (finalOut ? finalOut + '\n' : '') + '⚠ ' + result.error;
        if (outPre) outPre.textContent = finalOut || '(no output)';
        imgs.forEach(function (src) { plots.appendChild(el('img', { src: src, alt: 'figure' })); });
        setStatus(imgs.length ? (imgs.length + ' figure' + (imgs.length === 1 ? '' : 's') + ' rendered below.') : (result && result.ok ? 'Done.' : ''));
      }).catch(function (err) {
        if (outPre) outPre.textContent = (outText ? outText + '\n' : '') + '⚠ ' + ((err && err.message) || err);
        setStatus('');
      }).then(function () {
        running = false; daState.running = false; runBtn.removeAttribute('disabled'); resetBtn.removeAttribute('disabled');
      });
    }
    return card;
  }

  function daLoadSaved(key, dflt) { try { var v = localStorage.getItem(key); return v != null ? v : dflt; } catch (e) { return dflt; } }
  // Bump PF_DA_TPL_VERSION whenever the bundled Python/R templates change. A
  // saved script from a previous version lives in localStorage and would
  // otherwise SHADOW the current template (daLoadSaved returns the saved copy).
  // On a version change we drop the saved code so the fresh template loads.
  var PF_DA_TPL_VERSION = '2026-07-07-within-5-10-pct';
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
    pyodide.globals.set('DATA_CSV', opts.dataCsv || '');
    var ok = true, error = null, images = [];
    try {
      await pyodide.runPythonAsync(DA_MPL_BACKEND + '\n' + code + '\n' + DA_FIG_HARVEST);
      var pyImages = pyodide.globals.get('__pyo_images');
      if (pyImages) { try { images = pyImages.toJs(); } finally { pyImages.destroy(); } }
    } catch (e) {
      ok = false; error = e && e.message ? e.message : String(e); emit(error);
    } finally {
      pyodide.setStdout(); pyodide.setStderr();
      try { pyodide.runPython("for __n in ('DATA_CSV','__pyo_images'):\n    globals().pop(__n, None)\n"); } catch (e) { /* ignore */ }
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
      if (typeof opts.dataCsv === 'string') {
        try { await webR.FS.mkdir('/tmp'); } catch (e) { /* exists */ }
        await webR.FS.writeFile(csvPath, new TextEncoder().encode(opts.dataCsv));
      }
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
    'PORTFOLIOFIT - aggregate analysis: how did players do on easy vs hard puzzles?',
    '================================================================================',
    'Design. Each participant plays a series of PortfolioFit puzzles (a knapsack',
    'game): pack project bricks into a fixed 4x4 frame to maximise Net Value =',
    'value of the placed bricks minus $1 per empty cell, before the timer ends.',
    'Every puzzle is generated as EASY (Sahni kappa = 1) or HARD (kappa >= 2) and',
    'has exactly ONE optimal portfolio worth "Best Value"; a player whose Net Value',
    'reaches it solved the puzzle optimally ("reached the maximum").',
    '',
    'Data. The table picked in Section 3 arrives as the string DATA_CSV. Use the',
    'ROUNDS table (the default) - one row per completed puzzle. Columns used:',
    '  Player       anonymous label (p1, p2, ...) - one per participant',
    '  Session      the session code the player joined with',
    '  Difficulty   easy | hard',
    '  Time (s)     seconds spent on that puzzle',
    '  Net Value    the score reached ($)',
    '  Best Value   the puzzle optimum ($)',
    '  Fitness %    Net Value / Best Value x 100 (fallback when Best Value is',
    '               missing: 100% = optimal)',
    '  Puzzle ID    which puzzle it was',
    '',
    'What it prints, in order:',
    '  1. Participation - users who played, easy / hard puzzles completed.',
    '  2. Time - average time to complete an easy / hard puzzle. Each USER is',
    '     weighted equally (their own mean is computed first), so one player who',
    '     played many puzzles cannot dominate the average.',
    '  3. Success - the % of users who reached the maximum in at least one easy /',
    '     hard puzzle, plus the per-round solve rate, and the % of users who got',
    '     within 5% / within 10% of the maximum at least once (cumulative: a user',
    '     at the maximum also counts as within 5% and 10%).',
    '  4. Easy vs hard - a Welch t-test on the per-user times and a two-proportion',
    '     z-test on the user-level solve rates.',
    '  5. A per-puzzle breakdown (plays, average time, solve rate).',
    'Then 3 figures: (1) puzzles played, (2) time-to-complete distributions,',
    '(3) the share of users reaching the maximum - each easy vs hard.',
    '"""',
    '',
    'import io',
    'import numpy as np',
    'import pandas as pd',
    'import matplotlib',
    'matplotlib.use("Agg")               # headless backend; the page harvests the figures',
    'import matplotlib.pyplot as plt',
    'from scipy import stats as st',
    '',
    'df = pd.read_csv(io.StringIO(DATA_CSV))',
    '',
    '# -- tolerant column lookup (case / spacing / punctuation insensitive) ---------',
    'def _norm(s):',
    '    return "".join(ch for ch in str(s).lower() if ch.isalnum())',
    'def find_col(*names):',
    '    m = {_norm(c): c for c in df.columns}',
    '    for n in names:',
    '        if _norm(n) in m:',
    '            return m[_norm(n)]',
    '    return None',
    '',
    'C_PLAYER = find_col("Player", "account_id", "participant")',
    'C_SESS   = find_col("Session", "session_id")',
    'C_DIFF   = find_col("Difficulty", "diff")',
    'C_TIME   = find_col("Time (s)", "time_s", "time")',
    'C_NET    = find_col("Net Value", "net")',
    'C_BEST   = find_col("Best Value", "bestValue")',
    'C_FIT    = find_col("Fitness %", "fitness")',
    'C_PUZ    = find_col("Puzzle ID", "puzzleId", "Puzzle")',
    'missing = [n for n, c in [("Player", C_PLAYER), ("Difficulty", C_DIFF)] if c is None]',
    'if missing:',
    '    raise SystemExit("This table is missing column(s): %s. Pick the ROUNDS table in Section 3." % ", ".join(missing))',
    '',
    '# -- derived columns ------------------------------------------------------------',
    '# One user = one Player within one Session (labels are unique per participant,',
    '# but pairing with the session keeps stacked imports from colliding).',
    'df["_user"] = df[C_PLAYER].astype(str) + "|" + (df[C_SESS].astype(str) if C_SESS else "")',
    'df["_diff"] = df[C_DIFF].astype(str).str.strip().str.lower().str[:1].map({"e": "easy", "h": "hard"})',
    'df = df[df["_diff"].notna()].copy()',
    'if not len(df):',
    '    raise SystemExit("No rounds with an easy/hard difficulty found - load data in Section 1 and pick the Rounds table.")',
    'df["_time"] = pd.to_numeric(df[C_TIME], errors="coerce") if C_TIME else np.nan',
    'net  = pd.to_numeric(df[C_NET],  errors="coerce") if C_NET  else pd.Series(np.nan, index=df.index)',
    'best = pd.to_numeric(df[C_BEST], errors="coerce") if C_BEST else pd.Series(np.nan, index=df.index)',
    'fit  = pd.to_numeric(df[C_FIT],  errors="coerce") if C_FIT  else pd.Series(np.nan, index=df.index)',
    '# Reached the maximum: Net Value >= Best Value when both are present, else',
    '# Fitness >= 100 as a fallback; otherwise unknown (NaN, excluded from rates).',
    '# Within 5% / 10% of the maximum: Net Value >= 95% / 90% of Best Value (Best',
    '# Value is always positive), fallback Fitness >= 95 / 90 - cumulative.',
    'has_nb = net.notna() & best.notna()',
    'def flag(frac, fit_min):',
    '    s = pd.Series(np.nan, index=df.index)',
    '    s[has_nb] = (net[has_nb] >= frac * best[has_nb]).astype(float)',
    '    fb = s.isna() & fit.notna()',
    '    s[fb] = (fit[fb] >= fit_min).astype(float)',
    '    return s',
    'df["_max"]    = flag(1.00, 100)',
    'df["_near5"]  = flag(0.95, 95)',
    'df["_near10"] = flag(0.90, 90)',
    '',
    'def line(ch="-"):',
    '    print(ch * 78)',
    '',
    '# 1 -- participation --------------------------------------------------------------',
    'line("="); print("1. PARTICIPATION"); line("=")',
    'n_users = df["_user"].nunique()',
    'n_easy  = int((df["_diff"] == "easy").sum())',
    'n_hard  = int((df["_diff"] == "hard").sum())',
    'print(f"Users who played (>=1 completed puzzle): {n_users}")',
    'print(f"Easy puzzles completed:  {n_easy}")',
    'print(f"Hard puzzles completed:  {n_hard}")',
    'print(f"Puzzles per user (mean): {len(df) / n_users:.2f}")',
    '',
    '# 2 -- time to complete (each user weighted equally) -------------------------------',
    'line("="); print("2. TIME TO COMPLETE (each user weighted equally)"); line("=")',
    'per_user_time = df.groupby(["_user", "_diff"])["_time"].mean().unstack()',
    'te = per_user_time["easy"].dropna() if "easy" in per_user_time.columns else pd.Series(dtype=float)',
    'th = per_user_time["hard"].dropna() if "hard" in per_user_time.columns else pd.Series(dtype=float)',
    'for d, col in (("easy", te), ("hard", th)):',
    '    if len(col):',
    '        sd = col.std(ddof=1) if len(col) > 1 else 0.0',
    '        print(f"{d.capitalize():5s}: mean {col.mean():6.1f} s per puzzle   (SD {sd:.1f}, users n={len(col)})")',
    '    else:',
    '        print(f"{d.capitalize():5s}: no timed rounds")',
    '',
    '# 3 -- reaching the maximum ---------------------------------------------------------',
    'line("="); print("3. REACHING THE MAXIMUM (the single optimal portfolio)"); line("=")',
    'user_max = {"easy": None, "hard": None}',
    'for d in ("easy", "hard"):',
    '    sub = df[(df["_diff"] == d) & df["_max"].notna()]',
    '    if not len(sub):',
    '        print(f"{d.capitalize():5s}: no rounds with a known optimum")',
    '        continue',
    '    per_user = sub.groupby("_user")["_max"].max()   # 1 if the user hit the optimum at least once',
    '    k, n = int(per_user.sum()), len(per_user)',
    '    user_max[d] = (k, n)',
    '    kr = int(sub["_max"].sum())',
    '    rr = sub["_max"].mean() * 100   # per-round solve rate',
    '    print(f"{d.capitalize():5s}: {k}/{n} users reached the maximum at least once ({k / n * 100:.1f}%); per-round solve rate {rr:.1f}% ({kr}/{len(sub)} rounds)")',
    '    for lbl, coln in ((" 5", "_near5"), ("10", "_near10")):',
    '        kn = int(sub.groupby("_user")[coln].max().sum())',
    '        print(f"       within {lbl}% of the maximum at least once: {kn}/{n} users ({kn / n * 100:.1f}%)")',
    '',
    '# 4 -- easy vs hard -----------------------------------------------------------------',
    'line("="); print("4. EASY vs HARD"); line("=")',
    'if len(te) > 1 and len(th) > 1:',
    '    t, p = st.ttest_ind(te, th, equal_var=False)   # Welch: users are independent',
    '    print(f"Time (per-user means): easy {te.mean():.1f} s vs hard {th.mean():.1f} s -> Welch t = {t:.2f}, p = {p:.4f}")',
    'else:',
    '    print("Time: not enough users with timed rounds in both difficulties for a test")',
    'if user_max["easy"] and user_max["hard"]:',
    '    (k1, n1), (k2, n2) = user_max["easy"], user_max["hard"]',
    '    p1, p2 = k1 / n1, k2 / n2',
    '    pp = (k1 + k2) / (n1 + n2)',
    '    se = (pp * (1 - pp) * (1 / n1 + 1 / n2)) ** 0.5',
    '    if se > 0:',
    '        z = (p1 - p2) / se',
    '        pz = 2 * (1 - st.norm.cdf(abs(z)))',
    '        print(f"Solve rate (users): easy {p1 * 100:.1f}% vs hard {p2 * 100:.1f}% -> z = {z:.2f}, p = {pz:.4f}")',
    '    else:',
    '        print("Solve rate: both groups at 0% or 100% - no variance to test")',
    'else:',
    '    print("Solve rate: need rounds with a known optimum in both difficulties")',
    '',
    '# 5 -- per-puzzle breakdown -----------------------------------------------------------',
    'line("="); print("5. PER-PUZZLE BREAKDOWN"); line("=")',
    'if C_PUZ:',
    '    g = df.groupby([C_PUZ, "_diff"], dropna=False)',
    '    tbl = pd.DataFrame({',
    '        "plays": g.size(),',
    '        "avg_time_s": g["_time"].mean().round(1),',
    '        "solve_rate_pct": (g["_max"].mean() * 100).round(1),',
    '    }).reset_index().rename(columns={C_PUZ: "puzzle", "_diff": "difficulty"})',
    '    tbl = tbl.sort_values(["difficulty", "plays"], ascending=[True, False])',
    '    print(tbl.to_string(index=False))',
    'else:',
    '    print("(no Puzzle ID column in this table)")',
    '',
    '# -- figures (harvested by the page and shown under the output) -----------------',
    'BLUE, ORANGE = "#4c72b0", "#e67e22"',
    '',
    '# Figure 1 - how many easy / hard puzzles were completed',
    'fig, ax = plt.subplots(figsize=(6, 3.4))',
    'ax.bar(["Easy", "Hard"], [n_easy, n_hard], color=[BLUE, ORANGE])',
    'for i, v in enumerate([n_easy, n_hard]):',
    '    ax.text(i, v, f" {v}", ha="center", va="bottom", fontweight="bold")',
    'ax.set_ylabel("Puzzles completed")',
    'ax.set_title(f"Puzzles played ({n_users} users)")',
    'fig.tight_layout()',
    '',
    '# Figure 2 - how long a puzzle took, easy vs hard (per-user averages)',
    'groups = [(lbl, s.values) for lbl, s in (("Easy", te), ("Hard", th)) if len(s)]',
    'if groups:',
    '    fig, ax = plt.subplots(figsize=(6, 3.4))',
    '    ax.boxplot([g[1] for g in groups], showmeans=True)   # (labels= was removed in matplotlib 3.9)',
    '    ax.set_xticks(range(1, len(groups) + 1))',
    '    ax.set_xticklabels([g[0] for g in groups])',
    '    ax.set_ylabel("Seconds per puzzle (user average)")',
    '    ax.set_title("Time to complete a puzzle")',
    '    fig.tight_layout()',
    '',
    '# Figure 3 - the share of users who reached the maximum at least once',
    'vals, labs, cols = [], [], []',
    'for d, c in (("easy", BLUE), ("hard", ORANGE)):',
    '    if user_max[d]:',
    '        k, n = user_max[d]',
    '        vals.append(k / n * 100)',
    '        labs.append(f"{d.capitalize()}\\n({k}/{n} users)")',
    '        cols.append(c)',
    'if vals:',
    '    fig, ax = plt.subplots(figsize=(6, 3.4))',
    '    ax.bar(labs, vals, color=cols)',
    '    for i, v in enumerate(vals):',
    '        ax.text(i, v, f" {v:.0f}%", ha="center", va="bottom", fontweight="bold")',
    '    ax.set_ylim(0, 108)',
    '    ax.set_ylabel("% of users")',
    '    ax.set_title("Users who reached the maximum value at least once")',
    '    fig.tight_layout()',
    '',
    'print()',
    'print("Done. Figures (if any) are shown below the output.")'
  ].join('\n');

  var DA_R_TEMPLATE = [
    '# ==============================================================================',
    '# PORTFOLIOFIT - aggregate analysis: how did players do on easy vs hard puzzles?',
    '# ==============================================================================',
    '# Computes the SAME numbers as the Python template, with base R only.',
    '# The table picked in Section 3 is at /tmp/data.csv - use the ROUNDS table',
    '# (one row per completed puzzle). Columns used: Player, Session, Difficulty,',
    '# Time (s), Net Value, Best Value, Fitness %, Puzzle ID.',
    '# "Reached the maximum" = Net Value >= Best Value (both known), else',
    '# Fitness >= 100 as a fallback, else unknown (excluded from the rates).',
    '# "Within 5% / 10% of the maximum" = Net Value >= 95% / 90% of Best Value,',
    '# fallback Fitness >= 95 / 90 - cumulative (the maximum counts as within both).',
    '',
    'df <- read.csv("/tmp/data.csv", check.names = FALSE, stringsAsFactors = FALSE)',
    '',
    '# -- tolerant column lookup (case / spacing / punctuation insensitive) ---------',
    'norm <- function(s) gsub("[^a-z0-9]", "", tolower(s))',
    'find_col <- function(...) {',
    '  want <- vapply(list(...), norm, "")',
    '  have <- vapply(names(df), norm, "")',
    '  for (w in want) { i <- match(w, have); if (!is.na(i)) return(names(df)[i]) }',
    '  NA_character_',
    '}',
    'C_PLAYER <- find_col("Player", "account_id", "participant")',
    'C_SESS   <- find_col("Session", "session_id")',
    'C_DIFF   <- find_col("Difficulty", "diff")',
    'C_TIME   <- find_col("Time (s)", "time_s", "time")',
    'C_NET    <- find_col("Net Value", "net")',
    'C_BEST   <- find_col("Best Value", "bestValue")',
    'C_FIT    <- find_col("Fitness %", "fitness")',
    'C_PUZ    <- find_col("Puzzle ID", "puzzleId", "Puzzle")',
    'if (is.na(C_PLAYER) || is.na(C_DIFF)) stop("This table is missing Player/Difficulty - pick the ROUNDS table in Section 3.")',
    '',
    'num <- function(x) suppressWarnings(as.numeric(x))',
    'd0 <- substr(trimws(tolower(as.character(df[[C_DIFF]]))), 1, 1)',
    'df$diff2 <- ifelse(d0 == "e", "easy", ifelse(d0 == "h", "hard", NA))',
    'df <- df[!is.na(df$diff2), ]',
    'if (!nrow(df)) stop("No rounds with an easy/hard difficulty found - load data in Section 1 and pick the Rounds table.")',
    '# One user = one Player within one Session (keeps stacked imports apart).',
    'df$user <- paste0(as.character(df[[C_PLAYER]]), "|", if (!is.na(C_SESS)) as.character(df[[C_SESS]]) else "")',
    'df$time2 <- if (!is.na(C_TIME)) num(df[[C_TIME]]) else rep(NA_real_, nrow(df))',
    'netv  <- if (!is.na(C_NET))  num(df[[C_NET]])  else rep(NA_real_, nrow(df))',
    'bestv <- if (!is.na(C_BEST)) num(df[[C_BEST]]) else rep(NA_real_, nrow(df))',
    'fitv  <- if (!is.na(C_FIT))  num(df[[C_FIT]])  else rep(NA_real_, nrow(df))',
    'flag <- function(frac, fit_min) ifelse(!is.na(netv) & !is.na(bestv), as.numeric(netv >= frac * bestv),',
    '                                ifelse(!is.na(fitv), as.numeric(fitv >= fit_min), NA))',
    'df$max2   <- flag(1.00, 100)',
    'df$near5  <- flag(0.95, 95)',
    'df$near10 <- flag(0.90, 90)',
    '',
    'line <- function(ch = "-") cat(strrep(ch, 78), "\\n", sep = "")',
    '',
    '# 1 -- participation ------------------------------------------------------------',
    'line("="); cat("1. PARTICIPATION\\n"); line("=")',
    'n_users <- length(unique(df$user))',
    'n_easy <- sum(df$diff2 == "easy"); n_hard <- sum(df$diff2 == "hard")',
    'cat(sprintf("Users who played (>=1 completed puzzle): %d\\n", n_users))',
    'cat(sprintf("Easy puzzles completed:  %d\\n", n_easy))',
    'cat(sprintf("Hard puzzles completed:  %d\\n", n_hard))',
    'cat(sprintf("Puzzles per user (mean): %.2f\\n", nrow(df) / n_users))',
    '',
    '# 2 -- time to complete (each user weighted equally) -----------------------------',
    'line("="); cat("2. TIME TO COMPLETE (each user weighted equally)\\n"); line("=")',
    'pu <- if (all(is.na(df$time2))) {',
    '  data.frame(user = character(), diff2 = character(), time2 = numeric())',
    '} else {',
    '  aggregate(time2 ~ user + diff2, data = df, FUN = mean)',
    '}',
    'te <- pu$time2[pu$diff2 == "easy"]; th <- pu$time2[pu$diff2 == "hard"]',
    'for (d in c("easy", "hard")) {',
    '  v <- if (d == "easy") te else th',
    '  if (length(v)) cat(sprintf("%-5s: mean %6.1f s per puzzle   (SD %.1f, users n=%d)\\n",',
    '                             d, mean(v), if (length(v) > 1) sd(v) else 0, length(v)))',
    '  else cat(sprintf("%-5s: no timed rounds\\n", d))',
    '}',
    '',
    '# 3 -- reaching the maximum -------------------------------------------------------',
    'line("="); cat("3. REACHING THE MAXIMUM (the single optimal portfolio)\\n"); line("=")',
    'um <- list()',
    'for (d in c("easy", "hard")) {',
    '  sub <- df[df$diff2 == d & !is.na(df$max2), ]',
    '  if (!nrow(sub)) { cat(sprintf("%-5s: no rounds with a known optimum\\n", d)); next }',
    '  per <- tapply(sub$max2, sub$user, max)   # 1 if the user hit the optimum at least once',
    '  k <- as.integer(sum(per)); n <- length(per)',
    '  um[[d]] <- c(k, n)',
    '  cat(sprintf("%-5s: %d/%d users reached the maximum at least once (%.1f%%); per-round solve rate %.1f%% (%d/%d rounds)\\n",',
    '      d, k, n, 100 * k / n, 100 * mean(sub$max2), as.integer(sum(sub$max2)), nrow(sub)))',
    '  k5  <- as.integer(sum(tapply(sub$near5,  sub$user, max)))',
    '  k10 <- as.integer(sum(tapply(sub$near10, sub$user, max)))',
    '  cat(sprintf("       within  5%% of the maximum at least once: %d/%d users (%.1f%%)\\n", k5, n, 100 * k5 / n))',
    '  cat(sprintf("       within 10%% of the maximum at least once: %d/%d users (%.1f%%)\\n", k10, n, 100 * k10 / n))',
    '}',
    '',
    '# 4 -- easy vs hard -----------------------------------------------------------------',
    'line("="); cat("4. EASY vs HARD\\n"); line("=")',
    'if (length(te) > 1 && length(th) > 1) {',
    '  tt <- t.test(te, th)   # Welch: users are independent',
    '  cat(sprintf("Time (per-user means): easy %.1f s vs hard %.1f s -> Welch t = %.2f, p = %.4f\\n",',
    '      mean(te), mean(th), tt$statistic, tt$p.value))',
    '} else cat("Time: not enough users with timed rounds in both difficulties for a test\\n")',
    'if (!is.null(um$easy) && !is.null(um$hard)) {',
    '  pt <- suppressWarnings(prop.test(c(um$easy[1], um$hard[1]), c(um$easy[2], um$hard[2])))',
    '  cat(sprintf("Solve rate (users): easy %.1f%% vs hard %.1f%% -> two-proportion test p = %.4f\\n",',
    '      100 * um$easy[1] / um$easy[2], 100 * um$hard[1] / um$hard[2], pt$p.value))',
    '} else cat("Solve rate: need rounds with a known optimum in both difficulties\\n")',
    '',
    '# 5 -- per-puzzle breakdown -----------------------------------------------------------',
    'line("="); cat("5. PER-PUZZLE BREAKDOWN\\n"); line("=")',
    'if (!is.na(C_PUZ)) {',
    '  key <- paste(as.character(df[[C_PUZ]]), df$diff2, sep = " | ")',
    '  plays <- tapply(rep(1, nrow(df)), key, sum)',
    '  avgt <- tapply(df$time2, key, function(v) round(mean(v, na.rm = TRUE), 1))',
    '  solv <- tapply(df$max2, key, function(v) round(100 * mean(v, na.rm = TRUE), 1))',
    '  out <- data.frame(puzzle = names(plays), plays = as.integer(plays),',
    '                    avg_time_s = as.numeric(avgt[names(plays)]),',
    '                    solve_rate_pct = as.numeric(solv[names(plays)]))',
    '  print(out[order(out$puzzle), ], row.names = FALSE)',
    '} else cat("(no Puzzle ID column in this table)\\n")',
    '',
    '# -- figures (captured by the page and shown under the output) -------------------',
    '# NOTE: R needs 6-digit hex colours (3-digit like #888 fail).',
    'BLUE <- "#4c72b0"; ORANGE <- "#e67e22"',
    '',
    '# Figure 1 - how many easy / hard puzzles were completed',
    'bp <- barplot(c(n_easy, n_hard), names.arg = c("Easy", "Hard"), col = c(BLUE, ORANGE),',
    '              ylab = "Puzzles completed", main = sprintf("Puzzles played (%d users)", n_users),',
    '              ylim = c(0, max(1, n_easy, n_hard) * 1.15))',
    'text(bp, c(n_easy, n_hard), labels = c(n_easy, n_hard), pos = 3, font = 2)',
    '',
    '# Figure 2 - how long a puzzle took, easy vs hard (per-user averages)',
    'vals <- list(); labs <- c(); cls <- c()',
    'if (length(te)) { vals <- c(vals, list(te)); labs <- c(labs, "Easy"); cls <- c(cls, BLUE) }',
    'if (length(th)) { vals <- c(vals, list(th)); labs <- c(labs, "Hard"); cls <- c(cls, ORANGE) }',
    'if (length(vals)) boxplot(vals, names = labs, col = cls,',
    '                          ylab = "Seconds per puzzle (user average)",',
    '                          main = "Time to complete a puzzle")',
    '',
    '# Figure 3 - the share of users who reached the maximum at least once',
    'vals <- c(); labs <- c(); cls <- c()',
    'if (!is.null(um$easy)) { vals <- c(vals, 100 * um$easy[1] / um$easy[2]); labs <- c(labs, sprintf("Easy (%d/%d)", um$easy[1], um$easy[2])); cls <- c(cls, BLUE) }',
    'if (!is.null(um$hard)) { vals <- c(vals, 100 * um$hard[1] / um$hard[2]); labs <- c(labs, sprintf("Hard (%d/%d)", um$hard[1], um$hard[2])); cls <- c(cls, ORANGE) }',
    'if (length(vals)) {',
    '  bp <- barplot(vals, names.arg = labs, col = cls, ylim = c(0, 108), ylab = "% of users",',
    '                main = "Users who reached the maximum value at least once")',
    '  text(bp, vals, labels = sprintf("%.0f%%", vals), pos = 3, font = 2)',
    '}',
    '',
    'cat("\\nDone. Figures (if any) are shown below the output.\\n")'
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
