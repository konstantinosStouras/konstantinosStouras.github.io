"""
================================================================================
Effects of AI Timing on Idea Generation (AsPredicted #298152) — PYTHON ANALYSIS
================================================================================

WHAT THIS SCRIPT DOES
  For each of the three KPIs (novelty, usefulness, overall_quality) it fits one
  linear regression of the KPI on the 4-level, between-subjects `condition`
  factor, with "Human-Only Hybrid" (the no-AI condition) as the dummy-coded
  reference. It then prints, per KPI:
    * the regression coefficient table (estimate, SE, t, p-value, 95% CI),
    * the PRIMARY PLANNED CONTRAST  Individual + AI  −  Group + AI  (AI timing),
    * the estimated marginal means with Holm-adjusted pairwise comparisons,
  followed by an INSIGHTS section that reads the results back in plain language
  (the best→worst ranking of the conditions for each KPI), and two plots.

WHERE THE DATA COMES FROM (read this)
  The data is the SCORED DATASET built in the previous step of the page — the
  exact same rows you can grab with "Download CSV" / "Download Excel" (the
  "summarized file"). It already includes every idea's FINAL scores. It is handed
  to this script as the global string `DATA_CSV` (one row per idea). Columns:
      idea_id, session, condition, phase, group_id, author_id,
      novelty, usefulness, overall_quality, final_pick, text
  `condition` uses the Set A / placement encoding — None / Solo / Group / Both
  (see CONDITION_PAPER below for the paper names). `overall_quality` =
  mean(novelty, usefulness); rows with missing KPI scores are dropped before
  fitting. Edit anything below freely, then press Run.
"""

# ── Imports ───────────────────────────────────────────────────────────────────
import io          # wrap the DATA_CSV string in a file-like object for pandas
import sys         # used only to print a fatal message to stderr if data is absent
import warnings    # non-fatal problems are warned about, not raised, so a small
                   # or degenerate dataset never aborts the whole run
import itertools   # itertools.combinations() builds the list of condition pairs

import numpy as np                 # numeric arrays + the contrast vectors
import pandas as pd                # the data frame, group means, pretty tables
import matplotlib                  # plotting; force a headless backend BEFORE pyplot
matplotlib.use("Agg")              # "Agg" renders to an in-memory PNG (no display);
import matplotlib.pyplot as plt    # the page harvests open figures after the run

import statsmodels.formula.api as smf                 # ols() formula interface
from statsmodels.stats.multitest import multipletests # Holm family-wise correction
from scipy import stats as spstats                    # t-distribution for plot CIs

# ── Configuration ─────────────────────────────────────────────────────────────
# CONDITION ENCODING (Set A / "placement") — the `condition` column holds these
# short codes; the paper names + where AI is present are:
#     None  = Human-Only Hybrid  (AI in neither stage)   <- regression reference
#     Solo  = Individual + AI     (AI in solo stage only)
#     Group = Group + AI          (AI in group stage only)
#     Both  = Full AI             (AI in both stages)
# "None" (no AI) is the reference, so each dummy coefficient reads "this condition
# − None".
REFERENCE = "None"
# Canonical display/analysis order of the four conditions.
CONDITION_ORDER = ["None", "Solo", "Group", "Both"]
# Placement -> readable description, used by the insights read-out.
CONDITION_PAPER = {
    "None": "Human-Only Hybrid (AI in neither stage)",
    "Solo": "Individual + AI (AI in solo stage only)",
    "Group": "Group + AI (AI in group stage only)",
    "Both": "Full AI (AI in both stages)",
}
# The three dependent variables (idea-creativity KPIs).
KPIS = ["novelty", "usefulness", "overall_quality"]
# The single pre-registered contrast of interest: it isolates AI *timing*
# (Solo = solo-stage AI vs Group = group-stage AI), holding the no-AI baseline
# constant.
PRIMARY_CONTRAST = ("Solo", "Group")

pd.set_option("display.width", 140)        # wide console so tables don't wrap
pd.set_option("display.max_columns", 40)


# ── Small helpers ─────────────────────────────────────────────────────────────
def stars(p):
    """Conventional significance stars for a p-value (blank if NaN / n.s.)."""
    if pd.isna(p):
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


