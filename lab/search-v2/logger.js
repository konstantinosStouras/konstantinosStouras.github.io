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
  var lastEventT = null;    // for rt_ms (subject actions only)
  var uploading = false;
  var inFlight = 0;         // # of queued events currently inside an in-flight POST
  var timer = null;
  var LOG_KEY = '';         // localStorage key, set in init

  // Meta events are client-side telemetry: they are mirrored + downloadable but
  // never enqueued for upload (that would loop: every upload logs one, which the
  // timer would re-upload forever) and never advance the subject clock (rt_ms).
  function isMeta(event) { return event === 'upload_ok' || event === 'upload_fail'; }

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
    if (!isMeta(event)) lastEventT = t; // meta events don't reset the subject clock
    var e = {};
    for (var i = 0; i < FIELDS.length; i++) e[FIELDS[i]] = null;
    // layer: base -> context -> per-event extra -> computed
    var apply = function (src) { if (src) for (var k in src) if (FIELDS.indexOf(k) >= 0) e[k] = src[k]; };
    apply(base); apply(ctx); apply(extra);
    e.event = event; e.t = t; e.rt_ms = rt;
    return e;
  }

  // Log one event. Real events go to both the mirror and the upload queue; meta
  // events go to the mirror only (see isMeta) so uploads never self-perpetuate.
  function log(event, extra) {
    var e = build(event, extra);
    mirror.push(e);
    saveMirror();
    if (!isMeta(event)) {
      queue.push(e);
      if (queue.length >= CFG.BATCH_SIZE) flush();
    }
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
    inFlight = batch.length; // front `inFlight` events are owned by this POST
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
        inFlight = 0;
        uploading = false;
        log('upload_ok', { value: batch.length });
      }).catch(function (err) {
        attempt++;
        if (attempt <= CFG.UPLOAD_MAX_RETRIES) {
          return delay(CFG.UPLOAD_BACKOFF_MS * Math.pow(2, attempt - 1)).then(tryPost);
        }
        inFlight = 0; // give up: leave the batch in the queue for beacon/next flush
        uploading = false;
        log('upload_fail', { value: batch.length });
      });
    }
    return tryPost();
  }

  // Fire-and-forget tail flush that survives page unload. Sends only events that
  // are NOT already inside an in-flight POST (which fetch keepalive will deliver),
  // so an unload mid-upload never duplicates rows.
  function beaconFlush() {
    if (!CFG.ENDPOINT_URL) return;
    var tail = queue.slice(inFlight);
    if (!tail.length) return;
    try {
      var blob = new Blob([JSON.stringify({ events: tail })], { type: 'text/plain;charset=UTF-8' });
      if (navigator.sendBeacon && navigator.sendBeacon(CFG.ENDPOINT_URL, blob)) {
        queue = queue.slice(0, inFlight); // keep only the in-flight batch
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
