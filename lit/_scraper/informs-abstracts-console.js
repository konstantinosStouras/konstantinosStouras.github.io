/*
 * informs-abstracts-console.js — the BROWSER-CONSOLE full-abstract harvester.
 * ===========================================================================
 * Crossref's deposited abstract for many INFORMS papers (Marketing Science
 * especially) is a one-sentence teaser; the real abstract is on the article
 * page, and pubsonline blocks cloud IPs AND often local Node (TLS
 * fingerprinting). This variant runs INSIDE your real browser on
 * pubsonline.informs.org — same-origin fetches — so nothing blocks it.
 * It crawls ONLY papers whose served abstract is missing/short (~800 MkSc
 * pages, not 2,273), Marketing Science first, newest first.
 *
 * HOW TO RUN
 *   1. Open https://pubsonline.informs.org (any page; let it load normally).
 *   2. F12 → Console. (Don't run it at the same time as the EDITORS
 *      harvester — litEdStop() that one first; one polite crawler at a time.)
 *   3. Paste this WHOLE file, press Enter. Progress logs every 25 pages;
 *      saved to localStorage continuously — closing the tab or re-pasting
 *      another day RESUMES. Helpers:
 *        litAbsStop()      pause (progress kept; downloads what it has)
 *        litAbsDownload()  download the cache built so far
 *        litAbsRun(200)    resume, capped at 200 pages this sitting
 *        litAbsRun(Infinity, false, 'mksc')        one journal only
 *        litAbsRun(Infinity, false, 'mksc', 2006)  …and only Year ≥ 2006
 *        litAbsRun(Infinity, true)   also re-check pages cached as "none"
 *        litAbsPace(700)   ms/page (default 1500; floor 700 — polite)
 *   4. When it finishes (or you stop), it downloads _informs-abstracts.json.
 *      Move it over lit\data\_informs-abstracts.json (replace), then apply
 *      to the SERVED papers files and push — the site updates on deploy:
 *        cd lit\_scraper
 *        node informs-abstracts-local.mjs --apply-only
 *        git add lit/data
 *        git commit -m "lit: full abstracts from pubsonline"
 *        git pull --rebase origin master
 *        git push
 *      (Every daily build re-applies the committed cache, so rebuilds can
 *      never regress a fixed abstract back to the teaser.)
 *
 * The extractor below is VENDORED from informs-abstracts.mjs — keep the two
 * in sync (informs-abstracts-selftest.mjs parity-checks them per fixture).
 * ===========================================================================
 */