def _s(x):
    """Return the first element of a statsmodels result array as a plain float.

    Recent NumPy (the version shipped inside Pyodide) refuses float() on any
    array that is not 0-dimensional, and `t_test().effect` / `.sd` can come back
    as a 1x1 (2-D) array — so flatten to 1-D with np.ravel first, take [0] (a
    0-D scalar), then convert. Using this everywhere avoids the
    "only 0-dimensional arrays can be converted to Python scalars" TypeError.
    """
    return float(np.ravel(np.asarray(x))[0])


def term_for(level):
    """Name statsmodels gives the Treatment-coded dummy column for `level`.

    With C(condition, Treatment(reference='None')) the design-matrix columns are
    exactly 'C(condition, Treatment(reference='...'))[T.<level>]' —
    one per non-reference condition. Building this string lets us look a
    coefficient up BY NAME (robust to column ordering) instead of by position.
    """
    return f"C(condition, Treatment(reference='{REFERENCE}'))[T.{level}]"


# ── 1. Load + clean ───────────────────────────────────────────────────────────
def load_data():
    """Parse the injected DATA_CSV global (the scored dataset from step 2)."""
    if "DATA_CSV" not in globals():
        # Should never happen via the page, but guard so a manual run fails loudly.
        print("ERROR: global variable DATA_CSV is not defined.", file=sys.stderr)
        sys.exit(1)
    # keep_default_na=False so the condition code "None" is NOT read as NaN
    # (pandas treats the string "None" as missing by default). Blank KPI cells
    # stay "" here and are coerced to NaN in prepare() via pd.to_numeric.
    return pd.read_csv(io.StringIO(DATA_CSV), keep_default_na=False)


def prepare(df):
    """Validate columns, coerce KPI types, drop unscored rows, and order the
    condition factor with the reference level first. Returns a clean frame."""
    n0 = len(df)                                       # remember the input row count

    # Fail fast (printed message) if a structural column is missing.
    for col in ["condition"] + KPIS:
        if col not in df.columns:
            print(f"ERROR: required column '{col}' missing from data.", file=sys.stderr)
            sys.exit(1)

    # KPI columns may arrive as strings (blank cells) — make them numeric; any
    # non-numeric/blank value becomes NaN so it can be dropped below.
    for k in KPIS:
        df[k] = pd.to_numeric(df[k], errors="coerce")

    # Defensive: drop any rows whose condition label is not one of the four we
    # know about (e.g. a typo from an imported file), with a printed warning.
    unknown = set(df["condition"].dropna().unique()) - set(CONDITION_ORDER)
    if unknown:
        warnings.warn(f"Dropping rows with unrecognised condition(s): {sorted(unknown)}")
        df = df[df["condition"].isin(CONDITION_ORDER)].copy()

    # Listwise-drop rows missing ANY KPI so all three models share one sample.
    before = len(df)
    df = df.dropna(subset=KPIS).copy()
    dropped = before - len(df)
    if dropped:
        print(f"NOTE: dropped {dropped} row(s) with missing KPI value(s).")
    print(f"NOTE: rows in: {n0}; rows used for analysis: {len(df)}.\n")

    # Make `condition` an ordered categorical whose FIRST level is the reference,
    # keeping only the levels actually present (so empty cells don't break things).
    present = [c for c in CONDITION_ORDER if c in df["condition"].unique()]
    df["condition"] = pd.Categorical(df["condition"], categories=present, ordered=True)
    return df


# ── 2. Fit one OLS per KPI ────────────────────────────────────────────────────
def fit_kpi(df, kpi):
    """Fit `kpi ~ condition` (reference = Human-Only Hybrid). Returns the fitted
    model, or None when the data is too thin to estimate it (guards so a tiny or
    single-condition dataset warns instead of throwing)."""
    formula = f"{kpi} ~ C(condition, Treatment(reference='{REFERENCE}'))"
    if df["condition"].nunique() < 2:                 # need ≥2 conditions to compare
        warnings.warn(f"[{kpi}] fewer than 2 conditions present; skipping regression.")
        return None
    if len(df) <= df["condition"].nunique():          # need more rows than parameters
        warnings.warn(f"[{kpi}] too few rows ({len(df)}) for the model; skipping.")
        return None
    try:
        return smf.ols(formula, data=df).fit()        # ordinary least squares fit
    except Exception as exc:                          # never let a degenerate fit abort
        warnings.warn(f"[{kpi}] OLS failed: {exc}")
        return None


