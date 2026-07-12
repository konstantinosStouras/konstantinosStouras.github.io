/* ==========================================================================
   Sustainable Supply Chains — store.js
   One storage API, two backends:

   · FIREBASE (real class sessions, many devices): used when firebase-config.js
     holds a real project config. Students sign in anonymously; the admin signs
     in with email/password. The Firebase SDK is imported lazily from the CDN,
     so an unconfigured deployment pays nothing.

   · DEMO (no setup): everything in this browser's localStorage, with cross-tab
     live sync (storage events + a light poll). The full game — admin panel and
     any number of student tabs — works on one machine. Great for preparing a
     class, testing parameters, or a single-projector walkthrough with bots.

   Data model (same shape in both backends):
     sessions/{id}                  session doc: code, name, status, round,
                                    phase, settings, catalog, broadcast, …
     sessions/{id}/firms/{fid}      firm doc: name, hub, members, isBot, …
     sessions/{id}/decisions/{fid_r}
     sessions/{id}/results/{fid_r}
     sessions/{id}/markets/r{r}

   Watchers call cb immediately with the current value, then on every change.
   All watchers return an unsubscribe function.
   ========================================================================== */
window.SSCStore = (function () {
  'use strict';
  var cfg = window.SSC_FIREBASE_CONFIG || {};
  var PATHS = window.SSC_PATHS || { sessions: 'sscSessions' };
  var VER = window.SSC_FIREBASE_SDK_VERSION || '10.12.2';
  var configured = !!(cfg.apiKey && cfg.apiKey.indexOf('PASTE_') !== 0 &&
                      cfg.projectId && cfg.projectId.indexOf('PASTE_') !== 0);

  function rid(n) {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < (n || 10); i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  /* =====================================================================
     DEMO backend (localStorage)
     ===================================================================== */
  var LS_DB = 'ssc-db-v1', LS_REV = 'ssc-db-rev', LS_UID = 'ssc-uid';

  function demoUid() {
    var u = localStorage.getItem(LS_UID);
    if (!u) { u = 'local-' + rid(12); localStorage.setItem(LS_UID, u); }
    return u;
  }
  function dbRead() {
    try { return JSON.parse(localStorage.getItem(LS_DB)) || { sessions: {} }; }
    catch (e) { return { sessions: {} }; }
  }
  function dbWrite(db) {
    localStorage.setItem(LS_DB, JSON.stringify(db));
    localStorage.setItem(LS_REV, String((Number(localStorage.getItem(LS_REV)) || 0) + 1));
    pokeWatchers();
  }
  function sessSlot(db, id) {
    if (!db.sessions[id]) db.sessions[id] = { doc: null, firms: {}, decisions: {}, results: {}, markets: {} };
    return db.sessions[id];
  }

  // watcher registry: each entry re-reads its slice and fires cb when the
  // serialized slice changed. Poked on local writes, storage events, and a
  // slow safety poll (same-tab writes already poke synchronously).
  var watchers = [];
  function addWatcher(read, cb) {
    var w = { read: read, cb: cb, last: undefined, dead: false };
    watchers.push(w);
    runWatcher(w);
    return function () { w.dead = true; var i = watchers.indexOf(w); if (i !== -1) watchers.splice(i, 1); };
  }
  function runWatcher(w) {
    if (w.dead) return;
    var v = w.read();
    var s = JSON.stringify(v);
    if (s !== w.last) { w.last = s; try { w.cb(v); } catch (e) { console.error(e); } }
  }
  function pokeWatchers() { watchers.slice().forEach(runWatcher); }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', function (e) {
      if (!e || e.key === LS_REV || e.key === LS_DB || e.key == null) pokeWatchers();
    });
    setInterval(pokeWatchers, 1500);
  }

  function objToArr(o) {
    return Object.keys(o || {}).map(function (k) { return o[k]; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }

  var demo = {
    backend: 'demo',
    ready: Promise.resolve(true),
    uid: function () { return Promise.resolve(demoUid()); },
    // -- sessions
    listSessions: function () {
      var db = dbRead();
      return Promise.resolve(Object.keys(db.sessions)
        .map(function (id) { return db.sessions[id].doc; })
        .filter(Boolean)
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }));
    },
    getSessionByCode: function (code) {
      code = String(code || '').trim().toUpperCase();
      return demo.listSessions().then(function (list) {
        return list.find(function (s) { return s.code === code && !s.archived; }) || null;
      });
    },
    createSession: function (data) {
      var db = dbRead(), id = 's' + rid(10);
      data.id = id;
      sessSlot(db, id).doc = data;
      dbWrite(db);
      return Promise.resolve(id);
    },
    updateSession: function (id, patch) {
      var db = dbRead(), slot = sessSlot(db, id);
      if (slot.doc) Object.assign(slot.doc, patch);
      dbWrite(db);
      return Promise.resolve();
    },
    deleteSession: function (id) {
      var db = dbRead();
      delete db.sessions[id];
      dbWrite(db);
      return Promise.resolve();
    },
    watchSession: function (id, cb) {
      return addWatcher(function () { return (dbRead().sessions[id] || {}).doc || null; }, cb);
    },
    // -- firms
    setFirm: function (id, firmId, data) {
      var db = dbRead(), slot = sessSlot(db, id);
      slot.firms[firmId] = Object.assign(slot.firms[firmId] || {}, data, { id: firmId });
      dbWrite(db);
      return Promise.resolve(firmId);
    },
    deleteFirm: function (id, firmId) {
      var db = dbRead(), slot = sessSlot(db, id);
      delete slot.firms[firmId];
      dbWrite(db);
      return Promise.resolve();
    },
    // Atomic join: re-reads inside the write so two teammates joining close
    // together never drop a membership (read-modify-write happens here, not
    // against a stale UI snapshot).
    addFirmMember: function (id, firmId, member) {
      var db = dbRead(), slot = sessSlot(db, id);
      var f = slot.firms[firmId];
      if (!f) return Promise.reject(new Error('firm gone'));
      f.members = (f.members || []).concat([member]);
      f.memberUids = (f.memberUids || []).concat(f.memberUids && f.memberUids.indexOf(member.uid) !== -1 ? [] : [member.uid]);
      dbWrite(db);
      return Promise.resolve();
    },
    watchFirms: function (id, cb) {
      return addWatcher(function () { return objToArr((dbRead().sessions[id] || {}).firms); }, cb);
    },
    // -- decisions
    saveDecision: function (id, firmId, round, dec) {
      var db = dbRead(), slot = sessSlot(db, id);
      slot.decisions[firmId + '_' + round] = dec;
      dbWrite(db);
      return Promise.resolve();
    },
    getDecision: function (id, firmId, round) {
      var db = dbRead();
      return Promise.resolve(((db.sessions[id] || {}).decisions || {})[firmId + '_' + round] || null);
    },
    // live view of ONE firm-round decision (teammate sync on shared drafts)
    watchDecision: function (id, firmId, round, cb) {
      return addWatcher(function () {
        return ((dbRead().sessions[id] || {}).decisions || {})[firmId + '_' + round] || null;
      }, cb);
    },
    // -- async practice instances (one private game per firm)
    saveAsync: function (id, firmId, doc) {
      var db = dbRead(), slot = sessSlot(db, id);
      if (!slot.async) slot.async = {};
      slot.async[firmId] = doc;
      dbWrite(db);
      return Promise.resolve();
    },
    watchAsync: function (id, firmId, cb) {
      return addWatcher(function () {
        return ((dbRead().sessions[id] || {}).async || {})[firmId] || null;
      }, cb);
    },
    watchAsyncAll: function (id, cb) {
      return addWatcher(function () {
        var o = (dbRead().sessions[id] || {}).async || {};
        return Object.keys(o).map(function (k) { return o[k]; });
      }, cb);
    },
    watchDecisions: function (id, cb) {
      return addWatcher(function () {
        var o = (dbRead().sessions[id] || {}).decisions || {};
        return Object.keys(o).map(function (k) { return o[k]; });
      }, cb);
    },
    // -- results & markets
    watchResults: function (id, cb) {
      return addWatcher(function () {
        var o = (dbRead().sessions[id] || {}).results || {};
        return Object.keys(o).map(function (k) { return o[k]; });
      }, cb);
    },
    watchMarkets: function (id, cb) {
      return addWatcher(function () {
        var o = (dbRead().sessions[id] || {}).markets || {};
        return Object.keys(o).map(function (k) { return o[k]; });
      }, cb);
    },
    saveResolution: function (id, round, payload) {
      var db = dbRead(), slot = sessSlot(db, id);
      Object.keys(payload.results).forEach(function (fid) {
        slot.results[fid + '_' + round] = payload.results[fid];
      });
      slot.markets['r' + round] = payload.market;
      if (slot.doc) Object.assign(slot.doc, payload.sessionPatch || {});
      dbWrite(db);
      return Promise.resolve();
    },
    // -- admin auth (open in demo mode)
    adminSignIn: function () { return Promise.resolve({ email: 'demo' }); },
    adminSignOut: function () { return Promise.resolve(); },
    onAdminAuth: function (cb) { setTimeout(function () { cb({ email: 'demo' }); }, 0); }
  };

  if (!configured) return demo;

  /* =====================================================================
     FIREBASE backend
     ===================================================================== */
  var sdk = null, app = null, auth = null, db = null, readyP = null;

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
    if (readyP) return readyP;
    readyP = loadSdk().then(function (s) {
      app = s.app.initializeApp(cfg);
      auth = s.auth.getAuth(app);
      db = s.fs.getFirestore(app);
      return true;
    });
    return readyP;
  }
  // Keep an existing session (the admin's email/password session) — only sign
  // in anonymously when there is none. Crucially, WAIT for the SDK to finish
  // restoring any persisted session first: checking auth.currentUser too early
  // would see null and signInAnonymously would REPLACE the instructor's
  // persisted admin session (e.g. when they open the student link in the same
  // browser mid-class). authStateReady() exists since SDK 10.7.
  function ensureAuth() {
    var settled = auth.authStateReady ? auth.authStateReady() : Promise.resolve();
    return settled.then(function () {
      if (auth.currentUser) return auth.currentUser;
      return sdk.auth.signInAnonymously(auth).then(function (c) { return c.user; });
    });
  }
  function sessRef(id) { return sdk.fs.doc(db, PATHS.sessions, id); }
  function subCol(id, name) { return sdk.fs.collection(db, PATHS.sessions, id, name); }
  // code → sessionId lookup docs, so students resolve a join code with two
  // point reads instead of listing the whole sessions collection (which the
  // rules therefore no longer need to allow for students).
  function codeRef(code) { return sdk.fs.doc(db, PATHS.codes || 'sscSessionCodes', code); }

  function watchDoc(ref, cb) {
    return sdk.fs.onSnapshot(ref, function (snap) {
      cb(snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null);
    }, function (err) { console.error('watch error', err); });
  }
  function watchCol(col, cb, sortKey) {
    return sdk.fs.onSnapshot(col, function (qs) {
      var out = [];
      qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      if (sortKey) out.sort(function (a, b) { return (a[sortKey] || 0) - (b[sortKey] || 0); });
      cb(out);
    }, function (err) { console.error('watch error', err); });
  }
  // Watchers may be requested before init resolves; wrap to defer.
  function deferWatch(make) {
    var stop = null, dead = false;
    init().then(ensureAuth).then(function () { if (!dead) stop = make(); })
      .catch(function (e) { console.error(e); });
    return function () { dead = true; if (stop) try { stop(); } catch (e) {} };
  }

  var fb = {
    backend: 'firebase',
    ready: init(),
    uid: function () { return init().then(ensureAuth).then(function (u) { return u.uid; }); },
    listSessions: function () {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.getDocs(sdk.fs.collection(db, PATHS.sessions));
      }).then(function (qs) {
        var out = [];
        qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
        out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return out;
      });
    },
    // Two point reads via the code-lookup doc: no collection listing needed,
    // so students can't enumerate other sessions. A stale lookup (code later
    // changed) fails the code-match verification and returns null.
    getSessionByCode: function (code) {
      code = String(code || '').trim().toUpperCase();
      if (!code) return Promise.resolve(null);
      return init().then(ensureAuth).then(function () {
        return sdk.fs.getDoc(codeRef(code));
      }).then(function (snap) {
        var sid = snap.exists() ? (snap.data() || {}).sessionId : null;
        if (!sid) return null;
        return sdk.fs.getDoc(sessRef(sid)).then(function (s2) {
          if (!s2.exists()) return null;
          var doc = Object.assign({ id: s2.id }, s2.data());
          return doc.code === code && !doc.archived ? doc : null;
        });
      });
    },
    createSession: function (data) {
      return init().then(function () {
        return sdk.fs.addDoc(sdk.fs.collection(db, PATHS.sessions), data);
      }).then(function (ref) {
        return sdk.fs.setDoc(ref, { id: ref.id }, { merge: true })
          .then(function () {
            return data.code ? sdk.fs.setDoc(codeRef(data.code), { sessionId: ref.id }) : null;
          })
          .then(function () { return ref.id; });
      });
    },
    updateSession: function (id, patch) {
      return init().then(function () { return sdk.fs.setDoc(sessRef(id), patch, { merge: true }); })
        .then(function () {
          return patch && patch.code ? sdk.fs.setDoc(codeRef(patch.code), { sessionId: id }) : null;
        });
    },
    deleteSession: function (id) {
      // delete subcollection docs + the code lookup first (Firestore doesn't cascade)
      return init().then(function () {
        return sdk.fs.getDoc(sessRef(id)).then(function (snap) {
          var code = snap.exists() ? (snap.data() || {}).code : null;
          return code ? sdk.fs.deleteDoc(codeRef(code)).catch(function () {}) : null;
        });
      }).then(function () {
        var subs = ['firms', 'decisions', 'results', 'markets'];
        return Promise.all(subs.map(function (s2) {
          return sdk.fs.getDocs(subCol(id, s2)).then(function (qs) {
            var dels = [];
            qs.forEach(function (d) { dels.push(sdk.fs.deleteDoc(d.ref)); });
            return Promise.all(dels);
          });
        }));
      }).then(function () { return sdk.fs.deleteDoc(sessRef(id)); });
    },
    watchSession: function (id, cb) {
      return deferWatch(function () { return watchDoc(sessRef(id), cb); });
    },
    setFirm: function (id, firmId, data) {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.setDoc(sdk.fs.doc(db, PATHS.sessions, id, 'firms', firmId),
          Object.assign({}, data, { id: firmId }), { merge: true });
      }).then(function () { return firmId; });
    },
    deleteFirm: function (id, firmId) {
      return init().then(function () {
        return sdk.fs.deleteDoc(sdk.fs.doc(db, PATHS.sessions, id, 'firms', firmId));
      });
    },
    // arrayUnion: concurrent joins from different devices never drop a member
    addFirmMember: function (id, firmId, member) {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.updateDoc(sdk.fs.doc(db, PATHS.sessions, id, 'firms', firmId), {
          members: sdk.fs.arrayUnion(member),
          memberUids: sdk.fs.arrayUnion(member.uid)
        });
      });
    },
    watchFirms: function (id, cb) {
      return deferWatch(function () { return watchCol(subCol(id, 'firms'), cb, 'createdAt'); });
    },
    saveDecision: function (id, firmId, round, dec) {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.setDoc(sdk.fs.doc(db, PATHS.sessions, id, 'decisions', firmId + '_' + round), dec);
      });
    },
    getDecision: function (id, firmId, round) {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.getDoc(sdk.fs.doc(db, PATHS.sessions, id, 'decisions', firmId + '_' + round));
      }).then(function (snap) { return snap.exists() ? snap.data() : null; });
    },
    watchDecision: function (id, firmId, round, cb) {
      return deferWatch(function () {
        return watchDoc(sdk.fs.doc(db, PATHS.sessions, id, 'decisions', firmId + '_' + round), cb);
      });
    },
    saveAsync: function (id, firmId, doc) {
      return init().then(ensureAuth).then(function () {
        return sdk.fs.setDoc(sdk.fs.doc(db, PATHS.sessions, id, 'async', firmId), doc);
      });
    },
    watchAsync: function (id, firmId, cb) {
      return deferWatch(function () {
        return watchDoc(sdk.fs.doc(db, PATHS.sessions, id, 'async', firmId), cb);
      });
    },
    watchAsyncAll: function (id, cb) {
      return deferWatch(function () { return watchCol(subCol(id, 'async'), cb, 'createdAt'); });
    },
    watchDecisions: function (id, cb) {
      return deferWatch(function () { return watchCol(subCol(id, 'decisions'), cb); });
    },
    watchResults: function (id, cb) {
      return deferWatch(function () { return watchCol(subCol(id, 'results'), cb); });
    },
    watchMarkets: function (id, cb) {
      return deferWatch(function () { return watchCol(subCol(id, 'markets'), cb); });
    },
    saveResolution: function (id, round, payload) {
      return init().then(function () {
        var writes = Object.keys(payload.results).map(function (fid) {
          return sdk.fs.setDoc(sdk.fs.doc(db, PATHS.sessions, id, 'results', fid + '_' + round),
            payload.results[fid]);
        });
        writes.push(sdk.fs.setDoc(sdk.fs.doc(db, PATHS.sessions, id, 'markets', 'r' + round), payload.market));
        return Promise.all(writes);
      }).then(function () {
        // session patch last: when phase flips, everything else is in place
        return sdk.fs.setDoc(sessRef(id), payload.sessionPatch || {}, { merge: true });
      });
    },
    adminSignIn: function (email, pw) {
      return init().then(function () {
        return sdk.auth.signInWithEmailAndPassword(auth, email, pw);
      }).then(function (c) { return c.user; });
    },
    adminSignOut: function () { return init().then(function () { return sdk.auth.signOut(auth); }); },
    onAdminAuth: function (cb) {
      init().then(function () { sdk.auth.onAuthStateChanged(auth, cb); })
        .catch(function () { cb(null); });
    }
  };
  return fb;
})();
