// Offline browser checks: scope, counts, indexing and cancellation/reloading.
// PW and CHROMIUM select the installed Playwright package and browser.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PW || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], requests = [];
  const hits = {};
  page.on('pageerror', e => errors.push(e.message));
  const row = (key, year = '2026') => ({ JKey: key, DOI: '10.1000/' + key,
    Title: key + ' paper', Authors: 'Konstantinos Stouras', Year: year,
    Area: 'entrepreneurship and innovation', 'Accepting Editor': 'Jane Editor',
    Abstract: 'Research', Affiliations: 'INSEAD', Sections: ['Computer Sciences'] });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let body = '{}', type = 'application/json';
    if (path === '/lit/') {
      body = fs.readFileSync(root + 'index.html', 'utf8').replace(/var ACCOUNTS_ENABLED = !!\([\s\S]*?\);/, 'var ACCOUNTS_ENABLED = false;');
      type = 'text/html';
    } else if (/\/lit-(abstract|filter-url|news|search-scope|search-ui)\.js$/.test(path)) {
      body = fs.readFileSync(root + path.split('/').pop(), 'utf8'); type = 'text/javascript';
    } else if (url.hostname !== 'lit.test') { body = ''; type = 'text/javascript'; }
    else if (path === '/lit/data/sources.json') body = JSON.stringify(['ms', 'msom', 'opre', 'pnas'].map(key => ({ key, file: 'papers-' + key + '.json', count: 1 })));
    else if (path === '/lit/data-ft50/sources.json') body = JSON.stringify([{key: 'ejor', name: 'EJOR', count: 2, file: 'papers-ejor.json', files: ['papers-ejor.json', 'papers-ejor-2.json']}]);
    else if (path.endsWith('sources.json') || path.endsWith('recent.json') || path.endsWith('affiliations.json')) body = '[]';
    else if (path.endsWith('changelog.json')) body = fs.readFileSync(root + 'changelog.json', 'utf8');
    else if (/papers-/.test(path)) {
      requests.push(path); hits[path] = (hits[path] || 0) + 1;
      if (hits[path] === 1 && /papers-(opre|ejor|pnas)/.test(path)) await new Promise(r => setTimeout(r, 800));
      const key = path.match(/papers-([a-z]+)/)[1];
      body = JSON.stringify([row(key, path.endsWith('-2.json') ? '2025' : '2026')]);
    }
    try { await route.fulfill({status: 200, body, contentType: type}); } catch { /* canceled request */ }
  });
  await page.goto('https://lit.test/lit/?journal=ms&journal=msom&author=stouras');
  await page.waitForFunction(() => nativeState.ms === 'done' && nativeState.msom === 'done' && filtered.length === 2);
  assert.deepEqual(requests.sort(), ['/lit/data/papers-ms.json', '/lit/data/papers-msom.json']);
  assert.equal(await page.evaluate(() => filtered.length), 2);
  console.log('PASS two selected journals download only their own paper files');


  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForFunction(()=>!document.getElementById('litSearchSummary').classList.contains('lit-search-reading'));
  assert.equal(await page.locator('#litRefineButton').isVisible(),false);
  assert.equal(await page.locator('#litActiveFilters').isVisible(),false);
  assert.equal(await page.locator('#filtersToggle').count(),0);
  assert.equal(await page.locator('#litSearchSummary').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  console.log('PASS original count/sort row before scrolling; no additional white bar or View results row');
  await page.evaluate(() => {
    allPapers = Array.from({length:100},(_,i)=>({JKey:'ms',_jkeys:['ms'],DOI:'10.1/'+i,Title:'A research paper about supply chains '+i,Authors:'Konstantinos Stouras',Year:'2026',Abstract:'Supply chains',_editors:[],_se:[],_ae:[]}));
    applyFilters();litViewResults();
  });
  await page.waitForFunction(()=>document.getElementById('litSearchSummary').getBoundingClientRect().top<2);
  assert.ok(await page.evaluate(()=>document.querySelector('.topbar').getBoundingClientRect().bottom<=1));
  assert.ok(await page.locator('#litSearchSummary').evaluate(e=>e.offsetHeight)<110);
  const initial=await page.evaluate(()=>({scroll:scrollY}));
  await page.locator('#litRefineButton').click();
  await page.waitForFunction(()=>document.getElementById('litRefineDialog').open);
  assert.equal(await page.locator('#litRefineDialog #filterAuthors').count(),1);
  assert.equal(await page.locator('#filterAuthors').count(),1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('litRefineDialog').open);
  await page.waitForFunction(()=>document.querySelector('#litFiltersHome #filterAuthors'));
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-initial.scroll)<2);
  assert.equal(await page.locator('#litFiltersHome #filterAuthors').count(),1);
  await page.getByRole('button',{name:'Edit Author: stouras',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'filterAuthors');
  await page.locator('#filterAuthors').fill('nobody matches');
  await page.waitForFunction(()=>filtered.length===0);
  assert.match(page.url(),/author=nobody/);
  await page.locator('#filterAuthors').fill('stouras');
  await page.waitForFunction(()=>filtered.length===100);
  await page.locator('#litRefineDialog').getByText('Title, abstract, affiliation & citations',{exact:true}).click();
  await page.locator('#filterSearch').fill('supply');
  await page.locator('#litRefineDone').click();
  await page.waitForFunction(()=>!document.getElementById('litRefineDialog').open);
  assert.equal(await page.locator('#filterSearch').inputValue(),'supply');
  assert.match(page.url(),/title=supply/);
  await page.locator('#litRefineButton').click();
  await page.locator('#csJournal .custom-select-trigger').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#litRefineDialog').evaluate(d=>d.open),true);
  assert.equal(await page.locator('#csJournal .custom-select-dropdown').evaluate(d=>d.classList.contains('open')),false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('litRefineDialog').open);
  await page.locator('#litRefineButton').click();
  await page.locator('#litRefineDialog').getByRole('button',{name:'Clear',exact:true}).click();
  await page.locator('#litRefineDone').click();
  await page.waitForFunction(()=>!document.getElementById('litRefineDialog').open);
  assert.equal(new URL(page.url()).search,'');
  assert.equal(await page.locator('#litActiveFilters button').count(),0);
  console.log('PASS sticky compact bar, single live form, clickable filters, URL sync, Clear, Escape and reading position');
  if(process.env.UI_SCREENSHOT) await page.screenshot({path:process.env.UI_SCREENSHOT,fullPage:false});
  await page.evaluate(()=>{sel.journal.add('ms');document.getElementById('filterAuthors').value='stouras';applyFilters();litViewResults();});
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:800});
    await page.evaluate(()=>litViewResults());
    await page.waitForFunction(()=>document.getElementById('litSearchSummary').classList.contains('lit-search-reading'));
    await page.locator('#litRefineButton').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box=await page.locator('#litRefineDialog').boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.height<=800);
    await page.locator('#filterAuthors').fill('stouras');
    await page.locator('#litRefineDone').click();
    await page.waitForFunction(()=>!document.getElementById('litRefineDialog').open);
  }
  await page.evaluate(()=>document.body.classList.add('lit-lib-mode'));
  assert.equal(await page.locator('#litRefineButton').isVisible(),false);
  await page.evaluate(()=>document.body.classList.remove('lit-lib-mode'));
  assert.equal(await page.locator('#litRefineButton').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS mobile filter sheet, no horizontal overflow, private-library isolation and no browser errors');
}finally{await browser.close();}
