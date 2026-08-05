/*
 * rescue-selftest.mjs — offline test (no network) for the by-DOI rescue in
 * build-data.mjs (rescueMissingWorks + its wiring into the daily build).
 * ===========================================================================
 * Why the rescue exists: coverage-audit.mjs proved Crossref's per-journal
 * listing can omit real papers it still serves BY DOI (Operations Research
 * vol 67's issue 2), and the daily build REPLACES each journal from that
 * listing — so the rescue must run inside the harvest, every build, driven by
 * the committed data/_rescue-dois.json.
 *
 * Verifies, entirely through LIT_MOCK fixtures in a throwaway data dir:
 *   1. a full mock build with a manifest rescues the scan-found missing DOI
 *      into papers-opre.json (volume/issue/abstract mapped, registry stamped
 *      today, surfaced in recent.json);
 *   2. the volume guard drops a scan-found DOI whose fetched record carries a
 *      different volume (an OpenAlex misattribution can't smuggle a row in);
 *   3. an explicit probe DOI Crossref does not serve is reported and skipped —
 *      never fabricated into the dataset;
 *   4. a second identical build neither duplicates nor drops the rescued row;
 *   5. unit: no manifest / journal absent from manifest / DOI already
 *      harvested → no-ops.
 *
 * Run:  node lit/_scraper/rescue-selftest.mjs
 * ===========================================================================
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dirname, 'build-data.mjs');
const DATA = join(tmpdir(), 'lit-rescue-selftest');
if (existsSync(DATA)) rmSync(DATA, { recursive: true });
mkdirSync(DATA, { recursive: true });

const run = (env) => execFileSync('node', [BUILD], {
  env: { ...process.env, LIT_MOCK: '1', LIT_DATA_DIR: DATA, ...env }, encoding: 'utf8',
});
const rd = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const RESCUED = 'https://doi.org/10.1287/opre.2019.1867';
const WRONG_VOL = '10.1287/opre.2019.9999';
const PROBE_404 = '10.1287/opre.2019.probe404';

// 0) Seed a build WITHOUT a manifest first: a first-run registry BASELINES
// (stamps only the newest few keys), so a rescue on the very first build would
// legitimately carry no added-date. Master's registry is long-established, and
// this mirrors it — the rescue then lands on a non-first run, exactly like the
// real ~35 Operations Research papers will.
run({});
const opre0 = rd('papers-opre.json');
ok(!opre0.some(p => p.DOI === RESCUED), 'no manifest -> nothing rescued (baseline build)');

// The manifest the daily build reads (temp copy — the committed one under
// lit/data/ is for the REAL journals and never touched here).
writeFileSync(join(DATA, '_rescue-dois.json'), JSON.stringify({
  opre: { scans: [{ volume: '67' }], dois: [PROBE_404] },
}));

// 1) Full mock build with the manifest present.
const out1 = run({});
const opre1 = rd('papers-opre.json');
const row = opre1.find(p => p.DOI === RESCUED);
ok(!!row, 'scan-found missing DOI rescued into papers-opre.json');
ok(row && row.Volume === '67' && row.Issue === '2' && row.Page === '301-315',
  'rescued row carries the fetched volume/issue/pages');
ok(row && /repositioning policies/i.test(row.Abstract || ''),
  'rescued row’s abstract flowed through mapWork’s sanitize path');
ok(!opre1.some(p => p.DOI.toLowerCase().endsWith(WRONG_VOL)),
  'volume guard drops a scan-found DOI whose fetched record says another volume');
ok(!opre1.some(p => p.DOI.toLowerCase().endsWith(PROBE_404)),
  'an unresolvable probe DOI is never fabricated into the dataset');
ok(/rescue\(opre\): \+1 paper/.test(out1), 'the rescue announces what it added');
ok(new RegExp(`rescue\\(opre\\): ${PROBE_404.replace(/\./g, '\\.')} did not resolve`).test(out1),
  'the unresolvable probe DOI is reported as a likely bad citation');
const reg1 = rd('_registry.json');
ok(reg1['10.1287/opre.2019.1867'] === today, 'rescued paper stamped in the registry with today');
const recent1 = rd('recent.json');
ok(recent1.some(p => p.DOI === RESCUED && p['Date Added'] === today),
  'rescued paper joins the recently-added view dated today');

// 2) A second identical build must neither duplicate nor drop the rescued row.
run({});
const opre2 = rd('papers-opre.json');
ok(opre2.filter(p => p.DOI === RESCUED).length === 1, 'second build keeps exactly one rescued row');
ok(opre2.length === opre1.length, 'second build changes no counts');
ok(rd('_registry.json')['10.1287/opre.2019.1867'] === today,
  'registry date preserved across rebuilds (never re-surfaces as newly added)');

// 3) Unit checks on the exported function (module loads with the same env).
process.env.LIT_MOCK = '1';
process.env.LIT_DATA_DIR = DATA;
const { rescueMissingWorks } = await import('./build-data.mjs');
const opreSrc = { key: 'opre', issns: ['0030-364X'], name: 'Operations Research' };
ok((await rescueMissingWorks({ key: 'nosuch', issns: ['x'] }, [])).length === 0,
  'a journal absent from the manifest is a no-op');
const already = [{ DOI: '10.1287/opre.2019.1867' }, { DOI: WRONG_VOL }, { DOI: PROBE_404 }];
ok((await rescueMissingWorks(opreSrc, already)).length === 0,
  'nothing is fetched when the harvest already has every manifest DOI');
// A malformed manifest SHAPE (valid JSON, wrong types) must not throw — the
// rescue promises airtight non-fatality, and a bad hand-edit of the manifest
// must never sink the daily build.
writeFileSync(join(DATA, '_rescue-dois.json'),
  JSON.stringify({ opre: { dois: 'not-an-array', scans: 42 } }));
ok((await rescueMissingWorks(opreSrc, [])).length === 0,
  'a malformed manifest shape is a warned no-op, never a crash');
rmSync(join(DATA, '_rescue-dois.json'));
ok((await rescueMissingWorks(opreSrc, [])).length === 0, 'a missing manifest file is a no-op');

rmSync(DATA, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
