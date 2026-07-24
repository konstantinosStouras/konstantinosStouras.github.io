/*
 * informs-editors-console.js — the BROWSER-CONSOLE editor harvester.
 * ===========================================================================
 * Cloudflare's bot scoring fingerprints the TLS handshake itself, so even a
 * fresh cf_clearance cookie + matching User-Agent can leave the Node scraper
 * (informs-editors-local.mjs) blocked. This variant runs INSIDE your real
 * browser on pubsonline.informs.org — same-origin fetches from a genuine
 * Chrome session — so there is nothing for Cloudflare to block.
 *
 * HOW TO RUN
 *   1. Open https://pubsonline.informs.org in your browser (any page; let it
 *      load normally).
 *   2. Press F12 → Console tab. (First time, Chrome asks you to type
 *      "allow pasting" — do that.)
 *   3. Paste this WHOLE file's contents and press Enter. It starts crawling
 *      immediately, newest papers first, and logs progress every 25 pages.
 *   4. Let it run as long as you like — progress is saved in localStorage
 *      continuously, so closing the tab or pasting again another day RESUMES
 *      where it stopped. Helpers while it runs:
 *        litEdStop()      pause (progress kept)
 *        litEdDownload()  download the cache built so far
 *        litEdRun(200)    resume, capped at 200 pages this sitting
 *        litEdRun(Infinity, true)   also re-check pages cached as "none"
 *   5. When it finishes (or whenever you stop), it downloads
 *      _informs-editors.json. Move it over lit\data\_informs-editors.json in
 *      the repo (replace), then:
 *        git add lit/data/_informs-editors.json
 *        git commit -m "lit: refresh ISR/MkSc editor index"
 *        git pull --rebase origin master
 *        git push
 *      The next daily build folds the editors in automatically.
 *
 * It seeds from the cache already committed on master (so nothing is ever
 * re-fetched) plus this browser's own saved progress, and its output is
 * byte-compatible with the Node scraper's.
 *
 * The parser below is VENDORED from informs-editors.mjs — keep the two in
 * sync (informs-editors-selftest.mjs parity-checks them on every run).
 * ===========================================================================
 */
