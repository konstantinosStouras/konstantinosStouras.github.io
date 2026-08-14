/* ==========================================================================
   search-v2  ·  content.js
   Every word the participant reads, and every question they answer, as DATA.

   Instruction screens (§13.2, §15), the two comprehension gates (§15), and the
   twenty exit-survey items (§16.7) live here rather than in app.js, so that the
   participant screen, the admin panel's preview and the Excel exporter's column
   dictionary are all generated from ONE definition and can never drift apart.

   Tokens in the prose are substituted at render time: {J} positions,
   {revealCost}, {queryCost}, {L} step bound, {scored} scored rounds per block,
   {warmup} warm-up rounds per block, {K} anchors this round.

   Browser: window.SVContent.  Node: require('./content.js').
   ========================================================================== */
(function (root, factory) {
  var M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  if (root) root.SVContent = M;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ---- consent -------------------------------------------------------------
  var CONSENT =
    "**What this is.** This is a decision-making study. You will play a game in which you search a hidden line of {J} positions for the highest prize. The whole study takes about **40 to 50 minutes**.\n\n" +
    "**What we record.** Only your choices in the game — which positions you look at, what you pay for, when you stop — your answers to a few questions, and timing information. We do not collect your name or any free-text identifier.\n\n" +
    "**Voluntary.** Participation is voluntary and you may stop at any time by closing the window.";

  // ---- instructions, screens 1 to 5 (§13.2) --------------------------------
  var INSTRUCTIONS = [
    {
      id: 'i1',
      title: 'The line of prizes',
      body:
        "In each round you see **{J} positions** on a line, numbered 1 to {J}.\n\n" +
        "Every position hides a **prize** — a whole number of points between 0 and 100. The prizes are hidden until you look at them.\n\n" +
        "Your job in each round is to end on a position with a high prize."
    },
    {
      id: 'i2',
      title: 'Neighbouring positions are similar',
      body:
        "The prizes are not scattered at random. **Two neighbouring positions differ by at most {L} points.**\n\n" +
        "So if position 40 hides 50 points, position 41 hides somewhere between 40 and 60, position 42 between 30 and 70, and so on — {L} more points of possible difference for each further step.\n\n" +
        "This is the only thing you know about the line before you look at it."
    },
    {
      id: 'i3',
      title: 'Revealing costs points',
      body:
        "You can **reveal** any position to see its true prize. Each reveal costs **{revealCost} points**.\n\n" +
        "A position you have revealed stays visible for the rest of the round, and you cannot pay to reveal it twice.\n\n" +
        "You may reveal up to {revealCap} positions in a round, though far fewer is usually sensible."
    },
    {
      id: 'i4',
      title: 'Stopping, and how you score',
      body:
        "When you are ready, you **stop and nominate** one position. The round then ends.\n\n" +
        "**Your score for the round is the true prize at the position you nominate, minus everything you spent that round.**\n\n" +
        "You may nominate any position — one you revealed, or one you never touched. The true prize there is what counts, whatever you believed about it.\n\n" +
        "A round can end below zero if you spend more than the prize you land on. That is allowed, and it is recorded."
    },
    {
      id: 'i5',
      title: 'Rounds are independent',
      body:
        "There are **{warmup} practice rounds** and then **{scored} scored rounds** in each half of the study.\n\n" +
        "**The prizes are drawn afresh in every round.** What you learned about the line in one round tells you nothing about the next.\n\n" +
        "Some rounds start with a few positions already open, for free. Those are shown to you at the start.\n\n" +
        "You can reopen this summary at any time from the button at the top right of the game screen."
    }
  ];

  // ---- AI instructions, shown before the first AI-on block (§15) -----------
  var AI_INSTRUCTIONS = [
    {
      id: 'a1',
      title: 'An AI you can ask',
      body:
        "In this half of the study you can also **ask an AI** about a position. It answers with a number: its estimate of the prize there.\n\n" +
        "Asking costs **{queryCost} points**. Revealing still costs **{revealCost} points**. Asking does *not* reveal the truth.\n\n" +
        "The AI answers about any position you ask about. It never says it does not know."
    },
    {
      id: 'a2',
      title: 'What the AI actually knows',
      body:
        "At the start of each round the AI knows the **true prize at a small number of positions** — {K} of the {J}, in this round. It is not told which ones you can see, and **you are never told which ones it knows**.\n\n" +
        "For any other position, it **guesses by drawing a straight line between the two positions it knows on either side**. Beyond the outermost position it knows, it simply **repeats that position's value**.\n\n" +
        "So some of its answers are exactly right and others are inventions, and **an answer never looks any different in the two cases**."
    },
    {
      id: 'a3',
      title: 'The AI learns from your reveals',
      body:
        "Every position **you** reveal is added to what the AI knows, together with every position that started open.\n\n" +
        "So the AI's answers can change after you reveal something, and asking about the same position again — at full cost — can give a different answer.\n\n" +
        "**The AI's number is never your prize.** If you stop on a position the AI said was 70, you score the true prize there, whatever it turns out to be."
    }
  ];

  // ---- comprehension gate, base instructions (§15) ------------------------
  // Adapted from the source instruction screens: the highest and lowest possible
  // prize one and two steps away from a revealed prize.
  var QUIZ_BASE = [
    {
      id: 'q_adj_hi1',
      prompt: 'Position 40 has been revealed and its prize is 50 points. What is the HIGHEST the prize at position 41 could be?',
      options: ['50 points', '55 points', '60 points', 'It could be anything from 0 to 100'],
      answer: 2
    },
    {
      id: 'q_adj_lo1',
      prompt: 'Same situation: position 40 is 50 points. What is the LOWEST the prize at position 41 could be?',
      options: ['0 points', '40 points', '45 points', '50 points'],
      answer: 1
    },
    {
      id: 'q_adj_hi2',
      prompt: 'Still with position 40 at 50 points — what is the HIGHEST the prize at position 42 could be?',
      options: ['60 points', '65 points', '70 points', '100 points'],
      answer: 2
    },
    {
      id: 'q_cost',
      prompt: 'What does it cost to reveal one position?',
      options: ['Nothing', '{queryCost} points', '{revealCost} points', 'It depends on the position'],
      answer: 2
    },
    {
      id: 'q_score',
      prompt: 'You reveal three positions and then stop on one of them. How is your score for the round worked out?',
      options: [
        'The prize at the position you stopped on, minus everything you spent',
        'The highest prize you revealed, with no deduction',
        'The sum of the three prizes you revealed',
        'The prize at the position you stopped on, with no deduction'
      ],
      answer: 0
    },
    {
      id: 'q_reset',
      prompt: 'The next round starts. What do you know about its prizes?',
      options: [
        'They are the same as this round',
        'They are drawn afresh, so this round tells me nothing about them',
        'They are always higher than this round',
        'Only the positions that were open stay the same'
      ],
      answer: 1
    }
  ];

  // ---- comprehension gate, AI instructions (§15) --------------------------
  // Question 2 (`qai_score`) carries the design and is the strict gate; the rest
  // record attempts and do not block. `understood_frontier` is qai_outside.
  var QUIZ_AI = [
    {
      id: 'qai_costs',
      prompt: 'What does it cost to ask the AI about a position, and what does it cost to reveal one?',
      options: [
        'Asking {queryCost}, revealing {revealCost}',
        'Asking {revealCost}, revealing {queryCost}',
        'Both cost {revealCost}',
        'Asking is free, revealing costs {revealCost}'
      ],
      answer: 0
    },
    {
      id: 'qai_score',
      strict: true,
      prompt: 'You ask the AI about position 40 and it says 70. You stop on position 40 without revealing it. What do you get?',
      options: [
        '70 points, because that is what the AI said',
        'The true prize at position 40, whatever it turns out to be — it may not be 70',
        'Nothing, because I did not reveal it',
        'The average of 70 and the true prize'
      ],
      answer: 1
    },
    {
      id: 'qai_right',
      prompt: 'Is the AI always right?',
      options: [
        'Yes, its answers are the true prizes',
        'No — it knows some positions exactly and guesses everywhere else',
        'It is right in the middle of the line and wrong at the ends',
        'It is right about half the time, at random'
      ],
      answer: 1
    },
    {
      id: 'qai_tell',
      prompt: 'Can you tell, from a single answer, whether the AI knew that position or guessed it?',
      options: ['Yes, a guess is shown differently', 'Yes, a guess takes longer to arrive', 'No', 'Only if the answer is a round number'],
      answer: 2
    },
    {
      id: 'qai_outside',
      prompt: 'Outside the leftmost and rightmost positions the AI knows, what is its answer based on?',
      options: [
        'Nothing beyond the nearest position it knows — it repeats that value',
        'The overall average of the line',
        'It continues the slope it had at the edge',
        'It refuses to answer out there'
      ],
      answer: 0
    },
    {
      id: 'qai_update',
      prompt: 'What happens to the AI’s answers after you reveal a position?',
      options: [
        'Nothing — it never changes',
        'They can change, because your reveal becomes something it knows',
        'It stops answering about that position',
        'They become exactly right everywhere'
      ],
      answer: 1
    }
  ];

  // The participant-level flag of §16.6: correct on the FIRST attempt at the
  // question about what the line is based on beyond the outermost known position.
  var UNDERSTOOD_FRONTIER_QID = 'qai_outside';

  // ---- exit survey, twenty items (§16.7) ----------------------------------
  // Free text comes before multiple choice within each part, so the options
  // never supply the vocabulary. The debrief comes after every question.
  var SURVEY = [
    { part: 'A', id: 's01', type: 'text', prompt: 'In your own words, how did you decide which position to look at next?' },
    { part: 'A', id: 's02', type: 'text', prompt: 'How did you decide when to stop and settle on a position?' },
    {
      part: 'A', id: 's03', type: 'choice',
      prompt: 'Think about positions near the very ends (1 to 5 and 95 to 100). Compared with the middle of the line, were you more or less likely to look there?',
      options: ['Much less', 'Somewhat less', 'About the same', 'Somewhat more', 'Much more'],
      followText: 'Why?'
    },

    {
      part: 'B', id: 's04', type: 'choice',
      prompt: 'When you asked the AI about a position, how far from the true prize was its answer, usually?',
      options: ['Within 5 points', '5 to 15 points', '15 to 30 points', 'More than 30 points', 'It varied too much to say'],
      aiOnly: true
    },
    {
      part: 'B', id: 's05', type: 'slider', min: 0, max: 10,
      prompt: 'Out of every 10 questions you asked the AI, how many do you think it answered exactly right?',
      aiOnly: true
    },
    {
      part: 'B', id: 's06', type: 'choice',
      prompt: 'Were the AI’s answers equally reliable everywhere, or better in some places?',
      options: ['Equally reliable everywhere', 'Better in the middle', 'Better near positions I had already revealed', 'Better near the ends', 'I could not tell'],
      aiOnly: true
    },
    {
      part: 'B', id: 's07', type: 'choice',
      prompt: 'In some rounds the AI knew 4 positions and in others it knew 10. Did you notice a difference in how useful it was?',
      options: ['A clear difference', 'A slight difference', 'No difference', 'I did not notice the number changing'],
      aiOnly: true
    },
    {
      part: 'B', id: 's08', type: 'choice',
      prompt: 'Did you ever try to work out which positions the AI knew exactly?',
      options: ['Yes', 'No'],
      followText: 'If yes, how?',
      aiOnly: true
    },

    {
      part: 'C', id: 's09', type: 'slider', min: 0, max: 10,
      prompt: 'When you settled on a position you had asked the AI about but never revealed, how confident were you that the AI was right? (0 = not at all, 10 = completely)',
      aiOnly: true
    },
    {
      part: 'C', id: 's10', type: 'choice',
      prompt: 'How often did you act on an AI answer without checking it?',
      options: ['Never', 'Rarely', 'About half the time', 'Usually', 'Always'],
      aiOnly: true
    },
    {
      part: 'C', id: 's11', type: 'choice',
      prompt: 'When you did reveal a position you had already asked about, what were you mainly doing?',
      options: ['Checking whether the AI was right', 'Locking in a prize I intended to settle on', 'Gathering more information generally', 'I rarely did this'],
      aiOnly: true
    },
    {
      part: 'C', id: 's12', type: 'choice',
      prompt: 'Which half of the study do you think you scored higher in?',
      options: ['The half with the AI', 'The half without the AI', 'About the same']
    },
    {
      part: 'C', id: 's13', type: 'slider', min: 0, max: 10,
      prompt: 'In the half without the AI, how much did you miss having it? (0 = not at all, 10 = a great deal)'
    },

    {
      part: 'D', id: 's14', type: 'slider', min: 0, max: 10,
      prompt: 'How willing are you to take risks, in general? (0 = not at all willing, 10 = very willing)'
    },
    {
      part: 'D', id: 's15', type: 'choice',
      prompt: 'How often do you use AI chat tools?',
      options: ['Never', 'A few times a month', 'Weekly', 'Most days', 'Many times a day']
    },
    {
      part: 'D', id: 's16', type: 'choice',
      prompt: 'When an AI tool gives you a factual answer for your studies, how often do you check it against another source?',
      options: ['Never', 'Rarely', 'Sometimes', 'Usually', 'Always']
    },
    {
      part: 'D', id: 's17', type: 'numeracy',
      prompt: 'Three short questions with numerical answers.',
      items: [
        { id: 's17a', prompt: 'If a fair six-sided die is rolled 1,000 times, how many times would it come up even?', answer: 500, suffix: 'times' },
        { id: 's17b', prompt: 'If 1 in every 100 tickets wins a prize and 1,000 tickets are sold, how many winning tickets are there?', answer: 10, suffix: 'tickets' },
        { id: 's17c', prompt: 'If the chance of an event is 1 in 1,000, what percent is that?', answer: 0.1, suffix: '%' }
      ]
    },

    {
      part: 'E', id: 's18', type: 'multi',
      prompt: 'While doing the study, did you use any of the following?',
      options: ['Paper or notes', 'A calculator', 'A spreadsheet', 'An AI chat tool', 'Another person', 'None of these'],
      exclusive: 5
    },
    { part: 'E', id: 's19', type: 'text', prompt: 'Did anything go wrong technically?' },
    { part: 'E', id: 's20', type: 'text', prompt: 'Anything else you would like to tell us?' }
  ];

  // ---- encouragement (config.ui.encouragement) -----------------------------
  // Forty minutes of a repeated task loses people, and a bored participant does
  // not stop producing data — they produce fast, empty rounds that look like
  // decisions. These messages exist to keep attention on the task and to say
  // how much is left.
  //
  // THE RULE EVERY ONE OF THEM OBEYS: say nothing that changes what the best
  // move is. No message names a position, hints where the high prizes are,
  // comments on how well the round is going, or tells the participant to buy
  // anything — "keep searching" points at the task, "reveal position 60" would
  // point at the answer, and a message that moved behaviour toward revealing
  // would move the very quantity the study measures. They are motivational,
  // never informational: identical text in the AI-on and AI-off arms, shown at
  // fixed points in the plan (not in response to how the participant is
  // scoring), and logged so any effect can be looked for rather than assumed.
  var ENCOURAGE = {
    // Between-round pop-ups, at fixed points of each half. {left} = scored
    // rounds still to play in this half, {half} = 'first'/'second'.
    milestones: {
      half: {
        title: 'Halfway through this half',
        body: 'You are doing great so far. {left} rounds to go in this half — keep searching, ' +
              'and see whether a higher prize is hiding somewhere you have not looked.'
      },
      nearEnd: {
        title: 'Only {left} rounds left in this half',
        body: 'Nearly there, and your attention still counts: each of these rounds is scored ' +
              'exactly like the ones before it. Keep going.'
      },
      lastRound: {
        title: 'Last round',
        body: 'This is the final round of the study. Give it the same care as the first one — ' +
              'then a few short questions and you are done.'
      }
    },
    // Between-rounds line, rotated by round index — NOT by how the round went.
    // Unconditional praise is a mood, contingent praise is feedback, and
    // feedback on performance would be a treatment nobody agreed to run.
    cheers: [
      'Nice work — on to the next one.',
      'Good. A fresh line of prizes, and everything you learned about the last one is now history.',
      'Keep it up — every round is scored the same way.',
      'Well played. Take the next one at your own pace.'
    ],
    // The progress line under the round title. {n}/{total} scored rounds of
    // this half, {left} still to come.
    progress: 'Round {n} of {total} in this half · {left} to go',
    progressWarmup: 'Practice round — nothing here is scored',
    // In-round tips (the small dismissible corner card, never a modal).
    tips: {
      encourage: 'You are doing great so far — keep searching, and check whether a higher prize ' +
                 'is hiding somewhere you have not opened yet.',
      idleStart: 'Take your time. When you are ready you can reveal a position, {ask}or stop where you are.',
      idleMid: 'Still thinking? You can stop on the best position you have found whenever you like.'
    },
    // The focus pop-up, when a round is about to be closed after almost no
    // searching. It states the position of the round in the study and what
    // stopping means — never what to do instead.
    rush: {
      title: 'Finish this round already?',
      bodyNone: 'You have not opened a single position in this round, so there is nothing yet to ' +
                'tell you what is really out there. There is no time limit — a moment more here ' +
                'can be worth a lot of points.',
      bodyFew: 'You have opened {did} of the {J} positions in this round. There is no time limit — ' +
               'a moment more here can be worth a lot of points.',
      stay: 'Keep searching',
      go: 'Stop anyway'
    }
  };

  // ---- registration — background, asked ONCE, at the start -----------------
  // These four were the exit survey's Part F. They are background, not
  // outcomes: asking them at the END put them after the participant had spent
  // forty minutes on the task, and on a Simulation Platform launch they were
  // then dropped one by one, leaving a "Part F" that could be empty, complete
  // or anything in between. They are now their own REGISTRATION phase, right
  // after consent — the same shape every other class simulation has, and the
  // one place this study records who the participant is.
  //
  // On a platform launch the answers COME FROM THE PLATFORM's registration
  // (`platformKey`): those items are not asked again, they travel with the row
  // flagged `platform_<key>`, and when the platform covers all of them the
  // phase passes through without a screen. Standalone participants are asked
  // here. Coarse bands only, all optional: with ~90 participants from one
  // population a fine-grained combination is close to identifying.
  //
  // The ids are unchanged from the Part F era on purpose — sessions already
  // collected carry them, and the exporter reads either source into the same
  // column (see admin/export.js).
  var REGISTRATION = [
    { id: 'f_field', type: 'choice', optional: true, platformKey: 'fieldOfStudy',
      prompt: 'Field of study', options: ['Business or economics', 'Engineering or computer science', 'Natural sciences', 'Social sciences or humanities', 'Other', 'Prefer not to say'] },
    { id: 'f_year', type: 'choice', optional: true, platformKey: 'levelOfStudy',
      prompt: 'Year or level of study', options: ['Undergraduate', 'Master’s', 'PhD', 'Not a student', 'Prefer not to say'] },
    { id: 'f_age', type: 'choice', optional: true, platformKey: 'age',
      prompt: 'Age band', options: ['Under 20', '20 to 24', '25 to 29', '30 to 39', '40 or over', 'Prefer not to say'] },
    { id: 'f_gender', type: 'choice', optional: true, platformKey: 'gender',
      prompt: 'Gender', options: ['Woman', 'Man', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'] }
  ];
  // The platform profile fields carried onto the row as `platform_<key>` — the
  // four the registration items map to, plus the rest of what a launch supplies.
  var PLATFORM_BACKGROUND = ['fieldOfStudy', 'levelOfStudy', 'age', 'gender',
                             'nationality', 'country', 'workExperience', 'occupation'];

  var PART_INTRO = {
    A: { title: 'Part A · How you searched', note: 'Please answer in your own words — there are no right answers.' },
    B: { title: 'Part B · The AI', note: '' },
    C: { title: 'Part C · Trust and the decision', note: '' },
    D: { title: 'Part D · About you', note: '' },
    E: { title: 'Part E · Finally', note: '' }
  };

  // ---- debrief (§16.7) -----------------------------------------------------
  var DEBRIEF =
    "**How the AI worked.** In every AI round the AI knew the true prize at a small number of positions exactly — 4 of the 100 in some rounds, 10 in others. It was never told, and never told you, which ones.\n\n" +
    "For any other position it **drew a straight line between the two positions it knew on either side** and read the answer off that line. Beyond the outermost position it knew, it simply **repeated that value**, flat, however far out you asked.\n\n" +
    "That is why some of its answers were exactly right and others were inventions, and why nothing in an answer told you which was which. Every position you revealed was added to what it knew, so its answers improved where you had already looked — and stayed guesses everywhere else.\n\n" +
    "Below is one of your own rounds, redrawn with the true prizes alongside what the AI told you.";

  var THANKS =
    "**Thank you.** Your session has been recorded.\n\n" +
    "If you have any questions about the study, you can contact the researcher through the platform you came from.";

  return {
    CONSENT: CONSENT,
    INSTRUCTIONS: INSTRUCTIONS,
    AI_INSTRUCTIONS: AI_INSTRUCTIONS,
    QUIZ_BASE: QUIZ_BASE,
    QUIZ_AI: QUIZ_AI,
    UNDERSTOOD_FRONTIER_QID: UNDERSTOOD_FRONTIER_QID,
    SURVEY: SURVEY,
    REGISTRATION: REGISTRATION,
    ENCOURAGE: ENCOURAGE,
    PLATFORM_BACKGROUND: PLATFORM_BACKGROUND,
    PART_INTRO: PART_INTRO,
    DEBRIEF: DEBRIEF,
    THANKS: THANKS,

    // Every survey answer column the exporter emits, in screen order. Kept here
    // so admin/export.js and the app can never disagree about the column set.
    surveyColumns: function () {
      var cols = [];
      SURVEY.forEach(function (q) {
        if (q.type === 'numeracy') { q.items.forEach(function (it) { cols.push(it.id); }); return; }
        cols.push(q.id);
        if (q.followText) cols.push(q.id + '_why');
      });
      return cols;
    },

    // Every registration answer column, in screen order (exported as reg_<id>).
    registrationColumns: function () {
      return REGISTRATION.map(function (q) { return q.id; });
    },

    quizColumns: function () {
      return QUIZ_BASE.concat(QUIZ_AI).map(function (q) { return q.id; });
    }
  };
});
