/*
 * abstracts-selftest.mjs — offline tests (no network) for the FT50 API
 * abstract backfill (abstracts-ci.mjs): OpenAlex inverted-index
 * reconstruction, the cache-merge rule, and the needy-row test.
 * Run: node lit/_scraper-ft50/abstracts-selftest.mjs
 */
import { invertedToText, mergeAbsCache, isNeedy, elsevierAbstract, springerAbstract, shouldStampMiss } from './abstracts-ci.mjs';
import { betterAbstract } from '../_scraper/informs-abstracts.mjs';

let fails = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fails++; } };
const eq = (g, w, m) => ok(g === w, `${m}${g === w ? '' : `  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`}`);

console.log('invertedToText: OpenAlex abstract_inverted_index → text');
eq(invertedToText({ We: [0], study: [1], markets: [2, 4], in: [3] }),
  'We study markets in markets', 'positions reassembled in order, repeated words placed twice');
eq(invertedToText({}), '', 'empty index → empty string');
eq(invertedToText(null), '', 'null index → empty string');
eq(invertedToText({ a: 'junk' }), '', 'malformed positions ignored');

console.log('mergeAbsCache: abstract beats none, longer beats shorter');
let c = { d1: { none: 1, t: 1 }, d2: { a: 'short' }, d3: { a: 'keep me intact' } };
const took = mergeAbsCache(c, { d1: { a: 'a full abstract text' }, d2: { a: 'a much longer abstract' }, d3: { none: 1, t: 9 }, d4: { a: 'brand new' } });
eq(took, 3, 'three entries taken (none→a, shorter→longer, new)');
eq(c.d1.a, 'a full abstract text', 'none upgraded to abstract');
eq(c.d2.a, 'a much longer abstract', 'shorter upgraded to longer');
eq(c.d3.a, 'keep me intact', 'a none-record never downgrades an abstract');
eq(c.d4.a, 'brand new', 'new entry taken');

console.log('isNeedy: missing/stub abstracts only');
ok(isNeedy({ Abstract: '' }), 'missing abstract is needy');
ok(isNeedy({ Abstract: 'One-line teaser.' }), 'sub-300-char stub is needy');
ok(!isNeedy({ Abstract: 'x'.repeat(400) }), 'a real abstract is not needy');

console.log('elsevierAbstract: Abstract Retrieval JSON → text');
eq(elsevierAbstract({ 'abstracts-retrieval-response': { coredata: { 'dc:description': 'A plain abstract text.' } } }),
  'A plain abstract text.', 'plain-string dc:description');
eq(elsevierAbstract({ 'abstracts-retrieval-response': { coredata: { 'dc:description': { abstract: { 'ce:para': 'Nested para text.' } } } } }),
  'Nested para text.', 'nested ce:para object');
eq(elsevierAbstract({ 'abstracts-retrieval-response': { coredata: { 'dc:description': 'R&amp;D and CO&lt;sub&gt;2&lt;/sub&gt; costs.' } } }),
  'R&D and CO2 costs.', 'entities decoded + markup stripped via cleanText');
eq(elsevierAbstract({}), '', 'missing body → empty');
eq(elsevierAbstract(null), '', 'null → empty');

console.log('springerAbstract: Meta API v2 JSON → text');
eq(springerAbstract({ records: [{ abstract: 'Abstract We study queueing networks under load.' }] }),
  'We study queueing networks under load.', 'plain abstract, "Abstract " prefix stripped');
eq(springerAbstract({ records: [{ abstract: 'R&amp;D alliances and CO&lt;sub&gt;2&lt;/sub&gt; policy.' }] }),
  'R&D alliances and CO2 policy.', 'entities decoded + markup stripped via cleanText');
eq(springerAbstract({ records: [] }), '', 'no records → empty');
eq(springerAbstract({}), '', 'missing records → empty');
eq(springerAbstract(null), '', 'null → empty');

console.log('betterAbstract import path (shared upgrade rule)');
ok(betterAbstract('', 'y'.repeat(80)), 'empty ← candidate works via the cross-import');


console.log('stripPageFurniture guard (feedback LIT-260727-XRQ8)');
eq(elsevierAbstract({ 'abstracts-retrieval-response': { coredata: { 'dc:description':
  'Previous articleNext article No AccessSome Paper TitleSome AuthorPDFPDF PLUS Add to favoritesDownload CitationTrack CitationsPermissionsReprints Share onFacebookXLinkedIn' } } }),
  '', 'a scraped page-chrome blob is rejected, never served as an abstract');
eq(springerAbstract({ records: [{ abstract: 'Journal Article Some Title Get access A. Author Search for other works by this author on: Oxford Academic Google Scholar' } ] }),
  '', 'an OUP-style page-header scrape is rejected');
eq(elsevierAbstract({ 'abstracts-retrieval-response': { coredata: { 'dc:description':
  'A real abstract that legitimately says firms fight their way back to top positions over time, with enough prose to look like an abstract.' } } }),
  'A real abstract that legitimately says firms fight their way back to top positions over time, with enough prose to look like an abstract.',
  '"back to top" inside real prose survives the guard');

console.log('shouldStampMiss: a keyed leg that never ran must not write off its DOIs');
{
  const ELS = /^10\.1016\//, SPR = /^10\.1007\//;
  const ejor = '10.1016/j.ejor.2026.05.001';
  const spr  = '10.1007/s11002-024-09999-9';
  const oup  = '10.1093/qje/qjaa001';
  const base = { elsPrefix: ELS, sprPrefix: SPR };

  // The real incident: ELSEVIER_API_KEY set, Elsevier refused it (401/403/429),
  // the leg dropped on its first call, so no EJOR DOI was ever queried. Those
  // must stay uncached and be retried next run, not written off for 45 days.
  ok(!shouldStampMiss(ejor, { ...base, elsKey: 'k', sprKey: '', keyedTried: new Set() }),
    'keyed Elsevier DOI the leg never reached is NOT stamped as a miss');
  ok(shouldStampMiss(ejor, { ...base, elsKey: 'k', sprKey: '', keyedTried: new Set([ejor]) }),
    'keyed Elsevier DOI the leg DID try is stamped (a genuine no-abstract)');
  // With no key configured there is no keyed leg to wait for, so the batched
  // OpenAlex/S2 legs' verdict stands — the pre-existing behaviour, unchanged.
  ok(shouldStampMiss(ejor, { ...base, elsKey: '', sprKey: '', keyedTried: new Set() }),
    'unkeyed run still stamps Elsevier DOIs (behaviour unchanged without a key)');
  ok(!shouldStampMiss(spr, { ...base, elsKey: '', sprKey: 'k', keyedTried: new Set() }),
    'the same rule protects Springer DOIs when only that key is set');
  ok(shouldStampMiss(spr, { ...base, elsKey: 'k', sprKey: '', keyedTried: new Set() }),
    'a Springer DOI is not protected by the Elsevier key');
  // A DOI no keyed leg owns is unaffected either way.
  ok(shouldStampMiss(oup, { ...base, elsKey: 'k', sprKey: 'k', keyedTried: new Set() }),
    'a non-Elsevier, non-Springer DOI is stamped normally');
}

console.log(fails ? `\nFAILED (${fails})` : '\nAll FT50 abstract-backfill checks passed.');
process.exit(fails ? 1 : 0);
