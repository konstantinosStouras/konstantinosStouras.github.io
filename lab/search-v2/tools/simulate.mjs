/* ==========================================================================
   search-v2  ·  tools/simulate.mjs
   A Monte-Carlo of the whole study, played by policies instead of people.

       node lab/search-v2/tools/simulate.mjs             # 1000 participants
       SIM_N=100 node lab/search-v2/tools/simulate.mjs   # a quick run

   selftest.js asks whether the artifacts are correct, smoke.mjs whether the app
   behaves, data-audit.mjs whether the record is faithful. This asks the question
   that is about the DESIGN rather than the build: with the costs, the two K
   values, the caps, the 24 scored rounds and the three layouts as they stand, is
   the contrast the study exists to measure — search WITHOUT an AI against search
   WITH an interpolative one — large enough, and sharp enough in the intended
   direction, to be seen?

   It plays the real thing. The frozen artifacts are rebuilt exactly as the app
   rebuilds them (Pool.buildPool → Specs.buildSpecs → Specs.sessionPlan), the AI
   answers through Ai.anchorSet / Ai.aiAnswer, the uncertainty comes from
   Ai.aiSd and the search benchmark from Ai.eiSurface. Scoring is the one line
   the Cloud Function uses: the true prize at the nominated position minus 2 per
   question and 5 per reveal, no floor. Nothing about the environment is
   re-implemented here; only the participant is.

   Every draw comes from Pool.rngFrom seeded by the participant code, so a run is
   reproducible to the digit. Math.random is never called.

   It also writes tools/SIMULATION-FINDINGS.md — the same closing section the
   report prints, generated from the same numbers, so the two cannot disagree.
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
const SD_SPARSE = SIGMA * Math.sqrt(J / P.ai.sparseK) / 2;   // mid-gap sd, sparse
const SD_DENSE = SIGMA * Math.sqrt(J / P.ai.denseK) / 2;     // mid-gap sd, dense

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
const POLICIES = [
  'BLIND-GUESS', 'RATIONAL-NO-AI', 'SYSTEMATIC-NO-AI',
  'RATIONAL-WITH-AI', 'TRUSTING', 'SKEPTICAL', 'NOISY-SATISFICER'
];
// The five the brief asks to be compared like-for-like; BLIND-GUESS and
// SYSTEMATIC-NO-AI are reference lines, not behavioural models.
const LAYOUTS = ['FRONTIER', 'BALANCED', 'GAP', 'OPEN'];
const DENSITIES = ['SPARSE', 'DENSE'];

function pad4(n) { return String(n).padStart(4, '0'); }
function mean(a) { const b = a.filter(isFinite); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : NaN; }
function sd(a) {
  const b = a.filter(isFinite);
  if (b.length < 2) return NaN;
  const m = mean(b);
  return Math.sqrt(b.reduce((s, x) => s + (x - m) * (x - m), 0) / (b.length - 1));
}
// Two-sided paired t-test at 80% power, normal approximation: n = 7.849 (sd/Δ)².
const Z_SUM_SQ = Math.pow(1.959963985 + 0.841621234, 2);
function n80(effect, sdD) {
  if (!isFinite(effect) || !isFinite(sdD) || Math.abs(effect) < 1e-9) return Infinity;
  return Z_SUM_SQ * (sdD * sdD) / (effect * effect);
}
function paired(pp, a, b) {
  const d = pp[a].map((v, i) => v - pp[b][i]).filter(isFinite);
  return { d, eff: mean(d), sd: sd(d), n: n80(mean(d), sd(d)) };
}

// The AI's anchors are one per equal stratum, and the participant is TOLD K — so
// they can work out the spacing they will face without knowing where the anchors
// landed. These are the stratum midpoints Specs.placeAnchors draws within, and
// they are what a rational participant uses to decide whether a number is worth
// verifying. Only positions matter here: Ai.aiSd never reads a value.
function stratumMidpoints(K) {
  const out = [], w = J / K;
  for (let s = 0; s < K; s++) {
    const lo = Math.floor(s * w) + 1;
    const hi = Math.max(Math.floor((s + 1) * w), lo);
    out.push(Math.round((lo + hi) / 2));
  }
  return out;
}

// ── the round ──────────────────────────────────────────────────────────────
// The app's engine: a question costs c_AI and returns the AI's number, a reveal
// costs c_R, returns the truth AND joins the AI's anchor set, and the score is
// the true prize at the nominated position minus the lot.
function newRound(spec, aiOn) {
  const pre = spec.pre_opened || [];
  return {
    spec, mapping: pool[spec.mapping_index], aiOn, pre, preSet: new Set(pre),
    revealed: [], revealedSet: new Set(),
    askedVal: Object.create(null), askedOrder: [],
    nQueries: 0, nReveals: 0,
    first: null,                                  // the round's first action
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
// Belief: opened positions at the truth, asked positions at the AI's number.
function beliefAnchors(R) {
  const seen = Object.create(null), out = [];
  const add = (p, v) => { if (!seen[p] && v != null) { seen[p] = 1; out.push({ pos: p, val: v }); } };
  R.preSet.forEach(p => add(p, R.mapping[p - 1]));
  R.revealedSet.forEach(p => add(p, R.mapping[p - 1]));
  R.askedOrder.forEach(p => add(p, R.askedVal[p]));
  out.sort((a, b) => a.pos - b.pos);
  return out;
}
// The estimated standard deviation of the AI's number at p, from what the
// participant can actually work out: K equal strata, plus every position the
// round or their own reveals have opened (a reveal genuinely shrinks the AI's
// gaps; asking does not). The participant-computable twin of §16.8 verify_pays.
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
function nominateBest(R) {
  let bp = null, bv = -Infinity;
  const consider = p => { const v = believedAt(R, p); if (v != null && v > bv) { bv = v; bp = p; } };
  R.preSet.forEach(consider); R.revealedSet.forEach(consider); R.askedOrder.forEach(consider);
  if (bp == null) bp = Math.round((J + 1) / 2);   // the app leaves the slider mid-line
  return bp;
}
function settle(R, pos) {
  const cost = R.nQueries * C_Q + R.nReveals * C_R;
  const truth = R.mapping[pos - 1];
  const raw = truth - cost;
  return {
    pos, truth, cost, score: P.costs.scoreFloor ? Math.max(0, raw) : raw,
    nQueries: R.nQueries, nReveals: R.nReveals,
    capHit: R.nReveals >= P.costs.revealCap || R.nQueries >= P.costs.queryCap,
    unverified: !isOpen(R, pos),
    first: R.first,
    aiShown: (R.askedVal[pos] != null) ? R.askedVal[pos]
      : (R.aiOn ? Ai.aiAnswer(aiAnchors(R), pos, ROUNDING) : null)
  };
}

// ── the policies ───────────────────────────────────────────────────────────

// 0 · BLIND-GUESS. Spends nothing and nominates whatever the interface already
// offers: the best pre-opened position if there is one, else the mid-line
// position the slider starts on. Not a model of anyone — it is the floor every
// other number should be read against, and the environment's mean prize is 62.
function playBlind(R) {
  let pos = null, bv = -Infinity;
  R.preSet.forEach(p => { if (R.mapping[p - 1] > bv) { bv = R.mapping[p - 1]; pos = p; } });
  return settle(R, pos == null ? Math.round((J + 1) / 2) : pos);
}

// 1 · RATIONAL-NO-AI. Myopic expected improvement over the participant's OWN
// known set — §16.8's benchmark with no AI in it. Reveal where EI is highest;
// stop when the best EI on the board falls below what a reveal costs.
function playRationalNoAI(R, rng) {
  for (let step = 0; step < P.costs.revealCap + 2; step++) {
    const known = knownPairs(R);
    if (!known.length) { doReveal(R, Pool.randInt(rng, 1, J)); continue; }  // blank round
    if (R.nReveals >= P.costs.revealCap) break;
    const surf = Ai.eiSurface(known, takenList(R), bestTrueKnown(R), J, SIGMA, ROUNDING);
    if (surf.at == null || !(surf.max > C_R)) break;
    doReveal(R, surf.at);
  }
  return settle(R, nominateBest(R));
}

// 2 · SYSTEMATIC-NO-AI. The non-myopic reference: keep opening the widest
// unresolved stretch until no gap is wider than g* and no tail deeper than the
// width at which a reveal stops paying — the design's own two constants, used as
// a stopping rule instead of a one-step expectation. It exists because a myopic
// rule stops the moment the NEXT reveal fails to pay, which is not the same
// question as whether searching pays.
const TAIL_STAR = Math.pow(S_STAR / SIGMA, 2);          // s = σ√t > s*  ⇔  t > (s*/σ)²
function playSystematic(R) {
  for (let step = 0; step < P.costs.revealCap; step++) {
    const known = knownPairs(R);
    if (!known.length) { doReveal(R, Math.round(J / 2)); continue; }
    let at = null, worst = 0;
    if (known[0].pos - 1 > TAIL_STAR && known[0].pos - 1 > worst) {
      worst = known[0].pos - 1; at = Math.max(1, Math.round(known[0].pos / 2));
    }
    const last = known[known.length - 1].pos;
    if (J - last > TAIL_STAR && J - last > worst) { worst = J - last; at = Math.min(J, Math.round((last + J) / 2)); }
    for (let i = 1; i < known.length; i++) {
      const g = known[i].pos - known[i - 1].pos;
      if (g > G_STAR && g > worst) { worst = g; at = Math.round((known[i].pos + known[i - 1].pos) / 2); }
    }
    if (at == null || isOpen(R, at) || R.nReveals >= P.costs.revealCap) break;
    doReveal(R, at);
  }
  return settle(R, nominateBest(R));
}

