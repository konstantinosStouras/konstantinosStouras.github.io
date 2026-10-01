/* SEMFE Alumni: firestore.rules against the REAL Cloud Firestore emulator.
 *
 * Run (from this folder, after `npm install`):
 *     npm test
 * which is
 *     firebase emulators:exec --only firestore --project demo-semfe "node --test rules.test.mjs"
 * The demo- project id keeps everything offline: no real project is touched.
 * With an emulator already running on 127.0.0.1:8085 you can also run
 *     npm run test:attach
 *
 * Every payload below is the one the site's own pages write, same keys, same
 * types, same FieldValue calls through the same compat SDK:
 *   assets/js/account.js  submitApplication() (create + edit), toggleDirectory(),
 *                         directoryData()/writeDirectory(), deleteAccount()
 *   assets/js/admin.js    act(): approve / reject / pending / dues / delete,
 *                         the members collection listener (a list)
 *   assets/js/members.js  own member doc, self-listing, directory list
 * and every token shape the sign-in methods produce, including the LinkedIn
 * Cloud Function (functions/linkedin.js: a custom token with the claim li:true).
 * If one of those files changes what it writes, change the matching helper
 * here in the same change.
 *
 * Every test must pass. */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// SEMFE_RULES=/path/to/a/copy.rules runs the suite against a proposed change without touching the real file.
const RULES_FILE = process.env.SEMFE_RULES || path.join(HERE, '../../firestore.rules');
const RULES = readFileSync(RULES_FILE, 'utf8');
const PROJECT = 'demo-semfe';
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');

const FV = firebase.firestore.FieldValue;
const ST = () => FV.serverTimestamp();
const PAST = firebase.firestore.Timestamp.fromDate(new Date('2026-01-15T10:00:00Z'));
const YEAR = new Date().getFullYear();               // admin.js records dues for the current year

let env;

/* ---- who is asking ------------------------------------------------------
 * Token claims as Firebase Auth issues them. sign_in_provider is the method
 * used for THIS sign-in: 'password', 'google.com', 'facebook.com',
 * 'oidc.linkedin'. */
const tok = (provider, email, verified) => {
  const t = { firebase: { sign_in_provider: provider, identities: {} } };
  if (email !== undefined) t.email = email;
  if (verified !== undefined) t.email_verified = verified;
  return t;
};
const U = {
  alice:        { uid: 'alice',  token: tok('google.com', 'alice@gmail.com', true) },
  bob:          { uid: 'bob',    token: tok('google.com', 'bob@gmail.com', true) },
  pwUnverified: { uid: 'pwu',    token: tok('password', 'pw.new@example.com', false) },
  pwVerified:   { uid: 'pwv',    token: tok('password', 'pw.ok@example.com', true) },
  googleUnver:  { uid: 'gun',    token: tok('google.com', 'someone@company.gr', false) },
  facebook:     { uid: 'fb',     token: tok('facebook.com', 'fbuser@example.com', false) },
  // LinkedIn, config LINKEDIN.mode 'oidc': Firebase's OIDC provider; a profile sharing no e-mail has no email claim
  linkedinNoEmail: { uid: 'li',  token: tok('oidc.linkedin') },
  // LinkedIn, config LINKEDIN.mode 'function' (the default): functions/linkedin.js mints a custom token with the
  // developer claim li:true; the ID token carries the user record's email / email_verified (verified by LinkedIn)
  linkedinFn:   { uid: 'lif',    token: { ...tok('custom', 'li.member@example.com', true), li: true } },
  // ...and a LinkedIn member whose e-mail LinkedIn did not verify: the function creates the user with NO email
  linkedinFnNoEmail: { uid: 'lifn', token: { ...tok('custom'), li: true } },
  linkedinFnNoEmailUnverified: { uid: 'lifu', token: { ...tok('custom', undefined, false), li: true } },
  // the admin's own account reached through the LinkedIn function (same uid, token carries its verified address)
  adminViaLinkedinFn: { uid: 'adm', token: { ...tok('custom', 'kstouras@gmail.com', true), li: true } },
  admin:        { uid: 'adm',    token: tok('google.com', 'kstouras@gmail.com', true) },
  admin2:       { uid: 'adm2',   token: tok('google.com', 'gradsemfe@gmail.com', true) },
  adminMixedCase: { uid: 'admc', token: tok('google.com', 'Kstouras@Gmail.com', true) },
  adminUnverified: { uid: 'admx', token: tok('password', 'kstouras@gmail.com', false) },
  adminLookalike: { uid: 'adml', token: tok('google.com', 'kstouras@gmail.com.evil.example', true) },
  noEmailButVerified: { uid: 'nev', token: tok('oidc.linkedin', undefined, true) },
  anonymous:    { uid: 'anon',   token: tok('anonymous') },
};
const dbAs = who => (who ? env.authenticatedContext(who.uid, who.token) : env.unauthenticatedContext()).firestore();
const emailOf = who => who.token.email;             // admin.js: reviewedBy = me.email (the Auth user's address)

