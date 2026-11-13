# Sustainability Studio: original model and teaching guide

This is an independently authored business simulation. All catalogues, formulas, text, code, and interface assets here are original. Private research remains excluded from the repository and deployment.

## Start a class

Sign in with Google (including Gmail and Google Workspace) or verified email/password. An instructor creates a session, selects a seed and duration, and shares each company's join code. Students sign in, enter a code, and work in their assigned company. Instructor privileges come from verified Firebase custom claims or a server-side UID allowlist. A student cannot select a teacher role. Instructor company previews are read-only. In the local demo only, explicit synthetic accounts can be selected without passwords. The public solo sandbox is a separate single-browser rehearsal; role switching there is not multiplayer authentication.

Pause for decisions and discussion, step the simulation, then inspect outcomes. Continuous running is controlled by the authoritative server. Restarting the server preserves the state; no offline elapsed time is simulated. A configured end pauses economic activity in a completed state, preserving all obligations. The instructor can extend the duration up to 180 days. There is no 180-hour cap.

## A useful first exercise

1. Compare an offer's delivery promise to the available transport routes.
2. Ship part of an order and check the unchanged original quantity and the remaining balance.
3. Purchase the next bottleneck component, then watch its receipt and later payment.
4. Change a shift or commission an investment. Record its activation time before advancing.
5. Switch to wind power and compare future energy use and carbon with existing stock's footprint.
6. Compare profit, cash, receivables, and the committed cash forecast at the same cutoff.

The seeded demonstration contains three companies with different shift and electricity decisions, two installed automation assistants, and three completed days. These are illustrative strategies, not recommended or optimal ones.

## Time and event rules

Time is an integer number of hours after 1 January 2026 00:00 UTC. Each tick advances one hour. Production recorded at hour `h` belongs to the closing interval `(h - 1, h]`. Its shift eligibility uses the schedule in force before events at `h`: a shift change effective at a boundary governs the following interval and cannot add or remove production or wages for the interval just closed. For example, a change effective at 08:00 leaves 07:00–08:00 under the old schedule; 08:00–09:00 uses the new schedule. At midnight, 23:00–24:00 therefore belongs to the closing day's output and snapshot.

All due events still execute first, ordered by due hour then creation sequence, including same-hour consequences; then production runs with the saved shift eligibility, demand is allocated every six hours, automation runs, and a midnight daily close records costs and a snapshot. Only shift eligibility is saved: other production inputs and daily charges use the state after due events, so receipts, staffing, equipment and energy activations retain their existing same-tick effects. Real-world message/audit timestamps are stored separately as UTC ISO dates and displayed in the viewer's local time. Simulation timestamps always use UTC.

The shift-boundary rule was corrected on 12 November 2026. Saved historical snapshots are not rewritten. Replaying commands recorded before that correction with the current engine can produce different outcomes at affected shift boundaries.

Accepted decisions either take effect immediately or create durable pending events. Their receipts, settlements, and activation events become completed outcomes. No cancellation of committed contracts is implemented. Late supplier payments and loan repayments retry every 24 hours when funds are insufficient. They remain visible as overdue; the same interest is not charged repeatedly. Existing financial and delivery terms are stored on contracts and survive catalogue changes.

## Manufacturing and inventory

New sessions assemble one solar panel from **32 photo cells, one recycled frame, and two junction boxes**. The recipe is stored on each session. Existing sessions and replay files created before the recipe was stored use their original 24 PV cells, one recycled frame, and one controller per module. Each assembly line supports six modules/hour; each worker supports two modules/hour. Output is the integer minimum of machine capacity, worker capacity, material availability, free finished-goods space, and cash available after active-shift wages. The three daily shifts are 00–08, 08–16, and 16–24 UTC. Active-shift wages are €13.50 per worker/hour, even when a material shortage stops output. If cash cannot cover wages, the hour does not run. There is no random yield, scrap, or production waste in v1.

Production uses 3 kWh per module, reduced by 25% after the efficiency retrofit. Material weighted-average value and embodied carbon transfer into finished goods. Labour and electricity are **period expenses**, not capitalized manufacturing costs; the stock value is therefore material acquisition cost, not full absorption cost. Finished output cannot exceed storage capacity. Inbound stock can exceed normal capacity up to twice capacity including goods on order, with a €0.05/unit/day overflow charge. Purchases above this hard limit are rejected. Supplier minimums and lot sizes are enforced. Supplier stock is shared, reserved on acceptance, and replenished at daily close subject to a cap of 30 times daily replenishment plus 10,000 units.

## Competitive demand

Every six hours each active market draws total demand uniformly between 80% and 120% of its configured volume, rounded to whole units. Companies compete using this original score:

