/* SEMFE Alumni test double: an in-memory fake of the Firebase "compat" SDK
 * (firebase-app / firebase-auth / firebase-firestore -compat.js), for
 * tools/auth-flow.mjs. It is served by page.route() in place of the three
 * gstatic scripts, so the site's own auth.js / account.js / members.js /
 * admin.js run unchanged in CONFIGURED mode, with no network and no Google.
 *
 * It fakes exactly the SDK surface those files call (read them before adding
 * to it) and behaves like the real SDK where the site could notice:
 *   - onAuthStateChanged fires asynchronously, once on subscribe and then only
 *     when the signed-in uid changes (a reload or updateProfile does not fire it);
 *   - reload() refreshes the SAME user object in place (so a later
 *     firebase.auth().currentUser sees emailVerified), like the real SDK;
 *   - "one account per e-mail": a popup sign-in whose e-mail belongs to an
 *     account without that provider fails with
 *     auth/account-exists-with-different-credential, carrying .credential and
 *     .email as the compat SDK does;
 *   - Firestore writes are latency-compensated: listeners see the write at once
 *     (serverTimestamp() reads as null, hasPendingWrites), the promise settles on
 *     the "server ack", a second snapshot follows only if the data changed (the
 *     timestamp resolving), and a REFUSED write is rolled back in the listeners;
 *     every snapshot callback is delivered with setTimeout(…, 0), which is what
 *     the real SDK's AsyncObserver does, so a write's .then/.catch runs BEFORE
 *     the listeners hear about the ack or the rollback;
 *   - set()/update() throw synchronously on an `undefined` field value, as the
 *     real SDK does; update() of a missing document rejects with not-found;
 *   - compat DocumentSnapshot.exists is a boolean PROPERTY, Timestamp has toMillis().
 *
 * One file serves all three URLs: document.currentScript.src says which part
 * to install, so firebase.firestore only appears when auth.js loads
 * firebase-firestore-compat.js, as with the real split SDK.
 *
 * State (accounts, signed-in uid, documents, scripted outcomes, the call log)
 * lives in localStorage['__fbfake'] so it survives the redirects the site does
 * (sign-in -> account/#apply, sign-out -> reload), the way the real SDK keeps
 * its session in the browser and its data on the server. A test seeds it before
 * the first page load and reads/drives it through window.__fb:
 *   __fb.calls                    every SDK call: {i, api, args, page, ...}
 *   __fb.queue(op, spec)          script the next call of `op`:
 *                                   {reject: {code, credential, email, ...}}
 *                                   {resolve: {email, displayName, emailVerified, uid, isNewUser}}
 *                                   optional path (Firestore, prefix match),
 *                                   provider (popup), delayMs, and for
 *                                   'delete' lateNotifyMs (auth listeners hear
 *                                   of the sign-out only after it resolves)
 *   __fb.server.*                 act as the backend: setDoc, deleteDoc, doc,
 *                                 docs, account, accounts, setAccount, verify
 * Ops that can be scripted: signInWithPopup, createUserWithEmailAndPassword,
 * signInWithEmailAndPassword, sendPasswordResetEmail, signInWithCustomToken,
 * signOut, updateProfile, sendEmailVerification, reload, getIdToken,
 * linkWithCredential, linkWithPopup, reauthenticateWithPopup,
 * reauthenticateWithCredential, delete, fs.get, fs.set, fs.update, fs.delete,
 * fs.onSnapshot, fs.list (collection get / onSnapshot). */