/* ---- the payloads the pages write --------------------------------------- */
// account.js readForm(): trimmed strings, parseInt years or null, booleans
function applicationForm(over = {}) {
  return {
    firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.com', phone: '6900000000',
    stage: 'graduate', direction: 'Εφαρμοσμένα Μαθηματικά', entryYear: 2008, gradYear: 2013,
    position: 'Data scientist', employer: 'ACME', city: 'Αθήνα', linkedin: 'https://www.linkedin.com/in/maria-p', note: '',
    consentNewsletter: true, consentJobs: false, consentDirectory: true,
    acceptedPrivacy: true,
    ...over,
  };
}
// account.js submitApplication() when there is no member doc yet: ref.set(d)
function newApplication(provider = 'google.com', over = {}) {
  const d = applicationForm();
  d.provider = provider.slice(0, 40);
  d.updatedAt = ST();
  d.status = 'pending';
  d.createdAt = ST();
  return Object.assign(d, over);
}
// account.js submitApplication() when the member doc exists: ref.update(d)
function editApplication(provider = 'google.com', over = {}) {
  const d = applicationForm();
  d.provider = provider.slice(0, 40);
  d.updatedAt = ST();
  return Object.assign(d, over);
}
// what a stored application looks like (seeded with rules off)
function storedMember(status = 'pending', extra = {}) {
  return { ...applicationForm(), provider: 'google.com', status, createdAt: PAST, updatedAt: PAST, ...extra };
}
const reviewed = (by = 'kstouras@gmail.com') => ({ reviewedAt: PAST, reviewedBy: by });
// account.js directoryData() (members.js writes the same object)
function directoryEntry(m = applicationForm(), over = {}) {
  return {
    name: (m.firstName + ' ' + m.lastName).trim().slice(0, 161), gradYear: m.gradYear || null,
    direction: m.direction || '', employer: m.employer || '', position: m.position || '',
    city: m.city || '', linkedin: m.linkedin || '', updatedAt: ST(),
    ...over,
  };
}
// admin.js act(): stamp = { reviewedAt: serverTimestamp(), reviewedBy: me.email }
const stamp = who => ({ reviewedAt: ST(), reviewedBy: emailOf(who) });

async function seed(docPath, data) {
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(docPath).set(data));
}
async function readRaw(docPath) {
  let out;
  await env.withSecurityRulesDisabled(async ctx => { out = (await ctx.firestore().doc(docPath).get()).data(); });
  return out;
}
const member = (db, uid) => db.collection('members').doc(uid);
const dir = (db, uid) => db.collection('directory').doc(uid);

