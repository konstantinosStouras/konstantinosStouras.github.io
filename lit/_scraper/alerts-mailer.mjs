#!/usr/bin/env node
/*
 * The Lit — e-mail alerts mailer
 * ==============================
 *
 * Sends the e-mails behind the "E-mail alerts" panel on stouras.com/lit/.
 * A static GitHub Pages site can't send mail, so this runs as a scheduled job
 * (see .github/workflows/lit-alerts-mail.yml). It:
 *
 *   1. Loads the papers ADDED to the database recently, from the same files the
 *      site's "Recently added papers" view uses: lit/data/recent.json,
 *      lit/data-ft50/recent.json AND lit/data-workingpapers/recent.json (each
 *      row carries a "Date Added"). Working papers are matched with the page's
 *      own semantics — see matchesCriteria — so an "any new paper" subscriber
 *      hears about new SSRN/NBER/arXiv/OSF working papers too (they never did
 *      before 2026-08: the archive's recent.json simply wasn't read here).
 *   2. Reads every user's saved alerts with the Firebase Admin SDK
 *      (collectionGroup('alerts')), which bypasses the Firestore rules.
 *   3. Matches the new papers against each alert's `criteria`, reusing the exact
 *      filter semantics from lit/index.html (journal-type expansion,
 *      textMatch / authorMatch, pre-print flag, AND/OR per field).
 *   4. For each alert that is DUE (per its frequency) and has new matches, sends
 *      one digest e-mail via SMTP (Nodemailer). The message is addressed to the
 *      alert's `recipient` and its Reply-To is set to the subscriber's own
 *      e-mail (`from`), so replies reach them. The visible From is the sending
 *      account (ALERTS_FROM / SMTP_USER); when that account is your own address
 *      the alert is, literally, sent from your e-mail.
 *   5. Records a per-alert high-water mark (`lastCheckedAt` / `lastSentAt`) so a
 *      paper is never e-mailed twice.
 *
 * Frequencies: immediate (every run), daily (every run), weekly (>= ~7 days
 * since the last check), monthly (>= ~28 days). With the default once-a-day
 * cron, "immediate" and "daily" behave the same; run the cron more often to
 * make "immediate" closer to real time.
 *
 * MATCHING FIDELITY: the journal-list sets, the textMatch/authorMatch helpers
 * and the editorial-dimension normalizers (cleanEditorField/normalizeArea +
 * their alias tables — editor/area criteria hold the page's NORMALIZED values,
 * while MS's raw 'Accepting Editor' field is the whole acceptance sentence)
 * below are vendored copies of the ones in lit/index.html — keep
 * them in sync if the page's filtering changes. Coverage is the ten native
 * sources + the FT50 catalog (the two recent.json files in this repo) PLUS the
 * ABS satellite shards, whose recent.json + manifests are fetched over HTTP at
 * run time (loadShards) — missing shards 404 and are skipped.
 *
 * Env / secrets (all via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465),
 *   SMTP_SECURE (default true when port 465), SMTP_USER, SMTP_PASS,
 *   ALERTS_FROM (default SMTP_USER), ALERTS_FROM_NAME (default "The Lit").
 *
 * Modes:
 *   node alerts-mailer.mjs               real run (reads Firestore, sends mail)
 *   node alerts-mailer.mjs --dry-run     reads Firestore, prints instead of sending
 *   node alerts-mailer.mjs --test-emails flushes the one-off "Send me a test
 *                                        e-mail" queue (users/{uid}/testEmails)
 *                                        the page writes; add --dry-run to print
 *   node alerts-mailer.mjs --rewind      one-off recovery: clears the high-water
 *                                        marks on RECENTLY-created alerts so the
 *                                        next run re-checks them from their
 *                                        creation day; add --dry-run to preview
 *   node alerts-mailer.mjs --selftest    runs the matching/rendering self-tests
 *                                        (no network, no deps needed) and exits
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Who may see a What's-new entry — the SAME file lit/about/ and the main page's
// alert preview read it through, so the site and the inbox cannot disagree
// about what has actually been published. See lit/lit-news.js.
const LitNews = createRequire(import.meta.url)(path.join(__dirname, '..', 'lit-news.js'));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const FT50_DIR  = path.join(__dirname, '..', 'data-ft50');
// The Working Papers archive (SSRN/NBER/arXiv/OSF pre-prints of the listed
// authors) — its recent.json joins the paper stream, and its manifest keys
// back the 'wp' journal type exactly like the page's WP_KEYS.
const WP_DIR    = path.join(__dirname, '..', 'data-workingpapers');
// The feature "changelog" catalogue that drives "New features & updates to the
// website" alerts. Hand-maintained (NOT build output), served at
// stouras.com/lit/changelog.json, and read here from the checkout. Adding an
// entry dated ~today makes the next daily run e-mail it to feature subscribers.
const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.json');
// Each dataset's UNCAPPED per-journal × per-day "recently added" tally, written
// beside its capped recent.json by every pipeline — the count the page's
// recently-added view prints, and (since 2026-08) the count these e-mails
// report too (see exactAlertCounts).
const RECENT_COUNTS_FILE = 'recent-counts.json';
const SITE_URL  = 'https://www.stouras.com/lit/';
// The ABS satellite shards live in sibling repos, each served from its own Pages
// site at stouras.com/<repo>/data/. They are fetched over HTTP at run time (they
// are NOT in this checkout); missing shards 404 and are skipped, exactly like the
// page's own runtime merge.
const SHARD_BASE  = 'https://www.stouras.com/';
const SHARD_REPOS = ['lit-data-abs4', 'lit-data-abs3-omecon', 'lit-data-abs3-rest'];
// Maintainer contact surfaced in every alert e-mail (help / feedback, and the
// List-Unsubscribe mailto). Keep in sync with the Feedback modal in index.html.
const CONTACT_EMAIL = 'kostas.stouras@ucd.ie';

// ── Vendored journal-list constants (keep in sync with lit/index.html) ────
const UTD24_KEYS = new Set(['tar','jae','jar','jof','jfe','rfs','isre','ijoc',
  'misq','jcr','jm','jmr','mksc','ms','opre','joom','msom','pom','amj','amr',
  'asq','orsc','jibs','smj']);
const FT50_KEYS_STATIC = new Set(['aman','amj','amr','tar','aos','asq','aer','asr',
  'car','ecta','etp','hbr','hrm','isre','jae','jar','jap','jbv','jcp','jcr',
  'jof','jfqa','jfe','jibs','jom','jmis','jms','jm','jmr','joom','jpe','jams',
  'ms','msom','mksc','misq','smr','opre','orsc','obhdp','pom','psci','qje',
  'respol','rast','restud','rof','rfs','sej','smj']);
const ABS_RATING = {
  aman:'4*', amj:'4*', amr:'4*', tar:'4*', aos:'4*', asq:'4*', aer:'4*', asr:'4*',
  ecta:'4*', etp:'4*', jae:'4*', jar:'4*', jap:'4*', jbv:'4*', jcp:'4*', jcr:'4*',
  jof:'4*', jfe:'4*', jibs:'4*', jom:'4*', jm:'4*', jmr:'4*', joom:'4*', jpe:'4*',
  ms:'4*', mksc:'4*', misq:'4*', isre:'4*', opre:'4*', orsc:'4*', qje:'4*',
  respol:'4*', restud:'4*', rfs:'4*', smj:'4*',
  car:'4', hrm:'4', jfqa:'4', jmis:'4', jms:'4', jams:'4', msom:'4', obhdp:'4',
  pom:'4', psci:'4', rast:'4', rof:'4', sej:'4', ejor:'4',
  hbr:'3', smr:'3', ijoc:'3',
  stsc:'3', // Strategy Science (INFORMS) — strategy/innovation, graded ABS 3
};
const PNAS_SECTION_KEYS = {
  'Computer Sciences': 'pnas-cs',
  'Sustainability Science': 'pnas-sust',
  'Environmental Sciences': 'pnas-env',
  'Social Sciences': 'pnas-soc',
  'Economic Sciences': 'pnas-econ',
};

// FT50 keys = the static list + any journal in the data-ft50 manifest that is
// not flagged notFT (mirrors the page's runtime extension so a revised FT list
// flows through). Called once at startup.
function loadFt50Keys() {
  const set = new Set(FT50_KEYS_STATIC);
  try {
    const man = JSON.parse(fs.readFileSync(path.join(FT50_DIR, 'sources.json'), 'utf8'));
    for (const s of (Array.isArray(man) ? man : [])) {
      if (s && s.key && !s.notFT) set.add(s.key);
    }
  } catch { /* no manifest → static list only */ }
  return set;
}
function absSets() {
  const abs4 = new Set(), abs3 = new Set();
  for (const [k, g] of Object.entries(ABS_RATING)) {
    if (g === '4' || g === '4*') abs4.add(k);
    else if (g === '3') abs3.add(k);
  }
  return { abs4, abs3 };
}

// journal key -> human name, from the native + FT50 sources.json manifests (the
// same source the page's JOURNAL_LABEL comes from). Lets the delivered e-mail's
// "Criteria:" line read "Operations Research" like the on-page preview does,
// instead of the raw key "opre". Built once at startup from local manifests.
function loadJournalNames() {
  const names = {};
  for (const dir of [DATA_DIR, FT50_DIR, WP_DIR]) {
    try {
      const man = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
      for (const s of (Array.isArray(man) ? man : [])) {
        if (s && s.key) names[s.key] = s.name || s.short || s.key;
        (s.sections || []).forEach(sec => { if (sec && sec.key) names[sec.key] = sec.name || sec.key; });
      }
    } catch { /* manifest missing → keys fall back to themselves */ }
  }
  return names;
}
const JOURNAL_NAMES = loadJournalNames();

// ── Matching helpers (vendored from lit/index.html) ───────────────────────
function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function textMatch(haystack, query) {
  if (!query) return true;
  const m = query.match(/^"(.*)"$/);
  if (!m) return haystack.indexOf(query) !== -1;      // unquoted → substring
  const phrase = m[1].trim();
  if (!phrase) return true;
  return new RegExp('\\b' + escRegex(phrase) + '\\b').test(haystack);
}
// Diacritic/apostrophe folding, VENDORED from index.html's nameFold (keep in
// sync): the page folds BOTH sides of an author match, so an alert term
// "regis" finds the credited "Régis Chenavaz" — without this the mailer
// missed any author whose stored name carries an accent.
function nameFold(s) {
  s = String(s || '');
  if (!/[^\x20-\x7e]/.test(s)) return s.indexOf('  ') === -1 ? s : s.replace(/\s+/g, ' ');
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return s.replace(/\u2019/g, "'").replace(/\s+/g, ' ');
}

function authorMatch(haystack, query) {
  if (!query) return true;
  if (query.charAt(0) === '"') return textMatch(haystack, query);
  haystack = nameFold(haystack); query = nameFold(query);
  let idx = 0;
  while ((idx = haystack.indexOf(query, idx)) !== -1) {   // prefix-of-a-name-part
    const prev = idx === 0 ? '' : haystack.charAt(idx - 1);
    if (!prev || !/[a-zà-ɏ]/i.test(prev)) return true;
    idx += 1;
  }
  return false;
}
function safeUrl(u) {
  u = String(u || '');
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}
function splitList(s) {
  return String(s || '').split(';').map(x => x.trim()).filter(Boolean);
}

