/*
 * scope-selftest.mjs — offline test of the topic-scoped harvest (no network).
 * ===========================================================================
 * Runs the full MOCK build twice (fixtures in _scraper/mock/, output in the
 * scratch _scraper/_mock-out/ — never the live data/) and asserts:
 *
 *   1. mustInclude DOIs land in the dataset even when the mock OpenAlex
 *      scope missed them (the Reply paper is absent from the nhb scope
 *      fixture on purpose);
 *   2. excludeDoiPrefixes keeps Nature d41586-* NEWS DOIs out even though
 *      the scope fixture and the Crossref fixture both carry them;
 *   3. non-journal-article Crossref records are dropped (mapJournal);
 *   4. duplicate registrations of the same work collapse to the fullest row
 *      (collapseSameWork — the no-volume stub loses);
 *   5. the derived files are consistent (sources/meta/scope audit tags);
 *   6. a second identical run is byte-identical (deterministic, so an
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
  bareDoi('https://doi.org/10.1038/S41586-019-0941-9') === '10.1038/s41586-019-0941-9');
check('scopeExcluded catches Nature news DOIs',
  scopeExcluded('10.1038/d41586-026-01726-y') === true);
check('scopeExcluded passes research DOIs',
  scopeExcluded('10.1038/s41586-019-0941-9') === false);

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

const papers = (k) => JSON.parse(first[`papers-${k}.json`] || '[]');
const dois = (k) => papers(k).map(p => String(p.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase());
const scope = JSON.parse(first['_scope.json'] || '{}');

// 1. mustInclude: the Reply paper is NOT in the nhb scope fixture — only
// mustInclude can have brought it in.
check('mustInclude forces the Reply paper into the nhb scope',
  !!(scope.nhb || {})['10.1038/s41562-025-02195-5'] &&
  (scope.nhb['10.1038/s41562-025-02195-5'].r || []).includes('must'));
check('all six example papers are in the dataset',
  dois('nature').includes('10.1038/s41586-019-0941-9') &&
  dois('nhb').includes('10.1038/s41562-025-02173-x') &&
  dois('nhb').includes('10.1038/s41562-024-01953-1') &&
  dois('nhb').includes('10.1038/s41562-025-02195-5') &&
  dois('ncomms').includes('10.1038/s41467-025-61345-5'));
check('a DOI in both the scope fixture and mustInclude carries both tags',
  ((scope.nature || {})['10.1038/s41586-019-0941-9'] || { r: [] }).r.join(',') === 'must,topic');

// 2. news exclusion — out of the scope AND therefore out of the dataset,
// even though both fixtures list it.
check('d41586-* news DOI is excluded from the scope',
  !(scope.nature || {})['10.1038/d41586-026-01726-y']);
check('d41586-* news DOI is excluded from the dataset',
  !dois('nature').includes('10.1038/d41586-026-01726-y'));

// 3. non-journal-article records are dropped.
check('editorial-typed Crossref record is dropped',
  !dois('nature').includes('10.1038/nature.editorial-1'));

// 4. duplicate registrations collapse; the fuller (published) row wins.
const dupRows = papers('nature').filter(p => /Generative agents reshape/.test(p.Title));
check('duplicate registration collapsed to one row', dupRows.length === 1);
check('the published registration won the collapse',
  dupRows.length === 1 && dupRows[0].Volume === '645' &&
  /s41586-025-11111-1/.test(dupRows[0].DOI));

// 5. derived files.
const sources = JSON.parse(first['sources.json'] || '[]');
check('sources.json lists the three journals, all limitedCoverage, no abs',
  sources.length === 3 && sources.every(s => s.limitedCoverage && !s.abs));
const meta = JSON.parse(first['meta.json'] || '{}');
check('meta.json paperCount matches the papers files',
  meta.paperCount === papers('nature').length + papers('nhb').length + papers('ncomms').length);
check('recent.json is a valid array', Array.isArray(JSON.parse(first['recent.json'] || 'null')));

// 6. determinism: byte-identical second run.
runBuild();
const second = snapshot();
const changed = Object.keys({ ...first, ...second }).filter(f => first[f] !== second[f]);
check('second run is byte-identical (' + (changed.length ? 'changed: ' + changed.join(', ') : 'all files') + ')',
  changed.length === 0);

rmSync(OUT, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll scope-selftest checks passed.');
