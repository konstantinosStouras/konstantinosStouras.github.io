/*
 * selftest.mjs — offline test for the citation-graph pipeline (no network).
 * Unit-tests the pure helpers, then runs build-refs.mjs in mock mode against
 * ./mock/ fixtures and asserts the dataset it writes — including the union of
 * the Crossref, OpenAlex and Semantic Scholar reference legs. Run:
 *   node selftest.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRefDois, extractOaRefs, extractS2Refs, shortOaid, normDoi, tierOf,
  orderPapers, buildOutputs, loadCatalog, RF_VER } from './build-refs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };

const OUT = resolve(__dirname, '_mock-out');
const readOut = async (name) => JSON.parse(await readFile(join(OUT, name), 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  await rm(OUT, { recursive: true, force: true });

  console.log('unit: normDoi / shortOaid');
  ok(normDoi('https://doi.org/10.1287/MNSC.2020.0001') === '10.1287/mnsc.2020.0001', 'normDoi strips prefix + lowercases');
  ok(shortOaid('https://openalex.org/W2154021704') === 'W2154021704', 'shortOaid from URL');
  ok(shortOaid('W123456') === 'W123456' && shortOaid('nope') === '', 'shortOaid from bare id / empty');

  console.log('unit: tierOf');
  ok(tierOf('ms') === 0 && tierOf('pnas') === 0, 'MS/PNAS → tier 0');
  ok(tierOf('opre') === 1 && tierOf('qje') === 1, 'UTD24/FT50 journal → tier 1');
  ok(tierOf('zzz') === 2, 'anything else → tier 2');

  console.log('unit: extractors (Crossref / OpenAlex / Semantic Scholar)');
  ok(eq(extractRefDois({ reference: [{ DOI: '10.1/A' }, { DOI: '10.1/a' }, { 'article-title': 'x' }, { DOI: 'https://doi.org/10.2/B' }] }),
    ['10.1/a', '10.2/b']), 'Crossref: deduped, lowercased, DOI-only');
  ok(eq(extractOaRefs({ referenced_works: ['https://openalex.org/W11111', 'https://openalex.org/W11111', 'https://openalex.org/W22222'] }),
    ['W11111', 'W22222']), 'OpenAlex: short ids, deduped');
  ok(eq(extractS2Refs({ references: [{ externalIds: { DOI: '10.9/Z' } }, { externalIds: {} }, { externalIds: { DOI: '10.9/z' } }] }),
    ['10.9/z']), 'Semantic Scholar: externalIds.DOI, deduped');
  ok(extractOaRefs(null).length === 0 && extractS2Refs(null).length === 0, 'null → empty');

  console.log('unit: orderPapers (priority tiers + freeze-at-version)');
  const papers = [
    { doi: 'd-ms-new', jkey: 'ms', year: 2024, tier: 0 },
    { doi: 'd-ms-old', jkey: 'ms', year: 2010, tier: 0 },
    { doi: 'd-opre', jkey: 'opre', year: 2025, tier: 1 },
    { doi: 'd-rest', jkey: 'zzz', year: 2025, tier: 2 },
    { doi: 'd-done', jkey: 'ms', year: 2023, tier: 0 },
    { doi: 'd-oldver', jkey: 'ms', year: 2022, tier: 0 },
  ];
  const cache = { 'd-done': { v: RF_VER, r: ['x'] }, 'd-oldver': { v: RF_VER - 1, r: ['y'] } };
  const order = orderPapers(papers, cache, 10).map(p => p.doi);
  ok(order[0] === 'd-ms-new', 'tier-0 newest-first leads');
  ok(order.indexOf('d-ms-old') < order.indexOf('d-opre'), 'tier 0 before tier 1');
  ok(order.indexOf('d-opre') < order.indexOf('d-rest'), 'tier 1 before tier 2');
  ok(!order.includes('d-done'), 'a paper done at the current version is frozen');
  ok(order.includes('d-oldver'), 'a paper stamped under an older version is re-swept');
  ok(order.indexOf('d-ms-new') < order.indexOf('d-oldver'), 'never-fetched before re-sweeps');

  console.log('unit: buildOutputs (union of DOI refs + resolved OpenAlex ids)');
  const dbByDoi = new Map([
    ['a', { t: 'A', j: 'ms', y: '2024' }], ['b', { t: 'B', j: 'ms', y: '2019' }],
    ['c', { t: 'C', j: 'opre', y: '2015' }], ['d', { t: 'D', j: 'ms', y: '2018' }],
  ]);
  const oaidMap = { a: 'W1', b: 'W2', c: 'W3', d: 'W4', ext: 'W9' }; // ext not in dbByDoi
  const out = buildOutputs({
    a: { r: ['b', 'ext-doi'], o: ['W2', 'W4', 'W9'] }, // r→b; o→b(W2),d(W4); W9→ext (not our paper) dropped
    b: { r: [], o: [] },
  }, dbByDoi, oaidMap);
  ok(eq(out.shards.ms && out.shards.ms.a, ['b', 'd']), 'A edges = union(Crossref b, OpenAlex d); externals dropped');
  ok(!out.shards.ms.b, 'B omitted (no in-catalog references)');
  ok(out.index.d && out.index.d[0] === 'D', 'an OpenAlex-only target is indexed');
  ok(out.totals.edges === 2 && out.totals.cited === 2, 'totals count the unioned edges');
  ok(out.counts && out.counts.a === 2 && !('b' in out.counts), 'counts = in-catalog refs per citing paper (A→2; B omitted)');

  console.log('unit: loadCatalog');
  const cat = await loadCatalog([join(__dirname, 'mock', 'catalog')]);
  ok(cat.dbByDoi.has('10.1287/mnsc.2018.0004'), 'Paper D indexed from catalog');
  ok(cat.papers.length === 4, 'four papers with a DOI');

  console.log('e2e: mock build (Crossref + OpenAlex + Semantic Scholar unioned)');
  await run(process.execPath, [join(__dirname, 'build-refs.mjs')], {
    env: { ...process.env, REFS_MOCK: '1', REFS_DATA_DIR: OUT,
      REFS_CATALOG_DIRS: join(__dirname, 'mock', 'catalog'), REFS_PULL_DATE: '2026-07-13' },
  });

  const manifest = await readOut('manifest.json');
  ok(manifest.ver === RF_VER, `manifest version is ${RF_VER}`);
  ok(eq(manifest.sources, ['crossref', 'openalex', 'semanticscholar']), 'manifest lists all three sources');
  ok(eq(Object.keys(manifest.shards), ['ms']), 'only the ms shard has edges');

  const ms = await readOut('refs-ms.json');
  ok(eq(ms['10.1287/mnsc.2020.0001'],
     ['10.1287/mnsc.2019.0002', '10.1287/opre.2015.0003', '10.1287/mnsc.2018.0004']),
     'A cites B (Crossref), C (Crossref+S2) and D (OpenAlex-only) — union across sources');
  ok(eq(ms['10.1287/mnsc.2019.0002'], ['10.1287/mnsc.2020.0001']),
     'B cites A — an edge found ONLY via the Semantic Scholar leg');

  const index = await readOut('refs-index.json');
  ok(index['10.1287/mnsc.2018.0004'] && index['10.1287/mnsc.2018.0004'][0] === 'Paper D — Cited By A Via OpenAlex Only',
     'OpenAlex-only target D is in the title index');
  ok(index['10.1287/mnsc.2018.0004'] && index['10.1287/mnsc.2018.0004'][3] === 'Grace Hopper',
     'the index carries the cited paper’s authors (meta[3])');
  ok(!index['10.9999/external.1'] && !index['10.9999/ext.s2'], 'out-of-catalog references are not indexed');

  const rcounts = await readOut('refs-counts.json');
  ok(rcounts['10.1287/mnsc.2020.0001'] === 3, 'refs-counts.json: A cites 3 in-catalog papers');
  ok(rcounts['10.1287/mnsc.2019.0002'] === 1, 'refs-counts.json: B cites 1 in-catalog paper');
  ok(manifest.counts && manifest.counts.file === 'refs-counts.json' && manifest.counts.count === Object.keys(rcounts).length,
     'manifest advertises the counts companion file');

  const oaid = await readOut('_oaid.json');
  ok(oaid['10.1287/mnsc.2020.0001'] === 'W1000001', '_oaid.json maps DOI → OpenAlex id (built while crawling)');
  ok(Object.keys(oaid).length === 4, 'all four papers resolved to an OpenAlex id');

  const cur = await readOut('_refs-cache.json');
  const a = cur['10.1287/mnsc.2020.0001'];
  ok(a && a.v === RF_VER && a.oa === RF_VER, 'A stamped v + oa at the current version');
  ok(a && Array.isArray(a.o) && a.o.includes('W1000004'), 'A caches raw OpenAlex reference ids');

  await rm(OUT, { recursive: true, force: true });
  console.log(fails ? `\nFAILED (${fails})` : '\nAll citation-graph pipeline checks passed.');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
