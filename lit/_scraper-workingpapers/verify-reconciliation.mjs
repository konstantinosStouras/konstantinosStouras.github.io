import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadWpRows,buildWpRecentCounts} from './build-data.mjs';
const d='data-workingpapers';const read=async f=>JSON.parse(await fs.readFile(d+'/'+f,'utf8'));
const a=await read('_reconciliation-audit.json'),s=await read('sources.json'),m=await read('meta.json'),links=await read('submitted-preprints.json');
const retired=new Set(a.matches.map(x=>x.workingDOI+'|'+x.url));let total=0;const all=[];
for(const src of s){const rows=await loadWpRows(d,src.key);assert.equal(rows.length,src.count);assert.equal(rows.length,m.perSource[src.key]);for(const r of rows)assert(!retired.has(r.DOI+'|'+r.Preprint));total+=rows.length;for(const r of rows) all.push(r);}
assert.equal(total,m.paperCount);assert.equal(a.checked-total,a.matches.length);
for(const x of a.matches)assert(links[x.publishedDOI]?.u);
assert.equal(links['10.1287/mnsc.2019.3576'].u,'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2672133');
assert.deepEqual(await read('recent-counts.json'),buildWpRecentCounts(all,m.lastPull));
for(const r of await read('recent.json'))assert(!retired.has(r.DOI+'|'+r.Preprint));
const unique=new Set(a.matches.map(x=>x.publishedDOI)).size;
console.log(JSON.stringify({checked:a.checked,removed:a.matches.length,publishedPapersLinked:unique,remaining:total,review:a.reviewCount,verification:'all counts, transferred links, recent feeds, screenshot example and removed entries verified'}));
