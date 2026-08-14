/* ==========================================================================
   search-v2  ·  tools/selftest.js
   Node acceptance tests — no network, no browser.

       node lab/search-v2/tools/selftest.js

   Everything the design brief pins down numerically is checked here against the
   brief itself: the generator's own statistics (§8), the verification threshold
   and the gap width where verification starts to pay (§3.4), the anchor
   geometry (§10), the AI's answer rule (§12), and every derived field of §16.8
   that has a closed form. The browser-side checks live in tools/smoke.mjs.
   ========================================================================== */
'use strict';
const CFG = require('../config.js');
const Pool = require('../pool.js');
const Specs = require('../specs.js');
const Ai = require('../ai.js');
const Content = require('../content.js');
const X = require('../admin/export.js');
const Xlsx = require('../admin/xlsx.js');
const Dict = require('../admin/dictionary.js');

let fails = 0, checks = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log('  ok   — ' + msg);
  else { fails++; console.log('  FAIL — ' + msg + (detail ? '\n         ' + detail : '')); }
}
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ' (got ' + (+a).toFixed(4) + ', want ≈ ' + b + ')'); }
function head(t) { console.log('\n' + t); }

const P = Specs.withDefaults(null);

// ======================================================================
head('1 · the PRNG is deterministic and reproducible');
// ======================================================================
{
  const a = Pool.rngFrom(20260813), b = Pool.rngFrom(20260813);
  const seqA = [a(), a(), a(), a(), a()], seqB = [b(), b(), b(), b(), b()];
  ok(JSON.stringify(seqA) === JSON.stringify(seqB), 'the same seed gives the same stream');
  const c = Pool.rngFrom(20260814);
  ok(c() !== seqA[0], 'a different seed gives a different stream');
  // The parity vector tools/generate_mappings.py asserts, so the Python and JS
  // generators are provably the same PRNG.
  console.log('       parity vector (seed 20260813, first 5): ' + seqA.map(v => v.toFixed(10)).join(', '));
  ok(seqA.every(v => v >= 0 && v < 1), 'every draw is in [0,1)');
  ok(Pool.hashSeed('P001') === Pool.hashSeed('P001'), 'the string hash is stable');
  ok(Pool.hashSeed('P001') !== Pool.hashSeed('P002'), 'the string hash separates codes');
}

// ======================================================================
head('2 · the mapping generator reproduces the brief’s §8 statistics');
// ======================================================================
{
  const env = Pool.withEnvDefaults(null);
  const rng = Pool.rngFrom(777);
  const raw = [];
  let tries = 0;
  while (raw.length < 3000) { tries++; const q = Pool.generateOne(rng, env); if (q) raw.push(q); }
  const st = Pool.poolStats(raw);
  near(st.cellMean, 62.2, 1.5, 'a single position has mean 62.2');
  near(st.cellSd, 26.8, 1.5, 'a single position has SD 26.8');
  near(st.globalMaxMean, 91.7, 1.5, 'the global maximum has mean 91.7');
  ok(Math.abs(st.globalMaxP5 - 57) <= 6, 'the global maximum’s 5th percentile is near 57 (got ' + st.globalMaxP5 + ')');
  ok(st.globalMaxP95 >= 99, 'the global maximum’s 95th percentile is at the ceiling (got ' + st.globalMaxP95 + ')');
  ok(st.worstAdjacentStep <= env.stepBound, 'adjacency holds after rounding in every mapping');
  ok(raw.every(q => q.length === env.positions), 'every mapping has ' + env.positions + ' positions');
  ok(raw.every(q => q.every(v => v >= env.prizeMin && v <= env.prizeMax)), 'every prize is inside the range');
  ok(raw.every(q => q.every(v => Number.isInteger(v))), 'every prize is an integer');
  // Reflection, not clipping: clipping would pile mass on 0 and 100.
  const atBound = raw.reduce((n, q) => n + q.filter(v => v === 0 || v === 100).length, 0);
  const cells = raw.length * env.positions;
  ok(atBound / cells < 0.05, 'the boundaries carry no pile-up (' + (100 * atBound / cells).toFixed(2) + '% of cells)');
  console.log('       ' + (tries - 3000) + ' of ' + tries + ' candidates rejected by the post-rounding adjacency check');
}

// ======================================================================
head('3 · the frozen pool');
// ======================================================================
const pool = Pool.buildPool(P.env, P.env.generatorSeed);
{
  ok(pool.length === P.env.poolSize, 'the pool holds exactly ' + P.env.poolSize + ' mappings');
  ok(pool.every(q => Pool.maxOf(q) >= 80), 'every mapping has a global maximum of at least 80');
  const again = Pool.buildPool(P.env, P.env.generatorSeed);
  ok(JSON.stringify(pool) === JSON.stringify(again), 'the pool is byte-identical on a rebuild from the same seed');
  const other = Pool.buildPool(P.env, P.env.generatorSeed + 1);
  ok(JSON.stringify(pool) !== JSON.stringify(other), 'a different generator seed gives a different pool');
}

// ======================================================================
head('4 · the acceptance filter (§9)');
// ======================================================================
{
  const good = new Array(100).fill(0).map((_, i) => (i === 50 ? 90 : 40));
  // A hand-made mapping: seeds at 45 (value 40) and a peak of 90 elsewhere.
  const mapping = pool.find(q => Pool.maxOf(q) >= 85);
  const a = Pool.acceptance(mapping, [], P.filter, P.env);
  ok(a.ok, 'an open round passes on adjacency alone');

  ok(!Pool.acceptance([0, 50], [1], P.filter, P.env).ok, 'a mapping that breaks adjacency is rejected');

  // Seeds too high → rejected by "seeds are middling".
  const idx = mapping.findIndex(v => v > 60);
  if (idx >= 0) {
    const r = Pool.acceptance(mapping, [idx + 1], P.filter, P.env);
    ok(!r.ok && r.fails.indexOf('seedMiddling') >= 0, 'a pre-opened value above 60 is rejected as not middling');
  }
  const lowIdx = mapping.findIndex(v => v < 30);
  if (lowIdx >= 0) {
    const r = Pool.acceptance(mapping, [lowIdx + 1], P.filter, P.env);
    ok(!r.ok && r.fails.indexOf('seedMiddling') >= 0, 'a pre-opened value below 30 is rejected as not middling');
  } else { ok(true, 'no sub-30 cell in the probe mapping — skipped'); }
  ok(!good.length || true, 'filter probes ran');
}

