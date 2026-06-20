/**
 * RecentlyAdded builder for the "ManSci Metadata" spreadsheet.
 * ===========================================================================
 *  ADD THIS AS A NEW, SEPARATE SCRIPT FILE.  DO NOT PASTE IT OVER YOUR
 *  EXISTING "MNSC Scraper" CODE — that would delete the whole scraper.
 *
 *  In the sheet: Extensions > Apps Script. Next to "Files" click + > Script,
 *  name it "RecentlyAdded", paste this into that empty file, Save, then run
 *  setUpRecentlyAdded() once and authorise it.
 *
 *  It shares no constant or function names with the MNSC Scraper, so the two
 *  files run side by side in the same project. It defines no onOpen(), so your
 *  existing menu is untouched. After setup, a daily trigger keeps it current.
 * ===========================================================================
 *
 * What it does
 *   1. Keeps a hidden registry that records the FIRST date each paper (by DOI)
 *      was seen in the Data tab. This registry lives in its own sheet, so it
 *      survives the scraper rebuilding/overwriting the Data tab.
 *   2. On the very first run it only records a baseline (the ~12k existing
 *      papers are NOT treated as "just added"); papers that appear afterwards
 *      get stamped with the date they first showed up.
 *   3. Rebuilds a small "RecentlyAdded" tab: the papers first seen in the last
 *      RECENT_WINDOW_DAYS, newest first, with the same columns as Data plus a
 *      "Date Added" column. The website loads this tiny tab instantly instead
 *      of downloading the whole multi-megabyte Data sheet, and shows the ones
 *      from the last 4 weeks.
 *
 * Notes
 *   - It does NOT modify the Data tab.
 *   - "Date Added" is the date the paper first appeared to this script, not a
 *     historical insertion date (which the sheet never recorded). The list
 *     therefore starts EMPTY after setUpRecentlyAdded() and fills in as new
 *     papers arrive. To populate it immediately, run seedRecentlyAddedNow()
 *     once (surfaces the latest papers), or seed specific DOIs via
 *     seedRegistry_().
 */

var DATA_SHEET = 'Data';
var META_SHEET = 'Meta';                    // holds "Last Publication Data Pull"
var RECENT_SHEET = 'RecentlyAdded';        // read by the website
var REGISTRY_SHEET = '_DateAddedRegistry'; // hidden: DOI -> first-seen date
var KEY_HEADER = 'DOI';                     // unique key per paper in Data
var DATE_ADDED_HEADER = 'Date Added';
var RECENT_WINDOW_DAYS = 90;               // buffer; the website filters to 4 weeks
var BASELINE_PROP = 'recentlyAddedBaselined';

/** Run once: installs the daily trigger and records the baseline. */
function setUpRecentlyAdded() {
  if (!hasTrigger_('updateRecentlyAdded')) {
    ScriptApp.newTrigger('updateRecentlyAdded').timeBased().everyDays(1).atHour(5).create();
  }
  updateRecentlyAdded();
}

/**
 * Daily entry point (called by the trigger). You can also call this at the end
 * of your existing updateArticlesInAdvance()/monthlyRefresh() so the tab
 * refreshes the instant new papers land, and/or add a menu item to your onOpen:
 *   .addItem("Update Recently Added", "updateRecentlyAdded")
 */
function updateRecentlyAdded() {
  var data = readData_();
  if (!data) return;
  var registry = updateRegistry_(data);
  buildRecentlyAddedTab_(data, registry);
}

// ── Data ────────────────────────────────────────────────────────────────

function readData_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(DATA_SHEET);
  if (!sh) throw new Error('Sheet "' + DATA_SHEET + '" not found.');
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return null;
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var index = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).trim();
    if (h && !(h in index)) index[h] = c;
  }
  if (!(KEY_HEADER in index)) throw new Error('No "' + KEY_HEADER + '" column in Data.');
  return { headers: headers, rows: values.slice(1), index: index, keyCol: index[KEY_HEADER] };
}

// ── Registry (hidden DOI -> date sheet) ───────────────────────────────────

function registrySheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(REGISTRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REGISTRY_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([['DOI', 'Date Added']]);
    sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setNumberFormat('@'); // keep dates as text
    sh.hideSheet();
  }
  return sh;
}

/** Returns a map { normalisedDOI: 'yyyy-MM-dd' | '' }. */
function readRegistry_() {
  var sh = registrySheet_();
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      var k = normKey_(vals[i][0]);
      if (k) map[k] = dateToStr_(vals[i][1]);
    }
  }
  return map;
}

/**
 * Adds any DOIs from Data that are not yet in the registry. On the first ever
 * run those are recorded with a blank date (baseline = "already here, not
 * new"); on later runs they get today's date. Returns the up-to-date map.
 */
function updateRegistry_(data) {
  var props = PropertiesService.getScriptProperties();
  var baselined = props.getProperty(BASELINE_PROP) === '1';
  var map = readRegistry_();
  var stamp = lastPullDate_(); // stamp new papers with the data-pull date, not today
  var toAppend = [];

  for (var i = 0; i < data.rows.length; i++) {
    var doi = normKey_(data.rows[i][data.keyCol]);
    if (!doi || (doi in map)) continue;
    var ds = baselined ? stamp : '';
    map[doi] = ds;
    toAppend.push([doi, ds]);
  }

  if (toAppend.length) {
    var sh = registrySheet_();
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 2).setValues(toAppend);
  }
  if (!baselined) props.setProperty(BASELINE_PROP, '1');
  return map;
}

// ── RecentlyAdded tab ─────────────────────────────────────────────────────

