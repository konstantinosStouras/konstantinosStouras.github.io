/* SEMFE Alumni: LinkedIn sign-in, the part that needs a server.
 *
 * Why a function at all: Firebase's built-in "OpenID Connect" provider sends
 * the client secret to LinkedIn in an HTTP Basic header, but LinkedIn only
 * accepts it in the POST body ("A required parameter client_secret is
 * missing"), so the built-in route fails at the last step. This function does
 * the exchange itself, the way LinkedIn documents it, and hands the browser a
 * Firebase custom token. The secret lives only in Google Secret Manager.
 *
 * Everything here is pure logic with injected dependencies (fetch, auth,
 * firestore), so test.js runs it offline. index.js wires the real ones.
 *
 * Flow (see assets/js/auth.js and assets/js/linkedin-callback.js):
 *   browser -> LinkedIn authorize (response_type=code, scope openid profile email)
 *   LinkedIn -> <site>/auth/linkedin/?code=…&state=…   (state checked in the browser)
 *   browser -> POST this function {code, redirectUri}  (+ Firebase ID token when LINKING)
 *   function -> LinkedIn token endpoint (client_secret in the body) -> /v2/userinfo
 *   function -> finds or creates the Firebase user, returns {token, isNew}
 *   browser -> signInWithCustomToken(token)
 *
 * Which Firebase account a LinkedIn member lands in:
 *   1. the one this LinkedIn account was linked to before (linkedinLinks/{sub});
 *   2. else, when LinkedIn says the e-mail is VERIFIED and a Firebase account
 *      with that e-mail exists AND its e-mail is verified too, that account
 *      (the same rule Firebase applies to trusted providers). An existing
 *      account whose address was never verified is NOT handed over: that
 *      would let whoever registered the address without proving it take the
 *      real owner's account. The person is asked to sign in the usual way
 *      and link LinkedIn from their account page instead;
 *   3. else a new account.
 * linkedinLinks/ is written only here (Admin SDK); firestore.rules denies it
 * to every browser. */
'use strict';

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const LINKS = 'linkedinLinks';

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function splitList(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }

async function readJson(r) { try { return await r.json(); } catch (e) { return {}; } }

/* LinkedIn: code -> access token -> profile */
async function fetchProfile({ fetch, clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret
  });
  const tr = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString()
  });
  const tj = await readJson(tr);
  if (!tr.ok || !tj.access_token) throw new HttpError(401, 'linkedin-code-rejected');
  const ur = await fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + tj.access_token } });
  const info = await readJson(ur);
  if (!ur.ok || !info || typeof info.sub !== 'string' || !info.sub) throw new HttpError(502, 'linkedin-profile-unavailable');
  return info;
}

function cleanProfile(info) {
  const name = typeof info.name === 'string' && info.name.trim()
    ? info.name.trim()
    : [info.given_name, info.family_name].filter(x => typeof x === 'string' && x.trim()).join(' ').trim();
  const photo = typeof info.picture === 'string' && /^https:\/\//.test(info.picture) && info.picture.length < 2000 ? info.picture : null;
  const email = typeof info.email === 'string' && info.email_verified === true && /^[^\s@]+@[^\s@]+$/.test(info.email)
    ? info.email.trim().toLowerCase() : null;
  return { sub: info.sub, name: name ? name.slice(0, 120) : null, photo, email };
}

async function getUserOrNull(auth, fn) {
  try { return await fn(); } catch (e) { if (e && e.code === 'auth/user-not-found') return null; throw e; }
}

/* Decide which Firebase uid this LinkedIn member signs in as. */
async function resolveUser({ auth, db, now, profile, linkToUid }) {
  const ref = db.collection(LINKS).doc(String(profile.sub));
  const snap = await ref.get();
  const mapped = snap.exists ? (snap.data() || {}).uid : null;
  const remember = uid => ref.set({ uid, updatedAt: now() }, { merge: true });

  if (linkToUid) {                                         // "connect LinkedIn" from the account page
    if (mapped && mapped !== linkToUid && await getUserOrNull(auth, () => auth.getUser(mapped))) {
      throw new HttpError(409, 'credential-already-in-use');
    }
    await remember(linkToUid);
    return { uid: linkToUid, isNew: false };
  }
  if (mapped) {
    const u = await getUserOrNull(auth, () => auth.getUser(mapped));
    if (u) return { uid: u.uid, isNew: false };            // else: that account was deleted; start again
  }
  if (profile.email) {
    const existing = await getUserOrNull(auth, () => auth.getUserByEmail(profile.email));
    if (existing) {
      if (!existing.emailVerified) throw new HttpError(409, 'account-exists-unverified');
      await remember(existing.uid);
      return { uid: existing.uid, isNew: false };
    }
  }
  const fields = { emailVerified: !!profile.email };
  if (profile.email) fields.email = profile.email;
  if (profile.name) fields.displayName = profile.name;
  if (profile.photo) fields.photoURL = profile.photo;
  let created;
  try { created = await auth.createUser(fields); }
  catch (e) {
    if (e && e.code === 'auth/email-already-exists') throw new HttpError(409, 'account-exists-unverified');
    throw e;
  }
  await remember(created.uid);
  return { uid: created.uid, isNew: true };
}

