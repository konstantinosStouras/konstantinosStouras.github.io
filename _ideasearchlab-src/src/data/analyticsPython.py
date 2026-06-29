"""
================================================================================
Effects of AI Timing on Idea Generation (AsPredicted #298152) — PYTHON ANALYSIS
================================================================================

WHAT THIS SCRIPT PRODUCES
  Four regression tables, laid out exactly like Tables 3–6 of Boussioux, Lane,
  Zhang, Jacimovic & Lakhani (2024), "The Crowdless Future? Generative AI and
  Creative Problem Solving" (Organization Science), but adapted to THIS study's
  three KPIs and four conditions (baseline = None / no AI):

    Table 3  KPI ratings        ~  Any AI            (one AI dummy vs None)
    Table 4  KPI ratings        ~  Solo + Group + Both (each vs None)
    Table 5  Top-rated (== 5)   ~  Any AI            (linear probability model)
    Table 6  Top-rated (== 5)   ~  Solo + Group + Both (linear probability model)

  Tables 3/4 are OLS on the 1–5 KPI score; Tables 5/6 are linear-probability
  models on a binary "did this idea earn the top rating (5/5)?" — the same split
  the paper uses (its Table 3/4 = average ratings, Table 5/6 = top ratings).
  Each table reports, per KPI column: the coefficient with significance stars,
  its standard error in parentheses, the intercept, N, the number of groups and
  sessions, whether controls are included, and the model R² / log-likelihood —
  mirroring the paper's footer rows. After the tables it prints the planned
  AI-timing contrast (Solo − Group), an INSIGHTS read-out, and two plots, then a
  compact machine-readable copy of the tables (between BEGIN/END markers) that
  the page turns into the formatted "Insights" tables and the LaTeX/PDF export.

UNIT OF ANALYSIS & UNBALANCED DESIGN (read this)
  The rows are the FINAL ideas — each group's top-voted ideas (Final Group Pick
  = 1). The four conditions have DIFFERENT numbers of these (the design is
  UNBALANCED) and may have unequal variances, so every model is fitted with HC3
  heteroscedasticity-robust standard errors: the point estimates are unchanged by
  unequal n, but the SEs / t / p-values stay valid. Per-condition n is printed up
  front, and any condition with NO data (or a "top" outcome with no variation) is
  detected and skipped rather than forced into a singular regression.

WHERE THE DATA COMES FROM (read this)
  The data is the SCORED DATASET built in the previous step of the page — the
  exact rows behind "Download CSV" / "Download Excel". It is handed to this
  script as the global string `DATA_CSV` (one row per idea). Columns:
      idea_id, session, condition, phase, group_id, author_id,
      novelty, usefulness, overall_quality, final_pick, text
  `condition` is the Set A / placement encoding — None / Solo / Group / Both.
  Rows with a missing KPI score are dropped before fitting. Edit anything below
  freely, then press Run.
"""

# ── Imports ───────────────────────────────────────────────────────────────────
import io          # wrap the DATA_CSV string in a file-like object for pandas
import sys         # print a fatal message to stderr if the data global is absent
import warnings    # non-fatal problems are warned about, never raised, so a small
                   # or degenerate dataset never aborts the whole run

import numpy as np                 # numeric arrays + contrast vectors
import pandas as pd                # the data frame, group means, pretty tables
import matplotlib                  # plotting; force a headless backend BEFORE pyplot
matplotlib.use("Agg")              # "Agg" renders to an in-memory PNG (no display);
import matplotlib.pyplot as plt    # the page harvests open figures after the run

import statsmodels.formula.api as smf                 # ols() formula interface
from scipy import stats as spstats                    # t-distribution for plot CIs


# ── Configuration ─────────────────────────────────────────────────────────────
# CONDITION ENCODING (Set A / "placement"). The `condition` column holds these
# short codes; "None" (no AI) is the regression REFERENCE, so every coefficient
# reads as "this condition − None".
#     None  = Human-Only Hybrid  (AI in neither stage)   <- reference / baseline
#     Solo  = Individual + AI     (AI in solo stage only)
#     Group = Group + AI          (AI in group stage only)
#     Both  = Full AI             (AI in both stages)
REFERENCE = "None"
CONDITION_ORDER = ["None", "Solo", "Group", "Both"]
CONDITION_PAPER = {
    "None": "Human-Only Hybrid (AI in neither stage)",
    "Solo": "Individual + AI (AI in solo stage only)",
    "Group": "Group + AI (AI in group stage only)",
    "Both": "Full AI (AI in both stages)",
}

