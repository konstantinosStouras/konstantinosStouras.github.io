// Shared, network-free rules for incremental editorial enrichment.
import { parseInformsEditors, healEditorNames } from './informs-editors.mjs';
import { isNonArticle } from './_nonarticle.mjs';

export const editorialDoi = value => String(value || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
export function completeEditors(record, associate = false) {
  return Boolean(record?.se && (!associate || record?.ae));
}
export function refreshDue(record, associate, now = Date.now(), field = 'checkedAt', days = 7) {
  if (completeEditors(record, associate)) return false;
  const checked = Date.parse(record?.[field]);
  return !Number.isFinite(checked) || now - checked >= days * 86400000;
}

// Fill individual roles: an ISR senior-only record must not discard a newly
// discovered associate editor, and a later miss must never erase known names.
export function mergeEditors(current = {}, incoming = {}) {
  const merged = { ...current, ...incoming };
  merged.se = healEditorNames(current.se) || healEditorNames(incoming.se) || '';
  merged.ae = healEditorNames(current.ae) || healEditorNames(incoming.ae) || '';
  for (const field of ['checkedAt', 'crossrefCheckedAt']) {
    if (current[field] && (!incoming[field] || current[field] > incoming[field])) merged[field] = current[field];
  }
  if (merged.se || merged.ae) delete merged.none;
  else merged.none = true;
  return merged;
}

export function editorsFromCrossref(work, associate = false) {
  if (isNonArticle(work.title?.[0] || '')) return {};
  let found = parseInformsEditors(work.abstract || '');
  for (const assertion of work.assertion || []) {
    const label = String(assertion.label || assertion.name || '').toLowerCase();
    // History assertions can carry roles even when their label is not "editor".
    if (!/editor|history/.test(label)) continue;
    const value = String(assertion.value || '').replace(/<[^>]+>/g, ' ').trim();
    const parsed = parseInformsEditors(value);
    if (!parsed.se && !parsed.ae) {
      if (/senior/.test(label)) parsed.se = parseInformsEditors(`${value}, Senior Editor.`).se;
      else if (/associate/.test(label)) parsed.ae = parseInformsEditors(`${value}, Associate Editor.`).ae;
    }
    found = mergeEditors(found, parsed);
  }
  return { se: healEditorNames(found.se) || '', ae: associate ? healEditorNames(found.ae) || '' : '' };
}

// Apply to both complete journal files and recent feeds. Restrict by DOI
// journal, since aggregated feeds contain unrelated journals too.
export function applyEditors(rows, cache) {
  let changed = 0;
  for (const row of rows) {
    const doi = editorialDoi(row.DOI);
    const journal = /^10\.1287\/(isre|mksc)\./.exec(doi)?.[1];
    if (!journal) continue;
    for (const [field, key] of [['Senior Editor', 'se'], ...(journal === 'isre' ? [['Associate Editor', 'ae']] : [])]) {
      const value = isNonArticle(row.Title) ? '' : healEditorNames(row[field]) || healEditorNames(cache[doi]?.[key]) || '';
      if ((row[field] || '') !== value) { row[field] = value; changed++; }
    }
  }
  return changed;
}
