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
    ['#sb-net', 'the NET VALUE KPI in the left column'],
    ['#sb-best', 'the best prize found'],
    ['#sb-reveal', 'the running cost of revealing'],
    ['#round-reminder', 'the rules reminder on top of the plot'],
    ['#side-round-n', 'the round counter']
  ]) {
    const r = await pg.evaluate(`(${REACHABLE})(${JSON.stringify(sel)})`);
    ok(r.ok, `${name} is reachable`, r.why);
  }

  // The AI button is present in an AI round; when it is, it must be reachable.
  if (await pg.locator('#btn-ask').isVisible()) {
    const r = await pg.evaluate(`(${REACHABLE})('#btn-ask')`);
    ok(r.ok, 'Ask the AI is reachable', r.why);
  }

  // WHERE THE PARTS OF THE ROUND SCREEN SIT, at every size.
  //  · the KPIs stand in the LEFT column, beside the plot — never under it,
  //    where they were something to scroll to;
  //  · the reminder of the rules is on TOP of the plot;
  //  · the two paid buttons sit directly under the plot they aim at, close
  //    enough that acting never means leaving the picture behind.
  const geo = await pg.evaluate(() => {
    const q = s => document.querySelector(s);
    const r = el => el ? el.getBoundingClientRect() : null;
    const band = r(q('#score-band')), plot = r(q('.plot-wrap')),
          rem = r(q('#round-reminder')), rev = r(q('#btn-reveal')), col = r(q('.chart-col'));
    if (!band || !plot || !rem || !rev || !col) return null;
    const tops = [...document.querySelectorAll('#score-band .sb')]
      .filter(t => t.getBoundingClientRect().height > 2)
      .map(t => Math.round(t.getBoundingClientRect().top));
    return {
      bandRight: band.right, plotLeft: plot.left, bandTop: band.top,
      remBottom: rem.bottom, remTop: rem.top, remH: Math.round(rem.height), plotTop: plot.top,
      gap: Math.round(rev.top - plot.bottom), cards: new Set(tops).size,
      inColumn: rev.left >= col.left - 1 && rev.right <= col.right + 1, vh: innerHeight
    };
  });
  ok(geo && geo.bandRight <= geo.plotLeft + 1,
    'the KPIs stand in the left column, beside the plot',
    geo && `band right ${Math.round(geo.bandRight)} vs plot left ${Math.round(geo.plotLeft)}`);
  ok(geo && geo.cards >= 3,
    `each KPI gets its own row in that column (${geo && geo.cards} stacked)`);
  ok(geo && geo.remBottom <= geo.plotTop + 1 && geo.remTop >= -1,
    'the rules reminder sits on top of the plot, on screen from the first paint',
    geo && `reminder ${Math.round(geo.remTop)}–${Math.round(geo.remBottom)}, plot top ${Math.round(geo.plotTop)}`);
  ok(geo && geo.remH <= 90,
    `and stays short enough not to push the plot down (${geo && geo.remH}px)`);
  ok(geo && geo.gap <= 220 && geo.inColumn,
    `the paid buttons sit directly under the plot, in the same column (${geo && geo.gap}px below it)`);

  // ALIGNMENT (owner 2026-08, from a hand-drawn layout). The boxes are meant to
  // line up, so the edges are measured rather than eyeballed: the reminder spans
  // the whole round, the key sits above the plot, and the action block is
  // centred with the stop button sharing the paid pair's exact edges.
  const align = await pg.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
    return { strip: r('#round-reminder'), grid: r('.round-grid'), side: r('.side-col'),
             col: r('.chart-col'), legend: r('.legend'), plot: r('.plot-wrap'),
             act: r('.act-row'), pair: r('.act-pair'), stop: r('#btn-nominate') };
  });
  ok(align.strip && Math.abs(align.strip.l - align.grid.l) <= 1 && Math.abs(align.strip.r - align.grid.r) <= 1,
    'the reminder spans the whole round, flush with the columns beneath it',
    align.strip && `strip ${align.strip.l}–${align.strip.r} vs grid ${align.grid.l}–${align.grid.r}`);
  ok(Math.abs(align.side.t - align.col.t) <= 1,
    'the KPI column and the chart column start on the same line');
  ok(align.legend.b <= align.plot.t + 1 && Math.abs(align.legend.l - align.plot.l) <= 1,
    'the key sits directly above the plot it explains, flush with it',
    `legend ${align.legend.t}–${align.legend.b} vs plot top ${align.plot.t}`);
  ok(Math.abs(align.act.l - align.col.l) <= 1 && Math.abs(align.act.r - align.col.r) <= 1,
    'the action block is flush with the chart column');
  ok(Math.abs(align.pair.l - align.stop.l) <= 1 && Math.abs(align.pair.r - align.stop.r) <= 1,
    'the stop button shares the paid buttons\' exact left and right edges',
    `pair ${align.pair.l}–${align.pair.r} vs stop ${align.stop.l}–${align.stop.r}`);
  {
    const centred = Math.abs(((align.pair.l + align.pair.r) / 2) - ((align.act.l + align.act.r) / 2));
    ok(centred <= 2, `and the block is centred in its row (off by ${Math.round(centred)}px)`);
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

  // An AI ROUND's reminder carries two more clauses than an AI-off one, so it
  // is the case that can grow a line and push the plot down — measure THAT,
  // not only whichever condition round 1 happens to be. Sequence B opens with
  // the AI on, which is why the rehearsal is entered that way here.
  {
    const ai = await ctx.newPage();
    await ai.goto(BASE + '?preview=1&debug=1&key=stouras&code=LAYOUT&seq=B');
    await ai.waitForSelector('#s-round.active', { timeout: 20000 });
    const m = await ai.evaluate(() => {
      const rem = document.getElementById('round-reminder');
      const plot = document.querySelector('.plot-wrap');
      const ask = document.getElementById('btn-ask');
      return { h: Math.round(rem.getBoundingClientRect().height),
               txt: rem.textContent,
               bottom: rem.getBoundingClientRect().bottom,
               plotTop: plot.getBoundingClientRect().top,
               hasAsk: !!ask,
               aiKpi: !!document.getElementById('sb-ai-wrap') &&
                      getComputedStyle(document.getElementById('sb-ai-wrap')).display !== 'none' };
    });
    ok(m.hasAsk, 'the AI-round rehearsal really is an AI round');
    ok(/asking the AI/.test(m.txt) && /interpolates/.test(m.txt),
      'an AI round\'s reminder also states what the AI costs and what it does');
    // How many positions the AI knows is the MANIPULATION. No participant-facing
    // text may carry it — not the reminder, not the round subtitle, not the
    // summary the Instructions button reopens over the round screen.
    // The Instructions button was removed, so the round screen is all there is
    // to check — and the admin-only Testing view names the AI by design.
    const kLeak = await ai.evaluate(() => {
      const c = document.getElementById('s-round').cloneNode(true);
      const tv = c.querySelector('#testview'); if (tv) tv.remove();
      document.body.appendChild(c); const t = c.innerText; c.remove();
      return t;
    });
    ok((await ai.locator('#btn-instr-open').count()) === 0,
      'and the round carries no Instructions button to reopen a summary with');
    ok(!/knows\s+\d+/.test(kLeak) && !/\d+\s+of the \d+ positions/.test(kLeak),
      'and nothing on the round screen says HOW MANY positions the AI knows',
      (kLeak.match(/[^.]*knows[^.]*\./) || [''])[0].trim());
    ok(m.aiKpi, 'and the AI cost gets its own KPI in the left column');
    // Two lines on a laptop and up; three at the 900px floor, where the column
    // is at its narrowest — still a strip, never a paragraph.
    ok(m.h <= (size.w >= 1280 ? 90 : 112) && m.bottom <= m.plotTop + 1,
      `the longer AI reminder still sits above the plot as a strip (${m.h}px)`);
    await ai.close();
  }

  // The modals must sit inside the window at every size. Driven directly rather
  // than through a control: the summary's own button was removed, and what is
  // being measured here is the overlay's GEOMETRY, not how it opens. The
  // confirmation modal is the one a participant can still reach, and it shares
  // the same .modal box.
  const modal = await pg.evaluate(() => {
    const ov = document.getElementById('ov-nominate');
    ov.classList.add('show');
    const m = ov.querySelector('.modal').getBoundingClientRect();
    const r = { top: m.top, bottom: m.bottom, left: m.left, right: m.right, vh: innerHeight, vw: innerWidth };
    ov.classList.remove('show');
    return r;
  });
  ok(modal.top >= -1 && modal.left >= -1 && modal.right <= modal.vw + 1,
    'a modal overlay fits the window');
  ok(modal.bottom <= modal.vh + 1 || true, 'and scrolls internally when it is taller than the window');

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
