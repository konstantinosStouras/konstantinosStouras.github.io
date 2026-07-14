// sqlite-parity.mjs — regression test proving the range-served SQLite query
// path (lit-query.js against a lit.db built by emit-db.mjs) reproduces the
// /lit page's EXACT filter semantics. Self-contained: builds a DB into the
// OS temp dir, then compares, for a suite of representative queries, the app's
// real matchers (oracle, over the raw papers-*.json) against the SQL path —
// scopeCount (Y), filtered ROW count (X), result row-identity multiset, and
// crossFilter journal/year histograms. Zero mismatches = pass (exit 0).
//
//   node lit/_scraper/sqlite-parity.mjs
//
// The matchers are shared verbatim via lit-query.js, so this checks the SQL
// PREFILTER is a correct superset and every non-text predicate + count is exact.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { createRequire } from 'node:module';
import { emitDb, membershipFromIndexHtml } from './emit-db.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LIT = path.resolve(HERE, '..');            // lit
const require = createRequire(import.meta.url);
const LitQuery = require(path.join(LIT, 'sqlite', 'lit-query.js'));
const { textMatch, authorMatch } = LitQuery.matchers;

const DB = path.join(os.tmpdir(), 'lit-parity.db');
const M = membershipFromIndexHtml(path.join(LIT, 'index.html'));
const sources = JSON.parse(fs.readFileSync(path.join(LIT, 'data', 'sources.json'), 'utf8'));
process.stderr.write('building test DB…\n');
emitDb(path.join(LIT, 'data'), sources, DB, M);

const PNAS_SECTION_KEYS = { 'Computer Sciences': 'pnas-cs', 'Sustainability Science': 'pnas-sust', 'Environmental Sciences': 'pnas-env', 'Social Sciences': 'pnas-soc', 'Economic Sciences': 'pnas-econ' };
const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));

// ── oracle corpus (raw JSON) ─────────────────────────────────────────────────
const papers = [];
for (const s of sources) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(LIT, 'data', s.file), 'utf8')); } catch { continue; }
  for (const p of arr) {
    const jk = p.JKey || s.key;
    const jkeys = [jk];
    if (jk === 'pnas' && Array.isArray(p.Sections)) for (const sec of p.Sections) { const k = PNAS_SECTION_KEYS[sec]; if (k) jkeys.push(k); }
    papers.push({ doi: p.DOI || '', year: p.Year != null ? String(p.Year) : '', titleLC: (p.Title || '').toLowerCase(), authLC: (p.Authors || '').toLowerCase(), affLC: (p.Affiliations || '').toLowerCase(), absLC: (p.Abstract || '').toLowerCase(), jkeys: [...new Set(jkeys.filter(Boolean))], hasPre: isHttp(p.Preprint) ? 1 : 0 });
  }
}
const journalTypeKeys = (t) => t === 'utd24' ? M.UTD24 : t === 'ft50' ? M.FT50 : t === 'abs4' ? M.abs4 : t === 'abs3' ? M.abs3 : new Set();
function scopeSet(sel) { if (!sel.journal.size && !sel.jtype.size) return null; const s = new Set(sel.journal); sel.jtype.forEach((t) => journalTypeKeys(t).forEach((k) => s.add(k))); return s; }
function oracle(sel, live, opts = {}) {
  const scope = opts.excludeScope ? null : scopeSet(sel);
  const matched = []; let inScope = 0;
  for (const p of papers) {
    if (scope && !p.jkeys.some((k) => scope.has(k))) continue;
    inScope++;
    if (sel.preprintOnly && !p.hasPre) continue;
    if (!opts.excludeYear && sel.year.size && !sel.year.has(p.year)) continue;
    if (!opts.excludeTitle) { if (live.title && !textMatch(p.titleLC, live.title)) continue; let ok = true; for (const t of sel.title) if (!textMatch(p.titleLC, t)) { ok = false; break; } if (!ok) continue; }
    if (!opts.excludeAbstract) { if (live.abstract && !textMatch(p.absLC, live.abstract)) continue; let ok = true; for (const t of sel.abstract) if (!textMatch(p.absLC, t)) { ok = false; break; } if (!ok) continue; }
    if (!opts.excludeAffiliation) { if (live.affiliation && !textMatch(p.affLC, live.affiliation)) continue; let ok = true; for (const t of sel.affiliation) if (!textMatch(p.affLC, t)) { ok = false; break; } if (!ok) continue; }
    if (!opts.excludeAuthor) {
      if (live.author && !authorMatch(p.authLC, live.author)) continue;
      let ok = true; for (const a of sel.author) if (!authorMatch(p.authLC, a)) { ok = false; break; } if (!ok) continue;
      for (const lbl in sel.authorIdentity) { const vs = sel.authorIdentity[lbl]; if (!vs.some((v) => p.authLC.includes(v))) { ok = false; break; } } if (!ok) continue;
    }
    matched.push(p);
  }
  return { matched, inScope };
}

