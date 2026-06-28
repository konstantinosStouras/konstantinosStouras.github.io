"""
Effects of AI Timing on Idea Generation (AsPredicted #298152)
=============================================================
For each KPI (novelty, usefulness, overall_quality), regress the KPI on the
4-level between-subjects `condition` factor with "Human-Only Hybrid" as the
dummy-coded reference. Reports coefficients + p-values, the primary planned
contrast (Individual + AI  vs  Group + AI), a best->worst ranking of the four
conditions, and plots. Edit freely, then press Run.

The data arrives as the global string DATA_CSV (one row per idea). Columns:
idea_id, session, condition, phase, group_id, author_id, novelty, usefulness,
overall_quality, final_pick, text.
"""

import io
import sys
import warnings
import itertools

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests
from scipy import stats as spstats

REFERENCE = "Human-Only Hybrid"
CONDITION_ORDER = ["Human-Only Hybrid", "Individual + AI", "Group + AI", "Full AI"]
KPIS = ["novelty", "usefulness", "overall_quality"]
PRIMARY_CONTRAST = ("Individual + AI", "Group + AI")  # isolates AI timing

pd.set_option("display.width", 140)
pd.set_option("display.max_columns", 40)


def stars(p):
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


def term_for(level):
    # statsmodels names a Treatment-coded dummy column as:
    #   C(condition, Treatment(reference='Human-Only Hybrid'))[T.<level>]
    return f"C(condition, Treatment(reference='{REFERENCE}'))[T.{level}]"


def load_data():
    if "DATA_CSV" not in globals():
        print("ERROR: global variable DATA_CSV is not defined.", file=sys.stderr)
        sys.exit(1)
    return pd.read_csv(io.StringIO(DATA_CSV))


def prepare(df):
    n0 = len(df)
    for col in ["condition"] + KPIS:
        if col not in df.columns:
            print(f"ERROR: required column '{col}' missing from data.", file=sys.stderr)
            sys.exit(1)
    for k in KPIS:
        df[k] = pd.to_numeric(df[k], errors="coerce")

    unknown = set(df["condition"].dropna().unique()) - set(CONDITION_ORDER)
    if unknown:
        warnings.warn(f"Dropping rows with unrecognised condition(s): {sorted(unknown)}")
        df = df[df["condition"].isin(CONDITION_ORDER)].copy()

    before = len(df)
    df = df.dropna(subset=KPIS).copy()
    dropped = before - len(df)
    if dropped:
        print(f"NOTE: dropped {dropped} row(s) with missing KPI value(s).")
    print(f"NOTE: rows in: {n0}; rows used for analysis: {len(df)}.\n")

    present = [c for c in CONDITION_ORDER if c in df["condition"].unique()]
    df["condition"] = pd.Categorical(df["condition"], categories=present, ordered=True)
    return df


def fit_kpi(df, kpi):
    formula = f"{kpi} ~ C(condition, Treatment(reference='{REFERENCE}'))"
    if df["condition"].nunique() < 2:
        warnings.warn(f"[{kpi}] fewer than 2 conditions present; skipping regression.")
        return None
    if len(df) <= df["condition"].nunique():
        warnings.warn(f"[{kpi}] too few rows ({len(df)}) for the model; skipping.")
        return None
    try:
        return smf.ols(formula, data=df).fit()
    except Exception as exc:
        warnings.warn(f"[{kpi}] OLS failed: {exc}")
        return None


def print_coef_table(model, kpi):
    print("=" * 78)
    print(f"OLS REGRESSION  -  {kpi}  ~  condition  (reference = '{REFERENCE}')")
    print("=" * 78)

    coefs, ses, ts, ps = model.params, model.bse, model.tvalues, model.pvalues
    ci = model.conf_int(alpha=0.05)
    ci.columns = ["ci_low", "ci_high"]

    def pretty(name):
        if name == "Intercept":
            return f"Intercept ({REFERENCE})"
        for lvl in CONDITION_ORDER:
            if name == term_for(lvl):
                return f"{lvl} vs {REFERENCE}"
        return name

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


def planned_contrast(model, kpi):
    # Both Individual+AI and Group+AI are coded vs the same reference, so their
    # difference = (+1) * [T.Individual+AI] + (-1) * [T.Group+AI]; the intercept
    # and all other terms drop out. model.t_test uses the pooled residual error.
    a, b = PRIMARY_CONTRAST
    names = list(model.params.index)
    ta, tb = term_for(a), term_for(b)
    if ta not in names or tb not in names:
        warnings.warn(f"[{kpi}] cannot form contrast '{a} - {b}'; level(s) absent.")
        return None
    cvec = np.zeros(len(names))
    cvec[names.index(ta)] = 1.0
    cvec[names.index(tb)] = -1.0
    res = model.t_test(cvec)
    return {
        "kpi": kpi,
        "estimate": float(res.effect[0]),
        "std_err": float(res.sd[0]),
        "t": float(res.tvalue.ravel()[0]),
        "p_value": float(res.pvalue.ravel()[0]),
    }


