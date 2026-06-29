# Idea-ranking KPIs — local computation script

A small, self-contained Python program that scores and ranks the ideas in the
**Ideation Challenge** aggregate workbook on the objective, deterministic KPIs from
the two study spec files — run entirely on your own machine from the command line.

It is the offline twin of the in-app **Data Analytics → Section 3.1** computation
(`_ideasearchlab-src/src/utils/deterministicKpis.js`): same formulas, same reference
set, same results for the same embeddings.

## What it computes

For each idea (Title + Description):

| KPI | Meaning | Level |
|---|---|---|
| **Novelty** | `1 − max cosine similarity to a reference set R` (distance from products that already exist) | per idea |
| **Distinctiveness** | `1 − mean cosine similarity to the other ideas in the pool` | per idea |
| **Combined score** | `0.5·Novelty + 0.5·Distinctiveness`, with a **rank** within each pool | per idea |
| **Unique fraction** | `connected groups / N`, an edge when similarity `> tau` (reported at tau = 0.75 / 0.80 / 0.85) | per pool |
| **KPI 2 — Productivity** | count of non-redundant, multi-word ideas (near-duplicates within a group merge to one) | per pool |

### Excluded for now (by request)

- **KPI 1 — Prototypicality (KS statistic).** Needs a topic-specific web corpus, Porter
  stemming, a Jaccard semantic network and the prototypical CDF. Deferred — *"will come
  back to add it later."*
- **KPI 3 — Brainstorming creativity.** Defined as the share of ideas below the KS
  creativity cutoff, so it depends on KPI 1 and is deferred together with it.

Both are clearly listed as deferred in the script's JSON output so nothing looks silently
missing.

---

## Where it lives / where to save it

It is already part of this repository, in the (non-published) folder:

```
<repo>\_idea-kpi-script\
    idea_kpis.py              the program
    reference_set.txt         the reference set R (edit to taste)
    requirements.txt          minimum install (openpyxl, numpy)
    requirements-semantic.txt optional, recommended (sentence-transformers)
    run_kpis.bat              one-click Windows runner
    README.md                 this file
```

On the maintainer's machine the repo is at
`C:\Users\User\Documents\GitHub\konstantinosStouras.github.io`, so the folder is
`C:\Users\User\Documents\GitHub\konstantinosStouras.github.io\_idea-kpi-script`.

Put the data file **`idea_analytics_aggregate.xlsx`** (the *Download aggregate Excel*
from the app's Data Analytics page) inside that folder.

---

## What to run on CMD

### Easiest — double-click `run_kpis.bat`

Drop `idea_analytics_aggregate.xlsx` in the folder and double-click `run_kpis.bat`
(or drag any `.xlsx` onto it). It installs the requirements and runs the computation.

### Or, by hand in CMD

```bat
cd C:\Users\User\Documents\GitHub\konstantinosStouras.github.io\_idea-kpi-script
pip install -r requirements.txt
python idea_kpis.py --input idea_analytics_aggregate.xlsx
```

That prints a summary, and writes three files into an `output\` folder:

- `idea_kpis_per_idea.csv` — one row per idea: novelty, distinctiveness, score, rank
- `idea_kpis_pools.csv` — one row per pool: KPI 2 productivity + unique fraction
- `idea_kpis.json` — the full structured results (settings + every idea + every pool)

### Recommended: real semantic embeddings

By default the script uses a built-in **TF-IDF** backend that needs no extra install but
only measures *word overlap* — it is labelled **APPROXIMATE** everywhere it is used. For
meaningful novelty/distinctiveness, install a local sentence-embedding model once:

```bat
pip install -r requirements-semantic.txt
python idea_kpis.py --input idea_analytics_aggregate.xlsx
```

With `sentence-transformers` present, the default `--backend auto` uses it automatically
(first run downloads a ~90 MB model, then works offline). This matches the spec's
instruction to *"prefer a real embedding model over your own intuition."*

---

## Verify it works (self-test)

The KPI maths is checked against the worked examples in the spec files — no data or
embeddings needed:

```bat
python idea_kpis.py --selftest
```

Every line should read `[PASS]`, ending in `ALL SELF-TESTS PASSED`.

---

## Options

```
--input, -i        Path to idea_analytics_aggregate.xlsx (required, unless --selftest)
--sheet            Worksheet with the ideas              (default: Ideas)
--reference, -r    Reference set R file                  (default: reference_set.txt)
--backend          auto | st | tfidf                     (default: auto)
--model            sentence-transformers model name      (default: all-MiniLM-L6-v2)
--pool-by          Pool field: session | condition | stage | group_uid
                   (default: blank = whole file is one pool, like the web app)
--tau              Unique-fraction overlap threshold      (default: 0.8)
--w-novelty        Score weight on novelty                (default: 0.5)
--w-distinct       Score weight on distinctiveness        (default: 0.5)
--dedup-tau        KPI 2 near-duplicate threshold         (default: 0.9)
--min-words        KPI 2 minimum words to keep an idea    (default: 2)
--outdir, -o       Output directory                       (default: output)
--top              How many top ideas to print            (default: 15)
--selftest         Run the worked-example checks and exit
```

Examples:

```bat
REM Score each session as its own pool (distinctiveness, unique fraction, productivity per session)
python idea_kpis.py -i idea_analytics_aggregate.xlsx --pool-by session

REM Compare the four AI conditions as pools, with semantic embeddings
python idea_kpis.py -i idea_analytics_aggregate.xlsx --backend st --pool-by condition
```

---

## Notes on the data

- Rows flagged **`Exclude (Yes/No) = Yes`** in the Ideas sheet are dropped (the
  pre-registered screen), as are blank ideas. Low-quality junk that was *not* flagged
  (e.g. an idea literally titled "no") is still scored — flag it in the workbook's
  `Exclude` column if you want it gone.
- **Condition** is read from the `Condition` column (None / Solo / Group / Both), falling
  back to the `AI Solo (0/1)` × `AI Group (0/1)` dummies.
- **Reproducibility.** Same input + same embedding backend ⇒ same numbers. The absolute
  novelty/distinctiveness values depend on which embedding model you choose, so record the
  backend (the script prints it and stores it in the JSON `settings`).

## Sources

- `idea_ranking_kpis_llm_guide.md` — Lee & Chung (2024); Meincke, Nave & Terwiesch (2025);
  Lee & Chung (2025). Novelty, distinctiveness, unique fraction, combined ranking.
- `llm_kpi_calculation_spec.md` — Bouschery, Blazevic & Piller (2024). KPI 2 productivity
  (and the deferred KPI 1 / KPI 3).
