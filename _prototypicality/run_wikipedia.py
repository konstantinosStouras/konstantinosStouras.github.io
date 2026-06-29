# run_wikipedia.py
# Wikipedia path: build the network from real document co-occurrence (Jaccard) over a
# frozen Wikipedia neighborhood, then score an idea. This is the true drop-in for the
# original paper's live web pages. Compare its number with the GloVe path (score_glove.py)
# over the same documents: same nodes, same KS step, two relatedness signals.
#
# Dependencies: pip install nltk numpy requests
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
