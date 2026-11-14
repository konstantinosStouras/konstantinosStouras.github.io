/*
 * informs-editors-local.mjs — the ISR/MkSc editors crawler (local-first).
 * ===========================================================================
 * Builds/refreshes lit/data/_informs-editors.json: DOI → Senior Editor /
 * Associate Editor names for Information Systems Research (SE + AE) and
 * Marketing Science (SE), read from each article's "History:" line on
 * pubsonline.informs.org.
 *
 * Crossref sometimes carries the History line; incomplete recently added
 * papers are rechecked there daily before trying publisher HTML.
 * pubsonline (an Atypon site, like pnas.org) blocks most
 * cloud/datacenter IPs. From a normal home or university connection the pages
 * load fine. CI still ATTEMPTS the crawl on a schedule
 * (.github/workflows/lit-editors-backfill.yml — bounded slices, MkSc first):
 * when the runner is blocked the very first page trips the Cloudflare check
 * and the publisher pass stops with a warning, preserving Crossref progress.
 * If pubsonline answers, the backlog burns down online on its own. CI knobs
 * (all optional): LIT_EDITORS_BUDGET_MS time-boxes a sitting,
 * LIT_EDITORS_MAX_FAILS (default 12) aborts after that many CONSECUTIVE
 * failed pages (a dead/blocked host must not burn a 45-min budget at one
 * page per delay), and --merge-cache <file> folds a saved cache into the
 * on-disk one (push-retry replay: an entry with editors always beats a
 * none-record, never the reverse).
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node informs-editors-local.mjs               # resumes where it left off
 *   node informs-editors-local.mjs --max 500     # bound one session (~15 min)
 *   node informs-editors-local.mjs --journal mksc  # one journal only (mksc | isre)
 *   node informs-editors-local.mjs --journal mksc --last-years 20
 *                                                # …bounded to the last 20 years
 *   node informs-editors-local.mjs --since 2006  # absolute year floor (Year ≥ 2006)
 *   node informs-editors-local.mjs --retry-misses  # re-check pages that had no History line
 *   node informs-editors-local.mjs --apply-only  # no crawl: overlay the cache onto
 *                                                # the served papers-<key>.json files
 *                                                # (run after dropping in a console-
 *                                                # harvest _informs-editors.json)
 *
 * Every crawl ends by APPLYING the cache to the served papers files
 * (papers-mksc.json / papers-isre.json — fill-empty-only, like the build's
 * applyInformsEditors), so the collected names go live on the very next
 * commit + push instead of waiting for the daily build (--no-apply skips).
 *
 * ONE-CLICK Marketing Science run: crawl-mksc-editors.bat (pauses CI, crawls
 * MkSc Senior Editors for the last 20 years newest-first, applies + commits +
 * pushes, resumes CI).
 *
 * Marketing Science is crawled FIRST (mksc before isre, newest papers first —
 * per the owner: MkSc Senior-Editor coverage, e.g. Olivier Toubia's accepted
 * papers, is the priority), so a single ~1h sitting completes the whole MkSc
 * back-catalogue before ISR starts; `--journal mksc` bounds a sitting to it
 * outright. The full first pass is ~4,200 pages (≈2h at the polite request
 * rate); it is resume-safe — progress is saved continuously, so run it in as
 * many sittings as you like. LIT_EDITORS_DELAY_MS overrides the per-page pace
 * (default 1800; floor 700 — stay polite, it's an anti-bot-sensitive host).
 * Then commit + push lit/data/_informs-editors.json; the daily data build
 * joins it in.
 *
 * DOI lists come from lit/data/papers-isre.json / papers-mksc.json, so run
 * this after the first data build has landed (or pass --from-crossref to pull
 * the DOI lists directly).
 *
 * Publisher access failures are reported explicitly. They are not evidence
 * that a paper has no editors. Verify names on accessible publisher pages
 * and import the resulting DOI records with --merge-cache and --apply-only.
 * Incomplete records are rechecked after seven days; Crossref after one day.
 * ===========================================================================
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
// Atomic write (temp + rename): a power-off mid-write can never truncate the file.
async function awrite(dest, str) {
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, str, 'utf8');
  for (let i = 0; i < 10; i++) {
    try { await rename(tmp, dest); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200 * (i + 1))); // Dropbox/OneDrive/AV lock — retry
    }
  }
  await writeFile(dest, str, 'utf8'); // last resort: in-place (non-atomic)
}
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorsFromPageHtml, healEditorNames } from './informs-editors.mjs';
import { isNonArticle } from './_nonarticle.mjs';
import { isChallenged } from './pnas-crawl.mjs';
import { editorialDoi, mergeEditors, refreshDue, editorsFromCrossref, applyEditors } from './editorial-refresh.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const CACHE_PATH = join(DATA_DIR, '_informs-editors.json');
const registryPath = join(DATA_DIR, '_registry.json');
const recentPath = join(DATA_DIR, 'recent.json');
// Journal files omit Date Added; the complete registry is authoritative.
// The recent feed is a fallback for sparse/local checkouts only.
const addedDates = existsSync(registryPath) ? JSON.parse(await readFile(registryPath, 'utf8'))
  : existsSync(recentPath) ? Object.fromEntries(JSON.parse(await readFile(recentPath, 'utf8')).map(p => [editorialDoi(p.DOI), p['Date Added']])) : {};
const MAILTO = process.env.LIT_MAILTO || 'kstouras@gmail.com';
// Cloudflare clearance: LIT_CF_COOKIE accepts either the bare cf_clearance
// VALUE or a full Cookie header ("cf_clearance=…" / "a=1; cf_clearance=…").
// The clearance is bound to the IP AND User-Agent that passed the challenge,
// so LIT_UA must be set to that browser's exact navigator.userAgent too — the
// default UA below will NOT validate someone else's cookie.
const COOKIE = (() => {
  const raw = (process.env.LIT_CF_COOKIE || '').trim();
  if (!raw) return '';
  return raw.includes('=') ? raw : `cf_clearance=${raw}`;
})();
const DELAY_MS = Math.max(700, parseInt(process.env.LIT_EDITORS_DELAY_MS || '', 10) || 1800);

const args = process.argv.slice(2);
const MAX = args.includes('--max') ? parseInt(args[args.indexOf('--max') + 1], 10) : Infinity;
const RETRY_MISSES = args.includes('--retry-misses');
const FROM_CROSSREF = args.includes('--from-crossref');
const APPLY_ONLY = args.includes('--apply-only');
const NO_APPLY = args.includes('--no-apply');
// --merge-cache=<file> | --merge-cache <file> — fold a saved cache into the
// on-disk one before crawling/applying (CI push-retry replay, console merges).
const MERGE_CACHE = (() => {
  const eq = args.find(a => a.startsWith('--merge-cache='));
  if (eq) return eq.slice('--merge-cache='.length);
  const i = args.indexOf('--merge-cache');
  return i >= 0 ? String(args[i + 1] || '') : '';
})();
// Time box (CI slices): stop crawling when the budget is spent; 0 = unbounded.
const BUDGET_MS = parseInt(process.env.LIT_EDITORS_BUDGET_MS || '', 10) || 0;
// Abort after N CONSECUTIVE failed pages (non-200s / network errors): a blocked
// or dead host must not burn a whole CI budget at one warned page per delay.
const MAX_FAILS = Math.max(3, parseInt(process.env.LIT_EDITORS_MAX_FAILS || '', 10) || 12);
const T0 = Date.now();
const JOURNAL = args.includes('--journal') ? String(args[args.indexOf('--journal') + 1] || '').toLowerCase() : '';
// Year floor: --since <year> absolute, or --last-years <n> relative to today.
// Rows are newest-first, so the floor only trims the old tail of the crawl.
const SINCE = (() => {
  if (args.includes('--since')) return parseInt(args[args.indexOf('--since') + 1], 10) || 0;
  if (args.includes('--last-years')) {
    const n = parseInt(args[args.indexOf('--last-years') + 1], 10);
    return n > 0 ? new Date().getFullYear() - n : 0;
  }
  return 0;
})();

// mksc first — Marketing Science SE coverage is the current priority (per the
// owner); within each journal the DOI list is newest-first already.
const SOURCES = [
  { key: 'mksc', issn: '0732-2399', file: 'papers-mksc.json', ae: false },
  { key: 'isre', issn: '1047-7047', file: 'papers-isre.json', ae: true },
];
if (JOURNAL && !SOURCES.some(s => s.key === JOURNAL)) {
  console.error(`✗ Unknown --journal "${JOURNAL}" — use one of: ${SOURCES.map(s => s.key).join(', ')}`);
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function doiList(src) {
  const p = join(DATA_DIR, src.file);
  if (!FROM_CROSSREF && existsSync(p)) {
    let rows = JSON.parse(await readFile(p, 'utf8'));
    // Year floor (--since/--last-years): a row with an unparseable year is kept
    // (it can only be a stray — never silently dropped from the crawl).
    if (SINCE) rows = rows.filter(r => { const y = parseInt(r.Year, 10); return !y || y >= SINCE; });
    // Never crawl NON-RESEARCH items (editorials, errata, front matter —
    // _nonarticle.mjs): an acknowledgment editorial's own text names the
    // editor board and would be mis-read as a History line.
    rows = rows.filter(r => !isNonArticle(r.Title));
    // Recent additions first, including older papers only just discovered.
    rows.sort((a, b) => String(addedDates[editorialDoi(b.DOI)] || '').localeCompare(String(addedDates[editorialDoi(a.DOI)] || '')));
    return rows.map(r => (r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()).filter(Boolean);
  }
  console.log(`  ${src.key}: pulling DOI list from Crossref (${src.issn})…`);
  const dois = [];
  let cursor = '*';
  for (;;) {
    const url = `https://api.crossref.org/journals/${src.issn}/works?rows=1000&cursor=${encodeURIComponent(cursor)}&select=DOI,type&sort=published&order=desc${SINCE ? `&filter=from-pub-date:${SINCE}-01-01` : ''}&mailto=${MAILTO}`;
    const r = await fetch(url, { headers: { 'User-Agent': `lit-informs-editors/1.0 (mailto:${MAILTO})` } });
    if (!r.ok) throw new Error(`Crossref HTTP ${r.status}`);
    const j = await r.json();
    const items = j.message.items || [];
    for (const it of items) if (!it.type || it.type === 'journal-article') dois.push(it.DOI.toLowerCase());
    cursor = j.message['next-cursor'];
    if (!items.length || !cursor) break;
  }
  return dois;
}

async function fetchArticle(doi) {
  const res = await fetch(`https://pubsonline.informs.org/doi/${doi}`, {
    headers: {
      'User-Agent': process.env.LIT_UA ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, body: await res.text() };
}

// The History line sits in the article page HTML; the shared multi-window
// scan (informs-editors.mjs) parses around every "History:" label and every
// "Senior/Associate Editor" mention, so long History lines (dates first,
// editors past the old 500-char window) and label-less layouts both extract.
const editorsFromPage = editorsFromPageHtml;

const rawCache = existsSync(CACHE_PATH) ? JSON.parse(await readFile(CACHE_PATH, 'utf8')) : {};
const cache = rawCache.map || rawCache; // tolerate both {map:{...}} and flat shapes
let processed = 0, found = 0, dirty = 0;

// Fold a saved cache in (CI push-retry replay / console-harvest merge). An
// entry with editors always wins over a none-record — never the reverse — so
// no merge direction can downgrade a found name back to a miss.
if (MERGE_CACHE) {
  const rawOther = JSON.parse(await readFile(MERGE_CACHE, 'utf8'));
  const other = rawOther.map || rawOther;
  let took = 0;
  for (const [k, v] of Object.entries(other)) {
    if (!v || typeof v !== 'object') continue;
    const cur = cache[k];
    const merged = mergeEditors(cur, v);
    if (JSON.stringify(cur) !== JSON.stringify(merged)) { cache[k] = merged; took++; }
  }
  console.log(`  merge-cache: took ${took} entries from ${MERGE_CACHE}`);
}

// Heal the whole cache: sanitize comma-blob "names" away and canonicalize
// known pubsonline typos (healEditorNames) — a console-harvest replace or an
// old sitting may carry either; healing here means every save/apply below
// emits only clean canonical names. An entry left with NO names becomes a
// plain miss so it never renders and can be re-checked.
let healedCache = 0;
for (const [k, v] of Object.entries(cache)) {
  if (!v || typeof v !== 'object') continue;
  const se = healEditorNames(v.se), ae = healEditorNames(v.ae);
  if (se !== v.se || ae !== v.ae) {
    healedCache++;
    if (!se && !ae) cache[k] = { ...v, se: '', ae: '', none: true };
    else { v.se = se || ''; v.ae = ae || ''; }
  }
}
if (healedCache) console.log(`  healed ${healedCache} cached editor entries (blobs dropped, typos → canonical)`);

async function saveCache() {
  const sorted = {};
  for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
  await awrite(CACHE_PATH, JSON.stringify(sorted));
  dirty = 0;
}

// Overlay the cache onto the SERVED papers-<key>.json files (mirrors
// build-data.mjs applyInformsEditors — fill-empty-only, never overwriting a
// Crossref-provided name), so a crawl updates the live site on the very next
// commit + push instead of waiting for the next daily build to fold it in.
// Writes are minified like the build's writeJson; an unchanged file is left
// untouched, so it produces no git diff.
let cachePurged = 0; // non-article cache records retired to a miss by applyToPapers

async function applyToPapers() {
  let total = 0;
  for (const src of SOURCES) {
    const p = join(DATA_DIR, src.file);
    if (!existsSync(p)) continue;
    const rows = JSON.parse(await readFile(p, 'utf8'));
    let filled = 0;
    for (const row of rows) {
      const doi = (row.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
      // NON-RESEARCH items never carry editors: clear anything previously
      // mis-applied (an acknowledgment editorial or erratum whose page text
      // mentioned the board) and retire its cache record to a miss.
      if (isNonArticle(row.Title)) {
        if (row['Senior Editor']) { row['Senior Editor'] = ''; filled++; }
        if (src.ae && row['Associate Editor']) { row['Associate Editor'] = ''; filled++; }
        const rec = doi && cache[doi];
        if (rec && (rec.se || rec.ae)) { cache[doi] = { none: true }; cachePurged++; }
        continue;
      }
      // Heal a previously-applied blob/typo value even when the cache has no
      // record for this DOI.
      if (row['Senior Editor']) {
        const c = healEditorNames(row['Senior Editor']);
        if (c !== row['Senior Editor']) { row['Senior Editor'] = c; filled++; }
      }
      if (src.ae && row['Associate Editor']) {
        const c = healEditorNames(row['Associate Editor']);
        if (c !== row['Associate Editor']) { row['Associate Editor'] = c; filled++; }
      }
      const rec = doi && cache[doi];
      if (!rec) continue;
      if (!row['Senior Editor'] && rec.se) { row['Senior Editor'] = rec.se; filled++; }
      if (src.ae && !row['Associate Editor'] && rec.ae) { row['Associate Editor'] = rec.ae; filled++; }
    }
    if (filled) {
      await awrite(p, JSON.stringify(rows));
      console.log(`  ${src.key}: filled ${filled} SE/AE fields into ${src.file}`);
      total += filled;
    }
  }
  // The recent view and FT50 browse each serve independent copies of rows.
  // Publish enrichment to all of them in this same commit.
  for (const file of ['recent.json', '../data-ft50/recent.json', '../data-ft50/papers-isre.json', '../data-ft50/papers-mksc.json']) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) continue;
    const rows = JSON.parse(await readFile(path, 'utf8'));
    const filled = applyEditors(rows, cache);
    if (filled) {
      await awrite(path, JSON.stringify(rows));
      console.log(`  ${file}: refreshed ${filled} SE/AE fields`);
      total += filled;
    }
  }
  console.log(total
    ? `✓ Applied the cache to the served papers files (${total} fields) — commit lit/data/ and lit/data-ft50/ to publish.`
    : '  papers files already carry every cached SE/AE name — nothing to apply.');
}

if (APPLY_ONLY) {
  await applyToPapers();
  // persist merge/healing/non-article purges for the commit
  if (MERGE_CACHE || healedCache || cachePurged) await saveCache();
  process.exit(0);
}

// Publisher HTML is often unavailable on hosted runners. Crossref is a
// separate, public metadata source and sometimes receives History later.
// Refresh incomplete records daily, rotating by last check so an unpublished
// newest paper cannot starve the rest. Never overwrite the actual paper data
// with a potentially stale Crossref record: merge only verified editor roles.
async function refreshCrossref() {
  const candidates = [];
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  for (const src of SOURCES) {
    if (JOURNAL && src.key !== JOURNAL) continue;
    const path = join(DATA_DIR, src.file);
    if (!existsSync(path)) continue;
    for (const row of JSON.parse(await readFile(path, 'utf8'))) {
      const doi = editorialDoi(row.DOI);
      const added = addedDates[doi];
      if (isNonArticle(row.Title) || !added || added < cutoff) continue;
      const known = mergeEditors(cache[doi], { se: row['Senior Editor'], ae: src.ae ? row['Associate Editor'] : '' });
      if (doi && refreshDue(known, src.ae, Date.now(), 'crossrefCheckedAt', 1)) candidates.push({ doi, src });
    }
  }
  candidates.sort((a, b) => String(cache[a.doi]?.crossrefCheckedAt || '').localeCompare(String(cache[b.doi]?.crossrefCheckedAt || '')));
  let checked = 0, enriched = 0;
  for (const { doi, src } of candidates.slice(0, 100)) {
    if (BUDGET_MS && Date.now() - T0 > BUDGET_MS) break;
    try {
      const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(MAILTO)}`, {
        headers: { 'User-Agent': `TheLit-editorial-refresh/1.0 (mailto:${MAILTO})` },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) {
        console.warn(`Crossref has not indexed ${doi}; continuing with other papers.`);
        await sleep(1100);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { message: work } = await response.json();
      if (editorialDoi(work?.DOI) !== doi) throw new Error('DOI mismatch');
      const ed = editorsFromCrossref(work, src.ae);
      const before = cache[doi];
      cache[doi] = mergeEditors(before, { ...ed, crossrefCheckedAt: new Date().toISOString() });
      if ((!before?.se && ed.se) || (!before?.ae && ed.ae)) enriched++;
      checked++;
      if (++dirty >= 25) {
        await saveCache();
        console.log(`  Crossref: checked ${checked}, enriched ${enriched} so far.`);
      }
    } catch (error) {
      console.warn(`::warning::Crossref editorial refresh stopped at ${doi}: ${error.message}; records remain eligible for retry.`);
      break;
    }
    await sleep(1100);
  }
  console.log(`Crossref editorial refresh: checked ${checked}, enriched ${enriched} records.`);
  if (dirty) await saveCache();
}

await refreshCrossref();
let consecFails = 0;
outer:
for (const src of SOURCES) {
  if (JOURNAL && src.key !== JOURNAL) continue;
  const dois = await doiList(src);
  console.log(`${src.key}: ${dois.length} DOIs, ${dois.filter(d => cache[d]).length} already cached`);
  for (const doi of dois) {
    if (processed >= MAX) break outer;
    if (BUDGET_MS && Date.now() - T0 > BUDGET_MS) {
      console.log(`⏱ Time budget (${Math.round(BUDGET_MS / 60000)} min) spent — stopping this sitting (resume-safe).`);
      break outer;
    }
    const cur = cache[doi];
    if (!refreshDue(cur, src.ae, Date.now(), 'checkedAt', RETRY_MISSES ? 0 : 7)) continue;
    processed++;
    try {
      const { status, body } = await fetchArticle(doi);
      if (isChallenged(body, status)) {
        console.warn(`::warning::Publisher access blocked (HTTP ${status}); Crossref refresh and cached editor updates still apply. No missing-editor result was cached for the blocked page.`);
        break outer;
      }
      if (status !== 200) {
        console.warn(`  ${doi}: HTTP ${status}`);
        if (++consecFails >= MAX_FAILS) {
          console.log(`✗ ${consecFails} consecutive failed pages — the host looks unavailable from here; stopping (resume-safe).`);
          break outer;
        }
        await sleep(DELAY_MS);
        continue;
      }
      consecFails = 0;
      const ed = editorsFromPage(body);
      if (ed && (ed.se || ed.ae)) {
        cache[doi] = mergeEditors(cur, { se: healEditorNames(ed.se), ae: src.ae ? healEditorNames(ed.ae) : '', checkedAt: new Date().toISOString(), source: `https://pubsonline.informs.org/doi/${doi}` });
        found++;
      } else {
        cache[doi] = mergeEditors(cur, { none: true, checkedAt: new Date().toISOString() });
      }
      if (++dirty >= 25) await saveCache();
      if (processed % 50 === 0) console.log(`  …${processed} pages fetched, ${found} with editors`);
    } catch (e) {
      console.warn(`  ${doi}: ${e.message}`);
      if (++consecFails >= MAX_FAILS) {
        console.log(`✗ ${consecFails} consecutive failed pages — the host looks unavailable from here; stopping (resume-safe).`);
        break outer;
      }
    }
    await sleep(DELAY_MS);
  }
}

await saveCache();
const withEditors = Object.values(cache).filter(v => v.se || v.ae).length;
console.log(`\n✓ Wrote ${CACHE_PATH}`);
console.log(`  This session: ${processed} pages fetched, ${found} new editor records.`);
console.log(`  Cache now maps ${Object.keys(cache).length} DOIs (${withEditors} with editors).`);
// Update the online database too: push the collected names straight into the
// served papers files so the site shows them as soon as the commit deploys
// (per the owner) — the daily build's own overlay stays the steady-state path.
if (!NO_APPLY) await applyToPapers();
if (cachePurged) await saveCache(); // persist non-article purges made by the apply
console.log('\nNext: commit and push the updated files, e.g.');
console.log('  git add lit/data lit/data-ft50');
console.log('  git commit -m "lit: refresh ISR/Marketing Science editor index"');
console.log('  git push');
console.log('The site updates when the push deploys; the daily build keeps folding the cache in.');
