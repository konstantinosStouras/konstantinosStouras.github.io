/* ==========================================================================
   Answer Arena — analytics template guard (offline, no deps, no network)
       node lab/answerarena/tools/templates-guard.mjs

   The Data-analytics tab ships TWO bundled scripts that must compute and print
   the SAME thing in two languages (DA_PY_TEMPLATE / DA_R_TEMPLATE in admin.js).
   Both answer ONE question — for which task ids can we say, at each confidence
   level, that Haiku is preferred and for which Opus — and the drift that would
   make them answer it differently is invisible until somebody runs both and
   compares, so it is checked here instead:

     1. SECTION NUMBERING — the printed sections must be 1..N in the same order
        in both. (The prose cross-references section numbers.)
     2. FIGURE GUIDES — the "Insights gained" panel drops the Nth harvested image
        under the heading "## Figure N", so the headings must be contiguous 1..N
        and identical in both languages, or a plot lands under the wrong text.
     3. THE CONFIDENCE LEVELS — every printed label is DERIVED from the LEVELS
        list, so no percentage may be spelled out in either script: a hard-coded
        "95%" is exactly the drift that survives a change to LEVELS.
     4. THE DECISION RULE — which of the two exact tests is the HEADLINE, and
        which direction each verdict is read from. The two tests share one
        engine (signflip_p), and the argument that picks the headline is a fact
        about the app: tapping an answer card seeds the strength bar at +/-2, so
        a magnitude can be the interface's while the side chosen is always the
        student's. Swapping them silently would change every published list.
     5. NO SECOND SET OF LISTS — the multiplicity adjustment is a COLUMN, never
        a filter on the headline lists, because the question asked is per task.

   Numerical agreement itself is verified by running both templates against the
   same synthetic exports (Python via Pyodide/CPython, R via WebR/Rscript) —
   that needs runtimes this repo does not carry, so it stays a manual step. The
   engine is small enough to check by brute force when it changes: enumerate all
   2^m sign patterns and compare with signflip_p.
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
const BOTH = [['Python', py], ['R', r]];

/* ---- 1. the printed sections, and how they are numbered ----------------- */
// The section numbers are DERIVED (one section per confidence level, then the
// full table), so there is no literal to drift — but the titles and their order
// still must match, and the numbering must still come from the same place.
const TITLES = ['AT %s CONFIDENCE', 'is preferred - %d of %d tasks, at %s confidence',
  'Not established either way at %s', 'EVERY TASK, BOTH LEVELS'];
