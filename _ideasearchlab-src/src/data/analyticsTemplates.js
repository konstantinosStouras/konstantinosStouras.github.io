/**
 * analyticsTemplates.js
 *
 * Default Python and R source shown in the Data Analytics code tabs. The actual
 * code lives in sibling .py / .R files and is inlined at build time via Vite's
 * `?raw` import, so the editors start with real, runnable, syntactically exact
 * scripts (no JS string-escaping of backslashes/quotes to get wrong).
 *
 * Both run the SAME analysis on the SAME dataset (one row per idea, with the
 * experimental condition and the three KPI scores): a per-KPI linear regression
 * of the four conditions against the Human-Only Hybrid baseline, the planned
 * Individual+AI vs Group+AI contrast, a ranking, and plots.
 */
import PYTHON_TEMPLATE from './analyticsPython.py?raw'
import R_TEMPLATE from './analyticsR.R?raw'

export { PYTHON_TEMPLATE, R_TEMPLATE }