def print_coef_table(model, kpi):
    """Print a clean coefficient table for one fitted model (the regression you
    asked for), with friendly row labels and significance stars."""
    print("=" * 78)
    print(f"OLS REGRESSION  -  {kpi}  ~  condition  (reference = '{REFERENCE}')")
    print("=" * 78)

    coefs, ses, ts, ps = model.params, model.bse, model.tvalues, model.pvalues  # Series
    ci = model.conf_int(alpha=0.05)            # 95% confidence interval per coefficient
    ci.columns = ["ci_low", "ci_high"]

    def pretty(name):
        # Turn statsmodels' verbose term names into readable labels.
        if name == "Intercept":
            return f"Intercept ({REFERENCE})"     # intercept = baseline mean
        for lvl in CONDITION_ORDER:
            if name == term_for(lvl):
                return f"{lvl} vs {REFERENCE}"     # each dummy = level − baseline
        return name

    # Assemble everything into one DataFrame for aligned printing.
    tbl = pd.DataFrame({
        "term": [pretty(n) for n in coefs.index],
        "estimate": coefs.values,
        "std_err": ses.values,
        "t": ts.values,
        "p_value": ps.values,
        "ci_low": ci["ci_low"].values,
        "ci_high": ci["ci_high"].values,
    })
    tbl["sig"] = tbl["p_value"].map(stars)
    with pd.option_context("display.float_format", lambda v: f"{v:9.4f}"):
        print(tbl.to_string(index=False))
    print(f"\nN = {int(model.nobs)}    R^2 = {model.rsquared:.4f}    adj R^2 = {model.rsquared_adj:.4f}")
    print("Signif. codes: *** p<.001  ** p<.01  * p<.05  . p<.10\n")


# ── 3. Primary planned contrast: Individual + AI  −  Group + AI ────────────────
def planned_contrast(model, kpi):
    """Estimate the AI-timing contrast for one KPI.

    Because BOTH Individual + AI and Group + AI are coded against the same
    reference, their difference equals  (+1)·[T.Individual+AI] + (-1)·[T.Group+AI];
    the intercept and every other term cancel. We hand that contrast vector to
    model.t_test(), which uses the regression's pooled residual error. Returns a
    dict of {estimate, std_err, t, p_value}, or None if a level is absent.
    """
    a, b = PRIMARY_CONTRAST
    names = list(model.params.index)                  # the coefficient order
    ta, tb = term_for(a), term_for(b)
    if ta not in names or tb not in names:            # a condition has no data
        warnings.warn(f"[{kpi}] cannot form contrast '{a} - {b}'; level(s) absent.")
        return None
    cvec = np.zeros(len(names))                        # one weight per coefficient
    cvec[names.index(ta)] = 1.0                        # +1 on Individual + AI
    cvec[names.index(tb)] = -1.0                       # −1 on Group + AI
    res = model.t_test(cvec)                           # tested with pooled SE
    return {
        "kpi": kpi,
        "estimate": _s(res.effect),                    # _s() = robust float extract
        "std_err": _s(res.sd),
        "t": _s(res.tvalue),
        "p_value": _s(res.pvalue),
    }


