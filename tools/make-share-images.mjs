#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   stouras.com — the pictures a link preview shows.

       node tools/make-share-images.mjs             # write the square cards
       node tools/make-share-images.mjs --wide      # …and redraw the wide ones
       node tools/make-share-images.mjs --check     # write nothing, report
       node tools/make-share-images.mjs --only lit  # one page's cards

   WHY THIS EXISTS. Every shareable page carries TWO pictures, and they are
   two because the platforms crop differently and one asset cannot serve both.

     <page>/og-image.jpg      1200x630 (2400x1260 for /lit)  — the WIDE card.
        Facebook, Messenger, WhatsApp, LinkedIn, Telegram, Slack and iMessage
        all render an og:image at roughly 1.91:1 and letterbox anything else.

     <page>/share-square.jpg  800x800 — the SQUARE thumbnail. WeChat draws a
        link as a small near-square tile beside the title and CENTRE-CROPS
        whatever it is given: hand it the wide card and the crop keeps the
        middle square, which on the Lit card is the word "Research" and
        nothing else. It is offered through <link rel="image_src"> and
        <meta itemprop="image">, which WeChat prefers and the wide-card
        platforms ignore, so each gets the one it can use.

   WHY 800x800 AND NOT 300x300. The one hard number Tencent publishes — 32 KB
   — governs the Open-SDK path, where a SENDING APP hands WeChat a thumbnail
   it has already encoded. Nothing here is on that path: these files are
   fetched from a URL, for which no ceiling is published, and the floor that
   IS repeated everywhere is 300x300 (smaller is skipped outright). 800 is
   comfortably above the floor, gives a retina tile, and still lands well
   under 100 KB — which the share-check enforces, along with the floor.

   They are GENERATED rather than hand-drawn so the wording can be corrected
   without a design tool — which is the whole reason this file exists. The
   Lit's card had been telling everyone it saw for months that the catalogue
   covers "EIGHT SOURCES" and lives at "stouras.com/fun/lit": both were true
   when it was drawn, and neither had been true since the app was promoted out
   of /fun/. A card that cannot be regenerated is a card that goes stale.

   Rendering is Chromium via Playwright with the pages' own Google Fonts, so a
   card is set in the typeface the page it opens is set in. Nothing here runs
   in CI: run it by hand, LOOK at what came out, and commit it.

   The declared og:image:width/height in every page's head must match the real
   pixels of the file. `node tools/share-check.mjs` measures that and fails
   when the two disagree, so a card regenerated at a new size cannot ship with
   the old numbers still in the pages.
   --------------------------------------------------------------------------- */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const WIDE_TOO = process.argv.includes('--wide');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const dataUri = (rel, mime) =>
  `data:${mime};base64,` + readFileSync(path.join(ROOT, rel)).toString('base64');

const GF = (families) =>
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;

const RESET = `*{margin:0;padding:0;box-sizing:border-box}
  html,body{overflow:hidden}
  body{-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}`;

/* ============================================================ /lit — The Lit
   Claret and antique gold, the identity in lit/index.html: --navy #7d1d3f,
   --accent #c9a24b. The gradient is sampled from the card this replaces. */

const LIT_FONTS = GF('family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600' +
  '&family=Work+Sans:ital,wght@0,300..700;1,300..600');

/* Nothing on this card may be a COUNT. "Eight sources" was a count, and the
   catalogue passed it within a year; the journal LISTS it filters by do not
   move. */
const LIT_EYEBROW = 'UTD24 · FT50 · ABS · VIA CROSSREF';
const LIT_SUB = 'Search the UTD24, FT50 and ABS journals in one place — with journal, editor &amp; area filters and BibTeX export.';
/* All TEN native sources, then the catalogue they sit inside. Nine of ten read
   as a complete list and is not one — INFORMS Transactions on Education was
   missing from the first draft of this card, which is the same species of
   error as the "eight sources" it replaced. If a source is added, add it
   here. */
const LIT_CHIPS = [
  ['Management Science', true], ['Operations Research', false], ['Marketing Science', false],
  ['M&amp;SOM', false], ['POM', false], ['ISR', false], ['Strategy Science', false],
  ['INFORMS Trans. on Education', false], ['PNAS', false], ['ACM EC', false],
  ['the FT50', false],
];

const litShell = (w, h, css, body) => `<!doctype html><meta charset="utf-8">
${LIT_FONTS}
<style>
  ${RESET}
  html,body{width:${w}px;height:${h}px}
  body{
    font-family:'Work Sans',system-ui,sans-serif;color:#fff;
    background:linear-gradient(135deg,#7d1e40 0%,#6d1835 42%,#4f1222 100%);
  }
  ${css}
</style>
${body}`;

