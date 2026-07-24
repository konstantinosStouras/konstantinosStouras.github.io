/*
 * informs-editors-local.mjs — the ISR/MkSc editors crawler (local-first).
 * ===========================================================================
 * Builds/refreshes lit/data/_informs-editors.json: DOI → Senior Editor /
 * Associate Editor names for Information Systems Research (SE + AE) and
 * Marketing Science (SE), read from each article's "History:" line on
 * pubsonline.informs.org.
 *
 * Why local-first? Crossref does not carry the History line for these
 * journals, and pubsonline (an Atypon site, like pnas.org) blocks most
 * cloud/datacenter IPs. From a normal home or university connection the pages
 * load fine. CI still ATTEMPTS the crawl on a schedule
 * (.github/workflows/lit-editors-backfill.yml — bounded slices, MkSc first):
 * when the runner is blocked the very first page trips the Cloudflare check
 * and the run exits cleanly in seconds with nothing committed, and if
 * pubsonline ever answers, the backlog burns down online on its own. CI knobs
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
 * If your connection is challenged by Cloudflare, follow the instructions
 * printed on failure: pass the check once in your browser, then re-run with
 * BOTH the clearance cookie and that browser's exact User-Agent —
 *   set LIT_CF_COOKIE=<cf_clearance value>      (Windows cmd; bare value ok)
 *   set LIT_UA=<your navigator.userAgent>
 * The cookie is bound to your IP + User-Agent, so LIT_CF_COOKIE alone (with
 * the script's default UA) will NOT pass. Cookies expire after a while; the
 * run is resume-safe, so grab a fresh value and re-run as needed.
 *
 * STILL BLOCKED? Cloudflare also fingerprints the TLS handshake, which Node
 * cannot imitate — use informs-editors-console.js instead: paste it into the
 * DevTools console ON pubsonline.informs.org and the harvest runs inside your
 * real browser (same-origin, nothing to block), producing the same
 * _informs-editors.json. The two caches merge safely.
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
import { editorsFromPageHtml } from './informs-editors.mjs';
import { isChallenged } from './pnas-crawl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const CACHE_PATH = join(DATA_DIR, '_informs-editors.json');
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
    // newest first, published-or-advance alike; rows are already rank-sorted
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
    if (!cur || ((v.se || v.ae) && !(cur.se || cur.ae))) { cache[k] = v; took++; }
  }
  console.log(`  merge-cache: took ${took} entries from ${MERGE_CACHE}`);
}

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
async function applyToPapers() {
  let total = 0;
  for (const src of SOURCES) {
    const p = join(DATA_DIR, src.file);
    if (!existsSync(p)) continue;
    const rows = JSON.parse(await readFile(p, 'utf8'));
    let filled = 0;
    for (const row of rows) {
      const doi = (row.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
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
  console.log(total
    ? `✓ Applied the cache to the served papers files (${total} fields) — commit lit/data/ and the site updates on push.`
    : '  papers files already carry every cached SE/AE name — nothing to apply.');
}

if (APPLY_ONLY) {
  if (MERGE_CACHE) await saveCache(); // persist the merged cache for the commit
  await applyToPapers();
  process.exit(0);
}

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
    if (cur && (cur.se || cur.ae)) continue;
    if (cur && cur.none && !RETRY_MISSES) continue;
    processed++;
    try {
      const { status, body } = await fetchArticle(doi);
      if (isChallenged(body, status)) {
        if (process.env.GITHUB_ACTIONS) {
          // CI: the block is the EXPECTED outcome for a datacenter IP — say so
          // briefly and exit cleanly (nothing cached for this page, so a later
          // run — or a home sitting — retries it).
          console.log(`✗ pubsonline blocked this runner (HTTP ${status} / Cloudflare) on ${doi} — expected for datacenter IPs.`);
          console.log('  Exiting cleanly; nothing was mis-cached. A home run (crawl-mksc-editors.bat or informs-editors-console.js) still works.');
        } else {
          console.error('\n✗ Blocked by Cloudflare from this connection.');
          console.error('  The clearance cookie is bound to your browser\'s IP AND User-Agent, so you need BOTH:');
          console.error('   1. Open https://pubsonline.informs.org in your browser; wait until an article page loads normally.');
          console.error('   2. DevTools (F12) → Application → Cookies → https://pubsonline.informs.org → copy the cf_clearance VALUE.');
          console.error('   3. DevTools → Console → type  navigator.userAgent  → copy the exact string.');
          console.error('  Then re-run — Windows cmd:');
          console.error('    set LIT_CF_COOKIE=<cf_clearance value>');
          console.error('    set LIT_UA=<your navigator.userAgent string>');
          console.error('    node informs-editors-local.mjs');
          console.error('  (PowerShell: $env:LIT_CF_COOKIE="…"; $env:LIT_UA="…"   ·   macOS/Linux: LIT_CF_COOKIE="…" LIT_UA="…" node …)');
          console.error('  The cookie expires after a while; if the block returns mid-run, grab a fresh value and re-run —');
          console.error('  progress is saved continuously, so it resumes where it stopped.');
        }
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
        cache[doi] = { se: ed.se, ae: src.ae ? ed.ae : '' };
        found++;
      } else {
        cache[doi] = { none: true };
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
console.log('\nNext: commit and push the updated files, e.g.');
console.log('  git add lit/data');
console.log('  git commit -m "lit: refresh ISR/Marketing Science editor index"');
console.log('  git push');
console.log('The site updates when the push deploys; the daily build keeps folding the cache in.');
