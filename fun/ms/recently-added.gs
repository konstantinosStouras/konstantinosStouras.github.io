/**
 * RecentlyAdded builder for the "ManSci Metadata" spreadsheet.
 * ---------------------------------------------------------------------------
 * Paste this whole file into the bound Apps Script project
 * (in the sheet: Extensions > Apps Script), Save, then run setUp() once and
 * authorise it. After that a daily trigger keeps everything current.
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
 *     therefore starts empty and fills in as new papers arrive. To show some
 *     papers immediately you can seed the registry by hand (see seedRegistry_).
 */

var DATA_SHEET = 'Data';
var RECENT_SHEET = 'RecentlyAdded';        // read by the website
var REGISTRY_SHEET = '_DateAddedRegistry'; // hidden: DOI -> first-seen date
var KEY_HEADER = 'DOI';                     // unique key per paper in Data
var DATE_ADDED_HEADER = 'Date Added';
var RECENT_WINDOW_DAYS = 90;               // buffer; the website filters to 4 weeks
var BASELINE_PROP = 'recentlyAddedBaselined';

/** Run once: installs the daily trigger and records the baseline. */
function setUp() {
  if (!hasTrigger_('updateRecentlyAdded')) {
    ScriptApp.newTrigger('updateRecentlyAdded').timeBased().everyDays(1).atHour(5).create();
  }
  updateRecentlyAdded();
}

/** Daily entry point. Safe to also call at the end of your scrape run. */
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
  var today = todayStr_();
  var toAppend = [];

  for (var i = 0; i < data.rows.length; i++) {
    var doi = normKey_(data.rows[i][data.keyCol]);
    if (!doi || (doi in map)) continue;
    var ds = baselined ? today : '';
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

  var picked = [];
  for (var i = 0; i < data.rows.length; i++) {
    var doi = normKey_(data.rows[i][data.keyCol]);
    if (!doi) continue;
    var d = parseDate_(registry[doi]);
    if (d && d >= cutoff) picked.push({ d: d, row: data.rows[i] });
  }
  picked.sort(function(a, b) { return b.d - a.d; });

  var out = [data.headers.concat([DATE_ADDED_HEADER])];
  for (var j = 0; j < picked.length; j++) {
    out.push(picked[j].row.concat([dateToStr_(picked[j].d)]));
  }

  var ss = SpreadsheetApp.getActive();
  var rec = ss.getSheetByName(RECENT_SHEET) || ss.insertSheet(RECENT_SHEET);
  rec.clearContents();
  rec.getRange(1, 1, out.length, out[0].length).setValues(out);
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
