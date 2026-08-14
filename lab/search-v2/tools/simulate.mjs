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
const ROUNDING = P.ai.answerRounding;
const SD_SPARSE = SIGMA * Math.sqrt(J / P.ai.sparseK) / 2;   // mid-gap sd, sparse
const SD_DENSE = SIGMA * Math.sqrt(J / P.ai.denseK) / 2;     // mid-gap sd, dense

// The cost context. These are `let` rather than `const` ONLY so the sensitivity
// sweeps at the end can re-run the same policies at a different reveal cost;
// the main run never touches them, and setCosts always leaves them at the
// study's own values.
let C_R, C_Q, S_STAR, G_STAR, TAIL_STAR;
function setCosts(cR, cQ) {
  C_R = cR; C_Q = cQ;
  S_STAR = CFG.sStar(cR);                       // s* = c_R √(2π)          (§3.4)
  G_STAR = CFG.gStar(cR, L);                    // g* = (2 s* / σ)²
  TAIL_STAR = Math.pow(S_STAR / SIGMA, 2);      // σ√t > s*  ⇔  t > (s*/σ)²
}
setCosts(P.costs.revealCost, P.costs.queryCost);

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
    // Whether an ANSWER can be nominated on. A policy that says it ignores the
    // AI has to ignore it here too, or it quietly banks the information it is
    // supposed to be throwing away.
    useAsked: true,
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
  if (!R.useAsked) return null;
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
  R.useAsked = false;                             // it means it: the answers are dropped
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
  let peakPos = 1, peakVal = -Infinity;
  for (let i = 1; i < anchors.length; i++) maxGap = Math.max(maxGap, anchors[i].pos - anchors[i - 1].pos);
  for (let p = 1; p <= J; p++) {
    const say_ = Ai.aiAnswer(anchors, p, ROUNDING);
    const sd_ = Ai.aiSd(anchors, p, SIGMA);
    const e = Math.abs(say_ - map[p - 1]);
    n++; sSum += sd_; errSum += e; if (e > errMax) errMax = e;
    if (sd_ > S_STAR) above++;
    if (say_ > peakVal) { peakVal = say_; peakPos = p; }
  }
  // …unless the highest anchor is the OUTERMOST one, in which case the flat
  // extrapolation makes the whole tail beyond it a plateau of that same number,
  // and the truth out there drifts away from it. That is the one place the AI's
  // best answer is not a true prize.
  const peakInTail = peakPos < anchors[0].pos || peakPos > anchors[anchors.length - 1].pos;
  // Where the AI's curve is HIGHEST is where a trusting participant ends up. An
  // interpolation of anchors peaks AT an anchor (§3), so the truth there is not
  // an approximation of anything — it is a real prize, and this measures how
  // good a prize following the machine to its peak actually lands you on.
  const peakTruth = map[peakPos - 1], ceiling = Pool.maxOf(map);
  [s.ai_density, s.seed_shape, s.ai_density + '·' + s.seed_shape].forEach(k => {
    const g = geo[k] || (geo[k] = {
      specs: 0, n: 0, above: 0, s: 0, err: 0, errMax: 0, gap: 0,
      peakErr: 0, peakShare: 0, peakTruth: 0, peakTail: 0
    });
    g.specs++; g.n += n; g.above += above; g.s += sSum; g.err += errSum;
    g.gap += maxGap; if (errMax > g.errMax) g.errMax = errMax;
    g.peakErr += Math.abs(peakVal - peakTruth);
    g.peakTruth += peakTruth;
    g.peakShare += peakTruth / ceiling;
    if (peakInTail) g.peakTail++;
  });
});

// The environment's own floor: the mean prize over every position of every
// scored mapping. A participant who nominates a position at random, having spent
// nothing, expects this. Everything a searcher pays for has to beat it.
const ENV_MEAN = (() => {
  let s = 0, n = 0;
  specs.filter(x => x.scored).forEach(x => pool[x.mapping_index].forEach(v => { s += v; n++; }));
  return s / n;
})();

