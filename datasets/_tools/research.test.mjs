import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog} from '../catalog.mjs';
import {mergeResearch} from '../research.mjs';
const catalog=JSON.parse(readFileSync(new URL('./research-additions.json',import.meta.url)));
const base=parseCatalog(readFileSync(new URL('./source.md',import.meta.url),'utf8'));
test('every research addition has dated evidence, paper identifiers, and valid URLs',()=>{
  for(const d of catalog.datasets){
    assert.match(d.dateAdded,/^\d{4}-\d{2}-\d{2}$/);assert.ok(d.tags.length&&d.paperDois.length&&d.verification);
    assert.equal(new URL(d.url).protocol,'https:');
    for(const doi of d.paperDois){const p=catalog.papers[doi];assert.ok(p.title&&p.authors&&p.evidenceSection&&p.verifiedAt);assert.equal(p.doi,doi);assert.equal(new URL(p.url).hostname,'doi.org');assert.ok(p.year>=2006&&p.year<=2026);}
  }
});
test('live upstream reload preserves research additions without duplicating them',()=>{
  const merged=mergeResearch(base,catalog);assert.equal(merged.length,base.length+catalog.datasets.filter(d=>!base.some(e=>e.id===d.id||e.url===d.url)).length);
  assert.equal(mergeResearch(merged,catalog).length,merged.length);
  assert.ok(merged.filter(e=>e.research).every(e=>e.paper&&e.papers.length&&e.search.includes('innovation')));
  assert.equal(new Set(merged.map(e=>e.id)).size,merged.length);
});
