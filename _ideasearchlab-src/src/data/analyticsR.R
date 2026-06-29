###############################################################################
# Effects of AI Timing on Idea Generation (AsPredicted #298152) — R ANALYSIS
###############################################################################
#
# WHAT THIS SCRIPT PRODUCES
#   Four regression tables (Tables 3–6, after Boussioux/Lakhani et al. 2024, Org
#   Sci), for THIS study's conditions (baseline = None) and EVERY KPI that has data
#   across the three sources scored on the page:
#     • AI-generated (3.2):        novelty / usefulness / overall_quality   (1–5)
#     • External evaluators (3.3): ext_novelty / ext_usefulness / ext_quality (1–5)
#     • Deterministic/objective (3.1): det_novelty / det_distinctiveness / det_score (0–1)
#   One table column per available KPI, so conditions can be compared on every
#   measure side by side:
#     T3 KPI level ~ Any AY;  T4 KPI level ~ Solo+Group+Both
#     T5 P(top 5/5) ~ Any AI; T6 P(top 5/5) ~ Solo+Group+Both  (1–5 KPIs only)
#   Then the planned AI-timing contrast (Solo−Group) per KPI, an INSIGHTS read-out,
#   plots, and a machine-readable copy (between BEGIN/END markers) the page turns
#   into the Section-6 tables + LaTeX/PDF. Base R only (runs in WebR).
#
# UNBALANCED & PARTIAL COVERAGE
#   Rows are the FINAL ideas. Conditions have different n and KPIs have different
#   coverage (e.g. AI scored but not evaluator-rated). Each KPI's models are fitted
#   on the rows that HAVE that KPI, with HC3 robust SEs; a condition with < MIN_CELL
#   ideas for a KPI (or an absent None baseline) is dropped and shown as "—".
#
# DATA: the page mounts the scored dataset at /tmp/data.csv (one row per idea):
#   idea_id, session, condition, phase, group_id, author_id, the KPI columns above,
#   final_pick, text. Edit freely, then Run.
###############################################################################

# ── Configuration ────────────────────────────────────────────────────────────
REFERENCE   <- "None"
COND_LEVELS <- c("None", "Solo", "Group", "Both")
COND_PAPER  <- c(None  = "Human-Only Hybrid (AI in neither stage)",
                 Solo  = "Individual + AI (AI in solo stage only)",
                 Group = "Group + AI (AI in group stage only)",
                 Both  = "Full AI (AI in both stages)")

# KPI registry: key, label, on-the-1-5-scale? (TRUE => a top-rating Tables 5/6 makes
# sense). Keep in sync with analyticsData.js / analyticsPython.py.
KPI_KEYS   <- c("novelty","usefulness","overall_quality",
                "ext_novelty","ext_usefulness","ext_quality",
                "det_novelty","det_distinctiveness","det_score")
KPI_LABELS <- c(novelty="AI Novelty", usefulness="AI Usefulness", overall_quality="AI Quality",
                ext_novelty="Eval Novelty", ext_usefulness="Eval Usefulness", ext_quality="Eval Quality",
                det_novelty="Obj Novelty", det_distinctiveness="Obj Distinct.", det_score="Obj Score")
KPI_SCALE5 <- c(novelty=TRUE, usefulness=TRUE, overall_quality=TRUE,
                ext_novelty=TRUE, ext_usefulness=TRUE, ext_quality=TRUE,
                det_novelty=FALSE, det_distinctiveness=FALSE, det_score=FALSE)

TOP_RATING   <- 5.0
USE_CONTROLS <- FALSE
MIN_RESID_DF_FOR_CONTROLS <- 8
MIN_CELL     <- 2
PRIMARY_CONTRAST <- c("Solo", "Group")

# ── Formatting helpers (match the Python tab) ─────────────────────────────────
star_of <- function(p) {
  if (is.na(p)) return("")
  if (p < .001) return("***"); if (p < .01) return("**")
  if (p < .05)  return("*");   if (p < .10) return("."); ""
}
fmt_est <- function(est, p) { if (round(est, 3) == 0) est <- 0; sprintf("%.3f%s", est, star_of(p)) }
fmt_se  <- function(se) sprintf("(%.3f)", se)
DASH <- "n/a"   # ASCII sentinel; the page renders it as an em dash "—"

