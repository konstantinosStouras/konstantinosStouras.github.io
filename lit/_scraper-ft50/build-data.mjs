/*
 * build-data.mjs — lit's OWN FT50 pipeline (the lit merged catalog).
 * ===========================================================================
 * This is lit's independent copy of the fun/ft50 data pipeline, vendored
 * so the lit page's FT50 merge does not depend on the fun/ft50 app or its
 * dataset. It runs on a GitHub Actions runner (see
 * .github/workflows/lit-ft50-update-data.yml), pulls every article of all 50
 * journals on the Financial Times "FT50" research-rank list from the Crossref
 * REST API, and writes static JSON into lit/data-ft50/, which GitHub
 * Pages serves from its CDN. No server, no database, no Google. The dataset
 * was seeded by copying fun/ft50/data/ (including its _registry.json, so
 * "recently added" history carried over); from then on this pipeline
 * maintains it on its own.
 *
 * The journal list itself lives in _scraper-ft50/journals.json (one entry per
 * journal: key, name, ISSNs, publisher, capability flags). It is checked
 * against the live FT50 list once a year by _scraper-ft50/check-ft50-list.mjs
 * (.github/workflows/lit-ft50-check-list.yml), which updates journals.json
 * when the Financial Times adds or removes journals and then dispatches this
 * build, so the dataset follows the list automatically.
 *
 * Per-journal capabilities (mirroring lit):
 *   • editors:   Management Science only — the "This paper was accepted by …"
 *     editor/area extraction.
 *   • seEditors/aeEditors: Senior/Associate Editor names from the INFORMS
 *     "History:" line (ISR both, Marketing Science SE only) — parsed from the
 *     Crossref abstract when deposited there, otherwise joined from the
 *     committed cache built by lit/_scraper/informs-editors-local.mjs
 *     (pubsonline.informs.org blocks cloud IPs).
 *   • aia: the journal has an advance-publication stage (Articles in Advance /
 *     OnlineFirst / EarlyView / in-press), so a record without volume+issue is
 *     a genuine advance article. Off for the practitioner magazines (HBR, MIT
 *     SMR), whose records often lack volume/issue for other reasons.
 *   • limitedCoverage: HBR and MIT SMR register only a fraction of their
 *     articles with Crossref — they are included with whatever exists, and the
 *     page labels them accordingly.
 *
 * What it writes into lit/data-ft50/:
 *   papers-<key>.json    one file per journal (50 files) — the main dataset
 *   sources.json         manifest: per-journal names, files, counts, flags
 *   authors.json         per-author aggregates across all journals (≥2 papers)
 *   affiliations.json    per-affiliation aggregates
 *   recent.json          papers first seen in the last RECENT_WINDOW_DAYS
 *   meta.json            { lastPull, paperCount, authorCount,
 *                        authorCountExtras, journalCount, perSource }
 *                        (authorCounts = distinct authors pre-trim — full
 *                        dataset / excluding the lit page's native six
 *                        journals — for the page's header stat)
 *   _registry.json       internal: DOI/title-key -> date first seen
 *
 * Resilience with 50 journals: a failed Crossref pull for one journal (or a
 * pull that suddenly shrinks below half its committed size) must never sink
 * the build or shrink the dataset — the previously committed papers-<key>.json
 * is reused for that journal and the run continues.
 *
 * Offline smoke test (no network, uses _scraper/mock/):
 *   FT50_MOCK=1 node build-data.mjs
 * Partial run (other journals reuse their committed files):
 *   FT50_ONLY=ms,qje node build-data.mjs
 *
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInformsEditors } from './informs-editors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = process.env.FT50_MOCK === '1';
// Mock runs write to a scratch dir so a smoke test can never pollute the live
// data/ (in particular its _registry.json, which drives "recently added").
const DATA_DIR = process.env.FT50_DATA_DIR
  || (MOCK ? resolve(__dirname, '_mock-out') : resolve(__dirname, '..', 'data-ft50'));
const MOCK_DIR = join(__dirname, 'mock');

const MAILTO = process.env.FT50_MAILTO || 'kstouras@gmail.com';
const ROWS = 1000;                  // Crossref max page size
const PAGE_PAUSE_MS = 120;          // politeness pause between cursor pages
const JOURNAL_PAUSE_MS = 500;       // pause between journals
const RECENT_WINDOW_DAYS = 90;      // buffer; the page shows the last 4 weeks
const SEED_PER_SOURCE = 3;          // onboarding: newest N per journal count as "just added"
const INFLUX_PER_SOURCE = 250;      // more unseen papers than this at once = onboarding, not news
const RECENT_CAP = 1500;            // recent.json is pre-fetched on every page load
const TOP_AFFILIATIONS = 3000;
const MAX_ABSTRACT = 4000;          // chars; keeps the big files bounded
const PULL_DATE = process.env.FT50_PULL_DATE || new Date().toISOString().slice(0, 10);
const ONLY = (process.env.FT50_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);

// ── The FT50 journal list (data-driven; see check-ft50-list.mjs) ────────────

const JOURNALS_PATH = join(__dirname, 'journals.json');
const ALL_JOURNALS = JSON.parse(await readFile(JOURNALS_PATH, 'utf8'));
const JOURNALS = ALL_JOURNALS.filter(j => !j.retired);
const RETIRED = ALL_JOURNALS.filter(j => j.retired);
// Sharded journals live on satellite data sites (their own repo + GitHub
// Pages + pipeline, for growing past this repo's 1 GB Pages limit): this
// build neither pulls nor writes them — it only forwards their manifest
// entry (key/name/base/flags), so the page knows where to fetch their file.
const LOCAL_JOURNALS = JOURNALS.filter(j => !j.base);
const SHARDED_JOURNALS = JOURNALS.filter(j => j.base);

// One-time import of MS editor/area data collected by the old Google-Sheet
// pipeline from sources that don't exist on Crossref. Shared with the lit pipeline.
const MS_OVERRIDES_PATH = resolve(__dirname, '..', '..', 'ms', '_scraper', 'editor-overrides.json');
const MS_OVERRIDES = existsSync(MS_OVERRIDES_PATH)
  ? JSON.parse(await readFile(MS_OVERRIDES_PATH, 'utf8'))
  : {};

// Curated volume/issue fixups (keyed by DOI, shared across journals) for
// advance-access records that Crossref froze without a volume/issue — otherwise
// they read as "Articles in Advance" forever. { "<doi>": { volume, issue, page?,
// year? } }. Filled only when Crossref itself still returns none.
const AIA_FIXUPS_PATH = MOCK ? join(MOCK_DIR, 'aia-fixups.json') : join(DATA_DIR, '_aia-fixups.json');
const AIA_FIXUPS = existsSync(AIA_FIXUPS_PATH)
  ? JSON.parse(await readFile(AIA_FIXUPS_PATH, 'utf8'))
  : {};

// Forthcoming papers a publisher lists on its "Articles in Advance" page but
// Crossref has not indexed yet. Built on a personal machine by
// _scraper/informs-aia-local.mjs (some publisher sites block cloud IPs) and
// committed here; each entry names its source ("jkey"). Merged in main().
// { "<doi>": { jkey, Title, Authors?, Affiliations?, Abstract?, 'Accepting Editor'?, Area?, Year? } }.
const AIA_SUPPLEMENT_PATH = MOCK ? join(MOCK_DIR, 'informs-aia.json') : join(DATA_DIR, '_informs-aia.json');
const AIA_SUPPLEMENT = existsSync(AIA_SUPPLEMENT_PATH)
  ? JSON.parse(await readFile(AIA_SUPPLEMENT_PATH, 'utf8'))
  : {};

// ── Incremental "new arrivals" pass config (--incremental) ──────────────────
// The full main() re-pulls all 50 journals' entire Crossref back-catalogues, so
// it can only run once a day. The lighter incremental pass (incrementalMain,
// wired by .github/workflows/lit-ft50-check-new.yml) asks Crossref for ONLY the
// records it (re)indexed in the last few days (filter=from-index-date) for a
// SMALL configured subset of journals, upserts them into the committed
// papers-<key>.json, and rewrites only the small derived files. It writes
// NOTHING when nothing new arrived, so it commits (and redeploys Pages) only on
// a genuine change.
//
// Default subset: Econometrica only. Unlike the six native INFORMS/SAGE journals
// (which lit's own fast pass already covers and which Crossref lists as
// no-volume "Articles in Advance"), Econometrica's publisher assigns an accepted
// paper straight to a future issue, so Crossref never shows it as an advance
// article — the daily build is otherwise the only thing that ever picks it up,
// up to a day late. Polling it here surfaces a new Econometrica paper within
// minutes of Crossref indexing it, exactly like the native journals. Widen with
// FT50_INCR_JOURNALS=ecta,jf,… if ever needed (one Crossref call per journal).
const INCR_LOOKBACK_DAYS = parseInt(process.env.FT50_INCR_LOOKBACK_DAYS || '4', 10);
const INCR_JOURNAL_KEYS = (process.env.FT50_INCR_JOURNALS || 'ecta')
  .split(',').map(s => s.trim()).filter(Boolean);
// Only core bibliographic fields are refreshed on a known DOI; enrichment
// (Preprint/PreprintSrc, an OpenAlex/S2-boosted CitedBy + CitedBySrc, cached
// SE/AE) is left untouched, exactly as in lit's native incremental pass.
const INCR_CORE_FIELDS = ['Title', 'Authors', 'Affiliations', 'Volume', 'Issue',
  'Page', 'Year', 'Status', 'Accepting Editor', 'Area'];

// ── Generic fetch helpers ───────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `ft50-scraper/1.0 (mailto:${MAILTO})` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 5) throw e;
    const wait = 2000 * Math.pow(2, attempt); // 2s…32s
    console.warn(`  fetch failed (${e.message}); retry ${attempt + 1} in ${wait}ms  [${url.slice(0, 96)}…]`);
    await sleep(wait);
    return fetchJson(url, attempt + 1);
  }
}

async function loadJsonIfExists(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// ── Crossref record → paper row ─────────────────────────────────────────────

const SELECT = [
  'DOI', 'title', 'author', 'issued', 'published-print', 'published-online',
  'created', 'volume', 'issue', 'page', 'abstract', 'type', 'group-title',
  'subject', 'container-title', 'short-container-title', 'assertion',
  'is-referenced-by-count',
].join(',');

function stripJats(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
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

// Display name with no internal comma (the page splits Authors on commas).
function authorName(a) {
  const nm = [a.given, a.family].filter(Boolean).join(' ') || a.name || '';
  return nm.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Management Science editor/area extraction (shared with the lit pipeline) ───
// Only applied to records of journals with editors:true (MS alone).

function stripTrailers(s) {
  return s
    .replace(/\.?\s*(funding|supplemental material|history|data|acknowledgments?|conflicts?[^:]{0,30}|epub)\s*:.*$/i, '')
    .replace(/\.?\s*https?:\/\/.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plausibleEditorName(s) {
  if (!s || s.length > 70) return false;
  if (s.split(/\s+/).length > 8) return false;
  if (!/^[A-ZÀ-Þ]/.test(s)) return false;
  return !/\b(the|this|that|is|are|was|were|we|when|which|of|by|in|on|to|as|editors?)\b/i.test(s);
}

function acceptance(abstractText) {
  let m = abstractText.match(/(?:this\s+)?(?:paper|work)\s+(?:was|has\s+been)\s+accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
  if (!m) m = abstractText.match(/accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
  if (!m) return { editor: '', area: '' };
  let body = stripTrailers(m[1].trim());
  const comma = body.indexOf(',');
  let area = comma !== -1 ? body.slice(comma + 1).trim() : '';
  if (comma !== -1) body = body.slice(0, comma).trim();
  if (area) area = area.split(/\.\s/)[0].replace(/\.$/, '').trim();
  const si = body.match(/^(.*?)\s+for\s+the\s+(.*(?:special\s+issue|special\s+section).*)$/i);
  if (si) { body = si[1].trim(); area = si[2].trim(); }
  if (!plausibleEditorName(body)) return { editor: '', area: '' };
  return {
    editor: 'This paper was accepted by ' + body + (area ? ', ' + area : '') + '.',
    area,
  };
}

function normArea(s) {
  const a = (s || '').replace(/<[^>]+>/g, '').replace(/\.\s*$/, '').trim().toLowerCase();
  if (/special issue on (the )?digital finance/.test(a)) return 'special issue on the digital finance';
  return a;
}

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

// ── mapping ────────────────────────────────────────────────────────────────

function mapWork(item, src) {
  let title = (item.title && item.title[0]) ? stripJats(item.title[0]) : '';
  if (!title) return null;
  // POM, Journal of Marketing and JMR tag their fast-track "Articles in
  // Advance" titles with an "EXPRESS: " editorial prefix; strip it so the
  // catalog shows the real paper title.
  if (src.key === 'pom' || src.key === 'jm' || src.key === 'jmr')
    title = title.replace(/^EXPRESS:\s*/, '');

  // Keep names and ORCIDs aligned: filter nameless author entries *before*
  // pairing, or one nameless entry shifts every later ORCID onto the wrong
  // author (which would then poison the ORCID-based merging in authors.json).
  const authorPairs = (item.author || [])
    .map(a => ({ name: authorName(a), orcid: (a.ORCID || '').replace(/^https?:\/\/orcid\.org\//, '') }))
    .filter(x => x.name);
  const authorsArr = authorPairs.map(x => x.name);
  const affSet = new Set();
  (item.author || []).forEach(a => (a.affiliation || []).forEach(af => {
    if (af && af.name) affSet.add(af.name.replace(/\s+/g, ' ').trim());
  }));

  const abstract = stripJats(item.abstract || '').slice(0, MAX_ABSTRACT);

  // Editors/Areas: Management Science only (per the page's design).
  let editor = '', area = '';
  if (src.editors) {
    const acc = acceptance(abstract);
    editor = acc.editor;
    let accArea = acc.area;
    if (!editor) editor = assertionEditor(item);
    const ov = MS_OVERRIDES[(item.DOI || '').toLowerCase()];
    if (!editor && ov) editor = 'This paper was accepted by ' + ov.editor.replace(/\.+$/, '') + '.';
    const groupTitle = Array.isArray(item['group-title']) ? item['group-title'][0] : item['group-title'];
    const subject = Array.isArray(item.subject) ? item.subject[0] : '';
    area = normArea(accArea) || normArea(ov && ov.area) || normArea(groupTitle) || normArea(subject) || '';
  }

  // Senior/Associate Editor from the History line, when the Crossref abstract
  // carries it (ISR both, Marketing Science senior only). The committed
  // pubsonline cache fills the rest — see applyInformsEditors().
  let se = '', ae = '';
  if (src.seEditors) {
    const ed = parseInformsEditors(abstract);
    se = ed.se;
    if (src.aeEditors) ae = ed.ae;
  }

  let volume = item.volume || '';
  let issue = item.issue || '';
  let page = item.page || '';
  let year = yearOf(item);
  // Fill a frozen advance-access record's real issue from the curated fixups so
  // it reads as published, not perpetually "Articles in Advance". Crossref wins
  // whenever it actually carries a volume/issue.
  const fx = AIA_FIXUPS[(item.DOI || '').toLowerCase()];
  if (fx) {
    if (!volume && fx.volume != null && fx.volume !== '') volume = String(fx.volume);
    if (!issue && fx.issue != null && fx.issue !== '') issue = String(fx.issue);
    if (!page && fx.page) page = String(fx.page);
    if (fx.year) year = String(fx.year);
  }
  const status = src.aia ? forthcomingStatus(volume, issue, year, PULL_DATE) : '';
  const doi = item.DOI ? 'https://doi.org/' + item.DOI : '';

  const row = {
    Title: title,
    Authors: authorsArr.join(', '),
    Affiliations: [...affSet].join('; '),
    DOI: doi,
    Volume: String(volume),
    Issue: String(issue),
    Page: page,
    Year: year,
    Status: status,
    Abstract: abstract,
    'Accepting Editor': editor,
    Area: area,
    Journal: src.name,
    JKey: src.key,
    // internal, dropped before writing:
    _doi: (item.DOI || '').toLowerCase(),
    _orcids: authorPairs.map(x => x.orcid),
    _rank: pubRank(year, volume, issue, page, status),
  };
  if (src.seEditors) row['Senior Editor'] = se;
  if (src.aeEditors) row['Associate Editor'] = ae;
  // Crossref citation count (is-referenced-by-count) — a different, lower metric
  // than Google Scholar's; the page labels it "Cited by N · Crossref". Omit
  // zero/missing so it never bloats the papers files or shows a "Cited by 0".
  const citedBy = item['is-referenced-by-count'];
  if (typeof citedBy === 'number' && citedBy > 0) row.CitedBy = citedBy;
  return row;
}

// Overlay Senior/Associate Editor names from the committed cache built by
// lit/_scraper/informs-editors-local.mjs on a personal machine (Crossref
// rarely carries the History line; pubsonline.informs.org blocks cloud IPs).
// Cache shape: { "<doi>": { se: "Name; Name", ae: "Name" } }. The lit cache is
// shared (same DOIs); an ft50-local cache, if ever committed, wins per-DOI.
async function applyInformsEditors(bySource) {
  const litPath = resolve(__dirname, '..', '..', 'lit', 'data', '_informs-editors.json');
  const ownPath = MOCK ? join(MOCK_DIR, 'informs-editors.json') : join(DATA_DIR, '_informs-editors.json');
  const litCache = MOCK ? {} : await loadJsonIfExists(litPath, {});
  const ownCache = await loadJsonIfExists(ownPath, {});
  const map = { ...(litCache.map || litCache), ...(ownCache.map || ownCache) };
  let filled = 0;
  for (const src of JOURNALS) {
    if (!src.seEditors) continue;
    for (const p of bySource[src.key] || []) {
      const rec = map[p._doi];
      if (!rec) continue;
      if (!p['Senior Editor'] && rec.se) { p['Senior Editor'] = rec.se; filled++; }
      if (src.aeEditors && !p['Associate Editor'] && rec.ae) { p['Associate Editor'] = rec.ae; filled++; }
    }
  }
  if (filled) console.log(`  informs editors: filled ${filled} SE/AE fields from the cache`);
}

function pubRank(year, volume, issue, page, status) {
  const aia = status ? 1 : 0; // any non-published status ranks above published
  const y = parseInt(year, 10) || 0;
  const v = parseInt(volume, 10) || 0;
  const iss = parseInt(issue, 10) || 0;
  const p = parseInt(String(page || '').split(/[-–]/)[0], 10) || 0;
  return aia * 1e13 + y * 1e9 + v * 1e6 + Math.min(iss, 999) * 1e3 + Math.min(p, 999);
}

// A no-volume/no-issue article counts as "Articles in Advance" only if it is
// recent; an older one is a published paper whose Crossref record was frozen at
// the advance stage (fill its issue via _aia-fixups.json), not a forthcoming one.
function forthcomingStatus(volume, issue, year, pullDate) {
  if (volume || issue) return '';
  const py = parseInt(String(pullDate).slice(0, 4), 10) || 0;
  const y = parseInt(year, 10) || 0;
  return (y && y >= py - 3) ? 'Articles in Advance' : '';
}

// registry key: DOI when there is one, else a title|year key
function regKey(row) {
  return row._doi || ('t:' + normTitle(row.Title) + '|' + row.Year);
}

// ── same-work duplicate collapse (near-verbatim from lit/_scraper) ──────────
// Crossref keeps superseded registrations alive: publishers re-register the
// same article under a second DOI (SAGE's re-deposit of JMR/JAP back-catalogue,
// JSTOR 10.2307 legacy DOIs beside Wiley's for JoF, Academy of Management's
// "amr.10.xxxx" online-first stubs, plain double-deposits), so a DOI-keyed
// harvest lists the same paper twice. Collapse rows that are provably the SAME
// work — conservative on purpose: recurring same-title items (annual editor
// reports, per-issue notices, multi-part articles) differ in volume/issue/page
// or in authors and are always kept. Titles compare via the fully-collapsing
// matchNorm (not this file's word-gap registry normTitle), same as the
// pre-print matcher.
const DUP_MIN_TITLE = 15;
// matchNorm alone would keep an HTML-entity variant apart ("X\u0304 Control
// Chart" vs "_ X &nbsp; Control Chart" — a real JORS/JSTOR twin), because the
// entity's NAME leaks letters into the collapsed title. Decode entities first,
// like the reference pipeline's ec-pages normTitle.
function dupDecode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]{2,8};/gi, ' ');
}
function dupTitleKey(title) {
  const k = matchNorm(dupDecode(title));
  return k.length >= DUP_MIN_TITLE ? k : '';
}
function dupSurnames(authors) {
  return String(authors || '').split(/[,;]/).map((a) => {
    const parts = stripAccents(String(a)).toLowerCase()
      .replace(/[^a-z ]+/g, ' ').trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }).filter((s) => s.length > 1);
}
function dupShareSurname(a, b) {
  const sa = dupSurnames(a), sb = dupSurnames(b);
  if (!sa.length || !sb.length) return false;
  const set = new Set(sa);
  return sb.some((s) => set.has(s));
}
const dupFirstPage = (p) => String(p || '').split(/[-–]/)[0].trim().toLowerCase()
  .replace(/^n\/a$/, '');
