/*
 * clean-titles.mjs — one-off/maintenance text cleanup over a committed data
 * directory: entity decoding + markup stripping + the trailing-separator trim.
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
 *   ... --derived          # ALSO fix the derived title copies (see below)
 * ===========================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// _entities.mjs decodes FIRST and then strips only letter-led tags, so — unlike
// the old stripJats, which this CLI once had to avoid — re-applying it to the
// committed data is safe: "P<sup>2</sup>-FORM" becomes "P2-FORM" (no stray
// space) and a bare "<http://…>" URL survives. Titles get the full titleText
// (decode + strip + the LIT-260725-YWTL trim); Abstract/Significance get
// cleanText; Authors are decoded with any decoded comma neutralized (the page
// splits Authors on commas); Affiliations go through affilList.
import { cleanText, titleText, affilList } from './_entities.mjs';

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
  if (!r) return 0;
  let n = 0;
  if (typeof r.Title === 'string') {
    const t = titleText(r.Title);
    if (t !== r.Title) { r.Title = t; n++; }
  }
  for (const k of ['Abstract', 'Significance']) {
    if (typeof r[k] === 'string' && r[k]) {
      const v = cleanText(r[k]);
      if (v !== r[k]) { r[k] = v; n++; }
    }
  }
  if (typeof r.Authors === 'string' && r.Authors) {
    // decode per NAME so a decoded comma can never add a phantom author
    const a = r.Authors.split(',')
      .map((x) => cleanText(x).replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(', ');
    if (a !== r.Authors) { r.Authors = a; n++; }
  }
  if (typeof r.Affiliations === 'string') {
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

let totTitles = 0, totAffs = 0, totOther = 0, totRows = 0;
const examples = [];

for (const f of files) {
  const rows = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if (!Array.isArray(rows)) continue;
  let titles = 0, affs = 0, other = 0;
  for (const r of rows) {
    const before = r.Title;
    const beforeAff = r.Affiliations;
    const changed = cleanRow(r);
    if (!changed) continue;
    if (r.Title !== before) {
      titles++;
      if (examples.length < 12) examples.push(`${f}: ${JSON.stringify(before)} → ${JSON.stringify(r.Title)}`);
    }
    if (r.Affiliations !== beforeAff) affs++;
    other += changed - (r.Title !== before ? 1 : 0) - (r.Affiliations !== beforeAff ? 1 : 0);
  }
  totRows += rows.length;
  totTitles += titles; totAffs += affs; totOther += other;
  if (titles || affs || other) {
    if (!DRY) writeFileSync(join(DIR, f), JSON.stringify(rows), 'utf8');
    console.log(`  ${f}: ${titles} title(s), ${affs} affiliation(s), ${other} other field(s)`);
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

// ── derived files that carry their own COPY of a title ──────────────────────
// The citation-graph index and the two analytics tables embed titles so the
// page can render a cited/citing paper, a most-cited row or a compared paper
// without downloading its journal's papers file. Each is re-derived from the
// papers files by its own build (references backfill every 3 h, analytics
// daily), so they self-heal — but only on that cadence, which would leave a
// fixed title still shouting in the citation panels for hours. `--derived`
// applies the same titleText to them now. Off by default: it is only correct
// when run against the SITE repo's own dirs, right after cleaning lit/data*.
if (args.includes('--derived')) {
  const SITE = resolve(__dirname, '..', '..');
  // path -> fn(parsed json) -> number of titles changed
  const DERIVED = [
    [join(SITE, 'lit', 'data-refs', 'refs-index.json'), (idx) => {
      // { doi: [title, jkey, year, authors?] }
      let n = 0;
      for (const k of Object.keys(idx)) {
        const row = idx[k];
        if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
        const t = titleText(row[0]);
        if (t !== row[0]) { row[0] = t; n++; }
      }
      return n;
    }],
    [join(SITE, 'lit', 'analytics', 'disruption.json'), (d) => {
      let n = 0;
      for (const r of (Array.isArray(d.papers) ? d.papers : [])) {
        if (!r || typeof r.ti !== 'string') continue;
        const t = titleText(r.ti);
        if (t !== r.ti) { r.ti = t; n++; }
      }
      return n;
    }],
    [join(SITE, 'lit', 'analytics', 'data.json'), (d) => {
      let n = 0;
      const fixList = (list) => {
        for (const e of (Array.isArray(list) ? list : [])) {
          if (!e || typeof e.t !== 'string') continue;
          const t = titleText(e.t);
          if (t !== e.t) { e.t = t; n++; }
        }
      };
      for (const key of Object.keys(d.journals || {})) {
        const j = d.journals[key];
        if (!j) continue;
        fixList(j.topCited);
        for (const dim of Object.keys(j.dims || {})) {
          for (const val of Object.keys(j.dims[dim] || {})) fixList(j.dims[dim][val].tc);
        }
      }
      return n;
    }],
  ];
  console.log('\nderived title copies:');
  for (const [path, fix] of DERIVED) {
    if (!existsSync(path)) { console.log(`  ${path}: absent, skipped`); continue; }
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const n = fix(parsed);
    if (n && !DRY) writeFileSync(path, JSON.stringify(parsed), 'utf8');
    console.log(`  ${path.slice(SITE.length + 1)}: ${n} title(s)${n && DRY ? ' (dry-run)' : ''}`);
  }
}

if (examples.length) {
  console.log('\nexamples:');
  for (const e of examples) console.log('  ' + e);
}
console.log(`\n${DRY ? '[dry-run] ' : ''}${DIR}: ${totTitles} title(s) + ${totAffs} affiliation(s) + ${totOther} abstract/author field(s) cleaned over ${totRows} rows.`);
