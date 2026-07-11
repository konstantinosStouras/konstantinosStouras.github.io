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
    instructionsB: "You also have an AI assistant.\n\nAsk it about any position for its best estimate (usually close, not guaranteed; it always answers even where it is unsure)…\n\nBuilt-in default: the cost per question and any frontier model come from the AI-model settings above.",
    phaseIntroB: "Next part: you now have an AI assistant that gives its best estimate for any position (usually close, not guaranteed)… (built-in default). Its cost and any frontier option come from the AI-model settings. Everything else about the game is the same.",
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
  var BUILTIN_SETTINGS = {
    phases: ['A', 'B'], counterbalance: false,
    nTasks: 1, paidTasks: 2, nPractice: 0,
    coveragePatches: [[30, 70]],
    ai: { baselineCost: 2, baselineData: 'few', frontier: false, frontierCost: 4, frontierData: 'lots' },
    completionCode: '', completionCodeA: '', completionCodeB: '', endpointUrl: '', content: {}
  };

  // Firestore rejects directly-nested arrays (`invalid-argument`), so the
  // in-memory coveragePatches [[a,b],…] is stored as [{a,b},…]. Encode right
  // before every Firestore write; decode accepts both shapes (and the legacy
  // nested-array form, in case a doc was ever written another way).
  function encodePatches(patches) {
    return (patches || []).map(function (p) { return { a: p[0], b: p[1] }; });
  }
  function decodePatches(v) {
    if (!v || !v.length) return null;
    var out = [];
    for (var i = 0; i < v.length && out.length < 2; i++) {
      var p = v[i];
      if (p && p.length >= 2) out.push([+p[0], +p[1]]);
      else if (p && p.a != null && p.b != null) out.push([+p.a, +p.b]);
    }
    return out.length ? out : null;
  }
  function settingsForStore(s) {
    return Object.assign({}, s, { coveragePatches: encodePatches(s.coveragePatches) });
  }

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
    $('btn-remove-all-parts').addEventListener('click', removeAllParticipants);
    $('btn-remove-all-sessions').addEventListener('click', removeAllSessions);
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
  var segPractice, segBaseData, segFrontData, regionsCtl;
  function clampPos(v, dflt) { v = Math.round(+v); if (!isFinite(v)) v = dflt; return Math.max(1, Math.min(100, v)); }
  function syncFrontier() { $('frontier-fields').classList.toggle('off', !$('f-ai-frontier').checked); }
  function wireForm() {
    phasesCtl = phasesSetup();
    segPractice = segSetup('seg-practice');
    segBaseData = segSetup('seg-base-data');
    segFrontData = segSetup('seg-front-data');
    regionsCtl = regionsSetup();
    $('f-ai-frontier').addEventListener('change', function () { syncFrontier(); renderSummary(); });
    $('btn-gencode').addEventListener('click', function () { $('f-code').value = genCode(); renderSummary(); });
    // Live-normalise the session code to capital letters + digits as you type
    // (matches the participant-link format and the ideasearchlab admin).
    $('f-code').addEventListener('input', function () {
      var s = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (s !== this.value) this.value = s;
    });
    $('btn-save').addEventListener('click', saveSession);
    $('btn-cancel').addEventListener('click', function () { fillForm(null, currentDefaults()); renderSummary(); });
    $('btn-makedefault').addEventListener('click', makeDefault);
    $('btn-restore').addEventListener('click', function () { fillSettings(BUILTIN_SETTINGS); renderSummary(); flash($('form-flash')); });
    ['f-name', 'f-code', 'f-code-shared', 'f-codeA', 'f-codeB', 'f-ntasks', 'f-paid', 'f-ai-base-cost', 'f-ai-front-cost'].forEach(function (id) {
      $(id).addEventListener('input', renderSummary);
    });
  }
  // One or two AI interpolation regions (start/end on the 1–100 line). Mirrors
  // the phases control: get() → [[a,b],...]; set(patches) fills the UI.
  function regionsSetup() {
    var seg = $('seg-regions'), btns = seg.querySelectorAll('button'), r2row = $('region2-row');
    function count() { var on = seg.querySelector('.on'); return on ? parseInt(on.getAttribute('data-v'), 10) : 1; }
    function getPatches() {
      var a1 = clampPos($('f-r1a').value, 30), b1 = clampPos($('f-r1b').value, 70);
      var r1 = [Math.min(a1, b1), Math.max(a1, b1)];
      if (count() === 1) return [r1];
      var a2 = clampPos($('f-r2a').value, 60), b2 = clampPos($('f-r2b').value, 85);
      var r2 = [Math.min(a2, b2), Math.max(a2, b2)];
      return [r1, r2].sort(function (x, y) { return x[0] - y[0]; });
    }
    function validate() {
      var w = $('regions-warn'); if (!w) return true;
      var p = getPatches(), ok = true, msg = '';
      for (var i = 0; i < p.length; i++) if (p[i][1] - p[i][0] < 4) { ok = false; msg = 'Each region must be at least 4 positions wide.'; }
      if (ok && p.length === 2 && p[1][0] <= p[0][1]) { ok = false; msg = 'The two regions must not overlap — region 1 must end before region 2 begins.'; }
      w.textContent = msg; w.classList.toggle('show', !ok);
      return ok;
    }
    function setCount(n, applyDefaults) {
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', parseInt(btns[i].getAttribute('data-v'), 10) === n);
      r2row.style.display = (n === 2) ? '' : 'none';
      if (applyDefaults) {
        if (n === 2) { $('f-r1a').value = 15; $('f-r1b').value = 40; $('f-r2a').value = 60; $('f-r2b').value = 85; }
        else { $('f-r1a').value = 30; $('f-r1b').value = 70; }
      }
      validate();
    }
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () { setCount(parseInt(this.getAttribute('data-v'), 10), true); renderSummary(); });
    ['f-r1a', 'f-r1b', 'f-r2a', 'f-r2b'].forEach(function (id) { $(id).addEventListener('input', function () { validate(); renderSummary(); }); });
    return {
      valid: validate, get: getPatches,
      set: function (patches) {
        patches = decodePatches(patches) || [[30, 70]];
        if (patches.length >= 2) {
          setCount(2, false);
          $('f-r1a').value = patches[0][0]; $('f-r1b').value = patches[0][1];
          $('f-r2a').value = patches[1][0]; $('f-r2b').value = patches[1][1];
        } else {
          setCount(1, false);
          $('f-r1a').value = patches[0][0]; $('f-r1b').value = patches[0][1];
          if (!$('f-r2a').value) { $('f-r2a').value = 60; $('f-r2b').value = 85; }
        }
        validate();
      }
    };
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
    $('f-ntasks').value = (s.nTasks != null ? s.nTasks : 1);
    $('f-paid').value = (s.paidTasks != null ? s.paidTasks : 2);
    regionsCtl.set(s.coveragePatches);
    var ai = s.ai || BUILTIN_SETTINGS.ai;
    $('f-ai-base-cost').value = (ai.baselineCost != null ? ai.baselineCost : 2);
    segBaseData.set(ai.baselineData || 'few');
    $('f-ai-frontier').checked = !!ai.frontier;
    $('f-ai-front-cost').value = (ai.frontierCost != null ? ai.frontierCost : 4);
    segFrontData.set(ai.frontierData || 'lots');
    syncFrontier();
    $('f-code-shared').value = s.completionCode || '';
    $('f-codeA').value = s.completionCodeA || '';
    $('f-codeB').value = s.completionCodeB || '';
    var content = s.content || {};
    CONTENT_KEYS.forEach(function (c) { $('ce-' + c.k).value = content[c.k] || ''; });
  }
  function collectSettings() {
    var content = {};
    CONTENT_KEYS.forEach(function (c) { var v = $('ce-' + c.k).value.trim(); if (v) content[c.k] = v; });
    var nTasks = Math.max(1, Math.min(120, parseInt($('f-ntasks').value, 10) || 1));
    var ph = phasesCtl.get();
    var nPhases = ph.phases.length || 1;
    // Paid rounds are drawn across ALL phases at the end, so the cap is per-phase
    // rounds × number of phases.
    var paid = Math.max(0, Math.min(nTasks * nPhases, parseInt($('f-paid').value, 10) || 0));
    var baseCost = Math.max(0, Math.min(4, parseInt($('f-ai-base-cost').value, 10) || 0));
    var fc = parseInt($('f-ai-front-cost').value, 10);
    if (!isFinite(fc)) fc = baseCost + 2;
    var frontCost = Math.max(baseCost, Math.min(50, fc));
    return {
      phases: ph.phases, counterbalance: ph.counterbalance,
      nTasks: nTasks, paidTasks: paid, nPractice: segPractice.get() === '0' ? 0 : 1,
      coveragePatches: regionsCtl.get(),
      ai: {
        baselineCost: baseCost, baselineData: segBaseData.get(),
        frontier: $('f-ai-frontier').checked, frontierCost: frontCost, frontierData: segFrontData.get()
      },
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
    if (!regionsCtl.valid()) { err.textContent = 'Fix the AI interpolation region(s) — see the warning under that field.'; err.style.display = 'block'; return; }
    $('btn-save').disabled = true;
    // uniqueness only for a NEW code (or a changed code)
    var editing = editingId ? SESSIONS.filter(function (s) { return s.id === editingId; })[0] : null;
    var checkUnique = (editing && editing.code === code) ? Promise.resolve(false) : FB.codeExists(code);
    checkUnique.then(function (exists) {
      if (exists) { err.textContent = 'That code is already used by another session.'; err.style.display = 'block'; $('btn-save').disabled = false; return; }
      var stored = settingsForStore(settings);
      var op;
      if (editingId) op = FB.updateSession(editingId, { name: name, code: code, settings: stored });
      else op = FB.createSession({ name: name, code: code, status: 'active', createdAt: new Date().toISOString(), settings: stored });
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
    }).catch(function (e3) {
      // The code-uniqueness pre-check failed — surface it and re-enable Save
      // (previously the button stayed disabled with no message).
      err.textContent = 'Save failed (could not check the code): ' + (e3 && e3.code ? e3.code : e3);
      err.style.display = 'block'; $('btn-save').disabled = false;
    });
  }
  function makeDefault() {
    if (!configured) return;
    var s = collectSettings();
    FB.saveDefaults(settingsForStore(s))
      .then(function () { _defaults = s; flash($('form-flash')); })
      .catch(function (err) {
        banner($('dash-banner'), 'warn', 'Could not save the defaults: ' + esc(err && err.code ? err.code : String(err)));
      });
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
  function costW(c) { return (+c > 0) ? c + '¢' : 'free'; }
  function regionsDesc(patches) { return (patches || []).map(function (p) { return p[0] + '–' + p[1]; }).join('  &  ') || '—'; }
  function aiDesc(ai) {
    ai = ai || {};
    var s = 'Baseline ' + costW(ai.baselineCost) + '/q · ' + (ai.baselineData || 'few') + ' data';
    if (ai.frontier) s += '  ·  Frontier ' + costW(ai.frontierCost) + '/q · ' + (ai.frontierData || 'lots') + ' data';
    return s;
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
      ['AI regions', esc(regionsDesc(s.coveragePatches))],
      ['AI model', esc(aiDesc(s.ai))],
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
    var rmS = $('btn-remove-all-sessions'); if (rmS) rmS.style.display = (configured && SESSIONS.length) ? '' : 'none';
    $('active-count').textContent = active.length + ' active';
    $('completed-count').textContent = done.length + ' total';
    $('active-list').innerHTML = active.length ? active.map(sessCard).join('') : '<p class="muted small">No active sessions yet. Create one on the left.</p>';
    $('completed-list').innerHTML = done.length ? done.map(sessCard).join('') : '<p class="muted small">None yet.</p>';
    wireSessCards();
    renderParticipants();
  }

  // Right-column "Participants" panel: everyone who has any logged data, across
  // all sessions. Participants are anonymous (no accounts) — each is one entry
  // (its throwaway session id) with its wave code, Prolific id, phases and state.
  // Aggregate one row per participant (an anonymous play session id) from the raw
  // events, with enough detail for the expandable card + Remove action.
  function participantAgg() {
    var by = {};
    (EVENTS || []).forEach(function (e) {
      var s = e.session || '(none)';
      var r = by[s] || (by[s] = { session: s, code: e.sessionCode, pid: e.pid, study: e.study, armSeq: [], armSet: {}, n: 0, first: e.t, last: e.t, completed: false, bonusCents: null, rounds: {} });
      r.n++; r.pid = r.pid || e.pid; r.code = r.code || e.sessionCode; r.study = r.study || e.study;
      if ((e.arm === 'A' || e.arm === 'B') && !r.armSet[e.arm]) { r.armSet[e.arm] = true; r.armSeq.push(e.arm); }
      if (e.t != null && (r.first == null || e.t < r.first)) r.first = e.t;
      if ((e.t || 0) > (r.last || 0)) r.last = e.t;
      if (e.event === 'session_end') r.completed = true;
      if (e.event === 'paid_rounds_drawn' && e.value != null) r.bonusCents = e.value;
      if (e.event === 'round_end') {
        var k = (e.phase == null ? 1 : e.phase) + ':' + (e.round == null ? 0 : e.round);
        r.rounds[k] = { phase: e.phase, arm: e.arm, round: e.round, net: (e.rawNet != null ? e.rawNet : e.net) };
      }
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
  }
  function phaseName(arm) { return PHASE_LABEL[arm] || arm || '—'; }

  function renderParticipants() {
    var list = $('participants-list'); if (!list) return;
    var ps = participantAgg();
    $('participants-count').textContent = ps.length + ' total';
    var rmAll = $('btn-remove-all-parts'); if (rmAll) rmAll.style.display = ps.length ? '' : 'none';
    if (!ps.length) { list.innerHTML = '<p class="muted small">No participants yet.</p>'; return; }
    list.innerHTML = ps.map(participantCard).join('');
    wireParticipantCards();
  }

  function participantCard(p) {
    var title = p.pid ? esc(p.pid) : esc(shortId(p.session));
    var sub = p.pid ? esc(shortId(p.session)) : (p.code ? 'session ' + esc(p.code) : '');
    var rounds = Object.keys(p.rounds).map(function (k) { return p.rounds[k]; })
      .sort(function (a, b) { return ((a.phase || 0) - (b.phase || 0)) || ((a.round || 0) - (b.round || 0)); });
    var roundRows = rounds.length ? rounds.map(function (r) {
      return '<div class="pu-round"><span class="pu-arm">' + esc(phaseName(r.arm)) + (r.round != null ? ' · Round ' + r.round : '') + '</span>' +
        '<span class="pill completed">done</span>' +
        '<span class="pu-net">' + (r.net == null ? '&mdash;' : r.net + '&cent; net') + '</span></div>';
    }).join('') : '<div class="muted small" style="padding:2px 0;">No completed rounds yet.</div>';
    var facts2 = [];
    if (p.pid) facts2.push('Prolific ' + esc(p.pid));
    facts2.push('session ' + esc(p.code || '—'));
    facts2.push('played ' + (p.armSeq.map(phaseName).join(' → ') || '—'));
    facts2.push(p.n + ' event' + (p.n === 1 ? '' : 's'));
    if (p.bonusCents != null) facts2.push('bonus $' + (p.bonusCents / 100).toFixed(2));
    return '<div class="part-card" data-id="' + esc(p.session) + '">' +
      '<button type="button" class="pu-head" data-act="toggle">' +
        '<span class="pu-idwrap"><span class="pu-id">' + title + '</span>' + (sub ? '<span class="pu-sub">' + sub + '</span>' : '') + '</span>' +
        '<span class="pu-right"><span class="pill ' + (p.completed ? 'completed' : 'active') + '">' + (p.completed ? 'done' : 'in progress') + '</span><span class="pu-chev">▾</span></span>' +
      '</button>' +
      '<div class="pu-body">' +
        '<div class="pu-facts">Registered ' + esc(fmtTime(p.first)) + ' <span class="sep">·</span> Last active ' + esc(fmtTime(p.last)) + '</div>' +
        '<div class="pu-facts">' + facts2.join(' <span class="sep">·</span> ') + '</div>' +
        '<div class="pu-rounds">' + roundRows + '</div>' +
        '<div class="pu-sep"></div>' +
        '<div class="pu-actions">' +
          '<div class="pu-actions-left">' +
            (configured ? '<button class="link-btn" data-act="message">Message</button>' : '') +
            '<button class="link-btn" data-act="viewdata">View data</button>' +
          '</div>' +
          '<button class="pu-remove" data-act="remove">Remove user</button>' +
        '</div>' +
        (configured ?
          '<div class="pu-compose">' +
            '<textarea class="pu-msg" rows="2" placeholder="Write an encouraging message… the participant sees it live while they play."></textarea>' +
            '<div class="pu-msg-row"><button class="btn btn-blue btn-sm" data-act="send">Send message</button>' +
            '<button class="link-btn" data-act="cancelmsg">Cancel</button>' +
            '<span class="flash" data-role="msgflash">Sent ✓</span></div>' +
          '</div>' : '') +
      '</div>' +
    '</div>';
  }
  function wireParticipantCards() {
    var cards = $('participants-list').querySelectorAll('.part-card');
    for (var i = 0; i < cards.length; i++) (function (card) {
      var id = card.getAttribute('data-id');
      card.querySelector('[data-act="toggle"]').addEventListener('click', function () { card.classList.toggle('open'); });
      var vd = card.querySelector('[data-act="viewdata"]');
      if (vd) vd.addEventListener('click', function () { openParticipantData(id); });
      var rm = card.querySelector('[data-act="remove"]');
      if (rm) rm.addEventListener('click', function () { removeParticipant(id, rm); });
      var msg = card.querySelector('[data-act="message"]');
      if (msg) msg.addEventListener('click', function () {
        card.classList.toggle('composing');
        var ta = card.querySelector('.pu-msg'); if (card.classList.contains('composing') && ta) ta.focus();
      });
      var cancel = card.querySelector('[data-act="cancelmsg"]');
      if (cancel) cancel.addEventListener('click', function () { card.classList.remove('composing'); });
      var send = card.querySelector('[data-act="send"]');
      if (send) send.addEventListener('click', function () { sendParticipantMessage(id, card, send); });
    })(cards[i]);
  }
  // Push a live message to one participant (Firestore messages/{session}).
  function sendParticipantMessage(id, card, btn) {
    var ta = card.querySelector('.pu-msg'), text = ta ? ta.value.trim() : '';
    if (!text) { if (ta) ta.focus(); return; }
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
    FB.sendMessage(id, text).then(function () {
      btn.disabled = false; btn.textContent = old;
      var f = card.querySelector('[data-role="msgflash"]'); if (f) flash(f);
      if (ta) ta.value = '';
      setTimeout(function () { card.classList.remove('composing'); }, 900);
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = old;
      banner($('dash-banner'), 'warn', 'Could not send the message: ' + esc(err && err.code ? err.code : String(err)) +
        '. If this persists, publish the updated lab/search-v2/firestore.rules (it must include the “messages” collection).');
    });
  }
  // "View data": jump to the Data tab filtered to this participant's wave.
  function openParticipantData(id) {
    var ev = (EVENTS || []).filter(function (e) { return (e.session || '(none)') === id; })[0];
    $('data-filter').value = (ev && ev.sessionCode) || '';
    selectTab('data');
  }
  // Remove a participant: permanently delete their collected event rows (Firestore
  // when configured, else this browser's localStorage log in local preview).
  function removeParticipant(id, btn) {
    var n = (EVENTS || []).filter(function (e) { return (e.session || '(none)') === id; }).length;
    if (!confirm('Remove this participant and permanently delete their ' + n + ' collected event' + (n === 1 ? '' : 's') + '? This cannot be undone.')) return;
    btn.disabled = true; btn.textContent = 'Removing…';
    var op = configured ? FB.deleteParticipant(id) : Promise.resolve(deleteLocalParticipant(id));
    op.then(function () { loadData(); })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Remove user';
        banner($('dash-banner'), 'warn', 'Could not remove participant: ' + esc(err && err.code ? err.code : String(err)));
      });
  }
  function deleteLocalParticipant(session) {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('searchv2:log:' + session) === 0) kill.push(k); }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  // Remove ALL participants (every collected event). Double-confirmed (destructive).
  function removeAllParticipants() {
    var n = participantAgg().length;
    if (!n) return;
    if (!confirm('Remove ALL ' + n + ' participant' + (n === 1 ? '' : 's') + ' and permanently delete every collected event? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? This deletes ALL participant data.')) return;
    var op = configured ? FB.deleteAllParticipants() : Promise.resolve(deleteAllLocalParticipants());
    op.then(function () { loadData(); })
      .catch(function (err) { banner($('dash-banner'), 'warn', 'Could not remove all participants: ' + esc(err && err.code ? err.code : String(err))); });
  }
  function deleteAllLocalParticipants() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('searchv2:log:') === 0) kill.push(k); }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  // Remove ALL sessions (waves). Firebase only; collected event data is kept.
  function removeAllSessions() {
    if (!configured) return;
    var n = SESSIONS.length;
    if (!n) return;
    if (!confirm('Delete ALL ' + n + ' session' + (n === 1 ? '' : 's') + ' (waves)? Collected participant/event data is kept. This cannot be undone.')) return;
    FB.deleteAllSessions().then(function () { loadSessions(); })
      .catch(function (err) { banner($('dash-banner'), 'warn', 'Could not delete all sessions: ' + esc(err && err.code ? err.code : String(err))); });
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
      EVENTS = readLocalEvents(); renderData(); renderParticipants();
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
