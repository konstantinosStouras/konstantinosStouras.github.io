/* ==========================================================================
   Answer Arena — analytics template PARITY harness
       node lab/answerarena/tools/templates-parity.mjs

   templates-guard.mjs reads the two bundled scripts and checks they are BUILT
   the same way. This one goes further and RUNS them — the check that guard's
   header used to say had to stay manual, because it needs a Python and an R
   that this repo does not carry.

   It extracts DA_PY_TEMPLATE and DA_R_TEMPLATE from admin.js exactly as the page
   hands them to Pyodide / WebR, feeds both the same synthetic exports, and
   compares what they print: the four task-id lists, every cell of every printed
   table (numerically, with a tolerance, since pandas and print.data.frame lay a
   table out differently) and every INSIGHTS bullet. It also checks the exact
   test itself against BRUTE FORCE — enumerating all 2^m sign patterns — because
   the whole reason that test was chosen is that it needs no approximation, and
   a convolution is exactly the kind of code that is subtly wrong in silence.

   Each fixture is here because it once found a real defect: a table with only
   choices and no grades, one with only grades, leading-zero student ids and
   numeric-looking task ids (pandas types them, R does not), a TRUE/FALSE
   submitted column, a fractional score, a strength slider left at 0, the case
   where the vote margin and the score total point OPPOSITE ways, the wrong
   sheet entirely, and an empty table.

   It SKIPS itself with a message when python3 (with numpy/pandas/matplotlib) or
   Rscript is missing, which is the normal case on a laptop and in this repo's
   CI — the same convention page-test.mjs uses for Playwright. Nothing here runs
   on a push; it is for whoever next changes the templates.
   ========================================================================== */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };
const has = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0; } catch { return false; } };

const PY = 'python3', R = 'Rscript';
if (!has(PY, ['-c', 'import numpy, pandas, matplotlib'])) {
  console.log('SKIP — python3 with numpy/pandas/matplotlib is not installed.');
  console.log('       (pip install numpy pandas matplotlib, then re-run.)');
  process.exit(0);
}
if (!has(R, ['--vanilla', '-e', 'invisible(1)'])) {
  console.log('SKIP — Rscript is not installed. (apt-get install r-base-core, then re-run.)');
  process.exit(0);
}

/* ---- the two scripts, exactly as the page hands them to the runtimes ----- */
const src = await readFile(resolve(HERE, '..', 'admin.js'), 'utf8');
function template(name) {
  const start = src.indexOf('var ' + name + ' = [');
  const open = src.indexOf('[', start);
  const end = src.indexOf("\n  ].join('\\n');", open);
  if (start < 0 || end < 0) throw new Error('template not found: ' + name);
  return Function('return (' + src.slice(open, end + 4) + ')')().join('\n');
}
const dir = await mkdtemp(join(tmpdir(), 'aa-parity-'));
await writeFile(join(dir, 'analysis.py'), template('DA_PY_TEMPLATE') + '\n');
await writeFile(join(dir, 'analysis.R'), template('DA_R_TEMPLATE') + '\n');

