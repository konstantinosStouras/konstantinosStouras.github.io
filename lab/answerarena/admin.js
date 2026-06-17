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
      + '#aa-root input:not([type=checkbox]):not([type=radio]):not([type=file]),#aa-root select,#aa-root textarea{width:100%;padding:9px 11px;border:1px solid var(--fieldline);border-radius:9px;font-size:16px;font-family:inherit;background:var(--field);color:var(--ink);}'
      + '#aa-root input::placeholder,#aa-root textarea::placeholder{color:var(--muted);}'
      + '#aa-root input:-webkit-autofill,#aa-root input:-webkit-autofill:hover,#aa-root input:-webkit-autofill:focus,#aa-root input:-webkit-autofill:active{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 1000px var(--field) inset;box-shadow:0 0 0 1000px var(--field) inset;caret-color:var(--ink);transition:background-color 9999s ease-in-out 0s;}'
      + '#aa-root textarea{resize:vertical;}'
      + '.aa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 16px;border-radius:10px;cursor:pointer;}'
      + '.aa-btn:hover{background:var(--accentd);}.aa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.aa-btn.sm{padding:7px 11px;font-size:12px;}.aa-btn.danger{background:transparent;color:#e06b5a;border:1px solid #6d3b34;}'
      + '.aa-btn.green{background:#2faa5e;color:#fff;border:none;box-shadow:0 4px 12px rgba(47,170,94,.30);}.aa-btn.green:hover{background:#268a4c;box-shadow:0 7px 18px rgba(47,170,94,.38);}'
      + '#aa-root input[type=file]{font-size:14px;color:var(--muted);}'
      + '#aa-root input[type=file]::file-selector-button{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px;cursor:pointer;margin-right:10px;}'
      + '#aa-root input[type=file]::-webkit-file-upload-button{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px;cursor:pointer;margin-right:10px;}'
      + '#aa-root input[type=file]::file-selector-button:hover,#aa-root input[type=file]::-webkit-file-upload-button:hover{background:var(--accentd);}'
      + '.aa-importbtn{display:inline-flex;align-items:center;gap:9px;padding:11px 20px;border-radius:11px;box-shadow:0 6px 16px rgba(230,126,34,.30);transition:transform .12s,box-shadow .12s,background .15s;}'
      + '.aa-importbtn:hover{transform:translateY(-1px);box-shadow:0 9px 22px rgba(230,126,34,.38);}'
      + '.aa-importbtn:active{transform:translateY(0);box-shadow:0 4px 12px rgba(230,126,34,.30);}'
      + '.aa-importbtn svg{flex:0 0 auto;opacity:.95;}'
      + '.aa-sumtbl{border:1px solid var(--line);border-radius:10px;padding:2px 14px;background:var(--qbg);}'
      + '.aa-sumrow{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);}'
      + '.aa-sumrow:last-child{border-bottom:none;}'
      + '.aa-sumk{color:var(--muted);font-size:13px;}'
      + '.aa-sumv{font-weight:700;font-size:13px;text-align:right;min-width:0;overflow-wrap:anywhere;}'
      + '.aa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-note{color:var(--muted);font-size:13px;line-height:1.6;}'
      + '.aa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);overflow-wrap:break-word;}'
      + '.aa-q b{min-width:0;overflow-wrap:anywhere;}'
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

    // RIGHT: active sessions (list only) + registered users. The sub-heading
    // keeps the first card aligned with the left column's first card.
    var sessions = buildSessionsCard();
    right.appendChild(el('div', { class: 'aa-sub', text: 'Sessions & participants' }));
    right.appendChild(sessions.node);
    right.appendChild(buildUsersCard());

    // LEFT: design parameters (2x2 conditions, comparison flow, task set),
    // then page text, then forms, then the Create Session action + summary.
    left.appendChild(el('div', { class: 'aa-sub', text: 'Design parameters' }));
    left.appendChild(build2x2Card());
    left.appendChild(buildFlowCard());
    left.appendChild(buildTaskCard());
    left.appendChild(el('div', { class: 'aa-sub', text: 'Page text & content' }));
    PAGE_GROUPS.forEach(function (g) { left.appendChild(renderPageSection(g)); });
    left.appendChild(el('div', { class: 'aa-sub', text: 'Forms' }));
    left.appendChild(collapsible('Edit registration questions', function (c) { renderQuestions(c, 'registrationQuestions', 'Registration questions'); }));
    left.appendChild(collapsible('Edit survey questions', function (c) { renderQuestions(c, 'surveyQuestions', 'Survey questions'); }));
    left.appendChild(el('div', { class: 'aa-sub', text: 'Launch' }));
    left.appendChild(buildCreateCard(sessions.refresh));

    root.appendChild(el('div', { class: 'aa-wrap aa-wrap2' }, [header, el('div', { class: 'aa-grid' }, [left, right])]));
  }

  /* ---- RIGHT: active + closed session cards (created from the left column) ---- */
  function buildSessionsCard() {
    var lastOpen = [], lastClosed = [], counts = {};

    // Active sessions.
    var activeCard = el('div', { class: 'aa-card' });
    var activeCount = el('span', { class: 'aa-count' });
    activeCard.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:4px;' }, [el('h3', { text: 'Active sessions' }), activeCount]));
    activeCard.appendChild(el('p', { class: 'aa-note', text: 'Every session is created open. Copy its join link to invite participants, export its data, or close it to stop new joins. Create sessions from the left column.' }));
    var activeSearch = el('input', { type: 'text', placeholder: 'Search by session ID, name or date...' });
    activeCard.appendChild(el('div', { class: 'aa-field' }, [activeSearch]));
    var activeList = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    activeCard.appendChild(activeList);
    activeCard.appendChild(el('p', { class: 'aa-note', style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px;', text: 'Participants join with the session code on the welcome/login screen, or by opening the share link.' }));

    // Closed sessions (hidden until there are any). A closed session no longer
    // lets participants join; its data is kept for review/export.
    var closedCard = el('div', { class: 'aa-card', style: 'display:none;' });
    var closedCount = el('span', { class: 'aa-count' });
    closedCard.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:4px;' }, [el('h3', { text: 'Closed sessions' }), closedCount]));
    closedCard.appendChild(el('p', { class: 'aa-note', text: 'These no longer accept participants. Export their data to review, reopen them, or delete if no longer needed.' }));
    var closedSearch = el('input', { type: 'text', placeholder: 'Search by session ID, name or date...' });
    closedCard.appendChild(el('div', { class: 'aa-field' }, [closedSearch]));
    var closedList = el('div', {});
    closedCard.appendChild(closedList);

    var wrap = el('div', {}, [activeCard, closedCard]);
    activeSearch.addEventListener('input', renderActive);
    closedSearch.addEventListener('input', renderClosed);

    // Match a session by its code (session ID), name, or created date string.
    function matches(s, q) {
      if (!q) return true;
      return (s.code || '').toLowerCase().indexOf(q) >= 0
        || (s.name || '').toLowerCase().indexOf(q) >= 0
        || (fmtTs(s.createdAt) || '').toLowerCase().indexOf(q) >= 0;
    }
    function renderActive() {
      var q = activeSearch.value.trim().toLowerCase();
      activeCount.textContent = lastOpen.length + ' active';
      activeList.innerHTML = '';
      if (!lastOpen.length) { activeList.appendChild(el('p', { class: 'aa-note', text: 'No active sessions - create one from the left column.' })); return; }
      var rows = lastOpen.filter(function (s) { return matches(s, q); });
      if (!rows.length) { activeList.appendChild(el('p', { class: 'aa-note', text: 'No sessions match your search.' })); return; }
      rows.forEach(function (s) { activeList.appendChild(sessionCard(s, counts, refresh)); });
    }
    function renderClosed() {
      var q = closedSearch.value.trim().toLowerCase();
      closedCount.textContent = lastClosed.length + (lastClosed.length === 1 ? ' session' : ' sessions');
      closedCard.style.display = lastClosed.length ? 'block' : 'none';
      closedList.innerHTML = '';
      if (!lastClosed.length) return;
      var rows = lastClosed.filter(function (s) { return matches(s, q); });
      if (!rows.length) { closedList.appendChild(el('p', { class: 'aa-note', text: 'No sessions match your search.' })); return; }
      rows.forEach(function (s) { closedList.appendChild(sessionCard(s, counts, refresh)); });
    }
    function refresh() {
      Promise.all([Store.listSessions(), Store.listParticipants().catch(function () { return []; })]).then(function (res) {
        var list = res[0], parts = res[1] || [];
        // A participant counts for a session they have played - started it
        // (playedSessions), are currently in it (sessionId), or completed it.
        counts = {};
        parts.forEach(function (p) {
          var seen = {};
          if (p.sessionId) seen[p.sessionId] = true;
          Object.keys(p.playedSessions || {}).forEach(function (sid) { seen[sid] = true; });
          Object.keys(p.completedSessions || {}).forEach(function (sid) { seen[sid] = true; });
          Object.keys(seen).forEach(function (sid) { counts[sid] = (counts[sid] || 0) + 1; });
        });
        list.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        lastOpen = list.filter(function (x) { return (x.status || 'open') !== 'closed'; });
        lastClosed = list.filter(function (x) { return (x.status || 'open') === 'closed'; });
        renderActive(); renderClosed();
      }).catch(function (e) { activeList.innerHTML = ''; activeList.appendChild(el('p', { class: 'aa-err', text: 'Could not load sessions: ' + ((e && e.code) || 'error') })); });
    }
    refresh();
    return { node: wrap, refresh: refresh };
  }
  // The 2x2 conditions a session runs (snapshotted at creation; falls back to
  // the current global setting for older sessions).
  function condLabel(cond) {
    var f = (cond && cond.factors) || ((cfg.settings && cfg.settings.twoByTwo && cfg.settings.twoByTwo.factors) || {});
    var on = [];
    if (f.transparency) on.push('Cost transparency');
    if (f.incentive) on.push('Firm-pay');
    return on.length ? on.join(' + ') : 'Baseline (no conditions)';
  }
  function sessionCard(s, counts, refresh) {
    var liveCount = counts[s.id] != null ? counts[s.id] : (s.count || 0);
    var joinUrl = location.origin + location.pathname + '?s=' + s.code;
    var st = s.status || 'open';
    var box = el('div', { class: 'aa-q' });
    box.appendChild(el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
      el('div', { style: 'min-width:0;' }, [
        el('b', { text: s.code, style: 'font-size:18px;letter-spacing:.1em;' }), ' ', el('span', { class: 'aa-badge ' + st, text: st }),
        s.name ? el('div', { class: 'aa-note', style: 'margin-top:2px;' }, [s.name]) : null
      ]),
      el('div', { style: 'text-align:right;min-width:0;' }, [
        el('div', { style: 'font-weight:700;font-size:14px;', text: liveCount + ' participant' + (liveCount === 1 ? '' : 's') }),
        el('div', { class: 'aa-note', text: condLabel(s.condition) })
      ])
    ]));
    box.appendChild(el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'Created ' + (fmtTs(s.createdAt) || 'just now') }));
    var actions = [];
    if (st === 'closed') {
      // Closed: review (export), reopen, or remove. Joining is disabled, so no
      // Open/Copy.
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.updateSession(s.id, { status: 'open' }).then(function () { toast('Reopened.'); refresh(); }); } } }, ['Reopen']));
      actions.push(el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Permanently delete session ' + s.code + '? (Participant data is kept.)')) Store.deleteSession(s.id).then(function () { toast('Deleted.'); refresh(); }); } } }, ['Delete']));
    } else {
      actions.push(el('button', { class: 'aa-btn sm', on: { click: function () { window.open(joinUrl, '_blank'); } } }, ['Open']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { copy(joinUrl); } } }, ['Copy link']));
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: editMode } }, ['Edit name']));
      // "Delete" a running session = close it (participants can no longer join).
      actions.push(el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Close session ' + s.code + '? Participants will no longer be able to join.')) Store.updateSession(s.id, { status: 'closed' }).then(function () { toast('Closed.'); refresh(); }); } } }, ['Close']));
    }
    box.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, actions));
    // Download only the data for the users who played THIS session.
    function exportSession() {
      Store.listParticipants().then(function (all) {
        var parts = all.filter(function (p) { return p.sessionId === s.id || (p.playedSessions && p.playedSessions[s.id]) || (p.completedSessions && p.completedSessions[s.id]); });
        if (!parts.length) { toast('No participants in this session yet.'); return; }
        exportExcel(parts, { sessionId: s.id, sessionCode: s.code });
      }).catch(function (e) { toast('Export failed: ' + ((e && e.code) || 'error')); });
    }
    function editMode() {
      box.innerHTML = '';
      var ename = el('input', { type: 'text', value: s.name || '' });
      box.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Name (' + s.code + ')' }), ename]));
      box.appendChild(el('div', { class: 'aa-row' }, [
        el('button', { class: 'aa-btn sm', on: { click: function () { Store.updateSession(s.id, { name: ename.value.trim() }).then(function () { toast('Saved.'); refresh(); }); } } }, ['Save']),
        el('button', { class: 'aa-btn sec sm', on: { click: refresh } }, ['Cancel'])
      ]));
    }
    return box;
  }

  /* ---- LEFT (bottom): create a session + setup summary ---- */
  function buildCreateCard(sessionsRefresh) {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('h3', { text: 'Create a session' }));
    card.appendChild(el('p', { class: 'aa-note', text: 'Creates an open session using the parameters and content above. Share its join link with participants; close it later (from the right) to stop new joins.' }));
    var nameI = el('input', { type: 'text', placeholder: 'Optional label, e.g. "Pilot group A"' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Session name (optional)' }), nameI]));
    var err = el('div', { class: 'aa-err' });
    var btn = el('button', { class: 'aa-btn', on: { click: create } }, ['Create Session']);
    card.appendChild(el('div', { class: 'aa-row' }, [btn]));
    card.appendChild(err);
    var summary = el('div', { style: 'margin-top:16px;' });
    card.appendChild(summary);
    nameI.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    renderSummary();

    function factors() { return (cfg.settings && cfg.settings.twoByTwo && cfg.settings.twoByTwo.factors) || {}; }
    function create() {
      err.textContent = '';
      var f = factors();
      var cond = { factors: { transparency: !!f.transparency, incentive: !!f.incentive } };  // snapshot the 2x2 onto the session
      btn.setAttribute('disabled', 'true'); btn.textContent = 'Creating...';
      Store.createSession({ name: nameI.value.trim(), status: 'open', condition: cond, taskSetId: cfg.activeTaskSetId || null })
        .then(function (s) { toast('Session created: ' + s.code); nameI.value = ''; btn.removeAttribute('disabled'); btn.textContent = 'Create Session'; if (sessionsRefresh) sessionsRefresh(); })
        .catch(function (e) {
          btn.removeAttribute('disabled'); btn.textContent = 'Create Session';
          var msg = (e && (e.code || e.message)) || 'error';
          err.textContent = 'Could not create the session: ' + msg + (/(permission|insufficient)/i.test(msg) ? ' - the Firestore rules may need (re)deploying.' : '');
          if (window.console) console.error('[Arena] createSession failed', e);
        });
    }
    function renderSummary() {
      var s = cfg.settings || {}, f = factors();
      var on = []; if (f.transparency) on.push('Cost transparency'); if (f.incentive) on.push('Firm-pay');
      var groups = (on.length === 0) ? 'single baseline group' : (Math.pow(2, on.length) + ' groups (' + on.join(' × ') + ')');
      var lim = s.comparisonsPerUser || 0;
      var rows = [
        ['Comparisons / participant', lim > 0 ? String(lim) : 'whole active set'],
        ['Order', (s.randomizeOrder !== false) ? 'randomized per participant' : 'fixed order'],
        ['Per comparison', 'pick or tie + 1-5 satisfaction for each answer + reason'],
        ['Session code', 'required to take part'],
        ['2x2 conditions', groups],
        ['Active task set', 'loading...']
      ];
      summary.innerHTML = '';
      summary.appendChild(el('div', { class: 'aa-sub', style: 'margin:0 0 4px;', text: 'Setup summary' }));
      summary.appendChild(el('p', { class: 'aa-note', style: 'margin:0 0 8px;', text: 'A snapshot of the saved settings a new session will use. Save changes above, then Refresh.' }));
      var tbl = el('div', { class: 'aa-sumtbl' });
      rows.forEach(function (r) { tbl.appendChild(el('div', { class: 'aa-sumrow' }, [el('span', { class: 'aa-sumk', text: r[0] }), el('span', { class: 'aa-sumv', text: r[1] })])); });
      summary.appendChild(tbl);
      summary.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [el('button', { class: 'aa-btn sec sm', on: { click: renderSummary } }, ['↻ Refresh summary'])]));
      Store.loadActiveTasks().then(function (set) {
        var vEls = tbl.querySelectorAll('.aa-sumv');
        if (vEls.length) vEls[vEls.length - 1].textContent = (set && set.tasks ? set.tasks.length : 0) + ' comparisons' + (set && set.name ? ' (' + set.name + ')' : '');
      }).catch(function () {});
    }
    return card;
  }

  /* ---- RIGHT: registered users ---- */
  function buildUsersCard() {
    var card = el('div', { class: 'aa-card' });
    var all = [];
    card.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:8px;' }, [el('h3', { text: 'Registered users' }), el('button', { class: 'aa-btn green sm', on: { click: function () { if (all.length) exportExcel(all); else toast('No users yet.'); } } }, ['Export to Excel'])]));
    var search = el('input', { type: 'text', placeholder: 'Search by Participant ID, e-mail or account ID...' });
    card.appendChild(el('div', { class: 'aa-field' }, [search]));
    var listWrap = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    card.appendChild(listWrap);
    search.addEventListener('input', render);
    function render() {
      var q = search.value.trim().toLowerCase();
      var rows = all.filter(function (p) {
        if (!q) return true;
        return (p.participantId || '').toLowerCase().indexOf(q) >= 0
          || (p.email || '').toLowerCase().indexOf(q) >= 0
          || (p._id || '').toLowerCase().indexOf(q) >= 0;
      });
      listWrap.innerHTML = '';
      listWrap.appendChild(el('p', { class: 'aa-note', text: rows.length + ' of ' + all.length + ' user' + (all.length === 1 ? '' : 's') }));
      rows.forEach(function (p) {
        var c = p.condition || {};
        listWrap.appendChild(el('div', { class: 'aa-q' }, [
          el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
            el('div', { style: 'min-width:0;' }, [
              el('b', { text: p.participantId || '(no participant ID)' }),
              el('div', { class: 'aa-note', style: 'margin-top:2px;', text: p.email || '(no e-mail)' })
            ]),
            el('span', { class: 'aa-note', text: p.status || '' })
          ]),
          el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'registered ' + fmtTs(p.createdAt) + '  ·  ' + Object.keys(p.completedSessions || {}).length + ' session(s) completed' + (c.enabled ? '  ·  cell ' + c.transparency + '/' + c.incentive : '') }),
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
    card.appendChild(el('p', { class: 'aa-note', html: 'Feed the <b>"Summarized"</b> sheet - either an <b>Excel/CSV file</b> or a <b>public Google Sheet link</b> of the same layout (first row = headers, matched loosely). It uses these columns: <b>Prompt</b> -> the task shown, <b>Output of Haiku 4.5 ...</b> -> Answer A, <b>Output of Opus 4.8 ...</b> -> Answer B, the two <b>Total Cost ($)</b> columns -> the per-answer US$ cost (for the "cost transparency" condition), and <b>Task ID</b> / <b>Complexity</b> / <b>Domain</b> / <b>General task</b> for labels and analysis. The other columns (Specific description, Notes, token counts, thinking cost) are ignored. A simple <b>task / outputA / outputB</b> file (with optional cost columns) still works too. Participants see the two outputs in a randomized left/right order and never learn which produced which.' }));
    var file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Upload an Excel / CSV file' }), file]));
    var gsUrl = el('input', { type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/.../edit#gid=0' });
    card.appendChild(el('div', { class: 'aa-field' }, [
      el('label', { text: 'Or import from a Google Sheet link' }), gsUrl,
      el('div', { class: 'aa-note', style: 'margin-top:4px;', html: 'The sheet must be shared <b>Anyone with the link - Viewer</b> (or File -> Share -> Publish to web). Open the <b>"Summarized"</b> tab and copy its link - the <code>#gid=</code> in the URL selects that tab, so the workbook can have other tabs and only "Summarized" is read.' })
    ]));
    card.appendChild(el('div', { class: 'aa-row' }, [el('button', { class: 'aa-btn aa-importbtn', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg><span>Import from Google Sheet</span>', on: { click: importGoogle } })]));
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
            applyParsed();
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
          applyParsed();
        });
      }).catch(function (e) {
        preview.innerHTML = '';
        preview.appendChild(el('p', { class: 'aa-err', html: 'Could not import: ' + esc((e && e.message) || 'error') + '. Make sure the sheet is shared <b>Anyone with the link - Viewer</b> (private sheets cannot be read by the browser), and that the link points at the <b>"Summarized"</b> tab.' }));
      });
    }

    // An upload/import is parsed, previewed, and saved as the active set right
    // away (the Save button is then just an explicit re-save).
    function applyParsed() {
      showPreview();
      if (parsed && parsed.length) activate('Saved as the active set (' + parsed.length + ' comparison' + (parsed.length === 1 ? '' : 's') + ').');
    }
    function showPreview() {
      preview.innerHTML = '';
      if (!parsed || !parsed.length) { preview.appendChild(el('p', { class: 'aa-err', text: 'No rows found. Check the file has a header row and at least one data row.' })); return; }
      preview.appendChild(el('p', { class: 'aa-note', text: parsed.length + ' comparison' + (parsed.length === 1 ? '' : 's') + ' loaded and saved as the active set. Preview of the first few:' }));
      var tbl = el('table', { class: 'aa-tbl' });
      var has = function (k) { return parsed.some(function (r) { return r[k] != null && r[k] !== ''; }); };
      // Only show optional columns that the upload actually carried.
      var cols = [{ h: '#', f: function (r, i) { return String(i + 1); } }, { h: 'Task ID', f: function (r) { return r.id; } }];
      if (has('domain')) cols.push({ h: 'Domain', f: function (r) { return r.domain; } });
      if (has('title')) cols.push({ h: 'Title', f: function (r) { return clip(r.title); } });
      cols.push({ h: 'Task', f: function (r) { return clip(r.task); } });
      cols.push({ h: 'Output A', f: function (r) { return clip(r.outputA); } });
      cols.push({ h: 'Output B', f: function (r) { return clip(r.outputB); } });
      if (has('costA') || has('costB')) {
        cols.push({ h: 'Cost A ($)', f: function (r) { return r.costA != null ? String(r.costA) : ''; } });
        cols.push({ h: 'Cost B ($)', f: function (r) { return r.costB != null ? String(r.costB) : ''; } });
      }
      tbl.appendChild(el('thead', {}, [el('tr', {}, cols.map(function (c) { return el('th', { text: c.h }); }))]));
      var tb = el('tbody', {});
      parsed.slice(0, 5).forEach(function (r, i) { tb.appendChild(el('tr', {}, cols.map(function (c) { return el('td', { text: String(c.f(r, i) == null ? '' : c.f(r, i)) }); }))); });
      tbl.appendChild(tb);
      preview.appendChild(el('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch;' }, [tbl]));
      preview.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [
        el('button', { class: 'aa-btn', on: { click: function () { activate('Comparisons saved (' + parsed.length + ').'); } } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: function () { activate('Comparisons saved as the default (' + parsed.length + ').'); } } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default']),
        el('button', { class: 'aa-btn sec', on: { click: discard } }, ['Discard'])
      ]));
    }
    function discard() { parsed = null; file.value = ''; preview.innerHTML = ''; }
    // Save the parsed upload as the active comparison set, keeping the preview
    // visible. ("Save" and "Make this the default" both do this - the active set
    // is the one participants get.)
    function activate(msg) {
      if (!parsed || !parsed.length) return;
      var set = { name: 'Uploaded ' + new Date().toLocaleString(), source: 'excel', tasks: parsed, count: parsed.length };
      Store.saveTaskSet(set).then(function (id) { cfg.activeTaskSetId = id; toast(msg); refreshActive(); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function restoreBuiltin() {
      saveConfig({ activeTaskSetId: null }).then(function () { cfg.activeTaskSetId = null; toast('Restored built-in default.'); discard(); refreshActive(); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); });
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
  // Parse a grid (Excel upload or Google Sheet CSV) into task objects. Built for
  // the "Summarized" layout (Task ID, Complexity, Domain, General task, Specific
  // description, Prompt, Notes, then per-model Output / token / cost columns), but
  // backward-compatible with a simple task / outputA / outputB[/ costA / costB] file.
  function rowsToTasks(rows) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(function (h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); });
    // Match by candidate PRIORITY (outer loop = candidates): exact match first
    // (so short codes like "a"/"b" don't match "t-a-sk"), then substring for
    // tokens >= 3 chars.
    function find(cands) {
      var i, j;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (header[i] === cands[j]) return i;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (cands[j].length >= 3 && header[i].indexOf(cands[j]) >= 0) return i;
      return -1;
    }
    // All columns (in sheet order) whose normalized header satisfies a predicate.
    function findAll(pred) { var a = []; for (var i = 0; i < header.length; i++) if (pred(header[i])) a.push(i); return a; }

    var idi = find(['taskid', 'id']);                                  // A  Task ID
    var cxi = find(['complexity', 'difficulty']);                      // B  Complexity
    var dmi = find(['domain', 'category']);                            // C  Domain
    var tti = find(['generaltask', 'title', 'tasktitle']);            // D  General task -> title
    // Body shown to participants: the Prompt the models actually answered, else a
    // description / task / question column.
    var ti = find(['prompt', 'specificdescription', 'description', 'task', 'question']); // F  Prompt
    // The two model outputs: text columns with "output"/"answer" but NOT the token
    // or cost columns. First = Output A (baseline), second = Output B (frontier).
    var outCols = findAll(function (h) { return /output|answer/.test(h) && !/token|cost/.test(h); });
    var ai = find(['outputa', 'answera', 'haiku', 'output1', 'answer1', 'baseline', 'modela']); // H
    var bi = find(['outputb', 'answerb', 'opus', 'output2', 'answer2', 'frontier', 'modelb']);  // N
    if (ai < 0 && outCols.length) ai = outCols[0];
    if (bi < 0 && outCols.length > 1) bi = outCols[1];
    // The two TOTAL cost columns (US$), in model order: prefer "total cost", else a
    // cost column that is not the "thinking" cost, else columns D/E (old layout).
    var costCols = findAll(function (h) { return h.indexOf('totalcost') >= 0; });             // M, S
    if (costCols.length < 2) costCols = findAll(function (h) { return h.indexOf('cost') >= 0 && h.indexOf('thinking') < 0; });
    var cai = costCols.length ? costCols[0] : 3;
    var cbi = costCols.length > 1 ? costCols[1] : 4;

    // Parse a money value: numbers pass through; strings may carry $/commas/spaces
    // and (from CSV imports) scientific notation like "8.29E-4", which must survive.
    function money(v) {
      if (typeof v === 'number') return isFinite(v) ? v : null;
      var s = String(v == null ? '' : v).replace(/[^0-9eE.+\-]/g, '');
      if (!s) return null;
      var n = parseFloat(s);
      return isFinite(n) ? n : null;
    }
    function str(row, i) { return i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : ''; }

    // Treat row 1 as a header only if at least two of task/outputA/outputB were
    // recognized; otherwise assume no header and use the first three columns.
    var found = (ti >= 0 ? 1 : 0) + (ai >= 0 ? 1 : 0) + (bi >= 0 ? 1 : 0);
    var hasHeader = found >= 2;
    var TI = ti < 0 ? 0 : ti, AI = ai < 0 ? 1 : ai, BI = bi < 0 ? 2 : bi;
    var out = [], start = hasHeader ? 1 : 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var task = str(row, TI), oa = str(row, AI), ob = str(row, BI);
      if (!task && !oa && !ob) continue;
      var t = { id: str(row, idi) || ('T' + (out.length + 1)), task: task, outputA: oa, outputB: ob };
      var cx = str(row, cxi); if (cx) t.complexity = cx;   // shown in export / analysis
      var dm = str(row, dmi); if (dm) t.domain = dm;       // shown in the TASK label
      var tt = str(row, tti); if (tt) t.title = tt;        // shown as the task title
      var ca = money(row[cai]); if (ca != null) t.costA = ca;
      var cb = money(row[cbi]); if (cb != null) t.costB = cb;
      out.push(t);
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
        el('button', { class: 'aa-btn', on: { click: save } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: makeDefault } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: restoreBuiltin } }, ['Restore built-in default'])
      ]));
    }
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open) build(); }
    function collect() { var texts = {}; Object.keys(inputs).forEach(function (key) { var v = inputs[key].input.value; texts[key] = inputs[key].kind === 'paras' ? v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : v; }); return texts; }
    // One live config, so "Save" and "Make this the default" both persist this
    // page's text; "Restore built-in default" reverts to the arena-data.js text.
    function persist(msg) { var merged = Object.assign({}, cfg.texts, collect()); return saveConfig({ texts: merged }).then(function () { cfg.texts = merged; toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }); }
    function save() { persist(g.label + ' saved.'); }
    function makeDefault() { persist(g.label + ' saved as the default.'); }
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
      summary.textContent = n === 2
        ? '4 groups - the full 2x2 = 4 design. Each participant belongs to exactly one of the four groups (randomly and invisibly assigned).'
        : n === 1
          ? '2 groups (one of the two conditions varied). Each participant belongs to one group (randomly and invisibly assigned).'
          : 'No conditions varied - everyone is in a single baseline group.';
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
      el('p', { class: 'aa-note', text: 'This is a 2x2 design by varying "cost transparency" and "firm-pay" i.e. whether company pays or the user bears the cost of the model output. Turn on each condition you want to vary; with both on there are 2 x 2 = 4 groups, and each participant simply belongs to one of them - randomly and invisibly assigned (they are never shown their group, or told that groups exist). One condition on = 2 groups; none = a single baseline group.' }),
      el('div', { class: 'aa-switches' }, [
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Cost transparency' }), trans.node]),
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Firm-pay' }), inc.node])
      ]),
      summary
    ]);
  }

  function buildFlowCard() {
    var s = cfg.settings || {};
    var randomize = checkbox(s.randomizeOrder !== false);
    var perUser = el('input', { type: 'number', min: '0', step: '1', value: String(s.comparisonsPerUser != null ? s.comparisonsPerUser : 0), style: 'max-width:140px;' });
    // Answer Arena keeps a single live configuration that every session reads, so
    // "Save" and "Make this the default" both persist it (Save = the everyday
    // action; "Make this the default" = the explicit commit); a session created
    // afterwards uses these values. "Restore built-in default" reverts to the
    // values shipped in arena-data.js. (A session code is always required to
    // play, so there is no toggle for it.)
    function persist(msg) {
      var n = parseInt(perUser.value, 10);
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: randomize.checked,
        comparisonsPerUser: (isNaN(n) || n < 0) ? 0 : n,
        requireSessionCode: true
      });
      perUser.value = String(settings.comparisonsPerUser);
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function save() { persist('Comparison flow saved.'); }
    function makeDefault() { persist('Comparison flow saved as the default.'); }
    function restoreDefaults() {
      var Ds = D.settings || {};
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: Ds.randomizeOrder !== false,
        comparisonsPerUser: Ds.comparisonsPerUser || 0,
        requireSessionCode: true
      });
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; randomize.checked = settings.randomizeOrder; perUser.value = String(settings.comparisonsPerUser); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); });
    }
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Comparison flow' }),
      el('p', { class: 'aa-note', text: 'Each participant is shown a number of task pairs in a random sequence. Set how many, and whether the order is randomized. A session code is always required to take part.' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [randomize, document.createTextNode('Show comparisons in random order per participant')])]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Comparisons per participant (0 = use the whole active set)' }), perUser]),
      el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: save } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: makeDefault } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: restoreDefaults } }, ['Restore built-in default'])
      ])
    ]);
  }

  /* ===================== EXPORT ===================== */
  // Downloads everything collected for every user: their profile + registration,
  // every response (with the decision time), every logged decision/change event
  // (with its timestamp), and one survey per session taken.
  // opts.sessionId (optional) restricts the export to one session: only the
  // users who played it, and only their data for that session.
  function exportExcel(parts, opts) {
    opts = opts || {};
    var only = opts.sessionId || null;
    var keep = function (sid) { return !only || (sid || '') === only; };
    toast('Building export...');
    ensureXLSX().then(function (X) {
     return Store.loadActiveTasks().catch(function () { return null; }).then(function (taskSet) {
      // Join responses to the active task set so each row can carry the task's
      // complexity/domain (the columns the study analyses).
      var taskMeta = {};
      (taskSet && taskSet.tasks || []).forEach(function (t) { if (t && t.id != null) taskMeta[String(t.id)] = t; });
      var pRows = [], rRows = [], eRows = [], sRows = [];
      var chain = Promise.resolve();
      parts.forEach(function (p) {
        var uid = p._id, c = p.condition || {};
        var completed = Object.keys(p.completedSessions || {});
        var base = {
          participant_id: p.participantId || '', email: p.email || '', account_id: uid,
          status: p.status || '', current_session_id: p.sessionId || '',
          played_session_ids: Object.keys(p.playedSessions || {}).join(', '),
          completed_session_ids: completed.join(', '),
          completed_this_session_at: only ? ((p.completedSessions && p.completedSessions[only]) ? fmtTs(p.completedSessions[only]) : 'no') : undefined,
          group_cost_transparency: c.transparency || '', group_firm_pay: c.incentive || '',
          registered_at: fmtTs(p.createdAt)
        };
        if (!only) delete base.completed_this_session_at;
        pRows.push(Object.assign({}, base, flatten('reg_', p.registration || {})));
        chain = chain.then(function () {
          return Store.listResponses(uid).then(function (rs) {
            rs.forEach(function (v) { if (keep(v.sessionId)) rRows.push(respRow(base, v, 'yes', v.responseMs, v.ts, taskMeta)); });
            // Include the in-progress answer the participant had entered but not
            // yet submitted (saved if they closed the tab mid-comparison).
            var dr = p.draftResponse;
            if (dr && keep(dr.sessionId)) rRows.push(respRow(base, dr, 'no (draft)', '', dr.updatedAt, taskMeta));
          }).catch(function () {});
        }).then(function () {
          return Store.listEvents(uid).then(function (evs) {
            evs.sort(function (a, b) { return tsMs(a.ts) - tsMs(b.ts); });
            evs.forEach(function (v) {
              if (!keep(v.sessionId)) return;
              var et = v.type === 'choice' ? 'preference' : v.type === 'satisfA' ? 'satisfaction_answer_A' : v.type === 'satisfB' ? 'satisfaction_answer_B' : (v.type || '');
              eRows.push({ participant_id: base.participant_id, email: base.email, session_id: v.sessionId || '', shown_order: v.idx != null ? v.idx + 1 : '', task_id: v.taskId || '', event_type: et, event_value: v.value != null ? v.value : '', model: modelName(v.model), event_at: fmtTs(v.ts), event_ts: v.ts || '' });
            });
          }).catch(function () {});
        }).then(function () {
          return Store.listSurveys(uid).then(function (svs) {
            (svs || []).forEach(function (sv) { if (sv && keep(sv.sessionId || sv.id)) sRows.push(Object.assign({ participant_id: base.participant_id, email: base.email, session_id: sv.sessionId || sv.id || '', completed_at: fmtTs(sv.completedAt) }, flatten('', sv.answers || {}))); });
          }).catch(function () {});
        });
      });
      return chain.then(function () {
        var wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(buildConventions(only)), 'Conventions');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(pRows.length ? pRows : [{}]), 'Participants');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rRows.length ? rRows : [{}]), 'Responses');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(eRows.length ? eRows : [{}]), 'Events');
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sRows.length ? sRows : [{}]), 'Survey');
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        var fname = only ? ('answerarena-session-' + (opts.sessionCode || only) + '-' + stamp + '.xlsx') : ('answerarena-data-' + stamp + '.xlsx');
        X.writeFile(wb, fname);
        toast('Export ready.');
      });
     });
    }).catch(function (e) { toast('Export failed: ' + ((e && e.message) || 'error')); });
  }
  // o1/o2 are the underlying models: o1 = outputA = baseline, o2 = outputB = frontier.
  function modelName(id) { return id === 'o1' ? 'baseline' : (id === 'o2' ? 'frontier' : (id || '')); }
  // One Responses row (shared by submitted answers and the saved draft).
  function respRow(base, v, submitted, responseMs, ts, taskMeta) {
    var meta = (taskMeta && taskMeta[v.taskId]) || {};
    return {
      participant_id: base.participant_id, email: base.email, session_id: v.sessionId || '',
      shown_order: v.idx != null ? v.idx + 1 : '', task_id: v.taskId,
      task_complexity: meta.complexity || '', task_domain: meta.domain || '', submitted: submitted,
      choice: v.choice || '', chosen_model: modelName(v.chosenOutput),
      left_model: modelName(v.leftOutput), right_model: modelName(v.rightOutput),
      satisfaction_answer_A: v.satisfA != null ? v.satisfA : '', satisfaction_answer_B: v.satisfB != null ? v.satisfB : '',
      satisfaction_baseline: v.satisfO1 != null ? v.satisfO1 : '', satisfaction_frontier: v.satisfO2 != null ? v.satisfO2 : '',
      cost_baseline_usd: v.costBaseline != null ? v.costBaseline : '', cost_frontier_usd: v.costFrontier != null ? v.costFrontier : '',
      chosen_cost_usd: v.answerCost != null ? v.answerCost : '', running_cost_usd: v.runningCost != null ? v.runningCost : '',
      reason: v.reason || '', response_ms: responseMs, decided_at: fmtTs(ts), decided_ts: ts || '',
      group_cost_transparency: base.group_cost_transparency, group_firm_pay: base.group_firm_pay
    };
  }
  // The "Conventions" sheet: documents every column used in the export.
  function buildConventions(only) {
    var rows = [];
    function add(sheet, col, desc) { rows.push({ sheet: sheet, column: col, description: desc }); }
    add('Participants', 'participant_id', "The participant's own ID (e.g. a Prolific ID) if they entered one; blank otherwise.");
    add('Participants', 'email', "The participant's e-mail address (used to log in).");
    add('Participants', 'account_id', 'Internal unique account ID (Firebase UID) for this participant.');
    add('Participants', 'status', 'Where the participant is in the flow: registered, playing, survey, or done.');
    add('Participants', 'current_session_id', 'Internal ID of the session the participant is currently in.');
    add('Participants', 'played_session_ids', 'Internal IDs of every session the participant has started (comma-separated).');
    add('Participants', 'completed_session_ids', 'Internal IDs of every session the participant has finished (comma-separated).');
    if (only) add('Participants', 'completed_this_session_at', 'When the participant finished THIS session, or "no" if not finished.');
    add('Participants', 'group_cost_transparency', 'Assigned level of the cost-transparency condition (abstract or translated); blank if this condition was not varied.');
    add('Participants', 'group_firm_pay', 'Assigned level of the firm-pay condition (firm = company pays, personal = the user bears the cost); blank if not varied.');
    add('Participants', 'registered_at', 'When the participant registered.');
    var regQs = (cfg.registrationQuestions && cfg.registrationQuestions.length) ? cfg.registrationQuestions : (D.registrationQuestions || []);
    regQs.forEach(function (q) { if (!q.system) add('Participants', 'reg_' + q.id, 'Registration answer: ' + (q.label || q.id)); });
    add('Responses', 'participant_id', "The participant's ID (see Participants).");
    add('Responses', 'email', "The participant's e-mail.");
    add('Responses', 'session_id', 'Internal ID of the session this comparison belongs to.');
    add('Responses', 'shown_order', "Position of this comparison in the participant's randomised sequence (1 = first shown).");
    add('Responses', 'task_id', 'ID of the task pair shown (e.g. T18); the Task ID column of the uploaded set.');
    add('Responses', 'task_complexity', 'Complexity of the task (from the uploaded set, e.g. Simple/Complex); blank if the set has no Complexity column.');
    add('Responses', 'task_domain', 'Domain/category of the task (from the uploaded set, e.g. Writing); blank if the set has no Domain column.');
    add('Responses', 'submitted', '"yes" for a submitted answer; "no (draft)" for an in-progress answer saved if the participant left before pressing Next.');
    add('Responses', 'choice', 'Which side the participant preferred: left, right, or tie (equally good).');
    add('Responses', 'chosen_model', 'Which underlying model the participant preferred: baseline, frontier, or tie.');
    add('Responses', 'left_model', "Which underlying model was shown on the LEFT (as 'Answer A') for this participant - left/right is randomised per pair.");
    add('Responses', 'right_model', "Which underlying model was shown on the RIGHT (as 'Answer B').");
    add('Responses', 'satisfaction_answer_A', "Participant's 1-5 satisfaction rating for the answer shown on the left (Answer A).");
    add('Responses', 'satisfaction_answer_B', "Participant's 1-5 satisfaction rating for the answer shown on the right (Answer B).");
    add('Responses', 'satisfaction_baseline', 'The 1-5 satisfaction rating that applied to the baseline model (mapped from left/right).');
    add('Responses', 'satisfaction_frontier', 'The 1-5 satisfaction rating that applied to the frontier model.');
    add('Responses', 'cost_baseline_usd', 'US$ cost of the baseline model\'s answer for this task (from the uploaded file); blank if no cost was provided.');
    add('Responses', 'cost_frontier_usd', 'US$ cost of the frontier model\'s answer for this task; blank if no cost was provided.');
    add('Responses', 'chosen_cost_usd', 'US$ cost charged for this comparison: the chosen answer\'s cost, or the average of the two for a tie.');
    add('Responses', 'running_cost_usd', "Cumulative US$ cost of the participant's choices up to and including this comparison (shown live to the 'translated' cost-transparency group).");
    add('Responses', 'reason', 'Free-text reason the participant gave for the choice.');
    add('Responses', 'response_ms', 'Time in milliseconds from seeing the pair to pressing Next.');
    add('Responses', 'decided_at', 'Local date/time when the comparison was decided.');
    add('Responses', 'decided_ts', 'Decision time as epoch milliseconds (useful for sorting).');
    add('Responses', 'group_cost_transparency', "The participant's cost-transparency level (see Participants).");
    add('Responses', 'group_firm_pay', "The participant's firm-pay level (see Participants).");
    add('Events', 'participant_id', "The participant's ID.");
    add('Events', 'email', "The participant's e-mail.");
    add('Events', 'session_id', 'Internal ID of the session.');
    add('Events', 'shown_order', 'Position of the comparison this event refers to (1 = first shown).');
    add('Events', 'task_id', 'ID of the task pair.');
    add('Events', 'event_type', 'What the participant did: preference (chose a side or tie), satisfaction_answer_A, or satisfaction_answer_B.');
    add('Events', 'event_value', 'The new value set: left/right/tie for a preference, or 1-5 for a satisfaction rating.');
    add('Events', 'model', 'Which underlying model the event refers to: baseline, frontier, or tie.');
    add('Events', 'event_at', 'Local date/time of the event.');
    add('Events', 'event_ts', 'Event time as epoch milliseconds. Every change is logged, so re-selections appear as multiple rows; the last per comparison is the final value.');
    add('Survey', 'participant_id', "The participant's ID.");
    add('Survey', 'email', "The participant's e-mail.");
    add('Survey', 'session_id', 'Internal ID of the session the survey was taken for.');
    add('Survey', 'completed_at', 'When the participant submitted the survey for this session.');
    var surQs = (cfg.surveyQuestions && cfg.surveyQuestions.length) ? cfg.surveyQuestions : (D.surveyQuestions || []);
    surQs.forEach(function (q) { add('Survey', q.id, 'Survey answer: ' + (q.label || q.id)); });
    return rows;
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
