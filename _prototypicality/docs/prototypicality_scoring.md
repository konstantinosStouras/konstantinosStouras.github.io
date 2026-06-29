# Scoring an idea with Toubia and Netzer prototypicality

This file shows how to take an idea written as `{title, description}` and return its
prototypicality score in the sense of Toubia and Netzer (2017). It uses the **Wikipedia neighborhood**
as the corpus: real document co-occurrence with the Jaccard index. This is the true drop-in for the
original "50 Google pages". Each Wikipedia article is a document, so the edge weight formula is
unchanged, and the corpus is frozen by date, public, and citable.

There is a second way to compute the same measure, using a **precomputed co-occurrence model (GloVe)**
where the cosine between two word vectors stands in for the document count. Everything related to that
GloVe path lives in a separate file, `prototypicality_glove.md`, along with the runnable scripts and the
command line steps. The two paths share the core in Section 2 below and the same scoring logic, so they
are directly comparable. Only the relatedness signal differs.

The method keeps the original logic intact: build a baseline network of word stems, weight each pair of
stems by how related they are, build a prototypical distribution of edge weights by averaging over
documents, and score an idea by the Kolmogorov-Smirnov distance between its own edge weight distribution
and that prototype. A smaller distance means more prototypical, which the paper links to higher judged
creativity.

The end of the file has the exact procedure an LLM follows to run this.

---

## 1. The method in plain terms

An idea is treated as a bag of word stems. Two stems are joined by an edge whose weight says how
often the two tend to appear together in text about the topic. A high weight is a familiar pairing.
A low weight is a novel pairing. The whole idea is then a small network, and what matters is the
**shape of its edge weight distribution**, not any single pairing.

The benchmark is the **prototypical distribution**: take the topic's documents, compute each
document's edge weight distribution, and average those distributions. By the averaging argument in
the paper, this average sits at a good balance between novelty and familiarity. An idea is scored by
how close its own distribution is to that average, measured with the Kolmogorov-Smirnov statistic
(the largest gap between the two cumulative curves).

Direction of the score:

- `ks` runs from 0 to 1. Smaller is closer to the prototype.
- `prototypicality = 1 - ks` is a convenience so that higher reads as better.

### One thing to protect

This is a **sweet-spot** measure, not a maximum-novelty measure. The paper tested the obvious
shortcut of representing the whole idea as one vector (tf-idf or topic vector) and measuring its
distance from an average document. That predicted creativity in the **wrong direction**: ideas far
from the average document were judged less creative. So do not collapse the idea into a single
embedding and measure distance to a centroid. Keep the per pair edge weights and the distribution
machinery. The same rule applies in the GloVe file: there the cosine is used **per pair of stems** to
build edges, and the same distribution and KS steps follow. The cosine is never used to embed the whole
idea as one point.

---

## 2. Shared core

This module is the same for both paths. The only thing that changes between them is the function that
produces edge weights. Save it as `proto_core.py`.

Dependencies: `pip install nltk numpy`. The first run downloads nothing extra; the Porter stemmer
ships inside nltk.

