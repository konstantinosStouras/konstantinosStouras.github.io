/* ==========================================================================
   Sustainable Supply Chains — app.js (student side)
   Screens: join (session code) → firm setup (found/join a firm) → lobby →
   game (Decide / Supply chain / Results / Market news / Standings / Debrief).
   All game math comes from engine.js; all storage goes through store.js
   (Firebase when configured, otherwise the in-browser demo backend).
   ========================================================================== */
(function () {
  'use strict';
  var U = window.SSCUI, E = window.SSCEngine, ST = window.SSCStore;
  var $ = U.$, esc = U.esc, fmtM = U.fmtMoney, fmtI = U.fmtInt;

  var S = {
    uid: null,
    sessionId: null, session: null,
    firms: [], results: [], markets: [], messages: [],
    myFirmId: null,
    draft: null, draftRound: null, submitted: false, saveTimer: null,
    decideRoundRendered: null, resultsRound: null,
    decisionUnsub: null, lastWriteStamp: null, lastRemoteStamp: null,
    instance: null, asyncUnsub: null, creatingInstance: false, resolvingAsync: false,
    activeTab: 'decide', unsubs: []
  };

  /* ---- async practice mode ----------------------------------------------------
     In async sessions every firm plays its OWN private game against optimal
     (Nash-equilibrium) bots, at its own pace: the round/phase live in the
     firm's instance doc, not the session doc. V() is the "virtual session"
     the game screens render — identical to the real session in live mode,
     round/phase overridden from the instance in async mode. */
  var ASYNC_BOT_DEFS = [
    { name: 'Equilibrium Cycles', hub: 'easia' },
    { name: 'OptiChain Corp', hub: 'europe' },
    { name: 'Rational Rides', hub: 'namerica' },
    { name: 'MaxProfit Mobility', hub: 'seasia' },
    { name: 'Clairvoyant Cycles', hub: 'latam' }
  ];
  function isAsync() { return !!(S.session && S.session.settings && S.session.settings.asyncMode); }
  function V() {
    if (!S.session) return null;
    if (!isAsync()) return S.session;
    var inst = S.instance;
    return Object.assign({}, S.session,
      { round: inst ? inst.round : 1, phase: inst ? inst.phase : 'decisions',
        roundOpenedAt: inst ? inst.roundOpenedAt : null });
  }
  function gameFirms() {
    if (!isAsync()) return S.firms;
    var mine = myFirm();
    if (!mine) return [];
    return [mine].concat(S.instance ? S.instance.botFirms : []);
  }
  function makeInstance(mine) {
    var sess = S.session;
    var n = Math.max(1, Math.min(5, Math.round(Number(sess.settings.asyncBots) || 3)));
    var regionIds = Object.keys(sess.catalog.regions);
    var bots = ASYNC_BOT_DEFS.slice(0, n).map(function (b, i) {
      return { id: mine.id + '-b' + (i + 1), name: b.name,
               hub: sess.catalog.regions[b.hub] ? b.hub : regionIds[i % regionIds.length],
               isBot: true, botProfile: 'nash', createdAt: i };
    });
    var states = {};
    [mine].concat(bots).forEach(function (f) { states[f.id] = E.initFirmState(sess, f); });
    return { firmId: mine.id, round: 1, phase: 'decisions', botFirms: bots, states: states,
             results: [], markets: [], createdAt: Date.now(), updatedAt: Date.now(),
             roundOpenedAt: Date.now() };
  }
  // Resolve the firm's own round locally: bots decide via the Nash engine,
  // the same deterministic resolveRound runs, and the instance is saved so
  // teammates (and the instructor's monitor) see it live.
  function endAsyncRound(mine) {
    if (S.resolvingAsync) return;
    var inst = S.instance, sess = V();
    if (!inst || inst.phase !== 'decisions') return;
    S.resolvingAsync = true;
    try {
      var round = inst.round;
      var firms = gameFirms();
      var decisions = {};
      decisions[mine.id] = S.draft || collectDecision(mine);
      var botIds = inst.botFirms.map(function (b) { return b.id; });
      var nash = E.nashDecisions(sess, firms, inst.states, round, botIds);
      botIds.forEach(function (id) { decisions[id] = nash[id]; });
      var out = E.resolveRound(sess, firms, inst.states, decisions, round);
      out.market.news = out.news;
      var resDocs = Object.keys(out.results).map(function (fid) {
        var r = out.results[fid];
        if (fid !== mine.id) { r = E.clone(r); delete r.endState; delete r.orderLines; }
        return r;
      });
      inst.results = inst.results.concat(resDocs);
      inst.markets = inst.markets.concat([out.market]);
      inst.states = out.states;
      inst.phase = round >= sess.settings.rounds ? 'final' : 'resolved';
      inst.updatedAt = Date.now();
      S.instance = inst;
      var d = decisions[mine.id];
      d.submitted = true; d.submittedAt = Date.now(); d.savedAt = Date.now();
      S.lastWriteStamp = d.savedAt;
      ST.saveAsync(S.sessionId, mine.id, inst).catch(function (e) {
        if (/stale-async/.test(e.message)) {
          alert('A teammate already advanced this game on another device — syncing to their state.');
          S.instance = null; // the watcher delivers the newer instance
        }
      });
      ST.saveDecision(S.sessionId, mine.id, round, d);
      logEv('round_resolved', { async: 1, round: round, secs: secsSinceRoundOpen() });
      if (inst.phase === 'final') logEv('game_ended', { async: 1 });
      S.resolvingAsync = false;
      S.resultsRound = round;
      setTab(inst.phase === 'final' ? 'debrief' : 'results');
    } catch (e) {
      S.resolvingAsync = false;
      alert('Could not resolve the round: ' + e.message);
    }
  }
  function startNextAsyncRound() {
    var inst = S.instance;
    if (!inst || inst.phase !== 'resolved') return;
    inst.round += 1;
    inst.phase = 'decisions';
    inst.updatedAt = Date.now();
    inst.roundOpenedAt = Date.now();
    S.instance = inst;
    ST.saveAsync(S.sessionId, S.myFirmId, inst);
    logEv('round_opened', { async: 1 });
    setTab('decide');
  }

  /* ---- boot ----------------------------------------------------------------- */
  U.themeInit($('#btn-theme'));
  // Test mode (?preview=1): store.js runs on an isolated sandbox store, so this
  // whole play-through writes no data anywhere. Show a constant reminder ribbon.
  var PREVIEW = /(?:^|[?&])preview=1(?:&|$)/.test(location.search);
  if (PREVIEW) {
    document.body.classList.add('preview-mode');
    var pv = document.createElement('div');
    pv.className = 'preview-ribbon';
    pv.innerHTML = '🧪 <b>Test mode</b> — you are in a private sandbox. Nothing you do here is saved.';
    document.body.appendChild(pv);
  }
  if (!PREVIEW && ST.backend === 'demo') $('#mode-pill').style.display = '';
  ST.uid().then(function (u) { S.uid = u; });
  var urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) { $('#in-code').value = urlCode.toUpperCase(); }
  $('#btn-join').addEventListener('click', joinSession);
  $('#in-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinSession(); });
  $('#btn-create-firm').addEventListener('click', createFirm);
  U.$all('#g-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.dataset.tab); });
  });
  if (urlCode) joinSession();

  function show(id) {
    U.$all('.screen').forEach(function (s2) { s2.classList.remove('active'); });
    $('#' + id).classList.add('active');
  }
  function setTab(name) {
    S.activeTab = name;
    U.$all('#g-tabs .tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === name); });
    U.$all('.tab-panel').forEach(function (p) { p.style.display = 'none'; });
    var p = $('#tp-' + name); if (p) p.style.display = '';
    renderGame(true);
  }

  /* ---- session join ----------------------------------------------------------- */
  function joinSession() {
    var code = $('#in-code').value.trim().toUpperCase();
    if (!code) return;
    $('#join-err').style.display = 'none';
    $('#btn-join').disabled = true;
    ST.getSessionByCode(code).then(function (sess) {
      $('#btn-join').disabled = false;
      if (!sess) {
        $('#join-err').textContent = ST.backend === 'demo'
          ? 'No session found with that code in this browser (demo mode — the session must be created in this same browser\'s admin panel).'
          : 'No session found with that code. Check it with your instructor — codes are not case-sensitive, and the session must be created and its code shared before you join.';
        $('#join-err').style.display = '';
        return;
      }
      attach(sess.id);
    }).catch(function (e) {
      $('#btn-join').disabled = false;
      var msg = String((e && e.message) || e);
      if (/operation-not-allowed/.test(msg)) msg = 'this game is not fully set up yet (anonymous sign-in is off). Please tell your instructor.';
      else if (/permission/i.test(msg)) msg = 'the game server rejected the request (security rules may not be published yet). Please tell your instructor.';
      $('#join-err').textContent = 'Could not join: ' + msg;
      $('#join-err').style.display = '';
    });
  }

  function attach(sessionId) {
    S.sessionId = sessionId;
    S.unsubs.forEach(function (u) { u(); }); S.unsubs = [];
    if (S.decisionUnsub) { S.decisionUnsub(); S.decisionUnsub = null; }
    if (S.asyncUnsub) { S.asyncUnsub(); S.asyncUnsub = null; }
    S.asyncWatching = false;
    S.instance = null;
    S.unsubs.push(ST.watchSession(sessionId, function (doc) {
      var prev = S.session;
      S.session = doc;
      if (!doc) { showGone('This session was deleted by the instructor.'); return; }
      if (prev && doc.round !== prev.round) S.submitted = false;
      route();
    }));
    S.unsubs.push(ST.watchFirms(sessionId, function (firms) { S.firms = firms || []; route(); }));
    S.unsubs.push(ST.watchResults(sessionId, function (res) { S.results = res || []; route(); }));
    S.unsubs.push(ST.watchMarkets(sessionId, function (m) { S.markets = m || []; route(); }));
    S.unsubs.push(ST.watchMessages(sessionId, function (m) {
      S.messages = m || [];
      paintMsgBadge();
      if (S.activeTab === 'messages' && $('#s-game').classList.contains('active')) renderMessages();
    }));
  }

  /* ---- messaging ---------------------------------------------------------------- */
  function msgSeenKey() { return 'ssc-msgseen-' + S.sessionId; }
  function myInbox() {
    var mine = S.myFirmId;
    return (S.messages || []).filter(function (m) { return m.from === mine || m.to === mine; });
  }
  function paintMsgBadge() {
    var badge = $('#msg-badge');
    if (!badge || !S.myFirmId) return;
    var seen = 0;
    try { seen = Number(localStorage.getItem(msgSeenKey())) || 0; } catch (e) {}
    var unread = (S.messages || []).filter(function (m) { return m.to === S.myFirmId && (m.at || 0) > seen; }).length;
    badge.style.display = unread ? '' : 'none';
    badge.textContent = unread;
  }
  function renderMessages() {
    var box = $('#tp-messages'), sess = V(), mine = myFirm();
    if (!box || !mine) return;
    var keepText = $('#msg-text') ? $('#msg-text').value : '';
    var keepTo = $('#msg-to') ? $('#msg-to').value : '';
    var keepFocus = document.activeElement && document.activeElement.id === 'msg-text';
    try { localStorage.setItem(msgSeenKey(), String(Date.now())); } catch (e) {}
    paintMsgBadge();
    if (!sess.settings.chatOn) {
      box.innerHTML = '<div class="card"><p class="muted">Messaging is switched off for this session.</p></div>';
      return;
    }
    var others = S.firms.filter(function (f) { return f.id !== mine.id && !f.isBot; });
    var html = '<div class="card"><div class="card-title">Send a message</div>' +
      '<p class="card-subtitle">Talk to the instructor, or to another firm — negotiate, coordinate, bluff… ' +
      '<b>The instructor can see every message.</b></p>' +
      '<div class="flex-row"><select class="input input-sm" id="msg-to" style="width:auto; min-width:180px;">' +
      '<option value="admin">Instructor</option>' +
      others.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<textarea class="input" id="msg-text" maxlength="500" placeholder="Your message…" style="margin-top:8px;"></textarea>' +
      '<button class="btn btn-sm" id="msg-send" style="margin-top:8px;">Send</button></div>';
    html += '<div class="card"><div class="card-title">Your conversations</div>';
    var inbox = myInbox();
    if (!inbox.length) html += '<p class="muted small">No messages yet.</p>';
    else {
      html += inbox.slice(-100).map(function (m) {
        var fromMe = m.from === mine.id;
        var who = fromMe ? 'You → ' + esc(m.to === 'admin' ? 'Instructor' : firmName(m.to))
                         : esc(m.from === 'admin' ? '📣 Instructor' : firmName(m.from)) + ' → you';
        return '<div class="news-item"><span class="news-round">R' + (m.round || '·') + '</span>' +
          '<span><b class="' + (fromMe ? 'muted' : '') + '">' + who + ':</b> ' + esc(m.text) + '</span></div>';
      }).join('');
    }
    box.innerHTML = html + '</div>';
    if ($('#msg-text') && keepText) $('#msg-text').value = keepText;
    if ($('#msg-to') && keepTo) $('#msg-to').value = keepTo;
    if (keepFocus && $('#msg-text')) {
      var mt = $('#msg-text');
      mt.focus(); mt.setSelectionRange(mt.value.length, mt.value.length);
    }
    $('#msg-send').addEventListener('click', function () {
      var text = $('#msg-text').value.trim();
      if (!text) return;
      var to = $('#msg-to').value;
      var toF = S.firms.find(function (f) { return f.id === to; });
      $('#msg-send').disabled = true;
      ST.saveMessage(S.sessionId, {
        from: mine.id, fromName: mine.name, to: to,
        toName: to === 'admin' ? 'Instructor' : (toF ? toF.name : to),
        text: text.slice(0, 500), round: V().round, at: Date.now()
      }).then(function () { $('#msg-text').value = ''; $('#msg-send').disabled = false; })
        .catch(function (e) { $('#msg-send').disabled = false; alert('Send failed: ' + e.message); });
    });
  }
  function firmName(id) {
    var f = S.firms.find(function (x) { return x.id === id; });
    return f ? f.name : id;
  }

  /* ---- action telemetry (append-only; instructor-only reads) -------------------- */
  function myMemberName(mine) {
    var m = mine && (mine.members || []).find(function (x) { return x.uid === S.uid; });
    return m ? m.name : null;
  }
  function secsSinceRoundOpen() {
    var vs = V();
    var t = vs && vs.roundOpenedAt;
    return t ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
  }
  function logEv(type, d) {
    if (!S.sessionId) return;
    var mine = myFirm();
    ST.logEvent(S.sessionId, {
      at: Date.now(), type: type, round: V() ? V().round : 0,
      firmId: mine ? mine.id : null, uid: S.uid, member: myMemberName(mine), d: d || {}
    }).catch(function () {});
  }

  function showGone(msg, title) {
    $('#gone-title').textContent = title || 'This session has ended';
    $('#gone-msg').textContent = msg || '';
    show('s-gone');
  }

  function firmKey() { return 'ssc-firm-' + S.sessionId; }
  function myFirm() {
    if (!S.firms.length) return null;
    var fid = null;
    try { fid = sessionStorage.getItem(firmKey()) || localStorage.getItem(firmKey()); } catch (e) {}
    var f = S.firms.find(function (x) { return x.id === fid; });
    if (f) return f;
    // fall back to uid membership (rejoining from a fresh tab/device)
    return S.firms.find(function (x) {
      return (x.members || []).some(function (m) { return m.uid === S.uid; });
    }) || null;
  }
  function rememberFirm(fid) {
    try { sessionStorage.setItem(firmKey(), fid); localStorage.setItem(firmKey(), fid); } catch (e) {}
  }

  /* ---- routing ---------------------------------------------------------------- */
  function route() {
    var sess = S.session;
    if (!sess) return;
    var mine = myFirm();
    S.myFirmId = mine ? mine.id : null;
    // a firm change (kicked → founded a new one) must drop ALL per-firm state
    if (S.gameFirmId !== (mine ? mine.id : null)) {
      S.gameFirmId = mine ? mine.id : null;
      S.decideRoundRendered = null; S.draft = null; S.submitted = false;
      if (S.decisionUnsub) { S.decisionUnsub(); S.decisionUnsub = null; }
      if (S.asyncUnsub) { S.asyncUnsub(); S.asyncUnsub = null; }
      S.asyncWatching = false; S.instance = null; S.creatingInstance = false;
    }
    if (!mine) { renderFirmSetup(); show('s-firm'); return; }
    if (isAsync()) {
      // self-paced: no lobby, no instructor pacing — straight into the game.
      // NOTE: demo-mode watchers fire SYNCHRONOUSLY during subscription, so
      // guard with a flag set beforehand and defer the re-route, or route()
      // would re-enter itself and recurse.
      if (!S.asyncWatching) {
        S.asyncWatching = true;
        S.asyncUnsub = ST.watchAsync(S.sessionId, mine.id, function (doc) {
          if (doc) {
            S.instance = doc; S.creatingInstance = false;
            setTimeout(route, 0);
            return;
          }
          if (!S.instance && !S.creatingInstance) {
            S.creatingInstance = true;
            // authoritative re-check first: a cached/offline null snapshot or a
            // teammate's concurrent create must never be overwritten
            ST.getAsync(S.sessionId, mine.id).then(function (existing) {
              if (existing) { S.instance = existing; S.creatingInstance = false; setTimeout(route, 0); return; }
              S.instance = makeInstance(mine);
              return ST.saveAsync(S.sessionId, mine.id, S.instance).then(function () {
                S.creatingInstance = false;
                logEv('async_started', { bots: S.instance.botFirms.length });
                setTimeout(route, 0);
              }).catch(function () { // lost the race: adopt whatever exists
                S.instance = null; S.creatingInstance = false;
              });
            });
          }
        });
      }
      if (!S.instance) return; // waiting for the first snapshot
      show('s-game');
      renderGame();
      return;
    }
    if (sess.phase === 'lobby') { renderLobby(mine); show('s-lobby'); return; }
    show('s-game');
    renderGame();
  }

  /* ---- firm setup --------------------------------------------------------------- */
  function renderFirmSetup() {
    var sess = S.session, cat = sess.catalog;
    $('#firm-title').textContent = sess.name || 'Join the game';
    $('#firm-sub').textContent = 'Session ' + sess.code + ' · ' + sess.settings.rounds +
      ' rounds · product: ' + cat.product.name;
    var hubSel = $('#in-hub');
    if (!hubSel.options.length) {
      Object.keys(cat.regions).forEach(function (rid) {
        var o = document.createElement('option');
        o.value = rid; o.textContent = cat.regions[rid].name + ' (' + cat.regions[rid].port + ')';
        hubSel.appendChild(o);
      });
      hubSel.addEventListener('change', paintHubHint);
    }
    paintHubHint();
    var list = $('#firm-list');
    if (!S.firms.length) { list.innerHTML = '<p class="muted small">No firms yet — be the first.</p>'; }
    else {
      list.innerHTML = '';
      S.firms.forEach(function (f) {
        var row = U.el('div', { class: 'sess-card' });
        row.innerHTML = '<div class="sess-top"><span class="sess-name">' + esc(f.name) + '</span>' +
          '<span class="pill pill-plain">' + esc(sess.catalog.regions[f.hub].name) + ' hub</span></div>' +
          '<div class="sess-meta">' + esc((f.members || []).map(function (m) { return m.name; }).join(', ') || (f.isBot ? 'Computer-run firm' : '—')) + '</div>';
        var b = U.el('button', { class: 'btn-ghost btn-sm', text: f.isBot ? 'Computer firm' : 'Join this firm' });
        b.disabled = !!f.isBot;
        b.addEventListener('click', function () { joinFirm(f); });
        row.appendChild(b);
        list.appendChild(row);
      });
    }
  }
  function paintHubHint() {
    var sess = S.session, cat = sess.catalog;
    var hub = $('#in-hub').value || Object.keys(cat.regions)[0];
    var mkts = E.activeMarkets(sess);
    var bits = mkts.map(function (m) {
      var t = E.tariffRate(sess, m.region, hub, 1);
      return esc(m.name) + ' ' + (m.region === hub ? 'is home turf (no tariff)' :
        Math.round(t * 100) + '% tariff');
    });
    $('#hub-hint').innerHTML = 'Selling from this hub: ' + bits.join(' · ') +
      '. Component imports into your hub pay that region\'s tariff too. Tariffs can change mid-game.';
  }
  function createFirm() {
    if (!isAsync() && S.session && S.session.phase !== 'lobby') {
      alert('The game has already started — ask the instructor to pause or add you.'); return;
    }
    var name = $('#in-firmname').value.trim();
    var membersRaw = $('#in-members').value.trim();
    var err = $('#firm-err');
    err.style.display = 'none';
    if (!name) { err.textContent = 'Give your firm a name.'; err.style.display = ''; return; }
    if (S.firms.some(function (f) { return f.name.toLowerCase() === name.toLowerCase(); })) {
      err.textContent = 'A firm with that name already exists — join it instead, or pick another name.';
      err.style.display = ''; return;
    }
    var members = membersRaw ? membersRaw.split(',').map(function (s2) { return s2.trim(); }).filter(Boolean) : [];
    var fid = 'f' + Math.random().toString(36).slice(2, 10);
    var firm = {
      id: fid, name: name, hub: $('#in-hub').value,
      members: members.length ? members.map(function (n) { return { uid: S.uid, name: n }; })
                              : [{ uid: S.uid, name: 'Founder' }],
      memberUids: [S.uid],
      isBot: false, createdAt: Date.now()
    };
    ST.setFirm(S.sessionId, fid, firm).then(function () {
      rememberFirm(fid);
      logEv('firm_created', { name: name, hub: firm.hub });
      route();
    });
  }
  function joinFirm(f) {
    if (!isAsync() && S.session && S.session.phase === 'final') {
      alert('This game has finished.'); return;
    }
    var name = $('#in-joinname').value.trim();
    if (!name) { alert('Enter your name first (left of the Join button).'); return; }
    // atomic append in the store (arrayUnion / re-read inside the write), so
    // two teammates joining at the same moment never drop a membership
    ST.addFirmMember(S.sessionId, f.id, { uid: S.uid, name: name })
      .then(function () { rememberFirm(f.id); logEv('member_joined', { name: name }); route(); })
      .catch(function (e) { alert('Could not join: ' + e.message); });
  }

  /* ---- lobby ------------------------------------------------------------------- */
  function renderLobby(mine) {
    $('#lobby-firm').style.display = '';
    $('#lobby-firm').innerHTML = 'You are <b>' + esc(mine.name) + '</b> — hub: ' +
      esc(S.session.catalog.regions[mine.hub].name) + '. Team: ' +
      esc((mine.members || []).map(function (m) { return m.name; }).join(', '));
    $('#lobby-firms').innerHTML = S.firms.map(function (f) {
      return '<div class="news-item"><span>' + esc(f.name) + (f.isBot ? ' <span class="pill pill-plain">bot</span>' : '') +
        '</span><span class="muted small">' + esc(S.session.catalog.regions[f.hub].name) + '</span></div>';
    }).join('') || '<p class="muted small">No firms yet.</p>';
  }

  /* ---- state reconstruction ------------------------------------------------------ */
  function resultsFor(firmId) {
    var src = isAsync() ? (S.instance ? S.instance.results : []) : S.results;
    return src.filter(function (r) { return r.firmId === firmId; })
      .sort(function (a, b) { return a.round - b.round; });
  }
  function stateOf(firmId) {
    if (isAsync()) {
      if (S.instance && S.instance.states[firmId]) return S.instance.states[firmId];
      var f0 = gameFirms().find(function (x) { return x.id === firmId; });
      return f0 ? E.initFirmState(S.session, f0) : null;
    }
    var rs = resultsFor(firmId);
    if (rs.length) return rs[rs.length - 1].endState;
    var f = S.firms.find(function (x) { return x.id === firmId; });
    return f ? E.initFirmState(S.session, f) : null;
  }
  function statesAll() {
    var out = {};
    gameFirms().forEach(function (f) { out[f.id] = stateOf(f.id); });
    return out;
  }
  function marketDoc(round) {
    var src = isAsync() ? (S.instance ? S.instance.markets : []) : S.markets;
    return src.find(function (m) { return m.round === round; }) || null;
  }

  /* ---- game shell ------------------------------------------------------------------ */
  function renderGame(tabOnly) {
    var sess = V(), mine = myFirm();
    if (!mine) { showGone('Your firm was removed from this session by the instructor.', 'Firm removed'); return; }
    var st = stateOf(mine.id);
    $('#g-title').textContent = mine.name;
    $('#firm-pill').style.display = '';
    $('#firm-pill').textContent = mine.name;

    var phaseChip =
      sess.phase === 'decisions' ? '<span class="pill pill-green">Round ' + sess.round + ' — decisions open</span>' :
      sess.phase === 'resolved' ? (isAsync()
        ? '<span class="pill pill-amber">Round ' + sess.round + ' resolved — start the next when ready</span>'
        : '<span class="pill pill-amber">Round ' + sess.round + ' resolved — waiting for the instructor</span>') :
      '<span class="pill pill-blue">Game over — final results</span>';
    $('#g-chips').innerHTML = '<span class="pill pill-plain">Round ' + Math.min(sess.round, sess.settings.rounds) +
      ' of ' + sess.settings.rounds + '</span>' + phaseChip +
      (isAsync() ? '<span class="pill pill-blue" title="Self-paced practice: you play at your own pace against computer firms that price at the Nash equilibrium and run an optimal ordering policy.">vs ' +
        (S.instance ? S.instance.botFirms.length : '') + ' optimal bots</span>' : '') +
      '<span class="pill pill-plain">Hub: ' + esc(sess.catalog.regions[mine.hub].name) + '</span>';

    var kitsNow = E.kitsAvailable(sess, st);
    var arriving = 0;
    (st.pipeline || []).forEach(function (e) { if (e.eta <= sess.round) arriving += e.qty; });
    $('#g-stats').innerHTML =
      statBox(fmtM(st.cash), 'Cash', st.cash < 0 ? 'neg' : '') +
      statBox(st.green, 'Green score (0–100)', st.green >= 60 ? 'pos' : '') +
      statBox(st.brand, 'Brand', '') +
      statBox(fmtI(st.fg), 'Finished e-bikes in stock', '') +
      statBox(fmtI(kitsNow), 'Component sets on hand', '') +
      statBox(fmtI(arriving), 'Component units arriving this round', '');

    paintBroadcast();
    if (sess.phase === 'final') $('#tab-debrief-btn').style.display = '';

    if (!tabOnly || true) {
      if (S.activeTab === 'decide') renderDecide(mine, st);
      if (S.activeTab === 'chain') renderChain(mine, st);
      if (S.activeTab === 'results') renderResults(mine);
      if (S.activeTab === 'news') renderNews();
      if (S.activeTab === 'messages') renderMessages();
      if (S.activeTab === 'standings') renderStandings();
      if (S.activeTab === 'debrief') renderDebrief(mine);
    }
    if (sess.phase === 'final' && S.activeTab === 'decide') setTab('debrief');
  }
  function statBox(n, l, cls) {
    return '<div class="stat-box"><div class="n ' + (cls || '') + '">' + n + '</div><div class="l">' + l + '</div></div>';
  }
  function paintBroadcast() {
    var sess = S.session, box = $('#g-banner');
    var bcs = sess.broadcasts || [];
    var latest = bcs.length ? bcs[bcs.length - 1] : null;
    var dismissed = null;
    try { dismissed = localStorage.getItem('ssc-bc-' + S.sessionId); } catch (e) {}
    if (latest && String(latest.id) !== dismissed) {
      box.innerHTML = '<div class="banner banner-info row-between"><span>📣 <b>Instructor:</b> ' +
        esc(latest.text) + '</span><button class="link-btn" id="bc-dismiss">dismiss</button></div>';
      $('#bc-dismiss').addEventListener('click', function () {
        try { localStorage.setItem('ssc-bc-' + S.sessionId, String(latest.id)); } catch (e) {}
        box.innerHTML = '';
      });
    } else box.innerHTML = '';
  }

  /* ---- DECIDE tab -------------------------------------------------------------------- */
  function renderDecide(mine, st) {
    var sess = V(), box = $('#tp-decide');
    if (sess.phase !== 'decisions') {
      box.innerHTML = '<div class="card"><h2>' +
        (sess.phase === 'final' ? 'The game is over' : 'Round ' + sess.round + ' has been resolved') +
        '</h2><p class="muted">' + (sess.phase === 'final' ? 'See the Debrief tab for the final standings.' :
        (isAsync() ? 'Check the <b>Results</b> tab, then start the next round whenever your team is ready.' :
         'Check the <b>Results</b> tab to see how you did. The instructor will open the next round shortly.')) +
        '</p>' +
        (isAsync() && sess.phase === 'resolved'
          ? '<button class="btn" id="btn-nextround">▶ Start round ' + (sess.round + 1) + ' of ' + sess.settings.rounds + '</button>'
          : '') +
        '</div>';
      if ($('#btn-nextround')) $('#btn-nextround').addEventListener('click', startNextAsyncRound);
      S.decideRoundRendered = null;
      return;
    }
    if (S.decideRoundRendered === sess.round) { updatePreview(mine, st); paintSubmitState(); return; }
    S.decideRoundRendered = sess.round;

    // start from the saved draft for this round, else an empty decision
    S.draft = null; S.submitted = false; S.draftRound = sess.round;
    ST.getDecision(S.sessionId, mine.id, sess.round).then(function (saved) {
      var now = V();
      if (!now || now.phase !== 'decisions' || now.round !== sess.round ||
          S.decideRoundRendered !== sess.round || S.myFirmId !== mine.id) return;
      var d = E.sanitizeDecision(sess, mine.id, sess.round, saved);
      S.draft = d;
      S.submitted = !!(saved && saved.submitted);
      S.lastRemoteStamp = saved ? saved.savedAt : null;
      buildDecideForm(mine, st, d);
      watchTeamDecision(mine, sess.round);
    });
  }

  // Teammate sync: teams may edit from several devices. We live-watch the
  // firm's decision doc for the open round; when a save arrives that isn't our
  // own echo, the newest save wins VISIBLY — the form reloads from it (with a
  // note) instead of a stale tab silently clobbering a submitted plan later.
  function watchTeamDecision(mine, round) {
    if (S.decisionUnsub) S.decisionUnsub();
    S.decisionUnsub = ST.watchDecision(S.sessionId, mine.id, round, function (doc) {
      var vs = V();
      if (!doc || !vs || vs.phase !== 'decisions') return;
      if (vs.round !== round || doc.round !== round) return;
      if (doc.savedAt == null || doc.savedAt === S.lastRemoteStamp) return;
      if (doc.savedAt === S.lastWriteStamp) { S.lastRemoteStamp = doc.savedAt; return; } // our own write
      S.lastRemoteStamp = doc.savedAt;
      clearTimeout(S.saveTimer); // never flush a stale draft over the teammate's newer save
      S.draft = E.sanitizeDecision(V(), mine.id, round, doc);
      S.submitted = !!doc.submitted;
      S.decideRoundRendered = null;
      renderDecide(mine, stateOf(mine.id));
      if (S.activeTab === 'decide') {
        var note = U.el('div', { class: 'banner banner-info', id: 'team-sync-note' },
          '↺ Updated with your teammate\'s latest ' + (doc.submitted ? 'submitted decisions.' : 'draft.'));
        var old = $('#team-sync-note'); if (old) old.remove();
        var tp = $('#tp-decide');
        if (tp.firstChild) tp.insertBefore(note, tp.firstChild);
        setTimeout(function () { if (note.parentNode) note.remove(); }, 6000);
      }
    });
  }

  function buildDecideForm(mine, st, d) {
    var sess = V(), cat = sess.catalog, s = sess.settings, box = $('#tp-decide');
    var news = E.newsFor(sess, sess.round);
    var html = '';
    if (news.length) {
      html += '<div class="banner banner-warn"><b>This round:</b><br>' +
        news.map(function (n) { return '• ' + esc(n.text); }).join('<br>') + '</div>';
    }
    html += '<div id="coach-nudges"></div>';

    // --- sourcing ---
    html += '<div class="card"><div class="card-title">1 · Source components</div>' +
      '<p class="card-subtitle">Each e-bike needs one of each component. Orders placed now arrive after the ' +
      'lead time shown (sea is cheap and clean but slow; air is fast, ~80× the freight cost and ~30× the CO2). ' +
      'Supplier capacity is shared across <b>all</b> firms — if a supplier is oversubscribed, every order is cut ' +
      'pro-rata and you pay only for what ships. Imports into your hub pay that region\'s tariff.</p>';
    cat.components.forEach(function (c) {
      html += '<div class="comp-card"><div class="comp-head"><b>' + esc(c.name) + '</b>' +
        '<span class="comp-meta">on hand: ' + fmtI(st.comp[c.id] || 0) + ' · ' + c.weightKg + ' kg/unit</span></div>' +
        '<div class="tbl-scroll"><table class="tbl tbl-tight"><thead><tr>' +
        '<th>Supplier</th><th>Region</th><th class="r">Unit cost</th><th class="r">CO2/unit</th>' +
        '<th class="r" title="Supplier ESG rating (labour, environment, governance). Below 60 is risky: unaudited low-ESG sourcing can trigger a scandal.">ESG</th>' +
        '<th class="r" title="Units per round, shared across ALL firms. Oversubscribed orders are cut pro-rata.">Capacity</th>' +
        '<th>Ship via</th><th class="r">Lead</th><th class="r">Order qty</th></tr></thead><tbody>';
      c.suppliers.forEach(function (sup) {
        var o = (d.orders[c.id] || {})[sup.id] || { qty: 0, mode: 'surface' };
        var tariff = E.tariffRate(sess, mine.hub, sup.region, sess.round);
        html += '<tr>' +
          '<td>' + esc(sup.name) + (st.audits.indexOf(sup.id) !== -1 ? ' <span class="pill pill-green" title="You audited this supplier: +15 effective ESG and no scandal risk from it.">audited</span>' : '') + '</td>' +
          '<td>' + esc(cat.regions[sup.region].name) + (tariff > 0 ? ' <span class="tiny muted">+' + Math.round(tariff * 100) + '% tariff</span>' : '') + '</td>' +
          '<td class="r">$' + sup.cost + '</td>' +
          '<td class="r">' + sup.co2 + ' kg</td>' +
          '<td class="r"><span class="esg ' + U.esgClass(sup.esg) + '">' + sup.esg + '</span></td>' +
          '<td class="r">' + fmtI(sup.capacity) + '</td>' +
          '<td><select class="input input-sm mode-select" id="mode-' + c.id + '-' + sup.id + '">' +
            '<option value="surface"' + (o.mode !== 'air' ? ' selected' : '') + '>Sea</option>' +
            '<option value="air"' + (o.mode === 'air' ? ' selected' : '') + '>Air</option></select></td>' +
          '<td class="r lead-cell" id="lead-' + c.id + '-' + sup.id + '"></td>' +
          '<td class="r"><input type="number" min="0" step="10" class="input input-sm qty-input" id="qty-' + c.id + '-' + sup.id + '" value="' + (o.qty || '') + '" placeholder="0"/></td>' +
          '</tr>';
      });
      html += '</tbody></table></div></div>';
    });
    html += '</div>';

    // --- production ---
    var kitsNow = E.kitsAvailable(sess, st);
    var kitsWithArrivals = E.kitsAvailable(sess, E.withArrivals(sess, st, sess.round));
    html += '<div class="card"><div class="card-title">2 · Produce</div>' +
      '<p class="card-subtitle">Assembly at your ' + esc(cat.regions[mine.hub].name) + ' plant costs $' +
      cat.product.assemblyCost + '/unit (' + (st.renewable ? cat.product.assemblyCO2Renewable : cat.product.assemblyCO2) +
      ' kg CO2/unit). Capacity ' + fmtI(s.factoryCapacity) + ' units/round. You can assemble at most the component ' +
      'sets available when the round is resolved — on hand now: <b>' + fmtI(kitsNow) + '</b>, incl. arrivals due this round: <b>' +
      fmtI(kitsWithArrivals) + '</b>.</p>' +
      '<div class="field" style="max-width:220px;"><label>Units to produce this round</label>' +
      '<input type="number" min="0" step="10" class="input" id="f-production" value="' + (d.production || '') + '" placeholder="0"/></div></div>';

    // --- pricing ---
    var lastMkt = marketDoc(sess.round - 1);
    html += '<div class="card"><div class="card-title">3 · Price your e-bikes</div>' +
      '<p class="card-subtitle">Market share follows price (vs the reference), your green score and your brand — ' +
      'consumers in some markets pay real attention to sustainability. Unsold demand is lost, and stockouts dent your brand.</p><div class="grid3">';
    E.activeMarkets(sess).forEach(function (m) {
      var p = d.prices[m.id] != null ? d.prices[m.id] : m.refPrice;
      var intel = '';
      if (s.marketIntel && lastMkt) {
        intel = 'Last round: demand ' + fmtI(lastMkt.demand[m.id]) + ', avg price ' + fmtM(lastMkt.avgPrice[m.id]);
      } else if (s.marketIntel) intel = 'Market size ~' + fmtI(m.size * (s.demandScale || 1)) + ' units/round';
      html += '<div class="field"><label>' + esc(m.name) + ' <span class="muted">(ref ' + fmtM(m.refPrice) + ')' +
        (m.region === mine.hub ? ' · home market' : '') + '</span></label>' +
        '<input type="number" min="1" class="input" id="price-' + m.id + '" value="' + p + '"/>' +
        '<span class="tiny muted">' + intel + '</span></div>';
    });
    html += '</div></div>';

    // --- sustainability ---
    html += '<div class="card"><div class="card-title">4 · Sustainability moves</div><div class="grid2">';
    html += '<div>';
    if (st.renewable) {
      html += '<p class="small">✅ Renewable-energy plant installed — assembly CO2 is ' + cat.product.assemblyCO2Renewable + ' kg/unit.</p>';
    } else {
      html += '<label class="checkline"><input type="checkbox" id="f-renewable"' + (d.buyRenewable ? ' checked' : '') + '/>' +
        '<span>Install renewable energy at the plant (one-time ' + fmtM(s.renewableCapex) + '): assembly CO2 ' +
        cat.product.assemblyCO2 + ' → ' + cat.product.assemblyCO2Renewable + ' kg/unit, and it lifts your green score.</span></label>';
    }
    html += '<div class="field" style="max-width:240px;"><label>Buy carbon offsets (tonnes, ' + fmtM(s.offsetPricePerTon) + '/t)</label>' +
      '<input type="number" min="0" class="input" id="f-offsets" value="' + (d.offsetTons || '') + '" placeholder="0"/>' +
      '<span class="tiny muted">Offsets reduce your <b>net</b> CO2 (and help a little on the score) — they never reduce your gross footprint.</span></div>';
    html += '</div><div><div class="sub-title">Supplier ESG audits (' + fmtM(s.auditCost) + ' each, one-time)</div>' +
      '<p class="section-hint">An audit raises a supplier\'s effective ESG by 15 and removes its scandal risk. Sourcing from unaudited suppliers with ESG below 60 risks a scandal (brand −12).</p>';
    cat.components.forEach(function (c) {
      c.suppliers.forEach(function (sup) {
        if (st.audits.indexOf(sup.id) !== -1) return;
        if (sup.esg >= 75) return; // auditing squeaky-clean suppliers isn't worth a checkbox
        html += '<label class="checkline"><input type="checkbox" class="audit-check" data-sup="' + sup.id + '"' +
          ((d.auditSuppliers || []).indexOf(sup.id) !== -1 ? ' checked' : '') + '/><span>' +
          esc(sup.name) + ' <span class="esg ' + U.esgClass(sup.esg) + '">' + sup.esg + '</span></span></label>';
      });
    });
    html += '</div></div></div>';

    // --- preview + submit / end-round ---
    html += '<div class="preview-box" id="plan-preview"></div>';
    if (isAsync()) {
      html += '<div class="flex-row"><button class="btn" id="btn-endround">⚙ End round ' + sess.round + ' — resolve &amp; see results</button>' +
        '<span class="ok-flash" id="save-flash">draft saved</span></div>' +
        '<p class="tiny muted">Self-paced practice: ending the round resolves it immediately against your ' +
        (S.instance ? S.instance.botFirms.length : '') + ' computer rivals — they price at the Nash equilibrium and run an optimal ordering policy. Your draft autosaves, so a teammate on another device sees it too.</p>';
    } else {
      html += '<div class="flex-row"><button class="btn" id="btn-submit">Submit decisions for round ' + sess.round + '</button>' +
        '<button class="btn-ghost" id="btn-reopen" style="display:none;">Reopen &amp; edit</button>' +
        '<span class="ok-flash" id="save-flash">draft saved</span></div>' +
        '<p class="tiny muted">Your draft autosaves. Decisions lock in when the instructor resolves the round — ' +
        'anything not submitted is taken as-is (an empty form means: order nothing, produce nothing, keep reference prices).</p>';
    }

    box.innerHTML = html;

    // wire events
    U.$all('#tp-decide input, #tp-decide select').forEach(function (inp) {
      inp.addEventListener('input', onDecideChange);
      inp.addEventListener('change', onDecideChange);
    });
    if ($('#btn-submit')) $('#btn-submit').addEventListener('click', function () { submitDecision(true); });
    if ($('#btn-reopen')) $('#btn-reopen').addEventListener('click', function () { submitDecision(false); });
    if ($('#btn-endround')) $('#btn-endround').addEventListener('click', function () {
      S.draft = collectDecision(mine);
      endAsyncRound(mine);
    });
    paintLeads(mine);
    updatePreview(mine, st);
    paintSubmitState();
  }

  function paintLeads(mine) {
    var sess = V();
    sess.catalog.components.forEach(function (c) {
      c.suppliers.forEach(function (sup) {
        var modeEl = $('#mode-' + c.id + '-' + sup.id);
        var cell = $('#lead-' + c.id + '-' + sup.id);
        if (!modeEl || !cell) return;
        var lead = E.leadTime(sess, sup.region, mine.hub, modeEl.value, sess.round);
        cell.textContent = lead + (lead === 1 ? ' round' : ' rounds');
      });
    });
  }

  function collectDecision(mine) {
    var sess = V();
    var d = E.emptyDecision(sess, mine.id, sess.round);
    sess.catalog.components.forEach(function (c) {
      c.suppliers.forEach(function (sup) {
        var q = $('#qty-' + c.id + '-' + sup.id);
        var m = $('#mode-' + c.id + '-' + sup.id);
        if (q && Number(q.value) > 0) d.orders[c.id][sup.id] = { qty: Number(q.value), mode: m ? m.value : 'surface' };
      });
    });
    d.production = Number(($('#f-production') || {}).value) || 0;
    E.activeMarkets(sess).forEach(function (mk) {
      var p = $('#price-' + mk.id);
      if (p && p.value !== '') d.prices[mk.id] = Number(p.value);
    });
    d.offsetTons = Number(($('#f-offsets') || {}).value) || 0;
    var rEl = $('#f-renewable');
    d.buyRenewable = !!(rEl && rEl.checked);
    d.auditSuppliers = U.$all('.audit-check').filter(function (c2) { return c2.checked; })
      .map(function (c2) { return c2.dataset.sup; });
    d.submitted = S.submitted;
    return E.sanitizeDecision(sess, mine.id, sess.round, d);
  }

  function onDecideChange() {
    var mine = myFirm(); if (!mine || S.submitted) return;
    var st = stateOf(mine.id);
    paintLeads(mine);
    S.draft = collectDecision(mine);
    updatePreview(mine, st);
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () {
      var vs = V();
      if (!S.draft || !vs || vs.phase !== 'decisions' || S.draft.round !== vs.round) return;
      S.draft.savedAt = Date.now();
      S.lastWriteStamp = S.draft.savedAt;
      ST.saveDecision(S.sessionId, mine.id, S.draft.round, S.draft).then(function () {
        var fl = $('#save-flash');
        if (fl) { fl.classList.add('show'); setTimeout(function () { fl.classList.remove('show'); }, 1200); }
      });
      logEv('decision_saved', { round: S.draft.round, units: Math.round(S.draft.production || 0),
        secs: secsSinceRoundOpen() });
    }, 700);
  }

  function updatePreview(mine, st) {
    var box = $('#plan-preview');
    if (!box) return;
    var sess = V();
    var d = S.draft || E.emptyDecision(sess, mine.id, sess.round);
    var pv = E.previewDecision(sess, st, d, sess.round);
    var kitsOrdered = Math.round(pv.orders.kitsOrdered);
    var co2PerKit = kitsOrdered > 0 ? Math.round((pv.orders.co2Comp + pv.orders.co2Freight) / kitsOrdered) : null;
    var capWarn = pv.orders.lines.some(function (l) {
      var sup = null;
      sess.catalog.components.forEach(function (c) { var s2 = E.findSupplier(c, l.supplierId); if (s2) sup = s2; });
      return sup && l.requested > sup.capacity;
    });
    box.innerHTML = '<div class="row"><span>Component orders (purchase + freight + tariffs)</span><b>' + fmtM(pv.orders.total) + '</b></div>' +
      '<div class="row muted small"><span>… of which import tariffs</span><b>' + fmtM(pv.orders.tariff) + '</b></div>' +
      '<div class="row muted small"><span>… of which freight</span><b>' + fmtM(pv.orders.freight) + '</b></div>' +
      '<div class="row"><span>Production (' + fmtI(pv.produce) + ' units planned' +
        (pv.produce < (d.production || 0) ? ' — capped by components/capacity' : '') + ')</span><b>' + fmtM(pv.prodCost) + '</b></div>' +
      '<div class="row"><span>Sustainability investments &amp; offsets</span><b>' + fmtM(pv.invest) + '</b></div>' +
      '<div class="row"><span>Fixed overhead</span><b>' + fmtM(sess.settings.overheadPerRound) + '</b></div>' +
      '<div class="row" style="border-top:1px solid var(--border); margin-top:4px; padding-top:6px;"><span><b>Cash after this spending</b> (before revenue)</span><b class="' +
        (pv.cashAfterSpend < 0 ? 'neg' : '') + '">' + fmtM(pv.cashAfterSpend) + '</b></div>' +
      (co2PerKit != null ? '<div class="row muted small"><span>Ordered ~' + fmtI(kitsOrdered) + ' component sets · embodied + inbound CO2</span><b>' + co2PerKit + ' kg/set</b></div>' : '') +
      (capWarn ? '<div class="row small" style="color:var(--amber);"><span>⚠ Some orders exceed a supplier\'s shared capacity — expect pro-rata cuts if other firms order too.</span></div>' : '') +
      (pv.cashAfterSpend < 0 ? '<div class="row small" style="color:var(--red);"><span>Negative cash pays ' + Math.round(sess.settings.overdraftRate * 100) + '%/round overdraft interest.</span></div>' : '');
    paintNudges(mine, st, d);
  }

  // Automatic coaching nudges (engine.coachDecision): live checks on the
  // current draft — thin pipelines, over-ordering, below-cost prices, air
  // waste, scandal exposure, horizon waste… capped and priority-ordered.
  function paintNudges(mine, st, d) {
    var box = $('#coach-nudges');
    if (!box) return;
    var sess = V();
    if (!sess.settings.coachOn || sess.phase !== 'decisions') { box.innerHTML = ''; return; }
    var tips = E.coachDecision(sess, mine, st, d, sess.round, gameFirms().length);
    box.innerHTML = tips.map(function (t) {
      var cls = t.level === 'warn' ? 'banner-warn' : (t.level === 'good' ? 'banner-good' : 'banner-info');
      return '<div class="banner ' + cls + '" style="padding:8px 12px; font-size:12.5px; margin:6px 0;">🎓 ' + esc(t.text) + '</div>';
    }).join('');
  }

  function paintSubmitState() {
    var sub = $('#btn-submit'), re = $('#btn-reopen');
    if (!sub) return;
    U.$all('#tp-decide input, #tp-decide select').forEach(function (inp) { inp.disabled = S.submitted; });
    sub.style.display = S.submitted ? 'none' : '';
    re.style.display = S.submitted ? '' : 'none';
    var existing = $('#submitted-banner');
    if (S.submitted && !existing) {
      var b = U.el('div', { class: 'banner banner-good', id: 'submitted-banner' },
        '✔ Decisions submitted for round ' + V().round + '. You can still reopen and edit until the instructor resolves the round.');
      $('#tp-decide').insertBefore(b, $('#tp-decide').firstChild);
    } else if (!S.submitted && existing) existing.remove();
  }

  function submitDecision(flag) {
    var mine = myFirm(); if (!mine || isAsync()) return;
    S.submitted = flag;
    var d = flag && S.draft ? S.draft : collectDecision(mine);
    d.submitted = flag;
    d.submittedAt = Date.now();
    d.savedAt = Date.now();
    S.lastWriteStamp = d.savedAt;
    S.draft = d;
    ST.saveDecision(S.sessionId, mine.id, V().round, d).then(paintSubmitState);
    logEv(flag ? 'decision_submitted' : 'decision_reopened', { round: d.round, secs: secsSinceRoundOpen() });
  }

  /* ---- SUPPLY CHAIN tab -------------------------------------------------------------- */
  function renderChain(mine, st) {
    var sess = V(), cat = sess.catalog;
    var html = '<div class="columns">';
    html += '<div><div class="card"><div class="card-title">Inventory at your hub</div><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Item</th><th class="r">Units on hand</th></tr></thead><tbody>';
    cat.components.forEach(function (c) {
      html += '<tr><td>' + esc(c.name) + '</td><td class="r">' + fmtI(st.comp[c.id] || 0) + '</td></tr>';
    });
    html += '<tr><td><b>Finished ' + esc(cat.product.unitLabel) + 's</b></td><td class="r"><b>' + fmtI(st.fg) + '</b></td></tr>';
    html += '</tbody></table></div>' +
      '<p class="tiny muted">Holding costs: ' + fmtM(sess.settings.holdingComp) + '/component/round, ' +
      fmtM(sess.settings.holdingFG) + '/finished unit/round. Component sets ready to assemble: <b>' +
      fmtI(E.kitsAvailable(sess, st)) + '</b> (factory capacity ' + fmtI(sess.settings.factoryCapacity) + '/round).</p></div>';

    html += '<div class="card"><div class="card-title">Your footprint &amp; standing</div>' +
      '<div class="tbl-scroll"><table class="tbl"><tbody>' +
      '<tr><td>Cumulative gross CO2</td><td class="r">' + U.fmtCO2(st.cum.co2Gross) + '</td></tr>' +
      '<tr><td>Offsets purchased</td><td class="r">' + U.fmtCO2(st.cum.offsets) + '</td></tr>' +
      '<tr><td>Net CO2</td><td class="r">' + U.fmtCO2(st.cum.co2Net) + '</td></tr>' +
      '<tr><td>CO2 intensity (production, per unit)</td><td class="r">' + (st.cum.produced ? Math.round(st.cum.prodCO2 / st.cum.produced) + ' kg' : '–') + '</td></tr>' +
      '<tr><td>Units produced / sold</td><td class="r">' + fmtI(st.cum.produced) + ' / ' + fmtI(st.cum.sold) + '</td></tr>' +
      '<tr><td>Renewable plant</td><td class="r">' + (st.renewable ? 'Yes' : 'No') + '</td></tr>' +
      '<tr><td>Audited suppliers</td><td class="r">' + (st.audits.length || 'None') + '</td></tr>' +
      '<tr><td>ESG scandals</td><td class="r">' + st.cum.scandals + '</td></tr>' +
      '</tbody></table></div></div></div>';

    html += '<div class="card"><div class="card-title">Inbound pipeline</div>' +
      '<p class="card-subtitle">Component orders on their way to your hub. Orders arrive at the START of their ETA round and can be used in that round\'s production.</p>';
    if (!(st.pipeline || []).length) html += '<p class="muted small">Nothing in transit.</p>';
    else {
      html += '<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Component</th><th>Supplier</th><th class="r">Units</th><th>Mode</th><th class="r">Ordered in</th><th class="r">Arrives</th></tr></thead><tbody>';
      st.pipeline.slice().sort(function (a, b) { return a.eta - b.eta; }).forEach(function (e) {
        var comp = E.findComponent(cat, e.compId);
        var sup = comp ? E.findSupplier(comp, e.supplierId) : null;
        var here = e.eta <= sess.round;
        html += '<tr><td>' + esc(comp ? comp.name : e.compId) + '</td><td>' + esc(sup ? sup.name : e.supplierId) + '</td>' +
          '<td class="r">' + fmtI(e.qty) + '</td><td>' + (e.mode === 'air' ? 'Air ✈' : 'Sea 🚢') + '</td>' +
          '<td class="r">R' + e.placed + '</td><td class="r">' + (here ? '<span class="pill pill-green">this round</span>' : 'R' + e.eta) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    $('#tp-chain').innerHTML = html + '</div>';
  }

  /* ---- RESULTS tab ---------------------------------------------------------------------- */
  function renderResults(mine) {
    var box = $('#tp-results');
    var rs = resultsFor(mine.id);
    if (!rs.length) {
      box.innerHTML = '<div class="card"><p class="muted">No rounds resolved yet — results appear here after the instructor resolves round 1.</p></div>';
      return;
    }
    var sel = S.resultsRound && rs.some(function (r) { return r.round === S.resultsRound; }) ? S.resultsRound : rs[rs.length - 1].round;
    S.resultsRound = sel;
    var r = rs.find(function (x) { return x.round === sel; });
    var mkt = marketDoc(sel);
    var sess = V(), s = sess.settings;

    var html = '<div class="flex-row" style="margin-bottom:10px;"><span class="sub-title" style="margin:0;">Round</span>';
    rs.forEach(function (x) {
      html += '<button class="btn-ghost btn-sm' + (x.round === sel ? '' : '') + '" style="' +
        (x.round === sel ? 'border-color:var(--accent); color:var(--accent);' : '') + '" data-r="' + x.round + '">' + x.round + '</button>';
    });
    html += '</div>';

    if (isAsync() && sess.phase === 'resolved' && sel === sess.round) {
      html += '<div class="banner banner-good row-between"><span>Round ' + sel + ' resolved — take your time here, then continue.</span>' +
        '<button class="btn btn-sm" id="btn-nextround-res">▶ Start round ' + (sess.round + 1) + '</button></div>';
    }
    if (r.scandal) html += '<div class="banner banner-bad">🔎 ' + esc(r.scandal) + '</div>';
    if (r.cut > 0) html += '<div class="banner banner-warn">✂ Suppliers were oversubscribed: ' + fmtI(r.cut) +
      ' ordered component units were cut pro-rata (you were not charged for them). Everyone ordering more than they need makes this worse — classic rationing.</div>';
    if (r.lost > 0) html += '<div class="banner banner-warn">📉 You stocked out: ' + fmtI(r.lost) +
      ' units of demand went unserved (lost sales — and stockouts dent your brand).</div>';

    html += '<div class="columns">';
    // P&L
    html += '<div class="card"><div class="card-title">P&amp;L — round ' + sel + '</div>' +
      '<div class="tbl-scroll"><table class="tbl"><tbody>' +
      plRow('Revenue (' + fmtI(sumVals(r.sold)) + ' units)', r.revenue, true) +
      plRow('Component purchases', -r.costs.purchase) +
      plRow('Inbound freight', -r.costs.inFreight) +
      plRow('Import tariffs (components)', -r.costs.inTariff) +
      plRow('Production (' + fmtI(r.produced) + ' units)', -r.costs.production) +
      plRow('Outbound freight', -r.costs.outFreight) +
      plRow('Export tariffs (finished goods)', -r.costs.outTariff) +
      plRow('Inventory holding', -r.costs.holding) +
      plRow('Overhead', -r.costs.overhead) +
      (r.costs.carbonTax ? plRow('Carbon tax', -r.costs.carbonTax) : '') +
      (r.costs.offsets ? plRow('Carbon offsets', -r.costs.offsets) : '') +
      (r.costs.investments ? plRow('Investments (renewable / audits)', -r.costs.investments) : '') +
      (r.costs.interest ? plRow('Overdraft interest', -r.costs.interest) : '') +
      '<tr><td><b>Profit</b></td><td class="r ' + U.posneg(r.profit) + '"><b>' + fmtM(r.profit) + '</b></td></tr>' +
      '</tbody></table></div></div>';

    // markets
    html += '<div><div class="card"><div class="card-title">Sales by market</div><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Market</th><th class="r">You sold</th><th class="r">Your price</th>' +
      (s.marketIntel ? '<th class="r">Market demand</th><th class="r">Avg price</th>' : '') + '</tr></thead><tbody>';
    E.activeMarkets(sess).forEach(function (m) {
      html += '<tr><td>' + esc(m.name) + '</td><td class="r">' + fmtI(r.sold[m.id] || 0) + '</td>' +
        '<td class="r">' + fmtM(r.prices[m.id]) + '</td>' +
        (s.marketIntel && mkt ? '<td class="r">' + fmtI(mkt.demand[m.id]) + '</td><td class="r">' + fmtM(mkt.avgPrice[m.id]) + '</td>' : (s.marketIntel ? '<td class="r">–</td><td class="r">–</td>' : '')) +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    // CO2
    html += '<div class="card"><div class="card-title">CO2 — round ' + sel + '</div><div class="tbl-scroll"><table class="tbl"><tbody>' +
      '<tr><td>Components (embodied)</td><td class="r">' + U.fmtCO2(r.co2.components) + '</td></tr>' +
      '<tr><td>Inbound freight</td><td class="r">' + U.fmtCO2(r.co2.inFreight) + '</td></tr>' +
      '<tr><td>Assembly</td><td class="r">' + U.fmtCO2(r.co2.assembly) + '</td></tr>' +
      '<tr><td>Outbound freight</td><td class="r">' + U.fmtCO2(r.co2.outFreight) + '</td></tr>' +
      '<tr><td><b>Gross</b></td><td class="r"><b>' + U.fmtCO2(r.co2.gross) + '</b></td></tr>' +
      (r.co2.offsets ? '<tr><td>Offsets</td><td class="r">−' + U.fmtCO2(r.co2.offsets) + '</td></tr>' : '') +
      (r.co2.intensity != null ? '<tr><td>Per unit produced</td><td class="r">' + r.co2.intensity + ' kg</td></tr>' : '') +
      '</tbody></table></div>' +
      '<p class="tiny muted">Green score now: <b>' + r.green + '</b> · brand: <b>' + r.brand + '</b></p></div></div></div>';

    // coach's notes for this round
    if (s.coachOn) {
      var prevRs = resultsFor(mine.id).filter(function (x) { return x.round < sel; });
      var prevState = prevRs.length ? prevRs[prevRs.length - 1].endState : E.initFirmState(sess, mine);
      if (prevState) {
        var statesNow = statesAll();
        var parts = gameFirms().map(function (f) {
          var st2 = statesNow[f.id] || {};
          return { firmId: f.id, hub: f.hub, green: st2.green != null ? st2.green : 50, brand: st2.brand != null ? st2.brand : 50 };
        });
        var notes = E.coachResult(sess, mine, prevState, r, parts, sel);
        if (notes.length) {
          html += '<div class="card"><div class="card-title">\ud83c\udf93 Coach\u2019s notes \u2014 round ' + sel + '</div>' +
            '<p class="card-subtitle">Automatic feedback on your round: benchmarked against competitive pricing for your costs &amp; reputation, and an order-up-to inventory policy.</p>' +
            notes.map(function (t) {
              var cls = t.level === 'warn' ? 'banner-warn' : (t.level === 'good' ? 'banner-good' : 'banner-info');
              return '<div class="banner ' + cls + '" style="padding:8px 12px; font-size:13px; margin:6px 0;">' + esc(t.text) + '</div>';
            }).join('') + '</div>';
        }
      }
    }

    // charts over rounds
    var st = stateOf(mine.id);
    var hist = st.hist || [];
    var labels = hist.map(function (h) { return 'R' + h.round; });
    html += '<div class="chart-box"><h4>Your demand vs orders — watch the bullwhip build</h4>' +
      U.lineChart({ labels: labels, series: [
        { name: 'Consumer demand you faced', values: hist.map(function (h) { return h.demand; }) },
        { name: 'Component sets you ordered', color: '#1f5f8b', values: hist.map(function (h) { return h.ordered; }) },
        { name: 'Units sold', color: '#2e7d32', values: hist.map(function (h) { return h.sold; }) }
      ] }) + U.legendHtml([{ name: 'Consumer demand you faced' }, { name: 'Component sets you ordered', color: '#1f5f8b' }, { name: 'Units sold', color: '#2e7d32' }]) + '</div>';
    html += '<div class="chart-box"><h4>Profit by round</h4>' +
      U.lineChart({ labels: labels, series: [{ name: 'Profit', values: hist.map(function (h) { return h.profit; }) }],
                    yFmt: function (v) { return (v / 1000) + 'k'; } }) + '</div>';

    box.innerHTML = html;
    U.$all('#tp-results [data-r]').forEach(function (b) {
      b.addEventListener('click', function () { S.resultsRound = Number(b.dataset.r); renderResults(mine); });
    });
    if ($('#btn-nextround-res')) $('#btn-nextround-res').addEventListener('click', startNextAsyncRound);
  }
  function plRow(label, v, boldPos) {
    return '<tr><td>' + label + '</td><td class="r ' + (v < 0 ? '' : 'pos') + '">' + fmtM(v) + '</td></tr>';
  }
  function sumVals(o) { var t = 0; Object.keys(o || {}).forEach(function (k) { t += o[k]; }); return t; }

  /* ---- NEWS tab ------------------------------------------------------------------------- */
  function renderNews() {
    var sess = V(), box = $('#tp-news');
    var items = [];
    if (sess.phase === 'decisions') {
      E.newsFor(sess, sess.round).forEach(function (n) { items.push({ round: sess.round, text: n.text, now: true }); });
    }
    (isAsync() ? (S.instance ? S.instance.markets : []) : S.markets).slice()
      .sort(function (a, b) { return b.round - a.round; }).forEach(function (m) {
      (m.news || []).forEach(function (n) { items.push({ round: m.round, text: n.text }); });
    });
    (sess.broadcasts || []).slice().reverse().forEach(function (b) {
      items.push({ round: b.round, text: '📣 Instructor: ' + b.text, bc: true });
    });
    var html = '<div class="card"><div class="card-title">Market news</div>';
    if (!items.length) html += '<p class="muted small">Quiet so far. Tariff announcements, port congestion, supply disruptions and instructor messages appear here.</p>';
    else {
      html += items.map(function (it) {
        return '<div class="news-item"><span class="news-round">R' + it.round + (it.now ? ' · now' : '') + '</span><span>' + esc(it.text) + '</span></div>';
      }).join('');
    }
    box.innerHTML = html + '</div>';
  }

  /* ---- STANDINGS tab ---------------------------------------------------------------------- */
  function renderStandings() {
    var sess = V(), box = $('#tp-standings');
    if (!sess.settings.showStandings && sess.phase !== 'final') {
      box.innerHTML = '<div class="card"><p class="muted">The instructor is keeping the leaderboard hidden until the end. 🙈</p></div>';
      return;
    }
    var anyResults = isAsync() ? !!(S.instance && S.instance.results.length) : !!S.results.length;
    if (!anyResults) {
      box.innerHTML = '<div class="card"><p class="muted">Standings appear after the first round is resolved.</p></div>';
      return;
    }
    box.innerHTML = leaderboardHtml(false);
  }
  function leaderboardHtml(final) {
    var sess = V();
    var lb = E.leaderboard(sess, gameFirms(), statesAll());
    var w = sess.settings.scoreWeightProfit;
    var html = '<div class="card"><div class="card-title">' + (final ? 'Final standings' : 'Standings so far') + '</div>' +
      '<p class="card-subtitle">Score = ' + w + '% profit rank + ' + (100 - w) + '% sustainability rank (green score).</p>' +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr><th>#</th><th>Firm</th><th>Hub</th><th class="r">Cumulative profit</th>' +
      '<th class="r">Green</th><th class="r">CO2/unit</th><th class="r">Units sold</th><th class="r">Scandals</th>' +
      (final ? '<th class="r" title="Variance of your component orders vs variance of the demand you faced. Above 1 = you amplified demand swings upstream — the bullwhip effect.">Bullwhip</th>' : '') +
      '<th class="r">Score</th></tr></thead><tbody>';
    lb.forEach(function (r, i) {
      html += '<tr' + (r.firmId === S.myFirmId ? ' style="background:var(--paper-dark); font-weight:600;"' : '') + '>' +
        '<td>' + (i + 1) + (final && i === 0 ? ' 🏆' : '') + '</td><td>' + esc(r.name) + '</td>' +
        '<td>' + esc(sess.catalog.regions[r.hub].name) + '</td>' +
        '<td class="r ' + U.posneg(r.profit) + '">' + fmtM(r.profit) + '</td>' +
        '<td class="r">' + r.green + '</td><td class="r">' + (r.co2PerUnit != null ? r.co2PerUnit + ' kg' : '–') + '</td>' +
        '<td class="r">' + fmtI(r.sold) + '</td><td class="r">' + (r.scandals || '') + '</td>' +
        (final ? '<td class="r">' + (r.bullwhip != null ? '×' + r.bullwhip : '–') + '</td>' : '') +
        '<td class="r"><b>' + r.score + '</b></td></tr>';
    });
    return html + '</tbody></table></div></div>';
  }

  /* ---- DEBRIEF tab ---------------------------------------------------------------------------- */
  function renderDebrief(mine) {
    var sess = V(), box = $('#tp-debrief');
    if (sess.phase !== 'final') { box.innerHTML = '<div class="card"><p class="muted">The debrief unlocks when the game ends.</p></div>'; return; }
    var st = stateOf(mine.id);
    var hist = st.hist || [];
    var labels = hist.map(function (h) { return 'R' + h.round; });
    var lb = E.leaderboard(sess, gameFirms(), statesAll());
    var myBw = E.bullwhipRatio(st);

    var html = leaderboardHtml(true);

    html += '<div class="card"><div class="card-title">The bullwhip effect — your firm</div>' +
      '<p class="card-subtitle">Consumer demand vs what you ordered upstream. If the blue line swings harder than the orange one, ' +
      'you amplified variability up the chain — extra inventory, stockouts and cost for everyone above you. ' +
      (myBw != null ? 'Your amplification ratio: <b>×' + myBw + '</b>' + (myBw > 1 ? ' — demand variability grew on its way upstream.' : ' — impressively steady ordering!') : '') + '</p>' +
      '<div class="chart-box">' + U.lineChart({ labels: labels, series: [
        { name: 'Consumer demand', values: hist.map(function (h) { return h.demand; }) },
        { name: 'Your component orders', color: '#1f5f8b', values: hist.map(function (h) { return h.ordered; }) }
      ] }) + U.legendHtml([{ name: 'Consumer demand' }, { name: 'Your component orders', color: '#1f5f8b' }]) + '</div>' +
      '<div class="chart-box"><h4>Order amplification' + (isAsync() ? '' : ' across the class') + '</h4>' +
      U.barChart({ items: lb.filter(function (r) {
                     var f2 = gameFirms().find(function (x) { return x.id === r.firmId; });
                     return !(f2 && f2.isBot && f2.botProfile === 'nash');
                   }).map(function (r) { return { label: r.name, value: r.bullwhip || 0, color: r.firmId === mine.id ? '#c8562a' : '#1f5f8b' }; }),
                   fmt: function (v) { return '×' + v; } }) +
      '<p class="tiny muted">Ratio of order variability to demand variability (CV², measured over the steady middle of the game). Lee, Padmanabhan &amp; Whang\'s four causes were all in this game: demand-signal processing, order batching, price/cost changes (tariffs), and rationing &amp; shortage gaming.' +
      (gameFirms().some(function (f2) { return f2.isBot && f2.botProfile === 'nash'; })
        ? ' The optimal bots are excluded from this chart: they pre-position inventory for demand shifts they rationally anticipate, so their order variability is anticipation, not amplification.' : '') +
      '</p></div></div>';

    html += '<div class="card"><div class="card-title">Profit vs planet</div>' +
      '<p class="card-subtitle">Two rankings, one supply chain. Compare where firms landed on each — and what their sourcing map looked like.</p>' +
      '<div class="columns"><div class="chart-box"><h4>Cumulative profit</h4>' +
      U.barChart({ items: lb.map(function (r) { return { label: r.name, value: r.profit, color: r.firmId === mine.id ? '#c8562a' : '#4a4f55' }; }),
                   fmt: function (v) { return fmtM(v); } }) + '</div>' +
      '<div class="chart-box"><h4>CO2 per unit produced (kg)</h4>' +
      U.barChart({ items: lb.map(function (r) { return { label: r.name, value: r.co2PerUnit || 0, color: r.firmId === mine.id ? '#c8562a' : '#2e7d32' }; }) }) + '</div></div></div>';

    html += '<div class="card"><div class="card-title">Your game, round by round</div><div class="chart-box">' +
      U.lineChart({ labels: labels, series: [
        { name: 'Profit', values: hist.map(function (h) { return h.profit; }) }
      ], yFmt: function (v) { return (v / 1000) + 'k'; } }) + '</div>' +
      '<div class="chart-box">' + U.lineChart({ labels: labels, series: [
        { name: 'Green score', color: '#2e7d32', values: hist.map(function (h) { return h.green; }) },
        { name: 'Brand', color: '#8e5bc0', values: hist.map(function (h) { return h.brand; }) }
      ] }) + U.legendHtml([{ name: 'Green score', color: '#2e7d32' }, { name: 'Brand', color: '#8e5bc0' }]) + '</div></div>';

    box.innerHTML = html;
  }
})();
