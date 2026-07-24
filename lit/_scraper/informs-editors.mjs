/*
 * informs-editors.mjs — extract Senior Editor / Associate Editor names from an
 * INFORMS article's "History:" line, e.g.
 *   "History: Dr. Ram D. Gopal, Senior Editor; Dr. Hong Xu, Associate Editor."
 *   "History: Accepted by Alessandro Acquisti, Senior Editor; Il-Horn Hann, Associate Editor."
 *   "History: Puneet Manchanda served as the senior editor."
 *   "K. Sudhir served as the senior editor and Shan Yu as associate editor for this article."
 *   "Accepted by Senior Editor Jeffrey Parsons."
 * Used for Information Systems Research (SE + AE) and Marketing Science (SE).
 * The text comes from a Crossref abstract/assertion (when INFORMS deposits the
 * History line there) or from the pubsonline article page fetched by
 * informs-editors-local.mjs.
 *
 * Exported:
 *   parseInformsEditors(text)   -> { se: 'A; B' | '', ae: '...' | '' }
 *   editorsFromPageHtml(html)   -> { se, ae } | null   (multi-window page scan)
 * Offline tests: node informs-editors-selftest.mjs
 */

// Keep only what follows the last real sentence boundary (". " after a word
// or a 4-digit year — History dates end sentences too — not after an initial
// like "D." or a title like "Dr.").
function tailSegment(s) {
  const parts = String(s || '').split(/(?<=[a-zà-þ]{2}|\d{4})\.\s+/);
  return parts[parts.length - 1];
}

function cleanName(raw) {
  let s = tailSegment(String(raw || ''))
    .replace(/^.*(?:history|editors?)\s*:\s*/i, '')
    // "Accepted by <Name>" / "processed by <Name>" / "recommended (for
    // acceptance) by <Name>" — the History line's verb phrase must not leak
    // into the captured name (plausibleName would reject it wholesale).
    .replace(/^.*?\b(?:accepted|processed|handled|recommended(?:\s+for\s+acceptance)?|edited)\s+by\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:and|with|by)\s+/i, '')
    .replace(/^(?:the\s+)?(?:special[- ]issue\s+)?(?:senior|associate)\s+editors?\s+/i, '')
    .replace(/^(?:dr|prof(?:essor)?|mr|mrs|ms)\.?\s+/i, '')
    .replace(/[.,;:]+$/, '')
    .trim();
  return s;
}

// A plausible person name: 1-5 tokens, starts uppercase, no sentence words.
function plausibleName(s) {
  if (!s || s.length < 4 || s.length > 60) return false;
  if (s.split(/\s+/).length > 6) return false;
  if (!/^[A-ZÀ-Þ]/.test(s)) return false;
  return !/\b(the|this|that|is|are|was|were|we|of|in|on|to|as|for|paper|article|issue|editors?|received|accepted|served|revisions?)\b/i.test(s);
}

// "A and B" -> ["A", "B"]; drops implausible pieces.
function splitNames(raw) {
  return String(raw || '')
    .split(/\s+(?:and|&)\s+/i)
    .map(cleanName)
    .filter(plausibleName);
}

export function parseInformsEditors(text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const se = new Set(), ae = new Set();

  // "<Name>, Senior Editor" / "<Name>, Associate Editor" (";"-separated lists,
  // incl. "Accepted by <Name>, Senior Editor" — cleanName strips the verb).
  for (const m of t.matchAll(/([^;:]{2,80}?),\s*(?:the\s+)?Senior\s+Editors?\b/gi)) {
    splitNames(m[1]).forEach(n => se.add(n));
  }
  for (const m of t.matchAll(/([^;:]{2,80}?),\s*(?:the\s+)?Associate\s+Editors?\b/gi)) {
    splitNames(m[1]).forEach(n => ae.add(n));
  }
  // "<Name> served as (the) senior editor(s)" — also "… senior editor and
  // <Name> served as associate editor".
  // Periods are allowed inside the capture (initials like "K. Sudhir");
  // cleanName's tailSegment trims anything before a real sentence boundary.
  for (const m of t.matchAll(/([^;:]{2,90}?)\s+served\s+as\s+(?:the\s+)?senior\s+editors?\b/gi)) {
    splitNames(m[1]).forEach(n => se.add(n));
  }
  for (const m of t.matchAll(/([^;:]{2,90}?)\s+served\s+as\s+(?:the\s+)?associate\s+editors?\b/gi)) {
    splitNames(m[1]).forEach(n => ae.add(n));
  }
  // Elided verb: "… senior editor and <Name> as (the) associate editor" —
  // "served" appears once and is shared by both clauses.
  for (const m of t.matchAll(/\b(?:and|;)\s*([A-ZÀ-Þ][^;:]{1,60}?)\s+as\s+(?:the\s+)?associate\s+editors?\b/g)) {
    splitNames(m[1]).forEach(n => ae.add(n));
  }
  // Inverted order: "accepted/processed/handled by (the) Senior Editor <Name>".
  for (const m of t.matchAll(/\b(?:accepted|processed|handled|edited)\s+by\s+(?:the\s+)?(?:special[- ]issue\s+)?senior\s+editors?,?\s+([A-ZÀ-Þ][^.;:()]{2,60})/gi)) {
    splitNames(m[1]).forEach(n => se.add(n));
  }
  for (const m of t.matchAll(/\b(?:accepted|processed|handled|edited)\s+by\s+(?:the\s+)?associate\s+editors?,?\s+([A-ZÀ-Þ][^.;:()]{2,60})/gi)) {
    splitNames(m[1]).forEach(n => ae.add(n));
  }
  // "Senior Editor: <Name>" / "Associate Editor: <Name>"
  let m = t.match(/Senior\s+Editors?\s*[:—-]\s*([^.;]{2,80})/i);
  if (m) splitNames(m[1]).forEach(n => se.add(n));
  m = t.match(/Associate\s+Editors?\s*[:—-]\s*([^.;]{2,80})/i);
  if (m) splitNames(m[1]).forEach(n => ae.add(n));

  return { se: [...se].join('; '), ae: [...ae].join('; ') };
}