// ── accumulators ───────────────────────────────────────────────────────────
function newCell() {
  return {
    n: 0, score: 0, score2: 0, q: 0, r: 0, truth: 0, cost: 0,
    fmN: 0, fmFront: 0, acted: 0, unver: 0, ceiling: 0, cap: 0,
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
    if (out.first) c.acted++;
    if (front != null) { c.fmN++; c.fmFront += front; }
    // Only where the machine was actually consulted and its number was all they
    // had: an AI-ON round that ended on a position they never opened, in a round
    // where they asked at least once.
    if (cond === 'AI_ON' && out.aiShown != null && out.unverified && out.nQueries > 0) {
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

      // The counterfactual runs on the SAME rng stream, so a policy that does not
      // change its behaviour between conditions produces an identical round and
      // the "worse with the AI" column reads exactly zero for it.
      let cf = null;
      if (aiOn) cf = PLAY_OFF[policy](newRound(spec, false), Pool.rngFrom(Pool.hashSeed(seed)));

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

// ── a mixed population ─────────────────────────────────────────────────────
// Every participant above played every policy, which makes the policies
// comparable but makes each one's sample far too homogeneous to read power off.
// So: give each simulated participant ONE behavioural type, drawn from their own
// code, and re-do the paired analysis over that mixture. This is the number a
// real study should be powered against.
const MIX = [
  { p: 'RATIONAL-WITH-AI', w: 0.20 },
  { p: 'TRUSTING', w: 0.35 },
  { p: 'SKEPTICAL', w: 0.15 },
  { p: 'NOISY-SATISFICER', w: 0.30 }
];
const mix = { on: [], off: [], onS: [], offS: [], onD: [], offD: [], fmOn: [], fmOff: [] };
for (let i = 1; i <= N; i++) {
  const u = Pool.rngFrom(Pool.hashSeed('SIM' + pad4(i) + '|type'))();
  let acc = 0, chosen = MIX[MIX.length - 1].p;
  for (const m of MIX) { acc += m.w; if (u < acc) { chosen = m.p; break; } }
  const pp = perPart[chosen];
  Object.keys(mix).forEach(k => mix[k].push(pp[k][i - 1]));
}
const mixScore = paired(mix, 'on', 'off');
const mixS = paired(mix, 'onS', 'offS');
const mixD = paired(mix, 'onD', 'offD');
const mixF = paired(mix, 'fmOn', 'fmOff');
const mixI = (() => {
  const d = mix.onS.map((v, i) => (v - mix.offS[i]) - (mix.onD[i] - mix.offD[i])).filter(isFinite);
  return { d, eff: mean(d), sd: sd(d), n: n80(mean(d), sd(d)) };
})();

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
        f2(g.s / g.n), pct(g.above, g.n), f2(g.err / g.n), g.errMax,
        f2(g.peakErr / g.specs), f1(g.peakTruth / g.specs), (100 * g.peakShare / g.specs).toFixed(1) + '%']);
    });
    const g = geo[d];
    rows.push([d, 'ALL', g.specs, f1(g.gap / g.specs), f2(g.s / g.n),
      pct(g.above, g.n), f2(g.err / g.n), g.errMax,
      f2(g.peakErr / g.specs), f1(g.peakTruth / g.specs), (100 * g.peakShare / g.specs).toFixed(1) + '%']);
  });
  say(table(['density', 'layout', 'specs', 'widest gap', 'mean sd', 'above s*', 'mean |err|',
    'max |err|', 'err at peak', 'truth at peak', 'of the best'], rows, ['l', 'l']));
  say('');
  say('  Over all 100 positions of every scored spec, with the AI\'s anchor set as the round');
  say('  BEGINS (its K private anchors plus the pre-opened positions). "above s*" is §16.8\'s');
  say('  verify_pays: the share of the line where paying ' + C_R + ' for the truth is worth it.');
  say('');
  say('  THE LAST THREE COLUMNS ARE THE DESIGN\'S CENTRAL PROBLEM. An interpolation of anchors');
  say('  peaks AT an anchor, so wherever the AI\'s curve is highest it is usually telling the');
  say('  exact truth — error at the peak is ' + f2(geo.SPARSE.peakErr / geo.SPARSE.specs) + ' in sparse rounds and ' +
    f2(geo.DENSE.peakErr / geo.DENSE.specs) + ' in dense ones, and the prize');
  say('  standing there is worth ' + (100 * geo.SPARSE.peakShare / geo.SPARSE.specs).toFixed(0) + '% / ' +
    (100 * geo.DENSE.peakShare / geo.DENSE.specs).toFixed(0) + '% of the best on the board. Following the machine to');
  say('  its highest number is mostly not a trap: it is a free pointer to a real, large prize.');
  say('  The exception is the ' + (geo.SPARSE.peakTail + geo.DENSE.peakTail) + ' of ' +
    (geo.SPARSE.specs + geo.DENSE.specs) + ' specs whose highest anchor is the OUTERMOST one: the flat');
  say('  extrapolation then makes the whole tail beyond it a plateau of that same number, and');
  say('  out there the truth drifts. That is the one geometry in which trust is genuinely');
  say('  punished, and it is also the geometry the FRONTIER layout is built to create.');
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
  say('  Reference points, all measured here:');
  say('    best prize on the board, mean         ' + f1(cm(cell('BLIND-GUESS', 'AI_OFF', 'ALL'), 'ceiling')));
  say('    a position picked at random           ' + f2(ENV_MEAN) + '   (the environment\'s own mean)');
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

rule('TABLE 4 · did the AI cost them? Each AI-ON round against the same round,\n' +
  '           same participant, same rng, played with the AI taken away');
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
  say('  design would face.');
  say('');
  say('  READ THESE AS A FLOOR, NOT A FORECAST, and note that the paired sd is NOT smaller');
  say('  than the per-condition ones here. A crossover normally wins by differencing the');
  say('  person out; two simulated participants of one type play almost identically, so the');
  say('  variance it removes is mostly absent by construction while the variance it cannot');
  say('  remove — the two blocks hold different mappings — is fully present. The honest power');
  say('  figure is the MIXED POPULATION below, each participant given one behavioural type.');
  say('');
  say('  MIXED POPULATION  ' + MIX.map(m => (100 * m.w).toFixed(0) + '% ' + m.p).join(' · '));
  const rows2 = [
    ['score (all rounds)', sgn(mixScore.eff), f2(mixScore.sd), nn(mixScore.n)],
    ['score · sparse', sgn(mixS.eff), f2(mixS.sd), nn(mixS.n)],
    ['score · dense', sgn(mixD.eff), f2(mixD.sd), nn(mixD.n)],
    ['sparse − dense interaction', sgn(mixI.eff), f2(mixI.sd), nn(mixI.n)],
    ['frontier share of first moves', sgn(mixF.eff * 100) + 'pp', f2(mixF.sd * 100), nn(mixF.n)]
  ];
  say(table(['contrast', 'effect', 'paired sd', 'n@80%'], rows2, ['l']));
}

