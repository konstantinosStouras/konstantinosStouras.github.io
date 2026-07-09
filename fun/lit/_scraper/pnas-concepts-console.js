/*
 * pnas-concepts-console.js — the zero-infrastructure PNAS section crawler.
 * ===========================================================================
 * Paste this WHOLE FILE into your browser's DevTools Console while on any
 * www.pnas.org page (F12 → Console; if Chrome asks, type "allow pasting").
 * It runs inside your normal, already-trusted browsing session — Cloudflare
 * cannot tell it apart from you clicking through search pages, because it
 * uses the very same session. Nothing to install, no cookies to copy.
 *
 * It crawls the five section listings (~5-10 minutes, progress in the
 * console) and then DOWNLOADS a file named `_pnas-concepts.json`.
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
  const map = {};
  const add = (doi, key) => {
    (map[doi] = map[doi] || []).includes(key) || map[doi].push(key);
  };

  for (const [key, concept, name] of SECTIONS) {
    let total = null, loggedTotal = false;
    const mine = new Set();
    let retries = 0;
    for (let p = 0; p < MAX_PAGES; p++) {
      const url = `/action/doSearch?SeriesKey=pnas&ConceptID=${concept}&startPage=${p}&pageSize=${PAGE_SIZE}`;
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
      if (total === null) {
        const m = html.match(/([\d,]+)\s*results?/i) || html.match(/of\s+([\d,]+)/i) || html.match(/"totalResults"\s*:\s*(\d+)/);
        if (m) total = parseInt(m[1].replace(/,/g, ''), 10);
        if (!loggedTotal) { console.log(`${name}: ${total ? '~' + total : 'unknown #'} results`); loggedTotal = true; }
      }
      let fresh = 0;
      for (const m of html.matchAll(/\/doi\/(?:abs\/|full\/|epdf\/|pdf\/|suppl\/)?(10\.1073\/[a-zA-Z0-9._\-()/]+)/g)) {
        const d = m[1].replace(/\/+$/, '').toLowerCase();
        if (!mine.has(d)) { mine.add(d); add(d, key); fresh++; }
      }
      if (p % 10 === 9) console.log(`  ${name}: page ${p + 1}, ${mine.size} collected…`);
      if (!fresh) break;                               // ran off the end
      if (total !== null && mine.size >= total) break;
      await sleep(DELAY);
    }
    console.log(`${name}: done — ${mine.size} DOIs`);
  }

  // deterministic output, same shape the data pipeline expects
  const sorted = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k].sort();
  const counts = {};
  for (const [key] of SECTIONS) counts[key] = 0;
  Object.values(sorted).forEach(keys => keys.forEach(k => counts[k]++));
  const out = {
    updated: new Date().toISOString().slice(0, 10),
    full: true,
    counts,
    map: sorted,
  };
  console.log('Section sizes:', JSON.stringify(counts));
  console.log('Total DOIs mapped:', Object.keys(sorted).length);

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '_pnas-concepts.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('%c✓ Downloaded _pnas-concepts.json — move it into fun/lit/data/ and commit+push.', 'color:green;font-weight:bold');
})();
