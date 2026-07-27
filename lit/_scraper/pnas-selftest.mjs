/*
 * pnas-selftest.mjs — offline test for the PNAS section machinery (no network).
 * ===========================================================================
 * Guards the fixes for the 2008–2025 PNAS coverage gap, where a truncated
 * pnas.org crawl (1–4 pages per section) got stamped `full: true` and the
 * build then treated the 864-DOI index as authoritative — silently dropping
 * every pre-cutoff paper it had missed, while the OpenAlex approximation
 * (which had the papers) was only allowed to cover the current year.
 *
 * Covers:
 *   • extractDois — junk chrome links (ISSN entry, podcasts) never counted;
 *   • crawlConcepts — the last-page signal is "a page that isn't full", never
 *     a parsed result total; per-section completeness; ok only when EVERY
 *     section completed; challenges/HTTP errors/stalls stay honest;
 *   • mergeIntoCache — fullAsOf only advances on a complete full crawl;
 *     replace drops stale entries; partial merges stay sticky but dated;
 *   • applyPnasSections — the safety valve: a partial official index wins
 *     per-paper but cannot EXCLUDE papers (the approximation covers all
 *     years); a genuinely full index keeps its exclusion authority, dated by
 *     fullAsOf, not by `updated`;
 *   • classifyOneTopic — the OpenAlex field → section rules.
 *
 * Run:  node lit/_scraper/pnas-selftest.mjs
 * ===========================================================================
 */
import { PNAS_SECTIONS, crawlConcepts, mergeIntoCache, extractDois, isChallenged }
  from './pnas-crawl.mjs';
import { applyPnasSections, classifyOneTopic } from './build-data.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

// ── page fabric ─────────────────────────────────────────────────────────────

const JUNK_LINKS = '<a href="/doi/10.1073/eissn.1091-6490">issn</a>' +
  '<a href="/doi/10.1073/pc.2026.0001">podcast</a>';

// A search page listing `n` articles for a section, with the chrome junk
// links every real page carries and a (possibly misleading) declared total.
function page(sec, pageNo, n, declared) {
  let links = '';
  for (let i = 0; i < n; i++) {
    const id = String(pageNo * 100 + i).padStart(4, '0');
    links += `<a href="/doi/full/10.1073/pnas.${sec}${id}123">paper</a>` +
             `<a href="/doi/suppl/10.1073/pnas.${sec}${id}123">suppl</a>`; // same parent DOI
  }
  return `<html><body><span>${declared} results</span>${JUNK_LINKS}${links}</body></html>`;
}

const conceptOf = (url) => new URL('https://x' + url.slice(url.indexOf('/action'))).searchParams.get('ConceptID');
const pageOf = (url) => parseInt(new URL('https://x' + url.slice(url.indexOf('/action'))).searchParams.get('startPage'), 10);
const SECS = Object.fromEntries(PNAS_SECTIONS.map(s => [s.concept, s]));

// ── extractDois ─────────────────────────────────────────────────────────────

console.log('extractDois:');
{
  const dois = extractDois(page('77', 0, 3, 3));
  ok(dois.length === 3, 'three articles extract as three parent DOIs (suppl links dedupe)');
  ok(!dois.some(d => /eissn|\/pc\./.test(d)), 'journal-chrome junk DOIs are filtered out');
  ok(dois.every(d => d.startsWith('10.1073/pnas.')), 'all extracted DOIs are article DOIs');
}
ok(isChallenged('', 403) && isChallenged('Just a moment…', 200) && !isChallenged('<html>ok</html>', 200),
  'challenge detection by status and body');

// ── crawlConcepts ───────────────────────────────────────────────────────────

console.log('crawlConcepts:');