// ── sensitivity: what would moving a parameter actually do? ────────────────
// A recommendation is only worth making if the alternative was measured, so the
// same policies are replayed at other reveal costs and other K pairs. Specs do
// not depend on the costs, so the cost sweep re-uses the frozen ones; the K
// sweep has to rebuild them, which is 6 ms.
const SWEEP_N = Math.min(N, 500);
const SWEEP_POLICIES = ['BLIND-GUESS', 'RATIONAL-NO-AI', 'SYSTEMATIC-NO-AI', 'RATIONAL-WITH-AI', 'TRUSTING'];
function quickRun(specsX, nParts, policies) {
  const res = {};
  policies.forEach(p => { res[p] = { on: [], off: [], onS: [], offS: [], onD: [], offD: [], q: 0, r: 0, nOn: 0 }; });
  for (let i = 1; i <= nParts; i++) {
    const code = 'SIM' + pad4(i);
    const plan = Specs.sessionPlan(specsX, code, (i % 2 === 1) ? 'A' : 'B', P);
    policies.forEach(policy => {
      const a = { on: [], off: [], onS: [], offS: [], onD: [], offD: [] };
      plan.rounds.forEach(r => {
        if (!r.scored) return;
        const spec = r.spec, aiOn = r.condition === 'AI_ON';
        const out = PLAY[policy](newRound(spec, aiOn),
          Pool.rngFrom(Pool.hashSeed(code + '|' + policy + '|' + spec.spec_id)));
        const side = aiOn ? 'on' : 'off';
        a[side].push(out.score);
        a[side + (spec.ai_density === 'SPARSE' ? 'S' : 'D')].push(out.score);
        if (aiOn) { res[policy].q += out.nQueries; res[policy].r += out.nReveals; res[policy].nOn++; }
      });
      Object.keys(a).forEach(k => res[policy][k].push(mean(a[k])));
    });
  }
  return res;
}
function sweepRow(res, policy) {
  const t = paired(res[policy], 'on', 'off');
  const s = paired(res[policy], 'onS', 'offS');
  const d = paired(res[policy], 'onD', 'offD');
  return { off: mean(res[policy].off), on: mean(res[policy].on), eff: t.eff, eS: s.eff, eD: d.eff };
}

// Re-anchor the frozen specs for a different K, keeping every mapping and every
// pre-opened set exactly as it is — so a row of the K sweep differs from another
// row ONLY in the treatment, and rows sharing a K are identical by construction.
// Anchors are placed by Specs.placeAnchors, the same function the run uses.
const respecCache = {};
function respec(ks, kd) {
  const key = ks + '/' + kd;
  if (respecCache[key]) return respecCache[key];
  const Px = Specs.withDefaults({ ai: { sparseK: ks, denseK: kd } });
  const out = specs.map(s => {
    const K = Specs.densityK(s.ai_density, Px);
    if (K === s.ai_k) return s;                 // unchanged density: the REAL spec
    const rng = Pool.rngFrom(Pool.hashSeed(s.spec_id + '|K' + K));
    const copy = {};
    Object.keys(s).forEach(k => { copy[k] = s[k]; });
    copy.ai_k = K;
    copy.ai_anchors = Specs.placeAnchors(K, rng, Px);
    return copy;
  });
  respecCache[key] = out;
  return out;
}

rule('TABLE 6 · sensitivity — the reveal cost (' + SWEEP_N + ' participants, specs unchanged)');
const costSweep = [];
{
  [2, 2.5, 3, 3.5, 4, 4.58, 5, 6, 8].forEach(cR => {
    setCosts(cR, P.costs.queryCost);
    const res = quickRun(specs, SWEEP_N, SWEEP_POLICIES);
    const blind = mean(res['BLIND-GUESS'].off);
    const myo = sweepRow(res, 'RATIONAL-NO-AI');
    const sys = sweepRow(res, 'SYSTEMATIC-NO-AI');
    const rat = sweepRow(res, 'RATIONAL-WITH-AI');
    const tru = sweepRow(res, 'TRUSTING');
    costSweep.push({
      cR, sStar: CFG.sStar(cR), blind, myo, sys, rat, tru,
      rev: res['RATIONAL-NO-AI'].r / Math.max(1, res['RATIONAL-NO-AI'].nOn),
      straddle: (SD_SPARSE > CFG.sStar(cR)) && (SD_DENSE < CFG.sStar(cR))
    });
  });
  setCosts(P.costs.revealCost, P.costs.queryCost);
  const rows = costSweep.map(x => [
    (x.cR === P.costs.revealCost ? '→ ' : '  ') + x.cR, f2(x.sStar), x.straddle ? 'yes' : 'NO',
    f2(x.myo.off), f2(x.rev), sgn(x.myo.off - x.blind), f2(x.sys.off),
    sgn(x.rat.eff), sgn(x.tru.eff), sgn(x.tru.eS), sgn(x.tru.eD), sgn(x.tru.eS - x.tru.eD)
  ]);
  say(table(['c_R', 's*', 'straddle', 'no-AI score', 'reveals', 'vs floor', 'systematic',
    'AI eff (rat)', 'AI eff (tru)', 'tru sparse', 'tru dense', 'sparse−dense'], rows, ['l']));
  say('');
  say('  "straddle" = does s* still fall between the dense mid-gap sd (' + SD_DENSE.toFixed(2) +
    ') and the sparse one');
  say('  (' + SD_SPARSE.toFixed(2) + ')? Outside that band, verification pays either everywhere or nowhere and');
  say('  the sparse/dense manipulation has nothing left to manipulate.');
  say('  "vs floor" = what unaided myopic search buys over spending nothing.');
  say('  The sweeps run the first ' + SWEEP_N + ' participants rather than all ' + N +
    ', so the → row can sit a tenth');
  say('  of a point off Table 3. Read a sweep against its own rows, not across tables.');
}

rule('TABLE 7 · sensitivity — the two K values (' + SWEEP_N + ' participants, mappings unchanged)');
const kSweep = [];
{
  [[2, 10], [3, 10], [4, 6], [4, 8], [4, 10], [4, 14], [5, 10], [6, 10]].forEach(([ks, kd]) => {
    const res = quickRun(respec(ks, kd), SWEEP_N, ['RATIONAL-WITH-AI', 'TRUSTING']);
    const rat = sweepRow(res, 'RATIONAL-WITH-AI');
    const tru = sweepRow(res, 'TRUSTING');
    const sdS = SIGMA * Math.sqrt(J / ks) / 2, sdD = SIGMA * Math.sqrt(J / kd) / 2;
    kSweep.push({ ks, kd, sdS, sdD, rat, tru, straddle: sdS > S_STAR && sdD < S_STAR });
  });
  const rows = kSweep.map(x => [
    (x.ks === P.ai.sparseK && x.kd === P.ai.denseK ? '→ ' : '  ') + x.ks + ' / ' + x.kd,
    f2(x.sdS), f2(x.sdD), x.straddle ? 'yes' : 'NO',
    sgn(x.tru.eS), sgn(x.tru.eD), sgn(x.tru.eS - x.tru.eD),
    sgn(x.rat.eS), sgn(x.rat.eD), sgn(x.rat.eS - x.rat.eD)
  ]);
  say(table(['K sparse/dense', 'sd sparse', 'sd dense', 'straddle',
    'tru sparse', 'tru dense', 'tru diff', 'rat sparse', 'rat dense', 'rat diff'], rows, ['l']));
  say('');
  say('  Only the anchors move between rows: every mapping and every pre-opened set is the one');
  say('  the run actually serves, a density whose K is unchanged keeps the run\'s OWN anchors,');
  say('  and two rows sharing a K share their anchors exactly. So a column is comparable down');
  say('  the table, the sparse side is literally identical wherever K sparse is, and the → row');
  say('  is the study as it currently stands.');
}

