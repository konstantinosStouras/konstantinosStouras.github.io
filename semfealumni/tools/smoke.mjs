#!/usr/bin/env node
/* SEMFE Alumni smoke test: opens the site in Chromium, served under the
   /semfealumni/ sub-path exactly as GitHub Pages serves it, with sign-in NOT
   configured (config.js still holds PASTE_ placeholders; if it ever holds a
   real config, this test rewrites the copy it serves back to placeholders, so
   it always covers the "registration opens soon" mode).

   The server is Python's http.server with a small handler that behaves like
   GitHub Pages: the site lives only under /semfealumni/ (a temp folder holds a
   `semfealumni` symlink to this repo), a missing path gets the site's own
   404.html with status 404, a folder without index.html is a 404 (Pages never
   lists folders), and whatever Jekyll would not publish (names starting with
   `_` or `.`, the `exclude:` list in _config.yml) is a 404 too. Third-party
   requests are stubbed (YouTube embeds…) so the run is hermetic; Google Fonts
   are fetched once and replayed from memory, and a network failure there is the
   one console error allowed.

     1. every served page: no script errors, every same-origin request 200,
        every same-origin link/asset resolves, every #fragment has a target;
        the 404 page at a deep path renders with its styles and working links;
        Jekyll would not publish any node_modules folder
     2. ten viewports x seven pages: no sideways scroll, nothing past the right
        edge, every button/link outside running prose at least 40px tall, the
        headline on the first screen of a portrait device
     3. the header: one row of links at >= 1101px, the menu button below that
     4. the sign-in dialog in its "opens soon" state
     5. the photo lightbox
     6. the announcements filter; the support page's copy buttons and form link
     7. WCAG text contrast in dark mode on home, support and account (+ the
        sign-in dialog), plus governance and blog; the same pages in light mode
        are checked too and reported as "light (extra)"
     8. prefers-reduced-motion and print
   Writes shot-desktop.png / shot-phone.png beside this file (gitignored).

   Usage: node tools/smoke.mjs     (needs Playwright + Chromium, python3)
          SMOKE_VERBOSE=1 also prints every contrast value measured in pixels */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(id); break; } catch {} }