```
score = (reference price / offer price)^2
      * satisfaction * quality
      * (1 + 0.1 * sqrt(daily marketing cents / 10000))
      * exp(-green weight / 100 * module kg CO2e / 100)  [when enabled]
      * (1 + payment hours / 2400)
      / (1 + delivery hours / 480)
```

Market units are allocated in proportion to scores, rounded down, with remaining units assigned by largest fractional remainder (stable company-ID tie-break). Current weighted-average stock carbon is used, or 75 kg if stock is empty. Each company has one editable offer per market. The lowest-price/stable-ID rule is defined if a scenario contains additional offers. Quantities below the chosen offer's minimum are lost; allocations above the maximum are capped; lost units are not redistributed. Accepted prices, promises, and payment terms are immutable on each order. Prices are bounded to €50–€10,000; there is no dynamic cost-based price floor.

Daily research increases quality by `0.004 * sqrt(daily research cents / 10000)`, capped at 1.5. Satisfaction is bounded 0.3–1.3: receipt after the deadline subtracts 0.08, receipt over 24 hours early subtracts 0.02, receipt in the inclusive window adds 0.025; daily recovery adds 0.005. These effects apply per shipment, including partial shipments. The model is intentionally transparent and simplified; it does not establish real-world elasticity or causality.

## Logistics and automation

Supplier and customer routes sample on-time arrival using the declared reliability percentage. A late arrival adds an integer delay uniformly from 1 to the configured maximum. Nominal estimates remain visible separately from actual receipt. Each customer consignment incurs a fixed plus per-unit freight charge and records fixed plus per-unit transport carbon at dispatch. A route can require immediate freight payment or a term in hours. With a term, dispatch records a payable and the accepted charge is scheduled for settlement. Full and partial dispatch are supported; original quantity equals remaining quantity plus all dispatched quantities. Customer receipt and customer payment are separate events.

The dispatch assistant considers the oldest open order each hour and ships up to available stock. It selects the lowest-cost route that can meet the promise **including maximum delay**. It targets a 12-hour early buffer plus maximum delay and waits until the target dispatch hour. If no route is on time, it chooses the fastest enabled route. Its next action or blocking reason is visible. One consignment per company/hour is the deliberate v1 limit.

The replenishment assistant examines enabled policies each hour. If on-hand plus unreceived purchases is at or below the reorder point, it orders the policy quantity from the selected supplier. It does not silently substitute suppliers. It charges half the normal fixed ordering fee. Insufficient supplier stock, credit, or capacity leaves an explanation and retries next hour. Disabling purchase/dispatch permission also pauses the respective assistant; existing shipments and contracts still execute. Visibility flags change navigation only; permissions change allowed decisions; carbon demand is an independent economic effect.

## Accounting, banking, and carbon

All ledger postings are integer EUR cents, double-entry, with debits positive and credits negative. Every transaction must sum to zero. Inventory value reconciles to the inventory account. Cash cannot become negative.

| Lifecycle | Posting |
| --- | --- |
| Opening capital | Debit cash/inventory/fixed assets; credit equity |
| Purchase accepted | Debit inbound asset; credit supplier payable |
| Supplier receipt | Debit inventory; credit inbound asset |
| Supplier paid | Debit payable; credit cash |
| Customer dispatch | Debit goods in transit; credit inventory; freight expensed and paid |
| Sale recognized (receipt or dispatch, depending on session setting) | Debit receivable; credit revenue; debit cost of goods sold; credit goods in transit |
| Customer paid | Debit cash; credit receivable |
| Investment ordered | Debit construction/prepaid asset; credit cash |
| Investment activated | Debit fixed assets; credit construction |
| Loan funded | Debit cash; credit debt |
| Loan interest due | Debit expense; credit interest payable |
| Loan repaid | Debit debt and interest payable; credit cash |
| Deposit placed | Debit deposits; credit cash |
| Deposit matured | Debit cash; credit deposits and interest income |

Bullet loans fund in 24 hours and repay once after 7–90 days at 9% simple annual interest. Annuity loans fund in 48 hours and repay weekly over 1–20 weeks at an 8% annual rate. New requests count the repayment weeks from the request hour. Earlier contracts retain their funding-based schedule. Each installment rounds interest to cents on the remaining scheduled principal. The final installment settles rounding differences. The €150,000 loan limit counts original principal on every pending or unpaid loan. The deposit form offers 1–26 whole weeks at 4% simple annual interest with no early withdrawal. Existing hour-based deposits and replays retain their terms. Bullet and deposit interest is rounded once using `principal cents * annual rate * term hours / 8760`. Interest is recognized when due.

Daily overhead includes €350 rent, the active energy supplier's standing fee, overflow storage, marketing and research. Unpaid overhead is recognized as a liability and retried at subsequent daily closes. Fixed assets use a simplified 20% annual **declining-balance** depreciation divided by 365 at each close. Supplier credit allows new purchase commitments up to current cash plus €80,000 less existing supplier payables.