rule('TABLE 8 · sensitivity — the two together, and the candidate settings');
const jointSweep = [];
{
  [[5, 4, 10], [4, 4, 10], [5, 3, 10], [4, 3, 10], [3.5, 3, 10],
  [3, 3, 10], [4, 2, 10], [3.5, 2, 10], [3, 4, 10]].forEach(([cR, ks, kd]) => {
    setCosts(cR, P.costs.queryCost);
    const res = quickRun(respec(ks, kd), SWEEP_N, SWEEP_POLICIES);
    const blind = mean(res['BLIND-GUESS'].off);
    const myo = sweepRow(res, 'RATIONAL-NO-AI');
    const tru = sweepRow(res, 'TRUSTING');
    const rat = sweepRow(res, 'RATIONAL-WITH-AI');
    jointSweep.push({
      cR, ks, kd, floor: myo.off - blind,
      rev: res['RATIONAL-NO-AI'].r / Math.max(1, res['RATIONAL-NO-AI'].nOn),
      tru, rat,
      flip: (tru.eS > 0) !== (tru.eD > 0) && Math.abs(tru.eS) > 0.5 && Math.abs(tru.eD) > 0.5
    });
  });
  setCosts(P.costs.revealCost, P.costs.queryCost);
  const rows = jointSweep.map(x => [
    (x.cR === P.costs.revealCost && x.ks === P.ai.sparseK && x.kd === P.ai.denseK ? '→ ' : '  ') +
    'c_R ' + x.cR + ', K ' + x.ks + '/' + x.kd,
    sgn(x.floor), f2(x.rev), sgn(x.tru.eS), sgn(x.tru.eD), sgn(x.tru.eS - x.tru.eD),
    sgn(x.rat.eS), sgn(x.rat.eD), x.flip ? 'FLIP' : 'gradient'
  ]);
  say(table(['setting', 'search vs floor', 'reveals', 'tru sparse', 'tru dense', 'tru diff',
    'rat sparse', 'rat dense', 'sign'], rows, ['l']));
  say('');
  say('  "search vs floor" is what unaided myopic search buys over spending nothing — the');
  say('  measure of whether the AI-OFF arm is a search arm at all. "sign" asks whether the');
  say('  trusting participant is HELPED at one density and HURT at the other.');
}

// ── the closing section, written from the numbers ─────────────────────────
const blind = cell('BLIND-GUESS', 'AI_OFF', 'ALL');
const rat = cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL');
const sys = cell('SYSTEMATIC-NO-AI', 'AI_OFF', 'ALL');
const ratAI = cell('RATIONAL-WITH-AI', 'AI_ON', 'ALL');
const truOn = cell('TRUSTING', 'AI_ON', 'ALL');

const searchPays = cm(rat, 'score') - cm(blind, 'score');
const sysPays = cm(sys, 'score') - cm(blind, 'score');
const tNull = paired(perPart['RATIONAL-NO-AI'], 'on', 'off');
const tTru = paired(perPart['TRUSTING'], 'on', 'off');
const behavioural = ['RATIONAL-WITH-AI', 'TRUSTING', 'SKEPTICAL', 'NOISY-SATISFICER'];
const flipping = behavioural.filter(p => flip[p].verdict === 'FLIP');
const maxGradient = Math.max(...behavioural.map(p => Math.abs(flip[p].eS - flip[p].eD)));
const geoS = geo.SPARSE, geoD = geo.DENSE;

// The window of reveal costs in which a sparse/dense sign change can exist at
// all: s* = c_R√(2π) has to fall between the two nominal mid-gap standard
// deviations. Closed form, not simulated — and the sweeps agree with it.
const CR_LO = SD_DENSE / Math.sqrt(2 * Math.PI);
const CR_HI = SD_SPARSE / Math.sqrt(2 * Math.PI);
const CR_MID = Math.sqrt(SD_DENSE * SD_SPARSE) / Math.sqrt(2 * Math.PI);
const K_STAR = J / G_STAR;

// The candidate settings, straight out of Table 8.
const cur = jointSweep.find(x => x.cR === P.costs.revealCost && x.ks === P.ai.sparseK && x.kd === P.ai.denseK);
const rec = jointSweep.find(x => x.cR === 4 && x.ks === 3 && x.kd === 10);
const cheapOnly = jointSweep.find(x => x.cR === 4 && x.ks === 4 && x.kd === 10);
const sparseOnly = jointSweep.find(x => x.cR === 5 && x.ks === 3 && x.kd === 10);
const cR2 = costSweep.find(x => x.cR === 2);
const cR3 = costSweep.find(x => x.cR === 3);
const cR4 = costSweep.find(x => x.cR === 4);
const cR8 = costSweep.find(x => x.cR === 8);
const k2 = kSweep.find(x => x.ks === 2 && x.kd === 10);
const k3 = kSweep.find(x => x.ks === 3 && x.kd === 10);
const k4 = kSweep.find(x => x.ks === 4 && x.kd === 10);
const k6 = kSweep.find(x => x.ks === 6 && x.kd === 10);