# The three dependent variables (idea-creativity KPIs) and their display labels.
KPIS = ["novelty", "usefulness", "overall_quality"]
KPI_LABELS = {"novelty": "Novelty", "usefulness": "Usefulness", "overall_quality": "Quality"}

# A "top" idea = one that earned the very top of the 1–5 rating scale (the paper's
# Table 5/6 "top rating (out of 5)"). >= is used so floating-point 5.0 always counts.
TOP_RATING = 5.0

# Optional controls (the analogs of the paper's "solution word count" + stage that
# are actually available at the idea level). OFF by default so Tables 3–6 report
# the raw condition comparisons (consistent with the Insights read-out and the
# paper's no-controls Appendix D). Flip to True to add them — the size guard below
# still drops a control if it has no variation or would leave too few residual df.
USE_CONTROLS = False
MIN_RESID_DF_FOR_CONTROLS = 8   # need at least this many residual df to add controls

# A condition must have at least this many ideas to enter a regression: with only
# one observation a dummy's HC3 standard error is undefined (its leverage is 1),
# and with no observations in the reference (None) the "vs None" coefficients are
# not identified. Smaller conditions are still reported in the size table, but are
# dropped from the models (shown as "—") — this is the per-condition size check.
MIN_CELL = 2

# The pre-registered contrast of interest: it isolates AI *timing* — solo-stage AI
# (Solo) vs group-stage AI (Group), holding the no-AI baseline constant.
PRIMARY_CONTRAST = ("Solo", "Group")

pd.set_option("display.width", 160)        # wide console so tables don't wrap
pd.set_option("display.max_columns", 40)


# ── Small formatting helpers ──────────────────────────────────────────────────
def stars(p):
    """Conventional significance stars for a p-value (blank if NaN / n.s.)."""
    if p is None or (isinstance(p, float) and np.isnan(p)):
        return ""
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    if p < 0.10:
        return "."
    return ""


def fmt_est(est, p):
    """A coefficient cell: estimate to 3 dp with its significance stars."""
    return f"{est:.3f}{stars(p)}"


def fmt_se(se):
    """A standard-error cell: the SE in parentheses, to 3 dp."""
    return f"({se:.3f})"


# Sentinel for a cell that cannot be estimated (absent / too-small condition, or a
# constant "top" outcome). Plain ASCII so the text tables align in any locale; the
# page renders it as a real em dash "—" in the formatted Insights / LaTeX tables.
DASH = "n/a"


def _s(x):
    """First element of a statsmodels result array as a plain float.

    Recent NumPy (the build inside Pyodide) refuses float() on a non-0-D array,
    and t_test().effect / .sd can come back 2-D — so flatten with np.ravel,
    take [0], then convert. Avoids the "only 0-dimensional arrays …" TypeError.
    """
    return float(np.ravel(np.asarray(x))[0])


# ── 1. Load + clean + derive the analysis columns ─────────────────────────────
def load_data():
    """Parse the injected DATA_CSV global (the scored dataset from step 3)."""
    if "DATA_CSV" not in globals():
        print("ERROR: global variable DATA_CSV is not defined.", file=sys.stderr)
        sys.exit(1)
    # keep_default_na=False so the condition code "None" is NOT read as NaN
    # (pandas would otherwise treat the string "None" as missing).
    return pd.read_csv(io.StringIO(DATA_CSV), keep_default_na=False)


