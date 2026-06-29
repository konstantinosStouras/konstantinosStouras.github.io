"""
================================================================================
Effects of AI Timing on Idea Generation (AsPredicted #298152) — PYTHON ANALYSIS
================================================================================

WHAT THIS SCRIPT PRODUCES
  Four regression tables, laid out like Tables 3–6 of Boussioux, Lane, Zhang,
  Jacimovic & Lakhani (2024), "The Crowdless Future? Generative AI and Creative
  Problem Solving" (Organization Science), adapted to THIS study's conditions
  (baseline = None / no AI) and to EVERY KPI that has data — across all three
  sources scored on the page:
    • AI-generated (3.2):        novelty / usefulness / overall_quality   (1–5)
    • External evaluators (3.3): ext_novelty / ext_usefulness / ext_quality (1–5)
    • Deterministic/objective (3.1): det_novelty / det_distinctiveness / det_score (0–1)

  For each KPI the tables report one column, so you can compare conditions on
  every available measure side by side:
    Table 3  KPI level   ~  Any AI              (one AI dummy vs None)
    Table 4  KPI level   ~  Solo + Group + Both (each vs None)
    Table 5  Top rating  ~  Any AI              (linear probability model)
    Table 6  Top rating  ~  Solo + Group + Both (linear probability model)
  Tables 5/6 only apply to the 1–5 KPIs (a "top rating = 5/5" is meaningless on
  the 0–1 deterministic KPIs), so those columns are restricted accordingly.

  Each table column reports the coefficient (with stars) over its (standard error),
  the intercept, N, the number of groups and sessions, whether controls are used,
  and R² / log-likelihood — mirroring the paper's footer rows. After the tables it
  prints the planned AI-timing contrast (Solo − Group) per KPI, an INSIGHTS read-out,
  and plots, then a compact machine-readable copy of the tables (between BEGIN/END
  markers) that the page turns into the Section-6 tables and the LaTeX/PDF export.

UNIT OF ANALYSIS, UNBALANCED & PARTIAL-COVERAGE DESIGN (read this)
  Rows are the FINAL ideas (each group's top-voted ideas). Conditions have DIFFERENT
  n (unbalanced) and KPIs have DIFFERENT coverage (e.g. AI scored but not yet
  evaluator-rated). So each KPI's models are fitted on the rows that HAVE that KPI,
  with HC3 heteroscedasticity-robust SEs; a condition with < 2 ideas for a KPI — or
  an absent None baseline — is dropped from that KPI's model and shown as "n/a".

WHERE THE DATA COMES FROM
  The scored dataset from the page is handed in as the global string DATA_CSV (one
  row per idea). Columns: idea_id, session, condition, phase, group_id, author_id,
  the KPI columns listed above, final_pick, text. Edit anything below, then Run.
"""

# ── Imports ───────────────────────────────────────────────────────────────────
import io          # wrap the DATA_CSV string in a file-like object for pandas
import sys         # print a fatal message to stderr if the data global is absent
import math        # ceil() for the plot grid
import warnings    # non-fatal problems are warned about, never raised

import numpy as np                 # numeric arrays + contrast vectors
import pandas as pd                # the data frame, group means, pretty tables
import matplotlib                  # plotting; force a headless backend BEFORE pyplot
matplotlib.use("Agg")              # "Agg" renders to an in-memory PNG (no display);
import matplotlib.pyplot as plt    # the page harvests open figures after the run

import statsmodels.formula.api as smf                 # ols() formula interface
from scipy import stats as spstats                    # t-distribution for plot CIs


# ── Configuration ─────────────────────────────────────────────────────────────
# CONDITION ENCODING (Set A / "placement"). "None" (no AI) is the reference, so
# every coefficient reads "this condition − None".
REFERENCE = "None"
CONDITION_ORDER = ["None", "Solo", "Group", "Both"]
CONDITION_PAPER = {
    "None": "Human-Only Hybrid (AI in neither stage)",
    "Solo": "Individual + AI (AI in solo stage only)",
    "Group": "Group + AI (AI in group stage only)",
    "Both": "Full AI (AI in both stages)",
}

