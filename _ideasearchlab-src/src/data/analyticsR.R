###############################################################################
# Effects of AI Timing on Idea Generation (AsPredicted #298152)
# For each KPI (novelty, usefulness, overall_quality): linear regression on the
# 4-level `condition` factor (Human-Only Hybrid = reference), the primary planned
# contrast (Individual + AI  vs  Group + AI), a best->worst ranking, and plots.
# Base R only (stats + graphics) - no external packages. Edit freely, then Run.
#
# The data is mounted at /tmp/data.csv (one row per idea). Columns: idea_id,
# session, condition, phase, group_id, author_id, novelty, usefulness,
# overall_quality, final_pick, text.
###############################################################################

dat <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE)

cat("==========================================================\n")
cat(" AsPredicted #298152: Effects of AI Timing on Idea Generation\n")
cat("==========================================================\n")
cat("Rows read:", nrow(dat), " Columns:", ncol(dat), "\n\n")

cond_levels <- c("Human-Only Hybrid", "Individual + AI", "Group + AI", "Full AI")

unknown <- setdiff(unique(dat$condition), cond_levels)
if (length(unknown) > 0) {
  cat("NOTE: dropping rows with unexpected condition label(s): ",
      paste(shQuote(unknown), collapse = ", "), "\n", sep = "")
  dat <- dat[dat$condition %in% cond_levels, , drop = FALSE]
}

dat$condition <- factor(dat$condition, levels = cond_levels)   # 1st level = reference
kpis <- c("novelty", "usefulness", "overall_quality")
for (k in kpis) dat[[k]] <- suppressWarnings(as.numeric(dat[[k]]))

cond_short <- c("Human-Only", "Indiv+AI", "Group+AI", "Full AI")
cond_col   <- c("#4D4D4D", "#1F77B4", "#2CA02C", "#D62728")

tcrit <- function(df) if (is.finite(df) && df > 0) qt(0.975, df) else qnorm(0.975)

models   <- list()
emm_list <- list()

