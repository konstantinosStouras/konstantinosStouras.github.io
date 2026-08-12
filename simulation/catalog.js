/* Simulation Platform — catalog of hosted simulations (one entry per app).
   This file is the ONE place that knows how each simulation is launched,
   how it receives a Session ID, and where its own admin panel lives.
   DELIBERATELY CURATED (per the owner): only the class simulations are
   listed — the practice/tool/retired apps under /lab/ (portfoliofit-testing,
   interpolation, knapsack-*, tetris) are intentionally NOT here. Entry order
   is the display order everywhere (admin table default order and student
   cards); the admin table additionally floats saved-active sims to the top.

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
                   platform cannot reach; the launch dialog shows the
                   student's saved details with copy buttons
     adminUrl      the app's own admin panel (null = none)
     adminAuth     'firebase' — email/password against the app's OWN Firebase
                   project; 'open' — URL param only; null — no admin panel
     adminNote     shown in the platform admin panel's consoles section
     verify        how the roster's completion ✓ for this simulation is
                   reconciled against the simulation's OWN records — present
                   only for simulations that store an IDENTIFIABLE participant
                   record (one carrying the university student ID, the join key
                   to the platform roster). The admin panel renders one
                   "⟲ Verify from <title>" button per ACTIVE simulation that
                   has this block; simulations without one are deliberately
                   un-verifiable:
                     problem-solving — writes to a Google Sheet, no identity
                     ssc             — team/firm decisions, no student ID
                     newsvendor      — cross-origin, another project entirely
                     jagged          — collects nothing at all
                   Fields:
                     adapter       key in window.SIMP_VERIFY (admin/verify.js)
                                   — the function that reads that project and
                                   returns who completed it, by student ID
                     configGlobal  window global holding the app's PUBLIC
                                   Firebase web config, when the app publishes
                                   one as its own file (Answer Arena)
                     config        inline PUBLIC web config, for apps whose
                                   config is buried in their bundle/source —
                                   KEEP IN SYNC with the file named beside it
                                   (a Firebase web config is not a secret;
                                   access is governed by the Security Rules)
                     idNote        what the join key is on that side, shown in
                                   the button's tooltip
*/
window.SIMP_CATALOG = [
  {
    key: 'ideasearchlab', title: 'Ideation Challenge', icon: '💡',
    path: '/lab/ideasearchlab/join',
    blurb: 'Team ideation experiment: individual brainstorming, a group round and a survey — with optional AI assistance.',
    session: 'inapp',
    verify: {
      adapter: 'ideasearchlab',
      /* PUBLIC web config — keep in sync with _ideasearchlab-src/src/firebase.js */
      config: {
        apiKey: 'AIzaSyAPaJwdXmJhn8WVQDxwFZx5N5kX2loL5zY',
        authDomain: 'ideasearchlab.firebaseapp.com',
        projectId: 'ideasearchlab',
        storageBucket: 'ideasearchlab.firebasestorage.app',
        messagingSenderId: '368057681732',
        appId: '1:368057681732:web:35d8aba8d387abc364f911'
      },
      idNote: 'the student ID carried over from the platform launch (participant.platform.studentId), on participants who reached status “done” (survey submitted) in the sessions this admin account created'
    },
    adminUrl: '/lab/ideasearchlab/admin/', adminAuth: 'firebase',
    adminNote: 'Instructor account on the “ideasearchlab” Firebase project. Students get a silent throwaway login (no account screen); their join code arrives pre-filled and the registration auto-submits from the platform data, consent statements included (carried from the platform launch, stamped consentVia on the participant record).'
  },
  {
    key: 'portfoliofit', title: 'PortfolioFit', icon: '🧩',
    path: '/lab/portfoliofit/',
    blurb: 'Fit project shapes into a limited portfolio under time pressure — training, main game and survey.',
    session: 'prefill', sessionParam: 'session',
    verify: {
      adapter: 'portfoliofit',
      /* PUBLIC web config — keep in sync with lab/portfoliofit/experiment.js */
      config: {
        apiKey: 'AIzaSyDO0KqhebMC2xsijmibhL_52wGfioMb0HQ',
        authDomain: 'stouras-portfoliofit-86127.firebaseapp.com',
        projectId: 'stouras-portfoliofit-86127',
        storageBucket: 'stouras-portfoliofit-86127.firebasestorage.app',
        messagingSenderId: '346443957980',
        appId: '1:346443957980:web:d5987b2a470a401e7d5619'
      },
      idNote: 'the University Student ID from its registration form (participants.studentId), on players whose record reached status “done” (survey submitted)'
    },
    adminUrl: '/lab/portfoliofit/?admin', adminAuth: 'firebase',
    adminNote: 'Opens with ?admin; email/password on the “stouras-portfoliofit” Firebase project. Its in-game registration form auto-fills from the platform registration (prefill drop-in wired).'
  },
  {
    key: 'answerarena', title: 'Answer Arena', icon: '⚖️',
    path: '/lab/answerarena/',
    blurb: 'Compare two answers to everyday work tasks and pick the one you prefer.',
    session: 'prefill', sessionParam: 's', optionalSession: true,
    verify: {
      adapter: 'answerarena',
      /* the arena publishes its own config file, loaded by the admin page */
      configGlobal: 'ARENA_FIREBASE',
      idNote: 'the University Student ID typed into its intake form (participants.participantId), on participants with a completed session'
    },
    adminUrl: '/lab/answerarena/?admin', adminAuth: 'firebase',
    adminNote: 'Opens with ?admin (same store pattern as Sustainable Supply Chains). Without a session code students play the default config. Its intake form auto-fills from the platform registration.'
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
    key: 'ssc', title: 'Sustainable Supply Chains', icon: '🚲',
    path: '/sustainable-supply-chains/',
    blurb: 'Competing e-bike firms source components worldwide: bullwhip, logistics, tariffs, competition and ESG.',
    session: 'auto', sessionParam: 'code',
    adminUrl: '/sustainable-supply-chains/admin/', adminAuth: 'firebase',
    adminNote: 'Email/password per SSC_ADMIN_EMAILS in sustainable-supply-chains/firebase-config.js (localStorage demo mode needs no password). Create sessions in its Sessions tab.'
  },
  {
    key: 'newsvendor', title: 'Newsvendor Game', icon: '📰',
    path: '/lab/newsvendor/',
    external: 'https://newsvendor-kostas.web.app/',
    blurb: 'Order inventory under uncertain demand — the classic newsvendor problem.',
    session: 'none', manualCopy: true,
    adminUrl: null, adminAuth: null,
    adminNote: 'Hosted separately on Firebase Hosting (newsvendor-kostas.web.app); administer it there. Cross-origin, so the platform cannot pre-fill it — students copy their details from the launch dialog.'
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
    verify: {
      adapter: 'search-v2',
      /* PUBLIC web config — keep in sync with lab/search-v2/firebase-config.js */
      config: {
        apiKey: 'AIzaSyB5uF8XwqI8fyTuIBwQ_OPkg-VqU98H0uc',
        authDomain: 'search-with-ai-456d7.firebaseapp.com',
        projectId: 'search-with-ai-456d7',
        storageBucket: 'search-with-ai-456d7.firebasestorage.app',
        messagingSenderId: '9761548035',
        appId: '1:9761548035:web:13d1cda30bbe35aeec2b36'
      },
      idNote: 'the student ID the platform sends as PROLIFIC_PID (events.pid), on every logged “session_end” event'
    },
    adminUrl: '/lab/search-v2/admin/', adminAuth: 'firebase',
    adminNote: 'Email/password per ADMIN_EMAILS in lab/search-v2/firebase-config.js. The launch link mirrors its canonical Prolific link, with the student ID as PROLIFIC_PID.'
  },
  {
    key: 'jagged', title: 'Trust the AI?', icon: '🤖',
    path: '/lab/jagged/',
    blurb: 'Trust or verify an AI that looks equally confident everywhere — but is not.',
    session: 'none',
    adminUrl: null, adminAuth: null, adminNote: 'Self-contained teaching game — no data is collected.'
  }
];
