import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog,filterEntries} from '../catalog.mjs';
const source=readFileSync(new URL('../source.md',import.meta.url),'utf8');
const rows=parseCatalog(source);
test('keeps real entries including uneven indentation, excludes drafts and source-paper bullets',()=>{
  assert.equal(rows.length,119);assert.equal(new Set(rows.map(e=>e.topic)).size,30);
  assert.ok(rows.some(e=>e.title.startsWith('Household Pulse')));
  assert.ok(!rows.some(e=>/^Test |^From /.test(e.title)));assert.ok(rows.every(e=>/^https?:/.test(e.url)));
});
test('preserves supplementary links embedded in the root description',()=>{
  const row=rows.find(e=>e.title==='Business Dynamic Statistics');assert.ok(row.links.length>=7);
});
test('combined filters use intersection and saved datasets remain local selections',()=>{
  const result=filterEntries(rows,{topic:'Time Use',access:'Public'});assert.equal(result.length,1);
  assert.equal(filterEntries(rows,{view:'saved'},[rows[0].id]).length,1);
  assert.equal(filterEntries(rows,{q:'no-such-dataset-xyz'}).length,0);
  assert.ok(filterEntries(rows,{tool:'API'}).length>0);assert.ok(filterEntries(rows,{q:'climate'}).length>0);
});
test('year coverage uses source ranges and separates individual listed years',()=>{
  const census=rows.find(e=>e.title==='US Census names');assert.ok(filterEntries([census],{year:2000}).length);
  assert.equal(filterEntries([census],{year:2005}).length,0);
  assert.ok(filterEntries(rows,{year:2010}).every(e=>e.ranges.some(([a,b])=>2010>=a&&2010<=b)));
});
