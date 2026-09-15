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
   "This paper has been accepted for publication in the Journal of …" is a
   note two OSF working papers end with. The one INFORMS tail WITHOUT "by" —
   M&SOM's "This paper has been accepted for the Manufacturing & Service
   Operations Management Special Issue on …", the last sentence of twenty
   abstracts — has its own journal-anchored pattern. Nothing but this file
   pins those lines.

   The function lives in lit/lit-abstract.js — ONE definition, loaded by the
   page (the card AND the Abstracts search, which used to run over the raw
   field and so still found "this commentary was" once the cards no longer
   said it — owner, 2026-09-15), by the alerts mailer and by emit-db.mjs.
   This file requires that module exactly as they do and runs it over fixed
   cases and over the committed INFORMS papers files, so the rows that
   prompted this are checked as they really are; and it pins that every
   consumer really loads that file rather than a copy of its own.
   --------------------------------------------------------------------------- */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIT = path.join(HERE, '..');
const read = (p) => readFileSync(path.join(LIT, p), 'utf8');

let pass = 0;
const fails = [];
const ok = (cond, what) => { if (cond) pass++; else fails.push(what); };
const eq = (a, b, what) => ok(a === b,
  `${what}\n      expected ${JSON.stringify(b)}\n      got      ${JSON.stringify(a)}`);

