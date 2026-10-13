/* Shared, deterministic analysis for the screen, PDF and regression tests. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./answer-grader.js') : root.ProblemAnswerGrader);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProblemAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Grader) {
  'use strict';
  const VERSION = 'evidence-2026-10-13';
  const number = value => {
    const text = String(value ?? '').trim();
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const passes = ([a, b, c]) => a < b && b < c;
  const equal = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  const key = seq => JSON.stringify(seq.map(x => Object.is(x, -0) ? 0 : x));
  const sequenceText = seq => '(' + seq.join(', ') + ')';
  const probes = [
    { label: 'Doubling is required', example: [1, 2, 3], result: 'Yes', test: s => passes(s) && !(equal(s[1] / 2, s[0]) && equal(s[2] / 2, s[1])) },
    { label: 'A constant ratio is required', example: [1, 2, 3], result: 'Yes', test: s => {
      if (!passes(s)) return false;
      const scale = Math.max(...s.map(Math.abs));
      const [a,b,c] = s.map(x => x / scale);
      return !equal(b*b, a*c);
    } },
    { label: 'Only positive numbers work', example: [-1, 0, 1], result: 'Yes', test: s => passes(s) && s.some(x => x <= 0) },
    { label: 'Only integers work', example: [0.5, 1, 1.5], result: 'Yes', test: s => passes(s) && s.some(x => !Number.isInteger(x)) },
    { label: 'Only even integers work', example: [1, 2, 3], result: 'Yes', test: s => passes(s) && s.some(x => !Number.isInteger(x) || x % 2 !== 0) },
    { label: 'Equal adjacent numbers are allowed', example: [1, 1, 2], result: 'No', test: ([a,b,c]) => a <= b && b <= c && (a === b || b === c) }
  ];
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"' && text[i+1] === '"') { cell += c; i++; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell.trim()); cell = ''; }
      else if (c === '\n' || c === '\r') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; if (c === '\r' && text[i+1] === '\n') i++; }
      else cell += c;
    }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function detectColumns(headers) {
    const names = headers.map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const find = choices => names.findIndex(x => choices.includes(x));
    return { timestamp: find(['timestamp','date']), attempts: find(['numberofattempts','numattempts','attempts']), yeses: find(['yeses','yescount']), nos: find(['nos','nocount']), conf: find(['confidencelevel','confidence','conf']), rule: find(['whatstherule','rule','answer']), yesSeq: find(['yessequences']), noSeq: find(['nosequences']), gotRight: find(['gotitright','correct']), submissionId: find(['submissionid']), reviewed: find(['reviewedstatus']), reviewer: find(['reviewedby']), reviewedAt: find(['reviewedat']) };
  }
  function parseSequences(text) {
    if (!text || /^(?:[-—–―]|none)$/i.test(text.trim())) return { sequences: [], valid: true };
    const sequences = []; let valid = true;
    for (const part of text.split(';')) {
      const nums = part.trim().replace(/^[([]|[)\]]$/g, '').split(',').map(number);
      if (nums.length !== 3 || nums.some(x => x === null)) valid = false;
      else sequences.push(nums);
    }
    return { sequences, valid };
  }
  function evidence(sequences) {
    const unique = [...new Map(sequences.map(s => [key(s), s])).values()];
    const checklist = probes.map(p => {
      const witness = unique.find(p.test);
      return { label: p.label, covered: !!witness, witness: witness ? sequenceText(witness) + ' → ' + (passes(witness) ? 'Yes' : 'No') : null, example: sequenceText(p.example), result: p.result };
    });
    return { coverage: checklist.filter(p => p.covered).length, unique: unique.length, duplicates: sequences.length - unique.length, checklist };
  }
  function gradeRule(rule) { return Grader.grade(rule); }
  function records(rows, cols) {
    return rows.map((r, i) => {
      const attempts = number(r[cols.attempts]), yeses = number(r[cols.yeses]), nos = number(r[cols.nos]), conf = number(r[cols.conf]);
      const y = parseSequences(r[cols.yesSeq] || ''), n = parseSequences(r[cols.noSeq] || '');
      const countsValid = Number.isInteger(attempts) && attempts > 0 && Number.isInteger(yeses) && yeses >= 0 && Number.isInteger(nos) && nos >= 0 && yeses + nos === attempts;
      const historyValid = countsValid && y.valid && n.valid && y.sequences.length === yeses && n.sequences.length === nos && y.sequences.every(passes) && n.sequences.every(s => !passes(s));
      const seqs = [...y.sequences, ...n.sequences];
      const reviewedText = (r[cols.reviewed] || '').toLowerCase().trim();
      const audited = Grader.lookup(r[cols.rule] || '');
      const reviewed = r[cols.reviewer] && r[cols.reviewedAt] && ['correct','incorrect'].includes(reviewedText) ? reviewedText : audited && ['correct','incorrect'].includes(audited.status) ? audited.status : null;
      return { row: i+2, id: r[cols.submissionId] || null, attempts: Number.isInteger(attempts) && attempts > 0 ? attempts : null, yeses, nos, conf: Number.isInteger(conf) && conf >= 1 && conf <= 5 ? conf : null, countsValid, historyValid, reviewed, rule: r[cols.rule] || '', sequences: seqs, ...(historyValid ? evidence(seqs) : { coverage:null, unique:null }) };
    });
  }
  const mean = xs => xs.length ? xs.reduce((s,x) => s+x, 0) / xs.length : null;
  const median = xs => { if (!xs.length) return null; const a = [...xs].sort((a,b)=>a-b), m = Math.floor(a.length/2); return a.length%2 ? a[m] : (a[m-1]+a[m])/2; };
  function benchmark(values, value) {
    const a = values.filter(Number.isFinite).sort((a,b)=>a-b), n = a.length, k = Math.ceil(n*.05);
    const lower = a.filter(x => x < value).length, tied = a.filter(x => x === value).length;
    return { n, value, average:mean(a), median:median(a), bottom: n>=100 ? mean(a.slice(0,k)) : null, top:n>=100 ? mean(a.slice(-k)) : null, tailN:n>=100 ? k : 0, percentile:n && Number.isFinite(value) ? 100*(lower+tied/2)/n : null, lower, tied, unstable:n>=100 && n<200 };
  }
  function feedback(player) {
    const ev = player.evidence, seqs = player.sequences, grade = gradeRule(player.rule), items = [];
    let title = 'What your tests established';
    if (!ev.checklist[0].covered && seqs.length && seqs.every(s => passes(s) && !probes[0].test(s))) {
      title = 'Your tests left the doubling explanation unchallenged';
      items.push('Every sequence you tested doubles at each step. Each also fits increasing order, so the Yes results cannot distinguish these two explanations. This round is consistent with testing examples that fit an initial idea; it does not establish a stable personal bias.');
    } else if (ev.coverage === 6) items.push('Your tests produced evidence against all six alternatives in the checklist. This is broad coverage of these alternatives, not proof that every possible explanation has been eliminated.');
    else items.push(`Your tests rule out ${ev.coverage} of the six listed alternatives. The checklist below shows the exact evidence. Untested alternatives are gaps in this evidence, not a diagnosis of your thinking.`);
    if (ev.duplicates) items.push(`You repeated ${ev.duplicates} exact test${ev.duplicates===1?'':'s'}. These repeats did not add distinct evidence; your ${ev.unique} different sequences determine the checklist.`);
    if (grade.status === 'incorrect' && player.conf >= 4) items.push(`You reported high confidence (${player.conf}/5) in an answer that does not match the rule. In this round, confidence exceeded what your final rule justified.`);
    if (player.nos === 0 && ev.coverage > 0) items.push('You heard only Yes, but some of those results still ruled out alternative explanations. A useful challenge need not receive No.');
    if (grade.status === 'correct' && !ev.checklist[5].covered) items.push('Your answer identifies the rule, but you did not directly test whether equal adjacent numbers are allowed. A correct answer and a complete set of checks are different things.');
    const missing = ev.checklist.find(p=>!p.covered);
    const next = missing ? `Try ${missing.example}. The alternative “${missing.label.toLowerCase()}” predicts ${missing.result==='Yes'?'No':'Yes'}; the actual rule returns ${missing.result}. This separates the two explanations.` : 'For your next problem, write two plausible explanations and choose a test on which their predictions differ. Record your prediction before seeing the result.';
    return { title, items, next, grade };
  }
  function wilson(success, n) {
    if (!n) return null;
    const z=1.96,p=success/n,d=1+z*z/n,mid=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
    return { rate:100*p, low:100*(mid-half), high:100*(mid+half), n };
  }
  function makeReport(input, source) {
    const sequences = input.guesses.map(g=>g.nums), ev = evidence(sequences);
    const player = { rule:input.rule, conf:input.conf, sequences, attempts:sequences.length, yeses:sequences.filter(passes).length, nos:sequences.filter(s=>!passes(s)).length, evidence:ev };
    const peers = (source?.records || []).filter(r=>!input.id || r.id!==input.id);
    const metrics = [ ['coverage','Alternatives ruled out',ev.coverage,' / 6'], ['unique','Distinct sequences',ev.unique,''], ['attempts','Total tests',player.attempts,''], ['conf','Confidence',player.conf,' / 5'] ].map(([key,label,value,unit])=>({key,label,unit,...benchmark(peers.map(r=>r[key]),value)}));
    const eligible = peers.filter(r=>r.historyValid), reviewed = peers.filter(r=>r.reviewed && r.conf!==null);
    const frequency = new Map(); eligible.forEach(r=>new Set(r.sequences.map(key)).forEach(k=>frequency.set(k,(frequency.get(k)||0)+1)));
    const accuracy = [1,2,3,4,5].map(conf=>{const group=reviewed.filter(r=>r.conf===conf); return { conf,...(wilson(group.filter(r=>r.reviewed==='correct').length,group.length)||{rate:null,low:null,high:null,n:0}) };});
    const label = source?.fetchedAt ? new Date(source.fetchedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' (Europe/London)' : 'Unavailable';
    return { version:VERSION, player, feedback:feedback(player), metrics, sampleN:peers.length, historyN:eligible.length, excludedHistories:peers.length-eligible.length, reviewedN:reviewed.length, accuracy, coverageCounts:[0,1,2,3,4,5,6].map(x=>eligible.filter(r=>r.coverage===x).length), attemptsCounts:Array.from({length:15},(_,i)=>peers.filter(r=>r.attempts!==null&&(i===14?r.attempts>=15:r.attempts===i+1)).length), common:[...frequency].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([seq,n])=>({sequence:sequenceText(JSON.parse(seq)),n})), snapshot:label, sourceAvailable:!!source?.records, sourceNote:source?.note || 'Peer data could not be loaded. Personal feedback remains available.', sequenceNote:'Coverage counts alternatives contradicted by your evidence. Alternatives overlap; this is a teaching checklist, not a validated creativity scale. The supplied seed earns no credit.', benchmarkNote:'Average and tail means use eligible peer responses for each measure. Top/bottom 5% means the highest/lowest values on that measure, not the best/worst thinkers. More tests or higher confidence is not automatically better.', tieNote:'Percentile = (peers below you + half the peers tied with you) / eligible peers. Ties can place more than 5% of responses at the 95th-percentile cutoff. Tail means use ceil(5% × n) values. Identical boundary values have equal weight; no named people are selected.', limitsNote:'Historical rows represent responses, not verified unique people. Repeat participation and prior exposure cannot be identified. Cross-outcome test order and working hypotheses are unavailable for historical rows.' };
  }
  return { VERSION, number, passes, probes, parseCSV, detectColumns, parseSequences, evidence, gradeRule, records, benchmark, makeReport, sequenceText, wilson };
});

