/*
 * _nonarticle.mjs — classify a paper record as a NON-RESEARCH item.
 * ===========================================================================
 * Crossref deposits a lot of non-research content as `journal-article`:
 * journal "Editorial Board" front matter, book reviews, corrigenda/errata,
 * announcements / calls for papers, indices, prefaces, in-memoriam notes, etc.
 * These inflate a journal's paper count (up to ~23% for book-review-heavy
 * journals like Journal of Marketing) and pollute "most-cited" tables.
 *
 * This classifier is used ONLY by the Data Analytics pipeline
 * (build-analytics.mjs) to let the dashboard OFFER a "exclude non-research
 * items" toggle. The main browser's data (lit/data*, the papers files) is
 * deliberately left COMPLETE and untouched — the toggle lives on the analytics
 * page, not in the harvested data.
 *
 * Design: HIGH PRECISION over recall. The patterns are anchored (mostly `^`)
 * and specific so they never drop a real research article — verified against
 * the whole corpus that no flagged record is a well-cited paper (the only
 * catches at high citation counts are book reviews, errata and corrigenda,
 * which is exactly what we want). Notably it does NOT flag bare "Editorial",
 * generic "Note"/"Comment"/"Reply" (which are often real short papers), or
 * titles that merely start with a word like "Announcement" ("Announcement
 * effects of new equity issues" is a real, highly-cited JFE paper).
 */

// Anchored, high-precision non-research title patterns.
export const NON_ARTICLE_PATTERNS = [
  // journal front matter
  /^editorial board\b/i,
  /editorial board and journal/i,
  /^issue information\b/i,
  /^front matter\b/i, /^back matter\b/i, /^masthead\b/i,
  /^table of contents\b/i, /^contents\b/i,
  /^(author|subject|volume) index\b/i, /^index to volume/i, /^cumulative index\b/i,
  /^prelim /i,
  // book reviews
  /^book reviews?\b/i,
  // corrections / retractions
  /\bcorrigend/i, /^erratum\b/i, /^errata\b/i, /^retraction\b/i, /retraction note/i,
  // announcements / calls / housekeeping
  /^call for papers?\b/i,
  /^announcements?\s*(:|—|–|-|$)/i,
  /acknowledg(?:e)?ment of reviewers|reviewer acknowledg/i,
  // memoriam / front essays that are not research
  /^in memoriam\b/i, /^obituary\b/i, /^preface\b/i, /^foreword\b/i,
];

// True when a record's title marks it as a non-research item (or is empty).
export function isNonArticle(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return true;                         // untitled front matter
  for (const re of NON_ARTICLE_PATTERNS) if (re.test(t)) return true;
  return false;
}

export default isNonArticle;
