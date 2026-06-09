/**
 * The Problem-Solving Trap — Google Apps Script backend
 * Author: Prof. Kostas Stouras, UCD Smurfit Graduate Business School
 *
 * Paste this into the Responses spreadsheet:  Extensions → Apps Script.
 * Then deploy as a Web app (Execute as: Me, Who has access: Anyone) and put
 * the /exec URL into index.html's GOOGLE_SCRIPT_URL constant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY COLUMN K USED TO STAY EMPTY ON NEW ROWS
 * ─────────────────────────────────────────────────────────────────────────
 *  The web app writes each submission with sheet.appendRow(...) inside
 *  doPost(). Rows added that way are NOT a Google Form submission and NOT a
 *  manual edit, so the onFormSubmit / onEdit triggers never fire for them —
 *  Column K (Creativity index) was therefore only filled when someone ran the
 *  "Creativity" menu by hand.
 *
 *  THE FIX: doPost() now calls computeSequenceDiversity() itself, right after
 *  appending the row, so Column K is recomputed on every single submission.
 *  The onFormSubmit / onChange triggers are kept as a harmless backstop.
 * ─────────────────────────────────────────────────────────────────────────
 */

// Tab that stores submissions. Change if your sheet uses a different name.
var RESPONSES_SHEET = 'Responses';

// Seed sequence shown to every player. Prepended to each player's set so the
// creativity score measures how far they explored away from the example.
var SEED = [2, 4, 8];

// Column index of the Creativity index (%). A=1 ... K=11.
var CREATIVITY_COL = 11;

// First data row (row 1 is the header).
var FIRST_DATA_ROW = 2;

// Columns that hold the tested sequences "(a, b, c); (d, e, f)".
var YES_SEQ_COL = 7; // G
var NO_SEQ_COL  = 8; // H


/* ============================================================
 *  WEB APP ENDPOINTS
 * ============================================================ */

/**
 * Receives a game submission from index.html and appends it as a new row,
 * then immediately recomputes Column K for the whole sheet.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESPONSES_SHEET);

    // A–H. Column I (Notes) is left for manual entry; J ("Got it right?") is a
    // sheet-side MAP formula; K is computed below.
    sheet.appendRow([
      data.timestamp || new Date(),  // A  Timestamp
      data.numAttempts,              // B  Number of attempts
      data.yeses,                    // C  Yeses
      data.nos,                      // D  Nos
      data.rule,                     // E  What's the rule?
      data.confidence,               // F  Confidence level
      data.yesSequences || '—',      // G  Yes sequences
      data.noSequences  || '—'       // H  No sequences
    ]);

    // ★ THE FIX ★ — recompute Column K now, because appendRow does not fire
    // onFormSubmit / onEdit. Wrapped so a calc hiccup never fails the write.
    try {
      computeSequenceDiversity();
    } catch (calcErr) {
      console.error('Creativity recompute failed: ' + calcErr);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Fallback analysis endpoint (the client prefers the published CSV and only
 * calls this if the CSV fetch fails). Returns lightweight aggregates.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'getAnalysis') {
    return ContentService
      .createTextOutput(JSON.stringify(getAnalysisData()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
 *  CREATIVITY INDEX (Column K)
 * ============================================================ */

/**
 * Computes the creativity index for every player and writes Column K.
 * Score per player = avgPairwiseDistance(features) × log2(numSequences),
 * then normalized so the most exploratory player scores 100%.
 */
function computeSequenceDiversity() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESPONSES_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  var numRows = lastRow - FIRST_DATA_ROW + 1;

  // Read sequence columns G and H in one batch.
  var yesVals = sheet.getRange(FIRST_DATA_ROW, YES_SEQ_COL, numRows, 1).getValues();
  var noVals  = sheet.getRange(FIRST_DATA_ROW, NO_SEQ_COL,  numRows, 1).getValues();

  var rawScores = new Array(numRows);
  var maxRaw = 0;

  for (var i = 0; i < numRows; i++) {
    var seqs = parseSequencesForDiversity(yesVals[i][0])
                 .concat(parseSequencesForDiversity(noVals[i][0]));

    if (seqs.length === 0) {
      rawScores[i] = null; // nothing tested → leave Column K blank
      continue;
    }

    // Prepend the seed so we measure exploration relative to the example.
    var all = [SEED].concat(seqs);
    var feats = all.map(function (s) { return sequenceFeatures(s[0], s[1], s[2]); });

    var total = 0, pairs = 0;
    for (var a = 0; a < feats.length; a++) {
      for (var b = a + 1; b < feats.length; b++) {
        total += euclidean(feats[a], feats[b]);
        pairs++;
      }
    }
    var avgDist = pairs > 0 ? total / pairs : 0;
    var volumeWeight = Math.log(all.length) / Math.LN2; // log2(n)
    var raw = avgDist * volumeWeight;

    rawScores[i] = raw;
    if (raw > maxRaw) maxRaw = raw;
  }

  // Normalize to 0–100 (best player = 100%) and write Column K in one batch.
  var out = new Array(numRows);
  for (var k = 0; k < numRows; k++) {
    if (rawScores[k] === null) {
      out[k] = [''];
    } else if (maxRaw > 0) {
      out[k] = [Math.round(rawScores[k] / maxRaw * 100)];
    } else {
      out[k] = [0];
    }
  }
  sheet.getRange(FIRST_DATA_ROW, CREATIVITY_COL, numRows, 1).setValues(out);
}

