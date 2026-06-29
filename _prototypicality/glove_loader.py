# glove_loader.py
# Read a GloVe text file but keep only the vectors we need, to save memory.
import numpy as np

def load_glove(path, needed_words):
    """
    Return {word: vector} for every word in needed_words that the GloVe file has.
    Only the needed words are kept, so a multi-gigabyte GloVe file is read once
    without holding the whole vocabulary in memory.
    """
    needed = set(needed_words)
    vectors = {}
    if not needed:            # nothing to look up: skip scanning the (possibly huge) file
        return vectors
    with open(path, encoding="utf-8") as f:
        for line in f:
            sp = line.rstrip().split(" ")
            if len(sp) < 2:   # blank or malformed line (no vector); skip it
                continue
            w = sp[0]
            if w in needed:
                vectors[w] = np.asarray(sp[1:], dtype=np.float32)
                if len(vectors) == len(needed):
                    break      # found them all; no need to read the rest of the file
    return vectors
