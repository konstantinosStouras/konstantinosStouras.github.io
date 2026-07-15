/*
 * build-citedby.mjs — the lit "citing references" (forward-citation) harvester.
 * ===========================================================================
 * The COMPANION to build-refs.mjs. Where build-refs.mjs crawls the references a
 * paper CITES (its backward out-edges), this crawls the works that CITE each
 * catalog paper (its forward in-edges) — i.e. "who cites me". Two purposes:
 *
 *   1. It completes the citation graph in BOTH directions: every catalog paper
 *      gains a set of citing works (its forward citations).
 *   2. It SHARPENS the disruption index D (Wu, Wang & Evans 2019) computed by
 *      build-disruption.mjs. The CD index needs, for a focal paper f, the set
 *      of works that cite f (group i / j) and the works that cite f's
 *      references (group j / k). Today build-disruption approximates those by
 *      INVERTING the in-catalog out-edges — so it only "sees" citers that are
 *      themselves in the ~260k-paper catalog. That biases D downward (same-field
 *      catalog citers are more likely to co-cite f's roots, inflating group j).
 *      Harvesting the GLOBAL citer set here removes that bias: group i / j are
 *      counted over every citing work, not just the catalog's. It stays an
 *      approximation of the paper's full-network D (f's OUT-of-catalog references
 *      still contribute no group-k/j citers), but a markedly sharper one that
 *      keeps improving as the reference graph and this forward graph fill in.
 *
 * DATA SOURCE. OpenAlex only — the one open API that enumerates a work's
 * citing works completely and for free:
 *   works?filter=cites:<OpenAlex-id>&select=id,doi&per-page=200&cursor=*
 * paginated to the end (or to a generous per-paper cap). We need each focal
 * paper's OpenAlex id to run this, which build-refs.mjs already caches for free
 * in _oaid.json (each OpenAlex work returns its own id + doi). So this harvester
 * PIGGYBACKS on that map: a paper without a known OpenAlex id yet is simply
 * skipped this run and picked up once build-refs has resolved its id.
 *
 * FRESHNESS. Unlike a paper's own reference list (frozen once published), a
 * paper's forward citations GROW over time — new work keeps citing it. So an
 * entry is refreshed on a ROLLING cadence: never-fetched first, then the
 * stalest, entries older than CB_TTL_DAYS re-checked, a version bump re-sweeps
 * everyone. Same priority tiers as build-refs (MS/M&SOM/POM/PNAS first, then
 * UTD24 ∪ FT50, then the rest).
 *
 * OUTPUT (lit/data-refs/, sharing build-refs's directory and concurrency group):
 *   _citedby-cache.json  crawl state, NOT served by Jekyll (underscore): per
 *                        catalog DOI, { c:[citer OpenAlex ids], n:<count>,
 *                        t:"date", v:<ver>, cap?:1 }. build-disruption reads it.
 *   citedby-meta.json    tiny served run summary (coverage stats).
 * Nothing large is served: the raw global citer sets exist only to COMPUTE D,
 * they are not shipped to the page. Should _citedby-cache.json approach the 1 GB
 * Pages limit it lifts out to a dedicated repo exactly like data-refs/ (see
 * _HOW-IT-WORKS.md, "Migration").
 *
 * HOW IT STAYS POLITE. Every page is paced (CB_OA_PACE_MS), honours Retry-After,
 * backs off on 429/403, and each run is bounded (CB_MAX_PAPERS, CB_BUDGET_MS,
 * CB_MAX_CITERS per paper) and checkpoints as it goes — built to fill in over
 * weeks from .github/workflows/lit-citedby-backfill.yml, never in a burst.
 *
 * NOTE: this build environment's egress blocks the scholarly APIs (OpenAlex
 * returns 403 for cloud IPs), so real harvesting only happens on the GitHub
 * Actions runners. Offline smoke test (no network, uses ./mock-cb/ fixtures):
 *   node citedby-selftest.mjs
 *
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normDoi, shortOaid, tierOf, loadCatalog } from './build-refs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = process.env.CB_MOCK === '1';
const MOCK_DIR = join(__dirname, process.env.CB_MOCK_DIR || 'mock-cb');

// Output dir — shares build-refs's data-refs/ (same concurrency group). A mock
// run writes to a scratch dir so a smoke test never touches the live cache.
const DATA_DIR = process.env.CB_DATA_DIR
  || (MOCK ? resolve(__dirname, '_cb-mock-out') : resolve(__dirname, '..', 'data-refs'));

// The catalogs to enumerate papers from (mirrors build-refs's default).
const CATALOG_DIRS = (process.env.CB_CATALOG_DIRS || process.env.REFS_CATALOG_DIRS
  || [resolve(__dirname, '..', 'data'), resolve(__dirname, '..', 'data-ft50')].join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const MAILTO = process.env.CB_MAILTO || 'kstouras+litcitedby@gmail.com'; // distinct OpenAlex quota identity
const PULL_DATE = process.env.CB_PULL_DATE || new Date().toISOString().slice(0, 10);

// Version. Bump to re-sweep every paper (e.g. if the source set or extraction
// changes). v1: OpenAlex cites: enumeration.
export const CB_VER = 1;

// ── Tunables (every default errs gentle — this is a weeks-long backfill) ─────
const OA_PACE_MS = parseInt(process.env.CB_OA_PACE_MS || '300', 10);       // between citation pages
const MAX_PAPERS = parseInt(process.env.CB_MAX_PAPERS || '3000', 10);      // papers per run (resumable)
const BUDGET_MS = parseInt(process.env.CB_BUDGET_MS || String(40 * 60 * 1000), 10); // wall-clock ceiling
const MAX_CITERS = parseInt(process.env.CB_MAX_CITERS || '3000', 10);      // cap citer ids stored per paper
const TTL_DAYS = parseInt(process.env.CB_TTL_DAYS || '30', 10);            // refresh entries older than this
const MAX_THROTTLE = 6;            // consecutive OpenAlex failures before giving the run up

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// ── Extractor (pure, unit-tested): OpenAlex results → short citer ids ────────
export function extractCiters(results) {
  const out = [], seen = new Set();
  for (const w of results || []) {
    const id = shortOaid(w && w.id);
    if (!id || seen.has(id)) continue;
    seen.add(id); out.push(id);
  }
  return out;
}

// ── Crawl order: rolling refresh, priority tiers, resumable ──────────────────
// Only papers with a known OpenAlex id are eligible (needed to query cites:).
// Within a tier: never-fetched first, then stalest, then newest year, then DOI.
// A paper fetched at the current version AND fresher than the TTL is skipped.
export function orderCitedby(papers, cache, oaidMap, limit, nowTs, ttlDays = TTL_DAYS, ver = CB_VER) {
  const ttlMs = ttlDays * 86400000;
  const eligible = [];
  for (const p of papers) {
    const oaid = oaidMap[p.doi];
    if (!oaid) continue;                       // no OpenAlex id yet → can't query cites:
    const c = cache[p.doi];
    let last = 0;
    if (c && (c.v || 0) >= ver) {
      last = Date.parse((c.t || '') + 'T00:00:00Z') || 0;
      if (last && (nowTs - last) <= ttlMs) continue; // fresh at the current version → skip
    }
    eligible.push({ p, oaid, neverFetched: !c, last });
  }
  eligible.sort((a, b) =>
    (a.p.tier - b.p.tier) ||                               // tier 0 first
    (Number(b.neverFetched) - Number(a.neverFetched)) ||   // never-fetched before refreshes
    (a.last - b.last) ||                                   // then stalest first
    (b.p.year - a.p.year) ||                               // then newest year first
    (a.p.doi < b.p.doi ? -1 : a.p.doi > b.p.doi ? 1 : 0));
  return eligible.slice(0, limit).map(x => ({ doi: x.p.doi, oaid: x.oaid, jkey: x.p.jkey }));
}

// ── Forward disruption D (pure, unit-tested) ─────────────────────────────────
// The CD index for a focal paper, computed from GLOBAL citer sets instead of the
// catalog-only inversion. Imported by build-disruption.mjs so its one definition
// is shared and tested here.
//   focalOaid  — the focal paper's OpenAlex id (to exclude it from group k, since
//                the focal itself cites its own references and thus appears among
//                its references' citers).
//   citingF    — Set of OpenAlex ids of works that cite the focal (its group i∪j).
//   refs       — iterable of the focal's in-catalog reference DOIs (out-edges).
//   fwd        — Map(DOI → Set(citer OpenAlex ids)) of harvested forward citations.
// Returns { d, ni, nj, nk } or null when undefined (no forward citations / empty
// neighbourhood). Same n_i/n_j/n_k semantics and sign convention as build-refs's
// reproduction: D>0 disrupts, D<0 develops.
export function forwardDisruption(focalOaid, citingF, refs, fwd) {
  if (!citingF || !citingF.size) return null;
  const citingRefs = new Set();
  for (const r of refs || []) {
    const s = fwd.get(r);
    if (!s) continue;
    for (const p of s) citingRefs.add(p);
  }
  if (focalOaid) citingRefs.delete(focalOaid); // focal cites its own refs; never count it
  let ni = 0, nj = 0;
  for (const p of citingF) { if (citingRefs.has(p)) nj++; else ni++; }
  let nk = 0;
  for (const p of citingRefs) if (!citingF.has(p)) nk++;
  const denom = ni + nj + nk;
  if (!denom) return null;
  return { d: (ni - nj) / denom, ni, nj, nk };
}

// ── Network (paced, backing off, mockable) ───────────────────────────────────
async function cbGet(url) {
  if (MOCK) return mockGet(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-citedby/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
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

// Enumerate every work that cites `oaid`, paginating with OpenAlex's cursor.
// Returns { citers:[short ids], count, capped, complete:true } once the full
// list (or the cap) is in hand, or null if OpenAlex stayed unavailable / the
// deadline hit mid-pagination — in which case the paper is left unstamped so a
// later run retries it cleanly (a partial page set is never committed).
async function fetchCiters(oaid, deadline) {
  const citers = [], seen = new Set();
  let cursor = '*', count = null, fails = 0;
  while (cursor) {
    if (Date.now() > deadline) return null;
    const url = 'https://api.openalex.org/works?filter=cites:' + encodeURIComponent(oaid) +
      '&select=id,doi&per-page=200&cursor=' + encodeURIComponent(cursor) +
      '&mailto=' + encodeURIComponent(MAILTO);
    const r = await cbGet(url);
    if (!r.ok) {
      const throttle = r.status === 429 || r.status === 403;
      fails++;
      if ((throttle && r.retryAfter > 3600) || fails >= MAX_THROTTLE) return null;
      const wait = throttle ? Math.max(r.retryAfter * 1000, Math.min(5000 * 2 ** (fails - 1), 60000)) : 2000;
      if (Date.now() + wait > deadline) return null;
      console.log(`  openalex ${r.status || 'timeout'} — waiting ${Math.round(wait / 1000)}s (streak ${fails}/${MAX_THROTTLE})`);
      await sleep(wait);
      continue; // retry the same cursor
    }
    fails = 0;
    const j = r.json || {};
    if (count === null) count = (j.meta && typeof j.meta.count === 'number') ? j.meta.count : null;
    for (const id of extractCiters(j.results)) { if (!seen.has(id)) { seen.add(id); citers.push(id); } }
    if (citers.length >= MAX_CITERS) return { citers: citers.slice(0, MAX_CITERS), count: count ?? citers.length, capped: true, complete: true };
    cursor = (j.meta && j.meta.next_cursor) || null;
    if (cursor) await sleep(OA_PACE_MS);
  }
  return { citers, count: count ?? citers.length, capped: false, complete: true };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`lit forward-citation harvest (v${CB_VER}): ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}; out=${DATA_DIR}`);
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + BUDGET_MS;

  // 1. Catalog + the caches (crawl state + the doi→OpenAlex-id map built by build-refs).
  const { dbByDoi, papers } = await loadCatalog(CATALOG_DIRS, { log: true });
  const cache = await loadJson(join(DATA_DIR, '_citedby-cache.json'), {});
  const oaidMap = await loadJson(join(DATA_DIR, '_oaid.json'), {});
  const withOaid = papers.filter(p => oaidMap[p.doi]).length;
  console.log(`catalog: ${papers.length} papers (${withOaid} with an OpenAlex id); ` +
    `cache: ${Object.keys(cache).length} papers; oaids known: ${Object.keys(oaidMap).length}`);
  if (!withOaid) console.log('  (no OpenAlex ids yet — run build-refs.mjs first to populate _oaid.json.)');

  // 2. This run's slice (rolling refresh + priority order).
  const nowTs = Date.parse(PULL_DATE + 'T00:00:00Z') || Date.now();
  const slice = orderCitedby(papers, cache, oaidMap, MAX_PAPERS, nowTs);
  console.log(`processing up to ${slice.length} paper(s) this run`);

  const checkpoint = async () => {
    await writeFile(join(DATA_DIR, '_citedby-cache.json'), JSON.stringify(cache), 'utf8');
  };

  // 3. Harvest each paper's citing works.
  let done = 0, stopped = false;
  for (const p of slice) {
    if (Date.now() > deadline) { console.log('  time budget reached — stopping (resumes next run).'); stopped = true; break; }
    const res = await fetchCiters(p.oaid, deadline);
    if (res === null) { console.log('  openalex unavailable — stopping (resumes next run).'); stopped = true; break; }
    const e = cache[p.doi] || {};
    e.c = res.citers;
    e.n = res.count;
    e.t = PULL_DATE;
    e.v = CB_VER;
    if (res.capped) e.cap = 1; else delete e.cap;
    cache[p.doi] = e;
    done++;
    if (done % 50 === 0) { await checkpoint(); console.log(`  …${done} papers refreshed this run`); }
  }
  await checkpoint();

  // 4. Coverage stats → the tiny served meta.
  const oaidToDoi = {};
  for (const [doi, oaid] of Object.entries(oaidMap)) if (oaid && dbByDoi.has(doi)) oaidToDoi[oaid] = doi;
  let fetched = 0, totalCiters = 0, inCatCiters = 0, capped = 0;
  for (const [doi, e] of Object.entries(cache)) {
    if (!dbByDoi.has(doi)) continue;           // paper no longer in the catalog
    if ((e.v || 0) >= CB_VER) fetched++;
    if (e.cap) capped++;
    for (const wid of e.c || []) { totalCiters++; if (oaidToDoi[wid]) inCatCiters++; }
  }
  const meta = {
    lastPull: PULL_DATE, ver: CB_VER,
    papersWithCiters: fetched, catalog: papers.length, withOaid,
    citersHarvested: totalCiters, inCatalogCiters: inCatCiters, cappedPapers: capped,
  };
  await writeFile(join(DATA_DIR, 'citedby-meta.json'), JSON.stringify(meta), 'utf8');

  console.log(`done: forward citations for ${fetched} paper(s); ${totalCiters} citer links ` +
    `(${inCatCiters} in-catalog); ${capped} paper(s) capped at ${MAX_CITERS}` +
    `${stopped ? ' (run stopped early — resumes next schedule)' : ''}.`);
}

// ── Mock network (offline smoke test) ────────────────────────────────────────
// OpenAlex  works?filter=cites:<oaid>  ->  mock-cb/cb-<oaid>.json
//   { "results": [{ "id": "...", "doi": "..." }, …], "meta": { "count": N, "next_cursor": null } }
async function mockGet(rawUrl) {
  const url = decodeURIComponent(rawUrl);
  const m = url.match(/filter=cites:(W\d+)/i);
  const oaid = m ? m[1] : '';
  const j = await loadJson(join(MOCK_DIR, `cb-${oaid}.json`), null);
  if (!j) return { ok: true, status: 200, json: { results: [], meta: { count: 0, next_cursor: null } } };
  return { ok: true, status: 200, json: j };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
