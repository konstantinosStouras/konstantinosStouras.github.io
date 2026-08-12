/* ==========================================================================
   Answer Arena — TEST-ROUND (preview) guard (offline, Playwright; no network)
       node lab/answerarena/tools/preview-guard.mjs

   The admin's 🧪 Test round opens the participant app at ?preview=1&key=… .
   That sandbox must:
     1. run on the LOCAL backend in its OWN localStorage namespace even though
        arena-config.js holds a real Firebase config (so a rehearsal can never
        write a participant doc / response / event to the live project),
     2. show the "nothing is saved" ribbon,
     3. arrive at the intake with random test data filled in and the consents
        ticked (that is the whole point — no retyping demographics),
     4. leave the normal offline store ('arena:db') untouched,
     5. and be inert without the flag: a plain visit is NOT a sandbox.

   Runs entirely offline: the sandbox never loads the Firebase SDK, and the
   store/app are the REAL shipped files.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('x'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/lab/answerarena/`;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext();
// Any attempt to reach the Firebase SDK is a failure of isolation, so make it
// loud instead of a silent slow timeout.
let sdkHits = 0;
await ctx.route('**/gstatic.com/firebasejs/**', r => { sdkHits++; r.abort(); });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

// ── Seed the sandbox the way the admin's launchTestRound does, plus a decoy
//    "real" local store that must come out unchanged. ─────────────────────────
await pg.goto(BASE);
await pg.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('arena:db', JSON.stringify({ participants: { REAL: { note: 'live data' } } }));
  localStorage.setItem('arena:preview:seed', JSON.stringify({
    ts: 1234,
    config: { texts: {}, settings: { comparisonsPerUser: 2 }, registrationQuestions: null, surveyQuestions: null },
    session: { id: 's_test', code: 'TESTRND', name: 'Rehearsal', condition: { factors: {} }, comparisonsPerUser: 2 },
    taskSet: { id: 'ts_test', name: 'Test set', tasks: [
      { id: 't1', task: 'Task one?', outputA: 'Answer A1', outputB: 'Answer B1' },
      { id: 't2', task: 'Task two?', outputA: 'Answer A2', outputB: 'Answer B2' },
    ] },
  }));
});

// ── The sandbox ────────────────────────────────────────────────────────────
await pg.goto(BASE + '?preview=1&key=stouras&s=TESTRND');
await pg.waitForFunction(() => !!document.querySelector('#arena-screen .a-card'), null, { timeout: 15000 });

const mode = await pg.evaluate(() => ({
  storeMode: window.ArenaStore.mode,
  isPreview: !!window.ArenaStore.isPreview,
  fbReady: !!window.ARENA_FB_READY,
  flag: !!(window.ARENA_PREVIEW && window.ARENA_PREVIEW.on),
}));
ok(mode.flag && mode.isPreview, 'the sandbox flag is on for ?preview=1&key=stouras');
ok(mode.storeMode === 'local', 'the sandbox uses the LOCAL backend (mode=local)'
  + (mode.fbReady ? ' even though Firebase is configured' : ''));
ok(sdkHits === 0, 'the Firebase SDK is never even fetched in a test round');
ok(await pg.locator('#a-preview-ribbon').isVisible(), 'the "nothing is saved" ribbon is shown');

const launch = await pg.evaluate(() => window.ARENA_PREVIEW.launchUrl({ code: 'ABC123' }));
ok(/\?preview=1&key=stouras&s=ABC123$/.test(launch), 'launchUrl carries the flag + the session code');

// Welcome → (tour) → intake. The seeded code is prefilled from ?s=.
const code = await pg.locator('#arena-screen input[type=text]').first().inputValue();
ok(code === 'TESTRND', 'the seeded session code is prefilled on welcome');
await pg.locator('#arena-screen button').first().click();          // Take a quick tour
await pg.waitForTimeout(600);
const skip = pg.getByRole('button', { name: /skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click();
await pg.waitForFunction(() => !!document.querySelector('#arena-screen .a-field'), null, { timeout: 15000 });

// ── The intake must arrive filled in ───────────────────────────────────────
const intake = await pg.evaluate(() => {
  const out = [];
  document.querySelectorAll('#arena-screen .a-field').forEach(f => {
    const inp = f.querySelector('input,select,textarea');
    if (!inp) return;
    const label = (f.querySelector('label')?.textContent || '').trim();
    out.push({
      label,
      type: inp.type || inp.tagName.toLowerCase(),
      value: inp.type === 'checkbox' ? (inp.checked ? 'Yes' : '') : inp.value,
    });
  });
  return out;
});
const blanks = intake.filter(f => !f.value);
ok(intake.length > 0, `the intake rendered ${intake.length} fields`);
ok(blanks.length === 0, 'every intake field arrived pre-filled with random test data'
  + (blanks.length ? ' — blank: ' + blanks.map(b => b.label || b.type).join(', ') : ''));
ok(intake.some(f => f.type === 'checkbox') === false || intake.filter(f => f.type === 'checkbox').every(f => f.value === 'Yes'),
  'the consent checkbox(es) arrive ticked');
const ids = intake.filter(f => /student id/i.test(f.label));
ok(ids.length === 0 || /^\d{6,}$/.test(ids[0].value), 'a Student-ID field gets digits, not filler text');

// Start → the practice comparison, i.e. the flow really runs on the seed.
await pg.getByRole('button', { name: 'Start', exact: true }).click();
await pg.waitForFunction(() => !!document.querySelector('.a-answer'), null, { timeout: 15000 });
ok(true, 'Start goes straight through to the practice comparison');

// ── Isolation: the sandbox wrote only into its own namespace ───────────────
const store = await pg.evaluate(() => ({
  keys: Object.keys(localStorage).sort(),
  real: localStorage.getItem('arena:db'),
  sandbox: localStorage.getItem('arena:preview:db'),
}));
const sandboxDb = JSON.parse(store.sandbox || '{}');
ok(Object.keys(sandboxDb.participants || {}).length === 1, 'the test participant lives in the sandbox namespace');
ok(store.real === JSON.stringify({ participants: { REAL: { note: 'live data' } } }),
  'the normal offline store (arena:db) is untouched');
ok(store.keys.indexOf('arena:uid') < 0, 'the sandbox never claims the real anonymous-identity key');
ok((sandboxDb.sessions && sandboxDb.sessions.s_test && sandboxDb.sessions.s_test.status) === 'open',
  'the seeded session is open in the sandbox, whatever its real status');

// ── A seed whose task set didn't fit falls back to the built-in samples ───
await pg.evaluate(() => {
  localStorage.setItem('arena:preview:seed', JSON.stringify({
    ts: 5678, config: { texts: {}, settings: {} },
    session: { id: 's_empty', code: 'EMPTYSET' },
    taskSet: { id: 'ts_empty', name: 'Too big', tasks: [] },
  }));
});
await pg.goto(BASE + '?preview=1&key=stouras&s=EMPTYSET');
await pg.waitForFunction(() => !!document.querySelector('#arena-screen .a-card'), null, { timeout: 15000 });
const fallback = await pg.evaluate(() => window.ArenaStore.loadActiveTasks().then(s => (s.tasks || []).length));
ok(fallback > 0, `an empty seeded task set falls back to the built-in comparisons (${fallback})`);

// ── Inert without the flag ─────────────────────────────────────────────────
await pg.goto(BASE + '?preview=1');            // no key → not a sandbox
await pg.waitForTimeout(400);
const noKey = await pg.evaluate(() => ({
  flag: !!(window.ARENA_PREVIEW && window.ARENA_PREVIEW.on),
  ribbon: !!document.getElementById('a-preview-ribbon'),
}));
ok(!noKey.flag && !noKey.ribbon, '?preview=1 without the key is NOT a sandbox');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await br.close(); srv.close();
console.log(fails ? `\nPREVIEW GUARD FAILED (${fails})` : '\nPREVIEW GUARD OK — sandbox isolated, ribbon shown, intake pre-filled.');
process.exit(fails ? 1 : 0);
