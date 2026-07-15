/*
 * pnas-concepts-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * Builds/refreshes lit/data/_pnas-concepts.json: the mapping from PNAS
 * DOIs to the five topic sections shown on stouras.com/lit/
 * (Computer Sciences, Sustainability Science, Environmental Sciences,
 * Social Sciences, Economic Sciences).
 *
 * Why local? pnas.org protects its search pages with a Cloudflare challenge
 * that blocks cloud/datacenter IPs (GitHub Actions included). From a normal
 * home or university connection the pages load fine. The daily GitHub Action
 * then joins this committed file with Crossref metadata — you only need to
 * re-run this occasionally (say monthly) to pick up newly published papers;
 * everything else refreshes automatically.
 *
 * Usage (Node 20+, no npm install needed):
 *   cd lit/_scraper
 *   node pnas-concepts-local.mjs           # first run: full crawl (~15-30 min)
 *   node pnas-concepts-local.mjs           # later runs: incremental (~1 min)
 *   node pnas-concepts-local.mjs --full    # force a full re-crawl
 *
 * Then commit + push the updated lit/data/_pnas-concepts.json.
 *
 * Until this has run, the site fills the PNAS sections with an APPROXIMATION
 * (each paper's OpenAlex primary topic). The index this script writes is
 * authoritative and CORRECTS the approximation on the next data build:
 * wrongly labeled papers get PNAS's own section, and papers the approximation
 * wrongly placed in a section (but which PNAS lists in none of the five) are
 * removed — the approximation stays in use only for papers newer than this
 * crawl, until you re-run it.
 *
 * If YOUR connection is also challenged ("blocked by Cloudflare" below):
 *   1. open https://www.pnas.org in your browser and pass the check once,
 *   2. copy the cf_clearance cookie (DevTools → Application → Cookies),
 *   3. re-run with:  LIT_CF_COOKIE="cf_clearance=…" node pnas-concepts-local.mjs
 * ===========================================================================
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
// Atomic write (temp + rename): a power-off mid-write can never truncate the file.
async function awrite(dest, str) {
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, str, 'utf8');
  await rename(tmp, dest);
}
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlConcepts, mergeIntoCache } from './pnas-crawl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, '..', 'data', '_pnas-concepts.json');
const FULL = process.argv.includes('--full');
const COOKIE = process.env.LIT_CF_COOKIE || '';
const PULL_DATE = new Date().toISOString().slice(0, 10);

const cache = existsSync(CACHE_PATH)
  ? JSON.parse(await readFile(CACHE_PATH, 'utf8'))
  : { map: {} };

const doFull = FULL || !cache.full;
const afterYear = doFull ? null : new Date().getFullYear() - 2;
console.log(doFull
  ? 'Full crawl of all five PNAS sections (first run — this takes a while)…'
  : `Incremental crawl (papers published after ${afterYear}). Use --full to re-crawl everything.`);

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

const res = await crawlConcepts(fetchPage, { afterYear, log: console.log });

if (res.challenged) {
  console.error('\n✗ Blocked by Cloudflare from this connection.');
  console.error('  Fix: open https://www.pnas.org in your browser, pass the check, then re-run with');
  console.error('  LIT_CF_COOKIE="cf_clearance=<value from DevTools>" node pnas-concepts-local.mjs');
  process.exit(1);
}
if (!res.map.size) {
  console.error('\n✗ No DOIs collected — nothing written. (Did the page format change?)');
  process.exit(1);
}

const merged = mergeIntoCache(cache, res.map, { pullDate: PULL_DATE, full: doFull && res.ok });
await awrite(CACHE_PATH, JSON.stringify(merged));

console.log('\n✓ Wrote', CACHE_PATH);
console.log('  Section sizes:', JSON.stringify(merged.counts));
console.log('  Total DOIs mapped:', Object.keys(merged.map).length);
console.log('\nNext: commit and push the updated file, e.g.');
console.log('  git add lit/data/_pnas-concepts.json');
console.log('  git commit -m "lit: refresh PNAS section index"');
console.log('  git push');
console.log('The push itself triggers the data build, which replaces the OpenAlex');
console.log('approximation with these official labels for everything this crawl covered');
console.log('(papers newer than this crawl keep the approximation until you re-run).');
