/*
 * selftest.mjs — offline test for the citation-graph pipeline (no network).
 * Unit-tests the pure helpers, then runs build-refs.mjs in mock mode against
 * ./mock/ fixtures and asserts the dataset it writes. Run: node selftest.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRefDois, normDoi, tierOf, orderPapers, buildOutputs, loadCatalog, RF_VER } from './build-refs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };

const OUT = resolve(__dirname, '_mock-out');
const readOut = async (name) => JSON.parse(await readFile(join(OUT, name), 'utf8'));

async function main() {
  await rm(OUT, { recursive: true, force: true });

  console.log('unit: normDoi');
  ok(normDoi('https://doi.org/10.1287/MNSC.2020.0001') === '10.1287/mnsc.2020.0001', 'strips prefix + lowercases');
  ok(normDoi('http://dx.doi.org/10.1/X') === '10.1/x', 'handles dx.doi.org + http');
  ok(normDoi('') === '' && normDoi(null) === '', 'empty/null → empty');

  console.log('unit: tierOf');
  ok(tierOf('ms') === 0 && tierOf('pnas') === 0, 'MS/PNAS → tier 0');
  ok(tierOf('opre') === 1 && tierOf('qje') === 1, 'UTD24/FT50 journal → tier 1');
  ok(tierOf('zzz') === 2, 'anything else → tier 2');

  console.log('unit: extractRefDois');
  const refs = extractRefDois({ reference: [
    { DOI: '10.1/A' }, { DOI: '10.1/a' }, { 'article-title': 'no doi' },
    { DOI: 'https://doi.org/10.2/B' }, { DOI: '10.1/A' },
  ] });
  ok(JSON.stringify(refs) === JSON.stringify(['10.1/a', '10.2/b']), 'deduped, lowercased, DOI-only, prefix-stripped');
  ok(extractRefDois({}).length === 0 && extractRefDois(null).length === 0, 'no references → empty');

  console.log('unit: orderPapers (priority tiers + frozen + resumability)');
  const papers = [
    { doi: 'd-ms-new', jkey: 'ms', year: 2024, tier: 0 },
    { doi: 'd-ms-old', jkey: 'ms', year: 2010, tier: 0 },
    { doi: 'd-opre', jkey: 'opre', year: 2025, tier: 1 },
    { doi: 'd-rest', jkey: 'zzz', year: 2025, tier: 2 },
    { doi: 'd-frozen', jkey: 'ms', year: 2023, tier: 0 },
    { doi: 'd-empty-cur', jkey: 'ms', year: 2022, tier: 0 },
    { doi: 'd-empty-old', jkey: 'ms', year: 2021, tier: 0 },
  ];
  const cache = {
    'd-frozen': { r: ['x'], t: '2026-01-01', v: RF_VER },      // has refs → frozen forever
    'd-empty-cur': { r: [], t: '2026-01-01', v: RF_VER },      // empty at current version → skip
    'd-empty-old': { r: [], t: '2025-01-01', v: RF_VER - 1 },  // empty under older version → re-eligible
  };
  const order = orderPapers(papers, cache, 10).map(p => p.doi);
  ok(order[0] === 'd-ms-new', 'tier-0 newest-first leads');
  ok(order.indexOf('d-ms-old') < order.indexOf('d-opre'), 'tier 0 before tier 1');
  ok(order.indexOf('d-opre') < order.indexOf('d-rest'), 'tier 1 before tier 2');
  ok(!order.includes('d-frozen'), 'a paper with references is never re-fetched');
  ok(!order.includes('d-empty-cur'), 'an empty result at the current version is skipped');
  ok(order.includes('d-empty-old'), 'an empty result under an older version is re-eligible');
  ok(order.indexOf('d-ms-new') < order.indexOf('d-empty-old'), 'never-fetched before empty re-checks');

  console.log('unit: buildOutputs (intersection + index)');
  const dbByDoi = new Map([
    ['a', { t: 'A', j: 'ms', y: '2024' }],
    ['b', { t: 'B', j: 'ms', y: '2019' }],
    ['c', { t: 'C', j: 'opre', y: '2015' }],
  ]);
  const out = buildOutputs({
    a: { r: ['b', 'c', 'ext', 'a'] },   // self-ref + external dropped
    b: { r: ['ext2'] },                 // no in-catalog edges → omitted
    gone: { r: ['a'] },                 // citing paper not in catalog → skipped
  }, dbByDoi);
  ok(JSON.stringify(out.shards.ms && out.shards.ms.a) === JSON.stringify(['b', 'c']), 'A → [B, C] (self/external stripped)');
  ok(!out.shards.ms.b, 'B omitted (no in-catalog references)');
  ok(!out.shards.opre, 'no shard for a journal with no citing edges');
  ok(JSON.stringify(out.index.b) === JSON.stringify(['B', 'ms', '2019']), 'index carries [title, jkey, year]');
  ok(out.totals.citingWithEdges === 1 && out.totals.edges === 2 && out.totals.cited === 2, 'totals correct');

  console.log('unit: loadCatalog');
  const cat = await loadCatalog([join(__dirname, 'mock', 'catalog')]);
  ok(cat.dbByDoi.has('10.1287/mnsc.2020.0001'), 'DOI indexed from catalog');
  ok(cat.dbByDoi.get('10.1287/opre.2015.0003').j === 'opre', 'journal key captured');
  ok(cat.papers.length === 3, 'three papers with a DOI');

  console.log('e2e: mock build');
  await run(process.execPath, [join(__dirname, 'build-refs.mjs')], {
    env: { ...process.env, REFS_MOCK: '1', REFS_DATA_DIR: OUT,
      REFS_CATALOG_DIRS: join(__dirname, 'mock', 'catalog'), REFS_PULL_DATE: '2026-07-13' },
  });

  const manifest = await readOut('manifest.json');
  ok(manifest.ver === RF_VER, 'manifest carries the cache version');
  ok(JSON.stringify(Object.keys(manifest.shards)) === JSON.stringify(['ms']), 'only the ms shard has edges');
  ok(manifest.totals.citingPapers === 1 && manifest.totals.edges === 2, 'manifest totals: 1 citing paper, 2 edges');
  ok(manifest.totals.fetched === 3 && manifest.totals.catalog === 3, 'fetched all 3, catalog is 3');

  const ms = await readOut('refs-ms.json');
  ok(JSON.stringify(ms['10.1287/mnsc.2020.0001']) ===
     JSON.stringify(['10.1287/mnsc.2019.0002', '10.1287/opre.2015.0003']),
     'Paper A cites B (ms) and C (opre), both in catalog');
  ok(!ms['10.1287/mnsc.2019.0002'], 'Paper B (no in-catalog references) is absent from the shard');

  const index = await readOut('refs-index.json');
  ok(JSON.stringify(index['10.1287/mnsc.2019.0002']) === JSON.stringify(['Paper B — Cited By A', 'ms', '2019']),
     'index entry for a cited paper');
  ok(index['10.1287/opre.2015.0003'] && index['10.1287/opre.2015.0003'][1] === 'opre', 'cross-journal edge indexed');
  ok(!index['10.9999/external.1'], 'an out-of-catalog reference is not indexed');

  const cur = await readOut('_refs-cache.json');
  ok(cur['10.1287/mnsc.2020.0001'] && cur['10.1287/mnsc.2020.0001'].v === RF_VER, 'cache stamps the version');
  ok(Object.keys(cur).length === 3, 'all three papers cached (cursor)');

  await rm(OUT, { recursive: true, force: true });
  console.log(fails ? `\nFAILED (${fails})` : '\nAll citation-graph pipeline checks passed.');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
