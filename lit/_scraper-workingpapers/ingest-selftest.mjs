/* ── ingest-selftest.mjs — offline tests for the paper-submission ingest ──────
 *
 * Pure, no network / no Firebase. Verifies the link parser, the author-match
 * gate, the whole decision function (added / duplicate / rejected reasons), the
 * Crossref→work adapter, and the dataset writer.
 *
 *   node ingest-submissions.mjs --selftest        (or)  node ingest-selftest.mjs
 */
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  urlToDoi, crossrefToWork, catalogAuthorIndex, catalogMatch, decideSubmission, regroupAndWrite,
  extractAnyDoi, routeSubmission, bibQueryText, matchBibItem,
  publishedFromCrossref, publishedFromOpenAlex, decidePublishedSubmission,
} from './ingest-submissions.mjs';
import { matchPublished } from './build-data.mjs';
import { normTitle } from '../_scraper/ec-pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '_sub-mock-out');

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { console.error('  FAIL ' + msg); fails++; } };

// A tiny published catalog: two known authors + one already-published title.
function ctxFixture(matchMode = 'fuzzy') {
  const authors = new Map([
    ['jane q. public', { name: 'Jane Q. Public' }],
    ['john smith', { name: 'John Smith' }],
    ['barış ata', { name: 'Barış Ata' }],
  ]);
  const publishedTitles = new Set([normTitle('An Already Published Paper')]);
  return {
    publishedTitles,
    catalogIndex: catalogAuthorIndex(authors),
    byKey: new Map(),
    matchMode,
  };
}

// An OpenAlex-shaped SSRN/arXiv/… work with a synthesized DOI + no locations
// (so wpRecordFromWork routes via preprintFromDoi, exactly like the real path).
function work(title, authorNames, doi, extra) {
  return Object.assign({
    doi: doi.startsWith('http') ? doi : ('https://doi.org/' + doi),
    title,
    publication_year: 2025,
    authorships: authorNames.map(n => ({ author: { display_name: n }, institutions: [{ display_name: 'Test University' }] })),
    primary_location: null, best_oa_location: null, locations: [],
    abstract_inverted_index: null,
    cited_by_count: 3,
  }, extra || {});
}

