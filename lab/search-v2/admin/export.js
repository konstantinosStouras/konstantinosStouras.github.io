/* ==========================================================================
   search-v2  ·  admin/export.js
   The export script of design brief §19, and the ONLY place the derived fields
   of §16.8 are computed.

   Nothing is derived in the participant's browser. This module reconstructs
   every derived quantity from the raw event log plus the frozen mapping pool and
   round specs, so a formula that turns out to be wrong costs one rerun of this
   file rather than the data.

   Produces, from `events` + a run:
     · decisions — one row per query, reveal or stop  (§19 decisions.csv)
     · rounds    — one row per round                  (§19 rounds.csv)
     · participants — one row per participant         (§19 participants.csv)
     · raw       — the event log, unchanged

   Browser: window.SVExport.  Node: require('./export.js') — used by
   tools/selftest.js, which is how the derivations are tested offline.
   ========================================================================== */
(function (root, factory) {
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var M = factory(
    isNode ? require('../config.js') : root.CONFIG,
    isNode ? require('../pool.js') : root.SVPool,
    isNode ? require('../specs.js') : root.SVSpecs,
    isNode ? require('../ai.js') : root.SVAi,
    isNode ? require('../content.js') : root.SVContent
  );
  if (isNode) module.exports = M;
  if (root) root.SVExport = M;
})(typeof window !== 'undefined' ? window : this, function (CFG, Pool, Specs, Ai, Content) {
  'use strict';

  function decodePairs(str) {
    if (!str) return [];
    return String(str).split('|').filter(Boolean).map(function (s) {
      var kv = s.split(':');
      return { pos: +kv[0], val: +kv[1] };
    });
  }
  function num(v) { return (v == null || v === '' || !isFinite(+v)) ? null : +v; }
  function median(a) {
    var x = a.filter(function (v) { return v != null && isFinite(v); }).sort(function (p, q) { return p - q; });
    if (!x.length) return null;
    var m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  }

  // The frozen artifacts for a run: the pool and the specs, regenerated from the
  // run's own seeds (the pool is never committed — §18) and cross-checked against
  // whatever the run document stored.
  function artifactsFor(run) {
    var params = Specs.withDefaults(run && run.params);
    if (run && run.ops) Object.keys(run.ops).forEach(function (k) { params.ops[k] = run.ops[k]; });
    var pool = Pool.buildPool(params.env, params.env.generatorSeed);
    var specs = null;
    if (run && run.specsJson) { try { specs = JSON.parse(run.specsJson); } catch (e) { specs = null; } }
    if (!specs || !specs.length) specs = Specs.buildSpecs(pool, params, (run && run.specSeed) || null);
    var byId = {};
    specs.forEach(function (s) { byId[s.spec_id] = s; });
    return { params: params, pool: pool, specs: specs, specById: byId };
  }

  // ---- group the raw log by participant, then by round --------------------
  function group(events) {
    var byP = {};
    events.forEach(function (e) {
      var code = e.participant_code || e.session || 'anon';
      if (!byP[code]) byP[code] = { code: code, events: [], telemetry: [] };
      byP[code].events.push(e);
      if (e.event === 'telemetry' && e.info) {
        try { byP[code].telemetry = byP[code].telemetry.concat(JSON.parse(e.info) || []); } catch (x) {}
      }
    });
    Object.keys(byP).forEach(function (k) {
      byP[k].events.sort(function (a, b) { return (a.t || 0) - (b.t || 0) || (a.seq || 0) - (b.seq || 0); });
      byP[k].telemetry.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    });
    return byP;
  }

  // ======================================================================
  //  DECISION ROWS (§19 decisions.csv)
  // ======================================================================
  function buildDecisions(events, art) {
    var out = [];
    var byP = group(events);

    Object.keys(byP).forEach(function (code) {
      var P = byP[code];
      var seqLetter = null, runId = null, pid = null;
      var perRound = {};

      P.events.forEach(function (e) {
        if (e.sequence) seqLetter = e.sequence;
        if (e.run_id) runId = e.run_id;
        if (e.pid) pid = e.pid;
        if (e.event !== 'decision') return;
        var ri = e.round_index;
        if (!perRound[ri]) perRound[ri] = [];
        perRound[ri].push(e);
      });

      Object.keys(perRound).forEach(function (ri) {
        var rows = mergeServerRows(perRound[ri]);
        var spec = art.specById[rows[0].spec_id];
        var mapping = spec ? art.pool[spec.mapping_index] : null;
        if (!mapping) return;
        var lastRevealPos = null, lastRevealVal = null;

        rows.forEach(function (e, i) {
          var known = decodePairs(e.participant_known_before);
          // The AI's anchor set is RECONSTRUCTED, never trusted from the row.
          // A stop row carries no anchors — no writer supplies them, and in
          // server mode the browser could not know them — so trusting the field
          // left the nomination, the decision this study is about, with no AI
          // geometry at all, and handed eiSurface an empty set, which then
          // reported max_ei_available 0, ei_regret 0 and matched_benchmark TRUE
          // for anyone who stopped at position 1. Everything needed is here:
          // the round's private anchors, its pre-opened positions and what the
          // participant had revealed by this decision.
          var aiAnchors = Ai.anchorSet(
            spec.ai_anchors, spec.pre_opened,
            known.map(function (k) { return k.pos; }), mapping
          );
          var queried = decodePairs(e.participant_queried_before);
          var pos = num(e.position);

          var row = {
            run_id: runId, participant_code: code, pid: pid, sequence: seqLetter,
            block: e.block, condition: e.condition, scored: e.scored,
            spec_id: e.spec_id, seed_shape: e.seed_shape, ai_density: e.ai_density,
            ai_k: spec.ai_k, round_index: num(ri), decision_index: num(e.decision_index),
            is_first_decision: num(e.decision_index) === 0,
            action: e.action, position: pos, value: num(e.value),
            // Assigned once per participant and stamped on every row by the
            // logger's base fields, so it is here for the analysis to control
            // with rather than being re-derived.
            button_order: e.button_order || null,
            already_queried: e.already_queried,
            best_before: num(e.best_true_known_before),
            best_estimate_before: num(e.best_estimate_before),
            n_reveals_before: num(e.n_reveals_before),
            n_queries_before: num(e.queries_so_far),
            ms_since_round_start: num(e.ms_since_round_start),
            ms_since_last_action: num(e.ms_since_last_action),
            ms_since_last_slider_move: num(e.ms_since_last_slider_move),
            slider_moves_since_last_action: num(e.slider_moves_since_last_action),
            cap_hit: e.cap_hit || null,
            t: e.t, iso: e.iso
          };

          // Every §16.8 field, computed the same way in BOTH arms: the AI curve is
          // a function of the anchors alone, so it is well defined whether or not
          // it was drawn. That is what lets us ask whether AI-off participants
          // behaved as if following a line they never saw.
          if (pos != null) {
            var d = Ai.derive({
              params: art.params, position: pos, mapping: mapping,
              aiAnchors: aiAnchors, known: known,
              revealed: known.map(function (k) { return k.pos; }),
              privateAnchors: spec.ai_anchors,
              bestTrueKnown: num(e.best_true_known_before) == null ? 0 : num(e.best_true_known_before)
            });
            Object.keys(d).forEach(function (k) { row[k] = d[k]; });
            row.true_value_at_choice = mapping[pos - 1];
          }

          // Step-size replication (§16.8): consecutive REVEALS only, and only in
          // open rounds is the published comparison valid (§5, secondary 10).
          if (e.action === 'reveal') {
            row.step_size = (lastRevealPos == null) ? null : Math.abs(pos - lastRevealPos);
            row.last_prize = lastRevealVal;
            lastRevealPos = pos; lastRevealVal = num(e.value);
          } else {
            row.step_size = null; row.last_prize = null;
          }
          row.n_queries_in_round = rows.filter(function (x) { return x.action === 'query'; }).length;
          out.push(row);
        });
      });
    });

    out.sort(function (a, b) {
      return String(a.participant_code).localeCompare(String(b.participant_code)) ||
        (a.round_index - b.round_index) || (a.decision_index - b.decision_index);
    });
    return out;
  }

  // `info` is one JSON string, so merging field by field would keep whichever
  // side's blob won and silently drop the other's keys — the browser's
  // slider_moves, in practice, since the server's row has no clock.
  function mergeInfo(a, b) {
    if (!a) return b; if (!b) return a;
    var A = {}, B = {};
    try { A = JSON.parse(a) || {}; } catch (e) {}
    try { B = JSON.parse(b) || {}; } catch (e) {}
    Object.keys(B).forEach(function (k) { if (A[k] == null || A[k] === '') A[k] = B[k]; });
    try { return JSON.stringify(A); } catch (e) { return a; }
  }
  function mergeInto(into, e) {
    if (!into) return Object.assign({}, e);
    var prefer = (e.server === true);
    var info = mergeInfo(into.info, e.info);
    Object.keys(e).forEach(function (f) {
      if (e[f] == null) return;
      if (into[f] == null || prefer) into[f] = e[f];
    });
    if (info != null) into.info = info;
    return into;
  }

  // ======================================================================
  //  SERVER + CLIENT ROWS ARE ONE ROW
  // ======================================================================
  // In server mode an action is written TWICE on purpose: the Cloud Function
  // writes the authoritative values (it is the only side that has the mapping),
  // and the browser writes the timing and the scanning (the only side that has
  // a clock in front of the participant). Both carry the same `event_id`.
  //
  // Nothing downstream implemented the join, so the Decisions sheet had two rows
  // per action — one with null timings, one with null anchors — and every count
  // of actions was doubled. They are merged here, server fields winning where
  // both are present, so the sheet has one row per action in BOTH modes.
  function mergeServerRows(list) {
    var byId = {}, out = [], anyServer = false;
    list.forEach(function (e) { if (e.server === true) anyServer = true; });
    if (!anyServer) return list;
    list.forEach(function (e) {
      var k = e.event_id || (e.event + ':' + e.round_index + ':' + e.seq);
      if (!byId[k]) { byId[k] = Object.assign({}, e); out.push(k); return; }
      // The server row is authoritative for values; the client row supplies
      // whatever the server never had. Neither may overwrite a field with null.
      mergeInto(byId[k], e);
    });
    return out.map(function (k) { return byId[k]; });
  }

  // ======================================================================
  //  ROUND ROWS (§19 rounds.csv)
  // ======================================================================
  function buildRounds(events, art) {
    var out = [], byP = group(events);

    Object.keys(byP).forEach(function (code) {
      var P = byP[code], seqLetter = null, runId = null, pid = null;
      var starts = {}, ends = {}, decisions = {};

      P.events.forEach(function (e) {
        if (e.sequence) seqLetter = e.sequence;
        if (e.run_id) runId = e.run_id;
        if (e.pid) pid = e.pid;
        // Same two-writer join as the decisions: merge rather than let whichever
        // row arrived last win, or a server-mode round loses its client timings.
        if (e.event === 'round_start') starts[e.round_index] = mergeInto(starts[e.round_index], e);
        else if (e.event === 'round_end') ends[e.round_index] = mergeInto(ends[e.round_index], e);
        else if (e.event === 'decision') {
          if (!decisions[e.round_index]) decisions[e.round_index] = [];
          decisions[e.round_index].push(e);
        }
      });

      Object.keys(ends).forEach(function (ri) {
        var end = ends[ri], start = starts[ri], decs = mergeServerRows(decisions[ri] || []);
        var spec = art.specById[end.spec_id];
        var mapping = spec ? art.pool[spec.mapping_index] : null;
        if (!mapping) return;
        var params = art.params;

        var info = {};
        try { info = JSON.parse(end.info || '{}'); } catch (e) {}
        var reveals = decodePairs(info.reveals);
        var queries = decodePairs(info.queries);
        var preOpened = spec.pre_opened.map(function (p) { return { pos: p, val: mapping[p - 1] }; });

        // The walk reflects at the ceiling, so roughly half of all mappings have
        // their maximum at MORE THAN ONE position. Measuring "distance to the
        // argmax" against an arbitrary index (the first one) would import a
        // leftward bias that is an artifact of the tie-break, not a property of
        // the walk — so the distance below is to the NEAREST maximising position,
        // and argmax_count ships beside it so a plateau is visible in the data.
        var gmax = Pool.maxOf(mapping), argmax = Pool.argmaxOf(mapping);
        var argmaxAll = [];
        for (var mi = 0; mi < mapping.length; mi++) if (mapping[mi] === gmax) argmaxAll.push(mi + 1);
        var knownFinal = preOpened.concat(reveals);
        var bestFound = knownFinal.reduce(function (m, x) { return (m == null || x.val > m) ? x.val : m; }, null);
        var bestPos = null;
        knownFinal.forEach(function (x) { if (bestFound != null && x.val === bestFound && bestPos == null) bestPos = x.pos; });

        var nomPos = num(end.nominated_position), nomVal = num(end.nominated_true_value);
        // FIRST answer wins. Once a position is revealed it joins the AI's anchor
        // set, so a re-query there returns the truth — keeping the last answer
        // made every verify-then-recheck look like a wasted verification and
        // zeroed the very error the participant had caught.
        var queriedPos = {};
        queries.forEach(function (q) { if (queriedPos[q.pos] == null) queriedPos[q.pos] = q.val; });
        var revealedPos = {}; reveals.forEach(function (r) { revealedPos[r.pos] = r.val; });

        // Verification: reveals of positions that had been queried EARLIER in the
        // round, divided by the number of queries (§16.8).
        var verified = 0, wasted = 0;
        decs.forEach(function (d) {
          if (d.action !== 'reveal') return;
          if (!d.already_queried) return;
          verified++;
          var q = queriedPos[num(d.position)];
          if (q != null && Math.abs(q - mapping[num(d.position) - 1]) <= 5) wasted++;
        });

        // Frontier share: reveals outside the participant's own known range AT
        // THE TIME of the reveal, which is what the state snapshot records.
        var frontier = 0, revealCount = 0;
        decs.forEach(function (d) {
          if (d.action !== 'reveal') return;
          revealCount++;
          var known = decodePairs(d.participant_known_before);
          var p = num(d.position);
          // Knowing NOTHING yet means the whole line is unexplored territory, so
          // this reveal is a frontier move. It used to count in the denominator
          // and never in the numerator, which biased the primary outcome down by
          // 1/n in exactly the rounds it is measured in — the open ones, which
          // by construction start with nothing known.
          if (!known.length) { frontier++; return; }
          if (p < known[0].pos || p > known[known.length - 1].pos) frontier++;
        });

        // Unexplored tails at the moment of stopping (§16.8).
        var touched = knownFinal.map(function (x) { return x.pos; }).concat(queries.map(function (q) { return q.pos; }));
        var lo = touched.length ? Math.min.apply(null, touched) : null;
        var hi = touched.length ? Math.max.apply(null, touched) : null;
        var maxLeft = null, maxRight = null;
        if (lo != null && lo > 1) maxLeft = Pool.maxOf(mapping.slice(0, lo - 1));
        if (hi != null && hi < mapping.length) maxRight = Pool.maxOf(mapping.slice(hi));

        var nomAiErr = (nomPos != null && queriedPos[nomPos] != null) ? (queriedPos[nomPos] - nomVal) : null;
        var nomType = end.nomination_type ||
          (revealedPos[nomPos] != null || spec.pre_opened.indexOf(nomPos) >= 0 ? 'verified'
            : (queriedPos[nomPos] != null ? 'queried_only' : 'untouched'));

        var firstDec = decs.length ? decs[0] : null;
        var teleRound = P.telemetry.filter(function (r) { return r.round_index === num(ri); });
        var hb = teleRound.filter(function (r) { return r.kind === 'heartbeat'; }).length;

        out.push({
          run_id: runId, participant_code: code, pid: pid, sequence: seqLetter,
          block: end.block, condition: end.condition, scored: end.scored,
          spec_id: end.spec_id, seed_shape: end.seed_shape, ai_density: end.ai_density,
          ai_k: spec.ai_k, mapping_index: spec.mapping_index,
          pre_opened: spec.pre_opened.join(' '),
          ai_anchors: spec.ai_anchors.join(' '),
          round_index: num(ri),
          button_order: (end && end.button_order) || (start && start.button_order) || null,
          started_at: start ? start.iso : null, ended_at: end.iso,
          duration_ms: num(end.duration_ms),
          instruction_reopens: num(end.instruction_reopens),
          blur_events: num(end.blur_events), blur_total_ms: num(end.blur_total_ms),
          interrupted: !!end.interrupted,

          n_queries: num(end.n_queries), n_reveals: num(end.n_reveals),
          total_cost: num(end.total_cost), final_score: num(end.final_score),
          raw_score: num(end.raw_score),
          stopped_immediately: !!end.stopped_immediately,
          cap_hit: end.cap_hit || null,

          // The score is COPIED from the log (it is what the participant was
          // actually told), so it is also recomputed here from the mapping and
          // the counts, and any disagreement is flagged rather than hidden. That
          // is the check that would have caught `raw_score` being silently
          // dropped by the logger's field whitelist for every real session.
          final_score_check: (nomPos != null && nomVal != null)
            ? nomVal - (num(end.n_queries) || 0) * params.costs.queryCost
                     - (num(end.n_reveals) || 0) * params.costs.revealCost
            : null,
          score_mismatch: (nomPos != null && nomVal != null && num(end.final_score) != null)
            ? (num(end.final_score) !== nomVal - (num(end.n_queries) || 0) * params.costs.queryCost
                                                - (num(end.n_reveals) || 0) * params.costs.revealCost)
            : null,
          // pct_of_max_attainable measures what they DISCOVERED; this measures
          // what they WALKED AWAY WITH. The two differ whenever a participant
          // finds the best prize and then stops somewhere else.
          pct_of_max_nominated: (nomVal != null && gmax) ? nomVal / gmax : null,
          global_max: gmax, argmax_position: argmax, argmax_count: argmaxAll.length,
          best_found: bestFound,
          pct_of_max_attainable: (bestFound != null && gmax) ? bestFound / gmax : null,
          dist_best_to_argmax: (nomPos != null) ? argmaxAll.reduce(function (m, x) {
            var d = Math.abs(nomPos - x); return (m == null || d < m) ? d : m;
          }, null) : null,
          // Compared by POSITION, not by value: two positions can hold the same
          // prize, and comparing values made a round claim its best came from a
          // reveal AND from a pre-opened position at once.
          final_best_is_last_reveal: reveals.length
            ? (bestPos != null && reveals[reveals.length - 1].pos === bestPos) : null,
          final_best_was_pre_opened: preOpened.length
            ? (bestPos != null && preOpened.some(function (x) { return x.pos === bestPos; })) : false,
          ms_to_first_action: firstDec ? num(firstDec.ms_since_round_start) : null,
          active_ms: hb * CFG.HEARTBEAT_MS,
          verification_rate: queries.length ? verified / queries.length : null,
          n_verifications: verified,
          nominated_position: nomPos, nominated_true_value: nomVal,
          nomination_type: nomType,
          nomination_ai_error: nomAiErr,
          wasted_verifications: wasted,
          redundant_queries: Math.max(0, (num(end.n_queries) || 0) - 2 * spec.ai_k),
          // "Nominated blind" = queried but never revealed, and the AI overstated
          // the truth there by more than 10 (§16.8).
          misplaced_trust: (nomType === 'queried_only' && nomAiErr != null && nomAiErr > 10),
          missed_frontier: (function () {
            var best = Math.max(maxLeft == null ? -Infinity : maxLeft, maxRight == null ? -Infinity : maxRight);
            return isFinite(best) && nomVal != null && (best - nomVal) > 10;
          })(),
          max_in_left_tail: maxLeft, max_in_right_tail: maxRight,
          frontier_share: revealCount ? frontier / revealCount : null,
          slider_moves: num(info.slider_moves)
        });
      });
    });

    out.sort(function (a, b) {
      return String(a.participant_code).localeCompare(String(b.participant_code)) || (a.round_index - b.round_index);
    });
    return out;
  }

  // ======================================================================
  //  PARTICIPANT ROWS (§19 participants.csv)
  // ======================================================================
  // Band midpoints for the calibration items of §16.7 (items 4 and 5).
  var ERROR_BAND_MID = {
    'Within 5 points': 2.5,
    '5 to 15 points': 10,
    '15 to 30 points': 22.5,
    'More than 30 points': 40,
    'It varied too much to say': null
  };

  function buildParticipants(events, art, roundRows, decisionRows) {
    var byP = group(events), out = [];
    var roundsBy = {}, decisionsBy = {};
    roundRows.forEach(function (r) { (roundsBy[r.participant_code] = roundsBy[r.participant_code] || []).push(r); });
    decisionRows.forEach(function (d) { (decisionsBy[d.participant_code] = decisionsBy[d.participant_code] || []).push(d); });

    Object.keys(byP).forEach(function (code) {
      var P = byP[code];
      var start = P.events[0], end = P.events[P.events.length - 1];
      var sessionEnd = null, sessionStart = null, survey = {}, quiz = {}, reg = {};
      // Every return to the study is one `resume` row carrying the gap since the
      // participant was last seen. The counts and totals are DERIVED here, from
      // those raw gaps — nothing in the client adds them up.
      var gaps = [];

      P.events.forEach(function (e) {
        if (e.event === 'session_end') sessionEnd = e;
        if (e.event === 'session_start') sessionStart = e;
        if (e.event === 'resume') { var g = num(e.duration_ms); if (g != null) gaps.push(g); }
        if (e.event === 'survey' && e.question_id) survey[e.question_id] = e.answer;
        else if (e.event === 'registration' && e.question_id) reg[e.question_id] = e.answer;
        if (e.event === 'comprehension' && e.question_id) {
          var q = quiz[e.question_id] || { attempts: 0, first: null, ms: null };
          q.attempts = Math.max(q.attempts, num(e.attempts) || 0);
          if (q.first === null) q.first = (e.first_answer_correct === true || e.first_answer_correct === 'true');
          if (q.ms === null) q.ms = num(e.ms_to_first_answer);
          q.correct = (e.correct === true || e.correct === 'true');
          quiz[e.question_id] = q;
        }
      });

      var rec = {};
      if (sessionEnd && sessionEnd.info) { try { rec = JSON.parse(sessionEnd.info) || {}; } catch (e) {} }
      var breakMin = (CFG && CFG.BREAK_MIN_MS) || 300000;
      var breaks = gaps.filter(function (g) { return g >= breakMin; });

      var myRounds = roundsBy[code] || [];
      var myDecisions = decisionsBy[code] || [];
      var scored = myRounds.filter(function (r) { return r.scored; });
      var aiRounds = scored.filter(function (r) { return r.condition === 'AI_ON'; });
      var offRounds = scored.filter(function (r) { return r.condition === 'AI_OFF'; });

      // Actual AI accuracy AS EXPERIENCED: only the answers this participant paid
      // for. The belief items are about those, not about the whole curve.
      var errs = [], exact = 0, nq = 0;
      myDecisions.forEach(function (d) {
        if (d.action !== 'query' || d.value == null || d.true_value_at_choice == null) return;
        nq++;
        var err = Math.abs(d.value - d.true_value_at_choice);
        errs.push(err);
        if (err === 0) exact++;
      });
      var meanAbsErr = errs.length ? errs.reduce(function (a, b) { return a + b; }, 0) / errs.length : null;
      var hitRate10 = nq ? (10 * exact / nq) : null;

      var statedErr = ERROR_BAND_MID[survey.s04] != null ? ERROR_BAND_MID[survey.s04] : null;
      var statedHits = num(survey.s05);
      var aiMean = aiRounds.length ? aiRounds.reduce(function (a, r) { return a + (r.final_score || 0); }, 0) / aiRounds.length : null;
      var offMean = offRounds.length ? offRounds.reduce(function (a, r) { return a + (r.final_score || 0); }, 0) / offRounds.length : null;
      var actualHalf = (aiMean == null || offMean == null) ? null
        : (Math.abs(aiMean - offMean) < 1e-9 ? 'About the same' : (aiMean > offMean ? 'The half with the AI' : 'The half without the AI'));

      // Exclusion flags are COLUMNS, not filters, so every analysis states its own
      // rule (§19).
      var decMs = myDecisions.map(function (d) { return d.ms_since_last_action; });
      var medDec = median(decMs);
      var revealsNoScan = myDecisions.filter(function (d) {
        return d.action === 'reveal' && (d.slider_moves_since_last_action === 0 || d.slider_moves_since_last_action == null);
      }).length;
      var totalReveals = myDecisions.filter(function (d) { return d.action === 'reveal'; }).length;

      var row = {
        run_id: rec.run_id || (sessionStart && sessionStart.run_id) || null,
        run_code: rec.run_code || (sessionStart && sessionStart.sessionCode) || null,
        participant_code: code,
        pid: rec.pid || (start && start.pid) || null,
        sequence: rec.sequence || (start && start.sequence) || null,
        shuffle_seed: rec.shuffle_seed || null,
        round_order: rec.round_order || null,
        started_at: rec.started_at || (start && start.iso) || null,
        ended_at: rec.ended_at || (end && end.iso) || null,
        timezone_offset: rec.timezone_offset != null ? rec.timezone_offset : null,
        wall_clock_ms: rec.wall_clock_ms != null ? rec.wall_clock_ms : ((end && start) ? (end.t - start.t) : null),
        active_ms: rec.active_ms != null ? rec.active_ms : null,
        idle_ms: rec.idle_ms != null ? rec.idle_ms : null,
        longest_break_ms: rec.longest_break_ms != null ? rec.longest_break_ms : null,
        viewport_width: rec.viewport_width || (start && start.vw) || null,
        viewport_height: rec.viewport_height || (start && start.vh) || null,
        device_pixel_ratio: rec.device_pixel_ratio || (start && start.dpr) || null,
        input_mode: rec.input_mode || null,
        user_agent_parsed: rec.user_agent_parsed || ((start && start.ua_browser) ? start.ua_browser + '/' + start.ua_os : null),
        resumptions: gaps.length ? gaps.length : (rec.resumptions != null ? rec.resumptions : null),
        // A gap counts as a break BETWEEN SITTINGS only when it is at least
        // CONFIG.BREAK_MIN_MS (CFG here); below that it is a reload. `longest_break_ms`
        // above is a different quantity — the longest quiet stretch INSIDE a
        // sitting, measured between consecutive logged events.
        breaks_count: breaks.length,
        break_total_ms: breaks.reduce(function (a, b) { return a + b; }, 0),
        longest_sitting_break_ms: breaks.length ? Math.max.apply(null, breaks) : null,
        sittings: 1 + breaks.length,
        completed: !!(rec.completed || sessionEnd),
        rounds_done: myRounds.length,
        scored_rounds_done: scored.length,
        total_score: rec.total_score != null ? rec.total_score : scored.reduce(function (a, r) { return a + (r.final_score || 0); }, 0),
        mean_score_ai_on: aiMean, mean_score_ai_off: offMean,
        mean_reveals_ai_on: aiRounds.length ? aiRounds.reduce(function (a, r) { return a + (r.n_reveals || 0); }, 0) / aiRounds.length : null,
        mean_reveals_ai_off: offRounds.length ? offRounds.reduce(function (a, r) { return a + (r.n_reveals || 0); }, 0) / offRounds.length : null,
        mean_queries_ai_on: aiRounds.length ? aiRounds.reduce(function (a, r) { return a + (r.n_queries || 0); }, 0) / aiRounds.length : null,
        n_queries_total: nq,
        ai_mean_abs_error_experienced: meanAbsErr,
        ai_exact_per_10_experienced: hitRate10,
        understood_frontier: !!(quiz[Content.UNDERSTOOD_FRONTIER_QID] && quiz[Content.UNDERSTOOD_FRONTIER_QID].first),
        error_belief_gap: (statedErr != null && meanAbsErr != null) ? (statedErr - meanAbsErr) : null,
        hit_rate_belief_gap: (statedHits != null && hitRate10 != null) ? (statedHits - hitRate10) : null,
        perceived_vs_actual_half: (survey.s12 && actualHalf) ? (survey.s12 === actualHalf) : null,
        perceived_better_half: survey.s12 || null,
        actual_better_half: actualHalf,
        median_decision_ms: medDec,
        disengaged: !!((medDec != null && medDec < 500) || (totalReveals > 0 && revealsNoScan > totalReveals / 2)),
        button_order: rec.button_order || (sessionStart && sessionStart.button_order) ||
                      (start && start.button_order) || null,
        platform_sim: (rec.platform && rec.platform.sim) || null,
        platform_session: (rec.platform && rec.platform.session) || null
      };

      // Phase breakdown (§16.1), one column per phase.
      var ph = rec.phase_ms || {};
      ['consent', 'registration', 'instructions', 'quiz', 'aiinstructions', 'aiquiz', 'blockintro', 'round', 'interstitial', 'survey', 'debrief']
        .forEach(function (k) { row['phase_ms_' + k] = ph[k] != null ? ph[k] : null; });

      // Comprehension: attempts + first-answer correctness, one pair per question.
      Content.quizColumns().forEach(function (qid) {
        row['quiz_' + qid + '_attempts'] = quiz[qid] ? quiz[qid].attempts : null;
        row['quiz_' + qid + '_first_correct'] = quiz[qid] ? quiz[qid].first : null;
        row['quiz_' + qid + '_ms'] = quiz[qid] ? quiz[qid].ms : null;
      });

      // Every survey answer, in screen order.
      Content.surveyColumns().forEach(function (sid) { row['survey_' + sid] = survey[sid] != null ? survey[sid] : null; });

      // Registration: the background block, plus whatever the Simulation
      // Platform supplied instead of asking. The `survey[sid]` fallback reads
      // sessions collected BEFORE this became its own phase, when the same
      // items were the exit survey's Part F under the same ids — one column
      // either way, so an older session still exports its background.
      Content.registrationColumns().forEach(function (sid) {
        var v = reg[sid] != null ? reg[sid] : (survey[sid] != null ? survey[sid] : null);
        row['reg_' + sid] = v;
      });
      // A RETIRED question keeps exporting the answers it already collected.
      // The column list is the CURRENT registration block, so retiring an item
      // — field of study went in 2026-08 — would otherwise drop it from the
      // Participants sheet of every future export, including a re-export of a
      // session that holds real answers to it. They would survive only as raw
      // event rows, and a re-export would quietly differ from the one taken
      // last term. So any answer actually present under a retired background id
      // gets its column back, from either source (`survey` covers the Part F
      // era, where the same ids were exit-survey rows). A session that never
      // held one gains no empty column, so nothing accumulates. `f_` is the
      // background block's own id namespace — no survey or quiz item uses it,
      // which tools/selftest.js pins.
      [reg, survey].forEach(function (src) {
        Object.keys(src).forEach(function (k) {
          if (/^f_/.test(k) && row['reg_' + k] === undefined) row['reg_' + k] = src[k];
        });
      });
      Object.keys(reg).forEach(function (k) {
        if (k.indexOf('platform_') === 0) row['reg_' + k] = reg[k];
      });
      Object.keys(survey).forEach(function (k) {          // legacy rows
        if (k.indexOf('platform_') === 0 && row['reg_' + k] == null) row['reg_' + k] = survey[k];
      });

      out.push(row);
    });

    out.sort(function (a, b) { return String(a.participant_code).localeCompare(String(b.participant_code)); });
    return out;
  }

  // ======================================================================
  //  DRY RUN (§17b Screen 6)
  // ======================================================================
  // A scripted bot plays a whole session against a run's REAL specs, in memory,
  // emitting exactly the rows the app would emit. It exists to confirm that the
  // event log, this export and the timing fields all populate — not to model
  // behaviour. Bot rows carry `bot: true` and are never written anywhere.
  function botSession(art, code, sequence, run) {
    var params = art.params;
    var plan = Specs.sessionPlan(art.specs, code, sequence, params);
    var rows = [], t = Date.now() - 2400000, seq = 0, total = 0;
    // The bot arrives through the same interface a participant would, so its
    // rows carry the same per-participant button order — a base field on every
    // row, exactly as the logger stamps it live.
    var buttonOrder = Specs.buttonOrder(params, code);

    function push(ev, extra) {
      var r = Object.assign({
        run_id: (run && run.id) || null, participant_code: code, pid: code, session: code,
        sessionCode: (run && run.code) || null, sequence: sequence, button_order: buttonOrder, bot: true,
        event: ev, t: t, iso: new Date(t).toISOString(), seq: seq++
      }, extra || {});
      rows.push(r); t += 900;
      return r;
    }
    function pairs(list) { return list.map(function (x) { return x.pos + ':' + x.val; }).join('|'); }

    push('session_start', { info: JSON.stringify({ sequence: sequence }) });
    Content.QUIZ_BASE.concat(Content.QUIZ_AI).forEach(function (q) {
      push('comprehension', {
        question_id: q.id, attempts: 1, ms_to_first_answer: 4200,
        first_answer_correct: true, answer: q.answer, correct: true
      });
    });

    plan.rounds.forEach(function (r) {
      var spec = r.spec, map = art.pool[spec.mapping_index];
      var ctx = {
        block: r.block, condition: r.condition, scored: r.scored, round_index: r.round_index,
        spec_id: spec.spec_id, seed_shape: spec.seed_shape, ai_density: spec.ai_density,
        mapping_index: spec.mapping_index
      };
      push('round_start', Object.assign({}, ctx, {
        info: JSON.stringify({ pre_opened: spec.pre_opened, ai_k: spec.ai_k, interrupted: false })
      }));

      var revealed = [], queried = [], di = 0;
      var J = params.env.positions;
      var picks = [Math.round(J * 0.17), Math.round(J * 0.44), Math.round(J * 0.71), Math.round(J * 0.88)]
        .map(function (p) { return Math.max(1, Math.min(J, p)); });

      picks.forEach(function (pos, i) {
        var revealedPos = revealed.map(function (x) { return x.pos; });
        var anchors = Ai.anchorSet(spec.ai_anchors, spec.pre_opened, revealedPos, map);
        var known = Ai.knownSet(spec.pre_opened, revealedPos, map);
        var best = known.reduce(function (m, x) { return (m == null || x.val > m) ? x.val : m; }, null);
        var base = {
          event_id: 'bot-' + code + '-' + r.round_index + '-' + i,
          decision_index: di, queries_so_far: queried.length, reveals_so_far: revealed.length,
          n_reveals_before: revealed.length,
          ai_anchors_before: pairs(anchors), participant_known_before: pairs(known),
          participant_queried_before: pairs(queried),
          best_true_known_before: best, best_estimate_before: best,
          ms_since_round_start: 1200 * (i + 1), ms_since_last_action: 1200,
          ms_since_last_slider_move: 600, slider_moves_since_last_action: 3 + i
        };
        if (r.condition === 'AI_ON' && i % 2 === 0) {
          var ans = Ai.aiAnswer(anchors, pos, params.ai.answerRounding);
          push('decision', Object.assign({}, ctx, base, { action: 'query', position: pos, value: ans }));
          queried.push({ pos: pos, val: ans });
        } else {
          push('decision', Object.assign({}, ctx, base, {
            action: 'reveal', position: pos, value: map[pos - 1],
            already_queried: queried.some(function (q) { return q.pos === pos; })
          }));
          revealed.push({ pos: pos, val: map[pos - 1] });
        }
        di++;
      });

      var knownFinal = Ai.knownSet(spec.pre_opened, revealed.map(function (x) { return x.pos; }), map);
      // In an AI round the bot stops on the best thing it BELIEVES, verified or
      // not, so the export's blind-nomination path (nomination_type
      // 'queried_only', nomination_ai_error, misplaced_trust) is exercised.
      var candidates = knownFinal.concat(r.condition === 'AI_ON' ? queried : []);
      var nom = candidates.reduce(function (m, x) { return (!m || x.val > m.val) ? x : m; }, null)
        || { pos: Math.ceil(J / 2), val: map[Math.ceil(J / 2) - 1] };
      var nomVerified = knownFinal.some(function (x) { return x.pos === nom.pos; });
      var cost = queried.length * params.costs.queryCost + revealed.length * params.costs.revealCost;
      var score = map[nom.pos - 1] - cost;
      if (r.scored) total += score;

      push('decision', Object.assign({}, ctx, {
        event_id: 'bot-stop-' + code + '-' + r.round_index, decision_index: di, action: 'stop',
        position: nom.pos, queries_so_far: queried.length, reveals_so_far: revealed.length,
        n_reveals_before: revealed.length, ai_anchors_before: '',
        participant_known_before: pairs(knownFinal), participant_queried_before: pairs(queried),
        best_true_known_before: nom.val, best_estimate_before: nom.val,
        ms_since_round_start: 9000, ms_since_last_action: 1500,
        ms_since_last_slider_move: 700, slider_moves_since_last_action: 4, cap_hit: null
      }));
      push('round_end', Object.assign({}, ctx, {
        n_queries: queried.length, n_reveals: revealed.length, total_cost: cost,
        nominated_position: nom.pos, nominated_true_value: map[nom.pos - 1],
        nomination_type: nomVerified ? 'verified' : 'queried_only', final_score: score, raw_score: score,
        duration_ms: 12000, stopped_immediately: false, instruction_reopens: 0,
        blur_events: 0, blur_total_ms: 0, interrupted: false,
        info: JSON.stringify({ queries: pairs(queried), reveals: pairs(revealed), slider_moves: 24 })
      }));
      // A handful of telemetry rows, so the Slider and Attention sheets are
      // exercised too.
      push('telemetry', {
        value: 3,
        info: JSON.stringify([
          { kind: 'slider', position: picks[0], via: 'drag', ms: 400, t: t, round_index: r.round_index },
          { kind: 'slider', position: picks[1], via: 'arrow', ms: 1600, t: t + 10, round_index: r.round_index },
          { kind: 'heartbeat', t: t + 20, round_index: r.round_index, phase: 'round' }
        ])
      });
    });

    Content.SURVEY.forEach(function (q) {
      if (q.type === 'numeracy') { q.items.forEach(function (it) { push('survey', { question_id: it.id, answer: it.answer }); }); return; }
      var ans = (q.type === 'choice') ? q.options[0]
        : (q.type === 'slider') ? Math.round((q.min + q.max) / 2)
        : (q.type === 'multi') ? q.options[0] : 'bot answer';
      push('survey', { question_id: q.id, answer: ans });
      if (q.followText) push('survey', { question_id: q.id + '_why', answer: 'bot answer' });
    });

    push('session_end', {
      final_score: total, duration_ms: 2400000,
      info: JSON.stringify({
        run_id: (run && run.id) || null, run_code: (run && run.code) || null,
        participant_code: code, pid: code, sequence: sequence, shuffle_seed: plan.shuffleSeed,
        round_order: plan.roundOrder.map(function (b) { return b.block + ':' + b.specIds.join(','); }).join(' | '),
        completed: true, total_score: total,
        wall_clock_ms: 2400000, active_ms: 2100000, idle_ms: 300000, longest_break_ms: 40000,
        started_at: new Date(Date.now() - 2400000).toISOString(), ended_at: new Date().toISOString(),
        viewport_width: 1440, viewport_height: 900, device_pixel_ratio: 2, input_mode: 'mouse',
        user_agent_parsed: 'bot/bot', resumptions: 0, timezone_offset: 0,
        phase_ms: { consent: 20000, instructions: 180000, quiz: 90000, round: 1500000, survey: 300000 },
        platform: null
      })
    });
    return rows;
  }

  // ======================================================================
  //  PUBLIC
  // ======================================================================
  function build(events, run, opts) {
    var art = artifactsFor(run);
    // "Bot sessions carry a flag and are excluded from every export" (§17b).
    // The dry run passes {keepBots:true} so it can inspect its own rows.
    if (!(opts && opts.keepBots)) {
      events = (events || []).filter(function (e) { return !e.bot; });
    }
    var decisions = buildDecisions(events, art);
    var rounds = buildRounds(events, art);
    var participants = buildParticipants(events, art, rounds, decisions);
    return {
      artifacts: art, decisions: decisions, rounds: rounds,
      participants: participants, raw: events
    };
  }

  // Union of the keys present, in first-seen order — so a column that only some
  // rows carry still gets a header, and the order stays stable across exports.
  function columnsOf(rows) {
    var cols = [], seen = {};
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } });
    });
    return cols;
  }
  function toCSV(rows) {
    var cols = columnsOf(rows);
    var q = function (v) {
      if (v == null) return '';
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      var s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return q(r[c]); }).join(',');
    })).join('\n');
  }
  function toSheet(name, rows) {
    var cols = columnsOf(rows);
    return {
      name: name,
      cols: cols.map(function (c) { return { w: Math.min(38, Math.max(10, c.length + 3)) }; }),
      // Values pass through as they are: a boolean stays a boolean (the writer
      // emits a real Excel boolean), a number stays a number, and null stays an
      // empty cell rather than the string "null".
      rows: [cols].concat(rows.map(function (r) {
        return cols.map(function (c) { return r[c] === undefined ? null : r[c]; });
      }))
    };
  }
  // A cheap, stable checksum so an export can be told apart from a re-export
  // (§17b Screen 6: "show row counts and a checksum").
  function checksum(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // Columns that stayed empty across every row — what the dry run reports.
  function emptyColumns(rows) {
    if (!rows || !rows.length) return ['(no rows)'];
    return columnsOf(rows).filter(function (c) {
      return rows.every(function (r) { return r[c] == null || r[c] === ''; });
    });
  }

  return {
    artifactsFor: artifactsFor, group: group,
    buildDecisions: buildDecisions, buildRounds: buildRounds, buildParticipants: buildParticipants,
    build: build, botSession: botSession, columnsOf: columnsOf, emptyColumns: emptyColumns,
    toCSV: toCSV, toSheet: toSheet, checksum: checksum,
    decodePairs: decodePairs, ERROR_BAND_MID: ERROR_BAND_MID
  };
});
