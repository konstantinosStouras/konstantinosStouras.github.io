/*
 * ec-pages.mjs — parse the "Accepted Papers" pages of the ACM EC conference
 * sites (ec20.sigecom.org … ec26.sigecom.org …). Every year uses a different
 * WordPress markup, so there is one strategy per known year plus a fallback
 * that tries them all and keeps the most plausible result (for future years).
 *
 * Exported: parseAcceptedPapers(html, year) ->
 *   [{ title, authors: [names], affiliations: [strings] }]
 *
 * Formats seen in the wild (fixtures in _probe/sigecom-ec2*.html):
 *   2020: <ul><li><b>Title</b><br>Authors: A, B and C<br>Topics: …</li>
 *   2021: <li><span>A; B; C</span>: <span>Title</span></li> (initials style,
 *         sometimes authors+title inside one span, title itself may contain ':')
 *   2022: <li><strong>Title</strong><br> A; B; C</li>
 *   2023: <li><b>Title</b><br> A (Aff); B (Aff)</li>
 *   2024: <p><strong>Title</strong><br> A <em>(Aff)</em>, B <em>(Aff)</em></p>
 *   2025: <p>N. Title<br> Authors: A (Aff), B (Aff)</p>
 *   2026: same as 2025 (also "Author:" for single-author papers)
 */

// ── small HTML helpers (no dependencies) ────────────────────────────────────

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  eacute: 'é', egrave: 'è', agrave: 'à', auml: 'ä', ouml: 'ö', uuml: 'ü',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç',
  szlig: 'ß', oslash: 'ø', aring: 'å', aelig: 'æ',
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function textOf(htmlFragment) {
  return decodeEntities(
    String(htmlFragment || '')
      .replace(/<br\s*\/?>/gi, '\n')
      // inline formatting tags vanish without adding space, so mid-word markup
      // ("Normalized <em>p</em>-Means") doesn't split the word…
      .replace(/<\/?(?:em|i|b|strong|u|sub|sup|span|a)\b[^>]*>/gi, '')
      // …while any other (block-level) tag still separates its content
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

// The paper list lives inside the WordPress content wrapper; parsing the whole
// page would sweep up nav menus and footers.
function contentRegion(html) {
  const m = html.match(/<div[^>]*class="[^"]*(?:entry-content|post-content|page-content)[^"]*"[^>]*>/i);
  if (!m) return html;
  let seg = html.slice(m.index + m[0].length);
  const end = seg.search(/<footer\b|class="entry-footer|<\/article|<div[^>]*class="[^"]*(?:post-navigation|comments-area)/i);
  return end > 0 ? seg.slice(0, end) : seg;
}

function blocks(region, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(region))) out.push(m[1]);
  return out;
}

// A paren group that is really a surname, not an affiliation: the source pages
// occasionally contain typos like "Dominik (Peters)". Only repair the
// unambiguous shape — a single mixed-case word right after a bare first name.
function looksLikeSurname(group, precedingFragment) {
  if (!/^[A-ZÀ-Þ][a-zà-þ'\-]+$/.test(group)) return false;         // one capitalized word, not ALL-CAPS
  const prev = precedingFragment.trim().split(/\s+/).filter(Boolean);
  return prev.length === 1 && /^[A-ZÀ-Þ]/.test(prev[0] || '');      // bare first name before it
}

// "A (Aff X), B (Aff Y)" -> authors + affiliations. Commas inside parentheses
// must not split the author list, and parens can nest:
// "Vasilis Livanos (Center for Mathematical Modeling (CMM))".
function splitAuthors(s, seps) {
  const affs = [];
  const src = String(s || '');
  let clean = '', i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch !== '(') { clean += ch; i++; continue; }
    // capture the whole balanced group
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) { j++; break; }
    }
    const group = src.slice(i + 1, Math.max(i + 1, j - (src[j - 1] === ')' ? 1 : 0)))
      .replace(/\s+/g, ' ').trim();
    // the author fragment this group belongs to (text since the last , or ;)
    const fragStart = Math.max(clean.lastIndexOf(','), clean.lastIndexOf(';'));
    if (group && looksLikeSurname(group, clean.slice(fragStart + 1))) {
      clean += ' ' + group;              // "Dominik (Peters)" -> "Dominik Peters"
    } else if (group) {
      affs.push(group);
    }
    i = j;
  }
  clean = clean.replace(/\\/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:authors?|by)\s*:\s*/i, '')
    .replace(/[.;,\s]+$/, '');
  let parts = [clean];
  for (const sep of seps) parts = parts.flatMap(p => p.split(sep));
  const authors = parts
    .map(a => a.replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(a => a && a.length > 1 && !/^(?:and|et al\.?)$/i.test(a));
  const seenAff = new Set();
  const affiliations = affs.filter(a => {
    const k = a.toLowerCase();
    if (seenAff.has(k)) return false;
    seenAff.add(k);
    return true;
  });
  return { authors, affiliations };
}

