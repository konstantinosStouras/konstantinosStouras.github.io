#!/usr/bin/env node
/* Forwarding pages for the SEMFE Alumni site's old address.

   Before it had a domain of its own, the SEMFE Alumni site was served from
   www.stouras.com/semfealumni/ (as the project site of the repository
   konstantinosStouras/semfealumni). It now lives at https://semfealumni.gr/,
   from the organisation repository semfealumni/semfealumni.github.io, and
   the old repository's Pages site is switched off. Links to the old address
   are still out there (e-mails, bookmarks, search results), so this folder
   holds one tiny page per page the site has ever had there: each sends the
   reader to the SAME page on semfealumni.gr, keeping any ?query and #anchor.
   An address under /semfealumni/ that is not in this list is caught by the
   script in the root 404.html and forwarded the same way.

   GitHub Pages has no server-side redirects, so these are the usual stub
   pages: a canonical link, a meta refresh (for crawlers and readers without
   JavaScript) and location.replace (so the Back button skips the stub).
   noindex, and no og:* tags (CLAUDE.md: redirect stubs carry none).

   This folder is the ONE thing allowed at /semfealumni/ (CLAUDE.md, the
   SEMFE section): never put the site's own pages back here.

     node tools/semfealumni-forwards.mjs          write the pages
     node tools/semfealumni-forwards.mjs --check  write nothing; exit 1 if a
                                                  page is missing or differs

   PAGES: every page of the site at commit 30c9fd3 of the old repository (the
   last one it published) and of semfealumni/semfealumni.github.io main on
   2026-10-05, without 404.html. Add a path here if the site gains a page. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'semfealumni';
const TARGET = 'https://semfealumni.gr/';
const PAGES = [
  'account/index.html',
  'admin/index.html',
  'analytics/index.html',
  'archive/index.html',
  'auth/linkedin/index.html',
  'blog/2024/02/11/10-years-semfealumni/index.html',
  'blog/2024/02/29/10-years-semfealumni-video/index.html',
  'blog/2024/10/02/gia-dimiourgia-mixanikoi_emfe-tee/index.html',
  'blog/2025/01/27/2025-kopi-pitas/index.html',
  'blog/2025/02/15/2025-tee-eidikotita/index.html',
  'blog/2025/03/02/2025-taktiki-gs/index.html',
  'blog/2025/12/28/2026-eyxes/index.html',
  'blog/2026/02/11/2026-kopi-pitas/index.html',
  'blog/archive/2024/index.html',
  'blog/archive/2025/index.html',
  'blog/archive/2026/index.html',
  'blog/category/ανακοινώσεις/index.html',
  'blog/category/εκδηλώσεις/index.html',
  'blog/index.html',
  'contact/index.html',
  'data-deletion/index.html',
  'feedback/index.html',
  'fotothiki/index.html',
  'governance/index.html',
  'how_we_started/index.html',
  'index.html',
  'members/index.html',
  'organa/index.html',
  'privacy/index.html',
  'support/index.html',
  'terms/index.html',
  'whats-new/index.html',
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function page(file) {
  const rel = file.replace(/(^|\/)index\.html$/, '$1');      // blog/index.html -> blog/
  const url = TARGET + encodeURI(rel);
  return `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="utf-8">
<title>Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ</title>
<!-- The SEMFE Alumni site moved from www.stouras.com/semfealumni/ to its own
     domain. This page only forwards an old link to the same page there
     (written by tools/semfealumni-forwards.mjs; do not edit by hand). -->
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(url)}">
<meta http-equiv="refresh" content="0; url=${esc(url)}">
<script>location.replace(${JSON.stringify(url)} + location.search + location.hash);</script>
</head>
<body>
<p>Η σελίδα μεταφέρθηκε στο <a href="${esc(url)}">semfealumni.gr</a>.</p>
</body>
</html>
`;
}

const CHECK = process.argv.includes('--check');
let bad = 0, wrote = 0;
for (const file of PAGES) {
  const out = path.join(ROOT, DIR, file), want = page(file);
  const have = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (have === want) continue;
  if (CHECK) { console.error(`differs or missing: ${DIR}/${file}`); bad++; continue; }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, want); wrote++;
}
if (CHECK) {
  if (bad) { console.error(`${bad} forwarding page(s) out of date: run node tools/semfealumni-forwards.mjs`); process.exit(1); }
  console.log(`ok    ${PAGES.length} forwarding pages under /${DIR}/ match`);
} else console.log(`wrote ${wrote} of ${PAGES.length} forwarding pages under /${DIR}/`);
