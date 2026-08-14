/* ==========================================================================
   search-v2  ·  admin/admin.js
   The admin panel of design brief §17b, restructured to its six screens:

     1 Runs           — every run, its status, its participants, its balance
     2 Parameters     — six collapsible groups, locked once a run has an entrant
     3 Consequences   — recomputed live beside the form, with the two badges
     4 Participants   — anonymous codes, sequence assignment, progress and status
                        (the `roster` ids and collection keep that name in the DATA)
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
      Ai = window.SVAi, Content = window.SVContent, X = window.SVExport, Xlsx = window.SVXlsx,
      Dict = window.SVDictionary;
  var FB = window.SVFirebase;

  // `current`   — the session every OTHER screen is looking at (roster, monitor,
  //               data, notes). The panel picks one on load so those screens
  //               have something to show.
  // `editingId` — the session the PARAMETER FORM and the WORDING tab write to.
  //               null means the form is composing a NEW session, and Save
  //               creates one. These are deliberately NOT the same thing: the
  //               panel auto-picks a session for the read screens, and binding
  //               the form to that pick silently turned "set the parameters for
  //               my next session, then Save" into "overwrite whichever session
  //               happened to be picked" — with no summary and no confirmation.
  //               The form is bound to a session ONLY when the admin opens one
  //               from its card (see selectRun's `form` option).
  var runs = [], current = null, currentParams = null, editingId = null;
  // This session's wording overrides, as the flat key→string map content.js
  // defines. Empty means every word comes from content.js.
  var currentContent = {};
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
    wireWording();

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
        // Derived from the buttons themselves rather than listed here: a hard-coded
        // list silently stops showing any screen added after it was written.
        document.querySelectorAll('.tab').forEach(function (x) {
          var pane = $('tab-' + x.dataset.tab);
          if (pane) pane.style.display = (x === t) ? '' : 'none';
        });
        if (t.dataset.tab === 'roster') renderRoster();
        if (t.dataset.tab === 'monitor') startMonitor();
        if (t.dataset.tab === 'data') { fillSpecPicker(); renderRoundGallery(); }
        if (t.dataset.tab === 'notes') renderNotes();
        if (t.dataset.tab === 'wording') renderWording();
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
      currentContent = {};        // a new session starts on the study's own words
      // Carry whatever was typed on the Sessions screen into the form, so taking
      // the advanced path never costs the admin the name they just wrote.
      var typedName = ($('nr-name').value || '').trim(), typedCode = normCode($('nr-code').value);
      if (typedName) currentParams.ops.runName = typedName;
      if (typedCode) currentParams.ops.code = typedCode;
      fillForm(currentParams, null);
      openTab('params');
      note('save-note', 'A new session, seeded from the saved defaults. Change whatever the task needs, then ' +
        'press <b>Create session</b>. (A session that only needs a name is quicker to create on the Sessions screen.)');
    };
    // The click Event must not reach loadRuns — its argument is a session to
    // select once the list is back.
    $('btn-refresh-runs').onclick = function () { loadRuns(); };
    wireCreateCard();
  }

  // ---- create a session, from the Sessions screen --------------------------
  // A session used to be creatable only from the parameter form: press New
  // session, scroll past seven collapsed groups to Operations, name it there,
  // create, then come back and open it. Naming is the ONE thing every session
  // needs, so it is asked here, first — the same shape as the other class
  // admins. Everything the form could do is still done there; this path just
  // takes the saved defaults as they stand.
  function normCode(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
  }
  function codeInUse(code) {
    return runs.some(function (r) { return String(r.code || '').toUpperCase() === code; });
  }
  // autoCode() draws at random, so on a panel that already holds sessions it can
  // repeat one — and a repeat would re-point runCodes/<code> at the newer run,
  // quietly sending the older session's participants into it. Draw until free.
  function freshCode() {
    for (var i = 0; i < 50; i++) { var c = autoCode(); if (!codeInUse(c)) return c; }
    return autoCode();
  }
  // A typed code is checked against the server too: another admin may have
  // created one since this list was read. An automatic code is not — it is drawn
  // from 33 million and already checked against every session on screen.
  function codeFree(code) {
    if (codeInUse(code)) return Promise.resolve(false);
    if (LOCAL || !FB.isConfigured() || !FB.codeExists) return Promise.resolve(true);
    return FB.codeExists(code).then(function (x) { return !x; }, function () { return true; });
  }

  function wireCreateCard() {
    var nameEl = $('nr-name'), codeEl = $('nr-code');
    codeEl.oninput = function () { codeEl.value = normCode(codeEl.value); clearCreated(); };
    nameEl.oninput = clearCreated;
    [nameEl, codeEl].forEach(function (el) {
      el.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); createFromCard(); } };
    });
    $('btn-create-run').onclick = createFromCard;
    if ($('btn-demo-run')) $('btn-demo-run').onclick = function () { clearCreated(); createDemoRun($('btn-demo-run')); };
  }
  function clearCreated() { $('nr-created').innerHTML = ''; note('nr-note', ''); }

  function createFromCard() {
    var nameEl = $('nr-name'), codeEl = $('nr-code'), btn = $('btn-create-run');
    var name = (nameEl.value || '').trim() || 'untitled';
    var typed = normCode(codeEl.value);
    if (typed && typed.length < 3) {
      note('nr-note', 'A custom <b>Session ID</b> is 3&ndash;40 characters, capital letters and digits only. ' +
        'Leave it blank for an automatic code.', true);
      codeEl.focus();
      return;
    }
    clearCreated();
    btn.disabled = true;
    (typed ? codeFree(typed) : Promise.resolve(true)).then(function (free) {
      btn.disabled = false;
      if (!free) {
        note('nr-note', 'Session ID <b>' + esc(typed) + '</b> is already taken. Choose another, or leave it ' +
          'blank for an automatic code.', true);
        codeEl.focus();
        return;
      }
      askCreate(name, typed || freshCode(), nameEl, codeEl, btn);
    });
  }

  function askCreate(name, code, nameEl, codeEl, btn) {
    var p = savedDefaultParams();
    p.ops.runName = name;
    p.ops.code = code;
    // It is created as a draft, so the entry flag must say so: app.js reads
    // ops.entryOpen, and a draft carrying entryOpen:true would let people in
    // before the validation gate has ever run.
    p.ops.entryOpen = false;
    // The same gate the parameter form applies: creating freezes the mapping
    // pool and every round spec under these seeds, so they are read once first.
    askSummary('Create this session?',
      'It is built from the <b>saved default parameters</b>, which freezes the mapping pool and all <b>' +
      (2 * (p.rounds.warmupPerBlock + p.rounds.scoredPerBlock)) + ' round specs</b> under the seeds below. ' +
      'It opens as a <b>draft</b>, so nobody can enter yet, and every parameter stays editable until the ' +
      'first participant claims a code.',
      summaryBoxes(p), 'Create session', function () {
        btn.disabled = true; btn.textContent = 'Creating…';
        function done() { btn.disabled = false; btn.textContent = 'Create session'; }
        createRun(newRunDoc(p, name, code, {})).then(function (id) {
          done();
          nameEl.value = ''; codeEl.value = '';
          showCreated(id, code, name);
          // Selecting it here is the point of the card: the new session is what
          // every other screen is already on, so there is nothing to go and open.
          loadRuns(id);
        }, function (e) {
          done();
          note('nr-note', 'Could not create the session: ' + esc(String(e && e.message || e)), true);
        });
      });
  }

  function showCreated(id, code, name) {
    var host = $('nr-created');
    host.innerHTML = '<div class="made-box">' +
      '<div class="cb-label">Session created &mdash; participants join with this code</div>' +
      '<div class="cb-code">' + esc(code) + '</div>' +
      '<div class="cb-name">' + esc(name) + '</div>' +
      '<div class="cb-link mono">' + esc(launchUrl(code)) + '</div>' +
      '<div class="run-acts">' +
        '<button class="sBtn sBtnSec" data-cb="copy">Copy link</button>' +
        '<button class="sBtn sBtnPrimary" data-cb="params">Check its parameters</button>' +
        '<button class="sBtn exportBtn" data-cb="open">Open entry</button>' +
      '</div>' +
      '<div class="cb-hint">It is a <b>draft</b> until you open entry &mdash; which runs the validation gate ' +
      'and asks you to confirm, because the first participant to enter locks every parameter.</div>' +
      '</div>';
    host.querySelectorAll('button[data-cb]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.cb === 'copy') { copyLink(code, b); return; }
        var run = runs.filter(function (r) { return r.id === id; })[0];
        if (!run) { note('nr-note', 'That session is no longer in the list. Press Refresh.', true); return; }
        if (b.dataset.cb === 'params') { selectRun(run); openTab('params'); return; }
        if (b.dataset.cb === 'open') setStatus(run, 'open');
      };
    });
  }

  /* ---- the demo session -------------------------------------------------
     A 4-round session to show a class how the game works before they play the
     real one: two rounds without the AI, then two with it, and inside each half
     one round that starts with nothing open followed by one that starts with a
     few prizes already open. It exists because the study itself is 28 rounds —
     far too long to walk through on a projector — and because the two things a
     new participant has to understand (the AI, and pre-opened prizes) are
     exactly what a 4-round tour can show.

     Every departure from the defaults below is deliberate:
       · warm-ups off, 2 scored rounds a block  → 4 rounds in total
       · 1 open + 1 seeded a block, no shuffle  → the open round always comes
         first, so "nothing open" is met before "a few already open"
       · nextEntrantOverride 'A'                → EVERY entrant gets the no-AI
         half first. The control is labelled "next entrant" but it is not
         consumed, so it holds for the whole session, which is what a
         demonstration needs — the counterbalancing that makes the real study
         a crossover would send half the room in the other order.
       · densities                              → the open round runs the DENSE
         AI (10 anchors, usually close) and the seeded one the SPARSE AI (3
         anchors, wrong in the middle), so a class sees both faces of it.
       · exit survey off, debrief on            → nobody should fill in 24
         questions to see a demo, and the debrief is the teaching part.
       · a different generator seed             → THE POINT. Round specs are
         drawn from a pool shuffled by this seed, and two sessions sharing it
         serve the same prize curves in the same slots. A class that had seen
         the real round 1 in the demo would know where its best prize is, so the
         demo must draw from a different shuffle. */
  var DEMO = { code: 'TEST', name: 'For testing purposes' };
  function demoParams() {
    var p = Specs.withDefaults(null);
    p.env.generatorSeed = 20260814;
    p.rounds.warmupPerBlock = 0;
    p.rounds.scoredPerBlock = 2;
    p.rounds.openPerBlock = 1;
    p.rounds.seededPerBlock = 1;
    p.rounds.shapeMix = { FRONTIER: 0, BALANCED: 1, GAP: 0 };
    p.rounds.densitySeeded = { SPARSE: 1, DENSE: 0 };
    p.rounds.densityOpen = { SPARSE: 0, DENSE: 1 };
    p.rounds.shuffleWithinBlock = false;
    p.assign.sequenceAssignment = 'block';
    p.assign.nextEntrantOverride = 'A';
    p.ops.runName = DEMO.name;
    p.ops.code = DEMO.code;
    p.ops.entryOpen = false;
    p.ops.exitSurvey = false;
    p.ops.debrief = true;
    return p;
  }
  // The one instruction screen whose default wording counts the practice rounds.
  // A demo has none, so it is reworded for this session through the per-session
  // wording system rather than by touching the study's own text.
  function demoContent() {
    return {
      'instr.i5.body':
        'This is a short **demonstration**: **2 rounds without the AI**, then **2 rounds with it**. ' +
        'The full study is longer.\n\n' +
        '**The prizes are drawn afresh in every round.** What you learned about the line in one round tells ' +
        'you nothing about the next.\n\n' +
        'The second round of each pair starts with a few positions already open, for free. Those are shown ' +
        'to you at the start.\n\n' +
        'You can reopen this summary at any time from the button at the top right of the game screen.'
    };
  }

  function createDemoRun(btn) {
    var existing = runs.filter(function (r) { return String(r.code || '').toUpperCase() === DEMO.code; })[0];
    if (existing) {
      note('nr-note', 'A session with the ID <b>' + esc(DEMO.code) + '</b> already exists (' +
        esc(existing.name || 'untitled') + '). Delete it first, or open it from its card below.', true);
      return;
    }
    var p = demoParams();
    askSummary('Create the 4-round demo session?',
      'A short session to show a class how the game works: <b>2 rounds without the AI, then 2 with it</b>, ' +
      'and in each half one round that starts empty followed by one that starts with a few prizes already ' +
      'open. Every entrant gets the same order, the exit survey is off and it draws its prize curves from a ' +
      'different shuffle than a default session, so it gives nothing away about the real one.',
      summaryBoxes(p), 'Create session', function () {
        btn.disabled = true;
        createRun(newRunDoc(p, DEMO.name, DEMO.code, demoContent())).then(function (id) {
          btn.disabled = false;
          showCreated(id, DEMO.code, DEMO.name);
          loadRuns(id);
        }, function (e) {
          btn.disabled = false;
          note('nr-note', 'Could not create the demo session: ' + esc(String(e && e.message || e)), true);
        });
      });
  }

  function savedDefaultParams() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem('searchv2:v3:admin:defaults') || 'null'); } catch (e) {}
    return Specs.withDefaults(d);
  }

  // `selectId` — a session to select once the list is back (a just-created one),
  // so creating it is also opening it.
  function loadRuns(selectId) {
    var p = LOCAL ? Promise.resolve(localRuns()) : FB.listRuns();
    p.then(function (list) {
      runs = list || [];
      renderRuns();
      loadRunStats();
      var picked = selectId ? runs.filter(function (r) { return r.id === selectId; })[0] : null;
      // A session named by the caller was just created or just opened — an
      // explicit act, so the form follows it. The fallback pick is the panel's
      // own choice, so it feeds the read screens ONLY: the form stays on a new
      // session and Save cannot rewrite a session nobody asked to edit.
      if (picked) selectRun(picked);
      else if (!current && runs.length) selectRun(runs[0], { form: false });
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

  // A session is DONE once it is closed or archived; everything else — draft,
  // validating, open — is still in play and belongs in the active list.
  function isDone(r) { var st = r.status || 'draft'; return st === 'closed' || st === 'archived'; }

  function runCardHTML(r) {
    var st = r.status || 'draft';
    var done = isDone(r);
    var started = r.stats ? (r.stats.started || 0) : 0;
    var completed = r.stats ? (r.stats.completed || 0) : 0;
    var bal = (r.counts ? (r.counts.nA || 0) + ' A / ' + (r.counts.nB || 0) + ' B' : '—');
    var p = Specs.withDefaults(r.params);
    var rounds = 2 * (p.rounds.warmupPerBlock + p.rounds.scoredPerBlock);
    var server = (r.serverMode || (r.ops && r.ops.compute === 'server'));
    var created = r.createdAt
      ? new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    // Active sessions offer the join link; a closed one would hand out a link
    // that refuses the entrant, so it is left off exactly as the copy says.
    var acts = ['<button class="sBtn sBtnPrimary" data-act="open">Open</button>'];
    if (!done && r.code) acts.push('<button class="sBtn sBtnSec" data-act="copy">Copy link</button>');
    acts.push('<button class="sBtn exportBtn" data-act="export">⬇ Export data</button>');
    acts.push('<button class="sBtn sBtnSec" data-act="testround">🧪 Test round</button>');
    acts.push('<button class="sBtn sBtnSec" data-act="clone">Clone</button>');
    if (!done) {
      acts.push(st === 'open' ? '<button class="sBtn closeBtn" data-act="close">Close session</button>'
                              : '<button class="sBtn sBtnSec" data-act="open-entry">Open entry</button>');
    }
    acts.push('<button class="sBtn deleteBtn" data-act="delete">Delete</button>');

    return '<div class="run-card" data-id="' + esc(r.id) + '">' +
      '<div class="run-head">' +
        '<div><div class="run-title"><span class="run-code">' + esc(r.code || '—') + '</span>' +
          '<span class="status ' + esc(st) + '">' + esc(st) + '</span>' +
          (r.locked ? ' <span class="lock-tag">🔒 locked</span>' : '') + '</div>' +
          '<div class="run-name">' + esc(r.name || 'untitled') + '</div>' +
          '<div class="run-meta">Created ' + esc(created) +
            ' · id <span class="mono">' + esc(r.id) + '</span></div></div>' +
        '<div class="run-right">' +
          '<div class="run-people">' + started + ' participant' + (started === 1 ? '' : 's') + '</div>' +
          '<div class="run-meta">' + completed + ' completed · sequence ' + esc(bal) + '<br>' +
            rounds + ' rounds · AI in one block of two</div>' +
          '<div style="margin-top:6px;"><span class="cond-chip ' + (server ? 'server' : 'client') + '">' +
            (server ? 'Scored on the server' : 'Scored in the browser') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="run-acts">' + acts.join('') + '</div></div>';
  }

  function renderRuns() {
    var active = runs.filter(function (r) { return !isDone(r); });
    var done = runs.filter(isDone);
    fillRunSection('runs-active', 'runs-active-n', active,
      'No active sessions yet. <b>Create a session</b> above starts one from the saved defaults.',
      function (n) { return n + ' active'; });
    fillRunSection('runs-done', 'runs-done-n', done,
      'No completed sessions yet. Closing a session moves it here and keeps its data.',
      function (n) { return n + ' total'; });
  }

  function fillRunSection(hostId, countId, list, emptyHtml, label) {
    var host = $(hostId);
    if (!host) return;
    $(countId).textContent = list.length ? label(list.length) : '';
    host.innerHTML = list.length ? list.map(runCardHTML).join('') : '<div class="empty-card">' + emptyHtml + '</div>';
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
  // One copier for the cards and the created-code box. The async clipboard is
  // absent on an insecure origin and can be refused outright, so a failure falls
  // back to the old selection copy and finally to showing the link to copy by
  // hand — never to a button that silently does nothing.
  function copyLink(code, btn) {
    var url = launchUrl(code), old = btn.textContent;
    function flash() { btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = old; }, 1400); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(ta);
      if (done) flash(); else window.prompt('Copy the participant link:', url);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(flash, fallback);
    } else fallback();
  }
  // ONE builder for every sandbox link, so the launch box and the cards can never
  // open different things.
  // `order` ('ask' | 'reveal') rehearses one side of the button swap. Without
  // it a sandbox always shows whichever layout the constant preview code hashes
  // to, so half of what participants meet could never be checked before a
  // session opened.
  function previewUrl(code, spec, order) {
    var base = location.origin + location.pathname.replace(/admin\/?$/, '');
    return base + '?preview=1&debug=1&key=' + encodeURIComponent(CFG.DEBUG_KEY) +
      (code ? '&code=' + encodeURIComponent(code) : '') +
      (spec ? '&spec=' + encodeURIComponent(spec) : '') +
      (order ? '&order=' + encodeURIComponent(order) : '');
  }

  function runAction(act, run, btn) {
    if (!run) return;
    if (act === 'open') { selectRun(run); openTab('params'); return; }
    if (act === 'copy') { copyLink(run.code, btn); return; }
    if (act === 'testround') { window.open(previewUrl(run.code), '_blank'); return; }
    if (act === 'export') { exportRun(run, btn); return; }
    if (act === 'clone') { cloneRun(run); return; }
    if (act === 'close') { setStatus(run, 'closed'); return; }
    if (act === 'open-entry') { setStatus(run, 'open'); return; }
    if (act === 'delete') {
      var n = run.stats ? (run.stats.started || 0) : 0;
      if (!confirm('Delete the session "' + (run.code || run.id) + ' — ' + (run.name || 'untitled') + '"?\n\n' +
        'This removes the session AND its event log' + (n ? ' (' + n + ' participant' + (n === 1 ? '' : 's') + ' so far)' : '') +
        '. Export the data first if you want to keep it.\n\nThis cannot be undone.')) return;
      var wipe = (LOCAL || !FB.isConfigured()) ? Promise.resolve(0) : FB.deleteRunData(run.id).catch(function () { return 0; });
      wipe.then(function () {
        return LOCAL ? Promise.resolve(saveLocalRuns(localRuns().filter(function (r) { return r.id !== run.id; })))
                     : FB.deleteRun(run.id).then(function () { return FB.audit(run.id, 'delete_run', run.name); });
      }).then(function () { current = null; editingId = null; loadRuns(); });
    }
  }

  // "Export data" from a card is the whole job in one press: select the session,
  // read its event log, build the workbook and save it. The Data screen is opened
  // behind it so the tables and the health checks are there to look at.
  function exportRun(run, btn) {
    selectRun(run); openTab('data');
    var old = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Preparing…'; btn.disabled = true; }
    loadEvents().then(function () {
      renderData();
      if (!built || !built.raw.length) {
        if (btn) { btn.textContent = old; btn.disabled = false; }
        note('data-note', 'Nothing to export yet: this session has no event rows.', true);
        return;
      }
      downloadXlsx();
      if (btn) {
        btn.textContent = '✓ Downloaded';
        setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1600);
      }
    }, function () { if (btn) { btn.textContent = old; btn.disabled = false; } });
  }

  // ======================================================================
  //  SESSION SUMMARY  —  shown before a session is created, and again before
  //  it opens to participants
  // ======================================================================
  // Both moments are one-way in practice: creating freezes the pool and the
  // specs, and the first entrant locks every task parameter for good. So the
  // settings are put in front of the admin as prose, once, in the order they
  // matter — rather than left spread over seven collapsed groups.
  function summaryBoxes(p, extra) {
    var rounds = 2 * (p.rounds.warmupPerBlock + p.rounds.scoredPerBlock);
    var sigma = CFG.sigma(p.env.stepBound), sStar = CFG.sStar(p.costs.revealCost);
    var sdS = sigma * Math.sqrt(p.env.positions / p.ai.sparseK) / 2;
    var sdD = sigma * Math.sqrt(p.env.positions / p.ai.denseK) / 2;
    var bracket = (sdS > sStar && sdD < sStar);
    var box = [];
    box.push(['The session', [
      'Name: <b>' + esc(p.ops.runName || 'untitled') + '</b>',
      'Code: <b>' + esc(p.ops.code || '—') + '</b>',
      'Entry: <b>' + (p.ops.entryOpen ? 'open' : 'closed') + '</b> · roster <b>' + esc(p.ops.rosterMode) + '</b>',
      'Scored: <b>' + (p.ops.compute === 'server' ? 'on the server (Cloud Functions)' : 'in the browser') + '</b>'
    ]]);
    box.push(['Rounds', [
      '<b>' + rounds + '</b> rounds: ' + (2 * p.rounds.warmupPerBlock) + ' warm-up, ' +
        (2 * p.rounds.scoredPerBlock) + ' scored',
      'Two blocks of ' + p.rounds.scoredPerBlock + ' — <b>AI in one block only</b>',
      'Per block: ' + p.rounds.openPerBlock + ' open, ' + p.rounds.seededPerBlock + ' seeded',
      'Order within a block: ' + (p.rounds.shuffleWithinBlock ? 'shuffled per participant' : 'fixed')
    ]]);
    box.push(['The task', [
      p.env.positions + ' positions, prizes ' + p.env.prizeMin + '–' + p.env.prizeMax,
      'Neighbours differ by at most <b>' + p.env.stepBound + '</b>',
      'Reveal <b>' + p.costs.revealCost + '</b> (cap ' + p.costs.revealCap + ') · ask <b>' +
        p.costs.queryCost + '</b> (cap ' + p.costs.queryCap + ')',
      'Score floor: ' + (p.costs.scoreFloor ? 'yes' : '<b>none</b> — a round may end negative')
    ]]);
    box.push(['The AI', [
      'Sparse <b>K=' + p.ai.sparseK + '</b> · dense <b>K=' + p.ai.denseK + '</b>, ' + esc(p.ai.placement),
      'Answers rounded: ' + esc(p.ai.answerRounding),
      bracket ? 'The two settings <b>bracket s* = ' + sStar.toFixed(2) + '</b> — the prediction stays a change of sign'
              : '<b>⚠ Both settings sit on the same side of s* = ' + sStar.toFixed(2) + '</b> — this tests a gradient, not a sign change',
      (p.ai.drawCurve || p.ai.markAnchors)
        ? '<b>⚠ A testing overlay is ON for participants</b> (' +
          (p.ai.drawCurve ? 'the whole curve is drawn' : '') +
          (p.ai.drawCurve && p.ai.markAnchors ? '; ' : '') +
          (p.ai.markAnchors ? 'its anchors are marked' : '') + ')'
        : 'Its curve and anchors stay hidden, as they must'
    ]]);
    box.push(['The interface', [
      'The two paid buttons: <b>' + (p.ui.buttonOrder === 'participant'
        ? 'order randomised per participant' : 'fixed — Ask on the left') + '</b>',
      'Side by side, one style, matched hues — neither is the primary action',
      'Encouragement: ' + (p.ui.encouragement
        ? '<b>on</b> — milestones, one in-round tip, and a focus prompt at ≤' + p.ui.rushMinActions + ' actions'
        : 'off'),
      'Cost numerals: <b>' + esc(p.ui.costColorReveal) + '</b> reveal · <b>' + esc(p.ui.costColorQuery) + '</b> ask'
    ]]);
    box.push(['Assignment', [
      'Sequence: ' + esc(p.assign.sequenceAssignment),
      'Button order: ' + (p.ui.buttonOrder === 'participant'
        ? 'block-randomised <b>jointly with the sequence</b>' : 'fixed for everyone'),
      'Next entrant: ' + (p.assign.nextEntrantOverride === 'auto' ? 'automatic' : '<b>forced ' + esc(p.assign.nextEntrantOverride) + '</b>'),
      'Seeds frozen: ' + (p.assign.freezeSeeds ? 'yes' : 'no') + ' · anchors frozen: ' + (p.assign.freezeAnchors ? 'yes' : 'no'),
      'Mapping pool: ' + p.env.poolSize + ', seed ' + p.env.generatorSeed
    ]]);
    box.push(['After the task', [
      'Exit survey: ' + (p.ops.exitSurvey ? 'yes' : 'no'),
      'Debrief screen: ' + (p.ops.debrief ? 'yes' : 'no'),
      'Resume within ' + p.ops.resumeWindowH + ' h: ' + (p.ops.allowResume ? 'yes' : 'no'),
      'Completion code: ' + (p.ops.completionCode ? '<b>' + esc(p.ops.completionCode) + '</b>' : 'none shown')
    ]]);
    (extra || []).forEach(function (e) { box.push(e); });
    return '<div class="sum-grid">' + box.map(function (b) {
      return '<div class="sum-box"><h4>' + esc(b[0]) + '</h4><div>' + b[1].join('<br>') + '</div></div>';
    }).join('') + '</div>';
  }

  // A modal, built and torn down per use so there is never a stale one in the
  // DOM to click through. Resolves only on confirm.
  // `opts.formHtml`  — controls shown ABOVE the summary (the name and session ID
  //                    a new session is given here, rather than hunted for in the
  //                    Operations group).
  // `opts.validate`  — reads those controls and returns the value handed to
  //                    onOk, or a string to show as an error and KEEP the dialog
  //                    open. Without it the dialog is a plain confirm.
  function askSummary(title, lead, bodyHtml, okLabel, onOk, opts) {
    opts = opts || {};
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'sess-summary';
    back.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<h2 style="margin:0 0 4px;">' + esc(title) + '</h2>' +
      '<p class="muted small" style="margin:0;">' + lead + '</p>' +
      (opts.formHtml || '') +
      '<div class="admin-note bad" id="sum-err" style="display:none;"></div>' +
      bodyHtml +
      '<div class="modal-acts">' +
        '<button class="btn btn-ghost btn-sm" id="sum-cancel">Cancel</button>' +
        '<button class="btn btn-green btn-sm" id="sum-ok">' + esc(okLabel) + '</button>' +
      '</div></div>';
    document.body.appendChild(back);
    function close() { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.querySelector('#sum-cancel').onclick = close;
    back.onclick = function (e) { if (e.target === back) close(); };
    back.querySelector('#sum-ok').onclick = function () {
      if (!opts.validate) { close(); onOk(); return; }
      var v = opts.validate(back);
      if (typeof v === 'string') {
        var err = back.querySelector('#sum-err');
        err.innerHTML = v; err.style.display = '';
        return;
      }
      close(); onOk(v);
    };
    var first = opts.formHtml && back.querySelector('.modal-card input');
    (first || back.querySelector('#sum-ok')).focus();
    return back;
  }

  function setStatus(run, status) {
    if (status === 'open') {
      // §17b Screen 6: a session cannot move from draft to open until the
      // validation gate passes. (Built once — regenerating a 600-mapping pool
      // twice for the same check is pure waste.)
      var a = artifacts(run);
      var v = Specs.validate(a.pool, a.specs, a.params);
      if (!v.pass) {
        alert('This session cannot open until the validation gate passes:\n\n• ' + v.failures.join('\n• '));
        return;
      }
      // Opening is the point of no return: the first entrant locks every task
      // parameter, so the whole session is summarised here before it can happen.
      var p = Specs.withDefaults(run.params);
      if (run.ops) Object.keys(run.ops).forEach(function (k) { p.ops[k] = run.ops[k]; });
      p.ops.code = run.code || p.ops.code;
      p.ops.runName = run.name || p.ops.runName;
      askSummary('Open this session to participants?',
        'The <b>first participant to enter locks every parameter below</b> for good — after that, changing anything ' +
        'means cloning the session. The validation gate has passed. Read it once more:',
        summaryBoxes(p, [['Participant link', [
          run.code ? '<span class="mono">' + esc(launchUrl(run.code)) + '</span>' : 'no code set',
          'Simulation Platform students arrive on this link with their student ID as their participant code.'
        ]]]),
        'Open entry', function () { writeStatus(run, status); });
      return;
    }
    writeStatus(run, status);
  }
  function writeStatus(run, status) {
    var patch = { status: status, ops: Object.assign({}, run.ops || {}, { entryOpen: status === 'open' }) };
    persist(run.id, patch).then(function () {
      FB.isConfigured() && !LOCAL && FB.audit(run.id, 'status_' + status, run.name);
      loadRuns();
    });
  }

  function cloneRun(run) {
    var p = clone(Specs.withDefaults(run.params));
    var name = prompt('Name for the cloned session:', (run.name || 'untitled') + ' (clone)');
    if (name == null) return;
    var obj = newRunDoc(p, name, autoCode(), Content.parseOverrides(run.contentJson || run.content));
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
      // This session's wording travels with the redacted copy. In server mode
      // the run document is admin-only, so without this the participant app
      // could never see an override and every session would read the defaults.
      // A STRING, so that a revert actually removes the key: both writers use
      // setDoc(merge:true), which deep-merges a map but replaces a string.
      contentJson: Content.stringifyOverrides(run.contentJson || run.content),
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
        // The interface group must travel: it holds nothing secret, and
        // WITHOUT it Specs.withDefaults on the participant's side takes the
        // "stored before `ui` existed" branch and quietly forces the whole
        // session to fixed buttons with no encouragement — in server mode,
        // where the redacted copy is ALL the participant ever sees.
        ui: clone(p.ui),
        ops: clone(p.ops)
      },
      updatedAt: Date.now()
    };
  }

  function newRunDoc(p, name, code, contentOv) {
    var params = clone(p);
    params.ops.runName = name;
    // Every session is created as a draft, so the entry flag has to agree with
    // the status: app.js opens a session when `ops.entryOpen !== false` OR the
    // status is 'open', so a draft created with the Operations toggle left on
    // would be enterable before the validation gate had ever run. Entry is
    // opened from the card, which runs that gate and asks for confirmation.
    params.ops.entryOpen = false;
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
      overrides: [],
      contentJson: Content.stringifyOverrides(contentOv)
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

  // `opts.form === false` — look at this session on the read screens WITHOUT
  // pointing the parameter form at it. That is what the panel's own opening pick
  // does: the form stays on a new session, so the obvious thing to do with it
  // (change something, press Save) creates a session instead of rewriting one
  // that may already have participants in it.
  function selectRun(run, opts) {
    var bindForm = !(opts && opts.form === false);
    current = run;
    editingId = bindForm ? run.id : null;
    if (!bindForm) {
      currentParams = savedDefaultParams();
      currentContent = {};
      fillForm(currentParams, null);
      if ($('tab-wording') && $('tab-wording').style.display !== 'none') renderWording();
      renderRoster();
      fillSpecPicker();
      rgFor = null; notesFor = null;
      if ($('tab-data') && $('tab-data').style.display !== 'none') renderRoundGallery();
      if ($('tab-notes') && $('tab-notes').style.display !== 'none') renderNotes();
      return;
    }
    currentParams = Specs.withDefaults(run.params);
    currentContent = Content.parseOverrides(run.contentJson || run.content);
    if ($('tab-wording') && $('tab-wording').style.display !== 'none') renderWording();
    if (run.ops) Object.keys(run.ops).forEach(function (k) { currentParams.ops[k] = run.ops[k]; });
    if (run.code) currentParams.ops.code = run.code;
    fillForm(currentParams, run);
    renderRoster();
    fillSpecPicker();
    rgFor = null; notesFor = null;   // a different session means different rounds
    if ($('tab-data') && $('tab-data').style.display !== 'none') renderRoundGallery();
    if ($('tab-notes') && $('tab-notes').style.display !== 'none') renderNotes();
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
    ['ui', 'buttonOrder', 'seg'], ['ui', 'costColorReveal', 'txt'], ['ui', 'costColorQuery', 'txt'],
    ['ui', 'encouragement', 'seg'], ['ui', 'rushMinActions', 'num'],
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
    // Only meaningful while the form is bound to a session — it discards the
    // edits by re-reading that session. It is hidden on a new session, where
    // there is nothing to go back to.
    $('btn-cancel').onclick = function () { if (editingId && current) selectRun(current); };
    $('btn-makedefault').onclick = function () {
      readForm();
      try { localStorage.setItem('searchv2:v3:admin:defaults', JSON.stringify(currentParams)); } catch (e) {}
      note('save-note', 'Saved as the starting point for new runs on this machine.');
    };
    $('btn-restore').onclick = function () {
      currentParams = Specs.withDefaults(null);
      fillForm(currentParams, current);
      note('save-note', 'Form reset to the built-in defaults. Nothing is written until you press the green button.');
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

    $('params-title').textContent = run ? ('Parameters · ' + (run.name || 'untitled')) : 'Parameters · new session';
    $('params-sub').textContent = run ? ('session ' + (run.code || run.id) + (run.locked ? ' · locked' : ' · draft')) : 'not created yet';
    // The button says which of the two things it does, because they are not
    // undoable in the same way: one adds a session, the other rewrites one that
    // may already be open. Naming the session on the button is the last cheap
    // warning before the confirmation.
    $('btn-save').textContent = run ? ('Save changes to ' + (run.code || 'this session')) : 'Create session';
    $('btn-save').title = run
      ? 'Write these parameters back to the session named on the button. It does NOT create a new one.'
      : 'Create a NEW session with these parameters. You name it and give it a session ID next.';
    $('btn-cancel').style.display = run ? '' : 'none';
    $('btn-cancel').textContent = 'Cancel edit';
    note('edit-note', run
      ? 'Editing the <b>existing</b> session <b>' + esc(run.code || run.id) + '</b> &mdash; ' +
        esc(run.name || 'untitled') + '. Saving rewrites <b>that</b> session and creates nothing. ' +
        'To build a different session from these settings instead, press ' +
        '<b>Set the parameters first&hellip;</b> on the Sessions screen.'
      : 'This is a <b>new session</b>, not created yet. Set whatever the task needs, then press ' +
        '<b>Create session</b> &mdash; you choose the name and the session ID at that point. ' +
        'No existing session is touched.', false);

    if (locked) {
      note('lock-note', '🔒 <b>Locked since the first participant' +
        (run.lockedAt ? ', ' + new Date(run.lockedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '') +
        '.</b> Every parameter that touches the task is fixed for this session. To change anything, ' +
        '<b>clone the session</b> from the Sessions screen and collect under a new id. Only the Operations group ' +
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

  // The two things every session needs, asked in the create dialog itself. They
  // mirror the Sessions screen's create card — same labels, same rules — so the
  // two ways into a session ask the same question the same way.
  function createFieldsHTML(name, code) {
    return '<div class="create-card" style="margin:12px 0 0;"><div class="row2">' +
      '<div class="field"><label for="sum-name">Session name</label>' +
        '<input type="text" id="sum-name" maxlength="80" autocomplete="off" spellcheck="false" ' +
        'placeholder="e.g. Spring MBA 2026" value="' + esc(name) + '"></div>' +
      '<div class="field"><label for="sum-code">Session ID <span class="defval">&middot; goes in the participant link</span></label>' +
        '<input type="text" id="sum-code" maxlength="40" autocomplete="off" spellcheck="false" ' +
        'style="text-transform:uppercase; letter-spacing:.06em;" placeholder="(OPTIONAL) CUSTOM CODE" value="' + esc(code) + '">' +
        '<div class="hint">Leave blank for an automatic code. Single word &mdash; capital letters and digits ' +
        'only (3&ndash;40 chars).</div></div>' +
      '</div></div>';
  }
  // Returns {name, code} — or an error string, which keeps the dialog open. The
  // server-side check the Sessions card does (another admin may have taken the
  // code since this list was read) cannot run here without making the dialog
  // async; createRun's own write is the backstop, and a clash is reported.
  function readCreateFields(back) {
    var nameEl = back.querySelector('#sum-name'), codeEl = back.querySelector('#sum-code');
    var name = (nameEl.value || '').trim() || 'untitled';
    var typed = normCode(codeEl.value);
    if (typed && typed.length < 3) {
      codeEl.focus();
      return 'A custom <b>Session ID</b> is 3&ndash;40 characters, capital letters and digits only. ' +
             'Leave it blank for an automatic code.';
    }
    if (typed && codeInUse(typed)) {
      codeEl.focus();
      return 'Session ID <b>' + esc(typed) + '</b> is already taken by another session. Choose another, ' +
             'or leave it blank for an automatic code.';
    }
    return { name: name, code: typed || freshCode() };
  }

  function saveRun() {
    readForm();
    var code = currentParams.ops.code || '';
    var name = currentParams.ops.runName || '';
    if (!editingId) {
      // Creating freezes the mapping pool and every round spec under these
      // seeds, so the summary comes first — this is the last cheap moment to
      // notice that something was set wrong. The name and the session ID are
      // chosen HERE, in the same breath, so "these are the parameters I want"
      // and "this is the session they belong to" are one decision.
      var pending = clone(currentParams);
      pending.ops.entryOpen = false;   // what newRunDoc will write, so the summary can't promise otherwise
      askSummary('Create this session?',
        'Creating freezes the mapping pool and all <b>' +
        (2 * (pending.rounds.warmupPerBlock + pending.rounds.scoredPerBlock)) +
        ' round specs</b> under the seeds below. It opens as a <b>draft</b>, so nobody can enter yet — ' +
        'and no existing session is changed.',
        summaryBoxes(pending), 'Create session',
        function (v) {
          var obj = newRunDoc(currentParams, v.name, v.code, currentContent);
          createRun(obj).then(function (id) {
            note('save-note', 'Session <b>' + esc(v.code) + '</b> created as a <b>draft</b>. Run the validation gate on the ' +
              'Data screen — and check the round plots at the bottom of it — before opening entry.');
            // Select what was just created. Without this the form stayed on a
            // NEW session with editingId null, so pressing Save again created a
            // second session on the same code — and re-pointed the code at it.
            loadRuns(id);
            // The created box carries Copy link and Open entry, so the session
            // is one press from live rather than a hunt back through the cards.
            showCreated(id, v.code, v.name);
            openTab('runs');
          }).catch(function (e) { note('save-note', 'Could not create the session: ' + esc(String(e && e.message || e)), true); });
        },
        { formHtml: createFieldsHTML(name, code), validate: readCreateFields });
      return;
    }
    var run = current;
    // Rewriting an existing session is named and confirmed. It used to be the
    // silent default of a form the panel had bound to whichever session it
    // picked at load, which is how a parameter change meant for the next session
    // landed on an old one instead.
    if (!confirm('Save these parameters to the EXISTING session "' + (run && run.code || editingId) +
      ' — ' + ((run && run.name) || 'untitled') + '"?\n\n' +
      'This rewrites that session. It does NOT create a new one.' +
      (run && run.locked ? '\n\nIt is locked, so only the Operations group and the next-entrant override change.' : ''))) return;
    code = code || (run && run.code) || autoCode();
    name = name || (run && run.name) || 'untitled';
    var patch;
    if (run && run.locked) {
      // Locked: only Operations and the entrant override may move. The Rules
      // refuse anything else anyway; refusing it here too keeps the panel honest.
      patch = { name: name, ops: clone(currentParams.ops), assign: Object.assign({}, run.assign || {}, { nextEntrantOverride: currentParams.assign.nextEntrantOverride }),
        contentJson: Content.stringifyOverrides(currentContent) };
    } else {
      var pool = Pool.buildPool(currentParams.env, currentParams.env.generatorSeed);
      var specSeed = currentParams.env.generatorSeed + 1;
      var specs = Specs.buildSpecs(pool, currentParams, specSeed);
      patch = {
        name: name, code: code, params: clone(currentParams), ops: clone(currentParams.ops),
        assign: clone(currentParams.assign), specSeed: specSeed, specsJson: JSON.stringify(specs),
        poolChecksum: X.checksum(JSON.stringify(pool)), specsChecksum: X.checksum(JSON.stringify(specs)),
        seeds: { generatorSeed: currentParams.env.generatorSeed, specSeed: specSeed },
        contentJson: Content.stringifyOverrides(currentContent)
      };
    }
    patch.serverMode = (currentParams.ops.compute === 'server');
    persist(editingId, patch).then(function () {
      if (!LOCAL) {
        FB.audit(editingId, 'save_run', name);
        FB.putRunPublic(editingId, publicDoc(
          { name: name, code: code, status: (run && run.status) || 'draft', contentJson: Content.stringifyOverrides(currentContent) },
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
  var rosterRecs = {};   // participant_code (upper) → their session record

  // A session runs TWO blocks, warm-ups first inside each (Specs.orderPlan), and
  // that is what turns "rounds finished" into "scored rounds finished".
  var BLOCKS = 2;

  function scoredTotal(params) {
    return BLOCKS * ((params && params.rounds && params.rounds.scoredPerBlock) || 0);
  }
  // The participant record carries `rounds_done` — every round they finished,
  // warm-ups included. The warm-ups sit at the head of each block, so the scored
  // count is the part of that total falling outside the two warm-up stretches,
  // computed from THIS session's own parameters rather than the default 4 + 24.
  function scoredDone(roundsDone, params) {
    var w = (params && params.rounds && params.rounds.warmupPerBlock) || 0;
    var s = (params && params.rounds && params.rounds.scoredPerBlock) || 0;
    var n = roundsDone || 0, out = 0;
    for (var b = 0; b < BLOCKS; b++) out += Math.max(0, Math.min(n - (b * (w + s) + w), s));
    return out;
  }
  // "18/24 (75%)". Empty when there is no session record to read it from: an
  // unclaimed code has finished nothing, but it has not finished zero rounds
  // either, and the two must not look the same.
  function roundCell(rec, params) {
    var total = scoredTotal(params);
    if (!rec || !total) return '—';
    // A record with no `rounds_done` but `completed` set is a finished session
    // written before that field existed: finishing means every round is behind
    // them, so it reads as complete rather than as a blank.
    var done = rec.rounds_done != null ? scoredDone(rec.rounds_done, params)
      : (rec.completed ? total : null);
    if (done == null) return '—';
    return done + '/' + total + ' (' + Math.round(100 * done / total) + '%)';
  }

  // The roster document only ever learns that a code was CLAIMED — the study
  // stamps it 'started' at entry. Whether the session was finished lives on the
  // participant record (`completed`, written on the Done screen), so the status
  // shown here is derived from the two together. app.js also writes 'completed'
  // back onto the roster document now, but this reading is what heals every
  // session recorded before it did.
  function derivedStatus(r, rec) {
    if (rec && rec.completed) return 'completed';
    if (r && r.status === 'completed') return 'completed';
    if (rec || (r && r.claimedByUid)) return 'started';
    return r && r.status ? r.status : 'unused';
  }

  function recOf(r) { return rosterRecs[String(r && r.code).toUpperCase()] || null; }

  // Which of the two paid buttons sat on the LEFT for this participant. The
  // stored value is the raw `buttonOrder`; the column names the button itself,
  // because "ask_first" told the reader nothing about what they were looking at.
  function leftButton(r) {
    return r.buttonOrder === 'reveal_first' ? 'Reveal'
      : r.buttonOrder === 'ask_first' ? 'Ask the AI' : '—';
  }
  function enrolledAs(r) {
    return r.orphan ? 'no roster entry' : r.autoEnrolled ? 'platform / open' : 'pre-generated';
  }
  // Scored rounds finished, as a number, for sorting and the CSV. null when
  // there is no session record to read it from.
  function scoredDoneOf(rec, params) {
    if (!rec) return null;
    if (rec.rounds_done != null) return scoredDone(rec.rounds_done, params);
    return rec.completed ? scoredTotal(params) : null;
  }

  // ONE definition per column — its heading, what the cell says and what it
  // sorts on — so a sorted table can never order itself by something other than
  // what it is showing. A null sort value means "nothing to compare", and those
  // rows sink to the bottom in BOTH directions.
  function rosterCols(params) {
    return [
      { key: 'code', label: 'Code', cls: 'mono',
        cell: function (r) { return esc(r.code); },
        sort: function (r) { return r.code || null; } },
      { key: 'sequence', label: 'Sequence',
        title: 'The crossover order: A ran the AI-off block first, B the AI-on block first.',
        cell: function (r) { return esc(r.sequence || '—'); },
        sort: function (r) { return r.sequence || null; } },
      { key: 'buttons', label: 'Left button',
        title: 'Which of the two paid buttons — Ask the AI, or Reveal — sat on the LEFT of the screen for ' +
               'this participant. Assigned once when they enrolled and fixed for their whole session, ' +
               'block-randomised together with the sequence so all four cells fill evenly, and carried into ' +
               'the analysis as the covariate button_order.',
        cell: function (r) { return esc(leftButton(r)); },
        sort: function (r) { return r.buttonOrder ? leftButton(r) : null; } },
      { key: 'round', label: 'Round',
        title: 'Scored rounds finished, out of the ' + scoredTotal(params) + ' this session assigns each ' +
               'participant. Warm-up rounds are not counted. A participant can read 100% and still be ' +
               'in progress: the survey and the debrief come after the last round.',
        cell: function (r) { return esc(roundCell(recOf(r), params)); },
        sort: function (r) { return scoredDoneOf(recOf(r), params); } },
      { key: 'status', label: 'Status',
        title: 'Read from the participant’s own session record: completed the moment they reach the end.',
        cell: function (r) { return esc(derivedStatus(r, recOf(r))); },
        // Ordered by how far they got, not alphabetically — "completed, started,
        // unused" is an alphabetical accident, and progress is what is meant.
        sort: function (r) { var st = derivedStatus(r, recOf(r)); return { unused: 0, started: 1, completed: 2 }[st]; } },
      { key: 'claimed', label: 'Claimed',
        title: 'When this code was first claimed.',
        cell: function (r) { return r.claimedAt ? esc(new Date(r.claimedAt).toLocaleString()) : '—'; },
        sort: function (r) { return r.claimedAt || null; } },
      { key: 'enrolled', label: 'Enrolled',
        cell: function (r) { return esc(enrolledAs(r)); },
        sort: function (r) { return enrolledAs(r); } }
    ];
  }

  // Clicking a heading sorts by that column; clicking it again reverses it.
  var rosterSort = { key: null, dir: 1 };

  function sortRoster(rows, cols) {
    var col = cols.filter(function (c) { return c.key === rosterSort.key; })[0];
    if (!col) return rows;
    var dir = rosterSort.dir;
    // Decorated with the load position, so ties keep the order they arrived in
    // and a second sort on the same column is a clean reversal of the first.
    return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (x, y) {
      var a = col.sort(x.r), b = col.sort(y.r);
      if (a == null && b == null) return x.i - y.i;
      if (a == null) return 1;
      if (b == null) return -1;
      var c = (typeof a === 'number' && typeof b === 'number') ? (a - b)
        : String(a).localeCompare(String(b), undefined, { numeric: true });
      return c ? c * dir : x.i - y.i;
    }).map(function (x) { return x.r; });
  }

  function wireRoster() {
    $('btn-ros-csv').onclick = function () {
      var params = Specs.withDefaults(current && current.params);
      // Exported in the order on screen, so a sorted table and its CSV agree.
      var rows = sortRoster(roster, rosterCols(params));
      var csv = 'code,sequence,button_order,left_button,status,scored_rounds_done,scored_rounds_total,claimed_at,enrolled\n' +
        rows.map(function (r) {
          var rec = recOf(r);
          var done = scoredDoneOf(rec, params);
          return [r.code, r.sequence, r.buttonOrder || '', r.buttonOrder ? leftButton(r) : '',
            derivedStatus(r, rec), done == null ? '' : done, scoredTotal(params),
            r.claimedAt ? new Date(r.claimedAt).toISOString() : '',
            r.autoEnrolled ? 'platform/open' : (r.orphan ? 'no-roster-entry' : 'pre-generated')].join(',');
        }).join('\n');
      dl((current ? current.code : 'run') + '_participants.csv', csv, 'text/csv');
    };
  }

  function renderRoster() {
    if (!current) {
      $('roster-table').innerHTML = '<tbody><tr><td class="muted">Open a session first.</td></tr></tbody>';
      $('roster-stats').innerHTML = '';
      return;
    }
    var params = Specs.withDefaults(current.params);
    // Both halves of a participant's state: the roster document (assignment,
    // when they claimed) and their own session record (how far they got).
    var pRoster = LOCAL ? Promise.resolve(current.roster || []) : FB.listRoster(current.id);
    var pRecs = LOCAL ? Promise.resolve(current.participants || [])
      : FB.listParticipants(current.id).catch(function () { return []; });

    Promise.all([pRoster, pRecs]).then(function (both) {
      roster = (both[0] || []).slice();
      rosterRecs = {};
      (both[1] || []).forEach(function (rec) {
        if (rec && rec.participant_code) rosterRecs[String(rec.participant_code).toUpperCase()] = rec;
      });
      // A session record whose code has no roster document (the claim wrote one
      // half and not the other) still belongs on this screen: a participant who
      // is playing must never be invisible here.
      var have = {};
      roster.forEach(function (r) { have[String(r.code).toUpperCase()] = 1; });
      Object.keys(rosterRecs).forEach(function (code) {
        if (have[code]) return;
        var rec = rosterRecs[code];
        roster.push({ code: rec.participant_code, sequence: rec.sequence || null,
          buttonOrder: rec.button_order || null, status: 'started', orphan: true });
      });
      paintRoster();
    }).catch(function (e) {
      $('roster-table').innerHTML = '<tbody><tr><td class="muted">Could not read the participants: ' + esc(String(e && e.message || e)) + '</td></tr></tbody>';
    });
  }

  // Painting is separate from reading, so sorting a column re-renders what is
  // already loaded instead of firing two more collection reads per click.
  function paintRoster() {
    var params = Specs.withDefaults(current && current.params);
    var counts = { unused: 0, started: 0, completed: 0, abandoned: 0, A: 0, B: 0, ask: 0, reveal: 0 };
    roster.forEach(function (r) {
      var st = derivedStatus(r, recOf(r));
      counts[st] = (counts[st] || 0) + 1;
      if (r.sequence) counts[r.sequence]++;
      if (r.buttonOrder === 'reveal_first') counts.reveal++;
      else if (r.buttonOrder === 'ask_first') counts.ask++;
    });
    // Button order is a covariate in the primary analysis, so its balance is
    // shown beside the sequence's — "confirm it is balanced before the first
    // session opens" is a thing the panel has to make possible.
    $('roster-stats').innerHTML = [
      ['Codes', roster.length], ['Unused', counts.unused], ['In progress', counts.started],
      ['Completed', counts.completed], ['Sequence A', counts.A], ['Sequence B', counts.B],
      ['Ask on the left', counts.ask], ['Reveal on the left', counts.reveal]
    ].map(function (s) { return '<div class="stat-box"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('');

    var cols = rosterCols(params);
    $('roster-table').innerHTML = roster.length
      ? '<thead><tr>' + cols.map(function (c) {
          var on = rosterSort.key === c.key;
          return '<th class="sortable' + (on ? ' sorted' : '') + '" data-sk="' + c.key + '"' +
            ' title="' + esc((c.title ? c.title + ' ' : '') + 'Click to sort.') + '">' +
            esc(c.label) + '<span class="sarr">' + (on ? (rosterSort.dir > 0 ? '▲' : '▼') : '⇅') + '</span></th>';
        }).join('') + '</tr></thead><tbody>' +
        sortRoster(roster, cols).map(function (r) {
          return '<tr>' + cols.map(function (c) {
            return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.cell(r) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">No participants yet. In <b>open</b> roster mode a class-platform student ID enrols itself on first entry.</td></tr></tbody>';

    $('roster-table').querySelectorAll('th[data-sk]').forEach(function (th) {
      th.onclick = function () {
        var k = th.dataset.sk;
        if (rosterSort.key === k) rosterSort.dir = -rosterSort.dir;
        else { rosterSort.key = k; rosterSort.dir = 1; }
        paintRoster();
      };
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
      $('mon-counters').innerHTML = '<div class="stat-box"><b>—</b><span>open a session first</span></div>';
      return;
    }
    if (unsubMon) unsubMon();
    if (LOCAL) { monRows = []; renderMonitor(); return; }
    unsubMon = FB.watchParticipants(current.id, function (list) { monRows = list || []; renderMonitor(); });
  }
  // "Abandoned" was never observed — nobody tells us they have given up. It is
  // this arithmetic: started − completed − (updated in the last half hour). With
  // progress now mirrored to the participant record, an away participant can
  // come back on any device and carry on, so the tile says what it actually
  // knows — they have been AWAY for half an hour — and not that they are gone.
  var AWAY_MS = 30 * 60 * 1000;
  function fmtDur(ms) {
    if (!ms) return '0m';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h ' + (m % 60) + 'm';
  }
  function renderMonitor() {
    var started = monRows.length;
    var completed = monRows.filter(function (r) { return r.completed; }).length;
    var inProgress = monRows.filter(function (r) { return !r.completed && (Date.now() - (r.updatedAt || 0)) < AWAY_MS; }).length;
    var away = started - completed - inProgress;
    var nA = monRows.filter(function (r) { return r.sequence === 'A'; }).length;
    var nB = monRows.filter(function (r) { return r.sequence === 'B'; }).length;
    var skew = Math.abs(nA - nB);

    $('mon-counters').innerHTML = [
      ['Started', started, 'Participants who have claimed a code.'],
      ['In progress', inProgress, 'Not finished, and their record was written in the last 30 minutes.'],
      ['Completed', completed, 'They reached the end of the study.'],
      ['Away 30+ min', Math.max(0, away),
       'Not finished and nothing written for over 30 minutes. NOT a count of people who gave up: ' +
       'it is started − completed − in progress, and any of them can come back and carry on from ' +
       'exactly where they stopped, on this device or another one.'],
      ['Sequence A', nA, 'Assigned the AI-off block first.'],
      ['Sequence B', nB, 'Assigned the AI-on block first.']
    ].map(function (s) {
      return '<div class="stat-box" title="' + esc(s[2] || '') + '"><b>' + s[1] + '</b><span>' + esc(s[0]) + '</span></div>';
    }).join('') +
      (skew > 3 ? '<div class="stat-box" style="background:#fff7ed;"><b>' + skew + '</b><span>sequence gap — force the next entrants</span></div>' : '');

    $('mon-table').innerHTML = monRows.length
      ? '<thead><tr><th>Code</th><th>Sequence</th><th>Phase</th><th>Round</th><th>Active</th>' +
        '<th title="How many times they came back to the study after leaving it.">Resumptions</th>' +
        '<th title="Breaks between sittings: how many, and how long they were away in total. ' +
        'A gap counts as a break only when it is at least ' + Math.round(CFG.BREAK_MIN_MS / 60000) +
        ' minutes — a reload takes seconds.">Breaks</th>' +
        '<th>Viewport</th><th>Flags</th><th></th></tr></thead><tbody>' +
        monRows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).map(function (r) {
          var flags = [];
          if (r.viewport_width && current && current.ops && r.viewport_width < (current.ops.minViewport || 900)) flags.push('narrow');
          if ((r.resumptions || 0) > 0) flags.push('resumed');
          if (r.resumed_from === 'cloud') flags.push('another device');
          if (!r.completed && (Date.now() - (r.updatedAt || 0)) >= AWAY_MS) flags.push('away');
          if (r.completed) flags.push('done');
          return '<tr><td class="mono">' + esc(r.participant_code) + '</td><td>' + esc(r.sequence || '—') + '</td>' +
            '<td>' + esc(r.phase || '—') + '</td><td>' + (r.round_index || '—') + '</td>' +
            '<td>' + Math.round((r.active_ms || 0) / 60000) + ' min</td>' +
            '<td>' + (r.resumptions || 0) + '</td>' +
            '<td>' + ((r.breaks_count || 0) ? r.breaks_count + ' · ' + fmtDur(r.break_total_ms || 0) : '—') + '</td>' +
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
    // `why` is the rule behind the ⚠ — a warning that does not say what it is
    // warning about is just a mark on a screen. It is the row's tooltip, and it
    // is shown in the cell whenever the check has actually tripped.
    function add(label, value, warn, why) { rows.push({ label: label, value: value, warn: warn, why: why }); }

    // COMPLETED sessions only. A participant who stopped after five minutes is
    // not a fast one, and mixing them in drags the median toward whoever left;
    // this row exists to answer "is the study the length we designed", which is
    // a question about people who did the whole thing.
    var doneRows = monRows.filter(function (r) { return r.completed; });
    var actives = doneRows.map(function (r) { return (r.active_ms || 0) / 60000; }).filter(function (v) { return v > 0; });
    var medActive = med(actives);
    add('Median active time per COMPLETED participant',
      medActive == null ? (monRows.length ? '— no completed sessions yet' : '—')
        : fmt(medActive, 1) + ' min · ' + actives.length + ' session' + (actives.length === 1 ? '' : 's'),
      medActive != null && (medActive < 30 || medActive > 70),
      'Expected 30–70 minutes of active time for the whole study. Outside that band the task is running much ' +
      'faster or much slower than it was designed for. Unfinished sessions are excluded.');

    if (built) {
      var durs = built.rounds.map(function (r) { return (r.duration_ms || 0) / 1000; });
      var medRound = med(durs);
      add('Median time per round', medRound == null ? '—' : fmt(medRound, 1) + ' s', medRound != null && medRound < 20,
        'Under 20 seconds a round is being clicked through rather than played.');

      var q2 = built.participants.filter(function (p) { return p.quiz_qai_score_first_correct === false; }).length;
      var q2n = built.participants.filter(function (p) { return p.quiz_qai_score_first_correct != null; }).length;
      add('Comprehension failures on the scoring question', q2n ? pct(q2 / q2n) : '—', q2n && (q2 / q2n) > 0.10,
        'More than 10% getting the scoring question wrong first time means the instructions are not landing.');

      var q45 = built.participants.filter(function (p) {
        return p.quiz_qai_tell_first_correct === false || p.quiz_qai_outside_first_correct === false;
      }).length;
      add('Comprehension failures on the jaggedness / frontier questions', q2n ? pct(q45 / q2n) : '—', q2n && (q45 / q2n) > 0.40,
        'More than 40% missing these means the AI screens are not landing — and they carry the mechanism.');

      var caps = built.rounds.filter(function (r) { return r.cap_hit; }).length;
      add('Query or reveal cap hit', built.rounds.length ? pct(caps / built.rounds.length) : '—',
        built.rounds.length && (caps / built.rounds.length) > 0.03,
        'Over 3% of rounds hitting a cap means the caps are binding on behaviour, not just guarding against runaway clicking.');

      var seeded = built.rounds.filter(function (r) { return r.seed_shape !== 'OPEN' && r.scored; });
      var imm = seeded.filter(function (r) { return r.stopped_immediately; }).length;
      add('Immediate stop rate in seeded rounds', seeded.length ? pct(imm / seeded.length) : '—',
        seeded.length && (imm / seeded.length) > 0.60,
        'Over 60% stopping on the first screen means the pre-opened geometry is too generous to search from.');

      var slow = built.participants.filter(function (p) { return p.median_decision_ms != null && p.median_decision_ms < 500; }).length;
      add('Participants with a median decision under 500 ms', slow, slow > 0,
        'Half a second is not enough to read the plot: these participants are clicking, and the column disengaged flags them.');

      var blur = built.rounds.filter(function (r) { return (r.blur_total_ms || 0) > 120000; }).length;
      add('Rounds with a blur longer than two minutes', blur, blur > 0,
        'The window was left for over two minutes mid-round, so that round’s timings measure something else.');
    } else {
      add('Round timing, comprehension, caps, stops',
        'press ⟳ Refresh health checks — these read the event log', false,
        'These six checks are computed from the event log, which is far heavier than the participant records ' +
        'the counters above use, so it is never fetched on its own. Pressing Refresh health checks loads it.');
    }

    var narrow = monRows.filter(function (r) { return r.viewport_width && r.viewport_width < ((current && current.ops && current.ops.minViewport) || 900); }).length;
    add('Viewport below the minimum', narrow, narrow > 0,
      'That many participants are on a window narrower than ops.minViewport (' +
      ((current && current.ops && current.ops.minViewport) || 900) + 'px). The task is a picture, so a narrow ' +
      'window is a different stimulus; they are blocked until they widen it.');

    $('mon-health').innerHTML = '<tbody>' + rows.map(function (r) {
      return '<tr class="' + (r.warn ? 'warn' : '') + '" title="' + esc(r.why || '') + '">' +
        '<td>' + esc(r.label) + (r.warn ? ' <span title="' + esc(r.why || '') + '">⚠</span>' : '') + '</td>' +
        '<td>' + esc(String(r.value)) + (r.warn && r.why ? '<div class="why">' + esc(r.why) + '</div>' : '') + '</td></tr>';
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
    var prevOrder = function () { return ($('prev-order') && $('prev-order').value) || ''; };
    $('btn-preview').onclick = function () {
      var spec = $('prev-spec').value;
      window.open(previewUrl(current && current.code, spec, prevOrder()), '_blank');
    };
    $('btn-preview-full').onclick = function () {
      window.open(previewUrl(current && current.code, null, prevOrder()), '_blank');
    };
    $('btn-dryrun').onclick = dryRun;
    $('btn-dl-xlsx').onclick = downloadXlsx;
    $('btn-dl-decisions').onclick = function () { if (built) dl('decisions.csv', X.toCSV(built.decisions), 'text/csv'); };
    $('btn-dl-rounds').onclick = function () { if (built) dl('rounds.csv', X.toCSV(built.rounds), 'text/csv'); };
    $('btn-dl-participants').onclick = function () { if (built) dl('participants.csv', X.toCSV(built.participants), 'text/csv'); };
    $('btn-dl-raw').onclick = function () { if (built) dl('raw_events.json', JSON.stringify(built.raw, null, 1), 'application/json'); };
    $('btn-reset-participant').onclick = function () {
      if (!current) return alert('Open a session first.');
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
      if (!current) return alert('Open a session first.');
      if (!confirm('Close "' + (current.code || current.id) + '" permanently? No new participant can enter.')) return;
      setStatus(current, 'closed');
    };
    $('btn-rg-draw').onclick = function () { renderRoundGallery(true); };
    ['rg-truth', 'rg-ai', 'rg-anchors', 'rg-pre', 'rg-best', 'rg-scored'].forEach(function (id) {
      var el = $(id);
      if (el) el.onchange = function () { renderRoundGallery(); };
    });
  }

  // ======================================================================
  //  DESIGN NOTES
  // ======================================================================
  // The questions that get asked about this design, answered against the code
  // rather than the document — and every number on the screen measured from the
  // session's OWN frozen pool, so the page cannot drift from what will be played.
  function poolStatsFor(a) {
    var pool = a.pool, hi = a.params.env.prizeMax;
    var ceil = 0, uniq = 0, three = 0, n = pool.length;
    var decFirst = [0,0,0,0,0,0,0,0,0,0], decAll = [0,0,0,0,0,0,0,0,0,0], allN = 0;
    var sumFirst = 0, sumMid = 0;
    pool.forEach(function (m) {
      var mx = -Infinity, i;
      for (i = 0; i < m.length; i++) if (m[i] > mx) mx = m[i];
      if (mx >= hi) ceil++;
      var at = [];
      for (i = 0; i < m.length; i++) if (m[i] === mx) at.push(i + 1);
      if (at.length === 1) uniq++;
      if (at.length >= 3) three++;
      decFirst[Math.min(9, Math.floor((at[0] - 1) / 10))]++;
      sumFirst += at[0];
      var s = 0;
      at.forEach(function (pp) { decAll[Math.min(9, Math.floor((pp - 1) / 10))]++; allN++; s += pp; });
      sumMid += s / at.length;
    });
    return {
      n: n, ceilPct: 100 * ceil / n, uniqPct: 100 * uniq / n, threePct: 100 * three / n,
      decFirst: decFirst.map(function (d) { return 100 * d / n; }),
      decAll: decAll.map(function (d) { return 100 * d / allN; }),
      meanFirst: sumFirst / n, meanMid: sumMid / n
    };
  }

  // ======================================================================
  //  SCREEN 7 · WORDING
  // ======================================================================
  // Every participant-facing string, in the order a participant meets it,
  // shown WITH this session's numbers substituted — the panel's whole purpose
  // is that the words here are the words on the screen, so a default rendered
  // with the tokens still in it would defeat it. Editing writes into
  // `currentContent`, which Save session persists; content.js owns the
  // outline, the whitelist and the merge, so this screen only draws it.

  // The participant app's token substitution, over the parameters in the form.
  // Keep in step with `tokens()` in app.js.
  function wdTokens(text) {
    var p = currentParams || Specs.withDefaults(null);
    var K = (p.ai.sparseK === p.ai.denseK) ? p.ai.sparseK : (p.ai.sparseK + ' or ' + p.ai.denseK);
    return String(text == null ? '' : text)
      .replace(/\{J\}/g, p.env.positions)
      .replace(/\{L\}/g, p.env.stepBound)
      .replace(/\{stepBound\}/g, p.env.stepBound)
      .replace(/\{revealCost\}/g, p.costs.revealCost)
      .replace(/\{queryCost\}/g, p.costs.queryCost)
      .replace(/\{revealCap\}/g, p.costs.revealCap)
      .replace(/\{queryCap\}/g, p.costs.queryCap)
      .replace(/\{scored\}/g, p.rounds.scoredPerBlock)
      .replace(/\{warmup\}/g, p.rounds.warmupPerBlock)
      .replace(/\{K\}/g, K);
  }
  // `**bold**` is the only markup the participant screen renders, so it is the
  // only markup shown here. Everything else is escaped first, exactly as prose()
  // does it in app.js.
  function wdShow(text) {
    var t = String(text == null ? '' : text);
    // Four of the survey part headings carry no note by default. An empty box
    // reads as a rendering fault, so it says so instead.
    if (!t.trim()) return '<span class="wd-blank">nothing is shown here by default</span>';
    return esc(wdTokens(t)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  function wdEdited() { return Object.keys(Content.normalizeOverrides(currentContent)).length; }

  function renderWording() {
    var host = $('wording-body');
    if (!host) return;
    note('wd-target', editingId
      ? 'These words belong to session <b>' + esc((current && current.code) || editingId) + '</b> &mdash; ' +
        esc((current && current.name) || 'untitled') + '. <b>Save changes to ' +
        esc((current && current.code) || 'this session') + '</b> on the Parameters screen writes them.'
      : 'These words belong to the <b>new session</b> the Parameters screen is composing, and are saved when ' +
        'you create it. To edit an existing session&rsquo;s wording, open it from its card on the ' +
        '<b>Sessions</b> screen first.', false);
    var q = ($('wd-search') && $('wd-search').value || '').trim().toLowerCase();
    var onlyChanged = !!($('wd-changed') && $('wd-changed').checked);
    var groups = Content.outline(), html = [], shown = 0;

    groups.forEach(function (g) {
      var rows = [], gEdits = 0;
      g.fields.forEach(function (f) {
        var over = currentContent[f.key];
        var isEdited = typeof over === 'string' && over.trim() && over.trim() !== String(f.base).trim();
        var live = isEdited ? over : f.base;
        if (isEdited) gEdits++;
        if (onlyChanged && !isEdited) return;
        if (q && (String(live) + ' ' + f.label + ' ' + f.key).toLowerCase().indexOf(q) < 0) return;
        shown++;
        rows.push(
          '<div class="wd-field' + (isEdited ? ' edited' : '') + '" data-key="' + esc(f.key) + '">' +
            '<div class="wd-label"><span>' + esc(f.label) + '</span>' +
              '<span class="wd-key">' + esc(f.key) + '</span>' +
              '<button class="wd-revert" data-revert="' + esc(f.key) + '">Revert to default</button>' +
            '</div>' +
            '<div class="wd-shown">' + wdShow(live) + '</div>' +
            '<div class="wd-edit">' +
              '<textarea rows="' + (f.kind === 'prose' ? 4 : 2) + '" data-edit="' + esc(f.key) + '" ' +
                'maxlength="' + Content.MAX_LEN + '" ' +
                'placeholder="Leave blank to use the default wording">' + esc(isEdited ? over : '') + '</textarea>' +
            '</div>' +
          '</div>');
      });
      if (!rows.length) return;
      html.push(
        '<details class="wd-group"' + (q || onlyChanged ? ' open' : (g.id === 'consent' ? ' open' : '')) + '>' +
          '<summary>' + esc(g.title) +
            (gEdits ? '<span class="wd-badge">' + gEdits + ' changed</span>' : '') +
            '<span class="wd-when">' + esc(g.when) + '</span>' +
          '</summary>' + rows.join('') +
        '</details>');
    });

    host.innerHTML = html.length ? html.join('')
      : '<div class="wd-empty">Nothing matches that.</div>';

    var total = groups.reduce(function (n, g) { return n + g.fields.length; }, 0);
    var edits = wdEdited();
    $('wd-count').innerHTML = shown + ' of ' + total + ' shown · <b>' + edits + '</b> changed for this session';

    host.querySelectorAll('textarea[data-edit]').forEach(function (t) {
      t.addEventListener('input', function () {
        var k = t.dataset.edit, v = t.value;
        if (!v.trim()) delete currentContent[k]; else currentContent[k] = v;
        // Repaint only this row's rendered text, so the caret is never lost
        // mid-sentence by a re-render of the whole screen.
        var field = t.closest('.wd-field');
        var base = wdBaseOf(k);
        var isEdited = !!v.trim() && v.trim() !== String(base).trim();
        field.querySelector('.wd-shown').innerHTML = wdShow(isEdited ? v : base);
        field.classList.toggle('edited', isEdited);
        $('wd-count').innerHTML = $('wd-count').innerHTML.replace(/<b>\d+<\/b>/, '<b>' + wdEdited() + '</b>');
      });
    });
    host.querySelectorAll('button[data-revert]').forEach(function (b) {
      b.addEventListener('click', function () {
        delete currentContent[b.dataset.revert];
        renderWording();
        note('wd-note', 'Reverted to the default wording. Press <b>Save session</b> on the Parameters screen to keep it.');
      });
    });
  }

  var _wdBase = null;
  function wdBaseOf(key) {
    if (!_wdBase) {
      _wdBase = {};
      Content.outline().forEach(function (g) {
        g.fields.forEach(function (f) { _wdBase[f.key] = f.base; });
      });
    }
    return _wdBase[key];
  }

  function wireWording() {
    if ($('wd-search')) $('wd-search').addEventListener('input', renderWording);
    if ($('wd-changed')) $('wd-changed').addEventListener('change', renderWording);
    if ($('btn-wd-revert')) $('btn-wd-revert').onclick = function () {
      if (!wdEdited()) { note('wd-note', 'This session already uses the default wording everywhere.'); return; }
      if (!window.confirm('Put every word back to the study default for this session?')) return;
      currentContent = {};
      renderWording();
      note('wd-note', 'Every word is back to the study default. Press <b>Save session</b> on the Parameters screen to keep it.');
    };
  }

  var notesFor = null;
  function renderNotes(force) {
    var host = $('notes-body');
    if (!host) return;
    if (!current) {
      notesFor = null;
      host.innerHTML = '<div class="empty-card">Open a session on the Sessions screen and this fills in with its own numbers.</div>';
      return;
    }
    if (!force && notesFor === current.id) return;
    notesFor = current.id;

    var a;
    try { a = artifacts(current); } catch (e) {
      host.innerHTML = '<div class="admin-note bad">The specs for this session could not be built: ' +
        esc(String(e && e.message || e)) + '</div>';
      return;
    }
    var p = a.params, st = poolStatsFor(a), bench = benchmarkShares(p);
    var sigma = CFG.sigma(p.env.stepBound);
    var rounds = 2 * (p.rounds.warmupPerBlock + p.rounds.scoredPerBlock);
    var seeded = a.specs.filter(function (s) { return s.seed_shape !== 'OPEN'; }).length;
    var pct = function (x) { return x.toFixed(1) + '%'; };

    var shapes = CFG.SEED_SHAPES.map(function (sh) {
      var b = bench[sh], base = CFG.SEED_BASE[sh];
      var where = (b.ratio < 1) ? 'the frontier — outside everything known'
                : (b.ratio > 2) ? 'the widest interior gap'
                : 'either — this is the knife edge';
      return '<tr><td><b>' + esc(sh) + '</b></td><td class="mono">' + base.join(', ') + '</td>' +
        '<td>' + b.gap + '</td><td>' + b.tail + '</td><td><b>' + b.ratio.toFixed(2) + '</b></td>' +
        '<td>' + Math.round(b.frontierShare * 100) + '%</td><td>' + where + '</td></tr>';
    }).join('');

    var decRow = function (arr) {
      return arr.map(function (d, i) {
        return '<td title="positions ' + (i * 10 + 1) + '–' + ((i + 1) * 10) + '">' + d.toFixed(1) + '</td>';
      }).join('');
    };

    host.innerHTML =
      '<div class="card"><h3 style="margin-top:0;">Does the AI hold private data?</h3>' +
      '<p><b>Yes — and that is the whole mechanism.</b> In every round the AI is given <b>K positions whose true ' +
      'prize it knows exactly</b> (' + p.ai.sparseK + ' in a sparse round, ' + p.ai.denseK + ' in a dense one, placed ' +
      esc(p.ai.placement) + '), plus every pre-opened position and everything the participant has revealed so far. ' +
      'The participant is never told which positions those are, nor how many there are.</p>' +
      '<p>Asked about a position, it answers the truth <b>at</b> one of its known points, the straight-line ' +
      '<b>interpolation between the two nearest</b> known points inside them, and the nearest known value flat ' +
      '<b>beyond the outermost</b> one — it interpolates, it cannot extrapolate. The answer is rounded to an integer ' +
      'and returned after a latency identical to a reveal&rsquo;s, so neither the number&rsquo;s shape nor its timing ' +
      'says whether the position was one it knew. That is what makes trust fallible rather than merely noisy: the ' +
      'AI&rsquo;s number is never a prize, and it is confidently wrong in exactly the places it has no data.</p></div>' +

      '<div class="card"><h3 style="margin-top:0;">Why the two paid buttons look identical, and swap</h3>' +
      '<p>Which of <b>Ask the AI</b> and <b>Reveal</b> a participant presses IS the outcome this study measures, so ' +
      'the interface must not make either one easier to press. They are one button style at strict parity &mdash; ' +
      'same size, padding, radius, weight, border, shadow, and two hues matched on saturation and lightness &mdash; ' +
      'placed <b>side by side</b>, because vertical primacy is the strongest position bias and horizontal is weaker. ' +
      'Neither is styled as the primary action. <b>Stop and nominate</b> is a different class of action: it sits ' +
      'below a divider, never moves, and names the selected position so nomination cannot be accidental.</p>' +
      '<p>Order is assigned <b>once per participant</b> (' +
      (p.ui.buttonOrder === 'participant' ? 'randomised in this session' : '<b>fixed in this session</b>') +
      ') and block-randomised jointly with the crossover sequence, so all four cells of sequence &times; order fill ' +
      'evenly. It is <b>not</b> redrawn per round or per decision: a participant takes roughly 300 actions, and ' +
      'moving the buttons under them buys mis-clicks &mdash; a mis-click here spends the higher cost and destroys ' +
      'the ground truth at that position &mdash; and inflates decision latency with re-reading, when latency is ' +
      'itself one of the measures. The assignment is stamped on the participant and on every row they produce ' +
      '(<span class="mono">button_order</span>), so it enters the model as a covariate and the size of any position ' +
      'effect is reported rather than assumed away.</p>' +
      '<p>The cost numeral inside each button is red &mdash; and nothing else on the screen is &mdash; so red means ' +
      '&ldquo;this is what an action costs&rdquo;. The cheaper action takes a lighter tint of the <b>same hue</b> ' +
      '(' + esc(p.ui.costColorReveal) + ' and ' + esc(p.ui.costColorQuery) + ', both above 4.5:1 on their white ' +
      'chip). Those two values are run parameters, locked with the task: styling that touches a primary outcome is a ' +
      'treatment, not a theme. The Reveal cost is rendered identically in AI-off rounds, where it stands alone &mdash; ' +
      'styling the same action differently across the two conditions would confound the reveal-rate comparison with ' +
      'chrome. In an AI-off round the Ask button is <b>absent from the DOM</b>, not hidden.</p></div>' +

      '<div class="card"><h3 style="margin-top:0;">What is a &ldquo;seeded&rdquo; round, and what is the seed?</h3>' +
      '<p>A <b>pre-opened round</b> (the code calls it <span class="mono">seeded</span>) does not start blank: ' +
      'three or four positions are already open when it begins, with their true prizes showing. A <b>blank round</b> ' +
      '(<span class="mono">OPEN</span>) starts with the whole line unknown. This session runs <b>' + seeded + ' pre-opened ' +
      'and ' + (a.specs.length - seeded) + ' blank</b> rounds of ' + rounds + '.</p>' +
      '<p>They exist for identification. In a blank round the first move happens with no information, so everything ' +
      'afterwards depends on choices the participant made themselves and nothing can be cleanly attributed to the AI. ' +
      'In a pre-opened round <b>you assign the starting picture</b>: at the first decision the participant knows exactly ' +
      'the positions you chose and nothing else, so the geometry they face is an experimenter-assigned quantity and the ' +
      'first move is the primary analysis moment.</p>' +
      '<div class="admin-note"><b>The word &ldquo;seed&rdquo; means three unrelated things</b>, and mixing them up would ' +
      'break the design silently. In this build they are kept apart in the code and named apart wherever a label allows:' +
      '<br>· <b>pre-opened positions</b> — what the participant starts with (<span class="mono">pre_opened</span>, ' +
      '<span class="mono">seed_shape</span>, the acceptance filter&rsquo;s &ldquo;highest pre-opened value&rdquo;)' +
      '<br>· <b>the walk&rsquo;s start</b> — where the random walk is anchored before it is drawn outwards ' +
      '(Environment &rarr; &ldquo;walk start value&rdquo;). Nothing to do with what anyone sees.' +
      '<br>· <b>the RNG seed</b> — reproducibility (<span class="mono">generatorSeed</span>, ' +
      '<span class="mono">specSeed</span>, <span class="mono">shuffle_seed</span>).</div></div>' +

      '<div class="card"><h3 style="margin-top:0;">Gaps, tails, and why there are three layouts</h3>' +
      '<p>The pre-opened positions carve the line of ' + p.env.positions + ' into two kinds of unknown. A stretch ' +
      '<b>between</b> two known positions is a <b>gap</b>, pinned at both ends. A stretch <b>beyond the outermost</b> ' +
      'known position is a <b>tail</b> — the frontier — pinned on one side only.</p>' +
      '<p>Uncertainty behaves differently in each. In a gap of width <i>g</i> the walk is tied down at both ends, so ' +
      'the standard deviation peaks at the midpoint at <b>σ√g/2</b>. In a tail of length <i>t</i> nothing holds the far ' +
      'side, so it grows as <b>σ√t</b>. Setting them equal gives <b>g = 4t</b>: an interior gap only carries more ' +
      'uncertainty than the frontier when it is <b>more than four times as long</b>. Here σ = ' + sigma.toFixed(3) + '.</p>' +
      '<table class="data-table" style="width:auto;"><thead><tr><th>Layout</th><th>Pre-opened at</th><th>widest gap g</th>' +
      '<th>tail t</th><th>g / 4t</th><th>benchmark first move to the frontier</th><th>where a rational searcher looks first</th>' +
      '</tr></thead><tbody>' + shapes + '</tbody></table>' +
      '<p class="muted small" style="margin-top:10px;">These describe <b>where the value is</b>, not what the plots look ' +
      'like — the prize curve behind each round is a fresh draw either way.</p>' +
      '<p><b>Why you need all three.</b> The AI interpolates but cannot extrapolate, so its blind spot <i>is</i> the ' +
      'frontier. FRONTIER rounds put the value where the machine is useless, GAP rounds put it on the machine&rsquo;s home ' +
      'ground, and BALANCED sits on the knife edge where a small nudge flips the answer. Run only GAP rounds and an AI ' +
      'that pulls people away from the frontier would be undetectable, because the frontier was never worth visiting.</p></div>' +

      '<div class="card"><h3 style="margin-top:0;">Does the landscape change every round?</h3>' +
      '<p><b>Yes, and so does where the maximum is.</b> Each of the ' + rounds + ' round specs points at a <b>different</b> ' +
      'mapping from the frozen pool of ' + st.n + ' — the validation gate fails a session that repeats one — so the whole ' +
      'landscape is redrawn each round and the best position moves. It has to work this way: a fixed landscape would be ' +
      'learned after one round and the search task would evaporate.</p>' +
      '<p>Every participant sees the <b>same</b> ' + rounds + ' mappings, in an order shuffled within each block, and the ' +
      'sequence counterbalance decides which block carries the AI. So each mapping is played with and without the tool by ' +
      'equal halves of the sample: mapping difficulty is balanced across conditions by construction, not by luck.</p>' +
      '<div class="admin-note"><b>&ldquo;Brownian&rdquo; here runs across positions, not across time.</b> The path is drawn ' +
      'once, offline, and then sits still. Position 1…' + p.env.positions + ' is a spatial index, not a clock, and nothing ' +
      'evolves while the participant works — they are uncovering a static landscape, not tracking a moving one.</div></div>' +

      '<div class="card"><h3 style="margin-top:0;">Where the maximum lands, in this session&rsquo;s pool</h3>' +
      '<p class="muted small">Measured over all ' + st.n + ' mappings of this session, by decile of position.</p>' +
      '<table class="data-table" style="width:auto;"><thead><tr><th>positions</th><th>1–10</th><th>11–20</th><th>21–30</th>' +
      '<th>31–40</th><th>41–50</th><th>51–60</th><th>61–70</th><th>71–80</th><th>81–90</th><th>91–100</th><th>mean</th></tr></thead>' +
      '<tbody><tr><td>every maximising position</td>' + decRow(st.decAll) + '<td><b>' + st.meanMid.toFixed(1) + '</b></td></tr>' +
      '<tr><td>first maximising position only</td>' + decRow(st.decFirst) + '<td><b>' + st.meanFirst.toFixed(1) + '</b></td></tr>' +
      '</tbody></table>' +
      '<p style="margin-top:12px;"><b>The two rows differ, and the reason matters.</b> The walk reflects at the ceiling of ' +
      p.env.prizeMax + ', which produces <b>plateaus</b>: <b>' + pct(st.ceilPct) + '</b> of these mappings touch the ceiling, ' +
      'only <b>' + pct(st.uniqPct) + '</b> have their maximum at a single position, and <b>' + pct(st.threePct) + '</b> have it ' +
      'at three or more. Take &ldquo;the&rdquo; maximum as the first index and you inherit a leftward bias that is an artifact ' +
      'of the tie-break, not a property of the walk — which is exactly the gap between the two rows above.</p>' +
      '<p>So the export does not do that. <span class="mono">dist_best_to_argmax</span> measures the distance to the ' +
      '<b>nearest</b> maximising position, and <span class="mono">argmax_count</span> ships beside it so a plateau is ' +
      'visible in the data rather than hidden in it. <span class="mono">argmax_position</span> remains the first index, ' +
      'for continuity.</p>' +
      '<p class="muted small">The plateaus are inherited from the generator the source study used, so their data has the ' +
      'same property. If you would rather not have them, the clean fix is an acceptance-filter rule rejecting mappings ' +
      'whose maximum is attained at more than two positions; it would discard roughly a quarter of draws, which a pool ' +
      'of ' + st.n + ' can afford. That is a change to the task, so it belongs to a new session, never to this one.</p></div>';
  }

  // ======================================================================
  //  EVERY ROUND, DRAWN
  // ======================================================================
  // One plot per frozen spec: the ground-truth prize walk, the prizes that start
  // open, the AI's private anchors and the line it interpolates through them.
  //
  // ALL OF IT IS ADMIN-ONLY. The participant's plot draws none of these: the
  // truth and the AI's curve are debug overlays gated behind the preview key,
  // and the anchors are never sent to a live browser at all in server mode. This
  // grid exists so the person setting a session up can see the geometry their
  // parameters produced — which is exactly what the participant must NOT see.
  var rgFor = null;
  function rgOpts() {
    return {
      truth: !$('rg-truth') || $('rg-truth').checked,
      ai: !$('rg-ai') || $('rg-ai').checked,
      anchors: !$('rg-anchors') || $('rg-anchors').checked,
      pre: !$('rg-pre') || $('rg-pre').checked,
      best: !!($('rg-best') && $('rg-best').checked),
      scoredOnly: !!($('rg-scored') && $('rg-scored').checked)
    };
  }

  function renderRoundGallery(force) {
    var grid = $('rg-grid');
    if (!grid) return;
    if (!current) {
      rgFor = null;
      grid.innerHTML = '';
      note('rg-note', 'Open a session first — its rounds are drawn here.');
      return;
    }
    var o = rgOpts();
    var key = current.id + '|' + JSON.stringify(o);
    if (!force && key === rgFor) return;
    rgFor = key;

    var a;
    try { a = artifacts(current); } catch (e) {
      grid.innerHTML = '';
      note('rg-note', 'The specs for this session could not be built: ' + esc(String(e && e.message || e)), true);
      return;
    }
    var specs = a.specs.filter(function (s) { return o.scoredOnly ? s.scored : true; });
    var N = a.params.env.positions;

    note('rg-note', 'Showing <b>' + specs.length + '</b> of ' + a.specs.length + ' rounds, in the frozen order. ' +
      'Block 1 is played with the AI by sequence B and without it by sequence A; block 2 is the other way round. ' +
      '<b>None of these overlays is ever drawn for a participant.</b>');

    grid.innerHTML = specs.map(function (s) {
      return '<div class="rg-card" data-spec="' + esc(s.spec_id) + '">' +
        '<div class="rg-top"><span class="rg-id">' + esc(s.spec_id) + '</span>' +
          '<span class="rg-tags">block ' + s.block + ' · ' + (s.scored ? 'scored' : 'warm-up') + ' · ' +
          esc(s.seed_shape) + ' · ' + esc(s.ai_density) + ' K=' + s.ai_k + '</span></div>' +
        '<div class="rg-plot"></div>' +
        '<div class="rg-foot"></div></div>';
    }).join('');

    specs.forEach(function (s, i) {
      var card = grid.children[i];
      var truth = a.pool[s.mapping_index];
      if (!truth) return;
      var anchors = Ai.anchorSet(s.ai_anchors, s.pre_opened, [], truth);
      var curve = [];
      for (var p = 1; p <= N; p++) curve.push(Ai.aiAnswer(anchors, p, a.params.ai.answerRounding));
      var pre = (s.pre_opened || []).map(function (pp) { return { pos: pp, val: truth[pp - 1] }; });

      var best = 1;
      for (var q = 1; q < truth.length; q++) if (truth[q] > truth[best - 1]) best = q + 1;

      var ch = SVChart.create(card.querySelector('.rg-plot'), { positions: N });
      ch.render({
        showTruth: o.truth, truth: truth,
        showAiCurve: o.ai, aiCurve: curve,
        showAnchors: o.anchors, anchors: anchors.filter(function (x) {
          return (s.ai_anchors || []).indexOf(x.pos) >= 0;
        }),
        preOpened: o.pre ? pre : [],
        nominated: o.best ? { pos: best, val: truth[best - 1] } : null,
        tag: 'mapping #' + s.mapping_index
      });

      // What the AI knows is the UNION of its private anchors, the pre-opened
      // positions and everything the participant has revealed — that is how
      // Ai.anchorSet builds it, in this preview and in both backends alike, so
      // the dashed line above already bends through the pre-opened squares.
      // Reporting only the private K here (which this caption used to do) named
      // a smaller AI than the one the participant actually meets.
      var privN = (s.ai_anchors || []).length, startN = anchors.length;
      var shared = privN + pre.length - startN;   // a pre-opened position it already knew
      card.querySelector('.rg-foot').innerHTML =
        (pre.length
          ? 'Open at the start (the ' + pre.length + ' position' + (pre.length === 1 ? '' : 's') +
            ' the participant knows): ' +
            pre.map(function (x) { return 'p' + x.pos + ' = <b>' + x.val + '</b>'; }).join(' · ')
          : 'Nothing pre-opened — the participant starts from a blank line.') +
        '<br>Best prize <b>' + truth[best - 1] + '</b> at position ' + best +
        ' · the AI knows <b>' + startN + '</b> position' + (startN === 1 ? '' : 's') + ' exactly at the start' +
        (pre.length ? ' (' + privN + ' private + ' + pre.length + ' pre-opened' +
          (shared > 0 ? ', ' + shared + ' of them the same position' : '') + ')' : '') +
        ', and one more with every prize the participant reveals — up to ' +
        (startN + a.params.costs.revealCap) + ' of ' + N + '.';
    });
  }

  function fillSpecPicker() {
    var sel = $('prev-spec');
    if (!sel) return;
    if (!current) { sel.innerHTML = '<option value="">open a session first</option>'; return; }
    var a = artifacts(current);
    sel.innerHTML = a.specs.map(function (s) {
      return '<option value="' + esc(s.spec_id) + '">' + esc(s.spec_id) + ' · ' + esc(s.seed_shape) +
        ' · ' + esc(s.ai_density) + ' (K=' + s.ai_k + ')' + (s.scored ? '' : ' · warm-up') + '</option>';
    }).join('');
  }

  function runValidation() {
    if (!current) { $('validate-out').innerHTML = '<span class="muted">Open a session first.</span>'; return; }
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
      ['Dictionary', 'Every column of Decisions, Rounds and Participants, in one sentence each', 'Start here if a column name is not obvious'],
      ['Run', 'Every parameter this run was collected under, plus the frozen seeds and checksums', 'The configuration always travels with the data'],
      ['Specs', 'The 28 frozen round specs: mapping index, pre-opened positions, AI density and anchors', 'Identical for every participant of the run'],
      ['Decisions', 'One row per query, reveal or stop, with every derived field of §16.8', 'is_first_decision marks the primary analysis moment'],
      ['Rounds', 'One row per round, raw and derived', 'interrupted is a column, not a filter'],
      ['', 'dist_best_to_argmax is measured to the NEAREST maximising position', 'the walk reflects at the ceiling, so many mappings have a plateau — argmax_count says how wide'],
      ['Participants', 'One row per participant: timing, comprehension, survey, calibration gaps', 'disengaged is a column, not a filter'],
      ['Slider', 'The throttled slider trace: which positions were considered and rejected', 'At most one row per 250 ms, plus one on release'],
      ['Attention', 'Blur, focus, visibility, heartbeats, instruction opens, resizes', 'active_ms is summed from heartbeats'],
      ['Raw', 'The event log exactly as written', 'Everything else is regenerated from this'],
      [],
      ['How to read this workbook', '', ''],
      ['Tidy data', 'One row per observation, one column per variable, no merged cells and no blank spacer rows in the data sheets', 'read_csv / read_excel it directly'],
      ['Blanks', 'An empty cell means NOT APPLICABLE or not recorded — never zero', 'e.g. step_size on the first reveal of a round'],
      ['Booleans', 'TRUE / FALSE', 'the same in the workbook and in the CSVs'],
      ['Joining', 'participant_code + round_index joins Decisions to Rounds; participant_code joins either to Participants', 'spec_id joins any of them to Specs'],
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
    // `ui` is in the list because it is a TREATMENT group, not a theme: the
    // button order and the two cost colours are properties of the interface a
    // primary outcome was measured through, so they have to travel with the
    // data like every other parameter.
    ['env', 'costs', 'ai', 'ui', 'rounds', 'assign', 'filter', 'ops'].forEach(function (g) {
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

    // Every column of the three analysis sheets, described in one sentence, so a
    // reader can understand `verify_pays` or `ei_regret` without the source.
    // Generated from admin/dictionary.js, which selftest.js holds to covering
    // every column actually emitted.
    var dict = [['Sheet', 'Column', 'Type', 'What it means']];
    [['Decisions', b.decisions], ['Rounds', b.rounds], ['Participants', b.participants]].forEach(function (pair) {
      dict.push([pair[0], '— ' + Dict.oneRowIs(pair[0]) + ' —', '', '']);
      Dict.rowsFor(pair[0], X.columnsOf(pair[1])).forEach(function (r) { dict.push(r); });
    });

    var sheets = [
      { name: 'ReadMe', cols: [{ w: 26 }, { w: 62 }, { w: 46 }], rows: readme, filter: false },
      { name: 'Dictionary', cols: [{ w: 14 }, { w: 30 }, { w: 11 }, { w: 96 }], rows: dict },
      { name: 'Run', cols: [{ w: 14 }, { w: 26 }, { w: 60 }], rows: runRows },
      { name: 'Specs', cols: [{ w: 10 }, { w: 8 }, { w: 8 }, { w: 14 }, { w: 12 }, { w: 18 }, { w: 12 }, { w: 7 }, { w: 30 }], rows: specRows },
      X.toSheet('Decisions', b.decisions),
      X.toSheet('Rounds', b.rounds),
      X.toSheet('Participants', b.participants),
      { name: 'Slider', cols: [{ w: 16 }, { w: 12 }, { w: 10 }, { w: 10 }, { w: 20 }, { w: 24 }], rows: slider },
      { name: 'Attention', cols: [{ w: 16 }, { w: 12 }, { w: 18 }, { w: 40 }, { w: 24 }], rows: attention },
      X.toSheet('Raw', b.raw)
    ];
    // The browser tests read the workbook's SHAPE from here rather than by
    // unzipping a download: what sheets it has, in what order, and how big.
    try { window.SVExportTestHook = sheets; } catch (e) {}
    return sheets;
  }

  // ---- dry run (§17b Screen 6) --------------------------------------------
  // The bot itself lives in export.js, so the panel and tools/selftest.js drive
  // exactly the same scripted session.
  function dryRun() {
    if (!current) { $('dryrun-out').innerHTML = '<span class="muted">Open a session first.</span>'; return; }
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