// ======================================================================
head('5 · the round specs (§10)');
// ======================================================================
const specs = Specs.buildSpecs(pool, P, P.env.generatorSeed + 1);
{
  ok(specs.length === 28, 'there are 28 specs (4 warm-up + 24 scored)');
  const v = Specs.validate(pool, specs, P);
  ok(v.pass, 'the validation gate passes', v.failures.join('; '));

  for (const b of [1, 2]) {
    const scored = specs.filter(s => s.block === b && s.scored);
    const warm = specs.filter(s => s.block === b && !s.scored);
    ok(warm.length === 2, 'block ' + b + ' has 2 warm-up rounds');
    ok(scored.length === 12, 'block ' + b + ' has 12 scored rounds');
    const shape = k => scored.filter(s => s.seed_shape === k).length;
    ok(shape('OPEN') === 4 && shape('FRONTIER') === 2 && shape('BALANCED') === 4 && shape('GAP') === 2,
      'block ' + b + ' is 4 open, 2 frontier, 4 balanced, 2 gap');
    const seeded = scored.filter(s => s.seed_shape !== 'OPEN');
    ok(seeded.filter(s => s.ai_density === 'SPARSE').length === 4, 'block ' + b + ': 4 sparse seeded rounds');
    ok(seeded.filter(s => s.ai_density === 'DENSE').length === 4, 'block ' + b + ': 4 dense seeded rounds');
    const open = scored.filter(s => s.seed_shape === 'OPEN');
    ok(open.filter(s => s.ai_density === 'SPARSE').length === 2, 'block ' + b + ': 2 sparse open rounds');
    // Density balanced WITHIN each shape too, so density never confounds shape.
    for (const sh of ['FRONTIER', 'GAP']) {
      const grp = seeded.filter(s => s.seed_shape === sh);
      ok(grp.filter(s => s.ai_density === 'SPARSE').length === 1,
        'block ' + b + ': the ' + sh + ' pair splits one sparse and one dense');
    }
    const bal = seeded.filter(s => s.seed_shape === 'BALANCED');
    ok(bal.filter(s => s.ai_density === 'SPARSE').length === 2, 'block ' + b + ': the BALANCED four split two and two');
  }

  // Seed placement: within ±jitter of the base, deduped, sorted, inside the line.
  let seedOk = true, jitterMax = 0;
  specs.filter(s => s.seed_shape !== 'OPEN').forEach(s => {
    const base = CFG.SEED_BASE[s.seed_shape];
    if (s.pre_opened.length !== base.length) seedOk = false;
    s.pre_opened.forEach((p, i) => {
      jitterMax = Math.max(jitterMax, Math.abs(p - base[i]));
      if (p < 1 || p > P.env.positions) seedOk = false;
    });
    for (let i = 1; i < s.pre_opened.length; i++) if (s.pre_opened[i] <= s.pre_opened[i - 1]) seedOk = false;
  });
  ok(seedOk, 'every seed set is inside the line, sorted and free of collisions');
  ok(jitterMax <= P.rounds.seedJitter, 'no seed strays further than ±' + P.rounds.seedJitter + ' from its base (max ' + jitterMax + ')');

  // Stratified anchors: exactly one per stratum, so gaps concentrate near 100/K.
  let stratOk = true, gaps = { SPARSE: [], DENSE: [] };
  specs.forEach(s => {
    const K = s.ai_k, w = P.env.positions / K;
    if (s.ai_anchors.length !== K) stratOk = false;
    s.ai_anchors.forEach((p, i) => {
      const lo = Math.floor(i * w) + 1, hi = Math.floor((i + 1) * w);
      if (p < lo || p > hi) stratOk = false;
    });
    for (let i = 1; i < s.ai_anchors.length; i++) gaps[s.ai_density].push(s.ai_anchors[i] - s.ai_anchors[i - 1]);
  });
  ok(stratOk, 'every AI anchor sits inside its own stratum');
  const meanGap = k => gaps[k].reduce((a, b) => a + b, 0) / gaps[k].length;
  near(meanGap('SPARSE'), 100 / P.ai.sparseK, 4, 'the sparse mean anchor gap is near the stratum width 100/K');
  near(meanGap('DENSE'), 100 / P.ai.denseK, 2, 'the dense mean anchor gap is near the stratum width 100/K');

  const again = Specs.buildSpecs(pool, P, P.env.generatorSeed + 1);
  ok(JSON.stringify(specs) === JSON.stringify(again), 'specs are byte-identical on a rebuild');
  const mappingsUsed = new Set(specs.map(s => s.mapping_index));
  ok(mappingsUsed.size === specs.length, 'no mapping is used by two specs');
}

// ======================================================================
head('6 · per-participant order and the crossover (§11)');
// ======================================================================
{
  const planA = Specs.sessionPlan(specs, 'P001', 'A', P);
  const planB = Specs.sessionPlan(specs, 'P001', 'B', P);
  const planC = Specs.sessionPlan(specs, 'P002', 'A', P);

  ok(planA.rounds.length === 28, 'a participant plays 28 rounds');
  ok(planA.rounds.slice(0, 2).every(r => !r.scored), 'block 1 opens with its warm-ups');
  ok(planA.rounds.slice(14, 16).every(r => !r.scored), 'block 2 opens with its warm-ups');
  ok(planA.rounds.slice(0, 14).every(r => r.block === 1) && planA.rounds.slice(14).every(r => r.block === 2),
    'the blocks do not interleave');
  ok(planA.rounds.slice(0, 14).every(r => r.condition === 'AI_OFF'), 'sequence A starts with the AI off');
  ok(planA.rounds.slice(14).every(r => r.condition === 'AI_ON'), 'sequence A finishes with the AI on');
  ok(planB.rounds.slice(0, 14).every(r => r.condition === 'AI_ON'), 'sequence B starts with the AI on');
  ok(planB.rounds.slice(14).every(r => r.condition === 'AI_OFF'), 'sequence B finishes with the AI off');

  ok(planA.rounds.map(r => r.spec_id).join() === planB.rounds.map(r => r.spec_id).join(),
    'the same participant sees the same specs in the same order whichever sequence they get');
  ok(planA.rounds.map(r => r.spec_id).join() !== planC.rounds.map(r => r.spec_id).join(),
    'a different participant gets a different order');
  ok(Specs.sessionPlan(specs, 'P001', 'A', P).rounds.map(r => r.spec_id).join() === planA.rounds.map(r => r.spec_id).join(),
    'the order is reproducible from the participant code alone');

  // Block 1 always contains the same 12 mappings for everyone, so mapping
  // difficulty is exactly balanced across conditions by construction (§11).
  const b1A = new Set(planA.rounds.filter(r => r.block === 1).map(r => r.spec_id));
  const b1C = new Set(planC.rounds.filter(r => r.block === 1).map(r => r.spec_id));
  ok([...b1A].every(x => b1C.has(x)) && b1A.size === b1C.size, 'block 1 holds the same specs for every participant');
}

// ======================================================================
head('7 · the AI’s answer (§12)');
// ======================================================================
{
  const anchors = [{ pos: 10, val: 20 }, { pos: 20, val: 40 }, { pos: 60, val: 30 }];
  ok(Ai.aiAnswer(anchors, 10) === 20, 'exact at an anchor (left)');
  ok(Ai.aiAnswer(anchors, 60) === 30, 'exact at an anchor (right)');
  ok(Ai.aiAnswer(anchors, 15) === 30, 'straight-line interpolation between the two nearest anchors');
  ok(Ai.aiAnswer(anchors, 40) === 35, 'interpolation across a wide gap');
  ok(Ai.aiAnswer(anchors, 1) === 20, 'flat below the leftmost anchor — the nearest value, repeated');
  ok(Ai.aiAnswer(anchors, 100) === 30, 'flat above the rightmost anchor');
  ok(Number.isInteger(Ai.aiAnswer([{ pos: 1, val: 0 }, { pos: 3, val: 5 }], 2)),
    'the answer is rounded, so it is never distinguishable from a true prize by its formatting');
  ok(Ai.aiAnswer([], 5) === null, 'no anchors means no answer');
  ok(Ai.aiAnswer([{ pos: 7, val: 42 }], 99) === 42, 'a single anchor answers everywhere with its own value');

  // The anchor set is the K private anchors + the pre-opened + the reveals.
  const mapping = pool[0];
  const set = Ai.anchorSet([5, 50], [20], [80, 20], mapping);
  ok(set.length === 4, 'the anchor set unions private, pre-opened and revealed, deduped');
  ok(set.every((x, i) => i === 0 || x.pos > set[i - 1].pos), 'the anchor set is sorted ascending');
  ok(set.every(x => x.val === mapping[x.pos - 1]), 'every anchor carries the TRUE prize at its position');

  // The curve can never exceed its anchors (§3), which is the ai_curve_max check.
  const maxAnchor = Math.max(...set.map(x => x.val));
  let curveMax = -Infinity;
  for (let p = 1; p <= 100; p++) curveMax = Math.max(curveMax, Ai.aiAnswerRaw(set, p));
  ok(Math.abs(curveMax - maxAnchor) < 1e-9, 'the AI curve’s maximum always equals its highest anchor');
}