def prepare(df):
    """Validate columns, coerce types, drop unscored rows, and add the derived
    columns the four tables need (word count, the AI dummies, the top-rating
    binaries). Returns the cleaned frame."""
    n0 = len(df)

    # Fail fast if a structural column is missing.
    for col in ["condition"] + KPIS:
        if col not in df.columns:
            print(f"ERROR: required column '{col}' missing from data.", file=sys.stderr)
            sys.exit(1)

    # KPI columns may arrive as strings (blank cells) — coerce to numeric so any
    # blank/non-numeric value becomes NaN and is dropped below.
    for k in KPIS:
        df[k] = pd.to_numeric(df[k], errors="coerce")

    # Drop rows whose condition label is not one of the four we know about.
    unknown = set(df["condition"].dropna().unique()) - set(CONDITION_ORDER)
    if unknown:
        warnings.warn(f"Dropping rows with unrecognised condition(s): {sorted(unknown)}")
        df = df[df["condition"].isin(CONDITION_ORDER)].copy()

    # Listwise-drop rows missing ANY KPI so all models share one clean sample.
    before = len(df)
    df = df.dropna(subset=KPIS).copy()
    dropped = before - len(df)
    if dropped:
        print(f"NOTE: dropped {dropped} row(s) with missing KPI value(s).")
    print(f"NOTE: rows in: {n0}; rows used for analysis: {len(df)}.\n")
    if df.empty:
        return df

    # ── Derived columns ───────────────────────────────────────────────────────
    # AI-presence dummy (Table 3/5): 1 for any AI condition, 0 for None.
    df["ai"] = (df["condition"] != REFERENCE).astype(int)
    # One 0/1 dummy per non-reference condition (Table 4/6). An absent condition's
    # column is therefore all-zeros and is detected + skipped when building the RHS.
    df["solo"] = (df["condition"] == "Solo").astype(int)
    df["group"] = (df["condition"] == "Group").astype(int)
    df["both"] = (df["condition"] == "Both").astype(int)
    # Stage control: 1 if the idea came from the group stage, 0 if solo/individual.
    phase = df.get("phase", pd.Series([""] * len(df), index=df.index)).astype(str).str.lower()
    df["stage_group"] = phase.str.contains("group").astype(int)
    # Word-count control: number of whitespace-separated tokens in the idea text.
    text = df.get("text", pd.Series([""] * len(df), index=df.index)).astype(str)
    df["word_count"] = text.str.split().apply(len)
    # Top-rating binaries (Table 5/6): 1 if the KPI hit the top of the scale.
    for k in KPIS:
        df[f"top_{k}"] = (df[k] >= TOP_RATING).astype(int)

    # Order the condition factor with the reference level first (used by the
    # means model / plots), keeping only the levels actually present.
    present = [c for c in CONDITION_ORDER if c in df["condition"].unique()]
    df["condition"] = pd.Categorical(df["condition"], categories=present, ordered=True)
    return df


def control_terms(df):
    """The control terms to add to every model in a table, after the size guard:
    word count and the stage dummy — but only when USE_CONTROLS is on, the column
    varies, and there are enough rows. Returns a (possibly empty) list of names."""
    if not USE_CONTROLS:
        return []
    terms = []
    if df["word_count"].nunique() > 1:
        terms.append("word_count")
    if df["stage_group"].nunique() > 1:
        terms.append("stage_group")
    # The largest model is 3 condition dummies + intercept + these controls; require
    # enough residual df, else drop the controls entirely (keep estimates stable).
    if terms and (len(df) - (4 + len(terms))) < MIN_RESID_DF_FOR_CONTROLS:
        warnings.warn("Too few rows for controls; fitting without them.")
        return []
    return terms


# ── 2. Fit one OLS / LPM per dependent variable ───────────────────────────────
def fit_one(df, dv, treatment_terms, controls):
    """Fit `dv ~ treatment_terms (+ controls)` with HC3-robust SEs. Returns the
    fitted model, or None if it cannot be estimated (no treatment variation, a
    constant outcome, too few rows, or a degenerate fit)."""
    if not treatment_terms:
        return None
    if df[dv].nunique() < 2:                      # constant outcome (e.g. no "top" idea)
        return None
    rhs = " + ".join(treatment_terms + controls)
    n_params = 1 + len(treatment_terms) + len(controls)   # +1 for the intercept
    if len(df) - n_params < 2:                     # need ≥2 residual df for stable robust SEs
        return None
    try:
        return smf.ols(f"{dv} ~ {rhs}", data=df).fit(cov_type="HC3")
    except Exception as exc:                       # never let a degenerate fit abort
        warnings.warn(f"[{dv}] OLS failed: {exc}")
        return None


def cell(model, term):
    """(estimate, se, p) for one coefficient of a model, or None if it is absent
    (term dropped because its condition had no data) or non-finite (degenerate fit).
    Uses _s() so the extraction is safe on Pyodide's NumPy, and returning None for a
    non-finite estimate/SE keeps a stray 'nan' out of the machine-readable grammar."""
    if model is None or term not in model.params.index:
        return None
    est, se, p = _s(model.params[term]), _s(model.bse[term]), _s(model.pvalues[term])
    if not (np.isfinite(est) and np.isfinite(se)):
        return None
    return est, se, p


# ── Which condition dummies are large enough to enter the models ───────────────
def reference_ok(df):
    """True when the baseline None has enough ideas to identify "vs None"
    coefficients (otherwise every Table 3–6 coefficient is unestimable)."""
    return int((df["condition"] == REFERENCE).sum()) >= MIN_CELL


