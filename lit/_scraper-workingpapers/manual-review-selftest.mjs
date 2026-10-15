import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {matchPublished,isSupportingDocument} from './build-data.mjs';
import {compact} from './alternative-identity.mjs';
import {substantialPaperMatch} from './deep-evidence.mjs';
const audit=JSON.parse(await fs.readFile(new URL('../data-workingpapers/_manual-review-audit.json',import.meta.url),'utf8'));
assert.equal(audit.records.length,4077);const yes=audit.records.filter(r=>r.status==='confirmed'),no=audit.records.filter(r=>r.status!=='confirmed');
assert.equal(yes.length,audit.stats.confirmed);assert.equal(yes.length,272);assert.equal(no.length,3805);
for(const r of yes){assert(!isSupportingDocument(r.workingTitle));assert(r.selected.evidenceURL?.startsWith('https://'));assert(r.evidence.length);assert.equal(matchPublished({Title:r.workingTitle,DOI:r.workingDOI,Preprint:r.url},new Map())?.doi,r.selected.doi,r.workingTitle);
 for(const e of r.evidence){assert(e.manualReview);if(e.method==='manual-independent-full-paper-comparison'){assert(e.independentFiles);assert(substantialPaperMatch(e.overlap));}if(e.currentTitle)assert.equal(compact(e.currentTitle),compact(r.selected.title));if(e.method==='primary-repository-journal-citation'){assert(e.citationMatch);assert(e.bibliography.biblio.first_page);assert(e.bibliography.biblio.last_page);}}
}
for(const r of no)assert.equal(matchPublished({Title:r.workingTitle,DOI:r.workingDOI,Preprint:r.url},new Map()),null,r.workingTitle);
const example=yes.find(r=>r.url.includes('ssrn.com')&&/abstract_id=\d+/.test(r.url)),id=example.url.match(/abstract_id=(\d+)/)[1],doi='10.2139/ssrn.'+id;
assert.equal(matchPublished({Title:'Unrelated unreviewed manuscript',DOI:doi,Preprint:'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=9999999999'},new Map()),null,'An imported DOI cannot borrow another SSRN source mapping');
assert.equal(matchPublished({Title:example.workingTitle,DOI:'10.example/corrupt',Preprint:'https://autopapers.ssrn.com/abstract='+id},new Map())?.doi,example.selected.doi,'A repository alias uses its actual source identifier');
assert.equal(matchPublished({Title:'Unrelated unreviewed manuscript',DOI:doi,Preprint:'https://arxiv.org/abs/9999.99999'},new Map()),null,'An arXiv identifier cannot borrow an SSRN mapping');
assert.equal(matchPublished({Title:'Unrelated unreviewed manuscript',DOI:doi,Preprint:'https://www.nber.org/papers/w999999999'},new Map()),null,'An NBER identifier cannot borrow an SSRN mapping');
assert.equal(matchPublished({Title:'Electronic Companion: '+example.workingTitle,DOI:doi,Preprint:example.url},new Map()),null);
for(const i of [2195,2583,3586,3710,3728])assert.notEqual(audit.records[i].status,'confirmed');
console.log('Manual review: all 272 mappings, all 3805 retained cases, independent-paper evidence and source-identifier safeguards verified.');