if (!pw) { console.error('playwright is not installed: npm install playwright'); process.exit(1); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SUB = '/semfealumni/';
const read = f => readFileSync(path.join(ROOT, f), 'utf8');

/* ---- the site's own settings --------------------------------------------- */
const CONFIG_SRC = read('assets/js/config.js');
const C = new Function('window', CONFIG_SRC + '; return window.SEMFE;')({});
const isPaste = v => String(v || '').indexOf('PASTE_') !== -1;
const CONFIGURED = !isPaste(C.FIREBASE.apiKey) && !isPaste(C.FIREBASE.projectId);
/* force the unconfigured mode whatever config.js holds */
const SERVED_CONFIG = CONFIGURED
  ? CONFIG_SRC.replace(/apiKey:\s*'[^']*'/, "apiKey: 'PASTE_API_KEY'").replace(/projectId:\s*'[^']*'/, "projectId: 'PASTE_PROJECT_ID'")
  : null;
const PROVIDERS = (C.AUTH_PROVIDERS || []).filter(k => ['google', 'facebook', 'linkedin'].includes(k));

/* ---- what GitHub Pages (Jekyll) publishes --------------------------------- */
const EXCLUDE = [];
{
  let inList = false;
  for (const line of read('_config.yml').split('\n')) {
    if (/^exclude:\s*$/.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const m = line.match(/^\s+-\s*["']?([^"'#]+?)["']?\s*$/);
    if (m) EXCLUDE.push(m[1].replace(/\/$/, ''));
    else if (/^\S/.test(line)) inList = false;
  }
}
const published = rel => !rel.split('/').some(s => s[0] === '.' || s[0] === '_') &&
  !EXCLUDE.some(e => rel === e || rel.startsWith(e + '/'));
const PAGES = [], LEAKS = [];
(function walk(dir, rel) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + f.name : f.name;
    if (!published(r) || r === 'tools' || r === '_src') continue;
    if (f.isDirectory()) { if (f.name === 'node_modules') LEAKS.push(r + '/'); else walk(path.join(dir, f.name), r); }
    else if (f.name.endsWith('.html')) PAGES.push(r);
  }
})(ROOT, '');
PAGES.sort();
const urlOf = rel => SUB + (rel === 'index.html' ? '' : rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel);
const POSTS = PAGES.filter(p => /^blog\/\d{4}\//.test(p)).sort();
const LAYOUT_PAGES = [
  ['home', 'index.html'], ['governance', 'governance/index.html'], ['support', 'support/index.html'],
  ['fotothiki', 'fotothiki/index.html'], ['blog', 'blog/index.html'], ['post', POSTS[POSTS.length - 1]],
  ['account', 'account/index.html']
];

/* ---- the server ------------------------------------------------------------ */
const PY = String.raw`
import http.server, os, sys, urllib.parse
root, excl = sys.argv[1], [e for e in sys.argv[2].split('|') if e]
BASE = '/semfealumni/'
PAGE404 = os.path.join(root, 'semfealumni', '404.html')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def log_message(self, *a): pass
    def unpublished(self):
        p = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if not p.startswith(BASE): return False
        rel = p[len(BASE):].strip('/')
        if any(s[:1] in ('.', '_') for s in rel.split('/') if s): return True
        return any(rel == e or rel.startswith(e + '/') for e in excl)
    def send_head(self):
        if self.unpublished():
            self.send_error(404); return None
        return super().send_head()
    def list_directory(self, path):
        self.send_error(404); return None
    def send_error(self, code, message=None, explain=None):
        p = urllib.parse.urlsplit(self.path).path
        if code == 404 and p.startswith(BASE) and os.path.isfile(PAGE404):
            body = open(PAGE404, 'rb').read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD': self.wfile.write(body)
            return
        super().send_error(code, message, explain)
class S(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionResetError, BrokenPipeError)): return   # the browser cancelled a download
        super().handle_error(request, client_address)
srv = S(('127.0.0.1', 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
`;
const TMP = mkdtempSync(path.join(os.tmpdir(), 'semfe-smoke-'));
const LINK = path.join(TMP, 'semfealumni');
symlinkSync(ROOT, LINK, 'dir');
const srv = spawn('python3', ['-c', PY, TMP, EXCLUDE.join('|')], { stdio: ['ignore', 'pipe', 'inherit'] });
const cleanup = () => { try { srv.kill(); } catch {} try { unlinkSync(LINK); rmdirSync(TMP); } catch {} };
process.on('exit', cleanup);
const PORT = await new Promise((resolve, reject) => {
  let buf = '';
  srv.stdout.on('data', d => { buf += d; const m = buf.match(/^(\d+)\s/); if (m) resolve(+m[1]); });
  srv.on('exit', c => reject(new Error('python3 server exited with ' + c)));
  setTimeout(() => reject(new Error('python3 server did not start')), 10000);
});
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ---- reporting -------------------------------------------------------------- */
let fails = 0, passes = 0;
const t = (c, m) => { console.log((c ? 'ok    ' : 'FAIL  ') + m); if (c) passes++; else fails++; return c; };
const note = m => console.log('note  ' + m);
const section = m => console.log('\n== ' + m);
const list = (a, n = 6) => a.length ? ': ' + a.slice(0, n).join(' | ') + (a.length > n ? ` | … +${a.length - n} more` : '') : '';

/* ---- helpers that run inside the page ----------------------------------------
   Installed with addInitScript as window.__smoke. Exclusion rule for the 40px
   targets: WCAG 2.5.8's "inline" exception. A link is exempt when it is laid
   out inline (display: inline) AND the line box it sits in carries words of
   ordinary text that belong to no other link or button, i.e. it is part of a
   sentence and its height is set by the text around it. A link that is the
   whole content of its block (a list of links, a footer column) or that only
   has punctuation around it ("A · B") is a standalone target and must be 40px.
   Buttons are never exempt. Also skipped: controls not rendered (display:none,
   inside [hidden], zero size, visibility:hidden), and the skip link, which is
   parked off-screen until it is focused. */
function LIB() {
  const disp = el => getComputedStyle(el).display;
  const blockFrom = el => { while (el && (disp(el) === 'inline' || disp(el) === 'contents')) el = el.parentElement; return el; };
  const desc = e => {
    if (!e || !e.tagName) return '?';
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls.length ? '.' + cls.join('.') : '');
  };
  const named = e => e.id || (typeof e.className === 'string' && e.className.trim());
  const sig = e => {      // "nearest named ancestor … parent > element"
    const p = e.parentElement;
    let near = p && p.parentElement;
    while (near && near !== document.body && !named(near)) near = near.parentElement;
    return (near && near !== document.body ? desc(near) + ' … ' : '') + (p ? desc(p) + ' > ' : '') + desc(e);
  };
  const words = /\p{L}{2,}/u;
  function inProse(e) {
    if (e.tagName !== 'A' || disp(e) !== 'inline') return false;
    const blk = blockFrom(e.parentElement);
    if (!blk) return false;
    const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!words.test(n.nodeValue)) continue;
      const tgt = n.parentElement.closest('a, button, select, summary');
      if (tgt && blk.contains(tgt)) continue;
      if (blockFrom(n.parentElement) !== blk) continue;   // text of a nested block: another line
      return true;
    }
    return false;
  }
  function targets(root) {
    const vw = innerWidth, out = [];
    for (const e of (root || document.body).querySelectorAll('a[href], button, summary, select, [role="button"], [role="tab"]')) {
      const b = e.getBoundingClientRect();
      if (b.width <= 1 || b.height <= 1 || b.right <= 0 || b.left >= vw) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || +cs.opacity === 0 || e.matches('.skip')) continue;
      if (inProse(e)) continue;
      if (b.height + 0.1 < 40) out.push({ sig: sig(e), text: (e.innerText || e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28), h: +b.height.toFixed(1) });
    }
    return out;
  }
  function layout() {
    const vw = innerWidth, vh = innerHeight, past = [];
    for (const e of document.body.querySelectorAll('*')) {
      const b = e.getBoundingClientRect();
      if ((b.width === 0 && b.height === 0) || b.right <= vw + 0.5) continue;
      if (e.parentElement && e.parentElement.closest('svg')) continue;  // parts of an icon; the <svg> itself is measured
      if (getComputedStyle(e).visibility === 'hidden') continue;
      let clipped = false;   // cut off by a scrolling/clipping box that itself fits (body/html do not count)
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= vw + 0.5) { clipped = true; break; }
      }
      if (!clipped) past.push(sig(e) + ' right=' + Math.round(b.right));
    }
    const h1 = document.querySelector('main h1') || document.querySelector('h1');
    const hb = h1 && h1.getBoundingClientRect();
    return { vw, vh, scrollW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, past,
      small: targets(document.body), h1: hb ? { top: hb.top, bottom: hb.bottom } : null };
  }

  /* WCAG 2.x contrast, in two steps.
     contrast(): every visible run of text (and generated ::before/::after text
     with a counter or letters) with its colour, size and weight. The background
     is found by painting the ancestors' backgrounds bottom-up. Where that is a
     single solid colour the ratio is exact. Where a gradient is involved the
     run is marked `grad` and its text boxes are recorded, and sample() then
     measures the REAL pixels behind them, on a screenshot taken with all text
     made transparent; the worst pixel counts. Text colour alpha and ancestor
     opacity are composited in. Exempt, as WCAG 1.4.3 allows: text in disabled
     controls, and aria-hidden decoration (the "›" between breadcrumbs). */
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (t, b) => [0, 1, 2].map(i => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
  const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const css = c => 'rgb(' + c.slice(0, 3).map(Math.round).join(', ') + ')';
  function contrast(rootSel) {
    const root = document.querySelector(rootSel) || document.body;
    const layers = img => { const out = []; let d = 0, cur = ''; for (const ch of img) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()).filter(Boolean); };
    const uniq = a => [...new Map(a.map(c => [c.slice(0, 3).map(Math.round).join(','), c])).values()];
    const cache = new Map();
    function behind(el) {           // -> { set: [possible opaque colours], grad: bool }
      if (!el) return { set: [[255, 255, 255, 1]], grad: false };
      if (cache.has(el)) return cache.get(el);
      const up = behind(el.parentElement);
      let set = up.set, grad = up.grad;
      const cs = getComputedStyle(el), bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) { if (bg[3] >= 1) { set = [bg]; grad = false; } else set = set.map(b => over(bg, b)); }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        for (const layer of layers(cs.backgroundImage).reverse()) {     // bottom layer first
          if (!/gradient\(/.test(layer)) { grad = true; continue; }     // an image: only pixels can tell
          const stops = (layer.match(/rgba?\([^)]*\)/g) || []).map(parse);
          if (!stops.length) continue;
          grad = true;
          if (stops.every(s => s[3] >= 1)) { set = stops; continue; }
          const next = set.slice();
          for (const s of stops) if (s[3] > 0) for (const b of set) next.push(over(s, b));
          set = next;
        }
        set = uniq(set);
      }
      const r = { set, grad };
      cache.set(el, r);
      return r;
    }
    const opacity = el => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const probe = document.createElement('span'); probe.style.color = 'var(--muted, transparent)'; document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color; probe.remove();
    const shown = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && r.width >= 2 && r.height >= 2 && r.right > 0; };
    const skip = el => el.closest('script, style, noscript, template, svg, [hidden], [aria-hidden="true"], .skip, .sr-only, button[disabled], [aria-disabled="true"]');
    const boxes = list => [...list].filter(b => b.width >= 1 && b.height >= 1).map(b => [b.left + scrollX, b.top + scrollY, b.width, b.height]);
    const runs = [];
    function check(el, cs, text, pseudo, node) {
      const f0 = parse(cs.color); if (!f0 || f0[3] === 0) return;
      const fg = [f0[0], f0[1], f0[2], f0[3] * opacity(el)];
      const b0 = behind(el);
      let bgs = b0.set;
      if (pseudo) { const pb = parse(cs.backgroundColor); if (pb && pb[3] > 0) bgs = bgs.map(b => over(pb, b)); }
      let worst = Infinity, wb = null;
      for (const b of bgs) { const q = ratio(over(fg, b), b); if (q < worst) { worst = q; wb = b; } }
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      const cat = pseudo ? 'generated' : el.closest('h1, h2, h3, h4, h5, h6') ? 'heading' : el.closest('a') ? 'link'
        : (el.closest('.muted') || cs.color === muted) ? 'muted' : el.closest('button, select, label, input') ? 'control' : 'body';
      let rects = null;
      if (b0.grad) { if (node) { const r = document.createRange(); r.selectNodeContents(node); rects = boxes(r.getClientRects()); } else rects = boxes([el.getBoundingClientRect()]); }
      runs.push({ cat, sig: sig(el) + (pseudo || ''), text: String(text).trim().replace(/\s+/g, ' ').slice(0, 30), ratio: Math.floor(worst * 100) / 100, need,
        fgc: fg, fg: cs.color, bg: css(wb), size, weight, grad: b0.grad, rects });
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), seen = new Set();
    for (let n; (n = w.nextNode());) {
      const el = n.parentElement;
      if (!/\S/.test(n.nodeValue) || !el || seen.has(el)) continue;
      seen.add(el);
      if (skip(el) || !shown(el)) continue;
      check(el, getComputedStyle(el), n.nodeValue, null, n);
    }
    for (const el of root.querySelectorAll('*')) {
      if (skip(el) || !shown(el)) continue;
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(el, p);
        if (cs.display === 'none' || !/counter\(|"[^"]*[\p{L}\p{N}]/u.test(cs.content || '')) continue;
        check(el, cs, cs.content, p, null);
      }
    }
    return runs;
  }
  async function sample(b64, runs) {    // runs from contrast() with rects, measured on a text-free screenshot
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return runs.map(r => {
      let worst = Infinity, wb = null, n = 0;
      for (const [x, y, w, h] of r.rects || []) {
        const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
        const x1 = Math.min(cv.width, Math.ceil(x + w)), y1 = Math.min(cv.height, Math.ceil(y + h));
        if (x1 <= x0 || y1 <= y0) continue;
        const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let i = 0; i < d.length; i += 4) {
          const b = [d[i], d[i + 1], d[i + 2], 1], q = ratio(over(r.fgc, b), b); n++;
          if (q < worst) { worst = q; wb = b; }
        }
      }
      return n ? { ratio: Math.floor(worst * 100) / 100, bg: css(wb) + ' (measured)', pixels: n } : {};
    });
  }
  window.__smoke = { layout, targets, contrast, sample, sig, desc };
}