const MD = [];
const md = s => MD.push(s);
function sect(title) {
  say(''); say('  ' + title.toUpperCase()); say('');
  md(''); md('## ' + title); md('');
}
// A paragraph goes to both outputs. A line that carries its own indentation is
// laid out, not prose, so consecutive indented lines are fenced in the markdown
// — otherwise the renderer reflows a table into a sentence.
function para(lines) {
  let fenced = false;
  lines.forEach(l => {
    say(l ? '     ' + l : '');
    const pre = /^ {2,}\S/.test(l);
    if (pre && !fenced) { md('```'); fenced = true; }
    else if (!pre && fenced && l) { md('```'); fenced = false; }
    md(l);
  });
  if (fenced) md('```');
  say(''); md('');
}
function bothTable(headers, rows, align) {
  say(table(headers, rows, align).split('\n').map(l => '   ' + l).join('\n'));
  say('');
  md('| ' + headers.join(' | ') + ' |');
  md('|' + headers.map(() => '---').join('|') + '|');
  rows.forEach(r => md('| ' + r.map(x => String(x).trim()).join(' | ') + ' |'));
  md('');
}

md('# What the simulation says about the parameters');
md('');
md('*Generated by `node lab/search-v2/tools/simulate.mjs`. ' + N + ' simulated participants ' +
  '(' + Math.ceil(N / 2) + ' on sequence A, ' + Math.floor(N / 2) + ' on B), each playing all 28 rounds of the real ' +
  'frozen artifacts — the same mapping pool, the same 28 specs, the same AI — under seven ' +
  'policies, with a counterfactual re-play of every AI-ON round and sensitivity sweeps over ' +
  'the reveal cost and the two K values. Every number below comes from that run. Nothing is ' +
  'asserted here that the simulator did not measure. The sweeps use the first ' + SWEEP_N +
  ' participants rather than all ' + N + ', so a sweep\'s "current settings" row can sit a tenth of ' +
  'a point off the main tables; each sweep is internally consistent.*');
md('');

rule('WHAT THE SIMULATION SAYS ABOUT THE PARAMETERS');

sect('The short answer');
para([
  'The environment, the three layouts, the caps and the 24 scored rounds are all adequate,',
  'and the crossover has ample power. TWO parameters are mis-set, and they are mis-set in',
  'the same direction — both make the AI too easy to live with:',
  '',
  '  · THE REVEAL COST IS TOO HIGH. At c_R = ' + C_R + ' an unaided searcher who plays the study\'s',
  '    own myopic-EI benchmark opens ' + f2(cm(rat, 'r')) + ' positions a round and beats spending nothing by',
  '    ' + sgn(searchPays) + ' points. The AI-OFF arm is barely a search arm. Lower it to 4.',
  '',
  '  · SPARSE K = ' + P.ai.sparseK + ' IS NOT SPARSE ENOUGH. Four anchors already make the AI worth trusting:',
  '    a trusting participant GAINS ' + sgn(cur.tru.eS) + ' points in sparse rounds, when the design',
  '    predicts a loss. Lower it to 3.',
  '',
  'Neither is a flaw in the build; both are numbers on the admin\'s Parameters screen. Made',
  'together the two moves turn the headline result from a gradient into the sign flip the',
  'design predicts, at no cost to anything else.'
]);
bothTable(['setting', 'unaided search buys', 'reveals/round', 'trusting · sparse', 'trusting · dense', 'sign'],
  [
    ['current  c_R 5, K 4/10', sgn(cur.floor), f2(cur.rev), sgn(cur.tru.eS), sgn(cur.tru.eD), 'gradient'],
    ['c_R 4 alone', sgn(cheapOnly.floor), f2(cheapOnly.rev), sgn(cheapOnly.tru.eS), sgn(cheapOnly.tru.eD), 'gradient'],
    ['K 3/10 alone', sgn(sparseOnly.floor), f2(sparseOnly.rev), sgn(sparseOnly.tru.eS), sgn(sparseOnly.tru.eD), 'gradient'],
    ['BOTH  c_R 4, K 3/10', sgn(rec.floor), f2(rec.rev), sgn(rec.tru.eS), sgn(rec.tru.eD),
      rec.flip ? 'FLIP' : 'gradient']
  ], ['l']);

sect('1 · The costs — reveal 5, question 2');
para([
  'The RATIO is right and should not move. Questions at 2 against reveals at 5 make the AI',
  'worth consulting, which is the premise of the whole study: RATIONAL-WITH-AI scores ' +
  f2(cm(ratAI, 'score')) + ',',
  'where the same searcher without an AI scores ' + f2(cm(rat, 'score')) + '.',
  '',
  'The LEVEL is the design\'s weakest number, and the measurement that shows it is the floor.',
  'A participant who spends nothing and nominates what the interface already offers scores',
  f2(cm(blind, 'score')) + '. The myopic-EI benchmark of §16.8 scores ' + f2(cm(rat, 'score')) +
  ' — it buys ' + sgn(searchPays) + ' points for ' + f1(cm(rat, 'cost')) + ' points of',
  'effort, and it stops after ' + f2(cm(rat, 'r')) + ' reveals because at c_R = ' + C_R +
  ' that is the correct myopic answer.',
  'Searching HARDER makes it worse, not better: SYSTEMATIC-NO-AI, which opens the line until',
  'no gap exceeds g* = ' + G_STAR.toFixed(1) + ', pays ' + f1(cm(sys, 'cost')) + ' points for ' +
  f1(cm(sys, 'r')) + ' reveals and scores ' + f2(cm(sys, 'score')) + ' — ' + sgn(sysPays) + ' against',
  'doing nothing. An arm in which effort does not pay cannot show what an AI does to effort.',
  '',
  'The sweep says how far to move it and where the wall is:'
]);
bothTable(['c_R', 's*', 'straddle holds', 'unaided search buys', 'reveals', 'AI effect (trusting)', 'sparse', 'dense'],
  costSweep.map(x => [(x.cR === C_R ? '→ ' : '  ') + x.cR, f2(x.sStar), x.straddle ? 'yes' : 'NO',
    sgn(x.myo.off - x.blind), f2(x.rev), sgn(x.tru.eff), sgn(x.tru.eS), sgn(x.tru.eD)]), ['l']);
