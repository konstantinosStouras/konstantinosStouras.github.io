/*
 * build-data.mjs — the ms2 data pipeline (Google-free).
 * ===========================================================================
 * This is the *entire* backend for stouras.com/fun/ms2/. It runs on a GitHub
 * Actions runner (see .github/workflows/ms2-update-data.yml), talks directly to
 * the public Crossref REST API, and writes a handful of static JSON files into
 * fun/ms2/data/. GitHub Pages then serves those JSON files from its CDN, and the
 * ms2 page reads them with plain fetch(). There is no database and no Google
 * Sheet anywhere in the path a visitor touches.
 *
 * What it produces in fun/ms2/data/:
 *   papers.json        every Management Science article (the main dataset)
 *   authors.json       per-author aggregates (paper counts, areas, name variants)
 *   affiliations.json  per-affiliation aggregates
 *   recent.json        papers first seen in the last RECENT_WINDOW_DAYS
 *   meta.json          { lastPull, paperCount }
 *   _registry.json     internal: DOI -> date first seen (so "recently added" works)
 *
 * Run locally for a smoke test with a mock feed instead of hitting Crossref:
 *   MS2_MOCK=./mock-crossref.json node build-data.mjs
 *
 * Node 20+ only (uses global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

// Management Science (INFORMS). Both ISSNs resolve to the same journal on Crossref.
const ISSN = '0025-1909';
const MAILTO = process.env.MS2_MAILTO || 'kstouras@gmail.com';
const ROWS = 1000;                 // Crossref max page size
const RECENT_WINDOW_DAYS = 90;     // buffer; the page itself shows the last 4 weeks
const SEED_COUNT = 40;             // on the very first run, mark the newest N as "just added"
const TOP_AFFILIATIONS = 1500;     // cap the affiliations file so it stays small

// The date we stamp newly seen papers with. Overridable so a re-run is reproducible.
const PULL_DATE = process.env.MS2_PULL_DATE || new Date().toISOString().slice(0, 10);

// One-time import of the editor/area data the /fun/ms/ Google Sheet collected
// from sources that don't exist on Crossref (INFORMS page scrapes + a manually
// curated tab). Used only when a paper's Crossref record yields no editor.
// Built by make-editor-overrides.mjs; { "<doi>": { editor, area? } }.
const OVERRIDES_PATH = join(__dirname, 'editor-overrides.json');
const OVERRIDES = existsSync(OVERRIDES_PATH)
  ? JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'))
  : {};

// ── Crossref fetch ─────────────────────────────────────────────────────────

const SELECT = [
  'DOI', 'title', 'author', 'issued', 'published-print', 'published-online',
  'created', 'volume', 'issue', 'page', 'abstract', 'type', 'group-title',
  'subject', 'container-title', 'short-container-title', 'assertion',
].join(',');

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `ms2-scraper/1.0 (mailto:${MAILTO})` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 5) throw e;
    const wait = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
    console.warn(`  fetch failed (${e.message}); retry ${attempt + 1} in ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
    return fetchJson(url, attempt + 1);
  }
}

// Pull every Management Science work via Crossref cursor pagination.
async function fetchAllWorks() {
  if (process.env.MS2_MOCK) {
    const raw = JSON.parse(await readFile(resolve(process.cwd(), process.env.MS2_MOCK), 'utf8'));
    const items = raw.message ? raw.message.items : raw;
    console.log(`MOCK feed: ${items.length} items from ${process.env.MS2_MOCK}`);
    return items;
  }
  const base = `https://api.crossref.org/journals/${ISSN}/works`;
  let cursor = '*';
  const all = [];
  let page = 0;
  for (;;) {
    const url = `${base}?rows=${ROWS}&cursor=${encodeURIComponent(cursor)}` +
      `&select=${encodeURIComponent(SELECT)}&mailto=${encodeURIComponent(MAILTO)}`;
    const body = await fetchJson(url);
    const items = body.message.items || [];
    all.push(...items);
    page++;
    const total = body.message['total-results'];
    console.log(`  page ${page}: +${items.length} (running total ${all.length}/${total})`);
    cursor = body.message['next-cursor'];
    if (!items.length || !cursor) break;
  }
  return all;
}

// ── Mapping a Crossref record to a ms2 paper row ────────────────────────────

function stripJats(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')          // drop JATS/XML tags
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function yearOf(item) {
  const pick = (d) => d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0];
  return String(
    pick(item.issued) || pick(item['published-print']) ||
    pick(item['published-online']) || pick(item.created) || ''
  ).replace(/^0+$/, '');
}

// Author display name with no internal comma (the page splits the Authors field
// on commas, so a comma inside one name would break the card).
function authorName(a) {
  const nm = [a.given, a.family].filter(Boolean).join(' ') || a.name || '';
  return nm.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

// Trailing abstract sections ("Funding: …", "Supplemental Material: …",
// "History: …", bare URLs) that INFORMS appends right after the acceptance
// sentence and that the capture regex below can swallow when they contain a
// long period-free run (e.g. "…[Grant SRG1920/100428], the …"). The page
// defends itself with the same list (normalizeArea), but cleaning at the
// source keeps the derived files (per-author/affiliation area lists, the
// Areas dropdown vocabulary) clean too — the Sheets pipeline stored areas
// already cleaned, so this restores parity with /fun/ms/.
function stripTrailers(s) {
  return s
    .replace(/\.?\s*(funding|supplemental material|history|data|acknowledgments?|conflicts?[^:]{0,30}|epub)\s*:.*$/i, '')
    .replace(/\.?\s*https?:\/\/.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Editor names are 1-2 people ("D. J. Wu", "X and Y"); anything with sentence
// words in it is a mis-capture of ordinary abstract text (e.g. "…accepted by
// workers when the task is hard…"). Rejecting those leaves the field blank so
// the sheet-imported overrides below can supply the real editor.
function plausibleEditorName(s) {
  if (!s || s.length > 70) return false;
  if (s.split(/\s+/).length > 8) return false;
  if (!/^[A-ZÀ-Þ]/.test(s)) return false;
  return !/\b(the|this|that|is|are|was|were|we|when|which|of|by|in|on|to|as|editors?)\b/i.test(s);
}

// Pull "This paper was accepted by <Editor>, <area>." out of the abstract. The
// page's own cleanEditorField() parses the editor name back out of this exact
// sentence, and normalizeArea() cleans the area, so we hand it the raw sentence.
function acceptance(abstractText) {
  // Prefer the canonical full sentence; only fall back to a bare "accepted by"
  // (which can also match unrelated abstract prose). The capture allows
  // initials in names ("D. J. Wu", "Gérard P. Cachon") before ", <area>.".
  let m = abstractText.match(/(?:this\s+)?(?:paper|work)\s+(?:was|has\s+been)\s+accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
  if (!m) m = abstractText.match(/accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
  if (!m) return { editor: '', area: '' };
  let body = stripTrailers(m[1].trim());       // e.g. "Gérard P. Cachon, finance"
  const comma = body.indexOf(',');
  let area = comma !== -1 ? body.slice(comma + 1).trim() : '';
  if (comma !== -1) body = body.slice(0, comma).trim();
  if (area) {
    // The area part never legitimately spans a sentence break; anything after
    // one is over-captured abstract text.
    area = area.split(/\.\s/)[0].replace(/\.$/, '').trim();
  }
  // "…accepted by <Editor> for the <(Virtual) Special Issue/Section …>": the
  // special-issue title is the area, not part of the editor's name — the same
  // split the Sheets pipeline applies. It wins over any comma-area.
  const si = body.match(/^(.*?)\s+for\s+the\s+(.*(?:special\s+issue|special\s+section).*)$/i);
  if (si) { body = si[1].trim(); area = si[2].trim(); }
  if (!plausibleEditorName(body)) return { editor: '', area: '' };
  // Store the full sentence so the page can re-parse the editor name itself.
  return {
    editor: 'This paper was accepted by ' + body + (area ? ', ' + area : '') + '.',
    area,
  };
}

function normArea(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\.\s*$/, '').trim().toLowerCase();
}

// Some papers carry the accepting editor in Crossref's structured `assertion`
// metadata instead of (or before it appears in) the abstract sentence. The
// Google-Sheets pipeline behind /fun/ms/ reads this field first
// (Assertion_Editor), so without it ms2 under-counted several editors. The
// value is a bare name ("Gustavo Manso"); wrap it in the canonical sentence so
// the page's cleanEditorField() parses it exactly like the abstract-sourced ones.
function assertionEditor(item) {
  for (const a of item.assertion || []) {
    const label = ((a.label || a.name || '') + '').toLowerCase();
    if (label.includes('editor')) {
      const v = stripJats(a.value || '');
      if (!v) return '';
      return /accepted by/i.test(v) ? v.replace(/\.?$/, '.')
        : 'This paper was accepted by ' + v.replace(/\.$/, '') + '.';
    }
  }
  return '';
}

function mapWork(item) {
  const title = (item.title && item.title[0]) ? stripJats(item.title[0]) : '';
  if (!title) return null;

  const authorsArr = (item.author || []).map(authorName).filter(Boolean);
  const affSet = new Set();
  (item.author || []).forEach(a => (a.affiliation || []).forEach(af => {
    if (af && af.name) affSet.add(af.name.replace(/\s+/g, ' ').trim());
  }));

  const abstract = stripJats(item.abstract || '');
  let { editor, area: acceptedArea } = acceptance(abstract);
  if (!editor) editor = assertionEditor(item);
  const ov = OVERRIDES[(item.DOI || '').toLowerCase()];
  if (!editor && ov) {
    editor = 'This paper was accepted by ' + ov.editor.replace(/\.+$/, '') + '.';
  }
  const groupTitle = Array.isArray(item['group-title']) ? item['group-title'][0] : item['group-title'];
  const subject = Array.isArray(item.subject) ? item.subject[0] : '';
  const area = normArea(acceptedArea) || normArea(ov && ov.area) ||
    normArea(groupTitle) || normArea(subject) || '';

  const volume = item.volume || '';
  const issue = item.issue || '';
  const status = (!volume && !issue) ? 'Articles in Advance' : '';
  const doi = item.DOI ? 'https://doi.org/' + item.DOI : '';

  return {
    Title: title,
    Authors: authorsArr.join(', '),
    Affiliations: [...affSet].join('; '),
    DOI: doi,
    Volume: String(volume),
    Issue: String(issue),
    Page: item.page || '',
    Year: yearOf(item),
    Status: status,
    Abstract: abstract,
    'Accepting Editor': editor,
    Area: area,
    // internal, dropped before writing papers.json:
    _doi: (item.DOI || '').toLowerCase(),
    _orcids: (item.author || []).map(a => (a.ORCID || '').replace(/^https?:\/\/orcid\.org\//, '')),
    _rank: pubRank(item, volume, issue, status),
  };
}

// One sortable number, higher = more recent. Articles in Advance rank highest.
function pubRank(item, volume, issue, status) {
  const aia = status === 'Articles in Advance' ? 1 : 0;
  const y = parseInt(yearOf(item), 10) || 0;
  const v = parseInt(volume, 10) || 0;
  const iss = parseInt(issue, 10) || 0;
  const p = parseInt(String(item.page || '').split(/[-–]/)[0], 10) || 0;
  return aia * 1e13 + y * 1e9 + v * 1e6 + Math.min(iss, 999) * 1e3 + Math.min(p, 999);
}

// ── Registry (DOI -> first-seen date), so "Recently added" survives rebuilds ──

async function loadRegistry() {
  const path = join(DATA_DIR, '_registry.json');
  if (!existsSync(path)) return { map: {}, firstRun: true };
  try {
    return { map: JSON.parse(await readFile(path, 'utf8')), firstRun: false };
  } catch {
    return { map: {}, firstRun: true };
  }
}

function updateRegistry(papers, reg) {
  // On the first ever run we baseline: existing papers get a blank date (they are
  // "already here", not "just added"), except the newest SEED_COUNT which we stamp
  // so the Recently Added view isn't empty on day one. Later runs stamp any DOI we
  // have not seen before with today's pull date.
  const seedSet = new Set();
  if (reg.firstRun) {
    // `papers` is already in newest-first order, so the head is the newest N.
    papers.slice(0, SEED_COUNT).forEach(p => seedSet.add(p._doi));
  }
  for (const p of papers) {
    if (p._doi in reg.map) continue;
    reg.map[p._doi] = reg.firstRun ? (seedSet.has(p._doi) ? PULL_DATE : '') : PULL_DATE;
  }
  return reg.map;
}

// ── Aggregates ──────────────────────────────────────────────────────────────

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Plain code-point comparison — deterministic across machines/locales, unlike
// String.localeCompare (whose collation can vary by environment).
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function buildAuthors(papers) {
  // Two records are the same person when they share an accent-stripped
  // lowercase name OR an ORCID (union-find). Keying on ORCID alone split
  // authors in two whenever Crossref tagged the ORCID on only some of their
  // papers (e.g. "Serguei Netessine" showed as separate 18- and 13-paper
  // entries); the name key keeps those together, while ORCID still merges
  // spelling variants of one person. `papers` is already in deterministic
  // order, so roots, name variants and areas are reproducible run to run.
  const parent = new Map();
  const find = (k) => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); return find(k); };
  const union = (a, b) => { const ra = add(a), rb = add(b); if (ra !== rb) parent.set(rb, ra); };

  const authorNames = (p) => p.Authors ? p.Authors.split(',').map(s => s.trim()).filter(Boolean) : [];
  for (const p of papers) {
    authorNames(p).forEach((name, i) => {
      const nk = 'n:' + stripAccents(name).toLowerCase();
      add(nk);
      const orcid = p._orcids[i] || '';
      if (orcid) union(nk, 'o:' + orcid);
    });
  }

  const byRoot = new Map();
  for (const p of papers) {
    const area = p.Area;
    authorNames(p).forEach((name) => {
      const root = find('n:' + stripAccents(name).toLowerCase());
      let rec = byRoot.get(root);
      if (!rec) { rec = { names: new Map(), papers: 0, areas: new Set() }; byRoot.set(root, rec); }
      rec.papers++;
      rec.names.set(name, (rec.names.get(name) || 0) + 1);
      if (area) rec.areas.add(area);
    });
  }
  const out = [];
  for (const [id, rec] of byRoot) {
    // Display name = the most common spelling; variants = every spelling seen.
    const variants = [...rec.names.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    out.push({
      id,
      Author: variants[0],
      Papers: rec.papers,
      Areas: [...rec.areas].join(', '),
      Name_Variants: variants.join(';'),
    });
  }
  // Total order (Papers desc, then name, then identity) so ties never flip.
  out.sort((a, b) => (b.Papers - a.Papers) || cmp(a.Author, b.Author) || cmp(a.id, b.id));
  return out.map(({ id, ...rest }) => rest);
}

function buildAffiliations(papers) {
  const byAff = new Map();
  for (const p of papers) {
    const affs = p.Affiliations ? p.Affiliations.split(';').map(s => s.trim()).filter(Boolean) : [];
    const seen = new Set(); // count each affiliation at most once per paper
    for (const aff of affs) {
      const key = stripAccents(aff).toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      let rec = byAff.get(key);
      if (!rec) { rec = { name: aff, papers: 0, areas: new Set() }; byAff.set(key, rec); }
      rec.papers++;
      if (p.Area) rec.areas.add(p.Area);
    }
  }
  const out = [...byAff.entries()].map(([key, r]) => ({
    key,
    Affiliation: r.name,
    Papers: r.papers,
    Areas: [...r.areas].join(', '),
    Area_Count: r.areas.size,
  }));
  // Total order (Papers desc, then name, then normalized key) so ties never flip.
  out.sort((a, b) => (b.Papers - a.Papers) || cmp(a.Affiliation, b.Affiliation) || cmp(a.key, b.key));
  return out.slice(0, TOP_AFFILIATIONS).map(({ key, ...rest }) => rest);
}

function buildRecent(papers, registry) {
  const cutoff = new Date(PULL_DATE + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);
  const rows = [];
  for (const p of papers) {
    const ds = registry[p._doi];
    if (!ds) continue;
    const d = new Date(ds + 'T00:00:00');
    if (isNaN(d) || d < cutoff) continue;
    rows.push({ p, d });
  }
  rows.sort((a, b) => (b.d - a.d) || (b.p._rank - a.p._rank) || cmp(a.p._doi, b.p._doi));
  return rows.map(x => ({ ...publicRow(x.p), 'Date Added': registry[x.p._doi] }));
}

// Drop the internal helper fields before writing to disk.
function publicRow(p) {
  const { _doi, _orcids, _rank, ...rest } = p;
  return rest;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`ms2 build: pull date ${PULL_DATE}`);
  await mkdir(DATA_DIR, { recursive: true });

  const rawWorks = await fetchAllWorks();

  // Map, keep journal articles with a title, dedupe by DOI.
  const seen = new Set();
  const papers = [];
  for (const item of rawWorks) {
    if (item.type && item.type !== 'journal-article') continue;
    const row = mapWork(item);
    if (!row) continue;
    if (row._doi && seen.has(row._doi)) continue;
    if (row._doi) seen.add(row._doi);
    papers.push(row);
  }
  console.log(`mapped ${papers.length} papers`);

  // Deterministic total order (rank desc, then DOI) BEFORE anything derives from
  // it. Crossref returns pages in a varying order and many papers share a rank
  // (e.g. Articles in Advance with no page number), so without the DOI tiebreak
  // the files would reshuffle every run and rewrite the ~19 MB papers.json even
  // when nothing actually changed. Aggregates are built from this same order so
  // they are reproducible too.
  papers.sort((a, b) => (b._rank - a._rank) || cmp(a._doi, b._doi));

  const reg = await loadRegistry();
  const registry = updateRegistry(papers, reg);

  const authors = buildAuthors(papers);
  const affiliations = buildAffiliations(papers);
  const recent = buildRecent(papers, registry);
  const publicPapers = papers.map(publicRow);

  const meta = { lastPull: PULL_DATE, paperCount: publicPapers.length, source: 'Crossref REST API' };

  await writeJson('papers.json', publicPapers);
  await writeJson('authors.json', authors);
  await writeJson('affiliations.json', affiliations);
  await writeJson('recent.json', recent);
  await writeJson('meta.json', meta);
  await writeJson('_registry.json', registry);

  console.log(`done: ${publicPapers.length} papers, ${authors.length} authors, ` +
    `${affiliations.length} affiliations, ${recent.length} recent`);
}

async function writeJson(name, data) {
  // Minified (no pretty-print) to keep these files small; deterministic output
  // means unchanged data produces identical bytes and no needless git commit.
  await writeFile(join(DATA_DIR, name), JSON.stringify(data), 'utf8');
}

main().catch(e => { console.error(e); process.exit(1); });