# ── 4. Estimated marginal means + Holm-adjusted pairwise comparisons ───────────
def emm_and_pairwise(model, df, kpi):
    """Print the model-based condition means (which equal the cell means for a
    single-factor model) ranked best→worst, then every pairwise difference with a
    Holm family-wise correction. SEs come from the model's pooled error term, so
    they are consistent with the regression above."""
    levels = list(df["condition"].cat.categories)
    names = list(model.params.index)

    def emm_vec(level):
        # Contrast vector whose t_test gives the marginal mean of `level`:
        # intercept (= reference mean) plus that level's dummy (0 for the reference).
        v = np.zeros(len(names))
        v[names.index("Intercept")] = 1.0
        if level != REFERENCE:
            t = term_for(level)
            if t in names:
                v[names.index(t)] = 1.0
            else:
                return None                            # level absent from the model
        return v

    # Estimate every present level's mean + SE + n.
    emms = {}
    for lvl in levels:
        v = emm_vec(lvl)
        if v is None:
            continue
        r = model.t_test(v)
        emms[lvl] = {"mean": _s(r.effect), "se": _s(r.sd),
                     "n": int((df["condition"] == lvl).sum())}
    if not emms:
        warnings.warn(f"[{kpi}] no estimable condition means.")
        return

    # Print the ranking (highest mean first).
    ranked = sorted(emms.items(), key=lambda kv: kv[1]["mean"], reverse=True)
    print("-" * 78)
    print(f"CONDITION MEANS (estimated marginal means) - {kpi}   [best -> worst]")
    print("-" * 78)
    rank_tbl = pd.DataFrame([
        {"rank": i + 1, "condition": lvl, "mean": d["mean"], "SE": d["se"], "n": d["n"]}
        for i, (lvl, d) in enumerate(ranked)
    ])
    with pd.option_context("display.float_format", lambda v: f"{v:8.4f}"):
        print(rank_tbl.to_string(index=False))

    # All unordered condition pairs (e.g. 3 present conditions → 3 pairs).
    pairs = list(itertools.combinations(list(emms.keys()), 2))
    if not pairs:
        print("(Only one estimable condition - no pairwise comparisons.)\n")
        return

    # Test each pair as a model contrast (difference of the two EMM vectors).
    rows, raw_p = [], []
    for a, b in pairs:
        r = model.t_test(emm_vec(a) - emm_vec(b))
        rows.append([f"{a}  -  {b}", _s(r.effect), _s(r.sd), _s(r.tvalue), _s(r.pvalue)])
        raw_p.append(_s(r.pvalue))
    # Holm-adjust the family of pairwise p-values (controls the FWER, more
    # powerful than Bonferroni); fall back to raw p if the correction errors.
    try:
        _, p_holm, _, _ = multipletests(raw_p, method="holm")
    except Exception:
        p_holm = raw_p

    pw = pd.DataFrame(rows, columns=["comparison", "diff", "std_err", "t", "p_raw"])
    pw["p_holm"] = p_holm
    pw["sig(Holm)"] = pw["p_holm"].map(lambda p: stars(p) if stars(p) else "ns")
    print(f"\nPairwise condition differences - {kpi}  (Holm-adjusted, {len(pairs)} pairs):")
    with pd.option_context("display.float_format", lambda v: f"{v:8.4f}"):
        print(pw.to_string(index=False))
    print()


# ── 5. Plots ──────────────────────────────────────────────────────────────────
def ci95_halfwidth(std, n):
    """95% CI half-width from the per-group t distribution (matches the R tab's
    error bars). Returns NaN for n<=1 so a single-observation cell draws no bar."""
    if n is None or n <= 1 or not np.isfinite(std):
        return np.nan
    return float(spstats.t.ppf(0.975, n - 1)) * std / np.sqrt(n)


def plot_means(df, present_levels):
    """One bar chart per KPI: condition means with 95% CI error bars."""
    fig, axes = plt.subplots(1, len(KPIS), figsize=(5 * len(KPIS), 5), squeeze=False)
    axes = axes[0]
    colors = ["#4D4D4D", "#1F77B4", "#2CA02C", "#D62728"]  # one colour per condition
    for ax, kpi in zip(axes, KPIS):
        means, halfs = [], []
        for lvl in present_levels:                     # raw cell mean + CI per condition
            vals = df.loc[df["condition"] == lvl, kpi].dropna()
            if len(vals) == 0:
                means.append(np.nan); halfs.append(np.nan)
            else:
                means.append(vals.mean())
                halfs.append(ci95_halfwidth(vals.std(ddof=1), len(vals)))
        x = np.arange(len(present_levels))
        ax.bar(x, means, yerr=halfs, capsize=5, color=colors[:len(present_levels)],
               edgecolor="black", alpha=0.85)
        ax.set_xticks(x)
        ax.set_xticklabels(present_levels, rotation=25, ha="right", fontsize=9)
        ax.set_title(f"Mean {kpi}\n(95% CI)", fontsize=11)
        ax.set_ylabel(kpi); ax.set_xlabel("Condition")
        ax.grid(axis="y", linestyle=":", alpha=0.5)
        finite = [m for m in means if np.isfinite(m)]
        if finite:
            ax.set_ylim(0, max(7.2, max(finite) * 1.15))   # KPI scale tops out near 7
    fig.suptitle("KPI means by condition (95% CI error bars)", fontsize=13, y=1.02)
    fig.tight_layout()
    print("Generated figure: KPI means by condition.")


