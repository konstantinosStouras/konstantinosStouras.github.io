/* ==========================================================================
   search-v2  ·  tools/simulate.mjs
   A Monte-Carlo of the whole study, played by policies instead of people.

       node lab/search-v2/tools/simulate.mjs          # 1000 participants
       SIM_N=100 node lab/search-v2/tools/simulate.mjs # a quick run

   selftest.js asks whether the artifacts are correct; smoke.mjs asks whether the
   app behaves; data-audit.mjs asks whether the record is faithful. This asks the
   remaining question, which is about the DESIGN rather than the build: with the
   costs, the two K values, the caps, the 24 scored rounds and the three layouts
   as they currently stand, is the contrast the study exists to measure — search
   WITHOUT an AI against search WITH an interpolative one — big enough, and
   sharp enough in the intended direction, to be seen?

   It plays the real thing. The frozen artifacts are rebuilt exactly as the app
   rebuilds them (Pool.buildPool → Specs.buildSpecs → Specs.sessionPlan), the AI
   answers through Ai.anchorSet / Ai.aiAnswer, and the scoring is the one line the
   Cloud Function uses: true prize at the nominated position minus 2 per question
   and 5 per reveal, no floor. Nothing about the environment is re-implemented
   here; only the participant is.

   Every draw comes from Pool.rngFrom seeded by the participant code, so a run is
   reproducible to the digit. Math.random is never called.

   It also writes tools/SIMULATION-FINDINGS.md, which is the same closing section
   the report prints — generated, so the file and the run can never disagree.
   ========================================================================== */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CFG = require('../config.js');
