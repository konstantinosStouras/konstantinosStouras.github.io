import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchesCriteria, evaluateAlert, evaluateFeatures, makeCtx } from './alerts-mailer.mjs';
import { paperReceiptUpdate, frequencyDue } from './alerts-delivery.mjs';
import { ensureAlertCoverage, mergeRecentDatasets, fetchDatasetJson, loadAlertDatasets } from './alerts-data.mjs';
const ctx = makeCtx();
const row = (id, key = 'ms', more = {}) => ({ DOI:'10.1/' + id, JKey:key, Title:id,
  Authors:'Jane Doe', Year:'2026', 'Date Added':'2026-11-14', _added:new Date('2026-11-14T00:00:00Z'), ...more });
const criteria = {journal:['ms','isre','mksc','opre'], area:['finance'], se:['Senior'], ae:['Associate']};
assert.equal(matchesCriteria(row('ms','ms',{Area:'finance'}), criteria, ctx),true);
assert.equal(matchesCriteria(row('wrong','ms',{Area:'accounting'}), criteria, ctx),false);
assert.equal(matchesCriteria(row('isre','isre',{'Senior Editor':'Senior','Associate Editor':'Associate'}),criteria,ctx),true);
assert.equal(matchesCriteria(row('wrong','isre',{'Senior Editor':'Senior','Associate Editor':'Other'}),criteria,ctx),false);
assert.equal(matchesCriteria(row('mksc','mksc',{'Senior Editor':'Senior'}),criteria,ctx),true);
assert.equal(matchesCriteria(row('opre','opre'),criteria,ctx),true);
assert.equal(matchesCriteria(row('opre','opre'),{area:['finance']},ctx),false);
assert.equal(matchesCriteria(row('out','pom'),criteria,ctx),false);
assert.equal(matchesCriteria(row('author','ms',{Authors:'J. Doe'}),{author:['jane doe'],authorIdentity:{'jane doe':['jane doe','j. doe']}},ctx),true);
assert.equal(matchesCriteria(row('case'),{author:['JANE DOE'],title:['CASE']},ctx),true);
console.log('PASS MS, ISR and Marketing Science editorial scope, author aliases and case-insensitive criteria');

const morning = new Date('2026-11-14T08:00:00Z'), evening = new Date('2026-11-14T18:00:00Z'), tomorrow = new Date('2026-11-15T09:00:00Z');
let alert = {frequency:'immediate',criteria:{allPapers:true},createdAt:morning};
const a = row('a'), b = row('b'), c = row('c','ms',{'Date Added':'2026-11-15',_added:new Date('2026-11-15T00:00:00Z')});
let evaluation = evaluateAlert(alert,[a],morning,ctx);
assert.deepEqual(evaluation.matches.map(p=>p.Title),['a']);
alert = {...alert,...paperReceiptUpdate(alert,evaluation.matches,morning,null),lastCheckedAt:morning};
evaluation = evaluateAlert(alert,[a,b],evening,ctx);
assert.deepEqual(evaluation.matches.map(p=>p.Title),['b']);
alert = {...alert,...paperReceiptUpdate(alert,evaluation.matches,evening,morning),lastCheckedAt:evening};
assert.equal(evaluateAlert(alert,[a,b],evening,ctx).matches.length,0);
assert.deepEqual(evaluateAlert(alert,[a,b,c],tomorrow,ctx).matches.map(p=>p.Title),['c']);
const late = row('late');
assert.deepEqual(evaluateAlert(alert,[a,b,late,c],tomorrow,ctx).matches.map(p=>p.Title),['late','c']);
assert.equal(evaluateAlert({frequency:'immediate',criteria:{allPapers:true},lastCheckedAt:morning},[a],evening,ctx).matches.length,0);
assert.equal(frequencyDue('daily',morning,null,evening),false);
assert.equal(frequencyDue('daily',morning,null,tomorrow),true);
assert.equal(frequencyDue('weekly',morning,null,tomorrow),false);
console.log('PASS same-day and overnight arrivals, no duplicate receipts, legacy migration and separate frequencies');
const feature = {id:'first',title:'First update',_added:a._added};
const receipt = paperReceiptUpdate({},[{...feature,DOI:feature.id}],morning,null);
const featureAlert = {frequency:'immediate',criteria:{features:true},lastFeatureCheckedAt:morning,
  featureReceiptVersion:1,lastCheckedFeatureIds:receipt.lastCheckedPaperIds};
assert.deepEqual(evaluateFeatures(featureAlert,[feature,{...feature,id:'second'}],evening).features.map(f=>f.id),['second']);
console.log('PASS a later feature update on the same day is delivered without repeating the first');

let reads = [];
const native = {ds:'native',sources:[{key:'ms',file:'papers-ms.json'},{key:'opre',file:'papers-opre.json'}],recent:[a],
  tally:{windowDays:90,days:{ms:{'2026-11-14':2},opre:{'2026-11-14':1}}},
  read:async file=>{reads.push(file);return [a,b];}};
const windows = [{scope:new Set(['ms']),start:new Date('2026-11-13T00:00:00Z')}];
let papers = await ensureAlertCoverage([native],windows,evening);
assert.deepEqual(reads,['papers-ms.json']); assert.equal(papers.length,2);
const science = {ds:'science',sources:[{key:'science',files:['part-1.json','part-2.json']}],recent:[],tally:null,
  read:async file=>[row(file,'science')]};
papers = await ensureAlertCoverage([science],[{scope:new Set(['science']),start:new Date('2026-11-13')}],evening);
assert.equal(papers.length,2);
assert.equal(mergeRecentDatasets([{ds:'native',recent:[a]},{ds:'ft50',recent:[{...a,DOI:'https://doi.org/10.1/a'}]}]).length,1);
await assert.rejects(()=>ensureAlertCoverage([{...native,recent:[],read:async()=>{throw new Error('offline');}}],windows,evening),/offline/);
await assert.rejects(()=>ensureAlertCoverage([{...native,recent:[],read:async()=>[a]}],windows,evening),/Incomplete/);
await assert.rejects(()=>loadAlertDatasets([{ds:'missing',dir:'/a-directory-that-does-not-exist'}]));
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async()=>({ok:false,status:503});
  await assert.rejects(()=>fetchDatasetJson('https://example.test/recent.json'),/503/);
  globalThis.fetch = async()=>({ok:false,status:404});
  assert.equal(await fetchDatasetJson('https://example.test/counts.json',true),null);
  await assert.rejects(()=>fetchDatasetJson('https://example.test/recent.json'),/404/);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS capped feeds, chunked sources, optional tally fallback and fail-before-checkpoint on incomplete data');

const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const mailer = fs.readFileSync(new URL('./alerts-mailer.mjs',import.meta.url),'utf8');
const shardBlock = html.slice(html.indexOf('const SHARDS = ['),html.indexOf('];',html.indexOf('const SHARDS = [')));
for (const [,repo] of shardBlock.matchAll(/\/(lit-data-[a-z0-9-]+)\/data\//g)) assert.ok(mailer.includes(`'${repo}'`),repo);
console.log('PASS every website satellite dataset is also loaded by the mailer');
