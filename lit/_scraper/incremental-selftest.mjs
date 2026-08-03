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
 *      recent.json and recent-counts.json (the uncapped tally the page's
 *      "N papers added in the last 4 weeks" is read from), with the header
 *      counts kept consistent;
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

// 0b) Unit checks of the stray-trailing-separator trim (see titleText /
// trimTrailingSeparators / affilName in build-data.mjs): some publishers deposit
// a dangling ',' / ';' / ':' on a title or affiliation, which the card renders as
// visible punctuation noise. Legitimate end punctuation and the ';' that closes
// an HTML entity must survive untouched.
{
  const { titleText, trimTrailingSeparators, affilName, affilList, affilParts } = await import('./build-data.mjs');
  ok(titleText('The Lock-In Effect and the Corporate Payout Puzzle,')
    === 'The Lock-In Effect and the Corporate Payout Puzzle', 'trailing comma trimmed');
  ok(titleText('The Ethics of Organizational Politics ,')
    === 'The Ethics of Organizational Politics', 'space + comma trimmed');
  ok(titleText('America’s Best:') === 'America’s Best', 'trailing colon (lost subtitle) trimmed');
  ok(titleText('Weird Title , ;') === 'Weird Title', 'a run of separators collapses');
  ok(titleText('Implementing the &quot;Wisdom of the Crowd&quot;')
    === 'Implementing the "Wisdom of the Crowd"', 'a known entity DECODES (and its quote is not trimmed)');
  ok(titleText('a job-shop scheduling system&ast;') === 'a job-shop scheduling system*',
    '&ast; decodes to the asterisk');
  ok(titleText('word&haelip;') === 'word&haelip;',
    "an UNKNOWN entity survives intact and its ';' is never trimmed");
  ok(titleText('Numeric entity &#8212;') === 'Numeric entity —', 'a numeric entity decodes');
  ok(titleText('When is P < 0.05 Significant?') === 'When is P < 0.05 Significant?',
    'a legitimate question mark is kept');
  ok(titleText('Part I: The Setup') === 'Part I: The Setup', 'an internal colon is kept');
  ok(titleText('Innovation! A Study.') === 'Innovation! A Study.', 'trailing period/bang are kept');
  ok(titleText(titleText('Puzzle,')) === 'Puzzle', 'idempotent (safe to re-apply every build)');
  ok(trimTrailingSeparators(null) === '' && trimTrailingSeparators('') === '', 'empty input is safe');
  ok(affilName('University of Tokyo ,') === 'University of Tokyo', 'affiliation comma trimmed');
  ok(affilName('  Yale   University ;  ') === 'Yale University', 'affiliation whitespace + semicolon trimmed');
  ok(affilName(' , ') === '', 'a separator-only affiliation collapses to empty (dropped by the caller)');
  ok(affilList('University of Tokyo ,; Yale University ;') === 'University of Tokyo; Yale University',
    'affilList trims every ;-separated name');
  ok(affilList('Germany;; Leadec, Chemnitz') === 'Germany; Leadec, Chemnitz',
    'affilList drops the empty segment that showed as a doubled ";;"');
  ok(affilList('') === '' && affilList(null) === '', 'affilList handles empty input');
  // The ';' that closes an HTML entity is NOT an affiliation separator: splitting
  // on it would tear "Universidad de Lima, Per&#x00FA;" apart and lose the ';'.
  ok(affilList('Universidad de Lima, Per&#x00FA;') === 'Universidad de Lima, Perú',
    'an entity in an affiliation decodes (and is never split apart)');
  ok(affilList('A, Per&#x00FA;; B University') === 'A, Perú; B University',
    'an entity followed by a REAL separator: decode + split both work');
  ok(affilList('word&haelip; Institute; Other U') === 'word&haelip; Institute; Other U',
    "an UNKNOWN entity's ';' is masked through the split, not a separator");
  ok(affilList(affilList('A, Per&#x00FA;; B ,')) === affilList('A, Per&#x00FA;; B ,'),
    'affilList is idempotent around entities');
  // mapWork adds affilParts() of each Crossref name to the affiliation set, and
  // the CLI joins the same parts — so a name that itself contains ';' yields the
  // SAME string either way, and a rebuild is a fixed point of the maintenance CLI.
  ok(JSON.stringify(affilParts('Dept A;Univ B ,')) === JSON.stringify(['Dept A', 'Univ B']),
    'affilParts splits an internal ";" and trims each part');
  ok(affilList('Dept A;Univ B ,') === affilParts('Dept A;Univ B ,').join('; '),
    'affilList is exactly affilParts joined');
  ok(JSON.stringify(affilParts('')) === '[]', 'affilParts of empty is []');
}

