#!/usr/bin/env node
/* Builds every page of the site from _src/ into plain HTML.
 *
 *   node tools/build.mjs          write the pages
 *   node tools/build.mjs --check  write nothing; exit 1 if any page on disk
 *                                 differs from what _src/ would produce
 *
 * No dependencies. The output is committed, so GitHub Pages serves plain files
 * and needs no build step of its own.
 *
 * _src/pages/*.html   one file per page: a META block, then the page body
 * _src/posts/*.html   one file per announcement, same shape
 *
 * The META block is JSON inside an HTML comment at the very top:
 *   <!--META { "path": "governance/", "title": "Διοίκηση", ... } META-->
 * Inside a body you may write:
 *   {{root}}        the relative way back to the site root ("../../")
 *   {{icon:NAME}}   an inline SVG icon from ICONS below
 *   {{latest}}      the three newest announcements as cards (home page)
 *   {{posts}}       every announcement as cards (the announcements page)
 *
 * Every link the site writes is RELATIVE, so the same files work at
 * stouras.com/semfealumni/ today and at the root of semfealumni.gr later.
 * Only the canonical / og:url tags use SITE_URL. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/* ---- site-wide settings --------------------------------------------------- */
const cfgSrc = readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');
const C = new Function('window', cfgSrc + '; return window.SEMFE;')({});
const SITE_URL = C.siteUrl.replace(/\/?$/, '/');
/* While this copy is a preview beside the association's own semfealumni.gr,
   search engines are asked not to index it (two copies of one site compete
   in search results). Set to true when this becomes the official site. */
const INDEXABLE = false;
const YEAR_NOW = 2026;       // the footer's copyright range ends here
const OG_W = 1200, OG_H = 630;

/* ---- icons (stroke icons drawn on a 24px grid; brand marks filled) --------- */
const ICONS = {
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.9 5.9 0 0 0-2.13 1.38A5.9 5.9 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.38 5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>',
  paypal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.08 21.6H3.26a.6.6 0 0 1-.59-.7L5.33 3.9A.9.9 0 0 1 6.22 3.1h6.64c2.66 0 4.54.6 5.5 1.85.9 1.16 1.07 2.58.65 4.45l-.02.1v.3c-.63 3.26-2.8 4.9-6.43 4.9h-1.9a.9.9 0 0 0-.9.77l-.87 5.53-.03.15a.9.9 0 0 1-.89.75zm13.1-13.92c-.03.16-.06.33-.1.5-1.02 5.26-4.52 7.07-9 7.07H8.8l-1.22 7.74h2.56a.79.79 0 0 0 .78-.67l.03-.17.62-3.92.04-.21a.79.79 0 0 1 .78-.67h.49c3.18 0 5.66-1.29 6.39-5.02.3-1.56.15-2.86-.66-3.78a3.1 3.1 0 0 0-.43-.37z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4.6"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
  vote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><path d="M5 7h14l2 5v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
};

/* ---- navigation ------------------------------------------------------------ */
const NAV = [
  { key: 'home', label: 'Αρχική', href: '' },
  { key: 'organa', label: 'Όργανα', href: 'organa/' },
  { key: 'governance', label: 'Διοίκηση', href: 'governance/' },
  { key: 'history', label: 'Ιστορία', href: 'how_we_started/' },
  { key: 'blog', label: 'Ανακοινώσεις', href: 'blog/' },
  { key: 'support', label: 'Εγγραφή & Δωρεές', href: 'support/' },
  { key: 'contact', label: 'Επικοινωνία', href: 'contact/' }
];
/* The pill row under an inner page's title, linking the pages of one section. */
const SUBNAV = {
  club: [['Όραμα & Σκοπός', '#orama', ''], ['Όργανα', '', 'organa/'], ['Διοίκηση', '', 'governance/']],
  history: [['Πώς ξεκινήσαμε', '', 'how_we_started/'], ['Φωτοθήκη', '', 'fotothiki/'], ['Αρχείο', '', 'archive/']],
  members: [['Ο λογαριασμός μου', '', 'account/'], ['Περιοχή μελών', '', 'members/']]
};
const SOCIAL = [
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/semfealumni'],
  ['facebook', 'Facebook', 'https://www.facebook.com/semfealumni'],
  ['youtube', 'YouTube', 'https://www.youtube.com/@semfealumni'],
  ['instagram', 'Instagram', 'https://www.instagram.com/semfe_alumni_ntua']
];

