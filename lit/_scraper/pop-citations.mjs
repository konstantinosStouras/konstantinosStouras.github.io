// Resumable, local-only Publish or Perish importer and daily runner.
// No direct Scholar scraping, cache bypass, proxy rotation, or parallel queries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCAL = path.join(ROOT, '.local-pop');
const OBS = path.join(ROOT, 'data/scholar-citations.json');
const STATE = path.join(LOCAL, 'state.json');
const DAY = 86400000;
const read = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : fallback;
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
export const normalizeDOI = value => String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
export function resultIdentity(row) {
  const doi = normalizeDOI(row.doi);
  const uid = /^GS:(\d+)$/.exec(String(row.uid || ''))?.[1];
  let cluster;
  try {
    const url = new URL(row.cites_url);
    if (url.protocol === 'https:' && url.hostname === 'scholar.google.com' && url.pathname === '/scholar') cluster = url.searchParams.get('cites');
  } catch {}
  if (!uid || !/^\d+$/.test(cluster || '') || uid !== cluster) return { error: 'No consistent Scholar citation link', doi };
  if (!Number.isSafeInteger(row.cites) || row.cites <= 0) return { error: 'Zero or missing count needs browser verification', doi };
  const linkedDOI = String(row.article_url || '').match(/10\.1287\/mnsc\.[\w.-]+/i)?.[0]?.toLowerCase();
  if (linkedDOI && linkedDOI !== doi) return { error: 'Conflicting DOI fields', doi };
  return { doi, cluster };
}

// Read only the date and citation IDs from PoP's HTTP cache. Never log headers/cookies.
export function cacheDates(folder) {
  const dates = {};
  if (!fs.existsSync(folder)) return dates;
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.dat')) continue;
    const body = fs.readFileSync(path.join(folder, name), 'utf8');
    const stamp = /^Date:\s*(.+)$/im.exec(body)?.[1];
    const parsed = Date.parse(stamp);
    if (!Number.isFinite(parsed)) continue;
    const date = new Date(parsed).toISOString().slice(0, 10);
    for (const match of body.matchAll(/<a\b[^>]*href="([^"]*cites=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const cluster = /(?:\?|&(?:amp;)?)cites=(\d+)/.exec(match[1])?.[1];
      const count = /^Cited by\s+([\d,]+)$/.exec(match[2].replace(/<[^>]+>/g, '').trim())?.[1]?.replaceAll(',', '');
      if (!cluster || !count) continue;
      const key = `${cluster}:${Number(count)}`;
      if (!dates[key] || date > dates[key]) dates[key] = date;
    }
  }
  return dates;
}

export function mergeResults(rows, papers, existing, dates, exportName) {
  if (!Array.isArray(rows)) throw new Error('Expected a PoP JSON array');
  const catalog = new Map(papers.map(p => [normalizeDOI(p.DOI), p]));
  const observations = { ...existing }, review = [], accepted = new Set();
  const grouped = new Map();
  for (const row of rows) {
    const identity = resultIdentity(row);
    if (!catalog.has(identity.doi)) { review.push({ title: row.title, doi: identity.doi, reason: 'Not matched to a catalog DOI' }); continue; }
    if (identity.error) { review.push({ title: row.title, doi: identity.doi, reason: identity.error }); continue; }
    const date = dates[`${identity.cluster}:${row.cites}`];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date > new Date().toISOString().slice(0, 10)) {
      review.push({ doi: identity.doi, reason: 'No trustworthy retrieval date' }); continue;
    }
    const group = grouped.get(identity.doi) || [];
    group.push({ row, ...identity, date });
    grouped.set(identity.doi, group);
  }
  let changed = 0;
  for (const [doi, group] of grouped) {
    if (new Set(group.map(r => r.cluster)).size !== 1 || new Set(group.map(r => r.row.cites)).size !== 1) {
      review.push({ doi, reason: 'Conflicting Scholar clusters or counts; manual review required' }); continue;
    }
    const { row, cluster, date } = group[0];
    const old = observations[doi];
    if (old && old.cluster !== cluster) { review.push({ doi, reason: 'Scholar cluster changed; manual review required' }); continue; }
    accepted.add(doi);
    if (old && old.checked >= date) continue; // Do not relabel cached data as newly checked.
    observations[doi] = { title: catalog.get(doi).Title, count: row.cites, checked: date, cluster,
      method: 'publish-or-perish-doi-match', matchedUrl: row.article_url, export: exportName };
    changed++;
  }
  return { observations, review, accepted: [...accepted], changed };
}

