/* ==========================================================================
   search-v2  ·  app.js
   State machine: consent -> instructions -> quiz -> practice -> 10 rounds ->
   finish. Owns per-round truth (in this closure only), logging context, and
   localStorage persistence/resume. Arm A never injects any assistant DOM/text.
   ========================================================================== */
(function () {
  'use strict';
  var CFG = window.CONFIG, L = window.Logger, A = null; // A set once assistant.js loads (Arm B)
  var N_POS = CFG.N_POSITIONS, N_TASKS = CFG.N_TASKS, COST = CFG.REVEAL_COST;
  var KEY = CFG.OBFUSCATION_KEY;

  // ---- closure-only per-round secrets (NEVER on window/DOM) ----------------
  var truth = null;   // decoded value array for the current round
  var dots = null;    // decoded assistant dots for the current round

  // ---- runtime -------------------------------------------------------------
  var POOL = null;    // { byId, richIds, poorIds }
  var PRACTICE = null;
  var COVERAGE = null;
  var chart = null;
  var S = null;       // persisted session state
  var arm = 'A';
  var DEBUG = false;
  var lastSelectLogT = 0;
  var STUDY_CLOSED = false;    // set from the admin-controlled config/study doc
  var STUDY_ARM_MODE = 'url';  // 'url' | 'A' | 'B' | 'random' (admin-controlled)
  var STUDY_CFG = null;        // raw settings (config/study or a session's settings)
  var SESSION_CODE = null;     // admin "session" (wave) code from ?code= (stamped on data)
  var SESSION_NAME = null;     // its human name
  var CONTENT = {};            // admin content overrides { consent, instructions, instructionsB, finish, closed }
  var PREVIEW = false;         // admin preview: skip intro, don't write to Firestore

  // Built-in default participant-facing copy (used when the admin hasn't overridden it).
  var BUILTIN = {
    consent:
      "**What this is.** This is a short decision-making study. You will play a simple game in which you search a hidden line of positions for the highest value. The whole study takes about **15 minutes**.\n\n" +
      "**Payment.** You receive the base payment for participating. In addition, two rounds of the game are chosen at random at the end and paid to you as a **bonus**, based on how well you did in those rounds.\n\n" +
      "**Anonymity.** We record only your choices in the game (which positions you reveal, when you stop, and your answers to a few questions). We do not collect any personally identifying information beyond the anonymous IDs your recruitment platform provides. Your data are used only for research.\n\n" +
      "**Voluntary.** Participation is voluntary and you may stop at any time by closing the window.",
    instructions:
      "In each round you will see 100 positions on a line. Each position hides a value between 0 and 100 cents.\n\n" +
      "Values at adjacent positions differ by at most 10 cents. So positions two apart differ by at most 20 cents, and so on.\n\n" +
      "You can reveal the value at any position. Each reveal costs 5 cents. You can stop whenever you want.\n\n" +
      "Your earnings for the round are the highest value you revealed, minus 5 cents for each reveal. If you reveal nothing, you earn 0 for the round.\n\n" +
      "After each round the values reset and will be different. There is 1 practice round and 10 real rounds. Two of the 10 real rounds will be picked at random and paid to you as a bonus.",
    instructionsB:
      "You also have a free assistant.\n\n" +
      "The assistant was trained on data about some positions between 30 and 70. You cannot see its data. If you ask about a position between 30 and 70, it gives you its best estimate: a straight line between its two nearest data points. Its estimates are usually close, but they are not guaranteed.\n\n" +
      "If you ask about any position outside 30 to 70, the assistant has no data and will tell you so.\n\n" +
      "Asking the assistant is free and unlimited. The assistant does not learn from your reveals in this study.",
    finish: "",
    closed: ""
  };

  // ---- tiny seeded PRNG + string hash (session-deterministic) --------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return h >>> 0;
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  // ---- obfuscation decode --------------------------------------------------
  function decodeInts(b64) {
    var bin = atob(b64), out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) ^ KEY;
    return out;
  }
  function decodePairs(b64) {
    var flat = decodeInts(b64), pairs = [];
    for (var i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
    return pairs;
  }

  // ---- URL params ----------------------------------------------------------
  function params() {
    var p = {}, q = location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < q.length; i++) { if (!q[i]) continue; var kv = q[i].split('='); p[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); }
    return p;
  }

  // ---- screen helper -------------------------------------------------------
  function show(id) {
    var scr = document.querySelectorAll('.screen');
    for (var i = 0; i < scr.length; i++) scr[i].classList.toggle('active', scr[i].id === id);
    window.scrollTo(0, 0);
  }
  function $(id) { return document.getElementById(id); }

  // ---- state persistence ---------------------------------------------------
  function stateKey() { return 'searchv2:state:' + S.session; }
  function save() { try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch (e) {} }

  // ======================================================================
  //  BOOT
  // ======================================================================
  // The participant's entry code (their session id), persisted for resume. This
  // is distinct from SESSION_CODE (the admin "wave" code from ?code=).
  var ENTRY_KEY = 'searchv2:entrycode';

  function boot() {
    var pr = params();
    DEBUG = (pr.debug === '1' && pr.key === CFG.DEBUG_KEY);
    // Admin preview: skip the intro and never write to Firestore. Gated on the
    // debug key so real participants can never bypass consent.
    PREVIEW = (pr.preview === '1' && DEBUG);
    // Debug-only: override the logging endpoint from the URL (for local testing).
    if (DEBUG && pr.endpoint) CFG.ENDPOINT_URL = pr.endpoint;
    SESSION_CODE = pr.code || null; // admin "session" (wave) code from the launch link

    // Admin preview uses a throwaway id (never resumes/pollutes a real session)
    // and bypasses the code gate — the admin is testing.
    if (PREVIEW) { startSession(pr, 'preview-' + (pr.code || 'x')); return; }

    // A session code is REQUIRED to play. It comes from the study link's
    // SESSION_ID (Prolific fills this in automatically) or from a code the
    // participant entered here earlier (persisted). We NEVER invent one — an
    // empty landing shows the code gate and cannot start the game. Debug uses a
    // fixed code so local testing needs no gate.
    var code = ((pr.SESSION_ID || '').trim()) || ((localStorage.getItem(ENTRY_KEY) || '').trim());
    if (!code && DEBUG) code = 'debug';
    if (!code) { showCodeGate(pr); return; }

    startSession(pr, code);
  }

  // Gate: ask for a session code and refuse to start without one. This is the
  // only path when a participant arrives with no code in the URL and none saved.
  function showCodeGate(pr) {
    var input = $('code-input'), btn = $('btn-code'), fb = $('code-feedback');
    function sync() { btn.disabled = !input.value.trim(); if (input.value.trim()) fb.style.display = 'none'; }
    function submit() {
      var code = input.value.trim();
      if (!code) { fb.style.display = 'block'; return; }
      startSession(pr, code);
    }
    input.value = '';
    input.addEventListener('input', sync);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    btn.addEventListener('click', submit);
    sync();
    show('s-code');
    try { input.focus(); } catch (e) {}
  }

  // Start (or resume) the session identified by `session` (the entry code, or a
  // throwaway id in preview). Reached only once a code exists (URL, storage, or
  // the gate) — or immediately in preview.
  function startSession(pr, session) {
    // Persist the entry code so a refresh resumes the same session (not in
    // preview, whose id is a throwaway).
    if (!PREVIEW) { try { localStorage.setItem(ENTRY_KEY, session); } catch (e) {} }

    // load or init state (preview always starts fresh)
    var saved = null;
    if (!PREVIEW) { try { saved = JSON.parse(localStorage.getItem('searchv2:state:' + session)); } catch (e) {} }
    S = saved || {};
    S.version = CFG.APP_VERSION;
    S.session = session;
    S.pid = pr.PROLIFIC_PID || S.pid || null;
    S.study = pr.STUDY_ID || S.study || null;

    // Reveal the log-out control now that we are in a session (wired directly so
    // it works even if the study data never loads). Not in preview (throwaway).
    if (!PREVIEW) { var lo = $('btn-logout'); if (lo) { lo.style.display = ''; lo.onclick = logout; } }

    // If Firebase is configured, load the admin settings first: a specific
    // session (wave) when ?code= is present, otherwise the legacy config/study.
    if (window.SVFirebase && SVFirebase.isConfigured()) {
      var loader = SESSION_CODE
        ? SVFirebase.getSessionByCode(SESSION_CODE).then(applyWave)
        : SVFirebase.getStudyConfig().then(applyStudyConfig);
      loader.then(function () { finishBoot(pr); });
    } else {
      finishBoot(pr);
    }
  }

  // Log out: erase every trace of this study on this device (state, event log,
  // sync markers, saved entry code, legacy ids) and drop the URL params (incl.
  // SESSION_ID) so the reload lands cleanly on the code gate.
  function logout() {
    if (!confirm('Log out and clear this study on this device? Your progress on this device will be erased.')) return;
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('searchv2:') === 0) kill.push(k);
      }
      for (var j = 0; j < kill.length; j++) localStorage.removeItem(kill[j]);
    } catch (e) {}
    location.href = location.pathname;
  }

  // Apply a config/study doc (legacy single-study mode).
  function applyStudyConfig(scfg) {
    STUDY_CFG = scfg || null;
    if (!scfg) return;
    if (scfg.endpointUrl && !CFG.ENDPOINT_URL) CFG.ENDPOINT_URL = scfg.endpointUrl;
    if (scfg.armMode) STUDY_ARM_MODE = scfg.armMode;
    if (scfg.content) CONTENT = scfg.content;
    STUDY_CLOSED = (scfg.studyOpen === false);
  }

  // Apply a specific admin-created session (wave). A missing/unreachable session
  // does NOT block the participant (never strand a paid subject on a network blip);
  // a session explicitly marked completed does close.
  function applyWave(sess) {
    if (!sess) return; // bad code or transient error → proceed with built-in defaults
    SESSION_NAME = sess.name || null;
    if (sess.code) SESSION_CODE = sess.code;
    if (sess.status === 'completed') STUDY_CLOSED = true;
    var s = sess.settings || {};
    STUDY_CFG = s;
    if (s.endpointUrl && !CFG.ENDPOINT_URL) CFG.ENDPOINT_URL = s.endpointUrl;
    if (s.armMode) STUDY_ARM_MODE = s.armMode;
    if (s.content) CONTENT = s.content;
  }

  function finishBoot(pr) {
    // Arm assignment. A persisted arm wins (never flip a subject mid-study).
    // Otherwise the admin arm mode decides: force A/B, force random, or (default
    // 'url') honour ?arm= and fall back to random.
    if (S.arm !== 'A' && S.arm !== 'B') {
      if (STUDY_ARM_MODE === 'A' || STUDY_ARM_MODE === 'B') S.arm = STUDY_ARM_MODE;
      else if (STUDY_ARM_MODE === 'random') S.arm = (Math.random() < 0.5 ? 'A' : 'B');
      else if (pr.arm === 'A' || pr.arm === 'B') S.arm = pr.arm;
      else S.arm = (Math.random() < 0.5 ? 'A' : 'B');
    }
    arm = S.arm;
    save(); // lock in arm + ids before any async work

    // completion code: arm-specific (each arm is its own Prolific study) else shared
    if (STUDY_CFG) {
      var code = (arm === 'A' && STUDY_CFG.completionCodeA) || (arm === 'B' && STUDY_CFG.completionCodeB) || STUDY_CFG.completionCode;
      if (code) CFG.COMPLETION_CODE = code;
    }

    if (DEBUG) { $('nav-arm').textContent = (PREVIEW ? 'PREVIEW · ' : '') + 'Arm ' + arm + (SESSION_CODE ? ' · ' + SESSION_CODE : ''); $('btn-restart').style.display = ''; }

    // Study closed: only turn away subjects who have not started (in-progress and
    // finished subjects are always let through so they can finish / see the code).
    // Preview always proceeds (the admin is testing).
    if (STUDY_CLOSED && !PREVIEW && !S.completed && (!S.phase || S.phase === 'consent')) { renderClosed(); show('s-closed'); return; }

    // logger base fields (stamp the admin session code/name on every event)
    L.init({
      session: S.session, sessionCode: SESSION_CODE, sessionName: SESSION_NAME,
      pid: S.pid, study: S.study, arm: arm,
      ua: navigator.userAgent, vw: window.innerWidth, vh: window.innerHeight,
      appVersion: CFG.APP_VERSION
    });
    if (!PREVIEW) startFirebaseSync(); // preview never writes to Firestore

    loadAssistantIfNeeded(function () {
      fetch('data/mappings.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(onPool)
        .catch(function () { $('s-loading').innerHTML = '<p class="center" style="margin-top:40px;color:#a12a2a;">Could not load the study data. Please refresh.</p>'; });
    });
  }

  // Mirror every logged event into Firestore (when configured), idempotently by
  // sequence so resumes/retries overwrite rather than duplicate. A backlog replay
  // after anonymous sign-in covers events logged before auth completed.
  function startFirebaseSync() {
    if (!(window.SVFirebase && SVFirebase.isConfigured())) return;
    var key = 'searchv2:fbsynced:' + S.session;
    function mark(seq) { try { var cur = parseInt(localStorage.getItem(key) || '-1', 10); if (seq > cur) localStorage.setItem(key, String(seq)); } catch (e) {} }
    L.onEvent(function (ev, seq) { SVFirebase.writeEvent(ev, seq).then(function (ok) { if (ok) mark(seq); }); });
    SVFirebase.signInAnon().then(function () {
      var synced = parseInt(localStorage.getItem(key) || '-1', 10);
      var evs = L.getEvents();
      for (var i = synced + 1; i < evs.length; i++) {
        (function (idx) { SVFirebase.writeEvent(evs[idx], idx).then(function (ok) { if (ok) mark(idx); }); })(i);
      }
    }).catch(function () {});
  }

  // Arm B loads assistant.js at runtime; Arm A never references it (isolation).
  function loadAssistantIfNeeded(cb) {
    if (arm !== 'B') { cb(); return; }
    if (window.Assistant) { A = window.Assistant; cb(); return; }
    var s = document.createElement('script');
    s.src = 'assistant.js';
    s.onload = function () { A = window.Assistant; cb(); };
    s.onerror = function () { cb(); }; // degrade gracefully; askAssistant guards on A
    document.head.appendChild(s);
  }

  function onPool(data) {
    COVERAGE = data.coverage;
    PRACTICE = data.practice;
    var byId = {}, richIds = [], poorIds = [];
    for (var i = 0; i < data.mappings.length; i++) {
      var m = data.mappings[i]; byId[m.id] = m;
      if (m.stratum === 'RICH') richIds.push(m.id); else poorIds.push(m.id);
    }
    POOL = { byId: byId, richIds: richIds, poorIds: poorIds };

    // seeded per-subject task order (5 RICH + 5 POOR, shuffled)
    if (!S.taskOrder) {
      var rng = mulberry32(hashSeed(S.session + ':tasks'));
      var r = shuffle(richIds.slice(), rng).slice(0, CFG.SAMPLE_RICH);
      var p = shuffle(poorIds.slice(), rng).slice(0, CFG.SAMPLE_POOR);
      S.taskOrder = shuffle(r.concat(p), rng);
    }

    // session_start (once)
    if (!S.sessionStarted) {
      L.log('session_start', { info: 'taskOrder=' + S.taskOrder.join(',') });
      S.sessionStarted = true;
    }
    save();

    chart = window.Chart.create($('plot'), { onSelect: onChartSelect });
    wireGlobalHandlers();
    route();
  }

  // resume to the right screen
  function route() {
    if (S.completed) { renderFinish(); show('s-finish'); return; }
    // Preview (admin testing): skip consent/instructions/quiz, drop into practice.
    if (PREVIEW && (!S.phase || S.phase === 'consent' || S.phase === 'instructions' || S.phase === 'quiz')) {
      startRound(0, false); return;
    }
    switch (S.phase) {
      case 'instructions': showInstructions(); break;
      case 'quiz': showQuiz(); break;
      case 'round':
        // A finished-but-not-advanced round resumes its result screen, not the round.
        if (S.round && S.round.ended) { S.phase = 'interstitial'; save(); showInterstitial(); }
        else startRound(S.roundNum, true);
        break;
      case 'interstitial': showInterstitial(); break;
      case 'finish': finish(); break;
      default: showConsent();
    }
  }

  // ======================================================================
  //  CONSENT
  // ======================================================================
  // Render admin-editable prose: escape HTML, blank line => paragraph, **bold**.
  function renderProse(text) {
    return String(text || '').split(/\n\s*\n/).map(function (para) {
      var safe = esc(para.trim()).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
      return safe ? '<p>' + safe + '</p>' : '';
    }).join('');
  }
  function content(key) { return (CONTENT && CONTENT[key]) ? CONTENT[key] : BUILTIN[key]; }

  function showConsent() {
    S.phase = 'consent'; save();
    $('consent-body').innerHTML = renderProse(content('consent'));
    show('s-consent');
    $('consent-box').checked = false;
    $('btn-consent').disabled = true;
  }

  function renderClosed() {
    if (CONTENT && CONTENT.closed) $('closed-body').innerHTML = renderProse(CONTENT.closed);
  }

  // ======================================================================
  //  INSTRUCTIONS  (admin-editable; built-in default is the verbatim study text)
  // ======================================================================
  function instructionsHTML() {
    var h = '<blockquote>' + renderProse(content('instructions'));
    if (arm === 'B') h += '<hr>' + renderProse(content('instructionsB'));
    h += '</blockquote>';
    return h;
  }
  function showInstructions() {
    S.phase = 'instructions'; save();
    $('instructions-body').innerHTML = instructionsHTML();
    show('s-instructions');
  }

  // ======================================================================
  //  QUIZ  (verbatim; all correct to pass; randomized option order)
  // ----------------------------------------------------------------------
  //  QUICK-TEST ANSWER KEY  (the "Quick check" screen — get all right to play)
  //    Q1  "highest possible value at position 52"      -> 60
  //    Q2  "what do you earn" (reveals 30 & 62)         -> 52
  //    Q3  (Arm B) "ask the assistant about position 90"-> It says it has no data there
  //    Q4  (Arm B) "the assistant's answer at 50 is"    -> An estimate that can be wrong
  //  To breeze through while testing, open the app in debug mode and these are
  //  PRE-SELECTED for you (just click Submit):
  //    https://www.stouras.com/lab/search-v2/?arm=B&debug=1&key=stouras
  //  (debug also overlays the true landscape + assistant dots + stratum/id.)
  // ======================================================================
  var Q_COMMON = [
    { id: 'q1', prompt: 'Position 50 shows 40 cents. What is the highest possible value at position 52?',
      options: [{ t: '50' }, { t: '60', correct: true }, { t: '100' }, { t: '40' }] },
    { id: 'q2', prompt: 'You revealed two positions this round. The values were 30 cents and 62 cents. You stop now. What do you earn for this round?',
      options: [{ t: '62' }, { t: '52', correct: true }, { t: '92' }, { t: '30' }] }
  ];
  var Q_B = [
    { id: 'q3', prompt: 'You ask the assistant about position 90. What happens?',
      options: [{ t: 'It tells you the exact value' }, { t: 'It gives you an estimate' }, { t: 'It says it has no data there', correct: true }, { t: 'It reveals the position for free' }] },
    { id: 'q4', prompt: 'The assistant\'s answer at position 50 is:',
      options: [{ t: 'Always exactly correct' }, { t: 'An estimate that can be wrong', correct: true }] }
  ];
  function quizQuestions() { return arm === 'B' ? Q_COMMON.concat(Q_B) : Q_COMMON; }

  function showQuiz() {
    S.phase = 'quiz'; save();
    var qs = quizQuestions(), html = '';
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var opts = shuffle(q.options.slice(), Math.random); // display-order only
      html += '<div class="quiz-q"><div class="q-prompt">' + (i + 1) + '. ' + esc(q.prompt) + '</div>';
      for (var k = 0; k < opts.length; k++) {
        html += '<label class="quiz-opt"><input type="radio" name="' + q.id + '" value="' + esc(opts[k].t) + '"><span>' + esc(opts[k].t) + '</span></label>';
      }
      html += '</div>';
    }
    $('quiz-body').innerHTML = html;
    $('quiz-feedback').style.display = 'none';
    // Debug/testing only: pre-select the correct answers and show a hint, so a
    // tester can click Submit and get into the game immediately. Gated on the
    // debug key, so real subjects never see this.
    if (DEBUG) {
      for (var qi = 0; qi < qs.length; qi++) {
        var correct = qs[qi].options.filter(function (o) { return o.correct; })[0].t;
        var inputs = document.getElementsByName(qs[qi].id);
        for (var j = 0; j < inputs.length; j++) if (inputs[j].value === correct) inputs[j].checked = true;
      }
      var hint = document.createElement('div');
      hint.className = 'note';
      hint.style.marginTop = '10px';
      hint.textContent = 'Debug: correct answers are pre-selected — just click Submit. (Answers: Q1=60, Q2=52' + (arm === 'B' ? ', Q3=has no data there, Q4=an estimate that can be wrong' : '') + '.)';
      $('quiz-body').appendChild(hint);
    }
    show('s-quiz');
  }

  function submitQuiz() {
    var qs = quizQuestions(), allCorrect = true;
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var sel = document.querySelector('input[name="' + q.id + '"]:checked');
      var choice = sel ? sel.value : null;
      var correctOpt = q.options.filter(function (o) { return o.correct; })[0].t;
      var ok = (choice === correctOpt);
      if (!ok) allCorrect = false;
      L.log('quiz_attempt', { qid: q.id, choice: choice, correct: ok });
    }
    if (allCorrect) {
      S.quizPassed = true; save();
      startRound(0, false); // practice
    } else {
      $('quiz-feedback').style.display = 'block';
      showQuiz(); // reshuffle + clear selections for a fresh retry
      $('quiz-feedback').style.display = 'block';
    }
  }

  // ======================================================================
  //  ROUND
  // ======================================================================
  function bestOf(reveals) { var b = null; for (var i = 0; i < reveals.length; i++) if (b === null || reveals[i].val > b) b = reveals[i].val; return b; }
  function costOf(reveals) { return reveals.length * COST; }
  function netOf(reveals) { var b = bestOf(reveals); return reveals.length ? b - costOf(reveals) : 0; }
  function isRevealed(pos) { for (var i = 0; i < S.round.reveals.length; i++) if (S.round.reveals[i].pos === pos) return true; return false; }

  function pushContext() {
    L.setContext({
      round: S.roundNum, mapping: S.round.mappingId, stratum: S.round.stratum,
      reveals: S.round.reveals.length, cost: costOf(S.round.reveals),
      best: bestOf(S.round.reveals), net: netOf(S.round.reveals)
    });
  }

  function startRound(roundNum, resume) {
    S.roundNum = roundNum; S.phase = 'round';
    var mapId = roundNum === 0 ? PRACTICE.id : S.taskOrder[roundNum - 1];
    var rec = roundNum === 0 ? PRACTICE : POOL.byId[mapId];
    truth = decodeInts(rec.v);
    dots = decodePairs(rec.dots);
    if (!resume || !S.round || S.round.mappingId !== mapId) {
      S.round = { mappingId: mapId, stratum: roundNum === 0 ? 'practice' : rec.stratum,
        reveals: [], estimates: [], queries: [], warned: false, selected: 50 };
    }
    if (!S.roundStartedLogged) S.roundStartedLogged = {};
    pushContext();
    if (!S.roundStartedLogged[roundNum]) { L.log('round_start'); S.roundStartedLogged[roundNum] = true; }
    save();

    // build arm-specific chrome
    $('round-grid').classList.toggle('arm-b', arm === 'B');
    buildLegend();
    buildAuxPanel();
    if (DEBUG) $('nav-arm').textContent = 'Arm ' + arm + ' · ' + mapId + ' · ' + S.round.stratum;

    show('s-round');
    renderRound();
  }

  function buildLegend() {
    var h = '<span class="lg"><span class="swatch dot"></span> revealed value</span>';
    if (arm === 'B') {
      h += '<span class="lg"><span class="swatch diamond"></span> assistant estimate (not guaranteed)</span>';
      h += '<span class="lg"><span class="swatch band"></span> assistant coverage (30–70)</span>';
    }
    $('legend').innerHTML = h;
  }

  function buildAuxPanel() {
    var aux = $('aux-panel');
    if (arm !== 'B') { aux.innerHTML = ''; return; } // Arm A: no assistant DOM at all
    if (aux.getAttribute('data-built') === '1') { renderAiLog(); return; }
    aux.innerHTML =
      '<h3>Assistant</h3>' +
      '<p class="small muted">Free and unlimited. It has data only for positions 30–70.</p>' +
      '<div class="ask-row"><span class="small">Position</span>' +
      '<input type="number" id="ai-pos" min="1" max="100" value="' + S.round.selected + '">' +
      '<button class="btn btn-blue btn-sm" id="btn-ask">Ask assistant (free)</button></div>' +
      '<div class="ai-log" id="ai-log"></div>';
    aux.setAttribute('data-built', '1');
    $('btn-ask').addEventListener('click', askAssistant);
    $('ai-pos').addEventListener('keydown', function (e) { if (e.key === 'Enter') askAssistant(); });
    renderAiLog();
  }

  function renderRound() {
    $('round-label').textContent = S.roundNum === 0 ? 'Practice (not paid)' : 'Round ' + S.roundNum + ' of ' + N_TASKS;
    var reveals = S.round.reveals;
    $('c-reveals').textContent = reveals.length;
    $('c-cost').innerHTML = costOf(reveals) + '&cent;';
    $('c-best').innerHTML = reveals.length ? bestOf(reveals) + '&cent;' : '&mdash;';
    $('c-net').innerHTML = netOf(reveals) + '&cent;';
    $('warn-negative').style.display = S.round.warned ? 'block' : 'none';

    $('pos-input').value = S.round.selected;
    var revealed = isRevealed(S.round.selected);
    var rb = $('btn-reveal');
    rb.disabled = revealed;
    rb.innerHTML = revealed ? 'Already revealed' : 'Reveal (costs 5&cent;)';

    if (arm === 'B' && $('ai-pos')) $('ai-pos').value = S.round.selected;

    chart.render({
      arm: arm, coverage: COVERAGE, selected: S.round.selected,
      revealed: reveals.map(function (r) { return { pos: r.pos, val: r.val }; }),
      estimates: arm === 'B' ? S.round.estimates.map(function (e) { return { pos: e.pos, val: e.val }; }) : [],
      debug: DEBUG ? { truth: truth, dots: dots, stratum: S.round.stratum, id: S.round.mappingId } : null
    });
  }

  function selectPos(pos) {
    pos = Math.max(1, Math.min(N_POS, pos | 0));
    S.round.selected = pos;
    var now = Date.now();
    if (now - lastSelectLogT >= 1000) { L.log('select', { position: pos }); lastSelectLogT = now; }
    save();
    renderRound();
  }
  function onChartSelect(pos) { selectPos(pos); }

  function doReveal() {
    var pos = S.round.selected;
    if (isRevealed(pos)) return;
    var val = truth[pos - 1];
    S.round.reveals.push({ pos: pos, val: val });
    pushContext();
    L.log('reveal', { position: pos, value: val });
    // one-time gentle warning when net first drops to <= 0
    if (!S.round.warned && netOf(S.round.reveals) <= 0) {
      S.round.warned = true;
      L.log('warn_negative');
    }
    save();
    renderRound();
  }

  // ---- assistant (Arm B) ---------------------------------------------------
  function askAssistant() {
    if (!A) return;
    var input = $('ai-pos');
    var x = parseInt(input.value, 10);
    if (isNaN(x)) return;
    x = Math.max(1, Math.min(N_POS, x));
    var res = A.estimate(dots, x);
    S.round.queries.push({ position: res.position, estimate: res.estimate, refused: res.refused, text: res.text });
    if (!res.refused) {
      // one live diamond per position (repeat asks refresh, don't stack)
      var found = false;
      for (var i = 0; i < S.round.estimates.length; i++) if (S.round.estimates[i].pos === res.position) { S.round.estimates[i].val = res.estimate; found = true; break; }
      if (!found) S.round.estimates.push({ pos: res.position, val: res.estimate });
    }
    pushContext();
    L.log('ai_query', { position: res.position, estimate: res.estimate, refused: res.refused });
    save();
    renderAiLog();
    renderRound();
  }
  function renderAiLog() { if (arm === 'B' && A) A.renderLog($('ai-log'), S.round.queries); }

  // ---- stop / round end ----------------------------------------------------
  function openStop() {
    var reveals = S.round.reveals;
    pushContext();
    L.log('stop_confirm', { net: netOf(reveals) });
    $('stop-msg').textContent = reveals.length
      ? 'You will end this round with a net of ' + netOf(reveals) + ' cents. Stop?'
      : 'You will earn 0 for this round. Stop?';
    $('ov-stop').classList.add('show');
  }
  function closeStop() { $('ov-stop').classList.remove('show'); }

  function confirmStop() {
    closeStop();
    // Guard against scoring the same round twice (double-click, or a refresh that
    // somehow lands back here): a round is scored exactly once.
    if (S.round.ended) { showInterstitial(); return; }
    var reveals = S.round.reveals;
    var rawNet = reveals.length ? bestOf(reveals) - costOf(reveals) : 0;
    var flooredNet = Math.max(0, rawNet);
    pushContext();
    L.log('round_end', { net: rawNet, rawNet: rawNet, flooredNet: flooredNet, info: 'best=' + (bestOf(reveals) == null ? 'none' : bestOf(reveals)) });

    if (S.roundNum >= 1) {
      if (!S.results) S.results = [];
      S.results.push({ round: S.roundNum, mapping: S.round.mappingId, stratum: S.round.stratum,
        reveals: reveals.length, best: bestOf(reveals), cost: costOf(reveals), rawNet: rawNet, flooredNet: flooredNet });
    }
    // Mark the round ended and move to a distinct persisted phase, so a refresh
    // on the result screen resumes the interstitial — never the finished round.
    S.round.ended = true;
    S.phase = 'interstitial';
    L.clearRoundContext();
    save();
    showInterstitial();
  }

  // Recomputes the just-finished round's result from S.round (no params), so it
  // renders identically whether reached from confirmStop or a resume/refresh.
  function showInterstitial() {
    var reveals = S.round.reveals;
    var nReveals = reveals.length;
    var rawNet = nReveals ? bestOf(reveals) - costOf(reveals) : 0;
    var practice = (S.roundNum === 0);
    $('inter-title').textContent = practice ? 'Practice complete' : 'Round ' + S.roundNum + ' complete';
    var b = '<div class="res-line">Reveals: <b>' + nReveals + '</b></div>' +
            '<div class="res-line">Best value found: <b>' + (nReveals ? bestOf(reveals) + '¢' : '—') + '</b></div>' +
            '<div class="res-line">Net this round: <b class="res-big">' + rawNet + '¢</b></div>';
    if (practice) b += '<p class="muted small">This was practice and was not paid. The real rounds start now.</p>';
    $('inter-body').innerHTML = b;
    show('s-interstitial');
  }

  function nextRound() {
    if (S.roundNum === 0) { startRound(1, false); return; }
    if (S.roundNum >= N_TASKS) { finish(); return; }
    startRound(S.roundNum + 1, false);
  }

  // ======================================================================
  //  FINISH
  // ======================================================================
  function drawPaid() {
    if (S.paidRounds) return S.paidRounds;
    var rng = mulberry32(hashSeed(S.session + ':paid'));
    var idxs = []; for (var i = 1; i <= N_TASKS; i++) idxs.push(i);
    shuffle(idxs, rng);
    S.paidRounds = idxs.slice(0, CFG.PAID_TASKS).sort(function (a, b) { return a - b; });
    return S.paidRounds;
  }
  function resultOf(round) {
    for (var i = 0; i < (S.results || []).length; i++) if (S.results[i].round === round) return S.results[i];
    return { round: round, rawNet: 0, flooredNet: 0, reveals: 0, best: null };
  }

  function finish() {
    S.phase = 'finish';
    var paid = drawPaid();
    if (!S.finishedLogged) {
      var sum = 0, raw = 0;
      for (var i = 0; i < paid.length; i++) { var r = resultOf(paid[i]); sum += r.flooredNet; raw += r.rawNet; }
      L.clearRoundContext();
      L.log('paid_rounds_drawn', { value: sum, info: 'rounds=' + paid.join(',') + ';bonusCents=' + sum + ';rawSumCents=' + raw });
      L.log('session_end', { value: sum });
      S.finishedLogged = true; S.completed = true;
    }
    save();
    L.flush();
    renderFinish();
    show('s-finish');
    // gentle fallback note only if the endpoint is configured but unreachable
    if (CFG.ENDPOINT_URL) setTimeout(function () {
      if (L.pending && L.pending() > 0) {
        var n = $('upload-note');
        n.style.display = 'block';
        n.textContent = 'We could not reach our server to save your responses automatically. Please click “Download my session data” below and send us the file. Your completion code above is still valid.';
      }
    }, 3500);
  }

  function renderFinish() {
    var paid = drawPaid();
    var bonusCents = 0;
    for (var i = 0; i < paid.length; i++) bonusCents += resultOf(paid[i]).flooredNet;
    var bonus = (bonusCents / 100).toFixed(2);

    var rows = '';
    for (var r = 1; r <= N_TASKS; r++) {
      var res = resultOf(r);
      var picked = paid.indexOf(r) >= 0;
      rows += '<tr class="' + (picked ? 'picked' : '') + '"><td>' + r + '</td><td>' + res.reveals + '</td>' +
              '<td>' + (res.best == null ? '—' : res.best + '¢') + '</td>' +
              '<td>' + res.rawNet + '¢</td>' +
              '<td>' + (picked ? '✔ paid' : '') + '</td></tr>';
    }
    var intro = (CONTENT && CONTENT.finish)
      ? renderProse(CONTENT.finish)
      : '<p>Thank you for taking part. Below are your 10 real rounds. The two rounds marked ' +
        '<b>paid</b> were selected at random; your bonus is the sum of their earnings ' +
        '(a round counts as 0 if it was negative).</p>';
    $('finish-body').innerHTML =
      intro +
      '<table class="paid-table"><thead><tr><th>Round</th><th>Reveals</th><th>Best</th><th>Net</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="res-line">Your bonus: <b class="res-big">$' + bonus + '</b></p>';

    $('completion-code').textContent = CFG.COMPLETION_CODE;
  }

  // ======================================================================
  //  GLOBAL HANDLERS
  // ======================================================================
  function wireGlobalHandlers() {
    $('consent-box').addEventListener('change', function () { $('btn-consent').disabled = !this.checked; });
    $('btn-consent').addEventListener('click', function () {
      if (!$('consent-box').checked) return;
      S.consented = true; L.log('consent', { correct: true }); save();
      showInstructions();
    });
    $('btn-instructions').addEventListener('click', showQuiz);
    $('btn-quiz').addEventListener('click', submitQuiz);

    $('btn-reveal').addEventListener('click', doReveal);
    $('btn-stop').addEventListener('click', openStop);
    $('btn-stop-cancel').addEventListener('click', closeStop);
    $('btn-stop-ok').addEventListener('click', confirmStop);
    $('btn-continue').addEventListener('click', nextRound);

    $('btn-left').addEventListener('click', function () { selectPos(S.round.selected - 1); });
    $('btn-right').addEventListener('click', function () { selectPos(S.round.selected + 1); });
    $('pos-input').addEventListener('change', function () { selectPos(parseInt(this.value, 10) || 1); });

    $('btn-dl-json').addEventListener('click', function () { L.downloadJSON(); });
    $('btn-dl-csv').addEventListener('click', function () { L.downloadCSV(); });

    $('btn-restart').addEventListener('click', function () {
      if (!confirm('Restart and erase this session? (debug only)')) return;
      try {
        localStorage.removeItem(stateKey());
        localStorage.removeItem('searchv2:log:' + S.session);
        localStorage.removeItem('searchv2:log:' + S.session + ':lastT');
        localStorage.removeItem('searchv2:sid');
        localStorage.removeItem(ENTRY_KEY);
      } catch (e) {}
      location.href = location.pathname + location.search;
    });

    document.addEventListener('keydown', function (e) {
      if ($('s-round').classList.contains('active') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        if (e.key === 'ArrowLeft') { selectPos(S.round.selected - 1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { selectPos(S.round.selected + 1); e.preventDefault(); }
      }
    });
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // go
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
