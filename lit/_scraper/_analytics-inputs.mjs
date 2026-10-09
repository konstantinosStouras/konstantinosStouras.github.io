// Fail closed on missing input files and identify the exact dataset behind a build.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const inputs = new Map();
let latestDate = '';
function inputKey(file) {
  const path = file.replace(/\\/g, '/');
  const shard = path.match(/\/(lit-data-[^/]+)\/(data\/.*)$/);
  if (shard) return shard[1] + '/' + shard[2];
  const offset = path.lastIndexOf('/lit/');
  return offset >= 0 ? path.slice(offset + 1) : path.split('/').pop();
}
export function readAnalyticsInput(file) {
  const bytes = fs.readFileSync(file);
  const value = JSON.parse(bytes.toString('utf8'));
  inputs.set(inputKey(file), createHash('sha256').update(bytes).digest('hex'));
  const date = value.lastPull || value.generated;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) && date.slice(0, 10) > latestDate) latestDate = date.slice(0, 10);
  return value;
}
export function analyticsSnapshot() {
  const files = Object.fromEntries([...inputs.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
export function latestAnalyticsDate() { return latestDate; }

// Fifteen candidates from EACH year and research class suffice for the true
// top 15 under any union of journals/years and either non-research setting.
export function topByYear(papers) {
  const buckets = {};
  for (const paper of papers) {
    if (paper.y == null || paper.y === '' || !(paper.c > 0)) continue;
    const key = paper.y + '|' + (paper.x ? 1 : 0);
    (buckets[key] ||= []).push(paper);
  }
  const years = {};
  for (const [key, rows] of Object.entries(buckets)) {
    rows.sort((a, b) => b.c - a.c || String(a.d).localeCompare(String(b.d)));
    const year = key.split('|')[0];
    (years[year] ||= []).push(...rows.slice(0, 15));
  }
  return years;
}
