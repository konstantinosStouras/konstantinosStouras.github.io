#!/usr/bin/env node
/* ==========================================================================
   search-v2  ·  tools/selftest.js
   Node acceptance tests for the runtime, deterministic ground-truth model.

   The app no longer ships a landscape pool: each round's truth is a bounded
   random walk generated on the fly (landscape.js) from an (arm, round) seed, and
   the assistant interpolates within its region(s) and extrapolates outside them.
   These tests pin that contract down. The interval-aware estimate math lives in
   landscape.js (assistant.js is a thin browser wrapper over it), so we exercise
   Landscape.estimate directly here.

   Run:  node tools/selftest.js   (exits non-zero on any failure)
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config.js');
const LS = require('../landscape.js');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : (extra ? '  — ' + extra : ''))); }
function section(t) { console.log('\n' + t); }

// Mirror app.js truthSeed(): fixed per (arm, round), arm-specific, round-independent.
function truthSeed(a, r) { return LS.hashSeed(CONFIG.TRUTH_SEED + ':' + (r === 0 ? 'practice' : a) + ':r' + r); }
const N = CONFIG.N_POSITIONS, L = CONFIG.L_STEP;
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

section('Test 1 · Deterministic truth (same everywhere · differs by arm · fresh per round)');
{
  const a1 = LS.makeWalk(truthSeed('A', 1));
  ok('same seed → byte-identical walk', eq(a1, LS.makeWalk(truthSeed('A', 1))));
  ok('Without-AI r1 ≠ With-AI r1 (phases differ)', !eq(a1, LS.makeWalk(truthSeed('B', 1))));
  ok('r1 ≠ r2 within a phase (independent draws)', !eq(a1, LS.makeWalk(truthSeed('A', 2))));
  ok('practice curve is arm-independent', eq(LS.makeWalk(truthSeed('A', 0)), LS.makeWalk(truthSeed('B', 0))));
}

section('Test 1b · Unique peak preferred (tie-free global maximum, not enforced)');
{
  let uniq = 0, sample = 0;
  for (let r = 1; r <= 60; r++) for (const arm of ['A', 'B']) { sample++; if (LS.hasUniqueMax(LS.makeWalk(truthSeed(arm, r)))) uniq++; }
  ok('produced curves have a single tie-free peak (' + uniq + '/' + sample + ')', uniq >= Math.ceil(0.99 * sample), uniq + '/' + sample);
  // still deterministic after the resampling
  ok('the unique-peak resampler stays deterministic', eq(LS.makeWalk(truthSeed('B', 3)), LS.makeWalk(truthSeed('B', 3))));
}

section('Test 2 · Walk shape (in range · adjacency ≤ L_STEP · length N)');
{
  let bad = 0, len = 0;
  for (let r = 1; r <= 20; r++) for (const arm of ['A', 'B']) {
    const v = LS.makeWalk(truthSeed(arm, r));
    if (v.length !== N) len++;
    for (let i = 0; i < v.length; i++) { if (v[i] < 0 || v[i] > 100) bad++; if (i && Math.abs(v[i] - v[i - 1]) > L) bad++; }
  }
  ok('every walk has length ' + N, len === 0);
  ok('all values in [0,100] and |Δ| ≤ ' + L, bad === 0, bad + ' violations');
}

section('Test 3 · Assistant math (exact at dots · interpolates inside · extrapolates outside/between)');
{
  const patches1 = [[30, 70]];
  let dotBad = 0, insideBad = 0, outBad = 0;
  for (let r = 1; r <= 15; r++) {
    const t = LS.makeWalk(truthSeed('B', r));
    const g = LS.makeDots(t, patches1, 'standard', truthSeed('B', r));
    for (const [p, val] of g[0]) if (LS.estimate(g, p).estimate !== val) dotBad++;   // exact on training points
    if (LS.estimate(g, 50).mode !== 'interp') insideBad++;                            // inside region → interpolate
    if (LS.estimate(g, 5).mode !== 'extrap' || LS.estimate(g, 95).mode !== 'extrap') outBad++; // outside → extrapolate
  }
  ok('estimate is exact on training points', dotBad === 0, dotBad + ' bad');
  ok('inside the region it interpolates', insideBad === 0);
  ok('outside the region it extrapolates', outBad === 0);
  // two regions: the gap between them is an extrapolation zone (not a straight interpolation across)
  const t = LS.makeWalk(truthSeed('B', 1));
  const g2 = LS.makeDots(t, [[15, 40], [60, 85]], 'standard', truthSeed('B', 1));
  ok('two regions → the gap extrapolates', LS.estimate(g2, 50).mode === 'extrap');
  ok('two regions → inside each region interpolates', LS.estimate(g2, 25).mode === 'interp' && LS.estimate(g2, 72).mode === 'interp');
  // never refuses (always returns a numeric estimate)
  const gg = LS.makeDots(t, patches1, 'standard', 1);
  let refused = false;
  for (const x of [1, 20, 50, 80, 100]) if (typeof LS.estimate(gg, x).estimate !== 'number') refused = true;
  ok('the assistant always answers (never refuses)', !refused);
}

section('Test 4 · Training-data density (more data → more points → sharper interpolation)');
{
  const t = LS.makeWalk(truthSeed('B', 1)), p = [[20, 80]];
  const few = LS.makeDots(t, p, 'few', 1)[0].length;
  const std = LS.makeDots(t, p, 'standard', 1)[0].length;
  const lots = LS.makeDots(t, p, 'lots', 1)[0].length;
  ok('few < standard < lots training points (' + few + ' < ' + std + ' < ' + lots + ')', few < std && std < lots);
}

section('Test 5 · Chart geometry (interpolation polylines + extrapolation zones)');
{
  const t = LS.makeWalk(truthSeed('B', 1));
  const g1 = LS.geometry(LS.makeDots(t, [[30, 70]], 'few', 1));
  ok('one interior region → 1 interpolation polyline + 2 extrapolation zones', g1.interp.length === 1 && g1.zones.length === 2);
  const g2 = LS.geometry(LS.makeDots(t, [[15, 40], [60, 85]], 'few', 1));
  ok('two interior regions → 2 polylines + 3 zones (both ends + the gap)', g2.interp.length === 2 && g2.zones.length === 3);
}

section('Test 6 · App wiring (runtime generation, no pool, AI cost in the net)');
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ok('app.js no longer fetches data/mappings.json', !/fetch\(\s*['"]data\/mappings\.json/.test(app));
  ok('app.js generates the truth at runtime (Landscape.makeWalk)', /LS\.makeWalk\(/.test(app));
  ok('round cost includes reveal fees AND AI consultation fees', /revealCost\(round\)\s*\+\s*aiSpend\(round\)/.test(app));
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('index.html loads landscape.js', /<script src="landscape\.js">/.test(idx));
  ok('index.html static markup carries no "assistant" string (Arm A isolation)', !/assistant/i.test(idx));
}

section('Test 7 · AI-model economics + defaults');
{
  const ai = CONFIG.AI;
  ok('baseline query cost < reveal cost', ai.baselineCost < CONFIG.REVEAL_COST, ai.baselineCost + ' vs ' + CONFIG.REVEAL_COST);
  ok('frontier query cost ≥ baseline query cost', ai.frontierCost >= ai.baselineCost);
  ok('defaults: 1 round per phase, no practice', CONFIG.N_TASKS === 1 && CONFIG.N_PRACTICE === 0);
}

section('Test 8 · Excel export writer (admin/xlsx.js)');
{
  const XL = require('../admin/xlsx.js');
  const bytes = XL.build([
    { name: 'Data', cols: [{ w: 20 }], rows: [['id', 'net_cents', 'note'], ['p1', 42, 'a & "b" <c>'], ['p2', -7, null]] },
    { name: 'ReadMe', filter: false, rows: [['k', 'v'], ['money', 'cents']] }
  ]);
  ok('build() returns zip bytes (PK magic)', bytes instanceof Uint8Array && bytes[0] === 0x50 && bytes[1] === 0x4B);
  const raw = Buffer.from(bytes).toString('latin1');
  ok('workbook has the OOXML parts', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].every(p => raw.includes(p)));
  // STORE zip → sheet XML is readable in the raw bytes
  ok('numbers are numeric cells, strings inline', raw.includes('<v>42</v>') && raw.includes('<v>-7</v>') && raw.includes('<t>p1</t>'));
  ok('XML special characters are escaped', raw.includes('a &amp; &quot;b&quot; &lt;c&gt;') && !raw.includes('"b" <c>'));
  ok('header row is styled + auto-filtered, ReadMe is not', raw.includes('s="1" t="inlineStr"><is><t>id</t>') && raw.split('<autoFilter').length === 2);
  // EOCD entry count matches the parts we expect (5 skeleton + 2 sheets)
  const eocd = bytes.length - 22;
  const entries = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
  ok('zip central directory lists all 7 entries', entries === 7, String(entries));
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : (fail + ' FAILED')) + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
