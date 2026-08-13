/* ==========================================================================
   search-v2  ·  logger.js
   Append-only event logging for design brief §16.

   Two classes of event, exactly as §17.2 requires:

     · RECORD events  — the decisions (`query`, `reveal`, `stop`), the round and
       session boundaries, comprehension answers and survey responses. One flat
       document each, written the moment they happen, never batched, never
       updated. These are the analysis.

     · TELEMETRY      — slider moves, heartbeats, focus/blur, instruction opens,
       resizes. Carried in memory and flushed as ONE document holding an array
       every CONFIG.BATCH_MS, at every round end, and on page hide. Written
       individually, slider moves alone would be six figures of documents;
       batched they are a few hundred.

   Three redundant paths, unchanged in spirit from the previous build:
     1. Firestore (via the sink registered by app.js) — the durable record
     2. localStorage mirror — survives a reload and a network outage
     3. downloadable JSON / CSV on the Done screen

   NOTHING here derives a quantity. Every derived field of §16.8 is computed
   offline, in admin/export.js, from these rows plus the frozen mapping pool.
   ========================================================================== */
window.Logger = (function () {
  'use strict';
  var CFG = window.CONFIG;

  // Canonical flat column order (CSV + Sheet rows). Firestore is schemaless, so
  // this is really the CSV contract; every field a row does not use is null.
  var FIELDS = [
    // identity
    'run_id', 'participant_code', 'pid', 'session', 'sessionCode', 'sessionName',
    'sequence', 'event', 't', 'iso', 'seq',
    // where in the study
    'phase', 'block', 'condition', 'scored', 'round_index', 'spec_id',
    'seed_shape', 'ai_density', 'mapping_index',
    // the decision (§16.3)
    'event_id', 'decision_index', 'action', 'position', 'value',
    'already_queried', 'queries_so_far', 'reveals_so_far',
    'ai_anchors_before', 'participant_known_before', 'participant_queried_before',
    'best_true_known_before', 'best_estimate_before', 'n_reveals_before',
    'ms_since_round_start', 'ms_since_last_action', 'ms_since_last_slider_move',
    'slider_moves_since_last_action', 'cap_hit',
    // round / session summary (raw only)
    'duration_ms', 'active_ms', 'blur_events', 'blur_total_ms', 'instruction_reopens',
    'interrupted', 'n_queries', 'n_reveals', 'total_cost', 'final_score',
    'stopped_immediately', 'nominated_position', 'nominated_true_value',
    // comprehension / survey
    'question_id', 'attempts', 'ms_to_first_answer', 'first_answer_correct',
    'answer', 'correct',
    // environment
    'ua_browser', 'ua_os', 'vw', 'vh', 'dpr', 'input_mode', 'tz_offset',
    'appVersion', 'info'
  ];

  var base = {};              // identity + environment, stamped on every row
  var ctx = {};               // round context, set at round start
  var mirror = [];            // full local log (backup + export)
  var teleBuf = [];           // telemetry awaiting a flush
  var lastActionT = null;
  var timer = null;
  var LOG_KEY = '';
  var sinks = [];
  var teleSinks = [];

  function nowMs() { return Date.now(); }
  function isoNow(t) { try { return new Date(t).toISOString(); } catch (e) { return null; } }

  // Compact, Firestore-safe encoding for a set of (position, value) pairs.
  // Firestore rejects nested arrays, and a CSV cell must stay one cell — so the
  // canonical wire form of every anchor set is "12:44|37:61|88:9".
  function encodePairs(pairs) {
    if (!pairs || !pairs.length) return '';
    return pairs.map(function (p) {
      return (p.pos != null ? p.pos : p[0]) + ':' + (p.val != null ? p.val : p[1]);
    }).join('|');
  }
  function decodePairs(str) {
    if (!str) return [];
    return String(str).split('|').filter(Boolean).map(function (s) {
      var kv = s.split(':');
      return { pos: +kv[0], val: +kv[1] };
    });
  }
  function encodeList(list) { return (list && list.length) ? list.join('|') : ''; }
  function decodeList(str) { return str ? String(str).split('|').filter(Boolean).map(Number) : []; }

  // Once stopped, nothing is written again. `logout()` promises to erase every
  // trace of the study on the device, and without this the pagehide flush that
  // fires DURING the navigation would write the mirror straight back.
  var stopped = false;

  function loadMirror() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      if (raw) mirror = JSON.parse(raw) || [];
    } catch (e) { mirror = []; }
  }
  function saveMirror() {
    if (stopped) return;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(mirror)); } catch (e) { /* quota */ }
  }
  function stop() {
    stopped = true;
    teleBuf = [];
    if (timer) { clearInterval(timer); timer = null; }
  }

  function init(baseFields) {
    base = baseFields || {};
    LOG_KEY = 'searchv2:log:' + (base.participant_code || base.session || 'anon');
    loadMirror();
    if (timer) clearInterval(timer);
    timer = setInterval(flushTelemetry, CFG.BATCH_MS);
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushTelemetry();
    });
    window.addEventListener('pagehide', flushTelemetry);
  }

  function setBase(partial) {
    if (partial) for (var k in partial) if (Object.prototype.hasOwnProperty.call(partial, k)) base[k] = partial[k];
  }
  function setContext(c) {
    if (c) for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) ctx[k] = c[k];
  }
  function clearContext() { ctx = {}; }

  function build(event, extra) {
    var t = nowMs();
    var e = {};
    for (var i = 0; i < FIELDS.length; i++) e[FIELDS[i]] = null;
    var apply = function (src) { if (src) for (var k in src) if (FIELDS.indexOf(k) >= 0) e[k] = src[k]; };
    apply(base); apply(ctx); apply(extra);
    e.event = event; e.t = t; e.iso = isoNow(t);
    return e;
  }

  // ---- record events -------------------------------------------------------
  function log(event, extra) {
    if (stopped) return null;
    var e = build(event, extra);
    e.seq = mirror.length;
    mirror.push(e);
    saveMirror();
    for (var i = 0; i < sinks.length; i++) { try { sinks[i](e, e.seq); } catch (err) { /* isolate */ } }
    return e;
  }
  function onEvent(fn) { if (typeof fn === 'function') sinks.push(fn); }

  // ---- telemetry -----------------------------------------------------------
  // Buffered rows are DELIBERATELY thin: kind, time and the two or three fields
  // that matter. They are also mirrored locally so a download carries them.
  function tele(kind, row) {
    if (stopped) return null;
    var r = row || {};
    r.kind = kind;
    r.t = nowMs();
    r.round_index = ctx.round_index != null ? ctx.round_index : null;
    r.phase = base.phase != null ? base.phase : (ctx.phase != null ? ctx.phase : null);
    teleBuf.push(r);
    if (teleBuf.length >= CFG.BATCH_SIZE * 8) flushTelemetry();
    return r;
  }
  function onTelemetry(fn) { if (typeof fn === 'function') teleSinks.push(fn); }

  function flushTelemetry() {
    if (stopped || !teleBuf.length) return;
    var rows = teleBuf.slice();
    teleBuf = [];
    var doc = build('telemetry', {
      value: rows.length,
      info: JSON.stringify(rows).slice(0, 900000)
    });
    doc.seq = mirror.length;
    mirror.push(doc);
    saveMirror();
    for (var i = 0; i < teleSinks.length; i++) { try { teleSinks[i](doc, doc.seq, rows); } catch (e) { /* isolate */ } }
    for (var j = 0; j < sinks.length; j++) { try { sinks[j](doc, doc.seq); } catch (e2) { /* isolate */ } }
  }

  // ---- action clock --------------------------------------------------------
  function markAction() { lastActionT = nowMs(); }
  function msSinceLastAction() { return lastActionT == null ? null : (nowMs() - lastActionT); }
  function resetActionClock() { lastActionT = null; }

  // ---- exports (Done-screen fallback) --------------------------------------
  function getEvents() { return mirror.slice(); }
  function eventCount() { return mirror.length; }

  function toCSV() {
    var q = function (v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [FIELDS.join(',')];
    for (var i = 0; i < mirror.length; i++) {
      lines.push(FIELDS.map(function (f) { return q(mirror[i][f]); }).join(','));
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
  function downloadJSON() { download('searchv2_' + (base.participant_code || 'session') + '.json', toJSON(), 'application/json'); }
  function downloadCSV() { download('searchv2_' + (base.participant_code || 'session') + '.csv', toCSV(), 'text/csv'); }

  // ---- coarse user-agent parsing (§16.1: family only, never the raw string) --
  function uaFamilies(ua) {
    ua = String(ua || '');
    var browser = 'other', os = 'other';
    if (/Edg\//.test(ua)) browser = 'edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'opera';
    else if (/Firefox\//.test(ua)) browser = 'firefox';
    else if (/Chrome\//.test(ua)) browser = 'chrome';
    else if (/Safari\//.test(ua)) browser = 'safari';
    if (/Windows/.test(ua)) os = 'windows';
    else if (/Android/.test(ua)) os = 'android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'ios';
    else if (/Mac OS X/.test(ua)) os = 'macos';
    else if (/Linux|X11|CrOS/.test(ua)) os = 'linux';
    return { browser: browser, os: os };
  }

  return {
    FIELDS: FIELDS,
    init: init, stop: stop, setBase: setBase, setContext: setContext, clearContext: clearContext,
    log: log, tele: tele, onEvent: onEvent, onTelemetry: onTelemetry,
    flushTelemetry: flushTelemetry,
    markAction: markAction, msSinceLastAction: msSinceLastAction, resetActionClock: resetActionClock,
    encodePairs: encodePairs, decodePairs: decodePairs,
    encodeList: encodeList, decodeList: decodeList,
    uaFamilies: uaFamilies,
    getEvents: getEvents, eventCount: eventCount,
    toCSV: toCSV, toJSON: toJSON, downloadJSON: downloadJSON, downloadCSV: downloadCSV
  };
})();
