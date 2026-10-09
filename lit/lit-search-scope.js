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
// Compile each query once, and normalize only the fields it actually searches.
// Cache source text alongside its normalized value so later metadata edits are safe.
var litSearchOrder = null;
function litSearchText(p, field) {
  var cache = p._litSearch;
  if (!cache) cache = p._litSearch = {};
  var source = p[field] || '';
  if (!cache[field] || cache[field].source !== source) {
    cache[field] = { source: source, lower: source.toLowerCase() };
  }
  return cache[field];
}
function litCompileTerm(query, author) {
  if (!query) return function () { return true; };
  var quoted = query.match(/^"(.*)"$/);
  if (quoted) {
    var phrase = quoted[1].trim();
    if (!phrase) return function () { return true; };
    var re = new RegExp('\\b' + escRegex(phrase) + '\\b');
    return function (text) { return re.test(text.lower); };
  }
  // A leading quote without a closing quote retains textMatch's substring rule.
  if (!author || query.charAt(0) === '"') {
    return function (text) { return text.lower.indexOf(query) !== -1; };
  }
  query = nameFold(query);
  return function (text) {
    if (text.folded === undefined) text.folded = nameFold(text.lower);
    var idx = 0;
    while ((idx = text.folded.indexOf(query, idx)) !== -1) {
      if (!idx || !/[a-zà-ɏ]/i.test(text.folded.charAt(idx - 1))) return true;
      idx++;
    }
    return false;
  };
}
function litCompileSearch() {
  var fields = [ ['Title', 'title', 'filterSearch'], ['Authors', 'author', 'filterAuthors'],
    ['Affiliations', 'affiliation', 'filterAffiliations'], ['Abstract', 'abstract', 'filterAbstracts'] ];
  var tests = [];
  fields.forEach(function (f) {
    var terms = Array.from(sel[f[1]]);
    var live = document.getElementById(f[2]).value.trim().toLowerCase();
    if (live) terms.push(live);
    if (!terms.length) return;
    var matchers = terms.map(function (q) { return litCompileTerm(q, f[1] === 'author'); });
    var rawMatchers = f[1] === 'abstract' ? terms.map(function (q) {
      var quoted = q.match(/^"(.*)"$/);
      var needle = quoted ? quoted[1].trim() : q;
      // Removing a trailer can create a word boundary at the new end.
      // Raw text is only a substring pre-check, even for quoted queries.
      return function (text) { return text.lower.indexOf(needle) !== -1; };
    }) : matchers;
    tests.push(function (p) {
      var cachedAbstract = f[1] === 'abstract' && p._absq !== undefined;
      var text = cachedAbstract
        ? { lower: p._absq } : litSearchText(p, f[0]);
      // Cleaning only removes text. Reject raw-text misses before running the
      // cleaner, then verify against the exact abstract shown on the card.
      var initialMatchers = cachedAbstract ? matchers : rawMatchers;
      for (var i = 0; i < initialMatchers.length; i++) if (!initialMatchers[i](text)) return false;
      if (f[1] === 'abstract' && p._absq === undefined) {
        var shown = { lower: absSearchText(p) };
        p._litSearch.Abstract = undefined; // keep only the cleaned search text
        for (var j = 0; j < matchers.length; j++) if (!matchers[j](shown)) return false;
      }
      return true;
    });
  });
  var identities = Object.keys(sel.authorIdentity).map(function (label) {
    return new Set(sel.authorIdentity[label].map(function (v) { return nameFold(v).trim(); }));
  });
  return function (p) {
    if (preprintOnly && !safeUrl(p.Preprint)) return false;
    if (citedByFilter && !citedByFilter.dois.has(p._bdoi || (p._bdoi = refsNormDoi(p.DOI)))) return false;
    for (var i = 0; i < tests.length; i++) if (!tests[i](p)) return false;
    if (identities.length) {
      var text = litSearchText(p, 'Authors');
      if (!text.names) text.names = nameFold(text.lower).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      for (var j = 0; j < identities.length; j++) {
        if (!text.names.some(function (n) { return identities[j].has(n); })) return false;
      }
    }
    return true;
  };
}

// Results and all five cascading facets share one pass. A facet ignores only
// its own selection: a row failing two dimensions cannot contribute anywhere.
function litCollectSearch(includeOtherJournals) {
  var drop = document.querySelector('#csJournal .custom-select-dropdown');
  var journals = !journalScope || includeOtherJournals || (drop && drop.classList.contains('open'));
  var basis = journals ? allPapers : litPapersInScope();
  var sort = document.getElementById('sortBy').value;
  var ordered = litSearchOrder && litSearchOrder.basis === basis && litSearchOrder.sort === sort;
  var rows = ordered ? litSearchOrder.rows : basis;
  var common = litCompileSearch();
  var out = { basis: basis, sort: sort, ordered: !!ordered, rows: [], scope: 0, journal: journals ? Object.create(null) : null,
    editor: Object.create(null), area: Object.create(null), se: Object.create(null),
    ae: Object.create(null), year: Object.create(null) };
  function count(counts, value) { if (value) counts[value] = (counts[value] || 0) + 1; }
  function countNames(counts, values) { (values || []).forEach(function (v) { count(counts, v); }); }
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i], inScope = !journals || matchesJournal(p);
    if (inScope) out.scope++;
    var failed = 0;
    if (sel.editor.size && !(p._editors || []).some(function (v) { return sel.editor.has(v); })) failed |= 1;
    if (sel.area.size && !sel.area.has(p._area)) failed |= 2;
    if (sel.se.size && !(p._se || []).some(function (v) { return sel.se.has(v); })) failed |= 4;
    if (sel.ae.size && !(p._ae || []).some(function (v) { return sel.ae.has(v); })) failed |= 8;
    if (sel.year.size && !sel.year.has(p.Year)) failed |= 16;
    if ((!inScope && (!journals || failed)) || (failed && (failed & (failed - 1)))) continue;
    if (!common(p)) continue;
    if (!failed && journals) countNames(out.journal, p._jkeys);
    if (!inScope) continue;
    if (!failed) out.rows.push(p);
    if (!(failed & ~1)) countNames(out.editor, p._editors);
    if (!(failed & ~2)) count(out.area, p._area);
    if (!(failed & ~4)) countNames(out.se, p._se);
    if (!(failed & ~8)) countNames(out.ae, p._ae);
    if (!(failed & ~16)) count(out.year, p.Year);
  }
  return out;
}

// Browsing an entire scope already sorts every row. Reuse that ordering for
// subsequent searches within it; filtering a sorted array preserves its order.
// Retain only one ordering, and invalidate when rows arrive or the sort changes.
function litRememberSearchOrder(result) {
  if (result.rows.length === result.basis.length) {
    litSearchOrder = { basis: result.basis, sort: result.sort, rows: result.rows };
  } else if (litSearchOrder && (litSearchOrder.basis !== result.basis || litSearchOrder.sort !== result.sort)) {
    litSearchOrder = null;
  }
}