const dupIsStub = (r) => !String(r.Volume || '').trim() && !String(r.Issue || '').trim();

// 'a' same printed location under two DOIs; 'b' online-first stub vs published
// (≤3y apart); 'c' two stubs of one work (≤1y apart). null = not the same work.
export function sameWorkDup(r1, r2) {
  if (!dupTitleKey(r1.Title) || dupTitleKey(r1.Title) !== dupTitleKey(r2.Title)) return null;
  const shared = dupShareSurname(r1.Authors, r2.Authors);
  const v1 = String(r1.Volume || '').trim(), v2 = String(r2.Volume || '').trim();
  if (v1 && v1 === v2 && String(r1.Issue || '').trim() === String(r2.Issue || '').trim()
      && dupFirstPage(r1.Page) === dupFirstPage(r2.Page)) {
    const authorless = !dupSurnames(r1.Authors).length && !dupSurnames(r2.Authors).length;
    return (shared || authorless) ? 'a' : null;
  }
  if (!shared) return null;
  const y1 = parseInt(r1.Year, 10) || 0, y2 = parseInt(r2.Year, 10) || 0;
  const s1 = dupIsStub(r1), s2 = dupIsStub(r2);
  if (s1 !== s2) return Math.abs(y1 - y2) <= 3 ? 'b' : null;
  if (s1 && s2) return Math.abs(y1 - y2) <= 1 ? 'c' : null;
  return null;
}

