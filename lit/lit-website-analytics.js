/* Account activity only. Private data is protected by existing userDirectory rules. */
(function (root) {
  'use strict';
  var ADMIN_EMAIL = 'kstouras@gmail.com';
  function isAdmin(user) { return !!user && user.email === ADMIN_EMAIL && user.emailVerified === true; }
  function summarise(rows, now) {
    var day = 86400000;
    var valid = function (n) { return typeof n === 'number' && isFinite(n) && n > 0 && n <= now; };
    var first = rows.map(function (r) { return r.first; }).filter(valid);
    var recent = function (key, days) { return rows.filter(function (r) { return valid(r[key]) && r[key] >= now - days * day; }).length; };
    var months = [];
    var current = new Date(now);
    for (var i = 11; i >= 0; i--) {
      var start = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 1);
      var end = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i + 1, 1);
      months.push({ start: start, added: first.filter(function (n) { return n >= start && n < end; }).length,
        total: first.filter(function (n) { return n < end; }).length });
    }
    return { new30: recent('first', 30), seen7: recent('seen', 7), seen30: recent('seen', 30), dated: first.length, months: months };
  }
  if (typeof module === 'object' && module.exports) { module.exports = { summarise: summarise, isAdmin: isAdmin }; return; }
  var status = document.getElementById('usageStatus');
  var panel = document.getElementById('usagePanel');
  if (!status || !panel) return;
  if (!root.firebase || !firebase.apps.length) { status.textContent = 'Account services could not load. Reload the page to try again.'; return; }
  var generation = 0, currentUser = null;
  function load() {
    var run = ++generation;
    panel.hidden = true;
    status.textContent = 'Loading website analytics…';
    if (!isAdmin(currentUser)) { status.textContent = 'Website analytics is available only to the verified administrator account.'; return; }
    var db = firebase.firestore();
    // Do not request private records until the authenticated account passes the gate.
    // Firestore is the authority: userDirectory list reads are administrator-only.
    Promise.all([db.collection('userDirectory').get(), db.collection('registeredUsers').get()]).then(function (results) {
      if (run !== generation || !isAdmin(currentUser)) return;
      var rows = results[0].docs.map(function (doc) { return doc.data() || {}; });
      var stats = summarise(rows, Date.now());
      document.getElementById('usageRegistered').textContent = results[1].size.toLocaleString();
      document.getElementById('usageNew').textContent = stats.new30.toLocaleString();
      document.getElementById('usageSeen7').textContent = stats.seen7.toLocaleString();
      document.getElementById('usageSeen30').textContent = stats.seen30.toLocaleString();
      var table = document.getElementById('usageMonths');
      table.replaceChildren();
      var max = Math.max(1, stats.dated);
      stats.months.forEach(function (month) {
        var tr = document.createElement('tr');
        var label = document.createElement('th'); label.scope = 'row';
        label.textContent = new Date(month.start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        var added = document.createElement('td'); added.textContent = month.added.toLocaleString();
        var total = document.createElement('td'); total.textContent = month.total.toLocaleString();
        var track = document.createElement('span'); track.className = 'usage-track'; track.setAttribute('aria-hidden', 'true');
        var bar = document.createElement('span'); bar.style.width = (100 * month.total / max) + '%';
        track.appendChild(bar); total.appendChild(track); tr.append(label, added, total); table.appendChild(tr);
      });
      document.getElementById('usageCoverage').textContent = 'Account directory: ' + rows.length + ' records; ' + stats.dated + ' with a valid first-seen date. Registered-account markers: ' + results[1].size + '. Differences can reflect incomplete backfills or merged accounts.';
      status.textContent = 'Updated ' + new Date().toLocaleString('en-GB') + '.';
      panel.hidden = false;
    }).catch(function () {
      if (run !== generation) return;
      status.textContent = 'Could not load website analytics. Check your administrator sign-in and try Refresh.';
    });
  }
  firebase.auth().onAuthStateChanged(function (user) {
    currentUser = user;
    ++generation;
    panel.hidden = true;
    // Clear prior account data even when a request completes after sign-out.
    document.getElementById('usageMonths').replaceChildren();
    ['usageRegistered','usageNew','usageSeen7','usageSeen30','usageCoverage'].forEach(function (id) { document.getElementById(id).textContent = '—'; });
    load();
  });
  document.getElementById('usageRefresh').addEventListener('click', load);
})(typeof window !== 'undefined' ? window : globalThis);