// ── Editorial-dimension normalization (VENDORED from lit/index.html — keep in
// sync, like textMatch/authorMatch above) ─────────────────────────────────────
// The page's editor/area filter values — what captureCurrentFilters and the
// alerts modal's editorial pickers save into an alert's criteria — are
// NORMALIZED: sel.editor holds p._editors (cleanEditorField over the raw
// field) and sel.area holds p._area (normalizeArea). Management Science
// deposits the WHOLE acceptance sentence ("This paper was accepted by Eric So,
// accounting.") as its 'Accepting Editor' field — measured 2026-08-31: every
// one of the 4,894 served MS rows — so comparing a saved editor name against
// the raw field could never match and an editor/area alert never delivered.
// The page's corpus-wide fuzzyMergeEditors/fuzzyMergeAreas passes are
// deliberately NOT reproduced (they need the whole loaded corpus and only
// touch rare ≤3-paper variants); the alias tables below carry the recurring
// spellings, so the two sides agree on every canonical value a picker offers.
const EDITOR_ALIASES = {
  // Accent variants
  'renée adams': 'Renee Adams', 'renee adams': 'Renee Adams', 'adams': 'Renee Adams',
  'gérard p. cachon': 'Gerard P. Cachon', 'gerard p. cachon': 'Gerard P. Cachon', 'gérard cachon': 'Gerard P. Cachon', 'gerard cachon': 'Gerard P. Cachon',
  'jesper sørensen': 'Jesper Sorensen', 'jesper sorensen': 'Jesper Sorensen', 'jesper sørensen. organizations': 'Jesper Sorensen',
  'jérôme detemple': 'Jerome Detemple', 'jerome b. detemple': 'Jerome Detemple', 'jerome detemple': 'Jerome Detemple',
  'dorothea kübler': 'Dorothea Kubler', 'dorothea kubler': 'Dorothea Kubler',
  'aurélien baillon': 'Aurelien Baillon',
  'bariş ata': 'Baris Ata', 'baris ata': 'Baris Ata',
  // Victor Martinez variants
  'victor martínez-de-albéniz': 'Victor Martinez-de-Albeniz', 'victor martinez-de-albeniz': 'Victor Martinez-de-Albeniz',
  'victor martínez de albéniz': 'Victor Martinez-de-Albeniz', 'victor martinez de albeniz': 'Victor Martinez-de-Albeniz',
  'victor martinez de albéniz': 'Victor Martinez-de-Albeniz', 'víctor martínez-de-albéniz': 'Victor Martinez-de-Albeniz',
  'martínez-de-albéniz victor': 'Victor Martinez-de-Albeniz',
  'yuval victor martinez de albeniz': 'Victor Martinez-de-Albeniz',
  // Typos
  'brain bushee': 'Brian Bushee', 'duncan semester': 'Duncan Simester',
  'karl deither': 'Karl Diether', 'manell baucells': 'Manel Baucells',
  'suraj srinivassan': 'Suraj Srinivasan', 'toby suart': 'Toby Stuart',
  'tylor shumway': 'Tyler Shumway', 'vishaul gaur': 'Vishal Gaur',
  'yossiv aviv': 'Yossi Aviv', 'victoria ivanisha': 'Victoria Ivashina',
  'mathew shum': 'Matthew Shum', 'lucas schmid': 'Lukas Schmid',
  'loana popescu': 'Ioana Popescu', 'ioana popescu': 'Ioana Popescu',
  'sameer srivastava': 'Sameer Srivastava',
  // Middle names / initials → canonical
  'brad m. barber': 'Brad Barber', 'barrie r. nault': 'Barrie Nault',
  'carri w. chan': 'Carri Chan', 'charles j. corbett': 'Charles Corbett',
  'lorin m. hitt': 'Lorin Hitt', 'mary e. barth': 'Mary Barth',
  'pradeep k. chintagunta': 'Pradeep Chintagunta',
  'jagmohan s. raju': 'Jagmohan Raju', 'paul h. zipkin': 'Paul Zipkin',
  'candace a. yano': 'Candace Yano',
  // Name consolidation
  'david simchi-levi': 'David Simchi-Levi', 'david simchi levi': 'David Simchi-Levi', 'david simchi‐levi': 'David Simchi-Levi', 'david simchi‑levi': 'David Simchi-Levi', 'david simchi‒levi': 'David Simchi-Levi', 'david simchi–levi': 'David Simchi-Levi',
  'chung piaw teo': 'Chung-Piaw Teo', 'chung-piaw teo': 'Chung-Piaw Teo',
  'teck ho': 'Teck-Hua Ho', 'teck-hua ho': 'Teck-Hua Ho',
  'yinyu-ye': 'Yinyu Ye', 'yinyu ye': 'Yinyu Ye',
  'd. j. wu': 'D.J. Wu', 'd.j. wu': 'D.J. Wu', 'dj wu': 'D.J. Wu', 'dongjun wu': 'D.J. Wu',
  'will cong': 'Will Cong', 'william cong': 'Will Cong', 'william lin cong': 'Will Cong', 'lin william cong': 'Will Cong',
  'shivaram rajgopal': 'Shivaram Rajgopal', 'shiva rajgopal': 'Shivaram Rajgopal', 'rajgopal shiva': 'Shivaram Rajgopal',
  'jay swaminathan': 'Jayashankar Swaminathan', 'jayashankar swaminathan': 'Jayashankar Swaminathan', 'swaminathan': 'Jayashankar Swaminathan',
  'matt shum': 'Matthew Shum', 'matthew shum': 'Matthew Shum',
  'george shanthikumar': 'J. George Shanthikumar', 'george j. shanthikumar': 'J. George Shanthikumar', 'j. george shanthikumar': 'J. George Shanthikumar',
  'jean-pierre dube': 'Jean-Pierre Dube',
  'sendil ethiraj': 'Sendil Ethiraj',
  'sampath rajagopalan': 'Sampath Rajagopalan',
  'maria claire villeval': 'Marie Claire Villeval', 'marie-claire villeval': 'Marie Claire Villeval', 'marie claire villeval': 'Marie Claire Villeval',
  'chen yan': 'Yan Chen', 'prof. yan chen': 'Yan Chen', 'yan chen': 'Yan Chen',
  'prof. ranjani krishnan': 'Ranjani Krishnan', 'ranjani krishnan': 'Ranjani Krishnan',
  'professor bruno biais': 'Bruno Biais',
  'erica plambeck': 'Erica Plambeck', 'caroline flammer': 'Caroline Flammer',
  'giesecke kay': 'Kay Giesecke', 'kay giesecke': 'Kay Giesecke',
  'yu (jeffrey) hu': 'Jeffrey Hu',
  'dmitry kuksov': 'Dmitri Kuksov', 'dmitri kuksov': 'Dmitri Kuksov',
  'shiva rajagopal': 'Shivaram Rajgopal',
  'nicolas stier': 'Nicolas Stier-Moses', 'nicolas stier-moses': 'Nicolas Stier-Moses',
  'manuel baucells': 'Manel Baucells',
  'kay gieseke': 'Kay Giesecke',
  'suraj srinivisan': 'Suraj Srinivasan',
  'scholtes stefan': 'Stefan Scholtes', 'stefan sholtes': 'Stefan Scholtes',
  'lukas schmidt': 'Lukas Schmid',
  'alfonso gambardello': 'Alfonso Gambardella',
  'carrie chan': 'Carri Chan',
  'ranjani ananthakrishnan': 'Ranjani Krishnan',
  'anita carson': 'Anita McGahan',
  'raphael thomadsen': 'Raphael Thomadsen',
  'ray reagans': 'Ray Reagans',
  'uday rajan': 'Uday Rajan',
  'melvyn sim': 'Melvyn Sim', 'michael fu': 'Michael Fu', 'peng sun': 'Peng Sun',
  'glen dowell': 'Glen Dowell', 'greg shaffer': 'Greg Shaffer',
  'jan bouwens': 'Jan Bouwens', 'haitao li': 'Haitao Li',
  'eric bradlow': 'Eric Bradlow',
  'anita mcgahan': 'Anita McGahan',
};
const EDITOR_JUNK = ['stakeholders. here', 'stakeholders'];
const AREA_ALIASES = {
  // Capitalization
  'finance': 'finance', 'Finance': 'finance',
  'Behavioral Economics and Decision Analysis': 'behavioral economics and decision analysis',
  'Optimization <div data-widget-def': 'optimization', 'optimization': 'optimization',
  // HTML junk
  'accounting <div data-widget-def="ux': 'accounting',
  'marketing <div data-widget-def="': 'marketing',
  'healthcare management.conflict of interest statement: e': 'healthcare management',
  // Typos
  'behavioral economics and decisions analysis': 'behavioral economics and decision analysis',
  'behavioral economics & decision analysis': 'behavioral economics and decision analysis',
  'behavioral economics &amp; decision analysis': 'behavioral economics and decision analysis',
  'behavioral economics and data analysis': 'behavioral economics and decision analysis',
  'behavioral analysis': 'behavioral economics and decision analysis',
  'behavioral economics and decision analysis–fast track': 'behavioral economics and decision analysis',
  'entepreneurship and innovation': 'entrepreneurship and innovation',
  'entrepreneurship': 'entrepreneurship and innovation',
  // Consolidation
  'information science': 'information systems', 'information system': 'information systems',
  'information systems division': 'information systems',
  'stochastic models': 'stochastic models and simulation',
  'stochastic models & simulation': 'stochastic models and simulation',
  'stochastic models &amp; simulation': 'stochastic models and simulation',
  'stochastic models and systems': 'stochastic models and simulation',
  'big data and analytics': 'big data analytics',
  'operations and supply chain management': 'operations management',
  'strategy': 'business strategy',
  'revenue management and market analytics department': 'revenue management and market analytics',
  'revenue management and analytics': 'revenue management and market analytics',
  'r&amp;d and product development': 'R&D and product development',
  'r&d and product development': 'R&D and product development',
  'organizations and social networks': 'organizations',
  'organization': 'organizations',
  'optimization and decision analytics': 'optimization',
  'finance department': 'finance',
  'health': 'healthcare management',
  'sustainability': 'business strategy',
};
const AREA_JUNK = [
  'we report seven sets of studies',
  'focused issue editor', 'guest department editor', 'guest editor',
  'special issue editors',
];
function normalizeEditorName(name) {
  var t = name.trim();
  if (!t) return '';
  // Strip "Prof." / "Professor" prefix
  t = t.replace(/^(prof\.?|professor)\s+/i, '');
  // Normalize Unicode hyphens to regular hyphen
  t = t.replace(/[‐‑‒–—―﹘﹣－]/g, '-');
  // Normalize accents for lookup
  var key = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (EDITOR_ALIASES[key]) return EDITOR_ALIASES[key];
  var keyLower = t.toLowerCase();
  if (EDITOR_ALIASES[keyLower]) return EDITOR_ALIASES[keyLower];
  // Check junk
  for (var j = 0; j < EDITOR_JUNK.length; j++) { if (key.indexOf(EDITOR_JUNK[j]) !== -1) return ''; }
  return t;
}
function cleanEditorField(raw) {
  if (!raw) return [];
  var s = raw;
  // Fix junk containing "accepted by"
  var ai = s.indexOf('This paper was accepted by');
  if (ai === -1) ai = s.indexOf('accepted by');
  if (ai !== -1) {
    var after = s.substring(ai);
    // Capture the full acceptance sentence (allowing multi-initial names like
    // "D. J. Wu"), then keep the editor name part before the area comma.
    var m = after.match(/accepted by\s+([^.]+(?:\.[^.]{0,5})*[^.]*)\./i);
    var rest = m ? m[1] : after.replace(/^.*?accepted by\s+/i, '');
    s = rest.split(',')[0].trim();
  }
  s = s.replace(/\.\s*$/, '').trim();
  if (!s) return [];
  // Split "Editor1 and Editor2"
  return s.split(/\s+and\s+/i).map(e => normalizeEditorName(e.trim())).filter(Boolean);
}
function normalizeArea(raw) {
  if (!raw) return '';
  var s = raw.trim();
  // Truncate at HTML tags
  var htmlIdx = s.indexOf('<');
  if (htmlIdx > 0) s = s.substring(0, htmlIdx).trim();
  // Truncate at junk suffixes (case-insensitive)
  s = s.replace(/\.?\s*funding:.*/i, '').trim();
  s = s.replace(/\.?\s*supplemental material:.*/i, '').trim();
  s = s.replace(/\.?\s*conflict.*/i, '').trim();
  s = s.replace(/\.?\s*https?:\/\/.*/i, '').trim();
  s = s.replace(/\.here.*/i, '').trim();
  // Remove trailing period
  s = s.replace(/\.\s*$/, '').trim();
  // Fix spacing around colons: " :" → ":"
  s = s.replace(/\s+:/g, ':');
  var key = s.toLowerCase();
  // Check aliases
  if (AREA_ALIASES[key]) return AREA_ALIASES[key];
  if (AREA_ALIASES[s]) return AREA_ALIASES[s];
  // Check junk
  for (var j = 0; j < AREA_JUNK.length; j++) { if (key.indexOf(AREA_JUNK[j]) !== -1) return ''; }
  // Extract area from junk like "Renee, finance" or "Jayashankar, operations management"
  var commaMatch = key.match(/^[a-z]+,\s*(.+)$/);
  if (commaMatch) {
    var extracted = commaMatch[1].trim();
    return AREA_ALIASES[extracted] || extracted;
  }
  return s.toLowerCase();
}

// Journal keys a paper matches (its own key + PNAS section keys).
function paperJKeys(p) {
  const keys = [p.JKey || ''];
  if (p.JKey === 'pnas' && Array.isArray(p.Sections)) {
    for (const s of p.Sections) { const k = PNAS_SECTION_KEYS[s]; if (k) keys.push(k); }
  }
  return keys.filter(Boolean);
}

// The Working Papers archive's repository keys (wp-ssrn/wp-nber/wp-arxiv/
// wp-osf), from its own manifest — mirrors the page's WP_KEYS, which back its
// 'wp' journal type. Absent archive → empty set (the jtype just matches nothing).
function loadWpKeys() {
  const set = new Set();
  try {
    const man = JSON.parse(fs.readFileSync(path.join(WP_DIR, 'sources.json'), 'utf8'));
    for (const s of (Array.isArray(man) ? man : [])) if (s && s.key && s.workingPaper) set.add(s.key);
  } catch { /* archive missing → empty */ }
  return set;
}

function makeCtx() {
  const ft50 = loadFt50Keys();
  const abs = absSets();
  const wpKeys = loadWpKeys();
  const jtypeKeys = (t) => {
    if (t === 'utd24') return UTD24_KEYS;
    if (t === 'ft50')  return ft50;
    if (t === 'abs4')  return abs.abs4;
    if (t === 'abs3')  return abs.abs3;
    if (t === 'wp')    return wpKeys;
    return new Set();
  };
  const scopeFor = (c) => {
    const hasJ = (c.journal || []).length, hasT = (c.jtype || []).length;
    if (!hasJ && !hasT) return null;                    // no journal restriction
    const s = new Set(c.journal || []);
    for (const t of (c.jtype || [])) for (const k of jtypeKeys(t)) s.add(k);
    return s;
  };
  // abs4/abs3/ft50 are exposed (not just closed over) so loadShards() can extend
  // them at runtime with the ABS grades the satellite shards publish.
  return { jtypeKeys, scopeFor, abs4: abs.abs4, abs3: abs.abs3, ft50, wpKeys };
}

// Is this row an unpublished working paper from the archive? Keyed on the
// repository key (like the page's isWorkingPaperRow), with the wp- prefix as a
// fallback so a row still classifies if the manifest could not be read.
function isWorkingPaper(p, ctx) {
  const k = String((p && p.JKey) || '');
  return (ctx && ctx.wpKeys && ctx.wpKeys.has(k)) || k.startsWith('wp-');
}
const TEXT_CRIT_KEYS = ['author', 'title', 'abstract', 'affiliation'];
function hasTextFilter(c) { return TEXT_CRIT_KEYS.some(k => ((c || {})[k] || []).length); }

// True if a paper satisfies an alert's criteria. Mirrors applyFilters():
// journal scope + pre-print + year/editor/area/se/ae (OR within field) +
// title/abstract/affiliation (textMatch, AND) + author (authorMatch, AND).
// Does this alert's criteria express any intent to match PAPERS? A features-only
// subscription (features:true, no allPapers, no filters) must not send paper
// e-mails; "any new paper" (allPapers) and any concrete filter do.
const PAPER_CRIT_KEYS = ['jtype', 'journal', 'author', 'title', 'abstract', 'affiliation', 'year', 'editor', 'area', 'se', 'ae'];
function hasPaperIntent(c) {
  if (!c) return false;
  if (c.allPapers) return true;
  if (c.preprintOnly) return true;
  return PAPER_CRIT_KEYS.some(k => (c[k] || []).length);
}

function matchesCriteria(p, c, ctx) {
  if (c && c.allPapers) return true;   // "any new paper" — no filters at all
  const scope = ctx.scopeFor(c);
  if (scope && !paperJKeys(p).some(k => scope.has(k))) return false;
  // Working papers mirror the page's reachability rules: "any new paper"
  // (above), an explicit Working Papers scope (jtype 'wp' or a wp-* repository
  // key — the scope test just passed it), or a TEXT search with no journal
  // scope (textSearchActive on the page). A bare year or pre-print filter
  // alone never matches one — on the page either would flood the view with
  // unpublished rows, so matchesJournal excludes WP_KEYS there too.
  if (!scope && isWorkingPaper(p, ctx) && !hasTextFilter(c)) return false;
  if (c.preprintOnly && !safeUrl(p.Preprint)) return false;

  if ((c.year || []).length && !c.year.includes(String(p.Year || ''))) return false;

  const ciEq = (arr, val) => { const v = String(val || '').trim().toLowerCase(); return arr.some(x => String(x).trim().toLowerCase() === v); };
  const ciAny = (arr, list) => list.some(v => ciEq(arr, v));
  // Editor/area criteria hold NORMALIZED page values (sel.editor = p._editors,
  // sel.area = p._area), while MS's raw 'Accepting Editor' field is the whole
  // acceptance sentence — clean the row's fields with the vendored normalizers
  // before comparing (the raw field is kept as a fallback so a dataset that
  // deposits a clean name still matches). See the vendored block above.
  if ((c.editor || []).length &&
      !ciAny(c.editor, cleanEditorField(p['Accepting Editor'] || '')) &&
      !ciEq(c.editor, p['Accepting Editor'])) return false;
  if ((c.area   || []).length &&
      !ciEq(c.area, normalizeArea(p['Area'] || '')) &&
      !ciEq(c.area, p['Area'])) return false;
  if ((c.se     || []).length && !ciAny(c.se, splitList(p['Senior Editor']))) return false;
  if ((c.ae     || []).length && !ciAny(c.ae, splitList(p['Associate Editor']))) return false;

  const title = (p.Title || '').toLowerCase();
  for (const t of (c.title || [])) if (!textMatch(title, t)) return false;
  const auth = (p.Authors || '').toLowerCase();
  for (const a of (c.author || [])) if (!authorMatch(auth, a)) return false;
  const aff = (p.Affiliations || '').toLowerCase();
  for (const af of (c.affiliation || [])) if (!textMatch(aff, af)) return false;
  const abs = (p.Abstract || '').toLowerCase();
  for (const ab of (c.abstract || [])) if (!textMatch(abs, ab)) return false;
  return true;
}

