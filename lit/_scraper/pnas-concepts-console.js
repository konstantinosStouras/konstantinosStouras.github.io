/*
 * pnas-concepts-console.js — the zero-infrastructure PNAS section crawler.
 * ===========================================================================
 * Paste this WHOLE FILE into your browser's DevTools Console while on any
 * www.pnas.org page (F12 → Console; if Chrome asks, type "allow pasting").
 * It runs inside your normal, already-trusted browsing session — Cloudflare
 * cannot tell it apart from you clicking through search pages, because it
 * uses the very same session. Nothing to install, no cookies to copy.
 *
 * It walks the five section listings 100 results at a time until a page comes
 * back not full — the fundamental "last page" signal, needing no result total
 * and no pagination markup — and then DOWNLOADS a file `_pnas-concepts.json`.
 *
 * Afterwards:
 *   1. move the downloaded file into  lit/data/  (replace the old one),
 *   2. git add lit/data/_pnas-concepts.json
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
  const PAGE_SIZE = 100, MAX_PAGES = 400, DELAY = 2000, STALL_LIMIT = 3;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const parser = new DOMParser();
  // Page-template DOIs, not papers: the journal's ISSN entry, podcast episodes.
  const junk = (d) => /^10\.1073\/(e?issn|pc\.)/i.test(d);
  const map = {};
  const add = (doi, key) => {
    (map[doi] = map[doi] || []).includes(key) || map[doi].push(key);
  };
  // How many result rows a page shows. On a full page this is PAGE_SIZE (the
  // diagnostic confirmed .hlFld-Title === 100); on the final page it is fewer.
  const countResults = (doc) => {
    for (const sel of ['.hlFld-Title', '.issue-item', '.search__item', 'article.searchResultItem', '.item__body']) {
      const n = doc.querySelectorAll(sel).length;
      if (n) return n;
    }
    return 0;
  };
  // Every real PNAS DOI on the page. The raw-HTML regex found all 104 links in
  // the diagnostic; junk() drops the ~4 chrome links, leaving the 100 papers.
  const doisOf = (html) => {
    const out = [];
    for (const m of html.matchAll(/\/doi\/(?:abs\/|full\/|epdf\/|pdf\/|suppl\/)?(10\.1073\/[a-zA-Z0-9._\-()/]+)/g)) {
      const d = m[1].replace(/\/+$/, '').toLowerCase();
      if (!junk(d)) out.push(d);
    }
    return out;
  };

  const sectionComplete = {};
  for (const [key, concept, name] of SECTIONS) {
    const mine = new Set();
    let retries = 0, stall = 0, complete = false;
    for (let p = 0; p < MAX_PAGES; p++) {
      // The plain URL the diagnostic proved works — no sortBy (an unverified
      // sort value returns an empty page), no reliance on pagination markup.
      const url = `/action/doSearch?SeriesKey=pnas&ConceptID=${concept}&startPage=${p}&pageSize=${PAGE_SIZE}`;
      let res;
      try {
        res = await fetch(url, { credentials: 'include' });
      } catch (e) {
        if (++retries > 8) { console.error(`${name}: repeated network errors — partial results kept.`); break; }
        console.log(`  ${name}: network hiccup — waiting 5s (page ${p + 1})…`);
        await sleep(5000); p--; continue;
      }
      if (res.status === 429) {                          // rate limited: wait & retry
        if (++retries > 8) { console.error(`${name}: still rate-limited after 8 waits — partial results kept.`); break; }
        console.log(`  ${name}: server says slow down — waiting 30s (page ${p + 1})…`);
        await sleep(30000); p--; continue;
      }
      const html = await res.text();
      if (res.status !== 200 || /just a moment|cf_chl_opt/i.test(html.slice(0, 4000))) {
        console.error(`${name}: blocked on page ${p + 1} — reload the tab and paste the script again.`);
        break;
      }
      retries = 0;
      const doc = parser.parseFromString(html, 'text/html');
      const n = countResults(doc);
      let fresh = 0;
      for (const d of doisOf(html)) {
        if (!mine.has(d)) { mine.add(d); add(d, key); fresh++; }
      }
      console.log(`  ${name}: page ${p + 1} — ${n} results, ${fresh} new, ${mine.size} total`);
      // Primary stop: a page that isn't full is the last page.
      if (n < PAGE_SIZE) { complete = true; break; }
      // Runaway guard: a full page yielding nothing new means the listing is
      // repeating (or reshuffling) — bail after a few, but do NOT claim
      // completeness (the build's safety valve then keeps the approximation).
      if (fresh === 0) { if (++stall >= STALL_LIMIT) break; } else stall = 0;
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
  Object.values(sorted).forEach((keys) => keys.forEach((k) => counts[k]++));
  // Claim completeness ONLY when every section reached a not-full final page.
  // A partial file is still safe to push: the build lets official labels win
  // per-paper and keeps the OpenAlex approximation for everything the crawl
  // didn't cover — it only ever *excludes* papers on the strength of a
  // genuinely full index (and even then only one at least half the size of
  // the approximation, so a truncated crawl can never shrink the dataset).
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
  console.log('%c✓ Downloaded _pnas-concepts.json — move it into lit/data/ and commit+push.', 'color:green;font-weight:bold');
})();