const COMMA_AND = [/\s*,\s*/, /\s+and\s+/i, /\s*&\s*/];
const SEMI_AND = [/\s*;\s*/, /\s+and\s+/i, /\s*&\s*/];

function plausible(entries) {
  return entries.filter(e =>
    e.title && e.title.length >= 8 && e.title.length <= 400 &&
    e.authors.length >= 1 && e.authors.length <= 40 &&
    e.authors.every(a => a.length <= 60)
  );
}

// ── one strategy per known format ───────────────────────────────────────────

// <li>…<b>Title</b>…Authors: A, B and C…Topics: …</li>  (2020)
function parseAuthorsTopicsList(region) {
  return blocks(region, 'li').map(li => {
    const t = textOf(li);
    const m = t.match(/^([\s\S]*?)\n?\s*Authors?\s*:\s*([\s\S]*?)(?:\n\s*Topics?\s*:[\s\S]*)?$/i);
    if (!m) return null;
    const { authors, affiliations } = splitAuthors(m[2].split('\n')[0], COMMA_AND);
    return { title: m[1].replace(/\s+/g, ' ').trim(), authors, affiliations };
  }).filter(Boolean);
}

// <li>A; B; C: Title</li>  (2021 — the first ':' ends the author block)
function parseAuthorsColonTitle(region) {
  return blocks(region, 'li').map(li => {
    const t = textOf(li).replace(/\n/g, ' ');
    const idx = t.indexOf(':');
    if (idx < 1) return null;
    const { authors, affiliations } = splitAuthors(t.slice(0, idx), SEMI_AND);
    return { title: t.slice(idx + 1).replace(/\s+/g, ' ').trim(), authors, affiliations };
  }).filter(Boolean);
}

// <li><strong>Title</strong><br> A; B</li> / <li><b>Title</b><br> A (Aff); B</li>  (2022, 2023)
function parseBoldTitleList(region) {
  return blocks(region, 'li').map(li => {
    const m = li.match(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>([\s\S]*)$/i);
    if (!m) return null;
    const title = textOf(m[1]).replace(/\n/g, ' ').trim();
    const rest = textOf(m[2]).replace(/\n/g, ' ').trim();
    const { authors, affiliations } = splitAuthors(rest, rest.includes(';') ? SEMI_AND : COMMA_AND);
    return { title, authors, affiliations };
  }).filter(Boolean);
}

// <p><strong>Title</strong><br> A <em>(Aff)</em>, B <em>(Aff)</em></p>  (2024)
function parseBoldTitleParagraphs(region) {
  return blocks(region, 'p').map(p => {
    const m = p.match(/^\s*<strong>([\s\S]*?)<\/strong>([\s\S]*)$/i);
    if (!m) return null;
    const title = textOf(m[1]).replace(/\n/g, ' ').trim();
    const rest = textOf(m[2]).replace(/\n/g, ' ').trim();
    if (!rest) return null;
    const { authors, affiliations } = splitAuthors(rest, rest.includes(';') ? SEMI_AND : COMMA_AND);
    return { title, authors, affiliations };
  }).filter(Boolean);
}

// <p>N. Title<br> Authors: A (Aff), B (Aff)</p>  (2025, 2026)
function parseNumberedParagraphs(region) {
  return blocks(region, 'p').map(p => {
    const t = textOf(p);
    const m = t.match(/^\s*\d+\s*[.)]\s*([\s\S]*?)\n\s*Authors?\s*:\s*([\s\S]*)$/i);
    if (!m) return null;
    const { authors, affiliations } = splitAuthors(m[2].replace(/\n/g, ' '), COMMA_AND);
    return { title: m[1].replace(/\s+/g, ' ').trim(), authors, affiliations };
  }).filter(Boolean);
}

const STRATEGIES = [
  parseNumberedParagraphs,   // 2025, 2026 (most specific first)
  parseAuthorsTopicsList,    // 2020
  parseBoldTitleList,        // 2022, 2023
  parseBoldTitleParagraphs,  // 2024
  parseAuthorsColonTitle,    // 2021 (least specific: any "x: y" list item)
];
const BY_YEAR = {
  2020: parseAuthorsTopicsList,
  2021: parseAuthorsColonTitle,
  2022: parseBoldTitleList,
  2023: parseBoldTitleList,
  2024: parseBoldTitleParagraphs,
  2025: parseNumberedParagraphs,
  2026: parseNumberedParagraphs,
};

export function parseAcceptedPapers(html, year) {
  const region = contentRegion(String(html || ''));
  const preferred = BY_YEAR[year];
  if (preferred) {
    const out = plausible(preferred(region));
    if (out.length >= 20) return out;
  }
  // Unknown/changed format: try everything, keep the strategy that finds most.
  let best = [];
  for (const strat of STRATEGIES) {
    const out = plausible(strat(region));
    if (out.length > best.length) best = out;
  }
  return best;
}

// Loose title key for matching a sigecom entry to a Crossref/DBLP record.
export function normTitle(s) {
  return decodeEntities(String(s || ''))
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
