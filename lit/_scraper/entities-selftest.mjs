/*
 * entities-selftest.mjs — offline unit test for _entities.mjs (no network).
 * Run:  node lit/_scraper/entities-selftest.mjs
 */
import { cleanText, titleText, affilName, affilParts, affilList,
  trimTrailingSeparators, namedEntity, stripPageFurniture } from './_entities.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };
const eq = (got, want, m) => {
  if (got === want) pass++;
  else { fail++; console.log(`  FAIL: ${m}\n     got ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// ── entity decoding (the catalog's real cases) ────────────────────────────────
eq(cleanText('Social Learning and the Innkeeper&apos;s Challenge'),
  "Social Learning and the Innkeeper's Challenge", '&apos; decodes');
eq(cleanText('A &quot;Quantal Regret&quot; Method'), 'A "Quantal Regret" Method', '&quot; decodes');
eq(cleanText('Mergers &amp; Acquisitions'), 'Mergers & Acquisitions', '&amp; decodes');
eq(cleanText('Mergers &amp;amp; Acquisitions'), 'Mergers & Acquisitions', 'double-encoded &amp;amp; fully resolves');
eq(cleanText('Machine interference&mdash;a comparison'), 'Machine interference—a comparison', '&mdash; decodes');
eq(cleanText('pp. 10&ndash;20'), 'pp. 10–20', '&ndash; decodes');
eq(cleanText('Anil Mital &lpar;Elsevier&rpar; &lsqb;Book&rsqb;'), 'Anil Mital (Elsevier) [Book]', 'JATS punctuation names decode');
eq(cleanText('operator&sol;machine'), 'operator/machine', '&sol; decodes');
eq(cleanText('&pound;25 &plus; VAT'), '£25 + VAT', '&pound;/&plus; decode');
eq(cleanText('scheduling system&ast;'), 'scheduling system*', '&ast; decodes');
eq(cleanText('X &nbsp; Y'), 'X Y', '&nbsp; becomes a plain space and collapses');
eq(cleanText('Per&#x00FA;'), 'Perú', 'hex numeric entity decodes');
eq(cleanText('caf&#233;'), 'café', 'decimal numeric entity decodes');
eq(cleanText('&Escr;-stability of the &phiv; rule'), 'ℰ-stability of the ϕ rule', 'script/variant letters decode');
eq(cleanText('x &equals; y &les; z &ges; w'), 'x = y ≤ z ≥ w', 'math entity aliases decode');

// case sensitivity: &Eacute; vs &eacute;, and the all-caps fallback
eq(cleanText('D&eacute;j&agrave; vu'), 'Déjà vu', 'lowercase accents decode');
eq(cleanText('&Eacute;cole Polytechnique'), 'École Polytechnique', 'capital accent decodes');
eq(cleanText('VINGT ANS APR&EACUTE;S.'), 'VINGT ANS APRÉS.', 'ALL-CAPS entity name falls back to the capital letter');
ok(namedEntity('EACUTE') === 'É' && namedEntity('Eacute') === 'É' && namedEntity('eacute') === 'é',
  'namedEntity is case-aware (É/É/é)');

// unknown entities are NEVER guessed
eq(cleanText('word&haelip; rest'), 'word&haelip; rest', 'unknown entity (publisher typo) left intact');
eq(cleanText('P&aacte;ramo'), 'P&aacte;ramo', 'misspelled accent entity left intact');
eq(cleanText('AT&T;'), 'AT&T;', 'a capitalised non-entity is not decoded');

// ── markup stripping (decode-first order) ─────────────────────────────────────
eq(cleanText('On the Value of R&lt;sup&gt;2&lt;/sup&gt; in Regression'),
  'On the Value of R2 in Regression', 'double-encoded <sup> decodes THEN strips (old stripJats left it raw)');
eq(cleanText('&lt;tocheading&gt;Book Reviews&lt;/tocheading&gt;'), 'Book Reviews', 'encoded wrapper tag removed');
eq(cleanText('"P<sup>2</sup>-FORM" STRATEGIC MANAGEMENT'), '"P2-FORM" STRATEGIC MANAGEMENT',
  'literal <sup> strips with no space');
eq(cleanText('Cs<sub>3</sub>Cu<sub>2</sub>I<sub>5</sub> Films'), 'Cs3Cu2I5 Films', 'chemistry formula stays intact');
eq(cleanText('The <i>hidden</i> cost'), 'The hidden cost', 'literal <i> strips to a space');
eq(cleanText('&lt;p&gt;&lt;span&gt;An Economic Geography Dataset&lt;/span&gt;&lt;/p&gt;'),
  'An Economic Geography Dataset', 'entity-encoded <p><span> wrapper removed');
eq(cleanText('First Part&lt;br&gt;Second Part'), 'First Part Second Part', '<br> becomes a space');

// what must SURVIVE
eq(cleanText('When is P &lt; 0.05 Significant?'), 'When is P < 0.05 Significant?', 'a lone < (not a tag) is preserved');
eq(cleanText('Visited 2002.<http://www.whitehouse.gov/>'), 'Visited 2002.<http://www.whitehouse.gov/>',
  'a bare <URL> is not eaten as markup');
eq(cleanText('A Perfectly Ordinary Title'), 'A Perfectly Ordinary Title', 'clean text passes through');
eq(cleanText(cleanText('On the Value of R&lt;sup&gt;2&lt;/sup&gt;')), 'On the Value of R2', 'idempotent');
eq(cleanText(''), '', 'empty'); eq(cleanText(null), '', 'null');

// ── trailing-separator trim (LIT-260725-YWTL) composed with decoding ─────────
eq(titleText('The Lock-In Effect and the Corporate Payout Puzzle,'),
  'The Lock-In Effect and the Corporate Payout Puzzle', 'trailing comma trimmed');
eq(titleText('America’s Best:'), 'America’s Best', 'trailing colon trimmed');
eq(titleText('KBSS: a knowledge-based job-shop scheduling system&ast;'),
  'KBSS: a knowledge-based job-shop scheduling system*', '&ast; now DECODES (no longer merely protected)');
eq(titleText('Implementing the &quot;Wisdom of the Crowd&quot;'),
  'Implementing the "Wisdom of the Crowd"', 'trailing &quot; decodes to a quote (not trimmed)');
eq(titleText('word&haelip;'), 'word&haelip;', "an UNKNOWN entity's terminating ';' is still never trimmed");
eq(trimTrailingSeparators('Weird Title , ;'), 'Weird Title', 'separator runs collapse');
eq(titleText('When is P &lt; 0.05 Significant?'), 'When is P < 0.05 Significant?', 'question mark kept');

// ── affiliations ──────────────────────────────────────────────────────────────
eq(affilName('University of Tokyo ,'), 'University of Tokyo', 'affiliation comma trimmed');
eq(affilList('Universidad de Lima, Per&#x00FA;'), 'Universidad de Lima, Perú', 'entity in an affiliation decodes');
eq(affilList('A, Per&#x00FA;; B University'), 'A, Perú; B University', 'decode + real separator both work');
eq(affilList('Germany;; Leadec, Chemnitz'), 'Germany; Leadec, Chemnitz', 'empty segment dropped');
eq(affilList('word&haelip; Institute; Other U'), 'word&haelip; Institute; Other U',
  "an unknown entity's ';' is masked through the split, not treated as a separator");
eq(JSON.stringify(affilParts('Dept A;Univ B ,')), JSON.stringify(['Dept A', 'Univ B']),
  'affilParts splits and trims each part');
eq(affilList(affilList('A, Per&#x00FA;; B ,')), affilList('A, Per&#x00FA;; B ,'), 'affilList idempotent');
eq(affilList('Advertising, Public Relations, &amp;#38; Retailing MSU'),
  'Advertising, Public Relations, & Retailing MSU', 'DOUBLE-encoded entity in an affiliation fully decodes in one call');
eq(affilList(affilList('Advertising, &amp;#38; Retailing')), affilList('Advertising, &amp;#38; Retailing'),
  'affilList is idempotent on the double-encoded case');
eq(affilList(''), '', 'affilList empty'); eq(JSON.stringify(affilParts(null)), '[]', 'affilParts null');

// ── page-furniture guard (feedback LIT-260727-XRQ8) ──────────────────────────
const REAL = 'We develop a sequential search model by which consumers who are uncertain about their '
  + 'match value for a product search to reveal noisy signals and update their beliefs in a Bayesian fashion.';
eq(stripPageFurniture(`${REAL} Back to Top Next Figures References Related Information Cited by Some Citing Paper 31 March 2026 | Quantitative Marketing and Economics, Vol. 24, No. 1`),
  REAL, 'navigation + Cited-by tail after the abstract is cut off');
eq(stripPageFurniture(`${REAL} Previous Back to Top Figures References Related Information Volume 23, Issue 1 February 2004 Pages 1-172 Article Information Metrics`),
  REAL, 'the "Previous …" variant (no Cited by) is cut too');
eq(stripPageFurniture(`${REAL} Back to Top Next FiguresReferencesRelatedInformation Volume 14, Issue 3`),
  REAL, 'space-collapsed FiguresReferencesRelatedInformation is cut');
eq(stripPageFurniture('Previous Back to Top Figures References Related Information Volume 72, Issue 7 July 2026 Pages 5491-6432'),
  '', 'an entry that is ONLY furniture empties');
eq(stripPageFurniture('Journal Article Understanding Trust Get access Paola Sapienza, Paola Sapienza Northwestern University Search for other works by this author on: Oxford Academic Google Scholar The Economic Journal, Volume 123, Pages 1313–1332'),
  '', 'an OUP page-header scrape (no abstract on the page) is rejected');
eq(stripPageFurniture('Previous articleNext article No AccessMentoring and Schooling Decisions: Causal EvidenceArmin FalkPDFPDF PLUS Add to favoritesDownload CitationTrack Citations'),
  '', 'a U. Chicago page scrape is rejected');
eq(stripPageFurniture('Views Icon Views Article contents Figures & tables Share Icon Share Cite View This Citation Download citation file: RIS toolbar search'),
  '', 'a Silverchair page scrape is rejected');
eq(stripPageFurniture('No abstract is available for this article.'),
  '', "Wiley's no-abstract notice is not served as an abstract");
eq(stripPageFurniture('This article corrects the following: The Maturity Rat Race MARKUS K. BRUNNERMEIER Volume 68, Issue 3'),
  '', 'an erratum notice scrape is rejected');
eq(stripPageFurniture(REAL), REAL, 'clean abstract passes through unchanged');
eq(stripPageFurniture(stripPageFurniture(`${REAL} Back to Top Next Figures References Related Information`)),
  REAL, 'idempotent');
eq(stripPageFurniture('Firms that fall behind fight their way back to top positions in the ranking, and we model this dynamic over sixty quarters of data using a structural estimation strategy over panel data.'),
  'Firms that fall behind fight their way back to top positions in the ranking, and we model this dynamic over sixty quarters of data using a structural estimation strategy over panel data.',
  '"back to top" inside a real sentence is NEVER a cut point (the cut anchors on the section-label sequence)');
eq(stripPageFurniture('Patients must request permission before records are shared; we study how consent frictions shape data availability in hospital systems across three states.'),
  'Patients must request permission before records are shared; we study how consent frictions shape data availability in hospital systems across three states.',
  'a single weak marker ("request permission" as prose) never rejects');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