export function nextPacing(state, blocked) {
  if (blocked) return { batchResults: Math.max(20, Math.floor(state.batchResults / 2 / 10) * 10), waitSeconds: Math.min(300, state.waitSeconds * 2), cleanRuns: 0 };
  const cleanRuns = (state.cleanRuns || 0) + 1;
  return { batchResults: cleanRuns % 7 === 0 ? Math.min(300, state.batchResults + 50) : state.batchResults, waitSeconds: state.waitSeconds, cleanRuns };
}

function initialState() {
  return { version: 1, year: 2026, phase: 'journal', resultLimit: 0, batchResults: 100,
    waitSeconds: 60, cleanRuns: 0, nextAttemptAt: null, gapAttempts: {}, years: {}, status: 'ready' };
}
const papers = () => read(path.join(ROOT, 'data/papers-ms.json'), []);
const cacheFolder = path.join(LOCAL, 'cache/cache/gscholar');

function importFile(file, state) {
  const output = mergeResults(read(file, null), papers(), read(OBS, {}), cacheDates(cacheFolder), path.basename(file));
  write(OBS, output.observations);
  write(file.replace(/\.json$/, '.review.json'), { importedAt: new Date().toISOString(), changed: output.changed, accepted: output.accepted.length, review: output.review });
  if (state) state.lastImport = { file: path.basename(file), changed: output.changed, matched: output.accepted.length, review: output.review.length };
  console.log(JSON.stringify({ changed: output.changed, matched: output.accepted.length, review: output.review.length }));
  return output;
}

async function query(args, file) {
  const exe = path.join(LOCAL, 'tools/pop8query.exe');
  if (!fs.existsSync(exe)) throw new Error('Official Publish or Perish CLI is missing; see POP-CITATIONS.md');
  fs.mkdirSync(path.join(LOCAL, 'cache/cache'), { recursive: true });
  const log = fs.createWriteStream(file.replace(/\.json$/, '.log'));
  let diagnostics = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(exe, ['--gscholar', '--datadir', path.join(LOCAL, 'cache'), '--format', 'json', ...args, file], { windowsHide: true, cwd: ROOT });
    child.stdout.on('data', data => log.write(data));
    child.stderr.on('data', data => { log.write(data); diagnostics = (diagnostics + data).slice(-24000); });
    child.once('error', reject);
    child.once('close', resolve);
  }).finally(() => log.end());
  return { code, blocked: /captcha|HTTP response status (?:403|429)|unusual traffic|robot|limit exceeded/i.test(diagnostics) };
}

function coverage(state) {
  const rows = papers().filter(p => Number(p.Year) <= 2026);
  const observations = read(OBS, {});
  const byYear = {};
  for (const p of rows) {
    const y = p.Year;
    byYear[y] ||= { total: 0, verified: 0, needsReview: 0 };
    byYear[y].total++;
    if (observations[normalizeDOI(p.DOI)]) byYear[y].verified++;
    else if (state.gapAttempts[normalizeDOI(p.DOI)]) byYear[y].needsReview++;
  }
  return { status: state.status, currentYear: state.year, phase: state.phase, nextAttemptAt: state.nextAttemptAt,
    batchResults: state.batchResults, waitSeconds: state.waitSeconds, lastImport: state.lastImport, byYear };
}

