import assert from 'node:assert/strict';
import { applyEditors, mergeEditors, refreshDue, editorsFromCrossref } from './editorial-refresh.mjs';

const now = Date.parse('2026-11-14T12:00:00Z');
assert.equal(refreshDue({ none: true }, false, now), true, 'legacy misses must be revisited');
assert.equal(refreshDue({ none: true, checkedAt: '2026-11-13T12:00:00Z' }, false, now), false);
assert.equal(refreshDue({ none: true, checkedAt: '2026-11-01T12:00:00Z' }, false, now), true);
assert.equal(refreshDue({ se: 'Senior Person' }, true, now), true, 'ISR still needs associate editor');
assert.equal(refreshDue({ se: 'Senior Person' }, false, now), false, 'MkSc requires senior only');
assert.equal(refreshDue({ se: 'Senior Person', ae: 'Associate Person' }, true, now), false);
const partial = mergeEditors({ se: 'Senior Person', checkedAt: '2026-11-14' }, { ae: 'Associate Person', checkedAt: '2026-11-01' });
assert.equal(partial.se, 'Senior Person');
assert.equal(partial.ae, 'Associate Person');
assert.equal(partial.checkedAt, '2026-11-14', 'push retry cannot roll back freshness');
assert.equal(mergeEditors(partial, { none: true }).none, undefined, 'a miss cannot downgrade known editors');
assert.equal(mergeEditors(partial, { se: '', ae: '' }).ae, 'Associate Person');
assert.equal(refreshDue({ crossrefCheckedAt: '2026-11-13T00:00:00Z', checkedAt: '2026-11-14' }, true, now, 'crossrefCheckedAt', 1), true, 'publisher and metadata retries are independent');

assert.deepEqual(editorsFromCrossref({ title: ['A research paper'], abstract: 'History: Hema Yoganarasimhan served as the senior editor.' }), { se: 'Hema Yoganarasimhan', ae: '' });
assert.deepEqual(editorsFromCrossref({ title: ['A research paper'], assertion: [
  { label: 'Senior Editor', value: 'Senior Person' },
  { label: 'History', value: 'Associate Person, Associate Editor.' },
] }, true), { se: 'Senior Person', ae: 'Associate Person' });
assert.deepEqual(editorsFromCrossref({ title: ['Editorial Board'], abstract: 'History: Senior Person served as the senior editor.' }), {});
assert.equal(editorsFromCrossref({ title: ['A research paper'], assertion: [{ label: 'Senior Editor', value: 'This paper is still being processed by the editors' }] }).se, '');

const rows = [
  { DOI: 'https://doi.org/10.1287/isre.2026.1', Title: 'Research', 'Senior Editor': 'Existing Person' },
  { DOI: '10.1287/mksc.2026.2', Title: 'Research' },
  { DOI: '10.1287/mksc.2026.eb', Title: 'Editorial Board', 'Senior Editor': 'Wrong Person' },
  { DOI: '10.1287/mnsc.2026.3', Title: 'Unrelated research', Area: 'finance' },
];
const cache = {
  '10.1287/isre.2026.1': { se: 'Conflicting Person', ae: 'Associate Person' },
  '10.1287/mksc.2026.2': { se: 'Hema Yoganarasimhan' },
  '10.1287/mksc.2026.eb': { se: 'Wrong Person' },
};
assert.equal(applyEditors(rows, cache), 3);
assert.equal(rows[0]['Senior Editor'], 'Existing Person');
assert.equal(rows[0]['Associate Editor'], 'Associate Person');
assert.equal(rows[1]['Senior Editor'], 'Hema Yoganarasimhan');
assert.equal(rows[2]['Senior Editor'], '');
assert.equal(rows[3].Area, 'finance');
assert.equal(applyEditors(rows, cache), 0, 'repeat applications are idempotent');
console.log('Editorial refresh: 24 regression assertions passed.');
