// Offline browser checks: all-field/facet parity, lazy work, stable sorting and a large FT50 benchmark.
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


  const parity = await page.evaluate(() => {
    resetFilterState(false); ensureScopeSources = function () {};
    const authors = ['Xin Chen', 'Yuxin Chen', 'René Désir', 'Konstantinos Stouras', 'Anastou, Ram Gopalan', 'Ram Gopal, John Smith'];
    allPapers = Array.from({length:360}, (_, i) => ({
      JKey: i % 3 ? 'ms' : 'opre', _jkeys: [i % 3 ? 'ms' : 'opre'], DOI:'10.1000/'+i,
      Title: i % 2 ? 'Inventory marketing' : 'Research search', Authors: authors[i%authors.length],
      Affiliations: i%2 ? 'INSEAD' : 'Other school', Year:String(2020+i%4), Volume:String(i%5),
      Status: i%7 ? '' : 'Articles in Advance', Preprint:i%2 ? 'https://example.org/paper' : '',
      Abstract:i%3 ? 'Supply chain research. This paper was accepted by Jane Editor, operations.' : '',
      _editors:[i%2 ? 'Editor A' : 'Editor B'], _area:i%2 ? 'Operations' : 'Finance',
      _se:[i%3 ? 'Senior A' : 'Senior B'], _ae:[i%4 ? 'Associate A' : 'Associate B']
    }));
    const input = {title:'filterSearch',author:'filterAuthors',affiliation:'filterAffiliations',abstract:'filterAbstracts'};
    function reference(exclude) {
      return allPapers.filter(p => {
        if (exclude !== 'journal' && !matchesJournal(p)) return false;
        if (preprintOnly && !safeUrl(p.Preprint)) return false;
        if (citedByFilter && !citedByFilter.dois.has(refsNormDoi(p.DOI))) return false;
        for(const f of ['editor','area','se','ae','year']) {
          if(f === exclude || !sel[f].size) continue;
          const values = f==='area' ? [p._area] : f==='year' ? [p.Year] : p['_'+(f==='editor'?'editors':f)];
          if(!values.some(v=>sel[f].has(v))) return false;
        }
        for(const [f,prop] of [['title','Title'],['author','Authors'],['affiliation','Affiliations'],['abstract','Abstract']]) {
          const text = f==='abstract' ? cleanAbstract(p.Abstract).toLowerCase() : p[prop].toLowerCase();
          const match = f==='author' ? authorMatch : textMatch;
          const live = document.getElementById(input[f]).value.trim().toLowerCase();
          if(!match(text,live) || !Array.from(sel[f]).every(q=>match(text,q))) return false;
        }
        return Object.values(sel.authorIdentity).every(v=>identityMatch(p.Authors.toLowerCase(),v));
      });
    }
    const cases = [ {}, {title:'search'}, {title:'"search"'}, {title:'""'}, {title:'"search'},
      {author:'stou'}, {author:'desir'}, {author:'"désir"'}, {author:'"desir"'},
      {affiliation:'insead'}, {abstract:'supply'}, {abstract:'accepted by'}, {abstract:'"research"'},
      {identity:['xin chen']}, {identity:['ram gopal']}, {identity:['rené désir','rene desir']},
      {title:'inventory', affiliation:'insead', chips:['marketing']},
      {editor:'Editor A'}, {area:'Finance'}, {se:'Senior A'}, {ae:'Associate A'}, {year:'2021'},
      {editor:'Editor A',year:'2020'}, {area:'Finance',se:'Senior A',ae:'Associate A'},
      {preprint:true}, {citation:true}, {journal:'ms',author:'xin'}, {jtype:'ft50',year:'2022'},
      {journal:'ms',editor:'Editor A',year:'2021',abstract:'research'}
    ];
    let checks=0;
    for(const c of cases) {
      resetFilterState(false);
      for(const f of Object.keys(input)) document.getElementById(input[f]).value = c[f] || '';
      for(const f of ['journal','jtype','editor','area','se','ae','year']) if(c[f])sel[f].add(c[f]);
      if(c.chips)c.chips.forEach(q=>sel.title.add(q));
      if(c.identity)sel.authorIdentity.Person=c.identity;
      preprintOnly=!!c.preprint;
      citedByFilter=c.citation?{dois:new Set(['10.1000/1','10.1000/7']),jkeys:new Set(['ms']),wide:false}:null;
      refreshJournalScope();
      const actual=litCollectSearch(true), expected=reference(null);
      function ids(rows){return rows.map(p=>p.DOI).sort().join('|');}
      if(ids(actual.rows)!==ids(expected))throw Error('results '+JSON.stringify(c));
      for(const f of ['journal','editor','area','se','ae','year']) {
        const counts={};
        reference(f).forEach(p=>{
          const values=f==='journal'?p._jkeys:f==='area'?[p._area]:f==='year'?[p.Year]:p['_'+(f==='editor'?'editors':f)];
          values.forEach(v=>counts[v]=(counts[v]||0)+1);
        });
        if(JSON.stringify(Object.entries(counts).sort())!==JSON.stringify(Object.entries(actual[f]).sort()))throw Error('counts '+f+' '+JSON.stringify(c));
      }
      checks++;
    }
    resetFilterState(false);sel.jtype.add('ft50'); refreshJournalScope();
    let cleaned=0; const absOriginal=absSearchText;
    absSearchText=function(p){cleaned++;return absOriginal(p);};
    applyFilters();
    if(cleaned)throw Error('unused abstracts scanned');
    document.getElementById('filterAbstracts').value='impossible term'; applyFilters();
    if(cleaned)throw Error('raw abstract misses cleaned');
    absSearchText=absOriginal;document.getElementById('filterAbstracts').value='';
    for(const sort of ['year-desc','year-asc','title','editor','year-desc']) {
      document.getElementById('sortBy').value=sort;applyFilters();
      const broad=filtered.slice();document.getElementById('filterAuthors').value='xin';applyFilters();
      const expected=broad.filter(p=>authorMatch(p.Authors.toLowerCase(),'xin'));
      if(filtered.map(p=>p.DOI).join('|')!==expected.map(p=>p.DOI).join('|'))throw Error('cached sort '+sort);
      document.getElementById('filterAuthors').value='';
    }
    applyFilters(); const before=_renderedCount;showMoreCards();
    if(before!==50 || _renderedCount!==150)throw Error('show more');
    const p=allPapers[0];litSearchText(p,'Title');p.Title='Changed';
    if(litSearchText(p,'Title').lower!=='changed')throw Error('metadata cache');
    return checks;
  });
  console.log('PASS results and cascading counts match reference in '+parity+' cases; lazy abstracts, all sorts, metadata edits and Show more');

 const result = await page.evaluate(() => {
   resetFilterState(false); sel.jtype.add('ft50');
   const keys = Array.from(FT50_KEYS);
   allPapers = Array.from({length:200000}, (_,i) => ({JKey:keys[i%keys.length], _jkeys:[keys[i%keys.length]], DOI:'10.1000/'+i,
    Title:i%100===0?'Inventory research':'Other paper '+i, Authors:i%100===0?'Konstantinos Stouras, René Désir':'John Smith, Jane Doe',
    Affiliations:i%100===0?'INSEAD':'University of Somewhere', Abstract:'<jats:p>'+('We investigate operations and supply chain decisions. '.repeat(20))+'</jats:p>',
    Year:String(1980+i%47), Volume:String(i%20), _editors:['Jane Editor'], _se:[], _ae:[], _area:'Operations'}));
   ensureScopeSources = function(){};
   refreshJournalScope(); litPapersInScope();
   const times=[];
   for (const [field,q] of [['',''],['filterAuthors','stouras'],['filterSearch','research'],['filterAffiliations','insead'],['filterAbstracts','supply'],['filterAuthors','"stouras"'],['filterAuthors','desir'],['filterAuthors','stouras'],['filterSearch','research'],['filterAffiliations','insead'],['filterAbstracts','supply'],['','']]) {
     for(const id of ['filterAuthors','filterSearch','filterAffiliations','filterAbstracts'])document.getElementById(id).value='';
     if(field)document.getElementById(field).value=q;
     const collectOriginal=litCollectSearch,renderOriginal=renderPage,dropOriginal=updateDropdownOptions;
     let collectMs=0,renderMs=0,dropMs=0;
     litCollectSearch=function(...args){const t=performance.now();const x=collectOriginal(...args);collectMs+=performance.now()-t;return x;};
     renderPage=function(...args){const t=performance.now();const x=renderOriginal(...args);renderMs+=performance.now()-t;return x;};
     updateDropdownOptions=function(...args){const t=performance.now();const x=dropOriginal(...args);dropMs+=performance.now()-t;return x;};
     const start=performance.now();applyFilters();litCollectSearch=collectOriginal;renderPage=renderOriginal;updateDropdownOptions=dropOriginal;times.push({field,q,ms:performance.now()-start,matches:filtered.length,collectMs,renderMs,dropMs});
   }
   return times;
 });
 for (const timing of result) assert.equal(timing.matches, !timing.field || timing.field === 'filterAbstracts' ? 200000 : 2000);
 console.log('PASS 200,000-paper FT50 benchmark (milliseconds; timings are diagnostic, not machine-dependent assertions)', JSON.stringify(result));
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