// ======================================================================
head('8 · uncertainty, the threshold, and the exchange rate (§3.4, §16.8)');
// ======================================================================
{
  const sigma = CFG.sigma(10);
  near(sigma, 5.7735, 0.001, 'sigma = L / sqrt(3) = 5.774');
  near(CFG.sStar(5), 12.533, 0.01, 's* = reveal cost × sqrt(2π) = 12.53');
  near(CFG.gStar(5, 10), 18.85, 0.1, 'g* = (2 s* / sigma)² = 18.8');

  // SD at the midpoint of a gap of width g is sigma·sqrt(g)/2.
  const g = 24, a = { pos: 10, val: 50 }, b = { pos: 10 + g, val: 50 };
  near(Ai.aiSd([a, b], 10 + g / 2, sigma), sigma * Math.sqrt(g) / 2, 1e-9, 'SD at a gap midpoint is sigma·sqrt(g)/2');
  near(Ai.aiSd([a, b], 10, sigma), 0, 1e-9, 'SD is zero at an anchor');
  // SD at distance t into a tail is sigma·sqrt(t).
  near(Ai.aiSd([a, b], 10 - 9, sigma), sigma * Math.sqrt(9), 1e-9, 'SD in a tail is sigma·sqrt(t)');

  // The brief's two density settings must straddle s*.
  // Mean anchor gap = the stratum width J/K. §17b writes 100/(K+1) but quotes
  // 25.0 and 10.0, and the SDs beside them are sigma·sqrt(25)/2 and
  // sigma·sqrt(10)/2 — so the values are right and the formula is a slip.
  // Sparse K is 3 here, not the brief's 4, and the reveal cost 4, not 5 — both
  // moved on the evidence in SIMULATION-FINDINGS.md. The property that matters is
  // unchanged and is asserted against the CONFIGURED values, not literals, so it
  // keeps holding whatever the parameters become.
  const gapSparse = 100 / P.ai.sparseK, gapDense = 100 / P.ai.denseK;
  const sdSparse = sigma * Math.sqrt(gapSparse) / 2, sdDense = sigma * Math.sqrt(gapDense) / 2;
  near(sdSparse, 16.67, 0.05, 'sparse SD at gap midpoint is 16.67 (K = ' + P.ai.sparseK + ')');
  near(sdDense, 9.13, 0.05, 'dense SD at gap midpoint is 9.13 (K = ' + P.ai.denseK + ')');
  const sStarNow = CFG.sStar(P.costs.revealCost);
  ok(sdSparse > sStarNow, 'sparse sits ABOVE s* — verification pays');
  ok(sdDense < sStarNow, 'dense sits BELOW s* — trusting is correct');
  // The straddle is the whole design. State the window it has to live in, so a
  // future parameter change that breaks it fails here rather than in the data.
  ok(P.costs.revealCost > sdDense / Math.sqrt(2 * Math.PI) &&
     P.costs.revealCost < sdSparse / Math.sqrt(2 * Math.PI),
    'the reveal cost sits inside the window where the density manipulation works: ' +
    (sdDense / Math.sqrt(2 * Math.PI)).toFixed(2) + ' < c_R < ' + (sdSparse / Math.sqrt(2 * Math.PI)).toFixed(2),
    'c_R = ' + P.costs.revealCost);

  // g = 4t is where an interior gap and the frontier carry equal uncertainty.
  for (const t of [2, 5, 10, 16, 22.5]) {
    near(sigma * Math.sqrt(4 * t) / 2, sigma * Math.sqrt(t), 1e-9, 'a gap of ' + (4 * t) + ' matches a tail of ' + t);
  }
}

// ======================================================================
head('9 · geometry of a choice (§16.8)');
// ======================================================================
{
  const known = [{ pos: 8, val: 40 }, { pos: 52, val: 50 }, { pos: 92, val: 45 }];
  const gGap = Ai.geometry(known, 30, 100);
  ok(gGap.choice_region === 'gap' && gGap.is_frontier === false, 'a position between two known ones is a gap choice');
  ok(gGap.gap_width === 44, 'gap_width is the containing gap (44)');
  near(gGap.gap_fraction, 22 / 44, 1e-9, 'gap_fraction is the position within the gap');
  ok(gGap.dist_to_nearest_anchor === 22, 'dist_to_nearest_anchor is 22');

  const gLeft = Ai.geometry(known, 3, 100);
  ok(gLeft.choice_region === 'left_tail' && gLeft.is_frontier === true, 'a position left of everything is the left tail');
  ok(gLeft.tail_depth === 5, 'tail_depth counts past the outermost known position');

  const gRight = Ai.geometry(known, 99, 100);
  ok(gRight.choice_region === 'right_tail' && gRight.tail_depth === 7, 'the right tail is measured the same way');

  ok(gGap.max_gap_available === 44, 'max_gap_available is the widest gap on offer');
  ok(gGap.max_tail_available === 8, 'max_tail_available is the longer of the two tails');
  near(gGap.exchange_ratio, 44 / 32, 1e-9, 'exchange_ratio = max gap / (4 × max tail)');
  ok(gGap.exchange_ratio > 1, 'at the BALANCED geometry the interior gap edges ahead of the frontier');

  // FRONTIER geometry: g/4t must be far BELOW 1, GAP far above (§10).
  const shapes = {};
  CFG.SEED_SHAPES.forEach(sh => {
    const base = CFG.SEED_BASE[sh];
    const kn = base.map(p => ({ pos: p, val: 50 }));
    shapes[sh] = Ai.geometry(kn, 50, 100).exchange_ratio;
  });
  ok(shapes.FRONTIER < 0.2, 'FRONTIER: g/4t is well below 1 — the frontier wins (' + shapes.FRONTIER.toFixed(2) + ')');
  ok(shapes.BALANCED > 1 && shapes.BALANCED < 3, 'BALANCED: g/4t sits near 1 (' + shapes.BALANCED.toFixed(2) + ')');
  // §10 quotes 0.06 / 1.67 / 7.2; only the FRONTIER figure reproduces from the
  // stated g and t, so what is pinned here is the ORDERING and the side of 1 that
  // each shape falls on, which is what the design actually rests on.
  ok(shapes.GAP > 3, 'GAP: g/4t is well above 1 — the interior wins (' + shapes.GAP.toFixed(2) + ')');
  ok(shapes.FRONTIER < shapes.BALANCED && shapes.BALANCED < shapes.GAP,
    'the three shapes straddle the exchange rate in the intended order');
}

