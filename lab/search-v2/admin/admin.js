/* ==========================================================================
   search-v2  ·  admin/admin.js
   Admin panel: control study conditions & completion codes, and view/export the
   collected data. Uses Firebase when configured (email/password admin sign-in,
   Firestore reads/writes); otherwise runs in LOCAL PREVIEW mode showing this
   browser's own logged sessions so the UI is still usable before Firebase setup.
   ========================================================================== */
(function () {
  'use strict';
  var FB = window.SVFirebase;
  var configured = !!(FB && FB.isConfigured());
  var adminEmails = (FB && FB.adminEmails) || [];

  // event schema column order (kept in sync with logger.js FIELDS)
  var FIELDS = [
    'session', 'pid', 'study', 'arm', 'event', 't', 'rt_ms',
    'round', 'mapping', 'stratum', 'position', 'value', 'estimate', 'refused',
    'reveals', 'cost', 'best', 'net',
    'qid', 'choice', 'correct', 'rawNet', 'flooredNet', 'info',
    'ua', 'vw', 'vh', 'appVersion'
  ];
  var DEFAULT_CFG = { studyOpen: true, armMode: 'url', completionCode: '', completionCodeA: '', completionCodeB: '', endpointUrl: '' };

  function $(id) { return document.getElementById(id); }
  function show(id) { var s = document.querySelectorAll('.screen'); for (var i = 0; i < s.length; i++) s[i].classList.toggle('active', s[i].id === id); }
  function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function banner(el, cls, html) { el.innerHTML = '<div class="banner ' + cls + '">' + html + '</div>'; }

  // -------------------------------------------------------------- boot
  window.addEventListener('DOMContentLoaded', function () {
    wireTabs();
    wireConditions();
    wireData();
    $('btn-signout').addEventListener('click', function () { if (configured) FB.adminSignOut().then(reload); else reload(); });

    if (!configured) { enterLocalMode(); return; }
    // Firebase configured → require admin sign-in
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
    show('a-dash');
    loadConditions();
    loadData();
  }

  function enterLocalMode() {
    $('who').textContent = 'local preview';
    show('a-dash');
    banner($('dash-banner'), 'warn',
      '<b>Firebase is not configured</b>, so this is a local preview showing only <i>this browser’s</i> test sessions. ' +
      'Saving conditions is disabled until you set up Firebase (see <code class="k">lab/search-v2/README.md</code> → “Admin panel &amp; Firebase setup”).');
    // populate the conditions form from a local draft so it can be previewed
    fillConditions(readLocalCfg());
    $('btn-save').disabled = true;
    loadData();
  }

  // -------------------------------------------------------------- tabs
  function wireTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener('click', function () {
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j] === this);
      var t = this.getAttribute('data-tab');
      $('tab-conditions').style.display = t === 'conditions' ? '' : 'none';
      $('tab-data').style.display = t === 'data' ? '' : 'none';
    });
  }

  // -------------------------------------------------------------- conditions
  var segOpen, segArm;
  function wireConditions() {
    segOpen = segSetup('seg-open');
    segArm = segSetup('seg-arm');
    $('btn-save').addEventListener('click', saveConditions);
  }
  function segSetup(id) {
    var el = $(id), val = el.querySelector('.on') ? el.querySelector('.on').getAttribute('data-v') : null;
    var btns = el.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () {
      for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j] === this);
    });
    return {
      get: function () { var on = el.querySelector('.on'); return on ? on.getAttribute('data-v') : null; },
      set: function (v) { for (var k = 0; k < btns.length; k++) btns[k].classList.toggle('on', btns[k].getAttribute('data-v') === v); }
    };
  }
  function fillConditions(cfg) {
    cfg = cfg || DEFAULT_CFG;
    segOpen.set(cfg.studyOpen === false ? 'closed' : 'open');
    segArm.set(cfg.armMode || 'url');
    $('in-code').value = cfg.completionCode || '';
    $('in-codeA').value = cfg.completionCodeA || '';
    $('in-codeB').value = cfg.completionCodeB || '';
    $('in-endpoint').value = cfg.endpointUrl || '';
  }
  function collectConditions() {
    return {
      studyOpen: segOpen.get() !== 'closed',
      armMode: segArm.get() || 'url',
      completionCode: $('in-code').value.trim(),
      completionCodeA: $('in-codeA').value.trim(),
      completionCodeB: $('in-codeB').value.trim(),
      endpointUrl: $('in-endpoint').value.trim(),
      updatedAt: new Date().toISOString()
    };
  }
  function loadConditions() {
    FB.getStudyConfig().then(function (cfg) { fillConditions(cfg || DEFAULT_CFG); });
  }
  function saveConditions() {
    var msg = $('save-msg'), cfg = collectConditions();
    if (!configured) return;
    msg.style.display = 'block'; msg.className = 'feedback'; msg.textContent = 'Saving…';
    FB.saveStudyConfig(cfg).then(function () {
      msg.className = 'feedback'; msg.style.background = '#eef8e9'; msg.style.border = '1px solid #cfe8c2'; msg.textContent = 'Saved ✓ (live for new participants)';
    }).catch(function (err) {
      msg.className = 'feedback bad'; msg.textContent = 'Save failed: ' + (err && err.code ? err.code : err);
    });
  }
  function readLocalCfg() { try { return JSON.parse(localStorage.getItem('searchv2:admincfg')) || DEFAULT_CFG; } catch (e) { return DEFAULT_CFG; } }

  // -------------------------------------------------------------- data
  var EVENTS = [];
  function wireData() {
    $('btn-refresh').addEventListener('click', loadData);
    $('btn-dl-csv').addEventListener('click', function () { downloadFile('searchv2_events.csv', toCSV(EVENTS), 'text/csv'); });
    $('btn-dl-json').addEventListener('click', function () { downloadFile('searchv2_events.json', JSON.stringify(EVENTS, null, 2), 'application/json'); });
  }
  function loadData() {
    if (configured) {
      $('data-source').textContent = 'Source: Firestore (all participants)';
      FB.fetchEvents(20000).then(function (evs) { EVENTS = evs; renderData(); }).catch(function (err) {
        banner($('dash-banner'), 'warn', 'Could not read events from Firestore: ' + esc(err && err.code ? err.code : String(err)));
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
      if (k && k.indexOf('searchv2:log:') === 0) {
        try { var arr = JSON.parse(localStorage.getItem(k)); if (arr && arr.length) out = out.concat(arr); } catch (e) {}
      }
    }
    out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return out;
  }

  function renderData() {
    // per-session aggregation
    var by = {};
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i], s = e.session || '(none)';
      var r = by[s] || (by[s] = { session: s, pid: e.pid, arm: e.arm, study: e.study, n: 0, first: e.t, last: e.t, completed: false, bonusCents: null });
      r.n++; r.pid = r.pid || e.pid; r.arm = r.arm || e.arm; r.study = r.study || e.study;
      if (e.t < r.first) r.first = e.t; if (e.t > r.last) r.last = e.t;
      if (e.event === 'session_end') r.completed = true;
      if (e.event === 'paid_rounds_drawn' && e.value != null) r.bonusCents = e.value;
    }
    var sessions = Object.keys(by).map(function (k) { return by[k]; });
    sessions.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });

    var completes = sessions.filter(function (s) { return s.completed; }).length;
    var armA = sessions.filter(function (s) { return s.arm === 'A'; }).length;
    var armB = sessions.filter(function (s) { return s.arm === 'B'; }).length;
    $('stat-grid').innerHTML =
      box(sessions.length, 'sessions') + box(completes, 'completed') +
      box(armA, 'Arm A') + box(armB, 'Arm B') + box(EVENTS.length, 'events');

    // sessions table
    var sh = '<thead><tr><th>Session</th><th>PID</th><th>Arm</th><th>Study</th><th>Events</th><th>Completed</th><th>Bonus</th><th>Last activity</th></tr></thead><tbody>';
    for (var j = 0; j < sessions.length; j++) {
      var x = sessions[j];
      sh += '<tr><td>' + esc(shortId(x.session)) + '</td><td>' + esc(x.pid) + '</td><td>' + esc(x.arm) + '</td><td>' + esc(x.study) + '</td>' +
            '<td>' + x.n + '</td><td>' + (x.completed ? '✔' : '') + '</td><td>' + (x.bonusCents == null ? '' : '$' + (x.bonusCents / 100).toFixed(2)) + '</td>' +
            '<td>' + esc(fmtTime(x.last)) + '</td></tr>';
    }
    $('sessions-table').innerHTML = sh + '</tbody>';

    // events table (most recent 800)
    var cols = ['t', 'session', 'arm', 'event', 'round', 'mapping', 'stratum', 'position', 'value', 'estimate', 'refused', 'reveals', 'cost', 'best', 'net', 'qid', 'choice', 'correct'];
    var eh = '<thead><tr>'; for (var c = 0; c < cols.length; c++) eh += '<th>' + cols[c] + '</th>'; eh += '</tr></thead><tbody>';
    var recent = EVENTS.slice(-800).reverse();
    for (var m = 0; m < recent.length; m++) {
      eh += '<tr>';
      for (var cc = 0; cc < cols.length; cc++) {
        var f = cols[cc], v = recent[m][f];
        eh += '<td>' + esc(f === 't' ? fmtTime(v) : (f === 'session' ? shortId(v) : v)) + '</td>';
      }
      eh += '</tr>';
    }
    $('events-table').innerHTML = eh + '</tbody>';
    $('events-count').textContent = '(showing most recent ' + Math.min(800, EVENTS.length) + ' of ' + EVENTS.length + ')';
  }
  function box(n, l) { return '<div class="stat-box"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
  function shortId(s) { s = String(s || ''); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }
  function fmtTime(t) { if (!t) return ''; var d = new Date(t); return isNaN(d) ? '' : d.toISOString().replace('T', ' ').slice(0, 19); }

  function toCSV(events) {
    var e2 = function (v) { if (v == null) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [FIELDS.join(',')];
    for (var i = 0; i < events.length; i++) lines.push(FIELDS.map(function (f) { return e2(events[i][f]); }).join(','));
    return lines.join('\n');
  }
  function downloadFile(name, text, mime) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

})();
