/* Offline tests for linkedin.js: no network, no Firebase. Run: npm test */
'use strict';
const assert = require('node:assert');
const { handle, cleanProfile, cleanupUser } = require('./linkedin');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
}

/* ---- fakes ---- */
function fakeAuth(users) {
  const byUid = new Map(users.map(u => [u.uid, Object.assign({ customClaims: {} }, u)]));
  let n = 0;
  const notFound = () => { const e = new Error('nf'); e.code = 'auth/user-not-found'; return e; };
  return {
    byUid, calls: [],
    async getUser(uid) { this.calls.push(['getUser', uid]); if (!byUid.has(uid)) throw notFound(); return byUid.get(uid); },
    async getUserByEmail(email) {
      this.calls.push(['getUserByEmail', email]);
      for (const u of byUid.values()) if (u.email === email) return u;
      throw notFound();
    },
    async createUser(f) {
      this.calls.push(['createUser', f]);
      for (const u of byUid.values()) if (f.email && u.email === f.email) { const e = new Error('x'); e.code = 'auth/email-already-exists'; throw e; }
      const u = Object.assign({ uid: 'new' + (++n), customClaims: {} }, f); byUid.set(u.uid, u); return u;
    },
    async updateUser(uid, p) { this.calls.push(['updateUser', uid, p]); Object.assign(byUid.get(uid), p); },
    async setCustomUserClaims(uid, c) { this.calls.push(['claims', uid, c]); byUid.get(uid).customClaims = c; },
    async createCustomToken(uid, c) { this.calls.push(['token', uid, c]); return 'TOKEN:' + uid; },
    async verifyIdToken(t) {
      if (t === 'good-id-token') return { uid: 'me', email: 'me@x.gr', email_verified: true };
      if (t === 'unverified-id-token') return { uid: 'me', email: 'admin@x.gr', email_verified: false };
      if (t === 'no-email-id-token') return { uid: 'me' };
      throw new Error('bad');
    }
  };
}
function fakeDb(links) {
  const store = new Map(Object.entries(links || {}));
  return {
    store,
    collection(name) {
      assert.strictEqual(name, 'linkedinLinks');
      return { doc(id) { return {
        async get() { return { exists: store.has(id), data: () => store.get(id) }; },
        async set(v, o) { store.set(id, Object.assign({}, o && o.merge ? store.get(id) : {}, v)); }
      }; } };
    }
  };
}
function fakeFetch(profile, opts) {
  opts = opts || {};
  const calls = [];
  const fn = async (url, init) => {
    calls.push([url, init]);
    if (url.startsWith('https://www.linkedin.com/oauth/v2/accessToken')) {
      if (opts.reject) return { ok: false, json: async () => ({ error: 'invalid_request' }) };
      return { ok: true, json: async () => ({ access_token: 'AT', id_token: 'x' }) };
    }
    if (url === 'https://api.linkedin.com/v2/userinfo') return { ok: true, json: async () => profile };
    throw new Error('unexpected ' + url);
  };
  fn.calls = calls;
  return fn;
}
function req(body, headers, method) {
  const h = Object.assign({ origin: 'https://www.stouras.com' }, headers || {});
  return { method: method || 'POST', body, get: k => h[k.toLowerCase()], headers: h };
}
function res() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}
const CFG = { clientId: 'CID', clientSecret: 'SECRET', allowedOrigins: ['https://www.stouras.com'], redirectUris: ['https://www.stouras.com/semfealumni/auth/linkedin/'] };
const RU = CFG.redirectUris[0];
const P = { sub: 'li-1', name: 'Μαρία Παπαδοπούλου', given_name: 'Μαρία', family_name: 'Παπαδοπούλου', picture: 'https://media.licdn.com/p.jpg', email: 'Maria@Example.com', email_verified: true };
async function run(opts) {
  const auth = fakeAuth(opts.users || []), db = fakeDb(opts.links), fetch = fakeFetch(opts.profile || P, opts.fetch);
  const r = res();
  await handle(req(opts.body || { code: 'CODE', redirectUri: RU }, opts.headers, opts.method), r, { fetch, auth, db, now: () => 'NOW' }, opts.cfg || CFG);
  return { r, auth, db, fetch };
}

