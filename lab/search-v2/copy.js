/* ==========================================================================
   search-v2  ·  copy.js
   EVERY word a participant can see, in ONE place.

   Why this file exists
   --------------------
   The participant copy used to live in three places at once: prose blocks in
   app.js (BUILTIN), headings/buttons/labels hard-coded in index.html, and an
   ABRIDGED mirror of the prose in admin/admin.js used only as textarea
   placeholders. So the admin panel showed "…(built-in default)" stubs for a few
   screens and nothing at all for the rest — the comprehension ("Quick check")
   questions, the exit survey, every heading, button, counter label and dialog
   were invisible to, and un-editable by, the researcher running the study.

   Now this module is the single source of truth, loaded by BOTH the participant
   app and the admin panel:
     · TEXT    — every string, verbatim, keyed.
     · QUIZ    — the comprehension questions (prompt, options, correct answer).
     · SURVEY  — the exit-survey questions.
     · GROUPS  — how the admin panel lays those out as editable fields.
     · subTokens() — the {token} expansion, shared so the admin's PLACEHOLDERS
       render exactly the words the participant will read, using the settings
       currently in the form (round counts, fees, AI model prices).

   Adding a participant-facing string: add it to TEXT, list it in GROUPS, and
   read it through the app's T()/content() resolver (or a data-copy attribute in
   index.html). Never hard-code participant text anywhere else.

   Loaded in the browser as window.SVCopy; also require()-able from Node
   (tools/selftest.js) so the copy can be checked offline.
   ========================================================================== */
