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
    apiKey: 'AIzaSyBn8PhDyVhWvfiJVCpC1eW6q1LBfwpMu38',
    authDomain: 'stouras-portfoliofit.firebaseapp.com',
    projectId: 'stouras-portfoliofit',
    storageBucket: 'stouras-portfoliofit.firebasestorage.app',
    messagingSenderId: '1031513619365',
    appId: '1:1031513619365:web:dc3195fab2eaf04f6bc64c'
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
  var fb = null, XLSX = null, cfg = {}, user = null, tab = 'content', approvedPuzzles = [];
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
      + '.pfa-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px;box-shadow:0 6px 18px rgba(0,0,0,.06);color:var(--ink);}'
      + '.pfa-field{margin:10px 0;}.pfa-field label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;color:var(--ink);}'
      + '.pfa-field input[type=text],.pfa-field input[type=email],.pfa-field input[type=password],.pfa-field input[type=number],.pfa-field select,.pfa-field textarea{width:100%;padding:9px 11px;border:1px solid var(--fieldline);border-radius:9px;font-size:14px;font-family:inherit;background:var(--field);color:var(--ink);}'
      + '.pfa-field textarea{resize:vertical;}'
      + '.pfa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px;cursor:pointer;}'
      + '.pfa-btn:hover{background:var(--accentd);}.pfa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.pfa-btn.sm{padding:5px 10px;font-size:12px;}.pfa-btn.danger{background:var(--panel);color:#e74c3c;border:1px solid #f0c7c1;}'
      + '.pfa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);}'
      + '.pfa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.pfa-q .row > *{flex:0 0 auto;}'
      + '.pfa-note{color:var(--muted);font-size:13px;}'
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
  function route() {
    if (!user) return renderLogin();
    if (user.email !== ADMIN_EMAIL) return renderNotAuthorized();
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
      el('button', { class: 'pfa-btn sec', on: { click: function () { fb.A.signOut(fb.auth); } } }, ['Sign out'])
    ])]));
  }

  function renderShell() {
    clearRoot();
    var tabs = [['content', 'Content'], ['registration', 'Registration'], ['survey', 'Survey'], ['puzzles', 'Puzzles'], ['settings', 'Settings'], ['participants', 'Participants']];
    var tabBar = el('div', { class: 'pfa-tabs' }, tabs.map(function (t) {
      return el('button', { class: tab === t[0] ? 'on' : '', on: { click: function () { tab = t[0]; renderShell(); } } }, [t[1]]);
    }));
    var body = el('div', {});
    var wrap = el('div', { class: 'pfa-wrap' }, [
      el('div', { class: 'pfa-h' }, [
        el('h1', { text: 'PortfolioFit admin' }),
        el('div', { style: 'display:flex;gap:8px;align-items:center;' }, [themeToggle(),
          el('button', { class: 'pfa-btn sec sm', on: { click: function () { fb.A.signOut(fb.auth); } } }, ['Sign out'])])
      ]),
      tabBar, body
    ]);
    root.appendChild(wrap);
    if (tab === 'content') renderContent(body);
    else if (tab === 'registration') renderQuestions(body, 'registrationQuestions', 'Registration questions');
    else if (tab === 'survey') renderQuestions(body, 'surveyQuestions', 'Survey questions');
    else if (tab === 'puzzles') renderPuzzles(body);
    else if (tab === 'settings') renderSettings(body);
    else if (tab === 'participants') renderParticipants(body);
  }

  // ---- Content tab (collapsible pages, each with default controls) ----
  function renderContent(body) {
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('p', { class: 'pfa-note', html: 'Edit the wording participants see on each page. Each field is pre-filled with the current text (the built-in default unless you have saved a change). <b>Make this the default</b> saves the page so participants see it. <b>Reset this page to defaults</b> reloads the saved/current values (discards unsaved edits). <b>Restore built-in default</b> reverts the page to the original wording.' })
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
        el('button', { class: 'pfa-btn', on: { click: makeDefault } }, ['Make this the default']),
        el('button', { class: 'pfa-btn sec', on: { click: function () { build(); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
        el('button', { class: 'pfa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default'])
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
    async function makeDefault() {
      var merged = Object.assign({}, cfg.texts, collect());
      try { await saveConfig({ texts: merged }); cfg.texts = merged; toast(g.label + ' saved.'); }
      catch (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }
    }
    async function restoreBuiltin() {
      var D = (window.PF_DEFAULTS && window.PF_DEFAULTS.texts) || {};
      var merged = Object.assign({}, cfg.texts);
      g.fields.forEach(function (key) { merged[key] = D[key]; });
      try { await saveConfig({ texts: merged }); cfg.texts = merged; build(); toast(g.label + ' restored to built-in default.'); }
      catch (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }
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
      el('button', { class: 'pfa-btn', on: { click: doSave } }, ['Make this the default']),
      el('button', { class: 'pfa-btn sec', on: { click: function () { list = builtinOrSaved(); render(); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
      el('button', { class: 'pfa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default'])
    ]));
    body.appendChild(card);
    render();

    function builtinOrSaved() { return ((cfg[field] && cfg[field].length) ? cfg[field] : ((window.PF_DEFAULTS && window.PF_DEFAULTS[field]) || [])).map(function (q) { return Object.assign({}, q); }); }
    async function restoreBuiltin() {
      list = ((window.PF_DEFAULTS && window.PF_DEFAULTS[field]) || []).map(function (q) { return Object.assign({}, q); });
      var patch = {}; patch[field] = list;
      try { await saveConfig(patch); cfg[field] = list.map(function (q) { return Object.assign({}, q); }); render(); toast('Restored built-in default.'); }
      catch (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }
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
    async function doSave() {
      var patch = {}; patch[field] = list;
      try { await saveConfig(patch); cfg[field] = list.map(function (q) { return Object.assign({}, q); }); toast(title + ' saved.'); }
      catch (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }
    }
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
    card.appendChild(el('p', { class: 'pfa-note', text: 'Generate puzzles, preview them, approve the ones you want, then freeze them as the active set. Every participant plays the frozen set in randomized order.' }));
    card.appendChild(el('p', { class: 'pfa-note', html: '📄 <a href="https://www.stouras.com/lab/portfoliofit-testing/portfoliofit-difficulty.pdf" target="_blank" rel="noopener" style="color:var(--accent);">How the Sahni difficulty (κ) is measured (PDF note)</a>' }));
    if (!window.PFGame || !window.PFGame.generatePuzzle) {
      card.appendChild(el('p', { class: 'pfa-err', text: 'Puzzle generator not available. Open /lab/portfoliofit/?admin (the game must be on the page).' }));
      body.appendChild(card); return;
    }
    card.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
      el('button', { class: 'pfa-btn sec', on: { click: function () { generate('easy'); } } }, ['Generate easy']),
      el('button', { class: 'pfa-btn sec', on: { click: function () { generate('hard'); } } }, ['Generate hard'])
    ]));
    var preview = el('div', {});
    card.appendChild(preview);
    body.appendChild(card);
    var approvedCard = el('div', { class: 'pfa-card' });
    var activeCard = el('div', { class: 'pfa-card' });
    body.appendChild(approvedCard); body.appendChild(activeCard);
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
    function renderApproved() {
      approvedCard.innerHTML = '';
      approvedCard.appendChild(el('h3', { text: 'Set to freeze (' + approvedPuzzles.length + ')', style: 'margin:0 0 8px;font-size:15px;' }));
      if (!approvedPuzzles.length) { approvedCard.appendChild(el('p', { class: 'pfa-note', text: 'No puzzles approved yet.' })); return; }
      var wrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' });
      approvedPuzzles.forEach(function (spec, i) {
        wrap.appendChild(el('div', { class: 'pfa-q', style: 'flex:0 0 auto;text-align:center;' }, [
          el('div', { class: 'pfa-note', text: spec.diff + ' · κ=' + spec.kappa + ' · $' + spec.bestValue }),
          puzzleGrid(spec, true),
          el('button', { class: 'pfa-btn danger sm', on: { click: function () { approvedPuzzles.splice(i, 1); renderApproved(); } } }, ['remove'])
        ]));
      });
      approvedCard.appendChild(wrap);
      approvedCard.appendChild(el('button', { class: 'pfa-btn', style: 'margin-top:10px;', on: { click: freeze } }, ['Freeze as active set']));
    }
    function renderActive() {
      activeCard.innerHTML = '';
      activeCard.appendChild(el('h3', { text: 'Current active set', style: 'margin:0 0 8px;font-size:15px;' }));
      var ids = (cfg.settings && cfg.settings.activePuzzleIds) || [];
      if (!ids.length) {
        var def = (window.PF_DEFAULTS && window.PF_DEFAULTS.defaultPuzzles) || [];
        if (def.length) {
          activeCard.appendChild(el('p', { class: 'pfa-note', text: 'Built-in default set of ' + def.length + ' puzzles (no custom set frozen). Each participant sees them in a randomized order.' }));
          var dwrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;' });
          activeCard.appendChild(dwrap);
          def.forEach(function (spec, i) {
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
        } else {
          activeCard.appendChild(el('p', { class: 'pfa-note', text: 'None. Participants get randomly generated puzzles based on the Settings counts.' }));
        }
        return;
      }
      activeCard.appendChild(el('p', { class: 'pfa-note', text: ids.length + ' frozen puzzle(s) active. These are the exact puzzles every participant plays — each participant sees them in a randomized order.' }));
      var wrap = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;' });
      activeCard.appendChild(wrap);
      activeCard.appendChild(el('button', { class: 'pfa-btn sec sm', on: { click: clearActive } }, ['Clear active set (use random)']));
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
    async function freeze() {
      if (!approvedPuzzles.length) return;
      toast('Freezing...');
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
      } catch (e) { toast('Freeze failed: ' + ((e && e.code) || 'error')); }
    }
    async function clearActive() {
      try { var s = Object.assign({}, cfg.settings, { activePuzzleIds: [] }); await saveConfig({ settings: s }); cfg.settings = s; renderActive(); toast('Cleared active set.'); }
      catch (e) { toast('Failed: ' + ((e && e.code) || 'error')); }
    }
  }

  // ---- Settings tab ----
  function renderSettings(body) {
    var s = cfg.settings || {};
    var per = s.puzzlesPerUser || { easy: 2, hard: 2 };
    var tl = s.timeLimits || { easy: 120, hard: 180 };
    var easy = el('input', { type: 'number', value: String(per.easy != null ? per.easy : 2), style: 'max-width:120px;' });
    var hard = el('input', { type: 'number', value: String(per.hard != null ? per.hard : 2), style: 'max-width:120px;' });
    var teasy = el('input', { type: 'number', value: String(tl.easy != null ? tl.easy : 120), style: 'max-width:120px;' });
    var thard = el('input', { type: 'number', value: String(tl.hard != null ? tl.hard : 180), style: 'max-width:120px;' });
    var rnd = el('input', { type: 'checkbox' }); if (s.randomizeOrder !== false) rnd.setAttribute('checked', 'checked');
    var save = el('button', { class: 'pfa-btn', on: { click: doSave } }, ['Save settings']);
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy puzzles per participant' }), easy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard puzzles per participant' }), hard]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy time limit (seconds per puzzle)' }), teasy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard time limit (seconds per puzzle)' }), thard]),
      el('div', { class: 'pfa-field' }, [el('label', { style: 'display:flex;align-items:center;gap:8px;' }, [rnd, document.createTextNode('Randomize puzzle order per participant')])]),
      el('p', { class: 'pfa-note', text: 'Puzzle counts apply only when no custom set is frozen (see the Puzzles tab). Time limits apply to every puzzle of that difficulty, in training and the main game.' }),
      save
    ]));
    async function doSave() {
      save.setAttribute('disabled', 'true');
      var settings = Object.assign({}, s, {
        puzzlesPerUser: { easy: parseInt(easy.value, 10) || 0, hard: parseInt(hard.value, 10) || 0 },
        timeLimits: { easy: parseInt(teasy.value, 10) || 120, hard: parseInt(thard.value, 10) || 180 },
        randomizeOrder: rnd.checked
      });
      try { await saveConfig({ settings: settings }); cfg.settings = settings; toast('Settings saved.'); }
      catch (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }
      save.removeAttribute('disabled');
    }
  }

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
      return el('tr', {}, [
        el('td', { text: p.participantId || '' }),
        el('td', { text: p.email || '' }),
        el('td', { text: p.status || '' }),
        el('td', { text: fmtTs(p.createdAt) }),
        el('td', {}, [el('button', { class: 'pfa-btn danger sm', on: { click: function () { deleteParticipant(p._id, p.participantId || p.email || p._id); } } }, ['delete'])])
      ]);
    });
    var table = el('table', { class: 'pfa-tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, ['Participant ID', 'E-mail', 'Status', 'Registered', ''].map(function (h) { return el('th', { text: h }); }))]));
    table.appendChild(el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: '5', text: 'No participants yet.' })])]));
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
        var base = { participantId: p.participantId || '', email: p.email || '', status: p.status || '', registered: fmtTs(p.createdAt) };
        var reg = p.registration || {};
        pRows.push(Object.assign({}, base, flatten(reg)));
        // events
        try {
          var es = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'events'));
          es.forEach(function (d) { var v = d.data(); eRows.push({ participantId: base.participantId, seq: v.seq, type: v.type, phase: v.phase, round: v.round, puzzleId: v.puzzleId, net: v.net, coverage: v.coverage, clientTime: v.clientTime, data: v.dataJson }); });
        } catch (e) {}
        // rounds
        try {
          var rs = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'rounds'));
          rs.forEach(function (d) { var v = d.data(); rRows.push({ participantId: base.participantId, puzzleId: v.puzzleId, index: v.index, diff: v.diff, net: v.net, value: v.value, cost: v.cost, coverage: v.coverage, fitness: v.fitness, placed: v.placed, total: v.total, time: v.time, placements: v.placementsJson }); });
        } catch (e) {}
        // survey
        try {
          var sd = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers'));
          if (sd.exists()) { var sv = sd.data(); sRows.push(Object.assign({ participantId: base.participantId, completedAt: fmtTs(sv.completedAt) }, flatten(sv.answers || {}))); }
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
    try { await initFirebase(); } catch (e) { clearRoot(); root.appendChild(el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); return; }
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
