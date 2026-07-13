/*
 * build-refs.mjs — the fun/lit "citation graph" pipeline.
 * ===========================================================================
 * For every paper already listed in "The Lit" (stouras.com/fun/lit/), this
 * pipeline extracts the references it CITES that ALSO belong to the catalog —
 * i.e. the intra-catalog out-edges of the citation graph. The result is a
 * static JSON dataset in fun/lit/data-refs/, which the page merges at runtime
 * (a "Cited references in this catalog" toggle on each paper card; see
 * index.html). No server, no database.
 *
 * WHY A SEPARATE DATASET.  A per-paper reference list, across a quarter of a
 * million papers, is a large and ever-growing corpus. Keeping it in its own
 * data-refs/ directory — structured like a satellite shard — keeps the main
 * dataset lean and lets this graph be lifted out into a dedicated
 * `lit-data-refs` GitHub-Pages repo the day it approaches the 1 GB Pages
 * limit, by moving the folder and flipping ONE constant (REFS_DATA_BASE in
 * index.html) from './data-refs/' to '/lit-data-refs/data/'. See
 * _HOW-IT-WORKS.md.
 *
 * DATA SOURCE.  Crossref. For each paper (identified by DOI) we fetch
 * `works?filter=doi:<doi>&select=DOI,reference` and read the DOIs the
 * publisher deposited in the reference list (reference[].DOI). A published
 * paper's reference list never changes, so once a paper is fetched it is
 * FROZEN and never re-fetched (like the pre-print feature's found links). The
 * raw cited-DOI list is cached in data-refs/_refs-cache.json; every build then
 * intersects it, offline, with the CURRENT catalog — so as the catalog grows,
 * new in-catalog edges appear for free without any re-fetching.
 *
 * HOW IT STAYS POLITE AND SLOW (built to fill over WEEKS, not minutes).
 * Crossref is the only API this pipeline calls. Every request is paced
 * (REFS_PACE_MS, default 400 ms — well under the polite-pool ceiling with a
 * mailto), honours Retry-After, and backs off exponentially on 429/5xx; each
 * scheduled run fetches only a small, bounded slice of papers
 * (REFS_MAX_PAPERS) and checkpoints as it goes, so the workflow
 * (.github/workflows/lit-references-backfill.yml) grows the graph gently
 * across many runs over weeks. A paper with a cache entry is "done"; a run
 * always resumes on the not-yet-fetched papers.
 *
 * PAPER PRIORITY (per the site owner): Management Science, M&SOM, POM and PNAS
 * (all years) are fetched FIRST, then the UTD24 and FT50 journals (newest
 * years first), then everyone else. See tierOf() / orderPapers().
 *
 * Offline smoke test (no network, uses ./mock/ fixtures):
 *   REFS_MOCK=1 node build-refs.mjs        # writes ./_mock-out/
 *   node selftest.mjs                       # asserts on the mock output + helpers
 *
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = process.env.REFS_MOCK === '1';
const MOCK_DIR = join(__dirname, 'mock');

// Output dir. Mock runs write to a scratch dir so a smoke test can never
// pollute the live dataset (in particular its _refs-cache.json crawl cursor).
const DATA_DIR = process.env.REFS_DATA_DIR
  || (MOCK ? resolve(__dirname, '_mock-out') : resolve(__dirname, '..', 'data-refs'));

// The catalogs to (a) enumerate papers from and (b) intersect references
// against. The native eight-source catalog and the FT50 catalog both live in
// this repo; the ABS satellite shards live in sibling repos not checked out
// here, so an edge into an ABS-shard-only paper is not yet resolved — it
// appears automatically once those dirs are added to REFS_CATALOG_DIRS (the
// raw reference lists are cached, so no re-fetch is needed).
const CATALOG_DIRS = (process.env.REFS_CATALOG_DIRS
  || [resolve(__dirname, '..', 'data'), resolve(__dirname, '..', 'data-ft50')].join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const MAILTO = process.env.REFS_MAILTO || 'kstouras+litrefs@gmail.com'; // distinct Crossref/OpenAlex quota identity
const PULL_DATE = process.env.REFS_PULL_DATE || new Date().toISOString().slice(0, 10);

// The cache version. A paper whose cache entry was written under an OLDER
// version — AND that turned up no in-catalog references — becomes eligible
// again, so a later coverage expansion (e.g. adding an OpenAlex reference leg)
// re-sweeps the papers that came up empty. A paper WITH references is frozen
// forever (a published reference list never changes). Bump when the fetcher's
// source/coverage expands.
export const RF_VER = 1;

// ── Tunables (every default errs gentle — this is a weeks-long backfill) ─────
const PACE_MS = parseInt(process.env.REFS_PACE_MS || '400', 10);        // between Crossref calls
const MAX_PAPERS = parseInt(process.env.REFS_MAX_PAPERS || '4000', 10); // papers per run
const BUDGET_MS = parseInt(process.env.REFS_BUDGET_MS || String(40 * 60 * 1000), 10); // wall-clock ceiling
const MAX_REFS = parseInt(process.env.REFS_MAX_REFS || '400', 10);      // cap raw cited DOIs per paper
const MAX_THROTTLE = 8;            // consecutive Crossref waits before giving the run up

// ── Journal-type membership (per the owner's priority order) ─────────────────
// KEEP IN SYNC with the TIER0 / UTD24_KEYS / FT50_KEYS constants in
// index.html (mirrors the same "byte-for-byte" discipline as
// build-analytics.mjs). Tier 0 is fetched first (all years), then tier 1
// (UTD24 ∪ FT50, newest years first), then tier 2 (everyone else).
const TIER0_KEYS = new Set(['ms', 'msom', 'pom', 'pnas']);
const UTD24_KEYS = new Set(['tar', 'jae', 'jar', 'jof', 'jfe', 'rfs', 'isre', 'ijoc',
  'misq', 'jcr', 'jm', 'jmr', 'mksc', 'ms', 'opre', 'joom', 'msom', 'pom', 'amj', 'amr',
  'asq', 'orsc', 'jibs', 'smj']);
const FT50_KEYS = new Set(['aman', 'amj', 'amr', 'tar', 'aos', 'asq', 'aer', 'asr',
  'car', 'ecta', 'etp', 'hbr', 'hrm', 'isre', 'jae', 'jar', 'jap', 'jbv', 'jcp', 'jcr',
  'jof', 'jfqa', 'jfe', 'jibs', 'jom', 'jmis', 'jms', 'jm', 'jmr', 'joom', 'jpe', 'jams',
  'ms', 'msom', 'mksc', 'misq', 'smr', 'opre', 'orsc', 'obhdp', 'pom', 'psci', 'qje',
  'respol', 'rast', 'restud', 'rof', 'rfs', 'sej', 'smj']);

export function tierOf(jkey) {
  if (TIER0_KEYS.has(jkey)) return 0;
  if (UTD24_KEYS.has(jkey) || FT50_KEYS.has(jkey)) return 1;
  return 2;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// Normalise a DOI to the bare, lowercased form used as the graph's key.
export function normDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
}

// ── The catalog: DOI → {title, jkey, year} + the ordered paper list ──────────
// Reads each catalog dir's sources.json + papers-*.json once, keeping only the
// few fields we need (DOI, title, journal key, year). Native (first dir) wins
// on a DOI seen in two dirs, mirroring the page's native-over-catalog merge.
export async function loadCatalog(dirs, opts = {}) {
  const dbByDoi = new Map();   // doi -> {t:title, j:jkey, y:year}
  const papers = [];           // {doi, jkey, year, tier} — crawl candidates
  for (const dir of dirs) {
    const sources = await loadJson(join(dir, 'sources.json'), []);
    if (!Array.isArray(sources)) continue;
    for (const s of sources) {
      const rows = await loadJson(join(dir, s.file || `papers-${s.key}.json`), []);
      if (!Array.isArray(rows)) continue;
      const jkey = s.key;
      for (const p of rows) {
        const doi = normDoi(p.DOI);
        if (!doi || dbByDoi.has(doi)) continue; // no DOI → can't fetch/intersect; first dir wins
        const title = String(p.Title || '').replace(/\s+/g, ' ').trim();
        const year = String(p.Year || '');
        dbByDoi.set(doi, { t: title, j: jkey, y: year });
        papers.push({ doi, jkey, year: parseInt(year, 10) || 0, tier: tierOf(jkey) });
      }
      if (opts.log) console.log(`  catalog: ${dir.split('/').pop()}/${s.key}: ${rows.length} papers`);
    }
  }
  return { dbByDoi, papers };
}

// Crawl order: by priority tier (0 → 1 → 2); within a tier, papers never
// fetched before come ahead of empty-result re-checks, then newest year first,
// then DOI for a stable order. Returns at most `limit` papers to fetch.
export function orderPapers(papers, cache, limit) {
  const eligible = [];
  for (const p of papers) {
    const c = cache[p.doi];
    // Frozen: a paper with references cached is never re-fetched. An empty
    // result is re-checked only when a newer cache version exists.
    if (c && (c.r && c.r.length || (c.v || 0) >= RF_VER)) continue;
    eligible.push({ p, neverFetched: !c });
  }
  eligible.sort((a, b) =>
    (a.p.tier - b.p.tier) ||                               // tier 0 first
    (Number(b.neverFetched) - Number(a.neverFetched)) ||   // never-fetched before re-checks
    (b.p.year - a.p.year) ||                               // then newest year first
    (a.p.doi < b.p.doi ? -1 : a.p.doi > b.p.doi ? 1 : 0));
  return eligible.slice(0, limit).map(x => x.p);
}

// ── Crossref access (paced, backing off, mockable) ──────────────────────────
let throttleStreak = 0;
async function crGet(url) {
  if (MOCK) return mockCrGet(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-refs/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
    if (!res.ok) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      return { ok: false, status: res.status, retryAfter: isNaN(ra) ? 0 : ra };
    }
    return { ok: true, status: 200, json: await res.json() };
  } catch {
    return { ok: false, status: 0, retryAfter: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// One Crossref GET with the polite pacing + patient backoff the weeks-long
// backfill relies on. Returns the parsed body, or null when Crossref stays
// unavailable long enough that the run should stop and resume next schedule.
async function crGetPatient(url, deadline) {
  for (;;) {
    if (Date.now() > deadline) return null;
    const r = await crGet(url);
    if (r.ok) { throttleStreak = 0; await sleep(PACE_MS); return r.json; }
    // A hard 404 is a concluded "Crossref doesn't have this DOI" — not a
    // throttle; treat it as an empty (no references) result, not an outage.
    if (r.status === 404) { throttleStreak = 0; await sleep(PACE_MS); return { message: {} }; }
    throttleStreak++;
    if (throttleStreak > MAX_THROTTLE) return null;
    const backoff = Math.min(r.retryAfter * 1000 || 0, 600000) || Math.min(30000 * 2 ** (throttleStreak - 1), 600000);
    console.log(`  crossref ${r.status || 'timeout'} — waiting ${Math.round(backoff / 1000)}s (streak ${throttleStreak}/${MAX_THROTTLE})`);
    await sleep(backoff);
  }
}

// Pull the deposited cited-DOIs out of a Crossref work message. Pure (no
// network) → unit-tested. Deduped, lowercased, capped at MAX_REFS. References
// with no deposited DOI are simply absent (we can only match DOI-to-DOI).
export function extractRefDois(message) {
  const out = [];
  const seen = new Set();
  const refs = (message && message.reference) || [];
  for (const r of refs) {
    const d = normDoi(r && r.DOI);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

// Fetch one paper's reference DOIs from Crossref. Returns an array (possibly
// empty) on success, or null when Crossref went out (leave the paper for the
// next run instead of recording an empty result).
async function fetchReferences(doi, deadline) {
  const url = 'https://api.crossref.org/works?filter=doi:' + encodeURIComponent(doi) +
    '&select=DOI,reference&rows=1&mailto=' + encodeURIComponent(MAILTO);
  const body = await crGetPatient(url, deadline);
  if (body === null) return null;
  // The filter route returns message.items[]; the /works/{doi} route returns
  // message directly. Tolerate both (the mock uses items).
  const msg = body.message || {};
  const item = Array.isArray(msg.items) ? (msg.items[0] || {}) : msg;
  return extractRefDois(item);
}

// ── Apply: intersect the cached raw references with the current catalog ──────
// Rebuilt from scratch every run (cheap, no network), so catalog growth and
// newly-added dirs surface new edges for free. Produces:
//   shards[jkey] = { <citingDoi>: [<citedDoi>, …] }   — only papers with ≥1 edge
//   index        = { <citedDoi>: [title, jkey, year] } — every edge target
export function buildOutputs(cache, dbByDoi) {
  const shards = {};
  const indexKeys = new Set();
  let citingWithEdges = 0, edges = 0;
  for (const [citingDoi, entry] of Object.entries(cache)) {
    const meta = dbByDoi.get(citingDoi);
    if (!meta) continue;                    // citing paper no longer in the catalog
    const inDb = [];
    for (const cd of entry.r || []) {
      if (cd !== citingDoi && dbByDoi.has(cd)) { inDb.push(cd); indexKeys.add(cd); }
    }
    if (!inDb.length) continue;
    (shards[meta.j] || (shards[meta.j] = {}))[citingDoi] = inDb;
    citingWithEdges++; edges += inDb.length;
  }
  const index = {};
  for (const cd of indexKeys) {
    const m = dbByDoi.get(cd);
    index[cd] = [m.t, m.j, m.y];
  }
  return { shards, index, totals: { citingWithEdges, edges, cited: indexKeys.size } };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`lit citation-graph build: ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}; out=${DATA_DIR}`);
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + BUDGET_MS;

  // 1. Catalog: DOI → meta + the ordered paper list.
  const { dbByDoi, papers } = await loadCatalog(CATALOG_DIRS, { log: true });
  console.log(`catalog: ${papers.length} papers with a DOI (${dbByDoi.size} distinct)`);

  // 2. The raw-references cache (the crawl cursor).
  const cache = await loadJson(join(DATA_DIR, '_refs-cache.json'), {});
  const fetched = Object.keys(cache).length;
  console.log(`cache: ${fetched} papers fetched so far`);

  // 3. This run's slice (priority + resumable order).
  const slice = orderPapers(papers, cache, MAX_PAPERS);
  console.log(`fetching references for up to ${slice.length} paper(s) this run (of ${papers.length})`);
  let done = 0, newEdges = 0, stopped = false;

  for (const p of slice) {
    if (Date.now() > deadline) { console.log('  time budget reached — stopping (resumes next run).'); stopped = true; break; }
    const refs = await fetchReferences(p.doi, deadline);
    if (refs === null) { console.log('  crossref unavailable — stopping (resumes next run).'); stopped = true; break; }
    // Count how many resolve into the catalog right now (for the run log only).
    for (const cd of refs) if (cd !== p.doi && dbByDoi.has(cd)) newEdges++;
    cache[p.doi] = { r: refs, t: PULL_DATE, v: RF_VER };
    done++;
    if (done % 100 === 0) { await writeCache(cache); console.log(`  …${done} papers fetched, ${newEdges} in-catalog edges seen`); }
  }

  // 4. Intersect the whole cache with the catalog and write the served files.
  const { shards, index, totals } = buildOutputs(cache, dbByDoi);

  const shardMeta = {};
  for (const jkey of Object.keys(shards).sort()) {
    const rows = shards[jkey];
    const file = `refs-${jkey}.json`;
    await writeJson(file, rows);
    const es = Object.values(rows).reduce((n, a) => n + a.length, 0);
    shardMeta[jkey] = { file, papers: Object.keys(rows).length, edges: es };
  }
  await writeJson('refs-index.json', index);

  const manifest = {
    ver: RF_VER,
    generated: PULL_DATE,
    index: { file: 'refs-index.json', count: Object.keys(index).length },
    shards: shardMeta,
    totals: {
      citingPapers: totals.citingWithEdges,
      edges: totals.edges,
      citedPapers: totals.cited,
      fetched: Object.keys(cache).length,
      catalog: papers.length,
    },
    source: 'Crossref deposited reference lists, intersected with this catalog',
  };
  await writeJson('manifest.json', manifest);
  await writeJson('meta.json', {
    lastPull: PULL_DATE,
    citingPapers: totals.citingWithEdges,
    edges: totals.edges,
    fetched: Object.keys(cache).length,
    catalog: papers.length,
  });
  await writeCache(cache);

  console.log(`done: ${totals.edges} in-catalog edges from ${totals.citingWithEdges} papers ` +
    `across ${Object.keys(shardMeta).length} shard(s); ` +
    `${Object.keys(cache).length}/${papers.length} papers fetched` +
    `${stopped ? ' (run stopped early — resumes next schedule)' : ''}.`);
}

async function writeJson(name, data) {
  await writeFile(join(DATA_DIR, name), JSON.stringify(data), 'utf8');
}
async function writeCache(cache) { await writeJson('_refs-cache.json', cache); }

// ── Mock network (offline smoke test) ───────────────────────────────────────
// Routes Crossref works?filter=doi:<doi> URLs to ./mock/cr-<slug(doi)>.json,
// each holding one Crossref work message (with a `reference` array). A missing
// fixture returns an empty reference list.
async function mockCrGet(rawUrl) {
  const url = decodeURIComponent(rawUrl);
  const m = url.match(/filter=doi:([^&]+)/i);
  if (m) {
    const slug = m[1].replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const j = await loadJson(join(MOCK_DIR, `cr-${slug}.json`), null);
    return { ok: true, status: 200, json: { message: { items: [j || {}] } } };
  }
  return { ok: true, status: 200, json: { message: { items: [{}] } } };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
