###############################################################################
# Effects of AI Timing on Idea Generation (AsPredicted #298152) — R ANALYSIS
###############################################################################
#
# WHAT THIS SCRIPT PRODUCES
#   Four regression tables laid out like Tables 3–6 of Boussioux, Lane, Zhang,
#   Jacimovic & Lakhani (2024), "The Crowdless Future? Generative AI and Creative
#   Problem Solving" (Organization Science), adapted to THIS study's three KPIs
#   and four conditions (baseline = None / no AI):
#
#     Table 3  KPI ratings       ~  Any AI              (one AI dummy vs None)
#     Table 4  KPI ratings       ~  Solo + Group + Both (each vs None)
#     Table 5  Top-rated (== 5)  ~  Any AI              (linear probability model)
#     Table 6  Top-rated (== 5)  ~  Solo + Group + Both (linear probability model)
#
#   Tables 3/4 are OLS on the 1–5 KPI score; Tables 5/6 are linear-probability
#   models on a binary "did this idea earn the top rating (5/5)?" — the same split
#   the paper uses. Each table reports the coefficient (with significance stars),
#   its standard error in parentheses, the intercept, N, the number of groups and
#   sessions, whether controls are included, and R² / log-likelihood. The script
#   then prints the planned AI-timing contrast (Solo − Group), an INSIGHTS read-out
#   and two plots, plus a compact machine-readable copy of the tables (between
#   BEGIN/END markers) that the page turns into the formatted "Insights" tables and
#   the LaTeX / PDF export. Base R only — no external packages (so it runs in WebR).
#
# UNIT OF ANALYSIS & UNBALANCED DESIGN
#   Rows are the FINAL ideas (each group's top-voted ideas, Final Group Pick = 1).
#   The conditions have different n and possibly unequal variances, so every model
#   uses HC3 heteroscedasticity-robust SEs (hand-computed; see hc3_coef). Any
#   condition with fewer than MIN_CELL ideas — or an absent None baseline — is
#   dropped from the models and shown as "—" (the per-condition size check).
#
# WHERE THE DATA COMES FROM
#   The page writes the scored dataset to /tmp/data.csv. One row per idea; columns:
#   idea_id, session, condition (None/Solo/Group/Both), phase, group_id, author_id,
#   novelty, usefulness, overall_quality, final_pick, text. Edit freely, then Run.
###############################################################################

# ── Configuration ────────────────────────────────────────────────────────────
REFERENCE       <- "None"                       # the no-AI baseline / reference level
COND_LEVELS     <- c("None", "Solo", "Group", "Both")
COND_PAPER      <- c(None  = "Human-Only Hybrid (AI in neither stage)",
                     Solo  = "Individual + AI (AI in solo stage only)",
                     Group = "Group + AI (AI in group stage only)",
                     Both  = "Full AI (AI in both stages)")
KPIS            <- c("novelty", "usefulness", "overall_quality")
KPI_LABELS      <- c(novelty = "Novelty", usefulness = "Usefulness", overall_quality = "Quality")
TOP_RATING      <- 5.0                          # "top" idea = top of the 1–5 scale
USE_CONTROLS    <- FALSE                         # add word-count + stage controls? (see below)
MIN_RESID_DF_FOR_CONTROLS <- 8
MIN_CELL        <- 2                             # min ideas per condition to enter a model
PRIMARY_CONTRAST <- c("Solo", "Group")          # AI-timing contrast (solo- vs group-stage AI)

# ── Small formatting helpers (match the Python tab's formatting) ──────────────
star_of <- function(p) {
  if (is.na(p)) return("")
  if (p < .001) return("***"); if (p < .01) return("**")
  if (p < .05)  return("*");   if (p < .10) return("."); ""
}
fmt_est <- function(est, p) sprintf("%.3f%s", est, star_of(p))   # coefficient + stars
fmt_se  <- function(se) sprintf("(%.3f)", se)                    # SE in parentheses
# Sentinel for an unestimable cell. Plain ASCII so the text tables align in any
# locale; the page renders it as a real em dash "—" in the formatted tables.
DASH <- "n/a"

# ── HC3 heteroscedasticity-robust covariance for an lm (base R only) ──────────
# The conditions are UNBALANCED and possibly unequal-variance, so we report robust
# SE / t / p instead of the classical equal-variance ones (point estimates are
# unchanged). Returns the robust coefficient matrix + vcov; falls back to the
# classical summary if the linear algebra fails (e.g. a collinear / 1-row cell).
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

