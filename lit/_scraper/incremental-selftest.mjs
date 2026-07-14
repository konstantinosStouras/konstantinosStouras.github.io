/*
 * incremental-selftest.mjs — offline test for build-data.mjs --incremental.
 * ===========================================================================
 * Verifies the incremental "new arrivals" pass (see incrementalMain() in
 * build-data.mjs) without any network, driving it entirely through LIT_MOCK
 * fixtures into a throwaway data dir:
 *
 *   1. a full mock build seeds the dataset;
 *   2. a second incremental run over identical data is a no-op (no file rewrite,
 *      so no git commit / Pages redeploy on a quiet run);
 *   3. a genuinely-new paper (dropped from the committed files) is re-discovered,
 *      appended, stamped in the registry with today's date and surfaced in
 *      recent.json, with the header counts kept consistent;
 *   4. an existing paper's enrichment fields (Preprint link, an OpenAlex/S2
 *      -boosted CitedBy + CitedBySrc) survive a core-field re-fetch.
 *
 * Run:  node lit/_scraper/incremental-selftest.mjs
 * ===========================================================================
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dirname, 'build-data.mjs');
const DATA = join(tmpdir(), 'lit-incr-selftest');
if (existsSync(DATA)) rmSync(DATA, { recursive: true });
mkdirSync(DATA, { recursive: true });

const run = (env) => execFileSync('node', [BUILD], {
  env: { ...process.env, LIT_MOCK: '1', LIT_DATA_DIR: DATA, ...env }, encoding: 'utf8',
});
const rd = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

// 1) Seed a full mock build.
run({});
const ms0 = rd('papers-ms.json');
const meta0 = rd('meta.json');

// 2) An incremental run over identical data must write nothing.
const opreMtime = statSync(join(DATA, 'papers-opre.json')).mtimeMs;
const out2 = run({ LIT_INCREMENTAL: '1' });
ok(/No new or changed papers/.test(out2), 'identical-data incremental run is a no-op');
ok(statSync(join(DATA, 'papers-opre.json')).mtimeMs === opreMtime, 'unchanged source file not rewritten on a no-op');

// 3) Drop the newest MS paper + its registry key, then rediscover it.
const dropped = ms0[0];
const droppedDoi = dropped.DOI.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
writeFileSync(join(DATA, 'papers-ms.json'), JSON.stringify(ms0.slice(1)));
const reg = rd('_registry.json');
delete reg[droppedDoi];
writeFileSync(join(DATA, '_registry.json'), JSON.stringify(reg));

run({ LIT_INCREMENTAL: '1' });
const ms1 = rd('papers-ms.json');
const reg2 = rd('_registry.json');
const recent = rd('recent.json');
const meta1 = rd('meta.json');
ok(ms1.some(p => p.DOI === dropped.DOI), 'new paper re-appended to papers-ms.json');
ok(ms1.length === ms0.length, 'source count restored');
ok(reg2[droppedDoi] === today, 'new paper stamped with today in the registry');
ok(recent.some(p => p.DOI === dropped.DOI && p['Date Added'] === today), 'new paper shows in recent.json dated today');
ok(meta1.paperCount === meta0.paperCount, 'meta paperCount restored');
ok(meta1.authorCount === meta0.authorCount, 'authorCount preserved from prior meta');

// 4) Enrichment fields must survive an incremental core-field re-fetch.
const msE = rd('papers-ms.json');
const target = msE[2];
target.Preprint = 'https://arxiv.org/abs/1234.5678';
target.PreprintSrc = 'arxiv';
target.CitedBy = 9999;
target.CitedBySrc = 'oa';
writeFileSync(join(DATA, 'papers-ms.json'), JSON.stringify(msE));
run({ LIT_INCREMENTAL: '1' });
const t2 = rd('papers-ms.json').find(p => p.DOI === target.DOI);
ok(t2 && t2.Preprint === target.Preprint && t2.PreprintSrc === 'arxiv', 'Preprint link preserved across re-fetch');
ok(t2 && t2.CitedBy === 9999 && t2.CitedBySrc === 'oa', 'boosted CitedBy + source preserved (Crossref floor is lower)');

rmSync(DATA, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
