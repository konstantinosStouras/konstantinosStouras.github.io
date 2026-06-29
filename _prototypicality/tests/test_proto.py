#!/usr/bin/env python3
# test_proto.py
# Offline self-test for the prototypicality core and the GloVe-path scoring control flow.
# Needs no GloVe file and no network: it builds a tiny model from deterministic synthetic
# vectors and checks the maths and the closed / open / open-only behaviour.
#
# Run either way:
#   python tests/test_proto.py        (prints PASS lines, exits non-zero on failure)
#   pytest tests/test_proto.py
import os, sys, hashlib
import numpy as np

# Make the package modules importable when run from anywhere.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import proto_core as pc
import glove_loader
import score_glove as sg


def _vec(word, dim=8):
    """A deterministic pseudo-vector for a word, so the test is reproducible."""
    seed = int.from_bytes(hashlib.sha256(word.encode()).digest()[:8], "big")
    out = []
    for _ in range(dim):
        seed = (seed * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        out.append(seed / 2**64 * 2 - 1)
    return np.asarray(out, dtype=np.float32)


# Words chosen so the Porter stemmer leaves them unchanged (surface == stem).
VOCAB = ["alpha", "beta", "gamma", "delta"]
OUT_OF_VOCAB = ["rocket", "fuel", "motor"]
ALL_WORDS = VOCAB + OUT_OF_VOCAB
VECTORS = {w: _vec(w) for w in ALL_WORDS}
S2W = {w: {w} for w in ALL_WORDS}

# A tiny topic corpus (each inner list is one document's stems) and the resulting model.
DOCS = [["alpha", "beta", "gamma"], ["beta", "gamma", "delta"], ["alpha", "gamma", "delta"]]
EDGES, KEPT = pc.glove_edges(VOCAB, S2W, VECTORS)
PROTO = pc.prototypical_cdf(DOCS, KEPT, EDGES)


def test_edges_in_unit_interval():
    assert KEPT == VOCAB, "all four stems have a vector, so all should be kept"
    assert len(EDGES) == 6, "C(4,2) = 6 edges expected"
    assert all(0.0 <= w <= 1.0 for w in EDGES.values()), "edge weights must be in [0,1]"


def test_prototype_is_a_valid_cdf():
    assert PROTO.shape == pc.GRID.shape
    assert PROTO.min() >= 0.0 and PROTO.max() <= 1.0
    assert np.all(np.diff(PROTO) >= -1e-9), "a CDF is non-decreasing"


def test_scorable_idea_has_consistent_ks():
    res = pc.score_stems(["alpha", "beta", "gamma"], KEPT, EDGES, PROTO)
    assert res["scorable"] is True
    assert 0.0 <= res["ks"] <= 1.0
    assert abs(res["prototypicality"] - (1.0 - res["ks"])) < 1e-12
    assert res["n_nodes"] == 3 and res["n_edges"] == 3


def test_one_node_is_not_scorable():
    res = pc.score_stems(["alpha"], KEPT, EDGES, PROTO)
    assert res["scorable"] is False and res["n_nodes"] == 1 and res["n_edges"] == 0


def test_off_topic_idea_is_not_scorable_in_closed_mode():
    res = pc.score_stems(["rocket", "fuel"], KEPT, EDGES, PROTO)
    assert res["scorable"] is False and res["n_nodes"] == 0


def test_score_idea_closed():
    idea = {"title": "alpha beta", "description": "gamma idea"}
    res, mode = sg.score_idea(idea, KEPT, EDGES, PROTO, open_vectors=None, open_only=False)
    assert mode == "closed" and res["scorable"] is True


def test_score_idea_open_rescue():
    # Out-of-topic idea: closed mode cannot score it, but with vectors it is rescued in open mode.
    idea = {"title": "rocket fuel", "description": "motor"}
    res_closed, mode_closed = sg.score_idea(idea, KEPT, EDGES, PROTO, open_vectors=None, open_only=False)
    assert mode_closed == "" and res_closed["scorable"] is False
    res_open, mode_open = sg.score_idea(idea, KEPT, EDGES, PROTO, open_vectors=VECTORS, open_only=False)
    assert mode_open == "open" and res_open["scorable"] is True
    assert 0.0 <= res_open["ks"] <= 1.0


def test_score_idea_open_only():
    idea = {"title": "alpha beta", "description": "gamma idea"}
    res, mode = sg.score_idea(idea, KEPT, EDGES, PROTO, open_vectors=VECTORS, open_only=True)
    assert mode == "open" and res["scorable"] is True


def test_tiny_idea_never_scorable():
    # "no" is a stop word and too short, so there are zero content words.
    idea = {"title": "no", "description": "no"}
    res, mode = sg.score_idea(idea, KEPT, EDGES, PROTO, open_vectors=VECTORS, open_only=False)
    assert mode == "" and res["scorable"] is False


def test_glove_loader_empty_needed(tmp_path=None):
    # An empty needed-set returns {} without touching the file (path need not exist).
    assert glove_loader.load_glove("this_file_does_not_exist.txt", set()) == {}


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"[PASS] {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"[FAIL] {t.__name__}: {e}")
        except Exception as e:  # noqa
            failed += 1
            print(f"[ERROR] {t.__name__}: {type(e).__name__}: {e}")
    print()
    if failed:
        print(f"{failed} test(s) failed.")
        return 1
    print(f"ALL {len(tests)} SELF-TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(_run_all())
