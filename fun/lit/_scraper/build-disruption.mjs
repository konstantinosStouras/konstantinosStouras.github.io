/*
 * build-disruption.mjs — the "team science" (disruption vs development) pipeline
 * for stouras.com/fun/lit/analytics/.
 * ===========================================================================
 * Reproduces the core measures of Wu, Wang & Evans, "Large teams develop and
 * small teams disrupt science and technology" (Nature 570, 378–382, 2019) over
 * whatever slice of The Lit's citation graph we have harvested so far.
 *
 * WHAT IT COMPUTES (per paper, offline — no network):
 *   • Disruption index D (a.k.a. the CD index, Funk & Owen-Smith 2017) built
 *     from the in-catalog citation network (fun/lit/data-refs/). D > 0 the work
 *     eclipses its own antecedents (disruptive); D < 0 it is co-cited with them
 *     (developing). Range −1..+1.
 *   • Team size (number of authors), citations (CitedBy), reference age (how far
 *     back it reaches) and reference popularity (how canonical the work it cites
 *     is) — the four quantities the paper crosses against team size.
 *
 * IMPORTANT SCOPE NOTE. The paper uses the FULL citation network of 40M+ works.
 * We only have the intra-catalog out-edges we have crawled into data-refs/ (a
 * growing subset — currently MS, M&SOM, POM, PNAS). So D here is computed over
 * that in-catalog neighbourhood only: it is an approximation that sharpens as
 * the reference graph fills in. Everything downstream is honest about this.
 *
 * OUTPUT: fun/lit/analytics/disruption.json — a compact, lazily-loaded file of
 * one record per paper that HAS a defined D (i.e. is itself in the reference
 * graph AND is cited by ≥1 other harvested paper). Small enough (a few thousand
 * rows) that the page computes every plot — distribution of D, D & citations vs
 * team size, reference age/popularity vs team size, relative-ratio extremes, and
 * per-author disruptiveness — CLIENT-SIDE, so all of it honours the page's
 * journal / journal-type / year filters exactly like the rest of the dashboard.
 *
 * Refreshed by .github/workflows/lit-analytics.yml (after the data builds and
 * the reference-graph backfill), same as build-analytics.mjs. Mirrors that
 * script's canonical-author resolution and journal set.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIT_DIR = path.resolve(__dirname, '..');            // fun/lit
const NATIVE_DIR = path.join(LIT_DIR, 'data');
const FT50_DIR = path.join(LIT_DIR, 'data-ft50');
const REFS_DIR = path.join(LIT_DIR, 'data-refs');
const OUT_DIR = path.join(LIT_DIR, 'analytics');

// Bump when the measure or its inputs change materially (mirrors the page's
// expectation — the page tolerates older files, this just documents intent).
const DISR_VER = 1;
const MIN_YEAR = 1900;
// Authors below this many disruption-scored papers are dropped from the author
// index used for the disruptiveness ranking (keeps that view meaningful; the
// per-paper author links stay so filtered author stats are always exact).
const AUTHOR_MIN_SCORED = 1;

// ── helpers (mirror build-analytics.mjs) ────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function normDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
}
function cleanYear(y) {
  const n = parseInt(y, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > 2100) return null;
  return n;
}
function authorNames(authorsField) {
  if (!authorsField) return [];
  return authorsField.split(',').map(s => s.trim()).filter(Boolean);
}
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function ingestVariants(map, file) {
  const rows = readJson(file, []);
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const canon = (r.Author || '').trim();
    if (!canon) continue;
    if (!map.has(canon)) map.set(canon, canon);
    const variants = (r.Name_Variants || '').split(';');
    for (const v of variants) { const t = v.trim(); if (t && !map.has(t)) map.set(t, canon); }
  }
}

// ── journal set: native wins on overlap (mirror build-analytics.mjs) ────────
const nativeSources = readJson(path.join(NATIVE_DIR, 'sources.json'), []);
const ft50Sources = readJson(path.join(FT50_DIR, 'sources.json'), []);
const journalMeta = new Map();
for (const s of nativeSources) journalMeta.set(s.key, { key: s.key, file: s.file, dir: NATIVE_DIR });
for (const s of ft50Sources) {
  if (journalMeta.has(s.key)) continue;
  if (!s.count) continue;
  journalMeta.set(s.key, { key: s.key, file: s.file, dir: FT50_DIR });
}

// ── canonical-author resolver ───────────────────────────────────────────────
const variantMap = new Map();
ingestVariants(variantMap, path.join(NATIVE_DIR, 'authors.json'));
ingestVariants(variantMap, path.join(FT50_DIR, 'authors.json'));
const canon = name => variantMap.get(name) || name;

// ── load the catalog: doi → {y, t, c, ti, j, au:[canonName]} ────────────────
const paper = new Map();       // normDoi -> record
const citedByGlobal = new Map(); // normDoi -> citation count (for ref popularity)
for (const meta of journalMeta.values()) {
  const arr = readJson(path.join(meta.dir, meta.file), []);
  if (!Array.isArray(arr)) continue;
  for (const p of arr) {
    const doi = normDoi(p.DOI);
    if (!doi || paper.has(doi)) continue;      // native wins on overlap
    const y = cleanYear(p.Year);
    const names = authorNames(p.Authors);
    const c = (typeof p.CitedBy === 'number' && p.CitedBy > 0) ? p.CitedBy : 0;
    paper.set(doi, {
      y, t: names.length, c,
      ti: String(p.Title || '').replace(/\s+/g, ' ').trim(),
      j: meta.key,
      au: names.map(canon),
    });
    if (c) citedByGlobal.set(doi, c);
  }
}

// reference years also come from the reference index (covers cited works that
// aren't in the native/ft50 papers we loaded here).
const refsIndex = readJson(path.join(REFS_DIR, 'refs-index.json'), {});
function refYear(doi) {
  const p = paper.get(doi);
  if (p && p.y != null) return p.y;
  const r = refsIndex[doi];
  const y = r && cleanYear(r[2]);
  return y != null ? y : null;
}

// ── build the citation graph from the reference shards ──────────────────────
// out[citing] = Set(cited);  inn[cited] = Set(citing)  — intra-catalog only.
const manifest = readJson(path.join(REFS_DIR, 'manifest.json'), { shards: {} });
const out = new Map();
const inn = new Map();
let edgeCount = 0;
for (const [jkey, sh] of Object.entries(manifest.shards || {})) {
  const shard = readJson(path.join(REFS_DIR, sh.file || `refs-${jkey}.json`), {});
  for (const [citing, cites] of Object.entries(shard)) {
    const c = normDoi(citing);
    let os = out.get(c); if (!os) { os = new Set(); out.set(c, os); }
    for (const cited of cites) {
      const d = normDoi(cited);
      if (!d || d === c) continue;
      os.add(d);
      let is = inn.get(d); if (!is) { is = new Set(); inn.set(d, is); }
      is.add(c);
      edgeCount++;
    }
  }
}

// ── disruption index D for one focal paper ──────────────────────────────────
function disruption(f) {
  const refs = out.get(f);
  const citingF = inn.get(f);
  if (!citingF || !citingF.size || !refs || !refs.size) return null;
  const citingRefs = new Set();
  for (const r of refs) {
    const cr = inn.get(r);
    if (!cr) continue;
    for (const p of cr) if (p !== f) citingRefs.add(p);
  }
  let ni = 0, nj = 0;
  for (const p of citingF) { if (citingRefs.has(p)) nj++; else ni++; }
  let nk = 0;
  for (const p of citingRefs) if (!citingF.has(p)) nk++;
  const denom = ni + nj + nk;
  if (!denom) return null;
  return { d: (ni - nj) / denom, ni, nj, nk };
}

// ── compute per-paper records ───────────────────────────────────────────────
const records = [];
const authorIndex = new Map();   // canonName -> integer id
function authorId(name) {
  let id = authorIndex.get(name);
  if (id == null) { id = authorIndex.size; authorIndex.set(name, id); }
  return id;
}

for (const f of out.keys()) {
  const meta = paper.get(f);
  if (!meta) continue;                    // focal not in the analytics corpus → skip
  const dd = disruption(f);
  if (!dd) continue;                       // no forward citations in-catalog → D undefined

  // reference age & popularity from the focal paper's references
  const refs = out.get(f);
  const ages = [], pops = [];
  const fy = meta.y;
  for (const r of refs) {
    if (fy != null) { const ry = refYear(r); if (ry != null && ry <= fy) ages.push(fy - ry); }
    const rc = citedByGlobal.get(r); if (rc != null) pops.push(rc);
  }
  const ra = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const rp = pops.length ? median(pops) : null;

  const rec = {
    j: meta.j,
    y: meta.y,
    t: meta.t,
    d: Math.round(dd.d * 1000) / 1000,
    c: meta.c,
    // nf = in-catalog forward citations (n_i + n_j) — the neighbourhood size D is
    // read from. Small nf ⇒ a degenerate ±1; the page gates its highlight tables
    // on it so the "most disruptive/developing" lists aren't 1-citation artefacts.
    nf: dd.ni + dd.nj,
    au: meta.au.map(authorId),
  };
  if (ra != null) rec.ra = Math.round(ra * 10) / 10;
  if (rp != null) rec.rp = rp;
  rec.ti = meta.ti;
  rec.doi = f;
  records.push(rec);
}

// author index array (id order) — trimmed to authors meeting the min
const authorArr = new Array(authorIndex.size);
for (const [name, id] of authorIndex) authorArr[id] = name;

// ── stamp & write ───────────────────────────────────────────────────────────
const nativeMeta = readJson(path.join(NATIVE_DIR, 'meta.json'), {});
const generated = nativeMeta.lastPull || '';

// quick distribution summary for the log
const ds = records.map(r => r.d).sort((a, b) => a - b);
const disr = ds.filter(d => d > 0).length, dev = ds.filter(d => d < 0).length, zero = ds.filter(d => d === 0).length;

const outObj = {
  generated,
  ver: DISR_VER,
  note: 'Disruption index D computed over The Lit\'s in-catalog citation graph (a growing subset). D>0 disrupts, D<0 develops.',
  totals: {
    papers: records.length,
    disruptive: disr, developing: dev, neutral: zero,
    edges: edgeCount,
    graphPapers: out.size,
    authors: authorArr.length,
  },
  authors: authorArr,
  papers: records,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'disruption.json'), JSON.stringify(outObj));

const kb = (fs.statSync(path.join(OUT_DIR, 'disruption.json')).size / 1024).toFixed(0);
console.log('build-disruption: wrote analytics/disruption.json (' + kb + ' KB)');
console.log('  scored papers=' + records.length + '  (disruptive=' + disr + ' developing=' + dev + ' neutral=' + zero + ')');
console.log('  graph: ' + out.size + ' citing papers, ' + edgeCount + ' edges, ' + authorArr.length + ' distinct authors');
console.log('  D range: ' + (ds[0] || 0).toFixed(3) + ' .. ' + (ds[ds.length - 1] || 0).toFixed(3) +
  '  median=' + (median(ds) || 0).toFixed(3));
