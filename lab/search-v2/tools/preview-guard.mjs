/* ==========================================================================
   Search-v2 — TEST-ROUND (preview) guard (offline, Playwright; no network)
       node lab/search-v2/tools/preview-guard.mjs

   This study already had an admin preview (?preview=1&debug=1&key=…) that
   skips the intro and never writes to Firestore. The test round adds (a) a
   🧪 button on every session card, not just the launch box, and (b) a visible
   "nothing is saved" ribbon, since the small nav label was easy to miss.

   Asserted here:
     1. the sandbox runs the study and shows the ribbon,
     2. it never loads the Firebase SDK (so no participant / round / event can
        reach the project) and never tells the Simulation Platform the run
        completed,
     3. a plain visit is NOT a sandbox (no ribbon, code gate as before),
     4. and the admin panel still wires the button + one shared preview-URL
        builder (a static check — the admin needs the Firebase SDK, which is
        unreachable offline, so its DOM cannot be exercised here).
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
const BASE = `http://127.0.0.1:${srv.address().port}/lab/search-v2/`;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
let sdkHits = 0;
await ctx.route('**/gstatic.com/firebasejs/**', r => { sdkHits++; r.abort(); });
await ctx.route('**/script.google.com/**', r => r.abort());
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

// ── The sandbox ────────────────────────────────────────────────────────────
await pg.goto(BASE + '?code=TESTSV&preview=1&debug=1&key=stouras');
await pg.waitForSelector('#sv-ribbon', { timeout: 15000 });
ok(true, 'the "nothing is saved" ribbon is shown');
ok(sdkHits === 0, 'the Firebase SDK is never fetched in a test round');
ok(await pg.evaluate(() => typeof window.simpMarkCompleted !== 'function'),
  'the platform completion marker is NOT wired (a test round can never gate a real play)');
ok(await pg.evaluate(() => window.SIMP_EXPECT === '__off__'),
  'the platform prefill/marker script is switched off for the sandbox');
const shown = await pg.evaluate(() => {
  const vis = [];
  document.querySelectorAll('.screen').forEach(s => {
    if (s.offsetParent !== null || s.classList.contains('show')) vis.push(s.id);
  });
  return vis;
});
ok(shown.length > 0 && !shown.includes('s-code'),
  `the study runs straight into the flow, past the code gate (showing: ${shown.join(', ') || 'none'})`);

// ── A plain visit is not a sandbox ────────────────────────────────────────
const pg2 = await ctx.newPage();
await pg2.goto(BASE);
await pg2.waitForTimeout(1200);
ok(!(await pg2.locator('#sv-ribbon').count()), 'no ribbon on a normal visit');

// ── The admin wiring (static: its DOM needs the blocked Firebase SDK) ─────
const admin = await readFile(join(ROOT, 'lab/search-v2/admin/admin.js'), 'utf8');
ok(/data-act="testround"/.test(admin), 'every session card carries a 🧪 Test round action');
ok(/act === 'testround'/.test(admin), 'the card action is wired to open the sandbox');
ok(/function previewUrl\(/.test(admin) && (admin.match(/previewUrl\(/g) || []).length >= 3,
  'one shared previewUrl() builder serves both the launch box and the cards');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await br.close(); srv.close();
console.log(fails ? `\nSV PREVIEW GUARD FAILED (${fails})` : '\nSV PREVIEW GUARD OK — sandbox runs, ribbon shown, no Firebase, admin wired.');
process.exit(fails ? 1 : 0);
