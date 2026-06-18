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
  var QUESTION_TYPES = ['text', 'email', 'password', 'number', 'select', 'radio', 'textarea'];
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
      + '.pfa-err{color:#e74c3c;font-size:13px;min-height:18px;margin:6px 0;}';
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
    cfg = { texts: {}, settings: {}, registrationQuestions: [], surveyQuestions: [] };
    try {
      var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'config', 'app'));
      if (snap.exists()) { var d = snap.data(); cfg = { texts: d.texts || {}, settings: d.settings || {}, registrationQuestions: d.registrationQuestions || [], surveyQuestions: d.surveyQuestions || [] }; }
    } catch (e) { /* defaults empty */ }
  }
  async function saveConfig(partial) {
    await fb.F.setDoc(fb.F.doc(fb.db, 'config', 'app'),
      Object.assign({}, partial, { updatedAt: fb.F.serverTimestamp() }), { merge: true });
  }

  // ---- Routing ----
  function cachedAdmin() { try { return localStorage.getItem('pfa-admin') === '1'; } catch (e) { return false; } }
  function route() {
    if (!user) { try { localStorage.removeItem('pfa-admin'); } catch (e) {} return renderLogin(); }
    if (user.email !== ADMIN_EMAIL) { try { localStorage.removeItem('pfa-admin'); } catch (e) {} return renderNotAuthorized(); }
    try { localStorage.setItem('pfa-admin', '1'); } catch (e) {}
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

  function renderShell() {
    clearRoot();
    var tabs = [['content', 'Content'], ['registration', 'Registration'], ['survey', 'Survey'], ['puzzles', 'Puzzles'], ['settings', 'Settings'], ['sessions', 'Sessions'], ['participants', 'Participants']];
    var tabBar = el('div', { class: 'pfa-tabs' }, tabs.map(function (t) {
      return el('button', { class: tab === t[0] ? 'on' : '', on: { click: function () { tab = t[0]; renderShell(); } } }, [t[1]]);
    }));
    var body = el('div', {});
    var wrap = el('div', { class: 'pfa-wrap' }, [
      el('div', { class: 'pfa-h' }, [
        el('h1', { text: 'PortfolioFit admin' }),
        el('div', { style: 'display:flex;gap:8px;align-items:center;' }, [themeToggle(),
          el('button', { class: 'pfa-btn sec sm', on: { click: function () { if (fb) fb.A.signOut(fb.auth); } } }, ['Sign out'])])
      ]),
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
    card.appendChild(el('p', { class: 'pfa-note', text: title + '. Drag order with the up/down buttons. System fields (Participant ID, e-mail, password) are required by the app.' }));
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
    card.appendChild(el('p', { class: 'pfa-note', html: 'Build the exact set every participant plays: <b>Generate set to match Settings</b> creates puzzles to match your easy/hard counts; review each (Solutions / κ proof), regenerate any you dislike, then <b>Save</b> to freeze. Every participant then plays that same frozen set in randomized order. (You can also add puzzles one at a time.)' }));
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
        el('div', { class: 'pfa-note', text: diff.toUpperCase() + ' — ' + spec.region.length + ' cells, Sahni κ=' + spec.kappa + (solCount != null ? ' · ' + solCount + ' distinct solution' + (solCount === 1 ? '' : 's') : '') + ' · best $' + spec.bestValue }),
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
    var teasy = el('input', { type: 'number', value: String(tl.easy != null ? tl.easy : 120), style: 'max-width:120px;' });
    var thard = el('input', { type: 'number', value: String(tl.hard != null ? tl.hard : 180), style: 'max-width:120px;' });
    var rnd = el('input', { type: 'checkbox' }); if (s.randomizeOrder !== false) rnd.setAttribute('checked', 'checked');
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy puzzles per participant' }), easy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard puzzles per participant' }), hard]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy time limit (seconds per puzzle)' }), teasy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard time limit (seconds per puzzle)' }), thard]),
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
        timeLimits: { easy: parseInt(teasy.value, 10) || 120, hard: parseInt(thard.value, 10) || 180 },
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
      el('p', { class: 'pfa-note', html: 'Create a <b>session</b>, then share its <b>Session ID</b> (or a <code>?session=CODE</code> link) with players — they enter it on the welcome screen to join. A session snapshots the <b>current configuration</b> (Content, questions, Settings and the active puzzle set); players with no code get the default configuration. <b>Close</b> a session to block new joins; data already collected is unaffected.' })
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
      listCard.appendChild(el('h3', { id: 'pfa-sess-h', text: 'Sessions', style: 'margin:0 0 8px;font-size:15px;' }));
      var hint = el('div', {}); listCard.appendChild(hint);
      Promise.all([
        fb.F.getDocs(fb.F.collection(fb.db, 'sessions')),
        fb.F.getDocs(fb.F.collection(fb.db, 'participants'))
      ]).then(function (res) {
        var docs = []; res[0].forEach(function (d) { docs.push(Object.assign({ _id: d.id }, d.data())); });
        var counts = {}; res[1].forEach(function (d) { var sid = (d.data() || {}).sessionId; if (sid) counts[sid] = (counts[sid] || 0) + 1; });
        docs.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        var h = listCard.querySelector('#pfa-sess-h'); if (h) h.textContent = docs.length + ' session' + (docs.length === 1 ? '' : 's');
        if (!docs.length) { hint.appendChild(el('p', { class: 'pfa-note', text: 'No sessions yet. Create one above.' })); return; }
        var table = el('table', { class: 'pfa-tbl' });
        table.appendChild(el('thead', {}, [el('tr', {}, ['Session ID', 'Name', 'Status', 'Participants', 'Created', ''].map(function (th) { return el('th', { text: th }); }))]));
        var tb = el('tbody', {});
        docs.forEach(function (s) {
          var closed = s.status === 'closed';
          var actions = [el('button', { class: 'pfa-btn sec sm', on: { click: function () { copyText(s._id, 'Session ID copied.'); } } }, ['copy ID'])];
          if (closed) actions.push(el('button', { class: 'pfa-btn sec sm', on: { click: function () { setStatus(s._id, 'open'); } } }, ['reopen']));
          else actions.push(el('button', { class: 'pfa-btn sec sm', on: { click: function () { setStatus(s._id, 'closed'); } } }, ['close']));
          actions.push(el('button', { class: 'pfa-btn danger sm', on: { click: function () { delSession(s._id); } } }, ['delete']));
          tb.appendChild(el('tr', {}, [
            el('td', {}, [el('b', { text: s._id })]),
            el('td', { text: s.name || s.label || '' }),
            el('td', { text: closed ? 'Closed' : 'Open' }),
            el('td', { text: String(counts[s._id] || 0) }),
            el('td', { text: fmtTs(s.createdAt) }),
            el('td', {}, [el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' }, actions)])
          ]));
        });
        table.appendChild(tb);
        hint.appendChild(table);
      }).catch(function (e) { hint.appendChild(el('p', { class: 'pfa-err', text: 'Could not load sessions: ' + ((e && e.code) || 'error') })); });
    }

    function setStatus(code, status) {
      fb.F.setDoc(fb.F.doc(fb.db, 'sessions', code), { status: status, updatedAt: fb.F.serverTimestamp() }, { merge: true })
        .then(function () { toast(status === 'closed' ? 'Session closed to new joins.' : 'Session reopened.'); loadList(); })
        .catch(function (e) { toast('Failed: ' + ((e && e.code) || 'error')); });
    }
    function delSession(code) {
      if (!window.confirm('Delete session "' + code + '"? Players can no longer join with this code. (Already-collected player data is not affected.)')) return;
      fb.F.deleteDoc(fb.F.doc(fb.db, 'sessions', code)).then(function () { toast('Session deleted.'); loadList(); })
        .catch(function (e) { toast('Delete failed: ' + ((e && e.code) || 'error')); });
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
    parts.sort(function (a, b) { return (tsMs(a.createdAt) - tsMs(b.createdAt)); });

    body.innerHTML = '';
    var head = el('div', { class: 'pfa-h' }, [
      el('div', { class: 'pfa-note', text: parts.length + ' participant' + (parts.length === 1 ? '' : 's') }),
      el('button', { class: 'pfa-btn', on: { click: function () { exportExcel(parts); } } }, ['Export to Excel'])
    ]);
    var rows = parts.map(function (p) {
      var who = p.anonymousLabel || p.participantId || p.email || p._id;
      return el('tr', {}, [
        el('td', { text: who }),
        el('td', { text: p.sessionId || '—' }),
        el('td', { text: p.status || '' }),
        el('td', { text: fmtTs(p.createdAt) }),
        el('td', {}, [el('button', { class: 'pfa-btn danger sm', on: { click: function () { deleteParticipant(p._id, who); } } }, ['delete'])])
      ]);
    });
    var table = el('table', { class: 'pfa-tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, ['Player', 'Session', 'Status', 'Started', ''].map(function (h) { return el('th', { text: h }); }))]));
    table.appendChild(el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: '5', text: 'No players yet.' })])]));
    body.appendChild(el('div', { class: 'pfa-card' }, [head, table]));

    async function deleteParticipant(uid, who) {
      if (!window.confirm('Delete participant "' + who + '" and all their data? This cannot be undone.')) return;
      toast('Deleting…');
      try {
        var names = ['events', 'rounds'];
        for (var n = 0; n < names.length; n++) {
          try {
            var sn = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, names[n]));
            for (var j = 0; j < sn.docs.length; j++) { try { await fb.F.deleteDoc(sn.docs[j].ref); } catch (e) {} }
          } catch (e) {}
        }
        try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers')); } catch (e) {}
        await fb.F.deleteDoc(fb.F.doc(fb.db, 'participants', uid));
        toast('Participant deleted.');
        renderParticipants(body);
      } catch (e) { toast('Delete failed: ' + ((e && e.code) || 'error')); }
    }
  }

  function tsMs(ts) { if (!ts) return 0; if (typeof ts.toMillis === 'function') return ts.toMillis(); if (ts.seconds) return ts.seconds * 1000; return 0; }
  function fmtTs(ts) { var m = tsMs(ts); return m ? new Date(m).toLocaleString() : ''; }

  // ---- Excel export ----
  async function ensureXLSX() {
    if (XLSX) return XLSX;
    XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    return XLSX;
  }
  async function exportExcel(parts) {
    toast('Building export...');
    try {
      var X = await ensureXLSX();
      var pRows = [], eRows = [], rRows = [], sRows = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], uid = p._id;
        var base = { player: p.anonymousLabel || p.participantId || '', session: p.sessionId || '', email: p.email || '', status: p.status || '', started: fmtTs(p.createdAt), uid: uid };
        var reg = p.registration || {};
        pRows.push(Object.assign({}, base, flatten(reg)));
        // events
        try {
          var es = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'events'));
          es.forEach(function (d) { var v = d.data(); eRows.push({ player: base.player, session: base.session, uid: uid, seq: v.seq, type: v.type, phase: v.phase, round: v.round, puzzleId: v.puzzleId, net: v.net, coverage: v.coverage, clientTime: v.clientTime, data: v.dataJson }); });
        } catch (e) {}
        // rounds
        try {
          var rs = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'rounds'));
          rs.forEach(function (d) { var v = d.data(); rRows.push({ player: base.player, session: base.session, uid: uid, puzzleId: v.puzzleId, index: v.index, diff: v.diff, net: v.net, value: v.value, cost: v.cost, coverage: v.coverage, fitness: v.fitness, placed: v.placed, total: v.total, time: v.time, placements: v.placementsJson }); });
        } catch (e) {}
        // survey
        try {
          var sd = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers'));
          if (sd.exists()) { var sv = sd.data(); sRows.push(Object.assign({ player: base.player, session: base.session, uid: uid, completedAt: fmtTs(sv.completedAt) }, flatten(sv.answers || {}))); }
        } catch (e) {}
      }
      var wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(pRows.length ? pRows : [{}]), 'Participants');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(eRows.length ? eRows : [{}]), 'Events');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rRows.length ? rRows : [{}]), 'Rounds');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sRows.length ? sRows : [{}]), 'Survey');
      var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      X.writeFile(wb, 'portfoliofit-data-' + stamp + '.xlsx');
      toast('Export ready.');
    } catch (e) { toast('Export failed: ' + ((e && e.message) || 'error')); console.error('[PFA] export failed', e); }
  }
  function flatten(obj) { var o = {}; Object.keys(obj || {}).forEach(function (k) { var v = obj[k]; o['reg_' + k] = (v && typeof v === 'object') ? JSON.stringify(v) : v; }); return o; }

  // ---- bootstrap ----
  async function init() {
    if (inited) return; inited = true;
    injectStyles();
    root = el('div', { id: 'pfa-root' }, [el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card' }, [el('p', { text: 'Connecting...' })])])]);
    document.body.appendChild(root);
    applyTheme(currentTheme());
    // Returning admin on this device: render the panel immediately (no
    // 'Connecting' flash). onAuthStateChanged then confirms the session, or
    // routes to login if it has expired.
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
