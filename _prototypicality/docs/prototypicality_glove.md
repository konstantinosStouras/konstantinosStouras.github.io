# GloVe path: scoring an idea from a precomputed co-occurrence model

This file covers the second way to compute Toubia and Netzer prototypicality, using a precomputed
co-occurrence model (GloVe) instead of live document counts. It is the companion to
`prototypicality_scoring.md`, which covers the Wikipedia path. The two share the same core and the same
scoring logic. Only the relatedness signal differs.

Everything here is shipped as real Python files you run from the command line, not as code to copy out
of a document. The files are listed below.

## What this path is

The cosine between two GloVe word vectors is used as the edge weight, in place of the Jaccard count
from documents. GloVe is built from a global word by word co-occurrence matrix, so it is the same
quantity the paper estimates from 50 pages, only at web scale and already computed. The corpus is
fixed, public, and the same on every run, so the score is reproducible.

GloVe vectors are global, not topic specific. You recover the topic conditioning the original method
prized by restricting the network nodes to a topic vocabulary, which is exactly what the build step
does from your topic documents.

One rule to keep. This stays a sweet-spot measure. The cosine is used per pair of stems to weight
edges, and then the same prototype and KS steps follow. Do not collapse the idea into a single vector
and measure its distance from an average document. The paper showed that move predicts creativity in
the wrong direction.

Why the prototype still needs documents. The benchmark is the average of document level edge weight
distributions, and that averaging is the part of the method that puts the prototype at a good balance.
So the build step reads a small set of on-topic documents, uses cosine for the edges, and averages
their distributions. The documents can be the Wikipedia neighborhood from the other file, or a set of
pretest ideas, or a handful of seed paragraphs.

## Files

- `proto_core.py`  the shared core (tokenizing, vocabulary, edges, prototype, KS). Same file the
  Wikipedia path uses.
- `glove_loader.py`  reads a GloVe text file but keeps only the vectors you need.
- `score_glove.py`  the command line tool. It has two steps, `build` and `score`.
- `topic_docs_sample.txt`  a tiny example of topic documents, one per line.
- `ideas_sample.csv`  a tiny example ideas file with `title` and `description` columns.

Put these in one folder and run the commands below from inside it.

## Setup

Install the two dependencies:

```
pip install nltk numpy
```

Download a GloVe text file once and keep it. The common choice is `glove.6B.300d.txt`. Get the
`glove.6B.zip` archive from the GloVe project page at Stanford NLP, unzip it, and note the path to the
300d file. If you want web scale vectors, the `glove.42B.300d` or `glove.840B.300d` files are larger
and trained on Common Crawl. Any of them works. The build step only reads the words it needs, so a
large file is fine.

