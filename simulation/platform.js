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
  /* Defaults MERGED under any override, so a firebase-config.js written
     before a new path existed can never leave it undefined. */
  var PATHS = Object.assign(
    { config: 'simPlatform/config', students: 'simPlatformStudents', recovery: 'simPlatformRecovery' },
    window.SIMP_PATHS || {});

  var LS_PROFILE = 'simp:profile:v1';   // the student's one-time registration
  var LS_DRAFT   = 'simp:config-draft:v1'; // admin's local (unpublished) activation edits
  var LS_HANDOFF = 'simp:handoff:v1';   // written at launch; read by prefill.js inside each sim
  var LS_SYNCED  = 'simp:profile-synced:v1'; // updatedAt of the last profile mirrored to Firestore
  var LS_COMPLETED = 'simp:completed:v1';  // {simKey:{ts,session}} — written by each sim's done screen (via prefill.js's simpMarkCompleted)

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
    /* keep a recovered profile's ORIGINAL registration date */
    p.createdAt = (old && old.createdAt) || p.createdAt || p.updatedAt;
    localStorage.setItem(LS_PROFILE, JSON.stringify(p));
    syncProfile();
    return p;
  }
  /* sha256 hex of the normalized e-mail — the deterministic recovery-doc key
     (same e-mail → same key on any device; no listing, you must KNOW it). */
  function emailKeyOf(email) {
    var s = String(email || '').trim().toLowerCase();
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }
  /* Returning student on a NEW device / cleared browser: look their saved
     registration up by e-mail (Firebase mode only). Resolves to the profile
     (with any play-once completion markers restored into this browser) or
     null when no registration exists for that e-mail. */
  function recoverByEmail(email) {
    if (!CONFIGURED) return Promise.resolve(null);
    return fb().then(function (F) { return F.getRecovery(email); }).then(function (rec) {
      if (!rec) return null;
      if (rec.completed) {
        try {
          var m = completed();
          Object.keys(rec.completed).forEach(function (k) { if (!m[k]) m[k] = rec.completed[k]; });
          localStorage.setItem(LS_COMPLETED, JSON.stringify(m));
        } catch (e) {}
      }
      var p = {};
      Object.keys(rec).forEach(function (k) { if (k !== 'completed' && k !== 'emailKey') p[k] = rec[k]; });
      return p;
    });
  }
  function clearProfile() { localStorage.removeItem(LS_PROFILE); localStorage.removeItem(LS_SYNCED); }
  /* Completions recorded by the sims' own done screens ({simKey:{ts,session}}).
     Read by the student page to badge a card "✓ Completed" and block a second
     play of the same run (a NEW pinned Session ID unlocks the card again). */
  function completed() {
    try { return JSON.parse(localStorage.getItem(LS_COMPLETED) || '{}'); }
    catch (e) { return {}; }
  }
  /* Mirror the local completion markers onto the student's roster doc so the
     admin can track who answered which simulation (Firebase mode; a silent
     no-op otherwise). The student page calls this at load and whenever a sim
     tab stamps a completion (the storage event). Non-fatal by design. */
  function syncCompleted() {
    if (!CONFIGURED) return Promise.resolve();
    var m = completed();
    if (!Object.keys(m).length) return Promise.resolve();
    return fb().then(function (F) { return F.saveCompleted(m); }).catch(function () {});
  }
  /* Log out of the platform on this browser: forget the saved registration
     (and the launch handoff), and sign out the Firebase user so the NEXT
     registration on this machine gets its own roster doc instead of
     overwriting this student's — the shared-computer case. The roster doc
     itself stays (logging out is not unregistering from class). */
  function logout() {
    clearProfile();
    try { localStorage.removeItem(LS_HANDOFF); } catch (e) {}
    try { localStorage.removeItem(LS_COMPLETED); } catch (e) {}   // next student starts fresh
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
    fb().then(function (F) {
      return F.saveStudent(p).then(function () {
        /* also mirror to the e-mail recovery doc — non-fatal */
        return F.saveRecovery(p).catch(function () {});
      });
    })
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
      /* Some networks (campus proxies, antivirus HTTPS inspection) silently
         break the SDK's streaming Listen channel: the FIRST snapshot arrives
         but live pushes never do — "it only updates after a refresh". The
         auto-detect option makes the SDK probe the channel and fall back to
         long-polling, which those middleboxes pass through. */
      var fs;
      try {
        fs = D.initializeFirestore
          ? D.initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
          : D.getFirestore(app);
      } catch (e) { fs = D.getFirestore(app); }
      var confRef = D.doc(fs, PATHS.config);
      var anonP = null;
      function ensureAnon() {
        // Wait for the restored auth state before deciding — auth.currentUser
        // is null while Firebase is still restoring a previous session, and
        // signing in anonymously at that moment would mint a NEW uid (and a
        // duplicate roster doc) on every visit.
        // MEMOIZED: concurrent callers on one page load (the profile sync and
        // the approval watch fire together right after registration) must
        // share ONE sign-in — two concurrent signInAnonymously calls mint TWO
        // uids, landing the roster doc under one identity while the approval
        // watch listens to the other's doc, so the instructor's Approve never
        // reached the page until a refresh reunified them.
        if (anonP) return anonP;
        anonP = new Promise(function (res, rej) {
          var un = A.onAuthStateChanged(auth, function (u) {
            un();
            if (u) res(u);
            else A.signInAnonymously(auth).then(function (cred) { res(cred.user); },
              function (e) { anonP = null; rej(e); });   // allow a retry after a failure
          });
        });
        return anonP;
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
        /* Live roster (admin-only per the rules): cb(rows) now and on every
           change; cb(null) on a permission error. Returns unsubscribe.
           Belt & braces: where the streaming channel is dead (see the
           initializeFirestore note) a cheap count() poll every 10 s spots a
           new registration and refetches once — so a student appears within
           seconds of registering even without a working stream. */
        watchStudents: function (cb) {
          var col = D.collection(fs, PATHS.students);
          var lastN = -1;
          var fetchAll = function () {
            return D.getDocs(col).then(function (qs) {
              lastN = qs.size;
              var out = [];
              qs.forEach(function (d) { out.push(d.data()); });
              cb(out);
            });
          };
          var un = D.onSnapshot(col, function (qs) {
            lastN = qs.size;
            var out = [];
            qs.forEach(function (d) { out.push(d.data()); });
            cb(out);
          }, function () { cb(null); });
          var timer = ((D.getCountFromServer && D.getDocs) ? setInterval(function () {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            D.getCountFromServer(col).then(function (s) {
              if (s.data().count !== lastN) return fetchAll();
            }).catch(function () {});
          }, 10000) : null);
          return function () { un(); if (timer) clearInterval(timer); };
        },
        /* Delete roster docs (admin-only per the rules — test registrations
           etc.). Takes the uids backing one displayed student row, so a
           re-registration's collapsed duplicates go too. */
        deleteStudents: function (uids) {
          return Promise.all((uids || []).map(function (uid) {
            return D.deleteDoc(D.doc(fs, PATHS.students + '/' + uid));
          }));
        },
        /* Mirror the student's play-once completion markers onto their own
           roster doc ({completed: {simKey: {ts, session}}}), so the admin
           roster can track who has answered which active simulation — and
           onto the e-mail recovery doc, so the markers survive a device
           switch (a replay can't be earned by changing browsers). */
        saveCompleted: function (m) {
          return ensureAnon().then(function (u) {
            var clean = {};
            Object.keys(m || {}).forEach(function (k) {
              var v = m[k] || {};
              clean[k] = { ts: Number(v.ts) || 0, session: v.session || null };
            });
            /* uid included so the write also passes the CREATE rule when the
               profile sync hasn't made the doc yet (a race at page load). */
            var main = D.setDoc(D.doc(fs, PATHS.students + '/' + u.uid),
              { uid: u.uid, completed: clean }, { merge: true });
            var p = getProfile();
            if (!p || !p.email) return main;
            return main.then(function () {
              return emailKeyOf(p.email).then(function (key) {
                return D.setDoc(D.doc(fs, PATHS.recovery + '/' + key),
                  { completed: clean }, { merge: true });
              }).catch(function () {});
            });
          });
        },
        /* E-mail recovery doc: the registration mirrored under a key derived
           from the e-mail, so a returning student on a NEW device can restore
           their details by typing just their e-mail. */
        saveRecovery: function (p) {
          return emailKeyOf(p.email).then(function (key) {
            return ensureAnon().then(function () {
              var doc = {};
              Object.keys(p).forEach(function (k) { if (p[k] != null && p[k] !== '') doc[k] = p[k]; });
              return D.setDoc(D.doc(fs, PATHS.recovery + '/' + key), doc, { merge: true });
            });
          });
        },
        getRecovery: function (email) {
          return emailKeyOf(email).then(function (key) {
            return ensureAnon().then(function () {
              return D.getDoc(D.doc(fs, PATHS.recovery + '/' + key));
            });
          }).then(function (snap) { return snap.exists() ? snap.data() : null; });
        },
        /* Admin-only: stamp a VERIFIED completion onto roster docs — the
           "Verify from Answer Arena" reconciliation, for students whose own
           browser never mirrored the marker (platform tab closed, direct
           URL, another browser). The student's page pulls it down live via
           its own-doc watch. */
        stampCompleted: function (uids, simKey, mark) {
          return Promise.all((uids || []).map(function (uid) {
            var patch = { completed: {} };
            patch.completed[simKey] = { ts: Number(mark.ts) || 0, session: mark.session || null };
            return D.setDoc(D.doc(fs, PATHS.students + '/' + uid), patch, { merge: true });
          }));
        },
        /* Approve / revoke a student (admin-only per the rules): only approved
           students can launch the active simulations — the owner's guard
           against class links being passed to students who are not in the
           room. Writes every uid behind one displayed roster row. */
        approveStudents: function (uids, approved) {
          return Promise.all((uids || []).map(function (uid) {
            return D.setDoc(D.doc(fs, PATHS.students + '/' + uid),
              { approved: !!approved }, { merge: true });
          }));
        },
        /* Live approval state of THIS student's own roster doc. cb(approved,
           exists) now and on every CHANGE — the student page unlocks itself
           the moment the instructor approves. Belt & braces: alongside the
           snapshot listener, a cheap own-doc poll runs every 5 s while still
           unapproved, so the unlock lands within seconds even where the
           streaming channel is dead (see the initializeFirestore note). */
        watchApproval: function (cb) {
          return ensureAnon().then(function (u) {
            var ref = D.doc(fs, PATHS.students + '/' + u.uid);
            var last;
            var emit = function (approved, exists) {
              if (approved === last) return;
              last = approved;
              cb(approved, exists);
            };
            var un = D.onSnapshot(ref, function (snap) {
              /* The roster doc is the VERIFIED record: merge any centrally
                 stamped completions (e.g. the admin's "Verify from Answer
                 Arena") down into this browser's play-once markers, so the
                 student's cards read correctly wherever they log in. */
              if (snap.exists() && snap.data().completed) {
                try {
                  var rc = snap.data().completed, m = completed(), changed = false;
                  Object.keys(rc).forEach(function (k) { if (!m[k]) { m[k] = rc[k]; changed = true; } });
                  if (changed) {
                    localStorage.setItem(LS_COMPLETED, JSON.stringify(m));
                    last = undefined;   // force the cb so the page re-renders its cards
                  }
                } catch (e) {}
              }
              emit(snap.exists() ? !!snap.data().approved : false, snap.exists());
            }, function () { emit(false, false); });
            var timer = (D.getDoc ? setInterval(function () {
              if (last === true) { clearInterval(timer); timer = null; return; }
              D.getDoc(ref).then(function (snap) {
                emit(snap.exists() ? !!snap.data().approved : false, snap.exists());
              }).catch(function () {});
            }, 5000) : null);
            return function () { un(); if (timer) clearInterval(timer); };
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
    logout: logout, completed: completed, syncCompleted: syncCompleted,
    recoverByEmail: recoverByEmail,
    watchConfig: watchConfig, saveConfig: saveConfig, draft: draft, clearDraft: clearDraft,
    buildLaunch: buildLaunch, launch: launch,
    firebase: fb,
    KEYS: { profile: LS_PROFILE, handoff: LS_HANDOFF, draft: LS_DRAFT, completed: LS_COMPLETED, adminCreds: 'simp:admin-creds' }
  };
})();
