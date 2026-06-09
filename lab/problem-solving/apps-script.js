/**
 * The Problem-Solving Trap — Google Apps Script backend
 * Author: Prof. Kostas Stouras, UCD Smurfit Graduate Business School
 *
 * Paste this into the Responses spreadsheet:  Extensions → Apps Script.
 * Then DEPLOY A NEW VERSION:  Deploy → Manage deployments → (edit) →
 * Version: "New version" → Deploy.  The web app keeps serving the old code
 * until a new version is published — this is the #1 reason a fix "doesn't
 * take" in production.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY COLUMN K (Creativity index) WASN'T UPDATING ON NEW ROWS
 * ─────────────────────────────────────────────────────────────────────────
 *  The score is normalized so the most exploratory player scores 100%
 *  (K = round(rawScore / maxScore * 100)). The previous version only WROTE K
 *  for rows whose K cell was still empty and kept every other row frozen.
 *  As soon as a new submission raised maxScore, all earlier rows became stale
 *  and were never rewritten — and if the live web app was still serving an
 *  older deployment (one that predated the computeSequenceDiversity() call in
 *  doPost), the new row got no K at all.
 *
 *  FIX: computeSequenceDiversity() now recomputes AND rewrites the entire K
 *  column on every call, so a new row both gets its own value and refreshes
 *  everyone else's normalization. The UI alert was also moved out of the
 *  shared compute function (it throws in the doPost/trigger context where
 *  there is no UI) into a separate menu wrapper.
 * ─────────────────────────────────────────────────────────────────────────
 */

var SEED_SEQUENCE = [2, 4, 8];

// ============================================================
// HELPER — find the actual last row with data in column A
// ============================================================
function findLastDataRow(sheet) {
  var colA = sheet.getRange('A1:A' + sheet.getMaxRows()).getValues();
  for (var i = colA.length - 1; i >= 0; i--) {
    if (colA[i][0] !== '' && colA[i][0] != null) {
      return i + 1;
    }
  }
  return 1;
}