// Human summary of an alert's criteria, for the e-mail body / subject.
function describeCriteria(c) {
  if (c && c.allPapers) return 'any new paper';
  const JTL = { utd24: 'UTD24', ft50: 'FT50', abs4: 'ABS 4/4*', abs3: 'ABS 3', wp: 'Working Papers' };
  const parts = [];
  (c.jtype || []).forEach(t => parts.push(JTL[t] || t));
  (c.journal || []).forEach(k => parts.push(JOURNAL_NAMES[k] || k));   // human name, matching the on-page preview
  if ((c.author || []).length)      parts.push('authors: ' + c.author.join(', '));
  if ((c.title || []).length)       parts.push('title: ' + c.title.join(', '));
  if ((c.abstract || []).length)    parts.push('abstract: ' + c.abstract.join(', '));
  if ((c.affiliation || []).length) parts.push('affiliation: ' + c.affiliation.join(', '));
  if ((c.year || []).length)        parts.push('year: ' + c.year.join(', '));
  if ((c.editor || []).length)      parts.push('editor: ' + c.editor.join(', '));
  if ((c.area || []).length)        parts.push('area: ' + c.area.join(', '));
  if ((c.se || []).length)          parts.push('SE: ' + c.se.join(', '));
  if ((c.ae || []).length)          parts.push('AE: ' + c.ae.join(', '));
  if (c.preprintOnly)               parts.push('pre-prints only');
  return parts.length ? parts.join(' · ') : 'all new papers';
}

// ── Paper loading ─────────────────────────────────────────────────────────────
function parseAdded(s) {
  if (!s) return null;
  const d = new Date(String(s) + (String(s).length <= 10 ? 'T00:00:00Z' : ''));
  return isNaN(d) ? null : d;
}
function loadRecentPapers(extraRows) {
  const rows = [];
  // The same recent files the page's "Recently added" view merges: native +
  // FT50 + the Working Papers archive (whose absence pre-2026-08 was why an
  // "any new paper" subscriber never heard about a new working paper). Each row
  // is stamped with its dataset (`_ds`) so the exact-count pass can reconcile
  // it against that dataset's own uncapped tally (see exactAlertCounts).
  const files = [
    [path.join(DATA_DIR, 'recent.json'), 'native'],
    [path.join(FT50_DIR, 'recent.json'), 'ft50'],
    [path.join(WP_DIR, 'recent.json'), 'wp'],
  ];
  for (const [f, ds] of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(arr)) for (const p of arr) { p._added = parseAdded(p['Date Added']); p._ds = ds; if (p._added) rows.push(p); }
    } catch { /* missing file → skip */ }
  }
  if (Array.isArray(extraRows)) for (const p of extraRows) if (p && p._added) rows.push(p);
  // De-dup by DOI (a paper should not appear in more than one file, but be safe).
  const seen = new Set(), out = [];
  for (const p of rows) {
    const k = (p.DOI || (p.Title + '|' + p.Year)).toLowerCase();
    if (seen.has(k)) continue; seen.add(k); out.push(p);
  }
  out.sort((a, b) => b._added - a._added);
  return out;
}

// ── Exact "recently added" tallies (recent-counts.json) ──────────────────────
// Every recent.json is CAPPED (RECENT_CAP, 1000–1500 rows of a 90-day window),
// so counting matched rows silently under-reports whenever more than the cap
// lands inside an alert's window — the working-papers backfill stamps
// ~10–12k/day, so an "any new paper" daily digest read "1000 working papers"
// (exactly the cap) for ever (user report 2026-08-17). The page's recently-
// added view already prints the number from each dataset's UNCAPPED
// recent-counts.json tally ({days: {"<jkey|…>": {"YYYY-MM-DD": n}}}); this is
// the mailer-side mirror of that fix, same discipline: the tally supplies the
// COUNT line only (the listed rows stay the capped newest slice), per dataset,
// and only when it is ≥ what the rows show — a missing or stale tally can
// never make the number smaller than the papers actually listed.
function loadRecentTallies(shardTallies) {
  const tallies = [];
  const local = [
    [path.join(DATA_DIR, RECENT_COUNTS_FILE), 'native'],
    [path.join(FT50_DIR, RECENT_COUNTS_FILE), 'ft50'],
    [path.join(WP_DIR, RECENT_COUNTS_FILE), 'wp'],
  ];
  for (const [f, ds] of local) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && j.days && typeof j.days === 'object') tallies.push({ ds, days: j.days });
    } catch { /* dataset hasn't shipped a tally yet → its rows are counted as before */ }
  }
  if (Array.isArray(shardTallies)) for (const t of shardTallies) if (t && t.days) tallies.push(t);
  return tallies;
}

// The native journal keys (incl. PNAS section keys), for the dataset-precedence
// drop below — mirrors the page's isNativeJournalKey.
function loadNativeKeys() {
  const set = new Set();
  try {
    const man = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sources.json'), 'utf8'));
    for (const s of (Array.isArray(man) ? man : [])) {
      if (s && s.key) set.add(s.key);
      (s.sections || []).forEach(sec => { if (sec && sec.key) set.add(sec.key); });
    }
  } catch { /* no manifest → no drop (only possible on a broken checkout — the
               matching path reads the same manifests and is degraded anyway) */ }
  return set;
}

// Can this alert's criteria be answered by the per-journal × per-day tallies?
// Only a pure journal scope can (allPapers, or journal/jtype chips alone) —
// text/author/year/editor/pre-print filters need the rows themselves, so those
// alerts keep the row count exactly as before.
const NON_TALLY_CRIT_KEYS = ['author', 'title', 'abstract', 'affiliation', 'year', 'editor', 'area', 'se', 'ae'];
function tallyAnswerable(c) {
  if (!c) return false;
  if (c.preprintOnly) return false;
  if (NON_TALLY_CRIT_KEYS.some(k => ((c[k] || []).length))) return false;
  return !!(c.allPapers || (c.journal || []).length || (c.jtype || []).length);
}

// The exact number of papers added inside the alert's window, split published /
// working paper — or null when the criteria can't be tally-answered (caller
// then keeps the row counts). Mirrors the page's recentExactCount +
// recentCountsKeyVisible: a tally key is the row's whole '|'-joined scope-key
// set (journal key first, then PNAS section keys); native journals count only
// from the native tally (the FT50/shard catalogs' copies must not double-count);
// per dataset the tally wins only when ≥ the rows we actually matched there.
function exactAlertCounts(criteria, matches, windowStart, now, ctx, tallies, nativeKeys) {
  if (!tallyAnswerable(criteria || {})) return null;
  const c = criteria || {};
  const scope = c.allPapers ? null : ctx.scopeFor(c);
  const nat = nativeKeys || new Set();
  const isWpKey = (k) => (ctx.wpKeys && ctx.wpKeys.has(k)) || String(k).startsWith('wp-');
  // Rows we matched, grouped by dataset (the per-dataset floor for the guard).
  const rowCounts = {};
  for (const p of (matches || [])) {
    const ds = p._ds || 'unknown';
    const r = rowCounts[ds] || (rowCounts[ds] = { papers: 0, wp: 0 });
    if (isWorkingPaper(p, ctx)) r.wp++; else r.papers++;
  }
  const talliedDs = new Set();
  const countedPrimary = new Set();   // a journal counts from ONE dataset only (first wins: native → ft50 → wp → shards)
  const out = { papers: 0, wp: 0 };
  for (const t of (tallies || [])) {
    const exact = { papers: 0, wp: 0 };
    const ownPrimary = new Set();
    for (const key of Object.keys(t.days || {})) {
      const parts = String(key).split('|');
      const primary = parts[0];
      // Dataset precedence, as on the page: a native journal counts only from
      // the native tally (the FT50 catalog shares the INFORMS journals with the
      // native data, so its tally must not re-count them), and any journal an
      // earlier dataset already tallied never counts again from a later one.
      if (t.ds === 'native' ? !nat.has(primary) : nat.has(primary)) continue;
      if (countedPrimary.has(primary)) continue;
      if (scope && !parts.some(k => scope.has(k))) continue;
      const perDay = t.days[key] || {};
      let n = 0;
      for (const d of Object.keys(perDay)) {
        const day = parseAdded(d);
        if (day && day > windowStart && day <= now) n += perDay[d] || 0;
      }
      ownPrimary.add(primary);
      if (!n) continue;
      if (isWpKey(primary)) exact.wp += n; else exact.papers += n;
    }
    for (const k of ownPrimary) countedPrimary.add(k);
    talliedDs.add(t.ds);
    const seen = rowCounts[t.ds] || { papers: 0, wp: 0 };
    // The uncapped tally wins when it is available AND at least as large as the
    // rows on hand — it can only be smaller when stale or ignorant of a key we
    // matched, and then the rows stay the better answer (page parity).
    if ((exact.papers + exact.wp) >= (seen.papers + seen.wp)) {
      out.papers += exact.papers; out.wp += exact.wp;
    } else {
      out.papers += seen.papers; out.wp += seen.wp;
    }
  }
  // Datasets with matched rows but no tally at all keep their row counts.
  for (const ds of Object.keys(rowCounts)) {
    if (talliedDs.has(ds)) continue;
    out.papers += rowCounts[ds].papers; out.wp += rowCounts[ds].wp;
  }
  return out;
}

// ── Feature changelog loading ─────────────────────────────────────────────────
// Reads the hand-maintained feature catalogue (lit/changelog.json). Each
// entry carries a `date` (YYYY-MM-DD, when the feature went live) that is parsed
// into `_added` exactly like a paper's "Date Added", so feature-update alerts
// window by date just like paper alerts. Newest first. Accepts either the
// `{ version, updates:[…] }` wrapper or a bare array. Missing/broken file → [].
function loadChangelog() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8')); }
  catch { return []; }
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.updates) ? raw.updates : []);
  const out = [];
  for (const e of list) {
    if (!e || !e.title) continue;
    const added = parseAdded(e.date);
    if (!added) continue;
    out.push({
      id: String(e.id || e.title),
      title: String(e.title),
      summary: String(e.summary || ''),
      url: safeUrl(e.url) || SITE_URL,
      date: String(e.date || ''),
      _added: added,
    });
  }
  out.sort((a, b) => b._added - a._added);
  return out;
}

// Fetch the ABS satellite shards' recent papers over HTTP, and extend the ctx's
// ABS grade sets from each shard's own manifest so an abs4/abs3 jtype alert can
// match shard journals too. Best-effort: any shard that is missing (404) or
// errors is silently skipped, so a run never breaks when a shard is offline or
// not yet deployed. Needs network (GitHub Actions runners have it); the offline
// --selftest / --scan paths never call it.
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}
async function loadShards(ctx) {
  const rows = [], tallies = [];
  for (const repo of SHARD_REPOS) {
    const ds = 'shard:' + repo;
    try {
      const man = await fetchJson(SHARD_BASE + repo + '/data/sources.json');
      for (const s of (Array.isArray(man) ? man : [])) {
        if (!s || !s.key) continue;
        const g = String(s.abs || '');
        if (g === '4' || g === '4*') ctx.abs4.add(s.key);
        else if (g === '3') ctx.abs3.add(s.key);
      }
    } catch { /* no shard manifest → its jtype grades just won't extend */ }
    try {
      const arr = await fetchJson(SHARD_BASE + repo + '/data/recent.json');
      if (Array.isArray(arr)) for (const p of arr) { p._added = parseAdded(p['Date Added']); p._ds = ds; if (p._added) rows.push(p); }
    } catch { /* no shard recent.json → skip this shard */ }
    try {
      const j = await fetchJson(SHARD_BASE + repo + '/data/' + RECENT_COUNTS_FILE);
      if (j && j.days && typeof j.days === 'object') tallies.push({ ds, days: j.days });
    } catch { /* no shard tally yet → its rows are counted as before */ }
  }
  return { rows, tallies };
}

// ── E-mail rendering ──────────────────────────────────────────────────────────
const MAX_LIST = 100;   // cap papers listed per e-mail
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function paperUrl(p) {
  const doi = String(p.DOI || '');
  if (/^https?:\/\//i.test(doi)) return doi;
  if (doi) return 'https://doi.org/' + doi.replace(/^doi:/i, '');
  return SITE_URL;
}
// ── Paper meta chips — the site's own card colors (owner request 2026-08-31:
// "include the journal name in a nice card with separate colour, as in the
// website", plus the accepting editor and area). VENDORED from index.html's
// .tag/.jk-* rules and extraColorCSS — keep in sync. Outlook's rendering
// engine ignores hsl(), so an extra journal's hashed hue is emitted as hex.
const JK_COLORS = {
  ms:   ['#e8eef7', '#003087'], opre: ['#e6f0ec', '#1f5c40'],
  mksc: ['#f7e8ee', '#8a2b52'], msom: ['#eeeaf7', '#4b3a8a'],
  isre: ['#e6f2f5', '#1a5f70'], pom:  ['#f7f0e4', '#7a5b1d'],
  pnas: ['#fdeee4', '#a34c17'], ec:   ['#eaf3e6', '#3d6b1f'],
};
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}
// [background, text] for a journal key: the eight native pastels, else the
// page's own hue hash (extraColorCSS in index.html — same formula, so a
// journal's chip is the same color in the e-mail as on the site).
function jkColors(jk) {
  if (JK_COLORS[jk]) return JK_COLORS[jk];
  let h = 0;
  for (let i = 0; i < jk.length; i++) h = (h * 31 + jk.charCodeAt(i)) % 360;
  return [hslToHex(h, 52, 92), hslToHex(h, 65, 28)];
}
function chipHTML(text, bg, fg, bold) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:100px;font-size:11.5px;font-weight:${bold ? 600 : 500};margin:2px 6px 2px 0;background:${bg};color:${fg}">${esc(text)}</span>`;
}
// One chip row per listed paper — the same chips, in the same order and
// colors, as the site's own paper card (journalTagsHTML + the .paper-meta row
// in index.html): journal · year (vol/issue) · accepting editor(s) · area ·
// SE/AE · status. Editor/area render the NORMALIZED values (the vendored
// cleanEditorField/normalizeArea above), exactly as the page's cards do.
function paperChipsHTML(p) {
  const chips = [];
  const jk = String(p.JKey || '');
  const [jbg, jfg] = jkColors(jk);
  if (jk === 'pnas' && Array.isArray(p.Sections) && p.Sections.length) {
    for (const s of p.Sections) chips.push(chipHTML('PNAS · ' + s, jbg, jfg, true));
  } else if (jk || p.Journal) {
    const label = jk === 'ec' ? 'ACM EC' : (JOURNAL_NAMES[jk] || p.Journal || jk);
    chips.push(chipHTML(label, jbg, jfg, true));
  }
  if (p.Year) {
    const yr = (p.Volume && p.Issue)
      ? `${p.Year} · Vol. ${p.Volume} No. ${p.Issue}${p.Page ? ', pp. ' + p.Page : ''}`
      : String(p.Year);
    chips.push(chipHTML(yr, '#f4e6ea', '#7d1d3f'));
  }
  for (const e of cleanEditorField(p['Accepting Editor'] || '')) chips.push(chipHTML('✎ ' + e, '#f6edda', '#6f5827'));
  const area = normalizeArea(p['Area'] || '');
  if (area) chips.push(chipHTML(area, '#e8f5ee', '#2a7d4f'));
  for (const e of splitList(p['Senior Editor'])) chips.push(chipHTML('✎ SE: ' + e, '#f6edda', '#6f5827'));
  for (const e of splitList(p['Associate Editor'])) chips.push(chipHTML('AE: ' + e, '#e6eef9', '#2d5f8a'));
  if (p.Status === 'Other') chips.push(chipHTML('Other', '#fce8e8', '#b33a3a'));
  else if (p.Status) chips.push(chipHTML(p.Status, '#fff3e0', '#b36b00'));
  return chips.join('');
}

