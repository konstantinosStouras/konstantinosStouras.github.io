/*
 * counters-selftest.mjs — offline audit of every NUMBER the /lit pages print.
 * ===========================================================================
 * The page shows four counters, each fed by a different derived file, each
 * rewritten by a different pipeline:
 *
 *   1. the header's "N papers from M authors"      sources.json + meta.json
 *      (catalogPaperTotal / loadLastPull in index.html: papers are summed from
 *       every dataset's MANIFEST, authors from every dataset's meta.json)
 *   2. "N papers added in the last 4 weeks"        recent-counts.json
 *      (renderRecent in index.html; recent.json is capped and only supplies the
 *       ROWS, never the number)
 *   3. the analytics scope line + Papers tile      analytics/data.json
 *      ("564,238 papers · 133 journals · … excludes 26,451 non-research items")
 *   4. the analytics Journals-in-scope / citations / co-author tiles (same file)
 *
 * A counter drifts when one of those files stops tracking the papers files it
 * summarises — a pipeline that appends a row but forgets a derived file, a
 * removal that never reaches a manifest, a tally capped like the row list it
 * sits above. This script recomputes each one from the papers files themselves
 * and reports every mismatch. It is pure I/O over the committed datasets: no
 * network, no APIs.
 *
 * Shards are read from a local checkout exactly as build-analytics.mjs finds
 * them ($LIT_SHARDS_DIR, ../_analytics-shards/<repo>/data, or a sibling clone);
 * a shard that isn't checked out is skipped with a note, and so is any dataset
 * whose pipeline has not shipped a recent-counts.json yet.
 *
 *   node lit/_scraper/counters-selftest.mjs
 *   node lit/_scraper/counters-selftest.mjs --quiet   # only failures
 * ===========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recentScopeKey } from './build-data.mjs';
import { normTitle } from './ec-pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(LIT_DIR, '..');
const QUIET = process.argv.includes('--quiet');

const SHARD_REPOS = ['lit-data-abs4', 'lit-data-abs3-omecon', 'lit-data-abs3-rest',
  'lit-data-nature', 'lit-data-science'];
function shardDir(repo) {
  const cands = [];
  if (process.env.LIT_SHARDS_DIR) cands.push(path.join(process.env.LIT_SHARDS_DIR, repo, 'data'));
  cands.push(path.join(REPO_ROOT, '_analytics-shards', repo, 'data'));
  cands.push(path.join(REPO_ROOT, '..', repo, 'data'));
  for (const d of cands) if (fs.existsSync(path.join(d, 'sources.json'))) return d;
  return null;
}

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, msg, detail) => {
  if (cond) { pass++; if (!QUIET) console.log('  ok  ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (detail ? '\n       ' + detail : '')); }
};
const note = (msg) => { skipped++; console.log('  --  ' + msg); };
const rd = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const fmt = (n) => Number(n).toLocaleString('en-US');

// The page's registry key for a committed row (regKey in every build-data.mjs).
const regKeyOf = (r) => {
  const doi = String(r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  return doi || ('t:' + normTitle(r.Title) + '|' + r.Year);
};

// ── one dataset ─────────────────────────────────────────────────────────────
// Returns { key, dir, journals: Map<jkey, rows>, papers, authors } for the
// cross-dataset checks below, or null when the dataset isn't present.
function auditDataset(label, dir, opts = {}) {
  const sources = rd(path.join(dir, 'sources.json'), null);
  const meta = rd(path.join(dir, 'meta.json'), null);
  if (!sources || !meta) { note(`${label}: no dataset at ${dir} — skipped`); return null; }
  console.log(`\n${label}  (${dir.replace(REPO_ROOT + path.sep, '')})`);

  // 1. Manifest counts are what the header sums, so each one must equal the
  //    rows actually served for that journal.
  const rowsByKey = new Map();
  let rowTotal = 0, mismatched = [];
  for (const s of sources) {
    const rows = rd(path.join(dir, s.file || `papers-${s.key}.json`), null);
    if (!Array.isArray(rows)) { mismatched.push(`${s.key}: papers file missing`); continue; }
    rowsByKey.set(s.key, rows);
    rowTotal += rows.length;
    if (rows.length !== s.count) mismatched.push(`${s.key}: manifest ${fmt(s.count)} vs ${fmt(rows.length)} rows`);
  }
  ok(!mismatched.length, `${label}: every manifest count equals its papers file`, mismatched.join('; '));
  ok(meta.paperCount === rowTotal, `${label}: meta.paperCount matches the rows on disk`,
    `meta ${fmt(meta.paperCount)} vs ${fmt(rowTotal)}`);
  const perSourceTotal = Object.values(meta.perSource || {}).reduce((a, b) => a + (b || 0), 0);
  ok(!meta.perSource || perSourceTotal === rowTotal, `${label}: meta.perSource sums to the same total`,
    `perSource ${fmt(perSourceTotal)} vs ${fmt(rowTotal)}`);
  // The header's "from M authors" is the sum of these; a dataset that stops
  // publishing one silently shrinks that number.
  const authors = (meta.authorCountExtras != null) ? meta.authorCountExtras : meta.authorCount;
  ok(opts.noAuthors || authors > 0, `${label}: meta publishes an author count for the header`);

  // 2. The recently-added tally: the number above the "Recently added papers"
  //    list. It must be EXACTLY the additions in its window — recomputed here
  //    from the papers files — and must never be capped the way recent.json is.
  const counts = rd(path.join(dir, 'recent-counts.json'), null);
  const recent = rd(path.join(dir, 'recent.json'), []);
  if (!counts) {
    note(`${label}: no recent-counts.json yet — the page falls back to counting rows`);
  } else {
    const windowDays = counts.windowDays || 0;
    ok(windowDays >= 28, `${label}: the tally's window covers the 4 weeks the page shows`,
      `windowDays=${windowDays}`);
    const cutoff = new Date(counts.generated + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    const registry = opts.wp ? null : rd(path.join(dir, '_registry.json'), {});
    const expect = new Map();
    for (const rows of rowsByKey.values()) {
      for (const r of rows) {
        const ds = opts.wp ? r['Date Added'] : registry[regKeyOf(r)];
        const k = recentScopeKey(r);
        if (!ds || !k || String(ds) < cutoffDay) continue;
        const per = expect.get(k) || expect.set(k, new Map()).get(k);
        per.set(ds, (per.get(ds) || 0) + 1);
      }
    }
    let expectTotal = 0;
    for (const per of expect.values()) for (const n of per.values()) expectTotal += n;
    const diffs = [];
    for (const [k, per] of expect) {
      for (const [d, n] of per) {
        const got = ((counts.days || {})[k] || {})[d] || 0;
        if (got !== n) diffs.push(`${k} ${d}: tally ${got} vs ${n} on disk`);
      }
    }
    for (const k of Object.keys(counts.days || {})) {
      for (const d of Object.keys(counts.days[k])) {
        if (d < cutoffDay) diffs.push(`${k} ${d}: outside the declared window`);
        else if (!(expect.get(k) || new Map()).has(d)) diffs.push(`${k} ${d}: ${counts.days[k][d]} counted, 0 on disk`);
      }
    }
    ok(!diffs.length, `${label}: the tally equals the additions on disk, journal by journal, day by day`,
      diffs.slice(0, 6).join('; ') + (diffs.length > 6 ? ` … (+${diffs.length - 6})` : ''));
    ok(counts.total === expectTotal, `${label}: the tally's total is the sum of its days`,
      `total ${fmt(counts.total)} vs ${fmt(expectTotal)}`);
    // The point of the file: it must survive a burst that the capped row list
    // cannot. Equal counts are fine (a quiet window); fewer never are.
    const inWindowRows = recent.filter(r => String(r['Date Added'] || '') >= cutoffDay).length;
    ok(counts.total >= inWindowRows, `${label}: the tally is never below the rows recent.json carries`,
      `tally ${fmt(counts.total)} vs ${fmt(inWindowRows)} rows`);
    if (counts.total > inWindowRows && !QUIET) {
      console.log(`      (recent.json is capped: ${fmt(inWindowRows)} of ${fmt(counts.total)} rows in the window ` +
        `— the page prints the tally and says it is showing the newest ones)`);
    }
  }
  return { label, dir, rowsByKey, papers: rowTotal, authors: authors || 0 };
}

console.log('counters-selftest — auditing the numbers /lit prints against the data on disk');

const datasets = [];
const native = auditDataset('native', path.join(LIT_DIR, 'data'));
if (native) datasets.push(native);
const ft50 = auditDataset('ft50 catalog', path.join(LIT_DIR, 'data-ft50'));
if (ft50) datasets.push(ft50);
for (const repo of SHARD_REPOS) {
  const dir = shardDir(repo);
  if (!dir) { note(`${repo}: not checked out — skipped (the page 404-skips it the same way)`); continue; }
  const d = auditDataset(repo, dir);
  if (d) datasets.push(d);
}
const wp = auditDataset('working papers', path.join(LIT_DIR, 'data-workingpapers'), { wp: true, noAuthors: true });

// ── the header ──────────────────────────────────────────────────────────────
// catalogPaperTotal(): every native journal, plus every extra journal that is
// not already native (EXTRA_SRC dedups by key, first registration wins).
console.log('\nheader — "N papers from M authors"');
const nativeKeys = new Set(native ? native.rowsByKey.keys() : []);
const seen = new Set(nativeKeys);
let headerPapers = native ? native.papers : 0;
let headerAuthors = native ? native.authors : 0;
for (const d of datasets) {
  if (d === native) continue;
  for (const [k, rows] of d.rowsByKey) {
    if (seen.has(k)) continue;       // a journal the native data (or an earlier
    seen.add(k);                     // dataset) already serves — counted once
    headerPapers += rows.length;
  }
  headerAuthors += d.authors;
}
ok(headerPapers > 0, `header papers = ${fmt(headerPapers)} (${seen.size} journals across ${datasets.length} dataset(s))`);
ok(headerAuthors > 0, `header authors = ${fmt(headerAuthors)}`);
const sharedKeys = ft50 ? [...ft50.rowsByKey.keys()].filter(k => nativeKeys.has(k)) : [];
if (sharedKeys.length) console.log(`      (${sharedKeys.length} journal(s) served by both the native data and the FT50 catalog — counted once: ${sharedKeys.join(', ')})`);
if (wp) console.log(`      (working papers are unpublished and stay out of this total: ${fmt(wp.papers)} rows)`);

// ── the analytics dashboard ─────────────────────────────────────────────────
// Its scope line names the header's own number ("the main browser's header
// counts everything — 590,689 papers at this snapshot"), so the two must agree
// as of the snapshot; the tiles are all derived from the same totals block.
console.log('\nanalytics — scope line + tiles (analytics/data.json)');
const an = rd(path.join(LIT_DIR, 'analytics', 'data.json'), null);
if (!an) {
  note('analytics/data.json missing — skipped');
} else {
  const jSum = an.journals.reduce((a, j) => a + j.papers, 0);
  ok(an.totals.papers === jSum, 'the Papers tile equals the sum of its per-journal rows',
    `totals ${fmt(an.totals.papers)} vs ${fmt(jSum)}`);
  ok(an.totals.journals === an.journals.length, 'the "Journals in scope" tile equals the journals carried',
    `${an.totals.journals} vs ${an.journals.length}`);
  const yearSum = an.journals.reduce((a, j) => a + Object.values(j.years).reduce((x, y) => x + y.n, 0), 0);
  ok(yearSum === jSum, 'every paper sits in exactly one (journal, year) row', `${fmt(yearSum)} vs ${fmt(jSum)}`);
  const nonResearch = an.journals.reduce((a, j) =>
    a + Object.values(j.years).reduce((x, y) => x + (y.x ? y.x.n : 0), 0), 0);
  const researchOnly = an.journals.reduce((a, j) => a + j.rp, 0);
  ok(jSum - nonResearch === researchOnly,
    `the "exclude non-research items" delta reconciles (${fmt(researchOnly)} + ${fmt(nonResearch)} = ${fmt(jSum)})`);
  // The dashboard is rebuilt daily, so it trails the header by up to a day of
  // incremental harvests — a mismatch is only a problem if it is not explained
  // by that lag.
  const missing = datasets.filter(d => ![...d.rowsByKey.keys()].some(k => an.journals.some(j => j.key === k)));
  ok(!missing.length, 'every dataset the page serves is represented in the dashboard',
    missing.map(d => d.label).join(', '));
  const drift = headerPapers - an.totals.papers;
  const sameDay = an.generated === (rd(path.join(LIT_DIR, 'data', 'meta.json'), {}).lastPull || '');
  if (drift === 0) ok(true, `the dashboard total equals the header (${fmt(an.totals.papers)})`);
  else console.log(`  --  the dashboard is ${fmt(Math.abs(drift))} paper(s) ${drift > 0 ? 'behind' : 'ahead of'} the header ` +
    `(snapshot ${an.generated}${sameDay ? ', same pull date' : ''}) — expected between the 08:10 UTC rebuild and the day's harvests` +
    (SHARD_REPOS.some(r => !shardDir(r)) ? '; some shards are not checked out here' : ''));
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(fail ? 1 : 0);
