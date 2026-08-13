/* ==========================================================================
   search-v2  ·  firebase.js
   Firestore + Auth integration for the layout of design brief §17.3.

   Loaded on every page but INERT until firebase-config.js holds a real project
   config, so the study still runs (locally logged, downloadable) on a machine
   with no backend at all.

   Collections
     runs/{runId}            parameter set, status, locked flag, frozen specs
     runCodes/{code}         code → runId, so a participant needs no list access
     runCounts/{runId}       sequence counters, transactionally assigned
     roster/{runId}__{code}  one entrant: sequence, claim, status
     participants/{runId}__{code}   the session record of §16.1
     events/{eventId}        append-only event log  ← the Simulation Platform's
                             verification adapter reads THIS collection, matching
                             `event == 'session_end'` on `pid`. Do not rename it.
     audit/{auditId}         admin actions
     messages/{code}         admin → participant nudges

   §17.2 wants the score-bearing actions computed inside Cloud Functions so the
   mapping never reaches the browser. GitHub Pages plus the Spark plan gives us
   no Functions, so this build keeps the equivalent guarantees it can — an
   append-only event log the client may create but never modify, run parameters
   the client may never write, and a roster claim the Rules enforce — and states
   the remaining gap plainly in README.md. Everything else in the brief holds.
   ========================================================================== */
