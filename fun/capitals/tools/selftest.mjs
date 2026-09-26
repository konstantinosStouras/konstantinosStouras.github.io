/* ==========================================================================
   Capitals — offline selftest (node, no network, no browser)
       node fun/capitals/tools/selftest.mjs

   The one thing this quiz must get right is the verdict on a typed answer.
   The owner's report (2026-09-26): "for some countries I was entering a wrong
   answer and it was considering it correct" — e.g. Bolivia. Three causes were
   found, and each is pinned here so it cannot come back:

     1. DATA. The `alt` lists carried the COUNTRY's own name or alias as an
        accepted capital ("Czech Republic", "USA", "Ivory Coast", "Swaziland",
        "ΗΠΑ", "Κάτω Χώρες" …) and a few cities that are not the capital in
        any legal sense (Tel Aviv, Monte Carlo, Lagos, Yangon/Rangoon,
        Dar es Salaam). An accepted alternative must be a CAPITAL — a current
        official capital in some legal role (constitutional, legislative,
        executive, judicial, seat of government, old royal capital kept by
        law), a former NAME of that same city, an endonym or transliteration.
     2. CODE. acceptedForms() returned a plain object and checkAnswer tested
        forms[norm(raw)], so "constructor" (Object.prototype.constructor) was
        a correct answer for every country. It is a null-prototype map now,
        judged by matchAnswer(), which this file extracts from index.html and
        runs — the same function, not a copy.
     3. FEEDBACK. When the accepted answer was an alternative (La Paz for
        Bolivia), the banner announced "Sucre is the capital of Bolivia" and
        never acknowledged the typed answer, which reads exactly like a wrong
        answer marked correct. The page now adds "Your answer La Paz is also
        accepted." (renderAltNote / isAltForm), and the wiring is pinned below.

   Also caught while here: the Greek capital of Gabon was misspelt
   ("Λιμπρβίλ"), so the correct Greek answer was REJECTED.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = {};
require(resolve(DIR, 'countries.js'));
require(resolve(DIR, 'countries.el.js'));
const html = readFileSync(resolve(DIR, 'index.html'), 'utf8');

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL — ' + m); } };
const section = (t) => console.log('\n' + t);

// ---- the matcher, extracted from the page (never a copy) ----
const START = '    function foldGreek(s) {';
const END = '    // ---------- language-aware display helpers ----------';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.log('FAIL — could not slice the matcher out of index.html'); process.exit(1); }
const src = html.slice(a, b);
ok(src.length > 500 && src.length < 30000, 'matcher slice is a plausible size (' + src.length + ' chars)');
const M = new Function(src + '\nreturn { foldGreek: foldGreek, norm: norm, acceptedForms: acceptedForms, matchAnswer: matchAnswer, isAltForm: isAltForm, editDistance: editDistance, typoAllowance: typoAllowance, DECOY_CITIES: DECOY_CITIES };')();
const { norm, isAltForm, acceptedForms, editDistance, typoAllowance, DECOY_CITIES } = M;

// ---- the data, merged exactly as the page merges it ----
const ALL = window.COUNTRIES.slice();
const EL = window.COUNTRIES_EL;
ALL.forEach((e) => {
  const g = EL[e.c];
  e.c_el = (g && g.c) || e.c;
  e.cap_el = (g && g.cap) || e.cap;
  e.alt_el = (g && g.alt) || [];
  e.facts_el = (g && g.facts) || e.facts;
});
const byName = Object.fromEntries(ALL.map((e) => [e.c, e]));
// matchAnswer(entry, raw, ALL) is what the page calls; `match` is the accepted form (exact OR a tolerated slip), `exact` only an exact one.
const verdict = (e, raw) => M.matchAnswer(e, raw, ALL);
const matchAnswer = (e, raw) => { const v = verdict(e, raw); return v ? v.form : null; };
const exactMatch = (e, raw) => { const v = verdict(e, raw); return v && v.exact ? v.form : null; };
const REGIONS = new Set(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania']);

section('1. Dataset shape (both languages)');
ok(ALL.length === 197, '197 countries (' + ALL.length + ')');
ok(new Set(ALL.map((e) => e.c)).size === ALL.length, 'no duplicate country name');
ok(Object.keys(EL).length === ALL.length && Object.keys(EL).every((k) => byName[k]), 'Greek layer keys are exactly the English names');
for (const e of ALL) {
  ok(typeof e.c === 'string' && e.c.trim() && typeof e.cap === 'string' && e.cap.trim(), e.c + ': c/cap are non-empty strings');
  ok(REGIONS.has(e.region), e.c + ': known region (' + e.region + ')');
  ok(/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(e.flag), e.c + ': flag is two regional indicators');
  ok(Array.isArray(e.alt) && e.alt.every((x) => typeof x === 'string' && x.trim()), e.c + ': alt is an array of non-empty strings');
  ok(Array.isArray(e.facts) && e.facts.length === 2 && e.facts.every((x) => typeof x === 'string' && x.trim().length > 20), e.c + ': exactly two English facts');
  const g = EL[e.c];
  ok(g && typeof g.c === 'string' && g.c.trim() && typeof g.cap === 'string' && g.cap.trim(), e.c + ': Greek c/cap are non-empty');
  ok(g && Array.isArray(g.alt) && g.alt.every((x) => typeof x === 'string' && x.trim()), e.c + ': Greek alt is an array of non-empty strings');
  ok(g && Array.isArray(g.facts) && g.facts.length === 2 && g.facts.every((x) => typeof x === 'string' && x.trim().length > 20), e.c + ': exactly two Greek facts');
  ok(/[Ͱ-Ͽ]/.test(g.cap) && /[Ͱ-Ͽ]/.test(g.c), e.c + ': Greek cap and country name are in Greek script');
}

section('2. Every accepted form survives normalisation and is accepted back');
const forms = (e) => [e.cap].concat(e.alt, [e.cap_el], e.alt_el);
const letters = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
for (const e of ALL) {
  for (const f of forms(e)) {
    const k = norm(f);
    ok(k.length > 0, e.c + ': norm("' + f + '") is not empty');
    ok(!/[^a-z0-9α-ω ]/.test(k), e.c + ': norm("' + f + '") holds only Latin/Greek letters, digits, spaces');
    if (!/[Ͱ-Ͽ]/.test(f)) {
      // Latin script: no letter may be lost (ø, ł, đ, ð, ß would be — none is in the data; keep it so).
      const expect = letters(f.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\bsaint\b/g, 'st'));
      ok(letters(k) === expect, e.c + ': norm("' + f + '") keeps every letter (' + letters(k) + ' of ' + expect + ')');
    }
    ok(exactMatch(e, f) !== null, e.c + ': "' + f + '" is accepted as an exact spelling');
    ok(matchAnswer(e, '  ' + f.toUpperCase() + '  ') !== null, e.c + ': "' + f + '" is accepted upper-cased with stray spaces');
    ok(matchAnswer(e, f.normalize('NFD').replace(/[̀-ͯ]/g, '')) !== null, e.c + ': "' + f + '" is accepted without accents');
  }
  ok(exactMatch(e, e.cap) === e.cap, e.c + ': the capital matches as itself');
  ok(!isAltForm(e, e.cap) && !isAltForm(e, e.cap_el), e.c + ': neither language\'s capital is an "alternative"');
  for (const alt of e.alt.concat(e.alt_el)) {
    if (norm(alt) !== norm(e.cap) && norm(alt) !== norm(e.cap_el)) ok(isAltForm(e, alt), e.c + ': "' + alt + '" is reported as an alternative answer');
  }
}

section('3. A country name is never its own capital');
// City-states whose capital carries the country's name — the ONLY entries where the bare name is right.
const SAME_NAME = new Set(['Luxembourg', 'Monaco', 'Singapore', 'San Marino', 'Djibouti', 'Vatican City']);
// Country aliases that were once listed as capitals (both languages), plus a few more nobody may add.
const COUNTRY_ALIASES = ['USA', 'US', 'United States of America', 'UK', 'Britain', 'Great Britain', 'England', 'Czech Republic', 'Ivory Coast',
  'Swaziland', 'DRC', 'DR Congo', 'Congo', 'East Timor', 'Turkiye', 'Türkiye', 'Cape Verde', 'Macedonia', 'Republic of the Congo',
  'Democratic Republic of the Congo', 'Federated States of Micronesia', 'UAE', 'Emirates', 'Holland', 'Burma', 'Persia', 'Siam',
  'ΗΠΑ', 'Κάτω Χώρες', 'Βρετανία', 'Μεγάλη Βρετανία', 'Αγγλία', 'Σουαζιλάνδη', 'Κάμπο Βέρντε', 'ΛΔ Κονγκό', 'Τιμόρ-Λέστε', 'Βιρμανία'];
for (const e of ALL) {
  if (!SAME_NAME.has(e.c)) {
    ok(matchAnswer(e, e.c) === null, e.c + ': the English country name is rejected');
    ok(matchAnswer(e, e.c_el) === null, e.c + ': the Greek country name "' + e.c_el + '" is rejected');
  } else {
    ok(matchAnswer(e, e.c) !== null, e.c + ': city-state — its name IS the capital');
  }
  for (const alias of COUNTRY_ALIASES) ok(matchAnswer(e, alias) === null, e.c + ': country alias "' + alias + '" is rejected');
  // No alt may equal ANY country's name in either language (a stray alias for a different country would be just as wrong).
  for (const alt of e.alt.concat(e.alt_el)) {
    const hit = ALL.find((o) => !SAME_NAME.has(o.c) && (norm(o.c) === norm(alt) || norm(o.c_el) === norm(alt)));
    ok(!hit, e.c + ': alt "' + alt + '" is not a country name' + (hit ? ' (it is ' + hit.c + ')' : ''));
  }
}

section('4. Cities that are not a capital stay rejected');
const NOT_CAPITALS = [['Israel', ['Tel Aviv', 'Τελ Αβίβ', 'Haifa']], ['Monaco', ['Monte Carlo', 'Μόντε Κάρλο']], ['Nigeria', ['Lagos', 'Λάγος']],
  ['Myanmar', ['Yangon', 'Rangoon', 'Γιανγκόν', 'Ρανγκούν']], ['Tanzania', ['Dar es Salaam', 'Νταρ ες Σαλάμ']], ['Kuwait', ['Kuwait', 'Κουβέιτ']],
  ['Australia', ['Sydney', 'Melbourne']], ['Turkey', ['Istanbul']], ['Brazil', ['Rio de Janeiro', 'Sao Paulo']], ['Canada', ['Toronto']],
  ['Switzerland', ['Zurich', 'Geneva']], ['Pakistan', ['Karachi', 'Lahore']], ['India', ['Mumbai']], ['China', ['Shanghai']], ['Morocco', ['Casablanca']],
  ['Vietnam', ['Ho Chi Minh City', 'Saigon']], ['Kazakhstan', ['Almaty']], ['Ecuador', ['Guayaquil']], ['Bolivia', ['Santa Cruz', 'Cochabamba']]];
for (const [c, cities] of NOT_CAPITALS) for (const city of cities) ok(matchAnswer(byName[c], city) === null, c + ': "' + city + '" is rejected');

section('5. Nothing is accepted for every country');
const PROTO = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf', 'prototype', '__defineGetter__', 'isPrototypeOf', 'toLocaleString'];
for (const k of PROTO) ok(ALL.every((e) => matchAnswer(e, k) === null), '"' + k + '" is not an answer to anything');
ok(ALL.every((e) => matchAnswer(e, '') === null && matchAnswer(e, '   ') === null && matchAnswer(e, '?!.,') === null), 'empty / punctuation-only input is rejected');
ok(src.includes('Object.create(null)'), 'acceptedForms builds a null-prototype map');
// No accepted form may belong to two DIFFERENT countries — with one deliberate exception: Jerusalem,
// which Israel names as its capital and Palestine claims (as East Jerusalem), so both entries accept it.
const SHARED_OK = new Set(['Israel|Palestine']);
const seenKey = new Map();
for (const e of ALL) for (const k of Object.keys(acceptedForms(e))) {
  if (seenKey.has(k) && seenKey.get(k) !== e.c && !SHARED_OK.has([seenKey.get(k), e.c].sort().join('|')))
    ok(false, 'accepted form "' + k + '" belongs to both ' + seenKey.get(k) + ' and ' + e.c);
  seenKey.set(k, e.c);
}
ok(true, 'no accepted form is shared by two countries (Jerusalem excepted)');

section('6. The owner\'s cases, and the ones found beside them');
const B = byName['Bolivia'];
ok(matchAnswer(B, 'Bolivia') === null, 'Bolivia: "Bolivia" is wrong');
ok(matchAnswer(B, 'Sucre') === 'Sucre' && !isAltForm(B, 'Sucre'), 'Bolivia: Sucre is the capital');
ok(matchAnswer(B, 'la paz') === 'La Paz' && isAltForm(B, 'La Paz'), 'Bolivia: La Paz (seat of government) is accepted AND flagged as an alternative, so the page says so');
ok(matchAnswer(B, 'Λα Παζ') === 'Λα Παζ' && isAltForm(B, 'Λα Παζ'), 'Bolivia: Λα Παζ likewise in Greek');
ok(matchAnswer(byName['United States'], 'USA') === null && matchAnswer(byName['United States'], 'Washington') === 'Washington', 'United States: USA rejected, Washington accepted');
ok(matchAnswer(byName['Czechia'], 'Czech Republic') === null && matchAnswer(byName['Czechia'], 'Praha') !== null, 'Czechia: Czech Republic rejected, Praha accepted');
ok(matchAnswer(byName['Cote d\'Ivoire'], 'Ivory Coast') === null && matchAnswer(byName['Cote d\'Ivoire'], 'Abidjan') !== null, 'Côte d\'Ivoire: Ivory Coast rejected, Abidjan (seat of government) accepted');
ok(matchAnswer(byName['Netherlands'], 'The Hague') !== null && matchAnswer(byName['Netherlands'], 'Χάγη') !== null && matchAnswer(byName['Netherlands'], 'Netherlands') === null, 'Netherlands: The Hague / Χάγη accepted, the country name rejected');
ok(matchAnswer(byName['Malaysia'], 'Putrajaya') !== null, 'Malaysia: Putrajaya (administrative capital) accepted');
ok(exactMatch(byName['Gabon'], 'Λιμπρεβίλ') !== null && exactMatch(byName['Gabon'], 'Λιμπρβίλ') === null, 'Gabon: Λιμπρεβίλ is the spelling now; the old typo is only a tolerated slip');
ok(matchAnswer(byName['Greece'], 'Αθίνα') !== null && matchAnswer(byName['Greece'], 'ΑΘΗΝΑ') !== null && matchAnswer(byName['Greece'], 'Athens') !== null, 'Greece: Greek spelling variants and English are accepted');
ok(matchAnswer(byName['Kuwait'], 'Kuwait City') !== null && matchAnswer(byName['Kuwait'], 'Πόλη του Κουβέιτ') !== null, 'Kuwait: Kuwait City accepted in both languages');
ok(matchAnswer(byName['China'], 'Peking') === 'Peking' && isAltForm(byName['China'], 'Peking'), 'China: Peking accepted as an alternative (former name)');
ok(exactMatch(byName['Iceland'], 'Reykjavík') === 'Reykjavik' && !isAltForm(byName['Iceland'], 'Reykjavík'), 'Iceland: an accented alt spelling is the capital itself, not an alternative');
ok(exactMatch(byName['Denmark'], 'København') === 'København' && exactMatch(byName['Denmark'], 'Kobenhavn') === 'København', 'Denmark: København is accepted, with or without the ø (folded, not deleted)');
ok(exactMatch(byName['Myanmar'], 'Naypyitaw') !== null, 'Myanmar: the Naypyitaw spelling is accepted');
ok(exactMatch(byName['Mozambique'], 'Lourenco Marques') !== null, 'Mozambique: the former name Lourenço Marques is accepted');
ok(matchAnswer(byName['Antigua and Barbuda'], "St. John's") !== null && matchAnswer(byName['Antigua and Barbuda'], 'Saint Johns') !== null, 'Antigua: Saint/St. and apostrophe variants accepted');
ok(matchAnswer(byName['United States'], 'Washington, D.C.') !== null && matchAnswer(byName['United States'], 'washington dc') !== null, 'United States: Washington, D.C. in any punctuation');

section('8. Misspellings: at most 2 letters, never a different real place');
ok(editDistance('paris', 'pairs') === 1 && editDistance('bogota', 'bogata') === 1 && editDistance('kathmandu', 'katmandu') === 1, 'a swapped pair or a missing letter is one slip');
ok(editDistance('abc', 'abc') === 0 && editDistance('', 'abc') === 3 && editDistance('lusaka', 'osaka') === 2, 'distance basics');
ok(typoAllowance('rom') === 0 && typoAllowance('lome') === 1 && typoAllowance('tunis') === 1 && typoAllowance('bogota') === 2 && typoAllowance('la paz') === 1, 'allowance: 0 up to 3 letters, 1 for 4-5, 2 from 6 (spaces not counted)');
const TYPOS = [['Colombia', 'Bogata', 'Bogota'], ['Denmark', 'Copenhagan', 'Copenhagen'], ['Belgium', 'Brusels', 'Brussels'], ['Nepal', 'Kathmando', 'Kathmandu'],
  ['Cambodia', 'Pnom Pen', 'Phnom Penh'], ['France', 'Pairs', 'Paris'], ['Australia', 'Kanberra', 'Canberra'], ['Venezuela', 'Karakas', 'Caracas'],
  ['Hungary', 'Budapesht', 'Budapest'], ['Luxembourg', 'Luxemburg', 'Luxembourg'], ['Bolivia', 'La Pas', 'La Paz'], ['Bolivia', 'Sucr', 'Sucre'],
  ['Honduras', 'Tegusigalpa', 'Tegucigalpa'], ['Burkina Faso', 'Ouagadugou', 'Ouagadougou'], ['Mongolia', 'Ulanbatar', 'Ulaanbaatar'],
  ['Greece', 'Αθήνς', 'Αθήνα'], ['Spain', 'Μαδρτη', 'Μαδρίτη'], ['Gabon', 'Λιμπρβίλ', 'Λιμπρεβίλ'], ['Singapore', 'Singapor', 'Singapore'], ['Monaco', 'Monako', 'Monaco']];
for (const [c, typed, right] of TYPOS) {
  const v = verdict(byName[c], typed);
  ok(v && !v.exact && v.form === right && v.typed === typed, c + ': "' + typed + '" is a tolerated slip for "' + right + '"' + (v ? ' (got ' + JSON.stringify(v) + ')' : ' (rejected)'));
}
const WRONG = [['Togo', 'Rome'], ['Togo', 'Lima'], ['Togo', 'Rom'], ['Cabo Verde', 'Paris'], ['Saint Vincent and the Grenadines', 'Kingston'], ['Jamaica', 'Kingstown'],
  ['Tunisia', 'Tunisia'], ['Tunisia', 'Tunisi'], ['Maldives', 'Mali'], ['South Sudan', 'Cuba'], ['Switzerland', 'Bonn'], ['Ukraine', 'Lviv'], ['France', 'Parma'],
  ['Zambia', 'Osaka'], ['Belarus', 'Pinsk'], ['Austria', 'Vienne'], ['Bahrain', 'Managua'], ['Nicaragua', 'Manama'], ['Nicaragua', 'Manamu'], ['Costa Rica', 'San Juan'],
  ['Algeria', 'Algeria'], ['Greece', 'Ελλάδα'], ['Tunisia', 'Τυνησία'], ['Bangladesh', 'Dakar'], ['Senegal', 'Dhaka'], ['Timor-Leste', 'Delhi'], ['Nigeria', 'Lagos'],
  ['Italy', 'Milan'], ['Turkey', 'Istanbul'], ['Australia', 'Sydney'], ['Bolivia', 'Bolivia'], ['Bolivia', 'Santa Cruz']];
for (const [c, typed] of WRONG) ok(verdict(byName[c], typed) === null, c + ': "' + typed + '" is refused');
// Exhaustive: nothing the game knows as a real place is ever taken as a slip for a DIFFERENT country.
const places = [];
for (const e of ALL) for (const f of [e.cap].concat(e.alt, [e.cap_el], e.alt_el, [e.c, e.c_el])) places.push([e.c, f]);
for (const d of DECOY_CITIES) places.push([null, d]);
let leaks = 0;
for (const e of ALL) {
  const own = acceptedForms(e);
  for (const [owner, f] of places) {
    if (norm(f) in own) continue;             // it IS one of this country's accepted answers
    const v = verdict(e, f);
    if (v) { leaks++; if (leaks <= 10) ok(false, e.c + ': "' + f + '" (' + (owner || 'decoy') + ') was taken as a slip for ' + v.form); }
  }
}
ok(leaks === 0, 'no capital, country name or decoy city is accepted for another country (' + places.length + ' places x ' + ALL.length + ' countries)');
// Coverage: one slipped letter in the middle of each capital (6+ letters) is still recognised, unless it lands on another real place.
let slipOk = 0, slipAll = 0;
for (const e of ALL) {
  const k = norm(e.cap);
  if (k.replace(/ /g, '').length < 6) continue;
  const i = Math.floor(k.length / 2); if (k[i] === ' ') continue;
  const typo = k.slice(0, i) + (k[i] === 'x' ? 'q' : 'x') + k.slice(i + 1);
  slipAll++; if (verdict(e, typo)) slipOk++;
}
ok(slipAll > 100 && slipOk === slipAll, 'a one-letter slip is recognised for every capital of 6+ letters (' + slipOk + '/' + slipAll + ')');

section('9. Country profiles (profiles.en.js / profiles.el.js)');
{
  const FIELDS = ['known', 'economy', 'business', 'tourism', 'history'];
  for (const lang of ['en', 'el']) {
    const file = resolve(DIR, 'profiles.' + lang + '.js');
    let data = null;
    try { require(file); data = window['CAPITALS_PROFILES_' + lang.toUpperCase()]; } catch (err) { ok(false, 'profiles.' + lang + '.js loads (' + err.message + ')'); }
    if (!data) { ok(false, 'profiles.' + lang + '.js defines window.CAPITALS_PROFILES_' + lang.toUpperCase()); continue; }
    ok(Object.keys(data).length === ALL.length && ALL.every((e) => data[e.c]), lang + ': a profile for every country, keyed by the English name');
    ok(Object.keys(data).every((k) => byName[k]), lang + ': no stray keys');
    for (const e of ALL) {
      const p = data[e.c];
      if (!p) continue;
      ok(Object.keys(p).length === FIELDS.length && FIELDS.every((f) => typeof p[f] === 'string' && p[f].trim().length > 0), e.c + ' (' + lang + '): exactly the five fields, non-empty');
      for (const f of FIELDS) {
        const v = p[f] || '';
        const words = v.trim().split(/\s+/).length;
        ok(words >= 12 && words <= 110, e.c + ' (' + lang + ') ' + f + ': ' + words + ' words, within 12-110');
        ok(!/[<>]/.test(v), e.c + ' (' + lang + ') ' + f + ': no markup');
        ok(!/\u2014/.test(v) && !/ \u2013 /.test(v), e.c + ' (' + lang + ') ' + f + ': no em or en dash as punctuation');
        if (lang === 'el') ok(/[\u0370-\u03FF]{3}/.test(v), e.c + ' (el) ' + f + ': written in Greek');
        else ok(!/[\u0370-\u03FF]/.test(v), e.c + ' (en) ' + f + ': written in English');
      }
    }
  }
  ok(/sc\.src = "profiles\." \+ l \+ "\.js";/.test(html), 'the page loads exactly these two files');
}

section('10. Input the matcher must read as the player meant it');
{
  const V = (c, raw) => verdict(byName[c], raw);
  const exactIs = (c, raw, want) => { const v = V(c, raw); return !!v && v.exact && (want === undefined || v.form === want); };
  ok(exactIs('Bolivia', 'La\u00a0Paz'), 'a non-breaking space is a space (La Paz is exact, not a "misspelling")');
  ok(exactIs('Bolivia', 'La\tPaz') && exactIs('Malaysia', 'Kuala\u3000Lumpur') && exactIs('Costa Rica', 'San\u2009José'), 'tab, ideographic and thin spaces are spaces');
  ok(exactIs('Haiti', 'Port\u2011au\u2011Prince') && exactIs('Haiti', 'Port\u2010au\u2212Prince'), 'every hyphen or dash character is a word break');
  ok(exactIs('United States', 'Washington,\u00a0D.C.'), 'Washington,&nbsp;D.C. pasted from a web page is exact');
  ok(exactIs('Equatorial Guinea', 'Ciudad\u00a0de\u00a0la\u00a0Paz'), 'a three-word answer with non-breaking spaces is exact (it used to be refused)');
  ok(exactIs('France', 'ＰＡＲＩＳ'), 'full-width letters read as ASCII');
  ok(exactIs('Vietnam', 'Ανώι') && exactIs('Vietnam', 'Ανόη') && exactIs('Taiwan', 'Ταϊπέη') && exactIs('Niger', 'Νιαμέη'), 'Greek homophone spellings fold fully (Ανώι, Ανόη, Ταϊπέη, Νιαμέη are exact)');
  for (const e of ALL) for (const f of forms(e)) { const k = norm(f); if (norm(k) !== k) ok(false, 'norm is idempotent for "' + f + '" (' + k + ' -> ' + norm(k) + ')'); }
  ok(true, 'norm is idempotent over every accepted form');
  ok(exactIs('Greece', 'Aθήνα') && exactIs('Greece', 'AΘΗΝA'), 'a Latin A inside a Greek word is read as Greek');
  ok(exactIs('South Korea', 'Σεoύλ'), 'a Latin o inside a Greek word is read as Greek');
  ok(exactIs('France', 'P\u0430ris') && exactIs('Russia', 'M\u043eskva'), 'a Cyrillic lookalike inside a Latin word is read as Latin');
  ok(exactIs('France', 'Paris') && exactIs('Greece', 'Athens'), 'plain answers unaffected');
  ok(typoAllowance('τζουμπα') === 1 && typoAllowance('παρισι') === 2, 'Greek μπ/ντ/γκ/τζ/τσ count as one letter each for the slack');
  ok(V('South Sudan', 'Αρούμπα') === null, 'Αρούμπα (Aruba) is not a slip of Τζούμπα');
  // A place blocks a slip only when the answer could be a slip of THAT place too.
  for (const [c, typed] of [['Malta', 'Valeta'], ['Estonia', 'Talin'], ['Czechia', 'Prag'], ['Saudi Arabia', 'Riad']]) {
    const v = V(c, typed); ok(v && !v.exact, c + ': "' + typed + '" is a tolerated slip now (was refused by an unrelated nearby place)');
  }
  // A slip of an alternative is not "the correct spelling"
  const pekin = V('China', 'Pekin'); ok(pekin && !pekin.exact && pekin.form === 'Peking' && isAltForm(byName['China'], pekin.form), 'Pekin is read as the alternative Peking (the page words it "close enough", not "correct spelling")');
}

section('11. No real non-capital place is accepted anywhere (the places fixture)');
{
  const { PLACES_LATIN, PLACES_GREEK } = await import(new URL('./places-fixture.mjs', import.meta.url));
  ok(PLACES_LATIN.length > 2000 && PLACES_GREEK.length > 600, 'fixture loaded (' + PLACES_LATIN.length + ' Latin + ' + PLACES_GREEK.length + ' Greek places)');
  // Differ from a capital only by a space or a hyphen: the same answer typed differently, so a slip of it.
  const SAME_BY_SEPARATOR = new Set(['basse terre', 'george town']);
  let leaked = 0, tried = 0;
  for (const p of PLACES_LATIN.concat(PLACES_GREEK)) {
    const k = norm(p);
    if (SAME_BY_SEPARATOR.has(k)) continue;
    for (const e of ALL) {
      if (k in acceptedForms(e)) continue;          // it IS a name of this capital (a former name, an endonym)
      tried++;
      const v = verdict(e, p);
      if (v) { leaked++; if (leaked <= 12) ok(false, '"' + p + '" is accepted for ' + e.c + ' as ' + v.form + (v.exact ? '' : ' (a slip of ' + v.dist + ')')); }
    }
  }
  ok(leaked === 0, 'none of ' + (PLACES_LATIN.length + PLACES_GREEK.length) + ' real places is accepted for a country it is not the capital of (' + tried + ' pairs)');
}

section('7. The page wiring');
const game = html.slice(html.indexOf('(function () {\n    "use strict";'), html.indexOf('window.AUTHCORE_NO_BAR'));
ok(game.length > 40000, 'game script sliced (' + game.length + ' chars)');
ok(/var match = matchAnswer\(current, raw, ALL\);\s*if \(match\) \{\s*handleCorrect\(match\);/.test(game), 'checkAnswer judges through matchAnswer(current, raw, ALL) and hands the verdict to handleCorrect');
ok(!/if \(forms\[norm\(raw\)\]\)/.test(game), 'the old if (forms[norm(raw)]) lookup is gone');
ok(/function handleCorrect\(match\) \{\s*solved = true;\s*matchInfo = match \|\| null;/.test(game), 'handleCorrect remembers the verdict');
ok(/function handleReveal\(\) \{[\s\S]{0,120}matchInfo = null;/.test(game), 'a reveal clears it');
ok(/solved = false;\s*matchInfo = null;[\s\S]{0,200}renderFlag/.test(game), 'a new question clears it');
ok((game.match(/renderAnswerNotes\(\);/g) || []).length === 2, 'renderAnswerNotes runs in showReveal AND on a language switch (renderRevealText)');
ok(/if \(revCorrect && matchInfo\) \{\s*var alt = isAltForm\(current, matchInfo\.form\);\s*if \(!matchInfo\.exact && alt\)/.test(game), 'notes only for a correct answer; a slip of an alternative gets its own single line');
ok(/t\("typoNote"\)\(escapeHtml\(matchInfo\.typed\), escapeHtml\(matchInfo\.form\)\)/.test(game), 'what the player typed and the right spelling are both HTML-escaped');
ok(/t\("altAccepted"\)\(escapeHtml\(matchInfo\.form\), true\)/.test(game) && /t\("typoAltNote"\)\(escapeHtml\(matchInfo\.typed\), escapeHtml\(matchInfo\.form\)\)/.test(game), 'the alternative and the typed text are HTML-escaped before they are drawn');
ok((game.match(/typoAltNote: function \(typed, form\)/g) || []).length === 2, 'typoAltNote is translated in both languages');
ok((game.match(/typoNote: function \(typed, right\)/g) || []).length === 2, 'typoNote is translated in both languages');
ok((game.match(/renderProfile\(\);/g) || []).length >= 2, 'the country profile is drawn on the reveal and on a language switch');
ok(/dd\.textContent = p\[f\[0\]\]/.test(game) && !/profileList\.innerHTML = [^"]/.test(game), 'profile text goes in via textContent, never innerHTML');
ok(html.includes('<div class="cap-alt" id="capAlt"></div>') && game.includes('capAlt: $("capAlt")'), 'the #capAlt element exists and is registered');
ok((game.match(/altAccepted: function \(ans, yours\)/g) || []).length === 2, 'altAccepted is translated in both languages');
ok(html.includes('.answer-banner .cap-alt:empty { display: none; }'), 'an empty note takes no space');

console.log('\n' + (fails ? 'FAILED — ' + fails + ' of ' + checks + ' checks failed' : 'OK — all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);
