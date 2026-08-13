/* ==========================================================================
   search-v2  ·  admin/admin.js
   The admin panel of design brief §17b, restructured to its six screens:

     1 Runs           — every run, its status, its participants, its balance
     2 Parameters     — six collapsible groups, locked once a run has an entrant
     3 Consequences   — recomputed live beside the form, with the two badges
     4 Roster         — anonymous codes, sequence assignment, entrant override
     5 Live monitor   — counters from a Firestore listener, plus the health strip
     6 Data & preview — validation gate, spec preview, dry run, export, danger zone

   The governing rule is CLONE, DO NOT EDIT. A run's parameters are locked the
   moment its first participant claims a code; the locked fields render greyed
   with a padlock, and the only way to change anything is to clone the run into a
   fresh run_id. Locking here is UI; the Security Rules in ../firestore.rules are
   what actually enforce it.
   ========================================================================== */
(function () {
  'use strict';
  var CFG = window.CONFIG, Pool = window.SVPool, Specs = window.SVSpecs,
      Ai = window.SVAi, Content = window.SVContent, X = window.SVExport, Xlsx = window.SVXlsx;
  var FB = window.SVFirebase;

  var runs = [], current = null, currentParams = null, editingId = null;
  var events = [], built = null, unsubMon = null, monRows = [];
  var LOCAL_KEY = 'searchv2:v3:admin:local';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmt(n, d) { return (n == null || !isFinite(n)) ? '—' : (+n).toFixed(d == null ? 2 : d); }
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
  }
  function note(el, html, bad) {
    var e = $(el);
    e.className = 'admin-note' + (bad ? ' bad' : '');
    e.innerHTML = html;
    e.style.display = html ? '' : 'none';
  }

  // ---- theme ---------------------------------------------------------------
  (function theme() {
    var saved = null;
    try { saved = localStorage.getItem('searchv2:admin:theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', function () {
      $('btn-theme').onclick = function () {
        var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', now);
        try { localStorage.setItem('searchv2:admin:theme', now); } catch (e) {}
      };
    });
  })();

  // ======================================================================
  //  AUTH
  // ======================================================================
  function boot() {
    wireTabs();
    wireForm();
    wireRuns();
    wireRoster();
    wireMonitor();
    wireData();

    // The parameter form carries its values from the moment the panel opens, so a
    // box is never blank beside its own "default 100" hint. Selecting a run, or
    // starting a new one, overwrites this. It matters most when the runs read
    // FAILS — a fresh project whose Rules are not published yet — because that
    // path used to leave the whole form empty, with nothing to read the defaults
    // off and nothing to save.
    currentParams = savedDefaultParams();
    fillForm(currentParams, null);

    if (!FB.isConfigured()) {
      // Local preview: the panel is fully usable against browser storage, so the
      // parameter form, the consequences, the validation gate, the preview and
      // the dry run all work before Firebase is set up.
      $('li-note').textContent = 'Firebase is not configured, so this panel is in LOCAL PREVIEW: runs are kept in this browser only.';
      $('btn-login').onclick = function () { enterLocal(); };
      $('li-email').value = 'local'; $('li-pw').value = 'local';
      enterLocal();
      return;
    }
    $('li-note').textContent = 'Sign in with the admin account for this Firebase project.';
    $('btn-login').onclick = doLogin;
    $('li-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    FB.onAuth(function (user) {
      if (user && !user.isAnonymous) {
        $('who').textContent = user.email || '';
        $('btn-signout').style.display = '';
        $('btn-signout').onclick = function () { FB.adminSignOut().then(function () { location.reload(); }); };
        show('a-dash');
        note('scope-note', 'Signed in as <b>' + esc(user.email) + '</b>. Runs, roster, participants and the event log are read from Firestore.');
        loadRuns();
      } else {
        show('a-login');
      }
    });
  }
  function doLogin() {
    $('li-err').style.display = 'none';
    FB.adminSignIn($('li-email').value.trim(), $('li-pw').value).catch(function (e) {
      $('li-err').textContent = String((e && e.message) || e).replace(/^Firebase:\s*/, '');
      $('li-err').style.display = 'block';
    });
  }
  var LOCAL = false;
  function enterLocal() {
    LOCAL = true;
    show('a-dash');
    $('who').textContent = 'local preview';
    note('scope-note', '<b>Local preview.</b> Firebase is not configured (or you have not signed in), so runs live in ' +
      'this browser only and no participant data can be read. Everything else &mdash; parameters, consequences, ' +
      'validation, preview and the dry run &mdash; works exactly as it will live.');
    loadRuns();
  }

  // ---- local-mode storage --------------------------------------------------
  function localRuns() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLocalRuns(list) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // ======================================================================
  //  TABS
  // ======================================================================
  function wireTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === t); });
        ['runs', 'params', 'roster', 'monitor', 'data'].forEach(function (k) {
          $('tab-' + k).style.display = (k === t.dataset.tab) ? '' : 'none';
        });
        if (t.dataset.tab === 'roster') renderRoster();
        if (t.dataset.tab === 'monitor') startMonitor();
        if (t.dataset.tab === 'data') fillSpecPicker();
      };
    });
  }
  function openTab(name) {
    var t = document.querySelector('.tab[data-tab="' + name + '"]');
    if (t) t.click();
  }

  // ======================================================================
  //  SCREEN 1 · RUNS
  // ======================================================================
  function wireRuns() {
    $('btn-new-run').onclick = function () {
      current = null; editingId = null;
      currentParams = savedDefaultParams();
      fillForm(currentParams, null);
      openTab('params');
      note('save-note', 'A new run, seeded from the saved defaults. Give it a name and a code, then Save.');
    };
    $('btn-refresh-runs').onclick = loadRuns;
  }

  function savedDefaultParams() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem('searchv2:v3:admin:defaults') || 'null'); } catch (e) {}
    return Specs.withDefaults(d);
  }

  function loadRuns() {
    var p = LOCAL ? Promise.resolve(localRuns()) : FB.listRuns();
    p.then(function (list) {
      runs = list || [];
      renderRuns();
      loadRunStats();
      if (!current && runs.length) selectRun(runs[0]);
      else if (!current) {
        currentParams = savedDefaultParams();
        fillForm(currentParams, null);
      }
    }).catch(function (e) {
      note('scope-note', 'Could not read the runs collection: <b>' + esc(String(e && e.message || e)) + '</b>. ' +
        'If this is a fresh project, publish <span class="mono">firestore.rules</span> from the repository first.', true);
      runs = []; renderRuns();
      // Leave the form standing on the defaults rather than blanking it: the
      // panel is still usable for reading and adjusting parameters, and the
      // failure above is about Firestore, not about this form.
      if (!current) { currentParams = savedDefaultParams(); fillForm(currentParams, null); }
    });
  }

  // §17b Screen 1 asks each row for "participants started and completed, and the
  // sequence balance so far". Those come from the participants collection, which
  // is small enough to read whole — the event log is never scanned for a counter.
  function loadRunStats() {
    if (LOCAL || !FB.isConfigured() || !runs.length) return;
    FB.listParticipants(null).then(function (all) {
      var by = {};
      (all || []).forEach(function (p) {
        var k = p.run_id || '';
        if (!by[k]) by[k] = { started: 0, completed: 0, nA: 0, nB: 0 };
        by[k].started++;
        if (p.completed) by[k].completed++;
        if (p.sequence === 'A') by[k].nA++;
        else if (p.sequence === 'B') by[k].nB++;
      });
      runs.forEach(function (r) {
        var s = by[r.id];
        if (s) { r.stats = { started: s.started, completed: s.completed }; r.counts = { nA: s.nA, nB: s.nB }; }
      });
      renderRuns();
    }).catch(function () { /* the rules may not be published yet — the rows just show dashes */ });
  }

  function renderRuns() {
    var host = $('runs-list');
    if (!runs.length) {
      host.innerHTML = '<div class="card muted">No runs yet. <b>+ New run</b> starts one from the recommended defaults.</div>';
      return;
    }
    host.innerHTML = runs.map(function (r) {
      var st = r.status || 'draft';
      var bal = (r.counts ? (r.counts.nA || 0) + ' A / ' + (r.counts.nB || 0) + ' B' : '—');
      return '<div class="run-card" data-id="' + esc(r.id) + '">' +
        '<div class="run-head">' +
          '<div><div class="run-title">' + esc(r.name || 'untitled') +
            '<span class="status ' + esc(st) + '">' + esc(st) + '</span>' +
            (r.locked ? ' <span class="lock-tag">🔒 locked</span>' : '') + '</div>' +
            '<div class="run-meta">code <b>' + esc(r.code || '—') + '</b> · run_id <span class="mono">' + esc(r.id) + '</span><br>' +
            'created ' + esc(r.createdAt ? new Date(r.createdAt).toLocaleString() : '—') +
            ' · started ' + (r.stats ? (r.stats.started || 0) : 0) +
            ' · completed ' + (r.stats ? (r.stats.completed || 0) : 0) +
            ' · sequence balance ' + esc(bal) + '</div></div>' +
          '<div class="run-meta">' + (r.code ? 'participant link:<br><span class="mono">' + esc(launchUrl(r.code)) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="run-acts">' +
          '<button class="sBtn sBtnPrimary" data-act="open">Open</button>' +
          '<button class="sBtn sBtnSec" data-act="clone">Clone this run</button>' +
          '<button class="sBtn sBtnSec" data-act="copy">Copy link</button>' +
          '<button class="sBtn sBtnSec" data-act="testround">🧪 Test round</button>' +
          '<button class="sBtn exportBtn" data-act="export">⬇ Export</button>' +
          (st === 'open' ? '<button class="sBtn closeBtn" data-act="close">Close</button>'
                         : '<button class="sBtn sBtnSec" data-act="open-entry">Open entry</button>') +
          '<button class="sBtn deleteBtn" data-act="delete">Delete</button>' +
        '</div></div>';
    }).join('');

    host.querySelectorAll('.run-card').forEach(function (card) {
      var run = runs.filter(function (r) { return r.id === card.dataset.id; })[0];
      card.querySelectorAll('button[data-act]').forEach(function (b) {
        b.onclick = function () { runAction(b.dataset.act, run, b); };
      });
    });
  }

  function launchUrl(code) {
    var base = location.origin + location.pathname.replace(/admin\/?$/, '');
    return base + '?code=' + encodeURIComponent(code);
  }
  // ONE builder for every sandbox link, so the launch box and the cards can never
  // open different things.
  function previewUrl(code, spec) {
    var base = location.origin + location.pathname.replace(/admin\/?$/, '');
    return base + '?preview=1&debug=1&key=' + encodeURIComponent(CFG.DEBUG_KEY) +
      (code ? '&code=' + encodeURIComponent(code) : '') +
      (spec ? '&spec=' + encodeURIComponent(spec) : '');
  }

  function runAction(act, run, btn) {
    if (!run) return;
    if (act === 'open') { selectRun(run); openTab('params'); return; }
    if (act === 'copy') {
      navigator.clipboard.writeText(launchUrl(run.code)).then(function () {
        var old = btn.textContent; btn.textContent = '✓ Copied';
        setTimeout(function () { btn.textContent = old; }, 1400);
      }); return;
    }
    if (act === 'testround') { window.open(previewUrl(run.code), '_blank'); return; }
    if (act === 'export') { selectRun(run); openTab('data'); loadEvents(); return; }
    if (act === 'clone') { cloneRun(run); return; }
    if (act === 'close') { setStatus(run, 'closed'); return; }
    if (act === 'open-entry') { setStatus(run, 'open'); return; }
    if (act === 'delete') {
      if (!confirm('Delete the run "' + (run.name || run.id) + '"? Collected event rows are kept — use the danger zone to remove data.')) return;
      (LOCAL ? Promise.resolve(saveLocalRuns(localRuns().filter(function (r) { return r.id !== run.id; })))
             : FB.deleteRun(run.id).then(function () { return FB.audit(run.id, 'delete_run', run.name); }))
        .then(function () { current = null; loadRuns(); });
    }
  }

  function setStatus(run, status) {
    if (status === 'open') {
      // §17b Screen 6: a run cannot move from draft to open until the validation
      // gate passes. (Built once — regenerating a 600-mapping pool twice for the
      // same check is pure waste.)
      var a = artifacts(run);
      var v = Specs.validate(a.pool, a.specs, a.params);
      if (!v.pass) {
        alert('This run cannot open until the validation gate passes:\n\n• ' + v.failures.join('\n• '));
        return;
      }
    }
    var patch = { status: status, ops: Object.assign({}, run.ops || {}, { entryOpen: status === 'open' }) };
    persist(run.id, patch).then(function () {
      FB.isConfigured() && !LOCAL && FB.audit(run.id, 'status_' + status, run.name);
      loadRuns();
    });
  }

  function cloneRun(run) {
    var p = clone(Specs.withDefaults(run.params));
    var name = prompt('Name for the cloned run:', (run.name || 'untitled') + ' (clone)');
    if (name == null) return;
    var obj = newRunDoc(p, name, autoCode());
    obj.clonedFrom = run.id;
    createRun(obj).then(function () {
      note('save-note', 'Cloned. The clone is a <b>draft</b> with its own run_id, its own pool and its own specs.');
      loadRuns();
    });
  }

  // The client-readable copy of a run (§17.4). Everything the participant's app
  // needs to render the study, and NOTHING it could reconstruct the mapping
  // from: no generatorSeed, no specSeed, no specs, no anchors, no filter.
  function publicDoc(run, p, id) {
    return {
      id: id || null,
      name: run.name, code: run.code, status: run.status,
      serverMode: (p.ops.compute === 'server'),
      ops: clone(p.ops),
      params: {
        env: {
          positions: p.env.positions, prizeMin: p.env.prizeMin, prizeMax: p.env.prizeMax,
          stepBound: p.env.stepBound
        },
        costs: clone(p.costs),
        ai: {
          sparseK: p.ai.sparseK, denseK: p.ai.denseK,
          answerRounding: p.ai.answerRounding, allowRequery: p.ai.allowRequery
        },
        rounds: {
          warmupPerBlock: p.rounds.warmupPerBlock, scoredPerBlock: p.rounds.scoredPerBlock,
          openPerBlock: p.rounds.openPerBlock, seededPerBlock: p.rounds.seededPerBlock
        },
        ops: clone(p.ops)
      },
      updatedAt: Date.now()
    };
  }

  function newRunDoc(p, name, code) {
    var params = clone(p);
    params.ops.runName = name;
    var pool = Pool.buildPool(params.env, params.env.generatorSeed);
    var specSeed = params.env.generatorSeed + 1;
    var specs = Specs.buildSpecs(pool, params, specSeed);
    return {
      name: name, code: String(code || '').toUpperCase(),
      status: 'draft', locked: false, createdAt: Date.now(),
      serverMode: (params.ops.compute === 'server'),
      params: params, ops: params.ops, assign: params.assign,
      specSeed: specSeed, specsJson: JSON.stringify(specs),
      poolChecksum: X.checksum(JSON.stringify(pool)),
      specsChecksum: X.checksum(JSON.stringify(specs)),
      seeds: { generatorSeed: params.env.generatorSeed, specSeed: specSeed },
      overrides: []
    };
  }
  function createRun(obj) {
    if (LOCAL) {
      var list = localRuns();
      obj.id = 'local-' + Date.now().toString(36);
      list.unshift(obj); saveLocalRuns(list);
      return Promise.resolve(obj.id);
    }
    return FB.createRun(obj).then(function (id) {
      FB.audit(id, 'create_run', obj.name);
      // The redacted copy travels with every run, so a run switched to server
      // mode later is never left without one.
      return FB.putRunPublic(id, publicDoc(obj, Specs.withDefaults(obj.params), id))
        .then(function () { return id; }, function () { return id; });
    });
  }
  function persist(id, patch) {
    if (LOCAL) {
      var list = localRuns().map(function (r) { return r.id === id ? Object.assign(r, patch) : r; });
      saveLocalRuns(list);
      return Promise.resolve();
    }
    return FB.updateRun(id, patch);
  }

  function artifacts(run) {
    var params = Specs.withDefaults(run && run.params);
    var pool = Pool.buildPool(params.env, params.env.generatorSeed);
    var specs = null;
    if (run && run.specsJson) { try { specs = JSON.parse(run.specsJson); } catch (e) {} }
    if (!specs || !specs.length) specs = Specs.buildSpecs(pool, params, (run && run.specSeed) || null);
    return { params: params, pool: pool, specs: specs };
  }

  function selectRun(run) {
    current = run; editingId = run.id;
    currentParams = Specs.withDefaults(run.params);
    if (run.ops) Object.keys(run.ops).forEach(function (k) { currentParams.ops[k] = run.ops[k]; });
    if (run.code) currentParams.ops.code = run.code;
    fillForm(currentParams, run);
    renderRoster();
    fillSpecPicker();
  }

  // ======================================================================
  //  SCREEN 2 · PARAMETERS   (+ SCREEN 3 · CONSEQUENCES)
  // ======================================================================
  // Every control is described once, here, so reading the form, writing it, and
  // locking it all stay in step.
  var FIELDS = [
    ['env', 'positions', 'num'], ['env', 'stepBound', 'num'], ['env', 'prizeMin', 'num'], ['env', 'prizeMax', 'num'],
    ['env', 'seedLowMin', 'num'], ['env', 'seedLowMax', 'num'], ['env', 'seedHighProb', 'num'],
    ['env', 'seedHighMin', 'num'], ['env', 'seedHighMax', 'num'], ['env', 'poolSize', 'num'], ['env', 'generatorSeed', 'num'],
    ['costs', 'revealCost', 'num'], ['costs', 'queryCost', 'num'], ['costs', 'queryCap', 'num'], ['costs', 'revealCap', 'num'],
    ['costs', 'scoreFloor', 'seg'],
    ['ai', 'sparseK', 'num'], ['ai', 'denseK', 'num'], ['ai', 'placement', 'seg'], ['ai', 'answerRounding', 'seg'],
    ['ai', 'allowRequery', 'seg'], ['ai', 'drawCurve', 'seg'], ['ai', 'markAnchors', 'seg'],
    ['rounds', 'warmupPerBlock', 'num'], ['rounds', 'scoredPerBlock', 'num'], ['rounds', 'openPerBlock', 'num'],
    ['rounds', 'seededPerBlock', 'num'], ['rounds', 'seedJitter', 'num'], ['rounds', 'shuffleWithinBlock', 'seg'],
    ['assign', 'sequenceAssignment', 'seg'], ['assign', 'freezeSeeds', 'seg'], ['assign', 'freezeAnchors', 'seg'],
    ['assign', 'nextEntrantOverride', 'seg'],
    ['filter', 'minGlobalMax', 'num'], ['filter', 'minHeadroom', 'num'],
    ['filter', 'seedHighestMin', 'num'], ['filter', 'seedHighestMax', 'num'], ['filter', 'applyToOpen', 'seg'],
    ['ops', 'runName', 'txt'], ['ops', 'entryOpen', 'seg'], ['ops', 'windowFrom', 'txt'], ['ops', 'windowTo', 'txt'],
    ['ops', 'minViewport', 'num'], ['ops', 'resumeWindowH', 'num'], ['ops', 'allowResume', 'seg'],
    ['ops', 'idleWarnMin', 'num'], ['ops', 'exitSurvey', 'seg'], ['ops', 'debrief', 'seg'],
    ['ops', 'gateQ2', 'seg'], ['ops', 'gateOther', 'seg'], ['ops', 'rosterMode', 'seg'],
    ['ops', 'compute', 'seg'], ['ops', 'completionCode', 'txt']
  ];
  // Only the `ops` group and the entrant override stay editable once a run has an
  // entrant (§17b). Everything else is a parameter that touches the task.
  function isUnlockedField(group, key) {
    // `compute` lives in Operations for convenience but is NOT operational: it
    // decides where the score comes from, so it locks with the task parameters.
    if (group === 'ops' && key === 'compute') return false;
    return group === 'ops' || (group === 'assign' && key === 'nextEntrantOverride');
  }
  var MIXES = [
    ['rounds', 'shapeMix', 'FRONTIER', 'p-shape-FRONTIER'],
    ['rounds', 'shapeMix', 'BALANCED', 'p-shape-BALANCED'],
    ['rounds', 'shapeMix', 'GAP', 'p-shape-GAP'],
    ['rounds', 'densitySeeded', 'SPARSE', 'p-dseed-SPARSE'],
    ['rounds', 'densitySeeded', 'DENSE', 'p-dseed-DENSE'],
    ['rounds', 'densityOpen', 'SPARSE', 'p-dopen-SPARSE'],
    ['rounds', 'densityOpen', 'DENSE', 'p-dopen-DENSE']
  ];

  function segSet(id, value) {
    var host = $(id);
    if (!host) return;
    host.querySelectorAll('button').forEach(function (b) {
      var v = b.dataset.v;
      var on = (v === String(value)) || (v === 'true' && value === true) || (v === 'false' && value === false);
      b.classList.toggle('on', !!on);
    });
  }
  function segGet(id) {
    var b = $(id) && $(id).querySelector('button.on');
    if (!b) return null;
    var v = b.dataset.v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }

  function wireForm() {
    FIELDS.forEach(function (f) {
      var id = 'p-' + f[0] + '-' + f[1];
      var el = $(id);
      if (!el) return;
      if (f[2] === 'seg') {
        el.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () {
            if (el.dataset.locked === '1') return;
            if ((f[1] === 'drawCurve' || f[1] === 'markAnchors') && b.dataset.v === 'true') {
              if (!confirm('Turning this on changes what the study measures:\n\n' +
                (f[1] === 'drawCurve'
                  ? 'Drawing the full curve makes consultation free — the participant reads every answer off a line instead of paying for them one at a time.'
                  : 'Marking the AI’s known positions makes the jaggedness visible, so locating it stops being the scarce commodity.') +
                '\n\nThat is a different experiment. Turn it on anyway?')) return;
            }
            el.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
            readForm(); renderConsequences();
          };
        });
      } else {
        el.oninput = function () { readForm(); renderConsequences(); };
      }
    });
    MIXES.forEach(function (m) {
      var el = $(m[3]);
      if (el) el.oninput = function () { readForm(); renderConsequences(); };
    });

    $('btn-gencode').onclick = function () { $('p-ops-code').value = autoCode(); readForm(); };
    $('p-ops-code').oninput = function () { readForm(); };

    $('btn-save').onclick = saveRun;
    $('btn-cancel').onclick = function () { if (current) selectRun(current); };
    $('btn-makedefault').onclick = function () {
      readForm();
      try { localStorage.setItem('searchv2:v3:admin:defaults', JSON.stringify(currentParams)); } catch (e) {}
      note('save-note', 'Saved as the starting point for new runs on this machine.');
    };
    $('btn-restore').onclick = function () {
      currentParams = Specs.withDefaults(null);
      fillForm(currentParams, current);
      note('save-note', 'Form reset to the built-in defaults. Nothing is saved until you press Save run.');
    };
  }

  function autoCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  function fillForm(p, run) {
    var locked = !!(run && run.locked);
    FIELDS.forEach(function (f) {
      var id = 'p-' + f[0] + '-' + f[1], el = $(id);
      if (!el) return;
      var v = p[f[0]] ? p[f[0]][f[1]] : null;
      if (f[2] === 'seg') segSet(id, v);
      else el.value = (v == null ? '' : v);
      var lockThis = locked && !isUnlockedField(f[0], f[1]);
      if (f[2] === 'seg') {
        el.dataset.locked = lockThis ? '1' : '';
        el.style.opacity = lockThis ? '.6' : '';
      } else {
        el.disabled = lockThis;
        el.classList.toggle('locked-field', lockThis);
      }
    });
    MIXES.forEach(function (m) {
      var el = $(m[3]);
      if (!el) return;
      el.value = (p[m[0]] && p[m[0]][m[1]]) ? p[m[0]][m[1]][m[2]] : '';
      el.disabled = locked;
      el.classList.toggle('locked-field', locked);
    });
    $('p-ops-code').value = (run && run.code) || p.ops.code || '';

    $('params-title').textContent = run ? ('Parameters · ' + (run.name || 'untitled')) : 'Parameters · new run';
    $('params-sub').textContent = run ? ('run_id ' + run.id + (run.locked ? ' · locked' : ' · draft')) : 'not saved yet';
    $('btn-save').textContent = run ? 'Save run' : 'Create run';
    $('btn-cancel').style.display = run ? '' : 'none';

    if (locked) {
      note('lock-note', '🔒 <b>Locked since the first participant' +
        (run.lockedAt ? ', ' + new Date(run.lockedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '') +
        '.</b> Every parameter that touches the task is fixed for this run. To change anything, ' +
        '<b>clone the run</b> from the Runs screen and collect under a new run_id. Only the Operations group ' +
        'and the next-entrant override stay editable.', false);
    } else {
      note('lock-note', '');
    }
    renderConsequences();
  }

  function readForm() {
    if (!currentParams) currentParams = Specs.withDefaults(null);
    FIELDS.forEach(function (f) {
      var id = 'p-' + f[0] + '-' + f[1], el = $(id);
      if (!el) return;
      if (f[2] === 'seg') { var g = segGet(id); if (g != null) currentParams[f[0]][f[1]] = g; }
      else if (f[2] === 'num') { var n = parseFloat(el.value); if (isFinite(n)) currentParams[f[0]][f[1]] = n; }
      else currentParams[f[0]][f[1]] = el.value;
    });
    MIXES.forEach(function (m) {
      var el = $(m[3]);
      if (!el) return;
      var n = parseInt(el.value, 10);
      if (isFinite(n)) currentParams[m[0]][m[1]][m[2]] = n;
    });
    currentParams.ops.code = ($('p-ops-code').value || '').toUpperCase();
    return currentParams;
  }

  function saveRun() {
    readForm();
    var code = currentParams.ops.code || autoCode();
    var name = currentParams.ops.runName || 'untitled';
    if (!editingId) {
      var obj = newRunDoc(currentParams, name, code);
      createRun(obj).then(function () {
        note('save-note', 'Run created as a <b>draft</b>. Run the validation gate on the Data screen before opening entry.');
        loadRuns();
      }).catch(function (e) { note('save-note', 'Could not create the run: ' + esc(String(e && e.message || e)), true); });
      return;
    }
    var run = current;
    var patch;
    if (run && run.locked) {
      // Locked: only Operations and the entrant override may move. The Rules
      // refuse anything else anyway; refusing it here too keeps the panel honest.
      patch = { name: name, ops: clone(currentParams.ops), assign: Object.assign({}, run.assign || {}, { nextEntrantOverride: currentParams.assign.nextEntrantOverride }) };
    } else {
      var pool = Pool.buildPool(currentParams.env, currentParams.env.generatorSeed);
      var specSeed = currentParams.env.generatorSeed + 1;
      var specs = Specs.buildSpecs(pool, currentParams, specSeed);
      patch = {
        name: name, code: code, params: clone(currentParams), ops: clone(currentParams.ops),
        assign: clone(currentParams.assign), specSeed: specSeed, specsJson: JSON.stringify(specs),
        poolChecksum: X.checksum(JSON.stringify(pool)), specsChecksum: X.checksum(JSON.stringify(specs)),
        seeds: { generatorSeed: currentParams.env.generatorSeed, specSeed: specSeed }
      };
    }
    patch.serverMode = (currentParams.ops.compute === 'server');
    persist(editingId, patch).then(function () {
      if (!LOCAL) {
        FB.audit(editingId, 'save_run', name);
        FB.putRunPublic(editingId, publicDoc(
          { name: name, code: code, status: (run && run.status) || 'draft' },
          currentParams, editingId)).catch(function () {});
      }
      note('save-note', 'Saved.');
      loadRuns();
    }).catch(function (e) { note('save-note', 'Could not save: ' + esc(String(e && e.message || e)), true); });
  }

  // ---- SCREEN 3 · Consequences --------------------------------------------
  // Simulated benchmark first-move shares (§10). These are the brief's own
  // simulated figures at the default geometry; when the seed positions or the
  // jitter change we recompute the exchange ratio and report which way it points,
  // rather than pretending a simulation was rerun.
  function benchmarkShares(p) {
    var out = {};
    CFG.SEED_SHAPES.forEach(function (sh) {
      var base = CFG.SEED_BASE[sh], J = p.env.positions;
      var tail = Math.max(base[0] - 1, J - base[base.length - 1]);
      var gap = 0;
      for (var i = 1; i < base.length; i++) gap = Math.max(gap, base[i] - base[i - 1]);
      var ratio = tail > 0 ? gap / (4 * tail) : Infinity;
      // g/4t < 1 → the frontier carries more uncertainty than any interior gap,
      // so the myopic benchmark goes to the frontier; > 1 → into the gap. The
      // brief's simulated shares at the defaults are 1.00 / 0.51 / 0.03.
      var share = 1 / (1 + Math.pow(ratio, 1.6));
      out[sh] = { gap: gap, tail: tail, ratio: ratio, frontierShare: share };
    });
    return out;
  }

  function renderConsequences() {
    var p = currentParams || Specs.withDefaults(null);
    var L = p.env.stepBound, cR = p.costs.revealCost;
    var sigma = CFG.sigma(L), sStar = CFG.sStar(cR), gStar = CFG.gStar(cR, L);
    // Mean anchor gap = the stratum width, J / K. (§17b Screen 3 writes the
    // formula as 100/(K+1) but quotes 25.0 for K = 4 and 10.0 for K = 10, and the
    // SD figures beside it — 14.43 and 9.13 — are sigma·sqrt(25)/2 and
    // sigma·sqrt(10)/2. The values are right and the formula is a slip, so J/K is
    // what is used here and in tools/selftest.js.)
    var gapS = p.env.positions / p.ai.sparseK, gapD = p.env.positions / p.ai.denseK;
    var sdS = sigma * Math.sqrt(gapS) / 2, sdD = sigma * Math.sqrt(gapD) / 2;
    var bench = benchmarkShares(p);

    // Badge 1 — the sign-change prediction.
    var above = sdS > sStar, belowD = sdD < sStar;
    var b1;
    if (above && belowD) {
      b1 = { cls: 'green', t: 'The sign-change prediction is intact',
        b: 'Sparse sits above s* and dense sits below it, so the two settings bracket the threshold. The prediction is a change of sign, not a gradient.' };
    } else {
      var relS = Math.abs(sdS - sStar) / sStar, relD = Math.abs(sdD - sStar) / sStar;
      if (relS < 0.2 && relD < 0.2) {
        b1 = { cls: 'amber', t: 'Both settings sit on the same side of s*, but close to it',
          b: 'Within 20% of the threshold. The prediction weakens to a gradient; consider moving K.' };
      } else {
        b1 = { cls: 'red', t: 'Both settings sit on the same side of s*',
          b: 'The design now tests a gradient rather than a sign change, and the sample is not sized for that. Move sparse K down or dense K up.' };
      }
    }

    // Badge 2 — do the seed shapes leave the outcome room to move?
    var shares = CFG.SEED_SHAPES.map(function (s) { return bench[s].frontierShare; });
    var mid = shares.some(function (s) { return s >= 0.3 && s <= 0.7; });
    var allHigh = shares.every(function (s) { return s > 0.9; });
    var allLow = shares.every(function (s) { return s < 0.1; });
    var b2 = mid
      ? { cls: 'green', t: 'The seed shapes leave the outcome room to move',
          b: 'One of the three shapes puts the benchmark first move near a coin flip, so a treatment effect has somewhere to show.' }
      : (allHigh || allLow)
        ? { cls: 'red', t: 'All three seed shapes point the same way',
            b: 'Every shape gives a benchmark frontier share above 0.9 or below 0.1. The outcome has no room to move.' }
        : { cls: 'amber', t: 'No seed shape sits near the middle',
            b: 'None of the three shapes lands between 0.3 and 0.7, so the sensitive cell is missing.' };

    $('cons-badges').innerHTML = [b1, b2].map(function (b) {
      return '<div class="badge ' + b.cls + '"><span class="bt">' + esc(b.t) + '</span><span class="bb">' + esc(b.b) + '</span></div>';
    }).join('');

    var rows = [
      ['Per-step SD', 'sigma = L / sqrt(3)', fmt(sigma, 3)],
      ['Verification threshold', 's* = reveal cost × sqrt(2π)', fmt(sStar, 2)],
      ['AI gap width where verification starts to pay', 'g* = (2 s* / sigma)²', fmt(gStar, 1)],
      ['Sparse mean anchor gap', 'J / K_sparse (the stratum width)', fmt(gapS, 1)],
      ['Sparse SD at gap midpoint', 'sigma × sqrt(gap) / 2', fmt(sdS, 2) + (sdS > sStar ? ' · above s*' : ' · below s*')],
      ['Dense mean anchor gap', 'J / K_dense (the stratum width)', fmt(gapD, 1)],
      ['Dense SD at gap midpoint', 'sigma × sqrt(gap) / 2', fmt(sdD, 2) + (sdD > sStar ? ' · above s*' : ' · below s*')],
      ['Gap and frontier exchange rate', 'a gap beats the tail when g > 4t', '—']
    ];
    CFG.SEED_SHAPES.forEach(function (sh) {
      rows.push(['Benchmark frontier share · ' + sh, 'g = ' + bench[sh].gap + ', t = ' + bench[sh].tail + ', g/4t = ' + fmt(bench[sh].ratio, 2),
        fmt(bench[sh].frontierShare, 2)]);
    });
    var roundsTotal = 2 * (p.rounds.warmupPerBlock + p.rounds.scoredPerBlock);
    rows.push(['Rounds per participant', p.rounds.warmupPerBlock * 2 + ' warm-up + ' + p.rounds.scoredPerBlock * 2 + ' scored', roundsTotal]);
    rows.push(['Expected reveals per round without AI', 'source study, matched by the benchmark policy', 'about 3']);
    rows.push(['Estimated session length', '~50 s per round + instructions and survey', Math.round(roundsTotal * 50 / 60) + ' to ' + (Math.round(roundsTotal * 50 / 60) + 22) + ' min']);
    rows.push(['Max spend in one round', 'query cap × query cost + reveal cap × reveal cost',
      (p.costs.queryCap * p.costs.queryCost + p.costs.revealCap * p.costs.revealCost) + ' points']);

    $('cons-table').innerHTML = '<tbody>' + rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '<span class="f">' + esc(r[1]) + '</span></td><td>' + esc(r[2]) + '</td></tr>';
    }).join('') + '</tbody>';

    // Pool statistics, recomputed from the actual seed the form holds.
    try {
      var pool = Pool.buildPool(p.env, p.env.generatorSeed);
      var st = Pool.poolStats(pool);
      $('cons-poolnote').innerHTML = 'Pool at this seed: <b>' + st.mappings + '</b> mappings · ' +
        'a single position has mean <b>' + fmt(st.cellMean, 1) + '</b> (SD ' + fmt(st.cellSd, 1) + ') · ' +
        'global maximum mean <b>' + fmt(st.globalMaxMean, 1) + '</b> (5th pct ' + st.globalMaxP5 + ', 95th ' + st.globalMaxP95 + ') · ' +
        'worst adjacent step ' + st.worstAdjacentStep + '. ' +
        '<span class="muted">The brief quotes 62.2 (SD 26.8) and a global-max mean of 91.7 for the RAW generator; the pool is ' +
        'the subset with a global maximum of at least 80, which is why its level sits higher.</span>';
    } catch (e) {
      $('cons-poolnote').textContent = 'Could not build a pool at these parameters: ' + String(e && e.message || e);
    }
  }

  // ======================================================================
  //  SCREEN 4 · ROSTER
  // ======================================================================
  var roster = [];
  function wireRoster() {
    $('btn-ros-gen').onclick = generateCodes;
    $('btn-ros-csv').onclick = function () {
      var csv = 'code,sequence,status\n' + roster.map(function (r) {
        return [r.code, r.sequence, r.status || 'unused'].join(',');
      }).join('\n');
      dl((current ? current.code : 'run') + '_roster.csv', csv, 'text/csv');
    };
    $('ros-override').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        $('ros-override').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      };
    });
    $('btn-ros-override').onclick = applyOverride;
  }

  function renderRoster() {
    if (!current) {
      $('roster-table').innerHTML = '<tbody><tr><td class="muted">Open a run first.</td></tr></tbody>';
      $('roster-stats').innerHTML = '';
      return;
    }
    segSet('ros-override', (current.assign && current.assign.nextEntrantOverride) || 'auto');
    $('ros-overrides').innerHTML = (current.overrides || []).length
      ? '<b>Override log</b><br>' + current.overrides.map(function (o) {
          return new Date(o.t).toLocaleString() + ' → ' + o.to + ' · ' + esc(o.reason || '');
        }).join('<br>')
      : 'No overrides recorded — assignment has been automatic throughout.';

    var p = LOCAL ? Promise.resolve(current.roster || []) : FB.listRoster(current.id);
    p.then(function (list) {
      roster = list || [];
      var counts = { unused: 0, started: 0, completed: 0, abandoned: 0, A: 0, B: 0 };
      roster.forEach(function (r) {
        counts[r.status || 'unused'] = (counts[r.status || 'unused'] || 0) + 1;
        if (r.sequence) counts[r.sequence]++;
      });
      $('roster-stats').innerHTML = [
        ['Codes', roster.length], ['Unused', counts.unused], ['In progress', counts.started],
        ['Completed', counts.completed], ['Sequence A', counts.A], ['Sequence B', counts.B]
      ].map(function (s) { return '<div class="stat-box"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('');

      $('roster-table').innerHTML = roster.length
        ? '<thead><tr><th>Code</th><th>Sequence</th><th>Status</th><th>Claimed</th><th>Enrolled</th></tr></thead><tbody>' +
          roster.map(function (r) {
            return '<tr><td class="mono">' + esc(r.code) + '</td><td>' + esc(r.sequence || '—') + '</td>' +
              '<td>' + esc(r.status || 'unused') + '</td>' +
              '<td>' + (r.claimedAt ? new Date(r.claimedAt).toLocaleString() : '—') + '</td>' +
              '<td>' + (r.autoEnrolled ? 'platform / open' : 'pre-generated') + '</td></tr>';
          }).join('') + '</tbody>'
        : '<tbody><tr><td class="muted">No codes yet. In <b>open</b> roster mode a class-platform student ID enrols itself on first entry.</td></tr></tbody>';
    }).catch(function (e) {
      $('roster-table').innerHTML = '<tbody><tr><td class="muted">Could not read the roster: ' + esc(String(e && e.message || e)) + '</td></tr></tbody>';
    });
  }

  function generateCodes() {
    if (!current) { alert('Open a run first.'); return; }
    var n = Math.max(1, Math.min(1000, parseInt($('ros-n').value, 10) || 0));
    var prefix = ($('ros-prefix').value || 'P').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Block randomisation over a shuffled list, so the split is exactly half and
    // half rather than a series of coin flips (§11).
    var seqs = [];
    for (var i = 0; i < n; i++) seqs.push(i % 2 === 0 ? 'A' : 'B');
    Pool.shuffle(seqs, Pool.rngFrom(Pool.hashSeed(current.id + ':' + n + ':' + prefix)));
    var codes = [];
    for (var j = 0; j < n; j++) codes.push({ code: prefix + String(j + 1).padStart(3, '0'), sequence: seqs[j] });

    if (LOCAL) {
      current.roster = codes.map(function (c) { return { code: c.code, sequence: c.sequence, status: 'unused' }; });
      saveLocalRuns(localRuns().map(function (r) { return r.id === current.id ? current : r; }));
      renderRoster();
      return;
    }
    var chain = Promise.resolve();
    codes.forEach(function (c) { chain = chain.then(function () { return FB.putRosterCode(current.id, c.code, c.sequence); }); });
    chain.then(function () {
      FB.audit(current.id, 'generate_roster', n + ' codes, prefix ' + prefix);
      renderRoster();
    }).catch(function (e) { alert('Could not write the roster: ' + (e && e.message || e)); });
  }

  function applyOverride() {
    if (!current) { alert('Open a run first.'); return; }
    var to = segGet('ros-override') || 'auto';
    var reason = ($('ros-reason').value || '').trim();
    if (to !== 'auto' && !reason) { alert('A reason is required: forced assignment is no longer pure randomisation, and the analysis has to say so.'); return; }
    var log = (current.overrides || []).concat([{ t: Date.now(), to: to, reason: reason }]);
    var assign = Object.assign({}, current.assign || {}, { nextEntrantOverride: to });
    persist(current.id, { overrides: log, assign: assign }).then(function () {
      current.overrides = log; current.assign = assign;
      if (!LOCAL) FB.audit(current.id, 'entrant_override', to + ' — ' + reason);
      $('ros-reason').value = '';
      renderRoster();
    });
  }

  // ======================================================================
  //  SCREEN 5 · LIVE MONITOR
  // ======================================================================
  function wireMonitor() {
    $('btn-monitor-refresh').onclick = function () { loadEvents().then(renderHealth); };
  }
  function startMonitor() {
    if (!current) {
      $('mon-counters').innerHTML = '<div class="stat-box"><b>—</b><span>open a run first</span></div>';
      return;
    }
    if (unsubMon) unsubMon();
    if (LOCAL) { monRows = []; renderMonitor(); return; }
    unsubMon = FB.watchParticipants(current.id, function (list) { monRows = list || []; renderMonitor(); });
  }
  function renderMonitor() {
    var started = monRows.length;
    var completed = monRows.filter(function (r) { return r.completed; }).length;
    var inProgress = monRows.filter(function (r) { return !r.completed && (Date.now() - (r.updatedAt || 0)) < 30 * 60 * 1000; }).length;
    var abandoned = started - completed - inProgress;
    var nA = monRows.filter(function (r) { return r.sequence === 'A'; }).length;
    var nB = monRows.filter(function (r) { return r.sequence === 'B'; }).length;
    var skew = Math.abs(nA - nB);

    $('mon-counters').innerHTML = [
      ['Started', started], ['In progress', inProgress], ['Completed', completed], ['Abandoned', Math.max(0, abandoned)],
      ['Sequence A', nA], ['Sequence B', nB]
    ].map(function (s) { return '<div class="stat-box"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('') +
      (skew > 3 ? '<div class="stat-box" style="background:#fff7ed;"><b>' + skew + '</b><span>sequence gap — force the next entrants</span></div>' : '');

    $('mon-table').innerHTML = monRows.length
      ? '<thead><tr><th>Code</th><th>Sequence</th><th>Phase</th><th>Round</th><th>Active</th><th>Resumptions</th><th>Viewport</th><th>Flags</th><th></th></tr></thead><tbody>' +
        monRows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).map(function (r) {
          var flags = [];
          if (r.viewport_width && current && current.ops && r.viewport_width < (current.ops.minViewport || 900)) flags.push('narrow');
          if ((r.resumptions || 0) > 0) flags.push('resumed');
          if (r.completed) flags.push('done');
          return '<tr><td class="mono">' + esc(r.participant_code) + '</td><td>' + esc(r.sequence || '—') + '</td>' +
            '<td>' + esc(r.phase || '—') + '</td><td>' + (r.round_index || '—') + '</td>' +
            '<td>' + Math.round((r.active_ms || 0) / 60000) + ' min</td>' +
            '<td>' + (r.resumptions || 0) + '</td>' +
            '<td>' + (r.viewport_width || '—') + '</td>' +
            '<td>' + esc(flags.join(', ')) + '</td>' +
            '<td><button class="link-btn" data-msg="' + esc(r.participant_code) + '">message</button></td></tr>';
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">No participants yet.</td></tr></tbody>';

    $('mon-table').querySelectorAll('button[data-msg]').forEach(function (b) {
      b.onclick = function () {
        var t = prompt('Message to ' + b.dataset.msg + ':');
        if (t) FB.sendMessage(b.dataset.msg, t);
      };
    });
    renderHealth();
  }

  // The health strip of §17b Screen 5. Everything that needs the event log reads
  // whatever has been loaded; the counters above never scan it.
  function renderHealth() {
    var rows = [];
    function add(label, value, warn) { rows.push({ label: label, value: value, warn: warn }); }

    var actives = monRows.map(function (r) { return (r.active_ms || 0) / 60000; }).filter(function (v) { return v > 0; });
    var medActive = med(actives);
    add('Median active time per participant', medActive == null ? '—' : fmt(medActive, 1) + ' min',
      medActive != null && (medActive < 30 || medActive > 70));

    if (built) {
      var durs = built.rounds.map(function (r) { return (r.duration_ms || 0) / 1000; });
      var medRound = med(durs);
      add('Median time per round', medRound == null ? '—' : fmt(medRound, 1) + ' s', medRound != null && medRound < 20);

      var q2 = built.participants.filter(function (p) { return p.quiz_qai_score_first_correct === false; }).length;
      var q2n = built.participants.filter(function (p) { return p.quiz_qai_score_first_correct != null; }).length;
      add('Comprehension failures on the scoring question', q2n ? pct(q2 / q2n) : '—', q2n && (q2 / q2n) > 0.10);

      var q45 = built.participants.filter(function (p) {
        return p.quiz_qai_tell_first_correct === false || p.quiz_qai_outside_first_correct === false;
      }).length;
      add('Comprehension failures on the jaggedness / frontier questions', q2n ? pct(q45 / q2n) : '—', q2n && (q45 / q2n) > 0.40);

      var caps = built.rounds.filter(function (r) { return r.cap_hit; }).length;
      add('Query or reveal cap hit', built.rounds.length ? pct(caps / built.rounds.length) : '—',
        built.rounds.length && (caps / built.rounds.length) > 0.03);

      var seeded = built.rounds.filter(function (r) { return r.seed_shape !== 'OPEN' && r.scored; });
      var imm = seeded.filter(function (r) { return r.stopped_immediately; }).length;
      add('Immediate stop rate in seeded rounds', seeded.length ? pct(imm / seeded.length) : '—',
        seeded.length && (imm / seeded.length) > 0.60);

      var slow = built.participants.filter(function (p) { return p.median_decision_ms != null && p.median_decision_ms < 500; }).length;
      add('Participants with a median decision under 500 ms', slow, slow > 0);

      var blur = built.rounds.filter(function (r) { return (r.blur_total_ms || 0) > 120000; }).length;
      add('Rounds with a blur longer than two minutes', blur, blur > 0);
    } else {
      add('Round timing, comprehension, caps, stops', 'load the event log to compute', false);
    }

    var narrow = monRows.filter(function (r) { return r.viewport_width && r.viewport_width < ((current && current.ops && current.ops.minViewport) || 900); }).length;
    add('Viewport below the minimum', narrow, narrow > 0);

    $('mon-health').innerHTML = '<tbody>' + rows.map(function (r) {
      return '<tr class="' + (r.warn ? 'warn' : '') + '"><td>' + esc(r.label) + (r.warn ? ' ⚠' : '') + '</td><td>' + esc(String(r.value)) + '</td></tr>';
    }).join('') + '</tbody>';
  }
  function med(a) {
    var x = a.filter(function (v) { return v != null && isFinite(v); }).sort(function (p, q) { return p - q; });
    if (!x.length) return null;
    var m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  }
  function pct(v) { return (100 * v).toFixed(1) + '%'; }

  // ======================================================================
  //  SCREEN 6 · DATA & PREVIEW
  // ======================================================================
  function wireData() {
    $('btn-fetch').onclick = function () { loadEvents().then(renderData); };
    $('btn-validate').onclick = runValidation;
    $('btn-preview').onclick = function () {
      var spec = $('prev-spec').value;
      window.open(previewUrl(current && current.code, spec), '_blank');
    };
    $('btn-preview-full').onclick = function () { window.open(previewUrl(current && current.code), '_blank'); };
    $('btn-dryrun').onclick = dryRun;
    $('btn-dl-xlsx').onclick = downloadXlsx;
    $('btn-dl-decisions').onclick = function () { if (built) dl('decisions.csv', X.toCSV(built.decisions), 'text/csv'); };
    $('btn-dl-rounds').onclick = function () { if (built) dl('rounds.csv', X.toCSV(built.rounds), 'text/csv'); };
    $('btn-dl-participants').onclick = function () { if (built) dl('participants.csv', X.toCSV(built.participants), 'text/csv'); };
    $('btn-dl-raw').onclick = function () { if (built) dl('raw_events.json', JSON.stringify(built.raw, null, 1), 'application/json'); };
    $('btn-reset-participant').onclick = function () {
      if (!current) return alert('Open a run first.');
      var code = prompt('Participant code to reset (their rows are deleted permanently):');
      if (!code) return;
      var why = prompt('Reason (logged with the reset):');
      if (!why) return alert('A reason is required.');
      FB.deleteParticipantData(current.id, code.toUpperCase()).then(function (n) {
        FB.audit(current.id, 'reset_participant', code + ' — ' + why + ' (' + n + ' rows)');
        alert('Removed ' + n + ' rows for ' + code + '.');
      });
    };
    $('btn-close-run').onclick = function () {
      if (!current) return alert('Open a run first.');
      if (!confirm('Close "' + (current.name || current.id) + '" permanently? No new participant can enter.')) return;
      setStatus(current, 'closed');
    };
  }

  function fillSpecPicker() {
    var sel = $('prev-spec');
    if (!sel) return;
    if (!current) { sel.innerHTML = '<option value="">open a run first</option>'; return; }
    var a = artifacts(current);
    sel.innerHTML = a.specs.map(function (s) {
      return '<option value="' + esc(s.spec_id) + '">' + esc(s.spec_id) + ' · ' + esc(s.seed_shape) +
        ' · ' + esc(s.ai_density) + ' (K=' + s.ai_k + ')' + (s.scored ? '' : ' · warm-up') + '</option>';
    }).join('');
  }

  function runValidation() {
    if (!current) { $('validate-out').innerHTML = '<span class="muted">Open a run first.</span>'; return; }
    var a = artifacts(current);
    var v = Specs.validate(a.pool, a.specs, a.params);
    $('validate-out').innerHTML = v.pass
      ? '<div class="badge green"><span class="bt">Pass</span><span class="bb">' + v.notes.map(esc).join('<br>') + '</span></div>'
      : '<div class="badge red"><span class="bt">' + v.failures.length + ' failure' + (v.failures.length === 1 ? '' : 's') +
        '</span><span class="bb">' + v.failures.map(esc).join('<br>') + '</span></div>';
    if (!LOCAL) FB.audit(current.id, 'validate', v.pass ? 'pass' : v.failures.join('; '));
  }

  function loadEvents() {
    if (LOCAL || !FB.isConfigured()) {
      note('data-note', 'Firebase is not configured, so there is no event log to read.', true);
      return Promise.resolve([]);
    }
    note('data-note', 'Loading the event log…');
    return FB.fetchEvents(current ? current.id : null).then(function (list) {
      events = list || [];
      built = X.build(events, current);
      note('data-note', 'Loaded <b>' + events.length + '</b> event rows.');
      return events;
    }).catch(function (e) {
      note('data-note', 'Could not read the event log: ' + esc(String(e && e.message || e)), true);
      return [];
    });
  }

  function renderData() {
    if (!built) return;
    $('data-counts').innerHTML = [
      ['Raw events', built.raw.length], ['Decisions', built.decisions.length],
      ['Rounds', built.rounds.length], ['Participants', built.participants.length],
      ['Checksum', X.checksum(JSON.stringify(built.raw.map(function (e) { return e.t + ':' + e.event; })))]
    ].map(function (s) { return '<div class="stat-box"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('');

    var d = built.decisions.slice(0, 300);
    var cols = ['participant_code', 'sequence', 'block', 'condition', 'round_index', 'spec_id', 'seed_shape',
      'ai_density', 'decision_index', 'action', 'position', 'value', 'choice_region', 'is_frontier',
      'dist_to_nearest_anchor', 'ai_prediction', 'ai_sd', 'verify_pays', 'outside_window', 'matched_benchmark'];
    $('dec-count').textContent = built.decisions.length + ' rows (showing the first ' + d.length + ')';
    $('dec-table').innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      d.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          var v = r[c];
          if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(2);
          return '<td>' + esc(v == null ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
    renderHealth();
  }

  function downloadXlsx() {
    if (!built) { alert('Load the event log first.'); return; }
    var name = 'searchv2_' + ((current && current.code) || 'run') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    Xlsx.download(name, sheetsFor(built, built.artifacts));
    if (!LOCAL && current) FB.audit(current.id, 'export', name + ' · ' + built.raw.length + ' rows');
  }

  // The whole workbook, as data. Factored out of the download so the dry run can
  // build the same sheets and throw the bytes away — an export that only ever
  // runs on live data is an export nobody can check before the session.
  function sheetsFor(b, a) {
    var readme = [
      ['Sheet', 'What it holds', 'Notes'],
      ['Run', 'Every parameter this run was collected under, plus the frozen seeds and checksums', 'The configuration always travels with the data'],
      ['Specs', 'The 28 frozen round specs: mapping index, pre-opened positions, AI density and anchors', 'Identical for every participant of the run'],
      ['Decisions', 'One row per query, reveal or stop, with every derived field of §16.8', 'is_first_decision marks the primary analysis moment'],
      ['Rounds', 'One row per round, raw and derived', 'interrupted is a column, not a filter'],
      ['Participants', 'One row per participant: timing, comprehension, survey, calibration gaps', 'disengaged is a column, not a filter'],
      ['Slider', 'The throttled slider trace: which positions were considered and rejected', 'At most one row per 250 ms, plus one on release'],
      ['Attention', 'Blur, focus, visibility, heartbeats, instruction opens, resizes', 'active_ms is summed from heartbeats'],
      ['Raw', 'The event log exactly as written', 'Everything else is regenerated from this'],
      [],
      ['Units', '', ''],
      ['Points', 'Prizes, costs and scores are whole points', 'reveal ' + a.params.costs.revealCost + ', query ' + a.params.costs.queryCost],
      ['Times', 'Milliseconds; ISO timestamps are UTC', ''],
      ['Anchor sets', 'Encoded "position:value|position:value"', 'Firestore rejects nested arrays, and a CSV cell must stay one cell'],
      [],
      ['Key derived fields', '', ''],
      ['is_frontier', 'The chosen position lies outside the participant’s own known range', ''],
      ['ai_sd', 'sigma·sqrt((p-a)(b-p)/g) inside a gap, sigma·sqrt(t) in a tail', 'sigma = ' + fmt(CFG.sigma(a.params.env.stepBound), 3)],
      ['verify_pays', 'ai_sd exceeds s*', 's* = ' + fmt(CFG.sStar(a.params.costs.revealCost), 2)],
      ['outside_window', 'The Lipschitz ceiling is below the best known value, so the reveal is dominated', ''],
      ['matched_benchmark', 'The chosen position equals the myopic expected-improvement argmax', ''],
      ['error_belief_gap', 'Stated typical AI error minus the actual mean absolute error experienced', 'Negative = they thought the tool was better than it was'],
      ['hit_rate_belief_gap', 'Stated answers-per-ten exactly right minus the actual rate', ''],
      ['perceived_vs_actual_half', 'Whether the half they believed they scored higher in is the half they did', '']
    ];

    var runRows = [['group', 'parameter', 'value']];
    ['env', 'costs', 'ai', 'rounds', 'assign', 'filter', 'ops'].forEach(function (g) {
      Object.keys(a.params[g] || {}).forEach(function (k) {
        var v = a.params[g][k];
        runRows.push([g, k, (typeof v === 'object') ? JSON.stringify(v) : v]);
      });
    });
    runRows.push(['run', 'run_id', current ? current.id : '']);
    runRows.push(['run', 'run_code', current ? current.code : '']);
    runRows.push(['run', 'status', current ? current.status : '']);
    runRows.push(['run', 'poolChecksum', current ? current.poolChecksum : X.checksum(JSON.stringify(a.pool))]);
    runRows.push(['run', 'specsChecksum', current ? current.specsChecksum : X.checksum(JSON.stringify(a.specs))]);
    runRows.push(['run', 'generatorSeed', a.params.env.generatorSeed]);
    runRows.push(['run', 'specSeed', current ? current.specSeed : '']);
    runRows.push(['run', 'exportedAt', new Date().toISOString()]);
    (current && current.overrides || []).forEach(function (o, i) {
      runRows.push(['override', 'override_' + (i + 1), new Date(o.t).toISOString() + ' → ' + o.to + ' — ' + (o.reason || '')]);
    });

    var specRows = [['spec_id', 'block', 'scored', 'mapping_index', 'seed_shape', 'pre_opened', 'ai_density', 'ai_k', 'ai_anchors']];
    a.specs.forEach(function (s) {
      specRows.push([s.spec_id, s.block, s.scored ? 1 : 0, s.mapping_index, s.seed_shape,
        s.pre_opened.join(' '), s.ai_density, s.ai_k, s.ai_anchors.join(' ')]);
    });

    // Slider + attention traces, unpacked from the telemetry batches.
    var slider = [['participant_code', 'round_index', 'position', 'via', 'ms_since_round_start', 't']];
    var attention = [['participant_code', 'round_index', 'kind', 'detail', 't']];
    var grouped = X.group(b.raw);
    Object.keys(grouped).forEach(function (code) {
      grouped[code].telemetry.forEach(function (r) {
        if (r.kind === 'slider') slider.push([code, r.round_index, r.position, r.via, r.ms, new Date(r.t).toISOString()]);
        else attention.push([code, r.round_index, r.kind,
          JSON.stringify(Object.keys(r).filter(function (k) { return ['kind', 't', 'round_index', 'phase'].indexOf(k) < 0; })
            .reduce(function (o, k) { o[k] = r[k]; return o; }, {})),
          new Date(r.t).toISOString()]);
      });
    });

    var sheets = [
      { name: 'ReadMe', cols: [{ w: 26 }, { w: 62 }, { w: 46 }], rows: readme, filter: false },
      { name: 'Run', cols: [{ w: 14 }, { w: 26 }, { w: 60 }], rows: runRows },
      { name: 'Specs', cols: [{ w: 10 }, { w: 8 }, { w: 8 }, { w: 14 }, { w: 12 }, { w: 18 }, { w: 12 }, { w: 7 }, { w: 30 }], rows: specRows },
      X.toSheet('Decisions', b.decisions),
      X.toSheet('Rounds', b.rounds),
      X.toSheet('Participants', b.participants),
      { name: 'Slider', cols: [{ w: 16 }, { w: 12 }, { w: 10 }, { w: 10 }, { w: 20 }, { w: 24 }], rows: slider },
      { name: 'Attention', cols: [{ w: 16 }, { w: 12 }, { w: 18 }, { w: 40 }, { w: 24 }], rows: attention },
      X.toSheet('Raw', b.raw)
    ];
    return sheets;
  }

  // ---- dry run (§17b Screen 6) --------------------------------------------
  // The bot itself lives in export.js, so the panel and tools/selftest.js drive
  // exactly the same scripted session.
  function dryRun() {
    if (!current) { $('dryrun-out').innerHTML = '<span class="muted">Open a run first.</span>'; return; }
    var a = artifacts(current);
    var rows = X.botSession(a, 'BOT001', 'A', current).concat(X.botSession(a, 'BOT002', 'B', current));
    var b = X.build(rows, current, { keepBots: true });
    var missingDec = X.emptyColumns(b.decisions),
        missingRnd = X.emptyColumns(b.rounds),
        missingPart = X.emptyColumns(b.participants);
    // Build the workbook too, and throw the bytes away. The export is the point
    // of the dry run — checking the columns populate but never exercising the
    // writer would miss exactly the failure the dry run exists to catch.
    var wb = null, wbErr = null;
    try { wb = sheetsFor(b, a).length ? Xlsx.build(sheetsFor(b, a)) : null; }
    catch (e) { wbErr = String((e && e.message) || e); }
    // Bot rows are excluded from a REAL export (§17b); prove it here rather than
    // trusting it.
    var real = X.build(rows, current);
    $('dryrun-out').innerHTML =
      '<div class="badge ' + (b.decisions.length && b.rounds.length && wb && !real.decisions.length ? 'green' : 'red') + '">' +
      '<span class="bt">' + b.decisions.length + ' decisions · ' + b.rounds.length + ' rounds · ' +
      b.participants.length + ' participants</span>' +
      '<span class="bb">Columns that stayed empty — decisions: ' + esc(missingDec.join(', ') || 'none') +
      '<br>rounds: ' + esc(missingRnd.join(', ') || 'none') +
      '<br>participants: ' + esc(missingPart.length > 12 ? missingPart.slice(0, 12).join(', ') + ' …' : (missingPart.join(', ') || 'none')) +
      '<br>workbook: ' + (wb ? (Math.round(wb.length / 1024) + ' KB, built cleanly') : ('FAILED — ' + esc(wbErr || 'no sheets'))) +
      '<br>bot rows in a real export: ' + real.decisions.length + ' (must be 0)' +
      '</span></div>';
  }

  function dl(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
