// Share the public paper search through the address bar. No account/library data.
var litUrlSets = {
  jtype: 'jtype', journal: 'journal', year: 'year', editor: 'editor',
  area: 'area', se: 'se', ae: 'ae', title: 'title', author: 'author-text',
  affiliation: 'affiliation', abstract: 'abstract'
};
var litUrlInputs = {
  'title-search': 'filterSearch', 'author-search': 'filterAuthors',
  'affiliation-search': 'filterAffiliations', 'abstract-search': 'filterAbstracts'
};
// Recognize and strip the retired `filters` marker from previously shared links.
var litUrlSpecial = ['filters', 'author', 'author-variants', 'preprint', 'recent', 'sort', 'citedby', 'citedbyauthor'];
var litUrlReady = false, litUrlRestoring = false, litUrlCitationVersion = 0;
var litUrlPendingCitation = null;

function litSyncFilterUrl() {
  if (!litUrlReady || litUrlRestoring || window.LIT_SHARED_VIEW) return;
  try {
    var sp = new URLSearchParams(location.search);
    Object.keys(litUrlSets).forEach(function (type) {
      var key = litUrlSets[type]; sp.delete(key);
      sel[type].forEach(function (value) { sp.append(key, value); });
    });
    Object.keys(litUrlInputs).forEach(function (key) {
      sp.delete(key);
      var value = document.getElementById(litUrlInputs[key]).value.trim();
      if (value) sp.set(key, value);
    });
    litUrlSpecial.forEach(function (key) { sp.delete(key); });
    Object.keys(sel.authorIdentity).forEach(function (label) {
      sp.append('author', label);
      sp.append('author-variants', JSON.stringify([label, sel.authorIdentity[label]]));
    });
    if (preprintOnly) sp.set('preprint', '1');
    if (recentMode) sp.set('recent', '1');
    var sort = document.getElementById('sortBy').value;
    if (sort !== 'year-desc') sp.set('sort', sort);
    var focal = citedByFilter;
    if (focal) sp.set(focal.kind === 'author' ? 'citedbyauthor' : 'citedby', focal.doi || focal.label);
    else if (litUrlPendingCitation) sp.set(litUrlPendingCitation.key, litUrlPendingCitation.query);
    var qs = sp.toString();
    var url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
  } catch (e) { /* A restricted history API must not interrupt searching. */ }
}

function litRestoreFilterUrl() {
  var sp = new URLSearchParams(location.search);
  var keys = Object.values(litUrlSets).concat(Object.keys(litUrlInputs), litUrlSpecial);
  var ownsSearch = keys.some(function (key) { return sp.has(key); });
  // Shared public library lists keep their existing URL and view lifecycle.
  if (sp.get('list')) return;
  if (!ownsSearch && !litUrlReady) return; // ordinary landing keeps the auth/default lifecycle
  var version;
  litUrlRestoring = true;
  try {
    resetFilterState();
    version = litUrlCitationVersion;
    window.LIT_FILTER_DEEPLINK = ownsSearch;
    window.LIT_AUTHOR_DEEPLINK = false;
    window.LIT_CITEDBY_DEEPLINK = false;
    window.litSiteDefaultActive = false;
    window.litAutoSig = undefined;
    Object.keys(litUrlSets).forEach(function (type) {
      sp.getAll(litUrlSets[type]).forEach(function (value) {
        value = value.trim();
        if (['title', 'author', 'affiliation', 'abstract'].indexOf(type) !== -1) value = value.toLowerCase();
        if (value) sel[type].add(value);
      });
    });
    sp.getAll('author').forEach(function (label) {
      label = label.trim();
      if (label) Object.defineProperty(sel.authorIdentity, label, {
        value: [label.toLowerCase()], writable: true, enumerable: true, configurable: true
      });
    });
    sp.getAll('author-variants').forEach(function (value) {
      try {
        var entry = JSON.parse(value);
        if (Array.isArray(entry) && typeof entry[0] === 'string' &&
            Object.prototype.hasOwnProperty.call(sel.authorIdentity, entry[0]) &&
            Array.isArray(entry[1]) && entry[1].length &&
            entry[1].every(function (v) { return typeof v === 'string' && v.trim(); })) {
          sel.authorIdentity[entry[0]] = entry[1];
        }
      } catch (e) { /* Ignore malformed optional variants; keep the name. */ }
    });
    window.LIT_AUTHOR_DEEPLINK = Object.keys(sel.authorIdentity).length > 0;
    Object.keys(litUrlInputs).forEach(function (key) {
      document.getElementById(litUrlInputs[key]).value = sp.get(key) || '';
    });
    preprintOnly = sp.get('preprint') === '1';
    document.getElementById('preprintBtn').className = 'recent-tab-btn' + (preprintOnly ? ' active' : '');
    var sort = document.getElementById('sortBy');
    sort.value = Array.from(sort.options).some(function (o) { return o.value === sp.get('sort'); }) ? sp.get('sort') : 'year-desc';
    recentMode = sp.get('recent') === '1';
    if (recentMode) resetFilterState(true); // recent view only uses journal scope
    updateRecentButton();
    Object.keys(litUrlSets).forEach(function (type) { renderChips(type); });
    renderAuthorChips();
    var d = sp.get('citedby'), a = sp.get('citedbyauthor');
    var query = (d || a || '').trim();
    litUrlPendingCitation = !recentMode && query ? { key: d ? 'citedby' : 'citedbyauthor', query: query } : null;
    window.LIT_CITEDBY_DEEPLINK = !!litUrlPendingCitation;
  } finally { litUrlRestoring = false; }
  if (!ownsSearch) { window.litSiteDefaultApplied = false; applyLitSiteDefault(); return; }
  if (recentMode) renderRecent(); else applyFilters();
  if (window.LIT_AUTHOR_DEEPLINK) {
    litUpgradeAuthorDeepLink();
    if (!authorsRequested) loadAuthors();
  }
  if (litUrlPendingCitation) {
    var pending = litUrlPendingCitation;
    (pending.key === 'citedby' ? litCbResolvePaper(pending.query) : litCbResolveAuthor(pending.query)).then(function (res) {
      if (version !== litUrlCitationVersion) return; // Clear or a newer navigation wins
      litUrlPendingCitation = null;
      if (res && !res.error) litApplyCitedByFilter(res);
      else { window.LIT_CITEDBY_DEEPLINK = false; litCbSetNote((res && res.error) || ''); litSyncFilterUrl(); }
    }).catch(function () {
      if (version !== litUrlCitationVersion) return;
      litUrlPendingCitation = null;
      window.LIT_CITEDBY_DEEPLINK = false;
      litSyncFilterUrl();
    });
  }
}

function litCancelUrlCitation() {
  ++litUrlCitationVersion;
  litUrlPendingCitation = null;
}

function initLitFilterUrl() {
  // Restore before manifests, account state or cached authors can render and
  // replace the incoming link with a partial selection.
  litRestoreFilterUrl();
  litUrlReady = true;
  if (new URLSearchParams(location.search).has('filters')) litSyncFilterUrl();
  window.addEventListener('popstate', litRestoreFilterUrl);
  // Update typed searches even before any journal data finishes loading.
  Object.values(litUrlInputs).forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      window.LIT_FILTER_DEEPLINK = true;
      litDropSiteDefaultForSearch();
      litSyncFilterUrl();
    });
  });
}
