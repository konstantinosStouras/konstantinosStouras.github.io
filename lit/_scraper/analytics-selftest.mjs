import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { topByYear, readAnalyticsInput, analyticsSnapshot } from './_analytics-inputs.mjs';
import { isNonArticle } from './_nonarticle.mjs';
const lit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
function check(label, fn) { fn(); count++; console.log('ok ' + label); }
const html = fs.readFileSync(path.join(lit, 'analytics/index.html'), 'utf8');
const start = html.indexOf('(function () {', html.indexOf('<script'));
const stop = html.indexOf("  fetch('./data.json')", start);
assert(start >= 0 && stop > start);
const nodes = {};
const node = id => nodes[id] ||= { innerHTML: '', textContent: '', style: {}, querySelectorAll: () => [], setAttribute() {} };
const context = { document: { getElementById: node, querySelectorAll: () => [] }, window: {}, console, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
vm.createContext(context);
vm.runInContext(html.slice(start, stop) + `
window.test = { S, pctRankSorted, authorProjection, authorJYStats, renderCited, drawAuthor, drawCompare,
  init:function(data, rankings) { DATA=data; YEAR_LO=2020; YEAR_HI=2026; data.journals.forEach(j=>JMAP[j.key]=j); RANKINGS=rankings; rankingsState='ready'; DISR={papers:[],authors:[]}; disrState='ready'; },
  capture:function(fn) { barsV=function(items){fn('years',items);return '';}; barsH=function(items){fn('journals',items);return '';}; lineChart=function(series){fn('series',series);return '';}; }
};})();`, context);
const page = context.window.test;
const research = Array.from({ length: 20 }, (_, k) => ({ t: 'Research ' + k, d: 'https://doi.org/10.1/' + k, y: 2025, c: 100 - k, x: 0 }));
const nonResearch = Array.from({ length: 20 }, (_, k) => ({ t: 'Editorial ' + k, d: 'https://doi.org/10.2/' + k, y: 2025, c: 200 - k, x: 1 }));
const old = Array.from({ length: 20 }, (_, k) => ({ t: 'Old ' + k, d: 'https://doi.org/10.3/' + k, y: 1989, c: 1000 - k }));
const years = topByYear([...old, ...research, ...nonResearch]);
page.init({ journals: [{ key: 'a', name: 'Journal A', types: [] }, { key: 'b', name: 'Journal B', types: [] }] }, { journals: { a: { years, dims: { area: { Finance: topByYear(research) } } }, b: { years: {} } } });
page.S.journals = { a: true }; page.S.yMin = 2025; page.S.yMax = 2025;
check('year-filtered ranking includes recent papers even when all-time leaders are older', () => {
  page.renderCited(['a']); assert(nodes.citedTable.innerHTML.includes('Research 0')); assert(!nodes.citedTable.innerHTML.includes('Old 0')); assert.equal((nodes.citedTable.innerHTML.match(/<tr>/g) || []).length, 16);
});
check('non-research toggle has its own complete ranking candidates', () => {
  page.S.excludeNonResearch = false; page.renderCited(['a']); assert(nodes.citedTable.innerHTML.includes('Editorial 0')); assert(!nodes.citedTable.innerHTML.includes('Research 0'));
  page.S.excludeNonResearch = true;
});
check('editorial rankings retain 15 candidates for every selected year', () => {
  page.S.dim = { name: 'area', vals: { Finance: true } }; page.renderCited(['a']); assert.equal((nodes.citedTable.innerHTML.match(/<tr>/g) || []).length, 16); page.S.dim = { name: null, vals: {} };
});
check('midrank percentiles handle ties and average exactly 50', () => {
  const population = [-1, 0, 0, 0, 1]; const ranks = population.map(v => page.pctRankSorted(population, v)); assert.equal(JSON.stringify(ranks), JSON.stringify([10, 50, 50, 50, 90])); assert.equal(ranks.reduce((s, n) => s + n, 0) / ranks.length, 50); assert.equal(page.pctRankSorted([0, 0], 0), 50);
});
const author = { n: 'Fixture Author', p: 7, jy: { a: { 2024: [2, 2, 10, 20], 2025: [3, 6, 30, 60] }, b: { 2025: [4, 8, 40, 80] } }, xjy: { a: { 2025: [2, 4, 20, 40] } }, y: { 2024: 2, 2025: 7 }, j: { a: 5, b: 4 } };
check('author metrics use the intersection of journals, years and research setting', () => {
  assert.equal(page.authorProjection(author, true).n, 1); assert.equal(page.authorJYStats(author, true).c, 10);
  page.S.excludeNonResearch = false; assert.equal(page.authorProjection(author, true).n, 3); page.S.excludeNonResearch = true;
});
check('single-author timeline and journal bars use that same intersection', () => {
  let captured = []; page.capture((kind, values) => captured.push({ kind, values })); page.drawAuthor(author);
  assert.equal(captured.find(x => x.kind === 'years').values.reduce((n, x) => n + x.value, 0), 1);
  assert.equal(captured.find(x => x.kind === 'journals').values[0].value, 1);
});
check('comparison timeline and matrix use filtered cells', () => {
  let captured = []; page.capture((kind, values) => captured.push({ kind, values })); page.drawCompare([author, author]);
  assert.equal(captured.find(x => x.kind === 'series').values[0].pts.reduce((n, x) => n + x[1], 0), 1);
  assert(!nodes.authorBody.innerHTML.includes('Journal B'));
});
check('metric labels describe lifetime cohorts and authors including the focal author', () => {
  assert(html.includes('Lifetime citations by publication year')); assert(html.includes('Average authors per paper')); assert(!html.includes('<h3>Citations over time</h3>'));
});

if (process.argv.includes('--data')) {
  const json = name => JSON.parse(fs.readFileSync(path.join(lit, 'analytics', name), 'utf8'));
  const data = json('data.json'), authors = json('authors.json'), rankings = json('rankings.json'), disruption = json('disruption.json'), flow = json('citeflow.json');
  check('all bibliographic outputs identify the same input snapshot', () => {
    assert.equal(data.snapshot.sha256, authors.snapshot.sha256); assert.equal(data.snapshot.sha256, rankings.snapshot.sha256);
  });
  const shardRoot = process.env.LIT_SHARDS_DIR || path.resolve(lit, '../_analytics-shards');
  const datasets = [path.join(lit, 'data'), path.join(lit, 'data-ft50'), ...['lit-data-abs4', 'lit-data-abs3-omecon', 'lit-data-abs3-rest', 'lit-data-nature', 'lit-data-science'].map(repo => path.join(shardRoot, repo, 'data'))];
  const journals = new Map(); let total = 0;
  for (const dir of datasets) {
    const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
    for (const source of sources) {
      if (journals.has(source.key) || !source.count) continue;
      const rows = (source.files || [source.file]).flatMap(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      assert.equal(rows.length, source.count, 'Manifest count: ' + source.key); journals.set(source.key, rows); total += rows.length;
    }
  }
  check('all seven data sources and every manifest record are represented', () => { assert.equal(data.totals.papers, total); assert.equal(data.journals.length, journals.size); });
  check('all journal-year aggregates match the source paper records', () => {
    for (const journal of data.journals) {
      const years = {};
      for (const paper of journals.get(journal.key)) {
        const y = parseInt(paper.Year, 10); if (!Number.isFinite(y) || y < 1850 || y > 2100) continue;
        const team = String(paper.Authors || '').split(',').map(s => s.trim()).filter(Boolean).length;
        const bump = r => { r.n++; r.a += team; r.s += team === 1 ? 1 : 0; r.p += paper.Preprint ? 1 : 0; r.ab += paper.Abstract ? 1 : 0; r.c += typeof paper.CitedBy === 'number' && paper.CitedBy > 0 ? paper.CitedBy : 0; if (team) r.t[Math.min(team, 6) - 1]++; };
        const empty = () => ({ n: 0, a: 0, s: 0, p: 0, ab: 0, c: 0, t: [0, 0, 0, 0, 0, 0] });
        const row = years[y] ||= empty(); bump(row); if (isNonArticle(paper.Title)) bump(row.x ||= empty());
      }
      for (const [year, row] of Object.entries(years)) for (const key of ['n', 'a', 's', 'p', 'ab', 'c', 't']) {
        assert.deepEqual(journal.years[year][key], row[key], journal.key + '/' + year + '/' + key);
        if (row.x) assert.deepEqual(journal.years[year].x[key], row.x[key]);
      }
    }
  });
  check('recent-year rankings match the true top 15 for every journal and research setting', () => {
    for (const [key, papers] of journals) for (const year of [2025, 2026]) for (const researchOnly of [true, false]) {
      const expected = papers.filter(p => parseInt(p.Year, 10) === year && p.CitedBy > 0 && !(researchOnly && isNonArticle(p.Title))).map(p => p.CitedBy).sort((a, b) => b - a).slice(0, 15);
      const actual = (rankings.journals[key].years[year] || []).filter(p => !(researchOnly && p.x)).map(p => p.c).sort((a, b) => b - a).slice(0, 15);
      assert.deepEqual(actual, expected, key + '/' + year + '/' + researchOnly);
    }
    page.init(data, rankings); page.S.journals = { ejor: true }; page.S.yMin = 2025; page.S.yMax = 2025; page.S.excludeNonResearch = true;
    page.renderCited(['ejor']); assert(nodes.citedTable.innerHTML.includes('10.1016/j.ejor.2024.03.020'));
  });
  check('all three derived snapshots match the current input bytes', () => {
    for (const snapshot of [data.snapshot, disruption.snapshot, flow.snapshot]) {
      for (const [file, hash] of Object.entries(snapshot.files)) {
        const filename = file.startsWith('lit/') ? path.join(lit, file.slice(4)) : path.join(shardRoot, file);
        readAnalyticsInput(filename); assert.equal(analyticsSnapshot().files[file], hash, file);
      }
    }
  });
  check('citation-flow directions preserve the same complete edge total', () => {
    const sum = map => Object.values(map).reduce((n, partners) => n + Object.values(partners).reduce((s, years) => s + Object.values(years).reduce((t, v) => t + v, 0), 0), 0);
    assert.equal(sum(flow.out), flow.totals.edges); assert.equal(sum(flow.in), flow.totals.edges);
  });
}
console.log(count + ' analytics checks passed.');
