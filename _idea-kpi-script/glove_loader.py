# glove_loader.py
# Read a GloVe text file but keep only the vectors we need, to save memory.
import numpy as np

def load_glove(path, needed_words):
    needed = set(needed_words)
    vectors = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            sp = line.rstrip().split(" ")
            w = sp[0]
            if w in needed:
                vectors[w] = np.asarray(sp[1:], dtype=np.float32)
    return vectors
