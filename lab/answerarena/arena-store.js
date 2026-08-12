/* =====================================================================
   Answer Arena — storage / backend abstraction (window.ArenaStore)
   ---------------------------------------------------------------------
   One async API used by BOTH the participant app (arena-app.js) and the
   admin panel (admin.js), with two interchangeable implementations:

     * Firebase  — used when lab/answerarena/arena-config.js holds a real config.
                   Named Firebase app 'answerarena' (so it never collides
                   with the page's other Firebase apps), Auth + Firestore.
     * Local     — localStorage fallback used until Firebase is configured,
                   so the entire flow is clickable offline for testing.

   Firestore data model (see _lab-arena-firebase/README.md):
     config/app                  texts, settings, registration/survey Qs, activeTaskSetId
     taskSets/{id}               { name, source, tasks:[{id,task,outputA,outputB,...}] }
     sessions/{id}               { code, name, status, taskSetId, condition, count }
     participants/{uid}          participantId, email, registration{}, status,
                                 sessionId(current), condition{}, completedSessions{},
                                 order[], flips[], idx
       responses/{autoId}        one doc per comparison (tagged with sessionId)
       events/{autoId}           one doc per decision/change (type,value,...,ts)
       survey/{sessionId}        { sessionId, answers, completedAt }
   ===================================================================== */