(() => {
  'use strict';

  // ── vendored parser — keep in sync with informs-editors.mjs ──────────────
  function tailSegment(s) {
    const parts = String(s || '').split(/(?<=[a-zà-þ]{2}|\d{4})\.\s+/);
    return parts[parts.length - 1];
  }
  function cleanName(raw) {
    let s = tailSegment(String(raw || ''))
      .replace(/^.*(?:history|editors?)\s*:\s*/i, '')
      .replace(/^.*?\b(?:accepted|processed|handled|recommended(?:\s+for\s+acceptance)?|edited)\s+by\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:and|with|by)\s+/i, '')
      .replace(/^(?:the\s+)?(?:special[- ]issue\s+)?(?:senior|associate)\s+editors?\s+/i, '')
      .replace(/^(?:dr|prof(?:essor)?|mr|mrs|ms)\.?\s+/i, '')
      .replace(/[.,;:]+$/, '')
      .trim();
    return s;
  }
  function plausibleName(s) {
    if (!s || s.length < 4 || s.length > 60) return false;
    if (s.split(/\s+/).length > 6) return false;
    if (!/^[A-ZÀ-Þ]/.test(s)) return false;
    return !/\b(the|this|that|is|are|was|were|we|of|in|on|to|as|for|paper|article|issue|editors?|received|accepted|served|revisions?)\b/i.test(s);
  }
  function splitNames(raw) {
    return String(raw || '')
      .split(/\s+(?:and|&)\s+/i)
      .map(cleanName)
      .filter(plausibleName);
  }
  function parseInformsEditors(text) {
    const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const se = new Set(), ae = new Set();
    for (const m of t.matchAll(/([^;:]{2,80}?),\s*(?:the\s+)?Senior\s+Editors?\b/gi)) {
      splitNames(m[1]).forEach(n => se.add(n));
    }
    for (const m of t.matchAll(/([^;:]{2,80}?),\s*(?:the\s+)?Associate\s+Editors?\b/gi)) {
      splitNames(m[1]).forEach(n => ae.add(n));
    }
    for (const m of t.matchAll(/([^;:]{2,90}?)\s+served\s+as\s+(?:the\s+)?senior\s+editors?\b/gi)) {
      splitNames(m[1]).forEach(n => se.add(n));
    }
    for (const m of t.matchAll(/([^;:]{2,90}?)\s+served\s+as\s+(?:the\s+)?associate\s+editors?\b/gi)) {
      splitNames(m[1]).forEach(n => ae.add(n));
    }
    for (const m of t.matchAll(/\b(?:and|;)\s*([A-ZÀ-Þ][^;:]{1,60}?)\s+as\s+(?:the\s+)?associate\s+editors?\b/g)) {
      splitNames(m[1]).forEach(n => ae.add(n));
    }
    for (const m of t.matchAll(/\b(?:accepted|processed|handled|edited)\s+by\s+(?:the\s+)?(?:special[- ]issue\s+)?senior\s+editors?,?\s+([A-ZÀ-Þ][^.;:()]{2,60})/gi)) {
      splitNames(m[1]).forEach(n => se.add(n));
    }
    for (const m of t.matchAll(/\b(?:accepted|processed|handled|edited)\s+by\s+(?:the\s+)?associate\s+editors?,?\s+([A-ZÀ-Þ][^.;:()]{2,60})/gi)) {
      splitNames(m[1]).forEach(n => ae.add(n));
    }
    let m = t.match(/Senior\s+Editors?\s*[:—-]\s*([^.;]{2,80})/i);
    if (m) splitNames(m[1]).forEach(n => se.add(n));
    m = t.match(/Associate\s+Editors?\s*[:—-]\s*([^.;]{2,80})/i);
    if (m) splitNames(m[1]).forEach(n => ae.add(n));
    return { se: [...se].join('; '), ae: [...ae].join('; ') };
  }
  function editorsFromPageHtml(html) {
    const text = String(html || '')
      .replace(/<\/(?:p|div|section|li|h[1-6]|td|tr|ul|ol|nav)>|<br\s*\/?>/gi, ' ; ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const windows = [];
    for (const m of text.matchAll(/History\s*:/gi)) {
      windows.push(text.slice(m.index, m.index + 1500));
      if (windows.length >= 8) break;
    }
    for (const m of text.matchAll(/(?:Senior|Associate)\s+Editor/gi)) {
      windows.push(text.slice(Math.max(0, m.index - 400), m.index + 400));
      if (windows.length >= 24) break;
    }
    if (!windows.length) return null;
    const se = new Set(), ae = new Set();
    for (const w of windows) {
      const ed = parseInformsEditors(w);
      if (ed.se) ed.se.split('; ').forEach(n => se.add(n));
      if (ed.ae) ed.ae.split('; ').forEach(n => ae.add(n));
    }
    return { se: [...se].join('; '), ae: [...ae].join('; ') };
  }
  // ── end vendored parser ───────────────────────────────────────────────────

  const SITE = 'https://www.stouras.com/lit/data/';
  const RAW = 'https://raw.githubusercontent.com/konstantinosStouras/konstantinosStouras.github.io/master/lit/data/_informs-editors.json';
  const SOURCES = [
    { key: 'isre', file: 'papers-isre.json', ae: true },
    { key: 'mksc', file: 'papers-mksc.json', ae: false },
  ];
  const DELAY_MS = 1500, SAVE_EVERY = 25, LS_KEY = 'litInformsEditorsCache';

  const cache = {};
  let stop = false, running = false;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const saveLocal = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) { /* quota — download() still works */ } };

  function download() {
    const sorted = {};
    for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(sorted)], { type: 'application/json' }));
    a.download = '_informs-editors.json';
    a.click();
    const withEd = Object.values(sorted).filter(v => v && (v.se || v.ae)).length;
    console.log(`⬇ Downloaded _informs-editors.json — ${Object.keys(sorted).length} DOIs, ${withEd} with editors.`);
    console.log('Move it over lit\\data\\_informs-editors.json (replace), then: git add … && git commit … && git pull --rebase origin master && git push');
  }

  async function run(max = Infinity, retryMisses = false) {
    if (running) { console.warn('Already running — litEdStop() first.'); return; }
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
        let dois;
        try {
          const rows = await (await fetch(SITE + src.file)).json();
          dois = rows.map(r => (r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()).filter(Boolean);
        } catch (e) {
          console.error(`Could not fetch ${src.file} (the page's CSP may block cross-origin fetches):`, e.message);
          continue;
        }
        console.log(`${src.key}: ${dois.length} DOIs, ${dois.filter(d => cache[d]).length} already cached`);
        for (const doi of dois) {
          if (stop) { console.log('⏸ Stopped — progress saved. Paste again (or litEdRun()) to resume.'); break outer; }
          if (processed >= max) { console.log(`Reached the ${max}-page cap for this sitting.`); break outer; }
          const cur = cache[doi];
          if (cur && (cur.se || cur.ae)) continue;
          if (cur && cur.none && !retryMisses) continue;
          processed++;
          try {
            const res = await fetch('/doi/' + doi);
            if (!res.ok) { console.warn(`  ${doi}: HTTP ${res.status}`); await sleep(DELAY_MS); continue; }
            const ed = editorsFromPageHtml(await res.text());
            if (ed && (ed.se || ed.ae)) { cache[doi] = { se: ed.se, ae: src.ae ? ed.ae : '' }; found++; }
            else cache[doi] = { none: true };
            if (processed % SAVE_EVERY === 0) { saveLocal(); console.log(`  …${processed} pages fetched, ${found} with editors`); }
          } catch (e) { console.warn(`  ${doi}: ${e.message}`); }
          await sleep(DELAY_MS);
        }
      }
    } finally { saveLocal(); running = false; }
    const withEd = Object.values(cache).filter(v => v && (v.se || v.ae)).length;
    console.log(`Done this sitting: ${processed} pages fetched, ${found} new editor records.`);
    console.log(`Cache now maps ${Object.keys(cache).length} DOIs (${withEd} with editors).`);
    if (processed) download();
  }

  const G = (typeof window !== 'undefined') ? window : globalThis;
  G.litEdRun = run; G.litEdStop = () => { stop = true; }; G.litEdDownload = download;
  globalThis.__litEd = { parseInformsEditors, editorsFromPageHtml }; // parity-test hook (harmless in the browser)

  if (typeof document !== 'undefined') {
    if (/(^|\.)pubsonline\.informs\.org$/.test(location.hostname)) {
      console.log('%cThe Lit — ISR/MkSc editor harvester', 'font-weight:bold');
      console.log('Crawling newest-first; ~1.5 s per page, resumable. litEdStop() to pause, litEdDownload() anytime.');
      run();
    } else {
      console.warn('Open https://pubsonline.informs.org first, then paste this script into ITS console.');
    }
  }
})();
