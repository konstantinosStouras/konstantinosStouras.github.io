/*
 * build-refs.mjs — the lit "citation graph" pipeline.
 * ===========================================================================
 * For every paper already listed in "The Lit" (stouras.com/lit/), this
 * pipeline extracts the references it CITES that ALSO belong to the catalog —
 * i.e. the intra-catalog out-edges of the citation graph. The result is a
 * static JSON dataset in lit/data-refs/, which the page merges at runtime
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
 * DATA SOURCES (three, unioned for coverage — the more complete the better).
 * A published paper's reference list never changes, so once a paper has been
 * fetched at the current version it is FROZEN and never re-fetched; every
 * build then intersects its cached references, offline, with the CURRENT
 * catalog — so as the catalog grows, new in-catalog edges appear for free.
 *   1. Crossref (backbone) — `works?filter=doi:<doi>&select=DOI,reference`
 *      reads the DOIs the publisher deposited (reference[].DOI). One request
 *      per paper; the leg that stamps a paper "done".
 *   2. OpenAlex (accuracy) — `works?filter=doi:<50 dois>&select=id,doi,
 *      referenced_works` reads OpenAlex's own reference graph, which is
 *      generally MORE complete than publisher-deposited references (it parses
 *      PDFs and aggregates sources). referenced_works are OpenAlex IDs; we
 *      resolve only the ones that are OUR papers, using the doi→OpenAlex-id
 *      map (_oaid.json) built for free as we crawl (each work returns its own
 *      id + doi). Batched 50/call, general 100k/day quota.
 *   3. Semantic Scholar (bonus) — `graph/v1/paper/batch?fields=references.
 *      externalIds` reads S2's references (externalIds.DOI). Batched 500/POST,
 *      OPTIONAL: its anonymous pool 429s freely, so it drops out and the run
 *      carries on. Set REFS_S2=0 to disable.
 * The cache stores each source's RAW output (Crossref+S2 DOIs in `r`, OpenAlex
 * ids in `o`); intersection with the catalog happens at build time, so no
 * re-fetch is needed as the catalog grows or as _oaid.json fills in.
 *
 * HOW IT STAYS POLITE AND SLOW (built to fill over WEEKS, not minutes).
 * Every request is paced (REFS_PACE_MS, default 400 ms for Crossref; OpenAlex/
 * S2 are batched and lightly paced), honours Retry-After, and backs off on
 * 429/5xx; each scheduled run fetches only a small, bounded slice of papers
 * (REFS_MAX_PAPERS) and checkpoints as it goes, so the workflow
 * (.github/workflows/lit-references-backfill.yml) grows the graph gently
 * across many runs over weeks. A paper stamped at the current version is
 * "done"; a run always resumes on the not-yet-done papers.
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
// raw reference lists are cached, so no re-fetch is needed when you do).
const CATALOG_DIRS = (process.env.REFS_CATALOG_DIRS
  || [resolve(__dirname, '..', 'data'), resolve(__dirname, '..', 'data-ft50')].join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const MAILTO = process.env.REFS_MAILTO || 'kstouras+litrefs@gmail.com'; // distinct Crossref/OpenAlex quota identity
const PULL_DATE = process.env.REFS_PULL_DATE || new Date().toISOString().slice(0, 10);
const USE_S2 = process.env.REFS_S2 !== '0'; // Semantic Scholar bonus leg (default on)

// The cache version. A paper whose cache entry predates the current version is
// re-swept, so a coverage expansion (a new source, a wider matcher) re-checks
// every paper with the wider net. Bump when the source set or extraction
// changes. v2: added the OpenAlex referenced_works leg and the Semantic
// Scholar bonus leg alongside the Crossref backbone (v1 was Crossref only).
export const RF_VER = 2;

// ── Tunables (every default errs gentle — this is a weeks-long backfill) ─────
const PACE_MS = parseInt(process.env.REFS_PACE_MS || '400', 10);        // between Crossref calls
const OA_PACE_MS = parseInt(process.env.REFS_OA_PACE_MS || '200', 10);  // between OpenAlex batches
const MAX_PAPERS = parseInt(process.env.REFS_MAX_PAPERS || '4000', 10); // papers per run
const BUDGET_MS = parseInt(process.env.REFS_BUDGET_MS || String(40 * 60 * 1000), 10); // wall-clock ceiling
const MAX_REFS = parseInt(process.env.REFS_MAX_REFS || '500', 10);      // cap raw cited refs per paper per source
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

// The short OpenAlex work id ("W123…") from a full id URL or bare id.
export function shortOaid(id) {
  const m = String(id || '').match(/(W\d{4,})/);
  return m ? m[1] : '';
}

// Dedup + cap a union of string arrays (preserves first-seen order).
function unionCap(...arrs) {
  const out = [], seen = new Set();
  for (const a of arrs) for (const v of (a || [])) {
    if (!v || seen.has(v)) continue;
    seen.add(v); out.push(v);
    if (out.length >= MAX_REFS) return out;
  }
  return out;
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
        const authors = String(p.Authors || '').replace(/\s+/g, ' ').trim();
        dbByDoi.set(doi, { t: title, j: jkey, y: year, a: authors });
        papers.push({ doi, jkey, year: parseInt(year, 10) || 0, tier: tierOf(jkey) });
      }
      if (opts.log) console.log(`  catalog: ${dir.split('/').pop()}/${s.key}: ${rows.length} papers`);
    }
  }
  return { dbByDoi, papers };
}

// Crawl order: by priority tier (0 → 1 → 2); within a tier, papers never
// fetched before come ahead of re-checks, then newest year first, then DOI for
// a stable order. A paper stamped at the current version is done. Returns at
// most `limit` papers to (re)fetch this run.
export function orderPapers(papers, cache, limit) {
  const eligible = [];
  for (const p of papers) {
    const c = cache[p.doi];
    if (c && (c.v || 0) >= RF_VER) continue; // done at the current version → frozen
    eligible.push({ p, neverFetched: !c });
  }
  eligible.sort((a, b) =>
    (a.p.tier - b.p.tier) ||                               // tier 0 first
    (Number(b.neverFetched) - Number(a.neverFetched)) ||   // never-fetched before re-checks
    (b.p.year - a.p.year) ||                               // then newest year first
    (a.p.doi < b.p.doi ? -1 : a.p.doi > b.p.doi ? 1 : 0));
  return eligible.slice(0, limit).map(x => x.p);
}

// ── Network (paced, backing off, mockable) ──────────────────────────────────
async function httpGet(url) {
  if (MOCK) return mockGet(url);
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
let throttleStreak = 0;
async function crGetPatient(url, deadline) {
  for (;;) {
    if (Date.now() > deadline) return null;
    const r = await httpGet(url);
    if (r.ok) { throttleStreak = 0; await sleep(PACE_MS); return r.json; }
    if (r.status === 404) { throttleStreak = 0; await sleep(PACE_MS); return { message: {} }; } // concluded empty
    throttleStreak++;
    if (throttleStreak > MAX_THROTTLE) return null;
    const backoff = Math.min(r.retryAfter * 1000 || 0, 600000) || Math.min(30000 * 2 ** (throttleStreak - 1), 600000);
    console.log(`  crossref ${r.status || 'timeout'} — waiting ${Math.round(backoff / 1000)}s (streak ${throttleStreak}/${MAX_THROTTLE})`);
    await sleep(backoff);
  }
}

// ── Extractors (pure, unit-tested) ──────────────────────────────────────────
// Crossref: the deposited cited DOIs (reference[].DOI), deduped + lowercased.
export function extractRefDois(message) {
  const out = [], seen = new Set();
  for (const r of (message && message.reference) || []) {
    const d = normDoi(r && r.DOI);
    if (!d || seen.has(d)) continue;
    seen.add(d); out.push(d);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

// OpenAlex: the short ids of the works this one references.
export function extractOaRefs(work) {
  const out = [], seen = new Set();
  for (const id of (work && work.referenced_works) || []) {
    const w = shortOaid(id);
    if (!w || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

// Semantic Scholar: the DOIs of the works this one references.
export function extractS2Refs(paper) {
  const out = [], seen = new Set();
  for (const r of (paper && paper.references) || []) {
    const d = normDoi(r && r.externalIds && r.externalIds.DOI);
    if (!d || seen.has(d)) continue;
    seen.add(d); out.push(d);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

// ── Leg 2: OpenAlex referenced_works (batched 50) ───────────────────────────
// Fills cache[doi].o (referenced OpenAlex ids) + cache[doi].oa = RF_VER (leg
// attempted, so it isn't re-fetched next run), and records each returned work's
// own id into oaidMap (doi → OpenAlex id) — the map that lets buildOutputs
// resolve a reference id back to a catalog DOI. Best-effort: on a quota/throttle
// signal the leg drops out for the run (Crossref still stamps the paper).
async function refreshOpenAlexRefs(slice, cache, oaidMap, deadline, opts = {}) {
  const todo = slice.filter(p => ((cache[p.doi] || {}).oa || 0) < RF_VER);
  if (!todo.length) return 0;
  console.log(`  openalex: reading referenced_works for up to ${todo.length} paper(s)…`);
  let fails = 0, done = 0;
  for (let i = 0; i < todo.length; i += 50) {
    if (Date.now() > deadline) break;
    const batch = todo.slice(i, i + 50);
    const url = 'https://api.openalex.org/works?filter=doi:' +
      batch.map(p => encodeURIComponent(p.doi)).join('|') +
      '&per-page=50&select=id,doi,referenced_works&mailto=' + encodeURIComponent(MAILTO);
    const r = await httpGet(url);
    if (!r.ok) {
      const throttle = r.status === 429 || r.status === 403;
      fails++;
      if ((throttle && r.retryAfter > 3600) || fails >= 6) {
        console.log('  openalex: quota/throttle — dropping the OpenAlex leg for this run.');
        break;
      }
      const wait = throttle ? Math.max(r.retryAfter * 1000, Math.min(5000 * 2 ** (fails - 1), 60000)) : 2000;
      if (Date.now() + wait > deadline) break;
      await sleep(wait); i -= 50; continue; // retry this batch (bounded by fails)
    }
    fails = 0;
    const returned = new Set();
    for (const w of (r.json && r.json.results) || []) {
      const d = normDoi(w.doi);
      if (!d) continue;
      returned.add(d);
      const oaid = shortOaid(w.id);
      if (oaid) oaidMap[d] = oaid;
      const refs = extractOaRefs(w);
      const e = cache[d] || {};
      if (refs.length) e.o = unionCap(e.o, refs);
      e.oa = RF_VER;
      cache[d] = e;
    }
    // A DOI in a SUCCESSFUL batch that OpenAlex didn't return simply isn't in
    // OpenAlex — mark the leg attempted so we don't retry it forever.
    for (const p of batch) if (!returned.has(p.doi)) { const e = cache[p.doi] || {}; e.oa = RF_VER; cache[p.doi] = e; }
    done += batch.length;
    if (opts.checkpoint && (i / 50) % 20 === 19) await opts.checkpoint();
    await sleep(OA_PACE_MS);
  }
  console.log(`  openalex: attempted ${done} paper(s).`);
  return done;
}

// ── Leg 3: Semantic Scholar references (batched 500, optional) ──────────────
// Returns an in-memory map doi → [cited DOIs]; folded into `r` by the Crossref
// pass. Drops out entirely on throttle/failure (S2's anonymous pool 429s
// freely) — it is a pure bonus, never blocks a paper being stamped.
async function fetchS2Refs(slice, deadline) {
  if (!USE_S2) return {};
  const dois = slice.map(p => p.doi);
  const byDoi = {};
  for (let i = 0; i < dois.length; i += 500) {
    if (Date.now() > deadline) break;
    const batch = dois.slice(i, i + 500);
    let arr = null;
    if (MOCK) { arr = await mockS2(batch); }
    else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=references.externalIds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': `lit-refs/1.0 (mailto:${MAILTO})` },
          body: JSON.stringify({ ids: batch.map(d => 'DOI:' + d) }),
          signal: ctrl.signal,
        });
        if (res.ok) arr = await res.json();
      } catch { arr = null; } finally { clearTimeout(timer); }
    }
    if (!Array.isArray(arr)) { console.log('  s2: unavailable — skipping the Semantic Scholar leg this run.'); break; }
    arr.forEach((rec, k) => { const refs = extractS2Refs(rec); if (refs.length) byDoi[batch[k]] = refs; });
    await sleep(1500);
  }
  const n = Object.keys(byDoi).length;
  if (n) console.log(`  s2: references for ${n} paper(s).`);
  return byDoi;
}

// ── Leg 1: Crossref references (per paper) — the stamping backbone ───────────
async function fetchCrossrefRefs(doi, deadline) {
  const url = 'https://api.crossref.org/works?filter=doi:' + encodeURIComponent(doi) +
    '&select=DOI,reference&rows=1&mailto=' + encodeURIComponent(MAILTO);
  const body = await crGetPatient(url, deadline);
  if (body === null) return null;
  const msg = body.message || {};
  const item = Array.isArray(msg.items) ? (msg.items[0] || {}) : msg;
  return extractRefDois(item);
}

// ── Apply: intersect the cached references with the current catalog ──────────
// Rebuilt from scratch every run (cheap, no network), so catalog growth, newly
// added dirs and a fuller _oaid.json surface new edges for free. Produces:
//   shards[jkey] = { <citingDoi>: [<citedDoi>, …] }   — only papers with ≥1 edge
//   index        = { <citedDoi>: [title, jkey, year, authors?] } — every target
// Crossref/S2 DOIs (`r`) intersect the catalog directly; OpenAlex ids (`o`) are
// resolved to catalog DOIs via oaidMap (reverse-indexed to our papers only).
export function buildOutputs(cache, dbByDoi, oaidMap = {}) {
  const oaidToDoi = {};
  for (const [doi, oaid] of Object.entries(oaidMap)) if (oaid && dbByDoi.has(doi)) oaidToDoi[oaid] = doi;
  const shards = {};
  const counts = {};   // citingDoi -> N in-catalog references (tiny toggle-count companion)
  const indexKeys = new Set();
  let citingWithEdges = 0, edges = 0;
  for (const [citingDoi, entry] of Object.entries(cache)) {
    const meta = dbByDoi.get(citingDoi);
    if (!meta) continue;                    // citing paper no longer in the catalog
    const inDb = new Set();
    for (const cd of entry.r || []) if (cd !== citingDoi && dbByDoi.has(cd)) inDb.add(cd);
    for (const oaid of entry.o || []) { const cd = oaidToDoi[oaid]; if (cd && cd !== citingDoi) inDb.add(cd); }
    if (!inDb.size) continue;
    (shards[meta.j] || (shards[meta.j] = {}))[citingDoi] = [...inDb];
    counts[citingDoi] = inDb.size;
    citingWithEdges++; edges += inDb.size;
    for (const cd of inDb) indexKeys.add(cd);
  }
  const index = {};
  // [title, jkey, year, authors?] — authors is appended only when known, so
  // pre-authors data (a 3-tuple) still renders (the page reads meta[3] safely).
  for (const cd of indexKeys) { const m = dbByDoi.get(cd); index[cd] = m.a ? [m.t, m.j, m.y, m.a] : [m.t, m.j, m.y]; }
  return { shards, index, counts, totals: { citingWithEdges, edges, cited: indexKeys.size } };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`lit citation-graph build (v${RF_VER}): ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}; out=${DATA_DIR}`);
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + BUDGET_MS;

  // 1. Catalog: DOI → meta + the ordered paper list.
  const { dbByDoi, papers } = await loadCatalog(CATALOG_DIRS, { log: true });
  console.log(`catalog: ${papers.length} papers with a DOI (${dbByDoi.size} distinct)`);

  // 2. The caches (crawl cursor + the doi→OpenAlex-id map).
  const cache = await loadJson(join(DATA_DIR, '_refs-cache.json'), {});
  const oaidMap = await loadJson(join(DATA_DIR, '_oaid.json'), {});
  console.log(`cache: ${Object.keys(cache).length} papers seen; ${Object.keys(oaidMap).length} OpenAlex ids known`);

  // 3. This run's slice (priority + resumable order).
  const slice = orderPapers(papers, cache, MAX_PAPERS);
  console.log(`processing up to ${slice.length} paper(s) this run (of ${papers.length})`);

  const checkpoint = async () => {
    await writeFile(join(DATA_DIR, '_refs-cache.json'), JSON.stringify(cache), 'utf8');
    await writeFile(join(DATA_DIR, '_oaid.json'), JSON.stringify(oaidMap), 'utf8');
  };

  // 4. Leg 2 (OpenAlex, batched) — bounded to a fraction of the run so the
  //    Crossref backbone always gets time to stamp papers.
  const oaDeadline = Math.min(deadline, Date.now() + Math.min(BUDGET_MS * 0.4, 15 * 60 * 1000));
  await refreshOpenAlexRefs(slice, cache, oaidMap, oaDeadline, { checkpoint });
  await checkpoint();

  // 5. Leg 3 (Semantic Scholar, batched, optional) — in-memory, folded into r.
  const s2ByDoi = await fetchS2Refs(slice, Math.min(deadline, Date.now() + 5 * 60 * 1000));

  // 6. Leg 1 (Crossref, per paper) — the stamping backbone.
  let done = 0, stopped = false;
  for (const p of slice) {
    if (Date.now() > deadline) { console.log('  time budget reached — stopping (resumes next run).'); stopped = true; break; }
    const c = cache[p.doi];
    if (c && (c.v || 0) >= RF_VER) continue; // already stamped this version (e.g. re-run)
    const refs = await fetchCrossrefRefs(p.doi, deadline);
    if (refs === null) { console.log('  crossref unavailable — stopping (resumes next run).'); stopped = true; break; }
    const e = cache[p.doi] || {};
    e.r = unionCap(e.r, refs, s2ByDoi[p.doi]);
    e.t = PULL_DATE; e.v = RF_VER;
    cache[p.doi] = e;
    done++;
    if (done % 100 === 0) { await checkpoint(); console.log(`  …${done} papers stamped this run`); }
  }

  // 7. Intersect the whole cache with the catalog and write the served files.
  const { shards, index, counts, totals } = buildOutputs(cache, dbByDoi, oaidMap);
  const shardMeta = {};
  for (const jkey of Object.keys(shards).sort()) {
    const rows = shards[jkey];
    const file = `refs-${jkey}.json`;
    await writeFile(join(DATA_DIR, file), JSON.stringify(rows), 'utf8');
    const es = Object.values(rows).reduce((n, a) => n + a.length, 0);
    shardMeta[jkey] = { file, papers: Object.keys(rows).length, edges: es };
  }
  await writeFile(join(DATA_DIR, 'refs-index.json'), JSON.stringify(index), 'utf8');
  // The per-paper count companion — one int per citing paper, so a card shows
  // "(N)" on its toggle without downloading a shard.
  await writeFile(join(DATA_DIR, 'refs-counts.json'), JSON.stringify(counts), 'utf8');

  const fetched = Object.values(cache).filter(e => (e.v || 0) >= RF_VER).length;
  const manifest = {
    ver: RF_VER,
    generated: PULL_DATE,
    index: { file: 'refs-index.json', count: Object.keys(index).length },
    counts: { file: 'refs-counts.json', count: Object.keys(counts).length },
    shards: shardMeta,
    totals: { citingPapers: totals.citingWithEdges, edges: totals.edges, citedPapers: totals.cited, fetched, catalog: papers.length },
    sources: ['crossref', 'openalex', ...(USE_S2 ? ['semanticscholar'] : [])],
  };
  await writeFile(join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  await writeFile(join(DATA_DIR, 'meta.json'), JSON.stringify({
    lastPull: PULL_DATE, citingPapers: totals.citingWithEdges, edges: totals.edges, fetched, catalog: papers.length,
  }), 'utf8');
  await checkpoint();

  console.log(`done: ${totals.edges} in-catalog edges from ${totals.citingWithEdges} papers ` +
    `across ${Object.keys(shardMeta).length} shard(s); ` +
    `${fetched}/${papers.length} papers done` +
    `${stopped ? ' (run stopped early — resumes next schedule)' : ''}.`);
}

// ── Mock network (offline smoke test) ───────────────────────────────────────
// Crossref  works?filter=doi:<doi>          -> mock/cr-<slug>.json   (one message)
// OpenAlex  works?filter=doi:<d1>|<d2>...   -> mock/oa-<slug>.json    (one work each)
async function mockGet(rawUrl) {
  const url = decodeURIComponent(rawUrl);
  const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const m = url.match(/filter=doi:([^&]+)/i);
  const dois = m ? m[1].split('|') : [];
  if (/api\.openalex\.org/.test(url)) {
    const results = [];
    for (const d of dois) { const w = await loadJson(join(MOCK_DIR, `oa-${slug(d)}.json`), null); if (w) results.push(w); }
    return { ok: true, status: 200, json: { results } };
  }
  // Crossref
  const j = await loadJson(join(MOCK_DIR, `cr-${slug(dois[0] || '')}.json`), null);
  return { ok: true, status: 200, json: { message: { items: [j || {}] } } };
}
async function mockS2(batch) {
  const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const out = [];
  for (const d of batch) out.push(await loadJson(join(MOCK_DIR, `s2-${slug(d)}.json`), null));
  return out;
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
