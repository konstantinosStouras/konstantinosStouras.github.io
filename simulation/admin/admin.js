/* Simulation Platform — admin panel logic. */
(function () {
  'use strict';
  var P = window.SimPlatform;
  var $ = function (id) { return document.getElementById(id); };
  var ADMIN_KEY = 'stouras';                 // local-mode gate, same key as the other lab admin panels
  var CRED_KEY = P.KEYS.adminCreds;          // 'simp:admin-creds'
  var CFG = { sims: {}, source: null };

  $('mode').textContent = P.configured ? 'FIREBASE' : 'LOCAL';
  $('mode').className = 'mode ' + (P.configured ? 'fb' : 'local');

  /* ---------- gate ---------- */
  function openAdmin() {
    $('s-gate').hidden = true;
    $('s-admin').hidden = false;
    $('local-extras').hidden = P.configured;
    $('roster-local').hidden = P.configured;
    $('roster-fb').hidden = !P.configured;
    if (P.configured) {
      P.firebase().then(function (F) {
        var u = F.auth.currentUser;
        $('admin-who').textContent = u && u.email ? 'Signed in as ' + u.email : '';
        $('btn-signout').hidden = false;
        $('btn-signout').onclick = function () {
          this.disabled = true;
          this.textContent = 'Signing out…';
          F.adminSignOut().then(function () { location.reload(); });
        };
      });
    } else {
      $('admin-who').textContent = 'LOCAL mode — no sign-in.';
    }
    renderTable();
    initConsoles();
    initCreds();
    if (P.configured) startRoster();
  }
  if (P.configured) {
    $('s-gate').hidden = false;
    $('gate-fb').hidden = false;
    P.firebase().then(function (F) {
      F.onAuth(function (u) {
        var ok = u && u.email && (window.SIMP_ADMIN_EMAILS || []).indexOf(u.email) >= 0;
        if (ok) openAdmin();
      });
    });
    $('g-signin').onclick = function () {
      $('g-err').textContent = '';
      P.firebase().then(function (F) {
        return F.adminSignIn($('g-email').value.trim(), $('g-pass').value);
      }).then(function (cred) {
        if ((window.SIMP_ADMIN_EMAILS || []).indexOf(cred.user.email) < 0) {
          $('g-err').textContent = 'That account is not in SIMP_ADMIN_EMAILS.';
        }
      }).catch(function (e) { $('g-err').textContent = 'Sign-in failed: ' + (e && e.message || e); });
    };
  } else {
    var key = (location.search.match(/[?&]key=([^&]+)/) || [])[1] || '';
    if (key === ADMIN_KEY) openAdmin();
    else { $('s-gate').hidden = false; $('gate-local').hidden = false; }
  }

  /* ---------- activation table ---------- */
  function renderTable() {
    var tb = $('simtab').querySelector('tbody');
    tb.innerHTML = '';
    /* Saved-active sims float to the top (stable sort keeps the catalog's
       curated order within each group). Sorted on the SAVED state, so rows
       don't jump around while toggles are being ticked. */
    var list = P.catalog().slice().sort(function (a, b) {
      return ((CFG.sims[a.key] && CFG.sims[a.key].active) ? 0 : 1) -
             ((CFG.sims[b.key] && CFG.sims[b.key].active) ? 0 : 1);
    });
    list.forEach(function (s) {
      var c = CFG.sims[s.key] || {};
      var tr = document.createElement('tr');
      tr.dataset.key = s.key;
      tr.innerHTML =
        '<td class="ti"></td>' +
        '<td><label class="switch"><input type="checkbox" class="c-active"><span class="sl"></span></label></td>' +
        '<td><input type="text" class="c-session" maxlength="40" placeholder="—"></td>' +
        '<td><input type="text" class="c-note" maxlength="120" placeholder="—"></td>' +
        '<td class="links"></td>';
      tr.querySelector('.ti').textContent = s.icon + ' ' + s.title;
      tr.querySelector('.c-active').checked = !!c.active;
      tr.querySelector('.c-session').value = c.sessionId || '';
      tr.querySelector('.c-note').value = c.note || '';
      var links = tr.querySelector('.links');
      var a1 = document.createElement('a');
      a1.href = s.external || s.path; a1.target = '_blank'; a1.rel = 'noopener'; a1.textContent = 'app ↗';
      links.appendChild(a1);
      if (s.adminUrl) {
        links.appendChild(document.createTextNode(' · '));
        var a2 = document.createElement('a');
        a2.href = s.adminUrl; a2.target = '_blank'; a2.rel = 'noopener'; a2.textContent = 'admin ↗';
        links.appendChild(a2);
      }
      tb.appendChild(tr);
    });
    var note = $('save-note');
    if (CFG.source === 'firestore') note.textContent = 'Live (Firestore) — saving publishes to every student instantly.';
    else if (CFG.source === 'draft') note.textContent = 'Local draft — publish by downloading config.json and committing it to the repo.';
    else note.textContent = P.configured ? '' : 'Showing the committed config.json — saving creates a local draft in this browser.';
  }
  function collect() {
    var sims = {};
    var rows = $('simtab').querySelectorAll('tbody tr');
    Array.prototype.forEach.call(rows, function (tr) {
      var e = {
        active: tr.querySelector('.c-active').checked,
        sessionId: tr.querySelector('.c-session').value.trim(),
        note: tr.querySelector('.c-note').value.trim()
      };
      if (e.active || e.sessionId || e.note) {
        if (!e.sessionId) delete e.sessionId;
        if (!e.note) delete e.note;
        sims[tr.dataset.key] = e;
      }
    });
    return { v: 1, sims: sims };
  }
  /* Button press feedback: label flips to busy → done/failed, then restores. */
  function pressed(btn, busy, done, failed) {
    btn.disabled = true;
    var idle = btn.dataset.idle || (btn.dataset.idle = btn.textContent);
    btn.textContent = busy;
    return function (ok) {
      btn.textContent = ok ? done : failed;
      setTimeout(function () { btn.disabled = false; btn.textContent = idle; }, 2200);
    };
  }
  var RULES_HINT = ' — “insufficient permissions” means the Firestore rules are not in effect: publish simulation/firestore.rules in the Firebase console and make sure its isAdmin() list has the e-mail you signed in with (see _FIREBASE-SETUP.md).';
  $('btn-savecfg').onclick = function () {
    $('save-err').textContent = '';
    var end = pressed(this, 'Saving…', '✓ Saved', '✗ Save failed');
    var out = collect();
    P.saveConfig(out).then(function (where) {
      CFG.sims = out.sims;   /* re-sort the table on the newly saved state */
      CFG.source = where;
      renderTable();
      $('save-note').textContent = where === 'firestore'
        ? 'Saved — students see the change on their next refresh.'
        : 'Draft saved in this browser. To publish for students: Download config.json and commit it at simulation/config.json.';
      end(true);
    }).catch(function (e) {
      $('save-err').textContent = 'Save failed: ' + (e && e.message || e) + (P.configured ? RULES_HINT : '');
      end(false);
    });
  };
  $('btn-download').onclick = function () {
    var end = pressed(this, 'Preparing…', '✓ Downloaded', '✗ Failed');
    var out = collect();
    out.note = 'Static fallback for which simulations are visible on stouras.com/simulation. Edit via the admin panel (simulation/admin/) in LOCAL mode, download, and commit the file here to publish. Ignored once Firebase is configured in firebase-config.js — Firestore then becomes live-authoritative.';
    out.updated = new Date().toISOString().slice(0, 10);
    var blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    end(true);
  };
  $('btn-discard').onclick = function () {
    var end = pressed(this, 'Discarding…', '✓ Discarded', '✗ Failed');
    P.clearDraft();
    P.watchConfig(function (c) { CFG = c; renderTable(); end(true); });
  };

  /* ---------- per-simulation consoles ---------- */
  function initConsoles() {
    var pick = $('con-pick');
    pick.innerHTML = '';
    P.catalog().filter(function (s) { return s.adminUrl; }).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.key;
      o.textContent = s.icon + ' ' + s.title;
      pick.appendChild(o);
    });
    function sync() {
      var s = P.sim(pick.value);
      if (!s) return;
      $('con-open').href = s.adminUrl;
      $('con-note').textContent = s.adminNote || '';
      $('con-frame').hidden = true;
    }
    pick.onchange = sync;
    sync();
    $('con-embed').onclick = function () {
      var s = P.sim(pick.value);
      if (!s) return;
      $('con-frame').hidden = false;
      $('con-frame').src = s.adminUrl;
      $('con-frame').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }

  /* ---------- shared admin credentials ---------- */
  function readCreds() {
    try {
      return JSON.parse(sessionStorage.getItem(CRED_KEY) || 'null') ||
             JSON.parse(localStorage.getItem(CRED_KEY) || 'null');
    } catch (e) { return null; }
  }
  function initCreds() {
    var c = readCreds();
    if (c) { $('cr-email').value = c.email || ''; $('cr-note').textContent = 'Saved ✓'; }
  }
  $('cr-save').onclick = function () {
    var c = JSON.stringify({ email: $('cr-email').value.trim(), pass: $('cr-pass').value, ts: Date.now() });
    sessionStorage.setItem(CRED_KEY, c);
    if ($('cr-persist').checked) localStorage.setItem(CRED_KEY, c);
    else localStorage.removeItem(CRED_KEY);
    $('cr-note').textContent = 'Saved ✓ — consoles with the SSO snippet will sign in automatically.';
  };
  $('cr-clear').onclick = function () {
    sessionStorage.removeItem(CRED_KEY);
    localStorage.removeItem(CRED_KEY);
    $('cr-pass').value = '';
    $('cr-note').textContent = 'Cleared.';
  };

  /* ---------- roster (Firebase mode; auto-loaded + live) ---------- */
  var roster = [];
  function renderRoster(rows) {
    /* Newest first, one row per student: a log-out + re-registration (or a
       second device) mints a new uid, so collapse by student ID keeping the
       most recent record. */
    var seen = {};
    roster = rows.sort(function (a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    }).filter(function (r) {
      var k = (r.studentId || '').trim().toLowerCase() || ('uid:' + r.uid);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
    var dropped = rows.length - roster.length;
    var tb = $('rostertab').querySelector('tbody');
    tb.innerHTML = '';
    roster.forEach(function (r) {
      var tr = document.createElement('tr');
      for (var i = 0; i < 5; i++) tr.appendChild(document.createElement('td'));
      tr.children[0].textContent = r.name || '';
      tr.children[1].textContent = r.studentId || '';
      tr.children[2].textContent = r.email || '';
      tr.children[3].textContent = r.levelOfStudy || '';
      tr.children[4].textContent = (r.createdAt || '').slice(0, 10);
      tb.appendChild(tr);
    });
    $('rostertab').hidden = roster.length === 0;
    $('btn-csv').hidden = roster.length === 0;
    $('roster-count').textContent = roster.length === 0
      ? 'No registrations yet — students appear here the moment they register.'
      : roster.length + ' student' + (roster.length === 1 ? '' : 's') +
        (dropped ? ' (' + dropped + ' duplicate registration' + (dropped === 1 ? '' : 's') + ' collapsed)' : '');
  }
  function startRoster() {
    P.firebase().then(function (F) {
      F.watchStudents(function (rows) {
        if (rows) renderRoster(rows);
        else $('roster-count').textContent = 'Roster unavailable: permission denied' + RULES_HINT;
      });
    });
  }
  $('btn-csv') && ($('btn-csv').onclick = function () {
    var cols = ['name', 'studentId', 'email', 'age', 'gender', 'nationality', 'country',
                'levelOfStudy', 'workExperience', 'occupation', 'englishFluency', 'createdAt'];
    var esc = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = cols.join(',') + '\n' + roster.map(function (r) {
      return cols.map(function (c) { return esc(r[c]); }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'simulation-platform-roster.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  /* ---------- boot ---------- */
  P.watchConfig(function (c) {
    CFG = c;
    /* Firebase is configured but the config doc could not be read → the rules
       are almost certainly not published. Say so loudly instead of silently
       showing the committed config.json. */
    if (P.configured && c.source === 'static') {
      $('save-err').textContent = 'Firestore could not be read — the platform is falling back to the committed config.json.' + RULES_HINT;
    }
    if (!$('s-admin').hidden) renderTable();
  });
})();
