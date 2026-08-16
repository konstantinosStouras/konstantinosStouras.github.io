/* Simulation Platform — completion-verification ADAPTERS.
   ---------------------------------------------------------------------------
   The roster's per-simulation ✓ normally arrives from the student's own
   browser (prefill.js mirrors each play-once marker onto their roster doc).
   That can miss a student: the platform tab was closed when they finished,
   they opened the simulation from a direct URL, or they played in another
   browser. Each simulation's OWN backend is the ground truth, so the admin
   panel offers a "⟲ Verify from <simulation>" button per ACTIVE simulation
   that keeps an IDENTIFIABLE participant record — one carrying the university
   student ID, which is the join key to the platform roster.

   This file holds ONLY the per-simulation reading: given a signed-in Firestore
   handle on that simulation's own project, return WHO completed it, keyed by
   student ID. Everything downstream — the shared admin sign-in, the roster
   join, the safety guards, stamping and revoking — is generic and lives in
   admin.js, so adding a simulation is: a `verify` block in catalog.js + one
   adapter here.

   An adapter is
     fn(ctx) -> Promise<{ records, doneById, doneByEmail?, identityDocs? }>
   where
     ctx.D      the Firestore module (getDocs, collection, query, where, …)
     ctx.fs     Firestore instance for THAT simulation's project
     ctx.uid    uid of the admin account signed into that project
     ctx.sim    the catalog entry
     records    how many participant records were READ (any status). 0 means
                the read came back empty — admin.js refuses to touch the
                roster in that state, because "no records" is indistinguishable
                from a wrong project / a permissions problem, and treating it
                as "nobody completed anything" would revoke the whole class.
     doneById   { <student ID, trimmed + lower-cased> : mark } for the
                participants who COMPLETED it.
     doneByEmail  { <e-mail, trimmed + lower-cased> : mark } — the SAME
                completed participants keyed by whatever real e-mail address
                their record carries (owner 2026-08-16: the roster join is
                student ID AND/OR e-mail, so an ID typed differently in the
                two forms no longer loses the student). Synthetic throwaway
                addresses (@simplatform.stouras.com) are never reported —
                they identify an account the app minted, not a student.
     A mark is  { ts, session, id, email, dur }:
                ts = completion time in epoch ms (0 when unknown), session =
                the session/wave code or null, id/email = the identities the
                record itself carries ('' when absent — SIMP_MATCH uses them
                to cross-join and to spot duplicate registrations), dur = the
                play duration in ms (0 = unknown; feeds the duplicates
                pop-up's "super fast play" suggestion).

     identityDocs  OPTIONAL (Ideation Challenge): a read-only REPORT of the
                participant records still carrying the throwaway login's
                placeholders — { <student ID> : [{ sid, uid, needName,
                needEmail, needPlatName, needPlatEmail, needPlatSource }] } —
                which admin.js uses to write the ROSTER's real name/e-mail
                back onto those records (fill-empty only). Reported for EVERY
                matched student, finished or not: a name is a name.

   Adapters must never write to the simulation's project — this is a read-only
   reconciliation. (The identity backfill is written by admin.js, the one
   place holding both the roster and that project's instructor handle.)
   =========================================================================== */
