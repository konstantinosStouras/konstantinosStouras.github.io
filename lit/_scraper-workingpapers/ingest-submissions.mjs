#!/usr/bin/env node
/* ── ingest-submissions.mjs — auto-add user-suggested working papers ──────────
 *
 * Reads the Firestore `paperSubmissions` collection (written by the "Suggest a
 * working paper" form on /lit/feedback/), and for every PENDING submission it
 *
 *   1. parses the submitted link into a DOI + host (SSRN / arXiv / NBER / OSF),
 *      reusing the pre-print feature's own host allowlist — a spoofed or
 *      unsupported link is rejected, never trusted;
 *   2. resolves the REAL bibliographic metadata itself (OpenAlex by DOI, with a
 *      Crossref fallback) — the submitter's typed title/authors are NEVER written
 *      into the dataset, so the form can't be used to inject arbitrary content;
 *   3. builds a working-paper record with the SAME wpRecordFromWork() the daily
 *      crawler uses (so the row is byte-identical to a crawled one), and applies
 *      the two gates the owner asked for:
 *        • the paper is NOT already in the catalog (published, or already in the
 *          working-papers archive), and
 *        • at least ONE of its authors is already in the catalog
 *          ("it fits the database authors");
 *   4. on success, UPSERTS the row into lit/data-workingpapers/ (preserving every
 *      existing row, exactly like the crawler's byKey seeding) and rewrites the
 *      small derived files — so the paper appears under the page's "Working
 *      Papers" journal type with no page change;
 *   5. stamps the submission (added / duplicate / rejected) and — when SMTP is
 *      configured — e-mails the maintainer a summary and the submitter their
 *      outcome.
 *
 * It shares lit/data-workingpapers/ (and the lit-workingpapers concurrency group)
 * with the crawler, so writes never race; both seed from the committed files and
 * only ever add, so neither clobbers the other. `_authors.json` (the crawler's
 * cursor) is left untouched.
 *
 * A no-op until FIREBASE_SERVICE_ACCOUNT is set (reads nothing, writes nothing).
 * SMTP is OPTIONAL — without it the ingest still runs and stamps submissions; it
 * just skips the notification e-mails.
 *
 * Usage:
 *   node ingest-submissions.mjs             real run (reads Firestore, ingests, mails)
 *   node ingest-submissions.mjs --dry-run   resolve + decide + print, write nothing
 *   node ingest-submissions.mjs --scan      list pending submissions and exit
 *   node ingest-submissions.mjs --limit=N   cap how many are processed (default 40)
 *   node ingest-selftest.mjs                offline unit tests (no network/Firebase)
 *
 * NOTE: this build env blocks OpenAlex/Crossref (403), so real resolution only
 * happens on the GitHub Actions runners. The selftest is fully offline.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { wpRecordFromWork, loadCatalog, WP_SOURCES, recKey, normName, nameParts, matchPublished } from './build-data.mjs';
import { pickPreprint, preprintFromDoi } from '../_scraper/build-data.mjs';
import { normTitle } from '../_scraper/ec-pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const SCAN     = args.includes('--scan');
const LIMIT = (function () {
  const a = args.find(s => s.startsWith('--limit='));
  const n = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 40;
})();

const MAILTO = process.env.SUB_MAILTO || 'kstouras+litsub@gmail.com'; // distinct OpenAlex quota identity
const MATCH_MODE = (process.env.SUB_AUTHOR_MATCH || 'fuzzy').toLowerCase() === 'exact' ? 'exact' : 'fuzzy';
const MAX_ABSTRACT = 4000;
const MAX_AGE_DAYS = parseInt(process.env.SUB_MAX_AGE_DAYS || '7', 10); // keep retrying a not-yet-indexed posting for this many days before giving up (a fresh SSRN posting can take a day+ to reach Crossref/OpenAlex)
const NOTIFY_TO = process.env.FEEDBACK_TO || 'kstouras@gmail.com';
const PULL_DATE = process.env.SUB_PULL_DATE || new Date().toISOString().slice(0, 10);

const DATA_DIR = process.env.SUB_DATA_DIR || process.env.WP_DATA_DIR
  || resolve(__dirname, '..', 'data-workingpapers');
const CATALOG_DIRS = (process.env.SUB_CATALOG_DIRS || process.env.WP_CATALOG_DIRS
  || [resolve(__dirname, '..', 'data'), resolve(__dirname, '..', 'data-ft50')].join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const HOST_KEYS = { ssrn: 1, arxiv: 1, nber: 1, osf: 1 }; // the sources we archive (bioRxiv/medRxiv/cshl excluded)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Pure helpers (all unit-tested offline) ───────────────────────────────────

// Strip HTML/JATS tags from a Crossref abstract (a tiny local copy of the
// reference build's stripJats — not exported there).
function stripTags(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function cleanDoi(d) { return String(d || '').replace(/[)\].,;>]+$/, '').trim().toLowerCase(); }

// A submitted link (or a raw DOI) -> { doi (bare, lowercase), src }.
// Host-validated against the same allowlist as the pre-print feature; anything
// that isn't a recognised, archivable SSRN/arXiv/NBER/OSF paper returns null.
export function urlToDoi(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // 1) an explicit DOI (bare, doi.org URL, or "doi:...") — route via the same map.
  let m = s.match(/(?:^|doi\.org\/|\bdoi:\s*)(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (m) {
    const doi = cleanDoi(m[1]);
    const p = preprintFromDoi(doi);
    return (p && HOST_KEYS[p.s]) ? { doi, src: p.s } : null;
  }

  // 2) a host URL we know how to turn into a DOI.
  let host = '', path = '', search = '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : ('https://' + s));
    host = u.hostname.toLowerCase(); path = u.pathname || ''; search = u.search || '';
  } catch { return null; }
  const isHost = (d) => host === d || host.endsWith('.' + d);

  if (isHost('ssrn.com')) {
    m = (search + ' ' + path).match(/abstract(?:_?id)?[=/](\d+)/i);
    return m ? { doi: '10.2139/ssrn.' + m[1], src: 'ssrn' } : null;
  }
  if (isHost('arxiv.org')) {
    m = path.match(/\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i);
    if (!m) return null;
    const id = m[1].replace(/v\d+$/i, '').toLowerCase();
    return { doi: '10.48550/arxiv.' + id, src: 'arxiv' };
  }
  if (isHost('nber.org')) {
    m = path.match(/\/(?:papers|system\/files\/working_papers)\/(w\d+)/i) || path.match(/\/(w\d+)/i);
    return m ? { doi: '10.3386/' + m[1].toLowerCase(), src: 'nber' } : null;
  }
  if (isHost('osf.io')) {
    m = path.match(/\/preprints\/[^/]+\/([a-z0-9]+)/i) || path.match(/^\/([a-z0-9]{4,})\/?$/i);
    return m ? { doi: '10.31219/osf.io/' + m[1].toLowerCase(), src: 'osf' } : null;
  }
  return null;
}

// Crossref work item -> an OpenAlex-shaped work object that wpRecordFromWork can
// consume. No locations are set, so wpRecordFromWork routes via preprintFromDoi
// on the (synthesized) DOI. The plain-text abstract is carried on `abstractText`
// and folded into the record afterwards (wpRecordFromWork reads OpenAlex's
// inverted index, which Crossref doesn't provide).
export function crossrefToWork(item, doi) {
  if (!item) return null;
  const title = (item.title && item.title[0]) ? item.title[0] : '';
  const authorships = (item.author || []).map(a => {
    const nm = ([a.given, a.family].filter(Boolean).join(' ') || a.name || '')
      .replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const aff = (a.affiliation || []).map(x => x && x.name).filter(Boolean)[0] || '';
    return { author: { display_name: nm }, institutions: aff ? [{ display_name: aff }] : [] };
  }).filter(a => a.author.display_name);
  const pick = (d) => d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0];
  const year = pick(item.issued) || pick(item['published-print']) ||
    pick(item['published-online']) || pick(item.created) || undefined;
  const cby = item['is-referenced-by-count'];
  return {
    id: '', doi: doi ? ('https://doi.org/' + doi) : (item.DOI ? 'https://doi.org/' + item.DOI : ''),
    title, publication_year: year ? parseInt(year, 10) : undefined,
    authorships,
    primary_location: null, best_oa_location: null, locations: [],
    abstract_inverted_index: null,
    abstractText: item.abstract || '',
    cited_by_count: (typeof cby === 'number' ? cby : undefined),
  };
}

// Build a fast author-membership index from loadCatalog()'s authors Map.
export function catalogAuthorIndex(authors) {
  const exact = new Set();      // normName of every catalog author
  const byLast = new Map();     // last-name -> [{ initial, name }]
  for (const [nk, a] of authors) {
    if (nk) exact.add(nk);
    const p = nameParts(a.name);
    if (p && p.last) {
      let arr = byLast.get(p.last);
      if (!arr) { arr = []; byLast.set(p.last, arr); }
      arr.push({ initial: p.initial, name: a.name });
    }
  }
  return { exact, byLast };
}

// Does any of a paper's authors match a catalog author? `exact` = same full
// (accent-folded) name; `fuzzy` also accepts last-name + compatible first
// initial (the same predicate the crawler uses to resolve an OpenAlex author).
export function catalogMatch(authorNames, index, mode) {
  const matched = [];
  let matchType = '';
  for (const name of authorNames) {
    const nk = normName(name);
    if (nk && index.exact.has(nk)) { matched.push(name); matchType = 'exact'; continue; }
    if (mode !== 'exact') {
      const p = nameParts(name);
      const cands = p && p.last ? index.byLast.get(p.last) : null;
      if (cands) {
        const hit = cands.find(c => !p.initial || !c.initial || c.initial === p.initial);
        if (hit) { matched.push(name + ' → ' + hit.name); if (matchType !== 'exact') matchType = 'fuzzy'; }
      }
    }
  }
  return { matched, matchType };
}

// The whole decision, given an already-resolved OpenAlex-shaped `work`. Pure.
// ctx: { publishedTitles:Set, catalogIndex, byKey:Map, matchMode }
// Returns { status: 'added'|'duplicate'|'rejected', rec?, key?, match?, reason?, detail? }.
export function decideSubmission(work, ctx) {
  const rec = wpRecordFromWork(work, ctx.publishedTitles);
  if (!rec) {
    // Diagnose why wpRecordFromWork declined, for a helpful message.
    const title = (work && work.title) || '';
    const nt = normTitle(title);
    if (nt && ctx.publishedTitles.has(nt)) {
      // It matches a published paper's title — rather than rejecting it, attach
      // it as that paper's open-access pre-print (rebuild the record ignoring the
      // published-title exclusion so we have its Preprint + Authors, then match
      // the specific published paper by title + shared authors).
      const full = wpRecordFromWork(work, new Set());
      const m = full && ctx.byTitle ? matchPublished(full, ctx.byTitle) : null;
      if (m && full.Preprint) {
        return { status: 'linked', publishedDoi: m.doi, preprint: full.Preprint, preprintSrc: full.PreprintSrc || '', rec: full };
      }
      return { status: 'rejected', reason: 'already-published',
        detail: 'This paper is already in the catalog as a published paper.' };
    }
    const urls = [];
    for (const l of [work && work.primary_location, work && work.best_oa_location, ...((work && work.locations) || [])]) {
      if (l) urls.push(l.landing_page_url, l.pdf_url);
    }
    const p = pickPreprint(urls) || preprintFromDoi((work && work.doi) || '');
    if (!p || !HOST_KEYS[p.s]) {
      return { status: 'rejected', reason: 'unsupported',
        detail: 'The link is not a recognised SSRN, arXiv, NBER or OSF working paper.' };
    }
    return { status: 'rejected', reason: 'looks-published',
      detail: 'This appears to be already published in a journal or conference, so it is not an unpublished working paper.' };
  }

  // Fold a Crossref plain-text abstract in (wpRecordFromWork can only read the
  // OpenAlex inverted index, which the Crossref fallback doesn't supply).
  if (!rec.Abstract && work && work.abstractText) rec.Abstract = stripTags(work.abstractText).slice(0, MAX_ABSTRACT);

  // Gate 1 — not already in the working-papers archive.
  const key = recKey(rec);
  if (ctx.byKey.has(key)) return { status: 'duplicate', rec, key, reason: 'already-in-archive' };

  // Gate 2 — at least one author already in the catalog.
  const authors = String(rec.Authors || '').split(',').map(s => s.trim()).filter(Boolean);
  const match = catalogMatch(authors, ctx.catalogIndex, ctx.matchMode);
  if (!match.matched.length) {
    return { status: 'rejected', reason: 'no-catalog-author',
      detail: 'None of the authors are currently in The Lit, so this paper is outside the database’s scope (it only tracks the unpublished work of authors already in it).' };
  }
  return { status: 'added', rec, key, match };
}

// Regroup byKey -> per-source files and rewrite the derived files. Preserves the
// crawler's author counts (authorCount) from the previous meta; refreshes the
// live catalog-author total. Mirrors the crawler's write section exactly.
export async function regroupAndWrite(byKey, prevMeta, authorsInCatalog, dir) {
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
    await writeJson(dir, `papers-${key}.json`, rows);
    total += rows.length;
    if (!rows.length) continue;
    const firstYear = rows.reduce((m, r) => Math.min(m, parseInt(r.Year, 10) || m), Infinity);
    sources.push({
      key, name: WP_SOURCES[key].name, publisher: WP_SOURCES[key].publisher,
      file: `papers-${key}.json`, count: rows.length,
      firstYear: isFinite(firstYear) ? firstYear : undefined,
      workingPaper: true,
    });
  }

  const recent = [...byKey.values()]
    .sort((a, b) => (parseInt(b.Year, 10) || 0) - (parseInt(a.Year, 10) || 0))
    .slice(0, 1000);

  const meta = {
    lastPull: PULL_DATE,
    paperCount: total,
    authorCount: (prevMeta && Number.isFinite(prevMeta.authorCount)) ? prevMeta.authorCount : 0,
    authorsInCatalog: authorsInCatalog,
    perSource: Object.fromEntries(sources.map(s => [s.key, s.count])),
    source: (prevMeta && prevMeta.source) ||
      'OpenAlex author works (type:preprint on SSRN/NBER/arXiv/OSF), excluding titles already in the published catalog',
    workingPapers: true,
  };

  await writeJson(dir, 'sources.json', sources);
  await writeJson(dir, 'recent.json', recent);
  await writeJson(dir, 'meta.json', meta);
  return { total, perSource: meta.perSource };
}

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// Atomic writer (temp file + rename), identical to the crawler's.
async function writeJson(dir, name, data) {
  const dest = join(dir, name);
  const tmp = `${dest}.tmp-${process.pid}`;
  const payload = JSON.stringify(data);
  await writeFile(tmp, payload, 'utf8');
  for (let i = 0; i < 10; i++) {
    try { await rename(tmp, dest); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200 * (i + 1)));
    }
  }
  await writeFile(dest, payload, 'utf8');
}

// ── Network (real runs only) ─────────────────────────────────────────────────
async function apiGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `lit-submissions/1.0 (mailto:${MAILTO})` }, signal: ctrl.signal });
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

async function openAlexWorkByDoi(doi) {
  const url = 'https://api.openalex.org/works?filter=doi:' + encodeURIComponent(doi) +
    '&per-page=1&select=' + encodeURIComponent(
      'id,doi,title,publication_year,authorships,primary_location,best_oa_location,locations,abstract_inverted_index,cited_by_count') +
    '&mailto=' + encodeURIComponent(MAILTO);
  const r = await apiGet(url);
  if (!r.ok) return { reached: false };
  return { reached: true, work: ((r.json && r.json.results) || [])[0] || null };
}

async function crossrefWorkByDoi(doi) {
  const url = 'https://api.crossref.org/works?filter=' + encodeURIComponent('doi:' + doi) +
    '&select=' + encodeURIComponent(
      'DOI,title,author,issued,published-print,published-online,created,abstract,is-referenced-by-count,type') +
    '&rows=1&mailto=' + encodeURIComponent(MAILTO);
  const r = await apiGet(url);
  if (!r.ok) return { reached: false };
  const item = ((r.json && r.json.message && r.json.message.items) || [])[0] || null;
  return { reached: true, work: item ? crossrefToWork(item, doi) : null };
}

// Resolve a work for a submitted (doi, src). OpenAlex first (rich: abstract,
// affiliations, citations), Crossref fallback (SSRN/NBER/OSF are Crossref-minted).
// Returns { work } | { retry:true } (a leg was unreachable) | { notfound:true }.
async function resolveWork(doi) {
  const oa = await openAlexWorkByDoi(doi);
  if (oa.reached && oa.work) return { work: oa.work };
  await sleep(300);
  const cr = await crossrefWorkByDoi(doi);
  if (cr.reached && cr.work) return { work: cr.work };
  if (!oa.reached || !cr.reached) return { retry: true }; // OpenAlex/Crossref were down — try again next run
  return { notfound: true };                              // reached both, indexed nowhere yet
}

// ── E-mail rendering (optional) ──────────────────────────────────────────────
function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const OUTCOME_ADDED = { added: 1, duplicate: 1, linked: 1 };

function submitterMessage(o) {
  if (o.status === 'added') return 'Good news — the working paper you suggested has been added to The Lit. It now appears under the “Working Papers” journal type.';
  if (o.status === 'duplicate') return 'Thanks — the working paper you suggested is already in The Lit (under the “Working Papers” journal type), so there was nothing to add.';
  if (o.status === 'linked') return 'Good news — the paper you suggested is already published in The Lit, and I’ve attached your link as its open-access pre-print, so its card now shows a “Pre-print (Open Access)” link.';
  return 'Thanks for the suggestion. I could not add it automatically: ' + (o.detail || 'it did not meet the criteria.') +
    ' I do get a note about every suggestion, so I may still add it by hand.';
}

function renderSubmitterEmail(sub, o) {
  const email = String(sub.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const ticket = sub.ticket || '';
  const title = (o.rec && o.rec.Title) || sub.title || '';
  const subject = 'The Lit — your paper suggestion' + (ticket ? ' (' + ticket + ')' : '');
  const msg = submitterMessage(o);
  const lines = [
    'Dear ' + (String(sub.name || '').trim() || 'reader') + ',', '',
    msg, '',
    title ? ('Paper: ' + title) : '',
    sub.url ? ('Link: ' + sub.url) : '',
    ticket ? ('Reference: ' + ticket) : '', '',
    'Thank you for helping grow The Lit.', '', 'Konstantinos', 'https://stouras.com/lit/',
  ].filter(x => x !== '');
  const text = lines.join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#241a1e;line-height:1.6">' +
    lines.map(l => '<p style="margin:0 0 10px">' + htmlEsc(l) + '</p>').join('') + '</div>';
  return { to: email, subject, text, html };
}

function renderMaintainerSummary(results) {
  const n = { added: 0, duplicate: 0, rejected: 0, retry: 0, notfound: 0, linked: 0 };
  results.forEach(r => { n[r.outcome.status] = (n[r.outcome.status] || 0) + 1; });
  const subject = `The Lit — paper submissions: ${n.added} added` +
    (n.linked ? `, ${n.linked} linked` : '') +
    (n.rejected ? `, ${n.rejected} rejected` : '') + (n.duplicate ? `, ${n.duplicate} dup` : '');
  const row = (r) => {
    const o = r.outcome, s = r.sub;
    const bits = [
      o.status.toUpperCase(),
      (o.rec && o.rec.Title) || s.title || '(title unresolved)',
      o.publishedDoi ? ('→ published ' + o.publishedDoi) : (o.doi ? ('doi:' + o.doi) : (s.url || '')),
      o.match && o.match.matched.length ? ('authors: ' + o.match.matched.join('; ') + (o.match.matchType === 'fuzzy' ? ' [fuzzy]' : '')) : '',
      o.reason ? ('reason: ' + o.reason) : '',
      s.email ? ('by ' + s.email) : '',
      s.ticket ? ('#' + s.ticket) : '',
    ].filter(Boolean);
    return bits.join('  ·  ');
  };
  const text = `Paper-submission ingest summary\n\nadded ${n.added}, linked ${n.linked}, duplicate ${n.duplicate}, ` +
    `rejected ${n.rejected}, pending-retry ${n.retry + n.notfound}\n\n` +
    results.map(row).join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#241a1e">' +
    '<p><b>Paper-submission ingest</b>: ' + `added ${n.added}, linked ${n.linked}, duplicate ${n.duplicate}, rejected ${n.rejected}, ` +
    `pending ${n.retry + n.notfound}</p>` +
    '<ul>' + results.map(r => '<li>' + htmlEsc(row(r)) + '</li>').join('') + '</ul></div>';
  return { subject, text, html };
}

// ── Main run ─────────────────────────────────────────────────────────────────
async function run() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Paper-submission ingest: no Firebase credentials configured — nothing to do. Add the FIREBASE_SERVICE_ACCOUNT secret to enable.');
    return;
  }

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  let snap;
  try {
    snap = await db.collection('paperSubmissions').where('status', '==', 'pending').limit(LIMIT).get();
  } catch (e) {
    console.error('Paper-submission ingest: could not read paperSubmissions:', e && e.message);
    process.exitCode = 1; return;
  }
  const docs = snap.docs.slice().sort((a, b) => {
    const ta = a.get('createdAt'), tb = b.get('createdAt');
    const na = ta && ta.toMillis ? ta.toMillis() : 0, nb = tb && tb.toMillis ? tb.toMillis() : 0;
    return na - nb;
  });
  console.log(`Found ${docs.length} pending submission(s).`);

  if (SCAN) {
    docs.forEach(d => { const x = d.data(); console.log(`  ${d.id}: ${x.url || '(no url)'}  ${x.email || ''}  #${x.ticket || ''}`); });
    return;
  }
  if (!docs.length) return;

  // Load the catalog (author index + published titles + title->published index)
  // and seed the archive + the published-paper pre-print supplement.
  console.log('Loading the published catalog + working-papers archive…');
  const catalog = await loadCatalog(CATALOG_DIRS, { log: false, index: true });
  const catalogIndex = catalogAuthorIndex(catalog.authors);
  const byKey = new Map();
  for (const key of Object.keys(WP_SOURCES)) {
    const rows = await loadJson(join(DATA_DIR, `papers-${key}.json`), []);
    for (const r of (Array.isArray(rows) ? rows : [])) byKey.set(recKey(r), r);
  }
  const prevMeta = await loadJson(join(DATA_DIR, 'meta.json'), {});
  const supplement = await loadJson(join(DATA_DIR, 'submitted-preprints.json'), {});
  let supplementChanged = false;
  console.log(`Catalog: ${catalog.authors.size} authors; archive: ${byKey.size} working papers.`);

  const ctx = { publishedTitles: catalog.publishedTitles, catalogIndex, byKey, byTitle: catalog.byTitle, matchMode: MATCH_MODE };

  // 1. Resolve + decide every pending submission (network).
  const results = []; // { d, sub, outcome }
  let added = 0, linked = 0;
  for (const d of docs) {
    const sub = d.data();
    const parsed = urlToDoi(sub.url);
    let outcome;
    if (!parsed) {
      outcome = { status: 'rejected', reason: 'bad-url',
        detail: 'The link is not a recognised SSRN, arXiv, NBER or OSF paper (or DOI) link.' };
    } else {
      const res = await resolveWork(parsed.doi);
      if (res.retry) outcome = { status: 'retry', doi: parsed.doi };
      else if (res.notfound) outcome = { status: 'notfound', doi: parsed.doi };
      else { outcome = decideSubmission(res.work, ctx); outcome.doi = parsed.doi; }
    }
    if (outcome.status === 'added' && !DRY_RUN) { byKey.set(outcome.key, outcome.rec); added++; }
    if (outcome.status === 'linked' && !DRY_RUN) {
      supplement[outcome.publishedDoi] = { u: outcome.preprint, s: outcome.preprintSrc || '' };
      supplementChanged = true; linked++;
    }
    results.push({ d, sub, outcome });
    console.log(`  ${outcome.status.padEnd(10)} ${parsed ? 'doi:' + parsed.doi : (sub.url || '')}` +
      (outcome.publishedDoi ? ` → published ${outcome.publishedDoi}` : '') +
      (outcome.reason ? ` (${outcome.reason})` : '') +
      (outcome.match && outcome.match.matchType === 'fuzzy' ? ' [fuzzy author match]' : ''));
  }

  if (DRY_RUN) { console.log(`\n[dry-run] ${added} would be added, ${linked} linked to published papers; wrote nothing.`); return; }

  // 2. Write the dataset FIRST (so a crash before stamping just re-processes,
  //    finding the paper already in the archive next time — never lost).
  if (added) {
    const w = await regroupAndWrite(byKey, prevMeta, catalog.authors.size, DATA_DIR);
    console.log(`Wrote archive: ${w.total} working papers (${JSON.stringify(w.perSource)}).`);
  } else {
    console.log('No new papers added — dataset unchanged.');
  }
  if (supplementChanged) {
    await writeJson(DATA_DIR, 'submitted-preprints.json', supplement);
    console.log(`Wrote submitted-preprints.json (+${linked} published-paper pre-print link(s)).`);
  }

  // 3. Stamp each submission + notify.
  const transport = await maybeTransport();
  for (const r of results) {
    const { d, sub, outcome } = r;
    try {
      if (outcome.status === 'retry') {
        continue; // leave pending; a transient OpenAlex/Crossref outage
      }
      if (outcome.status === 'notfound') {
        const created = sub.createdAt && sub.createdAt.toMillis ? sub.createdAt.toMillis() : 0;
        const ageDays = created ? (Date.now() - created) / 86400000 : 0;
        const tries = (Number.isFinite(sub.tries) ? sub.tries : 0) + 1;
        if (created && ageDays > MAX_AGE_DAYS) {
          outcome.status = 'rejected'; outcome.reason = 'not-indexed';
          outcome.detail = `I could not find this paper in OpenAlex or Crossref after ${Math.round(ageDays)} days — it may be too new to be indexed yet, or the link may be wrong.`;
        } else {
          await d.ref.update({ tries, lastTriedAt: FieldValue.serverTimestamp() });
          console.log(`  … ${d.id} not indexed yet (try ${tries}, age ${ageDays.toFixed(1)}d) — left pending.`);
          continue;
        }
      }
      const patch = {
        status: outcome.status, // added | duplicate | rejected | linked
        processedAt: FieldValue.serverTimestamp(),
        resolvedDoi: outcome.doi || null,
        resolvedTitle: (outcome.rec && outcome.rec.Title) || null,
        jkey: (outcome.rec && outcome.rec.JKey) || null,
        publishedDoi: outcome.publishedDoi || null, // set when linked to a published paper
        preprint: outcome.preprint || null,
        reason: outcome.reason || null,
        detail: outcome.detail || null,
        matchedAuthors: (outcome.match && outcome.match.matched) || [],
        matchType: (outcome.match && outcome.match.matchType) || null,
      };
      await d.ref.update(patch);

      // Best-effort submitter e-mail (never blocks / un-stamps).
      if (transport && !sub.notified) {
        const mail = renderSubmitterEmail(sub, outcome);
        if (mail) {
          try {
            await transport.sendMail({ from: FROM(), to: mail.to, replyTo: NOTIFY_TO,
              subject: mail.subject, text: mail.text, html: mail.html, headers: { 'X-Lit-Submission': d.id } });
            await d.ref.update({ notified: true, notifiedAt: FieldValue.serverTimestamp() });
          } catch (e) { console.error(`  ⚠ submitter e-mail to ${mail.to} failed: ${e && e.message}`); }
        }
      }
    } catch (e) {
      console.error(`  ✗ ${d.id}: ${e && e.message}`);
    }
  }

  // 4. Maintainer summary (only if there was anything to report).
  const reportable = results.filter(r => ['added', 'duplicate', 'rejected', 'linked'].includes(r.outcome.status));
  if (transport && reportable.length) {
    const sum = renderMaintainerSummary(reportable);
    try {
      await transport.sendMail({ from: FROM(), to: NOTIFY_TO, subject: sum.subject, text: sum.text, html: sum.html });
      console.log('Maintainer summary e-mailed.');
    } catch (e) { console.error('  ⚠ maintainer summary failed:', e && e.message); }
  }
  console.log(`Done. Added ${added}.`);
}

let _fromName = '';
function FROM() {
  const addr = process.env.ALERTS_FROM || process.env.SMTP_USER || '';
  return _fromName ? `"${_fromName}" <${addr}>` : addr;
}
async function maybeTransport() {
  if (!process.env.SMTP_USER) { console.log('SMTP not configured — skipping notification e-mails.'); return null; }
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  _fromName = process.env.ALERTS_FROM_NAME || 'The Lit';
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────
// Run ONLY when executed directly, so importing this file (e.g. from
// ingest-selftest.mjs) never triggers a live Firestore run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error('Paper-submission ingest error:', e && (e.stack || e.message || e)); process.exit(1); });
}
