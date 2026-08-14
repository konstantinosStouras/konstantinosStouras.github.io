/* ==========================================================================
   Simulation Platform — reading the per-simulation completion map.

   WHY THIS EXISTS. A student is ONE person with ONE university student ID, but
   they can back SEVERAL roster documents: every registration mints a fresh
   anonymous uid, so logging out and registering again, or logging in by e-mail
   on a second device, creates another `simPlatformStudents/{uid}` doc. The
   roster collapses those duplicates into one row — keeping the most recent doc
   — and that is where the ✓ / — cells went wrong:

     · WRITES fan out. The admin's stamp/revoke and the bulk approvals write
       EVERY uid behind the row.
     · The STUDENT's own push does not. `syncCompleted()` mirrors the
       play-once markers onto whichever doc they are signed into — and logging
       out CLEARS the local markers, so the next registration's doc starts
       empty.

   So the newest doc — the one the row is built from — can be missing a ✓ that
   a collapsed duplicate carries. The roster then shows "—" for a student the
   simulation's own admin shows as done, and "⟲ Verify from …" made it worse:
   it asked "does ANY doc of this student have the ✓?", found the one on the
   duplicate, counted the student as `already` matched and wrote nothing — so
   the reconciliation reported success while the cell kept reading "—".

   The fix is one shared reading of the truth, used by BOTH halves: group a
   student's docs newest-first and merge their completion maps per simulation
   key, the newest STATEMENT about a simulation winning. Newest-wins (rather
   than "any ✓ counts") is what keeps a revocation authoritative: a tombstone
   on the current doc still hides an older mark, exactly as the instructor
   intended when they removed the ✓ so the student could retake it.

   Pure, no DOM, no network: `simulation/tools/completion-guard.mjs` runs it
   offline.
   ========================================================================== */
window.SIMP_COMPLETIONS = (function () {
  'use strict';

  /* The join key between a simulation's own records and this roster, folded
     the same way everywhere (trimmed + lower-cased). '' when the student has
     no ID on record — the caller then falls back to the uid, so an ID-less
     registration is still its own row rather than fusing with every other. */
  function studentKey(r) {
    return String((r && r.studentId) || '').trim().toLowerCase();
  }
  function rowKey(r) {
    return studentKey(r) || ('uid:' + ((r && r.uid) || ''));
  }
  /* Newest first. createdAt/updatedAt are ISO strings, so a plain string
     compare is the chronological one. */
  function docNewer(a, b) {
    return String((b && (b.updatedAt || b.createdAt)) || '')
      .localeCompare(String((a && (a.updatedAt || a.createdAt)) || ''));
  }
  /* A revoked completion is a TOMBSTONE inside the same map ({revoked:1,rts}):
     the student no longer counts as having done it, and may retake it. */
  function isTombstone(e) { return !!(e && e.revoked); }
  function isDone(e) { return !!(e && !e.revoked); }

  /* Merge one student's docs, which MUST be ordered newest-first. The first
     doc that mentions a simulation decides it — a mark or a tombstone alike;
     keys nobody newer mentions fall back to whichever duplicate carries them.
     Never mutates the inputs. */
  function mergeCompleted(rowsNewestFirst) {
    var out = {};
    (rowsNewestFirst || []).forEach(function (r) {
      var c = (r && r.completed) || {};
      Object.keys(c).forEach(function (k) { if (!(k in out)) out[k] = c[k]; });
    });
    return out;
  }

  /* Group roster docs by student. Returns { <rowKey>: group } where a group is
       { key, pid, rows, uids, refs, completed }
     rows      the student's docs, NEWEST FIRST (rows[0] is the displayed one)
     uids      every uid behind the row — what a write must fan out to
     refs      [{uid, email}] — the shape stamp/revoke take (the e-mail
               recovery replica is keyed by address, so it needs both)
     completed the merged map: what the ✓ / — cell must show. */
  function groupByStudent(rows) {
    var g = {};
    (rows || []).slice().sort(docNewer).forEach(function (r) {
      var k = rowKey(r);
      if (!g[k]) g[k] = { key: k, pid: studentKey(r), rows: [], uids: [], refs: [] };
      g[k].rows.push(r);
      if (r && r.uid) {
        g[k].uids.push(r.uid);
        g[k].refs.push({ uid: r.uid, email: (r && r.email) || null });
      }
    });
    Object.keys(g).forEach(function (k) { g[k].completed = mergeCompleted(g[k].rows); });
    return g;
  }

  return {
    studentKey: studentKey, rowKey: rowKey, docNewer: docNewer,
    isTombstone: isTombstone, isDone: isDone,
    mergeCompleted: mergeCompleted, groupByStudent: groupByStudent
  };
})();
