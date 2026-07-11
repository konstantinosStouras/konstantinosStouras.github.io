/*
 * preprints-local.mjs — RUN THIS ON YOUR OWN MACHINE (not in CI).
 * ===========================================================================
 * Backfills fun/lit/data/_preprints.json (and writes the Preprint / PreprintSrc
 * fields into papers-<key>.json) by finding each paper's free author pre-print
 * on arXiv or SSRN.
 *
 * Why local? The link is found with an OpenAlex title.search — ONE request per
 * paper (the pre-print is a separate OpenAlex record with its own
 * 10.2139/ssrn.* DOI, not attached to the published DOI). Across ~30k papers
 * OpenAlex throttles GitHub's shared runner IPs hard, so the daily build only
 * does a small, time-boxed best-effort pass. From a normal home/university
 * connection the same search runs at full speed. Same "run it locally" pattern
 * as informs-editors-local.mjs / pnas-concepts-local.mjs.
 *
 * Usage (Node 20+, no npm install needed):
 *   cd fun/lit/_scraper
 *   node preprints-local.mjs                  # backfill everything (resume-safe)
 *   node preprints-local.mjs --cap=4000       # bound one session
 *   node preprints-local.mjs --source=ms,opre # only these sources
 *
 * It is resume-safe: results are cached in _preprints.json (doi -> {u,s} |
 * {none:1,ts:1}), so each paper is title-searched at most once. Run it in as
 * many sittings as you like (newest papers first). Then commit + push
 * fun/lit/data/_preprints.json + the papers-*.json it updated; the daily build
 * re-applies the cache, so the links persist across rebuilds.
 *
 * Run it after a data build has landed (it reads the DOI/title/author lists
 * from the committed papers-<key>.json).
 * ===========================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local runs identify to OpenAlex as the UCD address — a separate polite-pool
// identity from the CI build's (kstouras@gmail.com) — so a CI mishap spending
// its daily quota can never block a local run, and vice versa. LIT_MAILTO
// still overrides. Must be set BEFORE importing build-data.mjs, which reads
// it at module load; hence the dynamic import.
process.env.LIT_MAILTO = process.env.LIT_MAILTO || 'kostas.stouras@ucd.ie';
const { searchPreprintsByTitle } = await import('./build-data.mjs');
console.log(`OpenAlex contact (quota identity): ${process.env.LIT_MAILTO}`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const cap = parseInt(argVal('cap', '100000'), 10);
const onlySrc = (argVal('source', '') || '').split(',').map(s => s.trim()).filter(Boolean);

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

const sources = await loadJson(join(DATA, 'sources.json'), []);
const cache = await loadJson(join(DATA, '_preprints.json'), {});

const filesByKey = {};   // key -> rows
const all = [];
for (const s of sources) {
  if (onlySrc.length && !onlySrc.includes(s.key)) continue;
  const rows = await loadJson(join(DATA, s.file), []);
  if (!Array.isArray(rows) || !rows.length) continue;
  filesByKey[s.key] = rows;
  for (const r of rows) {
    r._doi = (r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
    r.JKey = r.JKey || s.key;                 // searchPreprintsByTitle skips pnas / <2005
    all.push(r);
  }
}
console.log(`loaded ${all.length} papers from ${Object.keys(filesByKey).length} source(s); ` +
  `${Object.keys(cache).length} cache entries`);

// No budgetMs → run to completion (or --cap). patient:true rides through
// OpenAlex rate-limits (waits with escalating backoff and retries the same
// paper) instead of stopping, and progress checkpoints to _preprints.json
// every 200 searches so Ctrl+C never loses work. Pacing is gentle (~4 req/s).
const found = await searchPreprintsByTitle(all, cache, {
  cap,
  sleepMs: 250,
  patient: true,
  log: true,
  checkpoint: (c) => writeFile(join(DATA, '_preprints.json'), JSON.stringify(c), 'utf8'),
});
console.log(`linked ${found} new pre-print(s) this session`);

// Apply the cache to the rows and write everything back.
let updated = 0;
for (const [key, rows] of Object.entries(filesByKey)) {
  for (const r of rows) {
    const x = cache[r._doi];
    if (x && x.u) { r.Preprint = x.u; r.PreprintSrc = x.s; updated++; }
    delete r._doi;                            // strip the helper field before writing
  }
  const s = sources.find(x => x.key === key);
  await writeFile(join(DATA, s.file), JSON.stringify(rows), 'utf8');
}
await writeFile(join(DATA, '_preprints.json'), JSON.stringify(cache), 'utf8');
console.log(`wrote _preprints.json + ${Object.keys(filesByKey).length} papers-*.json ` +
  `(${updated} papers now carry a pre-print link). Commit + push data/ to publish.`);