/* ------------------------------------------------- the function, as served */
// lit/lit-abstract.js is the ONE definition; it is required here exactly as
// the mailer and emit-db.mjs require it, and the page loads the same file.
const LitAbstract = createRequire(import.meta.url)(path.join(LIT, 'lit-abstract.js'));
const { cleanAbstract, ACCEPTED_BY_RE, ACCEPTED_FOR_RE } = LitAbstract;
ok(typeof cleanAbstract === 'function', 'lit-abstract.js exports cleanAbstract');
for (const [name, re] of [['ACCEPTED_BY_RE', ACCEPTED_BY_RE], ['ACCEPTED_FOR_RE', ACCEPTED_FOR_RE]]) {
  ok(re instanceof RegExp && !re.global && !re.ignoreCase,
    `${name} is a plain case-sensitive non-global RegExp — exec() on a global one would carry lastIndex between calls, and a case-insensitive one would cut mid-sentence prose`);
}
const modSrc = read('lit-abstract.js');
ok(!/=>|\bconst\b|\blet\b|`/.test(modSrc.slice(modSrc.indexOf("'use strict'"))),
  'the module body is ES5 (var/function only), like the page code around its call sites');

/* -------------------------------------- every consumer loads THAT file */
// The page: the <script src> sits ABOVE the main script, the page keeps no
// definition of its own (a second copy is how the two would drift), and the
// Abstracts search reads the SHOWN text through absSearchText in BOTH filter
// passes — never the raw field.
const main = read('index.html');
const tagAt = main.indexOf('<script src="lit-abstract.js"></script>');
const mainScriptAt = main.indexOf('\n<script>\n', main.indexOf('<script type="application/ld+json">'));
ok(tagAt > 0 && mainScriptAt > tagAt, 'index.html loads lit-abstract.js before its main script');
ok(main.indexOf('var ACCEPTED_BY_RE') === -1 && !/function cleanAbstract\(s\) \{\n  if \(!s\) return ''/.test(main),
  'index.html keeps no copy of the strip of its own');
const wrapAt = main.indexOf('function cleanAbstract(');
ok(wrapAt > 0 && main.indexOf('function cleanAbstract(', wrapAt + 1) === -1
  && /window\.LitAbstract\.cleanAbstract\(s\)/.test(main.slice(wrapAt, wrapAt + 400)),
  'the page\'s cleanAbstract is one wrapper over window.LitAbstract');
ok((main.match(/absSearchText\(p\)/g) || []).length >= 2,
  'both filter passes (applyFilters + crossFilter) search the shown abstract via absSearchText');
ok(!/(?<!cleanAbstract)\(p\['Abstract'\]\s*\|\|\s*''\)\.toLowerCase\(\)/.test(main),
  'no filter pass lower-cases the raw Abstract field for searching any more');
ok(main.indexOf('function absSearchText(') > 0 && /_absq/.test(main.slice(main.indexOf('function absSearchText('), main.indexOf('function absSearchText(') + 300)),
  'absSearchText caches the shown text per row');
// The mailer: the abstract criterion goes through the same file.
const mailer = read('_scraper/alerts-mailer.mjs');
ok(/createRequire\(import\.meta\.url\)\(path\.join\(__dirname, '\.\.', 'lit-abstract\.js'\)\)/.test(mailer),
  'alerts-mailer.mjs requires lit/lit-abstract.js');
const mc = mailer.slice(mailer.indexOf('function matchesCriteria('), mailer.indexOf('function matchesCriteria(') + 3000);
ok(mc.length > 500, 'matchesCriteria is where this thinks it is');
ok(/LitAbstract\.cleanAbstract\(p\.Abstract/.test(mc) && !/(?<!cleanAbstract)\(p\.Abstract \|\| ''\)\.toLowerCase\(\)/.test(mc),
  'the mailer\'s abstract criterion matches the shown abstract, not the raw field');
// emit-db: the ?db=1 trigram index holds the shown text.
const emit = read('_scraper/emit-db.mjs');
ok(/createRequire\(import\.meta\.url\)\('\.\.\/lit-abstract\.js'\)/.test(emit) && /cleanAbstract\(p\.Abstract \|\| ''\)/.test(emit),
  'emit-db.mjs indexes the shown abstract through lit-abstract.js');

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
  ['M&SOM special-issue tail (no "by") cut', 'We model Q. This paper has been accepted for the Manufacturing & Service Operations Management Special Issue on Value Chain Innovations in Developing Economies.', 'We model Q.'],
  ['M&SOM special-section tail cut', 'We model Q. This paper has been accepted for the Manufacturing & Service Operations Management Special Section on Sustainable Operations.', 'We model Q.'],
  ['ITED special-issue line inside a History block cut by the trailer rule', 'We teach Y. History: This paper has been accepted for the INFORMS Transactions on Education Special Issue on X.', 'We teach Y.'],
  ['OSF working-paper "accepted for publication in" note untouched', 'We find R. This paper has been accepted for publication in the Journal of Personality and Social Psychology.', SAME],
  ['"accepted for" a non-INFORMS special issue is prose', 'We find R. This paper has been accepted for the Journal of Finance Special Issue on X.', SAME],
  ['"article" is not an INFORMS item type: the JAP glued-on editor note is left (cutting it would take the real last sentence)', 'Rewards go by merit, fairness is achieved, according to Aristotle, when Note This article was accepted by former Editor John P Campbell', SAME],
  ['lowercase "this article has been accepted by" mid-sentence untouched (case-sensitive)', 'As this article has been accepted by the Frontiers of Computer Science, here is an early version.', SAME],
  ['a noun outside the list is prose', 'This proposal was accepted by the committee. We then built it.', SAME],
  ['lowercase "this paper was accepted by" mid-sentence is prose', 'Because this paper was accepted by a general-interest journal, we compare it with others.', SAME],
  ['funding trailer alone', 'Body text. Funding: something.', 'Body text.'],
  ['M&SOM "online supplement" line + DOI + special-issue tail (msom.2018.0722 shape)', 'Body text. The online supplement is available at https://doi.org/10.1287/msom.2018.0722 . This paper has been accepted for the Manufacturing & Service Operations Management Special Issue on Value Chain Innovations in Developing Economies.', 'Body text.'],
  ['IJOC "online supplement and data are available at" line', 'Body text. The online supplement and data are available at https://doi.org/10.1287/ijoc.2021.0001.', 'Body text.'],
  ['M&SOM plural "online appendices are available at" line + special-issue tail (msom.2018.0735 shape)', 'Simple menus often suffice. The online appendices are available at https://doi.org/10.1287/msom.2018.0735 . This paper has been accepted for the Manufacturing & Service Operations Management Special Issue on Value Chain Innovations in Developing Economies.', 'Simple menus often suffice.'],
  ['MS "online supplementary document is available at" line', 'Body text. The online supplementary document is available at https://doi.org/10.1287/mnsc.2021.0001.', 'Body text.'],
  ['an abstract sentence ABOUT its supplement stays (arXiv)', 'We estimate the model. The online supplement contains two vignettes comparing frequentist and Bayesian estimation.', SAME],
  ['History line after the text', 'Body text. History: Accepted by Christoph Loch, commentary.', 'Body text.'],
  ['only the History line -> no abstract (10.1287/mnsc.2025.01934)', 'History: Accepted by Christoph Loch, commentary.', ''],
  ['only a Funding trailer -> no abstract', 'Funding: This work was supported by grant 1.', ''],
  ['trailing DOI after a complete sentence', 'Body text. https://doi.org/10.1287/mnsc.2024.0001.', 'Body text.'],
  ['the sentence that only pointed at the trailing DOI goes with it', 'We show Z. The e-companion is available at https://doi.org/10.1287/opre.2021.0001.', 'We show Z.'],
  ['"Data are available at <doi>" pointer goes too', 'We show Z. Data are available at https://doi.org/10.5281/zenodo.1 .', 'We show Z.'],
  ['an abstract that is only a pointer shows nothing', 'Data are available at https://doi.org/10.5281/zenodo.1.', ''],
  ['a DOI URL mid-abstract is untouched', 'See https://doi.org/10.1287/mnsc.2024.0001 for the data. We conclude.', SAME],
  ['a non-DOI trailing URL is untouched (no pointer rule without a stripped DOI)', 'Code is at https://github.com/x/y.', SAME],
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
const REPORT_RE = /\bThis (?:paper|work|commentary|discussion) (?:was|has been) accepted by\b|\bThis paper has been accepted for the [A-Z][^.]{0,60}Special (?:Issue|Section)\b|^History:|^Accepted by\b/;
const OWNER_DOIS = ['10.1287/mnsc.2026.02441', '10.1287/mnsc.2026.02442', '10.1287/mnsc.2026.02443'];
const bare = (d) => String(d || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
// Every native INFORMS file, plus the FT50 catalog's copies of the five it
// shares with the native data (the page drops those copies from the recent
// view, but a type-chip search renders them) and IJOC, the INFORMS journal
// only the FT50 catalog carries. ACM EC and PNAS carry no INFORMS tail; the
// ABS shards live in sibling repos this check cannot see.
const DATA_FILES = ['ms', 'msom', 'opre', 'mksc', 'isre', 'stsc', 'ited'].map((k) => `data/papers-${k}.json`)
  .concat(['ms', 'msom', 'opre', 'mksc', 'isre', 'ijoc'].map((k) => `data-ft50/papers-${k}.json`));
for (const rel of DATA_FILES) {
  const file = path.join(LIT, rel);
  if (!existsSync(file)) { ok(false, `${rel} is present`); continue; }
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const byDoi = new Map(rows.map((r) => [bare(r.DOI), r]));
  for (const d of rel.endsWith('/papers-ms.json') ? OWNER_DOIS : []) {
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
    if (!/accepted (?:by|for)/i.test(raw) && !/^(?:History|Funding|Supplemental Material):/.test(raw)) continue;
    const shown = cleanAbstract(raw);
    if (REPORT_RE.test(shown)) leak++;
    else if (/accepted by/i.test(shown)) proseAcceptedBy++;
    if (raw && !shown) emptied++;
  }
  eq(leak, 0, `${rel}: no card shows an INFORMS acceptance sentence (${leak} would)`);
  if (proseAcceptedBy || emptied) console.log(`  note: ${rel} — ${proseAcceptedBy} abstracts still say "accepted by" in ordinary prose (left alone), ${emptied} were nothing but the acceptance sentence or a trailer and show no abstract`);
}

/* --------------------------------------------------------------- report */
if (fails.length) {
  console.error(`abstract-display-selftest: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`abstract-display-selftest: ${pass} checks passed`);