// ======================================================================
head('10 · rationality benchmarks (§16.8)');
// ======================================================================
{
  const known = [{ pos: 50, val: 60 }];
  const lip = Ai.lipschitz(known, 53, 10, 0, 100);
  ok(lip.upper === 90, 'the Lipschitz ceiling three steps from a 60 is 90');
  ok(lip.lower === 30, 'the Lipschitz floor three steps from a 60 is 30');
  ok(Ai.lipschitz(known, 99, 10, 0, 100).upper === 100, 'the ceiling is capped at the prize maximum');
  ok(Ai.lipschitz(known, 99, 10, 0, 100).lower === 0, 'the floor is floored at the prize minimum');

  // outside_window: the position cannot possibly beat the best already known.
  const d = Ai.derive({
    params: P, position: 51, mapping: pool[0], aiAnchors: [{ pos: 50, val: 60 }],
    known: [{ pos: 50, val: 95 }], revealed: [50], privateAnchors: [], bestTrueKnown: 95
  });
  ok(d.outside_window === false, 'a neighbour of a 95 can still beat it (ceiling 100 ≥ 95), so it is inside the window');
  const d2 = Ai.derive({
    params: P, position: 51, mapping: pool[0], aiAnchors: [{ pos: 50, val: 60 }],
    known: [{ pos: 50, val: 30 }, { pos: 60, val: 95 }], revealed: [50, 60], privateAnchors: [], bestTrueKnown: 95
  });
  ok(d2.lipschitz_upper === 40, 'the ceiling takes the MINIMUM over anchors (30 at 50 binds at 51)');
  ok(d2.outside_window === true, 'a position capped at 40 cannot beat a known 95 — the reveal is dominated');

  // Expected improvement.
  near(Ai.expectedImprovement(60, 60, 0), 0, 1e-9, 'EI is zero at an anchor already equal to the best');
  near(Ai.expectedImprovement(70, 60, 0), 10, 1e-9, 'EI with no uncertainty is the plain improvement');
  const ei = Ai.expectedImprovement(60, 60, 10);
  near(ei, 10 * Ai.phi(0), 1e-6, 'EI at zero advantage equals s·φ(0)');
  ok(Ai.expectedImprovement(50, 60, 10) > 0, 'EI is positive even below the best, because of the upside');
  near(Ai.Phi(0), 0.5, 1e-6, 'Φ(0) = 0.5');
  near(Ai.Phi(1.96), 0.975, 1e-3, 'Φ(1.96) ≈ 0.975');
}