(function (root, factory) {
  var C = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = C; // Node
  if (root) root.SVCopy = C;                                              // browser
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ======================================================================
  //  TEXT — every participant-facing string, verbatim.
  //  Tokens in {braces} are expanded by subTokens() (study-wide values) and by
  //  the app's T() (per-moment values like {round} or {net}).
  // ======================================================================
  var TEXT = {

    // ---- site chrome -----------------------------------------------------
    brand: 'Search for Knowledge',
    loading: 'Loading…',
    logoutBtn: 'Log out',
    logoutTip: 'Log out and clear this study on this device',
    logoutConfirm: 'Log out and clear this study on this device? Your progress on this device will be erased.',
    nudgeDismiss: 'Dismiss',

    // Participant-facing names of the two conditions. Shown on the round label
    // and the results tables of a within-subjects session.
    phaseLabelA: 'Without AI',
    phaseLabelB: 'With AI',

    // ---- study closed ----------------------------------------------------
    closedTitle: 'This study is not currently open',
    closed: 'Thank you for your interest. Recruitment for this study is paused or complete right now. If you reached this page from a study listing, please return to the platform — no action is needed.',

    // ---- session-code gate ----------------------------------------------
    codeTitle: 'Enter your session code',
    codeIntro: 'To take part you need a session code. If you arrived from a study listing (for example Prolific), please open the study using the link you were given — your code is filled in automatically and you will not see this screen. Otherwise, enter your session code below.',
    codePlaceholder: 'Session code',
    codeBtn: 'Continue',
    codeError: 'Please enter your session code to continue.',

    // ---- consent ---------------------------------------------------------
    consentTitle: 'Before you begin',
    consent:
      '**What this is.** This is a short decision-making study. You will play a simple game in which you search a hidden line of positions for the highest value. The whole study takes about **15 minutes**.\n\n' +
      '**Payment.** You receive the base payment for participating. In addition, {paidTasks} rounds of the game are chosen at random at the end and paid to you as a **bonus**, based on how well you did in those rounds.\n\n' +
      '**Anonymity.** We record only your choices in the game (which positions you reveal, when you stop, and your answers to a few questions). We do not collect any personally identifying information beyond the anonymous IDs your recruitment platform provides. Your data are used only for research.\n\n' +
      '**Voluntary.** Participation is voluntary and you may stop at any time by closing the window.',
    consentAgree: 'I have read the above and I agree to take part.',
    consentBtn: 'Continue',

    // ---- instructions ----------------------------------------------------
    instructionsTitle: 'Instructions',
    instructions:
      'In each round you will see {nPositions} positions on a line. Each position hides a value between 0 and 100 cents.\n\n' +
      'Values at adjacent positions differ by at most 10 cents. So positions two apart differ by at most 20 cents, and so on.\n\n' +
      'You can reveal the value at any position. Each reveal costs {fee} cents. You can stop whenever you want.\n\n' +
      'Your earnings for the round are the highest value you revealed, minus {fee} cents for each reveal. If you reveal nothing, you earn 0 for the round.\n\n' +
      'After each round the values reset and will be different. {rounds}',
    // The With-AI addendum has three built-in wordings (free / paid / two
    // models) picked from the AI-model settings — see dynamicDefault(). One
    // override replaces whichever applies.
    instructionsB:
      'You also have a free assistant.\n\n' +
      'You can ask the assistant about any position, and it gives you its best estimate of the value there — a guess based on data it was trained on. Its estimates are usually close but not guaranteed, and it always gives an answer, even for positions where it is unsure.\n\n' +
      'Asking the assistant is free and unlimited. The assistant does not learn from your reveals in this study.',
    instructionsBtn: 'Continue to a quick check',

    // ---- quick check (comprehension) ------------------------------------
    quizTitle: 'Quick check',
    quizIntro: 'Please answer these to make sure the instructions are clear. You need all answers correct to continue.',
    quizRetry: 'Not quite, re-read the instructions.',
    quizBtn: 'Submit answers',

    // ---- phase transition (within-subjects) ------------------------------
    phaseIntroTitle: 'Part {part} of {parts}',
    phaseIntroB:
      '**Next part: you now have a free AI assistant.**\n\n' +
      'For the rounds in this part you also have a free assistant. You can ask it about any position and it gives its best estimate of the value there — a guess based on data it was trained on. Its estimates are usually close but not guaranteed, and it always gives an answer, even where it is unsure.\n\n' +
      'Asking is free and unlimited. Everything else about the game is exactly the same.',
    phaseIntroA:
      '**Next part: you search on your own.**\n\n' +
      'For the rounds in this part the AI assistant is no longer available. Everything else about the game is exactly the same.',
    phaseIntroBtn: 'Continue',

    // ---- the round screen ------------------------------------------------
    roundLabelPractice: 'Practice (not paid)',
    roundLabelReal: 'Round {round} of {nTasks}',
    counterBest: 'Best so far',
    counterBestTip: 'The highest value you’ve revealed so far this round — your prize if you stop now.',
    counterReveals: 'Reveals',
    counterRevealsTip: 'How many positions you’ve revealed so far this round.',
    counterCost: 'Cost',
    counterCostTip: 'What you’ve spent revealing positions so far — {fee}¢ per reveal.',
    counterNet: 'Net so far',
    counterNetTip: 'Your earnings so far: best value found minus what you’ve spent revealing.',
    legendRevealed: 'revealed value',
    legendEstimate: 'assistant estimate (not guaranteed)',
    posLabel: 'Position',
    posPrevTip: 'Previous position',
    posNextTip: 'Next position',
    revealBtn: 'Reveal (costs {fee}¢)',
    revealedBtn: 'Already revealed',
    stopBtn: 'Stop this round',
    warnNegative: 'Your net for this round is now 0 or negative.',

    // ---- stop confirmation ----------------------------------------------
    stopTitle: 'Stop this round?',
    stopMsg: 'You will end this round with a net of {net} cents. Stop?',
    stopMsgZero: 'You will earn 0 for this round. Stop?',
    stopCancel: 'Keep going',
    stopOk: 'Yes, stop',

    // ---- AI assistant panel (With-AI phase only) -------------------------
    aiTitle: 'Assistant',
    // Three built-in wordings, picked from the AI-model settings — see
    // dynamicDefault(). One override replaces whichever applies.
    aiIntro: 'Free and unlimited. Ask it about any position for its best estimate.',
    aiModelBase: 'Baseline',
    aiModelFront: 'Frontier',
    aiAskBtn: 'Ask assistant ({cost})',            // used when only one model is offered
    aiAskBtnFrontier: 'Ask ({cost})',              // used when a frontier model is offered too
    aiFreeWord: 'free',                            // the price shown when a question costs 0
    aiSpend: 'Asked **{n}** {timesWord} · spent **{spent}¢** on the assistant this round',
    aiTimeSingular: 'time',
    aiTimePlural: 'times',
    aiEmptyLog: 'No questions yet this round.',
    aiAnswer: 'My estimate for position {pos} is about {est} cents. This is an estimate, not a guarantee.',

    // ---- end-of-round result --------------------------------------------
    interPractice: 'Practice complete',
    interPart: 'Part {part} complete',
    interRound: 'Round {round} complete',
    resReveals: 'Reveals',
    resAiQuestions: 'AI questions',
    resAiSpent: '(spent {spent}¢)',
    resBest: 'Best value found',
    resNet: 'Net this round',
    interPracticeNote: 'This was practice and was not paid. The real rounds start now.',
    interPartNote: 'That completes this part. The next part starts when you continue.',
    interLastNote: 'That was the last round. Continue to see your results.',
    interBtn: 'Continue',

    // ---- end-of-study debrief -------------------------------------------
    compareTitle: 'Your results',
    compareIntroMulti: 'Below is one round from each part, showing the true prize curve (hidden while you played) and the positions you revealed — so you can compare searching without vs. with the AI.',
    compareIntroSingle: 'Below is one of your rounds, showing the true prize curve (hidden while you played) and the positions you revealed.',
    cmpAvgNet: 'avg net / round',
    cmpAvgReveals: 'avg reveals',
    cmpAvgBest: 'avg best found',
    cmpLegendTruth: 'true prize curve (was hidden)',
    cmpLegendRevealed: 'positions you revealed',
    cmpLegendInterp: 'AI interpolation',
    cmpLegendExtrap: 'AI extrapolation (unreliable)',
    cmpLegendDots: 'AI training data',
    compareBtn: 'Next',

    // ---- exit survey -----------------------------------------------------
    surveyTitle: 'One last thing',
    surveyIntro: 'A few quick questions before you finish. Your answers are anonymous.',
    surveyLikert: 'Strongly disagree\nDisagree\nNeutral\nAgree\nStrongly agree',
    surveyBtn: 'Submit & finish',

    // ---- finish ----------------------------------------------------------
    finishTitle: 'All done — thank you!',
    finish: 'Thank you for taking part. Below are your {totalRounds} real rounds{partsPhrase}. The {paidPhrase} marked **paid** {paidVerb} selected at random; your bonus is the sum of their earnings (a round counts as 0 if it was negative).',
    thPart: 'Part',
    thRound: 'Round',
    thReveals: 'Reveals',
    thBest: 'Best',
    thNet: 'Net',
    paidMark: '✔ paid',
    finishBonus: 'Your bonus:',
    finishCodeLabel: 'Your completion code',
    finishCodeNote: 'Copy this code back into the recruitment platform to be paid.',
    finishDlJson: 'Download my session data (JSON)',
    finishDlCsv: 'Download my session data (CSV)',
    uploadNote: 'We could not reach our server to save your responses automatically. Please click “Download my session data” below and send us the file. Your completion code above is still valid.',

    // ---- inactivity nudges (one per line; one is picked at random) --------
    nudges:
      'Still there? Take your time — reveal a few positions to find the highest prize, and stop when you’re happy. Doing your best earns a bigger bonus!\n' +
      'Keep exploring! Each reveal costs a little, so weigh up a few spots and keep the best one you find.\n' +
      'Give it your best shot — the closer you get to the highest prize, the more you earn this round.'
  };

  // Keys whose value is a LIST: one item per line in the editor / stored string.
  var LIST_KEYS = { surveyLikert: 1, nudges: 1 };

  // ======================================================================
  //  QUICK CHECK — the comprehension questions, with their answer key.
  //  `common` is asked once, to everyone. `ai` is asked the first time a
  //  participant enters a With-AI phase. `correct` indexes into `options`.
  //  Option order is shuffled for display; the answer key travels with the text.
  // ======================================================================
  var QUIZ = {
    common: [
      { id: 'q1', prompt: 'Position 50 shows 40 cents. What is the highest possible value at position 52?',
        options: ['50', '60', '100', '40'], correct: 1 },
      { id: 'q2', prompt: 'You revealed two positions this round. The values were 30 cents and 62 cents. You stop now. What do you earn for this round?',
        options: ['62', '52', '92', '30'], correct: 1 }
    ],
    ai: [
      { id: 'q3', prompt: 'You ask the assistant about a position far from the data it was trained on. What happens?',
        options: ['It tells you it has no data there', 'It still gives an estimate, which may be inaccurate', 'It gives you the exact value', 'It reveals the position for free'], correct: 1 },
      { id: 'q4', prompt: 'The assistant’s answer at position 40 is:',
        options: ['Always exactly correct', 'An estimate that can be wrong'], correct: 1 }
    ]
  };

  // ======================================================================
  //  EXIT SURVEY — `ai:true` questions are asked only when the session
  //  includes a With-AI phase. type: 'likert' (5-point) | 'text' (free text).
  // ======================================================================
  var SURVEY = [
    { id: 'strategy', type: 'likert', prompt: 'I had a clear strategy for which positions to reveal.' },
    { id: 'difficult', type: 'likert', prompt: 'The task was difficult.' },
    { id: 'ai_helpful', type: 'likert', ai: true, prompt: 'The AI assistant’s estimates were helpful.' },
    { id: 'ai_trust', type: 'likert', ai: true, prompt: 'I trusted the AI assistant’s estimates.' },
    { id: 'comments', type: 'text', prompt: 'Anything else about how you searched? (optional)' }
  ];

  // ======================================================================
  //  DYNAMIC DEFAULTS
  //  A few blocks have several built-in wordings, chosen by the AI-model
  //  settings (is the assistant free? is a frontier model offered?). The admin
  //  panel renders the one that CURRENTLY applies as the placeholder, so the
  //  researcher always reads the words their participants will read.
  // ======================================================================
  function priceWord(c, free) { return c > 0 ? c + ' cents' : (free || 'free'); }

  function dynamicDefault(key, ctx) {
    ctx = ctx || {};
    var ai = ctx.ai || {}, fee = ctx.fee != null ? ctx.fee : 5;
    var base = ai.baselineCost != null ? +ai.baselineCost : 0;
    var front = ai.frontierCost != null ? +ai.frontierCost : 0;

    if (key === 'instructionsB') {
      if (ai.frontier) {
        return 'You also have AI assistants.\n\n' +
          'You can ask an assistant about any position and it gives its best estimate of the value there — a guess based on data it was trained on. Its estimates are usually close but not guaranteed, and it always gives an answer, even where it is unsure.\n\n' +
          'There are two models. The **Baseline** model costs ' + priceWord(base) + ' per question; the **Frontier** model costs ' + front + ' cents per question and is trained on more data, so its guesses tend to be sharper. Revealing a position yourself costs ' + fee + ' cents.';
      }
      if (base > 0) {
        return 'You also have an AI assistant.\n\n' +
          'You can ask it about any position and it gives its best estimate of the value there — a guess based on data it was trained on. Its estimates are usually close but not guaranteed, and it always gives an answer, even where it is unsure.\n\n' +
          'Each question to the assistant costs ' + base + ' cents — cheaper than revealing a position yourself, which costs ' + fee + ' cents.';
      }
      return null; // the free wording is the plain TEXT default
    }

    if (key === 'phaseIntroB') {
      if (ai.frontier) {
        return '**Next part: you now have AI assistants.**\n\n' +
          'For the rounds in this part you can ask an assistant about any position for its best estimate (a guess from data it was trained on — usually close, not guaranteed, always an answer). A **Baseline** model costs ' + priceWord(base) + ' per question and a **Frontier** model costs ' + front + ' cents and is trained on more data. Revealing still costs ' + fee + ' cents. Everything else about the game is the same.';
      }
      if (base > 0) {
        return '**Next part: you now have an AI assistant.**\n\n' +
          'For the rounds in this part you can ask it about any position for its best estimate (a guess from data it was trained on — usually close, not guaranteed, always an answer). Each question costs ' + base + ' cents; revealing a position costs ' + fee + ' cents. Everything else about the game is the same.';
      }
      return null;
    }

    if (key === 'aiIntro') {
      if (ai.frontier) return 'Choose a model, then ask it about any position for its best estimate. The pricier model is trained on more data, so its guesses tend to be sharper.';
      if (base > 0) return 'Ask it about any position for its best estimate. Each question costs ' + base + '¢ (a reveal costs ' + fee + '¢).';
      return null;
    }

    return null;
  }

  // The built-in default for a key under a given study context.
  function builtin(key, ctx) {
    var d = dynamicDefault(key, ctx);
    return d != null ? d : (TEXT[key] != null ? TEXT[key] : '');
  }
  // The live value for a key: the admin's override if they set one, else the
  // built-in. `content` is the session's settings.content map.
  function resolve(content, key, ctx) {
    var v = content && content[key];
    return (v != null && String(v).trim() !== '') ? String(v) : builtin(key, ctx);
  }

  // ======================================================================
  //  TOKEN EXPANSION  (shared by the app and the admin's placeholders)
  //  ctx: { nTasks, paidTasks, nPractice, nPhases, fee, nPositions, ai }
  //  Unknown tokens are left alone, so per-moment ones ({round}, {net}, …) can
  //  be filled in later by the app.
  // ======================================================================
  function subTokens(text, ctx) {
    if (text == null) return '';
    ctx = ctx || {};
    var nTasks = +ctx.nTasks || 1;
    var paidTasks = ctx.paidTasks != null ? +ctx.paidTasks : 2;
    var nPractice = +ctx.nPractice || 0;
    var nPhases = +ctx.nPhases || 1;
    var fee = ctx.fee != null ? +ctx.fee : 5;
    var nPositions = ctx.nPositions != null ? +ctx.nPositions : 100;
    var ai = ctx.ai || {};
    var totalReal = nTasks * nPhases;

    var roundsSentence;
    if (nPhases > 1) {
      roundsSentence = 'You play ' + nTasks + ' rounds in each of ' + nPhases + ' parts' +
        (nPractice > 0 ? ' (after one practice round)' : '') + ', ' + totalReal + ' rounds in total. ' +
        paidTasks + ' of the ' + totalReal + ' rounds will be picked at random and paid to you as a bonus.';
    } else {
      roundsSentence = (nPractice > 0 ? 'There is a practice round and ' + nTasks + ' real rounds. ' : 'There are ' + nTasks + ' rounds. ') +
        paidTasks + ' of the ' + nTasks + ' real rounds will be picked at random and paid to you as a bonus.';
    }
    // Finish-page phrases that have to agree in number with the settings.
    var partsPhrase = nPhases > 1 ? ' across ' + nPhases + ' parts' : '';
    var paidPhrase = paidTasks === 1 ? 'round' : paidTasks + ' rounds';
    var paidVerb = paidTasks === 1 ? 'was' : 'were';

    return String(text)
      .replace(/\{rounds\}/g, roundsSentence)
      .replace(/\{partsPhrase\}/g, partsPhrase)
      .replace(/\{paidPhrase\}/g, paidPhrase)
      .replace(/\{paidVerb\}/g, paidVerb)
      .replace(/\{nTasks\}/g, nTasks)
      .replace(/\{paidTasks\}/g, paidTasks)
      .replace(/\{nPractice\}/g, nPractice)
      .replace(/\{fee\}/g, fee)
      .replace(/\{nPositions\}/g, nPositions)
      .replace(/\{aiCost\}/g, ai.baselineCost != null ? ai.baselineCost : 0)
      .replace(/\{aiFrontierCost\}/g, ai.frontierCost != null ? ai.frontierCost : 0)
      .replace(/\{totalRounds\}/g, totalReal)
      .replace(/\{nPhases\}/g, nPhases);
  }

  // Illustrative values for the per-moment tokens, so an admin PLACEHOLDER
  // reads as a finished sentence instead of "Round {round} of {nTasks}".
  // Never used by the participant app.
  var SAMPLE = {
    round: 3, part: 2, parts: 2, net: 47, pos: 42, est: 63,
    n: 2, spent: 4, cost: '2¢', timesWord: 'times'
  };
  function fillSample(text) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(SAMPLE, k) ? SAMPLE[k] : m;
    });
  }
  // The exact words a participant will see for `key` under the given settings —
  // what the admin panel shows as the field's placeholder.
  function preview(key, ctx) { return fillSample(subTokens(builtin(key, ctx), ctx)); }

  // ======================================================================
  //  NORMALIZERS — accept whatever is stored (or nothing) and return a clean,
  //  usable structure. Both the app and the admin go through these, so a
  //  half-edited override can never break the study.
  // ======================================================================
  function cleanStr(v) { return v == null ? '' : String(v).trim(); }

  function normalizeQuizList(list, fallback) {
    var out = [];
    if (Object.prototype.toString.call(list) === '[object Array]') {
      for (var i = 0; i < list.length; i++) {
        var q = list[i] || {};
        var prompt = cleanStr(q.prompt);
        var want = Math.round(+q.correct);              // which option was marked correct
        if (!isFinite(want)) want = 0;
        var opts = [], keptCorrect = -1;
        var src = Object.prototype.toString.call(q.options) === '[object Array]' ? q.options : [];
        for (var j = 0; j < src.length; j++) {
          var t = cleanStr(typeof src[j] === 'object' && src[j] ? src[j].t : src[j]);
          if (!t) continue;                             // a blank option is not an answer
          // Dropping a blank SHIFTS the later indices, so the answer key has to
          // travel with the option it was on — recomputing it from the raw index
          // would silently make a different option "correct".
          if (j === want) keptCorrect = opts.length;
          opts.push(t);
        }
        if (!prompt || opts.length < 2) continue;       // unusable → drop the question
        var c = (keptCorrect >= 0) ? keptCorrect : 0;   // key blanked out → first option
        // The id becomes a radio-group name and a CSS attribute selector, so keep
        // it to safe characters whatever the admin typed.
        var id = cleanStr(q.id).replace(/[^A-Za-z0-9_-]/g, '') || ('q' + (i + 1));
        out.push({ id: id, prompt: prompt, options: opts, correct: c });
      }
    }
    return out.length ? out : (fallback || []).map(cloneQ);
  }
  function cloneQ(q) { return { id: q.id, prompt: q.prompt, options: q.options.slice(), correct: q.correct }; }

  // The quiz actually asked, from settings.content.quiz (either half may be
  // missing → built-in). An admin who deletes every question in a group turns
  // that group off; deleting BOTH turns the Quick check screen off entirely.
  function quizFor(content) {
    var stored = (content && content.quiz) || null;
    function part(name) {
      if (!stored || !Object.prototype.hasOwnProperty.call(stored, name)) return QUIZ[name].map(cloneQ);
      return normalizeQuizList(stored[name], []);   // present but empty ⇒ deliberately none
    }
    return { common: part('common'), ai: part('ai') };
  }

  function normalizeSurvey(list, fallback) {
    var out = [];
    if (Object.prototype.toString.call(list) === '[object Array]') {
      for (var i = 0; i < list.length; i++) {
        var q = list[i] || {};
        var prompt = cleanStr(q.prompt);
        if (!prompt) continue;
        out.push({
          id: cleanStr(q.id).replace(/[^A-Za-z0-9_-]/g, '') || ('sq' + (i + 1)),
          type: q.type === 'text' ? 'text' : 'likert',
          ai: !!q.ai,
          prompt: prompt
        });
      }
      return out;                                    // present ⇒ authoritative (even if empty)
    }
    return (fallback || SURVEY).map(function (q) { return { id: q.id, type: q.type, ai: !!q.ai, prompt: q.prompt }; });
  }
  function surveyFor(content) {
    var stored = (content && content.survey) || null;
    return stored ? normalizeSurvey(stored, SURVEY) : normalizeSurvey(null, SURVEY);
  }

  // A list-valued key ('surveyLikert', 'nudges') as an array of non-empty lines.
  function lines(value, fallbackKey) {
    var raw = cleanStr(value) || cleanStr(TEXT[fallbackKey]);
    var out = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return out;
  }

  // ======================================================================
  //  GROUPS — how the admin panel lays the above out, screen by screen, in the
  //  order a participant meets them. `type`:
  //    'text'   one-line input        'prose'  paragraphs (**bold**, blank line)
  //    'area'   short multi-line      'list'   one item per line
  //    'quiz' / 'survey'              structured editors
  //  `ai:true` marks copy only ever shown in a With-AI phase.
  // ======================================================================
  var GROUPS = [
    { id: 'gate', title: 'Session code screen', help: 'Shown only to someone who opens the study without a session code in the link.', fields: [
      { k: 'codeTitle', label: 'Heading', type: 'text' },
      { k: 'codeIntro', label: 'Explanation', type: 'area' },
      { k: 'codePlaceholder', label: 'Code box placeholder', type: 'text' },
      { k: 'codeBtn', label: 'Button', type: 'text' },
      { k: 'codeError', label: 'Error when the box is empty', type: 'text' }
    ] },

    { id: 'consent', title: 'Consent page', help: 'The very first screen of the study. Participants tick a box to agree before anything else happens.', fields: [
      { k: 'consentTitle', label: 'Heading', type: 'text' },
      { k: 'consent', label: 'Consent text', type: 'prose' },
      { k: 'consentAgree', label: 'Agreement checkbox', type: 'text' },
      { k: 'consentBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'instructions', title: 'Instructions', help: 'The task instructions everyone reads before playing.', fields: [
      { k: 'instructionsTitle', label: 'Heading', type: 'text' },
      { k: 'instructions', label: 'Instructions (all phases)', type: 'prose' },
      { k: 'instructionsB', label: 'With-AI addendum', type: 'prose', ai: true,
        help: 'Appended when the participant starts in the With-AI phase. The built-in wording shown here follows your AI-model settings above (free / paid / two models).' },
      { k: 'instructionsBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'quiz', title: 'Quick check (comprehension questions)', help: 'Participants must get every question right before they can play. Options are shown in random order; the answer key travels with the text you type here.', fields: [
      { k: 'quizTitle', label: 'Heading', type: 'text' },
      { k: 'quizIntro', label: 'Introduction', type: 'area' },
      { k: 'quiz', label: 'Questions', type: 'quiz' },
      { k: 'quizRetry', label: 'Message after a wrong answer', type: 'text' },
      { k: 'quizBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'phase', title: 'Phase transition (between parts)', help: 'Shown to a within-subjects participant when they move from one part of the study into the next.', fields: [
      { k: 'phaseIntroTitle', label: 'Heading', type: 'text', tokens: '{part} {parts}' },
      { k: 'phaseIntroB', label: 'Moving INTO the With-AI part', type: 'prose', ai: true,
        help: 'The built-in wording shown here follows your AI-model settings above.' },
      { k: 'phaseIntroA', label: 'Moving INTO the Without-AI part', type: 'prose' },
      { k: 'phaseIntroBtn', label: 'Button', type: 'text' },
      { k: 'phaseLabelA', label: 'Name of the Without-AI part', type: 'text',
        help: 'How the condition is named to participants (round label, results table). Your admin panel keeps its own labels.' },
      { k: 'phaseLabelB', label: 'Name of the With-AI part', type: 'text' }
    ] },

    { id: 'round', title: 'The game screen', help: 'Everything on the search screen itself: the round label, the four counters (and their hover tooltips), the plot legend and the two action buttons.', fields: [
      { k: 'roundLabelPractice', label: 'Round label — practice', type: 'text' },
      { k: 'roundLabelReal', label: 'Round label — real round', type: 'text', tokens: '{round} {nTasks}' },
      { k: 'counterBest', label: 'Counter 1 — label', type: 'text' },
      { k: 'counterBestTip', label: 'Counter 1 — tooltip', type: 'area' },
      { k: 'counterReveals', label: 'Counter 2 — label', type: 'text' },
      { k: 'counterRevealsTip', label: 'Counter 2 — tooltip', type: 'area' },
      { k: 'counterCost', label: 'Counter 3 — label', type: 'text' },
      { k: 'counterCostTip', label: 'Counter 3 — tooltip', type: 'area' },
      { k: 'counterNet', label: 'Counter 4 — label', type: 'text' },
      { k: 'counterNetTip', label: 'Counter 4 — tooltip', type: 'area' },
      { k: 'legendRevealed', label: 'Plot legend — revealed value', type: 'text' },
      { k: 'legendEstimate', label: 'Plot legend — AI estimate', type: 'text', ai: true },
      { k: 'posLabel', label: 'Position picker label', type: 'text' },
      { k: 'posPrevTip', label: 'Position picker — ← tooltip', type: 'text' },
      { k: 'posNextTip', label: 'Position picker — → tooltip', type: 'text' },
      { k: 'revealBtn', label: 'Reveal button', type: 'text', tokens: '{fee}' },
      { k: 'revealedBtn', label: 'Reveal button — already revealed', type: 'text' },
      { k: 'stopBtn', label: 'Stop button', type: 'text' },
      { k: 'warnNegative', label: 'Warning when the net turns negative', type: 'text' }
    ] },

    { id: 'stop', title: 'Stop-the-round dialog', help: 'The confirmation shown when a participant clicks “Stop this round”.', fields: [
      { k: 'stopTitle', label: 'Heading', type: 'text' },
      { k: 'stopMsg', label: 'Message', type: 'area', tokens: '{net}' },
      { k: 'stopMsgZero', label: 'Message when nothing was revealed', type: 'area' },
      { k: 'stopCancel', label: 'Cancel button', type: 'text' },
      { k: 'stopOk', label: 'Confirm button', type: 'text' }
    ] },

    { id: 'ai', title: 'AI assistant panel', ai: true, help: 'The side panel in the With-AI phase, and the words the assistant answers with.', fields: [
      { k: 'aiTitle', label: 'Panel heading', type: 'text' },
      { k: 'aiIntro', label: 'Panel introduction', type: 'area',
        help: 'The built-in wording shown here follows your AI-model settings above (free / paid / two models).' },
      { k: 'aiAskBtn', label: 'Ask button (one model)', type: 'text', tokens: '{cost}' },
      { k: 'aiAskBtnFrontier', label: 'Ask button (two models)', type: 'text', tokens: '{cost}' },
      { k: 'aiFreeWord', label: 'Price word when a question is free', type: 'text' },
      { k: 'aiModelBase', label: 'Baseline model name', type: 'text' },
      { k: 'aiModelFront', label: 'Frontier model name', type: 'text' },
      { k: 'aiAnswer', label: 'The assistant’s answer', type: 'area', tokens: '{pos} {est}' },
      { k: 'aiSpend', label: 'Running spend line', type: 'text', tokens: '{n} {spent} {timesWord}' },
      { k: 'aiTimeSingular', label: '“time” (singular)', type: 'text' },
      { k: 'aiTimePlural', label: '“times” (plural)', type: 'text' },
      { k: 'aiEmptyLog', label: 'Empty question log', type: 'text' }
    ] },

    { id: 'inter', title: 'End-of-round result', help: 'The small card shown after each round, before the next one starts.', fields: [
      { k: 'interPractice', label: 'Heading — after the practice round', type: 'text' },
      { k: 'interPart', label: 'Heading — after the last round of a part', type: 'text', tokens: '{part}' },
      { k: 'interRound', label: 'Heading — after a normal round', type: 'text', tokens: '{round}' },
      { k: 'resReveals', label: 'Row — reveals', type: 'text' },
      { k: 'resAiQuestions', label: 'Row — AI questions', type: 'text', ai: true },
      { k: 'resAiSpent', label: 'Row — AI spend', type: 'text', ai: true, tokens: '{spent}' },
      { k: 'resBest', label: 'Row — best value', type: 'text' },
      { k: 'resNet', label: 'Row — net', type: 'text' },
      { k: 'interPracticeNote', label: 'Note after the practice round', type: 'area' },
      { k: 'interPartNote', label: 'Note after a part', type: 'area' },
      { k: 'interLastNote', label: 'Note after the very last round', type: 'area' },
      { k: 'interBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'compare', title: 'Your-results debrief', help: 'The end-of-study screen that reveals the true prize curve and what each participant searched.', fields: [
      { k: 'compareTitle', label: 'Heading', type: 'text' },
      { k: 'compareIntroMulti', label: 'Introduction — several parts', type: 'area' },
      { k: 'compareIntroSingle', label: 'Introduction — one part', type: 'area' },
      { k: 'cmpAvgNet', label: 'Stat — average net', type: 'text' },
      { k: 'cmpAvgReveals', label: 'Stat — average reveals', type: 'text' },
      { k: 'cmpAvgBest', label: 'Stat — average best found', type: 'text' },
      { k: 'cmpLegendTruth', label: 'Legend — true curve', type: 'text' },
      { k: 'cmpLegendRevealed', label: 'Legend — revealed positions', type: 'text' },
      { k: 'cmpLegendInterp', label: 'Legend — AI interpolation', type: 'text', ai: true },
      { k: 'cmpLegendExtrap', label: 'Legend — AI extrapolation', type: 'text', ai: true },
      { k: 'cmpLegendDots', label: 'Legend — AI training data', type: 'text', ai: true },
      { k: 'compareBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'survey', title: 'Exit survey', help: 'The last questions before the completion code. Agree/disagree questions use the 5-point scale below; “With-AI only” questions are skipped in a Without-AI session.', fields: [
      { k: 'surveyTitle', label: 'Heading', type: 'text' },
      { k: 'surveyIntro', label: 'Introduction', type: 'area' },
      { k: 'survey', label: 'Questions', type: 'survey' },
      { k: 'surveyLikert', label: 'Agree/disagree scale (one label per line)', type: 'list' },
      { k: 'surveyBtn', label: 'Button', type: 'text' }
    ] },

    { id: 'finish', title: 'Finish page', help: 'The final screen: the results table, the bonus, and the completion code participants take back to the recruitment platform.', fields: [
      { k: 'finishTitle', label: 'Heading', type: 'text' },
      { k: 'finish', label: 'Text above the results table', type: 'prose', tokens: '{totalRounds} {paidTasks}' },
      { k: 'thPart', label: 'Table header — part', type: 'text' },
      { k: 'thRound', label: 'Table header — round', type: 'text' },
      { k: 'thReveals', label: 'Table header — reveals', type: 'text' },
      { k: 'thBest', label: 'Table header — best', type: 'text' },
      { k: 'thNet', label: 'Table header — net', type: 'text' },
      { k: 'paidMark', label: 'Marker on a paid round', type: 'text' },
      { k: 'finishBonus', label: 'Bonus line', type: 'text' },
      { k: 'finishCodeLabel', label: 'Completion-code label', type: 'text' },
      { k: 'finishCodeNote', label: 'Completion-code note', type: 'area' },
      { k: 'finishDlJson', label: 'Download button (JSON)', type: 'text' },
      { k: 'finishDlCsv', label: 'Download button (CSV)', type: 'text' },
      { k: 'uploadNote', label: 'Note if the upload failed', type: 'area' }
    ] },

    { id: 'closed', title: 'Study-closed page', help: 'What someone sees if they open a session you have marked completed.', fields: [
      { k: 'closedTitle', label: 'Heading', type: 'text' },
      { k: 'closed', label: 'Message', type: 'prose' }
    ] },

    { id: 'chrome', title: 'Header, nudges & other wording', help: 'The page header, the log-out control, and the encouragements shown when a participant sits idle mid-round.', fields: [
      { k: 'brand', label: 'Study name in the header', type: 'text' },
      { k: 'loading', label: 'Loading message', type: 'text' },
      { k: 'logoutBtn', label: 'Log-out button', type: 'text' },
      { k: 'logoutTip', label: 'Log-out tooltip', type: 'text' },
      { k: 'logoutConfirm', label: 'Log-out confirmation', type: 'area' },
      { k: 'nudgeDismiss', label: 'Dismiss-a-nudge tooltip', type: 'text' },
      { k: 'nudges', label: 'Idle encouragements (one per line, picked at random)', type: 'list' }
    ] }
  ];

  // Every key the admin panel can edit, in group order.
  function allKeys() {
    var out = [];
    for (var i = 0; i < GROUPS.length; i++)
      for (var j = 0; j < GROUPS[i].fields.length; j++) out.push(GROUPS[i].fields[j].k);
    return out;
  }
  // Editable STRING keys only (the structured 'quiz'/'survey' editors excluded).
  function stringKeys() {
    var out = [];
    for (var i = 0; i < GROUPS.length; i++)
      for (var j = 0; j < GROUPS[i].fields.length; j++) {
        var f = GROUPS[i].fields[j];
        if (f.type !== 'quiz' && f.type !== 'survey') out.push(f.k);
      }
    return out;
  }

  return {
    TEXT: TEXT, QUIZ: QUIZ, SURVEY: SURVEY, GROUPS: GROUPS, LIST_KEYS: LIST_KEYS, SAMPLE: SAMPLE,
    builtin: builtin, resolve: resolve, dynamicDefault: dynamicDefault,
    subTokens: subTokens, fillSample: fillSample, preview: preview,
    quizFor: quizFor, surveyFor: surveyFor,
    normalizeQuizList: normalizeQuizList, normalizeSurvey: normalizeSurvey,
    lines: lines, allKeys: allKeys, stringKeys: stringKeys
  };
});