/* ---- helpers --------------------------------------------------------------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const depthOf = p => (p.replace(/index\.html$/, '').match(/\//g) || []).length;
const rootFor = p => '../'.repeat(depthOf(p)) || './';
const MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
const greekDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

function readSrc(dir) {
  const full = path.join(ROOT, '_src', dir);
  return readdirSync(full).filter(f => f.endsWith('.html')).sort().map(f => {
    const raw = readFileSync(path.join(full, f), 'utf8');
    const m = raw.match(/^\s*<!--META([\s\S]*?)META-->/);
    if (!m) throw new Error(`${dir}/${f}: missing <!--META {...} META--> block`);
    let meta;
    try { meta = JSON.parse(m[1]); } catch (e) { throw new Error(`${dir}/${f}: META is not valid JSON (${e.message})`); }
    return { file: `${dir}/${f}`, meta, body: raw.slice(m[0].length).trim() };
  });
}

/* ---- announcements --------------------------------------------------------- */
const posts = readSrc('posts').map(p => {
  const { date, slug } = p.meta;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error(`${p.file}: date must be YYYY-MM-DD`);
  if (!/^[a-z0-9_-]+$/.test(slug || '')) throw new Error(`${p.file}: slug must be lowercase letters, digits, - or _`);
  const [y, m, d] = date.split('-');
  return { ...p, path: `blog/${y}/${m}/${d}/${slug}/` };
}).sort((a, b) => b.meta.date.localeCompare(a.meta.date) || a.meta.slug.localeCompare(b.meta.slug));
const postBySlug = Object.fromEntries(posts.map(p => [p.meta.slug, p]));

function postCard(p, root) {
  const img = p.meta.image
    ? `<div class="thumb"><img src="${root}assets/img/posts/${esc(p.meta.image)}" alt="" loading="lazy" decoding="async"></div>`
    : `<div class="thumb logo"><img src="${root}assets/img/logos/logo.png" alt="" loading="lazy" decoding="async"></div>`;
  const cat = p.meta.category || 'Ανακοινώσεις';
  return `<a class="post-card" href="${root}${p.path}" data-cat="${esc(cat)}">${img}<div class="body">` +
    `<div class="meta"><span class="tag${cat === 'Εκδηλώσεις' ? ' events' : ''}">${esc(cat)}</span><time datetime="${p.meta.date}">${greekDate(p.meta.date)}</time></div>` +
    `<h3>${esc(p.meta.title)}</h3><p>${esc(p.meta.description)}</p><span class="more">Διαβάστε περισσότερα →</span></div></a>`;
}

/* ---- the layout ------------------------------------------------------------ */
function head(page, root) {
  // 404.html gets its own address: two pages sharing one og:url share one link preview
  const url = SITE_URL + (page.meta.file || page.path);
  const title = page.meta.path === '' && !page.meta.file ? C.siteName + ' · SEMFE Alumni' : `${page.meta.title} · ${C.siteName}`;
  const desc = page.meta.description;
  const noindex = !INDEXABLE || page.meta.noindex;
  return `<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
${noindex ? '  <meta name="robots" content="noindex">\n' : ''}  <meta property="og:type" content="${page.isPost ? 'article' : 'website'}">
  <meta property="og:site_name" content="SEMFE Alumni">
  <meta property="og:locale" content="el_GR">
  <meta property="og:title" content="${esc(page.meta.title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="${OG_W}">
  <meta property="og:image:height" content="${OG_H}">
  <meta property="og:image:alt" content="Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.meta.title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${SITE_URL}og-image.jpg">
  <link rel="image_src" href="${SITE_URL}share-square.jpg">
  <meta itemprop="image" content="${SITE_URL}share-square.jpg">
  <link rel="icon" type="image/svg+xml" href="${root}favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="${root}favicon-32.png">
  <link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
  <meta name="theme-color" content="#0a2240">
  <script>document.documentElement.className += ' js';</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${root}assets/css/site.css">
  <script src="${root}assets/js/config.js"></script>
  <script src="${root}assets/js/site.js" defer></script>
  <script src="${root}assets/js/auth.js" defer></script>
${(page.meta.scripts || []).map(s => `  <script src="${root}assets/js/${s}" defer></script>\n`).join('')}</head>`;
}

