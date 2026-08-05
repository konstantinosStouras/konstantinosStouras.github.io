/*
 * citeflow-selftest.mjs — offline unit test for the journal-to-journal
 * citation-flow aggregator (build-citeflow.mjs). Mock fixtures, no network:
 *   node lit/_scraper/citeflow-selftest.mjs
 *
 * Guards the invariants the analytics "Citation flows" charts rely on:
 *   • the SAME edge set drives both directions — out[] windowed by the CITING
 *     paper's year, in[] by the CITED paper's year, equal grand totals;
 *   • an edge whose endpoint is missing from refs-index or carries a junk
 *     year is dropped from BOTH maps, never half-counted;
 *   • self-citations (a journal citing itself) are kept;
 *   • an empty dataset yields empty maps (the page then hides the charts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCiteflow } from './build-citeflow.mjs';

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citeflow-'));
const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));

// ── fixtures ──────────────────────────────────────────────────────────────
// ms/1 (2020) cites ms/2 (2010), aer/1 (1999) and a DOI absent from the index;
// ms/2 (2010) cites aer/1 (1999); aer/1 (1999) cites ms/2 (2010) and a
// junk-year row. One PNAS paper cites nothing and has no shard entry.
write('manifest.json', {
  generated: '2026-08-01',
  shards: { ms: { file: 'refs-ms.json' }, aer: { file: 'refs-aer.json' } },
});
write('refs-index.json', {
  '10.1/ms.1': ['MS paper one', 'ms', '2020', 'A Author'],
  '10.1/ms.2': ['MS paper two', 'ms', '2010', 'B Author'],
  '10.2/aer.1': ['AER paper', 'aer', '1999', 'C Author'],
  '10.3/junk.1': ['Junk-year paper', 'opre', '0', 'D Author'],
});
write('refs-ms.json', {
  '10.1/ms.1': ['10.1/ms.2', '10.2/aer.1', '10.9/not-indexed'],
  '10.1/ms.2': ['10.2/aer.1'],
});
write('refs-aer.json', {
  '10.2/aer.1': ['10.1/ms.2', '10.3/junk.1'],
});

console.log('build-citeflow over the mock dataset');
const flow = buildCiteflow(dir);

ok(flow.generated === '2026-08-01', 'generated mirrors the refs manifest');
ok(flow.totals.edges === 4, `4 kept edges (got ${flow.totals.edges})`);
ok(flow.totals.droppedIndex === 1, 'the un-indexed cited DOI is dropped');
ok(flow.totals.droppedYear === 1, 'the junk-year edge is dropped');
ok(flow.totals.journals === 2 && flow.totals.pairs === 3, 'journal + pair counts');

// out[] — keyed by the CITING paper's year.
ok(eq(flow.out.ms, { ms: { 2020: 1 }, aer: { 2020: 1, 2010: 1 } }), 'out: MS self-citation kept, MS→AER split by citing year');
ok(eq(flow.out.aer, { ms: { 1999: 1 } }), 'out: AER→MS under AER\'s 1999');

// in[] — the SAME edges keyed by the CITED paper's year.
ok(eq(flow.in.ms, { ms: { 2010: 1 }, aer: { 2010: 1 } }), 'in: MS receives under the cited papers\' years');
ok(eq(flow.in.aer, { ms: { 1999: 2 } }), 'in: AER\'s two MS citers both land on its 1999 paper');

// The two directions describe the same edge set: equal grand totals.
const sum = (m) => { let s = 0; for (const a in m) for (const b in m[a]) for (const y in m[a][b]) s += m[a][b][y]; return s; };
ok(sum(flow.out) === flow.totals.edges && sum(flow.in) === flow.totals.edges, 'out/in grand totals both equal the edge count');

// ── empty dataset ─────────────────────────────────────────────────────────
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'citeflow-empty-'));
fs.writeFileSync(path.join(empty, 'manifest.json'), JSON.stringify({ shards: {} }));
const eflow = buildCiteflow(empty);
ok(eflow.totals.edges === 0 && eq(eflow.out, {}) && eq(eflow.in, {}), 'empty dataset → empty maps (page hides the charts)');

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });

if (fails) { console.error(`\nciteflow-selftest: ${fails} FAILED`); process.exit(1); }
console.log('\nciteflow-selftest: all checks passed');
