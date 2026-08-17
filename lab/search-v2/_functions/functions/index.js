'use strict';
/*
 * search-v2 — score-bearing actions as Cloud Functions (design brief §17.2)
 * =========================================================================
 *
 * The brief's requirement: the client sends a POSITION; the server holds the
 * mapping and the anchor state, computes the answer or the truth, charges the
 * cost, appends the authoritative event, and returns THE SINGLE NUMBER. The
 * client never receives more than one value at a time and never computes a
 * score.
 *
 * Three properties this file exists to guarantee:
 *
 *   1. IDENTICAL RESPONSE whether or not the queried position was one of the
 *      AI's private anchors. No `wasAnchor` field, no difference in payload
 *      size, and every handler is padded to a fixed wall-clock duration so
 *      response time cannot leak it either. A participant who could detect an
 *      exact answer from the wire has broken the experiment.
 *
 *   2. IDEMPOTENT on a client-generated `actionId`. A retried reveal after a
 *      dropped connection must not charge twice — the recorded result is
 *      returned instead, byte for byte.
 *
 *   3. `nominate` COMPUTES THE FINAL SCORE. A client total is never trusted.
 *
 * The mapping pool is regenerated here from the run's `generatorSeed`, which in
 * server mode the client can never read: the Rules deny `runs/{runId}` to
 * participants whenever `serverMode == true`, and the client-safe subset lives
 * in `runPublic/{runId}` with no seeds and no specs in it.
 *
 * DEPLOY (needs the Blaze plan):
 *     node lab/search-v2/tools/sync-engine.mjs      # refresh the engine copies
 *     cd lab/search-v2 && firebase deploy --only functions
 * Then turn "Score-bearing actions" to "on the server" for the run, in the
 * admin panel's Environment group, BEFORE its first participant.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const CFG = require('./engine/config.js');
const Pool = require('./engine/pool.js');
const Specs = require('./engine/specs.js');
const Ai = require('./engine/ai.js');

admin.initializeApp();
const db = admin.firestore();

// Cold starts cost a participant seconds in the middle of a decision, so the
// brief asks for a warm instance during sessions. minInstances is a billed
// setting; 0 is the safe default and the admin can raise it for a session.
setGlobalOptions({
  region: process.env.SV_REGION || 'us-central1',
  maxInstances: 20,
  minInstances: Number(process.env.SV_MIN_INSTANCES || 0)
});

// Every handler returns after AT LEAST this long, measured from entry. It is the
// same for a query, a reveal and a nomination, and the same whether or not the
// position was an anchor — see property 1 above.
const FIXED_MS = 260;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function pad(startedAt) {
  const left = FIXED_MS - (Date.now() - startedAt);
  if (left > 0) await sleep(left);
}

// ---------------------------------------------------------------------------
// run artifacts, memoised per instance
// ---------------------------------------------------------------------------
const cache = new Map();

async function artifacts(runId) {
  if (cache.has(runId)) return cache.get(runId);
  const snap = await db.collection('runs').doc(runId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such run.');
  const run = snap.data() || {};
  const params = Specs.withDefaults(run.params);
  if (run.ops) Object.keys(run.ops).forEach(function (k) { params.ops[k] = run.ops[k]; });

  const pool = Pool.buildPool(params.env, params.env.generatorSeed);
  let specs = null;
  if (run.specsJson) { try { specs = JSON.parse(run.specsJson); } catch (e) { specs = null; } }
  if (!specs || !specs.length) specs = Specs.buildSpecs(pool, params, run.specSeed || null);

  const byId = {};
  specs.forEach(function (s) { byId[s.spec_id] = s; });
  const art = { run: run, params: params, pool: pool, specs: specs, specById: byId };
  cache.set(runId, art);
  return art;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function requireAuth(req) {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
}
function normCode(c) {
  const s = String(c == null ? '' : c).trim().toUpperCase();
  if (!s || s.length > 64 || !/^[\w.@-]+$/.test(s)) throw new HttpsError('invalid-argument', 'Bad participant code.');
  return s;
}
function normRunId(r) {
  const s = String(r == null ? '' : r).trim();
  if (!s || s.length > 128) throw new HttpsError('invalid-argument', 'Bad run id.');
  return s;
}
function rosterRef(runId, code) { return db.collection('roster').doc(runId + '__' + code); }
function participantRef(runId, code) { return db.collection('participants').doc(runId + '__' + code); }
function roundRef(runId, code, roundIndex) {
  return participantRef(runId, code).collection('rounds').doc(String(roundIndex));
}

// The uid that claimed this code is the only one allowed to act as it. Without
// this a participant could drive another's session by guessing a student ID.
async function requireOwner(uid, runId, code) {
  const snap = await rosterRef(runId, code).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'That code has not been claimed.');
  const d = snap.data() || {};
  if (d.claimedByUid && d.claimedByUid !== uid) {
    throw new HttpsError('permission-denied', 'That code belongs to another session.');
  }
  return d;
}

// The participant's own 28-round plan, from the frozen specs and their sequence.
async function planFor(art, code, sequence) {
  return Specs.sessionPlan(art.specs, code, sequence, art.params);
}

// Append an authoritative event row. Written by the Admin SDK, so the Rules'
// refusal of client updates never applies to it — and the client cannot forge
// one, because in server mode it never learns the values in the first place.
// One document per authoritative row. The id must be unique across the WHOLE
// session, so the per-round band below leaves room for every kind:
//
//     round_index * 1000        round_start
//                      + 1..899 decisions (caps allow at most 60)
//                      +   900  the stop decision
//                      +   901  round_end
//
// It used to end the round at `roundIndex * 1000 + 1000`, which is the NEXT
// round's round_start — same id, written with { merge: false }, so starting
// round N+1 destroyed round N's round_end. In a 28-round session 27 of the 28
// authoritative round rows were overwritten and rounds.csv came out with one
// row per participant.
const SEQ_STOP = 900, SEQ_ROUND_END = 901;

async function appendEvent(runId, code, row) {
  const id = String(code).replace(/[^\w-]/g, '_') + '__srv__' +
    String(row.seq != null ? row.seq : Date.now()).padStart(9, '0');
  await db.collection('events').doc(id).set(Object.assign({
    run_id: runId, participant_code: code, pid: code,
    t: Date.now(), iso: new Date().toISOString(), server: true
  }, row), { merge: false });
}

// ---------------------------------------------------------------------------
// claimCode (§17.5)
// ---------------------------------------------------------------------------
exports.claimCode = onCall(async (req) => {
  const startedAt = Date.now();
  const uid = requireAuth(req);
  const runId = normRunId(req.data && req.data.runId);
  const code = normCode(req.data && req.data.code);

  const art = await artifacts(runId);
  const mode = (art.params.ops && art.params.ops.rosterMode) || 'open';
  const ref = rosterRef(runId, code);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.claimedByUid && d.claimedByUid !== uid) {
        // Resumption from another device is the ordinary case (§17.7); re-bind
        // rather than lock a participant out of their own session.
        if (art.params.ops.allowResume === false) {
          throw new HttpsError('permission-denied', 'That code is already in use.');
        }
        tx.set(ref, { claimedByUid: uid, rebindAt: Date.now() }, { merge: true });
        return { ok: true, sequence: d.sequence, buttonOrder: d.buttonOrder || null, resumed: true };
      }
      if (!d.claimedByUid) {
        tx.set(ref, { claimedByUid: uid, claimedAt: Date.now(), status: 'started' }, { merge: true });
        return { ok: true, sequence: d.sequence, buttonOrder: d.buttonOrder || null, resumed: false };
      }
      return { ok: true, sequence: d.sequence, buttonOrder: d.buttonOrder || null, resumed: true };
    }
    if (mode === 'roster') throw new HttpsError('permission-denied', 'not-on-roster');

    // Open mode: a class-platform student ID enrols itself, taking the
    // under-filled sequence so the crossover split stays exact (§11).
    const countRef = db.collection('runCounts').doc(runId);
    const cSnap = await tx.get(countRef);
    const c = cSnap.exists ? (cSnap.data() || {}) : { nA: 0, nB: 0 };
    const override = (art.run.assign && art.run.assign.nextEntrantOverride) || 'auto';
    // ONE rule, in the shared engine (Specs.nextCell), so this and the
    // client-mode path cannot drift: the under-filled arm takes the entrant,
    // and the button order alternates on that arm's own parity — which keeps
    // all four cells of sequence × order balanced without a counter field the
    // client's rules would refuse.
    const cell = Specs.nextCell(c, override, (art.params.ui && art.params.ui.buttonOrder) || 'fixed');
    const seq = cell.sequence, order = cell.buttonOrder;
    tx.set(countRef, cell.counts, { merge: true });
    tx.set(ref, {
      runId: runId, code: code, sequence: seq, buttonOrder: order, status: 'started',
      claimedByUid: uid, claimedAt: Date.now(), autoEnrolled: true
    }, { merge: true });
    return { ok: true, sequence: seq, buttonOrder: order, resumed: false };
  });

  // The first claim locks the run: from here the Rules refuse every parameter
  // write, so editing a live run is impossible rather than discouraged (§17b).
  if (!art.run.locked) {
    await db.collection('runs').doc(runId).set({ locked: true, lockedAt: Date.now() }, { merge: true });
    cache.delete(runId);
  }
  await pad(startedAt);
  return out;
});

// ---------------------------------------------------------------------------
// startRound — the ONLY place pre-opened values reach the client, and they
// reach it one round at a time. The mapping and the AI's anchors never do.
// ---------------------------------------------------------------------------
exports.startRound = onCall(async (req) => {
  const startedAt = Date.now();
  const uid = requireAuth(req);
  const runId = normRunId(req.data && req.data.runId);
  const code = normCode(req.data && req.data.code);
  const roundIndex = Math.round(Number(req.data && req.data.roundIndex));
  if (!isFinite(roundIndex) || roundIndex < 1 || roundIndex > 200) {
    throw new HttpsError('invalid-argument', 'Bad round index.');
  }

  const entry = await requireOwner(uid, runId, code);
  const art = await artifacts(runId);
  const plan = await planFor(art, code, entry.sequence);
  const r = plan.rounds[roundIndex - 1];
  if (!r) throw new HttpsError('out-of-range', 'No such round.');

  const spec = r.spec;
  const map = art.pool[spec.mapping_index];
  const ref = roundRef(runId, code, roundIndex);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() || {}) : null;

  // A round resumed after a break restarts from its beginning and is flagged for
  // exclusion (§16.2, §17.7) — but a round already NOMINATED is not replayable,
  // or a participant could re-roll a bad score.
  if (prev && prev.done) throw new HttpsError('failed-precondition', 'That round is already finished.');

  await ref.set({
    runId: runId, code: code, roundIndex: roundIndex, specId: spec.spec_id,
    block: r.block, condition: r.condition, scored: r.scored,
    startedAt: Date.now(), queries: [], reveals: [], applied: {},
    interrupted: !!prev, done: false
  }, { merge: false });

  await appendEvent(runId, code, {
    event: 'round_start', seq: roundIndex * 1000,
    sequence: entry.sequence, block: r.block, condition: r.condition,
    scored: r.scored, round_index: roundIndex, spec_id: spec.spec_id,
    seed_shape: spec.seed_shape, ai_density: spec.ai_density,
    mapping_index: spec.mapping_index,
    info: JSON.stringify({ pre_opened: spec.pre_opened, ai_k: spec.ai_k, interrupted: !!prev })
  });

  await pad(startedAt);
  return {
    spec_id: spec.spec_id,
    block: r.block,
    condition: r.condition,
    scored: r.scored,
    seed_shape: spec.seed_shape,
    ai_density: spec.ai_density,
    ai_k: spec.ai_k,
    round_index: roundIndex,
    total_rounds: plan.rounds.length,
    // Values ONLY for the positions that are open to the participant anyway.
    pre_opened: spec.pre_opened.map(function (p) { return { pos: p, val: map[p - 1] }; }),
    interrupted: !!prev
  };
});

// ---------------------------------------------------------------------------
// act — one query or one reveal. Returns exactly { value } in both cases and in
// every case, after the same fixed delay.
// ---------------------------------------------------------------------------
exports.act = onCall(async (req) => {
  const startedAt = Date.now();
  const uid = requireAuth(req);
  const runId = normRunId(req.data && req.data.runId);
  const code = normCode(req.data && req.data.code);
  const roundIndex = Math.round(Number(req.data && req.data.roundIndex));
  const position = Math.round(Number(req.data && req.data.position));
  const action = String((req.data && req.data.action) || '');
  const actionId = String((req.data && req.data.actionId) || '');
  if (action !== 'query' && action !== 'reveal') throw new HttpsError('invalid-argument', 'Bad action.');
  if (!actionId || actionId.length > 128) throw new HttpsError('invalid-argument', 'Bad action id.');

  const entry = await requireOwner(uid, runId, code);
  const art = await artifacts(runId);
  const P = art.params;
  // A query or a reveal always acts on a concrete position, under EITHER stop
  // rule — this guard was mistakenly gated on the legacy rule (it had swapped
  // places with nominate's, whose contract the gate actually describes), which
  // let a best_found session's client name an out-of-range position and read
  // undefined off the mapping.
  if (!isFinite(position) || position < 1 || position > P.env.positions) {
    throw new HttpsError('invalid-argument', 'Bad position.');
  }
  const plan = await planFor(art, code, entry.sequence);
  const r = plan.rounds[roundIndex - 1];
  if (!r) throw new HttpsError('out-of-range', 'No such round.');
  if (action === 'query' && r.condition !== 'AI_ON') {
    throw new HttpsError('failed-precondition', 'There is no AI in this part.');
  }
  const spec = r.spec;
  const map = art.pool[spec.mapping_index];
  const ref = roundRef(runId, code, roundIndex);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Start the round first.');
    const st = snap.data() || {};
    if (st.done) throw new HttpsError('failed-precondition', 'That round is already finished.');

    // Idempotency: a retry after a dropped connection returns the recorded
    // answer and charges nothing further.
    const applied = st.applied || {};
    if (applied[actionId] != null) return { value: applied[actionId], replay: true };

    // COPY, do not alias. These arrays are pushed into below, and the caller
    // builds the decision row's `*_before` fields from `result.st`; sharing the
    // reference made every one of them describe the state AFTER the action —
    // ai_anchors_before contained the position just revealed, decision_index was
    // 1-based, and is_first_decision was never true for a server-mode row.
    const before = {
      queries: (st.queries || []).slice(),
      reveals: (st.reveals || []).slice()
    };
    const queries = (st.queries || []).slice(), reveals = (st.reveals || []).slice();
    if (action === 'query' && queries.length >= P.costs.queryCap) {
      throw new HttpsError('resource-exhausted', 'Query cap reached.');
    }
    if (action === 'reveal') {
      if (reveals.length >= P.costs.revealCap) throw new HttpsError('resource-exhausted', 'Reveal cap reached.');
      const already = reveals.some(function (x) { return x.pos === position; }) ||
        spec.pre_opened.indexOf(position) >= 0;
      // Re-revealing is not allowed (§7) — and refusing it here, not just in the
      // UI, is what stops a double click charging twice.
      if (already) throw new HttpsError('failed-precondition', 'That position is already open.');
    }

    let value;
    if (action === 'query') {
      const anchors = Ai.anchorSet(
        spec.ai_anchors, spec.pre_opened,
        reveals.map(function (x) { return x.pos; }), map
      );
      value = Ai.aiAnswer(anchors, position, P.ai.answerRounding);
      queries.push({ pos: position, val: value, t: Date.now() });
    } else {
      value = map[position - 1];
      reveals.push({ pos: position, val: value, t: Date.now() });
    }
    applied[actionId] = value;
    tx.set(ref, { queries: queries, reveals: reveals, applied: applied }, { merge: true });
    return { value: value, replay: false, nQ: queries.length, nR: reveals.length, before: before };
  });

  if (!result.replay) {
    // The authoritative decision row. The client's own row carries the timing
    // and the scanning; this one carries the values, and it is the one the
    // analysis trusts.
    const bq = result.before.queries, brv = result.before.reveals;
    const anchorsBefore = Ai.anchorSet(
      spec.ai_anchors, spec.pre_opened, brv.map(function (x) { return x.pos; }), map
    );
    const knownBefore = Ai.knownSet(
      spec.pre_opened, brv.map(function (x) { return x.pos; }), map
    );
    const enc = function (a) { return a.map(function (x) { return x.pos + ':' + x.val; }).join('|'); };
    await appendEvent(runId, code, {
      event: 'decision', seq: roundIndex * 1000 + (result.nQ + result.nR),
      sequence: entry.sequence, block: r.block, condition: r.condition, scored: r.scored,
      round_index: roundIndex, spec_id: spec.spec_id, seed_shape: spec.seed_shape,
      ai_density: spec.ai_density, mapping_index: spec.mapping_index,
      event_id: actionId, action: action, position: position, value: result.value,
      decision_index: bq.length + brv.length,
      queries_so_far: bq.length,
      reveals_so_far: brv.length,
      n_reveals_before: brv.length,
      already_queried: action === 'reveal'
        ? bq.some(function (q) { return q.pos === position; }) : null,
      ai_anchors_before: enc(anchorsBefore),
      participant_known_before: enc(knownBefore),
      participant_queried_before: enc(bq),
      best_true_known_before: knownBefore.reduce(function (m, x) { return (m == null || x.val > m) ? x.val : m; }, null)
    });
  }

  await pad(startedAt);
  // EXACTLY this shape, always. No flag saying whether the position was an
  // anchor, and no field whose presence would imply one.
  return { value: result.value };
});

// ---------------------------------------------------------------------------
// nominate — the server computes the score. A client total is never trusted.
// ---------------------------------------------------------------------------
exports.nominate = onCall(async (req) => {
  const startedAt = Date.now();
  const uid = requireAuth(req);
  const runId = normRunId(req.data && req.data.runId);
  const code = normCode(req.data && req.data.code);
  const roundIndex = Math.round(Number(req.data && req.data.roundIndex));
  const position = Math.round(Number(req.data && req.data.position));
  const actionId = String((req.data && req.data.actionId) || '');
  if (!actionId) throw new HttpsError('invalid-argument', 'Bad action id.');

  const entry = await requireOwner(uid, runId, code);
  const art = await artifacts(runId);
  const P = art.params;
  // Under the 'best_found' rule the client names no position at all — it sends
  // 0 on a nothing-found stop to keep the wire shape stable, and Specs.settle
  // ignores the field — so a missing or nonsense position is only an error
  // under the legacy 'nominate' rule, where the position IS the choice. This
  // guard used to be unconditional (it had swapped places with act's), which
  // dead-ended a best_found participant who stopped with nothing found:
  // 'Bad position' → "we could not reach the study server", every retry alike.
  const legacyRule = (P.costs.stopRule === 'nominate');
  if (legacyRule && (!isFinite(position) || position < 1 || position > P.env.positions)) {
    throw new HttpsError('invalid-argument', 'Bad position.');
  }
  const plan = await planFor(art, code, entry.sequence);
  const r = plan.rounds[roundIndex - 1];
  if (!r) throw new HttpsError('out-of-range', 'No such round.');
  const spec = r.spec;
  const map = art.pool[spec.mapping_index];
  const ref = roundRef(runId, code, roundIndex);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Start the round first.');
    const st = snap.data() || {};
    if (st.done) {
      if (st.nominationId === actionId) return Object.assign({}, st.result, { replay: true });
      throw new HttpsError('failed-precondition', 'That round is already finished.');
    }
    const queries = st.queries || [], reveals = st.reveals || [];
    // ONE settlement, shared with the client build through the vendored engine
    // (tools/sync-engine.mjs keeps the copy honest). Under 'best_found' the
    // position the client sent is IGNORED: the server takes the best prize the
    // participant actually holds, which is the whole point of the rule.
    const settled = Specs.settle(P, {
      map: map, preOpened: spec.pre_opened, reveals: reveals, queries: queries, position: position
    });
    const res = {
      trueValue: settled.trueValue, score: settled.score, raw_score: settled.raw_score,
      totalCost: settled.totalCost, nQueries: queries.length, nReveals: reveals.length,
      nominationType: settled.nominationType, nominatedPosition: settled.position,
      stopRule: settled.rule
    };
    tx.set(ref, {
      done: true, nominationId: actionId, endedAt: Date.now(),
      nominatedPosition: settled.position, result: res
    }, { merge: true });
    return Object.assign({}, res, { replay: false, queries: queries, reveals: reveals, st: st });
  });

  if (!out.replay) {
    const enc = function (a) { return a.map(function (x) { return x.pos + ':' + x.val; }).join('|'); };
    const capHit = out.nReveals >= P.costs.revealCap ? 'reveal'
      : (out.nQueries >= P.costs.queryCap ? 'query' : null);
    await appendEvent(runId, code, {
      event: 'decision', seq: roundIndex * 1000 + SEQ_STOP,
      sequence: entry.sequence, block: r.block, condition: r.condition, scored: r.scored,
      round_index: roundIndex, spec_id: spec.spec_id, seed_shape: spec.seed_shape,
      ai_density: spec.ai_density, mapping_index: spec.mapping_index,
      event_id: actionId, action: 'stop', position: position, value: null, cap_hit: capHit,
      decision_index: out.nQueries + out.nReveals,
      queries_so_far: out.nQueries, reveals_so_far: out.nReveals, n_reveals_before: out.nReveals,
      participant_known_before: enc(Ai.knownSet(spec.pre_opened, (out.reveals || []).map(function (x) { return x.pos; }), map)),
      participant_queried_before: enc(out.queries || [])
    });
    await appendEvent(runId, code, {
      event: 'round_end', seq: roundIndex * 1000 + SEQ_ROUND_END,
      sequence: entry.sequence, block: r.block, condition: r.condition, scored: r.scored,
      round_index: roundIndex, spec_id: spec.spec_id, seed_shape: spec.seed_shape,
      ai_density: spec.ai_density, mapping_index: spec.mapping_index,
      n_queries: out.nQueries, n_reveals: out.nReveals, total_cost: out.totalCost,
      nominated_position: (out.nominatedPosition != null ? out.nominatedPosition : position),
      nominated_true_value: out.trueValue, stop_rule: out.stopRule,
      nomination_type: out.nominationType, final_score: out.score, raw_score: out.raw_score,
      stopped_immediately: (out.nQueries + out.nReveals) === 0,
      cap_hit: capHit, interrupted: !!(out.st && out.st.interrupted),
      duration_ms: out.st && out.st.startedAt ? (Date.now() - out.st.startedAt) : null,
      info: JSON.stringify({ queries: enc(out.queries || []), reveals: enc(out.reveals || []) })
    });
  }

  await pad(startedAt);
  return {
    trueValue: out.trueValue, score: out.score, raw_score: out.raw_score,
    totalCost: out.totalCost, nQueries: out.nQueries, nReveals: out.nReveals,
    nominationType: out.nominationType
  };
});

// ---------------------------------------------------------------------------
// debriefRound (§16.7) — after the session, ONE of the participant's own rounds
// with the truth in it, so the debrief screen can redraw it. Safe to serve only
// because the round is finished: it is refused for any round still open, and for
// any round that is not this participant's.
// ---------------------------------------------------------------------------
exports.debriefRound = onCall(async (req) => {
  const startedAt = Date.now();
  const uid = requireAuth(req);
  const runId = normRunId(req.data && req.data.runId);
  const code = normCode(req.data && req.data.code);
  const roundIndex = Math.round(Number(req.data && req.data.roundIndex));

  const entry = await requireOwner(uid, runId, code);
  const art = await artifacts(runId);
  const plan = await planFor(art, code, entry.sequence);
  const r = plan.rounds[roundIndex - 1];
  if (!r) throw new HttpsError('out-of-range', 'No such round.');

  const snap = await roundRef(runId, code, roundIndex).get();
  const st = snap.exists ? (snap.data() || {}) : null;
  if (!st || !st.done) throw new HttpsError('failed-precondition', 'That round is not finished.');

  const spec = r.spec;
  const map = art.pool[spec.mapping_index];
  const anchors = Ai.anchorSet(spec.ai_anchors, spec.pre_opened,
    (st.reveals || []).map(function (x) { return x.pos; }), map);
  const curve = [];
  for (let p = 1; p <= art.params.env.positions; p++) curve.push(Ai.aiAnswerRaw(anchors, p));

  await pad(startedAt);
  return {
    round_index: roundIndex, block: r.block, truth: map, curve: curve,
    anchors: spec.ai_anchors.map(function (q) { return { pos: q, val: map[q - 1] }; }),
    pre: spec.pre_opened.map(function (q) { return { pos: q, val: map[q - 1] }; }),
    revealed: st.reveals || [], asked: st.queries || [],
    nominated: st.nominatedPosition != null
      ? { pos: st.nominatedPosition, val: map[st.nominatedPosition - 1] } : null
  };
});

// Exported for tools/functions-selftest.mjs, which drives the pure logic with a
// fake Firestore. Never called at runtime.
exports.__internals = { FIXED_MS: FIXED_MS, artifacts: artifacts, pad: pad };