before(async () => {
  if (process.env.SEMFE_RULES) console.log('Using rules from ' + RULES_FILE);
  firebase.firestore.setLogLevel('silent');         // permission-denied writes are the point, not noise
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: RULES, host: HOST, port: Number(PORT) },
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/* ======================================================================== */
describe('members: creating an application', () => {
  it('owner creates the exact pending application account.js sends (serverTimestamp createdAt/updatedAt)', async () => {
    await assertSucceeds(member(dbAs(U.alice), 'alice').set(newApplication('google.com')));
    const d = await readRaw('members/alice');
    assert.equal(d.status, 'pending');
    assert.ok(d.createdAt instanceof firebase.firestore.Timestamp, 'createdAt is a server Timestamp');
    assert.ok(d.updatedAt instanceof firebase.firestore.Timestamp, 'updatedAt is a server Timestamp');
    assert.equal(d.entryYear, 2008);
  });

  it('a final-year student with no graduation year (gradYear null) and optional fields empty', async () => {
    const d = newApplication('google.com', { stage: 'final-year', gradYear: null, entryYear: 2021, phone: '', direction: '',
      employer: '', position: '', city: '', linkedin: '', note: '', consentNewsletter: false, consentDirectory: false });
    await assertSucceeds(member(dbAs(U.alice), 'alice').set(d));
  });

  for (const stage of ['graduate', 'final-year', 'faculty']) {
    it(`stage '${stage}' accepted`, async () => {
      await assertSucceeds(member(dbAs(U.alice), 'alice').set(newApplication('google.com', { stage })));
    });
  }

  it('boundaries accepted: 80-char names, years 1950 and 2100, 1000-char note', async () => {
    await assertSucceeds(member(dbAs(U.alice), 'alice').set(newApplication('google.com', {
      firstName: 'Α'.repeat(80), lastName: 'Β'.repeat(80), entryYear: 1950, gradYear: 2100, note: 'x'.repeat(1000),
    })));
  });

  describe('refused', () => {
    const refused = (label, over, mutate) => it(label, async () => {
      const d = newApplication('google.com', over);
      if (mutate) mutate(d);
      await assertFails(member(dbAs(U.alice), 'alice').set(d));
    });

    refused("status 'active'", { status: 'active' });
    refused("status 'rejected'", { status: 'rejected' });
    refused('status missing', {}, d => { delete d.status; });

    const required = ['firstName', 'lastName', 'email', 'phone', 'stage', 'entryYear', 'gradYear', 'direction', 'employer',
      'position', 'city', 'linkedin', 'consentNewsletter', 'consentJobs', 'consentDirectory', 'note', 'acceptedPrivacy',
      'provider', 'createdAt', 'updatedAt'];
    for (const k of required) refused(`key '${k}' missing`, {}, d => { delete d[k]; });

    refused("unknown key 'isAdmin'", { isAdmin: true });
    refused("unknown key 'role'", { role: 'admin' });
    refused("admin key 'duesYears' at creation", { duesYears: [YEAR] });
    refused("admin key 'adminNote' at creation", { adminNote: 'approve me' });
    refused("admin key 'reviewedBy'/'reviewedAt' at creation", { reviewedAt: ST(), reviewedBy: 'kstouras@gmail.com' });

    refused('firstName empty', { firstName: '' });
    refused('firstName 81 characters', { firstName: 'Α'.repeat(81) });
    refused('firstName not a string', { firstName: 42 });
    refused('lastName empty', { lastName: '' });
    refused('lastName 81 characters', { lastName: 'Β'.repeat(81) });

    refused("stage 'student' (not one of the three)", { stage: 'student' });
    refused('stage empty', { stage: '' });

    refused('acceptedPrivacy false', { acceptedPrivacy: false });
    refused("acceptedPrivacy the string 'true'", { acceptedPrivacy: 'true' });

    refused('entryYear 1949 (below range)', { entryYear: 1949 });
    refused('gradYear 2101 (above range)', { gradYear: 2101 });
    refused("entryYear the string '2008'", { entryYear: '2008' });
    refused("gradYear the string '2013'", { gradYear: '2013' });
    refused('gradYear 2013.5 (not an integer)', { gradYear: 2013.5 });

    refused("consentNewsletter the string 'yes'", { consentNewsletter: 'yes' });
    refused('consentDirectory null', { consentDirectory: null });

    refused('email over 200 characters', { email: 'a'.repeat(190) + '@example.com' });
    refused('phone over 40 characters', { phone: '6'.repeat(41) });
    refused('direction over 60 characters', { direction: 'x'.repeat(61) });
    refused('employer over 120 characters', { employer: 'x'.repeat(121) });
    refused('position over 120 characters', { position: 'x'.repeat(121) });
    refused('city over 80 characters', { city: 'x'.repeat(81) });
    refused('linkedin over 200 characters', { linkedin: 'https://www.linkedin.com/in/' + 'x'.repeat(180) });
    refused('note over 1000 characters', { note: 'x'.repeat(1001) });
    refused('provider over 40 characters', { provider: 'x'.repeat(41) });

    refused('createdAt a client-chosen date, not serverTimestamp()', { createdAt: PAST });
    refused('updatedAt a client-chosen date, not serverTimestamp()', { updatedAt: PAST });
  });
});

/* ======================================================================== */
describe('members: sign-in provider and e-mail confirmation', () => {
  it("'password' account with email_verified false cannot apply", async () => {
    await assertFails(member(dbAs(U.pwUnverified), 'pwu').set(newApplication('password')));
  });
  it("'password' account with email_verified true can apply", async () => {
    await assertSucceeds(member(dbAs(U.pwVerified), 'pwv').set(newApplication('password')));
  });
  it("'google.com' account with email_verified false can apply (Google vouched for it)", async () => {
    await assertSucceeds(member(dbAs(U.googleUnver), 'gun').set(newApplication('google.com')));
  });
  it("'facebook.com' account (Facebook e-mails arrive unverified) can apply", async () => {
    await assertSucceeds(member(dbAs(U.facebook), 'fb').set(newApplication('facebook.com')));
  });
  it("'oidc.linkedin' account WITHOUT an email claim can apply", async () => {
    await assertSucceeds(member(dbAs(U.linkedinNoEmail), 'li').set(newApplication('oidc.linkedin')));
  });
  it("LinkedIn through the Cloud Function ('custom' token, li claim, verified e-mail) can apply", async () => {
    // account.js: providerData is empty for these accounts, so provider = 'linkedin'
    await assertSucceeds(member(dbAs(U.linkedinFn), 'lif').set(newApplication('linkedin')));
  });
  it("LinkedIn through the Cloud Function with NO e-mail can apply", async () => {
    await assertSucceeds(member(dbAs(U.linkedinFnNoEmail), 'lifn').set(newApplication('linkedin')));
  });
  it("an unverified 'password' account cannot edit an application either", async () => {
    await seed('members/pwu', storedMember('pending', { provider: 'password' }));
    await assertFails(member(dbAs(U.pwUnverified), 'pwu').update(editApplication('password', { city: 'Πάτρα' })));
  });
  it("an unverified 'password' account can still READ its own doc (account.js shows 'confirm your e-mail')", async () => {
    await seed('members/pwu', storedMember('pending', { provider: 'password' }));
    await assertSucceeds(member(dbAs(U.pwUnverified), 'pwu').get());
  });
  it("a 'password' sign-in with Facebook LINKED (e-mail unverified) can apply, as account.js offers it", async () => {
    const who = { uid: 'pwfb', token: { email: 'pw.fb@example.com', email_verified: false,
      firebase: { sign_in_provider: 'password', identities: { email: ['pw.fb@example.com'], 'facebook.com': ['1029384756'] } } } };
    await assertSucceeds(member(dbAs(who), 'pwfb').set(newApplication('password')));
  });
  it("a 'password' sign-in with NO other provider linked and e-mail unverified stays refused", async () => {
    const who = { uid: 'pwonly', token: { email: 'pw.only@example.com', email_verified: false,
      firebase: { sign_in_provider: 'password', identities: { email: ['pw.only@example.com'] } } } };
    await assertFails(member(dbAs(who), 'pwonly').set(newApplication('password')));
  });
  it('anonymous sign-in, or a custom token without the li claim, cannot apply', async () => {
    await assertFails(member(dbAs(U.anonymous), 'anon').set(newApplication('anonymous')));
    const customNoLi = { uid: 'cust', token: tok('custom', 'someone@example.com', false) };
    await assertFails(member(dbAs(customNoLi), 'cust').set(newApplication('custom')));
  });
});

/* ======================================================================== */
describe('members: reading', () => {
  it('owner reads their own application', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.alice), 'alice').get());
  });
  it('owner reads their own doc before applying (account.js listens on a missing doc)', async () => {
    await assertSucceeds(member(dbAs(U.alice), 'alice').get());
  });
  it("another member cannot read someone else's application", async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.bob), 'alice').get());
  });
  it("an ACTIVE member cannot read someone else's application", async () => {
    await seed('members/alice', storedMember());
    await seed('members/bob', storedMember('active'));
    await assertFails(member(dbAs(U.bob), 'alice').get());
  });
  it('a non-admin cannot list the members collection', async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.alice).collection('members').get());
  });
  it('a non-admin cannot list even with a query that would match only their own doc', async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.alice).collection('members').where('email', '==', 'maria@example.com').get());
  });
  it('an active non-admin member cannot list the members collection', async () => {
    await seed('members/bob', storedMember('active'));
    await assertFails(dbAs(U.bob).collection('members').get());
  });
});

