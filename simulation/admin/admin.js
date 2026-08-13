/* Simulation Platform — admin panel logic. */
(function () {
  'use strict';
  var P = window.SimPlatform;
  var $ = function (id) { return document.getElementById(id); };
  var ADMIN_KEY = 'stouras';                 // local-mode gate, same key as the other lab admin panels
  /* Run work that nothing on screen waits for after the page has settled. */
  var whenIdle = function (fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 1200);
  };
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
    /* Nothing here can be decided until the Firebase SDK (three modules from
       Google's CDN) has loaded and reported the signed-in user — and the admin
       is normally signed in already, so painting the sign-in form first showed
       a state they were never in for the whole of that wait. Show what is
       actually happening instead, and reveal the form only once we know they
       are signed out — or after a moment, so a genuinely signed-out admin can
       start typing rather than watch a message. (The page's <head> preloads the
       SDK, which is what shortens the wait itself.) */
    $('gate-wait').hidden = false;
    var authSettled = false;
    var formTimer = setTimeout(function () { if (!authSettled) $('gate-fb').hidden = false; }, 1200);
    var settleGate = function (signedIn) {
      authSettled = true;
      clearTimeout(formTimer);
      $('gate-wait').hidden = true;
      $('gate-fb').hidden = !!signedIn;
    };
    P.firebase().then(function (F) {
      F.onAuth(function (u) {
        var ok = u && u.email && (window.SIMP_ADMIN_EMAILS || []).indexOf(u.email) >= 0;
        settleGate(ok);
        if (ok) openAdmin();
      });
    }, function () { settleGate(false); });
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
      /* The roster's per-simulation columns and Verify buttons mirror the
         ACTIVE set too — repaint them now rather than waiting for the config
         snapshot to echo back (which never arrives in LOCAL mode). */
      if (lastRows) renderRoster(lastRows);
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
  /* A revoked completion is a TOMBSTONE inside the same map ({revoked:1,rts})
     — the student no longer counts as having done it (and may retake it). */
  function rowCompleted(r, key) {
    var c = r.completed && r.completed[key];
    return !!(c && !c.revoked);
  }
  function completedTip(r, key) {
    var c = r.completed && r.completed[key];
    if (c && c.revoked) {
      var rd = c.rts ? new Date(Number(c.rts)) : null;
      return 'Completion removed' + (rd && !isNaN(rd) ? ' ' + rd.toISOString().slice(0, 16).replace('T', ' ') : '') +
             ' — the student can take it again';
    }
    if (!c) return 'Not answered yet';
    var d = c.ts ? new Date(Number(c.ts)) : null;
    return 'Completed' + (d && !isNaN(d) ? ' ' + d.toISOString().slice(0, 16).replace('T', ' ') : '') +
           (c.session ? ' · session ' + c.session : '') +
           (c.src === 'manual' ? ' · marked by you'
             /* 'arena' is the legacy marker from when Answer Arena was the only
                verifiable simulation; 'verify' is what every reconciliation
                writes now (the simulation is already known — it IS this key). */
             : (c.src === 'verify' || c.src === 'arena')
               ? ' · verified from ' + ((P.sim(key) || {}).title || key) : '');
  }
  function cycleGlyph(v) { return v === 'yes' ? ' ✓' : v === 'no' ? ' —' : ''; }
  function renderRoster(rows) {
    lastRows = rows;
    /* Newest first, one row per student: a log-out + re-registration (or a
       second device) mints a new uid, so collapse by student ID keeping the
       most recent record. uidsByKey remembers EVERY uid behind a displayed
       row, so deleting it also removes its collapsed duplicates. */
    var seen = {}, uidsByKey = {}, rowsByKey = {};
    var keyOf = function (r) { return (r.studentId || '').trim().toLowerCase() || ('uid:' + r.uid); };
    rows.forEach(function (r) {
      var k = keyOf(r);
      (uidsByKey[k] = uidsByKey[k] || []).push(r.uid);
      (rowsByKey[k] = rowsByKey[k] || []).push(r);
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
        td.style.textAlign = 'center';
        td.style.color = done ? '#1d6b3a' : '#a9b0c0';
        if (done) td.style.fontWeight = '700';
        /* Manual override (confirm-guarded): click a cell to mark/unmark a
           completion by hand — the instructor's final word for students the
           automatic markers and the arena reconciliation missed (e.g. a
           student ID typed differently in the two forms). Flows down to the
           student's own page live. */
        td.style.cursor = 'pointer';
        td.title = s.title + ': ' + completedTip(r, s.key) +
          ' — click to ' + (done ? 'REMOVE this ✓ (mark as not completed)' : 'manually mark as completed') + '.';
        td.onclick = function () {
          var who = r.name || r.studentId || 'this student';
          var q = done
            ? 'Remove the ✓ for ' + who + ' on ' + s.title + '?'
            : 'Manually mark ' + who + ' as having completed ' + s.title + '?';
          if (!window.confirm(q)) return;
          td.textContent = '…';
          var uids = uidsByKey[keyOf(r)] || [r.uid];
          /* Revoking also writes the e-mail recovery replica, so it needs the
             address as well as the uid (see revokeCompletion). */
          var rowsFor = (rowsByKey[keyOf(r)] || [r]).map(function (x) { return { uid: x.uid, email: x.email }; });
          P.firebase().then(function (F) {
            return done
              ? F.revokeCompletion(rowsFor, s.key)
              : F.stampCompleted(uids, s.key, { ts: new Date().getTime(), session: (CFG.sims[s.key] && CFG.sims[s.key].sessionId) || null, src: 'manual' });
          }).then(function () {
            r.completed = r.completed || {};
            if (done) r.completed[s.key] = { revoked: 1, rts: new Date().getTime() };
            else r.completed[s.key] = { ts: new Date().getTime(), session: (CFG.sims[s.key] && CFG.sims[s.key].sessionId) || null, src: 'manual' };
            renderRoster(lastRows);   // instant; the live snapshot confirms
          }, function (e) {
            td.textContent = done ? '✓' : '—';
            $('roster-count').textContent = 'Update failed: ' + ((e && e.message) || e);
          });
        };
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
    renderVerifyButtons();
    var approvedN = roster.filter(function (r) { return r.approved; }).length;
    var filtered = visible.length !== roster.length;

    /* Bulk approval (owner request): approve — or revoke — a whole class in one
       click instead of one row at a time. It acts on the rows CURRENTLY SHOWN,
       so the column filters double as a selector (filter to the students who
       answered a simulation, then approve just those); with no filter on, that
       is the whole roster. Only rows that would actually CHANGE are written,
       and the rows are repainted locally like the per-row toggle, since the
       live snapshot can be slow (or dead) on a stream-hostile network. */
    function wireBulkApproval(id, approved) {
      var btn = $(id);
      if (!btn) return;
      btn.hidden = roster.length === 0;
      var targets = visible.filter(function (r) { return !!r.approved !== approved; });
      var scope = filtered ? ' shown (column filters are on)' : '';
      btn.disabled = targets.length === 0;
      btn.textContent = (approved ? '✓ Approve all' : 'Revoke all approvals') +
        (targets.length ? ' (' + targets.length + ')' : '');
      btn.title = targets.length === 0
        ? (approved ? 'Every student' + scope + ' is already approved.'
                    : 'No student' + scope + ' is approved.')
        : (approved
            ? 'Approve the ' + targets.length + ' student(s)' + scope + ' still waiting — they can then launch the active simulations.'
            : 'Revoke approval for the ' + targets.length + ' approved student(s)' + scope + ' — they can no longer launch simulations.');
      btn.onclick = function () {
        if (!targets.length) return;
        var q = approved
          ? 'Approve all ' + targets.length + ' student(s)' + scope + ' who are still waiting? They will be able to launch the active simulations.'
          : 'Revoke approval for all ' + targets.length + ' approved student(s)' + scope + '? They will see no simulations until approved again.';
        if (!window.confirm(q)) return;
        btn.disabled = true;
        btn.textContent = approved ? 'Approving…' : 'Revoking…';
        var uids = [];
        targets.forEach(function (r) {
          (uidsByKey[keyOf(r)] || [r.uid]).forEach(function (u) { uids.push(u); });
        });
        P.firebase().then(function (F) {
          return F.approveStudents(uids, approved);
        }).then(function () {
          targets.forEach(function (r) { r.approved = approved; });
          renderRoster(lastRows);   // instant; the live snapshot confirms
          $('roster-count').textContent = (approved ? 'Approved ' : 'Revoked approval for ') +
            targets.length + ' student(s). ' + $('roster-count').textContent;
        }, function (e) {
          renderRoster(lastRows);
          $('roster-count').textContent = (approved ? 'Bulk approval' : 'Bulk revoke') + ' failed: ' +
            ((e && e.code && String(e.code).indexOf('permission-denied') >= 0)
              ? 'permission denied — republish the updated firestore.rules' + RULES_HINT
              : ((e && e.message) || e));
        });
      };
    }
    wireBulkApproval('btn-approve-all', true);
    wireBulkApproval('btn-unapprove-all', false);

    /* Delete all (owner request): the row Delete button applied to every row
       SHOWN — the end-of-term clean-out, so the column filters scope it too.
       It is irreversible and it locks those students out (their browser will
       not re-create a roster doc it believes it already synced, and the
       student page shows no cards without one), so it asks TWICE: a confirm
       naming the count and scope, then the word DELETE typed back. */
    (function wireDeleteAll() {
      var btn = $('btn-delete-all');
      if (!btn) return;
      btn.hidden = roster.length === 0;
      var scope = filtered ? ' shown (column filters are on)' : '';
      btn.disabled = visible.length === 0;
      btn.textContent = 'Delete all students' + (visible.length ? ' (' + visible.length + ')' : '');
      btn.title = 'Delete the ' + visible.length + ' registration(s)' + scope +
        ' — permanently. They lose access until they register again; use the row Delete for single rows.';
      btn.onclick = function () {
        if (!visible.length) return;
        if (!window.confirm('Delete ALL ' + visible.length + ' student registration(s)' + scope +
              ' from the roster?\n\nThis cannot be undone. Those students see no simulations until they ' +
              'register again, and their answers-per-simulation record here goes with them ' +
              '(each simulation keeps its own data).')) return;
        var typed = window.prompt('Type DELETE to confirm removing ' + visible.length +
          ' student registration(s)' + scope + '.');
        if (!typed || typed.trim().toUpperCase() !== 'DELETE') {
          $('roster-count').textContent = 'Delete all cancelled — nothing was removed.';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        var uids = [], gone = {};
        visible.forEach(function (r) {
          (uidsByKey[keyOf(r)] || [r.uid]).forEach(function (u) { uids.push(u); gone[u] = 1; });
        });
        P.firebase().then(function (F) {
          return F.deleteStudents(uids);
        }).then(function () {
          /* Drop them locally too — the live snapshot normally does it, but a
             dead streaming channel would leave the wiped rows on screen. */
          var left = (lastRows || []).filter(function (r) { return !gone[r.uid]; });
          renderRoster(left);
          $('roster-count').textContent = 'Deleted ' + uids.length + ' registration(s). ' +
            $('roster-count').textContent;
        }, function (e) {
          renderRoster(lastRows);
          $('roster-count').textContent = 'Delete all failed: ' +
            ((e && e.code && String(e.code).indexOf('permission-denied') >= 0)
              ? 'permission denied — sign in as the admin' + RULES_HINT
              : ((e && e.message) || e));
        });
      };
    })();

    $('roster-count').textContent = roster.length === 0
      ? 'No registrations yet — students appear here the moment they register.'
      : roster.length + ' student' + (roster.length === 1 ? '' : 's') +
        ' · ' + approvedN + ' approved' +
        (roster.length - approvedN ? ' · ' + (roster.length - approvedN) + ' waiting (they see no simulations until approved)' : '') +
        (filtered ? ' · showing ' + visible.length + ' (column filters on — click the headers to change)' : '') +
        (dropped ? ' (' + dropped + ' duplicate registration' + (dropped === 1 ? '' : 's') + ' collapsed)' : '');
  }
  var recoveryBackfilled = false;
  function startRoster() {
    P.firebase().then(function (F) {
      F.watchStudents(function (rows) {
        if (rows) {
          renderRoster(rows);
          /* Auto-backfill the e-mail recovery docs once per panel open —
             students who registered before the recovery feature existed
             have none and could not log back in by e-mail until now. */
          if (!recoveryBackfilled && rows.length) {
            recoveryBackfilled = true;
            /* One write per student — a whole class of them. Held until the
               browser is idle so it never competes with painting the roster
               (nothing on screen depends on it). */
            whenIdle(function () {
              F.backfillRecovery(rows).then(function (n) {
                $('backfill-note').textContent = 'E-mail login enabled for ' + n + ' registered student(s) (recovery records up to date).';
              }).catch(function () { recoveryBackfilled = false; });
            });
          }
        }
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

  /* ---------- verify completions from each simulation's own records ----------
     The client-side markers can miss a student (platform tab closed when they
     finished, a direct URL, another browser) — but each simulation's OWN
     backend is the ground truth wherever it keeps an IDENTIFIABLE participant
     record, i.e. one carrying the university student ID, the join key to this
     roster. One button per ACTIVE simulation that declares a `verify` block in
     catalog.js (Answer Arena, the Ideation Challenge, PortfolioFit, Search);
     the per-simulation reading lives in verify.js, everything below is generic.
     Simulations that collect nothing identifiable (Problem Solving writes to a
     Google Sheet, Sustainable Supply Chains records firm decisions, Newsvendor
     is another project, Trust the AI? stores nothing) get no button — there is
     nothing to reconcile against. Reads that project with the shared admin
     credentials (the locker above), then stamps completed.<simKey> onto every
     matching roster doc; each student's page pulls the ✓ down live via its
     own-doc watch. Read-only on the simulation's side. */
  function verifiableSims() {
    return activeSims().filter(function (s) {
      return s.verify && window.SIMP_VERIFY && window.SIMP_VERIFY[s.verify.adapter];
    });
  }
  /* An app either publishes its web config as its own file (Answer Arena's
     arena-config.js, loaded by this page) or keeps it inside its bundle, in
     which case the catalog carries a copy. */
  function verifyConfig(s) {
    var v = s.verify || {};
    var cfg = (v.configGlobal && window[v.configGlobal]) || v.config || null;
    return (cfg && cfg.apiKey) ? cfg : null;
  }
  /* The simulations share one admin login by design (see the locker above), so
     the credentials are asked for once and reused for every verification. */
  function sharedCreds(simTitle) {
    var creds = null;
    try {
      creds = JSON.parse(sessionStorage.getItem(P.KEYS.adminCreds) ||
                         localStorage.getItem(P.KEYS.adminCreds) || 'null');
    } catch (e) {}
    if (creds && creds.email && creds.pass) return creds;
    /* No locker? Just ask — the admin e-mail is known (the shared login),
       only the password is needed; remembered for this tab so the next
       click doesn't re-ask. */
    var email = (window.SIMP_ADMIN_EMAILS || [])[0] || '';
    var pass = window.prompt(simTitle + ' admin password for ' + email +
      '\n(the shared admin login — used once to read its completion records; Cancel to abort):');
    if (!pass) return null;
    creds = { email: email, pass: pass };
    try { sessionStorage.setItem(P.KEYS.adminCreds, JSON.stringify(creds)); } catch (e) {}
    return creds;
  }
  /* Sign in to ONE simulation's own Firebase project in a named secondary app,
     so the platform's own session is never disturbed. */
  function simFirestore(s) {
    var cfg = verifyConfig(s);
    if (!cfg) return Promise.reject(new Error('no Firebase web config for ' + s.title +
      ' — add it to its verify block in catalog.js'));
    var creds = sharedCreds(s.title);
    if (!creds) return Promise.reject(new Error('cancelled — save the shared admin credentials in the locker above, or enter the password when prompted'));
    var U = 'https://www.gstatic.com/firebasejs/10.12.2/';
    var appName = 'verify-' + s.key;
    return Promise.all([
      import(U + 'firebase-app.js'), import(U + 'firebase-auth.js'), import(U + 'firebase-firestore.js')
    ]).then(function (m) {
      var A = m[1], D = m[2], app;
      try { app = m[0].getApp(appName); } catch (e) { app = m[0].initializeApp(cfg, appName); }
      var auth = A.getAuth(app);
      var signin = auth.currentUser ? Promise.resolve(auth.currentUser)
        : A.signInWithEmailAndPassword(auth, creds.email, creds.pass).then(function (c) { return c.user; })
           .catch(function (e) {
             /* a wrong saved password must not wedge every future click —
                clear it so the next attempt prompts again */
             try { sessionStorage.removeItem(P.KEYS.adminCreds); } catch (x) {}
             throw new Error(s.title + ' sign-in failed (' + ((e && e.code) || e) + ') — click Verify again and re-enter the password');
           });
      return signin.then(function (u) {
        return { D: D, fs: D.getFirestore(app), uid: (u && u.uid) || null, sim: s };
      });
    });
  }
  function verifyFromSim(s) {
    if (!lastRows) return Promise.reject(new Error('the roster has not loaded yet'));
    if (!(CFG.sims[s.key] && CFG.sims[s.key].active)) {
      return Promise.reject(new Error('activate ' + s.title + ' first — while it is off the roster shows no column for it, so a change here would be invisible'));
    }
    return simFirestore(s).then(function (ctx) {
      return Promise.all([
        window.SIMP_VERIFY[s.verify.adapter](ctx),
        /* Decide from a FRESH roster read, never from the live-snapshot
           cache (a dead streaming channel would make this destructive
           pass act on a stale view). */
        P.firebase().then(function (F) { return F.listStudents(); })
      ]);
    }).then(function (r) {
      var read = r[0] || {};
      var doneById = read.doneById || {};       // normalized student ID -> {ts, session}
      var rosterRows = r[1] || lastRows;
      /* SAFETY: a read that returned no participant records at all means
         something went wrong (wrong project, empty result, permissions) —
         never treat that as "nobody completed anything" and revoke the whole
         class. */
      if (!read.records) throw new Error(s.title + ' returned no participant records at all — nothing was changed. Check you signed in to the right project.');
      if (!Object.keys(doneById).length) throw new Error(s.title + ' lists no COMPLETED participant with a student ID — nothing was changed (a sync from here would have removed every ✓).');

      var byPid = {};
      rosterRows.forEach(function (row) {
        var k = String(row.studentId || '').trim().toLowerCase();
        if (k) (byPid[k] = byPid[k] || []).push(row);
      });
      var stamps = [], already = 0, unmatched = [];
      Object.keys(doneById).forEach(function (pid) {
        var rows = byPid[pid];
        if (!rows) { unmatched.push(pid); return; }
        if (rows.some(function (row) { return rowCompleted(row, s.key); })) { already++; return; }
        stamps.push({ uids: rows.map(function (row) { return row.uid; }).filter(Boolean), mark: doneById[pid] });
      });

      /* TWO-WAY: a roster ✓ whose student is no longer a completed participant
         over there (deleted so they may retake it) must be REVOKED — the
         simulation's own records are the ground truth. Two stamps are never
         auto-revoked: one the instructor set BY HAND (that override exists
         precisely for students the automatic join cannot match), and one still
         matched in the simulation. */
      var revokes = [], seenKey = {}, stampedTotal = 0;
      rosterRows.forEach(function (row) {
        var c = row.completed && row.completed[s.key];
        if (!c || c.revoked) return;
        stampedTotal++;
        if (c.src === 'manual') return;
        var pid = String(row.studentId || '').trim().toLowerCase();
        if (pid && doneById[pid]) return;              // still completed over there
        var k = pid || ('uid:' + row.uid);
        if (seenKey[k]) return;
        seenKey[k] = 1;
        var group = byPid[pid] || [row];
        revokes.push({ rows: group.map(function (x) { return { uid: x.uid, email: x.email }; })
                                  .filter(function (x) { return x.uid; }),
                       who: row.name || row.studentId || row.uid });
      });

      var tail = (unmatched.length
        ? ' · ' + unmatched.length + ' completed ' + s.title + ' ID(s) not in this roster: ' +
          unmatched.slice(0, 10).join(', ') + (unmatched.length > 10 ? '…' : '')
        : '');

      /* The join is by student ID typed into two different forms, so it can
         be lossy (a typo, a leading zero). Unmatched IDs are direct evidence
         that it is lossy RIGHT NOW — so refuse a mass removal in that state
         rather than unlocking students who really did finish. */
      var cancelled = 0;
      if (revokes.length && unmatched.length && revokes.length > Math.max(3, stampedTotal * 0.25)) {
        throw new Error('refusing to remove ' + revokes.length + ' of ' + stampedTotal +
          ' ✓ marks while ' + unmatched.length + ' completed ' + s.title + ' ID(s) do not match this roster — ' +
          'that pattern means the student-ID join is failing, not that everyone was deleted. ' +
          'Nothing was changed; fix the mismatched IDs (or remove the ✓ by clicking the cells).');
      }
      if (revokes.length && !window.confirm(
            s.title + ' no longer lists ' + revokes.length + ' student(s) as completed:\n\n' +
            revokes.slice(0, 15).map(function (x) { return '• ' + x.who; }).join('\n') +
            (revokes.length > 15 ? '\n• …' : '') +
            '\n\nRemove their ✓ so they can take it again?\n' +
            '(Marks you set by hand are never removed.)' +
            (unmatched.length ? '\n\nNote: ' + unmatched.length + ' completed ' + s.title + ' ID(s) do not match anyone in this roster.' : ''))) {
        cancelled = revokes.length;
        revokes.length = 0;
      }

      if (!stamps.length && !revokes.length) {
        return cancelled
          ? cancelled + ' proposed removal(s) were cancelled — the roster still differs from ' + s.title + tail
          : 'Checked ' + Object.keys(doneById).length + ' completed ' + s.title + ' participant(s) — the roster already matches' + tail;
      }
      return P.firebase().then(function (F) {
        /* allSettled: one failed row must not hide the rest of the run. */
        return Promise.allSettled(stamps.map(function (st) {
          return F.stampCompleted(st.uids, s.key, { ts: st.mark.ts, session: st.mark.session, src: 'verify' });
        }).concat(revokes.map(function (rv) {
          return F.revokeCompletion(rv.rows, s.key);
        })));
      }).then(function (rs) {
        var failed = rs.filter(function (x) { return x.status === 'rejected'; }).length;
        var bits = [];
        if (stamps.length) bits.push('stamped ✓ for ' + stamps.length + ' student(s)');
        if (revokes.length) bits.push('removed the ✓ from ' + revokes.length + ' student(s) no longer in ' + s.title + ' (they can retake it)');
        return 'Synced with ' + s.title + '’s own records: ' + bits.join(' · ') +
          (already ? ' · ' + already + ' already matched' : '') +
          (cancelled ? ' · ' + cancelled + ' removal(s) cancelled' : '') +
          (failed ? ' · ⚠ ' + failed + ' write(s) FAILED — click Verify again' : '') + tail +
          ' — the roster and the students’ own pages update live.';
      });
    });
  }
  /* One button per ACTIVE verifiable simulation, rebuilt on every roster
     render — which is also what a config change triggers, so ticking a
     simulation Active (or off) adds/removes its button by itself. */
  function renderVerifyButtons() {
    var box = $('verify-btns');
    if (!box) return;
    box.innerHTML = '';
    if (!roster.length) return;
    verifiableSims().forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = '⟲ Verify from ' + s.title;
      b.title = 'Reconcile the ' + s.title + ' column against that simulation’s own records — matched on ' +
        ((s.verify && s.verify.idNote) || 'the university student ID') +
        '. Read-only there; only this roster is updated.';
      b.onclick = function () {
        $('verify-note').textContent = 'Reading ' + s.title + '’s records…';
        b.disabled = true;
        verifyFromSim(s).then(function (msg) {
          $('verify-note').textContent = msg;
        }, function (e) {
          $('verify-note').textContent = 'Verify from ' + s.title + ' failed: ' + ((e && e.message) || e);
        }).then(function () { b.disabled = false; });
      };
      box.appendChild(b);
    });
  }

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
