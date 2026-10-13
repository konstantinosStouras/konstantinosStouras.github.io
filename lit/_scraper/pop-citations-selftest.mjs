import assert from 'node:assert/strict';
import { mergeResults, resultIdentity, nextPacing } from './pop-citations.mjs';

const paper = { DOI: 'https://doi.org/10.1287/mnsc.2024.1', Title: 'A Paper' };
const doi = '10.1287/mnsc.2024.1';
const row = { doi, title: 'a paper', uid: 'GS:12345678901234567890', cites: 13,
  article_url: `https://pubsonline.informs.org/doi/abs/${doi}`,
  cites_url: 'https://scholar.google.com/scholar?cites=12345678901234567890&hl=en' };
const dates = { '12345678901234567890:13': '2026-10-13', '12345678901234567890:14': '2026-10-13' };
const merge = (records, old = {}, sourceDates = dates) => mergeResults(records, [paper], old, sourceDates, 'test.json');
let result = merge([row, row]);
assert.equal(result.changed, 1);
assert.equal(result.observations[doi].count, 13);
assert.equal(result.observations[doi].cluster, '12345678901234567890'); // Must remain a string.
assert.equal(merge([row], result.observations).changed, 0);
assert.equal(merge([row], {}, {}).changed, 0);
assert.equal(merge([row], {}, { '12345678901234567890:14': '2026-10-13' }).changed, 0);
assert.equal(merge([{ ...row, doi: '10.1287/mnsc.unknown' }]).changed, 0);
assert.equal(merge([{ ...row, cites: 0 }]).changed, 0);
assert.equal(merge([{ ...row, cites: '13' }]).changed, 0);
assert.equal(merge([{ ...row, cites_url: 'https://evil.example/?cites=12345678901234567890' }]).changed, 0);
assert.equal(merge([{ ...row, uid: 'GS:999' }]).changed, 0);
assert.equal(merge([row, { ...row, cites: 14 }]).changed, 0);
assert.equal(merge([row], { [doi]: { cluster: '999', checked: '2026-10-12', count: 99 } }).changed, 0);
assert.equal(merge([row], { [doi]: { cluster: row.uid.slice(3), checked: '2026-10-12', count: 99 } }).observations[doi].count, 13); // Counts can decrease.
assert.equal(resultIdentity({ ...row, article_url: 'https://pubsonline.informs.org/doi/10.1287/mnsc.2024.2' }).error, 'Conflicting DOI fields');
assert.equal(nextPacing({ batchResults: 100, waitSeconds: 60, cleanRuns: 6 }, false).batchResults, 150);
assert.deepEqual(nextPacing({ batchResults: 100, waitSeconds: 60, cleanRuns: 6 }, true), { batchResults: 50, waitSeconds: 120, cleanRuns: 0 });
console.log('Passed PoP DOI matching, provenance, duplicate, zero-count, stale-cache, and pacing checks.');
