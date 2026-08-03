/*
 * incremental-selftest.mjs — offline test for _scraper-ft50/build-data.mjs
 * --incremental (the FT50 catalog's fast "new arrivals" pass, incrementalMain).
 * ===========================================================================
 * Verifies the pass without any network, driving it entirely through FT50_MOCK
 * fixtures into a throwaway data dir:
 *
 *   1. a full mock build seeds the catalog (incl. the Econometrica and EJOR
 *      fixtures, mock/crossref-ecta.json and mock/crossref-ejor.json);
 *   2. a second incremental run over identical data is a no-op (no file rewrite,
 *      so no git commit / Pages redeploy on a quiet run);
 *   3. a genuinely-new Econometrica paper (dropped from the committed file) is
 *      re-discovered, appended, stamped in the registry with today's date and
 *      surfaced in recent.json — while recent.json KEEPS the other journals'
 *      rows (the lean carry-over merge) and the header counts stay consistent;
 *  3b. the same for EJOR, the second polled journal, on the case that motivated
 *      adding it: a no-volume Articles-in-Press row. It keeps its forthcoming
 *      Status, leads its journal, joins the recently-added tally — and a
 *      following unchanged run is still a no-op, so polling a high-volume
 *      journal every 20 minutes does not commit on every fire;
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

// 0) Unit check: the duplicate title key decodes HTML entities, so an
// entity-variant registration of an already-listed paper still collapses
// (a real JORS/JSTOR twin pattern; matchNorm alone would leak the entity's
// NAME into the collapsed title and keep the pair apart).
{
  const { sameWorkDup } = await import('./build-data.mjs');
  const r1 = { Title: 'A Heuristic Solution Procedure to Minimize T on a Single Machine',
    Authors: 'R Maheswaran', Volume: '40', Issue: '3', Page: '293-297', Year: '1989',
    DOI: 'https://doi.org/10.1057/jors.1989.39' };
  const r2 = { ...r1, Title: 'A Heuristic Solution Procedure to Minimize _ T &nbsp; on a Single Machine',
    Page: '293', DOI: 'https://doi.org/10.2307/2583342' };
  ok(sameWorkDup(r1, r2) === 'a', 'HTML-entity title variant of the same registration collapses');
  ok(sameWorkDup(r1, { ...r2, Authors: 'Alex Mason' }) === null, 'conflicting authors never collapse');
}

// 0a2) Unit checks of the recently-added tally merge (mergeRecentCounts): the
// polled journals' entries are replaced with freshly-computed ones, every other
// journal's is carried from the last write but pruned to the window that has
// since slid forward — the same reasoning as the lean recent.json carry-over.
{
  const { buildRecentCounts, mergeRecentCounts } = await import('./build-data.mjs');
  const day = process.env.FT50_PULL_DATE || today;
  const reg = { '10.3982/ecta1': day, '10.3982/ecta2': day };
  const fresh = buildRecentCounts([
    { JKey: 'ecta', _doi: '10.3982/ecta1', Year: '2026' },
    { JKey: 'ecta', _doi: '10.3982/ecta2', Year: '2026' },
  ], reg);
  ok(fresh.total === 2 && fresh.days.ecta[day] === 2, 'the tally counts every paper in the window');
  const prev = { generated: '2020-01-01', windowDays: 90, total: 9,
    days: { ecta: { [day]: 1 }, qje: { [day]: 4 }, jfe: { '2000-01-01': 4 } } };
  const merged = mergeRecentCounts(prev, fresh, new Set(['ecta']));
  ok(merged.days.ecta[day] === 2, 'the polled journal is replaced by the fresh count');
  ok(merged.days.qje[day] === 4, 'an unpolled journal is carried over');
  ok(!merged.days.jfe, 'a carried-over entry that aged out of the window is pruned');
  ok(merged.total === 6, 'the merged total is the sum of what survived');
  ok(JSON.stringify(merged) === JSON.stringify(mergeRecentCounts(prev, fresh, new Set(['ecta']))),
    'the merge is deterministic (unchanged data → identical bytes → no needless commit)');
  ok(mergeRecentCounts(null, fresh, new Set(['ecta'])).total === 2, 'a missing previous tally is not fatal');
}

// 0b) Unit checks of the stray-trailing-separator trim (see titleText /
// trimTrailingSeparators / affilName in build-data.mjs — the same canonical block
// as the native pipeline): a dangling ',' / ';' / ':' deposited on a title or
// affiliation is trimmed, while legitimate end punctuation and the ';' that
// closes an HTML entity survive untouched.
{
  const { titleText, trimTrailingSeparators, affilName, affilList } = await import('./build-data.mjs');
  ok(titleText('Cost Containment in Health Care: A Model for Management Research ,')
    === 'Cost Containment in Health Care: A Model for Management Research',
    'trailing " ," trimmed, internal colon kept');
  ok(titleText('The Lock-In Effect and the Corporate Payout Puzzle,')
    === 'The Lock-In Effect and the Corporate Payout Puzzle', 'trailing comma trimmed');
  ok(titleText('America’s Best:') === 'America’s Best', 'trailing colon (lost subtitle) trimmed');
  ok(titleText('Weird Title , ;') === 'Weird Title', 'a run of separators collapses');
  ok(titleText('Implementing the &quot;Wisdom of the Crowd&quot;')
    === 'Implementing the "Wisdom of the Crowd"', 'a known entity DECODES (and its quote is not trimmed)');
  ok(titleText('word&haelip;') === 'word&haelip;',
    "an UNKNOWN entity survives intact and its ';' is never trimmed");
  ok(titleText('When is P < 0.05 Significant?') === 'When is P < 0.05 Significant?',
    'a legitimate question mark is kept');
  ok(titleText(titleText('Puzzle,')) === 'Puzzle', 'idempotent (safe to re-apply every build)');
  ok(trimTrailingSeparators(null) === '', 'empty input is safe');
  ok(affilName('University of Tokyo ,') === 'University of Tokyo', 'affiliation comma trimmed');
  ok(affilName(' , ') === '', 'a separator-only affiliation collapses to empty');
  ok(affilList('Germany;; Leadec, Chemnitz') === 'Germany; Leadec, Chemnitz',
    'affilList drops the empty segment that showed as a doubled ";;"');
}

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
// recent-counts.json — the uncapped tally the page's "N papers added in the
// last 4 weeks" is read from — gets the same lean treatment: the polled journal
// recomputed, every other journal carried over.
const counts1 = rd('recent-counts.json');
ok(counts1.generated === today && counts1.windowDays >= 28, 'recent-counts.json is stamped and covers the displayed window');
ok((counts1.days.ecta || {})[today] >= 1, 'the new paper is in the tally under its journal key');
ok(Object.keys(counts1.days).some(k => k !== 'ecta'), 'the tally keeps the other journals (lean carry-over merge)');
ok(counts1.total >= recent.length, 'the tally is never smaller than the rows recent.json carries');

// 3b) The pass polls EJOR too (FT50_INCR_JOURNALS default 'ecta,ejor'), and the
// case that motivated adding it is an Articles-in-Press row: EJOR posts ~40 a
// month with no volume/issue, and before this they waited for the nightly build.
// Drop the no-volume row and check the incremental pass re-discovers it, keeps
// its forthcoming Status, and surfaces it in the recent view dated today.
const AIP_DOI = '10.1016/j.ejor.2026.07.041';
const ejor0 = rd('papers-ejor.json');
ok(ejor0.length >= 3, 'mock build seeded the EJOR fixture');
const aip = ejor0.find(p => p.DOI.toLowerCase().endsWith(AIP_DOI));
ok(!!aip, 'the no-volume EJOR row is in the built file');
ok(aip && !aip.Volume && aip.Status && aip.Status !== 'Published',
  'a no-volume EJOR record is tagged forthcoming, not published');
ok(ejor0[0].DOI === aip.DOI, 'the forthcoming row leads its journal (statusRank/pubRank order)');

const ejorReg = rd('_registry.json');
delete ejorReg[AIP_DOI];
writeFileSync(join(DATA, '_registry.json'), JSON.stringify(ejorReg));
writeFileSync(join(DATA, 'papers-ejor.json'),
  JSON.stringify(ejor0.filter(p => p.DOI !== aip.DOI)));

run({ FT50_INCREMENTAL: '1' });
const ejor1 = rd('papers-ejor.json');
const recent2 = rd('recent.json');
const counts2 = rd('recent-counts.json');
ok(ejor1.length === ejor0.length, 'the dropped EJOR paper is re-appended');
ok(ejor1.some(p => p.DOI === aip.DOI), 'the Articles-in-Press row is back by DOI');
ok(rd('_registry.json')[AIP_DOI] === today, 'the new EJOR paper is stamped with today');
ok(recent2.some(p => p.DOI === aip.DOI && p['Date Added'] === today),
  'the new EJOR paper shows in recent.json dated today');
ok((counts2.days.ejor || {})[today] >= 1, 'the EJOR arrival is in the recently-added tally');
ok(recent2.some(p => p.JKey === 'ecta'), 'polling two journals keeps the other one’s recent rows');

// A second, unchanged run over the same data must still be a no-op — polling an
// extra high-volume journal must not make every 20-minute run commit.
const quiet = run({ FT50_INCREMENTAL: '1' });
ok(/No new or changed papers/.test(quiet), 'two polled journals still no-op on unchanged data');

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

// 4b) Abstracts are refreshed UPGRADE-only on a known-DOI re-fetch — the EJOR
// case: Elsevier deposits many abstracts only days after first registration,
// so an Articles-in-Press row added abstract-less used to wait for the next
// daily rebuild. An empty abstract takes the fresh Crossref text; text FULLER
// than Crossref's is preserved (betterAbstract gate — the API-backfill overlay
// must never regress to a stub).
const ejorA = rd('papers-ejor.json');
const upE = ejorA.find(p => p.DOI.toLowerCase().endsWith('10.1016/j.ejor.2026.05.012'));
const keepE = ejorA.find(p => p.DOI.toLowerCase().endsWith(AIP_DOI));
ok(!!upE && !!keepE, 'EJOR abstract-upgrade fixture rows present');
const fullKeepE = 'F'.repeat(300);      // candidate (~110 chars) must lose
upE.Abstract = '';
keepE.Abstract = fullKeepE;
writeFileSync(join(DATA, 'papers-ejor.json'), JSON.stringify(ejorA));
run({ FT50_INCREMENTAL: '1' });
const ejorA2 = rd('papers-ejor.json');
ok(/reference point/.test(ejorA2.find(p => p.DOI === upE.DOI).Abstract || ''),
  'an abstract-less EJOR row gains the freshly-deposited Crossref abstract within a poll');
ok(ejorA2.find(p => p.DOI === keepE.DOI).Abstract === fullKeepE,
  'a fuller backfilled abstract is never regressed to the Crossref text');

rmSync(DATA, { recursive: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
