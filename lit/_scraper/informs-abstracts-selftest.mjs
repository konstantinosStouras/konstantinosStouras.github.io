/*
 * informs-abstracts-selftest.mjs — offline tests (no network) for the
 * INFORMS full-abstract extraction:
 *   abstractFromPageHtml(html) — the pubsonline (Atypon) page extractor
 *   betterAbstract(cur, cand)  — the upgrade-only apply rule
 * plus a parity pass asserting the browser-console harvester's VENDORED
 * extractor (informs-abstracts-console.js) matches informs-abstracts.mjs on
 * every fixture — same discipline as informs-editors-selftest.mjs.
 * Run:
 *   node lit/_scraper/informs-abstracts-selftest.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abstractFromPageHtml, betterAbstract, cleanAbstractText, ABS_MAX } from './informs-abstracts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [];
const scan = (h) => { FIXTURES.push(h); return abstractFromPageHtml(h); };

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };
const eq = (got, want, msg) => ok(got === want, `${msg}${got === want ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);

const FULL = 'We study how advertising functions as a signal of product quality in e-commerce search rankings, '
  + 'and show that platforms can exploit the information content of bids when designing ranking algorithms. '
  + 'Using data from a large marketplace, we estimate a structural model of advertiser competition and quantify '
  + 'the welfare effects of information-augmented rankings for consumers, sellers, and the platform.';

console.log('abstractFromPageHtml: Atypon containers');
let r = scan(`<html><body><div class="abstractSection abstractInFull"><h2>Abstract</h2><p>${FULL}</p></div>`
  + `<div class="hlFld-Fulltext"><p>1. Introduction …</p></div></body></html>`);
eq(r, FULL, 'abstractSection div extracted, "Abstract" heading stripped, full-text never leaks');

r = scan(`<div class="abstractSection"><p>${FULL}</p><p>History: Received May 1, 2021; accepted March 2, 2023. `
  + `Olivier Toubia served as the senior editor.</p></div>`);
eq(r, FULL, 'a History line inside the abstract container is cut off');

r = scan(`<html><head><meta name="dc.Description" content="${FULL}"></head><body>no abstract div</body></html>`);
eq(r, FULL, 'dc.Description meta fallback when no container exists');

const TEASER = 'This paper evaluates the role of advertising as information in designing platform search engines. '
  + 'It develops a framework for ranking listings when bids carry signal value.';
r = scan(`<head><meta property="og:description" content="${TEASER.slice(0, 150)}"></head>`
  + `<div class="abstractSection"><p>${FULL}</p></div>`);
eq(r, FULL, 'longest candidate wins over a truncated og:description');

r = scan(`<div class="abstractSection"><p>Charging &amp;amp; discharging: we model P &lt; 0.05 effects &#8212; robustly.</p></div>`);
ok(r === null || !/&/.test(r.replace(/&(?![a-z#])/gi, '')), 'entities decoded (double-encoding resolved)');

r = scan('<html><body><p>No abstract anywhere on this page.</p></body></html>');
eq(r, null, 'page without an abstract → null (cached as a miss)');

r = scan(`<div class="abstractSection"><p>Too short.</p></div>`);
eq(r, null, 'sub-60-char fragment rejected (not a real abstract)');

console.log('cleanAbstractText basics');
eq(cleanAbstractText('  Abstract:  Hello   world  '), 'Hello world', 'label stripped, whitespace collapsed');

console.log('betterAbstract: upgrade-only rule');
ok(betterAbstract('', FULL), 'empty served abstract ← full page abstract');
ok(betterAbstract(TEASER.slice(0, 98), FULL), 'one-line teaser ← full page abstract');
ok(!betterAbstract(FULL, FULL.slice(0, 200)), 'fuller existing text is never replaced by a fragment');
ok(!betterAbstract(FULL, FULL + ' Plus a few words.'), 'near-identical length never churns');
ok(!betterAbstract(TEASER, ''), 'no candidate → no change');
ok(ABS_MAX === 4000, 'ABS_MAX mirrors build-data MAX_ABSTRACT (keep in sync)');

console.log('console harvester: vendored extractor parity (informs-abstracts-console.js)');
await import(pathToFileURL(join(__dirname, 'informs-abstracts-console.js')).href);
const v = globalThis.__litAbs;
ok(v && typeof v.abstractFromPageHtml === 'function', 'console script loads outside the browser without auto-running');
let mismatches = 0;
for (const input of FIXTURES) {
  const a = abstractFromPageHtml(input);
  const b = v.abstractFromPageHtml(input);
  if (JSON.stringify(a) !== JSON.stringify(b)) { mismatches++; console.error('  parity mismatch on fixture:', String(input).slice(0, 80)); }
}
ok(mismatches === 0, `vendored extractor matches informs-abstracts.mjs on all ${FIXTURES.length} fixtures`);

console.log(fails ? `\nFAILED (${fails})` : '\nAll informs-abstracts checks passed.');
process.exit(fails ? 1 : 0);
