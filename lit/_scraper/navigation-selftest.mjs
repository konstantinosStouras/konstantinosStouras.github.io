import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { summarise, isAdmin } = require('../lit-website-analytics.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pages = ['index.html','about/index.html','analytics/index.html','feedback/index.html','use-cases/index.html','whats-new/index.html','privacy/index.html','admin/website-analytics/index.html'];
for (const page of pages) {
  const html = read(page);
  const nav = html.match(/<nav class="lit-site-nav"[\s\S]*?<\/nav>/)?.[0];
  assert(nav, page + ': shared navigation');
  for (const route of ['/lit/','/lit/analytics/','/lit/use-cases/','/lit/whats-new/','/lit/feedback/','/lit/about/']) assert(nav.includes('href="' + route + '"'), page + ': ' + route);
  assert(!nav.includes('/privacy/'), 'Privacy belongs in the footer');
  assert(/<footer[\s\S]*?href="\/lit\/privacy\/"/.test(html), page + ': privacy footer');
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/type="(?:application|module)/.test(match[1]) && match[2].trim()) new vm.Script(match[2], {filename:page});
  }
}
assert(!read('about/index.html').includes('id="litWhatsNew"'));
assert(read('whats-new/index.html').includes('LitNews.mount('));
assert(!read('analytics/index.html').includes('id="community"'));
assert(!isAdmin(null));
assert(!isAdmin({email:'kstouras@gmail.com', emailVerified:false}));
assert(!isAdmin({email:'reader@example.com',emailVerified:true}));
assert(isAdmin({email:'kstouras@gmail.com', emailVerified:true}));
const now = Date.UTC(2026,9,13);
const result = summarise([
  {first:Date.UTC(2026,0,1),seen:now - 86400000},
  {first:Date.UTC(2026,9,1),seen:now - 10*86400000},
  {first:0,seen:null},
  {first:now + 86400000,seen:now + 86400000}
], now);
assert.equal(result.new30,1);
assert.equal(result.seen7,1);
assert.equal(result.seen30,2);
assert.equal(result.dated,2);
assert.equal(result.months.at(-1).total,2);
assert.equal(result.months.at(-1).added,1);
assert.equal(result.months.length,12);
// No private reads for signed-out, ordinary or unverified accounts.
for (const user of [null,{email:'reader@example.com',emailVerified:true},{email:'kstouras@gmail.com',emailVerified:false}]) {
  let reads = 0;
  const elements = new Map();
  const document = {getElementById(id) { if (!elements.has(id)) elements.set(id,{textContent:'',hidden:true,replaceChildren(){},addEventListener(){}}); return elements.get(id); }};
  const firebase = { apps:[{}], auth:()=>({onAuthStateChanged:fn=>fn(user)}), firestore:()=>{reads++;throw Error('Unexpected private read');} };
  vm.runInNewContext(read('lit-website-analytics.js'), {window:{firebase},firebase,document});
  assert.equal(reads,0);
  assert.equal(elements.get('usagePanel').hidden,true);
}
console.log('Navigation, page syntax, privacy placement, news relocation, admin authorization and account metrics checks passed.');
