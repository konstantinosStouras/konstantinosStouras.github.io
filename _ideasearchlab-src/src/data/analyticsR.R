###############################################################################
# Effects of AI Timing on Idea Generation (AsPredicted #298152) — R ANALYSIS
###############################################################################
#
# WHAT THIS SCRIPT DOES
#   For each KPI (novelty, usefulness, overall_quality) it fits a linear
#   regression of the KPI on the 4-level `condition` factor with "None" (no AI)
#   as the reference, then reports the coefficient table, the primary planned
#   contrast (Solo vs Group = AI timing), a best->worst ranking with Holm-adjusted
#   pairwise tests, an INSIGHTS section that reads the results back in plain
#   language, and plots. Base R only (stats + graphics) — no external packages.
#
# CONDITION ENCODING (Set A / placement)
#   None = Human-Only Hybrid (AI in neither stage)   <- regression reference
#   Solo = Individual + AI    (AI in solo stage only)
#   Group= Group + AI         (AI in group stage only)
#   Both = Full AI            (AI in both stages)
#
# WHERE THE DATA COMES FROM (read this)
#   The data is the SCORED DATASET built in the previous step of the page — the
#   same rows you can grab with "Download CSV" / "Download Excel" (the
#   "summarized file"), already including every idea's FINAL scores. The page
#   mounts it in the WebR virtual filesystem at /tmp/data.csv. One row per idea;
#   columns: idea_id, session, condition (None/Solo/Group/Both), phase, group_id,
#   author_id, novelty, usefulness, overall_quality, final_pick, text. Edit freely,
#   then press Run.
###############################################################################

# Read the step-3 dataset that the page wrote to the WebR virtual filesystem.
# stringsAsFactors = FALSE so text/id columns stay character (we factor only
# `condition`, below).
dat <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE)

cat("==========================================================\n")
cat(" AsPredicted #298152: Effects of AI Timing on Idea Generation\n")
cat("==========================================================\n")
cat("Rows read:", nrow(dat), " Columns:", ncol(dat), "\n")
cat("Unit of analysis: the FINAL ideas (each group's top-3 voted ideas).\n")
cat("Conditions are UNBALANCED (different n per condition); the analysis uses HC3\n")
cat("heteroscedasticity-robust SEs + Welch (unequal-variance) tests so the\n")
cat("comparisons stay valid under different sizes/variances.\n\n")

# CONDITION ENCODING (Set A / placement): None = no AI (Human-Only Hybrid),
# Solo = AI in solo stage only (Individual + AI), Group = AI in group stage only
# (Group + AI), Both = AI in both stages (Full AI). "None" is first, so it is the
# regression reference and every coefficient reads as "condition - None".
cond_levels <- c("None", "Solo", "Group", "Both")
# Placement -> readable description, used by the insights read-out.
cond_paper <- c(None  = "Human-Only Hybrid (AI in neither stage)",
                Solo  = "Individual + AI (AI in solo stage only)",
                Group = "Group + AI (AI in group stage only)",
                Both  = "Full AI (AI in both stages)")

# Defensive: drop any rows whose condition label is not one of the four (e.g. a
# typo from an imported file), announcing what was removed.
unknown <- setdiff(unique(dat$condition), cond_levels)
if (length(unknown) > 0) {
  cat("NOTE: dropping rows with unexpected condition label(s): ",
      paste(shQuote(unknown), collapse = ", "), "\n", sep = "")
  dat <- dat[dat$condition %in% cond_levels, , drop = FALSE]
}

# Make `condition` a factor with the reference as level 1 (controls the dummy
# coding in lm); coerce the KPI columns to numeric (blank cells -> NA).
dat$condition <- factor(dat$condition, levels = cond_levels)
kpis <- c("novelty", "usefulness", "overall_quality")
for (k in kpis) dat[[k]] <- suppressWarnings(as.numeric(dat[[k]]))

