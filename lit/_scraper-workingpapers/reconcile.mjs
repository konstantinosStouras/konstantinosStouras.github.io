// Reconcile every served working-paper part against every published catalog.
// Default is a read-only audit; --apply transfers links before removing rows.
import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadCatalog, loadWpRows, writeWpRows, WP_SOURCES, matchPublished, publishedCandidates, buildWpRecentCounts } from './build-data.mjs';
import { normTitle } from '../_scraper/ec-pages.mjs';
const root=resolve(import.meta.dirname,'..');
const dir=join(root,'data-workingpapers');
let existingReport = process.argv.includes('--apply-report') ? JSON.parse(await fs.readFile(join(dir,'_reconciliation-audit.json'),'utf8')) : null;
const priorMatches = new Map((existingReport?.matches || []).map(x => [x.workingDOI+'|'+x.url,x]));
const {byTitle}=await loadCatalog([join(root,'data'),join(root,'data-ft50')],{index:true});
const bases=['lit-data-abs4','lit-data-abs3-omecon','lit-data-abs3-rest','lit-data-nature','lit-data-science'];
async function get(url) { const r=await fetch(url); if(!r.ok) throw Error(`${url}: ${r.status}`);return r.json(); }
for(const base of existingReport ? [] : bases) {
 const url=`https://www.stouras.com/${base}/data/`;
 const sources=await get(url+'sources.json');
 let count=0;
 for(const src of sources) for(const file of src.files||[src.file]) {
  const rows=await get(url+file);
  for(const p of rows) {
   const doi=String(p.DOI||'').replace(/^https?:\/\/doi\.org\//i,'').toLowerCase();
   if(!doi) continue;
   const last=new Set(String(p.Authors||'').split(/[,;]/).map(n=>n.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim().split(/\s+/).at(-1)?.replace(/[^a-z]/g,'')).filter(Boolean));
   const key=normTitle(p.Title); if(!byTitle.has(key)) byTitle.set(key,[]);
   byTitle.get(key).push({doi,last,year:parseInt(p.Year)||0,title:p.Title,authors:p.Authors}); count++;
  }
 }
 console.log(base,count);
}
const supplement=JSON.parse(await fs.readFile(join(dir,'submitted-preprints.json'),'utf8'));
const matches=[],review=[],remaining={};let checked=0;
for(const key of Object.keys(WP_SOURCES)) {
 const rows=await loadWpRows(dir,key); remaining[key]=[];
 for(const r of rows) {
  checked++;
  if (checked % 25000 === 0) console.log('checked',checked);
  const prior = priorMatches.get(r.DOI+'|'+r.Preprint);
  const m=existingReport ? (prior ? {doi:prior.publishedDOI,title:prior.publishedTitle,authors:prior.publishedAuthors,year:prior.publishedYear,score:prior.score,exact:prior.exact} : null) : matchPublished(r,byTitle);
  const record=c=>({workingTitle:r.Title,workingAuthors:r.Authors,workingYear:r.Year,workingDOI:r.DOI,url:r.Preprint,publishedTitle:c.title,publishedAuthors:c.authors,publishedYear:c.year,publishedDOI:c.doi,score:c.score,exact:c.exact});
  if(m && r.Preprint) {
   matches.push(record(m));
   // Preserve an existing open copy; record every retired version in the audit.
   if(!supplement[m.doi]?.u) supplement[m.doi]={u:r.Preprint,s:r.PreprintSrc||''};
  } else {
   remaining[key].push(r);
   const c=existingReport ? [] : publishedCandidates(r,byTitle);
   if(c.length) review.push({ ...record(c[0]), alternatives:c.slice(1,4).map(x=>({doi:x.doi,title:x.title,score:x.score})) });
  }
 }
 console.log(key,rows.length,'retire',rows.length-remaining[key].length);
}
const report={checked,matched:matches.length,reviewCount:review.length,catalogs:['data','data-ft50',...bases],matches,review};
if (!existingReport) await fs.writeFile(join(dir,'_reconciliation-audit.json'),JSON.stringify(report));
console.log('audit',checked,matches.length,review.length);
if(process.argv.includes('--apply') || process.argv.includes('--apply-report')) {
 // Save the links first, so an interrupted run can never lose access URLs.
 await fs.writeFile(join(dir,'submitted-preprints.json'),JSON.stringify(supplement));
 const sources=JSON.parse(await fs.readFile(join(dir,'sources.json'),'utf8'));
 for(const s of sources) {const rows=remaining[s.key]; const files=await writeWpRows(dir,s.key,rows);s.file=files[0];if(files.length>1)s.files=files;else delete s.files;s.count=rows.length;}
 const all=Object.values(remaining).flat();
 const meta=JSON.parse(await fs.readFile(join(dir,'meta.json'),'utf8'));
 meta.paperCount=all.length;meta.perSource=Object.fromEntries(sources.map(s=>[s.key,s.count]));
 const recent=all.filter(r=>r['Date Added']).sort((a,b)=>String(b['Date Added']).localeCompare(String(a['Date Added']))||(parseInt(b.Year)||0)-(parseInt(a.Year)||0)).slice(0,1000);
 for(const [file,data] of Object.entries({'sources.json':sources,'meta.json':meta,'recent.json':recent,'recent-counts.json':buildWpRecentCounts(all,meta.lastPull)}))await fs.writeFile(join(dir,file),JSON.stringify(data));
 console.log('applied',meta.paperCount);
}
