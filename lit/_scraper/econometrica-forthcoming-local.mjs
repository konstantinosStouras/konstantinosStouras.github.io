/*
 * econometrica-forthcoming-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * The Econometrica analogue of informs-aia-local.mjs. It keeps the FORTHCOMING
 * (accepted, not-yet-in-an-issue) Econometrica papers current by reading them
 * straight from the Econometric Society's own forthcoming-papers page:
 *   https://www.econometricsociety.org/publications/econometrica/forthcoming-papers
 *
 * Why this exists — and why it is separate from the six INFORMS/SAGE journals:
 * Econometrica lives ONLY in lit's FT50 catalog (lit/data-ft50/), and its
 * publisher (Wiley, for the Econometric Society) assigns an accepted paper
 * straight to a FUTURE issue rather than to a no-volume "Articles in Advance"
 * stage. So Crossref NEVER lists a forthcoming Econometrica paper as an advance
 * article — the daily FT50 build (and the new lit-ft50-check-new incremental)
 * only ever pick a paper up once Wiley has deposited it to Crossref. The
 * Econometric Society's forthcoming page lists papers EARLIER than that, so this
 * scraper is the only way to surface them in The Lit before Crossref catches up.
 *
 * It writes forthcoming papers into the FT50 catalog's advance-articles
 * supplement:
 *
 *   lit/data-ft50/_informs-aia.json   forthcoming papers Crossref has NOT indexed
 *                                     yet, keyed by DOI with "jkey":"ecta". The
 *                                     daily FT50 build merges these in (see
 *                                     mergeSupplement in _scraper-ft50/build-data.mjs)
 *                                     and drops each one automatically once
 *                                     Crossref returns it (superseded by DOI).
 *
 * The file is SHARED with informs-aia-local.mjs --app lit-ft50 (which fills the
 * INFORMS FT50 journals' forthcoming rows, e.g. Organization Science): this tool
 * only ever adds/updates/prunes the Econometrica (10.3982/…) entries and leaves
 * every other publisher's entries untouched.
 *
 * Why local? Like pubsonline.informs.org / pnas.org, econometricsociety.org can
 * challenge cloud/datacenter IPs (a GitHub Actions runner). From a normal home or
 * university connection the pages load fine. This mirrors exactly why
 * informs-aia-local.mjs, informs-editors-local.mjs and pnas-concepts-local.mjs
 * run locally too. The detail-page parser reads the standard Google-Scholar
 * citation_* meta tags the site emits (Drupal "Metatag Google Scholar").
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node econometrica-forthcoming-local.mjs --dry-run   # print what it finds, write nothing
 *   node econometrica-forthcoming-local.mjs             # write lit/data-ft50/_informs-aia.json
 *   node econometrica-forthcoming-local.mjs --max 50    # bound one session
 *   node econometrica-forthcoming-local.mjs --selftest  # offline parser test (no network)
 *
 * IMPORTANT — verify once with --dry-run. The detail-page parser is the proven
 * citation_* approach, but the LISTING page's exact markup could not be inspected
 * from the build environment (the host blocks it). If a --dry-run finds zero
 * candidates on a page that clearly lists papers, widen listingCandidates()
 * below (its DOI / detail-link regexes) to match the live markup, then re-run.
 *
 * It is resume-safe: a per-candidate cache (_ecta-forthcoming-cache.json in
 * lit/data-ft50/, keyed by each candidate's DOI or detail-page URL) records what
 * has already been resolved, so you can run it in as many sittings as you like;
 * an un-parseable page is left un-cached and retried next run. If Cloudflare
 * challenges your connection, follow the
 * LIT_CF_COOKIE hint it prints (same mechanism as the other local scrapers).
 * ===========================================================================
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
// Atomic write (temp + rename): a power-off mid-write can never truncate a file.
async function awrite(dest, str) {
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, str, 'utf8');
  await rename(tmp, dest);
}
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChallenged } from './pnas-crawl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data-ft50');
const HOST = 'https://www.econometricsociety.org';
const LISTING_URL = `${HOST}/publications/econometrica/forthcoming-papers`;
const JKEY = 'ecta';
const COOKIE = process.env.LIT_CF_COOKIE || '';
const DELAY_MS = 1800;

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const DRY_RUN = args.includes('--dry-run');
const MAX = args.includes('--max') ? parseInt(argVal('--max'), 10) : Infinity;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── HTTP (mirrors informs-aia-local.mjs) ────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': process.env.LIT_UA ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    redirect: 'follow',
  });
  return { status: res.status, body: await res.text() };
}

function cfBlockedMessage() {
  console.error('\n✗ Blocked/challenged by the host from this connection.');
  console.error('  Fix: open the forthcoming-papers page in your browser, pass any check, then re-run with');
  console.error('  LIT_CF_COOKIE="cf_clearance=<value from DevTools>" node econometrica-forthcoming-local.mjs');
}

// ── Parsing ─────────────────────────────────────────────────────────────────

// Individual-paper DOIs look like 10.3982/ECTA<manuscript#>. Exclude the
// per-volume editorial/list documents the forthcoming page itself is published
// as (…FORTH), plus presentations, front/back matter and annual reports.
const ECTA_DOI_RE = /10\.3982\/ecta[0-9a-z.\-]+/gi;
const EDITORIAL_DOI_RE = /ecta\d*(forth|pres|front|back|report|annual|editor)/i;

// Detail-page paths on the site look like /publications/econometrica/YYYY/MM/DD/<slug>.
// Skip obvious non-paper slugs (front/back matter, reports, the forthcoming page).
const DETAIL_PATH_RE = /\/publications\/econometrica\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9][A-Za-z0-9\-]*/g;
const NON_PAPER_SLUG_RE = /(frontmatter|backmatter|forthcoming|annual-report|report-of-the-editors|report-20|table-of-contents|masthead|editorial-board)/i;