```python
# proto_core.py
import re, itertools
import numpy as np
from nltk.stem import PorterStemmer

_STEM = PorterStemmer()
_WORD = re.compile(r"[a-z][a-z\-']+")

# A short stop list. Extend it for your topic if generic words leak into the vocabulary.
STOP = set("""
a an the of to in on for and or but with without within into onto from by as at is are was were
be been being this that these those it its their your you we they he she them his her our us i me
my mine can could would should may might will shall do does did done has have had not no nor so
than then too very just also which who whom whose what when where why how all any both each few
more most other some such only own same now
""".split())

def tokenize_and_stem(text):
    """Return (list of stems, dict stem -> set of surface words) for one document."""
    words = _WORD.findall(text.lower())
    stems, s2w = [], {}
    for w in words:
        if w in STOP or len(w) < 3:
            continue
        st = _STEM.stem(w)
        if len(st) < 3:
            continue
        stems.append(st)
        s2w.setdefault(st, set()).add(w)
    return stems, s2w

def merge_s2w(maps):
    """Merge several stem -> words maps into one."""
    out = {}
    for m in maps:
        for k, v in m.items():
            out.setdefault(k, set()).update(v)
    return out

def build_vocab(docs_stems, min_doc_count):
    """Keep stems that appear in at least min_doc_count documents. These are the network nodes."""
    df = {}
    for ds in docs_stems:
        for st in set(ds):
            df[st] = df.get(st, 0) + 1
    return sorted([st for st, c in df.items() if c >= min_doc_count])

# ---------- edge weight backend A: Jaccard over documents (Wikipedia) ----------
def jaccard_edges(vocab, docs_stems):
    """Edge weight = |docs with both| / |docs with either|, over the corpus."""
    vset = set(vocab)
    presence = {st: set() for st in vocab}
    for i, ds in enumerate(docs_stems):
        for st in set(ds) & vset:
            presence[st].add(i)
    edges = {}
    for a, b in itertools.combinations(vocab, 2):
        sa, sb = presence[a], presence[b]
        union = sa | sb
        edges[(a, b)] = (len(sa & sb) / len(union)) if union else 0.0
    return edges

# ---------- edge weight backend B: cosine over GloVe vectors ----------
def glove_edges(vocab, stem_to_words, vectors):
    """
    Edge weight = rescaled cosine of stem vectors.
    A stem's vector is the average of the vectors of its surface words.
    Stems with no vector are dropped, so the function also returns the kept node list.
    Cosine is mapped from [-1, 1] to [0, 1] so that, like Jaccard, higher means more familiar.
    """
    def stem_vec(st):
        vs = [vectors[w] for w in stem_to_words.get(st, {st}) if w in vectors]
        if not vs and st in vectors:
            vs = [vectors[st]]
        return np.mean(vs, axis=0) if vs else None
    vec = {st: stem_vec(st) for st in vocab}
    vec = {st: v for st, v in vec.items() if v is not None}
    kept = [st for st in vocab if st in vec]
    unit = {st: vec[st] / (np.linalg.norm(vec[st]) + 1e-9) for st in kept}
    edges = {}
    for a, b in itertools.combinations(kept, 2):
        cos = float(np.dot(unit[a], unit[b]))
        edges[(a, b)] = (cos + 1.0) / 2.0
    return edges, kept

# ---------- distributions and the KS distance ----------
GRID = np.linspace(0.0, 1.0, 1001)

def _subnetwork_weights(node_list, edges):
    ws = []
    for a, b in itertools.combinations(sorted(set(node_list)), 2):
        key = (a, b) if (a, b) in edges else (b, a)
        if key in edges:
            ws.append(edges[key])
    return ws

def _cdf_on_grid(weights):
    if not weights:
        return None
    w = np.sort(np.asarray(weights, dtype=float))
    return np.searchsorted(w, GRID, side="right") / len(w)

def prototypical_cdf(docs_stems, vocab, edges):
    """Average of each document's subnetwork edge weight CDF. This is the benchmark."""
    vset = set(vocab)
    cdfs = []
    for ds in docs_stems:
        nodes = [st for st in set(ds) if st in vset]
        c = _cdf_on_grid(_subnetwork_weights(nodes, edges))
        if c is not None:
            cdfs.append(c)
    if not cdfs:
        raise ValueError("No usable training documents for the prototype.")
    return np.mean(np.vstack(cdfs), axis=0)

def score_stems(idea_stems, vocab, edges, proto_cdf):
    """Score one idea, already tokenized to stems."""
    vset = set(vocab)
    nodes = [st for st in set(idea_stems) if st in vset]
    ws = _subnetwork_weights(nodes, edges)
    if len(ws) < 1:
        return {"scorable": False, "reason": "fewer than two idea stems are in the vocabulary",
                "n_nodes": len(nodes), "n_edges": 0}
    ks = float(np.max(np.abs(_cdf_on_grid(ws) - proto_cdf)))
    return {"scorable": True, "ks": ks, "prototypicality": 1.0 - ks,
            "n_nodes": len(nodes), "n_edges": len(ws)}

def idea_to_text(idea):
    """Combine the title and description into one document string."""
    return f"{idea.get('title') or ''}. {idea.get('description') or ''}".strip()
```

A note on the shared core. This is the same `proto_core.py` that the GloVe file uses. It carries both
edge weight backends. `jaccard_edges` is used here for the Wikipedia path. `glove_edges` is used by the
GloVe file. Both return a dictionary keyed by a pair of stems with a weight in `[0, 1]`, and everything
downstream (the prototype, the per idea CDF, the KS distance) is identical. That is what makes the two
paths directly comparable: same nodes, same documents, same KS step, only the relatedness signal
differs.

---

## 3. Path A: Wikipedia neighborhood

### 3.1 Get a frozen corpus

The idea is to pull the Wikipedia articles in the neighborhood of the topic, not all of Wikipedia.
Start from a few seed article titles, fetch their plain text, follow their outgoing links one hop,
fetch those too, and cache everything to disk. Caching is what makes the run reproducible: once the
folder exists, the score never changes, and you can cite the fetch date.

For a stricter form of reproducibility, point this at a dated Wikipedia dump instead of the live API
and parse articles offline. The live API below is the convenient version. Pin it by keeping the cache
folder and recording the date.