# KPI REGISTRY — every analysable KPI, its display label, and whether it lives on
# the 1–5 rating scale (so a "top rating = 5/5" binary is meaningful, Tables 5/6).
# Keep in sync with KPI_DEFS in analyticsData.js. The script analyses whichever of
# these columns are present in the data AND have at least one value.
KPI_DEFS = [
    ("novelty", "AI Novelty", True),
    ("usefulness", "AI Usefulness", True),
    ("overall_quality", "AI Quality", True),
    ("ext_novelty", "Eval Novelty", True),
    ("ext_usefulness", "Eval Usefulness", True),
    ("ext_quality", "Eval Quality", True),
    ("det_novelty", "Obj Novelty", False),
    ("det_distinctiveness", "Obj Distinct.", False),
    ("det_score", "Obj Score", False),
]

TOP_RATING = 5.0           # a "top" idea earned the top of the 1–5 scale (Tables 5/6)
USE_CONTROLS = False       # add word-count + stage controls? (size-guarded below)
MIN_RESID_DF_FOR_CONTROLS = 8
MIN_CELL = 2               # min ideas per condition (per KPI) to enter a model
PRIMARY_CONTRAST = ("Solo", "Group")   # AI-timing contrast (solo- vs group-stage AI)

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 60)


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
    """A coefficient cell: estimate to 3 dp with its significance stars. A value that
    rounds to zero is shown as a positive '0.000' (avoids a '-0.000' sign that can
    differ from R on floating-point noise)."""
    if round(est, 3) == 0:
        est = 0.0
    return f"{est:.3f}{stars(p)}"


def fmt_se(se):
    """A standard-error cell: the SE in parentheses, to 3 dp."""
    return f"({se:.3f})"


# Sentinel for a cell that cannot be estimated. Plain ASCII so the text tables align
# in any locale; the page renders it as a real em dash "—" in the formatted tables.
DASH = "n/a"


def _s(x):
    """First element of a statsmodels result array as a plain float (Pyodide-safe)."""
    return float(np.ravel(np.asarray(x))[0])


# ── 1. Load + clean + derive the analysis columns ─────────────────────────────
def load_data():
    if "DATA_CSV" not in globals():
        print("ERROR: global variable DATA_CSV is not defined.", file=sys.stderr)
        sys.exit(1)
    # keep_default_na=False so the condition code "None" is NOT read as NaN.
    return pd.read_csv(io.StringIO(DATA_CSV), keep_default_na=False)


def prepare(df):
    """Validate, coerce KPI types, add the derived columns (condition dummies, word
    count, stage, top-rating binaries). Rows are NOT globally dropped — each KPI's
    models drop only the rows missing THAT KPI (partial coverage across sources)."""
    n0 = len(df)
    if "condition" not in df.columns:
        print("ERROR: required column 'condition' missing from data.", file=sys.stderr)
        sys.exit(1)

    # Drop rows whose condition label is not one of the four we know about.
    unknown = set(df["condition"].dropna().unique()) - set(CONDITION_ORDER)
    if unknown:
        warnings.warn(f"Dropping rows with unrecognised condition(s): {sorted(unknown)}")
        df = df[df["condition"].isin(CONDITION_ORDER)].copy()

    # Coerce every KPI column that exists to numeric (blank cells -> NaN).
    for key, _, _ in KPI_DEFS:
        if key in df.columns:
            df[key] = pd.to_numeric(df[key], errors="coerce")

    print(f"NOTE: rows in: {n0}; rows kept (known condition): {len(df)}.\n")
    if df.empty:
        return df

    # Condition dummies for the whole frame (always defined).
    df["ai"] = (df["condition"] != REFERENCE).astype(int)
    df["solo"] = (df["condition"] == "Solo").astype(int)
    df["group"] = (df["condition"] == "Group").astype(int)
    df["both"] = (df["condition"] == "Both").astype(int)
    phase = df.get("phase", pd.Series([""] * len(df), index=df.index)).astype(str).str.lower()
    df["stage_group"] = phase.str.contains("group").astype(int)
    text = df.get("text", pd.Series([""] * len(df), index=df.index)).astype(str)
    df["word_count"] = text.str.split().apply(len)

    # Top-rating binaries for the present 1–5 KPIs only — NaN where the KPI is missing
    # (so a missing score is never miscounted as "not top").
    for key, _, scale5 in KPI_DEFS:
        if scale5 and key in df.columns:
            df[f"top_{key}"] = np.where(df[key].notna(), (df[key] >= TOP_RATING).astype(float), np.nan)

    present = [c for c in CONDITION_ORDER if c in df["condition"].unique()]
    df["condition"] = pd.Categorical(df["condition"], categories=present, ordered=True)
    return df