// Fullness rank deciding WHICH duplicate registration to keep.
export function dupRank(r) {
  const doi = String(r.DOI || '').toLowerCase();
  return (dupIsStub(r) ? 0 : 8) +
    (String(r.Abstract || '').trim() ? 4 : 0) +
    (/[-–]/.test(String(r.Page || '')) ? 2 : 0) +
    (doi && !doi.includes('10.2307/') && !/10\.\d+\/\//.test(doi.replace(/^https?:\/\//, '')) ? 1 : 0);
}

function dupMergeInto(keep, drop) {
  for (const f of ['Authors', 'Affiliations', 'Page', 'Abstract',
    'Accepting Editor', 'Area', 'SE', 'AE', 'Orcids']) {
    if (drop[f] !== undefined && !String(keep[f] ?? '').trim() && String(drop[f] ?? '').trim()) {
      keep[f] = drop[f];
    }
  }
  if ((drop.CitedBy || 0) > (keep.CitedBy || 0)) {
    keep.CitedBy = drop.CitedBy;
    if (drop.CitedBySrc) keep.CitedBySrc = drop.CitedBySrc; else delete keep.CitedBySrc;
  }
  if (!keep.Preprint && drop.Preprint) {
    keep.Preprint = drop.Preprint;
    if (drop.PreprintSrc) keep.PreprintSrc = drop.PreprintSrc;
  }
}

// Collapse duplicate registrations within one source's rows. Deterministic and
// idempotent, so the daily rebuild converges on the same deduped set.
export function collapseSameWork(rows, label) {
  const byTitle = new Map();
  for (const r of rows) {
    const k = dupTitleKey(r.Title);
    if (!k) continue;
    const g = byTitle.get(k);
    if (g) g.push(r); else byTitle.set(k, [r]);
  }
  const dropped = new Set();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    let merged = true;
    while (merged) { // re-scan after each merge so 3+-row groups fully settle
      merged = false;
      for (let i = 0; i < group.length && !merged; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (!sameWorkDup(group[i], group[j])) continue;
          const ri = dupRank(group[i]), rj = dupRank(group[j]);
          const keepJ = rj > ri ||
            (rj === ri && cmp(String(group[j].DOI), String(group[i].DOI)) > 0);
          const keep = keepJ ? group[j] : group[i];
          const drop = keepJ ? group[i] : group[j];
          dupMergeInto(keep, drop);
          dropped.add(drop);
          group.splice(keepJ ? i : j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  if (dropped.size && label) {
    console.log(`  ${label}: collapsed ${dropped.size} duplicate registration(s) of already-listed papers`);
  }
  return dropped.size ? rows.filter((r) => !dropped.has(r)) : rows;
}

// Rebuild the internal fields of a row read back from a committed
// papers-<key>.json (publicRow stripped them before writing). ORCIDs are
// preserved across the reuse cycle via the pipe-joined `Orcids` field that
// publicRow writes (empty slots kept, so index alignment with the Authors list
// survives) — otherwise a journal whose pull is reused would lose ORCID-based
// author merging in authors.json.
function rehydrateRow(row) {
  row._doi = String(row.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  row._orcids = typeof row.Orcids === 'string' ? row.Orcids.split('|') : [];
  delete row.Orcids;
  row._rank = pubRank(row.Year, row.Volume, row.Issue, row.Page, row.Status);
  return row;
}

// ── journal pulls ───────────────────────────────────────────────────────────

async function fetchJournalWorks(src, opts = {}) {
  // opts.sinceIndexDate: restrict to records Crossref (re)indexed on/after that
  // day (filter=from-index-date). Used by the incremental pass so a frequent run
  // reads only the freshly-indexed tail, not the whole back-catalogue.
  const sinceFilter = opts.sinceIndexDate
    ? `filter=${encodeURIComponent(`from-index-date:${opts.sinceIndexDate}`)}&` : '';
  if (MOCK) {
    const raw = await loadJsonIfExists(join(MOCK_DIR, `crossref-${src.key}.json`), null);
    if (!raw) return null; // no fixture -> journal absent from the mock build
    const items = raw.message ? raw.message.items : raw;
    console.log(`  [mock] ${src.key}: ${items.length} items` +
      (opts.sinceIndexDate ? ` (since ${opts.sinceIndexDate})` : ''));
    return items;
  }
  const all = [];
  for (let i = 0; i < src.issns.length; i++) {
    const issn = src.issns[i];
    const before = all.length;
    try {
      const base = `https://api.crossref.org/journals/${issn}/works`;
      let cursor = '*';
      let page = 0;
      for (;;) {
        const url = `${base}?${sinceFilter}rows=${ROWS}&cursor=${encodeURIComponent(cursor)}` +
          `&select=${encodeURIComponent(SELECT)}&mailto=${encodeURIComponent(MAILTO)}`;
        const body = await fetchJson(url);
        const items = body.message.items || [];
        all.push(...items);
        page++;
        if (page % 10 === 0 || !items.length) {
          console.log(`  ${src.key}/${issn} page ${page}: running total ${all.length}/${body.message['total-results']}`);
        }
        cursor = body.message['next-cursor'];
        if (!items.length || !cursor) break;
        await sleep(PAGE_PAUSE_MS);
      }
      console.log(`  ${src.key}/${issn}: +${all.length - before} records`);
    } catch (e) {
      // The primary ISSN must succeed; secondary/predecessor ISSNs are
      // best-effort (a 404 there must not sink the journal).
      if (i === 0) throw e;
      console.warn(`  ${src.key}/${issn}: skipped (${e.message})`);
    }
  }
  return all; // mapJournal dedupes by DOI across ISSNs
}

function mapJournal(rawWorks, src) {
  const seen = new Set();
  const papers = [];
  for (const item of rawWorks) {
    if (item.type && item.type !== 'journal-article') continue;
    const row = mapWork(item, src);
    if (!row) continue;
    if (row._doi && seen.has(row._doi)) continue;
    if (row._doi) seen.add(row._doi);
    papers.push(row);
  }
  return papers;
}

// Load the previously committed papers-<key>.json (rehydrated), or [].
async function loadCommitted(src) {
  const rows = await loadJsonIfExists(join(DATA_DIR, `papers-${src.key}.json`), []);
  return (Array.isArray(rows) ? rows : []).map(rehydrateRow);
}

// Fetch one journal with full failure tolerance: on any error — or on a pull
// that shrinks below half the committed size (a truncated walk, a mis-served
// journal record) — keep the previously committed dataset for this journal.
async function pullJournal(src) {
  const committed = await loadCommitted(src);
  if (ONLY.length && !ONLY.includes(src.key)) {
    console.log(`  ${src.key}: not in FT50_ONLY — reusing the committed file (${committed.length} papers)`);
    return committed;
  }
  let fresh;
  try {
    const raw = await fetchJournalWorks(src);
    if (raw === null) return committed; // mock without fixture
    fresh = mapJournal(raw, src);
  } catch (e) {
    console.warn(`  ${src.key}: pull FAILED (${e.message}) — reusing the committed file (${committed.length} papers)`);
    return committed;
  }
  if (committed.length && fresh.length < committed.length * 0.5 && process.env.FT50_ALLOW_SHRINK !== '1') {
    console.warn(`  ${src.key}: fresh pull holds only ${fresh.length} papers vs ${committed.length} committed — ` +
      'suspicious shrink, reusing the committed file (set FT50_ALLOW_SHRINK=1 to accept it)');
    return committed;
  }
  return fresh;
}

// ── Pre-print (arXiv/SSRN) open-access links, for every source ──────────────
// Any paper with a free author pre-print on arXiv or SSRN gets a `Preprint`
// URL (+ `PreprintSrc`), surfaced on the card as an open-access link. Resolved
// from OpenAlex by DOI — batched exactly like enrichEc — and cached in
// the dataset dir’s _preprints.json (doi -> {u,s} | {none:1}) so the daily build only
// queries DOIs it has not resolved before. Non-fatal end to end: a lookup that
// fails just leaves that paper without a link.

// Canonical arXiv landing URL: strip any pinned version suffix (v2) and any
// .pdf tail so the link always resolves to the LATEST version of the paper.
export function canonArxiv(u) {
  const m = String(u || '').match(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i);
  if (!m) return u;
  const id = m[1].replace(/\.pdf$/i, '').replace(/v\d+$/i, '');
  return `https://arxiv.org/abs/${id}`;
}

// Cached finds may predate the latest-version canonicalisation — normalise on
// every apply so rows always carry the canonical (latest-version) URL.
export function canonPreprint(u) { return canonArxiv(u); }

export function pickPreprint(cands) {
  // http(s) only, and matched on the real hostname (not a substring) so a
  // spoofed host like arxiv.org.evil.com cannot slip into the href. Preference
  // order: arXiv > SSRN (the hosts the paper asked for; arXiv links are
  // stabler) > bioRxiv/medRxiv > NBER > OSF (the broader repositories).
  const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
  const isHost = (h, d) => h === d || h.endsWith('.' + d);
  const list = cands.filter(u => u && /^https?:\/\//i.test(u));
  const find = (d) => list.find(u => isHost(host(u), d));
  const arx = find('arxiv.org');
  if (arx) return { u: canonArxiv(arx), s: 'arxiv' };
  const ssrn = find('ssrn.com');
  if (ssrn) return { u: ssrn, s: 'ssrn' };
  const bio = find('biorxiv.org');
  if (bio) return { u: bio, s: 'biorxiv' };
  const med = find('medrxiv.org');
  if (med) return { u: med, s: 'medrxiv' };
  // NBER: accept both the landing (/papers/wN) and the direct-PDF
  // (/system/files/working_papers/wN/wN.pdf) forms — OpenAlex often supplies
  // only the latter — and canonicalise to the stable landing URL.
  const nber = list.find(u => isHost(host(u), 'nber.org') &&
    /\/(?:papers|system\/files\/working_papers)\/w\d+/i.test(u));
  if (nber) return { u: `https://www.nber.org/papers/${nber.match(/\/(w\d+)/i)[1].toLowerCase()}`, s: 'nber' };
  // OSF: only the preprint server's own pages (osf.io/preprints/...) — a bare
  // osf.io guid is just as often a project or registration, not a pre-print
  // (those still arrive via the 10.31219 OSF-preprint DOI in preprintFromDoi).
  const osf = list.find(u => isHost(host(u), 'osf.io') && /\/preprints\//i.test(u));
  if (osf) return { u: osf, s: 'osf' };
  return null;
}

// An SSRN/arXiv preprint record has its own DOI; turn it into a landing URL.
export function preprintFromDoi(doi) {
  const d = String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  let m = d.match(/^10\.2139\/ssrn\.(\d+)$/);        // SSRN
  if (m) return { u: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${m[1]}`, s: 'ssrn' };
  m = d.match(/^10\.48550\/arxiv\.(.+)$/);           // arXiv (DataCite DOI)
  if (m) return { u: `https://arxiv.org/abs/${m[1].replace(/v\d+$/i, '')}`, s: 'arxiv' };
  // bioRxiv/medRxiv preprint DOIs only: date-coded (2023.01.02.522345) or
  // legacy numeric (121212). The same 10.1101 prefix also covers CSHL Press
  // JOURNALS (gr.*, gad.*, cshperspect.*, pdb.*) — paywalled articles that
  // must never be surfaced as an open-access pre-print. The DOI alone can't
  // say WHICH rxiv hosts it, so the source is the neutral 'cshl'.
  m = d.match(/^10\.1101\/((?:\d{4}\.\d{2}\.\d{2}\.)?\d+)$/);
  if (m) return { u: `https://doi.org/10.1101/${m[1]}`, s: 'cshl' };
  m = d.match(/^10\.3386\/(w\d+)$/i);                // NBER working paper
  if (m) return { u: `https://www.nber.org/papers/${m[1].toLowerCase()}`, s: 'nber' };
  m = d.match(/^10\.31219\/osf\.io\/(\w+)$/);        // OSF preprint
  if (m) return { u: `https://osf.io/${m[1]}`, s: 'osf' };
  return null;
}

// Normalized last-name tokens from "First Last" name strings.
function lastNames(names) {
  const out = new Set();
  for (const n of names) {
    const toks = String(n || '').trim().split(/\s+/);
    const norm = (toks[toks.length - 1] || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    if (norm.length >= 2) out.add(norm);
  }
  return out;
}

// Fully-collapsing title norm for preprint matching, same shape as the
// reference pipeline's (lit/_scraper) ec-pages normTitle: lowercase, NFD
// accent-fold, then strip ALL non-alphanumerics so 'Trade-offs' == 'Tradeoffs'.
// Deliberately NOT this file's registry normTitle, which keeps word gaps.
const matchNorm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

// Among OpenAlex title-search results, find the SAME paper's arXiv/SSRN
// preprint record. Conservative on purpose (a wrong link is worse than none):
// requires an exact-or-prefix title match (titlesMatch), two shared author
// surnames (one for single-author records), a plausible year, and only accepts an arXiv/SSRN-hosted location or preprint
// DOI. Pure → unit-tested.
export function matchPreprintWork(paper, results) {
  const nt = matchNorm(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const w of results || []) {
    const tmw = titlesMatch(nt, matchNorm(w.title || ''));
    if (!tmw) continue;
    const wn = lastNames((w.authorships || []).map(a => (a.author && a.author.display_name) || ''));
    // Double-check the authors, not just one of them: require two shared
    // surnames whenever both records list two or more authors (a single
    // shared surname suffices only for single-author records) — an exact
    // title alone ("Introduction", "Repeated Games") is no proof of identity.
    if (!mine.size || !wn.size) continue;
    const need = Math.min(2, mine.size, wn.size);
    let shared = 0;
    for (const x of wn) if (mine.has(x)) shared++;
    if (shared < need) continue;
    const wy = parseInt(w.publication_year, 10);
    // A preprint precedes publication; a PREFIX match must additionally be
    // near-contemporaneous, or it is likely a same-team title-stem sibling.
    if (py && wy && (wy > py + 1 || wy < py - (tmw === 'exact' ? 12 : 6))) continue;
    const urls = [];
    for (const loc of w.locations || []) if (loc) urls.push(loc.landing_page_url, loc.pdf_url);
    if (w.best_oa_location) urls.push(w.best_oa_location.landing_page_url, w.best_oa_location.pdf_url);
    if (w.primary_location) urls.push(w.primary_location.landing_page_url, w.primary_location.pdf_url);
    const pick = pickPreprint(urls) || preprintFromDoi(w.doi);
    if (pick) return pick;
  }
  return null;
}

// Titles match when the collapsed forms are equal, or one is a PREFIX of the
// other — a working paper often gains or loses a subtitle on publication
// ("Dueling Contests" vs "Dueling Contests and Platform's Coordinating
// Role"). Never below 14 collapsed chars, and only ever used together with
// the two-surname author check, so a title stem alone can't link a paper.
function titlesMatch(a, b) {
  if (!a || !b) return '';
  if (a === b) return 'exact';
  const s = a.length <= b.length ? a : b, l = a.length <= b.length ? b : a;
  if (s.length < 14 || !l.startsWith(s)) return '';
  // The longer title's extra words must not mark a SEPARATE follow-up
  // publication — a comment/reply/corrigendum shares both the stem and the
  // authors, and would link the WRONG paper's pre-print.
  if (/comment|repl(y|ies)|corrigend|errat|rejoinder|retract/i.test(l.slice(s.length))) return '';
  return 'prefix';
}

// Second search engine, Crossref: OpenAlex's coverage of the pre-print
// servers is patchy — many working papers that live on SSRN have no OpenAlex
// record at all — but the pre-print servers mint their DOIs THROUGH Crossref
// (SSRN 10.2139, bioRxiv/medRxiv 10.1101, NBER 10.3386, OSF 10.31219), so
// Crossref has every one. arXiv is the one host NOT here (its DOIs are
// DataCite's) — searchArxivPreprint covers it. Same conservative matching as
// matchPreprintWork; the pure matcher is split out for unit tests.
export function matchCrossrefPreprint(paper, items) {
  const nt = matchNorm(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const it of items || []) {
    const wt = matchNorm(String((Array.isArray(it.title) ? it.title[0] : it.title) || ''));
    const tmc = titlesMatch(nt, wt);
    if (!tmc) continue;
    const wn = lastNames((it.author || []).map(a => (a && a.family) || ''));
    if (!mine.size || !wn.size) continue;
    const need = Math.min(2, mine.size, wn.size);
    let shared = 0;
    for (const x of wn) if (mine.has(x)) shared++;
    if (shared < need) continue;
    const dp = it.issued && it.issued['date-parts'];
    const wy = parseInt(dp && dp[0] && dp[0][0], 10);
    if (py && wy && (wy > py + 1 || wy < py - (tmc === 'exact' ? 12 : 6))) continue;
    const pick = preprintFromDoi(it.DOI);
    if (pick) return pick;
  }
  return null;
}

async function searchCrossrefPreprints(p) {
  const q = String(p.Title || '').replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  // Same-name filters OR together, so one call covers every Crossref-minted
  // pre-print home. Deliberately NO query.author term: Crossref field
  // queries can EXCLUDE records (they are match queries, not mere ranking
  // boosts), and a name-form mismatch would permanently stamp a false miss —
  // the matcher already verifies authors from the returned metadata.
  const url = 'https://api.crossref.org/works?query.bibliographic=' + encodeURIComponent(q) +
    '&filter=prefix:10.2139,prefix:10.1101,prefix:10.3386,prefix:10.31219' +
    '&rows=12&select=DOI,title,author,issued' +
    `&mailto=${encodeURIComponent(MAILTO)}`;
  const r = await oaGet(url);
  // A transient failure (429/timeout/outage) must NOT read as 'searched, no
  // match' — the caller leaves the paper un-stamped so a later run retries.
  if (!r.ok) return { err: 1 };
  return matchCrossrefPreprint({ title: p.Title, year: p.Year, authors: p.Authors },
    (r.json && r.json.message && r.json.message.items) || []);
}

// Third search engine, arXiv's own API: OpenAlex indexes arXiv but its
// title.search is heavily quota-limited (a CI runner burns the day's OpenAlex
// allowance in minutes), and Crossref cannot see arXiv at all (arXiv DOIs are
// DataCite's). export.arxiv.org/api/query is free and unmetered (guidance:
// ~1 request every 3 s — the caller paces itself with axSleepMs), so the
// backfill keeps finding arXiv pre-prints with OpenAlex out of budget. Atom
// XML, parsed dependency-free; parser + matcher are pure → unit-tested.
export function parseArxivAtom(xml) {
  const dec = (s) => String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
  const out = [];
  for (const m of String(xml || '').matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const e = m[0];
    const id = (e.match(/<id>\s*([^<\s]+)\s*<\/id>/) || [])[1] || '';
    const title = dec((e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const year = parseInt((e.match(/<published>\s*(\d{4})/) || [])[1], 10) || 0;
    const authors = [...e.matchAll(/<name>([^<]*)<\/name>/g)].map(x => dec(x[1]));
    if (id && title) out.push({ id, title, year, authors });
  }
  return out;
}

// Among arXiv API results, find the SAME paper's arXiv record — the exact
// conservative contract of matchPreprintWork (titlesMatch + shared author
// surnames + a plausible year; <published> is the v1 date, which precedes
// publication). Pure → unit-tested.
export function matchArxivFeed(paper, entries) {
  const nt = matchNorm(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const e of entries || []) {
    const tm = titlesMatch(nt, matchNorm(e.title || ''));
    if (!tm) continue;
    const wn = lastNames(e.authors || []);
    if (!mine.size || !wn.size) continue;
    const need = Math.min(2, mine.size, wn.size);
    let shared = 0;
    for (const x of wn) if (mine.has(x)) shared++;
    if (shared < need) continue;
    if (py && e.year && (e.year > py + 1 || e.year < py - (tm === 'exact' ? 12 : 6))) continue;
    const u = canonArxiv(e.id);
    if (/^https?:\/\/arxiv\.org\/abs\//i.test(u)) return { u, s: 'arxiv' };
  }
  return null;
}

async function searchArxivPreprint(p) {
  // arXiv's Lucene query: quoted ti: phrase. Possessives are dropped whole
  // ("Platform's" → "Platform" — Lucene strips 's at indexing, so the
  // "platform s" a bare strip would leave breaks the phrase), accents are
  // folded (a non-ASCII char would otherwise leave a broken token), then
  // everything else non-word becomes a space (hyphens/quotes/colons are
  // operators there).
  const axQ = (t) => String(t || '')
    .replace(/['’]s\b/gi, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = axQ(p.Title);
  if (!q) return null;
  // AND a surname for precision — the first author whose folded surname is a
  // single plain token (hyphenated/apostrophe surnames tokenize
  // unpredictably in Lucene and would zero out the whole AND query).
  let au = '';
  for (const name of String(p.Authors || '').split(',')) {
    const toks = name.trim().split(/\s+/);
    const last = (toks[toks.length - 1] || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/^[A-Za-z]{2,}$/.test(last)) { au = last.toLowerCase(); break; }
  }
  const ask = async (phrase) => {
    const query = `ti:"${phrase}"` + (au ? ` AND au:"${au}"` : '');
    const r = await axGet('https://export.arxiv.org/api/query?search_query=' +
      encodeURIComponent(query) + '&max_results=20');
    if (!r.ok) return { err: 1 };
    const entries = parseArxivAtom(r.text);
    // An HTTP-200 body can still be a glitch: arXiv intermittently serves an
    // empty feed (or an error entry) for queries that normally match. Only a
    // feed that either has entries or explicitly says totalResults=0 is a
    // CLEAN conclusion — anything else must read as a transient failure, or
    // the caller would stamp {none:1,ts:TS_VER} and never retry the paper.
    if (entries.some(e => /\/api\/errors/i.test(e.id))) return { err: 1 };
    if (!entries.length &&
        !/<opensearch:totalResults[^>]*>\s*0\s*</i.test(r.text)) return { err: 1 };
    return matchArxivFeed({ title: p.Title, year: p.Year, authors: p.Authors }, entries);
  };
  let pick = await ask(q);
  if (pick) return pick;                     // a find, or {err:1} — both final
  // A working paper often GAINED the published subtitle: retry the pre-colon
  // stem (a phrase matches anywhere inside a longer arXiv title, so the
  // reverse — a paper that LOST its subtitle — is covered by the full query;
  // the matcher's prefix rules still gate what the stem may link to).
  const stem = axQ(String(p.Title || '').split(':')[0]);
  if (stem && stem !== q && stem.replace(/[^A-Za-z0-9]/g, '').length >= 14) {
    await sleep(3100);                       // keep arXiv's 1-request/3s pace
    pick = await ask(stem);
  }
  return pick;
}

// oaGet's text-returning twin, for the arXiv Atom feed: one gentle attempt
// with a hard timeout, no retry stacking.
async function axGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-scraper/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
    if (!res.ok) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      return { ok: false, status: res.status, retryAfter: isNaN(ra) ? 0 : ra };
    }
    return { ok: true, status: 200, text: await res.text() };
  } catch {
    return { ok: false, status: 0, retryAfter: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePreprints(allPapers, cache) {
  // 1. Seed from links we already resolved (EC's PDF is arXiv/SSRN/OA), so we
  //    never spend an OpenAlex call on a paper we can already answer.
  for (const p of allPapers) {
    if (!p._doi || cache[p._doi]) continue;
    const pick = pickPreprint([p.PDF]);
    if (pick) cache[p._doi] = pick;
  }
  if (MOCK) return; // offline: no OpenAlex; the seed above still applies.

  // 2. OpenAlex by DOI, batched — bounded, and optional (see the helper).
  await seedPreprintsByDoi(allPapers, cache, {
    maxBatches: parseInt(process.env.FT50_PREPRINT_DOI_BATCHES || '400', 10),
    budgetMs: 15 * 60 * 1000,
  });

  // 3. Title+author search for papers the by-DOI scan couldn't link — their
  //    arXiv/SSRN preprint exists as a SEPARATE OpenAlex record (own
  //    10.2139/ssrn.* DOI). This is what surfaces most SSRN preprints. It is
  //    strictly TIME-BOUNDED and gentle (see searchPreprintsByTitle) so the
  //    daily build can never hang if OpenAlex throttles the per-paper query;
  //    the full backfill runs online via preprints-ci.mjs (own workflow).
  await searchPreprintsByTitle(allPapers, cache, {
    cap: parseInt(process.env.FT50_PREPRINT_SEARCH_CAP || '2500', 10),
    budgetMs: parseInt(process.env.FT50_PREPRINT_SEARCH_MS || '360000', 10), // 6-minute hard ceiling
    log: true,
  });
}

// The OpenAlex by-DOI pass, batched 50 DOIs per request: reads any pre-print
// location already attached to the published records — 50× cheaper per
// OpenAlex call than a title search, so it runs first and soaks up whatever
// quota the day has. It is OPTIONAL: the title search no longer needs its
// {none:1} stamps (papers with no cache entry are directly eligible), so on
// quota exhaustion it just stops. Bounded by maxBatches AND a wall-clock
// budgetMs (a slow-but-not-failing OpenAlex would otherwise stretch the pass
// past the CI job timeout) so a first full-catalog run (250k DOIs = 5,000
// batches) can never eat a build.
export async function seedPreprintsByDoi(allPapers, cache, opts = {}) {
  const maxBatches = opts.maxBatches ?? 400;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const seen = new Set(), need = [];
  for (const p of allPapers) {
    if (!p._doi || cache[p._doi] || seen.has(p._doi)) continue;
    seen.add(p._doi); need.push(p._doi);
  }
  const capped = need.slice(0, maxBatches * 50);
  if (!need.length) return;
  console.log(`  preprints: resolving ${capped.length} of ${need.length} DOIs via OpenAlex…`);
  let fails = 0;
  for (let i = 0; i < capped.length; i += 50) {
    if (Date.now() > deadline) {
      console.log('  preprints: by-DOI time budget reached — the title search covers the rest.');
      break;
    }
    const batch = capped.slice(i, i + 50);
    const url = 'https://api.openalex.org/works?filter=doi:' + batch.join('|') +
      '&per-page=50&select=doi,open_access,best_oa_location,locations' +
      `&mailto=${encodeURIComponent(MAILTO)}`;
    const r = await oaGet(url);
    if (!r.ok) {
      // Quota/throttle (or a persistent outage): stop the pass — whatever is
      // left unstamped is picked up by the title search or the next run.
      if (r.status === 429 || r.status === 403 || ++fails >= 6) {
        console.log('  preprints: OpenAlex quota/throttle — stopping the by-DOI pass (the title search covers the rest).');
        break;
      }
      await sleep(2000);
      continue;
    }
    fails = 0;
    const byDoi = new Map();
    for (const w of r.json.results || []) {
      byDoi.set(String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(), w);
    }
    for (const doi of batch) {
      const w = byDoi.get(doi);
      if (!w) { cache[doi] = { none: 1 }; continue; }
      const cands = (w.locations || []).flatMap(l => [l && l.landing_page_url, l && l.pdf_url]);
      cands.push(w.best_oa_location && w.best_oa_location.landing_page_url,
                 w.best_oa_location && w.best_oa_location.pdf_url,
                 w.open_access && w.open_access.oa_url);
      cache[doi] = pickPreprint(cands) || { none: 1 };
    }
    if (opts.checkpoint && (i / 50) % 100 === 99) await opts.checkpoint(cache);
    await sleep(400);
  }
}

// A single, gentle OpenAlex GET — one attempt with a hard timeout, NO retry
// stacking. (fetchJson retries 5× with up to 62s of backoff, which is fine for
// a handful of batched calls but lets a throttled per-paper title search drag
// on for hours.) Returns {ok, status, retryAfter, json}.
async function oaGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-scraper/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
    if (!res.ok) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      return { ok: false, status: res.status, retryAfter: isNaN(ra) ? 0 : ra };
    }
    return { ok: true, status: 200, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, retryAfter: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// Search-pass version. Bump whenever the matcher or the host coverage
// expands: cache entries searched under an older version become eligible
// again, so earlier misses are retried with the wider net (never-searched
// papers still go first — see the eligibility sort). v2: bioRxiv/medRxiv/
// NBER/OSF hosts, two-surname author check, year floor 1991 (arXiv's first
// year, instead of 2005).
// v3: SSRN-via-Crossref second engine, prefix-tolerant title match (working
// papers often gain/lose a subtitle on publication), OpenAlex per-page 25.
// v4: arXiv-API third engine, Crossref filter widened to every pre-print
// prefix it mints (bioRxiv/medRxiv, NBER, OSF alongside SSRN), and the
// OpenAlex leg demoted to an optional bonus net (OpenAlex now cuts CI off
// after ~100 title searches/day, so misses are stamped once Crossref+arXiv
// conclude — a future TS_VER bump re-sweeps with all engines).
export const TS_VER = 4;

// Find each unlinked paper's free pre-print by title+author search across
// THREE engines, all matched by the same conservative rules:
//   1. OpenAlex title.search — the widest net (covers every host at once),
//      but quota-limited, so it is a BONUS leg: when OpenAlex throttles or
//      its daily quota dies, the run keeps going on the other two.
//   2. Crossref (backbone) — SSRN/bioRxiv/medRxiv/NBER/OSF all mint their
//      DOIs through Crossref, so this one call covers every host but arXiv.
//   3. arXiv's own API (backbone) — the host Crossref can't see; paced at
//      ~1 request/3 s per arXiv's guidance, and skipped when the OpenAlex
//      leg ran (OpenAlex indexes arXiv comprehensively).
// Cache entries become {u,s} (found, by any engine) or {none:1,ts:TS_VER}
// (searched, nothing — re-eligible whenever TS_VER is bumped). A miss is
// stamped only when the legs REQUIRED for this paper (Crossref always, arXiv
// when OpenAlex didn't run) concluded cleanly — an errored leg leaves the
// entry alone so a later run retries with the full net. Papers with NO cache
// entry are directly eligible (the by-DOI seeding is an optimisation, not a
// prerequisite — this is what lets this catalog's 250k papers backfill
// without waiting for a 5,000-batch by-DOI pass).
// Bounded by `cap` and, when given, a wall-clock `budgetMs`. opts.patient
// (preprints-ci.mjs) additionally rides out OpenAlex per-second throttling
// with escalating backoff (up to maxThrottle consecutive waits, ~3-4 min —
// an OpenAlex that stays down that long is treated as out for the run)
// before giving the leg up.
// Returns the number newly linked.
export async function searchPreprintsByTitle(papers, cache, opts = {}) {
  const cap = opts.cap || 6000;
  const sleepMs = opts.sleepMs || 130;
  const axSleepMs = opts.axSleepMs || 3100;         // arXiv asks for ~1 request/3 s
  const maxThrottle = opts.maxThrottle || 6;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  // opts.priorityKeys: journal keys whose papers are searched FIRST (all years,
  // all authors), ahead of the newest-first backlog — so a caller can surface a
  // named set of journals' pre-prints without waiting for the whole catalog.
  const priorityKeys = opts.priorityKeys;
  const pk = (k) => (priorityKeys && priorityKeys.has(k)) ? 0 : 1;
  const dedup = new Set();
  const eligible = papers
    .filter(p => {
      if (!p._doi || dedup.has(p._doi) || !(parseInt(p.Year, 10) >= 1991)) return false;
      dedup.add(p._doi);
      const c = cache[p._doi];
      // naxiv misses (stamped by Crossref alone when arXiv was unreachable) are
      // always re-eligible, so a later arXiv-healthy run re-checks them.
      return !c || (c.none && ((c.ts || 0) < TS_VER || c.naxiv));
    })
    .sort((a, b) =>
      (pk(a.JKey) - pk(b.JKey)) ||
      (((cache[a._doi] || {}).ts ? 1 : 0) - ((cache[b._doi] || {}).ts ? 1 : 0)) ||
      ((parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0)));
  const todo = eligible.slice(0, cap);
  if (opts.log) console.log(`  preprints: title-searching up to ${todo.length} of ${eligible.length} unlinked papers…`);
  let found = 0, searched = 0, oaBad = 0, crFails = 0, axFails = 0;
  // opts.noArxiv: start with the arXiv leg off. For the FT50 catalog
  // (finance/economics/accounting/management/marketing) papers live on
  // SSRN/NBER, essentially never arXiv, so arXiv's 1-req/3s pacing on every
  // MISS was the dominant cost. With it off, misses are stamped Crossref-only
  // (`naxiv:1`, re-checked later), and the run flies through the catalog on
  // Crossref (~0.4s/paper) instead of ~3.8s. The daily build keeps all engines.
  let oaAlive = true, axAlive = !opts.noArxiv;
  if (opts.noArxiv && opts.log) console.log('  preprints: arXiv leg disabled for this run — Crossref-only misses (naxiv), re-checked when a later run re-enables arXiv.');
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    if (Date.now() > deadline) { if (opts.log) console.log('  preprints: title-search time budget reached — resuming next run.'); break; }
    // Without arXiv AND without OpenAlex, only Crossref remains — but Crossref
    // still FINDS SSRN/NBER/bioRxiv/OSF pre-prints (the whole point of this
    // catalog), so keep going instead of stalling. A clean Crossref result now
    // stamps a `naxiv` miss (below) that a later arXiv-healthy run re-checks;
    // Crossref itself failing is caught by the crFails backstop.
    const q = String(p.Title || '').replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) { cache[p._doi] = { none: 1, ts: TS_VER }; continue; }
    let pick = null, oaRan = false, axFired = false;

    // Leg 1 (bonus, quota-permitting): OpenAlex title.search.
    if (oaAlive) {
      const url = 'https://api.openalex.org/works?filter=title.search:' + encodeURIComponent(q) +
        '&per-page=25&select=doi,title,publication_year,authorships,best_oa_location,primary_location,locations' +
        `&mailto=${encodeURIComponent(MAILTO)}`;
      const r = await oaGet(url);
      if (r.ok) {
        oaBad = 0; oaRan = true;
        pick = matchPreprintWork({ title: p.Title, year: p.Year, authors: p.Authors }, (r.json && r.json.results) || []);
      } else {
        oaBad++;
        const throttle = r.status === 429 || r.status === 403;
        if (throttle && opts.patient && oaBad < maxThrottle &&
            r.retryAfter * 1000 <= (opts.maxWaitMs || 15 * 60 * 1000)) {
          // Per-second/burst throttling: wait it out and retry the SAME paper
          // — but never wait PAST the run's deadline (the wait would
          // otherwise straddle the budget and blow the CI job timeout).
          const wait = Math.max(r.retryAfter * 1000, Math.min(5000 * Math.pow(2, oaBad - 1), 60000));
          if (Date.now() + wait > deadline) { if (opts.log) console.log('  preprints: title-search time budget reached — resuming next run.'); break; }
          if (opts.log) console.log(`  preprints: OpenAlex rate-limited — waiting ${Math.round(wait / 1000)}s…`);
          await sleep(wait);
          i--; continue;
        }
        if ((throttle && r.retryAfter > 3600) || oaBad >= maxThrottle) {
          // A Retry-After of hours means the DAY's quota is spent (OpenAlex
          // allows only ~100 title searches/day); persistent failures read
          // the same. The other engines carry the search from here.
          oaAlive = false;
          if (opts.log) console.log('  preprints: OpenAlex quota spent or unavailable — continuing with Crossref+arXiv only.');
        }
      }
    }

    // Leg 2 (backbone): Crossref — every pre-print home it mints DOIs for.
    let crOk = false;
    if (!pick) {
      const cr = await searchCrossrefPreprints(p);
      if (cr && cr.err) {
        if (++crFails >= 6) { if (opts.log) console.log('  preprints: Crossref failing — stopping title-search for this run.'); break; }
      } else { crFails = 0; crOk = true; pick = cr; }
    }

    // Leg 3 (backbone): arXiv's own API, when OpenAlex didn't cover it.
    let axOk = false;
    if (!pick && !oaRan && axAlive) {
      axFired = true;
      const ax = await searchArxivPreprint(p);
      if (ax && ax.err) {
        if (++axFails >= 6) { axAlive = false; if (opts.log) console.log('  preprints: arXiv API failing — dropping the arXiv leg for this run.'); }
      } else { axFails = 0; axOk = true; pick = ax; }
    }

    searched++;
    if (pick) {
      cache[p._doi] = pick; found++;
    } else if (crOk && (oaRan || axOk)) {
      cache[p._doi] = { none: 1, ts: TS_VER };
    } else if (crOk && !axAlive) {
      // arXiv is out for this run but Crossref concluded cleanly: stamp the
      // miss so the backfill ADVANCES through the catalog (Crossref keeps
      // surfacing SSRN/NBER/etc.) instead of stalling the instant arXiv is
      // unreachable from CI. naxiv:1 keeps it re-eligible for a later run WITH
      // arXiv, which alone can find an arXiv-only pre-print.
      cache[p._doi] = { none: 1, ts: TS_VER, naxiv: 1 };
    } // else: a required leg failed — leave un-stamped so a later run retries.

    if (opts.log && searched % 500 === 0) console.log(`  preprints: …${searched} searched, ${found} linked so far`);
    // Periodic save so a long run can be interrupted without losing work.
    if (opts.checkpoint && searched % 200 === 0) await opts.checkpoint(cache);
    await sleep(axFired ? axSleepMs : sleepMs);
  }
  if (opts.log) console.log(`  preprints: title search linked ${found} more (searched ${searched}).`);
  return found;
}

function applyPreprints(allPapers, cache) {
  let n = 0;
  for (const p of allPapers) {
    const x = p._doi && cache[p._doi];
    if (x && x.u) { p.Preprint = canonPreprint(x.u); p.PreprintSrc = x.s; n++; }
  }
  console.log(`  preprints: ${n}/${allPapers.length} papers link to an arXiv/SSRN pre-print`);
}

// ── Citation counts (OpenAlex + Semantic Scholar) ───────────────────────────
//
// Near-verbatim from the reference implementation in lit/_scraper/
// build-data.mjs (see its block comment for the full design): Crossref's
// is-referenced-by-count (harvested in mapWork) is only the FLOOR; this pass
// batch-reads OpenAlex (50 DOIs/call, select=doi,cited_by_count — general
// quota, not the title-search cut-off) and Semantic Scholar (500 DOIs/POST)
// into data-ft50/_citations.json:
//   { "<doi>": { c: <count>, t: <days-since-epoch last checked>, s2: 1?, au: "…"? } }
// (`au` = a fallback author string from OpenAlex `authorships`, cached for
// records whose Crossref harvest deposited no authors; applyCitations fills the
// empty Authors with it, never overwriting a Crossref-provided list.)
// applyCitations() lifts CitedBy to max(Crossref, cache) and stamps
// CitedBySrc ('oa' | 's2') when the cache wins. Rolling refresh, both legs
// optional and independently dropped on quota/failure, partial coverage never
// regresses a cached count. Full sweep: lit-ft50-citations-update.yml ->
// citations-ci.mjs (daily); in-build pass strictly time-boxed
// (FT50_CITATIONS_MS, default 5 min).

async function s2Batch(dois) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `lit-scraper/1.0 (mailto:${MAILTO})` },
        body: JSON.stringify({ ids: dois.map(d => 'DOI:' + d) }),
        signal: ctrl.signal,
      });
      if (res.ok) return { ok: true, arr: await res.json() };
      if (res.status === 429 && attempt === 0) {
        const ra = parseInt(res.headers.get('retry-after') || '', 10);
        await sleep(Math.min(isNaN(ra) ? 5 : Math.max(ra, 5), 30) * 1000);
        continue;
      }
      return { ok: false, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 429 };
}

export async function refreshCitations(allPapers, cache, opts = {}) {
  const cap = opts.cap ?? 500000;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const minAgeDays = opts.minAgeDays ?? 2;
  const today = Math.floor(Date.now() / 86400000);
  const seen = new Set(), eligible = [];
  for (const p of allPapers) {
    if (!p._doi || seen.has(p._doi)) continue;
    seen.add(p._doi);
    const c = cache[p._doi];
    if (c && (c.t || 0) > today - minAgeDays) continue;
    eligible.push(p._doi);
  }
  // Never-checked DOIs first (t undefined -> 0), then stalest check first.
  eligible.sort((a, b) => ((cache[a] || {}).t || 0) - ((cache[b] || {}).t || 0));
  const todo = eligible.slice(0, cap);
  if (!todo.length) { console.log('  citations: cache is fresh — nothing to refresh.'); return 0; }
  console.log(`  citations: refreshing ${todo.length} of ${eligible.length} new/stale DOIs…`);
  // Records whose Crossref harvest deposited NO authors (Crossref omits author
  // metadata for many older/certain-publisher DOIs). For these we also read
  // OpenAlex `authorships` off the same call and cache a fallback author string
  // (`au`) so applyCitations can fill the empty Authors — never overwriting a
  // Crossref-provided list.
  const authorless = new Set();
  for (const p of allPapers) if (p._doi && !String(p.Authors || '').trim()) authorless.add(p._doi);
  let oaAlive = true, s2Alive = true, oaFails = 0, s2Fails = 0, done = 0;
  for (let i = 0; i < todo.length && (oaAlive || s2Alive); i += 500) {
    if (Date.now() > deadline) { console.log('  citations: time budget reached — resuming next run.'); break; }
    const chunk = todo.slice(i, i + 500);
    const oaVal = new Map(), s2Val = new Map(), oaDone = new Set(), oaAu = new Map();

    // Leg 1: OpenAlex, 50 DOIs per call (like seedPreprintsByDoi).
    if (oaAlive) {
      for (let j = 0; j < chunk.length; j += 50) {
        const batch = chunk.slice(j, j + 50);
        const url = 'https://api.openalex.org/works?filter=doi:' + batch.join('|') +
          '&per-page=50&select=doi,cited_by_count,authorships' +
          `&mailto=${encodeURIComponent(MAILTO)}`;
        const r = await oaGet(url);
        if (!r.ok) {
          const throttle = r.status === 429 || r.status === 403;
          oaFails++;
          // A Retry-After of hours means the day's quota is spent; six
          // consecutive failures read the same. Anything else is per-second
          // burst throttling (shared CI egress IPs 429 freely) or a transient
          // blip — ride it out with bounded backoff instead of losing the
          // leg for the whole run on one 429 (the preprint search's patient
          // mode, same rationale).
          if ((throttle && r.retryAfter > 3600) || oaFails >= 6) {
            oaAlive = false;
            console.log('  citations: OpenAlex quota/throttle — dropping the OpenAlex leg for this run.');
            break;
          }
          const wait = throttle
            ? Math.max(r.retryAfter * 1000, Math.min(5000 * Math.pow(2, oaFails - 1), 60000))
            : 2000;
          if (Date.now() + wait > deadline) break; // run is ending — don't burn the budget waiting
          await sleep(wait);
          j -= 50; continue; // retry this batch (bounded by oaFails)
        }
        oaFails = 0;
        for (const w of r.json.results || []) {
          const doi = String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
          if (typeof w.cited_by_count === 'number') oaVal.set(doi, w.cited_by_count);
          if (authorless.has(doi) && Array.isArray(w.authorships) && w.authorships.length) {
            const names = w.authorships
              .map(a => String((a.author && a.author.display_name) || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
              .filter(Boolean);
            if (names.length) oaAu.set(doi, names.join(', '));
          }
        }
        // A DOI absent from a SUCCESSFUL batch is simply not in OpenAlex —
        // that is a concluded zero, unlike a DOI in a failed batch.
        for (const d of batch) oaDone.add(d);
        await sleep(400);
      }
    }

    // Leg 2: Semantic Scholar, the whole chunk in one POST (bonus leg — its
    // GS-like count covers citing theses/reports OpenAlex may miss).
    let s2DoneChunk = false;
    if (s2Alive) {
      const r = await s2Batch(chunk);
      if (r.ok && Array.isArray(r.arr)) {
        s2Fails = 0; s2DoneChunk = true;
        r.arr.forEach((rec, k) => {
          if (rec && typeof rec.citationCount === 'number') s2Val.set(chunk[k], rec.citationCount);
        });
      } else if (++s2Fails >= 4) {
        s2Alive = false;
        console.log('  citations: Semantic Scholar unavailable — continuing on OpenAlex only.');
      }
    }

    // Stamp what concluded. Partial coverage (one leg down) never regresses a
    // previously cached count — the missing leg's old win is carried forward.
    for (const d of chunk) {
      if (!oaDone.has(d) && !s2DoneChunk) continue; // neither leg concluded — retry next run
      const ov = oaVal.get(d) ?? 0, sv = s2Val.get(d) ?? 0;
      let c = Math.max(ov, sv), s2 = sv > ov;
      const prev = cache[d];
      if (prev && prev.c > c && !(oaDone.has(d) && s2DoneChunk)) { c = prev.c; s2 = !!prev.s2; }
      const e = { t: today };
      if (c > 0) { e.c = c; if (s2) e.s2 = 1; }
      // Carry the OpenAlex author fallback for author-less records (this run's
      // find wins; otherwise keep a previously cached one).
      const au = oaAu.get(d) || (prev && prev.au);
      if (au) e.au = au;
      cache[d] = e;
      done++;
    }
    if (opts.checkpoint && (i / 500) % 10 === 9) await opts.checkpoint(cache);
    if (opts.log && (i / 500) % 25 === 24) console.log(`  citations: …${done} DOIs refreshed so far`);
  }
  console.log(`  citations: refreshed ${done} DOI(s) this run.`);
  return done;
}

export function applyCitations(allPapers, cache) {
  let n = 0, a = 0;
  for (const p of allPapers) {
    const x = p._doi && cache[p._doi];
    if (!x) continue;
    if (x.c > (p.CitedBy || 0)) { p.CitedBy = x.c; p.CitedBySrc = x.s2 ? 's2' : 'oa'; n++; }
    // Fill authors ONLY where Crossref deposited none — never overwrite a list.
    if (x.au && !String(p.Authors || '').trim()) { p.Authors = x.au; a++; }
  }
  console.log(`  citations: ${n}/${allPapers.length} papers carry an OpenAlex/Semantic Scholar count above Crossref's` +
    (a ? `; ${a} had missing authors filled from OpenAlex` : ''));
}

// ── Registry (key -> first-seen date) ──────────────────────────────────────

async function loadRegistry() {
  const path = join(DATA_DIR, '_registry.json');
  if (!existsSync(path)) return { map: {}, firstRun: true };
  try {
    return { map: JSON.parse(await readFile(path, 'utf8')), firstRun: false };
  } catch {
    return { map: {}, firstRun: true };
  }
}

// Per-journal onboarding guard: a journal that suddenly contributes hundreds
// of unseen papers is being onboarded (first run, a new FT50 journal, an ISSN
// fix), not publishing hundreds of new articles — stamp only its newest few
// so "recently added" reflects news, never an influx. Guarding per journal
// (rather than per run, as lit does) means adding one journal to the list
// can never suppress the genuinely new papers of the other 49 that day.
function updateRegistry(bySource, reg) {
  for (const src of JOURNALS) {
    const rows = bySource[src.key] || []; // already sorted newest-first
    const newKeys = [];
    for (const p of rows) {
      const k = regKey(p);
      if (!(k in reg.map)) newKeys.push(k);
    }
    if (!newKeys.length) continue;
    const baseline = reg.firstRun || newKeys.length > INFLUX_PER_SOURCE;
    if (baseline && !reg.firstRun) {
      console.log(`  registry: ${src.key} has ${newKeys.length} unseen papers at once — onboarding, not news`);
    }
    const seedSet = new Set(baseline ? newKeys.slice(0, SEED_PER_SOURCE) : []);
    for (const k of newKeys) {
      reg.map[k] = baseline ? (seedSet.has(k) ? PULL_DATE : '') : PULL_DATE;
    }
  }
  return reg.map;
}

// ── Aggregates (ported from lit, source-aware) ──────────────────────────

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function buildAuthors(papers) {
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
  const normName = (name) => stripAccents(name).toLowerCase();
  const nameSet = new Set();
  for (const p of papers) authorNames(p).forEach(n => nameSet.add(normName(n)));

  // ORCID merging with the same one-paper-misattribution guard.
  const orcidNames = new Map();
  for (const p of papers) {
    authorNames(p).forEach((name, i) => {
      add('n:' + normName(name));
      const orcid = (p._orcids && p._orcids[i]) || '';
      if (!orcid) return;
      let m = orcidNames.get(orcid);
      if (!m) { m = new Map(); orcidNames.set(orcid, m); }
      const nk = normName(name);
      m.set(nk, (m.get(nk) || 0) + 1);
    });
  }
  for (const [orcid, names] of orcidNames) {
    for (const [nk, count] of names) {
      if (names.size === 1 || count >= 2) union('n:' + nk, 'o:' + orcid);
    }
  }
  // "Hau L. Lee" == "Hau Lee" when the middle-initial-free form exists too.
  for (const n of nameSet) {
    const toks = n.split(/\s+/);
    if (toks.length < 3) continue;
    const stripped = toks.filter((t, i) => i === 0 || i === toks.length - 1 || !/^[a-z]\.?$/.test(t)).join(' ');
    if (stripped !== n && nameSet.has(stripped)) union('n:' + stripped, 'n:' + n);
  }

  const byRoot = new Map();
  for (const p of papers) {
    const area = p.Area;
    authorNames(p).forEach((name) => {
      const root = find('n:' + stripAccents(name).toLowerCase());
      let rec = byRoot.get(root);
      if (!rec) { rec = { names: new Map(), papers: 0, areas: new Set(), journals: new Set() }; byRoot.set(root, rec); }
      rec.papers++;
      rec.names.set(name, (rec.names.get(name) || 0) + 1);
      if (area) rec.areas.add(area);
      if (p.Journal) rec.journals.add(p.Journal);
    });
  }
  const out = [];
  for (const [id, rec] of byRoot) {
    const variants = [...rec.names.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    out.push({
      id,
      Author: variants[0],
      Papers: rec.papers,
      Areas: [...rec.areas].join(', '),
      Journals: [...rec.journals].join(', '),
      Name_Variants: variants.join(';'),
    });
  }
  out.sort((a, b) => (b.Papers - a.Papers) || cmp(a.Author, b.Author) || cmp(a.id, b.id));
  // Across 50 journals the full set would be enormous; keep multi-paper
  // authors (plus everyone in the top slice) so the file stays a sane size.
  // The full pre-trim distinct count still goes out via meta.json (header stat).
  const trimmed = out.filter((a, i) => a.Papers >= 2 || i < 5000);
  return { rows: trimmed.map(({ id, ...rest }) => rest), distinct: out.length };
}

function buildAffiliations(papers) {
  const byAff = new Map();
  for (const p of papers) {
    const affs = p.Affiliations ? p.Affiliations.split(';').map(s => s.trim()).filter(Boolean) : [];
    const seen = new Set();
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
  out.sort((a, b) => (b.Papers - a.Papers) || cmp(a.Affiliation, b.Affiliation) || cmp(a.key, b.key));
  return out.slice(0, TOP_AFFILIATIONS).map(({ key, ...rest }) => rest);
}

function buildRecent(papers, registry) {
  const cutoff = new Date(PULL_DATE + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);
  const rows = [];
  for (const p of papers) {
    const ds = registry[regKey(p)];
    if (!ds) continue;
    const d = new Date(ds + 'T00:00:00');
    if (isNaN(d) || d < cutoff) continue;
    rows.push({ p, d });
  }
  rows.sort((a, b) => (b.d - a.d) || (b.p._rank - a.p._rank) || cmp(regKey(a.p), regKey(b.p)));
  return rows.slice(0, RECENT_CAP).map(x => ({ ...publicRow(x.p), 'Date Added': registry[regKey(x.p)] }));
}

function publicRow(p) {
  const { _doi, _orcids, _rank, Orcids, ...rest } = p;
  // Persist ORCIDs (pipe-joined, empty slots kept for index alignment with the
  // Authors list) only when at least one is present, so a reused papers file
  // round-trips them back via rehydrateRow. Most rows carry none, so the field
  // is absent from the vast majority and adds no bloat there.
  if (_orcids && _orcids.some(Boolean)) rest.Orcids = _orcids.join('|');
  return rest;
}

// Add forthcoming papers a publisher lists but Crossref hasn't indexed yet (from
// the committed _informs-aia.json). Only DOIs Crossref did not already return
// are added, into their named source, so Crossref silently supersedes the entry
// once it catches up. New rows flow through the registry, so they also appear in
// the "Recently added papers" view.
function mergeSupplement(bySource) {
  const seen = new Set();
  for (const k of Object.keys(bySource)) for (const p of bySource[k] || []) if (p._doi) seen.add(p._doi);
  let added = 0;
  for (const [rawDoi, s] of Object.entries(AIA_SUPPLEMENT)) {
    const doi = (rawDoi || '').toLowerCase();
    if (!doi || seen.has(doi) || !s || !s.Title) continue;
    const src = JOURNALS.find(j => j.key === s.jkey && j.aia);
    if (!src || !bySource[src.key]) continue; // only known, non-retired, advance-publishing sources
    seen.add(doi);
    const year = String(s.Year || PULL_DATE.slice(0, 4));
    const row = {
      Title: stripJats(s.Title),
      Authors: s.Authors || '',
      Affiliations: s.Affiliations || '',
      DOI: 'https://doi.org/' + rawDoi,
      Volume: '', Issue: '', Page: '',
      Year: year,
      Status: 'Articles in Advance',
      Abstract: s.Abstract ? stripJats(s.Abstract) : '',
      'Accepting Editor': s['Accepting Editor'] || '',
      Area: normArea(s.Area || ''),
      Journal: src.name,
      JKey: src.key,
      _doi: doi,
      _orcids: [],
      _rank: pubRank(year, '', '', '', 'Articles in Advance'),
    };
    if (src.seEditors) row['Senior Editor'] = s['Senior Editor'] || '';
    if (src.aeEditors) row['Associate Editor'] = s['Associate Editor'] || '';
    bySource[src.key].push(row);
    added++;
  }
  if (added) console.log(`  merged ${added} forthcoming papers from the advance-articles supplement`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`ft50 data build: pull date ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}` +
    `${ONLY.length ? ` (only: ${ONLY.join(', ')})` : ''} — ${JOURNALS.length} journals`);
  await mkdir(DATA_DIR, { recursive: true });

  const bySource = {}; // key -> rows (internal shape)

  // 1. Pull all locally-hosted journals, sequentially (politeness + bounded
  // memory). Sharded journals are pulled by their own satellite pipelines.
  for (const src of LOCAL_JOURNALS) {
    console.log(`${src.name} (${src.issns.join(', ')}):`);
    bySource[src.key] = await pullJournal(src);
    console.log(`  ${src.key}: ${bySource[src.key].length} papers`);
    if (!MOCK) await sleep(JOURNAL_PAUSE_MS);
  }
  await applyInformsEditors(bySource);
  mergeSupplement(bySource);

  // 2. Journals dropped from the FT50 list: their data files are removed and
  // they disappear from the manifest (check-ft50-list.mjs marks them retired).
  for (const src of RETIRED) {
    const path = join(DATA_DIR, `papers-${src.key}.json`);
    if (existsSync(path)) {
      await rm(path);
      console.log(`  ${src.key}: retired from the FT50 list — removed ${`papers-${src.key}.json`}`);
    }
  }

  // 3. Collapse duplicate registrations of the same work (second DOIs Crossref
  // still serves — see collapseSameWork), then deterministic order per source.
  for (const src of LOCAL_JOURNALS) {
    bySource[src.key] = collapseSameWork(bySource[src.key], src.key);
    bySource[src.key].sort((a, b) => (b._rank - a._rank) || cmp(regKey(a), regKey(b)));
  }
  const allPapers = LOCAL_JOURNALS.flatMap(s => bySource[s.key]);

  // Pre-print (arXiv/SSRN) open-access links — cached + incremental, exactly
  // like the lit native pipeline. Kept non-fatal so a slow/failed OpenAlex
  // run never aborts the data build; the cache we already have still applies.
  // The heavy title-search backfill runs in its own scheduled workflow via
  // preprints-ci.mjs; the in-build pass here is strictly time-boxed.
  const preprintCache = await loadJsonIfExists(join(DATA_DIR, '_preprints.json'), {});
  try { await resolvePreprints(allPapers, preprintCache); }
  catch (e) { console.warn('  preprints resolve failed (non-fatal):', e.message); }
  if (!MOCK) await writeJson('_preprints.json', preprintCache);
  applyPreprints(allPapers, preprintCache);

  // Citation counts above Crossref's floor — same non-fatal contract as the
  // pre-print pass: the committed cache is always applied even when both
  // refresh legs are down, and the in-build refresh is strictly time-boxed
  // (new papers get their count on day one; the full rolling sweep runs
  // online in lit-ft50-citations-update.yml via citations-ci.mjs).
  const citationsCache = await loadJsonIfExists(join(DATA_DIR, '_citations.json'), {});
  if (!MOCK) {
    try {
      await refreshCitations(allPapers, citationsCache, {
        cap: parseInt(process.env.FT50_CITATIONS_CAP || '20000', 10),
        budgetMs: parseInt(process.env.FT50_CITATIONS_MS || '300000', 10), // 5-minute hard ceiling
      });
    } catch (e) { console.warn('  citations refresh failed (non-fatal):', e.message); }
    await writeJson('_citations.json', citationsCache);
  }
  applyCitations(allPapers, citationsCache);

  const reg = await loadRegistry();
  const registry = updateRegistry(bySource, reg);

  const authors = buildAuthors(allPapers);
  // The lit page layers this catalog on top of its native eight sources; the
  // authors of the journals shared with them (the INFORMS/SAGE six) are
  // already counted by lit/data/meta.json, so also publish an extras-only
  // distinct count for the page's merged "papers from N authors" header stat.
  const LIT_NATIVE_KEYS = new Set(['ms', 'opre', 'mksc', 'msom', 'isre', 'pom']);
  const authorCountExtras =
    buildAuthors(allPapers.filter(p => !LIT_NATIVE_KEYS.has(p.JKey))).distinct;
  const affiliations = buildAffiliations(allPapers);
  const recent = buildRecent(allPapers, registry);

  // 4. Write per-journal paper files + manifest (capability flags included so
  // the page can adapt its filters per journal without hardcoding keys).
  const sources = [];
  let total = 0;
  for (const src of LOCAL_JOURNALS) {
    const rows = bySource[src.key].map(publicRow);
    const file = `papers-${src.key}.json`;
    await writeJson(file, rows);
    total += rows.length;
    let firstYear = 0;
    for (const r of rows) {
      const y = parseInt(r.Year, 10);
      if (y && (!firstYear || y < firstYear)) firstYear = y;
    }
    const entry = { key: src.key, name: src.name, short: src.short || src.name, publisher: src.publisher, file, count: rows.length };
    if (firstYear) entry.firstYear = firstYear;
    if (src.url) entry.url = src.url;
    if (src.editors) entry.editors = true;
    if (src.seEditors) entry.seEditors = true;
    if (src.aeEditors) entry.aeEditors = true;
    if (src.aia) entry.aia = true;
    if (src.limitedCoverage) entry.limitedCoverage = true;
    // Journals carried for another list (e.g. UTD24's INFORMS Journal on
    // Computing) but NOT on the FT50 list: the page must not count them as
    // FT50, and the yearly FT-list check must not retire them.
    if (src.notFT) entry.notFT = true;
    sources.push(entry);
  }

  // Sharded journals: manifest entry only (their papers file is built and
  // committed by the satellite repo's own pipeline; the page fetches
  // entry.base + entry.file — GitHub Pages sends Access-Control-Allow-Origin:
  // * so a cross-origin data site works). No count: the satellite owns it.
  for (const src of SHARDED_JOURNALS) {
    const entry = { key: src.key, name: src.name, short: src.short || src.name, publisher: src.publisher, file: `papers-${src.key}.json`, base: src.base };
    if (src.aia) entry.aia = true;
    if (src.limitedCoverage) entry.limitedCoverage = true;
    if (src.notFT) entry.notFT = true;
    sources.push(entry);
  }

  const meta = {
    lastPull: PULL_DATE,
    paperCount: total,
    authorCount: authors.distinct,
    authorCountExtras,
    journalCount: JOURNALS.length,
    perSource: Object.fromEntries(sources.map(s => [s.key, s.count])),
    source: 'Crossref REST API, one pull per FT50 journal (list checked yearly against ft.com/ft50-journals)',
  };

  await writeJson('sources.json', sources);
  await writeJson('authors.json', authors.rows);
  await writeJson('affiliations.json', affiliations);
  await writeJson('recent.json', recent);
  await writeJson('meta.json', meta);
  await writeJson('_registry.json', registry);

  console.log(`done: ${total} papers (${sources.map(s => `${s.key}:${s.count}`).join(' ')}), ` +
    `${authors.distinct} authors (${authors.rows.length} listed), ` +
    `${affiliations.length} affiliations, ${recent.length} recent`);
}

async function writeJson(name, data) {
  // Minified + deterministic: unchanged data produces identical bytes and
  // therefore no needless git commit.
  await writeFile(join(DATA_DIR, name), JSON.stringify(data), 'utf8');
}

// ── Incremental "new arrivals" pass (--incremental) ─────────────────────────
// Mirrors lit's native incrementalMain(), but for the FT50 catalog and scoped
// to a small journal subset (INCR_JOURNAL_KEYS; default: Econometrica). It polls
// Crossref for only the freshly-indexed tail, upserts into the committed
// papers-<key>.json (new papers appended; a known DOI has only its core
// bibliographic fields refreshed, enrichment preserved), and rewrites only the
// small derived files. Deliberately does NOT rebuild authors/affiliations (left
// to the daily build, which alone has the ORCID data) nor re-merge the
// _informs-aia.json forthcoming supplement (also the daily build's job).
async function incrementalMain() {
  const sinceDate = new Date(PULL_DATE + 'T00:00:00');
  sinceDate.setDate(sinceDate.getDate() - INCR_LOOKBACK_DAYS);
  const since = sinceDate.toISOString().slice(0, 10);
  const incrJournals = LOCAL_JOURNALS.filter(j => INCR_JOURNAL_KEYS.includes(j.key));
  const incrKeys = new Set(incrJournals.map(j => j.key));
  console.log(`ft50 incremental check: records indexed since ${since} for ` +
    `{${incrJournals.map(j => j.key).join(', ') || 'none'}} (pull date ${PULL_DATE})${MOCK ? ' (MOCK)' : ''}`);
  await mkdir(DATA_DIR, { recursive: true });
  if (!incrJournals.length) {
    console.error(`No FT50 incremental journals resolved from FT50_INCR_JOURNALS="${INCR_JOURNAL_KEYS.join(',')}".`);
    process.exit(1);
  }

  // A full build must have run at least once first: the registry is what tells a
  // genuinely-new paper from a known one, and recent/meta carry the other ~50
  // journals' state that this narrow pass deliberately does not recompute.
  const regState = await loadRegistry();
  if (regState.firstRun) {
    console.error('No _registry.json yet — run a full build (node build-data.mjs) before the incremental pass.');
    process.exit(1);
  }
  const prevMeta = await loadJsonIfExists(join(DATA_DIR, 'meta.json'), {});
  const prevSources = await loadJsonIfExists(join(DATA_DIR, 'sources.json'), []);
  const prevRecent = await loadJsonIfExists(join(DATA_DIR, 'recent.json'), []);

  const bySource = {};
  const changedSources = new Set();
  const doiMigrations = [];                // [oldDoi, newDoi] when a paper's DOI is re-registered

  for (const src of incrJournals) {
    const existing = await loadCommitted(src); // rehydrated internal rows
    const byDoi = new Map(existing.filter(p => p._doi).map(p => [p._doi, p]));
    // Title index for the duplicate guard below: an unknown DOI may still be a
    // paper we already list, re-registered under a second DOI.
    const byTitleDup = new Map();
    const indexTitle = (p) => {
      const k = dupTitleKey(p.Title);
      if (!k) return;
      const g = byTitleDup.get(k);
      if (g) g.push(p); else byTitleDup.set(k, [p]);
    };
    for (const p of existing) indexTitle(p);
    const fetched = mapJournal(await fetchJournalWorks(src, { sinceIndexDate: since }) || [], src);
    let added = 0, updated = 0, dupSkipped = 0;
    for (const nr of fetched) {
      let cur = nr._doi ? byDoi.get(nr._doi) : null;
      let adopted = false;
      if (!cur) {
        // Unknown DOI — but the same WORK may already be listed under a
        // superseded registration. Never append a second row for it: adopt the
        // fuller registration's DOI onto the existing row, or skip the lesser.
        const twin = (byTitleDup.get(dupTitleKey(nr.Title)) || [])
          .find(p => sameWorkDup(p, nr));
        if (twin) {
          if (dupRank(nr) > dupRank(twin)) {
            if (twin._doi) { doiMigrations.push([twin._doi, nr._doi]); byDoi.delete(twin._doi); }
            byDoi.set(nr._doi, twin);
            twin.DOI = nr.DOI;
            twin._doi = nr._doi;
            cur = twin;                    // fall through to the core-field refresh
            adopted = true;                // the DOI change alone must rewrite the file
          } else {
            dupSkipped++;                  // a lesser duplicate registration — ignore it
            continue;
          }
        }
      }
      if (!cur) {                          // genuinely new paper
        existing.push(nr);
        if (nr._doi) byDoi.set(nr._doi, nr);
        indexTitle(nr);                    // two same-work rows in one batch can't both append
        added++;
        continue;
      }
      // Known DOI: refresh only core bibliographic fields; leave enrichment intact.
      let rowChanged = adopted;
      for (const f of INCR_CORE_FIELDS) {
        if (nr[f] === undefined) continue;
        if (String(nr[f] ?? '') !== String(cur[f] ?? '')) { cur[f] = nr[f]; rowChanged = true; }
      }
      // Crossref's citation floor may only rise; never regress an enriched count.
      if (typeof nr.CitedBy === 'number' && nr.CitedBy > (cur.CitedBy || 0)) {
        cur.CitedBy = nr.CitedBy; delete cur.CitedBySrc; rowChanged = true;
      }
      if (rowChanged) { cur._rank = pubRank(cur.Year, cur.Volume, cur.Issue, cur.Page, cur.Status); updated++; }
    }
    if (added || updated) changedSources.add(src.key);
    existing.sort((a, b) => (b._rank - a._rank) || cmp(regKey(a), regKey(b)));
    bySource[src.key] = existing;
    console.log(`  ${src.key}: +${added} new, ${updated} updated` +
      (dupSkipped ? `, ${dupSkipped} duplicate registration(s) skipped` : '') +
      ` (now ${existing.length})`);
  }

  // Overlay cached Senior/Associate editors onto any new/updated rows (offline;
  // a no-op unless a polled journal carries SE/AE — Econometrica does not).
  await applyInformsEditors(bySource);

  // A DOI adoption keeps the paper's original "Date Added": seed the new key
  // from the old key's registry date so the re-registration is never presented
  // as a newly-added paper in the recent view.
  for (const [oldDoi, newDoi] of doiMigrations) {
    if (regState.map[oldDoi] !== undefined && regState.map[newDoi] === undefined) {
      regState.map[newDoi] = regState.map[oldDoi];
    }
  }

  // Registry: stamp only genuinely-new keys of the polled journals. Journals
  // absent from bySource are skipped by updateRegistry, so their entries — and
  // the onboarding guard's per-source accounting — are left untouched.
  const registryBefore = Object.keys(regState.map).length;
  const registry = updateRegistry(bySource, regState);
  const registryGrew = Object.keys(registry).length > registryBefore;

  if (!changedSources.size && !registryGrew) {
    console.log('No new or changed papers — nothing to write.');
    return;
  }

  // Per-source counts: carry every journal's count from the last full build,
  // override only the polled ones (no need to load the other ~50 papers files).
  const counts = { ...(prevMeta.perSource || {}) };
  for (const src of incrJournals) counts[src.key] = bySource[src.key].length;

  // recent.json: recompute over (the polled journals' fresh rows) ∪ (the last
  // build's recent rows for every OTHER journal). Since this pass and the daily
  // build are the only writers of data-ft50 and share a concurrency group, the
  // polled journals are the only thing that has changed since that recent.json
  // was written — so this union still contains the true newest-N, and
  // re-windowing + re-capping it reproduces buildRecent's output without reading
  // all ~50 papers files.
  const carriedRecent = (Array.isArray(prevRecent) ? prevRecent : [])
    .filter(r => !incrKeys.has(r.JKey))
    .map(r => { const { ['Date Added']: _da, ...rest } = r; return rehydrateRow(rest); });
  const incrPapers = incrJournals.flatMap(src => bySource[src.key]);
  const recent = buildRecent([...carriedRecent, ...incrPapers], registry);

  // Rewrite only the changed per-source files.
  for (const src of incrJournals) {
    if (changedSources.has(src.key)) await writeJson(`papers-${src.key}.json`, bySource[src.key].map(publicRow));
  }

  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  const sources = (Array.isArray(prevSources) && prevSources.length)
    ? prevSources.map(s => (incrKeys.has(s.key) ? { ...s, count: counts[s.key] ?? s.count } : s))
    : null;
  const meta = { ...prevMeta, lastPull: PULL_DATE, paperCount: total, perSource: counts };

  if (sources) await writeJson('sources.json', sources);
  await writeJson('recent.json', recent);
  await writeJson('meta.json', meta);
  await writeJson('_registry.json', registry);

  const newlyRegistered = Object.keys(registry).length - registryBefore;
  console.log(`ft50 incremental update: {${[...changedSources].join(', ') || 'none'}} changed, ` +
    `${newlyRegistered} newly-registered, ${recent.length} recent, ${total} total papers.`);
}

// Only run when executed directly — importing a helper from this module for a
// test must not fire the whole network pipeline.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const incremental = process.env.FT50_INCREMENTAL === '1' || process.argv.includes('--incremental');
  (incremental ? incrementalMain() : main()).catch(e => { console.error(e); process.exit(1); });
}