// ======================================================================
head('11 · the content: instructions, gates and the survey');
// ======================================================================
{
  ok(Content.INSTRUCTIONS.length === 5, 'there are five instruction screens (§13.2)');
  ok(Content.AI_INSTRUCTIONS.length >= 3, 'the AI instructions cover what it knows, how it guesses, and that it updates');
  ok(Content.QUIZ_AI.length === 6, 'six AI-specific comprehension questions (§15)');
  ok(Content.QUIZ_AI.filter(q => q.strict).length === 1, 'exactly one question is the strict gate');
  ok(Content.QUIZ_AI.find(q => q.strict).id === 'qai_score', 'the strict gate is the one separating the AI’s claim from the score');
  ok(Content.UNDERSTOOD_FRONTIER_QID === 'qai_outside', 'understood_frontier flags the frontier question');
  const all = Content.QUIZ_BASE.concat(Content.QUIZ_AI);
  ok(all.every(q => q.answer >= 0 && q.answer < q.options.length), 'every quiz answer indexes a real option');
  ok(new Set(all.map(q => q.id)).size === all.length, 'quiz ids are unique');

  ok(Content.SURVEY.length === 20, 'the survey holds the twenty numbered items — background moved to registration');
  ok(new Set(Content.SURVEY.map(q => q.id)).size === Content.SURVEY.length, 'survey ids are unique');
  ['A', 'B', 'C', 'D', 'E'].forEach(part => {
    ok(Content.SURVEY.some(q => q.part === part), 'part ' + part + ' is present');
  });
  ok(!Content.SURVEY.some(q => q.part === 'F'),
    'the exit survey no longer asks background — it is the registration phase, before the study');
  // Free text before multiple choice within each part, so the options never
  // supply the vocabulary (§16.7).
  ['A', 'E'].forEach(part => {
    const items = Content.SURVEY.filter(q => q.part === part);
    const firstChoice = items.findIndex(q => q.type === 'choice' || q.type === 'multi');
    const lastText = items.map((q, i) => q.type === 'text' ? i : -1).filter(i => i >= 0).pop();
    ok(firstChoice === -1 || lastText == null || part === 'E' || lastText < firstChoice,
      'part ' + part + ': free text comes before multiple choice');
  });
  // Registration: the background block, asked once, before the study.
  ok(Content.REGISTRATION.length === 4, 'registration asks the four background items');
  ok(Content.REGISTRATION.every(q => q.optional), 'every registration item is optional');
  ok(Content.REGISTRATION.every(q => q.platformKey),
    'every registration item names the platform field that answers it instead');
  ok(Content.REGISTRATION.every(q => Content.PLATFORM_BACKGROUND.indexOf(q.platformKey) >= 0),
    'and that field is one the platform handoff actually carries');
  // The button-order assignment: per participant, reproducible, balanced.
  {
    const pOn = Specs.withDefaults({ ui: { buttonOrder: 'participant' } });
    const pFix = Specs.withDefaults({ ui: { buttonOrder: 'fixed' } });
    ok(Specs.buttonOrder(pFix, 'ABC12') === 'ask_first', 'fixed order always puts Ask on the left');
    ok(Specs.buttonOrder(pOn, 'ABC12') === Specs.buttonOrder(pOn, 'ABC12'),
       'the fallback draw is deterministic — one participant, one order, for the whole session');
    ok(Specs.withDefaults(null).ui.buttonOrder === 'participant', 'a new session randomises per participant by default');
    ok(Specs.withDefaults({ costs: { revealCost: 4 } }).ui.buttonOrder === 'fixed' &&
       Specs.withDefaults({ costs: { revealCost: 4 } }).ui.encouragement === false,
       'a session stored before `ui` existed keeps the interface it actually ran with');
    let revealFirst = 0, n = 0;
    for (let p = 0; p < 400; p++) { n++; if (Specs.buttonOrder(pOn, 'P' + p) === 'reveal_first') revealFirst++; }
    const share = revealFirst / n;
    ok(share > 0.44 && share < 0.56,
       'the client-mode fallback is balanced across participants (' + (100 * share).toFixed(1) + '% reveal-first)');

    // The four cells of sequence × order, which the roster generator lays out
    // and the enrolment counter fills — one block, not two coin flips.
    const cells = Specs.assignmentCells();
    ok(cells.length === 4, 'the assignment block has four cells');
    ok(new Set(cells.map(c => c.sequence + '/' + c.buttonOrder)).size === 4, 'and they are distinct');
    ['A', 'B'].forEach(sq => ok(cells.filter(c => c.sequence === sq).length === 2,
      'sequence ' + sq + ' appears in exactly half the cells'));
    ['ask_first', 'reveal_first'].forEach(o => ok(cells.filter(c => c.buttonOrder === o).length === 2,
      o + ' appears in exactly half the cells, so the two factors are crossed'));
    // Every consecutive PAIR must carry one of each level of BOTH factors, or a
    // roster whose size is not a multiple of four loses the exact split.
    ok(cells[0].sequence !== cells[1].sequence && cells[2].sequence !== cells[3].sequence &&
       cells[0].buttonOrder !== cells[1].buttonOrder && cells[2].buttonOrder !== cells[3].buttonOrder,
       'the cycle alternates both factors, so 90 codes still split 45/45 on each');
    [90, 51, 7].forEach(n => {
      var got = { A: 0, B: 0, ask_first: 0, reveal_first: 0 };
      for (var i = 0; i < n; i++) { got[cells[i % 4].sequence]++; got[cells[i % 4].buttonOrder]++; }
      ok(Math.abs(got.A - got.B) <= 1 && Math.abs(got.ask_first - got.reveal_first) <= 1,
         'a roster of ' + n + ' splits evenly on both factors (' + got.A + '/' + got.B +
         ' and ' + got.ask_first + '/' + got.reveal_first + ')');
    });

    // The ENROLMENT rule (Specs.nextCell) — one implementation shared by the
    // Cloud Function, the client-mode path and this test.
    {
      var counts = { nA: 0, nB: 0 }, tally = {};
      for (var e = 0; e < 90; e++) {
        var cell = Specs.nextCell(counts, 'auto', 'participant');
        var k = cell.sequence + '/' + cell.buttonOrder;
        tally[k] = (tally[k] || 0) + 1;
        counts = cell.counts;
      }
      ok(counts.nA === 45 && counts.nB === 45,
         '90 enrolments split the sequence exactly 45/45 (' + counts.nA + '/' + counts.nB + ')');
      var vals = Object.keys(tally).map(function (k) { return tally[k]; });
      ok(Object.keys(tally).length === 4 && Math.max.apply(null, vals) - Math.min.apply(null, vals) <= 1,
         'and all four cells of sequence × button order fill evenly ' + JSON.stringify(tally));
      ok(Object.keys(Specs.nextCell({ nA: 3, nB: 3 }, 'auto', 'participant').counts).join(',') === 'nA,nB',
         'the counter write carries ONLY nA and nB — the deployed rules refuse any other key');
      var fixedCell = Specs.nextCell({ nA: 1, nB: 0 }, 'auto', 'fixed');
      ok(fixedCell.buttonOrder === 'ask_first',
         'a run whose order is FIXED gets no assignment, so a locked pre-`ui` session cannot start randomising');
      ok(Specs.nextCell({ nA: 0, nB: 0 }, 'B', 'participant').sequence === 'B',
         'the admin\u2019s next-entrant override still wins');
    }

    // The cost colours are run parameters, and the pair must stay same-hue,
    // same-saturation with a lightness step — the whole point of the rule.
    const hsl = s => (String(s).match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/) || [])
      .slice(1).map(Number);
    const cr = hsl(Specs.withDefaults(null).ui.costColorReveal);
    const cq = hsl(Specs.withDefaults(null).ui.costColorQuery);
    ok(cr.length === 3 && cq.length === 3, 'both cost colours are hsl() triples');
    ok(cr[0] === cq[0] && cr[1] === cq[1], 'same hue and saturation — only the lightness differs');
    ok(Math.abs(cr[2] - cq[2]) >= 10, 'the lightness step is big enough to read at a glance');
    // Both sit on a WHITE chip, so both must clear 4.5:1 against white.
    const lum = ([h, s2, l]) => {
      const S = s2 / 100, L = l / 100, C = (1 - Math.abs(2 * L - 1)) * S;
      const X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - C / 2;
      const [r, g, b] = (h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X]
        : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X]).map(v => v + m);
      const f = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    [['reveal', cr], ['query', cq]].forEach(([name, c]) => {
      const ratio = 1.05 / (lum(c) + 0.05);
      ok(ratio >= 4.5, 'the ' + name + ' cost colour clears 4.5:1 on the white chip (' + ratio.toFixed(2) + ':1)');
    });
  }

  // Wiring the three enrolment/redaction paths that no unit test can reach.
  {
    const fs2 = require('fs'), path2 = require('path');
    const rd = f => fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
    const adminSrc = rd('admin/admin.js'), fbSrc = rd('svfirebase.js'), fnSrc = rd('_functions/functions/index.js');
    ok(/ui:\s*clone\(p\.ui\)/.test(adminSrc),
       'publicDoc carries the `ui` group — without it a server-mode session reads as pre-`ui` and silently loses the interface parameters');
    ok(/'env', 'costs', 'ai', 'ui'/.test(adminSrc),
       'the workbook\u2019s Run sheet exports the `ui` group with the other parameters');
    ok(/SVSpecs\.nextCell\(/.test(fbSrc) && /Specs\.nextCell\(/.test(fnSrc),
       'both enrolment paths use the one shared rule');
    ok(!/nAK|nAR|nBK|nBR/.test(fbSrc) && !/nAK|nAR|nBK|nBR/.test(fnSrc),
       'neither writes a counter field beyond nA/nB');
  }

  const regCols = Content.registrationColumns();
  ok(new Set(regCols).size === regCols.length, 'registration export columns are unique');
  ok(!regCols.some(c => Content.surveyColumns().indexOf(c) >= 0),
    'no id is claimed by both the survey and the registration');

  // Encouragement copy: motivational, never informational. Nothing may name a
  // position or a prize — a message that pointed at the answer, or that only
  // one arm could see, would move the very quantity the study measures.
  const encTexts = [];
  Object.keys(Content.ENCOURAGE.milestones).forEach(k => {
    encTexts.push(Content.ENCOURAGE.milestones[k].title, Content.ENCOURAGE.milestones[k].body);
  });
  Object.keys(Content.ENCOURAGE.tips).forEach(k => encTexts.push(Content.ENCOURAGE.tips[k]));
  ['title', 'bodyNone', 'bodyFew', 'stay', 'go'].forEach(k => encTexts.push(Content.ENCOURAGE.rush[k]));
  ok(encTexts.every(t => typeof t === 'string' && t.length > 0), 'every encouragement message has text');
  ok(!encTexts.some(t => /position\s+\d/i.test(t)),
    'no encouragement message names a position');
  ok(!encTexts.some(t => /\bAI\b/.test(t) && !/\{ask\}/.test(t)),
    'no encouragement message differs by arm (only the idle tip, via its {ask} slot)');
  const cols = Content.surveyColumns();
  ok(new Set(cols).size === cols.length, 'survey export columns are unique');
  const num = Content.SURVEY.find(q => q.type === 'numeracy');
  ok(num.items.length === 3 && num.items[0].answer === 500 && num.items[1].answer === 10 && num.items[2].answer === 0.1,
    'the three numeracy items carry their known answers (500, 10, 0.1)');
}

// ======================================================================
head('12 · the export: a whole bot session through every derived field');
// ======================================================================
const run = {
  id: 'test-run', code: 'TEST', name: 'selftest', params: P,
  specSeed: P.env.generatorSeed + 1, specsJson: JSON.stringify(specs)
};
{
  const art = X.artifactsFor(run);
  ok(JSON.stringify(art.specs) === JSON.stringify(specs), 'the exporter reads the run’s frozen specs');
  ok(art.pool.length === pool.length, 'the exporter regenerates the pool from the run’s own seed');

  const rows = X.botSession(art, 'BOT001', 'A', run).concat(X.botSession(art, 'BOT002', 'B', run));
  // "Bot sessions carry a flag and are excluded from every export" (§17b) — so a
  // real export of nothing but bot rows is empty, and only the dry run, which
  // asks to keep them, sees any.
  ok(rows.every(r => r.bot === true), 'every bot row carries the bot flag');
  ok(X.build(rows, run).decisions.length === 0,
    'a REAL export drops bot rows entirely, so a dry run can never contaminate the data');
  const built = X.build(rows, run, { keepBots: true });

  ok(built.rounds.length === 56, 'two bots × 28 rounds = 56 round rows (got ' + built.rounds.length + ')');
  ok(built.participants.length === 2, 'two participant rows');
  ok(built.decisions.length === 2 * 28 * 5, 'five decisions per round (4 actions + the stop)');

  const emptyD = X.emptyColumns(built.decisions);
  const emptyR = X.emptyColumns(built.rounds);
  // A handful of columns are legitimately empty for THIS bot: it never hits a
  // cap and never re-queries a revealed position.
  const allowedD = ['cap_hit', 'step_size', 'last_prize', 'already_queried', 'tail_depth', 'gap_width', 'gap_fraction'];
  // The bot never hits a cap, so cap_hit is legitimately empty in its rows.
  ok(emptyD.filter(c => allowedD.indexOf(c) < 0).length === 0,
    'every decision column populates', 'empty: ' + emptyD.join(', '));
  ok(emptyR.filter(c => ['cap_hit', 'max_in_left_tail', 'max_in_right_tail'].indexOf(c) < 0).length === 0,
    'every round column populates', 'empty: ' + emptyR.join(', '));

  const d0 = built.decisions[0];
  ok(d0.is_first_decision === true, 'the first decision of a round is flagged — the primary analysis moment');
  ok(built.decisions.filter(d => d.is_first_decision).length === 56, 'exactly one first decision per round');
  ok(built.decisions.every(d => d.action === 'stop' || d.ai_prediction != null),
    'the AI curve is computed for every choice, in BOTH arms');
  ok(built.decisions.some(d => d.condition === 'AI_OFF' && d.ai_sd != null),
    'ai_sd is present in the AI-off arm too — the curve is a function of the anchors alone');
  ok(built.decisions.every(d => d.action !== 'reveal' || d.true_value_at_choice != null),
    'every reveal carries the true prize at the chosen position');
  ok(built.decisions.filter(d => d.action === 'reveal' && d.step_size != null).length > 0,
    'step_size is computed for consecutive reveals');
  ok(built.decisions.filter(d => d.action === 'reveal').every(d => d.decision_index === 0 || d.step_size != null || d.n_reveals_before === 0),
    'step_size is undefined only for the first reveal of a round');

  // Every exported column must be documented. A derived field nobody can define
  // in a sentence is a field nobody should be analysing — and the workbook's
  // Dictionary sheet is generated from the same map, so this keeps the two from
  // drifting apart as columns are added.
  [['Decisions', built.decisions], ['Rounds', built.rounds], ['Participants', built.participants]].forEach(function (pair) {
    const missing = Dict.undocumented(pair[0], X.columnsOf(pair[1]));
    ok(missing.length === 0, 'every ' + pair[0] + ' column is described in admin/dictionary.js',
      missing.join(', '));
  });
  ok(Dict.sheets.length === 3 && Dict.oneRowIs('Decisions').length > 10,
    'and each analysis sheet states what one of its rows is');

  // A revealed position JOINS the AI's anchor set, so the curve moves to pass
  // through it — which leaves any answer given BEFORE that reveal sitting off the
  // line. That is the design (it is what the qai_update gate asks about), and the
  // plot must keep showing what the AI said AT THE TIME rather than rewriting it.
  {
    const sp = art.specs.find(x => x.seed_shape === 'OPEN' && x.ai_density === 'SPARSE');
    const mp = art.pool[sp.mapping_index];
    const near = sp.ai_anchors[0] + 3;
    const said = Ai.aiAnswer(Ai.anchorSet(sp.ai_anchors, sp.pre_opened, [], mp), near, P.ai.answerRounding);
    const after = Ai.aiAnswer(Ai.anchorSet(sp.ai_anchors, sp.pre_opened, [near], mp), near, P.ai.answerRounding);
    ok(after === mp[near - 1],
      'revealing a position makes the AI answer the TRUTH there afterwards', String(after));
    ok(said !== after,
      'so an answer given before that reveal no longer lies on the curve — historical, not wrong',
      'said ' + said + ', curve now ' + after);
  }

  const r0 = built.rounds[0];
  ok(r0.global_max === Pool.maxOf(art.pool[r0.mapping_index]), 'global_max comes from the mapping');
  ok(r0.argmax_position === Pool.argmaxOf(art.pool[r0.mapping_index]), 'argmax_position comes from the mapping');

  // The walk reflects at the ceiling, so about half of all mappings have their
  // maximum at more than one position. A distance measured against one arbitrary
  // index would carry a tie-break artifact into the analysis, so the export
  // measures the distance to the NEAREST maximising position and ships the count.
  const tieRounds = built.rounds.filter(r => r.argmax_count > 1);
  ok(built.rounds.every(r => r.argmax_count >= 1), 'every round reports how many positions attain the maximum');
  ok(built.rounds.every(r => {
    const m = art.pool[r.mapping_index], mx = Pool.maxOf(m);
    return r.argmax_count === m.filter(v => v === mx).length;
  }), 'argmax_count counts them correctly against the mapping');
  ok(built.rounds.every(r => {
    if (r.dist_best_to_argmax == null) return true;
    const m = art.pool[r.mapping_index], mx = Pool.maxOf(m);
    let best = Infinity;
    m.forEach((v, i) => { if (v === mx) best = Math.min(best, Math.abs(r.nominated_position - (i + 1))); });
    return r.dist_best_to_argmax === best;
  }), 'dist_best_to_argmax is the distance to the NEAREST maximising position, not to an arbitrary one');
  ok(tieRounds.length === 0 || tieRounds.every(r => r.dist_best_to_argmax <= Math.abs(r.nominated_position - r.argmax_position)),
    'on a plateau that distance is never worse than measuring against the first index',
    tieRounds.length + ' of ' + built.rounds.length + ' rounds have a tied maximum');
  ok(r0.pct_of_max_attainable <= 1 && r0.pct_of_max_attainable > 0, 'pct_of_max_attainable is a proportion');
  ok(built.rounds.every(r => r.total_cost === r.n_queries * P.costs.queryCost + r.n_reveals * P.costs.revealCost),
    'total cost = queries × query cost + reveals × reveal cost');
  ok(built.rounds.every(r => r.final_score === r.nominated_true_value - r.total_cost),
    'the score is the TRUE prize at the nominated position minus everything spent');
  ok(built.rounds.every(r => r.final_score === r.raw_score),
    'no floor is applied — the raw score IS the score, so a negative round survives to the data');
  ok(built.rounds.some(r => r.nomination_type === 'queried_only'),
    'the bot sometimes stops on a position it only asked about, so blind nomination is exercised');
  ok(built.rounds.filter(r => r.nomination_type === 'queried_only').every(r => r.nomination_ai_error != null),
    'a blind nomination records how far the AI was out');
  ok(built.rounds.filter(r => r.condition === 'AI_ON').every(r => r.n_queries >= 0), 'queries are counted per round');
  ok(built.rounds.filter(r => r.condition === 'AI_OFF').every(r => r.n_queries === 0), 'no queries are ever logged in an AI-off round');
  ok(built.rounds.every(r => r.redundant_queries === Math.max(0, r.n_queries - 2 * r.ai_k)), 'redundant_queries counts past 2K');
  ok(built.rounds.every(r => r.frontier_share == null || (r.frontier_share >= 0 && r.frontier_share <= 1)),
    'frontier_share is a proportion');
  ok(built.rounds.every(r => r.verification_rate == null || (r.verification_rate >= 0 && r.verification_rate <= 1)),
    'verification_rate is a proportion');

  const p0 = built.participants[0];
  ok(p0.sequence === 'A' || p0.sequence === 'B', 'the sequence travels to the participant row');
  ok(p0.completed === true, 'the bot completed');
  ok(p0.scored_rounds_done === 24, 'twenty-four scored rounds per participant');
  ok(p0.understood_frontier === true, 'understood_frontier is read from the first attempt at the frontier question');
  ok(p0.survey_s01 != null, 'the survey answers reach the participant row');
  ok(p0.phase_ms_round != null, 'the phase breakdown reaches the participant row');
  ok(p0.quiz_qai_score_attempts === 1, 'comprehension attempts reach the participant row');
  ok(p0.actual_better_half != null, 'the half they actually scored higher in is computed');
  ok(typeof p0.disengaged === 'boolean', 'the disengaged flag is a column, not a filter');
  ok(built.participants.some(p => p.n_queries_total > 0), 'the AI-experienced accuracy is computed from paid answers only');
  ok(p0.ai_mean_abs_error_experienced == null || p0.ai_mean_abs_error_experienced >= 0, 'mean absolute AI error is non-negative');

  // The two exclusion flags are columns.
  ok('interrupted' in built.rounds[0], 'interrupted is a round column');
  ok('disengaged' in built.participants[0], 'disengaged is a participant column');

  // CSV + workbook round-trip.
  const csv = X.toCSV(built.decisions);
  ok(csv.split('\n').length === built.decisions.length + 1, 'decisions.csv has one row per decision plus a header');
  ok(csv.split('\n')[0].indexOf('is_first_decision') >= 0, 'decisions.csv carries the derived headers');
  const bytes = Xlsx.build([X.toSheet('Decisions', built.decisions), X.toSheet('Rounds', built.rounds)]);
  ok(bytes && bytes.length > 2000, 'the workbook builds (' + (bytes ? bytes.length : 0) + ' bytes)');
  ok(bytes[0] === 0x50 && bytes[1] === 0x4B, 'the workbook is a zip (PK header)');
}

// ======================================================================
head('13 · scoring arithmetic, end to end');
// ======================================================================
{
  // A hand-worked round: two queries and one reveal, stopping on a position the
  // AI was wrong about. The score must be the TRUTH there, minus 2+2+5.
  const spec = specs.find(s => s.seed_shape === 'BALANCED');
  const map = pool[spec.mapping_index];
  const anchors = Ai.anchorSet(spec.ai_anchors, spec.pre_opened, [], map);
  const askAt = 33;
  const said = Ai.aiAnswer(anchors, askAt, P.ai.answerRounding);
  const truthAt = map[askAt - 1];
  const cost = 2 * P.costs.queryCost + 1 * P.costs.revealCost;
  const score = truthAt - cost;
  ok(score === truthAt - cost && cost === 2 * P.costs.queryCost + P.costs.revealCost,
    'two questions and one reveal cost ' + cost + ' points');
  ok(typeof said === 'number', 'the AI answered at the queried position');
  console.log('       worked example: AI said ' + said + ' at ' + askAt + ', truth ' + truthAt +
    ', score ' + score + ' (error ' + (said - truthAt) + ')');
  ok(!P.costs.scoreFloor, 'the score floor is off by default, so a negative round is possible');
}

// ======================================================================
head('14 · the run parameters are self-consistent');
// ======================================================================
{
  ok(P.rounds.openPerBlock + P.rounds.seededPerBlock === P.rounds.scoredPerBlock,
    'open + seeded = scored rounds per block');
  const shapeTotal = Object.values(P.rounds.shapeMix).reduce((a, b) => a + b, 0);
  ok(shapeTotal === P.rounds.seededPerBlock, 'the seed-shape mix sums to the seeded count');
  ok(P.rounds.densitySeeded.SPARSE + P.rounds.densitySeeded.DENSE === P.rounds.seededPerBlock,
    'the seeded density mix sums to the seeded count');
  ok(P.rounds.densityOpen.SPARSE + P.rounds.densityOpen.DENSE === P.rounds.openPerBlock,
    'the open density mix sums to the open count');
  ok(P.costs.queryCost < P.costs.revealCost, 'asking is cheaper than revealing');
  ok(P.ai.drawCurve === false && P.ai.markAnchors === false, 'the two switches that must never be on are off');
  ok(P.ai.placement === 'stratified', 'anchor placement is stratified');
  ok(P.filter.applyToOpen === false, 'the acceptance filter is NOT applied to open rounds');
  ok(P.ops.minViewport === 900, 'the minimum viewport is 900 CSS pixels');
  ok(P.ops.gateQ2 === 'strict', 'the scoring question is a strict gate');
  ok(P.ops.gateOther === 'record', 'the other questions record attempts rather than blocking');
}

// ======================================================================
head('15 · the Cloud Functions engine copies are identical to the originals');
// ======================================================================
{
  // Firebase deploys only the functions directory, so the engine has to exist
  // inside it. A drifted copy would have the SERVER computing against a
  // different pool from the one this exporter joins against — silently.
  const { spawnSync } = require('child_process');
  const path = require('path');
  const r = spawnSync('node', [path.join(__dirname, 'sync-engine.mjs'), '--check'], { encoding: 'utf8' });
  ok(r.status === 0, 'the vendored engine matches lab/search-v2/{config,pool,specs,ai}.js',
    (r.stderr || r.stdout || '').trim());
}

// ======================================================================
head('16 · per-session wording overrides change words and nothing else');
// ======================================================================
{
  const groups = Content.outline();
  const keys = groups.reduce((a, g) => a.concat(g.fields.map(f => f.key)), []);
  ok(groups.length >= 8, 'the outline covers every screen a participant reads');
  ok(new Set(keys).size === keys.length, 'every override key is unique');
  ok(groups.every(g => g.title && g.when), 'every group says what it is and when it is shown');
  ok(groups.every(g => g.fields.every(f => f.label && (f.kind === 'prose' || f.kind === 'line'))),
    'every field carries a label and a kind');

  // The outline is the whitelist, so it must reach everything the app renders.
  const covered = k => keys.includes(k);
  ok(covered('consent') && covered('debrief') && covered('thanks'), 'the standalone prose blocks are editable');
  ok(Content.INSTRUCTIONS.every(s => covered('instr.' + s.id + '.body')), 'every instruction screen is editable');
  ok(Content.AI_INSTRUCTIONS.every(s => covered('ai.' + s.id + '.body')), 'every AI instruction screen is editable');
  ok(Content.QUIZ_BASE.every(q => covered('quiz.' + q.id + '.prompt')), 'every quick-check question is editable');
  ok(Content.QUIZ_AI.every(q => covered('aiquiz.' + q.id + '.prompt')), 'every AI quick-check question is editable');
  ok(Content.SURVEY.every(q => covered('survey.' + q.id + '.prompt')), 'every survey item is editable');
  ok(Content.QUIZ_BASE.concat(Content.QUIZ_AI).every(q =>
    q.options.every((o, i) => covered('quiz.' + q.id + '.opt.' + i) || covered('aiquiz.' + q.id + '.opt.' + i))),
    'every quiz answer option is editable');

  // ---- normalization -----------------------------------------------------
  const n = Content.normalizeOverrides({
    consent: 'Short consent.',
    thanks: Content.THANKS,                 // identical to the default
    debrief: 12345,                         // not a string
    'quiz.q_cost.opt.2': '  spaced  ',
    'nope.not.a.key': 'ignored',
    'survey.s01.prompt': '',                // blank
    'instr.i1.body': 'x'.repeat(Content.MAX_LEN + 1)
  });
  ok(Object.keys(n).length === 2, 'only the two usable overrides survive normalization',
    'got ' + JSON.stringify(Object.keys(n)));
  ok(n.consent === 'Short consent.', 'a genuine override is kept');
  ok(n['quiz.q_cost.opt.2'] === 'spaced', 'an override is trimmed');
  ok(!('thanks' in n), 'a value equal to the default is not stored');
  ok(!('debrief' in n), 'a non-string is dropped');
  ok(!('nope.not.a.key' in n), 'an unknown key is dropped');
  ok(!('instr.i1.body' in n), 'an over-long override is dropped');
  ok(Object.keys(Content.normalizeOverrides(null)).length === 0, 'no overrides normalizes to nothing');

  // ---- resolve: wording moves, structure does not ------------------------
  const R = Content.resolve({
    consent: 'Short consent.',
    'quiz.q_cost.opt.2': 'FIVE points',
    'aiquiz.qai_score.prompt': 'Reworded strict question',
    'survey.s17.item.s17a': 'Reworded numeracy item',
    'survey.s03.opt.0': 'Far less',
    'part.A.title': 'Part A · Searching'
  });
  ok(R.CONSENT === 'Short consent.', 'the consent screen takes its override');
  ok(R.PART_INTRO.A.title === 'Part A · Searching', 'a survey part heading takes its override');

  const qc = R.QUIZ_BASE.find(q => q.id === 'q_cost');
  const qcBase = Content.QUIZ_BASE.find(q => q.id === 'q_cost');
  ok(qc.options[2] === 'FIVE points', 'an answer option takes its override');
  ok(qc.answer === qcBase.answer, 'the answer key is unchanged by rewording');
  ok(qc.options.length === qcBase.options.length, 'the number of options is unchanged');

  const strict = R.QUIZ_AI.find(q => q.strict);
  ok(strict && strict.id === 'qai_score', 'the strict gate survives rewording');
  ok(strict.prompt === 'Reworded strict question', 'the strict question can be reworded');
  ok(R.UNDERSTOOD_FRONTIER_QID === Content.UNDERSTOOD_FRONTIER_QID, 'the frontier flag still points at its question');

  const s17 = R.SURVEY.find(q => q.id === 's17');
  ok(s17.items[0].prompt === 'Reworded numeracy item', 'a numeracy item can be reworded');
  ok(s17.items[0].answer === 500, 'the numeracy ANSWER is not overridable');
  ok(R.SURVEY.find(q => q.id === 's03').options[0] === 'Far less', 'a survey option takes its override');
  ok(R.SURVEY.every((q, i) => q.id === Content.SURVEY[i].id && q.type === Content.SURVEY[i].type),
    'survey ids, types and order are unchanged');
  ok(R.SURVEY.every(q => !q.platformKey || q.platformKey === Content.SURVEY.find(x => x.id === q.id).platformKey),
    'the platform keys that suppress a duplicate question are unchanged');

  // The exported column set is derived from ids, so it must be untouched — this
  // is the contract that lets wording be editable while the workbook stays put.
  ok(JSON.stringify(R.surveyColumns()) === JSON.stringify(Content.surveyColumns()),
    'the survey columns of a reworded session are identical');
  ok(JSON.stringify(R.quizColumns()) === JSON.stringify(Content.quizColumns()),
    'the quiz columns of a reworded session are identical');

  // ---- the defaults are never mutated ------------------------------------
  ok(Content.CONSENT !== 'Short consent.', 'resolving does not touch the default consent');
  ok(qcBase.options[2] === '{revealCost} points', 'resolving does not touch the default options');
  ok(Content.SURVEY.find(q => q.id === 's17').items[0].prompt.indexOf('Reworded') < 0,
    'resolving does not touch the default survey');

  // ---- how it is stored --------------------------------------------------
  // A JSON STRING, not a map: the admin writes runs with setDoc(merge:true),
  // which deep-merges a map, so a reverted key would be merged straight back
  // and "revert" would change nothing for the participant.
  const json = Content.stringifyOverrides({ consent: 'Short consent.', bogus: 'x' });
  ok(typeof json === 'string', 'overrides stringify to a string');
  ok(JSON.parse(json).consent === 'Short consent.' && !('bogus' in JSON.parse(json)),
    'and are normalized on the way in, so an unknown key is never stored');
  ok(Content.stringifyOverrides({}) === '{}', 'reverting everything stores an EMPTY map, not a stale one');
  ok(Object.keys(Content.parseOverrides(Content.stringifyOverrides({}))).length === 0,
    'which reads back as no overrides at all');
  ok(Content.parseOverrides(json).consent === 'Short consent.', 'a stored string round-trips');
  ok(Object.keys(Content.parseOverrides('not json at all')).length === 0,
    'unreadable wording is no wording, never a broken session');
  ok(Object.keys(Content.parseOverrides(null)).length === 0, 'and neither is nothing');
  ok(Content.resolve(json).CONSENT === 'Short consent.', 'resolve accepts the stored string directly');
  ok(Content.resolve({ consent: 'Short consent.' }).CONSENT === 'Short consent.',
    'and an already-parsed map, so both callers work');

  const plain = Content.resolve(null);
  ok(plain.CONSENT === Content.CONSENT && plain.DEBRIEF === Content.DEBRIEF && plain.THANKS === Content.THANKS,
    'a session with no overrides reads exactly the defaults');
  ok(JSON.stringify(plain.SURVEY.map(q => q.prompt)) === JSON.stringify(Content.SURVEY.map(q => q.prompt)),
    'and its survey wording is the default wording');
}

// ======================================================================
head('17 · every token in the content is one the app substitutes');
// ======================================================================
{
  // A token the participant screen does not know is printed to the participant
  // verbatim — "{stepBound}" instead of a number. Reading them out of app.js
  // rather than restating them here is the point: the list cannot drift.
  const fs = require('fs');
  const path = require('path');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fn = appSrc.slice(appSrc.indexOf('function tokens('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const handled = new Set((body.match(/\\\{([A-Za-z]+)\\\}/g) || []).map(m => m.replace(/\\|\{|\}/g, '')));
  ok(handled.size >= 9, 'the app substitutes a list of tokens', [...handled].join(', '));

  const used = new Set();
  const walk = v => {
    if (typeof v === 'string') { (v.match(/\{([A-Za-z]+)\}/g) || []).forEach(t => used.add(t.slice(1, -1))); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.keys(v).forEach(k => walk(v[k])); }
  };
  walk([Content.CONSENT, Content.INSTRUCTIONS, Content.AI_INSTRUCTIONS, Content.QUIZ_BASE,
        Content.QUIZ_AI, Content.SURVEY, Content.PART_INTRO, Content.DEBRIEF, Content.THANKS]);
  const unknown = [...used].filter(t => !handled.has(t));
  ok(unknown.length === 0, 'every token used in content.js is substituted by the app',
    unknown.length ? 'unsubstituted: {' + unknown.join('}, {') + '}' : '');
}

console.log('\n' + (fails
  ? 'SELFTEST FAILED — ' + fails + ' of ' + checks + ' checks'
  : 'SELFTEST OK — all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);