(() => {
  'use strict';

  // ── vendored extractor — keep in sync with informs-abstracts.mjs ─────────
  const ABS_MAX = 4000;
  const ENT = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  };
  function decodeEntities(s) {
    let cur = String(s || ''), prev, guard = 0;
    do {
      prev = cur;
      cur = prev
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&([a-z]+);/gi, (m, n) => {
          const k = n.toLowerCase();
          return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
        });
    } while (cur !== prev && ++guard < 4);
    return cur;
  }
  function cleanAbstractText(raw) {
    let s = decodeEntities(String(raw || ''))
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s).replace(/\s+/g, ' ').trim();
    s = s.replace(/^abstract[\s:.–—-]*/i, '');
    const h = s.search(/\bHistory\s*:/i);
    if (h >= 0) s = s.slice(0, h).trim();
    return s;
  }
  function abstractFromPageHtml(html) {
    const h = String(html || '');
    const cands = [];
    const openRe = /<(?:div|section)[^>]*class="[^"]*(?:abstractSection|hlFld-Abstract|abstractInFull|article__abstract)[^"]*"[^>]*>/gi;
    for (const m of h.matchAll(openRe)) {
      let w = h.slice(m.index + m[0].length, m.index + m[0].length + 12000);
      const stop = w.search(
        /class="[^"]*(?:hlFld-Fulltext|history-section|fn-group|sectionInfo|articleReferences|copywrite|coolBar|tab-nav)[^"]*"|<h[12][^>]*>\s*(?:History|Keywords|References|Funding)\b|\bHistory\s*:/i);
      if (stop >= 0) w = w.slice(0, stop);
      // the cut can land INSIDE the next section's opening tag — drop the
      // dangling "<div …" fragment or it survives tag-stripping as text
      const lt = w.lastIndexOf('<');
      if (lt > w.lastIndexOf('>')) w = w.slice(0, lt);
      cands.push(w);
      if (cands.length >= 6) break;
    }
    for (const name of ['dc\\.Description', 'citation_abstract', 'og:description']) {
      const mm =
        h.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([\\s\\S]*?)["']`, 'i')) ||
        h.match(new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:name|property)=["']${name}["']`, 'i'));
      if (mm) cands.push(mm[1]);
    }
    let best = '';
    for (const c of cands) {
      const t = cleanAbstractText(c);
      if (t.length > best.length) best = t;
    }
    if (best.length < 60) return null;
    return best.slice(0, ABS_MAX);
  }
  // ── end vendored extractor ────────────────────────────────────────────────

  const SITE = 'https://www.stouras.com/lit/data/';
  const RAW = 'https://raw.githubusercontent.com/konstantinosStouras/konstantinosStouras.github.io/master/lit/data/_informs-abstracts.json';
  // mksc first — per the owner; then the other INFORMS journals, newest first.
  const SOURCES = [
    { key: 'mksc', file: 'papers-mksc.json' },
    { key: 'ms', file: 'papers-ms.json' },
    { key: 'isre', file: 'papers-isre.json' },
    { key: 'msom', file: 'papers-msom.json' },
    { key: 'opre', file: 'papers-opre.json' },
    { key: 'stsc', file: 'papers-stsc.json' },
    { key: 'ited', file: 'papers-ited.json' },
  ];
  const NEEDY_MAX_LEN = 300; // served abstract shorter than this = teaser/missing
  const SAVE_EVERY = 25, LS_KEY = 'litInformsAbstractsCache';
  let delayMs = 1500; // litAbsPace(ms) overrides; floored at 700 — polite host

  const cache = {};
  let stop = false, running = false;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const saveLocal = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) { /* quota — download() still works */ } };

  function download() {
    const sorted = {};
    for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(sorted)], { type: 'application/json' }));
    a.download = '_informs-abstracts.json';
    a.click();
    const withA = Object.values(sorted).filter(v => v && v.a).length;
    console.log(`⬇ Downloaded _informs-abstracts.json — ${Object.keys(sorted).length} DOIs, ${withA} with abstracts.`);
    console.log('Move it over lit\\data\\_informs-abstracts.json (replace), then push the abstracts into the SERVED papers files:');
    console.log('  cd lit\\_scraper && node informs-abstracts-local.mjs --apply-only');
    console.log('  git add lit/data && git commit -m "lit: full abstracts from pubsonline" && git pull --rebase origin master && git push');
  }

  async function run(max = Infinity, retryMisses = false, journal = '', since = 0) {
    if (running) { console.warn('Already running — litAbsStop() first.'); return; }
    journal = String(journal || '').toLowerCase();
    if (journal && !SOURCES.some(s => s.key === journal)) {
      console.error(`Unknown journal "${journal}" — use one of: ${SOURCES.map(s => s.key).join(', ')}`);
      return;
    }
    since = parseInt(since, 10) || 0;
    running = true; stop = false;
    // Seed: this browser's saved progress + the cache already committed on master.
    try { Object.assign(cache, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) { /* ignore */ }
    try {
      const r = await fetch(RAW + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const remote = await r.json();
        for (const [k, v] of Object.entries(remote.map || remote)) if (!cache[k]) cache[k] = v;
      }
    } catch (e) { console.warn('Could not fetch the committed cache (continuing with this browser\'s progress only):', e.message); }

    let processed = 0, found = 0;
    try {
      outer:
      for (const src of SOURCES) {
        if (journal && src.key !== journal) continue;
        let dois;
        try {
          let rows = await (await fetch(SITE + src.file)).json();
          if (since) rows = rows.filter(r => { const y = parseInt(r.Year, 10); return !y || y >= since; });
          // Only papers whose SERVED abstract is a teaser or missing.
          rows = rows.filter(r => !r.Abstract || r.Abstract.length < NEEDY_MAX_LEN);
          dois = rows.map(r => (r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()).filter(Boolean);
        } catch (e) {
          console.error(`Could not fetch ${src.file} (the page's CSP may block cross-origin fetches):`, e.message);
          continue;
        }
        console.log(`${src.key}: ${dois.length} papers need a fuller abstract, ${dois.filter(d => cache[d]).length} already cached`);
        for (const doi of dois) {
          if (stop) { console.log('⏸ Stopped — progress saved. Paste again (or litAbsRun()) to resume.'); break outer; }
          if (processed >= max) { console.log(`Reached the ${max}-page cap for this sitting.`); break outer; }
          const cur = cache[doi];
          if (cur && cur.a) continue;
          if (cur && cur.none && !retryMisses) continue;
          processed++;
          try {
            const res = await fetch('/doi/' + doi);
            if (!res.ok) { console.warn(`  ${doi}: HTTP ${res.status}`); await sleep(delayMs); continue; }
            const a = abstractFromPageHtml(await res.text());
            if (a) { cache[doi] = { a }; found++; }
            else cache[doi] = { none: 1 };
            if (processed % SAVE_EVERY === 0) { saveLocal(); console.log(`  …${processed} pages fetched, ${found} with abstracts`); }
          } catch (e) { console.warn(`  ${doi}: ${e.message}`); }
          await sleep(delayMs);
        }
      }
    } finally { saveLocal(); running = false; }
    const withA = Object.values(cache).filter(v => v && v.a).length;
    console.log(`Done this sitting: ${processed} pages fetched, ${found} new abstracts.`);
    console.log(`Cache now maps ${Object.keys(cache).length} DOIs (${withA} with abstracts).`);
    if (processed) download();
  }

  const G = (typeof window !== 'undefined') ? window : globalThis;
  G.litAbsRun = run; G.litAbsStop = () => { stop = true; }; G.litAbsDownload = download;
  G.litAbsPace = (ms) => { delayMs = Math.max(700, parseInt(ms, 10) || 1500); console.log(`Pace set to ${delayMs} ms/page.`); };
  globalThis.__litAbs = { decodeEntities, cleanAbstractText, abstractFromPageHtml }; // parity-test hook (harmless in the browser)

  if (typeof document !== 'undefined') {
    if (/(^|\.)pubsonline\.informs\.org$/.test(location.hostname)) {
      console.log('%cThe Lit — INFORMS full-abstract harvester', 'font-weight:bold');
      console.log('Crawling only papers with teaser/missing abstracts, MkSc first, newest first; ~1.5 s per page, resumable. litAbsStop() to pause, litAbsDownload() anytime.');
      run();
    } else {
      console.warn('Open https://pubsonline.informs.org first, then paste this script into ITS console.');
    }
  }
})();