// Shared e-mail chrome (claret header + footnote), reused by paper alerts AND
// feature announcements so the two never drift. The footnote always offers
// editing preferences + unsubscribing from future e-mails, plus a feedback
// contact. Mirror any change in index.html's renderAlertPreview.
function footerText() {
  return `—
You subscribed to e-mails from The Lit (${SITE_URL}).
· Edit your preferences (journals, filters, frequency, feature updates): open the "E-mail alerts" panel there.
· Unsubscribe from future e-mails: open "E-mail alerts" and pause or delete your subscription.
· Questions, help or feedback: ${CONTACT_EMAIL}`;
}
function footerHtml() {
  return `<hr style="border:none;border-top:1px solid #dce1ea;margin:20px 0 12px">
    <p style="color:#6a5a60;font-size:11px;margin:0 0 5px">You subscribed to e-mails from
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f">The Lit</a>.</p>
    <p style="color:#6a5a60;font-size:11px;margin:0;line-height:1.8">
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Edit your preferences</a> &nbsp;·&nbsp;
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Unsubscribe</a> from future e-mails (pause or delete it in the “E-mail alerts” panel) &nbsp;·&nbsp;
      <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#7d1d3f;font-weight:600">Questions or feedback</a></p>`;
}
function emailShell(headerLabel, innerHtml, bannerHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#241a1e">
  <div style="background:linear-gradient(135deg,#7d1d3f,#591428);padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="color:#fff;font-size:20px"><span style="color:#c9a24b;font-style:italic">The Lit</span> — ${esc(headerLabel)}</div>
  </div>
  <div style="border:1px solid #dce1ea;border-top:none;border-radius:0 0 10px 10px;padding:20px 22px">
    ${bannerHtml || ''}${innerHtml}
    ${footerHtml()}
  </div>
</div>`;
}

// `opts` lets the test-e-mail path reuse this template: subjectPrefix (e.g.
// "[Test] "), noteText prepended to the plain-text body, and bannerHtml shown
// above the HTML body. All optional — a normal alert passes nothing.
function renderEmail(alert, papers, opts) {
  opts = opts || {};
  const name = alert.name || describeCriteria(alert.criteria || {});
  // Published papers lead the digest, working papers follow (each side
  // newest-added first) — mirroring the page's recently-added view, so a
  // working-paper burst can never crowd the journal articles out of the
  // MAX_LIST window — and the counts are stated separately, like the page's
  // "N papers and M working papers added" label.
  const isWp = (p) => String((p && p.JKey) || '').startsWith('wp-') || (p && p.Status === 'Working paper');
  papers = papers.slice().sort((a, b) => (isWp(a) - isWp(b)) || ((b._added || 0) - (a._added || 0)));
  const n = papers.length;
  let nWp = papers.filter(isWp).length, nPub = n - nWp;
  // The listed rows come from the CAPPED recent.json files, so on a burst day
  // (the working-papers backfill stamps ~10–12k/day against a 1,000-row cap)
  // counting them under-reports what was really added — the digest read
  // "1000 working papers" for ever. When the run computed the exact windowed
  // totals from the uncapped recent-counts tallies (opts.exactCounts, see
  // exactAlertCounts), the COUNT line reports those; the rows below stay the
  // newest slice, and the "…and N more" line closes the gap. Guarded ≥ so a
  // stale tally can never announce fewer papers than the e-mail itself lists.
  const exact = opts.exactCounts;
  if (exact && (exact.papers + exact.wp) >= n) { nPub = exact.papers; nWp = exact.wp; }
  const total = nPub + nWp;
  const fmt = (x) => x.toLocaleString('en-US');
  const countPhrase =
    nPub && nWp ? `${fmt(nPub)} new paper${nPub === 1 ? '' : 's'} and ${fmt(nWp)} working paper${nWp === 1 ? '' : 's'}`
    : nWp       ? `${fmt(nWp)} new working paper${nWp === 1 ? '' : 's'}`
    :             `${fmt(nPub)} new paper${nPub === 1 ? '' : 's'}`;
  const shown = papers.slice(0, MAX_LIST);
  const more = total - shown.length;
  const subject = `${opts.subjectPrefix || ''}The Lit: ${countPhrase} — ${name}`;

  const lineText = shown.map((p, i) => {
    // The same facts the HTML chips carry, as ' · '-separated text (editor and
    // area normalized like the site's cards — see paperChipsHTML).
    const bits = [
      p.Journal, p.Year,
      ...cleanEditorField(p['Accepting Editor'] || '').map(e => '✎ ' + e),
      normalizeArea(p['Area'] || ''),
      ...splitList(p['Senior Editor']).map(e => 'SE: ' + e),
      ...splitList(p['Associate Editor']).map(e => 'AE: ' + e),
      p.Status,
    ].filter(Boolean).join(' · ');
    let s = `${i + 1}. ${p.Title || '(untitled)'}\n   ${p.Authors || ''}\n   ${bits}\n   ${paperUrl(p)}`;
    const pre = safeUrl(p.Preprint); if (pre) s += `\n   Pre-print (Open Access): ${pre}`;
    return s;
  }).join('\n\n');
  const text =
`${opts.noteText || ''}${countPhrase} matching your alert "${name}" ${total === 1 ? 'was' : 'were'} added to The Lit.
Criteria: ${describeCriteria(alert.criteria || {})}

${lineText}${more > 0 ? `\n\n…and ${fmt(more)} more. See them all on ${SITE_URL}` : ''}

${footerText()}`;

  const items = shown.map(p => {
    const pre = safeUrl(p.Preprint);
    return `<li style="margin:0 0 18px">
      <a href="${esc(paperUrl(p))}" style="color:#7d1d3f;font-weight:600;text-decoration:none;font-size:15px">${esc(p.Title || '(untitled)')}</a>
      <div style="color:#241a1e;font-size:13px;margin-top:2px">${esc(p.Authors || '')}</div>
      <div style="margin-top:5px;line-height:2">${paperChipsHTML(p)}</div>
      ${pre ? `<div style="font-size:12px;margin-top:3px"><a href="${esc(pre)}" style="color:#c2410c;font-weight:600">Pre-print (Open Access) ↗</a></div>` : ''}
    </li>`;
  }).join('');
  const inner =
`<p style="font-size:14px;margin:0 0 4px"><strong>${esc(countPhrase)}</strong> matching your alert
      <strong>${esc(name)}</strong> ${total === 1 ? 'was' : 'were'} added to The Lit.</p>
    <p style="color:#6a5a60;font-size:12.5px;margin:0 0 16px">Criteria: ${esc(describeCriteria(alert.criteria || {}))}</p>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
    ${more > 0 ? `<p style="font-size:13px;margin:14px 0 0">…and ${fmt(more)} more. <a href="${esc(SITE_URL)}" style="color:#7d1d3f">See them all on The Lit</a>.</p>` : ''}`;
  return { subject, text, html: emailShell('new papers', inner, opts.bannerHtml) };
}

// Feature-announcement e-mail: sent by --announce to everyone whose alert opted
// into feature updates (criteria.features). Content is supplied by the maintainer
// at send time; the chrome/footnote is the shared one.
function renderAnnouncement({ subject, bodyText, bodyHtml }, opts) {
  opts = opts || {};
  const subj = (opts.subjectPrefix || '') + (subject || 'The Lit: a new feature is available');
  const text = `${opts.noteText || ''}${(bodyText || '').trim()}\n\n${footerText()}`;
  const inner = `<p style="font-size:14px;margin:0 0 12px">Here’s what’s new on <strong>The Lit</strong>:</p>
    <div style="font-size:14px;line-height:1.6">${bodyHtml || esc(bodyText || '')}</div>
    <p style="font-size:13px;margin:16px 0 0"><a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Open The Lit →</a></p>`;
  return { subject: subj, text, html: emailShell('what’s new', inner, opts.bannerHtml) };
}

// Automated feature-digest e-mail: the "New features & updates to the website"
// alert. Built from one or more changelog entries (see loadChangelog) that fell
// in the subscriber's window, so it is sent WITHOUT maintainer action — just add
// an entry to changelog.json. Mirrors the on-page preview (renderAlertPreview's
// feature block in index.html) — keep the two in sync. Reuses the shared chrome.
function renderFeatureDigest(features, opts) {
  opts = opts || {};
  const list = Array.isArray(features) ? features.filter(Boolean) : [];
  const n = list.length;
  const subject = (opts.subjectPrefix || '') + (
    n === 1 ? `The Lit: new feature — ${list[0].title}`
    : n > 1  ? `The Lit: ${n} new features & updates`
    :          'The Lit: a new feature is available');

  const lineText = list.map((f, i) => {
    let s = `${i + 1}. ${f.title || ''}`;
    if (f.summary) s += `\n   ${f.summary}`;
    s += `\n   ${safeUrl(f.url) || SITE_URL}`;
    return s;
  }).join('\n\n');
  const text =
`${opts.noteText || ''}Here’s what’s new on The Lit:

${lineText || 'A new feature is available on The Lit.'}

${footerText()}`;

  const items = list.map(f => {
    const url = safeUrl(f.url) || SITE_URL;
    return `<li style="margin:0 0 16px">
      <a href="${esc(url)}" style="color:#7d1d3f;font-weight:600;text-decoration:none;font-size:15px">${esc(f.title || '')}</a>
      ${f.summary ? `<div style="color:#241a1e;font-size:13px;margin-top:2px">${esc(f.summary)}</div>` : ''}
    </li>`;
  }).join('');
  const inner =
`<p style="font-size:14px;margin:0 0 12px">Here’s what’s new on <strong>The Lit</strong>:</p>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
    <p style="font-size:13px;margin:16px 0 0"><a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Open The Lit →</a></p>`;
  return { subject, text, html: emailShell('what’s new', inner, opts.bannerHtml) };
}

// ── Test e-mail (one-off preview a user requests from the page) ────────────────
// A signed-in user can ask "Send me a test e-mail" from the E-mail alerts panel
// to see how their alert looks in a real inbox. The page (which can't send mail)
// queues the request at users/{uid}/testEmails; this renders and delivers it.
// It reuses the SAME templates as real alerts so the preview is faithful, adds a
// "[Test]" subject prefix and a banner making clear it is a preview, and shows
// real recently-added papers that match the criteria — falling back to a couple
// of sample papers so the format always renders even when nothing matches yet.
const TEST_SAMPLE_MAX = 3;
// Fallback papers when no recently-added paper matches the criteria. Mirrors the
// on-page live preview's samples in index.html (renderAlertPreview) — keep in sync.
const SAMPLE_PAPERS = [
  { Title: 'Dispatching and Pricing in Two-Sided Spatial Queues', Authors: 'Ang Xu, Chiwei Yan',
    Journal: 'Operations Research', Year: '2026', Status: 'Articles in Advance',
    Preprint: 'https://arxiv.org/abs/2401.00001', DOI: '' },
  { Title: 'Learning and Information in Dynamic Marketplaces', Authors: 'A. Researcher, B. Coauthor',
    Journal: 'Management Science', Year: '2026', Status: '', DOI: '' },
];
// Fallback feature entries for a features-only test e-mail when the changelog is
// empty/unreadable, so the "what's new" preview always renders. Mirrors the
// on-page preview's feature fallback in index.html (renderAlertPreview).
const SAMPLE_FEATURES = [
  { title: 'Papers now show their citation counts',
    summary: 'Every paper carries a “Cited by” badge that links through to Google Scholar.', url: SITE_URL },
  { title: 'Walk the citation graph inside the catalog',
    summary: 'A “Cited references in this catalog” toggle lists the papers a paper cites that are themselves in The Lit.', url: SITE_URL },
];
const TEST_NOTE_TEXT =
  'This is a TEST e-mail so you can preview how your alert looks. No alert has actually ' +
  'triggered, and the papers shown are examples.\n\n';
const TEST_BANNER_HTML =
  '<p style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12.5px;' +
  'border-radius:8px;padding:9px 12px;margin:0 0 14px"><strong>Test e-mail.</strong> ' +
  'This is a preview of how your alert looks — no alert has actually triggered, and the ' +
  'papers below are examples.</p>';

function renderTestEmail(req, papers, ctx, changelog) {
  const criteria = (req && req.criteria) || {};
  const opts = { subjectPrefix: '[Test] ', noteText: TEST_NOTE_TEXT, bannerHtml: TEST_BANNER_HTML };
  // A features-only request (no paper intent) shows the "what's new" format,
  // sampling the real most-recent changelog entries (falling back to built-in
  // samples so it always renders) — exactly what an automated feature digest
  // looks like.
  if (criteria.features && !hasPaperIntent(criteria)) {
    const recent = (Array.isArray(changelog) ? changelog : []).slice(0, 3);
    return renderFeatureDigest(recent.length ? recent : SAMPLE_FEATURES, opts);
  }
  const matched = (papers || []).filter(p => matchesCriteria(p, criteria, ctx));
  const sample = (matched.length ? matched : SAMPLE_PAPERS).slice(0, TEST_SAMPLE_MAX);
  const alert = { name: (req && req.name) || describeCriteria(criteria), criteria };
  return renderEmail(alert, sample, opts);
}

// ── Frequency gating ──────────────────────────────────────────────────────────
const FREQ_MIN_DAYS = { immediate: 0, daily: 0, weekly: 6.5, monthly: 27.5 };
const DAY_MS = 86400000;

// Start of the UTC day containing `d` (that day at 00:00:00Z). A paper's
// "Date Added" and a changelog entry's `date` are calendar days that parseAdded
// floors to midnight UTC, whereas the high-water marks (lastCheckedAt /
// createdAt) are precise timestamps. Comparing a midnight-stamped item against a
// mid-day mark with `>` silently drops everything dated *today* — e.g. a paper
// added today (00:00Z) is never `>` a mark of today 10:00Z — which is exactly
// how a subscriber created today, or an alert already checked today, misses
// today's papers. So the window boundary is floored to a whole day to match the
// data's day granularity. See parseAdded.
function dayStart(d) { return new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS); }

// Day-floored lower bound (exclusive) of an alert's "new since last checked"
// window, shared by the paper and feature sides so the two stay consistent.
//  · Already checked before → everything up to and including the last check's
//    DAY was covered, so the window opens at dayStart(last) and a strictly-later
//    added-day is new. (An item dated the same day as the last run was sent by
//    that run, so it is excluded — no duplicates.)
//  · First-ever evaluation  → look back to the alert's creation DAY *inclusive*
//    (a subscriber who signs up today still gets items added earlier today),
//    capped at 31 days so a brand-new alert never blasts a big backlog.
function windowStartFor(last, created, now) {
  if (last) return dayStart(last);
  const capMs = dayStart(now).getTime() - 31 * DAY_MS;
  const baseMs = created ? dayStart(created).getTime() - DAY_MS : capMs;
  return new Date(Math.max(baseMs, capMs));
}

// Compute what to do for one alert given `now` and the recent papers.
// Returns { due, matches, windowStart }.
function evaluateAlert(alert, papers, now, ctx) {
  const freq = FREQ_MIN_DAYS[alert.frequency] != null ? alert.frequency : 'weekly';
  const windowStart = windowStartFor(toDate(alert.lastCheckedAt), toDate(alert.createdAt), now);
  const elapsedDays = (now - windowStart) / DAY_MS;
  const due = elapsedDays >= (FREQ_MIN_DAYS[freq] - 0.05);   // small slack for cron jitter
  if (!due) return { due: false, matches: [], windowStart };
  // A features-only subscription has no paper intent → never matches papers.
  const matches = hasPaperIntent(alert.criteria || {})
    ? papers.filter(p => p._added > windowStart && p._added <= now && matchesCriteria(p, alert.criteria || {}, ctx))
    : [];
  return { due: true, matches, windowStart };
}
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();      // Firestore Timestamp
  if (v instanceof Date) return v;
  const d = new Date(v); return isNaN(d) ? null : d;
}

// The "New features & updates to the website" side of an alert. Windows the
// feature changelog by date exactly like evaluateAlert windows papers, but with
// its OWN high-water mark (`lastFeatureCheckedAt`) so features and papers on the
// same alert advance independently — a partial send failure only retries its own
// side. The mark falls back to the PAPER mark (`lastCheckedAt`) for an existing
// subscriber that has no feature mark yet, so turning this feature on never
// blasts them the whole back-catalogue; a brand-new alert with no marks caps its
// first window at ~31 days, same as papers. Returns
// { active, due, features, windowStart }; `active` is false unless the alert
// opted into feature updates (criteria.features).
function evaluateFeatures(alert, changelog, now) {
  const c = (alert && alert.criteria) || {};
  if (!c.features) return { active: false, due: false, features: [], windowStart: null };
  const freq = FREQ_MIN_DAYS[alert.frequency] != null ? alert.frequency : 'weekly';
  const last = toDate(alert.lastFeatureCheckedAt) || toDate(alert.lastCheckedAt);
  const windowStart = windowStartFor(last, toDate(alert.createdAt), now);
  const elapsedDays = (now - windowStart) / DAY_MS;
  const due = elapsedDays >= (FREQ_MIN_DAYS[freq] - 0.05);   // small slack for cron jitter
  if (!due) return { active: true, due: false, features: [], windowStart };
  const features = (Array.isArray(changelog) ? changelog : [])
    .filter(f => f._added > windowStart && f._added <= now)
    .sort((a, b) => b._added - a._added);
  return { active: true, due: true, features, windowStart };
}

/**
 * WHICH CHANGELOG ENTRIES MAY BE E-MAILED, given the maintainer's decisions.
 *
 * Two rules, and the second is the one that is easy to miss:
 *
 *  1. Only PUBLISHED entries go out. An entry nobody has reviewed must not be
 *     announced — an e-mail cannot be recalled, so a digest would defeat the
 *     review gate outright — and one that has been taken down must not either.
 *  2. AND THE ONES AFTER IT WAIT THEIR TURN. Each alert's window advances on a
 *     high-water mark, so sending an entry dated AFTER one that is still
 *     unreviewed pushes that mark past it, and publishing the older entry later
 *     would then reach nobody at all, silently and for ever. So the send stops
 *     before the oldest entry still waiting: publish it or remove it, and
 *     everything behind it goes out on the next run, in the order it was
 *     written. Nothing is lost either way — only delayed.
 *
 * A REMOVED entry deliberately does NOT hold the stream — removing one is a
 * decision, not a pause, and it is one of the two ways to release the hold. The
 * consequence, stated rather than hidden: an entry removed and later RESTORED
 * is put back on the site but is not re-announced, because its date is by then
 * behind the windows that have moved on. That is the right way round — many
 * subscribers will already have been e-mailed it before it was taken down, and
 * nothing here can tell which, so silence beats sending some of them a
 * duplicate.
 *
 * Pure, and returns the mailer's OWN entry objects (`_added`, the normalised
 * url) with any rewording laid over them, so nothing downstream changes shape.
 */
/**
 * The instant to store as this alert's feature high-water mark.
 *
 * `parked` is where the run wants it — below anything still waiting for review,
 * so a held entry is not lost. `prev` is where this subscriber already is.
 * The mark NEVER moves backwards: doing so would re-send every feature digest
 * published in between, which the subscriber sees and the loss it would prevent
 * is one the changelog's own contract already accepts (an entry back-dated
 * behind the last run is not re-announced — "seeding historical entries never
 * triggers a retroactive blast"). In the ordinary case, an entry dated today
 * with a mark from yesterday's run, `parked` is the later of the two anyway.
 */
function featureMarkFor(parked, prev) {
  return prev && prev > parked ? prev : parked;
}

function sendableChangelog(changelog, decisions) {
  const all = Array.isArray(changelog) ? changelog : [];
  const split = LitNews.partition(all, decisions || {});
  const published = new Map(split.approved.map(r => [r.id, r]));
  const oldestPending = split.pending
    .map(r => r.date)
    .filter(Boolean)
    .sort()[0] || '';

  const list = [];
  let held = 0;
  for (const e of all) {
    const shown = published.get(e.id);
    if (!shown) continue;
    if (oldestPending && String(e.date || '').slice(0, 10) >= oldestPending) { held++; continue; }
    list.push(shown.title === e.title && shown.summary === e.summary
      ? e
      : { ...e, title: shown.title, summary: shown.summary });
  }
  /* AND THE MARK MUST NOT MARCH PAST WHAT IS HELD. The feature side's
     high-water mark is a TIMESTAMP of the last check, advanced on every due
     run — including a run that sent nothing because everything was held. Left
     alone it would slide past the unreviewed entry's own date, and publishing
     that entry a day later would then reach nobody at all, silently and for
     ever: the very loss the hold exists to prevent, arriving by the other
     door. `markCap` is the last instant BEFORE the oldest held entry's day, so
     a run under a hold parks the window there instead. */
  const markCap = oldestPending
    ? new Date(Date.parse(oldestPending + 'T00:00:00Z') - 1)
    : null;

  return {
    list,
    pending: split.pending.length,
    removed: split.removed.length,
    held,
    oldestPending,
    markCap: markCap && !isNaN(markCap) ? markCap : null,
  };
}

// ── Real run ──────────────────────────────────────────────────────────────────
async function run({ dryRun }) {
  // Until the secrets are configured, no-op cleanly so the scheduled workflow
  // stays green instead of failing. See lit/_EMAIL-ALERTS-SETUP.md.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Alerts mailer: no Firebase credentials configured — nothing to do. Add the FIREBASE_SERVICE_ACCOUNT secret to enable.');
    return;
  }
  if (!dryRun && !process.env.SMTP_USER) {
    console.log('Alerts mailer: SMTP not configured (no SMTP_USER) — nothing to send. Add the SMTP_* secrets to enable.');
    return;
  }

  const ctx = makeCtx();
  const shards = await loadShards(ctx);      // best-effort HTTP; also extends ctx ABS grades
  const shardRows = shards.rows;
  const papers = loadRecentPapers(shardRows);
  const tallies = loadRecentTallies(shards.tallies);   // uncapped counts for the digest's number
  const nativeKeys = loadNativeKeys();
  let changelog = loadChangelog();           // drives the "new features & updates" alerts
  const now = new Date();
  console.log(`Loaded ${papers.length} recently-added papers${shardRows.length ? ` (incl. ${shardRows.length} from ABS shards)` : ''}, ${tallies.length} recent-count tall${tallies.length === 1 ? 'y' : 'ies'} and ${changelog.length} changelog entr${changelog.length === 1 ? 'y' : 'ies'}. now=${now.toISOString()} dryRun=${dryRun}`);

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();   // GOOGLE_APPLICATION_CREDENTIALS / ADC
  }
  const db = admin.firestore();
  const Timestamp = admin.firestore.Timestamp;

  /* A READ FAILURE IS NOT AN EMPTY SET OF DECISIONS: without them every entry
     since the review gate reads as unreviewed, which is the SAFE direction
     (nothing new goes out) rather than the wrong one, and older entries still
     reach a subscriber whose window covers them. Caught rather than left to
     reject — letting it kill the run would stop the PAPER digests too, and
     those have nothing to do with the update log. */
  let newsDecisions = {};
  try {
    const dsnap = await db.collection(LitNews.COLLECTION).get();
    dsnap.forEach(d => { newsDecisions[d.id] = d.data(); });
  } catch (err) {
    newsDecisions = {};
    console.log(`::warning::could not read the What's-new decisions (${err && err.code || err}) — only updates from before the review gate will be sent this run`);
  }
  const news = sendableChangelog(changelog, newsDecisions);
  changelog = news.list;
  // the instant the feature high-water mark may not pass while entries are held
  const featureMark = news.markCap && news.markCap < now ? news.markCap : now;
  if (news.markCap) {
    console.log(`  feature window parked at ${featureMark.toISOString()} while ${news.pending} entr${news.pending === 1 ? 'y is' : 'ies are'} unreviewed`);
  }
  if (news.pending || news.removed || news.held) {
    console.log(`Changelog: ${changelog.length} sendable, ${news.pending} waiting for review, ${news.removed} removed` +
      (news.held ? `, ${news.held} held behind the unreviewed entry of ${news.oldestPending}` : ''));
  }

  let transport = null;
  if (!dryRun) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const fromName = process.env.ALERTS_FROM_NAME || 'The Lit';
  const fromAddr = process.env.ALERTS_FROM || process.env.SMTP_USER || '';

  const snap = await db.collectionGroup('alerts').get();
  console.log(`Found ${snap.size} alert(s) across all users.`);

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  let sent = 0, matched = 0, features = 0, skipped = 0, errors = 0;
  for (const doc of snap.docs) {
    const alert = doc.data() || {};
    if (alert.enabled === false) { skipped++; continue; }
    const recipient = String(alert.recipient || alert.from || '').trim();
    if (!EMAIL_RE.test(recipient)) { skipped++; continue; }
    const criteria = alert.criteria || {};

    // Two independent sides of one alert: new PAPERS (evaluateAlert, gated by
    // lastCheckedAt) and new FEATURES (evaluateFeatures, gated by
    // lastFeatureCheckedAt). Either can be due on its own; each advances only its
    // own high-water mark, and only when its own send succeeds.
    const papEval  = hasPaperIntent(criteria) ? evaluateAlert(alert, papers, now, ctx) : { due: false, matches: [] };
    const featEval = evaluateFeatures(alert, changelog, now);
    if (!papEval.due && !(featEval.active && featEval.due)) { skipped++; continue; }

    // Build a message envelope shared by both digest kinds.
    const mkMsg = (em, unsubSubject) => ({
      from: fromAddr ? `"${fromName}" <${fromAddr}>` : undefined,
      to: recipient,
      replyTo: (alert.from && EMAIL_RE.test(alert.from)) ? alert.from : undefined,
      subject: em.subject, text: em.text, html: em.html,
      // Standards-based unsubscribe (RFC 2369): mail clients surface a native
      // "Unsubscribe" button — a mailto to the maintainer plus the manage page.
      headers: { 'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(unsubSubject)}>, <${SITE_URL}>` },
    });
    const update = {};

    // ── Papers ──
    if (papEval.due) {
      let ok = true;
      if (papEval.matches.length) {
        matched += papEval.matches.length;
        // The capped recent.json rows are the LIST; the count line comes from
        // the uncapped tallies whenever the criteria allow it (exactAlertCounts
        // → null keeps the row count, the pre-existing behaviour).
        const exact = exactAlertCounts(criteria, papEval.matches, papEval.windowStart, now, ctx, tallies, nativeKeys);
        const em = renderEmail(alert, papEval.matches, { exactCounts: exact });
        if (dryRun) {
          console.log(`  [dry-run] would e-mail ${recipient}: "${em.subject}" (${papEval.matches.length} paper(s) listed${exact ? `, exact ${exact.papers}+${exact.wp}` : ''}, window since ${papEval.windowStart.toISOString()})`);
        } else {
          try {
            await transport.sendMail(mkMsg(em, 'Unsubscribe from The Lit alert: ' + (alert.name || '')));
            console.log(`  sent to ${recipient}: "${em.subject}" (${papEval.matches.length})`);
            update.lastSentAt = Timestamp.fromDate(now);
            update.lastSentCount = papEval.matches.length;
            sent++;
          } catch (e) { ok = false; errors++; console.error(`  ERROR e-mailing ${recipient}: ${e && e.message}`); }
        }
      } else {
        console.log(`  no new paper matches for "${alert.name || describeCriteria(criteria)}" (${alert.frequency || 'weekly'})`);
      }
      if (ok) update.lastCheckedAt = Timestamp.fromDate(now);   // advance only on success (or nothing to send)
    }

    // ── Feature updates ──
    if (featEval.active && featEval.due) {
      let ok = true;
      if (featEval.features.length) {
        const em = renderFeatureDigest(featEval.features);
        if (dryRun) {
          console.log(`  [dry-run] would e-mail ${recipient}: "${em.subject}" (${featEval.features.length} feature(s), window since ${featEval.windowStart.toISOString()})`);
        } else {
          try {
            await transport.sendMail(mkMsg(em, 'Unsubscribe from The Lit updates'));
            console.log(`  sent feature digest to ${recipient}: "${em.subject}" (${featEval.features.length})`);
            update.lastFeatureSentAt = Timestamp.fromDate(now);
            features += featEval.features.length;
            sent++;
          } catch (e) { ok = false; errors++; console.error(`  ERROR e-mailing feature digest to ${recipient}: ${e && e.message}`); }
        }
      } else {
        console.log(`  no new site features for "${alert.name || describeCriteria(criteria)}" (${alert.frequency || 'weekly'})`);
      }
      /* Parked below anything still waiting for review — see `markCap` in
         sendableChangelog — but NEVER MOVED BACKWARDS.

         Those two pull against each other exactly once, and the tie-break is
         the changelog's own contract. Parking below a held entry is what stops
         it being lost; moving the mark back below where this subscriber has
         already been checked would RE-SEND everything published in between,
         which is worse and is visible to them. The only way markCap can land
         before the stored mark is an entry BACK-DATED behind the last run —
         and a back-dated entry reaching nobody is not a bug here, it is the
         documented rule the whole file rests on ("entries dated in the past
         are NOT re-sent, so seeding historical entries never triggers a
         retroactive blast"). In the ordinary case — an entry dated today,
         checked yesterday — markCap is LATER than the stored mark, so the
         park applies and nothing is lost. */
      if (ok) {
        update.lastFeatureCheckedAt = Timestamp.fromDate(featureMarkFor(featureMark,
          toDate(alert.lastFeatureCheckedAt) || toDate(alert.lastCheckedAt)));
      }
    }

    if (!dryRun && Object.keys(update).length) {
      try { await doc.ref.set(update, { merge: true }); } catch (e) { console.error('  state update failed:', e && e.message); }
    }
  }
  console.log(`Done. e-mails sent=${sent}, papers matched=${matched}, features sent=${features}, skipped=${skipped}, errors=${errors}.`);
  if (errors) process.exitCode = 1;
}

