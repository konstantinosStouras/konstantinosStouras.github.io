/*
 * build-titlecase-lexicon.mjs — regenerate _titlecase-lexicon.mjs from the corpus.
 * ===========================================================================
 * Some publishers deposit a title in ALL CAPITALS ("MARKET EQUILIBRIUM",
 * "A PENTAPLOID LARVA OF THE NEWT, TRITURUS VIRIDESCENS") — feedback ticket
 * LIT-260728-TVQ5. `sentenceCaseTitle` in _entities.mjs rewrites those into
 * sentence case, but lowercasing blindly would destroy the two kinds of word
 * that MUST keep their capitals:
 *
 *   • acronyms      DNA, RNA, CEO, CAPM, ANOVA, ARCH, EDI, GDP, IPO …
 *   • proper nouns  Bayesian, Cournot, Drosophila, Durbin, Triturus, Japan …
 *
 * An all-caps string carries no evidence of which is which, so the evidence has
 * to come from somewhere else: the ~715k titles and ~306k abstracts in the
 * catalog that ARE properly cased. This script mines them into the two maps
 * _titlecase-lexicon.mjs exports.
 *
 * The mining is deliberately narrow, because the naive version is wrong:
 *
 *   • Roughly HALF the catalog's titles are Title Case ("The Effect of X on Y" —
 *     AMJ, JoF, TAR …). Counting those, every ordinary noun looks capitalised
 *     ("Economics", "Leadership", "Return"), and the lexicon would simply
 *     re-capitalise every word. So PROPER-NOUN evidence is taken ONLY from
 *     titles classified `sentence` (≥70% of non-initial content words start
 *     lowercase) and from abstract prose, and ONLY at non-sentence-initial
 *     positions — a capital there is not explained by position or house style.
 *   • ACRONYM evidence is safe in either style (Title Case never yields "DNA"
 *     from "dna"), so an all-caps token inside a NOT-all-caps title/abstract
 *     counts wherever it appears.
 *   • PHRASES exist because multi-word names cannot be recovered word by word:
 *     "states", "york", "war" and "reserve" are all lowercase-dominant on their
 *     own, so "UNITED STATES" would come back "United states". A phrase is kept
 *     only when every one of its tokens is capitalised together, no token
 *     follows a sentence boundary (which would make "…analysis. Comment" look
 *     like a name) and no token is a stop word (killing "United States The").
 *
 * Every entry needs a minimum number of sightings AND a dominance ratio over
 * the competing lowercase form, so a one-off typo never becomes a rule. Tokens
 * whose dominant form is plain lowercase are OMITTED — lowercase is
 * sentenceCaseTitle's default, so storing them would only bloat the file.
 * Only tokens/phrases that actually OCCUR in an all-caps title are considered,
 * which is what keeps the output ~30 KB instead of many megabytes.
 *
 *   node lit/_scraper/build-titlecase-lexicon.mjs            # all datasets found
 *   node lit/_scraper/build-titlecase-lexicon.mjs --dry-run  # report, write nothing
 *   ... --dir <papers-dir>   # repeatable; overrides the default dataset list
 *   ... --out <file>         # default lit/_scraper/_titlecase-lexicon.mjs
 *
 * Re-run it when the catalog has grown a lot; the output is deterministic
 * (sorted keys), so an unchanged corpus rewrites an identical file. Remember to
 * re-vendor the result into the three shard repos, exactly like _entities.mjs.
 * ===========================================================================
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const argAll = (name) => argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);
const OUT = resolve(argAll('--out')[0] || join(__dirname, '_titlecase-lexicon.mjs'));

// Same dataset set the analytics build covers: the natives, the FT50 catalog,
// the working-papers archive and the three ABS shards as sibling checkouts.
const SITE = resolve(__dirname, '..', '..');
const DEFAULT_DIRS = [
  join(SITE, 'lit', 'data'),
  join(SITE, 'lit', 'data-ft50'),
  join(SITE, 'lit', 'data-workingpapers'),
  join(SITE, '..', 'lit-data-abs4', 'data'),
  join(SITE, '..', 'lit-data-abs3-omecon', 'data'),
  join(SITE, '..', 'lit-data-abs3-rest', 'data'),
];
const DIRS = (argAll('--dir').length ? argAll('--dir').map((d) => resolve(d)) : DEFAULT_DIRS)
  .filter((d) => existsSync(d));

// ── thresholds ──────────────────────────────────────────────────────────────
const MIN_ACRONYM = 2;        // sightings as an all-caps token
const RATIO_ACRONYM = 0.5;    // ... as a share of all sightings of the token
const MIN_PROPER = 2;         // sightings capitalised mid-sentence
const RATIO_PROPER = 0.7;     // ... vs the same token lowercase mid-sentence
const MIN_PHRASE = 4;         // sightings of the whole phrase capitalised
const RATIO_PHRASE = 0.85;    // ... vs the same phrase all-lowercase
const MIN_ABSTRACT = 80;      // ignore stub abstracts, they are mostly furniture

// Stop words can be capitalised for a hundred reasons that are not "this is a
// name", so a phrase containing one is never trusted.
const STOP = new Set(('the of in and for a an to on at by as or is its it this that are was were be been has have'
  + ' with from since their our we which when while after before during under over into out up down not no all any'
  + ' some more most other such than then also but if so can may will new two one').split(' '));

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
const isUpper = (c) => /\p{Lu}/u.test(c);
const isLower = (c) => /\p{Ll}/u.test(c);
const allUpper = (w) => /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w);

// The same shape sentenceCaseTitle uses to decide it is looking at an all-caps
// string. Kept in sync with isAllCapsTitle's first two tests in _entities.mjs.
function looksAllCaps(s) {
  return !/\p{Ll}/u.test(s) && (s.match(/\p{Lu}/gu) || []).length >= 8;
}

// Tokens plus, for each, whether it opens a sentence (start of string, or right
// after . : ? ! ; and any opening quote/bracket). A capital there is explained
// by position, so it is never evidence of a name.
function tokenize(text) {
  const out = [];
  let last = 0, initial = true;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (last !== 0 && /[.:?!;]\s*["“'‘([]?\s*$/.test(text.slice(last, m.index))) initial = true;
    out.push({ w: m[0], initial });
    initial = false;
    last = m.index + m[0].length;
  }
  return out;
}

function* rows() {
  for (const dir of DIRS) {
    for (const f of readdirSync(dir).filter((x) => /^papers-.*\.json$/.test(x)).sort()) {
      let parsed;
      try { parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      if (Array.isArray(parsed)) for (const r of parsed) yield r;
    }
  }
}

if (!DIRS.length) {
  console.error('build-titlecase-lexicon: no dataset directories found');
  process.exit(1);
}
console.log('scanning:');
for (const d of DIRS) console.log('  ' + d);

// ── pass 1: what do we actually need? ───────────────────────────────────────
// Only words and 2-3 word runs that occur in an ALL-CAPS title can ever be
// looked up, so everything else is dropped before any counting happens.
const needWord = new Set();
const needPhrase = new Set();
let capsTitles = 0;
for (const r of rows()) {
  const t = r && r.Title;
  if (typeof t !== 'string' || !looksAllCaps(t)) continue;
  capsTitles++;
  const ws = (t.match(TOKEN_RE) || []).map((w) => w.toLowerCase());
  for (let i = 0; i < ws.length; i++) {
    needWord.add(ws[i]);
    if (i < ws.length - 1) needPhrase.add(ws[i] + ' ' + ws[i + 1]);
    if (i < ws.length - 2) needPhrase.add(ws[i] + ' ' + ws[i + 1] + ' ' + ws[i + 2]);
  }
}
console.log(`\nall-caps titles: ${capsTitles}; candidate words: ${needWord.size}; candidate phrases: ${needPhrase.size}`);

// ── pass 2: mine the properly-cased text ────────────────────────────────────
const seen = new Map();      // token -> sightings anywhere
const asAcronym = new Map(); // token -> sightings as an all-caps token
const asCap = new Map();     // token -> sightings capitalised mid-sentence
const asLow = new Map();     // token -> sightings lowercase mid-sentence
const capForms = new Map();  // token -> surface form -> count
const phraseCap = new Map(), phraseLow = new Map(), phraseForms = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const bumpForm = (m, k, form) => {
  let f = m.get(k);
  if (!f) { f = new Map(); m.set(k, f); }
  f.set(form, (f.get(form) || 0) + 1);
};

function harvest(text, isTitle) {
  const ts = tokenize(text);
  // Classify a TITLE's house style; abstracts are prose and always qualify.
  let sentenceCase = true;
  if (isTitle) {
    const content = ts.filter((x, i) => i > 0 && !x.initial && x.w.length >= 4 && /\p{L}/u.test(x.w[0]));
    sentenceCase = content.length >= 3
      && content.filter((x) => isLower(x.w[0])).length / content.length >= 0.7;
  }
  for (const { w, initial } of ts) {
    const k = w.toLowerCase();
    if (!needWord.has(k)) continue;
    bump(seen, k);
    // Acronym evidence: valid in any house style.
    if (allUpper(w) && w.length >= 2) { bump(asAcronym, k); continue; }
    // Proper-noun evidence: sentence-case sources, mid-sentence only.
    if (!sentenceCase || initial) continue;
    if (isUpper(w[0])) { bump(asCap, k); bumpForm(capForms, k, w); }
    else if (isLower(w[0])) bump(asLow, k);
  }
  if (!sentenceCase) return;
  for (let i = 0; i < ts.length - 1; i++) {
    for (const n of [2, 3]) {
      if (i + n > ts.length) continue;
      const seg = ts.slice(i, i + n);
      if (seg.some((s) => s.initial)) continue;      // a clause join, not a name
      const key = seg.map((s) => s.w.toLowerCase()).join(' ');
      if (!needPhrase.has(key)) continue;
      if (seg.every((s) => isUpper(s.w[0]) && !allUpper(s.w))) {
        bump(phraseCap, key);
        bumpForm(phraseForms, key, seg.map((s) => s.w).join(' '));
      } else if (seg.every((s) => isLower(s.w[0]))) bump(phraseLow, key);
    }
  }
}

let nTitles = 0, nAbstracts = 0;
for (const r of rows()) {
  if (!r) continue;
  const t = r.Title;
  if (typeof t === 'string' && t && !looksAllCaps(t)) { harvest(t, true); nTitles++; }
  const a = r.Abstract;
  if (typeof a === 'string' && a.length >= MIN_ABSTRACT && !looksAllCaps(a)) { harvest(a, false); nAbstracts++; }
}
console.log(`mined ${nTitles} titles + ${nAbstracts} abstracts`);

// ── decide ──────────────────────────────────────────────────────────────────
const dominantForm = (m, k) => {
  let best = null, bestN = 0;
  for (const [form, n] of (m.get(k) || new Map())) if (n > bestN) { bestN = n; best = form; }
  return best;
};

const words = {};
let nAcro = 0, nProper = 0;
for (const k of needWord) {
  const total = seen.get(k) || 0;
  const acro = asAcronym.get(k) || 0;
  if (acro >= MIN_ACRONYM && total && acro / total >= RATIO_ACRONYM) {
    words[k] = k.toUpperCase();
    nAcro++;
    continue;
  }
  const cap = asCap.get(k) || 0, low = asLow.get(k) || 0;
  if (cap >= MIN_PROPER && cap / (cap + low) >= RATIO_PROPER) {
    const form = dominantForm(capForms, k);
    if (form && form !== k) { words[k] = form; nProper++; }
  }
}

const phrases = {};
for (const [key, cap] of phraseCap) {
  const low = phraseLow.get(key) || 0;
  if (cap < MIN_PHRASE || cap / (cap + low) < RATIO_PHRASE) continue;
  const parts = key.split(' ');
  if (parts.some((p) => STOP.has(p))) continue;
  // Redundant when every token already resolves the same way on its own.
  if (parts.every((p) => words[p] && words[p] !== p)) continue;
  const form = dominantForm(phraseForms, key);
  if (!form || form.split(' ').length !== parts.length) continue;
  phrases[key] = form;
}

console.log(`\nwords:   ${nAcro} acronyms + ${nProper} proper nouns = ${Object.keys(words).length}`);
console.log(`phrases: ${Object.keys(phrases).length}`);

// ── emit ────────────────────────────────────────────────────────────────────
const entries = (obj) => Object.keys(obj).sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(obj[k])},`).join('\n');

const src = `/*
 * _titlecase-lexicon.mjs — GENERATED, do not edit by hand.
 * ===========================================================================
 * Regenerate with:  node lit/_scraper/build-titlecase-lexicon.mjs
 * (then re-vendor into the three lit-data-abs* shard repos, like _entities.mjs)
 *
 * The words and multi-word names that must KEEP their capitals when
 * sentenceCaseTitle rewrites an ALL-CAPS deposited title into sentence case —
 * acronyms (DNA, CAPM, ANOVA) and proper nouns (Bayesian, Cournot, Drosophila).
 * Mined from the ${nTitles} properly-cased titles and ${nAbstracts} abstracts in the
 * catalog; see build-titlecase-lexicon.mjs for how the evidence is filtered.
 * Anything NOT listed here is lowercased, which is the sentence-case default.
 * ===========================================================================
 */

// lowercase word -> the form to restore.
export const TITLECASE_WORDS = {
${entries(words)}
};

// lowercase multi-word run -> the form to restore. Needed because the parts are
// lowercase-dominant on their own ("states", "york", "war"), so word-by-word
// restoration would give "United states".
export const TITLECASE_PHRASES = {
${entries(phrases)}
};
`;

if (DRY) {
  console.log(`\n[dry-run] would write ${OUT} (${(src.length / 1024).toFixed(0)} KB)`);
} else {
  writeFileSync(OUT, src, 'utf8');
  console.log(`\nwrote ${OUT} (${(src.length / 1024).toFixed(0)} KB)`);
}
