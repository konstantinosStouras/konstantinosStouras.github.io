/* Offline integration test. Supply PW, ANALYSIS_FIXTURES and ANALYSIS_OUTPUT.
   Fixtures: responses-audit.csv, chart.js, jspdf.js. No Google writes occur. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PW||'playwright');
const root=path.resolve(__dirname,'..'),fixtures=process.env.ANALYSIS_FIXTURES,out=process.env.ANALYSIS_OUTPUT;
if(!fixtures||!out)throw Error('Fixture and output directories required');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(name==='/'&&process.env.INDEX_FILE?process.env.INDEX_FILE:file));}catch{res.writeHead(404);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
try{
const context=await browser.newContext({viewport:{width:1360,height:1000}});let posts=[],errors=[];let failCSV=false;
await context.route('**/cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(fixtures,route.request().url().includes('chart.js')?'chart.js':'jspdf.js'),'utf8')}));
await context.route('**/fonts.googleapis.com/**',r=>r.abort());await context.route('**/simulation/prefill.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
const imported=JSON.parse(fs.readFileSync(path.join(fixtures,'historical-import.json'),'utf8'));
let savedDocuments=new Map(),loseSaveResponse=false,loseReceipt=false;
await context.route('**/docs.google.com/**',()=>{throw Error('Unexpected Sheets dependency');});
await context.route('**/script.google.com/**',()=>{throw Error('Unexpected Apps Script dependency');});
await context.route('**/www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:r.request().url().endsWith('firebase-app.js')?"export const getApps=()=>[];export const initializeApp=()=>({});":"export const getAuth=()=>({});export const inMemoryPersistence={};export const setPersistence=async()=>{};export const signInAnonymously=async()=>({user:{uid:'test-owner',getIdToken:async()=>'test-token'}});"}));
await context.route('**/firestore.googleapis.com/**',r=>{
 const request=r.request(),url=new URL(request.url());if(failCSV)return r.abort();
 if(request.method()==='POST'){const fields=JSON.parse(request.postData()).fields;posts.push(fields);const id=url.searchParams.get('documentId'),name=url.pathname+'/'+id;if(savedDocuments.has(id))return r.fulfill({status:409,body:'{}'});const document={name,fields,createTime:new Date().toISOString()};savedDocuments.set(id,document);if(loseSaveResponse){loseSaveResponse=false;return r.abort();}return r.fulfill({contentType:'application/json',body:JSON.stringify(document)});}
 if(url.pathname.includes('/problemSolvingResponses/')){if(loseReceipt)return r.abort();const document=savedDocuments.get(url.pathname.split('/').pop());return r.fulfill({status:document?200:404,contentType:'application/json',body:JSON.stringify(document||{})});}
 const docs=url.pathname.endsWith('problemSolvingLegacy')?imported.records.map(x=>({name:x.id,fields:{rowJson:{stringValue:JSON.stringify(x.row)}}})):[];
 return r.fulfill({contentType:'application/json',body:JSON.stringify({documents:docs})});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
async function play(url=base+'?preview=1&key=stouras',rule='double each number in sequence'){
 await page.goto(url);await page.locator('#n0').fill('1x');await page.locator('#n1').fill('2');await page.locator('#n2').fill('4');await page.locator('#check-btn').click();assert.equal(await page.locator('.guess-row').count(),0);
 for(const seq of [[1,2,4],[3,6,12]]){for(let i=0;i<3;i++)await page.locator('#n'+i).fill(String(seq[i]));await page.locator('#check-btn').click();}
 await page.locator('#rule-input').fill(rule);await page.locator('input[name=confidence][value="5"]').check();await page.locator('#submit-btn').click();await page.waitForSelector('#analysis-coverage');
}
await play();assert.equal(posts.length,0);assert.equal(await page.locator('#ps-ribbon').isVisible(),true);
assert.ok((await page.locator('#outcome-section').innerText()).includes('left the doubling explanation unchallenged'));
const model=await page.evaluate(()=>AnalysisView.state.report);assert.equal(model.player.conf,5);assert.equal(model.player.evidence.coverage,1);assert.equal(model.historyN,359);assert.equal(model.reviewedN,346);assert.equal(model.metrics[0].tailN,18);
await page.screenshot({path:path.join(out,'game-desktop.png'),fullPage:true});await page.locator('#outcome-section').screenshot({path:path.join(out,'guide-scorecard-new.png'),style:'#ps-ribbon, #toast {visibility:hidden}'});await page.locator('#class-results').screenshot({path:path.join(out,'guide-results-new.png'),style:'#ps-ribbon, #toast {visibility:hidden}'});
const pdf=await page.evaluate(async()=>{const p=await AnalysisView.makePDF();return p.output('datauristring');});fs.writeFileSync(path.join(out,'updated-report.pdf'),Buffer.from(pdf.split(',')[1],'base64'));
await page.locator('#analysis-details summary').click();assert.equal(await page.locator('#analysis-attempts').isVisible(),true);
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'game-mobile.png'),fullPage:true});
await play(base);await page.waitForFunction(()=>AnalysisView.state.save==='Response saved.');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].eventsJson.stringValue).length,2);assert.ok(posts[0].owner.stringValue);assert.equal(await page.evaluate(()=>AnalysisView.state.report.sampleN),386);
await page.goto(base+'?preview');await page.waitForSelector('#analysis-coverage');assert.equal(posts.length,1);
failCSV=true;await play(base+'?preview=1&key=stouras','<img src=x onerror=alert(1)>');assert.equal(await page.locator('#outcome-section img').count(),0);assert.equal(await page.evaluate(()=>AnalysisView.state.report.metrics[0].n),0);assert.ok((await page.locator('#class-results').innerText()).includes('Unavailable'));assert.equal(posts.length,1);
failCSV=false;loseSaveResponse=true;loseReceipt=true;await play(base);await page.getByRole('button',{name:'Retry saving'}).waitFor();const documentsBefore=savedDocuments.size;loseReceipt=false;await page.getByRole('button',{name:'Retry saving'}).click();await page.waitForFunction(()=>AnalysisView.state.save==='Response saved.');assert.equal(savedDocuments.size,documentsBefore);
await page.goto(base+'#admin');await page.locator('#data-tab').click();failCSV=false;await page.locator('#admin-refresh').click();await page.waitForFunction(()=>document.getElementById('admin-status').textContent.includes('all 386'));assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,previewPosts:0,normalMockPosts:posts.length,historyN:model.historyN,pdf:path.join(out,'updated-report.pdf')}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

