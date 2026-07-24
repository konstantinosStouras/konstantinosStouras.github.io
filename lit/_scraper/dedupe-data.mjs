/*
 * dedupe-data.mjs — one-off/maintenance duplicate collapse over a committed
 * data directory.
 * ===========================================================================
 * The pipelines now collapse duplicate registrations of the same work at build
 * time (collapseSameWork in build-data.mjs; collapseWpDuplicates in the
 * working-papers pipeline). This CLI applies the SAME rules to an
 * already-committed dataset, for the back-catalogue the old builds harvested
 * before the guard existed: it rewrites each papers-*.json deduped and
 * refreshes the small derived files (sources.json counts, meta.json
 * paperCount/perSource, recent.json rows whose registration was dropped).
 * authors.json / affiliations.json / the registry are left to the next daily
 * build (the registry is append-only, so a dropped registration's entry is
 * inert; the author panels need the ORCID-aware merge only the full build has).
 *
 *   node lit/_scraper/dedupe-data.mjs                       # lit/data
 *   node lit/_scraper/dedupe-data.mjs --dir lit/data-ft50   # any dataset dir
 *   node lit/_scraper/dedupe-data.mjs --dir ../lit-data-abs4/data
 *   node lit/_scraper/dedupe-data.mjs --dir lit/data-workingpapers --wp
 *   ... --dry-run          # report only, write nothing
 * ===========================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseSameWork } from './build-data.mjs';
import { collapseWpDuplicates, recKey as wpRecKey } from '../_scraper-workingpapers/build-data.mjs';
import { normTitle } from './ec-pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const DIR = resolve(argOf('--dir') || join(__dirname, '..', 'data'));
const WP = args.includes('--wp');
const DRY = args.includes('--dry-run');

const rd = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const wr = (f, data) => { if (!DRY) writeFileSync(join(DIR, f), JSON.stringify(data), 'utf8'); };
const rowKey = (r) => {
  const doi = String(r.DOI || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  return doi || ('t:' + normTitle(r.Title) + '|' + (r.Year || ''));
};

if (!existsSync(DIR)) { console.error(`No such data dir: ${DIR}`); process.exit(1); }
const paperFiles = readdirSync(DIR).filter((f) => f.startsWith('papers-') && f.endsWith('.json')).sort();
console.log(`dedupe-data: ${DIR}${WP ? ' (working-papers rules)' : ''}${DRY ? ' [dry-run]' : ''} — ${paperFiles.length} papers file(s)`);

let totalDropped = 0;
const counts = {};      // source key -> deduped row count
const survivors = new Set(); // rowKey of every kept row (for the recent.json filter)

if (WP) {
  // The whole archive collapses as ONE set (the same paper can sit on two
  // hosts), exactly like the crawler's step 3c.
  const byKey = new Map();
  const before = {};
  for (const f of paperFiles) {
    const rows = rd(f);
    before[f] = rows.length;
    for (const r of rows) byKey.set(wpRecKey(r), r);
  }
  const sizeBefore = byKey.size;
  totalDropped = collapseWpDuplicates(byKey);
  console.log(`  archive: ${sizeBefore} -> ${byKey.size} rows (${totalDropped} duplicate posting(s) collapsed)`);
  const bySource = {};
  for (const r of byKey.values()) (bySource[r.JKey] = bySource[r.JKey] || []).push(r);
  for (const f of paperFiles) {
    const key = f.replace(/^papers-|\.json$/g, '');
    const rows = (bySource[key] || []).sort((a, b) =>
      ((parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0)) ||
      (a.Title < b.Title ? -1 : a.Title > b.Title ? 1 : 0));
    counts[key] = rows.length;
    for (const r of rows) survivors.add(wpRecKey(r));
    if (rows.length !== before[f]) {
      console.log(`  ${f}: ${before[f]} -> ${rows.length}`);
      wr(f, rows);
    }
  }
} else {
  for (const f of paperFiles) {
    const key = f.replace(/^papers-|\.json$/g, '');
    const rows = rd(f);
    const deduped = collapseSameWork(rows, null);
    counts[key] = deduped.length;
    for (const r of deduped) survivors.add(rowKey(r));
    if (deduped.length !== rows.length) {
      console.log(`  ${f}: ${rows.length} -> ${deduped.length} (${rows.length - deduped.length} collapsed)`);
      totalDropped += rows.length - deduped.length;
      wr(f, deduped);
    }
  }
}

// Derived files: refresh the counts the page shows; drop recent rows whose
// registration was collapsed away.
if (existsSync(join(DIR, 'sources.json'))) {
  const sources = rd('sources.json');
  let changed = false;
  for (const s of sources) {
    if (counts[s.key] !== undefined && s.count !== counts[s.key]) { s.count = counts[s.key]; changed = true; }
  }
  if (changed) wr('sources.json', sources);
}
if (existsSync(join(DIR, 'meta.json'))) {
  const meta = rd('meta.json');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (meta.paperCount !== total) {
    meta.paperCount = total;
    if (meta.perSource) for (const k of Object.keys(meta.perSource)) {
      if (counts[k] !== undefined) meta.perSource[k] = counts[k];
    }
    wr('meta.json', meta);
  }
}
if (existsSync(join(DIR, 'recent.json'))) {
  const recent = rd('recent.json');
  const kept = recent.filter((r) => survivors.has(WP ? wpRecKey(r) : rowKey(r)));
  if (kept.length !== recent.length) {
    console.log(`  recent.json: ${recent.length} -> ${kept.length}`);
    wr('recent.json', kept);
  }
}

console.log(`done: ${totalDropped} duplicate row(s) removed${DRY ? ' (dry-run, nothing written)' : ''}.`);