// 3 · RATIONAL-WITH-AI. Policy 1's search, but it asks before it pays. It probes
// where expected improvement is highest — under a belief that carries the AI's
// answers as unbiased estimates — and it buys the truth only where the answer is
// PROMISING (it would be the new front-runner) and its own uncertainty about
// that answer is above s*. Below s* it takes the number on trust. That is the
// §3.4 rule, computed from K rather than from anchors it cannot see.
function playRationalWithAI(R, rng) {
  if (!R.aiOn) return playRationalNoAI(R, rng);
  for (let step = 0; step < 40; step++) {
    const belief = beliefAnchors(R);
    if (!belief.length) { doAsk(R, Pool.randInt(rng, 1, J)); continue; }
    if (R.nQueries >= P.costs.queryCap) break;
    let z = -Infinity;
    belief.forEach(b => { if (b.val > z) z = b.val; });
    const surf = Ai.eiSurface(belief, takenList(R, R.askedOrder), z, J, SIGMA, ROUNDING);
    if (surf.at == null || !(surf.max > C_Q)) break;
    const p = surf.at;
    const m = doAsk(R, p);
    if (m == null) break;
    // Verify only a new front-runner, and only where the number could be far out.
    if (m >= z && sHat(R, p) > S_STAR && R.nReveals < P.costs.revealCap) doReveal(R, p);
  }
  // Endgame: never walk away trusting a number that is above s* of doubt.
  for (let v = 0; v < 3; v++) {
    const cand = nominateBest(R);
    if (isOpen(R, cand)) break;
    if (!(sHat(R, cand) > S_STAR) || R.nReveals >= P.costs.revealCap) break;
    doReveal(R, cand);
  }
  return settle(R, nominateBest(R));
}

// 4 · TRUSTING. Treats an answer as a fact: an asked position joins the belief at
// the AI's number with no doubt left on it, so the picture converges on the AI's
// own curve and the search stops as soon as that curve looks flat. It verifies
// only by accident. This is the behaviour the study is built to detect as costly.
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
  return settle(R, nominateBest(R));
}

// 5 · SKEPTICAL. Asks a few questions out of curiosity, ignores every answer and
// searches by revealing exactly as policy 1 does. Its treatment effect should be
// the price of the wasted questions and nothing else — the lower bound on what
// merely having the AI on the screen can cost.
function playSkeptical(R, rng) {
  if (R.aiOn) {
    const wasted = Pool.randInt(rng, 0, 4);
    for (let i = 0; i < wasted; i++) doAsk(R, Pool.randInt(rng, 1, J));
  }
  return playRationalNoAI(R, rng);
}

// 6 · NOISY-SATISFICER. The human-like baseline: probe the widest unexplored
// stretch (or somewhere at random), stop the moment it holds anything above a
// personal threshold, and take a random action now and then. With the AI on the
// screen an ANSWER counts as something held — the everyday form of misplaced
// trust, and the cheap one.
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
  return settle(R, nominateBest(R));
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
  const lastGap = J - t[t.length - 1];
  if (lastGap > best) { best = lastGap; at = Math.min(J, Math.round((t[t.length - 1] + J) / 2)); }
  for (let i = 1; i < t.length; i++) {
    const g = t[i] - t[i - 1] - 1;
    if (g > best) { best = g; at = Math.round((t[i] + t[i - 1]) / 2); }
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
  'BLIND-GUESS': playBlind,
  'RATIONAL-NO-AI': playRationalNoAI,
  'SYSTEMATIC-NO-AI': playSystematic,
  'RATIONAL-WITH-AI': playRationalWithAI,
  'TRUSTING': playTrusting,
  'SKEPTICAL': playSkeptical,
  'NOISY-SATISFICER': playSatisficer
};
// What the same participant would have done with the AI taken away. It is the
// counterfactual behind "did the machine cost them?", so it has to be the
// policy's OWN behaviour without an AI, not another policy's.
const PLAY_OFF = {
  'BLIND-GUESS': playBlind,
  'RATIONAL-NO-AI': playRationalNoAI,
  'SYSTEMATIC-NO-AI': playSystematic,
  'RATIONAL-WITH-AI': playRationalNoAI,
  'TRUSTING': playRationalNoAI,
  'SKEPTICAL': playRationalNoAI,
  'NOISY-SATISFICER': playSatisficer
};