// 0b) Unit checks of the recently-added tally (buildRecentCounts): the number
// the page prints above the "Recently added papers" list. recent.json is capped
// so it can ship with the page; this tally must NOT be — that is the whole
// point of it — and it must key a paper by every journal key it answers to, so
// a PNAS paper filed under two sections is counted once, not twice.
{
  const { buildRecentCounts } = await import('./build-data.mjs');
  const day = process.env.LIT_PULL_DATE || today;
  const stale = '2000-01-01';
  const reg = {}, papers = [];
  // A burst well past any recent.json cap.
  for (let i = 0; i < 1200; i++) {
    const doi = `10.1287/burst.${i}`;
    reg[doi] = day;
    papers.push({ JKey: 'ms', _doi: doi, Title: `Paper ${i}`, Year: '2026' });
  }
  reg['10.1073/pnas.1'] = day;
  papers.push({ JKey: 'pnas', _doi: '10.1073/pnas.1', Sections: ['Social Sciences', 'Economic Sciences'], Year: '2026' });
  reg['10.1073/pnas.2'] = day;
  papers.push({ JKey: 'pnas', _doi: '10.1073/pnas.2', _secKeys: ['pnas-econ', 'pnas-soc'], Year: '2026' });
  reg['10.1287/old.1'] = stale;
  papers.push({ JKey: 'ms', _doi: '10.1287/old.1', Year: '2001' });
  papers.push({ JKey: 'ms', _doi: '10.1287/unregistered.1', Year: '2026' }); // never registered
  const rc = buildRecentCounts(papers, reg);
  ok(rc.total === 1202, 'the tally is uncapped — every paper in the window is counted');
  ok(rc.days.ms[day] === 1200, 'per-journal per-day counts are exact');
  ok(!rc.days.ms[stale], 'a registration older than the window is out');
  ok(rc.days['pnas|pnas-econ|pnas-soc'][day] === 2,
    'a PNAS paper is filed under its whole key set — counted once, findable by either section');
  ok(rc.windowDays >= 28, 'the emitted window covers the 4 weeks the page shows');
  ok(JSON.stringify(rc) === JSON.stringify(buildRecentCounts(papers, reg)),
    'the tally is deterministic (unchanged data → identical bytes → no needless commit)');
  const dropped = buildRecentCounts(papers.slice(600), reg);
  ok(dropped.total === 602, 'removing papers lowers the tally');
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
// The count the page prints above that list has to move with it.
const counts1 = rd('recent-counts.json');
ok(counts1.generated === today && counts1.windowDays >= 28, 'recent-counts.json is stamped and covers the displayed window');
ok(Object.keys(counts1.days).some(k => k.split('|')[0] === 'ms' && counts1.days[k][today] >= 1),
  "the new paper is in the tally under its journal's key");
ok(counts1.total >= recent.length, 'the tally is never smaller than the rows recent.json carries');

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

// 4b) Abstracts are refreshed UPGRADE-only on a known-DOI re-fetch: a publisher
// may deposit the abstract days AFTER first registration, so a teaser (or
// empty) grows to the fresh Crossref text — while text FULLER than Crossref's
// is preserved (betterAbstract gate: the pubsonline full-abstract overlay must
// never regress to a Crossref teaser).
const msA = rd('papers-ms.json');
const upT = msA.find(p => p.DOI.toLowerCase().endsWith('10.1287/mnsc.2026.02441'));
const keepT = msA.find(p => p.DOI.toLowerCase().endsWith('10.1287/mnsc.2024.06043'));
ok(!!upT && !!keepT, 'abstract-upgrade fixture rows present');
const fullKeep = 'K'.repeat(1300);      // longer than fixture-abstract / 1.3
upT.Abstract = 'Teaser.';
keepT.Abstract = fullKeep;
writeFileSync(join(DATA, 'papers-ms.json'), JSON.stringify(msA));
run({ LIT_INCREMENTAL: '1' });
const msA2 = rd('papers-ms.json');
ok(msA2.find(p => p.DOI === upT.DOI).Abstract.length > 500,
  'a teaser abstract grows to the freshly-deposited Crossref text');
ok(msA2.find(p => p.DOI === keepT.DOI).Abstract === fullKeep,
  'an already-fuller abstract is never regressed (betterAbstract gate)');

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
