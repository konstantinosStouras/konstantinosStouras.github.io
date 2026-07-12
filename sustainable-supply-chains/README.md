# Sustainable Supply Chains — a class simulation of global sourcing

Live at **https://www.stouras.com/sustainable-supply-chains/**
Admin panel: **https://www.stouras.com/sustainable-supply-chains/admin/**

Student teams are competing firms assembling and selling **e-bikes** worldwide.
Each round they source four components from a global supplier base, choose sea
or air freight, set production and per-market prices, and (if they want to win
on more than profit) invest in renewable energy, supplier ESG audits and carbon
offsets — while tariffs, port congestion, supply disruptions and demand shifts
keep moving under their feet.

## What students experience (the six design goals)

| Goal | Where it lives in the model |
|---|---|
| **(a) Bullwhip effect** | Supplier lead times (1–3 rounds by lane/mode) + hidden demand patterns (step/seasonal/walk) + lost sales that dent the brand (service loyalty) + **pro-rata rationing at oversubscribed suppliers** (Lee et al.'s shortage gaming). Each firm's `Var(orders)/Var(demand)` ratio is measured and charted in the debrief. |
| **(b) Logistics & SCM** | Sea vs air per order line: real-magnitude freight rates (~80× cost, ~30× CO2 for air) vs 1-round lead; inbound pipeline with ETAs; inventory & holding costs; factory capacity. |
| **(c) Competition across firms** | Per-market multinomial logit demand: price vs reference, green score, brand — plus an outside option. Firms also compete for scarce supplier capacity. |
| **(d) Tariffs** | Base tariff per importing region on customs value (components into the hub, finished goods into markets) + **scheduled tariff shocks** (optionally announced a round ahead so firms can front-run them). |
| **(e) Sourcing decisions** | Per-component supplier mix across 6 world regions: cost / CO2 / ESG / shared capacity / lead-time tradeoffs, hub location choice, disruption events. |
| **(f) CO2 & ESG sourcing** | Components carry embodied CO2; suppliers carry ESG ratings (unaudited low-ESG sourcing risks scandals); transport mode drives freight CO2; carbon tax on gross emissions; offsets reduce **net** only. The green score feeds consumer demand and half the final score. |

## Two play modes

**Live (default)** — the instructor paces the rounds and all firms compete in
one shared market (everything below).

**Async practice** — toggle "Async practice" when creating the session: every
firm that joins plays its **own private game against optimal bot opponents**,
entirely at its own pace (join anytime, end each round yourself, results are
immediate). Perfect as homework before the live class game. The instructor's
control room becomes a live progress monitor (round reached, profit, green
score, bullwhip, last activity), and the Excel export collects every firm's
trajectory.

The **optimal bots** play, each period, the rational-equilibrium strategy of
the stage game (an exact dynamic Nash equilibrium of the full game is
intractable; this is the standard rational decomposition, computed fresh every
round):

- **Nash pricing** — the multinomial-logit Bertrand equilibrium: best-response
  iteration on the markup condition `p = c/(1−τ) + 1/(b(1−s))` given every
  firm's current green score, brand and landed costs.
- **Optimal ordering** — order-up-to (base-stock) at the newsvendor critical
  fractile over the true replenishment lead time, under rational expectations
  of the demand process (they know the step/season schedule and anticipate it;
  the random walk is forecast at its current level; noise draws are never
  peeked at), with order smoothing, fair-share expectations at rationed
  suppliers, air expediting only when the margin covers the premium, and
  end-of-horizon tapering (they never strand inventory).
- **Rational sourcing & investment** — cheapest landed cost including
  scheduled tariff shocks; renewable/audits only when the payback is there;
  never offsets (no tax relief, tiny score weight).

They also exist in live sessions: add a "Bot: optimal (Nash)" firm from the
control room. In the debrief, the bots are excluded from the order-amplification
chart — they pre-position for demand shifts they rationally anticipate, so
their order variability is anticipation, not bullwhip.

## How a class session runs (live mode)

1. **Admin panel → Sessions**: create a session (rounds, markets, demand
   pattern, tariffs & shocks, carbon tax, scoring weights; the full
   product/supplier catalog is editable JSON). Share the student link/code.
2. Students open the game, enter the code, and **found firms** (name, assembly
   hub, team members) or join one. Add **bot firms** (cost- or green-focused)
   any time for extra competition.
3. **Control room**: Start round 1 → students decide (drafts autosave; the
   panel shows who submitted) → **Resolve round** → students study results →
   **Open next round**. Broadcast messages any time. "World — admin eyes only"
   shows the true demand and the round's events.
4. After the last round the game flips to the **debrief**: final standings
   (profit rank × green rank), each firm's bullwhip chart and ratio,
   profit-vs-CO2 comparisons.
5. **Data & export**: one .xlsx with Settings / Firms / Rounds / OrderLines /
   Markets / Standings sheets (plus raw JSON) for grading or your own debrief
   slides.

## Demo mode vs Firebase

Out of the box the app runs in **demo mode**: no backend, all data in the
browser's localStorage, cross-tab live sync. Open the admin panel and the
student page in the same browser to play a full game (with bots) — ideal for
testing parameters before class.

For a **real class** (many devices), create a Firebase project:

1. console.firebase.google.com → Add project (no Analytics needed).
2. **Build → Firestore Database** → Create (production mode).
3. **Build → Authentication → Sign-in method**: enable **Anonymous** and
   **Email/Password**. Under Users, add your admin account
   (e.g. `admin@admin.com` + password).
4. Project settings → Your apps → **Web app** → register; copy the config
   object into `firebase-config.js` (replacing the `PASTE_…` placeholders),
   and put your admin email in `SSC_ADMIN_EMAILS`.
5. Firestore → **Rules**: paste `firestore.rules` (keep the email list in its
   `isAdmin()` in sync). The rules enforce real ownership: each firm doc
   carries a `memberUids` array, and only those members (or you) can update
   the firm or read/write its decision documents — teams cannot see or forge
   each other's pending moves. Students resolve a join code via the
   `sscSessionCodes` lookup collection, so they never list your sessions.
6. Commit & push. The admin panel now asks you to sign in; students join
   anonymously from any device. Teams on several devices are kept in sync:
   the decide form live-follows the firm's latest saved decision, so the
   newest save (or submit) wins visibly on every teammate's screen.

Round resolution runs in the instructor's browser through the same
deterministic engine students see (`engine.js`) — seeded RNG per
(session code, round), so any device recomputes identical results.

## Files

```
config.js         default catalog (product, components, suppliers, regions,
                  distances, modes, markets) + default session settings
engine.js         pure simulation engine (browser + Node) — all game math
store.js          storage API: Firebase backend or localStorage demo backend
shared.js         formatting, theme, inline-SVG charts
app.js            student app        index.html
admin/admin.js    instructor panel   admin/index.html
admin/xlsx.js     dependency-free .xlsx writer (multi-sheet export)
firebase-config.js  paste your Firebase web config here (or leave = demo mode)
firestore.rules   security rules for the Firebase setup
tools/selftest.js Node self-test: engine unit checks + a full 8-round bot game
tools/smoke.mjs   Playwright end-to-end smoke test of the demo-mode app
```

Tests: `node sustainable-supply-chains/tools/selftest.js` and
`node sustainable-supply-chains/tools/smoke.mjs`.

## Model notes (for the instructor)

- **Timing** of round *r*: orders placed in *r* arrive at the start of round
  *r + lead* and are usable that round; production runs before sales; costs
  (purchase, freight, tariff) and CO2 are booked in the ordering round; only
  **allocated** units are charged when a supplier is oversubscribed.
- **Demand**: market size × pattern × noise, split by logit over price /
  green / brand with an outside option. Unmet demand is **lost** and lowers
  the brand (service loyalty) — the real reason managers over-order.
- **Money**: revenue − purchases − freight − tariffs − production − holding −
  overhead − carbon tax − investments − offsets − overdraft interest (5%/round
  on negative cash).
- **Green score** = 45% CO2 intensity vs a 220 kg/unit baseline + 35%
  spend-weighted supplier ESG + 12% renewable plant + 8% offset ratio.
  **Brand** drifts toward green score and fill rate; scandals knock 12 off.
- **Final score** = admin-weighted blend of profit rank and green rank
  (default 50/50).
- Freight magnitudes are real-world rough: sea ≈ $0.006/kg/1000 km and
  15 g CO2/kg/1000 km; air ≈ $0.5 and 500 g. Component costs/prices are
  calibrated so a competent cost-focused strategy and a green-premium strategy
  can both win, and naive over-ordering visibly loses money.

Inspired by the classic MIT beer game and by Enno Siemsen's open-source
teaching games at edutool.org (beergame, newsvendor, supply-chain resilience) —
this app extends those ideas into a multi-echelon, multi-market, sustainability-
aware competition designed for the six learning goals above.