function normDoi(d) {
  return String(d || '').toLowerCase().replace(/^https?:\/\/doi\.org\//i, '').replace(/[.,;)]+$/, '');
}

// Every forthcoming-paper candidate on the listing page: a mix of individual
// DOIs and detail-page paths (the page's exact markup varies, so gather both
// and let the detail-page fetch confirm each). Returns { dois:[…], paths:[…] }.
function listingCandidates(html) {
  const dois = new Set();
  for (const m of html.matchAll(ECTA_DOI_RE)) {
    const d = normDoi(m[0]);
    if (!EDITORIAL_DOI_RE.test(d)) dois.add(d);
  }
  const paths = new Set();
  for (const m of html.matchAll(DETAIL_PATH_RE)) {
    const p = m[0];
    if (!NON_PAPER_SLUG_RE.test(p)) paths.add(p);
  }
  return { dois: [...dois], paths: [...paths] };
}

function metaContent(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : '';
}

function metaAll(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'gi');
  const out = [];
  for (const m of html.matchAll(re)) out.push(decodeEntities(m[1]).trim());
  return out;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x2019;|&#8217;/g, '’').replace(/&#x2018;|&#8216;/g, '‘')
    .replace(/&nbsp;/g, ' ');
}

// "Last, First" -> "First Last"; strip commas (the apps split Authors on commas).
function normAuthor(a) {
  a = a.replace(/\s+/g, ' ').trim();
  const c = a.indexOf(',');
  if (c !== -1) a = a.slice(c + 1).trim() + ' ' + a.slice(0, c).trim();
  return a.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

// Read a detail page's Google-Scholar citation_* meta. A forthcoming paper has a
// DOI + title + authors but no volume/issue; a paper that has since been placed
// in an issue carries a volume/issue and is left to the daily Crossref build.
function parseArticle(html) {
  const year = (metaContent(html, 'citation_online_date') ||
    metaContent(html, 'citation_publication_date') ||
    metaContent(html, 'citation_date') || '').match(/\d{4}/);
  return {
    doi: normDoi(metaContent(html, 'citation_doi')),
    title: metaContent(html, 'citation_title'),
    authors: metaAll(html, 'citation_author').map(normAuthor).filter(Boolean).join(', '),
    volume: metaContent(html, 'citation_volume'),
    issue: metaContent(html, 'citation_issue'),
    year: year ? year[0] : '',
  };
}

// ── Load the FT50 catalog's already-known Econometrica DOIs ──────────────────

async function knownEctaDois() {
  const known = new Set();
  const path = join(DATA_DIR, `papers-${JKEY}.json`);
  if (!existsSync(path)) return known;
  let rows;
  try { rows = JSON.parse(await readFile(path, 'utf8')); } catch { return known; }
  for (const r of Array.isArray(rows) ? rows : []) {
    const doi = normDoi(r.DOI);
    if (doi) known.add(doi);
  }
  return known;
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

// ── Offline parser self-test (no network) ────────────────────────────────────

function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

  const listing = `
    <html><body>
      <h1>Forthcoming Papers</h1>
      <a href="/doi/10.3982/ECTA906FORTH">Forthcoming Papers (list)</a>
      <div class="paper"><a href="/doi/10.3982/ECTA21849">Work Hours Mismatch</a></div>
      <div class="paper"><a href="/publications/econometrica/2026/07/01/Assortative-Matching-on-Income">Assortative Matching on Income</a></div>
      <div class="paper"><a href="/publications/econometrica/2026/01/01/Frontmatter-of-Vol-94">Frontmatter</a></div>
    </body></html>`;
  const cand = listingCandidates(listing);
  ok(cand.dois.includes('10.3982/ecta21849'), 'extracts an individual-paper DOI');
  ok(!cand.dois.some(d => /forth/.test(d)), 'excludes the …FORTH list-document DOI');
  ok(cand.paths.some(p => /Assortative-Matching-on-Income/.test(p)), 'extracts a paper detail path');
  ok(!cand.paths.some(p => /Frontmatter/.test(p)), 'excludes a front-matter detail path');

  const forthcomingHtml = `<html><head>
    <meta name="citation_title" content="Work Hours Mismatch">
    <meta name="citation_author" content="Smith, Jane">
    <meta name="citation_author" content="Doe, John">
    <meta name="citation_doi" content="10.3982/ECTA21849">
    <meta name="citation_online_date" content="2026/05/01">
  </head><body></body></html>`;
  const a = parseArticle(forthcomingHtml);
  ok(a.title === 'Work Hours Mismatch', 'parses citation_title');
  ok(a.authors === 'Jane Smith, John Doe', 'parses + normalises citation_author (Last, First -> First Last)');
  ok(a.doi === '10.3982/ecta21849', 'parses citation_doi');
  ok(!a.volume && !a.issue, 'forthcoming article has no volume/issue');
  ok(a.year === '2026', 'derives the year');

  const publishedHtml = forthcomingHtml.replace('</head>',
    '<meta name="citation_volume" content="94"><meta name="citation_issue" content="3"></head>');
  const b = parseArticle(publishedHtml);
  ok(b.volume === '94' && b.issue === '3', 'a placed paper reports its volume/issue (left to the daily build)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (args.includes('--selftest')) { selftest(); }

// ── Main ─────────────────────────────────────────────────────────────────────

const CACHE_PATH = join(DATA_DIR, '_ecta-forthcoming-cache.json');
const SUPPLEMENT_PATH = join(DATA_DIR, '_informs-aia.json');

const cache = existsSync(CACHE_PATH) ? JSON.parse(await readFile(CACHE_PATH, 'utf8')) : {};
const supplement = existsSync(SUPPLEMENT_PATH) ? JSON.parse(await readFile(SUPPLEMENT_PATH, 'utf8')) : {};

console.log(`econometrica-forthcoming-local${DRY_RUN ? ' (dry run)' : ''}: ${LISTING_URL}`);
const known = await knownEctaDois();
console.log(`  FT50 catalog already knows ${known.size} Econometrica DOIs`);

// 1) Read the forthcoming-papers listing → candidate DOIs + detail paths.
let candidates = { dois: [], paths: [] };
try {
  const { status, body } = await fetchPage(LISTING_URL);
  if (isChallenged(body, status)) { cfBlockedMessage(); process.exit(1); }
  if (status !== 200) { console.error(`  listing page HTTP ${status} — aborting.`); process.exit(1); }
  candidates = listingCandidates(body);
  console.log(`  listing: ${candidates.dois.length} DOI(s), ${candidates.paths.length} detail path(s)`);
} catch (e) { console.error(`  listing fetch failed: ${e.message}`); process.exit(1); }
await sleep(DELAY_MS);

// 2) Build the work list: each candidate DOI's /doi/<doi> page + each detail path.
const targets = [];
for (const d of candidates.dois) targets.push({ url: `${HOST}/doi/${d}`, doi: d });
for (const p of candidates.paths) targets.push({ url: `${HOST}${p}`, doi: '' });

let fetched = 0, newForth = 0, pruned = 0;
async function save() {
  if (DRY_RUN) return;
  await awrite(CACHE_PATH, JSON.stringify(cache));
  await awrite(SUPPLEMENT_PATH, JSON.stringify(sortKeys(supplement), null, 0));
}

outer:
for (const t of targets) {
  if (fetched >= MAX) break;
  // Resume-safety: skip a candidate already resolved in a prior run. DOI
  // candidates key on their DOI; detail-path candidates (t.doi === '') key on
  // their URL, so they too are skipped once resolved (not re-fetched forever).
  const key = t.doi || t.url;
  if ((t.doi && known.has(t.doi)) || (cache[key] && cache[key].done)) continue;
  fetched++;
  try {
    const { status, body } = await fetchPage(t.url);
    if (isChallenged(body, status)) { cfBlockedMessage(); break outer; }
    if (status !== 200) { console.warn(`  ${t.url}: HTTP ${status}`); await sleep(DELAY_MS); continue; }
    const a = parseArticle(body);
    const doi = a.doi || t.doi;
    if (!doi || !a.title) {
      // Couldn't parse a usable record (a transient/partial 200, or a page with
      // no citation_* meta). Leave it UN-cached so a later healthy run retries —
      // symmetric with the non-200 path above. --max bounds any re-fetching.
      await sleep(DELAY_MS); continue;
    }
    if (a.volume || a.issue) {
      // Already placed in an issue → the daily Crossref build owns it; make sure
      // no stale forthcoming row lingers.
      if (supplement[doi] && supplement[doi].jkey === JKEY) { delete supplement[doi]; pruned++; }
    } else if (!known.has(doi)) {
      if (!supplement[doi]) newForth++; // count only genuinely-new supplement rows
      supplement[doi] = { jkey: JKEY, Title: a.title, Authors: a.authors, Year: a.year || String(new Date().getFullYear()) };
      console.log(`  + forthcoming: ${doi}  ${a.title.slice(0, 70)}${a.authors ? '  — ' + a.authors.slice(0, 60) : ''}`);
    }
    // Resolved: skip this candidate (by URL and by DOI) on future runs.
    cache[key] = { done: true };
    if (doi !== key) cache[doi] = { done: true };
    if (fetched % 25 === 0) await save();
  } catch (e) { console.warn(`  ${t.url}: ${e.message}`); }
  await sleep(DELAY_MS);
}

// 3) Prune supplement Econometrica rows Crossref has since caught up on.
for (const doi of Object.keys(supplement)) {
  if (supplement[doi] && supplement[doi].jkey === JKEY && known.has(normDoi(doi))) { delete supplement[doi]; pruned++; }
}

await save();
const ectaCount = Object.values(supplement).filter(s => s && s.jkey === JKEY).length;
console.log(`\n${DRY_RUN ? '[dry run] would write' : '✓ Wrote'}: ${SUPPLEMENT_PATH}`);
console.log(`  Econometrica forthcoming rows: ${ectaCount} (this session: +${newForth} new, ${pruned} pruned; ${fetched} pages fetched)`);
if (!DRY_RUN && (newForth || pruned)) {
  console.log('\nNext: commit and push the supplement, e.g.');
  console.log(`  git add ${SUPPLEMENT_PATH} ${CACHE_PATH}`);
  console.log('  git commit -m "lit-ft50: refresh Econometrica forthcoming papers"');
  console.log('  git push');
  console.log('The next daily FT50 build folds them in automatically.');
}