## === 1. Per-KPI analysis =====================================================
for (k in kpis) {

  cat("\n\n###########################################################\n")
  cat("##  KPI:", k, "\n")
  cat("###########################################################\n")

  ok  <- !is.na(dat[[k]]) & !is.na(dat$condition)
  ndr <- sum(!ok)
  if (ndr > 0) cat("NOTE:", ndr, "row(s) dropped due to NA in", k, "or condition.\n")
  d <- dat[ok, c("condition", k), drop = FALSE]
  names(d)[2] <- "kpi"
  cat("N analysed:", nrow(d), "\n")

  tab <- table(factor(d$condition, levels = cond_levels))
  cat("Per-condition N:\n"); print(tab)

  nonempty <- sum(tab > 0)
  if (nrow(d) < 3 || nonempty < 2) {
    cat("WARNING: too few observations / <2 non-empty conditions for '", k,
        "'. Skipping regression.\n", sep = "")
    next
  }
  if (any(tab > 0 & tab < 2))
    cat("WARNING: some condition(s) have a single observation; estimates unstable.\n")

  ## 1a. Linear regression
  m <- tryCatch(lm(kpi ~ condition, data = d),
                error = function(e) { cat("WARNING: lm() failed for '", k, "': ",
                                          conditionMessage(e), "\n", sep = ""); NULL })
  if (is.null(m)) next
  models[[k]] <- m

  sm <- summary(m)
  cat("\n--- lm(", k, " ~ condition) coefficients [reference = Human-Only Hybrid] ---\n", sep = "")
  ct <- sm$coefficients
  print(round(ct, 4))

  cat("\nSignificance (vs Human-Only Hybrid baseline, alpha = 0.05):\n")
  for (r in seq_len(nrow(ct))) {
    nm <- rownames(ct)[r]; p <- ct[r, 4]
    star <- if (is.na(p)) "NA" else if (p < .001) "***" else if (p < .01) "**" else
            if (p < .05) "*" else if (p < .10) "." else "ns"
    lab <- if (nm == "(Intercept)") "(Intercept = Human-Only Hybrid mean)" else sub("^condition", "", nm)
    cat(sprintf("  %-28s  est=%+8.4f  p=%9.4g  %s\n", lab, ct[r, 1], p, star))
  }
  cat(sprintf("\nModel fit:  N = %d,  residual df = %d,  R^2 = %.4f,  Adj R^2 = %.4f\n",
              nrow(d), m$df.residual, sm$r.squared, sm$adj.r.squared))
  fst <- sm$fstatistic
  if (!is.null(fst)) {
    fp <- pf(fst[1], fst[2], fst[3], lower.tail = FALSE)
    cat(sprintf("Omnibus F(%d, %d) = %.3f,  p = %.4g\n", fst[2], fst[3], fst[1], fp))
  }

  ## 1b. PRIMARY PLANNED CONTRAST: (Individual + AI) - (Group + AI)
  ## Both levels are coded vs the Human-Only reference, so the contrast equals
  ## b_Ind - b_Grp (intercept and Full-AI term cancel). L = c(0, 1, -1, 0).
  cat("\n--- PRIMARY PLANNED CONTRAST: (Individual + AI) - (Group + AI) ---\n")
  cn <- names(coef(m))
  b_ind_nm <- "conditionIndividual + AI"; b_grp_nm <- "conditionGroup + AI"
  if (all(c(b_ind_nm, b_grp_nm) %in% cn)) {
    L <- setNames(rep(0, length(cn)), cn); L[b_ind_nm] <- 1; L[b_grp_nm] <- -1
    est <- sum(L * coef(m)); V <- vcov(m)
    se  <- sqrt(as.numeric(t(L) %*% V %*% L))
    dfres <- m$df.residual; tval <- est / se
    pval <- 2 * pt(abs(tval), df = dfres, lower.tail = FALSE); tc <- tcrit(dfres)
    cat(sprintf("  estimate = %+0.4f\n  SE       = %0.4f\n", est, se))
    cat(sprintf("  t(%d)     = %0.3f\n  p(two-sided) = %0.4g\n", dfres, tval, pval))
    cat(sprintf("  95%% CI   = [%+0.4f, %+0.4f]\n", est - tc * se, est + tc * se))
    cat("  Positive => Individual+AI scores higher than Group+AI on", k, "\n")
  } else {
    cat("  WARNING: Individual+AI / Group+AI absent (empty cell); contrast not estimable.\n")
  }

  ## 1c. Condition means ranked best -> worst
  cat("\n--- Condition means (EMM) ranked BEST -> WORST ---\n")
  emm <- tapply(d$kpi, factor(d$condition, levels = cond_levels), mean)
  emm_list[[k]] <- emm
  ord <- order(emm, decreasing = TRUE, na.last = NA); rk <- emm[ord]
  for (i in seq_along(rk)) cat(sprintf("  %d. %-20s  mean = %0.4f\n", i, names(rk)[i], rk[i]))

  ## 1d. Pairwise comparisons (Holm-adjusted)
  cat("\n--- Pairwise t-tests (pooled SD, Holm-adjusted p-values) ---\n")
  ptt <- tryCatch(
    pairwise.t.test(d$kpi, factor(d$condition, levels = cond_levels),
                    p.adjust.method = "holm", pool.sd = TRUE),
    error = function(e) { cat("  WARNING: pairwise.t.test failed: ",
                              conditionMessage(e), "\n", sep = ""); NULL })
  if (!is.null(ptt)) {
    print(round(ptt$p.value, 4))
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
## 2a. Per-KPI barplot of condition means with 95% CI error bars
for (k in kpis) {
  ok <- !is.na(dat[[k]]) & !is.na(dat$condition)
  d  <- data.frame(condition = factor(dat$condition[ok], levels = cond_levels), kpi = dat[[k]][ok])
  if (nrow(d) == 0) { cat("Plot skipped (no data) for", k, "\n"); next }
  mu <- tapply(d$kpi, d$condition, mean)
  s  <- tapply(d$kpi, d$condition, sd)
  n  <- tapply(d$kpi, d$condition, length)
  se <- s / sqrt(n)
  tc <- mapply(function(nn) if (!is.na(nn) && nn > 1) qt(0.975, nn - 1) else NA_real_, n)
  ci <- tc * se
  mu_p <- ifelse(is.na(mu), 0, mu); lo <- mu - ci; hi <- mu + ci
  yr <- c(min(0, min(c(lo, mu_p, 0), na.rm = TRUE)), max(c(hi, mu_p, 1), na.rm = TRUE) * 1.10)
  bp <- barplot(mu_p, names.arg = cond_short, col = cond_col, border = NA, ylim = yr, las = 1,
                main = paste0("Mean ", k, " by condition (95% CI)"),
                ylab = paste("Mean", k), xlab = "Condition")
  valid <- !is.na(ci) & !is.na(mu)
  if (any(valid))
    arrows(x0 = bp[valid], y0 = lo[valid], x1 = bp[valid], y1 = hi[valid],
           angle = 90, code = 3, length = 0.06, lwd = 2, col = "black")
  text(bp, mu_p, labels = ifelse(is.na(mu), "NA", sprintf("%.2f", mu)),
       pos = 3, offset = 0.6, cex = 0.85, font = 2)
  abline(h = 0, col = "grey70")
}

## 2b. Coefficient / forest plot of condition effects vs baseline
for (k in kpis) {
  m <- models[[k]]
  if (is.null(m)) { cat("Coef plot skipped (no model) for", k, "\n"); next }
  ct <- summary(m)$coefficients; dfres <- m$df.residual; tc <- tcrit(dfres)
  eff_rows <- rownames(ct) != "(Intercept)"
  est <- ct[eff_rows, 1]; se <- ct[eff_rows, 2]; pv <- ct[eff_rows, 4]
  labs <- sub("^condition", "", rownames(ct)[eff_rows])
  want <- c("Individual + AI", "Group + AI", "Full AI")
  idx  <- match(want, labs); idx <- idx[!is.na(idx)]
  est <- est[idx]; se <- se[idx]; pv <- pv[idx]; labs <- labs[idx]
  if (length(est) == 0) { cat("Coef plot skipped (no effects) for", k, "\n"); next }
  lo <- est - tc * se; hi <- est + tc * se
  yy <- rev(seq_along(est))
  xr <- range(c(lo, hi, 0), na.rm = TRUE); xr <- xr + c(-1, 1) * 0.08 * diff(xr)
  plot(NA, xlim = xr, ylim = c(0.5, length(est) + 0.5), yaxt = "n",
       xlab = paste0("Effect on ", k, " vs Human-Only Hybrid"), ylab = "",
       main = paste0("Condition effects on ", k, "\n(coefficients vs baseline, 95% CI)"))
  axis(2, at = yy, labels = labs, las = 1)
  abline(v = 0, lty = 2, col = "grey50")
  segments(lo, yy, hi, yy, lwd = 2, col = "grey30")
  sig <- !is.na(pv) & pv < 0.05
  points(est, yy, pch = 19, cex = 1.4, col = ifelse(sig, "#D62728", "#1F77B4"))
  text(hi, yy, labels = sprintf("%+.2f%s", est, ifelse(sig, "*", "")), pos = 4, cex = 0.8, xpd = NA)
  legend("topright", bty = "n", pch = 19, col = c("#D62728", "#1F77B4"),
         legend = c("p < 0.05", "n.s."), cex = 0.85)
}

## === 3. Cross-KPI ranking summary ===========================================
cat("\n\n==========================================================\n")
cat(" CROSS-KPI SUMMARY: condition means (best -> worst per KPI)\n")
cat("==========================================================\n")
for (k in kpis) {
  emm <- emm_list[[k]]
  if (is.null(emm)) { cat(k, ": not available\n"); next }
  ord <- order(emm, decreasing = TRUE, na.last = NA)
  cat(sprintf("%-16s: %s\n", k,
              paste(sprintf("%s(%.2f)", names(emm)[ord], emm[ord]), collapse = "  >  ")))
}
cat("\nDone.\n")