// ── Test-e-mail queue ─────────────────────────────────────────────────────────
// Flushes the one-off preview requests users queue at users/{uid}/testEmails
// (see renderTestEmail). Run by its own frequent workflow (lit-alerts-test.yml)
// so a requested test arrives within a few minutes, decoupled from the daily
// digest run. Each request is delivered once and then DELETED (test e-mails are
// ephemeral); a send failure keeps the request for a couple of retries then
// drops it, so a permanently-bad address never loops forever.
async function sendTestEmails({ dryRun }) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Test e-mails: no Firebase credentials configured — nothing to do. Add FIREBASE_SERVICE_ACCOUNT to enable.');
    return;
  }
  if (!dryRun && !process.env.SMTP_USER) {
    console.log('Test e-mails: SMTP not configured (no SMTP_USER) — nothing to send. Add the SMTP_* secrets to enable.');
    return;
  }

  const ctx = makeCtx();
  const papers = loadRecentPapers();
  let changelog = loadChangelog();

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();

  /* A TEST E-MAIL IS A REAL E-MAIL, so it shows only what has really been
     published — the whole point of the preview is that it is faithful, and an
     unreviewed entry reaching an inbox is exactly what the gate exists to
     prevent. Same fallback as the digest run: unreadable decisions withhold
     everything since the gate rather than guessing. */
  try {
    const dsnap = await db.collection(LitNews.COLLECTION).get();
    const docs = {};
    dsnap.forEach(d => { docs[d.id] = d.data(); });
    changelog = sendableChangelog(changelog, docs).list;
  } catch {
    changelog = sendableChangelog(changelog, {}).list;
  }

  let transport = null;
  if (!dryRun) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const fromName = process.env.ALERTS_FROM_NAME || 'The Lit';
  const fromAddr = process.env.ALERTS_FROM || process.env.SMTP_USER || '';

  const snap = await db.collectionGroup('testEmails').get();
  console.log(`Test e-mails: ${snap.size} pending request(s). dryRun=${dryRun}`);

  let sent = 0, skipped = 0, errors = 0;
  for (const doc of snap.docs) {
    const req = doc.data() || {};
    const recipient = String(req.recipient || req.from || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      console.log('  skip: invalid recipient'); skipped++;
      if (!dryRun) { try { await doc.ref.delete(); } catch { /* ignore */ } }
      continue;
    }
    const { subject, text, html } = renderTestEmail(req, papers, ctx, changelog);
    const msg = {
      from: fromAddr ? `"${fromName}" <${fromAddr}>` : undefined,
      to: recipient,
      replyTo: (req.from && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.from)) ? req.from : undefined,
      subject, text, html,
      headers: {
        'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('The Lit alert test')}>, <${SITE_URL}>`,
      },
    };
    if (dryRun) {
      console.log(`  [dry-run] would send test to ${recipient}: "${subject}"`); sent++; continue;
    }
    try {
      await transport.sendMail(msg);
      console.log(`  sent test to ${recipient}: "${subject}"`);
      sent++;
      try { await doc.ref.delete(); } catch (e) { console.error('  could not delete test request:', e && e.message); }
    } catch (e) {
      errors++;
      console.error(`  ERROR sending test to ${recipient}: ${e && e.message}`);
      const attempts = (Number(req.attempts) || 0) + 1;
      try {
        if (attempts >= 3) await doc.ref.delete();                                   // give up after a few tries
        else await doc.ref.set({ attempts, lastError: String((e && e.message) || '').slice(0, 200) }, { merge: true });
      } catch { /* ignore */ }
    }
  }
  console.log(`Test e-mails done: sent=${sent}, skipped=${skipped}, errors=${errors}.`);
  if (errors) process.exitCode = 1;
}