// A) A misleading declared total must NOT truncate the walk: the cs section
// really has 230 results over 3 pages, but every page declares "104 results"
// (the old totalSeen >= declared stop ended this crawl after page 1).
{
  const served = [];
  const res = await crawlConcepts(async (url) => {
    const sec = conceptOf(url), p = pageOf(url);
    served.push(`${SECS[sec].key}:${p}`);
    if (sec === '500077') return { status: 200, body: page('77', p, p < 2 ? 100 : 30, 104) };
    return { status: 200, body: page(sec.slice(-2), 0, 5, 5) }; // tiny complete sections
  }, {});
  ok(res.ok === true, 'A: every section walked to its last page → ok');
  ok(res.counts['pnas-cs'] === 230, `A: all 230 cs DOIs collected despite "104 results" header (got ${res.counts['pnas-cs']})`);
  ok(served.includes('pnas-cs:2'), 'A: the walk reached page 3 (old code stopped at page 1)');
  ok(PNAS_SECTIONS.every(s => res.complete[s.key]), 'A: per-section completeness recorded');
  ok(res.counts['pnas-econ'] === 5, 'A: junk chrome links never counted toward a section');
}

// B) A non-challenge HTTP error mid-walk leaves that section incomplete and
// the whole crawl not-ok — partial results kept.
{
  const res = await crawlConcepts(async (url) => {
    const sec = conceptOf(url);
    if (sec === '500085') return { status: 500, body: 'server error' };
    return { status: 200, body: page(sec.slice(-2), 0, 4, 4) };
  }, {});
  ok(res.ok === false, 'B: an HTTP-500 section makes the crawl not-ok');
  ok(res.complete['pnas-soc'] === false && res.complete['pnas-cs'] === true,
    'B: only the failed section is incomplete');
  ok(res.map.size > 0, 'B: the other sections’ DOIs are kept');
}

// C) A Cloudflare challenge aborts immediately and is flagged.
{
  const res = await crawlConcepts(async () => ({ status: 403, body: 'Just a moment…' }), {});
  ok(res.challenged === true && res.ok === false, 'C: challenge → challenged, not ok');
}

// D) A listing that repeats the same full page stalls out WITHOUT claiming
// completeness.
{
  const res = await crawlConcepts(async (url) => {
    const sec = conceptOf(url);
    if (sec === '500068') return { status: 200, body: page('68', 0, 100, 5000) }; // same page forever
    return { status: 200, body: page(sec.slice(-2), 0, 2, 2) };
  }, {});
  ok(res.complete['pnas-econ'] === false && res.ok === false,
    'D: a repeating listing bails without the complete flag');
  ok(res.counts['pnas-econ'] === 100, 'D: the repeated page still contributed its DOIs once');
}

// E) An empty first page (markup change / dead concept) is not "complete".
{
  const res = await crawlConcepts(async (url) => {
    const sec = conceptOf(url);
    if (sec === '500082') return { status: 200, body: '<html><body>no results markup</body></html>' };
    return { status: 200, body: page(sec.slice(-2), 0, 2, 2) };
  }, {});
  ok(res.complete['pnas-sust'] === false && res.ok === false,
    'E: an empty first page is suspicious, never complete');
}

// F) An empty NON-first page (an HTTP-200 zero-result anomaly mid-listing)
// must not be trusted as the genuine last page — the crawl keeps its partial
// results but never claims completeness (which would earn full+replace and
// silently truncate the index).
{
  const res = await crawlConcepts(async (url) => {
    const sec = conceptOf(url), p = pageOf(url);
    if (sec === '500089') {
      if (p === 0) return { status: 200, body: page('89', 0, 100, 9000) }; // full page…
      return { status: 200, body: '<html><body>transient empty template</body></html>' }; // …then blank
    }
    return { status: 200, body: page(sec.slice(-2), 0, 2, 2) };
  }, {});
  ok(res.complete['pnas-env'] === false && res.ok === false,
    'F: an empty page mid-listing never stamps the section complete');
  ok(res.counts['pnas-env'] === 100, 'F: the pages before the anomaly are still kept');
}

// ── mergeIntoCache ──────────────────────────────────────────────────────────