(function () {
  'use strict';

  var DEFAULTS = window.ARENA_DEFAULTS || {};
  var ADMIN_EMAIL = window.ARENA_ADMIN_EMAIL || 'admin@admin.com';
  var SDK = window.ARENA_FB_SDK || '10.12.2';
  var FB_BASE = 'https://www.gstatic.com/firebasejs/' + SDK + '/';

  /* ================================================================
     TEST ROUND ("preview") — a throwaway sandbox that writes NOTHING
     ----------------------------------------------------------------
     Opened by the admin's 🧪 Test round button as
     ?preview=1&key=stouras[&s=CODE]: the whole participant flow runs
     against an ISOLATED localStorage namespace with the LOCAL backend, so
     Firebase is never touched — no participant docs, no responses, no
     events, nothing to clean up afterwards. Mirrors the ideasearchlab
     sandbox (src/utils/preview.js) and sustainable-supply-chains' ?preview=1.

     The admin seeds it before opening the tab (ARENA_PREVIEW.SEED_KEY:
     the effective config + the session + its task set). A page RELOAD keeps
     the sandbox's progress; a NEW launch (a fresh seed stamp) wipes it.
     ================================================================ */
  var PREVIEW_KEY = 'stouras';
  var PREVIEW_PREFIX = 'arena:preview:';
  var PREVIEW_SEED_KEY = 'arena:preview:seed';
  var previewOn = (function () {
    try {
      var p = new URLSearchParams(location.search);
      return p.get('preview') === '1' && p.get('key') === PREVIEW_KEY;
    } catch (e) { return false; }
  })();
  window.ARENA_PREVIEW = {
    on: previewOn,
    KEY: PREVIEW_KEY,
    PREFIX: PREVIEW_PREFIX,
    SEED_KEY: PREVIEW_SEED_KEY,
    // The URL the admin opens for a test round of `session` (or of the default
    // configuration when no session is given).
    launchUrl: function (session) {
      var base = location.origin + location.pathname + '?preview=1&key=' + PREVIEW_KEY;
      return session && session.code ? (base + '&s=' + encodeURIComponent(session.code)) : base;
    },
    // Hand the sandbox everything it needs, then it is self-contained.
    seed: function (payload) {
      try {
        localStorage.setItem(PREVIEW_SEED_KEY, JSON.stringify(
          Object.assign({ ts: Date.now() }, payload || {})
        ));
        return true;
      } catch (e) { return false; }
    }
  };

  function uid() { return 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function clone(o) { return JSON.parse(JSON.stringify(o || null)); }
  function code6() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  }
  // Tiny non-crypto hash, only to avoid storing local test passwords in plain text.
  function hash(s) { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); }

  /* ---- Which sessions a participant doc touches -------------------------
     A participant is not owned by one session: `sessionId` is the CURRENT
     one, `playedSessions` / `completedSessions` are maps of every session
     they started / finished. Both backends' deleteSessionData() use these to
     decide whether removing a session empties a participant record entirely
     (then the whole record goes) or only part of it (then just that
     session's rows go). Keep the two implementations in step. */
  function sessionKeysOf(p) {
    var set = {};
    if (p && p.sessionId) set[p.sessionId] = 1;
    ['playedSessions', 'completedSessions'].forEach(function (k) {
      if (p && p[k]) Object.keys(p[k]).forEach(function (s) { if (s) set[s] = 1; });
    });
    return Object.keys(set);
  }
  function touchesSession(p, sid) { return sessionKeysOf(p).indexOf(sid) >= 0; }
  function onlySession(p, sid) { var ks = sessionKeysOf(p); return ks.length === 1 && ks[0] === sid; }
  function rowSid(r) { return (r && r.sessionId) || '_none'; }

  /* ================================================================
     LOCAL backend (localStorage)
     ================================================================ */
  function LocalBackend(prefix) {
    // `prefix` namespaces the whole store, so the TEST-ROUND sandbox
    // ('arena:preview:') can never read or write the normal offline data
    // ('arena:').
    var NS = prefix || 'arena:';
    var KEY = NS + 'db';
    var UID_KEY = NS + 'uid';
    var authCb = null, cur = null;

    function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
    function write(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
    function db() {
      var d = read();
      d.users = d.users || {};            // emailLower -> { uid, email, passHash }
      d.config = d.config || {};
      d.taskSets = d.taskSets || {};      // id -> set
      d.sessions = d.sessions || {};      // id -> session
      d.participants = d.participants || {}; // uid -> doc (with .responses/.events/.survey inline)
      return d;
    }
    function sessionUid() { try { return localStorage.getItem(UID_KEY) || null; } catch (e) { return null; } }
    function setSessionUid(u) { try { if (u) localStorage.setItem(UID_KEY, u); else localStorage.removeItem(UID_KEY); } catch (e) {} }

    // Wipe this namespace and (re)seed it from the admin's test-round payload:
    // the effective config, the session being rehearsed (forced open) and its
    // task set. Called once per launch — a reload reuses the same seed stamp
    // and therefore keeps the sandbox's progress.
    this.seedFrom = function (seed) {
      var d = {
        users: {}, config: {}, taskSets: {}, sessions: {}, participants: {},
        _seedTs: (seed && seed.ts) || 0
      };
      if (seed && seed.config) d.config = clone(seed.config) || {};
      // An EMPTY task set is treated as "no set", so the sandbox falls back to
      // the built-in sample comparisons rather than offering none at all.
      if (seed && seed.taskSet && seed.taskSet.tasks && seed.taskSet.tasks.length) {
        var tsId = seed.taskSet.id || 'preview-set';
        d.taskSets[tsId] = Object.assign(clone(seed.taskSet), { id: tsId });
        d.config.activeTaskSetId = tsId;
      } else {
        delete d.config.activeTaskSetId;   // fall back to the built-in default set
      }
      if (seed && seed.session && seed.session.code) {
        var sid = seed.session.id || 's_preview';
        d.sessions[sid] = Object.assign(clone(seed.session), {
          id: sid, status: 'open', count: 0,
          taskSetId: d.config.activeTaskSetId || null
        });
      }
      write(d);
      setSessionUid(null);
      cur = null;
    };
    this.seededTs = function () { return db()._seedTs || 0; };

    this.mode = 'local';
    this.init = function () {
      var u = sessionUid(), d = db();
      if (u && d.participants[u]) cur = { uid: u, email: d.participants[u].email };
      else if (u && d.adminEmail) cur = { uid: u, email: d.adminEmail };
      return Promise.resolve({ mode: 'local' });
    };
    this.onAuth = function (cb) { authCb = cb; cb(cur); };
    this.currentUser = function () { return cur; };

    this.register = function (email, password) {
      var d = db(), key = String(email).toLowerCase();
      if (d.users[key]) return Promise.reject({ code: 'auth/email-already-in-use' });
      var u = uid();
      d.users[key] = { uid: u, email: email, passHash: hash(password) };
      write(d); setSessionUid(u); cur = { uid: u, email: email };
      if (authCb) authCb(cur);
      return Promise.resolve(cur);
    };
    this.login = function (email, password) {
      var d = db(), key = String(email).toLowerCase();
      // The admin account works in local mode with any password (no real auth offline).
      if (key === ADMIN_EMAIL) { var au = 'admin-local'; setSessionUid(au); d.adminEmail = email; write(d); cur = { uid: au, email: email }; if (authCb) authCb(cur); return Promise.resolve(cur); }
      var rec = d.users[key];
      if (!rec) return Promise.reject({ code: 'auth/user-not-found' });
      if (rec.passHash !== hash(password)) return Promise.reject({ code: 'auth/wrong-password' });
      setSessionUid(rec.uid); cur = { uid: rec.uid, email: rec.email };
      if (authCb) authCb(cur);
      return Promise.resolve(cur);
    };
    // Anonymous play: mint a throwaway local uid (no e-mail / password). Mirrors
    // Firebase anonymous auth so the offline test flow matches production.
    this.signInAnonymously = function () {
      var u = 'anon-' + uid();
      setSessionUid(u); cur = { uid: u, email: null };
      if (authCb) authCb(cur);
      return Promise.resolve(cur);
    };
    this.logout = function () { setSessionUid(null); cur = null; if (authCb) authCb(null); return Promise.resolve(); };

    this.loadConfig = function () { return Promise.resolve(clone(db().config) || {}); };
    this.saveConfig = function (partial) { var d = db(); d.config = Object.assign({}, d.config, partial); write(d); return Promise.resolve(); };

    // Load a specific task set by id (built-in default when the id is empty or the
    // set is gone). Used for BOTH the active set and a session's snapshotted set.
    this.loadTaskSet = function (id) {
      if (id && db().taskSets[id]) return Promise.resolve(clone(db().taskSets[id]));
      return Promise.resolve({ id: 'builtin', name: 'Built-in default', tasks: clone(DEFAULTS.defaultTasks || []) });
    };
    this.loadActiveTasks = function () { return this.loadTaskSet((db().config || {}).activeTaskSetId); };
    this.saveTaskSet = function (set) {
      var d = db(), id = set.id || ('ts_' + uid());
      d.taskSets[id] = Object.assign({ id: id, createdAt: Date.now() }, set);
      d.config = Object.assign({}, d.config, { activeTaskSetId: id });
      write(d); return Promise.resolve(id);
    };
    this.listTaskSets = function () { var d = db(); return Promise.resolve(Object.keys(d.taskSets).map(function (k) { return clone(d.taskSets[k]); })); };

    this.listSessions = function () { var d = db(); return Promise.resolve(Object.keys(d.sessions).map(function (k) { return clone(d.sessions[k]); })); };
    this.createSession = function (data) {
      var d = db(), id = 's_' + uid(), c = (data.code || code6());
      d.sessions[id] = Object.assign({ id: id, code: c, status: 'waiting', count: 0, createdAt: Date.now() }, data, { id: id, code: c });
      write(d); return Promise.resolve(clone(d.sessions[id]));
    };
    this.updateSession = function (id, patch) { var d = db(); if (d.sessions[id]) { d.sessions[id] = Object.assign({}, d.sessions[id], patch); write(d); } return Promise.resolve(); };
    this.deleteSession = function (id) { var d = db(); delete d.sessions[id]; write(d); return Promise.resolve(); };
    this.getSessionByCode = function (c) {
      var d = db(), key = String(c).toUpperCase();
      var hit = Object.keys(d.sessions).map(function (k) { return d.sessions[k]; }).filter(function (s) { return (s.code || '').toUpperCase() === key; })[0];
      return Promise.resolve(hit ? clone(hit) : null);
    };

    this.getParticipant = function (u) { var d = db(); return Promise.resolve(d.participants[u] ? clone(d.participants[u]) : null); };
    this.setParticipant = function (u, data, merge) {
      var d = db(); d.participants[u] = merge ? Object.assign({}, d.participants[u], data) : data; write(d); return Promise.resolve();
    };
    this.listParticipants = function () { var d = db(); return Promise.resolve(Object.keys(d.participants).map(function (k) { return Object.assign({ _id: k }, clone(d.participants[k])); })); };

    this.addResponse = function (u, resp) { var d = db(); var p = d.participants[u] = d.participants[u] || {}; (p.responses = p.responses || []).push(resp); write(d); return Promise.resolve(); };
    this.listResponses = function (u) { var d = db(); return Promise.resolve(clone((d.participants[u] || {}).responses || [])); };
    this.addEvent = function (u, ev) { var d = db(); var p = d.participants[u] = d.participants[u] || {}; (p.events = p.events || []).push(ev); write(d); return Promise.resolve(); };
    this.listEvents = function (u) { var d = db(); return Promise.resolve(clone((d.participants[u] || {}).events || [])); };
    // One survey per session the participant takes part in (keyed by sessionId).
    this.saveSurvey = function (u, sid, answers) { var d = db(); var p = d.participants[u] = d.participants[u] || {}; p.surveys = p.surveys || {}; p.surveys[sid || '_none'] = { sessionId: sid || '_none', answers: answers, completedAt: Date.now() }; write(d); return Promise.resolve(); };
    this.getSurvey = function (u, sid) { var d = db(); var p = d.participants[u] || {}; return Promise.resolve(clone((p.surveys && p.surveys[sid || '_none']) || (sid == null ? p.survey : null) || null)); };
    this.listSurveys = function (u) { var d = db(); var p = d.participants[u] || {}; var out = []; if (p.surveys) Object.keys(p.surveys).forEach(function (k) { out.push(clone(p.surveys[k])); }); if (p.survey) out.push(Object.assign({ sessionId: '_legacy' }, clone(p.survey))); return Promise.resolve(out); };
    this.deleteParticipant = function (u) { var d = db(); delete d.participants[u]; write(d); return Promise.resolve(); };
    // Erase everything one session recorded (see the Firebase twin for the
    // full reasoning): its responses/events/survey/draft on every participant
    // who played it, plus its entries in their played/completed maps; a
    // participant who played nothing else goes entirely.
    this.deleteSessionData = function (sid) {
      var d = db(), key = sid || '_none', removed = 0, cleaned = 0;
      Object.keys(d.participants).forEach(function (u) {
        var p = d.participants[u];
        if (!touchesSession(p, key)) return;
        if (onlySession(p, key)) { delete d.participants[u]; removed++; return; }
        p.responses = (p.responses || []).filter(function (r) { return rowSid(r) !== key; });
        p.events = (p.events || []).filter(function (e) { return rowSid(e) !== key; });
        if (p.surveys) delete p.surveys[key];
        if (p.playedSessions) delete p.playedSessions[key];
        if (p.completedSessions) delete p.completedSessions[key];
        if (p.draftResponse && rowSid(p.draftResponse) === key) p.draftResponse = null;
        if (p.sessionId === key) p.sessionId = null;
        cleaned++;
      });
      write(d);
      return Promise.resolve({ participantsRemoved: removed, participantsCleaned: cleaned });
    };
  }

  /* ================================================================
     FIREBASE backend
     ================================================================ */
  function FirebaseBackend() {
    var fb = null, authCb = null, lastUser = null, gotState = false;
    var APP_NAME = 'answerarena';

    this.mode = 'firebase';
    this.init = function () {
      return Promise.all([
        import(FB_BASE + 'firebase-app.js'),
        import(FB_BASE + 'firebase-auth.js'),
        import(FB_BASE + 'firebase-firestore.js')
      ]).then(function (mods) {
        var appM = mods[0], authM = mods[1], fsM = mods[2], app;
        try { app = appM.getApp(APP_NAME); } catch (e) { app = appM.initializeApp(window.ARENA_FIREBASE, APP_NAME); }
        fb = { app: app, auth: authM.getAuth(app), db: fsM.getFirestore(app), A: authM, F: fsM };
        authM.onAuthStateChanged(fb.auth, function (u) {
          lastUser = u ? { uid: u.uid, email: u.email } : null; gotState = true;
          if (authCb) authCb(lastUser);
        });
        return { mode: 'firebase' };
      });
    };

    // Replay the latest known auth state when a listener registers. Firebase's
    // initial onAuthStateChanged event can fire BEFORE onAuth() is called (e.g.
    // while loadConfig() is in flight); without this replay a logged-out visitor
    // never gets routed and the app hangs on the loading screen.
    this.onAuth = function (cb) { authCb = cb; if (gotState) cb(lastUser); };
    this.currentUser = function () { var u = fb && fb.auth.currentUser; return u ? { uid: u.uid, email: u.email } : null; };
    this.register = function (email, password) { return fb.A.createUserWithEmailAndPassword(fb.auth, email, password).then(function (c) { return { uid: c.user.uid, email: c.user.email }; }); };
    this.login = function (email, password) { return fb.A.signInWithEmailAndPassword(fb.auth, email, password).then(function (c) { return { uid: c.user.uid, email: c.user.email }; }); };
    // Anonymous play: a real Firebase anonymous account (request.auth.uid set,
    // no e-mail). Requires the Anonymous sign-in provider to be enabled in the
    // Firebase console; the existing owner-based security rules cover it as-is.
    this.signInAnonymously = function () { return fb.A.signInAnonymously(fb.auth).then(function (c) { return { uid: c.user.uid, email: c.user.email || null }; }); };
    this.logout = function () { return fb.A.signOut(fb.auth); };

    var F = function () { return fb.F; }, D = function () { return fb.db; };
    this.loadConfig = function () {
      return F().getDoc(F().doc(D(), 'config', 'app')).then(function (s) { return s.exists() ? s.data() : {}; }).catch(function () { return {}; });
    };
    this.saveConfig = function (partial) {
      return F().setDoc(F().doc(D(), 'config', 'app'), Object.assign({}, partial, { updatedAt: F().serverTimestamp() }), { merge: true });
    };

    this.loadActiveTasks = function () {
      return this.loadConfig().then(function (cfg) {
        var builtin = { id: 'builtin', name: 'Built-in default', tasks: (DEFAULTS.defaultTasks || []) };
        var id = cfg.activeTaskSetId;
        if (!id) return builtin;
        return F().getDoc(F().doc(D(), 'taskSets', id)).then(function (s) {
          if (!s.exists()) return builtin;
          var d = s.data();
          // Large sets keep their tasks in sibling chunk docs (taskSets/{id}__chunk_N)
          // to stay under Firestore's 1 MiB per-document limit; older sets store the
          // tasks inline. Reassemble either shape into one ordered tasks array.
          if (d.chunkCount) {
            var reads = [];
            for (var i = 0; i < d.chunkCount; i++) reads.push(F().getDoc(F().doc(D(), 'taskSets', id + '__chunk_' + i)));
            return Promise.all(reads).then(function (snaps) {
              var tasks = [];
              snaps.forEach(function (cs) { if (cs.exists()) (cs.data().tasks || []).forEach(function (t) { tasks.push(t); }); });
              return { id: id, name: d.name || 'Task set', tasks: tasks };
            });
          }
          return { id: id, name: d.name || 'Task set', tasks: (d.tasks || []) };
        }).catch(function (e) {
          // A configured task set that cannot be read (e.g. a dangling
          // activeTaskSetId left over from before the rules were deployed, a
          // permission error, or a transient network failure) must NOT dead-end
          // the participant or hang the admin's "current set" card. Fall back to
          // the built-in default and log the real cause so it stays diagnosable.
          if (window.console) console.error('[Arena] Could not read the active task set "' + id + '" (' + ((e && e.code) || (e && e.message) || 'error') + '); falling back to the built-in default. If you uploaded a set, check the Firestore rules are deployed (see _lab-arena-firebase/README.md C) and re-save it, or use "Restore built-in default".', e);
          return builtin;
        });
      });
    };
    this.saveTaskSet = function (set) {
      var self = this;
      var tasks = (set && set.tasks) || [];
      var meta = Object.assign({}, set); delete meta.tasks;
      // Store the tasks in size-bounded sibling chunk docs (taskSets/{id}__chunk_N)
      // instead of one big document, so a large set (e.g. 100+ comparisons of full
      // model outputs) never hits Firestore's 1 MiB per-document limit - which used
      // to make the Save silently fail. The chunk docs live in the SAME taskSets
      // collection, so the existing signed-in-read / admin-write rules cover them
      // with no rules change. The metadata doc carries chunkCount + count.
      var chunks = [], cur = [], curBytes = 0, LIMIT = 600000;
      tasks.forEach(function (t) {
        var b; try { b = JSON.stringify(t).length; } catch (e) { b = 4000; }
        if (cur.length && curBytes + b > LIMIT) { chunks.push(cur); cur = []; curBytes = 0; }
        cur.push(t); curBytes += b;
      });
      if (cur.length) chunks.push(cur);
      return F().addDoc(F().collection(D(), 'taskSets'),
        Object.assign({ createdAt: F().serverTimestamp(), count: tasks.length, chunkCount: chunks.length }, meta))
        .then(function (ref) {
          var id = ref.id;
          return Promise.all(chunks.map(function (c, i) {
            return F().setDoc(F().doc(D(), 'taskSets', id + '__chunk_' + i), { ofSet: id, idx: i, isChunk: true, tasks: c });
          })).then(function () {
            return self.saveConfig({ activeTaskSetId: id }).then(function () { return id; });
          });
        });
    };
    this.listTaskSets = function () {
      // Skip the sibling chunk docs - only the metadata docs are real sets.
      return F().getDocs(F().collection(D(), 'taskSets')).then(function (sn) { var a = []; sn.forEach(function (d) { if (d.data().isChunk) return; a.push(Object.assign({ id: d.id }, d.data())); }); return a; });
    };

    this.listSessions = function () {
      return F().getDocs(F().collection(D(), 'sessions')).then(function (sn) { var a = []; sn.forEach(function (d) { a.push(Object.assign({ id: d.id }, d.data())); }); return a; });
    };
    this.createSession = function (data) {
      var c = data.code || code6();
      return F().addDoc(F().collection(D(), 'sessions'),
        Object.assign({ code: c, status: 'waiting', count: 0, createdAt: F().serverTimestamp() }, data, { code: c }))
        .then(function (ref) { return Object.assign({ id: ref.id, code: c, status: 'waiting', count: 0 }, data); });
    };
    this.updateSession = function (id, patch) { return F().setDoc(F().doc(D(), 'sessions', id), patch, { merge: true }); };
    this.deleteSession = function (id) { return F().deleteDoc(F().doc(D(), 'sessions', id)); };
    this.getSessionByCode = function (c) {
      var q = F().query(F().collection(D(), 'sessions'), F().where('code', '==', String(c).toUpperCase()));
      return F().getDocs(q).then(function (sn) { var hit = null; sn.forEach(function (d) { if (!hit) hit = Object.assign({ id: d.id }, d.data()); }); return hit; });
    };

    this.getParticipant = function (u) { return F().getDoc(F().doc(D(), 'participants', u)).then(function (s) { return s.exists() ? s.data() : null; }); };
    this.setParticipant = function (u, data, merge) { return F().setDoc(F().doc(D(), 'participants', u), data, { merge: !!merge }); };
    this.listParticipants = function () { return F().getDocs(F().collection(D(), 'participants')).then(function (sn) { var a = []; sn.forEach(function (d) { a.push(Object.assign({ _id: d.id }, d.data())); }); return a; }); };

    this.addResponse = function (u, resp) { return F().addDoc(F().collection(D(), 'participants', u, 'responses'), Object.assign({ serverTime: F().serverTimestamp() }, resp)); };
    this.listResponses = function (u) { return F().getDocs(F().collection(D(), 'participants', u, 'responses')).then(function (sn) { var a = []; sn.forEach(function (d) { a.push(d.data()); }); return a; }); };
    this.addEvent = function (u, ev) { return F().addDoc(F().collection(D(), 'participants', u, 'events'), Object.assign({ serverTime: F().serverTimestamp() }, ev)); };
    this.listEvents = function (u) { return F().getDocs(F().collection(D(), 'participants', u, 'events')).then(function (sn) { var a = []; sn.forEach(function (d) { a.push(d.data()); }); return a; }); };
    this.saveSurvey = function (u, sid, answers) {
      sid = sid || '_none';
      // One survey doc per session (keyed by sessionId). The two writes are
      // independent, so run them in parallel (one round-trip instead of two).
      return Promise.all([
        F().setDoc(F().doc(D(), 'participants', u, 'survey', sid), { sessionId: sid, answers: answers, completedAt: F().serverTimestamp() }, { merge: true }),
        F().setDoc(F().doc(D(), 'participants', u), { status: 'done', updatedAt: F().serverTimestamp() }, { merge: true })
      ]);
    };
    this.getSurvey = function (u, sid) { return F().getDoc(F().doc(D(), 'participants', u, 'survey', sid || '_none')).then(function (s) { return s.exists() ? s.data() : null; }); };
    this.listSurveys = function (u) { return F().getDocs(F().collection(D(), 'participants', u, 'survey')).then(function (sn) { var a = []; sn.forEach(function (d) { a.push(Object.assign({ id: d.id }, d.data())); }); return a; }); };
    /* Remove a participant and ALL of their data. The sub-collections go
       first, then the participant doc — and a failure is never swallowed:
       Firestore keeps sub-collection documents alive under a deleted parent,
       so a half-delete would leave the student's raw answers orphaned in the
       database (invisible in this panel, since it lists `participants`, yet
       still there). Surfacing the error lets the admin retry instead of
       believing the data is gone. */
    this.deleteParticipant = function (u) {
      var names = ['responses', 'events', 'survey'];
      return Promise.all(names.map(function (n) {
        return F().getDocs(F().collection(D(), 'participants', u, n)).then(function (sn) {
          return Promise.all(sn.docs.map(function (d) { return F().deleteDoc(d.ref); }));
        });
      })).then(function () { return F().deleteDoc(F().doc(D(), 'participants', u)); });
    };
    /* Remove ALL data one session recorded, without touching the other
       sessions the same people played. Participants are not owned by a
       session (one anonymous identity can take part in several), so this
       walks every participant who played `sid` and:
         - deletes their responses/events tagged with it, its survey doc and
           an unsubmitted draft belonging to it;
         - drops its entries from playedSessions/completedSessions (and
           clears `sessionId` when it still points at it);
         - deletes the participant record OUTRIGHT when this was the only
           session they ever touched — the record exists only because of it.
       Sub-collection docs survive a deleted parent in Firestore, so this must
       run BEFORE deleteSession(); the admin's Delete does exactly that, which
       is also why a failure leaves the session listed and the action
       retryable. Errors are never swallowed (same rule as deleteParticipant).
       Deletes run one participant at a time to stay gentle on quota. */
    this.deleteSessionData = function (sid) {
      var self = this, key = sid || '_none', removed = 0, cleaned = 0;
      return self.listParticipants().then(function (all) {
        var parts = all.filter(function (p) { return touchesSession(p, key); });
        return parts.reduce(function (chain, p) {
          return chain.then(function () {
            var u = p._id;
            if (onlySession(p, key)) { removed++; return self.deleteParticipant(u); }
            var jobs = ['responses', 'events'].map(function (n) {
              return F().getDocs(F().collection(D(), 'participants', u, n)).then(function (sn) {
                return Promise.all(sn.docs.filter(function (x) { return rowSid(x.data()) === key; })
                  .map(function (x) { return F().deleteDoc(x.ref); }));
              });
            });
            jobs.push(F().deleteDoc(F().doc(D(), 'participants', u, 'survey', key)));
            return Promise.all(jobs).then(function () {
              // Dotted paths + deleteField() need updateDoc: setDoc(merge)
              // would create a field literally named "playedSessions.<id>".
              var patch = { updatedAt: F().serverTimestamp() };
              patch['playedSessions.' + key] = F().deleteField();
              patch['completedSessions.' + key] = F().deleteField();
              if (p.sessionId === key) patch.sessionId = null;
              if (p.draftResponse && rowSid(p.draftResponse) === key) patch.draftResponse = null;
              cleaned++;
              return F().updateDoc(F().doc(D(), 'participants', u), patch);
            });
          });
        }, Promise.resolve());
      }).then(function () { return { participantsRemoved: removed, participantsCleaned: cleaned }; });
    };
  }

  // Pick the backend. A TEST ROUND always gets the local one in its own
  // namespace (so a configured Firebase project is never touched); otherwise
  // Firebase if a real config is present, else local.
  var backend;
  if (previewOn) {
    backend = new LocalBackend(PREVIEW_PREFIX);
    // Apply the admin's seed once per launch. A reload carries the same stamp,
    // so the sandbox keeps whatever the tester has done so far.
    try {
      var seed = JSON.parse(localStorage.getItem(PREVIEW_SEED_KEY) || 'null');
      if (seed && seed.ts && seed.ts !== backend.seededTs()) backend.seedFrom(seed);
      else if (!seed && !backend.seededTs()) backend.seedFrom({ ts: 1 });
    } catch (e) { backend.seedFrom({ ts: 1 }); }
  } else {
    backend = (window.ARENA_FB_READY) ? new FirebaseBackend() : new LocalBackend();
  }
  backend.isPreview = previewOn;
  // Expose a couple of constants the app/admin reuse.
  backend.ADMIN_EMAIL = ADMIN_EMAIL;
  backend.isAdminEmail = function (e) { return String(e || '').toLowerCase() === String(ADMIN_EMAIL).toLowerCase(); };
  backend.makeCode = code6;
  window.ArenaStore = backend;
})();
