# proto_core.py
# Shared core for Toubia and Netzer prototypicality scoring.
# Used by both the Wikipedia path and the GloVe path.
# Dependencies: pip install nltk numpy
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