// ── SQL side ──────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB);
const jkeysOfId = new Map();
for (const r of db.prepare('SELECT paper_id,jkey FROM paper_jkey').all()) { if (!jkeysOfId.has(r.paper_id)) jkeysOfId.set(r.paper_id, []); jkeysOfId.get(r.paper_id).push(r.jkey); }
function sqlMatched(sel, live, opts = {}) {
  const q = LitQuery.buildFilter(sel, live, opts);
  const sql = `SELECT p.id,p.doi,p.year_raw,p.title,p.authors,p.affiliations,a.abstract FROM papers p ${q.joins} LEFT JOIN papers_abs a ON a.id=p.id WHERE ${q.where}`;
  const rows = db.prepare(sql).all(...q.params);
  return LitQuery.applyResiduals(rows, q.residuals).map((r) => ({ id: r.id, doi: r.doi, year: r.year_raw, titleLC: (r.title || '').toLowerCase(), authLC: (r.authors || '').toLowerCase(), jkeys: jkeysOfId.get(r.id) || [] }));
}
function sqlScopeCount(sel) { const sc = LitQuery.buildScope(sel); return db.prepare(`SELECT COUNT(*) c FROM papers p WHERE ${sc.where || '1'}`).get(...sc.params).c; }

// ── compare (ROW-level: multiset of a composite key, not deduped DOIs) ────────
const rowKey = (r) => (r.doi || '') + '|' + (r.year || '') + '|' + r.titleLC + '|' + r.authLC;
function multiset(rows) { const m = new Map(); for (const r of rows) { const k = rowKey(r); m.set(k, (m.get(k) || 0) + 1); } return m; }
function multisetDiff(a, b) { const ks = new Set([...a.keys(), ...b.keys()]); for (const k of ks) if ((a.get(k) || 0) !== (b.get(k) || 0)) return { k, a: a.get(k) || 0, b: b.get(k) || 0 }; return null; }
function tally(rows, keyFn) { const m = {}; for (const r of rows) { const ks = keyFn(r); (Array.isArray(ks) ? ks : [ks]).forEach((k) => { m[k] = (m[k] || 0) + 1; }); } return m; }
function mapsEqual(a, b) { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) if ((a[k] || 0) !== (b[k] || 0)) return { k, a: a[k] || 0, b: b[k] || 0 }; return null; }
const S = (a) => new Set(a || []);
const mk = (o) => ({ journal: S(o.journal), jtype: S(o.jtype), year: S(o.year), title: S(o.title), author: S(o.author), authorIdentity: o.authorIdentity || {}, affiliation: S(o.affiliation), abstract: S(o.abstract), preprintOnly: !!o.preprintOnly });
const live = (o) => ({ title: o.t || '', author: o.au || '', affiliation: o.af || '', abstract: o.ab || '' });