/* ======================================================================== */
describe('members: the owner edits their application', () => {
  it('owner edit exactly as account.js sends it (update with every profile field + provider + updatedAt)', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.alice), 'alice').update(editApplication('google.com', { city: 'Θεσσαλονίκη', employer: 'NTUA' })));
    const d = await readRaw('members/alice');
    assert.equal(d.city, 'Θεσσαλονίκη');
    assert.equal(d.status, 'pending');
  });
  it('an ACTIVE, reviewed member with dues and an admin note edits their profile', async () => {
    await seed('members/alice', storedMember('active', { duesYears: [YEAR - 1, YEAR], adminNote: 'πλήρωσε με IRIS', ...reviewed() }));
    await assertSucceeds(member(dbAs(U.alice), 'alice').update(editApplication('google.com', { position: 'CTO' })));
    const d = await readRaw('members/alice');
    assert.equal(d.status, 'active');
    assert.deepEqual(d.duesYears, [YEAR - 1, YEAR]);
  });
  it('owner edit after linking another provider changes the provider field', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.alice), 'alice').update(editApplication('facebook.com')));
  });
  it('the directory toggle writes { consentDirectory, updatedAt } (account.js toggleDirectory)', async () => {
    await seed('members/alice', storedMember('active'));
    await assertSucceeds(member(dbAs(U.alice), 'alice').update({ consentDirectory: false, updatedAt: ST() }));
  });

  describe('refused', () => {
    const refusedEdit = (label, seedData, change) => it(label, async () => {
      await seed('members/alice', seedData);
      await assertFails(member(dbAs(U.alice), 'alice').update(change));
    });
    refusedEdit("owner cannot set status 'active'", storedMember(), { ...editApplication(), status: 'active' });
    refusedEdit("owner cannot flip status alone", storedMember(), { status: 'active', updatedAt: ST() });
    refusedEdit("a rejected owner cannot reset status to 'pending'", storedMember('rejected', reviewed()), { status: 'pending', updatedAt: ST() });
    refusedEdit('owner cannot add duesYears', storedMember('active'), { duesYears: FV.arrayUnion(YEAR), updatedAt: ST() });
    refusedEdit('owner cannot change existing duesYears', storedMember('active', { duesYears: [YEAR - 1] }), { duesYears: [YEAR - 1, YEAR], updatedAt: ST() });
    refusedEdit('owner cannot remove duesYears', storedMember('active', { duesYears: [YEAR] }), { duesYears: FV.delete(), updatedAt: ST() });
    refusedEdit('owner cannot set adminNote', storedMember(), { adminNote: 'ok', updatedAt: ST() });
    refusedEdit('owner cannot set reviewedAt', storedMember(), { reviewedAt: ST(), updatedAt: ST() });
    refusedEdit('owner cannot set reviewedBy', storedMember(), { reviewedBy: 'kstouras@gmail.com', updatedAt: ST() });
    refusedEdit('owner cannot change createdAt', storedMember(), { createdAt: ST(), updatedAt: ST() });
    refusedEdit('owner cannot delete createdAt', storedMember(), { createdAt: FV.delete(), updatedAt: ST() });
    refusedEdit('owner cannot delete status', storedMember(), { status: FV.delete(), updatedAt: ST() });
    refusedEdit('owner edit without a fresh updatedAt', storedMember(), { city: 'Πάτρα' });
    refusedEdit('owner edit with a client-chosen updatedAt', storedMember(), { city: 'Πάτρα', updatedAt: PAST });
    refusedEdit('owner edit that empties firstName', storedMember(), editApplication('google.com', { firstName: '' }));
    refusedEdit('owner edit with an invalid stage', storedMember(), editApplication('google.com', { stage: 'honorary' }));
    refusedEdit('owner edit with a string year', storedMember(), editApplication('google.com', { gradYear: '2013' }));
    refusedEdit('owner edit that withdraws acceptedPrivacy', storedMember(), editApplication('google.com', { acceptedPrivacy: false }));
    refusedEdit('owner edit that removes a profile key', storedMember(), { phone: FV.delete(), updatedAt: ST() });
    refusedEdit('owner edit adding an unknown key', storedMember(), editApplication('google.com', { isAdmin: true }));

    it('owner set() over an existing doc cannot reset createdAt', async () => {
      await seed('members/alice', storedMember());
      await assertFails(member(dbAs(U.alice), 'alice').set(newApplication()));
    });
  });

  it('owner deletes their own application (account.js deleteAccount)', async () => {
    await seed('members/alice', storedMember('active', { duesYears: [YEAR] }));
    await assertSucceeds(member(dbAs(U.alice), 'alice').delete());
  });
});