**Which file: `glove.6B.100d.txt` or `glove.6B.300d.txt`?** The `6B` is the training corpus (6 billion
tokens, Wikipedia 2014 + Gigaword 5). The `100d` / `300d` is the **dimension** of each word vector — how
many numbers represent each word. All the `6B` files come from the same corpus and the same vocabulary;
they differ only in vector length. More dimensions capture finer relationships, so the cosine (which is
this method's edge weight) is a bit more faithful. `300d` is the recommended default and barely slower
here, since the build step only loads the handful of words it needs. `100d` is smaller and fine for a
quick run. **Whatever you pick, use the same file for `build` and `score`** — the prototype is built
from it, so mixing dimensions between the two steps makes the comparison less valid. If you already
built with `100d` and want `300d`, just rebuild the model with `300d` and re-score.

Prepare your topic documents. Two ways, pick one:

- A text file with one document per line. See `topic_docs_sample.txt`. This is the simplest.
- A folder of `.txt` files, each file being one document.

For a real run, use more than a handful of documents. A larger, on-topic set gives a bigger vocabulary
and a steadier prototype. Reusing the Wikipedia neighborhood from the other file is a good source: save
each cached article's text as a line or a file, then point the build step at it.

## Step 1: build the model

This reads the topic documents and the GloVe file, computes the vocabulary, the cosine edges, and the
prototype, and saves them to a small JSON. Run it once per topic.

```
python score_glove.py build --glove glove.6B.300d.txt --docs topic_docs_sample.txt --model glove_model.json
```

Useful flags:

- `--glove`  path to the GloVe text file. Required.
- `--docs`  a text file with one document per line. Use this or `--docs-dir`.
- `--docs-dir`  a folder of `.txt` files, one document each.
- `--model`  where to save the model JSON. Default `glove_model.json`.
- `--min-doc-count`  how many documents a stem must appear in to become a node. The default is about
  2 percent of the document count (at least 2). Raise it to drop generic words, lower it to keep more
  nodes so more ideas are scorable.

Example output from the sample documents:

```
Built model from 10 documents.
  vocabulary stems: 12
  stems with a GloVe vector: 12
  edges: 66
  min_doc_count: 2
Saved model to glove_model.json
```

The build step is the only step that touches the GloVe file. After this, scoring is fast and needs
only the model JSON.

## Step 2: score ideas

### One idea

```
python score_glove.py score --model glove_model.json --title "Color-shifting jacket lining" --description "thermochromic dye that changes color as body heat rises during exercise"
```

Output:

```json
{
  "scorable": true,
  "ks": 0.2952,
  "prototypicality": 0.7048,
  "n_nodes": 6,
  "n_edges": 15,
  "score_mode": "closed"
}
```

### A batch of ideas from a CSV

The CSV needs a `description` column and ideally a `title` column. Any other columns you have are
carried through to the output untouched.

```
python score_glove.py score --model glove_model.json --ideas ideas_sample.csv --out ideas_with_prototypicality.csv
```

Output on screen:

```
Scored 3 ideas. Wrote ideas_with_prototypicality.csv
  2 on the topic vocabulary (closed mode), 1 not scorable.
```

The written `ideas_with_prototypicality.csv` has your original columns plus six new ones
(`ks, prototypicality, n_nodes, n_edges, scorable, score_mode`):

```
title,description,ks,prototypicality,n_nodes,n_edges,scorable,score_mode
Color-shifting jacket lining,a jacket lining woven with thermochromic dye ...,0.2952,0.7048,6,15,True,closed
Sweat-reveal training shirt,a workout shirt with temperature sensitive pigment ...,,,1,0,False,
Random gadget,a small plastic widget that beeps,,,0,0,False,
```

This sample also shows the main thing to watch. With only ten documents the vocabulary is tiny, so
two of the three ideas do not have enough on-topic stems to score and come back as `False`. A real
corpus fixes this — and so does **open mode** (next section), which scores an idea from its own words
when the topic vocabulary is too narrow. The off-topic "Random gadget" lands at zero nodes either way,
which is the correct signal that it sits outside the topic.

### Closed mode, open mode, and the rescue (important)

By default scoring runs in **closed mode**: an idea's network is built only from its words that are in
the topic vocabulary that `build` learned. This is fast and topic-specific, but an idea whose words
fall outside that vocabulary gets fewer than two nodes and comes back `scorable: false` with a blank
KPI — even if it is a perfectly good, on-topic idea that happens to use different words.

Passing `--glove` at score time turns on the **open-mode rescue**: any idea closed mode cannot score
is re-scored from **all of its own content words that have a GloVe vector**, still benchmarked against
the topic prototype. Topic-specific closed scores are kept for ideas that already had enough in-vocab
words. The new `score_mode` column records how each idea was scored — `closed`, `open`, or blank
(genuinely fewer than two content words, e.g. an idea literally titled "no").

```
# rescue the misses, keep closed scores where possible
python score_glove.py score --model glove_model.json --ideas ideas.xlsx --glove glove.6B.300d.txt --out scored.xlsx

# score EVERY idea the same way (open mode) for full comparability across rows
python score_glove.py score --model glove_model.json --ideas ideas.xlsx --glove glove.6B.300d.txt --open-only --out scored.xlsx
```

Use the **same GloVe file** for `build` and `score`: the prototype is built from it, and the open-mode
idea edges should be on the same scale.

Extra score-time flags:

- `--glove`  path to the GloVe file. Enables the open-mode rescue described above.
- `--open-only`  with `--glove`, score every idea in open mode (not only the closed-mode misses).

## Reading the result

- `ks` is the distance to the prototype, 0 to 1, smaller means closer to the balanced benchmark.
- `prototypicality` is `1 - ks`, so higher reads as better.
- `n_nodes` and `n_edges` show how much of the idea actually landed in the network. Small values mean
  the score rests on little, so treat it with care.
- `score_mode` is `closed` (scored on the topic vocabulary), `open` (rescued from the idea's own
  words), or blank (not scorable).
- `scorable: false` means fewer than two of the idea's stems formed an edge to score. Widen the
  document set, lower `--min-doc-count`, pass `--glove` for the open-mode rescue, or accept that the
  idea is outside the topic the network was built for.

## How an LLM runs this

The contract is the same as the other file. Input is an idea as `{"title": ..., "description": ...}`.
Output is the JSON above. The LLM runs the tool and reports what comes back. It does not invent numbers.

One time, per topic:

1. Make sure `glove.6B.300d.txt` is present and the topic documents are ready.
2. Run the `build` command. This produces `glove_model.json`.

Per idea or per batch:

1. For one idea, run the `score` command with `--title` and `--description` and report the JSON.
2. For many ideas, run the `score` command with `--ideas yourfile.csv --out scored.csv` and report the
   path plus a short read of the score column.

If the LLM has a Python environment rather than a shell, it can import the same functions directly:

```python
import json
from score_glove import load_model, score_one

vocab, edges, proto, meta = load_model("glove_model.json")
idea = {"title": "Color-shifting jacket lining",
        "description": "thermochromic dye that changes color as body heat rises during exercise"}
print(json.dumps(score_one(idea, vocab, edges, proto), indent=2))
```

## Comparing the two paths

To report both signals for the same idea, build a Wikipedia model from the other file and a GloVe model
from here over the same documents, then score the idea against each. Same idea, same nodes, same KS
step, two relatedness signals. The Wikipedia number reflects real document co-occurrence in a frozen
corpus. The GloVe number reflects pretrained global relatedness. Where they agree you can be more
confident. Where they differ, the gap is usually about how topic specific the signal is, since GloVe
is global and Wikipedia is the local neighborhood.

## Limits and caveats

Same boundary as the original method. The bag of stems carries no word sense, no syntax, and no notion
of whether the idea is useful or feasible. This scores the novelty and balance side of creativity, not
the value side. Use it as a first pass filter that flags ideas worth a closer human look, not as a
verdict.

A note on stems and vectors. GloVe stores vectors for surface words, not for stems. The build step sets
each stem's vector to the average of the vectors of its surface words, which matches the paper's view
that a stem stands for a small group of words. Stems with no vector at all are dropped, and the build
step reports how many nodes survived.

A lighter setup with no documents is possible but weaker. You can grow a topic vocabulary from a few
seed words by taking each seed's nearest neighbors in GloVe, then use the distribution of all pairwise
cosines in that vocabulary as the prototype. This skips the averaging over documents, which is the part
that makes the prototype sit at a good balance, so treat it as a fallback rather than the main method.

---

*Reference: Toubia, O. and Netzer, O. (2017). Idea Generation, Creativity, and Prototypicality.
Marketing Science 36(1), 1 to 20.*
