/* ==========================================================================
   search-v2  ·  admin/admin.js
   Multi-session admin: create/edit named sessions (each with its own code,
   arm/condition settings, completion codes, and per-page text), see Active /
   Completed sessions, view Data and Analytics (Arm A vs B), with dark mode and
   Save / Make-default / Restore-built-in controls. Uses Firebase when configured;
   otherwise runs in a local preview (this browser's data, no session creation).
   ========================================================================== */
(function () {
  'use strict';
  var FB = window.SVFirebase;
  var configured = !!(FB && FB.isConfigured());
  var adminEmails = (FB && FB.adminEmails) || [];
  var DEBUG_KEY = 'stouras'; // must match config.js DEBUG_KEY (for preview links)

  var FIELDS = [
    'session', 'sessionCode', 'sessionName', 'pid', 'study', 'arm', 'phase', 'event', 't', 'rt_ms',
    'round', 'mapping', 'stratum', 'position', 'value', 'estimate', 'refused',
    'reveals', 'cost', 'best', 'net',
    'qid', 'choice', 'correct', 'rawNet', 'flooredNet', 'info',
    'ua', 'vw', 'vh', 'appVersion'
  ];

  // Participant-facing names for the two phases (arms). Keep in sync with app.js.
  var PHASE_LABEL = { A: 'Without AI', B: 'With AI' };

  // Built-in participant copy — MUST mirror app.js BUILTIN (shown as placeholders).
  var BUILTIN = {
    consent: "**What this is.** This is a short decision-making study… (built-in default).\n\n**Payment.** … **Anonymity.** … **Voluntary.** …",
    instructions: "In each round you will see 100 positions on a line. Each position hides a value between 0 and 100 cents.\n\nValues at adjacent positions differ by at most 10 cents…\n\nYou can reveal the value at any position. Each reveal costs 5 cents…\n\nYour earnings for the round are the highest value you revealed, minus 5 cents for each reveal…\n\nThere is 1 practice round and 10 real rounds. Two of the 10 real rounds will be picked at random and paid to you as a bonus.",
    instructionsB: "You also have a free assistant.\n\nThe assistant was trained on data about some positions between 30 and 70…\n\nIf you ask about any position outside 30 to 70, the assistant has no data…\n\nAsking the assistant is free and unlimited.",
    phaseIntroB: "Next part: you now have a free AI assistant that estimates positions between 30 and 70… (built-in default). Everything else about the game is the same.",
    phaseIntroA: "Next part: you search on your own — the AI assistant is no longer available… (built-in default). Everything else about the game is the same.",
    finish: "(Built-in) Thank you for taking part. Below are your real rounds; the ones marked paid were selected at random.",
    closed: "(Built-in) This study is not currently open. Thank you for your interest."
  };
  var CONTENT_KEYS = [
    { k: 'consent', label: 'Consent page', help: 'The consent text on the very first screen (before the game). Participants tick a box to agree.' },
    { k: 'instructions', label: 'Instructions (all phases)', help: 'The task instructions shown to everyone at the start. Tokens {nTasks}, {paidTasks}, {fee}, {rounds} are auto-filled.' },
    { k: 'instructionsB', label: 'Instructions — With-AI addendum', help: 'Extra instructions appended when the first phase is With AI, explaining the assistant.' },
    { k: 'phaseIntroB', label: 'Phase transition — into With AI', help: 'Shown between phases when a within-subjects participant moves INTO the With-AI phase.' },
    { k: 'phaseIntroA', label: 'Phase transition — into Without AI', help: 'Shown between phases when a within-subjects participant moves INTO the Without-AI phase.' },
    { k: 'finish', label: 'Finish page (intro text)', help: 'The message above the results table on the final screen (before the completion code).' },
    { k: 'closed', label: 'Study-closed page', help: 'What people see if they open a session that is marked completed.' }
  ];
  var BUILTIN_SETTINGS = { phases: ['A', 'B'], counterbalance: false, nTasks: 10, paidTasks: 2, nPractice: 1, completionCode: '', completionCodeA: '', completionCodeB: '', endpointUrl: '', content: {} };

  function $(id) { return document.getElementById(id); }
  function show(id) { var s = document.querySelectorAll('.screen'); for (var i = 0; i < s.length; i++) s[i].classList.toggle('active', s[i].id === id); }
  function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function banner(el, cls, html) { el.innerHTML = html ? '<div class="banner ' + cls + '">' + html + '</div>' : ''; }
  function flash(el) { el.classList.add('show'); setTimeout(function () { el.classList.remove('show'); }, 1600); }
  function appBase() { return location.origin + location.pathname.replace(/admin\/?(index\.html)?$/, ''); }

  var editingId = null;   // session id being edited, or null (creating)
  var SESSIONS = [];      // cached session list
  var EVENTS = [];        // cached events
  var phasesCtl;          // PHASES include-toggles + order controller (see phasesSetup)

  // ==================================================================== boot
  window.addEventListener('DOMContentLoaded', function () {
    initTheme();
    $('btn-theme').addEventListener('click', toggleTheme);
    buildContentEditors();
    wireTabs();
    wireForm();
    wireData();
    $('btn-signout').addEventListener('click', function () { if (configured) FB.adminSignOut().then(reload); else reload(); });
    $('btn-analytics-nav').addEventListener('click', function () { selectTab('analytics'); });

    if (!configured) { enterLocalMode(); return; }
    banner($('login-banner'), 'info', 'Sign in with an admin account (' + esc(adminEmails.join(', ')) + ').');
    $('btn-login').addEventListener('click', doLogin);
    $('in-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    FB.onAuth(function (user) {
      if (user && user.email && adminEmails.indexOf(user.email) >= 0) enterAdmin(user);
      else if (user && user.email) { banner($('login-banner'), 'warn', 'Signed in as ' + esc(user.email) + ', which is not an admin account.'); show('a-login'); }
      else show('a-login');
    });
  });

  function reload() { location.href = location.pathname; }
  function doLogin() {
    $('login-err').style.display = 'none';
    FB.adminSignIn($('in-email').value.trim(), $('in-pass').value).catch(function (err) {
      $('login-err').textContent = 'Sign-in failed: ' + (err && err.code ? err.code : err);
      $('login-err').style.display = 'block';
    });
  }
  function enterAdmin(user) {
    $('who').textContent = user.email;
    $('btn-signout').style.display = '';
    $('btn-analytics-nav').style.display = '';
    show('a-dash');
    // Seed the new-session form from the saved defaults. On a real read error we
    // do NOT silently fall back to built-ins (that plus "Make this the default"
    // would overwrite the real saved defaults) — warn and disable that button.
    FB.getDefaults().then(function (d) { _defaults = d || BUILTIN_SETTINGS; fillForm(null, _defaults); renderSummary(); })
      .catch(function (err) {
        banner($('dash-banner'), 'warn', 'Could not load saved defaults (' + esc(err && err.code ? err.code : String(err)) + '); showing built-ins. “Make this the default” is disabled so your saved defaults are not overwritten — reload to retry.');
        fillForm(null, BUILTIN_SETTINGS); renderSummary(); $('btn-makedefault').disabled = true;
      });
    loadSessions();
    loadData();
  }
  function enterLocalMode() {
    $('who').textContent = 'local preview';
    show('a-dash');
    banner($('dash-banner'), 'warn', '<b>Firebase is not configured</b> — local preview (this browser only). Creating sessions needs Firebase (see <code class="k">lab/search-v2/README.md</code> → “Admin panel &amp; Firebase setup”). Data/Analytics below use this browser’s test sessions.');
    fillForm(null, BUILTIN_SETTINGS);
    $('btn-save').disabled = true; $('btn-makedefault').disabled = true;
    $('active-list').innerHTML = '<p class="muted small">Sessions require Firebase.</p>';
    $('completed-list').innerHTML = '';
    renderSummary();
    loadData();
  }

  // ==================================================================== theme
  function initTheme() {
    var t = localStorage.getItem('searchv2:admin:theme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
    $('btn-theme').textContent = t === 'dark' ? '☀' : '☾';
  }
  function toggleTheme() {
    var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('searchv2:admin:theme', t);
    $('btn-theme').textContent = t === 'dark' ? '☀' : '☾';
  }

  // ==================================================================== tabs
  function wireTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener('click', function () { selectTab(this.getAttribute('data-tab')); });
  }
  function selectTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j].getAttribute('data-tab') === name);
    ['sessions', 'data', 'analytics'].forEach(function (t) { $('tab-' + t).style.display = (t === name) ? '' : 'none'; });
    if (name === 'analytics') renderAnalytics();
    if (name === 'data') renderData();
  }

  // ============================================================= content editors
  function buildContentEditors() {
    var html = '';
    CONTENT_KEYS.forEach(function (c) {
      html += '<div class="accordion" data-k="' + c.k + '" title="' + esc(c.help || '') + '">' +
        '<button type="button" class="acc-head">' + esc(c.label) + '<span class="chev">▾</span></button>' +
        '<div class="acc-body"><textarea id="ce-' + c.k + '" placeholder="' + esc(BUILTIN[c.k]) + '"></textarea>' +
        '<div class="hint">Blank = built-in default. **bold**, blank line = new paragraph.</div></div></div>';
    });
    $('content-editors').innerHTML = html;
    var heads = document.querySelectorAll('.acc-head');
    for (var i = 0; i < heads.length; i++) heads[i].addEventListener('click', function () { this.parentNode.classList.toggle('open'); });
  }

  // ============================================================= form (settings)
  var segPractice;
  function wireForm() {
    phasesCtl = phasesSetup();
    segPractice = segSetup('seg-practice');
    $('btn-gencode').addEventListener('click', function () { $('f-code').value = genCode(); renderSummary(); });
    $('btn-save').addEventListener('click', saveSession);
    $('btn-cancel').addEventListener('click', function () { fillForm(null, currentDefaults()); renderSummary(); });
    $('btn-makedefault').addEventListener('click', makeDefault);
    $('btn-restore').addEventListener('click', function () { fillSettings(BUILTIN_SETTINGS); renderSummary(); flash($('form-flash')); });
    ['f-name', 'f-code', 'f-code-shared', 'f-codeA', 'f-codeB', 'f-ntasks', 'f-paid'].forEach(function (id) {
      $(id).addEventListener('input', renderSummary);
    });
  }
  function segSetup(id) {
    var el = $(id), btns = el.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () {
      for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j] === this);
      renderSummary();
    });
    return {
      get: function () { var on = el.querySelector('.on'); return on ? on.getAttribute('data-v') : 'url'; },
      set: function (v) { for (var k = 0; k < btns.length; k++) btns[k].classList.toggle('on', btns[k].getAttribute('data-v') === (v || 'url')); }
    };
  }

  // PHASES control: two include-toggles (Without AI / With AI) + an order dropdown.
  // get() → { phases:[…ordered…], counterbalance:bool }; set(settings) fills the UI
  // from a new-model {phases,counterbalance} or a legacy {armMode} (best-effort).
  function phasesSetup() {
    var chkA = $('ph-A'), chkB = $('ph-B'), sel = $('f-phase-order'), err = $('phase-err');
    var LA = PHASE_LABEL.A, LB = PHASE_LABEL.B;
    function rebuildOrder(preferred) {
      var a = chkA.checked, b = chkB.checked, opts;
      if (a && b) opts = [
        { v: 'AB', t: LA + ' first, then ' + LB },
        { v: 'BA', t: LB + ' first, then ' + LA },
        { v: 'counter', t: 'Counterbalanced (random order per participant)' }
      ];
      else if (a) opts = [{ v: 'A', t: LA + ' only' }];
      else if (b) opts = [{ v: 'B', t: LB + ' only' }];
      else opts = [{ v: '', t: '— include at least one phase —' }];
      var want = preferred != null ? preferred : sel.value;
      sel.innerHTML = opts.map(function (o) { return '<option value="' + o.v + '">' + esc(o.t) + '</option>'; }).join('');
      var vals = opts.map(function (o) { return o.v; });
      sel.value = vals.indexOf(want) >= 0 ? want : opts[0].v;
      sel.disabled = !(a && b);
      $('phase-order-row').classList.toggle('hidden', !(a || b));
      err.style.display = (a || b) ? 'none' : 'block';
    }
    chkA.addEventListener('change', function () { rebuildOrder(); renderSummary(); });
    chkB.addEventListener('change', function () { rebuildOrder(); renderSummary(); });
    sel.addEventListener('change', renderSummary);
    return {
      rebuild: rebuildOrder,
      get: function () {
        var a = chkA.checked, b = chkB.checked, v = sel.value;
        if (a && b) {
          if (v === 'BA') return { phases: ['B', 'A'], counterbalance: false };
          if (v === 'counter') return { phases: ['A', 'B'], counterbalance: true };
          return { phases: ['A', 'B'], counterbalance: false };
        }
        if (a) return { phases: ['A'], counterbalance: false };
        if (b) return { phases: ['B'], counterbalance: false };
        return { phases: [], counterbalance: false };
      },
      set: function (s) {
        var phases, counter = false;
        if (s && Object.prototype.toString.call(s.phases) === '[object Array]' && s.phases.length) {
          phases = s.phases.filter(function (x) { return x === 'A' || x === 'B'; });
          counter = !!s.counterbalance;
        } else {
          // Legacy armMode → best-effort mapping (participants still honour armMode
          // directly; this is only how an old session shows in the edit form).
          var m = s && s.armMode;
          if (m === 'A') phases = ['A'];
          else if (m === 'B') phases = ['B'];
          else if (m === 'random') { phases = ['A', 'B']; counter = true; }
          else phases = ['A', 'B']; // 'url' or absent → built-in default
        }
        if (!phases.length) phases = ['A', 'B'];
        chkA.checked = phases.indexOf('A') >= 0;
        chkB.checked = phases.indexOf('B') >= 0;
        var order = phases.length === 2 ? (counter ? 'counter' : (phases[0] === 'B' ? 'BA' : 'AB')) : phases[0];
        rebuildOrder(order);
      }
    };
  }
  function genCode() { var s = '', a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

  function fillSettings(s) {
    s = s || BUILTIN_SETTINGS;
    phasesCtl.set(s);
    segPractice.set(s.nPractice === 0 ? '0' : '1');
    $('f-ntasks').value = (s.nTasks != null ? s.nTasks : 10);
    $('f-paid').value = (s.paidTasks != null ? s.paidTasks : 2);
    $('f-code-shared').value = s.completionCode || '';
    $('f-codeA').value = s.completionCodeA || '';
    $('f-codeB').value = s.completionCodeB || '';
    var content = s.content || {};
    CONTENT_KEYS.forEach(function (c) { $('ce-' + c.k).value = content[c.k] || ''; });
  }
  function collectSettings() {
    var content = {};
    CONTENT_KEYS.forEach(function (c) { var v = $('ce-' + c.k).value.trim(); if (v) content[c.k] = v; });
    var nTasks = Math.max(1, Math.min(120, parseInt($('f-ntasks').value, 10) || 10));
    var paid = Math.max(0, Math.min(nTasks, parseInt($('f-paid').value, 10) || 0));
    var ph = phasesCtl.get();
    return {
      phases: ph.phases, counterbalance: ph.counterbalance,
      nTasks: nTasks, paidTasks: paid, nPractice: segPractice.get() === '0' ? 0 : 1,
      completionCode: $('f-code-shared').value.trim(),
      completionCodeA: $('f-codeA').value.trim(),
      completionCodeB: $('f-codeB').value.trim(),
      content: content
    };
  }
  function fillForm(sess, settings) {
    editingId = sess ? sess.id : null;
    $('form-title').textContent = sess ? ('Edit session: ' + (sess.name || sess.code)) : 'Create a session';
    $('btn-save').textContent = sess ? 'Save changes' : 'Create session';
    $('btn-cancel').style.display = sess ? '' : 'none';
    $('f-name').value = sess ? (sess.name || '') : '';
    $('f-code').value = sess ? (sess.code || '') : '';
    fillSettings(sess ? (sess.settings || {}) : settings);
    if (sess) renderLaunch(sess); else $('launch-box').style.display = 'none';
  }
  var _defaults = BUILTIN_SETTINGS;
  function currentDefaults() { return _defaults; }

  function saveSession() {
    var err = $('form-err'); err.style.display = 'none';
    var name = $('f-name').value.trim();
    var code = $('f-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { err.textContent = 'A session code is required.'; err.style.display = 'block'; return; }
    if (!/^[A-Z0-9]{3,40}$/.test(code)) { err.textContent = 'Code must be 3–40 letters/digits, no spaces.'; err.style.display = 'block'; return; }
    $('f-code').value = code;
    var settings = collectSettings();
    if (!settings.phases.length) { err.textContent = 'Include at least one phase (Without AI and/or With AI).'; err.style.display = 'block'; return; }
    $('btn-save').disabled = true;
    // uniqueness only for a NEW code (or a changed code)
    var editing = editingId ? SESSIONS.filter(function (s) { return s.id === editingId; })[0] : null;
    var checkUnique = (editing && editing.code === code) ? Promise.resolve(false) : FB.codeExists(code);
    checkUnique.then(function (exists) {
      if (exists) { err.textContent = 'That code is already used by another session.'; err.style.display = 'block'; $('btn-save').disabled = false; return; }
      var op;
      if (editingId) op = FB.updateSession(editingId, { name: name, code: code, settings: settings });
      else op = FB.createSession({ name: name, code: code, status: 'active', createdAt: new Date().toISOString(), settings: settings });
      op.then(function (id) {
        $('btn-save').disabled = false;
        flash($('form-flash'));
        loadSessions().then(function () {
          var sid = editingId || id;
          var sess = SESSIONS.filter(function (s) { return s.id === sid; })[0];
          if (sess) fillForm(sess, null);
          renderSummary();
        });
      }).catch(function (e2) { err.textContent = 'Save failed: ' + (e2 && e2.code ? e2.code : e2); err.style.display = 'block'; $('btn-save').disabled = false; });
    });
  }
  function makeDefault() {
    if (!configured) return;
    FB.saveDefaults(collectSettings()).then(function () { _defaults = collectSettings(); flash($('form-flash')); });
  }

  // ============================================================= launch + summary
  function renderLaunch(sess) {
    var base = appBase(), code = sess.code;
    // One participant link per session: the phases (and their order) come from the
    // session settings, so no ?arm= is needed. (?arm still works as a legacy
    // fallback for sessions saved before the phases model.)
    var link = base + '?code=' + code;
    var prev = base + '?code=' + code + '&preview=1&debug=1&key=' + DEBUG_KEY;
    var box = $('launch-box');
    box.style.display = 'block';
    box.className = 'code-box';
    box.innerHTML =
      '<div class="small muted">Participant launch link for <b>' + esc(sess.name || code) + '</b> (code <b>' + esc(code) + '</b>):</div>' +
      '<div class="launch">' + esc(link) + '</div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">' +
        '<button class="btn btn-ghost btn-sm" data-copy="' + esc(link) + '">Copy participant link</button>' +
        '<a class="btn btn-blue btn-sm" href="' + esc(prev) + '" target="_blank" rel="noopener">▶ Test this session (skips intro)</a>' +
      '</div>';
    var cbtns = box.querySelectorAll('[data-copy]');
    for (var i = 0; i < cbtns.length; i++) cbtns[i].addEventListener('click', function () {
      var t = this.getAttribute('data-copy'); if (navigator.clipboard) navigator.clipboard.writeText(t); this.textContent = 'Copied ✓';
    });
  }
  // A short human description of a phases config, e.g. "Without AI → With AI" or
  // "Counterbalanced: Without AI / With AI" or "With AI only".
  function phasesDescription(settings) {
    var phases = (settings && settings.phases) || [];
    if (!phases.length) return '—';
    var names = phases.map(function (p) { return PHASE_LABEL[p] || p; });
    if (phases.length === 1) return names[0] + ' only';
    if (settings.counterbalance) return 'Counterbalanced: ' + names.join(' / ');
    return names.join(' → ');
  }
  function renderSummary() {
    var s = collectSettings();
    var nPhases = s.phases.length || 1;
    var custom = CONTENT_KEYS.filter(function (c) { return s.content[c.k]; }).map(function (c) { return c.label; });
    var rows = [
      ['Name', esc($('f-name').value || '—')],
      ['Code', esc($('f-code').value || '—')],
      ['Status', editingId ? statusOf(editingId) : 'new (active on create)'],
      ['Phases', esc(phasesDescription(s))],
      ['Rounds', (s.nPractice ? '1 practice + ' : 'no practice, ') + s.nTasks + ' real per phase' +
        (nPhases > 1 ? ' (' + (s.nTasks * nPhases) + ' total)' : '') + ', ' + s.paidTasks + ' paid'],
      ['Completion code', esc($('f-code-shared').value || '—') + (s.completionCodeA || s.completionCodeB ? ' (A/B overrides set)' : '')],
      ['Custom page text', custom.length ? esc(custom.join(', ')) : 'all built-in']
    ];
    $('settings-summary').innerHTML = '<h3>Settings summary</h3>' +
      rows.map(function (r) { return '<div class="sum-row"><div>' + r[0] + '</div><div class="v">' + r[1] + '</div></div>'; }).join('');
  }
  function statusOf(id) { var s = SESSIONS.filter(function (x) { return x.id === id; })[0]; return s ? s.status : '—'; }

  // ============================================================= sessions lists
  function loadSessions() {
    if (!configured) return Promise.resolve();
    return FB.listSessions().then(function (list) {
      SESSIONS = list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
      renderSessions();
      fillSessionFilters();
    }).catch(function (e) {
      var code = e && e.code ? e.code : String(e);
      var extra = /permission/i.test(code)
        ? ' This usually means the Firestore security rules need re-publishing. In the Firebase console → Firestore → Rules, paste the contents of lab/search-v2/firestore.rules (it must include the “sessions” collection) and Publish.'
        : '';
      banner($('dash-banner'), 'warn', 'Could not load sessions: ' + esc(code) + '.' + extra);
      $('active-list').innerHTML = '<p class="muted small">Could not load — see the message above.</p>';
      $('completed-list').innerHTML = '';
    });
  }
  function renderSessions() {
    var active = SESSIONS.filter(function (s) { return s.status !== 'completed'; });
    var done = SESSIONS.filter(function (s) { return s.status === 'completed'; });
    $('active-count').textContent = active.length + ' active';
    $('completed-count').textContent = done.length + ' total';
    $('active-list').innerHTML = active.length ? active.map(sessCard).join('') : '<p class="muted small">No active sessions yet. Create one on the left.</p>';
    $('completed-list').innerHTML = done.length ? done.map(sessCard).join('') : '<p class="muted small">None yet.</p>';
    wireSessCards();
  }
  function sessCard(s) {
    var n = EVENTS.filter(function (e) { return e.sessionCode === s.code && e.event === 'session_start'; }).length;
    return '<div class="sess-card" data-id="' + s.id + '">' +
      '<div class="sc-top"><span class="sc-name">' + esc(s.name || '(unnamed)') + '</span>' +
      '<span class="pill ' + (s.status === 'completed' ? 'completed' : 'active') + '">' + (s.status === 'completed' ? 'done' : 'active') + '</span></div>' +
      '<div class="sc-code">code ' + esc(s.code) + ' · ' + n + ' participant' + (n === 1 ? '' : 's') + '</div>' +
      '<div class="sc-meta">created ' + esc((s.createdAt || '').slice(0, 16).replace('T', ' ')) + '</div>' +
      '<div class="sc-actions">' +
        '<button class="link-btn" data-act="edit" data-id="' + s.id + '">Edit</button>' +
        '<button class="link-btn" data-act="data" data-id="' + s.id + '">View data</button>' +
        (s.status === 'completed'
          ? '<button class="link-btn" data-act="reopen" data-id="' + s.id + '">Reopen</button>'
          : '<button class="link-btn" data-act="complete" data-id="' + s.id + '">Mark completed</button>') +
        '<button class="link-btn danger" data-act="delete" data-id="' + s.id + '">Delete</button>' +
      '</div></div>';
  }
  function wireSessCards() {
    var btns = document.querySelectorAll('.sess-card [data-act]');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () {
      var id = this.getAttribute('data-id'), act = this.getAttribute('data-act');
      var sess = SESSIONS.filter(function (s) { return s.id === id; })[0];
      if (!sess) return;
      if (act === 'edit') { fillForm(sess, null); renderSummary(); selectTab('sessions'); window.scrollTo(0, 0); }
      else if (act === 'data') { $('data-filter').value = sess.code; selectTab('data'); }
      else if (act === 'complete') { FB.updateSession(id, { status: 'completed' }).then(loadSessions); }
      else if (act === 'reopen') { FB.updateSession(id, { status: 'active' }).then(loadSessions); }
      else if (act === 'delete') { if (confirm('Delete session "' + (sess.name || sess.code) + '"? Its collected event rows are kept.')) FB.deleteSession(id).then(loadSessions); }
    });
  }
  function fillSessionFilters() {
    var opts = '<option value="">All sessions</option>' + SESSIONS.map(function (s) { return '<option value="' + esc(s.code) + '">' + esc(s.name || s.code) + ' (' + esc(s.code) + ')</option>'; }).join('');
    if ($('data-filter').innerHTML !== opts) { var cur = $('data-filter').value; $('data-filter').innerHTML = opts; $('data-filter').value = cur; }
    var cur2 = $('an-filter').value; $('an-filter').innerHTML = opts; $('an-filter').value = cur2;
  }

  // ============================================================= data
  function wireData() {
    $('btn-refresh').addEventListener('click', loadData);
    $('data-filter').addEventListener('change', renderData);
    $('an-filter').addEventListener('change', renderAnalytics);
    $('btn-dl-csv').addEventListener('click', function () { downloadFile('searchv2_events.csv', toCSV(filteredEvents($('data-filter').value)), 'text/csv'); });
    $('btn-dl-json').addEventListener('click', function () { downloadFile('searchv2_events.json', JSON.stringify(filteredEvents($('data-filter').value), null, 2), 'application/json'); });
  }
  function loadData() {
    if (configured) {
      $('data-source').textContent = 'Source: Firestore (all participants)';
      FB.fetchEvents(20000).then(function (evs) { EVENTS = evs; renderSessions(); renderData(); }).catch(function (err) {
        banner($('dash-banner'), 'warn', 'Could not read events: ' + esc(err && err.code ? err.code : String(err)));
      });
    } else {
      $('data-source').textContent = 'Source: this browser’s localStorage (local preview)';
      EVENTS = readLocalEvents(); renderData();
    }
  }
  function readLocalEvents() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('searchv2:log:') === 0) { try { var arr = JSON.parse(localStorage.getItem(k)); if (arr && arr.length) out = out.concat(arr); } catch (e) {} }
    }
    return out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
  }
  function filteredEvents(code) { return code ? EVENTS.filter(function (e) { return e.sessionCode === code; }) : EVENTS; }

  function renderData() {
    var evs = filteredEvents($('data-filter').value);
    var by = {};
    evs.forEach(function (e) {
      var s = e.session || '(none)';
      var r = by[s] || (by[s] = { session: s, code: e.sessionCode, pid: e.pid, armSeq: [], armSet: {}, n: 0, first: e.t, last: e.t, completed: false, bonusCents: null });
      r.n++; r.pid = r.pid || e.pid; r.code = r.code || e.sessionCode;
      // A within-subjects participant plays several phases; record the arms in
      // the order they first appear (e.g. A then B).
      if ((e.arm === 'A' || e.arm === 'B') && !r.armSet[e.arm]) { r.armSet[e.arm] = true; r.armSeq.push(e.arm); }
      if (e.t < r.first) r.first = e.t; if (e.t > r.last) r.last = e.t;
      if (e.event === 'session_end') r.completed = true;
      if (e.event === 'paid_rounds_drawn' && e.value != null) r.bonusCents = e.value;
    });
    var sessions = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    var completes = sessions.filter(function (s) { return s.completed; }).length;
    var playedA = sessions.filter(function (s) { return s.armSet.A; }).length;
    var playedB = sessions.filter(function (s) { return s.armSet.B; }).length;
    $('stat-grid').innerHTML = box(sessions.length, 'participants') + box(completes, 'completed') +
      box(playedA, 'played ' + PHASE_LABEL.A) + box(playedB, 'played ' + PHASE_LABEL.B) + box(evs.length, 'events');

    var sh = '<thead><tr><th>Participant</th><th>Session</th><th>PID</th><th>Phases</th><th>Events</th><th>Completed</th><th>Bonus</th><th>Last activity</th></tr></thead><tbody>';
    sessions.forEach(function (x) {
      sh += '<tr><td>' + esc(shortId(x.session)) + '</td><td>' + esc(x.code || '') + '</td><td>' + esc(x.pid) + '</td><td>' + esc(x.armSeq.join('→') || '—') + '</td>' +
        '<td>' + x.n + '</td><td>' + (x.completed ? '✔' : '') + '</td><td>' + (x.bonusCents == null ? '' : '$' + (x.bonusCents / 100).toFixed(2)) + '</td><td>' + esc(fmtTime(x.last)) + '</td></tr>';
    });
    $('sessions-table').innerHTML = sh + '</tbody>';

    var cols = ['t', 'sessionCode', 'session', 'arm', 'phase', 'event', 'round', 'position', 'value', 'estimate', 'refused', 'reveals', 'net'];
    var eh = '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    filteredEvents($('data-filter').value).slice(-800).reverse().forEach(function (e) {
      eh += '<tr>' + cols.map(function (f) { return '<td>' + esc(f === 't' ? fmtTime(e[f]) : (f === 'session' ? shortId(e[f]) : e[f])) + '</td>'; }).join('') + '</tr>';
    });
    $('events-table').innerHTML = eh + '</tbody>';
    $('events-count').textContent = '(recent ' + Math.min(800, evs.length) + ' of ' + evs.length + ')';
  }

  // ============================================================= analytics
  function renderAnalytics() {
    var evs = filteredEvents($('an-filter').value);
    // Aggregate real-round (round>=1) performance per (participant, arm). A
    // within-subjects participant contributes one data point to EACH phase they
    // played; a single-phase participant contributes to just one. Completion is
    // per participant (session_end).
    var completedSessions = {}, byKey = {};
    function agg(session, arm) {
      var k = session + '|' + arm;
      return byKey[k] || (byKey[k] = { session: session, arm: arm, reveals: 0, net: 0, best: 0, rounds: 0, queries: 0 });
    }
    evs.forEach(function (e) {
      if (e.event === 'session_end') completedSessions[e.session] = true;
      if ((e.arm === 'A' || e.arm === 'B') && e.round >= 1) {
        if (e.event === 'round_end') { var a = agg(e.session, e.arm); a.rounds++; a.reveals += (+e.reveals || 0); a.net += (+e.rawNet || 0); a.best += (e.best == null ? 0 : +e.best); }
        else if (e.event === 'ai_query' && e.arm === 'B') agg(e.session, 'B').queries++;
      }
    });
    var A = [], B = [], doneSet = {};
    Object.keys(byKey).forEach(function (k) {
      var a = byKey[k];
      if (completedSessions[a.session] && a.rounds > 0) { (a.arm === 'B' ? B : A).push(a); doneSet[a.session] = true; }
    });
    function mean(arr, f) { return arr.length ? arr.reduce(function (a, s) { return a + f(s); }, 0) / arr.length : 0; }
    var mA = { n: A.length, rev: mean(A, function (s) { return s.reveals / s.rounds; }), net: mean(A, function (s) { return s.net / s.rounds; }), best: mean(A, function (s) { return s.best / s.rounds; }) };
    var mB = { n: B.length, rev: mean(B, function (s) { return s.reveals / s.rounds; }), net: mean(B, function (s) { return s.net / s.rounds; }), best: mean(B, function (s) { return s.best / s.rounds; }), q: mean(B, function (s) { return s.queries / s.rounds; }) };

    $('an-stats').innerHTML = box(Object.keys(doneSet).length, 'completed') + box(A.length, PHASE_LABEL.A + ' blocks') + box(B.length, PHASE_LABEL.B + ' blocks') +
      box(mB.q.toFixed(1), PHASE_LABEL.B + ' queries/round');

    if (!A.length && !B.length) { $('an-body').innerHTML = '<p class="muted">No completed participants yet' + ($('an-filter').value ? ' for this session.' : '.') + '</p>'; return; }
    function cmp(label, va, vb, fmt) {
      var mx = Math.max(va, vb, 0.0001);
      return '<div class="bar-row"><div>' + label + ' — ' + esc(PHASE_LABEL.A) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + (va / mx * 100) + '%"></div></div><div class="right">' + fmt(va) + '</div></div>' +
        '<div class="bar-row"><div>' + label + ' — ' + esc(PHASE_LABEL.B) + '</div><div class="bar-track"><div class="bar-fill b" style="width:' + (vb / mx * 100) + '%"></div></div><div class="right">' + fmt(vb) + '</div></div>';
    }
    var c = function (v) { return v.toFixed(1) + '¢'; }, n1 = function (v) { return v.toFixed(1); };
    $('an-body').innerHTML = '<div class="bars">' +
      cmp('Avg net / round', mA.net, mB.net, c) +
      cmp('Avg reveals / round', mA.rev, mB.rev, n1) +
      cmp('Avg best found / round', mA.best, mB.best, c) +
      '</div><p class="small muted">Net = best value found − 5¢ × reveals, per round. Higher net is better search performance. In a within-subjects session each participant appears in both bars.</p>';
  }

  // ============================================================= helpers
  function box(n, l) { return '<div class="stat-box"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
  function shortId(s) { s = String(s || ''); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }
  function fmtTime(t) { if (!t) return ''; var d = new Date(t); return isNaN(d) ? '' : d.toISOString().replace('T', ' ').slice(0, 19); }
  function toCSV(events) {
    var e2 = function (v) { if (v == null) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [FIELDS.join(',')].concat(events.map(function (ev) { return FIELDS.map(function (f) { return e2(ev[f]); }).join(','); })).join('\n');
  }
  function downloadFile(name, text, mime) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
})();