// ── Rewind (one-off recovery) ─────────────────────────────────────────────────
// Clears the paper/feature high-water marks (lastCheckedAt / lastFeatureCheckedAt)
// on RECENTLY-created alerts so the next normal run re-evaluates them from their
// creation day. This recovers items that a run advanced a mark past WITHOUT
// sending — e.g. the day-boundary window bug that dropped everything dated the
// same day an alert was created/checked. It is scoped to alerts created within
// REWIND_LOOKBACK_DAYS (so it can never re-blast a long-standing subscriber's
// back-catalogue) and only ever clears marks, never sends. Add --dry-run to
// preview. After it runs, a normal run (scheduled or dispatched) delivers.
const REWIND_LOOKBACK_DAYS = 3;
async function runRewind({ dryRun }) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Rewind: no Firebase credentials configured — nothing to do.');
    return;
  }
  const now = new Date();
  const cutoff = new Date(now.getTime() - REWIND_LOOKBACK_DAYS * DAY_MS);

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  const snap = await db.collectionGroup('alerts').get();
  console.log(`Rewind: scanning ${snap.size} alert(s); resetting marks on those created since ${cutoff.toISOString()}. dryRun=${dryRun}`);
  let reset = 0, skipped = 0, errors = 0;
  for (const doc of snap.docs) {
    const a = doc.data() || {};
    const created = toDate(a.createdAt);
    const hasMark = a.lastCheckedAt || a.lastFeatureCheckedAt;
    // Only touch alerts created recently AND carrying a mark. No createdAt → skip
    // (can't bound the look-back safely).
    if (!created || created < cutoff || !hasMark) { skipped++; continue; }
    console.log(`  ${dryRun ? '[dry-run] would reset' : 'reset'} "${a.name || '(unnamed)'}" (created ${created.toISOString()})`);
    if (dryRun) { reset++; continue; }
    try {
      await doc.ref.set({ lastCheckedAt: FieldValue.delete(), lastFeatureCheckedAt: FieldValue.delete() }, { merge: true });
      reset++;
    } catch (e) { errors++; console.error('  reset failed:', e && e.message); }
  }
  console.log(`Rewind done: ${dryRun ? 'would reset' : 'reset'}=${reset}, skipped=${skipped}, errors=${errors}. Run the mailer normally next to deliver.`);
  if (errors) process.exitCode = 1;
}