# HC3 robust covariance for an lm (base R only). Returns coef matrix + vcov.
hc3_coef <- function(m) {
  tryCatch({
    X <- model.matrix(m); e <- residuals(m)
    h <- pmin(hatvalues(m), 1 - 1e-8)
    bread <- solve(crossprod(X))
    meat  <- t(X) %*% (X * (e^2 / (1 - h)^2))
    V <- bread %*% meat %*% bread
    est <- coef(m); se <- sqrt(diag(V)); dfr <- m$df.residual
    tval <- est / se; p <- 2 * pt(abs(tval), dfr, lower.tail = FALSE)
    list(coef = cbind(Estimate = est, `Std. Error` = se, `t value` = tval, `Pr(>|t|)` = p), vcov = V)
  }, error = function(err) { sm <- summary(m); list(coef = sm$coefficients, vcov = vcov(m)) })
}

# ── 1. Load + clean + derive ─────────────────────────────────────────────────
load_prepare <- function() {
  dat <- read.csv("/tmp/data.csv", stringsAsFactors = FALSE)
  n0 <- nrow(dat)
  if (!"condition" %in% names(dat)) stop("required column 'condition' missing from data.")

  unknown <- setdiff(unique(dat$condition), COND_LEVELS)
  if (length(unknown) > 0) {
    cat("NOTE: dropping rows with unexpected condition label(s): ",
        paste(shQuote(unknown), collapse = ", "), "\n", sep = "")
    dat <- dat[dat$condition %in% COND_LEVELS, , drop = FALSE]
  }
  for (k in KPI_KEYS) if (k %in% names(dat)) dat[[k]] <- suppressWarnings(as.numeric(dat[[k]]))
  cat(sprintf("NOTE: rows in: %d; rows kept (known condition): %d.\n\n", n0, nrow(dat)))
  if (nrow(dat) == 0) return(dat)

  dat$ai    <- as.integer(dat$condition != REFERENCE)
  dat$solo  <- as.integer(dat$condition == "Solo")
  dat$group <- as.integer(dat$condition == "Group")
  dat$both  <- as.integer(dat$condition == "Both")
  ph <- tolower(if (is.null(dat$phase)) rep("", nrow(dat)) else as.character(dat$phase))
  dat$stage_group <- as.integer(grepl("group", ph))
  tx <- if (is.null(dat$text)) rep("", nrow(dat)) else as.character(dat$text)
  dat$word_count  <- lengths(strsplit(trimws(tx), "\\s+"))
  # Top-rating binaries for present 1–5 KPIs only; NA where the KPI is missing.
  for (k in KPI_KEYS) if (isTRUE(KPI_SCALE5[[k]]) && k %in% names(dat)) {
    dat[[paste0("top_", k)]] <- ifelse(is.na(dat[[k]]), NA_real_, as.numeric(dat[[k]] >= TOP_RATING))
  }
  dat
}

present_kpis <- function(dat) KPI_KEYS[sapply(KPI_KEYS, function(k) k %in% names(dat) && any(!is.na(dat[[k]])))]

control_terms <- function(dat) {
  if (!USE_CONTROLS) return(character(0))
  terms <- character(0)
  if (length(unique(dat$word_count)) > 1)  terms <- c(terms, "word_count")
  if (length(unique(dat$stage_group)) > 1) terms <- c(terms, "stage_group")
  if (length(terms) > 0 && (nrow(dat) - (4 + length(terms))) < MIN_RESID_DF_FOR_CONTROLS) {
    cat("NOTE: too few rows for controls; fitting without them.\n"); return(character(0))
  }
  terms
}

# Condition dummies large enough to enter a model, computed on a given subset.
reference_ok <- function(sub) sum(sub$condition == REFERENCE) >= MIN_CELL
split_terms  <- function(sub) {
  if (!reference_ok(sub)) return(character(0))
  c("solo","group","both")[sapply(c("solo","group","both"), function(x) sum(sub[[x]]) >= MIN_CELL)]
}
collapsed_term <- function(sub) {
  if (!reference_ok(sub)) return(character(0))
  if (sum(sub$condition != REFERENCE) >= MIN_CELL) "ai" else character(0)
}

