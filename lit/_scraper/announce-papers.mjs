#!/usr/bin/env node
/*
 * announce-papers.mjs — put a paper that is ALREADY in the catalog under
 * "recently added", as of a date.
 * ===========================================================================
 * The registry (data/_registry.json) stamps each paper's first-seen date once,
 * and the onboarding rule (updateRegistry in build-data.mjs) leaves the
 * back-catalogue un-dated ('') on purpose. A paper that was onboarded as an
 * Article in Advance and reached its issue BEFORE stampPublished existed
 * therefore never appeared under "recently added" — the September-2026
 * Management Science commentaries 10.1287/mnsc.2026.02441 and .02442 were the
 * case that surfaced this. The pipeline cannot re-observe a transition that has
 * already happened, so this maintenance CLI does by hand what stampPublished
 * now does on the day: it writes the date onto the paper's registry entry and
 * rewrites the two derived files that are read from it — recent.json and
 * recent-counts.json — through the pipeline's OWN buildRecent/buildRecentCounts,
 * so the bytes are exactly what the next incremental pass would produce. The
 * papers files are never touched.
 *
 *   node lit/_scraper/announce-papers.mjs --dir lit/data [--date YYYY-MM-DD] [--dry-run] <doi> [<doi>…]
 *   node lit/_scraper/announce-papers.mjs --dir lit/data-ft50 …   (the FT50 catalog, via its own module)
 *
 * --date defaults to today (UTC) and is written onto the paper's registry entry
 * only — the recent window itself stays cut at today, so a date older than the
 * window announces nothing visible (the CLI says so). --dry-run reports what
 * would change and writes nothing; with no DOI at all it is a pure consistency check — the
 * regenerated recent.json / recent-counts.json must equal the committed ones.
 * A DOI that is not in the catalog is refused: this announces a listed paper,
 * it never adds one. Offline, no network. Beside dedupe-data.mjs and
 * clean-titles.mjs.
 * ===========================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = 'usage: node lit/_scraper/announce-papers.mjs --dir <dataset dir> [--date YYYY-MM-DD] [--dry-run] <doi> [<doi>…]';
const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const flag = (name) => argv.includes(name);
if (flag('--help') || flag('-h') || !opt('--dir')) { console.log(USAGE); process.exit(opt('--dir') ? 0 : 2); }
const DIR = resolve(opt('--dir'));
const DATE = opt('--date') || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error(`--date must be YYYY-MM-DD (got ${DATE})`); process.exit(2); }
const DRY = flag('--dry-run');
const dois = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir' || argv[i] === '--date') { i++; continue; }
  if (argv[i].startsWith('--')) continue;
  dois.push(argv[i]);
}
const normDoi = (v) => String(v || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase();

// The FT50 catalog has its own module (near-verbatim, but its own data dir and
// row hydration); the data dir is read from the environment at import time.
// The module's PULL_DATE — the day recent.json's window is cut at and
// recent-counts.json is stamped `generated` — is deliberately LEFT AT TODAY:
// --date goes onto the paper's registry entry only, so a back-dated
// announcement never slides the whole window into the past.
const FT50 = basename(DIR) === 'data-ft50';
process.env[FT50 ? 'FT50_DATA_DIR' : 'LIT_DATA_DIR'] = DIR;
const modPath = FT50 ? join(__dirname, '..', '_scraper-ft50', 'build-data.mjs') : join(__dirname, 'build-data.mjs');
const mod = await import(pathToFileURL(modPath).href);
const hydrate = FT50 ? (rows) => rows.map(mod.rehydrateRow) : (rows) => mod.reInternalize(rows);

const rd = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
if (!existsSync(join(DIR, '_registry.json'))) { console.error(`${DIR}: no _registry.json — not a built dataset dir`); process.exit(2); }
const registry = rd('_registry.json');
const files = readdirSync(DIR).filter(f => /^papers-[a-z0-9-]+\.json$/i.test(f)).sort();
const allPapers = [];
for (const f of files) { const rows = rd(f); if (Array.isArray(rows)) allPapers.push(...hydrate(rows)); }
const byDoi = new Map(allPapers.filter(p => p._doi).map(p => [p._doi, p]));
console.log(`${FT50 ? 'ft50' : 'lit'} announce: ${allPapers.length} papers in ${files.length} files, ` +
  `${Object.keys(registry).length} registry keys, date ${DATE}${DRY ? ' (dry run)' : ''}`);

let bad = 0, stamped = 0;
for (const raw of dois) {
  const d = normDoi(raw);
  const row = byDoi.get(d);
  if (!row) { console.error(`  ${d}: not in the catalog — this announces a listed paper, it never adds one`); bad++; continue; }
  const k = mod.regKey(row);
  if (!(k in registry)) { console.error(`  ${d}: listed but absent from the registry — run a full build first`); bad++; continue; }
  const prev = registry[k];
  console.log(`  ${d}: ${row.JKey} · ${String(row.Title).slice(0, 80)} — ` +
    (prev === DATE ? `already dated ${DATE}` : prev ? `first seen ${prev} → ${DATE}` : `un-dated → ${DATE}`));
  if (prev === DATE) continue;
  registry[k] = DATE; stamped++;
}
if (bad) process.exit(1);

const recent = mod.buildRecent(allPapers, registry);
const counts = mod.buildRecentCounts(allPapers, registry);
if (stamped) {
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - (counts.windowDays || 0));
  if (new Date(DATE + 'T00:00:00Z') < cutoff) console.warn(`  note: ${DATE} is older than the ${counts.windowDays}-day recent window — the registry is stamped, but nothing enters recent.json / the tally.`);
}
const out = { '_registry.json': JSON.stringify(registry), 'recent.json': JSON.stringify(recent), 'recent-counts.json': JSON.stringify(counts) };
let changed = 0;
for (const [f, bytes] of Object.entries(out)) {
  const cur = existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), 'utf8') : null;
  const same = cur === bytes;
  if (!same) changed++;
  console.log(`  ${f}: ${same ? 'unchanged' : `${DRY ? 'would change' : 'rewritten'} (${cur ? cur.length : 0} → ${bytes.length} bytes)`}`);
  if (!same && f === 'recent.json' && cur) {
    const before = JSON.parse(cur);
    const a = new Set(before.map(p => p.DOI)), b = new Set(recent.map(p => p.DOI));
    const added = [...b].filter(x => !a.has(x)), gone = [...a].filter(x => !b.has(x));
    console.log(`    rows ${before.length} → ${recent.length}; +${added.length}${added.length ? ' ' + added.slice(0, 5).join(', ') : ''}` +
      `${gone.length ? `; -${gone.length} ${gone.slice(0, 5).join(', ')}` : ''}`);
  }
  if (!DRY && !same) writeFileSync(join(DIR, f), bytes, 'utf8');
}
console.log(DRY
  ? `dry run: ${stamped} paper(s) would be announced as of ${DATE}; ${changed} file(s) would change; nothing written.`
  : `${stamped} paper(s) announced as of ${DATE}; ${changed} file(s) rewritten; ${recent.length} recent rows, ${counts.total} in the ${counts.windowDays}-day tally.`);