# Short labels + a fixed colour per condition, reused across all plots.
cond_short <- c("None", "Solo", "Group", "Both")
cond_col   <- c("#4D4D4D", "#1F77B4", "#2CA02C", "#D62728")

# 95% t critical value for a given residual df (falls back to the normal 1.96
# when df is not finite/positive), used for the error bars and contrast CIs.
tcrit <- function(df) if (is.finite(df) && df > 0) qt(0.975, df) else qnorm(0.975)

# HC3 heteroscedasticity-robust covariance for an lm (base R only — no packages).
# The four conditions are UNBALANCED (different numbers of final ideas) and may
# have unequal variances, so we report robust SE / t / p instead of the classical
# equal-variance OLS ones (the point estimates are unchanged). Returns the robust
# coefficient matrix + vcov; falls back to the classical summary if the linear
# algebra fails (e.g. a perfectly collinear / single-row cell).
hc3_coef <- function(m) {
  tryCatch({
    X <- model.matrix(m); e <- residuals(m)
    h <- pmin(hatvalues(m), 1 - 1e-8)          # guard leverage-1 points
    bread <- solve(crossprod(X))               # (X'X)^-1
    meat  <- t(X) %*% (X * (e^2 / (1 - h)^2))  # HC3 weighting of the residuals
    V <- bread %*% meat %*% bread
    est <- coef(m); se <- sqrt(diag(V)); dfr <- m$df.residual
    tval <- est / se; p <- 2 * pt(abs(tval), dfr, lower.tail = FALSE)
    list(coef = cbind(Estimate = est, `Std. Error` = se, `t value` = tval, `Pr(>|t|)` = p), vcov = V)
  }, error = function(err) { sm <- summary(m); list(coef = sm$coefficients, vcov = vcov(m)) })
}

# Per-KPI containers, filled in the loop below and reused by the insights block.
models   <- list()   # fitted lm objects, keyed by KPI
emm_list <- list()   # named vectors of condition means, keyed by KPI