/* ---- browser + pages ------------------------------------------------------- */
const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const fontCache = new Map();
let fontFailures = 0;
const firebaseLoads = [], thirdParty = new Set();
const browser = await pw.chromium.launch();

async function open(url, o = {}) {
  const { width = 1280, height = 800, phone = false, touch = false, colorScheme = 'light', reducedMotion = 'no-preference', permissions = [], allow404 = null } = o;
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width, height }, isMobile: phone, hasTouch: phone || touch,
    deviceScaleFactor: phone ? 2 : 1, colorScheme, reducedMotion, permissions
  });
  await ctx.addInitScript(LIB);
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith(ORIGIN)) {
      if (SERVED_CONFIG && new URL(u).pathname === SUB + 'assets/js/config.js')
        return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: SERVED_CONFIG });
      return route.continue();
    }
    if (FONT.test(u)) {
      const hit = fontCache.get(u);
      if (hit) return route.fulfill(hit);
      try {
        const r = await route.fetch(), body = await r.body();
        const e = { status: r.status(), headers: r.headers(), body };
        if (r.ok()) fontCache.set(u, e);
        return route.fulfill(e);
      } catch { fontFailures++; return route.abort(); }
    }
    if (/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(u)) { firebaseLoads.push(u); return route.abort(); }
    thirdParty.add(new URL(u).host);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const log = { errors: [], bad: [], responses: [] };
  page.on('pageerror', e => log.errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() || {}).url || '';
    if (FONT.test(loc) || /fonts\.(googleapis|gstatic)\.com/.test(m.text())) return;   // Google Fonts unreachable
    if (allow404 && loc === allow404 && /404/.test(m.text())) return;
    log.errors.push('console: ' + m.text() + (loc ? ' @ ' + loc.replace(ORIGIN, '') : ''));
  });
  page.on('response', r => {
    const u = r.url();
    if (!u.startsWith(ORIGIN)) return;
    log.responses.push({ url: u, status: r.status() });
    if (r.status() !== 200 && !(allow404 && u === allow404 && r.status() === 404)) log.bad.push(r.status() + ' ' + u.replace(ORIGIN, ''));
  });
  page.on('requestfailed', r => {    // ERR_ABORTED = the page itself cancelled the load (a new lightbox photo, a navigation), not a server answer
    const why = (r.failure() || {}).errorText || '';
    if (r.url().startsWith(ORIGIN) && !/ERR_ABORTED/.test(why)) log.bad.push('failed ' + r.url().replace(ORIGIN, '') + ' ' + why);
  });
  let resp = null;
  if (url) {
    resp = await page.goto(url.startsWith('http') ? url : ORIGIN + url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0)).catch(() => {});
  }
  return { ctx, page, log, resp };
}
async function scrollThrough(page) {     // lets loading="lazy" images load
  await page.evaluate(async () => {
    const step = Math.max(200, innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 40)); }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 80));
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForLoadState('networkidle');
}
const httpCache = new Map();
async function get(u) {
  if (!httpCache.has(u)) httpCache.set(u, fetch(u, { redirect: 'manual' }).then(async r => ({ status: r.status, text: /html|javascript/.test(r.headers.get('content-type') || '') ? await r.text() : '' })));
  return httpCache.get(u);
}
/* a fragment resolves when the target page has that id/name, or when one of the
   target page's own scripts renders an element with that id (account.js draws
   #apply and #delete once someone is signed in) */
