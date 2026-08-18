#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   stouras.com — every page previews properly when somebody shares it.

       node tools/share-check.mjs
       node tools/share-check.mjs --verbose

   WHY THIS EXISTS. The owner pasted /lit/ and operationsacademia.org into the
   same WhatsApp conversation. The Lit drew a card; the other site drew its own
   hostname twice and nothing else. Chasing that down turned up a defect class
   BOTH sites had, and this repository is the one that had been getting away
   with it:

     A SERVED FILE THAT DECLARES ANOTHER PAGE'S og:url STEALS THAT PAGE'S
     PREVIEW. Facebook's crawler family — which serves WhatsApp, Messenger,
     Facebook, LinkedIn and Viber — keys a preview on `og:url`, not on the
     address that was pasted. Twenty-five files under `backups/`,
     `lab/problem-solving/back-ups/` and `fun/ms-old/back-ups/` were being
     published by GitHub Pages (Jekyll serves any directory whose name does not
     begin with an underscore) and between them claimed three live addresses,
     including the home page's. They are `_backups/site/` and `_back-ups/` now,
     which is the whole fix: an underscore un-serves a directory.

   And the smaller, more embarrassing one, which no check could ever have
   caught because nobody looks at a picture twice:

     THE LIT'S CARD WAS OUT OF DATE. It said "EIGHT SOURCES" over a catalogue
     that had long since passed eight, and gave the address as
     "stouras.com/fun/lit" — where The Lit had not lived since it was promoted
     to /lit/. Every share for months carried both. Cards are now generated
     from `tools/make-share-images.mjs`, so the wording can be corrected, and
     this check measures the FILE rather than trusting the tags.

   THE RULES, and whose requirement each is:

     * every page in MANAGED carries the whole block, with the copy this file
       holds. A new page under a managed path fails until it is listed;
     * og:url and <link rel="canonical"> AGREE, absolute, https, on
       www.stouras.com. Meta picks unpredictably when they differ;
     * NO TWO SERVED FILES DECLARE THE SAME og:url, except the deliberate
       single-page-app arrangement named in SHARED_IDENTITY;
     * EXACTLY ONE og:image per page — several are legal Open Graph and
       WhatsApp handles them badly;
     * every og:image is absolute https on this host, EXISTS in the repository,
       is a JPEG or a PNG, is under 300 KB (WhatsApp silently drops a heavier
       thumbnail and the card degrades to plain text), and its declared
       og:image:width/height MATCH the file's real pixels — Meta lays the card
       out from the declared numbers before it has downloaded the file, which
       is what decides whether the FIRST person to share a link sees a big card
       or a small one;
     * og:* uses property=, twitter:* uses name=. Backwards, they are invisible
       to the crawler that wanted them and nothing warns;
     * a page carrying og:* also carries a <meta name="description">, because
       WeChat and Google read that one and not og:description.

   WHAT IT CANNOT CHECK: whether a crawler can REACH the page. A Pages edge
   answering facebookexternalhit with a 403, a Meta-side domain flag, or a
   cached failed scrape all look exactly like a site with bad tags. The
   Facebook Sharing Debugger settles all three in one paste —
   https://developers.facebook.com/tools/debug/ — read "Response Code" and
   "Time Scraped".

   And one honest limit on WeChat, since it is the reason this was asked for:
   MOBILE WeChat does not unfurl a pasted link at all. Tencent withdrew that in
   2017 for pages without a signed JS-SDK integration, which needs a verified
   Official Account and an ICP-filed domain — neither of which a GitHub Pages
   site can have. The desktop client, WeCom, and "share to WeChat" from a
   browser DO read these tags, and the square thumbnail below is for them.
   --------------------------------------------------------------------------- */

import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

export const SITE = 'https://www.stouras.com';
const MAX_CARD_BYTES = 300 * 1024;