## === 1. Per-KPI regression, contrast, ranking, pairwise tests ================
for (k in kpis) {

  cat("\n\n###########################################################\n")
  cat("##  KPI:", k, "\n")
  cat("###########################################################\n")

  # Keep only rows with a non-NA value for THIS KPI (and a known condition),
  # announcing how many were dropped.
  ok  <- !is.na(dat[[k]]) & !is.na(dat$condition)
  ndr <- sum(!ok)
  if (ndr > 0) cat("NOTE:", ndr, "row(s) dropped due to NA in", k, "or condition.\n")
  d <- dat[ok, c("condition", k), drop = FALSE]
  names(d)[2] <- "kpi"                       # rename the outcome to a stable name
  cat("N analysed:", nrow(d), "\n")

  # Show how many observations each condition has (a quick coverage check).
  tab <- table(factor(d$condition, levels = cond_levels))
  cat("Per-condition N:\n"); print(tab)

  # Guard: need >=3 rows and >=2 non-empty conditions for a meaningful regression.
  nonempty <- sum(tab > 0)
  if (nrow(d) < 3 || nonempty < 2) {
    cat("WARNING: too few observations / <2 non-empty conditions for '", k,
        "'. Skipping regression.\n", sep = "")
    next
  }
  if (any(tab > 0 & tab < 2))
    cat("WARNING: some condition(s) have a single observation; estimates unstable.\n")

  ## 1a. The regression itself: kpi ~ condition (reference = None / no AI).
  ## Wrapped in tryCatch so a degenerate fit warns instead of aborting the run.
  m <- tryCatch(lm(kpi ~ condition, data = d),
                error = function(e) { cat("WARNING: lm() failed for '", k, "': ",
                                          conditionMessage(e), "\n", sep = ""); NULL })
  if (is.null(m)) next
  models[[k]] <- m                            # remember for the insights section

  sm <- summary(m)
  rc <- hc3_coef(m)                           # HC3 robust coef table + vcov
  ct <- rc$coef                               # estimate / robust SE / t / p per term
  cat("\n--- lm(", k, " ~ condition) coefficients [reference = None / no AI; HC3 robust SE] ---\n", sep = "")
  print(round(ct, 4))

  # Annotate each coefficient with a plain significance flag (robust p-values).
  cat("\nSignificance (vs None / no-AI baseline, alpha = 0.05; HC3-robust):\n")
  for (r in seq_len(nrow(ct))) {
    nm <- rownames(ct)[r]; p <- ct[r, 4]
    star <- if (is.na(p)) "NA" else if (p < .001) "***" else if (p < .01) "**" else
            if (p < .05) "*" else if (p < .10) "." else "ns"
    # Strip the "condition" prefix R adds to each factor-dummy name.
    lab <- if (nm == "(Intercept)") "(Intercept = None / no-AI mean)" else sub("^condition", "", nm)
    cat(sprintf("  %-28s  est=%+8.4f  p=%9.4g  %s\n", lab, ct[r, 1], p, star))
  }
  cat(sprintf("\nModel fit:  N = %d,  residual df = %d,  R^2 = %.4f,  Adj R^2 = %.4f\n",
              nrow(d), m$df.residual, sm$r.squared, sm$adj.r.squared))
  # Welch one-way ANOVA omnibus — does NOT assume equal variances or equal n, so
  # it is the right overall test for the unbalanced conditions.
  wa <- tryCatch(oneway.test(kpi ~ condition, data = d, var.equal = FALSE),
                 error = function(e) NULL)
  if (!is.null(wa))
    cat(sprintf("Welch ANOVA F(%.0f, %.1f) = %.3f,  p = %.4g  (unequal-variance omnibus)\n",
                wa$parameter[1], wa$parameter[2], wa$statistic, wa$p.value))

  ## 1b. PRIMARY PLANNED CONTRAST: Solo - Group  (= AI timing).
  ## Both levels are coded vs the same reference, so the contrast equals
  ## b_Solo - b_Group (the intercept and the Both term cancel). As a weight
  ## vector L over the coefficients this is L = c(0, 1, -1, 0); its variance is
  ## L' vcov(m) L, giving SE, t, and a two-sided p on the residual df.
  cat("\n--- PRIMARY PLANNED CONTRAST: Solo (Individual + AI) - Group (Group + AI) ---\n")
  cn <- names(coef(m))                        # coefficient names, to build L by name
  b_ind_nm <- "conditionSolo"; b_grp_nm <- "conditionGroup"
  if (all(c(b_ind_nm, b_grp_nm) %in% cn)) {   # both conditions present in the model
    L <- setNames(rep(0, length(cn)), cn); L[b_ind_nm] <- 1; L[b_grp_nm] <- -1
    est <- sum(L * coef(m))                   # the contrast estimate
    V <- rc$vcov                              # HC3 robust covariance matrix
    se  <- sqrt(as.numeric(t(L) %*% V %*% L)) # robust SE of the linear combination
    dfres <- m$df.residual; tval <- est / se
    pval <- 2 * pt(abs(tval), df = dfres, lower.tail = FALSE)  # two-sided p
    tc <- tcrit(dfres)
    cat(sprintf("  estimate = %+0.4f\n  SE       = %0.4f\n", est, se))
    cat(sprintf("  t(%d)     = %0.3f\n  p(two-sided) = %0.4g\n", dfres, tval, pval))
    cat(sprintf("  95%% CI   = [%+0.4f, %+0.4f]\n", est - tc * se, est + tc * se))
    cat("  Positive => Solo (solo-stage AI) scores higher than Group on", k, "\n")
  } else {
    cat("  WARNING: Solo / Group absent (empty cell); contrast not estimable.\n")
  }

  ## 1c. Condition means (these equal the EMMs for a single-factor model),
  ## stored for the insights section and printed best->worst here.
  cat("\n--- Condition means (EMM) ranked BEST -> WORST ---\n")
  emm <- tapply(d$kpi, factor(d$condition, levels = cond_levels), mean)  # mean per level
  emm_list[[k]] <- emm
  ord <- order(emm, decreasing = TRUE, na.last = NA); rk <- emm[ord]
  for (i in seq_along(rk)) cat(sprintf("  %d. %-20s  mean = %0.4f\n", i, names(rk)[i], rk[i]))

  ## 1d. All pairwise condition comparisons with a Holm family-wise correction.
  ## pool.sd = FALSE → each pair uses Welch (separate variances), so unequal
  ## condition sizes/variances don't distort the comparisons. Wrapped so a
  ## failure warns instead of aborting.
  cat("\n--- Pairwise t-tests (Welch / unequal-variance, Holm-adjusted p-values) ---\n")
  ptt <- tryCatch(
    pairwise.t.test(d$kpi, factor(d$condition, levels = cond_levels),
                    p.adjust.method = "holm", pool.sd = FALSE),
    error = function(e) { cat("  WARNING: pairwise.t.test failed: ",
                              conditionMessage(e), "\n", sep = ""); NULL })
  if (!is.null(ptt)) {
    print(round(ptt$p.value, 4))              # the adjusted p-value matrix
    pm <- ptt$p.value; any_sig <- FALSE
    cat("\n  Significant pairwise differences (Holm p < 0.05):\n")
    for (i in seq_len(nrow(pm))) for (j in seq_len(ncol(pm))) {
      p <- pm[i, j]
      if (!is.na(p) && p < 0.05) {
        any_sig <- TRUE
        cat(sprintf("    %-20s vs %-20s : p = %0.4g  *\n", rownames(pm)[i], colnames(pm)[j], p))
      }
    }
    if (!any_sig) cat("    (none reach Holm-adjusted p < 0.05)\n")
  }
}

