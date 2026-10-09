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
    } else if (/\/lit-(abstract|filter-url|news|search-scope)\.js$/.test(path)) {
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

  // A large previously loaded corpus must not be traversed on each keystroke.
  const stats = await page.evaluate(() => {
    const selected = Array.from({length: 1000}, (_, i) => ({
      JKey: i % 2 ? 'ms' : 'msom', DOI: '10.1000/selected-' + i,
      Title: 'Selected paper ' + i, Authors: 'Konstantinos Stouras', Year: '2026',
      _editors: ['Jane Editor'], _area: 'entrepreneurship and innovation', _se: [], _ae: [],
      _jkeys: [i % 2 ? 'ms' : 'msom']
    }));
    const other = Array.from({length: 200000}, (_, i) => ({
      JKey: 'opre', DOI: '10.1000/other-' + i, Title: 'Other ' + i,
      Authors: 'Konstantinos Stouras', Year: '2025', _jkeys: ['opre'], _editors: [], _se: [], _ae: []
    }));
    allPapers = selected.concat(other); nativeState.opre = 'done';
    refreshJournalScope(); litPapersInScope(); // index once outside the measured pass
    const original = matchesJournal; let visits = 0;
    matchesJournal = function (p) { visits++; return original(p); };
    const start = performance.now(); applyFilters(); const elapsed = performance.now() - start;
    matchesJournal = original;
    return {visits, elapsed, matches: filtered.length, scope: scopeCount, indexed: litIndexedPaperCount};
  });
  assert.equal(stats.matches, 1000); assert.equal(stats.scope, 1000);
  assert.equal(stats.indexed, 201000); assert.ok(stats.visits <= 3000, JSON.stringify(stats));
  console.log('PASS 201,000 loaded papers: only selected rows visited on search', JSON.stringify(stats));
  await page.evaluate(() => toggleDrop('csJournal'));
  assert.match(await page.locator('#csJournal .custom-select-items').innerText(), /Operations Research\s*\(200000\)/);
  await page.evaluate(() => toggleDrop('csJournal'));
  assert.match(await page.locator('#csYear .custom-select-items').innerText(), /2026\s*\(1000\)/);
  console.log('PASS broader journal counts still refresh on opening; years stay scoped');

  // Overlapping PNAS parent/section keys must not duplicate the same paper.
  const pnas = await page.evaluate(() => {
    const paper = {JKey:'pnas', DOI:'10.1000/pnas-test', _jkeys:['pnas','pnas-cs']};
    allPapers = [paper]; sel.jtype.clear(); sel.journal = new Set(['pnas','pnas-cs']);
    refreshJournalScope(); const first = litPapersInScope();
    const extra = {JKey:'pnas', DOI:'10.1000/new', _jkeys:['pnas','pnas-cs']};
    allPapers = allPapers.concat([extra]); litIndexPaperBatch([extra]);
    return [first.length, litPapersInScope().length];
  });
  assert.deepEqual(pnas, [1, 2]); console.log('PASS overlapping sections deduplicate and late arrivals invalidate the cache');

  // Start broadly, narrow while large downloads are pending, then broaden again.
  requests.length = 0;
  await page.goto('https://lit.test/lit/?author=stouras');
  await page.waitForFunction(() => litPaperLoads.opre && litPaperLoads.ejor);
  await page.evaluate(() => addJournalChip('ms'));
  await page.waitForFunction(() => nativeState.opre === 'pending' && extraState.ejor === 'pending');
  assert.equal(await page.evaluate(() => !!nativePromise.opre || !!extraPromise.ejor), false);
  assert.deepEqual(await page.evaluate(() => filtered.map(p => p.JKey)), ['ms']);
  await page.evaluate(() => removeChip('journal', 'ms'));
  await page.waitForFunction(() => nativeState.opre === 'done' && extraState.ejor === 'done');
  assert.ok(requests.filter(p => p.endsWith('papers-opre.json')).length >= 2);
  assert.equal(await page.evaluate(() => allPapers.filter(p => p.JKey === 'ejor').length), 2);
  console.log('PASS unused native/extra downloads cancel, retry, and load all chunk parts');

  // A preference picker's explicit background load is kept outside search scope.
  await page.goto('https://lit.test/lit/?journal=ms&author=stouras');
  await page.waitForFunction(() => sourcesManifest.length > 0);
  await page.evaluate(() => { loadNativeSource('pnas'); applyFilters(); });
  await page.waitForFunction(() => nativeState.pnas === 'done');
  assert.equal(await page.evaluate(() => filtered.every(p => p.JKey === 'ms')), true);
  assert.deepEqual(errors, []);
  console.log('PASS preference loads remain available and no browser errors occur');
} finally { await browser.close(); }