def split_terms(df):
    """The non-reference condition dummies (Solo/Group/Both) with enough ideas to
    estimate — empty if the None baseline itself is too small."""
    if not reference_ok(df):
        return []
    return [c for c in ["solo", "group", "both"] if int(df[c].sum()) >= MIN_CELL]


def collapsed_term(df):
    """The single Any-AI dummy, included only when both None and the pooled AI
    side have enough ideas — empty otherwise."""
    if not reference_ok(df):
        return []
    return ["ai"] if int((df["condition"] != REFERENCE).sum()) >= MIN_CELL else []


# ── 3. Build one table (the shared shape behind Tables 3–6) ────────────────────
def build_table(df, num, title, sub, dv_list, dv_labels, split, controls):
    """Assemble one regression table as a dict the printer + machine-emitter use.

    df         cleaned analysis frame (with the derived dummy columns)
    num        table number (3–6), only for the heading
    title      table title (paper style)
    sub        one-line description of the independent variable(s)
    dv_list    the dependent-variable column names (one per output column)
    dv_labels  human labels for those columns
    split      False -> single 'Any AI' dummy (Tables 3/5);
               True  -> one dummy per present condition vs None (Tables 4/6)
    controls   control terms to include in every model (display "Controls: Yes/No")
    """
    # Independent variables (the rows shown), in fixed display order, each as a
    # (column-name-in-df, row-label) pair. Absent / too-small conditions still get
    # a row, shown as "—", so the layout always matches the paper.
    if split:
        rows = [(c.lower(), f"{c} (vs {REFERENCE})") for c in ["Solo", "Group", "Both"]]
    else:
        rows = [("ai", f"Any AI (vs {REFERENCE})")]

    # Only put a treatment term in the model if its condition is large enough AND
    # the None baseline exists (per-condition size check; see split_terms above).
    treatment_terms = split_terms(df) if split else collapsed_term(df)

    # Fit every DV on the same RHS so a table's columns share one specification.
    models = {dv: fit_one(df, dv, treatment_terms, controls) for dv in dv_list}

    coef_rows = []
    for name, label in rows:                       # one block per independent variable
        ests, ses = [], []
        for dv in dv_list:
            c = cell(models[dv], name)
            ests.append(fmt_est(c[0], c[2]) if c else DASH)
            ses.append(fmt_se(c[1]) if c else "")
        coef_rows.append({"label": label, "est": ests, "se": ses})
    # Intercept row (= baseline mean when no controls).
    inter_est, inter_se = [], []
    for dv in dv_list:
        c = cell(models[dv], "Intercept")
        inter_est.append(fmt_est(c[0], c[2]) if c else DASH)
        inter_se.append(fmt_se(c[1]) if c else "")
    coef_rows.append({"label": f"Intercept ({REFERENCE})", "est": inter_est, "se": inter_se})

    # Footer statistics (mirroring the paper's N / blocks / evaluators / controls /
    # fit rows). "Number of groups/sessions" are descriptive counts of the nesting.
    def stat(fn):
        out = []
        for dv in dv_list:
            m = models[dv]
            out.append(fn(m) if m is not None else DASH)
        return out

    n_groups = df["group_id"].nunique() if "group_id" in df.columns else 0
    n_sessions = df["session"].nunique() if "session" in df.columns else 0
    ctrl_label = "Yes" if controls else "No"
    stat_rows = [
        {"label": "N (ideas)", "cells": stat(lambda m: str(int(m.nobs)))},
        {"label": "Number of groups", "cells": stat(lambda m: str(n_groups))},
        {"label": "Number of sessions", "cells": stat(lambda m: str(n_sessions))},
        {"label": "Controls", "cells": stat(lambda m: ctrl_label)},
        {"label": "R-squared", "cells": stat(lambda m: f"{m.rsquared:.3f}" if np.isfinite(m.rsquared) else DASH)},
        {"label": "Log-likelihood", "cells": stat(lambda m: f"{m.llf:.1f}" if np.isfinite(m.llf) else DASH)},
    ]

    note = ("Standard errors (HC3 heteroscedasticity-robust) in parentheses. "
            "Reference category = None (no AI). "
            ". p<.10  * p<.05  ** p<.01  *** p<.001.")
    # If nothing was estimable, say why up front (the user's size check).
    if not treatment_terms:
        reason = (f"Baseline None has < {MIN_CELL} ideas" if not reference_ok(df)
                  else f"no AI condition has >= {MIN_CELL} ideas")
        note = f"NOT ESTIMABLE: {reason}; this model needs the None baseline plus an AI condition. " + note
    return {
        "num": num, "title": title, "sub": sub,
        "columns": [dv_labels[dv] for dv in dv_list],
        "coef_rows": coef_rows, "stat_rows": stat_rows, "note": note,
        "models": models,
    }


