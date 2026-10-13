/* One complete catalog snapshot for every page; no paper downloads required. */
(function (root) {
  'use strict';
  var BASES = ['/lit/data/', '/lit/data-ft50/', '/lit-data-abs4/data/', '/lit-data-abs3-omecon/data/', '/lit-data-abs3-rest/data/', '/lit-data-nature/data/', '/lit-data-science/data/'];
  function summarise(catalogs) {
    var counts = Object.create(null), authors = 0, year = Infinity, lastPull = '';
    catalogs.forEach(function (catalog) {
      catalog.sources.forEach(function (source) {
        if (!(source.key in counts) || counts[source.key] === undefined) counts[source.key] = source.count;
        var first = parseInt(source.firstYear, 10);
        if (first > 0 && first < year) year = first;
      });
      var meta = catalog.meta;
      var n = meta.authorCountExtras != null ? meta.authorCountExtras : meta.authorCount;
      if (typeof n === 'number' && n > 0) authors += n;
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.lastPull) && meta.lastPull > lastPull) lastPull = meta.lastPull;
    });
    var papers = Object.keys(counts).reduce(function (total, key) { return total + (Number(counts[key]) || 0); }, 0);
    return { papers: papers, authors: authors, year: year, lastPull: lastPull };
  }
  if (typeof module === 'object' && module.exports) { module.exports = { summarise: summarise, bases: BASES }; return; }
  var total = document.getElementById('litCorpusStat'), range = document.getElementById('litYearRange'), pull = document.getElementById('litLastPull');
  if (!total || !range || !pull) return;
  var KEY = 'lit_catalog_header_v1', ttl = 15 * 60 * 1000;
  function paint(value) {
    if (!value || !(value.papers > 0) || !(value.authors > 0) || !(value.year > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(value.lastPull)) return false;
    // Never replace the bundled snapshot with data older than that snapshot.
    if (value.lastPull < pull.getAttribute('data-snapshot-date')) return false;
    total.textContent = value.papers.toLocaleString('en-US') + ' papers from ' + value.authors.toLocaleString('en-US') + ' authors';
    range.textContent = value.year + '–present';
    pull.textContent = 'Last publication data pull: ' + value.lastPull;
    return true;
  }
  var cached;
  try { cached = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (cached && paint(cached.value) && Date.now() - cached.savedAt < ttl) return;
  if (!root.fetch) return;
  function json(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('Catalog metadata unavailable');
      return response.json();
    });
  }
  Promise.all(BASES.map(function (base) {
    return Promise.all([json(base + 'sources.json'), json(base + 'meta.json')]).then(function (parts) {
      if (!Array.isArray(parts[0]) || !parts[1]) throw new Error('Incomplete catalog metadata');
      return { sources: parts[0], meta: parts[1] };
    });
  })).then(function (catalogs) {
    var value = summarise(catalogs);
    if (paint(value)) { try { localStorage.setItem(KEY, JSON.stringify({ value: value, savedAt: Date.now() })); } catch (e) {} }
  }).catch(function () { /* Keep the last complete snapshot; never display a partial total. */ });
})(typeof window !== 'undefined' ? window : globalThis);