# ── 1. Load + clean + derive the analysis columns ────────────────────────────
load_prepare <- function() {
  # stringsAsFactors = FALSE so text/id columns stay character; we build our own
  # numeric dummy columns below (no reliance on R's factor contrasts).
  dat <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE)
  n0 <- nrow(dat)

  for (col in c("condition", KPIS))
    if (!col %in% names(dat)) stop(sprintf("required column '%s' missing from data.", col))

  for (k in KPIS) dat[[k]] <- suppressWarnings(as.numeric(dat[[k]]))

  unknown <- setdiff(unique(dat$condition), COND_LEVELS)
  if (length(unknown) > 0) {
    cat("NOTE: dropping rows with unexpected condition label(s): ",
        paste(shQuote(unknown), collapse = ", "), "\n", sep = "")
    dat <- dat[dat$condition %in% COND_LEVELS, , drop = FALSE]
  }

  # Listwise-drop rows missing ANY KPI so all models share one clean sample.
  ok <- stats::complete.cases(dat[, KPIS])
  if (sum(!ok) > 0) cat("NOTE: dropped", sum(!ok), "row(s) with missing KPI value(s).\n")
  dat <- dat[ok, , drop = FALSE]
  cat(sprintf("NOTE: rows in: %d; rows used for analysis: %d.\n\n", n0, nrow(dat)))
  if (nrow(dat) == 0) return(dat)

  # ── Derived columns ─────────────────────────────────────────────────────────
  dat$ai    <- as.integer(dat$condition != REFERENCE)         # any-AI dummy (Table 3/5)
  dat$solo  <- as.integer(dat$condition == "Solo")            # one dummy per condition
  dat$group <- as.integer(dat$condition == "Group")           # (Table 4/6)
  dat$both  <- as.integer(dat$condition == "Both")
  ph <- tolower(if (is.null(dat$phase)) rep("", nrow(dat)) else as.character(dat$phase))
  dat$stage_group <- as.integer(grepl("group", ph))           # stage control
  tx <- if (is.null(dat$text)) rep("", nrow(dat)) else as.character(dat$text)
  dat$word_count  <- lengths(strsplit(trimws(tx), "\\s+"))    # word-count control
  for (k in KPIS) dat[[paste0("top_", k)]] <- as.integer(dat[[k]] >= TOP_RATING)  # top-rating binaries
  dat
}

# ── Which condition dummies are large enough to enter the models ─────────────
reference_ok <- function(d) sum(d$condition == REFERENCE) >= MIN_CELL
split_terms  <- function(d) {
  if (!reference_ok(d)) return(character(0))
  c("solo", "group", "both")[sapply(c("solo", "group", "both"), function(x) sum(d[[x]]) >= MIN_CELL)]
}
collapsed_term <- function(d) {
  if (!reference_ok(d)) return(character(0))
  if (sum(d$condition != REFERENCE) >= MIN_CELL) "ai" else character(0)
}

# Control terms (word count + stage) — only when USE_CONTROLS is on, they vary, and
# there are enough residual df. Returns a (possibly empty) character vector.
control_terms <- function(d) {
  if (!USE_CONTROLS) return(character(0))
  terms <- character(0)
  if (length(unique(d$word_count)) > 1)  terms <- c(terms, "word_count")
  if (length(unique(d$stage_group)) > 1) terms <- c(terms, "stage_group")
  if (length(terms) > 0 && (nrow(d) - (4 + length(terms))) < MIN_RESID_DF_FOR_CONTROLS) {
    cat("NOTE: too few rows for controls; fitting without them.\n"); return(character(0))
  }
  terms
}

# ── 2. Fit one OLS / LPM per dependent variable ──────────────────────────────
# Returns list(m = lm, ct = HC3 coef matrix) or NULL when not estimable.
fit_one <- function(d, dv, treatment_terms, controls) {
  if (length(treatment_terms) == 0) return(NULL)
  if (length(unique(d[[dv]])) < 2) return(NULL)        # constant outcome (e.g. no "top" idea)
  n_params <- 1 + length(treatment_terms) + length(controls)
  if (nrow(d) - n_params < 2) return(NULL)             # need ≥2 residual df for stable robust SEs
  rhs <- paste(c(treatment_terms, controls), collapse = " + ")
  m <- tryCatch(lm(as.formula(paste(dv, "~", rhs)), data = d), error = function(e) NULL)
  if (is.null(m)) return(NULL)
  list(m = m, ct = hc3_coef(m)$coef)
}

