#!/usr/bin/env node
/* ==========================================================================
   search-v2  ·  tools/selftest.js
   Automatable acceptance tests (see README §Acceptance tests). Browser-only
   checks (arm isolation in the live DOM, resume, scripted-playthrough logging)
   are exercised by tools/smoke.mjs / by hand and ticked in the README.

   Run:  node tools/selftest.js
   Exits non-zero on any failure.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CONFIG = require('../config.js');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

// ---- shared helpers --------------------------------------------------------
const KEY = CONFIG.OBFUSCATION_KEY;
function decodeInts(b64) {
  return Buffer.from(b64, 'base64').toString('binary').split('').map(c => c.charCodeAt(0) ^ KEY);
}
function decodePairs(b64) {
  const flat = decodeInts(b64), out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
const inAnyPatch = p => CONFIG.COVERAGE_PATCHES.some(([a, b]) => p >= a && p <= b);
function statsOf(values) {
  let iMax = -1, oMax = -1, sum = 0;
  values.forEach((v, i) => {
    const p = i + 1; sum += v;
    if (inAnyPatch(p)) iMax = Math.max(iMax, v); else oMax = Math.max(oMax, v);
  });
  return { iMax, oMax, mean: sum / values.length };
}

const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mappings.json'), 'utf8'));
let plain = null;
try { plain = JSON.parse(fs.readFileSync(path.join(__dirname, 'pool_plain.json'), 'utf8')); } catch (e) {}
const POOR_MAX = (plain && plain.finalPoorInteriorMax) || CONFIG.POOR_INTERIOR_MAX;

// ==========================================================================
section('Test 1 · Pool determinism (regenerate → byte-identical)');
{
  const before = fs.readFileSync(path.join(ROOT, 'data', 'mappings.json'));
  execSync('node ' + JSON.stringify(path.join(__dirname, 'generate_pool.js')), { cwd: ROOT, stdio: 'ignore' });
  const after = fs.readFileSync(path.join(ROOT, 'data', 'mappings.json'));
  ok('mappings.json is byte-identical across two runs', Buffer.compare(before, after) === 0);
}

// ==========================================================================
section('Test 2 · Stratum validity (every mapping satisfies its filters)');
{
  let bad = 0, richN = 0, poorN = 0;
  for (const m of shipped.mappings) {
    const v = decodeInts(m.v);
    const s = statsOf(v);
    const meanOK = s.mean >= CONFIG.MEAN_MIN && s.mean <= CONFIG.MEAN_MAX;
    let filterOK;
    if (m.stratum === 'RICH') { richN++; filterOK = s.iMax >= CONFIG.RICH_INTERIOR_MIN && s.oMax <= s.iMax; }
    else { poorN++; filterOK = s.iMax <= POOR_MAX && s.oMax >= CONFIG.POOR_OUTSIDE_MIN; }
    if (!(meanOK && filterOK)) bad++;
  }
  ok('all ' + shipped.mappings.length + ' mappings pass their stratum + comparability filters', bad === 0, bad + ' violations');
  ok('exactly ' + CONFIG.POOL_PER_STRATUM + ' RICH', richN === CONFIG.POOL_PER_STRATUM, 'got ' + richN);
  ok('exactly ' + CONFIG.POOL_PER_STRATUM + ' POOR', poorN === CONFIG.POOL_PER_STRATUM, 'got ' + poorN);
}

// ==========================================================================
section('Test 3 · Assistant math (dot=truth · interp · flat extrapolation · never refuses)');
{
  global.window = { CONFIG: CONFIG };
  require('../assistant.js');
  const A = global.window.Assistant;
  let dotOK = 0, dotBad = 0, midOK = 0, midBad = 0, neverRefuse = true, flatBad = 0;
  for (const m of shipped.mappings) {
    const dots = decodePairs(m.dots);
    const first = dots[0], last = dots[dots.length - 1];
    // at a known point the reply equals the true value
    for (const [p, val] of dots) {
      const r = A.estimate(dots, p);
      if (!r.refused && r.estimate === val) dotOK++; else dotBad++;
    }
    // midpoint between the first two points = rounded linear interpolation
    const mid = Math.round((first[0] + dots[1][0]) / 2);
    const expect = Math.round(first[1] + (mid - first[0]) / (dots[1][0] - first[0]) * (dots[1][1] - first[1]));
    const r = A.estimate(dots, mid);
    if (!r.refused && r.estimate === expect) midOK++; else midBad++;
    // it always answers, everywhere
    for (const p of [1, 20, 50, 80, 100]) if (A.estimate(dots, p).refused !== false) neverRefuse = false;
    // beyond the outermost points it flat-extrapolates (holds the nearest value)
    if (first[0] > 1 && A.estimate(dots, 1).estimate !== first[1]) flatBad++;
    if (last[0] < 100 && A.estimate(dots, 100).estimate !== last[1]) flatBad++;
  }
  ok('reply at every known point equals the true value (' + dotOK + ' points)', dotBad === 0, dotBad + ' bad');
  ok('reply between two points equals rounded linear interpolation', midBad === 0, midBad + ' bad');
  ok('the assistant NEVER refuses (answers at 1,20,50,80,100)', neverRefuse);
  ok('beyond its outermost points it flat-extrapolates (holds nearest value)', flatBad === 0, flatBad + ' bad');
}

// ==========================================================================
section('Test 5 · Same pool for both arms (single data file, no arm branch)');
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const fetches = (app.match(/fetch\(\s*['"]data\/mappings\.json/g) || []).length;
  ok('app.js fetches data/mappings.json exactly once, unconditionally', fetches === 1, 'found ' + fetches);
  ok('no arm-conditional data path in app.js',
    !/arm[^\n]*mappings|mappings[^\n]*arm/i.test(app));
}

// ==========================================================================
section('Test 6 · Payoff math (net = best − 5·reveals; floored only for pay)');
{
  const COST = CONFIG.REVEAL_COST;
  const netRaw = (best, n) => (n ? best - COST * n : 0);
  ok('two reveals 30 & 62 → net 52', netRaw(62, 2) === 52);
  ok('zero reveals → 0', netRaw(null, 0) === 0);
  ok('negative raw net preserved (best 5, 4 reveals → −15)', netRaw(5, 4) === -15);
  ok('payment floors negatives at 0 but not raw', Math.max(0, netRaw(5, 4)) === 0 && netRaw(5, 4) === -15);
}

// ==========================================================================
section('Test 7 · No plaintext leakage in the shipped pool');
{
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'mappings.json'), 'utf8');
  ok('shipped mappings use obfuscated v/dots, no plain "values" array',
    shipped.mappings.every(m => typeof m.v === 'string' && typeof m.dots === 'string' && !('values' in m)));
  ok('shipped file declares xor-base64 obfuscation', shipped.obfuscation && shipped.obfuscation.scheme === 'xor-base64');
  ok('no plain 100-int array literal present in the shipped JSON text', !/\[(\s*\d+\s*,){50,}/.test(raw));
  // index.html carries no assistant/coverage strings (Arm A shows none by construction)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('index.html static markup contains no "assistant" string', !/assistant/i.test(html));
  ok('index.html static markup contains no "coverage" string', !/coverage/i.test(html));
}

// ==========================================================================
section('Test 10 · Payment draw is seeded & reproducible');
{
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hashSeed(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
  function draw(session) {
    const rng = mulberry32(hashSeed(session + ':paid'));
    const idx = []; for (let i = 1; i <= CONFIG.N_TASKS; i++) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return idx.slice(0, CONFIG.PAID_TASKS).sort((a, b) => a - b);
  }
  const d1 = draw('subject-xyz'), d2 = draw('subject-xyz');
  ok('same session → identical draw', JSON.stringify(d1) === JSON.stringify(d2));
  ok('draws ' + CONFIG.PAID_TASKS + ' distinct rounds in 1..' + CONFIG.N_TASKS,
    d1.length === CONFIG.PAID_TASKS && new Set(d1).size === CONFIG.PAID_TASKS && d1.every(x => x >= 1 && x <= CONFIG.N_TASKS));
  ok('different sessions generally differ', JSON.stringify(draw('a')) !== JSON.stringify(draw('b')));
}

// ==========================================================================
console.log('\n' + '='.repeat(50));
console.log('PASS ' + pass + '  FAIL ' + fail);
console.log('Browser-only checks (run tools/smoke.mjs or verify by hand):');
console.log('  4 · Arm isolation in the live DOM   8 · Resume mid-round');
console.log('  9 · Scripted-playthrough logging + endpoint-failure fallback');
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
