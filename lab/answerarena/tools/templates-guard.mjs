/* ==========================================================================
   Answer Arena — analytics template guard (offline, no deps, no network)
       node lab/answerarena/tools/templates-guard.mjs

   The Data-analytics tab ships TWO bundled scripts that must compute and print
   the SAME thing in two languages (DA_PY_TEMPLATE / DA_R_TEMPLATE in admin.js).
   Three kinds of drift are easy to introduce and invisible until someone runs
   both and compares, so they are checked here instead:

     1. SECTION NUMBERING — the printed sections must be 1..N in the same order
        in both. (Renumbering after inserting a section is exactly where a stale
        "1." survives: the Insights text cross-references section numbers.)
     2. FIGURE GUIDES — the "Insights gained" panel drops the Nth harvested image
        under the heading "## Figure N", so the headings must be contiguous 1..N
        and identical in both languages, or a plot lands under the wrong text.
     3. SHARED CONSTANTS — the confidence rules (CONF_LEVEL / ALPHA /
        EQUIV_MARGIN for section 1, CONF95 for section 8) decide every verdict;
        if the two copies drift, Python and R answer the same question
        differently.

   Numerical agreement itself is verified by running both templates against the
   same synthetic export (Python via Pyodide/CPython, R via WebR/Rscript) — that
   needs runtimes this repo does not carry, so it stays a manual step.
   ========================================================================== */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(resolve(HERE, '..', 'admin.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

/* Pull one `var NAME = [ ... ].join('\n')` template out of admin.js and rebuild
   the script text exactly as the page hands it to Pyodide / WebR. */
function template(name) {
  const start = src.indexOf('var ' + name + ' = [');
  if (start < 0) throw new Error('template not found: ' + name);
  const open = src.indexOf('[', start);
  const end = src.indexOf("\n  ].join('\\n');", open);
  if (end < 0) throw new Error('template end not found: ' + name);
  // The literal is a plain array of string literals — evaluating it is the only
  // way to get the real text (the lines carry escapes the page relies on).
  return Function('return (' + src.slice(open, end + 4) + ')')().join('\n');
}
const py = template('DA_PY_TEMPLATE');
const r = template('DA_R_TEMPLATE');

/* ---- 1. printed section headings, 1..N, same order in both --------------- */
const sections = (t) => [...t.matchAll(/^\s*(?:print|cat)\(.*?["\\n]{1,3}(\d)\.\s+([A-Z][^"\\]*)/gm)]
  .map((m) => m[1] + '. ' + m[2].trim().replace(/\s+/g, ' '))
  .filter((s, i, a) => a.indexOf(s) === i);
const secPy = sections(py), secR = sections(r);
const nums = (a) => a.map((s) => Number(s[0]));
ok(secPy.length >= 7, 'Python prints ' + secPy.length + ' numbered sections');
ok(nums(secPy).join(',') === nums(secPy).slice().sort((a, b) => a - b).join(','),
  'Python section numbers are in ascending order: ' + nums(secPy).join(', '));
ok(nums(secR).join(',') === nums(secR).slice().sort((a, b) => a - b).join(','),
  'R section numbers are in ascending order: ' + nums(secR).join(', '));
ok(nums(secPy).join(',') === nums(secR).join(','),
  'both templates print the same section numbers');
const gapPy = nums(secPy).filter((n, i, a) => i && n !== a[i - 1] && n !== a[i - 1] + 1);
ok(gapPy.length === 0, 'Python section numbers have no gaps' + (gapPy.length ? ' (jumps to ' + gapPy.join(', ') + ')' : ''));

/* ---- 2. figure guides: contiguous 1..N and identical in both ------------- */
const figs = (t) => [...t.matchAll(/## Figure (\d+) - ([^"\\]*)/g)].map((m) => [Number(m[1]), m[2].trim()]);
const fPy = figs(py), fR = figs(r);
ok(fPy.length > 0 && fPy.length === fR.length, 'both templates document the same number of figures (' + fPy.length + ')');
ok(fPy.map((f) => f[0]).join(',') === fPy.map((_, i) => i + 1).join(','),
  'Python figure guides are numbered 1..' + fPy.length + ' with no gap or repeat');
ok(fR.map((f) => f[0]).join(',') === fR.map((_, i) => i + 1).join(','),
  'R figure guides are numbered 1..' + fR.length + ' with no gap or repeat');
const titleMismatch = fPy.filter((f, i) => !fR[i] || fR[i][1] !== f[1]);
ok(titleMismatch.length === 0, 'every figure guide has the same title in both languages'
  + (titleMismatch.length ? ' (differs at Figure ' + titleMismatch.map((f) => f[0]).join(', ') + ')' : ''));
// A guide that points at a figure number nobody produces would render nothing.
const refPy = [...py.matchAll(/Figure[s]? (\d+)/g)].map((m) => Number(m[1]));
ok(refPy.every((n) => n >= 1 && n <= fPy.length),
  'no Python guide references a figure outside 1..' + fPy.length);
const refR = [...r.matchAll(/Figure[s]? (\d+)/g)].map((m) => Number(m[1]));
ok(refR.every((n) => n >= 1 && n <= fR.length),
  'no R guide references a figure outside 1..' + fR.length);

/* ---- 3. the 99%-confidence constants agree ------------------------------- */
// The whole right-hand side, up to the trailing comment (ALPHA is an expression).
const constOf = (t, name, sep) => {
  const m = t.match(new RegExp('^\\s*' + name + '\\s*' + sep + '\\s*([^#\\n]+)', 'm'));
  return m ? m[1].trim() : null;
};
for (const name of ['CONF_LEVEL', 'ALPHA', 'EQUIV_MARGIN']) {
  const a = constOf(py, name, '='), b = constOf(r, name, '<-');
  ok(a != null && a === b, name + ' matches in both templates (' + a + ' vs ' + b + ')');
}

/* ---- 4. printed confidence labels are DERIVED, never spelled out --------- */
// Sections 1 and 8 build every "95%" from CONF_PCT/ALPHA_PCT, so the prose can
// never claim a confidence the tests did not use. A hard-coded percentage there
// is exactly the drift that survives a change of CONF_LEVEL.
for (const [lang, t] of [['Python', py], ['R', r]]) {
  ok(!/\b99%/.test(t), lang + ' carries no stale 99% label');
  ok((t.match(/CONF_PCT/g) || []).length >= 8,
    lang + ' builds its confidence labels from CONF_PCT (' + (t.match(/CONF_PCT/g) || []).length + ' uses)');
}

/* ---- 5. the verdict buckets exist, in the order the owner asked for ------- */
for (const [lang, t] of [['Python', py], ['R', r]]) {
  const order = ['1a. HAIKU', '1b. OPUS', '1c. USERS ARE INDIFFERENT', '1d. NOT DECIDED YET',
    '1e. BY TASK TYPE', '1f. BY DOMAIN'];
  const at = order.map((s) => t.indexOf(s));
  ok(at.every((i) => i >= 0) && at.every((v, i) => !i || v > at[i - 1]),
    lang + ' section 1: Haiku -> Opus -> indifferent -> undecided -> task type -> domain, in that order');
  // Section 8 is the same three claims at 95%, and must NOT grow a fourth
  // "undecided" bucket — those tasks are deliberately unlisted.
  const s8 = ['8a. GROUND TRUTH = PEOPLE PREFER HAIKU', '8b. GROUND TRUTH = PEOPLE PREFER OPUS',
    '8c. GROUND TRUTH = PEOPLE ARE INDIFFERENT'];
  const at8 = s8.map((s) => t.indexOf(s));
  ok(at8.every((i) => i >= 0) && at8.every((v, i) => !i || v > at8[i - 1]),
    lang + ' section 8: the three 95%-confident sets print Haiku -> Opus -> indifferent');
  ok(t.indexOf('8d.') === -1, lang + ' section 8 lists no fourth bucket (unclassified tasks stay unlisted)');
}

console.log(fails
  ? `\nARENA TEMPLATES GUARD FAILED (${fails})`
  : '\nARENA TEMPLATES GUARD OK — sections, figure guides and confidence constants agree across Python and R');
process.exit(fails ? 1 : 0);