# (estimate, se, p) for one coefficient, or NULL if absent from the model or
# non-finite (degenerate fit) — the latter keeps a stray "NaN"/"Inf" out of the
# machine-readable grammar (it renders as an em dash instead).
cell_of <- function(fit, term) {
  if (is.null(fit)) return(NULL)
  ct <- fit$ct
  if (!term %in% rownames(ct)) return(NULL)
  est <- ct[term, 1]; se <- ct[term, 2]
  if (!is.finite(est) || !is.finite(se)) return(NULL)
  c(est = est, se = se, p = ct[term, 4])
}

# ── 3. Build one table (the shared shape behind Tables 3–6) ──────────────────
build_table <- function(d, num, title, sub, dv_list, dv_labels, split, controls,
                        n_groups, n_sessions) {
  # Fixed display rows (absent/too-small conditions still get a "—" row).
  if (split) {
    row_terms  <- c("solo", "group", "both")
    row_labels <- c(sprintf("Solo (vs %s)", REFERENCE), sprintf("Group (vs %s)", REFERENCE),
                    sprintf("Both (vs %s)", REFERENCE))
    treatment_terms <- split_terms(d)
  } else {
    row_terms  <- c("ai")
    row_labels <- c(sprintf("Any AI (vs %s)", REFERENCE))
    treatment_terms <- collapsed_term(d)
  }

  # Fit every DV on the same RHS so the columns share one specification.
  fits <- lapply(dv_list, function(dv) fit_one(d, dv, treatment_terms, controls))
  names(fits) <- dv_list

  # Coefficient rows: an estimate line + its SE line, per independent variable.
  coef_rows <- list()
  add_coef <- function(term, label) {
    est <- character(0); se <- character(0)
    for (dv in dv_list) {
      c0 <- cell_of(fits[[dv]], term)
      est <- c(est, if (is.null(c0)) DASH else fmt_est(c0["est"], c0["p"]))
      se  <- c(se,  if (is.null(c0)) ""   else fmt_se(c0["se"]))
    }
    list(label = label, est = est, se = se)
  }
  for (i in seq_along(row_terms)) coef_rows[[length(coef_rows) + 1]] <- add_coef(row_terms[i], row_labels[i])
  coef_rows[[length(coef_rows) + 1]] <- add_coef("(Intercept)", sprintf("Intercept (%s)", REFERENCE))

  # Footer statistics, mirroring the paper's footer rows.
  stat_cell <- function(fn) sapply(dv_list, function(dv) if (is.null(fits[[dv]])) DASH else fn(fits[[dv]]$m))
  ctrl_label <- if (length(controls) > 0) "Yes" else "No"
  stat_rows <- list(
    list(label = "N (ideas)",          cells = stat_cell(function(m) as.character(length(residuals(m))))),
    list(label = "Number of groups",   cells = stat_cell(function(m) as.character(n_groups))),
    list(label = "Number of sessions", cells = stat_cell(function(m) as.character(n_sessions))),
    list(label = "Controls",           cells = stat_cell(function(m) ctrl_label)),
    list(label = "R-squared",          cells = stat_cell(function(m) { r <- summary(m)$r.squared; if (is.finite(r)) sprintf("%.3f", r) else DASH })),
    list(label = "Log-likelihood",     cells = stat_cell(function(m) { ll <- as.numeric(logLik(m)); if (is.finite(ll)) sprintf("%.1f", ll) else DASH }))
  )

  note <- paste0("Standard errors (HC3 heteroscedasticity-robust) in parentheses. ",
                 "Reference category = None (no AI). . p<.10  * p<.05  ** p<.01  *** p<.001.")
  if (length(treatment_terms) == 0) {
    reason <- if (!reference_ok(d)) sprintf("Baseline None has < %d ideas", MIN_CELL)
              else sprintf("no AI condition has >= %d ideas", MIN_CELL)
    note <- paste0("NOT ESTIMABLE: ", reason,
                   "; this model needs the None baseline plus an AI condition. ", note)
  }

  list(num = num, title = title, sub = sub, columns = unname(dv_labels[dv_list]),
       coef_rows = coef_rows, stat_rows = stat_rows, note = note, fits = fits)
}

