#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Offline check of the abstract a paper card SHOWS (owner, 2026-09-15).
   No network, no credentials.

       node lit/_scraper/abstract-display-selftest.mjs

   WHAT THIS IS FOR. INFORMS closes every deposited abstract with an
   acceptance sentence — "This paper was accepted by Eric So, accounting." —
   and the data keeps it on purpose (acceptance() in build-data.mjs reads the
   editor and the area from it). The card drops it at render time, in
   cleanAbstract() in lit/index.html, and that strip matched only "This paper
   was accepted" / "This work was accepted": the three September-2026 MS
   commentaries on "Fighting Fire with Fire" end in "This commentary was
   accepted by Christoph Loch." and showed it on the card, an MS discussion
   and the "has been accepted by" records likewise. The strip now matches a
   CLOSED list of INFORMS item types and requires "by", because the two
   obvious generalisations both cut real abstracts — "This method is accepted
   by that group of accountants…" is prose (TAR, in the FT50 catalog), and
   "This paper has been accepted for the … Special Issue on …" is a note the
   ITED abstracts carry inside them. Nothing but this file pins that line.

   The function is SLICED out of index.html and run — over fixed cases, and
   over the committed papers-ms.json, so the three rows that prompted this
   are checked as they really are. The slice is length-asserted: a guard
   taken on the wrong marker passes every negative check by vacuity (see the
   messages section of CLAUDE.md).
   --------------------------------------------------------------------------- */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIT = path.join(HERE, '..');
const read = (p) => readFileSync(path.join(LIT, p), 'utf8');

let pass = 0;
const fails = [];
const ok = (cond, what) => { if (cond) pass++; else fails.push(what); };
const eq = (a, b, what) => ok(a === b,
  `${what}\n      expected ${JSON.stringify(b)}\n      got      ${JSON.stringify(a)}`);

/* ------------------------------------------------- the function, as served */
const main = read('index.html');
const from = main.indexOf('var ACCEPTED_BY_RE = ');
const to = main.indexOf('\nlet searchTimer;', from);
ok(from > 0 && to > from, 'cleanAbstract block located in index.html');
const src = main.slice(from, to);
ok(src.length > 500 && src.length < 8000, `the slice is the block, not the page (${src.length} chars)`);
ok(src.includes('function cleanAbstract('), 'the slice holds cleanAbstract');
ok(main.indexOf('function cleanAbstract(') > from && main.indexOf('function cleanAbstract(', to) === -1,
  'cleanAbstract is defined once, inside the slice');
// eslint-disable-next-line no-new-func
const { cleanAbstract, ACCEPTED_BY_RE } = new Function(src + '\nreturn { cleanAbstract: cleanAbstract, ACCEPTED_BY_RE: ACCEPTED_BY_RE };')();
ok(typeof cleanAbstract === 'function', 'cleanAbstract runs outside the page');
ok(ACCEPTED_BY_RE instanceof RegExp && !ACCEPTED_BY_RE.global,
  'ACCEPTED_BY_RE is a plain (non-global) RegExp — exec() on a global one would carry lastIndex between calls');

