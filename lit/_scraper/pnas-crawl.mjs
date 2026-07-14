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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function isChallenged(body, status) {
  if (status === 403 || status === 503) return true;
  return /just a moment|challenges\.cloudflare\.com|cf_chl_opt/i.test(String(body || '').slice(0, 6000));
}

export function extractDois(html) {
  const out = new Set();
  const re = /\/doi\/(?:abs\/|full\/|epdf\/|pdf\/|suppl\/)?(10\.1073\/[a-zA-Z0-9._\-()/]+)/g;
  let m;
  while ((m = re.exec(html))) {
    let doi = m[1].replace(/\/+$/, '').toLowerCase();
    // links to supplements etc. still identify the parent article DOI
    out.add(doi);
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
 * crawlConcepts(fetchPage, opts) -> { ok, challenged, map, counts, pagesFetched }
 *   fetchPage(url) -> Promise<{ status, body }>
 *   opts.afterYear  — only crawl results published after this year (incremental
 *                     refresh; uses Atypon's AfterYear/BeforeYear params).
 *                     Omit/null for a full crawl.
 *   map: { '<doi>': Set<sectionKey> } for every DOI seen this crawl.
 */
export async function crawlConcepts(fetchPage, { afterYear = null, log = () => {} } = {}) {
  const map = new Map();
  const counts = {};
  let pagesFetched = 0;
  for (const sec of PNAS_SECTIONS) {
    let page = 0, totalSeen = 0, declared = null;
    for (; page < MAX_PAGES_PER_CONCEPT; page++) {
      const url = 'https://www.pnas.org/action/doSearch?SeriesKey=pnas'
        + `&ConceptID=${sec.concept}&startPage=${page}&pageSize=${PAGE_SIZE}`
        + (afterYear ? `&AfterYear=${afterYear}&BeforeYear=${new Date().getFullYear() + 1}` : '');
      const { status, body } = await fetchPage(url);
      pagesFetched++;
      if (isChallenged(body, status)) {
        log(`  ${sec.name}: challenged/blocked (HTTP ${status}) on page ${page} — aborting crawl`);
        return { ok: false, challenged: true, map, counts, pagesFetched };
      }
      if (status !== 200) {
        log(`  ${sec.name}: HTTP ${status} on page ${page} — stopping this concept`);
        break;
      }
      if (declared === null) {
        declared = extractResultCount(body);
        log(`  ${sec.name}: ~${declared ?? '?'} results${afterYear ? ` after ${afterYear}` : ''}`);
      }
      const dois = extractDois(body);
      let fresh = 0;
      for (const d of dois) {
        let set = map.get(d);
        if (!set) { set = new Set(); map.set(d, set); }
        if (!set.has(sec.key)) { set.add(sec.key); fresh++; }
      }
      totalSeen += dois.length;
      if (!dois.length) break;                       // ran off the end
      if (declared !== null && totalSeen >= declared) break;
      await sleep(DELAY_MS);
    }
    counts[sec.key] = totalSeen;
    log(`  ${sec.name}: collected ${totalSeen} DOIs over ${page + 1} page(s)`);
  }
  return { ok: true, challenged: false, map, counts, pagesFetched };
}

/* Merge a crawl result into the persisted cache shape:
 *   { updated, full, counts, map: { doi: [sectionKeys…] } }        */
export function mergeIntoCache(cache, crawlMap, { pullDate, full = false }) {
  const out = cache && cache.map ? cache : { map: {} };
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
  return { updated: pullDate, full: full || !!(cache && cache.full), counts, map: sorted };
}
