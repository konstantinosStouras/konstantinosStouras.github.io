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
  var LS_RECOVERY = 'simp:recovery-synced:v1'; // updatedAt of the last profile mirrored to the e-mail recovery doc
  var LS_REVOKED = 'simp:revoked:v1';      // {simKey: <ms>} tombstones seen from the roster — see revokeCompletion

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
  function recoverByEmail(email, studentId) {
    if (!CONFIGURED) return Promise.resolve(null);
    return fb().then(function (F) { return F.getRecovery(email); }).then(function (rec) {
      if (!rec) return null;
      /* When a student ID is supplied it must ALSO match — logging back in
         takes both the e-mail and the university ID used at registration, so
         knowing a classmate's e-mail alone is not enough to assume their
         identity. Compared trimmed + case-insensitively. */
      if (studentId != null && String(studentId).trim() !== '') {
        var a = String(studentId).trim().toLowerCase();
        var b = String(rec.studentId || '').trim().toLowerCase();
        if (a !== b) return null;
      }
      /* Restores completions AND honours revocation tombstones, so a student
         cannot dodge a revoked completion by restoring on another browser. */
      if (rec.completed) applyRosterCompletions(rec);
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
  /* Revocation tombstones seen from the roster: {simKey: <ms revoked at>}.
     A completion is REVOKED when the instructor removes it — either by hand
     or because the reconciliation found the student is no longer a completed
     participant in the simulation's own backend (e.g. deleted from Answer
     Arena so they may retake it). The tombstone lives INSIDE the roster's
     already-allowed `completed` map ({revoked:1, rts}), so no Firestore rules
     change is needed; this local copy stops the browser re-pushing a marker
     the instructor has just removed. */
  function revokedLocal() {
    try { return JSON.parse(localStorage.getItem(LS_REVOKED) || '{}'); }
    catch (e) { return {}; }
  }
  function isTombstone(e) { return !!(e && e.revoked); }
  /* A tombstone carries `rts` = the INSTRUCTOR's clock, which must never be
     compared with a marker's `ts` = the STUDENT's clock (a laptop minutes
     fast would defeat every revocation; minutes slow would erase a genuine
     retake). So `rts` is used ONLY as an identity — "is this a tombstone I
     have not seen before?" — and the moment one is first seen we stamp
     `seenAt` from THIS browser's clock. Every later decision compares
     marker.ts against seenAt: one clock, monotonic within the browser. */
  function tombRts(rv, k) { var e = rv[k]; return typeof e === 'number' ? e : (e ? Number(e.rts) || 0 : 0); }
  function tombSeen(rv, k) { var e = rv[k]; return typeof e === 'number' ? e : (e ? Number(e.seenAt) || 0 : 0); }
  /* The markers this browser may legitimately push up: a completion that was
     revoked at or after it happened is NOT pushed (it would resurrect the ✓
     the instructor just removed). A genuine RETAKE writes a newer marker,
     which beats the tombstone and syncs normally. */
  function pushableMarkers() {
    var m = completed(), rv = revokedLocal(), out = {};
    Object.keys(m).forEach(function (k) {
      var ts = Number(m[k] && m[k].ts) || 0;
      if (ts <= tombSeen(rv, k)) return;   // superseded by a revocation we have seen
      out[k] = m[k];
    });
    return out;
  }
  /* Apply a roster doc's completion record to this browser: pull down
     completions verified centrally, and honour tombstones by forgetting a
     revoked completion (which unlocks the card so the student can retake).
     Returns true when the local markers changed. */
  function applyRosterCompletions(data) {
    var rc = (data && data.completed) || null;
    if (!rc) return false;
    var changed = false;
    try {
      var m = completed(), rv = revokedLocal();
      Object.keys(rc).forEach(function (k) {
        var e = rc[k] || {};
        if (isTombstone(e)) {
          var rts = Number(e.rts) || 0;
          if (rts > tombRts(rv, k)) { rv[k] = { rts: rts, seenAt: Date.now() }; changed = true; }
          /* Forget only a completion recorded BEFORE we saw this revocation —
             a retake finished afterwards has a newer ts and must survive.
             Both timestamps come from this browser's clock (see tombSeen). */
          if (m[k] && (Number(m[k].ts) || 0) <= tombSeen(rv, k)) { delete m[k]; changed = true; }
          return;
        }
        if (!m[k]) {
          /* Carry `src` down with the mark. Without it, a completion the
             INSTRUCTOR set by hand came back from the roster as an ordinary
             local marker, went up again on the next sync stamped 'client',
             and the reconciliation's "marks you set by hand are never removed"
             guard — which tests src === 'manual' — no longer recognised it. */
          m[k] = { ts: Number(e.ts) || 0, session: e.session || null };
          if (e.src) m[k].src = e.src;
          changed = true;
        }
      });
      if (changed) {
        /* Tombstones FIRST: if the second write fails (quota), the guard that
           stops a revoked marker being re-pushed is already in place. */
        localStorage.setItem(LS_REVOKED, JSON.stringify(rv));
        localStorage.setItem(LS_COMPLETED, JSON.stringify(m));
      }
    } catch (e) { return false; }
    return changed;
  }
  /* Mirror the local completion markers onto the student's roster doc so the
     admin can track who answered which simulation (Firebase mode; a silent
     no-op otherwise). The student page calls this at load and whenever a sim
     tab stamps a completion (the storage event). Non-fatal by design. */
  function syncCompleted() {
    if (!CONFIGURED) return Promise.resolve();
    var m = pushableMarkers();
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
    try { localStorage.removeItem(LS_REVOKED); } catch (e) {}
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
    /* Separate high-water marks: a browser that synced its roster doc BEFORE
       the e-mail recovery feature existed must still write its recovery doc
       on the next visit (else the student can never log back in by e-mail). */
    var needStudent = localStorage.getItem(LS_SYNCED) !== p.updatedAt;
    var needRecovery = localStorage.getItem(LS_RECOVERY) !== p.updatedAt;
    if (!needStudent && !needRecovery) return;
    fb().then(function (F) {
      var a = needStudent
        ? F.saveStudent(p).then(function () { localStorage.setItem(LS_SYNCED, p.updatedAt); })
        : Promise.resolve();
      var b = needRecovery
        ? F.saveRecovery(p).then(function () { localStorage.setItem(LS_RECOVERY, p.updatedAt); }).catch(function () {})
        : Promise.resolve();
      return Promise.all([a, b]);
    }).catch(function () { /* retried on the next visit */ });
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
            var clean = {}, patch = {};
            Object.keys(m || {}).forEach(function (k) {
              /* src records WHO ESTABLISHED the completion, not who wrote it
                 last: an instructor's manual mark keeps `src:'manual'` when
                 this browser pushes it back, or the reconciliation would stop
                 recognising the override it is required never to undo.
                 Written on every push through a dotted path, which REPLACES
                 the whole nested entry — a deep merge would fuse {ts,session}
                 into a tombstone ({revoked:1,rts,ts,session}), leaving the row
                 reading as revoked forever even after a genuine retake. */
              var v = m[k] || {};
              clean[k] = { ts: Number(v.ts) || 0, session: v.session || null, src: v.src || 'client' };
              patch['completed.' + k] = clean[k];
            });
            if (!Object.keys(patch).length) return;
            var ref = D.doc(fs, PATHS.students + '/' + u.uid);
            /* uid included in the fallback so the write also passes the CREATE
               rule when the profile sync hasn't made the doc yet. */
            var main = D.updateDoc(ref, patch).catch(function () {
              return D.setDoc(ref, { uid: u.uid, completed: clean }, { merge: true });
            });
            var p = getProfile();
            if (!p || !p.email) return main;
            return main.then(function () {
              return emailKeyOf(p.email).then(function (key) {
                var rref = D.doc(fs, PATHS.recovery + '/' + key);
                return D.updateDoc(rref, patch).catch(function () {
                  return D.setDoc(rref, { completed: clean }, { merge: true });
                });
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
        /* One fresh read of the whole roster (admin-only per the rules). The
           reconciliation decides from THIS, never from the live-snapshot
           cache, whose streaming channel can be stale on the very networks
           the long-polling fallback exists for. */
        listStudents: function () {
          return D.getDocs(D.collection(fs, PATHS.students)).then(function (qs) {
            var out = [];
            qs.forEach(function (d) { out.push(d.data()); });
            return out;
          });
        },
        /* Admin-side backfill: write the e-mail recovery doc for every roster
           row — students who registered BEFORE the recovery feature existed
           have none, and without one they cannot log back in by e-mail.
           Idempotent (merge); resolves to how many rows were written. */
        backfillRecovery: function (rows) {
          var fields = ['name', 'email', 'studentId', 'age', 'gender', 'nationality',
                        'country', 'levelOfStudy', 'workExperience', 'occupation',
                        'industry', 'englishFluency', 'createdAt', 'updatedAt'];
          var todo = (rows || []).filter(function (r) { return r && r.email; });
          return Promise.all(todo.map(function (r) {
            return emailKeyOf(r.email).then(function (key) {
              var doc = {};
              fields.forEach(function (k) { if (r[k] != null && r[k] !== '') doc[k] = r[k]; });
              if (r.completed) doc.completed = r.completed;
              return D.setDoc(D.doc(fs, PATHS.recovery + '/' + key), doc, { merge: true });
            });
          })).then(function (x) { return x.length; });
        },
        getRecovery: function (email) {
          return emailKeyOf(email).then(function (key) {
            return ensureAnon().then(function () {
              return D.getDoc(D.doc(fs, PATHS.recovery + '/' + key));
            });
          }).then(function (snap) { return snap.exists() ? snap.data() : null; });
        },
        /* Admin-only: stamp a VERIFIED completion onto roster docs — the
           "Verify from <simulation>" reconciliation (one per active
           simulation that keeps identifiable participant records), for
           students whose own browser never mirrored the marker (platform tab
           closed, direct URL, another browser). The student's page pulls it
           down live via its own-doc watch. */
        stampCompleted: function (rows, simKey, mark) {
          /* Dotted path REPLACES the nested entry. A deep merge would fuse the
             new mark into an existing tombstone ({revoked:1,rts}) and the row
             would still read as revoked. src records who stamped it ('verify'
             = a reconciliation from the simulation's own records — 'arena' in
             legacy rows, when Answer Arena was the only verifiable one —,
             'manual' = the instructor by hand) so a reconciliation can never
             undo a manual override. */
          var entry = { ts: Number(mark.ts) || 0, session: mark.session || null };
          if (mark.src) entry.src = mark.src;
          var patch = {};
          patch['completed.' + simKey] = entry;
          /* Takes [{uid, email}] like revokeCompletion — bare uid strings are
             still accepted (older callers), they just skip the replica. */
          var list = (rows || []).map(function (r) {
            return (typeof r === 'string') ? { uid: r } : (r || {});
          }).filter(function (r) { return r.uid; });
          var jobs = [];
          list.forEach(function (r) {
            jobs.push(D.updateDoc(D.doc(fs, PATHS.students + '/' + r.uid), patch)
              .catch(function () {
                var p = { completed: {} }; p.completed[simKey] = entry;
                return D.setDoc(D.doc(fs, PATHS.students + '/' + r.uid), p, { merge: true });
              }));
            /* The completion map is replicated on the e-mail RECOVERY doc —
               that is what a student restores when they log in on another
               device, and the new device's registration becomes their NEWEST
               roster doc. Without this, a verified ✓ vanished from the roster
               the moment the student logged in elsewhere: the replica never
               carried it, so there was nothing to restore and nothing to push
               onto the new doc. revokeCompletion has always written both, for
               the mirror-image reason. */
            if (r.email) {
              jobs.push(emailKeyOf(r.email).then(function (key) {
                var rref = D.doc(fs, PATHS.recovery + '/' + key);
                return D.updateDoc(rref, patch).catch(function () {
                  var p = { completed: {} }; p.completed[simKey] = entry;
                  return D.setDoc(rref, p, { merge: true });
                });
              }));
            }
          });
          return Promise.allSettled(jobs).then(function (rs) {
            var bad = rs.filter(function (x) { return x.status === 'rejected'; });
            if (bad.length === rs.length && rs.length) throw (bad[0].reason || new Error('stamp failed'));
            return { failed: bad.length };
          });
        },
        /* Admin-only: REVOKE a completion — the student no longer counts as
           having done it and may retake it. Writes a TOMBSTONE rather than
           deleting the field, because the student's own browser holds a
           play-once marker in localStorage: a bare delete cannot tell that
           browser to forget it (and it would be re-pushed on the next sync,
           resurrecting the ✓). The tombstone lives inside the existing
           `completed` map, so the deployed Firestore rules already allow it. */
        revokeCompletion: function (rows, simKey) {
          var tomb = { revoked: 1, rts: Date.now() };
          var patch = {};
          patch['completed.' + simKey] = tomb;
          var list = (rows || []).map(function (r) {
            return (typeof r === 'string') ? { uid: r } : (r || {});
          }).filter(function (r) { return r.uid; });
          /* The completion map is replicated on the e-mail RECOVERY doc too
             (that is what a student restores when they log in on another
             browser), so the tombstone must be written to BOTH — otherwise a
             revoked completion comes back the moment they log in elsewhere.
             allSettled: one failed row must not hide the rest. */
          var jobs = [];
          list.forEach(function (r) {
            jobs.push(D.updateDoc(D.doc(fs, PATHS.students + '/' + r.uid), patch));
            if (r.email) {
              jobs.push(emailKeyOf(r.email).then(function (key) {
                var rref = D.doc(fs, PATHS.recovery + '/' + key);
                return D.updateDoc(rref, patch).catch(function () {
                  var p = { completed: {} }; p.completed[simKey] = tomb;
                  return D.setDoc(rref, p, { merge: true });
                });
              }));
            }
          });
          return Promise.allSettled(jobs).then(function (rs) {
            var bad = rs.filter(function (x) { return x.status === 'rejected'; });
            if (bad.length === rs.length && rs.length) throw (bad[0].reason || new Error('revoke failed'));
            return { failed: bad.length };
          });
        },
        /* Patch fields on ONE roster doc (admin-only per the rules). Used to
           repair answers that were stored in the student's display language —
           see simulation/answers.js. Merge, so nothing else is touched. */
        updateStudent: function (uid, patch) {
          return D.setDoc(D.doc(fs, PATHS.students + '/' + uid), patch || {}, { merge: true });
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
            /* The roster doc is the VERIFIED record: pull centrally stamped
               completions down into this browser's play-once markers (so the
               cards read correctly wherever the student logs in) and honour
               revocations (so a completion the instructor removed unlocks the
               card for a retake). */
            var firstApplied = false;
            var apply = function (snap) {
              var data = snap.exists() ? snap.data() : null;
              if (data && applyRosterCompletions(data)) last = undefined;   // force a re-render
              emit(!!(data && data.approved), !!data);
              /* Only push local markers up AFTER the first roster snapshot has
                 been applied. Pushing at page load would race the download and
                 could re-assert a completion the instructor has just revoked
                 (the push is immediate; the snapshot is a round-trip away). */
              if (!firstApplied) { firstApplied = true; syncCompleted(); }
            };
            var un = D.onSnapshot(ref, apply, function () { emit(false, false); });
            /* Poll fallback for networks whose streaming channel is dead.
               Fast while the student is waiting to be approved, slow (and
               visible-tab only) afterwards — but NEVER stopped, because a
               completion can be verified or revoked at any time and must
               still reach this page. */
            var tick = 0;
            var timer = (D.getDoc ? setInterval(function () {
              if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
              tick++;
              if (last === true && (tick % 6)) return;   // approved → ~every 30 s
              D.getDoc(ref).then(apply).catch(function () {});
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
