import { operationalReports, buildOperationalReport, businessUpdates } from './src/operational-reports.mjs?v=4651dc6dd6e7';
import { createMessageSounds } from './src/message-sounds.mjs?v=4651dc6dd6e7';
import { catalog, itemName, productionRecipe, inventoryStatementValues, INVESTMENTS, FEATURES } from './src/engine.mjs?v=4651dc6dd6e7';
import { firebaseConfig, classroomBackend } from './firebase-config.mjs?v=4651dc6dd6e7';
import { watchSession } from './src/session-updates.mjs?v=4651dc6dd6e7';
const root = document.querySelector('#app'), dialog = document.querySelector('#dialog');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format((n || 0) / 100);
const exactMoney = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format((n || 0) / 100);
const number = n => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n || 0);
const precise = n => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(n || 0);
const total = (list, key) => list.reduce((sum, x) => sum + (x[key] || 0), 0);
const icon = (name, graphic) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${graphic || ({ overview: '<path d="M3 10 12 3l9 7v11h-7v-7h-4v7H3Z"/>', orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>', supply: '<path d="m3 7 9-4 9 4v11l-9 4-9-4ZM3 7l9 5 9-5M12 12v10"/>', production: '<path d="M3 21V10l6 4V8l6 5V3h5v18ZM7 18h1m4 0h1m4 0h1"/>', finance: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 5h6"/>', energy: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>', reports: '<path d="M4 20V12h4v8m4 0V4h4v16m4 0v-9M2 21h20"/>', messages: '<path d="M4 4h16v12H9l-5 5Z"/><path d="M8 8h8m-8 4h5"/>', admin: '<circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 3-1 1 5-3 2 1 3 1 2-4 4-3-2-3 1-2 1-4-4 2-3-1-3-1-2 4-4Z"/>' })[name] || '<path d="M12 3v18M3 12h18"/>'}</svg>`;
const brand = `<div class="brand"><img class="brand-mark" src="sscm-circle.svg" width="40" height="40" alt=""><span>Sustainable Supply Chain <small>Management</small></span></div>`;
const localWorkspace = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const savedBackend = localStorage.getItem('studio-backend') || '';
// Old loopback testing preferences must not strand returning public-site users.
let backend = localWorkspace ? savedBackend : (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(savedBackend) ? classroomBackend : savedBackend || classroomBackend), token = sessionStorage.getItem('studio-token') || '';
let state, actor, user, sessions = [], sessionId, preview, page = 'overview', channel = 'all', report = 'profit', reportRange = 30, selectedCompanies = new Set(), solo = null, health = null, roster = null, busy = false, online = true, firebaseClient = null;
let testRoom = null, testPending = null;
let testAccessClosed = false;
const connectionMessage = 'Connection interrupted. Displayed classroom data may be out of date. Reconnecting… Pending decisions are never submitted automatically.';
function connectionScope() { return JSON.stringify([backend, sessionId, user?.id, firebaseClient?.user?.uid, !!testRoom, !!solo]); }
function updateConnectionNotice() {
  const notice = document.querySelector('#connection');
  if (!notice) return;
  const show = !online && !!state && !solo && !testRoom;
  notice.hidden = !show;
  notice.textContent = show ? connectionMessage : '';
}
function connectionNotice() {
  return solo || testRoom ? '' : `<div id="connection" class="advice warning" role="status" aria-live="polite" aria-atomic="true" ${online ? 'hidden' : ''}>${online ? '' : connectionMessage}</div>`;
}
function connectionLost() {
  if (!state || solo || testRoom) return;
  ++loadSequence; // A response begun before this event cannot announce recovery.
  online = false; updateConnectionNotice();
}
function connectionRestored() {
  if (!state || solo || testRoom) return;
  // Browser reachability is only a hint. Confirm the classroom with a fresh GET.
  online = false; updateConnectionNotice();
  void refreshInBackground();
}
function showTestAccessClosed() {
  ++loadSequence;
  state = null; actor = null; roster = null; testAccessClosed = true;
  if (dialog.open) dialog.close();
  root.innerHTML = '<main class="welcome" id="content"><h1>Test classroom access is closed</h1><p>Your instructor has closed access to this test round. Decisions are blocked. You can return when access reopens.</p>' + button('test-retry', 'Try again', '', 'primary') + button('test-leave', 'Leave test') + '</main>';
}
let messageSounds;
function sounds() { return messageSounds ||= createMessageSounds(); }
function observeMessageSounds(view) {
  const scope = JSON.stringify([connectionScope(), view.actor?.id, view.actor?.companyId, preview]);
  sounds().observe(scope, view.state.messages, view.actor?.id);
}
function soundControl() { return `<button type="button" class="small" data-action="message-sounds" aria-pressed="${sounds().enabled}" aria-label="Message sounds">Sound: ${sounds().enabled ? 'on' : 'off'}</button>`; }
document.addEventListener('pointerdown', () => sounds().arm(), { passive: true });
document.addEventListener('keydown', () => sounds().arm(), { passive: true });
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
  const scope = connectionScope();
  if (liveSession?.id === sessionId && liveSession.scope === scope) return;
  stopSessionUpdates();
  const id = sessionId;
  const current = () => liveSession?.id === id && liveSession.scope === scope && connectionScope() === scope;
  const watch = watchSession({
    url: `${backend}/api/sessions/${encodeURIComponent(id)}/updates`, revision: state.revision,
    token: () => firebaseClient.token(),
    changed: () => current() ? refreshInBackground() : undefined,
    closed: () => { if (current()) clearClosedSession(); }
  });
  liveSession = { id, scope, watch };
}
const submittingForms = new Set();
let loadSequence = 0, pendingLoads = 0;
let backgroundRefresh = null, refreshDeferred = false;
const loadWaiters = new Set();
function refreshInBackground() {
  if (solo || !sessionId) return Promise.resolve();
  const matches = job => job.id === sessionId && job.preview === preview && job.backend === backend && job.scope === connectionScope();
  if (backgroundRefresh && matches(backgroundRefresh)) { backgroundRefresh.again = true; return backgroundRefresh.task; }
  const job = {id:sessionId, preview, backend, scope:connectionScope(), again:true};
  backgroundRefresh = job;
  job.task = (async () => {
    // Let callers in the same event turn share this task before starting a read.
    await Promise.resolve();
    try {
      while (job.again && matches(job) && !solo) {
        if (pendingLoads) await new Promise(resolve => loadWaiters.add(resolve));
        if (!matches(job) || solo) break;
        job.again = false;
        await load(false);
      }
    } finally { if (backgroundRefresh === job) backgroundRefresh = null; }
  })();
  return job.task;
}
function needsBackgroundPoll() {
  if (solo || !state || busy || pendingLoads || document.hidden) return false;
  // Running views drive authoritative clock catch-up. A healthy subscription
  // already reports paused changes; offline and deferred drafts need a retry.
  const draftClosed = !submittingForms.size && !dialog.open && !document.activeElement?.closest('form');
  return state.status === 'running' || !online || (refreshDeferred && draftClosed) || liveSession?.id !== sessionId || !liveSession?.watch.healthy;
}
const isTeacher = () => actor?.role === 'instructor';
const company = () => state?.company;
const simDate = hour => { const date = new Date(Date.parse(state?.startDate || '2026-01-01T00:00:00Z') + hour * 3600000); return date.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).replace(/(\d)\s+(am|pm)/i, '$1$2'); };
function shiftIndicator() {
  const shift = Math.floor((state.hour % 24) / 8), c = company();
  const labels = ['Night · 12am–8am', 'Day · 8am–4pm', 'Evening · 4pm–12am'];
  const graphic = shift === 1 ? '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>' : shift === 0 ? '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>' : '<path d="M3 17h18M5 14a7 7 0 0 1 14 0M12 2v3M3 5l2 2m16-2-2 2M5 21h14"/>';
  return `<div class="shift-indicator">${icon('time', graphic)}<span>${labels[shift]}</span></div>${c ? `<small class="shift-status ${c.shifts[shift] ? 'shift-on' : ''}">${c.shifts[shift] ? `Shift on · ${number(c.workers)} workers scheduled` : 'Shift off · workers not scheduled'}</small>` : ''}`;
}
const field = (name, label, value, type = 'number', extra = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
const check = (name, label, on, disabled = false) => `<label class="check"><input name="${esc(name)}" type="checkbox" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</label>`;
const select = (name, label, options, value) => `<label>${esc(label)}<select name="${esc(name)}">${options.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const button = (action, text, id = '', cls = '', disabled = false) => `<button class="${cls}" data-action="${action}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${text}</button>`;
// Sorting is a view preference. Never reorder simulation arrays or submit a command.
const tableSorts = new Map();
const sortCell = (html, value) => ({ html, value });
const sortText = html => String(html ?? '').replace(/<small\b[\s\S]*$/i, '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]).trim();
const cellSortValue = cell => cell && typeof cell === 'object' ? cell.value : typeof cell === 'number' ? cell : sortText(cell);
const cellHTML = cell => cell && typeof cell === 'object' ? cell.html : cell;
function compareTableValues(a, b, direction) {
  const missing = value => value == null || value === '' || value === '—' || (typeof value === 'number' && !Number.isFinite(value));
  if (missing(a) || missing(b)) return Number(missing(a)) - Number(missing(b));
  const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  return direction === 'descending' ? -compared : compared;
}
function nextTableSort(current, column) {
  return current?.column !== column ? { column, direction: 'descending' } : current.direction === 'descending' ? { column, direction: 'ascending' } : null;
}
const tableSortHints = {
  'Order / market': 'order creation time', 'Latest order': 'order creation time',
  'Supplier / item': 'supplier name', 'Amount / capacity': 'stock on hand',
  'Quantity band': 'minimum quantity', 'Lead / payment': 'lead time',
  'Component / freight CO₂e': 'component carbon per unit', 'Available / lot': 'available stock',
  'Transport CO₂e': 'fixed carbon per shipment', '12am–8am / 8am–4pm / 4pm–12am': '00–08 tariff',
  'Switch fee / delay': 'switch fee', 'Simulation / real time': 'simulation time',
  'Postings': 'first listed account name', 'Delivery': 'delivery quantity',
  'Completion': 'actual completion time, or scheduled deposit maturity',
  'Funding / placement': 'actual funding or placement time'
};
function tableSortHelp(label, current, column) {
  const next = nextTableSort(current, column);
  return `${label}${tableSortHints[label] ? ` (sort by ${tableSortHints[label]})` : ''}. ${next ? `Click to sort ${next.direction === 'descending' ? 'decreasing' : 'increasing'}` : 'Click to restore original order'}.`;
}
function tableKey(headers, id = '') {
  return JSON.stringify([backend, state?.id || sessionId, actor?.id, preview || '', id || headers]);
}
function tableCell(content, label, attributes = '') {
  return `<td${attributes}><span class="table-cell-label" aria-hidden="true">${esc(label)}</span><div class="table-cell-value">${content}</div></td>`;
}
function table(headers, rows, empty = 'Nothing here yet.', id = '') {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  const key = tableKey(headers, id), current = tableSorts.get(key);
  const ordered = rows.map((cells, index) => ({ cells, index }));
  if (current) ordered.sort((a, b) => compareTableValues(cellSortValue(a.cells[current.column]), cellSortValue(b.cells[current.column]), current.direction) || a.index - b.index);
  return `<div class="table-wrap" data-view-key="${esc('table:' + (id || JSON.stringify(headers)))}"><table data-sort-table="${esc(key)}" class="responsive-table" role="table"><thead><tr>${headers.map((h, column) => {
    if (!h) return '<th scope="col"></th>';
    const label = sortText(h), active = current?.column === column;
    return `<th scope="col" class="sortable-heading"${active ? ` aria-sort="${current.direction}"` : ''}><button type="button" class="table-sort" data-view-key="sort-header:${column}" data-table-sort="${column}" data-sort-label="${esc(label)}" title="${esc(tableSortHelp(label, current, column))}" aria-label="${esc(tableSortHelp(label, current, column))}"><span>${h}</span><span class="table-sort-icon" aria-hidden="true">${active ? current.direction === 'descending' ? '▼' : '▲' : ''}</span></button></th>`;
  }).join('')}</tr></thead><tbody>${ordered.map(({ cells, index }) => `<tr data-sort-original="${index}">${cells.map((cell, column) => tableCell(cellHTML(cell), sortText(headers[column] || ''), ` data-sort-value="${esc(JSON.stringify(cellSortValue(cell) ?? null))}"`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function sortTable(button) {
  const element = button.closest('table'), key = element.dataset.sortTable;
  const current = nextTableSort(tableSorts.get(key), Number(button.dataset.tableSort));
  if (current) tableSorts.set(key, current); else tableSorts.delete(key);
  if (element.closest?.('[data-operational-report]')) { render(); return; }
  const body = element.tBodies[0], rows = Array.from(body.rows);
  rows.sort((a, b) => (current ? compareTableValues(JSON.parse(a.cells[current.column].dataset.sortValue), JSON.parse(b.cells[current.column].dataset.sortValue), current.direction) : 0) || Number(a.dataset.sortOriginal) - Number(b.dataset.sortOriginal));
  body.append(...rows);
  element.querySelectorAll('[data-table-sort]').forEach(control => {
    const column = Number(control.dataset.tableSort), active = current?.column === column, heading = control.closest('th');
    if (active) heading.setAttribute('aria-sort', current.direction); else heading.removeAttribute('aria-sort');
    control.querySelector('.table-sort-icon').textContent = active ? current.direction === 'descending' ? '▼' : '▲' : '';
    const help = tableSortHelp(control.dataset.sortLabel, current, column);
    control.title = help; control.setAttribute('aria-label', help);
  });
}
const panel = (title, subtitle, body, action = '') => `<section class="panel" data-view-key="${esc('panel:' + title)}">${title || subtitle || action ? `<div class="panel-head"><div>${title ? `<h2>${title}</h2>` : ''}${subtitle ? `<p>${subtitle}</p>` : ''}</div>${action}</div>` : ''}${body}</section>`;
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
  const scope = connectionScope(), requestSequence = loadSequence;
  if (firebaseClient?.user && health?.auth === 'firebase' && path !== '/health') token = await firebaseClient.token();
  let response;
  try { response = await fetch(`${backend}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token && path !== '/health' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); }
  catch {
    if (scope === connectionScope() && requestSequence === loadSequence) { online = false; updateConnectionNotice(); }
    throw new Error('Connection interrupted. We could not confirm a response from the classroom. Check your connection and try again. If you submitted a decision, retry that same decision to confirm its outcome safely.');
  }
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status }); return result;
}
async function connectBackend(input) {
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use an HTTPS server origin, or HTTP on localhost, without credentials, a path, or query parameters.');
  const previous = backend; backend = url.origin;
  try {
    const result = await api('/health');
    if (result.ok !== true || (result.auth === 'firebase' && result.projectId !== firebaseConfig.projectId)) throw new Error('This is not a compatible Sustainable Supply Chain Management server.');
    health = result; localStorage.setItem('studio-backend', backend); token = ''; sessionStorage.removeItem('studio-token');
  } catch (e) { backend = previous; throw e; }
  if (firebaseClient?.user && health.auth === 'firebase') await enterFirebase(); else renderWelcome();
}
async function load(force = true, afterCommand = false) {
  if (solo) { ({ state, actor } = solo.view(preview)); if (force) render(); return; }
  if (!sessionId) return;
  if (!force && !afterCommand && busy) { refreshDeferred = true; return; }
  const loadingSession = sessionId, loadingPreview = preview, loadingScope = connectionScope(), sequence = ++loadSequence;
  const current = () => sessionId === loadingSession && preview === loadingPreview && sequence === loadSequence && connectionScope() === loadingScope && !solo;
  pendingLoads++;
  try {
    const data = await api(`/sessions/${sessionId}${preview ? `?company=${encodeURIComponent(preview)}` : ''}`);
    if (!current()) return;
    observeMessageSounds(data);
    const changed = !state || data.state.revision !== state.revision || !online;
    const completedNow = data.state.status === 'completed' && state?.status !== 'completed';
    // Preserve reviewed drafts during play, but completion must retire decision forms.
    if (!force && !afterCommand && !completedNow && (busy || submittingForms.size || dialog.open || expandedWorkspaceMenu || activePaneResize || draggingPanel || document.activeElement?.closest('form'))) { refreshDeferred = changed; online = true; updateConnectionNotice(); return; }
    state = data.state; actor = data.actor; testAccessClosed = false; refreshDeferred = false; online = true; updateConnectionNotice(); ensureSessionUpdates();
    if (completedNow && dialog.open) dialog.close();
    if (dialog.open) dialog.querySelector?.('form')?.refreshContext?.();
    if ((force || changed) && !dialog.open && (completedNow || (!expandedWorkspaceMenu && !activePaneResize && !draggingPanel)) && (force || completedNow || (!submittingForms.size && !document.activeElement?.closest('form')))) render();
  } catch (e) {
    if (!current()) return;
    if (testRoom && e.status === 410) { endTestView(); return; }
    if (testRoom && e.status === 403) { showTestAccessClosed(); return; }
    if (!testRoom && [403, 404].includes(e.status)) { clearClosedSession(); return; }
    online = false; updateConnectionNotice(); if (force) throw e;
  } finally { pendingLoads--; if (!pendingLoads) { for (const resolve of loadWaiters) resolve(); loadWaiters.clear(); } }
}
function clearPendingDecision(storageKey) {
  sessionStorage.removeItem(storageKey);
  // Resolving an old request may leave the view revision unchanged. Remove
  // only its notice, without replacing another draft, dialog, or workspace.
  if (storageKey === `studio-pending:${backend}:${actor?.id}:${sessionId}`) document.querySelector('#pending-decision')?.remove?.();
}
async function command(cmd) {
  if (busy) throw new Error('Another decision is still being submitted. Please wait and try again.'); busy = true;
  const storageKey = `studio-pending:${backend}:${actor.id}:${sessionId}`;
  let request, interrupted = false, retrying = false;
  try {
    if (testRoom) {
      if (testPending && JSON.stringify(testPending.command) !== JSON.stringify(cmd)) throw new Error('Retry the previous test decision before submitting another.');
      testPending ||= {key:crypto.randomUUID(),revision:state.revision,command:cmd};
      try { const response = await testRoom.call('command',testPending); testPending = null; toast(response.message); await load(false,true); return true; }
      catch(e) { if(e.status >= 400 && e.status < 500 && ![408,429].includes(e.status)) testPending = null; if([403,409,410].includes(e.status)) await load(false,true); throw e; }
    }
    if (!solo) {
      request = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      retrying = !!request;
      if (request && JSON.stringify(request.command) !== JSON.stringify(cmd)) throw new Error('An earlier decision has an unknown response. Retry that same decision before starting another.');
      request ||= { key: crypto.randomUUID(), revision: state.revision, command: cmd };
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    }
    const response = solo ? solo.command(cmd) : await api(`/sessions/${sessionId}/command`, request);
    clearPendingDecision(storageKey);
    toast(response.message); await load(false, true); return true;
  } catch (e) {
    // A retry may refer to an already committed decision whose response was
    // lost. An auth/access/not-found rejection cannot disprove that commit.
    // A first-attempt rejection is definitive and must not block new decisions.
    const uncertainRetry = retrying && [401, 403, 404].includes(e.status);
    if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status) && !uncertainRetry) clearPendingDecision(storageKey);
    if (e.status === 409) await load(false, true);
    interrupted = request && sessionStorage.getItem(storageKey) && !dialog.open && !submittingForms.size;
    throw e;
  } finally { busy = false; if (interrupted) render(); }
}
async function signIn(result) {
  token = result.token; user = result.user; sessionStorage.setItem('studio-token', token); await enter();
}
function sessionLink(id) { const url = new URL(location.href); url.searchParams.delete('session'); if (id) url.searchParams.set('session', id); url.hash = ''; return url.href; }
function selectSession(id) { sounds().reset(); history.replaceState(null, '', sessionLink(id)); sessionId = id || null; }
// Only navigation preferences are kept, scoped to this tab, account and classroom.
// Simulation data and authorization always come from the server after refresh.
function workspaceViewKey() {
  if (solo || !user?.id || !sessionId) return null;
  if (!testRoom && user.role === 'instructor') return 'studio-view:' + JSON.stringify([backend, user.id, sessionId]);
  return 'studio-workspace:' + JSON.stringify([testRoom ? 'test' : backend, user.role, user.id, sessionId]);
}
function restoreWorkspaceView() {
  panelLayouts.clear();
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
    selectedPanel = openPanels.has(saved.selectedPanel) ? saved.selectedPanel : null;
    for (const [id, layout] of Object.entries(saved.panelLayouts || {})) {
      if (!Object.hasOwn(studentPanels, id) || !layout || typeof layout !== 'object') continue;
      const size = {};
      if (Number.isFinite(layout.width) && layout.width >= 1 && layout.width <= 10000) size.width = layout.width;
      if (Number.isFinite(layout.height) && layout.height >= 180 && layout.height <= 1600) size.height = layout.height;
      if (layout.full === true) size.full = true;
      panelLayouts.set(id, size);
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
      openPanels: [...openPanels], selectedPanel, panelLayouts: Object.fromEntries(panelLayouts), inventoryCategories: [...inventoryCategories] }));
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
    channel = 'all'; selectedPanel = null; report = 'profit'; reportRange = 30; selectedCompanies.clear();
    openPanels.clear(); inventoryCategories.clear(); inventoryCategories.add('finished'); inventoryCategories.add('component');
    restoreWorkspaceView();
    await load();
  }
  catch (error) { sessionId = null; state = null; renderLobby(error.message, requested); }
}
function renderLocalWelcome() {
  const currentYear = new Date().getFullYear();
  const footerYear = currentYear > 2026 ? '2026–' + currentYear : '2026';
  root.innerHTML = `<main class="welcome studio-landing" id="content"><header class="welcome-nav">${brand}</header><div class="welcome-layout"><section class="studio-intro" aria-labelledby="studio-title"><p class="eyebrow">A living business classroom</p><h1 id="studio-title">Good business.<br><span>A better footprint.</span></h1><p class="lead">Manage a supply chain efficiently and sustainably. See how your decisions affect cash flow, customer service and carbon emissions.</p><div class="studio-solar" aria-hidden="true"></div></section><section class="panel studio-access"><p class="eyebrow">Classroom workspace</p><h2>${health ? 'Join your simulation' : 'Connect your classroom'}</h2>${health?.demo ? `<p class="form-note">Local demonstration · independent roles, one shared simulation.</p><div class="demo-choices">${button('demo', 'Open instructor workspace', 'demo-instructor', 'primary')}${[1, 2, 3].map(i => button('demo', `Student · ${['Helio', 'Northstar', 'Verdant'][i - 1]}`, `demo-student-${i}`)).join('')}</div><hr>` : ''}${health ? `<form id="login-form">${field('username', 'Username', '', 'text', 'autocomplete="username"')}${field('password', 'Password', '', 'password', 'autocomplete="current-password"')}${button('submit', 'Sign in', '', 'primary')}<div class="error" role="alert"></div></form><details><summary>New student? Join with a company code</summary><form id="register-form">${field('name', 'Display name', '', 'text', 'maxlength="80"')}${field('username', 'Username', '', 'text', 'autocomplete="username"')}${field('password', 'Password (at least 10 characters)', '', 'password', 'minlength="10" autocomplete="new-password"')}${field('code', 'Company join code', '', 'text')}${button('submit', 'Create student account', '', 'primary')}<div class="error" role="alert"></div></form></details>` : `<p class="muted">To play with a class, connect the address of a running Sustainable Supply Chain Management server.</p><p class="form-note">For local shared play, run <code>npm run demo</code> in the project and open <a href="http://127.0.0.1:3000">the local workspace</a>.</p>`}<details ${health ? '' : 'open'}><summary>Server connection</summary><form id="backend-form">${field('backend', 'Server URL', backend || location.origin, 'url', 'placeholder="https://your-classroom.example"')}${button('submit', 'Connect server')}<div class="error" role="alert"></div></form></details></section></div><footer class="welcome-foot"><span><a href="https://www.stouras.com/">Konstantinos Stouras</a> · ${footerYear}</span></footer></main>`;
}
function firebaseForm() {
  return `<h2>Sign in to your workspace</h2>
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
  sounds().reset();
  stopSessionUpdates();
  renderLocalWelcome();
  if (!health || health.auth === 'firebase') {
    const panel = root.querySelector('.welcome-layout > .panel');
    panel.innerHTML = firebaseForm();
  }
}
async function getFirebase() {
  if (!firebaseClient) firebaseClient = (await import('./src/firebase-client.mjs?v=4651dc6dd6e7')).firebase;
  return firebaseClient;
}
async function enterFirebase() {
  const auth = await getFirebase(); token = await auth.token();
  if (!auth.user) return renderWelcome();
  if (!auth.user.emailVerified) {
    root.innerHTML = `<main class="welcome" id="content">${brand}<h1>Check your inbox.</h1><p>Verify your email to join your classroom. Then return here and continue.</p><div class="toolbar">${button('firebase-refresh', 'I’ve verified my email', '', 'primary')}${button('firebase-verify', 'Resend verification')}${button('logout', 'Sign out')}</div><p class="form-note">Google sign-in verifies supported accounts automatically.</p></main>`;
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
  state = null; actor = null; sessionId = null; testPending = null; roster = null; testAccessClosed = false;
  if (dialog.open) dialog.close();
  testRoom?.close();
  root.innerHTML = '<main class="welcome"><h1>Test round ended</h1><p>This test session is deleted or unavailable in this browser profile.</p>' + button('test-leave','Return to classroom') + '</main>';
}
async function enterTest(client) {
  stopSessionUpdates();
  let view;
  try { view = await client.call('view'); } catch (error) { client.close(); throw error; }
  testRoom = client; solo = null; testAccessClosed = false;
  state = view.state; actor = view.actor; user = actor; sessionId = state.id; preview = undefined;
  sessions = []; page = actor.role === 'instructor' ? 'admin' : 'overview';
  channel = 'all'; selectedPanel = null; report = 'profit'; reportRange = 30; selectedCompanies.clear();
  openPanels.clear(); inventoryCategories.clear(); inventoryCategories.add('finished'); inventoryCategories.add('component');
  restoreWorkspaceView();
  // Fetch an authorized test instructor preview before the first render.
  if (preview) state = (await client.call('view', { preview })).state;
  observeMessageSounds({state, actor});
  history.replaceState(null, '', testTabUrl(client.credentials.key));
  render();
  client.subscribe(event => {
    if (testRoom !== client || !sessionId) return;
    if (event === 'ended') endTestView();
    else if (event === 'changed') void refreshInBackground();
    else if (event === 'save-error') { toast('Test progress could not be saved. The clock has paused. Free browser storage before continuing.'); void refreshInBackground(); }
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
function testOwner() { return JSON.stringify([backend, firebaseClient?.user?.uid || user.id]); }
async function savedTests(source) {
  const client = (await import('./src/test-client.mjs?v=4651dc6dd6e7')).testClient();
  let saved;
  try { saved = await client.call('list',{owner:testOwner(),source}); } finally { client.close(); }
  modal('Saved test sessions', '<p>Saved on this device in this browser profile. Clearing site data removes these tests. Each session retains its students, decisions and results. Open a session to resume or delete it.</p>' + (saved.length ? table(['Session','Hour','Students',''],saved.map(s => {
    const url = new URL(location.href); url.search = ''; url.hash = new URLSearchParams({test:s.roomId,key:s.key}).toString();
    return [esc(s.name),number(s.hour),s.students,'<a class="button" href="'+esc(url.href)+'">Resume test</a>'];
  })) : '<p>No saved test sessions yet.</p>') + (source ? button('new-test','Create another test session',source) : ''));
}
async function startTestSetup(id) {
  if (!health?.testClassroom) throw new Error('Refresh after the classroom server update to start multi-tab test rounds.');
  if (!globalThis.SharedWorker) throw new Error('This browser does not support shared test tabs. Use a current desktop browser.');
  const template = await api('/sessions/' + encodeURIComponent(id) + '/test-template');
  modal('Set up a test round', '<p>Choose 1–12 companies, then assign simulated students to each. The session, students and decisions are saved in this browser profile until you delete the test session. Return using Saved test sessions. Reopened sessions pause the clock; nothing is saved to Firebase.</p>' + field('companyCount', 'Number of competing companies', template.companyNames.length, 'number', 'min="1" max="12"'), async f => {
    const count = value(f,'companyCount'); if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('Choose 1–12 companies.');
    // The first modal closes before its next form is opened.
    setTimeout(() => modal('Assign test students', '<p>Each student belongs to exactly one company. Choose 1–20 students per company (60 total maximum).</p>' + Array.from({length:count}, (_,i) => `<div class="form-grid">${field('company-'+i,'Company '+(i+1),template.companyNames[i] || 'Company '+(i+1),'text','maxlength="60"')}${field('students-'+i,'Test students', i === 0 ? 2 : 1,'number','min="1" max="20"')}</div>`).join(''), async f => {
      const groups = Array.from({length:count},(_,i) => ({name:f.get('company-'+i),students:value(f,'students-'+i)}));
      const client = (await import('./src/test-client.mjs?v=4651dc6dd6e7')).testClient();
      try { await navigator.storage?.persist?.().catch(() => false); await client.create(template,groups,{owner:testOwner(),source:id}); await enterTest(client); } catch(e) {client.close();throw e;}
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
  return `<div class="account-controls"><span data-theme-slot></span><details class="account-menu" data-view-key="account-menu"><summary aria-label="Account options for ${esc(name)}"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="account-name">${esc(name)}</span><svg class="account-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="account-dropdown"><div class="account-heading"><strong>${esc(name)}</strong><small>${testRoom ? 'Practice · ' : ''}${role}</small></div><div class="account-links">${actions}</div><div class="account-footer">${testRoom ? button('test-leave', 'Leave test', '', 'danger') : button('logout', 'Log out', '', 'danger')}</div></div></details></div>`;
}
const sessionCities = ["athens", "berlin", "cairo", "dubai", "lima", "lisbon", "london", "madrid", "miami", "oslo", "paris", "rome", "seoul", "sydney", "tokyo"];
const optionalCostField = (name, label, min, placeholder) => `<label>${esc(label)}<input name="${name}" type="number" min="${min}" max="10000" step="0.01" placeholder="${placeholder}"></label>`;
const priceFields = [['local', 'Regional starting price (€)', 285], ['export', 'International starting price (€)', 300]];
const inventoryCostFields = [['cell', 'Opening cell unit cost (€)', 3.10], ['frame', 'Opening frame unit cost (€)', 18], ['controller', 'Opening junction box unit cost (€)', 24], ['panel', 'Opening finished panel unit cost (€)', 130]];
function pricingInventoryFields() {
  return `<div class="form-grid">${priceFields.map(([id, label, defaultValue]) => optionalCostField('price-' + id, label, 50, defaultValue)).join('')}${select('inventoryStatement', 'Inventory statement format', [['cogs', 'Cost of goods sold'], ['inventory-change', 'Purchases and change in inventory']], 'cogs')}</div><div class="form-grid">${inventoryCostFields.map(([id, label, defaultValue]) => optionalCostField('cost-' + id, label, 0, defaultValue)).join('')}</div><p class="form-note">Blank amounts keep the simulation defaults. Opening costs value starting stock only. Both statement formats use the same weighted-average ledger and report the same profit.</p>`;
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
  'session-test': 'Create or resume a saved practice round with simulated students, each assigned to one company, in separate browser tabs. Effect on students: real accounts and assessed results are unchanged. No test decisions are saved to Firebase.',
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
  root.innerHTML = `<div class="admin-home"><header class="admin-header">${brand}${accountControls(user)}</header><main id="content"><div class="page-heading"><div><p class="eyebrow">Instructor workspace</p><h1>Sustainable Supply Chain Management admin</h1><p>Manage your sessions and set up each learning task.</p>${button('saved-tests', 'Saved test sessions')}</div></div><div class="admin-columns"><aside><details class="panel"><summary>Create session</summary><form id="create-session-form">${createSessionFields()}${button('submit', 'Create session', '', 'primary')}<div class="error" role="alert"></div></form></details></aside><div><details class="panel" open><summary>Active sessions <span>${active.length} sessions</span></summary><p class="form-note">Open a session to manage your classroom. Paused sessions appear here too.</p>${active.length ? sessionButton('sessions-delete', 'Delete all active sessions', '', 'session-danger session-bulk') : ''}${cards(active)}</details><details class="panel"><summary>Past sessions <span>${past.length} sessions</span></summary>${cards(past)}</details></div></div></main></div>`;
}

function renderLobby(error = '', requested = '', needsCompany = false) {
  stopSessionUpdates();
  state = null; actor = null;
  root.innerHTML = '<main class="welcome" id="content">' + brand + '<h1>Enter your session ID</h1><p>Enter the ID provided by your instructor. Only sessions open to students can be entered.</p><section class="panel"><form id="session-entry-form">' + field('sessionId', 'Session ID', requested, 'text', 'maxlength="100" autocomplete="off"') + (needsCompany ? field('code', 'Company join code', '', 'text', 'autocomplete="off"') + '<p>Your instructor’s company code assigns you to the correct team.</p>' : '') + button('submit', 'Enter session', '', 'primary') + '<div class="error" role="alert">' + esc(error) + '</div></form></section>' + (user?.role === 'instructor' ? button('sessions', 'All sessions') : '') + button('logout', 'Sign out') + '</main>';
}
const pages = { overview: 'Overview', orders: 'Sales & dispatch', supply: 'Supply & inventory', production: 'Production', finance: 'Finance', energy: 'Energy & growth', reports: 'Reports', messages: 'Messages', help: 'Help & guide', admin: 'Session control' };
const studentPanels = {
  events: ['Forthcoming events', 'overview', forthcomingEventsPanel],
  banking: ['Banking', 'finance', bankingPanel],
  energySuppliers: ['Energy suppliers', 'energy', () => energyPage('suppliers')],
  investments: ['Investments & growth', 'energy', () => energyPage('investments')],
  inventory: ['Inventory', 'supply', () => inventoryPanel(true)],
  suppliers: ['Suppliers', 'supply', () => suppliersPanel(true)],
  purchases: ['Purchase history', 'supply', () => purchasesPanel(true)],
  shipments: ['Shipment history', 'orders', () => shipmentsPanel(true)],
  replenishment: ['Replenishment', 'supply', () => replenishmentPanel(true)],
  logistics: ['Logistics', 'supply', () => logisticsPanel(true)],
  orders: ['Orders & dispatch', 'orders', () => ordersPanel(true) + dispatchAssistantPanel() + businessUpdatesPanel(true)],
  offers: ['Sales offers', 'orders', () => offersPanel(true)],
  production: ['Production', 'production', productionPage],
  finance: ['Finance', 'finance', financePage],
  energy: ['Energy & growth', 'energy', energyPage],
  messages: ['Messages', 'messages', messagesPage]
};
for (const [id, [, title]] of Object.entries(operationalReports)) studentPanels['report-' + id] = [title, 'reports', () => operationalReportPanel(id)];
const operationalFilters = new Map();
const openPanels = new Set();
const panelLayouts = new Map();
let activePaneResize = null, draggingPanel = null;
let selectedPanel = null;
const inventoryCategories = new Set(['finished', 'component']);
const workspaceTools = [
  { id: 'operations', title: 'Operations', label: 'Ops', icon: 'admin', description: 'Purchases, events, stock, production and deliveries.', student: ['suppliers', 'events', 'inventory', 'production', 'offers', 'logistics', 'orders', 'report-history', 'replenishment'] },
  { id: 'finance', title: 'Investments & Funding', label: 'Funding', icon: 'coins', description: 'Forecast cash, use banking and compare energy contracts.', student: ['report-cashflow', 'banking', 'energySuppliers', 'investments'] },
  { id: 'sales', title: 'Reporting', label: 'Reports', icon: 'edit', description: 'Browse financial, operational, sales and market reports.', categories: true },
  { id: 'logistics', title: 'Deliver', label: 'Deliver', icon: 'truck', description: 'Review incoming orders and dispatch finished products.', student: ['orders'] },
  { id: 'messages', title: 'Messages', label: 'Messages', icon: 'messages', description: 'Read announcements, team messages and instructor conversations together.', channel: 'all' },
  { id: 'reports', title: 'Reports', label: 'Stats', icon: 'reports', description: 'Compare daily results and export data.', page: 'reports' },
  { id: 'help', title: 'Help & guide', label: 'Help', icon: 'book', description: 'Learn how to play, compare decisions and understand your results.', page: 'help' }
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
  return (tool.student || []).filter(id => studentPanelVisible(id, visible));
}

function selectedWorkspaceTool(admin, visible) {
  const panels = [...openPanels].filter(id => studentPanelVisible(id, visible));
  const destination = page === 'workspace' ? (panels.includes(selectedPanel) ? selectedPanel : panels.at(-1)) : page;
  if (destination === 'orders') return 'logistics';
  if (destination?.startsWith('report-') && destination !== 'report-cashflow' && destination !== 'report-history') return 'sales';
  if (destination === 'finance') return 'finance';
  return workspaceTools.find(tool => tool.page === destination || (tool.channel && destination === 'messages') || tool.student?.includes(destination))?.id;
}
function selectWorkspacePanel(id) {
  if (page !== 'workspace' || !openPanels.has(id) || selectedPanel === id) return;
  selectedPanel = id;
  const active = selectedWorkspaceTool(false, workspaceFeatureVisible);
  root.querySelectorAll('.workspace-tools > button').forEach(button => {
    const selected = button.dataset.id === active;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
  rememberWorkspaceView();
}
for (const type of ['click', 'focusin']) document.addEventListener(type, event => {
  const pane = event.target.closest?.('.student-pane');
  if (pane) selectWorkspacePanel(pane.getAttribute('aria-labelledby')?.replace(/^pane-/, ''));
});

function workspaceNavigation(admin, visible) {
  const waiting = visible('orders') ? (company()?.orders || []).filter(order => order.remaining > 0).length : 0;
  const selected = selectedWorkspaceTool(admin, visible);
  const buttons = workspaceTools.map(tool => {
    const { id, title, label, description, href } = tool;
    const destinations = workspaceDestinations(tool, admin, visible);
    const unavailable = (tool.channel && !visible('messages')) || (tool.student && !destinations.length);
    const current = !unavailable && id === selected;
    const active = current;
    const showBadge = id === 'logistics' && waiting > 0;
    const waitingLabel = showBadge ? `${number(waiting)} ${waiting === 1 ? 'order' : 'orders'} waiting to be dispatched` : '';
    const graphic = icon(tool.icon, workspaceIcons[tool.icon]);
    const body = `${showBadge ? `<span class="workspace-tool-icon">${graphic}<span class="dispatch-count" aria-hidden="true">${number(waiting)}</span></span>` : graphic}<span class="workspace-tool-desktop" aria-hidden="true">${title}</span><span class="workspace-tool-short" aria-hidden="true">${label}</span>
      <span class="workspace-tool-label"><strong aria-hidden="true">${title}</strong><span id="tool-${id}-hint">${showBadge ? waitingLabel + '. ' : ''}${description}</span></span>`;
    const accessibility = `aria-label="${title}" aria-describedby="tool-${id}-hint"`;
    return href ? `<a href="${href}" target="_blank" rel="noopener" ${accessibility}>${body}</a>` :
      `<button type="button" data-action="workspace-tool" data-id="${id}" ${accessibility}${current ? ` aria-current="${page === 'workspace' ? 'true' : 'page'}"` : ''}${active ? ' class="active"' : ''}${unavailable ? ' aria-disabled="true"' : ''}${destinations.length > 1 || tool.categories ? ` aria-haspopup="true" aria-expanded="false" aria-controls="menu-${id}"` : ''}>${body}</button>`;
  });
  return `<header class="workspace-nav" data-view-key="workspace-nav"><button type="button" class="mobile-menu-toggle" data-action="toggle-mobile-menu" aria-expanded="false" aria-controls="workspace-sections"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg><span>Menu</span></button><nav id="workspace-sections" class="workspace-tools" aria-label="Workspace">${buttons.join('')}</nav>${workspaceFlyouts(admin, visible)}</header>`;
}

function studentPanelVisible(id, visible) {
  return Object.hasOwn(studentPanels, id) && visible(studentPanels[id][1]);
}

let expandedWorkspaceMenu = null;
const reportCategories = [...new Set(Object.values(operationalReports).map(([category]) => category))];
function workspaceFlyouts(admin, visible) {
  const labels = { suppliers: 'Purchases', orders: 'Deliver', logistics: 'Logistics services' };
  const entry = id => button('open-workspace-panel', labels[id] || studentPanels[id][0], id, 'menu-entry');
  const menus = workspaceTools.filter(tool => tool.student?.length > 1).map(tool => `<div id="menu-${tool.id}" class="workspace-flyout" aria-label="${tool.title}" hidden><div class="menu-heading">${tool.title}</div>${workspaceDestinations(tool, admin, visible).map(entry).join('')}</div>`);
  menus.push(`<div id="menu-sales" class="workspace-flyout" aria-label="Reporting" hidden><div class="menu-heading">Reporting</div>${reportCategories.map((category, i) => `<button type="button" class="menu-entry menu-category" data-action="report-category" data-id="${i}" aria-expanded="false" aria-controls="menu-category-${i}">${esc(category)}<span aria-hidden="true">›</span></button>`).join('')}</div>`);
  reportCategories.forEach((category, i) => menus.push(`<div id="menu-category-${i}" class="workspace-submenu" aria-label="${esc(category)} reports" hidden><button type="button" class="menu-entry menu-back" data-action="report-back" data-id="${i}">‹ Reporting categories</button><div class="menu-heading">${esc(category)}</div>${Object.entries(operationalReports).filter(([, [group]]) => group === category).map(([id]) => entry('report-' + id)).join('')}</div>`));
  return menus.join('');
}
function closeWorkspaceMenus(focus = false) {
  expandedWorkspaceMenu = null;
  const trigger = root.querySelector('.workspace-tools [aria-expanded="true"]');
  root.querySelectorAll('.workspace-flyout, .workspace-submenu').forEach(menu => { menu.hidden = true; });
  root.querySelectorAll('.workspace-tools [aria-expanded], .menu-category').forEach(button => button.setAttribute('aria-expanded', 'false'));
  if (focus) trigger?.focus();
}
function placeWorkspaceMenu(menu, trigger) {
  menu.hidden = false;
  const bounds = trigger.getBoundingClientRect(), width = menu.getBoundingClientRect().width;
  const viewport = document.documentElement;
  const left = bounds.right + width + 8 <= viewport.clientWidth ? bounds.right : Math.max(8, viewport.clientWidth - width - 8);
  menu.style.left = left + 'px';
  menu.style.top = Math.max(8, Math.min(bounds.top, viewport.clientHeight - menu.getBoundingClientRect().height - 8)) + 'px';
}
function openWorkspaceMenu(id, focus = false, toggle = false) {
  const trigger = root.querySelector(`.workspace-tools [data-id="${id}"]`), menu = root.querySelector('#menu-' + id);
  if (!trigger || !menu || trigger.getAttribute('aria-disabled') === 'true') return;
  const wasOpen = !menu.hidden;
  closeWorkspaceMenus();
  if (wasOpen && toggle) return;
  placeWorkspaceMenu(menu, trigger); trigger.setAttribute('aria-expanded', 'true'); expandedWorkspaceMenu = id;
  if (focus) menu.querySelector('button')?.focus();
}
function openReportCategory(id, focus = false) {
  const trigger = root.querySelector(`.menu-category[data-id="${id}"]`), menu = root.querySelector('#menu-category-' + id);
  if (!trigger || !menu) return;
  root.querySelectorAll('.workspace-submenu').forEach(menu => { menu.hidden = true; });
  root.querySelectorAll('.menu-category').forEach(button => button.setAttribute('aria-expanded', 'false'));
  placeWorkspaceMenu(menu, trigger); trigger.setAttribute('aria-expanded', 'true');
  if (focus) menu.querySelector('button')?.focus();
}
document.addEventListener('pointerover', event => {
  if (event.pointerType !== 'mouse' || document.documentElement.clientWidth <= 700) return;
  const tool = event.target.closest?.('.workspace-tools [aria-haspopup]');
  if (tool) openWorkspaceMenu(tool.dataset.id);
  const category = event.target.closest?.('.menu-category');
  if (category) openReportCategory(category.dataset.id);
});
document.addEventListener('focusin', event => {
  if (!event.target.closest?.('.workspace-nav')) closeWorkspaceMenus();
});
document.addEventListener('keydown', event => {
  const tool = event.target.closest?.('.workspace-tools [aria-haspopup]');
  const category = event.target.closest?.('.menu-category');
  const menu = event.target.closest?.('.workspace-flyout, .workspace-submenu');
  if (event.key === 'Escape') { closeWorkspaceMenus(true); return; }
  if (tool && ['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); openWorkspaceMenu(tool.dataset.id, true); return; }
  if (category && event.key === 'ArrowRight') { event.preventDefault(); openReportCategory(category.dataset.id, true); return; }
  if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const buttons = [...menu.querySelectorAll('button')], current = buttons.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }
  if (menu && event.key === 'ArrowLeft') {
    event.preventDefault();
    if (menu.classList.contains('workspace-submenu')) { menu.hidden = true; const owner = root.querySelector(`[aria-controls="${menu.id}"]`); owner?.setAttribute('aria-expanded', 'false'); owner?.focus(); }
    else closeWorkspaceMenus(true);
  }
});

function forthcomingEventsPanel() {
  const events = state.events.filter(e => e.status === 'pending' && e.companyId === company()?.id).sort((a, b) => a.at - b.at);
  const names = { purchaseReceipt: 'Components arrive', purchasePayment: 'Supplier payment', customerReceipt: 'Customer delivery', customerPayment: 'Customer payment', freightPayment: 'Freight payment', energy: 'Energy contract activation', shifts: 'Shift change', staff: 'Staffing change', investment: 'Investment activation', loanFunding: 'Loan funding', loanRepayment: 'Loan repayment', depositMaturity: 'Deposit maturity' };
  return panel('', 'All pending commitments, including events beyond the session end.', table(['Time', 'Event', 'Description', 'Status'], events.map(e => [sortCell(simDate(e.at), e.at), esc(names[e.type] || e.type), esc(e.description), esc(e.blocked || (e.at > state.endHour ? 'Beyond session end' : 'Scheduled'))]), 'No forthcoming events.'));
}
const businessFeeds = new Map();
function businessFeedState() {
  const key = JSON.stringify([backend, sessionId, actor?.id, company()?.id, page === 'workspace' ? 'delivery' : 'business']);
  if (!businessFeeds.has(key)) businessFeeds.set(key, { page: 0, selected: null });
  return businessFeeds.get(key);
}
function businessUpdatesPanel(deliveryOnly = false) {
  const updates = businessUpdates(state, deliveryOnly), feed = businessFeedState(), pages = Math.max(1, Math.ceil(updates.length / 20));
  feed.page = Math.min(feed.page, pages - 1);
  const selected = updates.find(n => n.id === feed.selected) || updates[feed.page * 20];
  const list = table(['Simulation time', 'Title', 'Type'], updates.slice(feed.page * 20, (feed.page + 1) * 20).map(n => [sortCell(simDate(n.hour), n.hour), button('business-note', esc(n.title), n.id, 'small'), esc(n.severity === 'warning' ? 'Attention' : n.severity === 'success' ? 'Confirmed' : 'Information')]), 'No business updates yet.', deliveryOnly ? 'delivery-notes' : 'business-updates');
  const detail = selected ? `<article class="advice ${selected.severity === 'warning' ? 'warning' : ''}" aria-live="polite"><h3>${esc(selected.title)}</h3><p>${esc(selected.text)}</p><small>${simDate(selected.hour)} · Simulation event${selected.shipmentId ? ` · ${esc(selected.shipmentId)} · ${esc(selected.orderId)}<br>Promised: ${simDate(selected.dueAt)} · Expected: ${simDate(selected.expectedAt)} · Actual arrival: ${selected.receivedAt == null ? 'Not arrived yet' : simDate(selected.receivedAt)}` : ''}</small></article>` : '';
  return panel(deliveryOnly ? 'Delivery notes' : 'Business updates', 'Automatic simulation notices. Expected arrivals are estimates; confirmed receipts use the actual arrival time.', list + `<div class="toolbar"><span class="form-note">${updates.length} notes${pages > 1 ? ` · Page ${feed.page + 1} of ${pages}` : ''}</span>${pages > 1 ? button('business-prev', 'Previous notes', '', 'small', feed.page === 0) + button('business-next', 'Next notes', '', 'small', feed.page === pages - 1) : ''}</div>` + detail);
}
function bankingPanel() {
  const c = company();
  return panel('Banking', 'Review funding, repayment and deposit commitments.', `<div class="metrics">${metric('Available cash', money(c.accounts.cash), 'Current balance', 'finance')}${metric('Loan principal', money(-(c.accounts.debt || 0)), 'Outstanding funded principal', 'finance')}</div><div class="toolbar">${button('loan', 'Request bullet loan', '', 'primary', !permitted('finance'))}${button('annuity', 'Request annuity loan', '', '', !permitted('finance'))}${button('deposit', 'Place deposit', '', '', !permitted('finance'))}</div>${table(['Contract', 'Principal', 'Interest', 'Funding / placement', 'Completion'], [...c.loans.map(l => [esc(l.id), sortCell(exactMoney(l.amount), l.amount), sortCell(exactMoney(l.interest), l.interest), sortCell(l.fundedAt == null ? 'Pending funding' : simDate(l.fundedAt), l.fundedAt), sortCell(l.paidAt == null ? 'Repayment pending' : simDate(l.paidAt), l.paidAt)]), ...c.deposits.map(d => [esc(d.id), sortCell(exactMoney(d.amount), d.amount), sortCell(exactMoney(d.interest), d.interest), sortCell(simDate(d.placedAt), d.placedAt), sortCell(simDate(d.maturedAt ?? d.placedAt + d.term), d.maturedAt ?? d.placedAt + d.term)])])}`);
}
function reportFilters(id) {
  const key = JSON.stringify([backend, sessionId, actor?.id, company()?.id, id]);
  if (!operationalFilters.has(key)) operationalFilters.set(key, { days: '0', market: '', type: 'orders', page: 0 });
  return operationalFilters.get(key);
}
function orderedOperationalRows(data, id) {
  const current = tableSorts.get(tableKey(data.columns.map(c => esc(c.label)), 'operational-' + id));
  return current ? data.rows.map((row, i) => ({row, i})).sort((a, b) => compareTableValues(a.row[current.column], b.row[current.column], current.direction) || a.i - b.i).map(x => x.row) : data.rows;
}
function operationalReportPanel(id) {
  const filters = reportFilters(id), data = buildOperationalReport(state, id, filters);
  const format = (value, column) => value == null ? '—' : column.type === 'time' ? simDate(value) : column.type === 'money' ? exactMoney(value) : column.type === 'number' ? precise(value) : String(value);
  const live = ['income', 'profitability', 'companyIncome', 'balance', 'cashflow', 'payables', 'receivables', 'stock', 'quality', 'marketVolumes', 'marketShares', 'openOrders', 'supplierInfo', 'capacity', 'componentUsage', 'productionCost', 'carbonDemand'].includes(id);
  const fixedDays = /(?:7|14)$/.test(id) ? (id.endsWith('7') ? 7 : 14) : 0;
  const marketFilter = ['Sales', 'Markets/Competitors'].includes(operationalReports[id][0]) && !['marketVolumes', 'marketShares', 'quality', 'componentPurchases'].includes(id);
  const controls = '<div class="toolbar operational-filters" data-report-id="' + id + '">' +
    (!live && !fixedDays ? select('operational-days', 'Period', [['0', 'From beginning'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']], filters.days) : '') +
    (marketFilter ? select('operational-market', 'Market', [['', 'All markets'], ...state.catalog.markets.map(m => [m.id, m.name])], filters.market) : '') +
    (id === 'history' ? select('operational-type', 'Activity', [['orders', 'Orders'], ['dispatches', 'Dispatches'], ['arrivals', 'Customer arrivals']], filters.type) : '') +
    button('operational-csv', 'Export CSV', id, 'small') + button('refresh-report', 'Refresh', id, 'small') + '</div>';
  const chart = data.chart && data.rows.length ? '<div class="history-bars" role="img" aria-label="' + esc(data.title) + '; exact values in the table below">' + data.rows.map(row => '<div class="history-bar"><span style="height:' + Math.max(1, row[1] / Math.max(...data.rows.map(r => r[1]), 1) * 140) + 'px" title="' + esc(simDate(row[0])) + ': ' + number(row[1]) + '"></span><small>' + esc(simDate(row[0]).split(',')[0]) + '</small></div>').join('') + '</div>' : '';
  const rows = orderedOperationalRows(data, id), pageCount = Math.max(1, Math.ceil(rows.length / 100));
  filters.page = Math.min(filters.page || 0, pageCount - 1);
  const shown = rows.slice(filters.page * 100, (filters.page + 1) * 100);
  const totalIndex = data.columns.findIndex(c => c.label === 'Value' || c.label === 'Order value' || c.label === 'Committed cost');
  const totals = totalIndex < 0 ? '' : ' · Total value: ' + exactMoney(data.rows.reduce((n, row) => n + row[totalIndex], 0));
  const paging = '<div class="toolbar"><span class="form-note">' + number(rows.length) + ' rows' + totals + (pageCount > 1 ? ' · Page ' + (filters.page + 1) + ' of ' + pageCount : '') + '</span>' + (pageCount > 1 ? button('report-prev', 'Previous', id, 'small', filters.page === 0) + button('report-next', 'Next', id, 'small', filters.page === pageCount - 1) : '') + '</div>';
  return '<div data-operational-report="' + id + '">' + controls + (fixedDays ? '<p class="form-note">Last ' + fixedDays + ' days.</p>' : '') + panel('', data.note + ' · View at ' + simDate(state.hour), chart + table(data.columns.map(c => esc(c.label)), shown.map(row => row.map((value, i) => sortCell(esc(format(value, data.columns[i])), value))), 'No matching records yet.', 'operational-' + id)) + paging + '</div>';
}

function workspaceFeatureVisible(key) {
  const feature = { orders: 'offers', supply: 'purchasing', production: 'production', finance: 'finance', energy: 'energy', messages: 'messaging' }[key];
  return isTeacher() || !feature || state.features[feature].visible;
}
function studentWorkspace(visible) {
  const panels = [...openPanels].filter(id => studentPanelVisible(id, visible));
  if (!panels.length) return '<p class="empty">Choose a tool from the left menu to open its panel here.</p>';
  return '<div class="student-panels" data-view-key="student-panels">' + panels.map(id => {
    const [label, , renderPanel] = studentPanels[id];
    return '<section class="student-pane" data-pane-id="' + id + '" data-view-key="pane-' + id + '" aria-labelledby="pane-' + id + '"><div class="pane-title" draggable="true" title="Drag to reorder this panel"><h2 id="pane-' + id + '" tabindex="-1">' + label + '</h2><div class="pane-controls">' +
      '<button type="button" data-action="pane-earlier" data-id="' + id + '" aria-label="Move ' + label + ' earlier" title="Move earlier">←</button>' +
      '<button type="button" data-action="pane-later" data-id="' + id + '" aria-label="Move ' + label + ' later" title="Move later">→</button>' +
      '<button type="button" data-action="pane-wide" data-id="' + id + '" aria-label="Expand ' + label + ' to full width" title="Full width">↔</button>' +
      '<button type="button" data-action="pane-reset" data-id="' + id + '" aria-label="Reset ' + label + ' size" title="Reset size">↺</button>' +
      '<button type="button" data-action="close-panel" data-id="' + id + '" aria-label="Close ' + label + '">×</button></div>' +
      '</div><div class="pane-content" data-view-key="pane-content">' + renderPanel() + '</div>' +
      '<div class="pane-resize pane-resize-right" data-pane-resize="width" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize ' + label + ' width with left and right arrows"></div>' +
      '<div class="pane-resize pane-resize-bottom" data-pane-resize="height" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize ' + label + ' height with up and down arrows"></div>' +
      '<div class="pane-resize pane-resize-corner" data-pane-resize="both" role="button" tabindex="0" aria-label="Resize ' + label + ' with arrow keys" title="Drag to resize">◢</div></section>';
  }).join('') + '</div>';
}
function paneLayoutStyle(id) {
  const layout = panelLayouts.get(id) || {};
  const full = layout.full || (!layout.width && ['production', 'finance', 'energy', 'messages'].includes(id)) || (!layout.width && id.startsWith('report-'));
  return '--pane-width:' + (full ? '100%' : (layout.width || 560) + 'px') + ';' + (layout.height ? 'height:' + layout.height + 'px;' : '');
}
function applyPaneLayout(pane) {
  // Apply through CSSOM so strict style-src CSP also permits restored sizes.
  pane.style.cssText = paneLayoutStyle(pane.dataset.paneId);
}
function constrainPaneSize(width, height, available) {
  const maxWidth = Math.max(1, available);
  return { width: Math.round(Math.min(maxWidth, Math.max(Math.min(280, maxWidth), width))), height: Math.round(Math.max(180, Math.min(1600, height))) };
}
function updatePaneSize(pane, width, height, dimensions) {
  const id = pane.dataset.paneId, size = constrainPaneSize(width, height, pane.parentElement.clientWidth), saved = panelLayouts.get(id) || {};
  if (dimensions !== 'height') { saved.width = size.width; saved.full = false; pane.style.setProperty('--pane-width', size.width + 'px'); }
  if (dimensions !== 'width') { saved.height = size.height; pane.style.height = size.height + 'px'; }
  panelLayouts.set(id, saved);
}
function reorderWorkspacePanel(id, target, after = false) {
  const order = [...openPanels];
  if (id === target || !order.includes(id) || !order.includes(target)) return;
  order.splice(order.indexOf(id), 1); order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
  openPanels.clear(); order.forEach(id => openPanels.add(id));
  const container = root.querySelector('.student-panels');
  // Move existing nodes, preserving in-progress form values and focus.
  order.forEach(id => { const pane = root.querySelector('[data-pane-id="' + id + '"]'); if (pane) container.append(pane); });
  rememberWorkspaceView();
}
document.addEventListener('pointerdown', event => {
  const handle = event.target.closest?.('[data-pane-resize]');
  if (!handle || event.button !== 0) return;
  const pane = handle.closest('.student-pane'), bounds = pane.getBoundingClientRect();
  activePaneResize = { pane, handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, dimensions: handle.dataset.paneResize };
  handle.setPointerCapture(event.pointerId); pane.classList.add('pane-resizing'); event.preventDefault();
});
document.addEventListener('pointermove', event => {
  const resize = activePaneResize;
  if (!resize || event.pointerId !== resize.pointerId) return;
  updatePaneSize(resize.pane, resize.width + event.clientX - resize.x, resize.height + event.clientY - resize.y, resize.dimensions);
});
for (const eventName of ['pointerup', 'pointercancel']) document.addEventListener(eventName, event => {
  if (!activePaneResize || event.pointerId !== activePaneResize.pointerId) return;
  activePaneResize.pane.classList.remove('pane-resizing'); activePaneResize = null; rememberWorkspaceView();
});
document.addEventListener('keydown', event => {
  const handle = event.target.closest?.('[data-pane-resize]');
  if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const pane = handle.closest('.student-pane'), bounds = pane.getBoundingClientRect(), step = event.shiftKey ? 80 : 20;
  updatePaneSize(pane, bounds.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), bounds.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), handle.dataset.paneResize);
  rememberWorkspaceView();
});
document.addEventListener('dragstart', event => {
  const title = event.target.closest?.('.pane-title'); if (!title) return;
  draggingPanel = title.closest('.student-pane').dataset.paneId;
  event.dataTransfer.setData('text/plain', draggingPanel); event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', event => { if (draggingPanel && event.target.closest?.('.student-pane')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
document.addEventListener('drop', event => {
  const pane = event.target.closest?.('.student-pane'); if (!draggingPanel || !pane) return;
  event.preventDefault(); reorderWorkspacePanel(draggingPanel, pane.dataset.paneId); draggingPanel = null;
});
document.addEventListener('dragend', () => { draggingPanel = null; });
// Preserve only ephemeral reading position, never simulation/authentication data
// or form values. Identity comes from explicit keys, not changing row indexes.
let renderedInteractionScope = null, renderedInteractionRoot = null;
function interactionScope() {
  return JSON.stringify([backend, sessionId, !!solo, !!testRoom, actor?.id, actor?.role,
    actor?.companyId, preview, company()?.id, page, channel, report, reportRange,
    [...selectedCompanies].sort(), [...openPanels].sort()]);
}
function interactionNodes() {
  const nodes = new Map();
  for (const element of root.querySelectorAll('[data-view-key], [id], [name], [data-action], summary')) {
    const parts = [];
    for (let node = element; node && node !== root; node = node.parentElement) {
      const key = node.getAttribute('data-view-key'), id = node.getAttribute('id');
      if (key !== null) parts.push(['key', key]);
      else if (id) parts.push(['id', id]);
      else if (node === element) {
        const action = node.getAttribute('data-action'), name = node.getAttribute('name');
        if (action) parts.push(['action', action, node.getAttribute('data-id') || '']);
        else if (name) parts.push(['control', node.tagName, name]);
        else if (node.tagName === 'SUMMARY' && node.parentElement?.hasAttribute('data-view-key')) parts.push(['summary']);
        else break;
      }
    }
    if (!parts.length) continue;
    const key = JSON.stringify(parts);
    // An ambiguous control is safer to leave unfocused than to target a peer.
    nodes.set(key, nodes.has(key) ? null : element);
  }
  return nodes;
}
function captureInteraction(scope) {
  if (!root.querySelectorAll || scope !== renderedInteractionScope || root.firstElementChild !== renderedInteractionRoot) return null;
  const snapshot = { scope, details: [], scroll: [], focus: null, documentScroll: null };
  for (const [key, element] of interactionNodes()) {
    if (!element) continue;
    if (element.tagName === 'DETAILS') snapshot.details.push([key, element.open]);
    if (element.scrollLeft || element.scrollTop) snapshot.scroll.push([key, element.scrollLeft, element.scrollTop]);
    // A successful inline submission replaces its form. Refocusing the new
    // form would make the draft guard defer subsequent live updates forever.
    if (element === document.activeElement && !element.closest('form')) snapshot.focus = key;
  }
  if (document.scrollingElement) snapshot.documentScroll = [document.scrollingElement.scrollLeft, document.scrollingElement.scrollTop];
  return snapshot;
}
function restoreInteraction(snapshot, scope) {
  if (!snapshot || snapshot.scope !== scope) return;
  const nodes = interactionNodes();
  for (const [key, open] of snapshot.details) { const element = nodes.get(key); if (element?.tagName === 'DETAILS') element.open = open; }
  const focus = nodes.get(snapshot.focus);
  if (focus && !focus.disabled && !focus.closest('form')) focus.focus?.({ preventScroll: true });
  for (const [key, left, top] of snapshot.scroll) { const element = nodes.get(key); if (element) { element.scrollLeft = left; element.scrollTop = top; } }
  if (snapshot.documentScroll && document.scrollingElement) {
    [document.scrollingElement.scrollLeft, document.scrollingElement.scrollTop] = snapshot.documentScroll;
  }
}
function render() {
  expandedWorkspaceMenu = null;
  if (testRoom && testAccessClosed) return showTestAccessClosed();
  if (!state) return user?.role === 'instructor' && page === 'sessions' ? renderAdminHome() : user ? renderLobby() : renderWelcome();
  if (isTeacher()) {
    if (preview && !state.companies.some(c => c.id === preview)) preview = undefined;
    selectedCompanies = new Set([...selectedCompanies].filter(id => state.companies.some(c => c.id === id)));
  }
  const c = company(), admin = isTeacher();
  const visible = workspaceFeatureVisible;
  if (!visible(page)) page = 'overview';
  const scope = interactionScope(), interaction = captureInteraction(scope);
  const titles = { workspace: 'Decision workspace', overview: c ? `Let's make progress, ${c.name.split(' ')[0]}.` : 'A classroom in motion.', orders: 'From offer to arrival.', supply: 'Keep your business moving.', production: 'Make capacity count.', finance: 'Follow the money.', energy: 'Build a better footprint.', reports: 'See the whole picture.', messages: 'Better decisions, together.', help: 'Your guide to running the business.', admin: 'Set the pace of learning.' };
  const subtitles = { workspace: 'Open the panels you need and compare them side by side.', overview: 'Your business, at a glance. Every decision has a next step.', orders: 'Accepted terms stay with each order, from first dispatch to final payment.', supply: 'Balance availability, working capital, and the footprint of every component.', production: 'Coordinate materials, people, machines, and the hours they work.', finance: 'Cash is available money. Profit is revenue earned less costs incurred.', energy: 'Invest now. Track activation and the results over time.', reports: 'Comparable daily results, with every reporting boundary clearly marked.', messages: 'A shared space for announcements, questions, and team decisions.', help: 'Know what to check, which decisions to make, and what happens next.', admin: 'Control the shared clock, classroom access, and teaching parameters.' };
  root.innerHTML = `<div class="layout">${!admin || preview ? workspaceNavigation(admin, visible) : ''}<div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace &nbsp; / &nbsp; <strong>${pages[page] || "Decision workspace"}</strong></div><div class="top-actions">${user?.role === 'instructor' ? button('sessions', 'All sessions', '', 'small') : ''}${accountControls(actor)}</div></header>${testRoom ? `<div class="mode-banner"><span><strong>Saved test session</strong> · ${esc(actor.name)} · Saved in this browser profile. Close tabs and return later; delete only when finished.</span>${admin ? button('test-students', 'Open test student tabs') + button('test-end', 'Delete test session') : ''}${button('test-leave', 'Leave test')}</div>` : solo ? `<div class="mode-banner"><span><strong>Solo sandbox</strong> · ${solo.isTest ? 'Private test round · changes are discarded when you leave.' : 'Saved in this browser. Switch roles to rehearse; no other people are connected.'}</span>${button('switch-solo', admin ? 'Play a company' : 'Instructor view')}</div>` : health?.demo ? '<div class="mode-banner"><span><strong>Local classroom demo</strong> · Synthetic accounts share durable server state. Demo sign-in is enabled on this computer.</span></div>' : ''}<main id="content" class="content">${connectionNotice()}<div class="page-heading"><div><div class="eyebrow">${esc(state.name)}${c ? ` &nbsp; / &nbsp; ${esc(c.name)}` : ''}</div><h1 tabindex="-1">${esc(titles[page])}</h1><p>${subtitles[page]}</p></div>${page === 'admin' ? '' : `<div class="timebox">${shiftIndicator()}<span class="badge ${state.status === 'running' ? '' : 'amber'}">● ${esc(state.status)}</span><strong>${simDate(state.hour)} · simulation</strong><small>Day ${Math.floor(state.hour / 24) + 1} · ends ${simDate(state.endHour)}</small></div>`}</div>${state.status === 'completed' ? `<div class="advice warning"><strong>Session complete. ${state.events.filter(e => e.status === 'pending').length} scheduled events remain.</strong>${admin ? 'Pending deliveries, payments, and investments are preserved. The instructor can extend the end date to settle them.' : 'Final reports and CSV downloads remain available. New decisions are disabled.'}</div>` : ''}${admin ? `<div class="toolbar instructor-toolbar control-toolbar" aria-label="Instructor controls">${select('preview', 'Company preview · read-only', [['', 'All companies'], ...state.companies.map(x => [x.id, x.name])], preview || '')}<nav class="instructor-links" aria-label="Instructor pages">${button('nav', 'Session control', 'admin', 'small')}${button('nav', 'Class overview', 'overview', 'small')}${button('nav', 'Reports', 'reports', 'small')}${button('nav', 'Messages', 'messages', 'small')}</nav></div>` : ''}${!admin && !solo && !testRoom ? `<div class="toolbar" aria-label="Classroom access">${button('join', 'Join another class', '', 'small')}${button('sessions', 'Switch session', '', 'small')}</div>` : ''}${page === "workspace" ? studentWorkspace(visible) : pageBody()}<div class="footer-note">${button('nav', 'Help & guide', 'help', 'small')}<p>All amounts are simulated EUR · Emissions in kg CO₂e · Simulation dates use UTC · Live state at ${simDate(state.hour)} · Model v${state.schema}</p></div></main></div></div>`;
  for (const pane of root.querySelectorAll?.('.student-pane') || []) applyPaneLayout(pane);
  rememberWorkspaceView();
  const pending = !solo && !testRoom && sessionStorage.getItem(`studio-pending:${backend}:${actor.id}:${sessionId}`);
  if (pending && !busy) root.querySelector('#content').insertAdjacentHTML('afterbegin', `<div id="pending-decision" class="advice warning"><strong>A decision is awaiting confirmation.</strong>The response was interrupted. Retry with the same request key to confirm the outcome safely. ${button('retry-decision', 'Retry pending decision', '', 'small')}</div>`);
  restoreInteraction(interaction, scope);
  renderedInteractionScope = scope; renderedInteractionRoot = root.firstElementChild;
}
function pageBody() {
  if (page === 'help') return helpPage();
  if (page === 'admin') return adminPage();
  if (page === 'reports') return reportsPage();
  if (page === 'messages') return messagesPage();
  if (!company()) return instructorOverview();
  return ({ overview: overviewPage, orders: ordersPage, supply: supplyPage, production: productionPage, finance: financePage, energy: energyPage })[page]();
}
function chart(metricName, unit, { selected = false, range = 30 } = {}) {
  const snaps = reportSnapshots(range);
  if (!snaps.length) return '<p class="empty">The first chart point appears at the next daily close. Live operations are already available.</p>';
  const companies = state.companies.filter(c => !selected || !selectedCompanies.size || selectedCompanies.has(c.id));
  const series = companies.map(c => ({ ...c, color: state.companies.findIndex(x => x.id === c.id) % 12, values: snaps.map((snap, index) => {
    const row = snap.companies.find(x => x.id === c.id), prior = state.snapshots.find(x => x.hour === snap.hour - 24)?.companies.find(x => x.id === c.id);
    if (metricName === 'dailySales') return (row?.revenue || 0) - (prior?.revenue || 0);
    if (metricName === 'dailyProduction') return (row?.production || 0) - (prior?.production || 0);
    return row?.[metricName] || 0;
  }) }));
  const raw = series.flatMap(x => x.values), scale = unit === 'EUR' ? 100 : 1;
  let min = Math.min(0, ...raw) / scale, max = Math.max(1, ...raw) / scale; if (max === min) max++;
  const x = i => 62 + i * 520 / Math.max(1, snaps.length - 1), y = val => 204 - (val / scale - min) / (max - min) * 174;
  const grid = Array.from({ length: 5 }, (_, i) => { const val = min + (max - min) * i / 4, at = 204 - i * 43.5; return `<line class="gridline" x1="62" x2="590" y1="${at}" y2="${at}"/><text text-anchor="end" x="52" y="${at + 4}">${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}k` : number(val)}</text>`; }).join('');
  return `<div class="chart-scroll" data-view-key="${esc('chart:' + metricName)}" role="region" aria-label="Time series chart"><svg class="chart" viewBox="-20 -6 660 252" role="group" aria-label="${esc(metricName)} in ${unit}, daily snapshots. Hover, tap, or focus a point for its value. Exact values are available in Reports data tables."><text x="10" y="13">${unit}</text>${grid}${series.map(serie => `<polyline class="chart-line color-${serie.color}" points="${serie.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${serie.values.map((v, i) => `<circle class="chart-point c${serie.color}" data-view-key="${esc('point:' + serie.id + ':' + snaps[i].hour)}" tabindex="0" role="img" aria-label="${esc(serie.name)} · ${simDate(snaps[i].hour)} · ${unit === 'EUR' ? exactMoney(v) : number(v / scale) + ' ' + esc(unit)}" r="3" cx="${x(i)}" cy="${y(v)}"></circle>`).join('')}`).join('')}${[...new Set([0, Math.floor((snaps.length - 1) / 2), snaps.length - 1])].map(i => `<text text-anchor="middle" x="${x(i)}" y="230">${simDate(snaps[i].hour).split(',')[0]}</text>`).join('')}</svg><div class="chart-tooltip" role="status" hidden></div></div><div class="chart-legend">${series.map(c => `<span><i class="legend-dot c${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>`;
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
  return `<div class="metrics">${metric('Available cash', money(c.accounts.cash), 'Live · excludes locked deposits', 'finance')}${metric('Cumulative net profit', money(c.profit), 'Recognised revenue plus interest income, less costs', 'reports')}${metric('Ready to ship', number(c.inventory.panel.qty), `${number(open)} modules in open orders`, 'supply')}${metric('Carbon footprint', `${number(c.emissions / 1000)} t`, 'Cumulative operational kg CO₂e / 1,000', 'energy')}</div><div class="split">${panel('Business performance', `Cumulative net profit · EUR · daily closes through ${state.snapshots.length ? simDate(state.snapshots.at(-1).hour) : 'no completed day'}`, chart('profit', 'EUR'), button('nav', 'All reports ↗', 'reports', 'small'))}${panel('Up next', 'Accepted decisions, scheduled outcomes', pendingEvents(4), button('events', 'View all', '', 'small'))}</div><div class="advice"><strong>${open > c.inventory.panel.qty ? 'Demand is ahead of your available stock.' : 'Your next move matters.'}</strong>${open > c.inventory.panel.qty ? `You have ${number(open)} modules still to dispatch and ${number(c.inventory.panel.qty)} ready. Check material availability and production capacity before promising faster delivery.` : `Production is currently limited by: ${esc(c.lastBottleneck)}. Review your open orders, then compare the cost and carbon of your next shipment.`}</div><div class="grid2">${panel('Order journey', 'Cumulative modules · dispatch is not customer receipt', `<div class="flow"><div><strong>${number(c.demandUnits)}</strong><span>Ordered</span></div><div><strong>${number(c.dispatched)}</strong><span>Dispatched</span></div><div><strong>${number(c.received)}</strong><span>Received</span></div></div>${table(['Latest order', 'Remaining', 'Promised'], c.orders.filter(o => o.remaining).slice(-3).reverse().map(o => [sortCell(esc(o.id), o.createdAt), sortCell(`${o.remaining} modules`, o.remaining), sortCell(simDate(o.dueAt), o.dueAt)]), 'No open orders yet.')}`, button('nav', 'Manage orders ↗', 'orders', 'small'))}${panel('Decision feedback', 'The cause, the consequence, and when it happened', `<div class="timeline">${c.notices.slice(-3).reverse().map(n => `<div class="timeline-item"><strong>${esc(n.text)}</strong><small>${simDate(n.hour)} · ${esc(n.kind)}</small></div>`).join('') || '<p class="empty">Make a decision to see its feedback here.</p>'}</div>`)}</div>`;
}
function instructorOverview() {
  return `<div class="metrics">${metric('Participating companies', state.companies.length, 'Shared scenario and clock', 'overview')}${metric('Completed days', state.snapshots.length, 'Immutable daily snapshots', 'reports')}${metric('Pending outcomes', state.events.filter(e => e.status === 'pending').length, 'Includes payments and arrivals', 'orders')}${metric('Session duration', `${number(state.endHour / 24)} days`, `${number(Math.max(0, state.endHour - state.hour))} h remaining`, 'admin')}</div>${panel('Company comparison', 'Live values · select a company above for read-only preview', table(['Company', 'Cash', 'Net profit', 'Ready stock', 'Open units', ''], state.companies.map(c => [esc(c.name), sortCell(money(c.cash), c.cash), sortCell(money(c.profit), c.profit), c.inventory, c.openUnits, button('preview', 'Preview', c.id, 'small')])))}<div class="grid2">${panel('Net profit over time', 'Cumulative EUR · daily close', chart('profit', 'EUR'))}${panel('Carbon over time', 'Cumulative kg CO₂e · daily close', chart('emissions', 'kg CO₂e'))}</div>`;
}
function offersPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Sales offers', 'One transparent offer per market. Editing affects future orders.', table(['Market', 'Price / module', 'Quantity band', 'Delivery promise', 'Payment after receipt', ''], c.offers.map(o => [esc(state.catalog.markets.find(m => m.id === o.marketId)?.name), sortCell(exactMoney(o.price), o.price), sortCell(`${o.min}–${o.max}`, o.min), sortCell(`${o.delivery} h`, o.delivery), sortCell(`${o.payment} h`, o.payment), `<div class="table-actions">${o.enabled ? '<span class="badge">Active</span>' : '<span class="badge amber">Off</span>'}${button('offer', 'Edit', o.id, 'small', !permitted('offers'))}</div>`])))}`;
}
function ordersPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Customer orders', 'Original quantities are preserved. Split shipments share the accepted price and promise.', table(['Order / market', 'Original', 'To dispatch', 'Received', 'Promised arrival', ''], c.orders.slice().reverse().map(o => [sortCell(`<strong>${esc(o.id)}</strong><small>${esc(o.customer)} · ${exactMoney(o.price)} / module</small>`, o.createdAt), o.originalQty, o.remaining, o.received, sortCell(`${simDate(o.dueAt)}${o.remaining && o.dueAt < state.hour ? '<small class="danger">Overdue</small>' : ''}`, o.dueAt), button('dispatch', 'Dispatch', o.id, 'small', !permitted('offers') || !o.remaining)])))}`;
}
function shipmentsPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Shipment history', 'Goods leave stock at dispatch; revenue is earned at customer receipt; cash follows the payment term.', table(['Shipment', 'Quantity', 'Route', 'Dispatched', 'Customer receipt', 'Paid'], c.shipments.slice().reverse().map(s => [`${esc(s.id)}<small>${esc(s.orderId)}</small>`, s.qty, esc(s.route), sortCell(simDate(s.dispatchedAt), s.dispatchedAt), sortCell(s.receivedAt === null ? `In transit<small>Estimate ${simDate(s.expectedAt)}</small>` : simDate(s.receivedAt), s.receivedAt), sortCell(s.paidAt === null ? 'Pending' : simDate(s.paidAt), s.paidAt)])))}`;
}
function dispatchAssistantPanel() {
  const c = company();
  return `${panel('Dispatch assistant', 'FIFO · cheapest feasible route, with a buffer for delay', `<p class="form-note">${esc(c.autoStatus.delivery || 'Not installed.')}</p>`)}`;
}
function ordersPage() {
  return offersPanel() + ordersPanel() + shipmentsPanel() + dispatchAssistantPanel() + businessUpdatesPanel(true);
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
      sortCell(`${number(purchase.qty)} × ${itemName(state, purchase.item)}`, purchase.qty),
      sortCell(simDate(purchase.expectedAt) + eta, purchase.expectedAt),
      sortCell(extra ? '+' + number(extra) : '0', extra),
      sortCell(number(forecast.buildable), forecast.buildable),
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
        sortCell(`<span class="stock-kind ${type}" aria-label="${type === 'finished' ? 'Finished' : 'Component'}">${type === 'finished' ? 'F' : 'C'}</span> ${itemName(state, key)}`, itemName(state, key)),
        sortCell(`<span class="nowrap"><strong>${number(stock.qty)}</strong> / ${number(stock.capacity)}</span>`, stock.qty),
        sortCell(Object.hasOwn(recipe, key) ? `<span class="quantity-status"><span>${number(recipe[key])}</span>${limiting.includes(key) ? '<span class="badge amber">Limiting</span>' : ''}</span>` : '—', recipe[key] ?? null),
        sortCell(stock.qty ? exactMoney(stock.value / stock.qty) : '—', stock.qty ? stock.value / stock.qty : null),
        sortCell(ordered ? number(ordered) : '—', ordered || 0),
        sortCell(stock.qty ? precise(stock.carbon / stock.qty) : '—', stock.qty ? stock.carbon / stock.qty : null)
      ];
    });
  const wasteAction = (solo || testRoom || health?.inventoryWriteOff) ? button('inventory-write-off', 'Write off stock', '', 'small', !permitted('purchasing') || !Object.values(c.inventory).some(stock => stock.qty > 0)) : '';
  return panel(embedded ? '' : 'Inventory', '', `${buildSummary}${filters}<div class="inventory-table">${table(['Item', 'Amount / capacity', `Needed / ${product}`, 'Avg cost / unit', 'Ordered', 'kg CO₂e / unit'], rows, 'Select Finished or Components to show stock.')}</div><p class="form-note inventory-note">Counts reflect materials only. The forecast adds all outstanding purchases to today’s stock, assuming no stock is used before receipt. Stock above capacity costs €0.05 per excess unit per day.</p>${wasteAction}`) + timeline;
}
function suppliersPanel(embedded = false) {
  return `${panel(embedded ? '' : 'Supplier marketplace', 'All orders have a landed fixed fee. Supplier stock is shared across companies.', table(['Supplier / item', 'Unit price', 'Order fee', 'Lead / payment', 'Delivery accuracy', 'Component / freight CO₂e', 'Available / lot', ''], state.catalog.suppliers.filter(s => s.enabled).map(s => [`<strong>${esc(s.name)}</strong><small>${itemName(state, s.item)} · Origin: ${esc(sourcingOrigins[s.id] || "Unspecified")}</small>`, sortCell(exactMoney(s.price), s.price), sortCell(exactMoney(s.fee), s.fee), sortCell(`${s.lead} h / ${s.term} h<small>Payment after receipt</small>`, s.lead), sortCell(`${s.reliability}% on time<small>Up to ${s.maxDelay} h extra</small>`, s.reliability), sortCell(`${precise(s.carbon)} / ${precise(s.freight)} kg per unit<small>${precise(s.carbon + s.freight)} kg total per unit</small>`, s.carbon), sortCell(`${number(s.stock)}<small>Minimum ${s.min} · lot ${s.lot}</small>`, s.stock), button('purchase', 'Order', s.id, 'small', !permitted('purchasing'))])))}`;
}
function logisticsPanel(embedded = false) {
  return `${panel(embedded ? '' : 'Logistics services', 'Compare the enabled routes before dispatching a customer order.', table(['Route', 'Duration', 'Cost / shipment', 'Cost / unit', 'Delivery accuracy', 'Transport CO₂e'], state.catalog.routes.filter(r => r.enabled).map(r => [esc(r.name), sortCell(`${r.hours} h`, r.hours), sortCell(exactMoney(r.fixed), r.fixed), sortCell(exactMoney(r.unit), r.unit), sortCell(`${r.reliability}% on time<small>Up to ${r.maxDelay} h extra</small>`, r.reliability), sortCell(`${precise(r.carbonFixed)} kg / shipment<small>${precise(r.carbonUnit)} kg / unit</small>`, r.carbonFixed)]), 'No transport routes are enabled.'))}`;
}
function purchasesPanel(embedded = false) {
  const c = company();
  return `${panel(embedded ? '' : 'Purchase history', 'Committed → received → paid', table(['Purchase', 'Quantity', 'Landed cost', 'Expected', 'Receipt', 'Payment'], c.purchases.slice().reverse().map(p => [`${esc(p.id)}<small>${itemName(state, p.item)} · ${esc(p.supplier)}</small>`, p.qty, sortCell(exactMoney(p.cost), p.cost), sortCell(simDate(p.expectedAt), p.expectedAt), sortCell(p.receivedAt === null ? 'In transit' : simDate(p.receivedAt), p.receivedAt), sortCell(p.paidAt === null ? 'Pending' : simDate(p.paidAt), p.paidAt)])))}`;
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
  const shiftLabels = ['12:00am–8:00am', '8:00am–4:00pm', '4:00pm–12:00am'];
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
  const waste = (company.writeOffs || []).reduce((total, row) => total + row.value, 0);
  const adjustment = waste ? '<div><span>Write-offs already charged to operating expenses (add back)</span><strong>' + exactMoney(waste) + '</strong></div>' : '';
  return `<div><span>Received material purchases</span><strong>${exactMoney(-purchases)}</strong></div><div><span>Change in inventory (including goods in transit to customers)</span><strong>${exactMoney(inventoryChange)}</strong></div>${adjustment}`;
}
function financePage() {
  const c = company(), a = c.accounts;
  return `<div class="metrics">${metric('Available cash', money(a.cash), 'Live bank balance', 'finance')}${metric('Cumulative net profit', money(c.profit), 'Includes depreciation & accrued costs', 'reports')}${metric('Receivables', money(a.receivable), 'Recognized revenue awaiting payment', 'orders')}${metric('Debt & payables', money(-(a.debt || 0) - (a.payable || 0) - (a.interestPayable || 0) - (a.overheadPayable || 0)), 'Includes outstanding obligations', 'finance')}</div><div class="grid2">${panel('Finance your next decision', 'Compare funding dates and repayment schedules.', `<p class="form-note">Bullet loans: 9% simple annual interest. Annuity loans: 8% annual interest with weekly payments. Deposits: 4% simple annual interest. This is a teaching model, not a bank product.</p><div class="toolbar">${button('loan', 'Request bullet loan', '', 'primary', !permitted('finance'))}${button('annuity', 'Request annuity loan', '', '', !permitted('finance'))}${button('deposit', 'Place deposit', '', '', !permitted('finance'))}</div><div class="value-list"><div><span>Inventory at cost</span><strong>${money(a.inventory)}</strong></div><div><span>Purchased goods in transit</span><strong>${money(a.inbound)}</strong></div><div><span>Inventory value in transit</span><strong>${money(a.transit)}</strong></div><div><span>Locked term deposits</span><strong>${money(a.deposits)}</strong></div></div>`)}${panel('Income statement', `Cumulative · live through ${simDate(state.hour)}`, `<div class="value-list"><div><span>Revenue earned at ${state.accounting?.revenueAt === 'dispatch' ? 'dispatch' : 'customer receipt'}</span><strong>${money(-a.revenue)}</strong></div>${inventoryStatementLines(c)}<div><span>Operating costs & depreciation</span><strong>${money(a.expense)}</strong></div>${expenseBreakdown(c.ledger)}<div><span>Interest income</span><strong>${money(-a.interestIncome)}</strong></div><div><span>Net profit</span><strong>${money(c.profit)}</strong></div></div>`)}</div>${panel('Scheduled cash movements', 'Committed events only. Excludes future trading, recurring costs, and payments not yet scheduled by receipt.', table(['Simulation time', 'Event', 'Cash movement', 'Status'], c.forecast.map(f => [sortCell(simDate(f.hour), f.hour), esc(f.description), sortCell(exactMoney(f.amount), f.amount), f.blocked ? esc(f.blocked) : 'Scheduled'])))}${panel('Finance contracts', 'Outstanding loans and locked deposits remain visible at the session end.', table(['Contract', 'Principal', 'Interest at maturity', 'Funding / placement', 'Completion'], [...c.loans.map(l => [esc(l.id), sortCell(money(l.amount), l.amount), sortCell(exactMoney(l.interest), l.interest), sortCell(l.fundedAt === null ? 'Pending funding' : simDate(l.fundedAt), l.fundedAt), sortCell(l.paidAt === null ? 'Repayment pending' : simDate(l.paidAt), l.paidAt)]), ...c.deposits.map(d => [esc(d.id), sortCell(money(d.amount), d.amount), sortCell(exactMoney(d.interest), d.interest), sortCell(simDate(d.placedAt), d.placedAt), sortCell(d.maturedAt === null ? `Due ${simDate(d.placedAt + d.term)}` : simDate(d.maturedAt), d.maturedAt ?? d.placedAt + d.term)])]))}${panel('Transaction journal', 'Double-entry ledger · debits positive, credits negative · all values EUR', `<details data-view-key="ledger-entries"><summary>Show latest 100 entries (${c.ledger.length} total)</summary>${table(['Time', 'Description', 'Postings'], c.ledger.slice(-100).reverse().map(l => [sortCell(simDate(l.hour), l.hour), esc(l.description), sortCell(Object.entries(l.lines).map(([k, v]) => `${esc(k)}: ${exactMoney(v)}`).join('<br>'), Object.keys(l.lines)[0])]))}</details>`, button('ledger-csv', 'Export ledger', '', 'small'))}`;
}
function energyPage(mode = 'all') {
  const c = company(), pendingEnergy = state.events.find(e => e.companyId === c.id && e.type === 'energy' && e.status === 'pending');
  const pendingProvider = pendingEnergy && (pendingEnergy.data.terms || state.catalog.energy.find(e => e.id === pendingEnergy.data.energyId));
  const energyOptions = state.catalog.energy.filter(e => e.enabled || e.id === c.energy || e.id === pendingEnergy?.data.energyId).map(e => e.id === c.energy && c.energyTerms ? { ...e, ...c.energyTerms } : e.id === pendingEnergy?.data.energyId && pendingEnergy.data.terms ? { ...e, ...pendingEnergy.data.terms } : e);
  const html = `${pendingEnergy ? `<div class="advice"><strong>Switch to ${esc(pendingProvider?.name || pendingEnergy.data.energyId)} pending.</strong>Effective ${simDate(pendingEnergy.at)}. Your current contract remains active until then; another switch cannot be placed while this one is pending.</div>` : ''}<div class="advice"><strong>Carbon information and demand effects are separate.</strong>Carbon is always measured. Customer preference for lower carbon is currently <b>${state.effects.carbonDemand ? 'enabled' : 'disabled'}</b>. A new energy contract changes future production; existing inventory keeps its embodied footprint.</div>${panel('Choose your electricity', 'Tariffs are EUR/kWh by 8-hour shift. Standing charge is EUR/day.', table(['Provider', '12am–8am / 8am–4pm / 4pm–12am', 'Standing charge', 'Switch fee / delay', 'kg CO₂e/kWh', ''], energyOptions.map(e => [esc(e.name), sortCell(e.rates.map(r => exactMoney(r)).join(' / '), e.rates[0]), sortCell(exactMoney(e.daily), e.daily), sortCell(`${money(e.fee)} / ${e.delay} h`, e.fee), sortCell(precise(e.carbon), e.carbon), e.id === c.energy ? '<span class="badge">Current contract</span>' : e.id === pendingEnergy?.data.energyId ? '<span class="badge amber">Switch pending</span>' : button('energy-switch', 'Switch', e.id, 'small', !permitted('energy') || !!pendingEnergy)])))}<div class="grid3">${Object.entries(INVESTMENTS).map(([key, inv]) => { const contract = c.investments.filter(x => x.kind === key).at(-1), active = contract?.activeAt !== null && contract?.activeAt !== undefined; return `<section class="panel investment"><div class="invest-icon">${icon(key === 'efficiency' ? 'energy' : 'production')}</div><h2>${esc(inv.name)}</h2><p>${({ delivery: 'Dispatch oldest orders using the cheapest route that can meet the promise, with a delay buffer.', purchasing: 'Reorder components hourly when stock plus incoming supply reaches your policy threshold.', machine: 'Add six modules per hour of machine capacity. Materials and staff still limit output.', warehouse: 'Expand every stock location by 50%. Reduce pressure on storage space.', efficiency: 'Reduce production electricity per module by 25% after commissioning.' })[key]}</p><div class="price">${money(inv.cost)}</div><p>${inv.delay} h to activate · prepaid<br>${contract ? (active ? `Active since ${simDate(contract.activeAt)}` : 'Installation pending') : 'Not installed'}</p>${button('invest', contract && !active ? 'Pending' : active && !['machine', 'warehouse'].includes(key) ? 'Active' : 'Invest', key, 'small', !permitted('investments') || (contract && (!active || !['machine', 'warehouse'].includes(key))))}</section>`; }).join('')}</div>${panel('Research & market presence', 'Daily recurring budgets · diminishing quality and marketing effects.', `<div class="value-list"><div><span>Quality multiplier</span><strong>${c.quality.toFixed(3)}</strong></div><div><span>Daily research</span><strong>${money(c.research)}</strong></div><div><span>Daily marketing</span><strong>${money(c.marketing)}</strong></div></div>${button('budget', 'Edit daily budgets', '', '', !permitted('investments'))}`)}`;
  const split = html.indexOf('<div class="grid3">');
  return mode === 'suppliers' ? html.slice(0, split) : mode === 'investments' ? html.slice(split) : html;
}

const reportTypes = { profit: ['Cumulative net profit', 'EUR'], dailySales: ['Daily revenue earned', 'EUR'], dailyProduction: ['Daily production', 'modules'], cash: ['Cash balance', 'EUR'], inventory: ['Finished inventory', 'modules'], energyCost: ['Cumulative energy cost', 'EUR'], energyKwh: ['Cumulative electricity', 'kWh'], emissions: ['Cumulative carbon', 'kg CO₂e'], marketShare: ['Cumulative delivered market share', '%'], dispatched: ['Cumulative dispatches', 'modules'], received: ['Cumulative customer receipts', 'modules'] };
function reportSnapshots(range) {
  const lastClose = state.snapshots.at(-1)?.hour ?? 0;
  return state.snapshots.filter(s => s.hour > lastClose - range * 24);
}
function reportValue(value, unit) {
  return new Intl.NumberFormat('en-GB', unit === 'EUR'
    ? {minimumFractionDigits:2,maximumFractionDigits:2}
    : {maximumFractionDigits:4}).format(value);
}
function helpPage() {
  const recipe = Object.entries(productionRecipe(state)).map(([key, qty]) => `${number(qty)} × ${esc(itemName(state, key))}`).join(' + ');
  const section = (id, title, body) => `<details class="help-section" data-view-key="help-${id}"><summary>${title}</summary><div class="help-section-body">${body}</div></details>`;
  return `<div class="help-guide"><section class="help-start panel"><p class="eyebrow">Start here</p><h2>A clear decision cycle</h2><p>Run a solar-panel company by balancing delivery promises, production, cash and carbon. Work through these four checks whenever the simulation advances.</p><ol class="help-steps"><li><strong>Review commitments</strong><span>Find the earliest customer deadlines and quantities still to dispatch.</span></li><li><strong>Check supply</strong><span>Compare finished stock, component shortages and incoming deliveries.</span></li><li><strong>Plan production</strong><span>Match shifts, workers and machines to the materials you can use.</span></li><li><strong>Deliver and review</strong><span>Choose a feasible route, then check receipts, cash and daily results.</span></li></ol><div class="toolbar help-shortcuts">${button('nav', 'Open orders', 'orders', 'primary')}${button('nav', 'View inventory', 'supply')}${button('nav', 'View reports', 'reports')}</div></section><section class="help-data panel"><h2>About the supplier data</h2><p>The supplier data used in this simulation corresponds to real data collected from several suppliers. The sections below explain how to use the catalogue and how decisions affect the simulation.</p></section><h2 class="help-topics-heading">Explore the decisions</h2><div class="help-topics">
    ${section('team', 'Team responsibilities and planning', '<p>Coordinate purchasing, inventory, production, deliveries and sales around one shared demand plan. Agree who checks each area, share changes in Messages and review the consequences together.</p><ul><li><strong>Purchasing:</strong> plan component orders from expected sales, current stock and supplier lead times.</li><li><strong>Inventory:</strong> monitor shortages and keep a sensible safety stock without tying up excessive cash.</li><li><strong>Production:</strong> choose shifts and capacity that match available materials and delivery commitments.</li><li><strong>Deliveries:</strong> prioritize customer deadlines and compare feasible transport routes.</li><li><strong>Sales:</strong> offer prices, quantities and promises the company can fulfil in each market.</li><li><strong>Analysis and planning:</strong> compare demand, competitor results, cash and profit; review funding needs and revise the plan before advancing time.</li></ul>')}
    ${section('clock', 'The clock, decisions and pending outcomes', '<p>The date at the top of the workspace is simulation time (UTC). While paused, you can still submit decisions, but production, deliveries and scheduled changes wait for the clock to advance.</p><p>A confirmation tells you whether a decision takes effect now or creates a future event. Check activation dates before relying on a new shift, worker, machine or energy contract. Accepted contracts retain their terms; there is no cancellation of committed contracts.</p><p>Open several panels to compare information. The highlighted sidebar button follows the selected panel. Use the × in a panel header to close it.</p>')}
    ${section('orders', 'Sales offers, orders and transport', '<p><strong>Sales offers:</strong> set price, minimum/maximum order quantity, delivery promise, payment terms and whether to accept new orders. Edits affect future orders; they do not rewrite existing promises. Demand is allocated every six simulation hours, influenced by price, delivery, payment, satisfaction, quality, marketing and enabled carbon preferences.</p><p><strong>Dispatch:</strong> choose an order, quantity and transport route. Partial shipments are allowed, and each shipment pays its own fixed freight fee. Dispatch reduces finished stock; customer receipt happens later.</p><p>The form shows hours remaining and each route’s arrival margin. Green means before the deadline; red means after it. Also check the margin with the full carrier delay. Arrival more than 24 hours early can incur a small satisfaction penalty, so green does not always mean ideal. Compare freight cost and carbon after checking feasibility.</p><p>Click a table heading for decreasing ▼, then increasing ▲, then original order. Sort <strong>Order / market</strong> increasing for the oldest order; sort <strong>Promised arrival</strong> increasing for the earliest deadline.</p>')}
    ${section('supply', 'Inventory, suppliers and replenishment', `<p><strong>This session’s recipe:</strong> ${recipe} per finished module.</p><p>Inventory shows stock, capacity, material requirements and incoming purchases. The limiting component determines how much you can assemble. Buying more of another component does not remove that bottleneck.</p><p>Compare unit price, fixed order fee, lead time, reliability, carbon, minimum quantity, lot size and payment terms. Supplier stock is shared across companies. A purchase commits you to a payable; components become usable on receipt and payment follows the accepted term.</p><p>After installing the replenishment assistant, set a supplier, reorder point and order quantity for each component. It checks stock plus incoming supply hourly. Review its status when credit, stock, capacity or permissions block a purchase.</p>`)}
    ${section('production', 'Production, staffing and investments', '<p>Each assembly line supports 6 modules/hour; each worker supports 2 modules/hour. Actual output is constrained by machines, workers, materials, warehouse space and available cash.</p><p>Choose the 00–08, 08–16 and 16–24 shifts. Schedule changes take effect at the next eight-hour boundary. Active-shift wages are paid even if materials run out. Staffing changes take 48 hours; a new assembly line takes 72 hours.</p><p>Investments can add capacity, warehouse space, energy efficiency or automation. They cost cash now and become usable after installation. Adding a machine will not help if materials or workers remain the bottleneck.</p><p>The dispatch assistant works on the oldest open order and selects a low-cost route that can meet the promise with a delay buffer. Check its next-action explanation rather than assuming installation means immediate dispatch.</p>')}
    ${section('energy', 'Energy, carbon, research and marketing', '<p>Compare electricity tariffs by shift, daily standing charges, switching fees, activation delays and carbon intensity. A new energy contract changes future production. Existing stock retains its embodied carbon.</p><p>Operational carbon includes received components and inbound transport, production electricity and outbound freight. Lower-carbon choices can affect customer demand when the instructor enables that preference.</p><p>Daily research gradually improves quality; daily marketing influences demand. Both create recurring costs. Review capacity before increasing demand, and compare the benefit with the cash commitment.</p>')}
    ${section('finance', 'Cash, profit, payments and financing', `<p><strong>Cash and profit are different.</strong> This session recognizes sales at ${state.accounting?.revenueAt === 'dispatch' ? 'dispatch' : 'customer receipt'}. Customer payment still follows actual receipt plus the accepted payment term. A shipped order can therefore be unpaid.</p><p>Finance separates receivables, supplier payables, debt, stock and locked deposits. Scheduled cash movements include committed events only, not all future wages, overhead or new trading. The transaction journal explains each posting.</p><p>Bullet loans fund after 24 hours; annuity loans after 48 hours. Review repayment dates and interest before borrowing. Term deposits lock cash until maturity with no early withdrawal. Keep enough liquidity for wages, freight, materials and scheduled obligations.</p><p>Daily rent, energy standing charges, budgets and depreciation affect profit. Depreciation is not a cash payment. If a due payment lacks cash, the obligation remains and is retried.</p>`)}
    ${section('kpi-guide', 'Where to find company KPIs', table(['Management area', 'KPI', 'Open report'], [
      ['Procurement and cost management', 'Average purchase price and ordering costs', 'procurementCosts'],
      ['Inventory and warehousing', 'Inventory levels', 'stock'],
      ['Inventory and warehousing', 'Warehousing costs', 'warehouseCosts'],
      ['Inventory and warehousing', 'Waste from inventories', 'waste'],
      ['Customer service and delivery', 'Open order backlog', 'openOrders'],
      ['Customer service and delivery', 'Delivery accuracy (arrivals within the promised window)', 'reliability'],
      ['Customer service and delivery', 'Transportation costs', 'transportCosts'],
      ['Production and workforce management', 'Production shift work salaries and capacity utilization', 'utilization'],
      ['Financial and performance metrics', 'Income statement', 'income'],
      ['Financial and performance metrics', 'Gross profit, net profit and margins', 'profitability']
    ].map(([area, measure, id]) => [area, measure, company() && studentPanelVisible('report-' + id, workspaceFeatureVisible) ? button('open-workspace-panel', operationalReports[id][1], 'report-' + id, 'small') : esc(operationalReports[id][1])])))}
    ${section('reports', 'Reports and performance', '<p>Operational panels show live state. Reports show frozen snapshots taken at each midnight close, so today’s decisions may not appear in the chart yet.</p><p>Choose a measure and time window, select companies to compare, and open the exact-values table when you need precise numbers. Export CSV uses the selected report and time window. Daily sales and production are changes between closes; cash, inventory and cumulative measures describe each close.</p><p>Judge decisions across profit, cash, delivery service and carbon together. A high cash balance alone does not show whether customer promises are being met.</p>')}
    ${section('messages', 'Messages, announcements and teamwork', '<p>Open <strong>Messages</strong> for one feed of instructor announcements, your team’s messages and conversations with the instructor. Each item names its conversation and sender.</p><p><strong>Show messages</strong> filters what you read. <strong>Send to</strong> chooses who receives your next message. Team messages stay inside your company; instructor conversations include your company and the instructor. Only instructors post class announcements.</p>')}
    ${section('troubleshooting', 'When an action does not work', '<ul><li><strong>Disabled control:</strong> check stock, feature permissions, pending changes and whether the session has ended.</li><li><strong>Production stopped:</strong> check the active shift, limiting component, staffing, machine capacity, storage and cash.</li><li><strong>State changed:</strong> review the refreshed quote before retrying. A confirmation is required before treating a decision as accepted.</li><li><strong>Connection interrupted:</strong> keep the draft and use the pending-decision retry to avoid duplicating a commitment.</li><li><strong>Temporary test round:</strong> keep a test tab open. Test decisions are not saved as permanent classroom records.</li></ul>')}
    ${isTeacher() ? section('instructor', 'Instructor controls and decision timing', '<p>Session control manages the clock, feature visibility, decision permissions and future catalogue conditions. Company previews are read-only. Use announcements for class-wide guidance and instructor conversations for company-specific discussion.</p><p><strong>Student decision timing</strong> lists accepted decisions with real UTC timestamps and simulation times. Open a student’s history or export CSV. A rapid pattern is flagged for review at 4 decisions within 2 seconds or 6 within 10 seconds. Timing alone does not prove AI use; the indicator never changes grades or access.</p>') : ''}
    </div></div>`;
}
function reportsPage() {
  const [title, unit] = reportTypes[report];
  const snaps = reportSnapshots(reportRange);
  return `<div class="advice"><strong>Daily reports are frozen at each midnight close.</strong>Last close: ${state.snapshots.length ? simDate(state.snapshots.at(-1).hour) : 'none yet'}. Live operations: ${simDate(state.hour)}. Each close includes that hour’s arrivals, production, demand, automation, costs, and depreciation.</div><div class="toolbar control-toolbar">${select('report', 'Measure', Object.entries(reportTypes).map(([k, [n]]) => [k, n]), report)}${select('range', 'Time window', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['180', 'Full session']], String(reportRange))}${button('report-csv', 'Export CSV', '', 'small')}</div>${panel(title, `${unit} · daily snapshots`, `<div class="toolbar">${state.companies.map(c => check(`series-${c.id}`, c.name, !selectedCompanies.size || selectedCompanies.has(c.id))).join('')}</div>${chart(report, unit, { selected: true, range: reportRange })}`)}${panel('Exact daily values', 'Accessible data table · one row per company per completed day', `<details data-view-key="report-values"><summary>Show report values</summary>${table(['As of (simulation)', 'Company', `${esc(title)} (${unit})`], reportRows(snaps, true).map(row => [sortCell(simDate(row[0]), row[0]), esc(row[1]), sortCell(reportValue(row[2], unit), row[2])]))}</details>`)}`;
}
function reportRows(snaps = state.snapshots, rawTime = false) { return snaps.flatMap(s => s.companies.filter(c => !selectedCompanies.size || selectedCompanies.has(c.id)).map(c => { const prev = state.snapshots.find(x => x.hour === s.hour - 24)?.companies.find(x => x.id === c.id); let n = report === 'dailySales' ? c.revenue - (prev?.revenue || 0) : report === 'dailyProduction' ? c.production - (prev?.production || 0) : c[report]; if (reportTypes[report][1] === 'EUR') n /= 100; return [rawTime ? s.hour : simDate(s.hour), c.name, n]; })); }
function channelOptions() { return [['announcements', 'Instructor announcements'], ...(isTeacher() ? state.companies.map(c => [`teacher:${c.id}`, `Teacher ↔ ${c.name}`]) : [[`team:${actor.companyId}`, 'My team'], [`teacher:${actor.companyId}`, 'Ask the instructor']])]; }
function messageStyle(message) {
  if (message.channel === 'announcements') return 'message-announcement';
  if (message.channel.startsWith('team:')) return message.senderId === actor.id ? 'message-sent' : 'message-received';
  return 'message-conversation';
}
let typingJob = null, typingInputAt = 0;
function setTypingIndicator(notice, active) {
  if (!notice || notice.dataset.typing === String(active)) return;
  // Keep existing dots between polls so their animation never restarts.
  notice.dataset.typing = String(active);
  notice.innerHTML = active ? '<span class="typing-bubble" aria-hidden="true"><span></span><span></span><span></span></span><span class="typing-accessible">A teammate is typing</span>' : '';
}
function typingContext() {
  if (!state || !sessionId || solo || preview || actor?.role !== 'student' || document.hidden
      || state.status === 'completed' || state.studentAccess === false
      || !state.features.messaging?.allowed || !state.features.messaging?.visible
      || (!testRoom && !health?.typingPresence) || !root.querySelector('[data-team-typing]')) return null;
  const textarea = root.querySelector('#message-form textarea');
  const teamRecipient = root.querySelector('#message-form [name=recipient]')?.value === `team:${actor.companyId}`;
  return { scope: JSON.stringify([connectionScope(), actor.id, actor.companyId, channel]),
    active: !!(teamRecipient && textarea?.value.trim() && document.activeElement === textarea && Date.now() - typingInputAt < 4000) };
}
function stopTypingJob() {
  const old = typingJob; typingJob = null; typingInputAt = 0;
  if (old?.sent) void (old.pending || Promise.resolve()).then(() => old.request(false)).catch(() => {});
}
async function syncTyping(fromInput = false) {
  const context = typingContext();
  if (typingJob && typingJob.scope !== context?.scope) stopTypingJob();
  if (!context) return;
  if (!typingJob) {
    const client = testRoom, path = `${backend}/api/sessions/${encodeURIComponent(sessionId)}/typing`;
    const auth = firebaseClient, localToken = token;
    typingJob = { scope: context.scope, active: false, sent: false, lastPost: 0, pending: null,
      request: async active => {
        if (client) return client.call('typing', active === undefined ? undefined : { active });
        const authorization = auth?.user ? await auth.token() : localToken;
        const response = await fetch(path, { method: active === undefined ? 'GET' : 'POST', cache: 'no-store',
          headers: { Authorization: `Bearer ${authorization}`, ...(active === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(active === undefined ? {} : { body: JSON.stringify({ active }) }), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Typing status unavailable');
        return response.json();
      } };
  }
  const job = typingJob;
  if (job.pending) return;
  if (fromInput && context.active === job.active && (!context.active || Date.now() - job.lastPost < 2000)) return;
  const update = context.active ? true : job.active ? false : undefined;
  if (update !== undefined) { job.sent = true; job.active = update; job.lastPost = Date.now(); }
  job.pending = (async () => {
    try {
      const result = await job.request(update);
      if (typingJob === job && typingContext()?.scope === job.scope) {
        const notice = root.querySelector('[data-team-typing]');
        setTypingIndicator(notice, !!result.typing);
      }
    } catch {
      if (typingJob === job) {
        const notice = root.querySelector('[data-team-typing]');
        setTypingIndicator(notice, false);
      }
    } finally { job.pending = null; }
  })();
  await job.pending;
}
document.addEventListener('input', event => {
  if (event.target.matches?.('#message-form textarea')) { refreshMessagePreview(event.target.closest('form')); typingInputAt = Date.now(); void syncTyping(true); }
});
document.addEventListener('focusout', event => {
  if (event.target.matches?.('#message-form textarea')) { typingInputAt = 0; void syncTyping(true); }
});
// Message formatting is a small, HTML-free Markdown subset. Stored messages stay
// plain text so existing servers, exports and replay keep the same wire format.
const readyMessages = ['Clock is stopped', 'Clock will be stopped in 10 minutes', 'Clock will be stopped in 5 minutes', 'Please come to the video meeting'];
function messageInline(text, depth = 0) {
  if (depth > 4) return esc(text);
  const token = /(!?\[([^\]\n]*)\]\(([^\s)]+)\)|\*\*([^\n]+?)\*\*(?!\*)|\*([^*\n]+)\*|~~([^~\n]+)~~)/g;
  let html = '', offset = 0;
  for (const match of text.matchAll(token)) {
    html += esc(text.slice(offset, match.index));
    const [raw, , label, url, bold, italic, strike] = match;
    if (url) {
      let safe = false;
      try { const parsed = new URL(url); safe = /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password; } catch {}
      html += !safe ? esc(raw) : raw.startsWith('!')
        ? `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy" referrerpolicy="no-referrer">`
        : `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    } else {
      const tag = bold !== undefined ? 'strong' : italic !== undefined ? 'em' : 's';
      html += `<${tag}>${messageInline(bold ?? italic ?? strike, depth + 1)}</${tag}>`;
    }
    offset = match.index + raw.length;
  }
  return html + esc(text.slice(offset));
}
function renderMessageText(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n'), blocks = [];
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.includes('|') && lines[i + 1]?.includes('|') && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const header = cells(line); i += 2;
      let rows = '';
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const row = cells(lines[i++]);
        rows += `<tr>${header.map((label, n) => tableCell(messageInline(row[n] || ''), sortText(messageInline(label)))).join('')}</tr>`;
      }
      i--;
      blocks.push(`<div class="table-wrap"><table class="responsive-table" role="table"><thead><tr>${header.map(cell => `<th scope="col">${messageInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(`<h${heading[1].length + 2}>${messageInline(heading[2])}</h${heading[1].length + 2}>`); continue; }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(messageInline(lines[i++].replace(/^>\s?/, '')));
      i--; blocks.push(`<blockquote>${quote.join('<br>')}</blockquote>`); continue;
    }
    const list = /^(?:[-*]|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = /^\d/.test(line), pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) items.push(`<li>${messageInline(lines[i++].replace(pattern, ''))}</li>`);
      i--; const tag = ordered ? 'ol' : 'ul'; blocks.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    const paragraph = [messageInline(line)];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:#{1,3}\s|>\s?|[-*]\s|\d+\.\s)/.test(lines[i + 1]) && !(lines[i + 1].includes('|') && lines[i + 2]?.includes('|'))) paragraph.push(messageInline(lines[++i]));
    blocks.push(`<p>${paragraph.join('<br>')}</p>`);
  }
  return blocks.join('');
}
function messageComposer() {
  const tools = [['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['strike', '<s>S</s>', 'Strikethrough'], ['h1', 'H₁', 'Heading 1'], ['h2', 'H₂', 'Heading 2'], ['h3', 'H₃', 'Heading 3'], ['quote', '❝', 'Quote'], ['bullet', '• List', 'Bulleted list'], ['number', '1. List', 'Numbered list'], ['link', 'Link', 'Insert link'], ['image', 'Image', 'Insert image URL'], ['table', 'Table', 'Insert table']];
  const toolbar = `<div class="message-format-toolbar" role="group" aria-label="Message formatting">${tools.map(([id, label, title]) => `<button type="button" class="small" data-message-tool="${id}" title="${title}" aria-label="${title}">${label}</button>`).join('')}<button type="button" class="small" data-message-tool="preview" aria-expanded="false" aria-controls="message-preview">Preview</button></div>`;
  return `<div class="message-compose-layout${isTeacher() ? ' with-ready-messages' : ''}"><div class="message-editor"><label for="message-text">Your message</label>${isTeacher() ? toolbar : ''}<textarea id="message-text" name="text" rows="8" maxlength="2000" placeholder="Share a decision, ask a question, or coordinate a next step…" required aria-describedby="message-writing-help"></textarea><p class="form-note" id="message-writing-help">${isTeacher() ? 'Select text and choose formatting, or write Markdown. Preview shows how students will see it. ' : ''}Up to 2,000 characters.</p>${isTeacher() ? '<div id="message-preview" class="message-body message-preview" hidden></div><details class="message-format-help" data-view-key="message-format-help"><summary>Formatting help</summary><p>Use **bold**, *italic*, ~~strikethrough~~, # headings, &gt; quotes, - bullet lists, or 1. numbered lists. Link and Image insert examples: replace the selected URL with an https:// address. Tables use | between columns and --- below the header. HTML is displayed as text.</p></details>' : ''}</div>${isTeacher() ? `<aside class="ready-messages" aria-labelledby="ready-messages-title"><h3 id="ready-messages-title">Ready messages</h3><p class="form-note">Add to your draft, then send when ready.</p>${readyMessages.map((text, i) => `<button type="button" data-ready-message="${i}">${esc(text)}</button>`).join('')}</aside>` : ''}</div>`;
}
function refreshMessagePreview(form) {
  const preview = form.querySelector('#message-preview');
  if (preview && !preview.hidden) preview.innerHTML = renderMessageText(form.querySelector('textarea').value) || '<p class="muted">Your preview will appear here.</p>';
}
function editMessage(control) {
  const form = control.closest('#message-form'), input = form?.querySelector('textarea');
  if (!input || !isTeacher()) return;
  const tool = control.dataset.messageTool;
  if (tool === 'preview') {
    const preview = form.querySelector('#message-preview'); preview.hidden = !preview.hidden;
    control.setAttribute('aria-expanded', String(!preview.hidden)); refreshMessagePreview(form); return;
  }
  let start = input.selectionStart, end = input.selectionEnd, selected = input.value.slice(start, end), insert, selection;
  if (control.dataset.readyMessage !== undefined) {
    const ready = readyMessages[Number(control.dataset.readyMessage)]; if (!ready) return;
    start = end = input.value.length; insert = (input.value.trim() ? '\n\n' : '') + ready;
  } else if (['bold', 'italic', 'strike'].includes(tool)) {
    const marker = { bold: '**', italic: '*', strike: '~~' }[tool];
    const body = selected || 'text'; insert = marker + body + marker; selection = [start + marker.length, start + marker.length + body.length];
  } else if (['h1', 'h2', 'h3', 'quote', 'bullet', 'number'].includes(tool)) {
    start = start === 0 ? 0 : input.value.lastIndexOf('\n', start - 1) + 1;
    const newline = input.value.indexOf('\n', end); end = newline === -1 ? input.value.length : newline;
    selected = input.value.slice(start, end) || 'text';
    const prefix = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', bullet: '- ', number: '1. ' }[tool];
    insert = selected.split('\n').map((line, i) => (tool === 'number' ? `${i + 1}. ` : prefix) + line).join('\n');
  } else if (tool === 'link' || tool === 'image') {
    const label = (selected || (tool === 'image' ? 'Image description' : 'Link text')).replace(/[\[\]\n]/g, ' ');
    const url = 'https://example.com/' + (tool === 'image' ? 'image.png' : '');
    insert = `${tool === 'image' ? '!' : ''}[${label}](${url})`;
    selection = [start + insert.indexOf(url), start + insert.indexOf(url) + url.length];
  } else if (tool === 'table') {
    insert = `${start && input.value[start - 1] !== '\n' ? '\n' : ''}| Topic | Details |\n| --- | --- |\n| Decision | Next step |\n`;
  } else return;
  if (input.value.length - (end - start) + insert.length > input.maxLength) {
    form.querySelector('.error').textContent = 'This addition would exceed the 2,000-character message limit.'; return;
  }
  input.setRangeText(insert, start, end, 'end');
  if (selection) input.setSelectionRange(...selection);
  form.querySelector('.error').textContent = ''; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true }));
}
// End message formatting helpers.

function messagesPage() {
  const conversations = channelOptions(), options = [['all', 'All messages'], ...(company() ? [['business', 'Business updates']] : []), ...conversations];
  if (!options.some(x => x[0] === channel)) channel = 'all';
  if (channel === 'business') return `<div class="toolbar">${select('channel', 'Show messages', options, channel)}${soundControl()}</div>${businessUpdatesPanel()}`;
  const labels = new Map(conversations);
  // The server already filters membership; also limit the feed to this role's channels.
  const messages = state.messages.filter(m => labels.has(m.channel) && (channel === 'all' || m.channel === channel));
  const recipients = conversations.filter(([id]) => isTeacher() || id !== 'announcements');
  const recipient = recipients.some(([id]) => id === channel) ? channel : recipients[0]?.[0];
  const canSend = (state.status !== 'completed' || isTeacher()) && state.features.messaging.allowed && !!recipient;
  return `<div class="toolbar">${select('channel', 'Show messages', options, channel)}${soundControl()}${company() ? button('business-updates', 'Business updates', '', 'small') : ''}<span class="form-note">Announcements and conversations appear together. Only messages available to your account are shown.</span></div>${panel(esc(options.find(x => x[0] === channel)?.[1]), 'Real and simulation times are shown separately.', `<div class="messages" data-view-key="messages">${messages.map(m => `<article class="message ${messageStyle(m)}"><div class="message-header">${m.channel === 'announcements' ? '<span>Instructor announcement</span>' : m.channel.startsWith('teacher:') ? `<span>${esc(labels.get(m.channel))}</span>` : ''}<span>${esc(m.senderName)}</span></div><div class="message-body">${m.role === 'instructor' ? renderMessageText(m.text) : `<p>${esc(m.text)}</p>`}</div><small>Real time: ${new Date(m.realAt).toLocaleString('en-GB')} · Simulation: ${simDate(m.hour)}</small></article>`).join('') || '<p class="empty">No messages in this view yet.</p>'}</div>${actor.role === 'student' && (channel === 'all' || channel === `team:${actor.companyId}`) ? '<p class="team-typing" data-team-typing role="status" aria-live="polite" aria-label="Team typing status"></p>' : ''}${canSend ? `<form id="message-form">${select('recipient', 'Send to', recipients, recipient)}<p class="form-note">Your message goes only to the selected conversation. Only instructors can post announcements.</p>${messageComposer()}${button('submit', 'Send message', '', 'primary')}<div class="error" role="alert"></div></form>` : '<p class="form-note">Messaging is read-only for your role or disabled.</p>'}`)}`;
}
const studentDecisionTypes = new Set(['offer', 'purchase', 'writeOff', 'dispatch', 'shifts', 'staff', 'loan', 'deposit', 'energy', 'invest', 'reorder', 'budget']);
function decisionTiming(audit = state?.audit || []) {
  const players = new Map();
  for (const entry of audit) {
    if (entry.role !== 'student' || !entry.actorId || !studentDecisionTypes.has(entry.command?.type)) continue;
    if (!players.has(entry.actorId)) players.set(entry.actorId, { id: entry.actorId, name: entry.actorName, companyId: entry.companyId, entries: [] });
    const player = players.get(entry.actorId);
    player.name = entry.actorName; player.companyId = entry.companyId;
    player.entries.push({ ...entry, timestamp: Date.parse(entry.realAt) });
  }
  return [...players.values()].map(player => {
    const timed = player.entries.filter(entry => Number.isFinite(entry.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
    let previous = null, minimumGap = null, rapidPairs = 0, peak2 = 0, peak10 = 0, start2 = 0, start10 = 0;
    for (let i = 0; i < timed.length; i++) {
      const entry = timed[i]; entry.gap = previous === null ? null : entry.timestamp - previous;
      if (entry.gap !== null) { minimumGap = minimumGap === null ? entry.gap : Math.min(minimumGap, entry.gap); if (entry.gap < 1000) rapidPairs++; }
      previous = entry.timestamp;
      while (entry.timestamp - timed[start2].timestamp > 2000) start2++;
      while (entry.timestamp - timed[start10].timestamp > 10000) start10++;
      peak2 = Math.max(peak2, i - start2 + 1); peak10 = Math.max(peak10, i - start10 + 1);
    }
    return { ...player, timed, minimumGap, rapidPairs, peak2, peak10, review: peak2 >= 4 || peak10 >= 6, missing: player.entries.length - timed.length, latest: timed.at(-1)?.timestamp ?? null };
  });
}
const timingSeconds = ms => ms == null ? '—' : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(ms / 1000)} s`;
function decisionTimingPanel() {
  if (!isTeacher()) return '';
  const players = decisionTiming();
  return panel('Student decision timing', 'Potential automation indicator · instructor review only', `<p class="form-note">Accepted business decisions are recorded with the student identity, real date/time (UTC, including milliseconds), and simulation time. Menu clicks, messages, automatic production and deliveries are excluded.</p><div class="advice"><strong>Rapid timing is a review signal, not proof of AI use.</strong>Flagged when one student submits at least 4 accepted decisions within 2 seconds, or 6 within 10 seconds. Rapid manual entry, accessibility tools, shared accounts and network timing can also explain a burst. No flag does not rule out automation. These thresholds are heuristics, not a validated AI detector; no grades or access change.</div>${health?.demo || solo || testRoom ? '<p class="form-note">This is a demo or test round: timing may reflect generated setup data or agent-assisted testing.</p>' : ''}${table(['Student', 'Company', 'Decisions', 'Fastest gap', 'Gaps under 1 s', 'Most in 10 s', 'Potential automation', 'Latest decision (UTC)', ''], players.map(p => [esc(p.name || p.id), esc(state.companies.find(c => c.id === p.companyId)?.name || '—'), p.entries.length, sortCell(timingSeconds(p.minimumGap), p.minimumGap), p.rapidPairs, p.peak10, p.review ? '<span class="badge amber">Rapid pattern — review</span>' : p.timed.length < 4 ? 'Limited data' : 'No rapid pattern detected', sortCell(p.latest === null ? 'Unknown timestamp' : new Date(p.latest).toISOString(), p.latest), button('decision-timing', 'View decisions', p.id, 'small')]), 'No accepted student decisions yet. Students appear after their first business decision.')}${players.some(p => p.missing) ? '<p class="form-note">Some historical decisions have missing or invalid timestamps; they are listed but excluded from timing calculations.</p>' : ''}`, button('decision-timing-csv', 'Export decision timestamps', '', 'small', !players.length));
}
function decisionTimingRows(player) {
  const entries = [...player.timed, ...player.entries.filter(entry => !Number.isFinite(entry.timestamp))];
  return entries.map(entry => [entry.timestamp !== undefined && Number.isFinite(entry.timestamp) ? new Date(entry.timestamp).toISOString() : 'Unknown timestamp', simDate(entry.hour), entry.command.type, timingSeconds(entry.gap), entry.result]);
}
// Seconds per simulation hour: smaller values mean a faster clock.
// Teaching presets cover 6–45 s/h; other supported rates remain custom.
// Half-second midpoints round up to the engine's whole-second precision.
const clockSpeedBands = [
  { id: 'very-slow', label: 'Very slow', min: 35, max: 45 },
  { id: 'slow', label: 'Slow', min: 25, max: 34 },
  { id: 'medium', label: 'Medium', min: 16, max: 24 },
  { id: 'brisk', label: 'Brisk', min: 12, max: 15 },
  { id: 'fast', label: 'Fast', min: 9, max: 11 },
  { id: 'very-fast', label: 'Very fast', min: 6, max: 8 }
];
const clockSpeedBand = speed => clockSpeedBands.find(band => speed >= band.min && speed <= band.max);
const clockBandMidpoint = band => Math.round((band.min + band.max) / 2);
function adminClock() {
  const date = new Date(Date.parse(state.startDate) + state.hour * 3600000);
  const dateLabel = date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = date.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).replace(/(\d)\s+(am|pm)/i, '$1$2');
  const band = clockSpeedBand(state.secondsPerHour), disabled = state.status === 'completed' || !!solo;
  const ticks = Array.from({ length: 12 }, (_, i) => `<line x1="130" y1="7" x2="130" y2="22" transform="rotate(${i * 30} 130 130)"/>`).join('');
  return `<div class="admin-clock">
    <div class="clock-face">
      <svg class="clock-dial" viewBox="0 0 260 260" fill="none" aria-hidden="true"><circle cx="130" cy="130" r="123"/>${ticks}</svg>
      <div class="clock-face-content"><span class="clock-date">${dateLabel}</span><time class="clock-time" datetime="${date.toISOString()}" aria-label="Simulation time: ${dateLabel}, ${timeLabel} UTC">${timeLabel}</time>
      ${button('clock', state.status === 'completed' ? 'Session complete' : state.status === 'running' ? 'Pause clock' : 'Start clock', state.status === 'running' ? 'paused' : 'running', 'clock-toggle', disabled)}
      <strong class="clock-rate" aria-label="${state.secondsPerHour} real seconds per simulation hour">${state.secondsPerHour} s/h</strong></div>
    </div>
    <p class="clock-status"><span class="badge ${state.status === 'running' ? '' : 'amber'}">● ${esc(state.status)}</span><span>Day ${Math.floor(state.hour / 24) + 1} · ends ${simDate(state.endHour)}</span></p>
    <p class="clock-speed-label" id="clock-speed-label">Clock speed: <strong>${solo ? 'Manual' : band?.label || 'Custom'}</strong></p>
    <div class="clock-speed-bands" role="group" aria-labelledby="clock-speed-label">${clockSpeedBands.map(b => {
      const description = `${b.label}: ${b.min}–${b.max} real seconds per simulation hour. Set to ${clockBandMidpoint(b)} s/h.`;
      return `<button class="small${!solo && b === band ? ' primary' : ''}" data-action="clock-speed" data-id="${b.id}" aria-pressed="${!solo && b === band}" aria-label="${description}" title="${description}" ${disabled ? 'disabled' : ''}>${b.label}</button>`;
    }).join('')}</div>
    <p class="clock-speed-hint">${solo ? 'Solo mode advances with manual steps.' : 's/h = real seconds per simulation hour. Lower is faster. Presets cover 6–45 s/h; use Session settings for a custom speed.'}</p>
  </div>
  <details class="clock-step-options" data-view-key="clock-step-options"><summary>Manual steps</summary><div class="clock-controls">${button('step', '+ 1 hour', '1', 'small', state.status !== 'paused')}${button('step', '+ 1 day', '24', 'small', state.status !== 'paused')}${button('step', 'Custom step', 'custom', 'small', state.status !== 'paused')}</div><p class="form-note">Pause the clock before stepping forward.</p></details>
  <div class="clock-footer">${button('settings', 'Session settings', '', 'small')}<small>No time is skipped during server downtime.</small></div>`;
}
let disruptionTab = 'supply';
const disruptionTabs = { supply: 'Supply and logistics', carbon: 'Carbon and regulation', tariff: 'Import tariffs' };


// Origins describe the manufacturing plant for each offer in the US-import exercise.
const sourcingOrigins = {
  'cell-circular': 'China', 'cell-express': 'Malaysia',
  'frame-circular': 'Canada', 'frame-express': 'United Kingdom',
  'controller-circular': 'South Africa', 'controller-express': 'United States'
};
// Percentages are selected additional duties, in country-of-origin order below.
const tariffHistory = {
  baseline: { label: 'Pre-shock baseline', rates: [0, 0, 0, 0, 0, 0] },
  feb04: { label: '4 February 2025', rates: [10, 0, 0, 0, 0, 0] },
  mar04: { label: '4 March 2025', rates: [20, 0, 0, 0, 0, 0] },
  mar12: { label: '12 March 2025', rates: [20, 0, 25, 25, 0, 0] },
  apr05: { label: '5 April 2025', rates: [30, 10, 25, 25, 10, 0] },
  apr09: { label: '9 April 2025', rates: [104, 24, 25, 25, 30, 0] },
  apr10: { label: '10 April 2025', rates: [145, 10, 25, 25, 10, 0] },
  may14: { label: '14 May 2025', rates: [30, 10, 25, 25, 10, 0] },
  jun04: { label: '4 June 2025', rates: [30, 10, 50, 25, 10, 0] },
  aug07: { label: '7 August 2025', rates: [30, 19, 50, 25, 30, 0] }
};
const tariffOrigins = ['China', 'Malaysia', 'Canada', 'United Kingdom', 'South Africa', 'United States'];
let previewTariff = 'apr10';
function tariffQuote(stage, row, opening) {
  const index = tariffOrigins.indexOf(sourcingOrigins[row.id]);
  if (index < 0) return null;
  const rate = tariffHistory[stage].rates[index];
  return { rate, price: Math.round(opening.price * (100 + rate) / 100) };
}
function disruptionChanges(preset) {
  const openingCatalog = catalog();
  if (preset === 'carbon-on' || preset === 'carbon-off') {
    const carbonDemand = preset === 'carbon-on';
    return state.effects.carbonDemand === carbonDemand ? [] : [{ type: 'configure', carbonDemand }];
  }
  const routes = preset.startsWith('routes');
  const tariff = preset.startsWith('tariff');
  const collection = routes ? 'routes' : 'suppliers';
  const changes = [];
  for (const row of state.catalog[collection]) {
    const opening = openingCatalog[collection].find(x => x.id === row.id);
    if (!opening || (!routes && !tariff && !row.enabled)) continue;
    let patch;
    if (tariff) {
      const quote = tariffQuote(preset.slice(7), row, opening);
      if (!quote) continue;
      patch = { price: quote.price };
    } else if (routes) {
      patch = preset === 'routes-shock' ? { enabled: true, reliability: 50 } : { enabled: opening.enabled, reliability: opening.reliability };
    } else {
      patch = { reliability: preset === 'suppliers-shock' ? 70 : opening.reliability };
    }
    if (Object.entries(patch).some(([key, value]) => row[key] !== value)) changes.push({ type: 'catalog', collection, id: row.id, patch });
  }
  return changes;
}
function disruptionPanel() {
  const tabs = Object.entries(disruptionTabs).map(([key, label]) => button('disruption-tab', label, key, key === disruptionTab ? 'primary' : '')).join('');
  const preset = (key, label) => button('disruption-preset', label, key, 'small', state.status !== 'paused' || !disruptionChanges(key).length);
  let body;
  if (disruptionTab === 'supply') {
    const suppliers = state.catalog.suppliers.filter(x => x.enabled);
    body = '<h3>Inbound supply</h3><p>Set the probability of an on-time arrival for new component orders.</p>' +
      table(['Supplier', 'Component', 'On time'], suppliers.map(x => [esc(x.name), itemName(state, x.item), x.reliability + '%'])) +
      preset('suppliers-shock', 'Set active suppliers to 70%') + preset('suppliers-normal', 'Restore standard supplier accuracy') +
      '<h3>Outbound logistics</h3>' + table(['Provider', 'Enabled', 'On time'], state.catalog.routes.map(x => [esc(x.name), x.enabled ? 'Yes' : 'No', x.reliability + '%'])) +
      preset('routes-shock', 'Enable all routes at 50%') + preset('routes-normal', 'Restore standard routes');
  } else if (disruptionTab === 'carbon') {
    body = '<h3>Carbon-conscious procurement</h3><p>Customers give lower-footprint panels a demand advantage at the next allocation. Carbon is measured throughout play. For a compliance exercise, announce a footprint ceiling and assess it from inventory and reports. Compliance is assessed by the instructor.</p>' +
      table(['Demand preference', 'Market weights'], [[state.effects.carbonDemand ? 'On' : 'Off', state.catalog.markets.filter(x => x.enabled).map(x => esc(x.name) + ' · ' + x.greenWeight).join('<br>')]]) +
      preset('carbon-on', 'Enable carbon-conscious demand') + preset('carbon-off', 'Turn preference off');
  } else {
    const openingCatalog = catalog();
    const stage = tariffHistory[previewTariff];
    const options = Object.entries(tariffHistory).map(([id, entry]) => button('tariff-preview', entry.label, id, id === previewTariff ? 'primary small' : 'small')).join('');
    const rows = state.catalog.suppliers.filter(x => Object.hasOwn(sourcingOrigins, x.id)).map(row => {
      const opening = openingCatalog.suppliers.find(x => x.id === row.id);
      const quote = tariffQuote(previewTariff, row, opening);
      return [itemName(state, row.item), sourcingOrigins[row.id], exactMoney(opening.price), quote.rate + '%', exactMoney(quote.price), exactMoney(row.price)];
    });
    body = '<h3>US import tariffs in 2025</h3><p>Teams assemble panels in the United States. Select a historical date to preview the duties on each manufacturing origin, then apply the quotes to future orders.</p>' +
      '<div class="toolbar" aria-label="Historical policy dates">' + options + '</div><h3>' + stage.label + '</h3>' +
      table(['Component', 'Manufacturing origin', 'Base unit value', 'Modelled duty', 'Preview quote', 'Live quote'], rows) +
      preset('tariff-' + previewTariff, 'Apply ' + stage.label + ' quotes') +
      '<p class="form-note">The April peak on covered Chinese cells combines the 20% China duty and 125% reciprocal duty. Frames are covered aluminium extrusions. Prices assume full pass-through at order acceptance. Other duties, including solar trade remedies, are outside this replay. <a href="notes/model.md#us-import-tariffs-in-2025" target="_blank" rel="noopener">Coverage and official sources ↗</a></p>';

  }
  return panel('External Disruptions', 'Pause the clock to change conditions. Check each resulting value before resuming play.', '<nav class="toolbar" aria-label="Disruption scenarios">' + tabs + '</nav>' + body);
}
async function applyDisruption(preset) {
  if (!isTeacher() || state.status !== 'paused') throw new Error('Pause the classroom clock before applying a disruption.');
  for (const change of disruptionChanges(preset)) {
    if (state.status !== 'paused') throw new Error('The clock resumed. Pause and reapply to finish the remaining changes.');
    await command(change);
  }
  render();
}

function adminPage() {
  if (!isTeacher()) return '';
  return `<div class="grid2">${panel('The shared clock', '', adminClock())}${panel('Classroom access', 'Every student belongs to one company in this session.', `<div class="toolbar">${button('roster', 'Companies & join codes', '', 'primary', !!solo)}${button('create', 'New session', '', '', !!solo || !!testRoom)}${button('sessions', 'Switch session', '', 'small', !!solo)}</div><p class="form-note">Company join codes grant student membership only. Instructor previews are read-only. Team messages are visible only to members of that company.</p>`)}</div>${disruptionPanel()}${panel('Teaching capabilities', 'Visibility controls navigation. Permission controls new decisions. Model effects are separate.', `<div class="toggle-row"><span>Feature</span><span>Visibility &nbsp; / &nbsp; Permission</span></div>${FEATURES.map(f => `<form class="toggle-row" data-feature="${f}"><span>${esc(f.charAt(0).toUpperCase() + f.slice(1))}</span><div class="toolbar">${check('visible', 'Show', state.features[f].visible)}${check('allowed', 'Allow decisions', state.features[f].allowed)}${button('submit', 'Apply', '', 'small')}</div><div class="error" role="alert"></div></form>`).join('')}<form id="effects-form" class="toggle-row"><span>Model effect</span><div class="toolbar">${check('carbonDemand', 'Customer preference for lower carbon', state.effects.carbonDemand)}${button('submit', 'Apply', '', 'small')}</div><div class="error" role="alert"></div></form>`)}${panel('Scenario catalogues', 'Change future supply, transport, demand, and energy conditions. Accepted contracts keep their terms.', `<div class="toolbar">${['suppliers', 'routes', 'markets', 'energy'].map(k => button('catalog-list', k.charAt(0).toUpperCase() + k.slice(1), k)).join('')}</div>`)}${panel('Upcoming outcomes across the class', 'Pending obligations remain visible beyond the configured end.', pendingEvents(10), button('events', 'All events', '', 'small'))}${decisionTimingPanel()}${panel('Audit trail', 'Accepted commands identify the actor and both clocks.', table(['Simulation / real time', 'Actor', 'Action', 'Result'], state.audit.slice(-30).reverse().map(a => [sortCell(`${simDate(a.hour)}<small>${new Date(a.realAt).toLocaleString('en-GB')}</small>`, a.hour), `${esc(a.actorName)}<small>${esc(a.role)}</small>`, esc(a.command.type), esc(a.result)])), button('replay', 'Export replay', '', 'small', !!solo || !!testRoom))}`;
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
function csv(name, rows) {
  const cell = value => {
    // Engine amounts are numbers, including negative credits and losses. Escape
    // formula-like user text without changing those amounts into spreadsheet text.
    const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value).replace(/^[=+@-]/, "'$&");
    return `"${text.replace(/"/g, '""')}"`;
  };
  download(name, rows.map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv');
}
const value = (data, key) => Number(data.get(key));
function arrivalTiming(buffer) {
  return buffer > 0 ? `Arriving ${number(buffer)}h before the deadline` : buffer < 0 ? `Arriving ${number(-buffer)}h after the deadline` : 'Arriving exactly at the deadline';
}
function arrivalTimingHTML(buffer) {
  return `<span class="deadline-${buffer > 0 ? 'early' : buffer < 0 ? 'late' : 'exact'}">(${arrivalTiming(buffer)})</span>`;
}
function dispatchRouteTiming(order, route) {
  const buffer = order.dueAt - state.hour - route.hours;
  return `<li><strong>${esc(route.name)}</strong> ${arrivalTimingHTML(buffer)}<small>With the full ${number(route.maxDelay)}h carrier delay: ${arrivalTimingHTML(buffer - route.maxDelay)}</small></li>`;
}
function openDispatch(id) {
  const o = company().orders.find(x => x.id === id), routes = state.catalog.routes.filter(r => r.enabled);
  if (!o || o.remaining === 0) { modal('No open quantity to dispatch', '<p>This order has already been dispatched or is no longer available. Review your current orders.</p>'); return; }
  if (!routes.length) { modal('No transport routes available', '<p>The instructor has disabled all transport routes. Your order remains open. Ask the instructor to enable a route before dispatching.</p>'); return; }
  if (company().inventory.panel.qty < 1) { modal('No modules available to dispatch', '<p>Your finished-goods inventory is empty. The order remains open. Receive any needed components and produce modules, then return to dispatch.</p>'); return; }
  modal(`Dispatch ${id}`, `<p id="dispatch-context" class="form-note"></p><p id="dispatch-deadline" class="dispatch-deadline"></p><div class="form-grid">${field('qty', 'Modules to dispatch', Math.min(o.remaining, company().inventory.panel.qty), 'number', `min="1" max="${Math.min(o.remaining, company().inventory.panel.qty)}"`)}${select('routeId', 'Transport route', routes.map(r => [r.id, `${r.name} · ${r.hours} h`]), routes[0]?.id)}</div><div id="dispatch-quote" class="advice" aria-live="polite"></div><details class="dispatch-comparison" open><summary>Compare arrival times if dispatched now</summary><p class="form-note">Estimates use the simulation time shown above. If the clock is running, reopen this form for the latest estimate. Carrier delays can change the arrival time.</p><ul id="dispatch-route-timing"></ul></details><p id="dispatch-terms" class="form-note"></p>`, data => command({ type: 'dispatch', orderId: id, qty: value(data, 'qty'), routeId: data.get('routeId') }), 'Confirm dispatch');
  const form = dialog.querySelector('form');
  form.refreshContext = () => updateDispatchContext(id, form, true);
  form.addEventListener('input', () => updateDispatchContext(id, form)); form.refreshContext();
}
function updateDispatchContext(id, form, refreshRoutes = false) {
  const c = company(), order = c?.orders.find(o => o.id === id), stock = c?.inventory.panel.qty || 0;
  const quantity = form.querySelector('[name=qty]'), choice = form.querySelector('[name=routeId]'), quote = form.querySelector('#dispatch-quote');
  // Keep the draft controls and their values. Refresh only authoritative facts,
  // validation bounds and route labels after a reviewed conflict response.
  quantity.max = String(Math.min(order?.remaining || 0, stock));
  quantity.setCustomValidity(!order || !order.remaining ? 'This order has no remaining quantity to dispatch.' : !stock ? 'No modules are currently available to dispatch.' : '');
  form.querySelector('#dispatch-context').textContent = order ? `Original order: ${order.originalQty} modules. Still to dispatch: ${order.remaining}. Stock available: ${stock}. Promised arrival: ${simDate(order.dueAt)}.` : 'This order is no longer available. Review your current orders.';
  const remaining = order ? order.dueAt - state.hour : null;
  form.querySelector('#dispatch-deadline').textContent = order ? `As of simulation time ${simDate(state.hour)}. ${remaining > 0 ? `${number(remaining)}h remaining until the deadline` : remaining < 0 ? `Deadline passed ${number(-remaining)}h ago` : 'Deadline is now'}.` : '';
  form.querySelector('#dispatch-route-timing').innerHTML = order ? state.catalog.routes.filter(r => r.enabled).map(r => dispatchRouteTiming(order, r)).join('') : '';
  form.querySelector('#dispatch-terms').textContent = order ? `Each split shipment pays its own fixed fee. Revenue is recognized at customer receipt, with payment ${order.payment} h later.` : '';
  if (refreshRoutes) {
    const selected = choice.value, routes = state.catalog.routes.filter(r => r.enabled);
    if (selected && !routes.some(r => r.id === selected)) routes.push({ id: selected, name: 'Previously selected route unavailable', enabled: false });
    choice.innerHTML = routes.map(r => `<option value="${esc(r.id)}" ${r.id === selected ? 'selected' : ''} ${r.enabled ? '' : 'disabled'}>${esc(r.name)}${r.enabled ? ` · ${r.hours} h${order ? ` (${arrivalTiming(order.dueAt - state.hour - r.hours)})` : ''}` : ''}</option>`).join('');
    choice.value = selected;
  }
  const route = state.catalog.routes.find(r => r.id === choice.value && r.enabled), qty = Number(quantity.value);
  choice.setCustomValidity(route ? '' : 'Choose an available transport route.');
  if (!route || !order || !order.remaining || !stock) { quote.textContent = !route ? 'The selected route is unavailable. Choose an enabled route before submitting.' : 'Dispatch is currently unavailable. Your quantity and route draft have been preserved.'; return; }
  quote.innerHTML = `<strong>${exactMoney(route.fixed + route.unit * qty)} freight ${route.term ? 'due ' + simDate(state.hour + route.term) : 'paid now'} · ${number(route.carbonFixed + route.carbonUnit * qty)} kg CO₂e</strong>Estimated arrival: ${simDate(state.hour + route.hours)} ${arrivalTimingHTML(order.dueAt - state.hour - route.hours)}.<br>${route.reliability}% on time; up to ${route.maxDelay} h carrier delay.${qty < order.remaining ? '<br>Partial dispatch: the unshipped quantity stays open.' : ''}${state.hour + route.hours > order.dueAt ? '<br>Expected late: satisfaction penalty at receipt.' : state.hour + route.hours < order.dueAt - 24 ? '<br>More than 24 h early: small satisfaction penalty at receipt.' : ''}`;
}
function openPurchase(id) {
  const supplier = state.catalog.suppliers.find(s => s.id === id);
  if (!supplier) return;
  modal(`Order ${itemName(state, supplier.item)}`, `<p id="purchase-context" class="form-note"></p>${field('qty', 'Quantity', supplier.min, 'number', `min="${supplier.min}" max="${supplier.stock}" step="${supplier.lot}"`)}<div id="purchase-quote" class="advice"></div>`, f => command({ type: 'purchase', supplierId: id, qty: value(f, 'qty') }), 'Place purchase');
  const form = dialog.querySelector('form');
  form.refreshContext = () => updatePurchaseContext(id, form);
  form.addEventListener('input', form.refreshContext); form.refreshContext();
}
function updatePurchaseContext(id, form) {
  const supplier = state.catalog.suppliers.find(s => s.id === id), quantity = form.querySelector('[name=qty]'), context = form.querySelector('#purchase-context'), quote = form.querySelector('#purchase-quote');
  quantity.setCustomValidity(supplier?.enabled ? '' : 'This supplier is currently unavailable.');
  if (!supplier) { context.textContent = 'This supplier is no longer available.'; quote.textContent = ''; return; }
  quantity.min = String(supplier.min); quantity.max = String(supplier.stock); quantity.step = String(supplier.lot);
  context.textContent = `${supplier.name} · ${sourcingOrigins[supplier.id] || "Unspecified origin"} · ${exactMoney(supplier.price)} per unit + ${exactMoney(supplier.fee)} order fee. Supplier stock available: ${supplier.stock}. Estimated receipt ${simDate(state.hour + supplier.lead)}; payment ${supplier.term} h after actual receipt. Minimum ${supplier.min}; lots of ${supplier.lot}.${supplier.enabled ? '' : ' This supplier is currently disabled.'}`;
  const qty = Number(quantity.value);
  quote.textContent = `${exactMoney(qty * supplier.price + supplier.fee)} committed payable · ${number(qty * (supplier.carbon + supplier.freight))} kg CO₂e. Cash is paid after receipt, not now.`;
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
  if (name === 'tariff-preview' && Object.hasOwn(tariffHistory, id)) { previewTariff = id; render(); return; }
  if (name === 'disruption-tab' && Object.hasOwn(disruptionTabs, id)) { disruptionTab = id; render(); return; }
  if (name === 'disruption-preset') { await applyDisruption(id); return; }
  if (name === 'pane-wide' || name === 'pane-reset') {
    if (!Object.hasOwn(studentPanels, id)) return;
    if (name === 'pane-wide') panelLayouts.set(id, { ...panelLayouts.get(id), full: true }); else panelLayouts.delete(id);
    const pane = root.querySelector('[data-pane-id="' + id + '"]');
    if (pane) applyPaneLayout(pane);
    rememberWorkspaceView(); return;
  }
  if (name === 'pane-earlier' || name === 'pane-later') {
    const visible = [...openPanels].filter(id => studentPanelVisible(id, workspaceFeatureVisible)), index = visible.indexOf(id);
    const target = visible[index + (name === 'pane-later' ? 1 : -1)];
    if (target) reorderWorkspacePanel(id, target, name === 'pane-later'); return;
  }
  if (name === 'business-updates') { channel = 'business'; return action('nav', 'messages'); }
  if (name === 'business-note') { const feed = businessFeedState(); feed.selected = id; render(); return; }
  if (name === 'business-prev' || name === 'business-next') { const feed = businessFeedState(); feed.page = Math.max(0, feed.page + (name === 'business-next' ? 1 : -1)); render(); return; }
  if (name === 'message-sounds') {
    sounds().setEnabled(!sounds().enabled);
    const control = root.querySelector('[data-action=message-sounds]');
    if (control) { control.textContent = `Sound: ${sounds().enabled ? 'on' : 'off'}`; control.setAttribute('aria-pressed', String(sounds().enabled)); }
    return;
  }
  if (name === 'toggle-mobile-menu') {
    const toggle = root.querySelector('.mobile-menu-toggle');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.closest('.workspace-nav').classList.toggle('mobile-menu-open', open);
    return;
  }
  if (name === 'workspace-tool') {
    const tool = workspaceTools.find(tool => tool.id === id);
    if (!tool) return;
    if (tool.categories || workspaceDestinations(tool, isTeacher(), workspaceFeatureVisible).length > 1) {
      openWorkspaceMenu(id, true); return;
    }
    closeWorkspaceMenus(); closeMobileMenu();
    if (tool.channel) { channel = 'all'; return action('nav', 'messages'); }
    if (tool.page) return action('nav', tool.page);
    const destination = workspaceDestinations(tool, isTeacher(), workspaceFeatureVisible)[0];
    if (destination) return action('open-workspace-panel', destination);
    return;
  }
  if (name === 'report-back') { root.querySelector('#menu-category-' + id).hidden = true; const owner = root.querySelector('.menu-category[data-id="' + id + '"]'); owner.setAttribute('aria-expanded', 'false'); owner.focus(); return; }
  if (name === 'report-category') { openReportCategory(id, true); return; }
  if (name === 'open-workspace-panel') {
    if (!studentPanelVisible(id, workspaceFeatureVisible)) return;
    closeWorkspaceMenus(); closeMobileMenu();
    openPanels.add(id); selectedPanel = id; page = 'workspace'; render();
    root.querySelector('#pane-' + id)?.focus(); return;
  }
  if (name === 'report-prev' || name === 'report-next') { const filters = reportFilters(id); filters.page = Math.max(0, filters.page + (name === 'report-next' ? 1 : -1)); render(); return; }
  if (name === 'operational-csv') {
    const data = buildOperationalReport(state, id, reportFilters(id));
    csv(id + '.csv', [data.columns.map(c => c.label + (c.type === 'money' ? ' (EUR)' : c.type === 'time' ? ' (simulation UTC)' : '')), ...orderedOperationalRows(data, id).map(row => row.map((value, i) => value == null ? '' : data.columns[i].type === 'money' ? value / 100 : data.columns[i].type === 'time' ? simDate(value) : value))]); return;
  }
  if (name === 'refresh-report') { await load(); return; }
  const c = company();
  if (name === 'submit') return;
  if (name === 'decision-timing' || name === 'decision-timing-csv') {
    if (!isTeacher()) return;
    const players = decisionTiming();
    if (name === 'decision-timing-csv') {
      csv('student-decision-timestamps.csv', [['Student ID', 'Student', 'Company', 'Real time (UTC)', 'Simulation time (UTC)', 'Decision', 'Gap since previous decision', 'Result'], ...players.flatMap(p => decisionTimingRows(p).map(row => [p.id, p.name, state.companies.find(c => c.id === p.companyId)?.name || '', ...row]))]);
    } else {
      const player = players.find(p => p.id === id); if (!player) return;
      const entries = [...player.timed, ...player.entries.filter(entry => !Number.isFinite(entry.timestamp))];
      modal(`Decision history · ${esc(player.name || player.id)}`, `<p class="form-note">Real timestamps are recorded when decisions are accepted. Gaps compare this student's accepted business decisions only. Review the decisions in context before drawing conclusions about automation.</p>${table(['Real time (UTC)', 'Simulation time', 'Decision', 'Gap since previous', 'Result'], decisionTimingRows(player).map((row, i) => [sortCell(esc(row[0]), Number.isFinite(entries[i].timestamp) ? entries[i].timestamp : null), sortCell(esc(row[1]), entries[i].hour), esc(row[2]), sortCell(esc(row[3]), entries[i].gap ?? null), esc(row[4])]), 'No decisions.', `timing-${player.id}`)}`);
    }
    return;
  }
  if (name === 'profile') { modal('My profile & statistics', '<p><strong>' + esc((user || actor).name) + '</strong></p><p>' + esc((user || actor).role) + '</p><p>' + sessions.length + ' classroom sessions · ' + sessions.filter(s => s.status === 'completed').length + ' completed</p>'); return; }
  if (name === 'copy-session') { const link = new URL(location.href); link.search = ''; link.hash = ''; link.searchParams.set('session', id); try { await navigator.clipboard.writeText(link.href); toast('Session link copied. Sign-in and membership are still required.'); } catch { modal('Copy session link', field('link', 'Select and copy this link', link.href, 'url', 'readonly')); } return; }
  if (name === 'test-leave') { leaveTest(); return; }
  if (name === 'test-retry') { await load(); return; }
  if (testRoom && ['sessions','logout','test-leave'].includes(name)) { leaveTest(); return; }
  if (name === 'saved-tests') { await savedTests(); return; }
  if (name === 'new-test') { await startTestSetup(id); return; }
  if (name === 'test-students' || (testRoom && name === 'roster')) { await testStudents(); return; }
  if (name === 'test-end') { modal('Delete this test session?', '<p>This permanently deletes the test students and all their decisions and disconnects every test tab.</p>', async () => { await testRoom.call('end'); leaveTest(); }, 'Delete test session'); return; }
  if (testRoom && ['create','join','replay','assign'].includes(name)) throw new Error('This action is unavailable in a temporary test round.');
  if (name === 'session-test') { await savedTests(id); return; }
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
    if (!studentPanelVisible(id, workspaceFeatureVisible)) return;
    if (name === 'close-panel' || (name === 'panel' && page === 'workspace' && openPanels.has(id) && selectedPanel === id)) {
      openPanels.delete(id);
      if (selectedPanel === id) selectedPanel = [...openPanels].filter(key => studentPanelVisible(key, workspaceFeatureVisible)).at(-1) || null;
    } else { openPanels.add(id); selectedPanel = id; }
    page = 'workspace';
    render();
    (root.querySelector('#pane-' + id) || root.querySelector('.page-heading h1'))?.focus();
    return;
  }
  if (name === 'nav') { page = id; if (id === 'admin' && preview) { preview = undefined; await load(); } else render(); return; }
  if (name === 'solo') { solo = (await import('./src/solo.mjs?v=4651dc6dd6e7')).soloAdapter(); sessionId = 'solo'; page = 'overview'; preview = undefined; await load(); return; }
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
  if (name === 'inventory-write-off') {
    const choices = Object.entries(company().inventory).filter(([, stock]) => stock.qty > 0)
      .map(([item, stock]) => [item, itemName(state, item) + ' (' + number(stock.qty) + ' available)']);
    if (choices.length) modal('Write off inventory', '<p>Discard damaged or obsolete stock. This permanently removes the units and charges their carrying value to operating expenses. Previously incurred emissions remain in the company footprint.</p>' +
      select('item', 'Inventory item', choices, choices[0][0]) + field('qty', 'Units to write off', 1, 'number', 'min="1" step="1" required'),
      data => command({ type: 'writeOff', item: data.get('item'), qty: value(data, 'qty') }), 'Confirm write-off');
  }
  if (name === 'purchase') openPurchase(id);
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
  if (name === 'clock-speed') {
    const band = clockSpeedBands.find(b => b.id === id);
    if (!band || !isTeacher() || solo || state.status === 'completed') return;
    await command({ type: 'clock', status: state.status, secondsPerHour: clockBandMidpoint(band) });
    render();
  }
  if (name === 'settings') modal('Session settings', `${check('studentAccess', 'Open session to students', state.studentAccess !== false)}${field('name', 'Session name', state.name, 'text', 'maxlength="120"')}<div class="form-grid">${field('days', 'Total duration from start (days)', state.endHour / 24, 'number', `min="${Math.min(state.endHour, Math.max(24, state.hour)) / 24}" max="180" step="any"`)}${field('speed', 'Real seconds per simulation hour', state.secondsPerHour, 'number', 'min="1" max="120"')}</div>`, async f => { if (!solo && !testRoom && !health?.atomicSessionSettings) throw new Error('The classroom backend needs the Settings update before changes can be saved.'); await command(sessionSettingsCommand(state, f)); }, 'Save settings');
  if (name === 'events') modal('Pending & completed outcomes', table(['Company', 'Outcome', 'Scheduled time', 'State'], state.events.filter(e => !c || e.companyId === c.id).slice().sort((a, b) => a.at - b.at).map(e => [esc(state.companies.find(c => c.id === e.companyId)?.name), esc(e.description), sortCell(simDate(e.at), e.at), esc(e.blocked || e.status)])));
  if (name === 'create') modal('Create a classroom session', createSessionFields(), createClassroom, 'Create session');
  if (name === 'join') { selectSession(null); renderLobby(); return; }
  if (name === 'roster') { roster = await api(`/sessions/${sessionId}/roster`); modal('Companies & join codes', `<p class="form-note">Share each code with that company’s students. Codes do not grant instructor access.</p>${table(['Company', 'Student join code', ''], roster.invites.map(i => [esc(state.companies.find(c => c.id === i.companyId)?.name), `<code>${esc(i.code)}</code>`, button('rename', 'Rename', i.companyId, 'small')]))}${table(['Participant', 'Company', ''], roster.members.filter(u => u.role === 'student').map(u => [esc(u.name), esc(state.companies.find(c => c.id === u.companyId)?.name), button('assign', 'Reassign', u.id, 'small')]))}`); }
  if (name === 'rename') modal('Rename company', field('name', 'Company name', state.companies.find(c => c.id === id).name, 'text', 'maxlength="60"'), f => command({ type: 'renameCompany', companyId: id, name: f.get('name') }));
  if (name === 'assign') modal('Assign student to a company', `<p class="form-note">Previous team and peer channels will no longer be accessible. Membership is checked on each request.</p>${select('companyId', 'Company', state.companies.map(c => [c.id, c.name]), roster.members.find(u => u.id === id)?.companyId)}`, async f => { await api(`/sessions/${sessionId}/assign`, { userId: id, companyId: f.get('companyId') }); await load(false); });
  if (name === 'catalog-list') {
    const markets = id === 'markets';
    modal(`${id.charAt(0).toUpperCase() + id.slice(1)} catalogue`,
      (markets ? '<p class="form-note">All teams compete for one shared demand pool per market. Poisson arrivals are sampled each simulation hour. Edit λ before or during play.</p>' : '') +
      table(['Name', ...(markets ? ['Demand model'] : []), 'State', ''], state.catalog[id].map(x => [esc(x.name), ...(markets ? [x.lambda === undefined ? `Legacy · ${number(x.volume)} modules / 6 h` : `Poisson · λ ${precise(x.lambda)} modules / h`] : []), x.enabled ? 'Enabled' : 'Disabled', button('catalog-edit', 'Edit', `${id}:${x.id}`, 'small')]), 'Nothing here yet.', `catalog-${id}`));
  }
  if (name === 'catalog-edit') {
    const [collection, rowId] = id.split(':'), row = state.catalog[collection].find(x => x.id === rowId);
    const markets = collection === 'markets';
    const fields = { suppliers: ['price', 'stock', 'replenish', 'lead', 'term', 'reliability'], routes: ['hours', 'fixed', 'unit', 'term', 'reliability'], markets: ['lambda', 'referencePrice', 'greenWeight'], energy: ['fee', 'daily', 'delay'] }[collection];
    const help = markets
      ? `Demand follows a Poisson distribution: λ is the expected number of module arrivals per simulation hour across all teams, not a guaranteed quantity. For example, λ = 20 means an average of 480 modules per day. Changes apply from the next simulation hour. Zero or Disabled stops new demand; accepted orders remain.${row.lambda === undefined ? ' This saved market still uses the legacy six-hour model. Saving this form switches it to hourly Poisson demand; the suggested λ preserves its average demand per day.' : ''}`
      : 'Money fields are integer cents; time fields are hours; reliability is percent; stock is units. Changes affect future contracts.';
    const labels = { price: 'Unit price (cents)', fixed: 'Fixed freight (cents)', unit: 'Freight / unit (cents)', referencePrice: 'Reference price (cents)', fee: 'Switch fee (cents)', daily: 'Standing charge (cents/day)', lambda: 'Demand rate λ (modules / simulation hour)', greenWeight: 'Carbon preference (%)', stock: 'Available stock', replenish: 'Daily replenishment', lead: 'Lead time (hours)', term: 'Payment term (hours)', hours: 'Transit (hours)', delay: 'Switch delay (hours)', reliability: 'On-time probability (%)' };
    modal(row.name, `<p class="form-note">${help}</p><div class="form-grid">${fields.map(k => field(k, labels[k], k === 'lambda' ? (row.lambda ?? row.volume / 6) : (row[k] ?? 0), 'number', k === 'lambda' ? 'min="0" max="1000" step="any" required' : 'min="0"')).join('')}${check('enabled', 'Enabled', row.enabled)}</div>`, f => command({ type: 'catalog', collection, id: rowId, patch: { ...Object.fromEntries(fields.map(k => [k, value(f, k)])), enabled: f.has('enabled') } }));
  }
  if (name === 'replay') download('simulation-replay.json', await api(`/sessions/${sessionId}/replay`));
  if (name === 'report-csv') csv('daily-report.csv', [['Simulation time (UTC)', 'Company', `${reportTypes[report][0]} (${reportTypes[report][1]})`], ...reportRows(reportSnapshots(reportRange))]);
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
  const messageControl = event.target.closest('[data-message-tool], [data-ready-message]');
  if (messageControl) { event.preventDefault(); editMessage(messageControl); return; }
  if (!event.target.closest('.workspace-nav')) closeWorkspaceMenus();
  const sortButton = event.target.closest('[data-table-sort]');
  if (sortButton) { event.preventDefault(); sortTable(sortButton); return; }
  const b = event.target.closest('[data-action]'); if (!b || b.disabled || b.dataset.action === 'submit') return;
  event.preventDefault();
  if (b.getAttribute('aria-disabled') === 'true') return;
  const workspaceChoice = b.closest('.workspace-tool-choices');
  if (workspaceChoice) dialog.close();
  b.disabled = true; b.setAttribute('aria-busy', 'true');
  try {
    await action(b.dataset.action, b.dataset.id);
    if (!['toggle-mobile-menu', 'workspace-tool', 'report-category'].includes(b.dataset.action) && !dialog.open && page !== 'workspace' && (workspaceChoice || b.closest('.workspace-nav'))) root.querySelector('.page-heading h1')?.focus();
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
    if (form.id === 'message-form') { typingInputAt = 0; void syncTyping(true); await command({ type: 'message', channel: f.get('recipient') || channel, text: f.get('text') }); sounds().play('sent'); render(); }
  } catch (e) { reportFormError(form, e); }
  finally { submittingForms.delete(form); if (submit) submit.disabled = false; }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.name?.startsWith('operational-')) {
    const id = target.closest('[data-report-id]').dataset.reportId;
    reportFilters(id)[target.name.slice(12)] = target.value; reportFilters(id).page = 0; render();
    root.querySelector('[data-report-id="' + id + '"] [name="' + target.name + '"]')?.focus(); return;
  }
  if (target.name === 'recipient') { typingInputAt = 0; void syncTyping(true); }
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
    if (target.name === 'channel') {
      const draft = root.querySelector('#message-form textarea')?.value, recipient = root.querySelector('#message-form [name=recipient]')?.value;
      channel = target.value; render();
      const textarea = root.querySelector('#message-form textarea'), choice = root.querySelector('#message-form [name=recipient]');
      if (textarea && draft) {
        textarea.value = draft;
        if (choice && [...choice.options].some(option => option.value === recipient)) choice.value = recipient;
      }
      root.querySelector('[name=channel]')?.focus();
    }
    if (target.name?.startsWith('series-')) { if (!selectedCompanies.size) selectedCompanies = new Set(state.companies.map(c => c.id)); if (target.checked) selectedCompanies.add(target.name.slice(7)); else selectedCompanies.delete(target.name.slice(7)); if (!selectedCompanies.size) { selectedCompanies.add(target.name.slice(7)); toast('Keep at least one company selected to display the report.'); } render(); }
  } catch (e) { toast(e.message); }
});
async function startWorkspace() {
  if (location.hash?.startsWith('#test=')) {
    const testLink = new URLSearchParams(location.hash.slice(1));
    try { const client = (await import('./src/test-client.mjs?v=4651dc6dd6e7')).testClient({roomId:testLink.get('test'),key:testLink.get('key')}); await enterTest(client); }
    catch(e) { root.innerHTML = '<main class="welcome"><h1>Test round unavailable</h1><p>' + esc(e.message) + '</p><div class="toolbar">' + (e.status === 403 ? button('retry-start', 'Try again', '', 'primary') : '') + button('test-leave','Return to classroom') + '</div></main>'; }
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
setInterval(() => { void syncTyping(); }, 2000);
setInterval(() => { if (needsBackgroundPoll()) void refreshInBackground(); }, 3000);

window.addEventListener('popstate', () => { if (user && !solo) enter().catch(e => toast(e.message)); });
window.addEventListener('offline', connectionLost);
window.addEventListener('online', connectionRestored);

// Suspended browser tabs resync as soon as they become visible again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTypingJob(); else void syncTyping();
  if (!solo && sessionId && !document.hidden) void refreshInBackground();
});

window.addEventListener('pagehide', stopTypingJob);
window.addEventListener('pagehide', event => { if (!event.persisted) testRoom?.close(); });
