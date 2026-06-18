/* =====================================================================
   Answer Arena — participant app
   ---------------------------------------------------------------------
   Phase flow (mirrors the PortfolioFit research structure):
     welcome -> tour -> intake (anonymous: short demographics + consent, no
     account) -> training -> main (N comparisons, random order) -> survey ->
     thank-you

   Play is fully ANONYMOUS: there is no e-mail/password and no login. The
   participant signs in with a throwaway Firebase anonymous account when they
   submit the intake form. A session code is OPTIONAL - with one you join a
   specific admin-created session, without one you play the default config.

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
  var S = { phase: 'boot', user: null, p: null, tasks: [], order: [], flips: [], idx: 0, choice: null, session: null, condition: null, shownAt: 0, draft: null, spent: 0, showCost: false, costEl: null };

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
    var who = (S.p && S.p.participantId) || (S.user && S.user.email) || 'Guest';
    bar.appendChild(el('span', { class: 'a-brand', html: esc((D.app && D.app.name) || 'Answer Arena') + ' &middot; <b>' + esc(who) + '</b>' }));
    var right = el('div', { class: 'a-topright' });
    if (S.showCost) { S.costEl = el('span', { class: 'a-cost' }); right.appendChild(S.costEl); updateCostMeter(); }
    else { S.costEl = null; }
    right.appendChild(el('button', { class: 'a-btn a-ghost a-sm', on: { click: logout } }, ['Exit']));
    bar.appendChild(right);
  }
  // Cost-transparency meter: total US$ the participant's choices have cost so far.
  function fmtUSD(n) { n = Number(n) || 0; return '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2)); }
  function updateCostMeter() { if (S.costEl) S.costEl.innerHTML = 'Spent so far: <b>' + esc(fmtUSD(S.spent)) + '</b>'; }
  // US$ cost of a given underlying output for a task (o1=Output A, o2=Output B).
  function costOf(task, outputId) {
    var a = Number(task.costA) || 0, b = Number(task.costB) || 0;
    return outputId === 'o1' ? a : outputId === 'o2' ? b : (a + b) / 2;   // tie = average
  }
  function card(title, kids, cls) { return el('div', { class: 'a-card ' + (cls || '') }, [title ? el('h2', { text: title }) : null].concat(kids || [])); }
  function overlayWrap(node) { return el('div', { class: 'a-wrap' }, [node]); }
  // A centered confirm dialog over a dimmed backdrop. opts: { title, body, agree,
  // cancel, onAgree }. While it is open the comparison's keyboard shortcuts are
  // suspended so Enter cannot advance the screen behind it.
  function showModal(opts) {
    opts = opts || {};
    var prevKey = document.onkeydown; document.onkeydown = null;
    function close() { if (bd.parentNode) bd.parentNode.removeChild(bd); document.removeEventListener('keydown', onKey, true); document.onkeydown = prevKey; }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    var modal = el('div', { class: 'a-modal' }, [
      el('h3', { text: opts.title || 'Are you sure?' }),
      opts.body ? el('p', { text: opts.body }) : null,
      el('div', { class: 'a-row a-modalbtns' }, [
        el('button', { class: 'a-btn a-ghost', on: { click: close } }, [opts.cancel || 'Cancel']),
        el('button', { class: 'a-btn a-go', on: { click: function () { close(); if (opts.onAgree) opts.onAgree(); } } }, [opts.agree || 'OK'])
      ])
    ]);
    var bd = el('div', { class: 'a-modalbd', on: { click: function (e) { if (e.target === bd) close(); } } }, [modal]);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bd);
    return { close: close };
  }

  /* ============================ WELCOME ============================ */
  function showWelcome() {
    S.phase = 'welcome';
    var body = [el('p', { class: 'a-lead', html: t('welcomeIntro') })];
    (cfg.texts.welcomeBody || []).forEach(function (p) { body.push(el('p', { html: p })); });

    // A session code is OPTIONAL. With a code you join that specific session
    // (created by the admin); without one you play the default configuration.
    // The field is prefilled from a typed code or the ?s=CODE link if present.
    var urlCode = S.pendingCode || (location.search.match(/[?&]s=([A-Za-z0-9]+)/) || [])[1] || '';
    var codeField = el('input', { type: 'text', placeholder: 'Session code (optional)', value: urlCode, style: 'text-transform:uppercase;letter-spacing:.12em;' });
    body.push(el('div', { class: 'a-field' }, [
      el('label', { text: 'Session code (optional)' }),
      el('div', { class: 'a-help', text: 'Have a code from the organiser? Enter it to join that session. Otherwise just continue.' }),
      codeField
    ]));
    var err = el('div', { class: 'a-err' });
    body.push(err);
    body.push(el('p', { class: 'a-meta', text: 'No sign-up needed - you take part anonymously. About 5-10 minutes; please complete it in one sitting.' }));
    body.push(el('div', { class: 'a-row' }, [
      el('button', { class: 'a-btn', on: { click: go } }, [t('welcomeButton', 'Take a quick tour')])
    ]));
    setScreen(overlayWrap(card(t('welcomeTitle', 'Welcome'), body, 'a-welcome')));

    function go() {
      err.textContent = '';
      var c = codeField.value.trim().toUpperCase();
      S.pendingCode = c;
      // No code -> play the default configuration anonymously.
      if (!c) { S.session = null; startTour(); return; }
      // A code was given -> it must resolve to an open session.
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
    // Anonymous play: never ask for credentials. Drop any e-mail/password
    // questions even if an older saved config still lists them.
    var qs = (cfg.registrationQuestions || []).filter(function (q) { return q.system !== 'email' && q.system !== 'password'; });
    var fields = qs.map(function (q) { var f = buildField(q); form.appendChild(f.node.closest ? f.node.parentNode : f.node); return f; });
    var err = el('div', { class: 'a-err' });
    var submit = el('button', { class: 'a-btn', on: { click: doRegister } }, ['Start']);
    form.appendChild(err);
    form.appendChild(el('div', { class: 'a-row' }, [submit]));
    setScreen(overlayWrap(card(t('registerTitle', 'A few quick details'), [el('p', { html: t('registerIntro') }), form])));

    function doRegister() {
      err.textContent = '';
      var answers = {}, participantId = '';
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], v = f.read();
        if (f.q.required && !v) { err.textContent = 'Please complete: ' + f.q.label; return; }
        if (f.q.system === 'participantId') participantId = v;
        else answers[f.q.id] = v;
      }
      submit.setAttribute('disabled', 'true'); submit.textContent = 'Starting...';
      // Reuse an anonymous identity if one already exists (e.g. on a resumed
      // visit), else mint a fresh anonymous account.
      var existing = Store.currentUser();
      var signIn = existing ? Promise.resolve(existing) : Store.signInAnonymously();
      signIn.then(function (user) {
        S.user = user;
        var cond = assignCondition();
        var pdoc = {
          uid: user.uid, participantId: participantId || null, email: null, anonymous: true,
          registration: answers, status: 'registered',
          sessionId: curSid(), condition: cond, completedSessions: {},
          createdAt: nowStamp(), updatedAt: nowStamp()
        };
        return Store.setParticipant(user.uid, pdoc, false).then(function () {
          S.p = pdoc; S.condition = cond;
          topbar(); startTraining();
        });
      }).catch(function (e) {
        submit.removeAttribute('disabled'); submit.textContent = 'Start';
        err.textContent = authError(e);
      });
    }
  }

  function authError(e) {
    var c = (e && e.code) || '';
    if (c.indexOf('operation-not-allowed') >= 0 || c.indexOf('admin-restricted-operation') >= 0)
      return 'Anonymous play is not enabled yet. Please contact the study organiser.';
    if (c.indexOf('network-request-failed') >= 0) return 'Network problem. Please check your connection and try again.';
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
      incentive: f.incentive ? (Math.random() < 0.5 ? 'firm' : 'personal') : 'firm',
      transparencyOn: !!f.transparency,   // whether each factor was actually varied
      incentiveOn: !!f.incentive          // (lets the export show 1/0 vs blank)
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
      // How many comparisons, and whether to shuffle: prefer the values the
      // session was created with (snapshot), falling back to the live global
      // settings for older sessions that have no snapshot.
      var sess = S.session || {};
      var lim = (sess.comparisonsPerUser != null ? Number(sess.comparisonsPerUser) : (cfg.settings.comparisonsPerUser || 0)) || 0;
      var rnd = (sess.randomizeOrder != null) ? (sess.randomizeOrder !== false) : (cfg.settings.randomizeOrder !== false);
      var n = S.tasks.length;
      var idxs = []; for (var i = 0; i < n; i++) idxs.push(i);
      if (rnd) shuffle(idxs);
      if (lim > 0 && lim < idxs.length) idxs = idxs.slice(0, lim);
      S.order = idxs; S.flips = idxs.map(function () { return Math.random() < 0.5; }); S.idx = 0;
      // Cost transparency: the running US$ cost is reset for this play, and the
      // top-bar "Spent so far" meter is shown only to participants in the
      // transparent group (condition.transparency === 'translated') when the
      // active set actually carries per-answer costs.
      S.spent = 0;
      var hasCosts = S.tasks.some(function (t) { return (Number(t.costA) || 0) > 0 || (Number(t.costB) || 0) > 0; });
      S.showCost = !!(S.condition && S.condition.transparency === 'translated' && hasCosts);
      topbar();
      // Record this session as one the participant has played (so the admin's
      // per-session participant count includes anyone who started it, not only
      // those still on it or who finished it).
      var played = Object.assign({}, (S.p && S.p.playedSessions) || {});
      if (!played[curSid()]) played[curSid()] = nowStamp();
      persist({ order: S.order, flips: S.flips, idx: 0, status: 'playing', playedSessions: played });
      if (!S.order.length) { showThankYou(); return; }
      renderComparison();
    }).catch(function () { setScreen(overlayWrap(card('Problem', [el('p', { text: 'Could not load the comparisons. Please refresh.' })]))); });
  }

  function renderComparison() {
    if (S.idx >= S.order.length) { showSurvey(); return; }
    var task = S.tasks[S.order[S.idx]];
    var flip = !!S.flips[S.idx];
    var leftId = flip ? 'o2' : 'o1', rightId = flip ? 'o1' : 'o2';
    S.choice = null; S.shownAt = Date.now(); S.draft = null;
    var comp = buildComparison(task, S.idx + 1, S.order.length, flip, {});
    var nextBtn = el('button', { class: 'a-btn a-go', on: { click: next } }, [(S.idx === S.order.length - 1) ? 'Finish' : 'Next']);
    nextBtn.setAttribute('data-tour', 'next');
    nextBtn.setAttribute('disabled', 'true');
    // Long-list mode: an extra button lets the participant stop and go to the
    // survey once they've answered the current comparison.
    var longList = !!(cfg.settings && cfg.settings.longList);
    var proceedBtn = null;
    if (longList) {
      proceedBtn = el('button', { class: 'a-btn a-ghost', on: { click: askProceed } }, [t('proceedBtn', 'Proceed to Survey')]);
      proceedBtn.setAttribute('disabled', 'true');
    }
    var hint = el('p', { class: 'a-maininfo', style: 'margin-top:10px;min-height:18px;', text: '' });
    // Next/Proceed unlock once a choice is made (which reveals the preference bar);
    // every response carries the chosen side and the 7-point preference value.
    var draftTimer = null;
    // The model-framed preference: negative = baseline (o1) better, positive =
    // frontier (o2) better (the displayed A/B value re-framed to the models).
    function modelPref(v) { if (v == null) return null; var m = leftId === 'o1' ? v : -v; return m === 0 ? 0 : m; }
    comp.onChange = function (d) {
      S.choice = d.choice;
      if (d.complete) { nextBtn.removeAttribute('disabled'); if (proceedBtn) proceedBtn.removeAttribute('disabled'); hint.textContent = ''; }
      else { nextBtn.setAttribute('disabled', 'true'); if (proceedBtn) proceedBtn.setAttribute('disabled', 'true'); hint.textContent = ''; }
      // Keep a saved draft of the in-progress answer so nothing is lost if the
      // window is closed before Next is pressed.
      if (d.choice == null) return;
      S.draft = {
        taskId: task.id, idx: S.idx, sessionId: curSid(), leftOutput: leftId, rightOutput: rightId,
        choice: d.choice, chosenOutput: d.choice === 'tie' ? 'tie' : (d.choice === 'left' ? leftId : rightId),
        prefValue: d.prefValue, prefLabel: d.prefLabel, prefModelValue: modelPref(d.prefValue),
        condition: S.condition || (S.p && S.p.condition) || null,
        complete: !!d.complete, updatedAt: Date.now()
      };
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(function () { draftTimer = null; persist({ draftResponse: S.draft }); }, 500);
    };
    // Log every decision and every move of the preference bar, with its timestamp.
    // For a side choice, record which underlying model it refers to (leftId/rightId
    // map the displayed side back to o1/o2) so the export can name them.
    comp.onEvent = function (e) {
      if (!S.user) return;
      var model = e.type === 'choice' ? (e.value === 'tie' ? 'tie' : (e.value === 'left' ? leftId : rightId)) : '';
      Store.addEvent(S.user.uid, { type: e.type, value: e.value, model: model, taskId: task.id, idx: S.idx, sessionId: curSid(), ts: Date.now() }).catch(function () {});
    };
    var wrap = el('div', { class: 'a-wrap a-wide' }, [
      el('p', { class: 'a-maininfo', html: t('mainIntro') }),
      comp.node,
      el('div', { class: 'a-row a-center' }, [nextBtn].concat(proceedBtn ? [proceedBtn] : [])),
      hint
    ]);
    setScreen(wrap);

    // keyboard: 1/a left, 2/b right, 0/= tie, enter next (ignored while typing in
    // any input so letters/digits there are not read as answer shortcuts).
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
    // Save the current (complete) answer, exactly as Next does, and advance the
    // index. Returns false (and does nothing) if the comparison is unfinished or
    // already submitted, so Next and "Proceed to Survey" can share it safely.
    function commitCurrent() {
      if (submitted) return false;
      var d = comp.getData();
      if (!d.complete) return false;
      submitted = true;
      document.onkeydown = null;
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
      var chosenOutput = d.choice === 'tie' ? 'tie' : (d.choice === 'left' ? leftId : rightId);
      // Cost of the chosen answer (tie = average of the two); accumulate the
      // running total and update the meter. Recorded for everyone so the cost is
      // analysable even for the control group; only displayed to the transparent.
      var costA = Number(task.costA) || 0, costB = Number(task.costB) || 0;
      var answerCost = costOf(task, chosenOutput);
      S.spent += answerCost;
      updateCostMeter();
      var resp = {
        taskId: task.id, idx: S.idx, sessionId: curSid(), leftOutput: leftId, rightOutput: rightId,
        choice: d.choice, chosenOutput: chosenOutput, responseMs: Date.now() - S.shownAt,
        prefValue: d.prefValue, prefLabel: d.prefLabel, prefModelValue: modelPref(d.prefValue),
        costBaseline: costA, costFrontier: costB, answerCost: answerCost, runningCost: S.spent,
        condition: S.condition || (S.p && S.p.condition) || null, ts: Date.now()
      };
      if (S.user) Store.addResponse(S.user.uid, resp).catch(function () {});
      S.draft = null;
      S.idx += 1;
      persist({ idx: S.idx, draftResponse: null });   // submitted answer is saved; clear the draft
      return true;
    }
    function next() {
      if (!commitCurrent()) return;
      if (S.idx >= S.order.length) showSurvey(); else renderComparison();
    }
    // Long-list mode: once the current comparison is answered, the participant may
    // stop and jump to the survey. Confirm first; on Agree the current answer is
    // saved (like Next) and we go straight to the survey - no more comparisons.
    function askProceed() {
      if (submitted || !comp.getData().complete) return;
      showModal({
        title: t('proceedTitle', 'Proceed to the survey?'),
        body: t('proceedBody', "You'll move on to the final survey now and won't be able to do any more comparisons. Your answer to this comparison will be saved."),
        agree: t('proceedAgree', 'Agree, go to survey'),
        cancel: t('proceedDiscard', 'Discard, keep comparing'),
        onAgree: function () { if (commitCurrent()) showSurvey(); }
      });
    }
  }

  // Builds a task + two-answer comparison.
  // Returns { node, pick(side), getData(), onChoose, onChange }.
  function buildComparison(task, pos, total, flip, opts) {
    opts = opts || {};
    var leftText = flip ? task.outputB : task.outputA;
    var rightText = flip ? task.outputA : task.outputB;
    var api = { onChoose: null, onChange: null, onEvent: null };
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

    // Post-choice follow-up: a 7-point preference bar that sits centered below the
    // "They're equally good" button, revealed only after a choice is made. A =
    // Answer A (left), B = Answer B (right). The tour demo shows it expanded so the
    // walkthrough can point it out.
    var STEPS = [
      { v: -3, label: 'A much better' }, { v: -2, label: 'A better' }, { v: -1, label: 'A slightly better' },
      { v: 0, label: 'Equal' },
      { v: 1, label: 'B slightly better' }, { v: 2, label: 'B better' }, { v: 3, label: 'B much better' }
    ];
    var pref = null;             // -3..3 in the displayed A/B frame; null until chosen
    var segBtns = [], follow = null;
    if (showFollow || opts.demo) {
      var seg = el('div', { class: 'a-prefseg' });
      STEPS.forEach(function (s) {
        var b = el('button', { type: 'button', class: 'a-prefbtn ' + (s.v < 0 ? 'a-prefa' : s.v > 0 ? 'a-prefb' : 'a-prefmid'), on: { click: function () { setPref(s.v); } } }, [s.label]);
        segBtns.push(b); seg.appendChild(b);
      });
      follow = el('div', { class: 'a-follow a-preffollow', 'data-tour': 'follow', style: opts.demo ? '' : 'display:none;' }, [
        el('div', { class: 'a-prefhead', text: 'How do the two answers compare?' }),
        el('div', { class: 'a-prefends' }, [el('span', { class: 'a-prefend', text: 'Answer A' }), el('span', { class: 'a-prefend', text: 'Answer B' })]),
        seg
      ]);
    }
    // Reflect the current preference on the cards, the tie button and the bar.
    function renderSel() {
      var side = pref == null ? null : (pref < 0 ? 'left' : pref > 0 ? 'right' : 'tie');
      leftCard.classList.toggle('sel', side === 'left');
      rightCard.classList.toggle('sel', side === 'right');
      tieBtn.classList.toggle('sel', side === 'tie');
      segBtns.forEach(function (b, i) { b.classList.toggle('on', pref != null && STEPS[i].v === pref); });
    }
    function revealBar() { if (follow && follow.style.display === 'none') follow.style.display = 'block'; }
    // Exact 7-point preference (a bar segment click).
    function setPref(v) { pref = v; revealBar(); renderSel(); emit({ type: 'preference', value: v }); change(); }

    function pick(side) {
      // Tapping a card / tie picks a side and reveals the bar, seeded at a sensible
      // degree; the bar then lets them refine how much better. Re-tapping the same
      // side keeps the degree they already set.
      var seed = side === 'left' ? -2 : side === 'right' ? 2 : 0;
      if (pref != null && ((side === 'left' && pref < 0) || (side === 'right' && pref > 0) || (side === 'tie' && pref === 0))) seed = pref;
      pref = seed; revealBar(); renderSel();
      emit({ type: 'choice', value: side });
      if (api.onChoose) api.onChoose(side);
      change();
    }
    api.pick = pick;

    function data() {
      var side = pref == null ? null : (pref < 0 ? 'left' : pref > 0 ? 'right' : 'tie');
      var step = null; for (var i = 0; i < STEPS.length; i++) if (STEPS[i].v === pref) step = STEPS[i];
      return { choice: side, prefValue: pref, prefLabel: step ? step.label : '', complete: pref != null };
    }
    function change() { if (api.onChange) api.onChange(data()); }
    // Fires on every pick/rating change so the time of each decision - and of
    // each change to a new option - can be logged.
    function emit(e) { if (api.onEvent) api.onEvent(e); }

    var grid = el('div', { class: 'a-versus' }, [leftCard, el('div', { class: 'a-vs', text: 'vs' }), rightCard]);
    var node = el('div', { class: 'a-comp' + (opts.practice ? ' a-practice' : '') }, [progress, taskCard, grid, el('div', { class: 'a-tierow' }, [tieBtn]), follow]);
    return {
      node: node, pick: pick, getData: data,
      get onChoose() { return api.onChoose; }, set onChoose(v) { api.onChoose = v; },
      get onChange() { return api.onChange; }, set onChange(v) { api.onChange = v; },
      get onEvent() { return api.onEvent; }, set onEvent(v) { api.onEvent = v; }
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
      if (S.user) Store.saveSurvey(S.user.uid, curSid(), answers).catch(function () {});
      showThankYou();
    }
  }

  /* ========================== THANK YOU ========================== */
  function showThankYou() {
    S.phase = 'done';
    markCompleted();   // record this session as completed (cannot be retaken)
    setScreen(overlayWrap(card(t('thankyouTitle', 'Thank you!'), [
      el('p', { html: t('thankyouBody') }),
      el('div', { class: 'a-row' }, [el('button', { class: 'a-btn a-ghost', on: { click: logout } }, ['Start over'])])
    ], 'a-done')));
  }

  // Shown when a signed-in participant opens a session that is closed or not yet
  // open (the welcome flow shows the same for not-signed-in visitors).
  function showSessionUnavailable(status) {
    S.phase = 'welcome';
    setScreen(overlayWrap(card('Session unavailable', [
      el('p', { text: status === 'waiting' ? 'This session has not opened yet. Please check back soon.' : 'This session has closed.' }),
      el('div', { class: 'a-row' }, [el('button', { class: 'a-btn a-ghost', on: { click: logout } }, ['Start over'])])
    ])));
  }

  // Shown when a participant opens a session they have already finished. A user
  // can take part in many sessions, but each session only once.
  function showAlreadyDone() {
    S.phase = 'done';
    setScreen(overlayWrap(card('Already completed', [
      el('p', { html: 'You have already completed this session, so it cannot be taken again. Thank you for taking part!' }),
      el('p', { class: 'a-meta', text: 'Want to go again, or join a different session? Choose "Start over".' }),
      el('div', { class: 'a-row' }, [el('button', { class: 'a-btn a-ghost', on: { click: logout } }, ['Start over'])])
    ], 'a-done')));
  }

  /* ============================ PLUMBING ========================= */
  function persist(patch) { if (S.user) Store.setParticipant(S.user.uid, Object.assign({ updatedAt: nowStamp() }, patch), true).catch(function () {}); if (S.p) Object.assign(S.p, patch); }
  function nowStamp() { return Date.now(); }
  function logout() { Store.logout().then(function () { location.href = location.pathname; }); }

  // The id of the session being played right now ('_none' for a no-code/direct
  // play). Used to key per-session progress, completion and recorded data.
  function curSid() { return (S.session && S.session.id) || '_none'; }

  // Resolve which session this visit is for, from (in priority) an already
  // chosen session, a code typed on the welcome screen, or ?s=CODE in the URL.
  // A closed/waiting/unknown code resolves to no session.
  function resolveTargetSession() {
    if (S.session) return Promise.resolve(S.session);
    var c = S.pendingCode || (location.search.match(/[?&]s=([A-Za-z0-9]+)/) || [])[1] || '';
    if (!c) return Promise.resolve(null);
    return Store.getSessionByCode(String(c).toUpperCase()).then(function (sess) {
      if (sess) S.session = sess;   // status is checked in routeParticipant
      return S.session || null;
    }).catch(function () { return null; });
  }

  // Route a signed-in participant for the resolved target session: block one
  // they already completed, resume an in-progress survey, else (re)start the
  // comparisons. A user may take part in many sessions, but each only once.
  function routeParticipant() {
    if (!S.p) S.p = { uid: S.user.uid, email: (S.user && S.user.email) || null, status: 'registered', completedSessions: {} };
    if (S.session && (S.session.status === 'closed' || S.session.status === 'waiting')) { showSessionUnavailable(S.session.status); return; }
    var sid = curSid();
    // Each session - including the default no-code play (keyed '_none') - can be
    // taken only once per anonymous identity; "Start over" mints a fresh one.
    if (S.p.completedSessions && S.p.completedSessions[sid]) { showAlreadyDone(); return; }
    var sameSession = S.p.sessionId === sid;
    if (sameSession && S.p.status === 'survey') { S.condition = S.p.condition || null; showSurvey(); return; }
    S.condition = (sameSession && S.p.condition) ? S.p.condition : assignCondition();
    persist({ sessionId: sid, status: 'playing', condition: S.condition });
    startMain();
  }

  // Record the current session as completed so it cannot be retaken. Merges into
  // any existing completedSessions map (works on both the local and Firebase
  // backends, whose merge semantics differ).
  function markCompleted() {
    var cs = Object.assign({}, (S.p && S.p.completedSessions) || {});
    cs[curSid()] = nowStamp();
    persist({ status: 'done', completedSessions: cs });
  }

  // Best-effort save of the in-progress answer when the tab is hidden or closed,
  // so the current (not-yet-submitted) comparison is not lost. Completed
  // comparisons are already saved one-by-one as each Next is pressed.
  function flushDraftNow() {
    if (S.draft && S.user) Store.setParticipant(S.user.uid, { draftResponse: S.draft, updatedAt: nowStamp() }, true).catch(function () {});
  }

  /* ============================ BOOT ============================= */
  function boot() {
    if (!Store) { setScreen(overlayWrap(card('Setup needed', [el('p', { text: 'arena-store.js failed to load.' })]))); return; }
    // Save the in-progress answer if the participant leaves or closes the tab.
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushDraftNow(); });
    window.addEventListener('pagehide', flushDraftNow);
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
        // Only the INITIAL auth state drives routing here. The register flow
        // handles its own routing, so later auth events (e.g. the anonymous
        // sign-in it triggers) must not re-route or clobber S.p while the
        // participant doc is still being written.
        if (S.phase !== 'boot') { topbar(); return; }
        if (S.user) {
          // A returning anonymous visitor (anonymous auth persists across reloads).
          Promise.all([Store.getParticipant(S.user.uid), resolveTargetSession()]).then(function (res) {
            S.p = res[0]; topbar();
            // Signed in but never finished the short intake: capture it (reusing
            // this identity) before playing.
            if (!S.p) { showRegister(); return; }
            routeParticipant();
          });
        }
        else {
          topbar();
          // No account needed - everyone starts on the welcome screen. A shared
          // link (?s=CODE) just prefills the optional session code there.
          showWelcome();
        }
      });
    }).catch(function (e) {
      setScreen(overlayWrap(card('Connection problem', [el('p', { text: 'Could not start. Please refresh and try again.' })])));
      if (window.console) console.error('[Arena] boot failed', e);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