## === 2. Plots ================================================================
## Larger fonts + generous margins so titles/labels/ticks are legible on the page
## and in the exported PDF.
par(cex.main = 1.6, cex.lab = 1.4, cex.axis = 1.3, font.main = 2,
    mar = c(6, 6, 5, 2) + 0.1, mgp = c(3.6, 1, 0))

## 2a. Per-KPI barplot of condition means with 95% CI error bars.
for (k in kpis) {
  ok <- !is.na(dat[[k]]) & !is.na(dat$condition)
  d  <- data.frame(condition = factor(dat$condition[ok], levels = cond_levels), kpi = dat[[k]][ok])
  if (nrow(d) == 0) { cat("Plot skipped (no data) for", k, "\n"); next }
  mu <- tapply(d$kpi, d$condition, mean)      # mean per condition
  s  <- tapply(d$kpi, d$condition, sd)        # SD per condition
  n  <- tapply(d$kpi, d$condition, length)    # n per condition
  se <- s / sqrt(n)                           # standard error of the mean
  # per-group t critical value (NA when n<2 so no bar is drawn for that cell)
  tc <- mapply(function(nn) if (!is.na(nn) && nn > 1) qt(0.975, nn - 1) else NA_real_, n)
  ci <- tc * se                               # 95% CI half-width per condition
  mu_p <- ifelse(is.na(mu), 0, mu); lo <- mu - ci; hi <- mu + ci
  yr <- c(0, max(c(hi, mu_p, 1), na.rm = TRUE) * 1.18)
  nlab <- paste0(cond_short, "\n(n=", ifelse(is.na(n), 0, n), ")")   # show n under each bar
  bp <- barplot(mu_p, names.arg = nlab, col = cond_col, border = NA, ylim = yr, las = 1,
                main = paste0("Average ", k, " by condition\n(bar = mean, whisker = 95% CI)"),
                ylab = paste0("Mean ", k, " (1-7)"), xlab = "")
  valid <- !is.na(ci) & !is.na(mu)            # draw error bars only where defined
  if (any(valid))
    arrows(x0 = bp[valid], y0 = lo[valid], x1 = bp[valid], y1 = hi[valid],
           angle = 90, code = 3, length = 0.08, lwd = 2.5, col = "black")
  text(bp, mu_p, labels = ifelse(is.na(mu), "NA", sprintf("%.2f", mu)),
       pos = 3, offset = 0.8, cex = 1.3, font = 2)   # annotate each bar with its mean
  abline(h = 0, col = "grey70")
}

