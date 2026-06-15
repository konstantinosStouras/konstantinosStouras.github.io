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

  // ---- state ----
  var fb = null, XLSX = null, cfg = {}, user = null, tab = 'content';
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
      + '#pfa-root{position:fixed;inset:0;z-index:10000;background:#f6f3ee;overflow:auto;font-family:Inter,system-ui,sans-serif;color:#2b2b2b;}'
      + '#pfa-root *{box-sizing:border-box;}'
      + '.pfa-wrap{max-width:920px;margin:0 auto;padding:24px 18px 80px;}'
      + '.pfa-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}'
      + '.pfa-h h1{font-family:"Space Grotesk",Inter,sans-serif;font-size:1.5rem;margin:0;}'
      + '.pfa-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid #e7e2d8;margin-bottom:18px;}'
      + '.pfa-tabs button{border:none;background:transparent;padding:9px 14px;font-weight:600;font-size:14px;color:#74726c;cursor:pointer;border-bottom:2px solid transparent;}'
      + '.pfa-tabs button.on{color:#e67e22;border-bottom-color:#e67e22;}'
      + '.pfa-card{background:#fff;border:1px solid #e7e2d8;border-radius:14px;padding:18px;margin-bottom:14px;box-shadow:0 6px 18px rgba(60,45,20,.06);}'
      + '.pfa-field{margin:10px 0;}.pfa-field label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;}'
      + '.pfa-field input[type=text],.pfa-field input[type=email],.pfa-field input[type=password],.pfa-field input[type=number],.pfa-field select,.pfa-field textarea{width:100%;padding:9px 11px;border:1px solid #e0dbd0;border-radius:9px;font-size:14px;font-family:inherit;}'
      + '.pfa-field textarea{resize:vertical;}'
      + '.pfa-btn{border:none;background:#e67e22;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px;cursor:pointer;}'
      + '.pfa-btn:hover{background:#cf6f17;}.pfa-btn.sec{background:#fff;color:#2b2b2b;border:1px solid #e0dbd0;}.pfa-btn.sm{padding:5px 10px;font-size:12px;}.pfa-btn.danger{background:#fff;color:#e74c3c;border:1px solid #f0c7c1;}'
      + '.pfa-q{border:1px solid #ece7dd;border-radius:10px;padding:12px;margin-bottom:10px;background:#fcfbf7;}'
      + '.pfa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.pfa-q .row > *{flex:0 0 auto;}'
      + '.pfa-note{color:#8a877f;font-size:13px;}'
      + '.pfa-msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#2b2b2b;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:10001;opacity:0;transition:.2s;}'
      + '.pfa-msg.show{opacity:1;}'
      + 'table.pfa-tbl{width:100%;border-collapse:collapse;font-size:13px;}'
      + 'table.pfa-tbl th,table.pfa-tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid #efeae0;}'
      + 'table.pfa-tbl th{color:#74726c;font-weight:600;}'
      + '.pfa-login{max-width:380px;margin:8vh auto 0;}'
      + '.pfa-err{color:#e74c3c;font-size:13px;min-height:18px;margin:6px 0;}';
    document.head.appendChild(el('style', { text: css }));
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
        err, btn
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
    var tabs = [['content', 'Content'], ['registration', 'Registration'], ['survey', 'Survey'], ['settings', 'Settings'], ['participants', 'Participants']];
    var tabBar = el('div', { class: 'pfa-tabs' }, tabs.map(function (t) {
      return el('button', { class: tab === t[0] ? 'on' : '', on: { click: function () { tab = t[0]; renderShell(); } } }, [t[1]]);
    }));
    var body = el('div', {});
    var wrap = el('div', { class: 'pfa-wrap' }, [
      el('div', { class: 'pfa-h' }, [
        el('h1', { text: 'PortfolioFit admin' }),
        el('button', { class: 'pfa-btn sec sm', on: { click: function () { fb.A.signOut(fb.auth); } } }, ['Sign out'])
      ]),
      tabBar, body
    ]);
    root.appendChild(wrap);
    if (tab === 'content') renderContent(body);
    else if (tab === 'registration') renderQuestions(body, 'registrationQuestions', 'Registration questions');
    else if (tab === 'survey') renderQuestions(body, 'surveyQuestions', 'Survey questions');
    else if (tab === 'settings') renderSettings(body);
    else if (tab === 'participants') renderParticipants(body);
  }

  // ---- Content tab ----
  function renderContent(body) {
    var inputs = {};
    var card = el('div', { class: 'pfa-card' });
    card.appendChild(el('p', { class: 'pfa-note', text: 'Edit the text shown to participants in each phase. Leave a field blank to use the built-in default.' }));
    TEXT_FIELDS.forEach(function (f) {
      var key = f[0], label = f[1], kind = f[2];
      var val = cfg.texts[key];
      if (kind === 'paras') val = Array.isArray(val) ? val.join('\n') : (val || '');
      var input = (kind === 'line')
        ? el('input', { type: 'text', value: val || '' })
        : el('textarea', { rows: kind === 'paras' ? '5' : '3', value: val || '' });
      inputs[key] = { input: input, kind: kind };
      card.appendChild(el('div', { class: 'pfa-field' }, [el('label', { text: label }), input]));
    });
    var save = el('button', { class: 'pfa-btn', on: { click: doSave } }, ['Save content']);
    card.appendChild(save);
    body.appendChild(card);
    async function doSave() {
      var texts = {};
      Object.keys(inputs).forEach(function (key) {
        var v = inputs[key].input.value;
        if (inputs[key].kind === 'paras') texts[key] = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        else texts[key] = v;
      });
      save.setAttribute('disabled', 'true');
      try { await saveConfig({ texts: texts }); cfg.texts = texts; toast('Content saved.'); }
      catch (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }
      save.removeAttribute('disabled');
    }
  }

  // ---- Registration / Survey question editor ----
  function renderQuestions(body, field, title) {
    var list = (cfg[field] || []).map(function (q) { return Object.assign({}, q); });
    var card = el('div', { class: 'pfa-card' });
    var listWrap = el('div', {});
    card.appendChild(el('p', { class: 'pfa-note', text: title + '. Drag order with the up/down buttons. System fields (Participant ID, e-mail, password) are required by the app.' }));
    card.appendChild(listWrap);
    var addBtn = el('button', { class: 'pfa-btn sec sm', on: { click: function () { list.push({ id: 'q_' + Date.now().toString(36), label: 'New question', type: 'text', required: true }); render(); } } }, ['+ Add question']);
    var save = el('button', { class: 'pfa-btn', on: { click: doSave } }, ['Save ' + title.toLowerCase()]);
    card.appendChild(el('div', { class: 'pfa-field' }, [addBtn]));
    card.appendChild(save);
    body.appendChild(card);
    render();

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
      save.setAttribute('disabled', 'true');
      var patch = {}; patch[field] = list;
      try { await saveConfig(patch); cfg[field] = list; toast('Saved.'); }
      catch (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }
      save.removeAttribute('disabled');
    }
  }

  // ---- Settings tab ----
  function renderSettings(body) {
    var s = cfg.settings || {};
    var per = s.puzzlesPerUser || { easy: 2, hard: 2 };
    var easy = el('input', { type: 'number', value: String(per.easy != null ? per.easy : 2), style: 'max-width:120px;' });
    var hard = el('input', { type: 'number', value: String(per.hard != null ? per.hard : 2), style: 'max-width:120px;' });
    var rnd = el('input', { type: 'checkbox' }); if (s.randomizeOrder !== false) rnd.setAttribute('checked', 'checked');
    var save = el('button', { class: 'pfa-btn', on: { click: doSave } }, ['Save settings']);
    body.appendChild(el('div', { class: 'pfa-card' }, [
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Easy puzzles per participant' }), easy]),
      el('div', { class: 'pfa-field' }, [el('label', { text: 'Hard puzzles per participant' }), hard]),
      el('div', { class: 'pfa-field' }, [el('label', { style: 'display:flex;align-items:center;gap:8px;' }, [rnd, document.createTextNode('Randomize puzzle order per participant')])]),
      el('p', { class: 'pfa-note', text: 'Generating and freezing specific puzzles is coming in the next update; for now these counts drive the (randomly generated) easy/hard mix.' }),
      save
    ]));
    async function doSave() {
      save.setAttribute('disabled', 'true');
      var settings = Object.assign({}, s, { puzzlesPerUser: { easy: parseInt(easy.value, 10) || 0, hard: parseInt(hard.value, 10) || 0 }, randomizeOrder: rnd.checked });
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
        el('td', { text: p.anonymousLabel || '' }),
        el('td', { text: p.participantId || '' }),
        el('td', { text: p.email || '' }),
        el('td', { text: p.status || '' }),
        el('td', { text: fmtTs(p.createdAt) })
      ]);
    });
    var table = el('table', { class: 'pfa-tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, ['Label', 'Participant ID', 'E-mail', 'Status', 'Registered'].map(function (h) { return el('th', { text: h }); }))]));
    table.appendChild(el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: '5', text: 'No participants yet.' })])]));
    body.appendChild(el('div', { class: 'pfa-card' }, [head, table]));
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
        var base = { label: p.anonymousLabel || '', participantId: p.participantId || '', email: p.email || '', status: p.status || '', registered: fmtTs(p.createdAt) };
        var reg = p.registration || {};
        pRows.push(Object.assign({}, base, flatten(reg)));
        // events
        try {
          var es = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'events'));
          es.forEach(function (d) { var v = d.data(); eRows.push({ label: base.label, participantId: base.participantId, seq: v.seq, type: v.type, phase: v.phase, round: v.round, puzzleId: v.puzzleId, net: v.net, coverage: v.coverage, clientTime: v.clientTime, data: v.dataJson }); });
        } catch (e) {}
        // rounds
        try {
          var rs = await fb.F.getDocs(fb.F.collection(fb.db, 'participants', uid, 'rounds'));
          rs.forEach(function (d) { var v = d.data(); rRows.push({ label: base.label, participantId: base.participantId, puzzleId: v.puzzleId, index: v.index, diff: v.diff, net: v.net, value: v.value, cost: v.cost, coverage: v.coverage, fitness: v.fitness, placed: v.placed, total: v.total, time: v.time, placements: v.placementsJson }); });
        } catch (e) {}
        // survey
        try {
          var sd = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', uid, 'survey', 'answers'));
          if (sd.exists()) { var sv = sd.data(); sRows.push(Object.assign({ label: base.label, participantId: base.participantId, completedAt: fmtTs(sv.completedAt) }, flatten(sv.answers || {}))); }
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
    try { await initFirebase(); } catch (e) { clearRoot(); root.appendChild(el('div', { class: 'pfa-wrap' }, [el('div', { class: 'pfa-card' }, [el('p', { class: 'pfa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); return; }
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