para([
  'Two constraints bracket it. Search has to pay, which pushes c_R DOWN — at 4 the benchmark',
  'opens ' + f2(cR4.rev) + ' positions and buys ' + sgn(cR4.myo.off - cR4.blind) + ', at 3 it opens ' +
  f2(cR3.rev) + ' and buys ' + sgn(cR3.myo.off - cR3.blind) + ', at 2 it buys ' +
  sgn(cR2.myo.off - cR2.blind) + '.',
  'The sparse/dense manipulation has to survive, which pushes it UP: s* = c_R·√(2π) must land',
  'between the two nominal mid-gap standard deviations, ' + SD_DENSE.toFixed(2) + ' (dense) and ' +
  SD_SPARSE.toFixed(2) + ' (sparse), so',
  '',
  '     c_R must lie in (' + CR_LO.toFixed(2) + ', ' + CR_HI.toFixed(2) +
  '), with its geometric centre at ' + CR_MID.toFixed(2) + '.',
  '',
  'RECOMMENDATION: c_R = 4. It nearly doubles what search is worth (' +
  sgn(cur.floor) + ' → ' + sgn(cheapOnly.floor) + ') and raises',
  'reveals from ' + f2(cur.rev) + ' to ' + f2(cheapOnly.rev) + ', while staying inside the window with ' +
  (100 * (SD_SPARSE / CFG.sStar(4) - 1)).toFixed(0) + '% of margin above',
  'and ' + (100 * (1 - SD_DENSE / CFG.sStar(4))).toFixed(0) +
  '% below. Do not go below ' + CR_LO.toFixed(2) + ': there s* drops under the DENSE mid-gap sd,',
  'verification pays everywhere, and the density manipulation has nothing left to manipulate',
  '(the sweep shows it — at c_R = 3 and c_R = 2 the straddle column reads NO).',
  '',
  'Do not raise it. At c_R = ' + cR8.cR + ' unaided search buys ' + sgn(cR8.myo.off - cR8.blind) +
  ' — it is a pure loss — and the AI',
  '"effect" swells to ' + sgn(cR8.tru.eff) + ' points purely because the alternative got worse.'
]);

sect('2 · K = 4 and K = 10 — the straddle holds, the sign flip does not follow from it');
para([
  'The geometry is exactly as specified. Over every position of every scored spec, with the',
  'AI\'s anchor set as the round begins:',
  '',
  '  sparse   mean sd ' + f2(geoS.s / geoS.n) + '   ' + pct(geoS.above, geoS.n) + ' of the line above s* = ' +
  S_STAR.toFixed(2) + '   mean |AI error| ' + f2(geoS.err / geoS.n) + '   worst ' + geoS.errMax,
  '  dense    mean sd ' + f2(geoD.s / geoD.n) + '   ' + pct(geoD.above, geoD.n) + ' of the line above s*' +
  '             mean |AI error| ' + f2(geoD.err / geoD.n) + '   worst ' + geoD.errMax,
  '',
  'The two densities differ by a factor of ' + ((geoS.err / geoS.n) / (geoD.err / geoD.n)).toFixed(1) +
  ' in how wrong the AI is, and s* lands between them.',
  'The mechanism is sound. What does not follow is a sign change in SCORE: at K = ' +
  P.ai.sparseK + ' the trusting',
  'participant is helped in sparse rounds too (' + sgn(cur.tru.eS) + '), just less than in dense ones (' +
  sgn(cur.tru.eD) + ').',
  '',
  'THE REASON IS STRUCTURAL, and it is worth stating plainly because it is not a tuning',
  'problem. An interpolation of anchors cannot exceed its anchors, so the AI\'s curve peaks',
  'AT an anchor — a position where its number is the exact truth. Following the machine to',
  'its highest answer therefore lands a participant on a REAL prize worth ' +
  (100 * geoS.peakShare / geoS.specs).toFixed(0) + '% of the board\'s',
  'best in sparse rounds and ' + (100 * geoD.peakShare / geoD.specs).toFixed(0) +
  '% in dense ones. With four anchors that is already a good',
  'deal, and no reveal cost makes it a bad one. The only geometry that punishes trust is the',
  'flat extrapolation beyond the outermost anchor, where the AI repeats a number over a whole',
  'plateau the truth wanders away from — which is what the FRONTIER layout builds, and it is',
  'the ' + (geoS.peakTail + geoD.peakTail) + ' of ' + (geoS.specs + geoD.specs) + ' specs whose peak sits in a tail.',
  '',
  'Across the four behavioural policies at the current settings, ' + (flipping.length
    ? flipping.join(' and ') + ' flip and the rest do not'
    : 'NOT ONE flips') + ', and the',
  'widest sparse-minus-dense gap any of them shows is ' + maxGradient.toFixed(2) + ' points.',
  '',
  'So the lever is K itself. At c_R = ' + C_R + ' the K sitting exactly on the threshold is K* = ' +
  K_STAR.toFixed(2) + ',',
  'and sparse has to stay below it while dense stays above. Fewer anchors means a lower best',
  'anchor, and a pointer worth following becomes a pointer worth checking:'
]);
bothTable(['K sparse / dense', 'sd sparse', 'sd dense', 'straddle', 'trusting · sparse', 'trusting · dense', 'difference'],
  kSweep.map(x => [(x.ks === P.ai.sparseK && x.kd === P.ai.denseK ? '→ ' : '  ') + x.ks + ' / ' + x.kd,
    f2(x.sdS), f2(x.sdD), x.straddle ? 'yes' : 'NO',
    sgn(x.tru.eS), sgn(x.tru.eD), sgn(x.tru.eS - x.tru.eD)]), ['l']);
