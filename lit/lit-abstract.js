/* ── lit-abstract.js — the abstract a paper card SHOWS, and the abstract the
 *                      Abstracts search MATCHES: one definition ──────────────
 *
 * ONE definition, loaded by ALL FOUR consumers:
 *
 *   the main browser  <script src="lit-abstract.js">            -> window.LitAbstract
 *                     paperCardHTML renders it; applyFilters / crossFilter
 *                     search it (absSearchText) — the SAME text, so a search
 *                     can never find a sentence the card does not show
 *   the mailer        createRequire(...)('.../lit-abstract.js')  -> module.exports
 *                     an alert's "abstract contains" criterion
 *   emit-db.mjs       createRequire(...)                         -> the ?db=1 trigram index
 *   the selftest      lit/_scraper/abstract-display-selftest.mjs
 *
 * The data KEEPS the raw deposit. INFORMS closes every abstract with an
 * acceptance sentence naming the editor — "This paper was accepted by Eric
 * So, accounting." — and, after it, the funding / supplemental-material tail;
 * acceptance() in build-data.mjs reads the editor and the area from that
 * sentence, and the daily build re-maps every abstract from Crossref anyway.
 * What a reader sees, and what a search looks through, is what this file
 * returns (owner, 2026-09-15: "This commentary was accepted by Christoph
 * Loch." on three MS commentaries, then "this commentary was" typed into the
 * Abstracts search still finding them once the cards no longer said it).
 *
 * Same shape as lit-news.js: a UMD wrapper, no dependencies, ES5 inside.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LitAbstract = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The item type varies with the item: a research paper says "paper", the
  // September-2026 MS commentaries on "Fighting Fire with Fire" end in "This
  // commentary was accepted by Christoph Loch.", an MS discussion says
  // "discussion", and some records say "has been" rather than "was". Two
  // things about the pattern are deliberate. The noun list is CLOSED: a \w+
  // rule would cut real prose — a TAR abstract in the FT50 catalog reads
  // "This method is accepted by that group of accountants…" mid-abstract,
  // and "article" is deliberately NOT in it: the one tail that uses it
  // ("…according to Aristotle, when Note This article was accepted by former
  // Editor John P Campbell", a 1983 JAP row) has no sentence end before the
  // note, so the cut would take the abstract's real last sentence with it.
  // The match is case-sensitive, so an arXiv abstract's mid-sentence "as this
  // article has been accepted by the Frontiers of…" could never match either.
  // And "by" is REQUIRED: "This paper has been accepted for publication in
  // the Journal of…" is a note an OSF working paper ends with (another ends
  // "This article has been accepted for publication in…"), and it is theirs
  // to keep.
  var ACCEPTED_BY_RE = /\bThis (?:paper|work|commentary|discussion|comment|reply|note|rejoinder|editorial|erratum) (?:was|has been) accepted by\b/;
  // The INFORMS special-issue tail without "by" — "This paper has been
  // accepted for the Manufacturing & Service Operations Management Special
  // Issue on Value Chain Innovations in Developing Economies.", the LAST
  // sentence of twenty M&SOM abstracts (measured 2026-09-15; every other
  // journal's copy of that sentence sits inside a History: block, which the
  // trailer cut below already removes) — anchored on the journal name so the
  // OSF notes cannot match it.
  var ACCEPTED_FOR_RE = /\bThis paper (?:was|has been|is) accepted for the (?:Manufacturing & Service Operations Management|M&SOM|Management Science|Operations Research|Marketing Science|Information Systems Research|Strategy Science|Transportation Science|Organization Science|Mathematics of Operations Research|INFORMS Transactions on Education|INFORMS Journal on Computing|INFORMS) [Ss]pecial (?:[Ii]ssue|[Ss]ection)\b/;
  // The cut keeps the abstract's own last sentence whole — whatever it ends
  // in. The first of those commentaries ends "…does it ask more of human
  // judgment, or less?", and a plain widening of the old endsWith('.') cut
  // would have walked back to the previous period and dropped that closing
  // question together with the tail.
  var SENTENCE_END_RE = /[.?!]["'”’)\]]*$/;
  var LAST_SENTENCE_RE = /^[\s\S]*[.?!]["'”’)\]]*/;
  // Trailer markers: everything from the first one on is tail, not abstract.
  var JUNK = ['Funding:', 'Supplemental Material:', 'Conflict of Interest', 'The online appendix', 'Data and the online appendix', 'History:', 'Disclaimer/Publisher'];

  function cutBeforeTail(s, idx) {
    var before = s.substring(0, idx).trimEnd();
    if (!SENTENCE_END_RE.test(before)) {
      var m = before.match(LAST_SENTENCE_RE);
      if (m && m[0].length > 0) before = m[0];
    }
    return before;
  }

  function cleanAbstract(s) {
    if (!s) return '';
    s = String(s);
    // Remove everything from the acceptance sentence onwards. An abstract
    // that BEGINS with it ("This paper was accepted by Christoph Loch,
    // commentary." — four MS rows: two are the sentence alone, two carry a
    // supplement or conflict-of-interest trailer after it) cleans to '' and
    // the card shows no abstract: a paper shows nothing rather than a
    // description of itself.
    var am = ACCEPTED_BY_RE.exec(s);
    if (am) s = am.index > 0 ? cutBeforeTail(s, am.index) : '';
    var af = ACCEPTED_FOR_RE.exec(s);
    if (af) s = af.index > 0 ? cutBeforeTail(s, af.index) : '';
    // Remove other trailing junk patterns. A marker at position 0 means the
    // whole "abstract" is trailer — "History: Accepted by Christoph Loch,
    // commentary." is one MS row's entire deposit — so that shows nothing too.
    for (var i = 0; i < JUNK.length; i++) {
      var ji = s.indexOf(JUNK[i]);
      if (ji > 0) s = cutBeforeTail(s, ji);
      else if (ji === 0) s = '';
    }
    // Remove a trailing DOI URL — and the sentence that only pointed at it.
    // "The e-companion is available at https://doi.org/… ." (119 rows), "The
    // online appendices are available at …", "Data are available at …": with
    // the URL gone that sentence has no terminator and used to dangle on the
    // card as "…is available at" (417 rows measured 2026-09-15). A sentence
    // that ends in a bare DOI is a pointer, not prose, so it goes with the
    // URL; an abstract that was ONLY the pointer shows nothing. A URL anywhere
    // else is untouched, and so is a complete sentence before the URL.
    var noDoi = s.replace(/\s*https?:\/\/doi\.org\/\S+\s*\.?\s*$/, '');
    if (noDoi !== s) {
      s = noDoi.trimEnd();
      if (s && !SENTENCE_END_RE.test(s)) {
        var pm = s.match(LAST_SENTENCE_RE);
        s = pm ? pm[0] : '';
      }
    }
    return s.trim();
  }

  return {
    cleanAbstract: cleanAbstract,
    cutBeforeTail: cutBeforeTail,
    ACCEPTED_BY_RE: ACCEPTED_BY_RE,
    ACCEPTED_FOR_RE: ACCEPTED_FOR_RE,
    SENTENCE_END_RE: SENTENCE_END_RE
  };
}));
