import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('public catalog has descriptions and filters but no source or citation URLs',()=>{
  const text=read('catalog-public.json'),catalog=JSON.parse(text);
  assert.ok(catalog.entries.length>=122);assert.ok(!/https?:\/\//i.test(text));
  for(const e of catalog.entries){assert.ok(e.title&&e.id&&e.topic&&Array.isArray(e.details));assert.ok(!e.url&&!e.descriptionMarkdown);}
});
test('public browser loads only sanitized catalog data',()=>{
  const code=read('app.mjs');assert.ok(code.includes('catalog-public.json'));
  assert.ok(!code.includes('README.md')&&!code.includes('source.md')&&!code.includes('research-additions.json'));
});
test('Jones attribution appears once and only in the footer',()=>{
  const html=read('index.html');assert.equal((html.match(/Todd Jones/g)||[]).length,1);
  assert.ok(html.indexOf('Todd Jones')>html.indexOf('<footer>'));
});