## 2b. Per-KPI coefficient/forest plot: each condition's difference from no-AI.
for (k in kpis) {
  m <- models[[k]]
  if (is.null(m)) { cat("Coef plot skipped (no model) for", k, "\n"); next }
  rc <- hc3_coef(m); ct <- rc$coef; dfres <- m$df.residual; tc <- tcrit(dfres)
  eff_rows <- rownames(ct) != "(Intercept)"   # the non-intercept (dummy) effects
  est <- ct[eff_rows, 1]; se <- ct[eff_rows, 2]; pv <- ct[eff_rows, 4]
  labs <- sub("^condition", "", rownames(ct)[eff_rows])
  # keep a fixed left-to-right order of effects for readability
  want <- c("Solo", "Group", "Both")
  idx  <- match(want, labs); idx <- idx[!is.na(idx)]
  est <- est[idx]; se <- se[idx]; pv <- pv[idx]; labs <- labs[idx]
  if (length(est) == 0) { cat("Coef plot skipped (no effects) for", k, "\n"); next }
  lo <- est - tc * se; hi <- est + tc * se    # 95% CI per effect (HC3 robust)
  yy <- rev(seq_along(est))                    # top-to-bottom row positions
  xr <- range(c(lo, hi, 0), na.rm = TRUE); xr <- xr + c(-1, 1) * 0.12 * diff(xr)
  plot(NA, xlim = xr, ylim = c(0.5, length(est) + 0.5), yaxt = "n",
       xlab = "Difference from no-AI (points on 1-7)", ylab = "",
       main = paste0(k, ": each condition vs no-AI (None)\n(dot = difference, bar = 95% CI; red = significant)"))
  axis(2, at = yy, labels = paste0(labs, " vs None"), las = 1)
  abline(v = 0, lty = 2, lwd = 2, col = "red")  # zero = no difference from baseline
  segments(lo, yy, hi, yy, lwd = 3, col = "grey40")   # the CI bars
  sig <- !is.na(pv) & pv < 0.05
  points(est, yy, pch = 19, cex = 2.4, col = ifelse(sig, "#D62728", "#1F77B4"))  # red if sig
  text(est, yy, labels = sprintf("%+.2f%s", est, ifelse(sig, "*", "")), pos = 3, offset = 0.9, cex = 1.25, font = 2, xpd = NA)
  legend("topright", bty = "n", pch = 19, pt.cex = 1.6, col = c("#D62728", "#1F77B4"),
         legend = c("significant (p < 0.05)", "not significant"), cex = 1.15)
}

## === 3. INSIGHTS (plain-language read-out of the regressions above) ==========
cat("\n\n##############################################################\n")
cat("# INSIGHTS  (read directly off the regression results above)\n")
cat("##############################################################\n")

# Remind the reader what the condition codes mean (Set A / placement encoding).
cat("\nCondition encoding (Set A / placement):\n")
for (cc in cond_levels) cat(sprintf("    %-6s = %s\n", cc, cond_paper[[cc]]))

# Which of the four conditions actually have data, and which are missing.
cond_counts <- table(factor(dat$condition, levels = cond_levels))
present <- cond_levels[cond_counts > 0]
missing <- setdiff(cond_levels, present)

# Coverage check — e.g. "Full AI" not collected yet — flagged loudly and excluded
# from the rankings below.
if (length(missing) > 0) {
  cat("\nDATA-COVERAGE CHECK: NO data was collected for condition(s): ",
      paste(missing, collapse = ", "), ".\n", sep = "")
  cat("  -> Excluded from every ranking and comparison below; no conclusion can\n")
  cat("     be drawn about them until data for that condition is collected.\n")
}
cat("\nConditions with data (", length(present), " of 4): ",
    paste(present, collapse = ", "), ".\n", sep = "")

