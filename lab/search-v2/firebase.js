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
  // Ensure there IS a session, but never replace an existing one. This is
  // critical on the admin page: it signs in with email/password, and calling
  // signInAnonymously there would clobber the admin session (bouncing the admin
  // back to the login screen). Participants have no session yet, so they get an
  // anonymous one.
  function ensureAuth() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return sdk.auth.signInAnonymously(auth);
  }
  function signInAnon() {
    return init().then(ensureAuth);
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
    // Reading config/study requires an authenticated session (see firestore.rules).
    // ensureAuth() keeps an existing session (admin email/password) and only signs
    // in anonymously when there is none (participants) — so this never logs the
    // admin out. It also warms the session for event writes.
    var fetchCfg = init()
      .then(ensureAuth)
      .then(function () { return sdk.fs.getDoc(configRef()); })
      .then(function (snap) { return snap.exists() ? snap.data() : null; })
      .catch(function () { return null; });
    return Promise.race([fetchCfg, timeout]);
  }

  // Participant: look up the study "session" (wave) they were sent to by its code
  // (from ?code=… in the launch URL). Returns { id, ...data } or null.
  function getSessionByCode(code) {
    if (!configured || !code) return Promise.resolve(null);
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, 4000); });
    var fetchIt = init().then(ensureAuth).then(function () {
      var col = sdk.fs.collection(db, 'sessions');
      return sdk.fs.getDocs(sdk.fs.query(col, sdk.fs.where('code', '==', code), sdk.fs.limit(1)));
    }).then(function (qs) { var r = null; qs.forEach(function (d) { if (!r) r = Object.assign({ id: d.id }, d.data()); }); return r; })
      .catch(function () { return null; });
    return Promise.race([fetchIt, timeout]);
  }

  // ---- admin side ----------------------------------------------------------
  // Admin-only, honest read of config/study. Resolves the doc data, or null if
  // the document does not exist yet (a legitimate first-run state → safe to show
  // defaults), and REJECTS on a real read error. Unlike getStudyConfig() (which
  // swallows errors to null so a participant's game never blocks), the admin must
  // distinguish "no doc yet" from "read failed" — otherwise a failed read would
  // populate the form with defaults that a subsequent Save clobbers over the real
  // settings. The admin is already signed in when this runs, so no ensureAuth().
  function adminLoadStudyConfig() {
    return init()
      .then(function () { return sdk.fs.getDoc(configRef()); })
      .then(function (snap) { return snap.exists() ? snap.data() : null; });
  }
  function adminSignIn(email, pw) { return init().then(function () { return sdk.auth.signInWithEmailAndPassword(auth, email, pw); }); }
  function adminSignOut() { return init().then(function () { return sdk.auth.signOut(auth); }); }
  function onAuth(cb) { init().then(function () { sdk.auth.onAuthStateChanged(auth, cb); }).catch(function () { cb(null); }); }
  function saveStudyConfig(obj) { return init().then(function () { return sdk.fs.setDoc(configRef(), obj, { merge: true }); }); }
  function fetchEvents(max) {
    var cap = max || 20000;
    return init().then(function () {
      // Read the events collection with NO query constraints — exactly the shape
      // of listSessions() (getDocs(collection(...))), which reads reliably.
      //
      // History of this read: it started as query(col, orderBy('t'), limit(N)),
      // which threw `invalid-argument`; a prior fix dropped the orderBy but KEPT
      // limit(N) — and the error came back. The server accepts collection+limit
      // (verified over REST), so this is a browser WebChannel quirk where the
      // limit() constraint is the one thing that differs from the working sessions
      // read. Dropping it too makes this read structurally identical to the
      // known-good one. Ordering by `t` and capping to `max` happen on the client
      // below (all the admin Data/Analytics/CSV views need).
      return sdk.fs.getDocs(sdk.fs.collection(db, PATHS.events));
    }).then(function (qs) {
      var out = []; qs.forEach(function (d) { out.push(d.data()); });
      out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
      // Keep the most recent `cap` events (the tail, since they're sorted ascending).
      return out.length > cap ? out.slice(out.length - cap) : out;
    });
  }

  // ---- admin: sessions (waves) CRUD ---------------------------------------
  function listSessions() {
    return init().then(function () {
      return sdk.fs.getDocs(sdk.fs.collection(db, 'sessions'));
    }).then(function (qs) { var out = []; qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); }); return out; });
  }
  function createSession(obj) {
    return init().then(function () { return sdk.fs.addDoc(sdk.fs.collection(db, 'sessions'), obj); })
      .then(function (ref) { return ref.id; });
  }
  function updateSession(id, obj) {
    return init().then(function () { return sdk.fs.setDoc(sdk.fs.doc(db, 'sessions', id), obj, { merge: true }); });
  }
  function deleteSession(id) {
    return init().then(function () { return sdk.fs.deleteDoc(sdk.fs.doc(db, 'sessions', id)); });
  }
  function codeExists(code) {
    return init().then(function () {
      return sdk.fs.getDocs(sdk.fs.query(sdk.fs.collection(db, 'sessions'), sdk.fs.where('code', '==', code), sdk.fs.limit(1)));
    }).then(function (qs) { var n = 0; qs.forEach(function () { n++; }); return n > 0; });
  }

  // ---- admin: saved defaults for new sessions (config/defaults) ------------
  function defaultsRef() { return sdk.fs.doc(db, 'config', 'defaults'); }
  // Honest admin read (like adminLoadStudyConfig): resolves the doc, or null when
  // it genuinely doesn't exist (first run), and REJECTS on a real read error — so
  // the admin never seeds the form with built-ins after a failed read and then
  // clobbers the saved defaults via "Make this the default".
  function getDefaults() {
    return init().then(function () { return sdk.fs.getDoc(defaultsRef()); })
      .then(function (s) { return s.exists() ? s.data() : null; });
  }
  function saveDefaults(obj) { return init().then(function () { return sdk.fs.setDoc(defaultsRef(), obj, { merge: false }); }); }

  return {
    isConfigured: isConfigured, init: init,
    signInAnon: signInAnon, writeEvent: writeEvent, getStudyConfig: getStudyConfig,
    getSessionByCode: getSessionByCode,
    adminSignIn: adminSignIn, adminSignOut: adminSignOut, onAuth: onAuth,
    adminLoadStudyConfig: adminLoadStudyConfig,
    saveStudyConfig: saveStudyConfig, fetchEvents: fetchEvents,
    listSessions: listSessions, createSession: createSession, updateSession: updateSession,
    deleteSession: deleteSession, codeExists: codeExists,
    getDefaults: getDefaults, saveDefaults: saveDefaults,
    adminEmails: window.ADMIN_EMAILS || [], paths: PATHS
  };
})();