async function run() {
  fs.mkdirSync(LOCAL, { recursive: true });
  const lock = path.join(LOCAL, 'run.lock');
  if (fs.existsSync(lock)) throw new Error('A run lock exists. Check the recorded process before removing a stale lock.');
  const handle = fs.openSync(lock, 'wx');
  fs.writeFileSync(handle, String(process.pid)); fs.closeSync(handle);
  try {
    const state = read(STATE, initialState());
    if (state.nextAttemptAt && Date.now() < Date.parse(state.nextAttemptAt)) {
      console.log(JSON.stringify({ status: 'cooldown', nextAttemptAt: state.nextAttemptAt })); return;
    }
    const rows = papers().filter(p => Number(p.Year) <= 2026);
    const minYear = Math.min(...rows.map(p => Number(p.Year)).filter(Number.isFinite));
    if (state.year < minYear) {
      state.status = 'sweep-finished-review-required'; write(STATE, state); write(path.join(LOCAL, 'coverage.json'), coverage(state));
      console.log(state.status); return;
    }
    // Persist the daily limit before any network operation, including failures.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(0, 0, 0, 0);
    state.nextAttemptAt = tomorrow.toISOString();
    state.status = 'running'; write(STATE, state);
    const observations = read(OBS, {});
    const yearRows = rows.filter(p => Number(p.Year) === state.year);
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const requests = [];
    if (state.phase === 'journal') {
      const limit = Math.min(1000, state.resultLimit + state.batchResults);
      requests.push({ key: 'journal', args: ['--journal', '"Management Science"', '--years', `${state.year}-${state.year}`, '--max', String(limit)], limit });
    } else {
      const gaps = yearRows.filter(p => !observations[normalizeDOI(p.DOI)] && !state.gapAttempts[normalizeDOI(p.DOI)]).slice(0, Math.max(2, Math.floor(state.batchResults / 10)));
      for (const p of gaps) requests.push({ key: normalizeDOI(p.DOI), args: ['--title', '"' + p.Title.replaceAll('"', '') + '"', '--max', '10'] });
      if (!requests.length) { state.years[state.year] = { bulkAndTitlePassFinished: true }; state.year--; state.phase = 'journal'; state.resultLimit = 0; }
    }
    let failed = false;
    for (let i = 0; i < requests.length; i++) {
      if (i) await new Promise(resolve => setTimeout(resolve, state.waitSeconds * 1000));
      const req = requests[i];
      const file = path.join(LOCAL, 'exports', `${runId}-${state.year}-${i}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const result = await query([...req.args, '--wait', String(state.waitSeconds), '--maxage', '2160'], file);
      if (result.blocked || ![0, 4].includes(result.code)) {
        failed = true;
        // PoP can save verified partial results even when a later page fails.
        if (fs.existsSync(file)) {
          try { importFile(file, state); }
          catch (error) { console.warn(`Partial export was not imported: ${error.message}`); }
        }
        if (result.blocked) Object.assign(state, nextPacing(state, true));
        else { state.cleanRuns = 0; state.batchResults = Math.max(20, Math.floor(state.batchResults / 2 / 10) * 10); }
        state.nextAttemptAt = new Date(Date.now() + (result.blocked ? 2 : 1) * DAY).toISOString();
        state.status = result.blocked ? 'captcha-or-rate-limit' : 'query-failed';
        state.failedExport = path.basename(file); state.exitCode = result.code;
        break; // Do not retry or advance the cursor on a block/error.
      }
      if (result.code === 0) importFile(file, state);
      if (req.key === 'journal') {
        const count = result.code === 4 ? 0 : read(file, []).length;
        state.resultLimit = req.limit;
        if (count < req.limit || req.limit === 1000) state.phase = 'gaps';
      } else state.gapAttempts[req.key] = { at: runId, outcome: read(OBS, {})[req.key] ? 'matched' : 'manual-review', export: path.basename(file) };
      write(STATE, state);
    }
    if (!failed) { if (requests.length) Object.assign(state, nextPacing(state, false)); state.status = 'ready'; }
    // Fixed daily scheduling remains usable even if today's work took an hour.
    write(STATE, state); write(path.join(LOCAL, 'coverage.json'), coverage(state));
    console.log(JSON.stringify({ status: state.status, year: state.year, phase: state.phase, nextAttemptAt: state.nextAttemptAt }));
  } finally { fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'status', argument] = process.argv.slice(2);
  try {
    if (command === 'run') await run();
    else if (command === 'import' && argument) importFile(path.resolve(argument));
    else if (command === 'status') console.log(JSON.stringify(coverage(read(STATE, initialState())), null, 2));
    else throw new Error('Usage: node _scraper/pop-citations.mjs [run|status|import export.json]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