# ── 2. Fit one OLS / LPM on a KPI's subset; returns list(m, ct) or NULL ───────
fit_one <- function(sub, dv, treatment_terms, controls) {
  if (length(treatment_terms) == 0) return(NULL)
  if (length(unique(sub[[dv]])) < 2) return(NULL)
  n_params <- 1 + length(treatment_terms) + length(controls)
  if (nrow(sub) - n_params < 2) return(NULL)
  rhs <- paste(c(treatment_terms, controls), collapse = " + ")
  m <- tryCatch(lm(as.formula(paste(dv, "~", rhs)), data = sub), error = function(e) NULL)
  if (is.null(m)) return(NULL)
  list(m = m, ct = hc3_coef(m)$coef)
}

cell_of <- function(entry, term) {
  if (is.null(entry) || is.null(entry$ct)) return(NULL)
  ct <- entry$ct
  if (!term %in% rownames(ct)) return(NULL)
  est <- ct[term, 1]; se <- ct[term, 2]
  # Drop non-finite OR numerically-degenerate (≈0) SEs so Python and R agree on a
  # perfectly-separated LPM cell (one engine yields ~1e-17, the other NaN).
  if (!is.finite(est) || !is.finite(se) || se <= 1e-8) return(NULL)
  c(est = est, se = se, p = ct[term, 4])
}

# ── 3. Build one table; dvs = named list key->label, each fitted on its subset ─
build_table <- function(dat, num, title, sub_desc, dvs, split, controls) {
  if (split) {
    row_terms  <- c("solo","group","both")
    row_labels <- sprintf(c("Solo (vs %s)","Group (vs %s)","Both (vs %s)"), REFERENCE)
  } else {
    row_terms  <- c("ai"); row_labels <- sprintf("Any AI (vs %s)", REFERENCE)
  }
  keys <- names(dvs); labels <- unlist(dvs, use.names = FALSE)

  fits <- list()
  for (dv in keys) {
    s <- dat[!is.na(dat[[dv]]), , drop = FALSE]
    terms <- if (split) split_terms(s) else collapsed_term(s)
    f0 <- fit_one(s, dv, terms, controls)            # list(m, ct) or NULL
    fits[[dv]] <- list(m = if (is.null(f0)) NULL else f0$m,
                       ct = if (is.null(f0)) NULL else f0$ct, sub = s, terms = terms)
  }

  add_coef <- function(term, label) {
    est <- character(0); se <- character(0)
    for (dv in keys) {
      c0 <- cell_of(fits[[dv]], term)
      est <- c(est, if (is.null(c0)) DASH else fmt_est(c0["est"], c0["p"]))
      se  <- c(se,  if (is.null(c0)) ""   else fmt_se(c0["se"]))
    }
    list(label = label, est = est, se = se)
  }
  coef_rows <- list()
  for (i in seq_along(row_terms)) coef_rows[[length(coef_rows)+1]] <- add_coef(row_terms[i], row_labels[i])
  coef_rows[[length(coef_rows)+1]] <- add_coef("(Intercept)", sprintf("Intercept (%s)", REFERENCE))

  stat_cell <- function(fn) sapply(keys, function(dv) if (is.null(fits[[dv]]$m)) DASH else fn(fits[[dv]]))
  ctrl_label <- if (length(controls) > 0) "Yes" else "No"
  stat_rows <- list(
    list(label = "N (ideas)",          cells = stat_cell(function(f) as.character(length(residuals(f$m))))),
    list(label = "Number of groups",   cells = stat_cell(function(f) as.character(if (!is.null(f$sub$group_id)) length(unique(f$sub$group_id)) else 0))),
    list(label = "Number of sessions", cells = stat_cell(function(f) as.character(if (!is.null(f$sub$session)) length(unique(f$sub$session)) else 0))),
    list(label = "Controls",           cells = stat_cell(function(f) ctrl_label)),
    list(label = "R-squared",          cells = stat_cell(function(f) { r <- summary(f$m)$r.squared; if (is.finite(r)) sprintf("%.3f", r) else DASH })),
    list(label = "Log-likelihood",     cells = stat_cell(function(f) { ll <- as.numeric(logLik(f$m)); if (is.finite(ll)) sprintf("%.1f", ll) else DASH }))
  )

  note <- paste0("Standard errors (HC3 heteroscedasticity-robust) in parentheses. ",
                 "Reference category = None (no AI). . p<.10  * p<.05  ** p<.01  *** p<.001.")
  if (!any(sapply(keys, function(dv) length(fits[[dv]]$terms) > 0))) {
    note <- paste0("NOT ESTIMABLE for any column: each needs the None baseline plus an AI ",
                   "condition with >= 2 ideas for that KPI. ", note)
  }
  list(num = num, title = title, sub = sub_desc, columns = labels,
       coef_rows = coef_rows, stat_rows = stat_rows, note = note, fits = fits)
}