def present_kpis(df):
    """KPI defs whose column exists AND has at least one non-NaN value."""
    return [(k, lab, s5) for (k, lab, s5) in KPI_DEFS if k in df.columns and df[k].notna().any()]


def control_terms(df):
    """Controls (word count + stage) when USE_CONTROLS, they vary, and df is big enough."""
    if not USE_CONTROLS:
        return []
    terms = []
    if df["word_count"].nunique() > 1:
        terms.append("word_count")
    if df["stage_group"].nunique() > 1:
        terms.append("stage_group")
    if terms and (len(df) - (4 + len(terms))) < MIN_RESID_DF_FOR_CONTROLS:
        warnings.warn("Too few rows for controls; fitting without them.")
        return []
    return terms


# ── Which condition dummies are large enough to enter a model (per subset) ──────
def reference_ok(sub):
    return int((sub["condition"] == REFERENCE).sum()) >= MIN_CELL


def split_terms(sub):
    if not reference_ok(sub):
        return []
    return [c for c in ["solo", "group", "both"] if int(sub[c].sum()) >= MIN_CELL]


def collapsed_term(sub):
    if not reference_ok(sub):
        return []
    return ["ai"] if int((sub["condition"] != REFERENCE).sum()) >= MIN_CELL else []


# ── 2. Fit one OLS / LPM ──────────────────────────────────────────────────────
def fit_one(sub, dv, treatment_terms, controls):
    """Fit `dv ~ treatment_terms (+ controls)` with HC3-robust SEs on `sub` (already
    restricted to rows that have this KPI). Returns the model or None."""
    if not treatment_terms or sub[dv].nunique() < 2:
        return None
    rhs = " + ".join(treatment_terms + controls)
    n_params = 1 + len(treatment_terms) + len(controls)
    if len(sub) - n_params < 2:
        return None
    try:
        return smf.ols(f"{dv} ~ {rhs}", data=sub).fit(cov_type="HC3")
    except Exception as exc:
        warnings.warn(f"[{dv}] OLS failed: {exc}")
        return None


def cell(model, term):
    """(estimate, se, p) for one coefficient, or None if absent / non-finite."""
    if model is None or term not in model.params.index:
        return None
    est, se, p = _s(model.params[term]), _s(model.bse[term]), _s(model.pvalues[term])
    # Drop non-finite OR numerically-degenerate (≈0) SEs — e.g. a perfectly-separated
    # LPM cell where the baseline has no events gives a ~1e-17 SE in one engine and
    # NaN in the other; treat both as not estimable so Python and R agree.
    if not (np.isfinite(est) and np.isfinite(se) and se > 1e-8):
        return None
    return est, se, p


