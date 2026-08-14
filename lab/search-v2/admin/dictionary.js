/* ==========================================================================
   search-v2  ·  admin/dictionary.js
   What every exported column means.

   The workbook is read by two audiences with opposite needs: a person opening
   it in Excel who wants to understand a column without reading the source, and
   a script that wants tidy, typed, one-row-per-observation data. This module
   serves the first without compromising the second — it is pure description, so
   the data sheets stay exactly as machine-friendly as they were.

   ONE ENTRY PER COLUMN, and `tools/selftest.js` fails the build when a column
   is exported without one. That is the point: a derived field nobody can define
   in a sentence is a field nobody should be analysing.

   `type` is what a reader should expect in the cell:
     id · factor · integer · number · points · ms · boolean · timestamp · text
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SVDictionary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- identity and design, shared by every sheet -------------------------
  var COMMON = {
    run_id: ['id', 'The session this row belongs to. The design brief calls a session a “run”, and the data keeps that name.'],
    participant_code: ['id', 'The participant. From the Simulation Platform this is their student ID.'],
    pid: ['id', 'The same person as the platform knows them — the join key for “who completed this”.'],
    sequence: ['factor', 'Crossover arm. A = block 1 without the AI then block 2 with it; B = the reverse.'],
    block: ['factor', 'Half of the session: 1 or 2. Which half carries the AI depends on `sequence`.'],
    condition: ['factor', 'AI_ON or AI_OFF for this round. This is the treatment.'],
    scored: ['boolean', 'FALSE for the four warm-up rounds, which are played but excluded from analysis.'],
    spec_id: ['id', 'The frozen round spec, e.g. B1-05. Identical across participants.'],
    seed_shape: ['factor', 'Starting layout: FRONTIER, BALANCED, GAP, or OPEN when nothing is pre-opened.'],
    ai_density: ['factor', 'SPARSE (K=4) or DENSE (K=10) — how many positions the AI knows exactly.'],
    ai_k: ['integer', 'The number of positions the AI knows exactly in this round.'],
    round_index: ['integer', 'Round number within the session, 1…28, in the order this participant played them.'],
    mapping_index: ['id', 'Which mapping of the frozen pool held this round’s prizes.'],
    t: ['timestamp', 'When the row happened, in milliseconds since 1970 (UTC).'],
    iso: ['timestamp', 'The same instant as an ISO 8601 string, for readability.']
  };

  // ---- Decisions: one row per query, reveal or stop ------------------------
  var DECISIONS = {
    decision_index: ['integer', 'Position of this action within the round, counting from 0.'],
    is_first_decision: ['boolean', 'TRUE on the first action of a round — the primary analysis moment.'],
    action: ['factor', 'query (asked the AI), reveal (paid for the truth), or stop (nominated and ended the round).'],
    button_order: ['factor', 'Which paid action sat on the LEFT for this participant — ask_first or reveal_first. Assigned once at enrolment and fixed for the whole session, block-randomised jointly with sequence (config.ui.buttonOrder), and denormalised onto every row so it can enter the model as a covariate. In an AI-off round only Reveal is on screen; the assignment still applies and is still recorded.'],
    position: ['integer', 'The position on the line, 1…100, this action was about.'],
    value: ['points', 'What the participant was told: the AI’s estimate for a query, the true prize for a reveal. Blank on a stop.'],
    already_queried: ['boolean', 'On a reveal: had they asked the AI about this position first?'],
    best_before: ['points', 'The best TRUE prize they had found before this action.'],
    best_estimate_before: ['points', 'The best value they had seen at all before this action, AI estimates included.'],
    n_reveals_before: ['integer', 'Reveals already made this round, before this action.'],
    n_queries_before: ['integer', 'Questions already asked this round, before this action.'],
    ms_since_round_start: ['ms', 'Time from the round opening to this action.'],
    ms_since_last_action: ['ms', 'Time since their previous action in this round.'],
    ms_since_last_slider_move: ['ms', 'Time since they last moved the selector — a long value means they sat on the choice.'],
    slider_moves_since_last_action: ['integer', 'How many positions they considered between the last action and this one.'],
    cap_hit: ['factor', 'Set when the round ended against the query or reveal cap.'],
    n_queries_in_round: ['integer', 'Total questions asked in this round (repeated on every row of it, for convenience).'],
    true_value_at_choice: ['points', 'The real prize at the chosen position — known offline, never shown at the time.'],
    step_size: ['integer', 'Distance from the previous reveal. Consecutive reveals only; blank on the first.'],
    last_prize: ['points', 'The prize found at the previous reveal.'],

    n_anchors: ['integer', 'How many positions the PARTICIPANT knew when they acted.'],
    x_min: ['integer', 'Leftmost position they knew.'],
    x_max: ['integer', 'Rightmost position they knew.'],
    choice_region: ['factor', 'Where they chose relative to what they knew: gap, left_tail, right_tail, or open when they knew nothing.'],
    is_frontier: ['boolean', 'TRUE when the choice lay beyond everything they knew — the primary outcome.'],
    dist_to_nearest_anchor: ['integer', 'Distance to the nearest position they already knew. Blank when they knew nothing.'],
    gap_width: ['integer', 'Width of the gap they chose inside.'],
    gap_fraction: ['number', 'Where in that gap they landed: 0 at the left edge, 0.5 mid-gap, 1 at the right.'],
    tail_depth: ['integer', 'How far beyond the outermost known position they reached.'],
    max_gap_available: ['integer', 'The widest interior gap open to them at that moment.'],
    max_tail_available: ['integer', 'The deeper of the two frontiers open to them.'],
    exchange_ratio: ['number', 'max_gap ÷ (4 × max_tail). Above 1 the gap holds more uncertainty than the frontier; below 1 the frontier does.'],

    ai_n_anchors: ['integer', 'How many positions the AI knew — its private anchors plus everything open.'],
    ai_x_min: ['integer', 'Leftmost position the AI knew.'],
    ai_x_max: ['integer', 'Rightmost position the AI knew.'],
    ai_choice_region: ['factor', 'The same geometry, measured against the AI’s knowledge rather than the participant’s.'],
    ai_gap_width: ['integer', 'Width of the AI’s gap around the chosen position.'],
    dist_to_nearest_ai_anchor: ['integer', 'How far the choice was from something the AI actually knew.'],
    ai_prediction: ['points', 'What the AI would have answered there — computed for every row, including AI-OFF rounds, so the two arms can be compared against the same curve.'],
    ai_sd: ['number', 'How uncertain that answer was: σ√(g)/2 mid-gap, σ√t in a tail.'],
    verify_pays: ['boolean', 'TRUE when ai_sd exceeded the verification threshold s* — i.e. paying to reveal was worth it.'],
    hit_private_anchor: ['boolean', 'TRUE when they happened to choose a position the AI knew exactly.'],
    ai_error: ['points', 'The AI’s answer minus the truth. Positive means it overstated.'],
    ai_curve_max: ['points', 'The highest value anywhere on the AI’s curve — never above its best anchor.'],
    lipschitz_upper: ['points', 'The highest prize the position could hold, given the step bound and what they knew.'],
    lipschitz_lower: ['points', 'The lowest it could hold, on the same reasoning.'],
    outside_window: ['boolean', 'TRUE when even the best possible value there was below what they already held — a dominated move.'],
    expected_improvement: ['number', 'Expected gain over their best-known prize from choosing this position.'],
    max_ei_available: ['number', 'The best expected improvement available anywhere at that moment.'],
    ei_argmax_position: ['integer', 'Where that best-available move was.'],
    matched_benchmark: ['boolean', 'TRUE when they chose exactly the myopic best move.'],
    ei_regret: ['number', 'How much expected improvement they left on the table.']
  };

  // ---- Rounds: one row per round ------------------------------------------
  var ROUNDS = {
    button_order: ['factor', 'Which paid action sat on the LEFT — the participant\u2019s own assignment, the same on every one of their rows. See the Decisions entry.'],
    pre_opened: ['text', 'Positions open from the start, as "position:value|…".'],
    ai_anchors: ['text', 'The positions the AI knew privately. Never shown to anyone during the study.'],
    started_at: ['timestamp', 'When the round opened.'],
    ended_at: ['timestamp', 'When it was nominated.'],
    duration_ms: ['ms', 'Wall-clock length of the round.'],
    instruction_reopens: ['integer', 'How many times they reopened the reminder during the round.'],
    blur_events: ['integer', 'How many times the window lost focus.'],
    blur_total_ms: ['ms', 'Total time the window was not in focus.'],
    interrupted: ['boolean', 'TRUE if the round was resumed after a reload. A COLUMN, not a filter — decide in analysis.'],
    n_queries: ['integer', 'Questions asked in the round.'],
    n_reveals: ['integer', 'Positions revealed in the round.'],
    total_cost: ['points', 'Everything spent: queries × query cost + reveals × reveal cost.'],
    final_score: ['points', 'The true prize where they stopped, minus total_cost. May be negative — there is no floor.'],
    raw_score: ['points', 'The same figure before any floor would be applied. Equal to final_score in this design.'],
    final_score_check: ['points', 'final_score recomputed offline from the mapping and the counts.'],
    score_mismatch: ['boolean', 'TRUE if the logged score and the recomputed one disagree. Should be FALSE everywhere; anything else is a data fault, not a finding.'],
    stopped_immediately: ['boolean', 'TRUE when they stopped without a single action.'],
    global_max: ['points', 'The best prize anywhere in this round’s mapping.'],
    argmax_position: ['integer', 'The first position holding that maximum.'],
    argmax_count: ['integer', 'How many positions hold it. Often more than one: the walk reflects at the ceiling.'],
    best_found: ['points', 'The best TRUE prize they uncovered.'],
    pct_of_max_attainable: ['number', 'best_found ÷ global_max — how much of the round they DISCOVERED.'],
    pct_of_max_nominated: ['number', 'The prize they stopped on ÷ global_max — how much they WALKED AWAY WITH.'],
    dist_best_to_argmax: ['integer', 'Distance from where they stopped to the NEAREST maximising position.'],
    final_best_is_last_reveal: ['boolean', 'TRUE when their best find was the last position they revealed.'],
    final_best_was_pre_opened: ['boolean', 'TRUE when their best find was open from the start.'],
    ms_to_first_action: ['ms', 'How long they looked before doing anything.'],
    active_ms: ['ms', 'Engaged time, from 30-second heartbeats — quantised, so use duration_ms for a per-round measure.'],
    verification_rate: ['number', 'Reveals that followed a question about the same position, per question asked.'],
    n_verifications: ['integer', 'Reveals that checked something the AI had said.'],
    nominated_position: ['integer', 'Where they stopped.'],
    nominated_true_value: ['points', 'The real prize there — what they won before costs.'],
    nomination_type: ['factor', 'verified (they had opened it), queried_only (they had only asked), or untouched.'],
    nomination_ai_error: ['points', 'What the AI had said there minus the truth. Blank if they never asked.'],
    wasted_verifications: ['integer', 'Verifications that found the AI had been close anyway (within 5 points).'],
    redundant_queries: ['integer', 'Questions asked about a position already open.'],
    misplaced_trust: ['boolean', 'TRUE when they stopped on a position the AI had overstated by more than the reveal cost.'],
    missed_frontier: ['boolean', 'TRUE when a better prize sat in a frontier they never explored.'],
    max_in_left_tail: ['points', 'The best prize hiding left of everything they touched.'],
    max_in_right_tail: ['points', 'The best prize hiding right of everything they touched.'],
    cap_hit: ['factor', 'Set when the round ended against the query or reveal cap.'],
    frontier_share: ['number', 'Share of their reveals that went beyond what they knew. Knowing nothing counts as frontier.'],
    slider_moves: ['integer', 'Positions considered during the round, from the selector trace.']
  };

  // ---- Participants: one row per person ------------------------------------
  var PARTICIPANTS = {
    started_at: ['timestamp', 'First row of their session.'],
    ended_at: ['timestamp', 'Last row of their session.'],
    completed: ['boolean', 'TRUE when they reached the end of the study.'],
    rounds_done: ['integer', 'Rounds played, including warm-ups.'],
    scored_rounds_done: ['integer', 'Rounds that count.'],
    total_score: ['points', 'Sum of final_score over the scored rounds.'],
    mean_score_ai_on: ['points', 'Mean scored-round score in the block with the AI.'],
    mean_score_ai_off: ['points', 'The same without it. The within-person difference is the treatment effect.'],
    mean_reveals_ai_on: ['number', 'Reveals per round with the AI.'],
    mean_reveals_ai_off: ['number', 'Reveals per round without it.'],
    mean_queries_ai_on: ['number', 'Questions per round with the AI.'],
    n_queries_total: ['integer', 'Questions asked across the whole session.'],
    ai_mean_abs_error_experienced: ['points', 'The average size of the AI error they actually met.'],
    ai_exact_per_10_experienced: ['number', 'How many of every ten answers were exactly right, for them.'],
    error_belief_gap: ['points', 'What they said the typical error was, minus what it actually was. Negative = they thought it was better than it was.'],
    hit_rate_belief_gap: ['number', 'The same comparison for exact answers.'],
    perceived_vs_actual_half: ['boolean', 'Whether the half they believed they did better in is the half they did.'],
    disengaged: ['boolean', 'A flag for unusually fast or inattentive play. A COLUMN, not a filter.'],
    resumptions: ['integer', 'How many times they resumed after leaving — every return, including a reload seconds later.'],
    breaks_count: ['integer', 'How many of those returns followed a real break between sittings (a gap of at least CONFIG.BREAK_MIN_MS).'],
    break_total_ms: ['ms', 'Total time spent AWAY between sittings. Not the same as idle_ms, which is quiet time inside a sitting.'],
    longest_sitting_break_ms: ['ms', 'The longest single break between two sittings.'],
    sittings: ['integer', 'How many separate occasions they worked on the study: breaks_count + 1.'],
    viewport_width: ['integer', 'Window width in pixels, recorded because the task is a picture.'],
    viewport_height: ['integer', 'Window height in pixels.'],
    device_pixel_ratio: ['number', 'Display scaling.'],
    input_mode: ['factor', 'Mouse, touch or keyboard, as first observed.'],
    user_agent_parsed: ['text', 'Browser and operating system.'],
    round_order: ['text', 'The realised order of their rounds — reproducible from shuffle_seed.'],
    shuffle_seed: ['id', 'The seed that produced that order, so it can be regenerated exactly.'],
    run_code: ['id', 'The session code they entered on, as it appears on the admin card.'],
    timezone_offset: ['integer', 'Their clock’s offset from UTC, in minutes.'],
    wall_clock_ms: ['ms', 'Total elapsed time from first row to last, breaks included.'],
    active_ms: ['ms', 'Engaged time, summed from 30-second heartbeats.'],
    idle_ms: ['ms', 'wall_clock_ms minus active_ms — time the study was open but unattended.'],
    longest_break_ms: ['ms', 'The longest single gap between actions.'],
    understood_frontier: ['boolean', 'Whether they answered the comprehension item about the AI beyond its known range correctly.'],
    perceived_better_half: ['factor', 'Which half they believed they scored higher in.'],
    actual_better_half: ['factor', 'Which half they actually scored higher in.'],
    median_decision_ms: ['ms', 'Median time between their actions — a deliberation measure robust to one long pause.'],
    button_order: ['factor', 'Which paid action sat on the LEFT for this participant, for their whole session — ask_first or reveal_first. Block-randomised jointly with sequence at enrolment (config.ui.buttonOrder), so all four cells of sequence × order come out balanced; it belongs in the model as a covariate, which is also what lets the position effect be reported rather than assumed away.'],
    platform_sim: ['id', 'The Simulation Platform app that launched them, when they arrived that way.'],
    platform_session: ['id', 'The platform session id they launched from.']
  };

  var SHEETS = {
    Decisions: { one: 'one row per query, reveal or stop', cols: DECISIONS },
    Rounds: { one: 'one row per round played', cols: ROUNDS },
    Participants: { one: 'one row per participant', cols: PARTICIPANTS }
  };

  function describe(sheet, col) {
    var s = SHEETS[sheet];
    var hit = (s && s.cols[col]) || COMMON[col] || null;
    if (hit) return { type: hit[0], text: hit[1] };
    // Survey and comprehension columns are generated from content.js, so they
    // are described generically rather than one by one.
    if (/^reg_platform_/.test(col) || /^survey_platform_/.test(col)) return { type: 'text', text: 'Answered on the Simulation Platform and carried across, not asked again here.' };
    if (/^reg_/.test(col)) return { type: 'text', text: 'Registration answer (background, asked before the study): ' + col.replace(/^reg_/, '') + '. Optional — blank means they skipped it.' };
    if (/^survey_/.test(col)) return { type: 'text', text: 'Exit-survey answer: ' + col.replace(/^survey_/, '') + '.' };
    if (/^quiz_/.test(col)) return { type: 'text', text: 'Comprehension answer: ' + col.replace(/^quiz_/, '') + '.' };
    if (/^phase_ms_/.test(col)) return { type: 'ms', text: 'Time spent in the ' + col.replace(/^phase_ms_/, '') + ' phase.' };
    return null;
  }

  // Rows for the Dictionary sheet, in the order the columns appear.
  function rowsFor(sheetName, columns) {
    var s = SHEETS[sheetName];
    var out = [];
    columns.forEach(function (c) {
      var d = describe(sheetName, c);
      out.push([sheetName, c, d ? d.type : '', d ? d.text : '(undocumented — add it to admin/dictionary.js)']);
    });
    return out;
  }
  function oneRowIs(sheetName) { return (SHEETS[sheetName] || {}).one || ''; }
  function undocumented(sheetName, columns) {
    return columns.filter(function (c) { return !describe(sheetName, c); });
  }

  return {
    describe: describe, rowsFor: rowsFor, oneRowIs: oneRowIs,
    undocumented: undocumented, sheets: Object.keys(SHEETS)
  };
});
