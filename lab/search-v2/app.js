/* ==========================================================================
   search-v2  ·  app.js
   "Search With and Without Generative AI" — the participant state machine.

   Screen flow (design brief §13):
     code entry → consent → instructions 1..5 (+ comprehension gate)
       → warm-up block 1 → [AI instructions + AI gate, if block 1 is AI-on]
       → block 1, 12 scored rounds → block transition
       → [AI instructions + AI gate, if block 2 is AI-on] → warm-up block 2
       → block 2, 12 scored rounds → exit survey → debrief → done

   Round mechanics (§7) and the AI (§3, §12) live in ai.js / specs.js / pool.js;
   this file owns the screens, the per-round secrets (in this closure only, never
   on window or in the DOM), the logging of §16 and the resume of §17.7.

   NOTHING is derived here. Every quantity in §16.8 is computed offline by
   admin/export.js from the raw rows plus the frozen pool, because a formula that
   turns out to be wrong costs a rerun of a script rather than the data.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CONFIG, L = window.Logger, Pool = window.SVPool,
      Specs = window.SVSpecs, Ai = window.SVAi, Content = window.SVContent;

  // Where the score-bearing actions are computed (backend.js). In SERVER mode
  // this app never sees a mapping at all; in LOCAL mode the backend holds it in
  // its own closure, so the truth is not a variable in this file either.
  var B = null;

  // ---- runtime -------------------------------------------------------------
  var S = null;             // persisted participant state
  var RUN = null;           // the run document (parameters + specs); null in server mode
  var PUB = null;           // the redacted, client-readable copy of the run
  var SERVER_MODE = false;  // score-bearing actions computed by Cloud Functions
  var P = null;             // resolved parameters (defaults merged)
  var CT = Content;         // resolved content; the defaults until a run is applied
  var PLAN = null;          // the participant's 28-round plan
  var SPECS = null;
  var chart = null;
  var DEBUG = false, PREVIEW = false;
  var HANDOFF = null;       // Simulation Platform launch handoff, when present
  var busy = false;         // an action is "in flight" — both buttons disabled
  var sel = 50;             // the selected position
  var unsubMsg = null;

  var LATENCY_MS = 320;     // §14: query and reveal must feel identical
  var SPEC_LOCAL = null;    // preview: the single spec being rehearsed

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) {} }
    return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function show(id) {
    var scr = document.querySelectorAll('.screen');
    for (var i = 0; i < scr.length; i++) scr[i].classList.toggle('active', scr[i].id === id);
    window.scrollTo(0, 0);
  }
  function params() {
    var p = {}, q = location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < q.length; i++) {
      if (!q[i]) continue;
      var kv = q[i].split('=');
      p[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
    }
    return p;
  }
  // Minimal prose renderer: **bold**, blank lines are paragraphs. Escaped first,
  // so admin-edited or platform-supplied text can never inject markup.
  function prose(text) {
    return String(text || '').split(/\n\s*\n/).map(function (para) {
      return '<p>' + esc(para).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function tokens(text) {
    if (!P) return text;
    return String(text || '')
      .replace(/\{J\}/g, P.env.positions)
      .replace(/\{L\}/g, P.env.stepBound)
      // The quiz explanations spell the step bound out rather than calling it L,
      // so both spellings resolve. Without this the three "differ by at most …"
      // explanations reached the participant with the token still in them.
      .replace(/\{stepBound\}/g, P.env.stepBound)
      .replace(/\{revealCost\}/g, P.costs.revealCost)
      .replace(/\{queryCost\}/g, P.costs.queryCost)
      .replace(/\{revealCap\}/g, P.costs.revealCap)
      .replace(/\{queryCap\}/g, P.costs.queryCap)
      .replace(/\{scored\}/g, P.rounds.scoredPerBlock)
      .replace(/\{warmup\}/g, P.rounds.warmupPerBlock)
      .replace(/\{K\}/g, currentK());
  }
  function currentK() {
    var r = currentRound();
    return (r && r.ai_k) ? r.ai_k : P.ai.sparseK;
  }

  // ---- persistence ---------------------------------------------------------
  function stateKey() { return 'searchv2:v3:state:' + (S && S.code ? S.code : 'anon'); }
  function save() {
    if (PREVIEW || wiped) return;
    // The moment they were last seen. It is what the NEXT boot subtracts to get
    // the length of the break, and what decides whether this browser's copy of
    // their progress or the cloud's is the more recent one.
    S.lastSeenAt = Date.now();
    try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch (e) {}
    syncParticipant();
  }
  // The resumable state, as it travels to Firestore. Everything in it is already
  // on the participant's own screen — their answers, their own queries and
  // reveals, the values they paid to see — so carrying it never tells them
  // anything the study was keeping from them. The AI's private anchors and the
  // mapping are not in S and must never be put there.
  var STATE_MAX_BYTES = 400000;   // well under Firestore's 1 MiB document limit
  function stateBlob() {
    try {
      var s = JSON.stringify(S);
      return s.length > STATE_MAX_BYTES ? null : s;
    } catch (e) { return null; }
  }
  // Just the "last seen" stamp, written straight to this browser. Used on the
  // way out, where a full save is neither possible nor needed.
  var wiped = false;   // set by logout(): nothing may be written after it
  function stampSeen() {
    if (PREVIEW || wiped || !S || !S.code) return;
    S.lastSeenAt = Date.now();
    // ONLY the timestamp, written onto whatever is stored — never this tab's
    // whole state. This runs on the way out, when another tab of the same study
    // may have gone further; rewriting S wholesale here would push that tab's
    // progress back to whatever this one happened to be holding.
    try {
      var raw = localStorage.getItem(stateKey());
      var cur = raw ? JSON.parse(raw) : null;
      if (cur && typeof cur === 'object') { cur.lastSeenAt = S.lastSeenAt; raw = JSON.stringify(cur); }
      else raw = JSON.stringify(S);
      localStorage.setItem(stateKey(), raw);
    } catch (e) {}
  }
  var syncTimer = null;
  function syncParticipant() {
    if (PREVIEW || !S || !S.runId || !window.SVFirebase || !SVFirebase.isConfigured()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      // state_json rides ALONGSIDE the session record rather than inside it:
      // sessionRecord() is also the body of the `session_end` event, and a copy
      // of the whole state in the event log would be both huge and redundant.
      var rec = sessionRecord(), blob = stateBlob();
      if (blob) rec.state_json = blob;
      SVFirebase.saveParticipant(S.runId, S.code, rec);
    }, 1500);
  }

  // ======================================================================
  //  BOOT
  // ======================================================================
  var ENTRY_KEY = 'searchv2:v3:code';

  // The Simulation Platform launch handoff (stouras.com/simulation). We read it
  // OURSELVES rather than waiting for window.SIMP_HANDOFF: /simulation/prefill.js
  // is deferred, so it runs after this script, and the participant code has to be
  // resolved during boot. Same contract, same freshness rule, same sim guard;
  // prefill.js still owns the completion marker, which is needed much later.
  var HANDOFF_KEY = 'simp:handoff:v1';
  var HANDOFF_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  function readHandoff() {
    if (window.SIMP_HANDOFF && window.SIMP_HANDOFF.profile) return window.SIMP_HANDOFF;
    var h = null;
    try { h = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch (e) { return null; }
    if (!h || !h.profile) return null;
    if ((Date.now() - (h.ts || 0)) > HANDOFF_MAX_AGE_MS) return null;
    if (window.SIMP_EXPECT && h.sim !== window.SIMP_EXPECT) return null;
    return h;
  }

  function boot() {
    var pr = params();
    DEBUG = (pr.debug === '1' && pr.key === CFG.DEBUG_KEY);
    PREVIEW = (pr.preview === '1' && DEBUG);
    HANDOFF = PREVIEW ? null : readHandoff();   // a rehearsal never consumes a real launch

    var runCode = (pr.code || '').trim().toUpperCase() || null;

    if (window.SVFirebase && SVFirebase.isConfigured() && !PREVIEW && runCode) {
      // Read both: the run document (readable only while the run is NOT in
      // server mode) and its redacted public copy (always readable). Whichever
      // arrives decides the mode, and a run that is unreachable falls back to the
      // built-in defaults rather than stranding the participant.
      SVFirebase.getRunByCode(runCode).then(function (found) {
        var id = found ? found.id : null;
        var pubP = id ? SVFirebase.getRunPublic(id) : SVFirebase.getRunPublicByCode(runCode);
        return pubP.then(function (pub) {
          applyRun(found, runCode, pub);
          afterRun(pr, runCode);
        });
      }).catch(function () { applyRun(null, runCode, null); afterRun(pr, runCode); });
    } else {
      applyRun(null, runCode, null);
      afterRun(pr, runCode);
    }
  }

  // A missing or unreachable run NEVER strands a participant: the built-in
  // defaults are the recommended parameter set, so the study runs either way and
  // the rows carry run_id = null, which the export reports honestly.
  function applyRun(run, runCode, pub) {
    RUN = run || null;
    PUB = pub || null;
    // This session's wording. Read from the same two places as the parameters
    // and for the same reason — in server mode the run document is admin-only,
    // so the redacted public copy is the only thing the participant can see.
    // With no overrides this returns the defaults of content.js unchanged.
    CT = Content.resolve((run && (run.contentJson || run.content)) || (pub && (pub.contentJson || pub.content)));
    // In server mode the run document is admin-only — it holds the seeds — so the
    // parameters come from the redacted public copy instead.
    var src = run ? run.params : (pub ? pub.params : null);
    P = Specs.withDefaults(src);
    var ops = (run && run.ops) || (pub && pub.ops);
    if (ops) Object.keys(ops).forEach(function (k) { P.ops[k] = ops[k]; });
    if (runCode) P.ops.runCode = runCode;

    // The two cost colours are RUN PARAMETERS (styling that touches a primary
    // outcome travels with the data), so they are pushed into the stylesheet
    // rather than hardcoded in it.
    if (P.ui) {
      var rootEl = document.documentElement;
      if (P.ui.costColorReveal) rootEl.style.setProperty('--cost-reveal', P.ui.costColorReveal);
      if (P.ui.costColorQuery) rootEl.style.setProperty('--cost-query', P.ui.costColorQuery);
    }

    SERVER_MODE = !!((pub && pub.serverMode) || (run && run.serverMode));

    SPECS = null;
    if (!SERVER_MODE && run && run.specsJson) {
      try { SPECS = JSON.parse(run.specsJson); } catch (e) { SPECS = null; }
    }
    B = window.SVBackend.create({
      serverMode: SERVER_MODE,
      runId: (run && run.id) || (pub && pub.id) || null,
      params: P, specs: SPECS, specSeed: (run && run.specSeed) || null
    });
    SPECS = B.specs;
  }

  function afterRun(pr, runCode) {
    // Study closed (§17b Operations: entry open / scheduled window).
    var closed = RUN && (RUN.status === 'closed' || RUN.status === 'archived');
    if (RUN && RUN.ops && RUN.ops.entryOpen === false && RUN.status !== 'open') closed = true;
    if (RUN && RUN.ops && RUN.ops.windowTo) {
      var to = Date.parse(RUN.ops.windowTo);
      if (isFinite(to) && Date.now() > to) closed = true;
    }
    if (RUN && RUN.ops && RUN.ops.windowFrom) {
      var from = Date.parse(RUN.ops.windowFrom);
      if (isFinite(from) && Date.now() < from) closed = true;
    }

    if (PREVIEW) { startPreview(pr); return; }

    var code = resolveParticipantCode(pr);
    if (!code) {
      if (closed) { show('s-closed'); return; }
      showCodeGate(pr, closed);
      return;
    }
    beginSession(pr, code, closed);
  }

  // §11: no names, no e-mail addresses, no free-text identifier. The Simulation
  // Platform already holds the student's details, so the study takes ONLY their
  // student ID — the join key between the two datasets — and nothing else.
  function resolveParticipantCode(pr) {
    var c = (pr.pcode || '').trim();
    if (!c && HANDOFF && HANDOFF.profile && HANDOFF.profile.studentId) c = String(HANDOFF.profile.studentId).trim();
    if (!c) c = (pr.PROLIFIC_PID || '').trim();
    if (!c) { try { c = (localStorage.getItem(ENTRY_KEY) || '').trim(); } catch (e) {} }
    if (!c && DEBUG) c = 'DEBUG1';
    return c ? c.toUpperCase() : null;
  }

  function showCodeGate(pr, closed) {
    var input = $('code-input'), btn = $('btn-code'), fb = $('code-feedback');
    function sync() { btn.disabled = !input.value.trim(); if (input.value.trim()) fb.style.display = 'none'; }
    function submit() {
      var c = input.value.trim().toUpperCase();
      if (!c) { fb.textContent = 'Please enter your participant code to continue.'; fb.style.display = 'block'; return; }
      beginSession(pr, c, closed);
    }
    input.value = '';
    input.addEventListener('input', sync);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    btn.addEventListener('click', submit);
    sync(); show('s-code');
    try { input.focus(); } catch (e) {}
  }

  function beginSession(pr, code, closed) {
    try { localStorage.setItem(ENTRY_KEY, code); } catch (e) {}

    var saved = readLocalState(code);
    adoptState(saved, pr, code);
    if (closed && !S.completed && S.phase === 'consent') { show('s-closed'); return; }

    // Claiming the code is what creates the roster entry, and in server mode
    // EVERY other callable refuses without one (requireOwner). So server mode
    // claims through the callable — which also assigns the sequence
    // transactionally — and client mode keeps the direct Firestore write.
    //
    // The cloud copy of their progress is read AFTER the claim, never before:
    // the claim is what binds this browser to this code, and it is that binding
    // the Rules check when a participant returns on a device whose uid has
    // never written the record.
    var afterClaim = function () { resumeFromCloud(saved, pr, code, finishBoot); };
    if (SERVER_MODE) {
      B.claimCode(code).then(function (r) {
        if (r && !r.ok && r.reason === 'notonroster') { showCodeRefused(); return; }
        if (r && r.sequence) S.sequence = r.sequence;
        if (r && r.buttonOrder) S.claimedButtonOrder = r.buttonOrder;
        afterClaim();
      }, function (err) { serverProblem(err); });
    } else if (window.SVFirebase && SVFirebase.isConfigured() && S.runId) {
      SVFirebase.claimCode(S.runId, code, P.ops.rosterMode,
                           (RUN && RUN.assign && RUN.assign.nextEntrantOverride) || 'auto',
                           (P.ui && P.ui.buttonOrder) || 'fixed')
        .then(function (r) {
          if (!r.ok && r.reason === 'notonroster') { showCodeRefused(); return; }
          if (r.sequence) S.sequence = r.sequence;
          if (r.buttonOrder) S.claimedButtonOrder = r.buttonOrder;
          afterClaim();
        }, function () { afterClaim(); });
    } else {
      afterClaim();
    }
  }

  function readLocalState(code) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('searchv2:v3:state:' + code)); } catch (e) {}
    return saved && typeof saved === 'object' ? saved : null;
  }

  // Take a saved snapshot as the session state and fill in everything the rest
  // of this file assumes. Deliberately does NOT count a resumption: it may run
  // twice in one boot (once on this browser's copy, once on a fuller copy from
  // the cloud), and a return is counted ONCE, after the choice is made.
  function adoptState(saved, pr, code) {
    S = saved || {};
    S.version = CFG.APP_VERSION;
    S.code = code;
    // In SERVER mode the run document is admin-only (it holds the seeds), so the
    // id comes from the redacted public copy. Without this S.runId stayed null,
    // which skipped the roster claim below (so no round could ever start) and
    // stamped run_id:null on every client row (so the export dropped them all).
    S.runId = (RUN && RUN.id) || (PUB && PUB.id) || S.runId || null;
    S.runCode = (RUN && RUN.code) || (pr.code || '').toUpperCase() || S.runCode || null;
    S.pid = pr.PROLIFIC_PID || (HANDOFF && HANDOFF.profile && HANDOFF.profile.studentId) || S.pid || code;
    S.study = pr.STUDY_ID || S.study || null;
    S.platformSession = (HANDOFF && HANDOFF.session) || pr.SESSION_ID || S.platformSession || null;
    if (S.startedAt == null) S.startedAt = Date.now();
    if (S.resumptions == null) S.resumptions = 0;
    if (!S.quiz) S.quiz = {};
    if (!S.survey) S.survey = {};
    if (!S.results) S.results = [];
    if (S.instrIdx == null) S.instrIdx = 0;
    if (S.aiInstrIdx == null) S.aiInstrIdx = 0;
    if (S.roundPtr == null) S.roundPtr = 0;
    if (S.totalScore == null) S.totalScore = 0;
    if (!S.phaseMs) S.phaseMs = {};
    if (!S.phase) S.phase = 'consent';

    // The interrupted round is resumed from its START and flagged for exclusion.
    // DELIBERATE: a round is one uninterrupted decision sequence, and its timings
    // are the measure — half a round played yesterday and half today is not one
    // observation. Everything else resumes exactly where it was left.
    if (S.round && S.round.open) { S.round = null; S.interruptedRounds = (S.interruptedRounds || []).concat([S.roundPtr]); }
  }

  // ---- returning participants (§17.7) --------------------------------------
  // A participant who comes back must continue from where they left off, even
  // when "back" means another browser, another device, or this one after its
  // storage was cleared. Their progress is mirrored to their participant record
  // as `state_json` on every save; this reads it back and continues from
  // whichever copy got FURTHER.
  var PHASE_ORDER = ['consent', 'registration', 'instructions', 'quiz', 'aiinstructions',
    'aiquiz', 'blockintro', 'round', 'interstitial', 'survey', 'debrief', 'done'];
  function progressOf(s) {
    if (!s) return null;
    return { done: s.completed ? 1 : 0, rounds: (s.results || []).length,
             phase: Math.max(0, PHASE_ORDER.indexOf(s.phase || 'consent')), seen: s.lastSeenAt || 0 };
  }
  // NEVER the copy that got less far. A cloud copy left behind by a sync that
  // did not land must not send a participant back through rounds they have
  // already played, and neither must a stale browser; the clock only breaks a
  // tie between two copies that are equally far along.
  function furtherAlong(a, b) {
    var pa = progressOf(a), pb = progressOf(b);
    if (!pa) return b ? 'b' : 'a';
    if (!pb) return 'a';
    var keys = ['done', 'rounds', 'phase', 'seen'];
    for (var i = 0; i < keys.length; i++) {
      if (pa[keys[i]] !== pb[keys[i]]) return pa[keys[i]] > pb[keys[i]] ? 'a' : 'b';
    }
    return 'a';
  }

  var pendingResume = null;   // logged once the logger exists, in finishBoot()
  function resumeFromCloud(local, pr, code, done) {
    var settled = false;
    function finish(chosen, src) {
      if (settled) return;
      settled = true;
      if (chosen && chosen !== local) adoptState(chosen, pr, code);
      noteResumption(chosen, src);
      done();
    }
    // `getParticipant` is checked by name, not assumed: a browser holding a
    // cached older svfirebase.js must fall back to its own copy of the progress,
    // not die on the way into the study.
    if (PREVIEW || !S.runId || !window.SVFirebase || !SVFirebase.isConfigured()
        || typeof SVFirebase.getParticipant !== 'function') return finish(local, 'local');
    show('s-loading');
    // A slow or unreachable network must never strand a returning participant on
    // a spinner: past this, they continue from whatever this browser holds.
    setTimeout(function () { finish(local, 'local'); }, CFG.RESUME_FETCH_MS);
    SVFirebase.getParticipant(S.runId, code).then(function (doc) {
      var remote = null;
      if (doc && doc.state_json) { try { remote = JSON.parse(doc.state_json); } catch (e) {} }
      if (remote && !remote.code) remote.code = code;
      if (!remote) return finish(local, 'local');
      finish.apply(null, furtherAlong(local, remote) === 'a' ? [local, 'local'] : [remote, 'cloud']);
    }, function () { finish(local, 'local'); });
  }

  // One return = one resumption. The gap since they were last seen is the raw
  // observation; a gap of at least CFG.BREAK_MIN_MS is a break BETWEEN SITTINGS
  // rather than a reload, and only those are summed.
  var BREAK_LOG_CAP = 100;
  function noteResumption(saved, src) {
    if (!saved) return;                       // a first sitting is not a return
    var last = saved.lastSeenAt || 0;
    var gap = last ? Math.max(0, Date.now() - last) : null;
    S.resumptions = (S.resumptions || 0) + 1;
    S.resumedFrom = src;
    var isBreak = gap != null && gap >= CFG.BREAK_MIN_MS;
    if (gap != null) {
      S.breaks = (S.breaks || []).concat([{ t: Date.now(), ms: gap, src: src }]).slice(-BREAK_LOG_CAP);
      if (isBreak) {
        S.breakMs = (S.breakMs || 0) + gap;
        S.breaksCount = (S.breaksCount || 0) + 1;
        S.longestSittingBreakMs = Math.max(S.longestSittingBreakMs || 0, gap);
      }
    }
    pendingResume = {
      duration_ms: gap, source: src,
      info: JSON.stringify({ break_ms: gap, is_break: isBreak, source: src,
        resumption: S.resumptions, sittings: 1 + (S.breaksCount || 0),
        phase: S.phase, rounds_done: (S.results || []).length })
    };
  }

  function showCodeRefused() {
    var fb = $('code-feedback');
    show('s-code');
    if (fb) {
      fb.textContent = 'That code is not on this study’s participant list. Please check it and try again.';
      fb.style.display = 'block';
    }
    try { localStorage.removeItem(ENTRY_KEY); } catch (e) {}
  }

  function finishBoot() {
    // Sequence (§11). Persisted the moment it is decided — a participant is never
    // re-randomised mid-study, and the assignment travels with every row.
    if (S.sequence !== 'A' && S.sequence !== 'B') {
      var ov = (P.assign && P.assign.nextEntrantOverride) || 'auto';
      S.sequence = (ov === 'A' || ov === 'B') ? ov
        : (Pool.hashSeed('seq:' + (S.runId || '') + ':' + S.code) % 2 ? 'B' : 'A');
    }
    // Which paid action sits on the left, decided with the sequence and fixed
    // for the session. The server hands it back from the enrolment counter, so
    // the four cells of sequence × order stay balanced; a client-mode run falls
    // back to a hash of the code.
    S.buttonOrder = assignButtonOrder(S.claimedButtonOrder);
    PLAN = { rounds: B.plan(S.code, S.sequence) };
    if (B.mode === 'local') {
      var ord = Specs.orderForParticipant(SPECS, S.code, P);
      S.shuffleSeed = ord.shuffleSeed;
      S.roundOrder = ord.order;
    }

    var ua = L.uaFamilies(navigator.userAgent);
    L.init({
      run_id: S.runId, participant_code: S.code, pid: S.pid,
      session: S.code, sessionCode: S.runCode, sessionName: (RUN && RUN.name) || null,
      sequence: S.sequence, button_order: S.buttonOrder, appVersion: CFG.APP_VERSION,
      ua_browser: ua.browser, ua_os: ua.os,
      vw: window.innerWidth, vh: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      tz_offset: -new Date().getTimezoneOffset()
    });
    startEventSync();
    wireGlobal();
    startHeartbeat();
    watchMessages();

    if (DEBUG) {
      $('nav-tag').textContent = (PREVIEW ? 'PREVIEW · ' : '') + 'seq ' + S.sequence +
        ' · ' + S.code + (S.runCode ? ' · ' + S.runCode : '');
      $('nav-tag').style.display = '';
    }
    var lo = $('btn-logout'); if (lo && !PREVIEW) { lo.style.display = ''; lo.onclick = logout; }

    // The return itself is a row: how long they were away, and whether their
    // progress came from this browser or from the cloud copy. Logged here
    // because the logger does not exist until L.init above.
    if (pendingResume) { L.log('resume', pendingResume); pendingResume = null; }

    if (!S.startLogged) {
      S.startLogged = true;
      L.log('session_start', {
        info: JSON.stringify({
          sequence: S.sequence, buttonOrder: S.buttonOrder, shuffleSeed: S.shuffleSeed,
          roundOrder: (S.roundOrder || []).map(function (b) { return b.block + ':' + b.specIds.join(','); }).join(' | '),
          platform: HANDOFF ? { sim: HANDOFF.sim, session: HANDOFF.session } : null,
          runCode: S.runCode
        })
      });
    }
    save();

    // A session that started under the previous build has no registration
    // phase in its saved state — catch it up before routing (see the note on
    // registrationCatchUp).
    if (S.phase !== 'consent') registrationCatchUp();

    // §16.1: enforce a minimum viewport, then log the width anyway.
    if (!viewportOk()) { renderViewportBlock(); return; }
    route();
  }

  function viewportOk() {
    var min = (P.ops && P.ops.minViewport) || 0;
    return !min || window.innerWidth >= min || DEBUG;
  }
  function renderViewportBlock() {
    $('vp-min').textContent = P.ops.minViewport;
    $('vp-now').textContent = window.innerWidth;
    show('s-viewport');
  }

  function startEventSync() {
    if (PREVIEW || !(window.SVFirebase && SVFirebase.isConfigured())) return;
    var key = 'searchv2:v3:synced:' + S.code;
    // The watermark is CONTIGUOUS, not a maximum. Rows are written concurrently,
    // so a row that fails while a later one succeeds used to be jumped over and
    // never retried — the backfill on the next load starts at watermark+1. Acked
    // sequence numbers are therefore held until the run below them is complete.
    var acked = {}, failed = {};
    function readMark() { try { return parseInt(localStorage.getItem(key) || '-1', 10); } catch (e) { return -1; } }
    function mark(seq) {
      acked[seq] = 1;
      delete failed[seq];
      var cur = readMark();
      while (acked[cur + 1]) { cur++; delete acked[cur]; }
      try { localStorage.setItem(key, String(cur)); } catch (e) {}
    }
    function send(ev, seq) {
      return SVFirebase.writeEvent(ev, seq).then(function (okWrite) {
        if (okWrite) mark(seq); else failed[seq] = ev;
      }, function () { failed[seq] = ev; });
    }
    L.onEvent(send);
    // Retry within the session too. Without this, every write that failed while
    // the connection was down survived only until the tab closed — and for the
    // last participant of the day, that is the end of the study.
    setInterval(function () {
      var pending = Object.keys(failed);
      for (var j = 0; j < pending.length && j < 40; j++) {
        var sq = +pending[j], row = failed[sq];
        delete failed[sq];
        send(row, sq);
      }
    }, 20000);
    SVFirebase.signInAnon().then(function () {
      var evs = L.getEvents();
      for (var i = readMark() + 1; i < evs.length; i++) send(evs[i], i);
    }).catch(function () {});
  }

  function logout() {
    if (!confirm('Log out and clear this study on this device? Your progress on this device will be erased.')) return;
    // Stop the logger FIRST. Its pagehide flush fires during the navigation
    // below, and would otherwise write the event mirror straight back into the
    // storage this function has just cleared. The same is true of THIS file's
    // own pagehide stamp, which is what `wiped` silences — logout promises to
    // erase every trace on the device, and a stamp written a millisecond later
    // would put the state key straight back.
    wiped = true;
    L.stop();
    if (unsubMsg) { try { unsubMsg(); } catch (e) {} unsubMsg = null; }
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('searchv2:') === 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    location.href = location.pathname;
  }

  // ======================================================================
  //  ROUTER
  // ======================================================================
  function route() {
    L.setBase({ phase: S.phase });
    switch (S.phase) {
      case 'consent': return showConsent();
      case 'registration': return showRegistration();
      case 'instructions': return showInstructions();
      case 'quiz': return showQuiz();
      case 'aiinstructions': return showAiInstructions();
      case 'aiquiz': return showAiQuiz();
      case 'blockintro': return showBlockIntro();
      case 'round': return startRound();
      // A reload lands here when the browser closed on the between-rounds screen.
      // The round's mapping lives in a closure that a reload wipes, so it has to
      // be put back before the screen can redraw the round it is reporting on.
      case 'interstitial':
        if (!restoreRoundContext()) { return nextRound(); }
        return showInterstitial(S.lastResult);
      case 'survey': return showSurvey();
      case 'debrief': return showDebrief();
      case 'done': return showDone();
      default: return showConsent();
    }
  }
  // Put back the closure-only secrets for the round S.roundPtr points at, so a
  // resumed screen can redraw. Returns false when there is nothing to restore.
  function restoreRoundContext() {
    var r = currentRound();
    if (!r || !S.lastResult || !S.round) return false;
    if (!chart) {
      chart = window.SVChart.create($('plot'), {
        positions: P.env.positions,
        onSelect: function (p, via) { setSel(p, via || 'click'); }
      });
    }
    return true;
  }
  function goto(phase) {
    stampPhase();
    S.phase = phase;
    L.setBase({ phase: phase });
    save();
    route();
  }

  // Active-time accounting per phase (§16.1). `active_ms` comes from heartbeats,
  // so a participant who walks away for twenty minutes never looks like one who
  // spent twenty minutes thinking.
  var phaseSince = Date.now();
  function stampPhase() {
    var now = Date.now(), key = S.phase || 'other';
    S.phaseMs[key] = (S.phaseMs[key] || 0) + Math.max(0, now - phaseSince);
    phaseSince = now;
  }

  // ======================================================================
  //  CONSENT · INSTRUCTIONS · COMPREHENSION
  // ======================================================================
  function showConsent() {
    $('consent-body').innerHTML = prose(tokens(CT.CONSENT));
    var box = $('consent-box'), btn = $('btn-consent');
    box.checked = false; btn.disabled = true;
    box.onchange = function () { btn.disabled = !box.checked; };
    btn.onclick = function () { L.log('consent', { answer: 'agree' }); goto('registration'); };
    show('s-consent');
  }

  // ======================================================================
  //  REGISTRATION — who the participant is, asked ONCE, before the study
  // ======================================================================
  // The background block that used to be the exit survey's Part F. On a
  // Simulation Platform launch every item it can answer comes FROM THE
  // PLATFORM's own registration — those items are not shown, they are logged
  // as `platform_<key>` rows, and when nothing is left to ask the phase passes
  // through without a screen. A standalone participant answers here.
  function platformBackground() {
    var out = {};
    if (!HANDOFF || !HANDOFF.profile) return out;
    CT.PLATFORM_BACKGROUND.forEach(function (k) {
      if (HANDOFF.profile[k]) out[k] = String(HANDOFF.profile[k]);
    });
    return out;
  }
  function registrationItems() {
    var have = platformBackground();
    return CT.REGISTRATION.filter(function (q) {
      // Asked on the platform → never asked again: the two datasets must carry
      // ONE answer each, joined on the student ID, not two that can disagree.
      return !(q.platformKey && have[q.platformKey]);
    });
  }
  // Write the platform's answers to the log once, whether or not a screen was
  // shown, so a silently-registered participant is as fully described as one
  // who typed everything.
  function logPlatformBackground() {
    var bg = platformBackground();
    Object.keys(bg).forEach(function (k) {
      L.log('registration', { question_id: 'platform_' + k, answer: String(bg[k]).slice(0, 400), source: 'platform' });
    });
  }
  // MIGRATION. This phase did not exist until 2026-08; the same four items were
  // the exit survey's Part F, which is now gone. A participant who consented
  // under the previous build and is resumed under this one would therefore be
  // asked NOTHING and export a blank background — and that is precisely the
  // class playing when this deploys. Two catch-ups, decided at boot:
  //   · before the task (instructions, either gate, a block intro) they are
  //     simply routed into the phase — they have not started yet;
  //   · once they are in the rounds, interrupting the task would be worse than
  //     the old behaviour, so the items are appended to the exit survey they
  //     were always going to see. Either way the answers land in the same
  //     `registration` rows and the same reg_* columns.
  var PRE_TASK_PHASES = ['instructions', 'quiz', 'aiinstructions', 'aiquiz', 'blockintro'];
  function registrationCatchUp() {
    if (S.regDone) return;
    // The platform's own answers must reach the log whatever phase they are in
    // — that data exists already and losing it is pure waste.
    if (!S.regLogged) { S.regLogged = true; logPlatformBackground(); save(); }
    if (!registrationItems().length) { S.regDone = true; save(); return; }
    if (PRE_TASK_PHASES.indexOf(S.phase) >= 0) { S.phase = 'registration'; save(); }
  }
  function showRegistration() {
    var items = registrationItems();
    S.reg = S.reg || {};
    if (!S.regLogged) { S.regLogged = true; logPlatformBackground(); save(); }
    // Nothing this study asks that the platform has not already answered — do
    // not show an empty form, just carry on into the instructions.
    if (!items.length) { S.regDone = true; save(); goto('instructions'); return; }

    var host = $('reg-body'), html = [];
    html.push('<p class="muted small">Every question here is optional — leave any of them blank.</p>');
    items.forEach(function (q, i) {
      html.push('<div class="survey-q" data-q="' + esc(q.id) + '">');
      html.push('<div class="sq-prompt">' + (i + 1) + '. ' + esc(tokens(q.prompt)) +
        ' <span class="muted small">(optional)</span></div>');
      html.push('<div class="sq-opts">' + q.options.map(function (o, oi) {
        return '<label class="quiz-opt"><input type="radio" name="' + esc(q.id) + '" value="' + oi + '"><span>' + esc(o) + '</span></label>';
      }).join('') + '</div>');
      html.push('</div>');
    });
    host.innerHTML = html.join('');
    // A reload inside the phase must not lose what was already ticked — which
    // means each answer is saved as it is given, not only at submit.
    items.forEach(function (q) {
      var prev = S.reg[q.id];
      if (prev != null && prev !== '') {
        var oi = q.options.indexOf(prev);
        var el = oi >= 0 && host.querySelector('input[name="' + q.id + '"][value="' + oi + '"]');
        if (el) el.checked = true;
      }
      var group = host.querySelectorAll('input[name="' + q.id + '"]');
      Array.prototype.forEach.call(group, function (input) {
        input.onchange = function () { S.reg[q.id] = q.options[+input.value]; save(); };
      });
    });
    $('btn-reg').onclick = function () { submitRegistration(items); };
    show('s-registration');
  }
  function submitRegistration(items) {
    var host = $('reg-body');
    items.forEach(function (q) {
      var sel = host.querySelector('input[name="' + q.id + '"]:checked');
      S.reg[q.id] = sel ? q.options[+sel.value] : '';
    });
    S.regDone = true;
    save();
    // NOT L.setContext: that sets the ROUND context, which persists until it is
    // cleared, and everything logged afterwards — the comprehension answers,
    // the first rounds — would have carried phase 'registration'. goto() has
    // already put the phase on the base fields.
    items.forEach(function (q) {
      L.log('registration', { question_id: q.id, answer: String(S.reg[q.id] || ''), source: 'participant' });
    });
    goto('instructions');
  }

  function showInstructions() {
    var pages = CT.INSTRUCTIONS;
    var i = Math.max(0, Math.min(pages.length - 1, S.instrIdx || 0));
    S.instrIdx = i;
    $('instr-step').textContent = 'Instructions ' + (i + 1) + ' of ' + pages.length;
    $('instr-title').textContent = pages[i].title;
    $('instr-body').innerHTML = prose(tokens(pages[i].body));
    $('btn-instr-back').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('btn-instr-next').textContent = (i === pages.length - 1) ? 'Continue to a quick check' : 'Next';
    $('btn-instr-back').onclick = function () { S.instrIdx = i - 1; save(); showInstructions(); };
    $('btn-instr-next').onclick = function () {
      if (i === pages.length - 1) { goto('quiz'); return; }
      S.instrIdx = i + 1; save(); showInstructions();
    };
    show('s-instructions');
  }

  // One comprehension screen, reusable for the base gate and the AI gate.
  // Attempts, time to the first answer and first-answer correctness are logged
  // per question (§16.6); only questions marked `strict` block progression.
  // Everything a participant needs to ANSWER the questions, on the same screen as
  // the questions. They read the instructions once, several screens ago; asking
  // them to recall a number they saw in passing tests memory, not comprehension.
  function quizReminder(withAi) {
    var li = [];
    li.push('Neighbouring positions differ by at most <b>' + P.env.stepBound + '</b> points.');
    li.push('<b>Revealing</b> a position costs <b>' + P.costs.revealCost + '</b> and shows its true prize.');
    if (withAi) {
      li.push('<b>Asking the AI</b> about a position costs <b>' + P.costs.queryCost + '</b> and returns its estimate. ' +
        'That number is <b>not a prize</b> — it can be wrong.');
      li.push('The AI knows a few positions <b>exactly</b> and interpolates between them. Beyond the outermost ' +
        'position it knows, it repeats that value. You are never told which positions it knows.');
      li.push('Every answer looks and arrives the same way, whether it was known or guessed.');
    }
    li.push('<b>Stopping</b> is free. Your score is the <b>true prize where you stop, minus everything you spent</b> ' +
      'that round — which can be negative.');
    li.push('Prizes are drawn <b>afresh every round</b>.');
    return '<h4>What you need to answer these</h4><ul><li>' + li.join('</li><li>') + '</li></ul>';
  }

  function renderQuiz(qs, hostId, feedbackId, btnId, onDone) {
    var host = $(hostId), started = Date.now();
    var rem = $(hostId === 'aiquiz-body' ? 'aiquiz-reminder' : 'quiz-reminder');
    if (rem) rem.innerHTML = quizReminder(hostId === 'aiquiz-body');
    host.innerHTML = qs.map(function (q, qi) {
      return '<div class="quiz-q" data-q="' + esc(q.id) + '">' +
        '<div class="q-prompt">' + (qi + 1) + '. ' + esc(tokens(q.prompt)) + '</div>' +
        q.options.map(function (o, oi) {
          return '<label class="quiz-opt"><input type="radio" name="' + esc(q.id) + '" value="' + oi + '"><span>' + esc(tokens(o)) + '</span></label>';
        }).join('') +
        '<div class="q-fb" style="display:none;"></div>' +
        '</div>';
    }).join('');
    $(feedbackId).style.display = 'none';

    $(btnId).onclick = function () {
      var allStrictOk = true, anyWrong = false, unanswered = 0;
      // Every question must be ANSWERED before anyone moves on — leaving one
      // blank is not the same as getting it wrong, and an unanswered question
      // records no attempt, which would silently hollow out §16.6.
      qs.forEach(function (q) {
        if (!host.querySelector('input[name="' + q.id + '"]:checked')) unanswered++;
      });
      if (unanswered) {
        $(feedbackId).textContent = 'Please answer ' + (unanswered === qs.length ? 'the questions' :
          (unanswered === 1 ? 'the remaining question' : 'the ' + unanswered + ' remaining questions')) + ' before continuing.';
        $(feedbackId).style.display = 'block';
        var firstBlank = qs.filter(function (q) { return !host.querySelector('input[name="' + q.id + '"]:checked'); })[0];
        var el = firstBlank && host.querySelector('.quiz-q[data-q="' + firstBlank.id + '"]');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      qs.forEach(function (q) {
        var picked = host.querySelector('input[name="' + q.id + '"]:checked');
        var rec = S.quiz[q.id] || { attempts: 0, firstCorrect: null, msToFirst: null };
        if (!picked) { anyWrong = true; if (q.strict) allStrictOk = false; return; }
        var ok = (+picked.value === q.answer);
        rec.attempts++;
        if (rec.firstCorrect === null) { rec.firstCorrect = ok; rec.msToFirst = Date.now() - started; }
        rec.last = +picked.value;
        rec.correct = ok;
        S.quiz[q.id] = rec;
        L.log('comprehension', {
          question_id: q.id, attempts: rec.attempts, ms_to_first_answer: rec.msToFirst,
          first_answer_correct: rec.firstCorrect, answer: +picked.value, correct: ok
        });
        if (!ok) { anyWrong = true; if (q.strict) allStrictOk = false; }
        var fb = host.querySelector('.quiz-q[data-q="' + q.id + '"] .q-fb');
        if (fb) {
          // EVERY answered question says whether it was right. A correct one also
          // carries the reason — the point of the gate is that the rule is
          // understood, and a tick with no explanation teaches nothing.
          fb.style.display = 'block';
          fb.className = 'q-fb feedback ' + (ok ? 'good' : 'bad');
          fb.innerHTML = ok
            ? '<b>✓ Correct.</b> ' + esc(tokens(q.why || ''))
            : esc(q.strict
              ? 'Not quite — this one has to be right before you can continue. Re-read the reminder above.'
              : 'Not quite. The correct answer is: ' + tokens(q.options[q.answer]));
        }
      });
      save();
      // The strict gate (question 2 of §15) must pass. Everything else records
      // attempts and lets the participant through — a repeated failure there is a
      // covariate, and possibly a finding, not a nuisance.
      var strictMode = (P.ops.gateQ2 === 'strict');
      if (strictMode && !allStrictOk) {
        $(feedbackId).textContent = 'One answer still needs correcting before you can continue.';
        $(feedbackId).style.display = 'block';
        return;
      }
      if (anyWrong && P.ops.gateOther === 'block') {
        $(feedbackId).textContent = 'Please correct the highlighted answers.';
        $(feedbackId).style.display = 'block';
        return;
      }
      onDone();
    };
  }

  function showQuiz() {
    renderQuiz(CT.QUIZ_BASE, 'quiz-body', 'quiz-feedback', 'btn-quiz', function () { goto('blockintro'); });
    show('s-quiz');
  }

  function showAiInstructions() {
    var pages = CT.AI_INSTRUCTIONS;
    var i = Math.max(0, Math.min(pages.length - 1, S.aiInstrIdx || 0));
    S.aiInstrIdx = i;
    $('ai-step').textContent = 'About the AI · ' + (i + 1) + ' of ' + pages.length;
    $('ai-title').textContent = pages[i].title;
    $('ai-body').innerHTML = prose(tokens(pages[i].body));
    $('btn-ai-back').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('btn-ai-next').textContent = (i === pages.length - 1) ? 'Continue to a quick check' : 'Next';
    $('btn-ai-back').onclick = function () { S.aiInstrIdx = i - 1; save(); showAiInstructions(); };
    $('btn-ai-next').onclick = function () {
      if (i === pages.length - 1) { goto('aiquiz'); return; }
      S.aiInstrIdx = i + 1; save(); showAiInstructions();
    };
    show('s-aiinstructions');
  }

  function showAiQuiz() {
    renderQuiz(CT.QUIZ_AI, 'aiquiz-body', 'aiquiz-feedback', 'btn-aiquiz', function () {
      S.aiGateDone = true; save();
      goto('blockintro');
    });
    show('s-aiquiz');
  }

  // ======================================================================
  //  ROUND PLAN NAVIGATION
  // ======================================================================
  function currentRound() { return (PLAN && PLAN.rounds[S.roundPtr]) || null; }

  // The screen that sits before each round group: the warm-up announcement, the
  // block transition, and the point at which the AI appears or is taken away.
  function showBlockIntro() {
    var r = currentRound();
    if (!r) { goto(P.ops.exitSurvey ? 'survey' : (P.ops.debrief ? 'debrief' : 'done')); return; }

    // The AI gate is shown once, immediately before the first AI-on round.
    if (r.condition === 'AI_ON' && !S.aiGateDone) { goto('aiinstructions'); return; }

    var prev = PLAN.rounds[S.roundPtr - 1];
    var title, body;
    if (!prev) {
      title = 'Practice first';
      body = 'The next ' + P.rounds.warmupPerBlock + ' rounds are **practice**. They do not count towards anything — they are there so the screen is familiar before the scored rounds start.' +
        (r.condition === 'AI_ON' ? '\n\nThe AI is available in these rounds too.' : '');
    } else if (prev.block !== r.block) {
      title = 'Halfway — the second part';
      body = (r.condition === 'AI_ON'
        ? '**From here on you can also ask the AI.** Everything else about the game is exactly the same.'
        : '**From here on the AI is no longer available.** Everything else about the game is exactly the same.') +
        '\n\nThe next ' + P.rounds.warmupPerBlock + ' rounds are practice again, then ' + P.rounds.scoredPerBlock + ' scored rounds.';
    } else if (prev.scored === false && r.scored === true) {
      title = 'Practice over — the scored rounds start now';
      body = 'The next ' + P.rounds.scoredPerBlock + ' rounds count.' +
        (r.condition === 'AI_ON' ? ' The AI is available throughout.' : ' There is no AI in this part.');
    } else {
      // Nothing to announce — go straight in.
      goto('round'); return;
    }
    $('bi-title').textContent = title;
    $('bi-body').innerHTML = prose(tokens(body));
    $('btn-bi').onclick = function () { goto('round'); };
    show('s-blockintro');
  }

  // ======================================================================
  //  THE ROUND (§7, §14)
  // ======================================================================
  function startRound() {
    var r = currentRound();
    if (!r) { goto(P.ops.exitSurvey ? 'survey' : (P.ops.debrief ? 'debrief' : 'done')); return; }
    show('s-loading');
    B.startRound(S.code, S.sequence, r.round_index).then(function (d) {
      // The descriptor the backend hands back is the ONLY thing this file learns
      // about the round: which spec it is, the pre-opened positions AND THEIR
      // VALUES (the participant can see those anyway), and how many positions the
      // AI knows. Never the mapping, never the anchors.
      r.spec_id = d.spec_id;
      r.condition = d.condition || r.condition;
      r.scored = (d.scored != null) ? d.scored : r.scored;
      r.seed_shape = d.seed_shape;
      r.ai_density = d.ai_density;
      r.ai_k = d.ai_k;
      S.round = {
        open: true,
        startedAt: Date.now(),
        preOpened: d.pre_opened || [],
        queries: [], reveals: [],
        decisionIdx: 0,
        sliderMoves: 0, movesSinceAction: 0, lastSliderT: null,
        instrReopens: 0, blurEvents: 0, blurMs: 0,
        lastActionAt: Date.now(),
        capHit: null
      };
      sel = Math.round((P.env.positions + 1) / 2);
      L.resetActionClock();
      L.setContext({
        block: r.block, condition: r.condition, scored: r.scored,
        round_index: r.round_index, spec_id: d.spec_id,
        seed_shape: d.seed_shape, ai_density: d.ai_density, phase: 'round'
      });
      L.log('round_start', {
        info: JSON.stringify({
          pre_opened: (d.pre_opened || []).map(function (x) { return x.pos; }),
          ai_k: d.ai_k, mode: B.mode,
          interrupted: !!d.interrupted || (S.interruptedRounds || []).indexOf(S.roundPtr) >= 0
        })
      });
      save();
      buildRoundUI();
      renderRound();
      show('s-round');
      armNudges();
      maybeMilestone();
    }, serverProblem);
  }

  // A server-mode failure is NEVER downgraded to computing locally: that would
  // silently void the integrity property the run was configured for, and would
  // put two kinds of row into one dataset. The participant is told instead.
  function serverProblem(err) {
    var msg = String((err && err.message) || err || '');
    L.log('server_error', { info: msg.slice(0, 500) });
    $('closed-title').textContent = 'We could not reach the study server';
    $('closed-body').innerHTML =
      '<p class="muted">Your progress is saved. Please check your connection and reload this page — ' +
      'you will pick up where you left off.</p>' +
      '<p class="muted small">If it keeps happening, tell the person running the session.</p>' +
      '<div style="margin-top:14px;"><button class="btn btn-green" onclick="location.reload()">Try again</button></div>';
    show('s-closed');
  }

  function preOpenedPairs() { return (S.round && S.round.preOpened) || []; }
  function revealedPairs() { return S.round.reveals.map(function (x) { return { pos: x.pos, val: x.val }; }); }
  function knownPairs() { return preOpenedPairs().concat(revealedPairs()).sort(function (a, b) { return a.pos - b.pos; }); }
  function askedPairs() {
    // One marker per asked position: the LATEST answer, since a re-query after a
    // reveal is a different claim about the same place.
    var byPos = {};
    S.round.queries.forEach(function (q) { byPos[q.pos] = q.val; });
    return Object.keys(byPos).map(function (p) { return { pos: +p, val: byPos[p] }; })
      .sort(function (a, b) { return a.pos - b.pos; });
  }
  function isRevealed(p) {
    var pre = preOpenedPairs();
    for (var j = 0; j < pre.length; j++) if (pre[j].pos === p) return true;
    for (var i = 0; i < S.round.reveals.length; i++) if (S.round.reveals[i].pos === p) return true;
    return false;
  }
  function wasQueried(p) {
    for (var i = 0; i < S.round.queries.length; i++) if (S.round.queries[i].pos === p) return true;
    return false;
  }
  function bestTrueKnown() {
    var k = knownPairs(), b = null;
    for (var i = 0; i < k.length; i++) if (b === null || k[i].val > b) b = k[i].val;
    return b;
  }
  function bestEstimate() {
    var b = bestTrueKnown();
    askedPairs().forEach(function (q) { if (b === null || q.val > b) b = q.val; });
    return b;
  }
  function spend() {
    return S.round.queries.length * P.costs.queryCost + S.round.reveals.length * P.costs.revealCost;
  }

  // How far through this half the participant is. PROGRESS, not performance:
  // the bar counts rounds played and the text counts rounds left, so a
  // participant always knows how much is in front of them — which is what
  // makes the last third of a 40-minute task survivable — without anything
  // about their score feeding back into how they play.
  function renderProgress(r) {
    var box = $('prog'), fill = $('prog-fill'), txt = $('prog-txt');
    if (!box || !fill || !txt) return;
    var E = CT.ENCOURAGE;
    if (!r.scored) {
      box.className = 'prog warm';
      fill.style.width = '0%';
      txt.textContent = E.progressWarmup;
      return;
    }
    var total = P.rounds.scoredPerBlock, n = 0;
    for (var i = 0; i <= S.roundPtr && i < PLAN.rounds.length; i++) {
      if (PLAN.rounds[i].scored && PLAN.rounds[i].block === r.block) n++;
    }
    box.className = 'prog';
    fill.style.width = Math.round(100 * (n - 1) / Math.max(1, total)) + '%';
    txt.textContent = E.progress.replace('{n}', n).replace('{total}', total).replace('{left}', total - n);
  }

  // ---- which paid action sits on the LEFT ---------------------------------
  // Assigned ONCE per participant and fixed for the whole session
  // (config.ui.buttonOrder — the reasoning, including why it is deliberately
  // NOT redrawn per round or per decision, is in that file). It is stamped on
  // every logged row through the logger's base fields, so it reaches the
  // participant record and every decision as a covariate.
  function assignButtonOrder(fromServer) {
    if (fromServer === 'ask_first' || fromServer === 'reveal_first') return fromServer;
    if (S.buttonOrder === 'ask_first' || S.buttonOrder === 'reveal_first') return S.buttonOrder;
    return Specs.buttonOrder(P, S.code);      // client-mode fallback
  }
  // The Ask panel is REMOVED from the DOM in an AI-off round, not hidden: the
  // brief requires the AI to be absent there, and a hidden node is still in the
  // accessibility tree, still tabbable in some engines, and still findable by
  // anyone who opens the inspector.
  var askPanel = null;
  function applyActionOrder() {
    var pair = $('act-pair'), ask = $('ask-panel') || askPanel, rev = $('reveal-panel');
    if (!pair || !rev) return;
    var r = currentRound();
    var aiOn = !!(r && r.condition === 'AI_ON');
    if (ask) askPanel = ask;
    if (!aiOn) {
      if (askPanel && askPanel.parentNode) askPanel.parentNode.removeChild(askPanel);
      return;
    }
    if (askPanel && !askPanel.parentNode) pair.appendChild(askPanel);
    if (!askPanel) return;
    // Tab order follows visual order, so the DOM order IS the visual order —
    // no CSS `order`, which would leave the two out of step for the keyboard.
    var wantRevealFirst = (S.buttonOrder === 'reveal_first');
    var isRevealFirst = !!(rev.compareDocumentPosition(askPanel) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (wantRevealFirst !== isRevealFirst) {
      if (wantRevealFirst) pair.insertBefore(rev, askPanel); else pair.insertBefore(askPanel, rev);
    }
  }

  function buildRoundUI() {
    var r = currentRound();
    var aiOn = (r.condition === 'AI_ON');

    $('round-label').textContent = (r.scored ? 'Round ' + scoredOrdinal(r) : 'Practice round') +
      ' · Part ' + r.block + (r.scored ? '' : ' (not scored)');
    $('round-sub').textContent = aiOn
      ? 'The AI knows ' + currentK() + ' of the ' + P.env.positions + ' positions exactly, and will answer about any position you ask.'
      : 'No AI in this part.';
    $('round-sub').className = 'round-sub' + (aiOn ? ' ai' : '');
    renderProgress(r);

    // §14 right panel: Ask the AI (present only in AI-on rounds — absent, not
    // disabled), Reveal, and Stop and nominate, whose label names the position.
    // The prices come from the RUN CONFIGURATION — the same numbers the backend
    // charges — never from a literal in the markup.
    applyActionOrder();
    if (aiOn && $('ask-cost')) $('ask-cost').textContent = '\u2212' + P.costs.queryCost + ' points';
    $('reveal-cost').textContent = '\u2212' + P.costs.revealCost + ' points';

    if (!chart) {
      chart = window.SVChart.create($('plot'), {
        positions: P.env.positions,
        onSelect: function (p, via) { setSel(p, via || 'click'); }
      });
    }
    $('legend').innerHTML =
      '<span class="lg"><i class="sw pre"></i> open at the start (true prize)</span>' +
      '<span class="lg"><i class="sw rev"></i> you revealed (true prize)</span>' +
      (aiOn ? '<span class="lg"><i class="sw ask"></i> the AI’s answer (may be wrong)</span>' : '');

    var slider = $('pos-slider');
    slider.min = 1; slider.max = P.env.positions; slider.value = sel;
    slider.oninput = function () { setSel(+slider.value, 'drag'); };
    slider.onchange = function () { logSlider(+slider.value, 'release'); };
    slider.onkeydown = function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // The browser moves the thumb; flag the source so the trace can tell
        // keyboard scanning apart from dragging.
        sliderVia = 'arrow';
      }
    };
    $('btn-pos-left').onclick = function () { setSel(sel - 1, 'arrow'); };
    $('btn-pos-right').onclick = function () { setSel(sel + 1, 'arrow'); };
    var num = $('pos-input');
    num.min = 1; num.max = P.env.positions; num.value = sel;
    num.oninput = function () {
      var v = parseInt(num.value, 10);
      if (isFinite(v)) setSel(v, 'click');
    };

    // The Ask button does not exist in an AI-off round (it is removed from the
    // DOM, not hidden), so everything that touches it is guarded.
    if ($('btn-ask')) $('btn-ask').onclick = doAsk;
    $('btn-reveal').onclick = doReveal;
    $('btn-nominate').onclick = openNominate;
    $('btn-instr-open').onclick = openSummary;

    // The testing overlays need the truth, so they exist only in LOCAL mode —
    // which is what the admin sandbox always runs in.
    $('testview').style.display = (DEBUG && B.canSeeTruth) ? '' : 'none';
    if (DEBUG && B.canSeeTruth) buildTestView();
  }

  function scoredOrdinal(r) {
    var n = 0;
    for (var i = 0; i <= S.roundPtr && i < PLAN.rounds.length; i++) if (PLAN.rounds[i].scored && PLAN.rounds[i].block === r.block) n++;
    return n + ' of ' + P.rounds.scoredPerBlock;
  }

  var sliderVia = 'drag', lastSliderLogT = 0;
  function setSel(p, via) {
    p = Math.max(1, Math.min(P.env.positions, Math.round(p || 1)));
    if (p === sel) return;
    sel = p;
    $('pos-slider').value = p;
    $('pos-input').value = p;
    logSlider(p, via || sliderVia);
    renderRound();
  }
  // §16.4: throttle to at most one event every 250 ms, and always emit one on
  // release. Cheap to capture, impossible to recover later — it is the record of
  // which positions were considered and rejected without paying for anything.
  function logSlider(p, via) {
    if (!S.round || !S.round.open) return;
    S.round.sliderMoves++;
    S.round.movesSinceAction++;
    S.round.lastSliderT = Date.now();
    var now = Date.now();
    if (via !== 'release' && (now - lastSliderLogT) < CFG.SLIDER_THROTTLE_MS) return;
    lastSliderLogT = now;
    L.tele('slider', { position: p, via: via, ms: now - S.round.startedAt });
  }

  function renderRound() {
    var r = currentRound(), aiOn = (r.condition === 'AI_ON');
    var peek = (DEBUG && B.canSeeTruth) ? B.peek() : null;
    chart.render({
      selected: sel,
      preOpened: preOpenedPairs(),
      revealed: revealedPairs(),
      asked: aiOn ? askedPairs() : [],
      showTruth: !!(peek && tv.truth), truth: peek ? peek.truth : null,
      showAiCurve: !!(peek && tv.curve), aiCurve: peek ? peek.curve : null,
      showAnchors: !!(peek && tv.anchors), anchors: peek ? peek.privateAnchors : null,
      tag: DEBUG ? ((r.spec_id || '?') + ' · ' + (r.seed_shape || '?') + ' · ' + (r.ai_density || '?')) : null
    });

    // The left panel is the LEDGER only. What was found lives on the plot, where
    // every mark already carries its value; the panel used to repeat all of it in
    // words, which asked the participant to read the same thing twice.
    // Still deliberately no "best estimate" mixing claims with truths — the two
    // costs stay apart and only TRUE prizes count towards the best below (§14).

    var qCost = S.round.queries.length * P.costs.queryCost;
    var rCost = S.round.reveals.length * P.costs.revealCost;
    $('c-queries').textContent = S.round.queries.length;
    $('c-query-cost').textContent = qCost;
    $('c-reveals').textContent = S.round.reveals.length;
    $('c-reveal-cost').textContent = rCost;
    $('c-total-cost').textContent = qCost + rCost;
    $('c-selected').textContent = sel;
    $('c-remaining').textContent = PLAN.rounds.length - S.roundPtr - 1;
    // The Ask panel is not merely hidden in an AI-off round — it is out of the
    // DOM (applyActionOrder), so there is nothing to toggle here.
    // The AI rows are meaningless in a round without it.
    $('ss-ai').style.display = aiOn ? '' : 'none';
    $('ss-ai-cost').style.display = aiOn ? '' : 'none';

    // Best prize FOUND — true prizes only. An AI answer is not a prize, and
    // showing one here would be the one place the study contradicts itself.
    var knownPairs = preOpenedPairs().concat(revealedPairs());
    var best = null;
    knownPairs.forEach(function (x) { if (best == null || x.val > best.val) best = x; });
    $('c-best').textContent = best ? (best.val + ' at position ' + best.pos) : '—';

    // What the round is worth if they stop now: the best TRUE prize they hold,
    // minus everything spent. Always a number once they know anything, so there
    // is no "unknown" message to read past — and it never leaks, because it is
    // computed from prizes they have already paid to see. It deliberately does
    // NOT use the selected position: an unopened one has no known value, and
    // guessing at it here would hand over the truth for free.
    var netEl = $('c-net');
    if (best) {
      var net = best.val - (qCost + rCost);
      netEl.textContent = net + '  (' + best.val + ' − ' + (qCost + rCost) + ' spent)';
      netEl.parentNode.classList.toggle('neg', net < 0);
    } else {
      netEl.textContent = '—';
      netEl.parentNode.classList.remove('neg');
    }

    // The same four numbers, big, under the plot. Net value is what the round is
    // actually worth: the best TRUE prize they hold, minus everything spent.
    $('sb-best').innerHTML = best
      ? best.val + '<span class="sub">at position ' + best.pos + '</span>'
      : '—';
    $('sb-reveal').textContent = rCost;
    $('sb-ai').textContent = qCost;
    $('sb-ai-wrap').style.display = aiOn ? '' : 'none';
    var sbNet = $('sb-net');
    if (best) {
      var netB = best.val - (qCost + rCost);
      sbNet.innerHTML = netB + '<span class="sub">' + best.val + ' − ' + (qCost + rCost) + ' spent</span>';
      sbNet.parentNode.classList.toggle('neg', netB < 0);
    } else {
      sbNet.innerHTML = '—<span class="sub">reveal a position to start</span>';
      sbNet.parentNode.classList.remove('neg');
    }

    $('c-prices').innerHTML = 'Revealing a position costs <b>' + P.costs.revealCost + '</b>' +
      (aiOn ? ' · asking the AI costs <b>' + P.costs.queryCost + '</b>' : '') +
      ' · stopping is free.<br>Your score is the <b>true prize where you stop</b>, minus everything you spent this round.' +
      (aiOn ? '<br>The AI\u2019s answer is an <b>estimate, not a prize</b>.' : '');

    var revealedHere = isRevealed(sel);
    $('btn-reveal').disabled = busy || revealedHere || S.round.reveals.length >= P.costs.revealCap;
    $('btn-reveal').title = revealedHere ? 'This position is already open — you cannot pay for it twice.' : '';
    // Ask stays enabled even for a position already asked about: re-querying
    // after a reveal is a meaningful act, and it is logged (§14).
    if ($('btn-ask')) {
      $('btn-ask').disabled = busy
        || (!P.ai.allowRequery && wasQueried(sel))
        || (S.round.queries.length >= P.costs.queryCap);
    }
    $('btn-nominate').disabled = busy;
    $('btn-nominate').textContent = 'Stop and nominate position ' + sel;

    var capMsg = '';
    if (S.round.reveals.length >= P.costs.revealCap) capMsg = 'You have reached the limit of ' + P.costs.revealCap + ' reveals in a round.';
    else if (S.round.queries.length >= P.costs.queryCap) capMsg = 'You have reached the limit of ' + P.costs.queryCap + ' questions in a round.';
    $('cap-note').textContent = capMsg;
    $('cap-note').style.display = capMsg ? '' : 'none';

    if (DEBUG) updateTestView();
  }

  // The information state at the instant BEFORE an action (§16.3). The two most
  // important fields are the two anchor sets: the AI knows things the participant
  // does not, so both are stored, in full, even though the reveal history is
  // formally enough to reconstruct them — redundancy is cheap, reconstruction
  // bugs are not.
  function decisionContext() {
    return {
      event_id: uuid(),
      decision_index: S.round.decisionIdx,
      queries_so_far: S.round.queries.length,
      reveals_so_far: S.round.reveals.length,
      n_reveals_before: S.round.reveals.length,
      // In SERVER mode the client does not know the AI's anchors — by design —
      // so the authoritative row the Function writes carries them, and this one
      // carries the timing and the scanning that only the browser can see.
      ai_anchors_before: B.canSeeTruth ? L.encodePairs(B.peek().anchors) : null,
      participant_known_before: L.encodePairs(knownPairs()),
      participant_queried_before: L.encodePairs(askedPairs()),
      best_true_known_before: bestTrueKnown(),
      best_estimate_before: bestEstimate(),
      ms_since_round_start: Date.now() - S.round.startedAt,
      ms_since_last_action: L.msSinceLastAction(),
      ms_since_last_slider_move: S.round.lastSliderT ? (Date.now() - S.round.lastSliderT) : null,
      slider_moves_since_last_action: S.round.movesSinceAction
    };
  }

  // §14: a query and a reveal must return with the same latency and the same
  // animation, so response time can never signal which action was taken — nor,
  // for a query, whether the position happened to be one the AI knew.
  function withLatency(fn) {
    if (busy) return;
    busy = true;
    $('plot').classList.add('working');
    renderRound();
    var started = Date.now(), released = false;
    function release() {
      if (released) return;
      released = true;
      busy = false;
      $('plot').classList.remove('working');
      // Re-render AFTER clearing `busy`: the buttons are disabled while an action
      // is in flight, and without this they would stay that way, because the
      // caller's own render ran while the gate was still closed.
      if (S && S.round && S.round.open) renderRound();
    }
    // The work starts immediately; the RELEASE waits until at least LATENCY_MS
    // has passed, so a fast answer and a slow one look identical on screen. In
    // server mode the Function pads to its own fixed duration as well.
    fn(function () {
      var left = LATENCY_MS - (Date.now() - started);
      if (left > 0) setTimeout(release, left); else release();
    });
  }

  function doAsk() {
    if (busy || currentRound().condition !== 'AI_ON') return;
    if (S.round.queries.length >= P.costs.queryCap) return;
    act('query', sel);
  }

  function doReveal() {
    if (busy || isRevealed(sel)) return;
    if (S.round.reveals.length >= P.costs.revealCap) return;
    act('reveal', sel);
  }

  // One paid action. The backend returns exactly one number, after the same
  // fixed delay whichever action it was — so neither the wire nor the clock can
  // tell an exact AI answer from an invented one (§17.2).
  function act(action, pos) {
    var dc = decisionContext();
    var already = (action === 'reveal') ? wasQueried(pos) : null;
    var actionId = uuid();
    withLatency(function (done) {
      B.act(action, pos, actionId, S.code, currentRound().round_index).then(function (res) {
        var value = res.value;
        var at = Date.now() - S.round.startedAt;
        S.round.lastActionAt = at;
        hideNudge();
        if (action === 'query') S.round.queries.push({ pos: pos, val: value, t: at });
        else S.round.reveals.push({ pos: pos, val: value, t: at });
        S.round.decisionIdx++;
        S.round.movesSinceAction = 0;
        L.markAction();
        L.log('decision', Object.assign(dc, {
          action: action, position: pos, value: value,
          already_queried: already, event_id: actionId
        }));
        save();
        done();
        renderRound();
        flashAnswer(action === 'query'
          ? 'The AI says <b>' + value + '</b> at position ' + pos + '.'
          : 'Position ' + pos + ' holds <b>' + value + '</b>.', action === 'query' ? 'ask' : 'reveal');
        encourageAfterAction();
      }, function (err) { done(); serverProblem(err); });
    });
  }

  function flashAnswer(html, kind) {
    var el = $('answer-flash');
    el.innerHTML = html;
    el.className = 'answer-flash show ' + kind;
    clearTimeout(flashAnswer._t);
    flashAnswer._t = setTimeout(function () { el.className = 'answer-flash'; }, 2600);
  }

  // ---- nomination ----------------------------------------------------------
  function openNominate() {
    if (busy) return;
    var pos = sel;
    var untouched = !isRevealed(pos) && !wasQueried(pos);
    var did = S.round.queries.length + S.round.reveals.length;
    var r = currentRound();
    // Closing a scored round after almost nothing: usually boredom rather than
    // a decision, and it is the one failure mode that costs the study a whole
    // round of data. Asked ONCE per round, in the participant's own interest
    // (there is no time limit), and "Stop anyway" is always right there — a
    // prompt that could not be dismissed would coerce the very choice being
    // measured. Nothing is said about where to look.
    var rushMax = (P.ui && P.ui.rushMinActions != null) ? P.ui.rushMinActions : 2;
    // ONCE PER BLOCK, not once per round. The trigger — "stopped after almost
    // no searching" — is correlated with the arm being measured (an AI-off
    // round is cheaper to leave alone), so a per-round prompt would land far
    // more often on one half of the crossover and become a treatment that
    // varies with the condition. Capping it at one per half keeps it a
    // reminder rather than a differential intervention, and it is logged
    // either way.
    S.rushWarnedBlocks = S.rushWarnedBlocks || {};
    if (encourageOn() && r && r.scored && did <= rushMax && !S.rushWarnedBlocks[r.block]) {
      S.rushWarnedBlocks[r.block] = 1;
      save();
      var R = CT.ENCOURAGE.rush;
      showEncourage('rush', R.title,
        (did ? R.bodyFew.replace('{did}', did).replace('{J}', P.env.positions) : R.bodyNone),
        // "Stop anyway" re-enters openNominate rather than nominating directly:
        // the §14 confirmation for a position they have never touched is a
        // SEPARATE safeguard against a mis-click, and this prompt must not
        // swallow it. The block flag is already set, so it cannot loop.
        R.stay, { text: R.go, onAlt: function () { openNominate(); } });
      return;
    }
    // §14: confirm when the position has never been asked about or revealed —
    // that is a pure gamble and more likely a misclick than an intention.
    if (untouched) {
      $('nom-title').textContent = 'Stop on position ' + pos + '?';
      $('nom-msg').innerHTML = 'You have not asked about or revealed position <b>' + pos + '</b>. ' +
        'You will score whatever prize is actually there, minus what you have spent this round.';
      $('btn-nom-ok').textContent = 'Yes, stop on ' + pos;
      $('ov-nominate').classList.add('show');
      $('btn-nom-cancel').onclick = function () { $('ov-nominate').classList.remove('show'); };
      $('btn-nom-ok').onclick = function () { $('ov-nominate').classList.remove('show'); doNominate(pos); };
      return;
    }
    doNominate(pos);
  }

  function doNominate(pos) {
    var dc = decisionContext();
    var capHit = (S.round.reveals.length >= P.costs.revealCap) ? 'reveal'
      : (S.round.queries.length >= P.costs.queryCap) ? 'query' : null;
    var actionId = uuid();
    withLatency(function (done) {
      var r = currentRound();
      B.nominate(pos, actionId, S.code, r.round_index).then(function (res) {
      // THE SCORE COMES FROM THE BACKEND, never from arithmetic here (§17.2).
      var trueVal = res.trueValue;
      var cost = res.totalCost;
      var raw = res.raw_score;
      var score = res.score;

      L.markAction();
      L.log('decision', Object.assign(dc, {
        action: 'stop', position: pos, value: null, cap_hit: capHit, event_id: actionId
      }));

      var nomType = res.nominationType ||
        (isRevealed(pos) ? 'verified' : (wasQueried(pos) ? 'queried_only' : 'untouched'));
      var result = {
        round_index: r.round_index, spec_id: r.spec_id, block: r.block,
        condition: r.condition, scored: r.scored,
        n_queries: S.round.queries.length, n_reveals: S.round.reveals.length,
        total_cost: cost, nominated_position: pos, nominated_true_value: trueVal,
        nomination_type: nomType, final_score: score, raw_score: raw,
        duration_ms: Date.now() - S.round.startedAt,
        stopped_immediately: (S.round.decisionIdx === 0),
        cap_hit: capHit,
        interrupted: (S.interruptedRounds || []).indexOf(S.roundPtr) >= 0
      };
      L.log('round_end', Object.assign({}, result, {
        info: JSON.stringify({
          queries: S.round.queries.map(function (q) { return q.pos + ':' + q.val; }).join('|'),
          reveals: S.round.reveals.map(function (q) { return q.pos + ':' + q.val; }).join('|'),
          slider_moves: S.round.sliderMoves,
          instruction_reopens: S.round.instrReopens,
          blur_events: S.round.blurEvents, blur_total_ms: S.round.blurMs
        }),
        instruction_reopens: S.round.instrReopens,
        blur_events: S.round.blurEvents, blur_total_ms: S.round.blurMs
      }));
      L.flushTelemetry();

      if (r.scored) S.totalScore += score;
      S.results.push(result);
      S.lastResult = result;
      S.round.open = false;
      clearNudges();
      hideNudge();
      save();
      done();
      showInterstitial(result);
      }, function (err) { done(); serverProblem(err); });
    });
  }

  // §14: after nomination, show the true prize at that position before moving on.
  // Every round ends with the participant learning whether the machine was right.
  function showInterstitial(result) {
    if (!result) { nextRound(); return; }
    S.phase = 'interstitial'; save();
    var r = PLAN.rounds[S.roundPtr];
    var askedAt = null;
    (S.round && S.round.queries ? S.round.queries : []).forEach(function (q) { if (q.pos === result.nominated_position) askedAt = q.val; });

    // Its own chart: the round screen is hidden behind this one, so re-rendering
    // the round's plot would draw the result where nobody can see it.
    var plotHost = $('inter-plot');
    plotHost.innerHTML = '';
    var ic = window.SVChart.create(plotHost, { positions: P.env.positions });
    ic.render({
      selected: null,
      preOpened: preOpenedPairs(),
      revealed: revealedPairs(),
      asked: (r && r.condition === 'AI_ON') ? askedPairs() : [],
      nominated: { pos: result.nominated_position, val: result.nominated_true_value }
    });
    var host = $('inter-body');
    var lines = [];
    lines.push('<div class="res-line">You stopped on position <b>' + result.nominated_position + '</b>.</div>');
    lines.push('<div class="res-big">' + result.nominated_true_value + ' points</div>');
    if (askedAt != null) {
      var errAbs = Math.abs(askedAt - result.nominated_true_value);
      lines.push('<div class="res-line muted">The AI had said <b>' + askedAt + '</b> there — ' +
        (errAbs === 0 ? 'exactly right.' : 'out by ' + errAbs + '.') + '</div>');
    }
    // The whole sum, itemised: the prize won, the cost of searching, the cost of
    // consulting, and what is left. A participant should never have to work out
    // where their score went.
    var qC = result.n_queries * P.costs.queryCost, rC = result.n_reveals * P.costs.revealCost;
    var led = ['<div class="ledger">'];
    led.push('<div class="lg plus"><span>Prize at position ' + result.nominated_position + '</span>' +
      '<span class="lg-v">+' + result.nominated_true_value + '</span></div>');
    led.push('<div class="lg minus"><span>Cost of revealing &mdash; ' + result.n_reveals + ' \u00d7 ' +
      P.costs.revealCost + '</span><span class="lg-v">' + (rC ? '\u2212' + rC : '0') + '</span></div>');
    if (r && r.condition === 'AI_ON') {
      led.push('<div class="lg minus"><span>Cost of asking the AI &mdash; ' + result.n_queries + ' \u00d7 ' +
        P.costs.queryCost + '</span><span class="lg-v">' + (qC ? '\u2212' + qC : '0') + '</span></div>');
    }
    led.push('<div class="lg total"><span>Round score' + (result.scored ? '' : ' (practice, not counted)') +
      '</span><span class="lg-v">' + result.final_score + '</span></div>');
    led.push('</div>');
    lines.push(led.join(''));
    if (result.scored) {
      lines.push('<div class="res-line muted">Running total: <b>' + S.totalScore + '</b> points across ' +
        S.results.filter(function (x) { return x.scored; }).length + ' scored rounds.</div>');
    }
    var passive = passiveNudgeText(result);
    if (passive) lines.push('<div class="res-line muted" style="margin-top:10px;">' + passive + '</div>');
    var left = PLAN.rounds.length - S.roundPtr - 1;
    // A friendly line, rotated by ROUND INDEX — never by how the round went, so
    // it is a mood and not feedback on their score (see content.js).
    if (encourageOn() && left > 0) {
      var cheers = CT.ENCOURAGE.cheers;
      lines.push('<div class="res-cheer">' + esc(cheers[S.roundPtr % cheers.length]) + '</div>');
    }
    lines.push('<div class="res-line muted">' + (left > 0 ? left + ' round' + (left === 1 ? '' : 's') + ' to go.' : 'That was the last round.') + '</div>');
    host.innerHTML = lines.join('');
    $('btn-continue').onclick = nextRound;
    show('s-interstitial');
  }


  // ======================================================================
  //  NUDGES
  // ======================================================================
  // Short, friendly, dismissible. They never block anything and they never say
  // what to choose — only that the participant may act, and how the round is
  // scored. Every appearance is logged as telemetry (`nudge`, with its kind), so
  // the analysis can see who was nudged and when: an unlogged prompt is an
  // uncontrolled intervention.
  var IDLE_FIRST_MS = 45000, IDLE_AGAIN_MS = 90000;
  var nudgeTimer = null, nudgeShownThisRound = {}, passiveRounds = 0;

  function showNudge(kind, text) {
    if (PREVIEW) { /* still shown — a rehearsal should look like the real thing */ }
    var el = $('tip');
    if (!el) return;
    $('tip-text').textContent = text;
    el.classList.toggle('good', kind === 'encourage');
    el.classList.add('show');
    nudgeShownThisRound[kind] = true;
    try { L.tele('nudge', { kind: kind, round_index: S.round ? S.roundPtr + 1 : null }); } catch (e) {}
  }
  function hideNudge() { var el = $('tip'); if (el) el.classList.remove('show'); }

  function armNudges() {
    clearNudges();
    nudgeShownThisRound = {};
    hideNudge();
    var x = $('tip-close');
    if (x) x.onclick = function () { hideNudge(); };
    var T = CT.ENCOURAGE.tips;
    nudgeTimer = setInterval(function () {
      if (!S || !S.round || !S.round.open || S.phase !== 'round') return;
      var since = Date.now() - (S.round.lastActionAt || S.round.startedAt || Date.now());
      var did = S.round.queries.length + S.round.reveals.length;
      if (!did && since > IDLE_FIRST_MS && !nudgeShownThisRound.start) {
        showNudge('start', T.idleStart.replace('{ask}',
          (currentRound() && currentRound().condition === 'AI_ON') ? 'ask the AI, ' : ''));
      } else if (did && since > IDLE_AGAIN_MS && !nudgeShownThisRound.mid) {
        showNudge('mid', T.idleMid);
      }
    }, 5000);
  }
  // Shown once per round, a moment after the participant's FIRST action: a
  // long repetitive task loses attention, and the point where someone has
  // looked once and may settle for it is where that shows. Says nothing about
  // where to look or how they are doing — see the rule in content.js.
  function encourageAfterAction() {
    if (!encourageOn() || nudgeShownThisRound.encourage) return;
    var r = currentRound();
    if (!r || !r.scored) return;
    if ((S.round.queries.length + S.round.reveals.length) !== 1) return;
    nudgeShownThisRound.encourage = true;   // claim it now: the timer is async
    setTimeout(function () {
      if (S && S.round && S.round.open && S.phase === 'round') showNudge('encourage', CT.ENCOURAGE.tips.encourage);
    }, 1200);
  }

  // ---- encouragement pop-ups (config.ui.encouragement) ---------------------
  function encourageOn() { return !!(P.ui && P.ui.encouragement); }
  // ONE modal, two uses: the between-rounds milestone (Continue only) and the
  // focus prompt before an unusually quick finish (Keep searching / Stop
  // anyway). `alt` is the second button; without it there is one way on.
  function showEncourage(kind, title, msg, okText, alt) {
    $('enc-title').textContent = title;
    $('enc-msg').textContent = msg;
    var ok = $('btn-enc-ok'), altBtn = $('btn-enc-alt');
    ok.textContent = okText || 'Continue';
    var close = function () { $('ov-encourage').classList.remove('show'); };
    ok.onclick = function () { close(); if (alt && alt.onOk) alt.onOk(); };
    if (alt && alt.text) {
      altBtn.style.display = '';
      altBtn.textContent = alt.text;
      altBtn.onclick = function () { close(); if (alt.onAlt) alt.onAlt(); };
    } else {
      altBtn.style.display = 'none';
      altBtn.onclick = null;
    }
    $('ov-encourage').classList.add('show');
    try {
      L.tele('nudge', { kind: kind, round_index: S && S.round ? S.roundPtr + 1 : null });
    } catch (e) {}
  }
  // Where this round sits in its half, and therefore which milestone (if any)
  // is due. Fixed points of the PLAN — never a reaction to how well they are
  // doing, which would feed performance back into behaviour.
  function milestoneFor(r) {
    if (!r || !r.scored) return null;
    var total = P.rounds.scoredPerBlock;
    var n = 0;                                    // this round's ordinal in its half
    for (var i = 0; i <= S.roundPtr && i < PLAN.rounds.length; i++) {
      if (PLAN.rounds[i].scored && PLAN.rounds[i].block === r.block) n++;
    }
    var left = total - n + 1;                     // including this one
    var lastBlock = r.block >= 2;
    if (lastBlock && left === 1) return { key: 'lastRound', left: left };
    if (total >= 6 && left === 3) return { key: 'nearEnd', left: left };
    if (total >= 6 && n === Math.ceil(total / 2)) return { key: 'half', left: left - 1 };
    return null;
  }
  function maybeMilestone() {
    if (!encourageOn()) return;
    var r = currentRound(), m = milestoneFor(r);
    if (!m) return;
    S.milestones = S.milestones || {};
    var seen = r.block + ':' + m.key;
    if (S.milestones[seen]) return;               // once each, and it survives a reload
    S.milestones[seen] = 1;
    save();
    var t = CT.ENCOURAGE.milestones[m.key];
    var fill = function (s) { return String(s).replace(/\{left\}/g, m.left); };
    // The round's clock starts when the round opens, and this modal sits on top
    // of it — so restart the clock when it is dismissed, or every millisecond
    // spent reading it would be charged to ms_to_first_action and to the
    // decision latency that is one of the study's measures.
    showEncourage('milestone_' + m.key, fill(t.title), fill(t.body), 'Continue', {
      onOk: function () {
        if (S.round && S.round.open) {
          S.round.startedAt = Date.now();
          S.round.lastActionAt = Date.now();
          L.resetActionClock();
        }
      }
    });
  }
  function clearNudges() { if (nudgeTimer) { clearInterval(nudgeTimer); nudgeTimer = null; } }

  // A participant who stops blind several rounds running has usually stopped
  // reading rather than decided to gamble; this is the only nudge that mentions
  // the trade-off, and it says nothing about WHERE to look.
  function passiveNudgeText(result) {
    if (result.n_queries + result.n_reveals > 0) { passiveRounds = 0; return null; }
    passiveRounds++;
    if (passiveRounds < 3) return null;
    passiveRounds = 0;
    return 'A reminder: your score is the true prize where you stop, minus what you spent. ' +
      'Opening even one position tells you what is really there.';
  }

  function nextRound() {
    S.roundPtr++;
    S.round = null;
    S.lastResult = null;
    L.clearContext();
    save();
    if (S.roundPtr >= PLAN.rounds.length) {
      goto(P.ops.exitSurvey ? 'survey' : (P.ops.debrief ? 'debrief' : 'done'));
      return;
    }
    goto('blockintro');
  }

  // ---- instructions summary, reopenable at any time (§14, §16.5) ----------
  var summaryOpenedAt = null;
  function openSummary() {
    summaryOpenedAt = Date.now();
    if (S.round) S.round.instrReopens++;
    L.tele('instruction_open', {});
    var r = currentRound();
    var aiOn = r && r.condition === 'AI_ON';
    var html = '<h3>Quick reminder</h3>' +
      '<ul>' +
      '<li>Neighbouring positions differ by at most <b>' + P.env.stepBound + '</b> points.</li>' +
      '<li>Revealing a position costs <b>' + P.costs.revealCost + '</b> points and shows the true prize.</li>' +
      // currentK(), never r.spec.ai_k — a server-mode plan deliberately carries no
      // spec, so that dereference threw and the reminder overlay never opened,
      // after the open had already been counted against the attention measure.
      (aiOn ? '<li>Asking the AI costs <b>' + P.costs.queryCost + '</b> points. It knows <b>' + currentK() +
        '</b> of the ' + P.env.positions + ' positions exactly and guesses everywhere else — you are not told which.</li>' : '') +
      '<li>Your score is the <b>true prize at the position you stop on</b>, minus everything you spent this round.</li>' +
      '<li>Prizes are drawn afresh every round.</li>' +
      '</ul>';
    $('summary-body').innerHTML = html;
    $('ov-summary').classList.add('show');
    $('btn-summary-close').onclick = closeSummary;
  }
  function closeSummary() {
    $('ov-summary').classList.remove('show');
    L.tele('instruction_close', { ms: summaryOpenedAt ? (Date.now() - summaryOpenedAt) : null });
    summaryOpenedAt = null;
  }

  // ======================================================================
  //  EXIT SURVEY (§16.7)
  // ======================================================================
  // Background is NOT asked here — it is the registration phase, before the
  // study (see showRegistration). The survey asks only about what just
  // happened, while it is fresh.
  function surveyItems() {
    var playedAi = PLAN.rounds.some(function (r) { return r.condition === 'AI_ON'; });
    var items = CT.SURVEY.filter(function (q) { return !(q.aiOnly && !playedAi); });
    // MIGRATION (see registrationCatchUp): a participant who was already in the
    // rounds when the registration phase shipped never saw it, and Part F no
    // longer exists — so for them, and only for them, the background items come
    // back here, where they used to be. They are logged as `registration` rows
    // either way, so the export column is the same.
    if (!S.regDone) {
      var late = registrationItems().map(function (q) {
        return { part: 'F', id: q.id, type: 'choice', optional: true, prompt: q.prompt, options: q.options };
      });
      if (late.length) items = items.concat(late);
    }
    return items;
  }

  function showSurvey() {
    var items = surveyItems(), host = $('survey-body'), lastPart = null, html = [];
    items.forEach(function (q, i) {
      if (q.part !== lastPart) {
        lastPart = q.part;
        var pi = CT.PART_INTRO[q.part] || { title: '', note: '' };
        html.push('<h3 class="survey-part">' + esc(pi.title) + '</h3>' +
          (pi.note ? '<p class="muted small">' + esc(pi.note) + '</p>' : ''));
      }
      html.push('<div class="survey-q" data-q="' + esc(q.id) + '">');
      html.push('<div class="sq-prompt">' + (i + 1) + '. ' + esc(tokens(q.prompt)) +
        (q.optional ? ' <span class="muted small">(optional)</span>' : '') + '</div>');
      if (q.type === 'text') {
        html.push('<textarea data-a="' + esc(q.id) + '" rows="3"></textarea>');
      } else if (q.type === 'choice') {
        html.push('<div class="sq-opts">' + q.options.map(function (o, oi) {
          return '<label class="quiz-opt"><input type="radio" name="' + esc(q.id) + '" value="' + oi + '"><span>' + esc(o) + '</span></label>';
        }).join('') + '</div>');
        if (q.followText) html.push('<div class="sq-follow"><label class="small muted">' + esc(q.followText) + '</label>' +
          '<textarea data-a="' + esc(q.id) + '_why" rows="2"></textarea></div>');
      } else if (q.type === 'slider') {
        html.push('<div class="sq-slider"><input type="range" data-a="' + esc(q.id) + '" min="' + q.min + '" max="' + q.max +
          '" value="' + Math.round((q.min + q.max) / 2) + '" step="1">' +
          '<output class="sq-out">' + Math.round((q.min + q.max) / 2) + '</output></div>' +
          '<div class="sq-scale"><span>' + q.min + '</span><span>' + q.max + '</span></div>');
      } else if (q.type === 'multi') {
        html.push('<div class="sq-opts">' + q.options.map(function (o, oi) {
          return '<label class="quiz-opt"><input type="checkbox" name="' + esc(q.id) + '" value="' + oi + '"><span>' + esc(o) + '</span></label>';
        }).join('') + '</div>');
      } else if (q.type === 'numeracy') {
        html.push('<div class="sq-num">' + q.items.map(function (it) {
          return '<div class="sq-numrow"><span>' + esc(it.prompt) + '</span>' +
            '<input type="number" step="any" data-a="' + esc(it.id) + '"><span class="muted small">' + esc(it.suffix || '') + '</span></div>';
        }).join('') + '</div>');
      }
      html.push('</div>');
    });
    host.innerHTML = html.join('');

    host.querySelectorAll('input[type=range]').forEach(function (r) {
      var out = r.parentNode.querySelector('.sq-out');
      r.addEventListener('input', function () { out.textContent = r.value; });
    });
    // "None of these" is exclusive of every other option in item 18.
    var multi = CT.SURVEY.filter(function (q) { return q.type === 'multi' && q.exclusive != null; });
    multi.forEach(function (q) {
      host.querySelectorAll('input[name="' + q.id + '"]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (+cb.value === q.exclusive && cb.checked) {
            host.querySelectorAll('input[name="' + q.id + '"]').forEach(function (o) { if (o !== cb) o.checked = false; });
          } else if (cb.checked) {
            var ex = host.querySelector('input[name="' + q.id + '"][value="' + q.exclusive + '"]');
            if (ex) ex.checked = false;
          }
        });
      });
    });

    $('survey-feedback').style.display = 'none';
    $('btn-survey').onclick = function () { submitSurvey(items); };
    show('s-survey');
  }

  function submitSurvey(items) {
    var host = $('survey-body'), answers = {}, missing = [];
    items.forEach(function (q) {
      if (q.type === 'text') {
        answers[q.id] = (host.querySelector('[data-a="' + q.id + '"]') || {}).value || '';
      } else if (q.type === 'choice') {
        var pick = host.querySelector('input[name="' + q.id + '"]:checked');
        answers[q.id] = pick ? q.options[+pick.value] : '';
        if (!pick && !q.optional) missing.push(q.id);
        if (q.followText) answers[q.id + '_why'] = (host.querySelector('[data-a="' + q.id + '_why"]') || {}).value || '';
      } else if (q.type === 'slider') {
        answers[q.id] = +(host.querySelector('[data-a="' + q.id + '"]') || {}).value;
      } else if (q.type === 'multi') {
        var picks = [];
        host.querySelectorAll('input[name="' + q.id + '"]:checked').forEach(function (cb) { picks.push(q.options[+cb.value]); });
        answers[q.id] = picks.join('; ');
        if (!picks.length && !q.optional) missing.push(q.id);
      } else if (q.type === 'numeracy') {
        q.items.forEach(function (it) {
          var v = (host.querySelector('[data-a="' + it.id + '"]') || {}).value;
          answers[it.id] = (v === '' || v == null) ? '' : +v;
          if ((v === '' || v == null) && !q.optional) missing.push(it.id);
        });
      }
    });
    // Free-text items are never compulsory: forcing prose produces noise.
    missing = missing.filter(function (id) {
      var q = CT.SURVEY.filter(function (x) { return x.id === id || (x.items || []).some(function (i) { return i.id === id; }); })[0];
      return q && q.type !== 'text';
    });
    if (missing.length) {
      $('survey-feedback').textContent = 'Please answer the ' + missing.length + ' remaining question' + (missing.length === 1 ? '' : 's') + ' — only the free-text items are optional.';
      $('survey-feedback').style.display = 'block';
      var first = host.querySelector('.survey-q[data-q="' + missing[0].replace(/[a-c]$/, '') + '"]') || host.querySelector('.survey-q');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // MIGRATION (see registrationCatchUp): background items appended to the
    // survey for a participant who predates the registration phase are split
    // back out here and logged as `registration` rows, so they reach the same
    // reg_* column as everybody else's rather than a survey_ one.
    if (!S.regDone) {
      var lateIds = registrationItems().map(function (q) { return q.id; });
      S.reg = S.reg || {};
      lateIds.forEach(function (id) {
        if (!(id in answers)) return;
        S.reg[id] = answers[id];
        delete answers[id];
        L.log('registration', { question_id: id, answer: String(S.reg[id] || ''), source: 'participant' });
      });
      S.regDone = true;
    }
    S.survey = answers;
    save();
    L.setContext({ phase: 'survey' });
    Object.keys(answers).forEach(function (k) {
      L.log('survey', { question_id: k, answer: String(answers[k] == null ? '' : answers[k]).slice(0, 4000) });
    });
    goto(P.ops.debrief ? 'debrief' : 'done');
  }

  // ======================================================================
  //  DEBRIEF (§16.7) + DONE
  // ======================================================================
  function showDebrief() {
    $('debrief-body').innerHTML = prose(tokens(CT.DEBRIEF));
    $('debrief-plot').innerHTML = '';
    $('debrief-caption').innerHTML = '';
    $('debrief-round').textContent = '';
    $('btn-debrief').onclick = function () { goto('done'); };
    show('s-debrief');
    pickDebriefRound().then(renderDebriefPlot, function () {});
  }

  function renderDebriefPlot(pick) {
    var host = $('debrief-plot');
    host.innerHTML = '';
    if (pick) {
      var c = window.SVChart.create(host, { positions: P.env.positions });
      c.render({
        showTruth: true, truth: pick.truth,
        showAiCurve: true, aiCurve: pick.curve,
        showAnchors: true, anchors: pick.anchors,
        preOpened: pick.pre, revealed: pick.revealed, asked: pick.asked,
        nominated: pick.nominated
      });
      $('debrief-caption').innerHTML =
        '<span class="lg"><i class="sw truth"></i> the true prizes</span>' +
        '<span class="lg"><i class="sw aicurve"></i> what the AI would have said everywhere</span>' +
        '<span class="lg"><i class="sw anchor"></i> the positions it actually knew</span>' +
        '<span class="lg"><i class="sw ask"></i> the answers you paid for</span>' +
        '<span class="lg"><i class="sw rev"></i> what you revealed</span>';
      $('debrief-round').textContent = 'Your round ' + pick.round_index + ' (part ' + pick.block + ').';
    }
  }

  // Which of the participant's OWN rounds to redraw: the AI round where they
  // asked most, because that is the one where the discrepancies are visible.
  // The TRUTH for it comes from the backend — in server mode from a Function
  // that serves it only for a round that is already finished.
  function pickDebriefRound() {
    var infoByRound = {};
    L.getEvents().forEach(function (e) {
      if (e.event === 'round_end' && e.round_index != null) infoByRound[e.round_index] = e;
    });
    var candidates = PLAN.rounds.filter(function (r) {
      return infoByRound[r.round_index] && r.condition === 'AI_ON' && r.scored;
    });
    if (!candidates.length) candidates = PLAN.rounds.filter(function (r) { return infoByRound[r.round_index]; });
    if (!candidates.length) return Promise.resolve(null);

    var best = null, bestQ = -1;
    candidates.forEach(function (r) {
      var nq = infoByRound[r.round_index].n_queries || 0;
      if (nq > bestQ) { bestQ = nq; best = r; }
    });
    if (!best) best = candidates[candidates.length - 1];

    var ev = infoByRound[best.round_index], inf = {};
    try { inf = JSON.parse(ev.info || '{}'); } catch (e) {}
    var revealed = L.decodePairs(inf.reveals), asked = L.decodePairs(inf.queries);

    return Promise.resolve(B.debriefRound(S.code, S.sequence, best.round_index, revealed))
      .then(function (d) {
        if (!d) return null;
        return {
          round_index: d.round_index, block: d.block, truth: d.truth, curve: d.curve,
          anchors: d.anchors, pre: d.pre,
          revealed: d.revealed && d.revealed.length ? d.revealed : revealed,
          asked: d.asked && d.asked.length ? d.asked : asked,
          nominated: d.nominated || (ev.nominated_position != null
            ? { pos: ev.nominated_position, val: ev.nominated_true_value } : null)
        };
      }, function () { return null; });
  }

  function showDone() {
    if (!S.completed) {
      S.completed = true;
      S.endedAt = Date.now();
      stampPhase();
      save();
      L.setContext({ phase: 'done' });
      L.flushTelemetry();
      // `session_end` is what the Simulation Platform's verification adapter
      // matches on, joined by `pid` (the student ID). Keep the event name and
      // the pid field exactly as they are.
      L.log('session_end', Object.assign({ info: JSON.stringify(sessionRecord()) }, {
        final_score: S.totalScore, duration_ms: S.endedAt - S.startedAt
      }));
      if (window.SVFirebase && SVFirebase.isConfigured() && S.runId && !PREVIEW) {
        SVFirebase.saveParticipant(S.runId, S.code, sessionRecord());
        // …and close the loop on the roster document, which otherwise keeps the
        // 'started' it was stamped with at entry for ever. Best-effort: the
        // panel derives the status from the session record anyway, so a refused
        // write costs a tidier roster row and nothing else.
        SVFirebase.markRosterCompleted(S.runId, S.code);
      }
      // Tell the platform the run is finished, so the student's card ticks over.
      // Defined only on a genuine platform launch — never in a rehearsal.
      if (typeof window.simpMarkCompleted === 'function' && !PREVIEW) {
        try { window.simpMarkCompleted(); } catch (e) {}
      }
    }
    $('done-body').innerHTML = prose(tokens(CT.THANKS));
    var scored = S.results.filter(function (r) { return r.scored; });
    $('done-stats').innerHTML =
      '<div class="res-line">You completed <b>' + scored.length + '</b> scored rounds.</div>' +
      '<div class="res-big">' + S.totalScore + ' points</div>';
    var code = (P.ops && P.ops.completionCode) || '';
    $('done-code-box').style.display = code ? '' : 'none';
    $('done-code').textContent = code;
    $('btn-dl-json').onclick = function () { L.downloadJSON(); };
    $('btn-dl-csv').onclick = function () { L.downloadCSV(); };
    show('s-done');
  }

  // ---- the session record of §16.1 ----------------------------------------
  function sessionRecord() {
    var evs = L.getEvents();
    var first = evs.length ? evs[0].t : S.startedAt;
    var last = evs.length ? evs[evs.length - 1].t : Date.now();
    var longest = 0;
    for (var i = 1; i < evs.length; i++) longest = Math.max(longest, (evs[i].t || 0) - (evs[i - 1].t || 0));
    var wall = Math.max(0, last - first);
    var ua = L.uaFamilies(navigator.userAgent);
    return {
      run_id: S.runId || null, run_code: S.runCode || null,
      participant_code: S.code, pid: S.pid || null,
      sequence: S.sequence, shuffle_seed: S.shuffleSeed || null,
      round_order: (S.roundOrder || []).map(function (b) { return b.block + ':' + b.specIds.join(','); }).join(' | '),
      started_at: new Date(S.startedAt || first).toISOString(),
      ended_at: new Date(S.endedAt || last).toISOString(),
      timezone_offset: -new Date().getTimezoneOffset(),
      wall_clock_ms: wall,
      active_ms: activeMs,
      idle_ms: Math.max(0, wall - activeMs),
      longest_break_ms: longest,
      phase_ms: S.phaseMs || {},
      viewport_width: window.innerWidth, viewport_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio || 1,
      input_mode: inputMode,
      user_agent_parsed: ua.browser + '/' + ua.os,
      resumptions: S.resumptions || 0,
      // Time AWAY between sittings, as opposed to `longest_break_ms` above,
      // which is the longest quiet stretch inside one. A gap counts here only
      // when it is at least CFG.BREAK_MIN_MS — a reload takes seconds.
      breaks_count: S.breaksCount || 0,
      break_total_ms: S.breakMs || 0,
      longest_sitting_break_ms: S.longestSittingBreakMs || 0,
      sittings: 1 + (S.breaksCount || 0),
      resumed_from: S.resumedFrom || null,
      last_seen_at: S.lastSeenAt || null,
      completed: !!S.completed,
      total_score: S.totalScore || 0,
      rounds_done: (S.results || []).length,
      phase: S.phase,
      round_index: (currentRound() || {}).round_index || null,
      understood_frontier: !!(S.quiz[CT.UNDERSTOOD_FRONTIER_QID] && S.quiz[CT.UNDERSTOOD_FRONTIER_QID].firstCorrect),
      platform: HANDOFF ? { sim: HANDOFF.sim, session: HANDOFF.session || null } : null,
      updatedAt: Date.now()
    };
  }

  // ======================================================================
  //  ATTENTION, HEARTBEAT, INTEGRITY (§16.5)
  // ======================================================================
  var activeMs = 0, hbTimer = null, blurAt = null, inputMode = null;

  function startHeartbeat() {
    // Carry the accumulated total across a reload: active_ms is the number the
    // brief asks us to report as time on task, and restarting it at zero on every
    // resume would make a returning participant look like a fast one.
    activeMs = (S && S.activeMs) || 0;
    inputMode = (S && S.inputMode) || null;
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(function () {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      activeMs += CFG.HEARTBEAT_MS;
      S.activeMs = activeMs;
      L.tele('heartbeat', { phase: S.phase, round_index: (currentRound() || {}).round_index || null, active_ms: activeMs });
      save();
    }, CFG.HEARTBEAT_MS);
  }

  function wireGlobal() {
    window.addEventListener('blur', function () {
      blurAt = Date.now();
      if (S && S.round && S.round.open) S.round.blurEvents++;
      L.tele('window_blur', {});
    });
    window.addEventListener('focus', function () {
      var d = blurAt ? (Date.now() - blurAt) : null;
      if (d != null && S && S.round && S.round.open) S.round.blurMs += d;
      blurAt = null;
      L.tele('window_focus', { ms: d });
    });
    document.addEventListener('visibilitychange', function () {
      L.tele('visibility_change', { hidden: document.visibilityState !== 'visible' });
      if (document.visibilityState !== 'visible') stampSeen();
    });
    // The break between two sittings is measured from the moment they LEFT, so
    // the leaving is stamped. Without this the clock would start at the last
    // heartbeat and every break would read up to half a minute short. The write
    // is the synchronous localStorage half of save() — the debounced Firestore
    // sync cannot land during an unload, and does not need to.
    window.addEventListener('pagehide', stampSeen);
    var rzT = null;
    window.addEventListener('resize', function () {
      clearTimeout(rzT);
      rzT = setTimeout(function () {
        L.tele('resize', { vw: window.innerWidth, vh: window.innerHeight });
        if (!S || S.phase === 'done') return;
        var blocked = $('s-viewport').classList.contains('active');
        if (!viewportOk()) { renderViewportBlock(); return; }
        // Widening the window is enough to carry on — nobody should have to find
        // a button to escape a screen whose condition no longer holds.
        if (blocked) route();
      }, 400);
    });
    ['mousedown', 'touchstart', 'keydown'].forEach(function (t) {
      window.addEventListener(t, function (e) {
        if (inputMode) return;
        inputMode = (t === 'touchstart') ? 'touch' : (t === 'keydown' ? 'keyboard' : 'mouse');
        if (S) { S.inputMode = inputMode; save(); }
        L.tele('input_mode', { mode: inputMode });
      }, { once: false, passive: true });
    });
    // Keyboard: arrow keys move the selection by one position wherever the
    // participant's focus is, so the round is fully playable without a mouse.
    // A form control is left ALONE — the slider already moves itself by one on an
    // arrow key, and handling it here as well would move the selection twice.
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('ov-summary').classList.contains('show')) { closeSummary(); return; }
      if (!S || S.phase !== 'round' || !S.round || !S.round.open) return;
      // Only controls that HANDLE arrow keys themselves are left alone. A button
      // does not — and excluding it here meant that after any click the focus sat
      // on that button and the arrow keys silently stopped working, which is
      // exactly the state a keyboard user ends up in.
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'INPUT') return;
      if (e.key === 'ArrowLeft') { setSel(sel - 1, 'arrow'); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setSel(sel + 1, 'arrow'); e.preventDefault(); }
    });
    $('btn-vp-retry').onclick = function () { if (viewportOk()) route(); else renderViewportBlock(); };
  }

  function watchMessages() {
    if (PREVIEW || !(window.SVFirebase && SVFirebase.isConfigured()) || !S) return;
    if (unsubMsg) unsubMsg();
    unsubMsg = SVFirebase.watchMessages(S.code, function (msg) {
      if (!msg || !msg.text) return;
      var seen = null;
      try { seen = localStorage.getItem('searchv2:v3:msg:' + S.code); } catch (e) {}
      if (String(msg.id) === seen) return;
      try { localStorage.setItem('searchv2:v3:msg:' + S.code, String(msg.id)); } catch (e) {}
      var t = $('nudge-toast');
      $('nudge-text').textContent = msg.text;
      t.style.display = '';
      $('nudge-close').onclick = function () { t.style.display = 'none'; };
      L.tele('message_shown', { id: msg.id });
    });
  }

  // ======================================================================
  //  TESTING VIEW (debug link only) + ADMIN PREVIEW
  // ======================================================================
  var tv = { truth: false, curve: false, anchors: false };
  function buildTestView() {
    $('testview').innerHTML =
      '<span class="tv-title">Testing view</span>' +
      '<label><input type="checkbox" id="tv-truth"> true prizes</label>' +
      '<label><input type="checkbox" id="tv-curve"> the AI’s whole curve</label>' +
      '<label><input type="checkbox" id="tv-anchors"> the AI’s private anchors</label>' +
      '<span class="tv-opt" id="tv-readout"></span>' +
      // The curve is CURRENT; a diamond is HISTORICAL. Revealing a position
      // teaches the AI the truth there, so the curve moves to pass through it
      // and any answer given before that reveal is left sitting off the line.
      // That is the design working (it is what the AI comprehension gate asks
      // about), not a drawing error — but it reads as one until it is said.
      '<span class="tv-note">The dashed curve is what the AI would say <b>now</b>. ' +
      'A diamond is what it said <b>then</b> — revealing a position teaches it the truth there, ' +
      'so the curve moves and earlier answers are left off the line.</span>';
    ['truth', 'curve', 'anchors'].forEach(function (k) {
      var el = $('tv-' + k);
      el.checked = tv[k];
      el.onchange = function () { tv[k] = el.checked; renderRound(); };
    });
  }
  function updateTestView() {
    var el = $('tv-readout');
    if (!el || !B.canSeeTruth) return;
    var peek = B.peek();
    if (!peek) return;
    var anchors = peek.anchors;
    var sd = Ai.aiSd(anchors, sel, CFG.sigma(P.env.stepBound));
    var sStar = CFG.sStar(P.costs.revealCost);
    var g = Ai.geometry(anchors, sel, P.env.positions);
    el.innerHTML = '<b>at ' + sel + ':</b> AI says ' + Ai.aiAnswer(anchors, sel, P.ai.answerRounding) +
      ' · truth ' + peek.truth[sel - 1] +
      ' · AI s.d. ' + (sd == null ? '—' : sd.toFixed(2)) +
      ' (s* = ' + sStar.toFixed(2) + ' → ' + (sd > sStar ? 'verification pays' : 'trust') + ')' +
      ' · ' + g.choice_region + (g.gap_width != null ? ' g=' + g.gap_width : '') +
      (g.tail_depth != null ? ' t=' + g.tail_depth : '');
  }

  // Admin preview (§17b Screen 6): play any round spec exactly as a participant
  // would, writing NOTHING — no participant, no round, no event.
  function startPreview(pr) {
    S = {
      code: 'PREVIEW', runId: null, runCode: pr.code || null, sequence: (pr.seq === 'B' ? 'B' : 'A'),
      quiz: {}, survey: {}, results: [], roundPtr: 0, totalScore: 0, phaseMs: {}, phase: 'consent',
      startedAt: Date.now(), resumptions: 0,
      // A rehearsal must be able to show EITHER layout — the sandbox code is a
      // constant, so without this the admin could only ever see whichever side
      // its hash lands on, and half of what participants meet would never be
      // checked before a session opens. ?order=reveal|ask picks one.
      buttonOrder: (pr.order === 'reveal' || pr.order === 'reveal_first') ? 'reveal_first'
                 : (pr.order === 'ask' || pr.order === 'ask_first') ? 'ask_first'
                 : Specs.buttonOrder(P, 'PREVIEW')
    };
    // A rehearsal is ALWAYS local — it must reach no Function and write nothing.
    B = window.SVBackend.create({ serverMode: false, params: P, specs: SPECS });
    SPECS = B.specs;
    PLAN = { rounds: B.plan('PREVIEW', S.sequence) };
    if (pr.spec) {
      var only = PLAN.rounds.filter(function (r) { return r.spec.spec_id === pr.spec; });
      if (only.length) { PLAN.rounds = only; SPEC_LOCAL = pr.spec; }
    }
    if (pr.round) {
      var n = parseInt(pr.round, 10);
      if (isFinite(n) && n >= 1 && n <= PLAN.rounds.length) S.roundPtr = n - 1;
    }
    L.init({
      run_id: null, participant_code: 'PREVIEW', pid: 'PREVIEW',
      session: 'PREVIEW', sessionCode: pr.code || null, sequence: S.sequence,
      appVersion: CFG.APP_VERSION
    });
    wireGlobal();
    if (!document.getElementById('sv-ribbon')) {
      var rib = document.createElement('div');
      rib.id = 'sv-ribbon';
      rib.className = 'sv-ribbon';
      rib.innerHTML = '<span aria-hidden="true">🧪 </span><b>Test round</b> — this is a private sandbox. ' +
        'Nothing you do here is saved: no participant, no rounds, no events.';
      document.body.appendChild(rib);
    }
    $('nav-tag').textContent = 'PREVIEW · seq ' + S.sequence + (SPEC_LOCAL ? ' · ' + SPEC_LOCAL : '');
    $('nav-tag').style.display = '';
    DEBUG = true;
    // A rehearsal skips consent and the gates: the admin is testing the task.
    S.phase = 'round';
    route();
  }

  // ---- go ------------------------------------------------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Exposed ONLY for the offline test harness. Never the truth, never the pool.
  window.SVApp = {
    state: function () { return S ? { phase: S.phase, code: S.code, sequence: S.sequence, roundPtr: S.roundPtr, totalScore: S.totalScore } : null; },
    plan: function () { return PLAN ? PLAN.rounds.map(function (r) { return { i: r.round_index, spec: r.spec_id, block: r.block, cond: r.condition, scored: r.scored }; }) : null; },
    select: function (p) { setSel(p, 'test'); },
    selected: function () { return sel; },
    isPreview: function () { return PREVIEW; },
    // Which of two saved copies of a participant's progress would be continued
    // from — this browser's, or the one on their record. Exposed so the rule can
    // be tested directly: it is the part that could quietly go wrong, by sending
    // someone back through rounds they have already played. Read-only, and it
    // touches no session state.
    resumeChoice: function (a, b) { return furtherAlong(a, b); }
  };
})();