/* ---------------------------------------------------------------------------
   THE MANAGED PAGES — the ones somebody actually pastes to somebody else.

   Each carries the full block: og:*, twitter:*, a description, a canonical,
   and the image_src / itemprop trio that hands the SQUARE thumbnail to the
   clients that crop a card to 1:1.

   Every OTHER served page that carries og:* is checked for correctness (see
   the rules above) but keeps its own words and its own picture — those are the
   /fun/ games and the /lab/ tools, each with a card of its own that has
   nothing to do with this one.
   --------------------------------------------------------------------------- */
export const MANAGED = [
  {
    file: 'index.html', url: '/',
    ogTitle: 'Konstantinos I. Stouras',
    siteName: 'Konstantinos I. Stouras',
    ogType: 'profile',
    locale: 'en_US',   // this page declares lang="en-us"; see the check below
    description: 'Assistant Professor of Management at UCD Michael Smurfit Graduate Business School — research on innovation contests, crowdsourcing platforms and technology management, plus teaching and a pile of side projects.',
    ogDescription: 'Assistant Professor of Management at UCD Michael Smurfit GSB. Research in technology management, crowdsourcing platforms, and innovation contests.',
    card: '/images/og-home.jpg', square: '/images/share-square.jpg',
    alt: 'Konstantinos I. Stouras — Assistant Professor of Management, UCD Michael Smurfit Graduate Business School',
    /* Tags this page carries BEYOND the shared block, asserted here because a
       sweep that rewrites the block is exactly what dropped them once: og:type
       is "profile", so the person's own sub-properties belong with it, and
       twitter:site/creator are what put the @handle on an X card — neither has
       an Open Graph equivalent to fall back on. */
    /* DELIBERATELY NOT CARRIED FORWARD: og:updated_time, which this page had
       hardcoded to 2026-03-01 and which nothing has ever updated. A timestamp
       that is wrong is worse than none — it tells a crawler the page has not
       changed since March while the site changes weekly. Restore it only with
       something that actually maintains it. */
    extra: {
      'og:profile:first_name': 'Konstantinos',
      'og:profile:last_name': 'Stouras',
      'og:profile:username': 'stourask',
      'twitter:site': '@stourask',
      'twitter:creator': '@stourask',
    },
  },
  {
    file: 'lit/index.html', url: '/lit/',
    ogTitle: 'The Lit — Research Paper Browser',
    siteName: 'The Lit',
    description: 'Search and filter research papers across the UTD24, the FT50 and the ABS-ranked journals in operations, management, marketing and economics — by journal, journal type, year, author, editor, area or affiliation, with BibTeX export.',
    ogDescription: 'One search across the UTD24, the FT50 and the ABS journals — filter by journal, year, author, editor or affiliation, and export BibTeX.',
    card: '/lit/og-image.jpg', square: '/lit/share-square.jpg',
    alt: 'The Lit — a research paper browser over the UTD24, FT50 and ABS journals',
  },
  {
    file: 'lit/about/index.html', url: '/lit/about/',
    ogTitle: 'About The Lit',
    siteName: 'The Lit',
    description: 'What The Lit covers and where its data come from — the journal lists, the filters, the citation graph, the sign-in library and e-mail alerts, and what changed most recently.',
    card: '/lit/og-image.jpg', square: '/lit/share-square.jpg',
    alt: 'The Lit — a research paper browser over the UTD24, FT50 and ABS journals',
  },
  {
    file: 'lit/analytics/index.html', url: '/lit/analytics/',
    ogTitle: 'The Lit — Data Analytics',
    siteName: 'The Lit',
    description: 'Summary statistics over The Lit’s whole catalogue: publication and citation trends by journal, co-authorship, citation flows between journals, team size and disruption, with author and paper comparisons.',
    card: '/lit/og-image.jpg', square: '/lit/share-square.jpg',
    alt: 'The Lit — Data Analytics over the whole research catalogue',
  },
  {
    file: 'lit/feedback/index.html', url: '/lit/feedback/',
    ogTitle: 'Feedback on The Lit',
    siteName: 'The Lit',
    description: 'Report a problem with The Lit, attach a screenshot, or suggest a published or working paper the catalogue is missing. Every submission gets a ticket number and a reply.',
    card: '/lit/og-image.jpg', square: '/lit/share-square.jpg',
    alt: 'The Lit — a research paper browser over the UTD24, FT50 and ABS journals',
  },
  {
    file: 'fun/index.html', url: '/fun/',
    ogTitle: 'Fun Projects — games & interactive tools',
    siteName: 'stouras.com',
    description: 'Games and interactive tools built for fun: The Lit paper browser, the PortfolioFit packing game, a world capitals quiz, a Greek prefectures map, strategy puzzles, Sudoku and Snake.',
    ogDescription: 'A small collection of games and interactive tools I have been building for fun.',
    card: '/fun/og-image.jpg', square: '/fun/share-square.jpg',
    alt: 'Fun Projects — games and interactive tools by Konstantinos Stouras',
  },
  {
    file: 'sustainable-supply-chains/index.html', url: '/sustainable-supply-chains/',
    ogTitle: 'Sustainable Supply Chains — a global sourcing simulation',
    siteName: 'stouras.com',
    description: 'A class simulation of global supply chains: student teams run competing firms — sourcing components worldwide, managing logistics and inventory, and balancing profit against CO2 and ESG under tariffs and disruptions.',
    ogDescription: 'Student teams run competing firms — sourcing worldwide, choosing sea or air, and pricing each market against CO2, ESG and tariffs.',
    card: '/sustainable-supply-chains/og-image.jpg',
    square: '/sustainable-supply-chains/share-square.jpg',
    alt: 'Sustainable Supply Chains — a global sourcing class simulation',
  },
];