/* ======================================================================== */
describe("members: other users' documents", () => {
  it("cannot create someone else's application", async () => {
    await assertFails(member(dbAs(U.bob), 'alice').set(newApplication()));
  });
  it("cannot update someone else's application", async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.bob), 'alice').update(editApplication('google.com', { city: 'X' })));
  });
  it("cannot delete someone else's application", async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.bob), 'alice').delete());
  });
  it("an ACTIVE member cannot approve someone else (admin-shaped update)", async () => {
    await seed('members/alice', storedMember());
    await seed('members/bob', storedMember('active'));
    await assertFails(member(dbAs(U.bob), 'alice').update({ status: 'active', ...stamp(U.bob) }));
  });
});

/* ======================================================================== */
describe('members: the admin reviews applications', () => {
  it('admin lists every application (admin.js collection listener)', async () => {
    await seed('members/alice', storedMember());
    await seed('members/bob', storedMember('active'));
    const qs = await assertSucceeds(dbAs(U.admin).collection('members').get());
    assert.equal(qs.size, 2);
  });
  it("admin reads any single application", async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.admin), 'alice').get());
  });
  it('the second admin (gradsemfe@gmail.com) lists too', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(dbAs(U.admin2).collection('members').get());
  });
  it('admin approves: status active + reviewedAt serverTimestamp + reviewedBy own e-mail', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.admin), 'alice').update({ status: 'active', ...stamp(U.admin) }));
    const d = await readRaw('members/alice');
    assert.equal(d.status, 'active');
    assert.equal(d.reviewedBy, 'kstouras@gmail.com');
    assert.ok(d.reviewedAt instanceof firebase.firestore.Timestamp);
  });
  it("admin rejects, then puts back to 'pending' (and deletes the directory entry, as admin.js does)", async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
    const db = dbAs(U.admin);
    await assertSucceeds(member(db, 'alice').update({ status: 'rejected', ...stamp(U.admin) }));
    await assertSucceeds(dir(db, 'alice').delete());
    await assertSucceeds(member(db, 'alice').update({ status: 'pending', ...stamp(U.admin) }));
  });
  it('admin records this year\'s dues with arrayUnion, then removes them with arrayRemove', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    const db = dbAs(U.admin);
    await assertSucceeds(member(db, 'alice').update({ duesYears: FV.arrayUnion(YEAR), ...stamp(U.admin) }));
    assert.deepEqual((await readRaw('members/alice')).duesYears, [YEAR]);
    await assertSucceeds(member(db, 'alice').update({ duesYears: FV.arrayRemove(YEAR), ...stamp(U.admin) }));
    assert.deepEqual((await readRaw('members/alice')).duesYears, []);
  });
  it('admin records dues for a still-pending applicant (the button is shown for every row)', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.admin), 'alice').update({ duesYears: FV.arrayUnion(YEAR), ...stamp(U.admin) }));
  });
  it('admin writes an adminNote of 500 characters', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.admin), 'alice').update({ adminNote: 'x'.repeat(500), ...stamp(U.admin) }));
  });
  it('admin deletes an application and its directory entry (admin.js delete)', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
    const db = dbAs(U.admin);
    await assertSucceeds(dir(db, 'alice').delete());
    await assertSucceeds(member(db, 'alice').delete());
  });
  it('admin edits their OWN application through the owner path', async () => {
    await seed('members/adm', storedMember('active', reviewed()));
    await assertSucceeds(member(dbAs(U.admin), 'adm').update(editApplication('google.com', { city: 'Δουβλίνο' })));
  });

  describe('refused', () => {
    const refusedAdmin = (label, who, seedData, change) => it(label, async () => {
      await seed('members/alice', seedData);
      await assertFails(member(dbAs(who), 'alice').update(change));
    });
    refusedAdmin('admin cannot change a profile field (firstName) while approving', U.admin, storedMember(),
      { status: 'active', firstName: 'Άλλο', ...stamp(U.admin) });
    refusedAdmin('admin cannot change a profile field (email) on its own', U.admin, storedMember(),
      { email: 'other@example.com', ...stamp(U.admin) });
    refusedAdmin('admin cannot change createdAt', U.admin, storedMember(), { createdAt: ST(), ...stamp(U.admin) });
    refusedAdmin('admin cannot approve with reviewedBy spoofed as the other admin', U.admin, storedMember(),
      { status: 'active', reviewedAt: ST(), reviewedBy: 'gradsemfe@gmail.com' });
    refusedAdmin('admin cannot approve with reviewedBy an arbitrary address', U.admin, storedMember(),
      { status: 'active', reviewedAt: ST(), reviewedBy: 'nobody@example.com' });
    refusedAdmin('admin cannot approve without the review stamp', U.admin, storedMember(), { status: 'active' });
    refusedAdmin('admin cannot back-date reviewedAt', U.admin, storedMember(),
      { status: 'active', reviewedAt: PAST, reviewedBy: 'kstouras@gmail.com' });
    refusedAdmin("admin cannot set an unknown status 'banned'", U.admin, storedMember(), { status: 'banned', ...stamp(U.admin) });
    refusedAdmin('admin cannot remove the status field', U.admin, storedMember(), { status: FV.delete(), ...stamp(U.admin) });
    refusedAdmin('admin cannot store duesYears as a non-list', U.admin, storedMember(), { duesYears: YEAR, ...stamp(U.admin) });
    refusedAdmin('admin cannot store more than 100 duesYears', U.admin, storedMember(),
      { duesYears: Array.from({ length: 101 }, (_, i) => 1950 + i), ...stamp(U.admin) });
    refusedAdmin('admin cannot add two years in one write', U.admin, storedMember('active', reviewed()),
      { duesYears: FV.arrayUnion(YEAR - 1, YEAR), ...stamp(U.admin) });
    refusedAdmin('admin cannot add a string to duesYears', U.admin, storedMember('active', reviewed()),
      { duesYears: FV.arrayUnion('<img src=x onerror=alert(1)>'), ...stamp(U.admin) });
    refusedAdmin('admin cannot add a year outside 1950-2100', U.admin, storedMember('active', reviewed()),
      { duesYears: FV.arrayUnion(3000), ...stamp(U.admin) });
    refusedAdmin('admin cannot replace the list with a string element beside real years', U.admin, storedMember('active', { duesYears: [YEAR - 1], ...reviewed() }),
      { duesYears: [YEAR - 1, 'x'], ...stamp(U.admin) });
    refusedAdmin('admin cannot write a 501-character adminNote', U.admin, storedMember(), { adminNote: 'x'.repeat(501), ...stamp(U.admin) });
    refusedAdmin('admin cannot add an unknown key', U.admin, storedMember(), { flagged: true, ...stamp(U.admin) });
  });
});

