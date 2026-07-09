/**
 * search-v2 · Google Apps Script logging endpoint
 * ------------------------------------------------------------------
 * Paste this into a Google Apps Script project bound to (or Container:
 * a standalone script writing to) a Google Sheet, then deploy as a Web App:
 *
 *   1. sheets.google.com → new spreadsheet. Copy its ID from the URL
 *      (…/d/<SHEET_ID>/edit) into SHEET_ID below, OR bind the script to the
 *      sheet (Extensions → Apps Script) and leave SHEET_ID = ''.
 *   2. Extensions → Apps Script, paste this file, Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me.   Who has access: "Anyone".
 *   4. Copy the /exec Web-app URL into lab/search-v2/config.js → ENDPOINT_URL.
 *
 * The app POSTs Content-Type text/plain (to avoid a CORS preflight) with a body
 * of {"events":[ {…}, {…} ]}. Each event becomes one row in FIELDS order.
 * Returns {"ok":true}. navigator.sendBeacon posts the same shape.
 */

var SHEET_ID = '';         // '' = use the bound spreadsheet (getActiveSpreadsheet)
var SHEET_NAME = 'events'; // tab name; created if missing

// Keep in sync with logger.js FIELDS.
var FIELDS = [
  'session', 'pid', 'study', 'arm', 'event', 't', 'rt_ms',
  'round', 'mapping', 'stratum', 'position', 'value', 'estimate', 'refused',
  'reveals', 'cost', 'best', 'net',
  'qid', 'choice', 'correct', 'rawNet', 'flooredNet', 'info',
  'ua', 'vw', 'vh', 'appVersion'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Serialize appends so a keepalive POST and a sendBeacon tail (or a retry)
    // never race on getLastRow() and overwrite each other's rows.
    lock.waitLock(30000);
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(body);
    var events = payload.events || (payload.event ? [payload] : []);
    var sheet = getSheet_();
    var rows = [];
    for (var i = 0; i < events.length; i++) {
      rows.push(FIELDS.map(function (f) {
        var v = events[i][f];
        return (v === undefined || v === null) ? '' : v;
      }));
    }
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, FIELDS.length).setValues(rows);
    }
    return json_({ ok: true, wrote: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Optional: visit the /exec URL in a browser to confirm it is live.
function doGet() {
  return json_({ ok: true, service: 'search-v2 logging endpoint', fields: FIELDS.length });
}

function getSheet_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
