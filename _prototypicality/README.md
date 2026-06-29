# Prototypicality — Toubia & Netzer idea scoring

A small, self-contained project that scores an idea (`title` + `description`) on
**prototypicality** in the sense of Toubia & Netzer (2017): build a semantic network of word
stems, weight each pair of stems by how related they are in text about the topic, average the
documents' edge-weight distributions into a *prototype*, and score an idea by the
Kolmogorov–Smirnov distance between its own edge-weight distribution and that prototype.

```
prototypicality = 1 − ks        # higher = closer to the balanced "prototype" = more prototypical
```

It is a **sweet-spot** measure, not a maximum-novelty one. The idea is never collapsed into a
single vector; the per-pair edge weights and the distribution machinery are what carry the meaning.

This folder is the home of **KPI 1 (Prototypicality)**, which the deterministic KPI script in
`../_idea-kpi-script/` deliberately leaves to this tool. The leading `_` keeps GitHub Pages /
Jekyll from publishing it. Everything here is self-contained — you can copy this folder out and
`git init` it as its own repository with no other dependency on this site.

## Two relatedness signals (same core, same KS step)

| Path | Edge weight | Corpus | Script |
|---|---|---|---|
| **GloVe** (recommended, what you'll usually run) | cosine of GloVe word vectors | a small set of on-topic documents (for the prototype) + a pretrained GloVe file | `score_glove.py` |
| **Wikipedia** | Jaccard co-occurrence across articles | a frozen Wikipedia neighborhood you fetch & cache | `run_wikipedia.py` |

Run both over the same documents to get two comparable numbers for the same idea.

## Files

```
proto_core.py        shared core: tokenise/stem, vocabulary, edges (Jaccard + GloVe), prototype, KS
glove_loader.py      reads a GloVe text file, keeping only the vectors you need
score_glove.py       GloVe-path CLI: `build` a topic model once, then `score` ideas
wiki_corpus.py       Wikipedia-path corpus fetcher/cacher (needs `requests`)
run_wikipedia.py     Wikipedia-path runner
build_and_score.bat  one-click Windows build + score for the GloVe path
requirements.txt     core deps (nltk, numpy, openpyxl)
requirements-wiki.txt extra dep for the Wikipedia path (requests)
docs/                the method write-ups (prototypicality_scoring.md, prototypicality_glove.md)
samples/             topic_docs_sample.txt, topic_docs_thermochromic.txt, ideas_sample.csv
tests/test_proto.py  offline self-test (no GloVe, no network)
```

## Install

```bat
pip install -r requirements.txt
```

Download a GloVe file once (e.g. `glove.6B.300d.txt` from the Stanford NLP GloVe page) and keep it
locally. The `6B` is the training corpus; the `100d`/`300d` is the vector dimension — `300d` is the
recommended default. **Use the same GloVe file for `build` and `score`.** See
`docs/prototypicality_glove.md` for the full discussion.

## Quickstart (GloVe path)

```bat
REM 1) Build the topic model once. This is the only step that reads the big GloVe file.
python score_glove.py build --glove glove.6B.300d.txt --docs samples\topic_docs_thermochromic.txt --model glove_model.json

REM 2) Score a workbook (or CSV) of ideas with the open-mode rescue on.
python score_glove.py score --model glove_model.json --ideas ideas.xlsx --glove glove.6B.300d.txt --out ideas_with_prototypicality.xlsx
```

The output adds six columns: `ks, prototypicality, n_nodes, n_edges, scorable, score_mode`.
(On Windows you can also just double-click `update_prototypicality.bat`, which runs that score
step in its own folder and writes `ideas_with_prototypicality.xlsx`. The default output name when
`--out` is omitted is also `ideas_with_prototypicality.xlsx`.)

## Closed mode vs. open mode — why some ideas would otherwise get a blank KPI

- **Closed mode** (no `--glove` at score time): an idea is scored only on its words that are in the
  topic vocabulary `build` learned. Fast and topic-specific, but an idea whose words fall outside that
  vocabulary gets fewer than two nodes and comes back **not scorable** (blank KPI) — even if it is a
  good, on-topic idea that simply uses different words.
- **Open mode** (`--glove …` at score time): any idea closed mode can't score is **rescued** by
  scoring it from all of its own GloVe content words, still benchmarked against the topic prototype.
  Nearly every idea with two real content words then gets a KPI. `score_mode` records `closed` / `open`
  / blank. Add `--open-only` to score *every* idea in open mode for full comparability.

If you only want closed scores but too many ideas are unscorable, grow the vocabulary by lowering
`--min-doc-count` (e.g. `2`) at build time, or by adding more on-topic lines to your documents file.
For a cross-domain set of ideas, open mode is the better tool.

## Self-test

```bat
python tests\test_proto.py
```

Every line should read `[PASS]`, ending in `ALL SELF-TESTS PASSED`. Needs no GloVe file and no
network — it builds a tiny model from synthetic vectors and checks the maths and the closed / open /
open-only behaviour.

## Wikipedia path (optional)

```bat
pip install -r requirements-wiki.txt
python run_wikipedia.py
```

Edits the `SEEDS` list in `run_wikipedia.py` to bracket your topic. It fetches and caches the
Wikipedia neighborhood, builds the Jaccard network, and scores an example idea.

---

*Reference: Toubia, O. and Netzer, O. (2017). Idea Generation, Creativity, and Prototypicality.
Marketing Science 36(1), 1–20.*
