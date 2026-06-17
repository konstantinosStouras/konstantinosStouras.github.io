/* =====================================================================
   Answer Arena — admin panel
   ---------------------------------------------------------------------
   Activates only with ?admin. Requires the admin account (admin@admin.com).
   Mirrors the ideasearchlab admin: a single two-column page (no tabs).
     LEFT  - create a session; design parameters (2x2 + comparison flow +
             task set); page-text editors; registration/survey question editors.
     RIGHT - active sessions (join codes, counts); registered users (+ Excel).

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
  var user = null, root;

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
      + '#aa-root input::placeholder,#aa-root textarea::placeholder{color:var(--muted);}'
      + '#aa-root input:-webkit-autofill,#aa-root input:-webkit-autofill:hover,#aa-root input:-webkit-autofill:focus,#aa-root input:-webkit-autofill:active{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 1000px var(--field) inset;box-shadow:0 0 0 1000px var(--field) inset;caret-color:var(--ink);transition:background-color 9999s ease-in-out 0s;}'
      + '#aa-root textarea{resize:vertical;}'
      + '.aa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 16px;border-radius:10px;cursor:pointer;}'
      + '.aa-btn:hover{background:var(--accentd);}.aa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.aa-btn.sm{padding:7px 11px;font-size:12px;}.aa-btn.danger{background:transparent;color:#e06b5a;border:1px solid #6d3b34;}'
      + '.aa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-note{color:var(--muted);font-size:13px;line-height:1.6;}'
      + '.aa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);}'
      + '.aa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:99px;}'
      + '.aa-badge.open{color:#7bd88f;background:rgba(123,216,143,.14);}.aa-badge.waiting{color:#e6a417;background:rgba(230,164,23,.14);}.aa-badge.closed{color:#9a978f;background:rgba(154,151,143,.14);}'
      + 'table.aa-tbl{width:100%;border-collapse:collapse;font-size:13px;}table.aa-tbl th,table.aa-tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);}table.aa-tbl th{color:var(--muted);font-weight:600;}'
      + '.aa-login{max-width:380px;margin:8vh auto 0;}'
      + '.aa-err{color:#e06b5a;font-size:13px;min-height:18px;margin:6px 0;}'
      + '.aa-msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:10010;opacity:0;transition:.2s;}.aa-msg.show{opacity:1;}'
      + '.aa-toggle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;}'
      + '.aa-mode{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:3px 8px;}'
      + '.aa-wrap2{max-width:1180px;}'
      + '.aa-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:18px;align-items:start;}'
      + '@media (max-width:900px){.aa-grid{grid-template-columns:1fr;}}'
      + '.aa-col{min-width:0;}'
      + '.aa-count{font-size:13px;color:var(--muted);font-weight:600;}'
      + '.aa-sub{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:20px 2px 4px;}'
      + '.aa-switches{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;}'
      + '@media (max-width:560px){.aa-switches{grid-template-columns:1fr;}}'
      + '.aa-switchbox{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--qbg);}'
      + '.aa-switchbox b{font-size:14px;}'
      + '.aa-switch{position:relative;display:inline-block;width:44px;height:24px;flex:0 0 auto;}'
      + '.aa-switch input{opacity:0;width:0;height:0;position:absolute;}'
      + '.aa-slider{position:absolute;inset:0;background:#5a5a5a;border-radius:99px;transition:.18s;cursor:pointer;}'
      + '.aa-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.18s;}'
      + '.aa-switch input:checked + .aa-slider{background:var(--accent);}'
      + '.aa-switch input:checked + .aa-slider:before{transform:translateX(20px);}';
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
    root.appendChild(el('div', { class: 'aa-wrap' }, [
      el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:6px;' }, [themeToggle()]),
      el('div', { class: 'aa-card aa-login' }, [
      el('h1', { text: 'Answer Arena admin' }),
      (Store.mode === 'local') ? el('p', { class: 'aa-note', html: 'Local test mode (Firebase not configured). Log in as <b>' + esc(Store.ADMIN_EMAIL) + '</b> with any password.' }) : null,
      el('div', { class: 'aa-field' }, [el('label', { text: 'E-mail' }), email]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Password' }), pass]),
      err, btn
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

  /* ---- small helpers ---- */
  function checkbox(on) { var c = el('input', { type: 'checkbox' }); if (on) c.setAttribute('checked', 'checked'); return c; }
  // iOS-style toggle switch; returns { input, node }.
  function switchEl(on) { var input = el('input', { type: 'checkbox' }); if (on) input.setAttribute('checked', 'checked'); var node = el('label', { class: 'aa-switch' }, [input, el('span', { class: 'aa-slider' })]); return { input: input, node: node }; }
  function collapsible(label, buildInto) {
    var section = el('div', { class: 'aa-card', style: 'padding:0;overflow:hidden;' });
    var caret = el('span', { text: '▾', style: 'color:var(--muted);' });
    var bodyDiv = el('div', { style: 'display:none;padding:0 18px 16px;' });
    var open = false, built = false;
    section.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;', on: { click: toggle } }, [el('b', { text: label, style: 'font-size:15px;' }), caret]));
    section.appendChild(bodyDiv);
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open && !built) { built = true; buildInto(bodyDiv); } }
    return section;
  }

  /* ---- main shell: ideasearchlab-style two-column layout ----
     LEFT: create session + design parameters + page text + forms.
     RIGHT: active sessions, then registered users. */
  function renderShell() {
    clearRoot();
    var header = el('div', { class: 'aa-h' }, [
      el('h1', { text: 'Answer Arena admin' }),
      el('div', { class: 'aa-row' }, [themeToggle(), el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.logout().then(function () { user = null; route(); }); } } }, ['Sign out'])])
    ]);
    var left = el('div', { class: 'aa-col' });
    var right = el('div', { class: 'aa-col' });

    // RIGHT: active sessions (with inline creator) + registered users.
    right.appendChild(buildSessionsCard().node);
    right.appendChild(buildUsersCard());

    // LEFT: design parameters (2x2 conditions, comparison flow, task set),
    // then page text, then forms.
    left.appendChild(el('div', { class: 'aa-sub', text: 'Design parameters' }));
    left.appendChild(build2x2Card());
    left.appendChild(buildFlowCard());
    left.appendChild(buildTaskCard());
    left.appendChild(el('div', { class: 'aa-sub', text: 'Page text & content' }));
    PAGE_GROUPS.forEach(function (g) { left.appendChild(renderPageSection(g)); });
    left.appendChild(el('div', { class: 'aa-sub', text: 'Forms' }));
    left.appendChild(collapsible('Edit registration questions', function (c) { renderQuestions(c, 'registrationQuestions', 'Registration questions'); }));
    left.appendChild(collapsible('Edit survey questions', function (c) { renderQuestions(c, 'surveyQuestions', 'Survey questions'); }));

    root.appendChild(el('div', { class: 'aa-wrap aa-wrap2' }, [header, el('div', { class: 'aa-grid' }, [left, right])]));
  }

  /* ---- RIGHT: active sessions (ideasearchlab-style cards) ---- */
  function buildSessionsCard() {
    var card = el('div', { class: 'aa-card' });
    var countSpan = el('span', { class: 'aa-count' });
    card.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:4px;' }, [el('h3', { text: 'Active sessions' }), countSpan]));
    card.appendChild(el('p', { class: 'aa-note', text: 'Open a session to copy its join link or change its status. Every session uses the design parameters and content set on the left.' }));
    var nameI = el('input', { type: 'text', placeholder: 'New session name (optional)', style: 'flex:1 1 160px;min-width:120px;' });
    var statusI = el('select', { style: 'max-width:110px;' }, ['open', 'waiting', 'closed'].map(function (s) { return el('option', { value: s }, [s]); }));
    var createBtn = el('button', { class: 'aa-btn sm', on: { click: create } }, ['+ Create']);
    card.appendChild(el('div', { class: 'aa-row', style: 'margin:8px 0 4px;' }, [nameI, statusI, createBtn]));
    var createErr = el('div', { class: 'aa-err' });
    card.appendChild(createErr);
    var listWrap = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    card.appendChild(listWrap);
    card.appendChild(el('p', { class: 'aa-note', style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px;', text: 'Participants join with the session code on the welcome screen, or by opening the share link.' }));
    nameI.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });

    function create() {
      createErr.textContent = '';
      // Name is optional - auto-name a blank one so the button always works.
      var nm = nameI.value.trim() || ('Session ' + new Date().toLocaleString());
      createBtn.setAttribute('disabled', 'true'); createBtn.textContent = 'Creating...';
      Store.createSession({ name: nm, status: statusI.value, condition: null, taskSetId: cfg.activeTaskSetId || null })
        .then(function (s) { toast('Session created: ' + s.code); nameI.value = ''; createBtn.removeAttribute('disabled'); createBtn.textContent = '+ Create'; refresh(); })
        .catch(function (e) {
          createBtn.removeAttribute('disabled'); createBtn.textContent = '+ Create';
          var msg = (e && (e.code || e.message)) || 'error';
          createErr.textContent = 'Could not create the session: ' + msg + (/(permission|insufficient)/i.test(msg) ? ' - the Firestore rules may need (re)deploying.' : '');
          if (window.console) console.error('[Arena] createSession failed', e);
        });
    }
    function refresh() {
      Promise.all([Store.listSessions(), Store.listParticipants().catch(function () { return []; })]).then(function (res) {
        var list = res[0], parts = res[1] || [];
        var counts = {}; parts.forEach(function (p) { if (p.sessionId) counts[p.sessionId] = (counts[p.sessionId] || 0) + 1; });
        countSpan.textContent = list.length + ' active';
        listWrap.innerHTML = '';
        if (!list.length) { listWrap.appendChild(el('p', { class: 'aa-note', text: 'No sessions yet.' })); return; }
        list.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        list.forEach(function (s) { listWrap.appendChild(sessionCard(s, counts, refresh)); });
      }).catch(function (e) { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'aa-err', text: 'Could not load sessions: ' + ((e && e.code) || 'error') })); });
    }
    refresh();
    return { node: card, refresh: refresh };
  }
  function sessionCard(s, counts, refresh) {
    var liveCount = counts[s.id] != null ? counts[s.id] : (s.count || 0);
    var joinUrl = location.origin + location.pathname + '?s=' + s.code;
    var st = s.status || 'open';
    var box = el('div', { class: 'aa-q' });
    box.appendChild(el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
      el('div', {}, [el('b', { text: s.code, style: 'font-size:18px;letter-spacing:.1em;' }), ' ', el('span', { class: 'aa-badge ' + st, text: st })]),
      el('div', { style: 'text-align:right;' }, [
        el('div', { style: 'font-weight:700;font-size:14px;', text: liveCount + ' participant' + (liveCount === 1 ? '' : 's') }),
        el('div', { class: 'aa-note', text: s.name || '(unnamed)' })
      ])
    ]));
    box.appendChild(el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'Created ' + (fmtTs(s.createdAt) || 'just now') }));
    box.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
      el('button', { class: 'aa-btn sm', on: { click: function () { window.open(joinUrl, '_blank'); } } }, ['Open']),
      el('button', { class: 'aa-btn sec sm', on: { click: function () { copy(joinUrl); } } }, ['Copy link']),
      el('button', { class: 'aa-btn sec sm', on: { click: editMode } }, ['Edit']),
      el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Delete session ' + s.code + '?')) Store.deleteSession(s.id).then(function () { toast('Deleted.'); refresh(); }); } } }, ['Delete'])
    ]));
    function editMode() {
      box.innerHTML = '';
      var ename = el('input', { type: 'text', value: s.name || '' });
      var estatus = el('select', { style: 'max-width:130px;' }, ['open', 'waiting', 'closed'].map(function (x) { return el('option', { value: x }, [x]); }));
      estatus.value = st;
      box.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Name (' + s.code + ')' }), ename]));
      box.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Status' }), estatus]));
      box.appendChild(el('div', { class: 'aa-row' }, [
        el('button', { class: 'aa-btn sm', on: { click: function () { Store.updateSession(s.id, { name: ename.value.trim() || s.name, status: estatus.value }).then(function () { toast('Saved.'); refresh(); }); } } }, ['Save']),
        el('button', { class: 'aa-btn sec sm', on: { click: refresh } }, ['Cancel'])
      ]));
    }
    return box;
  }

  /* ---- RIGHT: registered users ---- */
  function buildUsersCard() {
    var card = el('div', { class: 'aa-card' });
    var all = [];
    card.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:8px;' }, [el('h3', { text: 'Registered users' }), el('button', { class: 'aa-btn sm', on: { click: function () { if (all.length) exportExcel(all); else toast('No users yet.'); } } }, ['Export to Excel'])]));
    var search = el('input', { type: 'text', placeholder: 'Search by e-mail or ID...' });
    card.appendChild(el('div', { class: 'aa-field' }, [search]));
    var listWrap = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    card.appendChild(listWrap);
    search.addEventListener('input', render);
    function render() {
      var q = search.value.trim().toLowerCase();
      var rows = all.filter(function (p) { return !q || (p.email || '').toLowerCase().indexOf(q) >= 0 || (p.participantId || '').toLowerCase().indexOf(q) >= 0; });
      listWrap.innerHTML = '';
      listWrap.appendChild(el('p', { class: 'aa-note', text: rows.length + ' of ' + all.length + ' user' + (all.length === 1 ? '' : 's') }));
      rows.forEach(function (p) {
        var c = p.condition || {};
        listWrap.appendChild(el('div', { class: 'aa-q' }, [
          el('div', { class: 'row', style: 'justify-content:space-between;' }, [
            el('b', { text: p.email || p.participantId || p._id }),
            el('span', { class: 'aa-note', text: p.status || '' })
          ]),
          el('div', { class: 'aa-note', style: 'margin-top:4px;', text: (p.participantId ? 'ID ' + p.participantId + '  ·  ' : '') + 'registered ' + fmtTs(p.createdAt) + (c.enabled ? '  ·  cell ' + c.transparency + '/' + c.incentive : '') }),
          el('div', { class: 'aa-row', style: 'margin-top:6px;' }, [
            el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Delete "' + (p.email || p._id) + '" and all their data?')) Store.deleteParticipant(p._id).then(function () { toast('Deleted.'); load(); }); } } }, ['Delete'])
          ])
        ]));
      });
    }
    function load() { Store.listParticipants().then(function (p) { all = p.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); }); render(); }).catch(function (e) { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'aa-err', text: 'Could not load users: ' + ((e && e.code) || 'error') })); }); }
    load();
    return card;
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
  function buildTaskCard() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('h3', { text: 'Comparisons (task set)' }));
    card.appendChild(el('p', { class: 'aa-note', html: 'Load comparisons with <b>three columns</b> - <b>task</b>, <b>outputA</b>, <b>outputB</b> (one row each; first row = headers). Headers are matched loosely: <b>Specific description</b> -> task, <b>Output of Haiku 4.5 ...</b> -> outputA, <b>Output of Opus 4.8 ...</b> -> outputB (also "Task"/"Prompt", "Output A"/"Answer 1", etc.). Participants see the two outputs in a randomized left/right order and never learn which produced which.' }));
    var setName = el('input', { type: 'text', placeholder: 'Name for this set (optional)' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Set name' }), setName]));
    var file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Upload an Excel / CSV file' }), file]));
    var gsUrl = el('input', { type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/.../edit#gid=0' });
    card.appendChild(el('div', { class: 'aa-field' }, [
      el('label', { text: 'Or import from a Google Sheet link' }), gsUrl,
      el('div', { class: 'aa-note', style: 'margin-top:4px;', html: 'The sheet must be shared <b>Anyone with the link - Viewer</b> (or File -> Share -> Publish to web). Use the link of the single tab that holds the three columns - the <code>#gid=</code> in the URL selects the tab.' })
    ]));
    card.appendChild(el('div', { class: 'aa-row' }, [el('button', { class: 'aa-btn sm', on: { click: importGoogle } }, ['Import from Google Sheet'])]));
    var preview = el('div', { style: 'margin-top:8px;' });
    card.appendChild(preview);

    var active = el('div', { style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:12px;' }, [el('p', { class: 'aa-note', text: 'Loading current set...' })]);
    card.appendChild(active);
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

    function importGoogle() {
      var url = gsUrl.value.trim();
      if (!url) { toast('Paste a Google Sheet link first.'); return; }
      var id = (url.match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(url) ? url : '');
      if (!id) { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'That does not look like a Google Sheet link.' })); return; }
      var gid = (url.match(/[#?&]gid=([0-9]+)/) || [])[1];
      var csvUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : '');
      preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-note', text: 'Fetching the sheet...' }));
      ensureXLSX().then(function (X) {
        return fetch(csvUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (text) {
          if (/<html|<!doctype/i.test(text.slice(0, 200))) throw new Error('the sheet is not publicly readable');
          var wb = X.read(text, { type: 'string' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = X.utils.sheet_to_json(ws, { header: 1, defval: '' });
          parsed = rowsToTasks(rows);
          showPreview();
        });
      }).catch(function (e) {
        preview.innerHTML = '';
        preview.appendChild(el('p', { class: 'aa-err', html: 'Could not import: ' + esc((e && e.message) || 'error') + '. Make sure the sheet is shared <b>Anyone with the link - Viewer</b> (private sheets cannot be read by the browser), and that the link points at the tab with the three columns.' }));
      });
    }

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
    return card;
  }
  function rowsToTasks(rows) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(function (h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); });
    // Match by candidate PRIORITY (outer loop = candidates): exact match first
    // (so short codes like "a"/"b" don't match "t-a-sk"), then substring for
    // tokens >= 3 chars. Priority order means e.g. "Specific description" wins
    // over "Prompt" for the task column when both are present.
    function find(cands) {
      var i, j;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (header[i] === cands[j]) return i;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (cands[j].length >= 3 && header[i].indexOf(cands[j]) >= 0) return i;
      return -1;
    }
    var ti = find(['specificdescription', 'description', 'task', 'prompt', 'question']);
    var ai = find(['outputa', 'answera', 'haiku', 'output1', 'answer1', 'modela', 'a']);
    var bi = find(['outputb', 'answerb', 'opus', 'output2', 'answer2', 'modelb', 'b']);
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
  // The 2x2 conditions card: two toggle switches (one per factor). The two
  // switches define the design - both on = 4 groups, one on = 2, none = 1.
  // Saves immediately on toggle (like the ideasearchlab AI toggles).
  function build2x2Card() {
    var dflt = { factors: { transparency: false, incentive: false } };
    var tt = Object.assign({}, dflt, (D.settings || {}).twoByTwo, (cfg.settings || {}).twoByTwo);
    var f = tt.factors || dflt.factors;
    var trans = switchEl(!!f.transparency);
    var inc = switchEl(!!f.incentive);
    var summary = el('div', { class: 'aa-note', style: 'margin-top:10px;' });
    function paint() {
      var n = (trans.input.checked ? 1 : 0) + (inc.input.checked ? 1 : 0);
      summary.textContent = n === 0
        ? 'No conditions varied - everyone is in a single baseline group.'
        : Math.pow(2, n) + ' groups (' + n + ' condition' + (n === 1 ? '' : 's') + ' varied). Participants are randomly and invisibly assigned.';
    }
    function save() {
      var settings = Object.assign({}, cfg.settings, { twoByTwo: { factors: { transparency: trans.input.checked, incentive: inc.input.checked } } });
      paint();
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    trans.input.addEventListener('change', save);
    inc.input.addEventListener('change', save);
    paint();
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: '2x2 conditions' }),
      el('p', { class: 'aa-note', text: 'Turn on each condition you want to vary. Participants are randomly and invisibly assigned a group and are never shown their condition (or told that conditions exist). Both on = 4 groups; one on = 2 groups; none = a single baseline group.' }),
      el('div', { class: 'aa-switches' }, [
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Transparency' }), trans.node]),
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Incentive' }), inc.node])
      ]),
      summary
    ]);
  }

  function buildFlowCard() {
    var s = cfg.settings || {};
    var randomize = checkbox(s.randomizeOrder !== false);
    var perUser = el('input', { type: 'number', value: String(s.comparisonsPerUser != null ? s.comparisonsPerUser : 0), style: 'max-width:140px;' });
    var reqCode = checkbox(s.requireSessionCode);
    function doSave() {
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: randomize.checked,
        comparisonsPerUser: parseInt(perUser.value, 10) || 0,
        requireSessionCode: reqCode.checked
      });
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; toast('Comparison flow saved.'); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function restoreDefaults() {
      var Ds = D.settings || {};
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: Ds.randomizeOrder !== false,
        comparisonsPerUser: Ds.comparisonsPerUser || 0,
        requireSessionCode: !!Ds.requireSessionCode
      });
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; randomize.checked = settings.randomizeOrder; perUser.value = String(settings.comparisonsPerUser); reqCode.checked = settings.requireSessionCode; toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); });
    }
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Comparison flow' }),
      el('p', { class: 'aa-note', text: 'Each participant is shown a number of task pairs in a random sequence. Set how many, and whether the order is randomized.' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [randomize, document.createTextNode('Show comparisons in random order per participant')])]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Comparisons per participant (0 = use the whole active set)' }), perUser]),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [reqCode, document.createTextNode('Require a session code to start')])]),
      el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: doSave } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: restoreDefaults } }, ['Restore built-in default'])
      ])
    ]);
  }

  /* ===================== EXPORT ===================== */
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
