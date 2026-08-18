/* ==========================================================================
   The Lit — the About page's "What's new" list, in a real browser
   (Playwright + a local static server over the repo root; no network,
   Firebase blocked so the page runs on the date rule alone).

       node lit/_scraper/news-page-guard.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)

   news-selftest.mjs pins the RULES of the review gate. What is pinned HERE is
   the half a unit test cannot see — what each person actually gets:

     • a visitor sees the published entries and NOTHING else;
     • an entry the maintainer has REMOVED is off the list, for them too —
       that is what Remove now means — and is still reachable, collapsed,
       below it, which is what stops Remove being a one-way door;
     • an entry nobody has reviewed is invisible to everyone but them;
     • every entry can be edited and removed, which is what the owner asked
       for and what this page could not do at all before.

   Firestore is deliberately unreachable in this run, so it also proves the
   PAGE STILL RENDERS its log when the decisions cannot be read — the state a
   visitor gets before the rules are deployed.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch {
  console.log('playwright is not installed — skipping the browser checks');
  process.exit(process.env.CI ? 1 : 0);
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  let file = join(ROOT, decodeURIComponent(path));
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok —', msg); else { fails++; console.error('  FAIL —', msg); } };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
page.on('pageerror', e => { fails++; console.error('  FAIL — page error:', e.message); });
// no network: the Firebase SDK and the fonts are not reachable from here, which
// is also the state the page must survive in front of a visitor
await page.route('**://*.gstatic.com/**', r => r.abort());
await page.route('**://*.googleapis.com/**', r => r.abort());

try {
  await page.goto(BASE + '/lit/about/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LitNews && document.querySelector('#litWhatsNew'));

  // The real changelog renders even with Firebase unreachable — the date rule
  // alone, which is what a visitor gets before the rules are deployed.
  await page.waitForSelector('#litWhatsNew .wn-item', { timeout: 15000 });
  ok((await page.$$('#litWhatsNew .wn-item')).length > 0,
    'the log renders with no decisions readable at all');

  const LOG = [
    { id: 'settled', date: '2026-08-01', title: 'Long since announced', summary: 's', url: '' },
    { id: 'gone', date: '2026-08-02', title: 'Taken down', summary: 's', url: '' },
    { id: 'live', date: '2026-09-01', title: 'Published today', summary: 's', url: '' },
    { id: 'draft', date: '2026-09-02', title: 'Not reviewed yet', summary: 's', url: '' },
  ];
  const DOCS = { gone: { status: 'removed' }, live: { status: 'approved' } };
  const titles = () => page.$$eval('#litWhatsNew .wn-item .wn-title', n => n.map(x => x.textContent));
  const set = (docs, admin) => page.evaluate(([d, a, l]) => window.LitNews.__setForTest(d, a, l),
    [docs, admin, LOG]);

  // ── a visitor ──
  await set(DOCS, false);
  ok(JSON.stringify(await titles()) === JSON.stringify(['Published today', 'Long since announced']),
    'a visitor sees the published entries, newest first');
  ok((await page.$$('#litWhatsNew .wn-admin')).length === 0, 'and no controls');
  ok((await page.$$('.wn-bin')).length === 0, 'and no sight of what was removed');
  ok(!(await titles()).includes('Not reviewed yet'), 'an unreviewed entry reaches nobody');

  // ── the maintainer ──
  await set(DOCS, true);
  ok(JSON.stringify(await titles()) ===
     JSON.stringify(['Not reviewed yet', 'Published today', 'Long since announced']),
    'the maintainer also sees what is waiting for review');
  ok((await page.$$eval('#litWhatsNew .wn-item.is-pending .wn-title', n => n.map(x => x.textContent)))
       .join() === 'Not reviewed yet',
    'flagged as unpublished, and only that one');
  ok((await page.textContent('.wn-note')).includes('1 new entry'),
    'with a note saying how much is waiting');

  ok(!(await titles()).includes('Taken down'),
    'A REMOVED ENTRY IS OFF THE LIST — for the maintainer too');
  const bin = await page.textContent('.wn-bin');
  ok(bin.includes('Removed updates (1)') && bin.includes('Taken down'),
    'and is in the panel below it, which is what makes Remove reversible');
  ok(await page.$eval('.wn-bin', n => n.tagName === 'DETAILS' && !n.open),
    'collapsed, so the list itself stays clean');
  ok((await page.$$eval('.wn-bin .wn-admin button',
    n => n.map(x => x.textContent.replace(/[^A-Za-z ]/g, '').trim()))).join('/') === 'Restore/Edit',
    'carrying the way back');

  ok(JSON.stringify(await page.$$eval('#litWhatsNew .wn-item .wn-admin', n =>
    n.map(x => Array.from(x.querySelectorAll('button'))
      .map(b => b.textContent.replace(/[^A-Za-z ]/g, '').trim()).join('/')))) ===
    JSON.stringify(['Publish/Edit/Remove', 'Edit/Remove', 'Edit/Remove']),
    'every entry can be edited and removed; only the new one published');

  /* THE PANEL STAYS OPEN ACROSS A RE-RENDER. render() rebuilds the <details>,
     so without remembering the state it snapped shut on every re-render — and
     pressing Edit on a removed entry re-renders, which made that button read
     as dead: the editor opened inside a panel that had just folded up. */
  await page.click('.wn-bin summary');
  ok(await page.$eval('.wn-bin', n => n.open), 'the removed panel opens when clicked');
  await page.click('.wn-bin .wn-admin button:has-text("Edit")');
  ok(await page.$eval('.wn-bin', n => n.open) &&
     await page.isVisible('.wn-bin .wn-edit textarea'),
    'and Edit inside it opens the form without folding the panel away');
  await page.click('.wn-bin .wn-edit button:has-text("Cancel")');

  // ── an edit reads as the maintainer wrote it ──
  await page.evaluate(([l]) => window.LitNews.__setForTest(
    { settled: { status: 'approved', title: 'Reworded by hand' } }, false, l), [LOG]);
  ok((await titles()).includes('Reworded by hand'),
    'a reworded entry is SHOWN reworded, not annotated');

  // ── the inline editor, not a prompt() box ──
  await set(DOCS, true);
  await page.click('#litWhatsNew .wn-item .wn-admin button:has-text("Edit")');
  ok(await page.isVisible('#litWhatsNew .wn-edit textarea'),
    'Edit opens a real form — a summary here is a paragraph, not a prompt line');
  /* AND WHAT IS TYPED SURVIVES A RE-RENDER. The list re-renders on its own —
     the decisions landing late, the session resolving — and on a FAILED save,
     which is exactly when losing a paragraph just written would hurt most. */
  await page.fill('#litWhatsNew .wn-edit textarea', 'A summary I am still writing');
  await page.evaluate(([l]) => window.LitNews.__setForTest(null, true, l), [LOG]);
  ok(await page.inputValue('#litWhatsNew .wn-edit textarea') === 'A summary I am still writing',
    'a re-render mid-edit keeps what the maintainer has typed');
  await page.click('#litWhatsNew .wn-edit button:has-text("Cancel")');
  ok(!(await page.$('#litWhatsNew .wn-edit')), 'and Cancel closes it, changing nothing');
  /* A CHANGELOG THAT CANNOT BE FETCHED AT ALL still resolves the section. A
     rejected fetch — offline, TLS, malformed JSON — used to leave the seeded
     "Loading the latest updates…" placeholder under a visible heading for
     ever; an empty log hides the section, and so must a failure. */
  const dead = await browser.newPage();
  await dead.route('**/changelog.json', r => r.abort());
  await dead.goto(BASE + '/lit/about/', { waitUntil: 'domcontentloaded' });
  await dead.waitForFunction(() => {
    const box = document.querySelector('#litWhatsNew');
    return box && box.style.display === 'none';
  }, { timeout: 10000 }).then(
    () => ok(true, 'a changelog that cannot be fetched hides the section rather than saying "Loading…" for ever'),
    () => ok(false, 'a changelog that cannot be fetched hides the section rather than saying "Loading…" for ever'));
  await dead.close();
} finally {
  await browser.close();
  server.close();
}

if (fails) { console.error(`\nnews-page-guard: ${fails} FAILED`); process.exit(1); }
console.log('\nnews-page-guard: all checks passed');
