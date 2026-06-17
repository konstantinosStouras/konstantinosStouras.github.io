/* =====================================================================
   Answer Arena — participant app
   ---------------------------------------------------------------------
   Phase flow (mirrors the PortfolioFit research structure):
     welcome -> tour -> register/login -> training -> main (N comparisons,
     random order) -> survey -> thank-you

   Each comparison shows one task card and two answer cards (from two
   unnamed systems, left/right randomized per participant). The participant
   taps the answer they prefer, or marks them equally good, then Next.

   Backend is via window.ArenaStore (Firebase when configured, else local).
   Does nothing on the admin view (?admin), which admin.js owns.
   ===================================================================== */
(function () {
  'use strict';
  if (/[?&]admin\b/.test(location.search)) return;     // admin.js owns ?admin

  var D = window.ARENA_DEFAULTS || {};
  var Store = window.ArenaStore;
  var cfg = mergeCfg({});                                // effective config (defaults + saved)
  var S = { phase: 'boot', user: null, p: null, tasks: [], order: [], flips: [], idx: 0, choice: null, session: null, condition: null, shownAt: 0 };

  /* ---- DOM helpers ---- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function $(s) { return document.querySelector(s); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function t(key, fb) { var v = cfg.texts && cfg.texts[key]; return (v == null || v === '') ? (fb || '') : v; }

  function mergeCfg(saved) {
    return {
      texts: Object.assign({}, D.texts, saved.texts || {}),
      settings: Object.assign({}, D.settings, saved.settings || {}, {
        twoByTwo: Object.assign({}, (D.settings || {}).twoByTwo, (saved.settings || {}).twoByTwo)
      }),
      registrationQuestions: (saved.registrationQuestions && saved.registrationQuestions.length) ? saved.registrationQuestions : (D.registrationQuestions || []),
      surveyQuestions: (saved.surveyQuestions && saved.surveyQuestions.length) ? saved.surveyQuestions : (D.surveyQuestions || []),
      tourSteps: D.tourSteps || []
    };
  }

  /* ---- Screen container + top bar ---- */
  function setScreen(node) {
    var root = $('#arena-screen');
    root.innerHTML = ''; root.appendChild(node);
    root.scrollTop = 0; window.scrollTo(0, 0);
  }
  function topbar() {
    var bar = $('#arena-top'); if (!bar) return;
    bar.innerHTML = '';
    if (!S.user) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    var who = (S.p && S.p.participantId) || (S.user && S.user.email) || '';
    bar.appendChild(el('span', { class: 'a-brand', html: esc((D.app && D.app.name) || 'Answer Arena') + ' &middot; <b>' + esc(who) + '</b>' }));
    bar.appendChild(el('button', { class: 'a-btn a-ghost a-sm', on: { click: logout } }, ['Log out']));
  }
  function card(title, kids, cls) { return el('div', { class: 'a-card ' + (cls || '') }, [title ? el('h2', { text: title }) : null].concat(kids || [])); }
  function overlayWrap(node) { return el('div', { class: 'a-wrap' }, [node]); }

  /* ============================ WELCOME ============================ */
  function showWelcome() {
    S.phase = 'welcome';
    var body = [el('p', { class: 'a-lead', html: t('welcomeIntro') })];
    (cfg.texts.welcomeBody || []).forEach(function (p) { body.push(el('p', { html: p })); });

    // Optional session code field (shown if required, or if one is in the URL).
    var codeField = null, urlCode = (location.search.match(/[?&]s=([A-Za-z0-9]+)/) || [])[1] || '';
    if (cfg.settings.requireSessionCode || urlCode) {
      var ci = el('input', { type: 'text', placeholder: 'Session code', value: urlCode, style: 'text-transform:uppercase;letter-spacing:.12em;' });
      codeField = ci;
      body.push(el('div', { class: 'a-field' }, [el('label', { text: 'Session code' + (cfg.settings.requireSessionCode ? ' *' : ' (optional)') }), ci]));
    }
    var err = el('div', { class: 'a-err' });
    body.push(err);
    body.push(el('p', { class: 'a-meta', text: 'About 5-10 minutes - please complete it in one sitting.' }));
    body.push(el('div', { class: 'a-row' }, [
      el('button', { class: 'a-btn', on: { click: go } }, [t('welcomeButton', 'Take a quick tour')]),
      el('button', { class: 'a-btn a-ghost', on: { click: showLogin } }, [t('loginLink', 'I already have an account')])
    ]));
    setScreen(overlayWrap(card(t('welcomeTitle', 'Welcome'), body, 'a-welcome')));

    function go() {
      err.textContent = '';
      var c = codeField ? codeField.value.trim().toUpperCase() : '';
      if (cfg.settings.requireSessionCode && !c) { err.textContent = 'Please enter the session code you were given.'; return; }
      if (!c) { startTour(); return; }
      Store.getSessionByCode(c).then(function (sess) {
        if (!sess) { err.textContent = 'That session code was not found.'; return; }
        if (sess.status === 'closed') { err.textContent = 'That session has closed.'; return; }
        if (sess.status === 'waiting') { err.textContent = 'That session has not opened yet. Please check back soon.'; return; }
        S.session = sess; startTour();
      }).catch(function () { err.textContent = 'Could not check the code. Please try again.'; });
    }
  }

  /* ============================ TOUR ============================== */
  // Renders a demo comparison behind a spotlight walkthrough.
  function startTour() {
    S.phase = 'tour';
    var demo = D.practiceTask || { title: 'Example task', task: 'An example task.', outputA: 'Answer one.', outputB: 'Answer two.' };
    var comp = buildComparison(demo, 1, 1, false, { demo: true });
    setScreen(overlayWrap(comp.node));
    runSpotlight(cfg.tourSteps || [], function () { showRegister(); });
  }

  function runSpotlight(steps, onDone) {
    if (!steps.length) { onDone(); return; }
    var i = 0;
    var tour = el('div', { class: 'a-tour' });
    var spot = el('div', { class: 'a-spot' });
    var tip = el('div', { class: 'a-tip' });
    tour.appendChild(spot); tour.appendChild(tip);
    document.body.appendChild(tour);
    var repos = function () { position(); };
    window.addEventListener('resize', repos); window.addEventListener('scroll', repos, true);
    show();
    function finish() { window.removeEventListener('resize', repos); window.removeEventListener('scroll', repos, true); tour.remove(); onDone(); }
    function show() {
      var s = steps[i], last = (i === steps.length - 1);
      tip.innerHTML = '';
      tip.appendChild(el('div', { class: 'a-step', text: 'Step ' + (i + 1) + ' of ' + steps.length }));
      tip.appendChild(el('h3', { text: s.title }));
      tip.appendChild(el('p', { html: s.body }));
      tip.appendChild(el('div', { class: 'a-tiprow' }, [
        el('button', { class: 'a-skip', on: { click: finish } }, ['Skip tour']),
        el('div', { class: 'a-row a-tight' }, [
          (i > 0) ? el('button', { class: 'a-btn a-ghost a-sm', on: { click: function () { i--; show(); } } }, ['Back']) : null,
          el('button', { class: 'a-btn a-sm', on: { click: function () { if (last) finish(); else { i++; show(); } } } }, [last ? 'Get started' : 'Next'])
        ])
      ]));
      var target = s.target ? document.querySelector('[data-tour="' + s.target + '"]') : null;
      if (target) { try { target.scrollIntoView({ block: 'center' }); } catch (e) {} }
      position();
    }
    function position() {
      var s = steps[i], target = s.target ? document.querySelector('[data-tour="' + s.target + '"]') : null;
      if (!target) { spot.style.cssText = 'width:0;height:0;left:50vw;top:50vh'; tip.style.left = '50%'; tip.style.top = '50%'; tip.style.transform = 'translate(-50%,-50%)'; return; }
      requestAnimationFrame(function () {
        var r = target.getBoundingClientRect(), pad = 8;
        spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
        tip.style.transform = 'none';
        var tw = Math.min(330, window.innerWidth - 24), th = tip.offsetHeight || 170;
        var left = Math.min(Math.max(12, r.left), window.innerWidth - tw - 12), top;
        if (r.bottom + 14 + th < window.innerHeight) top = r.bottom + 14;
        else if (r.top - 14 - th > 12) top = r.top - 14 - th;
        else top = Math.max(12, (window.innerHeight - th) / 2);
        tip.style.left = left + 'px'; tip.style.top = top + 'px';
      });
    }
  }

  /* ===================== REGISTRATION / LOGIN ===================== */
  function buildField(q) {
    var field = el('div', { class: 'a-field' });
    field.appendChild(el('label', { text: q.label + (q.required ? ' *' : '') }));
    if (q.help) field.appendChild(el('div', { class: 'a-help', text: q.help }));
    var input;
    if (q.type === 'select') {
      input = el('select', {}, [el('option', { value: '' }, ['Please select...'])].concat((q.options || []).map(function (o) { return el('option', { value: o }, [o]); })));
    } else if (q.type === 'radio') {
      input = el('div', { class: 'a-radio' });
      (q.options || []).forEach(function (o) { input.appendChild(el('label', {}, [el('input', { type: 'radio', name: q.id, value: o }), o])); });
    } else if (q.type === 'textarea') {
      input = el('textarea', { rows: '3' });
    } else {
      input = el('input', { type: q.type || 'text', autocomplete: q.system === 'email' ? 'username' : (q.system === 'password' ? 'new-password' : 'off') });
    }
    field.appendChild(input);
    return { q: q, node: input, read: function () { if (q.type === 'radio') { var s = input.querySelector('input:checked'); return s ? s.value : ''; } return (input.value || '').trim(); } };
  }

  function showRegister() {
    S.phase = 'register';
    var form = el('div', {});
    var fields = (cfg.registrationQuestions || []).map(function (q) { var f = buildField(q); form.appendChild(f.node.closest ? f.node.parentNode : f.node); return f; });
    var err = el('div', { class: 'a-err' });
    var submit = el('button', { class: 'a-btn', on: { click: doRegister } }, ['Create account & start']);
    form.appendChild(err);
    form.appendChild(el('div', { class: 'a-row' }, [submit, el('button', { class: 'a-btn a-ghost', on: { click: showLogin } }, [t('loginLink', 'I already have an account')])]));
    setScreen(overlayWrap(card(t('registerTitle', 'Create your account'), [el('p', { html: t('registerIntro') }), form])));

    function doRegister() {
      err.textContent = '';
      var answers = {}, email = '', password = '', participantId = '';
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], v = f.read();
        if (f.q.required && !v) { err.textContent = 'Please complete: ' + f.q.label; return; }
        if (f.q.system === 'email') email = v;
        else if (f.q.system === 'password') password = v;
        else if (f.q.system === 'participantId') participantId = v;
        else answers[f.q.id] = v;
      }
      if (!email) { err.textContent = 'Please enter your e-mail.'; return; }
      if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
      submit.setAttribute('disabled', 'true'); submit.textContent = 'Creating account...';
      Store.register(email, password).then(function (user) {
        S.user = user;
        var cond = assignCondition();
        var pdoc = {
          uid: user.uid, participantId: participantId || null, email: email,
          registration: answers, status: 'registered',
          sessionId: (S.session && S.session.id) || null, condition: cond,
          createdAt: nowStamp(), updatedAt: nowStamp()
        };
        return Store.setParticipant(user.uid, pdoc, false).then(function () {
          S.p = pdoc; S.condition = cond;
          topbar(); startTraining();
        });
      }).catch(function (e) {
        submit.removeAttribute('disabled'); submit.textContent = 'Create account & start';
        err.textContent = authError(e);
      });
    }
  }

  function showLogin() {
    S.phase = 'login';
    var email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' });
    var pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    var err = el('div', { class: 'a-err' });
    var btn = el('button', { class: 'a-btn', on: { click: doLogin } }, ['Log in']);
    setScreen(overlayWrap(card(t('loginTitle', 'Log in'), [
      el('div', { class: 'a-field' }, [el('label', { text: 'E-mail' }), email]),
      el('div', { class: 'a-field' }, [el('label', { text: 'Password' }), pass]),
      err,
      el('div', { class: 'a-row' }, [btn, el('button', { class: 'a-btn a-ghost', on: { click: showWelcome } }, ['Back'])])
    ])));
    function doLogin() {
      err.textContent = ''; btn.setAttribute('disabled', 'true'); btn.textContent = 'Logging in...';
      Store.login(email.value.trim(), pass.value).then(function (user) {
        S.user = user;
        // The admin account belongs in the admin panel, not the participant flow.
        if (Store.isAdminEmail(user.email)) { location.search = '?admin'; return; }
        return Store.getParticipant(user.uid).then(function (p) { S.p = p; topbar(); resumeFlow(); });
      }).catch(function (e) { btn.removeAttribute('disabled'); btn.textContent = 'Log in'; err.textContent = authError(e); });
    }
  }

  function authError(e) {
    var c = (e && e.code) || '';
    if (c.indexOf('email-already-in-use') >= 0) return 'That e-mail already has an account. Use "I already have an account".';
    if (c.indexOf('invalid-email') >= 0) return 'Please enter a valid e-mail address.';
    if (c.indexOf('wrong-password') >= 0 || c.indexOf('invalid-credential') >= 0) return 'Incorrect e-mail or password.';
    if (c.indexOf('user-not-found') >= 0) return 'No account found for that e-mail.';
    if (c.indexOf('weak-password') >= 0) return 'Password must be at least 6 characters.';
    return (e && e.message) || 'Something went wrong. Please try again.';
  }

  /* ===================== 2x2 CONDITION ===================== */
  function assignCondition() {
    var tt = (S.session && S.session.condition) || cfg.settings.twoByTwo || {};
    var f = tt.factors || { transparency: false, incentive: false };
    // Each switched-on condition is randomly varied (between-subjects, invisible
    // to the participant); a condition that is off is fixed at its baseline level.
    // both on = 4 groups, one on = 2 groups, none = a single baseline group.
    return {
      enabled: !!(f.transparency || f.incentive),
      transparency: f.transparency ? (Math.random() < 0.5 ? 'abstract' : 'translated') : 'abstract',
      incentive: f.incentive ? (Math.random() < 0.5 ? 'firm' : 'personal') : 'firm'
    };
  }
  // NB: the assigned 2x2 cell is recorded silently and is NEVER shown to the
  // participant. The design is blinded - subjects must not learn their
  // condition, or that multiple conditions exist.

  /* ============================ TRAINING ========================= */
  function startTraining() {
    S.phase = 'training';
    var demo = D.practiceTask;
    var intro = el('div', { class: 'a-card a-intro' }, [el('h2', { text: t('trainingTitle', "Let's practice") }), el('p', { html: t('trainingBody') })]);
    var comp = buildComparison(demo, 1, 1, false, { practice: true });
    var startBtn = el('button', { class: 'a-btn a-go', on: { click: function () { startBtn.setAttribute('disabled', 'true'); startMain(); } } }, [t('trainingButton', "I'm ready - start")]);
    startBtn.setAttribute('disabled', 'true');
    comp.onChoose = function () { startBtn.removeAttribute('disabled'); };
    var wrap = el('div', { class: 'a-wrap a-wide' }, [intro, comp.node, el('div', { class: 'a-row a-center' }, [startBtn])]);
    setScreen(wrap);
  }

  /* ============================ MAIN ============================= */
  function startMain() {
    S.phase = 'main';
    if (S.tasks.length && S.order.length) { renderComparison(); return; }
    setScreen(overlayWrap(card(t('mainTitle', 'Your comparisons'), [el('p', { text: 'Preparing your comparisons...' })])));
    Store.loadActiveTasks().then(function (set) {
      S.tasks = (set && set.tasks) || [];
      // Build a fresh, freshly-shuffled set every time the participant enters the
      // comparisons. Past progress is intentionally NOT resumed - each play
      // starts at comparison 1, no matter what was done in a previous play.
      // (Within a single page load the order is kept stable by the early return
      // at the top of startMain.)
      var n = S.tasks.length, lim = cfg.settings.comparisonsPerUser || 0;   // 0 = whole set
      var idxs = []; for (var i = 0; i < n; i++) idxs.push(i);
      if (cfg.settings.randomizeOrder !== false) shuffle(idxs);
      if (lim > 0 && lim < idxs.length) idxs = idxs.slice(0, lim);
      S.order = idxs; S.flips = idxs.map(function () { return Math.random() < 0.5; }); S.idx = 0;
      persist({ order: S.order, flips: S.flips, idx: 0, status: 'playing' });
      if (!S.order.length) { showThankYou(); return; }
      renderComparison();
    }).catch(function () { setScreen(overlayWrap(card('Problem', [el('p', { text: 'Could not load the comparisons. Please refresh.' })]))); });
  }

  function renderComparison() {
    if (S.idx >= S.order.length) { showSurvey(); return; }
    var task = S.tasks[S.order[S.idx]];
    var flip = !!S.flips[S.idx];
    S.choice = null; S.shownAt = Date.now();
    var comp = buildComparison(task, S.idx + 1, S.order.length, flip, {});
    var nextBtn = el('button', { class: 'a-btn a-go', on: { click: next } }, [(S.idx === S.order.length - 1) ? 'Finish' : 'Next']);
    nextBtn.setAttribute('data-tour', 'next');
    nextBtn.setAttribute('disabled', 'true');
    var hint = el('p', { class: 'a-maininfo', style: 'margin-top:10px;min-height:18px;', text: '' });
    // The follow-up (per-answer satisfaction + reason) must be completed before
    // Next becomes available, so every response carries a choice, two ratings
    // and a reason.
    comp.onChange = function (d) {
      S.choice = d.choice;
      if (d.complete) { nextBtn.removeAttribute('disabled'); hint.textContent = ''; }
      else { nextBtn.setAttribute('disabled', 'true'); hint.textContent = d.choice ? 'Rate each answer and add a short reason to continue.' : ''; }
    };
    var wrap = el('div', { class: 'a-wrap a-wide' }, [
      el('p', { class: 'a-maininfo', html: t('mainIntro') }),
      comp.node,
      el('div', { class: 'a-row a-center' }, [nextBtn]),
      hint
    ]);
    setScreen(wrap);

    // keyboard: 1/a left, 2/b right, 0/= tie, enter next (ignored while typing
    // the reason so letters/digits there are not read as answer shortcuts).
    document.onkeydown = function (e) {
      if (S.phase !== 'main') return;
      if (/^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '')) return;
      var k = e.key.toLowerCase();
      if (k === '1' || k === 'a') comp.pick('left');
      else if (k === '2' || k === 'b') comp.pick('right');
      else if (k === '0' || k === '=' || k === 't') comp.pick('tie');
      else if (k === 'enter') next();
    };

    var submitted = false;   // guard so a double Next/Enter cannot advance twice
    function next() {
      if (submitted) return;
      var d = comp.getData();
      if (!d.complete) return;
      submitted = true;
      document.onkeydown = null;
      var leftId = flip ? 'o2' : 'o1', rightId = flip ? 'o1' : 'o2';
      var chosenOutput = d.choice === 'tie' ? 'tie' : (d.choice === 'left' ? leftId : rightId);
      var resp = {
        taskId: task.id, idx: S.idx, leftOutput: leftId, rightOutput: rightId,
        choice: d.choice, chosenOutput: chosenOutput, responseMs: Date.now() - S.shownAt,
        reason: d.reason || '',
        satisfA: d.satisfA, satisfB: d.satisfB,                              // displayed Answer A / B
        satisfO1: leftId === 'o1' ? d.satisfA : d.satisfB,                   // mapped back to the model
        satisfO2: leftId === 'o2' ? d.satisfA : d.satisfB,
        condition: S.condition || (S.p && S.p.condition) || null, ts: Date.now()
      };
      if (S.user) Store.addResponse(S.user.uid, resp).catch(function () {});
      S.idx += 1;
      persist({ idx: S.idx });
      if (S.idx >= S.order.length) showSurvey(); else renderComparison();
    }
  }

  // A 1-5 satisfaction meter. Returns { node, get() }.
  function ratingWidget(label, onPick) {
    var current = null, btns = [];
    var row = el('div', { class: 'a-rate' });
    for (var v = 1; v <= 5; v++) {
      (function (val) {
        var b = el('button', { type: 'button', class: 'a-ratebtn', text: String(val), on: { click: function () { setVal(val); } } });
        btns.push(b); row.appendChild(b);
      })(v);
    }
    // Single-select: only the chosen level is highlighted; clicking another
    // level just moves the selection (participants can change it freely).
    function setVal(val) { current = val; btns.forEach(function (b, i) { b.classList.toggle('on', (i + 1) === val); }); if (onPick) onPick(val); }
    var node = el('div', { class: 'a-ratewrap' }, [
      el('div', { class: 'a-ratelabel', text: label }),
      row,
      el('div', { class: 'a-ratescale' }, [el('span', { text: '1 - Not at all' }), el('span', { text: '5 - Very' })])
    ]);
    return { node: node, get: function () { return current; }, setVal: setVal };
  }

  // Builds a task + two-answer comparison.
  // Returns { node, pick(side), getData(), onChoose, onChange }.
  function buildComparison(task, pos, total, flip, opts) {
    opts = opts || {};
    var leftText = flip ? task.outputB : task.outputA;
    var rightText = flip ? task.outputA : task.outputB;
    var api = { onChoose: null, onChange: null };
    var selected = null;
    var showFollow = !opts.demo;   // the tour demo stays a simple preview

    var progress = el('div', { class: 'a-progress', 'data-tour': 'progress' }, [
      el('div', { class: 'a-progbar' }, [el('div', { class: 'a-progfill' })]),
      el('div', { class: 'a-progtext', text: (opts.practice ? 'Practice' : (opts.demo ? 'Example' : 'Comparison ' + pos + ' of ' + total)) })
    ]);
    // fill = the comparisons completed before this one
    progress.querySelector('.a-progfill').style.width = Math.round((pos - 1) / total * 100) + '%';

    var taskCard = el('div', { class: 'a-taskcard', 'data-tour': 'task' }, [
      el('div', { class: 'a-tasklabel', text: 'TASK' + (task.domain ? ' · ' + task.domain : '') }),
      task.title ? el('div', { class: 'a-tasktitle', text: task.title }) : null,
      el('div', { class: 'a-tasktext', text: task.task || task.prompt || '' })
    ]);

    function answerCard(side, text, letter, tour) {
      var c = el('div', { class: 'a-answer', 'data-tour': tour }, [
        el('div', { class: 'a-anshead' }, [el('span', { class: 'a-anstag', text: 'Answer ' + letter }), el('span', { class: 'a-anscheck', text: '✓' })]),
        el('div', { class: 'a-anstext', text: text })
      ]);
      c.addEventListener('click', function () { pick(side); });
      return c;
    }
    var leftCard = answerCard('left', leftText, 'A', 'answerLeft');
    var rightCard = answerCard('right', rightText, 'B', 'answerRight');
    var tieBtn = el('button', { class: 'a-tie', 'data-tour': 'tie', on: { click: function () { pick('tie'); } } }, ["They're equally good"]);

    // Post-choice follow-up: a per-answer satisfaction rating and a free-text
    // reason, revealed only after a preference (or tie) is chosen.
    var satisfA = null, satisfB = null, reasonInput = null, rateA = null, rateB = null, follow = null;
    if (showFollow) {
      rateA = ratingWidget('How satisfied are you with Answer A?', function (v) { satisfA = v; change(); });
      rateB = ratingWidget('How satisfied are you with Answer B?', function (v) { satisfB = v; change(); });
      reasonInput = el('textarea', { rows: '3', placeholder: 'In a sentence or two, what made the difference?' });
      reasonInput.addEventListener('input', change);
      follow = el('div', { class: 'a-follow', 'data-tour': 'follow', style: 'display:none;' }, [
        el('div', { class: 'a-followhead', text: 'Tell us a little more' }),
        el('div', { class: 'a-rates' }, [rateA.node, rateB.node]),
        el('div', { class: 'a-field' }, [el('label', { text: 'Why did you make this choice?' }), reasonInput])
      ]);
    }

    function pick(side) {
      selected = side;
      leftCard.classList.toggle('sel', side === 'left');
      rightCard.classList.toggle('sel', side === 'right');
      tieBtn.classList.toggle('sel', side === 'tie');
      if (follow && follow.style.display === 'none') follow.style.display = 'block';
      if (api.onChoose) api.onChoose(side);
      change();
    }
    api.pick = pick;

    function data() {
      var reason = reasonInput ? reasonInput.value.trim() : '';
      var complete = selected != null && (!showFollow || (satisfA != null && satisfB != null && reason.length > 0));
      return { choice: selected, reason: reason, satisfA: satisfA, satisfB: satisfB, complete: complete };
    }
    function change() { if (api.onChange) api.onChange(data()); }

    var grid = el('div', { class: 'a-versus' }, [leftCard, el('div', { class: 'a-vs', text: 'vs' }), rightCard]);
    var node = el('div', { class: 'a-comp' + (opts.practice ? ' a-practice' : '') }, [progress, taskCard, grid, el('div', { class: 'a-tierow' }, [tieBtn]), follow]);
    return {
      node: node, pick: pick, getData: data,
      get onChoose() { return api.onChoose; }, set onChoose(v) { api.onChoose = v; },
      get onChange() { return api.onChange; }, set onChange(v) { api.onChange = v; }
    };
  }

  /* ============================ SURVEY =========================== */
  function showSurvey() {
    S.phase = 'survey';
    persist({ status: 'survey' });
    var form = el('div', {});
    var fields = (cfg.surveyQuestions || []).map(function (q) { var f = buildField(q); form.appendChild(f.node.parentNode); return f; });
    var err = el('div', { class: 'a-err' });
    var submit = el('button', { class: 'a-btn', on: { click: doSubmit } }, ['Submit']);
    form.appendChild(err);
    form.appendChild(el('div', { class: 'a-row' }, [submit]));
    setScreen(overlayWrap(card(t('surveyTitle', 'One last thing'), [el('p', { html: t('surveyIntro') }), form])));
    function doSubmit() {
      err.textContent = '';
      var answers = {};
      for (var i = 0; i < fields.length; i++) { var f = fields[i], v = f.read(); if (f.q.required && !v) { err.textContent = 'Please complete: ' + f.q.label; return; } answers[f.q.id] = v; }
      // Show the final page immediately and save in the background. The Firestore
      // client keeps the write locally and retries, so the participant is not
      // held on the network round-trip after their last click.
      if (S.user) Store.saveSurvey(S.user.uid, answers).catch(function () {});
      showThankYou();
    }
  }

  /* ========================== THANK YOU ========================== */
  function showThankYou() {
    S.phase = 'done';
    persist({ status: 'done' });
    setScreen(overlayWrap(card(t('thankyouTitle', 'Thank you!'), [
      el('p', { html: t('thankyouBody') }),
      el('div', { class: 'a-row' }, [el('button', { class: 'a-btn a-ghost', on: { click: logout } }, ['Log out'])])
    ], 'a-done')));
  }

  /* ============================ PLUMBING ========================= */
  function persist(patch) { if (S.user) Store.setParticipant(S.user.uid, Object.assign({ updatedAt: nowStamp() }, patch), true).catch(function () {}); if (S.p) Object.assign(S.p, patch); }
  function nowStamp() { return Date.now(); }
  function logout() { Store.logout().then(function () { location.href = location.pathname; }); }

  function resumeFlow() {
    S.condition = (S.p && S.p.condition) || null;
    var st = S.p && S.p.status;
    if (st === 'done') return showThankYou();
    if (st === 'survey') return showSurvey();
    // (re)start the comparisons from the beginning (progress is not resumed)
    startMain();
  }

  /* ============================ BOOT ============================= */
  function boot() {
    if (!Store) { setScreen(overlayWrap(card('Setup needed', [el('p', { text: 'arena-store.js failed to load.' })]))); return; }
    Store.init().then(function () {
      return Store.loadConfig().then(function (saved) { cfg = mergeCfg(saved || {}); });
    }).then(function () {
      Store.onAuth(function (user) {
        if (user && Store.isAdminEmail(user.email)) {
          // An admin signed in on the participant view: point them to ?admin.
          S.user = user;
          setScreen(overlayWrap(card('Admin account', [
            el('p', { html: 'You are signed in as <b>' + esc(user.email) + '</b>. The admin panel lives at <a href="?admin">?admin</a>.' }),
            el('div', { class: 'a-row' }, [el('button', { class: 'a-btn', on: { click: function () { location.search = '?admin'; } } }, ['Open admin panel']), el('button', { class: 'a-btn a-ghost', on: { click: logout } }, ['Log out'])])
          ])));
          return;
        }
        S.user = user || null;
        // Only the INITIAL auth state drives routing here. The register/login
        // flows handle their own routing, so later auth events must not re-route
        // (or clobber S.p while a participant doc is still being written).
        if (S.phase !== 'boot') { topbar(); return; }
        if (S.user) { Store.getParticipant(S.user.uid).then(function (p) { S.p = p; topbar(); resumeFlow(); }); }
        else { topbar(); showWelcome(); }
      });
    }).catch(function (e) {
      setScreen(overlayWrap(card('Connection problem', [el('p', { text: 'Could not start. Please refresh and try again.' })])));
      if (window.console) console.error('[Arena] boot failed', e);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
