import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {matchPublished,isSupportingDocument,loadWpRows} from './build-data.mjs';
const audit=JSON.parse(await fs.readFile(new URL('../data-workingpapers/_alternative-review-audit.json',import.meta.url),'utf8'));
assert.equal(audit.records.length,4149);const confirmed=audit.records.filter(r=>r.status==='confirmed');
assert.equal(confirmed.length,audit.stats.confirmed);assert.equal(confirmed.filter(r=>r.active).length,audit.stats.transfers);
for(const r of confirmed){assert(!isSupportingDocument(r.workingTitle));assert(r.selected.workingSource||r.selected.publishedSource);assert(r.selected.confirmed);assert(!r.selected.sameDownloadedCopy||r.selected.sameCopyVersionEstablished);assert.equal(matchPublished({Title:r.workingTitle,DOI:r.workingDOI,Preprint:r.url},new Map())?.doi,r.selected.doi,r.workingTitle);}
const rows=await loadWpRows(fileURLToPath(new URL('../data-workingpapers',import.meta.url)),'wp-ssrn');
const links=JSON.parse(await fs.readFile(new URL('../data-workingpapers/submitted-preprints.json',import.meta.url),'utf8'));
for(const c of audit.supportingDocumentCorrections){assert(rows.some(r=>r.Preprint===c.url&&isSupportingDocument(r.Title)));assert.equal(matchPublished({Title:c.workingTitle,DOI:c.workingDOI,Preprint:c.url},new Map()),null);assert.equal(links[c.publishedDOI].u,c.replacementAccessLink);assert.notEqual(links[c.publishedDOI].u,c.url);}
const a=confirmed[0],b=confirmed.find(r=>r.selected.doi!==a.selected.doi);
assert.equal(matchPublished({Title:'Online Appendix to '+a.workingTitle,DOI:a.workingDOI,Preprint:a.url},new Map()),null);
assert.equal(matchPublished({Title:a.workingTitle,DOI:b.workingDOI,Preprint:a.url},new Map())?.doi,a.selected.doi);
assert.equal(matchPublished({Title:'Unknown manuscript',DOI:'10.example/unknown',Preprint:'https://example.org/unknown'},new Map()),null);
console.log('Alternative review: '+confirmed.length+' mappings verified, including satellite independence and supporting-document/identifier safeguards.');
