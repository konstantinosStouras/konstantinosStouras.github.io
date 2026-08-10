/* Simulation Platform — shared engine (student page + admin panel).
   Backend switch follows sustainable-supply-chains/store.js: Firebase when
   firebase-config.js carries real values, otherwise a LOCAL mode in which
   everything lives in this browser's localStorage and the committed
   config.json is the published source of truth for students. */
(function () {
  'use strict';

  var cfg = window.SIMP_FIREBASE_CONFIG || {};
  var CONFIGURED = !!(cfg.apiKey && cfg.apiKey.indexOf('PASTE_') !== 0 &&
                      cfg.projectId && cfg.projectId.indexOf('PASTE_') !== 0);
  var BASE = window.SIMP_BASE || '.';
  var PATHS = window.SIMP_PATHS || { config: 'simPlatform/config', students: 'simPlatformStudents' };

  var LS_PROFILE = 'simp:profile:v1';   // the student's one-time registration
  var LS_DRAFT   = 'simp:config-draft:v1'; // admin's local (unpublished) activation edits
  var LS_HANDOFF = 'simp:handoff:v1';   // written at launch; read by prefill.js inside each sim
  var LS_SYNCED  = 'simp:profile-synced:v1'; // updatedAt of the last profile mirrored to Firestore

  /* ---------- catalog ---------- */
  function catalog() { return window.SIMP_CATALOG || []; }
  function sim(key) {
    var c = catalog();
    for (var i = 0; i < c.length; i++) if (c[i].key === key) return c[i];
    return null;
  }

  /* ---------- student profile ---------- */
  function getProfile() {
    try { return JSON.parse(localStorage.getItem(LS_PROFILE) || 'null'); }
    catch (e) { return null; }
  }
  function saveProfile(p) {
    p = p || {};
    var old = getProfile();
    p.updatedAt = new Date().toISOString();
    p.createdAt = (old && old.createdAt) || p.updatedAt;
    localStorage.setItem(LS_PROFILE, JSON.stringify(p));
    syncProfile();
    return p;
  }
  function clearProfile() { localStorage.removeItem(LS_PROFILE); localStorage.removeItem(LS_SYNCED); }
  /* Log out of the platform on this browser: forget the saved registration
     (and the launch handoff), and sign out the Firebase user so the NEXT
     registration on this machine gets its own roster doc instead of
     overwriting this student's — the shared-computer case. The roster doc
     itself stays (logging out is not unregistering from class). */
  function logout() {
    clearProfile();
    try { localStorage.removeItem(LS_HANDOFF); } catch (e) {}
    if (!CONFIGURED) return Promise.resolve();
    return fb().then(function (F) { return F.adminSignOut(); }).catch(function () {});
  }
  /* Mirror the saved profile to the Firestore roster, once per change — also
     called at page load, so a profile registered while the platform was still
     in LOCAL mode joins the roster on the student's next visit. */
  function syncProfile() {
    if (!CONFIGURED) return;
    var p = getProfile();
    if (!p) return;
    if (localStorage.getItem(LS_SYNCED) === p.updatedAt) return;
    fb().then(function (F) { return F.saveStudent(p); })
      .then(function () { localStorage.setItem(LS_SYNCED, p.updatedAt); })
      .catch(function () { /* retried on the next visit */ });
  }

  /* ---------- activation config ----------
     shape: { sims: { key: { active, sessionId, note } }, updated } */
  function draft() {
    try { return JSON.parse(localStorage.getItem(LS_DRAFT) || 'null'); }
    catch (e) { return null; }
  }
  function saveDraft(c) { c.updated = new Date().toISOString(); localStorage.setItem(LS_DRAFT, JSON.stringify(c)); return c; }
  function clearDraft() { localStorage.removeItem(LS_DRAFT); }
  function fetchStatic() {
    return fetch(BASE + '/config.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('config.json ' + r.status); return r.json(); })
      .catch(function () { return { v: 1, sims: {} }; });
  }
  /* watchConfig(cb): calls cb({ sims, source }) once now and, in Firebase
     mode, again on every remote change. source: 'firestore' | 'draft' | 'static'.
     Returns an unsubscribe function. */
  function watchConfig(cb) {
    if (CONFIGURED) {
      var stop = function () {};
      fb().then(function (F) {
        stop = F.watchConfig(function (c) {
          if (c) cb({ sims: c.sims || {}, source: 'firestore' });
          else fetchStatic().then(function (s) { cb({ sims: s.sims || {}, source: 'static' }); });
        });
      }).catch(function () {
        fetchStatic().then(function (s) { cb({ sims: s.sims || {}, source: 'static' }); });
      });
      return function () { stop(); };
    }
    var d = draft();
    if (d) { cb({ sims: d.sims || {}, source: 'draft' }); return function () {}; }
    fetchStatic().then(function (s) { cb({ sims: s.sims || {}, source: 'static' }); });
    return function () {};
  }
  /* saveConfig(c): Firestore in Firebase mode; the local draft otherwise.
     Resolves to 'firestore' | 'draft'. */
  function saveConfig(c) {
    if (CONFIGURED) return fb().then(function (F) { return F.saveConfig(c).then(function () { return 'firestore'; }); });
    saveDraft(c);
    return Promise.resolve('draft');
  }

  /* ---------- launch ---------- */
  function buildLaunch(s, profile, session) {
    session = (session || '').trim();
    var url = s.external || s.path;
    var q = [];
    if (session && s.sessionParam) q.push(encodeURIComponent(s.sessionParam) + '=' + encodeURIComponent(session));
    if (s.params) {
      var extra = s.params(profile || {}, session) || {};
      Object.keys(extra).forEach(function (k) {
        if (extra[k] != null && extra[k] !== '') q.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
      });
    }
    if (q.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
    return url;
  }
  /* launch(key, session): writes the handoff + any storage seeds, returns the
     URL to open (null for an unknown key). */
  function launch(key, session) {
    var s = sim(key);
    if (!s) return null;
    var profile = getProfile() || {};
    try {
      localStorage.setItem(LS_HANDOFF, JSON.stringify({
        v: 1, ts: Date.now(), sim: s.key,
        session: (session || '').trim() || null, profile: profile
      }));
      (s.seeds ? s.seeds(profile, (session || '').trim()) : []).forEach(function (kv) {
        localStorage.setItem(kv[0], kv[1]);
      });
    } catch (e) { /* storage full/blocked — the sims still work unprefilled */ }
    return buildLaunch(s, profile, session);
  }

  /* ---------- Firebase backend (lazy; only when configured) ---------- */
  var fbP = null;
  function fb() {
    if (!CONFIGURED) return Promise.reject(new Error('Firebase not configured'));
    if (fbP) return fbP;
    var U = 'https://www.gstatic.com/firebasejs/10.12.2/';
    fbP = Promise.all([
      import(U + 'firebase-app.js'),
      import(U + 'firebase-auth.js'),
      import(U + 'firebase-firestore.js')
    ]).then(function (m) {
      var A = m[1], D = m[2];
      var app = m[0].initializeApp(cfg, 'simp');
      var auth = A.getAuth(app);
      var fs = D.getFirestore(app);
      var confRef = D.doc(fs, PATHS.config);
      function ensureAnon() {
        // Wait for the restored auth state before deciding — auth.currentUser
        // is null while Firebase is still restoring a previous session, and
        // signing in anonymously at that moment would mint a NEW uid (and a
        // duplicate roster doc) on every visit.
        return new Promise(function (res, rej) {
          var un = A.onAuthStateChanged(auth, function (u) {
            un();
            if (u) res(u);
            else A.signInAnonymously(auth).then(function (cred) { res(cred.user); }, rej);
          });
        });
      }
      return {
        auth: auth,
        adminSignIn: function (email, pass) { return A.signInWithEmailAndPassword(auth, email, pass); },
        adminSignOut: function () { return A.signOut(auth); },
        onAuth: function (cb) { return A.onAuthStateChanged(auth, cb); },
        watchConfig: function (cb) {
          return D.onSnapshot(confRef,
            function (snap) { cb(snap.exists() ? snap.data() : { sims: {} }); },
            function () { cb(null); });
        },
        saveConfig: function (c) { c.updated = new Date().toISOString(); return D.setDoc(confRef, c); },
        saveStudent: function (p) {
          return ensureAnon().then(function (u) {
            var doc = {};
            Object.keys(p).forEach(function (k) { if (p[k] != null && p[k] !== '') doc[k] = p[k]; });
            doc.uid = u.uid;
            return D.setDoc(D.doc(fs, PATHS.students + '/' + u.uid), doc, { merge: true });
          });
        },
        listStudents: function () {
          return D.getDocs(D.collection(fs, PATHS.students)).then(function (qs) {
            var out = [];
            qs.forEach(function (d) { out.push(d.data()); });
            return out;
          });
        }
      };
    });
    return fbP;
  }

  window.SimPlatform = {
    configured: CONFIGURED,
    catalog: catalog, sim: sim,
    getProfile: getProfile, saveProfile: saveProfile, clearProfile: clearProfile, syncProfile: syncProfile,
    logout: logout,
    watchConfig: watchConfig, saveConfig: saveConfig, draft: draft, clearDraft: clearDraft,
    buildLaunch: buildLaunch, launch: launch,
    firebase: fb,
    KEYS: { profile: LS_PROFILE, handoff: LS_HANDOFF, draft: LS_DRAFT, adminCreds: 'simp:admin-creds' }
  };
})();
