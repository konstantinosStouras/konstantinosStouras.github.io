/*
 * build-data.mjs — the lit "Working Papers" archive pipeline.
 * ===========================================================================
 * Archives the UNPUBLISHED working papers / pre-prints (SSRN, NBER, arXiv,
 * OSF) of every author already listed in "The Lit" (stouras.com/lit/),
 * and writes them as a static JSON dataset into lit/data-workingpapers/,
 * which the page merges at runtime exactly like the FT50 catalog and the
 * satellite shards (a "Working Papers" journal type; see index.html). No
 * server, no database.
 *
 * WHY A SEPARATE DATASET.  Working papers of every listed author (and every
 * future author) are a large, ever-growing corpus. Keeping them in their own
 * data-workingpapers/ directory — structured identically to a satellite shard
 * — keeps the main dataset lean and lets this archive be lifted out into a
 * dedicated `lit-data-workingpapers` GitHub-Pages repo the day it approaches
 * the 1 GB Pages limit, by moving the folder and flipping ONE constant
 * (WP_DATA_BASE in index.html) from './data-workingpapers/' to
 * '/lit-data-workingpapers/data/'. See _HOW-IT-WORKS.md.
 *
 * WHAT COUNTS AS A WORKING PAPER (deliberately conservative — "genuinely
 * unpublished only"):
 *   • an OpenAlex work of type `preprint` by one of the listed authors,
 *   • hosted on a repository we recognise and can link to (SSRN / NBER /
 *     arXiv / OSF — same host validators as the pre-print feature),
 *   • whose title does NOT already appear in the published catalog, and
 *   • which OpenAlex does not also place in a journal (no published version).
 * A paper that later gets published simply drops out on the next crawl (its
 * title starts matching the published catalog) — and the published record's
 * own "Pre-print (Open Access)" link takes over.
 *
 * HOW IT STAYS POLITE AND SLOW (built to fill over WEEKS, not minutes).
 * OpenAlex is the only API this pipeline calls. Every request is paced
 * (WP_PACE_MS, default 1.5 s — far under the polite-pool ceiling), honours
 * Retry-After, and backs off exponentially on 429/403; each scheduled run
 * does only a small, bounded slice of authors (WP_MAX_AUTHORS) and checkpoints
 * after every author, so the two workflows
 * (.github/workflows/lit-workingpapers-{update-data,backfill}.yml) grow the
 * archive gently across many runs over a month. Progress lives in
 * data-workingpapers/_authors.json (name -> {oaid, ts, done}), so a run always
 * resumes where the last one stopped and never re-crawls a fresh author.
 *
 * AUTHOR PRIORITY (per the site owner): authors who published in Management
 * Science, M&SOM or POM in the last 15 years are crawled FIRST, then the rest
 * of the catalog (newest-active first), then everyone is periodically
 * re-crawled (WP_REFRESH_DAYS) to pick up new working papers.
 *
 * Offline smoke test (no network, uses ./mock/ fixtures):
 *   WP_MOCK=1 node build-data.mjs         # writes ./_mock-out/
 *   node selftest.mjs                      # asserts on the mock output + helpers
 *
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickPreprint, preprintFromDoi, canonPreprint } from '../_scraper/build-data.mjs';
import { normTitle } from '../_scraper/ec-pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = process.env.WP_MOCK === '1';
const MOCK_DIR = join(__dirname, 'mock');

// Output dir. Mock runs write to a scratch dir so a smoke test can never
// pollute the live archive (in particular its _authors.json crawl cursor).
const DATA_DIR = process.env.WP_DATA_DIR
  || (MOCK ? resolve(__dirname, '_mock-out') : resolve(__dirname, '..', 'data-workingpapers'));

// The published catalogs to (a) enumerate authors from and (b) exclude
// already-published titles against. The native eight-source catalog and the
// FT50 catalog both live in this repo; the ABS satellite shards live in
// sibling repos not checked out here, so a working paper published only in an
// ABS-shard journal is not excluded — an accepted edge (it re-drops the day
// that title is seen in a catalog this pipeline can read).
const CATALOG_DIRS = (process.env.WP_CATALOG_DIRS
  || [resolve(__dirname, '..', 'data'), resolve(__dirname, '..', 'data-ft50')].join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const MAILTO = process.env.WP_MAILTO || 'kstouras+litwp@gmail.com'; // distinct OpenAlex quota identity
const PULL_DATE = process.env.WP_PULL_DATE || new Date().toISOString().slice(0, 10);
const THIS_YEAR = parseInt(PULL_DATE.slice(0, 4), 10);

// ── Tunables (every default errs gentle — this is a month-long backfill) ─────
const PACE_MS = parseInt(process.env.WP_PACE_MS || '1500', 10);       // between OpenAlex calls
const MAX_AUTHORS = parseInt(process.env.WP_MAX_AUTHORS || '120', 10); // authors per run
const BUDGET_MS = parseInt(process.env.WP_BUDGET_MS || String(40 * 60 * 1000), 10); // wall-clock ceiling
const REFRESH_DAYS = parseInt(process.env.WP_REFRESH_DAYS || '45', 10); // re-crawl a done author after N days
const PRIORITY_YEARS = parseInt(process.env.WP_PRIORITY_YEARS || '15', 10); // MS/MSOM/POM recency window
const PRIORITY_KEYS = new Set((process.env.WP_PRIORITY_KEYS || 'ms,msom,pom').split(',').map(s => s.trim()));
const MAX_ABSTRACT = 4000;         // chars; keeps the files bounded
const MAX_SAMPLE_DOIS = 4;         // per author, for OpenAlex ID resolution
const MIN_YEAR = parseInt(process.env.WP_MIN_YEAR || '1990', 10); // preprint year floor
const MAX_THROTTLE = 8;            // consecutive OpenAlex waits before giving the run up

// The repositories we archive, each a "journal" (JKey) on the page. Hosts
// pickPreprint/preprintFromDoi classify but that we deliberately DON'T archive
// here (bioRxiv/medRxiv/cshl — life-sciences, off-topic for this catalog) map
// to no key and are skipped.
export const WP_SOURCES = {
  'wp-ssrn':  { name: 'SSRN Working Papers', publisher: 'SSRN' },
  'wp-nber':  { name: 'NBER Working Papers', publisher: 'NBER' },
  'wp-arxiv': { name: 'arXiv Pre-prints',    publisher: 'arXiv' },
  'wp-osf':   { name: 'OSF Pre-prints',      publisher: 'OSF' },
};
const HOST_TO_KEY = { ssrn: 'wp-ssrn', nber: 'wp-nber', arxiv: 'wp-arxiv', osf: 'wp-osf' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

export function stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
export function normName(s) { return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// Some publishers deposit titles/abstracts with HTML/XML markup, which OpenAlex
// passes through HTML-entity-encoded (and occasionally DOUBLE-encoded, e.g.
// "&amp;lt;p&amp;gt;" or "&amp;nbsp;"). Left as-is, a title stored as the literal
// text "&lt;p&gt;&lt;span&gt;Real Title&lt;/span&gt;&lt;/p&gt;" renders — the page
// HTML-escapes it — as visible "&lt;p&gt;…" gibberish. cleanText decodes the
// entities (repeatedly, so double-encodings fully resolve), strips the revealed
// tags, and collapses whitespace, leaving just the human title. Pure + idempotent
// (already-clean text passes through unchanged), so it is safe to (re)apply on
// every build and to the committed archive. Kept conservative on purpose: a tag
// must start with a letter (so "P &lt; 0.05" → "P < 0.05" survives, not a tag),
// and sub/sup strip with no space so a chemistry formula stays "Cs3Cu2I5".
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', times: '×', deg: '°',
};
function decodeEntitiesOnce(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const cp = (ent[1] === 'x' || ent[1] === 'X')
        ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        try { return String.fromCodePoint(cp); } catch { return m; }
      }
      return m;
    }
    const v = HTML_ENTITIES[ent.toLowerCase()];
    return v === undefined ? m : v; // leave unknown named entities intact
  });
}
export function cleanText(raw) {
  let s = String(raw == null ? '' : raw);
  if (!/[&<]/.test(s)) return s.replace(/\s+/g, ' ').trim(); // fast path: nothing to decode/strip
  for (let i = 0; i < 6; i++) { const d = decodeEntitiesOnce(s); if (d === s) break; s = d; }
  s = s
    .replace(/<\/?(?:sub|sup)(?:\s[^<>]*)?\/?>/gi, '')          // subscript/superscript: no space (Cs3Cu2I5, x2)
    .replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>/gi, ' ');   // other tags → space (line breaks, blocks, inline)
  for (let i = 0; i < 3; i++) { const d = decodeEntitiesOnce(s); if (d === s) break; s = d; } // decode anything a tag hid
  return s.replace(/\s+/g, ' ').trim();
}

// OpenAlex stores abstracts as an inverted index {word: [positions]}.
export function invertAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [w, positions] of Object.entries(inv)) {
    for (const p of positions) if (Number.isInteger(p)) words[p] = w;
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

// A last-name token + first initial, for disambiguating an author within one
// paper's authorship list. ("Barış Ata" -> {last:'ata', initial:'b'}).
export function nameParts(name) {
  const toks = normName(name).split(' ').filter(Boolean);
  if (!toks.length) return null;
  return { last: toks[toks.length - 1].replace(/[^a-z]/g, ''), initial: (toks[0][0] || '') };
}

// ── The published catalog: author index + published-title set ───────────────
// Reads each catalog dir's sources.json + papers-*.json once, pulling only the
// few fields we need, then discards the rows (memory stays bounded even across
// the ~200 MB FT50 catalog).
export async function loadCatalog(dirs, opts = {}) {
  const publishedTitles = new Set();
  const authors = new Map(); // normName -> {name, journals:Set, latestYear, priority, sampleDois:[]}
  const byTitle = new Map(); // opts.index: normTitle -> [{doi, last:Set<lastName>, year}] (published papers)
  const cutoff = THIS_YEAR - PRIORITY_YEARS;
  for (const dir of dirs) {
    const sources = await loadJson(join(dir, 'sources.json'), []);
    if (!Array.isArray(sources)) continue;
    for (const s of sources) {
      const rows = await loadJson(join(dir, s.file || `papers-${s.key}.json`), []);
      if (!Array.isArray(rows)) continue;
      const jkey = s.key;
      for (const p of rows) {
        const nt = normTitle(p.Title || '');
        if (nt) publishedTitles.add(nt);
        const year = parseInt(p.Year, 10) || 0;
        const isPriority = PRIORITY_KEYS.has(jkey) && year >= cutoff;
        const names = String(p.Authors || '').split(',').map(x => x.trim()).filter(Boolean);
        const dois = [];
        const doi = String(p.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
        if (doi) dois.push(doi);
        for (const name of names) {
          const nk = normName(name);
          if (!nk) continue;
          let a = authors.get(nk);
          if (!a) { a = { name, journals: new Set(), latestYear: 0, priority: false, sampleDois: [] }; authors.set(nk, a); }
          if (p.Journal) a.journals.add(p.Journal);
          if (year > a.latestYear) a.latestYear = year;
          if (isPriority) a.priority = true;
          if (doi && a.sampleDois.length < MAX_SAMPLE_DOIS && !a.sampleDois.includes(doi)) a.sampleDois.push(doi);
        }
        if (opts.index && nt && doi) {
          const lasts = new Set();
          for (const name of names) { const np = nameParts(name); if (np && np.last) lasts.add(np.last); }
          let arr = byTitle.get(nt);
          if (!arr) { arr = []; byTitle.set(nt, arr); }
          arr.push({ doi, last: lasts, year });
        }
      }
      if (opts.log) console.log(`  catalog: ${dir.split('/').pop()}/${s.key}: ${rows.length} papers`);
    }
  }
  return { publishedTitles, authors, byTitle };
}

// Does a working-paper record correspond to a PUBLISHED paper in the catalog?
// Returns the matched published paper's { doi, last, year } or null. Mirrors the
// pre-print matcher's discipline so a same-title different paper isn't linked:
// an EXACT normalized-title match + shared author surnames (two, or one when
// either side is single-author) + a plausible year (the published version is
// same-year-or-later than the working paper, within a sane window). `byTitle`
// comes from loadCatalog(dirs, {index:true}).
export function matchPublished(rec, byTitle) {
  if (!rec || !byTitle) return null;
  const nt = normTitle(rec.Title || '');
  const cands = nt && byTitle.get(nt);
  if (!cands || !cands.length) return null;
  const recLasts = [];
  for (const name of String(rec.Authors || '').split(',')) {
    const np = nameParts(name.trim());
    if (np && np.last) recLasts.push(np.last);
  }
  const recYear = parseInt(rec.Year, 10) || 0;
  for (const c of cands) {
    let shared = 0;
    for (const l of recLasts) if (c.last.has(l)) shared++;
    const need = (recLasts.length <= 1 || c.last.size <= 1) ? 1 : 2;
    if (shared < need) continue;
    if (recYear && c.year && (c.year < recYear - 1 || c.year - recYear > 15)) continue; // implausible gap
    return c;
  }
  return null;
}

// Crawl order: never-crawled priority authors first, then never-crawled
// others, then the stalest previously-done authors due a refresh — each tier
// newest-active first. Returns at most `limit` names to crawl this run.
export function orderAuthors(authors, cache, limit, pullDate = PULL_DATE, refreshDays = REFRESH_DAYS) {
  const today = new Date(pullDate + 'T00:00:00').getTime();
  const dueForRefresh = (c) => {
    if (!c || !c.done) return true;
    const t = new Date((c.ts || '1970-01-01') + 'T00:00:00').getTime();
    return isNaN(t) || (today - t) / 86400000 >= refreshDays;
  };
  const rows = [];
  for (const [nk, a] of authors) {
    const c = cache[nk];
    if (c && c.done && !dueForRefresh(c)) continue; // fresh — skip
    rows.push({ nk, a, neverCrawled: !c || !c.done });
  }
  rows.sort((x, y) =>
    (Number(y.a.priority) - Number(x.a.priority)) ||       // MS/MSOM/POM last 15y first
    (Number(y.neverCrawled) - Number(x.neverCrawled)) ||   // then never-crawled before refreshes
    (y.a.latestYear - x.a.latestYear) ||                   // then most-recently-active
    (x.nk < y.nk ? -1 : x.nk > y.nk ? 1 : 0));
  return rows.slice(0, limit);
}

// ── OpenAlex access (paced, backing off, mockable) ──────────────────────────
let throttleStreak = 0;
async function oaGet(url) {
  if (MOCK) return mockOaGet(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-workingpapers/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
    if (!res.ok) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      return { ok: false, status: res.status, retryAfter: isNaN(ra) ? 0 : ra };
    }
    return { ok: true, status: 200, json: await res.json() };
  } catch {
    return { ok: false, status: 0, retryAfter: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// One OpenAlex GET with the polite pacing + patient backoff the month-long
// backfill relies on. Returns the parsed body, or null when OpenAlex stays
// unavailable long enough that the run should stop and resume next schedule.
async function oaGetPatient(url, deadline) {
  for (;;) {
    if (Date.now() > deadline) return null;
    const r = await oaGet(url);
    if (r.ok) { throttleStreak = 0; await sleep(PACE_MS); return r.json; }
    // 429/403/5xx/timeout: wait (Retry-After, or escalating 30s·2^n up to
    // ~10 min) and retry, so a transient throttle never loses the run — but
    // give up after MAX_THROTTLE consecutive waits (OpenAlex is out for now).
    throttleStreak++;
    if (throttleStreak > MAX_THROTTLE) return null;
    const backoff = Math.min(r.retryAfter * 1000 || 0, 600000) || Math.min(30000 * 2 ** (throttleStreak - 1), 600000);
    console.log(`  openalex ${r.status || 'timeout'} — waiting ${Math.round(backoff / 1000)}s (streak ${throttleStreak}/${MAX_THROTTLE})`);
    await sleep(backoff);
  }
}

function oaId(url) {
  const m = String(url || '').match(/(A\d{5,})/);
  return m ? m[1] : '';
}

// Resolve an author's OpenAlex ID from a paper we KNOW they wrote: fetch that
// DOI's authorships and pick the one whose surname+initial match. High-
// precision (uses the trusted catalog to disambiguate a common name); returns
// '' when no sample DOI resolves cleanly.
async function resolveAuthorId(author, deadline) {
  const target = nameParts(author.name);
  if (!target || !target.last) return { oaid: '', attempted: true };
  for (const doi of author.sampleDois) {
    const body = await oaGetPatient(
      'https://api.openalex.org/works?filter=doi:' + encodeURIComponent(doi) +
      '&select=authorships&per-page=1&mailto=' + encodeURIComponent(MAILTO), deadline);
    if (body === null) return { oaid: '', attempted: false }; // OpenAlex out — don't burn the author
    const auths = (((body && body.results) || [])[0] || {}).authorships || [];
    const hits = [];
    for (const a of auths) {
      const cand = nameParts((a.author && a.author.display_name) || '');
      if (cand && cand.last === target.last && (!target.initial || !cand.initial || cand.initial === target.initial)) {
        const id = oaId(a.author && a.author.id);
        if (id) hits.push(id);
      }
    }
    if (hits.length === 1) return { oaid: hits[0], attempted: true }; // unambiguous
  }
  return { oaid: '', attempted: true };
}

// Enumerate an author's pre-print works (cursor-paginated). Returns null if
// OpenAlex went out mid-enumeration (so the caller leaves the author for next
// run instead of recording a partial crawl).
async function enumeratePreprints(oaid, deadline) {
  const out = [];
  let cursor = '*';
  const select = 'id,doi,title,display_name,publication_year,authorships,primary_location,best_oa_location,locations,abstract_inverted_index,cited_by_count';
  for (let page = 0; page < 40 && cursor; page++) { // 40×200 = 8k preprints/author ceiling
    const url = 'https://api.openalex.org/works?filter=' +
      encodeURIComponent(`author.id:${oaid},type:preprint,from_publication_date:${MIN_YEAR}-01-01`) +
      '&per-page=200&cursor=' + encodeURIComponent(cursor) +
      '&select=' + select + '&mailto=' + encodeURIComponent(MAILTO);
    const body = await oaGetPatient(url, deadline);
    if (body === null) return null;
    for (const w of body.results || []) out.push(w);
    cursor = body.meta && body.meta.next_cursor;
    if (!(body.results || []).length) break;
  }
  return out;
}

// True when OpenAlex places this "preprint" work in an actual journal too —
// i.e. it has been published, so it is NOT an unpublished working paper.
function looksPublished(work) {
  const locs = [work.primary_location, work.best_oa_location, ...(work.locations || [])];
  for (const l of locs) {
    const src = l && l.source;
    if (src && (src.type === 'journal' || src.type === 'conference') && src.display_name &&
        !/ssrn|arxiv|nber|working paper|preprint|research papers in economics|repec|osf/i.test(src.display_name)) {
      return true;
    }
  }
  return false;
}

// Turn one OpenAlex pre-print work into a page-ready record, or null if it is
// not a recognised/archivable working paper. Pure (no network) → unit-tested.
export function wpRecordFromWork(work, publishedTitles) {
  if (!work || !work.title) return null;
  // Strip any publisher HTML markup BEFORE the exclusion check: normTitle keeps
  // letters, so an un-stripped "<span>" would leak "span" into the normalized
  // title and stop a genuinely-published paper from matching the catalog.
  const title = cleanText(work.title);
  if (!title) return null;
  const nt = normTitle(title);
  if (nt && publishedTitles && publishedTitles.has(nt)) return null; // already in the published catalog
  if (looksPublished(work)) return null;                             // OpenAlex says it's published

  const urls = [];
  for (const l of [work.primary_location, work.best_oa_location, ...(work.locations || [])]) {
    if (l) urls.push(l.landing_page_url, l.pdf_url);
  }
  const pick = pickPreprint(urls) || preprintFromDoi(work.doi);
  if (!pick) return null;
  const key = HOST_TO_KEY[pick.s];
  if (!key) return null; // a host we classify but don't archive here (e.g. bioRxiv)

  const authorships = work.authorships || [];
  const authors = authorships.map(a => (a.author && a.author.display_name) || '').filter(Boolean);
  const affils = authorships
    .map(a => ((a.institutions || [])[0] || {}).display_name || '')
    .filter(Boolean);
  const year = parseInt(work.publication_year, 10);
  const rec = {
    Title: title,
    Authors: authors.join(', '),
    Affiliations: [...new Set(affils)].join('; '),
    DOI: work.doi || '',
    Volume: '', Issue: '', Page: '',
    Year: year ? String(year) : '',
    Status: 'Working paper',
    Abstract: cleanText(invertAbstract(work.abstract_inverted_index)).slice(0, MAX_ABSTRACT),
    Journal: WP_SOURCES[key].name,
    JKey: key,
    Preprint: canonPreprint(pick.u),
    PreprintSrc: pick.s,
  };
  if (Number.isInteger(work.cited_by_count) && work.cited_by_count > 0) rec.CitedBy = work.cited_by_count;
  return rec;
}

// Dedup key for a working paper (co-authored papers surface once per author).
export function recKey(r) {
  const doi = String(r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  return doi || ('u:' + (r.Preprint || '').toLowerCase());
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`lit working-papers build: ${PULL_DATE}${MOCK ? ' (MOCK)' : ''}; out=${DATA_DIR}`);
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + BUDGET_MS;

  // 1. Author index + published-title exclusion set + title->published-paper
  //    index (for the retire-on-publish sweep in step 3b) from the catalog.
  const { publishedTitles, authors, byTitle } = await loadCatalog(CATALOG_DIRS, { log: true, index: true });
  console.log(`catalog: ${authors.size} distinct authors, ${publishedTitles.size} published titles`);

  // 2. Existing archive (rows keyed by dedup key) + crawl cursor.
  const cache = await loadJson(join(DATA_DIR, '_authors.json'), {});
  const byKey = new Map();
  for (const key of Object.keys(WP_SOURCES)) {
    const rows = await loadJson(join(DATA_DIR, `papers-${key}.json`), []);
    for (const r of (Array.isArray(rows) ? rows : [])) byKey.set(recKey(r), r);
  }
  console.log(`archive: ${byKey.size} working papers so far; ${Object.keys(cache).length} authors crawled`);

  // 3. This run's slice of authors (priority + resumable order).
  const slice = orderAuthors(authors, cache, MAX_AUTHORS);
  console.log(`crawling up to ${slice.length} author(s) this run (of ${authors.size})`);
  let crawled = 0, foundThisRun = 0, stopped = false;

  for (const { nk, a } of slice) {
    if (Date.now() > deadline) { console.log('  time budget reached — stopping (resumes next run).'); stopped = true; break; }
    let entry = cache[nk] || { name: a.name };
    // Resolve (or reuse) the OpenAlex author ID.
    let oaid = entry.oaid || '';
    if (!oaid) {
      const res = await resolveAuthorId(a, deadline);
      if (!res.attempted) { stopped = true; break; } // OpenAlex out — leave author untouched
      oaid = res.oaid;
      entry.oaid = oaid; // '' recorded so we don't keep retrying an unresolvable name every run
    }
    if (oaid) {
      const works = await enumeratePreprints(oaid, deadline);
      if (works === null) { stopped = true; break; } // OpenAlex out mid-enumeration
      let found = 0;
      for (const w of works) {
        const rec = wpRecordFromWork(w, publishedTitles);
        if (!rec) continue;
        const k = recKey(rec);
        // "Date Added" = the day a row first entered the archive: stamped on a
        // genuinely-new key, PRESERVED across re-crawls (the fresh rec would
        // otherwise clobber it), feeding the page's "Recently added" view via
        // recent.json below. Back-catalog rows crawled before dating began
        // never get one retroactively.
        const prev = byKey.get(k);
        if (!prev) { foundThisRun++; rec['Date Added'] = PULL_DATE; }
        else if (prev['Date Added']) rec['Date Added'] = prev['Date Added'];
        byKey.set(k, rec); // refresh (citation counts, abstract) even if seen
        found++;
      }
      entry.found = found;
    }
    entry.done = true;
    entry.ts = PULL_DATE;
    cache[nk] = entry;
    crawled++;
    if (crawled % 20 === 0) { await writeCache(cache); console.log(`  …${crawled} authors, ${foundThisRun} new working papers`); }
  }

  // 3b. Retire working papers that have since been published: drop them from the
  //     archive and record their pre-print link against the PUBLISHED paper's DOI
  //     in the served `submitted-preprints.json` supplement, which the page
  //     overlays onto the published card as its "Pre-print (Open Access)" link.
  //     (Newly-crawled rows can't be published — wpRecordFromWork already drops
  //     those — so this only catches EXISTING rows whose paper appeared in print
  //     since it was archived.)
  const supplement = await loadJson(join(DATA_DIR, 'submitted-preprints.json'), {});
  let supplementChanged = false, retired = 0;
  for (const [k, r] of byKey) {
    const m = matchPublished(r, byTitle);
    if (!m) continue;
    if (r.Preprint && (!supplement[m.doi] || supplement[m.doi].u !== r.Preprint)) {
      supplement[m.doi] = { u: r.Preprint, s: r.PreprintSrc || '' };
      supplementChanged = true;
    }
    byKey.delete(k);
    retired++;
  }
  if (retired) console.log(`retired ${retired} now-published working paper(s) → linked as published-paper pre-prints`);

  // 4. Regroup by source and write everything.
  const bySource = {};
  for (const key of Object.keys(WP_SOURCES)) bySource[key] = [];
  for (const r of byKey.values()) if (bySource[r.JKey]) bySource[r.JKey].push(r);
  for (const key of Object.keys(bySource)) {
    bySource[key].sort((a, b) => (parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0) ||
      (a.Title < b.Title ? -1 : a.Title > b.Title ? 1 : 0));
  }

  const sources = [];
  let total = 0;
  for (const key of Object.keys(WP_SOURCES)) {
    const rows = bySource[key];
    await writeJson(`papers-${key}.json`, rows);
    total += rows.length;
    if (!rows.length) continue; // manifest lists only non-empty repositories
    const firstYear = rows.reduce((m, r) => Math.min(m, parseInt(r.Year, 10) || m), Infinity);
    sources.push({
      key, name: WP_SOURCES[key].name, publisher: WP_SOURCES[key].publisher,
      file: `papers-${key}.json`, count: rows.length,
      firstYear: isFinite(firstYear) ? firstYear : undefined,
      workingPaper: true,
    });
  }

  // recent.json: working papers ADDED to the archive recently — rows carrying
  // the "Date Added" stamp (set when a key first enters the archive, here or in
  // the submission ingest), newest-added first. The page merges this into its
  // "Recently added" view (which windows by date client-side), so only dated
  // rows belong; back-catalog rows crawled before dating began carry no date
  // and stay out. Keep in sync with regroupAndWrite in ingest-submissions.mjs.
  const recent = [...byKey.values()]
    .filter(r => r['Date Added'])
    .sort((a, b) => String(b['Date Added']).localeCompare(String(a['Date Added'])) ||
      (parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0))
    .slice(0, 1000);

  const doneCount = Object.values(cache).filter(c => c && c.done).length;
  const meta = {
    lastPull: PULL_DATE,
    paperCount: total,
    authorCount: doneCount,
    authorsInCatalog: authors.size,
    perSource: Object.fromEntries(sources.map(s => [s.key, s.count])),
    source: 'OpenAlex author works (type:preprint on SSRN/NBER/arXiv/OSF), excluding titles already in the published catalog',
    workingPapers: true,
  };

  await writeJson('sources.json', sources);
  await writeJson('recent.json', recent);
  await writeJson('meta.json', meta);
  if (supplementChanged) await writeJson('submitted-preprints.json', supplement);
  await writeCache(cache);

  console.log(`done: ${total} working papers across ${sources.length} repo(s) ` +
    `(${sources.map(s => `${s.key}:${s.count}`).join(' ') || 'none yet'}); ` +
    `${doneCount}/${authors.size} authors crawled${stopped ? ' (run stopped early — resumes next schedule)' : ''}.`);
}

async function writeJson(name, data) {
  // Atomic: temp file + rename, so a power-off / disconnect mid-write can never
  // leave a truncated file for a reader or `git add` to pick up.
  const dest = join(DATA_DIR, name);
  const tmp = `${dest}.tmp-${process.pid}`;
  const payload = JSON.stringify(data);
  await writeFile(tmp, payload, 'utf8');
  for (let i = 0; i < 10; i++) {
    try { await rename(tmp, dest); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200 * (i + 1))); // Dropbox/OneDrive/AV lock — retry
    }
  }
  await writeFile(dest, payload, 'utf8'); // last resort: in-place (non-atomic)
}
async function writeCache(cache) { await writeJson('_authors.json', cache); }

// ── Mock network (offline smoke test) ───────────────────────────────────────
// Routes OpenAlex URLs to ./mock/ fixtures:
//   works/doi:<doi>            -> mock/oa-work-<slug(doi)>.json   (authorships)
//   filter=author.id:<Aid>...  -> mock/oa-preprints-<Aid>.json    (results+meta)
async function mockOaGet(rawUrl) {
  const url = decodeURIComponent(rawUrl); // real URLs %-encode the filter colons/commas
  const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  let m = url.match(/filter=doi:([^&]+)/i);
  if (m) {
    const doi = m[1];
    const j = await loadJson(join(MOCK_DIR, `oa-work-${slug(doi)}.json`), null);
    return { ok: true, status: 200, json: j || { results: [] } };
  }
  m = url.match(/author\.id:(A\d+)/i);
  if (m) {
    const j = await loadJson(join(MOCK_DIR, `oa-preprints-${m[1]}.json`), null);
    return { ok: true, status: 200, json: j || { results: [], meta: { next_cursor: null } } };
  }
  return { ok: true, status: 200, json: { results: [], meta: { next_cursor: null } } };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