# ── 4. Print a table as aligned text ──────────────────────────────────────────
print_table <- function(t) {
  labels <- c(sapply(t$coef_rows, function(r) r$label), sapply(t$stat_rows, function(r) r$label))
  w0   <- max(nchar(c(labels, "Variable"))) + 2
  colw <- max(13, max(nchar(t$columns)) + 2)
  line <- function(label, cells)
    paste0(formatC(label, width = -w0, flag = " "),
           paste(formatC(as.character(cells), width = colw), collapse = ""))
  bar <- paste(rep("=", w0 + colw * max(1, length(t$columns))), collapse = "")
  cat(bar, "\n"); cat(sprintf("TABLE %d.  %s\n", t$num, t$title))
  cat(sprintf("           %s\n", t$sub)); cat(bar, "\n")
  cat(line("Variable", t$columns), "\n")
  cat(paste(rep("-", nchar(bar)), collapse = ""), "\n")
  for (r in t$coef_rows) {
    cat(line(r$label, r$est), "\n")
    if (any(nzchar(r$se))) cat(line("", r$se), "\n")
  }
  cat(paste(rep("-", nchar(bar)), collapse = ""), "\n")
  for (r in t$stat_rows) cat(line(r$label, r$cells), "\n")
  cat(bar, "\n"); cat(t$note, "\n\n")
}

# ── 5. Machine-readable copy ──────────────────────────────────────────────────
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

# ── 6. Planned contrast Solo − Group, per KPI ─────────────────────────────────
planned_contrast <- function(fit, label) {
  if (is.null(fit) || is.null(fit$m)) return(NULL)
  m <- fit$m; cn <- names(coef(m))
  if (!all(c("solo","group") %in% cn)) return(NULL)
  L <- setNames(rep(0, length(cn)), cn); L["solo"] <- 1; L["group"] <- -1
  est <- sum(L * coef(m)); V <- hc3_coef(m)$vcov
  se <- sqrt(as.numeric(t(L) %*% V %*% L))
  if (!is.finite(est) || !is.finite(se) || se <= 1e-8) return(NULL)
  dfr <- m$df.residual; tval <- est / se
  list(kpi = label, estimate = est, std_err = se, t = tval,
       p_value = 2 * pt(abs(tval), dfr, lower.tail = FALSE))
}