(function () {
  'use strict';
  var src = (document.currentScript && document.currentScript.src) || '';
  var mm = /firebase-(app|auth|firestore)-compat\.js/.exec(src);
  var PART = mm ? mm[1] : 'all';
  // the three URLs load this same file; the body runs ONCE per page so every
  // part shares one state, one set of classes and one set of listeners
  if (window.__fbFakeInstall) { window.__fbFakeInstall(PART); return; }
  var KEY = '__fbfake';

  /* ---- persistent state ---------------------------------------------------- */
  var state = (function () {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    s = s || {};
    s.accounts = s.accounts || {};
    s.docs = s.docs || {};
    s.queue = s.queue || [];
    s.calls = s.calls || [];
    s.outbox = s.outbox || [];
    s.tokens = s.tokens || {};
    s.seq = s.seq || 1;
    if (!('currentUid' in s)) s.currentUid = null;
    return s;
  })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var F = window.__fb;
  if (!F) {
    F = window.__fb = {
      parts: [], calls: state.calls,
      queue: function (op, spec) { var q = JSON.parse(JSON.stringify(spec || {})); q.op = op; state.queue.push(q); save(); return state.queue.length; },
      pending: function () { return JSON.parse(JSON.stringify(state.queue)); },
      callsOf: function (api) { return state.calls.filter(function (c) { return c.api === api; }); },
      outbox: function () { return state.outbox.slice(); },
      state: function () { return JSON.parse(JSON.stringify(state)); }
    };
  }

  function now() { return Date.now(); }
  function later(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  function micro() { return Promise.resolve(); }
  function errOf(o) {
    var e = new Error((o && (o.message || o.code)) || 'error');
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) e[k] = o[k];
    if (e.email && !e.customData) e.customData = { email: e.email };
    return e;
  }
  function take(op, info) {
    for (var i = 0; i < state.queue.length; i++) {
      var q = state.queue[i];
      if (q.op !== op) continue;
      if (q.path && !(info && info.path && (info.path === q.path || info.path.indexOf(q.path) === 0))) continue;
      if (q.provider && !(info && info.provider === q.provider)) continue;
      state.queue.splice(i, 1); save();
      return q;
    }
    return null;
  }
  /* JSON-safe copy of call arguments, sentinels and providers made readable */
  function ser(v, depth) {
    depth = depth || 0;
    if (depth > 8) return '[deep]';
    if (v === undefined) return { __undefined: true };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isNaN(v) ? { __nan: true } : v;
    if (typeof v === 'function') return { __fn: true };
    if (v instanceof FieldValue) return v._kind === 'serverTimestamp' ? { __fv: 'serverTimestamp' } :
      v._kind === 'delete' ? { __fv: 'delete' } : v._kind === 'increment' ? { __fv: 'increment', n: v._n } : { __fv: v._kind, els: ser(v._els, depth + 1) };
    if (v instanceof Timestamp) return { __ts: v.toMillis() };
    if (v instanceof AuthProvider) return { __provider: v.providerId, scopes: v._scopes.slice(), customParameters: JSON.parse(JSON.stringify(v._params)) };
    if (v instanceof User) return { __user: v.uid };
    if (Array.isArray(v)) return v.map(function (x) { return ser(x, depth + 1); });
    if (typeof v === 'object') {
      var o = {};
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = ser(v[k], depth + 1);
      return o;
    }
    return String(v);
  }
  function rec(api, args, extra) {
    var e = { i: state.calls.length, api: api, args: ser(Array.prototype.slice.call(args || [])), page: location.pathname + location.hash, t: now() };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.calls.push(e);
    save();
    return e;
  }
  function activation() { try { return navigator.userActivation ? !!navigator.userActivation.isActive : null; } catch (e) { return null; } }

  /* ======================================================================= */
  /* firebase-app                                                             */
  /* ======================================================================= */
  function installApp() {
    if (window.firebase && window.firebase.__fake) return;
    var apps = [];
    window.firebase = {
      __fake: true,
      SDK_VERSION: '12.19.0-fake',
      apps: apps,
      initializeApp: function (options, name) {
        rec('app.initializeApp', [options, name]);
        var app = { name: name || '[DEFAULT]', options: JSON.parse(JSON.stringify(options || {})) };
        apps.push(app);
        return app;
      },
      app: function () { if (!apps.length) throw errOf({ code: 'app/no-app' }); return apps[0]; }
    };
  }

  /* ======================================================================= */
  /* firebase-auth                                                            */
  /* ======================================================================= */
  function AuthProvider(id) { this.providerId = id; this._scopes = []; this._params = {}; }
  AuthProvider.prototype.addScope = function (s) { if (this._scopes.indexOf(s) === -1) this._scopes.push(s); return this; };
  AuthProvider.prototype.setCustomParameters = function (p) { this._params = JSON.parse(JSON.stringify(p || {})); return this; };
  AuthProvider.prototype.getScopes = function () { return this._scopes.slice(); };
  AuthProvider.prototype.getCustomParameters = function () { return JSON.parse(JSON.stringify(this._params)); };
  function GoogleAuthProvider() { AuthProvider.call(this, 'google.com'); }
  GoogleAuthProvider.prototype = Object.create(AuthProvider.prototype);
  GoogleAuthProvider.PROVIDER_ID = 'google.com';
  function FacebookAuthProvider() { AuthProvider.call(this, 'facebook.com'); }
  FacebookAuthProvider.prototype = Object.create(AuthProvider.prototype);
  FacebookAuthProvider.PROVIDER_ID = 'facebook.com';
  function OAuthProvider(id) {
    if (!id || typeof id !== 'string') throw errOf({ code: 'auth/argument-error' });
    AuthProvider.call(this, id);
  }
  OAuthProvider.prototype = Object.create(AuthProvider.prototype);
  OAuthProvider.prototype.credential = function (o) { return { providerId: this.providerId, signInMethod: this.providerId, idToken: o && o.idToken, accessToken: o && o.accessToken }; };
  var EmailAuthProvider = { PROVIDER_ID: 'password', credential: function (email, password) { return { providerId: 'password', signInMethod: 'password', email: email, password: password }; } };

  /* which e-mail a provider "vouches" for by default */
  var VOUCHES = { 'google.com': true, 'facebook.com': false, password: false };

  function User(uid) { this.uid = uid; this.providerId = 'firebase'; this.isAnonymous = false; this._sync(); }
  User.prototype._acct = function () { return state.accounts[this.uid] || null; };
  User.prototype._sync = function () {
    var a = this._acct();
    if (!a) return;
    this.email = a.email || null;
    this.emailVerified = !!a.emailVerified;
    this.displayName = a.displayName || null;
    this.photoURL = a.photoURL || null;
    this.phoneNumber = null;
    this.tenantId = null;
    this.providerData = (a.providers || []).map(function (p) {
      return { providerId: p.providerId, uid: p.uid || a.email || a.uid, email: p.email || a.email || null, displayName: p.displayName || a.displayName || null, photoURL: p.photoURL || null, phoneNumber: null };
    });
    this.metadata = { creationTime: new Date(a.created || now()).toUTCString(), lastSignInTime: new Date(a.lastSignIn || now()).toUTCString() };
  };
  function scripted(op, info, extraArgs) {
    var q = take(op, info);
    return later((q && q.delayMs) || 8).then(function () {
      if (q && q.reject) throw errOf(q.reject);
      return q;
    });
  }
  User.prototype.updateProfile = function (p) {
    rec('user.updateProfile', [p], { uid: this.uid });
    var self = this;
    return scripted('updateProfile').then(function () {
      var a = self._acct(); if (!a) throw errOf({ code: 'auth/user-token-expired' });
      if (p && 'displayName' in p) a.displayName = p.displayName;
      if (p && 'photoURL' in p) a.photoURL = p.photoURL;
      save(); self._sync();
    });
  };
  User.prototype.sendEmailVerification = function (settings) {
    rec('user.sendEmailVerification', [settings], { uid: this.uid });
    var self = this;
    return scripted('sendEmailVerification').then(function () {
      state.outbox.push({ kind: 'verify', to: self.email, settings: ser(settings) }); save();
    });
  };
  User.prototype.reload = function () {
    rec('user.reload', [], { uid: this.uid });
    var self = this;
    return scripted('reload').then(function () {
      if (!self._acct()) throw errOf({ code: 'auth/user-not-found' });
      self._sync();
    });
  };
  User.prototype.getIdToken = function (force) {
    rec('user.getIdToken', [force], { uid: this.uid });
    var self = this;
    return scripted('getIdToken').then(function () { return 'fake-id-token.' + self.uid + '.' + (self.emailVerified ? 'v' : 'u'); });
  };
  User.prototype.getIdTokenResult = function (force) {
    rec('user.getIdTokenResult', [force], { uid: this.uid });
    var self = this;
    return scripted('getIdTokenResult').then(function () {
      var a = self._acct() || {};
      var claims = { email: self.email, email_verified: self.emailVerified, user_id: self.uid,
        firebase: { sign_in_provider: a.lastProvider || ((a.providers || [])[0] || {}).providerId || 'custom' } };
      for (var k in (a.claims || {})) claims[k] = a.claims[k];
      return { token: 'fake-id-token.' + self.uid, claims: claims, signInProvider: claims.firebase.sign_in_provider };
    });
  };
  User.prototype.linkWithCredential = function (cred) {
    rec('user.linkWithCredential', [cred], { uid: this.uid });
    var self = this;
    return scripted('linkWithCredential').then(function () {
      var a = self._acct(); if (!a) throw errOf({ code: 'auth/user-token-expired' });
      var pid = cred && cred.providerId;
      if (!pid) throw errOf({ code: 'auth/argument-error' });
      if (a.providers.some(function (p) { return p.providerId === pid; })) throw errOf({ code: 'auth/provider-already-linked' });
      a.providers.push({ providerId: pid, uid: (cred.providerUid || pid + ':' + a.email), email: a.email });
      save(); self._sync();
      return { user: self, credential: cred, additionalUserInfo: { isNewUser: false, providerId: pid }, operationType: 'link' };
    });
  };
  User.prototype.linkWithPopup = function (provider) {
    rec('user.linkWithPopup', [provider], { uid: this.uid, userActivation: activation() });
    var self = this;
    return scripted('linkWithPopup', { provider: provider && provider.providerId }).then(function () {
      var a = self._acct(), pid = provider.providerId;
      if (a.providers.some(function (p) { return p.providerId === pid; })) throw errOf({ code: 'auth/provider-already-linked' });
      a.providers.push({ providerId: pid, uid: pid + ':' + a.email, email: a.email });
      save(); self._sync();
      return { user: self, credential: { providerId: pid, signInMethod: pid }, additionalUserInfo: { isNewUser: false, providerId: pid }, operationType: 'link' };
    });
  };
  User.prototype.reauthenticateWithPopup = function (provider) {
    rec('user.reauthenticateWithPopup', [provider], { uid: this.uid, userActivation: activation() });
    var self = this;
    return scripted('reauthenticateWithPopup', { provider: provider && provider.providerId }).then(function () {
      var a = self._acct();
      if (!a || !a.providers.some(function (p) { return p.providerId === provider.providerId; })) throw errOf({ code: 'auth/user-mismatch' });
      a.lastSignIn = now(); save(); self._sync();
      return { user: self, credential: { providerId: provider.providerId }, additionalUserInfo: { isNewUser: false, providerId: provider.providerId }, operationType: 'reauthenticate' };
    });
  };
  User.prototype.reauthenticateWithCredential = function (cred) {
    rec('user.reauthenticateWithCredential', [cred], { uid: this.uid });
    var self = this;
    return scripted('reauthenticateWithCredential').then(function () {
      var a = self._acct();
      if (!a || !cred) throw errOf({ code: 'auth/user-mismatch' });
      if (cred.providerId === 'password') {
        if (!cred.password) throw errOf({ code: 'auth/missing-password' });
        if (String(cred.email || '').toLowerCase() !== String(a.email || '').toLowerCase() || cred.password !== a.password) throw errOf({ code: 'auth/invalid-credential' });
      }
      a.lastSignIn = now(); save(); self._sync();
      return { user: self, credential: null, additionalUserInfo: { isNewUser: false, providerId: cred.providerId }, operationType: 'reauthenticate' };
    });
  };
  User.prototype.delete = function () {
    rec('user.delete', [], { uid: this.uid });
    var self = this;
    return scripted('delete').then(function (q) {
      delete state.accounts[self.uid];
      save();
      if (currentUser && currentUser.uid === self.uid) {
        if (q && q.lateNotifyMs) {             // scripted: listeners hear of the sign-out only AFTER delete() resolves
          currentUser = null; state.currentUid = null; save();
          setTimeout(function () { setCurrent(null); }, q.lateNotifyMs);
        } else setCurrent(null);               // the real SDK signs out (and notifies) before resolving
      }
      return micro();
    });
  };
  User.prototype.toJSON = function () { return { uid: this.uid, email: this.email, displayName: this.displayName }; };

  /* ---- the auth instance --------------------------------------------------- */
  var currentUser = null, authListeners = [], lastNotified, authInstance = null, lang = null;
  function setCurrent(u) {
    currentUser = u;
    state.currentUid = u ? u.uid : null;
    save();
    var uid = u ? u.uid : null;
    if (uid === lastNotified) return;
    lastNotified = uid;
    var snapshot = u;
    authListeners.slice().forEach(function (l) { micro().then(function () { if (l.live) l.fn(snapshot); }); });
  }
  function acctByEmail(email) {
    var e = String(email || '').toLowerCase();
    for (var k in state.accounts) if (String(state.accounts[k].email || '').toLowerCase() === e && e) return state.accounts[k];
    return null;
  }
  function newUid() { var u = 'uid' + (state.seq++) + Math.random().toString(36).slice(2, 8); save(); return u; }
  function signedIn(a, providerId, isNew, cred, opType) {
    a.lastSignIn = now(); a.lastProvider = providerId; save();
    var u = new User(a.uid);
    setCurrent(u);
    return micro().then(function () {
      return { user: u, credential: cred || null, additionalUserInfo: { isNewUser: !!isNew, providerId: providerId, profile: {} }, operationType: opType || 'signIn' };
    });
  }
  function popupSignIn(pid, id) {
    id = id || {};
    var a = null, isNew = false;
    if (id.uid && state.accounts[id.uid]) a = state.accounts[id.uid];
    if (!a) {
      for (var k in state.accounts) {
        var x = state.accounts[k];
        if (x.providers.some(function (p) { return p.providerId === pid && (!id.email || String(p.email || x.email).toLowerCase() === String(id.email).toLowerCase()); })) { a = x; break; }
      }
    }
    var cred = { providerId: pid, signInMethod: pid, accessToken: 'fake-' + pid + '-access-token' };
    if (!a) {
      var same = id.email ? acctByEmail(id.email) : null;
      if (same) {   // one account per e-mail address
        throw errOf({ code: 'auth/account-exists-with-different-credential', credential: cred, email: id.email });
      }
      var uid = id.uid || newUid();
      a = state.accounts[uid] = {
        uid: uid, email: id.email || null, displayName: id.displayName || null, photoURL: id.photoURL || null,
        emailVerified: 'emailVerified' in id ? !!id.emailVerified : (pid in VOUCHES ? VOUCHES[pid] : true),
        providers: [{ providerId: pid, uid: pid + ':' + (id.email || ''), email: id.email || null }], created: now(), claims: id.claims || {}
      };
      isNew = true;
    }
    if ('isNewUser' in id) isNew = !!id.isNewUser;
    return signedIn(a, pid, isNew, cred);
  }
  var validEmail = function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); };

  function makeAuth() {
    var auth = {
      get currentUser() { return currentUser; },
      get languageCode() { return lang; },
      set languageCode(v) { lang = v; rec('auth.languageCode=', [v]); },
      get app() { return window.firebase.apps[0]; },
      onAuthStateChanged: function (next, error) {
        var fn = typeof next === 'function' ? next : function (u) { if (next && next.next) next.next(u); };
        rec('auth.onAuthStateChanged', []);
        var l = { fn: fn, live: true };
        authListeners.push(l);
        micro().then(function () { if (l.live) l.fn(currentUser); });
        return function () { l.live = false; authListeners = authListeners.filter(function (x) { return x !== l; }); };
      },
      onIdTokenChanged: function (next) { return auth.onAuthStateChanged(next); },
      signInWithPopup: function (provider) {
        rec('auth.signInWithPopup', [provider], { userActivation: activation() });
        var q = take('signInWithPopup', { provider: provider && provider.providerId });
        if (!(provider instanceof AuthProvider)) return Promise.reject(errOf({ code: 'auth/argument-error' }));
        return later((q && q.delayMs) || 10).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          return popupSignIn(provider.providerId, q && q.resolve);
        });
      },
      signInWithRedirect: function (provider) { rec('auth.signInWithRedirect', [provider]); return Promise.reject(errOf({ code: 'auth/operation-not-supported-in-this-environment' })); },
      createUserWithEmailAndPassword: function (email, password) {
        rec('auth.createUserWithEmailAndPassword', [email, password]);
        var q = take('createUserWithEmailAndPassword');
        return later((q && q.delayMs) || 10).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          if (!validEmail(email)) throw errOf({ code: 'auth/invalid-email' });
          if (!password) throw errOf({ code: 'auth/missing-password' });
          if (String(password).length < 6) throw errOf({ code: 'auth/weak-password' });
          if (acctByEmail(email)) throw errOf({ code: 'auth/email-already-in-use' });
          var uid = newUid();
          var a = state.accounts[uid] = { uid: uid, email: email, displayName: null, photoURL: null, emailVerified: false, password: password,
            providers: [{ providerId: 'password', uid: email, email: email }], created: now(), claims: {} };
          return signedIn(a, 'password', true, null);
        });
      },
      signInWithEmailAndPassword: function (email, password) {
        rec('auth.signInWithEmailAndPassword', [email, password]);
        var q = take('signInWithEmailAndPassword');
        return later((q && q.delayMs) || 10).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          if (!validEmail(email)) throw errOf({ code: 'auth/invalid-email' });
          var a = acctByEmail(email);
          if (!a || !a.providers.some(function (p) { return p.providerId === 'password'; }) || a.password !== password) throw errOf({ code: 'auth/invalid-credential' });
          if (a.disabled) throw errOf({ code: 'auth/user-disabled' });
          return signedIn(a, 'password', false, null);
        });
      },
      sendPasswordResetEmail: function (email, settings) {
        rec('auth.sendPasswordResetEmail', [email, settings]);
        var q = take('sendPasswordResetEmail');
        return later((q && q.delayMs) || 10).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          if (!validEmail(email)) throw errOf({ code: 'auth/invalid-email' });
          if (acctByEmail(email)) { state.outbox.push({ kind: 'reset', to: email, settings: ser(settings) }); save(); }
        });
      },
      signInWithCustomToken: function (token) {
        rec('auth.signInWithCustomToken', [token]);
        var q = take('signInWithCustomToken');
        return later((q && q.delayMs) || 10).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          var id = (q && q.resolve) || null, a = null;
          if (id) {
            a = (id.uid && state.accounts[id.uid]) || null;
            if (!a) {
              var uid = id.uid || newUid();
              a = state.accounts[uid] = { uid: uid, email: id.email || null, displayName: id.displayName || null, photoURL: id.photoURL || null,
                emailVerified: 'emailVerified' in id ? !!id.emailVerified : true, providers: [], created: now(), claims: id.claims || {} };
            }
          } else if (state.tokens[token] && state.accounts[state.tokens[token]]) a = state.accounts[state.tokens[token]];
          if (!a) throw errOf({ code: 'auth/invalid-custom-token' });
          return signedIn(a, 'custom', !!(id && id.isNewUser), null);
        });
      },
      signOut: function () {
        rec('auth.signOut', []);
        var q = take('signOut');
        return later((q && q.delayMs) || 5).then(function () {
          if (q && q.reject) throw errOf(q.reject);
          setCurrent(null);
        });
      },
      useDeviceLanguage: function () { lang = 'device'; }
    };
    return auth;
  }
  function installAuth() {
    if (!window.firebase) installApp();
    if (window.firebase.auth) return;
    var fn = function () {
      if (!window.firebase.apps.length) throw errOf({ code: 'app/no-app', message: 'No Firebase App has been created - call initializeApp() first' });
      if (!authInstance) {
        authInstance = makeAuth();
        // the persisted session, as the real SDK restores it from the browser
        if (state.currentUid && state.accounts[state.currentUid]) currentUser = new User(state.currentUid);
        else if (state.currentUid) { state.currentUid = null; save(); }
        lastNotified = currentUser ? currentUser.uid : null;
      }
      return authInstance;
    };
    fn.GoogleAuthProvider = GoogleAuthProvider;
    fn.FacebookAuthProvider = FacebookAuthProvider;
    fn.OAuthProvider = OAuthProvider;
    fn.EmailAuthProvider = EmailAuthProvider;
    fn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
    window.firebase.auth = fn;
  }

  /* ======================================================================= */
  /* firebase-firestore                                                       */
  /* ======================================================================= */
  function FieldValue(kind, els, n) { this._kind = kind; this._els = els || null; this._n = n; }
  FieldValue.serverTimestamp = function () { return new FieldValue('serverTimestamp'); };
  FieldValue.arrayUnion = function () { return new FieldValue('arrayUnion', Array.prototype.slice.call(arguments)); };
  FieldValue.arrayRemove = function () { return new FieldValue('arrayRemove', Array.prototype.slice.call(arguments)); };
  FieldValue.delete = function () { return new FieldValue('delete'); };
  FieldValue.increment = function (n) { return new FieldValue('increment', null, n); };
  FieldValue.prototype.isEqual = function (o) { return o instanceof FieldValue && JSON.stringify(ser(o)) === JSON.stringify(ser(this)); };

  function Timestamp(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
  Timestamp.fromMillis = function (ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); };
  Timestamp.fromDate = function (d) { return Timestamp.fromMillis(d.getTime()); };
  Timestamp.now = function () { return Timestamp.fromMillis(now()); };
  Timestamp.prototype.toMillis = function () { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); };
  Timestamp.prototype.toDate = function () { return new Date(this.toMillis()); };
  Timestamp.prototype.isEqual = function (o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); };
  Timestamp.prototype.valueOf = function () { return String(this.toMillis()).padStart(20, '0'); };
  Timestamp.prototype.toString = function () { return 'Timestamp(seconds=' + this.seconds + ', nanoseconds=' + this.nanoseconds + ')'; };

  /* stored form: JSON, a Timestamp is {__ts: ms}, a not-yet-acknowledged
     serverTimestamp() is {__pendingTs: 1} and reads as null */
  function toStored(v) {
    if (v instanceof Timestamp) return { __ts: v.toMillis() };
    if (v instanceof Date) return { __ts: v.getTime() };
    if (Array.isArray(v)) return v.map(toStored);
    if (v && typeof v === 'object') { var o = {}; for (var k in v) o[k] = toStored(v[k]); return o; }
    return v;
  }
  function fromStored(v) {
    if (Array.isArray(v)) return v.map(fromStored);
    if (v && typeof v === 'object') {
      if ('__ts' in v) return Timestamp.fromMillis(v.__ts);
      if ('__pendingTs' in v) return null;
      var o = {}; for (var k in v) o[k] = fromStored(v[k]); return o;
    }
    return v;
  }
  function hasPending(v) { return JSON.stringify(v || null).indexOf('"__pendingTs"') !== -1; }
  function resolvePending(v, t) {
    if (Array.isArray(v)) return v.map(function (x) { return resolvePending(x, t); });
    if (v && typeof v === 'object') {
      if ('__pendingTs' in v) return { __ts: t };
      var o = {}; for (var k in v) o[k] = resolvePending(v[k], t); return o;
    }
    return v;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  /* the real SDK refuses these synchronously */
  function checkData(data, where, top) {
    if (top && (data === null || typeof data !== 'object' || Array.isArray(data))) throw errOf({ code: 'invalid-argument', message: 'Function ' + where + '() called with invalid data. Data must be an object' });
    (function walk(v, path) {
      if (v === undefined) throw errOf({ code: 'invalid-argument', message: 'Function ' + where + '() called with invalid data. Unsupported field value: undefined (found in field ' + path + ')' });
      if (typeof v === 'function') throw errOf({ code: 'invalid-argument', message: 'Function ' + where + '() called with invalid data. Unsupported field value: a function (found in field ' + path + ')' });
      if (v instanceof FieldValue) { if (v._els) v._els.forEach(function (x, i) { walk(x, path + '[' + i + ']'); }); return; }
      if (Array.isArray(v)) { v.forEach(function (x, i) { if (Array.isArray(x)) throw errOf({ code: 'invalid-argument', message: 'Nested arrays are not supported' }); walk(x, path + '[' + i + ']'); }); return; }
      if (v && typeof v === 'object' && !(v instanceof Timestamp) && !(v instanceof Date)) {
        var proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) throw errOf({ code: 'invalid-argument', message: 'Function ' + where + '() called with invalid data. Unsupported field value: a custom object (found in field ' + path + ')' });
        for (var k in v) walk(v[k], path ? path + '.' + k : k);
      }
    })(data, '');
  }
  function applyFields(base, data) {
    for (var k in data) {
      var v = data[k];
      if (v instanceof FieldValue) {
        if (v._kind === 'serverTimestamp') base[k] = { __pendingTs: 1 };
        else if (v._kind === 'delete') delete base[k];
        else if (v._kind === 'increment') base[k] = (typeof base[k] === 'number' ? base[k] : 0) + v._n;
        else if (v._kind === 'arrayUnion') {
          var arr = Array.isArray(base[k]) ? base[k].slice() : [];
          v._els.forEach(function (e) { var s = toStored(e); if (!arr.some(function (x) { return same(x, s); })) arr.push(s); });
          base[k] = arr;
        } else if (v._kind === 'arrayRemove') {
          base[k] = Array.isArray(base[k]) ? base[k].filter(function (x) { return !v._els.some(function (e) { return same(x, toStored(e)); }); }) : [];
        }
      } else base[k] = toStored(v);
    }
    return base;
  }

  /* ---- listeners ----------------------------------------------------------- */
  var fsListeners = [];
  function docView(path) { return state.docs[path] === undefined ? null : state.docs[path]; }
  function colView(col) {
    var out = {}, pre = col + '/';
    Object.keys(state.docs).sort().forEach(function (p) { if (p.indexOf(pre) === 0 && p.slice(pre.length).indexOf('/') === -1) out[p] = state.docs[p]; });
    return out;
  }
  function viewOf(l) { return l.kind === 'doc' ? docView(l.path) : colView(l.path); }
  function deliver(l) {
    if (!l.live) return;
    var v = viewOf(l), key = JSON.stringify(v);
    if (l.last === key) return;              // like the real SDK: no event when nothing changed
    l.last = key;
    try { l.next(l.kind === 'doc' ? new DocSnap(l.path, v) : new QuerySnap(l.path, v)); } catch (e) { setTimeout(function () { throw e; }); }
  }
  function notifyAll() { fsListeners.slice().forEach(function (l) { setTimeout(function () { deliver(l); }, 0); }); }

  function DocSnap(path, stored) {
    this.ref = new DocRef(path);
    this.id = path.split('/').pop();
    this.exists = stored !== null && stored !== undefined;
    this._stored = stored;
    this.metadata = { hasPendingWrites: hasPending(stored), fromCache: false };
  }
  DocSnap.prototype.data = function () { return this.exists ? fromStored(this._stored) : undefined; };
  DocSnap.prototype.get = function (f) { var d = this.data(); return d ? d[f] : undefined; };
  function QuerySnap(col, map) {
    var docs = Object.keys(map).map(function (p) { return new DocSnap(p, map[p]); });
    this.docs = docs; this.size = docs.length; this.empty = !docs.length;
    this.metadata = { hasPendingWrites: docs.some(function (d) { return d.metadata.hasPendingWrites; }), fromCache: false };
    this.query = new ColRef(col);
  }
  QuerySnap.prototype.forEach = function (fn, thisArg) { this.docs.forEach(function (d) { fn.call(thisArg, d); }); };
  QuerySnap.prototype.docChanges = function () { return this.docs.map(function (d, i) { return { type: 'added', doc: d, oldIndex: -1, newIndex: i }; }); };

  function listen(kind, path, a, b) {
    var next = typeof a === 'function' ? a : (a && a.next ? a.next.bind(a) : function () {});
    var error = typeof a === 'function' ? b : (a && a.error ? a.error.bind(a) : b);
    rec('fs.onSnapshot', [path], { kind: kind });
    var q = take(kind === 'doc' ? 'fs.onSnapshot' : 'fs.list', { path: path });
    var l = { kind: kind, path: path, next: next, live: true, last: null };
    if (q && q.reject) {
      setTimeout(function () { if (l.live && error) error(errOf(q.reject)); }, (q.delayMs || 8));
      return function () { l.live = false; };
    }
    fsListeners.push(l);
    setTimeout(function () { deliver(l); }, (q && q.delayMs) || 8);
    return function () { l.live = false; fsListeners = fsListeners.filter(function (x) { return x !== l; }); };
  }

  /* a write: applied locally at once (listeners see it, serverTimestamp null),
     then "acknowledged": resolved timestamps, or rolled back on a scripted refusal */
  function write(op, path, data, opts) {
    var q = take('fs.' + op, { path: path });
    var before = state.docs[path] === undefined ? undefined : JSON.parse(JSON.stringify(state.docs[path]));
    var missing = before === undefined;
    if (op === 'update' && missing) {
      return later(8).then(function () { throw errOf({ code: 'not-found', message: 'No document to update: ' + path }); });
    }
    if (op === 'set') state.docs[path] = applyFields((opts && (opts.merge || opts.mergeFields)) && before ? JSON.parse(JSON.stringify(before)) : {}, data);
    else if (op === 'update') state.docs[path] = applyFields(JSON.parse(JSON.stringify(before)), data);
    else if (op === 'delete') delete state.docs[path];
    save();
    notifyAll();
    return later((q && q.delayMs) || 15).then(function () {
      if (q && q.reject) {                     // the server refused: roll the local write back
        if (before === undefined) delete state.docs[path]; else state.docs[path] = before;
        save(); notifyAll();
        throw errOf(q.reject);
      }
      if (state.docs[path] && hasPending(state.docs[path])) state.docs[path] = resolvePending(state.docs[path], now());
      save();
      // the promise settles first; listeners hear about the resolved timestamp after
      setTimeout(notifyAll, 0);
    });
  }

  function DocRef(path) { this.path = path; this.id = path.split('/').pop(); }
  Object.defineProperty(DocRef.prototype, 'parent', { get: function () { return new ColRef(this.path.split('/').slice(0, -1).join('/')); } });
  DocRef.prototype.get = function (opts) {
    rec('fs.get', opts === undefined ? [this.path] : [this.path, opts]);
    var path = this.path, q = take('fs.get', { path: path });
    return later((q && q.delayMs) || 8).then(function () {
      if (q && q.reject) throw errOf(q.reject);
      return new DocSnap(path, docView(path));
    });
  };
  DocRef.prototype.set = function (data, opts) {
    checkData(data, 'DocumentReference.set', true);
    rec('fs.set', opts === undefined ? [this.path, data] : [this.path, data, opts]);
    return write('set', this.path, data, opts);
  };
  DocRef.prototype.update = function (data) {
    if (arguments.length > 1 || typeof data !== 'object') throw errOf({ code: 'invalid-argument', message: 'fake: update(field, value, …) form is not supported' });
    checkData(data, 'DocumentReference.update', true);
    for (var k in data) if (k.indexOf('.') !== -1) throw errOf({ code: 'invalid-argument', message: 'fake: dotted field paths are not supported (' + k + ')' });
    rec('fs.update', [this.path, data]);
    return write('update', this.path, data);
  };
  DocRef.prototype.delete = function () {
    rec('fs.delete', [this.path]);
    return write('delete', this.path, null);
  };
  DocRef.prototype.onSnapshot = function (a, b) { return listen('doc', this.path, a, b); };
  DocRef.prototype.collection = function (name) { return new ColRef(this.path + '/' + name); };
  DocRef.prototype.isEqual = function (o) { return o instanceof DocRef && o.path === this.path; };

  function ColRef(path) { this.path = path; this.id = path.split('/').pop(); }
  ColRef.prototype.doc = function (id) {
    if (id === undefined) id = 'auto' + (state.seq++) + Math.random().toString(36).slice(2, 10);
    if (typeof id !== 'string' || !id || id.indexOf('/') !== -1) throw errOf({ code: 'invalid-argument', message: 'Invalid document id: ' + id });
    return new DocRef(this.path + '/' + id);
  };
  ColRef.prototype.get = function () {
    rec('fs.list', [this.path]);
    var path = this.path, q = take('fs.list', { path: path });
    return later((q && q.delayMs) || 8).then(function () {
      if (q && q.reject) throw errOf(q.reject);
      return new QuerySnap(path, colView(path));
    });
  };
  ColRef.prototype.onSnapshot = function (a, b) { return listen('col', this.path, a, b); };
  ColRef.prototype.add = function (data) { var r = this.doc(); return r.set(data).then(function () { return r; }); };
  ['where', 'orderBy', 'limit'].forEach(function (m) {
    ColRef.prototype[m] = function () { throw errOf({ code: 'unimplemented', message: 'fake: query ' + m + '() is not supported; add it to tools/firebase-fake.js if the site starts using it' }); };
  });

  var dbInstance = null;
  function installFirestore() {
    if (!window.firebase) installApp();
    if (window.firebase.firestore) return;
    var fn = function () {
      if (!window.firebase.apps.length) throw errOf({ code: 'app/no-app' });
      if (!dbInstance) {
        rec('firestore()', []);
        dbInstance = {
          collection: function (name) {
            if (!name || String(name).split('/').length % 2 !== 1) throw errOf({ code: 'invalid-argument', message: 'Invalid collection path: ' + name });
            return new ColRef(name);
          },
          doc: function (path) { return new DocRef(path); },
          get app() { return window.firebase.apps[0]; }
        };
      }
      return dbInstance;
    };
    fn.FieldValue = FieldValue;
    fn.Timestamp = Timestamp;
    window.firebase.firestore = fn;
  }

  /* ---- the backend, for the test ------------------------------------------ */
  F.server = {
    setDoc: function (path, data) { state.docs[path] = JSON.parse(JSON.stringify(data)); save(); notifyAll(); },
    deleteDoc: function (path) { delete state.docs[path]; save(); notifyAll(); },
    doc: function (path) { return state.docs[path] === undefined ? null : JSON.parse(JSON.stringify(state.docs[path])); },
    docs: function () { return JSON.parse(JSON.stringify(state.docs)); },
    account: function (uid) { return state.accounts[uid] ? JSON.parse(JSON.stringify(state.accounts[uid])) : null; },
    accounts: function () { return JSON.parse(JSON.stringify(state.accounts)); },
    setAccount: function (uid, patch) { var a = state.accounts[uid] || (state.accounts[uid] = { uid: uid, providers: [], created: now() }); for (var k in patch) a[k] = patch[k]; save(); },
    verify: function (uid, v) { if (state.accounts[uid]) { state.accounts[uid].emailVerified = v !== false; save(); } },
    currentUid: function () { return state.currentUid; }
  };

  window.__fbFakeInstall = function (part) {
    F.parts.push(part);
    if (part === 'app' || part === 'all') installApp();
    if (part === 'auth' || part === 'all') installAuth();
    if (part === 'firestore' || part === 'all') installFirestore();
    save();
  };
  window.__fbFakeInstall(PART);
})();
