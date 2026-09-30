/* SEMFE Alumni: the members-only page. Shows the signed-in person's
 * membership and, for ACTIVE members (and admins), the directory of members
 * who chose to be listed. firestore.rules refuses the directory to anyone
 * else, whatever this page does. */
(function () {
  'use strict';
  var A = window.SemfeAuth, C = window.SEMFE || {};
  var app = document.getElementById('members-app');
  if (!A || !app) return;
  var esc = A.esc, YEAR = new Date().getFullYear(), rows = [];

  function html(s) { app.innerHTML = s; }
  function locked(title, body, actions) {
    html('<div class="panel" style="max-width:720px"><span class="lock-ic">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>' +
      '<h2 style="margin-top:14px">' + title + '</h2>' + body + (actions ? '<div class="section-foot" style="margin-top:8px">' + actions + '</div>' : '') + '</div>');
    app.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function (e) { A.open(b.getAttribute('data-open'), e.currentTarget); }); });
  }

  A.onChange(function (u) {
    if (!A.configured) {
      return locked('Η περιοχή μελών ανοίγει σύντομα', '<p>Μόλις ενεργοποιηθεί η σύνδεση μελών, τα ενεργά μέλη του Συλλόγου θα βλέπουν εδώ την ιδιότητά τους και τον κατάλογο μελών.</p>',
        '<a class="btn btn-dark" href="' + A.root + 'support/#eggrafi">Πώς γίνομαι μέλος</a>');
    }
    if (!u) {
      return locked('Μόνο για μέλη', '<p>Συνδεθείτε για να δείτε την περιοχή μελών. Αν δεν έχετε λογαριασμό, δημιουργήστε έναν και κάντε αίτηση μέλους.</p>',
        '<button type="button" class="btn btn-primary" data-open="signin">Σύνδεση</button><button type="button" class="btn btn-outline" data-open="register">Νέος λογαριασμός</button>');
    }
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση…</div>');
    var db;
    A.db().then(function (d) { db = d; return db.collection('members').doc(u.uid).get(); }).then(function (snap) {
      var m = snap.exists ? snap.data() : null, admin = A.isAdmin(u);
      if (!admin && !m) {
        return locked('Δεν έχετε κάνει ακόμα αίτηση μέλους', '<p>Η περιοχή μελών είναι για τα ενεργά μέλη του Συλλόγου. Συμπληρώστε την αίτηση μέλους από τον λογαριασμό σας.</p>',
          '<a class="btn btn-primary" href="' + A.root + 'account/#apply">Αίτηση μέλους</a>');
      }
      if (!admin && m.status !== 'active') {
        var faculty = m.stage === 'faculty';
        return locked(m.status === 'rejected' ? 'Η αίτησή σας δεν εγκρίθηκε' : 'Η αίτησή σας εκκρεμεί',
          m.status === 'rejected'
            ? '<p>Για οποιαδήποτε απορία <a href="' + A.root + 'contact/">επικοινωνήστε μαζί μας</a>.</p>'
            : faculty
              ? '<p>Η περιοχή μελών ανοίγει μόλις επιβεβαιώσουμε την ιδιότητά σας ως μέλους ΔΕΠ ΣΕΜΦΕ. Δεν χρειάζεται συνδρομή.</p>'
              : '<p>Η περιοχή μελών ανοίγει μόλις ενεργοποιηθεί η ιδιότητά σας: αφού ελέγξουμε τα στοιχεία σας και λάβουμε τη συνδρομή των ' + esc(C.annualFee || 10) + '€.</p>',
          '<a class="btn btn-dark" href="' + A.root + 'account/">Ο λογαριασμός μου</a>' +
          (faculty || m.status === 'rejected' ? '' : '<a class="btn btn-outline" href="' + A.root + 'support/#katathesi">Τρόποι πληρωμής</a>'));
      }
      // asked to be listed when applying and now active: list them once (account.js does the same)
      var listSelf = m && m.status === 'active' && m.consentDirectory
        ? db.collection('directory').doc(u.uid).get().then(function (ds) {
            if (ds.exists) return;
            return db.collection('directory').doc(u.uid).set({
              name: m.firstName + ' ' + m.lastName, gradYear: m.gradYear || null,
              direction: m.direction || '', employer: m.employer || '', position: m.position || '',
              city: m.city || '', linkedin: m.linkedin || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }).catch(function () {})
        : Promise.resolve();
      return listSelf.then(function () { return db.collection('directory').get(); }).then(function (qs) {
        rows = [];
        qs.forEach(function (d) { var x = d.data(); x.id = d.id; rows.push(x); });
        rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'el'); });
        renderArea(u, m, admin);
      });
    }).catch(function (e) {
      html('<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση</strong><p>' + esc(A.friendly(e)) + '</p></div>');
    });
  });

  function renderArea(u, m, admin) {
    var paid = m ? (m.duesYears || []).slice().sort() : [];
    var listed = rows.some(function (r) { return r.id === u.uid; });
    var s = '<div class="acct-grid"><div class="panel"><span class="eyebrow">Καλώς ήρθατε</span><h2>' + esc(m ? m.firstName + ' ' + m.lastName : A.displayName(u)) + '</h2>' +
      (m && m.status === 'active' && m.stage === 'faculty'
        ? '<p><span class="badge ok">Πρόσβαση μέλους</span></p><p class="muted">Μέλος ΔΕΠ ΣΕΜΦΕ.</p>'
        : m && m.status === 'active'
        ? '<p><span class="badge ok">Ενεργό μέλος</span></p><p class="muted">' + (paid.length ? 'Συνδρομές: ' + esc(paid.join(', ')) + '.' : 'Δεν έχει καταγραφεί ακόμα συνδρομή.') +
          (paid.indexOf(YEAR) === -1 ? ' <a href="' + A.root + 'support/#katathesi">Συνδρομή ' + YEAR + '</a>.' : ' Η συνδρομή ' + YEAR + ' είναι τακτοποιημένη ✓') + '</p>'
        : '<p><span class="badge muted">Διαχειριστής</span></p>') +
      '</div><div class="panel"><h2 style="font-size:1.1rem">Για τα μέλη</h2><ul class="checklist">' +
      '<li>Οι ανακοινώσεις θέσεων εργασίας και πρακτικής άσκησης στέλνονται με e-mail σε όσους το επέλεξαν στην αίτησή τους.</li>' +
      '<li>Οι προσκλήσεις στις Γενικές Συνελεύσεις ανακοινώνονται δέκα ημέρες πριν από τη σύγκλησή τους.</li>' +
      '<li><a href="' + A.root + 'assets/docs/foundation/katastatiko.pdf" target="_blank" rel="noopener">Το Καταστατικό</a> και οι <a href="' + A.root + 'archive/">οικονομικοί απολογισμοί</a>.</li></ul>' +
      (m ? '<p style="margin:12px 0 0"><a href="' + A.root + 'account/">' + (listed ? 'Αλλαγή της καταχώρισής μου' : 'Εμφάνιση στον κατάλογο') + '</a></p>' : '') + '</div></div>';
    s += '<div style="margin-top:28px"><div class="section-head" style="margin-bottom:18px"><span class="eyebrow">Κατάλογος μελών</span><h2>Το δίκτυο των αποφοίτων</h2>' +
      '<p>' + rows.length + ' μέλη έχουν επιλέξει να εμφανίζονται εδώ. Ο κατάλογος είναι ορατός μόνο σε ενεργά μέλη.</p></div>' +
      '<div class="dir-tools"><div class="field"><label for="dir-q" class="sr-only">Αναζήτηση</label><input id="dir-q" type="search" placeholder="Αναζήτηση: όνομα, εργοδότης, πόλη, έτος…" autocomplete="off"></div></div>' +
      '<div class="dir" id="dir-list"></div><p class="muted" id="dir-empty" hidden>Δεν βρέθηκαν μέλη.</p></div>';
    html(s);
    var input = document.getElementById('dir-q');
    var draw = function () {
      var q = fold(input.value);
      var list = rows.filter(function (r) {
        return !q || fold([r.name, r.employer, r.position, r.city, r.direction, r.gradYear].join(' ')).indexOf(q) !== -1;
      });
      document.getElementById('dir-list').innerHTML = list.map(card).join('');
      document.getElementById('dir-empty').hidden = list.length > 0;
    };
    input.addEventListener('input', draw);
    draw();
  }
  function card(r) {
    var li = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(r.linkedin || '') ? r.linkedin : '';
    return '<div class="card"><h3>' + esc(r.name) + '</h3>' +
      '<p class="muted" style="margin:0 0 6px">' + esc([r.gradYear ? 'Απόφοιτος ' + r.gradYear : '', r.direction].filter(Boolean).join(' · ')) + '</p>' +
      (r.position || r.employer ? '<p style="margin:0">' + esc([r.position, r.employer].filter(Boolean).join(', ')) + '</p>' : '') +
      (r.city ? '<p class="muted" style="margin:4px 0 0">' + esc(r.city) + '</p>' : '') +
      (li ? '<p style="margin:10px 0 0"><a class="linkedin-btn" href="' + esc(li) + '" target="_blank" rel="noopener">LinkedIn</a></p>' : '') + '</div>';
  }
  /* case- and accent-insensitive search, so "καραλης" finds "Κάραλης" */
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/ς/g, 'σ');
  }
})();
