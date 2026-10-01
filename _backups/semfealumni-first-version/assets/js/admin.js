/* SEMFE Alumni: the admin page. Lists every membership application, lets an
 * admin approve / reject / reset it, record the year's dues, delete it, and
 * export the list (CSV) or copy the e-mail addresses of those who asked for
 * the newsletter or job announcements.
 * Who is an admin is decided by isAdmin() in firestore.rules; ADMIN_EMAILS in
 * config.js only decides whether this page tries. */
(function () {
  'use strict';
  var A = window.SemfeAuth;
  var app = document.getElementById('admin-app');
  if (!A || !app) return;
  var esc = A.esc, db = null, FV = null, unsub = null, all = [], filter = 'pending', query = '', me = null, keepFocus = null;
  var YEAR = new Date().getFullYear();
  var STAGES = { graduate: 'Απόφοιτος', 'final-year': 'Τελειόφοιτος', faculty: 'ΔΕΠ' };
  var STATUS = { pending: ['warn', 'Σε αναμονή'], active: ['ok', 'Ενεργό μέλος'], rejected: ['err', 'Απορρίφθηκε'] };

  function html(s) { app.innerHTML = s; }
  A.onChange(function (u) {
    me = u;
    if (unsub) { unsub(); unsub = null; }
    if (!A.configured) return html('<div class="notice warn"><strong>Η σύνδεση μελών δεν έχει ενεργοποιηθεί ακόμα.</strong><p>Δείτε το FIREBASE-SETUP.md.</p></div>');
    if (!u) {
      html('<div class="panel" style="max-width:640px"><h2>Μόνο για διαχειριστές</h2><p>Συνδεθείτε με τον λογαριασμό διαχειριστή.</p><button type="button" class="btn btn-primary" data-open>Σύνδεση</button></div>');
      app.querySelector('[data-open]').addEventListener('click', function (e) { A.open('signin', e.currentTarget); });
      return;
    }
    if (!A.isAdmin(u)) {
      return html('<div class="notice err"><strong>Δεν έχετε πρόσβαση σε αυτή τη σελίδα.</strong><p>Είστε συνδεδεμένος/η ως ' + esc(u.email || A.displayName(u)) +
        (u.email && !u.emailVerified ? ' (το e-mail δεν έχει επιβεβαιωθεί)' : '') + '. Η σελίδα είναι μόνο για τους διαχειριστές του μητρώου μελών.</p></div>');
    }
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση αιτήσεων…</div>');
    A.db().then(function (d) {
      db = d; FV = firebase.firestore.FieldValue;
      unsub = db.collection('members').onSnapshot(function (qs) {
        all = [];
        qs.forEach(function (doc) { var x = doc.data(); x.id = doc.id; all.push(x); });
        all.sort(function (a, b) { return ts(b.createdAt) - ts(a.createdAt); });
        render();
      }, function (e) {
        html('<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση</strong><p>' + esc(A.friendly(e)) + '</p><p>Αν μόλις ρυθμίσατε το Firebase, βεβαιωθείτε ότι δημοσιεύσατε το firestore.rules και ότι το ' + esc(u.email) + ' υπάρχει και στο isAdmin() των κανόνων.</p></div>');
      });
    }, function (e) { html('<div class="notice err"><p>' + esc(A.friendly(e)) + '</p></div>'); });
  });

  function ts(t) { return t && t.toMillis ? t.toMillis() : 0; }
  function date(t) { var ms = ts(t); if (!ms) return ''; var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fold(s) { s = String(s || '').toLowerCase(); if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); return s.replace(/ς/g, 'σ'); }
  function visible() {
    var q = fold(query);
    return all.filter(function (m) {
      if (filter !== 'all' && (m.status || 'pending') !== filter) return false;
      return !q || fold([m.firstName, m.lastName, m.email, m.employer, m.city, m.gradYear, m.phone].join(' ')).indexOf(q) !== -1;
    });
  }

  /* Every change redraws the page, and a redraw would drop keyboard focus on
     <body>. So note what had focus and put it back on the same control, or on
     the nearest one left when that control is gone (an approved row leaves
     the "pending" list, for example). */
  function focusKey() {
    var el = document.activeElement;
    if (!el || el === document.body || !app.contains(el)) return null;
    var tr = el.closest ? el.closest('tr[data-id]') : null, rows = app.querySelectorAll('tr[data-id]');
    return {
      sel: el.id ? '#' + el.id
        : el.hasAttribute('data-filter') ? '[data-filter="' + el.getAttribute('data-filter') + '"]'
        : el.hasAttribute('data-copy') ? '[data-copy="' + el.getAttribute('data-copy') + '"]'
        : el.hasAttribute('data-csv') ? '[data-csv]'
        : null,
      id: tr ? tr.getAttribute('data-id') : null,
      act: el.getAttribute('data-act'),
      row: tr ? Array.prototype.indexOf.call(rows, tr) : -1,
      pos: el.id === 'adm-q' ? el.selectionStart : null
    };
  }
  function restoreFocus(k) {
    if (!k) return;
    var el = null;
    if (k.sel) el = app.querySelector(k.sel);
    if (!el && k.id) {
      var tr = app.querySelector('tr[data-id="' + cssEsc(k.id) + '"]');
      if (tr) el = tr.querySelector('[data-act="' + k.act + '"]') || tr.querySelector('button');
      if (!el) {
        var rows = app.querySelectorAll('tr[data-id]');
        var next = rows[Math.min(k.row, rows.length - 1)];
        el = next ? next.querySelector('button') : app.querySelector('[data-filter][aria-pressed="true"]');
      }
    }
    if (!el) return;
    el.focus();
    if (k.pos != null) try { el.setSelectionRange(k.pos, k.pos); } catch (e) {}
  }
  function cssEsc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); }

  /* The frame (filters, search box, buttons) is built ONCE and only the
     figures and the table are redrawn. Rebuilding the search box on every
     keystroke would break typing with an input method (Android keyboards,
     the Greek accent key), which composes a word across several events. */
  function render() {
    var keep = focusKey() || keepFocus;
    keepFocus = null;
    if (!app.querySelector('[data-admin-frame]')) buildFrame();
    var count = function (st) { return all.filter(function (m) { return (m.status || 'pending') === st; }).length; };
    var paidNow = all.filter(function (m) { return m.status === 'active' && (m.duesYears || []).indexOf(YEAR) !== -1; }).length;
    var list = visible();
    app.querySelector('[data-tiles]').innerHTML =
      tile(all.length, 'Αιτήσεις συνολικά') + tile(count('pending'), 'Σε αναμονή') + tile(count('active'), 'Ενεργά μέλη') + tile(paidNow, 'Συνδρομή ' + YEAR);
    app.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(filter === b.getAttribute('data-filter'))); });
    app.querySelector('[data-csv]').textContent = 'Εξαγωγή CSV (' + list.length + ')';
    app.querySelector('[data-list]').innerHTML = !list.length ? '<p class="muted">Καμία αίτηση σε αυτή την κατηγορία.</p>'
      : '<div class="table-wrap"><table class="data stack"><thead><tr><th>Μέλος</th><th>Κατάσταση</th><th>ΣΕΜΦΕ</th><th>Εργασία</th><th>Αίτηση</th><th>Συνδρομές</th><th>Ενέργειες</th></tr></thead><tbody>' +
        list.map(row).join('') + '</tbody></table></div>';
    wireRows();
    // focus inside the frame (search box, filters, buttons) was never lost; only rows are redrawn
    if (keep && keep.id) restoreFocus(keep);
  }
  function buildFrame() {
    html('<div data-admin-frame><div class="tiles" data-tiles></div>' +
      '<div class="dir-tools">' +
      '<div class="filters" role="group" aria-label="Κατάσταση" style="margin:0">' +
      [['pending', 'Σε αναμονή'], ['active', 'Ενεργά'], ['rejected', 'Απορρίφθηκαν'], ['all', 'Όλες']].map(function (f) {
        return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="adm-q" class="sr-only">Αναζήτηση</label><input id="adm-q" type="search" placeholder="Αναζήτηση: όνομα, e-mail, εργοδότης…" value="' + esc(query) + '"></div></div>' +
      '<div class="section-foot" style="margin:0 0 16px">' +
      '<button type="button" class="btn btn-outline btn-sm" data-csv>Εξαγωγή CSV</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-copy="consentNewsletter">Αντιγραφή e-mail: newsletter</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-copy="consentJobs">Αντιγραφή e-mail: θέσεις εργασίας</button>' +
      '<span class="form-ok" data-msg role="status"></span></div>' +
      '<div data-list></div></div>');
    wireFrame();
  }
  function tile(v, l) { return '<div class="tile"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function row(m) {
    var st = STATUS[m.status || 'pending'] || STATUS.pending, years = (m.duesYears || []).slice().sort();
    var li = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(m.linkedin || '') ? m.linkedin : '';
    var paid = years.indexOf(YEAR) !== -1;
    return '<tr data-id="' + esc(m.id) + '">' +
      '<td data-label="Μέλος"><strong>' + esc(m.firstName + ' ' + m.lastName) + '</strong><br><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' + (m.phone ? '<br>' + esc(m.phone) : '') +
      (li ? '<br><a href="' + esc(li) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') + (m.note ? '<br><em class="muted">«' + esc(m.note) + '»</em>' : '') + '</td>' +
      '<td data-label="Κατάσταση"><span class="badge ' + st[0] + '">' + st[1] + '</span>' + (m.reviewedBy ? '<br><small class="muted">' + esc(m.reviewedBy) + ' ' + date(m.reviewedAt) + '</small>' : '') + '</td>' +
      '<td data-label="ΣΕΜΦΕ">' + esc(STAGES[m.stage] || m.stage || '') + (m.entryYear ? '<br>Εισ. ' + esc(m.entryYear) : '') + (m.gradYear ? '<br>Αποφ. ' + esc(m.gradYear) : '') + (m.direction ? '<br>' + esc(m.direction) : '') + '</td>' +
      '<td data-label="Εργασία">' + ([esc([m.position, m.employer].filter(Boolean).join(', ')), m.city ? '<span class="muted">' + esc(m.city) + '</span>' : '']
        .filter(Boolean).join('<br>') || '—') + '</td>' +
      '<td data-label="Αίτηση">' + date(m.createdAt) + '<br><small class="muted">' + esc(String(m.provider || '').replace('.com', '')) + '</small></td>' +
      '<td data-label="Συνδρομές">' + (years.length ? esc(years.join(', ')) : '—') + '</td>' +
      '<td class="acts" data-label="Ενέργειες"><div class="acts-in">' +
      (m.status !== 'active' ? '<button type="button" class="btn btn-dark btn-sm" data-act="approve">Έγκριση</button> ' : '') +
      '<button type="button" class="btn btn-outline btn-sm" data-act="dues" aria-pressed="' + paid + '">' + (paid ? '✓ Πλήρωσε ' + YEAR : 'Πλήρωσε ' + YEAR) + '</button> ' +
      (m.status !== 'rejected' ? '<button type="button" class="btn btn-outline btn-sm" data-act="reject">Απόρριψη</button> ' : '') +
      (m.status !== 'pending' ? '<button type="button" class="btn btn-outline btn-sm" data-act="pending">Σε αναμονή</button> ' : '') +
      '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Διαγραφή</button></div></td></tr>';
  }

  function wireFrame() {
    var msg = app.querySelector('[data-msg]');
    app.querySelectorAll('[data-filter]').forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-filter'); render(); }); });
    var q = app.querySelector('#adm-q');
    q.addEventListener('input', function () { query = q.value; render(); });
    app.querySelector('[data-csv]').addEventListener('click', function () { downloadCsv(visible()); });
    app.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-copy');
        var emails = all.filter(function (m) { return m.status === 'active' && m[key]; }).map(function (m) { return m.email; });
        window.SEMFE_UTIL.copyText(emails.join(', '), function (ok) {
          msg.className = ok ? 'form-ok' : 'form-error';
          msg.textContent = ok ? 'Αντιγράφηκαν ' + emails.length + ' διευθύνσεις (ενεργά μέλη). Επικολλήστε τις στο πεδίο Bcc.' : 'Η αντιγραφή απέτυχε.';
        });
      });
    });
  }
  function wireRows() {
    app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.closest('tr').getAttribute('data-id'), m = all.filter(function (x) { return x.id === id; })[0];
        if (m) act(b.getAttribute('data-act'), m, b);
      });
    });
  }

  function act(kind, m, btn) {
    var ref = db.collection('members').doc(m.id), who = m.firstName + ' ' + m.lastName;
    var stamp = { reviewedAt: FV.serverTimestamp(), reviewedBy: me.email };
    var job;
    if (kind === 'approve') job = ref.update(merge({ status: 'active' }, stamp));
    else if (kind === 'pending' || kind === 'reject') {
      if (kind === 'reject' && !window.confirm('Απόρριψη της αίτησης του/της ' + who + ';')) return;
      job = ref.update(merge({ status: kind === 'reject' ? 'rejected' : 'pending' }, stamp))
        .then(function () { return db.collection('directory').doc(m.id).delete(); });
    } else if (kind === 'dues') {
      var paid = (m.duesYears || []).indexOf(YEAR) !== -1;
      job = ref.update(merge({ duesYears: paid ? FV.arrayRemove(YEAR) : FV.arrayUnion(YEAR) }, stamp));
    } else if (kind === 'delete') {
      if (!window.confirm('Οριστική διαγραφή της αίτησης του/της ' + who + ';\n\nΟ λογαριασμός σύνδεσης παραμένει· διαγράφεται από Firebase console > Authentication.')) return;
      job = db.collection('directory').doc(m.id).delete().catch(function () {}).then(function () { return ref.delete(); });
    }
    if (!job) return;
    keepFocus = focusKey();        // disabling the focused button drops focus: remember it first
    btn.disabled = true;
    job.catch(function (e) { btn.disabled = false; window.alert(A.friendly(e)); });
  }
  function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }

  function downloadCsv(list) {
    var cols = [['firstName', 'Όνομα'], ['lastName', 'Επώνυμο'], ['email', 'E-mail'], ['phone', 'Τηλέφωνο'], ['status', 'Κατάσταση'], ['stage', 'Ιδιότητα'],
      ['entryYear', 'Εισαγωγή'], ['gradYear', 'Αποφοίτηση'], ['direction', 'Κατεύθυνση'], ['position', 'Θέση'], ['employer', 'Εργοδότης'], ['city', 'Πόλη'],
      ['linkedin', 'LinkedIn'], ['duesYears', 'Συνδρομές'], ['consentNewsletter', 'Newsletter'], ['consentJobs', 'Θέσεις εργασίας'],
      ['consentDirectory', 'Κατάλογος'], ['note', 'Σημείωση'], ['createdAt', 'Αίτηση'], ['provider', 'Σύνδεση']];
    var cell = function (v) {
      if (v && v.toMillis) v = new Date(v.toMillis()).toISOString().slice(0, 10);
      if (Array.isArray(v)) v = v.join(' ');
      if (typeof v === 'boolean') v = v ? 'ναι' : 'όχι';
      v = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;           // stop spreadsheet formula injection
      return '"' + v.replace(/"/g, '""') + '"';
    };
    var csv = '﻿' + cols.map(function (c) { return cell(c[1]); }).join(',') + '\r\n' +
      list.map(function (m) { return cols.map(function (c) { return cell(m[c[0]]); }).join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'semfe-members-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
  }
})();
