/* Simulation Platform — catalog of hosted simulations (one entry per app).
   This file is the ONE place that knows how each simulation is launched,
   how it receives a Session ID, and where its own admin panel lives.
   Keep it in sync with what is actually served under /lab/ (see CLAUDE.md).

   Fields:
     key           stable id — used in config.json / Firestore and the handoff
     title/icon/blurb   what the student card shows
     path          absolute URL path of the student-facing app
     external      full https URL when the app is hosted off stouras.com
                   (cross-origin: the localStorage handoff cannot reach it)
     session       how the app receives a Session ID:
                     'auto'    — query param, the app joins by itself
                     'prefill' — query param pre-fills the app's own join screen
                     'inapp'   — the app asks for the code on its own screen
                                 (the launch dialog copies it to the clipboard)
                     'none'    — the app has no session concept
     optionalSession  true → a Session ID is accepted but not required
     sessionParam  query parameter name for auto/prefill
     params(profile, session)  extra query params appended at launch
     seeds(profile, session)   [[localStorage key, value], …] written just
                   before launch (same-origin, so the app can read them)
     manualCopy    true → the app has its own registration/identity form the
                   platform cannot reach yet; the launch dialog shows the
                   student's saved details with copy buttons
     adminUrl      the app's own admin panel (null = none)
     adminAuth     'firebase' — email/password against the app's OWN Firebase
                   project; 'open' — URL param only; null — no admin panel
     adminNote     shown in the platform admin panel's consoles section
*/
window.SIMP_CATALOG = [
  {
    key: 'ssc', title: 'Sustainable Supply Chains', icon: '🚲',
    path: '/sustainable-supply-chains/',
    blurb: 'Competing e-bike firms source components worldwide: bullwhip, logistics, tariffs, competition and ESG.',
    session: 'auto', sessionParam: 'code',
    adminUrl: '/sustainable-supply-chains/admin/', adminAuth: 'firebase',
    adminNote: 'Email/password per SSC_ADMIN_EMAILS in sustainable-supply-chains/firebase-config.js (localStorage demo mode needs no password). Create sessions in its Sessions tab.'
  },
  {
    key: 'ideasearchlab', title: 'Ideation Challenge', icon: '💡',
    path: '/lab/ideasearchlab/join',
    blurb: 'Team ideation experiment: individual brainstorming, a group round and a survey — with optional AI assistance.',
    session: 'inapp',
    manualCopy: true,
    adminUrl: '/lab/ideasearchlab/admin/', adminAuth: 'firebase',
    adminNote: 'Instructor account on the “ideasearchlab” Firebase project. Students also create their own login (name/e-mail/password) before joining.'
  },
  {
    key: 'search-v2', title: 'Search for Knowledge, with & without AI', icon: '🔎',
    path: '/lab/search-v2/',
    blurb: 'Search a hidden prize landscape paying per reveal — once on your own, once with an AI assistant.',
    session: 'auto', sessionParam: 'code',
    params: function (p, s) {
      var pid = (p && p.studentId) || 'anon';
      return {
        PROLIFIC_PID: pid,
        STUDY_ID: 'simulation-platform',
        SESSION_ID: pid + '-' + Date.now().toString(36)
      };
    },
    adminUrl: '/lab/search-v2/admin/', adminAuth: 'firebase',
    adminNote: 'Email/password per ADMIN_EMAILS in lab/search-v2/firebase-config.js. The launch link mirrors its canonical Prolific link, with the student ID as PROLIFIC_PID.'
  },
  {
    key: 'portfoliofit', title: 'PortfolioFit (research)', icon: '🧩',
    path: '/lab/portfoliofit/',
    blurb: 'Fit project shapes into a limited portfolio under time pressure — training, main game and survey.',
    session: 'prefill', sessionParam: 'session',
    adminUrl: '/lab/portfoliofit/?admin', adminAuth: 'firebase',
    adminNote: 'Opens with ?admin; email/password on the “stouras-portfoliofit” Firebase project. Its in-game registration form auto-fills from the platform registration (prefill drop-in wired).'
  },
  {
    key: 'answerarena', title: 'Answer Arena', icon: '⚖️',
    path: '/lab/answerarena/',
    blurb: 'Compare two answers to everyday work tasks and pick the one you prefer.',
    session: 'prefill', sessionParam: 's', optionalSession: true,
    adminUrl: '/lab/answerarena/?admin', adminAuth: 'firebase',
    adminNote: 'Opens with ?admin (same store pattern as Sustainable Supply Chains). Without a session code students play the default config.'
  },
  {
    key: 'tetris', title: 'Tetris Challenge', icon: '🧱',
    path: '/lab/tetris/',
    blurb: 'Play Tetris for science: registration, gameplay and a post-game survey.',
    session: 'none', manualCopy: true,
    adminUrl: null, adminAuth: null,
    adminNote: 'No admin panel — registrations and surveys land in its Google Sheet (Apps Script). Its form cannot be pre-filled without rebuilding the bundle; students copy their details from the launch dialog.'
  },
  {
    key: 'problem-solving', title: 'Problem Solving', icon: '🧠',
    path: '/lab/problem-solving/',
    blurb: 'Discover the hidden rule behind number triples, then state it and rate your confidence.',
    session: 'none',
    adminUrl: '/lab/problem-solving/?admin', adminAuth: 'open',
    adminNote: 'Open with ?admin — analytics are fetched from its Google Sheet (Apps Script).'
  },
  {
    key: 'knapsack-game', title: 'Knapsack Game', icon: '🎒',
    path: '/lab/knapsack-game/',
    blurb: 'Pack the most valuable knapsack you can under a weight limit.',
    session: 'none', optionalSession: true,
    seeds: function (p, s) {
      var id = (p && p.studentId) || 'anon';
      return [['knapsack_session', 'simp-' + (s ? s + '-' : '') + id]];
    },
    adminUrl: null, adminAuth: null,
    adminNote: 'No admin panel — submissions go to its Vercel proxy. The platform seeds its localStorage session key with the student ID so records are attributable.'
  },
  {
    key: 'knapsack-with-dependencies', title: 'Knapsack with Dependencies', icon: '⛓️',
    path: '/lab/knapsack-with-dependencies/',
    blurb: 'Knapsack packing where some items require others — plan the dependency chains.',
    session: 'none',
    adminUrl: null, adminAuth: null,
    adminNote: 'No admin panel — submissions go to its Vercel backend. It wipes its own sessionStorage identity at startup, so no prefill is possible.'
  },
  {
    key: 'knapsack-calculator', title: 'Knapsack Calculator', icon: '🧮',
    path: '/lab/knapsack-calculator/',
    blurb: 'A companion tool: enter items and capacity, get the optimal knapsack.',
    session: 'none',
    adminUrl: null, adminAuth: null, adminNote: 'A pure client-side tool — nothing to administer.'
  },
  {
    key: 'search', title: 'Space Exploration', icon: '🚀',
    path: '/lab/search/',
    blurb: 'Sequential search over hidden prizes: reveal, pay, and decide when to stop.',
    session: 'none',
    adminUrl: null, adminAuth: null,
    adminNote: 'Static replica, currently in quick-test mode (treatment picker on the start screen). No data is collected.'
  },
  {
    key: 'jagged', title: 'Trust the AI?', icon: '🤖',
    path: '/lab/jagged/',
    blurb: 'Trust or verify an AI that looks equally confident everywhere — but is not.',
    session: 'none',
    adminUrl: null, adminAuth: null, adminNote: 'Self-contained teaching game — no data is collected.'
  },
  {
    key: 'interpolation', title: 'AI Interpolation Demo', icon: '📈',
    path: '/lab/interpolation/',
    blurb: 'See how an AI interpolates between its training points — and extrapolates beyond them.',
    session: 'none',
    adminUrl: null, adminAuth: null, adminNote: 'A pure visualisation — nothing to administer.'
  },
  {
    key: 'portfoliofit-testing', title: 'PortfolioFit (practice)', icon: '🎮',
    path: '/lab/portfoliofit-testing/',
    blurb: 'The plain PortfolioFit game for warm-up practice — no registration, no data collection.',
    session: 'none',
    adminUrl: null, adminAuth: null, adminNote: 'The plain game only — no sessions, no data.'
  },
  {
    key: 'newsvendor', title: 'Newsvendor Game', icon: '📰',
    path: '/lab/newsvendor/',
    external: 'https://newsvendor-kostas.web.app/',
    blurb: 'Order inventory under uncertain demand — the classic newsvendor problem.',
    session: 'none', manualCopy: true,
    adminUrl: null, adminAuth: null,
    adminNote: 'Hosted separately on Firebase Hosting (newsvendor-kostas.web.app); administer it there. Cross-origin, so the platform cannot pre-fill it — students copy their details from the launch dialog.'
  }
];
