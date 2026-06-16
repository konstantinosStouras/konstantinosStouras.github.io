/* =====================================================================
   Answer Arena — admin panel
   ---------------------------------------------------------------------
   Activates only with ?admin. Requires the admin account (admin@admin.com).
   Mirrors the look/behaviour of the sibling ideasearchlab admin (dark
   theme, collapsible page-text editors, the restore-default trio).

   Tabs:
     Sessions      create/list/delete sessions (join codes, participant counts)
     Tasks         upload an Excel (task, outputA, outputB) -> active task set
     Content       edit every participant-facing text (per-page, restore trio)
     Registration  add/edit/reorder registration questions
     Survey        add/edit/reorder survey questions
     2x2 & Settings  enable/disable the 2x2 design, order/limit, session code
     Participants  table of participants + Export to Excel (multi-sheet)

   All persistence goes through window.ArenaStore (Firebase when configured,
   else localStorage), so the admin works online and offline for testing.
   ===================================================================== */
(function () {
  'use strict';
  if (!/[?&]admin\b/.test(location.search)) return;

  var D = window.ARENA_DEFAULTS || {};
  var Store = window.ArenaStore;
  var XLSX = null;
  var cfg = { texts: {}, settings: {}, registrationQuestions: [], surveyQuestions: [], activeTaskSetId: null };
  var user = null, tab = 'sessions', root, XlsxBusy = false;

  /* ---- text fields grouped into collapsible "pages" ---- */
  var TEXT_FIELD_META = {
    welcomeTitle: { label: 'Welcome - title', kind: 'line' },
    welcomeIntro: { label: 'Welcome - intro (HTML allowed)', kind: 'area' },
    welcomeBody: { label: 'Welcome - body paragraphs (one per line, HTML allowed)', kind: 'paras' },
    welcomeButton: { label: 'Welcome - start button', kind: 'line' },
    loginLink: { label: 'Welcome - "I have an account" link', kind: 'line' },
    tourTitle: { label: 'Tour - title', kind: 'line' },
    trainingTitle: { label: 'Training - title', kind: 'line' },
    trainingBody: { label: 'Training - body (HTML allowed)', kind: 'area' },
    trainingButton: { label: 'Training - start button', kind: 'line' },
    registerTitle: { label: 'Registration - title', kind: 'line' },
    registerIntro: { label: 'Registration - intro', kind: 'area' },
    loginTitle: { label: 'Login - title', kind: 'line' },
    mainTitle: { label: 'Comparisons - title', kind: 'line' },
    mainIntro: { label: 'Comparisons - instruction', kind: 'area' },
    surveyTitle: { label: 'Survey - title', kind: 'line' },
    surveyIntro: { label: 'Survey - intro', kind: 'area' },
    thankyouTitle: { label: 'Thank-you - title', kind: 'line' },
    thankyouBody: { label: 'Thank-you - body (HTML allowed)', kind: 'area' }
  };
  var PAGE_GROUPS = [
    { key: 'welcome', label: 'Welcome page', fields: ['welcomeTitle', 'welcomeIntro', 'welcomeBody', 'welcomeButton', 'loginLink'] },
    { key: 'tour', label: 'Tour', fields: ['tourTitle'] },
    { key: 'training', label: 'Training page', fields: ['trainingTitle', 'trainingBody', 'trainingButton'] },
    { key: 'registration', label: 'Registration page', fields: ['registerTitle', 'registerIntro'] },
    { key: 'login', label: 'Login page', fields: ['loginTitle'] },
    { key: 'main', label: 'Comparisons page', fields: ['mainTitle', 'mainIntro'] },
    { key: 'survey', label: 'Survey page', fields: ['surveyTitle', 'surveyIntro'] },
    { key: 'thankyou', label: 'Thank-you page', fields: ['thankyouTitle', 'thankyouBody'] }
  ];
  var QUESTION_TYPES = ['text', 'email', 'password', 'number', 'select', 'radio', 'textarea'];

  /* ---- DOM helpers ---- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'value') n.value = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function clearRoot() { root.innerHTML = ''; }
  var msgEl;
  function toast(t) { if (!msgEl) { msgEl = el('div', { class: 'aa-msg' }); document.body.appendChild(msgEl); } msgEl.textContent = t; msgEl.classList.add('show'); setTimeout(function () { msgEl.classList.remove('show'); }, 1900); }

  function injectStyles() {
    var css = ''
      + '#aa-root{--bg:#181818;--panel:#242424;--ink:#ececec;--muted:#9a978f;--line:#383838;--field:#2e2e2e;--fieldline:#474747;--accent:#e67e22;--accentd:#cf6f17;--qbg:#202020;position:fixed;inset:0;z-index:10000;background:var(--bg);overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);}'
      + '#aa-root.light{--bg:#f6f3ee;--panel:#fff;--ink:#2b2b2b;--muted:#74726c;--line:#e7e2d8;--field:#fff;--fieldline:#e0dbd0;--qbg:#fcfbf7;}'
      + '#aa-root *{box-sizing:border-box;}'
      + '.aa-wrap{max-width:960px;margin:0 auto;padding:22px 16px 90px;}'
      + '.aa-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:10px;flex-wrap:wrap;}'
      + '.aa-h h1{font-size:1.5rem;margin:0;}'
      + '.aa-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:18px;}'
      + '.aa-tabs button{border:none;background:transparent;padding:9px 13px;font-weight:600;font-size:14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}'
      + '.aa-tabs button.on{color:var(--accent);border-bottom-color:var(--accent);}'
      + '.aa-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px;box-shadow:0 6px 18px rgba(0,0,0,.18);}'
      + '.aa-card > * + *{margin-top:12px;}'
      + '.aa-card h3{margin:0 0 6px;font-size:16px;}'
      + '.aa-field{margin:10px 0;}.aa-field label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;}'
      + '#aa-root input:not([type=checkbox]):not([type=radio]):not([type=file]),#aa-root select,#aa-root textarea{width:100%;padding:9px 11px;border:1px solid var(--fieldline);border-radius:9px;font-size:14px;font-family:inherit;background:var(--field);color:var(--ink);}'
      + '#aa-root textarea{resize:vertical;}'
      + '.aa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 16px;border-radius:10px;cursor:pointer;}'
      + '.aa-btn:hover{background:var(--accentd);}.aa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.aa-btn.sm{padding:7px 11px;font-size:12px;}.aa-btn.danger{background:transparent;color:#e06b5a;border:1px solid #6d3b34;}'
      + '.aa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-note{color:var(--muted);font-size:13px;line-height:1.6;}'
      + '.aa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);}'
      + '.aa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:99px;}'
      + '.aa-badge.waiting{color:#7bd88f;background:rgba(123,216,143,.14);}.aa-badge.open{color:#e6a417;background:rgba(230,164,23,.14);}.aa-badge.closed{color:#9a978f;background:rgba(154,151,143,.14);}'
      + 'table.aa-tbl{width:100%;border-collapse:collapse;font-size:13px;}table.aa-tbl th,table.aa-tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);}table.aa-tbl th{color:var(--muted);font-weight:600;}'
      + '.aa-login{max-width:380px;margin:8vh auto 0;}'
      + '.aa-err{color:#e06b5a;font-size:13px;min-height:18px;margin:6px 0;}'
      + '.aa-msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:10010;opacity:0;transition:.2s;}.aa-msg.show{opacity:1;}'
      + '.aa-toggle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;}'
      + '.aa-mode{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:3px 8px;}';
    document.head.appendChild(el('style', { text: css }));
  }
  function currentTheme() { try { return localStorage.getItem('aa-theme') || 'dark'; } catch (e) { return 'dark'; } }
  function applyTheme(th) { if (root) root.classList.toggle('light', th === 'light'); try { localStorage.setItem('aa-theme', th); } catch (e) {} }
  function themeToggle() { var b = el('button', { class: 'aa-btn sec sm' }); function p() { b.textContent = (root && root.classList.contains('light')) ? '☾ Dark' : '☀ Light'; } p(); b.addEventListener('click', function () { applyTheme((root && root.classList.contains('light')) ? 'dark' : 'light'); p(); }); return b; }

  /* ---- config load/save through the store ---- */
  function loadConfig() {
    return Store.loadConfig().then(function (d) {
      d = d || {};
      cfg = { texts: d.texts || {}, settings: d.settings || {}, registrationQuestions: d.registrationQuestions || [], surveyQuestions: d.surveyQuestions || [], activeTaskSetId: d.activeTaskSetId || null };
    });
  }
  function saveConfig(partial) { return Store.saveConfig(partial); }

  /* ---- routing ---- */
  function cachedAdmin() { try { return localStorage.getItem('aa-admin') === '1'; } catch (e) { return false; } }
  function route() {
    if (!user) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderLogin(); }
    if (!Store.isAdminEmail(user.email)) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderNotAuthorized(); }
    try { localStorage.setItem('aa-admin', '1'); } catch (e) {}
    loadConfig().then(renderShell);
  }
  function renderLogin() {
    clearRoot();
    var email = el('input', { type: 'email', placeholder: Store.ADMIN_EMAIL });
    var pass = el('input', { type: 'password', placeholder: 'Password' });
    var err = el('div', { class: 'aa-err' });
    var btn = el('button', { class: 'aa-btn', on: { click: doLogin } }, ['Log in']);
    root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card aa-login' }, [
      el('h1', { text: 'Answer Arena admin' }),
      (Store.mode === 'local') ? el('p', { class: 'aa-note', html: 'Local test mode (Firebase not configured). Log in as <b>' + esc(Store.ADMIN_EMAIL) + '</b> with any password.' }) : null,
      el('div', { class: 'aa-field' }, [el('label', { text: 'E-mail' }), email]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Password' }), pass]),
      err, btn, el('div', { style: 'margin-top:12px;' }, [themeToggle()])
    ])]));
    function doLogin() { err.textContent = ''; btn.setAttribute('disabled', 'true'); Store.login(email.value.trim(), pass.value).then(function (u) { user = u; route(); }).catch(function (e) { btn.removeAttribute('disabled'); err.textContent = 'Login failed: ' + ((e && e.code) || 'error'); }); }
  }
  function renderNotAuthorized() {
    clearRoot();
    root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card aa-login' }, [
      el('h1', { text: 'Not authorized' }),
      el('p', { class: 'aa-note', html: 'Signed in as ' + esc(user.email) + ', which is not the admin account.' }),
      el('button', { class: 'aa-btn sec', on: { click: function () { Store.logout().then(function () { user = null; route(); }); } } }, ['Sign out'])
    ])]));
  }

  function renderShell() {
    clearRoot();
    var tabs = [['sessions', 'Sessions'], ['tasks', 'Tasks'], ['content', 'Content'], ['registration', 'Registration'], ['survey', 'Survey'], ['settings', '2x2 & Settings'], ['participants', 'Participants']];
    var tabBar = el('div', { class: 'aa-tabs' }, tabs.map(function (tt) { return el('button', { class: tab === tt[0] ? 'on' : '', on: { click: function () { tab = tt[0]; renderShell(); } } }, [tt[1]]); }));
    var body = el('div', {});
    root.appendChild(el('div', { class: 'aa-wrap' }, [
      el('div', { class: 'aa-h' }, [
        el('h1', { text: 'Answer Arena admin' }),
        el('div', { class: 'aa-row' }, [el('span', { class: 'aa-mode', text: Store.mode === 'firebase' ? 'Firebase' : 'Local test mode' }), themeToggle(), el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.logout().then(function () { user = null; route(); }); } } }, ['Sign out'])])
      ]),
      tabBar, body
    ]));
    if (tab === 'sessions') renderSessions(body);
    else if (tab === 'tasks') renderTasks(body);
    else if (tab === 'content') renderContent(body);
    else if (tab === 'registration') renderQuestions(body, 'registrationQuestions', 'Registration questions');
    else if (tab === 'survey') renderQuestions(body, 'surveyQuestions', 'Survey questions');
    else if (tab === 'settings') renderSettings(body);
    else if (tab === 'participants') renderParticipants(body);
  }

  /* ============================ SESSIONS ============================ */
  function renderSessions(body) {
    // Create
    var createCard = el('div', { class: 'aa-card' });
    var name = el('input', { type: 'text', placeholder: 'e.g. UCD class - June 16' });
    var statusSel = el('select', {}, ['waiting', 'open', 'closed'].map(function (s) { return el('option', { value: s }, [s]); }));
    var ttSel = el('select', {}, [['global', 'Use global 2x2 setting'], ['off', 'No 2x2 (single group)'], ['random', '2x2, random assignment'], ['fixed', '2x2, fixed cell']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); }));
    var transSel = el('select', {}, [['abstract', 'Abstract tokens'], ['translated', 'Translated cost']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); }));
    var incSel = el('select', {}, [['firm', 'Firm pays'], ['personal', 'Personal budget']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); }));
    var fixedWrap = el('div', { class: 'aa-row', style: 'display:none;' }, [
      el('div', { class: 'aa-field', style: 'flex:1;min-width:160px;' }, [el('label', { text: 'Transparency' }), transSel]),
      el('div', { class: 'aa-field', style: 'flex:1;min-width:160px;' }, [el('label', { text: 'Incentive' }), incSel])
    ]);
    ttSel.addEventListener('change', function () { fixedWrap.style.display = ttSel.value === 'fixed' ? 'flex' : 'none'; });
    createCard.appendChild(el('h3', { text: 'Create new session' }));
    createCard.appendChild(el('p', { class: 'aa-note', text: 'Each session gets a short join code. Participants enter it on the welcome screen (or open the share link). A session can pin its own 2x2 condition, overriding the global setting.' }));
    createCard.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Session name' }), name]));
    createCard.appendChild(el('div', { class: 'aa-row' }, [
      el('div', { class: 'aa-field', style: 'flex:1;min-width:160px;' }, [el('label', { text: 'Status' }), statusSel]),
      el('div', { class: 'aa-field', style: 'flex:1;min-width:200px;' }, [el('label', { text: '2x2 design' }), ttSel])
    ]));
    createCard.appendChild(fixedWrap);
    createCard.appendChild(el('div', { class: 'aa-row' }, [el('button', { class: 'aa-btn', on: { click: create } }, ['Create session'])]));
    body.appendChild(createCard);

    // List
    var listCard = el('div', { class: 'aa-card' }, [el('h3', { text: 'Active sessions' }), el('p', { class: 'aa-note', text: 'Loading...' })]);
    body.appendChild(listCard);
    refresh();

    function condFromForm() {
      var v = ttSel.value;
      if (v === 'global') return null;
      if (v === 'off') return { enabled: false };
      if (v === 'random') return { enabled: true, assignment: 'random' };
      return { enabled: true, assignment: 'fixed', fixedCell: { transparency: transSel.value, incentive: incSel.value } };
    }
    function create() {
      if (!name.value.trim()) { toast('Give the session a name.'); return; }
      var data = { name: name.value.trim(), status: statusSel.value, condition: condFromForm(), taskSetId: cfg.activeTaskSetId || null };
      Store.createSession(data).then(function (s) { toast('Session created: ' + s.code); name.value = ''; refresh(); }).catch(function (e) { toast('Create failed: ' + ((e && e.code) || 'error')); });
    }
    function refresh() {
      Promise.all([Store.listSessions(), Store.listParticipants().catch(function () { return []; })]).then(function (res) {
        var list = res[0], parts = res[1] || {};
        var counts = {};
        (parts.length ? parts : []).forEach(function (p) { if (p.sessionId) counts[p.sessionId] = (counts[p.sessionId] || 0) + 1; });
        listCard.innerHTML = '';
        listCard.appendChild(el('h3', { text: 'Active sessions (' + list.length + ')' }));
        if (!list.length) { listCard.appendChild(el('p', { class: 'aa-note', text: 'No sessions yet.' })); return; }
        list.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        list.forEach(function (s) {
          var liveCount = counts[s.id] != null ? counts[s.id] : (s.count || 0);
          var joinUrl = location.origin + location.pathname + '?s=' + s.code;
          var st = s.status || 'waiting';
          var ctext = !s.condition ? 'global 2x2' : (s.condition.enabled ? ('2x2 ' + (s.condition.assignment || 'random') + (s.condition.fixedCell ? ' (' + s.condition.fixedCell.transparency + '/' + s.condition.fixedCell.incentive + ')' : '')) : 'no 2x2');
          var statusSel2 = el('select', { style: 'max-width:140px;' }, ['waiting', 'open', 'closed'].map(function (x) { return el('option', { value: x }, [x]); }));
          statusSel2.value = st;
          statusSel2.addEventListener('change', function () { Store.updateSession(s.id, { status: statusSel2.value }).then(function () { toast('Status updated.'); refresh(); }); });
          listCard.appendChild(el('div', { class: 'aa-q' }, [
            el('div', { class: 'row', style: 'justify-content:space-between;' }, [
              el('div', {}, [el('b', { text: s.code, style: 'font-size:18px;letter-spacing:.1em;' }), ' ', el('span', { class: 'aa-badge ' + st, text: st })]),
              el('div', { class: 'aa-note', text: liveCount + ' participant' + (liveCount === 1 ? '' : 's') })
            ]),
            el('div', { class: 'aa-note', style: 'margin-top:4px;', text: (s.name || '(unnamed)') + ' · ' + ctext }),
            el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
              statusSel2,
              el('button', { class: 'aa-btn sec sm', on: { click: function () { copy(joinUrl); } } }, ['Copy join link']),
              el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Delete session ' + s.code + '?')) Store.deleteSession(s.id).then(function () { toast('Deleted.'); refresh(); }); } } }, ['Delete'])
            ])
          ]));
        });
      }).catch(function (e) { listCard.innerHTML = ''; listCard.appendChild(el('p', { class: 'aa-err', text: 'Could not load sessions: ' + ((e && e.code) || 'error') })); });
    }
  }
  function copy(txt) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta); ta.focus(); ta.select();
        ta.setSelectionRange(0, txt.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) toast('Copied: ' + txt); else window.prompt('Copy this link:', txt);
      } catch (e) { window.prompt('Copy this link:', txt); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Copied: ' + txt); }, fallback);
    } else { fallback(); }
  }

  /* ============================ TASKS (Excel) ====================== */
  function renderTasks(body) {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('h3', { text: 'Upload comparisons (Excel)' }));
    card.appendChild(el('p', { class: 'aa-note', html: 'Upload an .xlsx / .csv with <b>three columns</b>: <b>task</b>, <b>outputA</b>, <b>outputB</b> (one row per comparison). The first row should be the headers. Column names are matched loosely (e.g. "Task", "Output A", "Answer 1" all work); otherwise the first three columns are used. Participants see the two outputs in a randomized left/right order, and never learn which model produced which.' }));
    var file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    var setName = el('input', { type: 'text', placeholder: 'Name for this set (optional)' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Excel / CSV file' }), file]));
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Set name' }), setName]));
    var preview = el('div', {});
    card.appendChild(preview);
    body.appendChild(card);

    var active = el('div', { class: 'aa-card' }, [el('p', { class: 'aa-note', text: 'Loading current set...' })]);
    body.appendChild(active);
    refreshActive();

    var parsed = null;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      ensureXLSX().then(function (X) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var wb = X.read(new Uint8Array(e.target.result), { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = X.utils.sheet_to_json(ws, { header: 1, defval: '' });
            parsed = rowsToTasks(rows);
            showPreview();
          } catch (err) { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'Could not read the file: ' + (err.message || err) })); }
        };
        reader.readAsArrayBuffer(f);
      }).catch(function () { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'Could not load the Excel reader (offline?).' })); });
    });

    function showPreview() {
      preview.innerHTML = '';
      if (!parsed || !parsed.length) { preview.appendChild(el('p', { class: 'aa-err', text: 'No rows found. Check the file has a header row and at least one data row.' })); return; }
      preview.appendChild(el('p', { class: 'aa-note', text: 'Parsed ' + parsed.length + ' comparison' + (parsed.length === 1 ? '' : 's') + '. Preview of the first few:' }));
      var tbl = el('table', { class: 'aa-tbl' });
      tbl.appendChild(el('thead', {}, [el('tr', {}, ['#', 'Task', 'Output A', 'Output B'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody', {});
      parsed.slice(0, 5).forEach(function (r, i) { tb.appendChild(el('tr', {}, [el('td', { text: String(i + 1) }), el('td', { text: clip(r.task) }), el('td', { text: clip(r.outputA) }), el('td', { text: clip(r.outputB) })])); });
      tbl.appendChild(tb);
      preview.appendChild(tbl);
      preview.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [
        el('button', { class: 'aa-btn', on: { click: makeActive } }, ['Make this the active set']),
        el('button', { class: 'aa-btn sec', on: { click: function () { parsed = null; file.value = ''; preview.innerHTML = ''; } } }, ['Discard'])
      ]));
    }
    function makeActive() {
      var set = { name: setName.value.trim() || ('Uploaded ' + new Date().toLocaleString()), source: 'excel', tasks: parsed, count: parsed.length };
      Store.saveTaskSet(set).then(function (id) { cfg.activeTaskSetId = id; toast('Active set updated (' + parsed.length + ' comparisons).'); parsed = null; file.value = ''; preview.innerHTML = ''; refreshActive(); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function refreshActive() {
      Store.loadActiveTasks().then(function (s) {
        active.innerHTML = '';
        active.appendChild(el('h3', { text: 'Current active set' }));
        var isBuiltin = !cfg.activeTaskSetId || s.id === 'builtin';
        active.appendChild(el('p', { class: 'aa-note', html: '<b>' + esc(s.name || 'Built-in default') + '</b> · ' + (s.tasks ? s.tasks.length : 0) + ' comparisons' + (isBuiltin ? ' (built-in placeholders)' : '') }));
        active.appendChild(el('div', { class: 'aa-row' }, [
          el('button', { class: 'aa-btn sec', on: { click: function () { saveConfig({ activeTaskSetId: null }).then(function () { cfg.activeTaskSetId = null; toast('Reverted to built-in default set.'); refreshActive(); }); } } }, ['Restore built-in default'])
        ]));
      });
    }
  }
  function rowsToTasks(rows) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(function (h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); });
    // Exact match first (so short codes like "a"/"b" don't match "t-a-sk"); then
    // substrings, but only for tokens long enough to be unambiguous.
    function find(cands) {
      var i, j;
      for (i = 0; i < header.length; i++) for (j = 0; j < cands.length; j++) if (header[i] === cands[j]) return i;
      for (i = 0; i < header.length; i++) for (j = 0; j < cands.length; j++) if (cands[j].length >= 3 && header[i].indexOf(cands[j]) >= 0) return i;
      return -1;
    }
    var ti = find(['task', 'prompt', 'question']);
    var ai = find(['outputa', 'answera', 'output1', 'answer1', 'modela', 'a']);
    var bi = find(['outputb', 'answerb', 'output2', 'answer2', 'modelb', 'b']);
    // Treat row 1 as a header only if at least two of the three columns were
    // recognized; otherwise assume no header and use the first three columns.
    var found = (ti >= 0 ? 1 : 0) + (ai >= 0 ? 1 : 0) + (bi >= 0 ? 1 : 0);
    var hasHeader = found >= 2;
    if (ti < 0) ti = 0; if (ai < 0) ai = 1; if (bi < 0) bi = 2;
    var out = [], start = hasHeader ? 1 : 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var task = String(row[ti] == null ? '' : row[ti]).trim();
      var oa = String(row[ai] == null ? '' : row[ai]).trim();
      var ob = String(row[bi] == null ? '' : row[bi]).trim();
      if (!task && !oa && !ob) continue;
      out.push({ id: 'T' + (out.length + 1), task: task, outputA: oa, outputB: ob });
    }
    return out;
  }
  function clip(s) { s = String(s || ''); return s.length > 90 ? s.slice(0, 90) + '…' : s; }

  /* ============================ CONTENT ============================ */
  function renderContent(body) {
    body.appendChild(el('div', { class: 'aa-card' }, [el('p', { class: 'aa-note', html: 'Edit the wording participants see. Each field is pre-filled with the current text (built-in default unless you saved a change). <b>Make this the default</b> saves it. <b>Reset this page to defaults</b> discards unsaved edits. <b>Restore built-in default</b> reverts to the original wording.' })]));
    PAGE_GROUPS.forEach(function (g) { body.appendChild(renderPageSection(g)); });
  }
  function renderPageSection(g) {
    var section = el('div', { class: 'aa-card', style: 'padding:0;overflow:hidden;' });
    var caret = el('span', { text: '▾', style: 'color:var(--muted);' });
    var bodyDiv = el('div', { style: 'display:none;padding:0 18px 16px;' });
    var open = false, inputs = {};
    section.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;', on: { click: toggle } }, [el('b', { text: g.label, style: 'font-size:15px;' }), caret]));
    section.appendChild(bodyDiv);
    function build() {
      bodyDiv.innerHTML = ''; inputs = {};
      g.fields.forEach(function (key) {
        var meta = TEXT_FIELD_META[key]; if (!meta) return;
        var dflt = (D.texts || {})[key];
        var saved = cfg.texts[key];
        var val = (saved == null || saved === '' || (Array.isArray(saved) && !saved.length)) ? dflt : saved;
        if (meta.kind === 'paras') val = Array.isArray(val) ? val.join('\n') : (val || '');
        var input = (meta.kind === 'line') ? el('input', { type: 'text', value: val || '' }) : el('textarea', { rows: meta.kind === 'paras' ? '5' : '3', value: val || '' });
        inputs[key] = { input: input, kind: meta.kind };
        bodyDiv.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: meta.label }), input]));
      });
      bodyDiv.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: makeDefault } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: function () { build(); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
        el('button', { class: 'aa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default'])
      ]));
    }
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open) build(); }
    function collect() { var texts = {}; Object.keys(inputs).forEach(function (key) { var v = inputs[key].input.value; texts[key] = inputs[key].kind === 'paras' ? v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : v; }); return texts; }
    function makeDefault() { var merged = Object.assign({}, cfg.texts, collect()); saveConfig({ texts: merged }).then(function () { cfg.texts = merged; toast(g.label + ' saved.'); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }); }
    function restoreBuiltin() { var Dt = D.texts || {}, merged = Object.assign({}, cfg.texts); g.fields.forEach(function (key) { if (Dt[key] !== undefined) merged[key] = Dt[key]; else delete merged[key]; }); saveConfig({ texts: merged }).then(function () { cfg.texts = merged; build(); toast(g.label + ' restored to built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }); }
    return section;
  }

  /* ===================== REGISTRATION / SURVEY Qs =================== */
  function renderQuestions(body, field, title) {
    var list = ((cfg[field] && cfg[field].length) ? cfg[field] : (D[field] || [])).map(function (q) { return Object.assign({}, q); });
    var card = el('div', { class: 'aa-card' });
    var listWrap = el('div', {});
    card.appendChild(el('p', { class: 'aa-note', text: title + '. Reorder with the up/down buttons. System fields (e-mail, password, participant ID) are used by the app for login.' }));
    card.appendChild(listWrap);
    card.appendChild(el('div', { class: 'aa-field' }, [el('button', { class: 'aa-btn sec sm', on: { click: function () { list.push({ id: 'q_' + Date.now().toString(36), label: 'New question', type: 'text', required: true }); render(); } } }, ['+ Add question'])]));
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
      el('button', { class: 'aa-btn', on: { click: doSave } }, ['Make this the default']),
      el('button', { class: 'aa-btn sec', on: { click: function () { list = builtinOrSaved(); render(); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
      el('button', { class: 'aa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default'])
    ]));
    body.appendChild(card);
    render();
    function builtinOrSaved() { return ((cfg[field] && cfg[field].length) ? cfg[field] : (D[field] || [])).map(function (q) { return Object.assign({}, q); }); }
    function restoreBuiltin() { list = (D[field] || []).map(function (q) { return Object.assign({}, q); }); var patch = {}; patch[field] = list; saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); render(); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }); }
    function render() {
      listWrap.innerHTML = '';
      list.forEach(function (q, i) {
        var qb = el('div', { class: 'aa-q' });
        var labelI = el('input', { type: 'text', value: q.label || '', style: 'min-width:220px;flex:1 1 240px;' });
        labelI.addEventListener('input', function () { q.label = labelI.value; });
        var typeS = el('select', { style: 'max-width:130px;' }, QUESTION_TYPES.map(function (tp) { return el('option', { value: tp }, [tp]); }));
        typeS.value = q.type || 'text';
        typeS.addEventListener('change', function () { q.type = typeS.value; render(); });
        var reqL = el('label', { style: 'font-weight:500;display:flex;align-items:center;gap:5px;' });
        var reqC = el('input', { type: 'checkbox' }); if (q.required) reqC.setAttribute('checked', 'checked');
        reqC.addEventListener('change', function () { q.required = reqC.checked; });
        reqL.appendChild(reqC); reqL.appendChild(document.createTextNode('required'));
        var up = el('button', { class: 'aa-btn sec sm', on: { click: function () { if (i > 0) { var x = list[i - 1]; list[i - 1] = list[i]; list[i] = x; render(); } } } }, ['↑']);
        var dn = el('button', { class: 'aa-btn sec sm', on: { click: function () { if (i < list.length - 1) { var x = list[i + 1]; list[i + 1] = list[i]; list[i] = x; render(); } } } }, ['↓']);
        var del = el('button', { class: 'aa-btn danger sm', on: { click: function () { list.splice(i, 1); render(); } } }, ['delete']);
        qb.appendChild(el('div', { class: 'row' }, [labelI, typeS, reqL, up, dn, del]));
        qb.appendChild(el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'id: ' + (q.id || '') + (q.system ? ' (system: ' + q.system + ')' : '') }));
        if (q.type === 'select' || q.type === 'radio') {
          var opt = el('textarea', { rows: '3', value: (q.options || []).join('\n'), style: 'margin-top:6px;' });
          opt.addEventListener('input', function () { q.options = opt.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
          qb.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Options (one per line)' }), opt]));
        }
        var help = el('input', { type: 'text', value: q.help || '', placeholder: 'Optional helper text' });
        help.addEventListener('input', function () { q.help = help.value; });
        qb.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Helper text' }), help]));
        listWrap.appendChild(qb);
      });
    }
    function doSave() { var patch = {}; patch[field] = list; saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); toast(title + ' saved.'); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }); }
  }

  /* ===================== 2x2 & SETTINGS ===================== */
  function renderSettings(body) {
    var s = cfg.settings || {};
    var tt = Object.assign({}, (D.settings || {}).twoByTwo, s.twoByTwo);
    var enabled = el('input', { type: 'checkbox' }); if (tt.enabled) enabled.setAttribute('checked', 'checked');
    var assign = el('select', {}, [['random', 'Random (between-subjects)'], ['fixed', 'Fixed cell (everyone the same)']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); }));
    assign.value = tt.assignment || 'random';
    var fixedCell = tt.fixedCell || { transparency: 'abstract', incentive: 'firm' };
    var transSel = el('select', {}, [['abstract', 'Abstract tokens'], ['translated', 'Translated cost']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); })); transSel.value = fixedCell.transparency;
    var incSel = el('select', {}, [['firm', 'Firm pays'], ['personal', 'Personal budget']].map(function (o) { return el('option', { value: o[0] }, [o[1]]); })); incSel.value = fixedCell.incentive;

    var randomize = el('input', { type: 'checkbox' }); if (s.randomizeOrder !== false) randomize.setAttribute('checked', 'checked');
    var perUser = el('input', { type: 'number', value: String(s.comparisonsPerUser != null ? s.comparisonsPerUser : 0), style: 'max-width:140px;' });
    var reqCode = el('input', { type: 'checkbox' }); if (s.requireSessionCode) reqCode.setAttribute('checked', 'checked');

    body.appendChild(el('div', { class: 'aa-card' }, [
      el('h3', { text: 'The 2x2 design' }),
      el('p', { class: 'aa-note', html: 'Between-subjects 2x2: <b>Transparency</b> (abstract tokens vs translated cost) x <b>Incentive</b> (firm pays vs personal budget). When enabled, each participant is assigned a cell and it is recorded with their responses; a short banner can be shown per cell (edit the banners in arena-data.js). When disabled, everyone is in the baseline cell (abstract tokens, firm pays) and no banner shows. A session can override this globally.' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [enabled, document.createTextNode('Enable the 2x2 design')])]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Assignment' }), assign]),
      el('div', { class: 'aa-row' }, [
        el('div', { class: 'aa-field', style: 'flex:1;min-width:170px;' }, [el('label', { text: 'Fixed cell - Transparency' }), transSel]),
        el('div', { class: 'aa-field', style: 'flex:1;min-width:170px;' }, [el('label', { text: 'Fixed cell - Incentive' }), incSel])
      ]),
      el('p', { class: 'aa-note', text: '("Fixed cell" is used only when Assignment is "Fixed cell".)' })
    ]));
    body.appendChild(el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Comparison flow' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [randomize, document.createTextNode('Show comparisons in random order per participant')])]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Comparisons per participant (0 = use the whole active set)' }), perUser]),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [reqCode, document.createTextNode('Require a session code to start')])]),
      el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: doSave } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: function () { renderSettings(clear(body)); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
        el('button', { class: 'aa-btn sec', on: { click: restoreDefaults } }, ['Restore built-in default'])
      ])
    ]));
    function clear(b) { b.innerHTML = ''; return b; }
    function doSave() {
      var settings = Object.assign({}, s, {
        twoByTwo: Object.assign({}, tt, { enabled: enabled.checked, assignment: assign.value, fixedCell: { transparency: transSel.value, incentive: incSel.value } }),
        randomizeOrder: randomize.checked,
        comparisonsPerUser: parseInt(perUser.value, 10) || 0,
        requireSessionCode: reqCode.checked
      });
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; toast('Settings saved.'); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function restoreDefaults() {
      var settings = Object.assign({}, JSON.parse(JSON.stringify(D.settings || {})));
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; renderSettings(clear(body)); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); });
    }
  }

  /* ===================== PARTICIPANTS + EXPORT ===================== */
  function renderParticipants(body) {
    body.appendChild(el('div', { class: 'aa-card' }, [el('p', { class: 'aa-note', text: 'Loading participants...' })]));
    Store.listParticipants().then(function (parts) {
      parts.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); });
      body.innerHTML = '';
      var head = el('div', { class: 'aa-h' }, [el('div', { class: 'aa-note', text: parts.length + ' participant' + (parts.length === 1 ? '' : 's') }), el('button', { class: 'aa-btn', on: { click: function () { exportExcel(parts); } } }, ['Export to Excel'])]);
      var rows = parts.map(function (p) {
        var c = p.condition || {};
        return el('tr', {}, [
          el('td', { text: p.participantId || '' }),
          el('td', { text: p.email || '' }),
          el('td', { text: p.status || '' }),
          el('td', { text: c.enabled ? (c.transparency + '/' + c.incentive) : '-' }),
          el('td', { text: fmtTs(p.createdAt) }),
          el('td', {}, [el('button', { class: 'aa-btn danger sm', on: { click: function () { delPart(p._id, p.participantId || p.email || p._id); } } }, ['delete'])])
        ]);
      });
      var table = el('table', { class: 'aa-tbl' });
      table.appendChild(el('thead', {}, [el('tr', {}, ['Participant ID', 'E-mail', 'Status', '2x2 cell', 'Registered', ''].map(function (h) { return el('th', { text: h }); }))]));
      table.appendChild(el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: '6', text: 'No participants yet.' })])]));
      body.appendChild(el('div', { class: 'aa-card' }, [head, table]));
      function delPart(uid, who) { if (!window.confirm('Delete "' + who + '" and all their data?')) return; Store.deleteParticipant(uid).then(function () { toast('Deleted.'); renderParticipants(body); }); }
    }).catch(function (e) { body.innerHTML = ''; body.appendChild(el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'Could not load participants: ' + ((e && e.code) || 'error') })])); });
  }

  function exportExcel(parts) {
    toast('Building export...');
    ensureXLSX().then(function (X) {
      var pRows = [], rRows = [], sRows = [];
      var chain = Promise.resolve();
      parts.forEach(function (p) {
        var uid = p._id, c = p.condition || {};
        var base = { participantId: p.participantId || '', email: p.email || '', status: p.status || '', sessionId: p.sessionId || '', transparency: c.transparency || '', incentive: c.incentive || '', registered: fmtTs(p.createdAt) };
        pRows.push(Object.assign({}, base, flatten('reg_', p.registration || {})));
        chain = chain.then(function () {
          return Store.listResponses(uid).then(function (rs) {
            rs.forEach(function (v) { rRows.push({ participantId: base.participantId, email: base.email, taskId: v.taskId, idx: v.idx, choice: v.choice, chosenOutput: v.chosenOutput, leftOutput: v.leftOutput, rightOutput: v.rightOutput, responseMs: v.responseMs, transparency: base.transparency, incentive: base.incentive }); });
          }).catch(function () {});
        }).then(function () {
          return Store.getSurvey(uid).then(function (sv) { if (sv) sRows.push(Object.assign({ participantId: base.participantId, email: base.email, completedAt: fmtTs(sv.completedAt) }, flatten('s_', sv.answers || {}))); }).catch(function () {});
        });
      });
      chain.then(function () {
        var wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(pRows.length ? pRows : [{}]), 'Participants');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rRows.length ? rRows : [{}]), 'Responses');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sRows.length ? sRows : [{}]), 'Survey');
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        X.writeFile(wb, 'answerarena-data-' + stamp + '.xlsx');
        toast('Export ready.');
      });
    }).catch(function (e) { toast('Export failed: ' + ((e && e.message) || 'error')); });
  }
  function flatten(prefix, obj) { var o = {}; Object.keys(obj || {}).forEach(function (k) { var v = obj[k]; o[prefix + k] = (v && typeof v === 'object') ? JSON.stringify(v) : v; }); return o; }

  /* ---- misc ---- */
  function tsMs(ts) { if (!ts) return 0; if (typeof ts === 'number') return ts; if (typeof ts.toMillis === 'function') return ts.toMillis(); if (ts.seconds) return ts.seconds * 1000; return 0; }
  function fmtTs(ts) { var m = tsMs(ts); return m ? new Date(m).toLocaleString() : ''; }
  function ensureXLSX() { if (XLSX) return Promise.resolve(XLSX); return import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs').then(function (m) { XLSX = m; return m; }); }

  /* ---- bootstrap ---- */
  function init() {
    injectStyles();
    root = el('div', { id: 'aa-root' }, [el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { text: 'Connecting...' })])])]);
    document.body.appendChild(root);
    applyTheme(currentTheme());
    if (cachedAdmin()) { /* render after config loads */ }
    if (!Store) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'arena-store.js failed to load.' })])])); return; }
    Store.init().then(function () {
      Store.onAuth(function (u) { user = u || null; route(); });
    }).catch(function (e) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
