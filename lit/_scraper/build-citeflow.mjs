/*
 * build-citeflow.mjs — journal-to-journal citation flows for the analytics page.
 * ===========================================================================
 * Aggregates the in-catalog citation graph (lit/data-refs/) into a small,
 * committed lit/analytics/citeflow.json that the Data Analytics dashboard's
 * two "Citation flows" Sankey charts read: for every pair of journals, how
 * many references papers of one make to papers of the other — so the page can
 * show, per journal, WHERE its citations go and WHERE its citations come from
 * under the live journal + year filters.
 *
 * INPUT (all committed, offline — no network, like build-analytics.mjs):
 *   lit/data-refs/manifest.json     which journals have a citing shard
 *   lit/data-refs/refs-<jkey>.json  {citingDoi: [citedDoi, …]} per citing journal
 *   lit/data-refs/refs-index.json   {doi: [title, jkey, year, authors?]} for
 *                                   EVERY edge endpoint — the journal + year
 *                                   resolver for both sides of an edge
 *
 * OUTPUT — lit/analytics/citeflow.json:
 *   {
 *     generated,                       // mirrors the refs manifest's date
 *     totals: { edges, journals, pairs },
 *     out: { citingJkey: { citedJkey: { citingYear:  n } } },
 *     in:  { citedJkey:  { citingJkey: { citedYear:  n } } }
 *   }
 * The SAME edge set drives both maps — only the year key differs: `out` is
 * windowed by the CITING paper's publication year (the references made by a
 * journal's papers published in the selected years), `in` by the CITED paper's
 * year (the citations received by a journal's papers published in the selected
 * years) — matching how every other analytics figure windows "papers of that
 * journal within the time frame". Journal display names come from the page's
 * own data.json (every refs jkey is an analytics journal), so none are carried
 * here.
 *
 * Refreshed by .github/workflows/lit-analytics.yml beside build-analytics /
 * build-disruption. Harmless when data-refs/ is empty (writes empty maps).
 * Offline test: node lit/_scraper/citeflow-selftest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIT_DIR = path.resolve(__dirname, '..');
const REFS_DIR = path.join(LIT_DIR, 'data-refs');
const OUT_FILE = path.join(LIT_DIR, 'analytics', 'citeflow.json');

// Same junk-year guard as build-analytics.mjs / build-disruption.mjs (MIN_YEAR
// — keep in sync): an edge whose endpoint carries an absurd or missing year is
// dropped, exactly as those rows are dropped from every other analytics figure.
const MIN_YEAR = 1850;
function cleanYear(y) {
  const n = parseInt(y, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > 2100) return null;
  return n;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

// Aggregate one refs dataset directory into the served citeflow object.
export function buildCiteflow(refsDir) {
  const manifest = readJson(path.join(refsDir, 'manifest.json'), {});
  const index = readJson(path.join(refsDir, 'refs-index.json'), {});
  const shards = manifest.shards || {};
  const out = {};   // citing jkey -> cited jkey -> citing-paper year -> n
  const inn = {};   // cited jkey -> citing jkey -> cited-paper year -> n
  const jset = new Set();
  let edges = 0, droppedYear = 0, droppedIndex = 0;

  for (const jk of Object.keys(shards)) {
    const shard = readJson(path.join(refsDir, shards[jk].file), null);
    if (!shard) continue;
    for (const citingDoi of Object.keys(shard)) {
      const ci = index[citingDoi];
      if (!ci) { droppedIndex += shard[citingDoi].length; continue; }
      const cjk = ci[1], cy = cleanYear(ci[2]);
      for (const citedDoi of shard[citingDoi]) {
        const ti = index[citedDoi];
        if (!ti) { droppedIndex++; continue; }
        const kjk = ti[1], ky = cleanYear(ti[2]);
        if (cy == null || ky == null) { droppedYear++; continue; }
        edges++;
        jset.add(cjk); jset.add(kjk);
        const o = (out[cjk] || (out[cjk] = {}));
        const oy = (o[kjk] || (o[kjk] = {}));
        oy[cy] = (oy[cy] || 0) + 1;
        const i = (inn[kjk] || (inn[kjk] = {}));
        const iy = (i[cjk] || (i[cjk] = {}));
        iy[ky] = (iy[ky] || 0) + 1;
      }
    }
  }

  let pairs = 0;
  for (const a in out) pairs += Object.keys(out[a]).length;

  return {
    // Deterministic like the other analytics builds: the date mirrors the refs
    // manifest, never Date.now(), so a re-run on an unchanged graph is a no-op.
    generated: manifest.generated || '',
    totals: { edges, journals: jset.size, pairs, droppedYear, droppedIndex },
    out,
    in: inn,
  };
}

function main() {
  const flow = buildCiteflow(REFS_DIR);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(flow));
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  console.log('build-citeflow: wrote analytics/citeflow.json (' + kb + ' KB)' +
    '  edges=' + flow.totals.edges + '  journals=' + flow.totals.journals + '  pairs=' + flow.totals.pairs +
    (flow.totals.droppedYear ? '  droppedYear=' + flow.totals.droppedYear : '') +
    (flow.totals.droppedIndex ? '  droppedIndex=' + flow.totals.droppedIndex : ''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