# ── 3. Build one table (shared shape behind Tables 3–6) ────────────────────────
def build_table(df, num, title, sub_desc, dvs, split, controls):
    """dvs = list of (column, label). Each column is fitted on its own non-NaN subset
    (KPIs differ in coverage), so a table's columns can have different N."""
    if split:
        rows = [(c.lower(), f"{c} (vs {REFERENCE})") for c in ["Solo", "Group", "Both"]]
    else:
        rows = [("ai", f"Any AI (vs {REFERENCE})")]

    # Per-column: the KPI's row subset, its treatment terms, and the fitted model.
    fits = {}
    for dv, _ in dvs:
        s = df.dropna(subset=[dv])
        terms = split_terms(s) if split else collapsed_term(s)
        fits[dv] = (fit_one(s, dv, terms, controls), s, terms)

    def coef_block(term, label):
        ests, ses = [], []
        for dv, _ in dvs:
            c = cell(fits[dv][0], term)
            ests.append(fmt_est(c[0], c[2]) if c else DASH)
            ses.append(fmt_se(c[1]) if c else "")
        return {"label": label, "est": ests, "se": ses}

    coef_rows = [coef_block(name, label) for name, label in rows]
    coef_rows.append(coef_block("Intercept", f"Intercept ({REFERENCE})"))

    def stat(fn):
        out = []
        for dv, _ in dvs:
            model, s, _ = fits[dv]
            out.append(fn(model, s) if model is not None else DASH)
        return out

    ctrl_label = "Yes" if controls else "No"
    stat_rows = [
        {"label": "N (ideas)", "cells": stat(lambda m, s: str(int(m.nobs)))},
        {"label": "Number of groups", "cells": stat(lambda m, s: str(s["group_id"].nunique()) if "group_id" in s else "0")},
        {"label": "Number of sessions", "cells": stat(lambda m, s: str(s["session"].nunique()) if "session" in s else "0")},
        {"label": "Controls", "cells": stat(lambda m, s: ctrl_label)},
        {"label": "R-squared", "cells": stat(lambda m, s: f"{m.rsquared:.3f}" if np.isfinite(m.rsquared) else DASH)},
        {"label": "Log-likelihood", "cells": stat(lambda m, s: f"{m.llf:.1f}" if np.isfinite(m.llf) else DASH)},
    ]

    note = ("Standard errors (HC3 heteroscedasticity-robust) in parentheses. "
            "Reference category = None (no AI). . p<.10  * p<.05  ** p<.01  *** p<.001.")
    treatment_any = any(fits[dv][2] for dv, _ in dvs)
    if not treatment_any:
        note = ("NOT ESTIMABLE for any column: each needs the None baseline plus an AI "
                "condition with >= 2 ideas for that KPI. ") + note

    return {"num": num, "title": title, "sub": sub_desc,
            "columns": [lab for _, lab in dvs], "coef_rows": coef_rows,
            "stat_rows": stat_rows, "note": note, "fits": fits}


# ── 4. Print a table as aligned text ──────────────────────────────────────────
def print_table(t):
    labels = [r["label"] for r in t["coef_rows"]] + [r["label"] for r in t["stat_rows"]]
    w0 = max([len(s) for s in labels] + [len("Variable")]) + 2
    colw = max(13, max((len(c) for c in t["columns"]), default=10) + 2)

    def line(label, cells):
        return label.ljust(w0) + "".join(str(c).rjust(colw) for c in cells)

    bar = "=" * (w0 + colw * max(1, len(t["columns"])))
    print(bar)
    print(f"TABLE {t['num']}.  {t['title']}")
    print(f"           {t['sub']}")
    print(bar)
    print(line("Variable", t["columns"]))
    print("-" * len(bar))
    for r in t["coef_rows"]:
        print(line(r["label"], r["est"]))
        if any(s for s in r["se"]):
            print(line("", r["se"]))
    print("-" * len(bar))
    for r in t["stat_rows"]:
        print(line(r["label"], r["cells"]))
    print(bar)
    print(t["note"] + "\n")


# ── 5. Machine-readable copy of the tables (parsed by the page) ────────────────
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