/* ---- fixtures ----------------------------------------------------------- */
const COLS = ['account_id', 'task_id', 'chosen_model', 'preference_model', 'submitted'];
const side = (p) => (p === 0 ? 'tie' : p > 0 ? 'frontier' : 'baseline');
const row = (a, t, p, extra = {}) => ({ account_id: a, task_id: t, chosen_model: side(p), preference_model: p, submitted: 'yes', ...extra });
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// A tiny deterministic PRNG — a fixture that moved between runs would make a
// parity failure impossible to reproduce.
let seed = 20260828;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const realistic = [];
{
  const TASKS = rep(12, (i) => 'T' + String(i * 7 + 1).padStart(3, '0'));
  const truth = Object.fromEntries(TASKS.map((t) => [t, pick([-1.6, -1, -0.4, 0, 0, 0.4, 1, 1.7])]));
  for (let s = 0; s < 30; s++) {
    for (const t of TASKS.filter(() => rnd() < 0.5)) {
      const v = truth[t] + (rnd() + rnd() + rnd() - 1.5) * 1.6;
      realistic.push(row('a' + s, t, Math.max(-3, Math.min(3, Math.round(v)))));
    }
  }
}
const FIXTURES = {
  realistic,
  // every degenerate shape the exact test has to swallow without a convention
  edges: [...rep(1, () => row('e0', 'E_N1', 3)), ...rep(2, (i) => row('e' + i, 'E_N2_TIGHT', 2)),
    ...rep(12, (i) => row('f' + i, 'E_ALLZERO', 0)), ...rep(12, (i) => row('g' + i, 'E_ALLPLUS2', 2)),
    ...rep(9, (i) => row('h' + i, 'E_ALLMINUS3', -3)), ...rep(5, (i) => row('i' + i, 'E_UNREACHABLE', 2)),
    ...rep(6, (i) => row('j' + i, 'E_EDGE95', 1)), ...rep(8, (i) => row('k' + i, 'E_EDGE99', 1)),
    ...rep(10, (i) => row('l' + i, 'E_SPLIT', [3, -3, 3, -3, 2, -2, 3, -3, 0, 0][i]))],
  // the vote margin and the score total point OPPOSITE ways
  crossing: [...rep(17, (i) => row('c' + i, 'T004', 1)), ...rep(6, (i) => row('d' + i, 'T004', -3))],
  // a table carrying only choices, and one carrying only grades
  choiceOnly: realistic.map((r) => ({ ...r, preference_model: '' })),
  gradedOnly: realistic.map((r) => ({ ...r, chosen_model: '' })),
  // pandas types these and R does not: "0012" vs "12", "07" vs "7"
  ids: [...rep(14, (i) => row('00' + String(i).padStart(2, '0'), '07', 1)),
    ...rep(14, (i) => row(String(i), '7', -1))],
  // a spreadsheet writing the flag as a boolean would make EVERY row a draft
  boolSubmitted: [...rep(8, (i) => row('b' + i, 'T001', 2, { submitted: 'TRUE' })),
    ...rep(5, (i) => row('n' + i, 'T001', -3, { submitted: 'FALSE' }))],
  // a re-scaled export, an out-of-range value and text
  badScores: [...rep(7, (i) => row('s' + i, 'T002', 1)),
    { account_id: 'x1', task_id: 'T002', chosen_model: 'frontier', preference_model: '1.5', submitted: 'yes' },
    { account_id: 'x2', task_id: 'T002', chosen_model: 'frontier', preference_model: '10', submitted: 'yes' },
    { account_id: 'x3', task_id: 'T002', chosen_model: 'frontier', preference_model: 'abc', submitted: 'yes' }],
  // a winner tapped with the strength bar left where it started
  sliderAtZero: [...rep(15, (i) => ({ ...row('z' + i, 'T003', 0), chosen_model: 'frontier' })),
    ...rep(5, (i) => row('y' + i, 'T003', 2))],
  // the wrong sheet, and nothing at all
  wrongSheet: rep(20, (i) => ({ ts: '2026-01-0' + (i % 9 + 1), event: 'open', who: 'a' + i })),
  empty: [],
};
const csv = (rows) => {
  const cols = rows.length ? Object.keys(rows[0]) : COLS;
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => String(r[c] ?? '')).join(','))).join('\n') + '\n';
};

/* ---- run one fixture through both languages ----------------------------- */
await writeFile(join(dir, 'runpy.py'), `import sys, os
os.environ.setdefault("MPLBACKEND", "Agg")
import matplotlib; matplotlib.use("Agg", force=True)
exec(compile(open(sys.argv[2]).read(), "analysis.py", "exec"),
     {"__name__": "__main__", "DATA_CSV": open(sys.argv[1]).read()})
`);
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
};

/* ---- compare what the two printed --------------------------------------- */
const NA = new Set(['nan', 'na', 'NaN', 'NA', '<NA>', 'None', '-']);
const num = (t) => (Number.isNaN(Number(t)) ? null : Number(t));
const sameCell = (a, b) => {
  if (a === b || (NA.has(a) && NA.has(b))) return true;
  const [x, y] = [num(a), num(b)];
  return x !== null && y !== null && Math.abs(x - y) <= 1e-3 * Math.max(1, Math.abs(x), Math.abs(y));
};
function tables(txt) {
  const out = [], lines = txt.split('\n');
  lines.forEach((l, i) => {
    const h = l.trim().split(/\s+/);
    if (h[0] !== 'task_id') return;
    const rows = {};
    for (const m of lines.slice(i + 1)) {
      const t = m.trim().split(/\s+/);
      if (!m.trim() || t.length !== h.length) break;
      rows[t[0]] = t.slice(1);
    }
    out.push([h, rows]);
  });
  return out;
}
const lists = (t) => (t.match(/^\s+TASK IDS: .*$/gm) || []).map((s) => s.trim());
const insights = (t) => {
  const i = t.indexOf('\nINSIGHTS');
  return i < 0 ? [] : t.slice(i).split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.replace(/\s+/g, ' ').trim());
};
const header = (t) => (t.match(/^Responses:.*$/m) || []);