/* The ONE place two served files may name one address, and why. GitHub Pages
   serves the root 404.html for any path with no file of its own, which is how
   a deep link into the Ideation Challenge single-page app — /lab/ideasearchlab/
   admin/… — reaches a crawler at all. Both 404s therefore carry the app's card
   deliberately, and all three files' tags say the same thing, so there is no
   noindex and no contradiction to inherit. This is the exception that proves
   the rule, not a loophole: add to it only with a reason of this shape. */
const SHARED_IDENTITY = new Map([
  [`${SITE}/lab/ideasearchlab/`, ['404.html', 'lab/ideasearchlab/404.html', 'lab/ideasearchlab/index.html']],
]);

/* A page served under /lit/ is part of The Lit, and The Lit is the thing people
   share. So every one of them is either MANAGED above or named here with a
   reason — a new sub-page cannot ship cardless and green, which is the claim
   this file's header makes and could not previously keep. Deliberately scoped
   to /lit/ rather than the whole site: the /fun/ and /lab/ trees are dozens of
   independent apps that each carry their own card, and a blanket rule over
   them would be a rule nobody could satisfy. */
const LIT_EXEMPT = new Map([
  ['lit/db-preview/index.html', 'a noindex engineering proof of concept for the range-served SQLite search, not a page for readers'],
]);

/* Served pages that carry og:* but NO og:image, so they preview as a text card
   rather than a picture one. Named rather than tolerated: each is a lab page
   with no card art, and drawing one is a deliberate act, not a fix this check
   should force. Delete an entry when its page gets a card. */
const NO_CARD_IMAGE = new Set([
  'lab/interpolation/index.html',   // an interpolation demo, no art
  'lab/search/index.html',          // a replica of a published experiment
  'lab/jagged/index.html',          // deliberately unlisted until it launches
]);

/* --------------------------------------------------------------- the pixels */

/* No dependencies in this repository, so an image is measured from its own
   bytes. PNG states its size in the IHDR chunk at offset 16. JPEG hides it in
   whichever SOFn frame header comes first, and the walk has two traps: the
   standalone markers (SOI/EOI, the RSTn restarts) carry NO length field, so
   stepping over a length that is not there desynchronises everything after it;
   and 0xC4/0xC8/0xCC sit numerically inside the SOFn range without being frame
   headers. */
export function pixels(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'image/png' };
  }
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 3 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9 || m === 0xDA) break;
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'image/jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

