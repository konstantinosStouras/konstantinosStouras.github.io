/* ==========================================================================
   search-v2  ·  content.js
   Every word the participant reads, and every question they answer, as DATA.

   Instruction screens (§13.2, §15), the two comprehension gates (§15), and the
   twenty exit-survey items (§16.7) live here rather than in app.js, so that the
   participant screen, the admin panel's preview and the Excel exporter's column
   dictionary are all generated from ONE definition and can never drift apart.

   Tokens in the prose are substituted at render time: {J} positions,
   {revealCost}, {queryCost}, {L} step bound, {scored} scored rounds per block,
   {warmup} warm-up rounds per block. ({K} — how many positions the AI knows —
   is substituted too, but no participant-facing text uses it: that number is the
   study's own manipulation and is never disclosed.)

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
        "So if position 40 hides 50 points, position 41 hides somewhere between 40 and 60 points, position 42 between 30 and 70 points, and so on — {L} more points of possible difference for each further step.\n\n" +
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
      // {scoreRule} and {scoreRuleNote} are substituted with the sentences for
      // THIS session's settlement rule (costs.stopRule) — see app.js tokens().
      // One field, so rewording it in the Wording tab reaches either rule.
      body:
        "When you are ready, you **{stopVerb}**. The round then ends.\n\n" +
        "**{scoreRule}**\n\n" +
        "{scoreRuleNote}\n\n" +
        "A round can end below zero if you spend more than the prize you take. That is allowed, and it is recorded."
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
        "At the start of each round the AI knows the **true prize at a small number of positions**. It is not told which ones you can see, and **you are never told which ones it knows, or how many**.\n\n" +
        "For any other position, it **guesses by drawing a straight line between the two positions it knows on either side**. Beyond the outermost position it knows, it simply **repeats that position's value**.\n\n" +
        "So some of its answers are exactly right and others are inventions, and **an answer never looks any different in the two cases**."
    },
    {
      id: 'a3',
      title: 'The AI learns from your reveals',
      body:
        "Every position **you** reveal is added to what the AI knows, together with every position that started open.\n\n" +
        "So the AI's answers can change after you reveal something, and asking about the same position again — at full cost — can give a different answer.\n\n" +
        "**The AI's number is never a prize.** It is an estimate: it tells you where a reveal might be worth spending, and nothing more. {scoreRuleNote}"
    }
  ];

  // ---- comprehension gate, base instructions (§15) ------------------------
  // Adapted from the source instruction screens: the highest and lowest possible
  // prize one and two steps away from a revealed prize.
  // The gate tests whether the rules can be USED, not whether a number can be
  // read back off the screen. The reminder above these questions — and, since
  // 2026-08, the strip on top of every plot — state both costs and the step
  // bound outright, so an item that merely asks for one of them is answered by
  // copying. Every item below therefore puts the rule to work on a case.
  //
  // The ids are the export's own column names and never change; several no
  // longer describe what the item asks (q_adj_lo1 is a "highest" question), and
  // that is deliberate — a renamed column would break every session already
  // collected, while the question behind it is free to improve.
  //
  // The three arithmetic items state their numbers outright, so they assume the
  // study's own step bound and prize range; selftest.js fails if those defaults
  // ever move, rather than letting a wrong answer key reach a participant.
  var QUIZ_BASE = [
    {
      id: 'q_adj_hi1',
      prompt: 'You revealed position 50 and it holds 80 points. How much does that tell you about the prize at position 90?',
      options: [
        'Almost nothing \u2014 40 steps of up to {stepBound} each cover the whole range',
        'It is at least 40 points',
        'It is at most 80 points',
        'It is about 80 points, give or take a little'
      ],
      answer: 0,
      why: 'The bound binds one STEP at a time. Over 40 positions it allows a change of 40 \u00d7 {stepBound} points, ' +
           'which is more than the whole range \u2014 so a far-away position is barely constrained at all. ' +
           'What you reveal tells you most about what is NEAR it.'
    },
    {
      id: 'q_adj_hi2',
      prompt: 'Position 15 was revealed and holds 50 points. What is the HIGHEST the prize at position 14 \u2014 one position to its LEFT \u2014 could be?',
      options: ['50 points', '55 points', '60 points', 'It could be anything from 0 to 100'],
      answer: 2,
      why: 'The bound works in both directions: from 50 points, one step to the LEFT can reach 50 + {stepBound} ' +
           'points, exactly as one step to the right can. There is nothing special about the direction you look in.'
    },
    {
      id: 'q_adj_lo1',
      prompt: 'Position 80 was revealed and holds 95 points. What is the HIGHEST the prize at position 82 could be?',
      options: ['100 points', '105 points', '115 points', '95 points'],
      answer: 0,
      why: 'Two steps allow 2 \u00d7 {stepBound} points, which would be 115 points \u2014 but no prize on the line ' +
           'is above {prizeMax} points, so 100 points is the most it can be. Near the top of the range the ceiling binds before the step bound does.'
    },
    {
      id: 'q_cost',
      prompt: 'In one round you reveal three positions and then stop. The best of the three holds 60 points. What is your score for that round?',
      options: [
        'The prize where I stopped, minus the 3 \u00d7 {revealCost} points I spent',
        'The prize where I stopped, with nothing deducted',
        'The best prize I revealed, minus {revealCost} points',
        'The three prizes added together, minus the 3 \u00d7 {revealCost} points I spent'
      ],
      answer: 0,
      why: 'Each reveal costs {revealCost} points whatever it turns out to show, and every one of them comes off ' +
           'the prize you take. Only ONE prize is ever paid.'
    },
    {
      id: 'q_score',
      prompt: 'You reveal six positions and then stop. The best of them holds 20 points. What is your score for that round?',
      options: [
        'Below zero \u2014 the prize minus everything I spent, which can be negative',
        'Zero \u2014 a round can never score below zero',
        '20 points \u2014 what I spent does not come off the prize',
        'The round does not count, and it is replayed'
      ],
      answer: 0,
      why: 'Six reveals cost 6 \u00d7 {revealCost} points, which is more than the 20 points you stop on, so the round ends ' +
           'below zero. That is allowed \u2014 which is why searching on and on is a real risk, not a free one.'
    },
    {
      id: 'q_reset',
      prompt: 'In this round the biggest prize you found was near position 80. What does that tell you about where the biggest prize will be in the NEXT round?',
      options: [
        'Nothing \u2014 every round is a fresh draw',
        'It will be near position 80 again',
        'It will be far from position 80',
        'It will be somewhere in the same half of the line'
      ],
      answer: 0,
      why: 'Every round draws a whole new line of prizes. Where they happened to sit this round carries no ' +
           'information at all about the next one.'
    }
  ];

  // ---- comprehension gate, AI instructions (§15) --------------------------
  // Question 2 (`qai_score`) carries the design and is the strict gate; the rest
  // record attempts and do not block. `understood_frontier` is qai_outside.
  var QUIZ_AI = [
    {
      id: 'qai_costs',
      prompt: 'You are choosing between asking the AI about a position and revealing it. Which of these is true?',
      options: [
        'Asking is cheaper, but only revealing tells me the true prize',
        'Asking is cheaper, and both of them tell me the true prize',
        'Revealing is cheaper, and the AI is the more accurate of the two',
        'They cost the same, so it makes no difference which I use'
      ],
      answer: 0,
      why: 'Asking costs {queryCost} points and revealing costs {revealCost} points. Asking is cheaper precisely BECAUSE it ' +
           'does not tell you the prize \u2014 it returns an estimate, which can be wrong.'
    },
    {
      id: 'qai_score',
      strict: true,
      prompt: 'Earlier this round the AI said 55 points about a position you then revealed, and it was exactly 55 points. Now it says 70 points about position 40, which you have NOT revealed. What is that 70 points worth to you?',
      options: [
        'Nothing on its own \u2014 it is an estimate, not a prize I have found',
        '70 points, because the AI has been accurate this round',
        '55 points, the last number it got right',
        'The average of 70 points and the true prize'
      ],
      answer: 0,
      why: 'The AI is exactly right at the positions it knows and guesses everywhere else, and nothing in an ' +
           'answer tells you which of the two you have just been given. Only a prize you have actually ' +
           'revealed counts \u2014 being right once says nothing about the next answer.'
    },
    {
      id: 'qai_right',
      prompt: 'Where is the AI\u2019s answer most likely to be far from the truth?',
      options: [
        'Far from any position it knows \u2014 a long stretch with nothing revealed in it',
        'Close to a position it knows',
        'At a position you have just revealed',
        'It is equally likely to be far out anywhere on the line'
      ],
      answer: 0,
      why: 'Between two positions it knows, it simply draws a straight line. The further you are from either ' +
           'of them, the more room the real prizes have had to wander away from that line.'
    },
    {
      id: 'qai_tell',
      prompt: 'The AI answers 62 points about a position \u2014 quickly, and to the nearest point, as always. What does that tell you about whether it knew that position or guessed it?',
      options: [
        'Nothing \u2014 every answer is rounded the same way and arrives after the same delay',
        'It knew it, because the answer came back quickly',
        'It guessed, because 62 points is not a round number',
        'It knew it, because it gave a single number rather than a range'
      ],
      answer: 0,
      why: 'Known and guessed answers are presented identically, on purpose. You cannot tell them apart from ' +
           'the answer itself \u2014 only revealing a position ever settles what is there.'
    },
    {
      id: 'qai_outside',
      prompt: 'The AI says 45 points at position 92, 45 points at position 97 and 45 points at position 100. What is the most likely explanation?',
      options: [
        'The outermost position it knows is at or before 92, and beyond that it just repeats that value',
        'The prizes really are 45 points all the way to the end of the line',
        'The AI has stopped working',
        'Out there it answers with the average of the whole line'
      ],
      answer: 0,
      why: 'Beyond the outermost position it knows, the AI has nothing to interpolate between, so it repeats ' +
           'that position\u2019s value. A flat run of identical answers is what the edge of its knowledge looks like.'
    },
    {
      id: 'qai_update',
      prompt: 'The AI said 30 points at position 60. You then reveal position 58, which holds 90 points. You ask about position 60 again, at full cost. What should you expect?',
      options: [
        'A different answer is quite possible \u2014 what I revealed is now part of what it knows',
        'Exactly 30 points again \u2014 its answers never change',
        'Exactly 90 points, the value I have just revealed',
        'It will refuse, because I have already asked about position 60'
      ],
      answer: 0,
      why: 'Everything you reveal is added to what the AI knows, so the line it draws moves and its later ' +
           'answers can change \u2014 which is why asking again can be worth the {queryCost}.'
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
  //
  // FIELD OF STUDY was dropped in 2026-08 (owner: irrelevant to this study).
  // It was the only item the Simulation Platform does NOT answer, so removing
  // it means a platform launch now has nothing left to ask and the phase passes
  // through with no screen at all; a standalone participant is asked the three
  // below. Nothing else needed changing, because every consumer is derived from
  // this array — registrationColumns() (the reg_<id> workbook columns),
  // outline() (the Wording tab's editable fields) and resolve() (the
  // per-session copy). Sessions already collected keep the answers they hold;
  // the exporter writes one column per item of THIS array, so a re-export of an
  // older session simply stops carrying reg_f_field.
  var REGISTRATION = [
    { id: 'f_year', type: 'choice', optional: true, platformKey: 'levelOfStudy',
      prompt: 'Year or level of study', options: ['Undergraduate', 'Master’s', 'PhD', 'Not a student', 'Prefer not to say'] },
    { id: 'f_age', type: 'choice', optional: true, platformKey: 'age',
      prompt: 'Age band', options: ['Under 20', '20 to 24', '25 to 29', '30 to 39', '40 or over', 'Prefer not to say'] },
    { id: 'f_gender', type: 'choice', optional: true, platformKey: 'gender',
      prompt: 'Gender', options: ['Woman', 'Man', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'] }
  ];
  // The platform profile fields carried onto the row as `platform_<key>` — the
  // three the registration items map to, plus the rest of what a launch
  // supplies. `fieldOfStudy` left this list with the question: the platform's
  // own registration does not collect it either (simulation/answers.js has no
  // such answer set — it is why field of study was the one item a platform
  // launch still had to ask), so no data is thrown away by dropping it. Every
  // other key here IS supplied by a launch and is carried without being asked.
  var PLATFORM_BACKGROUND = ['levelOfStudy', 'age', 'gender',
                             'nationality', 'country', 'workExperience', 'occupation'];

  var PART_INTRO = {
    A: { title: 'Part A · How you searched', note: 'Please answer in your own words — there are no right answers.' },
    B: { title: 'Part B · The AI', note: '' },
    C: { title: 'Part C · Trust and the decision', note: '' },
    D: { title: 'Part D · About you', note: '' },
    E: { title: 'Part E · Finally', note: '' },
    // Only reachable through the registration MIGRATION path (app.js
    // surveyItems): a participant who was already in the rounds when the
    // registration phase shipped answers the background block here instead,
    // where it used to live.
    F: { title: 'Part F · Background', note: 'Every question in this part is optional — leave any of them blank.' }
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

  // ==========================================================================
  //  PER-SESSION WORDING OVERRIDES
  //  The words above are the study's defaults. A session may carry its own
  //  wording in `run.content` — a FLAT map of override key to replacement
  //  string — which the admin panel's Wording tab writes and every reader
  //  applies through `resolve()` below.
  //
  //  STRUCTURE IS NEVER OVERRIDABLE, only wording. Ids, answer keys, option
  //  COUNTS, question types, `strict`, `platformKey` and the numeracy answers
  //  all come from the definitions above whatever a session says. That is the
  //  whole safety argument: `admin/dictionary.js` describes one column per
  //  field and `surveyColumns()`/`quizColumns()` derive the export from these
  //  ids, so a session that could add a question or renumber an answer key
  //  would silently invalidate its own workbook. Rewording cannot.
  //
  //  Flat, because Firestore cannot store a directly-nested array and a flat
  //  string→string map is the shape that survives a round trip unexamined.
  //
  //  It is STORED as a JSON string (`run.contentJson`), like `specsJson` beside
  //  it, and for a sharper reason than convention: the admin writes runs with
  //  setDoc(merge:true), which DEEP-MERGES a nested map. Stored as a map, a
  //  reverted field would be merged back out of existence — "revert" would
  //  appear to work in the panel and change nothing for the participant. A
  //  string field is replaced whole, so removing a key actually removes it.
  // ==========================================================================
  var MAX_LEN = 4000;          // a generous ceiling; the longest default is ~700

  function fieldsOfQuiz(list, ns) {
    var out = [];
    list.forEach(function (q) {
      out.push({ key: ns + '.' + q.id + '.prompt', label: q.id + ' · question', kind: 'prose', base: q.prompt });
      q.options.forEach(function (o, i) {
        out.push({
          key: ns + '.' + q.id + '.opt.' + i, kind: 'line', base: o,
          label: q.id + ' · answer ' + (i + 1) + (i === q.answer ? ' (the correct one)' : '')
        });
      });
      if (q.why != null) {
        out.push({ key: ns + '.' + q.id + '.why', label: q.id + ' · explanation after answering', kind: 'prose', base: q.why });
      }
    });
    return out;
  }

  function fieldsOfSurvey(items) {
    var out = [];
    items.forEach(function (q) {
      out.push({ key: 'survey.' + q.id + '.prompt', label: q.id + ' · question', kind: 'prose', base: q.prompt });
      (q.options || []).forEach(function (o, i) {
        out.push({ key: 'survey.' + q.id + '.opt.' + (i), label: q.id + ' · answer ' + (i + 1), kind: 'line', base: o });
      });
      if (q.followText) {
        out.push({ key: 'survey.' + q.id + '.follow', label: q.id + ' · follow-up prompt', kind: 'line', base: q.followText });
      }
      (q.items || []).forEach(function (it) {
        out.push({ key: 'survey.' + q.id + '.item.' + it.id, label: it.id + ' · question', kind: 'prose', base: it.prompt });
      });
    });
    return out;
  }

  // Every string in ENCOURAGE, derived from the object itself so a message
  // added there cannot be left out of the Wording tab.
  function encourageFields() {
    var out = [];
    Object.keys(ENCOURAGE.milestones).forEach(function (k) {
      out.push({ key: 'enc.milestone.' + k + '.title', label: k + ' · heading', kind: 'line', base: ENCOURAGE.milestones[k].title });
      out.push({ key: 'enc.milestone.' + k + '.body', label: k + ' · text', kind: 'prose', base: ENCOURAGE.milestones[k].body });
    });
    Object.keys(ENCOURAGE.tips).forEach(function (k) {
      out.push({ key: 'enc.tip.' + k, label: 'tip · ' + k, kind: 'prose', base: ENCOURAGE.tips[k] });
    });
    ENCOURAGE.cheers.forEach(function (c, i) {
      out.push({ key: 'enc.cheer.' + i, label: 'between rounds · line ' + (i + 1), kind: 'line', base: c });
    });
    ['title', 'bodyNone', 'bodyFew', 'stay', 'go'].forEach(function (k) {
      out.push({ key: 'enc.rush.' + k, label: 'focus prompt · ' + k, kind: (k.indexOf('body') === 0 ? 'prose' : 'line'), base: ENCOURAGE.rush[k] });
    });
    return out;
  }

  // The editable outline, in the order a participant meets the words. The admin
  // panel renders it top to bottom and it doubles as the whitelist: a key that
  // is not in here is not a key anybody can set.
  function outline() {
    var groups = [];
    groups.push({
      id: 'consent', title: 'Consent',
      when: 'The first screen, before anything else.',
      fields: [{ key: 'consent', label: 'Consent text', kind: 'prose', base: CONSENT }]
    });
    groups.push({
      id: 'registration', title: 'Registration',
      when: 'Background, asked once between consent and the instructions. Every item is optional. ' +
            'A Simulation Platform launch answers all three from the student\u2019s platform registration, ' +
            'so those participants never see this screen \u2014 only a standalone participant is asked.',
      fields: REGISTRATION.reduce(function (acc, q) {
        acc.push({ key: 'reg.' + q.id + '.prompt', label: q.id + ' · question', kind: 'line', base: q.prompt });
        q.options.forEach(function (o, i) {
          acc.push({ key: 'reg.' + q.id + '.opt.' + i, label: q.id + ' · answer ' + (i + 1), kind: 'line', base: o });
        });
        return acc;
      }, [])
    });
    groups.push({
      id: 'instructions', title: 'Instructions',
      when: 'Five screens, shown once before the first block.',
      fields: INSTRUCTIONS.reduce(function (acc, s) {
        acc.push({ key: 'instr.' + s.id + '.title', label: s.id + ' · heading', kind: 'line', base: s.title });
        acc.push({ key: 'instr.' + s.id + '.body', label: s.id + ' · text', kind: 'prose', base: s.body });
        return acc;
      }, [])
    });
    groups.push({
      id: 'quiz', title: 'Quick check',
      when: 'The comprehension gate after the instructions. Every question must be answered to continue.',
      fields: fieldsOfQuiz(QUIZ_BASE, 'quiz')
    });
    groups.push({
      id: 'ai', title: 'About the AI',
      when: 'Three screens, shown once before the half of the study that has the AI.',
      fields: AI_INSTRUCTIONS.reduce(function (acc, s) {
        acc.push({ key: 'ai.' + s.id + '.title', label: s.id + ' · heading', kind: 'line', base: s.title });
        acc.push({ key: 'ai.' + s.id + '.body', label: s.id + ' · text', kind: 'prose', base: s.body });
        return acc;
      }, [])
    });
    groups.push({
      id: 'aiquiz', title: 'Quick check · the AI',
      when: 'The second comprehension gate. One question is a strict gate and must be answered correctly.',
      fields: fieldsOfQuiz(QUIZ_AI, 'aiquiz')
    });
    groups.push({
      id: 'encourage', title: 'Encouragement',
      when: 'The pop-ups and tips that keep attention on a forty-minute task. Every one of them is ' +
            'motivational and never informational — see the rule in content.js — so a rewording must ' +
            'not name a position, comment on how the participant is doing, or differ between the two arms.',
      fields: encourageFields()
    });
    var partFields = [];
    Object.keys(PART_INTRO).forEach(function (p) {
      partFields.push({ key: 'part.' + p + '.title', label: 'Part ' + p + ' · heading', kind: 'line', base: PART_INTRO[p].title });
      partFields.push({ key: 'part.' + p + '.note', label: 'Part ' + p + ' · note under the heading', kind: 'line', base: PART_INTRO[p].note });
    });
    groups.push({
      id: 'parts', title: 'Survey · part headings',
      when: 'The headings that divide the exit survey.',
      fields: partFields
    });
    groups.push({
      id: 'survey', title: 'Survey · questions',
      when: 'The exit survey, after the last round. Part B and C items are shown only to participants who played with the AI.',
      fields: fieldsOfSurvey(SURVEY)
    });
    groups.push({
      id: 'end', title: 'Debrief and thanks',
      when: 'The last two screens.',
      fields: [
        { key: 'debrief', label: 'Debrief', kind: 'prose', base: DEBRIEF },
        { key: 'thanks', label: 'Thank-you', kind: 'prose', base: THANKS }
      ]
    });
    return groups;
  }

  var _baseIndex = null;
  function baseIndex() {
    if (_baseIndex) return _baseIndex;
    _baseIndex = {};
    outline().forEach(function (g) {
      g.fields.forEach(function (f) { _baseIndex[f.key] = f.base == null ? '' : String(f.base); });
    });
    return _baseIndex;
  }

  // Keep only known keys holding a usable string that actually DIFFERS from the
  // default. Storing a value equal to the default would freeze this session's
  // wording against a later correction to content.js for no reason, so an
  // untouched — or reverted — field is dropped rather than written.
  function normalizeOverrides(raw) {
    var base = baseIndex(), out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) return;
      var v = raw[k];
      if (typeof v !== 'string') return;
      v = v.replace(/\r\n/g, '\n').trim();
      if (!v || v.length > MAX_LEN) return;
      if (v === String(base[k]).trim()) return;
      out[k] = v;
    });
    return out;
  }

  // Overrides as they are STORED: a JSON string, or nothing. Anything
  // unparseable is no overrides at all — a session whose wording cannot be read
  // shows the study's own words rather than failing to open.
  function parseOverrides(json) {
    if (!json) return {};
    if (typeof json === 'object') return normalizeOverrides(json);
    try { return normalizeOverrides(JSON.parse(String(json))); } catch (e) { return {}; }
  }
  function stringifyOverrides(raw) { return JSON.stringify(normalizeOverrides(raw)); }

  // The content this session actually shows. Same shape as the defaults, so a
  // caller reads `C.SURVEY` exactly as it used to read `Content.SURVEY`.
  // Accepts either the stored string or an already-parsed map.
  function resolve(raw) {
    var o = parseOverrides(raw);
    function P(key, base) { return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : base; }

    function screens(list, ns) {
      return list.map(function (s) {
        return { id: s.id, title: P(ns + '.' + s.id + '.title', s.title), body: P(ns + '.' + s.id + '.body', s.body) };
      });
    }
    function quiz(list, ns) {
      return list.map(function (q) {
        var out = {};
        Object.keys(q).forEach(function (k) { out[k] = q[k]; });   // ids, answer, strict survive
        out.prompt = P(ns + '.' + q.id + '.prompt', q.prompt);
        out.options = q.options.map(function (opt, i) { return P(ns + '.' + q.id + '.opt.' + i, opt); });
        if (q.why != null) out.why = P(ns + '.' + q.id + '.why', q.why);
        return out;
      });
    }
    var parts = {};
    Object.keys(PART_INTRO).forEach(function (p) {
      parts[p] = { title: P('part.' + p + '.title', PART_INTRO[p].title), note: P('part.' + p + '.note', PART_INTRO[p].note) };
    });

    return {
      CONSENT: P('consent', CONSENT),
      INSTRUCTIONS: screens(INSTRUCTIONS, 'instr'),
      AI_INSTRUCTIONS: screens(AI_INSTRUCTIONS, 'ai'),
      QUIZ_BASE: quiz(QUIZ_BASE, 'quiz'),
      QUIZ_AI: quiz(QUIZ_AI, 'aiquiz'),
      UNDERSTOOD_FRONTIER_QID: UNDERSTOOD_FRONTIER_QID,
      SURVEY: SURVEY.map(function (q) {
        var out = {};
        Object.keys(q).forEach(function (k) { out[k] = q[k]; });   // type, id, answer, platformKey survive
        out.prompt = P('survey.' + q.id + '.prompt', q.prompt);
        if (q.options) out.options = q.options.map(function (opt, i) { return P('survey.' + q.id + '.opt.' + i, opt); });
        if (q.followText) out.followText = P('survey.' + q.id + '.follow', q.followText);
        if (q.items) {
          out.items = q.items.map(function (it) {
            var c = {};
            Object.keys(it).forEach(function (k) { c[k] = it[k]; });   // the numeracy ANSWER survives
            c.prompt = P('survey.' + q.id + '.item.' + it.id, it.prompt);
            return c;
          });
        }
        return out;
      }),
      REGISTRATION: REGISTRATION.map(function (q) {
        var out = {};
        Object.keys(q).forEach(function (k) { out[k] = q[k]; });   // id, platformKey, optional survive
        out.prompt = P('reg.' + q.id + '.prompt', q.prompt);
        out.options = q.options.map(function (opt, i) { return P('reg.' + q.id + '.opt.' + i, opt); });
        return out;
      }),
      ENCOURAGE: (function () {
        var e = { milestones: {}, tips: {}, cheers: [], rush: {} };
        Object.keys(ENCOURAGE.milestones).forEach(function (k) {
          e.milestones[k] = {
            title: P('enc.milestone.' + k + '.title', ENCOURAGE.milestones[k].title),
            body: P('enc.milestone.' + k + '.body', ENCOURAGE.milestones[k].body)
          };
        });
        Object.keys(ENCOURAGE.tips).forEach(function (k) { e.tips[k] = P('enc.tip.' + k, ENCOURAGE.tips[k]); });
        e.cheers = ENCOURAGE.cheers.map(function (c, i) { return P('enc.cheer.' + i, c); });
        ['title', 'bodyNone', 'bodyFew', 'stay', 'go'].forEach(function (k) {
          e.rush[k] = P('enc.rush.' + k, ENCOURAGE.rush[k]);
        });
        return e;
      })(),
      PLATFORM_BACKGROUND: PLATFORM_BACKGROUND,
      PART_INTRO: parts,
      DEBRIEF: P('debrief', DEBRIEF),
      THANKS: P('thanks', THANKS),
      surveyColumns: M.surveyColumns,
      registrationColumns: M.registrationColumns,
      quizColumns: M.quizColumns
    };
  }

  var M = {
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
    },

    // ---- the per-session wording layer -------------------------------------
    MAX_LEN: MAX_LEN,
    outline: outline,
    normalizeOverrides: normalizeOverrides,
    parseOverrides: parseOverrides,
    stringifyOverrides: stringifyOverrides,
    resolve: resolve
  };

  return M;
});
