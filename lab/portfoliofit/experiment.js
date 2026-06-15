/* =====================================================================
   PortfolioFit for Managers — experiment layer
   ---------------------------------------------------------------------
   Turns the PortfolioFit game into a research experiment:
     welcome  ->  training  ->  registration / login  ->  main phase
                ->  stats  ->  survey  ->  thank-you
   plus per-action logging to a dedicated Firebase project.

   This layer ONLY activates with ?exp=1 on the URL, so the default game
   at /lab/portfoliofit/ is completely unaffected until we switch it on.

   Status: foundation increment — welcome, training, auth (register/login)
   and Firestore event logging are live. Main-phase sequencing (fixed
   2 easy + 2 hard, random order), stats, survey and the admin panel are
   built in following increments and are stubbed/marked below.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.PF_EXPERIMENT) return;            // default game: do nothing

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
  var DEFAULTS = {
    texts: {
      welcomeTitle: 'PortfolioFit',
      welcomeIntro: 'Welcome to <i>PortfolioFit</i>, a strategic project portfolio selection game.',
      welcomeBody: [
        'In this game, you drag and drop project <b>bricks</b> of different shapes into a frame. Each brick carries a <b>dollar value</b>, representing its potential contribution to your portfolio.',
        'Your challenge is to <b>build smart</b>: bricks must fit entirely <b>within the frame</b> and <b>cannot overlap</b>. The strategic element: every <b>empty cell</b> left in the frame carries a <b>$1 penalty</b>. Maximise your <b>net value</b> (total value of placed bricks minus the penalty for empty cells).',
        'This game has four phases: a <b>training phase</b>, a <b>registration phase</b>, a <b>game phase</b>, and a <b>post-play survey</b>.'
      ],
      welcomeButton: 'Start training',
      trainingTitle: 'Training phase',
      trainingBody: 'Take a moment to get familiar with the controls on a simpler puzzle. Select a brick, place it on the board, and use rotate/flip to fit it. When the timer ends (or you fill the board) you will move on to registration.',
      trainingButton: 'Begin training',
      registerTitle: 'Registration',
      registerIntro: 'Please provide some basic information about yourself.',
      mainIntro: 'You will now play a series of timed puzzles. Maximise the net value of each portfolio before the timer runs out.',
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
    phase: 'boot', user: null, participant: null,
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
      + '.pfx-card.pfx-justify p{text-align:justify;}'
      + '.pfx-submit{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:8500;display:none;background:#2ecc71;color:#fff;border:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:14px;box-shadow:0 10px 28px rgba(46,204,113,.4);cursor:pointer;}'
      + '.pfx-submit:hover{background:#27ae60;}.pfx-submit.show{display:block;}'
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

  async function loadConfig() {
    if (!fb) return;
    try {
      var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'config', 'app'));
      if (snap.exists()) {
        var d = snap.data();
        cfg = {
          texts: Object.assign({}, DEFAULTS.texts, d.texts || {}),
          settings: Object.assign({}, DEFAULTS.settings, d.settings || {}),
          registrationQuestions: (d.registrationQuestions && d.registrationQuestions.length) ? d.registrationQuestions : DEFAULTS.registrationQuestions,
          surveyQuestions: d.surveyQuestions || []
        };
      }
    } catch (e) { /* fall back to defaults */ }
  }

  function onAuthChanged(user) {
    if (user && user.email === ADMIN_EMAIL) {
      // Admin panel is a later increment; for now, just note it.
      S.user = user;
      showOverlay(card('Admin', [
        el('p', { html: 'Signed in as <b>admin@admin.com</b>. The admin panel is being built in the next increment.' }),
        el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn sec', on: { click: doLogout } }, ['Log out'])])
      ]));
      return;
    }
    S.user = user || null;
    if (S.user) { renderTopbar(); flush(); }
  }

  // ---- Event logging ----------------------------------------------------
  function logEvent(type, payload) {
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
    if (!S.user) return;
    document.body.classList.add('pf-hastop');
    var label = (S.participant && S.participant.anonymousLabel) || (S.participant && S.participant.participantId) || S.user.email || '';
    var bar = el('div', { class: 'pfx-topbar' }, [
      el('span', { html: 'PortfolioFit for Managers &middot; <b>' + esc(label) + '</b>' }),
      el('button', { on: { click: doLogout } }, ['Log out'])
    ]);
    document.body.appendChild(bar);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ---- Screen helpers ---------------------------------------------------
  function card(title, kids) {
    return el('div', { class: 'pfx-card' }, [el('h2', { text: title })].concat(kids || []));
  }

  // ---- Phase: welcome ---------------------------------------------------
  function showWelcome() {
    S.phase = 'welcome';
    var body = [el('p', { html: cfg.texts.welcomeIntro })];
    (cfg.texts.welcomeBody || []).forEach(function (p) { body.push(el('p', { html: p })); });
    body.push(el('div', { class: 'pfx-row' }, [
      el('button', { class: 'pfx-btn', on: { click: startTraining } }, [cfg.texts.welcomeButton || 'Start training']),
      el('button', { class: 'pfx-btn sec', on: { click: showLogin } }, ['I already have an account'])
    ]));
    var wc = card(cfg.texts.welcomeTitle, body); wc.classList.add('pfx-justify');
    showOverlay(wc);
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
    S.phase = 'training';
    S.roundIndex = 0;
    S.currentPuzzleId = 'training';
    window.PFGame._onRoundEnd = onTrainingEnd;
    window.PFGame.newGame(cfg.settings.trainingDifficulty || 'easy');
    showGameSubmit('Continue to Registration');
  }
  function onTrainingEnd(metrics) {
    window.PFGame._onRoundEnd = null;
    hideGameSubmit();
    setTimeout(function () { showRegister(metrics); }, 400);
  }

  // ---- Phase: registration ---------------------------------------------
  function showRegister(trainingMetrics) {
    S.phase = 'register';
    var form = el('div', {});
    var inputs = {};
    cfg.registrationQuestions.forEach(function (q) {
      var field = el('div', { class: 'pfx-field' });
      field.appendChild(el('label', { text: q.label + (q.required ? ' *' : '') }));
      if (q.help) field.appendChild(el('div', { class: 'help', text: q.help }));
      var input;
      if (q.type === 'select') {
        input = el('select', {}, [el('option', { value: '' }, ['Please select...'])].concat(
          (q.options || []).map(function (o) { return el('option', { value: o }, [o]); })));
      } else if (q.type === 'radio') {
        input = el('div', { class: 'radio' });
        (q.options || []).forEach(function (o) {
          var id = 'r_' + q.id + '_' + o;
          input.appendChild(el('label', {}, [el('input', { type: 'radio', name: q.id, value: o, id: id }), o]));
        });
      } else {
        input = el('input', { type: q.type || 'text', autocomplete: 'off' });
      }
      inputs[q.id] = { q: q, node: input };
      field.appendChild(input);
      form.appendChild(field);
    });
    var err = el('div', { class: 'pfx-err' });
    var submit = el('button', { class: 'pfx-btn', on: { click: doRegister } }, ['Register & start']);
    form.appendChild(err);
    form.appendChild(el('div', { class: 'pfx-row' }, [submit,
      el('button', { class: 'pfx-btn sec', on: { click: showLogin } }, ['I already have an account'])]));

    var c = card(cfg.texts.registerTitle, [el('p', { text: cfg.texts.registerIntro }), form]);
    showOverlay(c);

    function readVal(entry) {
      if (entry.q.type === 'radio') { var sel = entry.node.querySelector('input:checked'); return sel ? sel.value : ''; }
      return entry.node.value.trim();
    }
    async function doRegister() {
      err.textContent = '';
      var answers = {}, email = '', password = '', participantId = '';
      for (var id in inputs) {
        var entry = inputs[id], v = readVal(entry);
        if (entry.q.required && !v) { err.textContent = 'Please complete: ' + entry.q.label; return; }
        if (entry.q.system === 'email') email = v;
        else if (entry.q.system === 'password') password = v;
        else if (entry.q.system === 'participantId') participantId = v;
        else answers[id] = v;
      }
      if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
      submit.setAttribute('disabled', 'true'); submit.textContent = 'Creating account...';
      try {
        var cred = await fb.A.createUserWithEmailAndPassword(fb.auth, email, password);
        var uid = cred.user.uid;
        // Try the Cloud Function (atomic label); fall back to a direct write.
        try {
          if (!(await ensureFunctions())) throw new Error('functions unavailable');
          var fn = fb.Fn.httpsCallable(fb.fns, 'registerParticipant');
          var res = await fn({ participantId: participantId, answers: answers });
          S.participant = { participantId: participantId, anonymousLabel: res.data && res.data.anonymousLabel };
        } catch (fnErr) {
          await fb.F.setDoc(fb.F.doc(fb.db, 'participants', uid), {
            uid: uid, participantId: participantId, email: email, registration: answers,
            status: 'registered', anonymousLabel: null,
            createdAt: fb.F.serverTimestamp(), updatedAt: fb.F.serverTimestamp()
          });
          S.participant = { participantId: participantId, anonymousLabel: null };
        }
        logEvent('register', { participantId: participantId, trainingMetrics: trainingMetrics || null });
        closeOverlay(); renderTopbar(); startMain();
      } catch (e) {
        submit.removeAttribute('disabled'); submit.textContent = 'Register & start';
        err.textContent = friendlyAuthError(e);
      }
    }
  }

  // ---- Login ------------------------------------------------------------
  function showLogin() {
    S.phase = 'login';
    var email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' });
    var pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    var err = el('div', { class: 'pfx-err' });
    var btn = el('button', { class: 'pfx-btn', on: { click: doLogin } }, ['Log in']);
    showOverlay(card('Log in', [
      el('div', { class: 'pfx-field' }, [el('label', { text: 'E-mail' }), email]),
      el('div', { class: 'pfx-field' }, [el('label', { text: 'Password' }), pass]),
      err,
      el('div', { class: 'pfx-row' }, [btn, el('button', { class: 'pfx-btn sec', on: { click: showWelcome } }, ['Back'])])
    ]));
    async function doLogin() {
      err.textContent = '';
      btn.setAttribute('disabled', 'true'); btn.textContent = 'Logging in...';
      try {
        await fb.A.signInWithEmailAndPassword(fb.auth, email.value.trim(), pass.value);
        // onAuthChanged handles admin; for participants, resume into main.
        if (email.value.trim() !== ADMIN_EMAIL) { closeOverlay(); await loadParticipant(); startMain(); }
      } catch (e) {
        btn.removeAttribute('disabled'); btn.textContent = 'Log in';
        err.textContent = friendlyAuthError(e);
      }
    }
  }

  async function loadParticipant() {
    if (!fb || !S.user) return;
    try {
      var snap = await fb.F.getDoc(fb.F.doc(fb.db, 'participants', S.user.uid));
      if (snap.exists()) { S.participant = snap.data(); renderTopbar(); }
    } catch (e) { /* ignore */ }
  }

  async function doLogout() {
    try { await fb.A.signOut(fb.auth); } catch (e) {}
    location.reload();
  }

  function friendlyAuthError(e) {
    var c = (e && e.code) || '';
    if (c.indexOf('email-already-in-use') >= 0) return 'That e-mail already has an account. Use "I already have an account".';
    if (c.indexOf('invalid-email') >= 0) return 'Please enter a valid e-mail address.';
    if (c.indexOf('wrong-password') >= 0 || c.indexOf('invalid-credential') >= 0) return 'Incorrect e-mail or password.';
    if (c.indexOf('user-not-found') >= 0) return 'No account found for that e-mail.';
    if (c.indexOf('weak-password') >= 0) return 'Password must be at least 6 characters.';
    return (e && e.message) || 'Something went wrong. Please try again.';
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
      el('div', { class: 'pfx-row' }, [el('button', { class: 'pfx-btn', on: { click: runNextPuzzle } }, ['Start puzzle 1 of ' + n])])
    ]));
  }
  async function persistQueue() {
    if (!fb || !S.user) return;
    try {
      await fb.F.setDoc(fb.F.doc(fb.db, 'participants', S.user.uid),
        { puzzleOrder: S.queue.map(function (x) { return x.id || x.diff; }), status: 'playing', updatedAt: fb.F.serverTimestamp() }, { merge: true });
    } catch (e) { /* ignore */ }
  }
  function runNextPuzzle() {
    closeOverlay();
    if (S.mainIndex >= S.queue.length) { showStats(); return; }
    var item = S.queue[S.mainIndex];
    S.roundIndex = S.mainIndex + 1;
    S.currentPuzzleId = item.id || ('main-' + S.roundIndex + '-' + item.diff);
    window.PFGame._onRoundEnd = onMainRoundEnd;
    if (item.spec) window.PFGame.loadPuzzle(item.spec);
    else window.PFGame.newGame(item.diff);
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
  function resumeFlow() {
    var st = S.participant && S.participant.status;
    if (st === 'done') return showThankYou();
    if (st === 'survey') return showSurvey();
    startMain();
  }

  // ---- Bootstrap --------------------------------------------------------
  async function init() {
    if (inited) return; inited = true;
    injectStyles();
    showOverlay(card('Loading...', [el('p', { text: 'Connecting...' })]));
    try {
      await initFirebase();
      await loadConfig();
    } catch (e) {
      showOverlay(card('Connection problem', [el('p', { text: 'Could not connect to the server. Please refresh and try again.' })]));
      console.error('[PFX] init failed', e);
      return;
    }
    // If already signed in (returning user), resume; else show welcome.
    if (fb.auth.currentUser) { S.user = fb.auth.currentUser; await loadParticipant(); resumeFlow(); }
    else showWelcome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
