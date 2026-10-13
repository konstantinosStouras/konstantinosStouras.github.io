// Offline checks for verified Scholar observations and the actual card renderer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(process.env.LIT_TEST_HTML || new URL('../index.html', import.meta.url), 'utf8');
const observations = JSON.parse(readFileSync(process.env.LIT_TEST_CITATIONS || new URL('../data/scholar-citations.json', import.meta.url), 'utf8'));
const rows = JSON.parse(readFileSync(process.env.LIT_TEST_PAPERS || new URL('../data/papers-ms.json', import.meta.url), 'utf8'));
const known = new Set(rows.map(p => p.DOI.replace(/^https?:\/\/doi.org\//i, '').toLowerCase()));
for (const [doi, value] of Object.entries(observations)) {
  assert(known.has(doi), `Unknown DOI: ${doi}`);
  assert(Number.isSafeInteger(value.count) && value.count >= 0);
  assert(/^\d+$/.test(value.cluster));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value.checked));
  assert(value.title && value.method);
}
const start = html.indexOf('function scholarSearchUrl(');
const end = html.indexOf('// Markup for one paper card.', start);
assert(start > 0 && end > start);
const context = vm.createContext({
  scholarCitations: { '10.1287/mnsc.2020.01547': {
    count: 13, checked: '2026-10-13', cluster: '13987205804766814296',
  } },
  esc: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  escAttr: s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
});
vm.runInContext(html.slice(start, end), context);
const paper = { DOI: 'https://doi.org/10.1287/mnsc.2020.01547', Title: 'Too Much Information', CitedBy: 1 };
let badge = context.citedByTagHTML(paper);
assert.match(badge, /Cited by 13/);
assert.match(badge, /Google Scholar citation count, checked 2026-10-13/);
assert.match(badge, /cites=13987205804766814296/);
assert.doesNotMatch(badge, /highest of/);
assert.match(context.citedByTagHTML({ ...paper, CitedBy: 99 }), /Cited by 13/);
assert.match(context.citedByTagHTML({ DOI: '10.unknown', Title: 'Other', CitedBy: 3, CitedBySrc: 'oa' }), /OpenAlex citation count/);
assert.equal(context.citedByTagHTML({ DOI: '10.unknown' }), '');
context.scholarCitations = { '10.test': { count: 0, checked: '2026-10-13', cluster: '123' } };
assert.match(context.citedByTagHTML({ DOI: '10.test', CitedBy: 10 }), /Cited by 0/);
context.scholarCitations['10.test'].cluster = '123" onclick="alert(1)';
assert.doesNotMatch(context.citedByTagHTML({ DOI: '10.test', Title: 'Test', CitedBy: 10 }), /onclick/);
console.log(`Passed Scholar renderer checks and validated ${Object.keys(observations).length} saved observations.`);
