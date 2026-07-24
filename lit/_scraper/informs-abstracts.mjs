/*
 * informs-abstracts.mjs — shared FULL-ABSTRACT extraction for pubsonline
 * (Atypon) article pages, used by informs-abstracts-local.mjs and VENDORED
 * into informs-abstracts-console.js (keep the two in sync — the selftest
 * parity-checks them on every fixture, exactly like the editors pair).
 *
 * Why: Crossref's deposited abstract for many INFORMS papers (Marketing
 * Science especially) is only a one-sentence teaser ("This paper evaluates
 * the role of …"), while the article page carries the real abstract. The
 * crawler reads each page and caches the fuller text in
 * lit/data/_informs-abstracts.json (doi → {a:"…"} | {none:1}); appliers
 * overlay it onto the served papers files via betterAbstract() — an UPGRADE
 * rule, never a downgrade.
 */

// Mirrors build-data.mjs MAX_ABSTRACT — keep in sync.
export const ABS_MAX = 4000;

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

// Repeated decode so double-encoded deposits (&amp;lt; …) fully resolve.
export function decodeEntities(s) {
  let cur = String(s || ''), prev, guard = 0;
  do {
    prev = cur;
    cur = prev
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (m, n) => {
        const k = n.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
      });
  } while (cur !== prev && ++guard < 4);
  return cur;
}

// HTML fragment → clean abstract text: strip tags, decode entities, collapse
// whitespace, drop a leading "Abstract" label and anything from a leaked
// "History:" line on (that's the editors' section, never abstract text).
export function cleanAbstractText(raw) {
  let s = decodeEntities(String(raw || ''))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/^abstract[\s:.–—-]*/i, '');
  const h = s.search(/\bHistory\s*:/i);
  if (h >= 0) s = s.slice(0, h).trim();
  return s;
}

// Extract the article's abstract from a pubsonline page. Candidates: every
// Atypon abstract container (a bounded window after the opening tag, cut at
// the first signature of the NEXT section) plus the dc.Description /
// citation_abstract metas — cleaned, LONGEST wins (og:description and some
// metas are truncated copies, so length is the right tiebreak). Returns the
// text (≤ ABS_MAX chars) or null when the page carries nothing usable.
export function abstractFromPageHtml(html) {
  const h = String(html || '');
  const cands = [];
  const openRe = /<(?:div|section)[^>]*class="[^"]*(?:abstractSection|hlFld-Abstract|abstractInFull|article__abstract)[^"]*"[^>]*>/gi;
  for (const m of h.matchAll(openRe)) {
    let w = h.slice(m.index + m[0].length, m.index + m[0].length + 12000);
    const stop = w.search(
      /class="[^"]*(?:hlFld-Fulltext|history-section|fn-group|sectionInfo|articleReferences|copywrite|coolBar|tab-nav)[^"]*"|<h[12][^>]*>\s*(?:History|Keywords|References|Funding)\b|\bHistory\s*:/i);
    if (stop >= 0) w = w.slice(0, stop);
    // the cut can land INSIDE the next section's opening tag — drop the
    // dangling "<div …" fragment or it survives tag-stripping as text
    const lt = w.lastIndexOf('<');
    if (lt > w.lastIndexOf('>')) w = w.slice(0, lt);
    cands.push(w);
    if (cands.length >= 6) break;
  }
  for (const name of ['dc\\.Description', 'citation_abstract', 'og:description']) {
    const mm =
      h.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([\\s\\S]*?)["']`, 'i')) ||
      h.match(new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:name|property)=["']${name}["']`, 'i'));
    if (mm) cands.push(mm[1]);
  }
  let best = '';
  for (const c of cands) {
    const t = cleanAbstractText(c);
    if (t.length > best.length) best = t;
  }
  if (best.length < 60) return null; // too short to be a real abstract
  return best.slice(0, ABS_MAX);
}

// UPGRADE-ONLY decision: replace the served abstract with the page's copy
// only when the page's is materially longer — a one-line Crossref teaser
// (~100 chars) loses to the real abstract (~1,000+), but a good Crossref
// abstract is never churned for a few characters' difference, and a page
// fragment can never replace fuller existing text.
export function betterAbstract(cur, cand) {
  if (!cand) return false;
  const c = String(cur || '');
  if (!c) return cand.length >= 60;
  return cand.length >= 200 && cand.length > c.length * 1.3;
}
