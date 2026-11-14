// Delivery must not advance past a missing feed or a capped recent.json.
import fs from 'node:fs/promises';
import path from 'node:path';
export function addedDate(value) {
  if (!value) return null;
  const s = String(value), date = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s);
  return isNaN(date) ? null : date;
}
function rows(value, label) {
  if (!Array.isArray(value)) throw new Error('Invalid paper/manifest array: ' + label);
  return value;
}
export async function fetchDatasetJson(url, optional = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`Alert data unavailable: ${url} (${response.status})`);
      return await response.json();
    } catch (error) {
      // Tallies are an optimization only: without one we read full journal
      // files. A missing required manifest/recent file must never look empty.
      if (optional) return null;
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
    }
  }
}
export async function loadAlertDatasets(specs) {
  return Promise.all(specs.map(async spec => {
    async function read(file, optional = false) {
      if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(file) || file.includes('..')) throw new Error('Invalid data filename');
      if (spec.url) return fetchDatasetJson(spec.url + file, optional);
      try { return JSON.parse(await fs.readFile(path.join(spec.dir, file), 'utf8')); }
      catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    }
    const [sources, recent, tally] = await Promise.all([read('sources.json'), read('recent.json'), read('recent-counts.json', true)]);
    if (tally && (!tally.days || typeof tally.days !== 'object')) throw new Error('Invalid recent tally: ' + spec.ds);
    return {...spec, sources:rows(sources, spec.ds), recent:rows(recent, spec.ds), tally, read};
  }));
}
export function mergeRecentDatasets(datasets) {
  const seen = new Set(), result = [];
  for (const dataset of datasets) for (const row of dataset.recent) {
    const date = addedDate(row['Date Added']);
    if (!date) continue;
    const key = String(row.DOI || row.Title + '|' + row.Year).trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    if (seen.has(key)) continue;
    seen.add(key); result.push({...row, _added:date, _ds:dataset.ds});
  }
  return result.sort((a,b) => b._added - a._added);
}
// Only fill the gaps for journals and windows an enabled, due alert needs.
// Native data wins over duplicate INFORMS journals in the FT50 catalogue.
export async function ensureAlertCoverage(datasets, windows, now) {
  const nativeKeys = new Set((datasets.find(d => d.ds === 'native')?.sources || []).map(s => s.key));
  for (const dataset of datasets) {
    for (const source of dataset.sources) {
      if (dataset.ds !== 'native' && nativeKeys.has(source.key)) continue;
      const keys = [source.key, ...(source.sections || []).map(s => s.key)];
      const relevant = windows.filter(w => !w.scope || keys.some(key => w.scope.has(key)));
      if (!relevant.length) continue;
      const start = new Date(Math.min(...relevant.map(w => w.start.getTime())));
      const inWindow = p => p.JKey === source.key && addedDate(p['Date Added']) > start && addedDate(p['Date Added']) <= now;
      const seen = dataset.recent.filter(inWindow).length;
      let expected = null;
      if (dataset.tally && dataset.tally.windowDays * 86400000 >= now - start) {
        expected = 0;
        for (const [key, perDay] of Object.entries(dataset.tally.days)) {
          if (key.split('|')[0] !== source.key) continue;
          for (const [day, count] of Object.entries(perDay)) if (addedDate(day) > start && addedDate(day) <= now) expected += count;
        }
      }
      if (expected !== null && expected <= seen) continue;
      const files = source.files?.length ? source.files : [source.file];
      if (!files.length || files.some(f => !f)) throw new Error('Missing source files: ' + source.key);
      const complete = [];
      for (const file of files) for (const p of rows(await dataset.read(file), file)) if (inWindow(p)) complete.push(p);
      if (expected !== null && complete.length < expected) throw new Error('Incomplete alert data for ' + source.key + ': retry after its data refresh');
      dataset.recent = dataset.recent.filter(p => p.JKey !== source.key).concat(complete);
    }
  }
  return mergeRecentDatasets(datasets);
}