for (const [lang, t] of BOTH) {
  const at = TITLES.map((s) => t.indexOf(s));
  ok(at.every((i) => i >= 0), lang + ' prints every section title'
    + (at.some((i) => i < 0) ? ' (missing: ' + TITLES.filter((_, i) => at[i] < 0).join(' | ') + ')' : ''));
  ok(at.every((v, i) => !i || v > at[i - 1]), lang + ' prints them in order: '
    + 'per level (Haiku, Opus, not established), then the full table');
  // One section per confidence level, numbered from the loop index, and the
  // last one numbered one past them — so adding a level renumbers everything.
  ok(/%d\. AT %s CONFIDENCE/.test(t), lang + ' numbers each level section from the loop index');
  ok(/length\(LEVELS\) \+ 1|len\(LEVELS\) \+ 1/.test(t),
    lang + ' derives its final section number from the number of confidence levels');
}

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
for (const [lang, t, n] of [['Python', py, fPy.length], ['R', r, fR.length]]) {
  const refs = [...t.matchAll(/Figure[s]? (\d+)/g)].map((m) => Number(m[1]));
  ok(refs.every((k) => k >= 1 && k <= n), 'no ' + lang + ' guide references a figure outside 1..' + n);
}
// Exactly one figure is drawn, and both languages draw it, or the Insights
// panel would append an unexplained image (or explain one that is not there).
ok(/plt\.subplots\(/.test(py) && (py.match(/plt\.subplots\(/g) || []).length === 1,
  'Python opens exactly one figure');
ok((r.match(/^\s*plot\(NA,/gm) || []).length === 2 && /par\(mfrow = c\(1, 2\)\)|mfrow = c\(1, 2\)/.test(r),
  'R draws its two panels inside one figure (mfrow), matching Python\'s one figure');

/* ---- 3. the confidence levels agree, and no label is spelled out --------- */
const constOf = (t, name, sep) => {
  const m = t.match(new RegExp('^\\s*' + name + '\\s*' + sep + '\\s*([^#\\n]+)', 'm'));
  return m ? m[1].trim() : null;
};
const lvPy = constOf(py, 'LEVELS', '='), lvR = constOf(r, 'LEVELS', '<-');
ok(lvPy === '[0.95, 0.99]', 'Python asks for 95% and 99% (LEVELS = ' + lvPy + ')');
ok(lvR === 'c(0.95, 0.99)', 'R asks for the same two levels (LEVELS <- ' + lvR + ')');
ok(lvPy && lvR && lvPy.replace(/[[\]]/g, '') === lvR.replace(/^c\(|\)$/g, ''),
  'both templates carry the same confidence levels');
for (const [lang, t] of BOTH) {
  // The percentages appear only inside PROSE the reader sees (the header block
  // explaining the design) — never as a printed label, which must come from
  // pct(). A label spelling out "95%" survives a change to LEVELS and then lies.
  const printed = t.split('\n').filter((l) => /^\s*(print|cat|note)\(/.test(l) && /\d\d%/.test(l)
    && !/pct\(/.test(l));
  ok(printed.length === 0, lang + ' prints no hard-coded confidence percentage'
    + (printed.length ? ' (first: ' + printed[0].trim().slice(0, 70) + ')' : ''));
  ok((t.match(/pct\(/g) || []).length >= 20, lang + ' builds its labels from pct() ('
    + (t.match(/pct\(/g) || []).length + ' uses)');
}

/* ---- 4. the decision rule: which test leads, and from which direction ---- */
for (const [lang, t] of BOTH) {
  // ONE engine, called twice: once counting sides, once weighted by strength.
  const calls = (t.match(/signflip_p\((?!values)/g) || []).length;
  ok(calls >= 2, lang + ' computes both readings with one engine (' + calls + ' calls)');
  // The HEADLINE is the sign test — the votes_only call — and its verdict takes
  // its direction from the VOTE MARGIN. Reading the direction from the score
  // total instead is a real bug: a task can have more Opus votes while a couple
  // of emphatic Haiku answers pull the score total the other way.
  ok(/votes_only\s*=\s*(True|TRUE)[^\n]*THE HEADLINE/.test(t),
    lang + ': the headline is the sign test (votes_only), not the strength-weighted one');
  // Read off the assignment lines themselves rather than by pattern-matching
  // across them: each verdict column is written on one line, and which value it
  // takes its DIRECTION from is the whole of what is being pinned.
  const assign = (col) => t.split('\n').filter((l) => l.includes('verdict_of(')
    && new RegExp('["\'(]' + col).test(l.split('verdict_of(')[0]));
  const dirOf = (col) => assign(col).map((l) => l.split('verdict_of(')[1].split(',')[1].trim());
  ok(assign('at').length === 1 && /margin/.test(dirOf('at')[0]),
    lang + ': the headline verdict reads its direction from the vote margin (' + dirOf('at') + ')');
  ok(assign('str').length === 1 && /total/.test(dirOf('str')[0]),
    lang + ': the strength verdict reads its direction from the score total (' + dirOf('str') + ')');
  ok(assign('fdr').length === 1 && /margin/.test(dirOf('fdr')[0]),
    lang + ': the adjusted verdict follows the headline direction (' + dirOf('fdr') + ')');
  // Why the sign leads is a fact about the app (pick() seeds the bar at +/-2),
  // and it must stay written down beside the choice it justifies.
  ok(/preference_source/.test(t) && /\+\/-2/.test(t),
    lang + ' records why the direction leads (the card seeds the strength bar at +/-2)');
  // The floor below which no split can reach a level is derived, not asserted.
  ok(/min_responses_for/.test(t), lang + ' derives the responses a level needs from the level itself');
}

/* ---- 5. the multiplicity adjustment is a column, never a filter ---------- */
for (const [lang, t] of BOTH) {
  ok(/\bbh\(/.test(t) && /Benjamini-Hochberg/.test(t), lang + ' reports a Benjamini-Hochberg adjusted value');
  // The lists are built from the per-task verdict (at<level>) alone. A list
  // built from the fdr column would answer a different question from the one
  // the owner asked, and would do it without saying so.
  ok(/\[\[at\]\] == key|\[at\] == key/.test(t), lang + ' builds its lists from the per-task verdict');
  ok(!/\[\[fd\]\] == key|\[fd\] == key/.test(t), lang + ' never builds a list from the adjusted column');
  // Both directions of the answer, and the honest complement, are printed.
  for (const s of ['HAIKU (the small, cheap model)', 'OPUS (the large, expensive model)',
    'Not established either way'])
    ok(t.includes(s), lang + ' prints the "' + s.split('(')[0].trim() + '" block');
  ok(/NOT tasks where the two models are equal/.test(t),
    lang + ' says outright that an unlisted task is not an equal task');
}

/* ---- 6. the two languages share their prose, word for word -------------- */
// The header block is the design argument; if one language's copy drifts, the
// two scripts document different studies. R carries it as '# ' comments.
const headPy = py.split('\n').slice(1, py.split('\n').indexOf('================================================================================', 1) + 1);
const headR = r.split('\n').filter((l) => l.startsWith('#')).map((l) => l.replace(/^# ?/, ''));
const key = (a) => a.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
ok(key(headR).includes(key(headPy).slice(0, 400)),
  'the R header carries the same design argument as the Python docstring');

console.log(fails
  ? `\nARENA TEMPLATES GUARD FAILED (${fails})`
  : '\nARENA TEMPLATES GUARD OK — one question, one decision rule, the same sections, figures and confidence levels in Python and R');
process.exit(fails ? 1 : 0);