# ── 6. Primary planned contrast: Solo − Group, per KPI ────────────────────────
def planned_contrast(model, label):
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
    if not (np.isfinite(est) and np.isfinite(sd) and sd > 1e-8):
        return None
    return {"kpi": label, "estimate": est, "std_err": sd, "t": _s(res.tvalue), "p_value": _s(res.pvalue)}


# ── 7. Plots (no-controls condition means, wrapped grid over present KPIs) ─────
plt.rcParams.update({
    "font.size": 14, "axes.titlesize": 16, "axes.labelsize": 13,
    "xtick.labelsize": 12, "ytick.labelsize": 12, "figure.titlesize": 19,
})


def ci95_halfwidth(std, n):
    if n is None or n <= 1 or not np.isfinite(std):
        return np.nan
    return float(spstats.t.ppf(0.975, n - 1)) * std / np.sqrt(n)


def _grid(n):
    ncols = min(3, max(1, n))
    nrows = max(1, math.ceil(n / ncols))
    return nrows, ncols


def plot_means(df, kpis, present_levels):
    """One bar chart per KPI: each condition's mean (95% CI), n under each bar."""
    nrows, ncols = _grid(len(kpis))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6.0 * ncols, 5.4 * nrows), squeeze=False)
    flat = [ax for row in axes for ax in row]
    colors = ["#4D4D4D", "#1F77B4", "#2CA02C", "#D62728"]
    for ax, (key, label, scale5) in zip(flat, kpis):
        means, halfs, ns = [], [], []
        for lvl in present_levels:
            vals = df.loc[df["condition"] == lvl, key].dropna()
            ns.append(len(vals))
            if len(vals) == 0:
                means.append(np.nan); halfs.append(np.nan)
            else:
                means.append(vals.mean()); halfs.append(ci95_halfwidth(vals.std(ddof=1), len(vals)))
        x = np.arange(len(present_levels))
        ax.bar(x, means, yerr=halfs, capsize=6, color=colors[:len(present_levels)], edgecolor="black", alpha=0.88)
        for xi, m in zip(x, means):
            if np.isfinite(m):
                ax.annotate(f"{m:.2f}", (xi, m), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=12, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels([f"{lvl}\n(n={n})" for lvl, n in zip(present_levels, ns)], fontsize=11)
        ax.set_title(f"Mean {label}", fontweight="bold")
        ax.set_ylabel(label); ax.set_xlabel("Condition")
        ax.grid(axis="y", linestyle=":", alpha=0.5)
        finite = [m for m in means if np.isfinite(m)]
        top = 5.2 if scale5 else 1.05
        if finite:
            ax.set_ylim(0, max(top, max(finite) * 1.18))
    for ax in flat[len(kpis):]:
        ax.axis("off")
    fig.suptitle("Average score by condition (bars = mean, whiskers = 95% CI)", fontweight="bold", y=1.0)
    fig.tight_layout()
    print("Generated figure: average score per condition.")


def plot_forest(means_models, kpis):
    """Each AI condition's mean difference from None per KPI (dot + 95% CI; red = sig)."""
    nrows, ncols = _grid(len(kpis))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6.0 * ncols, 4.6 * nrows), squeeze=False)
    flat = [ax for row in axes for ax in row]
    non_ref = [l for l in CONDITION_ORDER if l != REFERENCE]
    term = {"Solo": "solo", "Group": "group", "Both": "both"}
    for ax, (key, label, scale5) in zip(flat, kpis):
        model = means_models.get(key)
        ys, ests, los, his, labels, sig = [], [], [], [], [], []
        if model is not None:
            ci = model.conf_int(alpha=0.05)
            for i, lvl in enumerate(non_ref):
                t = term[lvl]
                if t in model.params.index:
                    ests.append(model.params[t]); lo, hi = ci.loc[t, 0], ci.loc[t, 1]
                    los.append(lo); his.append(hi); ys.append(i); labels.append(lvl)
                    sig.append(not (lo <= 0 <= hi))
        if ys:
            ests = np.array(ests)
            err = np.vstack([ests - np.array(los), np.array(his) - ests])
            dot_colors = ["#D62728" if s else "#1F77B4" for s in sig]
            ax.errorbar(ests, ys, xerr=err, fmt="none", ecolor="#888888", elinewidth=2.2, capsize=5)
            ax.scatter(ests, ys, c=dot_colors, s=110, zorder=3, edgecolor="black")
            for xi, yi in zip(ests, ys):
                ax.annotate(f"{xi:+.2f}", (xi, yi), textcoords="offset points", xytext=(0, 10), ha="center", fontsize=11, fontweight="bold")
            ax.set_yticks(ys); ax.set_yticklabels([f"{l} vs None" for l in labels], fontsize=12)
        ax.axvline(0.0, color="red", linestyle="--", linewidth=1.5)
        ax.set_title(label, fontweight="bold")
        ax.set_xlabel("Difference from no-AI")
        ax.grid(axis="x", linestyle=":", alpha=0.5)
        ax.invert_yaxis()
    for ax in flat[len(kpis):]:
        ax.axis("off")
    fig.suptitle("Each AI condition vs the no-AI baseline (dot = mean difference, bar = 95% CI; red = significant)", fontweight="bold", y=1.0)
    fig.tight_layout()
    print("Generated figure: condition effects vs baseline.")