Save as `wiki_corpus.py`. Dependency: `pip install requests`.

```python
# wiki_corpus.py
import os, json, time, hashlib
import requests

API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "prototypicality-scorer/1.0 (research use)"}

def _get(params):
    params = {**params, "format": "json"}
    r = requests.get(API, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

def _plaintext(title):
    data = _get({"action": "query", "prop": "extracts", "explaintext": 1,
                 "redirects": 1, "titles": title})
    pages = data.get("query", {}).get("pages", {})
    for _, page in pages.items():
        return page.get("extract", "") or ""
    return ""

def _links(title, limit=60):
    """Main-namespace outgoing links from an article, capped at `limit`."""
    out, cont = [], {}
    while len(out) < limit:
        data = _get({"action": "query", "prop": "links", "titles": title,
                     "plnamespace": 0, "pllimit": "max", **cont})
        pages = data.get("query", {}).get("pages", {})
        for _, page in pages.items():
            for l in page.get("links", []):
                out.append(l["title"])
        if "continue" in data:
            cont = data["continue"]
        else:
            break
    return out[:limit]

def build_corpus(seed_titles, links_per_seed=40, cache_dir="wiki_cache",
                 min_chars=400, pause=0.1):
    """
    Fetch the topic neighborhood and cache each article as a text file.
    Returns a list of (title, text). Re-running reads the cache instead of the network.
    """
    os.makedirs(cache_dir, exist_ok=True)
    titles, seen = list(seed_titles), set()
    for s in seed_titles:
        for t in _links(s, links_per_seed):
            if t not in seen:
                seen.add(t); titles.append(t)

    corpus = []
    for t in titles:
        fn = os.path.join(cache_dir, hashlib.md5(t.encode()).hexdigest() + ".json")
        if os.path.exists(fn):
            rec = json.load(open(fn, encoding="utf-8"))
        else:
            rec = {"title": t, "text": _plaintext(t), "fetched": time.strftime("%Y-%m-%d")}
            json.dump(rec, open(fn, "w", encoding="utf-8"))
            time.sleep(pause)
        if len(rec["text"]) >= min_chars:
            corpus.append((rec["title"], rec["text"]))
    return corpus
```

### 3.2 Build the network and score an idea

Save as `run_wikipedia.py`.

```python
# run_wikipedia.py
import json
from proto_core import (tokenize_and_stem, build_vocab, jaccard_edges,
                        prototypical_cdf, score_stems, idea_to_text)
from wiki_corpus import build_corpus

# 1. Choose seeds that bracket the topic. For a thermochromic fabric task, for example:
SEEDS = ["Thermochromism", "Smart textile", "Wearable technology", "Dye", "Electronic textile"]

# 2. Fetch and cache the neighborhood, then stem every article.
corpus = build_corpus(SEEDS, links_per_seed=40, cache_dir="wiki_cache")
docs_stems = [tokenize_and_stem(text)[0] for _, text in corpus]
print(f"documents: {len(docs_stems)}")

# 3. Baseline vocabulary. The paper kept stems appearing in at least 10 of 50 pages, which is 20%.
#    Match that ratio to your corpus size. Raise it to drop generic words, lower it to keep more nodes.
MIN_DOC_COUNT = max(3, int(0.10 * len(docs_stems)))
vocab = build_vocab(docs_stems, MIN_DOC_COUNT)
print(f"vocabulary size: {len(vocab)} (min_doc_count={MIN_DOC_COUNT})")

# 4. Edge weights from real document co-occurrence, then the prototype.
edges = jaccard_edges(vocab, docs_stems)
proto = prototypical_cdf(docs_stems, vocab, edges)

# 5. Score an idea.
def score_idea(idea):
    stems, _ = tokenize_and_stem(idea_to_text(idea))
    return score_stems(stems, vocab, edges, proto)

if __name__ == "__main__":
    idea = {
        "title": "Color-shifting jacket lining",
        "description": ("a jacket lining woven with thermochromic dye that changes color as your "
                        "body heat rises during exercise, giving a visible read on effort")
    }
    print(json.dumps(score_idea(idea), indent=2))
```

This is the original method with one substitution: the corpus is the Wikipedia neighborhood instead
of 50 live Google pages. Nothing else changes.

---

## 4. The GloVe path lives in its own file

The second way to compute this measure swaps the Jaccard document count for the cosine between two GloVe
word vectors. Everything about that path, including the runnable scripts and the exact command line
steps, is in `prototypicality_glove.md`. The short version:

- It uses the same `proto_core.py` shown in Section 2. The only change is the edge weight backend, which
  becomes `glove_edges` (cosine) instead of `jaccard_edges`.