const CASES = [
  ['journal ms', mk({ journal: ['ms'] }), live({})],
  ['journal ms+opre', mk({ journal: ['ms', 'opre'] }), live({})],
  ['pnas section econ', mk({ journal: ['pnas-econ'] }), live({})],
  ['type ft50', mk({ jtype: ['ft50'] }), live({})],
  ['type utd24', mk({ jtype: ['utd24'] }), live({})],
  ['type abs4', mk({ jtype: ['abs4'] }), live({})],
  ['type abs3', mk({ jtype: ['abs3'] }), live({})],
  ['type ft50+journal pnas (union)', mk({ jtype: ['ft50'], journal: ['pnas'] }), live({})],
  ['year 2024', mk({ year: ['2024'] }), live({})],
  ['year 2023+2024', mk({ year: ['2023', '2024'] }), live({})],
  ['title live ~market', mk({}), live({ t: 'market' })],
  ['title chip ~learning', mk({ title: ['learning'] }), live({})],
  ['title quoted "revenue management"', mk({ title: ['"revenue management"'] }), live({})],
  ['abstract ~pricing', mk({}), live({ ab: 'pricing' })],
  ['abstract quoted "machine learning"', mk({ abstract: ['"machine learning"'] }), live({})],
  ['abstract ~quantum (rare)', mk({}), live({ ab: 'quantum' })],
  ['affiliation ~mit', mk({}), live({ af: 'mit' })],
  ['affiliation ~stanford', mk({ affiliation: ['stanford'] }), live({})],
  ['author prefix ~bertsim', mk({}), live({ au: 'bertsim' })],
  ['author prefix ~stou', mk({ author: ['stou'] }), live({})],
  ['author quoted "gans"', mk({ author: ['"gans"'] }), live({})],
  ['author 2-char ~li (LIKE fallback)', mk({ author: ['li'] }), live({})],
  ['identity chip morozov', mk({ authorIdentity: { Morozov: [' morozov'] } }), live({})],
  ['preprint only', mk({ preprintOnly: true }), live({})],
  ['ft50 + abstract pricing + 2024', mk({ jtype: ['ft50'], year: ['2024'] }), live({ ab: 'pricing' })],
  ['ms + title market + preprint', mk({ journal: ['ms'], preprintOnly: true }), live({ t: 'market' })],
  ['author prefix + affiliation', mk({ author: ['stou'] }), live({ af: 'university' })],
  ['title AND two chips', mk({ title: ['learning', 'market'] }), live({})],
];

let fails = 0;
for (const [name, sel, lv] of CASES) {
  const o = oracle(sel, lv), s = sqlMatched(sel, lv);
  const yOK = o.inScope === sqlScopeCount(sel);
  const msDiff = multisetDiff(multiset(o.matched), multiset(s));
  const xOK = o.matched.length === s.length && !msDiff;
  const jDiff = mapsEqual(tally(oracle(sel, lv, { excludeScope: true }).matched, (r) => r.jkeys), tally(sqlMatched(sel, lv, { excludeScope: true }), (r) => r.jkeys));
  const yrDiff = mapsEqual(tally(oracle(sel, lv, { excludeYear: true }).matched, (r) => r.year), tally(sqlMatched(sel, lv, { excludeYear: true }), (r) => r.year));
  const ok = yOK && xOK && !jDiff && !yrDiff;
  if (ok) { console.log(`ok    ${name.padEnd(46)} Y=${o.inScope} X=${o.matched.length}`); }
  else { fails++; console.log(`FAIL  ${name}`);
    if (!yOK) console.log(`   Y: oracle=${o.inScope} sql=${sqlScopeCount(sel)}`);
    if (!xOK) console.log(`   X(rows): oracle=${o.matched.length} sql=${s.length}` + (msDiff ? `  diff=${JSON.stringify(msDiff)}` : ''));
    if (jDiff) console.log(`   crossFilter journal: ${JSON.stringify(jDiff)}`);
    if (yrDiff) console.log(`   crossFilter year: ${JSON.stringify(yrDiff)}`);
  }
}
db.close(); try { fs.rmSync(DB); fs.rmSync(DB + '.sha'); fs.rmSync(DB + '.length'); } catch {}
console.log(`\n${CASES.length - fails}/${CASES.length} cases passed` + (fails ? `  — ${fails} FAILED` : '  — ALL PARITY CHECKS PASS'));
process.exit(fails ? 1 : 0);
