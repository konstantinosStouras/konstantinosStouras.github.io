/*
 * informs-abstracts-local.mjs — the INFORMS full-abstract crawler (local-first).
 * ===========================================================================
 * Builds/refreshes lit/data/_informs-abstracts.json: DOI → the article page's
 * FULL abstract, for papers whose Crossref deposit is only a one-sentence
 * teaser (Marketing Science especially — ~800 of its ~2,300 rows) or missing.
 * Read from pubsonline.informs.org article pages (Atypon), which block most
 * cloud/datacenter IPs — and often local Node too (TLS fingerprinting), in
 * which case use informs-abstracts-console.js in the browser instead (same
 * output, byte-compatible; its extractor is VENDORED from
 * informs-abstracts.mjs — keep in sync).
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node informs-abstracts-local.mjs               # resumes where it left off
 *   node informs-abstracts-local.mjs --journal mksc  # one journal only
 *   node informs-abstracts-local.mjs --max 500     # bound one sitting
 *   node informs-abstracts-local.mjs --last-years 20 | --since 2006
 *   node informs-abstracts-local.mjs --all         # also re-fetch papers whose
 *                                                  # served abstract looks fine
 *   node informs-abstracts-local.mjs --retry-misses  # re-check "none" pages
 *   node informs-abstracts-local.mjs --apply-only  # no crawl: overlay the cache
 *                                                  # onto the served papers files
 *                                                  # (after a console harvest)
 *   … --merge-cache <file>                         # fold a saved cache in first
 *
 * ONLY NEEDY PAPERS ARE CRAWLED by default: a paper whose served Abstract is
 * already ≥ NEEDY_MAX_LEN chars is skipped (Crossref had the real abstract),
 * so a Marketing Science pass is ~800 pages, not 2,273 (--all lifts this).
 * Marketing Science is crawled FIRST (per the owner), then the other INFORMS
 * journals, newest papers first. Every crawl ends by APPLYING the cache to
 * the served papers files (betterAbstract — UPGRADE-only, a page fragment can
 * never replace fuller existing text; --no-apply skips), so the fixed
 * abstracts go live on the very next commit + push. build-data.mjs applies
 * the same cache in every daily/incremental build (applyInformsAbstracts),
 * so a rebuild can never regress a fixed abstract back to the teaser.
 *
 * CI knobs (mirroring the editors crawler): LIT_ABSTRACTS_DELAY_MS (pace,
 * floor 700 ms), LIT_ABSTRACTS_BUDGET_MS (time box),
 * LIT_ABSTRACTS_MAX_FAILS (consecutive-failure abort, default 12).
 * Cloudflare cookie fallback: LIT_CF_COOKIE + LIT_UA, as for the editors.
 * ===========================================================================
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abstractFromPageHtml, betterAbstract, ABS_MAX } from './informs-abstracts.mjs';
import { isChallenged } from './pnas-crawl.mjs';

// Atomic write (temp + rename): a power-off mid-write can never truncate the file.
async function awrite(dest, str) {
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, str, 'utf8');
  for (let i = 0; i < 10; i++) {
    try { await rename(tmp, dest); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200 * (i + 1))); // sync-client lock — retry
    }
  }
  await writeFile(dest, str, 'utf8'); // last resort: in-place (non-atomic)
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const CACHE_PATH = join(DATA_DIR, '_informs-abstracts.json');
const COOKIE = (() => {
  const raw = (process.env.LIT_CF_COOKIE || '').trim();
  if (!raw) return '';
  return raw.includes('=') ? raw : `cf_clearance=${raw}`;
})();
const DELAY_MS = Math.max(700, parseInt(process.env.LIT_ABSTRACTS_DELAY_MS || '', 10) || 1800);
const BUDGET_MS = parseInt(process.env.LIT_ABSTRACTS_BUDGET_MS || '', 10) || 0;
const MAX_FAILS = Math.max(3, parseInt(process.env.LIT_ABSTRACTS_MAX_FAILS || '', 10) || 12);
const T0 = Date.now();

// A served abstract shorter than this is a teaser/missing → the page is worth
// fetching. Real INFORMS abstracts run ~600–2,000 chars (MkSc median ~930).
export const NEEDY_MAX_LEN = 300;

const args = process.argv.slice(2);
const MAX = args.includes('--max') ? parseInt(args[args.indexOf('--max') + 1], 10) : Infinity;
const RETRY_MISSES = args.includes('--retry-misses');
const APPLY_ONLY = args.includes('--apply-only');
const NO_APPLY = args.includes('--no-apply');
const ALL = args.includes('--all');
const JOURNAL = args.includes('--journal') ? String(args[args.indexOf('--journal') + 1] || '').toLowerCase() : '';
const MERGE_CACHE = (() => {
  const eq = args.find(a => a.startsWith('--merge-cache='));
  if (eq) return eq.slice('--merge-cache='.length);
  const i = args.indexOf('--merge-cache');
  return i >= 0 ? String(args[i + 1] || '') : '';
})();
const SINCE = (() => {
  if (args.includes('--since')) return parseInt(args[args.indexOf('--since') + 1], 10) || 0;
  if (args.includes('--last-years')) {
    const n = parseInt(args[args.indexOf('--last-years') + 1], 10);
    return n > 0 ? new Date().getFullYear() - n : 0;
  }
  return 0;
})();

// mksc first — per the owner; the other INFORMS journals follow. Newest first
// within each journal (rows are already rank-sorted).
const SOURCES = [
  { key: 'mksc', file: 'papers-mksc.json' },
  { key: 'ms', file: 'papers-ms.json' },
  { key: 'isre', file: 'papers-isre.json' },
  { key: 'msom', file: 'papers-msom.json' },
  { key: 'opre', file: 'papers-opre.json' },
  { key: 'stsc', file: 'papers-stsc.json' },
  { key: 'ited', file: 'papers-ited.json' },
];
if (JOURNAL && !SOURCES.some(s => s.key === JOURNAL)) {
  console.error(`✗ Unknown --journal "${JOURNAL}" — use one of: ${SOURCES.map(s => s.key).join(', ')}`);
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bareDoi = (row) => (row.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();

async function needyList(src) {
  const p = join(DATA_DIR, src.file);
  if (!existsSync(p)) return [];
  let rows = JSON.parse(await readFile(p, 'utf8'));
  if (SINCE) rows = rows.filter(r => { const y = parseInt(r.Year, 10); return !y || y >= SINCE; });
  if (!ALL) rows = rows.filter(r => !r.Abstract || r.Abstract.length < NEEDY_MAX_LEN);
  return rows.map(bareDoi).filter(Boolean);
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

const rawCache = existsSync(CACHE_PATH) ? JSON.parse(await readFile(CACHE_PATH, 'utf8')) : {};
const cache = rawCache.map || rawCache; // tolerate both {map:{...}} and flat shapes
let processed = 0, found = 0, dirty = 0;

async function saveCache() {
  const sorted = {};
  for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
  await awrite(CACHE_PATH, JSON.stringify(sorted));
  dirty = 0;
}

// Fold a saved cache in (console-harvest merge / CI push-retry replay). An
// entry WITH an abstract beats a none-record; a longer abstract beats a
// shorter one; no direction can downgrade.
if (MERGE_CACHE) {
  const rawOther = JSON.parse(await readFile(MERGE_CACHE, 'utf8'));
  const other = rawOther.map || rawOther;
  let took = 0;
  for (const [k, v] of Object.entries(other)) {
    if (!v || typeof v !== 'object') continue;
    const cur = cache[k];
    if (!cur || (v.a && (!cur.a || v.a.length > cur.a.length))) { cache[k] = v; took++; }
  }
  console.log(`  merge-cache: took ${took} entries from ${MERGE_CACHE}`);
}

// Overlay the cache onto the SERVED papers files — UPGRADE-only via
// betterAbstract, so a teaser is replaced by the page's full abstract but a
// good Crossref abstract is never churned. Minified writes, no-diff when
// nothing improves. build-data.mjs applies the same cache on every build.
async function applyToPapers() {
  let total = 0;
  for (const src of SOURCES) {
    const p = join(DATA_DIR, src.file);
    if (!existsSync(p)) continue;
    const rows = JSON.parse(await readFile(p, 'utf8'));
    let upgraded = 0;
    for (const row of rows) {
      const rec = cache[bareDoi(row)];
      if (!rec || !rec.a) continue;
      if (betterAbstract(row.Abstract, rec.a)) { row.Abstract = rec.a.slice(0, ABS_MAX); upgraded++; }
    }
    if (upgraded) {
      await awrite(p, JSON.stringify(rows));
      console.log(`  ${src.key}: upgraded ${upgraded} abstracts in ${src.file}`);
      total += upgraded;
    }
  }
  console.log(total
    ? `✓ Applied the cache to the served papers files (${total} abstracts) — commit lit/data/ and the site updates on push.`
    : '  papers files already carry every cached abstract — nothing to apply.');
}

if (APPLY_ONLY) {
  if (MERGE_CACHE) await saveCache(); // persist the merge for the commit
  await applyToPapers();
  process.exit(0);
}

let consecFails = 0;
outer:
for (const src of SOURCES) {
  if (JOURNAL && src.key !== JOURNAL) continue;
  const dois = await needyList(src);
  console.log(`${src.key}: ${dois.length} papers need a fuller abstract, ${dois.filter(d => cache[d]).length} already cached`);
  for (const doi of dois) {
    if (processed >= MAX) break outer;
    if (BUDGET_MS && Date.now() - T0 > BUDGET_MS) {
      console.log(`⏱ Time budget (${Math.round(BUDGET_MS / 60000)} min) spent — stopping this sitting (resume-safe).`);
      break outer;
    }
    const cur = cache[doi];
    if (cur && cur.a) continue;
    if (cur && cur.none && !RETRY_MISSES) continue;
    processed++;
    try {
      const { status, body } = await fetchArticle(doi);
      if (isChallenged(body, status)) {
        if (process.env.GITHUB_ACTIONS) {
          console.log(`✗ pubsonline blocked this runner (HTTP ${status} / Cloudflare) on ${doi} — expected for datacenter IPs.`);
          console.log('  Exiting cleanly; nothing was mis-cached. A home run (or informs-abstracts-console.js) still works.');
        } else {
          console.error('\n✗ Blocked by Cloudflare from this connection.');
          console.error('  Use the cookie+UA route (LIT_CF_COOKIE + LIT_UA — see informs-editors-local.mjs for the steps),');
          console.error('  or paste informs-abstracts-console.js into the DevTools console ON pubsonline.informs.org —');
          console.error('  that runs inside your real browser and cannot be blocked. Progress is saved; re-runs resume.');
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
      const a = abstractFromPageHtml(body);
      if (a) { cache[doi] = { a }; found++; }
      else cache[doi] = { none: 1 };
      if (++dirty >= 25) await saveCache();
      if (processed % 50 === 0) console.log(`  …${processed} pages fetched, ${found} with abstracts`);
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
const withAbs = Object.values(cache).filter(v => v && v.a).length;
console.log(`\n✓ Wrote ${CACHE_PATH}`);
console.log(`  This session: ${processed} pages fetched, ${found} new abstracts.`);
console.log(`  Cache now maps ${Object.keys(cache).length} DOIs (${withAbs} with abstracts).`);
if (!NO_APPLY) await applyToPapers();
console.log('\nNext: commit and push the updated files, e.g.');
console.log('  git add lit/data');
console.log('  git commit -m "lit: full abstracts from pubsonline (Marketing Science)"');
console.log('  git push');
console.log('The site updates when the push deploys; every daily build keeps the cache applied.');
