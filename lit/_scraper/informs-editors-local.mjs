/*
 * informs-editors-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * Builds/refreshes lit/data/_informs-editors.json: DOI → Senior Editor /
 * Associate Editor names for Information Systems Research (SE + AE) and
 * Marketing Science (SE), read from each article's "History:" line on
 * pubsonline.informs.org.
 *
 * Why local? Crossref does not carry the History line for these journals, and
 * pubsonline (an Atypon site, like pnas.org) blocks cloud/datacenter IPs. From
 * a normal home or university connection the pages load fine.
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node informs-editors-local.mjs               # resumes where it left off
 *   node informs-editors-local.mjs --max 500     # bound one session (~15 min)
 *   node informs-editors-local.mjs --retry-misses  # re-check pages that had no History line
 *
 * The full first pass is ~4,000 pages (≈2h at the polite request rate); it is
 * resume-safe — progress is saved continuously, so run it in as many sittings
 * as you like, newest papers first. Then commit + push
 * lit/data/_informs-editors.json; the daily data build joins it in.
 *
 * DOI lists come from lit/data/papers-isre.json / papers-mksc.json, so run
 * this after the first data build has landed (or pass --from-crossref to pull
 * the DOI lists directly).
 *
 * If your connection is challenged by Cloudflare, see the LIT_CF_COOKIE
 * instructions printed on failure (same mechanism as pnas-concepts-local.mjs).
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
const COOKIE = process.env.LIT_CF_COOKIE || '';
const DELAY_MS = 1800;

const args = process.argv.slice(2);
const MAX = args.includes('--max') ? parseInt(args[args.indexOf('--max') + 1], 10) : Infinity;
const RETRY_MISSES = args.includes('--retry-misses');
const FROM_CROSSREF = args.includes('--from-crossref');

const SOURCES = [
  { key: 'isre', issn: '1047-7047', file: 'papers-isre.json', ae: true },
  { key: 'mksc', issn: '0732-2399', file: 'papers-mksc.json', ae: false },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function doiList(src) {
  const p = join(DATA_DIR, src.file);
  if (!FROM_CROSSREF && existsSync(p)) {
    const rows = JSON.parse(await readFile(p, 'utf8'));
    // newest first, published-or-advance alike; rows are already rank-sorted
    return rows.map(r => (r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()).filter(Boolean);
  }
  console.log(`  ${src.key}: pulling DOI list from Crossref (${src.issn})…`);
  const dois = [];
  let cursor = '*';
  for (;;) {
    const url = `https://api.crossref.org/journals/${src.issn}/works?rows=1000&cursor=${encodeURIComponent(cursor)}&select=DOI,type&sort=published&order=desc&mailto=${MAILTO}`;
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

const cache = existsSync(CACHE_PATH) ? JSON.parse(await readFile(CACHE_PATH, 'utf8')) : {};
let processed = 0, found = 0, dirty = 0;

async function saveCache() {
  const sorted = {};
  for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
  await awrite(CACHE_PATH, JSON.stringify(sorted));
  dirty = 0;
}

outer:
for (const src of SOURCES) {
  const dois = await doiList(src);
  console.log(`${src.key}: ${dois.length} DOIs, ${dois.filter(d => cache[d]).length} already cached`);
  for (const doi of dois) {
    if (processed >= MAX) break outer;
    const cur = cache[doi];
    if (cur && (cur.se || cur.ae)) continue;
    if (cur && cur.none && !RETRY_MISSES) continue;
    processed++;
    try {
      const { status, body } = await fetchArticle(doi);
      if (isChallenged(body, status)) {
        console.error('\n✗ Blocked by Cloudflare from this connection.');
        console.error('  Fix: open https://pubsonline.informs.org in your browser, pass the check, then re-run with');
        console.error('  LIT_CF_COOKIE="cf_clearance=<value from DevTools>" node informs-editors-local.mjs');
        break outer;
      }
      if (status !== 200) { console.warn(`  ${doi}: HTTP ${status}`); await sleep(DELAY_MS); continue; }
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
    }
    await sleep(DELAY_MS);
  }
}

await saveCache();
const withEditors = Object.values(cache).filter(v => v.se || v.ae).length;
console.log(`\n✓ Wrote ${CACHE_PATH}`);
console.log(`  This session: ${processed} pages fetched, ${found} new editor records.`);
console.log(`  Cache now maps ${Object.keys(cache).length} DOIs (${withEditors} with editors).`);
console.log('\nNext: commit and push the updated file, e.g.');
console.log('  git add lit/data/_informs-editors.json');
console.log('  git commit -m "lit: refresh ISR/Marketing Science editor index"');
console.log('  git push');
console.log('The next scheduled data build folds the editors in automatically.');
