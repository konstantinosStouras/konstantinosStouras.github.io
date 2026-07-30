/*
 * coverage-audit.mjs — offline completeness audit for one journal's committed
 * back-catalogue. NO NETWORK: it answers "have we actually got every published
 * paper?" purely from data already in the repo, so it works in CI, on a runner
 * whose egress blocks Crossref, and on a plane.
 * ===========================================================================
 * Why this exists: "how confident are we that journal X is complete for the last
 * 20 years?" cannot be answered by counting our own rows — the harvest and the
 * count come from the same place, so a gap is invisible. This tool applies two
 * probes that are INDEPENDENT of the harvest:
 *
 *   A. PAGE TILING (structural; covers every year, incl. the newest).
 *      A journal issue paginates contiguously, so its articles' page ranges must
 *      tile it. A missing article leaves a hole. Gaps are measured WITHIN an
 *      issue — a jump across an issue boundary is that issue's front matter
 *      (contents pages, "IFC", roman-numbered leaves), not a missing paper —
 *      and holes of 1 page are ignored (a blank verso / a shared page). This
 *      probe cannot see a whole missing ISSUE (the volume would simply end
 *      early), so it is paired with a volume-run + issue-set check:
 *      every volume number in the run must be present, and each volume must
 *      carry its journal's usual issue set.
 *
 *   B. CITED-DOI PROBE (independent corpus; strong for older years).
 *      data-refs/_refs-cache.json holds the RAW reference DOI lists harvested
 *      for catalog papers — including references to works NOT in the catalog.
 *      Every DOI of this journal that some catalog paper CITES is therefore a
 *      paper we know exists, from a source that has nothing to do with our
 *      journal harvest. Any such DOI missing from papers-<key>.json is a
 *      PROVEN hole. Caveat, stated in the output: it under-samples the newest
 *      years, because a paper published last month has not been cited yet.
 *
 * Neither probe can prove 100%; together they bound the gap tightly from two
 * directions, and B's misses are concrete DOIs you can go and fetch.
 *
 * Usage:
 *   node lit/_scraper/coverage-audit.mjs --journal ejor
 *   node lit/_scraper/coverage-audit.mjs --journal ejor --from 2006 --verbose
 *   node lit/_scraper/coverage-audit.mjs --journal ms --dir lit/data
 *   node lit/_scraper/coverage-audit.mjs --journal ejor --json
 *
 * Options:
 *   --journal <key>   journal key, i.e. papers-<key>.json      (required)
 *   --dir <path>      dataset dir (default: auto — searches lit/data,
 *                     lit/data-ft50 and any ../lit-data-* shard checkout)
 *   --from <year>     first year to audit (default: this year - 19, "last 20")
 *   --refs <path>     refs cache (default: lit/data-refs/_refs-cache.json)
 *   --issues <n>      expected issues per volume (default: inferred from the
 *                     journal's own modal issue set)
 *   --verbose         list every suspected gap and every missing cited DOI
 *   --json            machine-readable output only
 *
 * Exit code is 0 for a clean audit and 1 when a probe finds a PROVEN hole
 * (a missing volume, or a cited DOI we do not list), so it can gate CI.
 * ===========================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIT = resolve(__dirname, '..');            // …/lit
const ROOT = resolve(LIT, '..');                 // repo root

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const JKEY = arg('journal');
const VERBOSE = flag('verbose');
const AS_JSON = flag('json');
if (!JKEY) {
  console.error('Usage: node lit/_scraper/coverage-audit.mjs --journal <key> [--dir <dataset>] [--from <year>] [--verbose] [--json]');
  process.exit(2);
}
const THIS_YEAR = new Date().getFullYear();
const FROM = parseInt(arg('from', String(THIS_YEAR - 19)), 10);

// ── locate the papers file ──────────────────────────────────────────────────
const candidateDirs = arg('dir')
  ? [resolve(ROOT, arg('dir'))]
  : [join(LIT, 'data'), join(LIT, 'data-ft50'),
     ...['lit-data-abs4', 'lit-data-abs3-omecon', 'lit-data-abs3-rest',
         'lit-data-nature', 'lit-data-science']
       .flatMap(r => [resolve(ROOT, '..', r, 'data'), join(LIT, '_analytics-shards', r, 'data')])];

const dataDir = candidateDirs.find(d => existsSync(join(d, `papers-${JKEY}.json`)));
if (!dataDir) {
  console.error(`papers-${JKEY}.json not found. Looked in:\n  ${candidateDirs.join('\n  ')}`);
  process.exit(2);
}
const papersPath = join(dataDir, `papers-${JKEY}.json`);
const raw = JSON.parse(readFileSync(papersPath, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.papers || []);

const bareDoi = (d) => String(d || '').trim().toLowerCase()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '');
// Issue label -> its issue NUMBER. A split issue is deposited as "4-part-1" /
// "4-part-2" (Operations Research vol 58) or "3-4" for a combined one; both are
// still that volume's issue 4 / issue 3, paginated continuously with it, so they
// must fold into one entry rather than look like a missing issue plus two
// unrecognised ones.
const issueKey = (raw) => {
  const s = String(raw || '').trim();
  const m = /^0*(\d+)/.exec(s);
  return m ? String(Number(m[1])) : (s || '(none)');
};
const pageRange = (p) => {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(p || '').trim()) || /^(\d+)$/.exec(String(p || '').trim());
  return m ? [+m[1], m[2] ? +m[2] : +m[1]] : null;
};

const inWindow = rows.filter(r => +r.Year >= FROM);
const report = {
  journal: JKEY, dataset: dataDir.replace(ROOT + '/', ''), from: FROM, to: THIS_YEAR,
  rowsTotal: rows.length, rowsInWindow: inWindow.length,
  problems: [], notes: [],
};

// ── probe A1: volume run + issue sets ───────────────────────────────────────
// Keyed by the volume NUMBER, not its string: some publishers zero-pad, so
// "094" and "94" are the same volume and must not become two entries (nor make
// a numeric lookup miss).
const volumes = new Map();                       // volNum -> {years:Set, issues:Map}
for (const r of rows) {
  const vs = String(r.Volume || '').trim();
  if (!/^\d+$/.test(vs)) continue;
  const v = Number(vs);
  // Volume 0 / "00" is a publisher placeholder on a few records (Econometrica
  // deposits it on some corrigenda), never a real volume — it would otherwise
  // open the run at 0 and report every volume up to the first real one missing.
  if (v <= 0) continue;
  if (!volumes.has(v)) volumes.set(v, { years: new Set(), issues: new Map() });
  const e = volumes.get(v);
  e.years.add(+r.Year);
  // Normalise the issue key, so "0"/"00" and "4"/"4-part-1"/"4-part-2" each
  // collapse to one issue rather than looking like several.
  const iss = issueKey(r.Issue);
  if (!e.issues.has(iss)) e.issues.set(iss, { n: 0, min: Infinity, max: 0 });
  const ie = e.issues.get(iss);
  ie.n++;
  const pr = pageRange(r.Page);
  if (pr) { if (pr[0] < ie.min) ie.min = pr[0]; if (pr[1] > ie.max) ie.max = pr[1]; }
}
const volNums = [...volumes.keys()].sort((a, b) => a - b);
const winVols = volNums.filter(v => Math.min(...volumes.get(v).years) >= FROM);

const missingVols = [];
if (winVols.length > 1) {
  for (let v = winVols[0]; v <= winVols[winVols.length - 1]; v++) {
    if (!volumes.has(v)) missingVols.push(v);
  }
}
report.volumesInWindow = winVols.length;
report.missingVolumes = missingVols;
if (missingVols.length) {
  report.problems.push(`${missingVols.length} volume number(s) absent from the run: ${missingVols.join(', ')}`);
}

// expected issues per volume: the journal's own modal issue count
const issueCounts = winVols.map(v =>
  [...volumes.get(v).issues.keys()].filter(k => /^\d+$/.test(k)).length).filter(n => n > 0);
const modal = (xs) => {
  const t = new Map();
  for (const x of xs) t.set(x, (t.get(x) || 0) + 1);
  return [...t.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
};
const EXPECT_ISSUES = parseInt(arg('issues', String(modal(issueCounts))), 10);
report.issuesPerVolume = EXPECT_ISSUES;

const shortVols = [];
for (const v of winVols) {
  const e = volumes.get(v);
  const iss = [...e.issues.keys()].filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  if (!EXPECT_ISSUES || iss.length === EXPECT_ISSUES) continue;
  // the newest volume is legitimately still filling up
  const newest = v === winVols[winVols.length - 1];
  shortVols.push({ vol: v, year: Math.min(...e.years), issues: iss, inProgress: newest });
}
report.volumesWithOddIssueSet = shortVols;
const settledShort = shortVols.filter(s => !s.inProgress);
if (settledShort.length) {
  report.problems.push(`${settledShort.length} settled volume(s) do not carry the usual ${EXPECT_ISSUES} issues`);
}

// ── probe A2: page tiling within each issue ─────────────────────────────────
// Index the rows by (volume, issue) once — re-filtering the whole file per issue
// is O(volumes x issues x rows), which is minutes on a 25k-row journal.
const byVolIssue = new Map();
for (const r of rows) {
  const vs = String(r.Volume || '').trim();
  const iss = issueKey(r.Issue);
  if (!/^\d+$/.test(vs) || !/^\d+$/.test(iss)) continue;
  const v = Number(vs);
  if (v <= 0) continue;
  const pr = pageRange(r.Page);
  if (!pr) continue;                             // front matter (IFC, roman leaves)
  const k = `${v}/${iss}`;
  if (!byVolIssue.has(k)) byVolIssue.set(k, []);
  byVolIssue.get(k).push({ a: pr[0], b: pr[1], r });
}

const perYear = new Map();
const gaps = [];
let tiledArticles = 0;
for (const [k, list0] of byVolIssue) {
  const [v, iss] = k.split('/');
  const list = list0.sort((p, q) => p.a - q.a || p.b - q.b);
  const yr = Math.min(...list.map(x => +x.r.Year));
  if (!(yr >= FROM)) continue;
  tiledArticles += list.length;
  let end = null, gapPages = 0, nGaps = 0;
  for (const it of list) {
    if (end !== null && it.a > end + 1) {
      const gp = it.a - end - 1;
      if (gp >= 2) {
        gapPages += gp; nGaps++;
        gaps.push({ vol: v, issue: iss, year: yr, pages: `${end + 1}..${it.a - 1}`, span: gp,
          nextTitle: String(it.r.Title || '').slice(0, 70) });
      }
    }
    if (end === null || it.b > end) end = it.b;
  }
  const py = perYear.get(yr) || { articles: 0, issues: 0, pages: 0, gapPages: 0, gaps: 0 };
  py.articles += list.length; py.issues++; py.gapPages += gapPages; py.gaps += nGaps;
  py.pages += end - list[0].a + 1;
  perYear.set(yr, py);
}
report.tiledArticles = tiledArticles;
let estMissing = 0;
const years = [...perYear.keys()].sort();
report.perYear = years.map(y => {
  const d = perYear.get(y);
  const avgLen = d.articles ? (d.pages - d.gapPages) / d.articles : 0;
  const est = avgLen > 0 ? Math.round(d.gapPages / avgLen) : 0;
  estMissing += est;
  return { year: y, issues: d.issues, articles: d.articles, gaps: d.gaps,
    gapPages: d.gapPages, estMissing: est };
});
report.estMissingFromGaps = estMissing;
report.tilingCoveragePct = tiledArticles
  ? +(tiledArticles / (tiledArticles + estMissing) * 100).toFixed(3) : null;
report.gapDetail = gaps.sort((a, b) => b.span - a.span);
// The tiling probe ASSUMES an issue's articles paginate contiguously. That holds
// for most journals, but not all (some paginate per article, some deposit page
// numbers only sporadically), and where it does not hold the estimate is noise
// rather than evidence. Say so instead of quietly reporting a scary number.
if (report.tilingCoveragePct !== null && report.tilingCoveragePct < 97) {
  report.notes.push(`Page-tiling coverage is ${report.tilingCoveragePct}%, well under the ~99.5%+ a fully-harvested contiguously-paginated journal shows. That is EITHER real gaps OR a journal whose issues do not paginate contiguously (so the probe does not apply) — read the gaps with --verbose before concluding, and weigh probe B, which makes no pagination assumption.`);
}

// ── probe B: cited-DOI probe against the raw reference cache ────────────────
// To recognise "a DOI of THIS journal" in someone else's reference list we need
// the journal's DOI shape(s). A journal often has more than one — EJOR mints
// 10.1016/j.ejor.<year>.<seq> for articles since 2004, the legacy Elsevier PII
// 10.1016/S0377-2217(<yy>)<seq> before that, and still uses the PII form for
// each issue's front matter. So derive a SET of stems: registrant + the fixed
// journal token, cutting the DOI at the first variable numeric field.
//   10.1016/j.ejor.2015.05.082      -> 10.1016/j.ejor
//   10.1016/S0377-2217(99)00362-8   -> 10.1016/0377-2217(     (leading S dropped)
//   10.3982/ECTA24001               -> 10.3982/ecta
//   10.1287/mnsc.2023.4721          -> 10.1287/mnsc
const doiStem = (d) => {
  const slash = d.indexOf('/');
  if (slash < 0) return null;
  const reg = d.slice(0, slash + 1);
  let suf = d.slice(slash + 1);
  const paren = suf.indexOf('(');
  if (paren >= 0) suf = suf.slice(0, paren + 1).replace(/^s/, '');  // PII form
  else suf = suf.replace(/[0-9].*$/, '');   // cut at the FIRST digit: the journal
  // token is the fixed part, everything from the first number on is the article's
  // own field. Cutting at the LAST number instead would split one journal into
  // dozens of stems (mnsc.2023.4721 -> "mnsc" but mnsc.17.2.b57 -> "mnsc.17.2.b").
  return suf.replace(/[.\-]+$/, '').length >= 3 ? reg + suf.replace(/[.\-]+$/, '') : null;
};
// The SHAPE of a DOI — digit runs to '#', letter runs to '@' — is how a
// malformed citation is told from a real paper we are missing. Reference lists
// carry OCR slips and stray punctuation ("mnsc.l070.0830" with a letter l for a
// 1, "mnsc.2022.01261." with a trailing stop), and counting those as missing
// papers would make this probe cry wolf. A cited DOI is only treated as a
// PROVEN hole when its shape is one the journal itself actually uses.
const doiShape = (d) => d.replace(/\d+/g, '#').replace(/[a-z]+/g, '@');
// Second precision guard, for publishers whose DOI ENCODES the article's
// coordinates. INFORMS' pre-2010 form is <journal>.<vol>.<issue>.<firstPage>.<id>,
// where the trailing id is an internal key — so a reference to
// "mnsc.46.9.1249.12220" and our own "mnsc.46.9.1249.12238" are the SAME paper
// (vol 46, issue 9, p.1249) under a variant/mistyped registration, not a paper
// we are missing. Shape alone cannot catch that: both shapes are legitimate.
// So if any three consecutive numeric fields in a cited DOI name a
// (volume, issue, first page) we already carry, it is not a hole.
//
// Deliberately keyed on the ARTICLE'S COORDINATES rather than "the DOI matches
// one of ours except its last field", which would be wrong for date-sequence
// DOIs: 10.1016/j.ejor.2006.02.001 differs from 10.1016/j.ejor.2006.02.003 only
// in the last field too, yet those are genuinely different papers.
const coordIndex = (rows) => {
  const ix = new Set();
  for (const r of rows) {
    const v = String(r.Volume || '').trim(), i = String(r.Issue || '').trim();
    const m = /^(\d+)/.exec(String(r.Page || '').trim());
    if (!/^\d+$/.test(v) || !/^\d+$/.test(i) || !m) continue;
    ix.add(`${Number(v)}/${Number(i)}/${Number(m[1])}`);
  }
  return ix;
};
const heldAtSameCoords = (doi, ix) => {
  const nums = (doi.match(/\d+/g) || []).map(Number);
  for (let k = 0; k + 2 < nums.length; k++) {
    if (ix.has(`${nums[k]}/${nums[k + 1]}/${nums[k + 2]}`)) return true;
  }
  return false;
};
// The year a DOI encodes: `…ejor.2015.…` or the PII's two-digit `(99)`/`(26)`.
const doiYear = (d) => {
  const pii = /\((\d{2})\)/.exec(d);
  if (pii) { const y = +pii[1]; return y > 40 ? 1900 + y : 2000 + y; }
  const m = /[.\-/]((?:19|20)\d{2})[.\-]/.exec(d);
  return m ? +m[1] : 0;
};

const stemHits = new Map();
for (const r of rows) {
  const s = doiStem(bareDoi(r.DOI));
  if (s) stemHits.set(s, (stemHits.get(s) || 0) + 1);
}
// Keep the stems needed to explain the catalogue, biggest first, until ≥95% of
// rows are covered — so a scheme change is included and a one-off typo DOI is
// not. A stem already implied by a shorter kept one is redundant.
const ranked = [...stemHits.entries()].sort((a, b) => b[1] - a[1]);
const stems = [];
let covered = 0;
for (const [s, n] of ranked) {
  if (covered / Math.max(1, rows.length) >= 0.95) break;
  if (stems.some(k => s.startsWith(k))) { covered += n; continue; }
  stems.push(s); covered += n;
}
const stemShare = rows.length ? covered / rows.length : 0;
report.doiStems = stems;
report.doiStemShare = +(stemShare * 100).toFixed(1);

const refsPath = resolve(ROOT, arg('refs', 'lit/data-refs/_refs-cache.json'));
const matchesJournal = (d) => stems.some(s => d.startsWith(s) ||
  // the PII stem is written without its leading "S", which real DOIs carry
  (s.endsWith('(') && d.startsWith(s.replace(/\/(?=[0-9])/, '/s'))));

if (!stems.length || stemShare < 0.9) {
  report.notes.push(stems.length
    ? `Cited-DOI probe SKIPPED: the derived DOI stems cover only ${report.doiStemShare}% of rows, so a stem match could miss or over-reach.`
    : 'Cited-DOI probe SKIPPED: could not derive a journal-specific DOI stem.');
} else if (!existsSync(refsPath)) {
  report.notes.push(`Cited-DOI probe SKIPPED: no reference cache at ${refsPath} (it is populated by lit-references-backfill.yml).`);
} else {
  const have = new Set(rows.map(r => bareDoi(r.DOI)));
  const ourShapes = new Set([...have].map(doiShape));
  const ourCoords = coordIndex(rows);
  const cache = JSON.parse(readFileSync(refsPath, 'utf8'));
  const crawled = Object.keys(cache).length;
  const cited = new Map();                       // journal doi -> citer count
  for (const v of Object.values(cache)) {
    for (const d0 of (v && v.r) || []) {
      // Trailing sentence punctuation is a reference-list artifact, never part
      // of the DOI — strip it before anything else, or a real paper we DO list
      // is reported missing.
      const d = bareDoi(d0).replace(/[.,;:]+$/, '');
      if (matchesJournal(d)) cited.set(d, (cited.get(d) || 0) + 1);
    }
  }
  // An unparseable year counts as IN the window, so a hole is never hidden.
  const inWin = [...cited.keys()].filter(d => { const y = doiYear(d); return y === 0 || y >= FROM; });
  const notHeld = inWin.filter(d => !have.has(d));
  // A cited DOI is a PROVEN hole only if its shape is one this journal uses AND
  // it does not name an article we already carry under another registration.
  const isHole = (d) => ourShapes.has(doiShape(d)) && !heldAtSameCoords(d, ourCoords);
  const absent = notHeld.filter(isHole);                            // proven holes
  const variant = notHeld.filter(d => ourShapes.has(doiShape(d)) && heldAtSameCoords(d, ourCoords));
  const suspect = notHeld.filter(d => !ourShapes.has(doiShape(d))); // malformed citations
  const perYear = new Map();
  for (const d of inWin) {
    const y = doiYear(d) || 0;
    const e = perYear.get(y) || { seen: 0, missing: 0 };
    e.seen++; if (!have.has(d) && isHole(d)) e.missing++;
    perYear.set(y, e);
  }
  const byCiters = (a, b) => (cited.get(b) || 0) - (cited.get(a) || 0);
  report.citedProbe = {
    refsCacheCrawledPapers: crawled,
    citedDoisSeen: cited.size,
    citedDoisInWindow: inWin.length,
    absentFromCatalog: absent.length,
    variantRegistrations: variant.length,
    malformedCitations: suspect.length,
    impliedCoveragePct: inWin.length ? +((1 - absent.length / inWin.length) * 100).toFixed(3) : null,
    perYear: [...perYear.entries()].sort((a, b) => a[0] - b[0])
      .map(([year, e]) => ({ year: year || 'unknown', ...e })),
    missing: absent.sort(byCiters).map(d => ({ doi: d, citers: cited.get(d), doiYear: doiYear(d) || null })),
    suspectDois: suspect.sort(byCiters).map(d => ({ doi: d, citers: cited.get(d) })),
    variantDois: variant.sort(byCiters).map(d => ({ doi: d, citers: cited.get(d) })),
  };
  if (absent.length) {
    report.problems.push(`${absent.length} DOI(s) of this journal are cited by catalog papers but absent from papers-${JKEY}.json`);
  }
  if (variant.length) {
    report.notes.push(`${variant.length} further cited DOI(s) name a volume/issue/first-page this journal DOES carry under another registration (a variant or mistyped DOI for a paper we already list), so they are NOT counted as missing papers. See --verbose.`);
  }
  if (suspect.length) {
    report.notes.push(`${suspect.length} further cited DOI(s) do not match any DOI shape this journal uses — almost certainly malformed citations (OCR slips, stray punctuation), so they are NOT counted as missing papers. See --verbose.`);
  }
  const newestSampled = Math.max(0, ...inWin.map(doiYear));
  report.notes.push(`Cited-DOI probe under-samples the newest years by construction (a just-published paper has no citers yet); it read ${crawled.toLocaleString()} crawled reference lists and saw journal DOIs up to ${newestSampled || 'n/a'}.`);
}

// ── output ──────────────────────────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.problems.length ? 1 : 0);
}

const pct = (x) => x === null ? 'n/a' : `${x}%`;
console.log(`\ncoverage audit — ${JKEY}  (${report.dataset})`);
console.log(`window ${FROM}–${THIS_YEAR}   rows in window ${inWindow.length.toLocaleString()} of ${rows.length.toLocaleString()} total\n`);

console.log('A1. volume run & issue sets');
console.log(`    volumes in window: ${report.volumesInWindow}   expected issues/volume: ${EXPECT_ISSUES || 'n/a'}`);
console.log(`    missing volume numbers: ${missingVols.length ? missingVols.join(', ') : 'none'}`);
if (shortVols.length) {
  for (const s of shortVols) {
    console.log(`    vol ${s.vol} (${s.year}) issues [${s.issues.join(',')}]` +
      (s.inProgress ? '  — newest volume, still filling up' : '  <-- CHECK'));
  }
} else console.log('    every volume carries its usual issue set');

console.log('\nA2. page tiling within issues');
console.log('    year  issues  articles  gaps  gapPages  est.missing  coverage%');
for (const r of report.perYear) {
  const cov = r.articles ? (r.articles / (r.articles + r.estMissing) * 100).toFixed(2) : 'n/a';
  console.log('    ' + String(r.year).padEnd(6) + String(r.issues).padEnd(8) +
    String(r.articles).padEnd(10) + String(r.gaps).padEnd(6) +
    String(r.gapPages).padEnd(10) + String(r.estMissing).padEnd(13) + cov);
}
console.log(`    ---> ${tiledArticles.toLocaleString()} articles tiled, ~${estMissing} suspected missing, coverage ${pct(report.tilingCoveragePct)}`);
if (VERBOSE && gaps.length) {
  console.log('\n    every gap (largest first):');
  for (const g of gaps) {
    console.log(`      vol ${g.vol}/${g.issue} (${g.year}) pages ${g.pages} missing (${g.span}p) — next: ${g.nextTitle}`);
  }
}

console.log('\nB. cited-DOI probe (independent of our journal harvest)');
if (report.citedProbe) {
  const c = report.citedProbe;
  console.log(`    DOI stems ${stems.map(s => `"${s}"`).join(', ')} (${report.doiStemShare}% of rows)`);
  console.log(`    ${c.citedDoisInWindow.toLocaleString()} distinct in-window DOIs of this journal are cited by catalog papers`);
  console.log(`    ${c.absentFromCatalog} of them are NOT in papers-${JKEY}.json  ->  implied coverage ${pct(c.impliedCoveragePct)}`);
  if (VERBOSE) {
    console.log('    year  citedDOIs  missing');
    for (const y of c.perYear) {
      console.log('    ' + String(y.year).padEnd(6) + String(y.seen).padEnd(11) + y.missing);
    }
  }
  if (c.missing.length) {
    console.log('    missing (proven holes — shape matches this journal):');
    for (const m of (VERBOSE ? c.missing : c.missing.slice(0, 20))) {
      console.log(`      ${String(m.citers).padStart(4)} citer(s)  ${m.doi}`);
    }
    if (!VERBOSE && c.missing.length > 20) console.log(`      … ${c.missing.length - 20} more (--verbose)`);
  }
  if (VERBOSE && c.variantDois.length) {
    console.log('    variant registrations of papers we DO hold (NOT missing):');
    for (const m of c.variantDois) console.log(`      ${String(m.citers).padStart(4)} citer(s)  ${m.doi}`);
  }
  if (VERBOSE && c.suspectDois.length) {
    console.log('    malformed citations (NOT counted as missing papers):');
    for (const m of c.suspectDois) console.log(`      ${String(m.citers).padStart(4)} citer(s)  ${m.doi}`);
  }
} else console.log('    skipped');

if (report.notes.length) {
  console.log('\nnotes');
  for (const n of report.notes) console.log(`  · ${n}`);
}
console.log(report.problems.length ? '\nPROBLEMS' : '\nno proven holes found');
for (const p of report.problems) console.log(`  ! ${p}`);
console.log('');
process.exit(report.problems.length ? 1 : 0);
