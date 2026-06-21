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
      'This game has three phases: a <b>training phase</b>, a <b>game phase</b>, and a short <b>post-play survey</b>. To take part you will need a <b>session code</b> from the organiser.'
    ],
    welcomeButton: 'Start',
    trainingTitle: 'Training phase',
    trainingBody: 'Each brick is a project that earns a dollar value when you place it in the frame. Choose the right projects and pack them in to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>How to play: tap a brick to select it, then tap a board tile to drop it. Use the arrow keys (or the Rotate / Flip buttons) to rotate and flip the selected brick; tap a placed brick to pick it back up.<br><br>This is a practice round. When the timer ends, or once you are comfortable, you will move on to the main game.',
    trainingButton: 'Begin training',
    registerTitle: 'Registration',
    registerIntro: 'Please complete the information below to join the PortfolioFit Challenge.',
    mainTitle: 'Game phase',
    mainIntro: 'Each brick is a project that earns a dollar value when you place it in the frame. Pack the right projects to maximise <b>net value</b> (the total value of placed bricks minus a $1 penalty for each unused cell) before the timer runs out.<br><br>Every brick shows its dollar value and its value-per-cell (ROI). The tempting high-ROI bricks are often traps: there are many ways to fill the board, but only one combination of projects reaches the highest Net Value. You will play a series of timed puzzles; do your best on each one.',
    statsTitle: 'Thank you for playing!',
    surveyTitle: 'Post-Game Survey',
    surveyIntro: 'Please share your thoughts about the experience (all fields are required).',
    thankyouTitle: 'Thank you for playing!',
    thankyouBody: 'Your responses have been recorded. You may now close this tab.',
    playAgainButton: 'Play again'
  },
  settings: {
    trainingDifficulty: 'easy',
    puzzlesPerUser: { easy: 2, hard: 2 },
    randomizeOrder: true,
    activePuzzleIds: [],
    timeLimits: { easy: 120, hard: 180 }
  },
  // Registration form shown AFTER the training phase (welcome -> training ->
  // registration -> game -> survey). UCD Student ID is the compulsory first field;
  // the rest mirror the Ideation Challenge demographics form. Admin-editable.
  registrationQuestions: [
    { id: 'studentId', label: 'UCD Student ID', type: 'text', required: true },
    { id: 'age', label: 'Age', type: 'select', required: true,
      options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] },
    { id: 'gender', label: 'Gender', type: 'select', required: false,
      options: ['Prefer not to say', 'Male', 'Female', 'Non-binary', 'Other'] },
    { id: 'nationality', label: 'Nationality', type: 'country', required: true },
    { id: 'country', label: 'Country of residence', type: 'country', required: true },
    { id: 'levelOfStudy', label: 'Level of Study', type: 'select', required: true,
      options: ['Undergraduate', 'Postgraduate (Masters)', 'Postgraduate (PhD)', 'MBA', 'Other'] },
    { id: 'workExperience', label: 'Work Experience (in years)', type: 'number', required: true, min: 0, max: 50 },
    { id: 'occupation', label: 'Occupation', type: 'select', required: true,
      options: ['Student', 'Employed full-time', 'Employed part-time', 'Self-employed', 'Unemployed', 'Retired', 'Other'] },
    { id: 'englishFluency', label: 'English Fluency', type: 'select', required: true,
      options: ['Native speaker', 'Fluent', 'Advanced', 'Intermediate', 'Basic'] }
  ],
  // Consent checkboxes shown under the registration form (all required to continue).
  // Empty = no consent section is rendered. Add statements here to bring it back.
  registrationConsents: [],
  // Country list for "Nationality" / "Country of residence" dropdowns (type: 'country').
  countries: [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
    'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
    'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
    'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
    'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
    'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
    'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile',
    'China', 'Colombia', 'Comoros', 'Congo (DRC)', 'Congo (Republic)',
    'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
    'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
    'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
    'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
    'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
    'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
    'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland',
    'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
    'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
    'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo',
    'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
    'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
    'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives',
    'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius',
    'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
    'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia',
    'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua',
    'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
    'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
    'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
    'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
    'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
    'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
    'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
    'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
    'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
    'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
    'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
    'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
    'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
    'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
    'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
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
  // own generator. Used when the admin has not frozen a custom set. Every board is
  // the SAME fixed 4x4 square (16 cells); difficulty is set ONLY by the per-puzzle
  // brick "values" (Easy = Sahni kappa 1, Hard = kappa 2). Each has a UNIQUE best
  // portfolio: one full-cover set reaches the highest Net Value, no partial ties it,
  // and it tiles the board a single way up to rotation/reflection (one solution).
  defaultPuzzles: [
    {"diff":"easy","rows":4,"cols":4,"region":["0,0","0,1","0,2","0,3","1,0","1,1","1,2","1,3","2,0","2,1","2,2","2,3","3,0","3,1","3,2","3,3"],"values":{"I3":17,"L":7,"S":14,"T":10,"L5":18,"Y":12,"P":11,"N":13},"solution":[{"name":"I3","color":"#1abc9c","cells":[[0,0],[1,0],[2,0]]},{"name":"S","color":"#2ecc71","cells":[[0,1],[1,1],[1,2],[2,2]]},{"name":"L5","color":"#e67e22","cells":[[0,2],[0,3],[1,3],[2,3],[3,3]]},{"name":"T","color":"#3498db","cells":[[2,1],[3,0],[3,1],[3,2]]}],"kappa":1,"tilings":{"count":11,"arrangements":88,"capped":false,"complete":true},"bestValue":59},
    {"diff":"easy","rows":4,"cols":4,"region":["0,0","0,1","0,2","0,3","1,0","1,1","1,2","1,3","2,0","2,1","2,2","2,3","3,0","3,1","3,2","3,3"],"values":{"I3":18,"L":17,"S":13,"T":9,"L5":10,"Y":5,"P":13,"N":4},"solution":[{"name":"I3","color":"#1abc9c","cells":[[0,0],[1,0],[2,0]]},{"name":"P","color":"#e74c3c","cells":[[0,1],[0,2],[0,3],[1,1],[1,2]]},{"name":"L","color":"#c9b458","cells":[[1,3],[2,3],[3,2],[3,3]]},{"name":"S","color":"#2ecc71","cells":[[2,1],[2,2],[3,0],[3,1]]}],"kappa":1,"tilings":{"count":11,"arrangements":88,"capped":false,"complete":true},"bestValue":61},
    {"diff":"hard","rows":4,"cols":4,"region":["0,0","0,1","0,2","0,3","1,0","1,1","1,2","1,3","2,0","2,1","2,2","2,3","3,0","3,1","3,2","3,3"],"values":{"I3":11,"L":14,"S":5,"T":7,"L5":16,"Y":13,"P":8,"N":19},"solution":[{"name":"I3","color":"#1abc9c","cells":[[0,0],[1,0],[2,0]]},{"name":"T","color":"#3498db","cells":[[0,1],[1,1],[1,2],[2,1]]},{"name":"L5","color":"#e67e22","cells":[[0,2],[0,3],[1,3],[2,3],[3,3]]},{"name":"L","color":"#c9b458","cells":[[2,2],[3,0],[3,1],[3,2]]}],"kappa":2,"tilings":{"count":11,"arrangements":88,"capped":false,"complete":true},"bestValue":48},
    {"diff":"hard","rows":4,"cols":4,"region":["0,0","0,1","0,2","0,3","1,0","1,1","1,2","1,3","2,0","2,1","2,2","2,3","3,0","3,1","3,2","3,3"],"values":{"I3":7,"L":10,"S":4,"T":14,"L5":14,"Y":10,"P":13,"N":18},"solution":[{"name":"I3","color":"#1abc9c","cells":[[0,0],[1,0],[2,0]]},{"name":"T","color":"#3498db","cells":[[0,1],[1,1],[1,2],[2,1]]},{"name":"L5","color":"#e67e22","cells":[[0,2],[0,3],[1,3],[2,3],[3,3]]},{"name":"L","color":"#c9b458","cells":[[2,2],[3,0],[3,1],[3,2]]}],"kappa":2,"tilings":{"count":11,"arrangements":88,"capped":false,"complete":true},"bestValue":45}
  ]
};
