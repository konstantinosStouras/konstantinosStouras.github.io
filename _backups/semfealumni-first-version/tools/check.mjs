#!/usr/bin/env node
/* Offline checks. Run before every commit:  node tools/check.mjs
   Fails (exit 1) on a real defect:
     - a page on disk differs from what _src/ builds (run node tools/build.mjs)
     - a link or image on any page points at a file that does not exist
     - the share card: not exactly one og:image, declared size != real JPEG size,
       over 300 KB, og:* written with name= or twitter:* with property=
     - the viewport tag blocks zoom
     - an <img> without alt
     - ADMIN_EMAILS in config.js differs from isAdmin() in firestore.rules
     - an inline {{...}} placeholder left unfilled in a built page
   and REPORTS (without failing) that Firebase is still unconfigured. */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const fail = m => { bad++; console.log('FAIL  ' + m); };
const ok = m => console.log('ok    ' + m);
const note = m => console.log('note  ' + m);
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const C = new Function('window', read('assets/js/config.js') + '; return window.SEMFE;')({});

/* 1. generated pages are up to date */
try { execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--check'], { stdio: 'pipe' }); ok('built pages match _src/'); }
catch (e) { fail('built pages differ from _src/ — run: node tools/build.mjs\n' + String(e.stdout || '')); }

/* collect the served HTML pages (skip _src, tools, node_modules, dot dirs) */
const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name.startsWith('_') || f.name === 'tools' || f.name === 'node_modules') continue;
    const full = path.join(dir, f.name);
    if (f.isDirectory()) walk(full);
    else if (f.name.endsWith('.html')) pages.push(path.relative(ROOT, full));
  }
})(ROOT);
ok(`${pages.length} served pages`);

/* 2. every relative link and asset exists */
const SITE_PATH = new URL(C.siteUrl).pathname;            // "/semfealumni/"
let links = 0;
for (const p of pages) {
  const html = read(p);
  if (/\{\{[a-z:]+\}\}/.test(html)) fail(`${p}: unfilled placeholder ${html.match(/\{\{[a-z:]+\}\}/)[0]}`);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/.test(u)) continue;
    u = u.split('#')[0].split('?')[0];
    if (!u) continue;
    let target;
    if (u.startsWith('/')) {
      if (!u.startsWith(SITE_PATH)) { fail(`${p}: absolute link outside the site: ${u}`); continue; }
      target = path.join(ROOT, u.slice(SITE_PATH.length));
    } else target = path.join(ROOT, path.dirname(p), u);
    if (u.endsWith('/') || (existsSync(target) && statSync(target).isDirectory())) target = path.join(target, 'index.html');
    links++;
    if (!existsSync(target)) fail(`${p}: broken link ${m[1]}`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) fail(`${p}: <img> without alt: ${m[0].slice(0, 80)}`);
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html)) fail(`${p}: viewport tag must be exactly width=device-width, initial-scale=1`);
  const og = [...html.matchAll(/<meta property="og:image" content="([^"]+)"/g)];
  if (og.length !== 1) fail(`${p}: expected exactly one og:image, found ${og.length}`);
  if (/<meta name="og:/.test(html)) fail(`${p}: og:* written with name=`);
  if (/<meta property="twitter:/.test(html)) fail(`${p}: twitter:* written with property=`);
  if (!/<title>[^<]{3,}<\/title>/.test(html)) fail(`${p}: missing <title>`);
  if (!/<meta name="description" content="[^"]{20,}">/.test(html)) fail(`${p}: missing or short description`);
}
ok(`${links} internal links and images resolve`);

/* 3. the share pictures match what the pages declare */
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
{
  const home = read('index.html');
  const w = +(home.match(/og:image:width" content="(\d+)"/) || [])[1], h = +(home.match(/og:image:height" content="(\d+)"/) || [])[1];
  for (const [file, ew, eh] of [['og-image.jpg', w, h], ['share-square.jpg', 800, 800]]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) { fail(`${file} missing (node tools/make-share-images.mjs)`); continue; }
    const d = jpegSize(readFileSync(p)), kb = statSync(p).size / 1024;
    if (!d || d.w !== ew || d.h !== eh) fail(`${file} is ${d ? d.w + 'x' + d.h : 'not a JPEG'}, pages declare ${ew}x${eh}`);
    else if (kb > 300) fail(`${file} is ${kb.toFixed(0)} KB; WhatsApp drops thumbnails over 300 KB`);
    else ok(`${file} ${d.w}x${d.h} ${kb.toFixed(0)} KB`);
  }
  const t = readFileSync(path.join(ROOT, 'apple-touch-icon.png'));
  if (t.readUInt32BE(16) !== 180 || t.readUInt32BE(20) !== 180) fail('apple-touch-icon.png must be 180x180'); else ok('apple-touch-icon.png 180x180');
}

/* 4. the admin list: the page and the rules must agree */
{
  const rules = read('firestore.rules');
  const m = rules.match(/function isAdmin\(\)[\s\S]*?in \[([^\]]*)\]/);
  const fromRules = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1].toLowerCase()).sort() : [];
  const fromCfg = (C.ADMIN_EMAILS || []).map(x => x.toLowerCase()).sort();
  if (JSON.stringify(fromRules) !== JSON.stringify(fromCfg)) fail(`ADMIN_EMAILS (${fromCfg.join(', ')}) differs from isAdmin() in firestore.rules (${fromRules.join(', ')})`);
  else ok(`admin list in sync: ${fromCfg.join(', ')}`);
  /* every deployable section runs the wrong-project guard first, and the
     functions runtime agrees with functions/package.json engines.node (a
     "runtime" field overrides engines outright, so a mismatch deploys the
     wrong Node version while printing "Deploy complete!") */
  const fj = JSON.parse(read('firebase.json'));
  for (const sec of ['firestore', 'functions']) {
    if (!fj[sec]) continue;
    if (!(fj[sec].predeploy || []).includes('node check-project.mjs')) fail(`firebase.json ${sec} must run check-project.mjs as predeploy`);
  }
  if (fj.functions) {
    const eng = String((JSON.parse(read(path.join(fj.functions.source, 'package.json'))).engines || {}).node || '');
    if (fj.functions.runtime && fj.functions.runtime !== 'nodejs' + eng) fail(`firebase.json runtime ${fj.functions.runtime} differs from functions/package.json engines.node ${eng}`);
  }
  ok('firebase.json: guard on every section, runtime matches engines');
}

/* 5. what is still to do (not failures) */
const f = C.FIREBASE || {};
if (Object.values(f).some(v => String(v).includes('PASTE_'))) note('Firebase is not configured yet: sign-in stays off until assets/js/config.js has the real web config (FIREBASE-SETUP.md).');
if (read('.firebaserc').includes('PASTE_')) note('.firebaserc still says PASTE_PROJECT_ID (needed only for deploying the rules from the CLI).');

console.log(bad ? `\n${bad} problem(s)` : '\ncheck passed');
process.exit(bad ? 1 : 0);