def plot_forest(models):
    """One forest/coefficient plot per KPI: each condition's effect vs the
    baseline with its 95% CI (a red line marks zero = no difference)."""
    non_ref = [l for l in CONDITION_ORDER if l != REFERENCE]   # the dummy effects
    fig, axes = plt.subplots(1, len(KPIS), figsize=(5 * len(KPIS), 4.5),
                             squeeze=False, sharey=True)
    axes = axes[0]
    for ax, kpi in zip(axes, KPIS):
        model = models.get(kpi)
        ys, ests, los, his, labels = [], [], [], [], []
        if model is not None:
            ci = model.conf_int(alpha=0.05)
            for i, lvl in enumerate(non_ref):          # collect estimate + CI per effect
                t = term_for(lvl)
                if t in model.params.index:
                    ests.append(model.params[t])
                    los.append(ci.loc[t, 0]); his.append(ci.loc[t, 1])
                    ys.append(i); labels.append(lvl)
        if ys:
            ests = np.array(ests)
            err = np.vstack([ests - np.array(los), np.array(his) - ests])   # CI half-widths
            ax.errorbar(ests, ys, xerr=err, fmt="o", color="#333333",
                        ecolor="#1F77B4", elinewidth=2, capsize=4, markersize=7)
            ax.set_yticks(ys); ax.set_yticklabels(labels, fontsize=9)
        ax.axvline(0.0, color="red", linestyle="--", linewidth=1)   # zero = no effect
        ax.set_title(f"{kpi}", fontsize=11)
        ax.set_xlabel(f"Effect vs '{REFERENCE}'\n(point = estimate, bar = 95% CI)", fontsize=9)
        ax.grid(axis="x", linestyle=":", alpha=0.5)
        ax.invert_yaxis()
    fig.suptitle(f"Condition effects vs baseline '{REFERENCE}' (95% CIs)", fontsize=13, y=1.03)
    fig.tight_layout()
    print("Generated figure: coefficient / forest plot.")


# ── 6. Insights (plain-language read-out of the regressions above) ────────────
def emm_for(model, level):
    """Estimated marginal mean of one condition from a fitted model, or None if
    that condition is absent from the model (no data was collected for it)."""
    names = list(model.params.index)
    v = np.zeros(len(names))
    v[names.index("Intercept")] = 1.0          # intercept = reference mean
    if level != REFERENCE:
        t = term_for(level)
        if t not in names:
            return None                        # condition not in the model
        v[names.index(t)] = 1.0                # add this condition's dummy
    return _s(model.t_test(v).effect)          # the marginal mean