console.log('mergeIntoCache:');
{
  const crawl = new Map([['10.1073/pnas.1', new Set(['pnas-cs'])]]);
  const fullMerge = mergeIntoCache({ map: {} }, crawl, { pullDate: '2026-07-27', full: true, replace: true });
  ok(fullMerge.full === true && fullMerge.fullAsOf === '2026-07-27',
    'a complete full crawl stamps full + fullAsOf');

  const later = new Map([['10.1073/pnas.2', new Set(['pnas-soc'])]]);
  const partial = mergeIntoCache(fullMerge, later, { pullDate: '2026-08-15', full: false });
  ok(partial.full === true, 'a later partial merge keeps the sticky full flag');
  ok(partial.fullAsOf === '2026-07-27', 'a partial merge NEVER advances fullAsOf');
  ok(partial.updated === '2026-08-15', 'a partial merge does advance updated');
  ok(partial.map['10.1073/pnas.1'] && partial.map['10.1073/pnas.2'], 'partial merges union');

  const replaced = mergeIntoCache(partial, later, { pullDate: '2026-09-01', full: true, replace: true });
  ok(!replaced.map['10.1073/pnas.1'] && !!replaced.map['10.1073/pnas.2'],
    'a complete full re-crawl replaces the map (stale entries dropped)');
  ok(replaced.fullAsOf === '2026-09-01', 'a complete full re-crawl advances fullAsOf');

  const legacy = mergeIntoCache({ updated: '2026-07-09', full: true, map: { '10.1073/pnas.9': ['pnas-cs'] } },
    later, { pullDate: '2026-10-01', full: false });
  ok(legacy.full === true && legacy.fullAsOf === undefined,
    'a legacy cache without fullAsOf never invents one from a partial merge');
}

// ── applyPnasSections — the safety valve ────────────────────────────────────

console.log('applyPnasSections:');
const paper = (doi, year) => ({ _doi: doi, Title: 't', Year: String(year) });
const approxMap = {};
for (let i = 0; i < 200; i++) approxMap[`10.1073/pnas.a${i}`] = ['pnas-soc'];
approxMap['10.1073/pnas.gap2018'] = ['pnas-soc'];
approxMap['10.1073/pnas.new2026'] = ['pnas-econ'];
approxMap['10.1073/pnas.official1'] = ['pnas-cs']; // approx disagrees with official
const approx = { updated: '2026-07-27', full: true, map: approxMap };

// 1) TRUNCATED official index (flagged full, but far under half the approx
// size): it wins per-paper but cannot exclude — the gap papers come back.
{
  const cache = { updated: '2026-07-09', full: true,
    map: { '10.1073/pnas.official1': ['pnas-econ'] } };
  const rows = [paper('10.1073/pnas.official1', 2005), paper('10.1073/pnas.gap2018', 2018),
    paper('10.1073/pnas.new2026', 2026), paper('10.1073/pnas.nowhere', 2018)];
  const out = applyPnasSections(rows, cache, approx);
  const by = Object.fromEntries(out.map(p => [p._doi, p]));
  ok(!!by['10.1073/pnas.gap2018'], 'valve: a 2018 paper missed by the truncated index is served from the approximation');
  ok(!!by['10.1073/pnas.new2026'], 'valve: the fresh tail keeps its approximation');
  ok(by['10.1073/pnas.official1'] && by['10.1073/pnas.official1'].Sections.join() === 'Economic Sciences',
    'valve: the official label still wins per-paper over the approximation');
  ok(!by['10.1073/pnas.nowhere'], 'valve: a paper in neither index stays out');
}