(async () => {
  await t('preflight from the site is allowed', async () => {
    const { r } = await run({ method: 'OPTIONS' });
    assert.strictEqual(r.statusCode, 204);
    assert.strictEqual(r.headers['Access-Control-Allow-Origin'], 'https://www.stouras.com');
    assert.match(r.headers['Access-Control-Allow-Headers'], /Authorization/);
  });
  await t('preflight and POST from another origin are refused', async () => {
    assert.strictEqual((await run({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).r.statusCode, 403);
    const x = await run({ headers: { origin: 'https://evil.example' } });
    assert.strictEqual(x.r.statusCode, 403); assert.strictEqual(x.r.body.error, 'origin-not-allowed');
    assert.strictEqual(x.fetch.calls.length, 0);
  });
  await t('GET is refused', async () => { assert.strictEqual((await run({ method: 'GET' })).r.statusCode, 405); });
  await t('a redirect URI that is not registered is refused before calling LinkedIn', async () => {
    const x = await run({ body: { code: 'C', redirectUri: 'https://evil.example/cb' } });
    assert.strictEqual(x.r.statusCode, 400); assert.strictEqual(x.fetch.calls.length, 0);
  });
  await t('missing / huge code is refused', async () => {
    assert.strictEqual((await run({ body: { redirectUri: RU } })).r.statusCode, 400);
    assert.strictEqual((await run({ body: { code: 'x'.repeat(3000), redirectUri: RU } })).r.statusCode, 400);
  });
  await t('not configured -> 500 not-configured', async () => {
    const x = await run({ cfg: Object.assign({}, CFG, { clientSecret: '' }) });
    assert.strictEqual(x.r.statusCode, 500); assert.strictEqual(x.r.body.error, 'not-configured');
  });
  await t('the client secret goes in the POST BODY (what LinkedIn requires), not a Basic header', async () => {
    const x = await run({});
    const [url, init] = x.fetch.calls[0];
    assert.strictEqual(url, 'https://www.linkedin.com/oauth/v2/accessToken');
    const body = new URLSearchParams(init.body);
    assert.strictEqual(body.get('client_secret'), 'SECRET');
    assert.strictEqual(body.get('client_id'), 'CID');
    assert.strictEqual(body.get('grant_type'), 'authorization_code');
    assert.strictEqual(body.get('redirect_uri'), RU);
    assert.ok(!init.headers.Authorization, 'no Authorization header on the token call');
    assert.strictEqual(x.fetch.calls[1][1].headers.Authorization, 'Bearer AT');
  });
  await t('LinkedIn rejects the code -> 401, no user created', async () => {
    const x = await run({ fetch: { reject: true } });
    assert.strictEqual(x.r.statusCode, 401); assert.strictEqual(x.r.body.error, 'linkedin-code-rejected');
    assert.ok(!x.auth.calls.some(c => c[0] === 'createUser'));
  });
  await t('new member with a verified e-mail: account created, linked, token returned', async () => {
    const x = await run({});
    assert.strictEqual(x.r.statusCode, 200);
    assert.strictEqual(x.r.body.isNew, true);
    assert.strictEqual(x.r.body.token, 'TOKEN:new1');
    const create = x.auth.calls.find(c => c[0] === 'createUser')[1];
    assert.deepStrictEqual(create, { emailVerified: true, email: 'maria@example.com', displayName: 'Μαρία Παπαδοπούλου', photoURL: 'https://media.licdn.com/p.jpg' });
    assert.strictEqual(x.db.store.get('li-1').uid, 'new1');
    assert.strictEqual(x.auth.byUid.get('new1').customClaims.li, true);
  });
  await t('an UNverified LinkedIn e-mail is not used', async () => {
    const x = await run({ profile: Object.assign({}, P, { email_verified: false }) });
    const create = x.auth.calls.find(c => c[0] === 'createUser')[1];
    assert.strictEqual(create.email, undefined); assert.strictEqual(create.emailVerified, false);
    assert.ok(!x.auth.calls.some(c => c[0] === 'getUserByEmail'));
  });
  await t('no e-mail from LinkedIn at all still signs in', async () => {
    const pr = Object.assign({}, P); delete pr.email; delete pr.email_verified;
    const x = await run({ profile: pr });
    assert.strictEqual(x.r.statusCode, 200);
  });
  await t('existing VERIFIED account with the same e-mail (e.g. Google) is reused, not duplicated', async () => {
    const x = await run({ users: [{ uid: 'g1', email: 'maria@example.com', emailVerified: true, displayName: 'Maria P' }] });
    assert.strictEqual(x.r.body.token, 'TOKEN:g1'); assert.strictEqual(x.r.body.isNew, false);
    assert.ok(!x.auth.calls.some(c => c[0] === 'createUser'));
    assert.strictEqual(x.auth.byUid.get('g1').displayName, 'Maria P', 'an existing name is kept');
    assert.strictEqual(x.db.store.get('li-1').uid, 'g1');
  });
  await t('existing UNVERIFIED account with the same e-mail is NOT handed over', async () => {
    const x = await run({ users: [{ uid: 'p1', email: 'maria@example.com', emailVerified: false }] });
    assert.strictEqual(x.r.statusCode, 409); assert.strictEqual(x.r.body.error, 'account-exists-unverified');
    assert.ok(!x.auth.calls.some(c => c[0] === 'token'));
  });
  await t('a LinkedIn account linked before signs into that account', async () => {
    const x = await run({ users: [{ uid: 'u9', email: 'other@x.gr', emailVerified: true }], links: { 'li-1': { uid: 'u9' } } });
    assert.strictEqual(x.r.body.token, 'TOKEN:u9');
  });
  await t('a link to a deleted account is ignored and a new account made', async () => {
    const x = await run({ links: { 'li-1': { uid: 'gone' } } });
    assert.strictEqual(x.r.body.isNew, true); assert.strictEqual(x.db.store.get('li-1').uid, 'new1');
  });
  await t('LINK mode: a signed-in member connects LinkedIn to their own account', async () => {
    const x = await run({ users: [{ uid: 'me', email: 'me@x.gr', emailVerified: true }], headers: { authorization: 'Bearer good-id-token' } });
    assert.strictEqual(x.r.statusCode, 200); assert.strictEqual(x.r.body.linked, true);
    assert.strictEqual(x.db.store.get('li-1').uid, 'me');
    assert.ok(!x.auth.calls.some(c => c[0] === 'createUser'));
  });
  await t('LINK mode refuses a LinkedIn account already linked to someone else', async () => {
    const x = await run({ users: [{ uid: 'me' }, { uid: 'u2' }], links: { 'li-1': { uid: 'u2' } }, headers: { authorization: 'Bearer good-id-token' } });
    assert.strictEqual(x.r.statusCode, 409); assert.strictEqual(x.r.body.error, 'credential-already-in-use');
  });
  await t('LINK mode with a bad ID token -> 401 before calling LinkedIn', async () => {
    const x = await run({ headers: { authorization: 'Bearer forged' } });
    assert.strictEqual(x.r.statusCode, 401); assert.strictEqual(x.fetch.calls.length, 0);
  });
  await t('LINK mode refuses an account whose e-mail is not verified (pre-account-takeover guard)', async () => {
    const x = await run({ users: [{ uid: 'me', email: 'admin@x.gr', emailVerified: false }], headers: { authorization: 'Bearer unverified-id-token' } });
    assert.strictEqual(x.r.statusCode, 403); assert.strictEqual(x.r.body.error, 'link-needs-verified-email');
    assert.strictEqual(x.fetch.calls.length, 0, 'LinkedIn is not even called');
    assert.strictEqual(x.db.store.size, 0, 'no link is written');
  });
  await t('LINK mode allows an account that has no e-mail at all (nothing to reclaim)', async () => {
    const x = await run({ users: [{ uid: 'me' }], headers: { authorization: 'Bearer no-email-id-token' } });
    assert.strictEqual(x.r.statusCode, 200); assert.strictEqual(x.db.store.get('li-1').uid, 'me');
  });
  await t('cleanProfile: non-https photo dropped, name built from parts, e-mail lower-cased', async () => {
    const c = cleanProfile({ sub: 's', given_name: 'A', family_name: 'B', picture: 'http://x/p.jpg', email: 'A@B.GR', email_verified: true });
    assert.deepStrictEqual(c, { sub: 's', name: 'A B', photo: null, email: 'a@b.gr' });
  });
  await t('existing custom claims are kept when li is added', async () => {
    const x = await run({ users: [{ uid: 'g1', email: 'maria@example.com', emailVerified: true, customClaims: { admin: true } }] });
    assert.deepStrictEqual(x.auth.byUid.get('g1').customClaims, { admin: true, li: true });
  });
  await t('an unexpected error returns 500 "internal" without details', async () => {
    const auth = fakeAuth([]); auth.createUser = async () => { throw new Error('boom secret detail'); };
    const r = res();
    await handle(req({ code: 'C', redirectUri: RU }), r, { fetch: fakeFetch(P), auth, db: fakeDb(), now: () => 1, log: () => {} }, CFG);
    assert.strictEqual(r.statusCode, 500); assert.deepStrictEqual(r.body, { error: 'internal' });
  });
  await t('cleanup of a deleted account removes its application, directory card and LinkedIn links', async () => {
    const docs = new Map([['members/u1', {}], ['directory/u1', {}], ['linkedinLinks/a', { uid: 'u1' }], ['linkedinLinks/b', { uid: 'u2' }], ['members/u2', {}]]);
    const ref = key => ({ key, delete: async () => { docs.delete(key); } });
    const db = { collection(name) { return {
      doc: id => ref(name + '/' + id),
      where(f, op, v) { assert.strictEqual(f, 'uid'); assert.strictEqual(op, '=='); return { async get() {
        const hits = [...docs.entries()].filter(([k, d]) => k.startsWith(name + '/') && d.uid === v).map(([k]) => ({ ref: ref(k) }));
        return { forEach: fn => hits.forEach(fn) };
      } }; }
    }; } };
    const n = await cleanupUser({ db, uid: 'u1' });
    assert.strictEqual(n, 3);
    assert.deepStrictEqual([...docs.keys()].sort(), ['linkedinLinks/b', 'members/u2']);
  });
  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
