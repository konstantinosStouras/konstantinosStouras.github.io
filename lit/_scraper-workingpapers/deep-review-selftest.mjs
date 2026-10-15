import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {matchPublished} from './build-data.mjs';
const audit=JSON.parse(await fs.readFile(new URL('../data-workingpapers/_fullpaper-review-audit.json',import.meta.url),'utf8'));
const confirmed=audit.records.filter(r=>r.status==='confirmed');
assert.equal(audit.records.length,4886);
assert.equal(confirmed.length,audit.stats.confirmed);
assert.equal(confirmed.filter(r=>r.active).length,audit.stats.transfers);
for(const r of confirmed){
  assert(r.selected.evidence.length,'Every confirmation needs retained evidence');
  assert.equal(matchPublished({Title:r.workingTitle,DOI:r.workingDOI,Preprint:r.url},new Map())?.doi,r.selected.doi,r.workingTitle);
}
const sample=confirmed[0],other=confirmed.find(r=>r.selected.doi!==sample.selected.doi);
assert.equal(matchPublished({Title:'Online Appendix to '+sample.workingTitle,DOI:sample.workingDOI,Preprint:sample.url},new Map()),null);
assert.equal(matchPublished({Title:sample.workingTitle,DOI:other.workingDOI,Preprint:sample.url},new Map())?.doi,sample.selected.doi);
assert.equal(matchPublished({Title:'Unreviewed manuscript',DOI:'10.example/unknown',Preprint:'https://example.org/unreviewed'},new Map()),null);
console.log('Deep-review mappings verified for '+confirmed.length+' versions, with supporting-document and identifier safeguards.');
