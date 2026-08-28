/* =====================================================================
   Answer Arena — admin panel
   ---------------------------------------------------------------------
   Activates only with ?admin. Requires the admin account (admin@admin.com).
   Mirrors the ideasearchlab admin: a single two-column page (no tabs).
     LEFT  - create a session; design parameters (2x2 + comparison flow +
             task set); page-text editors; registration/survey question editors.
     RIGHT - active sessions (join codes, counts); registered users (+ Excel).

   All persistence goes through window.ArenaStore (Firebase when configured,
   else localStorage), so the admin works online and offline for testing.
   ===================================================================== */
(function () {
  'use strict';
  if (!/[?&]admin\b/.test(location.search)) return;

  var D = window.ARENA_DEFAULTS || {};
  var Store = window.ArenaStore;
  var XLSX = null;
  var cfg = { texts: {}, settings: {}, registrationQuestions: [], surveyQuestions: [], activeTaskSetId: null };
  var user = null, root;
  var summaryRefresh = null;   // set by the Setup summary; lets other cards refresh it after a save
  var currentView = 'admin';   // 'admin' (the two-column panel) | 'analytics' (Data analytics)
  // Data-analytics working state, kept across view switches so leaving and
  // returning to the tab preserves the loaded data + selections. `sheetMap` is the
  // aggregated workbook held in memory (Section 2) that Section 3 runs code against.
  var daState = { selected: {}, importedBooks: [], parts: null, sessions: null, sheetMap: null, sheetOrder: [], code: {}, lang: 'python', running: false, lastRun: null };
  // The CURRENTLY-mounted analytics view's cross-section refreshers. Reset by
  // renderAnalytics on every entry, so an async op started under an earlier render
  // (e.g. a Load that resolves after the user left and came back) refreshes the
  // sections that are actually on screen now — not detached, stale closures.
  var daRefs = {};

  /* ---- text fields grouped into collapsible "pages" ---- */
  var TEXT_FIELD_META = {
    welcomeTitle: { label: 'Welcome - title', kind: 'line' },
    welcomeIntro: { label: 'Welcome - intro (HTML allowed)', kind: 'area' },
    welcomeBody: { label: 'Welcome - body paragraphs (one per line, HTML allowed)', kind: 'paras' },
    welcomeButton: { label: 'Welcome - start button', kind: 'line' },
    loginLink: { label: 'Welcome - "I have an account" link', kind: 'line' },
    tourTitle: { label: 'Tour - title', kind: 'line' },
    trainingTitle: { label: 'Training - title', kind: 'line' },
    trainingBody: { label: 'Training - body (HTML allowed)', kind: 'area' },
    trainingButton: { label: 'Training - start button', kind: 'line' },
    registerTitle: { label: 'Registration - title', kind: 'line' },
    registerIntro: { label: 'Registration - intro', kind: 'area' },
    loginTitle: { label: 'Login - title', kind: 'line' },
    mainTitle: { label: 'Comparisons - title', kind: 'line' },
    mainIntro: { label: 'Comparisons - instruction', kind: 'area' },
    surveyTitle: { label: 'Survey - title', kind: 'line' },
    surveyIntro: { label: 'Survey - intro', kind: 'area' },
    thankyouTitle: { label: 'Thank-you - title', kind: 'line' },
    thankyouBody: { label: 'Thank-you - body (HTML allowed)', kind: 'area' }
  };
  var PAGE_GROUPS = [
    { key: 'welcome', label: 'Welcome page', fields: ['welcomeTitle', 'welcomeIntro', 'welcomeBody', 'welcomeButton', 'loginLink'] },
    { key: 'tour', label: 'Tour', fields: ['tourTitle'] },
    { key: 'training', label: 'Training page', fields: ['trainingTitle', 'trainingBody', 'trainingButton'] },
    { key: 'registration', label: 'Registration page', fields: ['registerTitle', 'registerIntro'] },
    { key: 'login', label: 'Login page', fields: ['loginTitle'] },
    { key: 'main', label: 'Comparisons page', fields: ['mainTitle', 'mainIntro'] },
    { key: 'survey', label: 'Survey page', fields: ['surveyTitle', 'surveyIntro'] },
    { key: 'thankyou', label: 'Thank-you page', fields: ['thankyouTitle', 'thankyouBody'] }
  ];
  var QUESTION_TYPES = ['text', 'number', 'select', 'radio', 'checkbox', 'country', 'textarea', 'email', 'password'];

  /* ---- DOM helpers ---- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'value') n.value = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  // Wrap a click handler so the button itself confirms the action: it presses,
  // shows "Saving…" while the handler's promise runs, then flashes green "✓ Saved"
  // before restoring its label. fn should return a promise (a save); a non-promise
  // resolves immediately. On failure the label restores (the handler toasts the error).
  function withFeedback(fn, okLabel) {
    return function (e) {
      var b = e && e.currentTarget;
      if (!b) { return fn(); }
      if (b._busy) return;
      b._busy = true;
      if (b._label == null) b._label = b.textContent;
      var orig = b._label;
      b.classList.remove('is-ok'); b.classList.add('is-busy'); b.setAttribute('disabled', 'true'); b.textContent = 'Saving…';
      var restore = function () { b.classList.remove('is-busy', 'is-ok'); b.textContent = orig; b.removeAttribute('disabled'); b._busy = false; };
      var ok = function () { b.classList.remove('is-busy'); b.classList.add('is-ok'); b.textContent = okLabel || '✓ Saved'; setTimeout(restore, 1100); };
      var r; try { r = fn(); } catch (err) { restore(); throw err; }
      Promise.resolve(r).then(ok, restore);
    };
  }
  function clearRoot() { root.innerHTML = ''; }
  var msgEl;
  function toast(t) { if (!msgEl) { msgEl = el('div', { class: 'aa-msg' }); document.body.appendChild(msgEl); } msgEl.textContent = t; msgEl.classList.add('show'); setTimeout(function () { msgEl.classList.remove('show'); }, 1900); }

  /* ---- 🧪 Test round: rehearse the participant flow, saving NOTHING ----
     Seeds the sandbox namespace (see ARENA_PREVIEW in arena-store.js) with the
     current configuration + the session being rehearsed, then opens the
     participant app at ?preview=1&key=… in a new tab. The sandbox runs on the
     LOCAL backend in its own localStorage namespace, so Firebase is never
     touched: no participant doc, no responses, no events, nothing to clean up.
     Mirrors the ideasearchlab admin's 🧪 Test round button.
     `session` = the session card's session, or null to rehearse the default
     (code-less) configuration with the currently-saved settings. */
  var TEST_ROUND_HINT = 'Play this session’s whole participant flow in a private sandbox: '
    + 'the intake is pre-filled with random test data and nothing is saved '
    + '— no participant record, no responses, no events.';
  function launchTestRound(session) {
    var P = window.ARENA_PREVIEW;
    if (!P || !P.seed) { toast('Test round is unavailable — please reload the page.'); return; }
    var pinned = session && session.taskSetId;
    var loadSet = (pinned && Store.loadTaskSet) ? Store.loadTaskSet(pinned) : Store.loadActiveTasks();
    loadSet.catch(function () { return null; }).then(function (set) {
      var tasks = (set && set.tasks) || [];
      var payload = {
        config: {
          texts: cfg.texts, settings: cfg.settings,
          registrationQuestions: cfg.registrationQuestions,
          surveyQuestions: cfg.surveyQuestions
        },
        session: session ? Object.assign({}, session) : null,
        taskSet: { id: (set && set.id) || 'preview-set', name: (set && set.name) || 'Test round set', tasks: tasks }
      };
      // localStorage holds ~5 MB, and a real task set of full model answers can
      // exceed that. Try the whole set, then progressively fewer comparisons,
      // so a big set degrades to a shorter rehearsal instead of an unseeded
      // (and therefore misleading) sandbox.
      var attempts = [tasks, tasks.slice(0, 40), tasks.slice(0, 15), tasks.slice(0, 5), []];
      var used = null;
      for (var i = 0; i < attempts.length; i++) {
        payload.taskSet.tasks = attempts[i];
        if (P.seed(payload)) { used = attempts[i].length; break; }
      }
      if (used === null) { toast('Could not start the test round (browser storage is full).'); return; }
      window.open(P.launchUrl(session), '_blank');
      if (used === 0 && tasks.length) {
        // Even 5 comparisons of full model answers wouldn't fit: the sandbox
        // falls back to the built-in sample comparisons.
        toast('Test round opened with the built-in sample comparisons (this task set is too big for the sandbox). Nothing is saved.');
      } else if (used < tasks.length) {
        toast('Test round opened — task set trimmed to ' + used + ' comparisons to fit the sandbox. Nothing is saved.');
      } else {
        toast('Test round opened in a new tab. Nothing you do there is saved.');
      }
    });
  }

  function injectStyles() {
    var css = ''
      + '#aa-root{--bg:#181818;--panel:#242424;--ink:#ececec;--muted:#9a978f;--line:#383838;--field:#2e2e2e;--fieldline:#474747;--accent:#e67e22;--accentd:#cf6f17;--qbg:#202020;position:fixed;inset:0;z-index:10000;background:var(--bg);overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);}'
      + '#aa-root.light{--bg:#f6f3ee;--panel:#fff;--ink:#2b2b2b;--muted:#74726c;--line:#e7e2d8;--field:#fff;--fieldline:#e0dbd0;--qbg:#fcfbf7;}'
      + '#aa-root *{box-sizing:border-box;}'
      + '.aa-wrap{max-width:960px;margin:0 auto;padding:22px 16px 90px;}'
      + '.aa-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:10px;flex-wrap:wrap;}'
      + '.aa-h h1{font-size:1.5rem;margin:0;}'
      + '.aa-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:18px;}'
      + '.aa-tabs button{border:none;background:transparent;padding:9px 13px;font-weight:600;font-size:14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}'
      + '.aa-tabs button.on{color:var(--accent);border-bottom-color:var(--accent);}'
      + '.aa-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px;box-shadow:0 6px 18px rgba(0,0,0,.18);}'
      + '.aa-card > * + *{margin-top:12px;}'
      + '.aa-card h3{margin:0 0 6px;font-size:16px;}'
      + '.aa-field{margin:10px 0;}.aa-field label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;}'
      + '#aa-root input:not([type=checkbox]):not([type=radio]):not([type=file]),#aa-root select,#aa-root textarea{width:100%;padding:9px 11px;border:1px solid var(--fieldline);border-radius:9px;font-size:16px;font-family:inherit;background:var(--field);color:var(--ink);}'
      + '#aa-root input::placeholder,#aa-root textarea::placeholder{color:var(--muted);}'
      + '#aa-root input:-webkit-autofill,#aa-root input:-webkit-autofill:hover,#aa-root input:-webkit-autofill:focus,#aa-root input:-webkit-autofill:active{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 1000px var(--field) inset;box-shadow:0 0 0 1000px var(--field) inset;caret-color:var(--ink);transition:background-color 9999s ease-in-out 0s;}'
      + '#aa-root textarea{resize:vertical;}'
      // Every variant carries a 1px border — TRANSPARENT on the filled ones — so a
      // filled pill (Open / Export data) and an outlined one (Copy link / Test
      // round / Close) are exactly the same height. With `border:none` here the
      // filled buttons sat 2px shorter than their neighbours in the same row.
      + '.aa-btn{border:1px solid transparent;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 16px;border-radius:10px;cursor:pointer;transition:transform .06s ease,background .15s ease,opacity .15s ease,box-shadow .15s ease;}'
      + '.aa-btn:active{transform:translateY(1px) scale(.97);}'
      + '.aa-btn.is-busy{opacity:.6;cursor:progress;}'
      + '.aa-btn.is-ok{background:#2faa5e !important;color:#fff !important;border-color:#2faa5e !important;box-shadow:0 4px 12px rgba(47,170,94,.35);}'
      + '.aa-btn:hover{background:var(--accentd);}.aa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.aa-btn.sm{padding:7px 11px;font-size:12px;}.aa-btn.danger{background:transparent;color:#e06b5a;border:1px solid #6d3b34;}'
      + '.aa-btn.green{background:#2faa5e;color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(47,170,94,.30);}.aa-btn.green:hover{background:#268a4c;box-shadow:0 7px 18px rgba(47,170,94,.38);}'
      + '#aa-root input[type=file]{font-size:14px;color:var(--muted);}'
      + '#aa-root input[type=file]::file-selector-button{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px;cursor:pointer;margin-right:10px;}'
      + '#aa-root input[type=file]::-webkit-file-upload-button{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px;cursor:pointer;margin-right:10px;}'
      + '#aa-root input[type=file]::file-selector-button:hover,#aa-root input[type=file]::-webkit-file-upload-button:hover{background:var(--accentd);}'
      + '.aa-importbtn{display:inline-flex;align-items:center;gap:9px;padding:11px 20px;border-radius:11px;box-shadow:0 6px 16px rgba(230,126,34,.30);transition:transform .12s,box-shadow .12s,background .15s;}'
      + '.aa-importbtn:hover{transform:translateY(-1px);box-shadow:0 9px 22px rgba(230,126,34,.38);}'
      + '.aa-importbtn:active{transform:translateY(0);box-shadow:0 4px 12px rgba(230,126,34,.30);}'
      + '.aa-importbtn svg{flex:0 0 auto;opacity:.95;}'
      + '.aa-sumtbl{border:1px solid var(--line);border-radius:10px;padding:2px 14px;background:var(--qbg);}'
      + '.aa-sumrow{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);}'
      + '.aa-sumrow:last-child{border-bottom:none;}'
      + '.aa-sumk{color:var(--muted);font-size:13px;}'
      + '.aa-sumv{font-weight:700;font-size:13px;text-align:right;min-width:0;overflow-wrap:anywhere;}'
      + '.aa-codebox{border:1.5px dashed var(--accent);border-radius:12px;padding:14px 16px;margin-top:4px;background:rgba(230,126,34,.08);text-align:center;}'
      + '.aa-codelabel{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;}'
      + '.aa-codeval{font-size:26px;font-weight:800;letter-spacing:.16em;margin-top:4px;color:var(--ink);overflow-wrap:anywhere;}'
      + '.aa-codebox a{color:var(--accent);}'
      + '.aa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-note{color:var(--muted);font-size:13px;line-height:1.6;}'
      + '.aa-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--qbg);overflow-wrap:break-word;}'
      + '.aa-q b{min-width:0;overflow-wrap:anywhere;}'
      + '.aa-q .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
      + '.aa-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:99px;}'
      + '.aa-badge.open{color:#7bd88f;background:rgba(123,216,143,.14);}.aa-badge.waiting{color:#e6a417;background:rgba(230,164,23,.14);}.aa-badge.closed{color:#9a978f;background:rgba(154,151,143,.14);}'
      + 'table.aa-tbl{width:100%;border-collapse:collapse;font-size:13px;}table.aa-tbl th,table.aa-tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);}table.aa-tbl th{color:var(--muted);font-weight:600;}'
      + '.aa-login{max-width:380px;margin:8vh auto 0;}'
      + '.aa-err{color:#e06b5a;font-size:13px;min-height:18px;margin:6px 0;}'
      + '.aa-msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:10010;opacity:0;transition:.2s;}.aa-msg.show{opacity:1;}'
      + '.aa-toggle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;}'
      + '.aa-mode{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:3px 8px;}'
      + '.aa-wrap2{max-width:1180px;}'
      + '.aa-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:18px;align-items:start;}'
      + '@media (max-width:900px){.aa-grid{grid-template-columns:1fr;}}'
      + '.aa-col{min-width:0;}'
      + '.aa-count{font-size:13px;color:var(--muted);font-weight:600;}'
      + '.aa-sub{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:20px 2px 4px;}'
      + '.aa-switches{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;}'
      + '@media (max-width:560px){.aa-switches{grid-template-columns:1fr;}}'
      + '.aa-switchbox{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--qbg);}'
      + '.aa-switchbox b{font-size:14px;}'
      + '.aa-switch{position:relative;display:inline-block;width:44px;height:24px;flex:0 0 auto;}'
      + '.aa-switch input{opacity:0;width:0;height:0;position:absolute;}'
      + '.aa-slider{position:absolute;inset:0;background:#5a5a5a;border-radius:99px;transition:.18s;cursor:pointer;}'
      + '.aa-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.18s;}'
      + '.aa-switch input:checked + .aa-slider{background:var(--accent);}'
      + '.aa-switch input:checked + .aa-slider:before{transform:translateX(20px);}'
      + '.aa-btn.is-nav-on{background:var(--accent);color:#fff;border-color:var(--accent);}'
      + '.aa-secnum{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:14px;margin-right:9px;flex:0 0 auto;}'
      + '.aa-sechead{display:flex;align-items:center;}'
      + '.aa-statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}'
      + '.aa-statbox{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--qbg);}'
      + '.aa-statbox b{font-size:26px;display:block;line-height:1.1;}'
      + '.aa-statbox span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}'
      + '.aa-seclist{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:2px 12px;background:var(--qbg);}'
      + '.aa-checkrow{display:flex;align-items:flex-start;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line);}'
      + '.aa-checkrow:last-child{border-bottom:none;}'
      + '.aa-checkrow input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;margin-top:2px;accent-color:var(--accent);}'
      + '.aa-checkrow .g{min-width:0;flex:1 1 auto;}'
      + '.aa-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(230,126,34,.16);color:var(--accent);}'
      + '.aa-tag.blue{background:rgba(20,86,200,.16);color:#5b8def;}'
      + '.aa-langtabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:4px 0 10px;}'
      + '.aa-langtabs button{border:none;background:transparent;padding:8px 14px;font-weight:700;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;}'
      + '.aa-langtabs button.on{color:var(--accent);border-bottom-color:var(--accent);}'
      + '#aa-root textarea.aa-code{width:100%;min-height:340px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:12.5px;line-height:1.5;white-space:pre;overflow:auto;tab-size:4;-moz-tab-size:4;}'
      + '.aa-out{background:#0c0c0c;color:#e6e6e6;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:540px;overflow:auto;margin-top:10px;}'
      + '.aa-plots{margin-top:12px;}.aa-plots img{display:block;max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:10px;background:#fff;}'
      + '.aa-runstatus{font-size:13px;color:var(--muted);margin:8px 0;min-height:18px;}'
      + '.aa-insh{font-size:15px;margin:16px 0 6px;color:var(--ink);}'
      + '.aa-insul{margin:4px 0;padding-left:20px;}.aa-insul li{font-size:14px;line-height:1.65;margin:5px 0;}'
      + '.aa-insp{font-size:14px;line-height:1.65;margin:8px 0;}'
      + '.aa-insimg{display:block;max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:12px;background:#fff;}'
      + '.aa-sub2{font-size:13px;font-weight:700;color:var(--ink);margin:16px 0 6px;}'
      + '.aa-provscroll{max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--qbg);}';
    document.head.appendChild(el('style', { text: css }));
  }
  function currentTheme() { try { return localStorage.getItem('aa-theme') || 'dark'; } catch (e) { return 'dark'; } }
  function applyTheme(th) { if (root) root.classList.toggle('light', th === 'light'); try { localStorage.setItem('aa-theme', th); } catch (e) {} }
  function themeToggle() { var b = el('button', { class: 'aa-btn sec sm' }); function p() { b.textContent = (root && root.classList.contains('light')) ? '☾ Dark' : '☀ Light'; } p(); b.addEventListener('click', function () { applyTheme((root && root.classList.contains('light')) ? 'dark' : 'light'); p(); }); return b; }

  /* ---- config load/save through the store ---- */
  function loadConfig() {
    return Store.loadConfig().then(function (d) {
      d = d || {};
      cfg = { texts: d.texts || {}, settings: d.settings || {}, registrationQuestions: d.registrationQuestions || [], surveyQuestions: d.surveyQuestions || [], activeTaskSetId: d.activeTaskSetId || null };
    });
  }
  function saveConfig(partial) { return Store.saveConfig(partial); }

  /* ---- routing ---- */
  function cachedAdmin() { try { return localStorage.getItem('aa-admin') === '1'; } catch (e) { return false; } }
  // Which view a URL points at, so the Data Analytics tab is directly linkable
  // (like ideasearchlab's /admin/data-analytics). Recognised forms:
  //   ?admin=data-analytics · ?admin=analytics · ?admin&view=analytics · #data-analytics
  function viewFromUrl() {
    try {
      var sp = new URLSearchParams(location.search);
      var a = (sp.get('admin') || '').toLowerCase(), v = (sp.get('view') || '').toLowerCase();
      if (/analytic/.test(a) || /analytic/.test(v) || /analytic/.test((location.hash || '').toLowerCase())) return 'analytics';
    } catch (e) {}
    return 'admin';
  }
  // Keep the address bar in sync with the active tab (canonical form
  // ?admin / ?admin=data-analytics), preserving any other query params + hash.
  // push=true adds a history entry so the browser Back button returns to the
  // previous tab; otherwise it just replaces the current URL.
  function setViewUrl(view, push) {
    try {
      var sp = new URLSearchParams(location.search);
      sp.delete('admin'); sp.delete('view');
      var rest = sp.toString();
      var q = '?admin' + (view === 'analytics' ? '=data-analytics' : '') + (rest ? '&' + rest : '');
      var url = location.pathname + q + location.hash;
      if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    } catch (e) {}
  }

  function route() {
    if (!user) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderLogin(); }
    if (!Store.isAdminEmail(user.email)) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderNotAuthorized(); }
    try { localStorage.setItem('aa-admin', '1'); } catch (e) {}
    currentView = viewFromUrl();          // open the tab the link points at
    setViewUrl(currentView, false);       // normalise the address bar
    loadConfig().then(renderShell);
  }
  function renderLogin() {
    clearRoot();
    var email = el('input', { type: 'email', placeholder: Store.ADMIN_EMAIL });
    var pass = el('input', { type: 'password', placeholder: 'Password' });
    var err = el('div', { class: 'aa-err' });
    var btn = el('button', { class: 'aa-btn', on: { click: doLogin } }, ['Log in']);
    root.appendChild(el('div', { class: 'aa-wrap' }, [
      el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:6px;' }, [themeToggle()]),
      el('div', { class: 'aa-card aa-login' }, [
      el('h1', { text: 'Answer Arena admin' }),
      (Store.mode === 'local') ? el('p', { class: 'aa-note', html: 'Local test mode (Firebase not configured). Log in as <b>' + esc(Store.ADMIN_EMAIL) + '</b> with any password.' }) : null,
      el('div', { class: 'aa-field' }, [el('label', { text: 'E-mail' }), email]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Password' }), pass]),
      err, btn
    ])]));
    function doLogin() { err.textContent = ''; btn.setAttribute('disabled', 'true'); Store.login(email.value.trim(), pass.value).then(function (u) { user = u; route(); }).catch(function (e) { btn.removeAttribute('disabled'); err.textContent = 'Login failed: ' + ((e && e.code) || 'error'); }); }
  }
  // Simulation Platform SSO (optional): one silent login attempt using the
  // credentials locker saved by stouras.com/simulation/admin/ ('simp:admin-creds').
  // No-op without saved credentials; on failure the normal login form shows.
  var simpSsoTried = false;
  function simpTrySso() {
    if (simpSsoTried) return false;
    simpSsoTried = true;
    var c = null;
    try {
      c = JSON.parse(sessionStorage.getItem('simp:admin-creds') ||
                     localStorage.getItem('simp:admin-creds') || 'null');
    } catch (e) {}
    if (!c || !c.email || !c.pass) return false;
    Store.login(c.email, c.pass).then(function (u) { user = u; route(); })
      .catch(function () { route(); });
    return true;
  }
  function renderNotAuthorized() {
    clearRoot();
    root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card aa-login' }, [
      el('h1', { text: 'Not authorized' }),
      el('p', { class: 'aa-note', html: 'Signed in as ' + esc(user.email) + ', which is not the admin account.' }),
      el('button', { class: 'aa-btn sec', on: { click: function () { Store.logout().then(function () { user = null; route(); }); } } }, ['Sign out'])
    ])]));
  }

  /* ---- small helpers ---- */
  function checkbox(on) { var c = el('input', { type: 'checkbox' }); if (on) c.setAttribute('checked', 'checked'); return c; }
  // iOS-style toggle switch; returns { input, node }.
  function switchEl(on) { var input = el('input', { type: 'checkbox' }); if (on) input.setAttribute('checked', 'checked'); var node = el('label', { class: 'aa-switch' }, [input, el('span', { class: 'aa-slider' })]); return { input: input, node: node }; }
  function collapsible(label, buildInto) {
    var section = el('div', { class: 'aa-card', style: 'padding:0;overflow:hidden;' });
    var caret = el('span', { text: '▾', style: 'color:var(--muted);' });
    var bodyDiv = el('div', { style: 'display:none;padding:0 18px 16px;' });
    var open = false, built = false;
    section.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;', on: { click: toggle } }, [el('b', { text: label, style: 'font-size:15px;' }), caret]));
    section.appendChild(bodyDiv);
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open && !built) { built = true; buildInto(bodyDiv); } }
    return section;
  }

  // Shared admin header: title + top-right nav (Admin | Data analytics) + theme +
  // Sign out. The nav mirrors the ideasearchlab admin's tab bar; the active
  // destination is highlighted. Switching views re-renders the shell in place.
  function headerRow() {
    function nav(label, view) {
      var b = el('button', { class: 'aa-btn sec sm' + (currentView === view ? ' is-nav-on' : ''), on: { click: function () { if (currentView !== view) { currentView = view; setViewUrl(view, true); renderShell(); } } } }, [label]);
      return b;
    }
    return el('div', { class: 'aa-h' }, [
      el('h1', { text: 'Answer Arena admin' }),
      el('div', { class: 'aa-row' }, [
        nav('Admin', 'admin'), nav('Data analytics', 'analytics'), themeToggle(),
        el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.logout().then(function () { user = null; route(); }); } } }, ['Sign out'])
      ])
    ]);
  }

  /* ---- main shell: ideasearchlab-style two-column layout ----
     LEFT: create session + design parameters + page text + forms.
     RIGHT: active sessions, then registered users. */
  function renderShell() {
    clearRoot();
    if (currentView === 'analytics') return renderAnalytics();
    var header = headerRow();
    var left = el('div', { class: 'aa-col' });
    var right = el('div', { class: 'aa-col' });

    // RIGHT: active sessions (list only) + registered users. The sub-heading
    // keeps the first card aligned with the left column's first card.
    var sessions = buildSessionsCard();
    right.appendChild(el('div', { class: 'aa-sub', text: 'Sessions & participants' }));
    right.appendChild(sessions.node);
    right.appendChild(buildUsersCard());

    // LEFT: design parameters (2x2 conditions, comparison flow, task set),
    // then page text, then forms, then the Create Session action + summary.
    left.appendChild(el('div', { class: 'aa-sub', text: 'Design parameters' }));
    left.appendChild(build2x2Card());
    left.appendChild(buildFlowCard());
    left.appendChild(buildTaskCard());
    left.appendChild(buildLongListCard());
    left.appendChild(el('div', { class: 'aa-sub', text: 'Page text & content' }));
    PAGE_GROUPS.forEach(function (g) { left.appendChild(renderPageSection(g)); });
    left.appendChild(el('div', { class: 'aa-sub', text: 'Forms' }));
    left.appendChild(collapsible('Edit registration questions', function (c) { renderQuestions(c, 'registrationQuestions', 'Registration questions'); }));
    left.appendChild(collapsible('Edit survey questions', function (c) { renderQuestions(c, 'surveyQuestions', 'Survey questions'); }));
    left.appendChild(el('div', { class: 'aa-sub', text: 'Launch' }));
    left.appendChild(buildCreateCard(sessions.refresh));

    root.appendChild(el('div', { class: 'aa-wrap aa-wrap2' }, [header, el('div', { class: 'aa-grid' }, [left, right])]));
  }

  /* ---- RIGHT: active + closed session cards (created from the left column) ---- */
  function buildSessionsCard() {
    var lastOpen = [], lastClosed = [], counts = {};

    // Active sessions.
    var activeCard = el('div', { class: 'aa-card' });
    var activeCount = el('span', { class: 'aa-count' });
    activeCard.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:4px;' }, [el('h3', { text: 'Active sessions' }), activeCount]));
    activeCard.appendChild(el('p', { class: 'aa-note', text: 'Every session is created open. Copy its join link to invite participants, export its data, or close it to stop new joins (it moves to "Closed sessions" below, data kept). Delete removes the session and its data for good. Create sessions from the left column.' }));
    var activeSearch = el('input', { type: 'text', placeholder: 'Search by session ID, name or date...' });
    activeCard.appendChild(el('div', { class: 'aa-field' }, [activeSearch]));
    var activeList = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    activeCard.appendChild(activeList);
    activeCard.appendChild(el('p', { class: 'aa-note', style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px;', text: 'Participants play anonymously (no account). Share a session code, or the share link, to route them to a specific session; with no code they play the default configuration.' }));

    // Closed sessions (hidden until there are any). A closed session no longer
    // lets participants join; its data is kept for review/export.
    var closedCard = el('div', { class: 'aa-card', style: 'display:none;' });
    var closedCount = el('span', { class: 'aa-count' });
    closedCard.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:4px;' }, [el('h3', { text: 'Closed sessions' }), closedCount]));
    closedCard.appendChild(el('p', { class: 'aa-note', text: 'These no longer accept participants. Export their data to review, reopen them, or delete them — Delete also erases everything recorded in the session.' }));
    var closedSearch = el('input', { type: 'text', placeholder: 'Search by session ID, name or date...' });
    closedCard.appendChild(el('div', { class: 'aa-field' }, [closedSearch]));
    var closedList = el('div', {});
    closedCard.appendChild(closedList);

    var wrap = el('div', {}, [activeCard, closedCard]);
    activeSearch.addEventListener('input', renderActive);
    closedSearch.addEventListener('input', renderClosed);

    // Match a session by its code (session ID), name, or created date string.
    function matches(s, q) {
      if (!q) return true;
      return (s.code || '').toLowerCase().indexOf(q) >= 0
        || (s.name || '').toLowerCase().indexOf(q) >= 0
        || (fmtTs(s.createdAt) || '').toLowerCase().indexOf(q) >= 0;
    }
    function renderActive() {
      var q = activeSearch.value.trim().toLowerCase();
      activeCount.textContent = lastOpen.length + ' active';
      activeList.innerHTML = '';
      if (!lastOpen.length) { activeList.appendChild(el('p', { class: 'aa-note', text: 'No active sessions - create one from the left column.' })); return; }
      var rows = lastOpen.filter(function (s) { return matches(s, q); });
      if (!rows.length) { activeList.appendChild(el('p', { class: 'aa-note', text: 'No sessions match your search.' })); return; }
      rows.forEach(function (s) { activeList.appendChild(sessionCard(s, counts, refresh)); });
    }
    function renderClosed() {
      var q = closedSearch.value.trim().toLowerCase();
      closedCount.textContent = lastClosed.length + (lastClosed.length === 1 ? ' session' : ' sessions');
      closedCard.style.display = lastClosed.length ? 'block' : 'none';
      closedList.innerHTML = '';
      if (!lastClosed.length) return;
      var rows = lastClosed.filter(function (s) { return matches(s, q); });
      if (!rows.length) { closedList.appendChild(el('p', { class: 'aa-note', text: 'No sessions match your search.' })); return; }
      rows.forEach(function (s) { closedList.appendChild(sessionCard(s, counts, refresh)); });
    }
    function refresh() {
      Promise.all([Store.listSessions(), Store.listParticipants().catch(function () { return []; })]).then(function (res) {
        var list = res[0], parts = res[1] || [];
        // A participant counts for a session they have played - started it
        // (playedSessions), are currently in it (sessionId), or completed it.
        counts = {};
        parts.forEach(function (p) {
          var seen = {};
          if (p.sessionId) seen[p.sessionId] = true;
          Object.keys(p.playedSessions || {}).forEach(function (sid) { seen[sid] = true; });
          Object.keys(p.completedSessions || {}).forEach(function (sid) { seen[sid] = true; });
          Object.keys(seen).forEach(function (sid) { counts[sid] = (counts[sid] || 0) + 1; });
        });
        list.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        lastOpen = list.filter(function (x) { return (x.status || 'open') !== 'closed'; });
        lastClosed = list.filter(function (x) { return (x.status || 'open') === 'closed'; });
        renderActive(); renderClosed();
      }).catch(function (e) { activeList.innerHTML = ''; activeList.appendChild(el('p', { class: 'aa-err', text: 'Could not load sessions: ' + ((e && e.code) || 'error') })); });
    }
    refresh();
    return { node: wrap, refresh: refresh };
  }
  // The 2x2 conditions a session runs (snapshotted at creation; falls back to
  // the current global setting for older sessions).
  function condLabel(cond) {
    var f = (cond && cond.factors) || ((cfg.settings && cfg.settings.twoByTwo && cfg.settings.twoByTwo.factors) || {});
    var on = [];
    if (f.transparency) on.push('Cost transparency');
    if (f.incentive) on.push('Firm-pay');
    return on.length ? on.join(' + ') : 'Baseline (no conditions)';
  }
  // How many comparisons this session gives each participant (snapshotted at
  // creation). Older sessions without the snapshot use the live global setting.
  function sessionFlowLabel(s) {
    if (s.comparisonsPerUser == null) return 'Comparisons/participant: live setting';
    var n = Number(s.comparisonsPerUser) || 0;
    return 'Comparisons/participant: ' + (n > 0 ? n : 'whole active set');
  }
  /* Exposed (function reference only) for the offline admin-guard test. */
  window.__arenaSessionCard = function (s, counts, refresh) { return sessionCard(s, counts || {}, refresh || function () {}); };
  function sessionCard(s, counts, refresh) {
    var liveCount = counts[s.id] != null ? counts[s.id] : (s.count || 0);
    var joinUrl = location.origin + location.pathname + '?s=' + s.code;
    var st = s.status || 'open';
    var box = el('div', { class: 'aa-q' });
    box.appendChild(el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
      el('div', { style: 'min-width:0;' }, [
        el('b', { text: s.code, style: 'font-size:18px;letter-spacing:.1em;' }), ' ', el('span', { class: 'aa-badge ' + st, text: st }),
        s.name ? el('div', { class: 'aa-note', style: 'margin-top:2px;' }, [s.name]) : null
      ]),
      el('div', { style: 'text-align:right;min-width:0;' }, [
        el('div', { style: 'font-weight:700;font-size:14px;', text: liveCount + ' participant' + (liveCount === 1 ? '' : 's') }),
        el('div', { class: 'aa-note', text: condLabel(s.condition) })
      ])
    ]));
    box.appendChild(el('div', { class: 'aa-note', style: 'margin-top:4px;', text: sessionFlowLabel(s) }));
    box.appendChild(el('div', { class: 'aa-note', style: 'margin-top:2px;', text: 'Created ' + (fmtTs(s.createdAt) || 'just now') }));
    var actions = [];
    if (st === 'closed') {
      // Closed: review (export), reopen, or remove. Joining is disabled, so no
      // Open/Copy.
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['⬇ Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', title: TEST_ROUND_HINT, on: { click: function () { launchTestRound(s); } } }, ['🧪 Test round']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.updateSession(s.id, { status: 'open' }).then(function () { toast('Reopened.'); refresh(); }); } } }, ['Reopen']));
      actions.push(el('button', { class: 'aa-btn danger sm', on: { click: deleteSession } }, ['Delete']));
    } else {
      actions.push(el('button', { class: 'aa-btn sm', on: { click: function () { window.open(joinUrl, '_blank'); } } }, ['Open']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { copy(joinUrl); } } }, ['Copy link']));
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['⬇ Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', title: TEST_ROUND_HINT, on: { click: function () { launchTestRound(s); } } }, ['🧪 Test round']));
      // No rename/edit here (nor in the ideasearchlab admin): a session that
      // exists may already have participants playing in it, so it is never
      // changed after creation — name it on the Create card.
      // Two DISTINCT endings, mirroring the ideasearchlab cards: a neutral
      // "Close Session" (grey) that only stops new joins and moves the card
      // into "Closed sessions" below, and a red "Delete" that destroys the
      // session and everything recorded in it. Close was styled `danger` and
      // labelled just "Close" before, which read as the destructive one.
      actions.push(el('button', { class: 'aa-btn sec sm', title: 'Stops new joins and moves this session to "Closed sessions" below. Nothing is deleted.', on: { click: function () { if (window.confirm('Close session ' + s.code + '? Participants will no longer be able to join. Its data is kept and it moves to "Closed sessions".')) Store.updateSession(s.id, { status: 'closed' }).then(function () { toast('Closed.'); refresh(); }); } } }, ['Close Session']));
      actions.push(el('button', { class: 'aa-btn danger sm', title: 'Permanently deletes this session AND all of its data.', on: { click: deleteSession } }, ['Delete']));
    }
    box.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, actions));
    /* Permanently remove the session AND everything it recorded: every
       response, event, survey answer and unsubmitted draft given in it, plus
       the participant records that exist only because of it (someone who also
       played another session keeps that other session's data). The data goes
       FIRST and the session doc last, so a failure leaves the session listed
       and the action retryable instead of orphaning rows under a session that
       no longer appears anywhere. There is no undo, hence the two prompts. */
    function deleteSession() {
      var n = liveCount;
      if (!window.confirm('Permanently delete session ' + s.code + ' AND all of its data?\n\n'
        + 'This removes the session and everything recorded in it — responses, events, survey answers '
        + 'and unsubmitted drafts. A participant who played only this session is removed entirely; '
        + 'anyone who also played another session keeps that session\'s data.\n\n'
        + 'This cannot be undone. Export the data first if you may still need it.')) return;
      if (n && !window.confirm('Last check: delete ' + s.code + ' and the data of '
        + n + ' participant' + (n === 1 ? '' : 's') + '?')) return;
      toast('Deleting ' + s.code + '…');
      var purge = Store.deleteSessionData ? Store.deleteSessionData(s.id) : Promise.resolve(null);
      purge.then(function (res) {
        return Store.deleteSession(s.id).then(function () {
          var gone = (res && res.participantsRemoved) || 0;
          toast('Deleted' + (gone ? ' — ' + gone + ' participant record' + (gone === 1 ? '' : 's') + ' removed too' : '') + '.');
          refresh();
        });
      }).catch(function (e) {
        console.error('[arena] delete session failed', e);
        toast('Delete failed: ' + ((e && e.code) || 'error') + ' — the session is still listed; try again.');
        refresh();
      });
    }
    // Download only the data for the users who played THIS session.
    function exportSession() {
      Store.listParticipants().then(function (all) {
        var parts = all.filter(function (p) { return p.sessionId === s.id || (p.playedSessions && p.playedSessions[s.id]) || (p.completedSessions && p.completedSessions[s.id]); });
        if (!parts.length) { toast('No participants in this session yet.'); return; }
        exportExcel(parts, { sessionId: s.id, sessionCode: s.code });
      }).catch(function (e) { toast('Export failed: ' + ((e && e.code) || 'error')); });
    }
    return box;
  }

  /* ---- LEFT (bottom): create a session + setup summary ---- */
  function buildCreateCard(sessionsRefresh) {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('h3', { text: 'Create a session' }));
    card.appendChild(el('p', { class: 'aa-note', text: 'Creates an open session using the parameters and content above. Share its join link with participants; close it later (from the right) to stop new joins.' }));
    var nameI = el('input', { type: 'text', placeholder: 'Optional label, e.g. "Pilot group A"' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Session name (optional)' }), nameI]));
    // Optional custom session code (mirrors the ideasearchlab admin): a single
    // word of capital letters and digits. Live-normalised so whatever the admin
    // types is exactly typeable back on the participant welcome screen (which
    // uppercases the code the same way).
    var idI = el('input', { type: 'text', placeholder: '(OPTIONAL) CUSTOM CODE', maxlength: '40', style: 'text-transform:uppercase;letter-spacing:.08em;' });
    idI.addEventListener('input', function () { idI.value = idI.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40); });
    card.appendChild(el('div', { class: 'aa-field' }, [
      el('label', { text: 'Session ID (optional)' }),
      idI,
      el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'Leave blank to auto-generate a short code. Single word — capital letters and digits only, no spaces or dashes (3–40 chars).' })
    ]));
    var err = el('div', { class: 'aa-err' });
    var btn = el('button', { class: 'aa-btn', on: { click: create } }, ['Create Session']);
    // Rehearse the settings above WITHOUT creating a session (the sandbox plays
    // the default, code-less configuration). Nothing is saved anywhere.
    var testBtn = el('button', {
      class: 'aa-btn sec',
      title: 'Play the whole participant flow with the settings above in a private sandbox. '
        + 'No session is created and nothing is saved — the intake is pre-filled with random test data.',
      on: { click: function () { launchTestRound(null); } }
    }, ['🧪 Test round (nothing saved)']);
    card.appendChild(el('div', { class: 'aa-row' }, [btn, testBtn]));
    card.appendChild(err);
    var codeBox = el('div', { style: 'margin-top:10px;' });    card.appendChild(codeBox);
    var summary = el('div', { style: 'margin-top:16px;' });    card.appendChild(summary);
    nameI.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    idI.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    summaryRefresh = renderSummary;   // let the flow / 2x2 cards refresh this after a save
    renderSummary();

    function factors() { return (cfg.settings && cfg.settings.twoByTwo && cfg.settings.twoByTwo.factors) || {}; }
    function create() {
      err.textContent = '';
      // Optional custom code: normalise, then require a single 3–40 char word of
      // capital letters and digits (blank = auto-generate a short code).
      var code = (idI.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code && !/^[A-Z0-9]{3,40}$/.test(code)) {
        err.textContent = 'Session ID must be 3–40 characters, capital letters and digits only (no spaces or dashes).';
        return;
      }
      var f = factors();
      var cond = { factors: { transparency: !!f.transparency, incentive: !!f.incentive } };  // snapshot the 2x2 onto the session
      var sct = cfg.settings || {};
      // Snapshot the comparison-flow settings too, so the session keeps the count
      // it was built with regardless of later global changes (matches "I built
      // THIS session with N comparisons").
      var flow = { comparisonsPerUser: sct.comparisonsPerUser || 0, randomizeOrder: sct.randomizeOrder !== false };
      btn.setAttribute('disabled', 'true'); btn.textContent = 'Creating...';
      // If a custom code was given, make sure it isn't already taken before creating.
      var precheck = code ? Store.getSessionByCode(code) : Promise.resolve(null);
      precheck.then(function (existing) {
        if (existing) return Promise.reject({ code: 'code-taken' });
        return Store.createSession({ name: nameI.value.trim(), code: code || undefined, status: 'open', condition: cond, taskSetId: cfg.activeTaskSetId || null, comparisonsPerUser: flow.comparisonsPerUser, randomizeOrder: flow.randomizeOrder });
      })
        .then(function (s) { toast('Session created: ' + s.code); nameI.value = ''; idI.value = ''; btn.removeAttribute('disabled'); btn.textContent = 'Create Session'; showCreatedCode(s.code); if (sessionsRefresh) sessionsRefresh(); })
        .catch(function (e) {
          btn.removeAttribute('disabled'); btn.textContent = 'Create Session';
          if (e && e.code === 'code-taken') { err.textContent = 'That Session ID is already in use. Please choose another.'; return; }
          var msg = (e && (e.code || e.message)) || 'error';
          err.textContent = 'Could not create the session: ' + msg + (/(permission|insufficient)/i.test(msg) ? ' - the Firestore rules may need (re)deploying.' : '');
          if (window.console) console.error('[Arena] createSession failed', e);
        });
    }
    // Vivid confirmation box with the session code (custom or auto-generated),
    // shown just below the Create button after a successful create.
    function showCreatedCode(codeVal) {
      codeBox.innerHTML = '';
      codeBox.appendChild(el('div', { class: 'aa-codebox' }, [
        el('div', { class: 'aa-codelabel', text: 'Session code' }),
        el('div', { class: 'aa-codeval', text: codeVal }),
        el('div', { class: 'aa-note', style: 'margin-top:6px;', html: 'Share this code before your session begins. Participants join at: <a href="https://www.stouras.com/lab/answerarena/" target="_blank" rel="noopener">stouras.com/lab/answerarena</a>' })
      ]));
    }
    function renderSummary() {
      var s = cfg.settings || {}, f = factors();
      var on = []; if (f.transparency) on.push('Cost transparency'); if (f.incentive) on.push('Firm-pay');
      var groups = (on.length === 0) ? 'single baseline group' : (Math.pow(2, on.length) + ' groups (' + on.join(' × ') + ')');
      var lim = s.comparisonsPerUser || 0;
      var rows = [
        ['Comparisons / participant', lim > 0 ? String(lim) : 'whole active set'],
        ['Order', (s.randomizeOrder !== false) ? 'randomized per participant' : 'fixed order'],
        ['Long list', s.longList ? 'on - participants may proceed to the survey early' : 'off'],
        ['Per comparison', 'pick a side (or tie), then a 7-point preference: A much better … Equal … B much better'],
        ['Session code', 'required to take part'],
        ['2x2 conditions', groups],
        ['Active task set', 'loading...']
      ];
      summary.innerHTML = '';
      summary.appendChild(el('div', { class: 'aa-sub', style: 'margin:0 0 4px;', text: 'Setup summary' }));
      summary.appendChild(el('p', { class: 'aa-note', style: 'margin:0 0 8px;', text: 'A snapshot of the saved settings a new session will use. Save changes above, then Refresh.' }));
      var tbl = el('div', { class: 'aa-sumtbl' });
      rows.forEach(function (r) { tbl.appendChild(el('div', { class: 'aa-sumrow' }, [el('span', { class: 'aa-sumk', text: r[0] }), el('span', { class: 'aa-sumv', text: r[1] })])); });
      summary.appendChild(tbl);
      summary.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [el('button', { class: 'aa-btn sec sm', on: { click: renderSummary } }, ['↻ Refresh summary'])]));
      Store.loadActiveTasks().then(function (set) {
        var total = (set && set.tasks) ? set.tasks.length : 0;
        var vEls = tbl.querySelectorAll('.aa-sumv');
        if (!vEls.length) return;
        // Comparisons / participant -> "2 of 100 (random subset)" once we know the size.
        vEls[0].textContent = lim > 0
          ? (lim + (total ? ' of ' + total + (lim < total ? ' (random subset)' : '') : ''))
          : (total ? 'whole active set (' + total + ')' : 'whole active set');
        vEls[vEls.length - 1].textContent = total + ' comparisons' + (set && set.name ? ' (' + set.name + ')' : '');
      }).catch(function () {});
    }
    return card;
  }

  /* ---- RIGHT: registered users ---- */
  /* What a participant ACTUALLY did — which is not always what their last
     `status` write says. `status` is a live cursor the app overwrites on every
     entry ('registered' → 'playing' → 'survey' → 'done'), so a student who
     finished and later re-opened the app WITHOUT their session code used to be
     dropped into a fresh code-less default play and restamped 'playing'; the
     panel then listed finished students as still playing. arena-app.js no
     longer does that, but records already written that way stay in the
     database, so the truth is derived here from what they completed:
       - nothing completed  → the raw cursor IS the truth (registered/playing/…)
       - the session they point at is one they completed → done
       - they point at the code-less default play ('_none') while having really
         completed a session → that pointer is the stray re-entry → done
       - otherwise (pointing at ANOTHER, unfinished session) → the raw cursor,
         because that participant genuinely has work in progress. */
  function participantStatus(p) {
    var raw = (p && p.status) || '';
    var done = Object.keys((p && p.completedSessions) || {});
    if (!done.length) return raw;
    var cur = (p && p.sessionId) || '';
    if (!cur || cur === '_none' || done.indexOf(cur) >= 0) return 'done';
    return raw;
  }
  // Spell the difference out on hover, so a corrected badge is never a mystery.
  function statusTitle(p) {
    var raw = (p && p.status) || '(none)', shown = participantStatus(p);
    var done = Object.keys((p && p.completedSessions) || {}).length;
    if (shown === raw) return done + ' session(s) completed';
    return 'Recorded status: "' + raw + '" — shown as "' + shown + '" because '
      + done + ' session(s) were completed and the record points at '
      + (((p && p.sessionId) || '') === '_none' ? 'the code-less default play (a later re-entry)' : 'a session they completed') + '.';
  }
  /* Exposed (function reference only) for the offline admin-guard test. */
  window.__arenaParticipantStatus = participantStatus;
  window.__arenaBuildUsersCard = function () { return buildUsersCard(); };
  function buildUsersCard() {
    var card = el('div', { class: 'aa-card' });
    var all = [];
    card.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:8px;' }, [el('h3', { text: 'Registered users' }), el('button', { class: 'aa-btn green sm', on: { click: function () {
      /* Re-read the participants at EXPORT time, so the file can only ever
         contain accounts that still exist. A deletion made meanwhile (here,
         in another tab, or one that silently failed) is reflected instead of
         being served from a stale in-memory list. */
      Store.listParticipants().then(function (fresh) {
        all = fresh.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); });
        render();
        if (all.length) exportExcel(all); else toast('No users yet.');
      }).catch(function (e) { toast('Export failed: ' + ((e && e.code) || 'error')); });
    } } }, ['Export to Excel'])]));
    var search = el('input', { type: 'text', placeholder: 'Search by Participant ID, e-mail or account ID...' });
    card.appendChild(el('div', { class: 'aa-field' }, [search]));
    var listWrap = el('div', {}, [el('p', { class: 'aa-note', text: 'Loading...' })]);
    card.appendChild(listWrap);
    search.addEventListener('input', render);
    function render() {
      var q = search.value.trim().toLowerCase();
      var rows = all.filter(function (p) {
        if (!q) return true;
        return (p.participantId || '').toLowerCase().indexOf(q) >= 0
          || (p.email || '').toLowerCase().indexOf(q) >= 0
          || (p._id || '').toLowerCase().indexOf(q) >= 0;
      });
      /* GROUP BY STUDENT, not by account. A student who registers twice (a
         reload, a second device, a re-take) gets a second anonymous account
         = a second participant doc with the same Participant ID. Listing one
         card per doc meant Delete removed only ONE of them, so the student's
         other account — and all of its answers — stayed in the database and
         kept showing up in the Excel export. One card per student now, and
         Delete removes every account behind it. */
      var groups = [], byKey = {};
      rows.forEach(function (p) {
        var k = String(p.participantId || '').trim().toLowerCase() || ('\u0000id:' + p._id);
        if (!byKey[k]) { byKey[k] = { rows: [] }; groups.push(byKey[k]); }
        byKey[k].rows.push(p);
      });
      listWrap.innerHTML = '';
      listWrap.appendChild(el('p', { class: 'aa-note',
        text: groups.length + ' of ' + all.length + ' user' + (all.length === 1 ? '' : 's') +
              (groups.length !== rows.length ? ' · ' + (rows.length - groups.length) + ' duplicate account(s) folded in' : '') }));
      /* Delete a chosen set of accounts, then re-read and report what (if
         anything) survived. Used by both the whole-student Delete and the
         per-account Delete rows below. */
      function removeAccounts(ids, gkey, what) {
        return Promise.allSettled(ids.map(function (id) { return Store.deleteParticipant(id); })).then(function (rs) {
          var bad = rs.filter(function (x) { return x.status === 'rejected'; });
          return Store.listParticipants().then(function (fresh) {
            all = fresh.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); });
            var stillThere = ids.filter(function (id) {
              return all.some(function (x) { return x._id === id; });
            });
            if (stillThere.length) {
              toast('STILL PRESENT: ' + stillThere.length + ' account(s) could not be removed (' +
                    stillThere.join(', ') + ')' + (bad.length ? ' — ' + bad.length + ' delete(s) were rejected' : '') + '. Please try again.');
            } else {
              var left = gkey ? all.filter(function (x) { return String(x.participantId || '').trim().toLowerCase() === gkey; }) : [];
              toast('Deleted ' + what + ' — verified gone, so it cannot appear in any export.' +
                    (left.length ? ' ' + left.length + ' other account(s) for this student remain.' : ''));
            }
            render();
          });
        }).catch(function (e) { toast('Delete error: ' + ((e && e.code) || e)); load(); });
      }
      groups.forEach(function (g) {
        // Show the most recent account; Delete covers all of them.
        var list = g.rows.slice().sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        var p = list[0], ids = list.map(function (x) { return x._id; });
        var gkey = String(p.participantId || '').trim().toLowerCase();
        var doneN = 0;
        list.forEach(function (x) { doneN += Object.keys(x.completedSessions || {}).length; });
        var c = p.condition || {};
        listWrap.appendChild(el('div', { class: 'aa-q' }, [
          el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
            el('div', { style: 'min-width:0;' }, [
              el('b', { text: p.participantId || '(no participant ID)' }),
              el('div', { class: 'aa-note', style: 'margin-top:2px;', text: p.email || '(no e-mail)' })
            ]),
            el('span', { class: 'aa-note', text: participantStatus(p), title: statusTitle(p) })
          ]),
          el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'registered ' + fmtTs(p.createdAt) + '  ·  ' + doneN + ' session(s) completed' + (ids.length > 1 ? '  ·  ' + ids.length + ' accounts' : '') + (c.enabled ? '  ·  cell ' + c.transparency + '/' + c.incentive : '') }),
          /* The account IDs are the export's own account_id column, so a row
             in the spreadsheet can be matched to the card that removes it.
             With more than one account the accounts are listed INDIVIDUALLY,
             each with its own Delete — a student who registered twice has two
             separate anonymous accounts, and the instructor needs to remove a
             specific stale one while KEEPING the account they actually played
             (grouping them under one card otherwise hides that choice). */
          ids.length > 1
            ? el('div', { style: 'margin-top:6px;' }, [el('div', { class: 'aa-note', style: 'opacity:.75;', text: 'This student has ' + ids.length + ' separate accounts — delete the ones that should not count:' })].concat(
                list.map(function (x) {
                  var xc = Object.keys(x.completedSessions || {}).length;
                  return el('div', { class: 'aa-row', style: 'justify-content:space-between;align-items:center;gap:8px;margin-top:4px;padding:6px 8px;border:1px solid rgba(255,255,255,.10);border-radius:8px;' }, [
                    el('span', { class: 'aa-note', style: 'min-width:0;overflow-wrap:anywhere;', title: statusTitle(x),
                      text: x._id + '  ·  registered ' + fmtTs(x.createdAt) + '  ·  ' + xc + ' session(s)  ·  ' + participantStatus(x) }),
                    el('button', { class: 'aa-btn danger sm', on: { click: function () {
                      if (!window.confirm('Delete ONLY this account?\n\n' + x._id + '\nregistered ' + fmtTs(x.createdAt) + ' · ' + xc + ' session(s) completed' +
                            '\n\nIts answers are removed from the database, so they no longer appear in any data export. The student\'s other account(s) are kept.')) return;
                      removeAccounts([x._id], gkey, 'account ' + x._id);
                    } } }, ['Delete'])
                  ]);
                })))
            : el('div', { class: 'aa-note', style: 'margin-top:2px;opacity:.75;', text: 'account_id: ' + ids.join(', ') }),
          el('div', { class: 'aa-row', style: 'margin-top:6px;' }, [
            el('button', { class: 'aa-btn danger sm', on: { click: function () {
              if (!window.confirm('Delete "' + (p.participantId || p.email || p._id) + '" and all their data?' +
                    (ids.length > 1 ? '\n\nThis student has ' + ids.length + ' accounts (they registered more than once) — ALL of them are removed.' : '') +
                    '\n\nTheir answers are removed from the database, so they no longer appear in any data export — and they can take the study again.')) return;
              removeAccounts(ids, gkey, ids.length > 1 ? ids.length + ' accounts' : 'the account');
            } } }, [ids.length > 1 ? 'Delete all ' + ids.length + ' accounts' : 'Delete'])
          ])
        ]));
      });
    }
    function load() { Store.listParticipants().then(function (p) { all = p.sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); }); render(); }).catch(function (e) { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'aa-err', text: 'Could not load users: ' + ((e && e.code) || 'error') })); }); }
    load();
    return card;
  }
  function copy(txt) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta); ta.focus(); ta.select();
        ta.setSelectionRange(0, txt.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) toast('Copied: ' + txt); else window.prompt('Copy this link:', txt);
      } catch (e) { window.prompt('Copy this link:', txt); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Copied: ' + txt); }, fallback);
    } else { fallback(); }
  }

  /* ============================ TASKS (Excel) ====================== */
  function buildTaskCard() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('h3', { text: 'Comparisons (task set)' }));
    card.appendChild(el('p', { class: 'aa-note', html: 'Feed the <b>"Summarized"</b> sheet - either an <b>Excel/CSV file</b> or a <b>public Google Sheet link</b> of the same layout (first row = headers, matched loosely). It uses just these columns: <b>Specific description</b> -> the problem shown to participants, <b>Output of Haiku 4.5 ...</b> -> Answer A, <b>Output of Opus 4.8 ...</b> -> Answer B, and the two <b>Total Cost ($)</b> columns -> the per-answer US$ cost (used only when the "cost transparency" condition is active). All other columns are ignored. A simple <b>task / outputA / outputB</b> file (with optional cost columns) still works too. Participants see the two answers in a randomized left/right order and never learn which produced which.' }));
    var file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Upload an Excel / CSV file' }), file]));
    var gsUrl = el('input', { type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/.../edit#gid=0' });
    card.appendChild(el('div', { class: 'aa-field' }, [
      el('label', { text: 'Or import from a Google Sheet link' }), gsUrl,
      el('div', { class: 'aa-note', style: 'margin-top:4px;', html: 'The sheet must be shared <b>Anyone with the link - Viewer</b> (or File -> Share -> Publish to web) - a private sheet cannot be read from the browser. Paste any link to the workbook: <b>every tab is scanned</b> and the one with these columns (the <b>"Summarized"</b> tab) is used automatically, so you do not need to open a specific tab first.' })
    ]));
    card.appendChild(el('div', { class: 'aa-row' }, [el('button', { class: 'aa-btn aa-importbtn', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg><span>Import from Google Sheet</span>', on: { click: importGoogle } })]));
    var preview = el('div', { style: 'margin-top:8px;' });
    card.appendChild(preview);

    var active = el('div', { style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:12px;' }, [el('p', { class: 'aa-note', text: 'Loading current set...' })]);
    card.appendChild(active);
    refreshActive();

    var parsed = null, parsedFrom = '';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      ensureXLSX().then(function (X) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var wb = X.read(new Uint8Array(e.target.result), { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = X.utils.sheet_to_json(ws, { header: 1, defval: '' });
            parsed = rowsToTasks(rows); parsedFrom = '';
            applyParsed();
          } catch (err) { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'Could not read the file: ' + (err.message || err) })); }
        };
        reader.readAsArrayBuffer(f);
      }).catch(function () { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'Could not load the Excel reader (offline?).' })); });
    });

    function importGoogle() {
      var url = gsUrl.value.trim();
      if (!url) { toast('Paste a Google Sheet link first.'); return; }
      var id = (url.match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(url) ? url : '');
      if (!id) { preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-err', text: 'That does not look like a Google Sheet link.' })); return; }
      var gid = (url.match(/[#?&]gid=([0-9]+)/) || [])[1];
      preview.innerHTML = ''; preview.appendChild(el('p', { class: 'aa-note', text: 'Fetching the sheet...' }));
      ensureXLSX().then(function (X) {
        // Read the whole workbook first so every tab is visible and the one with
        // the right columns ("Summarized") is picked automatically; if that
        // request is blocked, fall back to the single tab the link's #gid= names.
        return fetchAllTabs(X, id).catch(function () { return fetchOneTab(X, id, gid); });
      }).then(function (res) {
        parsed = res.tasks; parsedFrom = res.name || '';
        applyParsed();
      }).catch(function (e) {
        preview.innerHTML = '';
        preview.appendChild(el('p', { class: 'aa-err', html: 'Could not import: ' + esc((e && e.message) || 'error') + '. Make sure the sheet is shared <b>Anyone with the link - Viewer</b> (a private sheet cannot be read from the browser). The "Summarized" tab is detected automatically once the sheet is shared.' }));
      });
    }
    // Whole-workbook path: read every tab and keep the one that best matches the
    // columns the app uses (task / the two model outputs).
    function fetchAllTabs(X, id) {
      var xlsxUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
      return fetch(xlsxUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf);
        // A real .xlsx is a zip starting with "PK"; anything else (an HTML login
        // or error page) means the export was not returned, so fall back.
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error('not a workbook');
        var best = tasksFromWorkbook(X, X.read(bytes, { type: 'array' }));
        // Only trust the auto-pick when a tab clearly has a task + two text
        // output columns; otherwise defer to the single tab the link points at.
        if (best.score < 3 || !best.tasks.length) throw new Error('no tab with the expected columns');
        return best;
      });
    }
    // Single-tab fallback: the gviz CSV endpoint (more permissive than export)
    // returns just the tab named by #gid= (or the first tab if none).
    function fetchOneTab(X, id, gid) {
      var csvUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : '');
      return fetch(csvUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (text) {
        if (/<html|<!doctype/i.test(text.slice(0, 200))) throw new Error('the sheet is not publicly readable');
        var wb = X.read(text, { type: 'string' });
        var rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        return { tasks: rowsToTasks(rows), name: '' };
      });
    }

    // An upload/import is parsed, previewed, and saved as the active set right
    // away (the Save button is then just an explicit re-save).
    function applyParsed() {
      showPreview();
      if (parsed && parsed.length) activate('Saved as the active set (' + parsed.length + ' comparison' + (parsed.length === 1 ? '' : 's') + ').');
    }
    function showPreview() {
      preview.innerHTML = '';
      if (!parsed || !parsed.length) { preview.appendChild(el('p', { class: 'aa-err', text: 'No rows found. Check the file has a header row and at least one data row.' })); return; }
      preview.appendChild(el('p', { class: 'aa-note', text: parsed.length + ' comparison' + (parsed.length === 1 ? '' : 's') + (parsedFrom ? ' from tab "' + parsedFrom + '"' : '') + ' loaded and saved as the active set. Preview of the first few:' }));
      var tbl = el('table', { class: 'aa-tbl' });
      var has = function (k) { return parsed.some(function (r) { return r[k] != null && r[k] !== ''; }); };
      // Only show optional columns that the upload actually carried.
      var cols = [{ h: '#', f: function (r, i) { return String(i + 1); } }, { h: 'Task ID', f: function (r) { return r.id; } }];
      cols.push({ h: 'Problem (shown)', f: function (r) { return clip(r.task); } });
      cols.push({ h: 'Output A', f: function (r) { return clip(r.outputA); } });
      cols.push({ h: 'Output B', f: function (r) { return clip(r.outputB); } });
      if (has('costA') || has('costB')) {
        cols.push({ h: 'Cost A ($)', f: function (r) { return r.costA != null ? String(r.costA) : ''; } });
        cols.push({ h: 'Cost B ($)', f: function (r) { return r.costB != null ? String(r.costB) : ''; } });
      }
      tbl.appendChild(el('thead', {}, [el('tr', {}, cols.map(function (c) { return el('th', { text: c.h }); }))]));
      var tb = el('tbody', {});
      parsed.slice(0, 5).forEach(function (r, i) { tb.appendChild(el('tr', {}, cols.map(function (c) { return el('td', { text: String(c.f(r, i) == null ? '' : c.f(r, i)) }); }))); });
      tbl.appendChild(tb);
      preview.appendChild(el('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch;' }, [tbl]));
      preview.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [
        el('button', { class: 'aa-btn', on: { click: withFeedback(function () { return activate('Comparisons saved (' + parsed.length + ').'); }) } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(function () { return activate('Comparisons saved as the default (' + parsed.length + ').'); }) } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(restoreBuiltin, '✓ Restored') } }, ['Restore built-in default']),
        el('button', { class: 'aa-btn sec', on: { click: discard } }, ['Discard'])
      ]));
    }
    function discard() { parsed = null; parsedFrom = ''; file.value = ''; preview.innerHTML = ''; }
    // Save the parsed upload as the active comparison set, keeping the preview
    // visible. ("Save" and "Make this the default" both do this - the active set
    // is the one participants get.)
    function activate(msg) {
      if (!parsed || !parsed.length) return Promise.reject();
      var set = { name: 'Uploaded ' + new Date().toLocaleString(), source: 'excel', tasks: parsed, count: parsed.length };
      return Store.saveTaskSet(set).then(function (id) { cfg.activeTaskSetId = id; toast(msg); refreshActive(); }).catch(function (e) {
        // Make a failed save legible: a fleeting toast alone made the Save button
        // look like it "did nothing". Log it and leave a persistent error so the
        // cause (and that nothing was stored) is visible.
        var code = (e && e.code) || (e && e.message) || 'error';
        if (window.console) console.error('[Arena admin] saveTaskSet failed', e);
        toast('Save failed: ' + code);
        try { preview.appendChild(el('p', { class: 'aa-err', text: 'Save failed (' + code + '). The set was not stored - please retry. If it persists, check the Firestore rules are deployed and you are signed in as the admin.' })); } catch (_) {}
        throw e;
      });
    }
    function restoreBuiltin() {
      return saveConfig({ activeTaskSetId: null }).then(function () { cfg.activeTaskSetId = null; toast('Restored built-in default.'); discard(); refreshActive(); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); throw e; });
    }
    function refreshActive() {
      active.innerHTML = '';
      active.appendChild(el('p', { class: 'aa-note', text: 'Loading current set...' }));
      Store.loadActiveTasks().then(function (s) {
        active.innerHTML = '';
        active.appendChild(el('h3', { text: 'Current active set' }));
        var isBuiltin = !cfg.activeTaskSetId || s.id === 'builtin';
        active.appendChild(el('p', { class: 'aa-note', html: '<b>' + esc(s.name || 'Built-in default') + '</b> · ' + (s.tasks ? s.tasks.length : 0) + ' comparisons' + (isBuiltin ? ' (built-in placeholders)' : '') }));
        active.appendChild(el('div', { class: 'aa-row' }, [
          el('button', { class: 'aa-btn sec', on: { click: withFeedback(function () { return saveConfig({ activeTaskSetId: null }).then(function () { cfg.activeTaskSetId = null; toast('Reverted to built-in default set.'); refreshActive(); }); }, '✓ Restored') } }, ['Restore built-in default'])
        ]));
        // The active task set appears in the Setup summary too - keep it in sync
        // whenever it changes (upload / import / restore).
        if (summaryRefresh) summaryRefresh();
      }).catch(function (e) {
        // Never leave the card stuck on "Loading current set..." - surface the
        // error and offer a one-click reset to the built-in default (which clears
        // a bad activeTaskSetId) plus a retry.
        if (window.console) console.error('[Arena admin] Could not load the current task set', e);
        active.innerHTML = '';
        active.appendChild(el('h3', { text: 'Current active set' }));
        active.appendChild(el('p', { class: 'aa-err', text: 'Could not load the current set (' + ((e && e.code) || (e && e.message) || 'error') + '). It may point at a set that was removed, or the Firestore rules may not be deployed yet.' }));
        active.appendChild(el('div', { class: 'aa-row' }, [
          el('button', { class: 'aa-btn sec', on: { click: withFeedback(function () { return saveConfig({ activeTaskSetId: null }).then(function () { cfg.activeTaskSetId = null; toast('Reset to the built-in default set.'); refreshActive(); }); }, '✓ Reset') } }, ['Reset to built-in default']),
          el('button', { class: 'aa-btn sec', on: { click: refreshActive } }, ['Retry'])
        ]));
      });
    }
    return card;
  }
  // Parse a grid (Excel upload or Google Sheet CSV) into task objects. Built for
  // the "Summarized" layout, but only the columns the app actually uses are read:
  // Specific description -> the problem shown, Output of Haiku/Opus -> the two
  // answers, and the two Total Cost ($) columns -> the cost-transparency meter
  // (Task ID is kept as the internal id). Everything else is ignored. A simple
  // task / outputA / outputB[/ costA / costB] file is still supported.
  function rowsToTasks(rows) {
    if (!rows || !rows.length) return [];
    var c = detectCols(rows[0]);
    // Parse a money value: numbers pass through; strings may carry $/commas/spaces
    // and (from CSV imports) scientific notation like "8.29E-4", which must survive.
    function money(v) {
      if (typeof v === 'number') return isFinite(v) ? v : null;
      var s = String(v == null ? '' : v).replace(/[^0-9eE.+\-]/g, '');
      if (!s) return null;
      var n = parseFloat(s);
      return isFinite(n) ? n : null;
    }
    function str(row, i) { return i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : ''; }

    // Treat row 1 as a header only if at least two of task/outputA/outputB were
    // recognized; otherwise assume no header and use the first three columns.
    var hasHeader = c.found >= 2;
    var TI = c.ti < 0 ? 0 : c.ti, AI = c.ai < 0 ? 1 : c.ai, BI = c.bi < 0 ? 2 : c.bi;
    var out = [], start = hasHeader ? 1 : 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var task = str(row, TI), oa = str(row, AI), ob = str(row, BI);
      if (!task && !oa && !ob) continue;
      var t = { id: str(row, c.idi) || ('T' + (out.length + 1)), task: task, outputA: oa, outputB: ob };
      var ca = money(row[c.cai]); if (ca != null) t.costA = ca;
      var cb = money(row[c.cbi]); if (cb != null) t.costB = cb;
      out.push(t);
    }
    return out;
  }
  // Locate the columns the app uses in a header row, returning their indices plus
  // how many of task/outputA/outputB were recognized (`found`). Shared by
  // rowsToTasks and the multi-tab picker so both agree on what a "good" tab is.
  function detectCols(headerRow) {
    var header = (headerRow || []).map(function (h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); });
    // Match by candidate PRIORITY (outer loop = candidates): exact match first
    // (so short codes like "a"/"b" don't match "t-a-sk"), then substring for
    // tokens >= 3 chars.
    function find(cands) {
      var i, j;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (header[i] === cands[j]) return i;
      for (j = 0; j < cands.length; j++) for (i = 0; i < header.length; i++) if (cands[j].length >= 3 && header[i].indexOf(cands[j]) >= 0) return i;
      return -1;
    }
    // All columns (in sheet order) whose normalized header satisfies a predicate.
    function findAll(pred) { var a = []; for (var i = 0; i < header.length; i++) if (pred(header[i])) a.push(i); return a; }

    var idi = find(['taskid', 'id']);                                  // A  Task ID (internal id)
    // Problem shown to participants: the Specific description (the user need),
    // else another description / task / question / prompt column.
    var ti = find(['specificdescription', 'description', 'task', 'question', 'prompt']); // E
    // The two model outputs: text columns with "output"/"answer" but NOT the token
    // or cost columns. First = Output A (baseline), second = Output B (frontier).
    var outCols = findAll(function (h) { return /output|answer/.test(h) && !/token|cost/.test(h); });
    var ai = find(['outputa', 'answera', 'haiku', 'output1', 'answer1', 'baseline', 'modela']); // H
    var bi = find(['outputb', 'answerb', 'opus', 'output2', 'answer2', 'frontier', 'modelb']);  // N
    if (ai < 0 && outCols.length) ai = outCols[0];
    if (bi < 0 && outCols.length > 1) bi = outCols[1];
    // The two TOTAL cost columns (US$), in model order: prefer "total cost", else a
    // cost column that is not the "thinking" cost, else columns D/E (old layout).
    var costCols = findAll(function (h) { return h.indexOf('totalcost') >= 0; });             // M, S
    if (costCols.length < 2) costCols = findAll(function (h) { return h.indexOf('cost') >= 0 && h.indexOf('thinking') < 0; });
    // Two cost columns -> use them; exactly one -> only costA (no guessing a second);
    // none -> the old layout's columns D/E.
    var cai, cbi;
    if (costCols.length >= 2) { cai = costCols[0]; cbi = costCols[1]; }
    else if (costCols.length === 1) { cai = costCols[0]; cbi = -1; }
    else { cai = 3; cbi = 4; }
    var found = (ti >= 0 ? 1 : 0) + (ai >= 0 ? 1 : 0) + (bi >= 0 ? 1 : 0);
    // Confidence score for choosing among workbook tabs: rewards a real task
    // column plus actual TEXT output columns (and the cost pair). Unlike `found`,
    // it isn't fooled by a details tab whose model name only appears on a
    // token/cost column, so the real "Summarized" tab wins.
    var score = (ti >= 0 ? 1 : 0) + Math.min(outCols.length, 2) + (costCols.length >= 2 ? 1 : 0);
    return { idi: idi, ti: ti, ai: ai, bi: bi, cai: cai, cbi: cbi, found: found, score: score };
  }
  // Pick the workbook tab whose header best matches the columns the app needs
  // (best confidence score; ties break on row count), so a multi-tab sheet
  // imports by just pasting any link to it instead of the exact tab.
  function tasksFromWorkbook(X, wb) {
    var best = { name: '', score: -1, n: 0, tasks: [] };
    (wb.SheetNames || []).forEach(function (name) {
      var rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      if (!rows || !rows.length) return;
      var score = detectCols(rows[0]).score, tasks = rowsToTasks(rows);
      if (score > best.score || (score === best.score && tasks.length > best.n)) best = { name: name, score: score, n: tasks.length, tasks: tasks };
    });
    return best;
  }
  function clip(s) { s = String(s || ''); return s.length > 90 ? s.slice(0, 90) + '…' : s; }

  /* ============================ CONTENT ============================ */
  function renderPageSection(g) {
    var section = el('div', { class: 'aa-card', style: 'padding:0;overflow:hidden;' });
    var caret = el('span', { text: '▾', style: 'color:var(--muted);' });
    var bodyDiv = el('div', { style: 'display:none;padding:0 18px 16px;' });
    var open = false, inputs = {};
    section.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;', on: { click: toggle } }, [el('b', { text: g.label, style: 'font-size:15px;' }), caret]));
    section.appendChild(bodyDiv);
    function build() {
      bodyDiv.innerHTML = ''; inputs = {};
      g.fields.forEach(function (key) {
        var meta = TEXT_FIELD_META[key]; if (!meta) return;
        var dflt = (D.texts || {})[key];
        var saved = cfg.texts[key];
        var val = (saved == null || saved === '' || (Array.isArray(saved) && !saved.length)) ? dflt : saved;
        if (meta.kind === 'paras') val = Array.isArray(val) ? val.join('\n') : (val || '');
        var input = (meta.kind === 'line') ? el('input', { type: 'text', value: val || '' }) : el('textarea', { rows: meta.kind === 'paras' ? '5' : '3', value: val || '' });
        inputs[key] = { input: input, kind: meta.kind };
        bodyDiv.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: meta.label }), input]));
      });
      bodyDiv.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: withFeedback(save) } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(makeDefault) } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(restoreBuiltin, '✓ Restored') } }, ['Restore built-in default'])
      ]));
    }
    function toggle() { open = !open; bodyDiv.style.display = open ? 'block' : 'none'; caret.textContent = open ? '▴' : '▾'; if (open) build(); }
    function collect() { var texts = {}; Object.keys(inputs).forEach(function (key) { var v = inputs[key].input.value; texts[key] = inputs[key].kind === 'paras' ? v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : v; }); return texts; }
    // One live config, so "Save" and "Make this the default" both persist this
    // page's text; "Restore built-in default" reverts to the arena-data.js text.
    function persist(msg) { var merged = Object.assign({}, cfg.texts, collect()); return saveConfig({ texts: merged }).then(function () { cfg.texts = merged; toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }); }
    function save() { return persist(g.label + ' saved.'); }
    function makeDefault() { return persist(g.label + ' saved as the default.'); }
    function restoreBuiltin() { var Dt = D.texts || {}, merged = Object.assign({}, cfg.texts); g.fields.forEach(function (key) { if (Dt[key] !== undefined) merged[key] = Dt[key]; else delete merged[key]; }); return saveConfig({ texts: merged }).then(function () { cfg.texts = merged; build(); toast(g.label + ' restored to built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }); }
    return section;
  }

  /* ===================== REGISTRATION / SURVEY Qs =================== */
  function renderQuestions(body, field, title) {
    var list = ((cfg[field] && cfg[field].length) ? cfg[field] : (D[field] || [])).map(function (q) { return Object.assign({}, q); });
    var card = el('div', { class: 'aa-card' });
    var listWrap = el('div', {});
    card.appendChild(el('p', { class: 'aa-note', text: title + '. Reorder with the up/down buttons. Players take part anonymously, so e-mail/password questions are ignored by the app; only the participant-ID system field is still used.' }));
    card.appendChild(listWrap);
    card.appendChild(el('div', { class: 'aa-field' }, [el('button', { class: 'aa-btn sec sm', on: { click: function () { list.push({ id: 'q_' + Date.now().toString(36), label: 'New question', type: 'text', required: true }); render(); } } }, ['+ Add question'])]));
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
      el('button', { class: 'aa-btn', on: { click: withFeedback(doSave) } }, ['Make this the default']),
      el('button', { class: 'aa-btn sec', on: { click: function () { list = builtinOrSaved(); render(); toast('Reloaded saved values.'); } } }, ['Reset this page to defaults']),
      el('button', { class: 'aa-btn sec', on: { click: withFeedback(restoreBuiltin, '✓ Restored') } }, ['Restore built-in default'])
    ]));
    body.appendChild(card);
    render();
    function builtinOrSaved() { return ((cfg[field] && cfg[field].length) ? cfg[field] : (D[field] || [])).map(function (q) { return Object.assign({}, q); }); }
    function restoreBuiltin() { list = (D[field] || []).map(function (q) { return Object.assign({}, q); }); var patch = {}; patch[field] = list; return saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); render(); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); }); }
    function render() {
      listWrap.innerHTML = '';
      list.forEach(function (q, i) {
        var qb = el('div', { class: 'aa-q' });
        var labelI = el('input', { type: 'text', value: q.label || '', style: 'min-width:220px;flex:1 1 240px;' });
        labelI.addEventListener('input', function () { q.label = labelI.value; });
        var typeS = el('select', { style: 'max-width:130px;' }, QUESTION_TYPES.map(function (tp) { return el('option', { value: tp }, [tp]); }));
        typeS.value = q.type || 'text';
        typeS.addEventListener('change', function () { q.type = typeS.value; render(); });
        var reqL = el('label', { style: 'font-weight:500;display:flex;align-items:center;gap:5px;' });
        var reqC = el('input', { type: 'checkbox' }); if (q.required) reqC.setAttribute('checked', 'checked');
        reqC.addEventListener('change', function () { q.required = reqC.checked; });
        reqL.appendChild(reqC); reqL.appendChild(document.createTextNode('required'));
        var up = el('button', { class: 'aa-btn sec sm', on: { click: function () { if (i > 0) { var x = list[i - 1]; list[i - 1] = list[i]; list[i] = x; render(); } } } }, ['↑']);
        var dn = el('button', { class: 'aa-btn sec sm', on: { click: function () { if (i < list.length - 1) { var x = list[i + 1]; list[i + 1] = list[i]; list[i] = x; render(); } } } }, ['↓']);
        var del = el('button', { class: 'aa-btn danger sm', on: { click: function () { list.splice(i, 1); render(); } } }, ['delete']);
        qb.appendChild(el('div', { class: 'row' }, [labelI, typeS, reqL, up, dn, del]));
        qb.appendChild(el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'id: ' + (q.id || '') + (q.system ? ' (system: ' + q.system + ')' : '') }));
        if (q.type === 'select' || q.type === 'radio') {
          var opt = el('textarea', { rows: '3', value: (q.options || []).join('\n'), style: 'margin-top:6px;' });
          opt.addEventListener('input', function () { q.options = opt.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
          qb.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Options (one per line)' }), opt]));
        }
        if (q.type === 'country') {
          qb.appendChild(el('div', { class: 'aa-note', style: 'margin-top:6px;', text: 'Uses the built-in country list — a dropdown of all countries. No options needed.' }));
        }
        if (q.type === 'number') {
          var minI = el('input', { type: 'number', value: (q.min != null ? String(q.min) : ''), placeholder: 'min', style: 'max-width:90px;' });
          var maxI = el('input', { type: 'number', value: (q.max != null ? String(q.max) : ''), placeholder: 'max', style: 'max-width:90px;' });
          minI.addEventListener('input', function () { var v = minI.value.trim(); if (v === '') delete q.min; else q.min = Number(v); });
          maxI.addEventListener('input', function () { var v = maxI.value.trim(); if (v === '') delete q.max; else q.max = Number(v); });
          qb.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Number range (optional)' }), el('div', { class: 'row', style: 'gap:8px;' }, [minI, maxI])]));
        }
        var help = el('input', { type: 'text', value: q.help || '', placeholder: 'Optional helper text' });
        help.addEventListener('input', function () { q.help = help.value; });
        qb.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Helper text' }), help]));
        listWrap.appendChild(qb);
      });
    }
    function doSave() { var patch = {}; patch[field] = list; return saveConfig(patch).then(function () { cfg[field] = list.map(function (q) { return Object.assign({}, q); }); toast(title + ' saved.'); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); }); }
  }

  /* ===================== 2x2 & SETTINGS ===================== */
  // The 2x2 conditions card: two toggle switches (one per factor). The two
  // switches define the design - both on = 4 groups, one on = 2, none = 1.
  // Saves immediately on toggle (like the ideasearchlab AI toggles).
  function build2x2Card() {
    var dflt = { factors: { transparency: false, incentive: false } };
    var tt = Object.assign({}, dflt, (D.settings || {}).twoByTwo, (cfg.settings || {}).twoByTwo);
    var f = tt.factors || dflt.factors;
    var trans = switchEl(!!f.transparency);
    var inc = switchEl(!!f.incentive);
    var summary = el('div', { class: 'aa-note', style: 'margin-top:10px;' });
    function paint() {
      var n = (trans.input.checked ? 1 : 0) + (inc.input.checked ? 1 : 0);
      summary.textContent = n === 2
        ? '4 groups - the full 2x2 = 4 design. Each participant belongs to exactly one of the four groups (randomly and invisibly assigned).'
        : n === 1
          ? '2 groups (one of the two conditions varied). Each participant belongs to one group (randomly and invisibly assigned).'
          : 'No conditions varied - everyone is in a single baseline group.';
    }
    function save() {
      var settings = Object.assign({}, cfg.settings, { twoByTwo: { factors: { transparency: trans.input.checked, incentive: inc.input.checked } } });
      paint();
      saveConfig({ settings: settings }).then(function () { cfg.settings = settings; if (summaryRefresh) summaryRefresh(); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    trans.input.addEventListener('change', save);
    inc.input.addEventListener('change', save);
    paint();
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: '2x2 conditions' }),
      el('p', { class: 'aa-note', text: 'This is a 2x2 design by varying "cost transparency" and "firm-pay" i.e. whether company pays or the user bears the cost of the model output. Turn on each condition you want to vary; with both on there are 2 x 2 = 4 groups, and each participant simply belongs to one of them - randomly and invisibly assigned (they are never shown their group, or told that groups exist). One condition on = 2 groups; none = a single baseline group.' }),
      el('div', { class: 'aa-switches' }, [
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Cost transparency' }), trans.node]),
        el('div', { class: 'aa-switchbox' }, [el('b', { text: 'Firm-pay' }), inc.node])
      ]),
      summary
    ]);
  }

  function buildFlowCard() {
    var s = cfg.settings || {};
    var randomize = checkbox(s.randomizeOrder !== false);
    var perUser = el('input', { type: 'number', min: '0', step: '1', value: String(s.comparisonsPerUser != null ? s.comparisonsPerUser : 0), style: 'max-width:140px;' });
    // Answer Arena keeps a single live configuration that every session reads, so
    // "Save" and "Make this the default" both persist it (Save = the everyday
    // action; "Make this the default" = the explicit commit); a session created
    // afterwards uses these values. "Restore built-in default" reverts to the
    // values shipped in arena-data.js. (A session code is always required to
    // play, so there is no toggle for it.)
    function persist(msg) {
      var n = parseInt(perUser.value, 10);
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: randomize.checked,
        comparisonsPerUser: (isNaN(n) || n < 0) ? 0 : n,
        requireSessionCode: true
      });
      perUser.value = String(settings.comparisonsPerUser);
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; if (summaryRefresh) summaryRefresh(); toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    function save() { return persist('Comparison flow saved.'); }
    function makeDefault() { return persist('Comparison flow saved as the default.'); }
    function restoreDefaults() {
      var Ds = D.settings || {};
      var settings = Object.assign({}, cfg.settings, {
        randomizeOrder: Ds.randomizeOrder !== false,
        comparisonsPerUser: Ds.comparisonsPerUser || 0,
        requireSessionCode: true
      });
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; randomize.checked = settings.randomizeOrder; perUser.value = String(settings.comparisonsPerUser); if (summaryRefresh) summaryRefresh(); toast('Restored built-in default.'); }).catch(function (e) { toast('Restore failed: ' + ((e && e.code) || 'error')); });
    }
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Comparison flow' }),
      el('p', { class: 'aa-note', text: 'Each participant is shown a number of task pairs in a random sequence. Set how many, and whether the order is randomized. A session code is always required to take part.' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [randomize, document.createTextNode('Show comparisons in random order per participant')])]),
      el('div', { class: 'aa-field' }, [el('label', { text: 'Comparisons per participant (0 = use the whole active set)' }), perUser]),
      el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: withFeedback(save) } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(makeDefault) } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(restoreDefaults, '✓ Restored') } }, ['Restore built-in default'])
      ])
    ]);
  }

  // "Long list of comparisons": an on/off mode. When on, each comparison shows a
  // "Proceed to Survey" button so a participant working through a long set can stop
  // and go to the survey whenever they like.
  function buildLongListCard() {
    var on = checkbox(!!(cfg.settings && cfg.settings.longList));
    function persist(msg, val) {
      on.checked = val;
      var settings = Object.assign({}, cfg.settings, { longList: !!val });
      return saveConfig({ settings: settings }).then(function () { cfg.settings = settings; if (summaryRefresh) summaryRefresh(); toast(msg); }).catch(function (e) { toast('Save failed: ' + ((e && e.code) || 'error')); });
    }
    return el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Long list of comparisons' }),
      el('p', { class: 'aa-note', html: 'For a long task set. When <b>on</b>, every comparison shows a <b>"Proceed to Survey"</b> button (active once the participant has answered the current pair). Pressing it asks for confirmation: on <b>Agree</b> the participant jumps to the survey and does no more comparisons; on <b>Discard</b> they keep going - and the button stays available on later pairs. When <b>off</b>, participants go through their whole assigned set before the survey.' }),
      el('div', { class: 'aa-field' }, [el('label', { class: 'aa-toggle' }, [on, document.createTextNode('Show a "Proceed to Survey" button on every comparison')])]),
      el('div', { class: 'aa-row', style: 'margin-top:8px;' }, [
        el('button', { class: 'aa-btn', on: { click: withFeedback(function () { return persist('Long-list setting saved.', on.checked); }) } }, ['Save']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(function () { return persist('Long-list setting saved as the default.', on.checked); }) } }, ['Make this the default']),
        el('button', { class: 'aa-btn sec', on: { click: withFeedback(function () { return persist('Restored built-in default.', !!((D.settings || {}).longList)); }, '✓ Restored') } }, ['Restore built-in default'])
      ])
    ]);
  }

  /* ===================== EXPORT ===================== */
  // The multi-tab structure shared by the single/all-session export and the
  // Data-analytics aggregate, so both always produce the identical workbook shape.
  var SHEET_ORDER = ['Conventions', 'Sessions', 'Participants', 'Tasks', 'Task summary', 'Responses', 'Events', 'Survey'];
  // Downloads everything collected for every user: their profile + registration,
  // every response (with the decision time), every logged decision/change event
  // (with its timestamp), and one survey per session taken.
  // opts.sessionId (optional) restricts the export to one session: only the
  // users who played it, and only their data for that session.
  /* Exposed (function reference only, no data) so the offline export-guard
     test can drive the real builder — see tools/admin-guard.mjs. */
  window.__arenaExportExcel = function (parts, opts) { return exportExcel(parts, opts); };
  function exportExcel(parts, opts) {
    opts = opts || {};
    var only = opts.sessionId || null;
    if (!opts.returnSheets) toast('Building export...');
    var run = ensureXLSX().then(function (X) {
      // Load the active task set and the session list up front. The task set is the
      // lookup table that turns each task_id into its full description + the two
      // model outputs (the Tasks and Task summary sheets - the task is the unit of
      // analysis); the session list documents every session play and maps internal
      // session ids to their human join codes on every sheet.
      return Promise.all([
        Store.loadActiveTasks().catch(function () { return { tasks: [] }; }),
        Store.listSessions().catch(function () { return []; }),
        /* The LIVE participant list. Every export is intersected with it, so a
           deleted account can never reach the file no matter which caller
           supplied `parts` — a stale in-memory array, a list captured before a
           deletion, or a future caller that forgets to re-read. Deleting a
           participant hard-deletes their doc, so "deleted" == "absent here".
           Fail-open on a read error (keep the caller's list) rather than
           silently exporting nothing. */
        Store.listParticipants().catch(function () { return null; })
      ]).then(function (pre) {
        var activeSet = pre[0] || { tasks: [] };
        var sessions = pre[1] || [];
        var live = pre[2];
        if (live) {
          var alive = {};
          live.forEach(function (x) { if (x && x._id) alive[x._id] = 1; });
          var before = parts.length;
          parts = parts.filter(function (x) { return x && alive[x._id]; });
          if (parts.length !== before) {
            console.log('[arena] export: excluded ' + (before - parts.length) + ' deleted account(s)');
          }
        }
        var sessById = {}; sessions.forEach(function (s) { if (s && s.id != null) sessById[String(s.id)] = s; });
        // Also load the task set each in-scope session was pinned to, so a session
        // whose set differs from the current active set (the admin changed it since)
        // still resolves its task_ids to the text participants actually saw. The
        // active set is the base; each pinned set overlays it (what was shown wins).
        // For the aggregate, opts.sessionIds is a { sessionId: true } map of the
        // ticked sessions; the single/all export uses `only` (one id, or null = all).
        var ids = opts.sessionIds || null;
        var pinnedIds = {};
        sessions.forEach(function (s) { if (s.taskSetId && (ids ? ids[s.id] : (!only || s.id === only))) pinnedIds[s.taskSetId] = true; });
        return Promise.all(Object.keys(pinnedIds).map(function (id) {
          return (Store.loadTaskSet ? Store.loadTaskSet(id) : Promise.resolve({ tasks: [] })).catch(function () { return { tasks: [] }; });
        })).then(function (pinnedSets) {
          return buildWorkbook(X, activeSet, pinnedSets, sessions, sessById, parts, only, opts);
        });
      });
    });
    // Aggregate path: return the promise so the caller gets the in-memory sheet map
    // (and handles its own errors/UI). Export path: fire-and-forget with a toast.
    if (opts.returnSheets) return run;
    run.catch(function (e) { toast('Export failed: ' + ((e && e.message) || 'error')); });
  }
  // Assemble and download the workbook once the task sets + sessions are loaded.
  function buildWorkbook(X, activeSet, pinnedSets, sessions, sessById, parts, only, opts) {
    var ids = opts.sessionIds || null;
    // A response/event/survey is in scope if it belongs to the ticked set (aggregate)
    // or the single/all export scope.
    var keep = function (sid) { return ids ? !!ids[sid || ''] : (!only || (sid || '') === only); };
    return Promise.resolve().then(function () {
        var activeById = {}; (activeSet.tasks || []).forEach(function (t) { if (t && t.id != null) activeById[String(t.id)] = t; });
        var taskById = {}; Object.keys(activeById).forEach(function (k) { taskById[k] = activeById[k]; });
        (pinnedSets || []).forEach(function (set) { ((set && set.tasks) || []).forEach(function (t) { if (t && t.id != null) taskById[String(t.id)] = t; }); });
        var pRows = [], rRows = [], eRows = [], sRows = [];
        // Per-task aggregates for the Task summary sheet, and the set of every
        // task_id that shows up anywhere in the exported data (so the Tasks sheet
        // lists them even if the active set has since changed).
        var agg = {}, seenTaskIds = {};
        function aggOf(id) { return agg[id] || (agg[id] = { n: 0, baseline: 0, frontier: 0, tie: 0, prefSum: 0, prefN: 0, msSum: 0, msN: 0, chSum: 0, chN: 0, pfSum: 0, pfN: 0, anSum: 0, anN: 0 }); }
        var chain = Promise.resolve();
        parts.forEach(function (p) {
          var uid = p._id, c = p.condition || {};
          var completed = Object.keys(p.completedSessions || {});
          var base = {
            participant_id: p.participantId || '', account_id: uid, email: p.email || '',
            // `status` is the DERIVED one (see participantStatus): the raw
            // cursor calls a finished student "playing" once they re-open the
            // app, which reads as a drop-out in the analysis. The raw value is
            // kept beside it so nothing is lost.
            status: participantStatus(p), recorded_status: p.status || '',
            current_session_id: p.sessionId || '',
            current_session_code: sessCode(p.sessionId, sessById),
            // How far they got: size of their assigned set (most recent session) and
            // how many comparisons they actually submitted (filled in below). A
            // drop-out shows e.g. 7 submitted of 20 assigned, with status "playing".
            comparisons_assigned: (p.order && p.order.length != null) ? p.order.length : '',
            comparisons_submitted: 0,
            played_session_ids: Object.keys(p.playedSessions || {}).join(', '),
            completed_session_ids: completed.join(', '),
            completed_this_session_at: only ? ((p.completedSessions && p.completedSessions[only]) ? fmtTs(p.completedSessions[only]) : 'no') : undefined,
            // Per-participant 2x2 group as 1/0 (1 = treatment, 0 = control), blank if
            // the factor was not varied for this participant's session.
            cost_transparency: condBit(c.transparency, c.transparencyOn, 'translated'),
            firm_pay: condBit(c.incentive, c.incentiveOn, 'firm'),
            registered_at: fmtTs(p.createdAt)
          };
          if (!only) delete base.completed_this_session_at;
          var prow = Object.assign({}, base, orderedAnswers('reg_', p.registration || {}, activeQuestions('registrationQuestions'), false));
          pRows.push(prow);
          chain = chain.then(function () {
            return Store.listResponses(uid).then(function (rs) {
              // One ordered list per participant: the submitted answers plus the
              // in-progress draft, sorted by session then shown_order (idx) so the
              // Responses sheet reads 1, 2, 3, ... as the participant saw them.
              var items = [];
              rs.forEach(function (v) { if (keep(v.sessionId)) items.push({ v: v, sub: 'yes', ms: v.responseMs, ts: v.ts }); });
              var dr = p.draftResponse;
              if (dr && keep(dr.sessionId)) items.push({ v: dr, sub: 'no (draft)', ms: '', ts: dr.updatedAt });
              var ord = function (x) { return (x == null || x === '' || !isFinite(Number(x))) ? 1e9 : Number(x); };
              items.sort(function (a, b) {
                var sa = a.v.sessionId || '', sb = b.v.sessionId || '';
                if (sa !== sb) return sa < sb ? -1 : 1;
                return ord(a.v.idx) - ord(b.v.idx);
              });
              items.forEach(function (it) {
                rRows.push(respRow(base, it.v, it.sub, it.ms, it.ts, taskById, sessById));
                if (it.v.taskId != null) seenTaskIds[String(it.v.taskId)] = true;
                // Aggregate only SUBMITTED comparisons into the per-task summary.
                if (it.sub === 'yes' && it.v.taskId != null) {
                  var a = aggOf(String(it.v.taskId)); a.n++;
                  var cm = it.v.chosenOutput;
                  if (cm === 'o1') a.baseline++; else if (cm === 'o2') a.frontier++; else if (cm === 'tie') a.tie++;
                  var pm = Number(it.v.prefModelValue); if (it.v.prefModelValue != null && isFinite(pm)) { a.prefSum += pm; a.prefN++; }
                  var ms = Number(it.v.responseMs); if (it.v.responseMs != null && isFinite(ms)) { a.msSum += ms; a.msN++; }
                  // Decision-timing means (each averaged over the responses that
                  // carry it, so older rows without them never skew the mean).
                  var chm = Number(it.v.choiceMs); if (it.v.choiceMs != null && isFinite(chm)) { a.chSum += chm; a.chN++; }
                  var pfm = Number(it.v.prefMs); if (it.v.prefMs != null && isFinite(pfm)) { a.pfSum += pfm; a.pfN++; }
                  var anm = Number(it.v.answerMs); if (it.v.answerMs != null && isFinite(anm)) { a.anSum += anm; a.anN++; }
                }
              });
              // Answers tracked so far for this participant (in this export's scope).
              prow.comparisons_submitted = items.reduce(function (n, it) { return n + (it.sub === 'yes' ? 1 : 0); }, 0);
            }).catch(function () {});
          }).then(function () {
            return Store.listEvents(uid).then(function (evs) {
              evs.sort(function (a, b) { return tsMs(a.ts) - tsMs(b.ts); });
              evs.forEach(function (v) {
                if (!keep(v.sessionId)) return;
                if (v.taskId != null) seenTaskIds[String(v.taskId)] = true;
                var et = v.type === 'choice' ? 'side_choice' : v.type === 'preference' ? 'preference' : v.type === 'satisfA' ? 'satisfaction_answer_A' : v.type === 'satisfB' ? 'satisfaction_answer_B' : (v.type || '');
                eRows.push({ participant_id: base.participant_id, account_id: uid, email: base.email, session_id: v.sessionId || '', session_code: sessCode(v.sessionId, sessById), shown_order: v.idx != null ? v.idx + 1 : '', task_id: v.taskId || '', event_type: et, event_value: v.value != null ? v.value : '', model: modelName(v.model), event_at: fmtTs(v.ts), event_ts: v.ts || '' });
              });
            }).catch(function () {});
          }).then(function () {
            return Store.listSurveys(uid).then(function (svs) {
              (svs || []).forEach(function (sv) { if (sv && keep(sv.sessionId || sv.id)) sRows.push(Object.assign({ participant_id: base.participant_id, account_id: uid, email: base.email, session_id: sv.sessionId || sv.id || '', session_code: sessCode(sv.sessionId || sv.id, sessById), completed_at: fmtTs(sv.completedAt) }, orderedAnswers('', sv.answers || {}, activeQuestions('surveyQuestions'), true))); });
            }).catch(function () {});
          });
        });
        return chain.then(function () {
          // Tasks sheet: one row per task in the active set OR seen in the data, so
          // every task_id used elsewhere resolves to its full text and outputs.
          Object.keys(taskById).forEach(function (id) { seenTaskIds[id] = true; });
          var taskRows = Object.keys(seenTaskIds).sort(taskIdSort).map(function (id) {
            var t = taskById[id] || {}, a = agg[id];
            return {
              task_id: id, title: t.title || '', domain: t.domain || '', complexity: t.complexity || '',
              in_active_set: activeById[id] ? 'yes' : 'no', n_responses: a ? a.n : 0,
              task_description: cellCap(t.task || t.prompt || ''),
              output_baseline: cellCap(t.outputA || ''), output_frontier: cellCap(t.outputB || ''),
              cost_baseline_usd: t.costA != null ? t.costA : '', cost_frontier_usd: t.costB != null ? t.costB : ''
            };
          });
          // Task summary sheet: analysis-ready aggregates, one row per task, over
          // the submitted responses in this export's scope.
          var sumRows = Object.keys(agg).sort(taskIdSort).map(function (id) {
            var a = agg[id], t = taskById[id] || {}, decisive = a.baseline + a.frontier;
            return {
              task_id: id, title: t.title || '', domain: t.domain || '', complexity: t.complexity || '',
              n_responses: a.n, n_baseline_preferred: a.baseline, n_frontier_preferred: a.frontier, n_tie: a.tie,
              frontier_win_rate: decisive ? round4(a.frontier / decisive) : '',
              mean_preference_model: a.prefN ? round4(a.prefSum / a.prefN) : '',
              mean_choice_ms: a.chN ? Math.round(a.chSum / a.chN) : '',
              mean_preference_ms: a.pfN ? Math.round(a.pfSum / a.pfN) : '',
              mean_answer_ms: a.anN ? Math.round(a.anSum / a.anN) : '',
              mean_response_ms: a.msN ? Math.round(a.msSum / a.msN) : '',
              cost_baseline_usd: t.costA != null ? t.costA : '', cost_frontier_usd: t.costB != null ? t.costB : ''
            };
          });
          var sheetMap = {
            Conventions: buildConventions(only),
            Sessions: buildSessionRows(sessions, parts, keep),
            Participants: pRows,
            Tasks: taskRows,
            'Task summary': sumRows,
            Responses: rRows,
            Events: eRows,
            Survey: sRows
          };
          // Aggregate path (Data analytics): hand the sheet map back so it can be
          // held in memory and have imported workbooks stacked onto it. Export path:
          // write the multi-tab workbook in SHEET_ORDER and download it.
          if (opts.returnSheets) return sheetMap;
          var wb = X.utils.book_new();
          SHEET_ORDER.forEach(function (name) { var rows = sheetMap[name] || []; X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.length ? rows : [{}]), name); });
          var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          var fname = only ? ('answerarena-session-' + (opts.sessionCode || only) + '-' + stamp + '.xlsx') : ('answerarena-data-' + stamp + '.xlsx');
          X.writeFile(wb, fname);
          toast('Export ready.');
        });
    });
  }
  // Build the aggregate sheet map for the ticked sessions (a { sessionId: true }
  // map) over the given participants, without downloading — the Data-analytics
  // Section 2 keeps it in memory. Reuses the exact export builder above.
  function collectAggregateSheets(parts, sessionIdMap) {
    return exportExcel(parts, { sessionIds: sessionIdMap, returnSheets: true });
  }
  // Human session code for an internal session id ('_none' = the default no-code
  // play; unknown ids fall back to the raw id so nothing is lost).
  function sessCode(id, map) {
    if (id == null || id === '') return '';
    if (String(id) === '_none') return '(default / no code)';
    var s = map && map[String(id)];
    return (s && s.code) ? s.code : String(id);
  }
  // Excel caps a cell at 32,767 chars; keep long model outputs safely under it so
  // the whole workbook never fails to write on one oversized answer.
  function cellCap(s) { s = String(s == null ? '' : s); return s.length > 32000 ? s.slice(0, 32000) + '… [truncated]' : s; }
  function round4(n) { return Math.round(n * 10000) / 10000; }
  // Sort task ids naturally so T2 precedes T10 (falls back to string order).
  function taskIdSort(a, b) {
    var na = parseInt(String(a).replace(/[^0-9]/g, ''), 10), nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  // The Sessions sheet: one row per session (documenting each session play), with
  // its snapshotted 2x2 + flow settings and a participant count from this export's
  // scope. Adds a synthetic row for the default no-code play if anyone took it.
  function buildSessionRows(sessions, parts, keep) {
    keep = keep || function () { return true; };
    var counts = {};
    (parts || []).forEach(function (p) {
      var seen = {};
      if (p.sessionId) seen[p.sessionId] = true;
      Object.keys(p.playedSessions || {}).forEach(function (sid) { seen[sid] = true; });
      Object.keys(p.completedSessions || {}).forEach(function (sid) { seen[sid] = true; });
      Object.keys(seen).forEach(function (sid) { counts[sid] = (counts[sid] || 0) + 1; });
    });
    var list = (sessions || []).slice().filter(function (s) { return keep(s.id); });
    list.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
    var rows = list.map(function (s) {
      var f = (s.condition && s.condition.factors) || {};
      var lim = s.comparisonsPerUser;
      return {
        session_id: s.id || '', session_code: s.code || '', name: s.name || '', status: s.status || 'open',
        cost_transparency_varied: f.transparency ? 'yes' : 'no', firm_pay_varied: f.incentive ? 'yes' : 'no',
        comparisons_per_participant: (lim == null) ? '(live setting)' : ((Number(lim) || 0) || 'whole active set'),
        randomize_order: (s.randomizeOrder === false) ? 'no' : 'yes',
        task_set_id: s.taskSetId || '', participants: counts[s.id] || 0, created_at: fmtTs(s.createdAt)
      };
    });
    if (keep('_none') && counts['_none']) {
      rows.push({ session_id: '_none', session_code: '(default / no code)', name: 'Default (no session code)', status: 'n/a', cost_transparency_varied: 'n/a', firm_pay_varied: 'n/a', comparisons_per_participant: '(live setting)', randomize_order: 'n/a', task_set_id: '', participants: counts['_none'], created_at: '' });
    }
    return rows;
  }
  // o1/o2 are the underlying models: o1 = outputA = baseline, o2 = outputB = frontier.
  function modelName(id) { return id === 'o1' ? 'baseline' : (id === 'o2' ? 'frontier' : (id || '')); }
  // One Responses row (shared by submitted answers and the saved draft). taskById
  // adds the task's title/domain/complexity so each row is self-describing for a
  // task-level pivot without a lookup; sessById maps the session id to its code.
  function respRow(base, v, submitted, responseMs, ts, taskById, sessById) {
    var t = (taskById && v.taskId != null && taskById[String(v.taskId)]) || {};
    return {
      participant_id: base.participant_id, account_id: base.account_id, email: base.email,
      session_id: v.sessionId || '', session_code: sessCode(v.sessionId, sessById || {}),
      shown_order: v.idx != null ? v.idx + 1 : '', task_id: v.taskId,
      task_title: t.title || '', task_domain: t.domain || '', task_complexity: t.complexity || '',
      submitted: submitted,
      choice: v.choice || '', chosen_model: modelName(v.chosenOutput),
      left_model: modelName(v.leftOutput), right_model: modelName(v.rightOutput),
      preference: v.prefLabel || '',
      preference_AB: v.prefValue != null ? v.prefValue : '',
      preference_model: v.prefModelValue != null ? v.prefModelValue : '',
      cost_baseline_usd: v.costBaseline != null ? v.costBaseline : '', cost_frontier_usd: v.costFrontier != null ? v.costFrontier : '',
      chosen_cost_usd: v.answerCost != null ? v.answerCost : '', running_cost_usd: v.runningCost != null ? v.runningCost : '',
      // Decision timing: the two stopwatches and their sum. Blank on older data
      // recorded before they were tracked (response_ms was the only timing then).
      choice_ms: v.choiceMs != null ? v.choiceMs : '',
      preference_ms: v.prefMs != null ? v.prefMs : '',
      answer_ms: v.answerMs != null ? v.answerMs : '',
      preference_source: v.prefSource || '',
      response_ms: responseMs, decided_at: fmtTs(ts), decided_ts: ts || '',
      cost_transparency: base.cost_transparency, firm_pay: base.firm_pay
    };
  }
  // Encode one 2x2 factor as a per-participant bit: 1 = treatment level, 0 =
  // control, '' when the factor was not varied (onFlag === false). Legacy data
  // without the onFlag falls back to a 1/0 from the stored level.
  function condBit(level, onFlag, treatmentLevel) {
    if (onFlag === false) return '';
    if (level == null || level === '') return '';
    return level === treatmentLevel ? 1 : 0;
  }
  // The "Conventions" sheet: documents every sheet and column used in the export
  // and the keys that join them - the source of truth for the workbook.
  function buildConventions(only) {
    var rows = [];
    function add(sheet, col, desc) { rows.push({ sheet: sheet, column: col, description: desc }); }
    // How the workbook fits together (the two unique IDs and how the sheets join).
    add('(guide)', 'workbook', 'Sheets: Sessions (one row per session play) · Participants (one row per person) · Tasks (one row per task pair = the unit of analysis) · Task summary (per-task aggregates) · Responses (one row per comparison) · Events (one row per click/change) · Survey (one row per completed survey).');
    add('(guide)', 'participant key', 'account_id is the unique, always-present participant ID (the Firebase anonymous UID). Join every sheet to Participants on account_id. participant_id (a Prolific-style ID) and email are OPTIONAL and usually blank, so do NOT join on them.');
    add('(guide)', 'task key', 'task_id is the unique task (task-pair) ID. Join Responses / Events / Task summary to Tasks on task_id to get the task description and the two answers. The task is the intended unit of analysis - use the Task summary sheet, or group Responses by task_id.');
    add('(guide)', 'session key', 'session_id is the internal session ID; session_code is its human join code. "_none" = the default no-code play. Join to the Sessions sheet on session_id.');
    add('(guide)', 'models', 'Two systems are compared, never named to participants: baseline (= Output A) and frontier (= Output B). Left/right placement is randomised per participant, so use *_model columns, not left/right.');
    add('Sessions', 'session_id', 'Internal unique ID of the session.');
    add('Sessions', 'session_code', 'The 6-character join code participants enter (or "_none" for the default no-code play).');
    add('Sessions', 'name', 'Optional admin label for the session.');
    add('Sessions', 'status', 'open (accepting joins), closed (no new joins), or n/a for the default play.');
    add('Sessions', 'cost_transparency_varied', 'yes if the cost-transparency factor was varied between participants in this session (snapshotted at creation); otherwise no.');
    add('Sessions', 'firm_pay_varied', 'yes if the firm-pay factor was varied between participants in this session; otherwise no.');
    add('Sessions', 'comparisons_per_participant', 'How many comparisons each participant is shown ("whole active set" = all of them), snapshotted at creation.');
    add('Sessions', 'randomize_order', 'yes if the comparison order is randomised per participant.');
    add('Sessions', 'task_set_id', 'Internal ID of the task set this session was pinned to at creation (blank = built-in default / live active set).');
    add('Sessions', 'participants', 'Number of participants (in this export) who played this session.');
    add('Sessions', 'created_at', 'When the session was created.');
    add('Participants', 'participant_id', "The participant's own ID (e.g. a Prolific ID) if they entered one; blank otherwise. NOT a reliable key - use account_id.");
    add('Participants', 'account_id', 'Unique, always-present participant ID (Firebase anonymous UID). The key to join every other sheet on.');
    add('Participants', 'email', "Legacy column - players take part anonymously, so this is blank (kept for older accounts).");
    add('Participants', 'status', 'Where the participant is in the flow: registered, playing, survey, or done. DERIVED: anyone who completed the session they point at (or who has completed a session and later re-entered the code-less default play) counts as done, whatever the last raw write says.');
    add('Participants', 'recorded_status', 'The raw status value stored on the participant record. It is a live cursor the app rewrites on every entry, so a finished participant who re-opened the app can read "playing" here; use the derived status column instead, and completed_session_ids for the detail.');
    add('Participants', 'current_session_id', 'Internal ID of the session the participant is currently in.');
    add('Participants', 'current_session_code', 'Join code of the session the participant is currently in.');
    add('Participants', 'comparisons_assigned', 'How many comparisons this participant was assigned in their most recent session (their shuffled set size); blank if they never started.');
    add('Participants', 'comparisons_submitted', 'How many comparisons this participant actually submitted (in this export\'s scope). A drop-out shows fewer submitted than assigned with status "playing" - this is the count of answers collected so far. Every submitted answer is also a row on the Responses sheet.');
    add('Participants', 'played_session_ids', 'Internal IDs of every session the participant has started (comma-separated).');
    add('Participants', 'completed_session_ids', 'Internal IDs of every session the participant has finished (comma-separated).');
    if (only) add('Participants', 'completed_this_session_at', 'When the participant finished THIS session, or "no" if not finished.');
    add('Participants', 'cost_transparency', 'Cost-transparency group: 1 = cost was shown to this participant (treatment), 0 = hidden (control); blank if this factor was not varied for their session.');
    add('Participants', 'firm_pay', 'Firm-pay group: 1 = the company pays (treatment), 0 = the user bears the cost (control); blank if this factor was not varied for their session.');
    add('Participants', 'registered_at', 'When the participant registered.');
    var regQs = (cfg.registrationQuestions && cfg.registrationQuestions.length) ? cfg.registrationQuestions : (D.registrationQuestions || []);
    regQs.forEach(function (q) { if (!q.system) add('Participants', 'reg_' + q.id, 'Registration answer: ' + (q.label || q.id)); });
    add('Tasks', 'task_id', 'Unique task (task-pair) ID - the Task ID column of the uploaded set. Join key for Responses / Events / Task summary.');
    add('Tasks', 'title', 'Short title of the task (if provided).');
    add('Tasks', 'domain', 'Task domain/category (if provided).');
    add('Tasks', 'complexity', 'Task complexity label (if provided).');
    add('Tasks', 'in_active_set', 'yes if this task is in the current active task set; no if it only appears in older recorded data (e.g. the active set changed since).');
    add('Tasks', 'n_responses', 'How many submitted comparisons in this export used this task.');
    add('Tasks', 'task_description', 'The full problem text shown to participants (the task). Long text is capped at ~32,000 characters.');
    add('Tasks', 'output_baseline', "The baseline model's answer (shown as Output A). Capped at ~32,000 characters.");
    add('Tasks', 'output_frontier', "The frontier model's answer (shown as Output B). Capped at ~32,000 characters.");
    add('Tasks', 'cost_baseline_usd', 'US$ cost of the baseline answer for this task (blank if none provided).');
    add('Tasks', 'cost_frontier_usd', 'US$ cost of the frontier answer for this task (blank if none provided).');
    add('Task summary', 'task_id', 'The task these aggregates are for (join to Tasks for the text). One row per task.');
    add('Task summary', 'title / domain / complexity', 'Copied from Tasks for convenience.');
    add('Task summary', 'n_responses', 'Number of submitted comparisons for this task in this export.');
    add('Task summary', 'n_baseline_preferred', 'How many participants preferred the baseline answer.');
    add('Task summary', 'n_frontier_preferred', 'How many participants preferred the frontier answer.');
    add('Task summary', 'n_tie', 'How many participants marked the two answers equally good.');
    add('Task summary', 'frontier_win_rate', 'n_frontier_preferred / (n_frontier_preferred + n_baseline_preferred), i.e. the frontier win share among decisive (non-tie) choices; blank if all ties.');
    add('Task summary', 'mean_preference_model', 'Mean of preference_model over this task (-3..+3): negative favours baseline, positive favours frontier.');
    add('Task summary', 'mean_choice_ms', 'Mean time (milliseconds) participants took to pick a side on this task (see Responses.choice_ms).');
    add('Task summary', 'mean_preference_ms', 'Mean time (milliseconds) participants then took to grade how much better it is (see Responses.preference_ms).');
    add('Task summary', 'mean_answer_ms', 'Mean TOTAL time (milliseconds) to a final answer for this task (see Responses.answer_ms).');
    add('Task summary', 'mean_response_ms', 'Mean time (milliseconds) from seeing the pair to pressing Next for this task.');
    add('Task summary', 'cost_baseline_usd / cost_frontier_usd', 'The two answers\' US$ costs for this task (from the uploaded set).');
    add('Responses', 'participant_id', "The participant's optional ID (see Participants); usually blank - join on account_id.");
    add('Responses', 'account_id', 'Unique participant ID (see Participants). The reliable join key.');
    add('Responses', 'email', "The participant's e-mail (legacy; usually blank).");
    add('Responses', 'session_id', 'Internal ID of the session this comparison belongs to.');
    add('Responses', 'session_code', 'Join code of that session ("_none" = default no-code play).');
    add('Responses', 'shown_order', "Position of this comparison in the participant's randomised sequence (1 = first shown).");
    add('Responses', 'task_id', 'ID of the task pair shown (e.g. T18); join to Tasks for the full description.');
    add('Responses', 'task_title', 'Title of the task shown (copied from the task set for convenience).');
    add('Responses', 'task_domain', 'Domain of the task shown.');
    add('Responses', 'task_complexity', 'Complexity of the task shown.');
    add('Responses', 'submitted', '"yes" for a submitted answer; "no (draft)" for an in-progress answer saved if the participant left before pressing Next.');
    add('Responses', 'choice', 'Which side the participant preferred: left, right, or tie (equally good).');
    add('Responses', 'chosen_model', 'Which underlying model the participant preferred: baseline, frontier, or tie.');
    add('Responses', 'left_model', "Which underlying model was shown on the LEFT (as 'Answer A') for this participant - left/right is randomised per pair.");
    add('Responses', 'right_model', "Which underlying model was shown on the RIGHT (as 'Answer B').");
    add('Responses', 'preference', 'The 7-point preference the participant set on the bar: "A much better" / "A better" / "A slightly better" / "Equal" / "B slightly better" / "B better" / "B much better" (A = Answer A on the left, B = Answer B on the right).');
    add('Responses', 'preference_AB', 'The preference as a number in the displayed frame: -3 = A much better … 0 = Equal … +3 = B much better (A = left, B = right).');
    add('Responses', 'preference_model', 'The preference mapped to the models: negative = baseline better, 0 = equal, positive = frontier better (-3..+3). The analysis-ready column.');
    add('Responses', 'cost_baseline_usd', 'US$ cost of the baseline model\'s answer for this task (from the uploaded file); blank if no cost was provided.');
    add('Responses', 'cost_frontier_usd', 'US$ cost of the frontier model\'s answer for this task; blank if no cost was provided.');
    add('Responses', 'chosen_cost_usd', 'US$ cost charged for this comparison: the chosen answer\'s cost, or the average of the two for a tie.');
    add('Responses', 'running_cost_usd', "Cumulative US$ cost of the participant's choices up to and including this comparison (shown live to the 'translated' cost-transparency group).");
    add('Responses', 'choice_ms', 'DECISION TIME, part 1: milliseconds from seeing the pair to picking a side (tapping an answer or "They\'re equally good"). Blank if the comparison was never answered.');
    add('Responses', 'preference_ms', 'DECISION TIME, part 2: milliseconds from that first pick to the final setting of the 7-point preference bar - the time spent deciding HOW MUCH better it is. Includes any revisions; 0 when the participant kept the degree seeded by tapping the answer (see preference_source).');
    add('Responses', 'answer_ms', 'TOTAL decision time in milliseconds: choice_ms + preference_ms exactly, i.e. from seeing the pair to the answer AND its preference being final.');
    add('Responses', 'preference_source', '"bar" = the participant set the degree themselves on the 7-point bar; "card" = they kept the degree seeded by tapping the answer (so preference_ms is 0 by construction). Blank if never answered.');
    add('Responses', 'response_ms', 'Time in milliseconds from seeing the pair to pressing Next. Always >= answer_ms; the difference is time spent re-reading after the answer was final.');
    add('Responses', 'decided_at', 'Local date/time when the comparison was decided.');
    add('Responses', 'decided_ts', 'Decision time as epoch milliseconds (useful for sorting).');
    add('Responses', 'cost_transparency', "The participant's cost-transparency group, 1/0 (see Participants).");
    add('Responses', 'firm_pay', "The participant's firm-pay group, 1/0 (see Participants).");
    add('Events', 'participant_id', "The participant's optional ID (usually blank - join on account_id).");
    add('Events', 'account_id', 'Unique participant ID (see Participants). The reliable join key.');
    add('Events', 'email', "The participant's e-mail (legacy; usually blank).");
    add('Events', 'session_id', 'Internal ID of the session.');
    add('Events', 'session_code', 'Join code of that session.');
    add('Events', 'shown_order', 'Position of the comparison this event refers to (1 = first shown).');
    add('Events', 'task_id', 'ID of the task pair.');
    add('Events', 'event_type', 'What the participant did: side_choice (tapped an answer or "equally good") or preference (moved the 7-point bar; event_value is -3..+3). Older data may also have satisfaction_answer_A/B.');
    add('Events', 'event_value', 'The value set: left/right/tie for a side_choice, -3..+3 for a preference in the DISPLAYED A/B frame (A = left; join to the matching Responses row for the model framing). Older data: 1-5 for a satisfaction rating.');
    add('Events', 'model', 'For a side_choice, which underlying model was tapped: baseline, frontier, or tie. Blank for preference events.');
    add('Events', 'event_at', 'Local date/time of the event.');
    add('Events', 'event_ts', 'Event time as epoch milliseconds. Every change is logged, so re-selections appear as multiple rows; the last per comparison is the final value.');
    add('Survey', 'participant_id', "The participant's optional ID (usually blank - join on account_id).");
    add('Survey', 'account_id', 'Unique participant ID (see Participants). The reliable join key.');
    add('Survey', 'email', "The participant's e-mail (legacy; usually blank).");
    add('Survey', 'session_id', 'Internal ID of the session the survey was taken for.');
    add('Survey', 'session_code', 'Join code of that session.');
    add('Survey', 'completed_at', 'When the participant submitted the survey for this session.');
    var surQs = (cfg.surveyQuestions && cfg.surveyQuestions.length) ? cfg.surveyQuestions : (D.surveyQuestions || []);
    surQs.forEach(function (q) { add('Survey', q.id, 'Survey answer: ' + (q.label || q.id)); });
    return rows;
  }
  function flatten(prefix, obj) { var o = {}; Object.keys(obj || {}).forEach(function (k) { var v = obj[k]; o[prefix + k] = (v && typeof v === 'object') ? JSON.stringify(v) : v; }); return o; }
  // Order a flattened answers object by the question-definition order, so export
  // columns follow the order participants saw the questions. System fields (e.g.
  // password) are skipped; unknown keys (renamed/removed questions) are appended
  // at the end so nothing is lost. fillMissing adds defined-but-blank questions as
  // empty columns, keeping the column set stable across rows (used for the survey).
  function orderedAnswers(prefix, answers, questions, fillMissing) {
    var flat = flatten(prefix, answers), out = {}, skip = {};
    (questions || []).forEach(function (q) {
      if (!q || !q.id) return;
      var k = prefix + q.id;
      if (q.system) { skip[k] = 1; return; }   // never export system fields (e.g. password)
      if (k in flat) out[k] = flat[k];
      else if (fillMissing) out[k] = '';
    });
    Object.keys(flat).forEach(function (k) { if (!(k in out) && !skip[k]) out[k] = flat[k]; });
    return out;
  }
  function activeQuestions(field) { return (cfg[field] && cfg[field].length) ? cfg[field] : (D[field] || []); }

  /* ---- misc ---- */
  function tsMs(ts) { if (!ts) return 0; if (typeof ts === 'number') return ts; if (typeof ts.toMillis === 'function') return ts.toMillis(); if (ts.seconds) return ts.seconds * 1000; return 0; }
  function fmtTs(ts) { var m = tsMs(ts); return m ? new Date(m).toLocaleString() : ''; }
  function ensureXLSX() { if (XLSX) return Promise.resolve(XLSX); return import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs').then(function (m) { XLSX = m; return m; }); }

  /* =====================================================================
     DATA ANALYTICS  (the "Data analytics" tab)
     ---------------------------------------------------------------------
     1) Data source   - tick sessions and/or import an exported Excel/CSV, Load.
     2) Aggregate     - consolidate every loaded source into one Excel (same
                        multi-tab structure as the export), held in memory.
     3) Process       - run Python (Pyodide) or R (WebR) on a chosen table from
                        the aggregate, entirely in the browser; output below.
     ===================================================================== */
  function daLoadSaved(key, dflt) { try { var v = localStorage.getItem(key); return v != null ? v : dflt; } catch (e) { return dflt; } }
  // Bump DA_TPL_VERSION whenever the bundled Python/R templates change. A saved
  // script from a previous version lives in localStorage and would otherwise
  // SHADOW the current template (daLoadSaved returns the saved copy) — that is how
  // an old, now-broken script kept running and looked like "Python won't run".
  // On a version change we drop the saved code so the fixed template loads fresh.
  var DA_TPL_VERSION = '2026-08-28-tasklists';
  function daMigrateTemplates() {
    try {
      if (localStorage.getItem('aa-da:ver') === DA_TPL_VERSION) return;
      localStorage.removeItem('aa-da:py');
      localStorage.removeItem('aa-da:r');
      localStorage.setItem('aa-da:ver', DA_TPL_VERSION);
    } catch (e) { /* ignore */ }
  }
  function emptySheetMap() { var m = {}; SHEET_ORDER.forEach(function (n) { m[n] = []; }); return m; }
  // Stack every sheet of an imported workbook onto the aggregate map: matched onto
  // an existing tab by (case-insensitive) name, else added as its own tab.
  function mergeBookIntoSheetMap(map, book) {
    (book.sheets || []).forEach(function (sh) {
      var key = Object.keys(map).filter(function (k) { return k.toLowerCase() === String(sh.name).toLowerCase(); })[0];
      if (!key) { key = String(sh.name); if (!map[key]) map[key] = []; }
      map[key] = (map[key] || []).concat(sh.rows || []);
    });
  }
  // Tab order for the aggregate: the standard sheets first, then any extra
  // (imported) sheets in insertion order.
  function orderSheetNames(map) {
    var order = SHEET_ORDER.filter(function (n) { return map[n] !== undefined; });
    Object.keys(map).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    return order;
  }
  function summarizeMap(m) {
    return (m.Responses || []).length + ' response' + ((m.Responses || []).length === 1 ? '' : 's')
      + ', ' + (m.Participants || []).length + ' participant' + ((m.Participants || []).length === 1 ? '' : 's')
      + ' across ' + (m.Sessions || []).length + ' session' + ((m.Sessions || []).length === 1 ? '' : 's');
  }
  // A valid, unique Excel sheet name (<=31 chars, no : \ / ? * [ ], no dupes).
  function safeSheetName(name, used) {
    var n = String(name).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
    var base = n, i = 2;
    while (used[n.toLowerCase()]) { var suf = ' (' + i + ')'; n = base.slice(0, 31 - suf.length) + suf; i++; }
    used[n.toLowerCase()] = true; return n;
  }

  /* ---- Section 2 "model provisioning" charts (over / indifference / under) ----
     For each comparison, preferring Opus (the bigger model) = OVER-provisioning,
     a tie = INDIFFERENCE, preferring Haiku (the smaller model) = UNDER-provisioning.
     We chart the % of each per task (Wilson CIs), then averaged across tasks by
     task type and by domain (each task weighted equally, with a delta-method CI
     that pools the per-task binomial errors, so unequal responses per task don't
     bias the group averages - see daGroupRate). */
  // task_id -> complexity (c) + domain (d), from the study's task list; used when
  // the exported Responses rows don't carry task_complexity/task_domain.
  var DA_TASK_META = {
    'T075': { c: 'Simple', d: 'Creative & Marketing' }, 'T080': { c: 'Simple', d: 'Creative & Marketing' },
    'T083': { c: 'Simple', d: 'Customer Support' }, 'T086': { c: 'Simple', d: 'Customer Support' },
    'T051': { c: 'Simple', d: 'Data Analysis' }, 'T064': { c: 'Simple', d: 'Extraction & Classification' },
    'T022': { c: 'Simple', d: 'Knowledge Q&A' }, 'T025': { c: 'Simple', d: 'Knowledge Q&A' },
    'T067': { c: 'Simple', d: 'Planning & Strategy' }, 'T073': { c: 'Simple', d: 'Planning & Strategy' },
    'T099': { c: 'Simple', d: 'Review & QA' }, 'T013': { c: 'Simple', d: 'Summarization' },
    'T016': { c: 'Simple', d: 'Summarization' }, 'T001': { c: 'Simple', d: 'Writing' },
    'T005': { c: 'Simple', d: 'Writing' }, 'T082': { c: 'Complex', d: 'Creative & Marketing' },
    'T085': { c: 'Complex', d: 'Customer Support' }, 'T054': { c: 'Complex', d: 'Data Analysis' },
    'T056': { c: 'Complex', d: 'Data Analysis' }, 'T065': { c: 'Complex', d: 'Extraction & Classification' },
    'T026': { c: 'Complex', d: 'Knowledge Q&A' }, 'T029': { c: 'Complex', d: 'Knowledge Q&A' },
    'T046': { c: 'Complex', d: 'Math & Reasoning' }, 'T048': { c: 'Complex', d: 'Math & Reasoning' },
    'T071': { c: 'Complex', d: 'Planning & Strategy' }, 'T098': { c: 'Complex', d: 'Review & QA' },
    'T018': { c: 'Complex', d: 'Summarization' }, 'T019': { c: 'Complex', d: 'Summarization' },
    'T002': { c: 'Complex', d: 'Writing' }, 'T009': { c: 'Complex', d: 'Writing' }
  };
  // SVG element (var()-based colours must be passed via a `style` attribute, since
  // SVG presentation attributes don't resolve CSS custom properties).
  function svgEl(tag, attrs, kids) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // Wilson score 95% interval for a proportion x/n (the right CI for a rate), 0..1.
  function daWilson(x, n) {
    if (n <= 0) return { lo: 0, hi: 0 };
    var z = 1.96, p = x / n, d = 1 + z * z / n;
    var c = (p + z * z / (2 * n)) / d, h = (z / d) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }
  // Group rate (by task type / domain) = the MEAN of the per-task proportions, so
  // each task is weighted equally regardless of how many responses it got. Its 95%
  // CI comes from the DELTA METHOD: SE = sqrt(sum of each task's binomial variance)
  // / k, with the Agresti-Coull adjusted variance so a task at 0% or 100% still
  // contributes uncertainty. The 30 tasks are the whole study (fixed, not sampled),
  // so only the finite student responses carry error — a t-interval ACROSS tasks
  // would add spurious task-sampling variance and, with only 2–4 tasks per domain,
  // blow the interval out to span 0–100%. `arr` holds task objects with `.n` and
  // the outcome count `ck` (cOver / cInd / cUnder). Returns { mean, lo, hi } (%).
  function daGroupRate(arr, ck) {
    var k = arr.length, z = 1.96; if (!k) return { mean: NaN, lo: NaN, hi: NaN, k: 0 };
    var mean = 0, sumVar = 0;
    arr.forEach(function (t) {
      var x = t[ck], n = t.n;
      mean += (n > 0 ? x / n : 0);                       // equal-weight mean of per-task rates
      var nt = n + z * z, pt = (x + z * z / 2) / nt;      // Agresti-Coull adjusted proportion
      sumVar += pt * (1 - pt) / nt;                       // this task's (regularised) variance
    });
    mean = 100 * mean / k;
    var se = 100 * Math.sqrt(sumVar) / k;                 // delta-method SE, in percent
    return { mean: mean, lo: Math.max(0, mean - z * se), hi: Math.min(100, mean + z * se), k: k };
  }
  // log-gamma (Lanczos) - only needed by daChiSqUpper below.
  function daLogGamma(z) {
    var g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var x = z, y = z, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  // Upper-tail probability of a chi-square with `dfree` df = the regularised
  // incomplete gamma Q(df/2, x/2): series below a+1, continued fraction above (the
  // standard split). Used only by the randomization-balance diagnostic, so an
  // approximation good to ~1e-10 is far more than enough.
  function daChiSqUpper(x, dfree) {
    if (!isFinite(x) || x < 0 || !isFinite(dfree) || dfree < 1) return NaN;
    if (x === 0) return 1;                                // no dispersion at all
    var a = dfree / 2, xx = x / 2, gln = daLogGamma(a), i;
    if (xx < a + 1) {                                     // series for P(a,x)
      var ap = a, sum = 1 / a, del = sum;
      for (i = 0; i < 500; i++) {
        ap++; del *= xx / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-13) break;
      }
      return Math.max(0, Math.min(1, 1 - sum * Math.exp(-xx + a * Math.log(xx) - gln)));
    }
    var b = xx + 1 - a, c = 1e300, d = 1 / b, h = d;      // continued fraction for Q(a,x)
    for (i = 1; i < 500; i++) {
      var an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; var dl = d * c; h *= dl;
      if (Math.abs(dl - 1) < 1e-13) break;
    }
    return Math.max(0, Math.min(1, h * Math.exp(-xx + a * Math.log(xx) - gln)));
  }
  // From the aggregate Responses sheet: how many students answered each task -
  // the randomization-balance view. Each student sees a random subset of the task
  // set, so the counts are never identical; the question is whether they are as
  // even as random assignment alone would make them. Drafts are excluded, exactly
  // like daProvisionData, so both blocks describe the same rows.
  function daBalanceData(sheetMap) {
    var resp = (sheetMap && sheetMap.Responses) || [];
    var byTask = {}, perStudent = {};
    resp.forEach(function (r) {
      var sub = r.submitted;
      if (sub != null && sub !== '' && String(sub).toLowerCase() !== 'yes') return;   // skip drafts
      var t = String(r.task_id == null ? '' : r.task_id).trim(); if (!t) return;
      var o = byTask[t] || (byTask[t] = { n: 0, dec: 0, tie: 0, st: {}, cx: '', dm: '' });
      o.n++;                                              // every submitted response counts
      var cm = String(r.chosen_model == null ? '' : r.chosen_model).trim().toLowerCase();
      if (cm === 'frontier' || cm === 'baseline') o.dec++;      // decisive = a model was chosen
      else if (cm === 'tie') o.tie++;
      var a = String(r.account_id == null ? '' : r.account_id).trim();
      if (a) { o.st[a] = true; perStudent[a] = (perStudent[a] || 0) + 1; }
      if (!o.cx) {                                        // resolve complexity/domain once per task
        var meta = DA_TASK_META[t] || {};
        var dc = r.task_complexity == null ? '' : String(r.task_complexity).trim();
        var dd = r.task_domain == null ? '' : String(r.task_domain).trim();
        o.cx = (dc && dc.toLowerCase() !== 'nan') ? dc : (meta.c || '(unknown)');
        o.dm = (dd && dd.toLowerCase() !== 'nan') ? dd : (meta.d || '(unknown)');
      }
    });
    var tasks = Object.keys(byTask).map(function (t) {
      var o = byTask[t];
      return { task: t, n: o.n, dec: o.dec, tie: o.tie, students: Object.keys(o.st).length, cx: o.cx, dm: o.dm };
    }).sort(function (a, b) { return (b.n - a.n) || (a.task < b.task ? -1 : 1); });
    var k = tasks.length;
    if (!k) return null;
    var counts = tasks.map(function (t) { return t.n; });
    var total = counts.reduce(function (s, v) { return s + v; }, 0);
    var mean = total / k;
    var srt = counts.slice().sort(function (a, b) { return a - b; });
    var median = k % 2 ? srt[(k - 1) / 2] : (srt[k / 2 - 1] + srt[k / 2]) / 2;
    var ss = counts.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0);
    var sd = k > 1 ? Math.sqrt(ss / (k - 1)) : 0;
    var freq = {};                                        // count value -> the tasks that got it
    tasks.forEach(function (t) { (freq[t.n] = freq[t.n] || []).push(t.task); });
    var mode = srt[0], modeN = 0;                         // most common count (lowest value wins a tie)
    Object.keys(freq).map(Number).sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (freq[v].length > modeN) { modeN = freq[v].length; mode = v; }
    });
    // How uneven SHOULD the counts be? If every student really drew a uniform
    // random subset, student i's m_i answers give each task an independent
    // q_i = m_i/k chance of being picked, so a task's count has variance
    // sum_i q_i(1-q_i). Comparing the observed spread with that expectation is
    // what turns "the bars are uneven" into "the bars are uneven BY THE RIGHT
    // AMOUNT". (Slightly conservative: it ignores the mild negative correlation
    // from sampling a student's subset without replacement.)
    var expVar = 0;
    Object.keys(perStudent).forEach(function (a) { var q = perStudent[a] / k; expVar += q * (1 - q); });
    var chi = expVar > 0 ? ss / expVar : NaN;             // dispersion statistic ~ chi2(k-1)
    return { tasks: tasks, k: k, total: total, mean: mean, median: median, mode: mode, modeN: modeN,
             min: srt[0], max: srt[k - 1], sd: sd, expSd: Math.sqrt(expVar), chi: chi,
             p: (k > 1 && expVar > 0) ? daChiSqUpper(chi, k - 1) : NaN,
             freq: freq, nStudents: Object.keys(perStudent).length,
             // A student answering the same task twice would inflate a count without
             // adding a person - worth saying out loud rather than silently averaging.
             repeats: tasks.filter(function (t) { return t.students > 0 && t.students < t.n; }).length };
  }
  // From the aggregate Responses sheet: per-task over/indifference/under rates
  // (% Opus / % tie / % Haiku) + Wilson CIs, plus the group averages (by task type
  // and by domain) as equal-weight means across tasks with delta-method CIs
  // (daGroupRate). Drafts are excluded.
  function daProvisionData(sheetMap) {
    var resp = (sheetMap && sheetMap.Responses) || [];
    var byTask = {};
    resp.forEach(function (r) {
      var sub = r.submitted;
      if (sub != null && sub !== '' && String(sub).toLowerCase() !== 'yes') return;   // skip drafts
      var t = String(r.task_id == null ? '' : r.task_id).trim(); if (!t) return;
      var cm = String(r.chosen_model == null ? '' : r.chosen_model).trim().toLowerCase();
      // Classify BEFORE creating the task entry: a row with an unrecognised
      // chosen_model (possible in an imported foreign CSV) must not leave an
      // n=0 task behind - that used to render NaN% bars and a phantom
      // empty-label row in the by-type / by-domain charts.
      var cat = cm === 'frontier' ? 'over' : (cm === 'tie' ? 'ind' : (cm === 'baseline' ? 'under' : ''));
      if (!cat) return;
      var o = byTask[t] || (byTask[t] = { n: 0, over: 0, ind: 0, under: 0, cx: '', dm: '' });
      o[cat]++;
      o.n++;
      if (!o.cx) {                                        // resolve complexity/domain once per task
        var meta = DA_TASK_META[t] || {};
        var dc = r.task_complexity == null ? '' : String(r.task_complexity).trim();
        var dd = r.task_domain == null ? '' : String(r.task_domain).trim();
        o.cx = (dc && dc.toLowerCase() !== 'nan') ? dc : (meta.c || '(unknown)');
        o.dm = (dd && dd.toLowerCase() !== 'nan') ? dd : (meta.d || '(unknown)');
      }
    });
    var tasks = Object.keys(byTask).map(function (t) {
      var o = byTask[t];
      return { task: t, n: o.n, cx: o.cx, dm: o.dm,
        cOver: o.over, cInd: o.ind, cUnder: o.under,   // raw counts (for the delta-method group CI)
        over: 100 * o.over / o.n, ind: 100 * o.ind / o.n, under: 100 * o.under / o.n,
        overCI: daWilson(o.over, o.n), indCI: daWilson(o.ind, o.n), underCI: daWilson(o.under, o.n) };
    });
    function aggBy(keyFn) {
      var groups = {};
      tasks.forEach(function (t) { var k = keyFn(t); (groups[k] = groups[k] || []).push(t); });
      return Object.keys(groups).sort().map(function (k) {
        var arr = groups[k];
        return { label: k, nTasks: arr.length,
          over: daGroupRate(arr, 'cOver'), ind: daGroupRate(arr, 'cInd'), under: daGroupRate(arr, 'cUnder') };
      });
    }
    return { tasks: tasks, byType: aggBy(function (t) { return t.cx; }), byDomain: aggBy(function (t) { return t.dm; }) };
  }
  var DA_PROV = {
    over: { c: '#e67e22', name: 'Over-provision (Opus)' },
    ind: { c: '#9a978f', name: 'Indifferent (tie)' },
    under: { c: '#3d7bd6', name: 'Under-provision (Haiku)' }
  };
  // Horizontal grouped-bar SVG: one band per group, three bars (over/ind/under)
  // each with a 95% CI whisker. Each group's bars are objects with `.value`
  // (per-task) or `.mean` (aggregate) plus `.lo`/`.hi` in percent.
  function daProvChart(groups, labelW) {
    var W = 760, bandH = 46, top = 6, legendH = 24, bottom = 24;
    var plotL = labelW, plotR = W - 14, plotW = plotR - plotL;
    var H = top + legendH + groups.length * bandH + bottom;
    function xs(v) { return plotL + Math.max(0, Math.min(100, v)) / 100 * plotW; }
    var svg = svgEl('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, style: 'max-width:' + W + 'px;display:block;' });
    [0, 25, 50, 75, 100].forEach(function (g) {                 // gridlines + % ticks
      svg.appendChild(svgEl('line', { x1: xs(g), y1: top + legendH, x2: xs(g), y2: H - bottom, style: 'stroke:var(--line);stroke-width:1;' }));
      svg.appendChild(svgEl('text', { x: xs(g), y: H - bottom + 14, 'text-anchor': 'middle', 'font-size': '10', style: 'fill:var(--muted);' }, [g + '%']));
    });
    var lx = plotL;                                            // legend
    ['over', 'ind', 'under'].forEach(function (k) {
      svg.appendChild(svgEl('rect', { x: lx, y: top, width: '11', height: '11', rx: '2', fill: DA_PROV[k].c }));
      svg.appendChild(svgEl('text', { x: lx + 15, y: top + 9, 'font-size': '10.5', style: 'fill:var(--ink);' }, [DA_PROV[k].name]));
      lx += 15 + DA_PROV[k].name.length * 6 + 16;
    });
    groups.forEach(function (grp, gi) {
      var by = top + legendH + gi * bandH;
      svg.appendChild(svgEl('text', { x: plotL - 7, y: by + bandH / 2 + 3, 'text-anchor': 'end', 'font-size': '10.5', style: 'fill:var(--ink);' }, [grp.label]));
      var gap = 3, barH = (bandH - 2 * gap) / 3;
      ['over', 'ind', 'under'].forEach(function (k, bi) {
        var b = grp[k]; var val = b.value != null ? b.value : b.mean;
        var y = by + gap + bi * barH + 1, h = barH - 2;
        svg.appendChild(svgEl('rect', { x: plotL, y: y, width: Math.max(0, xs(val) - plotL), height: h, rx: '2', fill: DA_PROV[k].c }));
        // Value label: after the bar, but right-aligned inside for near-full bars so
        // it never clips at the edge.
        var lblX = val >= 85 ? plotR - 2 : xs(val) + 3, anchor = val >= 85 ? 'end' : 'start';
        svg.appendChild(svgEl('text', { x: lblX, y: y + h - 1, 'text-anchor': anchor, 'font-size': '9', style: 'fill:var(--muted);' }, [Math.round(val) + '%']));
        if (b.lo != null && b.hi != null && !isNaN(b.lo) && !isNaN(b.hi)) {   // 95% CI whisker
          var cy = y + h / 2;
          svg.appendChild(svgEl('line', { x1: xs(b.lo), y1: cy, x2: xs(b.hi), y2: cy, style: 'stroke:var(--ink);stroke-width:1;' }));
          svg.appendChild(svgEl('line', { x1: xs(b.lo), y1: cy - 3, x2: xs(b.lo), y2: cy + 3, style: 'stroke:var(--ink);stroke-width:1;' }));
          svg.appendChild(svgEl('line', { x1: xs(b.hi), y1: cy - 3, x2: xs(b.hi), y2: cy + 3, style: 'stroke:var(--ink);stroke-width:1;' }));
        }
      });
    });
    return svg;
  }
  var DA_BAL = { dec: '#4a6fa5', tie: '#9a978f', mark: '#e67e22' };
  // Chart A - the DISTRIBUTION of responses per task: one row per response count,
  // one dot per task that got exactly that many, with the median / mode / fewest /
  // most rows called out. It answers "how even was the random assignment?" in the
  // shape of the data itself, which a per-task bar chart (chart B) cannot show.
  function daDistChart(bal) {
    // Rows are equal-width buckets of the response count, aimed at ~14 rows so the
    // shape is readable: width 1 (one row per exact count, like a tally) whenever
    // the observed range is short enough, wider buckets when it is not. Empty rows
    // INSIDE the range are kept - a gap is part of the shape.
    var rows = [], span = bal.max - bal.min + 1, w = Math.max(1, Math.ceil(span / 14));
    for (var lo = bal.min; lo <= bal.max; lo += w) {
      var hi = Math.min(bal.max, lo + w - 1), ids = [];
      for (var q = lo; q <= hi; q++) if (bal.freq[q]) ids = ids.concat(bal.freq[q]);
      rows.push({ lo: lo, hi: hi, label: lo === hi ? String(lo) : (lo + '–' + hi), tasks: ids });
    }
    // The median ROW is the middle task's own count (the median itself can fall
    // between two integers when the task count is even; the note prints the exact value).
    var medRow = bal.tasks.map(function (t) { return t.n; }).sort(function (a, b) { return a - b; })[Math.floor((bal.k - 1) / 2)];
    var W = 760, rowH = 22, top = 10, bottom = 10, labelW = 46, dotX = labelW + 14;
    var H = top + rows.length * rowH + bottom;
    var maxRow = rows.reduce(function (m, r) { return Math.max(m, r.tasks.length); }, 1);
    var pitch = Math.max(3.5, Math.min(13, 300 / maxRow));   // dots never run past ~300px
    var rad = Math.max(1.8, Math.min(4.2, pitch * 0.36));
    var cntX = dotX + maxRow * pitch + 8, annoX = cntX + 46;
    var svg = svgEl('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, style: 'max-width:' + W + 'px;display:block;' });
    rows.forEach(function (r, i) {
      var y = top + i * rowH + rowH / 2;
      var inRow = function (x) { return x >= r.lo && x <= r.hi; };
      svg.appendChild(svgEl('text', { x: labelW, y: y + 4, 'text-anchor': 'end', 'font-size': '11.5',
        style: 'fill:var(--ink);font-variant-numeric:tabular-nums;' }, [r.label]));
      r.tasks.forEach(function (id, j) {
        var dot = svgEl('circle', { cx: dotX + j * pitch + rad, cy: y, r: rad, fill: DA_BAL.dec });
        dot.appendChild(svgEl('title', { text: id + ': ' + r.label + (r.lo === 1 && r.hi === 1 ? ' response' : ' responses') }));
        svg.appendChild(dot);
      });
      if (r.tasks.length) {
        var cnt = svgEl('text', { x: cntX, y: y + 4, 'font-size': '10', style: 'fill:var(--muted);' },
          [r.tasks.length + (r.tasks.length === 1 ? ' task' : ' tasks')]);
        cnt.appendChild(svgEl('title', { text: r.tasks.join(', ') }));
        svg.appendChild(cnt);
      }
      var marks = [];
      if (inRow(medRow)) marks.push('median');
      if (inRow(bal.mode)) marks.push('mode');
      if (inRow(bal.min)) marks.push(daIdList(bal.freq[bal.min]) + ' (fewest)');
      if (inRow(bal.max) && bal.max !== bal.min) marks.push(daIdList(bal.freq[bal.max]) + ' (most)');
      if (marks.length) {
        svg.appendChild(svgEl('text', { x: annoX, y: y + 4, 'font-size': '11', style: 'fill:var(--muted);' },
          ['← ' + marks.join(' · ')]));
      }
    });
    return svg;
  }
  // "T205, T229" - at most three ids so a long tie does not run off the chart.
  function daIdList(ids) {
    ids = ids || [];
    return ids.length <= 3 ? ids.join(', ') : (ids.slice(0, 3).join(', ') + ' +' + (ids.length - 3));
  }
  // Chart B - one bar per task, descending: the whole bar is every response the
  // task got, the darker part the DECISIVE ones (a model was chosen, ties
  // excluded). The dashed line is the mean, so a glance shows who is under-served.
  function daTaskCountChart(bal) {
    var tasks = bal.tasks, W = 760, bandH = 17, top = 22, bottom = 22, labelW = 196;
    var plotL = labelW, plotR = W - 52, plotW = plotR - plotL;
    var max = Math.max(1, tasks.reduce(function (m, t) { return Math.max(m, t.n); }, 0));
    var H = top + tasks.length * bandH + bottom;
    var xs = function (v) { return plotL + Math.max(0, Math.min(max, v)) / max * plotW; };
    var svg = svgEl('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, style: 'max-width:' + W + 'px;display:block;' });
    var lx = plotL;                                        // legend
    [['dec', 'decisive (a model was chosen)'], ['tie', 'ties / unclassified']].forEach(function (e) {
      svg.appendChild(svgEl('rect', { x: lx, y: 4, width: '11', height: '11', rx: '2', fill: DA_BAL[e[0]] }));
      svg.appendChild(svgEl('text', { x: lx + 15, y: 13, 'font-size': '10.5', style: 'fill:var(--ink);' }, [e[1]]));
      lx += 15 + e[1].length * 6 + 16;
    });
    tasks.forEach(function (t, i) {
      var y = top + i * bandH, h = bandH - 4;
      var lbl = t.task + (t.dm && t.dm !== '(unknown)' ? ' · ' + t.dm : '');
      if (lbl.length > 34) lbl = lbl.slice(0, 33) + '…';
      var lt = svgEl('text', { x: plotL - 7, y: y + h - 1, 'text-anchor': 'end', 'font-size': '10.5', style: 'fill:var(--ink);' }, [lbl]);
      lt.appendChild(svgEl('title', { text: t.task + ' · ' + t.dm + ' · ' + t.cx + ' — ' + t.n + (t.n === 1 ? ' response' : ' responses')
        + ' from ' + t.students + (t.students === 1 ? ' student' : ' students') + ', ' + t.dec + ' decisive' }));
      svg.appendChild(lt);
      svg.appendChild(svgEl('rect', { x: plotL, y: y, width: Math.max(0, xs(t.n) - plotL), height: h, rx: '2', fill: DA_BAL.tie }));
      svg.appendChild(svgEl('rect', { x: plotL, y: y, width: Math.max(0, xs(t.dec) - plotL), height: h, rx: '2', fill: DA_BAL.dec }));
      svg.appendChild(svgEl('text', { x: xs(t.n) + 4, y: y + h - 1, 'font-size': '9.5', style: 'fill:var(--muted);' }, [t.n + ' · ' + t.dec + ' dec']));
    });
    svg.appendChild(svgEl('line', { x1: xs(bal.mean), y1: top - 4, x2: xs(bal.mean), y2: H - bottom + 2,
      'stroke-dasharray': '4 3', style: 'stroke:' + DA_BAL.mark + ';stroke-width:2;' }));
    svg.appendChild(svgEl('text', { x: xs(bal.mean), y: H - bottom + 14, 'text-anchor': 'middle', 'font-size': '10',
      style: 'fill:' + DA_BAL.mark + ';' }, ['mean ' + bal.mean.toFixed(1)]));
    return svg;
  }
  // Render the randomization-balance block (distribution + per-task counts).
  function renderBalance(container, sheetMap) {
    container.innerHTML = '';
    var bal = daBalanceData(sheetMap);
    if (!bal) return;                                      // no per-task Responses to plot
    // Is the unevenness just randomness? Compare the observed spread with the
    // spread random assignment alone produces (see daBalanceData). Read BOTH
    // tails: too wide means some tasks were reachable less often than others,
    // too narrow means the counts are more even than a random draw can be (a
    // deliberately balanced allocation - or stacked/duplicated data).
    var verdict;
    if (bal.expSd === 0) {
      verdict = 'Every student answered every task, so there is <b>no randomness here to judge</b> — the counts can only be equal.';
    } else if (!isFinite(bal.p) || bal.k < 5 || bal.total < 20) {
      verdict = 'There is <b>too little data to judge the spread</b> yet.';
    } else if (bal.p < 0.05) {
      verdict = 'The spread is <b>wider than random assignment alone explains</b> (dispersion test p = ' + daP(bal.p) + ') — worth checking that every task really was in every session\'s task set.';
    } else if (1 - bal.p < 0.05) {
      verdict = 'The counts are <b>more even than a random draw would be</b> (dispersion test p = ' + daP(1 - bal.p) + ' in the other tail) — fine if the allocation is deliberately balanced, but check for stacked or duplicated sources.';
    } else {
      verdict = 'The spread is <b>consistent with random assignment</b> (dispersion test p = ' + daP(bal.p) + '), i.e. as even as chance allows.';
    }
    container.appendChild(el('div', { class: 'aa-sub', style: 'margin:20px 0 4px;', text: 'Randomization balance — how many students answered each task' }));
    container.appendChild(el('p', { class: 'aa-note', html:
      'Each student sees a <b>random subset</b> of the tasks, so the counts are never identical — the question is whether they are as even as chance alone would make them. ' +
      '<b>' + bal.total + '</b> submitted responses from <b>' + bal.nStudents + '</b> students over <b>' + bal.k + '</b> tasks: ' +
      'fewest <b>' + bal.min + '</b>, median <b>' + (Math.round(bal.median * 10) / 10) + '</b>, mean <b>' + bal.mean.toFixed(1) + '</b>, most <b>' + bal.max + '</b> ' +
      '(SD ' + bal.sd.toFixed(1) + ' vs ' + bal.expSd.toFixed(1) + ' expected under the randomization). ' + verdict +
      (bal.repeats ? ' <b>Note:</b> ' + bal.repeats + ' task(s) hold more responses than distinct students — the same student answered one twice, or two sources were stacked.' : '') })
    );
    container.appendChild(el('div', { class: 'aa-sub2', text: 'Distribution of responses per task (each dot is one task)' }));
    container.appendChild(el('div', { class: 'aa-provscroll' }, [daDistChart(bal)]));
    container.appendChild(el('div', { class: 'aa-sub2', text: 'Per task, in descending order (' + bal.k + ' tasks)' }));
    container.appendChild(el('div', { class: 'aa-provscroll' }, [daTaskCountChart(bal)]));
  }
  // p-value for prose: 3 significant digits, "<0.001" below that.
  function daP(p) { return p < 0.001 ? '<0.001' : (Math.round(p * 1000) / 1000).toFixed(3); }
  // Render the three provisioning charts into `container` from the aggregate.
  function renderProvisioning(container, sheetMap) {
    container.innerHTML = '';
    var data = daProvisionData(sheetMap);
    if (!data.tasks.length) return;                            // no per-task Responses to plot
    container.appendChild(el('div', { class: 'aa-sub', style: 'margin:20px 0 4px;', text: 'Model provisioning — over / indifference / under' }));
    container.appendChild(el('p', { class: 'aa-note', html: 'Preferring <b>Opus</b> = <b>over-provisioning</b> (a bigger model than a simple task needs), a <b>tie</b> = <b>indifference</b>, preferring <b>Haiku</b> = <b>under-provisioning</b>. Bars are the % of responses in each; whiskers are 95% CIs — a <b>Wilson</b> interval per task, and for the type/domain averages the mean of the per-task rates (each task weighted equally) with a CI that pools the per-task sampling errors (<b>delta method</b>), so unequal responses per task don\'t bias the averages. These descriptive CIs treat responses as independent across tasks (the same student answers several tasks in a group); the formal tests in Section&nbsp;3 additionally cluster on the student.' }));

    var taskGroups = data.tasks.slice().sort(function (a, b) { return b.over - a.over; }).map(function (t) {
      return { label: t.task + ' (n=' + t.n + ')',
        over: { value: t.over, lo: t.overCI.lo * 100, hi: t.overCI.hi * 100 },
        ind: { value: t.ind, lo: t.indCI.lo * 100, hi: t.indCI.hi * 100 },
        under: { value: t.under, lo: t.underCI.lo * 100, hi: t.underCI.hi * 100 } };
    });
    var aggGroups = function (arr) { return arr.map(function (g) { return { label: g.label + ' (' + g.nTasks + ')', over: g.over, ind: g.ind, under: g.under }; }); };

    container.appendChild(el('div', { class: 'aa-sub2', text: 'Per task (' + data.tasks.length + ' tasks, sorted by over-provision rate)' }));
    var scroll = el('div', { class: 'aa-provscroll' }, [daProvChart(taskGroups, 82)]);
    container.appendChild(scroll);
    container.appendChild(el('div', { class: 'aa-sub2', text: 'By task type (average across tasks)' }));
    container.appendChild(daProvChart(aggGroups(data.byType), 130));
    container.appendChild(el('div', { class: 'aa-sub2', text: 'By domain (average across tasks)' }));
    container.appendChild(daProvChart(aggGroups(data.byDomain), 190));
  }

  function renderAnalytics() {
    clearRoot();
    var wrap = el('div', { class: 'aa-wrap aa-wrap2' });
    wrap.appendChild(headerRow());
    wrap.appendChild(el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Data analytics' }),
      el('p', { class: 'aa-note', html: 'Load your session data (or import an already-exported Excel), consolidate it into a single workbook, then run Python or R on it — compiled entirely in your browser (nothing is uploaded). Each comparison asked a blind participant which answer they preferred (Haiku vs Opus, unlabelled) and how strongly, and the bundled scripts answer <b>one question</b> from it: <b>for which specific task IDs can we say with 95% confidence that Haiku is preferred, and for which Opus?</b> — then the same again at <b>99%</b>. Four steps:' })
    ]));
    daRefs = {};   // this render's sections register their live refreshers here
    wrap.appendChild(buildDaSection1());
    wrap.appendChild(buildDaSection2());
    wrap.appendChild(buildDaSection3());
    wrap.appendChild(buildDaSection4());
    root.appendChild(wrap);
  }

  /* ---- Section 1: data source ---- */
  function buildDaSection1() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('div', { class: 'aa-sechead' }, [el('span', { class: 'aa-secnum', text: '1' }), el('h3', { text: 'Data source', style: 'margin:0;' })]));
    card.appendChild(el('p', { class: 'aa-note', html: 'Tick the sessions to include, and/or <b>import an exported Excel/CSV</b> (a per-session or all-data export from this admin). Then press <b>Load</b> to pull them into memory for Section 2.' }));

    var listWrap = el('div', { class: 'aa-seclist' }, [el('p', { class: 'aa-note', text: 'Loading sessions…' })]);
    card.appendChild(listWrap);

    var loadBtn = el('button', { class: 'aa-btn', on: { click: doLoad } }, ['Load']);
    var selAll = el('button', { class: 'aa-btn sec sm', on: { click: function () { setAll(true); } } }, ['Select all']);
    var clr = el('button', { class: 'aa-btn sec sm', on: { click: function () { setAll(false); } } }, ['Clear']);
    var refreshB = el('button', { class: 'aa-btn sec sm', on: { click: loadSessions } }, ['↻ Refresh']);
    var fileIn = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none;' });
    var importB = el('button', { class: 'aa-btn sec', on: { click: function () { fileIn.click(); } } }, ['Import Excel / CSV']);
    fileIn.addEventListener('change', onImport);

    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [selAll, clr, refreshB, importB]));
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [loadBtn]));
    var status = el('div', { class: 'aa-runstatus' });
    card.appendChild(status);
    card.appendChild(fileIn);

    loadSessions();

    function loadSessions() {
      // Show the cached list immediately on re-entry (no transient blank); only
      // show the loading placeholder on the very first fetch.
      if (daState.sessions) render();
      else { listWrap.innerHTML = ''; listWrap.appendChild(el('p', { class: 'aa-note', text: 'Loading sessions…' })); }
      Promise.all([Store.listSessions(), Store.listParticipants().catch(function () { return []; })]).then(function (res) {
        daState.sessions = res[0] || [];
        daState.allParts = res[1] || [];
        daState.sessions.sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
        render();
      }).catch(function (e) {
        // Keep whatever is already shown if we have a cached list; only surface the
        // error when there is nothing to fall back to.
        if (daState.sessions) { toast('Could not refresh sessions: ' + ((e && e.code) || (e && e.message) || 'error')); return; }
        listWrap.innerHTML = '';
        listWrap.appendChild(el('p', { class: 'aa-err', text: 'Could not load sessions: ' + ((e && e.code) || (e && e.message) || 'error') }));
      });
    }
    function partCounts() {
      var c = {};
      (daState.allParts || []).forEach(function (p) {
        var seen = {}; if (p.sessionId) seen[p.sessionId] = true;
        Object.keys(p.playedSessions || {}).forEach(function (s) { seen[s] = true; });
        Object.keys(p.completedSessions || {}).forEach(function (s) { seen[s] = true; });
        Object.keys(seen).forEach(function (s) { c[s] = (c[s] || 0) + 1; });
      });
      return c;
    }
    function setAll(on) {
      (daState.sessions || []).forEach(function (s) { if (on) daState.selected[s.id] = true; else delete daState.selected[s.id]; });
      daState.importedBooks.forEach(function (b) { b.selected = on; });
      render();
    }
    function render() {
      listWrap.innerHTML = '';
      var c = partCounts();
      var sess = daState.sessions || [];
      if (!sess.length && !daState.importedBooks.length) {
        listWrap.appendChild(el('p', { class: 'aa-note', text: 'No sessions yet. Create one from the Admin tab, or import an Excel/CSV file.' }));
        updateLoadLabel(); return;
      }
      sess.forEach(function (s) {
        var cb = el('input', { type: 'checkbox' }); if (daState.selected[s.id]) cb.setAttribute('checked', 'checked');
        cb.addEventListener('change', function () { if (cb.checked) daState.selected[s.id] = true; else delete daState.selected[s.id]; updateLoadLabel(); });
        var n = c[s.id] || 0;
        var meta = el('div', { class: 'g' }, [
          el('b', { text: s.code || s.id }), ' ',
          el('span', { class: 'aa-badge ' + (s.status || 'open'), text: (s.status || 'open') }),
          el('div', { class: 'aa-note', style: 'margin-top:2px;', text: (s.name ? s.name + ' · ' : '') + n + ' participant' + (n === 1 ? '' : 's') + ' · ' + condLabel(s.condition) })
        ]);
        listWrap.appendChild(el('label', { class: 'aa-checkrow' }, [cb, meta]));
      });
      daState.importedBooks.forEach(function (b) {
        var cb = el('input', { type: 'checkbox' }); if (b.selected) cb.setAttribute('checked', 'checked');
        cb.addEventListener('change', function () { b.selected = cb.checked; updateLoadLabel(); });
        var rm = el('button', { class: 'aa-btn danger sm', on: { click: function (e) { e.preventDefault(); daState.importedBooks = daState.importedBooks.filter(function (x) { return x !== b; }); render(); } } }, ['remove']);
        var meta = el('div', { class: 'g' }, [
          el('b', { text: b.label }), ' ', el('span', { class: 'aa-tag blue', text: 'imported' }),
          el('div', { class: 'aa-note', style: 'margin-top:2px;', text: b.sheets.length + ' sheet' + (b.sheets.length === 1 ? '' : 's') + ' · ' + b.totalRows + ' rows' })
        ]);
        listWrap.appendChild(el('label', { class: 'aa-checkrow' }, [cb, meta, rm]));
      });
      updateLoadLabel();
    }
    function updateLoadLabel() {
      var ns = Object.keys(daState.selected).filter(function (k) { return daState.selected[k]; }).length;
      var nf = daState.importedBooks.filter(function (b) { return b.selected; }).length;
      var bits = []; if (ns) bits.push(ns + ' session' + (ns === 1 ? '' : 's')); if (nf) bits.push(nf + ' file' + (nf === 1 ? '' : 's'));
      loadBtn.textContent = bits.length ? ('Load ' + bits.join(' + ')) : 'Load';
    }
    function onImport() {
      var f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      var isCsv = /\.csv$/i.test(f.name);
      status.textContent = 'Reading ' + f.name + '…';
      ensureXLSX().then(function (X) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var sheets;
            if (isCsv) {
              var wbc = X.read(e.target.result, { type: 'string' });
              sheets = [{ name: 'Responses', rows: X.utils.sheet_to_json(wbc.Sheets[wbc.SheetNames[0]], { defval: '' }) }];
            } else {
              var wb = X.read(new Uint8Array(e.target.result), { type: 'array' });
              sheets = wb.SheetNames.map(function (nm) { return { name: nm, rows: X.utils.sheet_to_json(wb.Sheets[nm], { defval: '' }) }; });
            }
            sheets = sheets.filter(function (sh) { return sh.rows && sh.rows.length; });
            if (!sheets.length) { status.textContent = ''; toast('That file has no data rows.'); return; }
            var totalRows = sheets.reduce(function (t, sh) { return t + sh.rows.length; }, 0);
            daState.importedBooks.push({ label: f.name, sheets: sheets, totalRows: totalRows, selected: true });
            status.textContent = 'Imported ' + f.name + ' — ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') + ', ' + totalRows + ' rows. Press Load to include it.';
            render();
          } catch (err) { status.textContent = ''; toast('Could not read the file: ' + (err.message || err)); }
        };
        if (isCsv) reader.readAsText(f); else reader.readAsArrayBuffer(f);
      }).catch(function () { status.textContent = ''; toast('Could not load the Excel reader (offline?).'); });
    }
    function doLoad() {
      var ids = {}; Object.keys(daState.selected).forEach(function (k) { if (daState.selected[k]) ids[k] = true; });
      var nSess = Object.keys(ids).length;
      var books = daState.importedBooks.filter(function (b) { return b.selected; });
      if (!nSess && !books.length) { toast('Tick at least one session or import a file first.'); return; }
      status.textContent = 'Loading…';
      loadBtn.setAttribute('disabled', 'true');
      var done = function () { loadBtn.removeAttribute('disabled'); };
      // Participants who played any ticked session (re-fetched so counts are current).
      var partsP;
      if (nSess) {
        partsP = Store.listParticipants().catch(function () { return daState.allParts || []; }).then(function (all) {
          daState.allParts = all;
          return all.filter(function (p) {
            return Object.keys(ids).some(function (sid) { return p.sessionId === sid || (p.playedSessions && p.playedSessions[sid]) || (p.completedSessions && p.completedSessions[sid]); });
          });
        });
      } else { partsP = Promise.resolve([]); }
      partsP.then(function (parts) {
        return nSess ? collectAggregateSheets(parts, ids) : emptySheetMap();
      }).then(function (sheetMap) {
        // Double-count guard: stacking a ticked session AND an imported export of
        // that same session duplicates its rows in every tab - the rates would look
        // unchanged while every n doubles and the CIs silently shrink. Warn by code.
        var loadedSess = {};
        (sheetMap.Responses || []).forEach(function (r) {
          if (r.session_id) loadedSess[String(r.session_id)] = true;
          if (r.session_code) loadedSess[String(r.session_code)] = true;
        });
        var overlap = {};
        books.forEach(function (b) {
          (b.sheets || []).forEach(function (sh) {
            (sh.rows || []).forEach(function (r) {
              if (r.session_id && loadedSess[String(r.session_id)]) overlap[String(r.session_code || r.session_id)] = true;
              else if (r.session_code && loadedSess[String(r.session_code)]) overlap[String(r.session_code)] = true;
            });
          });
        });
        books.forEach(function (b) { mergeBookIntoSheetMap(sheetMap, b); });
        daState.sheetMap = sheetMap;
        daState.sheetOrder = orderSheetNames(sheetMap);
        var ovKeys = Object.keys(overlap);
        status.textContent = 'Loaded ' + summarizeMap(sheetMap) + '.' + (ovKeys.length
          ? ' ⚠ Session ' + ovKeys.join(', ') + ' is in BOTH a ticked session and an imported file - its rows are now counted twice (every n doubles and the CIs shrink). Untick the session or remove the import, then Load again.'
          : '');
        done();
        // Refresh whichever Section 2/3 are currently mounted (daRefs is reset on
        // each render), so a Load that resolves after a view switch still lands.
        if (daRefs.updateSec2) daRefs.updateSec2();
        if (daRefs.updateSec3Tables) daRefs.updateSec3Tables();
      }).catch(function (e) {
        done(); status.textContent = '';
        toast('Load failed: ' + ((e && e.message) || 'error'));
        if (window.console) console.error('[Arena analytics] load failed', e);
      });
    }
    return card;
  }

  /* ---- Section 2: aggregate ---- */
  function buildDaSection2() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('div', { class: 'aa-sechead' }, [el('span', { class: 'aa-secnum', text: '2' }), el('h3', { text: 'Aggregate data', style: 'margin:0;' })]));
    card.appendChild(el('p', { class: 'aa-note', html: 'Consolidate every loaded session (and any imported workbook) into <b>one Excel file</b> with the same multi-tab structure as the per-session export — Conventions, Sessions, Participants, Tasks, Task summary, Responses, Events, Survey — with each source stacked within every tab. Sources are stacked <b>as-is (no dedup)</b>: don\'t tick a session <i>and</i> import that same session\'s export, or its rows count twice and every statistic below silently overstates its precision.' }));
    var stats = el('div', { class: 'aa-statgrid', style: 'margin-top:6px;' });
    card.appendChild(stats);
    var dl = el('button', { class: 'aa-btn green', on: { click: download } }, ['Download aggregate Excel']);
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:12px;' }, [dl]));
    var hint = el('p', { class: 'aa-note', text: 'Load data in Section 1 first.' });
    card.appendChild(hint);
    var balance = el('div', {});     // randomization balance (responses per task)
    card.appendChild(balance);
    var charts = el('div', {});      // model-provisioning charts
    card.appendChild(charts);
    daRefs.updateSec2 = update;
    update();
    function statBox(v, l) { return el('div', { class: 'aa-statbox' }, [el('b', { text: String(v) }), el('span', { text: l })]); }
    function update() {
      var m = daState.sheetMap;
      stats.innerHTML = ''; charts.innerHTML = ''; balance.innerHTML = '';
      if (!m) { dl.setAttribute('disabled', 'true'); hint.style.display = 'block'; return; }
      hint.style.display = 'none'; dl.removeAttribute('disabled');
      stats.appendChild(statBox((m.Responses || []).length, 'Responses'));
      stats.appendChild(statBox((m.Participants || []).length, 'Participants'));
      stats.appendChild(statBox((m.Sessions || []).length, 'Sessions'));
      stats.appendChild(statBox((m['Task summary'] || []).length, 'Tasks with data'));
      renderBalance(balance, m);           // how evenly the tasks were handed out
      renderProvisioning(charts, m);       // over / indifference / under-provisioning plots
    }
    function download() {
      var m = daState.sheetMap;
      if (!m) { toast('Load data in Section 1 first.'); return; }
      ensureXLSX().then(function (X) {
        var wb = X.utils.book_new(), used = {};
        daState.sheetOrder.forEach(function (name) {
          var rows = m[name] || [];
          X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.length ? rows : [{}]), safeSheetName(name, used));
        });
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        X.writeFile(wb, 'answerarena-aggregate-' + stamp + '.xlsx');
        toast('Aggregate downloaded.');
      }).catch(function (e) { toast('Download failed: ' + ((e && e.message) || 'error')); });
    }
    return card;
  }

  /* ---- Section 3: run Python / R ---- */
  function buildDaSection3() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('div', { class: 'aa-sechead' }, [el('span', { class: 'aa-secnum', text: '3' }), el('h3', { text: 'Process with Python or R', style: 'margin:0;' })]));
    card.appendChild(el('p', { class: 'aa-note', html: 'Pick a table from the aggregate above, then run <b>Python</b> (Pyodide: numpy / pandas / scipy / matplotlib) or <b>R</b> (WebR, base R) on it — compiled entirely in your browser (the first run downloads the runtime, ~10–30&nbsp;s). The table is handed to your code as the string <code>DATA_CSV</code> (Python) or the file <code>/tmp/data.csv</code> (R). Both bundled scripts answer <b>one question and nothing else</b>: which task IDs we can say <b>Haiku</b> is preferred on and which <b>Opus</b>, first at <b>95%</b> confidence and then at <b>99%</b>. Each task is judged on its own responses by an <b>exact sign test</b> — of the students who expressed a preference, was the split too lopsided for chance? — with the same test <i>weighted by how strongly they felt</i> printed beside it as a cross-check. Text output appears below; the <b>plot is shown in the “Insights gained” section</b>, next to an explanation of how to read it.' }));

    var tableSel = el('select', {});
    card.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Analysis table (from Section 2)' }), tableSel]));

    var pyTabBtn = el('button', { on: { click: function () { setLang('python'); } } }, ['Python']);
    var rTabBtn = el('button', { on: { click: function () { setLang('r'); } } }, ['R']);
    card.appendChild(el('div', { class: 'aa-langtabs' }, [pyTabBtn, rTabBtn]));

    var editor = el('textarea', { class: 'aa-code', spellcheck: 'false' });
    card.appendChild(editor);

    var runBtn = el('button', { class: 'aa-btn', on: { click: run } }, ['▶ Run']);
    var resetBtn = el('button', { class: 'aa-btn sec', on: { click: resetTemplate } }, ['Reset template']);
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:10px;' }, [runBtn, resetBtn]));
    var statusEl = el('div', { class: 'aa-runstatus' });
    card.appendChild(statusEl);
    card.appendChild(el('div', { class: 'aa-sub', style: 'margin:12px 0 4px;', text: 'Output' }));
    var outWrap = el('div', {}, [el('p', { class: 'aa-note', text: 'Run your code to see the output here.' })]);
    card.appendChild(outWrap);
    var plots = el('div', { class: 'aa-plots' });
    card.appendChild(plots);

    var running = false, outText = '', flushQueued = false, outPre = null;

    // Restore persisted code (or the bundled templates) once. Refresh first so a
    // stale saved script from an older template version cannot shadow the fix.
    daMigrateTemplates();
    if (daState.code.python == null) daState.code.python = daLoadSaved('aa-da:py', DA_PY_TEMPLATE);
    if (daState.code.r == null) daState.code.r = daLoadSaved('aa-da:r', DA_R_TEMPLATE);
    editor.value = daState.code[daState.lang];
    editor.addEventListener('input', function () { daState.code[daState.lang] = editor.value; saveCode(); });

    setLang(daState.lang);
    daRefs.updateSec3Tables = updateTables;
    updateTables();
    // If a run started under an earlier render is still going, say so (the run()
    // guard below blocks a concurrent second run until it finishes).
    if (daState.running) setStatus('A run started earlier is still in progress — please wait for it to finish.');

    function setLang(lang) {
      if (running) return;
      daState.lang = lang;
      pyTabBtn.className = lang === 'python' ? 'on' : '';
      rTabBtn.className = lang === 'r' ? 'on' : '';
      editor.value = daState.code[lang];
      runBtn.textContent = lang === 'python' ? '▶ Run Python' : '▶ Run R';
    }
    function updateTables() {
      var m = daState.sheetMap;
      var prev = tableSel.value;
      tableSel.innerHTML = '';
      var names = m ? daState.sheetOrder.filter(function (n) { return (m[n] || []).length; }) : [];
      if (!names.length) { tableSel.appendChild(el('option', { value: '' }, ['(load data in Section 1 first)'])); tableSel.setAttribute('disabled', 'true'); return; }
      tableSel.removeAttribute('disabled');
      names.forEach(function (n) { tableSel.appendChild(el('option', { value: n }, [n + ' (' + (m[n] || []).length + ' rows)'])); });
      if (names.indexOf(prev) >= 0) tableSel.value = prev;
      else if (names.indexOf('Responses') >= 0) tableSel.value = 'Responses';
      else tableSel.value = names[0];
    }
    function resetTemplate() {
      if (running) return;
      var tpl = daState.lang === 'python' ? DA_PY_TEMPLATE : DA_R_TEMPLATE;
      daState.code[daState.lang] = tpl; editor.value = tpl; saveCode();
    }
    function saveCode() { try { localStorage.setItem(daState.lang === 'python' ? 'aa-da:py' : 'aa-da:r', daState.code[daState.lang]); } catch (e) {} }
    function pushLine(line) {
      outText += line + '\n';
      if (!flushQueued) { flushQueued = true; requestAnimationFrame(function () { flushQueued = false; if (outPre) outPre.textContent = outText; }); }
    }
    function setStatus(s) { statusEl.textContent = s || ''; }
    function run() {
      if (running) return;
      // Cross-render guard: a run started under an earlier render (before the user
      // switched tabs and back) shares the one Pyodide/WebR runtime, so never start
      // a second concurrent run against it.
      if (daState.running) { toast('A run is already in progress — please wait for it to finish.'); return; }
      var m = daState.sheetMap;
      if (!m) { toast('Load data in Section 1 first.'); return; }
      var name = tableSel.value;
      var rows = name && m[name] ? m[name] : [];
      if (!rows.length) { toast('The selected table is empty — pick another or load data.'); return; }
      running = true; daState.running = true; runBtn.setAttribute('disabled', 'true'); resetBtn.setAttribute('disabled', 'true');
      outText = ''; plots.innerHTML = ''; outWrap.innerHTML = '';
      outPre = el('pre', { class: 'aa-out', text: '' }); outWrap.appendChild(outPre);
      setStatus('Preparing…');
      var lang = daState.lang, code = editor.value;
      daState.code[lang] = code; saveCode();
      ensureXLSX().then(function (X) {
        var csv = X.utils.sheet_to_csv(X.utils.json_to_sheet(rows));
        return lang === 'python'
          ? daRunPython(code, { dataCsv: csv, onStdout: pushLine, onStatus: setStatus })
          : daRunR(code, { dataCsv: csv, onOutput: pushLine, onStatus: setStatus });
      }).then(function (result) {
        var finalOut = outText || (result && (result.stdout || result.output)) || '';
        var imgs = (result && result.images) || [];
        if (result && !result.ok && result.error) finalOut = (finalOut ? finalOut + '\n' : '') + '⚠ ' + result.error;
        if (outPre) outPre.textContent = finalOut || '(no output)';
        // Plots live in the Insights section (each beside its explanation), so here
        // we only point there rather than duplicating the figures.
        if (imgs.length) {
          plots.appendChild(el('p', { class: 'aa-note', html: '📊 <b>' + imgs.length + ' figure' + (imgs.length === 1 ? '' : 's') + '</b> rendered — see the <b>“Insights gained”</b> section below, where each plot is shown with an explanation of how to read it.' }));
        }
        setStatus(imgs.length ? (imgs.length + ' figure' + (imgs.length === 1 ? '' : 's') + ' rendered — shown in “Insights gained” below.') : (result && result.ok ? 'Done.' : ''));
        // Snapshot the run so the Insights section can render its INSIGHTS block + plots.
        daState.lastRun = { output: finalOut, images: imgs, lang: lang, ok: !!(result && result.ok) };
        if (daRefs.updateInsights) daRefs.updateInsights();
      }).catch(function (err) {
        if (outPre) outPre.textContent = (outText ? outText + '\n' : '') + '⚠ ' + ((err && err.message) || err);
        setStatus('');
      }).then(function () {
        running = false; daState.running = false; runBtn.removeAttribute('disabled'); resetBtn.removeAttribute('disabled');
      });
    }
    return card;
  }

  /* ---- Section 4: insights gained ---- */
  function buildDaSection4() {
    var card = el('div', { class: 'aa-card' });
    card.appendChild(el('div', { class: 'aa-sechead' }, [el('span', { class: 'aa-secnum', text: '4' }), el('h3', { text: 'Insights gained', style: 'margin:0;' })]));
    card.appendChild(el('p', { class: 'aa-note', html: 'A readable write-up of what the Section 3 analysis found — the four lists of task IDs (<b>Haiku preferred</b> / <b>Opus preferred</b>, at 95% and at 99%) and how much weight each carries. <b>Every plot is shown here</b>, each one dropped in right under the paragraph that explains how to read it. It all comes from the <code>INSIGHTS</code> block the script prints, so editing the script changes it.' }));
    var body = el('div', {});
    card.appendChild(body);
    daRefs.updateInsights = render;
    render();
    function render() {
      body.innerHTML = '';
      var run = daState.lastRun;
      if (!run) { body.appendChild(el('p', { class: 'aa-note', text: 'Run the analysis in Section 3 first — the insights and plots appear here.' })); return; }
      var text = daParseInsights(run.output);
      var images = (run.images || []).slice();
      var placed = [];               // image indices already dropped under a "Figure N" heading
      if (text) {
        var ul = null;
        text.split('\n').forEach(function (raw) {
          var t = raw.replace(/\s+$/, '');
          if (/^\s*##\s+/.test(t)) {
            ul = null;
            var head = t.replace(/^\s*##\s+/, '');
            body.appendChild(el('h4', { class: 'aa-insh', text: head }));
            // A "Figure N …" heading pulls its plot in right here, so each figure
            // sits with the paragraph that explains how to read it.
            var fm = head.match(/^Figure\s+(\d+)\b/i);
            if (fm) {
              var idx = parseInt(fm[1], 10) - 1;
              if (idx >= 0 && idx < images.length && placed.indexOf(idx) < 0) {
                body.appendChild(el('img', { src: images[idx], class: 'aa-insimg', alt: head }));
                placed.push(idx);
              }
            }
          }
          else if (/^\s*[-•*]\s+/.test(t)) { if (!ul) { ul = el('ul', { class: 'aa-insul' }); body.appendChild(ul); } ul.appendChild(el('li', { html: daInlineBold(t.replace(/^\s*[-•*]\s+/, '')) })); }
          else if (t.trim() === '') { ul = null; }
          else { ul = null; body.appendChild(el('p', { class: 'aa-insp', html: daInlineBold(t) })); }
        });
      } else {
        body.appendChild(el('p', { class: 'aa-note', text: run.ok
          ? 'The last run printed no INSIGHTS block. Add one to your script (a line "INSIGHTS" followed by the write-up), or read the full console output in Section 3.'
          : 'The last run did not finish — see the error in Section 3.' }));
      }
      // Any plots not matched to a "Figure N" heading (e.g. a user's custom script)
      // are shown at the end so nothing is ever silently dropped.
      var leftover = images.filter(function (_, i) { return placed.indexOf(i) < 0; });
      if (leftover.length) {
        body.appendChild(el('div', { class: 'aa-sub', style: 'margin:14px 0 4px;', text: placed.length ? 'More figures' : 'Figures' }));
        leftover.forEach(function (src) { body.appendChild(el('img', { src: src, class: 'aa-insimg', alt: 'figure' })); });
      }
    }
    return card;
  }
  // Pull the plain-language INSIGHTS block out of a run's console output: the
  // scripts print a line "INSIGHTS" (optionally banner-wrapped) then the write-up
  // to the end, so we return everything after that marker, trimmed of banner/Done.
  function daParseInsights(output) {
    if (!output) return '';
    var lines = String(output).split('\n');
    var start = -1;
    for (var i = 0; i < lines.length; i++) { if (/^\s*#*\s*INSIGHTS\s*$/i.test(lines[i])) { start = i; break; } }
    if (start < 0) return '';
    var body = lines.slice(start + 1);
    while (body.length && /^[=\-\s]*$/.test(body[0])) body.shift();
    while (body.length && (/^[=\-\s]*$/.test(body[body.length - 1]) || /^\s*Done\.?\s*$/i.test(body[body.length - 1]))) body.pop();
    return body.join('\n');
  }
  // Render **bold** spans (after HTML-escaping) inside an insight line.
  function daInlineBold(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }

  /* =====================================================================
     In-browser runtimes: Pyodide (Python) + WebR (R).
     Ported from the ideasearchlab Data Analytics page. Each loads lazily
     from jsDelivr on first Run and is then reused across runs.
     ===================================================================== */
  var DA_PYODIDE_VERSIONS = ['314.0.1', '0.29.4', '0.28.3'];
  // What the sandbox provides. The bundled template needs only numpy / pandas /
  // matplotlib - it computes its exact test by hand, so it depends on no
  // statistics library at all - and scipy stays on the list for scripts the user
  // writes in the editor. statsmodels is deliberately NOT here: it is a large,
  // sometimes-unavailable Pyodide build, and requiring it used to make Python
  // fail to start ("R works, Python doesn't").
  var DA_PY_PACKAGES = ['numpy', 'pandas', 'scipy', 'matplotlib'];
  var _pyodidePromise = null;
  function daPyScriptUrl(v) { return 'https://cdn.jsdelivr.net/pyodide/v' + v + '/full/pyodide.js'; }
  function daPyBaseUrl(v) { return 'https://cdn.jsdelivr.net/pyodide/v' + v + '/full/'; }
  function daInjectScript(url) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-pyodide-src="' + url + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1' && typeof globalThis.loadPyodide === 'function') return resolve();
        if (existing.dataset.loaded === '1') { existing.remove(); }
        else { existing.addEventListener('load', function () { resolve(); }); existing.addEventListener('error', function () { reject(new Error('Failed to load ' + url)); }); return; }
      }
      var s = document.createElement('script');
      s.src = url; s.async = true; s.crossOrigin = 'anonymous'; s.dataset.pyodideSrc = url;
      s.onload = function () { s.dataset.loaded = '1'; resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + url + ' (CDN / network / CSP?)')); };
      document.head.appendChild(s);
    });
  }
  function daGetPyodide(onStatus) {
    if (_pyodidePromise) return _pyodidePromise;
    _pyodidePromise = (async function () {
      var lastErr = null;
      for (var i = 0; i < DA_PYODIDE_VERSIONS.length; i++) {
        var v = DA_PYODIDE_VERSIONS[i];
        try {
          if (onStatus) onStatus('Loading Python runtime (Pyodide v' + v + ')…');
          await daInjectScript(daPyScriptUrl(v));
          var pyodide = await globalThis.loadPyodide({ indexURL: daPyBaseUrl(v) });
          if (onStatus) onStatus('Loading data-science packages (numpy, pandas, scipy, matplotlib)…');
          await daEnsurePyPackages(pyodide);
          if (onStatus) onStatus('');
          return pyodide;
        } catch (err) {
          lastErr = err;
          try { delete globalThis.loadPyodide; } catch (e) { /* non-configurable */ }
          var stale = document.querySelector('script[data-pyodide-src="' + daPyScriptUrl(v) + '"]');
          if (stale) stale.remove();
        }
      }
      throw lastErr || new Error('Pyodide failed to load from all candidate versions.');
    })();
    _pyodidePromise.catch(function () { _pyodidePromise = null; });
    return _pyodidePromise;
  }
  async function daEnsurePyPackages(pyodide) {
    try { await pyodide.loadPackage(DA_PY_PACKAGES); return; } catch (e) { /* isolate below */ }
    var fallback = [];
    for (var i = 0; i < DA_PY_PACKAGES.length; i++) {
      try { await pyodide.loadPackage(DA_PY_PACKAGES[i]); } catch (e) { fallback.push(DA_PY_PACKAGES[i]); }
    }
    if (fallback.length) {
      // Best effort via micropip; a package that still can't be installed is
      // SKIPPED (non-fatal) so one unavailable package never blocks Python startup.
      try {
        await pyodide.loadPackage('micropip');
        var micropip = pyodide.pyimport('micropip');
        for (var j = 0; j < fallback.length; j++) {
          try { await micropip.install(fallback[j]); } catch (e2) { if (window.console) console.warn('[Arena analytics] could not install ' + fallback[j], e2); }
        }
      } catch (e3) { if (window.console) console.warn('[Arena analytics] micropip unavailable', e3); }
    }
  }
  var DA_MPL_BACKEND = '\nimport os as __os\n__os.environ.setdefault("MPLBACKEND", "Agg")\ntry:\n    import matplotlib\n    matplotlib.use("Agg", force=True)\nexcept Exception:\n    pass\n';
  var DA_FIG_HARVEST = '\ndef __collect_figures():\n    import io, base64\n    try:\n        import matplotlib\n        import matplotlib.pyplot as plt\n    except Exception:\n        return []\n    out = []\n    for num in plt.get_fignums():\n        fig = plt.figure(num)\n        buf = io.BytesIO()\n        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")\n        buf.seek(0)\n        out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))\n        buf.close()\n    plt.close("all")\n    return out\n\n__pyo_images = __collect_figures()\n';
  async function daRunPython(code, opts) {
    opts = opts || {};
    var pyodide = await daGetPyodide(opts.onStatus);
    var collected = [];
    var emit = function (chunk) {
      var text = String(chunk); collected.push(text);
      if (typeof opts.onStdout === 'function') { var parts = text.split('\n'); for (var i = 0; i < parts.length; i++) opts.onStdout(parts[i]); }
    };
    pyodide.setStdout({ batched: emit });
    pyodide.setStderr({ batched: emit });
    pyodide.globals.set('DATA_CSV', opts.dataCsv || '');
    var ok = true, error = null, images = [];
    try {
      await pyodide.runPythonAsync(DA_MPL_BACKEND + '\n' + code + '\n' + DA_FIG_HARVEST);
      var pyImages = pyodide.globals.get('__pyo_images');
      if (pyImages) { try { images = pyImages.toJs(); } finally { pyImages.destroy(); } }
    } catch (e) {
      ok = false; error = e && e.message ? e.message : String(e); emit(error);
    } finally {
      pyodide.setStdout(); pyodide.setStderr();
      try { pyodide.runPython("for __n in ('DATA_CSV','__pyo_images'):\n    globals().pop(__n, None)\n"); } catch (e) { /* ignore */ }
    }
    return { ok: ok, stdout: collected.join('\n'), images: images, error: error };
  }

  var DA_WEBR_VERSIONS = ['0.6.0', '0.5.9', '0.4.4'];
  var _webRPromise = null;
  function daWebrEsmUrl(v) { return 'https://cdn.jsdelivr.net/npm/webr@' + v + '/dist/webr.mjs'; }
  function daWebrBaseUrl(v) { return 'https://cdn.jsdelivr.net/npm/webr@' + v + '/dist/'; }
  function daGetWebR(onStatus) {
    if (_webRPromise) return _webRPromise;
    _webRPromise = (async function () {
      var lastErr = null;
      for (var i = 0; i < DA_WEBR_VERSIONS.length; i++) {
        var v = DA_WEBR_VERSIONS[i], webR;
        try {
          if (onStatus) onStatus('Loading R runtime (WebR v' + v + ')… this is a large one-time download.');
          var mod = await import(daWebrEsmUrl(v));
          var WebR = mod.WebR || (mod.default && mod.default.WebR);
          if (!WebR) throw new Error('WebR export not found in module');
          webR = new WebR({ baseUrl: daWebrBaseUrl(v) });
          await webR.init();
          if (onStatus) onStatus('');
          return webR;
        } catch (err) {
          lastErr = err;
          if (webR && typeof webR.close === 'function') { try { webR.close(); } catch (e) { /* ignore */ } }
        }
      }
      throw lastErr || new Error('WebR failed to load from all candidate versions.');
    })();
    _webRPromise.catch(function () { _webRPromise = null; });
    return _webRPromise;
  }
  async function daBitmapToPng(bitmap) {
    var w = bitmap.width, h = bitmap.height;
    if (typeof OffscreenCanvas !== 'undefined') {
      var off = new OffscreenCanvas(w, h);
      off.getContext('2d').drawImage(bitmap, 0, 0);
      var blob = await off.convertToBlob({ type: 'image/png' });
      return await new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
    }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/png');
  }
  async function daRunR(code, opts) {
    opts = opts || {};
    var csvPath = '/tmp/data.csv';
    var lines = [], buffer = '';
    var push = function (text) {
      if (text == null) return; buffer += text; var idx;
      while ((idx = buffer.indexOf('\n')) !== -1) { var line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1); lines.push(line); if (typeof opts.onOutput === 'function') opts.onOutput(line); }
    };
    var flush = function () { if (buffer.length) { lines.push(buffer); if (typeof opts.onOutput === 'function') opts.onOutput(buffer); buffer = ''; } };
    var webR, shelter, images = [];
    try {
      webR = await daGetWebR(opts.onStatus);
      if (typeof opts.dataCsv === 'string') {
        try { await webR.FS.mkdir('/tmp'); } catch (e) { /* exists */ }
        await webR.FS.writeFile(csvPath, new TextEncoder().encode(opts.dataCsv));
      }
      shelter = await new webR.Shelter();
      var capture = await shelter.captureR(code, { withAutoprint: true, captureGraphics: true });
      var out = capture.output || [];
      for (var i = 0; i < out.length; i++) { var evt = out[i]; if (evt && (evt.type === 'stdout' || evt.type === 'stderr')) push(evt.data + '\n'); }
      flush();
      if (Array.isArray(capture.images)) {
        for (var k = 0; k < capture.images.length; k++) { var bmp = capture.images[k]; images.push(await daBitmapToPng(bmp)); if (bmp && typeof bmp.close === 'function') bmp.close(); }
      }
      return { ok: true, output: lines.join('\n'), images: images, error: null };
    } catch (err) {
      flush();
      return { ok: false, output: lines.join('\n'), images: images, error: err && err.message ? err.message : String(err) };
    } finally {
      if (shelter) { try { await shelter.purge(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- default Python / R templates (edit-and-Run) ---- */
  var DA_PY_TEMPLATE = [
    '"""',
    '================================================================================',
    'ANSWER ARENA - for which TASKS is HAIKU preferred, and for which OPUS?',
    '================================================================================',
    'THE ONE QUESTION THIS SCRIPT ANSWERS',
    '',
    '  Given the data collected so far, for which specific task ids can we say with',
    '  95% confidence that HAIKU is preferred, and for which that OPUS is preferred?',
    '  Then the same question again at the stricter 99% confidence.',
    '',
    'Nothing else. Four lists of task ids, the numbers behind them, and one figure.',
    '',
    '--------------------------------------------------------------------------------',
    'THE STUDY, IN FOUR LINES',
    '  For each task (a real user need) the same prompt was sent to Haiku 4.5 (the',
    '  BASELINE, small and cheap) and to Opus 4.8 (the FRONTIER, large and expensive).',
    '  Both answers were shown to a student WITHOUT labels; the student said which one',
    '  resolved the task better and how strongly. Each student saw a random subset of',
    '  the tasks, so tasks have different numbers of responses - which is exactly why',
    '  a confidence level, rather than a raw win count, is what settles the question.',
    '',
    'THE DATA (the table picked in Section 3, handed in as the string DATA_CSV)',
    '  account_id        the student. A student answers many tasks but each task at',
    '                    most ONCE, so within one task the responses are independent.',
    '  task_id           the task / user need - the thing we report on.',
    '  chosen_model      baseline (Haiku) | frontier (Opus) | tie',
    '  preference_model  graded preference, integer -3..+3, MODEL frame:',
    '                    <0 Haiku preferred, 0 equivalent, >0 Opus preferred.',
    '  submitted         \'yes\' for a real (non-draft) answer; blank counts as real.',
    '',
    '--------------------------------------------------------------------------------',
    'THE TEST, AND WHY IT IS THIS ONE',
    '',
    'For one task, look only at the students who expressed a preference at all - the',
    'ones who did not call the two answers equivalent. Say m of them did, and k of',
    'those picked Opus. If neither model were really preferred, each of those',
    'students was as likely to have picked one answer as the other, so k would behave',
    'like m coin tosses. The question becomes: out of all 2^m ways those m students',
    'could have chosen, how often would the split come out as lopsided as the split',
    'we actually saw?',
    '',
    '  p = (number of ways the split could be at least this lopsided) / 2^m',
    '',
    'That is the EXACT SIGN TEST, computed below by adding up every possibility',
    'rather than by sampling or by any approximation. A task is listed at confidence',
    'C when p <= 1-C, on the side more students picked.',
    '',
    'Why the DIRECTION and not the strength? Because the strength is partly the',
    'interface, not the student. Tapping an answer card in Answer Arena already sets',
    'the 7-point bar to +/-2; a student who taps and moves on exports a magnitude of',
    '2 that the screen chose for them (the export records this in',
    '`preference_source`: "card" rather than "bar"). The SIGN, though, is always',
    'their own deliberate act. A test on the sign therefore uses exactly the part of',
    'each response the student produced and discards exactly the part the interface',
    'produced. The scale is also not calibrated between people - one student\'s "3" is',
    'another\'s "1" - and the sign is comparable across students in a way the',
    'magnitude is not.',
    '',
    'The strength is not thrown away. The SAME computation, run with each response',
    'weighted by how strongly it was felt, is printed beside every task as',
    '`p_str`, and every task where the two readings disagree is named. When they',
    'agree, the listing rests on both the count and the conviction.',
    '',
    'Why not a t-test, which the earlier version of this script used? It is an',
    'approximation that needs a large sample, and here the samples are 10-30 answers',
    'on a bounded scale with a heap of exact zeros. It is also undefined - 0/0 - on',
    'exactly the tasks carrying the most evidence, the ones where every student said',
    'the same thing, and had to be patched by hand for them. The exact test needs no',
    'approximation, no degrees of freedom, and no special conventions: a task where',
    'everyone answered identically, a task with two answers, a task where everyone',
    'tied, all fall out of the same formula with a sensible p. Its p-values are',
    'lumpy and it is a shade conservative, which errs the safe way for a list of',
    'claims.',
    '',
    'MULTIPLE TASKS. Asking the same question of ~30 tasks at 95% means that if the',
    'models were really tied everywhere, roughly one or two tasks would still look',
    'decided. So each task also carries a BENJAMINI-HOCHBERG adjusted value (q), the',
    'false-discovery-rate reading: "of the tasks on this list, at most this share are',
    'expected to be there by chance". It is shown as a COLUMN and never filters the',
    'lists - the question asked is per task, and the answer to it stays per task.',
    '',
    'A task that is NOT listed is NOT a task where the two models are equal. It is a',
    'task where these responses cannot tell them apart at that confidence. Showing',
    'that two models are EQUIVALENT is a different claim needing a different test,',
    'and this script deliberately does not make it.',
    '================================================================================',
    '"""',
    '',
    '# -- Imports (lightweight, always available in this page\'s Pyodide build) ------',
    'import io                              # wrap the DATA_CSV string as a file for pandas',
    'import numpy as np                     # arrays, and the sign-flip convolution',
    'import pandas as pd                    # the data frame, group-bys, printed tables',
    'import matplotlib                      # the one figure; force a headless backend first',
    'matplotlib.use("Agg")                  # "Agg" renders to an in-memory PNG (no screen)',
    'import matplotlib.pyplot as plt        # the page harvests the open figure afterwards',
    '',
    '# -- The two systems being compared. Never shown to the students. -------------',
    'OPUS, HAIKU = "frontier", "baseline"',
    '',
    '# -- The two confidence levels the question asks for --------------------------',
    '# Everything printed is built from THIS list, so a label can never claim a',
    '# confidence the tests did not use. Add a level and the report grows a section',
    '# for it; change one and every number and every word follows.',
    'LEVELS = [0.95, 0.99]',
    '',
    '# Print wide tables on ONE line. Base R wraps a data frame at its `width` option',
    '# and the wrapped remainder reads as a second, headerless table; the R version',
    '# sets the same width, so the two outputs stay comparable line for line.',
    'pd.set_option("display.width", 200)',
    'pd.set_option("display.max_columns", 100)',
    '',
    '',
    '# ── The test itself ──────────────────────────────────────────────────────────',
    'def signflip_p(values, votes_only=False):',
    '    """EXACT two-sided sign-flip test of a task\'s scores against "no preference".',
    '',
    '    `values` are that task\'s scores on the -3..+3 scale. Zeros (exact ties) are',
    '    dropped: flipping the sign of a zero changes nothing, so they cannot make',
    '    the total more or less one-sided. `votes_only=True` sets every remaining',
    '    magnitude to 1, which turns the same computation into the exact SIGN TEST -',
    '    how many students picked each model, ignoring how strongly.',
    '',
    '    The null distribution of the total is built by convolution rather than by',
    '    listing all 2^m patterns: `d` holds the probability of each reachable total,',
    '    and adding one more response either subtracts its magnitude (probability a',
    '    half) or adds it (a half). Probabilities are carried rather than counts, so',
    '    a task with many responses cannot overflow. Both languages perform the same',
    '    additions in the same order, so the two agree to the last bit.',
    '',
    '    Returns (p, m, total) - the two-sided p-value, the number of non-tie',
    '    responses it was computed from, and the observed total. Under `votes_only`',
    '    the total is the VOTE margin (how many more students picked one model), and',
    '    it is that margin, not the score total, which must give the verdict its',
    '    direction: a task can have more Opus votes while a couple of emphatic Haiku',
    '    answers pull the score total the other way."""',
    '    v = np.asarray(values, float)',
    '    v = v[np.isfinite(v)]                       # drop missing scores',
    '    mag = np.abs(v)',
    '    mag = mag[mag > 0]                          # exact ties contribute nothing',
    '    if votes_only:',
    '        mag = np.ones(len(mag))                 # magnitudes ignored -> the sign test',
    '    m = len(mag)',
    '    total = float(np.sum(np.sign(v))) if votes_only else float(np.sum(v))',
    '    if m == 0:                                  # every response a tie, or none at all',
    '        return (1.0, 0, total)',
    '    mag = mag.astype(int)                       # the scale is whole numbers',
    '    span = 0                                    # the current total\'s range is +/- span',
    '    d = np.array([1.0])                         # d[j] = P(total == j - span)',
    '    for a in mag:                               # one response at a time',
    '        nxt = np.zeros(len(d) + 2 * a)          # the range grows by `a` each side',
    '        nxt[:len(d)] += 0.5 * d                 # this response signed MINUS',
    '        nxt[2 * a:2 * a + len(d)] += 0.5 * d    # this response signed PLUS',
    '        d = nxt',
    '        span += a',
    '    reach = np.arange(len(d)) - span            # the total each entry stands for',
    '    p = float(np.sum(d[np.abs(reach) >= abs(total) - 1e-9]))   # as one-sided, or more',
    '    return (min(1.0, p), m, total)',
    '',
    '',
    'def min_responses_for(alpha):',
    '    """The fewest non-tie responses a task needs before ANY split could reach',
    '    this level. The most one-sided outcome possible has p = 2^(1-m), so below',
    '    this many answers the task cannot be listed however unanimous it was - which',
    '    is a sample-size fact worth printing, not a failure of the task."""',
    '    m = 1',
    '    while 2.0 ** (1 - m) > alpha and m < 60:',
    '        m += 1',
    '    return m',
    '',
    '',
    'def bh(pvals):',
    '    """Benjamini-Hochberg adjusted p-values (the false-discovery-rate reading),',
    '    computed by hand so the Python and R versions cannot differ. Sort ascending,',
    '    scale the k-th smallest of M by M/k, then walk back down taking a running',
    '    minimum so the adjusted values never decrease, and cap at 1."""',
    '    p = np.asarray(pvals, float)',
    '    out = np.full(len(p), np.nan)',
    '    idx = np.where(np.isfinite(p))[0]',
    '    if len(idx) == 0:',
    '        return out',
    '    order = idx[np.argsort(p[idx], kind="mergesort")]     # stable, like R\'s order',
    '    M = len(order)',
    '    running = 1.0',
    '    for k in range(M, 0, -1):                             # largest first: step-up',
    '        j = order[k - 1]',
    '        running = min(running, M * p[j] / k)',
    '        out[j] = min(1.0, running)',
    '    return out',
    '',
    '',
    '# ── Small helpers ────────────────────────────────────────────────────────────',
    'def pct(conf):',
    '    """0.95 -> "95%". Used for every printed label."""',
    '    return "%g%%" % round(100 * conf, 10)',
    '',
    '',
    'def verdict_of(p, total, conf):',
    '    """One task, one confidence level, one word: \'haiku\', \'opus\' or \'\' (not',
    '    established). A verdict needs a significant test AND a direction; a total of',
    '    exactly 0 gives p = 1, so it can never be assigned one."""',
    '    if not np.isfinite(p) or total == 0:',
    '        return ""',
    '    if p > 1 - conf:',
    '        return ""',
    '    return "opus" if total > 0 else "haiku"',
    '',
    '',
    'def ids(frame):',
    '    """The task ids of a table, comma-separated - the answer in its shortest form."""',
    '    return ", ".join(frame["task_id"].astype(str).tolist()) if len(frame) else "(none)"',
    '',
    '',
    'INS = []                                   # the plain-language INSIGHTS block',
    'def note(s=""):',
    '    INS.append(s)',
    '',
    '',
    '# ── Load the data, keep only real (submitted) comparisons ────────────────────',
    '# EVERY column is read as TEXT and coerced by hand below. Left to itself pandas',
    '# infers types and R does not: a student id of "0012" would become the number 12',
    '# in Python and stay "0012" in R (two different students merged in one language',
    '# only), a task id of "07" would sort differently, and a TRUE/FALSE submitted',
    '# column would arrive as a boolean that the text filter below drops entirely -',
    '# silently throwing away every row and reporting it as "nothing reached',
    '# significance". keep_default_na keeps "NA"/"None" as the text they are.',
    'df = pd.read_csv(io.StringIO(DATA_CSV), dtype=str, keep_default_na=False)',
    'n_read = len(df)',
    'n_draft = 0',
    'if "submitted" in df.columns:',
    '    # A BLANK value counts as submitted (an imported third-party table often has',
    '    # no real submitted flag) - the same rule the Section-2 charts use, so the',
    '    # charts and this script always describe the same rows. Drafts stay out.',
    '    # "true"/"1"/"y" join "yes" because an imported third-party workbook writes',
    '    # the flag however its own tool wrote it; a spreadsheet exporting a boolean',
    '    # column as TRUE would otherwise make EVERY row a draft and the whole table',
    '    # would silently read as "nothing reached significance".',
    '    df = df[df["submitted"].astype(str).str.strip().str.lower()',
    '            .isin(["yes", "", "true", "t", "y", "1"])].copy()',
    '    n_draft = n_read - len(df)',
    '',
    '# Each column is optional-safe: a table without it yields empty values instead of',
    '# crashing, so running this on the wrong sheet gives a message, not a traceback.',
    'df["pref"] = pd.to_numeric(df["preference_model"], errors="coerce") if "preference_model" in df.columns else np.nan',
    'df["chosen"] = df["chosen_model"].astype(str).str.strip().str.lower() if "chosen_model" in df.columns else ""',
    'df["task_id"] = df["task_id"].astype(str).str.strip() if "task_id" in df.columns else ""',
    '',
    '# The score the test reads. Normally the graded -3..+3 answer; where a row',
    '# recorded only a CHOICE, its direction stands in with a magnitude of 1, so a',
    '# table carrying one column but not the other is still answerable. (On the app\'s',
    '# own Responses table every row is graded, so this never fires.)',
    'dir_from_choice = df["chosen"].map({HAIKU: -1.0, "tie": 0.0, OPUS: 1.0})',
    'raw_score = df["pref"].where(df["pref"].notna(), dir_from_choice)',
    '# Only a WHOLE number on the -3..+3 scale is a score this instrument can have',
    '# produced. Anything else - a re-scaled export writing 1.5, a stray 10, text -',
    '# is dropped and counted rather than coerced: both languages would otherwise',
    '# truncate it towards zero when the test takes its magnitude, quietly turning',
    '# 1.5 into 1 and answering a question about data that was never collected.',
    'valid = raw_score.notna() & (raw_score == raw_score.round()) & (raw_score.abs() <= 3)',
    'n_bad_score = int((raw_score.notna() & ~valid).sum())',
    'df["score"] = raw_score.where(valid)',
    '',
    'n_rows = len(df)',
    'n_students = str(df["account_id"].nunique()) if "account_id" in df.columns else "n/a"',
    'n_tasks = df.loc[df["task_id"].astype(str).str.len() > 0, "task_id"].nunique()',
    '',
    'print("=" * 78)',
    'print("ANSWER ARENA - which tasks is HAIKU preferred on, and which is OPUS?")',
    'print("=" * 78)',
    'print("Responses: %d   Students: %s   Tasks: %d" % (n_rows, n_students, n_tasks))',
    'if n_draft:',
    '    # Said out loud: a filter that quietly removed most of the table would',
    '    # otherwise show up only as "nothing reached significance".',
    '    print("(%d of the %d rows read were drafts and are excluded.)" % (n_draft, n_read))',
    'if n_bad_score:',
    '    print("(%d row(s) carried a score outside the whole numbers -3..+3 and are excluded.)" % n_bad_score)',
    '',
    'if n_rows == 0 or int(df["score"].notna().sum()) == 0 or n_tasks == 0:',
    '    print("\\nNo comparisons in the selected table - pick the Responses table (one")',
    '    print("row per comparison) in Section 3 and run again.")',
    '    print("\\n\\nINSIGHTS")',
    '    print("=" * 78)',
    '    print("## No data")',
    '    print("- The selected table holds no comparisons, so no task can be called either "',
    '          "way. Pick the **Responses** table in Section 3 and run again.")',
    'else:',
    '    # One student should answer one task once. Stacked rows (the same session',
    '    # loaded twice, say) would make every task look better-evidenced than it is,',
    '    # so this is REPORTED rather than silently deduplicated - which of the two',
    '    # copies is the real answer is not something this script can know.',
    '    # The graded score and the recorded choice can disagree. The graded score',
    '    # wins (it is the finer measurement and the study\'s own outcome), but a',
    '    # student who clicked a winner and left the strength slider at 0 exports',
    '    # exactly that disagreement - and the test reads their row as a tie. A few',
    '    # are noise; a lot means the strength field is not being used, and the lists',
    '    # would then be far shorter than the data deserves.',
    '    # How much of the strength column the STUDENT actually set. The export records',
    '    # "card" for a response whose degree was seeded by tapping the answer, and it',
    '    # is the reason the headline counts sides rather than weighing magnitudes.',
    '    n_src = n_card = 0',
    '    if "preference_source" in df.columns:',
    '        src = df.loc[df["score"].notna(), "preference_source"].astype(str).str.strip().str.lower()',
    '        n_src = int(src.isin(["bar", "card"]).sum())',
    '        n_card = int((src == "card").sum())',
    '    if n_src and n_card > 0.5 * n_src:',
    '        print("\\n   NOTE: %d of %d graded responses (%.0f%%) kept the strength the card seeded"',
    '              % (n_card, n_src, 100.0 * n_card / n_src))',
    '        print("   rather than setting it. The headline test counts sides, so it is unaffected;")',
    '        print("   read the p_str column with that in mind.")',
    '',
    '    zero_but_chose = int((df["score"] == 0).sum() and',
    '                         ((df["score"] == 0) & df["chosen"].isin([OPUS, HAIKU])).sum())',
    '    graded_rows = int(df["score"].notna().sum())',
    '    if graded_rows and zero_but_chose > 0.15 * graded_rows:',
    '        print("\\n   WARNING: %d of %d responses name a winner yet grade the two as equal."',
    '              % (zero_but_chose, graded_rows))',
    '        print("   Those count as ties, so the lists below are shorter than the choices alone")',
    '        print("   would suggest. Check whether the strength control was actually used.")',
    '',
    '    if "account_id" in df.columns:',
    '        dup = int(df.duplicated(subset=["account_id", "task_id"]).sum())',
    '        if dup:',
    '            print("\\n   WARNING: %d response(s) repeat a student on a task already answered." % dup)',
    '            print("   Stacked rows make every p-value look stronger than the data supports.")',
    '            print("   Check Section 1 for a session loaded twice before trusting the lists.")',
    '',
    '    # ── One row per task: the two tests, and the counts behind them ──────────',
    '    rows = []',
    '    for t, g in df.groupby("task_id"):',
    '        if not str(t):',
    '            continue                                       # rows carrying no task id',
    '        s = g["score"].values',
    '        p_sign, m, margin = signflip_p(s, votes_only=True)   # THE HEADLINE: the sign test',
    '        p_str, _, total = signflip_p(s)                      # the same, weighted by strength',
    '        graded = int(np.isfinite(np.asarray(s, float)).sum())',
    '        rows.append({"task_id": t, "n": graded, "opus": int(np.nansum(np.asarray(s) > 0)),',
    '                     "tie": int(np.nansum(np.asarray(s) == 0)), "haiku": int(np.nansum(np.asarray(s) < 0)),',
    '                     "m": m, "mean": (float(np.nanmean(s)) if graded else np.nan),',
    '                     "total": total, "margin": margin, "p": p_sign, "p_str": p_str})',
    '    tasks = pd.DataFrame(rows).sort_values("task_id").reset_index(drop=True)',
    '    tasks["q_bh"] = bh(tasks["p"].values)                  # the list-level reading',
    '',
    '    for conf in LEVELS:',
    '        lv = round(100 * conf)',
    '        tasks["at%d" % lv] = [verdict_of(r.p, r.margin, conf) for r in tasks.itertuples()]',
    '        tasks["str%d" % lv] = [verdict_of(r.p_str, r.total, conf) for r in tasks.itertuples()]',
    '        tasks["fdr%d" % lv] = [verdict_of(r.q_bh, r.margin, conf) for r in tasks.itertuples()]',
    '',
    '    need = {conf: min_responses_for(1 - conf) for conf in LEVELS}',
    '    print("")',
    '    print("Each task is judged on its own responses by an EXACT SIGN TEST: of the students")',
    '    print("who expressed a preference at all, would a split this lopsided have come up by")',
    '    print("chance if neither model were really preferred? A task is listed when that chance")',
    '    print("is under %s." % ", ".join("%s for %s" % (pct(1 - c), pct(c)) for c in LEVELS))',
    '    print("The direction is used and not the strength because tapping an answer already")',
    '    print("sets the strength bar to +/-2 - so a magnitude can be the interface\'s, while")',
    '    print("the side chosen is always the student\'s. The same test WITH the strengths")',
    '    print("(p_str) is printed beside every task, and every disagreement is named.")',
    '    for conf in LEVELS:',
    '        print("   %s needs at least %d non-tie responses before ANY split could reach it."',
    '              % (pct(conf), need[conf]))',
    '',
    '    # ── Sections 1 and 2: the answer, one section per confidence level ───────',
    '    answer = {}',
    '    for si, conf in enumerate(LEVELS):',
    '        c, lv = pct(conf), round(100 * conf)',
    '        at, st, fd = "at%d" % lv, "str%d" % lv, "fdr%d" % lv',
    '        cols = ["task_id", "n", "opus", "tie", "haiku", "mean", "p", "p_str", "q_bh"]',
    '        print("\\n" + "=" * 78)',
    '        print("%d. AT %s CONFIDENCE" % (si + 1, c))',
    '        print("=" * 78)',
    '        blocks = {}',
    '        for key, letter, who in [("haiku", "a", "HAIKU (the small, cheap model)"),',
    '                                 ("opus", "b", "OPUS (the large, expensive model)")]:',
    '            sub = tasks[tasks[at] == key].sort_values(["mean", "task_id"],',
    '                                                      ascending=[key == "haiku", True], kind="mergesort")',
    '            blocks[key] = sub',
    '            print("\\n" + "-" * 78)',
    '            print("%d%s. %s is preferred - %d of %d tasks, at %s confidence"',
    '                  % (si + 1, letter, who, len(sub), len(tasks), c))',
    '            print("-" * 78)',
    '            print("   TASK IDS: %s" % ids(sub))',
    '            if len(sub):',
    '                print("")',
    '                print(sub[cols].to_string(index=False, float_format=lambda x: "%.4f" % x))',
    '                soft = sub[sub[st] != key]',
    '                if len(soft):',
    '                    print("   Note - on %s the split says one thing and the strengths another: weighted"',
    '                          % ids(soft))',
    '                    print("   by how strongly students felt, the same test does not reach %s. Some of" % c)',
    '                    print("   those tasks have a mean pointing the other way (see the mean column) -")',
    '                    print("   a few emphatic answers against many mild ones. The weaker listings.")',
    '                weak = sub[sub[fd] != key]',
    '                if len(weak):',
    '                    print("   Note - %s reach %s on their own but not once all %d tasks are allowed"',
    '                          % (ids(weak), c, len(tasks)))',
    '                    print("   for (q above %s). The rest of this list holds up as a SET." % pct(1 - conf))',
    '        rest = tasks[(tasks[at] != "haiku") & (tasks[at] != "opus")]',
    '        print("\\n" + "-" * 78)',
    '        print("%dc. Not established either way at %s - %d of %d tasks"',
    '              % (si + 1, c, len(rest), len(tasks)))',
    '        print("-" * 78)',
    '        print("   TASK IDS: %s" % ids(rest))',
    '        short = rest[rest["m"] < need[conf]]',
    '        if len(short):',
    '            print("   Of those, %s could not have reached %s at ANY split - they carry fewer"',
    '                  % (ids(short), c))',
    '            print("   than %d non-tie responses. That is a sample-size fact, not a finding." % need[conf])',
    '        split = rest[(rest["m"] >= need[conf]) & (rest[at] == "")]',
    '        if len(split):',
    '            print("   The other %d were simply not one-sided enough: %s." % (len(split), ids(split)))',
    '        # The reverse of the "strengths did the work" note above: more students',
    '        # picked one model, but a few emphatic answers the other way cancel them',
    '        # out once strength counts. Worth naming - it is the split a reader would',
    '        # otherwise find only by reading the counts in section %d themselves.',
    '        str_only = rest[rest[st] != ""]',
    '        if len(str_only):',
    '            print("   Note - %s DO reach %s once the strengths are weighed in, though the" % (ids(str_only), c))',
    '            print("   split of who picked what does not. They are held back because a strength")',
    '            print("   can be the interface\'s rather than the student\'s - see p_str in section %d." % (len(LEVELS) + 1))',
    '        print("   These are NOT tasks where the two models are equal. They are tasks")',
    '        print("   where the responses collected so far cannot separate the two at %s." % c)',
    '        answer[conf] = {"haiku": blocks["haiku"], "opus": blocks["opus"], "rest": rest}',
    '',
    '    # ── Section 3: every task, both levels, all three readings ───────────────',
    '    sn = len(LEVELS) + 1',
    '    print("\\n" + "=" * 78)',
    '    print("%d. EVERY TASK, BOTH LEVELS" % sn)',
    '    print("=" * 78)',
    '    print("   n / opus / tie / haiku   responses, and how they split")',
    '    print("   mean                     average graded preference (<0 Haiku, >0 Opus)")',
    '    print("   p                        exact sign test on who picked what - THE HEADLINE")',
    '    print("   p_str                    the same test weighted by how strongly they felt")',
    '    print("   q_bh                     p adjusted for having asked all %d tasks (FDR)" % len(tasks))',
    '    print("   at95/at99                the verdict at each level (from p)")',
    '    print("   str95/str99              what weighing the strengths would say")',
    '    print("   fdr95/fdr99              what survives allowing for all %d tasks" % len(tasks))',
    '    show = ["task_id", "n", "opus", "tie", "haiku", "mean", "p", "p_str", "q_bh"] + \\',
    '        sum([["at%d" % round(100 * c), "str%d" % round(100 * c), "fdr%d" % round(100 * c)] for c in LEVELS], [])',
    '    disp = tasks[show].copy()',
    '    # A blank verdict cell reads as a missing value rather than as "no verdict",',
    '    # so an empty string is shown as "-". Done with .map over the KNOWN verdict',
    '    # columns rather than by testing each column\'s dtype: pandas changed what a',
    '    # column of strings reports as its dtype, and a dtype test that stops',
    '    # matching leaves the cells blank on some builds and filled on others.',
    '    for c in [c for c in show if c[:2] in ("at", "st", "fd")]:',
    '        disp[c] = disp[c].map(lambda v: "-" if v == "" else v)',
    '    print(disp.to_string(index=False, float_format=lambda x: "%.4f" % x))',
    '',
    '    # The stricter level can only ever call fewer tasks - shown, not assumed.',
    '    lo_c, hi_c = LEVELS[0], LEVELS[-1]',
    '    nested = all(set(answer[hi_c][k]["task_id"]) <= set(answer[lo_c][k]["task_id"]) for k in ("haiku", "opus"))',
    '    print("\\n   Check: every task called at %s is also called at %s - %s."',
    '          % (pct(hi_c), pct(lo_c), "yes" if nested else "NO (report this)"))',
    '    for k, who in [("haiku", "Haiku"), ("opus", "Opus")]:',
    '        lost = sorted(set(answer[lo_c][k]["task_id"]) - set(answer[hi_c][k]["task_id"]))',
    '        if lost:',
    '            print("   %s tasks that hold at %s but not at %s: %s."',
    '                  % (who, pct(lo_c), pct(hi_c), ", ".join(lost)))',
    '',
    '    # ── The figure: the answer, and the evidence for it ──────────────────────',
    '    COL = {"haiku": "#3d7bd6", "opus": "#e67e22", "": "#b8b5ae"}',
    '    lv0, lv1 = round(100 * LEVELS[0]), round(100 * LEVELS[-1])',
    '    fp = tasks.sort_values(["mean", "task_id"], kind="mergesort").reset_index(drop=True)',
    '    cols_f = [COL.get(v, COL[""]) for v in fp["at%d" % lv0]]',
    '    y = np.arange(len(fp))',
    '    fig, ax = plt.subplots(1, 2, figsize=(12.5, max(5.0, 0.32 * len(fp) + 1.8)),',
    '                           gridspec_kw={"width_ratios": [1.35, 1]})',
    '    # Left: how far each task leaned, and which way.',
    '    ax[0].barh(y, fp["mean"].values, color=cols_f)',
    '    ax[0].axvline(0, color="#111111", lw=1)',
    '    ax[0].set_yticks(y); ax[0].set_yticklabels(fp["task_id"].values, fontsize=8)',
    '    ax[0].invert_yaxis(); ax[0].set_xlim(-3.2, 3.2)',
    '    ax[0].set_xlabel("mean graded preference (<0 Haiku .. 0 equivalent .. >0 Opus)")',
    '    ax[0].set_title("How far each task leaned")',
    '    # Right: the evidence - each task\'s exact p against the two thresholds.',
    '    ax[1].scatter(np.clip(fp["p"].values, 1e-12, 1), y, s=30, color=cols_f, zorder=3, label="who picked what")',
    '    ax[1].scatter(np.clip(fp["p_str"].values, 1e-12, 1), y, s=22, facecolors="none",',
    '                  edgecolors="#555555", linewidths=0.8, zorder=2, label="weighted by strength")',
    '    for conf, style in [(LEVELS[0], "--"), (LEVELS[-1], ":")]:',
    '        ax[1].axvline(1 - conf, color="#111111", lw=1, ls=style)',
    '        # Label each threshold just ABOVE the panel: placed in data coordinates',
    '        # below the axes it overflows the figure on a short chart (one or two',
    '        # tasks) and matplotlib prints a tight-layout warning into the console.',
    '        ax[1].annotate(pct(conf), xy=(1 - conf, 1.0), xycoords=("data", "axes fraction"),',
    '                       xytext=(0, 3), textcoords="offset points", ha="center", fontsize=8)',
    '    ax[1].set_xscale("log"); ax[1].set_xlim(1e-12, 1.4)',
    '    ax[1].set_yticks(y); ax[1].set_yticklabels([]); ax[1].invert_yaxis()',
    '    ax[1].set_xlabel("p - chance of leaning this far if neither model were preferred")',
    '    ax[1].set_title("The evidence (left of a line = listed at that level)")',
    '    ax[1].legend(loc="lower left", fontsize=8)',
    '    from matplotlib.patches import Patch',
    '    ax[0].legend(handles=[Patch(color=COL["haiku"], label="Haiku preferred at " + pct(LEVELS[0])),',
    '                          Patch(color=COL["opus"], label="Opus preferred at " + pct(LEVELS[0])),',
    '                          Patch(color=COL[""], label="not established")],',
    '                 loc="lower right", fontsize=8)',
    '    fig.tight_layout()',
    '',
    '    # ── INSIGHTS (plain language; rendered by the "Insights gained" section) ─',
    '    print("\\n\\nINSIGHTS")',
    '    print("=" * 78)',
    '    note("## The answer")',
    '    for conf in LEVELS:',
    '        a = answer[conf]',
    '        note("- At **%s confidence**, users prefer **Haiku** on **%d of %d tasks** (%s) and "',
    '             "**Opus** on **%d** (%s). The remaining **%d** are not established either way."',
    '             % (pct(conf), len(a["haiku"]), len(tasks), ids(a["haiku"]),',
    '                len(a["opus"]), ids(a["opus"]), len(a["rest"])))',
    '    note("- **\\"Not established\\" does not mean the two models are equal.** It means these "',
    '         "responses cannot tell them apart at that confidence. Showing that two models are "',
    '         "*equivalent* is a different claim needing a different test, which this script "',
    '         "deliberately does not make.")',
    '    note("- The stricter level can only ever call fewer tasks, and it does: %s."',
    '         % ", ".join("%d task(s) at %s" % (len(answer[c]["haiku"]) + len(answer[c]["opus"]), pct(c))',
    '                     for c in LEVELS))',
    '    note("")',
    '    note("## How sure is \\"sure\\"?")',
    '    note("- Each task is judged by an **exact sign test** on its own answers: among the students "',
    '         "who expressed a preference at all, would a split this lopsided have come up by chance "',
    '         "if neither model were really preferred? At %s that chance is under %s for every listed "',
    '         "task. Nothing is approximated - the test counts the possibilities rather than assuming "',
    '         "a bell curve, which is what matters when a task has 15 answers rather than 500."',
    '         % (pct(LEVELS[0]), pct(1 - LEVELS[0])))',
    '    note("- **Why the direction and not the strength.** Tapping an answer in Answer Arena already "',
    '         "moves the strength bar to +/-2, so a student who taps and moves on exports a magnitude "',
    '         "the screen chose (the export records that as `preference_source = card`). The side they "',
    '         "picked is always their own deliberate act, and one student\'s \\"3\\" is not another\'s, so "',
    '         "counting sides uses the part of each answer the student really produced.%s"',
    '         % (" Here **%d of %d** graded responses (%.0f%%) kept the strength the card seeded."',
    '            % (n_card, n_src, 100.0 * n_card / n_src) if n_src else ""))',
    '    note("- Because the smallest chance the test can produce on **m** expressed preferences is "',
    '         "1 in 2^(m-1), a task needs at least **%d** of them before it could reach %s at all, "',
    '         "and **%d** before it could reach %s. Tasks below that are listed as such - it is a "',
    '         "sample-size fact, not a finding about the models."',
    '         % (need[LEVELS[0]], pct(LEVELS[0]), need[LEVELS[-1]], pct(LEVELS[-1])))',
    '    soft_all = tasks[(tasks["at%d" % lv0] != "") & (tasks["at%d" % lv0] != tasks["str%d" % lv0])]',
    '    if len(soft_all):',
    '        note("- The strength reading disagrees on **%s**: weighing how strongly students felt, the "',
    '             "same test does not reach %s there (on some of them the mean points the other way "',
    '             "entirely - many mild answers one side, a few emphatic ones the other). Those are the "',
    '             "weakest entries on the list, and the `p_str` column is where to look."',
    '             % (ids(soft_all), pct(LEVELS[0])))',
    '    else:',
    '        note("- Every listed task is listed on the **strengths** as well as on the split, which is "',
    '             "the strongest form this answer can take - the count and the conviction agree.")',
    '    str_only_all = tasks[(tasks["at%d" % lv0] == "") & (tasks["str%d" % lv0] != "")]',
    '    if len(str_only_all):',
    '        note("- The other way round, **%s** would be listed if the strengths were weighed in, but "',
    '             "the split of who picked what does not reach %s on its own. They are held back on "',
    '             "purpose - a strength can be the interface\'s rather than the student\'s."',
    '             % (ids(str_only_all), pct(LEVELS[0])))',
    '    fdr_calls = tasks[tasks["fdr%d" % lv0] != ""]',
    '    note("- Asking the same question of %d tasks means about %.1f of them would look decided at "',
    '         "%s even if the models were tied everywhere. Judged as a SET rather than one at a time "',
    '         "(Benjamini-Hochberg, the q column), **%d task(s)** survive: %s. Use the full list to "',
    '         "decide one task; use this shorter one when quoting the whole set as a finding. (Students "',
    '         "answer many tasks each, so that share is a good approximation rather than a theorem.)"',
    '         % (len(tasks), len(tasks) * (1 - LEVELS[0]), pct(LEVELS[0]), len(fdr_calls), ids(fdr_calls)))',
    '    note("")',
    '    note("## Figure 1 - Every task: how far it leaned, and how sure we are")',
    '    note("- **Left panel** - one bar per task, its **mean graded preference**: left of the line "',
    '         "its students leaned to Haiku, right of it to Opus, and the length is how strongly. "',
    '         "Blue = Haiku preferred at %s, orange = Opus preferred at %s, grey = not established."',
    '         % (pct(LEVELS[0]), pct(LEVELS[0])))',
    '    note("- **Right panel** - the same tasks, showing **why**. Each filled dot is that task\'s "',
    '         "exact p, on a log scale, with the two thresholds drawn as vertical lines: **a task is "',
    '         "listed exactly when its dot sits left of the line**. The hollow dot beside it is the "',
    '         "same test weighted by how strongly students felt - when the two sit together the count "',
    '         "and the conviction agree, and when they are far apart the task is worth a second look.")',
    '    note("- A long grey bar on the left panel with a dot far to the right on the right panel is "',
    '         "the case worth understanding: those students leaned, on average, but either too few "',
    '         "answered or they disagreed too much for that lean to be more than chance.")',
    '    for line in INS:',
    '        print(line)',
    '    print("\\nDone.")'
  ].join('\n');

  var DA_R_TEMPLATE = [
    '# ================================================================================',
    '# ANSWER ARENA - for which TASKS is HAIKU preferred, and for which OPUS?',
    '# ================================================================================',
    '# THE ONE QUESTION THIS SCRIPT ANSWERS',
    '#',
    '#   Given the data collected so far, for which specific task ids can we say with',
    '#   95% confidence that HAIKU is preferred, and for which that OPUS is preferred?',
    '#   Then the same question again at the stricter 99% confidence.',
    '#',
    '# Nothing else. Four lists of task ids, the numbers behind them, and one figure.',
    '#',
    '# --------------------------------------------------------------------------------',
    '# THE STUDY, IN FOUR LINES',
    '#   For each task (a real user need) the same prompt was sent to Haiku 4.5 (the',
    '#   BASELINE, small and cheap) and to Opus 4.8 (the FRONTIER, large and expensive).',
    '#   Both answers were shown to a student WITHOUT labels; the student said which one',
    '#   resolved the task better and how strongly. Each student saw a random subset of',
    '#   the tasks, so tasks have different numbers of responses - which is exactly why',
    '#   a confidence level, rather than a raw win count, is what settles the question.',
    '#',
    '# THE DATA (the table picked in Section 3, handed in as the string DATA_CSV)',
    '#   account_id        the student. A student answers many tasks but each task at',
    '#                     most ONCE, so within one task the responses are independent.',
    '#   task_id           the task / user need - the thing we report on.',
    '#   chosen_model      baseline (Haiku) | frontier (Opus) | tie',
    '#   preference_model  graded preference, integer -3..+3, MODEL frame:',
    '#                     <0 Haiku preferred, 0 equivalent, >0 Opus preferred.',
    '#   submitted         \'yes\' for a real (non-draft) answer; blank counts as real.',
    '#',
    '# --------------------------------------------------------------------------------',
    '# THE TEST, AND WHY IT IS THIS ONE',
    '#',
    '# For one task, look only at the students who expressed a preference at all - the',
    '# ones who did not call the two answers equivalent. Say m of them did, and k of',
    '# those picked Opus. If neither model were really preferred, each of those',
    '# students was as likely to have picked one answer as the other, so k would behave',
    '# like m coin tosses. The question becomes: out of all 2^m ways those m students',
    '# could have chosen, how often would the split come out as lopsided as the split',
    '# we actually saw?',
    '#',
    '#   p = (number of ways the split could be at least this lopsided) / 2^m',
    '#',
    '# That is the EXACT SIGN TEST, computed below by adding up every possibility',
    '# rather than by sampling or by any approximation. A task is listed at confidence',
    '# C when p <= 1-C, on the side more students picked.',
    '#',
    '# Why the DIRECTION and not the strength? Because the strength is partly the',
    '# interface, not the student. Tapping an answer card in Answer Arena already sets',
    '# the 7-point bar to +/-2; a student who taps and moves on exports a magnitude of',
    '# 2 that the screen chose for them (the export records this in',
    '# `preference_source`: "card" rather than "bar"). The SIGN, though, is always',
    '# their own deliberate act. A test on the sign therefore uses exactly the part of',
    '# each response the student produced and discards exactly the part the interface',
    '# produced. The scale is also not calibrated between people - one student\'s "3" is',
    '# another\'s "1" - and the sign is comparable across students in a way the',
    '# magnitude is not.',
    '#',
    '# The strength is not thrown away. The SAME computation, run with each response',
    '# weighted by how strongly it was felt, is printed beside every task as',
    '# `p_str`, and every task where the two readings disagree is named. When they',
    '# agree, the listing rests on both the count and the conviction.',
    '#',
    '# Why not a t-test, which the earlier version of this script used? It is an',
    '# approximation that needs a large sample, and here the samples are 10-30 answers',
    '# on a bounded scale with a heap of exact zeros. It is also undefined - 0/0 - on',
    '# exactly the tasks carrying the most evidence, the ones where every student said',
    '# the same thing, and had to be patched by hand for them. The exact test needs no',
    '# approximation, no degrees of freedom, and no special conventions: a task where',
    '# everyone answered identically, a task with two answers, a task where everyone',
    '# tied, all fall out of the same formula with a sensible p. Its p-values are',
    '# lumpy and it is a shade conservative, which errs the safe way for a list of',
    '# claims.',
    '#',
    '# MULTIPLE TASKS. Asking the same question of ~30 tasks at 95% means that if the',
    '# models were really tied everywhere, roughly one or two tasks would still look',
    '# decided. So each task also carries a BENJAMINI-HOCHBERG adjusted value (q), the',
    '# false-discovery-rate reading: "of the tasks on this list, at most this share are',
    '# expected to be there by chance". It is shown as a COLUMN and never filters the',
    '# lists - the question asked is per task, and the answer to it stays per task.',
    '#',
    '# A task that is NOT listed is NOT a task where the two models are equal. It is a',
    '# task where these responses cannot tell them apart at that confidence. Showing',
    '# that two models are EQUIVALENT is a different claim needing a different test,',
    '# and this script deliberately does not make it.',
    '# ================================================================================',
    '#',
    '# This R version computes exactly the same numbers as the Python one, in base R',
    '# only: the sign distribution is built by the same convolution, so there is no',
    '# library on either side whose edge-case conventions could make the two',
    '# languages answer differently.',
    '',
    '',
    '# -- The two systems being compared. Never shown to the students. -------------',
    'OPUS <- "frontier"; HAIKU <- "baseline"',
    '',
    '# -- The two confidence levels the question asks for --------------------------',
    '# Everything printed is built from THIS vector, so a label can never claim a',
    '# confidence the tests did not use. Add a level and the report grows a section',
    '# for it; change one and every number and every word follows.',
    'LEVELS <- c(0.95, 0.99)',
    '',
    '# Print wide tables on ONE line. Base R wraps a data frame at its `width` option',
    '# and the wrapped remainder reads as a second, headerless table; the Python',
    '# version sets the same width, so the two outputs stay comparable line for line.',
    'options(width = 200)',
    '',
    '# -- The test itself ----------------------------------------------------------',
    '# EXACT two-sided sign-flip test of a task\'s scores against "no preference".',
    '#',
    '# `values` are that task\'s scores on the -3..+3 scale. Zeros (exact ties) are',
    '# dropped: flipping the sign of a zero changes nothing, so they cannot make the',
    '# total more or less one-sided. votes_only = TRUE sets every remaining magnitude',
    '# to 1, which turns the same computation into the exact SIGN TEST - how many',
    '# students picked each model, ignoring how strongly.',
    '#',
    '# The null distribution of the total is built by convolution rather than by',
    '# listing all 2^m patterns: `d` holds the probability of each reachable total,',
    '# and adding one more response either subtracts its magnitude (probability a',
    '# half) or adds it (a half). Probabilities are carried rather than counts, so a',
    '# task with many responses cannot overflow. Both languages perform the same',
    '# additions in the same order, so the two agree to the last bit.',
    '#',
    '# Returns p (two-sided), m (non-tie responses used) and the observed total. Under',
    '# votes_only the total is the VOTE margin (how many more students picked one',
    '# model), and it is that margin, not the score total, which must give the verdict',
    '# its direction: a task can have more Opus votes while a couple of emphatic Haiku',
    '# answers pull the score total the other way.',
    'signflip_p <- function(values, votes_only = FALSE) {',
    '  v <- values[is.finite(values)]                 # drop missing scores',
    '  mag <- abs(v); mag <- mag[mag > 0]             # exact ties contribute nothing',
    '  if (votes_only) mag <- rep(1, length(mag))     # magnitudes ignored -> the sign test',
    '  m <- length(mag)',
    '  total <- if (votes_only) sum(sign(v)) else sum(v)',
    '  if (m == 0) return(list(p = 1, m = 0L, total = total))   # every response a tie, or none',
    '  mag <- as.integer(mag)                         # the scale is whole numbers',
    '  span <- 0                                      # the current total\'s range is +/- span',
    '  d <- 1                                         # d[j] = P(total == j - 1 - span)',
    '  for (a in mag) {                               # one response at a time',
    '    nxt <- numeric(length(d) + 2 * a)            # the range grows by `a` each side',
    '    nxt[seq_along(d)] <- nxt[seq_along(d)] + 0.5 * d                  # signed MINUS',
    '    nxt[2 * a + seq_along(d)] <- nxt[2 * a + seq_along(d)] + 0.5 * d  # signed PLUS',
    '    d <- nxt; span <- span + a',
    '  }',
    '  reach <- seq_along(d) - 1 - span               # the total each entry stands for',
    '  p <- sum(d[abs(reach) >= abs(total) - 1e-9])   # as one-sided, or more',
    '  list(p = min(1, p), m = m, total = total)',
    '}',
    '',
    '# The fewest non-tie responses a task needs before ANY split could reach this',
    '# level. The most one-sided outcome possible has p = 2^(1-m), so below this many',
    '# answers the task cannot be listed however unanimous it was - which is a',
    '# sample-size fact worth printing, not a failure of the task.',
    'min_responses_for <- function(alpha) {',
    '  m <- 1',
    '  while (2^(1 - m) > alpha && m < 60) m <- m + 1',
    '  m',
    '}',
    '',
    '# Benjamini-Hochberg adjusted p-values (the false-discovery-rate reading),',
    '# computed BY HAND so the Python and R versions cannot differ (rather than via',
    '# p.adjust, whose tie handling would have to be matched separately). Sort',
    '# ascending, scale the k-th smallest of M by M/k, then walk back down taking a',
    '# running minimum so the adjusted values never decrease, and cap at 1.',
    'bh <- function(pvals) {',
    '  out <- rep(NA_real_, length(pvals))',
    '  idx <- which(is.finite(pvals))',
    '  if (!length(idx)) return(out)',
    '  ord <- idx[order(pvals[idx])]                  # stable, like Python\'s mergesort',
    '  M <- length(ord); running <- 1',
    '  for (k in M:1) {                               # largest first: step-up',
    '    j <- ord[k]',
    '    running <- min(running, M * pvals[j] / k)',
    '    out[j] <- min(1, running)',
    '  }',
    '  out',
    '}',
    '',
    '# -- Small helpers ------------------------------------------------------------',
    '# 0.95 -> "95%". Used for every printed label.',
    'pct <- function(conf) paste0(format(round(100 * conf, 10), trim = TRUE), "%")',
    '',
    '# One task, one confidence level, one word: "haiku", "opus" or "" (not',
    '# established). A verdict needs a significant test AND a direction; a total of',
    '# exactly 0 gives p = 1, so it can never be assigned one.',
    'verdict_of <- function(p, total, conf) {',
    '  if (!is.finite(p) || total == 0) return("")',
    '  if (p > 1 - conf) return("")',
    '  if (total > 0) "opus" else "haiku"',
    '}',
    '',
    '# The task ids of a table, comma-separated - the answer in its shortest form.',
    'ids <- function(d) if (nrow(d)) paste(d$task_id, collapse = ", ") else "(none)"',
    '',
    '# Round a data frame\'s numeric columns for DISPLAY only; the stored values stay',
    '# unrounded, so a rounded p can never flip a verdict relative to Python.',
    'round_df <- function(d, digits) { for (nm in names(d)) if (is.numeric(d[[nm]])) d[[nm]] <- round(d[[nm]], digits); d }',
    '',
    'INS <- character(0); note <- function(s = "") INS <<- c(INS, s)   # the INSIGHTS block',
    '',
    '# -- Load the data, keep only real (submitted) comparisons --------------------',
    '# EVERY column is read as TEXT and coerced by hand below. Left to itself pandas',
    '# infers types and R does not: a student id of "0012" would become the number 12',
    '# in Python and stay "0012" here (two different students merged in one language',
    '# only), a task id of "07" would sort differently, and a TRUE/FALSE submitted',
    '# column would arrive as a boolean that the text filter below drops entirely -',
    '# silently throwing away every row and reporting it as "nothing reached',
    '# significance".',
    'df <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE, check.names = FALSE, colClasses = "character")',
    'n_read <- nrow(df); n_draft <- 0',
    'if ("submitted" %in% names(df)) {',
    '  # A BLANK value counts as submitted (an imported third-party table often has',
    '  # no real submitted flag) - the same rule the Section-2 charts use, so the',
    '  # charts and this script always describe the same rows. Drafts stay out.',
    '  # %in% (not ==) so an NA in the column can never poison the row filter.',
    '  sub_ <- tolower(trimws(as.character(df$submitted)))',
    '  # "true"/"1"/"y" join "yes" because an imported third-party workbook writes',
    '  # the flag however its own tool wrote it; a spreadsheet exporting a boolean',
    '  # column as TRUE would otherwise make EVERY row a draft and the whole table',
    '  # would silently read as "nothing reached significance".',
    '  df <- df[is.na(sub_) | sub_ %in% c("yes", "", "true", "t", "y", "1"), , drop = FALSE]',
    '  n_draft <- n_read - nrow(df)',
    '}',
    '# Each column is optional-safe: a table without it yields empty values instead of',
    '# crashing, so running this on the wrong sheet gives a message, not an error.',
    'df$pref <- if ("preference_model" %in% names(df)) suppressWarnings(as.numeric(as.character(df$preference_model))) else rep(NA_real_, nrow(df))',
    'df$chosen <- if ("chosen_model" %in% names(df)) tolower(trimws(as.character(df$chosen_model))) else rep("", nrow(df))',
    'df$task_id <- if ("task_id" %in% names(df)) trimws(as.character(df$task_id)) else rep("", nrow(df))',
    '# NA -> "" on the two text keys (read.csv turns a blank in a numeric column, or a',
    '# literal "NA", into a real NA): an NA task_id would silently VANISH from every',
    '# split() while staying in the row count. Python reads the same cells as ""',
    '# (keep_default_na = FALSE), so this keeps the two languages on the same rows.',
    'df$task_id[is.na(df$task_id)] <- ""; df$chosen[is.na(df$chosen)] <- ""',
    '',
    '# The score the test reads. Normally the graded -3..+3 answer; where a row',
    '# recorded only a CHOICE, its direction stands in with a magnitude of 1, so a',
    '# table carrying one column but not the other is still answerable. (On the app\'s',
    '# own Responses table every row is graded, so this never fires.)',
    'dchoice <- rep(NA_real_, nrow(df))',
    'dchoice[df$chosen == HAIKU] <- -1; dchoice[df$chosen == "tie"] <- 0; dchoice[df$chosen == OPUS] <- 1',
    'raw_score <- ifelse(is.na(df$pref), dchoice, df$pref)',
    '# Only a WHOLE number on the -3..+3 scale is a score this instrument can have',
    '# produced. Anything else - a re-scaled export writing 1.5, a stray 10, text -',
    '# is dropped and counted rather than coerced: both languages would otherwise',
    '# truncate it towards zero when the test takes its magnitude, quietly turning',
    '# 1.5 into 1 and answering a question about data that was never collected.',
    'valid <- !is.na(raw_score) & is.finite(raw_score) & raw_score == round(raw_score) & abs(raw_score) <= 3',
    'n_bad_score <- sum(!is.na(raw_score) & !valid)',
    'df$score <- ifelse(valid, raw_score, NA_real_)',
    '',
    'n_rows <- nrow(df)',
    '# "n/a" rather than NA: a table with no account_id column has no student count,',
    '# and printing NA reads as a broken number instead of an absent one.',
    'n_students <- if ("account_id" %in% names(df)) as.character(length(unique(df$account_id))) else "n/a"',
    'n_tasks <- length(unique(df$task_id[nchar(df$task_id) > 0]))',
    '',
    'cat(strrep("=", 78), "\\n", sep = "")',
    'cat("ANSWER ARENA - which tasks is HAIKU preferred on, and which is OPUS?\\n")',
    'cat(strrep("=", 78), "\\n", sep = "")',
    'cat(sprintf("Responses: %d   Students: %s   Tasks: %d\\n", n_rows, n_students, n_tasks))',
    '# Said out loud: a filter that quietly removed most of the table would otherwise',
    '# show up only as "nothing reached significance".',
    'if (n_draft > 0) cat(sprintf("(%d of the %d rows read were drafts and are excluded.)\\n", n_draft, n_read))',
    'if (n_bad_score > 0) cat(sprintf("(%d row(s) carried a score outside the whole numbers -3..+3 and are excluded.)\\n", n_bad_score))',
    '',
    'if (n_rows == 0 || sum(!is.na(df$score)) == 0 || n_tasks == 0) {',
    '  cat("\\nNo comparisons in the selected table - pick the Responses table (one\\n")',
    '  cat("row per comparison) in Section 3 and run again.\\n")',
    '  cat("\\n\\nINSIGHTS\\n"); cat(strrep("=", 78), "\\n", sep = "")',
    '  cat("## No data\\n")',
    '  cat("- The selected table holds no comparisons, so no task can be called either way. Pick the **Responses** table in Section 3 and run again.\\n")',
    '} else {',
    '  # One student should answer one task once. Stacked rows (the same session',
    '  # loaded twice, say) would make every task look better-evidenced than it is,',
    '  # so this is REPORTED rather than silently deduplicated - which of the two',
    '  # copies is the real answer is not something this script can know.',
    '  # The graded score and the recorded choice can disagree. The graded score wins',
    '  # (it is the finer measurement and the study\'s own outcome), but a student who',
    '  # clicked a winner and left the strength slider at 0 exports exactly that',
    '  # disagreement - and the test reads their row as a tie. A few are noise; a lot',
    '  # means the strength field is not being used, and the lists would then be far',
    '  # shorter than the data deserves.',
    '  # How much of the strength column the STUDENT actually set. The export records',
    '  # "card" for a response whose degree was seeded by tapping the answer, and it',
    '  # is the reason the headline counts sides rather than weighing magnitudes.',
    '  n_src <- 0; n_card <- 0',
    '  if ("preference_source" %in% names(df)) {',
    '    src <- tolower(trimws(as.character(df$preference_source[!is.na(df$score)])))',
    '    n_src <- sum(src %in% c("bar", "card")); n_card <- sum(src == "card")',
    '  }',
    '  if (n_src > 0 && n_card > 0.5 * n_src) {',
    '    cat(sprintf("\\n   NOTE: %d of %d graded responses (%.0f%%) kept the strength the card seeded\\n",',
    '                n_card, n_src, 100 * n_card / n_src))',
    '    cat("   rather than setting it. The headline test counts sides, so it is unaffected;\\n")',
    '    cat("   read the p_str column with that in mind.\\n")',
    '  }',
    '',
    '  zero_but_chose <- sum(!is.na(df$score) & df$score == 0 & df$chosen %in% c(OPUS, HAIKU))',
    '  graded_rows <- sum(!is.na(df$score))',
    '  if (graded_rows > 0 && zero_but_chose > 0.15 * graded_rows) {',
    '    cat(sprintf("\\n   WARNING: %d of %d responses name a winner yet grade the two as equal.\\n", zero_but_chose, graded_rows))',
    '    cat("   Those count as ties, so the lists below are shorter than the choices alone\\n")',
    '    cat("   would suggest. Check whether the strength control was actually used.\\n")',
    '  }',
    '',
    '  if ("account_id" %in% names(df)) {',
    '    dup <- sum(duplicated(df[, c("account_id", "task_id")]))',
    '    if (dup > 0) {',
    '      cat(sprintf("\\n   WARNING: %d response(s) repeat a student on a task already answered.\\n", dup))',
    '      cat("   Stacked rows make every p-value look stronger than the data supports.\\n")',
    '      cat("   Check Section 1 for a session loaded twice before trusting the lists.\\n")',
    '    }',
    '  }',
    '',
    '  # -- One row per task: the two tests, and the counts behind them ------------',
    '  keep <- df[nchar(df$task_id) > 0, , drop = FALSE]        # rows carrying no task id',
    '  tasks <- do.call(rbind, lapply(split(keep, keep$task_id), function(g) {',
    '    s <- g$score',
    '    a <- signflip_p(s, votes_only = TRUE)                  # THE HEADLINE: the sign test',
    '    b <- signflip_p(s)                                     # the same, weighted by strength',
    '    graded <- sum(is.finite(s))',
    '    data.frame(task_id = g$task_id[1], n = graded,',
    '               opus = sum(s > 0, na.rm = TRUE), tie = sum(s == 0, na.rm = TRUE),',
    '               haiku = sum(s < 0, na.rm = TRUE), m = a$m,',
    '               mean = if (graded) mean(s, na.rm = TRUE) else NA_real_,',
    '               total = b$total, margin = a$total, p = a$p, p_str = b$p, stringsAsFactors = FALSE)',
    '  }))',
    '  # method = "radix" is BYTE order, which is what Python sorts strings by. R\'s',
    '  # default collation is locale-dependent, so a task id carrying a hyphen or a',
    '  # lower-case letter could order differently in the two languages.',
    '  tasks <- tasks[order(tasks$task_id, method = "radix"), , drop = FALSE]; rownames(tasks) <- NULL',
    '  tasks$q_bh <- bh(tasks$p)                                # the list-level reading',
    '',
    '  for (conf in LEVELS) {',
    '    lv <- round(100 * conf)',
    '    tasks[[paste0("at", lv)]] <- vapply(seq_len(nrow(tasks)), function(i) verdict_of(tasks$p[i], tasks$margin[i], conf), character(1))',
    '    tasks[[paste0("str", lv)]] <- vapply(seq_len(nrow(tasks)), function(i) verdict_of(tasks$p_str[i], tasks$total[i], conf), character(1))',
    '    tasks[[paste0("fdr", lv)]] <- vapply(seq_len(nrow(tasks)), function(i) verdict_of(tasks$q_bh[i], tasks$margin[i], conf), character(1))',
    '  }',
    '',
    '  need <- vapply(LEVELS, function(c_) min_responses_for(1 - c_), numeric(1))',
    '  names(need) <- as.character(LEVELS)',
    '  cat("\\n")',
    '  cat("Each task is judged on its own responses by an EXACT SIGN TEST: of the students\\n")',
    '  cat("who expressed a preference at all, would a split this lopsided have come up by\\n")',
    '  cat("chance if neither model were really preferred? A task is listed when that chance\\n")',
    '  cat(sprintf("is under %s.\\n",',
    '              paste(vapply(LEVELS, function(c_) sprintf("%s for %s", pct(1 - c_), pct(c_)), character(1)),',
    '                    collapse = ", ")))',
    '  cat("The direction is used and not the strength because tapping an answer already\\n")',
    '  cat("sets the strength bar to +/-2 - so a magnitude can be the interface\'s, while\\n")',
    '  cat("the side chosen is always the student\'s. The same test WITH the strengths\\n")',
    '  cat("(p_str) is printed beside every task, and every disagreement is named.\\n")',
    '  for (conf in LEVELS) {',
    '    cat(sprintf("   %s needs at least %d non-tie responses before ANY split could reach it.\\n",',
    '                pct(conf), need[[as.character(conf)]]))',
    '  }',
    '',
    '  # -- Sections 1 and 2: the answer, one section per confidence level ---------',
    '  answer <- list()',
    '  for (si in seq_along(LEVELS)) {',
    '    conf <- LEVELS[si]; c_ <- pct(conf); lv <- round(100 * conf)',
    '    at <- paste0("at", lv); st <- paste0("str", lv); fd <- paste0("fdr", lv)',
    '    cols <- c("task_id", "n", "opus", "tie", "haiku", "mean", "p", "p_str", "q_bh")',
    '    cat("\\n", strrep("=", 78), "\\n", sep = "")',
    '    cat(sprintf("%d. AT %s CONFIDENCE\\n", si, c_))',
    '    cat(strrep("=", 78), "\\n", sep = "")',
    '    blocks <- list()',
    '    who_of <- c(haiku = "HAIKU (the small, cheap model)", opus = "OPUS (the large, expensive model)")',
    '    let_of <- c(haiku = "a", opus = "b")',
    '    for (key in c("haiku", "opus")) {',
    '      sub <- tasks[tasks[[at]] == key, , drop = FALSE]',
    '      sub <- sub[order(if (key == "haiku") sub$mean else -sub$mean, sub$task_id, method = "radix"), , drop = FALSE]',
    '      blocks[[key]] <- sub',
    '      cat("\\n", strrep("-", 78), "\\n", sep = "")',
    '      cat(sprintf("%d%s. %s is preferred - %d of %d tasks, at %s confidence\\n",',
    '                  si, let_of[[key]], who_of[[key]], nrow(sub), nrow(tasks), c_))',
    '      cat(strrep("-", 78), "\\n", sep = "")',
    '      cat(sprintf("   TASK IDS: %s\\n", ids(sub)))',
    '      if (nrow(sub)) {',
    '        cat("\\n")',
    '        print(round_df(sub[, cols], 4), row.names = FALSE)',
    '        soft <- sub[sub[[st]] != key, , drop = FALSE]',
    '        if (nrow(soft)) {',
    '          cat(sprintf("   Note - on %s the split says one thing and the strengths another: weighted\\n", ids(soft)))',
    '          cat(sprintf("   by how strongly students felt, the same test does not reach %s. Some of\\n", c_))',
    '          cat("   those tasks have a mean pointing the other way (see the mean column) -\\n")',
    '          cat("   a few emphatic answers against many mild ones. The weaker listings.\\n")',
    '        }',
    '        weak <- sub[sub[[fd]] != key, , drop = FALSE]',
    '        if (nrow(weak)) {',
    '          cat(sprintf("   Note - %s reach %s on their own but not once all %d tasks are allowed\\n", ids(weak), c_, nrow(tasks)))',
    '          cat(sprintf("   for (q above %s). The rest of this list holds up as a SET.\\n", pct(1 - conf)))',
    '        }',
    '      }',
    '    }',
    '    rest <- tasks[tasks[[at]] != "haiku" & tasks[[at]] != "opus", , drop = FALSE]',
    '    cat("\\n", strrep("-", 78), "\\n", sep = "")',
    '    cat(sprintf("%dc. Not established either way at %s - %d of %d tasks\\n", si, c_, nrow(rest), nrow(tasks)))',
    '    cat(strrep("-", 78), "\\n", sep = "")',
    '    cat(sprintf("   TASK IDS: %s\\n", ids(rest)))',
    '    short <- rest[rest$m < need[[as.character(conf)]], , drop = FALSE]',
    '    if (nrow(short)) {',
    '      cat(sprintf("   Of those, %s could not have reached %s at ANY split - they carry fewer\\n", ids(short), c_))',
    '      cat(sprintf("   than %d non-tie responses. That is a sample-size fact, not a finding.\\n", need[[as.character(conf)]]))',
    '    }',
    '    split_ <- rest[rest$m >= need[[as.character(conf)]] & rest[[at]] == "", , drop = FALSE]',
    '    if (nrow(split_)) cat(sprintf("   The other %d were simply not one-sided enough: %s.\\n", nrow(split_), ids(split_)))',
    '    # The reverse of the "strengths did the work" note above: more students',
    '    # picked one model, but a few emphatic answers the other way cancel them out',
    '    # once strength counts. Worth naming - it is the split a reader would',
    '    # otherwise find only by reading the counts in the last section themselves.',
    '    str_only <- rest[rest[[st]] != "", , drop = FALSE]',
    '    if (nrow(str_only)) {',
    '      cat(sprintf("   Note - %s DO reach %s once the strengths are weighed in, though the\\n", ids(str_only), c_))',
    '      cat("   split of who picked what does not. They are held back because a strength\\n")',
    '      cat(sprintf("   can be the interface\'s rather than the student\'s - see p_str in section %d.\\n", length(LEVELS) + 1))',
    '    }',
    '    cat("   These are NOT tasks where the two models are equal. They are tasks\\n")',
    '    cat(sprintf("   where the responses collected so far cannot separate the two at %s.\\n", c_))',
    '    answer[[as.character(conf)]] <- list(haiku = blocks$haiku, opus = blocks$opus, rest = rest)',
    '  }',
    '',
    '  # -- Section 3: every task, both levels, all three readings -----------------',
    '  sn <- length(LEVELS) + 1',
    '  cat("\\n", strrep("=", 78), "\\n", sep = "")',
    '  cat(sprintf("%d. EVERY TASK, BOTH LEVELS\\n", sn))',
    '  cat(strrep("=", 78), "\\n", sep = "")',
    '  cat("   n / opus / tie / haiku   responses, and how they split\\n")',
    '  cat("   mean                     average graded preference (<0 Haiku, >0 Opus)\\n")',
    '  cat("   p                        exact sign test on who picked what - THE HEADLINE\\n")',
    '  cat("   p_str                    the same test weighted by how strongly they felt\\n")',
    '  cat(sprintf("   q_bh                     p adjusted for having asked all %d tasks (FDR)\\n", nrow(tasks)))',
    '  cat("   at95/at99                the verdict at each level (from p)\\n")',
    '  cat("   str95/str99              what weighing the strengths would say\\n")',
    '  cat(sprintf("   fdr95/fdr99              what survives allowing for all %d tasks\\n", nrow(tasks)))',
    '  show <- c("task_id", "n", "opus", "tie", "haiku", "mean", "p", "p_str", "q_bh",',
    '            unlist(lapply(LEVELS, function(c_) paste0(c("at", "str", "fdr"), round(100 * c_)))))',
    '  disp <- round_df(tasks[, show], 4)',
    '  # A blank verdict cell reads as a missing value rather than as "no verdict",',
    '  # so an empty string is shown as "-".',
    '  for (nm in show) if (is.character(disp[[nm]]) && nm != "task_id") disp[[nm]][disp[[nm]] == ""] <- "-"',
    '  print(disp, row.names = FALSE)',
    '',
    '  # The stricter level can only ever call fewer tasks - shown, not assumed.',
    '  lo_c <- LEVELS[1]; hi_c <- LEVELS[length(LEVELS)]',
    '  a_lo <- answer[[as.character(lo_c)]]; a_hi <- answer[[as.character(hi_c)]]',
    '  nested <- all(a_hi$haiku$task_id %in% a_lo$haiku$task_id) && all(a_hi$opus$task_id %in% a_lo$opus$task_id)',
    '  cat(sprintf("\\n   Check: every task called at %s is also called at %s - %s.\\n",',
    '              pct(hi_c), pct(lo_c), if (nested) "yes" else "NO (report this)"))',
    '  for (k in c("haiku", "opus")) {',
    '    lost <- sort(setdiff(a_lo[[k]]$task_id, a_hi[[k]]$task_id), method = "radix")',
    '    if (length(lost)) cat(sprintf("   %s tasks that hold at %s but not at %s: %s.\\n",',
    '                                  if (k == "haiku") "Haiku" else "Opus", pct(lo_c), pct(hi_c), paste(lost, collapse = ", ")))',
    '  }',
    '',
    '  # -- The figure: the answer, and the evidence for it ------------------------',
    '  # R rejects 3-digit hex colours, so every colour here is 6-digit.',
    '  COL <- c(haiku = "#3d7bd6", opus = "#e67e22", none = "#b8b5ae")',
    '  colour_of <- function(v) ifelse(v == "haiku", COL[["haiku"]], ifelse(v == "opus", COL[["opus"]], COL[["none"]]))',
    '  lv0 <- round(100 * LEVELS[1]); lv1 <- round(100 * LEVELS[length(LEVELS)])',
    '  fp <- tasks[order(tasks$mean, tasks$task_id, method = "radix"), , drop = FALSE]',
    '  cols_f <- colour_of(fp[[paste0("at", lv0)]])',
    '  yy <- seq_len(nrow(fp))',
    '  op <- par(mfrow = c(1, 2), mar = c(4.6, 5.0, 3.0, 1.0))',
    '  # Left: how far each task leaned, and which way.',
    '  plot(NA, xlim = c(-3.2, 3.2), ylim = c(nrow(fp) + 0.5, 0.5), yaxt = "n", bty = "n",',
    '       xlab = "mean graded preference (<0 Haiku .. 0 equivalent .. >0 Opus)", ylab = "",',
    '       main = "How far each task leaned", cex.main = 0.95)',
    '  axis(2, at = yy, labels = fp$task_id, las = 1, cex.axis = 0.7, tick = FALSE)',
    '  rect(pmin(0, fp$mean), yy - 0.38, pmax(0, fp$mean), yy + 0.38, col = cols_f, border = NA)',
    '  abline(v = 0, col = "#111111", lwd = 1)',
    '  legend("bottomright", bty = "n", cex = 0.7, pch = 15, col = unname(COL),',
    '         legend = c(paste("Haiku preferred at", pct(LEVELS[1])),',
    '                    paste("Opus preferred at", pct(LEVELS[1])), "not established"))',
    '  # Right: the evidence - each task\'s exact p against the two thresholds.',
    '  plot(NA, xlim = c(1e-12, 1.4), ylim = c(nrow(fp) + 0.5, 0.5), log = "x", yaxt = "n", bty = "n",',
    '       xlab = "p - chance of leaning this far if neither model were preferred", ylab = "",',
    '       main = "The evidence (left of a line = listed)", cex.main = 0.95)',
    '  for (i in seq_along(LEVELS)) {',
    '    abline(v = 1 - LEVELS[i], col = "#111111", lwd = 1, lty = if (i == 1) 2 else 3)',
    '    # Label each threshold just ABOVE the panel (mtext writes into the margin),',
    '    # so it can never be clipped on a chart holding only one or two tasks.',
    '    mtext(pct(LEVELS[i]), side = 3, at = 1 - LEVELS[i], line = 0.1, cex = 0.6)',
    '  }',
    '  points(pmax(pmin(fp$p_str, 1), 1e-12), yy, pch = 1, col = "#555555", cex = 0.8)',
    '  points(pmax(pmin(fp$p, 1), 1e-12), yy, pch = 19, col = cols_f, cex = 0.9)',
    '  legend("bottomleft", bty = "n", cex = 0.7, pch = c(19, 1), col = c("#111111", "#555555"),',
    '         legend = c("who picked what", "weighted by strength"))',
    '  par(op)',
    '',
    '  # -- INSIGHTS (plain language; rendered by the "Insights gained" section) ----',
    '  cat("\\n\\nINSIGHTS\\n"); cat(strrep("=", 78), "\\n", sep = "")',
    '  note("## The answer")',
    '  for (conf in LEVELS) {',
    '    a <- answer[[as.character(conf)]]',
    '    note(sprintf(paste0("- At **%s confidence**, users prefer **Haiku** on **%d of %d tasks** (%s) and ",',
    '                        "**Opus** on **%d** (%s). The remaining **%d** are not established either way."),',
    '                 pct(conf), nrow(a$haiku), nrow(tasks), ids(a$haiku), nrow(a$opus), ids(a$opus), nrow(a$rest)))',
    '  }',
    '  note(paste0("- **\\"Not established\\" does not mean the two models are equal.** It means these ",',
    '              "responses cannot tell them apart at that confidence. Showing that two models are ",',
    '              "*equivalent* is a different claim needing a different test, which this script ",',
    '              "deliberately does not make."))',
    '  note(sprintf("- The stricter level can only ever call fewer tasks, and it does: %s.",',
    '               paste(vapply(LEVELS, function(c_) sprintf("%d task(s) at %s",',
    '                     nrow(answer[[as.character(c_)]]$haiku) + nrow(answer[[as.character(c_)]]$opus), pct(c_)),',
    '                     character(1)), collapse = ", ")))',
    '  note("")',
    '  note("## How sure is \\"sure\\"?")',
    '  note(sprintf(paste0("- Each task is judged by an **exact sign test** on its own answers: among the students ",',
    '                      "who expressed a preference at all, would a split this lopsided have come up by chance ",',
    '                      "if neither model were really preferred? At %s that chance is under %s for every listed ",',
    '                      "task. Nothing is approximated - the test counts the possibilities rather than assuming ",',
    '                      "a bell curve, which is what matters when a task has 15 answers rather than 500."),',
    '               pct(LEVELS[1]), pct(1 - LEVELS[1])))',
    '  note(paste0("- **Why the direction and not the strength.** Tapping an answer in Answer Arena already ",',
    '              "moves the strength bar to +/-2, so a student who taps and moves on exports a magnitude ",',
    '              "the screen chose (the export records that as `preference_source = card`). The side they ",',
    '              "picked is always their own deliberate act, and one student\'s \\"3\\" is not another\'s, so ",',
    '              "counting sides uses the part of each answer the student really produced.",',
    '              if (n_src > 0) sprintf(" Here **%d of %d** graded responses (%.0f%%) kept the strength the card seeded.",',
    '                                     n_card, n_src, 100 * n_card / n_src) else ""))',
    '  note(sprintf(paste0("- Because the smallest chance the test can produce on **m** expressed preferences is ",',
    '                      "1 in 2^(m-1), a task needs at least **%d** of them before it could reach %s at all, ",',
    '                      "and **%d** before it could reach %s. Tasks below that are listed as such - it is a ",',
    '                      "sample-size fact, not a finding about the models."),',
    '               need[[as.character(LEVELS[1])]], pct(LEVELS[1]),',
    '               need[[as.character(LEVELS[length(LEVELS)])]], pct(LEVELS[length(LEVELS)])))',
    '  a0 <- paste0("at", lv0); s0 <- paste0("str", lv0)',
    '  soft_all <- tasks[tasks[[a0]] != "" & tasks[[a0]] != tasks[[s0]], , drop = FALSE]',
    '  if (nrow(soft_all)) {',
    '    note(sprintf(paste0("- The strength reading disagrees on **%s**: weighing how strongly students felt, the ",',
    '                        "same test does not reach %s there (on some of them the mean points the other way ",',
    '                        "entirely - many mild answers one side, a few emphatic ones the other). Those are the ",',
    '                        "weakest entries on the list, and the `p_str` column is where to look."),',
    '                 ids(soft_all), pct(LEVELS[1])))',
    '  } else {',
    '    note(paste0("- Every listed task is listed on the **strengths** as well as on the split, which is ",',
    '                "the strongest form this answer can take - the count and the conviction agree."))',
    '  }',
    '  str_only_all <- tasks[tasks[[a0]] == "" & tasks[[s0]] != "", , drop = FALSE]',
    '  if (nrow(str_only_all)) {',
    '    note(sprintf(paste0("- The other way round, **%s** would be listed if the strengths were weighed in, but ",',
    '                        "the split of who picked what does not reach %s on its own. They are held back on ",',
    '                        "purpose - a strength can be the interface\'s rather than the student\'s."),',
    '                 ids(str_only_all), pct(LEVELS[1])))',
    '  }',
    '  fdr_calls <- tasks[tasks[[paste0("fdr", lv0)]] != "", , drop = FALSE]',
    '  note(sprintf(paste0("- Asking the same question of %d tasks means about %.1f of them would look decided at ",',
    '                      "%s even if the models were tied everywhere. Judged as a SET rather than one at a time ",',
    '                      "(Benjamini-Hochberg, the q column), **%d task(s)** survive: %s. Use the full list to ",',
    '                      "decide one task; use this shorter one when quoting the whole set as a finding. (Students ",',
    '                      "answer many tasks each, so that share is a good approximation rather than a theorem.)"),',
    '               nrow(tasks), nrow(tasks) * (1 - LEVELS[1]), pct(LEVELS[1]), nrow(fdr_calls), ids(fdr_calls)))',
    '  note("")',
    '  note("## Figure 1 - Every task: how far it leaned, and how sure we are")',
    '  note(sprintf(paste0("- **Left panel** - one bar per task, its **mean graded preference**: left of the line ",',
    '                      "its students leaned to Haiku, right of it to Opus, and the length is how strongly. ",',
    '                      "Blue = Haiku preferred at %s, orange = Opus preferred at %s, grey = not established."),',
    '               pct(LEVELS[1]), pct(LEVELS[1])))',
    '  note(paste0("- **Right panel** - the same tasks, showing **why**. Each filled dot is that task\'s ",',
    '              "exact p, on a log scale, with the two thresholds drawn as vertical lines: **a task is ",',
    '              "listed exactly when its dot sits left of the line**. The hollow dot beside it is the ",',
    '              "same test weighted by how strongly students felt - when the two sit together the count ",',
    '              "and the conviction agree, and when they are far apart the task is worth a second look."))',
    '  note(paste0("- A long grey bar on the left panel with a dot far to the right on the right panel is ",',
    '              "the case worth understanding: those students leaned, on average, but either too few ",',
    '              "answered or they disagreed too much for that lean to be more than chance."))',
    '  for (s in INS) cat(s, "\\n")',
    '  cat("\\nDone.\\n")',
    '}'
  ].join('\n');

  /* ---- bootstrap ---- */
  function init() {
    injectStyles();
    root = el('div', { id: 'aa-root' }, [el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { text: 'Connecting...' })])])]);
    document.body.appendChild(root);
    applyTheme(currentTheme());
    // Back/forward between the Admin and Data-analytics tabs (their URLs differ).
    window.addEventListener('popstate', function () {
      if (!user || !Store.isAdminEmail(user.email)) return;
      var v = viewFromUrl();
      if (v !== currentView) { currentView = v; renderShell(); }
    });
    if (cachedAdmin()) { /* render after config loads */ }
    if (!Store) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'arena-store.js failed to load.' })])])); return; }
    Store.init().then(function () {
      Store.onAuth(function (u) { user = u || null; if (!user && simpTrySso()) return; route(); });
    }).catch(function (e) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
