/*
 * nonarticle-selftest.mjs — offline unit test for the non-research classifier.
 * Run: node lit/_scraper/nonarticle-selftest.mjs   (no network)
 *
 * Guards the precision/recall guarantees the analytics "exclude non-research
 * items" toggle relies on: real research articles must NEVER be flagged, while
 * front matter / book reviews / errata / announcements / indices always are.
 */
import { isNonArticle } from './_nonarticle.mjs';

const SHOULD_FLAG = [
  'Editorial Board',
  'Editorial Board and Journal Information',
  'Prelim p. 2; First issue - Editorial Board',
  'Book Review: The Marketplace of Revolution',
  'Book Reviews',
  'Corrigendum to “Platform financing vs. bank financing”',
  'Erratum: Deterministic Production Planning with Concave Costs',
  'Errata: Love Thy Neighbor?',
  'Retraction notice to “…”',
  'Call for Papers — Management Science Special Issue',
  'Announcement: New Associate Editors',
  'Announcements',
  'Author Index',
  'Subject Index to Volume 42',
  'Index to Volume 15',
  'Table of Contents',
  'Issue Information',
  'In Memoriam: A Great Scholar',
  'Preface to the Special Issue',
  'Foreword',
  'Acknowledgment of Reviewers',
  '',            // untitled front matter
];

// Real research articles that must NOT be flagged (incl. tricky lead words).
const SHOULD_KEEP = [
  'Announcement effects of new equity issues and the use of intraday price data',
  'A note on the complexity of the bin-packing problem',            // "Note on…" are real papers
  'Comment on “A theory of the firm”',                              // substantive comments
  'Reply to Smith and Jones',
  'Time Varying Structural Vector Autoregressions and Monetary Policy',
  'Content analysis of consumer reviews',                           // starts "Content", not "Contents"
  'Editorials as strategic communication',                          // "Editorial…" as a topic, not front matter
  'Reviewing the literature on dynamic pricing',
  'Indexing strategies for large databases',                        // "Index…" as a topic
  'Measuring the efficiency of decision making units',
];

let fail = 0;
for (const t of SHOULD_FLAG) if (!isNonArticle(t)) { console.error('FAIL: should flag but did not:', JSON.stringify(t)); fail++; }
for (const t of SHOULD_KEEP) if (isNonArticle(t)) { console.error('FAIL: flagged a real paper:', JSON.stringify(t)); fail++; }

if (fail) { console.error(`\nnonarticle-selftest: ${fail} failure(s)`); process.exit(1); }
console.log(`nonarticle-selftest: OK (${SHOULD_FLAG.length} flagged, ${SHOULD_KEEP.length} kept)`);
