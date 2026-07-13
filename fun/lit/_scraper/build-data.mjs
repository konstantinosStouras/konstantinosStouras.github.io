/*
 * build-data.mjs — the fun/lit data pipeline ("The Lit": multi-journal paper browser).
 * ===========================================================================
 * This is the *entire* backend for stouras.com/fun/lit/. It runs on a GitHub
 * Actions runner (see .github/workflows/lit-update-data.yml), pulls from public
 * APIs, and writes static JSON into fun/lit/data/, which GitHub Pages serves
 * from its CDN. No server, no database, no Google anywhere.
 *
 * Sources:
 *   • Six journals, straight from the Crossref REST API by ISSN:
 *       Management Science, Operations Research, Marketing Science, M&SOM,
 *       Information Systems Research (INFORMS), and POM (Wiley→SAGE).
 *     Editor/Area extraction (the "This paper was accepted by …" sentence)
 *     runs for Management Science ONLY — the page shows Editors/Areas only
 *     for MS, mirroring stouras.com/fun/ms/.
 *   • PNAS, limited to five topic sections (Computer Sciences, Sustainability
 *     Science, Environmental Sciences, Social Sciences, Economic Sciences).
 *     Metadata comes from Crossref; the DOI→section mapping comes from the
 *     committed cache data/_pnas-concepts.json because pnas.org's search is
 *     Cloudflare-challenged (see pnas-crawl.mjs + pnas-concepts-local.mjs).
 *     Every run still *tries* to refresh that cache; failure is non-fatal.
 *   • ACM EC (Economics & Computation) conference, 2020→present:
 *       – published proceedings from Crossref (exact container-title match,
 *         "Proceedings of the 21st…27th ACM Conference on Economics and
 *         Computation");
 *       – the current year's accepted-papers list scraped from
 *         ec<YY>.sigecom.org/program/accepted-papers/ (papers not yet in the
 *         ACM DL are listed as forthcoming and upgraded automatically once
 *         their DOI appears);
 *       – PDF links (arXiv > SSRN > any open-access copy) and abstracts via
 *         OpenAlex (batch), DBLP (per-year toc) and Semantic Scholar (capped,
 *         resumes across runs), cached in data/_ec-extras.json.
 *
 * What it writes into fun/lit/data/:
 *   papers-<src>.json    one file per source (ms, opre, mksc, msom, isre,
 *                        pom, pnas, ec) — the main dataset
 *   sources.json         manifest: per-source names, files, counts
 *   authors.json         per-author aggregates across all sources (≥2 papers)
 *   affiliations.json    per-affiliation aggregates
 *   recent.json          papers first seen in the last RECENT_WINDOW_DAYS
 *   meta.json            { lastPull, paperCount, authorCount, perSource }
 *                        (authorCount = distinct authors pre-trim, for the
 *                        page's header stat)
 *   _registry.json       internal: DOI/title-key -> date first seen
 *   _ec-extras.json      internal: cached PDF/abstract lookups for EC papers
 *   (_pnas-concepts.json is written by the PNAS crawl, see above)
 *
 * Offline smoke test (no network, uses _scraper/mock/):
 *   LIT_MOCK=1 node build-data.mjs
 *
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAcceptedPapers, normTitle } from './ec-pages.mjs';
import { PNAS_SECTIONS, crawlConcepts, mergeIntoCache, isChallenged } from './pnas-crawl.mjs';
import { parseInformsEditors } from './informs-editors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_RUN = process.env.LIT_MOCK === '1';
// Mock runs write to a scratch dir so a smoke test can never pollute the live
// data/ (in particular its _registry.json, which drives "recently added").
const DATA_DIR = process.env.LIT_DATA_DIR
  || (MOCK_RUN ? resolve(__dirname, '_mock-out') : resolve(__dirname, '..', 'data'));
const MOCK_DIR = join(__dirname, 'mock');

const MAILTO = process.env.LIT_MAILTO || 'kstouras@gmail.com';
const MOCK = MOCK_RUN;
const ROWS = 1000;                  // Crossref max page size
const RECENT_WINDOW_DAYS = 90;      // buffer; the page shows the last 4 weeks
const SEED_COUNT = 40;              // first run: mark the newest N as "just added"
const TOP_AFFILIATIONS = 2000;
const MAX_ABSTRACT = 4000;          // chars; keeps the big files bounded
const S2_CAP = parseInt(process.env.LIT_S2_CAP || '150', 10); // S2 lookups per run
const PULL_DATE = process.env.LIT_PULL_DATE || new Date().toISOString().slice(0, 10);

// ── Sources ─────────────────────────────────────────────────────────────────

// editors: MS "accepted by" editor/area extraction (as on /fun/ms/).
// seEditors/aeEditors: Senior/Associate Editor from the "History:" line —
// parsed from the Crossref abstract when present, otherwise joined from the
// committed cache data/_informs-editors.json built by informs-editors-local.mjs
// (pubsonline.informs.org blocks cloud IPs, like pnas.org).
// issns: print + online ISSN for every journal (some Crossref deposits are
// registered under only one of them), plus predecessor titles — Operations
// Research's first volumes (1952-1955) appeared as the "Journal of the
// Operations Research Society of America" under its own ISSN. Records from
// all ISSNs of a source are merged and deduped by DOI.
// aia: the journal publishes "Articles in Advance" (INFORMS) / OnlineFirst
// (SAGE), so a record without volume+issue is a genuine advance article.
// PNAS and ACM EC have no such stage — their rows never carry that status.
const JOURNALS = [
  { key: 'ms',   name: 'Management Science',                            issns: ['0025-1909', '1526-5501'], publisher: 'INFORMS', aia: true, editors: true },
  { key: 'opre', name: 'Operations Research',                           issns: ['0030-364X', '1526-5463', '0096-3984'], publisher: 'INFORMS', aia: true },
  { key: 'mksc', name: 'Marketing Science',                             issns: ['0732-2399', '1526-548X'], publisher: 'INFORMS', aia: true, seEditors: true },
  { key: 'msom', name: 'Manufacturing & Service Operations Management', issns: ['1523-4614', '1526-5498'], publisher: 'INFORMS', aia: true },
  { key: 'isre', name: 'Information Systems Research',                  issns: ['1047-7047', '1526-5536'], publisher: 'INFORMS', aia: true, seEditors: true, aeEditors: true },
  { key: 'pom',  name: 'Production and Operations Management',          issns: ['1059-1478', '1937-5956'], publisher: 'SAGE', aia: true },
];
const PNAS = { key: 'pnas', name: 'PNAS', issns: ['0027-8424', '1091-6490'], publisher: 'National Academy of Sciences' };
// ACM EC: founded 1999 as the "ACM Conference on Electronic Commerce" (no
// conference in 2002), renamed "Economics and Computation" with the 15th
// edition in 2014. Years < sigecomFirstYear come from DBLP's per-year tables
// of contents (ACM's Crossref container titles are too inconsistent pre-2020
// to query by name); 2020+ from Crossref + the sigecom.org accepted lists.
const EC = { key: 'ec', name: 'ACM EC', publisher: 'ACM', firstYear: 1999, sigecomFirstYear: 2020 };

function ecEditionNumber(year) {
  // 1999→1st, 2000→2nd, 2001→3rd, (no 2002), 2003→4th … 2020→21st …
  return year <= 2001 ? year - 1998 : year - 1999;
}
function ecSeriesName(year) {
  return year >= 2014 ? 'ACM Conference on Economics and Computation'
                      : 'ACM Conference on Electronic Commerce';
}
export function ecBooktitle(year) {
  return `Proceedings of the ${ordSuffix(ecEditionNumber(year))} ${ecSeriesName(year)} (EC '${String(year).slice(2)})`;
}
function ordSuffix(n) {
  const s = (n % 10 === 1 && n % 100 !== 11) ? 'st'
    : (n % 10 === 2 && n % 100 !== 12) ? 'nd'
    : (n % 10 === 3 && n % 100 !== 13) ? 'rd' : 'th';
  return `${n}${s}`;
}

// One-time import of MS editor/area data collected by the old Google-Sheet
// pipeline from sources that don't exist on Crossref. Shared with fun/ms.
const MS_OVERRIDES_PATH = resolve(__dirname, '..', '..', 'ms', '_scraper', 'editor-overrides.json');
const MS_OVERRIDES = existsSync(MS_OVERRIDES_PATH)
  ? JSON.parse(await readFile(MS_OVERRIDES_PATH, 'utf8'))
  : {};

// Curated volume/issue fixups (keyed by DOI, shared across journals) for
// advance-access records that Crossref froze without a volume/issue — otherwise
// they read as "Articles in Advance" forever. { "<doi>": { volume, issue, page?,
// year? } }. Filled only when Crossref itself still returns none. See fun/ms.
const AIA_FIXUPS_PATH = MOCK ? join(MOCK_DIR, 'aia-fixups.json') : join(DATA_DIR, '_aia-fixups.json');
const AIA_FIXUPS = existsSync(AIA_FIXUPS_PATH)
  ? JSON.parse(await readFile(AIA_FIXUPS_PATH, 'utf8'))
  : {};

// Forthcoming papers INFORMS lists on pubsonline.informs.org/toc/<jc>/0/0 but
// Crossref has not indexed yet. Built on a personal machine by
// _scraper/informs-aia-local.mjs (pubsonline blocks cloud IPs) and committed
// here; each entry names its source ("jkey"). Merged in main() so the newest
// forthcoming papers appear before Crossref catches up.
// { "<doi>": { jkey, Title, Authors?, Affiliations?, Abstract?, 'Accepting Editor'?, Area?, Year? } }.
const AIA_SUPPLEMENT_PATH = MOCK ? join(MOCK_DIR, 'informs-aia.json') : join(DATA_DIR, '_informs-aia.json');
const AIA_SUPPLEMENT = existsSync(AIA_SUPPLEMENT_PATH)
  ? JSON.parse(await readFile(AIA_SUPPLEMENT_PATH, 'utf8'))
  : {};

// ── Generic fetch helpers ───────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-scraper/1.0 (mailto:${MAILTO})` } });
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

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...headers,
    },
    redirect: 'follow',
  });
  return { status: res.status, body: await res.text() };
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

// PNAS deposits its one-paragraph "Significance" statement inside the Crossref
// JATS abstract as its own <sec>. Pull that section out (already stripped of
// tags) and return the abstract with it removed, so the two show separately on
// the card. Returns {significance:'', rest:<input>} when there is no such
// section (the common case for non-PNAS journals). No pnas.org fetch needed —
// the text is already in the Crossref record.
export function extractSignificance(rawAbstract) {
  if (!rawAbstract) return { significance: '', rest: rawAbstract || '' };
  const cut = (m) => rawAbstract.slice(0, m.index) + rawAbstract.slice(m.index + m[0].length);
  // Primary: a <sec> whose <title> is "Significance".
  const secRe = /<(?:jats:)?sec\b[^>]*>\s*<(?:jats:)?title>\s*significance\s*<\/(?:jats:)?title>([\s\S]*?)<\/(?:jats:)?sec>/i;
  let m = rawAbstract.match(secRe);
  if (m) return { significance: stripJats(m[1]), rest: cut(m) };
  // Fallback: a bare <title>Significance</title> followed by a single <p>.
  const pRe = /<(?:jats:)?title>\s*significance\s*<\/(?:jats:)?title>\s*<(?:jats:)?p>([\s\S]*?)<\/(?:jats:)?p>/i;
  m = rawAbstract.match(pRe);
  if (m) return { significance: stripJats(m[1]), rest: cut(m) };
  return { significance: '', rest: rawAbstract };
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

// ── Management Science editor/area extraction (ported from fun/ms) ─────────
// Only applied to MS records; the page shows Editors/Areas for MS alone.

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
  const title = (item.title && item.title[0]) ? stripJats(item.title[0]) : '';
  if (!title) return null;

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

  // PNAS: split the "Significance" statement out of the abstract into its own
  // field (shown as a separate card tab). Other sources have no such section,
  // so the abstract is unchanged for them.
  let significance = '';
  let abstractSrc = item.abstract || '';
  if (src.key === 'pnas') {
    const sp = extractSignificance(abstractSrc);
    significance = sp.significance;
    abstractSrc = sp.rest;
  }
  const abstract = stripJats(abstractSrc).slice(0, MAX_ABSTRACT);

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
    _rank: pubRank(item, volume, issue, status, year),
  };
  if (src.seEditors) row['Senior Editor'] = se;
  if (src.aeEditors) row['Associate Editor'] = ae;
  if (significance) row.Significance = significance.slice(0, MAX_ABSTRACT);
  // Crossref citation count (is-referenced-by-count). A different, lower metric
  // than Google Scholar's — the page labels it "Cited by N · Crossref" and links
  // to a Scholar title search for the live GS number. Omit zero/missing so it
  // never bloats the papers files or shows a "Cited by 0" badge.
  const citedBy = item['is-referenced-by-count'];
  if (typeof citedBy === 'number' && citedBy > 0) row.CitedBy = citedBy;
  return row;
}

// Overlay Senior/Associate Editor names from the committed cache built by
// informs-editors-local.mjs on a personal machine (Crossref rarely carries the
// History line; pubsonline.informs.org blocks cloud IPs). Cache shape:
//   { "<doi>": { se: "Name; Name", ae: "Name" } }
async function applyInformsEditors(bySource) {
  const path = MOCK ? join(MOCK_DIR, 'informs-editors.json') : join(DATA_DIR, '_informs-editors.json');
  const cache = await loadJsonIfExists(path, {});
  const map = cache.map || cache; // tolerate both {map:{...}} and flat shapes
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

// A no-volume/no-issue article counts as "Articles in Advance" only if it is
// recent; an older one is a published paper whose Crossref record was frozen at
// the advance stage (fill its issue via _aia-fixups.json), not a forthcoming one.
function forthcomingStatus(volume, issue, year, pullDate) {
  if (volume || issue) return '';
  const py = parseInt(String(pullDate).slice(0, 4), 10) || 0;
  const y = parseInt(year, 10) || 0;
  return (y && y >= py - 3) ? 'Articles in Advance' : '';
}

function pubRank(item, volume, issue, status, year) {
  const aia = status ? 1 : 0; // any non-published status ranks above published
  const y = parseInt(year != null ? year : yearOf(item), 10) || 0;
  const v = parseInt(volume, 10) || 0;
  const iss = parseInt(issue, 10) || 0;
  const p = parseInt(String(item.page || '').split(/[-–]/)[0], 10) || 0;
  return aia * 1e13 + y * 1e9 + v * 1e6 + Math.min(iss, 999) * 1e3 + Math.min(p, 999);
}

// registry key: DOI when there is one, else a title|year key (EC forthcoming)
function regKey(row) {
  return row._doi || ('t:' + normTitle(row.Title) + '|' + row.Year);
}

// ── journal pulls ───────────────────────────────────────────────────────────

async function fetchJournalWorks(src) {
  if (MOCK) {
    const raw = await loadJsonIfExists(join(MOCK_DIR, `crossref-${src.key}.json`), null);
    const items = raw ? (raw.message ? raw.message.items : raw) : [];
    console.log(`  [mock] ${src.key}: ${items.length} items`);
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
        const url = `${base}?rows=${ROWS}&cursor=${encodeURIComponent(cursor)}` +
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
      }
      console.log(`  ${src.key}/${issn}: +${all.length - before} records`);
    } catch (e) {
      // The primary ISSN must succeed; secondary/predecessor ISSNs are
      // best-effort (a 404 there must not sink the whole build).
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

// ── PNAS ────────────────────────────────────────────────────────────────────

async function refreshPnasConcepts() {
  const cachePath = join(DATA_DIR, '_pnas-concepts.json');
  let cache = await loadJsonIfExists(cachePath, { map: {} });
  if (MOCK) {
    cache = await loadJsonIfExists(join(MOCK_DIR, 'pnas-concepts.json'), { map: {} });
    return cache;
  }
  if (process.env.LIT_PNAS_CRAWL === '0') return cache;
  // Opportunistic refresh: pnas.org normally rejects datacenter IPs with a
  // Cloudflare challenge; probe one page first so a blocked run costs one
  // request instead of five timeouts. Failure keeps the committed cache.
  try {
    const probe = await fetchText('https://www.pnas.org/action/doSearch?SeriesKey=pnas&ConceptID=500068&startPage=0&pageSize=20');
    if (isChallenged(probe.body, probe.status)) {
      console.log('  pnas.org is Cloudflare-challenged from here — using the committed section cache' +
        (cache.updated ? ` (updated ${cache.updated})` : ' (EMPTY — run _scraper/pnas-concepts-local.mjs locally to seed it)'));
      return cache;
    }
    const full = !cache.full;
    const afterYear = full ? null : (parseInt(PULL_DATE.slice(0, 4), 10) - 2);
    console.log(`  pnas.org reachable — refreshing sections (${full ? 'full backfill' : 'incremental since ' + afterYear})`);
    const res = await crawlConcepts(async (url) => fetchText(url), { afterYear, log: console.log });
    if (res.map.size) {
      cache = mergeIntoCache(cache, res.map, { pullDate: PULL_DATE, full: full && res.ok });
      await writeJson('_pnas-concepts.json', cache);
    }
  } catch (e) {
    console.warn('  PNAS section refresh failed (non-fatal):', e.message);
  }
  return cache;
}

// ── PNAS fallback classifier: OpenAlex primary topic ────────────────────────
// pnas.org's own section index (the committed _pnas-concepts.json, built
// locally) is authoritative. For papers it does not cover, OpenAlex — which
// cloud runners CAN reach — supplies an approximation: each work's PRIMARY
// topic carries a field/subfield that maps onto the five sections. Content-
// based rather than editorial, so it over/under-includes at the margins; an
// official label always wins the moment the local crawl provides one.
//
// We classify from the PRIMARY topic ONLY — the paper's actual main subject.
// An earlier attempt also counted strong SECONDARY topics (score ≥ 0.5) to
// widen recall, but OpenAlex's field taxonomy does not line up with PNAS's
// editorial sections, so a tangential co-topic dragged in clearly off-section
// papers — e.g. an antibody-delivery study or lunar-sample geochemistry
// labelled "Environmental Sciences", molecular biology labelled "Computer
// Sciences". Precision matters more than recall for a curated browser, and
// the accurate way to recover genuine cross-field papers is the official
// pnas.org section index, not stretching OpenAlex topics.
//
// The field map below is additive and deliberately conservative: only fields
// that map cleanly onto the five PNAS sections. Bump PNAS_APPROX_VERSION
// whenever these rules change — refreshPnasApprox treats a version mismatch as
// "cache stale" and re-classifies the WHOLE corpus, so a rule change is
// applied retroactively to old papers, not just to the recent tail.
const PNAS_APPROX_VERSION = 3;

// One OpenAlex topic object → the set of section keys it implies.
export function classifyOneTopic(t) {
  const keys = new Set();
  if (!t) return keys;
  const field = t.field?.display_name || '';
  const subfield = t.subfield?.display_name || '';
  const topic = t.display_name || '';
  if (field === 'Computer Science') keys.add('pnas-cs');
  if (field === 'Economics, Econometrics and Finance') { keys.add('pnas-econ'); keys.add('pnas-soc'); }
  if (field === 'Business, Management and Accounting') keys.add('pnas-econ');
  if (field === 'Environmental Science') keys.add('pnas-env');
  if (field === 'Social Sciences' || field === 'Psychology') keys.add('pnas-soc');
  if (subfield === 'Renewable Energy, Sustainability and the Environment'
      || /sustainab/i.test(topic) || /sustainab/i.test(subfield)) keys.add('pnas-sust');
  return keys;
}

// A whole work → section keys, from its primary topic alone.
export function classifyOpenAlexWork(w) {
  return [...classifyOneTopic(w.primary_topic)].sort();
}

async function refreshPnasApprox(officialCount) {
  const path = join(DATA_DIR, '_pnas-approx.json');
  let cache = await loadJsonIfExists(path, { map: {} });
  if (MOCK || process.env.LIT_PNAS_APPROX === '0') return cache;
  try {
    // A full backfill runs once; afterwards only recent publications are
    // re-checked. A PNAS_APPROX_VERSION mismatch (i.e. the topic→section rules
    // changed) invalidates the cache, so the next run re-classifies the WHOLE
    // corpus — that is what retroactively fills gaps for older papers.
    const haveFull = !!cache.full && cache.version === PNAS_APPROX_VERSION;
    const filter = 'locations.source.issn:0027-8424'
      + (haveFull ? `,from_publication_date:${new Date(new Date(PULL_DATE).getTime() - 90 * 864e5).toISOString().slice(0, 10)}` : '');
    console.log(`  pnas approx (OpenAlex): ${haveFull ? 'incremental' : `FULL backfill (classifier v${PNAS_APPROX_VERSION})`} crawl…`);
    let cursor = '*', pages = 0, seen = 0;
    while (cursor) {
      const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
        `&select=doi,primary_topic&per-page=200&cursor=${encodeURIComponent(cursor)}&mailto=${encodeURIComponent(MAILTO)}`;
      const j = await fetchJson(url);
      for (const w of j.results || []) {
        const doi = String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
        if (!doi) continue;
        seen++;
        const keys = classifyOpenAlexWork(w);
        if (keys.length) cache.map[doi] = keys;
        else delete cache.map[doi]; // reclassified away from our sections
      }
      cursor = j.meta && j.meta.next_cursor;
      pages++;
      if (pages % 50 === 0) console.log(`    …page ${pages}, ${seen} works scanned, ${Object.keys(cache.map).length} matched`);
      if (!j.results || !j.results.length) break;
      await sleep(250);
    }
    const sorted = {};
    for (const k of Object.keys(cache.map).sort()) sorted[k] = cache.map[k];
    cache = { updated: PULL_DATE, full: true, version: PNAS_APPROX_VERSION, map: sorted };
    await writeJson('_pnas-approx.json', cache);
    console.log(`  pnas approx: ${Object.keys(cache.map).length} DOIs mapped (${pages} pages)` +
      (officialCount ? `; official index covers ${officialCount} and always wins` : ''));
  } catch (e) {
    console.warn('  PNAS approx refresh failed (non-fatal):', e.message);
  }
  return cache;
}

function applyPnasSections(papers, cache, approx) {
  const secName = Object.fromEntries(PNAS_SECTIONS.map(s => [s.key, s.name]));
  const out = [];
  let official = 0, approximate = 0;
  // Once a FULL official crawl exists, it is authoritative for everything
  // published up to its crawl year: a DOI absent from it is genuinely not in
  // any of the five sections, so the approximation must not resurrect it.
  // The approximation then only covers the fresh tail the crawl hasn't seen
  // yet (papers from the crawl year onward). Re-running the local script
  // therefore corrects BOTH wrong labels and wrongly included papers.
  const officialCutoffYear = (cache.full && cache.updated)
    ? parseInt(String(cache.updated).slice(0, 4), 10)
    : -Infinity; // no full official index yet: approximation covers everything
  for (const p of papers) {
    let keys = cache.map[p._doi];
    if (keys && keys.length) official++;
    else {
      const y = parseInt(p.Year, 10) || 0;
      const approxAllowed = !(cache.full && cache.updated) || y >= officialCutoffYear;
      keys = approxAllowed && approx && approx.map ? approx.map[p._doi] : null;
      if (keys && keys.length) approximate++;
    }
    if (!keys || !keys.length) continue;   // only papers in the five sections
    p.Sections = keys.map(k => secName[k]).filter(Boolean);
    p._secKeys = keys;
    out.push(p);
  }
  console.log(`  pnas sections: ${official} from pnas.org's index, ${approximate} approximated from OpenAlex topics` +
    (officialCutoffYear > 0 ? ` (approximation limited to papers from ${officialCutoffYear} on)` : ''));
  return out;
}

// ── ACM EC ──────────────────────────────────────────────────────────────────

// Exact Crossref container title — reliable for 2020+ only (earlier ACM
// deposits use spelled-out ordinals, year-based names and varying case).
export function ecContainerTitle(year) {
  return `Proceedings of the ${ordSuffix(ecEditionNumber(year))} ACM Conference on Economics and Computation`;
}

async function fetchEcCrossref(years) {
  if (MOCK) {
    const raw = await loadJsonIfExists(join(MOCK_DIR, 'crossref-ec.json'), null);
    return raw ? (raw.message ? raw.message.items : raw) : [];
  }
  const all = [];
  for (const y of years) {
    const t = ecContainerTitle(y);
    let cursor = '*';
    for (;;) {
      const url = 'https://api.crossref.org/works?filter=' +
        encodeURIComponent(`container-title:${t},type:proceedings-article`) +
        `&rows=${ROWS}&cursor=${encodeURIComponent(cursor)}` +
        `&select=${encodeURIComponent(SELECT)}&mailto=${encodeURIComponent(MAILTO)}`;
      const body = await fetchJson(url);
      const items = body.message.items || [];
      all.push(...items);
      cursor = body.message['next-cursor'];
      if (!items.length || !cursor) break;
    }
    console.log(`  ec ${y}: cumulative ${all.length} proceedings papers`);
  }
  return all;
}

async function fetchSigecomPages(years) {
  const out = {}; // year -> entries[]
  for (const y of years) {
    let html = null;
    if (MOCK) {
      const p = join(MOCK_DIR, `sigecom-ec${y}.html`);
      if (existsSync(p)) html = await readFile(p, 'utf8');
    } else {
      try {
        const r = await fetchText(`https://ec${String(y).slice(2)}.sigecom.org/program/accepted-papers/`);
        if (r.status === 200) html = r.body;
        else console.warn(`  sigecom ec${y}: HTTP ${r.status} (skipping)`);
      } catch (e) {
        console.warn(`  sigecom ec${y}: ${e.message} (skipping)`);
      }
    }
    if (!html) continue;
    const entries = parseAcceptedPapers(html, y);
    // A tiny result usually means the page exists but the list is not up yet
    // (or the format changed) — better to skip than to ingest garbage.
    if (entries.length >= 20) out[y] = entries;
    else console.warn(`  sigecom ec${y}: parsed only ${entries.length} entries — ignoring page`);
    if (!MOCK) await sleep(600);
  }
  return out;
}

// Historical proceedings (1999-2019) from DBLP's per-year tables of contents:
// clean titles, authors, pages and DOIs. Abstracts and PDF links are attached
// afterwards by the same OpenAlex/S2 enrichment as the modern years.
async function fetchEcDblpHistory(years) {
  const eeByTitle = new Map(); // normTitle -> [ee urls], reused by enrichEc so
                               // the tocs are not fetched twice (DBLP rate-limits)
  if (MOCK) return { rows: [], eeByTitle };
  // Historical tables of contents never change, so successfully fetched years
  // are kept in a committed cache — a night when DBLP throttles a year no
  // longer makes that year's papers vanish from the dataset until re-fetched.
  const cache = await loadJsonIfExists(join(DATA_DIR, '_ec-dblp.json'), {});
  const rows = [];
  let cacheDirty = false;
  for (const y of years) {
    const cached = cache[String(y)];
    if (cached && Array.isArray(cached.rows) && cached.rows.length) {
      rows.push(...cached.rows);
      for (const [k, v] of cached.ee || []) eeByTitle.set(k, v);
      continue;
    }
    let hits = [];
    for (const key of [`sigecom${y}`, `sigecom${String(y).slice(2)}`]) {
      try {
        const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(`toc:db/conf/sigecom/${key}.bht:`)}&h=500&format=json`;
        const j = await fetchJson(url);
        hits = [].concat(j?.result?.hits?.hit || []);
        if (hits.length) break;
      } catch (e) {
        console.warn(`  dblp ec ${y} (${key}): ${e.message}`);
      }
      await sleep(1500);
    }
    const yearRows = [];
    const yearEe = [];
    for (const hit of hits) {
      const info = hit.info || {};
      if (info.title) {
        const ee = [].concat(info.ee || []);
        yearEe.push([normTitle(info.title), ee]);
        eeByTitle.set(normTitle(info.title), ee);
      }
      if (info.type && info.type !== 'Conference and Workshop Papers') continue;
      const title = String(info.title || '').replace(/\.\s*$/, '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const authors = [].concat(info.authors?.author || [])
        .map(a => String(a && a.text !== undefined ? a.text : a).replace(/\s+\d{4}$/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      let doi = String(info.doi || '').toLowerCase();
      if (!doi) {
        const m = String(info.ee || '').match(/doi\.org\/(10\.\d{4,}\/[^\s"']+)/i);
        if (m) doi = m[1].toLowerCase();
      }
      const pageStart = parseInt(String(info.pages || '').split(/[-–]/)[0], 10) || 0;
      yearRows.push({
        Title: title,
        Authors: authors.join(', '),
        Affiliations: '',
        DOI: doi ? 'https://doi.org/' + doi : '',
        Volume: '', Issue: '',
        Page: info.pages || '',
        Year: String(info.year || y),
        Status: '',
        Abstract: '',
        'Accepting Editor': '', Area: '',
        Journal: EC.name, JKey: EC.key,
        Booktitle: ecBooktitle(parseInt(info.year, 10) || y),
        _doi: doi,
        _orcids: [],
        _rank: (parseInt(info.year, 10) || y) * 1e9 + Math.min(pageStart, 999),
      });
    }
    console.log(`  ec ${y} (dblp): ${yearRows.length} papers`);
    if (yearRows.length) {
      cache[String(y)] = { rows: yearRows, ee: yearEe };
      cacheDirty = true;
      rows.push(...yearRows);
    }
    await sleep(2500);
  }
  if (cacheDirty) await writeJson('_ec-dblp.json', cache);
  return { rows, eeByTitle };
}

function buildEcRows(crossrefItems, sigecomByYear, dblpRows) {
  const rows = [];
  const byTitle = new Map(); // normTitle -> row (from Crossref)
  const seen = new Set();
  const perYear = {};        // Crossref proceedings rows per conference year
  for (const item of crossrefItems) {
    if (item.type && item.type !== 'proceedings-article') continue;
    const row = mapWork(item, EC);
    if (!row) continue;
    if (row._doi && seen.has(row._doi)) continue;
    if (row._doi) seen.add(row._doi);
    row.Status = '';                       // proceedings papers are published
    // mapWork saw no volume/issue and set the Articles-in-Advance rank bit;
    // published proceedings papers must not outrank everything, so drop it.
    if (row._rank >= 1e13) row._rank -= 1e13;
    row.Volume = ''; row.Issue = '';
    const yr = parseInt(row.Year, 10);
    if (yr) row.Booktitle = ecBooktitle(yr);
    perYear[row.Year] = (perYear[row.Year] || 0) + 1;
    byTitle.set(normTitle(row.Title), row);
    rows.push(row);
  }
  // Historical years from DBLP (no overlap with the Crossref era, but dedupe
  // by DOI and title anyway).
  for (const row of dblpRows || []) {
    if (row._doi && seen.has(row._doi)) continue;
    if (byTitle.has(normTitle(row.Title))) continue;
    if (row._doi) seen.add(row._doi);
    byTitle.set(normTitle(row.Title), row);
    rows.push(row);
  }
  // Accepted-papers pages: enrich matches with affiliations; add rows for
  // not-yet-published papers. The latter only for years whose proceedings are
  // not in the ACM DL yet — for published years an unmatched entry is almost
  // always an accepted-vs-camera-ready title change (or a withdrawal), and
  // adding it would create a permanent DOI-less phantom duplicate.
  for (const [year, entries] of Object.entries(sigecomByYear)) {
    const proceedingsPublished = (perYear[year] || 0) >= 20;
    for (const e of entries) {
      const key = normTitle(e.title);
      const match = byTitle.get(key);
      if (match) {
        if (!match.Affiliations && e.affiliations.length) {
          match.Affiliations = e.affiliations.join('; ');
        }
        continue;
      }
      if (proceedingsPublished) continue;
      rows.push({
        Title: e.title,
        Authors: e.authors.join(', '),
        Affiliations: e.affiliations.join('; '),
        DOI: '',
        Volume: '', Issue: '', Page: '',
        Year: String(year),
        Status: `Accepted (EC ’${String(year).slice(2)})`,
        Abstract: '',
        'Accepting Editor': '', Area: '',
        Journal: EC.name, JKey: EC.key,
        _doi: '',
        _orcids: [],
        _rank: 1e13 + (parseInt(year, 10) || 0) * 1e9, // forthcoming ranks first
      });
    }
  }
  return rows;
}

// ── EC extras: PDF links (arXiv/SSRN/OA) + abstracts ───────────────────────

function invertAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [w, positions] of Object.entries(inv)) {
    for (const pos of positions) words[pos] = w;
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

function pickPdf(cands) {
  // http(s) only: these URLs come from third-party metadata and end up in an
  // href, so anything else (javascript:, data:, …) is dropped outright.
  const list = cands.filter(u => u && /^https?:\/\//i.test(u));
  return list.find(u => /arxiv\.org/i.test(u))
      || list.find(u => /ssrn\.com|papers\.ssrn/i.test(u))
      || list[0] || '';
}

async function enrichEc(rows, extras, dblpPrefetched) {
  if (MOCK) return; // offline: covered by the seed run on the Actions runner

  const keyOf = (r) => r._doi || ('t:' + normTitle(r.Title));
  const need = rows.filter(r => !(extras[keyOf(r)]));

  // 1. OpenAlex, batched 50 DOIs per request.
  const needDoi = need.filter(r => r._doi);
  for (let i = 0; i < needDoi.length; i += 50) {
    const batch = needDoi.slice(i, i + 50);
    const url = 'https://api.openalex.org/works?filter=doi:' +
      batch.map(r => r._doi).join('|') +
      '&per-page=50&select=doi,open_access,best_oa_location,locations,abstract_inverted_index' +
      `&mailto=${encodeURIComponent(MAILTO)}`;
    try {
      const j = await fetchJson(url);
      const byDoi = new Map();
      for (const w of j.results || []) {
        byDoi.set(String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(), w);
      }
      for (const r of batch) {
        const w = byDoi.get(r._doi);
        if (!w) continue;
        const locs = (w.locations || []).flatMap(l => [l.pdf_url, l.landing_page_url]);
        const pdf = pickPdf([...locs.filter(u => /arxiv\.org|ssrn/i.test(u || '')),
          w.best_oa_location && w.best_oa_location.pdf_url,
          w.open_access && w.open_access.oa_url]);
        const abs = invertAbstract(w.abstract_inverted_index).slice(0, MAX_ABSTRACT);
        if (pdf || abs) extras[keyOf(r)] = { pdf, abs, src: 'openalex' };
      }
    } catch (e) {
      console.warn('  openalex batch failed (non-fatal):', e.message);
    }
    await sleep(400);
  }

  // 2. DBLP per-year toc: arXiv/SSRN "ee" links matched by title. Historical
  //    years were already fetched by fetchEcDblpHistory (reused here — DBLP
  //    rate-limits aggressively when the tocs are pulled twice per build), so
  //    only the modern years are fetched.
  const dblp = new Map(dblpPrefetched || []); // normTitle -> [ee urls]
  const years = [...new Set(rows.map(r => parseInt(r.Year, 10)).filter(Boolean))]
    .filter(y => y >= EC.sigecomFirstYear).sort();
  for (const y of years) {
    try {
      const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(`toc:db/conf/sigecom/sigecom${y}.bht:`)}&h=500&format=json`;
      const j = await fetchJson(url);
      for (const hit of j?.result?.hits?.hit || []) {
        const info = hit.info || {};
        const ee = [].concat(info.ee || []);
        if (info.title) dblp.set(normTitle(info.title), ee);
      }
    } catch (e) {
      console.warn(`  dblp ${y} failed (non-fatal):`, e.message);
    }
    await sleep(2500);
  }
  for (const r of rows) {
    const k = keyOf(r);
    if (extras[k] && extras[k].pdf) continue;
    const ee = dblp.get(normTitle(r.Title)) || [];
    const pdf = pickPdf(ee.filter(u => /arxiv\.org|ssrn/i.test(u || '')));
    if (pdf) extras[k] = { ...(extras[k] || {}), pdf, src: 'dblp' };
  }

  // 2b. Title search for rows with NO DOI — a fresh year's accepted-papers
  //     list (e.g. EC '26) lives only on sigecom.org, so the by-DOI pass
  //     can't cover it and DBLP has no toc until the ACM DL publishes the
  //     proceedings. Semantic Scholar (pass 3) rate-limits cloud runners
  //     into uselessness (the cache has never held a single title-keyed
  //     hit), so this pass is what actually links a new year's accepted
  //     papers to their pre-prints. Same gentle fetch, same three engines
  //     (OpenAlex as the optional bonus net, then Crossref, then arXiv's
  //     API) and same conservative matcher as the preprint title-search.
  //     A versioned `oat` marker (bumped alongside the engine set) records
  //     a searched-but-unlinked title so the next run spends its budget on
  //     new rows; DBLP/S2 can still fill those in later.
  const OAT_VER = 4;
  let oatLeft = parseInt(process.env.LIT_EC_TITLE_CAP || '350', 10);
  let ecOaAlive = true, ecOaBad = 0, ecAxAlive = true, ecAxFails = 0, ecCrFails = 0;
  const noDoi = rows.filter(r => !r._doi)
    .sort((a, b) => (parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0));
  for (const r of noDoi) {
    if (oatLeft <= 0 || ecCrFails >= 6 || (!ecOaAlive && !ecAxAlive)) break;
    const k = keyOf(r);
    const cur = extras[k];
    // The `oat` marker (not S2's un-versioned `none`) gates THIS pass: an
    // S2 miss must not exempt a row from a wider-engine re-search when
    // OAT_VER is bumped — the row is stamped oat after one clean pass here.
    if (cur && (cur.pdf || (cur.oat || 0) >= OAT_VER)) continue;
    const q = String(r.Title || '').replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) { extras[k] = { ...(cur || {}), oat: OAT_VER }; continue; }
    oatLeft--;
    let pick = null, oaRan = false, axFired = false;
    if (ecOaAlive) {
      const url = 'https://api.openalex.org/works?filter=title.search:' + encodeURIComponent(q) +
        '&per-page=25&select=doi,title,publication_year,authorships,best_oa_location,primary_location,locations' +
        `&mailto=${encodeURIComponent(MAILTO)}`;
      const oa = await oaGet(url);
      if (oa.ok) {
        ecOaBad = 0; oaRan = true;
        pick = matchPreprintWork({ title: r.Title, year: r.Year, authors: r.Authors },
          (oa.json && oa.json.results) || []);
      } else {
        ecOaBad++;
        const throttle = oa.status === 429 || oa.status === 403;
        if ((throttle && oa.retryAfter > 3600) || ecOaBad >= 6) {
          ecOaAlive = false;    // day's quota spent — Crossref+arXiv carry the pass
        } else if (throttle) {
          await sleep(Math.min(Math.max(oa.retryAfter, 2) * 1000, 10000));
        }
      }
    }
    let crOk = false;
    if (!pick) {
      const cr = await searchCrossrefPreprints(r);
      if (cr && cr.err) ecCrFails++; else { ecCrFails = 0; crOk = true; pick = cr; }
    }
    let axOk = false;
    if (!pick && !oaRan && ecAxAlive) {
      axFired = true;
      const ax = await searchArxivPreprint(r);
      if (ax && ax.err) { if (++ecAxFails >= 6) ecAxAlive = false; }
      else { ecAxFails = 0; axOk = true; pick = ax; }
    }
    if (pick) extras[k] = { ...(cur || {}), pdf: pick.u, src: 'openalex-title' };
    else if (crOk && (oaRan || axOk)) extras[k] = { ...(cur || {}), oat: OAT_VER };
    // else: a required leg failed — the row stays unmarked so a later run retries
    await sleep(axFired ? 3100 : 300);
  }

  // 3. Semantic Scholar title match for whatever still has no PDF. Capped per
  //    run (public rate limits); the cache makes this resume across runs.
  let s2Left = S2_CAP, s2Errors = 0;
  for (const r of rows) {
    if (s2Left <= 0 || s2Errors >= 5) break;
    const k = keyOf(r);
    const cur = extras[k];
    if (cur && (cur.pdf || cur.none)) continue;
    s2Left--;
    try {
      const url = 'https://api.semanticscholar.org/graph/v1/paper/search/match?query=' +
        encodeURIComponent(r.Title) + '&fields=title,externalIds,openAccessPdf,abstract';
      const res = await fetch(url, { headers: { 'User-Agent': `lit-scraper/1.0 (mailto:${MAILTO})` } });
      if (res.status === 404) { extras[k] = { ...(cur || {}), none: true }; await sleep(1100); continue; }
      if (res.status === 429) { s2Errors++; await sleep(8000); continue; }
      if (!res.ok) { s2Errors++; await sleep(2000); continue; }
      s2Errors = 0;
      const j = await res.json();
      const hit = (j.data && j.data[0]) || null;
      if (!hit || normTitle(hit.title || '') !== normTitle(r.Title)) {
        extras[k] = { ...(cur || {}), none: true };
      } else {
        const arx = hit.externalIds && hit.externalIds.ArXiv;
        const pdf = pickPdf([arx ? `https://arxiv.org/abs/${arx}` : '',
          hit.openAccessPdf && hit.openAccessPdf.url]);
        const abs = (cur && cur.abs) || String(hit.abstract || '').slice(0, MAX_ABSTRACT);
        extras[k] = pdf || abs ? { ...(cur || {}), pdf, abs, src: 's2' } : { ...(cur || {}), none: true };
      }
    } catch (e) {
      s2Errors++;
    }
    await sleep(1100);
  }

  // Apply the cache to the rows.
  let withPdf = 0;
  for (const r of rows) {
    const x = extras[keyOf(r)];
    if (!x) continue;
    if (x.pdf) { r.PDF = canonPreprint(x.pdf); withPdf++; }
    if (!r.Abstract && x.abs) r.Abstract = x.abs;
    // A DOI-less accepted paper can never receive a Preprint link from the
    // DOI-keyed _preprints.json cache — surface its arXiv/SSRN copy directly.
    // (The card then shows the Pre-print link and suppresses the duplicate
    // PDF tag; applyPreprints leaves DOI-less rows untouched.)
    if (!r._doi && r.PDF && !r.Preprint) {
      const pk = pickPreprint([r.PDF]);
      if (pk) { r.Preprint = pk.u; r.PreprintSrc = pk.s; }
    }
  }
  console.log(`  ec extras: ${withPdf}/${rows.length} papers have a PDF link`);
}

// ── Pre-print (arXiv/SSRN) open-access links, for every source ──────────────
// Any paper with a free author pre-print on arXiv or SSRN gets a `Preprint`
// URL (+ `PreprintSrc`), surfaced on the card as an open-access link. Resolved
// from OpenAlex by DOI — batched exactly like enrichEc — and cached in
// data/_preprints.json (doi -> {u,s} | {none:1}) so the daily build only
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

// Among OpenAlex title-search results, find the SAME paper's arXiv/SSRN
// preprint record. Conservative on purpose (a wrong link is worse than none):
// requires an exact-or-prefix title match (titlesMatch), two shared author
// surnames (one for single-author records), a plausible year, and only accepts an arXiv/SSRN-hosted location or preprint
// DOI. Pure → unit-tested.
export function matchPreprintWork(paper, results) {
  const nt = normTitle(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const w of results || []) {
    const tmw = titlesMatch(nt, normTitle(w.title || ''));
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
  const nt = normTitle(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const it of items || []) {
    const wt = normTitle(String((Array.isArray(it.title) ? it.title[0] : it.title) || ''));
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
  const nt = normTitle(paper.title || '');
  if (!nt) return null;
  const py = parseInt(paper.year, 10);
  const mine = lastNames(String(paper.authors || '').split(','));
  for (const e of entries || []) {
    const tm = titlesMatch(nt, normTitle(e.title || ''));
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
    maxBatches: parseInt(process.env.LIT_PREPRINT_DOI_BATCHES || '400', 10),
    budgetMs: 15 * 60 * 1000,
  });

  // 3. Title+author search for papers the by-DOI scan couldn't link — their
  //    arXiv/SSRN preprint exists as a SEPARATE OpenAlex record (own
  //    10.2139/ssrn.* DOI). This is what surfaces most SSRN preprints. It is
  //    strictly TIME-BOUNDED and gentle (see searchPreprintsByTitle) so the
  //    daily build can never hang if OpenAlex throttles the per-paper query;
  //    the full backfill runs online via preprints-ci.mjs (own workflow).
  await searchPreprintsByTitle(allPapers, cache, {
    cap: parseInt(process.env.LIT_PREPRINT_SEARCH_CAP || '2500', 10),
    budgetMs: parseInt(process.env.LIT_PREPRINT_SEARCH_MS || '360000', 10), // 6-minute hard ceiling
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
// past the CI job timeout) so a first FT50-catalog-sized run (250k DOIs =
// 5,000 batches) can never eat a build.
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
// NBER/OSF hosts, two-surname author check, PNAS included, year floor 1991
// (arXiv's first year, instead of 2005).
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
// prerequisite — this is what lets a fresh dataset like the FT50 catalog
// backfill without waiting for a 5,000-batch by-DOI pass).
// Bounded by `cap` and, when given, a wall-clock `budgetMs`. opts.patient
// (preprints-local.mjs / preprints-ci.mjs) additionally rides out OpenAlex
// per-second throttling with escalating backoff (up to maxThrottle
// consecutive waits, ~3-4 min — an OpenAlex that stays down that long is
// treated as out for the run) before giving the leg up.
// Returns the number newly linked.
export async function searchPreprintsByTitle(papers, cache, opts = {}) {
  const cap = opts.cap || 6000;
  const sleepMs = opts.sleepMs || 130;
  const axSleepMs = opts.axSleepMs || 3100;         // arXiv asks for ~1 request/3 s
  const maxThrottle = opts.maxThrottle || 6;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
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
      (((cache[a._doi] || {}).ts ? 1 : 0) - ((cache[b._doi] || {}).ts ? 1 : 0)) ||
      ((parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0)));
  const todo = eligible.slice(0, cap);
  if (opts.log) console.log(`  preprints: title-searching up to ${todo.length} of ${eligible.length} unlinked papers…`);
  let found = 0, searched = 0, oaBad = 0, crFails = 0, axFails = 0;
  let oaAlive = true, axAlive = true;
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    if (Date.now() > deadline) { if (opts.log) console.log('  preprints: title-search time budget reached — resuming next run.'); break; }
    // Without arXiv AND without OpenAlex, only Crossref remains — but Crossref
    // still FINDS SSRN/NBER/bioRxiv/OSF pre-prints (the whole point here), so
    // keep going instead of stalling. A clean Crossref result now stamps a
    // `naxiv` miss (below) that a later arXiv-healthy run re-checks; Crossref
    // itself failing is caught by the crFails backstop.
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
      // miss so the backfill ADVANCES (Crossref keeps surfacing SSRN/NBER/etc.)
      // instead of stalling the instant arXiv is unreachable from CI. naxiv:1
      // keeps it re-eligible for a later run WITH arXiv, which alone can find
      // an arXiv-only pre-print.
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
// Crossref's is-referenced-by-count (harvested for free in mapWork) is only a
// FLOOR: it counts just the references Crossref members deposited. OpenAlex
// and Semantic Scholar index far more citing works (preprints, proceedings,
// books), so their counts sit much closer to Google Scholar's. This pass
// batch-reads both — OpenAlex 50 DOIs per call (filter=doi:a|b,
// select=doi,cited_by_count; NOT a title search, so it draws on the general
// 100k/day quota, not the ~100/day title-search cut-off) and Semantic Scholar
// 500 DOIs per POST (graph/v1/paper/batch) — and caches the best count per
// DOI in data/_citations.json:
//   { "<doi>": { c: <count>, t: <days-since-epoch last checked>, s2: 1? } }
// (`c` omitted when 0 so zero-citation papers cost 12 bytes, not a field;
// `s2:1` marks a count Semantic Scholar won, otherwise OpenAlex did).
// applyCitations() then lifts each row's CitedBy to max(Crossref, cache) and
// stamps CitedBySrc ('oa' | 's2') when the cache wins, so the page labels the
// number's real source. The refresh is ROLLING: never-checked DOIs first (new
// papers get a count on day one), then stalest-check first; entries checked
// within minAgeDays (default 2) are skipped, so a full catalog converges to
// an every-couple-of-days cadence. Both legs are OPTIONAL and drop out
// independently on quota/persistent failure (Semantic Scholar's anonymous
// pool 429s freely) — a healthy leg keeps sweeping, a DOI neither leg covered
// is left un-stamped for the next run, and partial coverage never regresses a
// previously cached count. The full sweep runs online in its own scheduled
// workflow (lit-citations-update.yml -> citations-ci.mjs, daily); the daily
// build runs the same pass strictly time-boxed (LIT_CITATIONS_MS, default
// 5 min) so it can never hang the build.

// One gentle Semantic Scholar batch call (up to 500 DOIs): a single attempt
// with a hard timeout plus ONE ridden-out 429 (their anonymous pool throttles
// in bursts). Returns {ok, arr} | {ok:false, status}.
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

// Refresh the citations cache for up to `cap` new/stale DOIs, bounded by
// opts.budgetMs. Works in chunks of 500 (10 OpenAlex calls + 1 Semantic
// Scholar call, ~10 s), checking the deadline between chunks. Returns the
// number of DOIs (re)stamped.
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
  let oaAlive = true, s2Alive = true, oaFails = 0, s2Fails = 0, done = 0;
  for (let i = 0; i < todo.length && (oaAlive || s2Alive); i += 500) {
    if (Date.now() > deadline) { console.log('  citations: time budget reached — resuming next run.'); break; }
    const chunk = todo.slice(i, i + 500);
    const oaVal = new Map(), s2Val = new Map(), oaDone = new Set();

    // Leg 1: OpenAlex, 50 DOIs per call (like seedPreprintsByDoi).
    if (oaAlive) {
      for (let j = 0; j < chunk.length; j += 50) {
        const batch = chunk.slice(j, j + 50);
        const url = 'https://api.openalex.org/works?filter=doi:' + batch.join('|') +
          '&per-page=50&select=doi,cited_by_count' +
          `&mailto=${encodeURIComponent(MAILTO)}`;
        const r = await oaGet(url);
        if (!r.ok) {
          if (r.status === 429 || r.status === 403 || ++oaFails >= 6) {
            oaAlive = false;
            console.log('  citations: OpenAlex quota/throttle — dropping the OpenAlex leg for this run.');
            break;
          }
          await sleep(2000);
          j -= 50; continue; // transient: retry this batch (bounded by oaFails)
        }
        oaFails = 0;
        for (const w of r.json.results || []) {
          const doi = String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
          if (typeof w.cited_by_count === 'number') oaVal.set(doi, w.cited_by_count);
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
  let n = 0;
  for (const p of allPapers) {
    const x = p._doi && cache[p._doi];
    if (x && x.c > (p.CitedBy || 0)) { p.CitedBy = x.c; p.CitedBySrc = x.s2 ? 's2' : 'oa'; n++; }
  }
  console.log(`  citations: ${n}/${allPapers.length} papers carry an OpenAlex/Semantic Scholar count above Crossref's`);
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

function updateRegistry(papers, reg) {
  // A run that suddenly sees thousands of unknown papers is a source being
  // onboarded (e.g. the PNAS section index arriving), not thousands of new
  // publications — baseline those like a first run (stamp only the newest
  // few) so "recently added" doesn't drown in the influx.
  const MASS_INFLUX = 2000;
  const newKeys = [];
  for (const p of papers) {
    const k = regKey(p);
    if (!(k in reg.map)) newKeys.push(k); // papers is newest-first
  }
  const baseline = reg.firstRun || newKeys.length > MASS_INFLUX;
  if (baseline && !reg.firstRun) {
    console.log(`  registry: ${newKeys.length} unseen papers at once — treating as source onboarding, not news`);
  }
  const seedSet = new Set(baseline ? newKeys.slice(0, SEED_COUNT) : []);
  for (const k of newKeys) {
    reg.map[k] = baseline ? (seedSet.has(k) ? PULL_DATE : '') : PULL_DATE;
  }
  return reg.map;
}

// ── Aggregates (ported from fun/ms, source-aware) ───────────────────────────

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

  // ORCID merging with the same one-paper-misattribution guard as fun/ms.
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
  // Across ~12 sources this would be enormous; keep multi-paper authors (plus
  // everyone in the top slice) so the file stays a sane size. The full
  // pre-trim distinct count still goes out via meta.json (header stat).
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
  // Hard cap: recent.json is pre-fetched on every page load, so it must stay
  // small even if a burst of papers lands on one day.
  return rows.slice(0, 1000).map(x => ({ ...publicRow(x.p), 'Date Added': registry[regKey(x.p)] }));
}

function publicRow(p) {
  const { _doi, _orcids, _rank, _secKeys, ...rest } = p;
  return rest;
}

// Add forthcoming papers INFORMS lists but Crossref hasn't indexed yet (from the
// committed _informs-aia.json). Only DOIs Crossref did not already return are
// added, into their named source, so once Crossref catches up the entry is
// silently superseded. New rows flow through the registry, so they also appear
// in the "Recently added papers" view.
function mergeSupplement(bySource) {
  const seen = new Set();
  for (const k of Object.keys(bySource)) for (const p of bySource[k]) if (p._doi) seen.add(p._doi);
  let added = 0;
  for (const [rawDoi, s] of Object.entries(AIA_SUPPLEMENT)) {
    const doi = (rawDoi || '').toLowerCase();
    if (!doi || seen.has(doi) || !s || !s.Title) continue;
    const src = JOURNALS.find(j => j.key === s.jkey && j.aia);
    if (!src || !bySource[src.key]) continue; // only known advance-publishing sources
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
      _rank: pubRank({}, '', '', 'Articles in Advance', year),
    };
    if (src.seEditors) row['Senior Editor'] = s['Senior Editor'] || '';
    if (src.aeEditors) row['Associate Editor'] = s['Associate Editor'] || '';
    bySource[src.key].push(row);
    added++;
  }
  if (added) console.log(`  merged ${added} forthcoming papers from the INFORMS supplement`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`lit data build: pull date ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}`);
  await mkdir(DATA_DIR, { recursive: true });

  const bySource = {}; // key -> rows (internal shape)

  // 1. The six journals.
  for (const src of JOURNALS) {
    console.log(`${src.name} (${src.issns.join(', ')}):`);
    const raw = await fetchJournalWorks(src);
    bySource[src.key] = mapJournal(raw, src);
    console.log(`  ${src.key}: ${bySource[src.key].length} papers`);
  }
  await applyInformsEditors(bySource);

  // 2. PNAS, filtered to the five topic sections. Official pnas.org labels
  // (local crawl) win; OpenAlex-derived approximations fill the gaps.
  console.log('PNAS:');
  const concepts = await refreshPnasConcepts();
  const nConcepts = Object.keys(concepts.map || {}).length;
  const approx = await refreshPnasApprox(nConcepts);
  const nApprox = Object.keys(approx.map || {}).length;
  if (nConcepts || nApprox) {
    const raw = await fetchJournalWorks(PNAS);
    const all = mapJournal(raw, PNAS);
    bySource.pnas = applyPnasSections(all, concepts, approx);
    console.log(`  pnas: ${bySource.pnas.length} papers across the 5 sections ` +
      `(official index: ${nConcepts} DOIs, OpenAlex approx: ${nApprox})`);
  } else {
    bySource.pnas = [];
    console.log('  pnas: no section index available — skipping the Crossref pull.');
  }

  // 3. ACM EC.
  console.log('ACM EC:');
  const thisYear = parseInt(PULL_DATE.slice(0, 4), 10);
  const sigYears = [];
  for (let y = EC.sigecomFirstYear; y <= thisYear + 1; y++) sigYears.push(y);
  const dblpYears = [];
  for (let y = EC.firstYear; y < EC.sigecomFirstYear; y++) if (y !== 2002) dblpYears.push(y);
  const ecItems = await fetchEcCrossref(sigYears);
  const sigecom = await fetchSigecomPages(sigYears);
  const dblpHistory = await fetchEcDblpHistory(dblpYears);
  const ecRows = buildEcRows(ecItems, sigecom, dblpHistory.rows);
  const extras = await loadJsonIfExists(join(DATA_DIR, '_ec-extras.json'), {});
  await enrichEc(ecRows, extras, dblpHistory.eeByTitle);
  if (!MOCK) await writeJson('_ec-extras.json', extras);
  bySource.ec = ecRows;
  console.log(`  ec: ${ecRows.length} papers (${ecItems.length} from ACM DL via Crossref)`);

  mergeSupplement(bySource);

  // 4. Deterministic order per source, then combined order for aggregates.
  const sourceOrder = [...JOURNALS.map(s => s.key), 'pnas', 'ec'];
  for (const k of sourceOrder) {
    bySource[k].sort((a, b) => (b._rank - a._rank) || cmp(regKey(a), regKey(b)));
  }
  const allPapers = sourceOrder.flatMap(k => bySource[k]);
  // newest-first across sources, so first-run registry seeding is sensible
  const allByRank = [...allPapers].sort((a, b) => (b._rank - a._rank) || cmp(regKey(a), regKey(b)));

  // Pre-print (arXiv/SSRN) open-access links — cached + incremental. Kept
  // non-fatal so a slow/failed OpenAlex run never aborts the data build; the
  // cache we already have is still applied.
  const preprintCache = await loadJsonIfExists(join(DATA_DIR, '_preprints.json'), {});
  try { await resolvePreprints(allPapers, preprintCache); }
  catch (e) { console.warn('  preprints resolve failed (non-fatal):', e.message); }
  if (!MOCK) await writeJson('_preprints.json', preprintCache);
  applyPreprints(allPapers, preprintCache);

  // Citation counts above Crossref's floor — same non-fatal contract as the
  // pre-print pass: the committed cache is always applied even when both
  // refresh legs are down, and the in-build refresh is strictly time-boxed
  // (new papers get their count on day one; the full rolling sweep runs
  // online in lit-citations-update.yml via citations-ci.mjs).
  const citationsCache = await loadJsonIfExists(join(DATA_DIR, '_citations.json'), {});
  if (!MOCK) {
    try {
      await refreshCitations(allPapers, citationsCache, {
        cap: parseInt(process.env.LIT_CITATIONS_CAP || '20000', 10),
        budgetMs: parseInt(process.env.LIT_CITATIONS_MS || '300000', 10), // 5-minute hard ceiling
      });
    } catch (e) { console.warn('  citations refresh failed (non-fatal):', e.message); }
    await writeJson('_citations.json', citationsCache);
  }
  applyCitations(allPapers, citationsCache);

  const reg = await loadRegistry();
  const registry = updateRegistry(allByRank, reg);

  const authors = buildAuthors(allPapers);
  const affiliations = buildAffiliations(allPapers);
  const recent = buildRecent(allPapers, registry);

  // 5. Write per-source paper files + manifest.
  const sources = [];
  let total = 0;
  for (const src of [...JOURNALS, PNAS, EC]) {
    const rows = bySource[src.key].map(publicRow);
    const file = `papers-${src.key}.json`;
    await writeJson(file, rows);
    total += rows.length;
    const entry = { key: src.key, name: src.name, publisher: src.publisher, file, count: rows.length };
    if (src.key === 'ms') entry.editors = true;
    if (src.key === 'pnas') {
      entry.sections = PNAS_SECTIONS.map(s => ({
        key: s.key, name: s.name,
        count: bySource.pnas.filter(p => (p._secKeys || []).includes(s.key)).length,
      }));
    }
    sources.push(entry);
  }

  const meta = {
    lastPull: PULL_DATE,
    paperCount: total,
    authorCount: authors.distinct,
    perSource: Object.fromEntries(sources.map(s => [s.key, s.count])),
    source: 'Crossref REST API (+ sigecom.org, OpenAlex, DBLP, Semantic Scholar for ACM EC; pnas.org section index)',
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

// Only run when executed directly — importing a helper from this module for a
// test must not fire the whole network pipeline.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