// 1b) A LARGE partial index must not regain exclusion authority by size
// alone: partial sittings union-merged onto the legacy sticky full flag can
// cross the half-the-approximation threshold, but without a fullAsOf stamp
// (only a provably complete full crawl writes one) they stay non-authoritative.
{
  const bigPartial = {};
  for (let i = 0; i < 150; i++) bigPartial[`10.1073/pnas.p${i}`] = ['pnas-cs'];
  const cache = { updated: '2026-07-27', full: true, map: bigPartial }; // sticky full, NO fullAsOf
  const out = applyPnasSections([paper('10.1073/pnas.gap2018', 2018)], cache, approx);
  ok(out.length === 1 && out[0]._doi === '10.1073/pnas.gap2018',
    'valve: a big accumulated partial (sticky full, no fullAsOf) still cannot exclude');
}

// 2) GENUINELY full official index (≥ half the approximation): exclusion
// authority holds — pre-cutoff papers absent from it are dropped even when
// the approximation would include them.
{
  const bigMap = { '10.1073/pnas.official1': ['pnas-econ'] };
  for (let i = 0; i < 120; i++) bigMap[`10.1073/pnas.o${i}`] = ['pnas-cs'];
  const cache = { updated: '2026-07-09', full: true, fullAsOf: '2020-05-01', map: bigMap };
  const rows = [paper('10.1073/pnas.gap2018', 2018), paper('10.1073/pnas.new2026', 2026)];
  const out = applyPnasSections(rows, cache, approx);
  const by = Object.fromEntries(out.map(p => [p._doi, p]));
  ok(!by['10.1073/pnas.gap2018'], 'full index: a 2018 paper it excludes stays excluded');
  ok(!!by['10.1073/pnas.new2026'], 'full index: papers from the fullAsOf year on keep the approximation');
}

// 3) The authority horizon is fullAsOf, not `updated` (which partial merges
// advance): a 2020 paper is AT/AFTER a 2020 fullAsOf horizon → approximation
// allowed, even though `updated` says 2026.
{
  const bigMap = {};
  for (let i = 0; i < 120; i++) bigMap[`10.1073/pnas.o${i}`] = ['pnas-cs'];
  const cache = { updated: '2026-07-09', full: true, fullAsOf: '2020-05-01', map: bigMap };
  const approx2 = { map: { '10.1073/pnas.y2020': ['pnas-env'], '10.1073/pnas.y2019': ['pnas-env'] } };
  // approx2 is tiny, so officialSize ≥ approxSize/2 holds — authority intact.
  const out = applyPnasSections([paper('10.1073/pnas.y2020', 2020), paper('10.1073/pnas.y2019', 2019)], cache, approx2);
  ok(out.length === 1 && out[0]._doi === '10.1073/pnas.y2020',
    'cutoff comes from fullAsOf (2020 in, 2019 out), not from updated');
}

// 4) No approximation at all (the mock fixtures' shape): output is identical
// to the old behavior — only officially-labeled papers are served.
{
  const cache = { updated: '2026-01-01', full: true, map: { '10.1073/pnas.official1': ['pnas-cs'] } };
  const out = applyPnasSections([paper('10.1073/pnas.official1', 2005), paper('10.1073/pnas.gap2018', 2018)],
    cache, { map: {} });
  ok(out.length === 1 && out[0]._doi === '10.1073/pnas.official1',
    'no approximation (mock shape): only officially-labeled papers serve — unchanged');
}

// ── classifyOneTopic ────────────────────────────────────────────────────────

console.log('classifyOneTopic:');
ok([...classifyOneTopic({ field: { display_name: 'Economics, Econometrics and Finance' } })].sort().join()
  === 'pnas-econ,pnas-soc', 'economics implies econ + soc');
ok([...classifyOneTopic({ field: { display_name: 'Computer Science' } })].join() === 'pnas-cs',
  'computer science → cs');
ok([...classifyOneTopic({ field: { display_name: 'Chemistry' } })].length === 0,
  'an unrelated field maps to no section');
ok([...classifyOneTopic({ field: { display_name: 'Engineering' },
  subfield: { display_name: 'Renewable Energy, Sustainability and the Environment' } })].join() === 'pnas-sust',
  'sustainability subfield → sust');

console.log(`\npnas-selftest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
