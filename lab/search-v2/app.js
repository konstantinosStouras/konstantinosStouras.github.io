/* ==========================================================================
   search-v2  ·  app.js
   State machine: consent -> instructions -> quiz -> practice -> 10 rounds ->
   finish. Owns per-round truth (in this closure only), logging context, and
   localStorage persistence/resume. Arm A never injects any assistant DOM/text.
   ========================================================================== */
(function () {
  'use strict';
  var CFG = window.CONFIG, L = window.Logger, LS = window.Landscape, A = null; // A set once assistant.js loads (Arm B)
  var CP = window.SVCopy;      // every participant-facing word (shared with the admin panel)
  var N_POS = CFG.N_POSITIONS, COST = CFG.REVEAL_COST;
  // Round counts — defaults from config, but the admin can override them per
  // session (see applyRounds). These are the live values the app uses.
  var N_TASKS = CFG.N_TASKS, PAID_TASKS = CFG.PAID_TASKS, N_PRACTICE = CFG.N_PRACTICE;
  // The assistant's interpolation region(s) and AI-model parameters, both
  // admin-overridable per session; these are the live values the app uses.
  var PATCHES = normalizePatches(CFG.COVERAGE_PATCHES);
  var AI_CFG = normalizeAI(CFG.AI);
  // Apply admin overrides from a settings object; clamp to sane bounds.
  function applyRounds(s) {
    if (!s) return;
    if (s.nTasks != null && +s.nTasks >= 1) N_TASKS = Math.min(120, Math.floor(+s.nTasks));
    if (s.nPractice != null) N_PRACTICE = (+s.nPractice > 0) ? 1 : 0;
    if (s.paidTasks != null && +s.paidTasks >= 0) PAID_TASKS = Math.floor(+s.paidTasks);
    // Paid rounds are drawn across ALL phases at the end, so the real cap is
    // N_TASKS × #phases; drawPaid() enforces it once the phase count is known.
    if (s.coveragePatches) PATCHES = normalizePatches(s.coveragePatches);
    if (s.ai) AI_CFG = normalizeAI(s.ai);
  }
  // Validate 1–2 interpolation regions: rounded, in [1,N], wide enough, ordered
  // and disjoint. Falls back to the config default on anything unusable.
  // Each entry may be an [a,b] pair (config.js, legacy) or an {a,b} map — the
  // shape admin sessions are stored in, since Firestore rejects nested arrays.
  function normalizePatches(patches) {
    var def = CFG.COVERAGE_PATCHES || [[30, 70]];
    if (!patches || Object.prototype.toString.call(patches) !== '[object Array]' || !patches.length) return def.slice();
    var out = [];
    for (var i = 0; i < patches.length && out.length < 2; i++) {
      var p = patches[i] || {};
      var a = Math.round(+(p.length != null ? p[0] : p.a)), b = Math.round(+(p.length != null ? p[1] : p.b));
      if (!isFinite(a) || !isFinite(b)) continue;
      if (b < a) { var t = a; a = b; b = t; }
      a = Math.max(1, Math.min(N_POS, a)); b = Math.max(1, Math.min(N_POS, b));
      if (b - a < 4) continue;                          // too thin for a couple of points
      out.push([a, b]);
    }
    if (!out.length) return def.slice();
    out.sort(function (p, q) { return p[0] - q[0]; });
    if (out.length === 2 && out[1][0] <= out[0][1]) out = [out[0]]; // overlap → one region
    return out;
  }
  function clampInt(v, lo, hi, dflt) { v = Math.round(+v); if (!isFinite(v)) v = dflt; return Math.max(lo, Math.min(hi, v)); }
  function dataLabel(v, dflt) { return (v === 'few' || v === 'standard' || v === 'lots') ? v : dflt; }
  // Validate the AI-model parameters. Baseline cost is below the reveal cost
  // (consulting is cheaper than searching); the frontier costs at least as much
  // as the baseline (its position vs. the reveal cost is the researcher's call).
  function normalizeAI(ai) {
    var d = CFG.AI || {};
    ai = ai || {};
    var base = clampInt(ai.baselineCost, 0, COST - 1, d.baselineCost != null ? d.baselineCost : 2);
    return {
      baselineCost: base,
      baselineData: dataLabel(ai.baselineData, d.baselineData || 'few'),
      frontier: !!ai.frontier,
      frontierCost: clampInt(ai.frontierCost, base, 50, Math.max(base, d.frontierCost != null ? d.frontierCost : base + 2)),
      frontierData: dataLabel(ai.frontierData, d.frontierData || 'lots')
    };
  }
  // Deterministic seed for a round's truth: fixed across participants/sessions,
  // different for Without-AI (A) vs With-AI (B), and independent per round. The
  // one practice round shares a single arm-independent curve.
  function truthSeed(a, roundNum) {
    var tag = (roundNum === 0) ? 'practice' : a;
    return LS.hashSeed(CFG.TRUTH_SEED + ':' + tag + ':r' + roundNum);
  }
  // roundNum to start the current phase at. Practice (round 0) is played only
  // once, at the very start (phase 0); later phases jump straight to round 1.
  function firstRound() { return (S && S.phaseIdx === 0 && N_PRACTICE > 0) ? 0 : 1; }

  // Resolve the ordered list of phases (arms) this subject plays, from the admin
  // settings. New model: settings.phases is an ordered array of 'A'/'B'
  // (optionally counterbalanced per subject). Legacy fallback: the old single-arm
  // settings.armMode ('url'|'A'|'B'|'random') → a one-phase session, preserving
  // the previous between-subjects behavior for sessions saved before this change.
  function resolvePhases(cfg, pr) {
    // Debug-only override (needs the debug key), so a tester can force a phase
    // sequence locally, e.g. ?phases=AB. Never available to real participants.
    if (DEBUG && pr && typeof pr.phases === 'string' && /^[AB]+$/.test(pr.phases)) {
      return pr.phases.split('');
    }
    if (cfg && Object.prototype.toString.call(cfg.phases) === '[object Array]' && cfg.phases.length) {
      var list = [];
      for (var i = 0; i < cfg.phases.length; i++) if (cfg.phases[i] === 'A' || cfg.phases[i] === 'B') list.push(cfg.phases[i]);
      if (!list.length) list = ['A'];
      if (cfg.counterbalance && list.length === 2 && Math.random() < 0.5) list = [list[1], list[0]];
      return list;
    }
    var mode = (cfg && cfg.armMode) || STUDY_ARM_MODE || 'url';
    var a;
    if (mode === 'A' || mode === 'B') a = mode;
    else if (mode === 'random') a = (Math.random() < 0.5 ? 'A' : 'B');
    else if (pr.arm === 'A' || pr.arm === 'B') a = pr.arm;
    else a = (Math.random() < 0.5 ? 'A' : 'B');
    return [a];
  }
  // ---- closure-only per-round secrets (NEVER on window/DOM) ----------------
  var truth = null;         // the current round's true value array (generated at runtime)
  var groupsByModel = null; // { base:[[pos,val],...][], front:? } — AI training data per model

  // The assistant training data for the model the participant currently has
  // selected (baseline unless a frontier model is offered and chosen).
  function currentModel() { return (AI_CFG.frontier && S.round && S.round.aiModel === 'front') ? 'front' : 'base'; }
  function currentGroups() { return (groupsByModel && groupsByModel[currentModel()]) || (groupsByModel && groupsByModel.base) || []; }
  function modelCost(model) { return model === 'front' ? AI_CFG.frontierCost : AI_CFG.baselineCost; }

  // ---- runtime -------------------------------------------------------------
  var chart = null;
  var S = null;       // persisted session state
  var arm = 'A';      // the arm of the CURRENT phase ('A' human-only | 'B' AI-assisted)
  var DEBUG = false;
  // Testing-only overlay toggles (debug/Test link only). NEVER shown to a real
  // participant: the AI region / training points / interpolation line and the
  // ground-truth line are revealed only when the tester ticks these.
  var TESTVIEW = { truth: false, region: false, dots: false, interp: false, window: false, knowledge: false };
  var lastSelectLogT = 0;
  var STUDY_CLOSED = false;    // set from the admin-controlled config/study doc
  var STUDY_ARM_MODE = 'url';  // legacy single-arm mode: 'url'|'A'|'B'|'random' (admin-controlled)
  var STUDY_CFG = null;        // raw settings (config/study or a session's settings)
  var SESSION_CODE = null;     // admin "session" (wave) code from ?code= (stamped on data)
  var SESSION_NAME = null;     // its human name
  var CONTENT = {};            // the session's admin overrides for any copy.js key
  var PREVIEW = false;         // admin preview: skip intro, don't write to Firestore

  // Participant-facing names for the two phases (arms). A phase is a block of
  // rounds played in one condition; a within-subjects session runs several in a
  // chosen order. Admin-editable like every other participant-facing string.
  function phaseLabel(a) { return T(a === 'B' ? 'phaseLabelB' : 'phaseLabelA') || a; }

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
    // Debug-only: shorten the idle-nudge delay so it can be exercised quickly.
    if (DEBUG && pr.idle) { var iv = parseInt(pr.idle, 10); if (iv > 0) IDLE_MS = iv; }
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
    applyStaticCopy();   // built-ins here: no session is known yet, so no overrides
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
      // Never strand a subject on the loading screen if Firestore is unreachable:
      // proceed with built-in defaults on either resolution or rejection.
      loader.then(function () { finishBoot(pr); }, function () { finishBoot(pr); });
    } else {
      finishBoot(pr);
    }
  }

  // Log out: erase every trace of this study on this device (state, event log,
  // sync markers, saved entry code, legacy ids) and drop the URL params (incl.
  // SESSION_ID) so the reload lands cleanly on the code gate.
  function logout() {
    if (!confirm(T('logoutConfirm'))) return;
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
    applyRounds(scfg);
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
    applyRounds(s);
  }

  function finishBoot(pr) {
    // Phase sequence. A persisted sequence wins (never re-randomise a subject
    // mid-study). A legacy in-progress subject has only S.arm → one-phase session.
    // Otherwise resolvePhases() applies the admin settings (new phases model or the
    // legacy armMode fallback).
    if (Object.prototype.toString.call(S.phases) !== '[object Array]' || !S.phases.length) {
      if (S.arm === 'A' || S.arm === 'B') S.phases = [S.arm];
      else S.phases = resolvePhases(STUDY_CFG, pr);
    }
    if (S.phaseIdx == null) S.phaseIdx = 0;
    if (S.phaseIdx > S.phases.length - 1) S.phaseIdx = S.phases.length - 1;
    arm = S.phases[S.phaseIdx];
    S.arm = arm;    // keep the logged arm in sync with the active phase
    save();         // lock in phases + ids before any async work

    // The session's settings (and therefore its copy overrides + round counts)
    // are known now, so paint every static heading/button/label/tooltip.
    applyStaticCopy();

    // Completion code. For a single-phase session an arm-specific code may apply
    // (each arm is its own Prolific study); a multi-phase subject plays every
    // condition, so only the shared code makes sense.
    if (STUDY_CFG) {
      var code = STUDY_CFG.completionCode;
      if (S.phases.length === 1) code = (arm === 'A' && STUDY_CFG.completionCodeA) || (arm === 'B' && STUDY_CFG.completionCodeB) || STUDY_CFG.completionCode;
      if (code) CFG.COMPLETION_CODE = code;
    }

    if (DEBUG) { $('nav-arm').textContent = (PREVIEW ? 'PREVIEW · ' : '') + navPhaseLabel() + (SESSION_CODE ? ' · ' + SESSION_CODE : ''); $('btn-restart').style.display = ''; }
    // TEST ROUND: a constant banner that this tab is a throwaway sandbox, so a
    // rehearsal can never be mistaken for a real run (the nav label alone was
    // easy to miss). Matches the ribbon in the other lab apps' sandboxes.
    if (PREVIEW && !document.getElementById('sv-ribbon')) {
      var rib = document.createElement('div');
      rib.id = 'sv-ribbon';
      rib.className = 'sv-ribbon';
      rib.innerHTML = '<span aria-hidden="true">\uD83E\uDDEA </span><b>Test mode</b> — this is a private sandbox. '
        + 'Nothing you do here is saved: no participant, no rounds, no events.';
      document.body.appendChild(rib);
    }

    // Study closed: only turn away subjects who have not started (in-progress and
    // finished subjects are always let through so they can finish / see the code).
    // Preview always proceeds (the admin is testing).
    if (STUDY_CLOSED && !PREVIEW && !S.completed && (!S.phase || S.phase === 'consent')) { renderClosed(); show('s-closed'); return; }

    // logger base fields (stamp the admin session code/name on every event). `arm`
    // and `phase` track the ACTIVE phase and are updated by advancePhase().
    L.init({
      session: S.session, sessionCode: SESSION_CODE, sessionName: SESSION_NAME,
      pid: S.pid, study: S.study, arm: arm, phase: S.phaseIdx + 1,
      ua: navigator.userAgent, vw: window.innerWidth, vh: window.innerHeight,
      appVersion: CFG.APP_VERSION
    });
    if (!PREVIEW) startFirebaseSync(); // preview never writes to Firestore
    watchAdminMessages();              // live admin messages/nudges for this participant

    loadAssistantIfNeeded(initPlay);
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

  // A short nav label for the debug overlay: the active arm, plus the phase
  // position when the subject plays more than one phase.
  function navPhaseLabel() {
    var base = 'Arm ' + arm;
    if (S && S.phases && S.phases.length > 1) base += ' · phase ' + (S.phaseIdx + 1) + '/' + S.phases.length;
    return base;
  }

  // assistant.js is loaded once if ANY phase in this session uses the AI (arm B);
  // a pure human-only (arm A) session never references it (strict arm isolation).
  function loadAssistantIfNeeded(cb) {
    if (!S.phases || S.phases.indexOf('B') < 0) { cb(); return; }
    if (window.Assistant) { A = window.Assistant; cb(); return; }
    var s = document.createElement('script');
    s.src = 'assistant.js';
    s.onload = function () { A = window.Assistant; cb(); };
    s.onerror = function () { cb(); }; // degrade gracefully; askAssistant guards on A
    document.head.appendChild(s);
  }

  // No pool to fetch anymore: each round's truth is generated at runtime from a
  // (arm, round) seed, so it is identical for everyone and independent per round.
  function initPlay() {
    if (!S.sessionStarted) {
      L.log('session_start', { info: 'phases=' + S.phases.join(',') +
        ';regions=' + PATCHES.map(function (p) { return p[0] + '-' + p[1]; }).join('|') +
        ';ai=' + (AI_CFG.frontier ? 'base(' + AI_CFG.baselineCost + ')+frontier(' + AI_CFG.frontierCost + ')' : 'base(' + AI_CFG.baselineCost + ')') });
      S.sessionStarted = true;
    }
    save();

    chart = window.Chart.create($('plot'), { onSelect: onChartSelect, onReveal: onChartReveal, onHover: onChartHover });
    wireGlobalHandlers();
    route();
  }

  // resume to the right screen
  function route() {
    if (S.completed) { renderFinish(); show('s-finish'); return; }
    // Preview (admin testing): skip consent/instructions/quiz, drop into practice.
    if (PREVIEW && (!S.phase || S.phase === 'consent' || S.phase === 'instructions' || S.phase === 'quiz')) {
      startRound(firstRound(), false); return;
    }
    switch (S.phase) {
      case 'phaseIntro': showPhaseIntro(); break;
      case 'instructions': showInstructions(); break;
      case 'quiz': showQuiz(); break;
      case 'round':
        // A finished-but-not-advanced round resumes its result screen, not the round.
        if (S.round && S.round.ended) { S.phase = 'interstitial'; save(); showInterstitial(); }
        else startRound(S.roundNum, true);
        break;
      case 'interstitial': showInterstitial(); break;
      case 'compare': showCompare(); break;
      case 'survey': showSurvey(); break;
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
  // Same, for a one-line string dropped inside existing markup: escaped, **bold**
  // honoured, no paragraph wrapper.
  function inline(text) { return esc(String(text == null ? '' : text)).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
  // ======================================================================
  //  COPY RESOLUTION
  //  Every participant-facing string comes from copy.js, with the admin's
  //  per-session override winning over the built-in default. Study-wide tokens
  //  ({nTasks}, {fee}, {rounds}, …) are expanded by the SHARED expander, so the
  //  admin panel's placeholders read exactly what a participant will read.
  // ======================================================================
  function copyCtx() {
    return {
      nTasks: N_TASKS, paidTasks: PAID_TASKS, nPractice: N_PRACTICE,
      nPhases: (S && S.phases) ? S.phases.length : 1,
      fee: COST, nPositions: N_POS, ai: AI_CFG
    };
  }
  function subTokens(text) { return CP.subTokens(text, copyCtx()); }
  // content(key): a multi-paragraph block, ready for renderProse().
  function content(key) { return subTokens(CP.resolve(CONTENT, key, copyCtx())); }
  // T(key, vars): a short string, with the per-moment values filled in
  // ({round}, {net}, {pos}, …) on top of the study-wide tokens.
  function T(key, vars) {
    var s = subTokens(CP.resolve(CONTENT, key, copyCtx()));
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m;
    });
    return s;
  }
  // Paint the static screens (headings, buttons, labels, tooltips, placeholders)
  // from the resolved copy. Markup carries the key in data-copy / data-copy-title
  // / data-copy-ph, so adding a string needs no change here.
  function applyStaticCopy() {
    var i, els = document.querySelectorAll('[data-copy]');
    for (i = 0; i < els.length; i++) els[i].textContent = T(els[i].getAttribute('data-copy'));
    els = document.querySelectorAll('[data-copy-title]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('title', T(els[i].getAttribute('data-copy-title')));
    els = document.querySelectorAll('[data-copy-ph]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', T(els[i].getAttribute('data-copy-ph')));
    try { document.title = T('brand'); } catch (e) {}
  }

  function showConsent() {
    S.phase = 'consent'; save();
    $('consent-body').innerHTML = renderProse(content('consent'));
    show('s-consent');
    $('consent-box').checked = false;
    $('btn-consent').disabled = true;
  }

  function renderClosed() { $('closed-body').innerHTML = renderProse(content('closed')); }

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
  //  PHASE TRANSITION  (within-subjects: shown at the start of a later phase)
  // ======================================================================
  function showPhaseIntro() {
    S.phase = 'phaseIntro'; save();
    $('phase-intro-title').textContent = T('phaseIntroTitle', { part: S.phaseIdx + 1, parts: S.phases.length });
    $('phase-intro-body').innerHTML = renderProse(content(arm === 'B' ? 'phaseIntroB' : 'phaseIntroA'));
    show('s-phase-intro');
  }

  // ======================================================================
  //  QUIZ  (all correct to pass; randomized option order)
  // ----------------------------------------------------------------------
  //  The questions, their options AND the answer key are participant-facing
  //  copy, so they live in copy.js (QUIZ) and are editable per session from the
  //  admin panel → "Page text & content" → "Quick check". The built-in set is:
  //    Q1  "highest possible value at position 52"      -> 60
  //    Q2  "what do you earn" (reveals 30 & 62)         -> 52
  //    Q3  (Arm B) "ask about a position it wasn't trained near" -> Still an estimate, may be off
  //    Q4  (Arm B) "the assistant's answer at 40 is"    -> An estimate that can be wrong
  //  To breeze through while testing, open the app in debug mode and the correct
  //  answers are PRE-SELECTED for you (just click Submit):
  //    https://www.stouras.com/lab/search-v2/?arm=B&debug=1&key=stouras
  //  (debug also overlays the true landscape + assistant dots + stratum/id.)
  // ======================================================================
  // The quiz questions still OWED at the start of the current phase: the common
  // task questions once, and the assistant questions the first time the subject
  // enters an AI (arm B) phase. Returns [] when nothing new needs checking (e.g.
  // a human-only phase after the common check has already been passed, or an
  // admin who removed every question), in which case the screen is skipped.
  function phaseQuizQuestions() {
    var set = CP.quizFor(CONTENT), qs = [];
    if (!S.commonQuizPassed) qs = qs.concat(set.common);
    if (arm === 'B' && !S.bQuizPassed) qs = qs.concat(set.ai);
    return qs;
  }
  function correctOptionOf(q) { return q.options[q.correct] != null ? q.options[q.correct] : q.options[0]; }
  // After instructions or a phase transition: quiz if anything is owed, else play.
  function proceedToQuizOrRound() {
    if (!PREVIEW && phaseQuizQuestions().length) showQuiz();
    else startRound(firstRound(), false);
  }

  function showQuiz() {
    S.phase = 'quiz'; save();
    var qs = phaseQuizQuestions(), html = '';
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var opts = shuffle(q.options.slice(), Math.random); // display-order only
      html += '<div class="quiz-q"><div class="q-prompt">' + (i + 1) + '. ' + esc(subTokens(q.prompt)) + '</div>';
      for (var k = 0; k < opts.length; k++) {
        html += '<label class="quiz-opt"><input type="radio" name="' + esc(q.id) + '" value="' + esc(opts[k]) + '"><span>' + esc(opts[k]) + '</span></label>';
      }
      html += '</div>';
    }
    $('quiz-body').innerHTML = html;
    $('quiz-feedback').style.display = 'none';
    // Debug/testing only: pre-select the correct answers and show a hint, so a
    // tester can click Submit and get into the game immediately. Gated on the
    // debug key, so real subjects never see this.
    if (DEBUG) {
      var keyBits = [];
      for (var qi = 0; qi < qs.length; qi++) {
        var correct = correctOptionOf(qs[qi]);
        var inputs = document.getElementsByName(qs[qi].id);
        for (var j = 0; j < inputs.length; j++) if (inputs[j].value === correct) inputs[j].checked = true;
        keyBits.push('Q' + (qi + 1) + '=' + correct);
      }
      var hint = document.createElement('div');
      hint.className = 'note';
      hint.style.marginTop = '10px';
      hint.textContent = 'Debug: correct answers are pre-selected — just click Submit. (Answers: ' + keyBits.join(', ') + '.)';
      $('quiz-body').appendChild(hint);
    }
    show('s-quiz');
  }

  function submitQuiz() {
    var qs = phaseQuizQuestions(), allCorrect = true;
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var sel = document.querySelector('input[name="' + q.id + '"]:checked');
      var choice = sel ? sel.value : null;
      var ok = (choice === correctOptionOf(q));
      if (!ok) allCorrect = false;
      L.log('quiz_attempt', { qid: q.id, choice: choice, correct: ok });
    }
    if (allCorrect) {
      // Mark whichever checks were just cleared so later phases don't re-ask them.
      S.commonQuizPassed = true;
      if (arm === 'B') S.bQuizPassed = true;
      save();
      startRound(firstRound(), false); // practice (or round 1 if practice disabled)
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
  function revealCost(round) { return round.reveals.length * COST; }
  function aiSpend(round) { var c = 0, q = round.queries || []; for (var i = 0; i < q.length; i++) c += (q[i].cost || 0); return c; }
  function roundCost(round) { return revealCost(round) + aiSpend(round); }
  // Round net = best revealed prize − reveal fees − AI-consultation fees. Doing
  // nothing earns 0; asking the AI without revealing can go negative (you paid
  // the AI but revealed no prize).
  function roundNet(round) { return (bestOf(round.reveals) || 0) - roundCost(round); }
  function isRevealed(pos) { for (var i = 0; i < S.round.reveals.length; i++) if (S.round.reveals[i].pos === pos) return true; return false; }

  function pushContext() {
    L.setContext({
      round: S.roundNum, mapping: S.round.mappingId, stratum: S.round.stratum,
      reveals: S.round.reveals.length, cost: roundCost(S.round),
      best: bestOf(S.round.reveals), net: roundNet(S.round)
    });
  }

  // Generate the round's truth and per-model AI training data deterministically
  // from (arm, round). Same for everyone; different per arm and per round.
  function buildRound(roundNum) {
    var seed = truthSeed(arm, roundNum);
    truth = LS.makeWalk(seed);
    groupsByModel = { base: LS.makeDots(truth, PATCHES, AI_CFG.baselineData, seed) };
    if (AI_CFG.frontier) groupsByModel.front = LS.makeDots(truth, PATCHES, AI_CFG.frontierData, (seed ^ 0x2545F491) >>> 0);
  }

  function startRound(roundNum, resume) {
    S.roundNum = roundNum; S.phase = 'round';
    var mapId = (roundNum === 0 ? 'practice' : arm + '-r' + roundNum);
    buildRound(roundNum);
    if (!resume || !S.round || S.round.mappingId !== mapId) {
      S.round = { mappingId: mapId, stratum: roundNum === 0 ? 'practice' : '',
        reveals: [], estimates: [], queries: [], warned: false, selected: 50, aiModel: 'base' };
    }
    if (S.round.aiModel == null) S.round.aiModel = 'base';
    // round_start is logged once per (phase, round) — rounds 1..N repeat in every
    // phase, so the guard is keyed by both, not the round number alone.
    if (!S.roundStartedLogged) S.roundStartedLogged = {};
    var rkey = S.phaseIdx + ':' + roundNum;
    pushContext();
    if (!S.roundStartedLogged[rkey]) { L.log('round_start'); S.roundStartedLogged[rkey] = true; }
    save();

    // build arm-specific chrome
    $('round-grid').classList.toggle('arm-b', arm === 'B');
    buildLegend();
    buildAuxPanel();
    if (DEBUG) $('nav-arm').textContent = navPhaseLabel() + ' · ' + mapId + ' · ' + S.round.stratum;

    show('s-round');
    renderRound();
    bumpActivity();   // start the inactivity nudge countdown for this round
  }

  function buildLegend() {
    var h = '<span class="lg"><span class="swatch dot"></span> ' + esc(T('legendRevealed')) + '</span>';
    if (arm === 'B') {
      // The coverage band / training points are TESTING-only, so they are not
      // advertised in the participant legend — only the estimate the AI returns.
      h += '<span class="lg"><span class="swatch diamond"></span> ' + esc(T('legendEstimate')) + '</span>';
    }
    $('legend').innerHTML = h;
  }

  function costLabel(c) { return c > 0 ? c + '¢' : T('aiFreeWord'); }
  function askLabel() {
    return T(AI_CFG.frontier ? 'aiAskBtnFrontier' : 'aiAskBtn', { cost: costLabel(modelCost(currentModel())) });
  }
  function buildAuxPanel() {
    var aux = $('aux-panel');
    if (arm !== 'B') { aux.innerHTML = ''; return; } // Arm A: no assistant DOM at all
    if (aux.getAttribute('data-built') === '1') { syncModelPicker(); renderAiLog(); updateAiSpend(); return; }
    var picker = '';
    if (AI_CFG.frontier) {
      picker =
        '<div class="ai-models" id="ai-models">' +
          '<button type="button" class="ai-model" data-model="base">' + esc(T('aiModelBase')) + ' <span class="mc">' + esc(costLabel(AI_CFG.baselineCost)) + '</span></button>' +
          '<button type="button" class="ai-model" data-model="front">' + esc(T('aiModelFront')) + ' <span class="mc">' + esc(costLabel(AI_CFG.frontierCost)) + '</span></button>' +
        '</div>';
    }
    aux.innerHTML =
      '<h3>' + esc(T('aiTitle')) + '</h3>' +
      '<p class="small muted">' + esc(T('aiIntro')) + '</p>' +
      picker +
      '<div class="ask-row"><span class="small">' + esc(T('posLabel')) + '</span>' +
      '<input type="number" id="ai-pos" min="1" max="100" value="' + S.round.selected + '">' +
      '<button class="btn btn-blue btn-sm" id="btn-ask">' + esc(askLabel()) + '</button></div>' +
      '<div class="ai-spend small muted" id="ai-spend"></div>' +
      '<div class="ai-log" id="ai-log"></div>';
    aux.setAttribute('data-built', '1');
    $('btn-ask').addEventListener('click', askAssistant);
    $('ai-pos').addEventListener('keydown', function (e) { if (e.key === 'Enter') askAssistant(); });
    if (AI_CFG.frontier) {
      var mbtns = aux.querySelectorAll('.ai-model');
      for (var i = 0; i < mbtns.length; i++) mbtns[i].addEventListener('click', function () {
        S.round.aiModel = this.getAttribute('data-model'); save(); renderRound();
      });
    }
    syncModelPicker();
    renderAiLog();
    updateAiSpend();
  }
  // Reflect the selected model in the picker + the Ask button (panel is built once).
  function syncModelPicker() {
    if (!AI_CFG.frontier) return;
    var aux = $('aux-panel'); if (!aux) return;
    var mbtns = aux.querySelectorAll('.ai-model');
    for (var i = 0; i < mbtns.length; i++) mbtns[i].classList.toggle('on', mbtns[i].getAttribute('data-model') === currentModel());
    if ($('btn-ask')) $('btn-ask').textContent = askLabel();
  }
  // Running tally of how much the participant has spent consulting the AI this round.
  function updateAiSpend() {
    var el = $('ai-spend'); if (!el) return;
    var q = (S.round.queries || []).length, sp = aiSpend(S.round);
    el.innerHTML = q ? inline(T('aiSpend', { n: q, spent: sp, timesWord: T(q === 1 ? 'aiTimeSingular' : 'aiTimePlural') })) : '';
  }

  function renderRound(fromHover) {
    $('round-label').textContent =
      (S.roundNum === 0 ? T('roundLabelPractice') : T('roundLabelReal', { round: S.roundNum })) +
      (S.phases.length > 1 ? ' · ' + phaseLabel(arm) : '');
    var reveals = S.round.reveals;
    $('c-reveals').textContent = reveals.length;
    $('c-cost').innerHTML = roundCost(S.round) + '&cent;';
    $('c-best').innerHTML = reveals.length ? bestOf(reveals) + '&cent;' : '&mdash;';
    $('c-net').innerHTML = roundNet(S.round) + '&cent;';
    $('warn-negative').style.display = S.round.warned ? 'block' : 'none';

    $('pos-input').value = S.round.selected;
    var revealed = isRevealed(S.round.selected);
    var rb = $('btn-reveal');
    rb.disabled = revealed;
    rb.textContent = T(revealed ? 'revealedBtn' : 'revealBtn');

    // Keep the AI panel's position in step with the cursor on deliberate moves,
    // but not while merely hovering (so it never clobbers a value being typed).
    if (!fromHover && arm === 'B' && $('ai-pos')) $('ai-pos').value = S.round.selected;
    if (arm === 'B') { syncModelPicker(); updateAiSpend(); }

    // The overlays below are TESTING-only (guarded by DEBUG); a real participant
    // never sees the region, training points, interpolation, or ground truth.
    var groups = currentGroups();
    var geo = LS.geometry(groups);
    var showWin = DEBUG && TESTVIEW.window;
    var win = showWin ? LS.windowEnvelope(reveals.map(function (r) { return [r.pos, r.val]; }), CFG.L_STEP, N_POS) : null;
    if (DEBUG) buildTestView();
    chart.render({
      arm: arm, coverage: PATCHES, selected: S.round.selected,
      revealed: reveals.map(function (r) { return { pos: r.pos, val: r.val }; }),
      estimates: arm === 'B' ? S.round.estimates.map(function (e) { return { pos: e.pos, val: e.val }; }) : [],
      truth: truth, dotGroups: groups, interp: geo.interp, extrap: geo.extrap, zones: geo.zones,
      windowCeiling: win ? win.ceiling : null, windowBest: win ? win.best : 0,
      tag: DEBUG ? (S.round.mappingId + (arm === 'B' ? ' · ' + currentModel() : '')) : null,
      showTruth: DEBUG && TESTVIEW.truth,
      showCoverage: DEBUG && arm === 'B' && TESTVIEW.region,
      showDots: DEBUG && arm === 'B' && TESTVIEW.dots,
      showInterp: DEBUG && arm === 'B' && TESTVIEW.interp,
      showWindow: showWin
    });
  }

  // Testing-only overlay controls (debug/Test link). Built once, then the
  // AI-specific toggles are shown only in the With-AI phase.
  function buildTestView() {
    var bar = $('testview');
    if (!bar) return;
    if (bar.getAttribute('data-built') !== '1') {
      bar.innerHTML =
        '<span class="tv-title">Testing view</span>' +
        '<label><input type="checkbox" id="tv-truth"> Ground truth</label>' +
        '<label><input type="checkbox" id="tv-window"> Search window</label>' +
        '<label><input type="checkbox" id="tv-knowledge"> Value of knowledge</label>' +
        '<label class="tv-ai"><input type="checkbox" id="tv-region"> AI region</label>' +
        '<label class="tv-ai"><input type="checkbox" id="tv-dots"> AI data points</label>' +
        '<label class="tv-ai"><input type="checkbox" id="tv-interp"> AI interp / extrap</label>' +
        '<div class="tv-opt" id="tv-opt"></div>' +
        '<div class="tv-opt tv-know" id="tv-know" style="display:none;"></div>';
      var wire = function (id, key) {
        $(id).checked = TESTVIEW[key];
        $(id).addEventListener('change', function () { TESTVIEW[key] = this.checked; renderRound(); });
      };
      wire('tv-truth', 'truth'); wire('tv-window', 'window'); wire('tv-knowledge', 'knowledge');
      wire('tv-region', 'region'); wire('tv-dots', 'dots'); wire('tv-interp', 'interp');
      bar.setAttribute('data-built', '1');
    }
    bar.style.display = '';
    var ai = bar.querySelectorAll('.tv-ai');
    for (var i = 0; i < ai.length; i++) ai[i].style.display = (arm === 'B') ? '' : 'none';
    updateOptReadout();
    updateKnowReadout();
  }

  // Rational-search benchmark readout (testing/debug only — never shown to a real
  // participant). Scores this round's reveals against the paper's "search window"
  // (Malladi–Martínez-Marquina–Morozov, "Space Exploration"): obvious-mistake rate
  // vs a uniform-random null, whether the stop was optimal, and the i.i.d.
  // reservation value. Uses the participant's OWN reveals only (no truth leak).
  function updateOptReadout() {
    var el = $('tv-opt'); if (!el) return;
    var s = LS.windowStats((S.round.reveals || []).map(function (r) { return [r.pos, r.val]; }), CFG.L_STEP, N_POS, COST);
    var pct = function (r) { return Math.round(r * 100) + '%'; };
    var head = '<b>Rational benchmark</b> <span class="tv-optnote">(test only · Space Exploration search window)</span>: ';
    if (!s.n) { el.innerHTML = head + 'no reveals yet — the whole line is still in the window.'; return; }
    var stop = s.windowRemaining === 0
      ? '<b>window empty → optimal to stop now</b>'
      : s.windowRemaining + ' cell' + (s.windowRemaining === 1 ? '' : 's') + ' could still beat your best';
    el.innerHTML = head +
      s.n + ' reveal' + (s.n === 1 ? '' : 's') +
      ' · <b>' + s.mistakes + '</b> obvious mistake' + (s.mistakes === 1 ? '' : 's') + ' (' + pct(s.mistakeRate) + ', random ≈ ' + pct(s.randomRate) + ')' +
      ' · ' + stop +
      ' · best ' + s.best + '&cent; · i.i.d. reservation ≈ ' + s.reservation + '&cent;';
  }

  // Value-of-knowledge readout (testing/debug only — never shown to a real
  // participant). Computes the welfare KPI the paper's searcher maximizes —
  // v(Fk) = Σ_x max(1 − σ²_x/q, 0), Carnehl & Schneider, ECMA 2025, p.629 — from
  // this round's reveals, and shows how it GROWS as the search progresses via a
  // sparkline of v after each reveal. Only rendered when the toggle is on. Uses
  // the participant's OWN reveals (no truth leak).
  function updateKnowReadout() {
    var el = $('tv-know'); if (!el) return;
    el.style.display = TESTVIEW.knowledge ? '' : 'none';
    if (!TESTVIEW.knowledge) return;
    var k = LS.knowledgeValue((S.round.reveals || []).map(function (r) { return [r.pos, r.val]; }), { L: CFG.L_STEP, n: N_POS });
    var head = '<b>Value of knowledge v(F<sub>k</sub>)</b> <span class="tv-optnote">(test only · Carnehl–Schneider, ECMA 2025 p.629 — the welfare the searcher maximizes)</span>: ';
    if (!k.series.length) { el.innerHTML = head + 'no reveals yet — v = 0 of ' + N_POS + '.'; return; }
    el.innerHTML = head +
      '<b>' + k.v + '</b> of ' + N_POS + ' cells understood (' + k.coverage + '%)' +
      ' · last reveal added <b>' + (k.marginal >= 0 ? '+' : '') + k.marginal + '</b>' +
      ' · mean posterior s.d. ' + k.meanStd + '&cent;' +
      ' · q = ' + Math.round(k.q) + '&cent;&sup2; (dead middle past ~' + k.threshGap + '-wide gaps)' +
      knowSpark(k.series);
  }
  // Inline-SVG sparkline of the value-of-knowledge trajectory (v after each reveal).
  function knowSpark(series) {
    if (!series || series.length < 2) return '';
    var W = 150, H = 30, pad = 3, n = series.length, i, x, y, pts = [];
    for (i = 0; i < n; i++) {
      x = pad + (n === 1 ? 0 : i * (W - 2 * pad) / (n - 1));
      y = H - pad - (Math.max(0, Math.min(N_POS, series[i])) / N_POS) * (H - 2 * pad);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var last = pts[pts.length - 1].split(',');
    return ' <svg class="tv-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts.join(' ') + '"/>' +
      '<circle r="2.2" cx="' + last[0] + '" cy="' + last[1] + '" fill="currentColor"/>' +
      '</svg>';
  }

  function selectPos(pos) {
    pos = Math.max(1, Math.min(N_POS, pos | 0));
    S.round.selected = pos;
    var now = Date.now();
    if (now - lastSelectLogT >= 1000) { L.log('select', { position: pos }); lastSelectLogT = now; }
    save();
    renderRound();
    bumpActivity();
  }
  // Clicking a position on the plot reveals it directly (click-to-reveal), so a
  // A single click, or moving the mouse over the plot, only moves the dotted
  // cursor line — it does NOT reveal a prize. A DOUBLE click reveals the prize at
  // that position (revealing costs 5¢, so it must be a deliberate double click).
  function onChartSelect(pos) { selectPos(pos); }
  function onChartReveal(pos) { selectPos(pos); if (!isRevealed(pos)) doReveal(); }
  function onChartHover(pos) {
    pos = Math.max(1, Math.min(N_POS, pos | 0));
    if (!S.round || S.round.ended || S.round.selected === pos) return;
    S.round.selected = pos;   // follow the mouse with the cursor line only —
    renderRound(true);        // no reveal, no logging, no save, no AI-input sync
  }

  function doReveal() {
    var pos = S.round.selected;
    if (isRevealed(pos)) return;
    var val = truth[pos - 1];
    S.round.reveals.push({ pos: pos, val: val });
    pushContext();
    L.log('reveal', { position: pos, value: val });
    // one-time gentle warning when net first drops to <= 0
    if (!S.round.warned && roundNet(S.round) <= 0) {
      S.round.warned = true;
      L.log('warn_negative');
    }
    save();
    renderRound();
    bumpActivity();
  }

  // ---- assistant (Arm B) ---------------------------------------------------
  function askAssistant() {
    if (!A) return;
    var input = $('ai-pos');
    var x = parseInt(input.value, 10);
    if (isNaN(x)) return;
    x = Math.max(1, Math.min(N_POS, x));
    var model = currentModel(), cost = modelCost(model);
    var res = A.estimate(currentGroups(), x);
    // The wording of the answer is participant-facing copy (admin-editable);
    // assistant.js only computes the number.
    res.text = T('aiAnswer', { pos: res.position, est: res.estimate });
    S.round.queries.push({ position: res.position, estimate: res.estimate, refused: false, model: model, cost: cost, mode: res.mode, text: res.text });
    // Keep every AI suggestion on the plot: accumulate one diamond per asked
    // position (a re-ask updates that position's estimate), so as the participant
    // searches they build up a picture of how good the AI's suggestions are versus
    // the prizes they reveal.
    var placed = false;
    for (var qi = 0; qi < S.round.estimates.length; qi++) {
      if (S.round.estimates[qi].pos === res.position) { S.round.estimates[qi].val = res.estimate; placed = true; break; }
    }
    if (!placed) S.round.estimates.push({ pos: res.position, val: res.estimate });
    pushContext();
    L.log('ai_query', { position: res.position, estimate: res.estimate, refused: false, info: 'model=' + model + ';mode=' + res.mode + ';fee=' + cost });
    save();
    renderAiLog();
    renderRound();
    bumpActivity();
  }
  function renderAiLog() { if (arm === 'B' && A) A.renderLog($('ai-log'), S.round.queries, T('aiEmptyLog')); }

  // ---- stop / round end ----------------------------------------------------
  function openStop() {
    var reveals = S.round.reveals, net = roundNet(S.round);
    pushContext();
    L.log('stop_confirm', { net: net });
    $('stop-msg').textContent = (reveals.length || aiSpend(S.round))
      ? T('stopMsg', { net: net })
      : T('stopMsgZero');
    $('ov-stop').classList.add('show');
  }
  function closeStop() { $('ov-stop').classList.remove('show'); }

  function confirmStop() {
    closeStop();
    stopIdle();   // round is ending — no more inactivity nudges for it
    // Guard against scoring the same round twice (double-click, or a refresh that
    // somehow lands back here): a round is scored exactly once.
    if (S.round.ended) { showInterstitial(); return; }
    var reveals = S.round.reveals;
    var rawNet = roundNet(S.round);
    var flooredNet = Math.max(0, rawNet);
    var asks = (S.round.queries || []).length, spend = aiSpend(S.round);
    pushContext();
    L.log('round_end', { net: rawNet, rawNet: rawNet, flooredNet: flooredNet,
      info: 'best=' + (bestOf(reveals) == null ? 'none' : bestOf(reveals)) + ';reveals=' + reveals.length + ';aiAsks=' + asks + ';aiSpend=' + spend });

    if (S.roundNum >= 1) {
      if (!S.results) S.results = [];
      S.results.push({ phase: S.phaseIdx, arm: arm, round: S.roundNum, mapping: S.round.mappingId, stratum: S.round.stratum,
        reveals: reveals.length, best: bestOf(reveals), cost: roundCost(S.round),
        aiAsks: asks, aiSpend: spend, rawNet: rawNet, flooredNet: flooredNet,
        // searched positions (for the end-of-study debrief plots)
        path: reveals.map(function (r) { return [r.pos, r.val]; }) });
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
    var rawNet = roundNet(S.round);
    var practice = (S.roundNum === 0);
    // The last real round of a non-final phase heads into a phase transition next.
    var lastOfPhase = (!practice && S.roundNum >= N_TASKS && S.phaseIdx < S.phases.length - 1);
    var lastOverall = (!practice && S.roundNum >= N_TASKS && S.phaseIdx >= S.phases.length - 1);
    $('inter-title').textContent = practice ? T('interPractice')
      : lastOfPhase ? T('interPart', { part: S.phaseIdx + 1 })
      : T('interRound', { round: S.roundNum });
    var b = '<div class="res-line">' + inline(T('resReveals')) + ': <b>' + nReveals + '</b></div>';
    if (arm === 'B' && (S.round.queries || []).length)
      b += '<div class="res-line">' + inline(T('resAiQuestions')) + ': <b>' + S.round.queries.length + '</b> ' +
           inline(T('resAiSpent', { spent: aiSpend(S.round) })) + '</div>';
    b += '<div class="res-line">' + inline(T('resBest')) + ': <b>' + (nReveals ? bestOf(reveals) + '¢' : '—') + '</b></div>' +
         '<div class="res-line">' + inline(T('resNet')) + ': <b class="res-big">' + rawNet + '¢</b></div>';
    if (practice) b += '<p class="muted small">' + inline(T('interPracticeNote')) + '</p>';
    else if (lastOfPhase) b += '<p class="muted small">' + inline(T('interPartNote')) + '</p>';
    else if (lastOverall) b += '<p class="muted small">' + inline(T('interLastNote')) + '</p>';
    $('inter-body').innerHTML = b;
    show('s-interstitial');
  }

  function nextRound() {
    if (S.roundNum === 0) { startRound(1, false); return; }        // practice → round 1
    if (S.roundNum >= N_TASKS) {                                    // phase complete
      if (S.phaseIdx < S.phases.length - 1) { advancePhase(); return; }
      showCompare(); return;    // all phases done → debrief → survey → finish
    }
    startRound(S.roundNum + 1, false);
  }

  // Move a within-subjects subject into the next phase: switch the active arm,
  // re-stamp the logger, and show the transition screen (then quiz-if-owed → play).
  function advancePhase() {
    S.phaseIdx++;
    arm = S.phases[S.phaseIdx];
    S.arm = arm;
    L.setBase({ arm: arm, phase: S.phaseIdx + 1 });
    L.clearRoundContext();
    L.log('phase_start', { info: 'idx=' + (S.phaseIdx + 1) + ';arm=' + arm });
    S.phase = 'phaseIntro';
    save();
    showPhaseIntro();
  }

  // ======================================================================
  //  END-OF-STUDY DEBRIEF (comparison) + SURVEY
  // ======================================================================
  // A round to visualise for a phase: prefer one of its paid rounds (the ones
  // that actually counted), else its last round.
  function representativeRound(phaseIdx) {
    var paid = drawPaid();
    for (var i = 0; i < paid.length; i++) if (paid[i].phase === phaseIdx) return paid[i].round;
    return N_TASKS;
  }
  // Aggregate stats across all real rounds of a phase.
  function phaseStats(phaseIdx) {
    var res = S.results || [], n = 0, net = 0, rev = 0, best = 0, bestN = 0;
    for (var i = 0; i < res.length; i++) {
      var rp = (res[i].phase == null ? 0 : res[i].phase);
      if (rp !== phaseIdx) continue;
      n++; net += res[i].rawNet || 0; rev += res[i].reveals || 0;
      if (res[i].best != null) { best += res[i].best; bestN++; }
    }
    return { avgNet: n ? net / n : 0, avgRev: n ? rev / n : 0, avgBest: bestN ? best / bestN : 0 };
  }

  // Debrief: two plots (one representative round per phase) revealing the true
  // curve + the positions searched, plus per-phase stats. In the With-AI phase
  // the AI region / training points / interpolation line are ALSO revealed here
  // (the study is over, so it's fine to show what was hidden during play).
  function showCompare() { S.phase = 'compare'; S.completed = false; save(); renderCompare(); show('s-compare'); }

  function renderCompare() {
    var multi = S.phases.length > 1;
    $('compare-intro').textContent = T(multi ? 'compareIntroMulti' : 'compareIntroSingle');

    var cols = '';
    for (var ph = 0; ph < S.phases.length; ph++) {
      var st = phaseStats(ph);
      cols += '<div class="cmp-col"><h3>' + esc(phaseLabel(S.phases[ph])) + '</h3>' +
        '<div class="plot-wrap"><div id="cmp-plot-' + ph + '"></div></div>' +
        '<div class="cmp-stats">' +
          '<div class="s"><b>' + (st.avgNet / 100).toFixed(2) + '</b><span>' + esc(T('cmpAvgNet')) + '</span></div>' +
          '<div class="s"><b>' + st.avgRev.toFixed(1) + '</b><span>' + esc(T('cmpAvgReveals')) + '</span></div>' +
          '<div class="s"><b>' + (st.avgBest / 100).toFixed(2) + '</b><span>' + esc(T('cmpAvgBest')) + '</span></div>' +
        '</div></div>';
    }
    var hasB = S.phases.indexOf('B') >= 0;
    $('compare-body').innerHTML = '<div class="cmp-grid">' + cols + '</div>' +
      '<div class="cmp-legend">' +
        '<i style="border-top-style:solid;border-color:var(--blue);"></i> ' + esc(T('cmpLegendTruth')) + ' &nbsp;&nbsp;' +
        '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ink);vertical-align:middle;margin-right:4px;"></span> ' + esc(T('cmpLegendRevealed')) +
        (hasB ? ' &nbsp;&nbsp;<i style="border-top-style:solid;border-color:var(--green);"></i> ' + esc(T('cmpLegendInterp')) + ' &nbsp;&nbsp;' +
          '<i style="border-top-style:dashed;border-color:var(--amber);"></i> ' + esc(T('cmpLegendExtrap')) + ' &nbsp;&nbsp;' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--red);vertical-align:middle;margin-right:4px;"></span> ' + esc(T('cmpLegendDots')) : '') +
      '</div>';

    for (var p = 0; p < S.phases.length; p++) {
      var a = S.phases[p];
      var rnd = representativeRound(p);
      var res = resultOf(p, rnd);
      var host = $('cmp-plot-' + p);
      if (!host) continue;
      // Regenerate the exact curve this round used (deterministic by arm+round),
      // plus the baseline model's training data / interpolation for context.
      var t = LS.makeWalk(truthSeed(a, rnd));
      var groups = LS.makeDots(t, PATCHES, AI_CFG.baselineData, truthSeed(a, rnd));
      var geo = LS.geometry(groups);
      var revd = (res.path || []).map(function (pr) { return { pos: pr[0], val: pr[1] }; });
      Chart.create(host).render({
        arm: a, coverage: PATCHES, selected: null, revealed: revd, estimates: [],
        truth: t, dotGroups: groups, interp: geo.interp, extrap: geo.extrap, zones: geo.zones,
        showTruth: true, showCoverage: a === 'B', showDots: a === 'B', showInterp: a === 'B', tag: null
      });
    }
  }

  // ---- exit survey (anonymous; responses logged as `survey` events) ----------
  // The questions, their type and the agree/disagree scale are participant-facing
  // copy: they live in copy.js (SURVEY / surveyLikert) and are editable per
  // session from the admin panel. `ai:true` questions are asked only when the
  // session actually includes a With-AI phase.
  function surveyQuestions() {
    var hasB = S.phases.indexOf('B') >= 0;
    return CP.surveyFor(CONTENT).filter(function (q) { return hasB || !q.ai; });
  }
  function likertLabels() {
    var l = CP.lines(CONTENT && CONTENT.surveyLikert, 'surveyLikert');
    return l.length ? l : CP.lines(null, 'surveyLikert');
  }
  function showSurvey() { S.phase = 'survey'; save(); renderSurvey(); show('s-survey'); }
  function renderSurvey() {
    var qs = surveyQuestions();
    var labels = likertLabels();
    var h = '';
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      h += '<div class="survey-q"><div class="sq-prompt">' + esc(subTokens(q.prompt)) + '</div>';
      if (q.type === 'likert') {
        h += '<div class="likert">';
        for (var v = 1; v <= labels.length; v++) h += '<label><input type="radio" name="sq-' + esc(q.id) + '" value="' + v + '"><span>' + esc(labels[v - 1]) + '</span></label>';
        h += '</div>';
      } else {
        h += '<textarea id="sq-' + esc(q.id) + '" rows="3"></textarea>';
      }
      h += '</div>';
    }
    $('survey-body').innerHTML = h;
  }
  function submitSurvey() {
    var qs = surveyQuestions();
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (q.type === 'likert') {
        var sel = document.querySelector('input[name="sq-' + q.id + '"]:checked');
        L.log('survey', { qid: q.id, choice: sel ? parseInt(sel.value, 10) : null });
      } else {
        var ta = $('sq-' + q.id);
        L.log('survey', { qid: q.id, info: ta ? ta.value.trim().slice(0, 2000) : '' });
      }
    }
    finish();
  }

  // ======================================================================
  //  FINISH
  // ======================================================================
  // Every paid-eligible round across all phases, as {phase, round} pairs.
  function allRealRounds() {
    var list = [];
    for (var ph = 0; ph < S.phases.length; ph++)
      for (var r = 1; r <= N_TASKS; r++) list.push({ phase: ph, round: r });
    return list;
  }
  function drawPaid() {
    if (S.paidRounds) {
      // Migrate a legacy int[] draw (single-phase, pre-phases) to {phase,round}.
      if (S.paidRounds.length && typeof S.paidRounds[0] === 'number') {
        S.paidRounds = S.paidRounds.map(function (r) { return { phase: 0, round: r }; });
      }
      return S.paidRounds;
    }
    var rng = mulberry32(hashSeed(S.session + ':paid'));
    var all = allRealRounds();
    shuffle(all, rng);
    var picked = all.slice(0, Math.min(PAID_TASKS, all.length));
    picked.sort(function (a, b) { return (a.phase - b.phase) || (a.round - b.round); });
    S.paidRounds = picked;
    return S.paidRounds;
  }
  function resultOf(phase, round) {
    var res = S.results || [];
    for (var i = 0; i < res.length; i++) {
      var rp = (res[i].phase == null ? 0 : res[i].phase); // legacy rows had no phase
      if (rp === phase && res[i].round === round) return res[i];
    }
    return { phase: phase, round: round, rawNet: 0, flooredNet: 0, reveals: 0, best: null };
  }
  function isPaid(phase, round) {
    var p = drawPaid();
    for (var i = 0; i < p.length; i++) if (p[i].phase === phase && p[i].round === round) return true;
    return false;
  }

  function finish() {
    S.phase = 'finish';
    // Tell the Simulation Platform this run is complete (its card shows
    // "✓ Completed"). Defined by prefill.js only on a platform launch.
    if (window.simpMarkCompleted) window.simpMarkCompleted();
    var paid = drawPaid();
    if (!S.finishedLogged) {
      var sum = 0, raw = 0, tags = [];
      for (var i = 0; i < paid.length; i++) {
        var r = resultOf(paid[i].phase, paid[i].round); sum += r.flooredNet; raw += r.rawNet;
        tags.push('p' + (paid[i].phase + 1) + 'r' + paid[i].round);
      }
      L.clearRoundContext();
      L.log('paid_rounds_drawn', { value: sum, info: 'rounds=' + tags.join(',') + ';bonusCents=' + sum + ';rawSumCents=' + raw });
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
        n.textContent = T('uploadNote');
      }
    }, 3500);
  }

  function renderFinish() {
    var paid = drawPaid();
    var bonusCents = 0;
    for (var i = 0; i < paid.length; i++) bonusCents += resultOf(paid[i].phase, paid[i].round).flooredNet;
    var bonus = (bonusCents / 100).toFixed(2);
    var multi = S.phases.length > 1;

    var rows = '';
    for (var ph = 0; ph < S.phases.length; ph++) {
      for (var r = 1; r <= N_TASKS; r++) {
        var res = resultOf(ph, r);
        var picked = isPaid(ph, r);
        rows += '<tr class="' + (picked ? 'picked' : '') + '">' +
                (multi ? '<td>' + esc(phaseLabel(S.phases[ph])) + '</td>' : '') +
                '<td>' + r + '</td><td>' + res.reveals + '</td>' +
                '<td>' + (res.best == null ? '—' : res.best + '¢') + '</td>' +
                '<td>' + res.rawNet + '¢</td>' +
                '<td>' + (picked ? esc(T('paidMark')) : '') + '</td></tr>';
      }
    }
    $('finish-body').innerHTML =
      renderProse(content('finish')) +
      '<table class="paid-table"><thead><tr>' + (multi ? '<th>' + esc(T('thPart')) + '</th>' : '') +
      '<th>' + esc(T('thRound')) + '</th><th>' + esc(T('thReveals')) + '</th><th>' + esc(T('thBest')) + '</th><th>' + esc(T('thNet')) + '</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="res-line">' + inline(T('finishBonus')) + ' <b class="res-big">$' + bonus + '</b></p>';

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
    $('btn-instructions').addEventListener('click', proceedToQuizOrRound);
    $('btn-phase-intro').addEventListener('click', proceedToQuizOrRound);
    $('btn-quiz').addEventListener('click', submitQuiz);

    $('btn-reveal').addEventListener('click', doReveal);
    $('btn-stop').addEventListener('click', openStop);
    $('btn-stop-cancel').addEventListener('click', closeStop);
    $('btn-stop-ok').addEventListener('click', confirmStop);
    $('btn-continue').addEventListener('click', nextRound);
    $('btn-compare-next').addEventListener('click', showSurvey);
    $('btn-survey-submit').addEventListener('click', submitSurvey);

    $('btn-left').addEventListener('click', function () { selectPos(S.round.selected - 1); });
    $('btn-right').addEventListener('click', function () { selectPos(S.round.selected + 1); });
    $('pos-input').addEventListener('change', function () { selectPos(parseInt(this.value, 10) || 1); });

    $('btn-dl-json').addEventListener('click', function () { L.downloadJSON(); });
    $('btn-dl-csv').addEventListener('click', function () { L.downloadCSV(); });
    $('nudge-close').addEventListener('click', hideNudge);

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

  // ======================================================================
  //  ENCOURAGEMENT / NUDGES
  //  Two sources feed one toast: (1) a client-side inactivity nudge shown when a
  //  participant makes no move for IDLE_MS during a round, and (2) a message the
  //  admin pushes to this participant from the panel (live via Firestore). Idle
  //  nudges self-dismiss; admin messages stay until closed (acked in localStorage).
  // ======================================================================
  var IDLE_MS = CFG.NUDGE_IDLE_MS || 60000;
  var idleTimer = null, nudgeHideTimer = null, pendingMsgAckKey = null, pendingMsgId = 0;
  // The encouragements are admin-editable copy (one per line; see copy.js `nudges`).
  function encouragement() {
    var list = CP.lines(CONTENT && CONTENT.nudges, 'nudges');
    if (!list.length) return '';
    return subTokens(list[Math.floor(Math.random() * list.length)]);
  }
  function nudgeShowing() { var t = $('nudge-toast'); return t && t.style.display !== 'none'; }
  function showNudge(text, kind) {
    var t = $('nudge-toast'); if (!t || !text) return;
    $('nudge-text').textContent = text;
    t.className = 'nudge-toast' + (kind === 'admin' ? ' admin' : '');
    t.setAttribute('data-kind', kind || '');
    t.style.display = 'flex';
    if (nudgeHideTimer) { clearTimeout(nudgeHideTimer); nudgeHideTimer = null; }
    if (kind !== 'admin') nudgeHideTimer = setTimeout(hideNudge, 14000);
    try { L.log('nudge_shown', { info: 'kind=' + (kind || '') }); } catch (e) {}
  }
  function hideNudge() {
    var t = $('nudge-toast'); if (!t) return;
    if (t.getAttribute('data-kind') === 'admin' && pendingMsgAckKey) {
      try { localStorage.setItem(pendingMsgAckKey, String(pendingMsgId || Date.now())); } catch (e) {}
    }
    t.style.display = 'none'; t.setAttribute('data-kind', '');
    if (nudgeHideTimer) { clearTimeout(nudgeHideTimer); nudgeHideTimer = null; }
  }
  // Reset the inactivity countdown on any deliberate move during a round.
  function bumpActivity() {
    if (!$('s-round') || !$('s-round').classList.contains('active')) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if ($('s-round').classList.contains('active') && S && S.round && !S.round.ended && !nudgeShowing()) showNudge(encouragement(), 'idle');
    }, IDLE_MS);
  }
  function stopIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    var t = $('nudge-toast'); if (t && t.getAttribute('data-kind') === 'idle') hideNudge();
  }
  // Live admin messages for this participant (configured Firestore only, not preview).
  function watchAdminMessages() {
    if (PREVIEW || !S || !S.session) return;
    if (!(window.SVFirebase && SVFirebase.isConfigured())) return;
    var ackKey = 'searchv2:msgack:' + S.session;
    SVFirebase.watchMessages(S.session, function (msg) {
      if (!msg || !msg.text) return;
      var ack = 0; try { ack = parseInt(localStorage.getItem(ackKey) || '0', 10); } catch (e) {}
      if ((msg.id || 0) > ack) { pendingMsgAckKey = ackKey; pendingMsgId = msg.id || Date.now(); showNudge(msg.text, 'admin'); }
    });
  }

  // go
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