# ── 4. Print a table as aligned text (console + Appendix A) ───────────────────
print_table <- function(t) {
  labels <- c(sapply(t$coef_rows, function(r) r$label), sapply(t$stat_rows, function(r) r$label))
  w0   <- max(nchar(c(labels, "Variable"))) + 2
  colw <- max(14, max(nchar(t$columns)) + 2)
  line <- function(label, cells)
    paste0(formatC(label, width = -w0, flag = " "),
           paste(formatC(as.character(cells), width = colw), collapse = ""))
  bar <- paste(rep("=", w0 + colw * length(t$columns)), collapse = "")
  cat(bar, "\n")
  cat(sprintf("TABLE %d.  %s\n", t$num, t$title))
  cat(sprintf("           %s\n", t$sub))
  cat(bar, "\n")
  cat(line("Variable", t$columns), "\n")
  cat(paste(rep("-", nchar(bar)), collapse = ""), "\n")
  for (r in t$coef_rows) {
    cat(line(r$label, r$est), "\n")
    if (any(nzchar(r$se))) cat(line("", r$se), "\n")
  }
  cat(paste(rep("-", nchar(bar)), collapse = ""), "\n")
  for (r in t$stat_rows) cat(line(r$label, r$cells), "\n")
  cat(bar, "\n")
  cat(t$note, "\n\n")
}

# ── 5. Machine-readable copy of the tables (parsed by the page) ───────────────
# Same grammar as the Python tab (cells separated by "||"); stripped from the
# on-page console and turned into the formatted Insights tables + LaTeX/PDF.
emit_machine <- function(tables) {
  cat("===BEGIN REGRESSION TABLES===\n")
  for (t in tables) {
    cat(sprintf("@@TABLE num=%d||%s||%s\n", t$num, t$title, t$sub))
    cat(paste0("@@HEAD Variable||", paste(t$columns, collapse = "||")), "\n", sep = "")
    for (r in t$coef_rows) {
      cat(paste0("@@COEF ", r$label, "||", paste(r$est, collapse = "||")), "\n", sep = "")
      if (any(nzchar(r$se))) cat(paste0("@@SE ||", paste(r$se, collapse = "||")), "\n", sep = "")
    }
    cat("@@RULE\n")
    for (r in t$stat_rows)
      cat(paste0("@@STAT ", r$label, "||", paste(as.character(r$cells), collapse = "||")), "\n", sep = "")
    cat(paste0("@@NOTE ", t$note), "\n", sep = "")
    cat("@@ENDTABLE\n")
  }
  cat("===END REGRESSION TABLES===\n\n")
}

# ── 6. Primary planned contrast: Solo − Group (AI timing) ─────────────────────
planned_contrast <- function(fit, kpi) {
  if (is.null(fit)) return(NULL)
  m <- fit$m; cn <- names(coef(m))
  if (!all(c("solo", "group") %in% cn)) return(NULL)
  L <- setNames(rep(0, length(cn)), cn); L["solo"] <- 1; L["group"] <- -1
  est <- sum(L * coef(m))
  V <- hc3_coef(m)$vcov
  se <- sqrt(as.numeric(t(L) %*% V %*% L))
  if (!is.finite(est) || !is.finite(se)) return(NULL)   # non-estimable contrast → skip
  dfr <- m$df.residual; tval <- est / se
  list(kpi = kpi, estimate = est, std_err = se, t = tval,
       p_value = 2 * pt(abs(tval), dfr, lower.tail = FALSE))
}