- It still needs a small set of on-topic documents, because the prototype is the average of document
  level distributions and that averaging is the whole point. Reuse the Wikipedia neighborhood from
  Section 3 as those documents, or supply your own pretest ideas or seed paragraphs.
- GloVe is global, not topic specific. You recover topic conditioning by restricting the nodes to a
  topic vocabulary, which `build_vocab` over your topic documents already does.
- The GloVe file ships three scripts (`proto_core.py`, `glove_loader.py`, `score_glove.py`) plus sample
  inputs, and a `build` then `score` command line flow that writes a score column to a CSV.

Run both paths over the same documents and you get two comparable numbers for the same idea: real
document co-occurrence from Wikipedia, and pretrained global relatedness from GloVe.

---

## 5. How an LLM runs this

The contract is simple. Input is an idea as `{"title": ..., "description": ...}`. Output is a small
JSON object with the score. The LLM does not invent any numbers; it runs the code and reports what
comes back.

**One time setup, per topic:**

1. Decide the topic and pick three to five seed terms that bracket it.
2. Run `build_corpus(seeds)` to fetch and cache the Wikipedia neighborhood. (For the GloVe version of
   this step, follow the `build` command in `prototypicality_glove.md`.)
3. Build the vocabulary, the edges, and the prototype. Keep these in memory for the session.

**Per idea:**

1. Combine title and description into one text with `idea_to_text`.
2. Tokenize and stem it.
3. Call `score_stems`. Report the JSON.

**Reading the result:**

```json
{ "scorable": true, "ks": 0.31, "prototypicality": 0.69, "n_nodes": 7, "n_edges": 21 }
```

- `ks` is the distance to the prototype, 0 to 1, smaller is closer.
- `prototypicality` is `1 - ks`, higher reads as better.
- `n_nodes` and `n_edges` show how much of the idea actually landed in the topic vocabulary. Very small
  values mean the score rests on little, so treat it with care.
- `scorable: false` means fewer than two of the idea's stems were in the vocabulary, so there is no
  edge to score. Widen the corpus, lower `min_doc_count`, or accept that the idea sits outside the
  topic the network was built for.

A minimal driver an LLM can paste and run, once setup has produced `vocab`, `edges`, and `proto`:

```python
def score_idea(idea, vocab, edges, proto):
    from proto_core import tokenize_and_stem, score_stems, idea_to_text
    stems, _ = tokenize_and_stem(idea_to_text(idea))
    return score_stems(stems, vocab, edges, proto)

# usage
result = score_idea(
    {"title": "Color-shifting jacket lining",
     "description": "thermochromic dye that changes color as body heat rises during exercise"},
    vocab, edges, proto)
print(result)
```

To report both signals for the same idea, build the GloVe model from `prototypicality_glove.md` over the
same documents, then run the idea through this Wikipedia model and that GloVe model and print the two
results side by side. Same idea, same machinery, two relatedness signals.

---

## 6. Knobs, limits, and honest caveats

**Knobs worth knowing:**

- `min_doc_count` sets which stems become nodes. The paper used about 20 percent of pages. Higher drops
  generic words and shrinks the network; lower keeps more nodes but lets noise in.
- Seed choice decides the whole neighborhood. A few well chosen brackets around the topic matter more
  than many loose ones.
- `links_per_seed` and the number of articles control how steady the prototype is. More on-topic
  documents give a smoother, more trustworthy average. The same holds for the topic documents in the
  GloVe file.
- The stop list is short on purpose. Add topic specific filler words if they sneak into the vocabulary.

**What this still does not capture.** This is the same boundary the original paper has. The bag of
stems carries no word sense, no syntax, and no notion of whether the idea is useful or feasible. It
scores the novelty and balance side of creativity, not the value side. Treat the number as a first
pass filter that flags ideas worth a closer human look, not as a verdict.

**Why these two corpora and not live Google.** Live scraping drifts day to day and is not reproducible.
A dated Wikipedia neighborhood gives real document co-occurrence that you can freeze and cite. A
pretrained GloVe file gives the same co-occurrence quantity at web scale, already computed, so the
score is stable across runs. Both swap a moving target for a fixed, public one while keeping the
original optimal-balance logic underneath.

**The trap to avoid, once more.** Do not turn the GloVe path into "embed the idea and measure distance
from the average document." That is the move the paper showed predicts creativity backwards. The cosine
is used per pair of stems to weight edges. The distribution and KS steps are what carry the meaning.

---

*Reference: Toubia, O. and Netzer, O. (2017). Idea Generation, Creativity, and Prototypicality.
Marketing Science 36(1), 1 to 20.*