function header(page, root) {
  const cur = page.meta.nav;
  const links = NAV.map(n => `<a href="${root}${n.href}"${n.key === cur ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('\n      ');
  return `<a class="skip" href="#main">Μετάβαση στο περιεχόμενο</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${root}" aria-label="Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, αρχική σελίδα">
      <img class="brand-mark" src="${root}assets/img/logos/semfe_alumni_logo.jpg" alt="" width="42" height="42">
      <span class="brand-text"><span class="top">ΣΥΛΛΟΓΟΣ ΔΙΠΛΩΜΑΤΟΥΧΩΝ</span><span class="bottom">ΣΕΜΦΕ ΕΜΠ</span></span>
    </a>
    <div class="header-right">
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Άνοιγμα μενού">
        <svg class="i-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <nav class="nav" id="nav" aria-label="Κύριο μενού">
      ${links}
      </nav>
      <div class="acct-slot" id="acct-slot">
        <a class="btn btn-primary btn-sm acct-signin" href="${root}account/" data-signin>Σύνδεση</a>
      </div>
    </div>
  </div>
</header>`;
}

function pageHero(page, root) {
  const h = page.meta.hero;
  if (!h) return '';
  const crumbs = (page.meta.crumbs || []).map(([label, href]) =>
    href == null ? `<span>${esc(label)}</span>` : `<a href="${root}${href}">${esc(label)}</a>`);
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="Διαδρομή"><a href="${root}">Αρχική</a>${crumbs.map(c => '<span aria-hidden="true">›</span>' + c).join('')}</nav>`
    : '';
  const sub = page.meta.subnav && SUBNAV[page.meta.subnav];
  const subHtml = sub ? `<nav class="filters subnav" aria-label="Ενότητα" style="margin:22px 0 0">${sub.map(([label, hash, href]) => {
    const target = hash ? `${root}${hash}` : `${root}${href}`;
    const on = href && href === page.meta.path;
    return `<a class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" href="${target}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  }).join('')}</nav>` : '';
  const meta = page.isPost
    ? `<div class="meta"><span class="tag">${esc(page.meta.category || 'Ανακοινώσεις')}</span><time datetime="${page.meta.date}">${greekDate(page.meta.date)}</time><span class="byline">${esc(page.meta.author || C.siteName)}</span></div>`
    : '';
  return `<section class="page-hero${page.isPost ? ' post-head' : ''}">
  <div class="wrap">
    ${crumbHtml}
    ${h.eyebrow ? `<span class="eyebrow">${esc(h.eyebrow)}</span>` : ''}
    <h1>${h.titleHtml || esc(h.title || page.meta.title)}</h1>
    ${h.lede ? `<p class="lede">${esc(h.lede)}</p>` : ''}
    ${meta}
    ${subHtml}
  </div>
</section>`;
}

function footer(root) {
  const social = SOCIAL.map(([k, label, href]) => `<a href="${href}" target="_blank" rel="noopener" aria-label="${label}">${ICONS[k]}</a>`).join('');
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <img src="${root}assets/img/logos/semfe_alumni_logo.jpg" alt="" width="46" height="46" loading="lazy">
          <p><strong style="color:#fff">Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ</strong><br>Ο επίσημος φορέας των αποφοίτων της Σχολής Εφαρμοσμένων Μαθηματικών και Φυσικών Επιστημών του ΕΜΠ, από το 2013.</p>
        </div>
        <div class="footer-social">${social}</div>
      </div>
      <div>
        <h2>Ο Σύλλογος</h2>
        <ul>
          <li><a href="${root}#orama">Όραμα &amp; Σκοπός</a></li>
          <li><a href="${root}organa/">Όργανα</a></li>
          <li><a href="${root}governance/">Διοίκηση</a></li>
          <li><a href="${root}assets/docs/foundation/katastatiko.pdf">Καταστατικό (PDF)</a></li>
        </ul>
      </div>
      <div>
        <h2>Ιστορία</h2>
        <ul>
          <li><a href="${root}how_we_started/">Πώς ξεκινήσαμε</a></li>
          <li><a href="${root}fotothiki/">Φωτοθήκη</a></li>
          <li><a href="${root}archive/">Αρχείο</a></li>
          <li><a href="${root}blog/">Ανακοινώσεις</a></li>
        </ul>
      </div>
      <div>
        <h2>Μέλη</h2>
        <ul>
          <li><a href="${root}support/">Εγγραφή &amp; Δωρεές</a></li>
          <li><a href="${root}account/">Ο λογαριασμός μου</a></li>
          <li><a href="${root}members/">Περιοχή μελών</a></li>
          <li><a href="${root}contact/">Επικοινωνία</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>Copyright &copy; 2013–${YEAR_NOW} Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ</span>
      <span><a href="${root}privacy/">Πολιτική απορρήτου</a> · <a href="${root}terms/">Όροι χρήσης</a> · <a href="${root}data-deletion/">Διαγραφή δεδομένων</a></span>
    </div>
  </div>
</footer>`;
}

