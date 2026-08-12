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

/* ---- Session cards: Close Session (grey, keeps data) vs Delete (destroys) --
   An ACTIVE card must offer both, in that order, with Close styled neutrally
   — it only stops new joins — and Delete styled danger. Delete must erase the
   session's DATA first and the session doc second, so a failed purge leaves
   the session listed instead of orphaning rows under a vanished session. */
const order = await pg.evaluate(() => {
  window.__calls = [];
  window.ArenaStore.deleteSessionData = (id) => { window.__calls.push('data:' + id); return Promise.resolve({ participantsRemoved: 1 }); };
  window.ArenaStore.deleteSession = (id) => { window.__calls.push('session:' + id); return Promise.resolve(); };
  window.ArenaStore.updateSession = (id, patch) => { window.__calls.push('update:' + id + ':' + JSON.stringify(patch)); return Promise.resolve(); };
  const card = window.__arenaSessionCard({ id: 's1', code: 'SGP', status: 'open' }, { s1: 3 }, () => {});
  card.id = 'test-session-card';
  document.body.appendChild(card);
  return [...card.querySelectorAll('button')].map(b => b.textContent.trim() + '|' + b.className);
});
const closeI = order.findIndex(b => b.startsWith('Close Session|'));
const delI = order.findIndex(b => b.startsWith('Delete|'));
ok(closeI >= 0, 'the active card has a "Close Session" button');
ok(closeI >= 0 && /\bsec\b/.test(order[closeI]) && !/danger/.test(order[closeI]), 'Close Session is the neutral (grey) style, not danger');
ok(delI === closeI + 1, 'Delete sits directly after Close Session (got ' + order.map(b => b.split('|')[0]).join(', ') + ')');
ok(delI >= 0 && /danger/.test(order[delI]), 'Delete is the danger (red) style');
// Close only flips the status — data untouched.
await pg.evaluate(() => {
  window.__calls = [];
  [...document.querySelectorAll('#test-session-card button')].find(b => b.textContent.trim() === 'Close Session').click();
});
await pg.waitForFunction(() => window.__calls.length > 0, null, { timeout: 8000 });
const closeCalls = await pg.evaluate(() => window.__calls);
ok(closeCalls.length === 1 && closeCalls[0] === 'update:s1:{"status":"closed"}', 'Close Session only marks it closed, deleting nothing (' + closeCalls.join(',') + ')');
// Delete purges the data, then the session doc.
await pg.evaluate(() => {
  window.__calls = [];
  [...document.querySelectorAll('#test-session-card button')].find(b => b.textContent.trim() === 'Delete').click();
});
await pg.waitForFunction(() => window.__calls.length >= 2, null, { timeout: 8000 });
const delCalls = await pg.evaluate(() => window.__calls);
ok(delCalls[0] === 'data:s1' && delCalls[1] === 'session:s1', 'Delete erases the session DATA first, then the session (' + delCalls.join(' -> ') + ')');

/* ---- The store's own deleteSessionData semantics (local backend) --------
   Someone who played ONLY the deleted session goes entirely; someone who also
   played another session keeps that other session's responses/events/survey.
   Run on a fresh page so the real store is used (the one above is stubbed). */
const pg2 = await ctx.newPage();
await pg2.goto(BASE + '/lab/answerarena/?preview=1&key=stouras');   // namespaced sandbox store
await pg2.waitForFunction(() => !!(window.ArenaStore && window.ArenaStore.deleteSessionData), null, { timeout: 8000 });
const purge = await pg2.evaluate(async () => {
  const S = window.ArenaStore;
  await S.setParticipant('SOLO', { uid:'SOLO', sessionId:'s1', playedSessions:{s1:1}, completedSessions:{s1:1} });
  await S.setParticipant('BOTH', { uid:'BOTH', sessionId:'s1', playedSessions:{s1:1,s2:1}, completedSessions:{s2:1},
    draftResponse:{ sessionId:'s1', taskId:'t9' } });
  await S.addResponse('SOLO', { sessionId:'s1', taskId:'t1' });
  await S.addResponse('BOTH', { sessionId:'s1', taskId:'t1' });
  await S.addResponse('BOTH', { sessionId:'s2', taskId:'t2' });
  await S.addEvent('BOTH', { sessionId:'s1', type:'pick' });
  await S.addEvent('BOTH', { sessionId:'s2', type:'pick' });
  await S.saveSurvey('BOTH', 's1', { q:'a' });
  await S.saveSurvey('BOTH', 's2', { q:'b' });
  const res = await S.deleteSessionData('s1');
  const ids = (await S.listParticipants()).map(p => p._id);
  const both = await S.getParticipant('BOTH');
  return { res, ids,
    resp: (await S.listResponses('BOTH')).map(r => r.sessionId),
    ev: (await S.listEvents('BOTH')).map(e => e.sessionId),
    surveys: (await S.listSurveys('BOTH')).map(s => s.sessionId),
    played: Object.keys(both.playedSessions || {}), draft: both.draftResponse, cur: both.sessionId };
});
ok(!purge.ids.includes('SOLO'), 'a participant who played ONLY the deleted session is removed entirely');
ok(purge.ids.includes('BOTH'), 'a participant who also played another session is kept');
ok(purge.res.participantsRemoved === 1, 'the purge reports the removed record (' + purge.res.participantsRemoved + ')');
ok(JSON.stringify(purge.resp) === '["s2"]', 'only the deleted session\'s responses are gone (' + purge.resp.join(',') + ')');
ok(JSON.stringify(purge.ev) === '["s2"]', 'only the deleted session\'s events are gone (' + purge.ev.join(',') + ')');
ok(JSON.stringify(purge.surveys) === '["s2"]', 'only the deleted session\'s survey is gone (' + purge.surveys.join(',') + ')');
ok(JSON.stringify(purge.played) === '["s2"]', 'the session is dropped from playedSessions (' + purge.played.join(',') + ')');
ok(!purge.draft, 'an unsubmitted draft belonging to the deleted session is cleared');
ok(purge.cur === null, 'the participant no longer points at the deleted session as their current one');

await br.close(); srv.close();
console.log(fails ? `\nARENA ADMIN GUARD FAILED (${fails})` : '\nARENA ADMIN GUARD OK — export excludes deleted accounts; duplicates are individually removable; Close keeps data, Delete purges it first');
process.exit(fails ? 1 : 0);
