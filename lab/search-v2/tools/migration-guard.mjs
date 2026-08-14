/* ==========================================================================
   search-v2  ·  tools/migration-guard.mjs
   A participant who is MID-SESSION when a build ships must not lose data.

       node lab/search-v2/tools/migration-guard.mjs

   The registration phase (background: field of study, year or level, age band,
   gender) arrived in 2026-08, and the exit survey's Part F — where those four
   items used to live — went away in the same change. The phase is entered from
   the consent button, so a participant who had ALREADY consented under the
   previous build would have been asked by neither: their background would
   simply be blank, and that is exactly the class playing when a change like
   this deploys.

   So app.js carries two catch-ups, and this pins both:
     · resumed BEFORE the task (instructions, either gate, a block intro) — they
       are routed into the phase, since they have not started yet;
     · resumed once they are IN the rounds — interrupting the task would be
       worse than the old behaviour, so the items come back at the end of the
       exit survey, where they used to be, and are logged as `registration`
       rows so they still land in the same reg_* export column.

   Playwright, offline. Chromium only in this container.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const srv=createServer(async(req,res)=>{let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';
 if(p==='/lab/search-v2/firebase-config.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end("window.FIREBASE_CONFIG={apiKey:'PASTE_API_KEY',projectId:'PASTE_PROJECT_ID'};window.ADMIN_EMAILS=['a@b.c'];window.FIREBASE_SDK_VERSION='10.12.2';");return;}
 try{const b=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end('nf');}});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const BASE=`http://127.0.0.1:${srv.address().port}/lab/search-v2/`;
const br=await chromium.launch({executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium'});
let fails=0;const ok=(c,m,x)=>{console.log((c?'  ok   — ':'  FAIL — ')+m+(c?'':'\n         '+x));if(!c)fails++;};

// CASE 1 — pre-task resume (phase 'instructions'), standalone: must be asked.
{
  const ctx=await br.newContext({viewport:{width:1440,height:1000}});
  await ctx.route(/gstatic\.com|googleapis\.com/,r=>r.abort());
  const pg=await ctx.newPage();
  await pg.goto(BASE+'?code=MIG&pcode=OLD001');
  await pg.waitForSelector('#s-consent.active',{timeout:20000});
  await pg.evaluate(()=>{ // rewrite the saved state to look like the previous build's
    const k='searchv2:v3:state:OLD001';
    const s=JSON.parse(localStorage.getItem(k)||'{}');
    s.phase='instructions'; delete s.reg; delete s.regDone; delete s.regLogged;
    localStorage.setItem(k,JSON.stringify(s));
  });
  await pg.reload();
  await pg.waitForSelector('#s-registration.active, #s-instructions.active',{timeout:20000});
  ok(await pg.locator('#s-registration.active').count()===1,
     'a participant resumed BEFORE the task is caught up into registration');
  await ctx.close();
}
// CASE 2 — resumed mid-ROUNDS: not interrupted, but asked at the survey.
{
  const ctx=await br.newContext({viewport:{width:1440,height:1000}});
  await ctx.route(/gstatic\.com|googleapis\.com/,r=>r.abort());
  const pg=await ctx.newPage();
  await pg.goto(BASE+'?code=MIG&pcode=OLD002');
  await pg.waitForSelector('#s-consent.active',{timeout:20000});
  await pg.evaluate(()=>{
    const k='searchv2:v3:state:OLD002';
    const s=JSON.parse(localStorage.getItem(k)||'{}');
    s.phase='survey'; s.roundPtr=28; s.results=[]; s.totalScore=0;
    delete s.reg; delete s.regDone; delete s.regLogged;
    localStorage.setItem(k,JSON.stringify(s));
  });
  await pg.reload();
  await pg.waitForSelector('#s-survey.active',{timeout:20000});
  const asked=await pg.$$eval('#survey-body .survey-q',els=>els.map(e=>e.dataset.q));
  ok(['f_field','f_year','f_age','f_gender'].every(id=>asked.includes(id)),
     'a participant already past the rounds is asked the background at the end, as they always would have been',
     asked.join(','));
  const part=await pg.$$eval('.survey-part',els=>els.map(e=>e.textContent.trim()));
  ok(part.some(t=>/Background/.test(t)),'and it is labelled',part.join(' | '));
  // answering must land as REGISTRATION rows, not survey ones
  await pg.evaluate(()=>{
    document.querySelectorAll('#survey-body .survey-q').forEach(q=>{
      const r=q.querySelectorAll('input[type=radio]'); if(r.length) r[0].checked=true;
      const c=q.querySelectorAll('input[type=checkbox]'); if(c.length) c[0].checked=true;
      q.querySelectorAll('textarea').forEach(t=>{t.value='x';});
      q.querySelectorAll('input[type=number]').forEach(n=>{n.value='1';});
    });
  });
  await pg.locator('#btn-survey').click();
  await pg.waitForSelector('#s-debrief.active, #s-done.active',{timeout:15000});
  const rows=await pg.evaluate(()=>window.Logger.getEvents()
    .filter(e=>e.event==='registration').map(e=>e.question_id));
  ok(['f_field','f_year','f_age','f_gender'].every(id=>rows.includes(id)),
     'their answers are logged as registration rows, so they reach the same reg_* column',rows.join(','));
  const surveyRows=await pg.evaluate(()=>window.Logger.getEvents()
    .filter(e=>e.event==='survey').map(e=>e.question_id));
  ok(!surveyRows.some(id=>/^f_/.test(id)),'and not duplicated as survey rows',surveyRows.filter(i=>/^f_/.test(i)).join(','));
  await ctx.close();
}
await br.close(); srv.close();
console.log(fails? `\nMIGRATION CHECK FAILED — ${fails}`:'\nMIGRATION CHECK OK');
process.exit(fails?1:0);