// ── Self-test (no network / no deps) ──────────────────────────────────────────
function selftest() {
  const ctx = makeCtx();
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL', name); } };

  const P = (over) => Object.assign({
    Title: 'A study of platform markets', Authors: 'Jane Doe, Konstantinos Stouras',
    Affiliations: 'University College Dublin', DOI: 'https://doi.org/10.1/x', Year: '2026',
    Status: 'Articles in Advance', Abstract: 'We study two-sided platforms and networks.',
    Journal: 'Management Science', JKey: 'ms', _added: new Date('2026-07-13T00:00:00Z'),
  }, over || {});

  // journal / journal-type scope
  ok('journal ms matches ms', matchesCriteria(P(), { journal: ['ms'] }, ctx));
  ok('journal opre does not match ms', !matchesCriteria(P(), { journal: ['opre'] }, ctx));
  ok('jtype ft50 matches ms', matchesCriteria(P(), { jtype: ['ft50'] }, ctx));
  ok('jtype utd24 matches ms', matchesCriteria(P(), { jtype: ['utd24'] }, ctx));
  ok('jtype abs4 matches ms (4*)', matchesCriteria(P(), { jtype: ['abs4'] }, ctx));
  ok('jtype abs3 does NOT match ms', !matchesCriteria(P(), { jtype: ['abs3'] }, ctx));
  ok('ijoc is UTD24 not FT50', matchesCriteria(P({ JKey: 'ijoc', Journal: 'IJOC' }), { jtype: ['utd24'] }, ctx)
     && !matchesCriteria(P({ JKey: 'ijoc' }), { jtype: ['ft50'] }, ctx));
  ok('no scope matches any journal', matchesCriteria(P({ JKey: 'zzz' }), { author: ['stouras'] }, ctx));
  // nameFold parity with the page: an accented stored name matches a plain term
  ok('accented author folds (regis ← Régis)',
    matchesCriteria(P({ Authors: 'Régis Chenavaz, Sørcha O’Brien' }), { author: ['regis'] }, ctx));
  ok('folded apostrophe matches (o\'brien ← O’Brien)',
    matchesCriteria(P({ Authors: 'Sørcha O’Brien' }), { author: ["o'brien"] }, ctx));
  ok('mid-name substring still rejected under folding',
    !matchesCriteria(P({ Authors: 'Régis Chenavaz' }), { author: ['egis'] }, ctx));

  // PNAS section keys
  const pnas = P({ JKey: 'pnas', Journal: 'PNAS', Sections: ['Economic Sciences'] });
  ok('pnas parent key', matchesCriteria(pnas, { journal: ['pnas'] }, ctx));
  ok('pnas section key', matchesCriteria(pnas, { journal: ['pnas-econ'] }, ctx));
  ok('pnas wrong section', !matchesCriteria(pnas, { journal: ['pnas-cs'] }, ctx));

  // author: prefix-of-name-part
  ok('author prefix stou -> Stouras', matchesCriteria(P(), { author: ['stou'] }, ctx));
  ok('author mid-name no match', !matchesCriteria(P(), { author: ['touras'] }, ctx));
  ok('author AND both present', matchesCriteria(P(), { author: ['stou', 'jane'] }, ctx));
  ok('author AND one missing fails', !matchesCriteria(P(), { author: ['stou', 'smith'] }, ctx));

  // title / abstract substring + quoted word
  ok('title substring platform', matchesCriteria(P(), { title: ['platform'] }, ctx));
  ok('title quoted exact word', matchesCriteria(P(), { title: ['"market"'] } /* matches "markets"? */, ctx) === /\bmarket\b/.test('a study of platform markets'));
  ok('abstract substring network', matchesCriteria(P(), { abstract: ['network'] }, ctx));
  ok('abstract missing term fails', !matchesCriteria(P(), { abstract: ['blockchain'] }, ctx));
  ok('paper with no abstract cannot match abstract query', !matchesCriteria(P({ Abstract: '' }), { abstract: ['platform'] }, ctx));

  // affiliation / year
  ok('affiliation dublin', matchesCriteria(P(), { affiliation: ['dublin'] }, ctx));
  ok('year exact 2026', matchesCriteria(P(), { year: ['2026'] }, ctx));
  ok('year 2025 fails', !matchesCriteria(P(), { year: ['2025'] }, ctx));

  // ── Editorial dimensions (editor / area / SE / AE) ─────────────────────────
  // The criteria hold NORMALIZED page values (sel.editor = p._editors), while
  // MS deposits the WHOLE acceptance sentence as 'Accepting Editor' — the
  // regression this block pins: before the vendored normalizer, an editor or
  // area alert compared the saved name against the raw sentence and could
  // never match a single real row.
  const MSED = P({ 'Accepting Editor': 'This paper was accepted by Eric So, accounting.', Area: 'Accounting' });
  ok('editor name matches the raw acceptance sentence', matchesCriteria(MSED, { editor: ['Eric So'] }, ctx));
  ok('editor match is case-insensitive', matchesCriteria(MSED, { editor: ['eric so'] }, ctx));
  ok('wrong editor fails', !matchesCriteria(MSED, { editor: ['Stefan Scholtes'] }, ctx));
  ok('area normalizes to the page value (lowercase)', matchesCriteria(MSED, { area: ['accounting'] }, ctx));
  ok('wrong area fails', !matchesCriteria(MSED, { area: ['finance'] }, ctx));
  ok('editor alias variant resolves (D. J. Wu → D.J. Wu)',
     matchesCriteria(P({ 'Accepting Editor': 'This paper was accepted by D. J. Wu, information systems.' }), { editor: ['D.J. Wu'] }, ctx));
  ok('two editors split on "and" — either matches',
     matchesCriteria(P({ 'Accepting Editor': 'This paper was accepted by Jane Roe and John Doe, operations.' }), { editor: ['john doe'] }, ctx));
  ok('a clean editor-name field still matches (raw fallback)',
     matchesCriteria(P({ 'Accepting Editor': 'Kay Giesecke' }), { editor: ['Kay Giesecke'] }, ctx));
  ok('area alias consolidates (strategy → business strategy)',
     matchesCriteria(P({ Area: 'Strategy' }), { area: ['business strategy'] }, ctx));
  ok('SE ;-list matches any one of several',
     matchesCriteria(P({ JKey: 'isre', 'Senior Editor': 'Alok Gupta; Sabine Matook' }), { se: ['sabine matook'] }, ctx));
  ok('AE matches', matchesCriteria(P({ JKey: 'isre', 'Associate Editor': 'A. Reviewer' }), { ae: ['a. reviewer'] }, ctx));
  ok('missing editor field fails an editor criterion', !matchesCriteria(P(), { editor: ['Eric So'] }, ctx));
  // …and against the SERVED data: every MS row's raw field really is the
  // sentence, and the normalizer really extracts a clean name from it.
  (() => {
    const served = loadRecentPapers().filter(p => p.JKey === 'ms' && p['Accepting Editor']);
    if (!served.length) return;   // no MS rows in the current window → nothing to pin
    const eds = cleanEditorField(served[0]['Accepting Editor']);
    ok('served MS row: normalizer extracts a clean editor name',
       eds.length > 0 && !/accepted by/i.test(eds[0]));
    ok('served MS row: the extracted name matches as a criterion',
       matchesCriteria(served[0], { editor: [eds[0]] }, ctx));
  })();

  // pre-print flag
  ok('preprintOnly needs a pre-print', !matchesCriteria(P(), { preprintOnly: true }, ctx));
  ok('preprintOnly with arxiv passes', matchesCriteria(P({ Preprint: 'https://arxiv.org/abs/2410.13767' }), { preprintOnly: true }, ctx));

  // combined AND across fields
  ok('combo ft50 + author + preprint',
     matchesCriteria(P({ Preprint: 'https://ssrn.com/abstract=1' }), { jtype: ['ft50'], author: ['stou'], preprintOnly: true }, ctx));
  ok('combo fails when journal out of scope',
     !matchesCriteria(P({ JKey: 'opre' }), { journal: ['ms'], author: ['stou'] }, ctx));

  // frequency gating
  const mk = (over) => Object.assign({ frequency: 'daily', criteria: { journal: ['ms'] } }, over);
  const now = new Date('2026-07-13T06:00:00Z');
  const recent = [P({ _added: new Date('2026-07-13T00:00:00Z') })];
  ok('daily due, 1 match', (() => { const r = evaluateAlert(mk({ lastCheckedAt: new Date('2026-07-12T06:00:00Z') }), recent, now, ctx); return r.due && r.matches.length === 1; })());
  ok('weekly not due after 2 days', !evaluateAlert(mk({ frequency: 'weekly', lastCheckedAt: new Date('2026-07-11T06:00:00Z') }), recent, now, ctx).due);
  ok('weekly due after 8 days', evaluateAlert(mk({ frequency: 'weekly', lastCheckedAt: new Date('2026-07-05T06:00:00Z') }), recent, now, ctx).due);
  ok('monthly not due after 10 days', !evaluateAlert(mk({ frequency: 'monthly', lastCheckedAt: new Date('2026-07-03T06:00:00Z') }), recent, now, ctx).due);
  ok('monthly due after 30 days', evaluateAlert(mk({ frequency: 'monthly', lastCheckedAt: new Date('2026-06-13T06:00:00Z') }), recent, now, ctx).due);
  ok('paper before window excluded', (() => { const r = evaluateAlert(mk({ lastCheckedAt: new Date('2026-07-13T03:00:00Z') }), recent, now, ctx); return r.due && r.matches.length === 0; })());

  // ── Same-day window (regression test for the day-boundary bug) ──────────────
  // A day-only "Date Added" parses to midnight UTC, while createdAt/lastCheckedAt
  // are mid-day timestamps. An alert CREATED TODAY must still match papers added
  // today; pre-fix the strict `>` against a mid-day mark dropped them all.
  const nowSD = new Date('2026-07-14T10:00:00Z');
  const todayPaper = [P({ _added: new Date('2026-07-14T00:00:00Z') })];   // "Date Added":"2026-07-14"
  ok('alert created today matches a paper added today (first eval)',
     evaluateAlert({ frequency: 'immediate', criteria: { allPapers: true }, createdAt: new Date('2026-07-14T09:00:00Z') }, todayPaper, nowSD, ctx).matches.length === 1);
  // Steady state: the day after a run, today's already-sent paper is NOT re-sent,
  // but a genuinely new (next-day) paper is.
  const nowNext = new Date('2026-07-15T10:00:00Z');
  const mixed = [P({ _added: new Date('2026-07-14T00:00:00Z') }), P({ _added: new Date('2026-07-15T00:00:00Z') })];
  const nextEval = evaluateAlert({ frequency: 'daily', criteria: { allPapers: true }, lastCheckedAt: new Date('2026-07-14T10:00:00Z') }, mixed, nowNext, ctx);
  ok('next-day run skips today\'s already-sent paper, keeps the new one',
     nextEval.matches.length === 1 && nextEval.matches[0]._added.getTime() === new Date('2026-07-15T00:00:00Z').getTime());
  // The same fix applies to feature updates dated today.
  const clToday = [{ id: 'x', title: 'Shipped today', summary: '', url: SITE_URL, date: '2026-07-14', _added: new Date('2026-07-14T00:00:00Z') }];
  ok('feature dated today reaches an alert created today',
     evaluateFeatures({ criteria: { features: true }, frequency: 'immediate', createdAt: new Date('2026-07-14T09:00:00Z') }, clToday, nowSD).features.length === 1);

  // e-mail rendering
  const em = renderEmail({ name: 'FT50 · pre-prints', criteria: { jtype: ['ft50'], preprintOnly: true } },
                         [P({ Preprint: 'https://arxiv.org/abs/2410.13767' })]);
  ok('subject has count + name', /1 new paper — FT50/.test(em.subject));
  ok('html has paper title', em.html.includes('platform markets'));
  ok('html has preprint link', em.html.includes('arxiv.org/abs/2410.13767'));
  ok('text has manage note', em.text.includes('E-mail alerts'));
  ok('text footer has edit-prefs/unsubscribe/feedback', /Edit your preferences/.test(em.text) && /Unsubscribe from future/.test(em.text) && em.text.includes(CONTACT_EMAIL));
  ok('html footer has edit-prefs/unsubscribe/feedback', /Edit your preferences/.test(em.html) && /Unsubscribe/.test(em.html) && em.html.includes('mailto:' + CONTACT_EMAIL));
  ok('html escapes', renderEmail({ name: 'x', criteria: {} }, [P({ Title: 'A <b> & "q"' })]).html.includes('A &lt;b&gt; &amp; &quot;q&quot;'));

  // ── The paper chips (owner request 2026-08-31): each listed paper renders
  // the site's own meta chips — the journal in its per-journal colors, year,
  // NORMALIZED accepting editor + area, SE/AE, status — plus a pre-print link.
  const emChips = renderEmail({ name: 'x', criteria: {} }, [P({
    'Accepting Editor': 'This paper was accepted by Eric So, accounting.',
    Area: 'Accounting', Preprint: 'https://arxiv.org/abs/2410.13767',
  })]);
  ok('journal chip carries the site\'s ms colors', emChips.html.includes('#003087') && emChips.html.includes('#e8eef7'));
  ok('journal chip names the journal', />Management Science<\/span>/.test(emChips.html));
  ok('editor chip shows the normalized name, never the sentence',
     emChips.html.includes('✎ Eric So') && !emChips.html.includes('accepted by'));
  ok('area chip shows the normalized area in the site\'s green', />accounting<\/span>/.test(emChips.html) && emChips.html.includes('#2a7d4f'));
  ok('status chip present', />Articles in Advance<\/span>/.test(emChips.html));
  ok('pre-print link is the site\'s own label', emChips.html.includes('Pre-print (Open Access) ↗'));
  ok('text part carries editor + area too', emChips.text.includes('✎ Eric So') && emChips.text.includes('· accounting ·'));
  const emSe = renderEmail({ name: 'x', criteria: {} }, [P({ JKey: 'isre', Journal: 'Information Systems Research',
    'Senior Editor': 'Alok Gupta; Sabine Matook', 'Associate Editor': 'A. Reviewer' })]);
  ok('SE/AE chips render per name', emSe.html.includes('✎ SE: Alok Gupta') && emSe.html.includes('✎ SE: Sabine Matook') && emSe.html.includes('AE: A. Reviewer'));
  const pnasChips = renderEmail({ name: 'x', criteria: {} }, [P({ JKey: 'pnas', Journal: 'PNAS', Sections: ['Economic Sciences'] })]);
  ok('PNAS renders one chip per section, in the pnas colors',
     pnasChips.html.includes('PNAS · Economic Sciences') && pnasChips.html.includes('#a34c17'));
  ok('an extra journal\'s chip color is the page\'s hue hash, as hex',
     (() => { const [bg, fg] = jkColors('respol'); return /^#[0-9a-f]{6}$/.test(bg) && /^#[0-9a-f]{6}$/.test(fg)
       && renderEmail({ name: 'x', criteria: {} }, [P({ JKey: 'respol', Journal: 'Research Policy' })]).html.includes(bg); })());
  ok('a working paper\'s status chips as on the site',
     />Working paper<\/span>/.test(renderEmail({ name: 'x', criteria: {} }, [P({ JKey: 'wp-ssrn', Status: 'Working paper' })]).html));

  // ── Working papers in alerts (user report 2026-08-10: an "any new paper"
  // subscriber had never received a single working paper — the archive's
  // recent.json simply wasn't loaded, and no matching rule admitted its rows).
  const WPP = P({ JKey: 'wp-ssrn', Journal: 'SSRN Working Papers', Status: 'Working paper',
    Title: 'A Theory of Ambitious Statements', Authors: 'Bhagwan Chowdhry',
    Abstract: '', Affiliations: '',
    Preprint: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6426218' });
  ok('allPapers matches a working paper', matchesCriteria(WPP, { allPapers: true }, ctx));
  ok('jtype wp matches a working paper', matchesCriteria(WPP, { jtype: ['wp'] }, ctx));
  ok('wp repository key matches its working papers', matchesCriteria(WPP, { journal: ['wp-ssrn'] }, ctx));
  ok('author search reaches working papers (page parity)', matchesCriteria(WPP, { author: ['chowdhry'] }, ctx));
  ok('title search reaches working papers', matchesCriteria(WPP, { title: ['ambitious'] }, ctx));
  ok('year alone never matches a working paper (page parity)', !matchesCriteria(WPP, { year: ['2026'] }, ctx));
  ok('pre-print toggle alone never matches a working paper', !matchesCriteria(WPP, { preprintOnly: true }, ctx));
  ok('a published-list scope excludes working papers', !matchesCriteria(WPP, { jtype: ['ft50'] }, ctx));
  ok('wp jtype label in criteria description', describeCriteria({ jtype: ['wp'] }) === 'Working Papers');
  // digest rendering: split counts, published papers listed first
  const emMix = renderEmail({ name: 'Everything', criteria: { allPapers: true } }, [WPP, P()]);
  ok('mixed digest counts published + working papers separately', /1 new paper and 1 working paper — Everything/.test(emMix.subject));
  ok('published papers lead the digest list', emMix.html.indexOf('platform markets') < emMix.html.indexOf('Ambitious Statements'));
  ok('wp-only digest says working papers', /1 new working paper — WPs/.test(renderEmail({ name: 'WPs', criteria: { jtype: ['wp'] } }, [WPP]).subject));
  // the archive's recent.json is loaded with the others (repo data on disk)
  ok('loadRecentPapers includes the working-papers archive', loadRecentPapers().some(p => String(p.JKey || '').startsWith('wp-')));

  // ── Exact counts from the uncapped recent-counts tallies (user report
  // 2026-08-17: an "any new paper" daily digest claimed "1000 working papers"
  // — exactly the WP recent.json cap — while ~10k/day were really stamped).
  const tW0 = new Date('2026-08-10T00:00:00Z');           // window: days AFTER 08-10
  const tNow = new Date('2026-08-12T10:00:00Z');
  const TALLIES = [
    { ds: 'native', days: { 'ms': { '2026-08-10': 5, '2026-08-11': 7 },
                            'pnas|pnas-econ|pnas-soc': { '2026-08-11': 2 },
                            'respol': { '2026-08-11': 99 } } },     // non-native key in the native tally → dropped
    { ds: 'ft50',   days: { 'respol': { '2026-08-11': 3 },
                            'ms': { '2026-08-11': 50 } } },         // native key in the FT50 tally → dropped (no double count)
    { ds: 'wp',     days: { 'wp-ssrn': { '2026-08-11': 9000 }, 'wp-arxiv': { '2026-08-12': 2500 } } },
  ];
  const NATK = new Set(['ms', 'opre', 'pnas', 'pnas-econ', 'pnas-soc']);
  const wpRow = (d) => P({ JKey: 'wp-ssrn', Status: 'Working paper', _ds: 'wp', _added: new Date(d) });
  const msRow = (d) => P({ JKey: 'ms', _ds: 'native', _added: new Date(d) });
  const rpRow = (d) => P({ JKey: 'respol', Journal: 'Research Policy', _ds: 'ft50', _added: new Date(d) });
  const MATCH = [msRow('2026-08-11T00:00:00Z'), rpRow('2026-08-11T00:00:00Z'), wpRow('2026-08-11T00:00:00Z')];
  ok('text criteria are never tally-answered', exactAlertCounts({ author: ['x'] }, MATCH, tW0, tNow, ctx, TALLIES, NATK) === null);
  ok('year criteria are never tally-answered', exactAlertCounts({ journal: ['ms'], year: ['2026'] }, MATCH, tW0, tNow, ctx, TALLIES, NATK) === null);
  ok('pre-print criteria are never tally-answered', exactAlertCounts({ allPapers: true, preprintOnly: true }, MATCH, tW0, tNow, ctx, TALLIES, NATK) === null);
  const exAll = exactAlertCounts({ allPapers: true }, MATCH, tW0, tNow, ctx, TALLIES, NATK);
  ok('allPapers: uncapped WP tally beats the capped rows', exAll && exAll.wp === 11500);
  ok('allPapers: published side sums native + FT50, window-exclusive of the boundary day',
     exAll && exAll.papers === 7 + 2 + 3);                 // 08-10 excluded (> windowStart), ms 50 + respol 99 dropped
  const exMs = exactAlertCounts({ journal: ['ms'] }, [msRow('2026-08-11T00:00:00Z')], tW0, tNow, ctx, TALLIES, NATK);
  ok('journal scope counts only its keys', exMs && exMs.papers === 7 && exMs.wp === 0);
  const exSec = exactAlertCounts({ journal: ['pnas-econ'] }, [], tW0, tNow, ctx, TALLIES, NATK);
  ok('a PNAS section key matches its |-joined tally key', exSec && exSec.papers === 2);
  const exWp = exactAlertCounts({ jtype: ['wp'] }, [wpRow('2026-08-11T00:00:00Z')], tW0, tNow, ctx, TALLIES, NATK);
  ok('wp jtype scope reads the WP tally', exWp && exWp.wp === 11500 && exWp.papers === 0);
  // per-dataset guard: a stale tally smaller than the rows on hand loses to them
  const exStale = exactAlertCounts({ journal: ['ms'] },
    [msRow('2026-08-11T00:00:00Z'), msRow('2026-08-11T01:00:00Z'), msRow('2026-08-11T02:00:00Z'),
     msRow('2026-08-11T03:00:00Z'), msRow('2026-08-11T04:00:00Z'), msRow('2026-08-11T05:00:00Z'),
     msRow('2026-08-11T06:00:00Z'), msRow('2026-08-11T07:00:00Z')],
    tW0, tNow, ctx, [{ ds: 'native', days: { 'ms': { '2026-08-11': 2 } } }], NATK);
  ok('a stale tally never under-counts the rows actually matched', exStale && exStale.papers === 8);
  // a dataset with rows but no tally keeps its row count beside a tallied one
  const exPart = exactAlertCounts({ allPapers: true }, MATCH, tW0, tNow, ctx,
    [{ ds: 'wp', days: { 'wp-ssrn': { '2026-08-11': 9000 } } }], NATK);
  ok('datasets without a tally fall back to their rows', exPart && exPart.wp === 9000 && exPart.papers === 2);
  // the digest states the exact counts and closes the gap with "…and N more"
  const emExact = renderEmail({ name: 'Everything', criteria: { allPapers: true } }, [WPP, P()],
    { exactCounts: { papers: 2, wp: 11500 } });
  ok('digest subject carries the exact tally counts', /2 new papers and 11,500 working papers — Everything/.test(emExact.subject));
  ok('digest closes the gap with "…and N more"', emExact.text.includes('…and 11,500 more'));
  const emStaleGuard = renderEmail({ name: 'Everything', criteria: { allPapers: true } }, [WPP, P()],
    { exactCounts: { papers: 1, wp: 0 } });
  ok('renderEmail ignores an exact count smaller than the rows it lists', /1 new paper and 1 working paper — Everything/.test(emStaleGuard.subject));

  // "any new paper" (allPapers) + features-only (no paper intent)
  ok('allPapers matches any paper', matchesCriteria(P({ Journal: 'Whatever', Year: '1990' }), { allPapers: true }, ctx));
  ok('allPapers describe', describeCriteria({ allPapers: true }) === 'any new paper');
  ok('allPapers has paper intent', hasPaperIntent({ allPapers: true }) === true);
  ok('features-only has NO paper intent', hasPaperIntent({ features: true }) === false);
  ok('empty criteria has no paper intent', hasPaperIntent({}) === false);
  ok('features-only alert matches 0 papers', evaluateAlert(mk({ criteria: { features: true }, lastCheckedAt: new Date('2026-07-12T06:00:00Z') }), recent, now, ctx).matches.length === 0);
  ok('allPapers alert matches the new paper', evaluateAlert(mk({ criteria: { allPapers: true }, lastCheckedAt: new Date('2026-07-12T06:00:00Z') }), recent, now, ctx).matches.length === 1);
  // feature announcement e-mail (maintainer --announce; free-form body)
  const ann = renderAnnouncement({ subject: 'New: Working Papers', bodyText: 'You can now browse working papers.', bodyHtml: '<p>You can now browse <b>working papers</b>.</p>' });
  ok('announcement subject', ann.subject === 'New: Working Papers');
  ok('announcement html has body + shell + footer', /working papers/.test(ann.html) && /what.s new/.test(ann.html) && /Edit your preferences/.test(ann.html));
  ok('announcement text has footer', /Unsubscribe from future/.test(ann.text) && ann.text.includes(CONTACT_EMAIL));

  // ── Feature changelog + digest (the AUTOMATED "what's new" path) ────────────
  const CL = [
    { id: 'citations', title: 'Papers now show citation counts', summary: 'A “Cited by N” badge on every paper.', url: SITE_URL, date: '2026-07-10', _added: new Date('2026-07-10T00:00:00Z') },
    { id: 'refs',      title: 'Cited references in this catalog', summary: 'Walk the citation graph.',            url: SITE_URL, date: '2026-07-01', _added: new Date('2026-07-01T00:00:00Z') },
    { id: 'old',       title: 'An older feature',                summary: '',                                    url: SITE_URL, date: '2026-05-01', _added: new Date('2026-05-01T00:00:00Z') },
  ];
  const nowF = new Date('2026-07-13T06:00:00Z');
  // features-only alert, daily, last feature-check 2026-07-09 → sees only the 07-10 entry
  const fe1 = evaluateFeatures({ criteria: { features: true }, frequency: 'daily', lastFeatureCheckedAt: new Date('2026-07-09T06:00:00Z') }, CL, nowF);
  ok('feature daily due, 1 new since last feature check', fe1.active && fe1.due && fe1.features.length === 1 && fe1.features[0].id === 'citations');
  // weekly not due after ~2 days
  ok('feature weekly not due after 2 days', !evaluateFeatures({ criteria: { features: true }, frequency: 'weekly', lastFeatureCheckedAt: new Date('2026-07-11T06:00:00Z') }, CL, nowF).due);
  // weekly due after ~18 days → batches every entry in the window (07-10 and 07-01, not 05-01)
  const fe2 = evaluateFeatures({ criteria: { features: true }, frequency: 'weekly', lastFeatureCheckedAt: new Date('2026-06-25T06:00:00Z') }, CL, nowF);
  ok('feature weekly due, batches the whole window', fe2.due && fe2.features.length === 2);
  // a non-features alert is inactive on the feature side
  ok('non-features alert inactive for features', !evaluateFeatures({ criteria: { journal: ['ms'] }, frequency: 'daily', lastCheckedAt: new Date('2026-07-12T06:00:00Z') }, CL, nowF).active);
  // existing subscriber with only a PAPER mark → feature window falls back to it (no history blast)
  const fe3 = evaluateFeatures({ criteria: { features: true }, frequency: 'daily', lastCheckedAt: new Date('2026-07-12T06:00:00Z') }, CL, nowF);
  ok('feature window falls back to lastCheckedAt (no back-catalogue blast)', fe3.due && fe3.features.length === 0);
  // brand-new subscriber (no marks): first window includes items dated on/after
  // the creation DAY (07-01 'refs' and 07-10 'citations'), yet is still capped so
  // the far-older 05-01 entry is excluded. (Pre-fix the creation-day 07-01 entry
  // was wrongly dropped because createdAt is compared with `>` at sub-day
  // precision — this is the same day-boundary bug the fix removes.)
  const fe4 = evaluateFeatures({ criteria: { features: true }, frequency: 'daily', createdAt: new Date('2026-07-01T00:00:00Z') }, CL, nowF);
  ok('new subscriber first window includes creation-day item, excludes far-older',
     fe4.due && fe4.features.length === 2 && fe4.features.some(f => f.id === 'refs') && !fe4.features.some(f => f.id === 'old'));
  // digest rendering — single vs multi subject, body, footer
  const fd1 = renderFeatureDigest([CL[0]]);
  ok('feature digest single subject names the feature', /new feature — Papers now show citation counts/.test(fd1.subject));
  ok('feature digest html has title + shell + footer', /citation counts/.test(fd1.html) && /what.s new/.test(fd1.html) && /Edit your preferences/.test(fd1.html));
  const fd2 = renderFeatureDigest([CL[0], CL[1]]);
  ok('feature digest multi subject counts', /2 new features/.test(fd2.subject));
  ok('feature digest lists all entries', /citation counts/.test(fd2.html) && /citation graph/.test(fd2.html));
  ok('feature digest text has footer', /Unsubscribe from future/.test(fd2.text) && fd2.text.includes(CONTACT_EMAIL));
  ok('feature digest escapes titles', renderFeatureDigest([{ title: 'A <b> & "q"', summary: '', url: SITE_URL }]).html.includes('A &lt;b&gt; &amp; &quot;q&quot;'));
  // loadChangelog reads the shipped file; every entry has a parseable date + title
  const cl = loadChangelog();
  ok('loadChangelog returns dated entries, newest first', Array.isArray(cl) && cl.length > 0 && cl.every(e => e._added instanceof Date && e.title) && (cl.length < 2 || cl[0]._added >= cl[1]._added));

  // ── What may be announced at all: the review gate (lit-news.js) ────────────
  // An e-mail cannot be recalled, so the gate has to hold HERE as well as on
  // the page: an entry the maintainer has not published, or has taken down,
  // must never reach an inbox. The decision rules themselves are pinned in
  // lit/_scraper/news-selftest.mjs; these are the mailer's own use of them.
  const CLR = [
    { id: 'old',   title: 'Before the gate', summary: 'S', url: SITE_URL, date: '2026-08-01', _added: new Date('2026-08-01T00:00:00Z') },
    { id: 'live',  title: 'Published',       summary: 'S', url: SITE_URL, date: '2026-08-25', _added: new Date('2026-08-25T00:00:00Z') },
    { id: 'draft', title: 'Waiting',         summary: 'S', url: SITE_URL, date: '2026-08-26', _added: new Date('2026-08-26T00:00:00Z') },
    { id: 'after', title: 'Published, newer', summary: 'S', url: SITE_URL, date: '2026-08-28', _added: new Date('2026-08-28T00:00:00Z') },
    { id: 'gone',  title: 'Taken down',      summary: 'S', url: SITE_URL, date: '2026-08-29', _added: new Date('2026-08-29T00:00:00Z') },
  ];
  const DEC = { live: { status: 'approved' }, after: { status: 'approved' }, gone: { status: 'removed' } };
  const sendable = sendableChangelog(CLR, DEC);
  // (the list keeps the changelog's own order, which the fixture writes oldest
  //  first; evaluateFeatures sorts by date itself, so only membership matters)
  ok('only published entries are e-mailed', sendable.list.map(e => e.id).sort().join(',') === 'live,old');
  ok('an unreviewed entry is counted, not sent', sendable.pending === 1 && sendable.removed === 1);
  ok('a published entry DATED AFTER an unreviewed one waits for it',
     sendable.held === 1 && !sendable.list.some(e => e.id === 'after'));
  ok('with no decisions readable, nothing since the review gate goes out',
     sendableChangelog(CLR, {}).list.map(e => e.id).sort().join(',') === 'old');
  ok('a rewording is applied to what is sent',
     sendableChangelog(CLR, { live: { status: 'approved', title: 'Reworded' } })
       .list.some(e => e.id === 'live' && e.title === 'Reworded'));
  ok('and the mailer keeps its own entry shape (_added survives)',
     sendable.list.every(e => e._added instanceof Date));
  /* AND THE MARK CANNOT MARCH PAST WHAT IS HELD. The feature window is a
     TIMESTAMP advanced on every due run, empty send included — so without this
     the held entry's own date falls behind the window while it waits, and
     publishing it later would reach nobody. Reproduced as a timeline: B is
     unreviewed on the 26th, the run sends nothing, and the mark must park
     before the 26th rather than at "now" on the 30th. */
  ok('the feature mark parks before the oldest entry still waiting',
     sendable.markCap instanceof Date &&
     sendable.markCap.toISOString() === '2026-08-25T23:59:59.999Z');
  ok('and a window starting there still catches that entry once it is published',
     new Date('2026-08-26T00:00:00Z') > sendable.markCap);
  ok('with nothing waiting the mark is not capped at all — the behaviour it always had',
     sendableChangelog(CLR, { live: { status: 'approved' }, draft: { status: 'approved' },
       after: { status: 'approved' }, gone: { status: 'approved' } }).markCap === null);
  /* …and an entry already sent is not re-sent by the parked mark: its own date
     is strictly older than the cap, so the next window starts after it. */
  ok('an entry already sent stays behind the parked mark',
     new Date('2026-08-25T00:00:00Z') < sendable.markCap);

  /* AND THE MARK NEVER MOVES BACKWARDS. Parking it below a held entry is what
     stops that entry being lost; moving it below where this subscriber has
     already been checked would RE-SEND every digest published in between —
     worse, and visible to them. The only way that can arise is an entry
     back-dated behind the last run, which the changelog's own contract already
     says is not re-announced. */
  const parked = new Date('2026-08-25T23:59:59.999Z');
  ok('the parked mark is used when the subscriber is behind it',
     featureMarkFor(parked, new Date('2026-08-20T06:00:00Z')) === parked);
  ok('and a subscriber already past it is left where they are — no re-send',
     featureMarkFor(parked, new Date('2026-08-28T06:00:00Z')).toISOString() === '2026-08-28T06:00:00.000Z');
  ok('a subscriber with no mark at all takes the parked one',
     featureMarkFor(parked, null) === parked);

  ok('nothing waiting means nothing held back',
     sendableChangelog(CLR, { live: { status: 'approved' }, draft: { status: 'approved' },
       after: { status: 'approved' }, gone: { status: 'approved' } }).held === 0);

  // a features-only test e-mail samples the real changelog (faithful preview)
  const tf = renderTestEmail({ name: 'Site updates', criteria: { features: true } }, [], ctx, cl);
  ok('features-only test samples the real changelog', /^\[Test\] /.test(tf.subject) && /what.s new/.test(tf.html) && tf.html.includes(cl[0].title));

  // test e-mail (one-off preview): faithful template + [Test] marker + banner
  const t1 = renderTestEmail({ name: 'FT50 · pre-prints', criteria: { jtype: ['ft50'], preprintOnly: true } },
                             [P({ Preprint: 'https://arxiv.org/abs/2401.00001' })], ctx);
  ok('test subject is prefixed [Test]', /^\[Test\] The Lit: /.test(t1.subject));
  ok('test html has the preview banner', /Test e-mail\./.test(t1.html));
  ok('test text has the preview note', /TEST e-mail/.test(t1.text));
  ok('test html shows a matching paper', t1.html.includes('platform markets'));
  ok('test html keeps the footer', /Edit your preferences/.test(t1.html));
  // no recent match → falls back to the built-in sample papers (never empty)
  const t2 = renderTestEmail({ name: 'Nothing new', criteria: { author: ['zzzznomatch'] } }, [P()], ctx);
  ok('test falls back to sample papers when nothing matches', /Two-Sided Spatial Queues/.test(t2.html));
  ok('test with empty recent set still renders', renderTestEmail({ criteria: {} }, [], ctx).html.includes('Two-Sided Spatial Queues'));
  // features-only test → "what's new" format, still marked [Test]
  const t3 = renderTestEmail({ name: 'Site updates', criteria: { features: true } }, [P()], ctx);
  ok('features-only test uses the what\'s-new format', /what.s new/.test(t3.html) && /^\[Test\] /.test(t3.subject));

  console.log(`\nselftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── Offline scan (preview what an alert would match; no Firestore/SMTP) ────────
// e.g. node alerts-mailer.mjs --scan --criteria='{"jtype":["ft50"],"preprintOnly":true}' --days=7
function scan(argv) {
  const ctx = makeCtx();
  const papers = loadRecentPapers();
  const critArg = (argv.find(a => a.startsWith('--criteria=')) || '').slice('--criteria='.length);
  const daysArg = Number((argv.find(a => a.startsWith('--days=')) || '').slice('--days='.length)) || 0;
  let criteria = {};
  if (critArg) { try { criteria = JSON.parse(critArg); } catch (e) { console.error('bad --criteria JSON:', e.message); process.exit(2); } }
  const now = new Date();
  const cutoff = daysArg ? new Date(now.getTime() - daysArg * DAY_MS) : null;
  const hits = papers.filter(p => (!cutoff || p._added > cutoff) && matchesCriteria(p, criteria, ctx));
  console.log(`Loaded ${papers.length} recently-added papers (native + FT50).`);
  console.log(`Criteria: ${describeCriteria(criteria)}${daysArg ? ` · last ${daysArg} day(s)` : ''}`);
  console.log(`Matches: ${hits.length}`);
  for (const p of hits.slice(0, 15)) console.log(`  · [${p['Date Added']}] ${p.Journal} ${p.Year} — ${p.Title}`);
  if (hits.length > 15) console.log(`  …and ${hits.length - 15} more`);
}

// ── Feature announcement (maintainer tool) ────────────────────────────────────
// Sends a "what's new" e-mail to everyone who opted into feature updates
// (an alert with criteria.features === true), deduped by recipient. Body is
// supplied at send time; the chrome/footnote is the shared one.
//   node alerts-mailer.mjs --announce --subject="New: Working Papers archive" \
//       --html-file=announce.html [--text-file=announce.txt] [--dry-run]
async function runAnnounce(argv) {
  const dryRun = argv.includes('--dry-run');
  const getArg = (k) => { const a = argv.find(x => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : ''; };
  const subject = getArg('--subject') || 'The Lit: a new feature is available';
  let bodyHtml = getArg('--html'), bodyText = getArg('--text');
  const htmlFile = getArg('--html-file'), textFile = getArg('--text-file');
  try { if (htmlFile) bodyHtml = fs.readFileSync(htmlFile, 'utf8'); } catch (e) { console.error('cannot read --html-file:', e.message); process.exit(2); }
  try { if (textFile) bodyText = fs.readFileSync(textFile, 'utf8'); } catch (e) { console.error('cannot read --text-file:', e.message); process.exit(2); }
  if (!bodyHtml && !bodyText) { console.error('Announce: provide the body via --html/--text or --html-file/--text-file.'); process.exit(2); }
  if (!bodyText) bodyText = String(bodyHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Announce: no Firebase credentials configured — nothing to do.'); return;
  }
  if (!dryRun && !process.env.SMTP_USER) { console.log('Announce: SMTP not configured — nothing to send.'); return; }

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();
  let transport = null;
  if (!dryRun) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const fromName = process.env.ALERTS_FROM_NAME || 'The Lit';
  const fromAddr = process.env.ALERTS_FROM || process.env.SMTP_USER || '';
  const { subject: subj, text, html } = renderAnnouncement({ subject, bodyText, bodyHtml });

  const snap = await db.collectionGroup('alerts').get();
  const seen = new Set(); let sent = 0, skipped = 0, errors = 0;
  for (const doc of snap.docs) {
    const a = doc.data() || {};
    if (a.enabled === false || !a.criteria || a.criteria.features !== true) { skipped++; continue; }
    const recipient = String(a.recipient || a.from || '').trim();
    const key = recipient.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient) || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const msg = {
      from: fromAddr ? `"${fromName}" <${fromAddr}>` : undefined, to: recipient, subject: subj, text, html,
      headers: { 'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Unsubscribe from The Lit updates')}>, <${SITE_URL}>` },
    };
    if (dryRun) { console.log(`  [dry-run] would announce to ${recipient}: "${subj}"`); sent++; continue; }
    try { await transport.sendMail(msg); console.log(`  announced to ${recipient}`); sent++; }
    catch (e) { errors++; console.error(`  ERROR announcing to ${recipient}: ${e && e.message}`); }
  }
  console.log(`Announce done: ${sent} ${dryRun ? 'would-send' : 'sent'}, ${skipped} skipped, ${errors} errors.`);
}

export { matchesCriteria, evaluateAlert, evaluateFeatures, renderEmail, renderAnnouncement, renderFeatureDigest, renderTestEmail, describeCriteria, hasPaperIntent, loadRecentPapers, loadRecentTallies, loadNativeKeys, exactAlertCounts, tallyAnswerable, loadChangelog, makeCtx };

// ── Entry point (only when run directly, not when imported for tests) ─────────
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  if (args.has('--selftest')) { selftest(); }
  else if (args.has('--scan')) { scan(argv); }
  else if (args.has('--announce')) { runAnnounce(argv).catch(e => { console.error(e); process.exit(1); }); }
  else if (args.has('--test-emails')) { sendTestEmails({ dryRun: args.has('--dry-run') }).catch(e => { console.error(e); process.exit(1); }); }
  else if (args.has('--rewind')) { runRewind({ dryRun: args.has('--dry-run') }).catch(e => { console.error(e); process.exit(1); }); }
  else { run({ dryRun: args.has('--dry-run') }).catch(e => { console.error(e); process.exit(1); }); }
}
