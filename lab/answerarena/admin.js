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
  var daState = { selected: {}, importedBooks: [], parts: null, sessions: null, sheetMap: null, sheetOrder: [], code: {}, lang: 'python', running: false };
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
      + '.aa-btn{border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;padding:10px 16px;border-radius:10px;cursor:pointer;transition:transform .06s ease,background .15s ease,opacity .15s ease,box-shadow .15s ease;}'
      + '.aa-btn:active{transform:translateY(1px) scale(.97);}'
      + '.aa-btn.is-busy{opacity:.6;cursor:progress;}'
      + '.aa-btn.is-ok{background:#2faa5e !important;color:#fff !important;border-color:#2faa5e !important;box-shadow:0 4px 12px rgba(47,170,94,.35);}'
      + '.aa-btn:hover{background:var(--accentd);}.aa-btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--fieldline);}.aa-btn.sm{padding:7px 11px;font-size:12px;}.aa-btn.danger{background:transparent;color:#e06b5a;border:1px solid #6d3b34;}'
      + '.aa-btn.green{background:#2faa5e;color:#fff;border:none;box-shadow:0 4px 12px rgba(47,170,94,.30);}.aa-btn.green:hover{background:#268a4c;box-shadow:0 7px 18px rgba(47,170,94,.38);}'
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
      + '.aa-runstatus{font-size:13px;color:var(--muted);margin:8px 0;min-height:18px;}';
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
  function route() {
    if (!user) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderLogin(); }
    if (!Store.isAdminEmail(user.email)) { try { localStorage.removeItem('aa-admin'); } catch (e) {} return renderNotAuthorized(); }
    try { localStorage.setItem('aa-admin', '1'); } catch (e) {}
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
      var b = el('button', { class: 'aa-btn sec sm' + (currentView === view ? ' is-nav-on' : ''), on: { click: function () { if (currentView !== view) { currentView = view; renderShell(); } } } }, [label]);
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
    activeCard.appendChild(el('p', { class: 'aa-note', text: 'Every session is created open. Copy its join link to invite participants, export its data, or close it to stop new joins. Create sessions from the left column.' }));
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
    closedCard.appendChild(el('p', { class: 'aa-note', text: 'These no longer accept participants. Export their data to review, reopen them, or delete if no longer needed.' }));
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
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { Store.updateSession(s.id, { status: 'open' }).then(function () { toast('Reopened.'); refresh(); }); } } }, ['Reopen']));
      actions.push(el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Permanently delete session ' + s.code + '? (Participant data is kept.)')) Store.deleteSession(s.id).then(function () { toast('Deleted.'); refresh(); }); } } }, ['Delete']));
    } else {
      actions.push(el('button', { class: 'aa-btn sm', on: { click: function () { window.open(joinUrl, '_blank'); } } }, ['Open']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: function () { copy(joinUrl); } } }, ['Copy link']));
      actions.push(el('button', { class: 'aa-btn green sm', on: { click: exportSession } }, ['Export data']));
      actions.push(el('button', { class: 'aa-btn sec sm', on: { click: editMode } }, ['Edit name']));
      // "Delete" a running session = close it (participants can no longer join).
      actions.push(el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Close session ' + s.code + '? Participants will no longer be able to join.')) Store.updateSession(s.id, { status: 'closed' }).then(function () { toast('Closed.'); refresh(); }); } } }, ['Close']));
    }
    box.appendChild(el('div', { class: 'aa-row', style: 'margin-top:8px;' }, actions));
    // Download only the data for the users who played THIS session.
    function exportSession() {
      Store.listParticipants().then(function (all) {
        var parts = all.filter(function (p) { return p.sessionId === s.id || (p.playedSessions && p.playedSessions[s.id]) || (p.completedSessions && p.completedSessions[s.id]); });
        if (!parts.length) { toast('No participants in this session yet.'); return; }
        exportExcel(parts, { sessionId: s.id, sessionCode: s.code });
      }).catch(function (e) { toast('Export failed: ' + ((e && e.code) || 'error')); });
    }
    function editMode() {
      box.innerHTML = '';
      var ename = el('input', { type: 'text', value: s.name || '' });
      box.appendChild(el('div', { class: 'aa-field' }, [el('label', { text: 'Name (' + s.code + ')' }), ename]));
      box.appendChild(el('div', { class: 'aa-row' }, [
        el('button', { class: 'aa-btn sm', on: { click: function () { Store.updateSession(s.id, { name: ename.value.trim() }).then(function () { toast('Saved.'); refresh(); }); } } }, ['Save']),
        el('button', { class: 'aa-btn sec sm', on: { click: refresh } }, ['Cancel'])
      ]));
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
    card.appendChild(el('div', { class: 'aa-row' }, [btn]));
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
  function buildUsersCard() {
    var card = el('div', { class: 'aa-card' });
    var all = [];
    card.appendChild(el('div', { class: 'aa-h', style: 'margin-bottom:8px;' }, [el('h3', { text: 'Registered users' }), el('button', { class: 'aa-btn green sm', on: { click: function () { if (all.length) exportExcel(all); else toast('No users yet.'); } } }, ['Export to Excel'])]));
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
      listWrap.innerHTML = '';
      listWrap.appendChild(el('p', { class: 'aa-note', text: rows.length + ' of ' + all.length + ' user' + (all.length === 1 ? '' : 's') }));
      rows.forEach(function (p) {
        var c = p.condition || {};
        listWrap.appendChild(el('div', { class: 'aa-q' }, [
          el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;' }, [
            el('div', { style: 'min-width:0;' }, [
              el('b', { text: p.participantId || '(no participant ID)' }),
              el('div', { class: 'aa-note', style: 'margin-top:2px;', text: p.email || '(no e-mail)' })
            ]),
            el('span', { class: 'aa-note', text: p.status || '' })
          ]),
          el('div', { class: 'aa-note', style: 'margin-top:4px;', text: 'registered ' + fmtTs(p.createdAt) + '  ·  ' + Object.keys(p.completedSessions || {}).length + ' session(s) completed' + (c.enabled ? '  ·  cell ' + c.transparency + '/' + c.incentive : '') }),
          el('div', { class: 'aa-row', style: 'margin-top:6px;' }, [
            el('button', { class: 'aa-btn danger sm', on: { click: function () { if (window.confirm('Delete "' + (p.email || p._id) + '" and all their data?')) Store.deleteParticipant(p._id).then(function () { toast('Deleted.'); load(); }); } } }, ['Delete'])
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
        Store.listSessions().catch(function () { return []; })
      ]).then(function (pre) {
        var activeSet = pre[0] || { tasks: [] };
        var sessions = pre[1] || [];
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
        function aggOf(id) { return agg[id] || (agg[id] = { n: 0, baseline: 0, frontier: 0, tie: 0, prefSum: 0, prefN: 0, msSum: 0, msN: 0 }); }
        var chain = Promise.resolve();
        parts.forEach(function (p) {
          var uid = p._id, c = p.condition || {};
          var completed = Object.keys(p.completedSessions || {});
          var base = {
            participant_id: p.participantId || '', account_id: uid, email: p.email || '',
            status: p.status || '', current_session_id: p.sessionId || '',
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
    add('Participants', 'status', 'Where the participant is in the flow: registered, playing, survey, or done.');
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
    add('Task summary', 'mean_response_ms', 'Mean decision time (milliseconds) for this task.');
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
    add('Responses', 'response_ms', 'Time in milliseconds from seeing the pair to pressing Next.');
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

  function renderAnalytics() {
    clearRoot();
    var wrap = el('div', { class: 'aa-wrap aa-wrap2' });
    wrap.appendChild(headerRow());
    wrap.appendChild(el('div', { class: 'aa-card' }, [
      el('h3', { text: 'Data analytics' }),
      el('p', { class: 'aa-note', html: 'Load your session data (or import an already-exported Excel), consolidate it into a single workbook, then run Python or R on it — compiled entirely in your browser (nothing is uploaded). Three steps:' })
    ]));
    daRefs = {};   // this render's sections register their live refreshers here
    wrap.appendChild(buildDaSection1());
    wrap.appendChild(buildDaSection2());
    wrap.appendChild(buildDaSection3());
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
        books.forEach(function (b) { mergeBookIntoSheetMap(sheetMap, b); });
        daState.sheetMap = sheetMap;
        daState.sheetOrder = orderSheetNames(sheetMap);
        status.textContent = 'Loaded ' + summarizeMap(sheetMap) + '.';
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
    card.appendChild(el('p', { class: 'aa-note', html: 'Consolidate every loaded session (and any imported workbook) into <b>one Excel file</b> with the same multi-tab structure as the per-session export — Conventions, Sessions, Participants, Tasks, Task summary, Responses, Events, Survey — with each source stacked within every tab.' }));
    var stats = el('div', { class: 'aa-statgrid', style: 'margin-top:6px;' });
    card.appendChild(stats);
    var dl = el('button', { class: 'aa-btn green', on: { click: download } }, ['Download aggregate Excel']);
    card.appendChild(el('div', { class: 'aa-row', style: 'margin-top:12px;' }, [dl]));
    var hint = el('p', { class: 'aa-note', text: 'Load data in Section 1 first.' });
    card.appendChild(hint);
    daRefs.updateSec2 = update;
    update();
    function statBox(v, l) { return el('div', { class: 'aa-statbox' }, [el('b', { text: String(v) }), el('span', { text: l })]); }
    function update() {
      var m = daState.sheetMap;
      stats.innerHTML = '';
      if (!m) { dl.setAttribute('disabled', 'true'); hint.style.display = 'block'; return; }
      hint.style.display = 'none'; dl.removeAttribute('disabled');
      stats.appendChild(statBox((m.Responses || []).length, 'Responses'));
      stats.appendChild(statBox((m.Participants || []).length, 'Participants'));
      stats.appendChild(statBox((m.Sessions || []).length, 'Sessions'));
      stats.appendChild(statBox((m['Task summary'] || []).length, 'Tasks with data'));
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
    card.appendChild(el('p', { class: 'aa-note', html: 'Pick a table from the aggregate above, then run <b>Python</b> (Pyodide: numpy / pandas / scipy / statsmodels / matplotlib) or <b>R</b> (WebR, base R) on it — compiled entirely in your browser (the first run downloads the runtime, ~10–30&nbsp;s). The table is handed to your code as the string <code>DATA_CSV</code> (Python) or the file <code>/tmp/data.csv</code> (R). Output and plots appear below.' }));

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

    // Restore persisted code (or the bundled templates) once.
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
        imgs.forEach(function (src) { plots.appendChild(el('img', { src: src, alt: 'plot' })); });
        setStatus(imgs.length ? (imgs.length + ' plot' + (imgs.length === 1 ? '' : 's') + ' rendered.') : (result && result.ok ? 'Done.' : ''));
      }).catch(function (err) {
        if (outPre) outPre.textContent = (outText ? outText + '\n' : '') + '⚠ ' + ((err && err.message) || err);
        setStatus('');
      }).then(function () {
        running = false; daState.running = false; runBtn.removeAttribute('disabled'); resetBtn.removeAttribute('disabled');
      });
    }
    return card;
  }

  /* =====================================================================
     In-browser runtimes: Pyodide (Python) + WebR (R).
     Ported from the ideasearchlab Data Analytics page. Each loads lazily
     from jsDelivr on first Run and is then reused across runs.
     ===================================================================== */
  var DA_PYODIDE_VERSIONS = ['314.0.1', '0.29.4', '0.28.3'];
  var DA_PY_PACKAGES = ['numpy', 'pandas', 'scipy', 'statsmodels', 'matplotlib'];
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
          if (onStatus) onStatus('Loading data-science packages (pandas, statsmodels, matplotlib)…');
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
      await pyodide.loadPackage('micropip');
      var micropip = pyodide.pyimport('micropip');
      for (var j = 0; j < fallback.length; j++) await micropip.install(fallback[j]);
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
    'Answer Arena - Python analysis (edit freely, then Run).',
    '',
    'The table picked in Section 3 is handed in as the string DATA_CSV (one row per',
    'record). For the Responses table the useful columns are: session_code, task_id,',
    'choice (left/right/tie), chosen_model (baseline/frontier/tie), preference_AB',
    '(-3..+3, A=left/B=right), preference_model (-3..+3; <0 baseline, >0 frontier),',
    'response_ms, cost_transparency (1/0), firm_pay (1/0), submitted. Change anything.',
    '"""',
    'import io',
    'import numpy as np',
    'import pandas as pd',
    'import matplotlib',
    'matplotlib.use("Agg")',
    'import matplotlib.pyplot as plt',
    '',
    '# keep_default_na=False so the literal strings "None"/"" are not read as NaN.',
    'df = pd.read_csv(io.StringIO(DATA_CSV), keep_default_na=False)',
    'print("Rows:", len(df), " Columns:", list(df.columns))',
    'print(df.head(8).to_string(), "\\n")',
    '',
    '# Keep only submitted comparisons when that column exists (drafts excluded).',
    'if "submitted" in df.columns:',
    '    d = df[df["submitted"].astype(str).str.lower().eq("yes")].copy()',
    'else:',
    '    d = df.copy()',
    'print("Analysed rows:", len(d))',
    '',
    '# Overall preference for the frontier model.',
    'if "preference_model" in d.columns:',
    '    pm = pd.to_numeric(d["preference_model"], errors="coerce").dropna()',
    '    if len(pm):',
    '        print("\\npreference_model (-3 baseline .. +3 frontier):")',
    '        print("  n = %d   mean = %.3f   sd = %.3f" % (len(pm), pm.mean(), pm.std(ddof=1)))',
    'if "chosen_model" in d.columns:',
    '    cm = d["chosen_model"].astype(str)',
    '    decisive = int(cm.isin(["baseline", "frontier"]).sum())',
    '    if decisive:',
    '        wr = cm.eq("frontier").sum() / decisive',
    '        print("Frontier win rate (decisive choices only): %.1f%%  (ties: %d)" % (100 * wr, int(cm.eq("tie").sum())))',
    '',
    '# Mean preference by each 2x2 factor (collect for the plot).',
    'labels, means = [], []',
    'for factor in ["cost_transparency", "firm_pay"]:',
    '    if factor in d.columns and "preference_model" in d.columns:',
    '        g = pd.DataFrame({"pm": pd.to_numeric(d["preference_model"], errors="coerce"),',
    '                          "f": pd.to_numeric(d[factor], errors="coerce")}).dropna()',
    '        if len(g):',
    '            print("\\nMean preference_model by %s:" % factor)',
    '            for lvl, grp in g.groupby("f"):',
    '                print("  %s = %g : n=%d  mean=%.3f" % (factor, lvl, len(grp), grp["pm"].mean()))',
    '                labels.append("%s=%g" % (factor, lvl)); means.append(grp["pm"].mean())',
    '',
    '# OLS with HC3 heteroscedasticity-robust SEs (statsmodels).',
    'try:',
    '    import statsmodels.formula.api as smf',
    '    cols = [c for c in ["cost_transparency", "firm_pay"] if c in d.columns]',
    '    if "preference_model" in d.columns and cols:',
    '        reg = pd.DataFrame({"y": pd.to_numeric(d["preference_model"], errors="coerce")})',
    '        for c in cols:',
    '            reg[c] = pd.to_numeric(d[c], errors="coerce")',
    '        reg = reg.dropna()',
    '        cols = [c for c in cols if reg[c].nunique() > 1]',
    '        if len(reg) > len(cols) + 1 and cols:',
    '            model = smf.ols("y ~ " + " + ".join(cols), data=reg).fit(cov_type="HC3")',
    '            print("\\nOLS: preference_model ~ " + " + ".join(cols) + "  (HC3 robust SEs)")',
    '            print(model.summary())',
    '        else:',
    '            print("\\n(Not enough variation for a regression - need >=2 conditions that vary.)")',
    'except Exception as e:',
    '    print("\\n(Regression skipped:", e, ")")',
    '',
    '# Bar plot of the condition means.',
    'if means:',
    '    fig, ax = plt.subplots(figsize=(7, 4.2))',
    '    ax.bar(range(len(means)), means, color="#e67e22")',
    '    ax.set_xticks(range(len(means))); ax.set_xticklabels(labels, rotation=20, ha="right", fontsize=11)',
    '    ax.axhline(0, color="#888", lw=1)',
    '    ax.set_ylabel("mean preference_model", fontsize=12)',
    '    ax.set_title("Frontier preference by condition (>0 favours frontier)", fontsize=13)',
    '    for i, v in enumerate(means):',
    '        ax.text(i, v, "%.2f" % v, ha="center", va="bottom" if v >= 0 else "top", fontsize=11)',
    '    fig.tight_layout()',
    'print("\\nDone.")',
    ''
  ].join('\n');

  var DA_R_TEMPLATE = [
    '# Answer Arena - R analysis (edit freely, then Run).',
    '# The picked table is mounted at /tmp/data.csv. For the Responses table the key',
    '# columns are session_code, task_id, choice, chosen_model (baseline/frontier/tie),',
    '# preference_model (-3..+3; <0 baseline, >0 frontier), response_ms,',
    '# cost_transparency (1/0), firm_pay (1/0), submitted.',
    '',
    'df <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE, check.names = FALSE)',
    'cat("Rows:", nrow(df), " Columns:", paste(names(df), collapse = ", "), "\\n\\n")',
    'print(utils::head(df, 8))',
    '',
    'num <- function(x) suppressWarnings(as.numeric(as.character(x)))',
    '',
    '# Keep submitted comparisons only, when that column exists.',
    'if ("submitted" %in% names(df)) {',
    '  d <- df[tolower(as.character(df$submitted)) == "yes", , drop = FALSE]',
    '} else { d <- df }',
    'cat("\\nAnalysed rows:", nrow(d), "\\n")',
    '',
    '# Overall frontier preference.',
    'if ("preference_model" %in% names(d)) {',
    '  pm <- num(d$preference_model); pm <- pm[!is.na(pm)]',
    '  if (length(pm)) cat(sprintf("\\npreference_model: n=%d  mean=%.3f  sd=%.3f\\n", length(pm), mean(pm), sd(pm)))',
    '}',
    'if ("chosen_model" %in% names(d)) {',
    '  cm <- as.character(d$chosen_model); decisive <- sum(cm %in% c("baseline", "frontier"))',
    '  if (decisive > 0) cat(sprintf("Frontier win rate (decisive): %.1f%%  (ties: %d)\\n", 100 * sum(cm == "frontier") / decisive, sum(cm == "tie")))',
    '}',
    '',
    '# Mean preference by each 2x2 factor + a bar plot.',
    'labels <- c(); means <- c()',
    'for (fac in c("cost_transparency", "firm_pay")) {',
    '  if (fac %in% names(d) && "preference_model" %in% names(d)) {',
    '    y <- num(d$preference_model); f <- num(d[[fac]]); ok <- !is.na(y) & !is.na(f)',
    '    if (any(ok)) {',
    '      cat(sprintf("\\nMean preference_model by %s:\\n", fac))',
    '      for (lvl in sort(unique(f[ok]))) {',
    '        m <- mean(y[ok & f == lvl])',
    '        cat(sprintf("  %s=%g : n=%d  mean=%.3f\\n", fac, lvl, sum(ok & f == lvl), m))',
    '        labels <- c(labels, sprintf("%s=%g", fac, lvl)); means <- c(means, m)',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    '# OLS with HC3 robust SEs (base R; WebR has no sandwich package).',
    'hc3 <- function(fit) {',
    '  X <- model.matrix(fit); h <- hatvalues(fit); u <- residuals(fit)',
    '  bread <- solve(t(X) %*% X)',
    '  meat <- t(X) %*% (X * ((u^2) / (1 - h)^2))',
    '  V <- bread %*% meat %*% bread; se <- sqrt(diag(V)); est <- coef(fit); tval <- est / se',
    '  data.frame(estimate = est, HC3_se = se, t = tval, p = 2 * pt(-abs(tval), df.residual(fit)))',
    '}',
    'cols <- intersect(c("cost_transparency", "firm_pay"), names(d))',
    'if ("preference_model" %in% names(d) && length(cols)) {',
    '  reg <- data.frame(y = num(d$preference_model))',
    '  for (cn in cols) reg[[cn]] <- num(d[[cn]])',
    '  reg <- reg[stats::complete.cases(reg), , drop = FALSE]',
    '  cols <- cols[sapply(cols, function(cn) length(unique(reg[[cn]])) > 1)]',
    '  if (nrow(reg) > length(cols) + 1 && length(cols)) {',
    '    tryCatch({',
    '      fit <- lm(as.formula(paste("y ~", paste(cols, collapse = " + "))), data = reg)',
    '      cat("\\nOLS: preference_model ~", paste(cols, collapse = " + "), " (HC3 robust SEs)\\n")',
    '      print(round(hc3(fit), 4))',
    '    }, error = function(e) cat("\\n(Regression skipped:", conditionMessage(e), ")\\n"))',
    '  } else { cat("\\n(Not enough variation for a regression.)\\n") }',
    '}',
    '',
    'if (length(means)) {',
    '  bp <- barplot(means, names.arg = labels, col = "#e67e22", las = 2, ylab = "mean preference_model",',
    '                main = "Frontier preference by condition (>0 favours frontier)")',
    '  abline(h = 0, col = "#888")',
    '  text(bp, means, labels = sprintf("%.2f", means), pos = 3, cex = 0.9)',
    '}',
    'cat("\\nDone.\\n")',
    ''
  ].join('\n');

  /* ---- bootstrap ---- */
  function init() {
    injectStyles();
    root = el('div', { id: 'aa-root' }, [el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { text: 'Connecting...' })])])]);
    document.body.appendChild(root);
    applyTheme(currentTheme());
    if (cachedAdmin()) { /* render after config loads */ }
    if (!Store) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'arena-store.js failed to load.' })])])); return; }
    Store.init().then(function () {
      Store.onAuth(function (u) { user = u || null; route(); });
    }).catch(function (e) { clearRoot(); root.appendChild(el('div', { class: 'aa-wrap' }, [el('div', { class: 'aa-card' }, [el('p', { class: 'aa-err', text: 'Could not connect: ' + ((e && e.message) || 'error') })])])); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
