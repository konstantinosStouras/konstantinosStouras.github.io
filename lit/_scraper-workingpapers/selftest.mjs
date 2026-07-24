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
import { wpRecordFromWork, orderAuthors, invertAbstract, loadCatalog, cleanText,
  wpSameWork, collapseWpDuplicates, recKey } from './build-data.mjs';

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

  console.log('unit: cleanText (strip publisher HTML markup from titles)');
  ok(cleanText('&lt;p&gt;&lt;span&gt;An Economic Geography Dataset&lt;/span&gt;&lt;/p&gt;')
    === 'An Economic Geography Dataset', 'entity-encoded <p><span> wrapper removed');
  ok(cleanText('&lt;b&gt;10 Principles&lt;/b&gt;') === '10 Principles', 'entity-encoded <b> removed');
  ok(cleanText('&lt;div&gt; Bricks or Cash?&amp;nbsp;&lt;span&gt;High-density Cities&lt;/span&gt;&lt;/div&gt;')
    === 'Bricks or Cash? High-density Cities', 'double-encoded &amp;nbsp; → space, tags stripped');
  ok(cleanText('First Part&lt;br&gt;Second Part') === 'First Part Second Part', '<br> becomes a space (line break)');
  ok(cleanText('Cs&lt;sub&gt;3&lt;/sub&gt;Cu&lt;sub&gt;2&lt;/sub&gt;I&lt;sub&gt;5&lt;/sub&gt; Films')
    === 'Cs3Cu2I5 Films', 'subscripts strip with no space (chemistry formula intact)');
  ok(cleanText('Mergers &amp;amp; Acquisitions') === 'Mergers & Acquisitions', 'double-encoded ampersand → &');
  ok(cleanText('Risk &amp; Return') === 'Risk & Return', 'single-encoded ampersand → &');
  ok(cleanText('When is P &lt; 0.05 Significant?') === 'When is P < 0.05 Significant?', 'lone < (not a tag) is preserved');
  ok(cleanText('A Perfectly Ordinary Title') === 'A Perfectly Ordinary Title', 'clean title unchanged (idempotent)');

  console.log('unit: collapseWpDuplicates (same paper posted more than once)');
  const wpRow = (o) => ({ Title: 'Crowdsourcing Contests with Entry Costs', Authors: 'Jane Doe, Wei Chen',
    Year: '2022', JKey: 'wp-ssrn', DOI: 'https://doi.org/10.2139/ssrn.100', Abstract: 'x',
    Preprint: 'https://ssrn.com/abstract=100', Status: 'Working paper', ...o });
  ok(wpSameWork(wpRow({}), wpRow({ DOI: 'https://doi.org/10.2139/ssrn.222', Year: '2024' })),
    'a re-posted SSRN version (new id, later year) is the same paper');
  ok(wpSameWork(wpRow({}), wpRow({ JKey: 'wp-arxiv', DOI: 'https://doi.org/10.48550/arxiv.2201.1' })),
    'the arXiv twin of an SSRN posting is the same paper');
  ok(!wpSameWork(wpRow({}), wpRow({ Authors: 'Alex Mason' })), 'different authors are not the same paper');
  ok(!wpSameWork(wpRow({}), wpRow({ Title: 'Crowdsourcing Contests without Entry Costs' })),
    'a different title is not the same paper');
  {
    const oldPost = wpRow({ 'Date Added': '2026-01-05', CitedBy: 7 });
    const newPost = wpRow({ DOI: 'https://doi.org/10.2139/ssrn.222', Year: '2024',
      Preprint: 'https://ssrn.com/abstract=222' });
    const other = wpRow({ Title: 'A Totally Unrelated Working Paper Title', DOI: 'https://doi.org/10.2139/ssrn.300' });
    const byKey = new Map([[recKey(oldPost), oldPost], [recKey(newPost), newPost], [recKey(other), other]]);
    const n = collapseWpDuplicates(byKey);
    ok(n === 1 && byKey.size === 2, 'collapse drops exactly the duplicate posting');
    const kept = byKey.get(recKey(newPost));
    ok(kept === newPost, 'the newest posting wins');
    ok(kept['Date Added'] === '2026-01-05' && kept.CitedBy === 7,
      'earliest Date Added + enrichment fold into the kept row');
    ok(collapseWpDuplicates(byKey) === 0, 'collapse is idempotent');
  }
  ok(cleanText(cleanText('&lt;p&gt;Twice&lt;/p&gt;')) === 'Twice', 're-applying cleanText is a no-op');

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

  console.log('e2e: "Date Added" stamping + recent.json (Recently added feed)');
  ok(ssrnRows[0]['Date Added'] === '2026-07-13', 'new row stamped Date Added = pull date');
  const recent1 = await readOut('recent.json');
  ok(recent1.length === 2 && recent1.every(r => r['Date Added'] === '2026-07-13'),
    'recent.json lists exactly the dated (newly added) rows');

  // Re-run with a later pull date and refresh forced: the re-crawl overwrites
  // each row with a fresh rec — the original Date Added must survive it.
  await run(process.execPath, [join(__dirname, 'build-data.mjs')], {
    env: { ...process.env, WP_MOCK: '1', WP_DATA_DIR: OUT,
      WP_CATALOG_DIRS: join(__dirname, 'mock', 'catalog'), WP_PULL_DATE: '2026-07-14',
      WP_REFRESH_DAYS: '0' },
  });
  const ssrnRows2 = await readOut('papers-wp-ssrn.json');
  ok(ssrnRows2.length === 1 && ssrnRows2[0]['Date Added'] === '2026-07-13',
    're-crawl preserves the original Date Added (no re-stamp)');
  const recent2 = await readOut('recent.json');
  ok(recent2.length === 2 && recent2.every(r => r['Date Added'] === '2026-07-13'),
    'recent.json unchanged by a re-crawl of known rows');

  await rm(OUT, { recursive: true, force: true });
  console.log(fails ? `\nFAILED (${fails})` : '\nAll working-papers pipeline checks passed.');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
