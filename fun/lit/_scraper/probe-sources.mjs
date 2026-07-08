/*
 * probe-sources.mjs — TEMPORARY reconnaissance for the fun/lit data pipeline.
 * Runs on a GitHub Actions runner (open internet), fetches a sample from every
 * external source the real build will use, and writes fixtures + a summary
 * report into fun/lit/_scraper/_probe/ so the parsers can be written against
 * real payloads. Deleted once build-data.mjs is finalized.
 *
 * Node 20+, no npm dependencies.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '_probe');
const MAILTO = 'kstouras@gmail.com';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
const API_HEADERS = { 'User-Agent': `lit-probe/0.1 (mailto:${MAILTO})` };

const report = { ranAt: new Date().toISOString(), sections: {} };

async function get(url, { headers = API_HEADERS, maxBytes = 500_000 } = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, finalUrl: res.url, size: buf.length,
             body: buf.subarray(0, maxBytes).toString('utf8') };
  } catch (e) {
    return { status: 'ERR', error: String(e), size: 0, body: '' };
  }
}

async function save(name, text) {
  await writeFile(join(OUT, name), text ?? '', 'utf8');
}

function jsonTry(s) { try { return JSON.parse(s); } catch { return null; } }

// ── 1. Crossref: the six journals + PNAS ────────────────────────────────────
const JOURNALS = [
  ['ms',   '0025-1909', 'Management Science'],
  ['mksc', '0732-2399', 'Marketing Science'],
  ['msom', '1523-4614', 'MSOM'],
  ['pom',  '1059-1478', 'POM'],
  ['isre', '1047-7047', 'Information Systems Research'],
  ['opre', '0030-364X', 'Operations Research'],
  ['pnas', '0027-8424', 'PNAS'],
];
const SELECT = 'DOI,title,author,issued,published-print,published-online,created,volume,issue,page,abstract,type,container-title,assertion';

async function probeJournals() {
  const out = {};
  for (const [key, issn, name] of JOURNALS) {
    const base = `https://api.crossref.org/journals/${issn}/works`;
    const count = await get(`${base}?rows=0&mailto=${MAILTO}`);
    const withAbs = await get(`${base}?filter=has-abstract:true&rows=0&mailto=${MAILTO}`);
    const sample = await get(`${base}?rows=3&select=${encodeURIComponent(SELECT)}&sort=published&order=desc&mailto=${MAILTO}`);
    const c = jsonTry(count.body), a = jsonTry(withAbs.body);
    out[key] = {
      name, issn,
      status: count.status,
      total: c?.message?.['total-results'] ?? null,
      withAbstract: a?.message?.['total-results'] ?? null,
    };
    await save(`crossref-${key}-sample.json`, sample.body);
    console.log(`crossref ${key}: total=${out[key].total} withAbstract=${out[key].withAbstract}`);
  }
  report.sections.journals = out;
}

// ── 2. Crossref: ACM EC proceedings since 2020 ──────────────────────────────
async function probeEcCrossref() {
  const q = 'query.container-title=' + encodeURIComponent('ACM Conference on Economics and Computation');
  const filt = 'filter=type:proceedings-article,from-pub-date:2020-01-01';
  const url = `https://api.crossref.org/works?${q}&${filt}&rows=8&select=${encodeURIComponent(SELECT + ',event,publisher')}&mailto=${MAILTO}`;
  const r = await get(url);
  await save('crossref-ec-sample.json', r.body);
  const j = jsonTry(r.body);
  const total = j?.message?.['total-results'] ?? null;
  // distinct container titles seen in the sample
  const containers = [...new Set((j?.message?.items || []).map(i => (i['container-title'] || [])[0]))];
  report.sections.ecCrossref = { status: r.status, total, containers };
  console.log(`crossref EC: total=${total}`);
  return (j?.message?.items || []).map(i => ({ doi: i.DOI, title: (i.title || [])[0] })).filter(x => x.doi);
}

// ── 3. PNAS doSearch pages per ConceptID ────────────────────────────────────
const CONCEPTS = [
  ['cs',    '500077', 'Computer Sciences'],
  ['sust',  '500082', 'Sustainability Science'],
  ['env',   '500089', 'Environmental Sciences'],
  ['soc',   '500085', 'Social Sciences'],
  ['econ',  '500068', 'Economic Sciences'],
];
async function probePnas() {
  const out = {};
  for (const [key, id, name] of CONCEPTS) {
    const url = `https://www.pnas.org/action/doSearch?SeriesKey=pnas&ConceptID=${id}&startPage=0&pageSize=100`;
    const r = await get(url, { headers: BROWSER_HEADERS, maxBytes: key === 'cs' ? 3_000_000 : 200_000 });
    // Try to find a result count in the HTML.
    const m = r.body.match(/([\d,]+)\s*(?:results?|RESULTS?)/) || r.body.match(/result__count[^>]*>([\d,]+)/);
    out[key] = { name, id, status: r.status, size: r.size, resultCount: m ? m[1] : null,
                 doiLinks: (r.body.match(/doi\/(?:abs\/|full\/|epdf\/)?10\.1073\/[a-zA-Z0-9./]+/g) || []).length };
    await save(`pnas-${key}.html`, key === 'cs' ? r.body : r.body.slice(0, 120_000));
    console.log(`pnas ${key}: status=${out[key].status} size=${r.size} count=${out[key].resultCount} doiLinks=${out[key].doiLinks}`);
    await new Promise(res => setTimeout(res, 1500));
  }
  // pagination check: page 2 of computer sciences
  const p2 = await get(`https://www.pnas.org/action/doSearch?SeriesKey=pnas&ConceptID=500077&startPage=1&pageSize=100`, { headers: BROWSER_HEADERS, maxBytes: 300_000 });
  out.page2 = { status: p2.status, size: p2.size,
                doiLinks: (p2.body.match(/doi\/(?:abs\/|full\/|epdf\/)?10\.1073\/[a-zA-Z0-9./]+/g) || []).length };
  await save('pnas-cs-page2.html', p2.body.slice(0, 120_000));
  report.sections.pnas = out;
}

// ── 4. sigecom accepted-papers pages, EC 2020–2026 ──────────────────────────
async function probeSigecom() {
  const out = {};
  for (const yy of ['20', '21', '22', '23', '24', '25', '26']) {
    const url = `https://ec${yy}.sigecom.org/program/accepted-papers/`;
    const r = await get(url, { headers: BROWSER_HEADERS, maxBytes: 2_000_000 });
    out[yy] = { status: r.status, finalUrl: r.finalUrl, size: r.size };
    await save(`sigecom-ec${yy}.html`, r.body);
    console.log(`sigecom ec${yy}: status=${r.status} size=${r.size}`);
  }
  report.sections.sigecom = out;
}

// ── 5. DBLP toc queries for EC proceedings ──────────────────────────────────
async function probeDblp() {
  const out = {};
  for (const y of ['2020', '2025', '2026']) {
    const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(`toc:db/conf/sigecom/sigecom${y}.bht:`)}&h=3&format=json`;
    const r = await get(url);
    const j = jsonTry(r.body);
    out[y] = { status: r.status, total: j?.result?.hits?.['@total'] ?? null };
    await save(`dblp-ec${y}.json`, r.body);
    console.log(`dblp ec${y}: status=${r.status} total=${out[y].total}`);
    await new Promise(res => setTimeout(res, 1200));
  }
  report.sections.dblp = out;
}

// ── 6. OpenAlex + Semantic Scholar for PDF mapping (using real EC DOIs) ─────
async function probePdfMapping(ecSamples) {
  const dois = ecSamples.slice(0, 4).map(x => x.doi);
  if (dois.length) {
    const url = `https://api.openalex.org/works?filter=doi:${dois.join('|')}&select=doi,title,open_access,ids,locations&mailto=${MAILTO}`;
    const r = await get(url);
    await save('openalex-ec-sample.json', r.body);
    const j = jsonTry(r.body);
    report.sections.openalex = {
      status: r.status,
      results: (j?.results || []).map(w => ({ doi: w.doi, oa: w.open_access?.oa_url || null, arxiv: w.ids?.arxiv || null })),
    };
    console.log('openalex:', JSON.stringify(report.sections.openalex));
  }
  const title = ecSamples[0]?.title;
  if (title) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=title,externalIds,openAccessPdf,abstract`;
    const r = await get(url);
    await save('s2-match-sample.json', r.body);
    report.sections.s2 = { status: r.status, ok: r.status === 200 };
    console.log('s2 match:', r.status);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });
await probeJournals();
const ecSamples = await probeEcCrossref();
await probePnas();
await probeSigecom();
await probeDblp();
await probePdfMapping(ecSamples);
await save('report.json', JSON.stringify(report, null, 2));
console.log('\n=== REPORT ===\n' + JSON.stringify(report, null, 2));
