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
        /* Uppercased: every sim mints UPPERCASE session codes (pf genCode,
           arena code6, search-v2/ssc/ideasearchlab all A-Z0-9), so a
           lowercase pin would fail their case-sensitive lookups. */
        sessionId: tr.querySelector('.c-session').value.trim().toUpperCase(),
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
      buildConsoleOptions();   /* consoles picker follows the activations */
      $('save-note').textContent = where === 'firestore'
        ? 'Saved — live: open student pages update by themselves.'
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
  /* ACTIVE simulations first — the same saved-state order as the activation
     table above — so today's consoles sit on top; called again on every
     config change/save so the order follows the activations. Stable sort
     (catalog order within each group); the current selection is kept and an
     open embedded console is never collapsed by a reorder. */
  function buildConsoleOptions() {
    var pick = $('con-pick');
    if (!pick) return;
    var prev = pick.value;
    pick.innerHTML = '';
    var list = P.catalog().filter(function (s) { return s.adminUrl; });
    list.sort(function (a, b) {
      var aa = (CFG.sims[a.key] && CFG.sims[a.key].active) ? 0 : 1;
      var bb = (CFG.sims[b.key] && CFG.sims[b.key].active) ? 0 : 1;
      return aa - bb;
    });
    list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.key;
      o.textContent = s.icon + ' ' + s.title + ((CFG.sims[s.key] && CFG.sims[s.key].active) ? ' — active' : '');
      pick.appendChild(o);
    });
    if (prev && list.some(function (s) { return s.key === prev; })) pick.value = prev;
  }
  function initConsoles() {
    var pick = $('con-pick');
    buildConsoleOptions();
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
  var lastRows = null;                      // latest snapshot rows, for filter/config re-renders
  /* Column filters: click the Approved / a simulation column header to cycle
     all → only-yes(✓) → only-no(—). Per the owner: track which students
     have not responded to which active simulation. */
  var rosterFilters = { appr: null, sims: {} };
  function activeSims() {
    return P.catalog().filter(function (s) { return CFG.sims[s.key] && CFG.sims[s.key].active; });
  }
  function rowCompleted(r, key) { return !!(r.completed && r.completed[key]); }
  function completedTip(r, key) {
    var c = r.completed && r.completed[key];
    if (!c) return 'Not answered yet';
    var d = c.ts ? new Date(Number(c.ts)) : null;
    return 'Completed' + (d && !isNaN(d) ? ' ' + d.toISOString().slice(0, 16).replace('T', ' ') : '') +
           (c.session ? ' · session ' + c.session : '');
  }
  function cycleGlyph(v) { return v === 'yes' ? ' ✓' : v === 'no' ? ' —' : ''; }
  function renderRoster(rows) {
    lastRows = rows;
    /* Newest first, one row per student: a log-out + re-registration (or a
       second device) mints a new uid, so collapse by student ID keeping the
       most recent record. uidsByKey remembers EVERY uid behind a displayed
       row, so deleting it also removes its collapsed duplicates. */
    var seen = {}, uidsByKey = {};
    var keyOf = function (r) { return (r.studentId || '').trim().toLowerCase() || ('uid:' + r.uid); };
    rows.forEach(function (r) {
      var k = keyOf(r);
      (uidsByKey[k] = uidsByKey[k] || []).push(r.uid);
    });
    roster = rows.sort(function (a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    }).filter(function (r) {
      var k = keyOf(r);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
    var dropped = rows.length - roster.length;
    var sims = activeSims();

    /* Dynamic header: base columns + Approved + one column per ACTIVE sim
       (each header shows the sim icon + answered/total tally; clicking it
       cycles the filter) + the actions column. */
    var hd = $('rostertab').querySelector('thead tr');
    hd.innerHTML = '';
    ['Name', 'Student ID', 'E-mail', 'Level', 'Registered'].forEach(function (t) {
      var th = document.createElement('th'); th.textContent = t; hd.appendChild(th);
    });
    var thA = document.createElement('th');
    thA.textContent = 'Approved' + cycleGlyph(rosterFilters.appr);
    thA.className = 'th-filter';
    thA.title = 'Click to filter: all → only approved → only waiting';
    thA.onclick = function () {
      rosterFilters.appr = rosterFilters.appr === null ? 'yes' : rosterFilters.appr === 'yes' ? 'no' : null;
      renderRoster(lastRows);
    };
    hd.appendChild(thA);
    sims.forEach(function (s) {
      var doneN = roster.filter(function (r) { return rowCompleted(r, s.key); }).length;
      var f = rosterFilters.sims[s.key] || null;
      var th = document.createElement('th');
      th.className = 'th-filter';
      th.textContent = s.icon + ' ' + doneN + '/' + roster.length + cycleGlyph(f);
      th.title = s.title + ' — ' + doneN + ' of ' + roster.length + ' answered. Click to filter: all → only answered → only not-yet.';
      th.onclick = function () {
        var cur = rosterFilters.sims[s.key] || null;
        rosterFilters.sims[s.key] = cur === null ? 'yes' : cur === 'yes' ? 'no' : null;
        renderRoster(lastRows);
      };
      hd.appendChild(th);
    });
    hd.appendChild(document.createElement('th'));

    /* Apply the column filters to what is DISPLAYED (counts below name both). */
    var visible = roster.filter(function (r) {
      if (rosterFilters.appr === 'yes' && !r.approved) return false;
      if (rosterFilters.appr === 'no' && r.approved) return false;
      for (var i = 0; i < sims.length; i++) {
        var f = rosterFilters.sims[sims[i].key] || null;
        if (f === 'yes' && !rowCompleted(r, sims[i].key)) return false;
        if (f === 'no' && rowCompleted(r, sims[i].key)) return false;
      }
      return true;
    });

    var tb = $('rostertab').querySelector('tbody');
    tb.innerHTML = '';
    visible.forEach(function (r) {
      var tr = document.createElement('tr');
      for (var i = 0; i < 7 + sims.length; i++) tr.appendChild(document.createElement('td'));
      tr.children[0].textContent = r.name || '';
      tr.children[1].textContent = r.studentId || '';
      tr.children[2].textContent = r.email || '';
      tr.children[3].textContent = r.levelOfStudy || '';
      tr.children[4].textContent = (r.createdAt || '').slice(0, 10);
      /* Approval gate: only approved students can launch the active sims (the
         in-class guard — a shared link is useless to a classmate the admin
         never approves). Toggles every doc behind this row; the student's
         page unlocks itself live via its own onSnapshot. */
      var appr = document.createElement('button');
      appr.className = r.approved ? 'btn small' : 'btn ghost small';
      appr.textContent = r.approved ? '✓ Approved' : 'Approve';
      appr.title = r.approved ? 'Click to revoke — the student can no longer launch simulations.'
                              : 'Click to let this student play the active simulations.';
      appr.onclick = function () {
        appr.disabled = true; appr.textContent = '…';
        P.firebase().then(function (F) {
          return F.approveStudents(uidsByKey[keyOf(r)] || [r.uid], !r.approved);
        }).then(function () {
          /* Repaint the row locally too — the live snapshot normally does it,
             but on a network with a dead streaming channel the click would
             otherwise look like it did nothing. */
          r.approved = !r.approved;
          appr.disabled = false;
          appr.className = r.approved ? 'btn small' : 'btn ghost small';
          appr.textContent = r.approved ? '✓ Approved' : 'Approve';
          appr.title = r.approved ? 'Click to revoke — the student can no longer launch simulations.'
                                  : 'Click to let this student play the active simulations.';
        }, function (e) {
          appr.disabled = false; appr.textContent = r.approved ? '✓ Approved' : 'Approve';
          $('roster-count').textContent = 'Approval failed: ' +
            ((e && e.code && String(e.code).indexOf('permission-denied') >= 0)
              ? 'permission denied — republish the updated firestore.rules' + RULES_HINT
              : ((e && e.message) || e));
        });
      };
      tr.children[5].appendChild(appr);
      /* One cell per ACTIVE simulation: ✓ answered / — not yet (tooltip has
         the completion time + session). Data comes from the student page
         mirroring its play-once markers onto the roster doc (syncCompleted). */
      sims.forEach(function (s, i) {
        var td = tr.children[6 + i];
        var done = rowCompleted(r, s.key);
        td.textContent = done ? '✓' : '—';
        td.title = s.title + ': ' + completedTip(r, s.key);
        td.style.textAlign = 'center';
        td.style.color = done ? '#1d6b3a' : '#a9b0c0';
        if (done) td.style.fontWeight = '700';
      });
      /* Delete a registration (e.g. a test row). Removes the roster doc(s)
         behind this row — the live snapshot refreshes the table by itself.
         The student's own browser profile is untouched (they can just
         register again). */
      var del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = 'Delete';
      del.onclick = function () {
        var who = (r.name || r.email || r.studentId || 'this student');
        if (!window.confirm('Delete the registration of ' + who + ' from the roster? This cannot be undone.')) return;
        del.disabled = true; del.textContent = 'Deleting…';
        P.firebase().then(function (F) {
          return F.deleteStudents(uidsByKey[keyOf(r)] || [r.uid]);
        }).then(function () {
          tr.remove();   // instant; the snapshot re-render follows
        }, function (e) {
          del.disabled = false; del.textContent = 'Delete';
          $('roster-count').textContent = 'Delete failed: ' +
            ((e && e.code && e.code.indexOf('permission-denied') >= 0)
              ? 'permission denied — sign in as the admin' + RULES_HINT
              : ((e && e.message) || e));
        });
      };
      tr.children[6 + sims.length].appendChild(del);
      tr.children[6 + sims.length].style.textAlign = 'right';
      tb.appendChild(tr);
    });
    $('rostertab').hidden = roster.length === 0;
    $('btn-csv').hidden = roster.length === 0;
    var approvedN = roster.filter(function (r) { return r.approved; }).length;
    var filtered = visible.length !== roster.length;
    $('roster-count').textContent = roster.length === 0
      ? 'No registrations yet — students appear here the moment they register.'
      : roster.length + ' student' + (roster.length === 1 ? '' : 's') +
        ' · ' + approvedN + ' approved' +
        (roster.length - approvedN ? ' · ' + (roster.length - approvedN) + ' waiting (they see no simulations until approved)' : '') +
        (filtered ? ' · showing ' + visible.length + ' (column filters on — click the headers to change)' : '') +
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
                'levelOfStudy', 'workExperience', 'occupation', 'industry', 'englishFluency', 'approved', 'createdAt'];
    var simCols = activeSims();
    var esc = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = cols.concat(simCols.map(function (s) { return 'completed:' + s.key; })).join(',') + '\n' +
      roster.map(function (r) {
        return cols.map(function (c) { return esc(r[c]); })
          .concat(simCols.map(function (s) { return rowCompleted(r, s.key) ? 'yes' : ''; }))
          .join(',');
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
    /* The roster's per-simulation columns and the consoles picker both
       mirror the ACTIVE set — refresh them whenever the config changes. */
    if (lastRows) renderRoster(lastRows);
    if (!$('s-admin').hidden) buildConsoleOptions();
  });
})();
