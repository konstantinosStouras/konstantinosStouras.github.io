/* ==========================================================================
   search-v2  ·  logger.js
   Bulletproof event logging.  Three redundant paths:
     1. Primary   : batch-POST to CONFIG.ENDPOINT_URL (text/plain, retry+backoff)
     2. Backup    : full event log mirrored to localStorage continuously
     3. Fallback  : downloadable JSON + flat CSV on the finish page
   Tail is flushed with navigator.sendBeacon on visibilitychange/pagehide.
   The app works fine with ENDPOINT_URL === '' (paths 2 and 3 only).
   ========================================================================== */
window.Logger = (function () {
  'use strict';
  var CFG = window.CONFIG;

  // Canonical column order (used for CSV and Sheet rows). Keep in sync with
  // tools/apps_script_endpoint.gs. The first block is the brief's core schema;
  // the second block holds a few event-specific extras (quiz answers, the two
  // round_end nets, and a free-form info payload for e.g. paid_rounds_drawn).
  var FIELDS = [
    'session', 'pid', 'study', 'arm', 'event', 't', 'rt_ms',
    'round', 'mapping', 'stratum', 'position', 'value', 'estimate', 'refused',
    'reveals', 'cost', 'best', 'net',
    'qid', 'choice', 'correct', 'rawNet', 'flooredNet', 'info',
    'ua', 'vw', 'vh', 'appVersion'
  ];

  var base = {};            // session/pid/study/arm/ua/vw/vh/appVersion
  var ctx = {};             // round/mapping/stratum/reveals/cost/best/net
  var queue = [];           // events awaiting upload
  var mirror = [];          // full event log (backup + export)
  var lastEventT = null;    // for rt_ms
  var uploading = false;
  var timer = null;
  var LOG_KEY = '';         // localStorage key, set in init

  function nowMs() { return Date.now(); }

  function loadMirror() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      if (raw) { mirror = JSON.parse(raw) || []; }
      var lt = localStorage.getItem(LOG_KEY + ':lastT');
      if (lt) lastEventT = parseInt(lt, 10);
    } catch (e) { mirror = []; }
  }
  function saveMirror() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(mirror));
      if (lastEventT != null) localStorage.setItem(LOG_KEY + ':lastT', String(lastEventT));
    } catch (e) { /* quota — degrade gracefully, uploads still carry events */ }
  }

  function init(baseFields) {
    base = baseFields || {};
    LOG_KEY = 'searchv2:log:' + (base.session || 'anon');
    loadMirror();
    startTimer();
    // Tail flush: sendBeacon what is still queued.
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') beaconFlush();
    });
    window.addEventListener('pagehide', beaconFlush);
  }

  // Round-level context shared by subsequent events (set by the app).
  function setContext(c) {
    if (c) for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) ctx[k] = c[k];
  }
  function clearRoundContext() {
    ctx = {}; // wiped at round boundaries so stale counters don't leak across rounds
  }

  function build(event, extra) {
    var t = nowMs();
    var rt = lastEventT == null ? null : (t - lastEventT);
    lastEventT = t;
    var e = {};
    for (var i = 0; i < FIELDS.length; i++) e[FIELDS[i]] = null;
    // layer: base -> context -> per-event extra -> computed
    var apply = function (src) { if (src) for (var k in src) if (FIELDS.indexOf(k) >= 0) e[k] = src[k]; };
    apply(base); apply(ctx); apply(extra);
    e.event = event; e.t = t; e.rt_ms = rt;
    return e;
  }

  // Log one event. Meta events (upload_ok/upload_fail) never trigger an
  // immediate size-flush (that would recurse), only the timer/beacon carry them.
  function log(event, extra) {
    var e = build(event, extra);
    queue.push(e);
    mirror.push(e);
    saveMirror();
    var meta = (event === 'upload_ok' || event === 'upload_fail');
    if (!meta && queue.length >= CFG.BATCH_SIZE) flush();
    return e;
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (queue.length) flush(); }, CFG.BATCH_MS);
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // POST the current queue with exponential-backoff retries. On success the
  // batch is cleared from the queue; on total failure it stays for next time.
  function flush() {
    if (uploading) return Promise.resolve();
    if (!CFG.ENDPOINT_URL) { queue = []; return Promise.resolve(); } // local-only mode
    if (!queue.length) return Promise.resolve();
    uploading = true;
    var batch = queue.slice();
    var body = JSON.stringify({ events: batch });
    var attempt = 0;
    function tryPost() {
      return fetch(CFG.ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // avoid CORS preflight
        body: body,
        keepalive: true
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // drop the uploaded events from the queue (they may have grown meanwhile)
        queue = queue.slice(batch.length);
        uploading = false;
        log('upload_ok', { value: batch.length });
      }).catch(function (err) {
        attempt++;
        if (attempt <= CFG.UPLOAD_MAX_RETRIES) {
          return delay(CFG.UPLOAD_BACKOFF_MS * Math.pow(2, attempt - 1)).then(tryPost);
        }
        uploading = false;
        log('upload_fail', { value: batch.length });
      });
    }
    return tryPost();
  }

  // Fire-and-forget tail flush that survives page unload.
  function beaconFlush() {
    if (!CFG.ENDPOINT_URL || !queue.length) return;
    try {
      var blob = new Blob([JSON.stringify({ events: queue })], { type: 'text/plain;charset=UTF-8' });
      if (navigator.sendBeacon && navigator.sendBeacon(CFG.ENDPOINT_URL, blob)) {
        queue = [];
      }
    } catch (e) { /* ignore */ }
  }

  // ---- exports (finish-page fallback) --------------------------------------
  function getEvents() { return mirror.slice(); }

  function toCSV() {
    var esc = function (v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [FIELDS.join(',')];
    for (var i = 0; i < mirror.length; i++) {
      var row = FIELDS.map(function (f) { return esc(mirror[i][f]); });
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }
  function toJSON() {
    return JSON.stringify({ meta: base, generatedAt: new Date().toISOString(), events: mirror }, null, 2);
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
  function downloadJSON() {
    download('searchv2_' + (base.session || 'session') + '.json', toJSON(), 'application/json');
  }
  function downloadCSV() {
    download('searchv2_' + (base.session || 'session') + '.csv', toCSV(), 'text/csv');
  }

  function pending() { return queue.length; }

  return {
    FIELDS: FIELDS,
    init: init,
    setContext: setContext,
    clearRoundContext: clearRoundContext,
    log: log,
    flush: flush,
    pending: pending,
    getEvents: getEvents,
    toCSV: toCSV,
    toJSON: toJSON,
    downloadJSON: downloadJSON,
    downloadCSV: downloadCSV
  };
})();
