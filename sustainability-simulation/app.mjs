import { itemName, productionRecipe, inventoryStatementValues, INVESTMENTS, FEATURES } from './src/engine.mjs?v=5366cc14c565';
import { firebaseConfig, classroomBackend } from './firebase-config.mjs?v=5366cc14c565';
import { watchSession } from './src/session-updates.mjs?v=5366cc14c565';
const root = document.querySelector('#app'), dialog = document.querySelector('#dialog');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format((n || 0) / 100);
const exactMoney = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format((n || 0) / 100);
const number = n => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n || 0);
const precise = n => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(n || 0);
const total = (list, key) => list.reduce((sum, x) => sum + (x[key] || 0), 0);
const icon = (name, graphic) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${graphic || ({ overview: '<path d="M3 10 12 3l9 7v11h-7v-7h-4v7H3Z"/>', orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>', supply: '<path d="m3 7 9-4 9 4v11l-9 4-9-4ZM3 7l9 5 9-5M12 12v10"/>', production: '<path d="M3 21V10l6 4V8l6 5V3h5v18ZM7 18h1m4 0h1m4 0h1"/>', finance: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 5h6"/>', energy: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>', reports: '<path d="M4 20V12h4v8m4 0V4h4v16m4 0v-9M2 21h20"/>', messages: '<path d="M4 4h16v12H9l-5 5Z"/><path d="M8 8h8m-8 4h5"/>', admin: '<circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 3-1 1 5-3 2 1 3 1 2-4 4-3-2-3 1-2 1-4-4 2-3-1-3-1-2 4-4Z"/>' })[name] || '<path d="M12 3v18M3 12h18"/>'}</svg>`;
const brand = `<div class="brand"><span class="brand-mark">s</span><span>Sustainability<small>Studio</small></span></div>`;
const localWorkspace = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const savedBackend = localStorage.getItem('studio-backend') || '';
// Old loopback testing preferences must not strand returning public-site users.
let backend = localWorkspace ? savedBackend : (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(savedBackend) ? classroomBackend : savedBackend || classroomBackend), token = sessionStorage.getItem('studio-token') || '';
let state, actor, user, sessions = [], sessionId, preview, page = 'overview', channel = 'announcements', report = 'profit', reportRange = 30, selectedCompanies = new Set(), solo = null, health = null, roster = null, busy = false, online = true, firebaseClient = null;
let testRoom = null, testPending = null;
let liveSession = null;
function stopSessionUpdates() { liveSession?.watch.stop(); liveSession = null; }
function clearClosedSession() {
  stopSessionUpdates(); ++loadSequence;
  state = null; actor = null; sessionId = null; roster = null;
  if (dialog.open) dialog.close();
  renderLobby('This session is closed or no longer available. Further decisions are blocked.');
}
function ensureSessionUpdates() {
  if (testRoom || solo || !sessionId || !state || !health?.sessionUpdates) { stopSessionUpdates(); return; }
  if (liveSession?.id === sessionId) return;
  stopSessionUpdates();
  const id = sessionId;
  const current = () => liveSession?.id === id && sessionId === id && !testRoom && !solo;
  const watch = watchSession({
    url: `${backend}/api/sessions/${encodeURIComponent(id)}/updates`, revision: state.revision,
    token: () => firebaseClient.token(),
    changed: () => { if (current()) void load(false); },
    closed: () => { if (current()) clearClosedSession(); }
  });
  liveSession = { id, watch };
}
const submittingForms = new Set();
let loadSequence = 0, pendingLoads = 0;
const isTeacher = () => actor?.role === 'instructor';
const company = () => state?.company;
const simDate = hour => { const date = new Date(Date.parse(state?.startDate || '2026-01-01T00:00:00Z') + hour * 3600000); return date.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); };
const field = (name, label, value, type = 'number', extra = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
const check = (name, label, on, disabled = false) => `<label class="check"><input name="${esc(name)}" type="checkbox" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</label>`;
const select = (name, label, options, value) => `<label>${esc(label)}<select name="${esc(name)}">${options.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const button = (action, text, id = '', cls = '', disabled = false) => `<button class="${cls}" data-action="${action}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${text}</button>`;
const table = (headers, rows, empty = 'Nothing here yet.') => rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="empty">${empty}</p>`;
const panel = (title, subtitle, body, action = '') => `<section class="panel">${title || subtitle || action ? `<div class="panel-head"><div>${title ? `<h2>${title}</h2>` : ''}${subtitle ? `<p>${subtitle}</p>` : ''}</div>${action}</div>` : ''}${body}</section>`;
const metric = (label, value, hint, name) => `<article class="metric"><div class="metric-label">${label}${icon(name)}</div><div class="metric-value">${value}</div><small>${hint}</small></article>`;
const permitted = feature => !isTeacher() && state.status !== 'completed' && state.features[feature]?.allowed;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; clearTimeout(toast.timeout); toast.timeout = setTimeout(() => { el.textContent = ''; }, 9000); }
function reportFormError(form, error) {
  const target = form.querySelector('.error');
  if (form.isConnected && target) { target.textContent = error.message; target.tabIndex = -1; target.focus(); }
  else toast(error.message);
}
async function api(path, body) {
  if (testRoom) {
    const url = new URL(path, 'https://test.invalid');
    if (url.pathname === '/sessions/' + sessionId) return testRoom.call('view',{preview:url.searchParams.get('company')});
    if (url.pathname === '/sessions/' + sessionId + '/command') return testRoom.call('command',body);
    throw new Error('This action is unavailable in a temporary test round.');
  }
  if (firebaseClient?.user && health?.auth === 'firebase' && path !== '/health') token = await firebaseClient.token();
  let response;
  try { response = await fetch(`${backend}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token && path !== '/health' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Cannot reach the classroom server. Check its address and that it is running. For a local server, open its local URL directly; this browser may restrict connections from public websites to your computer.'); }
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status }); return result;
}
async function connectBackend(input) {
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use an HTTPS server origin, or HTTP on localhost, without credentials, a path, or query parameters.');
  const previous = backend; backend = url.origin;
  try {
    const result = await api('/health');
    if (result.ok !== true || (result.auth === 'firebase' && result.projectId !== firebaseConfig.projectId)) throw new Error('This is not a compatible Sustainability Studio server.');
    health = result; localStorage.setItem('studio-backend', backend); token = ''; sessionStorage.removeItem('studio-token');
  } catch (e) { backend = previous; throw e; }
  if (firebaseClient?.user && health.auth === 'firebase') await enterFirebase(); else renderWelcome();
}
async function load(force = true, afterCommand = false) {
  if (solo) { ({ state, actor } = solo.view(preview)); if (force) render(); return; }
  if (!sessionId) return;
  const loadingSession = sessionId, loadingPreview = preview, sequence = ++loadSequence;
  pendingLoads++;
  try {
    const data = await api(`/sessions/${sessionId}${preview ? `?company=${encodeURIComponent(preview)}` : ''}`);
    if (sessionId !== loadingSession || preview !== loadingPreview || sequence !== loadSequence || solo) return;
    const changed = !state || data.state.revision !== state.revision || !online;
    // Keep the version that the student actually reviewed while editing a decision.
    if (!force && !afterCommand && (submittingForms.size || dialog.open || document.activeElement?.closest('form'))) { online = true; return; }
    state = data.state; actor = data.actor; online = true; ensureSessionUpdates();
    if ((force || changed) && !dialog.open && (force || (!submittingForms.size && !document.activeElement?.closest('form')))) render();
  } catch (e) {
    if (sessionId !== loadingSession || preview !== loadingPreview || sequence !== loadSequence || solo) return;
    if (testRoom && e.status === 410) { endTestView(); return; }
    if (!testRoom && [403, 404].includes(e.status)) { clearClosedSession(); return; }
    online = false; if (force) throw e; const status = document.querySelector('#connection'); if (status) status.textContent = 'Connection interrupted · reconnecting'; } finally { pendingLoads--; }
}
async function command(cmd) {
  if (busy) throw new Error('Another decision is still being submitted. Please wait and try again.'); busy = true;
  const storageKey = `studio-pending:${backend}:${actor.id}:${sessionId}`;
  let request;
  try {
    if (testRoom) {
      if (testPending && JSON.stringify(testPending.command) !== JSON.stringify(cmd)) throw new Error('Retry the previous test decision before submitting another.');
      testPending ||= {key:crypto.randomUUID(),revision:state.revision,command:cmd};
      try { const response = await testRoom.call('command',testPending); testPending = null; toast(response.message); await load(false,true); return true; }
      catch(e) { if(e.status >= 400 && e.status < 500) testPending = null; if(e.status === 409) await load(false,true); throw e; }
    }
    if (!solo) {
      request = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (request && JSON.stringify(request.command) !== JSON.stringify(cmd)) throw new Error('An earlier decision has an unknown response. Retry that same decision before starting another.');
      request ||= { key: crypto.randomUUID(), revision: state.revision, command: cmd };
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    }
    const response = solo ? solo.command(cmd) : await api(`/sessions/${sessionId}/command`, request);
    sessionStorage.removeItem(storageKey);
    toast(response.message); await load(false, true); return true;
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) sessionStorage.removeItem(storageKey);
    if (e.status === 409) await load(false, true);
    if (request && sessionStorage.getItem(storageKey) && !dialog.open && !submittingForms.size) render();
    throw e;
  } finally { busy = false; }
}
async function signIn(result) {
  token = result.token; user = result.user; sessionStorage.setItem('studio-token', token); await enter();
}
function sessionLink(id) { const url = new URL(location.href); url.searchParams.delete('session'); if (id) url.searchParams.set('session', id); url.hash = ''; return url.href; }
function selectSession(id) { history.replaceState(null, '', sessionLink(id)); sessionId = id || null; }
// Only navigation preferences are kept, scoped to this tab, account and classroom.
// Simulation data and authorization always come from the server after refresh.
function workspaceViewKey() {
  if (solo || !user?.id || !sessionId) return null;
  if (!testRoom && user.role === 'instructor') return 'studio-view:' + JSON.stringify([backend, user.id, sessionId]);
  return 'studio-workspace:' + JSON.stringify([testRoom ? 'test' : backend, user.role, user.id, sessionId]);
}
function restoreWorkspaceView() {
  const key = workspaceViewKey();
  if (!key) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!saved || saved.version !== 1) return;
    if ((Object.hasOwn(pages, saved.page) && (saved.page !== 'admin' || user.role === 'instructor')) ||
        (saved.page === 'workspace' && user.role === 'student')) page = saved.page;
    if (Array.isArray(saved.openPanels)) {
      openPanels.clear();
      for (const id of saved.openPanels) if (Object.hasOwn(studentPanels, id)) openPanels.add(id);
    }
    if (Array.isArray(saved.inventoryCategories)) {
      inventoryCategories.clear();
      for (const id of saved.inventoryCategories) if (['finished', 'component'].includes(id)) inventoryCategories.add(id);
    }
    if (user.role === 'instructor' && typeof saved.preview === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(saved.preview)) preview = saved.preview;
    if (typeof saved.channel === 'string') channel = saved.channel;
    if (Object.hasOwn(reportTypes, saved.report)) report = saved.report;
    if ([7, 30, 180].includes(saved.reportRange)) reportRange = saved.reportRange;
    if (Array.isArray(saved.selectedCompanies)) selectedCompanies = new Set(saved.selectedCompanies.filter(id => typeof id === 'string'));
  } catch { /* A blocked or malformed storage entry must not prevent sign-in. */ }
}
function rememberWorkspaceView() {
  const key = workspaceViewKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ version: 1, page, preview: preview || null,
      channel, report, reportRange, selectedCompanies: [...selectedCompanies],
      openPanels: [...openPanels], inventoryCategories: [...inventoryCategories] }));
  } catch { /* Navigation still works when browser storage is unavailable. */ }
}
async function enter() {
  sessionId = null; state = null; actor = null; root.innerHTML = '<main class="welcome"><p role="status">Loading your classroom…</p></main>';
  const me = await api('/me'); user = me.user; sessions = me.sessions;
  const requested = new URL(location.href).searchParams.get('session')?.trim().toLowerCase();
  state = null; actor = null; preview = undefined; roster = null;
  if (!requested) { sessionId = null; if (user.role === 'instructor') { page = 'sessions'; renderAdminHome(); } else renderLobby(); return; }
  if (!/^[A-Za-z0-9-]{1,100}$/.test(requested)) { renderLobby('Enter a valid session ID.', requested); return; }
  selectSession(requested);
  if (user.role !== 'instructor') {
    try { const entry = await api('/enter', { sessionId: requested }); if (entry.requiresCompanyCode) { renderLobby('', requested, true); return; } }
    catch (error) { sessionId = null; renderLobby(error.message, requested); return; }
  }
  try {
    page = user.role === 'instructor' ? 'admin' : 'overview';
    channel = 'announcements'; report = 'profit'; reportRange = 30; selectedCompanies.clear();
    openPanels.clear(); inventoryCategories.clear(); inventoryCategories.add('finished'); inventoryCategories.add('component');
    restoreWorkspaceView();
    await load();
  }
  catch (error) { sessionId = null; state = null; renderLobby(error.message, requested); }
}
function renderLocalWelcome() {
  const currentYear = new Date().getFullYear();
  const footerYear = currentYear > 2026 ? '2026–' + currentYear : '2026';
  root.innerHTML = `<main class="welcome studio-landing" id="content"><header class="welcome-nav">${brand}</header><div class="welcome-layout"><section class="studio-intro" aria-labelledby="studio-title"><p class="eyebrow">A living business classroom</p><h1 id="studio-title">Good business.<br><span>A better footprint.</span></h1><p class="lead">Run a solar company and see how your decisions shape cash, customer service and carbon emissions.</p><div class="studio-solar" aria-hidden="true"></div></section><section class="panel studio-access"><p class="eyebrow">Classroom workspace</p><h2>${health ? 'Join your simulation' : 'Connect your classroom'}</h2>${health?.demo ? `<p class="form-note">Local demonstration · independent roles, one shared simulation.</p><div class="demo-choices">${button('demo', 'Open instructor workspace', 'demo-instructor', 'primary')}${[1, 2, 3].map(i => button('demo', `Student · ${['Helio', 'Northstar', 'Verdant'][i - 1]}`, `demo-student-${i}`)).join('')}</div><hr>` : ''}${health ? `<form id="login-form">${field('username', 'Username', '', 'text', 'autocomplete="username"')}${field('password', 'Password', '', 'password', 'autocomplete="current-password"')}${button('submit', 'Sign in', '', 'primary')}<div class="error" role="alert"></div></form><details><summary>New student? Join with a company code</summary><form id="register-form">${field('name', 'Display name', '', 'text', 'maxlength="80"')}${field('username', 'Username', '', 'text', 'autocomplete="username"')}${field('password', 'Password (at least 10 characters)', '', 'password', 'minlength="10" autocomplete="new-password"')}${field('code', 'Company join code', '', 'text')}${button('submit', 'Create student account', '', 'primary')}<div class="error" role="alert"></div></form></details>` : `<p class="muted">To play with a class, connect the address of a running Sustainability Studio server.</p><p class="form-note">For local shared play, run <code>npm run demo</code> in the project and open <a href="http://127.0.0.1:3000">the local workspace</a>.</p>`}<details ${health ? '' : 'open'}><summary>Server connection</summary><form id="backend-form">${field('backend', 'Server URL', backend || location.origin, 'url', 'placeholder="https://your-classroom.example"')}${button('submit', 'Connect server')}<div class="error" role="alert"></div></form></details></section></div><footer class="welcome-foot"><span><a href="https://www.stouras.com/">Konstantinos Stouras</a> · ${footerYear}</span></footer></main>`;
}
function firebaseForm() {
  return `<h2>Sign in to your studio</h2>
    <p class="studio-access-note">Enter your instructor’s session ID after you sign in.</p>
    <form id="firebase-login-form">
      ${field('email', 'Email', '', 'email', 'autocomplete="username"')}
      ${field('password', 'Password', '', 'password', 'autocomplete="current-password"')}
      ${button('submit', 'Sign in', '', 'primary studio-signin')}
      <div class="error" role="alert"></div>
    </form>
    <div class="studio-divider">or</div>
    ${button('google-signin', '<img src="google-g.png" width="18" height="18" alt="">Continue with Google', '', 'studio-google')}
    <div class="studio-account-options">
      <details><summary>Create an account</summary>
        <form id="firebase-register-form">
          ${field('name', 'Display name', '', 'text', 'maxlength="80" autocomplete="name"')}
          ${field('email', 'Email', '', 'email', 'autocomplete="username"')}
          ${field('password', 'Password (10 characters minimum)', '', 'password', 'minlength="10" autocomplete="new-password"')}
          ${button('submit', 'Create account', '', 'primary studio-signin')}
          <div class="error" role="alert"></div>
        </form>
      </details>
      ${button('reset-password', 'Forgot your password?', '', 'studio-reset')}
    </div>`;
}
function renderWelcome() {
  stopSessionUpdates();
  renderLocalWelcome();
  if (!health || health.auth === 'firebase') {
    const panel = root.querySelector('.welcome-layout > .panel');
    panel.innerHTML = firebaseForm();
  }
}
async function getFirebase() {
  if (!firebaseClient) firebaseClient = (await import('./src/firebase-client.mjs?v=5366cc14c565')).firebase;
  return firebaseClient;
}
async function enterFirebase() {
  const auth = await getFirebase(); token = await auth.token();
  if (!auth.user) return renderWelcome();
  if (!auth.user.emailVerified) {
    root.innerHTML = `<main class="welcome" id="content">${brand}<h1>Check your inbox.</h1><p>Verify your email to join your classroom. Then return here and continue.</p>${button('firebase-refresh', 'I’ve verified my email', '', 'primary')} ${button('firebase-verify', 'Resend verification')} ${button('logout', 'Sign out')}<p class="form-note">Google sign-in verifies supported accounts automatically.</p></main>`;
    return;
  }
  if (health?.auth === 'firebase') return enter();
  user = { name: auth.user.displayName || 'Student', role: 'student' };
  root.innerHTML = `<main class="welcome" id="content">${brand}<h1>Welcome, ${esc(user.name.split(' ')[0])}.</h1><p>You are signed in securely with Firebase. Your classroom server connects you to your instructor’s shared session.</p><section class="panel"><h2>Connect your classroom</h2><form id="backend-form">${field('backend', 'Classroom server URL', backend || 'http://127.0.0.1:3000', 'url')}${button('submit', 'Connect server', '', 'primary')}<div class="error" role="alert"></div></form></section><div class="toolbar">${button('logout', 'Sign out')}</div></main>`;
  if (localStorage.getItem('studio-backend')) root.querySelector('main').insertAdjacentHTML('beforeend', button('forget-server', 'Reset server connection', '', 'small'));
}
async function lifecycleRequest(id, type) {
  const storageKey = 'studio-lifecycle:' + backend + ':' + user.id + ':' + id + ':' + type;
  let request = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (!request) { const current = await api('/sessions/' + encodeURIComponent(id)); request = {key:crypto.randomUUID(),revision:current.state.revision,command:{type}}; sessionStorage.setItem(storageKey,JSON.stringify(request)); }
  try { const response = await api('/sessions/' + encodeURIComponent(id) + '/command', request); sessionStorage.removeItem(storageKey); return response; }
  catch(e) { if(e.status >= 400 && e.status < 500 && ![408,429].includes(e.status)) sessionStorage.removeItem(storageKey); throw e; }
}
function testTabUrl(key) {
  const url = new URL(location.href); url.search = '';
  url.hash = new URLSearchParams({test: testRoom.credentials.roomId, key}).toString(); return url.href;
}
function endTestView() {
  ++loadSequence; // An in-flight view must never restore a discarded classroom.
  state = null; actor = null; sessionId = null; testPending = null; roster = null;
  if (dialog.open) dialog.close();
  testRoom?.close();
  root.innerHTML = '<main class="welcome"><h1>Test round ended</h1><p>Its temporary data has been discarded.</p>' + button('test-leave','Return to classroom') + '</main>';
}
async function enterTest(client) {
  stopSessionUpdates();
  const view = await client.call('view'); testRoom = client; solo = null;
  state = view.state; actor = view.actor; user = actor; sessionId = state.id; preview = undefined;
  sessions = []; page = actor.role === 'instructor' ? 'admin' : 'overview';
  channel = 'announcements'; report = 'profit'; reportRange = 30; selectedCompanies.clear();
  openPanels.clear(); inventoryCategories.clear(); inventoryCategories.add('finished'); inventoryCategories.add('component');
  restoreWorkspaceView();
  // Fetch an authorized test instructor preview before the first render.
  if (preview) state = (await client.call('view', { preview })).state;
  history.replaceState(null, '', testTabUrl(client.credentials.key));
  render();
  client.subscribe(event => {
    if (testRoom !== client || !sessionId) return;
    if (event === 'ended') endTestView();
    else if (event === 'changed') void load(false);
  });
  // Cover changes between the initial view and registering the listener.
  await load(false);
}
function leaveTest() {
  testRoom?.close(); const url = new URL(location.href); url.hash = ''; url.search = ''; location.replace(url.href);
}
async function testStudents() {
  const people = await testRoom.call('roster');
  modal('Test students', '<p>Each link opens a separate simulated student in this browser profile. No registration or sign-in is needed. Students in the same company share its decisions and results.</p>' + table(['Student', 'Company', ''], people.filter(p => p.role === 'student').map(p => [esc(p.name), esc(state.companies.find(c => c.id === p.companyId)?.name), `<a class="button" href="${esc(testTabUrl(p.key))}" target="_blank" rel="noopener">Open student tab ↗</a>`])));
}
async function startTestSetup(id) {
  if (!health?.testClassroom) throw new Error('Refresh after the classroom server update to start multi-tab test rounds.');
  if (!globalThis.SharedWorker) throw new Error('This browser does not support shared test tabs. Use a current desktop browser.');
  const template = await api('/sessions/' + encodeURIComponent(id) + '/test-template');
  modal('Set up a test round', '<p>Choose 1–12 companies, then assign simulated students to each. This round stays in memory in this browser; nothing is saved to Firebase.</p>' + field('companyCount', 'Number of competing companies', template.companyNames.length, 'number', 'min="1" max="12"'), async f => {
    const count = value(f,'companyCount'); if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('Choose 1–12 companies.');
    // The first modal closes before its next form is opened.
    setTimeout(() => modal('Assign test students', '<p>Each student belongs to exactly one company. Choose 1–20 students per company (60 total maximum).</p>' + Array.from({length:count}, (_,i) => `<div class="form-grid">${field('company-'+i,'Company '+(i+1),template.companyNames[i] || 'Company '+(i+1),'text','maxlength="60"')}${field('students-'+i,'Test students', i === 0 ? 2 : 1,'number','min="1" max="20"')}</div>`).join(''), async f => {
      const groups = Array.from({length:count},(_,i) => ({name:f.get('company-'+i),students:value(f,'students-'+i)}));
      const client = (await import('./src/test-client.mjs?v=5366cc14c565')).testClient();
      try { await client.create(template,groups); await enterTest(client); } catch(e) {client.close();throw e;}
    }, 'Start test round'), 0);
  }, 'Choose students');
}