/**
 * 10-dimensional feature vector for a sequence (a, b, c).
 * Mirrors computeLocalCreativity()'s seqFeatures() in index.html exactly.
 */
function sequenceFeatures(a, b, c) {
  var d1 = b - a, d2 = c - b;
  var mean = (a + b + c) / 3;
  var spread = Math.max(a, b, c) - Math.min(a, b, c);
  return [
    (d1 > 0 && d2 > 0) ? 1 : 0,                                   // increasing
    (d1 < 0 && d2 < 0) ? 1 : 0,                                   // decreasing
    (d1 === 0 && d2 === 0) ? 1 : 0,                               // constant
    ((d1 > 0) !== (d2 > 0) && d1 !== 0 && d2 !== 0) ? 1 : 0,      // non-monotonic
    (Math.min(a, b, c) < 0) ? 1 : 0,                             // uses negatives
    (a === 0 || b === 0 || c === 0) ? 1 : 0,                     // uses zero
    Math.log(1 + spread) / 7,                                     // log spread
    Math.log(1 + Math.abs(mean)) / 7,                             // log magnitude
    (Math.abs(d1) + Math.abs(d2)) > 0
      ? (d2 / (Math.abs(d1) + Math.abs(d2))) * 0.5 + 0.5 : 0.5,   // gap ratio
    spread > 0 ? (b - Math.min(a, b, c)) / spread : 0.5           // asymmetry
  ];
}

/** Euclidean distance between two equal-length feature vectors. */
function euclidean(p, q) {
  var s = 0;
  for (var i = 0; i < p.length; i++) {
    var d = p[i] - q[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Parses a cell like "(3, 6, 12); (4, 8, 16)" into [[3,6,12],[4,8,16]].
 * Ignores blanks / the "—" placeholder and any malformed group.
 */
function parseSequencesForDiversity(cell) {
  if (cell === null || cell === undefined) return [];
  var str = String(cell).trim();
  if (str === '' || str === '—' || str === '-') return [];

  var out = [];
  var groups = str.match(/\(([^)]*)\)/g);
  if (!groups) return [];

  groups.forEach(function (g) {
    var nums = g.replace(/[()]/g, '')
                .split(',')
                .map(function (x) { return parseFloat(x.trim()); })
                .filter(function (x) { return !isNaN(x); });
    if (nums.length === 3) out.push(nums);
  });
  return out;
}


/* ============================================================
 *  SPREADSHEET MENU + TRIGGER BACKSTOP
 * ============================================================ */

/** Adds a "Creativity" menu so K can also be recomputed manually. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Creativity')
    .addItem('Recompute creativity index (Column K)', 'computeSequenceDiversity')
    .addToUi();
}

/**
 * Backstop trigger: recompute K if rows ever arrive via a linked Google Form.
 * (Web-app submissions are handled directly inside doPost.)
 */
function onFormSubmit(e) {
  computeSequenceDiversity();
}

/**
 * Optional installable trigger. Install via Triggers → Add Trigger →
 * onChangeRecompute → "On change" to also catch manual row insertions.
 */
function onChangeRecompute(e) {
  computeSequenceDiversity();
}


/* ============================================================
 *  FALLBACK ANALYTICS (only used if the published CSV is unreachable)
 * ============================================================ */

function getAnalysisData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESPONSES_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    return { totalPlayers: 0 };
  }

  var numRows = lastRow - FIRST_DATA_ROW + 1;
  var rng = sheet.getRange(FIRST_DATA_ROW, 1, numRows, CREATIVITY_COL).getValues();

  var totalPlayers = 0;
  var attemptsSum = 0, nosSum = 0, confSum = 0, creativitySum = 0, creativityN = 0;
  var neverNo = 0;

  rng.forEach(function (r) {
    var attempts = Number(r[1]); // B
    if (!attempts) return;       // skip blank rows
    totalPlayers++;
    attemptsSum += attempts;
    var nos = Number(r[3]) || 0; // D
    nosSum += nos;
    if (nos === 0) neverNo++;
    confSum += Number(r[5]) || 0; // F
    var cr = Number(r[10]);       // K
    if (!isNaN(cr) && r[10] !== '') { creativitySum += cr; creativityN++; }
  });

  return {
    totalPlayers: totalPlayers,
    avgAttempts: totalPlayers ? attemptsSum / totalPlayers : 0,
    avgNos: totalPlayers ? nosSum / totalPlayers : 0,
    avgConfidence: totalPlayers ? confSum / totalPlayers : 0,
    neverNo: neverNo,
    avgCreativity: creativityN ? creativitySum / creativityN : 0,
    hasCreativityData: creativityN > 0
  };
}