console.log('Running both bundled scripts over ' + Object.keys(FIXTURES).length + ' synthetic exports:\n');
for (const [name, rows] of Object.entries(FIXTURES)) {
  // WebR MOUNTS the chosen table at /tmp/data.csv and the R template reads that
  // absolute path, so the harness has to put the fixture exactly there - writing
  // it beside the script would leave R reading whatever ran last.
  await writeFile(join(dir, 'data.csv'), csv(rows));
  await writeFile('/tmp/data.csv', csv(rows));
  const py = run(PY, ['runpy.py', 'data.csv', 'analysis.py']);
  const r = run(R, ['--vanilla', 'analysis.R']);
  ok(py.status === 0, name + ': the Python script runs' + (py.status ? '\n' + py.out.slice(-700) : ''));
  ok(r.status === 0, name + ': the R script runs' + (r.status ? '\n' + r.out.slice(-700) : ''));
  if (py.status || r.status) continue;
  for (const [what, fn] of [['header line', header], ['task-id lists', lists], ['INSIGHTS bullets', insights]]) {
    const [a, b] = [fn(py.out), fn(r.out)];
    const same = a.length === b.length && a.every((x, i) => x === b[i]);
    ok(same, name + ': the same ' + what + ' (' + a.length + ')');
    if (!same) a.forEach((x, i) => { if (x !== b[i]) console.log('       py: ' + x + '\n        r: ' + (b[i] || '<missing>')); });
  }
  const [ta, tb] = [tables(py.out), tables(r.out)];
  let good = ta.length === tb.length;
  for (let k = 0; k < ta.length && good; k++) {
    const [ha, ra] = ta[k], [hb, rb] = tb[k];
    good = ha.join() === hb.join() && Object.keys(ra).join() === Object.keys(rb).join()
      && Object.keys(ra).every((t) => ra[t].every((v, c) => sameCell(v, rb[t][c])));
    if (!good) console.log('       table ' + k + ': ' + ha.join(' ') + '  vs  ' + hb.join(' '));
  }
  ok(good, name + ': every printed table agrees, cell by cell (' + ta.length + ' tables)');
}

/* ---- the exact test against brute force --------------------------------- */
console.log('\nChecking the exact test against brute-force enumeration:\n');
await writeFile(join(dir, 'brute.py'), `
import itertools, random, numpy as np
src = open("analysis.py").read()
ns = {}
exec("import numpy as np\\n" + src[src.index("def signflip_p"):src.index("def min_responses_for")], ns)
sf = ns["signflip_p"]
def brute(vals, vo):
    mag = [1 if vo else abs(x) for x in vals if x != 0]
    tot = sum(np.sign(vals)) if vo else sum(vals)
    if not mag: return 1.0
    hit = sum(1 for s in itertools.product((-1, 1), repeat=len(mag))
              if abs(sum(a * b for a, b in zip(s, mag))) >= abs(tot) - 1e-9)
    return hit / 2 ** len(mag)
rnd = random.Random(11)
cases = [[], [0] * 5, [3], [2, 2], [1] * 6, [1] * 9 + [-3], [3, -3, 2, -2], [-1] * 8, [2] * 12]
cases += [[rnd.randint(-3, 3) for _ in range(rnd.randint(1, 13))] for _ in range(200)]
bad, out = 0, []
for c in cases:
    for vo in (False, True):
        p = sf(c, votes_only=vo)[0]
        if abs(p - brute(c, vo)) > 1e-12: bad += 1
        out.append("%s|%d|%.17g" % (",".join(map(str, c)), int(vo), p))
open("cases.txt", "w").write("\\n".join(out) + "\\n")
print("RESULT %d %d" % (len(cases), bad))
`);
const bres = run(PY, ['brute.py']);
const grab = (out, n) => (out.match(/^RESULT (.+)$/m) || ['', ''])[1].split(' ').map(Number).concat(Array(n).fill(NaN)).slice(0, n);
const [ncases, nbad] = grab(bres.out, 2);
ok(bres.status === 0 && nbad === 0,
  'the Python engine matches brute force on ' + ncases + ' samples x both weightings'
  + (nbad ? ' (' + nbad + ' mismatches)' : ''));

await writeFile(join(dir, 'rchk.R'), `
src <- readLines("analysis.R")
i <- grep("^signflip_p <- function", src)[1]; j <- grep("^}$", src); j <- j[j > i][1]
eval(parse(text = paste(src[i:j], collapse = "\\n")))
bad <- 0
for (ln in readLines("cases.txt")) {
  p <- strsplit(ln, "|", fixed = TRUE)[[1]]
  v <- if (nchar(p[1])) as.numeric(strsplit(p[1], ",")[[1]]) else numeric(0)
  got <- signflip_p(v, votes_only = as.integer(p[2]) == 1)$p
  if (!isTRUE(all.equal(got, as.numeric(p[3]), tolerance = 0))) bad <- bad + 1
}
cat("RESULT", bad, "\\n")
`);
const rres = run(R, ['--vanilla', 'rchk.R']);
const [rbad] = grab(rres.out, 1);
ok(rres.status === 0 && rbad === 0,
  'the R engine returns BITWISE the same p as Python on all ' + (ncases * 2) + ' of them'
  + (rbad ? ' (' + rbad + ' differ)' : ''));

await rm(dir, { recursive: true, force: true });
console.log(fails
  ? `\nARENA TEMPLATES PARITY FAILED (${fails})`
  : '\nARENA TEMPLATES PARITY OK — the bundled Python and R scripts give the same answer, and the exact test is exact');
process.exit(fails ? 1 : 0);
