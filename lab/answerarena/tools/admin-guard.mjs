/* ==========================================================================
   Answer Arena — admin guard (offline, Playwright; no network)
       node lab/answerarena/tools/admin-guard.mjs
   A participant the admin DELETED must never appear in a data export. The
   deletion hard-deletes their doc, so "deleted" == "absent from the live
   participants collection"; exportExcel intersects with that collection, so
   even a caller handing it a stale list cannot leak a removed account.
   It also covers the roster: a student who registered twice has TWO accounts
   and must be shown as one card listing both, each individually removable.
   Drives the REAL exportExcel / buildUsersCard with the store stubbed and
   SheetJS served locally (the CDN is not reachable offline).
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const srv = createServer(async (req,res)=>{ let p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(p.endsWith('/'))p+='index.html';
  try{const b=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b);}
  catch{res.writeHead(404);res.end('x');}});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const BASE=`http://127.0.0.1:${srv.address().port}`;
let fails=0; const ok=(c,m)=>{console.log((c?'  ok — ':'  FAIL — ')+m); if(!c)fails++;};

const XLSX_STUB = `
export const utils = {
  book_new: () => ({ SheetNames: [], Sheets: {} }),
  json_to_sheet: (rows) => ({ __rows: rows }),
  aoa_to_sheet: (rows) => ({ __rows: rows }),
  book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  sheet_to_csv: () => '',
  sheet_to_json: (ws) => (ws && ws.__rows) || [],
  decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
  encode_cell: () => 'A1',
};
export function writeFile() {}
export function write() { return new Uint8Array(); }
export default { utils, writeFile, write };`;
const br=await chromium.launch({executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium'});
const ctx=await br.newContext();
await ctx.route('**/cdn.sheetjs.com/**', r => r.fulfill({ contentType:'text/javascript', body: XLSX_STUB }));
const pg=await ctx.newPage();
pg.on('console', m => { if (m.text().includes('[arena]')) console.log('     ' + m.text()); });
await pg.goto(BASE+'/lab/answerarena/?admin');
// Stub the store: KEPT still exists, GONE was deleted (absent from listParticipants).
await pg.evaluate(() => {
  const mk = (id, pid) => ({ _id:id, participantId:pid, status:'done', createdAt:1,
    completedSessions:{s1:1}, playedSessions:{s1:1}, sessionId:'s1', condition:{}, registration:{} });
  window.__KEPT = mk('KEEPME','111'); window.__GONE = mk('DELETED','222');
  window.ArenaStore.listParticipants = () => Promise.resolve([window.__KEPT]);   // GONE was deleted
  window.ArenaStore.listSessions = () => Promise.resolve([{ id:'s1', code:'SGP', status:'open' }]);
  window.ArenaStore.loadActiveTasks = () => Promise.resolve({ tasks: [] });
  window.ArenaStore.listResponses = (u) => Promise.resolve([{ taskId:'t1', idx:0, sessionId:'s1', choice:'left', chosenOutput:'o1', ts:1 }]);
  window.ArenaStore.listEvents = () => Promise.resolve([]);
  window.ArenaStore.listSurveys = (u) => Promise.resolve([{ id:'s1', answers:{ q1:'yes' } }]);
});
// Call the REAL exportExcel with a STALE list that still contains the deleted user.
const sheets = await pg.evaluate(async () => {
  const fn = window.__arenaExportExcel;
  if (!fn) return { err: 'exportExcel not exposed' };
  const out = await fn([window.__KEPT, window.__GONE], { returnSheets: true });
  const txt = {};
  Object.keys(out).forEach(k => { txt[k] = JSON.stringify(out[k]); });
  return txt;
});
if (sheets.err) { console.log('  FAIL — ' + sheets.err); fails++; }
else {
  const all = Object.values(sheets).join('|');
  ok(all.includes('KEEPME'), 'a live participant IS in the export');
  ok(!all.includes('DELETED'), 'a DELETED participant is NOT in the export, even though the caller passed them in');
  ok(!all.includes('"222"') && !all.includes(':"222"'), 'the deleted participant_id does not appear either');
}
/* ---- Roster: one student, TWO anonymous accounts ------------------------
   A student who registers twice gets two participant docs. They must appear
   as ONE card that lists BOTH accounts individually, each with its own
   Delete, so a stale account can be removed while the played one is kept. */
const deleted = [];
await pg.evaluate(() => {
  const mk = (id, pid, at) => ({ _id:id, participantId:pid, status:'done', createdAt:at,
    completedSessions:{s1:1}, playedSessions:{s1:1}, sessionId:'s1', condition:{}, registration:{} });
  window.__deleted = [];
  window.ArenaStore.listParticipants = () => Promise.resolve([
    mk('ACC_OLD','25266811',1), mk('ACC_NEW','25266811',2), mk('SOLO','999',3),
  ]);
  window.ArenaStore.deleteParticipant = (id) => { window.__deleted.push(id); return Promise.resolve(); };
  const card = window.__arenaBuildUsersCard();
  card.id = 'test-users-card';
  document.body.appendChild(card);
});
await pg.waitForFunction(() => /2 accounts/.test(document.getElementById('test-users-card').textContent), null, { timeout: 8000 });
const txt = await pg.textContent('#test-users-card');
ok(/1 duplicate account\(s\) folded in/.test(txt), 'the duplicate is folded into one card, and said so');
ok(txt.includes('ACC_OLD') && txt.includes('ACC_NEW'), 'BOTH account_ids are listed, so neither is hidden');
const perAcct = await pg.evaluate(() =>
  [...document.querySelectorAll('#test-users-card .aa-row')]
    .filter(r => /ACC_OLD|ACC_NEW/.test(r.textContent) && r.querySelector('button')).length);
ok(perAcct === 2, 'each account has its own Delete row (got ' + perAcct + ')');
// Delete ONLY the stale account.
pg.on('dialog', d => d.accept());
await pg.evaluate(() => {
  const row = [...document.querySelectorAll('#test-users-card .aa-row')].find(r => /ACC_OLD/.test(r.textContent) && r.querySelector('button'));
  row.querySelector('button').click();
});
await pg.waitForFunction(() => window.__deleted.length > 0, null, { timeout: 8000 });
const gone = await pg.evaluate(() => window.__deleted);
ok(gone.length === 1 && gone[0] === 'ACC_OLD', 'deleting one account removes ONLY that account (' + gone.join(',') + ')');

await br.close(); srv.close();
console.log(fails ? `\nARENA ADMIN GUARD FAILED (${fails})` : '\nARENA ADMIN GUARD OK — export excludes deleted accounts; duplicates are individually removable');
process.exit(fails ? 1 : 0);