/* ======================================================================== */
describe('members: who counts as an admin', () => {
  it('admin e-mail with email_verified FALSE is not an admin: cannot list', async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.adminUnverified).collection('members').get());
  });
  it('admin e-mail with email_verified FALSE is not an admin: cannot read another doc', async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.adminUnverified), 'alice').get());
  });
  it('admin e-mail with email_verified FALSE is not an admin: cannot approve', async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.adminUnverified), 'alice').update({ status: 'active', ...stamp(U.adminUnverified) }));
  });
  it('admin e-mail with email_verified FALSE is not an admin: cannot delete', async () => {
    await seed('members/alice', storedMember());
    await assertFails(member(dbAs(U.adminUnverified), 'alice').delete());
  });
  it('mixed-case token e-mail (Kstouras@Gmail.com) is still the admin: lists', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(dbAs(U.adminMixedCase).collection('members').get());
  });
  it('mixed-case admin approves with reviewedBy = its token e-mail (what admin.js sends as me.email)', async () => {
    await seed('members/alice', storedMember());
    await assertSucceeds(member(dbAs(U.adminMixedCase), 'alice').update({ status: 'active', ...stamp(U.adminMixedCase) }));
  });
  it('look-alike address (kstouras@gmail.com.evil.example) is not an admin', async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.adminLookalike).collection('members').get());
  });
  it('a token with email_verified true but NO email claim is not an admin', async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.noEmailButVerified).collection('members').get());
  });
  it("a LinkedIn-function member with a verified NON-admin address is not an admin", async () => {
    await seed('members/alice', storedMember());
    await assertFails(dbAs(U.linkedinFn).collection('members').get());
  });
  it("the admin's own account reached through the LinkedIn function stays the admin (same uid, verified address)", async () => {
    await seed('members/alice', storedMember());
    const db = dbAs(U.adminViaLinkedinFn);
    await assertSucceeds(db.collection('members').get());
    await assertSucceeds(member(db, 'alice').update({ status: 'active', ...stamp(U.adminViaLinkedinFn) }));
  });
});

/* ======================================================================== */
const NO_EMAIL = [
  ['LinkedIn OIDC route, no email claim', U.linkedinNoEmail, 'oidc.linkedin'],
  ['LinkedIn Cloud Function route (custom token + li), no email claim', U.linkedinFnNoEmail, 'linkedin'],
  ['LinkedIn Cloud Function route, email_verified:false and no email', U.linkedinFnNoEmailUnverified, 'linkedin'],
];
for (const [label, LI, provider] of NO_EMAIL) {
  describe(`a token WITHOUT an email claim: ${label}`, () => {
    const me = LI.uid;
    it('creates, reads, edits and deletes its own application', async () => {
      const db = dbAs(LI);
      await assertSucceeds(member(db, me).set(newApplication(provider, { email: 'typed.by.hand@example.com' })));
      await assertSucceeds(member(db, me).get());
      await assertSucceeds(member(db, me).update(editApplication(provider, { email: 'typed.by.hand@example.com', city: 'Βόλος' })));
      await assertSucceeds(member(db, me).update({ consentDirectory: false, updatedAt: ST() }));
      await assertSucceeds(member(db, me).delete());
    });
    it('still cannot change its own status', async () => {
      await seed(`members/${me}`, storedMember('pending', { provider }));
      await assertFails(member(dbAs(LI), me).update({ status: 'active', updatedAt: ST() }));
    });
    it('cannot list the members collection', async () => {
      await seed('members/alice', storedMember());
      await assertFails(dbAs(LI).collection('members').get());
    });
    it("cannot read someone else's application", async () => {
      await seed('members/alice', storedMember());
      await assertFails(member(dbAs(LI), 'alice').get());
    });
    it("cannot approve someone else's application", async () => {
      await seed('members/alice', storedMember());
      await assertFails(member(dbAs(LI), 'alice').update({ status: 'active', reviewedAt: ST(), reviewedBy: '' }));
    });
    it("cannot delete someone else's application or directory entry", async () => {
      await seed('members/alice', storedMember('active'));
      await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
      await assertFails(member(dbAs(LI), 'alice').delete());
      await assertFails(dir(dbAs(LI), 'alice').delete());
    });
    it('while pending, cannot read the directory', async () => {
      await seed(`members/${me}`, storedMember('pending', { provider }));
      await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
      await assertFails(dbAs(LI).collection('directory').get());
    });
    it('once active, reads the directory and lists itself', async () => {
      await seed(`members/${me}`, storedMember('active', { provider, ...reviewed() }));
      const db = dbAs(LI);
      await assertSucceeds(dir(db, me).set(directoryEntry()));
      await assertSucceeds(db.collection('directory').get());
    });
  });
}