# ── 8. Insights (plain-language read-out; drives the page's Insights panel) ────
def emm_for(model, level):
    if model is None:
        return None
    names = list(model.params.index)
    v = np.zeros(len(names))
    v[names.index("Intercept")] = 1.0
    if level != REFERENCE:
        t = {"Solo": "solo", "Group": "group", "Both": "both"}[level]
        if t not in names:
            return None
        v[names.index(t)] = 1.0
    val = _s(model.t_test(v).effect)
    return val if np.isfinite(val) else None


def insights(df, kpis, means_models):
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

    term = {"Solo": "solo", "Group": "group", "Both": "both"}
    ranking_by_kpi = {}
    for key, label, _ in kpis:
        model = means_models.get(key)
        print("\n" + "-" * 78)
        print(f"KPI: {label}")
        print("-" * 78)
        if model is None:
            print("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.")
            ranking_by_kpi[label] = None
            continue
        means = {c: emm_for(model, c) for c in present}
        means = {c: m for c, m in means.items() if m is not None}
        ranked = sorted(means.items(), key=lambda kv: kv[1], reverse=True)
        ranking_by_kpi[label] = ranked
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
        pc = planned_contrast(model, label)
        if pc is not None:
            winner = PRIMARY_CONTRAST[0] if pc["estimate"] >= 0 else PRIMARY_CONTRAST[1]
            how = "significantly" if pc["p_value"] < 0.05 else "but NOT significantly"
            print(f"  AI timing ({PRIMARY_CONTRAST[0]} vs {PRIMARY_CONTRAST[1]}): {winner} scores "
                  f"{abs(pc['estimate']):.2f} higher, {how} (p = {pc['p_value']:.3f}).")
        if ranked:
            print(f"  => Best on {label}: '{ranked[0][0]}'.  Worst: '{ranked[-1][0]}'.")

    print("\n" + "-" * 78)
    print("CONDITION RANKING PER KPI (best -> worst):")
    print("-" * 78)
    for key, label, _ in kpis:
        ranked = ranking_by_kpi.get(label)
        if not ranked:
            print(f"  {label:<18}: (not estimable)")
        else:
            print(f"  {label:<18}: " + "  >  ".join(f"{c} ({m:.2f})" for c, m in ranked))
    if missing:
        print(f"\n  Reminder: {', '.join(missing)} had NO data and is omitted from all of the above.")
    print()