# ── 7. Plots (use no-controls condition means for interpretability) ──────────
make_plots <- function(d, present_levels, means_fits) {
  cond_col <- c(None = "#4D4D4D", Solo = "#1F77B4", Group = "#2CA02C", Both = "#D62728")
  par(cex.main = 1.5, cex.lab = 1.35, cex.axis = 1.25, font.main = 2,
      mar = c(6, 6, 5, 2) + 0.1, mgp = c(3.6, 1, 0))

  # 7a. Per-KPI barplot of condition means with 95% CI error bars.
  for (k in KPIS) {
    sub <- d[d$condition %in% present_levels, ]
    mu <- tapply(sub[[k]], factor(sub$condition, levels = present_levels), mean)
    s  <- tapply(sub[[k]], factor(sub$condition, levels = present_levels), sd)
    n  <- tapply(sub[[k]], factor(sub$condition, levels = present_levels), length)
    tc <- mapply(function(nn) if (!is.na(nn) && nn > 1) qt(0.975, nn - 1) else NA_real_, n)
    ci <- tc * s / sqrt(n)
    mu_p <- ifelse(is.na(mu), 0, mu)
    yr <- c(0, max(c(mu_p + ifelse(is.na(ci), 0, ci), 1), na.rm = TRUE) * 1.18)
    nlab <- paste0(present_levels, "\n(n=", ifelse(is.na(n), 0, n), ")")
    bp <- barplot(mu_p, names.arg = nlab, col = cond_col[present_levels], border = NA,
                  ylim = yr, las = 1, ylab = paste0("Mean ", KPI_LABELS[k], " (1-5)"), xlab = "",
                  main = paste0("Average ", KPI_LABELS[k], " by condition\n(bar = mean, whisker = 95% CI)"))
    valid <- !is.na(ci) & !is.na(mu)
    if (any(valid)) arrows(bp[valid], (mu - ci)[valid], bp[valid], (mu + ci)[valid],
                           angle = 90, code = 3, length = 0.08, lwd = 2.5, col = "black")
    text(bp, mu_p, labels = ifelse(is.na(mu), "NA", sprintf("%.2f", mu)),
         pos = 3, offset = 0.8, cex = 1.3, font = 2)
    abline(h = 0, col = "grey70")
  }
  cat("Generated figure: average score per condition.\n")

  # 7b. Per-KPI coefficient/forest plot: each condition's difference from no-AI.
  want <- c("solo", "group", "both"); lab_of <- c(solo = "Solo", group = "Group", both = "Both")
  for (k in KPIS) {
    fit <- means_fits[[k]]
    if (is.null(fit)) { cat("Coef plot skipped (no model) for", k, "\n"); next }
    ct <- fit$ct; dfr <- fit$m$df.residual; tc <- if (dfr > 0) qt(0.975, dfr) else qnorm(0.975)
    keep <- want[want %in% rownames(ct)]
    if (length(keep) == 0) { cat("Coef plot skipped (no effects) for", k, "\n"); next }
    est <- ct[keep, 1]; se <- ct[keep, 2]; pv <- ct[keep, 4]
    labs <- lab_of[keep]; lo <- est - tc * se; hi <- est + tc * se
    yy <- rev(seq_along(est))
    xr <- range(c(lo, hi, 0), na.rm = TRUE); xr <- xr + c(-1, 1) * 0.12 * diff(xr)
    plot(NA, xlim = xr, ylim = c(0.5, length(est) + 0.5), yaxt = "n", ylab = "",
         xlab = "Difference from no-AI (points on 1-5)",
         main = paste0(KPI_LABELS[k], ": each condition vs no-AI (None)\n(dot = difference, bar = 95% CI; red = significant)"))
    axis(2, at = yy, labels = paste0(labs, " vs None"), las = 1)
    abline(v = 0, lty = 2, lwd = 2, col = "red")
    segments(lo, yy, hi, yy, lwd = 3, col = "grey40")
    sig <- !is.na(pv) & pv < 0.05
    points(est, yy, pch = 19, cex = 2.4, col = ifelse(sig, "#D62728", "#1F77B4"))
    text(est, yy, labels = sprintf("%+.2f%s", est, ifelse(sig, "*", "")),
         pos = 3, offset = 0.9, cex = 1.25, font = 2, xpd = NA)
    legend("topright", bty = "n", pch = 19, pt.cex = 1.6, col = c("#D62728", "#1F77B4"),
           legend = c("significant (p < 0.05)", "not significant"), cex = 1.1)
  }
}

# ── 8. Insights (plain-language read-out; drives the page's Insights panel) ───
emm_for <- function(fit, level) {
  if (is.null(fit)) return(NA_real_)
  co <- coef(fit$m)
  val <- co["(Intercept)"]                       # intercept = reference (None) mean
  if (level != REFERENCE) {
    term <- c(Solo = "solo", Group = "group", Both = "both")[[level]]
    if (!term %in% names(co)) return(NA_real_)
    val <- val + co[term]
  }
  as.numeric(val)
}