const LIT_WIDE = litShell(2400, 1260, `
  body{padding:110px 140px 96px;justify-content:space-between}
  .block{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:2010px}
  .eyebrow{font-size:38px;font-weight:600;letter-spacing:.20em;color:#d3a3b3;text-transform:uppercase}
  .rule{width:190px;height:7px;background:#c9a24b;border-radius:4px;margin:58px 0 26px}
  h1{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:126px;line-height:1.06;letter-spacing:-.015em}
  h1 em{font-style:italic;color:#c9a24b}
  .sub{font-size:52px;line-height:1.34;color:#f3e2e8;max-width:1900px;margin-top:44px;font-weight:300}
  .chips{display:flex;flex-wrap:wrap;gap:20px;margin-top:56px;max-width:2100px}
  .chip{border:2px solid rgba(255,255,255,.34);border-radius:999px;padding:16px 34px;font-size:38px;color:#fbeff3}
  .chip.on{background:#c9a24b;border-color:#c9a24b;color:#3c0f1e;font-weight:600}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:36px}
  .foot b{font-weight:700;color:#f6e6ec}
  .foot span{color:#cfa0b0}
  .mono{position:absolute;top:112px;right:140px;width:184px;height:184px;border:3px solid rgba(201,162,75,.55);
        border-radius:38px;display:flex;align-items:center;justify-content:center;
        font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:700;font-size:92px;color:#c9a24b}
`, `
<div class="mono">Lit</div>
<div class="block">
  <div class="eyebrow">${LIT_EYEBROW}</div>
  <div class="rule"></div>
  <h1><em>The Lit</em> — Research Paper Browser</h1>
  <div class="sub">${LIT_SUB}</div>
  <div class="chips">${LIT_CHIPS.map(([t, on]) =>
    `<div class="chip${on ? ' on' : ''}">${t}</div>`).join('')}</div>
</div>
<div class="foot"><b>stouras.com/lit</b><span>stouras.com</span></div>
`);

/* The square carries LESS, not the same thing smaller: at the size WeChat
   draws it, ten chips and a two-line subtitle are grey mush. */
const LIT_SQUARE = litShell(800, 800, `
  body{align-items:center;justify-content:center;padding:60px;text-align:center}
  .mono{width:208px;height:208px;border:5px solid rgba(201,162,75,.6);border-radius:46px;
        display:flex;align-items:center;justify-content:center;
        font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:700;font-size:112px;color:#c9a24b}
  h1{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:600;font-size:104px;
     color:#c9a24b;margin-top:52px;line-height:1}
  .sub{font-family:'Fraunces',Georgia,serif;font-size:60px;margin-top:14px;line-height:1.18}
  .host{font-size:32px;color:#d9aebc;margin-top:44px;font-weight:600}
`, `
<div class="mono">Lit</div>
<h1>The Lit</h1>
<div class="sub">Research Paper Browser</div>
<div class="host">stouras.com/lit</div>
`);

/* ============================================== / — the homepage (a profile) */

const HOME_FONTS = GF('family=Inter:wght@400;500;600;700;800');
const PORTRAIT = dataUri('images/Kostas Stouras.jpg', 'image/jpeg');

const HOME_SQUARE = `<!doctype html><meta charset="utf-8">
${HOME_FONTS}
<style>
  ${RESET}
  html,body{width:800px;height:800px}
  body{font-family:'Inter',system-ui,sans-serif;color:#fff;text-align:center;
       align-items:center;justify-content:center;padding:56px;
       background:radial-gradient(120% 100% at 20% 0%,#173f74 0%,rgba(23,63,116,0) 58%),
                  linear-gradient(160deg,#0e2748 0%,#09182f 60%,#060f1e 100%)}
  .ring{width:300px;height:300px;border-radius:50%;border:8px solid #fff;overflow:hidden;
        box-shadow:0 18px 48px rgba(0,0,0,.35)}
  .ring img{width:100%;height:100%;object-fit:cover;object-position:50% 22%;display:block}
  h1{font-size:62px;font-weight:800;line-height:1.1;margin-top:46px;letter-spacing:-.02em}
  .role{font-size:36px;color:#9dc0ef;margin-top:18px;font-weight:500}
  .school{font-size:30px;color:#cfd9e8;margin-top:10px;font-weight:400;line-height:1.3}
  .host{margin-top:38px;font-size:28px;font-weight:600;color:#eaf0f8;
        border:2px solid rgba(255,255,255,.35);border-radius:999px;padding:12px 30px}
</style>
<div class="ring"><img src="${PORTRAIT}" alt=""></div>
<h1>Konstantinos I.<br>Stouras</h1>
<div class="role">Assistant Professor of Management</div>
<div class="school">UCD Michael Smurfit<br>Graduate Business School</div>
<div class="host">stouras.com</div>`;