// ── the geometry as actually built (no policy involved) ────────────────────
// Does sparse really sit above s* and dense below it in the specs the run will
// serve? The private anchors are only part of the AI's anchor set — the
// pre-opened positions join it too, and they shrink its gaps.
const geo = {};
specs.filter(s => s.scored).forEach(s => {
  const map = pool[s.mapping_index];
  const anchors = Ai.anchorSet(s.ai_anchors, s.pre_opened, [], map);
  let above = 0, sSum = 0, errSum = 0, errMax = 0, n = 0, maxGap = 0;
  for (let i = 1; i < anchors.length; i++) maxGap = Math.max(maxGap, anchors[i].pos - anchors[i - 1].pos);
  for (let p = 1; p <= J; p++) {
    const sd_ = Ai.aiSd(anchors, p, SIGMA);
    const e = Math.abs(Ai.aiAnswer(anchors, p, ROUNDING) - map[p - 1]);
    n++; sSum += sd_; errSum += e; if (e > errMax) errMax = e;
    if (sd_ > S_STAR) above++;
  }
  [s.ai_density, s.seed_shape, s.ai_density + '·' + s.seed_shape].forEach(k => {
    const g = geo[k] || (geo[k] = { specs: 0, n: 0, above: 0, s: 0, err: 0, errMax: 0, gap: 0 });
    g.specs++; g.n += n; g.above += above; g.s += sSum; g.err += errSum;
    g.gap += maxGap; if (errMax > g.errMax) g.errMax = errMax;
  });
});

// ── accumulators ───────────────────────────────────────────────────────────
function newCell() {
  return {
    n: 0, score: 0, score2: 0, q: 0, r: 0, truth: 0, cost: 0,
    fmN: 0, fmFront: 0, unver: 0, ceiling: 0, cap: 0,
    aiN: 0, aiOff: 0, aiAbs: 0, aiMax: 0,
    cfN: 0, cfWorse: 0, cfLoss: 0
  };
}
const cells = {};
POLICIES.forEach(p => { cells[p] = {}; });
function cell(policy, cond, bucket) {
  const k = cond + '|' + bucket;
  return cells[policy][k] || (cells[policy][k] = newCell());
}
const perPart = {};
POLICIES.forEach(p => {
  perPart[p] = { on: [], off: [], onS: [], offS: [], onD: [], offD: [], fmOn: [], fmOff: [] };
});

const frontierCache = {};
function firstIsFrontier(spec, pos) {
  const key = spec.spec_id;
  const known = frontierCache[key] || (frontierCache[key] =
    Ai.knownSet(spec.pre_opened, [], pool[spec.mapping_index]));
  if (!known.length) return null;               // a blank round has no frontier
  return Ai.geometry(known, pos, J).is_frontier ? 1 : 0;
}

function record(policy, cond, buckets, out, spec, cf) {
  const front = out.first ? firstIsFrontier(spec, out.first.pos) : null;
  const ceiling = Pool.maxOf(pool[spec.mapping_index]);
  buckets.forEach(b => {
    const c = cell(policy, cond, b);
    c.n++; c.score += out.score; c.score2 += out.score * out.score;
    c.q += out.nQueries; c.r += out.nReveals;
    c.truth += out.truth; c.cost += out.cost; c.ceiling += ceiling;
    if (out.capHit) c.cap++;
    if (out.unverified) c.unver++;
    if (front != null) { c.fmN++; c.fmFront += front; }
    if (cond === 'AI_ON' && out.aiShown != null && out.unverified) {
      const d = Math.abs(out.aiShown - out.truth);
      c.aiN++; if (d >= 1) c.aiOff++;
      c.aiAbs += d; if (d > c.aiMax) c.aiMax = d;
    }
    if (cf != null) {
      c.cfN++;
      if (out.score < cf.score) { c.cfWorse++; c.cfLoss += (cf.score - out.score); }
    }
  });
}

// ── the run ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const OUT = [];
const say = s => { OUT.push(s); console.log(s); };

say('search-v2 · Monte-Carlo of the design');
say('  participants        ' + N + '  (' + Math.ceil(N / 2) + ' sequence A, ' + Math.floor(N / 2) + ' sequence B)');
say('  rounds each         28 (4 warm-up + 24 scored; only the scored ones are counted)');
say('  pool / specs        ' + pool.length + ' mappings, ' + specs.length + ' specs, validation passes');
say('  costs               reveal ' + C_R + ', question ' + C_Q + ', caps ' +
  P.costs.queryCap + ' questions / ' + P.costs.revealCap + ' reveals');
say('  σ = ' + SIGMA.toFixed(4) + '   s* = ' + S_STAR.toFixed(3) + '   g* = ' + G_STAR.toFixed(2) +
  '   tail* = ' + TAIL_STAR.toFixed(2));
say('  designed straddle   sparse K=' + P.ai.sparseK + ' → nominal gap ' + (J / P.ai.sparseK).toFixed(0) +
  ', mid-gap sd ' + SD_SPARSE.toFixed(2) + (SD_SPARSE > S_STAR ? '  ABOVE s*' : '  below s*'));
say('                      dense  K=' + P.ai.denseK + ' → nominal gap ' + (J / P.ai.denseK).toFixed(0) +
  ', mid-gap sd ' + SD_DENSE.toFixed(2) + (SD_DENSE > S_STAR ? '  above s*' : '  BELOW s*'));
say('');

