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

// 0) Unit checks of the same-work duplicate rule (see collapseSameWork in
// build-data.mjs): the three collapse classes, and the look-alikes that must
// always be kept apart.
const { sameWorkDup, collapseSameWork } = await import('./build-data.mjs');
const row = (o) => ({ Title: 'Dynamic Pricing under Demand Uncertainty', Authors: 'Jane Doe, Wei Chen',
  Volume: '70', Issue: '2', Page: '101-120', Year: '2024', DOI: 'https://doi.org/10.1287/x.2024.0001',
  Abstract: 'a', ...o });
ok(sameWorkDup(row({}), row({ DOI: 'https://doi.org/10.2307/999', Page: '101' })) === 'a',
  'class a: same volume/issue/first-page under a second DOI collapses');
ok(sameWorkDup(row({}), row({ DOI: 'https://doi.org/10.1287/x.2024.001', Volume: '', Issue: '', Page: '', Year: '2023', Status: 'Articles in Advance' })) === 'b',
  'class b: an online-first stub of a published row collapses');
ok(sameWorkDup(row({ Volume: '', Issue: '', Page: '' }),
  row({ Volume: '', Issue: '', Page: '', DOI: 'https://doi.org/10.1287/x.2024.01' })) === 'c',
  'class c: two Articles-in-Advance stubs of one work collapse');
ok(sameWorkDup(row({}), row({ Volume: '71', Year: '2025', DOI: 'https://doi.org/10.1287/x.2025.0002' })) === null,
  'same title in a different volume (annual recurring item) is kept');
ok(sameWorkDup(row({}), row({ Page: '201-220', DOI: 'https://doi.org/10.1287/x.2024.0002' })) === null,
  'same issue, different pages (multi-part article) is kept');
ok(sameWorkDup(row({}), row({ Authors: 'Alex Mason', DOI: 'https://doi.org/10.1287/x.2024.0002', Page: '101' })) === null,
  'conflicting author lists never collapse');
ok(sameWorkDup(row({ Authors: '', Volume: '', Issue: '', Page: '' }),
  row({ Authors: '', Volume: '', Issue: '', Page: '', DOI: 'https://doi.org/10.1111/j.2' })) === null,
  'authorless stubs (special-issue notices) never collapse');
ok(sameWorkDup(row({ Title: 'Errata' }), row({ Title: 'Errata', DOI: 'https://doi.org/10.1/2', Page: '101' })) === null,
  'short front-matter titles never collapse');
{
  const stub = row({ Volume: '', Issue: '', Page: '', Year: '2023', DOI: 'https://doi.org/10.1287/x.2023.9', Abstract: '', CitedBy: 55, Preprint: 'https://arxiv.org/abs/1', PreprintSrc: 'arxiv' });
  const full = row({});
  const outRows = collapseSameWork([stub, full]);
  ok(outRows.length === 1 && outRows[0] === full, 'collapse keeps the fuller registration');
  ok(full.CitedBy === 55 && full.Preprint === 'https://arxiv.org/abs/1',
    'collapse folds the dropped row\'s enrichment into the kept row');
}

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

// 5) Duplicate-registration guard: a paper we already list must never be
// appended a second time when Crossref serves it under another DOI. Rewrite a
// committed MS paper as a no-volume online-first stub with a variant DOI; the
// incremental re-fetch (which carries the real record) must ADOPT the real DOI
// onto that row — preserving its enrichment and registry date — not add a row.
const msD = rd('papers-ms.json');
const victimIdx = msD.findIndex(p => p.Volume && p.Authors);
const victim = { ...msD[victimIdx] };
const stubDoi = victim.DOI.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() + '-oldreg';
msD[victimIdx] = {
  ...victim, DOI: 'https://doi.org/' + stubDoi,
  Volume: '', Issue: '', Page: '', Status: 'Articles in Advance',
  Preprint: 'https://arxiv.org/abs/2401.00001', PreprintSrc: 'arxiv',
};
writeFileSync(join(DATA, 'papers-ms.json'), JSON.stringify(msD));
const regD = rd('_registry.json');
const realDoi = victim.DOI.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
regD[stubDoi] = '2020-01-01';
delete regD[realDoi];
writeFileSync(join(DATA, '_registry.json'), JSON.stringify(regD));

const out5 = run({ LIT_INCREMENTAL: '1' });
const ms5 = rd('papers-ms.json');
const reg5 = rd('_registry.json');
const hits = ms5.filter(p => p.Title === victim.Title);
ok(hits.length === 1, 'same work under a second DOI is not appended as a new row');
ok(hits[0] && hits[0].DOI === victim.DOI, 'the fuller registration\'s DOI is adopted onto the existing row');
ok(hits[0] && hits[0].Preprint === 'https://arxiv.org/abs/2401.00001', 'enrichment survives the DOI adoption');
ok(reg5[realDoi] === '2020-01-01', 'registry date migrates with the DOI (not presented as newly added)');
ok(!rd('recent.json').some(p => p.DOI === victim.DOI && p['Date Added'] === today),
  'an adopted re-registration does not enter recent.json as new');
ok(ms5.length === msD.length, 'row count unchanged by the adoption');

rmSync(DATA, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