/* ======================================================================== */
describe('directory', () => {
  it('a pending member cannot create their own entry', async () => {
    await seed('members/alice', storedMember('pending'));
    await assertFails(dir(dbAs(U.alice), 'alice').set(directoryEntry()));
  });
  it('a rejected member cannot create their own entry', async () => {
    await seed('members/alice', storedMember('rejected', reviewed()));
    await assertFails(dir(dbAs(U.alice), 'alice').set(directoryEntry()));
  });
  it('a signed-in user with no application cannot create an entry', async () => {
    await assertFails(dir(dbAs(U.alice), 'alice').set(directoryEntry()));
  });
  it('an active member creates, updates and deletes their own entry (account.js writeDirectory / toggle)', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    const db = dbAs(U.alice);
    await assertSucceeds(dir(db, 'alice').set(directoryEntry()));
    await assertSucceeds(dir(db, 'alice').set(directoryEntry(applicationForm({ employer: 'ΕΜΠ', position: 'Καθηγήτρια' }))));
    await assertSucceeds(dir(db, 'alice').update({ city: 'Ηράκλειο', updatedAt: ST() }));
    await assertSucceeds(dir(db, 'alice').delete());
  });
  it('an active member with no gradYear lists with gradYear null (m.gradYear || null)', async () => {
    await seed('members/alice', storedMember('active', { gradYear: null, stage: 'final-year' }));
    await assertSucceeds(dir(dbAs(U.alice), 'alice').set(directoryEntry(applicationForm({ gradYear: null }))));
  });
  it('the full toggle ON flow: directory set, then consentDirectory on the application', async () => {
    await seed('members/alice', storedMember('active', { consentDirectory: false, ...reviewed() }));
    const db = dbAs(U.alice);
    await assertSucceeds(dir(db, 'alice').set(directoryEntry()));
    await assertSucceeds(member(db, 'alice').update({ consentDirectory: true, updatedAt: ST() }));
  });
  it('edit then refresh: an active member saves other details, then the entry is rewritten (account.js)', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
    const db = dbAs(U.alice);
    const edited = applicationForm({ employer: 'ΕΜΠ', city: 'Βόλος' });
    await assertSucceeds(member(db, 'alice').update(editApplication('google.com', edited)));
    await assertSucceeds(dir(db, 'alice').set(directoryEntry(edited)));
  });
  it('an ACTIVE member cannot rename themselves (the vetted name is frozen once reviewed)', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await assertFails(member(dbAs(U.alice), 'alice').update(editApplication('google.com', applicationForm({ lastName: 'Άλλο' }))));
    await assertFails(member(dbAs(U.alice), 'alice').update(editApplication('google.com', applicationForm({ firstName: 'Πρόεδρος' }))));
  });
  it('a REJECTED applicant cannot rename either; a PENDING applicant can still fix their name', async () => {
    await seed('members/alice', storedMember('rejected', reviewed()));
    await assertFails(member(dbAs(U.alice), 'alice').update(editApplication('google.com', applicationForm({ lastName: 'Άλλο' }))));
    await seed('members/alice', storedMember('pending'));
    await assertSucceeds(member(dbAs(U.alice), 'alice').update(editApplication('google.com', applicationForm({ lastName: 'Παπαδοπούλου-Νικολάου' }))));
  });
  it('rename-then-list is closed: the directory name must equal the application name', async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await assertFails(dir(dbAs(U.alice), 'alice').set(directoryEntry(applicationForm({ firstName: 'Πρόεδρος', lastName: 'ΔΣ' }))));
  });
  it("an active member cannot write another uid's entry", async () => {
    await seed('members/alice', storedMember('active'));
    await seed('members/bob', storedMember('active'));
    await assertFails(dir(dbAs(U.alice), 'bob').set(directoryEntry()));
  });
  it("an active member cannot update or delete another uid's entry", async () => {
    await seed('members/alice', storedMember('active'));
    await seed('members/bob', storedMember('active'));
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    const db = dbAs(U.alice);
    await assertFails(dir(db, 'bob').update({ city: 'X', updatedAt: ST() }));
    await assertFails(dir(db, 'bob').delete());
  });
  it("the admin cannot write a directory entry for someone else", async () => {
    await seed('members/alice', storedMember('active'));
    await assertFails(dir(dbAs(U.admin), 'alice').set(directoryEntry()));
  });

  it('a pending member cannot list the directory', async () => {
    await seed('members/alice', storedMember('pending'));
    await seed('members/bob', storedMember('active'));
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    await assertFails(dbAs(U.alice).collection('directory').get());
  });
  it('a pending member cannot get a single directory entry', async () => {
    await seed('members/alice', storedMember('pending'));
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    await assertFails(dir(dbAs(U.alice), 'bob').get());
  });
  it('a signed-in user with no application cannot list the directory', async () => {
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    await assertFails(dbAs(U.alice).collection('directory').get());
  });
  it('an active member lists the directory and reads an entry (members.js)', async () => {
    await seed('members/alice', storedMember('active'));
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    const db = dbAs(U.alice);
    const qs = await assertSucceeds(db.collection('directory').get());
    assert.equal(qs.size, 1);
    await assertSucceeds(dir(db, 'bob').get());
    await assertSucceeds(dir(db, 'alice').get());          // members.js checks its own (missing) entry
  });
  it('the admin (with no application of their own) lists the directory', async () => {
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    await assertSucceeds(dbAs(U.admin).collection('directory').get());
  });
  it('an unverified admin address cannot list the directory', async () => {
    await seed('directory/bob', { ...directoryEntry(), updatedAt: PAST });
    await assertFails(dbAs(U.adminUnverified).collection('directory').get());
  });

  describe('refused payloads (active member, own uid)', () => {
    const refusedDir = (label, data) => it(label, async () => {
      await seed('members/alice', storedMember('active'));
      await assertFails(dir(dbAs(U.alice), 'alice').set(data));
    });
    refusedDir("extra key 'email'", directoryEntry(undefined, { email: 'maria@example.com' }));
    refusedDir("extra key 'phone'", directoryEntry(undefined, { phone: '6900000000' }));
    refusedDir("extra key 'status'", directoryEntry(undefined, { status: 'active' }));
    refusedDir("key 'city' missing", (() => { const d = directoryEntry(); delete d.city; return d; })());
    refusedDir("key 'updatedAt' missing", (() => { const d = directoryEntry(); delete d.updatedAt; return d; })());
    refusedDir('empty name', directoryEntry(undefined, { name: '' }));
    refusedDir('name over 161 characters', directoryEntry(undefined, { name: 'x'.repeat(162) }));
    refusedDir("gradYear the string '2013'", directoryEntry(undefined, { gradYear: '2013' }));
    refusedDir('gradYear 2101', directoryEntry(undefined, { gradYear: 2101 }));
    refusedDir('employer over 120 characters', directoryEntry(undefined, { employer: 'x'.repeat(121) }));
    refusedDir('linkedin over 200 characters', directoryEntry(undefined, { linkedin: 'x'.repeat(201) }));
    refusedDir('updatedAt a client-chosen date', directoryEntry(undefined, { updatedAt: PAST }));
  });

  it('an active member cannot list under a different name than their application', async () => {
    await seed('members/alice', storedMember('active'));
    await assertFails(dir(dbAs(U.alice), 'alice').set(directoryEntry(undefined, { name: 'Κωνσταντίνος Στουρας (Πρόεδρος)' })));
  });
});