for (k in kpis) {
  cat("\n--------------------------------------------------------------\n")
  cat("KPI:", k, "\n")
  cat("--------------------------------------------------------------\n")
  m <- models[[k]]; emm <- emm_list[[k]]
  if (is.null(m) || is.null(emm)) {            # KPI not estimable
    cat("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.\n"); next
  }
  # Rank the present conditions by mean (drop any NA means).
  emm_p <- emm[present]; emm_p <- emm_p[!is.na(emm_p)]
  ord <- order(emm_p, decreasing = TRUE)
  cat("  Ranking of conditions (best -> worst), by mean:\n")
  for (i in seq_along(ord))
    cat(sprintf("    %d. %-18s  mean = %.3f\n", i, names(emm_p)[ord][i], emm_p[ord][i]))

  # Each present condition vs the no-AI baseline, with significance, read off the
  # HC3 robust coefficient table (so unequal condition sizes are accounted for).
  rc <- hc3_coef(m); ct <- rc$coef
  cat("  Versus the 'None' (no-AI) baseline:\n")
  any_sig <- FALSE
  for (c in present) {
    if (c == "None") next
    nm <- paste0("condition", c)               # R's coefficient name for this level
    if (nm %in% rownames(ct)) {
      b <- ct[nm, 1]; p <- ct[nm, 4]
      dir <- if (b >= 0) "higher" else "lower"
      verdict <- if (p < 0.05) "significant" else "not significant"
      if (!is.na(p) && p < 0.05) any_sig <- TRUE
      cat(sprintf("    - %s: %.2f points %s (p = %.3f, %s)\n", c, abs(b), dir, p, verdict))
    }
  }
  if (!any_sig) cat("    (no condition differs significantly from baseline on this KPI)\n")

  # The pre-registered AI-timing contrast, recomputed from the coefficients and
  # summarised in one sentence.
  cn <- names(coef(m)); ni <- "conditionSolo"; ng <- "conditionGroup"
  if (all(c(ni, ng) %in% cn)) {
    L <- setNames(rep(0, length(cn)), cn); L[ni] <- 1; L[ng] <- -1
    est <- sum(L * coef(m)); se <- sqrt(as.numeric(t(L) %*% rc$vcov %*% L))
    pv <- 2 * pt(abs(est / se), df = m$df.residual, lower.tail = FALSE)
    winner <- if (est >= 0) "Solo" else "Group"
    how <- if (pv < 0.05) "significantly" else "but NOT significantly"
    cat(sprintf("  AI timing (Solo vs Group): %s scores %.2f higher, %s (p = %.3f).\n",
                winner, abs(est), how, pv))
  }
  cat(sprintf("  => Best on %s: '%s'.  Worst: '%s'.\n", k,
              names(emm_p)[ord][1], names(emm_p)[ord][length(ord)]))
}

# Compact one-line ranking per KPI for a quick cross-KPI comparison.
cat("\n--------------------------------------------------------------\n")
cat("CONDITION RANKING PER KPI (best -> worst):\n")
cat("--------------------------------------------------------------\n")
for (k in kpis) {
  emm <- emm_list[[k]]
  if (is.null(emm)) { cat(sprintf("  %-16s: (not estimable)\n", k)); next }
  emm_p <- emm[present]; emm_p <- emm_p[!is.na(emm_p)]
  ord <- order(emm_p, decreasing = TRUE)
  cat(sprintf("  %-16s: %s\n", k,
              paste(sprintf("%s (%.2f)", names(emm_p)[ord], emm_p[ord]), collapse = "  >  ")))
}
if (length(missing) > 0)
  cat("\n  Reminder: ", paste(missing, collapse = ", "),
      " had NO data and is omitted from all of the above.\n", sep = "")
cat("\nDone.\n")