window.SIMP_VERIFY = (function () {
  'use strict';

  /* Completion times arrive as Firestore Timestamps, epoch ms, or ISO strings
     depending on the simulation — normalise to epoch ms (0 = unknown). */
  function tsMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    var n = Date.parse(v);
    return isNaN(n) ? 0 : n;
  }
  function pid(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  /* The e-mail join key. '' for anything that is not a plausible address —
     and for the synthetic throwaway logins the Ideation Challenge's
     account-free flow mints (student-…@simplatform.stouras.com), which
     identify an ACCOUNT, never a student. KEEP IN SYNC with
     SIMP_MATCH.emailKey in admin/match.js (this file is also loaded
     standalone by its own guard, so it carries its own copy); the
     match-guard checks the two sources agree. */
  function email(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    if (/@simplatform\.stouras\.com$/.test(s)) return '';
    return s;
  }
  /* The e-mail-looking value in a map of form answers — registration forms
     that collect an address do so under a session-defined field id, so the
     VALUES are scanned rather than the ids (mirrors how the platform's
     prefill answers such fields by label). TWO DIFFERENT addresses in one
     form (an emergency contact beside the student's own, say) make the
     identity ambiguous — refuse rather than adopt a third party's address
     and stamp the wrong student. */
  function emailInAnswers(m) {
    var found = '', clash = false;
    Object.keys(m || {}).forEach(function (k) {
      var e = email(m[k]);
      if (!e || e === found) return;
      if (found) clash = true;
      else found = e;
    });
    return clash ? '' : found;
  }
  /* Play duration in ms; 0 = unknown (either stamp missing, or the order
     makes no sense). Feeds the duplicates pop-up's "super fast" judgement. */
  function durMs(start, end) {
    var a = tsMs(start), b = tsMs(end);
    return (a > 0 && b > a) ? (b - a) : 0;
  }
  /* A student may have several records (a retake, two devices) — keep the
     most recent completion, which is what the roster ✓ should date from. */
  function keep(map, id, mark) {
    if (!map[id] || mark.ts > map[id].ts) map[id] = mark;
  }

  return {

    /* Answer Arena — participants/{id} with participantId = student ID and a
       completedSessions map {sessionId: ts}; sessions/{id}.code is the code
       students were given. */
    answerarena: function (c) {
      return Promise.all([
        c.D.getDocs(c.D.collection(c.fs, 'participants')),
        c.D.getDocs(c.D.collection(c.fs, 'sessions'))
      ]).then(function (r) {
        var codeById = {};
        r[1].forEach(function (d) { codeById[d.id] = String(d.data().code || '').toUpperCase(); });
        var done = {}, doneByEmail = {};
        r[0].forEach(function (d) {
          var x = d.data();
          var cs = x.completedSessions || {};
          var sids = Object.keys(cs);
          if (!sids.length && x.status !== 'done') return;      // not completed
          var id = pid(x.participantId);
          /* The account e-mail is null for the anonymous intake flow, but an
             admin-added e-mail question lands in the intake answers — stored
             on the participant doc as `registration` (finishRegister in
             arena-app.js). */
          var em = email(x.email) || emailInAnswers(x.registration || x.answers);
          if (!id && !em) return;                 // nothing identifying at all
          var best = { ts: Number(x.updatedAt) || 0, session: null };
          sids.forEach(function (sid) {
            var ts = Number(cs[sid]) || 0;
            if (ts >= best.ts) best = { ts: ts, session: sid === '_none' ? null : (codeById[sid] || null) };
          });
          best.id = id; best.email = em;
          best.dur = durMs(x.createdAt, best.ts || x.updatedAt);
          if (id) keep(done, id, best);
          if (em) keep(doneByEmail, em, best);
        });
        return { records: r[0].size, doneById: done, doneByEmail: doneByEmail };
      });
    },

    /* Ideation Challenge — participants live UNDER their session
       (sessions/{id}/participants/{uid}); the identity is the platform block
       the silent registration writes (platform.studentId) OR, for a student
       who opened the app directly and registered on its own form (owner
       2026-08: sessions SGP2/SGP3/ATHENS were played from a direct link, so
       no handoff ever wrote a platform block), the student ID they typed
       into that form — read from `demographics` via the session's own
       registrationConfig: the default form's `ucdStudentId` field, or any
       admin-added field whose label says Student/Participant ID (the same
       label rule simplatform.js uses to FILL such a field on a platform
       launch, so the two directions can't drift apart).
       TWO ways to finish, both landing the student on the same Done screen
       (which is what stamps their own ✓): they submit the survey — status
       'done' — or the INSTRUCTOR CLOSES the session while they are playing,
       which ends everyone without touching their status. Counting only the
       first would propose revoking the ✓ of every student in a closed
       session, so a closed session also counts anyone who finished a phase
       (votes submitted, or the individual phase for a session that never
       reached the group round).
       Only sessions this admin account created are read: its rules grant
       participant reads to the session's instructor, so scanning other
       instructors' sessions would only collect permission errors. */
    ideasearchlab: function (c) {
      /* The registration fields that carry the university student ID in a
         given session: the default form's `ucdStudentId`, plus any field the
         admin added whose label names a Student/Participant ID. Falls back to
         the default id when a session has no custom registrationConfig (it
         then RUNS the default form, so that is where the answer lives). */
      function studentIdFieldIds(regConfig) {
        var ids = [];
        /* Array.isArray, not truthiness — one session doc carrying a malformed
           registrationConfig (fields as a map) must not throw and take the
           whole verify pass down with it (getRegistration guards the same way). */
        var fields = (regConfig && Array.isArray(regConfig.fields)) ? regConfig.fields : [];
        fields.forEach(function (f) {
          if (!f || !f.id) return;
          if (f.id === 'ucdStudentId' ||
              /student\s*id|participant\s*id/i.test(String(f.label || ''))) ids.push(f.id);
        });
        if (!ids.length) ids.push('ucdStudentId');
        return ids;
      }
      /* Likewise for the e-mail: the DEFAULT form asks for none (the app's
         identity is a throwaway login), so only a field the session's admin
         LABELLED as an e-mail address can carry one — selected by label, not
         by scanning every answer, so a third party's address typed into some
         other field can never become the student's identity here. */
      function emailFieldIds(regConfig) {
        var ids = [];
        var fields = (regConfig && Array.isArray(regConfig.fields)) ? regConfig.fields : [];
        fields.forEach(function (f) {
          if (!f || !f.id) return;
          if (f.id === 'email' || /e-?mail/i.test(String(f.label || ''))) ids.push(f.id);
        });
        return ids;
      }
      return c.D.getDocs(c.D.query(c.D.collection(c.fs, 'sessions'),
                                   c.D.where('instructorId', '==', c.uid)))
        .then(function (ss) {
          var sessions = [];
          ss.forEach(function (d) {
            var x = d.data();
            sessions.push({
              id: d.id,
              code: String(x.code || '').toUpperCase(),
              closed: x.status === 'done',
              sidFields: studentIdFieldIds(x.registrationConfig),
              emFields: emailFieldIds(x.registrationConfig)
            });
          });
          if (!sessions.length) {
            throw new Error('no Ideation Challenge sessions belong to the account you signed in with — ' +
              'sign in with the instructor account that created the class sessions');
          }
          return Promise.all(sessions.map(function (s) {
            return Promise.all([
              c.D.getDocs(c.D.collection(c.fs, 'sessions', s.id, 'participants')),
              /* Closing a session ends everyone on the same Done screen without
                 setting a status, so those participants have to be judged by
                 what they actually DID — and half that evidence (their ideas)
                 lives outside the participant doc. Read only for such sessions,
                 so an open class costs nothing extra. */
              s.closed ? c.D.getDocs(c.D.collection(c.fs, 'sessions', s.id, 'ideas')) : null
            ]).then(function (r) { return { s: s, ps: r[0], ideas: r[1] }; });
          }));
        }).then(function (rs) {
          var done = {}, doneByEmail = {}, records = 0, identityDocs = {};
          rs.forEach(function (r) {
            var authored = {};
            if (r.ideas) r.ideas.forEach(function (d) {
              var a = d.data().authorId;
              if (a) authored[a] = 1;
            });
            r.ps.forEach(function (d) {
              records++;
              var x = d.data();
              /* The survey is the LAST step of the study, so a stored survey is
                 completion whatever `status` says. It can say otherwise: a
                 group-wide advance (the last member of a group submitting their
                 votes, minutes after a faster member already finished) used to
                 rewrite every member's status, demoting a finished participant
                 from 'done' back to 'survey' — and this reconciliation then
                 offered to REVOKE their ✓ (session SGP1, 2026-08-13). Fixed at
                 the source in the app's functions/phaseGuard.js; read the
                 survey here so already-written records verify correctly too. */
              var finished = x.status === 'done' || !!x.surveyCompletedAt || !!x.surveyAnswers;
              /* A CLOSED session ends everyone on that same Done screen without
                 setting a status, so its participants are judged by whether they
                 demonstrably TOOK PART: an idea of their own, or a vote cast.
                 Deliberately NOT `votesSubmitted`/`individualComplete` on their
                 own — the phase timers auto-submit BOTH with nothing in them
                 (autoFinish submits zero ideas, autoSubmitVotes locks an empty
                 ballot), so a student who opened the page and idled was ticked
                 as complete here while the app's own admin showed no
                 contribution from them. The platform's ✓ and what the Ideation
                 Challenge shows have to mean the same thing. */
              if (!finished && r.s.closed) {
                finished = !!authored[d.id] || ((x.votedFor || []).length > 0);
              }
              /* Platform launch first (the handoff's ID is the roster's own),
                 then the ID the student typed into the session's registration
                 form — a direct-link play records its identity only there. */
              var plat = x.platform || {};
              var id = pid(plat.studentId);
              if (!id) {
                var demo = x.demographics || {};
                for (var i = 0; i < r.s.sidFields.length && !id; i++) {
                  id = pid(demo[r.s.sidFields[i]]);
                }
              }
              /* The e-mail, for the ID-and/or-e-mail join: the handoff's real
                 address first, then the participant doc's own (real once the
                 identity backfill has healed it — email() drops the synthetic
                 @simplatform throwaway), then an address typed into a
                 registration field the session's admin LABELLED e-mail. */
              var em = email(plat.email) || email(x.email);
              if (!em) {
                var dm = x.demographics || {};
                for (var ei = 0; ei < r.s.emFields.length && !em; ei++) {
                  em = email(dm[r.s.emFields[ei]]);
                }
              }
              if (!id && !em) return;           // nothing identifying at all
              /* Report what this record is still missing, so admin.js can fill
                 it from the roster (owner 2026-08-16: a direct-link student's
                 real name/e-mail live on the PLATFORM's roster — they
                 registered there — but no handoff ever carried them into the
                 app, so its records show "Student" + a synthetic address).
                 Every matched student, finished or not. */
              var needName = !String(x.name || '').trim() ||
                             String(x.name).trim().toLowerCase() === 'student';
              var needEmail = !x.email || /@simplatform\.stouras\.com$/i.test(String(x.email));
              var needPlatName = !String(plat.name || '').trim();
              var needPlatEmail = !String(plat.email || '').trim();
              /* The backfill report stays keyed by student ID — admin.js
                 writes it through the roster's ID join. */
              if (id && (needName || needEmail || needPlatName || needPlatEmail)) {
                (identityDocs[id] = identityDocs[id] || []).push({
                  sid: r.s.id, uid: d.id,
                  needName: needName, needEmail: needEmail,
                  needPlatName: needPlatName, needPlatEmail: needPlatEmail,
                  needPlatSource: !plat.source
                });
              }
              if (!finished) return;
              var mark = {
                ts: tsMs(x.surveyCompletedAt) || tsMs(x.votedAt) || tsMs(x.joinedAt) || 0,
                session: r.s.code || null,
                id: id, email: em,
                /* joined → finished = the play duration (0 when either stamp
                   is missing — e.g. the closed-session participation path). */
                dur: durMs(x.joinedAt, x.surveyCompletedAt || x.votedAt)
              };
              if (id) keep(done, id, mark);
              if (em) keep(doneByEmail, em, mark);
            });
          });
          return { records: records, doneById: done, doneByEmail: doneByEmail,
                   identityDocs: identityDocs };
        });
    },

    /* PortfolioFit — participants/{uid} with studentId from its registration
       form, sessionId = the code they joined with, status 'done' once the
       survey is submitted. */
    portfoliofit: function (c) {
      return c.D.getDocs(c.D.collection(c.fs, 'participants')).then(function (ps) {
        var done = {}, doneByEmail = {}, records = 0;
        ps.forEach(function (d) {
          records++;
          var x = d.data();
          if (x.status !== 'done') return;
          var id = pid(x.studentId || (x.registration && x.registration.studentId));
          /* Its default registration form has no e-mail question, but an
             admin-added one lands in the registration answers. */
          var em = email(x.email) || emailInAnswers(x.registration);
          if (!id && !em) return;               // nothing identifying at all
          var mark = {
            ts: tsMs(x.updatedAt) || tsMs(x.createdAt) || 0,
            session: x.sessionId ? String(x.sessionId).toUpperCase() : null,
            id: id, email: em,
            /* doc created at first sign-in, last written at the survey — the
               span of the whole sitting. */
            dur: durMs(x.createdAt, x.updatedAt)
          };
          if (id) keep(done, id, mark);
          if (em) keep(doneByEmail, em, mark);
        });
        return { records: records, doneById: done, doneByEmail: doneByEmail };
      });
    },

    /* Search for Knowledge — no participant documents at all: it logs one
       event per action, and the platform launch carries the student ID as
       PROLIFIC_PID (events.pid). Finishing logs 'session_end', so that single
       equality query IS the completion list (and keeps this off the full,
       very large events collection). A one-document probe separates "the read
       came back empty" from "nobody has finished yet". */
    'search-v2': function (c) {
      return Promise.all([
        c.D.getDocs(c.D.query(c.D.collection(c.fs, 'events'), c.D.where('event', '==', 'session_end'))),
        c.D.getDocs(c.D.query(c.D.collection(c.fs, 'events'), c.D.limit(1)))
      ]).then(function (r) {
        var done = {};
        r[0].forEach(function (d) {
          var x = d.data();
          var id = pid(x.pid);
          if (!id || id === 'anon') return;
          keep(done, id, {
            ts: tsMs(x.t),
            session: x.sessionCode ? String(x.sessionCode).toUpperCase() : null,
            /* The study's log carries no e-mail at all (§11 — the student's
               name and e-mail never reach it) and no per-participant start
               stamp on this row, so the ID is the whole identity here. */
            id: id, email: '', dur: 0
          });
        });
        return { records: r[0].size || r[1].size, doneById: done, doneByEmail: {} };
      });
    }

  };
})();
