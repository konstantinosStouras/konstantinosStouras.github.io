/*
 * citedby-selftest.mjs — offline test for the forward-citation harvester
 * (build-citedby.mjs). No network. Unit-tests the pure helpers (extractCiters,
 * orderCitedby, forwardDisruption), then runs the harvester in mock mode against
 * ./mock-cb/ fixtures and asserts the crawl cache + meta it writes — including
 * that the harvested forward graph reproduces the paper's worked disruption
 * example (D = 0.25). Run:
 *   node citedby-selftest.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCiters, orderCitedby, orderOaidSeeds, forwardDisruption, CB_VER } from './build-citedby.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };

const OUT = resolve(__dirname, '_cb-mock-out');
const readOut = async (name) => JSON.parse(await readFile(join(OUT, name), 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  await rm(OUT, { recursive: true, force: true });

  console.log('unit: extractCiters');
  ok(eq(extractCiters([
    { id: 'https://openalex.org/W1111' }, { id: 'https://openalex.org/W1111' },
    { id: 'https://openalex.org/W2222' }, { id: 'nope' }, {}]),
    ['W1111', 'W2222']), 'short ids, deduped, non-ids dropped');
  ok(extractCiters(null).length === 0, 'null → empty');

  console.log('unit: orderCitedby (needs an OpenAlex id; rolling refresh; priority tiers)');
  const papers = [
    { doi: 'd-ms-new', jkey: 'ms', year: 2024, tier: 0 },
    { doi: 'd-ms-old', jkey: 'ms', year: 2010, tier: 0 },
    { doi: 'd-opre', jkey: 'opre', year: 2025, tier: 1 },
    { doi: 'd-rest', jkey: 'zzz', year: 2025, tier: 2 },
    { doi: 'd-nooaid', jkey: 'ms', year: 2025, tier: 0 },
    { doi: 'd-fresh', jkey: 'ms', year: 2023, tier: 0 },
    { doi: 'd-stale', jkey: 'ms', year: 2022, tier: 0 },
    { doi: 'd-oldver', jkey: 'ms', year: 2021, tier: 0 },
  ];
  const oaidMap = {
    'd-ms-new': 'W1', 'd-ms-old': 'W2', 'd-opre': 'W3', 'd-rest': 'W4',
    'd-fresh': 'W6', 'd-stale': 'W7', 'd-oldver': 'W8', // d-nooaid deliberately absent
  };
  const nowTs = Date.parse('2026-07-15T00:00:00Z');
  const cache = {
    'd-fresh': { v: CB_VER, t: '2026-07-10', c: [] },   // 5 days old (< 30) → skip
    'd-stale': { v: CB_VER, t: '2026-01-01', c: [] },   // > 30 days → re-eligible
    'd-oldver': { v: CB_VER - 1, t: '2026-07-14', c: [] }, // older version → re-sweep despite freshness
  };
  const order = orderCitedby(papers, cache, oaidMap, 10, nowTs).map(x => x.doi);
  ok(order[0] === 'd-ms-new', 'tier-0 never-fetched, newest-first leads');
  ok(!order.includes('d-nooaid'), 'a paper without an OpenAlex id is skipped');
  ok(!order.includes('d-fresh'), 'an entry fresher than the TTL is skipped');
  ok(order.includes('d-stale'), 'an entry older than the TTL is re-fetched');
  ok(order.includes('d-oldver'), 'an entry stamped under an older version is re-swept');
  ok(order.indexOf('d-ms-new') < order.indexOf('d-stale'), 'never-fetched before refreshes');
  ok(order.indexOf('d-ms-old') < order.indexOf('d-opre'), 'tier 0 before tier 1');
  ok(order.indexOf('d-opre') < order.indexOf('d-rest'), 'tier 1 before tier 2');

  console.log('unit: orderCitedby hot bump (highly-cited papers lead the queue)');
  // d-rest is tier 2 and old, yet 40 in-catalog citers put it first; d-ms-old's
  // 10 citers rank it second; everything below the threshold keeps the old order.
  const hotOrder = orderCitedby(papers, cache, oaidMap, 10, nowTs, undefined, undefined,
    { citedCounts: { 'd-rest': 40, 'd-ms-old': 10, 'd-opre': 3 }, hotMin: 5 }).map(x => x.doi);
  ok(hotOrder[0] === 'd-rest' && hotOrder[1] === 'd-ms-old',
    'hot papers jump the tier queue, most-cited first');
  ok(hotOrder[2] === 'd-ms-new', 'below the threshold (d-opre: 3 < 5) the old order resumes');
  ok(eq(orderCitedby(papers, cache, oaidMap, 10, nowTs).map(x => x.doi), order),
    'without citedCounts the order is unchanged (backwards compatible)');

  console.log('unit: orderCitedby recap rule (capped classics re-queued under a higher hot cap)');
  const capPapers = [
    { doi: 'd-classic', jkey: 'jom', year: 1991, tier: 2 },   // capped hot → re-eligible
    { doi: 'd-coldcap', jkey: 'ms', year: 2015, tier: 0 },    // capped, not hot → stays fresh
    { doi: 'd-hotfull', jkey: 'ms', year: 2018, tier: 0 },    // hot but uncapped + fresh → skip
  ];
  const capOaids = { 'd-classic': 'Wc1', 'd-coldcap': 'Wc2', 'd-hotfull': 'Wc3' };
  const capCache = {
    'd-classic': { v: CB_VER, t: '2026-07-14', c: ['W1', 'W2', 'W3'], n: 40000, cap: 1 },
    'd-coldcap': { v: CB_VER, t: '2026-07-14', c: ['W1', 'W2', 'W3'], n: 9000, cap: 1 },
    'd-hotfull': { v: CB_VER, t: '2026-07-14', c: ['W1', 'W2'], n: 2 },
  };
  const capOpts = { citedCounts: { 'd-classic': 195, 'd-hotfull': 30 }, hotMin: 5, maxCiters: 3, hotMaxCiters: 10 };
  const capOrder = orderCitedby(capPapers, capCache, capOaids, 10, nowTs, undefined, undefined, capOpts);
  ok(eq(capOrder.map(x => x.doi), ['d-classic']),
    'a fresh-but-capped hot paper is re-queued; a capped cold one and an uncapped hot one are not');
  ok(capOrder[0].cap === 10, 'the re-queued classic carries the hot cap for fetchCiters');
  ok(orderCitedby(capPapers, capCache, capOaids, 10, nowTs).length === 0,
    'without the cap opts the recap rule is off (backwards compatible)');
  const capDefault = orderCitedby([{ doi: 'd-ms-new', jkey: 'ms', year: 2024, tier: 0 }], {}, { 'd-ms-new': 'W1' },
    10, nowTs, undefined, undefined, capOpts);
  ok(capDefault[0].cap === 3, 'a non-hot paper carries the base cap');

  console.log('unit: orderOaidSeeds (high-value papers missing an OpenAlex id)');
  const seedPapers = [
    { doi: 'd-canon', jkey: 'jpe', year: 1981, tier: 2 },
    { doi: 'd-mid', jkey: 'aer', year: 2001, tier: 1 },
    { doi: 'd-cold', jkey: 'ms', year: 2020, tier: 0 },
    { doi: 'd-known', jkey: 'ms', year: 2015, tier: 0 },
    { doi: 'd-missed', jkey: 'ms', year: 2010, tier: 0 },
  ];
  const seedCounts = { 'd-canon': 195, 'd-mid': 44, 'd-cold': 2, 'd-known': 80, 'd-missed': 60 };
  const seedOaidMap = { 'd-known': 'W5', 'd-missed': '' }; // '' = recorded not-in-OpenAlex
  const seeds = orderOaidSeeds(seedPapers, seedCounts, seedOaidMap, 10, 5);
  ok(eq(seeds, ['d-canon', 'd-mid']), 'missing-id papers ≥ threshold, most-cited first');
  ok(!seeds.includes('d-known'), 'a paper with a known id is not re-seeded');
  ok(!seeds.includes('d-missed'), 'a recorded empty-string miss is never re-queried');
  ok(!seeds.includes('d-cold'), 'below the cited threshold is not seeded');
  ok(eq(orderOaidSeeds(seedPapers, seedCounts, {}, 1, 5), ['d-canon']), 'the per-run cap holds');

  console.log('unit: forwardDisruption (the paper’s worked example → D = 0.25)');
  // Focal F (W900001) cites R1, R2. Citers: P1(only F), P2(F+R1), P3(only R2), P4(only F).
  const fwd = new Map([
    ['10.9/r1', new Set(['W900012', 'W900001'])],  // P2 cites R1; F cites R1
    ['10.9/r2', new Set(['W900013', 'W900001'])],  // P3 cites R2; F cites R2
  ]);
  const dd = forwardDisruption('W900001', new Set(['W900011', 'W900012', 'W900014']), ['10.9/r1', '10.9/r2'], fwd);
  ok(dd && Math.abs(dd.d - 0.25) < 1e-9, 'D = (n_i − n_j)/(n_i+n_j+n_k) = (2−1)/4 = 0.25');
  ok(dd && dd.ni === 2 && dd.nj === 1 && dd.nk === 1, 'n_i=2 (P1,P4), n_j=1 (P2), n_k=1 (P3); focal excluded from k');
  ok(forwardDisruption('W', new Set(), ['10.9/r1'], fwd) === null, 'no forward citations → undefined');

  console.log('e2e: mock harvest (OpenAlex cites:) + oaid seeding + pipeline → disruption');
  // Seed the doi→OpenAlex-id map the harvester relies on (build-refs writes this
  // for real) — but deliberately WITHOUT R2's id: R2 is highly cited in-catalog
  // (cited-counts.json below), so the run's oaid-seeding leg must resolve it by
  // DOI (fixture oa-10_9_r2.json) and then crawl its citers in the SAME run.
  // The ghost paper is cited too but absent from OpenAlex → a recorded '' miss.
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, '_oaid.json'),
    JSON.stringify({ '10.9/f': 'W900001', '10.9/r1': 'W900002' }), 'utf8');
  await writeFile(join(OUT, 'cited-counts.json'),
    JSON.stringify({ '10.9/r2': 6, '10.9/ghost': 9 }), 'utf8');
  await run(process.execPath, [join(__dirname, 'build-citedby.mjs')], {
    env: {
      ...process.env, CB_MOCK: '1', CB_DATA_DIR: OUT,
      CB_CATALOG_DIRS: join(__dirname, 'mock-cb', 'catalog'),
      CB_MOCK_DIR: 'mock-cb', CB_PULL_DATE: '2026-07-15',
    },
  });

  const oaidOut = await readOut('_oaid.json');
  ok(oaidOut['10.9/r2'] === 'W900003', 'seeding resolved R2’s OpenAlex id by DOI');
  ok(oaidOut['10.9/ghost'] === '', 'a cited paper absent from OpenAlex is recorded as an empty-string miss');
  ok(oaidOut['10.9/f'] === 'W900001' && oaidOut['10.9/r1'] === 'W900002', 'pre-known ids untouched');

  const cb = await readOut('_citedby-cache.json');
  ok(cb['10.9/f'] && eq(cb['10.9/f'].c.slice().sort(), ['W900011', 'W900012', 'W900014']),
    'F’s citers harvested (P1, P2, P4)');
  ok(cb['10.9/f'] && cb['10.9/f'].n === 3 && cb['10.9/f'].v === CB_VER && cb['10.9/f'].t === '2026-07-15',
    'F stamped with count, version and pull date');
  ok(cb['10.9/r1'] && eq(cb['10.9/r1'].c.slice().sort(), ['W900001', 'W900012']),
    'R1’s citers harvested (F, P2) — the focal appears among its references’ citers');
  ok(cb['10.9/r2'] && eq(cb['10.9/r2'].c.slice().sort(), ['W900001', 'W900013']),
    'R2’s citers harvested (F, P3) — in the same run that seeded its id');

  const meta = await readOut('citedby-meta.json');
  ok(meta.ver === CB_VER && meta.papersWithCiters === 3 && meta.withOaid === 3,
    'meta: 3 papers harvested, 3 with an OpenAlex id');
  ok(meta.citersHarvested === 7 && meta.inCatalogCiters === 2,
    'meta: 7 citer links, 2 of them in-catalog (F cites R1 and R2)');

  // Pipeline → D: rebuild the forward map from the HARVESTED cache and confirm it
  // reproduces the worked example, proving the harvest feeds build-disruption.
  const fwd2 = new Map();
  for (const [doi, e] of Object.entries(cb)) fwd2.set(doi, new Set(e.c));
  const oaid = await readOut('_oaid.json');
  const dd2 = forwardDisruption(oaid['10.9/f'], fwd2.get('10.9/f'), ['10.9/r1', '10.9/r2'], fwd2);
  ok(dd2 && Math.abs(dd2.d - 0.25) < 1e-9, 'harvested forward graph → D = 0.25 (end to end)');

  console.log('e2e: capped hot classic re-crawled in full under the higher hot cap');
  // F is stamped FRESH (same pull date) but capped with a truncated 2-id list —
  // the state a canon classic is in after a run under the old base cap. R1 is
  // stamped fresh with a sentinel list: if the run touched it, the sentinel is
  // lost. With F hot and CB_HOT_MAX_CITERS above its citer count, the recap
  // rule must re-crawl F alone, storing the FULL list and clearing the cap.
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, '_oaid.json'),
    JSON.stringify({ '10.9/f': 'W900001', '10.9/r1': 'W900002', '10.9/r2': 'W900003' }), 'utf8');
  await writeFile(join(OUT, 'cited-counts.json'), JSON.stringify({ '10.9/f': 40 }), 'utf8');
  await writeFile(join(OUT, '_citedby-cache.json'), JSON.stringify({
    '10.9/f': { c: ['W900011', 'W900012'], n: 3, t: '2026-07-15', v: CB_VER, cap: 1 },
    '10.9/r1': { c: ['W999999'], n: 1, t: '2026-07-15', v: CB_VER },
    '10.9/r2': { c: ['W999999'], n: 1, t: '2026-07-15', v: CB_VER },
    '10.9/ghost': { c: [], n: 0, t: '2026-07-15', v: CB_VER },
  }), 'utf8');
  await run(process.execPath, [join(__dirname, 'build-citedby.mjs')], {
    env: {
      ...process.env, CB_MOCK: '1', CB_DATA_DIR: OUT,
      CB_CATALOG_DIRS: join(__dirname, 'mock-cb', 'catalog'),
      CB_MOCK_DIR: 'mock-cb', CB_PULL_DATE: '2026-07-15',
      CB_MAX_CITERS: '2', CB_HOT_MAX_CITERS: '100', CB_HOT_MIN: '5',
    },
  });
  const cb2 = await readOut('_citedby-cache.json');
  ok(cb2['10.9/f'] && eq(cb2['10.9/f'].c.slice().sort(), ['W900011', 'W900012', 'W900014']) && !cb2['10.9/f'].cap,
    'the capped hot paper is re-crawled in full and its cap flag cleared');
  ok(eq(cb2['10.9/r1'].c, ['W999999']) && eq(cb2['10.9/r2'].c, ['W999999']),
    'fresh uncapped entries are untouched (sentinel lists survive)');

  await rm(OUT, { recursive: true, force: true });
  console.log(fails ? `\nFAILED (${fails})` : '\nAll forward-citation harvester checks passed.');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