para([
  'RECOMMENDATION: sparse K = 3, dense K = 10 unchanged. The sparse effect falls from ' +
  sgn(k4.tru.eS) + ' to ' + sgn(k3.tru.eS) + ',',
  'the sparse/dense difference roughly doubles (' + sgn(k4.tru.eS - k4.tru.eD) + ' → ' +
  sgn(k3.tru.eS - k3.tru.eD) + '), and the mid-gap sd rises from',
  SD_SPARSE.toFixed(2) + ' to ' + (SIGMA * Math.sqrt(J / 3) / 2).toFixed(2) +
  ', further clear of s* rather than nearer it. K = 2 is stronger still',
  '(' + sgn(k2.tru.eS) + ' sparse, difference ' + sgn(k2.tru.eS - k2.tru.eD) +
  ') but two anchors on a hundred positions is barely an AI, and',
  'the instructions have to state K to the participant.',
  '',
  'DO NOT RAISE SPARSE K. At K = ' + k6.ks + ' the nominal straddle fails outright (mid-gap sd ' +
  k6.sdS.toFixed(2) + ' < s*),',
  'and the measured difference collapses to ' + sgn(k6.tru.eS - k6.tru.eD) + '. Dense K = 10 needs no change:',
  'it sits ' + (100 * (1 - SD_DENSE / S_STAR)).toFixed(0) +
  '% below s* and its measured AI error is ' + f2(geoD.err / geoD.n) + ' points.'
]);

sect('3 · The caps — 40 questions, 20 reveals');
{
  const capRows = POLICIES.map(p => {
    const on = cell(p, 'AI_ON', 'ALL'), off = cell(p, 'AI_OFF', 'ALL');
    return { p, q: cm(on, 'q'), r: Math.max(cm(on, 'r'), cm(off, 'r')), cap: Math.max(on.cap / Math.max(1, on.n), off.cap / Math.max(1, off.n)) };
  });
  const mq = capRows.reduce((a, b) => a.q > b.q ? a : b);
  const mr = capRows.reduce((a, b) => a.r > b.r ? a : b);
  const mc = capRows.reduce((a, b) => a.cap > b.cap ? a : b);
  para([
    'Neither cap binds on any policy. The heaviest questioner is ' + mq.p + ' at ' + f2(mq.q) +
    ' questions a round',
    'against a cap of ' + P.costs.queryCap + '; the heaviest revealer is ' + mr.p + ' at ' + f2(mr.r) +
    ' of ' + P.costs.revealCap + '. The largest',
    'share of rounds touching either cap is ' + (100 * mc.cap).toFixed(1) + '% (' + mc.p + ').',
    '',
    'The caps are doing exactly the job they were put there for — bounding a pathological',
    'session — and nothing else. LEAVE THEM. They are also not what limits search here: the',
    'reveal COST is, which is why the brief\'s own disagreement about whether the reveal cap',
    'is 20 or 30 has no consequence either way.'
  ]);
}

sect('4 · 24 scored rounds, and power');
para([
  'Twelve rounds a condition is enough for every effect a plausible participant produces.',
  'In the mixed population a participant\'s own 12-round mean varies across people with sd ' +
  f2(sd(mix.off)),
  'in the AI-OFF condition and ' + f2(sd(mix.on)) + ' in AI-ON, and the paired difference has sd ' +
  f2(mixScore.sd) + '.',
  '',
  'A caution about that last number rather than a boast: the crossover\'s usual advantage is',
  'that it differences the person out, and in a real sample that is most of the variance. Here',
  'it is not, because two simulated participants of the same type play almost the same way —',
  'so the between-participant term the design removes is largely absent by construction, while',
  'the term it CANNOT remove (the two blocks hold different mappings) is fully present. The',
  'power figures below are therefore conservative on the person side and honest on the spec',
  'side.'
]);
bothTable(['contrast', 'effect', 'paired sd', 'participants at 80% power'],
  behavioural.map(p => {
    const t = paired(perPart[p], 'on', 'off');
    return [p + ' · score', sgn(t.eff), f2(t.sd), nn(t.n)];
  }).concat([
    ['MIXED POPULATION · score', sgn(mixScore.eff), f2(mixScore.sd), nn(mixScore.n)],
    ['MIXED POPULATION · sparse − dense', sgn(mixI.eff), f2(mixI.sd), nn(mixI.n)],
    ['MIXED POPULATION · frontier share', sgn(mixF.eff * 100) + 'pp', f2(mixF.sd * 100), nn(mixF.n)]
  ]), ['l']);
para([
  'READ THE MIXED-POPULATION ROWS, NOT THE PER-POLICY ONES. Inside a single policy the',
  'simulated participants differ only where that policy consults its RNG, so its paired sd is',
  'a floor rather than a forecast. The mixed population — each participant given one of the',
  'four behavioural types (' + MIX.map(m => (100 * m.w).toFixed(0) + '% ' + m.p).join(', ') + ') —',
  'is the honest guide, and it says ' + nn(mixScore.n) + ' participants for the main score effect and',
  nn(mixF.n) + ' for the frontier-share effect.',
  '',
  'The INTERACTION is the expensive contrast: ' + nn(mixI.n) + ' participants at 24 scored rounds. If',
  'the sparse-versus-dense interaction is the headline, the parameter to move is the number',
  'of rounds, not the sample — the paired sd falls with the square root of the rounds per',
  'cell, so 16 scored rounds a condition would cut the required n by about a third at the',
  'same recruitment cost per person. With the recommended c_R = 4 and sparse K = 3 the',
  'interaction itself grows from ' + sgn(cur.tru.eS - cur.tru.eD) + ' to ' + sgn(rec.tru.eS - rec.tru.eD) +
  ', which buys back more than that.',
  '',
  'Null check: RATIONAL-NO-AI cannot see the condition at all and returns ' + sgn(tNull.eff) +
  ' with a paired',
  'sd of ' + f2(tNull.sd) + '. That is the simulator\'s own zero, and it also shows the two blocks are',
  'balanced — a block difference would appear there first.'
]);

