/*
 * pnas-crawl.mjs — crawl pnas.org's search pages to learn which PNAS papers
 * belong to which topic section ("Concept"), since neither Crossref nor any
 * open API carries PNAS's own section labels.
 *
 * pnas.org sits behind a Cloudflare *managed challenge* that blocks plain
 * HTTP clients on datacenter IPs (GitHub runners included — verified, see
 * _probe/browser-report.json). So this module is used two ways:
 *   • build-data.mjs calls it opportunistically on every run — if Cloudflare
 *     ever lets the runner through, sections refresh automatically;
 *   • pnas-concepts-local.mjs runs it from your own machine (residential IPs
 *     normally are not challenged; a cf_clearance cookie is the fallback),
 *     writing the committed cache lit/data/_pnas-concepts.json.
 *
 * The crawler only reads *search listing* pages (max ~100 results per page),
 * never article pages, with a polite delay between requests.
 */

export const PNAS_SECTIONS = [
  { key: 'pnas-cs',   concept: '500077', name: 'Computer Sciences' },
  { key: 'pnas-sust', concept: '500082', name: 'Sustainability Science' },
  { key: 'pnas-env',  concept: '500089', name: 'Environmental Sciences' },
  { key: 'pnas-soc',  concept: '500085', name: 'Social Sciences' },
  { key: 'pnas-econ', concept: '500068', name: 'Economic Sciences' },
];

const PAGE_SIZE = 100;
const MAX_PAGES_PER_CONCEPT = 500; // hard stop, ~50k results
const DELAY_MS = 1600;
const STALL_LIMIT = 3; // full pages yielding nothing new = listing is repeating

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function isChallenged(body, status) {
  if (status === 403 || status === 503) return true;
  return /just a moment|challenges\.cloudflare\.com|cf_chl_opt/i.test(String(body || '').slice(0, 6000));
}

// Page-template DOIs, not papers: the journal's ISSN entry, podcast episodes.
// (Same filter as pnas-concepts-console.js — keep in sync.) These chrome links
// used to inflate the per-page tally past the real result count, which helped
// a mis-parsed result total end a crawl after a page or two.
const JUNK_DOI = /^10\.1073\/(e?issn|pc\.)/i;

export function extractDois(html) {
  const out = new Set();
  const re = /\/doi\/(?:abs\/|full\/|epdf\/|pdf\/|suppl\/)?(10\.1073\/[a-zA-Z0-9._\-()/]+)/g;
  let m;
  while ((m = re.exec(html))) {
    let doi = m[1].replace(/\/+$/, '').toLowerCase();
    // links to supplements etc. still identify the parent article DOI
    if (!JUNK_DOI.test(doi)) out.add(doi);
  }
  return [...out];
}

