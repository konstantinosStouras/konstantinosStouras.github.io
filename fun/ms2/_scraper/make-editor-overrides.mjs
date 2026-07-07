/*
 * make-editor-overrides.mjs — one-time import of the ms Google Sheet's
 * hand-collected editor/area data.
 * ===========================================================================
 * The Sheets pipeline behind stouras.com/fun/ms/ accumulated accepting-editor
 * names (and areas) from sources that do not exist on Crossref: scraping the
 * INFORMS article pages and a manually curated mnsc_articles_editors tab.
 * Crossref abstracts carry the "This paper was accepted by …" sentence for
 * most 2011+ papers, but several hundred have the editor only in the sheet.
 *
 * This script reads a CSV export of the sheet's Data tab and writes
 * editor-overrides.json (DOI → { editor, area }), which build-data.mjs merges
 * whenever Crossref itself yields no editor. Run it again only if the sheet
 * gains more hand-collected editors before it is retired:
 *
 *   curl -L 'https://docs.google.com/spreadsheets/d/11MKt6uzfnxTNTbK4Kb1jwW32cEsKZcBRncubV2omJzQ/gviz/tq?tqx=out:csv&sheet=Data' -o Data.csv
 *   node make-editor-overrides.mjs Data.csv
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || resolve(__dirname, '_sheet-snapshot', 'Data.csv');
const out = resolve(__dirname, 'editor-overrides.json');

// Minimal CSV parser (handles quoted fields, doubled quotes, newlines in quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const rows = parseCsv(await readFile(src, 'utf8'));
const header = rows[0].map(h => h.trim());
const iDoi = header.indexOf('DOI');
const iEd = header.indexOf('Accepting Editor');
const iArea = header.indexOf('Area');
if (iDoi === -1 || iEd === -1) throw new Error('Data.csv missing DOI / Accepting Editor columns');

const overrides = {};
let withEditor = 0;
for (const r of rows.slice(1)) {
  const doi = (r[iDoi] || '').trim().toLowerCase().replace('https://doi.org/', '');
  const editor = (r[iEd] || '').replace(/\s+/g, ' ').trim();
  const area = iArea !== -1 ? (r[iArea] || '').replace(/\s+/g, ' ').trim() : '';
  if (!doi || !editor) continue;
  overrides[doi] = area ? { editor, area } : { editor };
  withEditor++;
}

// Deterministic key order so rebuilds don't churn the file.
const sorted = {};
for (const k of Object.keys(overrides).sort()) sorted[k] = overrides[k];
await writeFile(out, JSON.stringify(sorted), 'utf8');
console.log(`editor-overrides.json: ${withEditor} DOIs with sheet-collected editors (from ${rows.length - 1} rows)`);
