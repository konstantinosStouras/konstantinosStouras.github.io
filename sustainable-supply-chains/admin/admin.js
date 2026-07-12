/* ==========================================================================
   Sustainable Supply Chains — admin/admin.js
   Instructor panel: create/configure sessions (left form + session cards,
   in the ideasearchlab admin mould), run the game live from the Control room
   (start rounds, monitor submissions, resolve, bots, broadcasts), and export
   everything as a multi-sheet .xlsx / JSON from Data & export.

   Round resolution runs HERE, in the instructor's browser, through the same
   engine.js the students see — deterministic, so any device recomputes the
   identical result. resolveRound() reads all decisions (bots decide on the
   spot), then saveResolution() publishes results/market/news and flips the
   session phase.
   ========================================================================== */
(function () {
  'use strict';
  var U = window.SSCUI, E = window.SSCEngine, ST = window.SSCStore, C = window.SSC_CONFIG;
  var $ = U.$, esc = U.esc, fmtM = U.fmtMoney, fmtI = U.fmtInt;

  var A = {
    sessions: [],
    editingId: null,
    ctrlId: null,
    ctrl: { session: null, firms: [], decisions: [], results: [], markets: [], unsubs: [] },
    dataId: null,
    data: { session: null, firms: [], decisions: [], results: [], markets: [], unsubs: [] },
    resolving: false
  };
  var BOT_NAMES = ['Atlas Cycles', 'Borealis Mobility', 'Cardinal Wheels', 'Verde Velo',
                   'Nimbus Rides', 'Quanta Bikes', 'Zephyr Cycleworks', 'Solstice Mobility'];

  /* ---- boot & auth ------------------------------------------------------------ */
  U.themeInit($('#btn-theme'));
  if (ST.backend === 'demo') {
    $('#mode-pill').style.display = '';
    $('#dash-banner').innerHTML = '<div class="banner banner-info"><b>Demo mode</b> — no Firebase configured, so ' +
      'sessions live in this browser only. Perfect for trying the game: create a session here, then open ' +
      '<a href="../" target="_blank">the student page</a> in another tab (same browser), join with the code, and add ' +
      'bot firms for competition. For a real class on many devices, set up Firebase (see the README on GitHub).</div>';
    showDash();
  } else {
    ST.onAdminAuth(function (user) {
      var allowed = window.SSC_ADMIN_EMAILS || [];
      if (user && user.email && allowed.indexOf(user.email) !== -1) {
        $('#who').textContent = user.email;
        $('#btn-signout').style.display = '';
        showDash();
      } else {
        if (user && user.email) ST.adminSignOut();
        show('a-login');
      }
    });
  }
  $('#btn-login').addEventListener('click', function () {
    $('#login-err').style.display = 'none';
    ST.adminSignIn($('#in-email').value.trim(), $('#in-pass').value).catch(function (e) {
      $('#login-err').textContent = e.message; $('#login-err').style.display = '';
    });
  });
  $('#btn-signout').addEventListener('click', function () { ST.adminSignOut().then(function () { location.reload(); }); });
  function show(id) {
    U.$all('.screen').forEach(function (s) { s.classList.remove('active'); });
    $('#' + id).classList.add('active');
  }
  function showDash() {
    show('a-dash');
    buildForm(freshSettings(), freshCatalog(), { name: '', code: '' });
    refreshSessions();
  }

  U.$all('.tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      U.$all('.tabs .tab').forEach(function (x) { x.classList.toggle('on', x === t); });
      U.$all('.tab-panel').forEach(function (p) { p.style.display = 'none'; });
      $('#tab-' + t.dataset.tab).style.display = '';
      if (t.dataset.tab === 'data') renderData();
    });
  });
  function gotoTab(name) {
    U.$all('.tabs .tab').forEach(function (x) { x.classList.toggle('on', x.dataset.tab === name); });
    U.$all('.tab-panel').forEach(function (p) { p.style.display = 'none'; });
    $('#tab-' + name).style.display = '';
  }

  function freshSettings() { return JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS)); }
  function freshCatalog() { return JSON.parse(JSON.stringify(C.CATALOG)); }
  function genCode() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 7; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }
  function logEvA(sessId, type, round, d) {
    ST.logEvent(sessId, { at: Date.now(), type: type, round: round || 0, firmId: 'admin',
                          uid: 'admin', member: null, d: d || {} }).catch(function () {});
  }
  function studentLink(code) {
    var base = location.href.replace(/admin\/?(index\.html)?(\?.*)?$/, '');
    return base + '?code=' + code;
  }

  /* ================= SESSION FORM ================================================ */
  function field(label, inner, hint, title) {
    return '<div class="field"' + (title ? ' title="' + esc(title) + '"' : '') + '><label>' + label +
      (title ? ' <span class="help">?</span>' : '') + '</label>' + inner +
      (hint ? '<span class="tiny muted">' + hint + '</span>' : '') + '</div>';
  }
  function numIn(id, val, min, max, step) {
    return '<input type="number" class="input" id="' + id + '" value="' + val + '"' +
      (min != null ? ' min="' + min + '"' : '') + (max != null ? ' max="' + max + '"' : '') +
      (step ? ' step="' + step + '"' : '') + ' />';
  }
  function toggleIn(id, label, on, hint) {
    return '<label class="toggle"' + (hint ? ' title="' + esc(hint) + '"' : '') + '><span class="toggle-label">' + label +
      '</span><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' /><span class="toggle-track"><span class="toggle-thumb"></span></span></label>';
  }

  function buildForm(s, catalog, meta) {
    // market/region pickers come from the catalog BEING EDITED (a session may
    // carry a custom catalog with different markets/regions); if you change
    // regions/markets inside the JSON below, the pickers re-sync on save/edit.
    var cat = (catalog && catalog.markets && catalog.regions) ? catalog : freshCatalog();
    A.formCatalog = cat;
    var html = '';

    html += '<div class="section"><div class="sub-title">Play mode</div>' +
      toggleIn('f-async', 'Async practice — self-paced vs optimal (Nash) bots', !!s.asyncMode,
        'OFF (live): you pace the rounds and all firms compete in one shared market. ON (async): every firm plays its OWN private game against computer opponents that price at the Nash equilibrium and run an optimal ordering policy — students play anytime, you watch progress in the control room. Ideal as homework before the live game.') +
      '<div class="grid3">' +
      field('Bot opponents per firm (async)', numIn('f-asyncbots', s.asyncBots || 3, 1, 5),
        'Only used in async mode. The bots anticipate demand shifts and tariff schedules — beating them takes real supply-chain discipline.') +
      '</div></div>';

    html += '<div class="section"><div class="sub-title">Game structure</div><div class="grid3">' +
      field('Rounds', numIn('f-rounds', s.rounds, 2, 30), null, 'How many decision rounds the class plays. 6–10 works well in a 90-minute slot.') +
      field('Starting cash ($)', numIn('f-cash', s.startingCash, 0)) +
      field('Factory capacity (units/round)', numIn('f-capacity', s.factoryCapacity, 1)) +
      field('Starting components (each)', numIn('f-startcomp', s.startingComponents, 0), null, 'Units of each component every firm holds at kickoff, so round 1 can produce.') +
      field('Starting finished goods', numIn('f-startfg', s.startingFinished, 0)) +
      field('Score weight on profit (%)', numIn('f-scorew', s.scoreWeightProfit, 0, 100), 'The rest weighs the sustainability (green) rank.') +
      '</div></div>';

    html += '<div class="section"><div class="sub-title">Markets open for selling</div><div class="grid3">' +
      cat.markets.map(function (m) {
        var on = s.markets.indexOf(m.id) !== -1;
        return '<label class="checkline"><input type="checkbox" class="mkt-check" data-m="' + m.id + '"' + (on ? ' checked' : '') + '/><span>' +
          esc(m.name) + ' <span class="tiny muted">(~' + fmtI(m.size) + ' u/round, ref ' + fmtM(m.refPrice) + ')</span></span></label>';
      }).join('') + '</div></div>';

    html += '<div class="section"><div class="sub-title">Demand</div><div class="grid3">' +
      field('Pattern', '<select class="input" id="f-pattern">' + C.DEMAND_PATTERNS.map(function (p) {
        return '<option value="' + p.id + '"' + (s.demandPattern === p.id ? ' selected' : '') + '>' + p.name + ' — ' + p.hint + '</option>';
      }).join('') + '</select>', 'Students never see the pattern — they experience it through their sales. A step or seasonal pattern is what makes the bullwhip bite.') +
      field('Step at round', numIn('f-steporound', s.stepRound, 1), 'step pattern only') +
      field('Step factor', numIn('f-stepfactor', s.stepFactor, 0.2, 5, 0.1), 'e.g. 1.5 = demand jumps +50%') +
      field('Noise (±fraction)', numIn('f-noise', s.demandNoise, 0, 1, 0.01)) +
      field('Demand scale', numIn('f-dscale', s.demandScale || 1, 0.1, 10, 0.1), 'Multiply all market sizes. Rough guide: 1.0 fits ~4–6 firms; scale up for bigger classes.') +
      '</div><div class="grid3">' +
      toggleIn('f-intel', 'Market intelligence', s.marketIntel, 'Firms see last round\'s total demand and average price per market.') +
      toggleIn('f-standings', 'Live leaderboard', s.showStandings, 'Firms can watch the standings during the game (final debrief always shows them).') +
      toggleIn('f-events', 'World events', s.eventsOn, 'Seeded supply disruptions, port congestion and ESG scandal risk.') +
      '</div><div class="grid3">' +
      toggleIn('f-coach', 'Automatic coaching', s.coachOn !== false,
        'Rule-based nudges while teams decide (thin pipeline, over-ordering, below-cost prices, air-freight waste, scandal exposure…) plus post-round feedback benchmarked against competitive pricing and an order-up-to policy.') +
      toggleIn('f-chat', 'Messaging', s.chatOn !== false,
        'Firms can message you and each other (negotiation, coordination, bluffing — all visible to you in the control room).') +
      '</div></div>';

    html += '<div class="section"><div class="sub-title">Tariffs</div>' +
      '<p class="section-hint">Base tariff charged on the customs value of anything imported into a region — components into a firm\'s hub, finished goods into a market. Schedule shocks to change rates mid-game (announced shocks appear in the news one round ahead, so firms can front-run them).</p>' +
      '<div class="grid3">' + Object.keys(cat.regions).map(function (rid) {
        return field('Into ' + cat.regions[rid].name + ' (%)', numIn('tariff-' + rid, (s.tariffBase || {})[rid] || 0, 0, 200));
      }).join('') + '</div>' +
      '<div class="sub-title" style="margin-top:10px;">Tariff shocks</div><div id="shock-rows"></div>' +
      '<button class="btn-ghost btn-sm" id="btn-add-shock">+ Add tariff shock</button></div>';

    html += '<div class="section"><div class="sub-title">Sustainability levers</div><div class="grid3">' +
      field('Carbon tax ($/tonne gross CO2)', numIn('f-ctax', s.carbonTaxPerTon, 0), '0 = no tax') +
      field('Carbon tax from round', numIn('f-ctaxround', s.carbonTaxFromRound, 1)) +
      field('Consumer green sensitivity ×', numIn('f-gsens', s.greenSensitivity, 0, 5, 0.1), 'Scales how much every market rewards green firms.') +
      field('Offset price ($/tonne)', numIn('f-offsetp', s.offsetPricePerTon, 0)) +
      field('Renewable plant capex ($)', numIn('f-renewcapex', s.renewableCapex, 0)) +
      field('Supplier audit cost ($)', numIn('f-auditcost', s.auditCost, 0)) +
      '</div></div>';

    html += '<div class="section"><details><summary class="sub-title" style="cursor:pointer; display:list-item;">Advanced: product &amp; supplier catalog (JSON)</summary>' +
      '<p class="section-hint">The product, components, suppliers (cost / CO2 / ESG / capacity), regions, distances, transport modes and markets. Edit for a custom game; leave as-is otherwise.</p>' +
      '<textarea class="input" id="f-catalog" spellcheck="false" style="min-height:220px; font-family:ui-monospace,Menlo,monospace; font-size:12px;"></textarea>' +
      '<button class="btn-ghost btn-sm" id="btn-catalog-reset" style="margin-top:6px;">Reset catalog to default</button></details></div>';

    html += '<div class="section"><div class="sub-title">Session details</div><div class="grid2">' +
      field('Session name (only you see it)', '<input class="input" id="f-name" value="' + esc(meta.name || '') + '" placeholder="e.g. MBA Ops — Spring 2027" />') +
      field('Session code', '<div class="flex-row"><input class="input" id="f-code" value="' + esc(meta.code || '') + '" placeholder="AUTO" style="text-transform:uppercase; font-family:ui-monospace,Menlo,monospace;" />' +
        '<button class="btn-ghost btn-sm" id="btn-gencode">Auto</button></div>', 'Single word, A–Z and digits. Students join with this.') +
      '</div></div>';

    $('#form-root').innerHTML = html;
    $('#f-catalog').value = JSON.stringify(catalog, null, 1);
    (s.tariffShocks || []).forEach(addShockRow);
    $('#btn-add-shock').addEventListener('click', function () { addShockRow({ round: 4, importer: 'namerica', from: '', rate: 25, announce: true }); });
    $('#btn-gencode').addEventListener('click', function () { $('#f-code').value = genCode(); });
    $('#btn-catalog-reset').addEventListener('click', function () { $('#f-catalog').value = JSON.stringify(freshCatalog(), null, 1); });
  }

  function addShockRow(sh) {
    var cat = A.formCatalog || freshCatalog();
    var row = U.el('div', { class: 'flex-row', style: 'margin:6px 0; gap:6px;' });
    function regionSel(cls, val, anyLabel) {
      return '<select class="input input-sm ' + cls + '" style="width:auto;">' +
        (anyLabel ? '<option value="">' + anyLabel + '</option>' : '') +
        Object.keys(cat.regions).map(function (rid) {
          return '<option value="' + rid + '"' + (val === rid ? ' selected' : '') + '>' + cat.regions[rid].name + '</option>';
        }).join('') + '</select>';
    }
    row.innerHTML = '<span class="tiny muted">round</span><input type="number" class="input input-sm sh-round" value="' + (sh.round || 1) + '" min="1" style="width:64px;"/>' +
      '<span class="tiny muted">into</span>' + regionSel('sh-importer', sh.importer) +
      '<span class="tiny muted">from</span>' + regionSel('sh-from', sh.from || '', 'anywhere') +
      '<input type="number" class="input input-sm sh-rate" value="' + (sh.rate || 0) + '" min="0" max="500" style="width:70px;"/><span class="tiny muted">%</span>' +
      '<label class="checkline" style="margin:0;"><input type="checkbox" class="sh-announce"' + (sh.announce ? ' checked' : '') + '/><span class="tiny">announce a round ahead</span></label>' +
      '<button class="link-btn danger sh-del">remove</button>';
    row.querySelector('.sh-del').addEventListener('click', function () { row.remove(); });
    $('#shock-rows').appendChild(row);
  }

  function readForm() {
    var s = freshSettings();
    function nv(id, d) { var v = Number(($('#' + id) || {}).value); return isFinite(v) ? v : d; }
    s.rounds = Math.max(1, Math.round(nv('f-rounds', s.rounds)));
    s.startingCash = nv('f-cash', s.startingCash);
    s.factoryCapacity = Math.max(1, nv('f-capacity', s.factoryCapacity));
    s.startingComponents = Math.max(0, nv('f-startcomp', s.startingComponents));
    s.startingFinished = Math.max(0, nv('f-startfg', s.startingFinished));
    s.scoreWeightProfit = Math.min(100, Math.max(0, nv('f-scorew', s.scoreWeightProfit)));
    s.asyncMode = $('#f-async').checked;
    s.coachOn = $('#f-coach').checked;
    s.chatOn = $('#f-chat').checked;
    s.asyncBots = Math.max(1, Math.min(5, Math.round(nv('f-asyncbots', 3))));
    s.markets = U.$all('.mkt-check').filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.m; });
    s.demandPattern = $('#f-pattern').value;
    s.stepRound = nv('f-steporound', s.stepRound);
    s.stepFactor = nv('f-stepfactor', s.stepFactor);
    s.demandNoise = nv('f-noise', s.demandNoise);
    s.demandScale = nv('f-dscale', 1);
    s.marketIntel = $('#f-intel').checked;
    s.showStandings = $('#f-standings').checked;
    s.eventsOn = $('#f-events').checked;
    s.tariffBase = {};
    Object.keys((A.formCatalog || freshCatalog()).regions).forEach(function (rid) { s.tariffBase[rid] = nv('tariff-' + rid, 0); });
    s.tariffShocks = U.$all('#shock-rows > div').map(function (row) {
      return {
        round: Number(row.querySelector('.sh-round').value) || 1,
        importer: row.querySelector('.sh-importer').value,
        from: row.querySelector('.sh-from').value || null,
        rate: Number(row.querySelector('.sh-rate').value) || 0,
        announce: row.querySelector('.sh-announce').checked
      };
    });
    s.carbonTaxPerTon = nv('f-ctax', 0);
    s.carbonTaxFromRound = nv('f-ctaxround', 1);
    s.greenSensitivity = nv('f-gsens', 1);
    s.offsetPricePerTon = nv('f-offsetp', s.offsetPricePerTon);
    s.renewableCapex = nv('f-renewcapex', s.renewableCapex);
    s.auditCost = nv('f-auditcost', s.auditCost);
    var catalog;
    try { catalog = JSON.parse($('#f-catalog').value); }
    catch (e) { return { err: 'Catalog JSON is invalid: ' + e.message }; }
    var catErr = validateCatalog(catalog);
    if (catErr) return { err: 'Catalog: ' + catErr };
    // reconcile against the FINAL catalog (the JSON may have been edited):
    // open markets must exist there; tariff base covers exactly its regions
    var mktIds = catalog.markets.map(function (m) { return m.id; });
    s.markets = s.markets.filter(function (mid) { return mktIds.indexOf(mid) !== -1; });
    if (!s.markets.length) return { err: 'Open at least one market that exists in the catalog.' };
    var tb = {};
    Object.keys(catalog.regions).forEach(function (rid) { tb[rid] = s.tariffBase[rid] != null ? s.tariffBase[rid] : 0; });
    s.tariffBase = tb;
    s.tariffShocks = s.tariffShocks.filter(function (sh) { return catalog.regions[sh.importer]; });
    var code = ($('#f-code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return { settings: s, catalog: catalog, name: $('#f-name').value.trim(), code: code };
  }

  // A broken pasted catalog must never reach a session doc — the game would
  // crash at first preview/resolve. Checks structure, required numeric fields,
  // and that every supplier/market region id actually exists.
  function validateCatalog(cat) {
    function bad(msg) { return msg; }
    if (!cat || typeof cat !== 'object') return bad('not an object.');
    if (!cat.regions || !Object.keys(cat.regions).length) return bad('needs a non-empty "regions" map.');
    var p = cat.product;
    if (!p) return bad('needs a "product".');
    var pk = ['weightKg', 'assemblyCost', 'assemblyCO2', 'assemblyCO2Renewable', 'co2Baseline'];
    for (var i = 0; i < pk.length; i++) if (typeof p[pk[i]] !== 'number') return bad('product.' + pk[i] + ' must be a number.');
    if (!cat.modes || !cat.modes.surface || !cat.modes.air) return bad('needs "modes" with surface and air.');
    var mk = ['costPerKgMm', 'co2PerKgMm'];
    for (var m2 = 0; m2 < mk.length; m2++) {
      if (typeof cat.modes.surface[mk[m2]] !== 'number' || typeof cat.modes.air[mk[m2]] !== 'number')
        return bad('modes.surface/air need numeric ' + mk[m2] + '.');
    }
    if (!cat.distances || typeof cat.distances !== 'object') return bad('needs a "distances" map.');
    if (typeof cat.sameRegionDist !== 'number') return bad('needs numeric "sameRegionDist".');
    if (!Array.isArray(cat.components) || !cat.components.length) return bad('needs a non-empty "components" array.');
    for (var c = 0; c < cat.components.length; c++) {
      var comp = cat.components[c];
      if (!comp.id || typeof comp.qty !== 'number' || typeof comp.weightKg !== 'number')
        return bad('component ' + (comp.id || c) + ' needs id, numeric qty and weightKg.');
      if (!Array.isArray(comp.suppliers) || !comp.suppliers.length)
        return bad('component ' + comp.id + ' needs at least one supplier.');
      for (var s2 = 0; s2 < comp.suppliers.length; s2++) {
        var sup = comp.suppliers[s2];
        if (!sup.id || typeof sup.cost !== 'number' || typeof sup.co2 !== 'number' ||
            typeof sup.esg !== 'number' || typeof sup.capacity !== 'number')
          return bad('supplier ' + (sup.id || '?') + ' needs id and numeric cost/co2/esg/capacity.');
        if (!cat.regions[sup.region]) return bad('supplier ' + sup.id + ' region "' + sup.region + '" is not in regions.');
      }
    }
    if (!Array.isArray(cat.markets) || !cat.markets.length) return bad('needs a non-empty "markets" array.');
    for (var m3 = 0; m3 < cat.markets.length; m3++) {
      var mkt = cat.markets[m3];
      if (!mkt.id || typeof mkt.size !== 'number' || typeof mkt.refPrice !== 'number' ||
          typeof mkt.priceBeta !== 'number' || typeof mkt.greenBeta !== 'number' || typeof mkt.brandBeta !== 'number')
        return bad('market ' + (mkt.id || m3) + ' needs id and numeric size/refPrice/priceBeta/greenBeta/brandBeta.');
      if (!cat.regions[mkt.region]) return bad('market ' + mkt.id + ' region "' + mkt.region + '" is not in regions.');
    }
    return null;
  }

  $('#btn-save-session').addEventListener('click', function () {
    var out = readForm(), err = $('#form-err');
    err.style.display = 'none';
    if (out.err) { err.textContent = out.err; err.style.display = ''; return; }
    var code = out.code || genCode();
    var clash = A.sessions.some(function (x) { return x.code === code && x.id !== A.editingId && !x.archived; });
    if (clash) { err.textContent = 'Code ' + code + ' is already used by another session.'; err.style.display = ''; return; }
    var btn = $('#btn-save-session');
    btn.disabled = true;
    if (A.editingId) {
      ST.updateSession(A.editingId, { name: out.name, code: code, settings: out.settings, catalog: out.catalog })
        .then(function () { btn.disabled = false; cancelEdit(); flash('Saved'); refreshSessions(); });
    } else {
      var doc = { code: code, name: out.name || ('Session ' + code), createdAt: Date.now(),
                  status: 'setup', round: 0, phase: 'lobby',
                  settings: out.settings, catalog: out.catalog, broadcasts: [] };
      ST.createSession(doc).then(function (id) {
        btn.disabled = false;
        flash('Created');
        $('#created-box').innerHTML = '<div class="code-box"><p class="small" style="margin:0 0 4px;">Session created — students join with this code:</p>' +
          '<div class="code-big">' + esc(code) + '</div>' +
          '<div class="launch-link">' + esc(studentLink(code)) + '</div>' +
          '<div class="flex-row"><button class="btn-ghost btn-sm" id="btn-copylink">Copy student link</button>' +
          '<button class="btn btn-sm" id="btn-goto-ctrl">Open control room →</button></div></div>';
        $('#btn-copylink').addEventListener('click', function () { U.copyText(studentLink(code)); });
        $('#btn-goto-ctrl').addEventListener('click', function () { gotoTab('control'); selectCtrl(id); });
        refreshSessions();
      });
    }
  });
  $('#btn-restore-defaults').addEventListener('click', function () {
    buildForm(freshSettings(), freshCatalog(), { name: '', code: '' });
  });
  $('#btn-cancel-edit').addEventListener('click', cancelEdit);
  function cancelEdit() {
    A.editingId = null;
    $('#form-title').childNodes[0].textContent = 'Create a session ';
    $('#edit-badge').style.display = 'none';
    $('#btn-save-session').textContent = 'Create session';
    $('#btn-cancel-edit').style.display = 'none';
    buildForm(freshSettings(), freshCatalog(), { name: '', code: '' });
  }
  function flash(text) {
    var f = $('#form-flash');
    f.textContent = text; f.classList.add('show');
    setTimeout(function () { f.classList.remove('show'); }, 1800);
  }

  /* ================= SESSION LISTS ================================================ */
  function refreshSessions() {
    ST.listSessions().then(function (list) {
      A.sessions = list;
      paintSessionLists();
      paintAnalyticsPicker();
      fillSelect($('#ctrl-select'), A.ctrlId);
      fillSelect($('#data-select'), A.dataId);
      if (!A.ctrlId && list.length) selectCtrl(list[0].id);
      if (!A.dataId && list.length) selectData(list[0].id);
    });
  }
  function fillSelect(sel, current) {
    var opts = A.sessions.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === current ? ' selected' : '') + '>' +
        esc((s.name || s.code) + ' · ' + s.code) + '</option>';
    }).join('');
    sel.innerHTML = opts || '<option value="">— no sessions —</option>';
  }
  $('#ctrl-select').addEventListener('change', function () { selectCtrl(this.value); });
  $('#data-select').addEventListener('change', function () { selectData(this.value); });

  function paintSessionLists() {
    var active = A.sessions.filter(function (s) { return s.status !== 'done'; });
    var done = A.sessions.filter(function (s) { return s.status === 'done'; });
    $('#active-count').textContent = active.length ? active.length + ' session' + (active.length > 1 ? 's' : '') : '';
    $('#done-count').textContent = done.length || '';
    $('#active-list').innerHTML = active.length ? '' : '<p class="muted small">None yet — create one on the left.</p>';
    $('#done-list').innerHTML = done.length ? '' : '<p class="muted small">None yet.</p>';
    active.forEach(function (s) { $('#active-list').appendChild(sessCard(s, false)); });
    done.forEach(function (s) { $('#done-list').appendChild(sessCard(s, true)); });
  }
  function sessCard(s, isDone) {
    var card = U.el('div', { class: 'sess-card' });
    var async = s.settings && s.settings.asyncMode;
    var phase = async ? 'self-paced practice vs optimal bots' :
      s.phase === 'lobby' ? 'lobby — waiting to start' :
      s.phase === 'decisions' ? 'round ' + s.round + ' — decisions open' :
      s.phase === 'resolved' ? 'round ' + s.round + ' resolved' : 'finished';
    card.innerHTML = '<div class="sess-top"><span class="sess-name">' + esc(s.name || s.code) + '</span>' +
      '<span>' + (async ? '<span class="pill pill-blue">async</span> ' : '') +
      '<span class="pill ' + (isDone ? 'pill-plain' : 'pill-green') + '">' + (isDone ? 'done' : 'active') + '</span></span></div>' +
      '<div class="sess-meta"><span class="sess-code">' + esc(s.code) + '</span> · ' + esc(phase) +
      ' · ' + ((s.settings || {}).rounds || '?') + ' rounds</div>';
    var act = U.el('div', { class: 'sess-actions' });
    var bCtrl = U.el('button', { class: 'btn btn-sm', text: 'Control room' });
    bCtrl.addEventListener('click', function () { gotoTab('control'); selectCtrl(s.id); });
    act.appendChild(bCtrl);
    if (s.phase === 'lobby') {
      var bEdit = U.el('button', { class: 'btn-ghost btn-sm', text: 'Edit' });
      bEdit.addEventListener('click', function () {
        A.editingId = s.id;
        $('#form-title').childNodes[0].textContent = 'Edit session ';
        $('#edit-badge').style.display = '';
        $('#btn-save-session').textContent = 'Save changes';
        $('#btn-cancel-edit').style.display = '';
        buildForm(s.settings, s.catalog, { name: s.name, code: s.code });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      act.appendChild(bEdit);
    }
    var bCopy = U.el('button', { class: 'btn-ghost btn-sm', text: 'Copy link' });
    bCopy.addEventListener('click', function () {
      U.copyText(studentLink(s.code));
      bCopy.textContent = 'Copied ✓'; setTimeout(function () { bCopy.textContent = 'Copy link'; }, 1500);
    });
    act.appendChild(bCopy);
    var bDel = U.el('button', { class: 'link-btn danger', text: 'Delete' });
    bDel.addEventListener('click', function () {
      if (!confirm('Delete session ' + s.code + ' and ALL its data (firms, decisions, results)?')) return;
      ST.deleteSession(s.id).then(function () {
        if (A.ctrlId === s.id) A.ctrlId = null;
        if (A.dataId === s.id) A.dataId = null;
        refreshSessions();
      });
    });
    act.appendChild(bDel);
    card.appendChild(act);
    return card;
  }

  /* ================= CONTROL ROOM ================================================== */
  function selectCtrl(id) {
    if (!id) return;
    A.ctrlId = id;
    fillSelect($('#ctrl-select'), id);
    A.ctrl.unsubs.forEach(function (u) { u(); });
    A.ctrl = { session: null, firms: [], decisions: [], results: [], markets: [], asyncs: [], messages: [], unsubs: [] };
    A.ctrl.unsubs.push(ST.watchSession(id, function (d) { A.ctrl.session = d; renderCtrl(); paintSessionLists(); }));
    A.ctrl.unsubs.push(ST.watchFirms(id, function (d) { A.ctrl.firms = d || []; renderCtrl(); }));
    A.ctrl.unsubs.push(ST.watchDecisions(id, function (d) { A.ctrl.decisions = d || []; renderCtrl(); }));
    A.ctrl.unsubs.push(ST.watchResults(id, function (d) { A.ctrl.results = d || []; renderCtrl(); }));
    A.ctrl.unsubs.push(ST.watchMarkets(id, function (d) { A.ctrl.markets = d || []; renderCtrl(); }));
    A.ctrl.unsubs.push(ST.watchAsyncAll(id, function (d) { A.ctrl.asyncs = d || []; renderCtrl(); }));
    A.ctrl.unsubs.push(ST.watchMessages(id, function (d) { A.ctrl.messages = d || []; renderCtrl(); }));
  }
  function ctrlStates() {
    var out = {};
    A.ctrl.firms.forEach(function (f) {
      var rs = A.ctrl.results.filter(function (r) { return r.firmId === f.id; })
        .sort(function (a, b) { return a.round - b.round; });
      out[f.id] = rs.length ? rs[rs.length - 1].endState : E.initFirmState(A.ctrl.session, f);
    });
    return out;
  }
  function decisionOf(fid, round) {
    return A.ctrl.decisions.find(function (d) { return d.firmId === fid && d.round === round; }) || null;
  }

  function renderCtrl() {
    var sess = A.ctrl.session, box = $('#ctrl-root');
    if (!sess) { box.innerHTML = '<p class="muted" style="margin-top:16px;">Select a session above.</p>'; return; }
    var firms = A.ctrl.firms, s = sess.settings || {};
    // the control room re-renders on every live snapshot — preserve the
    // admin's in-progress broadcast text, bot-profile choice and focus
    var keepBc = $('#c-bc') ? $('#c-bc').value : '';
    var keepDm = $('#c-dm-text') ? $('#c-dm-text').value : '';
    var keepDmTo = $('#c-dm-to') ? $('#c-dm-to').value : '';
    var keepProfile = $('#c-botprofile') ? $('#c-botprofile').value : '';
    var keepFocusId = document.activeElement && (document.activeElement.id === 'c-bc' || document.activeElement.id === 'c-dm-text')
      ? document.activeElement.id : null;
    var html = '';

    // --- header / phase actions
    var submitted = firms.filter(function (f) { return f.isBot || (decisionOf(f.id, sess.round) || {}).submitted; }).length;
    html += '<div class="card"><div class="row-between"><div>' +
      '<div class="card-title" style="margin-bottom:0;">' + esc(sess.name || sess.code) +
      ' <span class="sess-code">' + esc(sess.code) + '</span></div>' +
      '<p class="card-subtitle" style="margin:2px 0 0;">Student link: <span class="launch-link" style="display:inline-block; margin:0;">' + esc(studentLink(sess.code)) + '</span></p></div>' +
      '<div class="flex-row">' +
      (sess.phase === 'lobby' ? '<span class="pill pill-amber">lobby</span>' :
       sess.phase === 'decisions' ? '<span class="pill pill-green">round ' + sess.round + ' · decisions open</span>' :
       sess.phase === 'resolved' ? '<span class="pill pill-blue">round ' + sess.round + ' resolved</span>' :
       '<span class="pill pill-plain">finished</span>') + '</div></div>';

    var isAsyncSess = !!(s.asyncMode);
    html += '<div class="flex-row mt16">';
    if (isAsyncSess) {
      html += '<span class="pill pill-blue">async practice — self-paced</span>' +
        '<span class="muted small">Each firm plays its own private game vs ' + (s.asyncBots || 3) +
        ' optimal (Nash) bots, at its own pace. Watch progress below; no round control needed.</span>' +
        (sess.archived ? '<span class="pill pill-plain">archived</span>'
          : '<button class="btn-ghost btn-sm" id="c-archive" title="End the practice window: the code stops working and the session moves to Completed. Existing data is kept.">End practice window</button>');
    } else if (sess.phase === 'lobby') {
      html += '<button class="btn" id="c-start"' + (firms.length ? '' : ' disabled') + '>▶ Start round 1</button>' +
        '<span class="muted small">' + (firms.length ? firms.length + ' firm(s) ready.' : 'Waiting for firms to join — or add bot firms below.') + '</span>';
    } else if (sess.phase === 'decisions') {
      html += '<button class="btn" id="c-resolve"' + (A.resolving ? ' disabled' : '') + '>⚙ Resolve round ' + sess.round + '</button>' +
        '<span class="muted small">' + submitted + ' of ' + firms.length + ' firms submitted (bots decide automatically). Resolving locks the round for everyone.</span>';
    } else if (sess.phase === 'resolved') {
      html += '<button class="btn" id="c-next">▶ Open round ' + (sess.round + 1) + ' of ' + s.rounds + '</button>' +
        '<span class="muted small">Give teams a minute on their results first.</span>';
    } else {
      html += '<span class="pill pill-plain">Game over — students see the debrief.</span>';
    }
    if (sess.phase !== 'final' && sess.phase !== 'lobby') {
      html += '<button class="btn-ghost btn-sm" id="c-end" title="End the game now: current standings become final and students get the debrief.">End game now</button>';
    }
    html += '</div></div>';

    // --- async monitor (async sessions)
    if (isAsyncSess) {
      html += '<div class="columns"><div class="card"><div class="card-title">Progress — every firm\'s own game</div>';
      if (!A.ctrl.asyncs.length) html += '<p class="muted small">No firm has started yet. Share the link/code — each firm begins round 1 the moment it joins.</p>';
      else {
        html += '<div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr><th>Firm</th><th class="r">Round</th><th>Status</th>' +
          '<th class="r">Cum. profit</th><th class="r">Green</th><th class="r">Brand</th><th class="r">Bullwhip</th><th class="r">Last activity</th></tr></thead><tbody>';
        A.ctrl.asyncs.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).forEach(function (inst) {
          var f = firms.find(function (x) { return x.id === inst.firmId; });
          var st = inst.states && inst.states[inst.firmId];
          if (!st) return;
          var mins = inst.updatedAt ? Math.round((Date.now() - inst.updatedAt) / 60000) : null;
          html += '<tr><td>' + esc(f ? f.name : inst.firmId) + '</td>' +
            '<td class="r">' + Math.min(inst.round, s.rounds) + '/' + s.rounds + '</td>' +
            '<td>' + (inst.phase === 'final' ? '<span class="pill pill-green">finished</span>' : esc(inst.phase)) + '</td>' +
            '<td class="r ' + U.posneg(st.cum.profit) + '">' + fmtM(st.cum.profit) + '</td>' +
            '<td class="r">' + st.green + '</td><td class="r">' + st.brand + '</td>' +
            '<td class="r">' + (E.bullwhipRatio(st) != null ? '×' + E.bullwhipRatio(st) : '–') + '</td>' +
            '<td class="r muted">' + (mins == null ? '–' : (mins < 1 ? 'now' : mins < 60 ? mins + 'm ago' : Math.round(mins / 60) + 'h ago')) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
      html += '<div class="card"><div class="card-title">Message all firms</div>' +
        '<p class="card-subtitle">Shows as a banner for every firm, whenever they next open their game.</p>' +
        '<textarea class="input" id="c-bc" placeholder="e.g. Finish your practice game before Thursday\'s class."></textarea>' +
        '<button class="btn btn-sm" id="c-bc-send" style="margin-top:8px;">Send</button></div></div>';
    }

    // --- world this round (admin eyes only)
    if (!isAsyncSess && (sess.phase === 'decisions' || sess.phase === 'resolved')) {
      var news = E.newsFor(sess, sess.round);
      html += '<div class="columns"><div class="card"><div class="card-title">World — round ' + sess.round + ' <span class="pill pill-plain">admin eyes only</span></div>' +
        '<div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr><th>Market</th><th class="r">True demand this round</th></tr></thead><tbody>' +
        E.activeMarkets(sess).map(function (m) {
          return '<tr><td>' + esc(m.name) + '</td><td class="r">' + fmtI(E.demandFor(sess, m.id, sess.round)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (news.length ? '<div class="mt16">' + news.map(function (n) { return '<div class="news-item"><span>' + esc(n.text) + '</span></div>'; }).join('') + '</div>' : '<p class="tiny muted mt16">No world events this round.</p>') +
        '</div>';

      // broadcast composer
      html += '<div class="card"><div class="card-title">Message all firms</div>' +
        '<p class="card-subtitle">Shows as a banner on every student screen (and in their news feed). Use it for hints, warnings, or theatre — “rumours of a tariff announcement…”.</p>' +
        '<textarea class="input" id="c-bc" placeholder="e.g. Reminder: 5 minutes left to submit round ' + sess.round + ' decisions."></textarea>' +
        '<button class="btn btn-sm" id="c-bc-send" style="margin-top:8px;">Send</button></div></div>';
    }

    // --- firms
    html += '<div class="card"><div class="row-between"><div class="card-title" style="margin:0;">Firms</div>' +
      (isAsyncSess ? '<span class="muted small">bots live inside each firm\'s own game</span>'
        : '<div class="flex-row"><select class="input input-sm" id="c-botprofile" style="width:auto;">' +
          '<option value="">Bot: cost-focused</option><option value="green">Bot: green-focused</option>' +
          '<option value="nash">Bot: optimal (Nash)</option></select>' +
          '<button class="btn-ghost btn-sm" id="c-addbot">+ Add bot firm</button></div>') + '</div>';
    if (!firms.length) html += '<p class="muted small">No firms yet. Students join at the link above.</p>';
    else {
      var states = ctrlStates();
      html += '<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Firm</th><th>Hub</th><th>Team</th>' +
        '<th class="r">Submitted</th><th class="r">Cash</th><th class="r">Cum. profit</th><th class="r">Green</th><th class="r">Brand</th><th></th></tr></thead><tbody>';
      firms.forEach(function (f) {
        var st = states[f.id];
        var dec = decisionOf(f.id, sess.round);
        var sub = f.isBot ? '🤖 auto' : (dec && dec.submitted ? '✔' : (dec ? 'draft' : '—'));
        html += '<tr><td>' + esc(f.name) + (f.isBot ? ' <span class="pill pill-plain">bot</span>' : '') + '</td>' +
          '<td>' + esc(sess.catalog.regions[f.hub].name) + '</td>' +
          '<td class="small muted">' + esc((f.members || []).map(function (m) { return m.name; }).join(', ')) + '</td>' +
          '<td class="r">' + (sess.phase === 'decisions' ? sub : '·') + '</td>' +
          '<td class="r ' + U.posneg(st.cash) + '">' + fmtM(st.cash) + '</td>' +
          '<td class="r ' + U.posneg(st.cum.profit) + '">' + fmtM(st.cum.profit) + '</td>' +
          '<td class="r">' + st.green + '</td><td class="r">' + st.brand + '</td>' +
          '<td><button class="link-btn danger c-kick" data-f="' + f.id + '">remove</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // --- messages: instructor <-> firm and firm <-> firm (all visible here)
    if (s.chatOn !== false) {
      var realFirms = firms.filter(function (f) { return !f.isBot; });
      html += '<div class="card"><div class="card-title">Messages</div>' +
        '<p class="card-subtitle">Everything firms write — to you or to each other — appears here. Reply to one firm below (use the broadcast box above for everyone).</p>';
      var msgs = (A.ctrl.messages || []).slice(-80);
      if (!msgs.length) html += '<p class="muted small">No messages yet.</p>';
      else {
        html += '<div style="max-height:260px; overflow:auto;">' + msgs.map(function (m) {
          var from = m.from === 'admin' ? 'You' : esc(m.fromName || m.from);
          var to = m.to === 'admin' ? 'you' : esc(m.toName || m.to);
          return '<div class="news-item"><span class="news-round">R' + (m.round || '·') + '</span>' +
            '<span><b>' + from + ' → ' + to + ':</b> ' + esc(m.text) + '</span></div>';
        }).join('') + '</div>';
      }
      html += '<div class="flex-row" style="margin-top:10px;"><select class="input input-sm" id="c-dm-to" style="width:auto; min-width:170px;">' +
        realFirms.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') +
        '</select><input class="input input-sm" id="c-dm-text" maxlength="500" placeholder="Message to this firm…" style="flex:1; min-width:200px;"/>' +
        '<button class="btn btn-sm" id="c-dm-send"' + (realFirms.length ? '' : ' disabled') + '>Send</button></div></div>';
    }

    // --- standings + bullwhip (live sessions; async has its own monitor)
    if (!isAsyncSess && A.ctrl.results.length) {
      var lb = E.leaderboard(sess, firms, ctrlStates());
      html += '<div class="card"><div class="card-title">Standings</div><div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr>' +
        '<th>#</th><th>Firm</th><th class="r">Profit</th><th class="r">Green</th><th class="r">CO2/unit</th><th class="r">Sold</th><th class="r">Bullwhip</th><th class="r">Score</th></tr></thead><tbody>' +
        lb.map(function (r, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td class="r ' + U.posneg(r.profit) + '">' + fmtM(r.profit) + '</td>' +
            '<td class="r">' + r.green + '</td><td class="r">' + (r.co2PerUnit != null ? r.co2PerUnit : '–') + '</td>' +
            '<td class="r">' + fmtI(r.sold) + '</td><td class="r">' + (r.bullwhip != null ? '×' + r.bullwhip : '–') + '</td>' +
            '<td class="r"><b>' + r.score + '</b></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="chart-box"><h4>Demand vs orders (class average per round)</h4>' + classBullwhipChart(sess) + '</div></div>';
    }

    box.innerHTML = html;
    if ($('#c-bc') && keepBc) $('#c-bc').value = keepBc;
    if ($('#c-dm-text') && keepDm) $('#c-dm-text').value = keepDm;
    if ($('#c-dm-to') && keepDmTo) $('#c-dm-to').value = keepDmTo;
    if ($('#c-botprofile') && keepProfile) $('#c-botprofile').value = keepProfile;
    if (keepFocusId && $('#' + keepFocusId)) {
      var foc = $('#' + keepFocusId);
      foc.focus();
      foc.setSelectionRange(foc.value.length, foc.value.length);
    }

    // wire up
    if ($('#c-archive')) $('#c-archive').addEventListener('click', function () {
      if (!confirm('End the practice window? The join code stops working and the session moves to Completed. All data is kept.')) return;
      ST.updateSession(sess.id, { archived: true, status: 'done', endedAt: Date.now() });
    });
    if ($('#c-start')) $('#c-start').addEventListener('click', function () {
      ST.updateSession(sess.id, { phase: 'decisions', round: 1, status: 'live',
                                  startedAt: Date.now(), roundOpenedAt: Date.now() });
      logEvA(sess.id, 'session_started', 1);
      logEvA(sess.id, 'round_opened', 1);
    });
    if ($('#c-resolve')) $('#c-resolve').addEventListener('click', function () { doResolve(sess); });
    if ($('#c-next')) $('#c-next').addEventListener('click', function () {
      ST.updateSession(sess.id, { phase: 'decisions', round: sess.round + 1, roundOpenedAt: Date.now() });
      logEvA(sess.id, 'round_opened', sess.round + 1);
    });
    if ($('#c-end')) $('#c-end').addEventListener('click', function () {
      if (!confirm('End the game now? Current standings become final.')) return;
      ST.updateSession(sess.id, { phase: 'final', status: 'done', endedAt: Date.now() });
      logEvA(sess.id, 'game_ended', sess.round, { forced: 1 });
    });
    if ($('#c-addbot')) $('#c-addbot').addEventListener('click', function () {
      var used = firms.map(function (f) { return f.name; });
      var name = BOT_NAMES.find(function (n) { return used.indexOf(n) === -1; }) || ('Bot ' + (firms.length + 1));
      var profile = $('#c-botprofile').value || null;
      var hubs = Object.keys(sess.catalog.regions);
      // custom catalogs may not have a 'europe' region — never hardcode a hub id
      var hub = (profile === 'green' && sess.catalog.regions.europe) ? 'europe'
              : hubs[firms.length % hubs.length];
      var fid = 'bot' + Math.random().toString(36).slice(2, 8);
      ST.setFirm(sess.id, fid, { id: fid, name: name, hub: hub, members: [], isBot: true,
                                 botProfile: profile, createdAt: Date.now() });
      logEvA(sess.id, 'bot_added', sess.round, { name: name, profile: profile || 'cost' });
    });
    if ($('#c-dm-send')) $('#c-dm-send').addEventListener('click', function () {
      var text = $('#c-dm-text').value.trim();
      var to = $('#c-dm-to').value;
      if (!text || !to) return;
      var toF = firms.find(function (f) { return f.id === to; });
      ST.saveMessage(sess.id, { from: 'admin', fromName: 'Instructor', to: to,
        toName: toF ? toF.name : to, text: text.slice(0, 500),
        round: sess.round || 0, at: Date.now() })
        .then(function () { if ($('#c-dm-text')) $('#c-dm-text').value = ''; });
    });
    if ($('#c-bc-send')) $('#c-bc-send').addEventListener('click', function () {
      var text = $('#c-bc').value.trim();
      if (!text) return;
      var bcs = (sess.broadcasts || []).concat([{ id: Date.now(), text: text, round: sess.round }]).slice(-25);
      ST.updateSession(sess.id, { broadcasts: bcs }).then(function () { $('#c-bc').value = ''; });
      logEvA(sess.id, 'broadcast', sess.round);
    });
    U.$all('.c-kick').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = firms.find(function (x) { return x.id === b.dataset.f; });
        if (!f || !confirm('Remove firm "' + f.name + '" from the game?')) return;
        ST.deleteFirm(sess.id, f.id);
        logEvA(sess.id, 'firm_removed', sess.round, { name: f.name });
      });
    });
  }

  function classBullwhipChart(sess) {
    var rounds = [];
    for (var r = 1; r <= sess.round; r++) rounds.push(r);
    var states = ctrlStates();
    function avg(key) {
      return rounds.map(function (r2) {
        var vals = [];
        A.ctrl.firms.forEach(function (f) {
          var h = (states[f.id].hist || []).find(function (x) { return x.round === r2; });
          if (h) vals.push(h[key]);
        });
        return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      });
    }
    return U.lineChart({ labels: rounds.map(function (r2) { return 'R' + r2; }), series: [
      { name: 'Avg consumer demand faced', values: avg('demand') },
      { name: 'Avg component sets ordered', color: '#1f5f8b', values: avg('ordered') }
    ] }) + U.legendHtml([{ name: 'Avg consumer demand faced' }, { name: 'Avg component sets ordered', color: '#1f5f8b' }]);
  }

  /* ---- round resolution -------------------------------------------------------------- */
  function doResolve(sess) {
    if (A.resolving) return;
    var firms = A.ctrl.firms;
    if (!firms.length) return;
    var humansPending = firms.filter(function (f) { return !f.isBot && !(decisionOf(f.id, sess.round) || {}).submitted; });
    if (humansPending.length &&
        !confirm(humansPending.length + ' firm(s) have not submitted (' +
          humansPending.map(function (f) { return f.name; }).join(', ') +
          ').\nResolve anyway? Their current draft (or a do-nothing plan) will be used.')) return;
    A.resolving = true;
    renderCtrl();
    try {
      var states = ctrlStates();
      var decisions = {}, botSaves = [];
      var nashIds = firms.filter(function (f) { return f.isBot && f.botProfile === 'nash'; })
        .map(function (f) { return f.id; });
      var nashDecs = nashIds.length ? E.nashDecisions(sess, firms, states, sess.round, nashIds) : {};
      firms.forEach(function (f) {
        if (f.isBot) {
          var bd = f.botProfile === 'nash' ? nashDecs[f.id]
            : E.botDecision(sess, f, states[f.id], sess.round, firms.length, f.botProfile);
          decisions[f.id] = bd;
          botSaves.push(ST.saveDecision(sess.id, f.id, sess.round, bd));
        } else {
          decisions[f.id] = decisionOf(f.id, sess.round);
        }
      });
      var out = E.resolveRound(sess, firms, states, decisions, sess.round);
      out.market.news = out.news;
      var last = sess.round >= sess.settings.rounds;
      var patch = last ? { phase: 'final', status: 'done', endedAt: Date.now() } : { phase: 'resolved' };
      Promise.all(botSaves).then(function () {
        return ST.saveResolution(sess.id, sess.round, { results: out.results, market: out.market, sessionPatch: patch });
      }).then(function () {
        A.resolving = false;
        logEvA(sess.id, 'round_resolved', sess.round,
          { secs: sess.roundOpenedAt ? Math.round((Date.now() - sess.roundOpenedAt) / 1000) : null });
        if (last) logEvA(sess.id, 'game_ended', sess.round);
      })
        .catch(function (e) { A.resolving = false; alert('Resolve failed: ' + e.message); renderCtrl(); });
    } catch (e) {
      A.resolving = false;
      alert('Resolve failed: ' + e.message);
      renderCtrl();
    }
  }

  /* ================= DATA & EXPORT ================================================== */
  function selectData(id) {
    if (!id) return;
    A.dataId = id;
    fillSelect($('#data-select'), id);
    A.data.unsubs.forEach(function (u) { u(); });
    A.data = { session: null, firms: [], decisions: [], results: [], markets: [], asyncs: [], unsubs: [] };
    A.data.unsubs.push(ST.watchSession(id, function (d) { A.data.session = d; renderData(); }));
    A.data.unsubs.push(ST.watchAsyncAll(id, function (d) { A.data.asyncs = d || []; renderData(); }));
    A.data.unsubs.push(ST.watchFirms(id, function (d) { A.data.firms = d || []; renderData(); }));
    A.data.unsubs.push(ST.watchDecisions(id, function (d) { A.data.decisions = d || []; renderData(); }));
    A.data.unsubs.push(ST.watchResults(id, function (d) { A.data.results = d || []; renderData(); }));
    A.data.unsubs.push(ST.watchMarkets(id, function (d) { A.data.markets = d || []; renderData(); }));
  }
  // In async sessions the authoritative results live inside each firm's
  // instance doc; the export keeps only the STUDENT firm's rows (its private
  // bot opponents would be noise across instances).
  function dataResults() {
    var sess = A.data.session;
    if (sess && sess.settings && sess.settings.asyncMode) {
      var out = [];
      (A.data.asyncs || []).forEach(function (inst) {
        (inst.results || []).forEach(function (r) { if (r.firmId === inst.firmId) out.push(r); });
      });
      return out;
    }
    return A.data.results.slice();
  }
  function renderData() {
    if ($('#tab-data').style.display === 'none') return;
    var sess = A.data.session, box = $('#data-root');
    if (!sess) { box.innerHTML = '<p class="muted" style="margin-top:16px;">Select a session.</p>'; return; }
    var res = dataResults().sort(function (a, b) { return a.round - b.round || String(a.firmId).localeCompare(String(b.firmId)); });
    var html = '<div class="stat-grid">' +
      '<div class="stat-box"><div class="n">' + A.data.firms.length + '</div><div class="l">Firms</div></div>' +
      '<div class="stat-box"><div class="n">' + (sess.settings.asyncMode
        ? (A.data.asyncs || []).filter(function (i2) { return i2.phase === 'final'; }).length + '/' + (A.data.asyncs || []).length
        : (sess.phase === 'lobby' ? 0 : (sess.phase === 'decisions' ? sess.round - 1 : Math.min(sess.round, sess.settings.rounds)))) +
      '</div><div class="l">' + (sess.settings.asyncMode ? 'Firms finished / started' : 'Rounds resolved') + '</div></div>' +
      '<div class="stat-box"><div class="n">' + A.data.decisions.length + '</div><div class="l">Decision records</div></div>' +
      '<div class="stat-box"><div class="n">' + res.length + '</div><div class="l">Result rows</div></div></div>';
    if (res.length) {
      html += '<h3>Firm-round results</h3><div class="tbl-scroll" style="max-height:420px;"><table class="tbl tbl-tight"><thead><tr>' +
        '<th>R</th><th>Firm</th><th class="r">Demand</th><th class="r">Sold</th><th class="r">Lost</th><th class="r">Cut</th>' +
        '<th class="r">Produced</th><th class="r">Revenue</th><th class="r">Profit</th><th class="r">CO2 gross</th><th class="r">Green</th><th class="r">Brand</th><th class="r">Cash</th></tr></thead><tbody>' +
        res.map(function (r) {
          var f = A.data.firms.find(function (x) { return x.id === r.firmId; }) || { name: r.firmId };
          var demand = sumSold(r.sold) + r.lost;
          return '<tr><td>' + r.round + '</td><td>' + esc(f.name) + '</td><td class="r">' + fmtI(demand) + '</td>' +
            '<td class="r">' + fmtI(sumSold(r.sold)) + '</td><td class="r">' + fmtI(r.lost) + '</td><td class="r">' + fmtI(r.cut) + '</td>' +
            '<td class="r">' + fmtI(r.produced) + '</td><td class="r">' + fmtM(r.revenue) + '</td>' +
            '<td class="r ' + U.posneg(r.profit) + '">' + fmtM(r.profit) + '</td><td class="r">' + U.fmtCO2(r.co2.gross) + '</td>' +
            '<td class="r">' + r.green + '</td><td class="r">' + r.brand + '</td><td class="r">' + (r.endState ? fmtM(r.endState.cash) : '–') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else html += '<p class="muted small">No rounds resolved yet.</p>';
    box.innerHTML = html;
  }
  function sumSold(o) { var t = 0; Object.keys(o || {}).forEach(function (k) { t += o[k]; }); return t; }

  $('#btn-json').addEventListener('click', function () {
    if (!A.data.session) return;
    U.download('ssc_' + A.data.session.code + '.json', JSON.stringify({
      session: A.data.session, firms: A.data.firms, decisions: A.data.decisions,
      results: A.data.results, markets: A.data.markets
    }, null, 1), 'application/json');
  });

  $('#btn-xlsx').addEventListener('click', function () {
    var sess = A.data.session;
    if (!sess) return;
    var isAsyncSess = !!(sess.settings && sess.settings.asyncMode);
    var firms = A.data.firms, res = dataResults(), mkts = A.data.markets;
    function firmName(id) { var f = firms.find(function (x) { return x.id === id; }); return f ? f.name : id; }

    var about = [['Sustainable Supply Chains — session export'], [],
      ['Session', sess.name || ''], ['Code', sess.code], ['Rounds', sess.settings.rounds],
      ['Status', sess.status + ' / ' + sess.phase], ['Product', sess.catalog.product.name],
      ['Markets open', sess.settings.markets.join(', ')],
      ['Demand pattern', sess.settings.demandPattern], ['Carbon tax $/t', sess.settings.carbonTaxPerTon],
      ['Score weight profit %', sess.settings.scoreWeightProfit], [],
      ['Sheets: Firms · Rounds (one row per firm-round) · OrderLines (every supplier order line, with pro-rata cuts) · Markets (true demand & per-firm sales) · Standings']];

    var firmsRows = [['Firm ID', 'Name', 'Hub', 'Bot', 'Bot profile', 'Team members']];
    firms.forEach(function (f) {
      firmsRows.push([f.id, f.name, f.hub, f.isBot ? 1 : 0, f.botProfile || '',
        (f.members || []).map(function (m) { return m.name; }).join(', ')]);
    });

    var roundRows = [['Round', 'Firm', 'Hub', 'Demand faced', 'Units sold', 'Lost sales', 'Order units cut',
      'Produced', 'Revenue', 'Purchases', 'Inbound freight', 'Import tariffs', 'Production cost',
      'Outbound freight', 'Export tariffs', 'Holding', 'Overhead', 'Carbon tax', 'Offsets cost',
      'Investments', 'Interest', 'Profit', 'CO2 components', 'CO2 inbound freight', 'CO2 assembly',
      'CO2 outbound freight', 'CO2 gross', 'Offset kg', 'Green score', 'Brand', 'Scandal', 'Cash end']];
    res.slice().sort(function (a, b) { return a.round - b.round; }).forEach(function (r) {
      var f = firms.find(function (x) { return x.id === r.firmId; }) || {};
      roundRows.push([r.round, firmName(r.firmId), f.hub || '', sumSold(r.sold) + r.lost, sumSold(r.sold), r.lost,
        r.cut, r.produced, r.revenue, r.costs.purchase, r.costs.inFreight, r.costs.inTariff, r.costs.production,
        r.costs.outFreight, r.costs.outTariff, r.costs.holding, r.costs.overhead, r.costs.carbonTax,
        r.costs.offsets, r.costs.investments, r.costs.interest, r.profit,
        r.co2.components, r.co2.inFreight, r.co2.assembly, r.co2.outFreight, r.co2.gross, r.co2.offsets,
        r.green, r.brand, r.scandal ? 1 : 0, r.endState ? r.endState.cash : null]);
    });

    var lineRows = [['Round', 'Firm', 'Component', 'Supplier', 'Mode', 'Requested', 'Allocated', 'Cut',
      'Lead (rounds)', 'Landed cost', 'CO2 kg']];
    res.slice().sort(function (a, b) { return a.round - b.round; }).forEach(function (r) {
      (r.orderLines || []).forEach(function (l) {
        var comp = E.findComponent(sess.catalog, l.compId);
        var sup = comp ? E.findSupplier(comp, l.supplierId) : null;
        lineRows.push([r.round, firmName(r.firmId), comp ? comp.name : l.compId,
          sup ? sup.name : l.supplierId, l.mode, l.requested, l.qty, l.cut, l.lead,
          Math.round(l.cost), Math.round(l.co2)]);
      });
    });

    var mktRows = [['Round', 'Market', 'True demand', 'Avg price'].concat(firms.map(function (f) { return 'Sold: ' + f.name; }))];
    mkts.slice().sort(function (a, b) { return a.round - b.round; }).forEach(function (m) {
      Object.keys(m.demand).forEach(function (mid) {
        var mk = E.findMarket(sess.catalog, mid);
        mktRows.push([m.round, mk ? mk.name : mid, m.demand[mid], m.avgPrice[mid]]
          .concat(firms.map(function (f) { return (m.sales[mid] || {})[f.id] || 0; })));
      });
    });

    var lb = E.leaderboard(sess, firms, (function () {
      var out = {};
      firms.forEach(function (f) {
        if (isAsyncSess) {
          var inst = (A.data.asyncs || []).find(function (i2) { return i2.firmId === f.id; });
          out[f.id] = inst && inst.states && inst.states[f.id] ? inst.states[f.id] : E.initFirmState(sess, f);
          return;
        }
        var rs = res.filter(function (r) { return r.firmId === f.id; }).sort(function (a, b) { return a.round - b.round; });
        out[f.id] = rs.length ? rs[rs.length - 1].endState : E.initFirmState(sess, f);
      });
      return out;
    })());
    var lbRows = [['Rank', 'Firm', 'Hub', 'Cumulative profit', 'Green score', 'CO2/unit', 'Units sold', 'Scandals', 'Bullwhip ratio', 'Score']];
    lb.forEach(function (r, i) {
      lbRows.push([i + 1, r.name, r.hub, r.profit, r.green, r.co2PerUnit, r.sold, r.scandals, r.bullwhip, r.score]);
    });

    var settingsRows = [['Setting', 'Value']];
    Object.keys(sess.settings).forEach(function (k) {
      var v = sess.settings[k];
      settingsRows.push([k, typeof v === 'object' ? JSON.stringify(v) : v]);
    });

    var sheets = [
      { name: 'About', rows: about, filter: false, cols: [{ w: 40 }, { w: 60 }] },
      { name: 'Settings', rows: settingsRows, cols: [{ w: 26 }, { w: 60 }] },
      { name: 'Firms', rows: firmsRows, cols: [{ w: 12 }, { w: 22 }, { w: 12 }, { w: 6 }, { w: 10 }, { w: 30 }] },
      { name: 'Rounds', rows: roundRows },
      { name: 'OrderLines', rows: lineRows }
    ];
    if (!isAsyncSess) sheets.push({ name: 'Markets', rows: mktRows });
    sheets.push({ name: 'Standings', rows: lbRows });
    // raw action log + per-firm-round decision timing, fetched fresh
    ST.fetchAll(sess.id).then(function (pack) {
      function iso(t) { return t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : ''; }
      var evRows = [['Time (UTC)', 'Epoch ms', 'Type', 'Round', 'Firm', 'Member', 'UID', 'Details']];
      pack.events.forEach(function (e) {
        evRows.push([iso(e.at), e.at, e.type, e.round,
          e.firmId === 'admin' ? 'admin' : firmName(e.firmId), e.member || '', e.uid || '',
          JSON.stringify(e.d || {})]);
      });
      var tRows = [['Firm', 'Round', 'First save (UTC)', 'Draft saves', 'Submitted (UTC)', 'Seconds open→submit']];
      var byFR = {};
      pack.events.forEach(function (e) {
        if (!e.firmId || e.firmId === 'admin') return;
        var k = e.firmId + '|' + e.round;
        if (!byFR[k]) byFR[k] = { firmId: e.firmId, round: e.round, saves: 0, firstSave: null, submit: null, secs: null };
        if (e.type === 'decision_saved') {
          byFR[k].saves++;
          if (!byFR[k].firstSave) byFR[k].firstSave = e.at;
        }
        if (e.type === 'decision_submitted') { byFR[k].submit = e.at; byFR[k].secs = e.d && e.d.secs; }
      });
      Object.keys(byFR).map(function (k) { return byFR[k]; })
        .sort(function (a, b) { return a.round - b.round || String(a.firmId).localeCompare(String(b.firmId)); })
        .forEach(function (t) {
          tRows.push([firmName(t.firmId), t.round, iso(t.firstSave), t.saves, iso(t.submit), t.secs]);
        });
      var dur = sess.startedAt && sess.endedAt ? Math.round((sess.endedAt - sess.startedAt) / 60000) : null;
      sheets[0].rows.push([], ['Session started', iso(sess.startedAt)], ['Session ended', iso(sess.endedAt)],
        ['Duration (minutes)', dur]);
      sheets.push({ name: 'Timing', rows: tRows });
      sheets.push({ name: 'Events', rows: evRows, cols: [{ w: 20 }, { w: 14 }, { w: 18 }, { w: 7 }, { w: 20 }, { w: 14 }, { w: 16 }, { w: 40 }] });
      window.SSCXlsx.download('ssc_' + sess.code + '_data.xlsx', sheets);
    }).catch(function () {
      window.SSCXlsx.download('ssc_' + sess.code + '_data.xlsx', sheets);
    });
  });

  /* ================= ANALYTICS (cross-session KPIs) ============================== */
  A.an = { rows: [], sessions: [], loaded: false };

  function paintAnalyticsPicker() {
    var box = $('#an-picker');
    if (!box) return;
    if (!A.sessions.length) { box.innerHTML = '<p class="muted small">No sessions yet.</p>'; return; }
    box.innerHTML = A.sessions.map(function (s2) {
      return '<label class="checkline"><input type="checkbox" class="an-pick" data-id="' + s2.id + '"/><span>' +
        esc(s2.name || s2.code) + ' <span class="sess-code">' + esc(s2.code) + '</span>' +
        ((s2.settings || {}).asyncMode ? ' <span class="pill pill-blue">async</span>' : '') +
        ' <span class="tiny muted">· ' + (s2.status || '') + '</span></span></label>';
    }).join('');
  }

  function sessionDuration(sess, events) {
    var start = sess.startedAt || null, end = sess.endedAt || null;
    if (!start && events.length) start = events[0].at;
    if (!end && events.length) end = events[events.length - 1].at;
    return start && end && end > start ? Math.round((end - start) / 60000) : null;
  }

  // one KPI row per firm per session
  function firmKPIs(pack, firm) {
    var sess = pack.session, isA = !!(sess.settings || {}).asyncMode;
    var inst = isA ? pack.asyncs.find(function (i2) { return i2.firmId === firm.id; }) : null;
    var res = (isA ? (inst ? inst.results : []) : pack.results)
      .filter(function (r) { return r.firmId === firm.id; })
      .sort(function (a, b) { return a.round - b.round; });
    var st = isA ? (inst && inst.states[firm.id]) :
      (res.length ? res[res.length - 1].endState : null);
    if (!st) return null;
    var hist = st.hist || [];
    var demand = 0, sold = 0, cuts = 0;
    hist.forEach(function (h) { demand += h.demand; sold += h.sold; cuts += (h.cut || 0); });
    var holding = 0, freight = 0, tariffs = 0, lineCost = 0, lineUnits = 0, airCost = 0;
    res.forEach(function (r) {
      holding += r.costs.holding; freight += r.costs.inFreight + r.costs.outFreight;
      tariffs += r.costs.inTariff + r.costs.outTariff;
      (r.orderLines || []).forEach(function (l) {
        lineCost += l.cost; lineUnits += l.qty;
        if (l.mode === 'air') airCost += l.cost;
      });
    });
    var nComp = sess.catalog.components.length;
    var kitsBought = lineUnits / Math.max(1, nComp);
    var cheap = E.cheapestKit(sess, st.hub, 1).kitCost;
    var premium = kitsBought > 20 ? Math.round(((lineCost / kitsBought) - cheap) / cheap * 1000) / 10 : null;
    var subs = pack.events.filter(function (e) { return e.type === 'decision_submitted' && e.firmId === firm.id && e.d && e.d.secs != null; });
    var saves = pack.events.filter(function (e) { return e.type === 'decision_saved' && e.firmId === firm.id; }).length;
    var avgSecs = subs.length ? Math.round(subs.reduce(function (a, e) { return a + e.d.secs; }, 0) / subs.length) : null;
    return {
      session: sess.code, mode: isA ? 'async' : 'live', firm: firm.name, hub: st.hub,
      bot: firm.isBot ? (firm.botProfile || 'cost') : '',
      rounds: hist.length,
      profit: Math.round(st.cum.profit), revenue: Math.round(st.cum.revenue), sold: sold,
      fill: demand > 0 ? Math.round(sold / demand * 1000) / 10 : null,
      bullwhip: E.bullwhipRatio(st),
      green: st.green, brand: st.brand,
      co2PerUnit: st.cum.produced > 0 ? Math.round(st.cum.prodCO2 / st.cum.produced) : null,
      holding: Math.round(holding), freight: Math.round(freight), tariffs: Math.round(tariffs),
      airSharePct: lineCost > 0 ? Math.round(airCost / lineCost * 1000) / 10 : 0,
      sourcingPremiumPct: premium, cuts: cuts, scandals: st.cum.scandals,
      submits: subs.length, avgSecsToSubmit: avgSecs, saves: saves
    };
  }

  var KPI_COLS = [
    ['profit', 'Profit $'], ['revenue', 'Revenue $'], ['fill', 'Fill rate %'],
    ['bullwhip', 'Bullwhip ×'], ['green', 'Green'], ['co2PerUnit', 'CO2/unit kg'],
    ['holding', 'Holding $'], ['freight', 'Freight $'], ['tariffs', 'Tariffs $'],
    ['airSharePct', 'Air share %'], ['sourcingPremiumPct', 'Sourcing premium %'],
    ['cuts', 'Units cut'], ['scandals', 'Scandals'], ['avgSecsToSubmit', 'Avg secs to submit'],
    ['saves', 'Draft saves']
  ];
  function statsOf(vals) {
    var v = vals.filter(function (x) { return x != null && isFinite(x); }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var med = v[Math.floor((v.length - 1) / 2)];
    var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / v.length);
    function r2(x) { return Math.round(x * 100) / 100; }
    return { n: v.length, mean: r2(mean), median: r2(med), sd: r2(sd), min: r2(v[0]), max: r2(v[v.length - 1]) };
  }

  $('#an-load').addEventListener('click', function () {
    var ids = U.$all('.an-pick').filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.id; });
    if (!ids.length) { $('#an-root').innerHTML = '<p class="muted" style="margin-top:12px;">Tick at least one session.</p>'; return; }
    $('#an-load').disabled = true;
    Promise.all(ids.map(function (id) { return ST.fetchAll(id); })).then(function (packs) {
      $('#an-load').disabled = false;
      var withBots = $('#an-bots').checked;
      var rows = [], sessRows = [];
      packs.forEach(function (pack) {
        if (!pack.session) return;
        var fr = [];
        pack.firms.forEach(function (f) {
          if (f.isBot && !withBots) return;
          var row = firmKPIs(pack, f);
          if (row) fr.push(row);
        });
        rows = rows.concat(fr);
        sessRows.push({
          session: pack.session.code, name: pack.session.name || '',
          mode: (pack.session.settings || {}).asyncMode ? 'async' : 'live',
          firms: fr.length, roundsPlanned: (pack.session.settings || {}).rounds,
          durationMin: sessionDuration(pack.session, pack.events),
          events: pack.events.length, messages: pack.messages.length,
          avgProfit: statsOf(fr.map(function (r) { return r.profit; })),
          avgFill: statsOf(fr.map(function (r) { return r.fill; }))
        });
      });
      A.an = { rows: rows, sessions: sessRows, loaded: true };
      $('#an-xlsx').style.display = ''; $('#an-csv').style.display = '';
      renderAnalytics();
    }).catch(function (e) { $('#an-load').disabled = false; alert('Load failed: ' + e.message); });
  });

  function renderAnalytics() {
    var box = $('#an-root'), rows = A.an.rows;
    if (!rows.length) { box.innerHTML = '<p class="muted" style="margin-top:12px;">No firms in the selected sessions (or only bots — tick “include bot firms”).</p>'; return; }
    var html = '<div class="stat-grid">' +
      '<div class="stat-box"><div class="n">' + A.an.sessions.length + '</div><div class="l">Sessions</div></div>' +
      '<div class="stat-box"><div class="n">' + rows.length + '</div><div class="l">Firms</div></div>' +
      '<div class="stat-box"><div class="n">' + (statsOf(rows.map(function (r) { return r.profit; })) || {}).mean + '</div><div class="l">Mean profit $</div></div>' +
      '<div class="stat-box"><div class="n">' + ((statsOf(rows.map(function (r) { return r.fill; })) || {}).mean || '–') + '</div><div class="l">Mean fill %</div></div>' +
      '<div class="stat-box"><div class="n">' + ((statsOf(rows.map(function (r) { return r.bullwhip; })) || {}).median || '–') + '</div><div class="l">Median bullwhip ×</div></div>' +
      '<div class="stat-box"><div class="n">' + ((statsOf(A.an.sessions.map(function (r) { return r.durationMin; })) || {}).mean || '–') + '</div><div class="l">Mean duration min</div></div></div>';

    // per-firm KPI table
    html += '<div class="card"><div class="card-title">Firm KPIs</div><div class="tbl-scroll" style="max-height:420px;"><table class="tbl tbl-tight"><thead><tr>' +
      '<th>Session</th><th>Firm</th><th>Hub</th><th>Bot</th><th class="r">Rounds</th>' +
      KPI_COLS.map(function (c) { return '<th class="r">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.session) + ' <span class="tiny muted">' + r.mode + '</span></td><td>' + esc(r.firm) + '</td>' +
          '<td>' + esc(r.hub) + '</td><td>' + esc(r.bot) + '</td><td class="r">' + r.rounds + '</td>' +
          KPI_COLS.map(function (c) {
            var v = r[c[0]];
            var cls = c[0] === 'profit' ? U.posneg(v) : '';
            return '<td class="r ' + cls + '">' + (v == null ? '–' : (c[0] === 'profit' || c[0] === 'revenue' || c[0] === 'holding' || c[0] === 'freight' || c[0] === 'tariffs' ? fmtI(v) : v)) + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></div>';

    // summary statistics
    html += '<div class="card"><div class="card-title">Summary statistics (across firms)</div><div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr>' +
      '<th>KPI</th><th class="r">n</th><th class="r">Mean</th><th class="r">Median</th><th class="r">SD</th><th class="r">Min</th><th class="r">Max</th></tr></thead><tbody>' +
      KPI_COLS.map(function (c) {
        var st = statsOf(rows.map(function (r) { return r[c[0]]; }));
        if (!st) return '';
        return '<tr><td>' + c[1] + '</td><td class="r">' + st.n + '</td><td class="r">' + fmtI2(st.mean) + '</td>' +
          '<td class="r">' + fmtI2(st.median) + '</td><td class="r">' + fmtI2(st.sd) + '</td>' +
          '<td class="r">' + fmtI2(st.min) + '</td><td class="r">' + fmtI2(st.max) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // per-session comparison
    html += '<div class="card"><div class="card-title">Session comparison</div><div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr>' +
      '<th>Session</th><th>Mode</th><th class="r">Firms</th><th class="r">Duration min</th><th class="r">Mean profit $</th><th class="r">Mean fill %</th><th class="r">Events</th><th class="r">Messages</th></tr></thead><tbody>' +
      A.an.sessions.map(function (r) {
        return '<tr><td>' + esc(r.session) + (r.name ? ' <span class="tiny muted">' + esc(r.name) + '</span>' : '') + '</td>' +
          '<td>' + r.mode + '</td><td class="r">' + r.firms + '</td><td class="r">' + (r.durationMin != null ? r.durationMin : '–') + '</td>' +
          '<td class="r">' + (r.avgProfit ? fmtI(r.avgProfit.mean) : '–') + '</td><td class="r">' + (r.avgFill ? r.avgFill.mean : '–') + '</td>' +
          '<td class="r">' + r.events + '</td><td class="r">' + r.messages + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // charts
    function label(r) { return r.firm + ' (' + r.session + ')'; }
    html += '<div class="columns"><div class="chart-box"><h4>Cumulative profit by firm</h4>' +
      U.barChart({ items: rows.map(function (r) { return { label: label(r), value: r.profit, color: r.bot ? '#4a4f55' : '#c8562a' }; }),
                   fmt: function (v) { return fmtM(v); }, padL: 170 }) + '</div>' +
      '<div class="chart-box"><h4>Bullwhip ratio by firm (steady middle)</h4>' +
      U.barChart({ items: rows.map(function (r) { return { label: label(r), value: r.bullwhip || 0, color: r.bot ? '#4a4f55' : '#1f5f8b' }; }),
                   fmt: function (v) { return '×' + v; }, padL: 170 }) + '</div></div>' +
      '<div class="columns"><div class="chart-box"><h4>Service level (fill %) by firm</h4>' +
      U.barChart({ items: rows.map(function (r) { return { label: label(r), value: r.fill || 0, color: r.bot ? '#4a4f55' : '#2e7d32' }; }), padL: 170 }) + '</div>' +
      '<div class="chart-box"><h4>Avg seconds to submit a round</h4>' +
      U.barChart({ items: rows.filter(function (r) { return r.avgSecsToSubmit != null; })
        .map(function (r) { return { label: label(r), value: r.avgSecsToSubmit, color: '#8e5bc0' }; }), padL: 170 }) + '</div></div>';

    box.innerHTML = html;
  }
  function fmtI2(v) { return v == null ? '–' : (Math.abs(v) >= 1000 ? fmtI(v) : v); }

  var AN_HEADERS = ['Session', 'Mode', 'Firm', 'Hub', 'Bot', 'Rounds'].concat(KPI_COLS.map(function (c) { return c[1]; }));
  function anMatrix() {
    return [AN_HEADERS].concat(A.an.rows.map(function (r) {
      return [r.session, r.mode, r.firm, r.hub, r.bot, r.rounds].concat(KPI_COLS.map(function (c) { return r[c[0]]; }));
    }));
  }
  $('#an-xlsx').addEventListener('click', function () {
    if (!A.an.loaded) return;
    var summary = [['KPI', 'n', 'Mean', 'Median', 'SD', 'Min', 'Max']];
    KPI_COLS.forEach(function (c) {
      var st = statsOf(A.an.rows.map(function (r) { return r[c[0]]; }));
      if (st) summary.push([c[1], st.n, st.mean, st.median, st.sd, st.min, st.max]);
    });
    var sessSheet = [['Session', 'Name', 'Mode', 'Firms', 'Planned rounds', 'Duration min', 'Events', 'Messages', 'Mean profit', 'Mean fill %']]
      .concat(A.an.sessions.map(function (r) {
        return [r.session, r.name, r.mode, r.firms, r.roundsPlanned, r.durationMin, r.events, r.messages,
                r.avgProfit ? r.avgProfit.mean : null, r.avgFill ? r.avgFill.mean : null];
      }));
    window.SSCXlsx.download('ssc_analytics.xlsx', [
      { name: 'FirmKPIs', rows: anMatrix() },
      { name: 'Summary', rows: summary },
      { name: 'Sessions', rows: sessSheet }
    ]);
  });
  $('#an-csv').addEventListener('click', function () {
    if (!A.an.loaded) return;
    var csv = anMatrix().map(function (row) {
      return row.map(function (v) {
        var t = v == null ? '' : String(v);
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      }).join(',');
    }).join('\n');
    U.download('ssc_analytics.csv', csv, 'text/csv');
  });
})();