/* Fill a missing name / photo, and mark the account as LinkedIn-linked
   (the custom claim `li` lets the account page show it). */
async function touchUser({ auth, uid, profile }) {
  const u = await auth.getUser(uid);
  const patch = {};
  if (!u.displayName && profile.name) patch.displayName = profile.name;
  if (!u.photoURL && profile.photo) patch.photoURL = profile.photo;
  if (Object.keys(patch).length) await auth.updateUser(uid, patch);
  const claims = Object.assign({}, u.customClaims || {});
  if (claims.li !== true) { claims.li = true; await auth.setCustomUserClaims(uid, claims); }
}

/* The HTTP handler. `cfg`: { clientId, clientSecret, allowedOrigins[], redirectUris[] } */
async function handle(req, res, deps, cfg) {
  const origin = req.get ? req.get('origin') : (req.headers && req.headers.origin);
  const originOk = !!origin && cfg.allowedOrigins.indexOf(origin) !== -1;
  if (originOk) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(originOk ? 204 : 403).send('');
  }
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed');
    if (!originOk) throw new HttpError(403, 'origin-not-allowed');
    if (!cfg.clientId || !cfg.clientSecret) throw new HttpError(500, 'not-configured');
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const code = body.code, redirectUri = body.redirectUri;
    if (typeof code !== 'string' || !code || code.length > 2000) throw new HttpError(400, 'bad-request');
    if (cfg.redirectUris.indexOf(redirectUri) === -1) throw new HttpError(400, 'redirect-not-allowed');

    let linkToUid = null;
    const authz = (req.get ? req.get('authorization') : (req.headers && req.headers.authorization)) || '';
    if (/^Bearer\s+\S+/.test(authz)) {
      let t;
      try { t = await deps.auth.verifyIdToken(authz.replace(/^Bearer\s+/, '')); }
      catch (e) { throw new HttpError(401, 'bad-id-token'); }
      // Linking needs an account whose e-mail is PROVEN. Otherwise someone could
      // register a password account with another person's (e.g. an admin's)
      // address, never verify it, link their own LinkedIn, and keep a way in
      // after the real owner reclaims the address (same uid, now verified).
      // An account with no e-mail at all cannot be reclaimed that way.
      if (t.email && t.email_verified !== true) throw new HttpError(403, 'link-needs-verified-email');
      linkToUid = t.uid;
    }

    const profile = cleanProfile(await fetchProfile({ fetch: deps.fetch, clientId: cfg.clientId, clientSecret: cfg.clientSecret, code, redirectUri }));
    const who = await resolveUser({ auth: deps.auth, db: deps.db, now: deps.now, profile, linkToUid });
    await touchUser({ auth: deps.auth, uid: who.uid, profile });
    const token = await deps.auth.createCustomToken(who.uid, { li: true });
    return res.status(200).json({ token, isNew: who.isNew, linked: !!linkToUid });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError) && deps.log) deps.log(e);
    return res.status(status).json({ error: e instanceof HttpError ? e.code : 'internal' });
  }
}

/* When a sign-in account is deleted (by its owner from the site, or by an admin
   in the Firebase console), remove everything stored about it: the
   application, the directory card and any LinkedIn link. The site already
   deletes the first two itself; this also covers console deletions and the
   LinkedIn link, which no browser may touch. */
async function cleanupUser({ db, uid }) {
  if (!uid) return 0;
  const refs = [db.collection('members').doc(uid), db.collection('directory').doc(uid)];
  const links = await db.collection(LINKS).where('uid', '==', uid).get();
  links.forEach(d => refs.push(d.ref));
  await Promise.all(refs.map(r => r.delete()));
  return refs.length;
}

module.exports = { handle, cleanupUser, fetchProfile, cleanProfile, resolveUser, touchUser, splitList, HttpError, LINKS };
