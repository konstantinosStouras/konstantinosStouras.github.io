/* ==========================================================================
   search-v2  ·  backend.js
   Where the score-bearing actions are computed.

   Two implementations behind one interface, chosen per RUN:

     · SERVER (design brief §17.2, the recommended mode) — `queryAI`, `reveal`
       and `nominate` are callable Cloud Functions. The client sends a position;
       the server holds the mapping, computes the answer or the truth, charges
       the cost, appends the authoritative event and returns THE SINGLE NUMBER.
       The prize mapping never reaches the browser at all.

     · LOCAL — the client computes, from a pool it regenerates from the run's
       seed. This is what runs with no Firebase at all, in the admin's test
       round, and on a project without the Blaze plan.

   THE TWO MODES ARE NEVER MIXED WITHIN A RUN, and a server-mode failure is NEVER
   silently downgraded to local. Falling back would quietly void the integrity
   property the run was configured for, and would put two kinds of row in one
   dataset; a visible error is the honest outcome, so `serverUnavailable` is
   surfaced to the participant instead.

   The interface, all promise-returning:
       claimCode(code)                       -> { ok, sequence, buttonOrder, resumed, reason }
       startRound(roundIndex)                -> round descriptor + pre_opened values
       act('query'|'reveal', pos, actionId)  -> { value }
       nominate(pos, actionId)               -> { trueValue, score, … }
       debriefRound()                        -> one of the participant's own
                                                rounds, with the truth, for §16.7
       canSeeTruth                           -> false in server mode
   ========================================================================== */