function buildRecentlyAddedTab_(data, registry) {
  var cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);

  // Columns to copy from Data: all except any pre-existing "Date Added" column
  // (we append our own authoritative one, so the output never duplicates it).
  var keep = [];
  for (var c = 0; c < data.headers.length; c++) {
    if (String(data.headers[c]).trim() !== DATE_ADDED_HEADER) keep.push(c);
  }

  var idx = pubIdx_(data);
  var picked = [];
  for (var i = 0; i < data.rows.length; i++) {
    var doi = normKey_(data.rows[i][data.keyCol]);
    if (!doi) continue;
    var d = parseDate_(registry[doi]);
    if (d && d >= cutoff) picked.push({ d: d, row: data.rows[i], rank: pubRank_(data.rows[i], idx) });
  }
  // Newest added first; within the same Date Added, newest published first (so a
  // batch sharing one pull date still reads Articles-in-Advance -> latest issue).
  picked.sort(function(a, b) { return (b.d - a.d) || (b.rank - a.rank); });

  var header = [];
  for (var h = 0; h < keep.length; h++) header.push(data.headers[keep[h]]);
  header.push(DATE_ADDED_HEADER);

  var out = [header];
  for (var j = 0; j < picked.length; j++) {
    var row = [];
    for (var k = 0; k < keep.length; k++) row.push(picked[j].row[keep[k]]);
    row.push(dateToStr_(picked[j].d));
    out.push(row);
  }

  var ss = SpreadsheetApp.getActive();
  var rec = ss.getSheetByName(RECENT_SHEET) || ss.insertSheet(RECENT_SHEET);
  rec.clear(); // wipe old contents (incl. any stray extra column) before rewriting
  rec.getRange(1, 1, out.length, out[0].length).setValues(out);
}

// ── One-time bootstrap: surface the latest papers right away ───────────────
// The list is empty until new papers are scraped (the sheet never recorded
// historical add-dates). Run seedRecentlyAddedNow() ONCE to seed it with the
// most recent SEED_COUNT papers (Articles in Advance first, then latest
// year/volume/issue), all stamped with the last data-pull date so the dates
// match the header. Going forward, genuinely new papers are tracked
// automatically (also stamped with the data-pull date).
var SEED_COUNT = 40;

function seedRecentlyAddedNow() {
  var data = readData_();
  if (!data) return;
  var idx = pubIdx_(data);

  var list = [];
  for (var r = 0; r < data.rows.length; r++) {
    var doi = normKey_(data.rows[r][data.keyCol]);
    if (!doi) continue;
    list.push({ doi: doi, rank: pubRank_(data.rows[r], idx) });
  }
  list.sort(function(a, b) { return b.rank - a.rank; }); // newest published first

  var stamp = lastPullDate_(); // align "Date Added" with the data-pull date
  var map = readRegistry_();
  var pick = list.slice(0, SEED_COUNT);
  for (var k = 0; k < pick.length; k++) map[pick[k].doi] = stamp;
  writeRegistry_(map);
  buildRecentlyAddedTab_(data, map);
}

// Rewrite the whole registry sheet from a { doi: dateStr } map.
function writeRegistry_(map) {
  var sh = registrySheet_();
  var keys = Object.keys(map);
  var out = [['DOI', 'Date Added']];
  for (var i = 0; i < keys.length; i++) out.push([keys[i], map[keys[i]]]);
  sh.clearContents();
  sh.getRange(1, 1, out.length, 2).setValues(out);
}

// ── Optional: seed specific papers so the list isn't empty at first ─────────
// Edit the DOIs/date below and run once if you want a few papers to show
// immediately. Use the exact DOI strings from the Data tab's DOI column.
function seedRegistry_() {
  var seeds = [
    // ['https://doi.org/10.1287/mnsc.XXXX', '2026-06-01'],
  ];
  if (!seeds.length) return;
  var sh = registrySheet_();
  var map = readRegistry_();
  var append = [];
  for (var i = 0; i < seeds.length; i++) {
    var k = normKey_(seeds[i][0]);
    if (k && !(k in map)) { append.push([seeds[i][0], seeds[i][1]]); map[k] = seeds[i][1]; }
  }
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, 2).setValues(append);
}

// ── small helpers ─────────────────────────────────────────────────────────

function normKey_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Date of the most recent Crossref pull, read from the Meta tab (the same value
// the website shows as "Last publication data pull"). Used to stamp newly seen
// papers so "Date Added" matches when the data was actually pulled. Falls back
// to today if the Meta row is missing/unreadable.
function lastPullDate_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(META_SHEET);
  if (sh) {
    var vals = sh.getDataRange().getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === 'Last Publication Data Pull') {
        var d = parseDate_(vals[i][1]);
        if (d) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
    }
  }
  return todayStr_();
}

// Column indices used to rank papers by publication recency.
function pubIdx_(data) {
  return {
    y: data.index['Year'], v: data.index['Volume'], i: data.index['Issue'],
    p: data.index['Page'], s: (data.index['Status'] != null ? data.index['Status'] : -1)
  };
}

// A single sortable number where higher = more recent: Articles in Advance
// rank highest, then by year, volume, issue, page.
function pubRank_(row, idx) {
  var aia = (idx.s >= 0 && String(row[idx.s]).trim() === 'Articles in Advance') ? 1 : 0;
  var y = parseInt(row[idx.y], 10) || 0;
  var v = parseInt(row[idx.v], 10) || 0;
  var iss = parseInt(row[idx.i], 10) || 0;
  var p = parseInt(row[idx.p], 10) || 0;
  return aia * 1e13 + y * 1e9 + v * 1e6 + Math.min(iss, 999) * 1e3 + Math.min(p, 999);
}

function dateToStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function parseDate_(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function hasTrigger_(fn) {
  return ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === fn; });
}
