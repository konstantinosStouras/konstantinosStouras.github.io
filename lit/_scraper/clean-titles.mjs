/*
 * clean-titles.mjs — one-off/maintenance trim of stray trailing separators over
 * a committed data directory.
 * ===========================================================================
 * The pipelines now trim a dangling ',' / ';' / ':' off a title (titleText in
 * build-data.mjs; cleanTitle in the working-papers pipeline) and off each
 * affiliation name (affilName) at ingest. This CLI applies the SAME rules to an
 * already-committed dataset, for the back-catalogue harvested before the guard
 * existed — reported by feedback ticket LIT-260725-YWTL, whose example was
 * "The Lock-In Effect and the Corporate Payout Puzzle," (JEEA, ABS 4 shard).
 *
 * It rewrites each papers-*.json and refreshes recent.json (which carries full
 * row copies). sources.json / meta.json hold no titles, so they are untouched;
 * authors.json / affiliations.json are left to the next daily build (which alone
 * has the ORCID-aware merge), as with dedupe-data.mjs. The registry is unaffected
 * by design: normTitle strips non-alphanumerics, so trimming punctuation cannot
 * change a registry key and no paper can resurface as "recently added".
 *
 *   node lit/_scraper/clean-titles.mjs                       # lit/data
 *   node lit/_scraper/clean-titles.mjs --dir lit/data-ft50   # any dataset dir
 *   node lit/_scraper/clean-titles.mjs --dir ../lit-data-abs4/data
 *   node lit/_scraper/clean-titles.mjs --dir lit/data-workingpapers
 *   ... --dry-run          # report only, write nothing
 * ===========================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOTE: the trim ONLY — deliberately not titleText(). The committed titles were
// already run through stripJats when they were harvested, and re-applying it here
// would MANGLE them: "P<sup>2</sup>-FORM" becomes "P 2 -FORM" and a bare
// "<http://…>" URL is eaten as if it were a tag. Only the newly-added trailing
// -separator trim is missing from the committed data, so only that is applied.
import { trimTrailingSeparators, affilList } from './build-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const DIR = resolve(argOf('--dir') || join(__dirname, '..', 'data'));
const DRY = args.includes('--dry-run');

// Returns the number of fields changed on the row.
function cleanRow(r) {
  let n = 0;
  if (r && typeof r.Title === 'string') {
    const t = trimTrailingSeparators(r.Title);
    if (t !== r.Title) { r.Title = t; n++; }
  }
  if (r && typeof r.Affiliations === 'string') {
    const a = affilList(r.Affiliations);
    if (a !== r.Affiliations) { r.Affiliations = a; n++; }
  }
  return n;
}

if (!existsSync(DIR)) {
  console.error(`clean-titles: no such directory: ${DIR}`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => /^papers-.*\.json$/.test(f)).sort();
if (!files.length) console.log(`clean-titles: no papers-*.json in ${DIR}`);

let totTitles = 0, totAffs = 0, totRows = 0;
const examples = [];

for (const f of files) {
  const rows = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if (!Array.isArray(rows)) continue;
  let titles = 0, affs = 0;
  for (const r of rows) {
    const before = r.Title;
    const beforeAff = r.Affiliations;
    if (!cleanRow(r)) continue;
    if (r.Title !== before) {
      titles++;
      if (examples.length < 12) examples.push(`${f}: ${JSON.stringify(before)} → ${JSON.stringify(r.Title)}`);
    }
    if (r.Affiliations !== beforeAff) affs++;
  }
  totRows += rows.length;
  totTitles += titles; totAffs += affs;
  if (titles || affs) {
    if (!DRY) writeFileSync(join(DIR, f), JSON.stringify(rows), 'utf8');
    console.log(`  ${f}: ${titles} title(s), ${affs} affiliation(s)`);
  }
}

// recent.json carries full row copies — keep it consistent with the papers files.
const recentPath = join(DIR, 'recent.json');
if (existsSync(recentPath)) {
  const recent = JSON.parse(readFileSync(recentPath, 'utf8'));
  if (Array.isArray(recent)) {
    let n = 0;
    for (const r of recent) if (cleanRow(r)) n++;
    if (n) {
      if (!DRY) writeFileSync(recentPath, JSON.stringify(recent), 'utf8');
      console.log(`  recent.json: ${n} row(s) cleaned`);
    }
  }
}

if (examples.length) {
  console.log('\nexamples:');
  for (const e of examples) console.log('  ' + e);
}
console.log(`\n${DRY ? '[dry-run] ' : ''}${DIR}: ${totTitles} title(s) + ${totAffs} affiliation(s) cleaned over ${totRows} rows.`);