export function selftest() {
  console.log('paper-submission ingest selftest');

  // ── urlToDoi ──────────────────────────────────────────────────────────────
  const u = (s) => JSON.stringify(urlToDoi(s));
  ok(u('https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123456') === JSON.stringify({ doi: '10.2139/ssrn.123456', src: 'ssrn' }), 'SSRN abstract_id URL → ssrn DOI');
  ok(u('https://ssrn.com/abstract=999') === JSON.stringify({ doi: '10.2139/ssrn.999', src: 'ssrn' }), 'ssrn.com/abstract= URL → ssrn DOI');
  ok(u('https://arxiv.org/abs/2301.01234') === JSON.stringify({ doi: '10.48550/arxiv.2301.01234', src: 'arxiv' }), 'arXiv /abs URL → arxiv DOI');
  ok(u('https://arxiv.org/pdf/2301.01234v3') === JSON.stringify({ doi: '10.48550/arxiv.2301.01234', src: 'arxiv' }), 'arXiv /pdf vN URL → unversioned arxiv DOI');
  ok(u('https://www.nber.org/papers/w31234') === JSON.stringify({ doi: '10.3386/w31234', src: 'nber' }), 'NBER /papers/wN URL → nber DOI');
  ok(u('https://osf.io/preprints/socarxiv/abcde') === JSON.stringify({ doi: '10.31219/osf.io/abcde', src: 'osf' }), 'OSF preprint URL → osf DOI');
  ok(u('10.2139/ssrn.777') === JSON.stringify({ doi: '10.2139/ssrn.777', src: 'ssrn' }), 'bare SSRN DOI');
  ok(u('https://doi.org/10.3386/w42') === JSON.stringify({ doi: '10.3386/w42', src: 'nber' }), 'doi.org NBER DOI');
  ok(urlToDoi('https://www.biorxiv.org/content/10.1101/2023.01.02.522345v1') === null, 'bioRxiv URL rejected (not archived)');
  ok(urlToDoi('https://doi.org/10.1101/2023.01.02.522345') === null, 'bioRxiv DOI rejected');
  ok(urlToDoi('10.1287/mnsc.2023.1234') === null, 'published journal DOI rejected');
  ok(urlToDoi('https://pubsonline.informs.org/doi/10.1287/mnsc.2023.1234') === null, 'publisher journal URL rejected');
  ok(urlToDoi('https://arxiv.org.evil.com/abs/2301.01234') === null, 'spoofed arxiv host rejected');
  ok(urlToDoi('') === null && urlToDoi('not a link') === null, 'empty / junk rejected');

  // ── extractAnyDoi + routeSubmission (published-paper routing) ──────────────
  ok(extractAnyDoi('https://doi.org/10.1287/mnsc.2021.4165') === '10.1287/mnsc.2021.4165', 'extractAnyDoi: doi.org URL');
  ok(extractAnyDoi('https://pubsonline.informs.org/doi/10.1287/mnsc.2021.4165') === '10.1287/mnsc.2021.4165', 'extractAnyDoi: publisher URL with DOI path');
  ok(extractAnyDoi('… Management Science, 70(1), 1–20. 10.1287/mnsc.2021.4165.') === '10.1287/mnsc.2021.4165', 'extractAnyDoi: bare DOI mid-citation, trailing period trimmed');
  ok(extractAnyDoi('no doi here') === null && extractAnyDoi('') === null, 'extractAnyDoi: none → null');

  const route = (s) => routeSubmission(s);
  let r = route({ url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123456' });
  ok(r.path === 'wp' && r.doi === '10.2139/ssrn.123456' && r.src === 'ssrn', 'route: SSRN link → working-paper path');
  r = route({ url: 'https://doi.org/10.1287/mnsc.2021.4165', kind: 'wp' });
  ok(r.path === 'published' && r.doi === '10.1287/mnsc.2021.4165', 'route: journal DOI → published path (kind hint ignored)');
  r = route({ url: '', citation: 'Public, J. (2024). Some Paper. Mgmt Sci. https://doi.org/10.1002/smj.3322' });
  ok(r.path === 'published' && r.doi === '10.1002/smj.3322', 'route: DOI found in the citation → published path');
  r = route({ url: '', citation: 'Public, J. (2024). An SSRN paper. 10.2139/ssrn.777' });
  ok(r.path === 'wp' && r.src === 'ssrn', 'route: SSRN DOI in the citation → working-paper path');
  r = route({ url: 'https://www.biorxiv.org/content/10.1101/2023.01.02.522345v1' });
  ok(r.path === 'reject' && r.reason === 'unsupported', 'route: bioRxiv → rejected (not archived)');
  r = route({ url: 'not a link', citation: 'Public, J. (2024). A Citation Without Any DOI. Journal of Things, 1(2).' });
  ok(r.path === 'search', 'route: no DOI but a citation → bibliographic search');
  ok(route({ url: 'not a link' }).path === 'none', 'route: nothing usable → none (bad-url)');

  // ── bibQueryText + matchBibItem (citation-only resolution) ──────────────────
  ok(bibQueryText({ citation: 'The Citation' }) === 'The Citation', 'bibQueryText: citation first');
  ok(bibQueryText({ note: 'Citation: Folded, F. (2024). A Fallback.' }) === 'Folded, F. (2024). A Fallback.', 'bibQueryText: "Citation:" note (pre-rules-deploy fallback shape)');
  ok(bibQueryText({ title: 'A Title', authors: 'Jane Public' }) === 'A Title Jane Public', 'bibQueryText: title + authors hints');
  ok(bibQueryText({ note: 'just a note' }) === '', 'bibQueryText: a plain note is never searched');

  const bibItem = {
    DOI: '10.1287/mnsc.2024.1234', title: ['The Innovation Contest Game'],
    author: [{ given: 'Jane Q.', family: 'Public' }, { given: 'John', family: 'Smith' }],
    issued: { 'date-parts': [[2024]] }, 'container-title': ['Management Science'],
    volume: '70', issue: '1', page: '1-20', type: 'journal-article',
  };
  ok(matchBibItem('Public, J. Q., & Smith, J. (2024). The Innovation Contest Game. Management Science, 70(1), 1–20.', bibItem) === true,
    'matchBibItem: title + surname in the citation → accepted');
  ok(matchBibItem('Public, J. Q. (2024). A Different Paper Altogether. Management Science.', bibItem) === false,
    'matchBibItem: title not in the citation → rejected');
  ok(matchBibItem('Nobody, N. (2024). The Innovation Contest Game. MS.', bibItem) === false,
    'matchBibItem: no author surname in the citation → rejected');
  ok(matchBibItem('Public: The Game', { DOI: '10.1/x', title: ['The Game'], author: [{ family: 'Public' }] }) === false,
    'matchBibItem: sub-15-char normalized title → rejected (too generic)');

  // ── publishedFrom* adapters + decidePublishedSubmission ─────────────────────
  const pubRec = publishedFromCrossref(bibItem, '10.1287/MNSC.2024.1234');
  ok(pubRec.doi === '10.1287/mnsc.2024.1234' && pubRec.title === 'The Innovation Contest Game' &&
     pubRec.journal === 'Management Science' && pubRec.year === 2024 &&
     pubRec.authors.join('|') === 'Jane Q. Public|John Smith', 'publishedFromCrossref: fields + lowercased DOI');
  const oaPub = publishedFromOpenAlex({ doi: 'https://doi.org/10.1287/mnsc.2024.1234', title: 'The Innovation Contest Game',
    publication_year: 2024, authorships: [{ author: { display_name: 'Jane Q. Public' } }],
    primary_location: { source: { display_name: 'Management Science' } } });
  ok(oaPub.doi === '10.1287/mnsc.2024.1234' && oaPub.journal === 'Management Science' && oaPub.year === 2024,
    'publishedFromOpenAlex: fields from the OpenAlex shape');

  const pubCtx = () => ({
    dois: new Set(['10.1287/mnsc.2020.0001']),
    byTitle: new Map([[normTitle('A Listed Published Paper'), [{ doi: '10.1287/mnsc.2020.0002', last: new Set(['public']), year: 2020 }]]]),
  });
  let pd = decidePublishedSubmission({ doi: '10.1287/mnsc.2020.0001', title: 'Whatever Title', authors: ['X Y'], year: 2020, journal: 'MS' }, pubCtx());
  ok(pd.status === 'duplicate' && pd.reason === 'already-in-catalog' && pd.mode === 'published', 'decidePublished: DOI already in catalog → duplicate');
  pd = decidePublishedSubmission({ doi: '10.9999/other.registration', title: 'A Listed Published Paper', authors: ['Jane Q. Public'], year: 2020, journal: 'MS' }, pubCtx());
  ok(pd.status === 'duplicate' && pd.publishedDoi === '10.1287/mnsc.2020.0002', 'decidePublished: same paper under another DOI → duplicate via matchPublished');
  pd = decidePublishedSubmission({ doi: '10.1002/smj.9999', title: 'A Genuinely Missing Paper', authors: ['Jane Q. Public'], year: 2023, journal: 'SMJ' }, pubCtx());
  ok(pd.status === 'review' && pd.mode === 'published' && pd.pub && pd.pub.journal === 'SMJ', 'decidePublished: missing → review (forwarded to the maintainer)');
  pd = decidePublishedSubmission({ doi: '10.1002/smj.9999', title: '', authors: [], year: 0, journal: '' }, pubCtx());
  ok(pd.status === 'rejected' && pd.reason === 'unresolved', 'decidePublished: no resolvable title → rejected(unresolved)');

  // ── decideSubmission ────────────────────────────────────────────────────────
  const ctx = ctxFixture('fuzzy');
  const added = decideSubmission(work('A Brand-New Working Paper', ['Jane Q. Public', 'Random Coauthor'], '10.2139/ssrn.111'), ctx);
  ok(added.status === 'added', 'catalog author + new title → added');
  ok(added.rec && added.rec.JKey === 'wp-ssrn' && added.rec.Status === 'Working paper', 'added record is a wp-ssrn working paper');
  ok(added.match && added.match.matched.includes('Jane Q. Public') && added.match.matchType === 'exact', 'exact author match recorded');
  ok(added.rec.CitedBy === 3, 'CitedBy carried');

  const dup = (() => { const c = ctxFixture(); const w = work('Dup Paper', ['Jane Q. Public'], '10.2139/ssrn.222');
    const a = decideSubmission(w, c); c.byKey.set(a.key, a.rec); return decideSubmission(w, c); })();
  ok(dup.status === 'duplicate', 'already in archive → duplicate');

  const pub = decideSubmission(work('An Already Published Paper', ['Jane Q. Public'], '10.2139/ssrn.333'), ctxFixture());
  ok(pub.status === 'rejected' && pub.reason === 'already-published', 'title already in catalog → rejected(already-published)');

  const noauth = decideSubmission(work('Outsider Paper', ['Someone Unknown', 'Nobody Here'], '10.2139/ssrn.444'), ctxFixture());
  ok(noauth.status === 'rejected' && noauth.reason === 'no-catalog-author', 'no catalog author → rejected(no-catalog-author)');

  const unsup = decideSubmission(work('Journal Paper', ['Jane Q. Public'], '10.1287/mnsc.2025.1'), ctxFixture());
  ok(unsup.status === 'rejected' && unsup.reason === 'unsupported', 'non-preprint DOI → rejected(unsupported)');

  const fuzzy = decideSubmission(work('Fuzzy Match Paper', ['J. Smith'], '10.2139/ssrn.555'), ctxFixture('fuzzy'));
  ok(fuzzy.status === 'added' && fuzzy.match.matchType === 'fuzzy', 'last-name + initial → fuzzy added');
  const strict = decideSubmission(work('Fuzzy Match Paper', ['J. Smith'], '10.2139/ssrn.556'), ctxFixture('exact'));
  ok(strict.status === 'rejected' && strict.reason === 'no-catalog-author', 'exact mode rejects a fuzzy-only match');

  const accent = decideSubmission(work('Accent Paper', ['Baris Ata'], '10.2139/ssrn.557'), ctxFixture());
  ok(accent.status === 'added', 'accent-folded author name still matches (Baris ≈ Barış)');

  // ── matchPublished + the "linked to a published paper" outcome ──────────────
  const PUB_TITLE = 'The Impact of the Opportunity Zone Program on Residential Real Estate';
  const pubDoi = '10.1287/msom.2024.0746';
  const byTitle = new Map([[normTitle(PUB_TITLE), [{ doi: pubDoi, last: new Set(['cohen', 'bekkerman']), year: 2024 }]]]);
  ok(matchPublished({ Title: PUB_TITLE, Authors: 'Maxime C. Cohen', Year: '2021' }, byTitle).doi === pubDoi, 'matchPublished: title + shared author → the published DOI');
  ok(matchPublished({ Title: PUB_TITLE, Authors: 'Someone Else', Year: '2021' }, byTitle) === null, 'matchPublished: same title, no shared author → null');
  ok(matchPublished({ Title: 'A Totally Different Title', Authors: 'Maxime C. Cohen' }, byTitle) === null, 'matchPublished: different title → null');

  const linkCtx = () => {
    const c = ctxFixture();
    c.publishedTitles = new Set([normTitle(PUB_TITLE)]);
    c.byTitle = byTitle;
    return c;
  };
  const linked = decideSubmission(work(PUB_TITLE, ['Maxime C. Cohen'], '10.2139/ssrn.3780241', { publication_year: 2021 }), linkCtx());
  ok(linked.status === 'linked', 'submitted SSRN link matching a published paper → linked (not rejected)');
  ok(linked.publishedDoi === pubDoi, 'linked outcome carries the published DOI');
  ok(linked.preprint && linked.preprint.includes('ssrn'), 'linked outcome carries the SSRN pre-print URL');
  const collide = decideSubmission(work(PUB_TITLE, ['Nobody Known'], '10.2139/ssrn.3780242', { publication_year: 2021 }), linkCtx());
  ok(collide.status === 'rejected' && collide.reason === 'already-published', 'same published title but a different author → rejected(already-published), not linked');

  // ── crossrefToWork → decideSubmission ───────────────────────────────────────
  const cw = crossrefToWork({
    DOI: '10.2139/ssrn.888', title: ['A Crossref-Resolved SSRN Paper'],
    author: [{ given: 'Jane Q.', family: 'Public' }, { given: 'A.', family: 'Coauthor' }],
    issued: { 'date-parts': [[2024]] }, abstract: '<jats:p>We study <jats:italic>things</jats:italic>.</jats:p>',
    'is-referenced-by-count': 7,
  }, '10.2139/ssrn.888');
  const crOut = decideSubmission(cw, ctxFixture());
  ok(crOut.status === 'added', 'Crossref-resolved work → added');
  ok(crOut.rec.Authors === 'Jane Q. Public, A. Coauthor', 'Crossref authors joined "Given Family", comma-separated');
  ok(crOut.rec.Year === '2024', 'Crossref year from date-parts');
  ok(crOut.rec.Abstract === 'We study things .', 'Crossref JATS abstract stripped + folded in (matches stripJats)');
  ok(crOut.rec.CitedBy === 7, 'Crossref is-referenced-by-count carried');

  // ── regroupAndWrite ─────────────────────────────────────────────────────────
  return (async () => {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    const byKey = new Map();
    for (const [t, a, d] of [
      ['Newest WP', ['Jane Q. Public'], '10.2139/ssrn.111'],
      ['Older WP', ['John Smith'], '10.2139/ssrn.112'],
    ]) { const o = decideSubmission(work(t, a, d), ctxFixture()); byKey.set(o.key, o.rec); }
    // add an arXiv one so a second source appears
    const ax = decideSubmission(work('An arXiv WP', ['Jane Q. Public'], '10.48550/arxiv.2401.00001', {
      doi: 'https://doi.org/10.48550/arxiv.2401.00001', publication_year: 2024 }), ctxFixture());
    byKey.set(ax.key, ax.rec);
    // Stamp ONE row as newly added (what run() does on an `added` outcome):
    // recent.json must list only dated rows — the page's "Recently added" feed.
    ax.rec['Date Added'] = '2026-07-18';

    const w = await regroupAndWrite(byKey, { authorCount: 42, source: 'test' }, 183342, OUT);
    ok(w.total === 3, 'regroupAndWrite wrote 3 rows total');

    const recent = JSON.parse(await readFile(join(OUT, 'recent.json'), 'utf8'));
    ok(recent.length === 1 && recent[0]['Date Added'] === '2026-07-18',
      'recent.json lists ONLY rows stamped Date Added (the newly added ones)');

    // The ingest is the archive's second writer, so it has to refresh the tally
    // the page's "N working papers added in the last 4 weeks" is read from —
    // recent.json is capped and can never be the source of that number.
    const rcounts = JSON.parse(await readFile(join(OUT, 'recent-counts.json'), 'utf8'));
    ok(rcounts.windowDays >= 28, 'recent-counts.json covers the 4 weeks the page shows');
    ok((rcounts.days['wp-arxiv'] || {})['2026-07-18'] === 1,
      'recent-counts.json tallies the newly added row under its repository');

    const sources = JSON.parse(await readFile(join(OUT, 'sources.json'), 'utf8'));
    const keys = sources.map(s => s.key).sort();
    ok(keys.length === 2 && keys[0] === 'wp-arxiv' && keys[1] === 'wp-ssrn', 'sources.json lists only non-empty repos (wp-arxiv, wp-ssrn)');
    ok(sources.every(s => s.workingPaper === true), 'every source flagged workingPaper:true');

    const ssrn = JSON.parse(await readFile(join(OUT, 'papers-wp-ssrn.json'), 'utf8'));
    ok(ssrn.length === 2 && ssrn[0].Year >= ssrn[1].Year, 'papers-wp-ssrn.json sorted year-desc');
    const meta = JSON.parse(await readFile(join(OUT, 'meta.json'), 'utf8'));
    ok(meta.paperCount === 3 && meta.workingPapers === true, 'meta.json paperCount + workingPapers flag');
    ok(meta.authorCount === 42, 'meta.json preserves the crawler authorCount');
    ok(meta.authorsInCatalog === 183342, 'meta.json refreshes authorsInCatalog');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(meta.lastPull), 'meta.json lastPull is a date');

    await rm(OUT, { recursive: true, force: true });

    if (fails) { console.error(`\ningest selftest: ${fails} failure(s)`); process.exit(1); }
    console.log('\ningest selftest: OK');
    process.exit(0);
  })();
}

// Run when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selftest();
}
