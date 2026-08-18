/* ── lit-news.js — the "What's new" list: who may see an entry, and the
 *                  maintainer's controls over it ────────────────────────────
 *
 * ONE definition, loaded by ALL THREE consumers:
 *
 *   the About page   <script src="../lit-news.js">              -> window.LitNews
 *   the main browser  <script src="lit-news.js">                -> window.LitNews
 *   the mailer        createRequire(...)('.../lit-news.js')     -> module.exports
 *
 * lit/changelog.json stays THE single source of truth for what was announced —
 * the About page's list, the alert preview inside the main page and the
 * "New features & updates to the website" digests all read it. Firestore
 * `newsOverrides/{changelog id}` (project lit-paper-browser) now holds the
 * maintainer's DECISION about each entry, and nothing else:
 *
 *   status: 'approved'   published — every visitor sees it
 *   status: 'pending'    not reviewed yet — only the maintainer sees it
 *   status: 'removed'    taken down — it leaves the list entirely
 *   title / summary      an optional rewording, applied wherever it is shown
 *
 * THREE RULES THE OWNER ASKED FOR (2026-08-18):
 *
 *   1. A REMOVED ENTRY LEAVES THE LIST, for the maintainer too — the list is
 *      meant to get cleaner, not to fill up with struck-through entries.
 *   2. AND REMOVING IS NOT A ONE-WAY DOOR. Filtering an entry out for everybody
 *      would leave nothing on the page to press to bring it back, so the
 *      removed ones go into a COLLAPSED panel below the list, drawn for the
 *      maintainer alone: out of the way, one click from Restore.
 *   3. A NEW ENTRY IS NOT PUBLIC ON SIGHT. An entry with no decision is
 *      PENDING: the maintainer sees it flagged with Publish, and nobody else
 *      sees it at all — nor is anybody e-mailed about it, which is the half
 *      that cannot be taken back.
 *
 * THE GATE ARRIVING IS NOT A REASON TO RETRACT. The entries already on the
 * site have no decision document, and on the first load they would all have
 * gone pending — the whole list would have vanished. Already public is already
 * reviewed in the only sense that matters, so an entry dated before
 * REVIEW_FROM is approved by default. A date rather than a list of ids, so
 * nothing has to be backfilled; and because the mailer already windows by date
 * (a back-dated entry precedes every subscriber's window and reaches nobody),
 * back-dating stays safe.
 *
 * This is the same design as assets/oa-news.js on operationsacademia.org, whose
 * pages had the same problem — keep the two in step in SHAPE, not in code: they
 * are different sites, different Firebase projects and different markup.
 *
 * Written in ES5 so it needs no transpiling for either consumer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LitNews = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLLECTION = 'newsOverrides';

  var APPROVED = 'approved';
  var PENDING = 'pending';
  var REMOVED = 'removed';

  /* Every key a decision document may carry — pinned against the hasOnly()
     list in lit/_firestore.rules by lit/_scraper/news-selftest.mjs. A key
     written here without a rule is a permission-denied at save time, and a
     maintainer told to redeploy rules that are already deployed. */
  var DOC_KEYS = ['status', 'hidden', 'title', 'summary', 't'];

  var TITLE_MAX = 300;
  var SUMMARY_MAX = 4000;   // a Lit changelog summary is a full paragraph

  /* The day the review gate shipped. Everything dated before it was already on
     the site (and already e-mailed), so it is approved without a document. */
  var REVIEW_FROM = '2026-08-19';

  function day(v) { return String(v == null ? '' : v).slice(0, 10); }

  function arr(v) {
    return Object.prototype.toString.call(v) === '[object Array]' ? v : [];
  }

  /** What a stored document SAYS, or '' when it says nothing about publication. */
  function decision(doc) {
    if (!doc) return '';
    var s = String(doc.status || '');
    if (s === APPROVED || s === PENDING || s === REMOVED) return s;
    if (doc.hidden === true) return REMOVED;
    if (doc.hidden === false) return APPROVED;
    return '';
  }

  /** approved | pending | removed, for one changelog entry. */
  function statusOf(entry, doc, opts) {
    var said = decision(doc);
    if (said) return said;
    var from = (opts && opts.reviewFrom) || REVIEW_FROM;
    return day(entry && entry.date) < from ? APPROVED : PENDING;
  }

  /** The entry as it should READ: the maintainer's wording where they gave
      one, the changelog's where they did not. Same shape as a changelog entry. */
  function applied(entry, doc) {
    var o = doc || {};
    var e = entry || {};
    return {
      id: e.id,
      date: day(e.date),
      title: (typeof o.title === 'string' && o.title) ? o.title : (e.title || ''),
      summary: (typeof o.summary === 'string' && o.summary) ? o.summary : (e.summary || ''),
      url: e.url || ''
    };
  }

  function byDateDesc(a, b) {
    return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
  }

  /** Split the changelog three ways under the maintainer's decisions. `docs` is
      a plain object keyed by changelog id; every list is newest first. */
  function partition(updates, docs, opts) {
    var d = docs || {};
    var out = { approved: [], pending: [], removed: [] };
    arr(updates).forEach(function (e) {
      if (!e || !e.id || !e.title || !e.date) return;
      var doc = d[e.id];
      var row = applied(e, doc);
      row.status = statusOf(e, doc, opts);
      row.edited = !!(doc && (doc.title || doc.summary));
      if (row.status === REMOVED) out.removed.push(row);
      else if (row.status === PENDING) out.pending.push(row);
      else out.approved.push(row);
    });
    out.approved.sort(byDateDesc);
    out.pending.sort(byDateDesc);
    out.removed.sort(byDateDesc);
    return out;
  }

  /** What may be shown to ANYONE — the About page's list, the alert preview,
      and the only entries the mailer may put in a digest. */
  function publicUpdates(updates, docs, opts) {
    return partition(updates, docs, opts).approved.map(function (r) {
      return { id: r.id, date: r.date, title: r.title, summary: r.summary, url: r.url };
    });
  }

  /** The document a decision writes. `hidden` is kept in step with `status` so
      a page served from an old cache cannot put a removed entry back. */
  function patchFor(status, extra) {
    var p = { status: status, hidden: status === REMOVED, t: Date.now() };
    if (extra) {
      if (typeof extra.title === 'string') p.title = extra.title.slice(0, TITLE_MAX);
      if (typeof extra.summary === 'string') p.summary = extra.summary.slice(0, SUMMARY_MAX);
    }
    return p;
  }

  /* ------------------------------------------------------------- the browser

     Everything below touches the DOM or Firebase and runs only when it is
     called, so requiring this file in Node stays free of both. */

  var ADMIN_EMAIL = 'kstouras@gmail.com';   // mirrors isFeedbackAdmin() in _firestore.rules

  var MOUNTED = [];
  var decisionsPromise = null;

  function db() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) return null;
    try { return firebase.firestore(); } catch (e) { return null; }
  }

  /**
   * The maintainer's decisions, read once per page. Resolves to a plain object
   * keyed by changelog id, and to {} when there is nothing to read from — the
   * date rule then stands on its own, which withholds everything since the
   * gate rather than guessing.
   */
  function decisions() {
    if (decisionsPromise) return decisionsPromise;
    var d = db();
    if (!d) {
      decisionsPromise = Promise.resolve({ ok: false, docs: {} });
      return decisionsPromise;
    }
    decisionsPromise = d.collection(COLLECTION).get().then(function (snap) {
      var out = {};
      snap.forEach(function (doc) { out[doc.id] = doc.data(); });
      return { ok: true, docs: out };
    })['catch'](function () { return { ok: false, docs: {} }; });
    return decisionsPromise;
  }

  /**
   * For the main browser, which needs the published list for its alert preview
   * and nothing else: hand `raw` (changelog.json as served) and get back the
   * public entries, twice — immediately under the date rule alone, and again
   * once the decisions land. Costs one Firestore read per page that asks, so
   * the main page asks only when the alerts panel is opened.
   */
  function gate(raw, onList) {
    onList(publicUpdates(raw, {}));
    decisions().then(function (res) {
      if (res.ok) onList(publicUpdates(raw, res.docs));
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(label, onClick) {
    var b = el('button', null, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function fmtDay(iso) {
    try {
      return new Date(day(iso) + 'T00:00:00Z').toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
      });
    } catch (e) { return day(iso); }
  }

  function httpUrl(u) {
    return /^https?:\/\//i.test('' + (u || '')) ? ('' + u) : '';
  }

  function isAdminUser(u) {
    return !!(u && u.email && u.email.toLowerCase() === ADMIN_EMAIL && u.emailVerified);
  }

  /**
   * Render the What's new list into an element and, for the maintainer, its
   * controls.
   *
   *   LitNews.mount({ list: '#litWhatsNew', head: '#litWhatsNewHead', limit: 8 })
   */
  function mount(cfg) {
    cfg = cfg || {};
    var host = typeof cfg.list === 'string' ? document.querySelector(cfg.list) : cfg.list;
    if (!host) return null;
    var head = cfg.head ? document.querySelector(cfg.head) : null;

    var limit = cfg.limit || 0;
    var updates = null;
    var docs = {};
    var docsRead = false;
    var admin = false;
    var editing = null;
    var draft = null;           // what has been typed into the open editor
    var flash = null;
    var binOpen = false;        // is the "Removed updates" panel unfolded?
    var written = {};           // ids this session decided — never overwritten by an older read

    function strings(n) { return n === 1 ? 'entry' : 'entries'; }

    function fail(err) {
      var code = (err && (err.code || err.message)) || 'error';
      flash = {
        err: true,
        text: 'Could not save that (' + code + ').' +
          (/permission/i.test(code)
            ? ' That is a permission-denied — are the latest Firestore rules deployed?'
            : '')
      };
      render();
    }

    function save(id, patch, done) {
      var d = db();
      if (!d) return;
      flash = null;
      d.collection(COLLECTION).doc(id).set(patch, { merge: true }).then(function () {
        written[id] = true;
        docs[id] = docs[id] || {};
        for (var k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) docs[id][k] = patch[k];
        }
        if (done) done();
        render();
      })['catch'](fail);
    }

    function decide(id, status) { save(id, patchFor(status)); }

    /* Publishing a whole day's shipping at once. Several entries land together
       often enough here — one change ships with its changelog entry, and a busy
       day ships three — that a gate which can only be cleared one at a time is
       a gate that does not get cleared. One write at a time, failures counted
       rather than thrown. */
    function publishAll(rows) {
      var d = db();
      if (!rows.length || !d) return;
      if (!window.confirm('Publish ' + rows.length + ' ' + strings(rows.length) +
        ' on the site?\n\nThey appear in What\'s new at once, and go out in the ' +
        'next "new features & updates" e-mail.')) return;
      flash = { text: 'Publishing 0 of ' + rows.length + '…' };
      render();
      var done = 0, failed = 0;
      rows.reduce(function (chain, r) {
        return chain.then(function () {
          return d.collection(COLLECTION).doc(r.id).set(patchFor(APPROVED), { merge: true })
            .then(function () {
              done++;
              written[r.id] = true;
              docs[r.id] = docs[r.id] || {};
              docs[r.id].status = APPROVED;
              docs[r.id].hidden = false;
            })['catch'](function () { failed++; });
        });
      }, Promise.resolve()).then(function () {
        flash = failed
          ? { err: true, text: done + ' published, ' + failed + ' could not be saved — ' +
              'reload and try those again.' }
          : { text: 'All ' + done + ' published.' };
        render();
      });
    }

    /* An inline form, not two prompt() boxes: a summary here is a full
       paragraph, and a browser prompt shows one as a single unscrollable line,
       which is how "editing" it turns into retyping it.

       WHAT IS TYPED SURVIVES A RE-RENDER, and that is not a nicety: the list
       re-renders on its own when the decisions arrive late or the session
       resolves, and it re-renders on a FAILED save — which is exactly the
       moment (the rules are not deployed yet) when losing a paragraph just
       written would hurt most. */
    function editor(row, li) {
      if (!draft) draft = { title: row.title, summary: row.summary };
      var form = el('div', 'wn-edit');
      var t = document.createElement('input');
      t.type = 'text';
      t.value = draft.title;
      t.maxLength = TITLE_MAX;
      t.setAttribute('aria-label', 'Title shown on the site');
      t.addEventListener('input', function () { draft.title = t.value; });
      var s = document.createElement('textarea');
      s.value = draft.summary;
      s.maxLength = SUMMARY_MAX;
      s.rows = 7;
      s.setAttribute('aria-label', 'Summary shown on the site');
      s.addEventListener('input', function () { draft.summary = s.value; });
      var bar = el('div', 'wn-admin');
      bar.appendChild(button('Save', function () {
        save(row.id, patchFor(row.status, {
          title: draft.title.trim(), summary: draft.summary.trim()
        }), function () { editing = null; draft = null; });
      }));
      bar.appendChild(button('Cancel', function () {
        editing = null; draft = null; render();
      }));
      form.appendChild(t);
      form.appendChild(s);
      form.appendChild(bar);
      li.appendChild(form);
    }

    function item(row) {
      var li = el('li', 'wn-item' +
        (row.status === PENDING ? ' is-pending' : '') +
        (row.status === REMOVED ? ' is-removed' : ''));

      var d = el('div', 'wn-date', fmtDay(row.date));
      if (row.status === PENDING) d.appendChild(el('span', 'wn-flag', 'Not published yet'));
      li.appendChild(d);

      var title = el('div', 'wn-title');
      var url = httpUrl(row.url);
      if (url) {
        var a = el('a', null, row.title);
        a.href = url;
        title.appendChild(a);
      } else {
        title.textContent = row.title;
      }
      li.appendChild(title);
      if (row.summary) li.appendChild(el('div', 'wn-sum', row.summary));

      if (!admin) return li;
      if (editing === row.id) { editor(row, li); return li; }

      var bar = el('div', 'wn-admin');
      if (row.status === PENDING) {
        bar.appendChild(button('✓ Publish', function () { decide(row.id, APPROVED); }));
      }
      if (row.status === REMOVED) {
        bar.appendChild(button('↩ Restore', function () { decide(row.id, APPROVED); }));
      }
      bar.appendChild(button('✎ Edit', function () {
        editing = row.id; draft = null; render();
      }));
      if (row.status !== REMOVED) {
        bar.appendChild(button('✕ Remove', function () {
          if (!window.confirm('Remove “' + row.title + '” from What\'s new?\n\n' +
            'It comes off the list at once. changelog.json keeps the entry, and you ' +
            'can put it back from "Removed updates" under the list.')) return;
          decide(row.id, REMOVED);
        }));
      }
      li.appendChild(bar);
      return li;
    }

    /* The maintainer's own furniture: what is waiting ABOVE the list, where the
       flagged entries are, and the way back to a removed entry BELOW it, out of
       the way. Both are created lazily and only for the maintainer, so a
       visitor's page is exactly the page it was. */
    var extra = null;
    function panel() {
      if (extra) return extra;
      extra = { top: el('div', 'wn-panel'), bin: el('div', 'wn-panel') };
      if (host.parentNode) {
        host.parentNode.insertBefore(extra.top, host);
        host.parentNode.insertBefore(extra.bin, host.nextSibling);
      }
      return extra;
    }

    function clearPanel() {
      if (!extra) return;
      extra.top.innerHTML = '';
      extra.bin.innerHTML = '';
    }

    function render() {
      if (!updates) return;
      var split = partition(updates, docs);
      var shown = admin
        ? split.pending.concat(split.approved).sort(byDateDesc)
        : split.approved;
      var cut = limit ? shown.slice(0, limit) : shown;

      /* WITH NOTHING TO SHOW THE SECTION HIDES ITSELF, heading and all — the
         behaviour this list already had, kept because an empty "What's new"
         above the data notes reads as a fault. */
      if (!cut.length && !(admin && split.removed.length)) {
        host.innerHTML = '';
        host.style.display = 'none';
        if (head) head.style.display = 'none';
        clearPanel();
        return;
      }
      host.style.display = '';
      if (head) head.style.display = '';

      host.innerHTML = '';
      var ul = el('ul', 'wn-list');
      cut.forEach(function (row) { ul.appendChild(item(row)); });
      host.appendChild(ul);

      if (!admin) { clearPanel(); return; }

      var box = panel();
      clearPanel();

      if (flash) {
        var msg = el('p', 'wn-msg' + (flash.err ? ' is-err' : ''), flash.text);
        msg.setAttribute('role', 'status');
        box.top.appendChild(msg);
      }

      var n = split.pending.length;
      if (n) {
        var note = el('p', 'wn-note');
        note.appendChild(el('strong', null, n + ' new ' + strings(n) +
          (n === 1 ? ' is' : ' are') + ' waiting for you.'));
        note.appendChild(document.createTextNode(' Nobody else can see ' +
          (n === 1 ? 'it' : 'them') + ' — or is e-mailed about ' +
          (n === 1 ? 'it' : 'them') + ' — until you publish ' +
          (n === 1 ? 'it' : 'them') + '.'));
        if (n > 1) {
          note.appendChild(button('✓ Publish all ' + n, function () { publishAll(split.pending); }));
        }
        box.top.appendChild(note);
      }

      /* A read that never happened is not "nothing was decided": every entry
         since the gate would read as unreviewed and every removal would come
         back. Say so, rather than leaving the maintainer to wonder. */
      if (!docsRead) {
        box.top.appendChild(el('p', 'wn-msg is-err',
          'The review decisions could not be read, so this is the list as it ' +
          'stood before the review gate. Are the latest Firestore rules deployed?'));
      }

      if (split.removed.length) {
        var det = document.createElement('details');
        det.className = 'wn-bin';
        /* IT STAYS OPEN ACROSS A RE-RENDER. render() rebuilds this element, so
           without remembering the state every re-render snapped it shut — and
           pressing Edit on a removed entry re-renders, so the editor opened
           inside a panel that had just folded up and the button read as dead. */
        det.open = binOpen;
        det.addEventListener('toggle', function () { binOpen = det.open; });
        var sum = document.createElement('summary');
        sum.textContent = 'Removed updates (' + split.removed.length + ')';
        det.appendChild(sum);
        det.appendChild(el('p', 'wn-sum',
          'Off the site — nobody else sees these. Restore puts one back where ' +
          'its date belongs.'));
        var bin = el('ul', 'wn-list');
        split.removed.forEach(function (row) { bin.appendChild(item(row)); });
        det.appendChild(bin);
        box.bin.appendChild(det);
      }
    }

    /* ---------------------------------------------------------------- loading

       The changelog paints FIRST under the date rule alone, so the list is on
       screen without waiting for Firestore — and a database that cannot be
       reached costs the newest entries rather than the whole section.

       WHAT THAT FIRST PAINT CAN AND CANNOT PROMISE, exactly:

         • an UNREVIEWED entry can never appear in it — it is dated on or after
           the gate, so the date rule withholds it with no document at all,
           which is the half that must not leak;
         • a REMOVED entry that predates the gate IS in it until the decisions
           land a moment later. It was public until the maintainer took it
           down, so this shows something that WAS on the site rather than
           something that never was — and if the decisions never land it stays.
           The alternative is holding the whole list behind a Firestore read on
           every visit, which costs every visitor to spare that one; the
           maintainer's own panel says when the read failed. */
    fetch(cfg.src || '../changelog.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = Array.isArray(j) ? j : (j && Array.isArray(j.updates) ? j.updates : []);
        updates = list;
        render();
      })['catch'](function () { /* no log — the section stays as it was */ });

    decisions().then(function (res) {
      /* A DECISION MADE WHILE THIS READ WAS IN FLIGHT WINS. The read starts at
         mount and can land AFTER the maintainer has already pressed Publish or
         Remove — the write went to Firestore, but the answer coming back is
         older, and taking it wholesale would put the entry back on screen as
         though the press had done nothing. */
      for (var id in res.docs) {
        if (Object.prototype.hasOwnProperty.call(res.docs, id) && !written[id]) {
          docs[id] = res.docs[id];
        }
      }
      docsRead = res.ok;
      render();
    });

    if (window.firebase && firebase.apps && firebase.apps.length) {
      try {
        firebase.auth().onAuthStateChanged(function (u) {
          var is = isAdminUser(u);
          if (is === admin) return;
          admin = is;
          editing = null;
          draft = null;
          flash = null;
          render();
        });
      } catch (e) { /* no auth on this page — nobody is the maintainer here */ }
    }

    var ctl = {
      /* Deliberately JUST "new data, re-render" — it does not close an open
         editor, because that is what a real re-render does (the decisions
         landing, a snapshot arriving) and the guard uses it to prove a typed
         draft survives one. The paths that really do reset the editor — a
         successful save, an auth change — clear it themselves. */
      setForTest: function (nextDocs, isAdmin, nextUpdates) {
        if (nextDocs) docs = nextDocs;
        if (nextUpdates) updates = nextUpdates;
        if (typeof isAdmin === 'boolean') admin = isAdmin;
        docsRead = true;
        render();
      }
    };
    MOUNTED.push(ctl);
    return ctl;
  }

  function setForTest(docs, isAdmin, updates) {
    MOUNTED.forEach(function (c) { c.setForTest(docs, isAdmin, updates); });
    return MOUNTED.length;
  }

  return {
    COLLECTION: COLLECTION,
    APPROVED: APPROVED,
    PENDING: PENDING,
    REMOVED: REMOVED,
    DOC_KEYS: DOC_KEYS,
    REVIEW_FROM: REVIEW_FROM,
    TITLE_MAX: TITLE_MAX,
    SUMMARY_MAX: SUMMARY_MAX,
    ADMIN_EMAIL: ADMIN_EMAIL,
    decision: decision,
    statusOf: statusOf,
    applied: applied,
    partition: partition,
    publicUpdates: publicUpdates,
    patchFor: patchFor,
    gate: gate,
    mount: mount,
    __setForTest: setForTest
  };
}));
