/*
 * build-analytics.mjs — the summary-statistics pipeline for stouras.com/lit/analytics/.
 * ===========================================================================
 * The analytics sub-page (lit/analytics/) is an interactive dashboard, but
 * the browser must never download the ~270 MB of raw papers to draw a chart.
 * So this script pre-aggregates the whole corpus offline into two compact,
 * committed JSON files that the page fetches on load:
 *
 *   • lit/analytics/data.json    — per-journal × per-year aggregates
 *     (paper counts, summed author counts, solo/pre-print/abstract/citation
 *     tallies), author-count buckets, and each journal's most-cited papers,
 *     plus journal-type membership (UTD24 / FT50 / ABS 4/4* / ABS 3) so the
 *     page can offer the same "Journal types" filter as the main browser.
 *   • lit/analytics/authors.json — per-author aggregates (papers per year,
 *     papers per journal) for authors above a small paper threshold, powering
 *     the "Author spotlight" (loaded on demand).
 *
 * INPUT: the committed datasets already in the repo —
 *   • lit/data/          (the ten native sources: MS, OpRe, MkSc, M&SOM,
 *                             ISR, Strategy Science, INFORMS Transactions on
 *                             Education, POM, PNAS, ACM EC)
 *   • lit/data-ft50/     (the FT50 catalog; its journals that duplicate a
 *                             native source are skipped, native wins)
 * so it can run any time after those builds, reading only static files. It is
 * refreshed by .github/workflows/lit-analytics.yml. No network, no APIs.
 *
 * The journal-type membership tables (ABS_RATING / UTD24_KEYS / FT50_KEYS)
 * are kept BYTE-FOR-BYTE in sync with lit/index.html — if you change the
 * lists there, mirror the change here (and vice-versa).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIT_DIR = path.resolve(__dirname, '..');            // lit
const NATIVE_DIR = path.join(LIT_DIR, 'data');
const FT50_DIR = path.join(LIT_DIR, 'data-ft50');
const OUT_DIR = path.join(LIT_DIR, 'analytics');

// Authors with at least this many papers get a full per-year / per-journal
// breakdown in authors.json; the long tail is omitted to keep the file small.
const AUTHOR_MIN_PAPERS = 5;
// A journal's most-cited papers to carry, for the "top cited" table.
const TOP_CITED_PER_JOURNAL = 12;
// A dimension value's most-cited papers to carry (editor/area/SE/AE), so the
// "most-cited in scope" table can honour an active editorial filter.
const DIM_TOP_CITED = 8;
// Editorial dimensions we aggregate for journals that carry them (accepting
// editor + area for Management Science; senior/associate editor for ISR and
// Marketing Science). A value must reach this many papers to be listed as a
// filterable dimension value (keeps data.json small; areas are kept in full).
const DIM_MIN_PAPERS = 3;
const DIMS = [
  { key: 'editor', field: 'Accepting Editor', multi: false, min: DIM_MIN_PAPERS, parse: cleanEditorNames },
  { key: 'area',   field: 'Area',             multi: false, min: 1 },
  { key: 'se',     field: 'Senior Editor',    multi: true,  min: DIM_MIN_PAPERS },
  { key: 'ae',     field: 'Associate Editor', multi: true,  min: DIM_MIN_PAPERS },
];
// MS "Accepting Editor" is stored as the whole acceptance sentence
// ("This paper was accepted by NAME, area."). Extract the editor name(s) so the
// dimension is keyed by a readable name, not the sentence (mirrors the page's
// cleanEditorField). Returns an array — a paper may name "A and B".
function cleanEditorNames(raw) {
  var s = String(raw == null ? '' : raw);
  var m = s.match(/accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
  var name = (m ? m[1] : s.replace(/^.*?accepted by\s+/i, '')).split(',')[0].replace(/\.\s*$/, '').trim();
  if (!name) return [];
  return name.split(/\s+and\s+/i).map(function (e) { return e.trim(); }).filter(Boolean);
}
// Papers older than this are almost always OCR/metadata noise; the corpus has
// a handful of stray pre-1900 "years". Clamp the year axis to something sane.
const MIN_YEAR = 1900;

// ── Journal-type membership — mirror of lit/index.html ──────────────────
// KEEP IN SYNC with the ABS_RATING / UTD24_KEYS / FT50_KEYS constants there.
const ABS_RATING = {
  aman: '4*', amj: '4*', amr: '4*', tar: '4*', aos: '4*', asq: '4*',
  aer: '4*', asr: '4*', ecta: '4*', etp: '4*', jae: '4*', jar: '4*',
  jap: '4*', jbv: '4*', jcp: '4*', jcr: '4*', jof: '4*', jfe: '4*',
  jibs: '4*', jom: '4*', jm: '4*', jmr: '4*', joom: '4*', jpe: '4*',
  ms: '4*', mksc: '4*', misq: '4*', isre: '4*', opre: '4*', orsc: '4*',
  qje: '4*', respol: '4*', restud: '4*', rfs: '4*', smj: '4*',
  car: '4', hrm: '4', jfqa: '4', jmis: '4', jms: '4', jams: '4',
  msom: '4', obhdp: '4', pom: '4', psci: '4', rast: '4', rof: '4', sej: '4',
  ejor: '4',
  hbr: '3', smr: '3', ijoc: '3',
  stsc: '3', // Strategy Science (INFORMS) — strategy/innovation, graded ABS 3
};
const UTD24_KEYS = new Set(['tar', 'jae', 'jar', 'jof', 'jfe', 'rfs', 'isre', 'ijoc',
  'misq', 'jcr', 'jm', 'jmr', 'mksc', 'ms', 'opre', 'joom', 'msom', 'pom', 'amj', 'amr',
  'asq', 'orsc', 'jibs', 'smj']);
const FT50_KEYS = new Set(['aman', 'amj', 'amr', 'tar', 'aos', 'asq', 'aer', 'asr',
  'car', 'ecta', 'etp', 'hbr', 'hrm', 'isre', 'jae', 'jar', 'jap', 'jbv', 'jcp', 'jcr',
  'jof', 'jfqa', 'jfe', 'jibs', 'jom', 'jmis', 'jms', 'jm', 'jmr', 'joom', 'jpe', 'jams',
  'ms', 'msom', 'mksc', 'misq', 'smr', 'opre', 'orsc', 'obhdp', 'pom', 'psci', 'qje',
  'respol', 'rast', 'restud', 'rof', 'rfs', 'sej', 'smj']);
// Same order and labels as JOURNAL_TYPES in index.html (most selective first).
const JOURNAL_TYPES = [
  { key: 'utd24', label: 'UTD24 (UT Dallas)', badge: 'UTD24' },
  { key: 'ft50', label: 'FT50 (Financial Times Top 50)', badge: 'FT50' },
  { key: 'abs4', label: 'ABS 4/4*', badge: 'ABS 4/4*' },
  { key: 'abs3', label: 'ABS 3', badge: 'ABS 3' },
];

// The membership-key list for one journal, in JOURNAL_TYPES order.
function typesFor(jkey) {
  const out = [];
  if (UTD24_KEYS.has(jkey)) out.push('utd24');
  if (FT50_KEYS.has(jkey)) out.push('ft50');
  const g = ABS_RATING[jkey];
  if (g === '4' || g === '4*') out.push('abs4');
  else if (g === '3') out.push('abs3');
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function authorCount(authorsField) {
  if (!authorsField) return 0;
  return authorsField.split(',').map(s => s.trim()).filter(Boolean).length;
}

function cleanYear(y) {
  const n = parseInt(y, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > 2100) return null;
  return n;
}

// Build a variant→canonical author-name map from a pre-computed authors.json
// (each row has a canonical `Author` plus `Name_Variants` joined by ';'), so
// the same person's papers aren't split across spelling variants.
function ingestVariants(map, file) {
  const rows = readJson(file, []);
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const canon = (r.Author || '').trim();
    if (!canon) continue;
    if (!map.has(canon)) map.set(canon, canon);
    const variants = (r.Name_Variants || '').split(';');
    for (const v of variants) {
      const t = v.trim();
      if (t && !map.has(t)) map.set(t, canon);
    }
  }
}

// ── load the manifests, decide the journal set (native wins on overlap) ─────
const nativeSources = readJson(path.join(NATIVE_DIR, 'sources.json'), []);
const ft50Sources = readJson(path.join(FT50_DIR, 'sources.json'), []);

const journalMeta = new Map();   // jkey -> {key, name, publisher, file, dir}
for (const s of nativeSources) {
  journalMeta.set(s.key, { key: s.key, name: s.name, publisher: s.publisher || '', file: s.file, dir: NATIVE_DIR });
}
for (const s of ft50Sources) {
  if (journalMeta.has(s.key)) continue;          // native wins on overlap
  if (!s.count) continue;                        // skip empty catalogs (e.g. hbr)
  journalMeta.set(s.key, { key: s.key, name: s.name, publisher: s.publisher || '', file: s.file, dir: FT50_DIR });
}

// ── canonical-author resolver ───────────────────────────────────────────────
const variantMap = new Map();
ingestVariants(variantMap, path.join(NATIVE_DIR, 'authors.json'));
ingestVariants(variantMap, path.join(FT50_DIR, 'authors.json'));
const canon = name => variantMap.get(name) || name;

// ── accumulate ──────────────────────────────────────────────────────────────
const journals = [];
const authorAgg = new Map();     // canonicalName -> {p, y:{}, j:{}}
let totPapers = 0, totPre = 0, totAbs = 0, totCitations = 0, totCited = 0;
let yearMin = Infinity, yearMax = -Infinity;

for (const meta of journalMeta.values()) {
  const arr = readJson(path.join(meta.dir, meta.file), []);
  if (!Array.isArray(arr) || arr.length === 0) continue;

  const years = {};                                 // year -> {n,a,s,p,c,ab,t:[6]}
  const cited = [];                                 // {t,y,c,a,d}
  // Editorial-dimension aggregates: dimKey -> value -> { years:{y:row} }. Only
  // populated for journals that carry the field (MS editors/areas, ISR/MkSc
  // SE/AE); mirrors the per-year row shape so the page aggregates them uniformly.
  const dimAgg = {};
  DIMS.forEach(function (d) { dimAgg[d.key] = {}; });
  const ensureDimVal = (map, value) => map[value] || (map[value] = { years: {}, cited: [] });
  const addDimRow = (map, value, y, na, hasPre, hasAbs, cites) => {
    if (!value) return;
    const e = ensureDimVal(map, value);
    if (y == null) return;
    const row = e.years[y] || (e.years[y] = { n: 0, a: 0, s: 0, p: 0, c: 0, ab: 0, t: [0, 0, 0, 0, 0, 0] });
    row.n++; row.a += na; if (na === 1) row.s++; if (hasPre) row.p++; if (hasAbs) row.ab++;
    row.c += cites; if (na) row.t[Math.min(na, 6) - 1]++;
  };
  // Collect a dimension value's most-cited papers (top-cited per editor / area /
  // senior / associate editor), so the "most-cited in scope" table can honour an
  // editorial filter the same way the tiles and charts do. Same shape as the
  // per-journal topCited rows.
  const addDimCited = (map, value, rec) => {
    if (!value) return;
    ensureDimVal(map, value).cited.push(rec);
  };
  let jPapers = 0;

  for (const p of arr) {
    jPapers++; totPapers++;
    const y = cleanYear(p.Year);
    const na = authorCount(p.Authors);
    const hasPre = !!p.Preprint;
    const hasAbs = !!p.Abstract;
    const cites = (typeof p.CitedBy === 'number' && p.CitedBy > 0) ? p.CitedBy : 0;

    if (hasPre) totPre++;
    if (hasAbs) totAbs++;
    if (cites) { totCitations += cites; totCited++; }

    if (y != null) {
      if (y < yearMin) yearMin = y;
      if (y > yearMax) yearMax = y;
      // per-year row; t = team-size buckets [1,2,3,4,5,6+] so the co-authorship
      // distribution honours the page's year filter like every other chart.
      const row = years[y] || (years[y] = { n: 0, a: 0, s: 0, p: 0, c: 0, ab: 0, t: [0, 0, 0, 0, 0, 0] });
      row.n++;
      row.a += na;
      if (na === 1) row.s++;
      if (hasPre) row.p++;
      if (hasAbs) row.ab++;
      row.c += cites;
      if (na) row.t[Math.min(na, 6) - 1]++;
    }

    if (cites) {
      cited.push({ t: p.Title || '', y: y || '', c: cites, a: p.Authors || '', d: p.DOI || '' });
    }

    // Editorial dimensions (only papers with a value contribute).
    for (const d of DIMS) {
      const raw = p[d.field];
      if (!raw) continue;
      let dvals;
      if (d.parse) dvals = d.parse(raw);
      else if (d.multi) dvals = String(raw).split(';').map(s => s.trim()).filter(Boolean);
      else { const t = String(raw).trim(); dvals = t ? [t] : []; }
      for (const v of dvals) {
        addDimRow(dimAgg[d.key], v, y, na, hasPre, hasAbs, cites);
        if (cites) addDimCited(dimAgg[d.key], v, { t: p.Title || '', y: y || '', c: cites, a: p.Authors || '', d: p.DOI || '' });
      }
    }

    // author aggregation (canonicalised, per year + per journal)
    if (p.Authors) {
      const names = p.Authors.split(',').map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      for (const nm of names) {
        const c = canon(nm);
        if (seen.has(c)) continue;                 // one paper counts once per author
        seen.add(c);
        let a = authorAgg.get(c);
        if (!a) { a = { p: 0, y: {}, j: {} }; authorAgg.set(c, a); }
        a.p++;
        if (y != null) a.y[y] = (a.y[y] || 0) + 1;
        a.j[meta.key] = (a.j[meta.key] || 0) + 1;
      }
    }
  }

  cited.sort((x, z) => z.c - x.c);

  // Finalize editorial dimensions: keep values reaching the threshold, stamp a
  // total, attach the value's most-cited papers, and keep only non-empty dims.
  const dims = {};
  for (const d of DIMS) {
    const out = {};
    for (const [val, e] of Object.entries(dimAgg[d.key])) {
      let tot = 0; for (const yy in e.years) tot += e.years[yy].n;
      if (tot < d.min) continue;
      const o = { n: tot, years: e.years };
      if (e.cited.length) { e.cited.sort((x, z) => z.c - x.c); o.tc = e.cited.slice(0, DIM_TOP_CITED); }
      out[val] = o;
    }
    if (Object.keys(out).length) dims[d.key] = out;
  }

  const rec = {
    key: meta.key,
    name: meta.name,
    publisher: meta.publisher,
    types: typesFor(meta.key),
    abs: ABS_RATING[meta.key] || null,
    papers: jPapers,
    years,
    topCited: cited.slice(0, TOP_CITED_PER_JOURNAL),
  };
  if (Object.keys(dims).length) rec.dims = dims;
  journals.push(rec);
}

journals.sort((a, b) => b.papers - a.papers);

// ── author output (thresholded) ─────────────────────────────────────────────
const authorsOut = [];
for (const [name, a] of authorAgg) {
  if (a.p < AUTHOR_MIN_PAPERS) continue;
  authorsOut.push({ n: name, p: a.p, y: a.y, j: a.j });
}
authorsOut.sort((a, b) => b.p - a.p);

// ── stamp & write ───────────────────────────────────────────────────────────
// The generation date is read from the native meta.json (its lastPull), never
// from Date.now(), so re-runs on the same dataset are deterministic.
const nativeMeta = readJson(path.join(NATIVE_DIR, 'meta.json'), {});
const generated = nativeMeta.lastPull || '';

const data = {
  generated,
  yearMin: Number.isFinite(yearMin) ? yearMin : null,
  yearMax: Number.isFinite(yearMax) ? yearMax : null,
  totals: {
    papers: totPapers,
    journals: journals.length,
    authors: authorAgg.size,
    withPreprint: totPre,
    withAbstract: totAbs,
    citations: totCitations,
    cited: totCited,
  },
  types: JOURNAL_TYPES,
  journals,
};

const authorsFile = {
  generated,
  minPapers: AUTHOR_MIN_PAPERS,
  count: authorsOut.length,
  authors: authorsOut,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'data.json'), JSON.stringify(data));
fs.writeFileSync(path.join(OUT_DIR, 'authors.json'), JSON.stringify(authorsFile));

const kb = f => (fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(0);
console.log('build-analytics: wrote analytics/data.json (' + kb('data.json') + ' KB) and analytics/authors.json (' + kb('authors.json') + ' KB)');
console.log('  papers=' + totPapers + '  journals=' + journals.length +
  '  authors(total)=' + authorAgg.size + '  authors(>=' + AUTHOR_MIN_PAPERS + ')=' + authorsOut.length +
  '  years=' + data.yearMin + '..' + data.yearMax +
  '  withPreprint=' + totPre + '  cited=' + totCited);
