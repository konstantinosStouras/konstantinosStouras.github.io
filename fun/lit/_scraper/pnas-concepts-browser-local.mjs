/*
 * pnas-concepts-browser-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * Same job as pnas-concepts-local.mjs (build the PNAS DOI→section index in
 * fun/lit/data/_pnas-concepts.json), but it drives YOUR REAL Chrome/Edge
 * browser instead of making plain HTTP requests. Use this when pnas.org's
 * Cloudflare check rejects the plain script even with a cf_clearance cookie
 * (strict mode also fingerprints the network client, which only a real
 * browser passes).
 *
 * One-time setup, then run (Node 20+):
 *   cd fun/lit/_scraper
 *   npm install --no-save playwright-core
 *   node pnas-concepts-browser-local.mjs           # first run: full crawl
 *   node pnas-concepts-browser-local.mjs --full    # force a full re-crawl
 *
 * A Chrome window OPENS AND NAVIGATES BY ITSELF — leave it alone (if a
 * "verify you are human" checkbox ever appears in it, click it once; the
 * crawl continues automatically). ~20–30 minutes on the first run, about a
 * minute for later incremental refreshes.
 *
 * Then commit + push the updated index:
 *   git add ../data/_pnas-concepts.json
 *   git commit -m "lit: refresh PNAS section index"
 *   git push
 * The push triggers the site's data rebuild, which replaces the OpenAlex
 * approximation with these official labels for everything the crawl covered.
 * ===========================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlConcepts, mergeIntoCache } from './pnas-crawl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, '..', 'data', '_pnas-concepts.json');
const FULL = process.argv.includes('--full');
const PULL_DATE = new Date().toISOString().slice(0, 10);

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('✗ playwright-core is not installed. Run this once, then retry:');
  console.error('    npm install --no-save playwright-core');
  process.exit(1);
}

const cache = existsSync(CACHE_PATH)
  ? JSON.parse(await readFile(CACHE_PATH, 'utf8'))
  : { map: {} };
const doFull = FULL || !cache.full;
const afterYear = doFull ? null : new Date().getFullYear() - 2;
console.log(doFull
  ? 'Full crawl of all five PNAS sections via your Chrome — a browser window will open; leave it alone…'
  : `Incremental crawl (papers published after ${afterYear}) via your Chrome…`);

// Launch the user's installed Chrome (falls back to Edge), headed — a real,
// visible browser is exactly what passes Cloudflare's checks.
let browser = null;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel, headless: false });
    console.log(`  using ${channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`);
    break;
  } catch { /* try the next channel */ }
}
if (!browser) {
  console.error('✗ Could not find Google Chrome or Microsoft Edge on this machine.');
  process.exit(1);
}
const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();

// fetchPage via real navigation: load the URL, give the Cloudflare challenge
// time to auto-resolve (or be clicked by the user), then hand back the HTML.
async function fetchPage(url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (let i = 0; i < 30; i++) {                    // up to ~60s per challenge
    const title = await page.title();
    if (!/just a moment|attention required/i.test(title)) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1200);                  // let the results render
  const body = await page.content();
  const status = /just a moment|attention required/i.test(await page.title())
    ? 403 : (resp ? resp.status() : 200);
  return { status, body };
}

const res = await crawlConcepts(fetchPage, { afterYear, log: console.log });
await browser.close();

if (res.challenged || !res.map.size) {
  console.error('\n✗ The crawl could not get through even in the real browser.');
  console.error('  If a verification checkbox appeared in the Chrome window, re-run and click it when it shows.');
  process.exit(1);
}

const merged = mergeIntoCache(cache, res.map, { pullDate: PULL_DATE, full: doFull && res.ok });
await writeFile(CACHE_PATH, JSON.stringify(merged), 'utf8');

console.log('\n✓ Wrote', CACHE_PATH);
console.log('  Section sizes:', JSON.stringify(merged.counts));
console.log('  Total DOIs mapped:', Object.keys(merged.map).length);
console.log('\nNext: commit and push the updated file:');
console.log('  git add ../data/_pnas-concepts.json');
console.log('  git commit -m "lit: refresh PNAS section index"');
console.log('  git push');
console.log('The push triggers the data rebuild, which swaps the OpenAlex approximation');
console.log('for these official PNAS labels everywhere this crawl covered.');