# ── 4. Print a table as aligned text (for the console + Appendix A) ────────────
def print_table(t):
    labels = [r["label"] for r in t["coef_rows"]] + [r["label"] for r in t["stat_rows"]]
    w0 = max([len(s) for s in labels] + [len("Variable")]) + 2          # label column width
    colw = max(14, max(len(c) for c in t["columns"]) + 2)               # data column width

    def line(label, cells):
        return label.ljust(w0) + "".join(str(c).rjust(colw) for c in cells)

    bar = "=" * (w0 + colw * len(t["columns"]))
    print(bar)
    print(f"TABLE {t['num']}.  {t['title']}")
    print(f"           {t['sub']}")
    print(bar)
    print(line("Variable", t["columns"]))
    print("-" * len(bar))
    for r in t["coef_rows"]:                       # estimate line, then its SE line
        print(line(r["label"], r["est"]))
        if any(s for s in r["se"]):
            print(line("", r["se"]))
    print("-" * len(bar))
    for r in t["stat_rows"]:
        print(line(r["label"], r["cells"]))
    print(bar)
    print(t["note"] + "\n")


# ── 5. Machine-readable copy of the tables (parsed by the page) ────────────────
# Emitted between BEGIN/END markers and stripped from the on-page console; the
# page turns it into the formatted "Insights" tables and the LaTeX / PDF export.
# Grammar (cells separated by "||"):
#   @@TABLE num=<n>||<title>||<sub>
#   @@HEAD Variable||<col1>||<col2>||...
#   @@COEF <label>||<est1>||<est2>||...      (a coefficient row)
#   @@SE   ||<se1>||<se2>||...               (its standard-error row)
#   @@RULE                                   (mid-rule before the footer stats)
#   @@STAT <label>||<c1>||<c2>||...          (a footer statistic row)
#   @@NOTE <table note>
#   @@ENDTABLE
def emit_machine(tables):
    print("===BEGIN REGRESSION TABLES===")
    for t in tables:
        print(f"@@TABLE num={t['num']}||{t['title']}||{t['sub']}")
        print("@@HEAD Variable||" + "||".join(t["columns"]))
        for r in t["coef_rows"]:
            print(f"@@COEF {r['label']}||" + "||".join(r["est"]))
            if any(s for s in r["se"]):
                print("@@SE ||" + "||".join(r["se"]))
        print("@@RULE")
        for r in t["stat_rows"]:
            print(f"@@STAT {r['label']}||" + "||".join(str(c) for c in r["cells"]))
        print(f"@@NOTE {t['note']}")
        print("@@ENDTABLE")
    print("===END REGRESSION TABLES===\n")


# ── 6. Primary planned contrast: Solo − Group (AI timing), across KPIs ─────────
def planned_contrast(model, kpi):
    """The AI-timing contrast (Solo − Group) for one KPI's split model. Both are
    coded vs the same reference, so the contrast = b_solo − b_group. Returns a
    dict, or None if either level is absent from the model."""
    if model is None:
        return None
    names = list(model.params.index)
    if "solo" not in names or "group" not in names:
        return None
    cvec = np.zeros(len(names))
    cvec[names.index("solo")] = 1.0
    cvec[names.index("group")] = -1.0
    res = model.t_test(cvec)
    est, sd = _s(res.effect), _s(res.sd)
    if not (np.isfinite(est) and np.isfinite(sd)):   # non-estimable contrast → skip
        return None
    return {"kpi": kpi, "estimate": est, "std_err": sd,
            "t": _s(res.tvalue), "p_value": _s(res.pvalue)}


# ── 7. Plots (use the no-controls condition means for interpretability) ────────
plt.rcParams.update({
    "font.size": 15, "axes.titlesize": 18, "axes.labelsize": 15,
    "xtick.labelsize": 14, "ytick.labelsize": 14, "figure.titlesize": 21,
})


def ci95_halfwidth(std, n):
    """95% CI half-width from the per-group t distribution. NaN for n<=1."""
    if n is None or n <= 1 or not np.isfinite(std):
        return np.nan
    return float(spstats.t.ppf(0.975, n - 1)) * std / np.sqrt(n)


