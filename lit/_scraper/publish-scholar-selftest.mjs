import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeForPublication, installRenderer } from './publish-scholar-citations.mjs';
const doi = '10.1287/mnsc.2020.01547';
const known = new Set([doi, '10.1287/mnsc.other']);
const entry = { title: 'A paper', count: 13, checked: '2026-10-13', cluster: '12345678901234567890', method: 'browser-verified' };
const merge = (remote, local) => mergeForPublication(remote, local, known, '2026-10-13');
assert.equal(merge({}, { [doi]: entry })[doi].count, 13);
assert.equal(merge({ [doi]: entry }, { [doi]: { ...entry, checked: '2026-10-12', count: 12 } })[doi].count, 13);
assert.equal(merge({ [doi]: { ...entry, checked: '2026-10-12', count: 20 } }, { [doi]: entry })[doi].count, 13);
assert.equal(Object.keys(merge({ '10.1287/mnsc.other': entry }, { [doi]: entry })).length, 2);
assert.throws(() => merge({ [doi]: entry }, { [doi]: { ...entry, count: 14 } }), /count conflict/);
assert.throws(() => merge({ [doi]: entry }, { [doi]: { ...entry, cluster: '456' } }), /Cluster conflict/);
for (const invalid of [{ count: -1 }, { count: '13' }, { cluster: 123 }, { checked: '2026-10-14' }, { method: 'unverified' }, { method: 'publish-or-perish-doi-match', count: 0 }]) {
  assert.throws(() => merge({}, { [doi]: { ...entry, ...invalid } }), /Invalid or unverified/);
}
assert.throws(() => merge({}, { '10.unknown': entry }), /Invalid or unverified/);
const local = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const remoteFixture = "const DATA_BASE = './data/';\nasync function loadData() {\n}\nfunction citedByTagHTML(p) {\n  // existing renderer\n}\n// unrelated remote navigation stays here";
const installed = installRenderer(remoteFixture, local);
assert.match(installed, /const scholarCitationsReady =/);
assert.match(installed, /await scholarCitationsReady/);
assert.match(installed, /const scholar = scholarCitations\[doi\]/);
assert.match(installed, /unrelated remote navigation stays here/);
assert.equal(installRenderer(installed, local), installed);
assert.throws(() => installRenderer('changed layout', local), /anchor changed/);
console.log('Passed publication merge, conflict rejection, data validation, and isolated renderer installation checks.');
