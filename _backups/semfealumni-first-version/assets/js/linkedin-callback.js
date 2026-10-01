/* SEMFE Alumni: the page LinkedIn sends the member back to
 * (auth/linkedin/?code=…&state=…). It checks the state it saved before
 * leaving (so no other site can push a code at us), hands the code to the
 * linkedinSignIn Cloud Function through SemfeAuth.linkedinComplete, and
 * returns the member to where they started. The code is removed from the
 * address bar at once so it does not stay in the history. */
(function () {
  'use strict';
  var A = window.SemfeAuth;
  var box = document.getElementById('li-app');
  if (!A || !box) return;
  var q = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('='), k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
    q[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
  });
  try { if (history.replaceState) history.replaceState(null, '', location.pathname); } catch (e) {}

  function show(title, text, kind) {
    box.innerHTML = '<div class="notice ' + (kind || 'err') + '"><strong>' + A.esc(title) + '</strong><p>' + A.esc(text) + '</p></div>' +
      '<div class="section-foot" style="margin-top:8px"><a class="btn btn-dark" href="' + A.root + 'account/">Ο λογαριασμός μου</a><a class="btn btn-outline" href="' + A.root + '">Αρχική</a></div>';
  }
  var saved = A.linkedinTakeState();       // {state, mode, returnTo, waiting, t} or null (single use)
  if (q.error) {
    var cancelled = /cancel/.test(q.error);
    // LinkedIn's own wording only when the state proves LinkedIn sent it: anyone
    // can build a link to this page with whatever text they like in the address
    var genuine = saved && q.state && saved.state === q.state;
    return show(cancelled ? 'Η σύνδεση ακυρώθηκε' : 'Το LinkedIn δεν ολοκλήρωσε τη σύνδεση',
      cancelled ? 'Δεν συνδεθήκατε. Μπορείτε να δοκιμάσετε ξανά ή να επιλέξετε άλλον τρόπο σύνδεσης.'
        : genuine && q.error_description ? q.error_description.slice(0, 300)
        : 'Δεν συνδεθήκατε. Δοκιμάστε ξανά ή επιλέξτε άλλον τρόπο σύνδεσης.', cancelled ? 'warn' : 'err');
  }
  if (!q.code || !saved || !q.state || saved.state !== q.state || Date.now() - saved.t > 20 * 60 * 1000) {
    return show('Ο σύνδεσμος σύνδεσης δεν ισχύει', 'Ίσως έληξε ή ανοίχτηκε σε άλλη καρτέλα. Πατήστε ξανά «Συνέχεια με LinkedIn».');
  }
  A.linkedinComplete(q.code, saved.mode).then(function (r) {
    // a sign-in method that was waiting to be linked (the dialog asked them to sign in the
    // first way, which was LinkedIn): it cannot survive the trip, so show where to finish it
    var waiting = saved.mode !== 'link' && saved.waiting && !(r && r.isNew) ? saved.waiting : '';
    var dest = saved.mode === 'link' || waiting ? A.root + 'account/' : (r && r.isNew ? A.root + 'account/#apply' : A.safeReturn(saved.returnTo));
    var note = saved.mode === 'link' ? 'Το LinkedIn συνδέθηκε με τον λογαριασμό σας.'
      : waiting ? 'Συνδεθήκατε με LinkedIn. Για να συνδέσετε και το ' + waiting + ', πατήστε «Σύνδεση» δίπλα του, στους «Τρόπους σύνδεσης».' : '';
    if (note) { try { sessionStorage.setItem('semfe:flash', note); } catch (e) {} }
    location.replace(dest);
  }, function (e) {
    show('Η σύνδεση με LinkedIn δεν ολοκληρώθηκε', A.friendly(e));
  });
})();