def plot_means(df, present_levels):
    """FIGURE 1 — one bar chart per KPI: each condition's mean score with a 95%
    CI whisker (taller bar = rated higher; n shown under each bar)."""
    fig, axes = plt.subplots(1, len(KPIS), figsize=(6.6 * len(KPIS), 6.2), squeeze=False)
    axes = axes[0]
    colors = ["#4D4D4D", "#1F77B4", "#2CA02C", "#D62728"]
    for ax, kpi in zip(axes, KPIS):
        means, halfs, ns = [], [], []
        for lvl in present_levels:
            vals = df.loc[df["condition"] == lvl, kpi].dropna()
            ns.append(len(vals))
            if len(vals) == 0:
                means.append(np.nan); halfs.append(np.nan)
            else:
                means.append(vals.mean())
                halfs.append(ci95_halfwidth(vals.std(ddof=1), len(vals)))
        x = np.arange(len(present_levels))
        ax.bar(x, means, yerr=halfs, capsize=7, color=colors[:len(present_levels)],
               edgecolor="black", alpha=0.88)
        for xi, m in zip(x, means):
            if np.isfinite(m):
                ax.annotate(f"{m:.2f}", (xi, m), textcoords="offset points",
                            xytext=(0, 8), ha="center", fontsize=14, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels([f"{lvl}\n(n={n})" for lvl, n in zip(present_levels, ns)], fontsize=14)
        ax.set_title(f"Mean {KPI_LABELS[kpi]}", fontweight="bold")
        ax.set_ylabel(f"Mean {KPI_LABELS[kpi]} (1–5)"); ax.set_xlabel("Condition")
        ax.grid(axis="y", linestyle=":", alpha=0.5)
        finite = [m for m in means if np.isfinite(m)]
        if finite:
            ax.set_ylim(0, max(5.2, max(finite) * 1.18))
    fig.suptitle("Average score by condition (bars = mean, whiskers = 95% CI)", fontweight="bold", y=1.02)
    fig.tight_layout()
    print("Generated figure: average score per condition.")


def plot_forest(models):
    """FIGURE 2 — each AI condition's mean difference from the no-AI baseline
    (None), per KPI, with a 95% CI. Dot right of the dashed zero = higher than
    no-AI; red dot (CI excludes 0) = statistically significant."""
    non_ref = [l for l in CONDITION_ORDER if l != REFERENCE]
    fig, axes = plt.subplots(1, len(KPIS), figsize=(6.6 * len(KPIS), 5.4),
                             squeeze=False, sharey=True)
    axes = axes[0]
    term = {"Solo": "solo", "Group": "group", "Both": "both"}
    for ax, kpi in zip(axes, KPIS):
        model = models.get(kpi)
        ys, ests, los, his, labels, sig = [], [], [], [], [], []
        if model is not None:
            ci = model.conf_int(alpha=0.05)
            for i, lvl in enumerate(non_ref):
                t = term[lvl]
                if t in model.params.index:
                    ests.append(model.params[t])
                    lo, hi = ci.loc[t, 0], ci.loc[t, 1]
                    los.append(lo); his.append(hi)
                    ys.append(i); labels.append(lvl)
                    sig.append(not (lo <= 0 <= hi))
        if ys:
            ests = np.array(ests)
            err = np.vstack([ests - np.array(los), np.array(his) - ests])
            dot_colors = ["#D62728" if s else "#1F77B4" for s in sig]
            ax.errorbar(ests, ys, xerr=err, fmt="none", ecolor="#888888", elinewidth=2.5, capsize=6)
            ax.scatter(ests, ys, c=dot_colors, s=130, zorder=3, edgecolor="black")
            for xi, yi in zip(ests, ys):
                ax.annotate(f"{xi:+.2f}", (xi, yi), textcoords="offset points",
                            xytext=(0, 12), ha="center", fontsize=13, fontweight="bold")
            ax.set_yticks(ys); ax.set_yticklabels([f"{l} vs None" for l in labels], fontsize=15)
        ax.axvline(0.0, color="red", linestyle="--", linewidth=1.5)
        ax.set_title(f"{KPI_LABELS[kpi]}", fontweight="bold")
        ax.set_xlabel("Difference from no-AI (points on 1–5)")
        ax.grid(axis="x", linestyle=":", alpha=0.5)
        ax.invert_yaxis()
    fig.suptitle("Each AI condition vs the no-AI baseline (dot = mean difference, bar = 95% CI; red = significant)",
                 fontweight="bold", y=1.04)
    fig.tight_layout()
    print("Generated figure: condition effects vs baseline.")


# ── 8. Insights (plain-language read-out, drives the page's Insights panel) ────
def emm_for(model, level):
    """Estimated mean of one condition from the no-controls split model, or None
    if that condition is absent from the model."""
    if model is None:
        return None
    names = list(model.params.index)
    v = np.zeros(len(names))
    v[names.index("Intercept")] = 1.0           # intercept = reference (None) mean
    if level != REFERENCE:
        t = {"Solo": "solo", "Group": "group", "Both": "both"}[level]
        if t not in names:
            return None
        v[names.index(t)] = 1.0
    return _s(model.t_test(v).effect)


def insights(df, means_models):
    """Plain-language insights read straight off the (no-controls) split models —
    the same numbers as Table 4 with controls off. Keeps the exact wording the
    page's Insights panel + PDF already parse."""
    print("\n" + "#" * 78)
    print("# INSIGHTS  (read directly off the regression results above)")
    print("#" * 78)

    print("\nCondition encoding (Set A / placement):")
    for code in CONDITION_ORDER:
        print(f"    {code:<6} = {CONDITION_PAPER[code]}")

    present = [c for c in CONDITION_ORDER if (df["condition"] == c).any()]
    missing = [c for c in CONDITION_ORDER if c not in present]
    if missing:
        print(f"\nDATA-COVERAGE CHECK: NO data was collected for condition(s): {', '.join(missing)}.")
        print("  -> Excluded from every ranking and comparison below; no conclusion can")
        print("     be drawn about them until data for that condition is collected.")
    print(f"\nConditions with data ({len(present)} of 4): {', '.join(present)}.")

    ranking_by_kpi = {}
    term = {"Solo": "solo", "Group": "group", "Both": "both"}
    for kpi in KPIS:
        model = means_models.get(kpi)
        print("\n" + "-" * 78)
        print(f"KPI: {kpi}")
        print("-" * 78)
        if model is None:
            print("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.")
            ranking_by_kpi[kpi] = None
            continue

        means = {c: emm_for(model, c) for c in present}
        means = {c: m for c, m in means.items() if m is not None and np.isfinite(m)}
        ranked = sorted(means.items(), key=lambda kv: kv[1], reverse=True)
        ranking_by_kpi[kpi] = ranked

        print("  Ranking of conditions (best -> worst), by estimated mean:")
        for i, (c, m) in enumerate(ranked, 1):
            print(f"    {i}. {c:<18}  mean = {m:.3f}")

        print(f"  Versus the '{REFERENCE}' baseline:")
        any_sig = False
        for c in present:
            if c == REFERENCE:
                continue
            t = term[c]
            if t in model.params.index:
                b = _s(model.params[t]); p = _s(model.pvalues[t])
                direction = "higher" if b >= 0 else "lower"
                verdict = "significant" if p < 0.05 else "not significant"
                any_sig = any_sig or p < 0.05
                print(f"    - {c}: {abs(b):.2f} points {direction} (p = {p:.3f}, {verdict})")
        if not any_sig:
            print("    (no condition differs significantly from baseline on this KPI)")

        pc = planned_contrast(model, kpi)
        if pc is not None:
            winner = PRIMARY_CONTRAST[0] if pc["estimate"] >= 0 else PRIMARY_CONTRAST[1]
            how = "significantly" if pc["p_value"] < 0.05 else "but NOT significantly"
            print(f"  AI timing ({PRIMARY_CONTRAST[0]} vs {PRIMARY_CONTRAST[1]}): {winner} scores "
                  f"{abs(pc['estimate']):.2f} higher, {how} (p = {pc['p_value']:.3f}).")

        if ranked:
            print(f"  => Best on {kpi}: '{ranked[0][0]}'.  Worst: '{ranked[-1][0]}'.")

    print("\n" + "-" * 78)
    print("CONDITION RANKING PER KPI (best -> worst):")
    print("-" * 78)
    for kpi in KPIS:
        ranked = ranking_by_kpi.get(kpi)
        if not ranked:
            print(f"  {kpi:<16}: (not estimable)")
        else:
            print(f"  {kpi:<16}: " + "  >  ".join(f"{c} ({m:.2f})" for c, m in ranked))
    if missing:
        print(f"\n  Reminder: {', '.join(missing)} had NO data and is omitted from all of the above.")
    print()


# ── Main driver ───────────────────────────────────────────────────────────────
def main():
    df = prepare(load_data())
    if df.empty:
        print("WARNING: no usable rows after cleaning - nothing to analyse.")
        return

    present_levels = list(df["condition"].cat.categories)

    # Per-condition sample sizes — the design is UNBALANCED, so report n up front.
    print("=" * 78)
    print("FINAL-IDEA COUNT PER CONDITION (the unit of analysis; unbalanced design)")
    print("=" * 78)
    vc = df["condition"].value_counts()
    for lvl in CONDITION_ORDER:
        flag = "" if lvl in present_levels else "   <- NO DATA (skipped)"
        print(f"    {lvl:<6} n = {int(vc.get(lvl, 0))}{flag}")
    # How many ideas hit the top rating, per KPI (drives whether Tables 5/6 are
    # estimable — a "top" outcome with no variation cannot be regressed).
    print("\nTop-rated ideas (KPI == 5.0), per KPI:")
    for k in KPIS:
        print(f"    {KPI_LABELS[k]:<10} top = {int(df[f'top_{k}'].sum())} / {len(df)}")
    print(f"\nConditions with < {MIN_CELL} ideas (or an absent None baseline) are dropped from")
    print("the regressions and shown as '—' (no stable robust SE). All SEs / p-values use")
    print("HC3 heteroscedasticity-robust covariance (no equal-variance assumption).\n")

    controls = control_terms(df)
    top_kpis = [f"top_{k}" for k in KPIS]
    top_labels = {f"top_{k}": f"Top {KPI_LABELS[k]}" for k in KPIS}

    # ── The four tables (Tables 3–6, paper layout) ────────────────────────────
    tables = [
        build_table(
            df, 3, "Human-Only vs Any-AI - average KPI ratings",
            "OLS of each KPI score (1-5) on a single Any-AI dummy (reference = None).",
            KPIS, KPI_LABELS, split=False, controls=controls),
        build_table(
            df, 4, "Human-Only vs Solo / Group / Both - average KPI ratings",
            "OLS of each KPI score (1-5) on the condition dummies (reference = None).",
            KPIS, KPI_LABELS, split=True, controls=controls),
        build_table(
            df, 5, "Human-Only vs Any-AI - probability of a top (5/5) rating",
            "Linear-probability model of P(top rating) on a single Any-AI dummy (reference = None).",
            top_kpis, top_labels, split=False, controls=controls),
        build_table(
            df, 6, "Human-Only vs Solo / Group / Both - probability of a top (5/5) rating",
            "Linear-probability model of P(top rating) on the condition dummies (reference = None).",
            top_kpis, top_labels, split=True, controls=controls),
    ]
    for t in tables:
        print_table(t)

    # ── Primary planned contrast across KPIs (uses Table 4's split models) ─────
    print("=" * 78)
    print(f"PRIMARY PLANNED CONTRAST:  '{PRIMARY_CONTRAST[0]}'  -  '{PRIMARY_CONTRAST[1]}'   (AI timing)")
    print("=" * 78)
    split_level_models = tables[1]["models"]       # Table 4 = KPI ~ conditions
    contrasts = [c for c in (planned_contrast(split_level_models[k], k) for k in KPIS) if c]
    if contrasts:
        ctab = pd.DataFrame(contrasts)
        ctab["sig"] = ctab["p_value"].map(stars)
        with pd.option_context("display.float_format", lambda v: f"{v:9.4f}"):
            print(ctab.to_string(index=False))
        print("Signif. codes: *** p<.001  ** p<.01  * p<.05  . p<.10")
        print("Positive estimate => solo-stage AI (Solo) scores higher than group-stage AI (Group).")
    else:
        print("No KPI had both contrast levels present - contrast not computed.")
    print()

    # ── Insights + plots (use no-controls condition means for interpretability) ─
    # A dedicated set of no-controls split models so the insights/plots read as
    # raw condition mean differences (== Table 4 when USE_CONTROLS is off). Uses the
    # same per-condition size guard as the tables (split_terms).
    means_models = {k: fit_one(df, k, split_terms(df), []) for k in KPIS}
    insights(df, means_models)

    try:
        plot_means(df, present_levels)
    except Exception as exc:
        warnings.warn(f"Mean plot failed: {exc}")
    try:
        plot_forest(means_models)
    except Exception as exc:
        warnings.warn(f"Forest plot failed: {exc}")

    # Machine-readable copy LAST (after the figures' log lines), so the page can
    # rebuild the four tables for the Insights section and the LaTeX / PDF export.
    emit_machine(tables)
    print("Done.")


main()   # __name__ is "__main__" under Pyodide, so just run it
