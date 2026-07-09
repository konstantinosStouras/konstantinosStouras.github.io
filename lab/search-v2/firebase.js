/* ==========================================================================
   search-v2  ·  firebase.js
   Optional Firebase (Firestore + Auth) integration. Loaded on every page but
   INERT until firebase-config.js holds a real project config. When configured:
     · participants sign in anonymously and every logged event is written to the
       `events` collection (idempotent by session+sequence, so retries/resumes
       never duplicate rows);
     · the app reads the admin-controlled `config/study` doc to set the arm,
       completion code, and open/closed state;
     · the admin panel (admin/) signs in with email/password to read all events
       and write `config/study`.
   The Firebase SDK is imported from the CDN lazily, so a project that never
   configures Firebase pays nothing and stays fully client-side.
   ========================================================================== */
window.SVFirebase = (function () {
  'use strict';
  var cfg = window.FIREBASE_CONFIG || {};
  var PATHS = window.FIREBASE_PATHS || { events: 'events', configDoc: 'config/study' };
  var VER = window.FIREBASE_SDK_VERSION || '10.12.2';
  var configured = !!(cfg.apiKey && cfg.apiKey.indexOf('PASTE_') !== 0 && cfg.projectId && cfg.projectId.indexOf('PASTE_') !== 0);

  var sdk = null, app = null, auth = null, db = null, ready = null;

  function isConfigured() { return configured; }

  function loadSdk() {
    if (sdk) return Promise.resolve(sdk);
    var base = 'https://www.gstatic.com/firebasejs/' + VER + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js')
    ]).then(function (m) { sdk = { app: m[0], auth: m[1], fs: m[2] }; return sdk; });
  }

  function init() {
    if (!configured) return Promise.reject(new Error('firebase not configured'));
    if (ready) return ready;
    ready = loadSdk().then(function (s) {
      app = s.app.initializeApp(cfg);
      auth = s.auth.getAuth(app);
      db = s.fs.getFirestore(app);
      return true;
    });
    return ready;
  }

  function configRef() {
    var parts = PATHS.configDoc.split('/');
    return sdk.fs.doc(db, parts[0], parts[1]);
  }

  // ---- participant side ----------------------------------------------------
  function signInAnon() {
    return init().then(function () { return sdk.auth.signInAnonymously(auth); });
  }
  // Idempotent per (session, seq): a retry or a resumed session overwrites the
  // same document instead of creating a duplicate.
  function writeEvent(ev, seq) {
    if (!configured) return Promise.resolve(false);
    return init().then(function () {
      var id = (ev.session || 'anon') + '__' + String(seq).padStart(6, '0');
      return sdk.fs.setDoc(sdk.fs.doc(db, PATHS.events, id), ev, { merge: true });
    }).then(function () { return true; }).catch(function () { return false; });
  }
  function getStudyConfig() {
    if (!configured) return Promise.resolve(null);
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, 4000); });
    // Reading config/study requires an authenticated session (see firestore.rules),
    // so sign in anonymously first; this also warms the session for event writes.
    var fetchCfg = init()
      .then(function () { return sdk.auth.signInAnonymously(auth); })
      .then(function () { return sdk.fs.getDoc(configRef()); })
      .then(function (snap) { return snap.exists() ? snap.data() : null; })
      .catch(function () { return null; });
    return Promise.race([fetchCfg, timeout]);
  }

  // ---- admin side ----------------------------------------------------------
  function adminSignIn(email, pw) { return init().then(function () { return sdk.auth.signInWithEmailAndPassword(auth, email, pw); }); }
  function adminSignOut() { return init().then(function () { return sdk.auth.signOut(auth); }); }
  function onAuth(cb) { init().then(function () { sdk.auth.onAuthStateChanged(auth, cb); }).catch(function () { cb(null); }); }
  function saveStudyConfig(obj) { return init().then(function () { return sdk.fs.setDoc(configRef(), obj, { merge: true }); }); }
  function fetchEvents(max) {
    return init().then(function () {
      var col = sdk.fs.collection(db, PATHS.events);
      var q = sdk.fs.query(col, sdk.fs.orderBy('t', 'asc'), sdk.fs.limit(max || 10000));
      return sdk.fs.getDocs(q);
    }).then(function (qs) { var out = []; qs.forEach(function (d) { out.push(d.data()); }); return out; });
  }

  return {
    isConfigured: isConfigured, init: init,
    signInAnon: signInAnon, writeEvent: writeEvent, getStudyConfig: getStudyConfig,
    adminSignIn: adminSignIn, adminSignOut: adminSignOut, onAuth: onAuth,
    saveStudyConfig: saveStudyConfig, fetchEvents: fetchEvents,
    adminEmails: window.ADMIN_EMAILS || [], paths: PATHS
  };
})();