export function extractResultCount(html) {
  const m = String(html).match(/([\d,]+)\s*(?:results?|RESULTS?)\b/) ||
            String(html).match(/result__count[^>]*>\s*([\d,]+)/i) ||
            String(html).match(/"totalResults"\s*:\s*(\d+)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

/*
 * crawlConcepts(fetchPage, opts) -> { ok, challenged, map, counts, complete, pagesFetched }
 *   fetchPage(url) -> Promise<{ status, body }>
 *   opts.afterYear  — only crawl results published after this year (incremental
 *                     refresh; uses Atypon's AfterYear/BeforeYear params).
 *                     Omit/null for a full crawl.
 *   map: { '<doi>': Set<sectionKey> } for every DOI seen this crawl.
 *   complete: { '<sectionKey>': bool } — whether that section's listing was
 *     walked to its genuine last page.
 *   ok: true only when EVERY section completed. Callers must not stamp the
 *     cache "full" otherwise — a truncated crawl once got stamped full and the
 *     build then dropped every paper it had missed (the 2008–2025 PNAS gap).
 *
 * Termination is the one signal that needs no result total and no pagination
 * markup: a NON-EMPTY page with fewer than PAGE_SIZE results is the last page
 * (the same rule pnas-concepts-console.js uses; an empty page is never
 * trusted — the backend can serve an HTTP-200 zero-result template
 * mid-listing). The declared result total is logged for information only —
 * the old `totalSeen >= declared` stop condition let a mis-parsed total
 * (junk chrome DOIs inflating the tally on top) end a crawl after 1–4 pages
 * per section while the run still reported ok.
 */
export async function crawlConcepts(fetchPage, { afterYear = null, log = () => {} } = {}) {
  const map = new Map();
  const counts = {};
  const complete = {};
  let pagesFetched = 0;
  for (const sec of PNAS_SECTIONS) {
    let page = 0, declared = null, stall = 0, secComplete = false;
    const mine = new Set();
    for (; page < MAX_PAGES_PER_CONCEPT; page++) {
      const url = 'https://www.pnas.org/action/doSearch?SeriesKey=pnas'
        + `&ConceptID=${sec.concept}&startPage=${page}&pageSize=${PAGE_SIZE}`
        + (afterYear ? `&AfterYear=${afterYear}&BeforeYear=${new Date().getFullYear() + 1}` : '');
      const { status, body } = await fetchPage(url);
      pagesFetched++;
      if (isChallenged(body, status)) {
        log(`  ${sec.name}: challenged/blocked (HTTP ${status}) on page ${page} — aborting crawl`);
        return { ok: false, challenged: true, map, counts, complete, pagesFetched };
      }
      if (status !== 200) {
        log(`  ${sec.name}: HTTP ${status} on page ${page} — stopping this concept (incomplete)`);
        break;
      }
      if (declared === null) {
        declared = extractResultCount(body);
        log(`  ${sec.name}: ~${declared ?? '?'} results${afterYear ? ` after ${afterYear}` : ''}`);
      }
      const dois = extractDois(body);
      let fresh = 0;
      for (const d of dois) {
        if (mine.has(d)) continue;
        mine.add(d);
        let set = map.get(d);
        if (!set) { set = new Set(); map.set(d, set); }
        if (!set.has(sec.key)) { set.add(sec.key); fresh++; }
      }
      // An empty page is NEVER trusted as the last page: pnas.org's search
      // backend can serve an HTTP-200 zero-result template mid-listing (a
      // timeout/anomaly isChallenged cannot see), which would silently
      // truncate the walk while claiming completeness. The rare genuine case
      // (a total that is an exact multiple of PAGE_SIZE) just ends the
      // sitting "NOT confirmed complete" — safe, since only a complete crawl
      // earns the full stamp. (Same rule in pnas-concepts-console.js.)
      if (!dois.length) break;
      // Primary stop: a NON-EMPTY page that isn't full is the last page.
      if (dois.length < PAGE_SIZE) { secComplete = true; break; }
      // Runaway guard: full pages yielding nothing new mean the listing is
      // repeating/reshuffling — bail WITHOUT claiming completeness.
      if (fresh === 0) { if (++stall >= STALL_LIMIT) break; } else stall = 0;
      await sleep(DELAY_MS);
    }
    counts[sec.key] = mine.size;
    complete[sec.key] = secComplete;
    log(`  ${sec.name}: collected ${mine.size} DOIs over ${page + 1} page(s)` +
      (secComplete ? '' : ' (NOT confirmed complete)'));
  }
  const ok = PNAS_SECTIONS.every(sec => complete[sec.key]);
  return { ok, challenged: false, map, counts, complete, pagesFetched };
}

/* Merge a crawl result into the persisted cache shape:
 *   { updated, full, fullAsOf?, counts, map: { doi: [sectionKeys…] } }
 *
 *   full:     sticky "a complete full crawl has happened at some point" —
 *             a later partial/incremental merge keeps it.
 *   fullAsOf: the date of the last genuinely COMPLETE full crawl — the horizon
 *             up to which the build may treat the index as authoritative. A
 *             partial or incremental merge advances `updated` but NEVER
 *             fullAsOf (the old code advanced the single `updated` stamp on
 *             every merge, silently extending a stale index's authority).
 *   replace:  pass true for a complete full crawl — the crawl IS the whole
 *             index, so stale entries (papers pnas.org no longer lists in a
 *             section) are dropped rather than unioned forever. This is what
 *             actually makes a re-run "correct wrongly included papers".
 */
export function mergeIntoCache(cache, crawlMap, { pullDate, full = false, replace = false }) {
  const out = (!replace && cache && cache.map) ? cache : { map: {} };
  for (const [doi, keys] of crawlMap) {
    const prev = new Set(out.map[doi] || []);
    for (const k of keys) prev.add(k);
    out.map[doi] = [...prev].sort();
  }
  // deterministic key order so unchanged data produces identical bytes
  const sorted = {};
  for (const k of Object.keys(out.map).sort()) sorted[k] = out.map[k];
  const counts = {};
  for (const sec of PNAS_SECTIONS) counts[sec.key] = 0;
  for (const keys of Object.values(sorted)) for (const k of keys) counts[k] = (counts[k] || 0) + 1;
  const fullAsOf = full ? pullDate : (cache && cache.fullAsOf) || undefined;
  return {
    updated: pullDate,
    full: full || !!(cache && cache.full),
    ...(fullAsOf ? { fullAsOf } : {}),
    counts,
    map: sorted,
  };
}
