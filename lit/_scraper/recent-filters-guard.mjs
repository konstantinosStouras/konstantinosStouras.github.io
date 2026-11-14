// Offline browser regression for recent-paper facets and shared filter links.
// Run with PW / CHROMIUM overrides as in search-scope-guard.mjs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PW || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], paperRequests = [];
  let recentDelay = 0, recentMissing = false, paperMissing = false;
  page.on('pageerror', e => errors.push(e.message));
  const today = new Date();
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const old = new Date(today); old.setDate(old.getDate() - 40);
  const row = (id, editor, area, date = today, journal = 'ms') => ({
    JKey: journal, DOI: '10.1000/' + id, Title: id + ' paper', Authors: 'Jane Author',
    Year: '2026', Abstract: 'Research', 'Accepting Editor': editor, Area: area, 'Date Added': day(date)
  });
  const rows = [row('a', 'Jane Editor', 'operations management'),
    row('b', 'John Editor', 'finance'), row('c', 'Jane Editor', 'finance'),
    row('unknown', '', ''), row('old', 'Historical Editor', 'accounting', old),
    row('other-journal', 'Other Editor', 'marketing', today, 'opre'),
    {...row('isr-a','','',today,'isre'), 'Senior Editor':'Senior One', 'Associate Editor':'Associate One'},
    {...row('isr-b','','',today,'isre'), 'Senior Editor':'Senior Two', 'Associate Editor':'Associate Two'},
    {...row('marketing-a','','',today,'mksc'), 'Senior Editor':'Senior One'},
    {...row('marketing-b','','',today,'mksc'), 'Senior Editor':'Senior Two'}];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let body = '{}', contentType = 'application/json';
    if (path === '/lit/') {
      body = fs.readFileSync(root + 'index.html', 'utf8').replace(/var ACCOUNTS_ENABLED = !!\([\s\S]*?\);/, 'var ACCOUNTS_ENABLED = false;');
      contentType = 'text/html';
    } else if (/\/lit-(abstract|filter-url|news|search-scope|search-ui)\.js$/.test(path)) {
      body = fs.readFileSync(root + path.split('/').pop(), 'utf8'); contentType = 'text/javascript';
    } else if (url.hostname !== 'lit.test') { body = ''; contentType = 'text/javascript'; }
    else if (recentMissing && path === '/lit/data/recent.json' || paperMissing && path === '/lit/data/papers-ms.json') {
      await route.fulfill({status:404,body:'not found'}); return;
    }
    else if (recentMissing && path === '/lit/data-ft50/sources.json') body = JSON.stringify([{key:'extra',name:'Extra Journal',file:'papers-extra.json',count:1}]);
    else if (recentMissing && path === '/lit/data-ft50/recent.json') body = JSON.stringify([row('extra-feed','','',today,'extra')]);
    else if (path === '/lit/data/sources.json') body = JSON.stringify(['ms', 'opre', 'isre', 'mksc'].map(key => ({ key, file: `papers-${key}.json`, count: 5 })));
    else if (path === '/lit/data/recent.json') {
      if (recentDelay) await new Promise(resolve => setTimeout(resolve, recentDelay));
      body = JSON.stringify(rows);
    } else if (path === '/lit/data/recent-counts.json') body = JSON.stringify({windowDays: 90, days: {ms: {[day(today)]: 40}}});
    else if (/papers-/.test(path)) { paperRequests.push(path); body = JSON.stringify(rows.filter(p => path.endsWith(`papers-${p.JKey}.json`))); }
    else if (path.endsWith('sources.json') || path.endsWith('recent.json') || path.endsWith('affiliations.json')) body = '[]';
    else if (path.endsWith('changelog.json')) body = fs.readFileSync(root + 'changelog.json', 'utf8');
    await route.fulfill({ status: 200, body, contentType });
  });
  const ids = () => page.evaluate(() => filtered.map(p => p.DOI.split('/')[1]).sort());
  const recent = () => page.evaluate(() => recentMode);
  const count = () => page.locator('#resultsCount').innerText();
  await page.goto('https://lit.test/lit/?journal=ms&recent=1');
  await page.waitForFunction(() => recentData !== null && filtered.length === 4 && recentCountSets.length);
  assert.deepEqual(paperRequests, []);
  assert.match(await page.locator('#csEditor .custom-select-items').innerText(), /Jane Editor\s*\(2\)/);
  assert.match(await page.locator('#csArea .custom-select-items').innerText(), /finance\s*\(2\)/);
  assert.doesNotMatch(await page.locator('#csEditor .custom-select-items').innerText(), /Historical|Other Editor/);
  assert.match(await count(), /40 papers.*showing the newest 4/);
  console.log('PASS cold recent link populates date- and journal-scoped facets without full downloads');

  await page.locator('#csEditor .custom-select-trigger').click();
  await page.locator('#csEditor .custom-select-item').filter({hasText: 'Jane Editor'}).click();
  assert.equal(await recent(), true);
  assert.deepEqual(await ids(), ['a', 'c']);
  assert.match(await count(), /^2 papers.*matches in the newest available slice/);
  assert.match(await page.locator('#csArea .custom-select-items').innerText(), /finance\s*\(1\)/);
  await page.locator('#csArea .custom-select-trigger').click();
  await page.locator('#csArea .custom-select-item').filter({hasText: 'finance'}).click();
  assert.deepEqual(await ids(), ['c']);
  assert.match(await count(), /^1 paper added/);
  assert.equal(new URL(page.url()).searchParams.get('recent'), '1');
  const shared = page.url();
  recentDelay = 300;
  await page.goto(shared);
  await page.waitForFunction(() => recentData !== null && filtered.length === 1);
  assert.deepEqual(await ids(), ['c']);
  assert.equal(await page.evaluate(() => sel.editor.has('Jane Editor') && sel.area.has('finance')), true);
  console.log('PASS editor AND area refine recent results, counts cascade, and shared links survive delayed data');

  await page.evaluate(() => removeChip('editor', 'Jane Editor'));
  assert.deepEqual(await ids(), ['b', 'c']);
  await page.evaluate(() => removeChip('area', 'finance'));
  assert.deepEqual(await ids(), ['a', 'b', 'c', 'unknown']);
  assert.equal(await recent(), true);
  await page.evaluate(() => { sel.area.add('accounting'); renderChips('area'); applyFilters(); });
  assert.deepEqual(await ids(), []);
  assert.match(await page.locator('#papersList').innerText(), /No papers match these filters/);
  assert.match(await page.locator('#csEditor .custom-select-empty').innerText(), /No matching editor information/);
  await page.locator('#recentBtn').click();
  await page.waitForFunction(() => nativeState.ms === 'done' && filtered.length === 1);
  assert.deepEqual(await ids(), ['old']);
  await page.locator('#recentBtn').click();
  assert.equal(await recent(), true);
  assert.deepEqual(await ids(), []);
  assert.equal(await page.evaluate(() => sel.area.has('accounting')), true);
  console.log('PASS chip removal, missing metadata, empty matches, and all/recent toggles preserve refinements');

  await page.evaluate(() => removeChip('area', 'accounting'));
  await page.locator('#filterSearch').fill('b paper');
  await page.waitForFunction(() => filtered.length === 1 && filtered[0].Title === 'b paper');
  assert.equal(await recent(), true);
  await page.reload();
  await page.waitForFunction(() => recentData !== null && filtered.length === 1);
  assert.deepEqual(await ids(), ['b']);
  await page.evaluate(() => clearFilters());
  assert.equal(await recent(), false);
  assert.equal(new URL(page.url()).search, '');
  assert.deepEqual(errors, []);
  console.log('PASS text refinements reload, Clear exits recent mode, and no browser errors occur');

  await page.goto('https://lit.test/lit/?journal=isre&recent=1');
  await page.waitForFunction(() => recentData !== null && filtered.length === 2);
  await page.locator('#csSE .custom-select-trigger').click();
  await page.locator('#csSE .custom-select-item').filter({hasText:'Senior One'}).click();
  await page.locator('#csAE .custom-select-trigger').click();
  await page.locator('#csAE .custom-select-item').filter({hasText:'Associate One'}).click();
  assert.deepEqual(await ids(),['isr-a']); assert.equal(await recent(),true);
  await page.reload();
  await page.waitForFunction(() => recentData !== null && filtered.length === 1);
  assert.deepEqual(await ids(),['isr-a']);
  await page.locator('#recentBtn').click();
  await page.waitForFunction(() => nativeState.isre === 'done');
  assert.deepEqual(await ids(),['isr-a']);
  await page.goto('https://lit.test/lit/?journal=mksc&recent=1&se=Senior+Two');
  await page.waitForFunction(() => recentData !== null && filtered.length === 1);
  assert.deepEqual(await ids(),['marketing-b']);
  assert.equal(await page.locator('#groupAE').isVisible(),false);
  await page.goto('https://lit.test/lit/?journal=ms&journal=isre&journal=mksc&journal=opre&area=finance&se=Senior+One&ae=Associate+One&recent=1');
  await page.waitForFunction(() => recentData !== null && filtered.length === 5);
  assert.deepEqual(await ids(),['b','c','isr-a','marketing-a','other-journal']);
  await page.locator('#recentBtn').click();
  await page.waitForFunction(() => ['ms','isre','mksc','opre'].every(k=>nativeState[k]==='done') && filtered.length === 5);
  assert.deepEqual(await ids(),['b','c','isr-a','marketing-a','other-journal']);
  assert.deepEqual(errors,[]);
  console.log('PASS ISR SE+AE, Marketing Science SE, recent/all toggles, reloads and mixed-journal editorial scope');

  recentMissing = true;
  await page.goto('https://lit.test/lit/?journal=ms&journal=extra&recent=1');
  await page.waitForFunction(()=>!recentLoading && nativeState.ms==='done' && recentExtraSets.length);
  await page.waitForTimeout(800);
  assert((await ids()).includes('extra-feed'), 'native recent-file outage must preserve other datasets');
  await page.evaluate(()=>{sel.journal.clear();sel.journal.add('opre');renderRecent();});
  await page.waitForFunction(()=>nativeState.opre==='done' && filtered.length===1);
  assert.deepEqual(await ids(),['other-journal']);
  console.log('PASS missing native recent feed preserves satellite rows and loads newly selected journals');

  paperMissing = true;
  await page.goto('https://lit.test/lit/?journal=ms&recent=1');
  await page.waitForFunction(()=>nativeState.ms==='missing');
  await page.waitForTimeout(800);
  assert.doesNotMatch(await page.locator('#papersList').innerText(), /Loading recently added/);
  assert.match(await page.locator('#papersList').innerText(), /could not be loaded/);
  assert.deepEqual(errors,[]);
  console.log('PASS missing fallback files report unavailable data instead of an endless spinner');
} finally { await browser.close(); }