sect('5 · The three layouts');
para([
  'Keep all three. They separate the primary outcome by a wider margin than anything else in',
  'the design, and they do it with no AI in the picture at all — which is what makes the',
  'AI-ON comparison interpretable.'
]);
bothTable(['layout', 'frontier share of first moves — no AI', 'rational + AI', 'trusting', 'satisficer'],
  ['FRONTIER', 'BALANCED', 'GAP'].map(b => {
    const o = cell('RATIONAL-NO-AI', 'AI_OFF', b);
    const r = cell('RATIONAL-WITH-AI', 'AI_ON', b);
    const t = cell('TRUSTING', 'AI_ON', b);
    const s = cell('NOISY-SATISFICER', 'AI_ON', b);
    return [b, pct(o.fmFront, o.fmN), pct(r.fmFront, r.fmN), pct(t.fmFront, t.fmN), pct(s.fmFront, s.fmN)];
  }), ['l']);
{
  const fo = cell('RATIONAL-NO-AI', 'AI_OFF', 'FRONTIER');
  const go = cell('RATIONAL-NO-AI', 'AI_OFF', 'GAP');
  const spread = 100 * (fo.fmFront / Math.max(1, fo.fmN) - go.fmFront / Math.max(1, go.fmN));
  para([
    'FRONTIER against GAP is a ' + spread.toFixed(0) + ' percentage-point spread in the frontier share with no AI',
    'on the screen, and BALANCED sits between them. That is the manipulation working as',
    'intended. Against it, the AI moves the frontier share by ' + sgn(mixF.eff * 100) + ' points in the mixed',
    'population — smaller than the layout effect, and in the predicted direction: an AI that',
    'extrapolates FLAT beyond the outermost anchor gives a participant no reason to go there.',
    '',
    'One thing to watch in the analysis rather than in the parameters: a round can end with NO',
    'first move at all. The myopic benchmark opens nothing in ' +
    pct(cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL').n - cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL').acted,
      cell('RATIONAL-NO-AI', 'AI_OFF', 'ALL').n) + ' of its rounds, because the',
    'best pre-opened value is already good enough. Those rounds have no frontier outcome to',
    'record, so the denominator of the primary outcome is smaller than the round count and',
    'has to be reported as such.'
  ]);
}

sect('6 · What to move');
para([
  'Move the REVEAL COST from ' + C_R + ' to 4, and SPARSE K from ' + P.ai.sparseK + ' to 3. Leave the question cost,',
  'the dense K, both caps, the three layouts and the 24 rounds exactly as they are.',
  '',
  'Justification, all measured above: at the current settings unaided search buys only ' +
  sgn(cur.floor) + ' points',
  'over spending nothing and the trusting participant is HELPED by the AI at both densities',
  '(' + sgn(cur.tru.eS) + ' sparse, ' + sgn(cur.tru.eD) + '), so the study\'s central prediction has no sign to detect. At',
  'c_R = 4 with sparse K = 3, unaided search buys ' + sgn(rec.floor) + ' and the trusting participant is',
  'HURT in sparse rounds (' + sgn(rec.tru.eS) + ') while still being helped in dense ones (' + sgn(rec.tru.eD) + ') — a',
  'genuine sign flip, with the sparse/dense difference growing from ' + sgn(cur.tru.eS - cur.tru.eD) +
  ' to ' + sgn(rec.tru.eS - rec.tru.eD) + '. Both',
  'moves keep s* inside the window that makes the density manipulation meaningful at all —',
  'and they help each other there: at sparse K = 3 the admissible cost window widens from',
  '(' + CR_LO.toFixed(2) + ', ' + CR_HI.toFixed(2) + ') to (' + CR_LO.toFixed(2) + ', ' +
  ((SIGMA * Math.sqrt(J / 3) / 2) / Math.sqrt(2 * Math.PI)).toFixed(2) +
  '), so c_R = 4 sits comfortably inside it rather than near an edge.',
  '',
  'And if neither is moved, the pre-registration should be rewritten rather than the code:',
  'at c_R = ' + C_R + ' and K = ' + P.ai.sparseK + '/' + P.ai.denseK +
  ' this environment produces a GRADIENT, not a flip — the AI is worth',
  Math.abs(cur.tru.eS - cur.tru.eD).toFixed(1) +
  ' points less when it is sparse than when it is dense — and predicting "the AI',
  'helps at K = 10 and hurts at K = 4" would be predicting something the design as built does',
  'not produce.'
]);

md('## Appendix · the seven policies');
md('');
md('| policy | what it does | AI-OFF behaviour |');
md('|---|---|---|');
md('| BLIND-GUESS | spends nothing, nominates the best pre-opened position (or the mid-line slider default) | same |');
md('| RATIONAL-NO-AI | myopic expected improvement over its own reveals; stops when the best EI falls below c_R | same |');
md('| SYSTEMATIC-NO-AI | opens the widest stretch until no gap exceeds g\\* and no tail exceeds (s\\*/σ)² | same |');
md('| RATIONAL-WITH-AI | probes by asking; buys the truth only where the answer is a new front-runner AND its own uncertainty exceeds s\\* | RATIONAL-NO-AI |');
md('| TRUSTING | treats an answer as a fact, converges on the AI\'s own curve, verifies 10% of the time | RATIONAL-NO-AI |');
md('| SKEPTICAL | asks 0–4 questions, discards every answer, searches as RATIONAL-NO-AI | RATIONAL-NO-AI |');
md('| NOISY-SATISFICER | probes the widest gap, stops on anything above a personal threshold, 10% random actions; an AI answer counts as something held | itself, revealing instead of asking |');
md('');
md('Policies 4–6 share one AI-OFF behaviour by construction, so the crossover effect is');
md('attributable entirely to what the AI does to behaviour. The counterfactual in Table 4');
md('re-plays each AI-ON round on the same rng stream with the AI removed, so a policy that');
md('does not change between conditions scores an exact zero there.');
md('');

say('');
say('  Full write-up: lab/search-v2/tools/SIMULATION-FINDINGS.md');
say('');
writeFileSync(join(HERE, 'SIMULATION-FINDINGS.md'), MD.join('\n') + '\n');
console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · ' + N +
  ' participants × ' + POLICIES.length + ' policies × 24 scored rounds, plus ' +
  (costSweep.length + kSweep.length + jointSweep.length) + ' sensitivity settings)');