function fill(body, root, page) {
  return body
    .replace(/\{\{root\}\}/g, root)
    .replace(/\{\{icon:([a-z]+)\}\}/g, (m, k) => { if (!ICONS[k]) throw new Error(`${page.file}: unknown icon "${k}"`); return ICONS[k]; })
    .replace(/\{\{latest\}\}/g, () => `<div class="posts">${posts.slice(0, 3).map(p => postCard(p, root)).join('\n')}</div>`)
    .replace(/\{\{posts\}\}/g, () => `<div class="posts" id="post-list">${posts.map(p => postCard(p, root)).join('\n')}</div>`)
    .replace(/\{\{post:([a-z0-9_-]+)\}\}/g, (m, slug) => { const p = postBySlug[slug]; if (!p) throw new Error(`${page.file}: no post with slug ${slug}`); return root + p.path; })
    .replace(/\{\{social\}\}/g, () => `<div class="social">${SOCIAL.map(([k, label, href]) => `<a class="${k}" href="${href}" target="_blank" rel="noopener">${ICONS[k]}${label}</a>`).join('')}</div>`);
}

function render(page) {
  /* 404.html is served for a missing address at ANY depth, so its links
     cannot be relative; they use the site's own path (/semfealumni/). */
  const root = page.meta.absRoot ? new URL(SITE_URL).pathname : rootFor(page.path);
  let main;
  if (page.isPost) {
    const i = posts.indexOf(page);
    const newer = posts[i - 1], older = posts[i + 1];
    const nav = `<nav class="post-nav" aria-label="Άλλες ανακοινώσεις">${older ? `<a class="prev" href="${root}${older.path}"><small>← Προηγούμενη</small>${esc(older.meta.title)}</a>` : '<span></span>'}${newer ? `<a class="next" href="${root}${newer.path}"><small>Επόμενη →</small>${esc(newer.meta.title)}</a>` : ''}</nav>`;
    main = `<section class="tight"><div class="wrap"><article class="prose">\n${fill(page.body, root, page)}\n</article>\n${nav}</div></section>`;
  } else {
    main = fill(page.body, root, page);
  }
  const bodyAttrs = [page.meta.firestore ? 'data-firestore="1"' : '', page.meta.bodyClass ? `class="${page.meta.bodyClass}"` : ''].filter(Boolean).join(' ');
  return `${head(page, root)}
<body${bodyAttrs ? ' ' + bodyAttrs : ''}>
${header(page, root)}

<main id="main">
${pageHero(page, root)}
${main}
</main>

${footer(root)}
</body>
</html>
`;
}

/* ---- build ----------------------------------------------------------------- */
const pages = readSrc('pages').map(p => ({ ...p, path: p.meta.path }));
for (const p of posts) {
  p.isPost = true;
  p.meta.nav = 'blog';
  p.meta.hero = { title: p.meta.title };
  p.meta.crumbs = [['Ανακοινώσεις', 'blog/']];
}
const all = [...pages, ...posts];
const seen = new Set();
const out = [];
for (const page of all) {
  if (page.path == null) throw new Error(`${page.file}: META needs "path"`);
  if (!page.meta.title || !page.meta.description) throw new Error(`${page.file}: META needs "title" and "description"`);
  const file = page.meta.file || (page.path + 'index.html');
  if (seen.has(file)) throw new Error(`two sources write ${file}`);
  seen.add(file);
  out.push([file, render(page)]);
}

/* sitemap.xml: every indexable page */
out.push(['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.filter(p => !p.meta.noindex && !p.meta.file).map(p => `  <url><loc>${SITE_URL}${p.path}</loc>${p.isPost ? `<lastmod>${p.meta.date}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`]);

let changed = 0;
for (const [file, html] of out) {
  const full = path.join(ROOT, file);
  const before = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (before === html) continue;
  changed++;
  if (CHECK) { console.log(`out of date: ${file}`); continue; }
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, html);
}
if (CHECK) {
  if (changed) { console.log(`${changed} page(s) differ from _src/. Run: node tools/build.mjs`); process.exit(1); }
  console.log(`all ${out.length} generated files match _src/`);
} else {
  console.log(`built ${out.length} files (${changed} changed)`);
}
