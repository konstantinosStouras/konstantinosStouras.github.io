# Frozen seeds — Search With and Without Generative AI

Design brief §18. Every random seed the study uses, and the date each run was
frozen. The generators live in the repository; the artifacts they produce do not.

| Artifact | Where it lives | How it is reproduced |
|---|---|---|
| `generate_mappings.py`, `generate_rounds.py`, `upload_run.py`, this file | **in the repository** | — |
| Mapping pool (600 × 100 integers) | **never committed** | `pool.js` / `tools/generate_mappings.py` from `generatorSeed` |
| Round specs (28) | **stored on the run document in Firestore** | `specs.js` / `tools/generate_rounds.py` from `specSeed` |
| Roster (anonymous codes + sequence) | **Firestore only** | admin panel → Roster, or `tools/upload_run.py --roster N` |

The split is the point. Seeds and generator code in the repository make the study
reproducible by anyone who should be able to reproduce it; the generated artifacts
staying out of it are what stop a participant reading the answers.

---

## The generator

`mulberry32`, implemented identically in `pool.js` (JavaScript, canonical) and in
`tools/generate_mappings.py` (Python, exact 32-bit port). The two are proven
byte-identical: `python3 tools/generate_mappings.py --parity` and
`node tools/selftest.js` print the same first five draws, and building the pool in
both languages gives the same 600 arrays.

The brief's reference generator is numpy's PCG64. That cannot run in a browser, and
the whole point of a frozen pool is that one artifact serves every participant, so
mulberry32 is the canonical PRNG for this implementation. Every statistic the brief
pins down is reproduced by it — see `tools/selftest.js` §2.

Parity vector, seed `20260813`, first five draws:

```
0.4006963617, 0.3509998717, 0.0757264085, 0.5681982152, 0.8197679692
```

---

## Default seeds

| Seed | Value | What it fixes |
|---|---|---|
| `env.generatorSeed` | `20260813` | the mapping pool |
| `specSeed` | `20260814` (= `generatorSeed + 1`) | seed placement, AI anchor placement, mapping assignment |
| per-participant shuffle | `hash(participant_code)` | the order of the 12 scored specs within each block |

The per-participant shuffle seed is stored on every session record as
`shuffle_seed` and on the `session_start` row, so a participant's realised order is
reproducible from the log alone.

---

## Deviation from the brief's stated pool size

The brief's §17b names a mapping pool of **200**. This build's default is **600**,
and the reason is measured rather than a preference.

Only about **2%** of (mapping, seed-set) pairings pass the §9 acceptance filter at
the brief's own parameters, and only about **7%** of mappings admit *any* jitter of
the BALANCED seed set. The cause is the interaction of two rules the brief states
separately: `build_pool` keeps only mappings whose global maximum is at least 80,
which lifts the whole curve (the highest of three seeded positions has a median of
91), while the filter asks for that highest seeded value to land between 30 and 60.

With 200 mappings the 16 seeded specs cannot each get a distinct curve, and the
builder would have to serve the same prize mapping in two rounds — which would make
the instruction *"the prizes are drawn afresh in every round"* false, and would
show up in the data as an unmodelled repeated measure. The pool is generated and
never shipped, so a larger one costs nothing.

`Specs.validate()` fails a run whose specs repeat a mapping, so this cannot regress
silently. To go back to 200, lower `env.poolSize` in the admin panel and widen the
"highest seeded value" range until the validation gate passes.

---

## Run log

Add a row here whenever a run is frozen for data collection.

| Date frozen | Run name | Run code | run_id | generatorSeed | specSeed | Pool checksum | Specs checksum |
|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | |

The admin panel's export bundles the same values on its **Run** sheet, so the
configuration always travels with the data.
