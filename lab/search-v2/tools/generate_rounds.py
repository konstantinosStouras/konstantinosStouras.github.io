#!/usr/bin/env python3
"""
search-v2 · tools/generate_rounds.py
The round specs of design brief §10 — seed placement, AI anchor placement and the
acceptance filter — with the seeds hard coded.

    python3 tools/generate_rounds.py                  # print the 28 specs
    python3 tools/generate_rounds.py --out specs.json # write them (NEVER commit)
    python3 tools/generate_rounds.py --validate       # run the §17b validation gate

DELIBERATELY A THIN WRAPPER OVER specs.js, NOT A SECOND IMPLEMENTATION.

The spec builder runs in three places that must never disagree: the participant's
browser (which needs the pre-opened positions and the AI anchors to play), the
admin panel (which freezes them into the run document), and the exporter (which
joins them back onto the log). A Python re-implementation would be a fourth copy
of the acceptance filter, the stratified anchor placement and the jitter rules —
and the first one to drift would corrupt an analysis silently.

So this script calls the canonical JavaScript through Node. What it OWNS, and what
§18 asks a repository to hold, is the seeds: they are written down here, and in
SEEDS.md, and running this file reproduces the artifacts exactly.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)

# ---- the frozen seeds (§18) -------------------------------------------------
GENERATOR_SEED = 20260813          # the mapping pool
SPEC_SEED = GENERATOR_SEED + 1     # seed placement + AI anchor placement

NODE_SCRIPT = r"""
const path = %(app)s;
const Pool = require(path + '/pool.js');
const Specs = require(path + '/specs.js');
const params = Specs.withDefaults(null);
params.env.generatorSeed = %(gseed)d;
const pool = Pool.buildPool(params.env, params.env.generatorSeed);
const specs = Specs.buildSpecs(pool, params, %(sseed)d);
const out = { specs: specs, validation: Specs.validate(pool, specs, params),
              poolSize: pool.length, params: params };
process.stdout.write(JSON.stringify(out));
"""


def build():
    src = NODE_SCRIPT % {"app": json.dumps(APP), "gseed": GENERATOR_SEED, "sseed": SPEC_SEED}
    try:
        res = subprocess.run(["node", "-e", src], capture_output=True, text=True, check=True)
    except FileNotFoundError:
        sys.exit("node is not on PATH — this script drives the canonical JavaScript in specs.js.")
    except subprocess.CalledProcessError as e:
        sys.exit("specs.js failed:\n" + (e.stderr or ""))
    return json.loads(res.stdout)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", help="write the specs to this JSON file (NEVER commit it)")
    ap.add_argument("--validate", action="store_true", help="run the validation gate and exit non-zero on failure")
    args = ap.parse_args()

    data = build()
    specs, val = data["specs"], data["validation"]

    print("pool: %d mappings (generator seed %d)" % (data["poolSize"], GENERATOR_SEED))
    print("specs: %d (spec seed %d)\n" % (len(specs), SPEC_SEED))
    print("%-8s %-6s %-7s %-9s %-10s %-16s %-7s %s" %
          ("spec", "block", "scored", "mapping", "shape", "pre-opened", "density", "AI anchors"))
    for s in specs:
        print("%-8s %-6d %-7s %-9d %-10s %-16s %-7s %s" % (
            s["spec_id"], s["block"], "yes" if s["scored"] else "warm-up", s["mapping_index"],
            s["seed_shape"], " ".join(str(p) for p in s["pre_opened"]) or "—",
            s["ai_density"], " ".join(str(p) for p in s["ai_anchors"])))

    print("\nvalidation: " + ("PASS" if val["pass"] else "FAIL"))
    for n in val["notes"]:
        print("  · " + n)
    for f in val["failures"]:
        print("  ✗ " + f)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(specs, f, indent=1)
        print("\nWrote %d specs to %s — DO NOT COMMIT IT (§18)." % (len(specs), args.out))

    if args.validate and not val["pass"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
