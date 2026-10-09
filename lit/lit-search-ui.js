// One set of live search controls: normal page flow, temporarily moved into a
// native dialog for refinement. No duplicated IDs, query state or listeners.
(function () {
  'use strict';
  var home = document.getElementById('litFiltersHome');
  var filters = document.querySelector('.filters-bar');
  var summary = document.getElementById('litSearchSummary');
  var chips = document.getElementById('litActiveFilters');
  var dialog = document.getElementById('litRefineDialog');
  var refine = document.getElementById('litRefineButton');
  var count = document.getElementById('resultsCount');
  var sentinel = document.getElementById('litSearchSentinel');
  var moves = [], layout, returnFocus, oldHeight, oldScroll, homePassed;
  var frame = 0, pendingText = false;
  var anchorStyle = '';
  var targets = { jtype: 'csJType', journal: 'csJournal', author: 'filterAuthors',
    title: 'filterSearch', abstract: 'filterAbstracts', affiliation: 'filterAffiliations',
    year: 'csYear', editor: 'csEditor', area: 'csArea', se: 'csSE', ae: 'csAE' };
  var labels = { author: 'Author', title: 'Title', abstract: 'Abstract', affiliation: 'Affiliation',
    year: 'Year', editor: 'Editor', area: 'Area', se: 'Senior editor', ae: 'Associate editor' };

  function entries() {
    var out = [];
    Object.keys(targets).forEach(function (type) {
      sel[type].forEach(function (v) {
        var text = type === 'journal' ? (JOURNAL_LABEL[v] || v) :
          type === 'jtype' ? (JTYPE_LABEL[v] || v) : labels[type] + ': ' + v;
        out.push({ text: text, target: targets[type] });
      });
      if (litUrlInputs[type]) {
        var value = document.getElementById(litUrlInputs[type]).value.trim();
        if (value) out.push({ text: labels[type] + ': ' + value, target: targets[type] });
      }
    });
    Object.keys(sel.authorIdentity).forEach(function (v) { out.push({ text: 'Author: ' + v, target: 'filterAuthors' }); });
    if (citedByFilter) out.push({ text: 'Citing: ' + (citedByFilter.label || citedByFilter.doi || 'selected paper'), target: 'filterCitedBy' });
    else if (litUrlPendingCitation) out.push({ text: 'Citing: ' + litUrlPendingCitation.query, target: 'filterCitedBy' });
    if (preprintOnly) out.push({ text: 'Open-access preprints', target: 'preprintBtn' });
    if (recentMode) out.push({ text: 'Recently added', target: 'recentBtn' });
    return out;
  }
  function update() {
    frame = 0;
    // The original count/sort row is enough while the full form is visible.
    // The sentinel stays in normal flow, independent of the sticky bar.
    var boundary = sentinel.getBoundingClientRect().top;
    summary.classList.toggle('lit-search-reading', boundary <= 1 ||
      (summary.classList.contains('lit-search-reading') && boundary < 12));
    var selected = entries();
    // Keep the compact bar bounded even for a heavily refined search. All
    // selections remain visible in their original controls inside the dialog.
    var limit = window.matchMedia('(max-width: 768px)').matches ? 1 : 3;
    var signature = limit + JSON.stringify(selected);
    if (chips.dataset.signature !== signature) {
      chips.dataset.signature = signature;
      chips.replaceChildren();
      selected.slice(0, limit).forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'lit-active-filter';
        b.textContent = item.text; b.title = 'Edit ' + item.text;
        b.setAttribute('aria-label', 'Edit ' + item.text);
        b.addEventListener('click', function () { window.litOpenRefine(item.target); });
        chips.appendChild(b);
      });
      if (selected.length > limit) {
        var more = document.createElement('button');
        more.type = 'button'; more.className = 'lit-active-filter';
        more.textContent = '+' + (selected.length - limit) + ' filters';
        more.addEventListener('click', function () { window.litOpenRefine(); });
        chips.appendChild(more);
      }
    }
    count.title = count.textContent;
    var strong = count.querySelector('strong');
    document.getElementById('litRefineDone').textContent = strong ? 'Show ' + strong.textContent + ' papers' : 'Show results';
    if (layout) {
      var editorial = layout.querySelector('.lit-refine-editorial');
      editorial.hidden = document.getElementById('editorialRow').style.display === 'none';
    }
    filters.querySelectorAll('.custom-select-item').forEach(function (item) {
      item.setAttribute('role', 'button'); item.tabIndex = 0;
      item.setAttribute('aria-pressed', String(item.classList.contains('is-selected')));
    });
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function closeDrops() {
    filters.querySelectorAll('.custom-select-trigger.open, .custom-select-dropdown.open').forEach(function (el) { el.classList.remove('open'); });
    filters.querySelectorAll('.custom-select-trigger').forEach(function (el) { el.setAttribute('aria-expanded', 'false'); });
  }
  function move(node, destination) {
    var marker = document.createComment('filter home');
    node.before(marker); moves.push({ node: node, marker: marker }); destination.appendChild(node);
  }
  function group(id) { return document.getElementById(id).closest('.filter-group'); }
  function details(title, className) {
    var el = document.createElement('details'); el.className = className;
    var heading = document.createElement('summary'); heading.textContent = title; el.appendChild(heading);
    layout.appendChild(el); return el;
  }
  function focusTarget(id) {
    var node = document.getElementById(id || 'filterAuthors');
    if (!node || !dialog.contains(node)) return;
    var section = node.closest('details'); if (section) section.open = true;
    var trigger = node.querySelector('.custom-select-trigger');
    (trigger || node).focus({ preventScroll: true });
    (trigger || node).scrollIntoView({ block: 'nearest' });
    if (trigger) toggleDrop(id);
  }
  window.litOpenRefine = function (target) {
    if (document.body.matches('.lit-lib-mode, .lit-shared-mode')) return;
    if (dialog.open) { focusTarget(target); return; }
    returnFocus = document.activeElement;
    closeDrops();
    oldHeight = home.getBoundingClientRect().height;
    oldScroll = window.scrollY;
    anchorStyle = document.documentElement.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = 'none';
    homePassed = home.getBoundingClientRect().bottom <= 1;
    home.style.height = oldHeight + 'px';
    document.getElementById('litRefineBody').appendChild(filters);
    layout = document.createElement('div'); layout.className = 'lit-refine-layout';
    filters.querySelector('.filters-inner').prepend(layout);
    ['csJType', 'csJournal', 'filterAuthors', 'csYear'].forEach(function (id) { move(group(id), layout); });
    var text = details('Title, abstract, affiliation & citations', 'lit-refine-text');
    ['filterSearch', 'filterAbstracts', 'filterAffiliations', 'filterCitedBy'].forEach(function (id) { move(group(id), text); });
    text.open = !!(sel.title.size || sel.abstract.size || sel.affiliation.size || citedByFilter ||
      ['filterSearch', 'filterAbstracts', 'filterAffiliations', 'filterCitedBy'].some(function (id) { return document.getElementById(id).value.trim(); }));
    var editorial = details('Editors & areas', 'lit-refine-editorial');
    move(document.getElementById('editorialRow'), editorial);
    editorial.open = !!(sel.editor.size || sel.area.size || sel.se.size || sel.ae.size);
    move(filters.querySelector('.summary-tab-btns'), layout);
    move(filters.querySelector('.filter-actions'), layout);
    document.body.classList.add('lit-refining');
    refine.setAttribute('aria-expanded', 'true');
    dialog.showModal(); update();
    if (target) focusTarget(target);
    else document.getElementById('litRefineClose').focus({ preventScroll: true });
  };
  window.litViewResults = function () {
    // Explicit navigation only: typing never steals focus or scrolls the page.
    if (pendingText) {
      clearTimeout(searchTimer); clearTimeout(affSearchTimer); pendingText = false; applyFilters();
    }
    window.scrollTo({ top: window.scrollY + summary.getBoundingClientRect().top, behavior: 'instant' });
  };
  dialog.addEventListener('close', function () {
    closeDrops();
    moves.reverse().forEach(function (m) { m.marker.replaceWith(m.node); }); moves = [];
    layout.remove(); layout = null; home.appendChild(filters); home.style.height = '';
    document.body.classList.remove('lit-refining');
    refine.setAttribute('aria-expanded', 'false');
    // Replacing the placeholder must not pull a reader away from their paper.
    var delta = homePassed ? home.getBoundingClientRect().height - oldHeight : 0;
    window.scrollTo({ top: oldScroll + delta, behavior: 'instant' });
    (returnFocus && returnFocus.isConnected ? returnFocus : refine).focus({ preventScroll: true });
    if (dialog.returnValue === 'results') window.litViewResults();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!dialog.open) document.documentElement.style.overflowAnchor = anchorStyle;
      });
    });
    schedule();
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && filters.querySelector('.custom-select-dropdown.open')) {
      event.preventDefault(); event.stopPropagation(); closeDrops();
    }
  });
  dialog.addEventListener('cancel', function () { dialog.returnValue = ''; });
  dialog.addEventListener('click', function (event) {
    var box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close('');
  });
  document.getElementById('litRefineClose').addEventListener('click', function () { dialog.close(''); });
  document.getElementById('litRefineDone').addEventListener('click', function () { dialog.close('results'); });
  refine.addEventListener('click', function () { window.litOpenRefine(); });
  filters.addEventListener('input', function (e) {
    if (Object.values(litUrlInputs).indexOf(e.target.id) !== -1) pendingText = true;
    schedule();
  });
  filters.addEventListener('keydown', function (e) {
    if (e.target.classList.contains('custom-select-item') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      var trigger = e.target.closest('.custom-select').querySelector('.custom-select-trigger');
      e.target.click(); trigger.focus({ preventScroll: true });
    }
  });
  // Summary tabs live outside the dialog: expose them when selected there.
  filters.addEventListener('click', function (e) {
    if (dialog.open && e.target.closest('.summary-tab-btn')) {
      dialog.close('');
      setTimeout(function () { document.getElementById('summaryTabs').scrollIntoView({ block: 'start' }); }, 0);
    }
  });
  // Existing custom dropdowns gain keyboard entry and correctly named fields.
  filters.querySelectorAll('.filter-group').forEach(function (g) {
    var label = g.querySelector('label'), input = g.querySelector('input, select');
    if (label && input) { if (input.id) label.htmlFor = input.id; input.setAttribute('aria-label', label.textContent); }
  });
  filters.querySelectorAll('.custom-select-trigger').forEach(function (trigger) {
    trigger.setAttribute('role', 'button'); trigger.tabIndex = 0;
    trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', trigger.closest('.filter-group').querySelector('label').textContent);
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDrop(trigger.parentElement.id); }
    });
    new MutationObserver(function () { trigger.setAttribute('aria-expanded', String(trigger.classList.contains('open'))); }).observe(trigger, { attributes: true, attributeFilter: ['class'] });
  });
  var observer = new MutationObserver(schedule);
  observer.observe(filters, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  new MutationObserver(function () { pendingText = false; schedule(); }).observe(count, { childList: true, subtree: true, characterData: true });
  new MutationObserver(function () {
    if (dialog.open && document.body.matches('.lit-lib-mode, .lit-shared-mode')) dialog.close('');
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  // Retire the former manual-collapse preference; the full form is available
  // by scrolling up, regardless of a browser's old Hide filters setting.
  try { localStorage.removeItem('litFiltersCollapsed'); } catch (e) {}
  update();
  if (window.LIT_FILTER_DEEPLINK && entries().length && !location.hash && !window.LIT_SHARED_VIEW) {
    requestAnimationFrame(function () { window.litViewResults(); });
  }
})();