/* ================================================= /fun — the landing page */

const FUN_SQUARE = `<!doctype html><meta charset="utf-8">
${HOME_FONTS}
<style>
  ${RESET}
  html,body{width:800px;height:800px}
  body{font-family:'Inter',system-ui,sans-serif;color:#fff;text-align:center;
       align-items:center;justify-content:center;padding:56px;
       background:linear-gradient(180deg,#0d3b91 0%,#092e72 100%)}
  .stack{position:relative;width:290px;height:290px}
  .card{position:absolute;inset:0;border-radius:44px}
  .card.a{background:#4cbfa6;transform:rotate(-9deg) translate(-14px,-6px)}
  .card.b{background:#ef7f3c;transform:rotate(8deg) translate(18px,10px)}
  .card.c{background:#fff;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr 1fr;
          place-items:center;padding:44px}
  .pip{width:52px;height:52px;border-radius:50%;background:#123f8c}
  .pip.mid{grid-column:1 / span 2;background:#ffb703}
  h1{font-size:74px;font-weight:800;margin-top:54px;letter-spacing:-.02em}
  .sub{font-size:34px;color:#c4d6f5;margin-top:16px;line-height:1.3;font-weight:400}
  .host{margin-top:40px;font-size:28px;font-weight:600;color:#eaf0f8;
        border:2px solid rgba(255,255,255,.35);border-radius:999px;padding:12px 30px}
</style>
<div class="stack">
  <div class="card a"></div><div class="card b"></div>
  <div class="card c">
    <div class="pip"></div><div class="pip"></div>
    <div class="pip mid"></div>
    <div class="pip"></div><div class="pip"></div>
  </div>
</div>
<h1>Fun Projects</h1>
<div class="sub">Games and interactive tools<br>I have been building for fun.</div>
<div class="host">stouras.com/fun</div>`;

/* ============ /sustainable-supply-chains — the class simulation's front door
   Terracotta on warm near-black, the app's own --accent #c8562a with DM Serif
   Display, because an instructor pastes this URL to a whole cohort and the
   card should look like the thing that opens. */

const SSC_FONTS = GF('family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300..600');

const sscShell = (w, h, css, body) => `<!doctype html><meta charset="utf-8">
${SSC_FONTS}
<style>
  ${RESET}
  html,body{width:${w}px;height:${h}px}
  body{
    font-family:'DM Sans',system-ui,sans-serif;color:#f0ede6;
    background:
      radial-gradient(90% 70% at 82% 6%, rgba(200,86,42,.34) 0%, rgba(200,86,42,0) 60%),
      linear-gradient(150deg,#191512 0%,#0f0e0c 62%,#140f0c 100%);
  }
  .route{stroke:#c8562a;stroke-width:6;fill:none;stroke-linecap:round}
  .node{fill:#e8784f}
  ${css}
</style>
${body}`;

const SSC_ROUTE = (s) => `<svg width="${s}" height="${Math.round(s * 0.42)}" viewBox="0 0 300 126" aria-hidden="true">
  <path class="route" d="M18 104 C 78 104, 78 44, 138 44 S 222 22, 282 22"></path>
  <circle class="node" cx="18" cy="104" r="13"></circle>
  <circle class="node" cx="138" cy="44" r="11"></circle>
  <circle class="node" cx="282" cy="22" r="13"></circle>
</svg>`;

const SSC_WIDE = sscShell(1200, 630, `
  body{padding:78px 84px;justify-content:space-between}
  .eyebrow{font-size:21px;font-weight:600;letter-spacing:.18em;color:#c8956f;text-transform:uppercase}
  h1{font-family:'DM Serif Display',Georgia,serif;font-size:80px;line-height:1.04;letter-spacing:-.015em;margin-top:26px}
  h1 em{font-style:italic;color:#e8784f}
  .sub{font-size:27px;line-height:1.45;color:#d6cec2;max-width:770px;margin-top:24px;font-weight:300}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:20px;color:#b6ab9e}
  .host{font-weight:600;color:#f0ede6;font-size:21px}
  .svgwrap{position:absolute;bottom:92px;right:84px;opacity:.95}
`, `
<div class="svgwrap">${SSC_ROUTE(300)}</div>
<div>
  <div class="eyebrow">A class simulation · stouras.com</div>
  <h1>Sustainable <em>Supply Chains</em></h1>
  <div class="sub">Student teams run competing firms — sourcing worldwide, choosing sea or air,
    and pricing each market against CO<sub>2</sub>, ESG and tariffs.</div>
</div>
<div class="foot"><span class="host">stouras.com/sustainable-supply-chains</span></div>
`);

