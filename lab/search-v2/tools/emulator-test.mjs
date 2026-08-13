/* ==========================================================================
   search-v2  ·  tools/emulator-test.mjs
   The Cloud Functions and the Security Rules, against the REAL Firebase
   emulator (Firestore + Functions + Auth).

       node lab/search-v2/tools/emulator-test.mjs

   Needs Java and firebase-tools:  npm i -g firebase-tools
   Skips cleanly, with a message, when either is missing.

   What it pins — the three properties design brief §17.2 asks for, plus the
   Rules of §17.4 that make server mode worth having:

     · the mapping NEVER reaches the client: the run document is unreadable to a
       participant in server mode, the server's per-round state is unreadable to
       anyone but the admin, and the callables return one number at a time;
     · the RESPONSE IS IDENTICAL whether or not the queried position was one of
       the AI's private anchors — same keys, same payload size, and a wall-clock
       time that does not separate the two;
     · every call is IDEMPOTENT on its actionId, so a retry after a dropped
       connection does not charge twice;
     · `nominate` computes the score, and a client cannot set its own;
     · the answers the server gives match, exactly, what the offline engine says
       they should be — the same pool, the same anchors, the same interpolation.
   ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'search-v2-emulator';
const PORTS = { firestore: 8080, functions: 5001, auth: 9099 };

function have(cmd, args) {
  try { return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0; } catch { return false; }
}
if (!have('java', ['-version'])) {
  console.log('SKIPPED — Java is not installed, so the Firestore emulator cannot run.');
  process.exit(0);
}
if (!have('firebase', ['--version'])) {
  console.log('SKIPPED — firebase-tools is not installed (npm i -g firebase-tools).');
  process.exit(0);
}

// The engine copies the Functions import must match the originals, or the server
// would compute against a different pool from the one the exporter joins on.
const sync = spawnSync('node', [resolve(APP, 'tools/sync-engine.mjs'), '--check'], { encoding: 'utf8' });
if (sync.status !== 0) {
  console.error(sync.stderr || sync.stdout);
  process.exit(1);
}

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};

// ── start the emulators ────────────────────────────────────────────────────
console.log('starting the Firebase emulators…');
const em = spawn('firebase', [
  'emulators:start',
  '--only', 'firestore,functions,auth',
  '--project', PROJECT
], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });

let emLog = '';
em.stdout.on('data', d => { emLog += d; });
em.stderr.on('data', d => { emLog += d; });

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
// An open PORT is not readiness: the Functions emulator accepts connections
// before it has loaded the function definitions, and a call that lands in that
// window comes back as a non-JSON 404 — which is how the first run of this test
// reported every callable as an empty failure. So probe until a CALLABLE answers
// in JSON (unauthenticated is a perfectly good answer).
async function functionsReady(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTS.functions}/${PROJECT}/us-central1/claimCode`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}'
      });
      const t = await r.text();
      if (t.trim().charAt(0) === '{') return true;
    } catch {}
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}
const up = await waitFor(`http://127.0.0.1:${PORTS.firestore}/`, 90000) &&
           await waitFor(`http://127.0.0.1:${PORTS.auth}/`, 60000) &&
           await functionsReady(120000);
if (!up) {
  console.error('the emulators did not come up in time:\n' + emLog.slice(-3000));
  em.kill('SIGTERM');
  process.exit(1);
}
console.log('emulators up, functions loaded.\n');

// The Admin SDK talks to the emulator through these.
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

let admin, db;
try {
  admin = require(resolve(APP, '_functions/functions/node_modules/firebase-admin'));
} catch {
  try { admin = require('firebase-admin'); } catch {}
}

const Pool = require(resolve(APP, 'pool.js'));
const Specs = require(resolve(APP, 'specs.js'));
const Ai = require(resolve(APP, 'ai.js'));

async function main() {
  if (!admin) throw new Error('firebase-admin is not installed under _functions/functions');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();

  // ── two real emulator users, so the calls carry genuine ID tokens ────────
  async function newUser() {
    const r = await fetch(
      `http://127.0.0.1:${PORTS.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    const j = await r.json();
    if (!j.idToken) throw new Error('auth emulator signUp failed: ' + JSON.stringify(j).slice(0, 200));
    return { token: j.idToken, uid: j.localId };
  }
  const u1 = await newUser(), u2 = await newUser();
  ok(!!u1.token && !!u2.token, 'two participants sign in against the Auth emulator');

  // ── seed a run, through the Admin SDK (which bypasses the Rules) ─────────
  const params = Specs.withDefaults(null);
  params.ops.compute = 'server';
  params.ops.rosterMode = 'open';
  const pool = Pool.buildPool(params.env, params.env.generatorSeed);
  const specs = Specs.buildSpecs(pool, params, params.env.generatorSeed + 1);
  const runId = 'RUNEMU';

  await db.collection('runs').doc(runId).set({
    name: 'emulator run', code: 'EMU', status: 'open', locked: false, serverMode: true,
    params: params, ops: params.ops, assign: params.assign,
    specSeed: params.env.generatorSeed + 1, specsJson: JSON.stringify(specs)
  });
  await db.collection('runCodes').doc('EMU').set({ id: runId });
  const seeded = await db.collection('runs').doc(runId).get();
  ok(seeded.exists && seeded.data().serverMode === true,
    'a server-mode run is seeded and readable by the Admin SDK the Functions use');

  // ── call the Functions exactly as the client does ───────────────────────
  const fnBase = `http://127.0.0.1:${PORTS.functions}/${PROJECT}/us-central1`;
  async function call(name, data, user) {
    const r = await fetch(`${fnBase}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user.token },
      body: JSON.stringify({ data: Object.assign({ runId: runId }, data) })
    });
    const text = await r.text();
    let j = {};
    try { j = JSON.parse(text); } catch { j = { error: { message: 'non-JSON ' + r.status + ': ' + text.slice(0, 160) } }; }
    return { status: r.status, result: j.result, error: j.error };
  }

  console.log('\n── the callables ──');
  const claimed = await call('claimCode', { code: 'STU001' }, u1);
  ok(claimed.result && claimed.result.ok, 'claimCode enrols a class-platform student ID',
    JSON.stringify(claimed.error || '').slice(0, 300));
  const sequence = claimed.result && claimed.result.sequence;
  ok(sequence === 'A' || sequence === 'B', 'and assigns a crossover sequence (' + sequence + ')');

  const lockedSnap = await db.collection('runs').doc(runId).get();
  ok(lockedSnap.data().locked === true,
    'the first claimed code LOCKS the run — from here the Rules refuse every parameter write');

  const started = await call('startRound', { code: 'STU001', roundIndex: 1 }, u1);
  const d = started.result;
  ok(!!d, 'startRound returns a round descriptor', JSON.stringify(started.error || '').slice(0, 300));
  if (d) {
    const blob = JSON.stringify(d);
    ok(!('mapping' in d) && !('truth' in d) && !('ai_anchors' in d) && !('anchors' in d),
      'and it contains NO mapping and NO anchors — the whole point of server mode',
      Object.keys(d).join(', '));
    ok(blob.length < 2000, `and it is small (${blob.length} bytes) — a mapping would not fit`);
    ok(Array.isArray(d.pre_opened), 'it carries the pre-opened positions with their values');
    ok(typeof d.ai_k === 'number', 'and how many positions the AI knows this round');
  }

  // The plan the server used, recomputed offline: the answers must match exactly.
  const plan = Specs.sessionPlan(specs, 'STU001', sequence, params);
  const r1 = plan.rounds[0];
  const map = pool[r1.spec.mapping_index];
  const anchorsNow = Ai.anchorSet(r1.spec.ai_anchors, r1.spec.pre_opened, [], map);

  const POS_ANCHOR = r1.spec.ai_anchors[0];
  let POS_GAP = null;
  for (let p = r1.spec.ai_anchors[0] + 1; p < r1.spec.ai_anchors[1]; p++) {
    if (r1.spec.ai_anchors.indexOf(p) < 0 && r1.spec.pre_opened.indexOf(p) < 0) { POS_GAP = p; break; }
  }

  // The check that matters most (§17.2, property 1) needs an AI round, so run it
  // against the first one this participant actually gets — not round 1, which is
  // AI-off under sequence A and would silently skip the whole thing.
  let aiIdx = -1;
  for (let i = 0; i < plan.rounds.length; i++) {
    if (plan.rounds[i].condition === 'AI_ON') { aiIdx = i; break; }
  }
  ok(aiIdx >= 0, `the participant has an AI block (first AI round is ${aiIdx + 1})`);
  const rAI = plan.rounds[aiIdx];
  const mapAI = pool[rAI.spec.mapping_index];
  const anchorsAI = Ai.anchorSet(rAI.spec.ai_anchors, rAI.spec.pre_opened, [], mapAI);
  const A_POS = rAI.spec.ai_anchors[0];
  let G_POS = null;
  for (let p = rAI.spec.ai_anchors[0] + 1; p < rAI.spec.ai_anchors[1]; p++) {
    if (rAI.spec.ai_anchors.indexOf(p) < 0 && rAI.spec.pre_opened.indexOf(p) < 0) { G_POS = p; break; }
  }
  await call('startRound', { code: 'STU001', roundIndex: aiIdx + 1 }, u1);

  {
    // Alternate the two so a warm-up effect cannot masquerade as a difference,
    // and compare the medians.
    const tA = [], tG = [];
    for (let k = 0; k < 3; k++) {
      let t = Date.now();
      const qa = await call('act', { code: 'STU001', roundIndex: aiIdx + 1, action: 'query', position: A_POS, actionId: 'A' + k }, u1);
      tA.push(Date.now() - t);
      t = Date.now();
      const qg = await call('act', { code: 'STU001', roundIndex: aiIdx + 1, action: 'query', position: G_POS, actionId: 'G' + k }, u1);
      tG.push(Date.now() - t);
      if (k === 0) {
        ok(qa.result && qa.result.value === mapAI[A_POS - 1],
          'a query AT a private anchor returns the true prize there');
        ok(qg.result && qg.result.value === Ai.aiAnswer(anchorsAI, G_POS, params.ai.answerRounding),
          'a query inside a gap returns exactly the offline engine’s interpolation');
        ok(JSON.stringify(Object.keys(qa.result || {})) === JSON.stringify(Object.keys(qg.result || {})),
          'the two responses have the SAME KEYS — nothing in the payload says which was an anchor',
          JSON.stringify(Object.keys(qa.result || {})) + ' vs ' + JSON.stringify(Object.keys(qg.result || {})));
        ok(JSON.stringify(qa.result).replace(/\d/g, '#') === JSON.stringify(qg.result).replace(/\d/g, '#'),
          'and the same SHAPE once the digits are masked — a value is a value');
      }
    }
    const med = a => a.slice().sort((x, y) => x - y)[1];
    ok(Math.abs(med(tA) - med(tG)) < 150,
      `and indistinguishable response times (median ${med(tA)} ms at an anchor, ${med(tG)} ms in a gap) — the fixed pad holds`);
    const replay = await call('act', { code: 'STU001', roundIndex: aiIdx + 1, action: 'query', position: A_POS, actionId: 'A0' }, u1);
    ok(replay.result && replay.result.value === mapAI[A_POS - 1],
      'replaying the same actionId returns the recorded answer, and charges nothing further');
  }

  // A query in the AI-OFF block is refused by the server, not merely hidden.
  {
    let offIdx = -1;
    for (let i = 0; i < plan.rounds.length; i++) {
      if (plan.rounds[i].condition === 'AI_OFF') { offIdx = i; break; }
    }
    await call('startRound', { code: 'STU001', roundIndex: offIdx + 1 }, u1);
    const denied = await call('act', { code: 'STU001', roundIndex: offIdx + 1, action: 'query', position: 50, actionId: 'off1' }, u1);
    ok(!!denied.error, 'a query in an AI-OFF round is refused by the SERVER, not merely hidden in the UI');
  }

  // Back to round 1 for the reveal / nominate arithmetic.
  await call('startRound', { code: 'STU001', roundIndex: 1 }, u1);
  const rev = await call('act', { code: 'STU001', roundIndex: 1, action: 'reveal', position: 55, actionId: 'r1' }, u1);
  ok(rev.result && rev.result.value === map[54], 'a reveal returns the true prize at that position');
  const revAgain = await call('act', { code: 'STU001', roundIndex: 1, action: 'reveal', position: 55, actionId: 'r2' }, u1);
  ok(!!revAgain.error, 'revealing the same position twice is refused by the SERVER — a double click cannot charge twice');
  const revReplay = await call('act', { code: 'STU001', roundIndex: 1, action: 'reveal', position: 55, actionId: 'r1' }, u1);
  ok(revReplay.result && revReplay.result.value === rev.result.value,
    'but the original actionId still replays cleanly — a dropped connection is not a lost round');

  const expectCost = 1 * params.costs.revealCost;   // one reveal in this round
  const nom = await call('nominate', { code: 'STU001', roundIndex: 1, position: 55, actionId: 'n1' }, u1);
  ok(!!nom.result, 'nominate returns a result', JSON.stringify(nom.error || '').slice(0, 200));
  if (nom.result) {
    ok(nom.result.trueValue === map[54], 'carrying the true prize at the nominated position');
    ok(nom.result.totalCost === expectCost,
      `the cost the SERVER counted (${nom.result.totalCost}, expected ${expectCost})`);
    ok(nom.result.score === map[54] - expectCost,
      'and the score computed server-side: the true prize minus everything spent');
    const nomReplay = await call('nominate', { code: 'STU001', roundIndex: 1, position: 55, actionId: 'n1' }, u1);
    ok(nomReplay.result && nomReplay.result.score === nom.result.score, 'nominate is idempotent too');
  }
  const nomAgain = await call('nominate', { code: 'STU001', roundIndex: 1, position: 90, actionId: 'n2' }, u1);
  ok(!!nomAgain.error, 'a finished round cannot be nominated again — nobody re-rolls a bad score');

  const intruder = await call('act', { code: 'STU001', roundIndex: 2, action: 'reveal', position: 5, actionId: 'z1' }, u2);
  ok(!!intruder.error, 'a different signed-in user cannot act as this participant, even knowing the code');

  const badPos = await call('act', { code: 'STU001', roundIndex: 2, action: 'reveal', position: 999, actionId: 'z2' }, u1);
  ok(!!badPos.error, 'a position outside the line is rejected');

  // ── the authoritative log ────────────────────────────────────────────────
  const evSnap = await db.collection('events').get();
  const rows = [];
  evSnap.forEach(x => rows.push(x.data()));
  const srvRows = rows.filter(x => x.server);
  ok(srvRows.length >= 3, `the server wrote the authoritative rows (${srvRows.length})`);
  const decision = srvRows.filter(x => x.event === 'decision')[0];
  ok(!!decision && !!decision.ai_anchors_before,
    'and a decision row carries the AI’s anchor set — which only the server knows');
  const roundEnd = srvRows.filter(x => x.event === 'round_end')[0];
  ok(!!roundEnd && roundEnd.final_score != null, 'and a round_end row carries the server-computed score');
  ok(!!roundEnd && roundEnd.pid === 'STU001',
    'with pid = the student ID, so the Simulation Platform still verifies against it');

  // ── the Security Rules ───────────────────────────────────────────────────
  console.log('\n── the Security Rules ──');
  const restBase = `http://127.0.0.1:${PORTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents`;
  async function asUser(path, user) {
    const r = await fetch(`${restBase}/${path}`, { headers: { Authorization: 'Bearer ' + user.token } });
    return r.status;
  }
  ok(await asUser(`runs/${runId}`, u1) === 403,
    'a participant CANNOT read the run document in server mode — that is where the generator seed lives');
  ok(await asUser(`participants/${runId}__STU001/rounds/1`, u1) === 403,
    'nor the server’s per-round state, which holds what has been revealed');
  ok(await asUser('events', u1) === 403, 'nor anyone’s event rows');

  // The same document IS readable when the run is not in server mode.
  await db.collection('runs').doc('RUNLOCAL').set({ name: 'local run', serverMode: false, locked: false });
  ok(await asUser('runs/RUNLOCAL', u1) === 200,
    'while a LOCAL-mode run stays readable — there the client necessarily computes from the same seed');
}

try {
  await main();
} catch (e) {
  console.error('\nemulator test threw: ' + (e && e.stack || e));
  console.error(emLog.slice(-2000));
  fails++;
} finally {
  em.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1200));
}

console.log('\n' + (fails
  ? `EMULATOR TEST FAILED — ${fails} of ${checks} checks`
  : `EMULATOR TEST OK — all ${checks} checks passed against the real Functions and Rules.`));
process.exit(fails ? 1 : 0);