insights <- function(d, means_fits) {
  cat("\n", paste(rep("#", 78), collapse = ""), "\n", sep = "")
  cat("# INSIGHTS  (read directly off the regression results above)\n")
  cat(paste(rep("#", 78), collapse = ""), "\n", sep = "")

  cat("\nCondition encoding (Set A / placement):\n")
  for (cc in COND_LEVELS) cat(sprintf("    %-6s = %s\n", cc, COND_PAPER[[cc]]))

  present <- COND_LEVELS[sapply(COND_LEVELS, function(c) any(d$condition == c))]
  missing <- setdiff(COND_LEVELS, present)
  if (length(missing) > 0) {
    cat(sprintf("\nDATA-COVERAGE CHECK: NO data was collected for condition(s): %s.\n",
                paste(missing, collapse = ", ")))
    cat("  -> Excluded from every ranking and comparison below; no conclusion can\n")
    cat("     be drawn about them until data for that condition is collected.\n")
  }
  cat(sprintf("\nConditions with data (%d of 4): %s.\n", length(present), paste(present, collapse = ", ")))

  term <- c(Solo = "solo", Group = "group", Both = "both")
  ranking_by_kpi <- list()
  for (k in KPIS) {
    cat("\n", paste(rep("-", 78), collapse = ""), "\n", sep = "")
    cat("KPI:", k, "\n")
    cat(paste(rep("-", 78), collapse = ""), "\n", sep = "")
    fit <- means_fits[[k]]
    if (is.null(fit)) {
      cat("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.\n")
      ranking_by_kpi[[k]] <- NULL; next
    }
    means <- sapply(present, function(c) emm_for(fit, c)); means <- means[is.finite(means)]
    ord <- order(means, decreasing = TRUE); ranked <- means[ord]
    ranking_by_kpi[[k]] <- ranked
    cat("  Ranking of conditions (best -> worst), by estimated mean:\n")
    for (i in seq_along(ranked))
      cat(sprintf("    %d. %-18s  mean = %.3f\n", i, names(ranked)[i], ranked[i]))

    ct <- fit$ct
    cat(sprintf("  Versus the '%s' baseline:\n", REFERENCE))
    any_sig <- FALSE
    for (c in present) {
      if (c == REFERENCE) next
      nm <- term[[c]]
      if (nm %in% rownames(ct)) {
        b <- ct[nm, 1]; p <- ct[nm, 4]
        dir <- if (b >= 0) "higher" else "lower"
        verdict <- if (!is.na(p) && p < 0.05) "significant" else "not significant"
        if (!is.na(p) && p < 0.05) any_sig <- TRUE
        cat(sprintf("    - %s: %.2f points %s (p = %.3f, %s)\n", c, abs(b), dir, p, verdict))
      }
    }
    if (!any_sig) cat("    (no condition differs significantly from baseline on this KPI)\n")

    pc <- planned_contrast(fit, k)
    if (!is.null(pc)) {
      winner <- if (pc$estimate >= 0) PRIMARY_CONTRAST[1] else PRIMARY_CONTRAST[2]
      how <- if (pc$p_value < 0.05) "significantly" else "but NOT significantly"
      cat(sprintf("  AI timing (%s vs %s): %s scores %.2f higher, %s (p = %.3f).\n",
                  PRIMARY_CONTRAST[1], PRIMARY_CONTRAST[2], winner, abs(pc$estimate), how, pc$p_value))
    }
    cat(sprintf("  => Best on %s: '%s'.  Worst: '%s'.\n", k, names(ranked)[1], names(ranked)[length(ranked)]))
  }

  cat("\n", paste(rep("-", 78), collapse = ""), "\n", sep = "")
  cat("CONDITION RANKING PER KPI (best -> worst):\n")
  cat(paste(rep("-", 78), collapse = ""), "\n", sep = "")
  for (k in KPIS) {
    ranked <- ranking_by_kpi[[k]]
    if (is.null(ranked)) { cat(sprintf("  %-16s: (not estimable)\n", k)); next }
    cat(sprintf("  %-16s: %s\n", k,
                paste(sprintf("%s (%.2f)", names(ranked), ranked), collapse = "  >  ")))
  }
  if (length(missing) > 0)
    cat(sprintf("\n  Reminder: %s had NO data and is omitted from all of the above.\n",
                paste(missing, collapse = ", ")))
  cat("\n")
}

