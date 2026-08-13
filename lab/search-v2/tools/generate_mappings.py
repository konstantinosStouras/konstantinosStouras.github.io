#!/usr/bin/env python3
"""
search-v2 · tools/generate_mappings.py
The prize-mapping generator of design brief §8, with the random seed hard coded.

    python3 tools/generate_mappings.py                 # print the pool statistics
    python3 tools/generate_mappings.py --out pool.json # write the pool to a file
    python3 tools/generate_mappings.py --parity        # prove it matches the JS

THE POOL IS NEVER COMMITTED (§18). This file and SEEDS.md are what make the study
reproducible; the generated artifact stays out of the repository so that a
participant cannot read the answers out of a file the site serves. The live app
regenerates the identical pool from the same seed at load time (pool.js), and
`upload_run.py` writes it into Firestore for a run.

WHY NOT numpy's PCG64. The brief's reference generator is `np.random.default_rng`,
which cannot be reproduced in a browser — and the whole point of a frozen pool is
that ONE artifact serves every participant. So the canonical PRNG for this
implementation is mulberry32, reimplemented here in exact 32-bit arithmetic. The
--parity mode prints the first draws for a seed; tools/selftest.js prints the same
vector from the JavaScript side, and the two must match digit for digit.
"""
import argparse
import json
import math

MASK = 0xFFFFFFFF


def _u32(x):
    return x & MASK


def mulberry32(seed):
    """Bit-exact port of the mulberry32 in pool.js.

    JS does its arithmetic on signed 32-bit ints via Math.imul and ToInt32; doing
    it unsigned and masking at every step gives the identical bit pattern, and the
    final divide by 2**32 therefore gives the identical double.
    """
    state = _u32(seed)

    def rnd():
        nonlocal state
        state = _u32(state + 0x6D2B79F5)
        t = state
        t = _u32((t ^ (t >> 15)) * (t | 1))
        t = _u32(t ^ _u32(t + _u32((t ^ (t >> 7)) * (t | 61))))
        return _u32(t ^ (t >> 14)) / 4294967296.0

    return rnd


def rand_u(rng, lo, hi):
    return lo + rng() * (hi - lo)


def rand_int(rng, lo, hi):
    """Uniform integer in [lo, hi], inclusive — the same as randInt in pool.js."""
    return lo + math.floor(rng() * (hi - lo + 1))


def js_round(x):
    """JavaScript's Math.round: halves go UP, towards +Infinity.

    Python's built-in round() is banker's rounding, which would silently disagree
    with the browser on every value ending in .5.
    """
    return math.floor(x + 0.5)


def reflect(x, lo=0.0, hi=100.0):
    """Reflect rather than clip: clipping piles probability mass on the
    boundaries and changes the process (§8)."""
    period = 2 * (hi - lo)
    y = (x - lo) % period
    if y < 0:
        y += period
    if y > (hi - lo):
        y = period - y
    return y + lo


ENV = {
    "positions": 100,
    "prizeMin": 0,
    "prizeMax": 100,
    "stepBound": 10,
    "seedLowMin": 20,
    "seedLowMax": 80,
    "seedHighMin": 80,
    "seedHighMax": 100,
    "seedHighProb": 0.5,
    # See config.js: the brief's own value is 200, but only ~2% of
    # (mapping, seed-set) pairings pass the §9 acceptance filter, so 200 mappings
    # cannot give the 16 seeded specs a distinct curve each.
    "poolSize": 600,
    "generatorSeed": 20260813,
}


def max_adjacent_step(q):
    return max(abs(q[i] - q[i - 1]) for i in range(1, len(q)))


def generate_one(rng, env=ENV):
    """One candidate mapping, or None when the post-rounding adjacency check
    fails. Rounding can in principle push a difference above L, which would make
    the instructions literally false — reject and redraw."""
    J, L = env["positions"], env["stepBound"]
    lo, hi = float(env["prizeMin"]), float(env["prizeMax"])
    y = rand_int(rng, 0, J - 1)
    q = [0.0] * J
    if rng() < env["seedHighProb"]:
        q[y] = rand_u(rng, env["seedLowMin"], env["seedLowMax"])
    else:
        q[y] = rand_u(rng, env["seedHighMin"], env["seedHighMax"])
    for j in range(y + 1, J):
        q[j] = reflect(q[j - 1] + rand_u(rng, -L, L), lo, hi)
    for k in range(y - 1, -1, -1):
        q[k] = reflect(q[k + 1] + rand_u(rng, -L, L), lo, hi)
    q = [js_round(v) for v in q]
    if max_adjacent_step(q) > L:
        return None
    return q


def build_pool(env=ENV, seed=None):
    rng = mulberry32(env["generatorSeed"] if seed is None else seed)
    pool = []
    guard = 0
    while len(pool) < env["poolSize"]:
        guard += 1
        if guard > env["poolSize"] * 200:
            raise RuntimeError("pool generation did not converge")
        q = generate_one(rng, env)
        if q is not None and max(q) >= 80:
            pool.append(q)
    return pool


def stats(pool):
    n = len(pool) * len(pool[0])
    flat_sum = sum(sum(q) for q in pool)
    mean = flat_sum / n
    var = sum((v - mean) ** 2 for q in pool for v in q) / n
    gmax = sorted(max(q) for q in pool)
    return {
        "mappings": len(pool),
        "cellMean": round(mean, 3),
        "cellSd": round(var ** 0.5, 3),
        "globalMaxMean": round(sum(gmax) / len(gmax), 3),
        "globalMaxP5": gmax[int(0.05 * (len(gmax) - 1))],
        "globalMaxP95": gmax[int(0.95 * (len(gmax) - 1))],
        "worstAdjacentStep": max(max_adjacent_step(q) for q in pool),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", help="write the pool to this JSON file (NEVER commit it)")
    ap.add_argument("--seed", type=int, default=ENV["generatorSeed"])
    ap.add_argument("--size", type=int, default=ENV["poolSize"])
    ap.add_argument("--parity", action="store_true",
                    help="print the first draws of the PRNG, to compare against tools/selftest.js")
    args = ap.parse_args()

    if args.parity:
        rng = mulberry32(args.seed)
        vals = [rng() for _ in range(5)]
        print("parity vector (seed %d, first 5): %s" % (args.seed, ", ".join("%.10f" % v for v in vals)))
        print("tools/selftest.js prints the same line from JavaScript; the two must match.")
        return

    env = dict(ENV, generatorSeed=args.seed, poolSize=args.size)
    pool = build_pool(env)
    print(json.dumps(stats(pool), indent=1))
    print("\nThe brief's §8 figures describe the RAW generator (mean 62.2, SD 26.8,")
    print("global-max mean 91.7). The pool is the subset with a global maximum of at")
    print("least 80, so its level sits higher — that filter is in the brief's own")
    print("build_pool, and both are reproduced here.")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(pool, f)
        print("\nWrote %d mappings to %s — DO NOT COMMIT IT (§18)." % (len(pool), args.out))


if __name__ == "__main__":
    main()
