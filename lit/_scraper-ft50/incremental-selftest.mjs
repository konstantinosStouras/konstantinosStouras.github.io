/*
 * incremental-selftest.mjs — offline test for _scraper-ft50/build-data.mjs
 * --incremental (the FT50 catalog's fast "new arrivals" pass, incrementalMain).
 * ===========================================================================
 * Verifies the pass without any network, driving it entirely through FT50_MOCK
 * fixtures into a throwaway data dir:
 *
 *   1. a full mock build seeds the catalog (incl. the Econometrica fixture,
 *      mock/crossref-ecta.json);
 *   2. a second incremental run over identical data is a no-op (no file rewrite,
 *      so no git commit / Pages redeploy on a quiet run);
 *   3. a genuinely-new Econometrica paper (dropped from the committed file) is
 *      re-discovered, appended, stamped in the registry with today's date and
 *      surfaced in recent.json — while recent.json KEEPS the other journals'
 *      rows (the lean carry-over merge) and the header counts stay consistent;
 *   4. an existing paper's enrichment fields (Preprint link, an OpenAlex/S2
 *      -boosted CitedBy + CitedBySrc) survive a core-field re-fetch.
 *
 * Run:  node lit/_scraper-ft50/incremental-selftest.mjs
 * ===========================================================================
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dirname, 'build-data.mjs');
const DATA = join(tmpdir(), 'lit-ft50-incr-selftest');
if (existsSync(DATA)) rmSync(DATA, { recursive: true });
mkdirSync(DATA, { recursive: true });

const run = (env) => execFileSync('node', [BUILD], {
  env: { ...process.env, FT50_MOCK: '1', FT50_DATA_DIR: DATA, ...env }, encoding: 'utf8',
});
const rd = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

// 1) Seed a full mock build.
run({});
const ecta0 = rd('papers-ecta.json');
const meta0 = rd('meta.json');
ok(ecta0.length >= 3, 'mock build seeded the Econometrica fixture');

// 2) An incremental run over identical data must write nothing.
const otherFile = existsSync(join(DATA, 'papers-ms.json')) ? 'papers-ms.json' : 'papers-isre.json';
const otherMtime = statSync(join(DATA, otherFile)).mtimeMs;
const out2 = run({ FT50_INCREMENTAL: '1' });
ok(/No new or changed papers/.test(out2), 'identical-data incremental run is a no-op');
ok(statSync(join(DATA, otherFile)).mtimeMs === otherMtime, 'unrelated source file not rewritten on a no-op');

// 3) Drop the newest Econometrica paper + its registry key, then rediscover it.
const dropped = ecta0[0];
const droppedDoi = dropped.DOI.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
writeFileSync(join(DATA, 'papers-ecta.json'), JSON.stringify(ecta0.slice(1)));
const reg = rd('_registry.json');
delete reg[droppedDoi];
writeFileSync(join(DATA, '_registry.json'), JSON.stringify(reg));

run({ FT50_INCREMENTAL: '1' });
const ecta1 = rd('papers-ecta.json');
const reg2 = rd('_registry.json');
const recent = rd('recent.json');
const meta1 = rd('meta.json');
ok(ecta1.some(p => p.DOI === dropped.DOI), 'new paper re-appended to papers-ecta.json');
ok(ecta1.length === ecta0.length, 'source count restored');
ok(reg2[droppedDoi] === today, 'new paper stamped with today in the registry');
ok(recent.some(p => p.DOI === dropped.DOI && p['Date Added'] === today), 'new paper shows in recent.json dated today');
ok(recent.some(p => p.JKey && p.JKey !== 'ecta'), 'recent.json keeps the other journals’ rows (lean carry-over merge)');
ok(meta1.paperCount === meta0.paperCount, 'meta paperCount restored');
ok(meta1.authorCount === meta0.authorCount, 'authorCount preserved from prior meta');

// 4) Enrichment fields must survive an incremental core-field re-fetch.
const ectaE = rd('papers-ecta.json');
const target = ectaE.find(p => p.DOI.toLowerCase().endsWith('10.3982/ecta23002')) || ectaE[1];
target.Preprint = 'https://arxiv.org/abs/1234.5678';
target.PreprintSrc = 'arxiv';
target.CitedBy = 9999;
target.CitedBySrc = 'oa';
writeFileSync(join(DATA, 'papers-ecta.json'), JSON.stringify(ectaE));
run({ FT50_INCREMENTAL: '1' });
const t2 = rd('papers-ecta.json').find(p => p.DOI === target.DOI);
ok(t2 && t2.Preprint === target.Preprint && t2.PreprintSrc === 'arxiv', 'Preprint link preserved across re-fetch');
ok(t2 && t2.CitedBy === 9999 && t2.CitedBySrc === 'oa', 'boosted CitedBy + source preserved (Crossref floor is lower)');

rmSync(DATA, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