# ── 7. Plots (no-controls condition means, wrapped grid over present KPIs) ─────
make_plots <- function(dat, kpis, present_levels, means_fits) {
  cond_col <- c(None = "#4D4D4D", Solo = "#1F77B4", Group = "#2CA02C", Both = "#D62728")
  grid <- function(n) { nc <- min(3, max(1, n)); c(ceiling(n / nc), nc) }

  # 7a. Per-KPI bar chart of condition means with 95% CI.
  g <- grid(length(kpis))
  par(mfrow = g, cex.main = 1.2, cex.lab = 1.05, cex.axis = 1.0, font.main = 2, mar = c(5, 5, 4, 1) + 0.1)
  for (k in kpis) {
    sub <- dat[!is.na(dat[[k]]) & dat$condition %in% present_levels, ]
    f <- factor(sub$condition, levels = present_levels)
    mu <- tapply(sub[[k]], f, mean); s <- tapply(sub[[k]], f, sd); n <- tapply(sub[[k]], f, length)
    tc <- mapply(function(nn) if (!is.na(nn) && nn > 1) qt(0.975, nn - 1) else NA_real_, n)
    ci <- tc * s / sqrt(n); mu_p <- ifelse(is.na(mu), 0, mu)
    top <- if (isTRUE(KPI_SCALE5[[k]])) 5.2 else 1.05
    yr <- c(0, max(c(mu_p + ifelse(is.na(ci), 0, ci), top * 0.2), na.rm = TRUE) * 1.15)
    nlab <- paste0(present_levels, "\n(n=", ifelse(is.na(n), 0, n), ")")
    bp <- barplot(mu_p, names.arg = nlab, col = cond_col[present_levels], border = NA, ylim = yr, las = 1,
                  main = paste0("Mean ", KPI_LABELS[[k]]), ylab = KPI_LABELS[[k]], xlab = "")
    valid <- !is.na(ci) & !is.na(mu)
    if (any(valid)) arrows(bp[valid], (mu - ci)[valid], bp[valid], (mu + ci)[valid], angle = 90, code = 3, length = 0.06, lwd = 2, col = "black")
    text(bp, mu_p, labels = ifelse(is.na(mu), "NA", sprintf("%.2f", mu)), pos = 3, offset = 0.6, cex = 1.05, font = 2)
    abline(h = 0, col = "grey70")
  }
  cat("Generated figure: average score per condition.\n")

  # 7b. Per-KPI forest plot: each condition's difference from no-AI.
  par(mfrow = grid(length(kpis)), cex.main = 1.15, cex.lab = 1.05, cex.axis = 1.0, font.main = 2, mar = c(5, 7, 4, 1) + 0.1)
  want <- c("solo","group","both"); lab_of <- c(solo = "Solo", group = "Group", both = "Both")
  for (k in kpis) {
    fit <- means_fits[[k]]
    if (is.null(fit)) { plot.new(); title(main = paste0(KPI_LABELS[[k]], " (no model)")); next }
    ct <- fit$ct; dfr <- fit$m$df.residual; tc <- if (dfr > 0) qt(0.975, dfr) else qnorm(0.975)
    keep <- want[want %in% rownames(ct)]
    if (length(keep) == 0) { plot.new(); title(main = paste0(KPI_LABELS[[k]], " (no effects)")); next }
    est <- ct[keep, 1]; se <- ct[keep, 2]; pv <- ct[keep, 4]
    labs <- lab_of[keep]; lo <- est - tc * se; hi <- est + tc * se; yy <- rev(seq_along(est))
    xr <- range(c(lo, hi, 0), na.rm = TRUE); xr <- xr + c(-1, 1) * 0.12 * diff(xr)
    plot(NA, xlim = xr, ylim = c(0.5, length(est) + 0.5), yaxt = "n", ylab = "",
         xlab = "Difference from no-AI", main = KPI_LABELS[[k]])
    axis(2, at = yy, labels = paste0(labs, " vs None"), las = 1)
    abline(v = 0, lty = 2, lwd = 2, col = "red")
    segments(lo, yy, hi, yy, lwd = 3, col = "grey40")
    sig <- !is.na(pv) & pv < 0.05
    points(est, yy, pch = 19, cex = 2, col = ifelse(sig, "#D62728", "#1F77B4"))
    text(est, yy, labels = sprintf("%+.2f%s", est, ifelse(sig, "*", "")), pos = 3, offset = 0.7, cex = 1.05, font = 2, xpd = NA)
  }
}

# ── 8. Insights ───────────────────────────────────────────────────────────────
emm_for <- function(fit, level) {
  if (is.null(fit) || is.null(fit$m)) return(NA_real_)
  co <- coef(fit$m); val <- co["(Intercept)"]
  if (level != REFERENCE) {
    term <- c(Solo = "solo", Group = "group", Both = "both")[[level]]
    if (!term %in% names(co)) return(NA_real_)
    val <- val + co[term]
  }
  as.numeric(val)
}