Carbon includes newly received purchased components and their inbound transport, production electricity, and dispatched customer freight. Opening stock's embodied carbon remains in stock intensity but is excluded from new operational emissions. Material conversion transfers carbon without double-counting it. This teaching footprint is not a certified corporate GHG inventory. There is no carbon price or offset system in v1.

### Classroom accounting settings

For a new classroom, instructors can set the initial regional and international sales offers and the opening unit cost of each inventory item. Blank amounts use Studio defaults. Starting prices do not change the market reference prices or the terms of future offer edits. Opening unit costs set the initial weighted-average carrying values and opening equity without changing stock quantities, cash, or future supplier terms.

The inventory statement can show cost of goods sold directly or show received material purchases and the change in inventory since opening. The latter includes goods in transit to customers until the configured sale recognition event. Purchases include the received acquisition cost carried by Studio. Purchases less the inventory change reconcile to the same cost of goods sold. Choosing a statement format changes presentation only.

When creating a classroom, the instructor can recognize sales at customer receipt (the default) or at dispatch. Dispatch accounting posts revenue and the associated cost of goods sold together. Customer receipts and their service effects still follow actual arrival, and the payment term still starts at receipt. Existing classrooms keep their original accounting policy.

An optional corporate overhead amount per company posts at each midnight close, in addition to operating costs. Unpaid overhead accrues as a liability. Use this setting to compare overhead assumptions across otherwise identical runs. The Finance page itemizes expenses from the journal. Reports list dispatches and customer receipts separately.

Advanced settings for new classrooms also include **additional daily energy overhead** and **fixed daily depreciation**, both per company. Energy overhead is added to the production electricity cost in the energy report and charged at midnight. Unpaid energy overhead accrues as a liability. Electricity usage and carbon still follow actual production. Fixed daily depreciation replaces the default 20% annual declining-balance charge, reduces book value without a cash payment, and is capped at the remaining fixed asset balance. Leave depreciation blank to retain the default; enter zero to turn off depreciation.

## Reports, roles, and durability

Live metrics and the transaction journal update after each committed command/tick. Daily chart records are immutable midnight snapshots. Cumulative measures include cash, profit, revenue, output, electricity, energy expense, stock, dispatches, receipts, and emissions; daily sales/production are differences between successive snapshots. Delivered market share is cumulative received modules divided by all received modules, zero before any receipts. CSV exports include units and simulation time. The committed cash forecast only contains already scheduled monetary events: it excludes future trading, wages and overhead, and purchase/sale settlements not yet scheduled by physical receipt. It is not a projected bank balance.

The server stores state, accounts, memberships, hashed session tokens (local demonstration only), invitations, requests and replay commands in SQLite WAL transactions. Optimistic revisions reject stale decisions. The client preserves the reviewed version while a form is open and retains uncertain requests for safe retry. Per-user idempotency keys return the original result on retry and reject reuse with a different command. Server checks enforce ownership and permissions on every action. Firebase ID tokens are verified for the configured project with the official Admin SDK. Verified emails are required. Production can additionally enable revocation checks with application-default credentials.

Announcements are posted by the instructor and visible to the class. Private instructor conversations include that company and instructors. Internal team messages are visible only to the company's students. Legacy class-wide and peer chats are hidden. User-supplied sender fields are ignored. Instructor configuration and company decisions are auditable. Replay exports are instructor-only; internal team and legacy class-wide and peer message text is replaced by a placeholder, preserving economic replay and sequence numbers. Assignment audit transitions are replayed, while user accounts and SQL membership tables are not recreated. Older sessions with unlogged assignment transitions explicitly report incomplete replay. Exports still contain identities and permitted communication; treat them as private class records. Never commit them.

## Limits and next iterations

The standalone SQLite server requires exactly one process/clock owner. The cloud deployment uses Firestore transactions and a durable due time to coordinate function instances. State and complete history remain serialized per session; high-volume/long-running classes need normalized persistence, retention, and load testing. Cloud snapshots are limited to 7 MiB compressed and 128 MiB uncompressed; writes that exceed the limit fail without replacing the last committed state. Polling updates clients every three seconds; focused forms keep their drafts and stale submissions receive an explicit conflict. No email invitations, SSO organization management, password handling outside Firebase, chat moderation, attachments, voice, tax accounting, multi-currency, or full ESG framework is implemented. The v1 catalogue is intentionally small. Commercial metrics are shared only through defined comparative reports.

Firebase Hosting and GitHub Pages host the interface and solo sandbox. The public interface connects automatically to the shared Firebase Functions API, with persistent state in Firestore in London. The cloud clock reconciles elapsed time on authenticated reads and through a scheduled worker every minute; it may catch up in multiple batches after a long interruption. The local Docker/SQLite option is independent of this hosted backend.
