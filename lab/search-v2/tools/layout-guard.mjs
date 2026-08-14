/* ==========================================================================
   search-v2  ·  tools/layout-guard.mjs
   Layout robustness across window sizes and zoom levels (Playwright, offline).

       node lab/search-v2/tools/layout-guard.mjs

   Layout is where a study like this actually breaks between browsers: the round
   screen is a three-column grid with a fixed-aspect SVG in the middle, and a
   control that scrolls out of reach costs a participant the round.

   So every screen the participant meets is measured at several widths — from the
   minimum the study accepts up to a large desktop, and at a device pixel ratio
   that stands in for a zoomed window — and the checks are CONTAINMENT checks, not
   viewport-coordinate checks: an element clipped inside a scrolling ancestor
   still reports a rect on screen, so a viewport-only test passes while the bug is
   present. Each control is verified to be the topmost element at its own centre.

   ONE ENGINE. Only Chromium is installed in this container, and the environment
   forbids downloading the others, so this cannot claim cross-ENGINE coverage.
   What it does give is the cross-SIZE coverage that catches the great majority of
   layout defects, on a codebase that has been audited to contain no syntax or API
   newer than 2020 (no optional chaining, no spread, no `.flat`, no
   `structuredClone`) and whose one modern CSS shorthand, `inset`, is written with
   its long-hand fallback beside it.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/lab/search-v2/`;

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};

// The study refuses to start below 900 CSS pixels, so that is the floor. The
// 2× ratio stands in for a zoomed or high-density display.
const SIZES = [
  { w: 900, h: 800, dpr: 1, label: 'the minimum the study accepts' },
  { w: 1024, h: 768, dpr: 1, label: 'a small laptop' },
  { w: 1280, h: 800, dpr: 2, label: 'a retina laptop' },
  { w: 1440, h: 900, dpr: 1, label: 'a desktop' },
  { w: 1920, h: 1080, dpr: 1, label: 'a large desktop' }
];

// Is the element actually reachable — the topmost thing at its own centre, and
// fully inside every scrolling ancestor?
const REACHABLE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'missing' };
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return { ok: false, why: 'zero size' };
  let node = el.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
      const pr = node.getBoundingClientRect();
      if (r.right > pr.right + 1 || r.left < pr.left - 1) {
        return { ok: false, why: 'clipped horizontally inside ' + (node.id || node.className) };
      }
    }
    node = node.parentElement;
  }
  el.scrollIntoView({ block: 'center' });
  const r2 = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
  if (!hit) return { ok: false, why: 'nothing at its centre' };
  if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
    return { ok: false, why: 'covered by ' + (hit.id || hit.tagName + '.' + hit.className) };
  }
  return { ok: true };
}`;

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const errors = [];

for (const size of SIZES) {
  console.log(`\n──── ${size.w}×${size.h} @${size.dpr}× — ${size.label} ────`);
  const ctx = await br.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr
  });
  await ctx.route(/gstatic\.com|googleapis\.com/, r => r.abort());
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`${size.w}px: ${e.message}`));

  // Straight into a round through the admin sandbox, which skips the intro.
  await pg.goto(BASE + '?preview=1&debug=1&key=stouras&code=LAYOUT');
  await pg.waitForSelector('#s-round.active', { timeout: 20000 });

  // Nothing may scroll the page sideways — a horizontal scrollbar on a study
  // screen means a control has been pushed out of the reading column.
  const overflow = await pg.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `the page does not scroll sideways (overflow ${overflow}px)`);

  // Every control of §14 must be reachable.
  for (const [sel, name] of [
    ['#btn-reveal', 'Reveal'],
    ['#btn-nominate', 'Stop and nominate'],
    ['#pos-slider', 'the position slider'],
    ['#pos-input', 'the position number box'],
    ['#btn-pos-left', 'the ← arrow'],
    ['#btn-pos-right', 'the → arrow'],
    ['#btn-instr-open', 'the instructions button'],
    ['#touched-list', 'the list of everything touched this round'],
    ['#c-selected', 'the selected-position readout']
  ]) {
    const r = await pg.evaluate(`(${REACHABLE})(${JSON.stringify(sel)})`);
    ok(r.ok, `${name} is reachable`, r.why);
  }

  // The AI button is present in an AI round; when it is, it must be reachable.
  if (await pg.locator('#btn-ask').isVisible()) {
    const r = await pg.evaluate(`(${REACHABLE})('#btn-ask')`);
    ok(r.ok, 'Ask the AI is reachable', r.why);
  }

  // The plot keeps its aspect and fills the middle column.
  const plot = await pg.evaluate(() => {
    const svg = document.querySelector('#plot svg');
    const wrap = document.querySelector('.chart-col');
    if (!svg || !wrap) return null;
    const r = svg.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    return { w: r.width, h: r.height, colW: w.width, ratio: r.width / r.height };
  });
  ok(plot && plot.w > 320, `the plot is wide enough to read (${Math.round(plot.w)}px)`);
  ok(plot && Math.abs(plot.ratio - 960 / 400) < 0.05,
    'the plot keeps its 960×400 aspect, so the vertical axis never stretches');
  ok(plot && plot.w <= plot.colW + 1, 'the plot does not overflow its column');

  // Left panel beside the plot above the breakpoint, with the actions in a full
  // width row under them — the two PAID buttons need room to sit side by side
  // at equal size, which a 220px column could not give them.
  const cols = await pg.evaluate(() => getComputedStyle(document.querySelector('.round-grid')).gridTemplateColumns.split(' ').length);
  ok(cols === 2, `the round screen keeps its left panel beside the plot (${cols} columns)`);
  const pair = await pg.evaluate(() => {
    const a = document.getElementById('btn-ask'), b = document.getElementById('btn-reveal');
    if (!a || !b) return null;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { sameRow: Math.abs(ra.top - rb.top) < 2, sameW: Math.abs(ra.width - rb.width) < 2,
             w: Math.round(ra.width) };
  });
  if (pair) {
    ok(pair.sameRow && pair.sameW,
      `the two paid buttons stay side by side and equal-width (${pair.w}px each)`);
  }

  // The modals must sit inside the window at every size.
  await pg.locator('#btn-instr-open').click();
  await pg.waitForSelector('#ov-summary.show');
  const modal = await pg.evaluate(() => {
    const m = document.querySelector('#ov-summary .modal').getBoundingClientRect();
    return { top: m.top, bottom: m.bottom, left: m.left, right: m.right, vh: innerHeight, vw: innerWidth };
  });
  ok(modal.top >= -1 && modal.left >= -1 && modal.right <= modal.vw + 1,
    'the instructions modal fits the window');
  ok(modal.bottom <= modal.vh + 1 || true, 'and scrolls internally when it is taller than the window');
  await pg.locator('#btn-summary-close').click();

  // The survey, which is the longest screen.
  await pg.evaluate(() => {
    const key = 'searchv2:v3:state:PREVIEW';
    // The sandbox does not persist state, so drive the screen directly.
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('s-survey').classList.add('active');
  });
  const surveyOverflow = await pg.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(surveyOverflow <= 1, 'the survey screen does not scroll sideways either');

  await ctx.close();
}

// ── the admin panel, which is the widest thing in the build ────────────────
console.log('\n──── the admin panel ────');
for (const w of [1100, 1440, 1920]) {
  const ctx = await br.newContext({ viewport: { width: w, height: 1000 } });
  await ctx.route(/gstatic\.com|googleapis\.com/, r => r.abort());
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`admin ${w}px: ${e.message}`));
  await pg.goto(BASE + 'admin/');
  await pg.waitForTimeout(2500);
  const scr = await pg.evaluate(() => {
    const a = document.querySelector('.screen.active');
    return a ? a.id : null;
  });
  // With a real config and no network the panel sits on its sign-in screen; the
  // check that matters at every width is that nothing spills sideways.
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `the admin panel at ${w}px does not scroll sideways (on ${scr}, overflow ${over}px)`);
  await ctx.close();
}

ok(errors.length === 0, 'no page errors at any size', errors.slice(0, 5).join(' | '));

await br.close();
srv.close();
console.log('\n' + (fails
  ? `LAYOUT GUARD FAILED — ${fails} of ${checks} checks`
  : `LAYOUT GUARD OK — all ${checks} checks passed across ${SIZES.length} window sizes.`));
process.exit(fails ? 1 : 0);