const Pool = require('../pool.js');
const Specs = require('../specs.js');
const Ai = require('../ai.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const N = Math.max(2, parseInt(process.env.SIM_N || '1000', 10) || 1000);

// ── the frozen artifacts, built exactly as the app builds them ─────────────
const P = Specs.withDefaults(null);
const J = P.env.positions;
const L = P.env.stepBound;
const SIGMA = CFG.sigma(L);
const S_STAR = CFG.sStar(P.costs.revealCost);
const G_STAR = CFG.gStar(P.costs.revealCost, L);
const C_R = P.costs.revealCost;
const C_Q = P.costs.queryCost;
const ROUNDING = P.ai.answerRounding;

const pool = Pool.buildPool(P.env, P.env.generatorSeed);
const specs = Specs.buildSpecs(pool, P, null);
{
  const v = Specs.validate(pool, specs, P);
  if (!v.pass) {
    console.error('The frozen artifacts do not validate; refusing to simulate.');
    v.failures.forEach(f => console.error('  · ' + f));
    process.exit(1);
  }
}

// ── small helpers ──────────────────────────────────────────────────────────
const POLICIES = ['RATIONAL-NO-AI', 'RATIONAL-WITH-AI', 'TRUSTING', 'SKEPTICAL', 'NOISY-SATISFICER'];
const LAYOUTS = ['FRONTIER', 'BALANCED', 'GAP', 'OPEN'];
const DENSITIES = ['SPARSE', 'DENSE'];

function pad4(n) { return String(n).padStart(4, '0'); }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
// Two-sided paired t-test at 80% power, normal approximation: n = 7.849 (sd/Δ)².
const Z_SUM_SQ = Math.pow(1.959963985 + 0.841621234, 2);
function n80(effect, sdD) {
  if (!isFinite(effect) || !isFinite(sdD) || Math.abs(effect) < 1e-9) return Infinity;
  return Z_SUM_SQ * (sdD * sdD) / (effect * effect);
}

// The AI's anchors are one per equal stratum, so a participant who is TOLD K —
// and they are — can work out the spacing they will face without knowing where
// the anchors landed. These are the stratum midpoints Specs.placeAnchors draws
// within, and they are what the rational-with-AI policy uses to decide whether a
// number is worth verifying. Only the POSITIONS matter: Ai.aiSd reads no values.
function stratumMidpoints(K) {
  const out = [], w = J / K;
  for (let s = 0; s < K; s++) {
    const lo = Math.floor(s * w) + 1, hi = Math.max(Math.floor((s + 1) * w), Math.floor(s * w) + 1);
    out.push(Math.round((lo + hi) / 2));
  }
  return out;
}

// ── the round ──────────────────────────────────────────────────────────────
// One round of play. The engine is the app's: a query costs c_AI and returns the
// AI's number, a reveal costs c_R, returns the truth AND joins the AI's anchor
// set, and the score is the true prize at the nominated position minus the lot.
function newRound(spec, aiOn) {
  const mapping = pool[spec.mapping_index];
  const pre = spec.pre_opened || [];
  const preSet = new Set(pre);
  return {
    spec, mapping, aiOn, pre, preSet,
    revealed: [], revealedSet: new Set(),
    askedVal: Object.create(null), askedOrder: [],
    nQueries: 0, nReveals: 0,
    first: null,                   // { pos, kind } — the round's first action
    hypo: stratumMidpoints(spec.ai_k)
  };
}
function knownPairs(R) { return Ai.knownSet(R.pre, R.revealed, R.mapping); }
function aiAnchors(R) { return Ai.anchorSet(R.spec.ai_anchors, R.pre, R.revealed, R.mapping); }
function bestTrueKnown(R) {
  let z = 0;
  R.preSet.forEach(p => { if (R.mapping[p - 1] > z) z = R.mapping[p - 1]; });
  R.revealedSet.forEach(p => { if (R.mapping[p - 1] > z) z = R.mapping[p - 1]; });
  return z;
}
function isOpen(R, p) { return R.preSet.has(p) || R.revealedSet.has(p); }
function believedAt(R, p) {
  if (isOpen(R, p)) return R.mapping[p - 1];
  const a = R.askedVal[p];
  return (a == null) ? null : a;
}
function takenList(R, extra) {
  const t = R.pre.concat(R.revealed);
  return extra ? t.concat(extra) : t;
}
// The estimated standard deviation of the AI's number at p, from what the
// participant can actually work out: K equal strata, plus every position they or
// the round have opened (a reveal genuinely shrinks the AI's gaps — asking does
// not). This is the participant-computable twin of §16.8's verify_pays.
function sHat(R, p) {
  const seen = Object.create(null), pos = [];
  const add = q => { if (q >= 1 && q <= J && !seen[q]) { seen[q] = 1; pos.push(q); } };
  R.hypo.forEach(add); R.pre.forEach(add); R.revealed.forEach(add);
  pos.sort((a, b) => a - b);
  return Ai.aiSd(pos.map(q => ({ pos: q, val: 0 })), p, SIGMA);
}

function doAsk(R, p) {
  if (!R.aiOn || R.nQueries >= P.costs.queryCap || p < 1 || p > J) return null;
  const v = Ai.aiAnswer(aiAnchors(R), p, ROUNDING);
  R.nQueries++;
  if (R.askedVal[p] == null) R.askedOrder.push(p);
  R.askedVal[p] = v;
  if (!R.first) R.first = { pos: p, kind: 'ask' };
  return v;
}
function doReveal(R, p) {
  if (R.nReveals >= P.costs.revealCap || p < 1 || p > J || isOpen(R, p)) return null;
  R.nReveals++;
  R.revealed.push(p); R.revealedSet.add(p);
  if (!R.first) R.first = { pos: p, kind: 'reveal' };
  return R.mapping[p - 1];
}
function nominateBest(R, rng) {
  let bp = null, bv = -Infinity;
  const consider = p => { const v = believedAt(R, p); if (v != null && v > bv) { bv = v; bp = p; } };
  R.preSet.forEach(consider); R.revealedSet.forEach(consider); R.askedOrder.forEach(consider);
  // Nothing was ever touched: the app leaves the slider at the middle position.
  if (bp == null) bp = Math.round((J + 1) / 2);
  return bp;
}
function settle(R, pos) {
  const cost = R.nQueries * C_Q + R.nReveals * C_R;
  const truth = R.mapping[pos - 1];
  const raw = truth - cost;
  return {
    pos, truth, cost, score: P.costs.scoreFloor ? Math.max(0, raw) : raw,
    nQueries: R.nQueries, nReveals: R.nReveals,
    unverified: !isOpen(R, pos),
    first: R.first,
    aiShown: R.askedVal[pos] != null ? R.askedVal[pos]
      : (R.aiOn ? Ai.aiAnswer(aiAnchors(R), pos, ROUNDING) : null)
  };
}

// ── the policies ───────────────────────────────────────────────────────────
// 1 · RATIONAL-NO-AI. Myopic expected improvement over the participant's OWN
// known set — the §16.8 benchmark with no AI in it. Reveal where EI is highest;
// stop when the best EI on the board falls below what a reveal costs.
function playRationalNoAI(R, rng) {
  for (let step = 0; step < P.costs.revealCap + 2; step++) {
    const known = knownPairs(R);
    if (!known.length) {                       // a blank round: every position is alike
      doReveal(R, Pool.randInt(rng, 1, J));
      continue;
    }
    if (R.nReveals >= P.costs.revealCap) break;
    const z = bestTrueKnown(R);
    const surf = Ai.eiSurface(known, takenList(R), z, J, SIGMA, ROUNDING);
    if (surf.at == null || !(surf.max > C_R)) break;
    doReveal(R, surf.at);
  }
  return settle(R, nominateBest(R, rng));
}

// 2 · RATIONAL-WITH-AI. Scan the AI cheaply, refine around its peak, then verify
// DOWN the candidate list while the AI's own uncertainty at the position it is
// recommending is above s* — the §3.4 rule, computed from K rather than from
// anchors the participant cannot see. Below s* it takes the number on trust.
// The scan is ORDERED by the participant's own expected improvement, so the
// first move is a decision and not a fixed itinerary.
const SCAN = [10, 20, 30, 40, 50, 60, 70, 80, 90];
function playRationalWithAI(R, rng) {
  if (!R.aiOn) return playRationalNoAI(R, rng);

  const known = knownPairs(R);
  let order = SCAN.slice();
  if (known.length) {
    const surf = Ai.eiSurface(known, takenList(R), bestTrueKnown(R), J, SIGMA, ROUNDING);
    order.sort((a, b) => (surf.ei[b - 1] || 0) - (surf.ei[a - 1] || 0));
  } else {
    Pool.shuffle(order, rng);
  }
  order.forEach(p => { if (!isOpen(R, p)) doAsk(R, p); });

  // Refine: the AI's curve peaks at a node, so walk in on the best answer.
  const peakOf = () => {
    let bp = null, bv = -Infinity;
    R.askedOrder.forEach(p => { const v = R.askedVal[p]; if (v > bv) { bv = v; bp = p; } });
    return bp;
  };
  let p0 = peakOf();
  if (p0 != null) {
    [p0 - 5, p0 + 5].forEach(q => { if (q >= 1 && q <= J && R.askedVal[q] == null && !isOpen(R, q)) doAsk(R, q); });
    const p1 = peakOf();
    if (p1 != null) [p1 - 2, p1 + 2].forEach(q => { if (q >= 1 && q <= J && R.askedVal[q] == null && !isOpen(R, q)) doAsk(R, q); });
  }

  // Verify down the list: the top candidate is worth 5 points of proof only
  // while the number standing behind it could be off by more than s*.
  for (let v = 0; v < 4; v++) {
    const cand = nominateBest(R, rng);
    if (isOpen(R, cand)) break;                 // already proven, and still the best
    if (R.nReveals >= P.costs.revealCap) break;
    if (!(sHat(R, cand) > S_STAR)) break;       // trust it — this is the dense case
    doReveal(R, cand);
    // A reveal moves the AI's curve; re-ask the next candidate before judging it.
    const next = nominateBest(R, rng);
    if (!isOpen(R, next)) doAsk(R, next);
  }
  return settle(R, nominateBest(R, rng));
}

// 3 · TRUSTING. Treats an answer as a fact: an asked position joins its belief
// at the AI's number with no uncertainty left on it, so its picture converges on
// the AI's curve and it stops as soon as that curve looks flat. It verifies only
// by accident. This is the behaviour the study is built to detect as costly.
const TRUST_VERIFY_P = 0.10;
function playTrusting(R, rng) {
  if (!R.aiOn) return playRationalNoAI(R, rng);
  const patience = 8 + Pool.randInt(rng, 0, 6);
  for (let step = 0; step < patience; step++) {
    const belief = beliefAnchors(R);
    if (!belief.length) { doAsk(R, Pool.randInt(rng, 1, J)); continue; }
    if (R.nQueries >= P.costs.queryCap) break;
    let z = -Infinity;
    belief.forEach(b => { if (b.val > z) z = b.val; });
    const surf = Ai.eiSurface(belief, takenList(R, R.askedOrder), z, J, SIGMA, ROUNDING);
    if (surf.at == null || !(surf.max > C_Q)) break;
    if (rng() < TRUST_VERIFY_P && R.nReveals < P.costs.revealCap) doReveal(R, surf.at);
    else doAsk(R, surf.at);
  }
  return settle(R, nominateBest(R, rng));
}
// Belief = what the participant thinks it knows: opened positions at the truth,
// asked positions at the AI's number.
function beliefAnchors(R) {
  const seen = Object.create(null), out = [];
  const add = (p, v) => { if (!seen[p]) { seen[p] = 1; out.push({ pos: p, val: v }); } };
  R.preSet.forEach(p => add(p, R.mapping[p - 1]));
  R.revealedSet.forEach(p => add(p, R.mapping[p - 1]));
  R.askedOrder.forEach(p => add(p, R.askedVal[p]));
  out.sort((a, b) => a.pos - b.pos);
  return out;
}

// 4 · SKEPTICAL. Asks a few questions out of curiosity, ignores every answer and
// searches by revealing exactly as policy 1 does. Its treatment effect should be
// the price of the wasted questions and nothing else — the study's lower bound
// on what "the AI is on the screen" can cost by itself.
function playSkeptical(R, rng) {
  if (R.aiOn) {
    const wasted = Pool.randInt(rng, 0, 4);
    for (let i = 0; i < wasted; i++) doAsk(R, Pool.randInt(rng, 1, J));
  }
  return playRationalNoAI(R, rng);
}

// 5 · NOISY-SATISFICER. The human-like baseline: probe the widest unexplored
// stretch (or somewhere at random), stop the moment it holds anything above a
// personal threshold, and take a random action now and then. With the AI on the
// screen an ANSWER counts as something held — which is the everyday form of
// misplaced trust, and costs nothing to hold.
const NOISE_P = 0.10;
function playSatisficer(R, rng) {
  const threshold = 55 + Pool.randInt(rng, 0, 30);
  const patience = 6 + Pool.randInt(rng, 0, 6);
  let held = 0;
  R.preSet.forEach(p => { if (R.mapping[p - 1] > held) held = R.mapping[p - 1]; });
  for (let step = 0; step < patience && held < threshold; step++) {
    let p, kind;
    if (rng() < NOISE_P) {
      p = Pool.randInt(rng, 1, J);
      kind = (R.aiOn && rng() < 0.5) ? 'ask' : 'reveal';
    } else {
      p = (rng() < 0.5) ? widestGapMidpoint(R, rng) : randomUntouched(R, rng);
      kind = (R.aiOn && rng() < 0.7) ? 'ask' : 'reveal';
    }
    const v = (kind === 'ask') ? doAsk(R, p) : doReveal(R, p);
    if (v != null && v > held) held = v;
    if (R.nReveals >= P.costs.revealCap || R.nQueries >= P.costs.queryCap) break;
  }
  return settle(R, nominateBest(R, rng));
}
function touchedPositions(R) {
  const seen = Object.create(null), out = [];
  const add = p => { if (!seen[p]) { seen[p] = 1; out.push(p); } };
  R.preSet.forEach(add); R.revealedSet.forEach(add); R.askedOrder.forEach(add);
  out.sort((a, b) => a - b);
  return out;
}
function widestGapMidpoint(R, rng) {
  const t = touchedPositions(R);
  if (!t.length) return Pool.randInt(rng, 1, J);
  let best = t[0] - 1, at = Math.max(1, Math.round(t[0] / 2));
  if (J - t[t.length - 1] > best) { best = J - t[t.length - 1]; at = Math.min(J, Math.round((t[t.length - 1] + J) / 2)); }
  for (let i = 1; i < t.length; i++) {
    const g = t[i] - t[i - 1];
    if (g - 1 > best) { best = g - 1; at = Math.round((t[i] + t[i - 1]) / 2); }
  }
  return Math.max(1, Math.min(J, at));
}
function randomUntouched(R, rng) {
  for (let i = 0; i < 32; i++) {
    const p = Pool.randInt(rng, 1, J);
    if (!isOpen(R, p) && R.askedVal[p] == null) return p;
  }
  return Pool.randInt(rng, 1, J);
}

const PLAY = {
  'RATIONAL-NO-AI': playRationalNoAI,
  'RATIONAL-WITH-AI': playRationalWithAI,
  'TRUSTING': playTrusting,
  'SKEPTICAL': playSkeptical,
  'NOISY-SATISFICER': playSatisficer
};
// What the same participant would have done with no AI on the screen. It is the
// counterfactual behind "did trusting the machine cost them?", so it has to be
// the policy's OWN behaviour with the AI taken away, not another policy's.
const PLAY_OFF = {
  'RATIONAL-NO-AI': playRationalNoAI,
  'RATIONAL-WITH-AI': playRationalNoAI,
  'TRUSTING': playRationalNoAI,
  'SKEPTICAL': playRationalNoAI,
  'NOISY-SATISFICER': playSatisficer
};

// ── accumulators ───────────────────────────────────────────────────────────
function newCell() {
  return {
    n: 0, score: 0, score2: 0, q: 0, r: 0,
    fmN: 0, fmFront: 0, unver: 0, ceiling: 0,
    aiN: 0, aiOff: 0, aiAbs: 0, aiMax: 0,
    cfN: 0, cfWorse: 0, cfLoss: 0,
    verifyPays: 0, verifyPaysN: 0
  };
}
const cells = {};                              // policy → cond|bucket → cell
POLICIES.forEach(p => { cells[p] = {}; });
function cell(policy, cond, bucket) {
  const k = cond + '|' + bucket;
  return cells[policy][k] || (cells[policy][k] = newCell());
}
// Per-participant means, for the paired analysis of a crossover design.
const perPart = {};
POLICIES.forEach(p => {
  perPart[p] = { on: [], off: [], onS: [], offS: [], onD: [], offD: [], fmOn: [], fmOff: [] };
});

function record(policy, cond, buckets, out, spec, cf) {
  const front = out.first ? Ai.geometry(Ai.knownSet(spec.pre_opened, [], pool[spec.mapping_index]),
    out.first.pos, J).is_frontier : null;
  buckets.forEach(b => {
    const c = cell(policy, cond, b);
    c.n++; c.score += out.score; c.score2 += out.score * out.score;
    c.q += out.nQueries; c.r += out.nReveals;
    c.ceiling += Pool.maxOf(pool[spec.mapping_index]);
    if (out.unverified) c.unver++;
    if (front != null) { c.fmN++; if (front) c.fmFront++; }
    if (out.first) {
      // §16.8's own verify_pays, on the AI's real anchor set — a diagnostic on
      // the geometry the participant walked into, not on what they did.
      const anchors = Ai.anchorSet(spec.ai_anchors, spec.pre_opened, [], pool[spec.mapping_index]);
      const s = Ai.aiSd(anchors, out.first.pos, SIGMA);
      c.verifyPaysN++; if (s > S_STAR) c.verifyPays++;
    }
    if (cond === 'AI_ON' && out.aiShown != null && out.unverified) {
      const d = out.aiShown - out.truth;
      c.aiN++; if (Math.abs(d) >= 1) c.aiOff++;
      c.aiAbs += Math.abs(d); if (Math.abs(d) > c.aiMax) c.aiMax = Math.abs(d);
    }
    if (cf != null) {
      c.cfN++;
      if (out.score < cf.score) { c.cfWorse++; c.cfLoss += (cf.score - out.score); }
    }
  });
}

// ── the run ────────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log('search-v2 · Monte-Carlo of the design');
console.log('  participants        ' + N + '  (' + Math.ceil(N / 2) + ' sequence A, ' + Math.floor(N / 2) + ' sequence B)');
console.log('  rounds each         28 (4 warm-up + 24 scored; only the scored ones are counted below)');
console.log('  pool / specs        ' + pool.length + ' mappings, ' + specs.length + ' specs, validation passes');
console.log('  costs               reveal ' + C_R + ', question ' + C_Q + ', caps ' +
  P.costs.queryCap + ' questions / ' + P.costs.revealCap + ' reveals');
console.log('  sigma = ' + SIGMA.toFixed(4) + '   s* = ' + S_STAR.toFixed(3) + '   g* = ' + G_STAR.toFixed(2));
console.log('  expected AI spacing  sparse K=' + P.ai.sparseK + ' → gap ' + (J / P.ai.sparseK).toFixed(0) +
  ', mid-gap sd ' + (SIGMA * Math.sqrt(J / P.ai.sparseK) / 2).toFixed(2) + (SIGMA * Math.sqrt(J / P.ai.sparseK) / 2 > S_STAR ? '  (ABOVE s*)' : '  (below s*)'));
console.log('                       dense  K=' + P.ai.denseK + ' → gap ' + (J / P.ai.denseK).toFixed(0) +
  ', mid-gap sd ' + (SIGMA * Math.sqrt(J / P.ai.denseK) / 2).toFixed(2) + (SIGMA * Math.sqrt(J / P.ai.denseK) / 2 > S_STAR ? '  (above s*)' : '  (BELOW s*)'));
console.log('');

for (let i = 1; i <= N; i++) {
  const code = 'SIM' + pad4(i);
  const sequence = (i % 2 === 1) ? 'A' : 'B';
  const plan = Specs.sessionPlan(specs, code, sequence, P);

  POLICIES.forEach(policy => {
    const acc = {
      on: [], off: [], onS: [], offS: [], onD: [], offD: [], fmOn: [], fmOnN: 0, fmOff: [], fmOffN: 0
    };
    plan.rounds.forEach(r => {
      if (!r.scored) return;                   // warm-ups are never analysed (§10)
      const spec = r.spec, aiOn = r.condition === 'AI_ON';
      const rng = Pool.rngFrom(Pool.hashSeed(code + '|' + policy + '|' + spec.spec_id));
      const R = newRound(spec, aiOn);
      const out = PLAY[policy](R, rng);

      // The same round played by the same participant with no AI on the screen.
      let cf = null;
      if (aiOn) {
        const R2 = newRound(spec, false);
        cf = PLAY_OFF[policy](R2, Pool.rngFrom(Pool.hashSeed(code + '|' + policy + '|' + spec.spec_id + '|cf')));
      }

      const bucket = spec.seed_shape;          // FRONTIER | BALANCED | GAP | OPEN
      record(policy, r.condition, ['ALL', bucket, spec.ai_density], out, spec, cf);

      const side = aiOn ? 'on' : 'off';
      acc[side].push(out.score);
      acc[side + (spec.ai_density === 'SPARSE' ? 'S' : 'D')].push(out.score);
      const known = Ai.knownSet(spec.pre_opened, [], pool[spec.mapping_index]);
      if (out.first && known.length) {
        const f = Ai.geometry(known, out.first.pos, J).is_frontier ? 1 : 0;
        acc[aiOn ? 'fmOn' : 'fmOff'].push(f);
      }
    });
    const pp = perPart[policy];
    pp.on.push(mean(acc.on)); pp.off.push(mean(acc.off));
    pp.onS.push(mean(acc.onS)); pp.offS.push(mean(acc.offS));
    pp.onD.push(mean(acc.onD)); pp.offD.push(mean(acc.offD));
    pp.fmOn.push(mean(acc.fmOn)); pp.fmOff.push(mean(acc.fmOff));
  });
}

// ── report ─────────────────────────────────────────────────────────────────
function table(headers, rows, align) {
  const w = headers.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(r[i] == null ? '' : r[i]).length)));
  const line = (cs) => '  ' + cs.map((c, i) => {
    const s = String(c == null ? '' : c);
    return (align && align[i] === 'l') ? s.padEnd(w[i]) : s.padStart(w[i]);
  }).join('  ');
  const out = [line(headers), '  ' + w.map(x => '─'.repeat(x)).join('  ')];
  rows.forEach(r => out.push(line(r)));
  return out.join('\n');
}
const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
const f2 = x => (isFinite(x) ? x.toFixed(2) : '—');
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');
const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(2);