insights <- function(dat, kpis, means_fits) {
  cat("\n", paste(rep("#", 78), collapse = ""), "\n", sep = "")
  cat("# INSIGHTS  (read directly off the regression results above)\n")
  cat(paste(rep("#", 78), collapse = ""), "\n", sep = "")
  cat("\nCondition encoding (Set A / placement):\n")
  for (cc in COND_LEVELS) cat(sprintf("    %-6s = %s\n", cc, COND_PAPER[[cc]]))

  present <- COND_LEVELS[sapply(COND_LEVELS, function(c) any(dat$condition == c))]
  missing <- setdiff(COND_LEVELS, present)
  if (length(missing) > 0) {
    cat(sprintf("\nDATA-COVERAGE CHECK: NO data was collected for condition(s): %s.\n", paste(missing, collapse = ", ")))
    cat("  -> Excluded from every ranking and comparison below; no conclusion can\n")
    cat("     be drawn about them until data for that condition is collected.\n")
  }
  cat(sprintf("\nConditions with data (%d of 4): %s.\n", length(present), paste(present, collapse = ", ")))

  term <- c(Solo = "solo", Group = "group", Both = "both")
  ranking_by_kpi <- list()
  for (k in kpis) {
    label <- KPI_LABELS[[k]]
    cat("\n", paste(rep("-", 78), collapse = ""), "\n", sep = "")
    cat("KPI:", label, "\n")
    cat(paste(rep("-", 78), collapse = ""), "\n", sep = "")
    fit <- means_fits[[k]]
    if (is.null(fit)) { cat("  Not estimable (need >= 2 conditions with data) - no ranking for this KPI.\n"); ranking_by_kpi[[label]] <- NULL; next }
    means <- sapply(present, function(c) emm_for(fit, c)); means <- means[is.finite(means)]
    ord <- order(means, decreasing = TRUE); ranked <- means[ord]; ranking_by_kpi[[label]] <- ranked
    cat("  Ranking of conditions (best -> worst), by estimated mean:\n")
    for (i in seq_along(ranked)) cat(sprintf("    %d. %-18s  mean = %.3f\n", i, names(ranked)[i], ranked[i]))
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
    pc <- planned_contrast(fit, label)
    if (!is.null(pc)) {
      winner <- if (pc$estimate >= 0) PRIMARY_CONTRAST[1] else PRIMARY_CONTRAST[2]
      how <- if (pc$p_value < 0.05) "significantly" else "but NOT significantly"
      cat(sprintf("  AI timing (%s vs %s): %s scores %.2f higher, %s (p = %.3f).\n",
                  PRIMARY_CONTRAST[1], PRIMARY_CONTRAST[2], winner, abs(pc$estimate), how, pc$p_value))
    }
    cat(sprintf("  => Best on %s: '%s'.  Worst: '%s'.\n", label, names(ranked)[1], names(ranked)[length(ranked)]))
  }

  cat("\n", paste(rep("-", 78), collapse = ""), "\n", sep = "")
  cat("CONDITION RANKING PER KPI (best -> worst):\n")
  cat(paste(rep("-", 78), collapse = ""), "\n", sep = "")
  for (k in kpis) {
    label <- KPI_LABELS[[k]]; ranked <- ranking_by_kpi[[label]]
    if (is.null(ranked)) { cat(sprintf("  %-18s: (not estimable)\n", label)); next }
    cat(sprintf("  %-18s: %s\n", label, paste(sprintf("%s (%.2f)", names(ranked), ranked), collapse = "  >  ")))
  }
  if (length(missing) > 0)
    cat(sprintf("\n  Reminder: %s had NO data and is omitted from all of the above.\n", paste(missing, collapse = ", ")))
  cat("\n")
}