# ── Main driver ──────────────────────────────────────────────────────────────
dat <- load_prepare()
if (nrow(dat) == 0) {
  cat("WARNING: no usable rows after cleaning - nothing to analyse.\n")
} else {
  present_levels <- COND_LEVELS[sapply(COND_LEVELS, function(c) any(dat$condition == c))]
  n_groups   <- if (!is.null(dat$group_id)) length(unique(dat$group_id)) else 0
  n_sessions <- if (!is.null(dat$session))  length(unique(dat$session))  else 0

  # Per-condition sample sizes — the design is UNBALANCED, so report n up front.
  cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
  cat("FINAL-IDEA COUNT PER CONDITION (the unit of analysis; unbalanced design)\n")
  cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
  vc <- table(factor(dat$condition, levels = COND_LEVELS))
  for (lvl in COND_LEVELS) {
    flag <- if (lvl %in% present_levels) "" else "   <- NO DATA (skipped)"
    cat(sprintf("    %-6s n = %d%s\n", lvl, as.integer(vc[[lvl]]), flag))
  }
  cat("\nTop-rated ideas (KPI == 5.0), per KPI:\n")
  for (k in KPIS)
    cat(sprintf("    %-10s top = %d / %d\n", KPI_LABELS[[k]], sum(dat[[paste0("top_", k)]]), nrow(dat)))
  cat(sprintf("\nConditions with < %d ideas (or an absent None baseline) are dropped from\n", MIN_CELL))
  cat("the regressions and shown as '—' (no stable robust SE). All SEs / p-values use\n")
  cat("HC3 heteroscedasticity-robust covariance (no equal-variance assumption).\n\n")

  controls   <- control_terms(dat)
  top_kpis   <- paste0("top_", KPIS)
  top_labels <- setNames(paste("Top", KPI_LABELS[KPIS]), top_kpis)

  # ── The four tables (Tables 3–6, paper layout) ──────────────────────────────
  tables <- list(
    build_table(dat, 3, "Human-Only vs Any-AI - average KPI ratings",
                "OLS of each KPI score (1-5) on a single Any-AI dummy (reference = None).",
                KPIS, KPI_LABELS, FALSE, controls, n_groups, n_sessions),
    build_table(dat, 4, "Human-Only vs Solo / Group / Both - average KPI ratings",
                "OLS of each KPI score (1-5) on the condition dummies (reference = None).",
                KPIS, KPI_LABELS, TRUE, controls, n_groups, n_sessions),
    build_table(dat, 5, "Human-Only vs Any-AI - probability of a top (5/5) rating",
                "Linear-probability model of P(top rating) on a single Any-AI dummy (reference = None).",
                top_kpis, top_labels, FALSE, controls, n_groups, n_sessions),
    build_table(dat, 6, "Human-Only vs Solo / Group / Both - probability of a top (5/5) rating",
                "Linear-probability model of P(top rating) on the condition dummies (reference = None).",
                top_kpis, top_labels, TRUE, controls, n_groups, n_sessions)
  )
  for (t in tables) print_table(t)

  # ── Primary planned contrast across KPIs (uses Table 4's split models) ───────
  cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
  cat(sprintf("PRIMARY PLANNED CONTRAST:  '%s'  -  '%s'   (AI timing)\n",
              PRIMARY_CONTRAST[1], PRIMARY_CONTRAST[2]))
  cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
  split_fits <- tables[[2]]$fits                   # Table 4 = KPI ~ conditions
  contrasts <- Filter(Negate(is.null), lapply(KPIS, function(k) planned_contrast(split_fits[[k]], k)))
  if (length(contrasts) > 0) {
    cat(sprintf("  %-16s %10s %10s %9s %10s %s\n", "kpi", "estimate", "std_err", "t", "p_value", "sig"))
    for (c in contrasts)
      cat(sprintf("  %-16s %10.4f %10.4f %9.3f %10.4g %s\n",
                  c$kpi, c$estimate, c$std_err, c$t, c$p_value, star_of(c$p_value)))
    cat("Signif. codes: *** p<.001  ** p<.01  * p<.05  . p<.10\n")
    cat("Positive estimate => solo-stage AI (Solo) scores higher than group-stage AI (Group).\n")
  } else {
    cat("No KPI had both contrast levels present - contrast not computed.\n")
  }
  cat("\n")

  # ── Insights + plots (no-controls condition means for interpretability) ──────
  means_fits <- setNames(lapply(KPIS, function(k) fit_one(dat, k, split_terms(dat), character(0))), KPIS)
  insights(dat, means_fits)

  tryCatch(make_plots(dat, present_levels, means_fits),
           error = function(e) cat("WARNING: plotting failed:", conditionMessage(e), "\n"))

  # Machine-readable copy LAST, so the page can rebuild the four tables.
  emit_machine(tables)
  cat("Done.\n")
}