def insights(df, models):
    """Print plain-language insights derived ONLY from the regressions above:
    a data-coverage check (flagging any of the four conditions with no data) and,
    per KPI, the best→worst ranking of the conditions plus the key significances."""
    print("\n" + "#" * 78)
    print("# INSIGHTS  (read directly off the regression results above)")
    print("#" * 78)

    # Remind the reader what the condition codes mean (Set A / placement encoding).
    print("\nCondition encoding (Set A / placement):")
    for code in CONDITION_ORDER:
        print(f"    {code:<6} = {CONDITION_PAPER[code]}")

    # Which of the four conditions actually have rows, and which are missing.
    present = [c for c in CONDITION_ORDER if (df["condition"] == c).any()]
    missing = [c for c in CONDITION_ORDER if c not in present]

    # Coverage check — e.g. "Full AI" has not been collected yet, so say so loudly
    # and make clear it is excluded from every ranking/comparison below.
    if missing:
        print(f"\nDATA-COVERAGE CHECK: NO data was collected for condition(s): {', '.join(missing)}.")
        print("  -> Excluded from every ranking and comparison below; no conclusion can")
        print("     be drawn about them until data for that condition is collected.")
    print(f"\nConditions with data ({len(present)} of 4): {', '.join(present)}.")

    ranking_by_kpi = {}                          # remembered for the compact summary
    for kpi in KPIS:
        model = models.get(kpi)
        print("\n" + "-" * 78)
        print(f"KPI: {kpi}")
        print("-" * 78)
        if model is None:                        # KPI was not estimable
            print("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.")
            ranking_by_kpi[kpi] = None
            continue

        # Rank the present conditions by their estimated marginal mean (high→low).
        means = {c: emm_for(model, c) for c in present}
        means = {c: m for c, m in means.items() if m is not None}
        ranked = sorted(means.items(), key=lambda kv: kv[1], reverse=True)
        ranking_by_kpi[kpi] = ranked

        print("  Ranking of conditions (best -> worst), by estimated mean:")
        for i, (c, m) in enumerate(ranked, 1):
            print(f"    {i}. {c:<18}  mean = {m:.3f}")

        # Each non-reference condition vs the no-AI baseline, with significance,
        # read straight off the regression coefficient + its p-value.
        print(f"  Versus the '{REFERENCE}' baseline:")
        any_sig = False
        for c in present:
            if c == REFERENCE:
                continue
            t = term_for(c)
            if t in model.params.index:
                b = float(model.params[t])               # coefficient = level − baseline
                p = float(model.pvalues[t])
                direction = "higher" if b >= 0 else "lower"
                verdict = "significant" if p < 0.05 else "not significant"
                any_sig = any_sig or p < 0.05
                print(f"    - {c}: {abs(b):.2f} points {direction} (p = {p:.3f}, {verdict})")
        if not any_sig:
            print("    (no condition differs significantly from baseline on this KPI)")

        # The pre-registered AI-timing contrast, summarised in one sentence.
        pc = planned_contrast(model, kpi)
        if pc is not None:
            winner = PRIMARY_CONTRAST[0] if pc["estimate"] >= 0 else PRIMARY_CONTRAST[1]
            how = "significantly" if pc["p_value"] < 0.05 else "but NOT significantly"
            print(f"  AI timing ({PRIMARY_CONTRAST[0]} vs {PRIMARY_CONTRAST[1]}): {winner} scores "
                  f"{abs(pc['estimate']):.2f} higher, {how} (p = {pc['p_value']:.3f}).")

        if ranked:
            print(f"  => Best on {kpi}: '{ranked[0][0]}'.  Worst: '{ranked[-1][0]}'.")

    # One-line ranking per KPI, for a quick cross-KPI comparison.
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
    df = prepare(load_data())                    # parse + clean the step-2 dataset
    if df.empty:
        print("WARNING: no usable rows after cleaning - nothing to analyse.")
        return

    present_levels = list(df["condition"].cat.categories)
    if len(present_levels) < 2:
        print(f"WARNING: only condition(s) {present_levels} present; regression not meaningful.")

    # Fit + report each KPI's regression, collecting the models + planned contrasts.
    models, contrasts = {}, []
    for kpi in KPIS:
        model = fit_kpi(df, kpi)
        models[kpi] = model
        if model is None:
            print(f"[{kpi}] model not estimable - skipped.\n")
            continue
        print_coef_table(model, kpi)             # the regression table
        c = planned_contrast(model, kpi)         # the AI-timing contrast
        if c is not None:
            contrasts.append(c)
        emm_and_pairwise(model, df, kpi)         # ranking + pairwise tests

    # Collect the planned contrast across the three KPIs into one table.
    print("=" * 78)
    print(f"PRIMARY PLANNED CONTRAST:  '{PRIMARY_CONTRAST[0]}'  -  '{PRIMARY_CONTRAST[1]}'   (AI timing)")
    print("=" * 78)
    if contrasts:
        ctab = pd.DataFrame(contrasts)
        ctab["sig"] = ctab["p_value"].map(stars)
        with pd.option_context("display.float_format", lambda v: f"{v:9.4f}"):
            print(ctab.to_string(index=False))
        print("Signif. codes: *** p<.001  ** p<.01  * p<.05  . p<.10")
        print("Positive estimate => solo-stage AI (Individual + AI) scores higher than group-stage AI.")
    else:
        print("No KPI had both contrast levels present - contrast not computed.")
    print()

    insights(df, models)                         # the plain-language read-out

    # Plots last, each guarded so a degenerate dataset never aborts the run.
    try:
        plot_means(df, present_levels)
    except Exception as exc:
        warnings.warn(f"Mean plot failed: {exc}")
    try:
        plot_forest(models)
    except Exception as exc:
        warnings.warn(f"Forest plot failed: {exc}")
    print("\nDone.")


main()   # __name__ is "__main__" under Pyodide, so just run it
