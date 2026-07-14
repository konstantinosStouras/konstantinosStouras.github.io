/*
 * informs-aia-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * Keeps the "Articles in Advance" (forthcoming) papers current by reading them
 * straight from INFORMS' own advance-articles pages, e.g.
 *   https://pubsonline.informs.org/toc/mnsc/0/0   (Management Science)
 *   https://pubsonline.informs.org/toc/opre/0/0   (Operations Research)  … etc.
 *
 * It writes two committed files into a target app's data/ folder:
 *
 *   _informs-aia.json  forthcoming papers INFORMS lists that Crossref has NOT
 *                      indexed yet (so the daily Crossref build would miss them).
 *                      The build merges these in — see mergeSupplement() — and
 *                      drops each one automatically once Crossref catches up.
 *
 *   _aia-fixups.json   real volume/issue for older records whose Crossref entry
 *                      is frozen at the advance stage (no volume/issue), so the
 *                      build can show them as published instead of mislabeling
 *                      them "Articles in Advance" forever.
 *
 * Why local? pubsonline.informs.org (an Atypon site, like pnas.org) blocks
 * cloud/datacenter IPs — the GitHub Actions runner gets a 403. From a normal
 * home or university connection the pages load fine. This mirrors exactly why
 * informs-editors-local.mjs and pnas-concepts-local.mjs run locally too.
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node informs-aia-local.mjs                 # target: lit  (all INFORMS journals)
 *   node informs-aia-local.mjs --app ms        # target: fun/ms   (Management Science)
 *   node informs-aia-local.mjs --app lit-ft50  # target: lit/data-ft50 (the FT50 catalog)
 *   node informs-aia-local.mjs --app ms --journals mnsc     # limit to one journal
 *   node informs-aia-local.mjs --max 300       # bound one session
 *
 * It is resume-safe: a per-DOI cache (_aia-cache.json in the target data/ dir)
 * records what has been fetched, so you can run it in as many sittings as you
 * like. When done, commit the two output files; the next daily build folds them
 * in. If Cloudflare challenges your connection, follow the LIT_CF_COOKIE hint it
 * prints (same mechanism as informs-editors-local.mjs / pnas-concepts-local.mjs).
 * ===========================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChallenged } from './pnas-crawl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAILTO = process.env.LIT_MAILTO || 'kstouras@gmail.com';
const COOKIE = process.env.LIT_CF_COOKIE || '';
const DELAY_MS = 1800;

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const APP = argVal('--app', 'lit');
const MAX = args.includes('--max') ? parseInt(argVal('--max'), 10) : Infinity;
const ONLY = (argVal('--journals', '') || '').split(',').map(s => s.trim()).filter(Boolean);

// Every INFORMS journal the three apps can show, keyed by its pubsonline toc
// code (which is also the code in its 10.1287/<code>.… DOIs). `key` is the
// source key each app uses in its per-source data files (fun/ms is single-source
// and needs none). ft50's live keys are read from journals.json below.
const INFORMS = [
  { code: 'mnsc', litKey: 'ms',   name: 'Management Science' },
  { code: 'opre', litKey: 'opre', name: 'Operations Research' },
  { code: 'mksc', litKey: 'mksc', name: 'Marketing Science' },
  { code: 'msom', litKey: 'msom', name: 'Manufacturing & Service Operations Management' },
  { code: 'isre', litKey: 'isre', name: 'Information Systems Research' },
  { code: 'orsc', litKey: null,   name: 'Organization Science' }, // FT50 only
  { code: 'ijoc', litKey: null,   name: 'INFORMS Journal on Computing' }, // UTD24 only (lit-ft50 catalog)
];

// Resolve the target app: its data/ dir, its INFORMS journals, and the source
// key each journal uses there.
async function resolveApp() {
  if (APP === 'ms') {
    return {
      dataDir: resolve(__dirname, '..', '..', 'ms', 'data'),
      sources: INFORMS.filter(j => j.code === 'mnsc').map(j => ({ ...j, key: null, file: 'papers.json' })),
    };
  }
  if (APP === 'lit') {
    return {
      dataDir: resolve(__dirname, '..', 'data'),
      sources: INFORMS.filter(j => j.litKey).map(j => ({ ...j, key: j.litKey, file: `papers-${j.litKey}.json` })),
    };
  }
  if (APP === 'lit-ft50') {
    // lit-ft50 = lit's FT50 dataset (lit/data-ft50, maintained by
    // lit/_scraper-ft50 — vendored from the retired fun/ft50 app).
    const jpath = resolve(__dirname, '..', '_scraper-ft50', 'journals.json');
    const journals = existsSync(jpath) ? JSON.parse(await readFile(jpath, 'utf8')) : [];
    const byIssn = (issn) => journals.find(j => !j.retired && (j.issns || []).includes(issn));
    // Map each INFORMS code to the FT50 journal (by its known primary ISSN).
    const ISSN = { mnsc: '0025-1909', opre: '0030-364X', mksc: '0732-2399', msom: '1523-4614', isre: '1047-7047', orsc: '1047-7039', ijoc: '1091-9856' };
    const sources = [];
    for (const j of INFORMS) {
      const entry = byIssn(ISSN[j.code]);
      if (entry && entry.aia) sources.push({ ...j, key: entry.key, file: `papers-${entry.key}.json` });
    }
    return { dataDir: resolve(__dirname, '..', 'data-ft50'), sources };
  }
  throw new Error(`unknown --app "${APP}" (expected: ms | lit | lit-ft50)`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── HTTP (mirrors informs-editors-local.mjs) ────────────────────────────────

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
  console.error('\n✗ Blocked by Cloudflare from this connection.');
  console.error('  Fix: open https://pubsonline.informs.org in your browser, pass the check, then re-run with');
  console.error('  LIT_CF_COOKIE="cf_clearance=<value from DevTools>" node informs-aia-local.mjs');
}

// ── Parsing ─────────────────────────────────────────────────────────────────

// Every advance DOI on a toc/<code>/0/0 page, pulled straight from the markup.
// Robust to layout: any 10.1287/<code>.<year>.<seq> that appears in the HTML.
function doisOnTocPage(html, code) {
  const re = new RegExp(`10\\.1287/${code}\\.[0-9]{4}\\.[0-9a-z.]+`, 'gi');
  const out = new Set();
  for (const m of html.matchAll(re)) out.add(m[0].toLowerCase().replace(/[.,;)]+$/, ''));
  return [...out];
}

function metaContent(html, name) {
  // <meta name="citation_x" content="…"> in either attribute order.
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

// Read an article page's citation_* meta. Forthcoming papers have no
// volume/issue; a frozen advance record that is actually published does.
function parseArticle(html) {
  const year = (metaContent(html, 'citation_online_date') ||
    metaContent(html, 'citation_publication_date') ||
    metaContent(html, 'citation_date') || '').match(/\d{4}/);
  return {
    title: metaContent(html, 'citation_title'),
    authors: metaAll(html, 'citation_author').map(normAuthor).filter(Boolean).join(', '),
    volume: metaContent(html, 'citation_volume'),
    issue: metaContent(html, 'citation_issue'),
    firstpage: metaContent(html, 'citation_firstpage'),
    lastpage: metaContent(html, 'citation_lastpage'),
    year: year ? year[0] : '',
  };
}

// ── Load the target app's already-known DOIs (so the supplement stays lean) ──

async function knownDois(app) {
  const known = new Set();
  const staleAia = []; // AIA rows with no volume/issue -> candidates for a fixup
  for (const src of app.sources) {
    const path = join(app.dataDir, src.file);
    if (!existsSync(path)) continue;
    let rows;
    try { rows = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
    for (const r of Array.isArray(rows) ? rows : []) {
      const doi = String(r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
      if (!doi) continue;
      known.add(doi);
      if (r.Status === 'Articles in Advance' && !r.Volume && !r.Issue) staleAia.push({ doi, key: src.key });
    }
  }
  return { known, staleAia };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const app = await resolveApp();
const sources = ONLY.length ? app.sources.filter(s => ONLY.includes(s.code) || ONLY.includes(s.key)) : app.sources;
if (!sources.length) { console.error(`No INFORMS journals to scrape for --app ${APP}.`); process.exit(1); }

const CACHE_PATH = join(app.dataDir, '_aia-cache.json');
const SUPPLEMENT_PATH = join(app.dataDir, '_informs-aia.json');
const FIXUPS_PATH = join(app.dataDir, '_aia-fixups.json');

const cache = existsSync(CACHE_PATH) ? JSON.parse(await readFile(CACHE_PATH, 'utf8')) : {};
const supplement = existsSync(SUPPLEMENT_PATH) ? JSON.parse(await readFile(SUPPLEMENT_PATH, 'utf8')) : {};
const fixups = existsSync(FIXUPS_PATH) ? JSON.parse(await readFile(FIXUPS_PATH, 'utf8')) : {};

console.log(`informs-aia-local: app=${APP}, ${sources.length} journal(s): ${sources.map(s => s.code).join(', ')}`);
const { known, staleAia } = await knownDois(app);
console.log(`  target already knows ${known.size} DOIs; ${staleAia.length} stale AIA rows to re-check`);

// The candidate set: DOIs listed on each toc/<code>/0/0 page, plus the target's
// own stale-AIA rows (to backfill their real issue).
const candidates = new Map(); // doi -> { code, key }
for (const src of sources) {
  process.stdout.write(`  ${src.code}: reading advance-articles page… `);
  try {
    const { status, body } = await fetchPage(`https://pubsonline.informs.org/toc/${src.code}/0/0`);
    if (isChallenged(body, status)) { console.log(''); cfBlockedMessage(); break; }
    if (status !== 200) { console.log(`HTTP ${status} (skipped)`); continue; }
    const dois = doisOnTocPage(body, src.code);
    dois.forEach(d => candidates.set(d, { code: src.code, key: src.key }));
    console.log(`${dois.length} advance DOIs`);
  } catch (e) { console.log(`error: ${e.message}`); }
  await sleep(DELAY_MS);
}
for (const s of staleAia) {
  const code = (s.doi.match(/10\.1287\/([a-z]+)\./) || [])[1];
  const src = sources.find(x => x.code === code);
  if (src) candidates.set(s.doi, { code, key: src.key });
}

let fetched = 0, newForth = 0, newFix = 0;
async function save() {
  await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf8');
  await writeFile(SUPPLEMENT_PATH, JSON.stringify(sortKeys(supplement), null, 0), 'utf8');
  await writeFile(FIXUPS_PATH, JSON.stringify(sortKeys(fixups), null, 0), 'utf8');
}
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

outer:
for (const [doi, { key }] of candidates) {
  if (fetched >= MAX) break;
  if (cache[doi] && cache[doi].done) continue; // already resolved in a prior run
  fetched++;
  try {
    const { status, body } = await fetchPage(`https://pubsonline.informs.org/doi/${doi}`);
    if (isChallenged(body, status)) { cfBlockedMessage(); break outer; }
    if (status !== 200) { console.warn(`  ${doi}: HTTP ${status}`); await sleep(DELAY_MS); continue; }
    const a = parseArticle(body);
    if (!a.title) { cache[doi] = { done: true, none: true }; await sleep(DELAY_MS); continue; }
    if (a.volume || a.issue) {
      // Actually published: record its real issue as a fixup so the build stops
      // labeling it "Articles in Advance".
      fixups[doi] = {
        volume: a.volume, issue: a.issue,
        page: a.firstpage && a.lastpage ? `${a.firstpage}-${a.lastpage}` : (a.firstpage || ''),
        year: a.year,
      };
      delete supplement[doi];
      newFix++;
    } else if (!known.has(doi)) {
      // Genuinely forthcoming and not yet in Crossref: add to the supplement.
      const entry = { Title: a.title, Authors: a.authors, Year: a.year || String(new Date().getFullYear()) };
      if (key) entry.jkey = key; // fun/ms is single-source and needs no key
      supplement[doi] = entry;
      newForth++;
    }
    cache[doi] = { done: true };
    if (fetched % 25 === 0) { await save(); console.log(`  …${fetched} fetched (${newForth} forthcoming, ${newFix} fixups)`); }
  } catch (e) { console.warn(`  ${doi}: ${e.message}`); }
  await sleep(DELAY_MS);
}

await save();
console.log(`\n✓ Wrote:\n  ${SUPPLEMENT_PATH} (${Object.keys(supplement).length} forthcoming)\n  ${FIXUPS_PATH} (${Object.keys(fixups).length} fixups)`);
console.log(`  This session: ${fetched} pages fetched, +${newForth} forthcoming, +${newFix} fixups.`);
console.log('\nNext: commit and push the two files, e.g.');
console.log(`  git add ${SUPPLEMENT_PATH} ${FIXUPS_PATH}`);
console.log('  git commit -m "refresh Articles-in-Advance from INFORMS"');
console.log('  git push');
console.log('The next scheduled data build folds them in automatically.');
