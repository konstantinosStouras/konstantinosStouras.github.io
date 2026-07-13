/*
 * selftest.mjs — offline test for the working-papers pipeline (no network).
 * Runs build-data.mjs in mock mode against ./mock/ fixtures, then asserts the
 * archive it writes, plus unit-tests the pure helpers. Run: node selftest.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wpRecordFromWork, orderAuthors, invertAbstract, loadCatalog } from './build-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };

const OUT = resolve(__dirname, '_mock-out');
const readOut = async (name) => JSON.parse(await readFile(join(OUT, name), 'utf8'));

async function main() {
  await rm(OUT, { recursive: true, force: true });

  console.log('unit: invertAbstract');
  ok(invertAbstract({ 'a': [0], 'b': [1] }) === 'a b', 'reconstructs word order');
  ok(invertAbstract(null) === '', 'null → empty');

  console.log('unit: wpRecordFromWork');
  const ssrn = wpRecordFromWork({
    title: 'Solo Working Paper', publication_year: 2025,
    doi: 'https://doi.org/10.2139/ssrn.123',
    authorships: [{ author: { display_name: 'A B' }, institutions: [{ display_name: 'Uni' }] }],
    locations: [{ landing_page_url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123', source: { type: 'repository', display_name: 'SSRN' } }],
    cited_by_count: 5,
  }, new Set());
  ok(ssrn && ssrn.JKey === 'wp-ssrn', 'SSRN preprint → JKey wp-ssrn');
  ok(ssrn && ssrn.Status === 'Working paper', 'carries Status "Working paper"');
  ok(ssrn && ssrn.Preprint.includes('ssrn.com'), 'Preprint points at SSRN');
  ok(ssrn && ssrn.CitedBy === 5, 'CitedBy carried when positive');

  ok(wpRecordFromWork({ title: 'Dupe', doi: 'https://doi.org/10.2139/ssrn.1',
    locations: [{ landing_page_url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1', source: { type: 'repository' } }] },
    new Set(['dupe'])) === null, 'excluded when title already published');

  ok(wpRecordFromWork({ title: 'Has A Journal', doi: 'https://doi.org/10.2139/ssrn.2',
    locations: [
      { landing_page_url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2', source: { type: 'repository' } },
      { source: { type: 'journal', display_name: 'Real Journal' } }] },
    new Set()) === null, 'excluded when OpenAlex places it in a journal');

  ok(wpRecordFromWork({ title: 'Bio Paper', doi: 'https://doi.org/10.1101/2024.01.01.123456',
    locations: [{ landing_page_url: 'https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1', source: { type: 'repository' } }] },
    new Set()) === null, 'bioRxiv host not archived here → null');

  console.log('unit: orderAuthors (priority + resumability)');
  const authors = new Map([
    ['old crawled', { name: 'Old Crawled', priority: false, latestYear: 2010, journals: new Set(), sampleDois: [] }],
    ['prio fresh', { name: 'Prio Fresh', priority: true, latestYear: 2024, journals: new Set(), sampleDois: [] }],
    ['nonprio new', { name: 'NonPrio New', priority: false, latestYear: 2025, journals: new Set(), sampleDois: [] }],
  ]);
  const cache = { 'old crawled': { done: true, ts: '2000-01-01' } };
  const order = orderAuthors(authors, cache, 10, '2026-07-13', 45).map(x => x.nk);
  ok(order[0] === 'prio fresh', 'priority author first');
  ok(order.indexOf('nonprio new') < order.indexOf('old crawled'), 'never-crawled before stale-refresh');

  console.log('unit: loadCatalog');
  const cat = await loadCatalog([join(__dirname, 'mock', 'catalog')]);
  ok(cat.authors.has('jane q. public'), 'author indexed from catalog');
  ok(cat.publishedTitles.has('publishedpaperone') || [...cat.publishedTitles].some(t => t.includes('publishedpaper')), 'published title indexed');

  console.log('e2e: mock build');
  await run(process.execPath, [join(__dirname, 'build-data.mjs')], {
    env: { ...process.env, WP_MOCK: '1', WP_DATA_DIR: OUT,
      WP_CATALOG_DIRS: join(__dirname, 'mock', 'catalog'), WP_PULL_DATE: '2026-07-13' },
  });
  const sources = await readOut('sources.json');
  const keys = sources.map(s => s.key).sort();
  ok(JSON.stringify(keys) === JSON.stringify(['wp-arxiv', 'wp-ssrn']), 'manifest lists only non-empty repos (wp-arxiv, wp-ssrn)');
  ok(sources.every(s => s.workingPaper === true), 'sources flagged workingPaper');

  const ssrnRows = await readOut('papers-wp-ssrn.json');
  ok(ssrnRows.length === 1, 'exactly 1 SSRN working paper (published + journal-placed excluded)');
  const wp = ssrnRows[0];
  ok(wp.Authors === 'Jane Q. Public, John Coauthor', 'co-authors captured');
  ok(wp.Affiliations === 'Test University; Other University', 'affiliations captured');
  ok(wp.CitedBy === 3, 'CitedBy from OpenAlex');
  ok(wp.Year === '2025', 'posted year captured (for the year filter)');
  ok(/ssrn\.com/.test(wp.Preprint), 'SSRN pre-print link');

  const arxivRows = await readOut('papers-wp-arxiv.json');
  ok(arxivRows.length === 1 && /arxiv\.org\/abs\//.test(arxivRows[0].Preprint), 'arXiv preprint archived + canonicalised');

  const meta = await readOut('meta.json');
  ok(meta.paperCount === 2, 'meta paperCount = 2');
  ok(meta.authorCount === 2, 'meta authorCount = 2 crawled (Jane + coauthor John)');
  ok(meta.authorsInCatalog === 2, 'meta authorsInCatalog = 2');

  const cur = await readOut('_authors.json');
  ok(cur['jane q. public'] && cur['jane q. public'].done && cur['jane q. public'].oaid === 'A1111111111',
    'crawl cursor records the resolved OpenAlex id + done');

  await rm(OUT, { recursive: true, force: true });
  console.log(fails ? `\nFAILED (${fails})` : '\nAll working-papers pipeline checks passed.');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
