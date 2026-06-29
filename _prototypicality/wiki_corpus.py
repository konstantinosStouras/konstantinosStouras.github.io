# wiki_corpus.py
# Build a frozen, citable topic corpus from the Wikipedia neighborhood of a few seed
# articles. Each article is one "document" for the prototypicality method. Everything is
# cached to disk, so a re-run reads the cache instead of the network and the score never
# drifts. This is the reproducible stand-in for the original paper's "50 Google pages".
#
# Dependency (only for this Wikipedia path): pip install requests
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
