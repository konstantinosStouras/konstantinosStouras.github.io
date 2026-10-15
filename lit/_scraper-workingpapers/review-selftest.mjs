import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {matchPublished,isSupportingDocument} from './build-data.mjs';
const audit=JSON.parse(await fs.readFile(new URL('../data-workingpapers/_uncertain-review-audit.json',import.meta.url),'utf8'));
const confirmed=audit.decisions.filter(d=>d.status==='confirmed');
const corrections=new Set(JSON.parse(await fs.readFile(new URL('../data-workingpapers/_alternative-review-audit.json',import.meta.url),'utf8')).supportingDocumentCorrections.map(c=>c.url));
for(const d of confirmed){const rec={Title:d.workingTitle,DOI:d.workingDOI,Preprint:d.url};if(isSupportingDocument(d.workingTitle)){assert(corrections.has(d.url),'A superseded mapping needs a documented restoration');assert.equal(matchPublished(rec,new Map()),null);}else assert.equal(matchPublished(rec,new Map())?.doi,d.selected.doi,'Reviewed version must resolve even without the satellite catalog: '+d.workingTitle);}
assert.equal(matchPublished({Title:'Unrelated follow-up research',DOI:'10.example/unreviewed',Preprint:'https://arxiv.org/abs/0000.00000'},new Map()),null);
const d=confirmed[0];assert.equal(matchPublished({Title:'Online Appendix to '+d.workingTitle,DOI:d.workingDOI,Preprint:d.url},new Map()),null,'A supporting document must not inherit the main version mapping');
const other=confirmed.find(x=>x.selected.doi!==d.selected.doi);assert.equal(matchPublished({Title:d.workingTitle,DOI:other.workingDOI,Preprint:d.url},new Map())?.doi,d.selected.doi,'Verified repository URL takes priority over a corrupt imported DOI');
console.log('Reviewed-version regression checks passed for '+confirmed.length+' historical outcomes, including documented companion corrections, unknown identifiers, supporting documents, and corrupt imported DOI fields.');