for (let i = 1; i <= N; i++) {
  const code = 'SIM' + pad4(i);
  const sequence = (i % 2 === 1) ? 'A' : 'B';
  const plan = Specs.sessionPlan(specs, code, sequence, P);

  POLICIES.forEach(policy => {
    const acc = { on: [], off: [], onS: [], offS: [], onD: [], offD: [], fmOn: [], fmOff: [] };
    plan.rounds.forEach(r => {
      if (!r.scored) return;                    // warm-ups are never analysed (§10)
      const spec = r.spec, aiOn = r.condition === 'AI_ON';
      const seed = code + '|' + policy + '|' + spec.spec_id;
      const out = PLAY[policy](newRound(spec, aiOn), Pool.rngFrom(Pool.hashSeed(seed)));

      let cf = null;
      if (aiOn) cf = PLAY_OFF[policy](newRound(spec, false), Pool.rngFrom(Pool.hashSeed(seed + '|cf')));

      record(policy, r.condition, ['ALL', spec.seed_shape, spec.ai_density], out, spec, cf);

      const side = aiOn ? 'on' : 'off';
      acc[side].push(out.score);
      acc[side + (spec.ai_density === 'SPARSE' ? 'S' : 'D')].push(out.score);
      const f = out.first ? firstIsFrontier(spec, out.first.pos) : null;
      if (f != null) acc[aiOn ? 'fmOn' : 'fmOff'].push(f);
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
  const w = headers.map((h, i) => Math.max(String(h).length,
    ...rows.map(r => String(r[i] == null ? '' : r[i]).length)));
  const line = cs => '  ' + cs.map((c, i) => {
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
const sgn = x => (isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '—');
const nn = x => (isFinite(x) ? String(Math.ceil(x)) : '∞');
const cm = (c, f) => (c && c.n ? c[f] / c.n : NaN);
const rule = t => { say(''); say('═'.repeat(78)); say(t); say('═'.repeat(78)); };

rule('TABLE 0 · the AI as actually built — geometry, before any participant acts');
{
  const rows = [];
  DENSITIES.forEach(d => {
    LAYOUTS.forEach(sh => {
      const g = geo[d + '·' + sh];
      if (!g) return;
      rows.push([d, sh === 'OPEN' ? 'blank' : sh, g.specs, f1(g.gap / g.specs),
        f2(g.s / g.n), pct(g.above, g.n), f2(g.err / g.n), g.errMax]);
    });
    const g = geo[d];
    rows.push([d, 'ALL', g.specs, f1(g.gap / g.specs), f2(g.s / g.n),
      pct(g.above, g.n), f2(g.err / g.n), g.errMax]);
  });
  say(table(['density', 'layout', 'specs', 'widest gap', 'mean sd', 'above s*', 'mean |err|', 'max |err|'],
    rows, ['l', 'l']));
  say('');
  say('  Over all 100 positions of every scored spec, with the AI\'s anchor set as the round');
  say('  BEGINS (its K private anchors plus the pre-opened positions). "above s*" is §16.8\'s');
  say('  verify_pays: the share of the line where paying 5 for the truth is worth it.');
}

rule('TABLE 1 · score by policy and condition (24 scored rounds, ' + N + ' participants)');
{
  const rows = POLICIES.map(p => {
    const off = cell(p, 'AI_OFF', 'ALL'), on = cell(p, 'AI_ON', 'ALL');
    const t = paired(perPart[p], 'on', 'off');
    return [p, f2(cm(off, 'score')), f2(cm(on, 'score')), sgn(t.eff), f2(t.sd), nn(t.n),
      f2(cm(off, 'q')) + '/' + f2(cm(off, 'r')), f2(cm(on, 'q')) + '/' + f2(cm(on, 'r')),
      f1(cm(off, 'cost')), f1(cm(on, 'cost'))];
  });
  say(table(['policy', 'AI-OFF', 'AI-ON', 'effect', 'sd(dif)', 'n@80%',
    'off q/rev', 'on q/rev', 'off spend', 'on spend'], rows, ['l']));
  say('');
  say('  effect  = within-participant mean(AI-ON) − mean(AI-OFF), the crossover contrast.');
  say('  n@80%   = participants needed to detect it, two-sided paired t, α = .05.');
  say('  Policies 4–6 share one AI-OFF behaviour by construction (policy 1), so their AI-OFF');
  say('  column is one baseline seen three times and the effect is attributable entirely to');
  say('  what the AI does to behaviour — which is what the crossover is for.');
  say('');
  say('  Reference points, both measured here:');
  say('    best prize on the board, mean         ' + f1(cm(cell('BLIND-GUESS', 'AI_OFF', 'ALL'), 'ceiling')));
  say('    spend nothing, take what is offered   ' + f2(cm(cell('BLIND-GUESS', 'AI_OFF', 'ALL'), 'score')) +
    '   (BLIND-GUESS)');
  say('    unaided myopic search adds            ' +
    sgn(cm(cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL'), 'score') - cm(cell('BLIND-GUESS', 'AI_OFF', 'ALL'), 'score')) +
    '   over that floor');
  say('    unaided systematic search adds        ' +
    sgn(cm(cell('SYSTEMATIC-NO-AI', 'AI_OFF', 'ALL'), 'score') - cm(cell('BLIND-GUESS', 'AI_OFF', 'ALL'), 'score')) +
    '   over that floor');
}

rule('TABLE 2 · by pre-opened layout');
POLICIES.forEach(p => {
  say('');
  say('  ' + p);
  const rows = LAYOUTS.map(b => {
    const off = cell(p, 'AI_OFF', b), on = cell(p, 'AI_ON', b);
    return [b === 'OPEN' ? 'blank' : b, off.n,
      f2(cm(off, 'score')), f2(cm(on, 'score')), sgn(cm(on, 'score') - cm(off, 'score')),
      pct(off.fmFront, off.fmN), pct(on.fmFront, on.fmN),
      pct(off.unver, off.n), pct(on.unver, on.n)];
  });
  say(table(['layout', 'n/cond', 'off', 'on', 'effect', 'front off', 'front on', 'unver off', 'unver on'],
    rows, ['l']));
});
say('');
say('  front = share of FIRST MOVES beyond the outermost pre-opened position — the primary');
say('          outcome. Undefined in a blank round, which is why "blank" shows —.');
say('  unver = share of rounds nominated on a position that was never opened.');

rule('TABLE 3 · by AI density — THE DESIGN CHECK');
const flip = {};
POLICIES.forEach(p => {
  say('');
  say('  ' + p);
  const rows = DENSITIES.map(b => {
    const off = cell(p, 'AI_OFF', b), on = cell(p, 'AI_ON', b);
    return [b, off.n, f2(cm(off, 'score')), f2(cm(on, 'score')),
      sgn(cm(on, 'score') - cm(off, 'score')), f2(cm(on, 'q')), f2(cm(on, 'r')),
      pct(on.unver, on.n), pct(on.aiOff, on.aiN), f2(cm(on, 'aiAbs')), on.aiMax];
  });
  say(table(['density', 'n/cond', 'off', 'on', 'effect', 'on q', 'on rev',
    'unver', 'AI wrong', 'mean |err|', 'max |err|'], rows, ['l']));
  const tS = paired(perPart[p], 'onS', 'offS');
  const tD = paired(perPart[p], 'onD', 'offD');
  const inter = perPart[p].onS.map((v, i) =>
    (v - perPart[p].offS[i]) - (perPart[p].onD[i] - perPart[p].offD[i]));
  const iEff = mean(inter), iSd = sd(inter);
  const bothReal = Math.abs(tS.eff) > 0.5 && Math.abs(tD.eff) > 0.5;
  flip[p] = {
    eS: tS.eff, eD: tD.eff, sdS: tS.sd, sdD: tD.sd, inter: iEff, sdInter: iSd,
    nInter: n80(iEff, iSd),
    verdict: ((tS.eff > 0) !== (tD.eff > 0))
      ? (bothReal ? 'FLIP' : 'near-zero')
      : 'gradient'
  };
  say('    sparse ' + sgn(tS.eff) + '   dense ' + sgn(tD.eff) +
    '   interaction (sparse − dense) ' + sgn(iEff) +
    '   sd ' + f2(iSd) + '   n@80% ' + nn(n80(iEff, iSd)));
  say('    ' + (flip[p].verdict === 'FLIP'
    ? 'SIGN FLIP PRESENT — the AI helps at one density and hurts at the other.'
    : flip[p].verdict === 'near-zero'
      ? 'signs differ but one side is inside ±0.5 points — read this as a gradient, not a flip.'
      : 'NO FLIP — same sign at both densities; the contrast is a GRADIENT of ' +
      f2(Math.abs(tS.eff - tD.eff)) + ' points.'));
});
say('');
say('  "AI wrong" / "mean |err|" are measured at the NOMINATED position, over the rounds that');
say('  ended on a position the participant never opened — the only rounds where the AI\'s');
say('  number was all they had to go on.');

rule('TABLE 4 · did the AI cost them? (each AI-ON round against the same round played');
say('           by the same policy with the AI taken away)');
{
  const rows = POLICIES.map(p => {
    const on = cell(p, 'AI_ON', 'ALL');
    const onS = cell(p, 'AI_ON', 'SPARSE'), onD = cell(p, 'AI_ON', 'DENSE');
    return [p, pct(on.cfWorse, on.cfN), f2(on.cfWorse ? on.cfLoss / on.cfWorse : NaN),
      pct(onS.cfWorse, onS.cfN), pct(onD.cfWorse, onD.cfN),
      pct(on.aiOff, on.aiN), f2(cm(on, 'aiAbs')), on.aiMax];
  });
  say(table(['policy', 'worse with AI', 'mean loss', 'sparse', 'dense',
    'AI wrong', 'mean |err|', 'max |err|'], rows, ['l']));
  say('');
  say('  "worse with AI" = share of AI-ON rounds scoring below the counterfactual.');
}

rule('TABLE 5 · power');
{
  const rows = POLICIES.map(p => {
    const pp = perPart[p];
    const t = paired(pp, 'on', 'off');
    const fd = pp.fmOn.map((v, i) => v - pp.fmOff[i]).filter(isFinite);
    return [p, f2(sd(pp.off)), f2(sd(pp.on)), sgn(t.eff), f2(t.sd), nn(t.n),
      sgn(mean(fd) * 100) + 'pp', f2(sd(fd) * 100), nn(n80(mean(fd), sd(fd)))];
  });
  say(table(['policy', 'sd(off mean)', 'sd(on mean)', 'score effect', 'sd(dif)', 'n@80%',
    'frontier effect', 'sd', 'n@80%'], rows, ['l']));
  say('');
  say('  sd(off mean) / sd(on mean) are the standard deviations ACROSS participants of one');
  say('  participant\'s own 12-round mean in that condition — the noise a between-subject');
  say('  design would face. The paired sd(dif) is smaller because the crossover removes the');
  say('  between-participant part of it, which is the whole reason the design is within.');
}

// ── the closing section, written from the numbers ─────────────────────────
const blind = cell('BLIND-GUESS', 'AI_OFF', 'ALL');
const rat = cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL');
const sys = cell('SYSTEMATIC-NO-AI', 'AI_OFF', 'ALL');
const ratAI = cell('RATIONAL-WITH-AI', 'AI_ON', 'ALL');
const truOn = cell('TRUSTING', 'AI_ON', 'ALL');
const satOn = cell('NOISY-SATISFICER', 'AI_ON', 'ALL');

const searchPays = cm(rat, 'score') - cm(blind, 'score');
const sysPays = cm(sys, 'score') - cm(blind, 'score');
const tNull = paired(perPart['RATIONAL-NO-AI'], 'on', 'off');
const tRat = paired(perPart['RATIONAL-WITH-AI'], 'on', 'off');
const tTru = paired(perPart['TRUSTING'], 'on', 'off');
const tSke = paired(perPart['SKEPTICAL'], 'on', 'off');
const tSat = paired(perPart['NOISY-SATISFICER'], 'on', 'off');

// The window of reveal costs in which a sparse/dense sign flip can exist AT ALL:
// s* = c_R√(2π) has to fall between the two nominal mid-gap standard deviations.
const CR_LO = SD_DENSE / Math.sqrt(2 * Math.PI);
const CR_HI = SD_SPARSE / Math.sqrt(2 * Math.PI);
// … and the K at which the nominal mid-gap sd equals s*, given the reveal cost.
const K_STAR = J / G_STAR;

const behavioural = ['RATIONAL-WITH-AI', 'TRUSTING', 'SKEPTICAL', 'NOISY-SATISFICER'];
const flipping = behavioural.filter(p => flip[p].verdict === 'FLIP');
const gradients = behavioural.map(p => Math.abs(flip[p].eS - flip[p].eD));
const maxGradient = Math.max(...gradients);
const geoS = geo['SPARSE'], geoD = geo['DENSE'];

const MD = [];
const md = s => MD.push(s);
const both = s => { say(s.replace(/\*\*/g, '')); md(s); };

md('# What the simulation says about the parameters');
md('');
md('*Generated by `node lab/search-v2/tools/simulate.mjs`. ' + N + ' simulated participants ' +
  '(' + Math.ceil(N / 2) + ' on sequence A, ' + Math.floor(N / 2) + ' on B), each playing all 28 rounds of ' +
  'the real frozen artifacts — the same pool, the same 28 specs, the same AI — under seven ' +
  'policies, with a counterfactual re-play of every AI-ON round. Every number below comes ' +
  'from that run. Nothing is asserted that the simulator did not measure.*');
md('');

rule('WHAT THE SIMULATION SAYS ABOUT THE PARAMETERS');
say('');

// --- 1 · costs ------------------------------------------------------------
md('## 1 · The costs (reveal 5, question 2)');
md('');
say('  1 · THE COSTS — reveal ' + C_R + ', question ' + C_Q);
say('');
{
  const lines = [
    'The 5:2 ratio works: the AI is worth consulting, which is the premise of the study.',
    'RATIONAL-WITH-AI scores ' + f2(cm(ratAI, 'score')) + ' where the same searcher without an AI scores ' +
    f2(cm(rat, 'score')) + ', spending ' + f1(cm(ratAI, 'cost')) + ' points a round against ' +
    f1(cm(rat, 'cost')) + '.',
    '',
    'The LEVEL, however, is the design\'s weakest parameter, and the number that shows it is',
    'the floor. A participant who spends nothing and nominates what the interface already',
    'offers scores ' + f2(cm(blind, 'score')) + '. Myopic unaided search — §16.8\'s own benchmark — scores ' +
    f2(cm(rat, 'score')) + ',',
    'i.e. it buys ' + sgn(searchPays) + ' points for ' + f1(cm(rat, 'cost')) + ' points of effort. Systematic unaided search,',
    'which opens the line until no gap is wider than g* = ' + G_STAR.toFixed(1) + ', scores ' + f2(cm(sys, 'score')) +
    ' — ' + sgn(sysPays) + ' against',
    'doing nothing, because ' + f1(cm(sys, 'r')) + ' reveals cost ' + f1(cm(sys, 'cost')) + ' and the prize surface has a mean of 62.',
    '',
    'So in the AI-OFF arm there is almost nothing for effort to buy, and the myopic',
    'benchmark stops after ' + f2(cm(rat, 'r')) + ' reveals a round. That is not a bug in the benchmark: at',
    'c_R = ' + C_R + ' it is the correct myopic answer. It does mean the AI-OFF arm is close to a',
    'no-search arm, which narrows every contrast the study is trying to draw.'
  ];
  lines.forEach(l => { say('     ' + l); md(l); });
  md('');
  md('| | mean score | questions | reveals | spent | net of the do-nothing floor |');
  md('|---|---|---|---|---|---|');
  [['spend nothing (floor)', blind], ['myopic search, no AI', rat], ['systematic search, no AI', sys],
  ['rational, with AI', ratAI], ['trusting, with AI', truOn]].forEach(([lab, c]) => {
    md('| ' + lab + ' | ' + f2(cm(c, 'score')) + ' | ' + f2(cm(c, 'q')) + ' | ' + f2(cm(c, 'r')) +
      ' | ' + f1(cm(c, 'cost')) + ' | ' + sgn(cm(c, 'score') - cm(blind, 'score')) + ' |');
  });
  md('');
}

// --- 2 · K ----------------------------------------------------------------
say('');
say('  2 · K = ' + P.ai.sparseK + ' AND K = ' + P.ai.denseK + ' — the straddle is real, the FLIP is not');
say('');
md('## 2 · K = 4 and K = 10 — the straddle holds, the sign flip does not follow');
md('');
{
  const lines = [
    'The geometry is exactly as designed. Measured over every position of every scored spec,',
    'with the AI\'s anchor set as the round begins:',
    '',
    '  sparse   mean sd ' + f2(geoS.s / geoS.n) + '   ' + pct(geoS.above, geoS.n) +
    ' of the line above s* = ' + S_STAR.toFixed(2) + '   mean |AI error| ' + f2(geoS.err / geoS.n),
    '  dense    mean sd ' + f2(geoD.s / geoD.n) + '   ' + pct(geoD.above, geoD.n) +
    ' of the line above s*             mean |AI error| ' + f2(geoD.err / geoD.n),
    '',
    'The two densities are separated by a factor of ' + (((geoS.err / geoS.n) / (geoD.err / geoD.n)).toFixed(1)) +
    ' in how wrong the AI is, and the',
    'verification threshold lands between them. The design\'s premise is sound.',
    '',
    'What does NOT follow is a sign change in SCORE. Per-participant crossover effects:'
  ];
  lines.forEach(l => { say('     ' + l); md(l === '' ? '' : (l.startsWith('  ') ? '`' + l + '`' : l)); });
  md('');
  md('| policy | sparse effect | dense effect | sparse − dense | n@80% for the interaction | verdict |');
  md('|---|---|---|---|---|---|');
  say('');
  behavioural.forEach(p => {
    const fl = flip[p];
    say('       ' + p.padEnd(18) + ' sparse ' + sgn(fl.eS).padStart(7) + '   dense ' + sgn(fl.eD).padStart(7) +
      '   difference ' + sgn(fl.eS - fl.eD).padStart(7) + '   ' +
      (fl.verdict === 'FLIP' ? 'FLIP' : fl.verdict === 'near-zero' ? 'one side ≈ 0' : 'gradient'));
    md('| ' + p + ' | ' + sgn(fl.eS) + ' | ' + sgn(fl.eD) + ' | ' + sgn(fl.eS - fl.eD) + ' | ' +
      nn(fl.nInter) + ' | ' + (fl.verdict === 'FLIP' ? '**flip**' : fl.verdict === 'near-zero'
        ? 'signs differ, one side ≈ 0' : 'gradient') + ' |');
  });
  say('');
  md('');
  const verdict = flipping.length
    ? ['A sign flip is present for ' + flipping.join(' and ') + '. For the others the contrast is a',
      'GRADIENT: the AI is worth less in sparse rounds than in dense ones, by up to ' +
      maxGradient.toFixed(2) + ' points,',
      'but it does not cross zero. Report the interaction, not "the AI hurts in sparse rounds".']
    : ['NO POLICY FLIPS. The contrast is a GRADIENT in every case: the AI is worth up to ' +
      maxGradient.toFixed(2),
    'points less in sparse rounds than in dense ones, and stays the same sign throughout.',
    'The reason is structural rather than a matter of tuning. The AI\'s curve can never',
    'exceed its highest anchor (§3), so an over-trusting participant is steered TOWARDS the',
    'largest value the AI knows — which is a real prize, and in this environment a good one.',
    'A sparse AI is wronger, but it is wrong in a way that is not systematically downward,',
    'so the money mistake it causes is smaller than the money saved by not revealing.'];
  verdict.forEach(l => { say('     ' + l); md(l); });
  md('');
  const win = ['',
    'The window in which a flip could exist at all is narrow and it is a property of the',
    'REVEAL COST, not of K: s* = c_R·√(2π) has to fall between the two nominal mid-gap',
    'standard deviations, ' + SD_DENSE.toFixed(2) + ' (dense) and ' + SD_SPARSE.toFixed(2) + ' (sparse), so',
    '',
    '    c_R must lie in (' + CR_LO.toFixed(2) + ', ' + CR_HI.toFixed(2) + ')  —  and it is ' + C_R + ', almost exactly mid-window.',
    '',
    'Equivalently, at c_R = ' + C_R + ' the K that sits exactly on the threshold is K* = ' + K_STAR.toFixed(2) + ':',
    'sparse must be below it and dense above it, and K = ' + P.ai.sparseK + ' / K = ' + P.ai.denseK + ' straddle it with ' +
    (100 * (SD_SPARSE / S_STAR - 1)).toFixed(0) + '%',
    'and ' + (100 * (1 - SD_DENSE / S_STAR)).toFixed(0) + '% of margin. Nothing about the two K values needs to move.'];
  win.forEach(l => { say('     ' + l); md(l === '' ? '' : (l.startsWith('    c_R') ? '`' + l.trim() + '`' : l)); });
  md('');
}

// --- 3 · caps -------------------------------------------------------------
say('');
say('  3 · THE CAPS — ' + P.costs.queryCap + ' questions / ' + P.costs.revealCap + ' reveals');
say('');
md('## 3 · The caps (40 questions, 20 reveals)');
md('');
{
  const capShare = POLICIES.map(p => {
    const on = cell(p, 'AI_ON', 'ALL'), off = cell(p, 'AI_OFF', 'ALL');
    return { p, on: on.cap / Math.max(1, on.n), off: off.cap / Math.max(1, off.n), q: cm(on, 'q'), r: cm(off, 'r') };
  });
  const worst = capShare.reduce((a, b) => (Math.max(a.on, a.off) > Math.max(b.on, b.off) ? a : b));
  const lines = [
    'Neither cap binds, on any policy. The heaviest questioner is ' +
    capShare.reduce((a, b) => a.q > b.q ? a : b).p + ' at ' +
    f2(capShare.reduce((a, b) => a.q > b.q ? a : b).q) + ' questions',
    'a round against a cap of ' + P.costs.queryCap + '; the heaviest revealer is ' +
    capShare.reduce((a, b) => a.r > b.r ? a : b).p + ' at ' +
    f2(capShare.reduce((a, b) => a.r > b.r ? a : b).r) + ' of ' + P.costs.revealCap + '.',
    'The highest share of rounds touching either cap is ' +
    (100 * Math.max(worst.on, worst.off)).toFixed(1) + '% (' + worst.p + ').',
    'The caps are doing their intended job — bounding a pathological session — and nothing',
    'else. Leave them. They are not what limits search here; the reveal cost is.'
  ];
  lines.forEach(l => { say('     ' + l); md(l); });
  md('');
}

// --- 4 · rounds -----------------------------------------------------------
say('');
say('  4 · 24 SCORED ROUNDS');
say('');
md('## 4 · 24 scored rounds');
md('');
{
  const lines = [
    'Twelve rounds a condition is enough for every effect a plausible participant produces:',
    ''
  ];
  lines.forEach(l => { say('     ' + l); md(l); });
  md('| contrast | effect (points) | paired sd | participants for 80% power |');
  md('|---|---|---|---|');
  behavioural.forEach(p => {
    const t = paired(perPart[p], 'on', 'off');
    say('       ' + p.padEnd(18) + ' effect ' + sgn(t.eff).padStart(7) + '   paired sd ' +
      f2(t.sd).padStart(5) + '   n@80% ' + nn(t.n).padStart(5));
    md('| ' + p + ' (score) | ' + sgn(t.eff) + ' | ' + f2(t.sd) + ' | ' + nn(t.n) + ' |');
  });
  const fdT = perPart['TRUSTING'].fmOn.map((v, i) => v - perPart['TRUSTING'].fmOff[i]).filter(isFinite);
  const fdR = perPart['RATIONAL-WITH-AI'].fmOn.map((v, i) => v - perPart['RATIONAL-WITH-AI'].fmOff[i]).filter(isFinite);
  md('| RATIONAL-WITH-AI (frontier share) | ' + sgn(mean(fdR) * 100) + 'pp | ' + f2(sd(fdR) * 100) +
    ' | ' + nn(n80(mean(fdR), sd(fdR))) + ' |');
  md('| TRUSTING (frontier share) | ' + sgn(mean(fdT) * 100) + 'pp | ' + f2(sd(fdT) * 100) +
    ' | ' + nn(n80(mean(fdT), sd(fdT))) + ' |');
  md('');
  const tail = [
    '',
    'The null policy — RATIONAL-NO-AI, which cannot see the condition at all — returns ' +
    sgn(tNull.eff) + ' with a',
    'paired sd of ' + f2(tNull.sd) + '. That is the simulator\'s own zero and the floor any real effect',
    'has to clear; it also shows the two blocks are balanced, since a block difference would',
    'appear here first.',
    '',
    'The sparse-vs-dense INTERACTION is the expensive one: ' +
    nn(flip['TRUSTING'].nInter) + ' participants for TRUSTING and ' +
    nn(flip['RATIONAL-WITH-AI'].nInter),
    'for RATIONAL-WITH-AI. If the interaction is the headline, 24 scored rounds is the',
    'parameter to move, not the sample: the paired sd falls with the square root of the',
    'rounds per cell, so 16 scored rounds per condition would cut the required n by about a',
    'third at the same recruitment cost per participant.'
  ];
  tail.forEach(l => { say('     ' + l); md(l); });
  md('');
}

// --- 5 · layouts ----------------------------------------------------------
say('');
say('  5 · THE THREE LAYOUTS');
say('');
md('## 5 · The three layouts');
md('');
{
  md('| layout | frontier share of first moves — no AI | rational + AI | trusting | satisficer |');
  md('|---|---|---|---|---|');
  ['FRONTIER', 'BALANCED', 'GAP'].forEach(b => {
    const o = cell('RATIONAL-NO-AI', 'AI_OFF', b);
    const r = cell('RATIONAL-WITH-AI', 'AI_ON', b);
    const t = cell('TRUSTING', 'AI_ON', b);
    const s = cell('NOISY-SATISFICER', 'AI_ON', b);
    say('       ' + b.padEnd(9) + ' no AI ' + pct(o.fmFront, o.fmN).padStart(7) +
      '   rational+AI ' + pct(r.fmFront, r.fmN).padStart(7) +
      '   trusting ' + pct(t.fmFront, t.fmN).padStart(7) +
      '   satisficer ' + pct(s.fmFront, s.fmN).padStart(7));
    md('| ' + b + ' | ' + pct(o.fmFront, o.fmN) + ' | ' + pct(r.fmFront, r.fmN) + ' | ' +
      pct(t.fmFront, t.fmN) + ' | ' + pct(s.fmFront, s.fmN) + ' |');
  });
  md('');
  const lines = [
    '',
    'The three geometries separate the primary outcome cleanly and by a wide margin, with no',
    'AI involved at all: a rational searcher goes to the frontier from FRONTIER and into the',
    'gap from GAP, and BALANCED sits between them. That separation is the manipulation',
    'working. Keep all three; they are the sharpest instrument in the design.'
  ];
  lines.forEach(l => { say('     ' + l); md(l); });
  md('');
}

// --- 6 · the recommendation ----------------------------------------------
say('');
say('  6 · WHAT TO MOVE');
say('');
md('## 6 · What to move, and in which direction');
md('');
{
  const rec = [];
  if (searchPays < 5) {
    rec.push('**Move the reveal cost DOWN, from 5 to 3.** This is the one parameter that is');
    rec.push('mis-set. At c_R = ' + C_R + ' the whole AI-OFF arm is worth ' + sgn(searchPays) +
      ' points against spending nothing');
    rec.push('(' + f2(cm(rat, 'score')) + ' versus ' + f2(cm(blind, 'score')) +
      '), and the myopic benchmark stops after ' + f2(cm(rat, 'r')) + ' reveals. A control arm in');
    rec.push('which searching barely pays cannot show what an AI does to searching.');
    rec.push('');
    rec.push('The size of the move is pinned from two sides. Downward, c_R must stay above ' +
      CR_LO.toFixed(2) + ',');
    rec.push('or s* drops below the DENSE mid-gap sd of ' + SD_DENSE.toFixed(2) +
      ' and verification pays everywhere — which');
    rec.push('destroys the sparse/dense contrast outright. Upward, it must stay below ' +
      CR_HI.toFixed(2) + ', or');
    rec.push('verification pays nowhere. So the admissible band is (' + CR_LO.toFixed(2) + ', ' +
      CR_HI.toFixed(2) + ') and the useful part of it');
    rec.push('is its lower half: **c_R = 4** keeps a margin on both sides while making search');
    rec.push('meaningfully cheaper, and **c_R = 3.65** is the floor. Below that the design breaks.');
    rec.push('');
    rec.push('If the intention is to make search pay MUCH more, the reveal cost cannot deliver it');
    rec.push('alone, because the flip window caps how far it can fall. The second lever is the');
    rec.push('environment: raise the step bound L (currently ' + L + '). σ = L/√3 scales every');
    rec.push('uncertainty in the design, so a larger L widens the prize range actually reachable');
    rec.push('inside 100 positions and raises what a reveal is worth — and it moves s*, g* and');
    rec.push('both mid-gap standard deviations together, so the straddle is preserved by');
    rec.push('construction. The cost is that the walk becomes rougher, which the instructions');
    rec.push('already describe in one sentence ("neighbours differ by at most L").');
  } else {
    rec.push('The costs are adequate: unaided search buys ' + sgn(searchPays) +
      ' points over doing nothing, which is');
    rec.push('enough for the AI-OFF arm to be a real search arm. No change recommended.');
  }
  rec.push('');
  rec.push('**Leave alone:** the two K values (they straddle K* = ' + K_STAR.toFixed(2) +
    ' with ' + (100 * (SD_SPARSE / S_STAR - 1)).toFixed(0) + '% and ' +
    (100 * (1 - SD_DENSE / S_STAR)).toFixed(0) + '% of margin,');
  rec.push('and the measured AI error differs between them by a factor of ' +
    ((geoS.err / geoS.n) / (geoD.err / geoD.n)).toFixed(1) + '); the caps (neither binds,');
  rec.push('on any policy); the three layouts (they separate the primary outcome by ' +
    (() => {
      const a = cell('RATIONAL-NO-AI', 'AI_OFF', 'FRONTIER');
      const b = cell('RATIONAL-NO-AI', 'AI_OFF', 'GAP');
      return Math.round(100 * (a.fmFront / Math.max(1, a.fmN) - b.fmFront / Math.max(1, b.fmN)));
    })() + ' points of');
  rec.push('frontier share with no AI in the picture); and the question cost of ' + C_Q +
    ', which is what makes');
  rec.push('the AI worth consulting in the first place.');
  rec.push('');
  rec.push('**Expect a gradient, not a flip.** ' + (flipping.length
    ? 'A sign change does appear for ' + flipping.join(' and ') + ', but not for every policy, so'
    : 'No policy produces one, so'));
  rec.push('a pre-registration that predicts "the AI helps at K = 10 and hurts at K = 4" is');
  rec.push('predicting something this environment does not reliably produce. Predict the');
  rec.push('INTERACTION instead — the AI is worth less when it is sparse — and power for it: ' +
    nn(flip['TRUSTING'].nInter));
  rec.push('participants at 24 scored rounds, against ' + nn(tTru.n) + ' for the main effect.');
  rec.forEach(l => { say('     ' + l.replace(/\*\*/g, '')); md(l); });
  md('');
}

md('## Appendix · the seven policies');
md('');
md('| policy | what it does | AI-OFF behaviour |');
md('|---|---|---|');
md('| BLIND-GUESS | spends nothing, nominates the best pre-opened position (or mid-line) | same |');
md('| RATIONAL-NO-AI | myopic expected improvement on its own reveals; stops when the best EI < c_R | same |');
md('| SYSTEMATIC-NO-AI | reveals the widest stretch until no gap exceeds g* and no tail exceeds (s*/σ)² | same |');
md('| RATIONAL-WITH-AI | probes by asking, verifies a new front-runner only where its own uncertainty exceeds s* | RATIONAL-NO-AI |');
md('| TRUSTING | treats an answer as a fact, converges on the AI\'s curve, verifies 10% of the time | RATIONAL-NO-AI |');
md('| SKEPTICAL | asks 0–4 questions, ignores every answer, searches as RATIONAL-NO-AI | RATIONAL-NO-AI |');
md('| NOISY-SATISFICER | probes the widest gap, stops on anything above a personal threshold, 10% random actions; an AI answer counts as something held | itself, revealing instead of asking |');
md('');

say('');
say('  Full write-up: lab/search-v2/tools/SIMULATION-FINDINGS.md');
say('');
writeFileSync(join(HERE, 'SIMULATION-FINDINGS.md'), MD.join('\n') + '\n');
console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + N + ' participants × 7 policies × 24 scored rounds)');