// ============================================================
// doPost — receives game submissions from the web app
// ============================================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Responses");
    var data  = JSON.parse(e.postData.contents);

    var nextRow = findLastDataRow(sheet) + 1;

    sheet.getRange(nextRow, 1, 1, 8).setValues([[
      data.timestamp,
      data.numAttempts,
      data.yeses,
      data.nos,
      data.rule,
      data.confidence,
      data.yesSequences,
      data.noSequences
    ]]);

    SpreadsheetApp.flush();

    // Recompute Column K. appendRow/setValues do NOT fire onFormSubmit or
    // onEdit, so this must run here for K to update on every submission.
    try {
      computeSequenceDiversity();
    } catch (diversityErr) {
      Logger.log('Diversity computation failed: ' + diversityErr.toString());
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", row: nextRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// doGet — serves analysis data to the web app
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  if (action === 'getAnalysis') {
    return getAnalysisData();
  }

  return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// getAnalysisData — computes distribution + insights JSON
// ============================================================
function getAnalysisData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Responses');
  var data = sheet.getDataRange().getValues();

  var rows = data.slice(1).filter(function(r) { return r[1] !== '' && r[1] != null; });

  var totalStudents = rows.length;
  if (totalStudents === 0) {
    return ContentService.createTextOutput(JSON.stringify({
      distribution: [],
      insights: {}
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var buckets = [
    { label: '1 guess',      min: 1,  max: 1 },
    { label: '2 guesses',    min: 2,  max: 2 },
    { label: '3 guesses',    min: 3,  max: 3 },
    { label: '4 guesses',    min: 4,  max: 4 },
    { label: '5-10 guesses', min: 5,  max: 10 },
    { label: '>10 guesses',  min: 11, max: 99999 }
  ];

  var attempts = rows.map(function(r) { return Number(r[1]); });
  var nos = rows.map(function(r) { return Number(r[3]); });
  var confidences = rows.map(function(r) { return Number(r[5]); });

  var distribution = [];
  var cumCount = 0;

  for (var i = 0; i < buckets.length; i++) {
    var b = buckets[i];
    var bucketRows = [];

    for (var j = 0; j < rows.length; j++) {
      if (attempts[j] >= b.min && attempts[j] <= b.max) {
        bucketRows.push(j);
      }
    }

    var count = bucketRows.length;
    cumCount += count;

    var avgConf = null;
    if (count > 0) {
      var confSum = 0;
      for (var k = 0; k < bucketRows.length; k++) {
        confSum += confidences[bucketRows[k]];
      }
      avgConf = confSum / (count * 5);
    }

    distribution.push({
      bucket: b.label,
      students: count,
      pdf: totalStudents > 0 ? count / totalStudents : 0,
      cdf: totalStudents > 0 ? cumCount / totalStudents : 0,
      avgConfidence: avgConf
    });
  }

  var neverHeardNo = 0;
  var strongFalsifiers = 0;
  var oneGuess = 0;
  var totalNos = 0;

  for (var j = 0; j < rows.length; j++) {
    if (nos[j] === 0) neverHeardNo++;
    if (nos[j] >= 3) strongFalsifiers++;
    if (attempts[j] === 1) oneGuess++;
    totalNos += nos[j];
  }

  var sortedAttempts = attempts.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sortedAttempts.length / 2);
  var medianAttempts = sortedAttempts.length % 2 !== 0
    ? sortedAttempts[mid]
    : (sortedAttempts[mid - 1] + sortedAttempts[mid]) / 2;

  var avgAttempts = attempts.reduce(function(a, b) { return a + b; }, 0) / totalStudents;

  var avgConf = confidences.reduce(function(a, b) { return a + b; }, 0) / totalStudents;
  var avgConfPct = (avgConf / 5 * 100).toFixed(1) + '%';

  var insights = {
    avgAttempts: avgAttempts,
    avgConfidence: avgConfPct,
    medianAttempts: medianAttempts,
    neverHeardNo: neverHeardNo,
    neverHeardNoPct: neverHeardNo / totalStudents,
    strongFalsifiers: strongFalsifiers,
    strongFalsifiersPct: strongFalsifiers / totalStudents,
    oneGuess: oneGuess,
    oneGuessPct: oneGuess / totalStudents,
    avgNos: totalNos / totalStudents
  };

  return ContentService.createTextOutput(JSON.stringify({
    distribution: distribution,
    insights: insights
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// CREATIVITY INDEX (Column K)
//
// Recomputes the raw score for every player, normalizes so the
// most exploratory player = 100%, and REWRITES the whole column
// on every call. Rewriting all rows is required for correctness:
// a single new submission can raise maxScore, which changes every
// other player's normalized percentage.
//
// UI-free on purpose — it runs inside doPost (web app) and any
// trigger, where SpreadsheetApp.getUi() is unavailable. The menu
// uses recomputeCreativityIndexMenu() for the confirmation alert.
//
// Returns { count, average } for optional callers.
// ============================================================
function computeSequenceDiversity() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responses');

  var lastRow = findLastDataRow(sheet);
  if (lastRow < 2) return { count: 0, average: 0 };

  var numRows = lastRow - 1;
  var data = sheet.getRange(2, 1, numRows, 11).getValues();

  var YES_IDX = 6;   // G, 0-based
  var NO_IDX  = 7;   // H
  var K_IDX   = 10;  // K

  // Raw score per sheet row (aligned with `data`):
  //   number  -> a computed score
  //   null    -> row has data but no parseable sequences (K should be blank)
  //   undefined -> blank sheet row (leave its K untouched)
  var rawScores = [];
  var maxScore = 0;

  for (var r = 0; r < data.length; r++) {
    if (data[r][0] === '' || data[r][0] == null) {
      rawScores.push(undefined);
      continue;
    }
    var raw = computeRawScore(data[r][YES_IDX], data[r][NO_IDX]);
    rawScores.push(raw);
    if (raw !== null && raw > maxScore) maxScore = raw;
  }

  // Header.
  sheet.getRange(1, 11).setValue('Creativity index (%)');

  // Build and write the entire K column in one batch.
  var out = [];
  var scores = [];
  for (var r = 0; r < data.length; r++) {
    var raw = rawScores[r];
    if (raw === undefined) {
      out.push([data[r][K_IDX]]); // preserve K on blank sheet rows
    } else if (raw === null) {
      out.push(['']);             // tested nothing parseable
    } else {
      var pct = maxScore === 0 ? 0 : Math.round(raw / maxScore * 100);
      out.push([pct]);
      scores.push(pct);
    }
  }
  sheet.getRange(2, 11, numRows, 1).setValues(out);
  SpreadsheetApp.flush();

  var avg = scores.length
    ? Math.round(scores.reduce(function(a, b) { return a + b; }, 0) / scores.length)
    : 0;
  Logger.log('Creativity done. players=' + scores.length + ', avg=' + avg + '%');

  return { count: scores.length, average: avg };
}

// ============================================================
// Compute raw creativity score for one player's sequences
// ============================================================
function computeRawScore(yesCell, noCell) {
  var yesStr = (yesCell != null) ? yesCell.toString() : '';
  var noStr  = (noCell != null)  ? noCell.toString() : '';

  var sequences = parseSequencesForDiversity(yesStr, noStr);
  if (sequences.length === 0) return null;

  sequences.unshift(SEED_SEQUENCE);

  var features = [];
  for (var i = 0; i < sequences.length; i++) {
    features.push(sequenceFeatures(sequences[i][0], sequences[i][1], sequences[i][2]));
  }

  var n = features.length;
  var totalDist = 0;
  var pairs = 0;
  for (var i = 0; i < n; i++) {
    for (var j = i + 1; j < n; j++) {
      totalDist += euclidean(features[i], features[j]);
      pairs++;
    }
  }
  var avgDist = pairs > 0 ? totalDist / pairs : 0;
  var volumeWeight = Math.log(n) / Math.LN2;

  return avgDist * volumeWeight;
}

// ============================================================
// FEATURE VECTOR for a single sequence (a, b, c)
// ============================================================
function sequenceFeatures(a, b, c) {
  var d1 = b - a;
  var d2 = c - b;
  var mean = (a + b + c) / 3;
  var spread = Math.max(a, b, c) - Math.min(a, b, c);

  return [
    (d1 > 0 && d2 > 0) ? 1 : 0,
    (d1 < 0 && d2 < 0) ? 1 : 0,
    (d1 === 0 && d2 === 0) ? 1 : 0,
    (d1 > 0 !== d2 > 0 && d1 !== 0 && d2 !== 0) ? 1 : 0,
    (Math.min(a, b, c) < 0) ? 1 : 0,
    (a === 0 || b === 0 || c === 0) ? 1 : 0,
    Math.log(1 + spread) / 7,
    Math.log(1 + Math.abs(mean)) / 7,
    (Math.abs(d1) + Math.abs(d2)) > 0
      ? (d2 / (Math.abs(d1) + Math.abs(d2))) * 0.5 + 0.5
      : 0.5,
    spread > 0
      ? (b - Math.min(a, b, c)) / spread
      : 0.5
  ];
}

// ============================================================
// EUCLIDEAN DISTANCE
// ============================================================
function euclidean(a, b) {
  var sum = 0;
  for (var i = 0; i < a.length; i++) {
    var d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ============================================================
// PARSE SEQUENCES — handles em dash, en dash, "none", etc.
// ============================================================
function parseSequencesForDiversity(yesStr, noStr) {
  var all = [];
  [yesStr, noStr].forEach(function(str) {
    if (!str) return;
    var trimmed = str.trim();
    if (trimmed === '' ||
        trimmed === '-' ||
        trimmed === '—' ||
        trimmed === '–' ||
        trimmed === '―' ||
        trimmed.toLowerCase() === 'none') {
      return;
    }

    str.split(';').forEach(function(part) {
      var cleaned = part.replace(/[()[\]]/g, '').trim();
      if (cleaned === '' || cleaned === '-' || cleaned === '—') return;

      var nums = cleaned.split(',').map(function(x) { return parseFloat(x.trim()); });
      if (nums.length === 3 && nums.every(function(v) { return !isNaN(v) && isFinite(v); })) {
        all.push(nums);
      }
    });
  });
  return all;
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Creativity')
    .addItem('Recompute creativity index', 'recomputeCreativityIndexMenu')
    .addToUi();
}

// Manual entry point (has UI). Keeps getUi() out of the shared
// computeSequenceDiversity(), which also runs from doPost.
function recomputeCreativityIndexMenu() {
  var res = computeSequenceDiversity();
  SpreadsheetApp.getUi().alert(
    'Creativity index computed for ' + res.count + ' players.\n' +
    'Average: ' + res.average + '%'
  );
}
