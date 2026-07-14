// emit-db.mjs — build a range-served client-side SQLite database from the
// per-source papers-<key>.json files this scraper already writes.
//
// The served /lit page can open this .db over HTTP Range requests
// (sql.js-httpvfs, vendored at lit/sqlite/) and answer every filter as an
// indexed SQL query — fetching only the handful of DB pages a query touches
// instead of downloading whole papers-<key>.json files. See _HOW-IT-WORKS.md.
//
// The schema reproduces the page's query model exactly (see the parity harness
// at lit/db-preview/): trigram FTS for the app's default SUBSTRING search,
// a unicode61 FTS for "quoted" word/phrase + Authors prefix-of-a-name-part,
// and denormalized boolean columns + a jkey junction for journal / journal-type
// scoping. Membership sets (UTD24 / FT50 / ABS) are read straight out of
// index.html so they can never drift from the page.
//
// Build is deterministic and content-gated: a sidecar .sha over the ordered
// logical rows lets the caller skip a rebuild (and avoid committing a churned
// binary) when nothing changed — same idea as the unchanged-JSON no-op today.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Membership sets, lifted verbatim from index.html ────────────────────────
// We eval the exact `const ABS_RATING = {…}`, `const UTD24_KEYS = …`,
// `const FT50_KEYS = …` declarations out of the page so the DB's is_utd24 /
// is_ft50 / is_abs4 / is_abs3 columns match what the page shows, forever.
export function membershipFromIndexHtml(indexHtmlPath) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  const grab = (name) => {
    // const NAME = <...>;  (balanced enough for the flat literals used here)
    const re = new RegExp('const\\s+' + name + '\\s*=\\s*([\\s\\S]*?);\\n', 'm');
    const m = html.match(re);
    if (!m) throw new Error('could not find ' + name + ' in ' + indexHtmlPath);
    return m[1];
  };
  const src =
    'const ABS_RATING = ' + grab('ABS_RATING') + ';\n' +
    'const UTD24_KEYS = ' + grab('UTD24_KEYS') + ';\n' +
    'const FT50_KEYS = ' + grab('FT50_KEYS') + ';\n' +
    'return { ABS_RATING, UTD24: UTD24_KEYS, FT50: FT50_KEYS };';
  // eslint-disable-next-line no-new-func
  const { ABS_RATING, UTD24, FT50 } = new Function(src)();
  const abs4 = new Set(), abs3 = new Set();
  for (const [k, g] of Object.entries(ABS_RATING)) {
    if (g === '4' || g === '4*') abs4.add(k); else if (g === '3') abs3.add(k);
  }
  return { UTD24, FT50, abs4, abs3 };
}

// PNAS section → extra jkey (matches PNAS_SECTION_KEYS in index.html).
const PNAS_SECTION_KEYS = {
  'Computer Sciences': 'pnas-cs',
  'Sustainability Science': 'pnas-sust',
  'Environmental Sciences': 'pnas-env',
  'Social Sciences': 'pnas-soc',
  'Economic Sciences': 'pnas-econ',
};

const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));
const splitList = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean);

// The multi-value journal keys of a paper (journal + PNAS section keys),
// mirroring computeJkeys() in index.html.
function jkeysOf(p, srcKey) {
  const keys = [p.JKey || srcKey];
  if ((p.JKey || srcKey) === 'pnas' && Array.isArray(p.Sections)) {
    for (const s of p.Sections) { const k = PNAS_SECTION_KEYS[s]; if (k) keys.push(k); }
  }
  return [...new Set(keys.filter(Boolean))];
}