# ── Main driver ──────────────────────────────────────────────────────────────
dat <- load_prepare()
if (nrow(dat) == 0) {
  cat("WARNING: no usable rows after cleaning - nothing to analyse.\n")
} else {
  kpis <- present_kpis(dat)
  if (length(kpis) == 0) {
    cat("WARNING: no KPI columns have any values yet. Score ideas in Step 3 first.\n")
  } else {
    present_levels <- COND_LEVELS[sapply(COND_LEVELS, function(c) any(dat$condition == c))]
    level_dvs <- setNames(as.list(KPI_LABELS[kpis]), kpis)
    # Top KPIs: 1–5 scale, top variable present with variation.
    top_keys <- kpis[sapply(kpis, function(k) {
      tk <- paste0("top_", k)
      isTRUE(KPI_SCALE5[[k]]) && tk %in% names(dat) && any(!is.na(dat[[tk]])) &&
        length(unique(dat[[tk]][!is.na(dat[[tk]])])) > 1
    })]
    top_dvs <- setNames(as.list(paste0("Top ", KPI_LABELS[top_keys])), paste0("top_", top_keys))

    cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
    cat("FINAL-IDEA COUNT PER CONDITION (unit of analysis; unbalanced design)\n")
    cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
    vc <- table(factor(dat$condition, levels = COND_LEVELS))
    for (lvl in COND_LEVELS) {
      flag <- if (lvl %in% present_levels) "" else "   <- NO DATA (skipped)"
      cat(sprintf("    %-6s n = %d%s\n", lvl, as.integer(vc[[lvl]]), flag))
    }
    cat("\nKPI coverage (ideas with a value, by source):\n")
    for (k in kpis) cat(sprintf("    %-18s n = %d / %d\n", KPI_LABELS[[k]], sum(!is.na(dat[[k]])), nrow(dat)))
    cat(sprintf("\nConditions with < %d ideas for a KPI (or an absent None baseline) are dropped\n", MIN_CELL))
    cat("from that KPI's model and shown as '—'. SEs use HC3 robust covariance.\n\n")

    controls <- control_terms(dat)
    tables <- list(
      build_table(dat, 3, "Human-Only vs Any-AI - KPI level by condition",
                  "OLS of each KPI on a single Any-AI dummy (reference = None).", level_dvs, FALSE, controls),
      build_table(dat, 4, "Human-Only vs Solo / Group / Both - KPI level by condition",
                  "OLS of each KPI on the condition dummies (reference = None).", level_dvs, TRUE, controls)
    )
    if (length(top_dvs) > 0) {
      tables <- c(tables, list(
        build_table(dat, 5, "Human-Only vs Any-AI - probability of a top (5/5) rating",
                    "Linear-probability model of P(top) on a single Any-AI dummy (1-5 KPIs only).", top_dvs, FALSE, controls),
        build_table(dat, 6, "Human-Only vs Solo / Group / Both - probability of a top (5/5) rating",
                    "Linear-probability model of P(top) on the condition dummies (1-5 KPIs only).", top_dvs, TRUE, controls)
      ))
    } else {
      cat("NOTE: no 1-5 KPI has variation in its top-rating outcome; Tables 5 & 6 are skipped.\n\n")
    }
    for (t in tables) print_table(t)

    cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
    cat(sprintf("PRIMARY PLANNED CONTRAST:  '%s'  -  '%s'   (AI timing)\n", PRIMARY_CONTRAST[1], PRIMARY_CONTRAST[2]))
    cat(paste(rep("=", 78), collapse = ""), "\n", sep = "")
    split_fits <- tables[[2]]$fits
    contrasts <- Filter(Negate(is.null), lapply(kpis, function(k) planned_contrast(split_fits[[k]], KPI_LABELS[[k]])))
    if (length(contrasts) > 0) {
      cat(sprintf("  %-18s %10s %10s %9s %10s %s\n", "kpi", "estimate", "std_err", "t", "p_value", "sig"))
      for (c in contrasts)
        cat(sprintf("  %-18s %10.4f %10.4f %9.3f %10.4g %s\n", c$kpi, c$estimate, c$std_err, c$t, c$p_value, star_of(c$p_value)))
      cat("Signif. codes: *** p<.001  ** p<.01  * p<.05  . p<.10\n")
      cat("Positive estimate => solo-stage AI (Solo) scores higher than group-stage AI (Group).\n")
    } else {
      cat("No KPI had both contrast levels present - contrast not computed.\n")
    }
    cat("\n")

    means_fits <- setNames(lapply(kpis, function(k) {
      s <- dat[!is.na(dat[[k]]), , drop = FALSE]; fit_one(s, k, split_terms(s), character(0))
    }), kpis)
    insights(dat, kpis, means_fits)

    tryCatch(make_plots(dat, kpis, present_levels, means_fits),
             error = function(e) cat("WARNING: plotting failed:", conditionMessage(e), "\n"))
    emit_machine(tables)
    cat("Done.\n")
  }
}
