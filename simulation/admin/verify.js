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

   An adapter is  fn(ctx) -> Promise<{ records, doneById, identityDocs? }>  where
     ctx.D      the Firestore module (getDocs, collection, query, where, …)
     ctx.fs     Firestore instance for THAT simulation's project
     ctx.uid    uid of the admin account signed into that project
     ctx.sim    the catalog entry
     records    how many participant records were READ (any status). 0 means
                the read came back empty — admin.js refuses to touch the
                roster in that state, because "no records" is indistinguishable
                from a wrong project / a permissions problem, and treating it
                as "nobody completed anything" would revoke the whole class.
     doneById   { <student ID, trimmed + lower-cased> : {ts, session} } for the
                participants who COMPLETED it. ts = completion time in epoch
                ms (0 when unknown), session = the session/wave code or null.

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
        var done = {};
        r[0].forEach(function (d) {
          var x = d.data();
          var cs = x.completedSessions || {};
          var sids = Object.keys(cs);
          if (!sids.length && x.status !== 'done') return;      // not completed
          var id = pid(x.participantId);
          if (!id) return;
          var best = { ts: Number(x.updatedAt) || 0, session: null };
          sids.forEach(function (sid) {
            var ts = Number(cs[sid]) || 0;
            if (ts >= best.ts) best = { ts: ts, session: sid === '_none' ? null : (codeById[sid] || null) };
          });
          keep(done, id, best);
        });
        return { records: r[0].size, doneById: done };
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
              sidFields: studentIdFieldIds(x.registrationConfig)
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
          var done = {}, records = 0, identityDocs = {};
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
              if (!id) return;                       // no student ID on record at all
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
              if (needName || needEmail || needPlatName || needPlatEmail) {
                (identityDocs[id] = identityDocs[id] || []).push({
                  sid: r.s.id, uid: d.id,
                  needName: needName, needEmail: needEmail,
                  needPlatName: needPlatName, needPlatEmail: needPlatEmail,
                  needPlatSource: !plat.source
                });
              }
              if (!finished) return;
              keep(done, id, {
                ts: tsMs(x.surveyCompletedAt) || tsMs(x.votedAt) || tsMs(x.joinedAt) || 0,
                session: r.s.code || null
              });
            });
          });
          return { records: records, doneById: done, identityDocs: identityDocs };
        });
    },

    /* PortfolioFit — participants/{uid} with studentId from its registration
       form, sessionId = the code they joined with, status 'done' once the
       survey is submitted. */
    portfoliofit: function (c) {
      return c.D.getDocs(c.D.collection(c.fs, 'participants')).then(function (ps) {
        var done = {}, records = 0;
        ps.forEach(function (d) {
          records++;
          var x = d.data();
          if (x.status !== 'done') return;
          var id = pid(x.studentId || (x.registration && x.registration.studentId));
          if (!id) return;
          keep(done, id, {
            ts: tsMs(x.updatedAt) || tsMs(x.createdAt) || 0,
            session: x.sessionId ? String(x.sessionId).toUpperCase() : null
          });
        });
        return { records: records, doneById: done };
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
            session: x.sessionCode ? String(x.sessionCode).toUpperCase() : null
          });
        });
        return { records: r[0].size || r[1].size, doneById: done };
      });
    }

  };
})();
