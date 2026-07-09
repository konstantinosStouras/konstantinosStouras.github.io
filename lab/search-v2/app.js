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
  function boot() {
    var pr = params();
    DEBUG = (pr.debug === '1' && pr.key === CFG.DEBUG_KEY);
    // Debug-only: override the logging endpoint from the URL (for local testing).
    if (DEBUG && pr.endpoint) CFG.ENDPOINT_URL = pr.endpoint;

    // stable session id (Prolific SESSION_ID if given, else persisted uuid)
    var session = pr.SESSION_ID || localStorage.getItem('searchv2:sid');
    if (!session) {
      session = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'sid-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      localStorage.setItem('searchv2:sid', session);
    }

    // load or init state
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('searchv2:state:' + session)); } catch (e) {}
    S = saved || {};
    S.version = CFG.APP_VERSION;
    S.session = session;
    S.pid = pr.PROLIFIC_PID || S.pid || null;
    S.study = pr.STUDY_ID || S.study || null;

    // arm: URL wins; else persisted; else random 50/50 (persisted immediately)
    if (pr.arm === 'A' || pr.arm === 'B') S.arm = pr.arm;
    if (S.arm !== 'A' && S.arm !== 'B') S.arm = (Math.random() < 0.5 ? 'A' : 'B');
    arm = S.arm;
    save(); // lock in arm + ids before any async work, so a refresh keeps the same arm

    if (DEBUG) { $('nav-arm').textContent = 'Arm ' + arm + (S.round ? ' · ' + (S.round.mappingId || '') : ''); $('btn-restart').style.display = ''; }

    // logger base fields
    L.init({
      session: S.session, pid: S.pid, study: S.study, arm: arm,
      ua: navigator.userAgent, vw: window.innerWidth, vh: window.innerHeight,
      appVersion: CFG.APP_VERSION
    });

    loadAssistantIfNeeded(function () {
      fetch('data/mappings.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(onPool)
        .catch(function () { $('s-loading').innerHTML = '<p class="center" style="margin-top:40px;color:#a12a2a;">Could not load the study data. Please refresh.</p>'; });
    });
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
    switch (S.phase) {
      case 'instructions': showInstructions(); break;
      case 'quiz': showQuiz(); break;
      case 'round': startRound(S.roundNum, true); break;
      case 'finish': finish(); break;
      default: showConsent();
    }
  }

  // ======================================================================
  //  CONSENT
  // ======================================================================
  function showConsent() {
    S.phase = 'consent'; save();
    show('s-consent');
    $('consent-box').checked = false;
    $('btn-consent').disabled = true;
  }

  // ======================================================================
  //  INSTRUCTIONS  (verbatim, arm-specific)
  // ======================================================================
  function instructionsHTML() {
    var h =
      '<blockquote>' +
      '<p>In each round you will see 100 positions on a line. Each position hides a value between 0 and 100 cents.</p>' +
      '<p>Values at adjacent positions differ by at most 10 cents. So positions two apart differ by at most 20 cents, and so on.</p>' +
      '<p>You can reveal the value at any position. Each reveal costs 5 cents. You can stop whenever you want.</p>' +
      '<p>Your earnings for the round are the highest value you revealed, minus 5 cents for each reveal. If you reveal nothing, you earn 0 for the round.</p>' +
      '<p>After each round the values reset and will be different. There is 1 practice round and 10 real rounds. Two of the 10 real rounds will be picked at random and paid to you as a bonus.</p>';
    if (arm === 'B') {
      h +=
        '<hr>' +
        '<p>You also have a free assistant.</p>' +
        '<p>The assistant was trained on data about some positions between 30 and 70. You cannot see its data. If you ask about a position between 30 and 70, it gives you its best estimate: a straight line between its two nearest data points. Its estimates are usually close, but they are not guaranteed.</p>' +
        '<p>If you ask about any position outside 30 to 70, the assistant has no data and will tell you so.</p>' +
        '<p>Asking the assistant is free and unlimited. The assistant does not learn from your reveals in this study.</p>';
    }
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
    { id: 'q4', prompt: 'The assistant’s answer at position 50 is:',
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
    L.clearRoundContext();
    save();
    showInterstitial(rawNet, flooredNet, reveals.length);
  }

  function showInterstitial(rawNet, flooredNet, nReveals) {
    var practice = (S.roundNum === 0);
    $('inter-title').textContent = practice ? 'Practice complete' : 'Round ' + S.roundNum + ' complete';
    var b = '<div class="res-line">Reveals: <b>' + nReveals + '</b></div>' +
            '<div class="res-line">Best value found: <b>' + (nReveals ? bestOf(S.round.reveals) + '¢' : '—') + '</b></div>' +
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
    $('finish-body').innerHTML =
      '<p>Thank you for taking part. Below are your 10 real rounds. The two rounds marked ' +
      '<b>paid</b> were selected at random; your bonus is the sum of their earnings ' +
      '(a round counts as 0 if it was negative).</p>' +
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
      try { localStorage.removeItem(stateKey()); localStorage.removeItem('searchv2:log:' + S.session); localStorage.removeItem('searchv2:sid'); } catch (e) {}
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