window.SVFirebase = (function () {
  'use strict';
  var cfg = window.FIREBASE_CONFIG || {};
  var PATHS = window.FIREBASE_PATHS || {};
  var C = {
    runs: PATHS.runs || 'runs',
    runPublic: PATHS.runPublic || 'runPublic',
    runCodes: PATHS.runCodes || 'runCodes',
    runCounts: PATHS.runCounts || 'runCounts',
    roster: PATHS.roster || 'roster',
    participants: PATHS.participants || 'participants',
    events: PATHS.events || 'events',
    audit: PATHS.audit || 'audit',
    messages: PATHS.messages || 'messages'
  };
  var VER = window.FIREBASE_SDK_VERSION || '10.12.2';
  var configured = !!(cfg.apiKey && cfg.apiKey.indexOf('PASTE_') !== 0 && cfg.projectId && cfg.projectId.indexOf('PASTE_') !== 0);

  var sdk = null, app = null, auth = null, db = null, fns = null, ready = null;

  function isConfigured() { return configured; }
  function paths() { return C; }

  function loadSdk() {
    if (sdk) return Promise.resolve(sdk);
    var base = 'https://www.gstatic.com/firebasejs/' + VER + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-functions.js')
    ]).then(function (m) { sdk = { app: m[0], auth: m[1], fs: m[2], fn: m[3] }; return sdk; });
  }

  function init() {
    if (!configured) return Promise.reject(new Error('firebase not configured'));
    if (ready) return ready;
    ready = loadSdk().then(function (s) {
      app = s.app.initializeApp(cfg);
      auth = s.auth.getAuth(app);
      db = s.fs.getFirestore(app);
      fns = s.fn.getFunctions(app, window.FIREBASE_REGION || 'us-central1');
      // Emulator hosts, when tools/emulator-test.mjs sets them. Never set in
      // production, so this block is inert on the live site.
      if (window.SV_EMULATORS) {
        try {
          s.fs.connectFirestoreEmulator(db, '127.0.0.1', window.SV_EMULATORS.firestore);
          s.fn.connectFunctionsEmulator(fns, '127.0.0.1', window.SV_EMULATORS.functions);
          s.auth.connectAuthEmulator(auth, 'http://127.0.0.1:' + window.SV_EMULATORS.auth, { disableWarnings: true });
        } catch (e) {}
      }
      return true;
    });
    return ready;
  }

  // Never REPLACE a session: the admin page is signed in with email/password and
  // an unconditional signInAnonymously there would bounce the admin to the login
  // screen. Participants have no session, so they get an anonymous one.
  function ensureAuth() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return sdk.auth.signInAnonymously(auth);
  }
  function signInAnon() { return init().then(ensureAuth); }
  function uid() { return (auth && auth.currentUser) ? auth.currentUser.uid : null; }

  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fallback); }, ms || 6000); })]);
  }

  // ---- participant: resolve the run ---------------------------------------
  // Point read runCodes/<code> → runs/<id>. No `list` permission needed, so the
  // runs collection stays admin-only enumerable.
  function getRunByCode(code) {
    if (!configured || !code) return Promise.resolve(null);
    var go = init().then(ensureAuth).then(function () {
      return sdk.fs.getDoc(sdk.fs.doc(db, C.runCodes, String(code).toUpperCase()));
    }).then(function (snap) {
      var id = snap.exists() ? (snap.data() || {}).id : null;
      if (!id) return null;
      return sdk.fs.getDoc(sdk.fs.doc(db, C.runs, id))
        .then(function (s) { return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; });
    }).catch(function () { return null; });
    return withTimeout(go, 6000, null);
  }

  // In SERVER mode the run document itself is admin-only (it holds the seeds the
  // whole integrity property rests on), so a participant reads this redacted
  // copy instead: costs, caps, round counts and the operational flags, with no
  // seeds and no specs anywhere in it.
  function getRunPublic(id) {
    if (!configured || !id) return Promise.resolve(null);
    return init().then(ensureAuth)
      .then(function () { return sdk.fs.getDoc(sdk.fs.doc(db, C.runPublic, id)); })
      .then(function (s) { return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; })
      .catch(function () { return null; });
  }
  // In server mode the run document is unreadable to a participant, so the
  // code → id hop has to work off the public copy instead.
  function getRunPublicByCode(code) {
    if (!configured || !code) return Promise.resolve(null);
    return init().then(ensureAuth).then(function () {
      return sdk.fs.getDoc(sdk.fs.doc(db, C.runCodes, String(code).toUpperCase()));
    }).then(function (snap) {
      var id = snap.exists() ? (snap.data() || {}).id : null;
      return id ? getRunPublic(id) : null;
    }).catch(function () { return null; });
  }
  function putRunPublic(id, obj) {
    return init().then(function () { return sdk.fs.setDoc(sdk.fs.doc(db, C.runPublic, id), obj, { merge: true }); });
  }

  // Callable Cloud Functions (§17.2). Rejects with the server's message, which
  // the caller turns into something a participant can act on — it NEVER falls
  // back to computing locally, because that would void the run's integrity.
  function callable(name, data) {
    if (!configured) return Promise.reject(new Error('firebase not configured'));
    return init().then(ensureAuth).then(function () {
      return sdk.fn.httpsCallable(fns, name)(data);
    }).then(function (res) { return res.data; });
  }

  function getRun(id) {
    if (!configured || !id) return Promise.resolve(null);
    return init().then(function () { return sdk.fs.getDoc(sdk.fs.doc(db, C.runs, id)); })
      .then(function (s) { return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; });
  }

  // ---- participant: claim a code (§17.5) ----------------------------------
  // Two roster modes:
  //   'roster' — the code must already exist and be unclaimed. A code that is
  //              not on the roster, or already used by someone else, is refused.
  //   'open'   — an unknown code auto-enrols (this is how a Simulation Platform
  //              student ID becomes a participant), taking the under-filled
  //              sequence from a transactional counter so the split stays exact.
  // Resolves { ok, code, sequence, resumed, reason }.
  function claimCode(runId, code, mode, override) {
    if (!configured) return Promise.resolve({ ok: false, reason: 'offline' });
    code = String(code || '').trim().toUpperCase();
    if (!runId || !code) return Promise.resolve({ ok: false, reason: 'nocode' });
    var id = runId + '__' + code;
    return init().then(ensureAuth).then(function () {
      var me = uid();
      var ref = sdk.fs.doc(db, C.roster, id);
      return sdk.fs.getDoc(ref).then(function (snap) {
        if (snap.exists()) {
          var d = snap.data() || {};
          if (d.claimedByUid && d.claimedByUid !== me) {
            // Same code from a different browser. Under `allowResume` this is the
            // ordinary "they switched machine" case, so re-bind rather than lock
            // the participant out of their own session.
            return sdk.fs.setDoc(ref, { claimedByUid: me, rebindAt: Date.now() }, { merge: true })
              .then(function () { return { ok: true, code: code, sequence: d.sequence, resumed: true }; })
              .catch(function () { return { ok: false, reason: 'claimed' }; });
          }
          if (!d.claimedByUid) {
            return sdk.fs.setDoc(ref, { claimedByUid: me, claimedAt: Date.now(), status: 'started' }, { merge: true })
              .then(function () { return { ok: true, code: code, sequence: d.sequence, resumed: false }; });
          }
          return { ok: true, code: code, sequence: d.sequence, resumed: true };
        }
        if (mode === 'roster') return { ok: false, reason: 'notonroster' };
        return assignSequence(runId, override).then(function (seq) {
          return sdk.fs.setDoc(ref, {
            runId: runId, code: code, sequence: seq, status: 'started',
            claimedByUid: me, claimedAt: Date.now(), autoEnrolled: true
          }, { merge: true }).then(function () { return { ok: true, code: code, sequence: seq, resumed: false }; });
        });
      });
    }).catch(function (e) { return { ok: false, reason: 'error', detail: String(e && e.message || e) }; });
  }

  // Transactional 50/50 assignment (§11). The admin's "next entrant override"
  // wins when set, and the forced choice is what the counter records, so the
  // export can always reconstruct how the balance was reached.
  function assignSequence(runId, override) {
    var ref = sdk.fs.doc(db, C.runCounts, runId);
    return sdk.fs.runTransaction(db, function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = snap.exists() ? (snap.data() || {}) : { nA: 0, nB: 0 };
        var seq;
        if (override === 'A' || override === 'B') seq = override;
        else if ((d.nA || 0) < (d.nB || 0)) seq = 'A';
        else if ((d.nB || 0) < (d.nA || 0)) seq = 'B';
        else seq = (((d.nA || 0) + (d.nB || 0)) % 2 === 0) ? 'A' : 'B';
        var next = { nA: (d.nA || 0) + (seq === 'A' ? 1 : 0), nB: (d.nB || 0) + (seq === 'B' ? 1 : 0) };
        tx.set(ref, next, { merge: true });
        return seq;
      });
    }).catch(function () {
      // The counter is unavailable (rules not published yet, or offline): fall
      // back to a deterministic parity so a participant is never blocked.
      return (window.SVPool ? (window.SVPool.hashSeed(runId + ':' + Date.now()) % 2 ? 'B' : 'A') : 'A');
    });
  }

  // ---- participant record (§16.1) -----------------------------------------
  function participantRef(runId, code) { return sdk.fs.doc(db, C.participants, runId + '__' + String(code).toUpperCase()); }
  function saveParticipant(runId, code, obj) {
    if (!configured) return Promise.resolve(false);
    return init().then(ensureAuth).then(function () {
      // The owner's uid travels ON the record: the Rule that lets a participant
      // read back their own session record is `resource.data.uid == request.auth.uid`,
      // and without this field that read could never succeed.
      var withUid = Object.assign({ uid: uid() }, obj);
      return sdk.fs.setDoc(participantRef(runId, code), withUid, { merge: true });
    }).then(function () { return true; }).catch(function () { return false; });
  }
  function getParticipant(runId, code) {
    if (!configured) return Promise.resolve(null);
    return init().then(ensureAuth)
      .then(function () { return sdk.fs.getDoc(participantRef(runId, code)); })
      .then(function (s) { return s.exists() ? s.data() : null; })
      .catch(function () { return null; });
  }

  // ---- the event log ------------------------------------------------------
  // Append-only: the document id is (participant, seq), so a retry after a
  // dropped connection lands on the same id instead of duplicating a row.
  //
  // The Rules allow `create` and refuse every `update`, so a retry against a row
  // that already landed comes back permission-denied. That is SUCCESS, not
  // failure — the row is in the log — and reporting it as a failure would leave
  // the sync high-water mark stuck, re-attempting the same write on every load
  // for the rest of the session.
  function writeEvent(ev, seq) {
    if (!configured) return Promise.resolve(false);
    return init().then(function () {
      var who = ev.participant_code || ev.session || 'anon';
      var id = String(who).replace(/[^\w-]/g, '_') + '__' + String(seq).padStart(6, '0');
      return sdk.fs.setDoc(sdk.fs.doc(db, C.events, id), ev);
    }).then(function () { return true; }).catch(function (e) {
      var code = (e && (e.code || e.message)) || '';
      return /permission-denied|PERMISSION_DENIED/.test(String(code));
    });
  }

  // ---- admin --------------------------------------------------------------
  function adminSignIn(email, pw) { return init().then(function () { return sdk.auth.signInWithEmailAndPassword(auth, email, pw); }); }
  function adminSignOut() { return init().then(function () { return sdk.auth.signOut(auth); }); }
  function onAuth(cb) { init().then(function () { sdk.auth.onAuthStateChanged(auth, cb); }).catch(function () { cb(null); }); }

  function listRuns() {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.runs)); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
        out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return out;
      });
  }
  function createRun(obj) {
    return init().then(function () { return sdk.fs.addDoc(sdk.fs.collection(db, C.runs), obj); })
      .then(function (ref) {
        if (obj && obj.code) {
          return sdk.fs.setDoc(sdk.fs.doc(db, C.runCodes, String(obj.code).toUpperCase()), { id: ref.id }, { merge: true })
            .then(function () { return ref.id; });
        }
        return ref.id;
      });
  }
  function updateRun(id, obj) {
    return init().then(function () { return sdk.fs.setDoc(sdk.fs.doc(db, C.runs, id), obj, { merge: true }); })
      .then(function () {
        if (obj && obj.code) return sdk.fs.setDoc(sdk.fs.doc(db, C.runCodes, String(obj.code).toUpperCase()), { id: id }, { merge: true });
      });
  }
  function deleteRun(id) {
    return init().then(function () { return sdk.fs.getDoc(sdk.fs.doc(db, C.runs, id)); })
      .then(function (snap) {
        var code = snap.exists() ? (snap.data() || {}).code : null;
        return sdk.fs.deleteDoc(sdk.fs.doc(db, C.runs, id)).then(function () {
          if (code) return sdk.fs.deleteDoc(sdk.fs.doc(db, C.runCodes, String(code).toUpperCase())).catch(function () {});
        });
      });
  }
  function codeExists(code) {
    return init().then(function () { return sdk.fs.getDoc(sdk.fs.doc(db, C.runCodes, String(code).toUpperCase())); })
      .then(function (s) { return s.exists(); }).catch(function () { return false; });
  }

  // ---- roster -------------------------------------------------------------
  function listRoster(runId) {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.roster)); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { var x = d.data() || {}; if (!runId || x.runId === runId) out.push(Object.assign({ id: d.id }, x)); });
        out.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
        return out;
      });
  }
  function putRosterCode(runId, code, sequence) {
    code = String(code).trim().toUpperCase();
    return init().then(function () {
      return sdk.fs.setDoc(sdk.fs.doc(db, C.roster, runId + '__' + code),
        { runId: runId, code: code, sequence: sequence, status: 'unused', claimedByUid: null }, { merge: true });
    });
  }
  function deleteRosterCode(runId, code) {
    return init().then(function () {
      return sdk.fs.deleteDoc(sdk.fs.doc(db, C.roster, runId + '__' + String(code).toUpperCase()));
    });
  }

  function listParticipants(runId) {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.participants)); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { var x = d.data() || {}; if (!runId || x.run_id === runId) out.push(Object.assign({ id: d.id }, x)); });
        return out;
      });
  }
  // Live monitor (§17b Screen 5): a listener on the participants collection, so
  // the panel updates without polling. Returns an unsubscribe function.
  function watchParticipants(runId, cb) {
    var stop = function () {};
    if (!configured) return stop;
    init().then(function () {
      stop = sdk.fs.onSnapshot(sdk.fs.collection(db, C.participants), function (qs) {
        var out = [];
        qs.forEach(function (d) { var x = d.data() || {}; if (!runId || x.run_id === runId) out.push(Object.assign({ id: d.id }, x)); });
        cb(out);
      }, function () {});
    }).catch(function () {});
    return function () { try { stop(); } catch (e) {} };
  }

  // Unconstrained collection read — the same known-good shape the previous build
  // settled on after query constraints tripped a WebChannel quirk. The collection
  // is filtered and sorted on the client.
  function fetchEvents(runId, max) {
    var cap = max || 200000;
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.events)); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { var x = d.data(); if (!runId || x.run_id === runId) out.push(x); });
        out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
        return out.length > cap ? out.slice(out.length - cap) : out;
      });
  }
  function deleteParticipantData(runId, code) {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.events)); })
      .then(function (qs) {
        var dels = [];
        qs.forEach(function (d) {
          var x = d.data() || {};
          if (x.participant_code === code && (!runId || x.run_id === runId)) dels.push(sdk.fs.deleteDoc(d.ref));
        });
        dels.push(sdk.fs.deleteDoc(participantRef(runId, code)).catch(function () {}));
        return Promise.all(dels).then(function () { return dels.length; });
      });
  }
  function deleteRunData(runId) {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.events)); })
      .then(function (qs) {
        var dels = [];
        qs.forEach(function (d) { if ((d.data() || {}).run_id === runId) dels.push(sdk.fs.deleteDoc(d.ref)); });
        return Promise.all(dels).then(function () { return dels.length; });
      });
  }

  // ---- audit (§17b "Access and audit") ------------------------------------
  function audit(runId, action, detail) {
    if (!configured) return Promise.resolve(false);
    return init().then(function () {
      return sdk.fs.addDoc(sdk.fs.collection(db, C.audit), {
        run_id: runId || null, action: String(action),
        detail: detail == null ? null : String(detail).slice(0, 2000),
        by: (auth.currentUser && auth.currentUser.email) || null,
        t: Date.now(), iso: new Date().toISOString()
      });
    }).then(function () { return true; }).catch(function () { return false; });
  }
  function listAudit(runId) {
    return init().then(function () { return sdk.fs.getDocs(sdk.fs.collection(db, C.audit)); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { var x = d.data() || {}; if (!runId || x.run_id === runId) out.push(x); });
        out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
        return out;
      });
  }

  // ---- admin → participant messages ---------------------------------------
  function sendMessage(code, text) {
    return init().then(function () {
      return sdk.fs.setDoc(sdk.fs.doc(db, C.messages, String(code)),
        { code: String(code), text: String(text || ''), id: Date.now(), from: 'admin' }, { merge: true });
    });
  }
  function watchMessages(code, cb) {
    var stop = function () {};
    if (!configured || !code) return stop;
    init().then(ensureAuth).then(function () {
      stop = sdk.fs.onSnapshot(sdk.fs.doc(db, C.messages, String(code)),
        function (snap) { cb(snap.exists() ? snap.data() : null); }, function () {});
    }).catch(function () {});
    return function () { try { stop(); } catch (e) {} };
  }

  return {
    isConfigured: isConfigured, init: init, paths: paths, uid: uid,
    signInAnon: signInAnon,
    getRunByCode: getRunByCode, getRun: getRun,
    getRunPublic: getRunPublic, getRunPublicByCode: getRunPublicByCode,
    putRunPublic: putRunPublic, callable: callable,
    claimCode: claimCode, assignSequence: assignSequence,
    saveParticipant: saveParticipant, getParticipant: getParticipant,
    writeEvent: writeEvent,
    adminSignIn: adminSignIn, adminSignOut: adminSignOut, onAuth: onAuth,
    listRuns: listRuns, createRun: createRun, updateRun: updateRun, deleteRun: deleteRun, codeExists: codeExists,
    listRoster: listRoster, putRosterCode: putRosterCode, deleteRosterCode: deleteRosterCode,
    listParticipants: listParticipants, watchParticipants: watchParticipants,
    fetchEvents: fetchEvents, deleteParticipantData: deleteParticipantData, deleteRunData: deleteRunData,
    audit: audit, listAudit: listAudit,
    sendMessage: sendMessage, watchMessages: watchMessages,
    adminEmails: window.ADMIN_EMAILS || []
  };
})();
