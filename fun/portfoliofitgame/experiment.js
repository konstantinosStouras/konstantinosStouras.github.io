/* =====================================================================
   PortfolioFit for Managers — anonymous play layer
   ---------------------------------------------------------------------
   Turns the PortfolioFit game into a fully anonymous, session-aware flow:
     welcome  ->  training  ->  main phase  ->  stats  ->  survey  ->  thank-you
   plus per-action logging to a dedicated Firebase project.

   Anyone can play with NO sign-up: on the welcome screen a visitor is signed
   in anonymously (Firebase Anonymous Auth) and may optionally enter a session
   code to join a specific admin-created session (config stored at
   sessions/{code}). With no code, the default configuration (config/app, or
   the built-in defaults) is used. There is no e-mail/password registration.

   This layer is the DEFAULT experience at the bare URL (see the PF_EXPERIMENT
   flag in index.html). ?classic shows the original plain game; ?admin opens the
   CMS. If Firebase is unreachable or Anonymous Auth is not enabled, the layer
   falls back to OFFLINE mode: the default game is still playable, just without
   saving or session lookups.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.PF_EXPERIMENT) return;            // classic game / admin: do nothing

  // ---- Firebase web config (public by design; safe to commit) ----------
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBn8PhDyVhWvfiJVCpC1eW6q1LBfwpMu38',
    authDomain: 'stouras-portfoliofit.firebaseapp.com',
    projectId: 'stouras-portfoliofit',
    storageBucket: 'stouras-portfoliofit.firebasestorage.app',
    messagingSenderId: '1031513619365',
    appId: '1:1031513619365:web:dc3195fab2eaf04f6bc64c',
    measurementId: 'G-HKBTJVBS79'
  };
  var SDK = '10.12.2';
  var ADMIN_EMAIL = 'admin@admin.com';

  // ---- Editable content defaults (admin can override via config/app) ----
  var DEFAULTS = window.PF_DEFAULTS || {
    texts: {
      welcomeTitle: 'PortfolioFit',
      welcomeIntro: 'Welcome to <i>PortfolioFit</i>, a strategic project portfolio selection game.',
      welcomeBody: [
        'In this game, you drag and drop project <b>bricks</b> of different shapes into a frame. Each brick carries a <b>dollar value</b>, representing its potential contribution to your portfolio.',
        'Your challenge is to <b>build smart</b>: bricks must fit entirely <b>within the frame</b> and <b>cannot overlap</b>. The strategic element: every <b>empty cell</b> left in the frame carries a <b>$1 penalty</b>. Maximise your <b>net value</b> (total value of placed bricks minus the penalty for empty cells).',
        'This game has three phases: a <b>training phase</b>, a <b>game phase</b>, and a short <b>post-play survey</b>. You can play completely anonymously — no sign-up needed.'
      ],
      welcomeButton: 'Start',
      trainingTitle: 'Training phase',
      trainingBody: 'Each brick is a project that earns a dollar value when you place it in the frame. Choose the right projects and pack them in to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>How to play: tap a brick to select it, then tap a board tile to drop it. Use the arrow keys (or the Rotate / Flip buttons) to rotate and flip the selected brick; tap a placed brick to pick it back up.<br><br>This is a practice round. When the timer ends, or once you are comfortable, you will move on to the main game.',
      trainingButton: 'Begin training',
      registerTitle: 'Registration',
      registerIntro: 'Please provide some basic information about yourself.',
      mainIntro: 'Each brick is a project that earns a dollar value when you place it in the frame. Pack the right projects to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>Every brick shows its dollar value and its value-per-cell (ROI). The tempting high-ROI bricks are often traps: there are many ways to fill the board, but only one reaches the highest Net Value. You will play a series of timed puzzles; do your best on each one.',
      mainTitle: 'Game phase',
      statsTitle: 'Thank you for playing!',
      surveyTitle: 'Post-Game Survey',
      surveyIntro: 'Please share your thoughts about the experience (all fields are required).',
      thankyouTitle: 'Thank you for playing!',
      thankyouBody: 'Your responses have been recorded. You may now close this tab.'
    },
    settings: {
      trainingDifficulty: 'easy',
      puzzlesPerUser: { easy: 2, hard: 2 },
      randomizeOrder: true,
      activePuzzleIds: []
    },
    // Registration questions (matches the prototype form; admin-editable later).
    registrationQuestions: [
      { id: 'participantId', label: 'Participant ID', type: 'text', required: true, system: 'participantId' },
      { id: 'email', label: 'Personal E-mail', type: 'email', required: true, system: 'email' },
      { id: 'password', label: 'Password', type: 'password', required: true, system: 'password' },
      { id: 'mentalCalc', label: 'Mental Calculations', type: 'select', required: true,
        help: 'On a scale from 1 to 10, how good are you at mental calculations compared to the general population of this country? (1 very poor, 5 average, 10 very strong)',
        options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
      { id: 'mathsAtSchool', label: 'Mathematics at School', type: 'radio', required: true,
        help: 'Was maths among the five subjects you liked most at school?', options: ['Yes', 'No'] },
      { id: 'age', label: 'Age', type: 'number', required: true },
      { id: 'gender', label: 'Gender', type: 'select', required: true,
        options: ['Female', 'Male', 'Non-binary', 'Prefer not to say'] },
      { id: 'education', label: 'Education Level', type: 'select', required: true,
        options: ['High school', 'Bachelor', 'Master', 'PhD', 'Other'] },
      { id: 'workExp', label: 'Years of Work Experience', type: 'select', required: true,
        options: ['0', '1-3', '4-6', '7-10', '11-20', '20+'] },
      { id: 'mgmtExp', label: 'Years of Management Experience', type: 'select', required: true,
        options: ['0', '1-3', '4-6', '7-10', '11-20', '20+'] },
      { id: 'gamingExp', label: 'Gaming Experience', type: 'select', required: true,
        options: ['None', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] },
      { id: 'tetrisExp', label: 'Tetris Experience', type: 'select', required: true,
        options: ['None', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] }
    ],
    surveyQuestions: [
      { id: 's_satisfaction', label: 'How satisfied are you with your performance in the game?', type: 'select', required: true, options: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'] },
      { id: 's_difficulty', label: 'How would you rate the difficulty of the game?', type: 'select', required: true, options: ['Very easy', 'Easy', 'Moderate', 'Hard', 'Very hard'] },
      { id: 's_clarity', label: 'How clear were the game instructions and objectives?', type: 'select', required: true, options: ['Very unclear', 'Unclear', 'Neutral', 'Clear', 'Very clear'] },
      { id: 's_timeAdequate', label: 'Was the time limit adequate for completing the game?', type: 'select', required: true, options: ['Far too little', 'Too little', 'About right', 'Too much', 'Far too much'] },
      { id: 's_strategy', label: 'What strategy did you use to maximize your net value?', type: 'textarea', required: true },
      { id: 's_challenge', label: 'What was the most challenging aspect of the game?', type: 'textarea', required: true },
      { id: 's_improve', label: 'What improvements would you suggest for this game?', type: 'textarea', required: true },
      { id: 's_overall', label: 'Overall, how would you rate your experience?', type: 'select', required: true, options: ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'] },
      { id: 's_comments', label: 'Any additional comments or feedback?', type: 'textarea', required: true }
    ]
  };

  // ---- Runtime state ----------------------------------------------------
  var fb = null;                                  // Firebase handles once loaded
  var cfg = DEFAULTS;                             // merged config
  var S = {
    phase: 'boot', user: null, participant: null, sessionId: null, offline: false,
    seq: 0, buffer: [], roundIndex: 0, currentPuzzleId: null, flushing: false,
    queue: [], mainIndex: 0, rounds: []
  };
  var inited = false;

  // ---- Tiny DOM helpers -------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function $(s) { return document.querySelector(s); }

  // ---- Styles + control hiding -----------------------------------------
  function injectStyles() {
    document.body.classList.add('pf-exp');
    var css = ''
      + 'body.pf-exp #difficulty,body.pf-exp #newBtn,body.pf-exp #restartBtn,'
      + 'body.pf-exp #solBtn,body.pf-exp #proofBtn,body.pf-exp #hintBtn,body.pf-exp #solveBtn,'
      + 'body.pf-exp #boardMeta,body.pf-exp footer.app,body.pf-exp #acctRoot{display:none !important;}'
      + 'body.pf-exp .timer-wrap .timer-pill:last-child{display:none !important;}'
      + '.pfx-ov{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;'
      + 'padding:20px;background:rgba(40,30,15,.45);backdrop-filter:blur(3px);overflow:auto;}'
      + '.pfx-card{background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(60,45,20,.25);max-width:560px;width:100%;'
      + 'padding:28px 30px;margin:auto;font-family:Inter,system-ui,sans-serif;color:#2b2b2b;}'
      + '.pfx-card h2{font-family:"Space Grotesk",Inter,sans-serif;font-size:1.6rem;margin:0 0 6px;}'
      + '.pfx-card p{color:#4a4843;line-height:1.55;margin:0 0 12px;text-align:justify;}'
      + '.pfx-card .muted{color:#8a877f;font-size:13px;}'
      + '.pfx-btn{display:inline-block;border:none;background:#e67e22;color:#fff;font-weight:600;font-size:15px;'
      + 'padding:12px 22px;border-radius:12px;cursor:pointer;transition:.15s;}'
      + '.pfx-btn:hover{background:#cf6f17;}.pfx-btn.sec{background:#fff;color:#2b2b2b;border:1px solid #e0dbd0;}'
      + '.pfx-btn[disabled]{opacity:.5;cursor:default;}'
      + '.pfx-field{margin:12px 0;}.pfx-field label{display:block;font-weight:600;font-size:14px;margin-bottom:4px;}'
      + '.pfx-field .help{font-weight:400;color:#8a877f;font-size:12px;margin:2px 0 6px;}'
      + '.pfx-field input,.pfx-field select{width:100%;padding:10px 12px;border:1px solid #e0dbd0;border-radius:10px;font-size:14px;font-family:inherit;}'
      + '.pfx-field .radio{display:flex;gap:18px;}.pfx-field .radio label{font-weight:500;display:flex;align-items:center;gap:6px;}'
      + '.pfx-err{color:#e74c3c;font-size:13px;margin:6px 0;min-height:18px;}'
      + '.pfx-topbar{position:fixed;top:0;left:0;right:0;z-index:8000;display:flex;justify-content:space-between;align-items:center;'
      + 'gap:10px;padding:6px 14px;background:#2b2b2b;color:#fff;font-family:Inter,sans-serif;font-size:13px;}'
      + '.pfx-topbar b{color:#f1c40f;}.pfx-topbar button{background:transparent;border:1px solid #555;color:#eee;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;}'
      + 'body.pf-exp.pf-hastop{padding-top:42px;}'
      + 'body.pf-exp{padding-bottom:170px;}'
      + '.pfx-card.pfx-justify p{text-align:justify;}'
      + '.pfx-submit{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:8500;display:none;background:#2ecc71;color:#fff;border:2px solid #fff;font-weight:800;font-size:18px;letter-spacing:.2px;padding:16px 40px;border-radius:16px;box-shadow:0 14px 38px rgba(46,204,113,.6);cursor:pointer;text-align:center;}'
      + '.pfx-submit:hover{background:#27ae60;animation:none;}.pfx-submit.show{display:block;animation:pfxpulse 1.7s ease-in-out infinite;}'
      + '@keyframes pfxpulse{0%,100%{transform:translateX(-50%) scale(1);box-shadow:0 14px 34px rgba(46,204,113,.5);}50%{transform:translateX(-50%) scale(1.05);box-shadow:0 16px 50px rgba(46,204,113,.9);}}'
      + '.pfx-tour{position:fixed;inset:0;z-index:9000;pointer-events:none;}'
      + '.pfx-spot{position:absolute;border-radius:14px;box-shadow:0 0 0 9999px rgba(20,15,8,.74);transition:left .25s,top .25s,width .25s,height .25s;pointer-events:none;}'
      + '.pfx-tip{position:absolute;max-width:340px;width:calc(100vw - 24px);background:#fff;color:#2b2b2b;border-radius:14px;padding:16px 18px;box-shadow:0 18px 46px rgba(0,0,0,.35);pointer-events:auto;box-sizing:border-box;}'
      + '.pfx-tip h3{font-size:16px;margin:4px 0 6px;font-family:"Space Grotesk",Inter,sans-serif;text-align:left;}'
      + '.pfx-tip p{font-size:14px;line-height:1.55;margin:0 0 12px;color:#4a4843;text-align:left;}'
      + '.pfx-tip .pfx-step{font-size:11px;color:#8a877f;font-weight:700;text-transform:uppercase;letter-spacing:.06em;}'
      + '.pfx-tip .pfx-tiprow{display:flex;justify-content:space-between;align-items:center;gap:8px;}'
      + '.pfx-tip button{border:none;border-radius:9px;padding:8px 15px;font-weight:600;font-size:13px;cursor:pointer;}'
      + '.pfx-tip .pfx-next{background:#e67e22;color:#fff;}.pfx-tip .pfx-back{background:#f1ece3;color:#2b2b2b;}.pfx-tip .pfx-skip{background:transparent;color:#8a877f;padding-left:0;}'
      + '.pfx-reset{display:none;position:fixed;left:14px;bottom:14px;z-index:8400;background:#fff;border:1px solid #e0dbd0;border-radius:10px;padding:9px 13px;font-size:12px;font-weight:700;color:#2b2b2b;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.16);}'
      + '.pfx-reset:hover{background:#f6f3ee;}body.pf-playing .pfx-reset{display:block;}'
      + '.pfx-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}';
    document.head.appendChild(el('style', { text: css }));
  }

  // ---- Overlay management ----------------------------------------------
  var curOverlay = null;
  function closeOverlay() { if (curOverlay) { curOverlay.remove(); curOverlay = null; } }
  function showOverlay(card) {
    closeOverlay();
    curOverlay = el('div', { class: 'pfx-ov' }, [card]);
    document.body.appendChild(curOverlay);
    document.body.classList.remove('pf-playing');
  }

  // ---- Early-continue button (shown during a timed round) --------------
  // Lets a participant submit their portfolio before the timer ends; shows a
  // live countdown of the remaining time, refreshed twice a second.
  var submitBtn = null, submitTimer = null;
  function gameSubmitBtn() {
    if (!submitBtn) {
      submitBtn = el('button', { class: 'pfx-submit', on: { click: function () { hideGameSubmit(); if (window.PFGame) window.PFGame.endRound(); } } });
      document.body.appendChild(submitBtn);
    }
    return submitBtn;
  }
  function paintSubmit(label) {
    var b = gameSubmitBtn(), rem = 0;
    try { var m = window.PFGame && window.PFGame.getMetrics(); if (m && m.remaining != null) rem = m.remaining; } catch (e) {}
    b.innerHTML = esc(label) + '<br><span style="font-weight:600;font-size:13px;opacity:.92;">(or wait ' + fmtTime(rem) + ')</span>';
  }
  function showGameSubmit(label) {
    paintSubmit(label);
    gameSubmitBtn().classList.add('show');
    if (submitTimer) clearInterval(submitTimer);
    submitTimer = setInterval(function () { paintSubmit(label); }, 500);
  }
  function hideGameSubmit() {
    if (submitTimer) { clearInterval(submitTimer); submitTimer = null; }
    if (submitBtn) submitBtn.classList.remove('show');
  }

  // ---- Firebase ---------------------------------------------------------
  var FB_BASE = 'https://www.gstatic.com/firebasejs/' + SDK + '/';
  async function initFirebase() {
    var appM = await import(FB_BASE + 'firebase-app.js');
    var authM = await import(FB_BASE + 'firebase-auth.js');
    var fsM = await import(FB_BASE + 'firebase-firestore.js');
    // Use a NAMED app ('portfoliofit') so the experiment coexists with the page's
    // existing DEFAULT Firebase app (the snake/Account login) instead of colliding
    // with it (app/duplicate-app) or accidentally reusing snake's project.
    var APP_NAME = 'portfoliofit';
    var app;
    try { app = appM.getApp(APP_NAME); }
    catch (e) { app = appM.initializeApp(FIREBASE_CONFIG, APP_NAME); }
    fb = {
      app: app, auth: authM.getAuth(app), db: fsM.getFirestore(app),
      fns: null, A: authM, F: fsM, Fn: null
    };
    authM.onAuthStateChanged(fb.auth, onAuthChanged);
  }
  // Cloud Functions are optional: loaded on demand and non-fatal. If the module
  // fails to load, registration/survey fall back to direct Firestore writes, so
  // a functions hiccup never blocks the app from starting.
  async function ensureFunctions() {
    if (fb.Fn && fb.fns) return true;
    try {
      var fnM = await import(FB_BASE + 'firebase-functions.js');
      fb.Fn = fnM; fb.fns = fnM.getFunctions(fb.app, 'europe-west1');
      return true;
    } catch (e) { console.warn('[PFX] Cloud Functions unavailable; using direct writes', e); return false; }
  }

  // Load the effective configuration. With a session code, read sessions/{code}
  // (an admin-frozen snapshot); otherwise read the default config/app document.
  // Returns { ok, notFound } so the welcome screen can flag an unknown code.
  async function loadConfig(sessionId) {
    if (!fb || S.offline) { cfg = DEFAULTS; return { ok: false }; }
    try {
      var ref = sessionId ? fb.F.doc(fb.db, 'sessions', String(sessionId)) : fb.F.doc(fb.db, 'config', 'app');
      var snap = await fb.F.getDoc(ref);
      if (sessionId && !snap.exists()) return { ok: false, notFound: true };
      if (snap.exists()) {
        var d = snap.data();
        cfg = {
          texts: Object.assign({}, DEFAULTS.texts, d.texts || {}),
          settings: Object.assign({}, DEFAULTS.settings, d.settings || {}),
          registrationQuestions: DEFAULTS.registrationQuestions,
          surveyQuestions: (d.surveyQuestions && d.surveyQuestions.length) ? d.surveyQuestions : DEFAULTS.surveyQuestions
        };
      } else {
        cfg = DEFAULTS;
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }

  // Auth state changes only keep S.user fresh and drain the event buffer; routing
  // is driven explicitly by init() so anonymous sign-in cannot double-route.
  function onAuthChanged(user) {
    S.user = user || null;
    if (S.user) flush();
  }

  // ---- Event logging ----------------------------------------------------
  function logEvent(type, payload) {
    if (S.offline) return;                        // nothing to write to
    var ev = {
      seq: S.seq++, t: Date.now(), clientTime: new Date().toISOString(),
      phase: S.phase, round: S.roundIndex, puzzleId: S.currentPuzzleId || null,
      type: type, dataJson: safeJson(payload || {})
    };
    if (payload && payload.metrics) { ev.net = payload.metrics.net; ev.coverage = payload.metrics.coverage; }
    S.buffer.push(ev);
    flush();
  }
  function safeJson(o) { try { return JSON.stringify(o); } catch (e) { return '{}'; } }

  async function flush() {
    if (!fb || !S.user || S.flushing) return;
    S.flushing = true;
    try {
      while (S.buffer.length) {
        var ev = S.buffer[0];
        await fb.F.addDoc(
          fb.F.collection(fb.db, 'participants', S.user.uid, 'events'),
          Object.assign({ serverTime: fb.F.serverTimestamp() }, ev)
        );
        S.buffer.shift();
      }
    } catch (e) {
      console.warn('[PFX] event flush failed; will retry', e);
    } finally {
      S.flushing = false;
    }
  }
  // Game forwards every action here.
  window.PF = { onGameEvent: logEvent };

  // ---- Top bar ----------------------------------------------------------
  function renderTopbar() {
    var existing = $('.pfx-topbar'); if (existing) existing.remove();
    if (!S.user && !S.offline) return;
    document.body.classList.add('pf-hastop');
    var label = S.sessionId ? ('Session ' + S.sessionId) : 'Playing anonymously';
    var bar = el('div', { class: 'pfx-topbar' }, [
      el('span', { html: 'PortfolioFit for Managers &middot; <b>' + esc(label) + '</b>' }),
      el('button', { title: 'Start over with a fresh anonymous session', on: { click: doRestart } }, ['Restart'])
    ]);
    document.body.appendChild(bar);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ---- Screen helpers ---------------------------------------------------
  function card(title, kids) {
    return el('div', { class: 'pfx-card' }, [el('h2', { text: title })].concat(kids || []));
  }

  // ---- Phase: welcome ---------------------------------------------------
  // Anonymous entry point. A visitor may optionally type a session code (or one
  // can arrive prefilled via ?session=CODE); with no code the default config is
  // used. "Start" signs the player in anonymously and loads the right config.
  function showWelcome() {
    S.phase = 'welcome';
    var body = [el('p', { html: cfg.texts.welcomeIntro })];
    (cfg.texts.welcomeBody || []).forEach(function (p) { body.push(el('p', { html: p })); });

    var err = el('div', { class: 'pfx-err' });
    var sessInput = null;
    if (S.offline) {
      body.push(el('p', { class: 'muted', text: 'You appear to be offline, so your game will not be saved and session codes are unavailable. You can still play the default game.' }));
    } else {
      sessInput = el('input', { type: 'text', placeholder: 'e.g. SPRING25 (optional)', autocomplete: 'off', spellcheck: 'false', value: urlSession() || '' });
      body.push(el('div', { class: 'pfx-field' }, [
        el('label', { text: 'Session code (optional)' }),
        el('div', { class: 'help', text: 'Have a code from the organiser? Enter it to join that specific session. Otherwise just press Start to play the default game.' }),
        sessInput
      ]));
    }

    var startBtn = el('button', { class: 'pfx-btn', on: { click: onStart } }, [cfg.texts.welcomeButton || 'Start']);
    body.push(err, el('div', { class: 'pfx-row' }, [startBtn]));
    var wc = card(cfg.texts.welcomeTitle, body); wc.classList.add('pfx-justify');
    showOverlay(wc);

    async function onStart() {
      err.textContent = '';
      var sid = sessInput ? (sessInput.value || '').trim() : '';
      startBtn.setAttribute('disabled', 'true'); startBtn.textContent = 'Starting…';
      var res = await beginSession(sid);
      if (!res.ok) {
        startBtn.removeAttribute('disabled'); startBtn.textContent = cfg.texts.welcomeButton || 'Start';
        err.textContent = res.notFound
          ? ('No session found for code “' + sid + '”. Check the code and try again, or clear it to play the default game.')
          : 'Could not start just now. Please check your connection and try again.';
        return;
      }
      startTraining();
    }
  }

  // Read a session code from the URL (?session=CODE or ?s=CODE), if present.
  function urlSession() {
    var m = /[?&](?:session|s)=([^&]+)/.exec(location.search);
    try { return m ? decodeURIComponent(m[1]).trim() : ''; } catch (e) { return m ? m[1] : ''; }
  }

  // Sign in anonymously (if needed), load the chosen configuration, and create
  // the anonymous participant record. Returns { ok, notFound } for the welcome UI.
  async function beginSession(sid) {
    if (S.offline || !fb) { S.sessionId = null; cfg = DEFAULTS; return { ok: true }; }
    if (!S.user) {
      try { S.user = (await fb.A.signInAnonymously(fb.auth)).user; }
      catch (e) { console.warn('[PFX] anonymous sign-in failed', e); S.offline = true; cfg = DEFAULTS; return { ok: true }; }
    }
    if (sid) {
      var r = await loadConfig(sid);
      if (!r.ok) return { ok: false, notFound: !!r.notFound };
      S.sessionId = sid;
    } else {
      await loadConfig(null);
      S.sessionId = null;
    }
    await createParticipant();
    return { ok: true };
  }

  // Create (or refresh) this anonymous player's participant document, tagged with
  // the session code so the admin can group exported data by session.
  async function createParticipant() {
    if (!fb || !S.user || S.offline) return;
    var label = 'anon-' + S.user.uid.slice(0, 6);
    try {
      await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid), {
        uid: S.user.uid, anonymous: true, sessionId: S.sessionId || null,
        anonymousLabel: label, status: 'playing',
        createdAt: fb.F.serverTimestamp(), updatedAt: fb.F.serverTimestamp()
      }, { merge: true });
      S.participant = { anonymousLabel: label, sessionId: S.sessionId || null, status: 'playing' };
      renderTopbar();
    } catch (e) { console.warn('[PFX] participant create failed', e); }
  }

  // ---- Phase: training --------------------------------------------------
  function startTraining() {
    showOverlay(card(cfg.texts.trainingTitle, [
      el('p', { html: cfg.texts.trainingBody }),
      el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn', on: { click: runTraining } }, [cfg.texts.trainingButton || 'Begin training'])])
    ]));
  }
  function runTraining() {
    closeOverlay();
    document.body.classList.add('pf-playing');
    S.phase = 'training';
    S.roundIndex = 0;
    S.currentPuzzleId = 'training';
    var tdiff = (cfg.settings && cfg.settings.trainingDifficulty) || 'easy';
    window.PFGame._onRoundEnd = onTrainingEnd;
    window.PFGame.newGame(tdiff, limitFor(tdiff));
    // Pause the clock and run the onboarding tour over the live board first.
    if (window.PFGame.pauseTimer) window.PFGame.pauseTimer();
    showGameSubmit('Continue to the game');   // visible so the tour can highlight it
    runTour(function () {
      if (window.PFGame.resumeTimer) window.PFGame.resumeTimer();
      showGameSubmit('Continue to the game');
    });
  }

  // ---- Onboarding spotlight tour (before the first training round) -------
  function runTour(onDone) {
    var STEPS = [
      { center: true, title: 'How PortfolioFit works', text: 'Each brick is a project worth a dollar value. Pack the right projects into the frame to maximise your <b>net value</b> — the total value of placed bricks minus a $1 penalty for every empty cell. Time is limited, so plan well. Let’s take a quick tour.' },
      { sel: '.board-card', title: 'The board', text: 'This is your frame. Drop project bricks here to fill it. Every empty cell left over costs you $1.' },
      { sel: '#tray', title: 'Your project bricks', text: 'Tap a brick to select it, then tap a board tile to drop it. Use the arrow keys (or the Rotate / Flip buttons) to turn or flip it; tap a placed brick to pick it back up.' },
      { full: true, demo: true, title: 'See a move in action', text: 'Watch how placing bricks works…' },
      { sel: '.netcard', title: 'Net value', text: 'Your score: the total value of placed bricks minus the empty-cell penalty. The tempting high-ROI bricks are often traps — aim for the best portfolio, not just any fit.' },
      { sel: '.kpi-panel', title: 'Your KPIs', text: 'These update live as you build:<br><b>Total Value</b> — dollars of placed bricks.<br><b>Resource Cost</b> — the empty-cell penalty ($1 each).<br><b>Value / Resource</b> — your value-per-cell (ROI).<br><b>Coverage</b> — how much of the frame is filled.<br><b>Portfolio Fitness</b> — how close you are to the best possible net value.<br><i>Hover over any KPI to see a short explanation of what it means.</i>' },
      { sel: '.tools .tool:nth-of-type(1)', title: 'Calculator', text: 'Use the calculator to work out the value of each brick, its value-per-cell, or any other calculation you like while you plan your portfolio.' },
      { sel: '.tools .tool:nth-of-type(2)', title: 'My notes', text: 'Writing down your strategy really matters. Note the <b>heuristic</b> you follow (for example, do you grab the highest value-per-cell bricks first, or plan the whole fit?), what you are trying to <b>maximise</b> (your net value), and the reasoning behind each move. It helps you think clearly now and remember your approach later.' },
      { sel: '#status', title: 'Helpful nudges', text: 'Keep an eye just below the board: encouraging messages and reminders pop up here to help you keep going and reach your best net value.' },
      { center: true, title: 'Make it yours', text: 'Every box on this screen is yours to arrange. <b>Drag a box by its body to move it</b>, or <b>drag any edge or corner to resize it</b>, so the layout suits you. A “Reset layout” button (bottom-left) restores the default at any time.' },
      { sel: '.pfx-submit', title: 'When you are ready', text: 'When you are happy with your portfolio (or the time runs out) this green button takes you forward — during training, on to the main game.' }
    ];
    var i = 0;
    var tour = el('div', { class: 'pfx-tour' });
    var spot = el('div', { class: 'pfx-spot' });
    var tip = el('div', { class: 'pfx-tip' });
    tour.appendChild(spot); tour.appendChild(tip);
    document.body.appendChild(tour);
    var reposition = function () { position(); };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    show();

    function finish() {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      try { if (window.PFGame.demoClear) window.PFGame.demoClear(); } catch (e) {}
      tour.remove();
      if (onDone) onDone();
    }
    function navRow() {
      var last = (i === STEPS.length - 1);
      var back = (i > 0) ? el('button', { class: 'pfx-back', on: { click: function () { i--; show(); } } }, ['Back']) : el('span', {});
      var next = el('button', { class: 'pfx-next', on: { click: function () { if (last) finish(); else { i++; show(); } } } }, [last ? 'Start training' : 'Next']);
      return el('div', { class: 'pfx-tiprow' }, [el('button', { class: 'pfx-skip', on: { click: finish } }, ['Skip tour']), el('div', { style: 'display:flex;gap:8px;' }, [back, next])]);
    }
    function show() {
      var s = STEPS[i];
      tip.innerHTML = '';
      tip.appendChild(el('div', { class: 'pfx-step', text: 'Step ' + (i + 1) + ' of ' + STEPS.length }));
      tip.appendChild(el('h3', { text: s.title }));
      var body = el('p', { html: s.text });
      tip.appendChild(body);
      scrollStep();
      position();
      if (s.demo) {
        var row = el('div', { class: 'pfx-tiprow' }, []);
        var stopFn = null;
        var doneDemo = function () { stopFn = null; if (row.parentNode) row.remove(); tip.appendChild(navRow()); position(); };
        row.appendChild(el('button', { class: 'pfx-skip', on: { click: function () { if (stopFn) stopFn(); doneDemo(); } } }, ['Skip demo']));
        tip.appendChild(row);
        stopFn = runDemo(function (t) { body.innerHTML = t; }, doneDemo);
        return;
      }
      tip.appendChild(navRow());
    }
    function scrollStep() {
      var s = STEPS[i];
      var t = s.full ? document.querySelector('.board-card') : (s.center ? null : (s.sel ? document.querySelector(s.sel) : null));
      if (t) { try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {} }
    }
    function position() {
      var s = STEPS[i];
      if (s.full) {
        spot.style.left = '0px'; spot.style.top = '0px'; spot.style.width = window.innerWidth + 'px'; spot.style.height = window.innerHeight + 'px';
        tip.style.transform = 'translateX(-50%)'; tip.style.left = '50%'; tip.style.top = ''; tip.style.bottom = '16px';
        return;
      }
      tip.style.bottom = '';
      var target = s.center ? null : (s.sel ? document.querySelector(s.sel) : null);
      if (!target) {
        spot.style.width = '0px'; spot.style.height = '0px'; spot.style.left = '50vw'; spot.style.top = '50vh';
        tip.style.transform = 'translate(-50%,-50%)'; tip.style.left = '50%'; tip.style.top = '50%';
        return;
      }
      requestAnimationFrame(function () {
        var r = target.getBoundingClientRect(), pad = 8;
        spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
        tip.style.transform = 'none';
        var tipW = Math.min(340, window.innerWidth - 24), tipH = tip.offsetHeight || 170;
        var left = Math.min(Math.max(12, r.left), window.innerWidth - tipW - 12);
        var top;
        if (r.bottom + 14 + tipH < window.innerHeight) top = r.bottom + 14;
        else if (r.top - 14 - tipH > 12) top = r.top - 14 - tipH;
        else top = Math.max(12, (window.innerHeight - tipH) / 2);
        tip.style.left = left + 'px'; tip.style.top = top + 'px';
      });
    }
    function wait(ms, cb) { setTimeout(cb, ms); }
    function runDemo(setText, onComplete) {
      var seq = [
        function (cb) { setText('First, select a brick from your tray…'); try { window.PFGame.demoSelectSolution(0); } catch (e) {} wait(900, cb); },
        function (cb) { setText('…rotate or flip it to fit…'); try { window.PFGame.demoCycleOri(); } catch (e) {} wait(650, function () { try { window.PFGame.demoCycleOri(); } catch (e) {} wait(650, cb); }); },
        function (cb) { setText('…then place it on the board. Watch every KPI update at once.'); try { window.PFGame.demoPlaceSolution(0); } catch (e) {} wait(1500, cb); },
        function (cb) { setText('Add a second brick — the KPIs change again.'); try { window.PFGame.demoPlaceSolution(1); } catch (e) {} wait(1500, cb); },
        function (cb) { setText('You can remove a brick if you change your mind…'); try { window.PFGame.demoRemoveSolution(1); } catch (e) {} wait(1200, cb); },
        function (cb) { setText('…and try a different one. The KPIs always reflect your current portfolio.'); try { window.PFGame.demoPlaceSolution(2); } catch (e) {} wait(1600, cb); },
        function (cb) { setText('That’s the idea — arrange bricks to maximise your net value. The board is cleared so you can start fresh.'); try { window.PFGame.demoClear(); } catch (e) {} wait(1100, cb); }
      ];
      var idx = 0, stopped = false;
      function step() { if (stopped) return; if (idx >= seq.length) { onComplete(); return; } seq[idx++](step); }
      step();
      return function () { stopped = true; try { window.PFGame.demoClear(); } catch (e) {} };
    }
  }
  function onTrainingEnd(metrics) {
    window.PFGame._onRoundEnd = null;
    hideGameSubmit();
    logEvent('training_end', { trainingMetrics: metrics || null });
    setTimeout(function () { startMain(); }, 400);
  }

  // Load this anonymous player's existing participant record (used on reload to
  // resume them where they left off).
  async function loadParticipant() {
    if (!fb || !S.user) return;
    try {
      var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', S.user.uid));
      if (snap.exists()) { S.participant = snap.data(); renderTopbar(); }
    } catch (e) { /* ignore */ }
  }

  // "Restart" — drop the current anonymous identity and reload to a fresh
  // welcome screen (a brand-new anonymous session is created on next start).
  async function doRestart() {
    if (!window.confirm('Start over with a fresh anonymous session? Your current progress will be left as-is.')) return;
    try { if (fb && fb.auth) await fb.A.signOut(fb.auth); } catch (e) {}
    location.reload();
  }

  // ---- Phase: main (sequenced puzzles) ---------------------------------
  // Plays the participant's puzzle queue. Default 2 easy + 2 hard in random
  // order. When the admin freezes a specific set, buildQueue() will instead
  // load those exact puzzles by id (hook noted below).
  async function buildQueue() {
    var s = cfg.settings || {};
    var ids = s.activePuzzleIds || [];
    var q = [];
    if (ids.length && fb) {
      // Frozen set: replay the exact puzzles the admin approved.
      for (var k = 0; k < ids.length; k++) {
        try {
          var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'puzzleSets', ids[k]));
          if (snap.exists()) { var spec = specFromDoc(snap.data()); if (spec) q.push({ id: ids[k], diff: spec.diff, spec: spec }); }
        } catch (e) { /* skip */ }
      }
    }
    if (!q.length) {
      // Built-in default set (baked specs) when no custom set is frozen.
      var def = (window.PF_DEFAULTS && window.PF_DEFAULTS.defaultPuzzles) || [];
      for (var di = 0; di < def.length; di++) q.push({ id: 'default-' + di, diff: def[di].diff, spec: def[di] });
    }
    if (!q.length) {
      // Fallback: generate by difficulty counts.
      var per = s.puzzlesPerUser || { easy: 2, hard: 2 };
      var i;
      for (i = 0; i < (per.easy || 0); i++) q.push({ diff: 'easy' });
      for (i = 0; i < (per.hard || 0); i++) q.push({ diff: 'hard' });
    }
    if (s.randomizeOrder !== false) shuffle(q);
    return q;
  }
  function specFromDoc(d) { try { return JSON.parse(d.specJson); } catch (e) { return null; } }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Per-puzzle time budget (seconds): admin-configured if present, else built-in.
  function limitFor(diff) {
    var tl = (cfg.settings && cfg.settings.timeLimits) || (window.PF_DEFAULTS && window.PF_DEFAULTS.settings && window.PF_DEFAULTS.settings.timeLimits) || { easy: 120, hard: 180 };
    return (tl[diff] != null) ? tl[diff] : (diff === 'hard' ? 180 : 120);
  }
  function money(v) { v = Math.round(v || 0); return (v < 0 ? '-$' : '$') + Math.abs(v); }
  function fmtTime(s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60), ss = s % 60; return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }

  async function startMain() {
    S.phase = 'main';
    if (!S.queue || !S.queue.length) {
      showOverlay(card(cfg.texts.mainTitle || 'Game phase', [el('p', { text: 'Preparing puzzles...' })]));
      S.queue = await buildQueue(); S.mainIndex = 0; S.rounds = []; persistQueue();
    }
    var n = S.queue.length;
    showOverlay(card(cfg.texts.mainTitle || 'Game phase', [
      el('p', { html: cfg.texts.mainIntro }),
      el('p', { class: 'muted', html: 'You will play <b>' + n + '</b> puzzle' + (n === 1 ? '' : 's') + '. Maximise your net value in each before the timer ends.' }),
      el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn', on: { click: runNextPuzzle } }, [(S.mainIndex >= n) ? 'See your results' : ('Start puzzle ' + (S.mainIndex + 1) + ' of ' + n)])])
    ]));
  }
  async function persistQueue() {
    if (!fb || !S.user) return;
    try {
      await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid),
        { puzzleOrder: S.queue.map(function (x) { return { id: x.id || null, diff: x.diff }; }), mainIndex: S.mainIndex, status: 'playing', updatedAt: fb.F.serverTimestamp() }, { merge: true });
    } catch (e) { /* ignore */ }
  }
  async function persistProgress() {
    if (!fb || !S.user) return;
    try { await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid), { mainIndex: S.mainIndex, updatedAt: fb.F.serverTimestamp() }, { merge: true }); } catch (e) {}
  }
  // Rebuild the same queue a returning participant left off in (so a mid-game
  // reload continues rather than restarting puzzle 1 with a fresh random set).
  async function restoreQueue() {
    var order = (S.participant && S.participant.puzzleOrder) || [];
    if (!order.length) return false;
    var q = [];
    for (var i = 0; i < order.length; i++) {
      var o = order[i] || {};
      var id = o.id || null, diff = o.diff || 'easy', pushed = false;
      if (id && id.indexOf('default-') === 0) {
        var idx = parseInt(id.slice('default-'.length), 10);
        var dp = (window.PF_DEFAULTS && window.PF_DEFAULTS.defaultPuzzles) || [];
        if (dp[idx]) { q.push({ id: id, diff: dp[idx].diff, spec: dp[idx] }); pushed = true; }
      } else if (id) {
        try {
          var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'puzzleSets', id));
          if (snap.exists()) { var spec = specFromDoc(snap.data()); if (spec) { q.push({ id: id, diff: spec.diff, spec: spec }); pushed = true; } }
        } catch (e) {}
      }
      if (!pushed) q.push({ diff: diff });
    }
    S.queue = q;
    S.mainIndex = (S.participant.mainIndex != null) ? S.participant.mainIndex : 0;
    if (S.mainIndex > S.queue.length) S.mainIndex = S.queue.length;
    S.rounds = [];
    return true;
  }
  function runNextPuzzle() {
    closeOverlay();
    document.body.classList.add('pf-playing');
    if (S.mainIndex >= S.queue.length) { showStats(); return; }
    var item = S.queue[S.mainIndex];
    S.roundIndex = S.mainIndex + 1;
    S.currentPuzzleId = item.id || ('main-' + S.roundIndex + '-' + item.diff);
    window.PFGame._onRoundEnd = onMainRoundEnd;
    var lim = limitFor(item.diff);
    if (item.spec) window.PFGame.loadPuzzle(item.spec, lim);
    else window.PFGame.newGame(item.diff, lim);
    showGameSubmit('Submit portfolio & continue');
  }
  function onMainRoundEnd(metrics) {
    window.PFGame._onRoundEnd = null;
    hideGameSubmit();
    var placements = window.PFGame.getPlacements();
    var rec = Object.assign({ puzzleId: S.currentPuzzleId, index: S.roundIndex }, metrics || {});
    S.rounds.push(rec);
    writeRound(rec, placements);
    S.mainIndex += 1;
    persistProgress();
    var remaining = S.queue.length - S.mainIndex;
    setTimeout(function () { if (remaining <= 0) showStats(); else showInterstitial(remaining); }, 350);
  }
  function showInterstitial(remaining) {
    var doneN = S.mainIndex, total = S.queue.length, last = S.rounds[S.rounds.length - 1];
    showOverlay(card('Puzzle ' + doneN + ' complete', [
      el('p', { html: 'Net value this puzzle: <b>' + money(last && last.net) + '</b>.' }),
      el('p', { class: 'muted', text: remaining + ' puzzle' + (remaining === 1 ? '' : 's') + ' remaining.' }),
      el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn', on: { click: runNextPuzzle } }, ['Next puzzle (' + (doneN + 1) + ' of ' + total + ')'])])
    ]));
  }
  async function writeRound(rec, placements) {
    if (!fb || !S.user) return;
    try {
      await fb.F.addDoc(fb.F.collection(fb.db, 'participants', S.user.uid, 'rounds'),
        Object.assign({}, rec, { placementsJson: safeJson(placements || []), endedAt: fb.F.serverTimestamp() }));
    } catch (e) { console.warn('[PFX] round write failed', e); }
  }

  // ---- Phase: stats -----------------------------------------------------
  function showStats() {
    S.phase = 'stats';
    var rounds = S.rounds || [];
    var sum = function (f) { return rounds.reduce(function (a, r) { return a + (f(r) || 0); }, 0); };
    var totalValue = sum(function (r) { return r.value; });
    var totalCost = sum(function (r) { return r.cost; });
    var totalNet = sum(function (r) { return r.net; });
    var totalPlaced = sum(function (r) { return r.placed; });
    var totalCells = sum(function (r) { return r.total; });
    var coverage = totalCells ? Math.round(totalPlaced / totalCells * 100) : 0;
    var vpr = totalCost > 0 ? (totalValue / totalCost) : null;
    var fitVals = rounds.map(function (r) { return r.fitness; }).filter(function (x) { return x != null; });
    var fitness = fitVals.length ? Math.round(fitVals.reduce(function (a, b) { return a + b; }, 0) / fitVals.length) : null;
    var totalTime = sum(function (r) { return r.time; });

    var rows = [
      ['Total Value', money(totalValue)],
      ['Resource Cost', money(totalCost)],
      ['Net Value', money(totalNet)],
      ['Bricks Placed', String(totalPlaced)],
      ['Coverage', coverage + '%'],
      ['Value/Resource', vpr == null ? '—' : '$' + vpr.toFixed(2)],
      ['Portfolio Fitness', fitness == null ? 'N/A' : fitness + '%'],
      ['Total Time', fmtTime(totalTime)]
    ];
    var grid = el('div', { style: 'margin:14px 0;' }, rows.map(function (r) {
      return el('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece3;' },
        [el('span', { class: 'muted', text: r[0] }), el('b', { text: r[1] })]);
    }));
    showOverlay(card(cfg.texts.statsTitle || 'Thank you for playing!', [
      grid,
      el('p', { class: 'muted', text: 'Please complete a short survey about your experience.' }),
      el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn', on: { click: showSurvey } }, ['Continue to Survey'])])
    ]));
    if (fb && S.user) {
      try { fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid), { status: 'survey', stats: { totalNet: totalNet, coverage: coverage, totalTime: totalTime }, updatedAt: fb.F.serverTimestamp() }, { merge: true }); } catch (e) {}
    }
    logEvent('stats_shown', { totalNet: totalNet, coverage: coverage, totalTime: totalTime });
  }

  // ---- Phase: survey ----------------------------------------------------
  function buildField(q) {
    var field = el('div', { class: 'pfx-field' });
    field.appendChild(el('label', { text: q.label + (q.required ? ' *' : '') }));
    if (q.help) field.appendChild(el('div', { class: 'help', text: q.help }));
    var input;
    if (q.type === 'select') {
      input = el('select', {}, [el('option', { value: '' }, ['Please select...'])].concat(
        (q.options || []).map(function (o) { return el('option', { value: o }, [o]); })));
    } else if (q.type === 'radio') {
      input = el('div', { class: 'radio' });
      (q.options || []).forEach(function (o) { input.appendChild(el('label', {}, [el('input', { type: 'radio', name: q.id, value: o }), o])); });
    } else if (q.type === 'textarea') {
      input = el('textarea', { rows: '3', style: 'width:100%;padding:10px 12px;border:1px solid #e0dbd0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;' });
    } else {
      input = el('input', { type: q.type || 'text', autocomplete: 'off' });
    }
    field.appendChild(input);
    return {
      field: field, q: q,
      read: function () { if (q.type === 'radio') { var s = input.querySelector('input:checked'); return s ? s.value : ''; } return input.value.trim(); }
    };
  }
  function showSurvey() {
    S.phase = 'survey';
    var questions = (cfg.surveyQuestions && cfg.surveyQuestions.length) ? cfg.surveyQuestions : DEFAULTS.surveyQuestions;
    var form = el('div', {});
    var fields = questions.map(function (q) { var f = buildField(q); form.appendChild(f.field); return f; });
    var err = el('div', { class: 'pfx-err' });
    var submit = el('button', { class: 'pfx-btn', on: { click: doSubmit } }, ['Submit Survey']);
    form.appendChild(err);
    form.appendChild(el('div', { class: 'pfx-row' }, [submit]));
    showOverlay(card(cfg.texts.surveyTitle || 'Post-Game Survey', [
      el('p', { text: cfg.texts.surveyIntro || 'Please share your thoughts (all fields are required).' }), form
    ]));
    async function doSubmit() {
      err.textContent = '';
      var answers = {};
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], v = f.read();
        if (f.q.required && !v) { err.textContent = 'Please complete: ' + f.q.label; return; }
        answers[f.q.id] = v;
      }
      submit.setAttribute('disabled', 'true'); submit.textContent = 'Submitting...';
      // Offline: nothing to save — just acknowledge and finish.
      if (S.offline || !fb || !S.user) { showThankYou(); return; }
      try {
        try {
          if (!(await ensureFunctions())) throw new Error('functions unavailable');
          var fn = fb.Fn.httpsCallable(fb.fns, 'submitSurvey');
          await fn({ answers: answers });
        } catch (fnErr) {
          await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid, 'survey', 'answers'),
            { answers: answers, completedAt: fb.F.serverTimestamp() }, { merge: true });
          await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid), { status: 'done', updatedAt: fb.F.serverTimestamp() }, { merge: true });
        }
        logEvent('survey_submit', { count: Object.keys(answers).length });
        showThankYou();
      } catch (e) {
        submit.removeAttribute('disabled'); submit.textContent = 'Submit Survey';
        err.textContent = 'Could not submit. Please try again.';
      }
    }
  }

  // ---- Phase: thank-you -------------------------------------------------
  function showThankYou() {
    S.phase = 'thankyou';
    var tb = document.querySelector('.pfx-topbar'); if (tb) tb.remove();
    document.body.classList.remove('pf-hastop');
    showOverlay(card(cfg.texts.thankyouTitle || 'Thank you!', [
      el('p', { text: cfg.texts.thankyouBody || 'Your responses have been recorded. You may now close this tab.' })
    ]));
  }

  // Resume a returning participant at the right phase.
  async function resumeFlow() {
    var st = S.participant && S.participant.status;
    if (st === 'done') return showThankYou();
    if (st === 'survey') return showSurvey();
    if (st === 'playing') { try { await restoreQueue(); } catch (e) {} }
    startMain();
  }

  // ---- Movable / resizable boxes (experiment mode) ----------------------
  // Each main box gets a drag grip (top-right) and a resize handle (bottom-right);
  // positions/sizes persist in localStorage. A Reset-layout button restores the
  // default. Grips/handles only show during play (body.pf-playing).
  function loadLayout() { try { return JSON.parse(localStorage.getItem('pfx-layout')) || {}; } catch (e) { return {}; } }
  function saveLayout(m) { try { localStorage.setItem('pfx-layout', JSON.stringify(m)); } catch (e) {} }
  var _zTop = 5;
  function enableLayoutCustomize() {
    var defs = [
      ['netcard', '.netcard'], ['kpis', '.kpi-panel'], ['board', '.board-card'],
      ['bricks', '.game > div > .card'], ['calc', '.tools .tool:nth-of-type(1)'], ['notes', '.tools .tool:nth-of-type(2)']
    ];
    var saved = loadLayout(), any = false;
    defs.forEach(function (d) { var node = document.querySelector(d[1]); if (node) { setupMovable(d[0], node, saved[d[0]]); any = true; } });
    if (any && !document.querySelector('.pfx-reset')) {
      document.body.appendChild(el('button', { class: 'pfx-reset', title: 'Restore the default layout', on: { click: function () { try { localStorage.removeItem('pfx-layout'); } catch (e) {} location.reload(); } } }, ['↺ Reset layout']));
    }
  }
  function setupMovable(key, cardEl, st) {
    if (cardEl.dataset.pfxMove) return; cardEl.dataset.pfxMove = '1';
    if (getComputedStyle(cardEl).position === 'static') cardEl.style.position = 'relative';
    var cur = { x: (st && st.x) || 0, y: (st && st.y) || 0, w: (st && st.w) || null, h: (st && st.h) || null };
    if (cur.x || cur.y) cardEl.style.transform = 'translate(' + cur.x + 'px,' + cur.y + 'px)';
    if (cur.w) cardEl.style.width = cur.w + 'px';
    if (cur.h) { cardEl.style.height = cur.h + 'px'; cardEl.style.overflow = 'auto'; }

    var EDGE = 16, CORNER = 30, MINW = 150, MINH = 90, ds = null, rs = null;
    function playing() { return document.body.classList.contains('pf-playing'); }
    function persist() { var m = loadLayout(); m[key] = { x: cur.x || 0, y: cur.y || 0, w: cur.w || null, h: cur.h || null }; saveLayout(m); }
    function front() { cardEl.style.zIndex = String(++_zTop); }
    // Drag only from non-interactive parts so clicks on buttons/cells/inputs still work.
    function isInteractive(t) { return !!(t && t.closest && t.closest('button,input,textarea,select,a,label,kbd,.cell,.piece')); }
    function edgeAt(e, rect) {
      var x = e.clientX - rect.left, y = e.clientY - rect.top, w = rect.width, h = rect.height;
      // Wide corner zones (easy to grab) take priority over the thin edge bands.
      var cL = x <= CORNER, cR = x >= w - CORNER, cT = y <= CORNER, cB = y >= h - CORNER;
      if (cT && cL) return 'nw'; if (cT && cR) return 'ne'; if (cB && cL) return 'sw'; if (cB && cR) return 'se';
      var l = x <= EDGE, r = x >= w - EDGE, t = y <= EDGE, b = y >= h - EDGE;
      return t ? 'n' : b ? 's' : l ? 'w' : r ? 'e' : null;
    }
    function cursorFor(edge) { return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[edge] || ''; }
    function overlaps(aL, aT, aR, aB) {
      var others = document.querySelectorAll('[data-pfx-move="1"]');
      for (var k = 0; k < others.length; k++) {
        if (others[k] === cardEl) continue;
        var b = others[k].getBoundingClientRect();
        if (aL < b.right && aR > b.left && aT < b.bottom && aB > b.top) return true;
      }
      return false;
    }

    cardEl.addEventListener('pointerdown', function (e) {
      if (!playing() || e.button > 0) return;
      var rect = cardEl.getBoundingClientRect(), edge = edgeAt(e, rect);
      if (edge) {
        e.preventDefault(); try { cardEl.setPointerCapture(e.pointerId); } catch (x) {} front();
        rs = { edge: edge, px: e.clientX, py: e.clientY, w: cardEl.offsetWidth, h: cardEl.offsetHeight, x: cur.x, y: cur.y, L: rect.left, T: rect.top };
        cardEl.style.overflow = 'auto';
        return;
      }
      if (isInteractive(e.target)) return; // let the click happen
      e.preventDefault(); try { cardEl.setPointerCapture(e.pointerId); } catch (x) {} front();
      ds = { px: e.clientX, py: e.clientY, x: cur.x, y: cur.y, baseL: rect.left - cur.x, baseT: rect.top - cur.y, w: rect.width, h: rect.height };
    });

    cardEl.addEventListener('pointermove', function (e) {
      if (ds) {
        var tx = ds.x + (e.clientX - ds.px), ty = ds.y + (e.clientY - ds.py);
        if (!overlaps(ds.baseL + tx, ds.baseT + ty, ds.baseL + tx + ds.w, ds.baseT + ty + ds.h)) { cur.x = tx; cur.y = ty; }
        else {
          if (!overlaps(ds.baseL + tx, ds.baseT + cur.y, ds.baseL + tx + ds.w, ds.baseT + cur.y + ds.h)) cur.x = tx;
          if (!overlaps(ds.baseL + cur.x, ds.baseT + ty, ds.baseL + cur.x + ds.w, ds.baseT + ty + ds.h)) cur.y = ty;
        }
        cardEl.style.transform = 'translate(' + cur.x + 'px,' + cur.y + 'px)';
        return;
      }
      if (rs) {
        var dx = e.clientX - rs.px, dy = e.clientY - rs.py, nw = rs.w, nh = rs.h, nx = rs.x, ny = rs.y, ed = rs.edge;
        if (ed.indexOf('e') >= 0) nw = Math.max(MINW, rs.w + dx);
        if (ed.indexOf('s') >= 0) nh = Math.max(MINH, rs.h + dy);
        if (ed.indexOf('w') >= 0) { nw = Math.max(MINW, rs.w - dx); nx = rs.x + rs.w - nw; }
        if (ed.indexOf('n') >= 0) { nh = Math.max(MINH, rs.h - dy); ny = rs.y + rs.h - nh; }
        var aL = rs.L + (nx - rs.x), aT = rs.T + (ny - rs.y);
        if (!overlaps(aL, aT, aL + nw, aT + nh)) { cur.w = nw; cur.h = nh; cur.x = nx; cur.y = ny; cardEl.style.width = nw + 'px'; cardEl.style.height = nh + 'px'; cardEl.style.transform = 'translate(' + nx + 'px,' + ny + 'px)'; }
        return;
      }
      // idle: signal what a drag here would do via the cursor
      if (!playing()) { cardEl.style.cursor = ''; return; }
      var rect = cardEl.getBoundingClientRect(), edge = edgeAt(e, rect);
      cardEl.style.cursor = edge ? cursorFor(edge) : (isInteractive(e.target) ? '' : 'move');
    });

    function endOp() { if (ds || rs) { ds = null; rs = null; persist(); } }
    cardEl.addEventListener('pointerup', endOp);
    cardEl.addEventListener('pointercancel', endOp);
  }

  // Resolve the initial Firebase auth state once (restores a returning anonymous
  // player from a prior visit, or yields null for a brand-new visitor).
  function waitForAuth() {
    return new Promise(function (resolve) {
      var unsub = fb.A.onAuthStateChanged(fb.auth, function (u) { try { unsub(); } catch (e) {} resolve(u || null); });
    });
  }

  // Offline fallback: Firebase is unreachable or Anonymous Auth is disabled. The
  // default game stays fully playable; nothing is saved and codes are ignored.
  function startOffline() {
    S.offline = true; S.user = null; cfg = DEFAULTS;
    enableLayoutCustomize();
    showWelcome();
  }

  // ---- Bootstrap --------------------------------------------------------
  async function init() {
    if (inited) return; inited = true;
    injectStyles();
    showOverlay(card('Loading…', [el('p', { text: 'Connecting…' })]));

    try { await initFirebase(); }
    catch (e) { console.warn('[PFX] Firebase init failed; offline', e); return startOffline(); }

    // Determine who (if anyone) is already signed in on this device.
    var u = await waitForAuth();
    // An admin signed in on this device should not hijack the public flow.
    if (u && u.email === ADMIN_EMAIL) { try { await fb.A.signOut(fb.auth); } catch (e) {} u = null; }
    // No persisted user → sign in anonymously so config/sessions are readable.
    if (!u) {
      try { u = (await fb.A.signInAnonymously(fb.auth)).user; }
      catch (e) { console.warn('[PFX] anonymous sign-in unavailable; offline', e); return startOffline(); }
    }
    S.user = u;
    enableLayoutCustomize();

    // Returning player with progress → reload their session config and resume.
    await loadParticipant();
    if (S.participant && S.participant.status) {
      S.sessionId = S.participant.sessionId || null;
      await loadConfig(S.sessionId);
      renderTopbar();
      return resumeFlow();
    }

    // Fresh visitor: load the default config (for the welcome copy) and greet.
    await loadConfig(null);
    showWelcome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