def emm_and_pairwise(model, df, kpi):
    levels = list(df["condition"].cat.categories)
    names = list(model.params.index)

    def emm_vec(level):
        v = np.zeros(len(names))
        v[names.index("Intercept")] = 1.0
        if level != REFERENCE:
            t = term_for(level)
            if t in names:
                v[names.index(t)] = 1.0
            else:
                return None
        return v

    emms = {}
    for lvl in levels:
        v = emm_vec(lvl)
        if v is None:
            continue
        r = model.t_test(v)
        emms[lvl] = {"mean": float(r.effect[0]), "se": float(r.sd[0]),
                     "n": int((df["condition"] == lvl).sum())}
    if not emms:
        warnings.warn(f"[{kpi}] no estimable condition means.")
        return

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

    pairs = list(itertools.combinations(list(emms.keys()), 2))
    if not pairs:
        print("(Only one estimable condition - no pairwise comparisons.)\n")
        return

    rows, raw_p = [], []
    for a, b in pairs:
        r = model.t_test(emm_vec(a) - emm_vec(b))
        rows.append([f"{a}  -  {b}", float(r.effect[0]), float(r.sd[0]),
                     float(r.tvalue.ravel()[0]), float(r.pvalue.ravel()[0])])
        raw_p.append(float(r.pvalue.ravel()[0]))
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


def ci95_halfwidth(std, n):
    """95% CI half-width from the per-group t distribution (matches the R tab)."""
    if n is None or n <= 1 or not np.isfinite(std):
        return np.nan
    return float(spstats.t.ppf(0.975, n - 1)) * std / np.sqrt(n)


def plot_means(df, present_levels):
    fig, axes = plt.subplots(1, len(KPIS), figsize=(5 * len(KPIS), 5), squeeze=False)
    axes = axes[0]
    colors = ["#4D4D4D", "#1F77B4", "#2CA02C", "#D62728"]
    for ax, kpi in zip(axes, KPIS):
        means, halfs = [], []
        for lvl in present_levels:
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
            ax.set_ylim(0, max(7.2, max(finite) * 1.15))
    fig.suptitle("KPI means by condition (95% CI error bars)", fontsize=13, y=1.02)
    fig.tight_layout()
    print("Generated figure: KPI means by condition.")


def plot_forest(models):
    non_ref = [l for l in CONDITION_ORDER if l != REFERENCE]
    fig, axes = plt.subplots(1, len(KPIS), figsize=(5 * len(KPIS), 4.5),
                             squeeze=False, sharey=True)
    axes = axes[0]
    for ax, kpi in zip(axes, KPIS):
        model = models.get(kpi)
        ys, ests, los, his, labels = [], [], [], [], []
        if model is not None:
            ci = model.conf_int(alpha=0.05)
            for i, lvl in enumerate(non_ref):
                t = term_for(lvl)
                if t in model.params.index:
                    ests.append(model.params[t])
                    los.append(ci.loc[t, 0]); his.append(ci.loc[t, 1])
                    ys.append(i); labels.append(lvl)
        if ys:
            ests = np.array(ests)
            err = np.vstack([ests - np.array(los), np.array(his) - ests])
            ax.errorbar(ests, ys, xerr=err, fmt="o", color="#333333",
                        ecolor="#1F77B4", elinewidth=2, capsize=4, markersize=7)
            ax.set_yticks(ys); ax.set_yticklabels(labels, fontsize=9)
        ax.axvline(0.0, color="red", linestyle="--", linewidth=1)
        ax.set_title(f"{kpi}", fontsize=11)
        ax.set_xlabel(f"Effect vs '{REFERENCE}'\n(point = estimate, bar = 95% CI)", fontsize=9)
        ax.grid(axis="x", linestyle=":", alpha=0.5)
        ax.invert_yaxis()
    fig.suptitle(f"Condition effects vs baseline '{REFERENCE}' (95% CIs)", fontsize=13, y=1.03)
    fig.tight_layout()
    print("Generated figure: coefficient / forest plot.")


def main():
    df = prepare(load_data())
    if df.empty:
        print("WARNING: no usable rows after cleaning - nothing to analyse.")
        return

    present_levels = list(df["condition"].cat.categories)
    if len(present_levels) < 2:
        print(f"WARNING: only condition(s) {present_levels} present; regression not meaningful.")

    models, contrasts = {}, []
    for kpi in KPIS:
        model = fit_kpi(df, kpi)
        models[kpi] = model
        if model is None:
            print(f"[{kpi}] model not estimable - skipped.\n")
            continue
        print_coef_table(model, kpi)
        c = planned_contrast(model, kpi)
        if c is not None:
            contrasts.append(c)
        emm_and_pairwise(model, df, kpi)

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

    try:
        plot_means(df, present_levels)
    except Exception as exc:
        warnings.warn(f"Mean plot failed: {exc}")
    try:
        plot_forest(models)
    except Exception as exc:
        warnings.warn(f"Forest plot failed: {exc}")
    print("\nDone.")


main()