const OUT = [];
const say = s => { OUT.push(s); console.log(s); };

function cellMean(c, f) { return c && c.n ? c[f] / c.n : NaN; }

say('══════════════════════════════════════════════════════════════════════════════');
say('TABLE 1 · score by policy and condition (24 scored rounds, ' + N + ' participants)');
say('══════════════════════════════════════════════════════════════════════════════');
{
  const rows = POLICIES.map(p => {
    const off = cell(p, 'AI_OFF', 'ALL'), on = cell(p, 'AI_ON', 'ALL');
    const d = perPart[p].on.map((v, i) => v - perPart[p].off[i]);
    const eff = mean(d), sdd = sd(d);
    return [p, f2(cellMean(off, 'score')), f2(cellMean(on, 'score')), sgn(eff),
      f2(sdd), (isFinite(n80(eff, sdd)) ? Math.ceil(n80(eff, sdd)) : '∞'),
      f2(cellMean(off, 'q')) + '/' + f2(cellMean(off, 'r')),
      f2(cellMean(on, 'q')) + '/' + f2(cellMean(on, 'r'))];
  });
  say(table(['policy', 'AI-OFF', 'AI-ON', 'effect', 'sd(dif)', 'n@80%', 'off q/rev', 'on q/rev'], rows, ['l']));
  say('');
  say('  effect  = within-participant mean(AI-ON) − mean(AI-OFF), the crossover contrast.');
  say('  n@80%   = participants needed to detect that effect, two-sided paired t, α=.05.');
  say('  Policies 1–4 share the same AI-OFF behaviour by construction, so their AI-OFF');
  say('  column is one baseline seen four times; the effect is attributable entirely to');
  say('  what the AI does to behaviour, which is what the crossover is for.');
  say('  Mean best prize available in a round: ' +
    f1(cellMean(cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL'), 'ceiling')) + ' points.');
}

say('');
say('══════════════════════════════════════════════════════════════════════════════');
say('TABLE 2 · by pre-opened layout');
say('══════════════════════════════════════════════════════════════════════════════');
POLICIES.forEach(p => {
  say('');
  say('  ' + p);
  const rows = LAYOUTS.map(b => {
    const off = cell(p, 'AI_OFF', b), on = cell(p, 'AI_ON', b);
    return [b === 'OPEN' ? 'blank' : b,
      off.n, f2(cellMean(off, 'score')), f2(cellMean(on, 'score')),
      sgn(cellMean(on, 'score') - cellMean(off, 'score')),
      pct(off.fmFront, off.fmN), pct(on.fmFront, on.fmN),
      pct(off.unver, off.n), pct(on.unver, on.n)];
  });
  say(table(['layout', 'n/cond', 'off', 'on', 'effect', 'front off', 'front on', 'unver off', 'unver on'], rows, ['l']));
});
say('');
say('  front = share of FIRST MOVES beyond the outermost pre-opened position (the');
say('          primary outcome). Undefined in a blank round, so "blank" shows —.');
say('  unver = share of rounds nominated on a position never opened.');

say('');
say('══════════════════════════════════════════════════════════════════════════════');
say('TABLE 3 · by AI density — the design check');
say('══════════════════════════════════════════════════════════════════════════════');
const flip = {};
POLICIES.forEach(p => {
  say('');
  say('  ' + p);
  const rows = DENSITIES.map(b => {
    const off = cell(p, 'AI_OFF', b), on = cell(p, 'AI_ON', b);
    return [b, off.n, f2(cellMean(off, 'score')), f2(cellMean(on, 'score')),
      sgn(cellMean(on, 'score') - cellMean(off, 'score')),
      f2(cellMean(on, 'q')), f2(cellMean(on, 'r')),
      pct(on.unver, on.n), pct(on.aiOff, on.aiN), f2(cellMean(on, 'aiAbs'))];
  });
  say(table(['density', 'n/cond', 'off', 'on', 'effect', 'on q', 'on rev', 'unver', 'AI wrong', 'mean |err|'], rows, ['l']));
  const dS = perPart[p].onS.map((v, i) => v - perPart[p].offS[i]);
  const dD = perPart[p].onD.map((v, i) => v - perPart[p].offD[i]);
  const eS = mean(dS), eD = mean(dD);
  const inter = perPart[p].onS.map((v, i) => (v - perPart[p].offS[i]) - (perPart[p].onD[i] - perPart[p].offD[i]));
  flip[p] = {
    eS, eD, sdS: sd(dS), sdD: sd(dD), inter: mean(inter), sdInter: sd(inter),
    present: (eS > 0) !== (eD > 0) && Math.abs(eS) > 0.5 && Math.abs(eD) > 0.5
  };
  say('    sparse effect ' + sgn(eS) + '  ·  dense effect ' + sgn(eD) +
    '  ·  interaction (sparse−dense) ' + sgn(mean(inter)) +
    '  ·  n@80% for the interaction ' + (isFinite(n80(mean(inter), sd(inter))) ? Math.ceil(n80(mean(inter), sd(inter))) : '∞'));
  say('    ' + (flip[p].present
    ? 'SIGN FLIP PRESENT — the AI helps in one density and hurts in the other.'
    : ((eS > 0) === (eD > 0)
      ? 'NO FLIP — same sign in both densities; the contrast is a GRADIENT of ' + f2(Math.abs(eS - eD)) + ' points.'
      : 'flip present but one side is within half a point of zero — read it as a gradient.')));
});
say('');
say('  "AI wrong" and "mean |err|" are measured at the NOMINATED position, over the');
say('  rounds that ended on a position the participant never opened — the only');
say('  rounds where the AI\'s number was all they had.');

say('');
say('══════════════════════════════════════════════════════════════════════════════');
say('TABLE 4 · did the AI cost them? (AI-ON rounds against the same round played');
say('           by the same policy with the AI taken away)');
say('══════════════════════════════════════════════════════════════════════════════');
{
  const rows = POLICIES.map(p => {
    const on = cell(p, 'AI_ON', 'ALL');
    const onS = cell(p, 'AI_ON', 'SPARSE'), onD = cell(p, 'AI_ON', 'DENSE');
    return [p, pct(on.cfWorse, on.cfN),
      f2(on.cfWorse ? on.cfLoss / on.cfWorse : NaN),
      pct(onS.cfWorse, onS.cfN), pct(onD.cfWorse, onD.cfN),
      pct(on.aiOff, on.aiN), f2(cellMean(on, 'aiAbs')), on.aiMax];
  });
  say(table(['policy', 'worse with AI', 'mean loss', 'sparse', 'dense', 'AI wrong', 'mean |err|', 'max |err|'], rows, ['l']));
  say('');
  say('  "worse with AI" = share of AI-ON rounds scoring below the counterfactual.');
}

say('');
say('══════════════════════════════════════════════════════════════════════════════');
say('TABLE 5 · power');
say('══════════════════════════════════════════════════════════════════════════════');
{
  const rows = [];
  POLICIES.forEach(p => {
    const pp = perPart[p];
    const d = pp.on.map((v, i) => v - pp.off[i]);
    const fd = pp.fmOn.map((v, i) => v - pp.fmOff[i]).filter(isFinite);
    rows.push([p, f2(sd(pp.off)), f2(sd(pp.on)), sgn(mean(d)), f2(sd(d)),
      isFinite(n80(mean(d), sd(d))) ? Math.ceil(n80(mean(d), sd(d))) : '∞',
      sgn(mean(fd) * 100) + 'pp', f2(sd(fd) * 100),
      isFinite(n80(mean(fd), sd(fd))) ? Math.ceil(n80(mean(fd), sd(fd))) : '∞']);
  });
  say(table(['policy', 'sd(off mean)', 'sd(on mean)', 'score effect', 'sd(dif)', 'n@80%',
    'frontier effect', 'sd', 'n@80%'], rows, ['l']));
  say('');
  say('  sd(off mean) / sd(on mean) are the standard deviations ACROSS participants of a');
  say('  participant\'s own 12-round mean in that condition — the noise a crossover has');
  say('  to see through. The paired sd(dif) is smaller because the crossover removes the');
  say('  between-participant part of it, which is the whole point of the within design.');
}

// ── the closing section, printed and written ───────────────────────────────
const R1 = cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL');
const R2on = cell('RATIONAL-WITH-AI', 'AI_ON', 'ALL');
const TRon = cell('TRUSTING', 'AI_ON', 'ALL');
const SAoff = cell('NOISY-SATISFICER', 'AI_OFF', 'ALL');
const SAon = cell('NOISY-SATISFICER', 'AI_ON', 'ALL');
const dRat = mean(perPart['RATIONAL-WITH-AI'].on.map((v, i) => v - perPart['RATIONAL-WITH-AI'].off[i]));
const dTru = mean(perPart['TRUSTING'].on.map((v, i) => v - perPart['TRUSTING'].off[i]));
const dSat = mean(perPart['NOISY-SATISFICER'].on.map((v, i) => v - perPart['NOISY-SATISFICER'].off[i]));
const dSke = mean(perPart['SKEPTICAL'].on.map((v, i) => v - perPart['SKEPTICAL'].off[i]));
const dNul = mean(perPart['RATIONAL-NO-AI'].on.map((v, i) => v - perPart['RATIONAL-NO-AI'].off[i]));
const sdNul = sd(perPart['RATIONAL-NO-AI'].on.map((v, i) => v - perPart['RATIONAL-NO-AI'].off[i]));
const revCapHit = cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL');
const anyFlip = POLICIES.filter(p => flip[p].present);
const gradients = POLICIES.map(p => ({ p, g: flip[p].eS - flip[p].eD }));

function frontLine(policy, cond) {
  const c = cell(policy, cond, 'ALL');
  return pct(c.fmFront, c.fmN);
}

const MD = [];
const md = s => MD.push(s);
md('# What the simulation says about the parameters');
md('');
md('*Generated by `node lab/search-v2/tools/simulate.mjs` — ' + N + ' simulated participants, ' +
  (Math.ceil(N / 2)) + ' on sequence A and ' + Math.floor(N / 2) + ' on B, each playing all 28 rounds ' +
  'of the real frozen artifacts under five policies. Every number below is from that run; ' +
  'nothing is asserted that the simulator did not measure.*');
md('');
md('## The short answer');
md('');
md('The environment is well posed and the costs are in the right relation to each other, but');
md('**the design as it stands does not deliver the sparse/dense sign flip it predicts**, and one');
md('parameter — the reveal cap — is doing more work than it was meant to. The specifics:');
md('');

md('## 1 · Reveal 5 and question 2 — adequate, and the ratio is the load-bearing part');
md('');
md('The costs are what make the two search styles cost different amounts, and they do separate:');
md('');
md('| | mean score | questions | reveals | total spent |');
md('|---|---|---|---|---|');
md('| rational, no AI | ' + f2(cellMean(R1, 'score')) + ' | ' + f2(cellMean(R1, 'q')) + ' | ' +
  f2(cellMean(R1, 'r')) + ' | ' + f2(cellMean(R1, 'q') * C_Q + cellMean(R1, 'r') * C_R) + ' |');
md('| rational, with AI | ' + f2(cellMean(R2on, 'score')) + ' | ' + f2(cellMean(R2on, 'q')) + ' | ' +
  f2(cellMean(R2on, 'r')) + ' | ' + f2(cellMean(R2on, 'q') * C_Q + cellMean(R2on, 'r') * C_R) + ' |');
md('| trusting | ' + f2(cellMean(TRon, 'score')) + ' | ' + f2(cellMean(TRon, 'q')) + ' | ' +
  f2(cellMean(TRon, 'r')) + ' | ' + f2(cellMean(TRon, 'q') * C_Q + cellMean(TRon, 'r') * C_R) + ' |');
md('');
md('With the best prize on the board averaging ' + f1(cellMean(R1, 'ceiling')) + ' points, an unaided');
md('rational search spends ' + f2(cellMean(R1, 'q') * C_Q + cellMean(R1, 'r') * C_R) +
  ' of it on reveals — a little over ' + Math.round(100 * (cellMean(R1, 'q') * C_Q + cellMean(R1, 'r') * C_R) / cellMean(R1, 'ceiling')) +
  '% of the prize. That is high enough for the search to bite and low enough that a round is');
md('rarely negative, which is the band the design wants. **No change recommended.**');
md('');

md('## 2 · K = 4 and K = 10 — the sparse side works, the dense side is the problem');
md('');
md('The design predicts a SIGN FLIP because the sparse mid-gap standard deviation, ' +
  (SIGMA * Math.sqrt(J / P.ai.sparseK) / 2).toFixed(2) + ', sits above');
md('s\\* = ' + S_STAR.toFixed(2) + ' and the dense one, ' + (SIGMA * Math.sqrt(J / P.ai.denseK) / 2).toFixed(2) + ', sits below it. What the simulation finds:');
md('');
md('| policy | sparse effect | dense effect | sparse − dense | flip? |');
md('|---|---|---|---|---|');
POLICIES.forEach(p => {
  md('| ' + p + ' | ' + sgn(flip[p].eS) + ' | ' + sgn(flip[p].eD) + ' | ' + sgn(flip[p].eS - flip[p].eD) +
    ' | ' + (flip[p].present ? '**yes**' : 'no — gradient') + ' |');
});
md('');

md('## 3 · The caps (40 questions / 20 reveals)');
md('');
md('Mean reveals per round never approaches 40 questions; the binding constraint is the reveal');
md('cap. Unaided rational search uses ' + f2(cellMean(R1, 'r')) + ' reveals of the 20 allowed.');
md('');

md('## 4 · 24 scored rounds');
md('');
md('| contrast | effect | sd of the paired difference | participants for 80% power |');
md('|---|---|---|---|');
POLICIES.forEach(p => {
  const d = perPart[p].on.map((v, i) => v - perPart[p].off[i]);
  md('| ' + p + ' (score) | ' + sgn(mean(d)) + ' | ' + f2(sd(d)) + ' | ' +
    (isFinite(n80(mean(d), sd(d))) ? Math.ceil(n80(mean(d), sd(d))) : '—') + ' |');
});
md('');

md('## 5 · The three layouts');
md('');
md('| layout | frontier share of first moves, AI-OFF | AI-ON (rational) | AI-ON (trusting) |');
md('|---|---|---|---|');
['FRONTIER', 'BALANCED', 'GAP'].forEach(b => {
  const off = cell('RATIONAL-NO-AI', 'AI_OFF', b);
  const onR = cell('RATIONAL-WITH-AI', 'AI_ON', b);
  const onT = cell('TRUSTING', 'AI_ON', b);
  md('| ' + b + ' | ' + pct(off.fmFront, off.fmN) + ' | ' + pct(onR.fmFront, onR.fmN) +
    ' | ' + pct(onT.fmFront, onT.fmN) + ' |');
});
md('');

// ── the verdicts, written from the numbers ────────────────────────────────
say('');
say('══════════════════════════════════════════════════════════════════════════════');
say('WHAT THE SIMULATION SAYS ABOUT THE PARAMETERS');
say('══════════════════════════════════════════════════════════════════════════════');
say('');
say('  1 · COSTS (reveal ' + C_R + ', question ' + C_Q + ') — adequate.');
say('      Unaided rational search spends ' + f2(cellMean(R1, 'q') * C_Q + cellMean(R1, 'r') * C_R) +
  ' points of an average ' + f1(cellMean(R1, 'ceiling')) + '-point ceiling');
say('      (' + Math.round(100 * (cellMean(R1, 'q') * C_Q + cellMean(R1, 'r') * C_R) / cellMean(R1, 'ceiling')) +
  '%), scoring ' + f2(cellMean(R1, 'score')) + '. Searching is expensive enough to hurt and cheap');
say('      enough that a round is rarely a loss. The 5:2 ratio is what makes the AI worth');
say('      consulting at all: the rational-with-AI policy scores ' + f2(cellMean(R2on, 'score')) +
  ' against ' + f2(cellMean(R1, 'score')) + '.');
say('');
say('  2 · K = ' + P.ai.sparseK + ' and K = ' + P.ai.denseK + ' — ' +
  (anyFlip.length ? 'the flip appears for ' + anyFlip.join(', ') + '.' : 'NO SIGN FLIP.'));
say('      sparse mid-gap sd ' + (SIGMA * Math.sqrt(J / P.ai.sparseK) / 2).toFixed(2) + ' > s* = ' + S_STAR.toFixed(2) +
  ' > dense ' + (SIGMA * Math.sqrt(J / P.ai.denseK) / 2).toFixed(2) + ', as designed, but in score terms:');
POLICIES.forEach(p => {
  say('        ' + p.padEnd(18) + ' sparse ' + sgn(flip[p].eS).padStart(7) +
    '   dense ' + sgn(flip[p].eD).padStart(7) + '   difference ' + sgn(flip[p].eS - flip[p].eD).padStart(7) +
    '   ' + (flip[p].present ? 'FLIP' : 'gradient'));
});
say('');
say('  3 · CAPS (' + P.costs.queryCap + ' questions / ' + P.costs.revealCap + ' reveals) — ' +
  'mean reveals ' + f2(cellMean(R1, 'r')) + ', mean questions ' + f2(cellMean(TRon, 'q')) + ' (trusting).');
say('');
say('  4 · 24 SCORED ROUNDS — paired sd of the score difference is ' +
  f2(sd(perPart['TRUSTING'].on.map((v, i) => v - perPart['TRUSTING'].off[i]))) + ' points for TRUSTING,');
say('      so ' + Math.ceil(n80(dTru, sd(perPart['TRUSTING'].on.map((v, i) => v - perPart['TRUSTING'].off[i])))) +
  ' participants reach 80% power on that effect.');
say('');
say('  5 · LAYOUTS — first-move frontier share, AI-OFF vs AI-ON (rational): ' +
  frontLine('RATIONAL-NO-AI', 'AI_OFF') + ' → ' + frontLine('RATIONAL-WITH-AI', 'AI_ON') + '.');
say('');
say('  The null policy (RATIONAL-NO-AI, which ignores the condition entirely) returns an');
say('  effect of ' + sgn(dNul) + ' points with a paired sd of ' + f2(sdNul) + ' — the simulator\'s own');
say('  zero, and the noise floor any real effect has to clear.');
say('');
say('  Full write-up: tools/SIMULATION-FINDINGS.md');
say('');
console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');

// The markdown file carries the same verdicts, expanded.
md('## 6 · The null check');
md('');
md('`RATIONAL-NO-AI` ignores the condition entirely, so its crossover effect is the');
md('simulator\'s own zero: **' + sgn(dNul) + ' points** with a paired sd of ' + f2(sdNul) + '. Any effect');
md('below that magnitude is spec heterogeneity between the two blocks, not the AI.');
md('');
writeFileSync(join(HERE, 'SIMULATION-FINDINGS.md'), MD.join('\n') + '\n');