# ── Main driver ───────────────────────────────────────────────────────────────
def main():
    df = prepare(load_data())
    if df.empty:
        print("WARNING: no usable rows after cleaning - nothing to analyse.")
        return

    kpis = present_kpis(df)               # [(key, label, scale5)] with data
    if not kpis:
        print("WARNING: no KPI columns have any values yet. Score ideas in Step 3 first.")
        return
    level_dvs = [(k, lab) for (k, lab, _) in kpis]
    top_kpis = [(k, lab, s5) for (k, lab, s5) in kpis
                if s5 and f"top_{k}" in df.columns and df[f"top_{k}"].notna().any()
                and df[f"top_{k}"].dropna().nunique() > 1]
    top_dvs = [(f"top_{k}", f"Top {lab}") for (k, lab, _) in top_kpis]

    present_levels = list(df["condition"].cat.categories)

    # Per-condition sample sizes + per-KPI coverage.
    print("=" * 78)
    print("FINAL-IDEA COUNT PER CONDITION (unit of analysis; unbalanced design)")
    print("=" * 78)
    vc = df["condition"].value_counts()
    for lvl in CONDITION_ORDER:
        flag = "" if lvl in present_levels else "   <- NO DATA (skipped)"
        print(f"    {lvl:<6} n = {int(vc.get(lvl, 0))}{flag}")
    print("\nKPI coverage (ideas with a value, by source):")
    for key, label, _ in kpis:
        print(f"    {label:<18} n = {int(df[key].notna().sum())} / {len(df)}")
    print(f"\nConditions with < {MIN_CELL} ideas for a KPI (or an absent None baseline) are dropped")
    print("from that KPI's model and shown as '—'. SEs use HC3 robust covariance.\n")

    controls = control_terms(df)

    # ── The four tables (paper layout), columns = present KPIs ─────────────────
    tables = [
        build_table(df, 3, "Human-Only vs Any-AI - KPI level by condition",
                    "OLS of each KPI on a single Any-AI dummy (reference = None).",
                    level_dvs, split=False, controls=controls),
        build_table(df, 4, "Human-Only vs Solo / Group / Both - KPI level by condition",
                    "OLS of each KPI on the condition dummies (reference = None).",
                    level_dvs, split=True, controls=controls),
    ]
    if top_dvs:
        tables += [
            build_table(df, 5, "Human-Only vs Any-AI - probability of a top (5/5) rating",
                        "Linear-probability model of P(top) on a single Any-AI dummy (1-5 KPIs only).",
                        top_dvs, split=False, controls=controls),
            build_table(df, 6, "Human-Only vs Solo / Group / Both - probability of a top (5/5) rating",
                        "Linear-probability model of P(top) on the condition dummies (1-5 KPIs only).",
                        top_dvs, split=True, controls=controls),
        ]
    else:
        print("NOTE: no 1-5 KPI has variation in its top-rating outcome; Tables 5 & 6 are skipped.\n")
    for t in tables:
        print_table(t)

    # ── Primary planned contrast across KPIs (uses Table 4's split models) ─────
    print("=" * 78)
    print(f"PRIMARY PLANNED CONTRAST:  '{PRIMARY_CONTRAST[0]}'  -  '{PRIMARY_CONTRAST[1]}'   (AI timing)")
    print("=" * 78)
    split_fits = tables[1]["fits"]      # Table 4
    contrasts = [c for c in (planned_contrast(split_fits[k][0], lab) for (k, lab) in level_dvs) if c]
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

    # No-controls condition-means models per KPI (for insights + plots).
    means_models = {}
    for key, _, _ in kpis:
        s = df.dropna(subset=[key])
        means_models[key] = fit_one(s, key, split_terms(s), [])
    insights(df, kpis, means_models)

    try:
        plot_means(df, kpis, present_levels)
    except Exception as exc:
        warnings.warn(f"Mean plot failed: {exc}")
    try:
        plot_forest(means_models, kpis)
    except Exception as exc:
        warnings.warn(f"Forest plot failed: {exc}")

    emit_machine(tables)
    print("Done.")


main()   # __name__ is "__main__" under Pyodide, so just run it