/* ---------------------------------------------------------------- the check */

/* Run only as the entry point, so MANAGED can be imported by anything that
   writes the block into the pages. `pathToFileURL`, not a template string: a
   raw path and a file URL are not the same text once the path holds a space,
   and this repository has several. */
export function main() {
  const problems = [];
  const notes = [];
  const bad = (file, msg) => problems.push(`${file}: ${msg}`);

  /* An attribute is HTML, so a `&` arrives as `&amp;`. A crawler decodes it
     before it renders the card and before it counts the characters. */
  const decode = (s) => (s === null || s === undefined ? s : s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&'));

  /* The <head>, with COMMENTS REMOVED. A commented-out tag is not a tag, and
     without this a page whose whole preview block had been commented out
     passed green — the block's own explanatory comment names og: properties
     in prose, so the readers below cannot simply be trusted to ignore them. */
  const head = (src) => {
    const i = src.toLowerCase().indexOf('</head>');
    return (i === -1 ? src : src.slice(0, i)).replace(/<!--[\s\S]*?-->/g, '');
  };

  function metas(src, attr) {
    const out = new Map();
    const re = new RegExp(`<meta\\s+[^>]*${attr}=["']([^"']+)["'][^>]*>`, 'gi');
    for (const m of src.matchAll(re)) {
      const content = /content=["']([^"']*)["']/i.exec(m[0]);
      const key = m[1].toLowerCase();
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(content ? decode(content[1]) : null);
    }
    return out;
  }

  function linkHref(src, rel) {
    const tag = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'i').exec(src);
    if (!tag) return null;
    const href = /href=["']([^"']*)["']/i.exec(tag[0]);
    return href ? decode(href[1]) : null;
  }

  /* Exactly what GitHub Pages publishes: Jekyll skips a name beginning with
     `_` or `.`, which is why the backup directories were renamed rather than
     deleted, and why this walk can simply mirror that one rule.

     AND THE RULE HAS A SWITCH. A `.nojekyll` file turns Jekyll off, and with
     it the underscore exclusion: every `_`-prefixed directory becomes public
     again, including the twenty-five backup copies this change un-served. A
     walk that HARDCODES the rule would not see them and would report green
     over exactly the defect this file exists to prevent — so it READS the
     switch. With `.nojekyll` present, everything is walked. */
  const NO_JEKYLL = existsSync(path.join(ROOT, '.nojekyll'));

  function served(dir, rel = '', out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.name.startsWith('_') && !NO_JEKYLL) continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) served(full, r, out);
      else if (e.name.endsWith('.html')) out.push(r);
    }
    return out;
  }

  const ALL = served(ROOT);
  const imageCache = new Map();

  function imageOf(url, file, { square = false } = {}) {
    if (!url || !url.startsWith(SITE + '/')) { bad(file, `image URL is not absolute https on ${SITE}: ${url}`); return null; }
    const rel = url.slice(SITE.length + 1).split(/[?#]/)[0];
    if (!imageCache.has(rel)) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs)) { bad(file, `names an image this repository does not have: /${rel}`); imageCache.set(rel, null); }
      else {
        const buf = readFileSync(abs);
        let px = null;
        try { px = pixels(buf); }
        catch { bad(file, `image /${rel} is truncated or malformed — its own header could not be read`); }
        if (!px) bad(file, `image is neither a JPEG nor a PNG, or could not be read: /${rel}`);
        imageCache.set(rel, px ? { ...px, bytes: buf.length, rel } : null);
      }
    }
    const info = imageCache.get(rel);
    if (info && square && info.w !== info.h) {
      bad(file, `the square thumbnail /${rel} is ${info.w}x${info.h}; the clients that use it centre-crop to 1:1`);
    }
    return info;
  }

  const managedBy = new Map(MANAGED.map(p => [p.file, p]));

  for (const file of ALL) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    const h = head(src);
    const og = metas(h, 'property');
    const tw = metas(h, 'name');
    const item = metas(h, 'itemprop');
    const p = managedBy.get(file);

    /* the two families, addressed the two ways they have to be */
    for (const k of tw.keys()) if (k.startsWith('og:')) bad(file, `${k} is emitted with name= — Open Graph is RDFa and needs property=`);
    for (const k of og.keys()) if (k.startsWith('twitter:')) bad(file, `${k} is emitted with property= — Twitter cards need name=`);

    const imgs = og.get('og:image') || [];
    if (imgs.length > 1) bad(file, `declares ${imgs.length} og:image tags; WhatsApp needs exactly one`);

    /* whatever picture a page names, managed or not, has to be one that works */
    if (imgs[0]) {
      const info = imageOf(imgs[0], file);
      if (info) {
        const w = Number((og.get('og:image:width') || [])[0]);
        const hh = Number((og.get('og:image:height') || [])[0]);
        if (w && hh && (w !== info.w || hh !== info.h)) {
          bad(file, `declares og:image ${w}x${hh}; /${info.rel} is really ${info.w}x${info.h}`);
        }
        if (info.bytes > MAX_CARD_BYTES) {
          bad(file, `og:image is ${Math.round(info.bytes / 1024)} KB; WhatsApp silently drops a thumbnail over ${MAX_CARD_BYTES / 1024} KB`);
        }
      }
    } else if (og.size && !NO_CARD_IMAGE.has(file)) {
      bad(file, 'carries og:* tags and no og:image, so it previews as a text card — give it one, or list it in NO_CARD_IMAGE with a reason');
    }

    /* a page with og:* also needs the tag WeChat and Google read */
    if (og.size && !((tw.get('description') || [])[0] || '').trim()) {
      bad(file, 'carries og:* and no <meta name="description"> — the tag WeChat and Google read instead of og:description');
    }

    if (!p) continue;

    /* ---- the managed block, in full ---- */
    const want = SITE + p.url;
    const card = SITE + p.card;
    const square = SITE + p.square;
    const alt = p.alt;

    const firstTag = /<head[^>]*>\s*(<[^>]+>)/i.exec(src);
    if (!firstTag || !/^<meta\s+charset=/i.test(firstTag[1])) {
      notes.push(`${file}: <meta charset> is not the first element in <head> — harmless inside the first 1024 bytes, worth tidying`);
    }

    const desc = (tw.get('description') || [])[0];
    if (desc !== p.description) bad(file, 'the <meta name="description"> does not match MANAGED');
    else if (desc.length < 50 || desc.length > 320) bad(file, `description is ${desc.length} characters; keep it between 50 and 320`);

    if (linkHref(h, 'canonical') !== want) bad(file, `canonical is ${linkHref(h, 'canonical')}, expected ${want}`);
    if ((og.get('og:url') || [])[0] !== want) bad(file, `og:url is ${(og.get('og:url') || [])[0]}, expected ${want} — it must agree with the canonical`);
    if ((og.get('og:type') || [])[0] !== (p.ogType || 'website')) bad(file, `og:type is not "${p.ogType || 'website'}"`);
    if ((og.get('og:site_name') || [])[0] !== p.siteName) bad(file, `og:site_name is not "${p.siteName}" — LinkedIn and Discord print it above the title`);
    /* en_GB, not en_IE: Facebook honours only the locales in its own published
       list, and en_IE is not one of them — an unsupported value is ignored
       rather than rejected, so it fails silently, which is this whole file's
       theme. en_GB is on the list and is the right spelling variety for both
       of these sites. */
    /* Each page's og:locale agrees with the language the page itself declares:
       the home page says lang="en-us" and carries hreflang="en-us" alternates,
       everything else says lang="en" and is written in British spelling. Both
       en_US and en_GB are on Facebook's own published locale list; en_IE, the
       obvious guess for an Irish site, is NOT — and an unsupported value is
       ignored rather than rejected, so it fails silently, which is this whole
       file's theme. */
    const locale = p.locale || 'en_GB';
    if ((og.get('og:locale') || [])[0] !== locale) bad(file, `og:locale is not ${locale}`);
    if ((og.get('og:title') || [])[0] !== p.ogTitle) bad(file, 'og:title does not match MANAGED');
    const ogDesc = (og.get('og:description') || [])[0];
    if (ogDesc !== (p.ogDescription || p.description)) bad(file, 'og:description does not match MANAGED');
    if (imgs.length !== 1) bad(file, `declares ${imgs.length} og:image tags; exactly one`);
    if (imgs[0] !== card) bad(file, `og:image is ${imgs[0]}, expected ${card}`);
    if ((og.get('og:image:secure_url') || [])[0] !== card) bad(file, 'og:image:secure_url does not repeat og:image');
    /* PRESENT, not merely consistent-when-present. These two decide whether
       the FIRST person to share a link gets the big card, and the general rule
       further up only compares them when they exist. */
    const shot = imageOf(card, file);
    for (const [k, v] of [['og:image:width', shot && shot.w], ['og:image:height', shot && shot.h]]) {
      const got = (og.get(k) || [])[0];
      if (got === undefined) bad(file, `has no ${k} — Meta lays the card out from it before it downloads the image`);
      else if (v && Number(got) !== v) bad(file, `${k} is ${got}, the file is ${v}`);
    }
    const info = imageOf(card, file);
    if (info && (og.get('og:image:type') || [])[0] !== info.type) bad(file, `og:image:type does not match the file (${info.type})`);
    if ((og.get('og:image:alt') || [])[0] !== alt) bad(file, 'og:image:alt does not match MANAGED');

    if ((tw.get('twitter:card') || [])[0] !== 'summary_large_image') bad(file, 'twitter:card is not summary_large_image — the one preview tag with no Open Graph equivalent');
    if ((tw.get('twitter:title') || [])[0] !== p.ogTitle) bad(file, 'twitter:title does not match MANAGED');
    if ((tw.get('twitter:description') || [])[0] !== (p.ogDescription || p.description)) bad(file, 'twitter:description does not match MANAGED');
    if ((tw.get('twitter:image') || [])[0] !== card) bad(file, 'twitter:image does not name the wide card');
    if ((tw.get('twitter:image:alt') || [])[0] !== alt) bad(file, 'twitter:image:alt does not match MANAGED');

    if (linkHref(h, 'image_src') !== square) bad(file, `has no <link rel="image_src"> naming ${p.square}`);
    if ((item.get('image') || [])[0] !== square) bad(file, `has no <meta itemprop="image"> naming ${p.square}`);
    if ((item.get('name') || [])[0] !== p.ogTitle) bad(file, 'itemprop="name" does not match MANAGED');
    if ((item.get('description') || [])[0] !== p.description) bad(file, 'itemprop="description" does not match MANAGED');
    const sq = imageOf(square, file, { square: true });
    /* The square exists BECAUSE the wide card is the wrong shape and too heavy
       for a tile drawn at about 64 px. A heavy square has no purpose, and a
       small one is skipped outright by the clients it is for. */
    if (sq && sq.bytes > 100 * 1024) bad(file, `the square thumbnail is ${Math.round(sq.bytes / 1024)} KB; keep it under 100 KB`);
    if (sq && sq.w < 300) bad(file, `the square thumbnail is ${sq.w}px; the clients that read it skip anything under 300px`);

    /* Slackbot reads the first 32 KB of a document and WhatsApp's parser gives
       up sooner. A fat head above the tags is a documented way to lose a card,
       and this repository's home page opens with four scripts. */
    for (const [k, v] of Object.entries(p.extra || {})) {
      const bare = k.replace(/^og:/, '');
      const got = ((k.startsWith('og:') ? og.get(bare) : tw.get(k)) || [])[0];
      if (got !== v) bad(file, `${bare} is ${got === undefined ? 'missing' : `"${got}"`}, expected "${v}" (see MANAGED.extra)`);
    }

    /* Slackbot reads the first 32 KB of a document and WhatsApp's parser gives
       up sooner, so the block goes ABOVE the stylesheets, the preconnects and
       the scripts — not merely somewhere in the head. This repository's home
       page had it under three scripts, three preconnects and six stylesheets,
       4.2 KB down, which is the rule both repositories state and only one of
       them was keeping. */
    const at = src.indexOf('property="og:title"');
    if (at === -1) bad(file, 'has no og:title');
    else {
      const firstHeavy = Math.min(...['<link rel="stylesheet"', '<link href="assets/', '<link rel="preconnect"',
        '<link rel="preload"', '<script'].map(t => { const i = src.indexOf(t); return i === -1 ? Infinity : i; }));
      if (at > firstHeavy) bad(file, 'the preview block sits after a stylesheet, preconnect or script — put it directly under the <title>');
      if (at > 4096) bad(file, `og:title is ${at} bytes into the document; keep the preview block inside the first 4 KB`);
    }
  }

  for (const p of MANAGED) {
    if (!existsSync(path.join(ROOT, p.file))) bad(p.file, 'is listed in MANAGED and does not exist');
  }
  for (const f of ALL) {
    if (!f.startsWith('lit/') || managedBy.has(f) || LIT_EXEMPT.has(f)) continue;
    bad(f, 'is served under /lit/ and is neither in MANAGED nor in LIT_EXEMPT — give it a card, or name it there with a reason');
  }
  for (const f of LIT_EXEMPT.keys()) {
    if (!existsSync(path.join(ROOT, f))) bad(f, 'is named in LIT_EXEMPT and does not exist — delete the entry');
  }

  /* NO TWO SERVED FILES CLAIM ONE OPEN GRAPH IDENTITY */
  const claims = new Map();
  for (const f of ALL) {
    const url = (metas(head(readFileSync(path.join(ROOT, f), 'utf8')), 'property').get('og:url') || [])[0];
    if (!url) continue;
    if (!claims.has(url)) claims.set(url, []);
    claims.get(url).push(f);
  }
  for (const [url, files] of claims) {
    if (files.length > 1) {
      const allowed = SHARED_IDENTITY.get(url);
      if (!allowed || files.length !== allowed.length || files.some(f => !allowed.includes(f))) {
        problems.push(`${files.length} served files declare og:url "${url}" — ${files.join(', ')}. ` +
          'Facebook keys a preview on og:url, not on the address that was pasted, so whichever of these it scrapes last is the card everybody gets. ' +
          'Un-serve the copies (a leading underscore does it) or give each its own address.');
      }
    }
    if (!url.startsWith(SITE + '/')) {
      problems.push(`${files[0]} declares og:url "${url}", which is not an https URL on ${SITE}`);
    }
  }

  if (VERBOSE) {
    console.log(`${ALL.length} served pages walked; ${MANAGED.length} managed here, ` +
      `${claims.size} distinct og:url values, ${NO_CARD_IMAGE.size} pages knowingly without card art.`);
    for (const [rel, info] of [...imageCache].sort()) {
      if (info) console.log(`  ${rel} — ${info.w}x${info.h} ${info.type} ${Math.round(info.bytes / 1024)} KB`);
    }
    /* Named, not tolerated: a served page with no preview metadata at all
       previews as a bare link. These are not failures — most are lab pages
       nobody shares — but they should be visible rather than invisible. */
    const bare = ALL.filter(f => {
      const h = head(readFileSync(path.join(ROOT, f), 'utf8'));
      return !metas(h, 'property').size && !/twitter:/i.test(h);
    });
    if (bare.length) console.log(`  ${bare.length} served page(s) carry no preview metadata at all: ${bare.join(', ')}`);
    for (const n of notes) console.log('  note: ' + n);
  }

  if (problems.length) {
    for (const pr of problems) console.log('::error::share-check: ' + pr);
    console.log(`\nshare-check: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(`share-check: ${ALL.length} served pages, every card complete and no two claiming one address`);
}

/* realpathSync, because a symlinked entry point compares unequal and the check
   would exit 0 having checked nothing — the silent-pass failure mode this whole
   file is about. */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
