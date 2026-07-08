/*
 * probe-pnas-browser.mjs — TEMPORARY probe #2.
 * pnas.org sits behind a Cloudflare managed challenge that blocks plain fetch
 * (see _probe/pnas-cs.html). This probe checks whether a real Chrome (system
 * Chrome via playwright-core, headed under xvfb) passes the challenge on a
 * GitHub runner, and validates the exact container-title filter for ACM EC
 * proceedings on Crossref. Results go to _probe/browser-report.json.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '_probe');
const MAILTO = 'kstouras@gmail.com';
const report = { ranAt: new Date().toISOString() };

// ── 1. Crossref: exact container-title counts for EC proceedings ───────────
const ORDINALS = ['21st', '22nd', '23rd', '24th', '25th', '26th', '27th'];
async function ecCounts() {
  const out = {};
  for (const ord of ORDINALS) {
    const t = `Proceedings of the ${ord} ACM Conference on Economics and Computation`;
    const url = `https://api.crossref.org/works?filter=container-title:${encodeURIComponent(t)}&rows=0&mailto=${MAILTO}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': `lit-probe/0.2 (mailto:${MAILTO})` } });
      const j = await r.json();
      out[ord] = j?.message?.['total-results'] ?? null;
    } catch (e) { out[ord] = 'ERR ' + e.message; }
    console.log(`EC ${ord}: ${out[ord]}`);
  }
  report.ecExactCounts = out;
}

// ── 2. PNAS doSearch through a real browser ─────────────────────────────────
async function pnasBrowser() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const out = {};
  try {
    const url = 'https://www.pnas.org/action/doSearch?SeriesKey=pnas&ConceptID=500077&startPage=0&pageSize=100';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Give the Cloudflare managed challenge time to auto-resolve.
    for (let i = 0; i < 10; i++) {
      const title = await page.title();
      if (!/just a moment/i.test(title)) break;
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(3000);
    const html = await page.content();
    const title = await page.title();
    out.title = title;
    out.size = html.length;
    out.challenged = /just a moment/i.test(title);
    const mCount = html.match(/([\d,]+)\s*results?\s*(?:for|<)/i) || html.match(/result__count[^>]*>\s*([\d,]+)/i) || html.match(/"totalResults"\s*:\s*(\d+)/);
    out.resultCount = mCount ? mCount[1] : null;
    out.doiLinks = (html.match(/doi\/(?:abs\/|full\/|epdf\/)?10\.1073\/[a-zA-Z0-9./]+/g) || []).length;
    await writeFile(join(OUT, 'pnas-browser-cs.html'), html.slice(0, 3_000_000), 'utf8');
    console.log('pnas via browser:', JSON.stringify(out));

    // If page 1 worked, try page 2 in the same context (cookie reuse).
    if (!out.challenged && out.doiLinks > 0) {
      await page.goto('https://www.pnas.org/action/doSearch?SeriesKey=pnas&ConceptID=500077&startPage=1&pageSize=100', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
      const html2 = await page.content();
      out.page2DoiLinks = (html2.match(/doi\/(?:abs\/|full\/|epdf\/)?10\.1073\/[a-zA-Z0-9./]+/g) || []).length;
      await writeFile(join(OUT, 'pnas-browser-cs-p2.html'), html2.slice(0, 1_000_000), 'utf8');
      // And check how a *fetch inside the page* fares (fast path for the crawler).
      out.inPageFetch = await page.evaluate(async () => {
        const r = await fetch('/action/doSearch?SeriesKey=pnas&ConceptID=500068&startPage=0&pageSize=100');
        const t = await r.text();
        return { status: r.status, size: t.length, dois: (t.match(/10\.1073\//g) || []).length };
      });
      console.log('page2 + in-page fetch:', JSON.stringify({ p2: out.page2DoiLinks, f: out.inPageFetch }));
    }
  } catch (e) {
    out.error = String(e);
    console.error('browser probe failed:', e);
  }
  await browser.close();
  report.pnasBrowser = out;
}

await mkdir(OUT, { recursive: true });
await ecCounts();
await pnasBrowser();
await writeFile(join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('\n=== BROWSER REPORT ===\n' + JSON.stringify(report, null, 2));