function accountControls(person = user || actor) {
  const name = person.name?.trim() || 'Your account';
  const words = name.split(/\s+/);
  const initials = (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
  const role = person.role === 'instructor' ? 'Instructor' : 'Student';
  const actions = testRoom
    ? (person.role === 'instructor' ? button('test-students', 'Test students') : '')
    : `${button('profile', 'My profile & statistics')}${button('sessions', 'My sessions')}${person.role === 'instructor' ? button('create', 'Create a session', '', '', !!solo) : button('join', 'Join a company', '', '', !!solo)}${person.role === 'instructor' && state ? button('nav', 'Session settings', 'admin') + button('roster', 'Student directory', '', '', !!solo) : ''}`;
  return `<div class="account-controls"><span data-theme-slot></span><details class="account-menu"><summary aria-label="Account options for ${esc(name)}"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="account-name">${esc(name)}</span><svg class="account-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="account-dropdown"><div class="account-heading"><strong>${esc(name)}</strong><small>${testRoom ? 'Practice · ' : ''}${role}</small></div><div class="account-links">${actions}</div><div class="account-footer">${testRoom ? button('test-leave', 'Leave test', '', 'danger') : button('logout', 'Log out', '', 'danger')}</div></div></details></div>`;
}
const sessionCities = ["athens", "berlin", "cairo", "dubai", "lima", "lisbon", "london", "madrid", "miami", "oslo", "paris", "rome", "seoul", "sydney", "tokyo"];
const optionalCostField = (name, label, min, placeholder) => `<label>${esc(label)}<input name="${name}" type="number" min="${min}" max="10000" step="0.01" placeholder="${placeholder}"></label>`;
const priceFields = [['local', 'Regional starting price (€)', 285], ['export', 'International starting price (€)', 300]];
const inventoryCostFields = [['cell', 'Opening cell unit cost (€)', 3.10], ['frame', 'Opening frame unit cost (€)', 18], ['controller', 'Opening junction box unit cost (€)', 24], ['panel', 'Opening finished panel unit cost (€)', 130]];
function pricingInventoryFields() {
  return `<div class="form-grid">${priceFields.map(([id, label, defaultValue]) => optionalCostField('price-' + id, label, 50, defaultValue)).join('')}${select('inventoryStatement', 'Inventory statement format', [['cogs', 'Cost of goods sold'], ['inventory-change', 'Purchases and change in inventory']], 'cogs')}</div><div class="form-grid">${inventoryCostFields.map(([id, label, defaultValue]) => optionalCostField('cost-' + id, label, 0, defaultValue)).join('')}</div><p class="form-note">Blank amounts keep Studio defaults. Opening costs value starting stock only. Both statement formats use the same weighted-average ledger and report the same profit.</p>`;
}
function costOverrides(form, prefix, fields) {
  return Object.fromEntries(fields.map(([id]) => [id, form.get(prefix + id)]).filter(([, raw]) => raw != null && raw !== '').map(([id, raw]) => [id, Math.round(Number(raw) * 100)]));
}
function createSessionFields() { return `<div class="session-setup"><fieldset class="session-details"><legend>Session details</legend><p class="form-note">Give your class a name and a memorable session ID.</p>${field('name', 'Session name', 'Sustainability challenge', 'text', 'maxlength="120"')}${select('sessionCity', 'Session ID', [...sessionCities.map(city => [city, city]), ['custom', 'Choose my own ID…']], 'athens')}<label data-custom-session hidden>Custom session ID<input name="customSessionId" disabled minlength="3" maxlength="32" pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="e.g. london-2026" autocapitalize="none" spellcheck="false"></label><p class="form-note">Choose a city or your own ID: 3–32 letters, numbers or hyphens. IDs must be unique. Students enter this ID, then their company code when joining for the first time.</p></fieldset><fieldset><legend>Class setup</legend><div class="form-grid">${field('days', 'Duration (days)', 30, 'number', 'min="1" max="180"')}</div><label>Company names (one per line)<textarea name="companies" required rows="4">Helio Works
Northstar Solar
Verdant Energy</textarea></label></fieldset><details class="session-advanced"><summary>Advanced settings</summary>${field('seed', 'Random seed', 42, 'number', 'min="0" max="4294967295"')}<p class="form-note">Use the same seed to repeat the starting conditions.</p>${health?.classroomAccounting ? `<div class="form-grid">${select('revenueAt', 'Recognize sales revenue at', [['receipt', 'Customer receipt'], ['dispatch', 'Dispatch']], 'receipt')}${field('corporateOverhead', 'Daily corporate overhead (€ per company)', 0, 'number', 'min="0" max="1000000" step="0.01"')}</div><p class="form-note">Customer payment is due after receipt. Corporate overhead is charged at each daily close.</p>` : ''}${health?.operatingCostSettings ? `<div class="form-grid">${field('energyOverhead', 'Additional daily energy overhead (€ per company)', 0, 'number', 'min="0" max="1000000" step="0.01"')}<label>Fixed daily depreciation (€ per company)<input name="depreciation" type="number" min="0" max="1000000" step="0.01" placeholder="20% annual default"></label></div><p class="form-note">Energy overhead adds to electricity charges. Leave depreciation blank for the 20% annual declining-balance method. A fixed charge is capped by the remaining asset value.</p>` : ''}${health?.pricingInventorySettings ? pricingInventoryFields() : ''}</details></div>`; }
async function createClassroom(f) {
  const depreciation = f.get('depreciation');
  const operatingCosts = health?.operatingCostSettings ? {
    dailyEnergyOverhead: Math.round(value(f, 'energyOverhead') * 100),
    dailyDepreciation: depreciation == null || depreciation === '' ? null : Math.round(Number(depreciation) * 100)
  } : {};
  const pricingInventory = health?.pricingInventorySettings ? {
    startingPrices: costOverrides(f, 'price-', priceFields),
    openingUnitCosts: costOverrides(f, 'cost-', inventoryCostFields),
    inventoryStatement: f.get('inventoryStatement')
  } : {};
  const r = await api('/sessions', { ...pricingInventory, ...operatingCosts, ...(health?.classroomAccounting ? { revenueAt: f.get('revenueAt'), dailyCorporateOverhead: Math.round(value(f, 'corporateOverhead') * 100) } : {}), id: f.get('sessionCity') === 'custom' ? f.get('customSessionId') : f.get('sessionCity'), name: f.get('name'), seed: value(f, 'seed'), days: value(f, 'days'), companyNames: f.get('companies').split('\n').map(x => x.trim()).filter(Boolean) }); selectSession(r.id); page = 'admin'; await enter(); }
const sessionHints = {
  'open-session': 'Open session controls, company previews and reports. Effect on students: opening a session does not change their access or decisions.',
  'copy-session': 'Copy a link to this session. Effect on students: they still need to sign in and belong to a company; the link does not grant access.',
  'session-export': 'Download the session replay and results. Effect on students: their session is unchanged. The export may contain participant names; keep it private.',
  'session-test': 'Create a temporary practice round with simulated students, each assigned to one company, in separate browser tabs. Effect on students: real accounts and assessed results are unchanged. No test decisions are saved to Firebase.',
  'session-close': 'Stop play and move the session to Past sessions, retaining results. Effect on students: students can no longer open the session or submit decisions. Instructors retain access to results.',
  'session-delete': 'Archive the session and remove it from session lists. Stored records are retained. Effect on students: they lose access to this session; their accounts remain.',
  'session-codes': 'View company join codes and the student directory. Effect on students: sharing a company code lets a signed-in student join that company.',
  'sessions-delete': 'Archive all active sessions and remove them from session lists, retaining stored records. Effect on students: they lose access to those sessions; their accounts remain.'
};
function sessionButton(action, label, id = '', cls = '') {
  const hintId = 'hint-' + action + '-' + id;
  return '<span class="session-action-hint">' + button(action,label,id,cls).replace('<button ', '<button aria-describedby="' + esc(hintId) + '" ') + '<span class="session-tooltip" role="tooltip" id="' + esc(hintId) + '">' + esc(sessionHints[action]) + '</span></span>';
}
function renderAdminHome() {
  stopSessionUpdates();
  const active = sessions.filter(s => s.status !== 'completed'), past = sessions.filter(s => s.status === 'completed');
  const cards = list => list.map(s => `<article class="session-card"><div class="session-card-heading"><h3>${esc(s.name)}</h3><span class="badge session-status">${esc(s.status === 'completed' ? 'Closed' : s.status)}</span></div><p class="session-meta">Simulation hour ${number(s.hour)}</p><div class="session-actions" role="group" aria-label="Actions for ${esc(s.name)}">${sessionButton('open-session', 'Open', s.id, 'session-open')}${sessionButton('copy-session', 'Copy link', s.id)}${sessionButton('session-export', '↓ Export data', s.id, 'session-export')}${sessionButton('session-test', 'Test', s.id)}${s.status !== 'completed' ? sessionButton('session-close', 'Close', s.id) : ''}${sessionButton('session-delete', 'Delete', s.id, 'session-danger')}</div><div class="session-access">${sessionButton('session-codes', 'Company join codes ↗', s.id, 'session-access-button')}<small>Session ${esc(s.id)}</small></div></article>`).join('') || '<p class="empty">No sessions here yet.</p>';
  root.innerHTML = `<div class="admin-home"><header class="admin-header">${brand}${accountControls(user)}</header><main id="content"><div class="page-heading"><div><p class="eyebrow">Instructor workspace</p><h1>Sustainability Studio admin</h1><p>Manage your sessions and set up each learning task.</p></div></div><div class="admin-columns"><aside><details class="panel"><summary>Create session</summary><form id="create-session-form">${createSessionFields()}${button('submit', 'Create session', '', 'primary')}<div class="error" role="alert"></div></form></details></aside><div><details class="panel" open><summary>Active sessions <span>${active.length} sessions</span></summary><p class="form-note">Open a session to manage your classroom. Paused sessions appear here too.</p>${active.length ? sessionButton('sessions-delete', 'Delete all active sessions', '', 'session-danger session-bulk') : ''}${cards(active)}</details><details class="panel"><summary>Past sessions <span>${past.length} sessions</span></summary>${cards(past)}</details></div></div></main></div>`;
}

function renderLobby(error = '', requested = '', needsCompany = false) {
  stopSessionUpdates();
  state = null; actor = null;
  root.innerHTML = '<main class="welcome" id="content">' + brand + '<h1>Enter your session ID</h1><p>Enter the ID provided by your instructor. Only sessions open to students can be entered.</p><section class="panel"><form id="session-entry-form">' + field('sessionId', 'Session ID', requested, 'text', 'maxlength="100" autocomplete="off"') + (needsCompany ? field('code', 'Company join code', '', 'text', 'autocomplete="off"') + '<p>Your instructor’s company code assigns you to the correct team.</p>' : '') + button('submit', 'Enter session', '', 'primary') + '<div class="error" role="alert">' + esc(error) + '</div></form></section>' + (user?.role === 'instructor' ? button('sessions', 'All sessions') : '') + button('logout', 'Sign out') + '</main>';
}
const pages = { overview: 'Overview', orders: 'Sales & dispatch', supply: 'Supply & inventory', production: 'Production', finance: 'Finance', energy: 'Energy & growth', reports: 'Reports', messages: 'Messages', admin: 'Session control' };
const studentPanels = {
  inventory: ['Inventory', 'supply', () => inventoryPanel(true)],
  suppliers: ['Suppliers', 'supply', () => suppliersPanel(true)],
  purchases: ['Purchase history', 'supply', () => purchasesPanel(true)],
  shipments: ['Shipment history', 'orders', () => shipmentsPanel(true)],
  replenishment: ['Replenishment', 'supply', () => replenishmentPanel(true)],
  logistics: ['Logistics', 'supply', () => logisticsPanel(true)],
  orders: ['Orders & dispatch', 'orders', () => ordersPanel(true) + dispatchAssistantPanel()],
  offers: ['Sales offers', 'orders', () => offersPanel(true)],
  production: ['Production', 'production', productionPage],
  finance: ['Finance', 'finance', financePage],
  energy: ['Energy & growth', 'energy', energyPage],
  messages: ['Messages', 'messages', messagesPage]
};
const openPanels = new Set();
const inventoryCategories = new Set(['finished', 'component']);
const workspaceTools = [
  { id: 'operations', title: 'Operations', label: 'Ops', icon: 'admin', description: 'Manage production, energy and replenishment.', student: ['production', 'energy', 'replenishment'], instructor: ['production', 'energy', 'admin'] },
  { id: 'finance', title: 'Finance', label: 'Cash', icon: 'coins', description: 'Review cash, accounts and financing.', student: ['finance'], instructor: ['finance'] },
  { id: 'sales', title: 'Sales and orders', label: 'Sales', icon: 'edit', description: 'Set sales offers and dispatch orders.', student: ['orders', 'offers'], instructor: ['orders'] },
  { id: 'logistics', title: 'Logistics', label: 'Ship', icon: 'truck', description: 'Check stock, suppliers, purchases and shipments.', student: ['inventory', 'suppliers', 'purchases', 'shipments', 'logistics'], instructor: ['supply'] },
  { id: 'inbox', title: 'Announcements', label: 'Inbox', icon: 'mail', description: 'Open instructor announcements.', channel: 'announcements' },
  { id: 'chat', title: 'Chat', label: 'Chat', icon: 'messages', description: 'Open team or instructor conversations.', channel: 'chat' },
  { id: 'reports', title: 'Reports', label: 'Stats', icon: 'reports', description: 'Compare daily results and export data.', page: 'reports' },
  { id: 'guide', title: 'Guide', label: 'Guide', icon: 'book', description: 'Read the simulation model and teaching guide.', href: 'notes/model.md' },
  { id: 'help', title: 'Help', label: 'Help', icon: 'help', description: 'Get help finding tools or return to the overview.' }
];
const workspaceIcons = {
  coins: '<ellipse cx="9" cy="8" rx="6" ry="3"/><path d="M3 8v8c0 4 12 4 12 0V8M3 12c0 4 12 4 12 0m3-9c2 0 3 1 3 3v7c0 2-1 3-3 3"/>',
  edit: '<path d="M13 5H4v15h15v-8M8 15l1-4L19 1l4 4-10 10-5 1Z"/>',
  truck: '<path d="M4 17H2V5h13v4h4l3 4v4h-3M8 17h7m0-8v5"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  mail: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  book: '<path d="M12 5c-3-3-6-3-10-2v16c4-1 7-1 10 2 3-3 6-3 10-2V3c-4-1-7-1-10 2v16"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>'
};

function workspaceDestinations(tool, admin, visible) {
  const destinations = (admin ? tool.instructor : tool.student)?.filter(id =>
    admin ? visible(id) : studentPanelVisible(id, visible)
  ) || [];
  if (tool.id === 'logistics' && visible('orders')) destinations.unshift('orders');
  return destinations;
}

function workspaceChannel(tool) {
  return tool.channel === 'chat' ? channelOptions().find(([id]) => id !== 'announcements')?.[0] : tool.channel;
}

function workspaceNavigation(admin, visible) {
  const waiting = visible('orders') ? (company()?.orders || []).filter(order => order.remaining > 0).length : 0;
  const buttons = workspaceTools.map(tool => {
    const { id, title, label, description, href } = tool;
    const destinations = workspaceDestinations(tool, admin, visible);
    const unavailable = (tool.channel && !visible('messages')) || (tool.student && !destinations.length);
    const current = tool.page === page || (tool.channel &&
      (page === 'messages' || (page === 'workspace' && openPanels.has('messages'))) &&
      (tool.channel === 'chat' ? channel !== 'announcements' : channel === 'announcements'));
    const active = current || destinations.some(destination => admin ? page === destination : page === 'workspace' && openPanels.has(destination));
    const showBadge = id === 'logistics' && waiting > 0;
    const waitingLabel = showBadge ? `${number(waiting)} ${waiting === 1 ? 'order' : 'orders'} waiting to be dispatched` : '';
    const graphic = icon(tool.icon, workspaceIcons[tool.icon]);
    const body = `${showBadge ? `<span class="workspace-tool-icon">${graphic}<span class="dispatch-count" aria-hidden="true">${number(waiting)}</span></span>` : graphic}<span class="workspace-tool-desktop" aria-hidden="true">${title}</span><span class="workspace-tool-short" aria-hidden="true">${label}</span>
      <span class="workspace-tool-label"><strong aria-hidden="true">${title}</strong><span id="tool-${id}-hint">${showBadge ? waitingLabel + '. ' : ''}${description}</span></span>`;
    const accessibility = `aria-label="${title}" aria-describedby="tool-${id}-hint"`;
    return href ? `<a href="${href}" target="_blank" rel="noopener" ${accessibility}>${body}</a>` :
      `<button type="button" data-action="workspace-tool" data-id="${id}" ${accessibility}${current ? ' aria-current="page"' : ''}${active ? ' class="active"' : ''}${unavailable ? ' aria-disabled="true"' : ''}${destinations.length > 1 || id === 'help' ? ' aria-haspopup="dialog"' : ''}>${body}</button>`;
  });
  return `<header class="workspace-nav"><button type="button" class="mobile-menu-toggle" data-action="toggle-mobile-menu" aria-expanded="false" aria-controls="workspace-sections"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg><span>Menu</span></button><nav id="workspace-sections" class="workspace-tools" aria-label="Workspace">${buttons.join('')}</nav></header>`;
}

function studentPanelVisible(id, visible) {
  return Object.hasOwn(studentPanels, id) && visible(studentPanels[id][1]);
}
function workspaceFeatureVisible(key) {
  const feature = { orders: 'offers', supply: 'purchasing', production: 'production', finance: 'finance', energy: 'energy', messages: 'messaging' }[key];
  return isTeacher() || !feature || state.features[feature].visible;
}
function studentWorkspace(visible) {
  const panels = [...openPanels].filter(id => studentPanelVisible(id, visible));
  if (!panels.length) return '<p class="empty">Choose a tool from the left menu to open its panel here.</p>';
  return '<div class="student-panels">' + panels.map(id => {
    const [label, , renderPanel] = studentPanels[id];
    return '<section class="student-pane" aria-labelledby="pane-' + id + '"><div class="pane-title"><h2 id="pane-' + id + '" tabindex="-1">' + label + '</h2>' +
      '<button type="button" data-action="close-panel" data-id="' + id + '" aria-label="Close ' + label + '">×</button>' +
      '</div><div class="pane-content">' + renderPanel() + '</div></section>';
  }).join('') + '</div>';
}
function render() {
  if (!state) return user?.role === 'instructor' && page === 'sessions' ? renderAdminHome() : user ? renderLobby() : renderWelcome();
  if (isTeacher()) {
    if (preview && !state.companies.some(c => c.id === preview)) preview = undefined;
    selectedCompanies = new Set([...selectedCompanies].filter(id => state.companies.some(c => c.id === id)));
  }
  const c = company(), admin = isTeacher();
  const visible = workspaceFeatureVisible;
  if (!visible(page) || (page === 'workspace' && admin)) page = 'overview';
  const titles = { workspace: 'Decision workspace', overview: c ? `Let's make progress, ${c.name.split(' ')[0]}.` : 'A classroom in motion.', orders: 'From offer to arrival.', supply: 'Keep your business moving.', production: 'Make capacity count.', finance: 'Follow the money.', energy: 'Build a better footprint.', reports: 'See the whole picture.', messages: 'Better decisions, together.', admin: 'Set the pace of learning.' };
  const subtitles = { workspace: 'Open the panels you need and compare them side by side.', overview: 'Your business, at a glance. Every decision has a next step.', orders: 'Accepted terms stay with each order, from first dispatch to final payment.', supply: 'Balance availability, working capital, and the footprint of every component.', production: 'Coordinate materials, people, machines, and the hours they work.', finance: 'Cash is available money. Profit is revenue earned less costs incurred.', energy: 'Invest now. Track activation and the results over time.', reports: 'Comparable daily results, with every reporting boundary clearly marked.', messages: 'A shared space for announcements, questions, and team decisions.', admin: 'Control the shared clock, classroom access, and teaching parameters.' };
  root.innerHTML = `<div class="layout">${!admin || preview ? workspaceNavigation(admin, visible) : ''}<div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace &nbsp; / &nbsp; <strong>${pages[page] || "Decision workspace"}</strong></div><div class="top-actions">${user?.role === 'instructor' ? button('sessions', 'All sessions', '', 'small') : ''}${accountControls(actor)}</div></header>${testRoom ? `<div class="mode-banner"><span><strong>Temporary test round</strong> · ${esc(actor.name)} · Shared only across these browser tabs. No test data is saved.</span>${admin ? button('test-students', 'Open test student tabs') + button('test-end', 'End test round') : ''}${button('test-leave', 'Leave test')}</div>` : solo ? `<div class="mode-banner"><span><strong>Solo sandbox</strong> · ${solo.isTest ? 'Private test round · changes are discarded when you leave.' : 'Saved in this browser. Switch roles to rehearse; no other people are connected.'}</span>${button('switch-solo', admin ? 'Play a company' : 'Instructor view')}</div>` : health?.demo ? '<div class="mode-banner"><span><strong>Local classroom demo</strong> · Synthetic accounts share durable server state. Demo sign-in is enabled on this computer.</span></div>' : ''}<main id="content" class="content"><div class="page-heading"><div><div class="eyebrow">${esc(state.name)}${c ? ` &nbsp; / &nbsp; ${esc(c.name)}` : ''}</div><h1 tabindex="-1">${esc(titles[page])}</h1><p>${subtitles[page]}</p></div><div class="timebox"><span class="badge ${state.status === 'running' ? '' : 'amber'}">● ${esc(state.status)}</span><strong>${simDate(state.hour)} · simulation</strong><small>Day ${Math.floor(state.hour / 24) + 1} · ends ${simDate(state.endHour)}</small></div></div>${state.status === 'completed' ? `<div class="advice warning"><strong>Session complete. ${state.events.filter(e => e.status === 'pending').length} scheduled events remain.</strong>Pending deliveries, payments, and investments are preserved. The instructor can extend the end date to settle them.</div>` : ''}${admin ? `<div class="toolbar instructor-toolbar" aria-label="Instructor controls">${select('preview', 'Company preview · read-only', [['', 'All companies'], ...state.companies.map(x => [x.id, x.name])], preview || '')}<nav class="instructor-links" aria-label="Instructor pages">${button('nav', 'Session control', 'admin', 'small')}${button('nav', 'Class overview', 'overview', 'small')}${button('nav', 'Reports', 'reports', 'small')}${button('nav', 'Announcements', 'messages', 'small')}</nav></div>` : ''}${!admin && !solo && !testRoom ? `<div class="toolbar" aria-label="Classroom access">${button('join', 'Join another class', '', 'small')}${button('sessions', 'Switch session', '', 'small')}</div>` : ''}${page === "workspace" ? studentWorkspace(visible) : pageBody()}<div class="footer-note"><a href="notes/model.md" target="_blank" rel="noopener">Model & teaching guide ↗</a><br>All amounts are simulated EUR · Emissions in kg CO₂e · Simulation dates use UTC · Live state at ${simDate(state.hour)} · Model v${state.schema}</div></main></div></div>`;
  rememberWorkspaceView();
  const pending = !solo && !testRoom && sessionStorage.getItem(`studio-pending:${backend}:${actor.id}:${sessionId}`);
  if (pending) root.querySelector('#content').insertAdjacentHTML('afterbegin', `<div class="advice warning"><strong>A decision is awaiting confirmation.</strong>The response was interrupted. Retry with the same request key to confirm the outcome safely. ${button('retry-decision', 'Retry pending decision', '', 'small')}</div>`);
}
function pageBody() {
  if (page === 'admin') return adminPage();
  if (page === 'reports') return reportsPage();
  if (page === 'messages') return messagesPage();
  if (!company()) return instructorOverview();
  return ({ overview: overviewPage, orders: ordersPage, supply: supplyPage, production: productionPage, finance: financePage, energy: energyPage })[page]();
}
function chart(metricName, unit, { selected = false, range = 30 } = {}) {
  const snaps = state.snapshots.filter(x => x.hour >= state.hour - range * 24);
  if (!snaps.length) return '<p class="empty">The first chart point appears at the next daily close. Live operations are already available.</p>';
  const companies = state.companies.filter(c => !selected || !selectedCompanies.size || selectedCompanies.has(c.id));
  const series = companies.map(c => ({ ...c, color: state.companies.findIndex(x => x.id === c.id) % 3, values: snaps.map((snap, index) => {
    const row = snap.companies.find(x => x.id === c.id), prior = state.snapshots.find(x => x.hour === snap.hour - 24)?.companies.find(x => x.id === c.id);
    if (metricName === 'dailySales') return (row?.revenue || 0) - (prior?.revenue || 0);
    if (metricName === 'dailyProduction') return (row?.production || 0) - (prior?.production || 0);
    return row?.[metricName] || 0;
  }) }));
  const raw = series.flatMap(x => x.values), scale = unit === 'EUR' ? 100 : 1;
  let min = Math.min(0, ...raw) / scale, max = Math.max(1, ...raw) / scale; if (max === min) max++;
  const x = i => 62 + i * 520 / Math.max(1, snaps.length - 1), y = val => 204 - (val / scale - min) / (max - min) * 174;
  const grid = Array.from({ length: 5 }, (_, i) => { const val = min + (max - min) * i / 4, at = 204 - i * 43.5; return `<line class="gridline" x1="62" x2="590" y1="${at}" y2="${at}"/><text text-anchor="end" x="52" y="${at + 4}">${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}k` : number(val)}</text>`; }).join('');
  return `<div class="chart-scroll" role="region" aria-label="Time series chart"><svg class="chart" viewBox="-20 -6 660 252" role="group" aria-label="${esc(metricName)} in ${unit}, daily snapshots. Hover, tap, or focus a point for its value. Exact values are available in Reports data tables."><text x="10" y="13">${unit}</text>${grid}${series.map(serie => `<polyline class="chart-line color-${serie.color}" points="${serie.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${serie.values.map((v, i) => `<circle class="chart-point c${serie.color}" tabindex="0" role="img" aria-label="${esc(serie.name)} · ${simDate(snaps[i].hour)} · ${unit === 'EUR' ? exactMoney(v) : number(v / scale) + ' ' + esc(unit)}" r="3" cx="${x(i)}" cy="${y(v)}"></circle>`).join('')}`).join('')}${[...new Set([0, Math.floor((snaps.length - 1) / 2), snaps.length - 1])].map(i => `<text text-anchor="middle" x="${x(i)}" y="230">${simDate(snaps[i].hour).split(',')[0]}</text>`).join('')}</svg><div class="chart-tooltip" role="status" hidden></div></div><div class="chart-legend">${series.map(c => `<span><i class="legend-dot c${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>`;
}

function hideChartTooltip(chart) {
  chart.querySelector('.chart-tooltip').hidden = true;
  chart.querySelectorAll('.chart-point.is-highlighted').forEach(point => point.classList.remove('is-highlighted'));
}
function showChartTooltip(point) {
  const chart = point.closest('.chart-scroll'), tooltip = chart.querySelector('.chart-tooltip');
  chart.querySelectorAll('.chart-point.is-highlighted').forEach(other => other.classList.remove('is-highlighted'));
  point.classList.add('is-highlighted');
  tooltip.textContent = point.getAttribute('aria-label');
  tooltip.hidden = false;
}
function chartPointAt(event) {
  const chart = event.target.closest?.('.chart-scroll');
  if (!chart) return;
  let nearest, distance = Infinity;
  chart.querySelectorAll('.chart-point').forEach(point => {
    const box = point.getBoundingClientRect();
    const d = Math.hypot(event.clientX - box.x - box.width / 2, event.clientY - box.y - box.height / 2);
    if (d < distance) { nearest = point; distance = d; }
  });
  if (nearest && distance <= 28) showChartTooltip(nearest);
  else hideChartTooltip(chart);
}
document.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') chartPointAt(event); });
document.addEventListener('click', chartPointAt);
document.addEventListener('pointerout', event => {
  const chart = event.target.closest?.('.chart-scroll');
  if (chart && !chart.contains(event.relatedTarget)) hideChartTooltip(chart);
});
document.addEventListener('focusin', event => {
  if (event.target.matches?.('.chart-point')) showChartTooltip(event.target);
});
document.addEventListener('focusout', event => {
  const chart = event.target.closest?.('.chart-scroll');
  if (chart && !chart.contains(event.relatedTarget)) hideChartTooltip(chart);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.chart-scroll').forEach(hideChartTooltip);
});

function pendingEvents(limit = 6) {
  const events = state.events.filter(e => e.status === 'pending' && (!company() || e.companyId === company().id)).sort((a, b) => a.at - b.at).slice(0, limit);
  return events.length ? `<div class="timeline">${events.map(e => `<div class="timeline-item"><strong>${esc(e.description)}</strong><small>${simDate(e.at)} · ${e.blocked ? esc(e.blocked) : 'Scheduled'}</small></div>`).join('')}</div>` : '<p class="empty">No pending events. Your next decision starts here.</p>';
}
function overviewPage() {
  const c = company(), open = total(c.orders, 'remaining'), inbound = total(c.purchases.filter(p => p.receivedAt === null), 'qty');
  return `<div class="metrics">${metric('Available cash', money(c.accounts.cash), 'Live · excludes locked deposits', 'finance')}${metric('Cumulative profit', money(c.profit), 'Revenue at receipt, less costs', 'reports')}${metric('Ready to ship', number(c.inventory.panel.qty), `${number(open)} modules in open orders`, 'supply')}${metric('Carbon footprint', `${number(c.emissions / 1000)} t`, 'Cumulative operational kg CO₂e / 1,000', 'energy')}</div><div class="split">${panel('Business performance', `Cumulative profit · EUR · daily closes through ${state.snapshots.length ? simDate(state.snapshots.at(-1).hour) : 'no completed day'}`, chart('profit', 'EUR'), button('nav', 'All reports ↗', 'reports', 'small'))}${panel('Up next', 'Accepted decisions, scheduled outcomes', pendingEvents(4), button('events', 'View all', '', 'small'))}</div><div class="advice"><strong>${open > c.inventory.panel.qty ? 'Demand is ahead of your available stock.' : 'Your next move matters.'}</strong>${open > c.inventory.panel.qty ? `You have ${number(open)} modules still to dispatch and ${number(c.inventory.panel.qty)} ready. Check material availability and production capacity before promising faster delivery.` : `Production is currently limited by: ${esc(c.lastBottleneck)}. Review your open orders, then compare the cost and carbon of your next shipment.`}</div><div class="grid2">${panel('Order journey', 'Cumulative modules · dispatch is not customer receipt', `<div class="flow"><div><strong>${number(c.demandUnits)}</strong><span>Ordered</span></div><div><strong>${number(c.dispatched)}</strong><span>Dispatched</span></div><div><strong>${number(c.received)}</strong><span>Received</span></div></div>${table(['Latest order', 'Remaining', 'Promised'], c.orders.filter(o => o.remaining).slice(-3).reverse().map(o => [esc(o.id), `${o.remaining} modules`, simDate(o.dueAt)]), 'No open orders yet.')}`, button('nav', 'Manage orders ↗', 'orders', 'small'))}${panel('Decision feedback', 'The cause, the consequence, and when it happened', `<div class="timeline">${c.notices.slice(-3).reverse().map(n => `<div class="timeline-item"><strong>${esc(n.text)}</strong><small>${simDate(n.hour)} · ${esc(n.kind)}</small></div>`).join('') || '<p class="empty">Make a decision to see its feedback here.</p>'}</div>`)}</div>`;
}
function instructorOverview() {
  return `<div class="metrics">${metric('Participating companies', state.companies.length, 'Shared scenario and clock', 'overview')}${metric('Completed days', state.snapshots.length, 'Immutable daily snapshots', 'reports')}${metric('Pending outcomes', state.events.filter(e => e.status === 'pending').length, 'Includes payments and arrivals', 'orders')}${metric('Session duration', `${number(state.endHour / 24)} days`, `${number(Math.max(0, state.endHour - state.hour))} h remaining`, 'admin')}</div>${panel('Company comparison', 'Live values · select a company above for read-only preview', table(['Company', 'Cash', 'Profit', 'Ready stock', 'Open units', ''], state.companies.map(c => [esc(c.name), money(c.cash), money(c.profit), c.inventory, c.openUnits, button('preview', 'Preview', c.id, 'small')])))}<div class="grid2">${panel('Profit over time', 'Cumulative EUR · daily close', chart('profit', 'EUR'))}${panel('Carbon over time', 'Cumulative kg CO₂e · daily close', chart('emissions', 'kg CO₂e'))}</div>`;
}
function offersPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Sales offers', 'One transparent offer per market. Editing affects future orders.', table(['Market', 'Price / module', 'Quantity band', 'Delivery promise', 'Payment after receipt', ''], c.offers.map(o => [esc(state.catalog.markets.find(m => m.id === o.marketId)?.name), exactMoney(o.price), `${o.min}–${o.max}`, `${o.delivery} h`, `${o.payment} h`, `${o.enabled ? '<span class="badge">Active</span>' : '<span class="badge amber">Off</span>'} ${button('offer', 'Edit', o.id, 'small', !permitted('offers'))}`])))}`;
}
function ordersPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Customer orders', 'Original quantities are preserved. Split shipments share the accepted price and promise.', table(['Order / market', 'Original', 'To dispatch', 'Received', 'Promised arrival', ''], c.orders.slice().reverse().map(o => [`<strong>${esc(o.id)}</strong><small>${esc(o.customer)} · ${exactMoney(o.price)} / module</small>`, o.originalQty, o.remaining, o.received, `${simDate(o.dueAt)}${o.remaining && o.dueAt < state.hour ? '<small class="danger">Overdue</small>' : ''}`, button('dispatch', 'Dispatch', o.id, 'small', !permitted('offers') || !o.remaining)])))}`;
}
function shipmentsPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Shipment history', 'Goods leave stock at dispatch; revenue is earned at customer receipt; cash follows the payment term.', table(['Shipment', 'Quantity', 'Route', 'Dispatched', 'Customer receipt', 'Paid'], c.shipments.slice().reverse().map(s => [`${esc(s.id)}<small>${esc(s.orderId)}</small>`, s.qty, esc(s.route), simDate(s.dispatchedAt), s.receivedAt === null ? `In transit<small>Estimate ${simDate(s.expectedAt)}</small>` : simDate(s.receivedAt), s.paidAt === null ? 'Pending' : simDate(s.paidAt)])))}`;
}
function dispatchAssistantPanel() {
  const c = company();
  return `${panel('Dispatch assistant', 'FIFO · cheapest feasible route, with a buffer for delay', `<p class="form-note">${esc(c.autoStatus.delivery || 'Not installed.')}</p>`)}`;
}
function ordersPage() {
  return offersPanel() + ordersPanel() + shipmentsPanel() + dispatchAssistantPanel();
}
function inventoryPanel(embedded = false) {
  const c = company();
  const recipe = productionRecipe(state);
  const product = itemName(state, 'panel').toLowerCase();
  const incoming = new Map();
  const pending = c.purchases.filter(purchase => purchase.receivedAt === null)
    .sort((a, b) => a.expectedAt - b.expectedAt);
  const materialCapacity = () => {
    const limits = Object.entries(recipe).map(([key, needed]) => {
      const available = (c.inventory[key]?.qty ?? 0) + (incoming.get(key) ?? 0);
      return [key, Math.floor(available / needed)];
    });
    const buildable = Math.min(...limits.map(([, count]) => count));
    return { buildable, limiting: limits.filter(([, count]) => count === buildable).map(([key]) => key) };
  };
  const { buildable, limiting } = materialCapacity();
  const limitingNames = keys => keys.map(key => itemName(state, key)).join(', ');
  let forecast = { buildable, limiting };
  const deliveries = pending.map(purchase => {
    incoming.set(purchase.item, (incoming.get(purchase.item) ?? 0) + purchase.qty);
    const previous = forecast.buildable;
    forecast = materialCapacity();
    const extra = forecast.buildable - previous;
    const eta = purchase.expectedAt < state.hour ? '<small class="danger">Overdue</small>' : '';
    return [
      `${esc(purchase.id)}<small>${esc(purchase.supplier)}</small>`,
      `${number(purchase.qty)} × ${itemName(state, purchase.item)}`,
      simDate(purchase.expectedAt) + eta,
      extra ? '+' + number(extra) : '0',
      number(forecast.buildable),
      limitingNames(forecast.limiting)
    ];
  });
  const extra = forecast.buildable - buildable;
  const productCount = count => `${number(count)} ${product}${count === 1 ? '' : 's'}`;
  const buildSummary = `<p class="inventory-build"><strong>${productCount(buildable)} from stock on hand</strong><span>Limiting: ${limitingNames(limiting)}</span></p>
    <p class="inventory-build"><strong>After incoming orders: ${productCount(forecast.buildable)} (${number(extra)} more)</strong><span>Limiting after receipt: ${limitingNames(forecast.limiting)}</span></p>`;
  const timeline = deliveries.length ? panel('Incoming deliveries', 'Expected times use the simulation clock. Orders with the same estimate are listed in purchase order.', table(['Purchase', 'Delivery', 'Expected arrival', 'Extra from delivery', 'Total buildable', 'Limiting components'], deliveries)) : '';
  const category = key => key === 'panel' ? 'finished' : 'component';
  const categories = [['finished', 'Finished'], ['component', 'Components']];
  const filters = embedded ? `<fieldset class="inventory-filters"><legend>Show stock</legend>${categories.map(([id, label]) => check('stock-' + id, label, inventoryCategories.has(id))).join('')}</fieldset>` : '';
  const rows = Object.keys(c.inventory).sort((a, b) => Number(b === 'panel') - Number(a === 'panel'))
    .filter(key => !embedded || inventoryCategories.has(category(key))).map(key => {
      const stock = c.inventory[key];
      const ordered = incoming.get(key);
      const type = category(key);
      return [
        `<span class="stock-kind ${type}" aria-label="${type === 'finished' ? 'Finished' : 'Component'}">${type === 'finished' ? 'F' : 'C'}</span> ${itemName(state, key)}`,
        `<span class="nowrap"><strong>${number(stock.qty)}</strong> / ${number(stock.capacity)}</span>`,
        Object.hasOwn(recipe, key) ? `${number(recipe[key])}${limiting.includes(key) ? ' <span class="badge amber">Limiting</span>' : ''}` : '—',
        stock.qty ? exactMoney(stock.value / stock.qty) : '—',
        ordered ? number(ordered) : '—',
        stock.qty ? precise(stock.carbon / stock.qty) : '—'
      ];
    });
  return panel(embedded ? '' : 'Inventory', '', `${buildSummary}${filters}<div class="inventory-table">${table(['Item', 'Amount / capacity', `Needed / ${product}`, 'Avg cost / unit', 'Ordered', 'kg CO₂e / unit'], rows, 'Select Finished or Components to show stock.')}</div><p class="form-note inventory-note">Counts reflect materials only. The forecast adds all outstanding purchases to today’s stock, assuming no stock is used before receipt. Stock above capacity costs €0.05 per excess unit per day.</p>`) + timeline;
}
function suppliersPanel(embedded = false) {
  return `${panel(embedded ? '' : 'Supplier marketplace', 'All orders have a landed fixed fee. Supplier stock is shared across companies.', table(['Supplier / item', 'Unit price', 'Order fee', 'Lead / payment', 'Delivery accuracy', 'Component / freight CO₂e', 'Available / lot', ''], state.catalog.suppliers.filter(s => s.enabled).map(s => [`<strong>${esc(s.name)}</strong><small>${itemName(state, s.item)}</small>`, exactMoney(s.price), exactMoney(s.fee), `${s.lead} h / ${s.term} h<small>Payment after receipt</small>`, `${s.reliability}% on time<small>Up to ${s.maxDelay} h extra</small>`, `${precise(s.carbon)} / ${precise(s.freight)} kg per unit<small>${precise(s.carbon + s.freight)} kg total per unit</small>`, `${number(s.stock)}<small>Minimum ${s.min} · lot ${s.lot}</small>`, button('purchase', 'Order', s.id, 'small', !permitted('purchasing'))])))}`;
}
function logisticsPanel(embedded = false) {
  return `${panel(embedded ? '' : 'Logistics services', 'Compare the enabled routes before dispatching a customer order.', table(['Route', 'Duration', 'Cost / shipment', 'Cost / unit', 'Delivery accuracy', 'Transport CO₂e'], state.catalog.routes.filter(r => r.enabled).map(r => [esc(r.name), `${r.hours} h`, exactMoney(r.fixed), exactMoney(r.unit), `${r.reliability}% on time<small>Up to ${r.maxDelay} h extra</small>`, `${precise(r.carbonFixed)} kg / shipment<small>${precise(r.carbonUnit)} kg / unit</small>`]), 'No transport routes are enabled.'))}`;
}
function purchasesPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Purchase history', 'Committed → received → paid', table(['Purchase', 'Quantity', 'Landed cost', 'Expected', 'Receipt', 'Payment'], c.purchases.slice().reverse().map(p => [`${esc(p.id)}<small>${itemName(state, p.item)} · ${esc(p.supplier)}</small>`, p.qty, exactMoney(p.cost), simDate(p.expectedAt), p.receivedAt === null ? 'In transit' : simDate(p.receivedAt), p.paidAt === null ? 'Pending' : simDate(p.paidAt)])))}`;
}
function replenishmentPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Replenishment policies', 'A policy includes available + incoming stock to avoid duplicate orders.', `<p class="form-note">${esc(c.autoStatus.purchasing || 'Install the replenishment assistant to automate your policies.')}</p>${table(['Item', 'Reorder at or below', 'Order quantity', 'State', ''], ['cell', 'frame', 'controller'].map(key => [itemName(state, key), c.reorder[key]?.point ?? '—', c.reorder[key]?.qty ?? '—', c.reorder[key]?.enabled ? 'Enabled' : 'Off', button('reorder', 'Set policy', key, 'small', !permitted('investments'))]))}`)}`;
}
function supplyPage() {
  return inventoryPanel() + suppliersPanel() + logisticsPanel() + purchasesPanel() + replenishmentPanel();
}
function productionPage() {
  const c = company(), pendingShift = state.events.find(e => e.companyId === c.id && e.type === 'shifts' && e.status === 'pending');
  const shiftLabels = ['00:00–08:00', '08:00–16:00', '16:00–24:00'];
  const describeShifts = shifts => shiftLabels.filter((_, i) => shifts[i]).join(', ') || 'No shifts';
  return `<div class="metrics">${metric('Machine capacity', `${c.machines * 6} / h`, `${c.machines} assembly lines`, 'production')}${metric('Staff capacity', `${c.workers * 2} / h`, `${c.workers} workers`, 'overview')}${metric('Modules produced', number(c.production), 'Cumulative completed output', 'supply')}${metric('Electricity consumed', number(c.energyKwh), 'kWh · cumulative production', 'energy')}</div><div class="advice"><strong>Current bottleneck: ${esc(c.lastBottleneck)}</strong>Each ${itemName(state, "panel").toLowerCase()} uses ${Object.entries(productionRecipe(state)).map(([item, qty]) => qty + " " + itemName(state, item).toLowerCase() + (qty === 1 ? "" : item === "controller" && state.recipe ? "es" : "s")).join(", ")}. Output is limited by materials, staff, machines, storage space, and cash. Active shifts incur wages even when materials run out.</div><div class="grid2">${panel('Production schedule', 'Changes take effect at the next 8-hour boundary.', `<p class="form-note"><strong>Active schedule:</strong> ${describeShifts(c.shifts)} UTC.</p>${pendingShift ? `<div class="advice"><strong>Saved schedule pending: ${describeShifts(pendingShift.data.shifts)} UTC.</strong>Effective ${simDate(pendingShift.at)}. The active schedule continues until then.</div>` : ''}<form id="shifts-form">${shiftLabels.map((s, i) => check(`shift${i}`, s + ' UTC simulation time', pendingShift ? pendingShift.data.shifts[i] : c.shifts[i], !!pendingShift)).join('')}<p class="form-note">Wages: €13.50 per worker per active hour. Electricity: 3 kWh per module before efficiency upgrades.</p>${button('submit', pendingShift ? 'Shift change pending' : 'Save shift schedule', '', 'primary', !permitted('production') || !!pendingShift)}<div class="error" role="alert"></div></form>`)}${panel('People & equipment', 'Recruitment and reductions take 48 h; machinery takes 72 h.', `<div class="value-list"><div><span>Workers</span><strong>${c.workers}</strong></div><div><span>Assembly lines</span><strong>${c.machines}</strong></div><div><span>Energy efficiency factor</span><strong>${c.efficiency}</strong></div></div><div class="toolbar">${button('staff', 'Change staffing', '', '', !permitted('production'))}${button('invest', 'Add assembly line', 'machine', '', !permitted('investments'))}</div>`)}</div>${panel('Production trend', 'Modules completed each day · immutable closes', chart('dailyProduction', 'modules'))}`;
}
function expenseBreakdown(ledger) {
  const totals = new Map();
  for (const entry of ledger) {
    if (!entry.lines.expense) continue;
    const category = entry.description.replace(/ [a-z]+-\d+$/, '');
    totals.set(category, (totals.get(category) ?? 0) + entry.lines.expense);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([category, amount]) =>
    `<div><span>${esc(category)}</span><strong>${exactMoney(amount)}</strong></div>`).join('');
}
function inventoryStatementLines(company) {
  if (state.accounting?.inventoryStatement !== 'inventory-change') return `<div><span>Cost of goods sold</span><strong>${exactMoney(company.accounts.cogs)}</strong></div>`;
  const { purchases, inventoryChange } = inventoryStatementValues(company);
  return `<div><span>Received material purchases</span><strong>${exactMoney(-purchases)}</strong></div><div><span>Change in inventory (including goods in transit to customers)</span><strong>${exactMoney(inventoryChange)}</strong></div>`;
}
function financePage() {
  const c = company(), a = c.accounts;
  return `<div class="metrics">${metric('Available cash', money(a.cash), 'Live bank balance', 'finance')}${metric('Cumulative profit', money(c.profit), 'Includes depreciation & accrued costs', 'reports')}${metric('Receivables', money(a.receivable), 'Recognized revenue awaiting payment', 'orders')}${metric('Debt & payables', money(-(a.debt || 0) - (a.payable || 0) - (a.interestPayable || 0) - (a.overheadPayable || 0)), 'Includes outstanding obligations', 'finance')}</div><div class="grid2">${panel('Finance your next decision', 'Compare funding dates and repayment schedules.', `<p class="form-note">Bullet loans: 9% simple annual interest. Annuity loans: 8% annual interest with weekly payments. Deposits: 4% simple annual interest. This is a teaching model, not a bank product.</p><div class="toolbar">${button('loan', 'Request bullet loan', '', 'primary', !permitted('finance'))}${button('annuity', 'Request annuity loan', '', '', !permitted('finance'))}${button('deposit', 'Place deposit', '', '', !permitted('finance'))}</div><div class="value-list"><div><span>Inventory at cost</span><strong>${money(a.inventory)}</strong></div><div><span>Purchased goods in transit</span><strong>${money(a.inbound)}</strong></div><div><span>Inventory value in transit</span><strong>${money(a.transit)}</strong></div><div><span>Locked term deposits</span><strong>${money(a.deposits)}</strong></div></div>`)}${panel('Income statement', `Cumulative · live through ${simDate(state.hour)}`, `<div class="value-list"><div><span>Revenue earned at ${state.accounting?.revenueAt === 'dispatch' ? 'dispatch' : 'customer receipt'}</span><strong>${money(-a.revenue)}</strong></div>${inventoryStatementLines(c)}<div><span>Operating costs & depreciation</span><strong>${money(a.expense)}</strong></div>${expenseBreakdown(c.ledger)}<div><span>Interest income</span><strong>${money(-a.interestIncome)}</strong></div><div><span>Profit / loss</span><strong>${money(c.profit)}</strong></div></div>`)}</div>${panel('Scheduled cash movements', 'Committed events only. Excludes future trading, recurring costs, and payments not yet scheduled by receipt.', table(['Simulation time', 'Event', 'Cash movement', 'Status'], c.forecast.map(f => [simDate(f.hour), esc(f.description), exactMoney(f.amount), f.blocked ? esc(f.blocked) : 'Scheduled'])))}${panel('Finance contracts', 'Outstanding loans and locked deposits remain visible at the session end.', table(['Contract', 'Principal', 'Interest at maturity', 'Funding / placement', 'Completion'], [...c.loans.map(l => [esc(l.id), money(l.amount), exactMoney(l.interest), l.fundedAt === null ? 'Pending funding' : simDate(l.fundedAt), l.paidAt === null ? 'Repayment pending' : simDate(l.paidAt)]), ...c.deposits.map(d => [esc(d.id), money(d.amount), exactMoney(d.interest), simDate(d.placedAt), d.maturedAt === null ? `Due ${simDate(d.placedAt + d.term)}` : simDate(d.maturedAt)])]))}${panel('Transaction journal', 'Double-entry ledger · debits positive, credits negative · all values EUR', `<details><summary>Show latest 100 entries (${c.ledger.length} total)</summary>${table(['Time', 'Description', 'Postings'], c.ledger.slice(-100).reverse().map(l => [simDate(l.hour), esc(l.description), Object.entries(l.lines).map(([k, v]) => `${esc(k)}: ${exactMoney(v)}`).join('<br>')]))}</details>`, button('ledger-csv', 'Export ledger', '', 'small'))}`;
}
function energyPage() {
  const c = company(), pendingEnergy = state.events.find(e => e.companyId === c.id && e.type === 'energy' && e.status === 'pending');
  const pendingProvider = pendingEnergy && (pendingEnergy.data.terms || state.catalog.energy.find(e => e.id === pendingEnergy.data.energyId));
  const energyOptions = state.catalog.energy.filter(e => e.enabled || e.id === c.energy || e.id === pendingEnergy?.data.energyId).map(e => e.id === c.energy && c.energyTerms ? { ...e, ...c.energyTerms } : e.id === pendingEnergy?.data.energyId && pendingEnergy.data.terms ? { ...e, ...pendingEnergy.data.terms } : e);
  return `${pendingEnergy ? `<div class="advice"><strong>Switch to ${esc(pendingProvider?.name || pendingEnergy.data.energyId)} pending.</strong>Effective ${simDate(pendingEnergy.at)}. Your current contract remains active until then; another switch cannot be placed while this one is pending.</div>` : ''}<div class="advice"><strong>Carbon information and demand effects are separate.</strong>Carbon is always measured. Customer preference for lower carbon is currently <b>${state.effects.carbonDemand ? 'enabled' : 'disabled'}</b>. A new energy contract changes future production; existing inventory keeps its embodied footprint.</div>${panel('Choose your electricity', 'Tariffs are EUR/kWh by 8-hour shift. Standing charge is EUR/day.', table(['Provider', '00–08 / 08–16 / 16–24', 'Standing charge', 'Switch fee / delay', 'kg CO₂e/kWh', ''], energyOptions.map(e => [esc(e.name), e.rates.map(r => exactMoney(r)).join(' / '), exactMoney(e.daily), `${money(e.fee)} / ${e.delay} h`, precise(e.carbon), e.id === c.energy ? '<span class="badge">Current contract</span>' : e.id === pendingEnergy?.data.energyId ? '<span class="badge amber">Switch pending</span>' : button('energy-switch', 'Switch', e.id, 'small', !permitted('energy') || !!pendingEnergy)])))}<div class="grid3">${Object.entries(INVESTMENTS).map(([key, inv]) => { const contract = c.investments.filter(x => x.kind === key).at(-1), active = contract?.activeAt !== null && contract?.activeAt !== undefined; return `<section class="panel investment"><div class="invest-icon">${icon(key === 'efficiency' ? 'energy' : 'production')}</div><h2>${esc(inv.name)}</h2><p>${({ delivery: 'Dispatch oldest orders using the cheapest route that can meet the promise, with a delay buffer.', purchasing: 'Reorder components hourly when stock plus incoming supply reaches your policy threshold.', machine: 'Add six modules per hour of machine capacity. Materials and staff still limit output.', warehouse: 'Expand every stock location by 50%. Reduce pressure on storage space.', efficiency: 'Reduce production electricity per module by 25% after commissioning.' })[key]}</p><div class="price">${money(inv.cost)}</div><p>${inv.delay} h to activate · prepaid<br>${contract ? (active ? `Active since ${simDate(contract.activeAt)}` : 'Installation pending') : 'Not installed'}</p>${button('invest', contract && !active ? 'Pending' : active && !['machine', 'warehouse'].includes(key) ? 'Active' : 'Invest', key, 'small', !permitted('investments') || (contract && (!active || !['machine', 'warehouse'].includes(key))))}</section>`; }).join('')}</div>${panel('Research & market presence', 'Daily recurring budgets · diminishing quality and marketing effects.', `<div class="value-list"><div><span>Quality multiplier</span><strong>${c.quality.toFixed(3)}</strong></div><div><span>Daily research</span><strong>${money(c.research)}</strong></div><div><span>Daily marketing</span><strong>${money(c.marketing)}</strong></div></div>${button('budget', 'Edit daily budgets', '', '', !permitted('investments'))}`)}`;
}
const reportTypes = { profit: ['Cumulative profit', 'EUR'], dailySales: ['Daily revenue earned', 'EUR'], dailyProduction: ['Daily production', 'modules'], cash: ['Cash balance', 'EUR'], inventory: ['Finished inventory', 'modules'], energyCost: ['Cumulative energy cost', 'EUR'], energyKwh: ['Cumulative electricity', 'kWh'], emissions: ['Cumulative carbon', 'kg CO₂e'], marketShare: ['Cumulative delivered market share', '%'], dispatched: ['Cumulative dispatches', 'modules'], received: ['Cumulative customer receipts', 'modules'] };
function reportsPage() {
  const [title, unit] = reportTypes[report];
  const snaps = state.snapshots.filter(s => s.hour >= state.hour - reportRange * 24);
  return `<div class="advice"><strong>Daily reports are frozen at each midnight close.</strong>Last close: ${state.snapshots.length ? simDate(state.snapshots.at(-1).hour) : 'none yet'}. Live operations: ${simDate(state.hour)}. Each close includes that hour’s arrivals, production, demand, automation, costs, and depreciation.</div><div class="toolbar">${select('report', 'Measure', Object.entries(reportTypes).map(([k, [n]]) => [k, n]), report)}${select('range', 'Time window', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['180', 'Full session']], String(reportRange))}${button('report-csv', 'Export CSV', '', 'small')}</div>${panel(title, `${unit} · daily snapshots`, `<div class="toolbar">${state.companies.map(c => check(`series-${c.id}`, c.name, !selectedCompanies.size || selectedCompanies.has(c.id))).join('')}</div>${chart(report, unit, { selected: true, range: reportRange })}`)}${panel('Exact daily values', 'Accessible data table · one row per company per completed day', `<details><summary>Show report values</summary>${table(['As of (simulation)', 'Company', `${esc(title)} (${unit})`], reportRows(snaps).map(row => [row[0], esc(row[1]), number(row[2])]))}</details>`)}`;
}
function reportRows(snaps = state.snapshots) { return snaps.flatMap(s => s.companies.filter(c => !selectedCompanies.size || selectedCompanies.has(c.id)).map(c => { const prev = state.snapshots.find(x => x.hour === s.hour - 24)?.companies.find(x => x.id === c.id); let n = report === 'dailySales' ? c.revenue - (prev?.revenue || 0) : report === 'dailyProduction' ? c.production - (prev?.production || 0) : c[report]; if (reportTypes[report][1] === 'EUR') n /= 100; return [simDate(s.hour), c.name, n]; })); }
function channelOptions() { return [['announcements', 'Instructor announcements'], ...(isTeacher() ? state.companies.map(c => [`teacher:${c.id}`, `Teacher ↔ ${c.name}`]) : [[`team:${actor.companyId}`, 'My team · internal'], [`teacher:${actor.companyId}`, 'Ask the instructor']])]; }
function messagesPage() {
  const options = channelOptions(); if (!options.some(x => x[0] === channel)) channel = options[0][0];
  const messages = state.messages.filter(m => m.channel === channel);
  const canSend = (state.status !== 'completed' || isTeacher()) && state.features.messaging.allowed && (isTeacher() || channel !== 'announcements');
  return `<div class="toolbar">${select('channel', 'Conversation', options, channel)}<span class="form-note">Students can message their team or the instructor. Announcements are read-only for students.</span></div>${panel(esc(options.find(x => x[0] === channel)?.[1]), 'Sender identity comes from the signed-in account. Both clocks are labelled.', `<div class="messages">${messages.map(m => `<article class="message ${m.role === 'instructor' ? 'teacher' : ''}"><div class="message-header">${esc(m.senderName)} · ${esc(m.role)}</div><p>${esc(m.text)}</p><small>Real time: ${new Date(m.realAt).toLocaleString('en-GB')} · Simulation: ${simDate(m.hour)}</small></article>`).join('') || '<p class="empty">Start a useful conversation. Messages are saved with this session.</p>'}</div>${canSend ? `<form id="message-form"><label>Your message<textarea name="text" maxlength="2000" placeholder="Share a decision, ask a question, or coordinate a next step…" required></textarea></label>${button('submit', channel === 'announcements' ? 'Post announcement' : 'Send message', '', 'primary')}<div class="error" role="alert"></div></form>` : '<p class="form-note">This conversation is read-only for your role or messaging is disabled.</p>'}`)}`;
}
function adminPage() {
  if (!isTeacher()) return '';
  return `<div class="grid2">${panel('The shared clock', 'Pause for discussion. Step for a decision round. Run for continuous play.', `<div class="clock-controls">${button('clock', state.status === 'running' ? 'Pause clock' : 'Run clock', state.status === 'running' ? 'paused' : 'running', 'primary', state.status === 'completed' || !!solo)}${button('step', '+ 1 hour', '1', '', state.status !== 'paused')}${button('step', '+ 1 day', '24', '', state.status !== 'paused')}${button('step', 'Custom step', 'custom', '', state.status !== 'paused')}</div><p class="form-note clock-note"><span>${solo ? 'Solo mode advances with manual steps.' : `<strong>Running speed:</strong> ${state.secondsPerHour} real seconds per simulation hour.`}</span><span>No time is skipped during server downtime.</span></p>${button('settings', 'Session settings', '', 'small')}`)}${panel('Classroom access', 'Every student belongs to one company in this session.', `<div class="toolbar">${button('roster', 'Companies & join codes', '', 'primary', !!solo)}${button('create', 'New session', '', '', !!solo || !!testRoom)}${button('sessions', 'Switch session', '', 'small', !!solo)}</div><p class="form-note">Company join codes grant student membership only. Instructor previews are read-only. Team messages are visible only to members of that company.</p>`)}</div>${panel('Teaching capabilities', 'Visibility controls navigation. Permission controls new decisions. Model effects are separate.', `<div class="toggle-row"><span>Feature</span><span>Visibility &nbsp; / &nbsp; Permission</span></div>${FEATURES.map(f => `<form class="toggle-row" data-feature="${f}"><span>${esc(f.charAt(0).toUpperCase() + f.slice(1))}</span><div class="toolbar">${check('visible', 'Show', state.features[f].visible)}${check('allowed', 'Allow decisions', state.features[f].allowed)}${button('submit', 'Apply', '', 'small')}</div><div class="error" role="alert"></div></form>`).join('')}<form id="effects-form" class="toggle-row"><span>Model effect</span><div class="toolbar">${check('carbonDemand', 'Customer preference for lower carbon', state.effects.carbonDemand)}${button('submit', 'Apply', '', 'small')}</div><div class="error" role="alert"></div></form>`)}${panel('Scenario catalogues', 'Change future supply, transport, demand, and energy conditions. Accepted contracts keep their terms.', `<div class="toolbar">${['suppliers', 'routes', 'markets', 'energy'].map(k => button('catalog-list', k.charAt(0).toUpperCase() + k.slice(1), k)).join('')}</div>`)}${panel('Upcoming outcomes across the class', 'Pending obligations remain visible beyond the configured end.', pendingEvents(10), button('events', 'All events', '', 'small'))}${panel('Audit trail', 'Accepted commands identify the actor and both clocks.', table(['Simulation / real time', 'Actor', 'Action', 'Result'], state.audit.slice(-30).reverse().map(a => [`${simDate(a.hour)}<small>${new Date(a.realAt).toLocaleString('en-GB')}</small>`, `${esc(a.actorName)}<small>${esc(a.role)}</small>`, esc(a.command.type), esc(a.result)])), button('replay', 'Export replay', '', 'small', !!solo || !!testRoom))}`;
}
function modal(title, content, onSubmit, submitLabel = 'Confirm') {
  dialog.innerHTML = `<div class="dialog-toolbar"><span data-dialog-theme-slot></span><button class="close" data-action="close" aria-label="Close dialog">×</button></div><h2 id="dialog-title">${esc(title)}</h2>${onSubmit ? `<form id="modal-form">${content}<div class="error" role="alert"></div><div class="form-actions">${button('close', 'Cancel')}${button('submit', submitLabel, '', 'primary')}</div></form>` : content}`;
  dialog.querySelectorAll('button:not([data-action="submit"])').forEach(b => b.type = 'button');
  const form = dialog.querySelector('form');
  if (form) form.onsubmit = async event => { event.preventDefault(); const b = form.querySelector('[data-action="submit"]'); b.disabled = true; try { await onSubmit(new FormData(form)); dialog.close(); render(); } catch (e) { reportFormError(form, e); b.disabled = false; } };
  if (!dialog.open) dialog.showModal();
}
// Keep download sources alive for the page lifetime: browser save prompts and
// security checks can outlast an arbitrary cleanup timer.
const downloadSources = new Set();
globalThis.addEventListener?.('pagehide', event => {
  if (event.persisted) return;
  for (const url of downloadSources) URL.revokeObjectURL(url);
  downloadSources.clear();
});
function download(name, data, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true;
  downloadSources.add(url);
  document.body.append(link);
  try { link.click(); }
  catch (error) { URL.revokeObjectURL(url); downloadSources.delete(url); throw error; }
  finally { link.remove(); }
}
function csv(name, rows) { download(name, rows.map(r => r.map(v => `"${String(v).replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv'); }
const value = (data, key) => Number(data.get(key));
function openDispatch(id) {
  const o = company().orders.find(x => x.id === id), routes = state.catalog.routes.filter(r => r.enabled);
  if (!routes.length) { modal('No transport routes available', '<p>The instructor has disabled all transport routes. Your order remains open. Ask the instructor to enable a route before dispatching.</p>'); return; }
  if (company().inventory.panel.qty < 1) { modal('No modules available to dispatch', '<p>Your finished-goods inventory is empty. The order remains open. Receive any needed components and produce modules, then return to dispatch.</p>'); return; }
  modal(`Dispatch ${id}`, `<p class="form-note">Original order: ${o.originalQty} modules. Still to dispatch: ${o.remaining}. Stock available: ${company().inventory.panel.qty}. Promised arrival: ${simDate(o.dueAt)}.</p><div class="form-grid">${field('qty', 'Modules to dispatch', Math.min(o.remaining, company().inventory.panel.qty), 'number', `min="1" max="${Math.min(o.remaining, company().inventory.panel.qty)}"`)}${select('routeId', 'Transport route', routes.map(r => [r.id, `${r.name} · ${r.hours} h`]), routes[0]?.id)}</div><div id="dispatch-quote" class="advice"></div><p class="form-note">Each split shipment pays its own fixed fee. Revenue is recognized at customer receipt, with payment ${o.payment} h later.</p>`, data => command({ type: 'dispatch', orderId: id, qty: value(data, 'qty'), routeId: data.get('routeId') }), 'Confirm dispatch');
  const update = () => { const f = new FormData(dialog.querySelector('form')), route = routes.find(r => r.id === f.get('routeId')), qty = value(f, 'qty'); dialog.querySelector('#dispatch-quote').innerHTML = `<strong>${exactMoney(route.fixed + route.unit * qty)} freight ${route.term ? 'due ' + simDate(state.hour + route.term) : 'paid now'} · ${number(route.carbonFixed + route.carbonUnit * qty)} kg CO₂e</strong>Estimated arrival: ${simDate(state.hour + route.hours)}. ${route.reliability}% on time; up to ${route.maxDelay} h carrier delay.${qty < o.remaining ? '<br>Partial dispatch: the unshipped quantity stays open.' : ''}${state.hour + route.hours > o.dueAt ? '<br>Expected late: satisfaction penalty at receipt.' : state.hour + route.hours < o.dueAt - 24 ? '<br>More than 24 h early: small satisfaction penalty at receipt.' : ''}`; };
  dialog.querySelector('form').addEventListener('input', update); update();
}
function sessionSettingsCommand(current, form) {
  const hours = Number(form.get('days')) * 24, rounded = Math.round(hours);
  if (!Number.isFinite(hours) || Math.abs(hours - rounded) > 1e-8) throw new Error('Duration must be a whole number of simulation hours.');
  const speed = Number(form.get('speed'));
  if (!Number.isInteger(speed) || speed < 1 || speed > 120) throw new Error('Choose a clock speed from 1 to 120 seconds per simulation hour.');
  const command = { type: 'configure', studentAccess: form.has('studentAccess'), name: form.get('name'), secondsPerHour: speed };
  // A closed session can end before day one or between days. Saving unrelated
  // settings must preserve that exact end and must not reopen the session.
  if (rounded !== current.endHour) {
    if (rounded < Math.max(24, current.hour) || rounded > 4320) throw new Error('Choose a duration of at least one day, no earlier than the current simulation hour, and at most 180 days.');
    command.endHour = rounded;
  }
  return command;
}
function closeMobileMenu() {
  const toggle = root.querySelector('.mobile-menu-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.closest('.workspace-nav').classList.remove('mobile-menu-open');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && root.querySelector('.mobile-menu-open')) {
    closeMobileMenu();
    root.querySelector('.mobile-menu-toggle')?.focus();
  }
});

async function action(name, id) {
  if (name === 'toggle-mobile-menu') {
    const toggle = root.querySelector('.mobile-menu-toggle');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.closest('.workspace-nav').classList.toggle('mobile-menu-open', open);
    return;
  }
  if (name === 'workspace-tool') closeMobileMenu();
  if (name === 'workspace-tool') {
    const tool = workspaceTools.find(tool => tool.id === id);
    const admin = isTeacher();
    const destinationAction = admin ? 'nav' : 'panel';
    if (tool.channel) {
      channel = workspaceChannel(tool) || 'announcements';
      return action('nav', 'messages');
    }
    if (tool.page) return action('nav', tool.page);
    if (id === 'help') {
      modal('Help', '<p>Hover over an icon or focus it with the keyboard to see what it does. Open a category to choose a tool.</p><div class="workspace-tool-choices">' + button('nav', 'Go to overview', 'overview') + '</div>');
      return;
    }
    const destinations = workspaceDestinations(tool, admin, workspaceFeatureVisible);
    if (destinations.length === 1) return action(destinationAction, destinations[0]);
    if (destinations.length > 1) {
      const choices = destinations.map(key => button(destinationAction, admin ? pages[key] : studentPanels[key][0], key));
      modal(tool.title, `<div class="workspace-tool-choices">${choices.join('')}</div>`);
    }
    return;
  }
  const c = company();
  if (name === 'submit') return;
  if (name === 'profile') { modal('My profile & statistics', '<p><strong>' + esc((user || actor).name) + '</strong></p><p>' + esc((user || actor).role) + '</p><p>' + sessions.length + ' classroom sessions · ' + sessions.filter(s => s.status === 'completed').length + ' completed</p>'); return; }
  if (name === 'copy-session') { const link = new URL(location.href); link.search = ''; link.hash = ''; link.searchParams.set('session', id); try { await navigator.clipboard.writeText(link.href); toast('Session link copied. Sign-in and membership are still required.'); } catch { modal('Copy session link', field('link', 'Select and copy this link', link.href, 'url', 'readonly')); } return; }
  if (name === 'test-leave') { leaveTest(); return; }
  if (testRoom && ['sessions','logout','test-leave'].includes(name)) { leaveTest(); return; }
  if (name === 'test-students' || (testRoom && name === 'roster')) { await testStudents(); return; }
  if (name === 'test-end') { modal('End this test round?', '<p>This discards every test decision and disconnects all test student tabs.</p>', async () => { await testRoom.call('end'); leaveTest(); }, 'End test round'); return; }
  if (testRoom && ['create','join','replay','assign'].includes(name)) throw new Error('This action is unavailable in a temporary test round.');
  if (name === 'session-test') { await startTestSetup(id); return; }
  if (['session-close', 'session-delete', 'sessions-delete'].includes(name)) {
    if (!health?.sessionLifecycle) { modal('Server update needed', '<p>This classroom server needs the session-management update before sessions can be closed or deleted.</p>'); return; }
    const deleting = name !== 'session-close', targets = name === 'sessions-delete' ? sessions.filter(s => s.status !== 'completed') : sessions.filter(s => s.id === id);
    const completed = new Set();
    modal(deleting ? 'Delete sessions?' : 'Close session?', '<p>' + (deleting ? 'Remove these sessions from everyone’s list and revoke access. Stored records are retained on the server; this does not permanently erase data. Export anything you need first.' : 'Stop the clock and move this session to Past sessions. Students lose access to this session. Results remain available to instructors. Extend its duration in settings to resume.') + '</p><ul>' + targets.map(s => '<li>' + esc(s.name) + '</li>').join('') + '</ul>' + (deleting ? field('confirmation', 'Type DELETE to confirm', '', 'text', 'pattern="DELETE" autocomplete="off"') : ''), async f => {
      if (deleting && f.get('confirmation') !== 'DELETE') throw new Error('Type DELETE to confirm.');
      try { for (const target of targets) { if (completed.has(target.id)) continue; await lifecycleRequest(target.id, deleting ? 'deleteSession' : 'closeSession'); completed.add(target.id); } }
      catch (error) { await enter(); throw new Error(completed.size + ' of ' + targets.length + ' sessions updated. ' + error.message + ' Retry to update only the remaining sessions.'); }
      await enter(); toast(completed.size + (deleting ? ' sessions deleted.' : ' session closed.'));
    }, deleting ? 'Delete sessions' : 'Close session'); return;
  }
  if (name === 'session-export') {
    const data = await api('/sessions/' + encodeURIComponent(id) + '/replay');
    download('session-' + id + '.json', data);
    toast('JSON download requested.');
    return;
  }
  if (name === 'open-session' || name === 'session-codes') { selectSession(id); page = 'admin'; await enter(); if (name === 'session-codes') await action('roster'); return; }
  if (name === 'sessions') { solo = null; selectSession(null); await enter(); return; }
  if (name === 'retry-start') { await startWorkspace(); return; }
  if (name === 'forget-server') { backend = localWorkspace ? '' : classroomBackend; localStorage.removeItem('studio-backend'); health = null; state = null; try { health = await api('/health'); } catch {} if (firebaseClient?.user) await enterFirebase(); else renderWelcome(); return; }
  if (name === 'retry-decision') { const pending = JSON.parse(sessionStorage.getItem(`studio-pending:${backend}:${actor.id}:${sessionId}`) || 'null'); if (pending) await command(pending.command); render(); return; }
  if (name === 'close') { dialog.close(); if (state) render(); return; }
  const shortcut = name === 'nav' && !isTeacher() && (id === 'supply' ? 'inventory' : Object.hasOwn(studentPanels, id) && id);
  if (shortcut) id = shortcut;
  if (shortcut || name === 'panel' || name === 'close-panel') {
    if (isTeacher() || !Object.hasOwn(studentPanels, id)) return;
    if (name === 'close-panel' || (name === 'panel' && page === 'workspace' && openPanels.has(id))) openPanels.delete(id);
    else openPanels.add(id);
    page = 'workspace';
    render();
    (root.querySelector('#pane-' + id) || root.querySelector('.page-heading h1'))?.focus();
    return;
  }
  if (name === 'nav') { page = id; if (id === 'admin' && preview) { preview = undefined; await load(); } else render(); return; }
  if (name === 'solo') { solo = (await import('./src/solo.mjs?v=5366cc14c565')).soloAdapter(); sessionId = 'solo'; page = 'overview'; preview = undefined; await load(); return; }
  if (name === 'switch-solo') { solo.switchRole(isTeacher() ? 'student' : 'instructor'); preview = undefined; page = isTeacher() ? 'overview' : 'admin'; await load(); return; }
  if (name === 'demo') { await signIn(await api('/demo', { username: id })); return; }
  if (name === 'logout') { if (!solo && token) { try { await api('/logout', {}); } catch {} } if (firebaseClient?.user) await firebaseClient.logout(); solo = null; state = null; actor = null; user = null; token = ''; sessionId = null; sessionStorage.removeItem('studio-token'); selectSession(null); renderWelcome(); return; }
  if (name === 'google-signin') { const auth = await getFirebase(); await auth.google(); await enterFirebase(); return; }
  if (name === 'firebase-refresh') { await firebaseClient.refresh(); await enterFirebase(); return; }
  if (name === 'firebase-verify') { await firebaseClient.verify(); toast('Verification email sent.'); return; }
  if (name === 'reset-password') { modal('Reset your password', field('email', 'Account email', '', 'email'), async f => { await (await getFirebase()).reset(f.get('email')); toast('If the account exists, Firebase will email password-reset instructions.'); }, 'Send reset email'); return; }
  if (name === 'preview') { preview = id; page = 'overview'; await load(); return; }
  if (name === 'offer') {
    const o = c.offers.find(x => x.id === id);
    modal('Edit sales offer', `<div class="form-grid">${field('price', 'Price per module (EUR)', o.price / 100, 'number', 'min="50" max="10000" step="0.01"')}${field('delivery', 'Delivery promise (hours)', o.delivery, 'number', 'min="6" max="720"')}${field('min', 'Minimum quantity', o.min, 'number', 'min="1"')}${field('max', 'Maximum quantity', o.max, 'number', 'min="1"')}${field('payment', 'Payment after receipt (hours)', o.payment, 'number', 'min="0" max="720"')}${check('enabled', 'Offer active', o.enabled)}</div>`, f => command({ type: 'offer', offerId: id, price: Math.round(value(f, 'price') * 100), delivery: value(f, 'delivery'), min: value(f, 'min'), max: value(f, 'max'), payment: value(f, 'payment'), enabled: f.has('enabled') }), 'Save offer');
  }
  if (name === 'dispatch') openDispatch(id);
  if (name === 'purchase') {
    const sup = state.catalog.suppliers.find(x => x.id === id);
    modal(`Order ${itemName(state, sup.item)}`, `<p class="form-note">${esc(sup.name)} · ${exactMoney(sup.price)} per unit + ${exactMoney(sup.fee)} order fee. Estimated receipt ${simDate(state.hour + sup.lead)}; payment ${sup.term} h after actual receipt. Minimum ${sup.min}; lots of ${sup.lot}.</p>${field('qty', 'Quantity', sup.min, 'number', `min="${sup.min}" max="${sup.stock}" step="${sup.lot}"`)}<div id="purchase-quote" class="advice"></div>`, f => command({ type: 'purchase', supplierId: id, qty: value(f, 'qty') }), 'Place purchase');
    const update = () => { const qty = Number(dialog.querySelector('[name=qty]').value); dialog.querySelector('#purchase-quote').textContent = `${exactMoney(qty * sup.price + sup.fee)} committed payable · ${number(qty * (sup.carbon + sup.freight))} kg CO₂e. Cash is paid after receipt, not now.`; }; dialog.querySelector('form').addEventListener('input', update); update();
  }
  if (name === 'staff') modal('Change staffing', `<p class="form-note">${c.workers} current workers. Enter a positive number to recruit or negative to reduce. Recruitment costs €250 per worker; severance €500. Effective in 48 h.</p>${field('delta', 'Change in workers', 1, 'number', 'min="-20" max="20"')}`, f => command({ type: 'staff', delta: value(f, 'delta') }));
  if (name === 'annuity') modal('Request annuity loan', '<p class="form-note">Funding in 48 simulation hours. The first weekly payment is due one week after the request. Annual interest is 8%.</p>' + field('amount', 'Principal (EUR)', 10000, 'number', 'min="1000" max="150000" step="0.01"') + field('weeks', 'Term (weeks)', 2, 'number', 'min="1" max="20"'), f => command({ type: 'loan', plan: 'annuity', repaymentAnchor: 'request', amount: Math.round(value(f, 'amount') * 100), weeks: value(f, 'weeks') }));
  if (name === 'loan') modal('Request bullet loan', '<p class="form-note">Funds arrive in 24 simulation hours. Principal and 9% simple annual interest are repaid at maturity.</p>' + field('amount', 'Principal (EUR)', 10000, 'number', 'min="1000" max="150000" step="0.01"') + field('days', 'Term (days)', 7, 'number', 'min="7" max="90"'), f => command({ type: 'loan', amount: Math.round(value(f, 'amount') * 100), term: value(f, 'days') * 24 }));
  if (name === 'deposit') modal('Place term deposit', '<p class="form-note">Cash is deducted immediately. Principal and 4% simple annual interest return at maturity.</p>' + field('amount', 'Principal (EUR)', 1000, 'number', 'min="100" max="100000" step="0.01"') + field('weeks', 'Term (weeks)', 1, 'number', 'min="1" max="26"'), f => command({ type: 'deposit', amount: Math.round(value(f, 'amount') * 100), weeks: value(f, 'weeks') }));
  if (name === 'invest') { const inv = INVESTMENTS[id]; modal(inv.name, `<p>${money(inv.cost)} is prepaid now. The investment becomes operational after ${inv.delay} simulation hours, at ${simDate(state.hour + inv.delay)}.</p><p class="form-note">This accepted contract will remain pending if the session ends before activation.</p>`, () => command({ type: 'invest', kind: id }), 'Confirm investment'); }
  if (name === 'energy-switch') { const e = state.catalog.energy.find(x => x.id === id); modal(`Switch to ${e.name}`, `<p>Agreement fee ${money(e.fee)} paid now. Switch effective at ${simDate(state.hour + e.delay)}. Standing charge ${exactMoney(e.daily)} per day. Existing inventory retains its original footprint.</p>`, () => command({ type: 'energy', energyId: id }), 'Confirm switch'); }
  if (name === 'budget') modal('Daily research & marketing', `<div class="form-grid">${field('research', 'Research (EUR per day)', c.research / 100, 'number', 'min="0" max="1000" step="0.01"')}${field('marketing', 'Marketing (EUR per day)', c.marketing / 100, 'number', 'min="0" max="1000" step="0.01"')}</div><p class="form-note">Costs recur at every daily close. Quality grows with the square root of research spending; marketing changes the demand score.</p>`, f => command({ type: 'budget', research: Math.round(value(f, 'research') * 100), marketing: Math.round(value(f, 'marketing') * 100) }));
  if (name === 'reorder') { const policy = c.reorder[id]; modal(`Replenishment · ${itemName(state, id)}`, `${select('supplierId', 'Preferred supplier', state.catalog.suppliers.filter(s => s.item === id && s.enabled).map(s => [s.id, `${s.name} · lot ${s.lot}`]), policy?.supplierId)}<div class="form-grid">${field('point', 'Reorder point (stock + incoming)', policy?.point || (id === 'cell' ? 6000 : 250), 'number', 'min="0"')}${field('qty', 'Quantity per order', policy?.qty || (id === 'cell' ? 7200 : 300), 'number', 'min="1"')}</div>${check('enabled', 'Enable this policy', policy?.enabled ?? true)}<p class="form-note">Only runs after the replenishment investment is active. The assistant reports blocked orders and retries hourly.</p>`, f => command({ type: 'reorder', supplierId: f.get('supplierId'), point: value(f, 'point'), qty: value(f, 'qty'), enabled: f.has('enabled') })); }
  if (name === 'step') { if (id === 'custom') modal('Advance the simulation', field('hours', 'Hours to advance (1–168)', 24, 'number', 'min="1" max="168"'), f => command({ type: 'step', hours: value(f, 'hours') }), 'Advance'); else { await command({ type: 'step', hours: Number(id) }); render(); } }
  if (name === 'clock') { await command({ type: 'clock', status: id }); render(); }
  if (name === 'settings') modal('Session settings', `${check('studentAccess', 'Open session to students', state.studentAccess !== false)}${field('name', 'Session name', state.name, 'text', 'maxlength="120"')}<div class="form-grid">${field('days', 'Total duration from start (days)', state.endHour / 24, 'number', `min="${Math.min(state.endHour, Math.max(24, state.hour)) / 24}" max="180" step="any"`)}${field('speed', 'Real seconds per simulation hour', state.secondsPerHour, 'number', 'min="1" max="120"')}</div>`, async f => { if (!solo && !testRoom && !health?.atomicSessionSettings) throw new Error('The classroom backend needs the Settings update before changes can be saved.'); await command(sessionSettingsCommand(state, f)); }, 'Save settings');
  if (name === 'events') modal('Pending & completed outcomes', table(['Company', 'Outcome', 'Scheduled time', 'State'], state.events.filter(e => !c || e.companyId === c.id).slice().sort((a, b) => a.at - b.at).map(e => [esc(state.companies.find(c => c.id === e.companyId)?.name), esc(e.description), simDate(e.at), esc(e.blocked || e.status)])));
  if (name === 'create') modal('Create a classroom session', createSessionFields(), createClassroom, 'Create session');
  if (name === 'join') { selectSession(null); renderLobby(); return; }
  if (name === 'roster') { roster = await api(`/sessions/${sessionId}/roster`); modal('Companies & join codes', `<p class="form-note">Share each code with that company’s students. Codes do not grant instructor access.</p>${table(['Company', 'Student join code', ''], roster.invites.map(i => [esc(state.companies.find(c => c.id === i.companyId)?.name), `<code>${esc(i.code)}</code>`, button('rename', 'Rename', i.companyId, 'small')]))}${table(['Participant', 'Company', ''], roster.members.filter(u => u.role === 'student').map(u => [esc(u.name), esc(state.companies.find(c => c.id === u.companyId)?.name), button('assign', 'Reassign', u.id, 'small')]))}`); }
  if (name === 'rename') modal('Rename company', field('name', 'Company name', state.companies.find(c => c.id === id).name, 'text', 'maxlength="60"'), f => command({ type: 'renameCompany', companyId: id, name: f.get('name') }));
  if (name === 'assign') modal('Assign student to a company', `<p class="form-note">Previous team and peer channels will no longer be accessible. Membership is checked on each request.</p>${select('companyId', 'Company', state.companies.map(c => [c.id, c.name]), roster.members.find(u => u.id === id)?.companyId)}`, async f => { await api(`/sessions/${sessionId}/assign`, { userId: id, companyId: f.get('companyId') }); await load(false); });
  if (name === 'catalog-list') modal(`${id.charAt(0).toUpperCase() + id.slice(1)} catalogue`, table(['Name', 'State', ''], state.catalog[id].map(x => [esc(x.name), x.enabled ? 'Enabled' : 'Disabled', button('catalog-edit', 'Edit', `${id}:${x.id}`, 'small')])));
  if (name === 'catalog-edit') { const [collection, rowId] = id.split(':'), row = state.catalog[collection].find(x => x.id === rowId), fields = { suppliers: ['price', 'stock', 'replenish', 'lead', 'term', 'reliability'], routes: ['hours', 'fixed', 'unit', 'term', 'reliability'], markets: ['volume', 'referencePrice', 'greenWeight'], energy: ['fee', 'daily', 'delay'] }[collection]; modal(row.name, `<p class="form-note">Money fields are integer cents; time fields are hours; reliability and green weight are percent; stock and volume are units. Changes affect future contracts.</p><div class="form-grid">${fields.map(k => field(k, ({ price: 'Unit price (cents)', fixed: 'Fixed freight (cents)', unit: 'Freight / unit (cents)', referencePrice: 'Reference price (cents)', fee: 'Switch fee (cents)', daily: 'Standing charge (cents/day)', volume: 'Demand / 6-hour cycle', greenWeight: 'Carbon preference (%)', stock: 'Available stock', replenish: 'Daily replenishment', lead: 'Lead time (hours)', term: 'Payment term (hours)', hours: 'Transit (hours)', delay: 'Switch delay (hours)', reliability: 'On-time probability (%)' })[k], (row[k] ?? 0), 'number', 'min="0"')).join('')}${check('enabled', 'Enabled', row.enabled)}</div>`, f => command({ type: 'catalog', collection, id: rowId, patch: { ...Object.fromEntries(fields.map(k => [k, value(f, k)])), enabled: f.has('enabled') } })); }
  if (name === 'replay') download('simulation-replay.json', await api(`/sessions/${sessionId}/replay`));
  if (name === 'report-csv') csv('daily-report.csv', [['Simulation time (UTC)', 'Company', `${reportTypes[report][0]} (${reportTypes[report][1]})`], ...reportRows(state.snapshots.filter(s => s.hour >= state.hour - reportRange * 24))]);
  if (name === 'ledger-csv') csv('transaction-journal.csv', [['Hour', 'Simulation time (UTC)', 'Transaction', 'Account', 'Debit positive / credit negative (EUR)'], ...c.ledger.flatMap(l => Object.entries(l.lines).map(([a, n]) => [l.hour, simDate(l.hour), l.description, a, n / 100]))]);
}
// Native disclosure supports Enter/Space and Tab; arrows add a quick shortcut.
document.addEventListener('keydown', event => {
  const menu = event.target.closest?.('.account-menu');
  if (!menu) return;
  const summary = menu.querySelector('summary');
  if (event.key === 'Escape' && menu.open) {
    event.preventDefault(); menu.open = false; summary.focus(); return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (!menu.open && event.target !== summary) return;
  event.preventDefault(); menu.open = true;
  const items = [...menu.querySelectorAll('button:not(:disabled)')];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowDown' ? (index + 1) % items.length
    : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length);
  items[next].focus();
});
document.addEventListener('focusin', event => {
  document.querySelectorAll('.account-menu[open]').forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('click', event => {
  document.querySelectorAll('.account-menu[open]').forEach(menu => {
    const action = event.target.closest('button');
    if (!menu.contains(event.target)) menu.open = false;
    else if (action && !action.disabled) { menu.open = false; menu.querySelector('summary').focus(); }
  });
});
document.addEventListener('click', async event => {
  const b = event.target.closest('[data-action]'); if (!b || b.disabled || b.dataset.action === 'submit') return;
  event.preventDefault();
  if (b.getAttribute('aria-disabled') === 'true') return;
  const workspaceChoice = b.closest('.workspace-tool-choices');
  if (workspaceChoice) dialog.close();
  b.disabled = true; b.setAttribute('aria-busy', 'true');
  try {
    await action(b.dataset.action, b.dataset.id);
    if (b.dataset.action !== 'toggle-mobile-menu' && !dialog.open && page !== 'workspace' && (workspaceChoice || b.closest('.workspace-nav'))) root.querySelector('.page-heading h1')?.focus();
  } catch (e) { toast(e.message); } finally { b.disabled = false; b.removeAttribute('aria-busy'); }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (form.id === 'modal-form') return;
  event.preventDefault(); submittingForms.add(form); const f = new FormData(form), submit = form.querySelector('[data-action="submit"]'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'session-entry-form') {
      const requested = String(f.get('sessionId') || '').trim();
      const result = await api('/enter', { sessionId: requested, code: f.get('code') || undefined });
      if (result.requiresCompanyCode) { renderLobby('', requested, true); return; }
      selectSession(result.sessionId); await enter();
    }
    if (form.id === 'create-session-form') await createClassroom(f);
    if (form.id === 'login-form') await signIn(await api('/login', Object.fromEntries(f)));
    if (form.id === 'register-form') await signIn(await api('/register', Object.fromEntries(f)));
    if (form.id === 'firebase-login-form') { await (await getFirebase()).login(f.get('email'), f.get('password')); await enterFirebase(); }
    if (form.id === 'firebase-register-form') { await (await getFirebase()).register(f.get('name'), f.get('email'), f.get('password')); await enterFirebase(); }
    if (form.id === 'backend-form') await connectBackend(f.get('backend'));
    if (form.id === 'shifts-form') { await command({ type: 'shifts', shifts: [0, 1, 2].map(i => f.has(`shift${i}`)) }); render(); }
    if (form.id === 'effects-form') { await command({ type: 'configure', carbonDemand: f.has('carbonDemand') }); render(); }
    if (form.dataset.feature) { await command({ type: 'configure', feature: form.dataset.feature, visible: f.has('visible'), allowed: f.has('allowed') }); render(); }
    if (form.id === 'message-form') { await command({ type: 'message', channel, text: f.get('text') }); render(); }
  } catch (e) { reportFormError(form, e); }
  finally { submittingForms.delete(form); if (submit) submit.disabled = false; }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.name === 'sessionCity') {
    const label = target.form.querySelector('[data-custom-session]');
    const input = label.querySelector('input'), custom = target.value === 'custom';
    label.hidden = !custom; input.disabled = !custom; input.required = custom;
    if (custom) input.focus();
    return;
  }
  try {
    if (target.name === 'stock-finished' || target.name === 'stock-component') {
      const category = target.name.slice(6);
      if (target.checked) inventoryCategories.add(category);
      else inventoryCategories.delete(category);
      render();
      root.querySelector('[name="' + target.name + '"]')?.focus();
    }
    if (target.name === 'preview') { preview = target.value || undefined; page = 'overview'; await load(); }
    if (target.name === 'report') { report = target.value; render(); }
    if (target.name === 'range') { reportRange = Number(target.value); render(); }
    if (target.name === 'channel') { channel = target.value; render(); }
    if (target.name?.startsWith('series-')) { if (!selectedCompanies.size) selectedCompanies = new Set(state.companies.map(c => c.id)); if (target.checked) selectedCompanies.add(target.name.slice(7)); else selectedCompanies.delete(target.name.slice(7)); if (!selectedCompanies.size) { selectedCompanies.add(target.name.slice(7)); toast('Keep at least one company selected to display the report.'); } render(); }
  } catch (e) { toast(e.message); }
});
async function startWorkspace() {
  if (location.hash?.startsWith('#test=')) {
    const testLink = new URLSearchParams(location.hash.slice(1));
    try { const client = (await import('./src/test-client.mjs?v=5366cc14c565')).testClient({roomId:testLink.get('test'),key:testLink.get('key')}); await enterTest(client); }
    catch(e) { root.innerHTML = '<main class="welcome"><h1>Test round unavailable</h1><p>' + esc(e.message) + '</p>' + button('test-leave','Return to classroom') + '</main>'; }
    return;
  }
  // Restore authentication alongside discovery; never paint a speculative login.
  const authReady = localWorkspace ? null : getFirebase().then(value => ({ value }), error => ({ error }));
  try {
    try { health = await api('/health'); } catch (error) {
      if (token || !localWorkspace) throw error;
      health = null;
    }
    if (!health || health.auth === 'firebase') {
      const restored = authReady ? await authReady : { value: await getFirebase() };
      if (restored.error) throw restored.error;
      if (restored.value.user) await enterFirebase();
      else renderWelcome();
    } else if (token) {
      try { await enter(); } catch (error) {
        if (error.status !== 401) throw error;
        token = ''; sessionStorage.removeItem('studio-token'); renderWelcome();
      }
    } else renderWelcome();
  } catch (error) {
    root.innerHTML = `<main class="welcome" id="content">${brand}<section class="panel" role="alert"><h1>Workspace temporarily unavailable</h1><p>We could not restore your workspace. Your sign-in has been kept. Check your connection and try again.</p>${button('retry-start', 'Try again', '', 'primary')}</section></main>`;
  }
}
await startWorkspace();
setInterval(() => { if (!solo && state && !busy && !pendingLoads && !document.hidden) load(false); }, 3000);

window.addEventListener('popstate', () => { if (user && !solo) enter().catch(e => toast(e.message)); });

// Suspended browser tabs resync as soon as they become visible again.
document.addEventListener('visibilitychange', () => {
  if (!solo && sessionId && !document.hidden) void load(false);
});
