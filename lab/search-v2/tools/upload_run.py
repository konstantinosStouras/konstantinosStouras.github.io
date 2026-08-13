#!/usr/bin/env python3
"""
search-v2 · tools/upload_run.py
Write a run — its parameter set, its frozen round specs and its roster — into
Firestore, from a local machine, as design brief §18 asks.

    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
    python3 tools/upload_run.py --name "Wave 1" --code WAVE1 --roster 90
    python3 tools/upload_run.py --name "Wave 1" --code WAVE1 --dry-run

Everything this writes can also be done from the admin panel (/lab/search-v2/admin/
→ Runs → New run, then Roster → Generate). This exists for the case the brief has
in mind: freezing a run from a local machine, under version-controlled seeds, with
nothing depending on a browser session.

WHAT IS AND IS NOT UPLOADED
  · The parameter set, the 28 round specs and the roster go into Firestore.
  · The MAPPING POOL DOES NOT. The client regenerates the identical pool from the
    run's own `generatorSeed` (pool.js — proven byte-identical to
    generate_mappings.py by tools/selftest.js), so shipping ~600 arrays of 100
    integers into a document the client must read would add nothing but weight.
    The run document carries the pool's CHECKSUM, so a mismatch is detectable.
    Read README.md → "What this build does and does not guarantee" for what that
    means for integrity, and for the Cloud-Functions path that closes the gap.

Requires: pip install firebase-admin
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)

NODE_SCRIPT = r"""
const path = %(app)s;
const Pool = require(path + '/pool.js');
const Specs = require(path + '/specs.js');
const params = Specs.withDefaults(null);
const pool = Pool.buildPool(params.env, params.env.generatorSeed);
const specs = Specs.buildSpecs(pool, params, params.env.generatorSeed + 1);
process.stdout.write(JSON.stringify({
  params: params, specs: specs,
  poolJson: JSON.stringify(pool), specsJson: JSON.stringify(specs),
  validation: Specs.validate(pool, specs, params)
}));
"""


def fnv1a(s):
    """The same 32-bit checksum admin/export.js writes, so a run frozen here and a
    run frozen from the panel carry comparable numbers."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch) & 0xFF if ord(ch) < 256 else ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h, "08x")


def build():
    src = NODE_SCRIPT % {"app": json.dumps(APP)}
    try:
        res = subprocess.run(["node", "-e", src], capture_output=True, text=True, check=True)
    except FileNotFoundError:
        sys.exit("node is not on PATH — this script drives the canonical JavaScript in specs.js.")
    except subprocess.CalledProcessError as e:
        sys.exit("specs.js failed:\n" + (e.stderr or ""))
    return json.loads(res.stdout)


def roster_codes(n, prefix):
    """Block randomisation over a shuffled list, so the split is exactly half and
    half rather than a series of coin flips (§11). Deterministic in (n, prefix)."""
    sys.path.insert(0, HERE)
    from generate_mappings import mulberry32  # the same PRNG as everything else

    seqs = ["A" if i % 2 == 0 else "B" for i in range(n)]
    rng = mulberry32(fnv1a_int(prefix + ":" + str(n)))
    for i in range(len(seqs) - 1, 0, -1):
        j = int(rng() * (i + 1))
        seqs[i], seqs[j] = seqs[j], seqs[i]
    return [{"code": "%s%03d" % (prefix, i + 1), "sequence": seqs[i]} for i in range(n)]


def fnv1a_int(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch) & 0xFFFFFFFF
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True, help="human-readable run name")
    ap.add_argument("--code", required=True, help="run code — goes in the participant link")
    ap.add_argument("--roster", type=int, default=0, help="how many anonymous codes to generate")
    ap.add_argument("--prefix", default="P", help="roster code prefix")
    ap.add_argument("--open", action="store_true", help="open entry immediately (default: draft)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be written and stop")
    args = ap.parse_args()

    data = build()
    val = data["validation"]
    if not val["pass"]:
        print("The validation gate FAILS — a run cannot open until it passes:")
        for f in val["failures"]:
            print("  ✗ " + f)
        sys.exit(1)

    code = args.code.upper()
    run_doc = {
        "name": args.name,
        "code": code,
        "status": "open" if args.open else "draft",
        "locked": False,
        "createdAt": int(time.time() * 1000),
        "params": data["params"],
        "ops": dict(data["params"]["ops"], runName=args.name, entryOpen=bool(args.open)),
        "assign": data["params"]["assign"],
        "specSeed": data["params"]["env"]["generatorSeed"] + 1,
        "specsJson": data["specsJson"],
        "poolChecksum": fnv1a(data["poolJson"]),
        "specsChecksum": fnv1a(data["specsJson"]),
        "seeds": {
            "generatorSeed": data["params"]["env"]["generatorSeed"],
            "specSeed": data["params"]["env"]["generatorSeed"] + 1,
        },
        "overrides": [],
        "frozenBy": "upload_run.py",
    }
    roster = roster_codes(args.roster, args.prefix.upper()) if args.roster else []

    print("run   : %s (%s), status %s" % (args.name, code, run_doc["status"]))
    print("specs : %d, checksum %s" % (len(data["specs"]), run_doc["specsChecksum"]))
    print("pool  : checksum %s (regenerated by the client from seed %d, never uploaded)"
          % (run_doc["poolChecksum"], run_doc["seeds"]["generatorSeed"]))
    print("roster: %d codes (%d A / %d B)" % (
        len(roster), sum(1 for r in roster if r["sequence"] == "A"), sum(1 for r in roster if r["sequence"] == "B")))
    for n in val["notes"]:
        print("  · " + n)

    if args.dry_run:
        print("\n--dry-run: nothing was written.")
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("\nfirebase-admin is not installed:  pip install firebase-admin")

    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        sys.exit("\nSet GOOGLE_APPLICATION_CREDENTIALS to a service-account key for the project.")

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault())
    db = firestore.client()

    ref = db.collection("runs").document()
    ref.set(run_doc)
    db.collection("runCodes").document(code).set({"id": ref.id})
    for r in roster:
        db.collection("roster").document("%s__%s" % (ref.id, r["code"])).set({
            "runId": ref.id, "code": r["code"], "sequence": r["sequence"],
            "status": "unused", "claimedByUid": None,
        })
    db.collection("audit").add({
        "run_id": ref.id, "action": "upload_run", "detail": "%s / %s, %d roster codes" % (args.name, code, len(roster)),
        "by": "upload_run.py", "t": int(time.time() * 1000),
    })
    print("\nWrote run %s. Participant link: https://www.stouras.com/lab/search-v2/?code=%s" % (ref.id, code))


if __name__ == "__main__":
    main()
