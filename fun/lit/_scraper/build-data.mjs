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
 *   meta.json            { lastPull, paperCount, perSource }
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
    _rank: pubRank(item, volume, issue, status, year),
  };
  if (src.seEditors) row['Senior Editor'] = se;
  if (src.aeEditors) row['Associate Editor'] = ae;
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
        extras[k] = pdf || abs ? { pdf, abs, src: 's2' } : { none: true };
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
    if (x.pdf) { r.PDF = x.pdf; withPdf++; }
    if (!r.Abstract && x.abs) r.Abstract = x.abs;
  }
  console.log(`  ec extras: ${withPdf}/${rows.length} papers have a PDF link`);
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
  // everyone in the top slice) so the file stays a sane size.
  const trimmed = out.filter((a, i) => a.Papers >= 2 || i < 5000);
  return trimmed.map(({ id, ...rest }) => rest);
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
    perSource: Object.fromEntries(sources.map(s => [s.key, s.count])),
    source: 'Crossref REST API (+ sigecom.org, OpenAlex, DBLP, Semantic Scholar for ACM EC; pnas.org section index)',
  };

  await writeJson('sources.json', sources);
  await writeJson('authors.json', authors);
  await writeJson('affiliations.json', affiliations);
  await writeJson('recent.json', recent);
  await writeJson('meta.json', meta);
  await writeJson('_registry.json', registry);

  console.log(`done: ${total} papers (${sources.map(s => `${s.key}:${s.count}`).join(' ')}), ` +
    `${authors.length} authors, ${affiliations.length} affiliations, ${recent.length} recent`);
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
