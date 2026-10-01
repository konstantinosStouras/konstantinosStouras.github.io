/* SEMFE Alumni: the "Ο λογαριασμός μου" page.
 * Signed out: sign-in / register buttons. Signed in: the membership
 * application (members/{uid}), its status, the directory listing
 * (directory/{uid}), linked sign-in methods and account deletion.
 * Every write here must satisfy firestore.rules; the field names and types
 * below are the ones those rules check (tools/rules-test/ tests exactly these).
 *
 * The page is redrawn from state on every change (the members/{uid} listener
 * fires on our own writes too, and again when their server time resolves), so
 * every redraw first saves what is on screen and puts it back: whatever is
 * typed in the form (draft), the half-filled delete box, and keyboard focus.
 * Messages live in module state (formErr, dirMsg) and are also announced. */
(function () {
  'use strict';
  var A = window.SemfeAuth, C = window.SEMFE || {}, U = window.SEMFE_UTIL || {};
  var app = document.getElementById('account-app');
  if (!A || !app) return;
  var esc = A.esc, FV = null, db = null, unsub = null, user = null, member = null, dirEntry = null;
  var editing = false, deleted = false, autoDirTried = false, linked = [];
  var draft = null, formErr = '', dirMsg = null, refocus = null, applyScrolled = false, deleteShown = false, delBox = null;
  var YEAR = new Date().getFullYear();
  var STAGES = { graduate: 'Απόφοιτος/η ΣΕΜΦΕ', 'final-year': 'Τελειόφοιτος/η ΣΕΜΦΕ', faculty: 'Μέλος ΔΕΠ ΣΕΜΦΕ' };
  var DIRECTIONS = ['Εφαρμοσμένα Μαθηματικά', 'Εφαρμοσμένη Φυσική', 'Άλλη / δεν ισχύει'];

  function html(s) { app.innerHTML = s; }
  function isFaculty(m) { return !!m && m.stage === 'faculty'; }
  function statusBadge(m) {
    if (!m) return '<span class="badge muted">Χωρίς αίτηση</span>';
    if (m.status === 'active') return '<span class="badge ok">' + (isFaculty(m) ? 'Πρόσβαση μέλους' : 'Ενεργό μέλος') + '</span>';
    if (m.status === 'rejected') return '<span class="badge err">Η αίτηση δεν εγκρίθηκε</span>';
    return '<span class="badge warn">Η αίτηση εκκρεμεί</span>';
  }

  A.onChange(function (u) {
    user = u;
    if (unsub) { unsub(); unsub = null; }
    member = null; dirEntry = null; editing = false; draft = null; formErr = ''; dirMsg = null; refocus = null;
    autoDirTried = false; delBox = null;
    linked = u ? A.providers(u) : [];
    if (deleted) {                  // keep the "account deleted" message on screen…
      if (!u) return;
      deleted = false;              // …until someone signs in again on this page
    }
    if (!A.configured) return renderOffline();
    if (!u) return renderSignedOut();
    html('<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση του λογαριασμού σας…</div>');
    // LinkedIn connected through the Cloud Function shows up only in the token's claims
    A.providersAsync(u).then(function (l) {
      if (l.join() !== linked.join()) { linked = l; if (user === u && app.querySelector('.linked')) render(); }
    });
    A.db().then(function (d) {
      db = d; FV = firebase.firestore.FieldValue;
      unsub = db.collection('members').doc(u.uid).onSnapshot(function (snap) {
        member = snap.exists ? snap.data() : null;
        if (member && member.status === 'active') {
          db.collection('directory').doc(u.uid).get().then(function (ds) {
            dirEntry = ds.exists ? ds.data() : null;
            // asked to be listed when applying, and has just been approved: list them once
            if (!dirEntry && member.consentDirectory && !autoDirTried) {
              autoDirTried = true;
              return writeDirectory().then(render, render);
            }
            render();
          }, function () { dirEntry = null; render(); });
        } else { dirEntry = null; render(); }
      }, function (e) { renderError(e); });
    }, renderError);
  });

  function renderOffline() {
    html('<div class="panel"><h2>Η σύνδεση μελών ανοίγει σύντομα</h2>' +
      '<p>Σύντομα θα μπορείτε να δημιουργήσετε λογαριασμό με <strong>Google, Facebook, LinkedIn ή e-mail</strong>, να κάνετε την αίτηση μέλους από εδώ και να μπαίνετε στην περιοχή μελών.</p>' +
      '<p>Μέχρι τότε, μπορείτε να κάνετε αίτηση μέσω της ηλεκτρονικής φόρμας.</p>' +
      '<div class="section-foot" style="margin-top:8px"><a class="btn btn-dark" href="' + esc(C.legacyApplyFormUrl) + '" target="_blank" rel="noopener">Ηλεκτρονική φόρμα αίτησης</a><a class="btn btn-outline" href="' + A.root + 'support/#eggrafi">Πώς γίνομαι μέλος</a></div></div>');
  }
  function renderSignedOut() {
    html('<div class="acct-grid"><div class="panel"><h2>Συνδεθείτε ή δημιουργήστε λογαριασμό</h2>' +
      '<p>Με τον λογαριασμό σας κάνετε την <strong>αίτηση μέλους</strong>, βλέπετε την κατάσταση της εγγραφής και της συνδρομής σας και μπαίνετε στην <strong>περιοχή μελών</strong>.</p>' +
      '<p>Συνδεθείτε με <strong>Google, Facebook, LinkedIn</strong> ή με <strong>e-mail και κωδικό</strong>.</p>' +
      '<div class="section-foot" style="margin-top:8px"><button type="button" class="btn btn-primary" data-open="register">Νέος λογαριασμός</button><button type="button" class="btn btn-outline" data-open="signin">Έχω ήδη λογαριασμό</button></div></div>' +
      '<div class="panel"><h2 style="font-size:1.1rem">Γιατί λογαριασμός;</h2><ul class="checklist">' +
      '<li>Αίτηση μέλους χωρίς χαρτιά, σε δύο λεπτά</li><li>Βλέπετε πότε ενεργοποιείται η ιδιότητά σας</li>' +
      '<li>Πρόσβαση στον κατάλογο μελών (αν το επιθυμείτε)</li><li>Διαγράφετε τα στοιχεία σας όποτε θέλετε</li></ul></div></div>');
    Array.prototype.forEach.call(app.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { A.open(b.getAttribute('data-open'), b); });
    });
    if (/register|apply/.test(location.hash)) A.open('register');
    else if (/signin/.test(location.hash)) A.open('signin');
  }
  function renderError(e) {
    html('<div class="notice err"><strong>Δεν ήταν δυνατή η φόρτωση</strong><p>' + esc(A.friendly(e)) + '</p></div>');
  }

  /* an e-mail + password account with nothing else linked must confirm its
     address before applying (firestore.rules emailConfirmed() agrees) */
  function needsEmailCheck() {
    return user && !user.emailVerified && (user.providerData || []).some(function (p) { return p.providerId === 'password'; })
      && !(user.providerData || []).some(function (p) { return p.providerId !== 'password'; });
  }
  /* connecting another sign-in method needs a proven address: otherwise
     someone could register with another person's e-mail, never confirm it,
     attach their own Google/Facebook/LinkedIn, and keep a way in after the
     real owner takes the address back (functions/linkedin.js refuses LinkedIn
     outright in that case) */
  function linkNeedsVerifiedEmail() {
    return !!(user && user.email && !user.emailVerified);
  }

  /* what has keyboard focus, as a selector that finds its replacement after a
     redraw (and the panel it was in, for when the control itself is gone) */
  function focusKey() {
    var el = document.activeElement;
    if (!el || el === document.body || !app.contains(el)) return null;
    var attrs = ['data-dir', 'data-edit', 'data-cancel', 'data-verified', 'data-resend', 'data-send-verify', 'data-verified-li',
      'data-reset', 'data-signout', 'data-del-open', 'data-del-go'], sel = el.id ? '#' + el.id : null;
    for (var i = 0; !sel && i < attrs.length; i++) if (el.hasAttribute(attrs[i])) sel = '[' + attrs[i] + ']';
    if (!sel && el.hasAttribute('data-link')) sel = '[data-link="' + el.getAttribute('data-link') + '"]';
    if (!sel && el.type === 'submit') sel = '#apply [type=submit]';
    var panel = el.closest ? el.closest('.panel[id]') : null, caret = null;
    try { if (typeof el.selectionStart === 'number') caret = [el.selectionStart, el.selectionEnd, el.selectionDirection || 'none']; } catch (e) {}
    return { sel: sel, panel: panel ? '#' + panel.id : null, caret: caret };
  }
  function restoreFocus(k) {
    if (!k) return;
    if (typeof k === 'string') k = { sel: k };
    var el = (k.sel && app.querySelector(k.sel)) || (k.panel && app.querySelector(k.panel + ' h2'));
    if (el && el.hidden) el = k.panel && app.querySelector(k.panel + ' h2');
    if (!el) return;
    try { el.focus(); } catch (e) {}
    // the new field starts with the caret at 0: put it (and any selection) back where it was
    if (k.caret) try { el.setSelectionRange(k.caret[0], k.caret[1], k.caret[2]); } catch (e) {}
  }
  /* the form's fields exactly as typed (so a redraw can put them back) */
  function formValues(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return o;
  }

  function render(fresh) {
    // keep what is on screen: a redraw must never lose typing or focus
    var keep = refocus || focusKey();
    refocus = null;
    var form = app.querySelector('form[data-apply]');
    if (form && !fresh) draft = formValues(form);
    var del = app.querySelector('[data-del-box]');
    if (del && !del.hidden) delBox = { confirm: (app.querySelector('#del-confirm') || {}).value || '', pass: (app.querySelector('#del-pass') || {}).value || '' };
    else if (del) delBox = null;
    var name = A.displayName(user);
    var s = '<div class="panel profile-head">' + A.avatarHtml(name, user.photoURL, 'avatar-lg') +
      '<div class="who"><strong>' + esc(name) + '</strong><span class="muted">' + esc(user.email || '') + '</span></div>' + statusBadge(member) + '</div>';

    if (needsEmailCheck()) {
      s += '<div class="notice warn" style="margin-top:18px"><strong>Επιβεβαιώστε το e-mail σας</strong>' +
        '<p>Σας στείλαμε e-mail στο ' + esc(user.email) + '. Πατήστε τον σύνδεσμο που περιέχει (δείτε και τα ανεπιθύμητα) και μετά το «Το επιβεβαίωσα». Χωρίς επιβεβαίωση δεν μπορείτε να υποβάλετε αίτηση μέλους.</p>' +
        '<p class="section-foot" style="margin:0"><button type="button" class="btn btn-dark btn-sm" data-verified>Το επιβεβαίωσα</button><button type="button" class="btn btn-outline btn-sm" data-resend>Αποστολή ξανά</button></p>' +
        '<p class="form-ok" data-verify-msg role="status" style="margin:8px 0 0"></p></div>';
    }

    s += '<div class="acct-grid" style="margin-top:18px"><div>';
    s += membershipPanel();
    s += '</div><div>';
    s += methodsPanel();
    s += dangerPanel();
    s += '</div></div>';
    html(s);
    wire();
    if (delBox) {
      app.querySelector('[data-del-box]').hidden = false;
      app.querySelector('[data-del-open]').hidden = true;
      app.querySelector('#del-confirm').value = delBox.confirm;
      if (app.querySelector('#del-pass')) app.querySelector('#del-pass').value = delBox.pass || '';   // kept in memory only, never stored
    }
    restoreFocus(keep);
    // arriving at account/#apply (straight after registering): show the form, once
    if (/apply/.test(location.hash) && !member && !applyScrolled) {
      applyScrolled = true;
      var f = document.getElementById('apply'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'start' });
    }
    // arriving at account/#delete (from the data-deletion page): the panel is drawn only now,
    // after the browser's own jump to the fragment, so go there once ourselves
    if (/^#delete$/.test(location.hash) && !deleteShown) {
      deleteShown = true;
      var dh = app.querySelector('#delete h2');
      if (dh) { if (dh.scrollIntoView) dh.scrollIntoView({ block: 'start' }); try { dh.focus({ preventScroll: true }); } catch (e) { dh.focus(); } }
    }
  }
  function say(msg) { if (msg && U.announce) U.announce(msg); }

  function membershipPanel() {
    if (!member || editing || draft) return applyForm();
    var m = member, faculty = isFaculty(m), s = '<div class="panel" id="apply"><h2 tabindex="-1">Η ιδιότητα μέλους</h2>';
    if (m.status === 'active') {
      var paid = (m.duesYears || []).slice().sort();
      s += faculty
        ? '<div class="notice ok"><strong>Έχετε πρόσβαση στην περιοχή μελών.</strong><p>Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή.</p></div>'
        : '<div class="notice ok"><strong>Είστε ενεργό μέλος του Συλλόγου.</strong><p>' +
          esc(paid.length ? 'Συνδρομές που έχουμε καταγράψει: ' + paid.join(', ') + '.' : 'Δεν έχει καταγραφεί ακόμα συνδρομή.') +
          (paid.indexOf(YEAR) === -1 ? ' Η συνδρομή ' + YEAR + ' (' + esc(C.annualFee || 10) + '€) <a href="' + A.root + 'support/#katathesi">κατατίθεται εδώ</a>.' : '') + '</p></div>';
      s += '<p><a class="btn btn-dark" href="' + A.root + 'members/">Περιοχή μελών</a></p>' + directoryBox();
    } else if (m.status === 'rejected') {
      s += '<div class="notice err"><strong>Η αίτησή σας δεν εγκρίθηκε.</strong><p>' + (m.adminNote ? esc(m.adminNote) + ' ' : '') +
        'Για οποιαδήποτε απορία <a href="' + A.root + 'contact/">επικοινωνήστε μαζί μας</a>.</p></div>';
    } else if (faculty) {
      s += '<div class="notice warn"><strong>Λάβαμε το αίτημά σας.</strong><p>Ως μέλος ΔΕΠ ΣΕΜΦΕ δεν χρειάζεται συνδρομή. Μόλις επιβεβαιώσουμε την ιδιότητά σας, θα σας δώσουμε πρόσβαση στην περιοχή μελών και θα σας ενημερώσουμε με e-mail.</p></div>';
    } else {
      s += '<div class="notice warn"><strong>Λάβαμε την αίτησή σας.</strong><p>Επόμενο βήμα: καταθέστε τη συνδρομή των <strong>' + esc(C.annualFee || 10) + '€</strong> ' +
        '(<a href="' + A.root + 'support/#katathesi">τρόποι πληρωμής</a>) γράφοντας στην αιτιολογία το ονοματεπώνυμο, το e-mail σας και το έτος συνδρομής. ' +
        'Μόλις ελέγξουμε τα στοιχεία σας, η ιδιότητα μέλους ενεργοποιείται εδώ και θα σας ενημερώσουμε με e-mail.</p></div>';
    }
    s += '<dl class="kv" style="margin:18px 0">' +
      '<dt>Ονοματεπώνυμο</dt><dd>' + esc(m.firstName + ' ' + m.lastName) + '</dd>' +
      '<dt>E-mail</dt><dd>' + esc(m.email) + '</dd>' +
      (m.phone ? '<dt>Τηλέφωνο</dt><dd>' + esc(m.phone) + '</dd>' : '') +
      '<dt>Ιδιότητα</dt><dd>' + esc(STAGES[m.stage] || m.stage) + '</dd>' +
      (m.entryYear ? '<dt>Εισαγωγή</dt><dd>' + esc(m.entryYear) + '</dd>' : '') +
      (m.gradYear ? '<dt>Αποφοίτηση</dt><dd>' + esc(m.gradYear) + '</dd>' : '') +
      (m.direction ? '<dt>Κατεύθυνση</dt><dd>' + esc(m.direction) + '</dd>' : '') +
      (m.employer || m.position ? '<dt>Εργασία</dt><dd>' + esc([m.position, m.employer].filter(Boolean).join(', ')) + '</dd>' : '') +
      (m.city ? '<dt>Πόλη</dt><dd>' + esc(m.city) + '</dd>' : '') +
      (/^https:\/\//i.test(m.linkedin || '') ? '<dt>LinkedIn</dt><dd><a href="' + esc(m.linkedin) + '" target="_blank" rel="noopener">' + esc(m.linkedin.replace(/^https?:\/\/(www\.)?/, '')) + '</a></dd>' : '') +
      '<dt>Newsletter</dt><dd>' + (m.consentNewsletter ? 'Ναι' : 'Όχι') + '</dd>' +
      '<dt>Θέσεις εργασίας</dt><dd>' + (m.consentJobs ? 'Ναι' : 'Όχι') + '</dd>' +
      '</dl><button type="button" class="btn btn-outline" data-edit>Επεξεργασία στοιχείων</button></div>';
    return s;
  }

  function directoryBox() {
    return '<fieldset style="margin-top:18px"><legend>Κατάλογος μελών</legend>' +
      '<label class="check"><input type="checkbox" data-dir' + (dirEntry ? ' checked' : '') + '><span>Να εμφανίζομαι στον κατάλογο της περιοχής μελών (ονοματεπώνυμο, έτος αποφοίτησης, κατεύθυνση, εργασία, πόλη, LinkedIn). Τον βλέπουν μόνο ενεργά μέλη.</span></label>' +
      '<div class="' + (dirMsg ? dirMsg.cls : 'form-error') + '" data-dir-msg role="status">' + esc(dirMsg ? dirMsg.text : '') + '</div></fieldset>';
  }

  function field(id, label, value, opts) {
    opts = opts || {};
    var req = opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    var hintId = opts.hint ? 'f-' + id + '-hint' : '';
    var attrs = (opts.type ? ' type="' + opts.type + '"' : '') + (opts.auto ? ' autocomplete="' + opts.auto + '"' : '') +
      (opts.max ? ' maxlength="' + opts.max + '"' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
      (opts.required ? ' required aria-required="true"' : '') + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.readonly ? ' readonly' : '') + (hintId ? ' aria-describedby="' + hintId + '" data-hint="' + hintId + '"' : '');
    return '<div class="field"><label for="f-' + id + '">' + label + req + '</label><input id="f-' + id + '" name="' + id + '" value="' + esc(value == null ? '' : value) + '"' + attrs + '>' +
      (opts.hint ? '<span class="hint" id="' + hintId + '">' + opts.hint + '</span>' : '') + '</div>';
  }
  function select(id, label, value, options, required) {
    return '<div class="field"><label for="f-' + id + '">' + label + (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label><select id="f-' + id + '" name="' + id + '"' + (required ? ' required aria-required="true"' : '') + '>' +
      '<option value="">Επιλέξτε…</option>' + options.map(function (o) {
        var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1];
        return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select></div>';
  }
  function check(id, label, checked, required) {
    return '<label class="check"><input type="checkbox" id="f-' + id + '" name="' + id + '"' + (checked ? ' checked' : '') + (required ? ' required aria-required="true"' : '') + '><span>' + label + '</span></label>';
  }

  function applyForm() {
    var m = draft || member || {}, parts = String(user.displayName || '').trim().split(/\s+/);
    // once reviewed, the name is the vetted one (firestore.rules freezes it)
    var frozen = !!member && member.status !== 'pending';
    var first = frozen ? member.firstName : m.firstName != null ? m.firstName : (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
    var last = frozen ? member.lastName : m.lastName != null ? m.lastName : (parts.length > 1 ? parts[parts.length - 1] : '');
    var nameHint = frozen ? 'Για αλλαγή ονόματος <a href="' + A.root + 'contact/">επικοινωνήστε με τον Σύλλογο</a>.' : '';
    var blocked = needsEmailCheck();
    var msg = formErr || (blocked ? 'Επιβεβαιώστε πρώτα το e-mail σας (δείτε παραπάνω).' : '');
    var active = !!member && member.status === 'active';
    return '<div class="panel" id="apply"><h2 tabindex="-1">' + (member ? 'Επεξεργασία στοιχείων' : 'Αίτηση μέλους') + '</h2>' +
      (member ? '' : '<p class="muted intro">Συμπληρώστε τα στοιχεία σας. Τα πεδία με <span class="req">*</span> είναι υποχρεωτικά. Θα τα ελέγξουμε και θα ενεργοποιήσουμε την ιδιότητα μέλους μόλις λάβουμε τη συνδρομή των ' + esc(C.annualFee || 10) + '€ (δεν ισχύει για μέλη ΔΕΠ).</p>') +
      '<form class="form" novalidate data-apply>' +
      '<div class="row">' + field('firstName', 'Όνομα', first, { required: true, auto: 'given-name', max: 80, readonly: frozen, hint: nameHint }) +
      field('lastName', 'Επώνυμο', last, { required: true, auto: 'family-name', max: 80, readonly: frozen }) + '</div>' +
      '<div class="row">' + field('email', 'E-mail επικοινωνίας', m.email || user.email || '', { required: true, auto: 'email', max: 200, inputmode: 'email' }) +
      field('phone', 'Κινητό τηλέφωνο', m.phone, { type: 'tel', auto: 'tel', max: 40, inputmode: 'tel', hint: 'Προαιρετικό' }) + '</div>' +
      '<div class="row">' + select('stage', 'Ιδιότητα', m.stage || '', [['graduate', STAGES.graduate], ['final-year', STAGES['final-year']], ['faculty', STAGES.faculty]], true) +
      select('direction', 'Κατεύθυνση', m.direction || '', DIRECTIONS, false) + '</div>' +
      '<div class="row">' + field('entryYear', 'Έτος εισαγωγής', m.entryYear, { inputmode: 'numeric', max: 4, placeholder: 'π.χ. 2008' }) +
      field('gradYear', 'Έτος αποφοίτησης', m.gradYear, { inputmode: 'numeric', max: 4, placeholder: 'π.χ. 2013', hint: 'Κενό αν είστε τελειόφοιτος/η' }) + '</div>' +
      '<div class="row">' + field('position', 'Θέση εργασίας', m.position, { auto: 'organization-title', max: 120 }) + field('employer', 'Εργοδότης / Ίδρυμα', m.employer, { auto: 'organization', max: 120 }) + '</div>' +
      '<div class="row">' + field('city', 'Πόλη / Χώρα', m.city, { max: 80, auto: 'address-level2' }) +
      field('linkedin', 'Προφίλ LinkedIn', m.linkedin, { type: 'url', max: 200, placeholder: 'https://www.linkedin.com/in/…', hint: 'Ο πιο εύκολος τρόπος να επιβεβαιώσουμε ότι είστε απόφοιτος ΣΕΜΦΕ.' }) + '</div>' +
      '<div class="field"><label for="f-note">Σημείωση προς το Δ.Σ.</label><textarea id="f-note" name="note" maxlength="1000" aria-describedby="f-note-hint" data-hint="f-note-hint">' + esc(m.note || '') + '</textarea><span class="hint" id="f-note-hint">Προαιρετικό</span></div>' +
      '<fieldset><legend>Επικοινωνία</legend><div class="form" style="gap:10px">' +
      check('consentNewsletter', 'Θέλω να λαμβάνω το ενημερωτικό newsletter του Συλλόγου.', m.consentNewsletter) +
      check('consentJobs', 'Θέλω να λαμβάνω ανακοινώσεις θέσεων εργασίας και πρακτικής άσκησης.', m.consentJobs) +
      check('consentDirectory', (active ? 'Θέλω να εμφανίζομαι' : 'Όταν ενεργοποιηθεί η ιδιότητά μου, θέλω να εμφανίζομαι') + ' στον κατάλογο μελών (τον βλέπουν μόνο ενεργά μέλη).', m.consentDirectory) +
      check('acceptedPrivacy', 'Έχω διαβάσει την <a href="' + A.root + 'privacy/" target="_blank" rel="noopener">πολιτική απορρήτου</a> και συμφωνώ να αποθηκευτούν τα στοιχεία μου για την τήρηση του μητρώου μελών.', m.acceptedPrivacy, true) +
      '</div></fieldset>' +
      '<div class="form-error" role="alert" id="apply-msg" tabindex="-1" data-form-msg>' + esc(msg) + '</div>' +
      '<div class="section-foot" style="margin-top:0"><button type="submit" class="btn btn-primary"' + (blocked ? ' disabled' : '') + '>' + (member ? 'Αποθήκευση' : 'Υποβολή αίτησης') + '</button>' +
      (member ? '<button type="button" class="btn btn-outline" data-cancel>Ακύρωση</button>' : '') + '</div>' +
      '</form></div>';
  }

  function methodsPanel() {
    var rows = '', blocked = linkNeedsVerifiedEmail(), missing = false;
    A.enabledProviders().concat(['password']).forEach(function (k) {
      var info = k === 'password' ? { name: 'E-mail και κωδικός' } : A.providerInfo(k);
      var on = linked.indexOf(k) !== -1;
      if (!on && k !== 'password') missing = true;
      var action = on
        ? (k === 'password' ? '<button type="button" class="btn btn-outline btn-sm" data-reset>Αλλαγή κωδικού</button>' : '<span class="badge ok">Συνδεδεμένο</span>')
        : (k === 'password' ? '<span class="badge muted">Δεν χρησιμοποιείται</span>'
          : '<button type="button" class="btn btn-outline btn-sm" data-link="' + k + '"' + (blocked ? ' disabled aria-describedby="link-needs-email"' : '') + '>Σύνδεση</button>');
      rows += '<div class="row"><span>' + A.icon(k) + esc(info.name) + '</span>' + action + '</div>';
    });
    // (an e-mail + password account that still has to confirm already has the box at the top)
    var liNote = blocked && missing && !needsEmailCheck()
      ? '<p class="muted" id="link-needs-email" style="font-size:.88rem;margin:10px 0 0">Για να συνδέσετε κι άλλον τρόπο σύνδεσης χρειάζεται επιβεβαιωμένο e-mail (' + esc(user.email) + '). ' +
        '<button type="button" class="link-btn" data-send-verify>Στείλτε μου e-mail επιβεβαίωσης</button> · <button type="button" class="link-btn" data-verified-li>Το επιβεβαίωσα</button></p>'
      : blocked && missing ? '<p class="muted" id="link-needs-email" style="font-size:.88rem;margin:10px 0 0">Για να συνδέσετε κι άλλον τρόπο σύνδεσης, επιβεβαιώστε πρώτα το e-mail σας (δείτε παραπάνω).</p>'
      : '';
    return '<div class="panel" id="methods"><h2 tabindex="-1">Τρόποι σύνδεσης</h2><p class="muted intro">Συνδέστε περισσότερους τρόπους στον ίδιο λογαριασμό, για να μπαίνετε με όποιον σας βολεύει.</p>' +
      '<div class="linked">' + rows + '</div>' + liNote + '<div class="form-error" data-methods-msg role="status" style="margin-top:10px"></div>' +
      '<p style="margin:14px 0 0"><button type="button" class="btn btn-outline btn-sm" data-signout>Αποσύνδεση</button></p></div>';
  }

  function dangerPanel() {
    // decided by what reauth() can use: a popup provider, else the password
    // (a LinkedIn connected through the Cloud Function is only a claim, not a way to re-prove)
    var pd = A.providers(user);
    var pwOnly = pd.indexOf('password') !== -1 && pd.every(function (k) { return k === 'password'; });
    return '<div class="panel" id="delete"><h2 tabindex="-1">Διαγραφή λογαριασμού</h2>' +
      '<p class="muted intro">Διαγράφει οριστικά τον λογαριασμό σας, την αίτηση μέλους και την καταχώρισή σας στον κατάλογο.</p>' +
      '<div data-del-box hidden class="form" style="margin-bottom:12px">' +
      '<div class="field"><label for="del-confirm">Γράψτε <strong>ΔΙΑΓΡΑΦΗ</strong> για επιβεβαίωση</label><input id="del-confirm" autocomplete="off" autocapitalize="characters"></div>' +
      (pwOnly ? '<div class="field"><label for="del-pass">Ο κωδικός σας</label><input id="del-pass" type="password" autocomplete="current-password"></div>' : '') +
      '<div class="form-error" data-del-msg role="alert"></div>' +
      '<button type="button" class="btn btn-danger" data-del-go>Οριστική διαγραφή</button></div>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del-open>Διαγραφή λογαριασμού</button></div>';
  }

  /* reload the user and refresh the ID token, so the rules (and the LinkedIn
     function) see email_verified; msgEl gets the outcome */
  function checkVerified(msgEl, focusAfter) {
    user.reload().then(function () { return user.getIdToken(true); }).then(function () {
      user = firebase.auth().currentUser;
      if (user.emailVerified) { formErr = ''; refocus = focusAfter; render(); A.flash('Το e-mail σας επιβεβαιώθηκε.'); }
      else if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = 'Δεν έχει επιβεβαιωθεί ακόμα. Πατήστε τον σύνδεσμο στο e-mail και δοκιμάστε ξανά.'; }
    }, function (err) { if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = A.friendly(err); } });
  }
  function sendVerify(msgEl) {
    user.sendEmailVerification({ url: location.href.split('#')[0] }).then(function () {
      if (msgEl) { msgEl.className = 'form-ok'; msgEl.textContent = 'Σας στείλαμε e-mail επιβεβαίωσης στο ' + user.email + '.'; }
    }, function (err) { if (msgEl) { msgEl.className = 'form-error'; msgEl.textContent = A.friendly(err); } });
  }

  function wire() {
    var q = function (s) { return app.querySelector(s); };
    var on = function (s, ev, fn) { var el = q(s); if (el) el.addEventListener(ev, fn); };
    on('[data-edit]', 'click', function () { editing = true; refocus = '#f-email'; render(); });
    on('[data-cancel]', 'click', function () { editing = false; draft = null; formErr = ''; refocus = '[data-edit]'; render(true); });
    on('[data-apply]', 'submit', function (e) { e.preventDefault(); submitApplication(e.target); });
    on('[data-signout]', 'click', function () { A.signOut(); });
    on('[data-dir]', 'change', function (e) { toggleDirectory(e.target); });
    on('[data-resend]', 'click', function () { sendVerify(q('[data-verify-msg]')); });
    on('[data-verified]', 'click', function () { checkVerified(q('[data-verify-msg]'), '#apply h2'); });
    on('[data-send-verify]', 'click', function () { sendVerify(q('[data-methods-msg]')); });
    on('[data-verified-li]', 'click', function () { checkVerified(q('[data-methods-msg]'), '#methods h2'); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-link]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-link'), msg = q('[data-methods-msg]');
        b.disabled = true;
        A.link(k).then(function () {
          user = firebase.auth().currentUser;
          // linkWithPopup keeps the uid, so onChange does not fire; the async
          // list keeps a LinkedIn that was connected through the Cloud Function
          return A.providersAsync(user).then(function (l) {
            linked = l;
            refocus = '#methods h2';
            render();
            A.flash('Το ' + A.providerInfo(k).name + ' συνδέθηκε με τον λογαριασμό σας.');
          });
        }, function (err) {
          b.disabled = false;
          try { b.focus(); } catch (e) {}      // disabling it had dropped keyboard focus
          if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
          msg.className = 'form-error';
          msg.textContent = A.friendly(err);
        });
      });
    });
    on('[data-reset]', 'click', function () {
      var msg = q('[data-methods-msg]');
      firebase.auth().sendPasswordResetEmail(user.email).then(function () {
        msg.className = 'form-ok'; msg.textContent = 'Σας στείλαμε e-mail με σύνδεσμο για νέο κωδικό.';
      }, function (err) { msg.className = 'form-error'; msg.textContent = A.friendly(err); });
    });
    on('[data-del-open]', 'click', function () { q('[data-del-box]').hidden = false; this.hidden = true; delBox = { confirm: '', pass: '' }; q('#del-confirm').focus(); });
    on('[data-del-go]', 'click', deleteAccount);
  }

  function readForm(form) {
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var c = function (n) { var el = form.elements[n]; return !!(el && el.checked); };
    var y = function (n) {
      var el = form.elements[n];
      if (el && el.validity && el.validity.badInput) return NaN;   // e.g. "2013-": the browser reports ""
      var s = v(n); if (!s) return null;
      return /^\d{4}$/.test(s) ? parseInt(s, 10) : NaN;
    };
    return {
      firstName: v('firstName'), lastName: v('lastName'), email: v('email'), phone: v('phone'),
      stage: v('stage'), direction: v('direction'), entryYear: y('entryYear'), gradYear: y('gradYear'),
      position: v('position'), employer: v('employer'), city: v('city'), linkedin: v('linkedin'), note: v('note'),
      consentNewsletter: c('consentNewsletter'), consentJobs: c('consentJobs'), consentDirectory: c('consentDirectory'),
      acceptedPrivacy: c('acceptedPrivacy')
    };
  }
  function validate(d, form) {
    var bad = function (name, msg) {
      var el = form.elements[name];
      if (el) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', ((el.getAttribute('data-hint') || '') + ' apply-msg').trim());
        el.focus();
      }
      return msg;
    };
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
      el.removeAttribute('aria-invalid');
      var h = el.getAttribute('data-hint');
      if (h) el.setAttribute('aria-describedby', h); else el.removeAttribute('aria-describedby');
    });
    if (!d.firstName) return bad('firstName', 'Γράψτε το όνομά σας.');
    if (!d.lastName) return bad('lastName', 'Γράψτε το επώνυμό σας.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad('email', 'Γράψτε μια έγκυρη διεύθυνση e-mail.');
    if (!d.stage) return bad('stage', 'Επιλέξτε την ιδιότητά σας.');
    var yearOk = function (x) { return x === null || (x >= 1950 && x <= YEAR + 1); };
    if (!yearOk(d.entryYear)) return bad('entryYear', 'Το έτος εισαγωγής δεν φαίνεται σωστό.');
    if (!yearOk(d.gradYear)) return bad('gradYear', 'Το έτος αποφοίτησης δεν φαίνεται σωστό.');
    if (d.entryYear && d.gradYear && d.gradYear < d.entryYear) return bad('gradYear', 'Το έτος αποφοίτησης είναι πριν από το έτος εισαγωγής.');
    if (d.linkedin) {
      if (!/^https?:\/\//i.test(d.linkedin)) d.linkedin = 'https://' + d.linkedin;
      if (!/^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(d.linkedin.replace(/^http:/i, 'https:'))) return bad('linkedin', 'Γράψτε τη διεύθυνση του προφίλ σας στο LinkedIn (linkedin.com/in/…).');
      d.linkedin = d.linkedin.replace(/^http:/i, 'https:');
    }
    if (!d.acceptedPrivacy) return bad('acceptedPrivacy', 'Για να υποβάλετε αίτηση, χρειάζεται να συμφωνήσετε με την πολιτική απορρήτου.');
    return '';
  }
  function submitApplication(form) {
    var msg = form.querySelector('[data-form-msg]'), btn = form.querySelector('[type=submit]');
    var d = readForm(form), err = validate(d, form);
    msg.className = 'form-error';
    if (err) { formErr = err; msg.textContent = err; say(err); return; }
    msg.textContent = '';
    btn.disabled = true;
    var wasNew = !member;
    var ref = db.collection('members').doc(user.uid);
    var provider = ((user.providerData || [])[0] || {}).providerId || (linked.indexOf('linkedin') !== -1 ? 'linkedin' : 'unknown');
    // Firestore shows our write to the listener before the server accepts it, and
    // rolls it back if refused: keep what was typed so a refusal redraws it
    draft = formValues(form); draft.linkedin = d.linkedin; formErr = '';
    // a reviewed name is frozen (firestore.rules): send the stored one
    if (member && member.status !== 'pending') { d.firstName = member.firstName; d.lastName = member.lastName; }
    d.provider = provider.slice(0, 40);
    d.updatedAt = FV.serverTimestamp();
    var job;
    if (member) {
      job = ref.update(d);
    } else {
      d.status = 'pending';
      d.createdAt = FV.serverTimestamp();
      job = ref.set(d);
    }
    job.then(function () {
      editing = false; draft = null; formErr = '';
      // an active member: the directory follows the form (listed, updated, or removed)
      if (member && member.status === 'active') {
        if (d.consentDirectory) writeDirectory().catch(function () {});
        else if (dirEntry) db.collection('directory').doc(user.uid).delete().then(function () { dirEntry = null; render(); }, function () {});
      }
      A.flash(wasNew ? 'Η αίτησή σας υποβλήθηκε. Ευχαριστούμε!' : 'Τα στοιχεία σας αποθηκεύτηκαν.');
      refocus = '#apply h2';
      render(true);
    }, function (e) {
      formErr = A.friendly(e);
      editing = !wasNew;
      refocus = '#apply-msg';
      render();
      say(formErr);
    });
  }

  function directoryData() {
    var m = member;
    return {
      name: m.firstName + ' ' + m.lastName, gradYear: m.gradYear || null,
      direction: m.direction || '', employer: m.employer || '', position: m.position || '',
      city: m.city || '', linkedin: m.linkedin || '', updatedAt: FV.serverTimestamp()
    };
  }
  function writeDirectory() { return db.collection('directory').doc(user.uid).set(directoryData()).then(function () { dirEntry = {}; }); }
  function toggleDirectory(box) {
    box.disabled = true;
    dirMsg = null;
    var want = box.checked;
    var job = (want ? writeDirectory() : db.collection('directory').doc(user.uid).delete().then(function () { dirEntry = null; }))
      .then(function () {
        // remember the choice on the application too, so it is not re-listed automatically
        if (member.consentDirectory !== want) return db.collection('members').doc(user.uid).update({ consentDirectory: want, updatedAt: FV.serverTimestamp() });
      });
    job.then(function () {
      dirMsg = { cls: 'form-ok', text: want ? 'Εμφανίζεστε στον κατάλογο μελών.' : 'Αφαιρεθήκατε από τον κατάλογο μελών.' };
      refocus = '[data-dir]';
      render();
      say(dirMsg.text);
    }, function (e) {
      dirMsg = { cls: 'form-error', text: A.friendly(e) };
      refocus = '[data-dir]';
      render();
      say(dirMsg.text);
    });
  }

  function deleteAccount() {
    var q = function (s) { return app.querySelector(s); };
    var msg = q('[data-del-msg]'), btn = q('[data-del-go]');
    if (q('#del-confirm').value.trim().toUpperCase() !== 'ΔΙΑΓΡΑΦΗ') { msg.textContent = 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.'; return; }
    var pass = q('#del-pass');
    btn.disabled = true; msg.className = 'form-error'; msg.textContent = '';
    var recent = user.metadata && user.metadata.lastSignInTime && (Date.now() - new Date(user.metadata.lastSignInTime).getTime() < 4 * 60 * 1000);
    // prove identity FIRST: deleting the sign-in account removes the right to delete its data
    var proof = recent ? Promise.resolve() : (pass ? A.reauthPassword(pass.value) : A.reauth(user));
    proof.then(function () {
      if (unsub) { unsub(); unsub = null; }
      return db.collection('directory').doc(user.uid).delete().catch(function () {});
    }).then(function () {
      return db.collection('members').doc(user.uid).delete();
    }).then(function () {
      deleted = true;
      return user.delete();
    }).then(function () {
      try { localStorage.removeItem('semfe:auth-hint'); } catch (e) {}
      html('<div class="notice ok" tabindex="-1" id="deleted-msg"><strong>Ο λογαριασμός σας διαγράφηκε.</strong><p>Διαγράψαμε τον λογαριασμό σύνδεσης, την αίτηση μέλους και την καταχώρισή σας στον κατάλογο.</p></div>');
      var d = document.getElementById('deleted-msg'); if (d) d.focus();
    }).catch(function (e) {
      deleted = false;
      btn.disabled = false;
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) { msg.textContent = 'Η διαγραφή ακυρώθηκε.'; return; }
      msg.textContent = A.friendly(e);
    });
  }
})();
