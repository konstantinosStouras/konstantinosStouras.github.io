/*
 * check-ft50-list.mjs — keep _scraper-ft50/journals.json in sync with the
 * FT50 list. (lit's vendored, independent copy of the fun/ft50 check.)
 * ===========================================================================
 * The Financial Times occasionally revises the 50-journal list used for its
 * research rank (https://www.ft.com/ft50-journals). This script — run once a
 * year by .github/workflows/lit-ft50-check-list.yml, or on demand — fetches
 * the live list, diffs it against _scraper-ft50/journals.json, and:
 *
 *   • ADDED journals: resolves their ISSNs/publisher via the Crossref
 *     /journals?query= endpoint (the title must match exactly after
 *     normalization) and appends a new entry to journals.json. A journal
 *     whose ISSN cannot be resolved with confidence is NOT added silently —
 *     it is listed in the summary for manual addition instead.
 *   • REMOVED journals: marked  "retired": true  (the next data build then
 *     deletes their papers-<key>.json and drops them from the manifest).
 *
 * The workflow commits the updated journals.json and then dispatches the data
 * build, so the dataset follows the FT50 list automatically. When
 * anything changed (or the check could not run), the workflow also opens a
 * GitHub issue from this script's summary so nothing happens silently.
 *
 * ft.com sits behind aggressive bot protection, so the fetch tries ft.com
 * first and falls back to Wikipedia's FT50 article, whose list mirrors the
 * official one. If neither source yields a plausible 50-journal list, the
 * script exits with code 2 (workflow opens a "please check manually" issue).
 *
 * Output contract (read by the workflow):
 *   • journals.json is rewritten only when the list changed
 *   • a human-readable summary is written to _scraper-ft50/_ft50-check-summary.md
 *   • exit 0 = list unchanged; exit 3 = list changed (journals.json updated);
 *     exit 2 = could not verify the list (no changes made)
 *
 * Offline test: FT50_LIST_FILE=<path to saved html/text> node check-ft50-list.mjs --dry
 * Node 20+ only (global fetch). No npm dependencies on purpose.
 * ===========================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNALS_PATH = join(__dirname, 'journals.json');
const SUMMARY_PATH = join(__dirname, '_ft50-check-summary.md');
const DRY = process.argv.includes('--dry');
const MAILTO = process.env.FT50_MAILTO || 'kstouras@gmail.com';

const FT_URL = 'https://www.ft.com/ft50-journals';
const WIKI_URL = 'https://en.wikipedia.org/wiki/FT50';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── name normalization ──────────────────────────────────────────────────────
// "The Accounting Review*" / "Manufacturing and Service Operations Management"
// must match "Accounting Review" / "Manufacturing & Service Operations
// Management": strip footnote markers, articles, punctuation; unify and/&.

export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\*+|†|‡/g, ' ')           // footnote markers
    .replace(/\(.*?\)/g, ' ')                     // parentheticals
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function journalMatchers(j) {
  const names = [j.ftName || j.name, j.name, ...(j.ftAliases || [])];
  return new Set(names.map(normName).filter(Boolean));
}

// ── fetch the live list ─────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  return { status: res.status, body: await res.text() };
}

// The ft.com page (and the user-visible list) numbers the journals 1..50.
// Accept both plain text and HTML: strip tags first, then read "N. Name".
export function parseNumberedList(text) {
  const plain = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Block-level tags end a line; INLINE tags become a space so a name wrapped
    // in <span>/<b>/<a> mid-title isn't truncated at the tag (which would drop
    // the tail of the journal name and falsely retire it).
    .replace(/<\/?(?:p|div|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|br|hr|section|article|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'");
  const names = [];
  const seen = new Set();
  for (const m of plain.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s*([A-Z][^\n]{3,90})/g)) {
    const n = parseInt(m[1], 10);
    if (n < 1 || n > 50) continue;
    const name = m[2].replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// Wikipedia's FT50 article carries the list as a table/bulleted list of
// wiki-linked journal titles; grab linked titles and validate by overlap
// with the journals we already know (so navigation links don't sneak in).
export function parseWikiList(html, knownNorms) {
  const names = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<a[^>]*title="([^"]{4,90})"[^>]*>/g)) {
    const name = m[1].replace(/\s*\((?:journal|magazine)\)\s*$/i, '').trim();
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  // keep only plausible journal titles: known ones, or ones that share the
  // obvious journal words — Wikipedia pages link far more than the list.
  // Whole words get both boundaries; word STEMS get only a leading boundary
  // (a trailing \b after "econom" would never match "economics"/"econometrica").
  const filtered = names.filter(n => {
    const k = normName(n);
    if (knownNorms.has(k)) return true;
    if (k === 'financial times') return false; // FT itself is linked on the page
    return /\b(journal|review|science|quarterly|research|management|operations|information|policy|annals)\b|\b(econom|market|account|financ|organiz|psycholog|entrepreneur)/.test(k);
  });
  return filtered;
}

// Footnote markers / trailing parentheticals must not survive into a stored
// display name (they are only matching noise). normName strips them for
// comparison; this keeps the human-facing name clean too.
function cleanDisplayName(s) {
  return String(s || '')
    .replace(/[*†‡]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function getLiveList(knownNorms) {
  if (process.env.FT50_LIST_FILE) {
    const text = await readFile(process.env.FT50_LIST_FILE, 'utf8');
    const names = parseNumberedList(text);
    // Apply the same plausibility guard as the network sources so a truncated
    // or wrong file can't silently mass-retire the registry.
    if (names.length < 45 || names.length > 55) {
      console.warn(`FT50_LIST_FILE parsed ${names.length} entries — not a plausible FT50 list`);
      return { names: null, source: null };
    }
    return { names, source: `file:${process.env.FT50_LIST_FILE}` };
  }
  try {
    const r = await fetchText(FT_URL);
    if (r.status === 200) {
      const names = parseNumberedList(r.body);
      if (names.length >= 45 && names.length <= 55) return { names, source: FT_URL };
      console.warn(`ft.com parsed ${names.length} entries — not a plausible FT50 list, trying the fallback`);
    } else {
      console.warn(`ft.com answered HTTP ${r.status} — trying the fallback`);
    }
  } catch (e) {
    console.warn(`ft.com fetch failed (${e.message}) — trying the fallback`);
  }
  try {
    const r = await fetchText(WIKI_URL);
    if (r.status === 200) {
      let names = parseNumberedList(r.body);
      if (names.length < 45) names = parseWikiList(r.body, knownNorms);
      // Wikipedia is ADVISORY only: it links journals merely mentioned in prose
      // (past revisions, see-also), so a diff from it must never be auto-applied
      // to journals.json — main() reports it for manual verification instead.
      if (names.length >= 45 && names.length <= 60) return { names, source: WIKI_URL, advisory: true };
      console.warn(`wikipedia parsed ${names.length} entries — not a plausible FT50 list`);
    }
  } catch (e) {
    console.warn(`wikipedia fetch failed (${e.message})`);
  }
  return { names: null, source: null };
}

// ── Crossref resolution for newly added journals ────────────────────────────

async function resolveJournal(name) {
  const url = `https://api.crossref.org/journals?query=${encodeURIComponent(name)}&rows=8&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await fetch(url, { headers: { 'User-Agent': `ft50-scraper/1.0 (mailto:${MAILTO})` } });
  if (!res.ok) throw new Error(`Crossref /journals HTTP ${res.status}`);
  const j = await res.json();
  const want = normName(name);
  for (const item of j.message?.items || []) {
    if (normName(item.title) !== want) continue;
    const issns = [...new Set(item.ISSN || [])];
    if (!issns.length) continue;
    return {
      issns,
      publisher: item.publisher || '',
      totalDois: item.counts?.['total-dois'] ?? item['counts']?.['total-dois'] ?? null,
    };
  }
  return null;
}

function slugFor(name, taken) {
  const words = normName(name).split(' ').filter(w => !['of', 'the', 'and', 'in', 'for'].includes(w));
  let slug = words.map(w => w[0]).join('');
  if (slug.length < 3) slug = (words[0] || 'j').slice(0, 4);
  slug = slug.slice(0, 6);
  let out = slug, n = 2;
  while (taken.has(out)) out = slug + n++;
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const journals = JSON.parse(await readFile(JOURNALS_PATH, 'utf8'));
  const active = journals.filter(j => !j.retired);
  const knownNorms = new Set(active.flatMap(j => [...journalMatchers(j)]));

  const { names: live, source, advisory } = await getLiveList(knownNorms);
  if (!live) {
    await writeFile(SUMMARY_PATH,
      '## FT50 list check could not run\n\n' +
      `Neither ${FT_URL} nor ${WIKI_URL} yielded a readable 50-journal list ` +
      '(both may be blocking the runner). Please compare the list manually against ' +
      '`lit/_scraper-ft50/journals.json` and update it if the FT changed the list.\n', 'utf8');
    process.exit(2);
  }
  console.log(`live list: ${live.length} journals (from ${source})${advisory ? ' [ADVISORY]' : ''}`);

  const liveNorm = new Map(live.map(n => [normName(n), n]));

  const added = [...liveNorm.keys()].filter(k => ![...active].some(j => journalMatchers(j).has(k)));
  // notFT journals (carried for another list, e.g. UTD24's INFORMS Journal on
  // Computing) are not on the FT's list by design — never retire them from it.
  const removed = active.filter(j => !j.notFT && ![...journalMatchers(j)].some(k => liveNorm.has(k)));

  if (!added.length && !removed.length) {
    console.log('FT50 list unchanged — journals.json is in sync.');
    await writeFile(SUMMARY_PATH, `FT50 list unchanged (checked against ${source}).\n`, 'utf8');
    process.exit(0);
  }

  // The Wikipedia fallback is advisory: it links journals merely mentioned in
  // prose, so a diff from it is reported for manual verification and NEVER
  // auto-applied. (ft.com and a local FT50_LIST_FILE are authoritative.)
  if (advisory) {
    const lines = [
      '## FT50 list may have changed (Wikipedia fallback — NOT auto-applied)',
      '',
      `ft.com could not be read, so the list was checked against ${source}. Wikipedia links` +
      ' journals merely mentioned in prose (past revisions, "see also"), so nothing was changed' +
      ' automatically. Please verify against ft.com/ft50-journals and edit' +
      ' `lit/_scraper-ft50/journals.json` by hand if the FT actually changed the list:',
      '',
    ];
    for (const k of added) lines.push(`- Possibly **added**: ${cleanDisplayName(liveNorm.get(k))}`);
    for (const j of removed) lines.push(`- Possibly **removed**: ${j.name} (\`${j.key}\`)`);
    lines.push('', `Live list (${live.length}): ${live.join(' · ')}`);
    await writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf8');
    console.log('(advisory source — journals.json not written; reported for manual review)');
    process.exit(3);
  }

  const lines = [`## FT50 list changed (checked against ${source})`, ''];
  const taken = new Set(journals.map(j => j.key));
  const today = new Date().toISOString().slice(0, 10);

  for (const j of removed) {
    j.retired = true;
    j.retiredDate = today;
    lines.push(`- **Removed from the FT50 list:** ${j.name} (\`${j.key}\`) — marked retired; ` +
      'the next data build removes its papers file.');
    console.log(`removed: ${j.name}`);
  }

  // A journal FT dropped and later restores must be UN-retired (preserving its
  // curated key, ISSNs, aliases and flags), not re-added under a fresh key.
  const retiredByNorm = new Map();
  for (const j of journals) {
    if (!j.retired) continue;
    for (const m of journalMatchers(j)) retiredByNorm.set(m, j);
  }

  const unresolved = [];
  for (const k of added) {
    const revived = retiredByNorm.get(k);
    if (revived) {
      delete revived.retired;
      delete revived.retiredDate;
      lines.push(`- **Re-added to the FT50 list:** ${revived.name} (\`${revived.key}\`) — un-retired; ` +
        'the next data build restores its papers file.');
      console.log(`re-added: ${revived.name}`);
      continue;
    }
    const displayName = cleanDisplayName(liveNorm.get(k));
    let resolved = null;
    try {
      resolved = await resolveJournal(displayName);
    } catch (e) {
      console.warn(`crossref resolution failed for "${displayName}": ${e.message}`);
    }
    await sleep(500);
    if (!resolved) {
      unresolved.push(displayName);
      lines.push(`- **Added to the FT50 list but NOT auto-added:** ${displayName} — its ISSN could not be ` +
        'resolved via Crossref with confidence. Please add it to `lit/_scraper-ft50/journals.json` manually.');
      console.warn(`added (unresolved): ${displayName}`);
      continue;
    }
    const key = slugFor(displayName, taken);
    taken.add(key);
    // aia (advance-publication stage) is a per-journal editorial fact that
    // can't be inferred here — leave it unset (falsy) and ask the maintainer.
    journals.push({
      key,
      name: displayName,
      short: displayName,
      ftName: displayName,
      issns: resolved.issns,
      publisher: resolved.publisher,
      addedDate: today,
      addedBy: 'check-ft50-list',
    });
    lines.push(`- **Added:** ${displayName} (\`${key}\`, ISSN ${resolved.issns.join(', ')}, ` +
      `${resolved.publisher}${resolved.totalDois ? `, ~${resolved.totalDois} DOIs` : ''}) — ` +
      'auto-added; the next data build pulls its papers. Please sanity-check the ISSNs, and set ' +
      '`"aia": true` in journals.json if the journal has an advance-publication (Articles in Advance / ' +
      'Online First / Early Access) stage.');
    console.log(`added: ${displayName} -> ${key} (${resolved.issns.join(', ')})`);
  }

  lines.push('', 'Reminder: this is `/lit/`\u2019s own FT50 catalog, so added/removed journals ' +
    'flow into its journal filter and FT50 journal-type chip automatically — but a **newly added** ' +
    'journal also needs its ABS/AJG grade in the `ABS_RATING` map (and ideally the static `FT50_KEYS` ' +
    'seed) in `lit/index.html`, or the ABS 4/4* / ABS 3 journal-type options will not include it.');

  lines.push('', `Live list (${live.length}): ${live.join(' · ')}`);
  await writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf8');

  if (!DRY) {
    await writeFile(JOURNALS_PATH, JSON.stringify(journals, null, 2) + '\n', 'utf8');
    console.log('journals.json updated.');
  } else {
    console.log('(dry run — journals.json not written)');
  }
  process.exit(3);
}

main().catch(e => { console.error(e); process.exit(2); });
