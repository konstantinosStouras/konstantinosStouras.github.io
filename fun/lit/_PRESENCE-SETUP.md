# The Lit — "Exploring now" live visitor counter (one time, ~5 minutes)

The Data Analytics page (`fun/lit/analytics/`) can show a live **Exploring now**
figure: the number of visitors currently browsing The Lit, updated in real time.
It sits next to the **Registered users** figure in the Community band.

It uses **Firebase Realtime Database (RTDB) presence** with **anonymous auth**,
in a **separate Firebase app instance** (`'presence'`) so it never touches the
accounts sign-in feature. It counts **everyone** browsing (not just signed-in
users — sign-in is optional and rare), but anonymous visitors are **never**
written to the `registeredUsers` tally, so they don't inflate the registered
count.

The feature is **completely inert until you finish the steps below** — the
`databaseURL` ships as a `PASTE_DATABASE_URL` placeholder, so today both pages
behave exactly as before and the "Exploring now" card simply never appears.

> **Why not Firestore?** Firestore has no presence primitive; emulating it means
> every tab polling a heartbeat write every ~30–60 s, which scales with traffic
> and can exhaust the free write quota. RTDB presence is connection-based
> (`onDisconnect`), so it costs one held connection per visitor and a couple of
> tiny writes — the right, cheap tool for "who's online now".

---

## How it works

- Each open tab, once connected, writes `presence/<uid>/<pushId> = true` in RTDB
  and registers an `onDisconnect().remove()`, so the entry vanishes the instant
  the tab closes or drops offline.
- Entries are grouped under the visitor's anonymous **uid**, so the count is of
  **distinct visitors**, not tabs (two tabs = one person).
- **The main browser (`fun/lit/index.html`) only *writes* presence** — it never
  reads the tree, so there's no per-visitor fan-out. **Only the analytics page
  reads/counts** it (`ref('presence').on('value', s => s.numChildren())`), so the
  live figure reflects everyone on the site while the read cost stays tiny.

## 1. Enable Anonymous sign-in

Firebase console → **Build → Authentication → Sign-in method** → **Anonymous** →
**Enable** → Save. (This is separate from the account providers; it only lets a
visitor hold a throwaway identity so RTDB rules can attribute their presence
node. Anonymous users are **not** added to the `registeredUsers` tally.)

Optional but recommended: **Authentication → Settings → User account management**
→ turn on **Anonymous user clean-up** (auto-deletes anonymous accounts inactive
for 30 days) so the user list doesn't accumulate stale anonymous entries.

## 2. Create the Realtime Database

Firebase console → **Build → Realtime Database → Create database**. Pick a
location (e.g. `europe-west1`) and **start in locked mode** (the rules in step 4
open exactly what's needed). Copy the database URL it shows — it looks like:

```
https://lit-paper-browser-default-rtdb.europe-west1.firebasedatabase.app
```

## 3. Paste the database URL into BOTH pages

Set `databaseURL` / `RTDB_URL` to that URL, replacing `PASTE_DATABASE_URL`, in:

- **`fun/lit/index.html`** — the presence-register `<script>` near the very
  bottom (`PRESENCE_CFG.databaseURL`).
- **`fun/lit/analytics/index.html`** — the `RTDB_URL` constant in the Firebase
  script at the foot of the page.

(Keep the two in sync, like `FB_CONFIG`. These are public config values, not
secrets — access is governed by the RTDB rules.)

## 4. Deploy the Realtime Database rules

The rules live in **`fun/lit/_database.rules.json`** (public read of `/presence`
so the count works; each visitor may write only under their own uid; values must
be `true`). Deploy either way:

- **Console:** Realtime Database → **Rules** tab → paste the `"rules"` object
  from `_database.rules.json` → **Publish**.
- **CLI:** point `firebase.json`'s `database.rules` at this file (or copy it to
  `database.rules.json`) and run `firebase deploy --only database`.

Without this step the presence writes/reads are denied and the "Exploring now"
card just stays hidden — nothing else breaks.

## 5. Commit and you are done

Commit the two HTML changes and push to `master`. The **Exploring now** card
appears on `fun/lit/analytics/` and updates live as visitors come and go.

---

## Turning it off again

Blank the `databaseURL` / `RTDB_URL` back to `PASTE_DATABASE_URL` (or clear the
values) in both pages and commit — the presence code becomes inert and the card
disappears. No RTDB data needs deleting (presence entries are ephemeral and
clear themselves as tabs close).

## Notes / cost

- **Free tier (Spark):** RTDB allows 100 simultaneous connections and 1 GB
  stored — ample for a personal site. Presence entries are a few bytes each and
  self-delete, so storage stays near zero.
- **Privacy:** no personal data is stored — only an anonymous uid and a boolean
  per open tab. The count is public by design (it's a "N people online" figure).
- **Metric meaning:** "Exploring now" counts *all* current visitors (anonymous
  included), which is what makes it useful — a signed-in-only version would read
  0 almost always, since sign-in is optional.