/* -------------------------------------------------------- fixed cases */
const SAME = Symbol('unchanged');
const CASES = [
  ['research-paper tail + funding', 'We study X. This paper was accepted by Eric So, accounting. Funding: Grant 1.', 'We study X.'],
  ['commentary tail (the three MS commentaries)', 'It concludes Y. This commentary was accepted by Christoph Loch.', 'It concludes Y.'],
  ['a closing QUESTION survives the cut', 'One test should govern any AI workflow: does it ask more of human judgment, or less? This commentary was accepted by Christoph Loch.',
    'One test should govern any AI workflow: does it ask more of human judgment, or less?'],
  ['a closing exclamation survives too', 'Do it now! This paper was accepted by A. B. Cee, marketing.', 'Do it now!'],
  ['closing quote after the terminator kept', 'We ask “why?” This paper was accepted by A B, area.', 'We ask “why?”'],
  ['"has been accepted by"', 'We show Z. This paper has been accepted by Kalyan Talluri, operations management.', 'We show Z.'],
  ['discussion', 'A point. This discussion was accepted by Christoph Loch, commentary.', 'A point.'],
  ['work', 'A result. This work was accepted by Someone, area.', 'A result.'],
  ['only the sentence -> no abstract', 'This paper was accepted by Christoph Loch, commentary.', ''],
  ['only the sentence + tail -> no abstract', 'This paper was accepted by Dmitri Kuksov, marketing. Supplemental Material: The online appendix is available at https://doi.org/x.', ''],
  ['no terminator before the tail -> cut at the tail itself', 'Unfinished prose without a period This paper was accepted by A B, area.', 'Unfinished prose without a period'],
  ['prose: "this method is accepted by" (TAR) untouched', 'An expense in the period of its accrual. This method is accepted by that group of accountants who take the point of view of the owners.', SAME],
  ['prose: "the gift was accepted by" (TAR) untouched', 'The gift was accepted by the town. The library funds were placed under trustees.', SAME],
  ['prose: "this hypothesis is accepted by" untouched', 'We test it. This hypothesis is accepted by most scholars today.', SAME],
  ['prose: "this efficiency has been accepted by" untouched', 'The existence of this efficiency has been accepted by certain business groups.', SAME],
  ['ITED "accepted for" note untouched (no "by")', 'This paper has been accepted for the INFORMS Transactions on Education Special Issue on X. We teach Y.', SAME],
  ['a noun outside the list is prose', 'This proposal was accepted by the committee. We then built it.', SAME],
  ['lowercase "this paper was accepted by" mid-sentence is prose', 'Because this paper was accepted by a general-interest journal, we compare it with others.', SAME],
  ['funding trailer alone', 'Body text. Funding: something.', 'Body text.'],
  ['History line after the text', 'Body text. History: Accepted by Christoph Loch, commentary.', 'Body text.'],
  ['only the History line -> no abstract (10.1287/mnsc.2025.01934)', 'History: Accepted by Christoph Loch, commentary.', ''],
  ['only a Funding trailer -> no abstract', 'Funding: This work was supported by grant 1.', ''],
  ['trailing DOI', 'Body text. https://doi.org/10.1287/mnsc.2024.0001.', 'Body text.'],
  ['empty', '', ''],
  ['null', null, ''],
];
for (const [what, input, expected] of CASES) {
  eq(cleanAbstract(input), expected === SAME ? input : expected, what);
}
// Idempotent: cleaning a cleaned abstract changes nothing.
for (const [what, input] of CASES) {
  const once = cleanAbstract(input);
  eq(cleanAbstract(once), once, `idempotent: ${what}`);
}

/* ------------------------------------------ the committed data, as served */
const REPORT_RE = /\bThis (?:paper|work|commentary|discussion) (?:was|has been) accepted by\b|^History:|^Accepted by\b/;
const OWNER_DOIS = ['10.1287/mnsc.2026.02441', '10.1287/mnsc.2026.02442', '10.1287/mnsc.2026.02443'];
const bare = (d) => String(d || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
for (const rel of ['data/papers-ms.json', 'data-ft50/papers-ms.json']) {
  const file = path.join(LIT, rel);
  if (!existsSync(file)) { ok(false, `${rel} is present`); continue; }
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const byDoi = new Map(rows.map((r) => [bare(r.DOI), r]));
  for (const d of OWNER_DOIS) {
    const r = byDoi.get(d);
    ok(!!r, `${rel}: ${d} is in the catalog`);
    if (!r) continue;
    const shown = cleanAbstract(r.Abstract || '');
    ok(shown.length > 200, `${rel}: ${d} still shows its abstract (${shown.length} chars)`);
    ok(!/accepted by/i.test(shown), `${rel}: ${d} no longer shows "accepted by …"`);
    ok(!/Christoph Loch/.test(shown), `${rel}: ${d} no longer names the accepting editor in the abstract`);
    if (/or less\? This commentary was accepted by/.test(r.Abstract || '')) {
      ok(/or less\?$/.test(shown), `${rel}: ${d} keeps its closing question ("…or less?")`);
    }
  }
  let leak = 0, proseAcceptedBy = 0, emptied = 0;
  for (const r of rows) {
    const raw = r.Abstract || '';
    if (!/accepted by/i.test(raw)) continue;
    const shown = cleanAbstract(raw);
    if (REPORT_RE.test(shown)) leak++;
    else if (/accepted by/i.test(shown)) proseAcceptedBy++;
    if (raw && !shown) emptied++;
  }
  eq(leak, 0, `${rel}: no card shows an INFORMS acceptance sentence (${leak} would)`);
  console.log(`  note: ${rel} — ${proseAcceptedBy} abstracts still say "accepted by" in ordinary prose (left alone), ${emptied} were nothing but the acceptance sentence or a History line and show no abstract`);
}

/* --------------------------------------------------------------- report */
if (fails.length) {
  console.error(`abstract-display-selftest: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`abstract-display-selftest: ${pass} checks passed`);
