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
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const FT50_DIR  = path.join(__dirname, '..', 'data-ft50');
// The feature "changelog" catalogue that drives "New features & updates to the
// website" alerts. Hand-maintained (NOT build output), served at
// stouras.com/fun/lit/changelog.json, and read here from the checkout. Adding an
// entry dated ~today makes the next daily run e-mail it to feature subscribers.
const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.json');
const SITE_URL  = 'https://stouras.com/fun/lit/';
// The ABS satellite shards live in sibling repos, each served from its own Pages
// site at stouras.com/<repo>/data/. They are fetched over HTTP at run time (they
// are NOT in this checkout); missing shards 404 and are skipped, exactly like the
// page's own runtime merge.
const SHARD_BASE  = 'https://stouras.com/';
const SHARD_REPOS = ['lit-data-abs4', 'lit-data-abs3-omecon', 'lit-data-abs3-rest'];
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
  // abs4/abs3/ft50 are exposed (not just closed over) so loadShards() can extend
  // them at runtime with the ABS grades the satellite shards publish.
  return { jtypeKeys, scopeFor, abs4: abs.abs4, abs3: abs.abs3, ft50 };
}

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
  if (c && c.allPapers) return 'any new paper';
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
function loadRecentPapers(extraRows) {
  const rows = [];
  for (const f of [path.join(DATA_DIR, 'recent.json'), path.join(FT50_DIR, 'recent.json')]) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(arr)) for (const p of arr) { p._added = parseAdded(p['Date Added']); if (p._added) rows.push(p); }
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

// ── Feature changelog loading ─────────────────────────────────────────────────
// Reads the hand-maintained feature catalogue (fun/lit/changelog.json). Each
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
  const rows = [];
  for (const repo of SHARD_REPOS) {
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
      if (Array.isArray(arr)) for (const p of arr) { p._added = parseAdded(p['Date Added']); if (p._added) rows.push(p); }
    } catch { /* no shard recent.json → skip this shard */ }
  }
  return rows;
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
  const n = papers.length;
  const shown = papers.slice(0, MAX_LIST);
  const more = n - shown.length;
  const subject = `${opts.subjectPrefix || ''}The Lit: ${n} new paper${n === 1 ? '' : 's'} — ${name}`;

  const lineText = shown.map((p, i) => {
    const bits = [p.Journal, p.Year, p.Status].filter(Boolean).join(' · ');
    let s = `${i + 1}. ${p.Title || '(untitled)'}\n   ${p.Authors || ''}\n   ${bits}\n   ${paperUrl(p)}`;
    const pre = safeUrl(p.Preprint); if (pre) s += `\n   Pre-print (open access): ${pre}`;
    return s;
  }).join('\n\n');
  const text =
`${opts.noteText || ''}${n} new paper${n === 1 ? '' : 's'} matching your alert "${name}" ${n === 1 ? 'was' : 'were'} added to The Lit.
Criteria: ${describeCriteria(alert.criteria || {})}

${lineText}${more > 0 ? `\n\n…and ${more} more. See them all on ${SITE_URL}` : ''}

${footerText()}`;

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
  const inner =
`<p style="font-size:14px;margin:0 0 4px"><strong>${n} new paper${n === 1 ? '' : 's'}</strong> matching your alert
      <strong>${esc(name)}</strong> ${n === 1 ? 'was' : 'were'} added to The Lit.</p>
    <p style="color:#6a5a60;font-size:12.5px;margin:0 0 16px">Criteria: ${esc(describeCriteria(alert.criteria || {}))}</p>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
    ${more > 0 ? `<p style="font-size:13px;margin:14px 0 0">…and ${more} more. <a href="${esc(SITE_URL)}" style="color:#7d1d3f">See them all on The Lit</a>.</p>` : ''}`;
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
  const shardRows = await loadShards(ctx);   // best-effort HTTP; also extends ctx ABS grades
  const papers = loadRecentPapers(shardRows);
  const changelog = loadChangelog();         // drives the "new features & updates" alerts
  const now = new Date();
  console.log(`Loaded ${papers.length} recently-added papers${shardRows.length ? ` (incl. ${shardRows.length} from ABS shards)` : ''} and ${changelog.length} changelog entr${changelog.length === 1 ? 'y' : 'ies'}. now=${now.toISOString()} dryRun=${dryRun}`);

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
        const em = renderEmail(alert, papEval.matches);
        if (dryRun) {
          console.log(`  [dry-run] would e-mail ${recipient}: "${em.subject}" (${papEval.matches.length} paper(s), window since ${papEval.windowStart.toISOString()})`);
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
      if (ok) update.lastFeatureCheckedAt = Timestamp.fromDate(now);
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
  const changelog = loadChangelog();

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

export { matchesCriteria, evaluateAlert, evaluateFeatures, renderEmail, renderAnnouncement, renderFeatureDigest, renderTestEmail, describeCriteria, hasPaperIntent, loadRecentPapers, loadChangelog, makeCtx };

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
