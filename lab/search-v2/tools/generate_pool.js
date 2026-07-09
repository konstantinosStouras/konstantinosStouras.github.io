#!/usr/bin/env node
/* ==========================================================================
   search-v2  ·  tools/generate_pool.js
   Offline, seeded, deterministic landscape-pool generator.

   Writes two files:
     ../data/mappings.json   (SHIPPED)  obfuscated values, minimal schema
     ./pool_plain.json       (ANALYSIS) plain values + strata metadata, gitignored

   The live app never generates landscapes; it only loads data/mappings.json.

   Usage:
     node tools/generate_pool.js                 # deterministic default seed
     node tools/generate_pool.js --seed=12345    # choose the generator seed
     node tools/generate_pool.js --stamp=2026-07-09T00:00:00Z  # generatedAt

   Determinism (acceptance test 1): with the same --seed and --stamp the two
   output files are byte-identical. generatedAt defaults to a fixed epoch so a
   bare re-run is byte-identical too.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config.js');

// ---- CLI args --------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const GENERATOR_SEED = args.seed ? parseInt(args.seed, 10) : 20260709;
const GENERATED_AT = typeof args.stamp === 'string' ? args.stamp : '1970-01-01T00:00:00.000Z';

// ---- constants (from the single shared config) -----------------------------
const N = CONFIG.N_POSITIONS;                 // 100
const L_STEP = CONFIG.L_STEP;                 // 10
const [C0, C1] = CONFIG.COVERAGE;             // 30, 70
const K_DOTS = CONFIG.K_DOTS;                 // 7
const PER_STRATUM = CONFIG.POOL_PER_STRATUM;  // 60
const RICH_INTERIOR_MIN = CONFIG.RICH_INTERIOR_MIN; // 85
let   POOR_INTERIOR_MAX = CONFIG.POOR_INTERIOR_MAX;  // 55 (may relax upward)
const POOR_OUTSIDE_MIN = CONFIG.POOR_OUTSIDE_MIN;    // 85
const MEAN_MIN = CONFIG.MEAN_MIN, MEAN_MAX = CONFIG.MEAN_MAX; // 25..50
const KEY = CONFIG.OBFUSCATION_KEY;           // 90

// ---- seeded PRNG (mulberry32) ----------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(GENERATOR_SEED >>> 0);
const uni = (lo, hi) => lo + (hi - lo) * rng();          // U[lo,hi)
const randint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // int in [lo,hi]

// ---- the walk (spec 3.1) ---------------------------------------------------
// Returns { values:[100 ints], seed }. Positions are 1..100 -> index 0..99.
function makeWalk() {
  const seed = (rng() * 0xFFFFFFFF) >>> 0; // recorded per landscape, decorative
  const y = randint(1, N);                 // seed position 1..100
  const q = new Array(N + 1);              // 1-indexed
  // seed value: 0.5 -> U[20,80], else U[80,100]
  q[y] = rng() < 0.5 ? uni(20, 80) : uni(80, 100);
  for (let j = y + 1; j <= N; j++) q[j] = clamp(q[j - 1] + uni(-L_STEP, L_STEP));
  for (let j = y - 1; j >= 1; j--) q[j] = clamp(q[j + 1] + uni(-L_STEP, L_STEP));
  const values = new Array(N);
  for (let j = 1; j <= N; j++) values[j - 1] = Math.round(q[j]);
  return { values, seed };
}
function clamp(x) { return x < 0 ? 0 : x > 100 ? 100 : x; }

// ---- assistant training dots (spec 3.2) ------------------------------------
// 7 dot positions in [30,70]: endpoints 30 & 70 plus 5 interior. The six
// adjacent gaps each in [3,12], at least one gap <=5 and at least one gap >=9.
function makeDots(values) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const gaps = [];
    for (let i = 0; i < K_DOTS - 1; i++) gaps.push(randint(3, 12)); // 6 gaps
    if (gaps.reduce((a, b) => a + b, 0) !== C1 - C0) continue;      // must span 30->70 (=40)
    if (!gaps.some(g => g <= 5)) continue;                          // at least one narrow gap
    if (!gaps.some(g => g >= 9)) continue;                          // at least one wide gap
    const pos = [C0];
    for (const g of gaps) pos.push(pos[pos.length - 1] + g);        // ends exactly at 70
    return pos.map(p => [p, values[p - 1]]);                        // [pos, trueValue]
  }
  return null; // extremely unlikely; caller rejects the landscape
}

// ---- strata classification (spec 3.3) --------------------------------------
function stats(values) {
  let interiorMax = -1, outsideMax = -1, argmax = 1, gmax = -1, sum = 0;
  for (let p = 1; p <= N; p++) {
    const v = values[p - 1];
    sum += v;
    if (v > gmax) { gmax = v; argmax = p; }
    if (p >= C0 && p <= C1) { if (v > interiorMax) interiorMax = v; }
    else { if (v > outsideMax) outsideMax = v; }
  }
  return { interiorMax, outsideMax, argmax, mean: sum / N };
}
function comparable(s) { return s.mean >= MEAN_MIN && s.mean <= MEAN_MAX; }
function isRich(s) { return s.interiorMax >= RICH_INTERIOR_MIN && s.outsideMax <= s.interiorMax; }
function isPoor(s) { return s.interiorMax <= POOR_INTERIOR_MAX && s.outsideMax >= POOR_OUTSIDE_MIN; }

// Belt-and-braces: the <=L_STEP promise made to subjects must actually hold.
function adjacencyOK(values) {
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1]) > L_STEP) return false;
  }
  return true;
}

// ---- rejection sampling ----------------------------------------------------
const rich = [], poor = [];
let considered = 0;

function tryOne() {
  considered++;
  const w = makeWalk();
  if (!adjacencyOK(w.values)) return;
  const s = stats(w.values);
  if (!comparable(s)) return;
  const dots = makeDots(w.values);
  if (!dots) return;
  const rec = {
    values: w.values, seed: w.seed, dots,
    interiorMax: s.interiorMax, outsideMax: s.outsideMax, argmax: s.argmax
  };
  if (rich.length < PER_STRATUM && isRich(s)) { rich.push(rec); return; }
  if (poor.length < PER_STRATUM && isPoor(s)) { poor.push(rec); }
}

// Practice landscape: unconstrained except the comparability screen.
function makePractice() {
  for (;;) {
    const w = makeWalk();
    if (!adjacencyOK(w.values)) continue;
    const s = stats(w.values);
    if (!comparable(s)) continue;
    const dots = makeDots(w.values);
    if (!dots) continue;
    return { id: 'practice_1', values: w.values, seed: w.seed, dots,
             interiorMax: s.interiorMax, outsideMax: s.outsideMax, argmax: s.argmax };
  }
}

console.log(`[generate_pool] seed=${GENERATOR_SEED} target=${PER_STRATUM}/stratum`);
const practice = makePractice();

// Main loop with POOR-acceptance relaxation safety valve.
let sinceRelaxConsidered = 0, poorAcceptCheckpoint = 0;
while (rich.length < PER_STRATUM || poor.length < PER_STRATUM) {
  tryOne();
  sinceRelaxConsidered++;
  // If POOR is starving badly, relax POOR_INTERIOR_MAX upward in steps of 5.
  if (poor.length < PER_STRATUM && sinceRelaxConsidered >= 10000 &&
      (poor.length - poorAcceptCheckpoint) === 0) {
    POOR_INTERIOR_MAX += 5;
    console.warn(`[generate_pool] WARNING: POOR acceptance < 1/10000; ` +
                 `relaxing POOR_INTERIOR_MAX to ${POOR_INTERIOR_MAX}`);
    sinceRelaxConsidered = 0;
    poorAcceptCheckpoint = poor.length;
  } else if (sinceRelaxConsidered >= 10000) {
    sinceRelaxConsidered = 0;
    poorAcceptCheckpoint = poor.length;
  }
  if (considered > 50000000) { // absolute backstop
    console.error('[generate_pool] FATAL: could not fill quotas'); process.exit(1);
  }
}

console.log(`[generate_pool] considered ${considered} candidates`);
console.log(`[generate_pool] RICH accepted ${rich.length} (rate ${(rich.length / considered * 100).toFixed(4)}%)`);
console.log(`[generate_pool] POOR accepted ${poor.length} (rate ${(poor.length / considered * 100).toFixed(4)}%)`);
console.log(`[generate_pool] final POOR_INTERIOR_MAX=${POOR_INTERIOR_MAX}`);

// ---- assign ids & assemble -------------------------------------------------
rich.forEach((r, i) => r.id = 'R' + String(i + 1).padStart(3, '0'));
poor.forEach((r, i) => r.id = 'P' + String(i + 1).padStart(3, '0'));

// ---- obfuscation: XOR + base64 --------------------------------------------
function encodeBytes(intArray) {
  const buf = Buffer.from(intArray.map(v => (v ^ KEY) & 0xFF));
  return buf.toString('base64');
}
function encodeValues(values) { return encodeBytes(values); }
function encodeDots(dots) {
  const flat = [];
  for (const [p, v] of dots) { flat.push(p, v); } // [pos,val,pos,val,...]
  return encodeBytes(flat);
}

function shippedMapping(rec) {
  return { id: rec.id, stratum: rec.stratum, seed: rec.seed,
           v: encodeValues(rec.values), dots: encodeDots(rec.dots) };
}

rich.forEach(r => r.stratum = 'RICH');
poor.forEach(r => r.stratum = 'POOR');
const allReal = rich.concat(poor);

const shipped = {
  generatedAt: GENERATED_AT,
  generatorSeed: GENERATOR_SEED,
  L_STEP,
  coverage: [C0, C1],
  obfuscation: { scheme: 'xor-base64', key: KEY, note: 'decode: base64->bytes->XOR key. Deters casual peeking only.' },
  practice: { id: practice.id, v: encodeValues(practice.values), dots: encodeDots(practice.dots) },
  mappings: allReal.map(shippedMapping)
};

// ---- plain analysis file (everything, un-obfuscated) -----------------------
const plain = {
  generatedAt: GENERATED_AT,
  generatorSeed: GENERATOR_SEED,
  L_STEP, coverage: [C0, C1],
  finalPoorInteriorMax: POOR_INTERIOR_MAX,
  practice: { id: practice.id, seed: practice.seed, values: practice.values, aiDots: practice.dots,
              interiorMax: practice.interiorMax, outsideMax: practice.outsideMax, argmax: practice.argmax },
  mappings: allReal.map(r => ({
    id: r.id, stratum: r.stratum, seed: r.seed, values: r.values, aiDots: r.dots,
    interiorMax: r.interiorMax, outsideMax: r.outsideMax, argmax: r.argmax
  }))
};

// ---- write (stable key order -> byte-identical across runs) ----------------
const outShipped = path.join(__dirname, '..', 'data', 'mappings.json');
const outPlain = path.join(__dirname, 'pool_plain.json');
fs.mkdirSync(path.dirname(outShipped), { recursive: true });
fs.writeFileSync(outShipped, JSON.stringify(shipped, null, 2) + '\n');
fs.writeFileSync(outPlain, JSON.stringify(plain, null, 2) + '\n');

console.log(`[generate_pool] wrote ${outShipped} (${shipped.mappings.length} mappings + practice)`);
console.log(`[generate_pool] wrote ${outPlain} (analysis, gitignored)`);