const SSC_SQUARE = sscShell(800, 800, `
  body{align-items:center;justify-content:center;padding:64px;text-align:center}
  h1{font-family:'DM Serif Display',Georgia,serif;font-size:74px;line-height:1.08;margin-top:44px;letter-spacing:-.015em}
  h1 em{font-style:italic;color:#e8784f}
  .sub{font-size:30px;color:#d6cec2;margin-top:20px;font-weight:300;line-height:1.35}
  .host{margin-top:40px;font-size:24px;font-weight:600;color:#f0ede6;
        border:2px solid rgba(240,237,230,.32);border-radius:999px;padding:12px 28px}
`, `
${SSC_ROUTE(380)}
<h1>Sustainable<br><em>Supply Chains</em></h1>
<div class="sub">A global sourcing<br>class simulation</div>
<div class="host">stouras.com</div>
`);

/* --------------------------------------------------------------- the images */

const IMAGES = [
  { key: 'lit', file: 'lit/og-image.jpg', html: LIT_WIDE, w: 2400, h: 1260, quality: 86, wide: true },
  { key: 'lit', file: 'lit/share-square.jpg', html: LIT_SQUARE, w: 800, h: 800, quality: 88 },
  { key: 'home', file: 'images/share-square.jpg', html: HOME_SQUARE, w: 800, h: 800, quality: 88 },
  { key: 'fun', file: 'fun/share-square.jpg', html: FUN_SQUARE, w: 800, h: 800, quality: 88 },
  { key: 'ssc', file: 'sustainable-supply-chains/og-image.jpg', html: SSC_WIDE, w: 1200, h: 630, quality: 88, wide: true },
  { key: 'ssc', file: 'sustainable-supply-chains/share-square.jpg', html: SSC_SQUARE, w: 800, h: 800, quality: 88 },
].filter(s => (!ONLY || s.key === ONLY) && (CHECK || WIDE_TOO || !s.wide));

/* ------------------------------------------------------------------ the run */

async function browser() {
  const require = (await import('node:module')).createRequire(import.meta.url);
  let playwright;
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { playwright = require(id); break; } catch { /* try the next */ }
  }
  if (!playwright) {
    console.log('playwright is not installed — `npm install playwright` to regenerate the share images');
    process.exit(CHECK ? 0 : 1);
  }
  const opts = {};
  if (process.env.PW_CHROMIUM) opts.executablePath = process.env.PW_CHROMIUM;
  return playwright.chromium.launch(opts);
}

const br = await browser();
const tmp = mkdtempSync(path.join(tmpdir(), 'share-cards-'));
let changed = 0;

for (const spec of IMAGES) {
  const page = await br.newPage({ viewport: { width: spec.w, height: spec.h }, deviceScaleFactor: 1 });
  const html = path.join(tmp, 'card.html');
  writeFileSync(html, spec.html);
  /* The cards are set in the site's own Google Fonts, so `networkidle`
     never arrives on a machine that cannot reach fonts.googleapis.com.
     That is a reason to fall back to the local stack and carry on — the
     card comes out in a substitute face, which `--check` will report as
     a difference — not a reason to die on an unhandled timeout. */
  try { await page.goto('file://' + html, { waitUntil: 'networkidle' }); }
  catch { console.log('  (fonts did not load — the card below is set in a fallback face)'); }
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'jpeg', quality: spec.quality });
  await page.close();

  const abs = path.join(ROOT, spec.file);
  const before = existsSync(abs) ? readFileSync(abs) : null;
  const same = before && before.equals(buf);
  if (CHECK) {
    console.log(`${same ? 'unchanged' : 'DIFFERS '}  ${spec.file}  ${spec.w}x${spec.h}  ${buf.length} bytes`);
    if (!same) changed++;
  } else {
    writeFileSync(abs, buf);
    console.log(`wrote ${spec.file}  ${spec.w}x${spec.h}  ${buf.length} bytes`);
  }
}

rmSync(tmp, { recursive: true, force: true });
await br.close();

if (CHECK && changed) {
  console.log(`\n${changed} image(s) would change — run without --check, look at them, and commit.`);
}
