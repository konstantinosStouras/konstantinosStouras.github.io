/* ==========================================================================
   Simulation Platform — roster width guard (Playwright + a local static
   server over the repo root; no network).
       node simulation/tools/roster-width-guard.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)

   Owner report 2026-08: on /simulation/admin/ the roster's per-row **Delete**
   button was unreadable, cut off at the right edge. The roster is the widest
   thing on the site: name, student ID, e-mail, level, registered, approved,
   ONE COLUMN PER ACTIVE SIMULATION, then the actions cell. At the student
   page's 1060px reading column that last cell fell outside `.roster-wrap` and
   lived only inside its horizontal scroll, so an instructor who did not know
   to scroll sideways could not reach it at all.

   Two things fixed it and both are pinned here: the admin page uses the window
   width (`.wrap.wide`), and long unbroken cell values (e-mail addresses have no
   spaces) may wrap so they stop setting the table's minimum width.

   THE MEASUREMENT IS THE POINT. Viewport coordinates alone cannot see this
   bug — a button clipped inside a scrolling ancestor still reports a rect on
   screen. So each case checks containment inside `.roster-wrap`'s visible box
   AND what actually paints at the button's centre. `clippedBy` reports how far
   past the container's right edge the button sits: it was 15-177px before the
   fix and must stay 0.

   The live roster needs Firebase, so the table body is seeded here exactly as
   admin.js builds it (base columns + Approved + one per active sim + actions),
   with the key gate and the Firebase-mode blocks opened directly.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const srv = createServer(async (req, res) => {
  let f = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (f.endsWith('/')) f = join(f, 'index.html');
  try {
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}/`;

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

/* Seed the roster the way admin.js renders it, and open the two gates that
   normally need the maintainer key and the Firebase backend. */
const seed = nSims => `
  document.getElementById('s-gate').hidden = true;
  document.getElementById('s-admin').hidden = false;
  document.getElementById('roster-fb').hidden = false;
  document.getElementById('roster-local').hidden = true;
  document.getElementById('btn-csv').hidden = false;
  const tab = document.getElementById('rostertab');
  tab.hidden = false;
  const hd = tab.querySelector('thead tr'); hd.innerHTML = '';
  const cols = ['Name','Student ID','E-mail','Level','Registered','Approved'];
  for (let i = 0; i < ${nSims}; i++) cols.push('\u{1F3B2} 44/50');
  cols.push('');
  cols.forEach(t => { const th = document.createElement('th'); th.textContent = t; hd.appendChild(th); });
  const tb = tab.querySelector('tbody'); tb.innerHTML = '';
  const names = ['Nguyen Thanh Hai','Liu jiayi','Chenmengyu','Aoife Ní Bhraonáin','Bartholomew Fitzwilliam'];
  const mails = ['hainguyen100305@gmail.com','2454977558@qq.com','chen.mengyu@ucdconnect.ie',
                 'a.nibhraonain@ucdconnect.ie','bartholomew.fitzwilliam@ucdconnect.ie'];
  for (let i = 0; i < 50; i++) {
    const tr = document.createElement('tr');
    [names[i % 5], String(25262368 + i), mails[i % 5], 'Undergraduate', '2026-08-12']
      .forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    const ap = document.createElement('td');
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '✓ Approved';
    ap.appendChild(b); tr.appendChild(ap);
    for (let s = 0; s < ${nSims}; s++) { const td = document.createElement('td'); td.textContent = s % 2 ? '✓' : '—'; tr.appendChild(td); }
    const act = document.createElement('td');
    const del = document.createElement('button'); del.className = 'btn ghost small del-probe'; del.textContent = 'Delete';
    act.appendChild(del); act.style.textAlign = 'right'; tr.appendChild(act);
    tb.appendChild(tr);
  }
`;

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

for (const [label, width, nSims] of [
  ['small laptop  1280 · 2 sims', 1280, 2],
  ['laptop        1366 · 2 sims', 1366, 2],
  ['the reported view 1401 · 2 sims', 1401, 2],
  ['laptop        1440 · 2 sims', 1440, 2],
  ['MacBook       1512 · 3 sims', 1512, 3],
  ['worst case    1440 · 5 sims', 1440, 5],
]) {
  const p = await br.newPage({ viewport: { width, height: 900 } });
  await p.goto(base + 'simulation/admin/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(300);
  await p.evaluate(seed(nSims));
  await p.waitForTimeout(150);
  const m = await p.evaluate(() => {
    const del = document.querySelector('.del-probe');
    // The roster sits far down a long page, so the first row is below the fold:
    // elementFromPoint would return null for a reason unrelated to the bug.
    del.scrollIntoView({ block: 'center' });
    const r = del.getBoundingClientRect();
    const wrapEl = document.querySelector('.roster-wrap');
    const wr = wrapEl.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    const de = document.scrollingElement || document.documentElement;
    return {
      right: Math.round(r.right), vw: window.innerWidth,
      clippedBy: Math.max(0, Math.round(r.right - wr.right)),
      mainW: Math.round(document.querySelector('main').getBoundingClientRect().width),
      pageHScroll: de.scrollWidth > window.innerWidth + 1,
      visible: r.width > 0
        && r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5
        && r.right <= window.innerWidth + 0.5 && r.left >= -0.5
        && !!hit && (hit === del || del.contains(hit)),
    };
  });
  check(`${label}: Delete is fully visible, not clipped`, m.visible,
    `clippedBy=${m.clippedBy}px right=${m.right} vw=${m.vw}`);
  check(`${label}: the page itself never scrolls sideways`, !m.pageHScroll);
  console.log(`         main=${m.mainW}px  clippedBy=${m.clippedBy}px`);
  await p.close();
}

await br.close(); srv.close();
console.log(failures
  ? `\n${failures} check(s) FAILED`
  : '\nROSTER WIDTH OK — every row\'s Delete button is reachable without horizontal scrolling.');
process.exit(failures ? 1 : 0);
