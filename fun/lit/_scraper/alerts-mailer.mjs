#!/usr/bin/env node
/*
 * The Lit — e-mail alerts mailer
 * ==============================
 *
 * Sends the e-mails behind the "E-mail alerts" panel on stouras.com/fun/lit/.
 * A static GitHub Pages site can't send mail, so this runs as a scheduled job
 * (see .github/workflows/lit-alerts-mail.yml). It:
 *
 *   1. Loads the papers ADDED to the database recently, from the same files the
 *      site's "Recently added papers" view uses: fun/lit/data/recent.json and
 *      fun/lit/data-ft50/recent.json (each row carries a "Date Added").
 *   2. Reads every user's saved alerts with the Firebase Admin SDK
 *      (collectionGroup('alerts')), which bypasses the Firestore rules.
 *   3. Matches the new papers against each alert's `criteria`, reusing the exact
 *      filter semantics from fun/lit/index.html (journal-type expansion,
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
 * MATCHING FIDELITY: the journal-list sets and the textMatch/authorMatch
 * helpers below are vendored copies of the ones in fun/lit/index.html — keep
 * them in sync if the page's filtering changes. Coverage is the eight native
 * sources + the FT50 catalog (the two recent.json files in this repo). The ABS
 * satellite shards (separate repos) are not scanned here yet.
 *
 * Env / secrets (all via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465),
 *   SMTP_SECURE (default true when port 465), SMTP_USER, SMTP_PASS,
 *   ALERTS_FROM (default SMTP_USER), ALERTS_FROM_NAME (default "The Lit").
 *
 * Modes:
 *   node alerts-mailer.mjs              real run (reads Firestore, sends mail)
 *   node alerts-mailer.mjs --dry-run    reads Firestore, prints instead of sending
 *   node alerts-mailer.mjs --selftest   runs the matching/rendering self-tests
 *                                        (no network, no deps needed) and exits
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const FT50_DIR  = path.join(__dirname, '..', 'data-ft50');
const SITE_URL  = 'https://stouras.com/fun/lit/';
// Maintainer contact surfaced in every alert e-mail (help / feedback, and the
// List-Unsubscribe mailto). Keep in sync with the Feedback modal in index.html.
const CONTACT_EMAIL = 'kostas.stouras@ucd.ie';

// ── Vendored journal-list constants (keep in sync with fun/lit/index.html) ────
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

// ── Matching helpers (vendored from fun/lit/index.html) ───────────────────────
function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function textMatch(haystack, query) {
  if (!query) return true;
  const m = query.match(/^"(.*)"$/);
  if (!m) return haystack.indexOf(query) !== -1;      // unquoted → substring
  const phrase = m[1].trim();
  if (!phrase) return true;
  return new RegExp('\\b' + escRegex(phrase) + '\\b').test(haystack);
}
function authorMatch(haystack, query) {
  if (!query) return true;
  if (query.charAt(0) === '"') return textMatch(haystack, query);
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

// Journal keys a paper matches (its own key + PNAS section keys).
function paperJKeys(p) {
  const keys = [p.JKey || ''];
  if (p.JKey === 'pnas' && Array.isArray(p.Sections)) {
    for (const s of p.Sections) { const k = PNAS_SECTION_KEYS[s]; if (k) keys.push(k); }
  }
  return keys.filter(Boolean);
}

function makeCtx() {
  const ft50 = loadFt50Keys();
  const abs = absSets();
  const jtypeKeys = (t) => {
    if (t === 'utd24') return UTD24_KEYS;
    if (t === 'ft50')  return ft50;
    if (t === 'abs4')  return abs.abs4;
    if (t === 'abs3')  return abs.abs3;
    return new Set();
  };
  const scopeFor = (c) => {
    const hasJ = (c.journal || []).length, hasT = (c.jtype || []).length;
    if (!hasJ && !hasT) return null;                    // no journal restriction
    const s = new Set(c.journal || []);
    for (const t of (c.jtype || [])) for (const k of jtypeKeys(t)) s.add(k);
    return s;
  };
  return { jtypeKeys, scopeFor };
}

// True if a paper satisfies an alert's criteria. Mirrors applyFilters():
// journal scope + pre-print + year/editor/area/se/ae (OR within field) +
// title/abstract/affiliation (textMatch, AND) + author (authorMatch, AND).
function matchesCriteria(p, c, ctx) {
  const scope = ctx.scopeFor(c);
  if (scope && !paperJKeys(p).some(k => scope.has(k))) return false;
  if (c.preprintOnly && !safeUrl(p.Preprint)) return false;

  if ((c.year || []).length && !c.year.includes(String(p.Year || ''))) return false;

  const ciEq = (arr, val) => { const v = String(val || '').trim().toLowerCase(); return arr.some(x => String(x).trim().toLowerCase() === v); };
  const ciAny = (arr, list) => list.some(v => ciEq(arr, v));
  if ((c.editor || []).length && !ciEq(c.editor, p['Accepting Editor'])) return false;
  if ((c.area   || []).length && !ciEq(c.area,   p['Area'])) return false;
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
  const JTL = { utd24: 'UTD24', ft50: 'FT50', abs4: 'ABS 4/4*', abs3: 'ABS 3' };
  const parts = [];
  (c.jtype || []).forEach(t => parts.push(JTL[t] || t));
  (c.journal || []).forEach(k => parts.push(k));
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
function loadRecentPapers() {
  const rows = [];
  for (const f of [path.join(DATA_DIR, 'recent.json'), path.join(FT50_DIR, 'recent.json')]) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(arr)) for (const p of arr) { p._added = parseAdded(p['Date Added']); if (p._added) rows.push(p); }
    } catch { /* missing file → skip */ }
  }
  // De-dup by DOI (a paper should not appear in both files, but be safe).
  const seen = new Set(), out = [];
  for (const p of rows) {
    const k = (p.DOI || (p.Title + '|' + p.Year)).toLowerCase();
    if (seen.has(k)) continue; seen.add(k); out.push(p);
  }
  out.sort((a, b) => b._added - a._added);
  return out;
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
function renderEmail(alert, papers) {
  const name = alert.name || describeCriteria(alert.criteria || {});
  const n = papers.length;
  const shown = papers.slice(0, MAX_LIST);
  const more = n - shown.length;
  const subject = `The Lit: ${n} new paper${n === 1 ? '' : 's'} — ${name}`;

  const lineText = shown.map((p, i) => {
    const bits = [p.Journal, p.Year, p.Status].filter(Boolean).join(' · ');
    let s = `${i + 1}. ${p.Title || '(untitled)'}\n   ${p.Authors || ''}\n   ${bits}\n   ${paperUrl(p)}`;
    const pre = safeUrl(p.Preprint); if (pre) s += `\n   Pre-print (open access): ${pre}`;
    return s;
  }).join('\n\n');
  const text =
`${n} new paper${n === 1 ? '' : 's'} matching your alert "${name}" ${n === 1 ? 'was' : 'were'} added to The Lit.
Criteria: ${describeCriteria(alert.criteria || {})}

${lineText}${more > 0 ? `\n\n…and ${more} more. See them all on ${SITE_URL}` : ''}

—
You set up this e-mail alert on The Lit (${SITE_URL}).
· Update it (journals, filters, frequency): open the "E-mail alerts" panel there.
· Unsubscribe: open "E-mail alerts" and pause or delete this alert.
· Questions, help or feedback: ${CONTACT_EMAIL}`;

  const items = shown.map(p => {
    const bits = [p.Journal, p.Year, p.Status].filter(Boolean).filter(x => x).map(esc).join(' · ');
    const pre = safeUrl(p.Preprint);
    return `<li style="margin:0 0 16px">
      <a href="${esc(paperUrl(p))}" style="color:#7d1d3f;font-weight:600;text-decoration:none;font-size:15px">${esc(p.Title || '(untitled)')}</a>
      <div style="color:#241a1e;font-size:13px;margin-top:2px">${esc(p.Authors || '')}</div>
      <div style="color:#6a5a60;font-size:12px;margin-top:2px">${bits}</div>
      ${pre ? `<div style="font-size:12px;margin-top:2px"><a href="${esc(pre)}" style="color:#c2410c">Pre-print (open access)</a></div>` : ''}
    </li>`;
  }).join('');
  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#241a1e">
  <div style="background:linear-gradient(135deg,#7d1d3f,#591428);padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="color:#fff;font-size:20px"><span style="color:#c9a24b;font-style:italic">The Lit</span> — new papers</div>
  </div>
  <div style="border:1px solid #dce1ea;border-top:none;border-radius:0 0 10px 10px;padding:20px 22px">
    <p style="font-size:14px;margin:0 0 4px"><strong>${n} new paper${n === 1 ? '' : 's'}</strong> matching your alert
      <strong>${esc(name)}</strong> ${n === 1 ? 'was' : 'were'} added to The Lit.</p>
    <p style="color:#6a5a60;font-size:12.5px;margin:0 0 16px">Criteria: ${esc(describeCriteria(alert.criteria || {}))}</p>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
    ${more > 0 ? `<p style="font-size:13px;margin:14px 0 0">…and ${more} more. <a href="${esc(SITE_URL)}" style="color:#7d1d3f">See them all on The Lit</a>.</p>` : ''}
    <hr style="border:none;border-top:1px solid #dce1ea;margin:20px 0 12px">
    <p style="color:#6a5a60;font-size:11.5px;margin:0 0 6px">You set up this e-mail alert on
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f">The Lit</a>.</p>
    <p style="color:#6a5a60;font-size:11.5px;margin:0;line-height:1.8">
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Update this alert</a> (journals, filters, frequency) &nbsp;·&nbsp;
      <a href="${esc(SITE_URL)}" style="color:#7d1d3f;font-weight:600">Unsubscribe</a> (pause or delete it in the “E-mail alerts” panel) &nbsp;·&nbsp;
      <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#7d1d3f;font-weight:600">Questions or feedback</a></p>
  </div>
</div>`;
  return { subject, text, html };
}

// ── Frequency gating ──────────────────────────────────────────────────────────
const FREQ_MIN_DAYS = { immediate: 0, daily: 0, weekly: 6.5, monthly: 27.5 };
const DAY_MS = 86400000;

// Compute what to do for one alert given `now` and the recent papers.
// Returns { due, matches, windowStart }.
function evaluateAlert(alert, papers, now, ctx) {
  const freq = FREQ_MIN_DAYS[alert.frequency] != null ? alert.frequency : 'weekly';
  const last = toDate(alert.lastCheckedAt);
  const created = toDate(alert.createdAt);
  let windowStart;
  if (last) windowStart = last;
  else {
    // First evaluation: look back from creation, but cap the first window so a
    // brand-new alert never blasts a big backlog.
    const base = created || new Date(now.getTime() - 31 * DAY_MS);
    const cap = new Date(now.getTime() - 31 * DAY_MS);
    windowStart = base > cap ? base : cap;
  }
  const elapsedDays = (now - windowStart) / DAY_MS;
  const due = elapsedDays >= (FREQ_MIN_DAYS[freq] - 0.05);   // small slack for cron jitter
  if (!due) return { due: false, matches: [], windowStart };
  const matches = papers.filter(p => p._added > windowStart && p._added <= now && matchesCriteria(p, alert.criteria || {}, ctx));
  return { due: true, matches, windowStart };
}
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();      // Firestore Timestamp
  if (v instanceof Date) return v;
  const d = new Date(v); return isNaN(d) ? null : d;
}

// ── Real run ──────────────────────────────────────────────────────────────────
async function run({ dryRun }) {
  // Until the secrets are configured, no-op cleanly so the scheduled workflow
  // stays green instead of failing. See fun/lit/_EMAIL-ALERTS-SETUP.md.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Alerts mailer: no Firebase credentials configured — nothing to do. Add the FIREBASE_SERVICE_ACCOUNT secret to enable.');
    return;
  }
  if (!dryRun && !process.env.SMTP_USER) {
    console.log('Alerts mailer: SMTP not configured (no SMTP_USER) — nothing to send. Add the SMTP_* secrets to enable.');
    return;
  }

  const ctx = makeCtx();
  const papers = loadRecentPapers();
  const now = new Date();
  console.log(`Loaded ${papers.length} recently-added papers. now=${now.toISOString()} dryRun=${dryRun}`);

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();   // GOOGLE_APPLICATION_CREDENTIALS / ADC
  }
  const db = admin.firestore();
  const Timestamp = admin.firestore.Timestamp;

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

  let sent = 0, matched = 0, skipped = 0, errors = 0;
  for (const doc of snap.docs) {
    const alert = doc.data() || {};
    if (alert.enabled === false) { skipped++; continue; }
    const recipient = String(alert.recipient || alert.from || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) { skipped++; continue; }

    const { due, matches, windowStart } = evaluateAlert(alert, papers, now, ctx);
    if (!due) { skipped++; continue; }

    const update = { lastCheckedAt: Timestamp.fromDate(now) };
    if (matches.length) {
      matched += matches.length;
      const { subject, text, html } = renderEmail(alert, matches);
      const msg = {
        from: fromAddr ? `"${fromName}" <${fromAddr}>` : undefined,
        to: recipient,
        replyTo: (alert.from && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alert.from)) ? alert.from : undefined,
        subject, text, html,
        // Standards-based unsubscribe (RFC 2369): mail clients surface a native
        // "Unsubscribe" button — a mailto to the maintainer plus the manage page.
        headers: {
          'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Unsubscribe from The Lit alert: ' + (alert.name || ''))}>, <${SITE_URL}>`,
        },
      };
      if (dryRun) {
        console.log(`  [dry-run] would e-mail ${recipient}: "${subject}" (${matches.length} paper(s), window since ${windowStart.toISOString()})`);
      } else {
        try {
          await transport.sendMail(msg);
          console.log(`  sent to ${recipient}: "${subject}" (${matches.length})`);
          update.lastSentAt = Timestamp.fromDate(now);
          update.lastSentCount = matches.length;
          sent++;
        } catch (e) {
          errors++;
          console.error(`  ERROR e-mailing ${recipient}: ${e && e.message}`);
          continue;   // don't advance lastCheckedAt on send failure — retry next run
        }
      }
    } else {
      console.log(`  no new matches for "${alert.name || describeCriteria(alert.criteria || {})}" (${alert.frequency || 'weekly'})`);
    }
    if (!dryRun) { try { await doc.ref.set(update, { merge: true }); } catch (e) { console.error('  state update failed:', e && e.message); } }
  }
  console.log(`Done. alerts due processed; e-mails sent=${sent}, papers matched=${matched}, skipped=${skipped}, errors=${errors}.`);
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

  // e-mail rendering
  const em = renderEmail({ name: 'FT50 · pre-prints', criteria: { jtype: ['ft50'], preprintOnly: true } },
                         [P({ Preprint: 'https://arxiv.org/abs/2410.13767' })]);
  ok('subject has count + name', /1 new paper — FT50/.test(em.subject));
  ok('html has paper title', em.html.includes('platform markets'));
  ok('html has preprint link', em.html.includes('arxiv.org/abs/2410.13767'));
  ok('text has manage note', em.text.includes('E-mail alerts'));
  ok('text footer has update/unsubscribe/feedback', /Update it/.test(em.text) && /Unsubscribe/.test(em.text) && em.text.includes(CONTACT_EMAIL));
  ok('html footer has update/unsubscribe/feedback', /Update this alert/.test(em.html) && /Unsubscribe/.test(em.html) && em.html.includes('mailto:' + CONTACT_EMAIL));
  ok('html escapes', renderEmail({ name: 'x', criteria: {} }, [P({ Title: 'A <b> & "q"' })]).html.includes('A &lt;b&gt; &amp; &quot;q&quot;'));

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

export { matchesCriteria, evaluateAlert, renderEmail, describeCriteria, loadRecentPapers, makeCtx };

// ── Entry point (only when run directly, not when imported for tests) ─────────
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  if (args.has('--selftest')) { selftest(); }
  else if (args.has('--scan')) { scan(argv); }
  else { run({ dryRun: args.has('--dry-run') }).catch(e => { console.error(e); process.exit(1); }); }
}