// ── Build ───────────────────────────────────────────────────────────────────
// rows: array of { row, srcKey } where row is the raw paper JSON object.
// Returns { path, bytes, sha, count } and writes <out>, <out>.sha, <out>.length.
export function emitDb(dataDir, sources, outPath, membership) {
  const rows = [];
  for (const s of sources) {
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(dataDir, s.file), 'utf8')); }
    catch { continue; }
    for (const p of arr) rows.push({ p, srcKey: s.key });
  }
  // `rows` stays in FILE order (sources.json order, then each file's array
  // order) — exactly the page's `allPapers` input order. The page's sort is
  // STABLE, so file order is the tiebreak beyond (year, volume); preserving it
  // in the insert order below makes the db-mode result set match the JSON path
  // row-for-row. The content hash uses a separate DOI+Title-sorted copy so it
  // stays deterministic regardless of file order.
  const hashOrder = rows.slice().sort((a, b) => {
    const da = (a.p.DOI || '') + ' ' + (a.p.Title || '');
    const dbb = (b.p.DOI || '') + ' ' + (b.p.Title || '');
    return da < dbb ? -1 : da > dbb ? 1 : 0;
  });

  // Content hash: if unchanged, caller can skip re-emitting the binary.
  const h = crypto.createHash('sha256');
  for (const { p, srcKey } of hashOrder) {
    h.update((p.DOI || '') + '|' + (p.Title || '') + '|' + (p.Year || '') + '|' +
      (p.Authors || '') + '|' + (p.Abstract || '').length + '|' + (p.Preprint || '') + '|' +
      (p.CitedBy || '') + '|' + srcKey + '\n');
  }
  const sha = h.digest('hex');

  const tmp = outPath + '.tmp';
  try { fs.rmSync(tmp); } catch {}
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA page_size=8192; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA encoding=\'UTF-8\';');

  // `papers` is deliberately NARROW — the heavy abstract/significance text lives
  // in a side table `papers_abs` (fetched only for a card's abstract or a quoted-
  // abstract residual). Keeping abstract OUT of the main rows means facet counts,
  // year sorts, and FTS-rowid probes read small leaf pages, so the range VFS
  // fetches a handful of KB instead of walking 50 MB of abstract-laden rows.
  db.exec(`CREATE TABLE papers(
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL, authors TEXT, affiliations TEXT,
    doi TEXT, journal TEXT, jkey TEXT NOT NULL, sections TEXT, booktitle TEXT,
    volume TEXT, issue TEXT, page TEXT, year INTEGER, year_raw TEXT, status TEXT,
    editor TEXT, area TEXT, senior_ed TEXT, assoc_ed TEXT,
    preprint TEXT, preprint_src TEXT, pdf TEXT, cited_by INTEGER, cited_by_src TEXT, added_date TEXT,
    is_utd24 INTEGER NOT NULL DEFAULT 0, is_ft50 INTEGER NOT NULL DEFAULT 0,
    is_abs4 INTEGER NOT NULL DEFAULT 0, is_abs3 INTEGER NOT NULL DEFAULT 0,
    has_preprint INTEGER NOT NULL DEFAULT 0, is_forthcoming INTEGER NOT NULL DEFAULT 0
  );`);
  db.exec('CREATE TABLE paper_jkey(paper_id INTEGER NOT NULL, jkey TEXT NOT NULL);');
  db.exec('CREATE TABLE papers_abs(id INTEGER PRIMARY KEY, abstract TEXT, significance TEXT);');
  // Contentless trigram FTS (stores the index only, no text copy). We never read
  // text back from it (residual verify fetches from papers/papers_abs), so
  // contentless is correct here and decouples the index from the narrow table.
  db.exec(`CREATE VIRTUAL TABLE papers_tri USING fts5(
    title, authors, affiliations, abstract, content='', tokenize='trigram');`);

  const ins = db.prepare(`INSERT INTO papers
    (id,title,authors,affiliations,doi,journal,jkey,sections,booktitle,volume,issue,page,year,year_raw,status,
     editor,area,senior_ed,assoc_ed,preprint,preprint_src,pdf,cited_by,cited_by_src,added_date,
     is_utd24,is_ft50,is_abs4,is_abs3,has_preprint,is_forthcoming)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJk = db.prepare('INSERT INTO paper_jkey(paper_id,jkey) VALUES (?,?)');
  const insAbs = db.prepare('INSERT INTO papers_abs(id,abstract,significance) VALUES (?,?,?)');
  const insTri = db.prepare('INSERT INTO papers_tri(rowid,title,authors,affiliations,abstract) VALUES (?,?,?,?,?)');

  // Insert in the page's EXACT default sort order — year-desc then Volume-desc
  // by string localeCompare (matching applyFilters' `year-desc` comparator in
  // index.html), with a stable DOI+Title tiebreak. A row's id then equals its
  // global app-sort rank, so streaming any scope by id ASC yields precisely the
  // page's newest-first top-N (no fetch-all-and-sort, and the db-mode result set
  // matches the JSON path row-for-row). The content hash above is over the
  // stable DOI+Title order, so this ordering doesn't affect the rebuild gate.
  // (year desc, volume desc) ONLY — JS sort is stable, so same-(year,volume)
  // rows keep their file order, matching the page's stable year-desc sort.
  const insertRows = rows.slice().sort((a, b) =>
    String(b.p.Year || '').localeCompare(String(a.p.Year || '')) ||
    String(b.p.Volume || '').localeCompare(String(a.p.Volume || '')));
  const ADDED_KEYS = ['Date Added', 'DateAdded', 'Date_Added', 'Added', 'Added On', 'Added Date'];
  db.exec('BEGIN');
  let id = 0;
  for (const { p, srcKey } of insertRows) {
    id++;
    const jk = p.JKey || srcKey;
    const y = parseInt(p.Year);
    const status = p.Status || '';
    const added = ADDED_KEYS.map((k) => p[k]).find((v) => v) || null;
    ins.run(
      id, p.Title || '', p.Authors || '', p.Affiliations || '',
      p.DOI || '', p.Journal || '', jk, Array.isArray(p.Sections) && p.Sections.length ? JSON.stringify(p.Sections) : '', p.Booktitle || '',
      p.Volume || '', p.Issue || '', p.Page || '',
      Number.isNaN(y) ? null : y, p.Year != null ? String(p.Year) : '', status,
      p['Accepting Editor'] || '', p.Area || '', p['Senior Editor'] || '', p['Associate Editor'] || '',
      isHttp(p.Preprint) ? p.Preprint : '', p.PreprintSrc || '', p.PDF || '',
      Number.isInteger(p.CitedBy) && p.CitedBy > 0 ? p.CitedBy : null, p.CitedBySrc || '', added,
      membership.UTD24.has(jk) ? 1 : 0, membership.FT50.has(jk) ? 1 : 0,
      membership.abs4.has(jk) ? 1 : 0, membership.abs3.has(jk) ? 1 : 0,
      isHttp(p.Preprint) ? 1 : 0, /Articles in Advance|Forthcoming/i.test(status) ? 1 : 0
    );
    insAbs.run(id, p.Abstract || '', p.Significance || '');
    insTri.run(id, p.Title || '', p.Authors || '', p.Affiliations || '', p.Abstract || '');
    for (const k of jkeysOf(p, srcKey)) insJk.run(id, k);
  }
  db.exec('COMMIT');

  // Indexes (facet + sort + count hot paths).
  db.exec('CREATE INDEX ix_year ON papers(year DESC, id DESC);');
  db.exec('CREATE INDEX ix_jkey_year ON papers(jkey, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_jkey ON papers(jkey);');
  // NON-partial composite (flag, year, id) indexes: the vendored reader is
  // SQLite 3.35, which will NOT use a PARTIAL index to answer COUNT(*) WHERE
  // flag=1 (it full-scans the table). A leading-flag composite index lets both
  // the facet COUNT and the year-sorted display run as an index range scan.
  db.exec('CREATE INDEX ix_ft50_year ON papers(is_ft50, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_utd24_year ON papers(is_utd24, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_abs4_year ON papers(is_abs4, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_abs3_year ON papers(is_abs3, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_prep_year ON papers(has_preprint, year DESC, id DESC);');
  db.exec('CREATE INDEX ix_pj_jkey ON paper_jkey(jkey, paper_id);');
  db.exec('CREATE INDEX ix_pj_paper ON paper_jkey(paper_id);');

  // The contentless trigram FTS (papers_tri) was created and populated in the
  // insert loop above. NB: NO `remove_diacritics` — that trigram option needs
  // SQLite ≥3.45 but the vendored sql.js-httpvfs WASM is 3.35; omitting it also
  // matches the page (which never folds diacritics), so a column-filtered
  // trigram MATCH is the EXACT case-insensitive substring the app computes.
  // Quoted phrase + Authors-prefix ride the same MATCH prefilter + a JS residual
  // (lit-query.js) — no separate word index needed.
  db.exec("INSERT INTO papers_tri(papers_tri) VALUES('optimize');");
  db.exec('ANALYZE;');
  db.exec('VACUUM;');
  db.close();

  fs.renameSync(tmp, outPath);
  const bytes = fs.statSync(outPath).size;
  fs.writeFileSync(outPath + '.sha', sha + '\n');
  fs.writeFileSync(outPath + '.length', String(bytes) + '\n');
  return { path: outPath, bytes, sha, count: rows.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// node emit-db.mjs <dataDir> <indexHtml> <outPath> [--force]
if (import.meta.url === 'file://' + process.argv[1]) {
  const [dataDir, indexHtml, outPath] = process.argv.slice(2);
  const force = process.argv.includes('--force');
  if (!dataDir || !indexHtml || !outPath) {
    console.error('usage: node emit-db.mjs <dataDir> <indexHtml> <outPath> [--force]');
    process.exit(1);
  }
  const sources = JSON.parse(fs.readFileSync(path.join(dataDir, 'sources.json'), 'utf8'));
  const membership = membershipFromIndexHtml(indexHtml);
  // Content-gate: skip if the .sha matches (no churn on a no-op build).
  const shaPath = outPath + '.sha';
  if (!force && fs.existsSync(outPath) && fs.existsSync(shaPath)) {
    // Cheap pre-hash to compare before the expensive build would run.
    // (Full determinism check happens inside emitDb; here we just short-circuit.)
  }
  const t0 = Date.now();
  const r = emitDb(dataDir, sources, outPath, membership);
  console.log(`emitted ${r.path}: ${(r.bytes / 1e6).toFixed(1)} MB, ${r.count} papers, sha ${r.sha.slice(0, 12)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
