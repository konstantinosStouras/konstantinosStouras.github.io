/*
 * pnas-concepts-console.js — the zero-infrastructure PNAS section crawler.
 * ===========================================================================
 * Paste this WHOLE FILE into your browser's DevTools Console while on any
 * www.pnas.org page (F12 → Console; if Chrome asks, type "allow pasting").
 * It runs inside your normal, already-trusted browsing session — Cloudflare
 * cannot tell it apart from you clicking through search pages, because it
 * uses the very same session. Nothing to install, no cookies to copy.
 *
 * It walks the five section listings page by page, following the site's own
 * pagination (~10–20 minutes, progress in the console), and then DOWNLOADS a
 * file named `_pnas-concepts.json`.
 *
 * Afterwards:
 *   1. move the downloaded file into  fun/lit/data/  (replace the old one),
 *   2. git add fun/lit/data/_pnas-concepts.json
 *      git commit -m "lit: refresh PNAS section index"
 *      git push
 * The push triggers the site rebuild, which swaps the OpenAlex approximation
 * for these official PNAS section labels.
 * ===========================================================================
 */
(async () => {
  const SECTIONS = [
    ['pnas-cs',   '500077', 'Computer Sciences'],
    ['pnas-sust', '500082', 'Sustainability Science'],
    ['pnas-env',  '500089', 'Environmental Sciences'],
    ['pnas-soc',  '500085', 'Social Sciences'],
    ['pnas-econ', '500068', 'Economic Sciences'],
  ];
  const PAGE_SIZE = 100, MAX_PAGES = 400, DELAY = 2000;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const parser = new DOMParser();
  // Page-template links, not papers: the journal's ISSN entry, podcast episodes.
  const junk = (d) => /^10\.1073\/(e?issn|pc\.)/i.test(d);
  const map = {};
  const add = (doi, key) => {
    (map[doi] = map[doi] || []).includes(key) || map[doi].push(key);
  };

  const sectionComplete = {};
  for (const [key, concept, name] of SECTIONS) {
    const mine = new Set();
    let retries = 0, complete = false;
    for (let p = 0; p < MAX_PAGES; p++) {
      // sortBy pins a stable order: the default relevance sort reshuffles
      // between requests, making consecutive pages overlap (verified — that's
      // what truncated earlier crawls to a page or two per section).
      const url = `/action/doSearch?SeriesKey=pnas&ConceptID=${concept}&pageSize=${PAGE_SIZE}&sortBy=Earliest&startPage=${p}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 429) {                        // rate limited: wait & retry
        if (++retries > 8) { console.error(`${name}: still rate-limited after 8 waits — partial results kept.`); break; }
        console.log(`  ${name}: server says slow down — waiting 30s (page ${p})…`);
        await sleep(30000); p--; continue;
      }
      const html = await res.text();
      if (res.status !== 200 || /just a moment|cf_chl_opt/i.test(html.slice(0, 4000))) {
        console.error(`${name}: blocked on page ${p} — reload the tab and paste the script again.`);
        break;
      }
      retries = 0;
      const doc = parser.parseFromString(html, 'text/html');
      // Each paper in the result list carries one .hlFld-Title (verified:
      // exactly 100 per full page) whose enclosing link holds the DOI. The
      // raw-HTML regex is only a fallback for a future markup change.
      const titles = [...doc.querySelectorAll('.hlFld-Title')];
      let fresh = 0;
      const harvest = (d) => {
        d = d.replace(/\/+$/, '').toLowerCase();
        if (junk(d) || mine.has(d)) return;
        mine.add(d); add(d, key); fresh++;
      };
      for (const t of titles) {
        const a = t.closest('a') || t.querySelector('a');
        const m = a && (a.getAttribute('href') || '').match(/10\.1073\/[a-zA-Z0-9._\-()/]+/);
        if (m) harvest(m[0]);
      }
      if (!titles.length) {
        for (const m of html.matchAll(/\/doi\/(?:abs\/|full\/|epdf\/|pdf\/|suppl\/)?(10\.1073\/[a-zA-Z0-9._\-()/]+)/g)) harvest(m[1]);
      }
      // The listing is finished when the site's own pagination offers no link
      // to the next page — the pages themselves never state a result total.
      const hasNext = !!doc.querySelector(`a[href*="startPage=${p + 1}"]`);
      console.log(`  ${name}: page ${p + 1} — ${titles.length} results, ${fresh} new, ${mine.size} so far${hasNext ? '' : ' (last page)'}`);
      if (!hasNext) { complete = true; break; }
      await sleep(DELAY);
    }
    sectionComplete[key] = complete && mine.size > 0;
    console.log(`${name}: done — ${mine.size} DOIs ${sectionComplete[key] ? '(complete)' : '(NOT confirmed complete)'}`);
  }

  // deterministic output, same shape the data pipeline expects
  const sorted = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k].sort();
  const counts = {};
  for (const [key] of SECTIONS) counts[key] = 0;
  Object.values(sorted).forEach(keys => keys.forEach(k => counts[k]++));
  // Claim completeness ONLY when every section walked to its last pagination
  // page. A partial file is still safe to push: the build lets official
  // labels win per-paper and keeps the OpenAlex approximation for everything
  // the crawl didn't cover — it only ever *excludes* papers on the strength
  // of a genuinely full index.
  const allComplete = SECTIONS.every(([k]) => sectionComplete[k]);
  const out = {
    updated: new Date().toISOString().slice(0, 10),
    full: allComplete,
    counts,
    map: sorted,
  };
  console.log('Section sizes:', JSON.stringify(counts));
  console.log('Total DOIs mapped:', Object.keys(sorted).length);
  if (!allComplete) console.warn('Some sections could not be confirmed complete — file marked PARTIAL. ' +
    'Safe to push: its labels win per-paper and the approximation keeps covering the rest.');

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '_pnas-concepts.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('%c✓ Downloaded _pnas-concepts.json — move it into fun/lit/data/ and commit+push.', 'color:green;font-weight:bold');
})();
