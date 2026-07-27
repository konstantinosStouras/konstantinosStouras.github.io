/*
 * scope-selftest.mjs — offline test of the topic-scoped harvest (no network).
 * ===========================================================================
 * Runs the full MOCK build twice (fixtures in _scraper/mock/, output in the
 * scratch _scraper/_mock-out/ — never the live data/) and asserts:
 *
 *   1. the mustInclude DOI (the owner's requested Wuchty/Jones/Uzzi paper)
 *      lands in the dataset with its 'must' audit tag;
 *   2. non-journal-article Crossref records are dropped (mapJournal);
 *   3. duplicate registrations of the same work collapse to the fullest row
 *      (collapseSameWork — the no-volume stub loses);
 *   4. the derived files are consistent (sources/meta/scope audit tags);
 *   5. a second identical run is byte-identical (deterministic, so an
 *      unchanged dataset never commits).
 *
 * Run: node _scraper/scope-selftest.mjs
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '_mock-out');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  ${name}`);
  else { console.error(`  FAIL ${name}`); failures++; }
}

const { bareDoi, scopeExcluded } = await import('./build-data.mjs');
check('bareDoi strips scheme+host and lowercases',
  bareDoi('https://doi.org/10.1126/SCIENCE.1136099') === '10.1126/science.1136099');
check('scopeExcluded is inert with an empty prefix list',
  scopeExcluded('10.1126/science.1136099') === false);

function runBuild() {
  execFileSync(process.execPath, [join(__dirname, 'build-data.mjs')], {
    env: { ...process.env, FT50_MOCK: '1', FT50_PULL_DATE: '2026-01-01' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}
function snapshot() {
  const out = {};
  for (const f of readdirSync(OUT).sort()) out[f] = readFileSync(join(OUT, f), 'utf8');
  return out;
}

rmSync(OUT, { recursive: true, force: true });
runBuild();
const first = snapshot();

const papers = JSON.parse(first['papers-science.json'] || '[]');
const dois = papers.map(p => String(p.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase());
const scope = JSON.parse(first['_scope.json'] || '{}');

// 1. mustInclude: in the dataset, with both tags (it is also in the fixture).
check('the Wuchty/Jones/Uzzi paper is in the dataset',
  dois.includes('10.1126/science.1136099'));
check('its scope entry carries the must + topic tags',
  ((scope.science || {})['10.1126/science.1136099'] || { r: [] }).r.join(',') === 'must,topic');

// 2. non-journal-article records are dropped.
check('editorial-typed Crossref record is dropped',
  !dois.includes('10.1126/science.nonart-1'));

// 3. duplicate registrations collapse; the fuller (published) row wins.
const dupRows = papers.filter(p => /transform how discoveries/.test(p.Title));
check('duplicate registration collapsed to one row', dupRows.length === 1);
check('the published registration won the collapse',
  dupRows.length === 1 && dupRows[0].Volume === '390' &&
  /science\.test-1111/.test(dupRows[0].DOI));

// 4. derived files.
const sources = JSON.parse(first['sources.json'] || '[]');
check('sources.json lists Science alone, limitedCoverage, no abs',
  sources.length === 1 && sources[0].key === 'science' &&
  sources[0].limitedCoverage === true && !sources[0].abs);
const meta = JSON.parse(first['meta.json'] || '{}');
check('meta.json paperCount matches the papers file', meta.paperCount === papers.length);
check('recent.json is a valid array', Array.isArray(JSON.parse(first['recent.json'] || 'null')));

// 5. determinism: byte-identical second run.
runBuild();
const second = snapshot();
const changed = Object.keys({ ...first, ...second }).filter(f => first[f] !== second[f]);
check('second run is byte-identical (' + (changed.length ? 'changed: ' + changed.join(', ') : 'all files') + ')',
  changed.length === 0);

rmSync(OUT, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll scope-selftest checks passed.');