async function fragmentExists(pageUrl, frag) {
  const esc = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s(id|name)=["']${esc}["']`);
  const { text } = await get(pageUrl);
  if (re.test(text)) return true;
  for (const m of text.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const s = new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href;
    if (!s.startsWith(ORIGIN)) continue;
    if (new RegExp(`id=\\\\?["']${esc}\\\\?["']`).test((await get(s)).text)) return true;
  }
  return false;
}
async function collectLinks(page) {
  return page.evaluate(() => {
    const out = { urls: [], frags: [], missingHere: [] };
    for (const el of document.querySelectorAll('[href], [src], [srcset]')) {
      const vals = [];
      if (el.hasAttribute('href')) vals.push(el.getAttribute('href'));
      if (el.hasAttribute('src')) vals.push(el.getAttribute('src'));
      if (el.hasAttribute('srcset')) vals.push(...el.getAttribute('srcset').split(',').map(s => s.trim().split(/\s+/)[0]));
      for (const v of vals) {
        if (!v || /^(mailto:|tel:|javascript:|data:)/i.test(v)) continue;
        let u; try { u = new URL(v, document.baseURI); } catch { out.urls.push('BAD ' + v); continue; }
        if (u.origin !== location.origin) continue;
        let frag = u.hash.slice(1); try { frag = decodeURIComponent(frag); } catch {}
        u.hash = '';
        const here = u.href === location.href.split('#')[0];
        if (frag && el.tagName === 'A') {
          if (here) { if (!document.getElementById(frag) && !document.getElementsByName(frag).length) out.missingHere.push(v); }
          else out.frags.push([u.href, frag, v]);
        }
        if (!here) out.urls.push(u.href);   // the page itself was just loaded (and on the 404 page it is meant to be a 404)
      }
    }
    return out;
  });
}
const byGroup = items => {   // [{sig, text, h}] -> "sig "text" 36px ×3"
  const m = new Map();
  for (const i of items) { const g = m.get(i.sig) || { ...i, n: 0 }; g.n++; g.h = Math.min(g.h, i.h); m.set(i.sig, g); }
  return [...m.values()].map(g => `${g.sig} "${g.text}" ${g.h}px${g.n > 1 ? ' ×' + g.n : ''}`);
};

try {
  note(`serving ${ROOT} at ${ORIGIN}${SUB} (Jekyll exclude: ${EXCLUDE.join(', ')})`);
  if (CONFIGURED) note('config.js holds a real Firebase config; this run serves a copy with PASTE_ placeholders');

  /* ======================= 1. every served page ======================= */
  section(`1. every served page (${PAGES.length})`);
  const linkFrom = new Map(), frags = [];
  for (const rel of PAGES) {
    const url = urlOf(rel);
    const { ctx, page, log, resp } = await open(url);
    await scrollThrough(page);
    const links = await collectLinks(page);
    for (const u of links.urls) if (!linkFrom.has(u)) linkFrom.set(u, url);
    for (const f of links.frags) frags.push([...f, url]);
    const bad = [...new Set(log.bad)];
    t(resp && resp.status() === 200 && log.errors.length === 0 && bad.length === 0 && links.missingHere.length === 0,
      `${url}: loads (${resp && resp.status()}), no script errors, ${log.responses.length} same-origin requests all 200, in-page #links land` +
      list([...log.errors, ...bad, ...links.missingHere.map(v => 'no target for ' + v)]));
    await ctx.close();
  }
  {
    const broken = [];
    for (const [u, from] of linkFrom) {
      if (u.startsWith('BAD ')) { broken.push(u + ' on ' + from); continue; }
      const r = await get(u);
      if (r.status !== 200) broken.push(`${r.status} ${u.replace(ORIGIN, '')} (on ${from})`);
    }
    t(broken.length === 0, `every same-origin link, image, script and stylesheet resolves (${linkFrom.size} URLs)` + list(broken));
    const noTarget = [];
    for (const [u, frag, raw, from] of frags) if (!(await fragmentExists(u, frag))) noTarget.push(`${raw} (on ${from})`);
    t(noTarget.length === 0, `every cross-page #fragment has a target (${frags.length} links)` + list([...new Set(noTarget)]));
  }
  t(LEAKS.length === 0, 'GitHub Pages would not publish any node_modules folder (Jekyll exclude: rules)' + list(LEAKS));
  {
    const deep = ORIGIN + SUB + 'does/not/exist/deep/';
    const { ctx, page, log, resp } = await open(deep, { allow404: deep });
    const css = await page.evaluate(() => { const l = document.querySelector('link[rel="stylesheet"][href*="assets/css/site.css"]'); return l && l.href; });
    const cssResp = log.responses.find(r => r.url === css);
    const s = await page.evaluate(() => {
      const h1 = document.querySelector('main h1') || document.querySelector('h1');
      const hs = getComputedStyle(document.querySelector('.site-header'));
      return { h1: h1 && h1.textContent.trim(), h1Visible: !!h1 && h1.getBoundingClientRect().height > 0,
        headerPos: hs.position, headerBg: hs.backgroundColor, font: getComputedStyle(document.body).fontFamily };
    });
    t(resp.status() === 404, `a missing deep path answers 404 (${resp.status()})`);
    t(s.h1Visible && !!s.h1, `the 404 page renders its headline ("${s.h1}")`);
    t(!!cssResp && cssResp.status === 200 && s.headerPos === 'sticky' && /Manrope/.test(s.font),
      `the 404 page's stylesheet loads at a deep path (${cssResp ? cssResp.status : 'not requested'}) and applies (header ${s.headerPos}, ${s.headerBg})`);
    t(log.errors.length === 0 && log.bad.length === 0, 'the 404 page loads its scripts and images with no errors' + list([...log.errors, ...log.bad]));
    const links = await collectLinks(page), broken = [];
    for (const u of new Set(links.urls)) { const r = await get(u); if (r.status !== 200) broken.push(`${r.status} ${u.replace(ORIGIN, '')}`); }
    const fr = [];
    for (const [u, frag, raw] of links.frags) if (!(await fragmentExists(u, frag))) fr.push(raw);
    t(broken.length === 0 && fr.length === 0, `every link on the 404 page resolves from a deep path (${new Set(links.urls).size} URLs)` + list([...broken, ...fr]));
    await page.click('#acct-slot [data-signin]');
    t(await page.locator('.modal-backdrop').isVisible(), 'the 404 page\'s Σύνδεση button opens the sign-in dialog');
    await ctx.close();
  }

  /* ======================= 2. layout at ten viewports ======================= */
  const VIEWPORTS = [[320, 568], [360, 740], [375, 667], [390, 844], [414, 896], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [844, 390]];
  const isPhone = (w, h) => Math.min(w, h) <= 480;
  section(`2. layout: ${LAYOUT_PAGES.length} pages x ${VIEWPORTS.length} viewports`);
  for (const [name, rel] of LAYOUT_PAGES) {
    const scroll = [], past = [], small = [], head = [], errs = [];
    for (const [w, h] of VIEWPORTS) {
      const tag = `${w}x${h}`;
      const { ctx, page, log } = await open(urlOf(rel), { width: w, height: h, phone: isPhone(w, h), touch: w < 1100 });
      const m = await page.evaluate(() => window.__smoke.layout());
      if (m.scrollW > m.vw || m.bodyW > m.vw) scroll.push(`${tag} scrollWidth ${m.scrollW}/${m.bodyW} > ${m.vw}`);
      if (m.past.length) past.push(`${tag} ${m.past.slice(0, 3).join(', ')}${m.past.length > 3 ? ` (+${m.past.length - 3})` : ''}`);
      for (const s of m.small) small.push({ ...s, vp: tag });
      if (h > w && m.h1 && !(m.h1.top >= 0 && m.h1.bottom <= m.vh)) head.push(`${tag} h1 at ${Math.round(m.h1.top)}–${Math.round(m.h1.bottom)}px of ${m.vh}`);
      if (h > w && !m.h1) head.push(`${tag} no h1`);
      errs.push(...log.errors.map(e => tag + ' ' + e));
      await ctx.close();
    }
    t(scroll.length === 0, `${name}: no sideways scroll at any of ${VIEWPORTS.length} viewports` + list(scroll));
    t(past.length === 0, `${name}: no element past the right edge` + list(past));
    const bySig = new Map();
    for (const s of small) { const g = bySig.get(s.sig) || { ...s, vps: new Set(), n: 0 }; g.vps.add(s.vp); g.n++; g.h = Math.min(g.h, s.h); bySig.set(s.sig, g); }
    t(small.length === 0, `${name}: every button and link outside running prose is at least 40px tall` +
      list([...bySig.values()].map(g => `${g.sig} "${g.text}" ${g.h}px at ${g.vps.size === VIEWPORTS.length ? 'every viewport' : [...g.vps].join(',')}`), 8));
    t(head.length === 0, `${name}: the headline is on the first screen in portrait` + list(head));
    if (errs.length) t(false, `${name}: script errors while resizing` + list(errs));
  }

  /* ======================= 3. header ======================= */
  section('3. header and menu');
  for (const [w, h] of [[1101, 800], [1280, 800], [1440, 900], [1920, 1080]]) {
    const { ctx, page } = await open(SUB, { width: w, height: h });
    const r = await page.evaluate(() => {
      const box = e => e.getBoundingClientRect();
      const links = [...document.querySelectorAll('#nav a')], lr = links.map(box);
      // the text's own extent (left + scrollWidth), not its box: a nowrap line can overflow a shrunken box
      const brand = [document.querySelector('.brand'), ...document.querySelectorAll('.brand-text span')].filter(e => box(e).width > 0)
        .map(e => ({ right: Math.max(box(e).right, box(e).left + e.scrollWidth) }));
      const acct = box(document.querySelector('#acct-slot').firstElementChild);
      return { toggle: getComputedStyle(document.querySelector('.nav-toggle')).display,
        n: links.length, shown: links.filter(a => box(a).width > 0 && getComputedStyle(a).visibility !== 'hidden').length,
        rowSpread: Math.max(...lr.map(b => b.top)) - Math.min(...lr.map(b => b.top)), wraps: links.filter(a => box(a).height > 50).length,
        navL: Math.min(...lr.map(b => b.left)), navR: Math.max(...lr.map(b => b.right)),
        brandR: Math.max(...brand.map(b => b.right)), acctL: acct.left, acctR: acct.right, vw: innerWidth,
        headerH: box(document.querySelector('.site-header')).height };
    });
    t(r.toggle === 'none' && r.shown === r.n, `${w}px: all ${r.n} menu links shown, no menu button`);
    t(r.rowSpread < 1 && r.wraps === 0 && r.headerH < 80, `${w}px: the links sit in one row (spread ${r.rowSpread.toFixed(1)}px, header ${Math.round(r.headerH)}px)`);
    t(r.navL >= r.brandR && r.navR <= r.acctL && r.acctR <= r.vw,
      `${w}px: links clear the brand and the Σύνδεση button (gaps ${Math.round(r.navL - r.brandR)}px / ${Math.round(r.acctL - r.navR)}px)`);
    await ctx.close();
  }
  for (const [w, h] of [[1100, 800], [1024, 768], [768, 1024], [844, 390], [414, 896], [390, 844], [375, 667], [360, 740], [320, 568]]) {
    const tag = `${w}x${h}`, phone = isPhone(w, h);
    const { ctx, page, log } = await open(SUB, { width: w, height: h, phone, touch: true });
    const tap = async sel => phone ? page.locator(sel).first().tap() : page.locator(sel).first().click();
    const hdr = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const brand = [...document.querySelectorAll('.brand, .brand-text span')].filter(e => e.getBoundingClientRect().width > 0)
        .map(e => ({ right: Math.max(e.getBoundingClientRect().right, e.getBoundingClientRect().left + e.scrollWidth) }));
      return { toggle: getComputedStyle(document.querySelector('.nav-toggle')).display, navShown: box('#nav').height > 0,
        brandR: Math.max(...brand.map(b => b.right)), acct: box('#acct-slot'), tog: box('.nav-toggle'), vw: innerWidth, headerH: box('.site-header').height };
    });
    t(hdr.toggle !== 'none' && !hdr.navShown, `${tag}: menu button shown, menu closed`);
    t(hdr.brandR <= hdr.acct.left && hdr.acct.right <= hdr.tog.left && hdr.tog.right <= hdr.vw && hdr.headerH < 80,
      `${tag}: brand, Σύνδεση and menu button share one row without overlapping (header ${Math.round(hdr.headerH)}px)`);
    await tap('.nav-toggle');
    const opened = await page.evaluate(() => {
      const nav = document.getElementById('nav');
      nav.scrollTop = nav.scrollHeight;
      const last = nav.lastElementChild.getBoundingClientRect();
      const hit = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
      return { shown: nav.getBoundingClientRect().height > 0, expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded'),
        lastOk: last.bottom <= innerHeight + 0.5 && last.top >= 0 && !!hit && nav.lastElementChild.contains(hit),
        navBottom: nav.getBoundingClientRect().bottom, small: window.__smoke.targets(nav) };
    });
    t(opened.shown && opened.expanded === 'true', `${tag}: the menu button opens the menu`);
    t(opened.lastOk, `${tag}: the menu's last item can be scrolled to and tapped`);
    t(opened.small.length === 0, `${tag}: every menu link is at least 40px tall` + list(byGroup(opened.small)));
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(() => ({ shown: document.getElementById('nav').getBoundingClientRect().height > 0, focus: document.activeElement === document.querySelector('.nav-toggle') }));
    t(!esc.shown && esc.focus, `${tag}: Escape closes the menu and returns focus to the menu button`);
    await tap('.nav-toggle');
    const nb = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().bottom);
    if (nb < h - 24) {
      if (phone) await page.touchscreen.tap(w / 2, Math.round((nb + h) / 2)); else await page.mouse.click(w / 2, Math.round((nb + h) / 2));
      t(!(await page.locator('#nav').isVisible()), `${tag}: a tap outside the menu closes it`);
    } else {
      note(`${tag}: the open menu fills the screen below the header, so there is nothing outside it to tap`);
      await page.keyboard.press('Escape');
    }
    await tap('.nav-toggle');
    const before = page.url();
    await page.evaluate(() => document.addEventListener('click', e => { if (e.target.closest('#nav a')) e.preventDefault(); }, true));
    await tap('#nav a:nth-child(3)');
    t(!(await page.locator('#nav').isVisible()) && page.url() === before, `${tag}: following a menu link closes the menu`);
    if (w === 1024) {
      await tap('.nav-toggle');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(100);
      const st = await page.evaluate(() => ({ open: document.getElementById('nav').classList.contains('open'), exp: document.querySelector('.nav-toggle').getAttribute('aria-expanded') }));
      t(!st.open && st.exp === 'false', `${tag}: an open menu resets when the window grows past 1100px`);
    }
    if (log.errors.length) t(false, `${tag}: script errors` + list(log.errors));
    await ctx.close();
  }

  /* ======================= 4. sign-in dialog ======================= */
  section('4. sign-in dialog (sign-in not configured)');
  for (const [w, h] of [[1280, 800], [390, 844], [320, 568]]) {
    const tag = `${w}x${h}`, phone = isPhone(w, h);
    const { ctx, page, log } = await open(SUB, { width: w, height: h, phone });
    const opener = page.locator('#acct-slot [data-signin]');
    const inModal = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.modal'));
    const onOpener = () => page.evaluate(() => !!document.activeElement && document.activeElement.matches('#acct-slot [data-signin]'));
    if (phone) await opener.tap(); else await opener.click();
    await page.waitForSelector('.modal-backdrop:not([hidden])');
    await page.waitForTimeout(80);
    const d = await page.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop'), m = bd.querySelector('.modal'), mb = m.getBoundingClientRect(), x = bd.querySelector('.modal-x').getBoundingClientRect();
      return { notice: (bd.querySelector('[data-offline]') || {}).textContent || '', provs: [...bd.querySelectorAll('[data-provider]')].map(b => [b.getAttribute('data-provider'), b.disabled]),
        submit: bd.querySelector('[data-submit]').disabled, lock: document.body.classList.contains('modal-open'),
        fits: mb.left >= -0.5 && mb.right <= innerWidth + 0.5 && bd.scrollWidth <= bd.clientWidth, xIn: x.top >= 0 && x.right <= innerWidth && x.bottom <= innerHeight,
        small: window.__smoke.targets(m) };
    });
    t(/ανοίγει σύντομα/.test(d.notice), `${tag}: the dialog says sign-in «ανοίγει σύντομα»`);
    t(d.provs.length === PROVIDERS.length && d.provs.every(p => p[1]) && d.submit,
      `${tag}: the ${d.provs.map(p => p[0]).join('/')} buttons and the e-mail submit are disabled`);
    t(await inModal() && d.lock, `${tag}: focus moves into the dialog and the page behind stops scrolling`);
    t(d.fits && d.xIn, `${tag}: the dialog fits the screen and its close button is on it`);
    t(d.small.length === 0, `${tag}: every control in the dialog is at least 40px tall` + list(byGroup(d.small)));
    let escaped = 0;
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); if (!(await inModal())) escaped++; }
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inModal())) escaped++; }
    t(escaped === 0, `${tag}: Tab and Shift+Tab stay inside the dialog (${escaped} of 48 presses left it)`);
    await page.locator('#tab-register').click();
    const reg = await page.evaluate(() => ({ sel: document.getElementById('tab-register').getAttribute('aria-pressed'), title: document.getElementById('auth-title').textContent,
      first: document.getElementById('auth-first').getBoundingClientRect().height > 0, submit: document.querySelector('[data-submit]').textContent,
      forgot: document.querySelector('[data-forgot]').getBoundingClientRect().height > 0, ac: document.getElementById('auth-pass').getAttribute('autocomplete') }));
    t(reg.sel === 'true' && reg.first && !reg.forgot && reg.ac === 'new-password' && /Δημιουργία/.test(reg.submit),
      `${tag}: the Εγγραφή tab switches the form to registration ("${reg.title}", name fields, "${reg.submit}")`);
    await page.locator('#tab-signin').click();
    t(await page.evaluate(() => document.getElementById('auth-first').getBoundingClientRect().height === 0 && document.getElementById('tab-signin').getAttribute('aria-pressed') === 'true'),
      `${tag}: the Σύνδεση tab switches back`);
    await page.keyboard.press('Escape');
    t(await page.locator('.modal-backdrop').isHidden() && !(await page.evaluate(() => document.body.classList.contains('modal-open'))), `${tag}: Escape closes the dialog`);
    if (!phone) t(await onOpener(), `${tag}: after a mouse click + Escape, focus is back on Σύνδεση`);
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.modal-backdrop:not([hidden])');
    await page.waitForTimeout(80);
    t(await inModal(), `${tag}: Enter on Σύνδεση opens the dialog with focus inside`);
    await page.keyboard.press('Escape');
    t(await page.locator('.modal-backdrop').isHidden() && await onOpener(), `${tag}: Escape closes it and focus returns to Σύνδεση`);
    if (phone) await opener.tap(); else await opener.click();
    await page.locator('.modal-x').click();
    t(await page.locator('.modal-backdrop').isHidden(), `${tag}: the × button closes the dialog`);
    if (!phone) {
      await opener.click();
      await page.mouse.click(8, h - 8);
      t(await page.locator('.modal-backdrop').isHidden(), `${tag}: a click on the backdrop closes the dialog`);
    }
    if (log.errors.length) t(false, `${tag}: script errors` + list(log.errors));
    await ctx.close();
  }
  {
    const { ctx, page, log } = await open(SUB + '?register');
    await page.waitForTimeout(80);
    t(await page.locator('.modal-backdrop').isVisible() && (await page.getAttribute('#tab-register', 'aria-pressed')) === 'true',
      '?register opens the dialog on the registration tab');
    await ctx.close();
    const a = await open(SUB + 'account/');
    const acct = await a.page.evaluate(() => { const app = document.getElementById('account-app'); return { text: app.textContent, links: [...app.querySelectorAll('a')].map(x => x.getAttribute('href')) }; });
    t(/ανοίγει σύντομα/.test(acct.text) && acct.links.includes(C.legacyApplyFormUrl) && a.log.errors.length === 0,
      'the account page shows the "opens soon" panel with the legacy application form' + list(a.log.errors));
    await a.page.click('#acct-slot [data-signin]');
    t(await a.page.locator('.modal-backdrop').isVisible() && a.page.url().endsWith('/account/'), 'on the account page Σύνδεση opens the dialog instead of navigating');
    await a.ctx.close();
    if (log.errors.length) t(false, '?register: script errors' + list(log.errors));
  }

  /* ======================= 5. lightbox ======================= */
  section('5. photo lightbox');
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const tag = `${w}x${h}`, phone = isPhone(w, h);
    const { ctx, page, log } = await open(SUB + 'fotothiki/', { width: w, height: h, phone });
    const items = await page.evaluate(() => [...document.querySelectorAll('[data-gallery] a')].map(a => ({ href: a.href, cap: a.getAttribute('data-caption') || '' })));
    const n = items.length;
    const state = () => page.evaluate(() => {
      const box = document.querySelector('.lightbox');
      if (!box) return null;
      const img = box.querySelector('img');
      return { count: box.querySelector('.lb-count').textContent, src: img.src, cap: box.querySelector('.lb-cap').textContent, loaded: img.complete && img.naturalWidth > 0,
        role: box.getAttribute('role'), modal: box.getAttribute('aria-modal'), focusIn: box.contains(document.activeElement),
        buttons: [...box.querySelectorAll('button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.height >= 40; }) };
    });
    const first = page.locator('[data-gallery] a').first();
    if (phone) await first.tap(); else await first.click();
    await page.waitForSelector('.lightbox');
    await page.waitForFunction(() => { const i = document.querySelector('.lightbox img'); return i && i.complete && i.naturalWidth > 0; }).catch(() => {});
    let s = await state();
    t(!!s && s.count === `1 / ${n}` && s.src === items[0].href && s.cap === items[0].cap && s.role === 'dialog' && s.modal === 'true',
      `${tag}: a click opens photo 1 of ${n} with its caption`);
    t(s && s.loaded && s.focusIn && s.buttons, `${tag}: the full-size photo loads, focus is inside, the buttons are on screen and 40px+`);
    await page.keyboard.press('ArrowRight'); s = await state();
    t(s.count === `2 / ${n}` && s.src === items[1].href && s.cap === items[1].cap, `${tag}: → shows photo 2 and updates the count`);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); s = await state();
    t(s.count === `${n} / ${n}` && s.src === items[n - 1].href, `${tag}: ← wraps from the first photo to the last`);
    await page.locator('.lightbox .lb-next').click(); s = await state();
    t(s.count === `1 / ${n}`, `${tag}: the next button wraps back to photo 1`);
    await page.locator('.lightbox .lb-prev').click(); s = await state();
    t(s.count === `${n} / ${n}`, `${tag}: the previous button goes back`);
    let out = 0;
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.querySelector('.lightbox') && document.querySelector('.lightbox').contains(document.activeElement)))) out++; }
    t(out === 0, `${tag}: Tab stays inside the lightbox`);
    if (phone) {
      const cdp = await ctx.newCDPSession(page);
      const swipe = async (x0, x1) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: h / 2 }] });
        for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * k / 5, y: h / 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await swipe(300, 120); s = await state();
      t(!!s && s.count === `1 / ${n}`, `${tag}: a swipe left shows the next photo (${s ? s.count : 'closed'})`);
      await swipe(100, 300); s = await state();
      t(!!s && s.count === `${n} / ${n}`, `${tag}: a swipe right shows the previous photo (${s ? s.count : 'closed'})`);
    }
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ gone: !document.querySelector('.lightbox'), lock: document.body.classList.contains('modal-open'),
      focus: document.activeElement === document.querySelector('[data-gallery] a') }));
    t(closed.gone && !closed.lock, `${tag}: Escape closes the lightbox and unlocks the page`);
    if (!phone) t(closed.focus, `${tag}: focus returns to the photo that opened it`);
    if (log.errors.length || log.bad.length) t(false, `${tag}: errors in the gallery` + list([...log.errors, ...log.bad]));
    await ctx.close();
  }

  /* ======================= 6. filter + support page ======================= */
  section('6. announcements filter, support page');
  {
    const { ctx, page, log } = await open(SUB + 'blog/');
    const cats = await page.evaluate(() => [...document.querySelectorAll('#post-list .post-card')].map(c => c.getAttribute('data-cat')));
    t(await page.locator('[data-post-filter]').isVisible(), `the filter bar is shown (${cats.length} announcements)`);
    for (const b of await page.locator('[data-post-filter] button').all()) {
      const cat = await b.getAttribute('data-cat'), label = (await b.textContent()).trim();
      await b.click();
      const r = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#post-list .post-card')].filter(c => c.getBoundingClientRect().height > 0).map(c => c.getAttribute('data-cat')),
        pressed: [...document.querySelectorAll('[data-post-filter] button')].filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.textContent.trim()) }));
      const want = cats.filter(c => !cat || c === cat);
      t(r.shown.length === want.length && r.shown.every(c => !cat || c === cat) && r.pressed.length === 1 && r.pressed[0] === label,
        `"${label}" shows ${r.shown.length} of ${cats.length} cards (expected ${want.length}) and is the one pressed button`);
    }
    if (log.errors.length) t(false, 'blog: script errors' + list(log.errors));
    await ctx.close();
  }
  {
    const { ctx, page, log } = await open(SUB + 'support/', { permissions: ['clipboard-read', 'clipboard-write'] });
    for (const sel of ['#iban', '#bic']) {
      const want = (await page.locator(sel).textContent()).trim();
      const btn = page.locator(`[data-copy="${sel}"]`);
      await btn.click();
      await page.waitForTimeout(150);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERR ' + e.message);
      t(clip === want && /Αντιγράφηκε/.test(await btn.textContent()) && /\bdone\b/.test(await btn.getAttribute('class')),
        `the ${sel.slice(1).toUpperCase()} copy button puts "${want}" on the clipboard and says so`);
    }
    await page.waitForTimeout(2400);
    t((await page.locator('[data-copy="#iban"]').textContent()).trim() === 'Αντιγραφή IBAN', 'the copy button label resets after a moment (named "Αντιγραφή IBAN")');
    const ap = await page.evaluate(() => ({ legacy: document.querySelector('[data-apply-legacy]').getBoundingClientRect().height > 0,
      online: document.querySelector('[data-apply-online]').getBoundingClientRect().height > 0,
      href: (document.querySelector('[data-apply-legacy] a') || {}).href }));
    t(ap.legacy && !ap.online && ap.href === C.legacyApplyFormUrl, `the support page offers the legacy application form (${ap.href}) and hides "apply online"`);
    if (log.errors.length) t(false, 'support: script errors' + list(log.errors));
    await ctx.close();
  }

  /* ======================= 7. contrast ======================= */
  section('7. text contrast (WCAG 1.4.3: 4.5:1, 3:1 for text >= 24px or >= 18.66px bold)');
  async function audit(page, sel, fullPage) {
    const runs = await page.evaluate(s => window.__smoke.contrast(s), sel);
    const idx = runs.map((r, i) => (r.grad ? i : -1)).filter(i => i >= 0);
    if (idx.length) {    // text over a gradient: measure the pixels behind it, with every glyph made invisible
      const style = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }' });
      const png = await page.screenshot({ fullPage, animations: 'disabled', caret: 'hide' });
      await style.evaluate(n => n.remove());
      const got = await page.evaluate(({ b64, rs }) => window.__smoke.sample(b64, rs), { b64: png.toString('base64'), rs: idx.map(i => runs[i]) });
      idx.forEach((i, k) => Object.assign(runs[i], got[k]));
      if (process.env.SMOKE_VERBOSE) for (const i of idx) note(`  measured ${runs[i].sig} "${runs[i].text}" ${runs[i].ratio}:1 on ${runs[i].bg}, ${runs[i].pixels || 0} px`);
    }
    const counts = {};
    for (const r of runs) counts[r.cat] = (counts[r.cat] || 0) + 1;
    const groups = new Map();
    for (const b of runs.filter(r => r.ratio < r.need)) {
      const k = b.sig.replace(/#[\w-]+/g, '') + b.fg + b.need;
      const g = groups.get(k) || { ...b, n: 0 }; g.n++;
      if (b.ratio < g.ratio) { g.ratio = b.ratio; g.bg = b.bg; }
      groups.set(k, g);
    }
    return { total: runs.length, grad: idx.length, counts: Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', '),
      bad: [...groups.values()].map(g => `${g.cat} ${g.sig} "${g.text}" ${g.ratio}:1 < ${g.need} (${g.fg} on ${g.bg}, ${g.size}px/${g.weight})${g.n > 1 ? ' ×' + g.n : ''}`) };
  }
  const CONTRAST_PAGES = [['home', ''], ['support', 'support/'], ['account', 'account/'], ['governance', 'governance/'], ['blog', 'blog/']];
  for (const scheme of ['dark', 'light']) {
    const label = scheme === 'dark' ? 'dark' : 'light (extra)';
    for (const [name, p] of CONTRAST_PAGES) {
      const { ctx, page } = await open(SUB + p, { colorScheme: scheme });
      const r = await audit(page, 'body', true);
      t(r.bad.length === 0, `${label} ${name}: ${r.total} text runs pass (${r.counts}; ${r.grad} over gradients, measured in pixels)` + list(r.bad, 8));
      if (name === 'account') {
        await page.click('#acct-slot [data-signin]');
        await page.waitForSelector('.modal-backdrop:not([hidden])');
        const m = await audit(page, '.modal', false);
        t(m.bad.length === 0, `${label} sign-in dialog: ${m.total} text runs pass (${m.counts})` + list(m.bad, 8));
      }
      await ctx.close();
    }
  }

  /* ======================= 8. reduced motion, print ======================= */
  section('8. prefers-reduced-motion and print');
  {
    const { ctx, page, log } = await open(SUB, { width: 390, height: 844, phone: true, reducedMotion: 'reduce' });
    const sb = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    await page.locator('.nav-toggle').tap();
    await page.locator('#nav a:nth-child(2)').tap();
    await page.waitForLoadState('networkidle');
    await page.goto(ORIGIN + SUB + 'fotothiki/', { waitUntil: 'networkidle' });
    await page.locator('[data-gallery] a').first().tap();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    t(sb === 'auto' && log.errors.length === 0, `reduced motion: smooth scrolling is off (${sb}), menu and lightbox work with no errors` + list(log.errors));
    await ctx.close();
  }
  for (const p of ['', 'governance/', POSTS[POSTS.length - 1].replace(/index\.html$/, '')]) {
    const { ctx, page, log } = await open(SUB + p);
    await scrollThrough(page);
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector('.site-header')).display, footer: getComputedStyle(document.querySelector('.site-footer')).display,
      h1: getComputedStyle(document.querySelector('h1')).color }));
    const pdf = p === '' ? await page.pdf({ format: 'A4' }) : null;
    t(r.header === 'none' && r.footer === 'none' && r.h1 === 'rgb(0, 0, 0)' && log.errors.length === 0 && (!pdf || pdf.length > 10000),
      `print /${p}: header and footer hidden, black headline${pdf ? `, PDF renders (${Math.round(pdf.length / 1024)} KB)` : ''}, no errors` + list(log.errors));
    await ctx.close();
  }

  /* ======================= screenshots + global ======================= */
  section('screenshots, network');
  for (const [file, o] of [['shot-desktop.png', { width: 1280, height: 800 }], ['shot-phone.png', { width: 390, height: 844, phone: true }]]) {
    const { ctx, page } = await open(SUB, o);
    await scrollThrough(page);
    await page.screenshot({ path: path.join(HERE, file), fullPage: true });
    note(`wrote tools/${file}`);
    await ctx.close();
  }
  t(firebaseLoads.length === 0, 'the Firebase SDK is never fetched while sign-in is not configured' + list(firebaseLoads));
  if (fontFailures || !fontCache.size) note(`Google Fonts could not be fetched (${fontFailures} failures); layout was measured with the fallback font`);
  else note(`Google Fonts: ${fontCache.size} files fetched once and replayed`);
  if (thirdParty.size) note('third-party requests stubbed: ' + [...thirdParty].join(', '));
} catch (e) {
  t(false, 'the test itself crashed: ' + (e && e.stack || e));
} finally {
  await browser.close();
  cleanup();
}
console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? 'smoke FAILED' : 'smoke passed');
process.exit(fails ? 1 : 0);