/* ======================================================================== */
describe('unauthenticated: denied everywhere', () => {
  beforeEach(async () => {
    await seed('members/alice', storedMember('active', reviewed()));
    await seed('directory/alice', { ...directoryEntry(), updatedAt: PAST });
  });
  it('members: get', async () => { await assertFails(member(dbAs(null), 'alice').get()); });
  it('members: get of a missing doc', async () => { await assertFails(member(dbAs(null), 'nobody').get()); });
  it('members: list', async () => { await assertFails(dbAs(null).collection('members').get()); });
  it('members: create', async () => { await assertFails(member(dbAs(null), 'nobody').set(newApplication())); });
  it('members: update', async () => { await assertFails(member(dbAs(null), 'alice').update({ status: 'rejected' })); });
  it('members: delete', async () => { await assertFails(member(dbAs(null), 'alice').delete()); });
  it('directory: get', async () => { await assertFails(dir(dbAs(null), 'alice').get()); });
  it('directory: list', async () => { await assertFails(dbAs(null).collection('directory').get()); });
  it('directory: create', async () => { await assertFails(dir(dbAs(null), 'nobody').set(directoryEntry())); });
  it('directory: update', async () => { await assertFails(dir(dbAs(null), 'alice').update({ city: 'X', updatedAt: ST() })); });
  it('directory: delete', async () => { await assertFails(dir(dbAs(null), 'alice').delete()); });
  it('any other collection: read and write', async () => {
    await assertFails(dbAs(null).collection('settings').doc('x').get());
    await assertFails(dbAs(null).collection('settings').doc('x').set({ a: 1 }));
  });
});

describe('everything else is denied, even to the admin', () => {
  it('admin cannot read or write an unlisted collection', async () => {
    const db = dbAs(U.admin);
    await assertFails(db.collection('settings').doc('site').get());
    await assertFails(db.collection('settings').doc('site').set({ open: true }));
  });
  // functions/linkedin.js keeps linkedinLinks/{LinkedIn sub} = { uid } through the Admin SDK. If a browser could
  // write it, anyone could point their LinkedIn identity at someone else's uid and be signed in as them.
  it('nobody can write the LinkedIn mapping (linkedinLinks), not even the admin', async () => {
    for (const who of [U.alice, U.linkedinFn, U.admin]) {
      await assertFails(dbAs(who).collection('linkedinLinks').doc('li-sub-123').set({ uid: 'adm', updatedAt: ST() }));
    }
  });
  it('nobody can read the LinkedIn mapping (linkedinLinks)', async () => {
    await seed('linkedinLinks/li-sub-123', { uid: 'alice', updatedAt: PAST });
    for (const who of [U.alice, U.linkedinFn, U.admin]) {
      await assertFails(dbAs(who).collection('linkedinLinks').doc('li-sub-123').get());
      await assertFails(dbAs(who).collection('linkedinLinks').get());
    }
  });
  it('an active member cannot read or write an unlisted collection', async () => {
    await seed('members/alice', storedMember('active'));
    const db = dbAs(U.alice);
    await assertFails(db.collection('messages').doc('m1').set({ text: 'hi' }));
    await assertFails(db.collection('messages').get());
  });
});
