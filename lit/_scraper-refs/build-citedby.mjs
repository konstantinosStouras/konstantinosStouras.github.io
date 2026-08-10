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
 * HIGH-VALUE OAID SEEDING + PRIORITY. Waiting on build-refs alone starves the
 * disruption index of exactly the papers that matter most: the CANON references
 * (Lazear–Rosen 1981, Moldovanu–Sela 2001, …) sit deep in build-refs's
 * newest-first queue, yet each appears in hundreds of focal papers' reference
 * lists — in forwardDisruption an unharvested reference contributes NOTHING to
 * the n_j/n_k pools ("looks identical to a zero-citer one"), deflating every
 * one of those focals' D. So each run first SEEDS _oaid.json itself for the
 * most-in-catalog-cited papers still missing an id (cited-counts.json ranks
 * them — the count of catalog papers citing a paper IS the number of focal D
 * computations its citer list unlocks): a bounded, batched
 * works?filter=doi:<50>&select=id,doi lookup (orderOaidSeeds/seedOaids;
 * CB_SEED_MAX per run, eligibility ≥ CB_HOT_MIN citers). A DOI a successful
 * batch didn't return isn't in OpenAlex — recorded as an EMPTY-STRING entry so
 * it is never re-queried (falsy, so every truthy consumer of _oaid.json treats
 * it exactly like absent, and build-refs overwrites it if the work ever
 * appears). The citer crawl below then puts the same high-value papers FIRST
 * (orderCitedby's hot bump: papers with ≥ CB_HOT_MIN in-catalog citers jump the
 * tier queue, most-cited first), so a just-seeded canon paper gets its citer
 * list in the same run instead of behind the whole rolling refresh. Hot papers
 * also crawl under a MUCH higher per-paper citer cap (CB_HOT_MAX_CITERS,
 * default 50k, vs CB_MAX_CITERS 3k) — the papers that hit the base cap are
 * precisely the canon classics, and a capped list feeds n_j/n_k truncated; a
 * paper already stamped capped under a smaller cap than applies to it now is
 * re-queued immediately (orderCitedby's recap rule), not after the TTL.
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
import { readChunkedJson, writeChunkedJson } from '../_scraper/_chunked-json.mjs';

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
// High-value oaid seeding + crawl priority (see the header): a paper with at
// least CB_HOT_MIN in-catalog citers is "hot" — eligible for the by-DOI oaid
// seeding when its id is missing, and bumped to the front of the citer crawl
// (most-cited first). CB_SEED_MAX bounds the ids resolved per run (50/call, so
// the default is ~30 cheap calls against OpenAlex's general 100k/day quota).
const HOT_MIN = parseInt(process.env.CB_HOT_MIN || '5', 10);
const SEED_MAX = parseInt(process.env.CB_SEED_MAX || '1500', 10);
// Hot papers also get a MUCH higher per-paper citer cap: the papers that hit
// MAX_CITERS are precisely the canon classics (Barney 1991, March 1991, …),
// and a capped citer list feeds forwardDisruption's n_j/n_k pools truncated —
// the same silent deflation the oaid seeding exists to fix. ~13 bytes/id, so
// even a 50k-citer monster costs ~650 KB of unserved cache. Never below
// MAX_CITERS (a lower value would re-truncate what the base cap already keeps).
const HOT_MAX_CITERS = Math.max(MAX_CITERS,
  parseInt(process.env.CB_HOT_MAX_CITERS || '50000', 10));

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
// Hot papers (≥ opts.hotMin in-catalog citers per opts.citedCounts) lead the
// whole queue, most-cited first — each one's citer list feeds the n_j/n_k pools
// of every focal paper citing it, so it unlocks that many D computations at
// once. Below the hot block the old order is untouched: within a tier,
// never-fetched first, then stalest, then newest year, then DOI. A paper
// fetched at the current version AND fresher than the TTL is skipped — UNLESS
// it was CAPPED under a smaller cap than applies to it now (opts.maxCiters /
// opts.hotMaxCiters): a truncated list is not a fresh fetch, so raising the hot
// cap re-crawls the capped classics promptly instead of after the TTL. Each
// returned entry carries the per-paper `cap` for fetchCiters.
export function orderCitedby(papers, cache, oaidMap, limit, nowTs, ttlDays = TTL_DAYS, ver = CB_VER, opts = {}) {
  const ttlMs = ttlDays * 86400000;
  const citedCounts = opts.citedCounts || {};
  const hotMin = opts.hotMin || Infinity;
  const baseCap = opts.maxCiters || 0;         // 0 = caller default (recap logic off)
  const hotCap = opts.hotMaxCiters || baseCap;
  const eligible = [];
  for (const p of papers) {
    const oaid = oaidMap[p.doi];
    if (!oaid) continue;                       // no OpenAlex id yet → can't query cites:
    const c = cache[p.doi];
    const cited = citedCounts[p.doi] || 0;
    const hot = cited >= hotMin ? cited : 0;
    const cap = hot ? hotCap : baseCap;
    let last = 0;
    if (c && (c.v || 0) >= ver) {
      last = Date.parse((c.t || '') + 'T00:00:00Z') || 0;
      const recap = !!(c.cap && cap && (c.c ? c.c.length : 0) < cap);
      if (!recap && last && (nowTs - last) <= ttlMs) continue; // fresh at the current version → skip
    }
    eligible.push({ p, oaid, neverFetched: !c, last, hot, cap });
  }
  eligible.sort((a, b) =>
    (b.hot - a.hot) ||                                     // hot papers first, most-cited first
    (a.p.tier - b.p.tier) ||                               // then tier 0 first
    (Number(b.neverFetched) - Number(a.neverFetched)) ||   // never-fetched before refreshes
    (a.last - b.last) ||                                   // then stalest first
    (b.p.year - a.p.year) ||                               // then newest year first
    (a.p.doi < b.p.doi ? -1 : a.p.doi > b.p.doi ? 1 : 0));
  return eligible.slice(0, limit).map(x => ({ doi: x.p.doi, oaid: x.oaid, jkey: x.p.jkey, hot: x.hot, cap: x.cap }));
}

// ── High-value oaid seeding (pure part, unit-tested) ─────────────────────────
// The catalog papers worth resolving an OpenAlex id for BY DOI instead of
// waiting for build-refs's newest-first sweep: cited in-catalog at least
// `minCited` times, id not yet known. `doi in oaidMap` (not truthiness) so a
// recorded empty-string miss is never re-queried. Most-cited first — the same
// ranking the crawl's hot bump uses.
export function orderOaidSeeds(papers, citedCounts, oaidMap, limit, minCited) {
  const seeds = [];
  for (const p of papers) {
    if (p.doi in oaidMap) continue;
    const cited = citedCounts[p.doi] || 0;
    if (cited < minCited) continue;
    seeds.push({ doi: p.doi, cited });
  }
  seeds.sort((a, b) => (b.cited - a.cited) ||
    (a.doi < b.doi ? -1 : a.doi > b.doi ? 1 : 0));
  return seeds.slice(0, limit).map(s => s.doi);
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
// list (or `cap` — per paper: HOT_MAX_CITERS for hot papers, MAX_CITERS else)
// is in hand, or null if OpenAlex stayed unavailable / the deadline hit
// mid-pagination — in which case the paper is left unstamped so a later run
// retries it cleanly (a partial page set is never committed).
async function fetchCiters(oaid, deadline, cap = MAX_CITERS) {
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
    if (citers.length >= cap) return { citers: citers.slice(0, cap), count: count ?? citers.length, capped: true, complete: true };
    cursor = (j.meta && j.meta.next_cursor) || null;
    if (cursor) await sleep(OA_PACE_MS);
  }
  return { citers, count: count ?? citers.length, capped: false, complete: true };
}

// Resolve OpenAlex ids by DOI for the seed list (batched 50/call, same backoff
// discipline as build-refs's OpenAlex leg). Returned works land in oaidMap as
// doi → id; a DOI a SUCCESSFUL batch didn't return isn't in OpenAlex and is
// recorded as '' so it is never re-queried (falsy — every truthy consumer
// treats it like absent, and build-refs overwrites it if the work appears).
// Best-effort: drops out for the run on quota/throttle, resumes next schedule.
async function seedOaids(seeds, oaidMap, deadline, checkpoint) {
  let fails = 0, found = 0, misses = 0;
  for (let i = 0; i < seeds.length; i += 50) {
    if (Date.now() > deadline) break;
    const batch = seeds.slice(i, i + 50);
    const url = 'https://api.openalex.org/works?filter=doi:' +
      batch.map(d => encodeURIComponent(d)).join('|') +
      '&per-page=50&select=id,doi&mailto=' + encodeURIComponent(MAILTO);
    const r = await cbGet(url);
    if (!r.ok) {
      const throttle = r.status === 429 || r.status === 403;
      fails++;
      if ((throttle && r.retryAfter > 3600) || fails >= MAX_THROTTLE) {
        console.log('  oaid seeding: quota/throttle — dropping the seeding leg for this run.');
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
      const oaid = shortOaid(w && w.id);
      if (!d || !oaid) continue;
      returned.add(d);
      oaidMap[d] = oaid; found++;
    }
    for (const d of batch) if (!returned.has(d)) { oaidMap[d] = ''; misses++; }
    if (checkpoint && (i / 50) % 10 === 9) await checkpoint();
    await sleep(OA_PACE_MS);
  }
  return { found, misses };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`lit forward-citation harvest (v${CB_VER}): ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}; out=${DATA_DIR}`);
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + BUDGET_MS;

  // 1. Catalog + the caches (crawl state + the doi→OpenAlex-id map built by build-refs).
  const { dbByDoi, papers } = await loadCatalog(CATALOG_DIRS, { log: true });
  // The citer cache is CHUNKED (_citedby-cache.json, _citedby-cache-2.json, …)
  // like build-refs's _refs-cache.json: both sat at ~100 MB when the refs cache
  // crossed GitHub's hard 100 MiB push limit in Aug 2026 and every backfill
  // push was rejected. The shared helpers keep each part safely under it.
  const cache = await readChunkedJson(join(DATA_DIR, '_citedby-cache.json'), {});
  const oaidMap = await loadJson(join(DATA_DIR, '_oaid.json'), {});
  const citedCounts = await loadJson(join(DATA_DIR, 'cited-counts.json'), {});
  const withOaid = papers.filter(p => oaidMap[p.doi]).length;
  console.log(`catalog: ${papers.length} papers (${withOaid} with an OpenAlex id); ` +
    `cache: ${Object.keys(cache).length} papers; oaids known: ${Object.keys(oaidMap).length}`);
  if (!withOaid) console.log('  (no OpenAlex ids yet — run build-refs.mjs first to populate _oaid.json.)');

  const writeOaids = async () => {
    await writeFile(join(DATA_DIR, '_oaid.json'), JSON.stringify(oaidMap), 'utf8');
  };

  // 2. High-value oaid seeding: resolve ids by DOI for the most-in-catalog-cited
  //    papers still missing one (the canon references build-refs's newest-first
  //    sweep reaches last), so their citer lists can be crawled THIS run instead
  //    of after the whole reference backlog. Bounded + best-effort.
  const seeds = orderOaidSeeds(papers, citedCounts, oaidMap, SEED_MAX, HOT_MIN);
  if (seeds.length) {
    console.log(`oaid seeding: ${seeds.length} high-value paper(s) (≥${HOT_MIN} in-catalog citers) missing an id…`);
    const seedDeadline = Math.min(deadline, Date.now() + 5 * 60 * 1000);
    const { found, misses } = await seedOaids(seeds, oaidMap, seedDeadline, writeOaids);
    await writeOaids();
    console.log(`  oaid seeding: ${found} id(s) resolved, ${misses} not in OpenAlex (recorded).`);
  }

  // 3. This run's slice (hot papers first, then the rolling refresh order; the
  //    maxCiters/hotMaxCiters pair also re-queues capped classics whose
  //    applicable cap grew — see orderCitedby).
  const nowTs = Date.parse(PULL_DATE + 'T00:00:00Z') || Date.now();
  const slice = orderCitedby(papers, cache, oaidMap, MAX_PAPERS, nowTs, TTL_DAYS, CB_VER,
    { citedCounts, hotMin: HOT_MIN, maxCiters: MAX_CITERS, hotMaxCiters: HOT_MAX_CITERS });
  console.log(`processing up to ${slice.length} paper(s) this run`);

  const checkpoint = async () => {
    await writeChunkedJson(join(DATA_DIR, '_citedby-cache.json'), cache);
  };

  // 4. Harvest each paper's citing works.
  let done = 0, stopped = false;
  for (const p of slice) {
    if (Date.now() > deadline) { console.log('  time budget reached — stopping (resumes next run).'); stopped = true; break; }
    const res = await fetchCiters(p.oaid, deadline, p.cap || MAX_CITERS);
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

  // 5. Coverage stats → the tiny served meta.
  const oaidToDoi = {};
  for (const [doi, oaid] of Object.entries(oaidMap)) if (oaid && dbByDoi.has(doi)) oaidToDoi[oaid] = doi;
  let fetched = 0, withCiters = 0, totalCiters = 0, inCatCiters = 0, capped = 0;
  for (const [doi, e] of Object.entries(cache)) {
    if (!dbByDoi.has(doi)) continue;           // paper no longer in the catalog
    if ((e.v || 0) >= CB_VER) fetched++;
    if (e.cap) capped++;
    if (e.c && e.c.length) withCiters++;
    for (const wid of e.c || []) { totalCiters++; if (oaidToDoi[wid]) inCatCiters++; }
  }
  const meta = {
    lastPull: PULL_DATE, ver: CB_VER,
    // papersWithCiters = papers with ≥1 harvested citer; papersFetched counts
    // every harvest attempt incl. zero-citer papers (the old value of
    // papersWithCiters, which overstated coverage by the zero-citer share).
    // withOaid is recomputed here so ids resolved by THIS run's seeding count.
    papersWithCiters: withCiters, papersFetched: fetched, catalog: papers.length,
    withOaid: papers.filter(p => oaidMap[p.doi]).length,
    citersHarvested: totalCiters, inCatalogCiters: inCatCiters, cappedPapers: capped,
  };
  await writeFile(join(DATA_DIR, 'citedby-meta.json'), JSON.stringify(meta), 'utf8');

  console.log(`done: forward citations for ${fetched} paper(s); ${totalCiters} citer links ` +
    `(${inCatCiters} in-catalog); ${capped} paper(s) capped (${MAX_CITERS} base / ${HOT_MAX_CITERS} hot)` +
    `${stopped ? ' (run stopped early — resumes next schedule)' : ''}.`);
}

// ── Mock network (offline smoke test) ────────────────────────────────────────
// OpenAlex  works?filter=cites:<oaid>  ->  mock-cb/cb-<oaid>.json
//   { "results": [{ "id": "...", "doi": "..." }, …], "meta": { "count": N, "next_cursor": null } }
// OpenAlex  works?filter=doi:<d1>|<d2>… (the oaid seeding) -> mock-cb/oa-<slug>.json
//   one work per fixture ({ "id": "...", "doi": "..." }), build-refs's convention;
//   a DOI without a fixture is simply not returned (= not in OpenAlex).
async function mockGet(rawUrl) {
  const url = decodeURIComponent(rawUrl);
  const md = url.match(/filter=doi:([^&]+)/i);
  if (md) {
    const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const results = [];
    for (const d of md[1].split('|')) {
      const w = await loadJson(join(MOCK_DIR, `oa-${slug(d)}.json`), null);
      if (w) results.push(w);
    }
    return { ok: true, status: 200, json: { results, meta: { count: results.length, next_cursor: null } } };
  }
  const m = url.match(/filter=cites:(W\d+)/i);
  const oaid = m ? m[1] : '';
  const j = await loadJson(join(MOCK_DIR, `cb-${oaid}.json`), null);
  if (!j) return { ok: true, status: 200, json: { results: [], meta: { count: 0, next_cursor: null } } };
  return { ok: true, status: 200, json: j };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
