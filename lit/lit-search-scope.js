// Index loaded papers once, then search only the selected journal buckets.
var litJournalPapers = new Map(), litIndexedPaperCount = 0;
var litIndexedPapersRef = null;
var litScopeCacheKey = '', litScopeCacheRows = null;
var litPaperLoads = Object.create(null);

function litIndexPaperBatch(rows) {
  rows.forEach(function (p) {
    (p._jkeys || []).forEach(function (key) {
      if (!litJournalPapers.has(key)) litJournalPapers.set(key, []);
      litJournalPapers.get(key).push(p);
    });
  });
  litIndexedPaperCount += rows.length;
  litIndexedPapersRef = allPapers;
  litScopeCacheRows = null;
}

function litPapersInScope() {
  if (!journalScope) return allPapers;
  // Also handle data inserted by future consumers outside the usual loaders.
  if (litIndexedPapersRef !== allPapers || litIndexedPaperCount !== allPapers.length) {
    litJournalPapers.clear(); litIndexedPaperCount = 0;
    litIndexPaperBatch(allPapers);
  }
  var keys = Array.from(journalScope).sort();
  var signature = JSON.stringify(keys);
  if (litScopeCacheRows && signature === litScopeCacheKey) return litScopeCacheRows;
  var seen = new Set(), rows = [];
  keys.forEach(function (key) {
    (litJournalPapers.get(key) || []).forEach(function (p) {
      if (!seen.has(p)) { seen.add(p); rows.push(p); }
    });
  });
  litScopeCacheKey = signature; litScopeCacheRows = rows;
  return rows;
}

function litBeginPaperLoad(key, searchOnly) {
  var load = { controller: new AbortController(), searchOnly: !!searchOnly };
  litPaperLoads[key] = load;
  return load;
}
function litRetainPaperLoad(key, searchOnly) {
  // A preference picker or another explicit consumer may need this file even
  // when it is outside the current search, so do not cancel its download.
  if (!searchOnly && litPaperLoads[key]) litPaperLoads[key].searchOnly = false;
}
function litFinishPaperLoad(key, load) {
  if (litPaperLoads[key] === load) delete litPaperLoads[key];
}
function litCancelUnusedPaperLoads(required) {
  Object.keys(litPaperLoads).forEach(function (key) {
    var load = litPaperLoads[key];
    if (load.searchOnly && !required.has(key)) load.controller.abort();
  });
}
