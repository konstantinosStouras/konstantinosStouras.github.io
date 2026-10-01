#!/usr/bin/env node
/* Draws the site's pictures from the logo, so they always match:
     og-image.jpg          1200x630  the wide link-preview card (WhatsApp, LinkedIn, Facebook, Slack, X)
     share-square.jpg      800x800   the square thumbnail some clients centre-crop
     apple-touch-icon.png  180x180   the icon an iPhone uses on the home screen
     favicon-32.png        32x32     the tab icon for browsers without SVG favicons
     assets/img/logos/app-icon-1024.png  1024x1024  the icon to upload to the Meta (Facebook)
                                  and LinkedIn developer apps
   favicon.svg is hand-written (a simplified orbit mark) and not redrawn here.
   Usage: node tools/make-share-images.mjs   (needs Playwright + Chromium)
   Look at the pictures before committing them. */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = new Function('window', readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8') + '; return window.SEMFE;')({});
const logo = 'data:image/png;base64,' + readFileSync(path.join(ROOT, 'assets/img/logos/logo.png')).toString('base64');
const favicon = readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
const host = C.siteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(w, h, square) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{font-family:Manrope,Arial,sans-serif;color:#fff;position:relative;
    background:radial-gradient(900px 500px at 92% -10%,rgba(227,169,56,.24),transparent 60%),
      radial-gradient(700px 420px at -10% 110%,rgba(64,150,255,.28),transparent 60%),
      linear-gradient(160deg,#0a2240 0%,#12355b 60%,#1b4f86 100%)}
  .grid{position:absolute;inset:0;opacity:.14;background-image:linear-gradient(rgba(255,255,255,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.35) 1px,transparent 1px);background-size:44px 44px;
    -webkit-mask-image:radial-gradient(ellipse at 60% 40%,#000 20%,transparent 75%)}
  .in{position:absolute;inset:0;display:flex;align-items:center;gap:56px;box-sizing:border-box;
    ${square ? 'flex-direction:column;justify-content:center;text-align:center;gap:26px;padding:56px' : 'justify-content:space-between;padding:64px 84px'}}
  .logo{flex:none;width:${square ? 250 : 380}px;height:${square ? 250 : 380}px;border-radius:50%;background:#fff;padding:${square ? 12 : 18}px;box-sizing:border-box;
    box-shadow:0 30px 70px rgba(0,0,0,.35),0 0 0 12px rgba(255,255,255,.07),0 0 0 26px rgba(227,169,56,.12)}
  .logo img{width:100%;height:100%;object-fit:contain}
  .kicker{font-size:${square ? 24 : 27}px;letter-spacing:.2em;font-weight:800;color:#e3a938;margin-bottom:${square ? 8 : 14}px}
  h1{font-size:${square ? 76 : 96}px;line-height:1;margin:0 0 ${square ? 16 : 22}px;font-weight:800;letter-spacing:-.01em}
  .sub{font-size:${square ? 25 : 30}px;font-weight:600;opacity:.92;line-height:1.3;max-width:${square ? 640 : 640}px;${square ? 'margin:0 auto' : ''}}
  .url{position:absolute;left:${square ? 0 : 84}px;right:0;bottom:${square ? 30 : 40}px;font-size:${square ? 21 : 24}px;font-weight:600;opacity:.72;${square ? 'text-align:center' : ''}}
</style></head><body><div class="grid"></div><div class="in">
  ${square ? `<div class="logo"><img src="${logo}"></div>` : ''}
  <div><div class="kicker">ΣΥΛΛΟΓΟΣ ΔΙΠΛΩΜΑΤΟΥΧΩΝ</div><h1>ΣΕΜΦΕ ΕΜΠ</h1>
    <div class="sub">Απόφοιτοι της Σχολής Εφαρμοσμένων Μαθηματικών και Φυσικών Επιστημών</div></div>
  ${square ? '' : `<div class="logo"><img src="${logo}"></div>`}
</div><div class="url">${esc(host)}</div></body></html>`;
}
const svgPage = size => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${favicon}</body></html>`;
const appIcon = () => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden}
  .c{width:1024px;height:1024px;display:grid;place-items:center;background:linear-gradient(160deg,#0a2240,#1b4f86)}
  .l{width:860px;height:860px;border-radius:50%;background:#fff;padding:40px;box-sizing:border-box}.l img{width:100%;height:100%;object-fit:contain}</style></head>
  <body><div class="c"><div class="l"><img src="${logo}"></div></div></body></html>`;
const touchPage = () => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:180px;height:180px;overflow:hidden;background:#0a2240}
  .c{width:180px;height:180px;display:grid;place-items:center;background:linear-gradient(160deg,#0a2240,#1b4f86)}
  .l{width:148px;height:148px;border-radius:50%;background:#fff;padding:8px;box-sizing:border-box}.l img{width:100%;height:100%;object-fit:contain}</style></head>
  <body><div class="c"><div class="l"><img src="${logo}"></div></div></body></html>`;

let pw;
for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(id); break; } catch {} }
if (!pw) { console.error('playwright is not installed: npm install playwright'); process.exit(1); }
const tmp = mkdtempSync(path.join(tmpdir(), 'semfe-share-'));
const browser = await pw.chromium.launch();
try {
  const jobs = [
    ['og-image.jpg', 1200, 630, card(1200, 630, false), 'jpeg'],
    ['share-square.jpg', 800, 800, card(800, 800, true), 'jpeg'],
    ['apple-touch-icon.png', 180, 180, touchPage(), 'png'],
    ['favicon-32.png', 32, 32, svgPage(32), 'png'],
    ['assets/img/logos/app-icon-1024.png', 1024, 1024, appIcon(), 'png']
  ];
  for (const [file, w, h, html, type] of jobs) {
    const f = path.join(tmp, path.basename(file) + '.html');
    writeFileSync(f, html);
    const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await pg.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' }).catch(() => pg.goto(pathToFileURL(f).href));
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(300);
    const buf = await pg.screenshot(type === 'jpeg' ? { type, quality: 86 } : { type, omitBackground: file === 'favicon-32.png' });
    writeFileSync(path.join(ROOT, file), buf);
    console.log(`${file} ${w}x${h} ${(buf.length / 1024).toFixed(0)} KB`);
    await pg.close();
  }
} finally { await browser.close(); }