window.SVBackend = (function () {
  'use strict';

  var Pool = window.SVPool, Specs = window.SVSpecs, Ai = window.SVAi;

  // ------------------------------------------------------------------------
  //  LOCAL — the client computes
  // ------------------------------------------------------------------------
  function localBackend(o) {
    // Closure-only. Never assigned to window, never written into the DOM.
    var pool = Pool.buildPool(o.params.env, o.params.env.generatorSeed);
    var specs = o.specs && o.specs.length ? o.specs
      : Specs.buildSpecs(pool, o.params, o.specSeed || null);
    var P = o.params;
    var plan = null, cur = null;

    function ensurePlan(code, sequence) {
      if (!plan || plan.code !== code || plan.sequence !== sequence) {
        plan = Specs.sessionPlan(specs, code, sequence, P);
        plan.code = code; plan.sequence = sequence;
      }
      return plan;
    }

    return {
      mode: 'local',
      canSeeTruth: true,
      specs: specs,
      plan: function (code, sequence) { return ensurePlan(code, sequence).rounds; },

      claimCode: function () { return Promise.resolve({ ok: true, local: true }); },

      startRound: function (code, sequence, roundIndex) {
        var r = ensurePlan(code, sequence).rounds[roundIndex - 1];
        if (!r) return Promise.reject(new Error('no such round'));
        var map = pool[r.spec.mapping_index];
        cur = {
          roundIndex: roundIndex, spec: r.spec, map: map,
          queries: [], reveals: [], applied: {}
        };
        return Promise.resolve({
          spec_id: r.spec.spec_id, block: r.block, condition: r.condition,
          scored: r.scored, seed_shape: r.spec.seed_shape, ai_density: r.spec.ai_density,
          ai_k: r.spec.ai_k, round_index: roundIndex, total_rounds: plan.rounds.length,
          pre_opened: r.spec.pre_opened.map(function (p) { return { pos: p, val: map[p - 1] }; })
        });
      },

      act: function (action, position, actionId) {
        if (!cur) return Promise.reject(new Error('round not started'));
        if (cur.applied[actionId] != null) return Promise.resolve({ value: cur.applied[actionId] });
        var value;
        if (action === 'query') {
          var anchors = Ai.anchorSet(cur.spec.ai_anchors, cur.spec.pre_opened,
            cur.reveals.map(function (x) { return x.pos; }), cur.map);
          value = Ai.aiAnswer(anchors, position, P.ai.answerRounding);
          cur.queries.push({ pos: position, val: value });
        } else {
          value = cur.map[position - 1];
          cur.reveals.push({ pos: position, val: value });
        }
        cur.applied[actionId] = value;
        return Promise.resolve({ value: value });
      },

      // Settled by Specs.settle, the SAME function the Cloud Function runs, so
      // the two modes cannot drift on the one thing a client must never decide.
      nominate: function (position) {
        if (!cur) return Promise.reject(new Error('round not started'));
        var st = Specs.settle(P, {
          map: cur.map, preOpened: cur.spec.pre_opened,
          reveals: cur.reveals, queries: cur.queries, position: position
        });
        return Promise.resolve({
          trueValue: st.trueValue,
          nominatedPosition: st.position,
          nominationType: st.nominationType,
          stopRule: st.rule,
          score: st.score, raw_score: st.raw_score, totalCost: st.totalCost,
          nQueries: cur.queries.length, nReveals: cur.reveals.length
        });
      },

      // The debrief redraws one of the participant's OWN rounds with the true
      // prizes beside what the AI told them (§16.7). Locally that is just a
      // lookup; the caller says which round and what happened in it.
      debriefRound: function (code, sequence, roundIndex, revealed) {
        var r = ensurePlan(code, sequence).rounds[roundIndex - 1];
        if (!r) return Promise.resolve(null);
        var map = pool[r.spec.mapping_index];
        var anchors = Ai.anchorSet(r.spec.ai_anchors, r.spec.pre_opened,
          (revealed || []).map(function (x) { return x.pos; }), map);
        var curve = [];
        for (var p = 1; p <= P.env.positions; p++) curve.push(Ai.aiAnswerRaw(anchors, p));
        return Promise.resolve({
          round_index: roundIndex, block: r.block, truth: map, curve: curve,
          anchors: r.spec.ai_anchors.map(function (q) { return { pos: q, val: map[q - 1] }; }),
          pre: r.spec.pre_opened.map(function (q) { return { pos: q, val: map[q - 1] }; })
        });
      },

      // Testing view only, and only in local mode — the sandbox is always local.
      peek: function () {
        if (!cur) return null;
        var anchors = Ai.anchorSet(cur.spec.ai_anchors, cur.spec.pre_opened,
          cur.reveals.map(function (x) { return x.pos; }), cur.map);
        var curve = [];
        for (var p = 1; p <= P.env.positions; p++) curve.push(Ai.aiAnswerRaw(anchors, p));
        return {
          truth: cur.map, curve: curve, anchors: anchors,
          privateAnchors: cur.spec.ai_anchors.map(function (q) { return { pos: q, val: cur.map[q - 1] }; })
        };
      }
    };
  }

  // ------------------------------------------------------------------------
  //  SERVER — the Cloud Functions of §17.2
  // ------------------------------------------------------------------------
  function serverBackend(o) {
    var P = o.params, runId = o.runId;
    var plan = null;

    function call(name, data) {
      return window.SVFirebase.callable(name, Object.assign({ runId: runId }, data));
    }

    return {
      mode: 'server',
      canSeeTruth: false,
      specs: null,
      // The client is not told the SPECS in server mode — no spec id, no seed
      // shape, no density, no pre-opened positions, no anchors. What it does get
      // is the SHAPE of the session: how many rounds, which block each sits in,
      // whether it is scored, and which condition it runs under. None of that is
      // secret (the condition follows from the participant's own sequence), and
      // the flow needs it to know when to show the AI instructions. Everything
      // else arrives one round at a time from startRound.
      plan: function (code, sequence) {
        if (plan && plan.sequence === sequence) return plan;
        var n = 2 * (P.rounds.warmupPerBlock + P.rounds.scoredPerBlock);
        var perBlock = n / 2;
        plan = [];
        plan.sequence = sequence;
        for (var i = 1; i <= n; i++) {
          var block = i <= perBlock ? 1 : 2;
          var inBlock = i - (block - 1) * perBlock;
          var aiOn = (sequence === 'B') ? (block === 1) : (block === 2);
          plan.push({
            round_index: i, block: block,
            scored: inBlock > P.rounds.warmupPerBlock,
            condition: aiOn ? 'AI_ON' : 'AI_OFF',
            spec_id: null, spec: null
          });
        }
        return plan;
      },

      claimCode: function (code) {
        return call('claimCode', { code: code }).then(function (r) {
          return { ok: true, sequence: r.sequence, buttonOrder: r.buttonOrder || null, resumed: !!r.resumed };
        }, function (e) {
          var msg = String((e && e.message) || e);
          return { ok: false, reason: /not-on-roster/.test(msg) ? 'notonroster' : 'server', detail: msg };
        });
      },

      startRound: function (code, sequence, roundIndex) {
        return call('startRound', { code: code, roundIndex: roundIndex });
      },
      act: function (action, position, actionId, code, roundIndex) {
        return call('act', { code: code, roundIndex: roundIndex, action: action, position: position, actionId: actionId });
      },
      nominate: function (position, actionId, code, roundIndex) {
        return call('nominate', { code: code, roundIndex: roundIndex, position: position, actionId: actionId });
      },
      debriefRound: function (code, sequence, roundIndex) {
        return call('debriefRound', { code: code, roundIndex: roundIndex }).catch(function () { return null; });
      },
      peek: function () { return null; }   // there is nothing to peek at here
    };
  }

  return {
    create: function (opts) {
      return (opts.serverMode && window.SVFirebase && window.SVFirebase.isConfigured())
        ? serverBackend(opts)
        : localBackend(opts);
    },
    localBackend: localBackend,
    serverBackend: serverBackend
  };
})();