// Scan a whole pubsonline article page for editor names: parse a window around
// EVERY "History:" label and every "Senior/Associate Editor" mention (the old
// single 500-char window truncated long History lines — received/revised/
// accepted dates come first — and missed layouts without the label). Returns
// null when the page has no editor-ish text at all; window count is capped so
// a pathological page stays cheap.
export function editorsFromPageHtml(html) {
  // Close each block element with "; " BEFORE stripping tags: adjacent blocks
  // would otherwise concatenate without punctuation, and a name-like fragment
  // from the previous block (an author list, a nav item) could bleed into the
  // "<Name> served as…" capture. ';' is already a hard boundary for every
  // parser pattern, so this only ever tightens the windows.
  const text = String(html || '')
    .replace(/<\/(?:p|div|section|li|h[1-6]|td|tr|ul|ol|nav)>|<br\s*\/?>/gi, ' ; ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const windows = [];
  for (const m of text.matchAll(/History\s*:/gi)) {
    windows.push(text.slice(m.index, m.index + 1500));
    if (windows.length >= 8) break;
  }
  for (const m of text.matchAll(/(?:Senior|Associate)\s+Editor/gi)) {
    windows.push(text.slice(Math.max(0, m.index - 400), m.index + 400));
    if (windows.length >= 24) break;
  }
  if (!windows.length) return null;
  const se = new Set(), ae = new Set();
  for (const w of windows) {
    const ed = parseInformsEditors(w);
    if (ed.se) ed.se.split('; ').forEach(n => se.add(n));
    if (ed.ae) ed.ae.split('; ').forEach(n => ae.add(n));
  }
  return { se: [...se].join('; '), ae: [...ae].join('; ') };
}

// ── Known editor-name typos → canonical spelling ────────────────────────────
// pubsonline's own History lines occasionally misspell an editor's name (e.g.
// "Olivier Tobuia" / "Olivier Touba" for Olivier Toubia) and the crawl copies
// them faithfully, splitting one editor across several filter entries. This
// map heals them at INGEST — informs-editors-local.mjs (cache load, new crawl
// records, applyToPapers) and build-data.mjs (mapWork + applyInformsEditors)
// — NOT inside the parser, so the console harvester's VENDORED parser stays
// byte-identical (its raw output is healed when applied/built). Keyed by the
// folded (lowercased, space-collapsed) name. Add new typos here as found.
export const EDITOR_NAME_FIXUPS = {
  'olivier tobuia': 'Olivier Toubia',
  'olivier touba': 'Olivier Toubia',
  'antony dukes': 'Anthony Dukes',
};
// NOT typos — distinct real editors that a fuzzy merge would wrongly fold:
// "Heng Xu" vs "Hong Xu" (both ISR editors). Never add near-name pairs here
// without confirming they are the SAME person.

// Canonicalize a "Name; Name" editor list via EDITOR_NAME_FIXUPS.
// Unknown names pass through untouched; falsy input is returned as-is.
export function canonEditorNames(list) {
  if (!list) return list;
  return String(list)
    .split('; ')
    .map(n => EDITOR_NAME_FIXUPS[n.toLowerCase().replace(/\s+/g, ' ').trim()] || n)
    .join('; ');
}
