/* ==========================================================================
   Simulation Platform — matching a simulation's own completion records to the
   roster, and spotting duplicate registrations (owner 2026-08-16).

   WHY THIS EXISTS. The "⟲ Verify from …" reconciliation used to join on the
   university student ID alone — but the ID is typed into two different forms,
   so one typo (or a student who re-registered "with slightly different data")
   loses the match for good: the simulation's own admin shows the play, the
   roster keeps reading "—" however often Verify is pressed (the reported Qiu
   Taoyi case, 2026-08-16). So the join is now STUDENT ID AND/OR E-MAIL:
   every adapter (admin/verify.js) reports each completed participant's e-mail
   where its records carry one, and a record whose ID answers to nobody still
   finds its student through the address. The same cross-identity view is what
   exposes DUPLICATE registrations — one person behind two roster rows (the
   roster only collapses same-ID duplicates, so what is left differs in ID) —
   which are surfaced to the admin in a pop-up with a per-entry removal
   suggestion, never removed automatically.

   Pure, no DOM, no network, loaded by admin/index.html before admin.js;
   `simulation/tools/match-guard.mjs` runs it offline.
   ========================================================================== */
window.SIMP_MATCH = (function () {
  'use strict';

  /* Under this, a completed play counts as "super fast" — the pattern where a
     student rushes through once, then registers again with slightly different
     details to play properly. Only ever drives a SUGGESTION in the duplicates
     pop-up (a pre-ticked box the admin can untick), never an automatic act. */
  var FAST_PLAY_MS = 5 * 60 * 1000;

  /* The e-mail join key, folded the same way everywhere (trim + lower-case).
     '' for anything that is not a plausible address — and for the Ideation
     Challenge's synthetic throwaway logins (student-…@simplatform.stouras.com),
     which identify an ACCOUNT the app minted, never a student a roster row
     could share. KEEP IN SYNC with the private copy in admin/verify.js (that
     file is also loaded standalone by its own guard); match-guard checks the
     two sources carry the same rules. */
  function emailKey(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    if (/@simplatform\.stouras\.com$/.test(s)) return '';
    return s;
  }

  /* Every e-mail behind one student's roster docs — a re-registration may
     have changed the address, and all of them identify the student. Groups
     come from SIMP_COMPLETIONS.groupByStudent (rows newest-first). */
  function groupEmails(g) {
    var seen = {}, out = [];
    ((g && g.rows) || []).forEach(function (r) {
      var k = emailKey(r && r.email);
      if (k && !seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out;
  }

  /* Newest activity stamp of a group — ISO strings, so a string compare is
     the chronological one (same convention as completions.js docNewer). */
  function groupStamp(g) {
    var r = (g && g.rows && g.rows[0]) || {};
    return String(r.updatedAt || r.createdAt || '');
  }

  /* joinRecords(groups, doneById, doneByEmail) — the two-pass join.
       groups      SIMP_COMPLETIONS.groupByStudent output
       doneById    { <student ID>: mark }  from the adapter
       doneByEmail { <e-mail>: mark }      from the adapter (optional)
     A mark is {ts, session, id?, email?, dur?} — id/email are the identities
     the simulation's own record carries, dur the play duration in ms (0 =
     unknown). Returns {
       matched:   { <groupKey>: mark } — every roster student the records
                  identify: by student ID first, then by the record's e-mail
                  (an ID typo no longer loses the student);
       via:       { <groupKey>: 'id' | 'email' } — how each match was made;
       unmatched: [id…] — completed student IDs no roster student answers to
                  by ID OR by the record's own e-mail (real strangers or
                  typos with no address to rescue them);
       links:     [[groupKeyA, groupKeyB]…] — pairs of DIFFERENT roster
                  students ONE record identifies both of (its ID matches one,
                  its e-mail the other): direct duplicate-registration
                  evidence, fed to findDuplicateClusters.
     } */
  function joinRecords(groups, doneById, doneByEmail) {
    groups = groups || {}; doneById = doneById || {}; doneByEmail = doneByEmail || {};
    var byPid = {}, byEmail = {};
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.pid) byPid[g.pid] = g;
      groupEmails(g).forEach(function (em) {
        (byEmail[em] = byEmail[em] || []).push(g);
      });
    });
    /* The group an e-mail identifies for STAMPING: when the address backs
       several roster students (a duplicate registration) take the most
       recently active one — the duplicates pop-up resolves the rest. */
    function emailGroup(em) {
      var list = em ? byEmail[em] : null;
      if (!list || !list.length) return null;
      var best = list[0];
      for (var i = 1; i < list.length; i++) {
        if (groupStamp(list[i]) > groupStamp(best)) best = list[i];
      }
      return best;
    }
    var matched = {}, via = {}, unmatched = [], links = [], linkSeen = {};
    var idHit = {};   // student IDs pass 1 actually MATCHED (by either route)
    function stamp(g, mark, how) {
      if (!matched[g.key] || (Number(mark.ts) || 0) > (Number(matched[g.key].ts) || 0)) {
        matched[g.key] = mark;
        via[g.key] = how;
      }
    }
    /* Pass 1 — records that carry a student ID. */
    Object.keys(doneById).forEach(function (id) {
      var mark = doneById[id] || {};
      var gId = byPid[id] || null;
      var gEm = emailGroup(emailKey(mark.email));
      if (gId) stamp(gId, mark, 'id');
      else if (gEm) stamp(gEm, mark, 'email');
      else { unmatched.push(id); return; }
      idHit[id] = 1;
      /* One record answering to TWO different roster students — its ID to
         one, its e-mail to another — is duplicate-registration evidence,
         whichever of the two got the mark. */
      if (gId && gEm && gId.key !== gEm.key) {
        var sig = [gId.key, gEm.key].sort().join('|');
        if (!linkSeen[sig]) { linkSeen[sig] = 1; links.push([gId.key, gEm.key]); }
      }
    });
    /* Pass 2 — e-mail-keyed records. Skipped only when pass 1 actually
       MATCHED the record's ID (a bare doneById-existence test would also
       swallow the e-mail of an UNMATCHED id: with several records under one
       typo'd ID, doneById keeps only the newest record's e-mail, and an
       older record's address — this entry — may be the one the roster
       knows). The rest (no student ID at all, or an unmatched ID) match by
       address. */
    Object.keys(doneByEmail).forEach(function (em) {
      var mark = doneByEmail[em] || {};
      if (mark.id && idHit[mark.id]) return;   // that record's student is already matched
      var g = emailGroup(emailKey(em));
      if (g) {
        stamp(g, mark, 'email');
        if (mark.id) idHit[mark.id] = 1;
      }
    });
    /* An ID rescued by ANY of its records' addresses is no stranger — drop
       it from the unmatched report. */
    unmatched = unmatched.filter(function (id) { return !idHit[id]; });
    return { matched: matched, via: via, unmatched: unmatched, links: links };
  }

  /* ------------------------------------------------------------------ */
  /* Duplicate registrations                                             */
  /* ------------------------------------------------------------------ */

  /* What one entry of a duplicate cluster DID, judged from this pass:
       'fast'       completed this simulation in under fastMs — the rushed
                    play-then-re-register pattern;
       'played'     completed this simulation properly (or unknown duration),
                    or carries a ✓ for some simulation on the roster;
       'registered' registered only — no play on record anywhere. */
  function roleOf(g, mark, isDone, fastMs) {
    var dur = mark && Number(mark.dur) > 0 ? Number(mark.dur) : 0;
    if (mark && dur && dur < fastMs) return 'fast';
    if (mark) return 'played';
    var any = false;
    Object.keys((g && g.completed) || {}).forEach(function (k) {
      if (isDone(g.completed[k])) any = true;
    });
    return any ? 'played' : 'registered';
  }

  /* The name split for the differing-names caution: word-ish runs of latin
     letters (with diacritics) or CJK, 2+ chars, folded to lower case. */
  function nameTokens(g) {
    var n = String(((g && g.rows && g.rows[0]) || {}).name || '').toLowerCase();
    var m = n.match(/[a-zÀ-ɏ]{2,}|[一-鿿]{2,}/g);
    return m || [];
  }

  function allButNewest(entries) {
    if (entries.length < 2) return [];
    var newest = entries[0];
    entries.forEach(function (e) { if (groupStamp(e.group) > groupStamp(newest.group)) newest = e; });
    return entries.filter(function (e) { return e !== newest; });
  }

  /* Which entries of ONE duplicate cluster to SUGGEST deleting. Never all of
     them, and only where the evidence points one way (the owner's two
     patterns); anything ambiguous gets NO suggestion — the admin decides:
       · a profile that played properly is always kept;
       · when a proper play exists, the profiles that only registered and the
         profiles whose play was super fast are the suggested removals;
       · when the ONLY play on file is a super-fast one and another profile
         has merely registered: when the record's own student ID pins the
         play to one profile (attributed), THAT profile is the suggested
         removal — the re-register-to-play-properly pattern, so the fresh
         registration is kept for the real play. Matched by e-mail alone the
         play cannot be pinned to either profile (the address is shared;
         its placement on one of them is only the join's newest-pick), so
         keep the newest registration — the one the student is using — and
         suggest the older ones;
       · all registered-only: keep the newest (the one the student is
         presumably using), suggest the older ones;
       · several proper plays, or several fast plays with nothing else:
         genuinely ambiguous — no suggestion. */
  function suggestRemovals(entries) {
    var played = entries.filter(function (e) { return e.role === 'played'; });
    var fast = entries.filter(function (e) { return e.role === 'fast'; });
    var reg = entries.filter(function (e) { return e.role === 'registered'; });
    if (played.length) return fast.concat(reg);
    if (fast.length === 1 && reg.length) {
      if (fast[0].attributed) return fast.concat(allButNewest(reg));
      return allButNewest(entries);
    }
    if (!fast.length && reg.length >= 2) return allButNewest(reg);
    return [];
  }

  function fmtDur(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    if (m >= 60) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
    return m ? m + ' min ' + s + ' s' : s + ' s';
  }

  /* findDuplicateClusters(groups, join, opts) — roster students that appear
     to be ONE person registered more than once. Two sources of evidence,
     unioned into clusters:
       · two roster students sharing an e-mail address (the roster already
         collapses same-ID duplicates, so what is left differs in ID);
       · one simulation record identifying two students (join.links).
     opts: { isDone  (SIMP_COMPLETIONS.isDone — tombstone-aware),
             fastMs  (default FAST_PLAY_MS),
             simTitle (for the per-entry evidence text) }
     Returns [ { entries: [ { key, group, role, mark, dur, suggest, why,
                              evidence } ] } … ] — clusters of ≥2 entries,
     each annotated for the pop-up; `suggest` marks the proposed removals. */
  function findDuplicateClusters(groups, join, opts) {
    groups = groups || {}; join = join || {}; opts = opts || {};
    var isDone = opts.isDone || function (e) { return !!(e && !e.revoked); };
    var fastMs = Number(opts.fastMs) > 0 ? Number(opts.fastMs) : FAST_PLAY_MS;
    var simTitle = opts.simTitle || 'this simulation';

    /* Union-find over group keys. */
    var parent = {};
    Object.keys(groups).forEach(function (k) { parent[k] = k; });
    function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) {
      if (!(a in parent) || !(b in parent)) return;
      a = find(a); b = find(b);
      if (a !== b) parent[b] = a;
    }
    var byEmail = {};
    Object.keys(groups).forEach(function (k) {
      groupEmails(groups[k]).forEach(function (em) {
        (byEmail[em] = byEmail[em] || []).push(k);
      });
    });
    Object.keys(byEmail).forEach(function (em) {
      for (var i = 1; i < byEmail[em].length; i++) union(byEmail[em][0], byEmail[em][i]);
    });
    (join.links || []).forEach(function (pair) { union(pair[0], pair[1]); });

    var members = {};
    Object.keys(groups).forEach(function (k) {
      var root = find(k);
      (members[root] = members[root] || []).push(k);
    });

    var matched = join.matched || {};
    var joinVia = join.via || {};
    var clusters = [];
    Object.keys(members).forEach(function (root) {
      var keys = members[root];
      if (keys.length < 2) return;
      var entries = keys.map(function (k) {
        var g = groups[k];
        var mark = matched[k] || null;
        var dur = mark && Number(mark.dur) > 0 ? Number(mark.dur) : 0;
        var role = roleOf(g, mark, isDone, fastMs);
        var evidence =
          role === 'fast' ? 'completed ' + simTitle + ' in only ' + fmtDur(dur) :
          (mark ? 'completed ' + simTitle + (dur ? ' in ' + fmtDur(dur) : '') :
           role === 'played' ? 'has a ✓ on other simulation(s)' :
           'registered only — no play on record');
        return { key: k, group: g, role: role, mark: mark, dur: dur,
                 /* the record's OWN student ID pins the play to this profile;
                    an e-mail-only match cannot (the address is shared) */
                 attributed: !!(mark && joinVia[k] === 'id'),
                 suggest: false, why: '', evidence: evidence };
      });
      var ambFast = entries.some(function (e) { return e.role === 'fast' && !e.attributed; });
      suggestRemovals(entries).forEach(function (e) {
        e.suggest = true;
        e.why = e.role === 'fast'
          ? 'played ' + simTitle + ' super fast (' + fmtDur(e.dur) + ') before the duplicate registration — suggest removing this profile and keeping the other for the proper play'
          : ambFast
            ? 'an older duplicate registration — the ' + simTitle + ' play on record was super fast and cannot be pinned to one of these profiles, so the newest registration (the one the student is using) is kept'
            : e.role === 'registered'
              ? 'registered but never played — the duplicate profile carries the play data'
              : 'an older duplicate registration';
      });
      /* Belt & braces: a suggestion must never cover the whole cluster. */
      if (entries.every(function (e) { return e.suggest; })) {
        var keep = entries[0];
        entries.forEach(function (e) { if (groupStamp(e.group) > groupStamp(keep.group)) keep = e; });
        keep.suggest = false; keep.why = '';
      }
      /* SAFETY: a shared address can cluster two DIFFERENT people (siblings,
         a family mailbox). When two entries carry names with nothing in
         common, drop every pre-tick and say so — the admin reads the names
         and decides from scratch; a wrong suggestion here would propose
         unregistering a real student. Missing names stay neutral. */
      var caution = '';
      for (var a = 0; a < entries.length && !caution; a++) {
        for (var b = a + 1; b < entries.length && !caution; b++) {
          var ta = nameTokens(entries[a].group), tb = nameTokens(entries[b].group);
          if (!ta.length || !tb.length) continue;
          var shared = ta.some(function (t) { return tb.indexOf(t) >= 0; });
          if (!shared) {
            caution = 'the names on these registrations differ — make sure they really are ' +
              'the same person before deleting anything';
            entries.forEach(function (e) { e.suggest = false; e.why = ''; });
          }
        }
      }
      clusters.push({ entries: entries, caution: caution });
    });
    return clusters;
  }

  return {
    FAST_PLAY_MS: FAST_PLAY_MS,
    emailKey: emailKey, groupEmails: groupEmails, groupStamp: groupStamp,
    joinRecords: joinRecords,
    roleOf: roleOf, suggestRemovals: suggestRemovals, fmtDur: fmtDur,
    nameTokens: nameTokens,
    findDuplicateClusters: findDuplicateClusters
  };
})();
