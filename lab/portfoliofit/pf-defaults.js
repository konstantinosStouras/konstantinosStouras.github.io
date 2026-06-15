/* =====================================================================
   PortfolioFit for Managers — built-in defaults (single source of truth)
   Loaded before experiment.js and admin.js so the participant app and the
   admin "Restore built-in default" both reference the same values.
   ===================================================================== */
window.PF_DEFAULTS = {
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
    trainingBody: 'Each brick is a project that earns a dollar value when you place it in the frame. Choose the right projects and pack them in to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>How to play: tap a brick to select it, then tap a board tile to drop it. Use the arrow keys (or the Rotate / Flip buttons) to rotate and flip the selected brick; tap a placed brick to pick it back up.<br><br>This is a practice round. When the timer ends, or once you are comfortable, you will move on to registration.',
    trainingButton: 'Begin training',
    registerTitle: 'Registration',
    registerIntro: 'Please provide some basic information about yourself.',
    mainTitle: 'Game phase',
    mainIntro: 'Each brick is a project that earns a dollar value when you place it in the frame. Pack the right projects to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>Every brick shows its dollar value and its value-per-cell (ROI). The tempting high-ROI bricks are often traps: there are many ways to fill the board, but only one reaches the highest Net Value. You will play a series of timed puzzles; do your best on each one.',
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
  ],
  // Built-in default active set: 2 easy + 2 hard puzzles, produced by the game's
  // own generator. Used when the admin has not frozen a custom set.
  defaultPuzzles: [
    {"diff":"easy","rows":5,"cols":7,"region":["3,2","3,3","3,4","4,4","2,6","3,5","3,6","4,5","4,6","0,0","1,0","1,1","2,1","3,1"],"solution":[{"name":"L","color":"#c9b458","cells":[[3,2],[3,3],[3,4],[4,4]]},{"name":"P","color":"#e74c3c","cells":[[2,6],[3,5],[3,6],[4,5],[4,6]]},{"name":"N","color":"#f1c40f","cells":[[0,0],[1,0],[1,1],[2,1],[3,1]]}],"kappa":2,"tilings":{"count":3,"capped":false,"complete":true},"bestValue":31},
    {"diff":"easy","rows":4,"cols":5,"region":["1,1","1,2","2,2","2,3","2,0","2,1","3,1","3,2","3,3","0,3","0,4","1,3","1,4","2,4"],"solution":[{"name":"S","color":"#2ecc71","cells":[[1,1],[1,2],[2,2],[2,3]]},{"name":"N","color":"#f1c40f","cells":[[2,0],[2,1],[3,1],[3,2],[3,3]]},{"name":"P","color":"#e74c3c","cells":[[0,3],[0,4],[1,3],[1,4],[2,4]]}],"kappa":2,"tilings":{"count":6,"capped":false,"complete":true},"bestValue":28},
    {"diff":"hard","rows":6,"cols":5,"region":["3,4","4,3","4,4","5,3","2,2","3,1","3,2","3,3","0,2","0,3","1,0","1,1","1,2","4,0","4,1","4,2","5,0","5,1"],"solution":[{"name":"S","color":"#2ecc71","cells":[[3,4],[4,3],[4,4],[5,3]]},{"name":"T","color":"#3498db","cells":[[2,2],[3,1],[3,2],[3,3]]},{"name":"N","color":"#f1c40f","cells":[[0,2],[0,3],[1,0],[1,1],[1,2]]},{"name":"P","color":"#e74c3c","cells":[[4,0],[4,1],[4,2],[5,0],[5,1]]}],"kappa":3,"tilings":{"count":3,"capped":false,"complete":true},"bestValue":38},
    {"diff":"hard","rows":4,"cols":10,"region":["0,7","0,8","0,9","1,7","1,8","0,4","1,4","1,5","1,6","0,3","1,2","1,3","2,2","3,2","1,1","2,0","2,1","3,1"],"solution":[{"name":"P","color":"#e74c3c","cells":[[0,7],[0,8],[0,9],[1,7],[1,8]]},{"name":"L","color":"#c9b458","cells":[[0,4],[1,4],[1,5],[1,6]]},{"name":"N","color":"#f1c40f","cells":[[0,3],[1,2],[1,3],[2,2],[3,2]]},{"name":"T","color":"#3498db","cells":[[1,1],[2,0],[2,1],[3,1]]}],"kappa":3,"tilings":{"count":4,"capped":false,"complete":true},"bestValue":43}
  ]
};
