# Sustainability Studio: model and teaching guide

The supplier data used in this simulation corresponds to real data collected from several suppliers. The guide below explains how the simulation uses that data and how its operating rules work.

## Start a class

Sign in with Google (including Gmail and Google Workspace) or verified email/password. An instructor creates a session, selects a seed and duration, and shares each company's join code. Students sign in, enter a code, and work in their assigned company. Instructor privileges come from verified Firebase custom claims or a server-side UID allowlist. A student cannot select a teacher role. Instructor company previews are read-only. In the local demo only, explicit synthetic accounts can be selected without passwords. The public solo sandbox is a separate single-browser rehearsal; role switching there is not multiplayer authentication.

Pause for decisions and discussion, step the simulation, then inspect outcomes. Continuous running is controlled by the authoritative server. Restarting the server preserves the state; no offline elapsed time is simulated. A configured end pauses economic activity in a completed state, preserving all obligations. Existing students can still view final reports and download report or ledger CSVs, but cannot submit new decisions or messages. New students cannot join a completed session. Explicitly closing student access in Session settings still revokes reads and exports. The instructor can extend the duration up to 180 days. There is no 180-hour cap.

### Clock speed presets

New sessions start paused at **40 s/h**, the introductory **Very slow** preset. Existing sessions keep their saved speed. Test rounds copied from a session retain that session's configured speed.

The six teaching presets cover 6–45 real seconds per simulation hour (s/h). Lower values run the simulation faster. Each button sets the band's midpoint, rounded to the nearest whole second with halves rounded up, without changing whether the clock is running or paused.

| Band | Range (s/h) | Button sets (s/h) |
| --- | --- | --- |
| Very slow | 35–45 | 40 |
| Slow | 25–34 | 30 |
| Medium | 16–24 | 20 |
| Brisk | 12–15 | 14 |
| Fast | 9–11 | 10 |
| Very fast | 6–8 | 7 |

Session settings still accepts custom rates from 1–120 s/h. Rates outside the preset range show **Custom** with no band selected; opening the clock does not change a saved rate. Solo mode uses manual steps, and completed sessions disable clock controls.

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

All due events still execute first, ordered by due hour then creation sequence, including same-hour consequences; then production runs with the saved shift eligibility, Poisson demand is allocated each hour (legacy markets retain their six-hour cycle), automation runs, and a midnight daily close records costs and a snapshot. Only shift eligibility is saved: other production inputs and daily charges use the state after due events, so receipts, staffing, equipment and energy activations retain their existing same-tick effects. Real-world message/audit timestamps are stored separately as UTC ISO dates and displayed in the viewer's local time. Simulation timestamps always use UTC.

The shift-boundary rule was corrected on 12 November 2026. Saved historical snapshots are not rewritten. Replaying commands recorded before that correction with the current engine can produce different outcomes at affected shift boundaries.

Accepted decisions either take effect immediately or create durable pending events. Their receipts, settlements, and activation events become completed outcomes. No cancellation of committed contracts is implemented. Late supplier payments and loan repayments retry every 24 hours when funds are insufficient. They remain visible as overdue; the same interest is not charged repeatedly. Existing financial and delivery terms are stored on contracts and survive catalogue changes.

## Manufacturing and inventory

New sessions assemble one solar panel from **32 photo cells, one recycled frame, and two junction boxes**. The recipe is stored on each session. Existing sessions and replay files created before the recipe was stored use their original 24 PV cells, one recycled frame, and one controller per module. Each assembly line supports six modules/hour; each worker supports two modules/hour. Output is the integer minimum of machine capacity, worker capacity, material availability, free finished-goods space, and cash available after active-shift wages. The three daily shifts are 00–08, 08–16, and 16–24 UTC. Active-shift wages are €13.50 per worker/hour, even when a material shortage stops output. If cash cannot cover wages, the hour does not run. There is no random yield, scrap, or production waste in v1.

Production uses 3 kWh per module, reduced by 25% after the efficiency retrofit. Material weighted-average value and embodied carbon transfer into finished goods. Labour and electricity are **period expenses**, not capitalized manufacturing costs; the stock value is therefore material acquisition cost, not full absorption cost. Finished output cannot exceed storage capacity. Inbound stock can exceed normal capacity up to twice capacity including goods on order, with a €0.05/unit/day overflow charge. Purchases above this hard limit are rejected. Supplier minimums and lot sizes are enforced. Supplier stock is shared, reserved on acceptance, and replenished at daily close subject to a cap of 30 times daily replenishment plus 10,000 units.

## Competitive demand

New markets use **Poisson demand arrivals**. Each simulation hour, each enabled market draws one shared count N ~ Poisson(λ), where λ is the instructor's expected number of module-demand arrivals per simulation hour. One arrival represents demand for one module; arrivals are aggregated into at most one order per company and market for that hour. This is an hourly model, not a model of individual customer timestamps or variable order sizes. The distribution has mean and variance λ; zero arrivals and counts above λ are possible. There is no ±20% band. See the [Poisson distribution reference](https://numpy.org/doc/stable/reference/random/generated/numpy.random.Generator.poisson.html).

The instructor edits **Scenario catalogues → Markets → Edit → Demand rate λ**, before starting or while running. Fractional rates from 0 to 1000 are supported. λ = 20 means 20 modules/hour or 480/day on average across all teams, not for each team. Saved changes govern the next hour processed after acceptance. λ = 0 or disabling the market stops new arrivals; re-enabling resumes future arrivals without accumulating demand for disabled hours. Existing orders, receipts and payments retain their terms. Pausing the simulation pauses arrivals. Concurrent edits use the normal revision checks; an obsolete form must be reviewed and resubmitted.

New-session defaults are 95/6 modules/hour locally and 20 modules/hour internationally, preserving the previous expected daily totals. Markets in older saved sessions and historical replay initial states retain the uniform six-hour model until the instructor saves λ for that market. The editor labels these as legacy and suggests old volume / 6; saving explicitly switches that market to Poisson without rewriting old orders. Old volume-only commands remain replayable for legacy markets. Poisson draws use the seeded simulation generator, so the same initial state and command history reproduce the same results. The sampler sums small independent Poisson draws to avoid numerical underflow at high rates.

The realized market count is shared among eligible companies, using this original score:

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

## Sorting workspace tables

Click any labelled table heading once for decreasing order (▼), again for increasing order (▲), and a third time to restore the table's original row order. Switching columns starts with decreasing order. Entire rows and their action buttons stay together. Sorting changes only your view, never simulation decisions or the clock. Each table retains its selected sort while you navigate or receive live updates in the current page; reloading starts with the default order.

In Orders & dispatch, **Order / market** sorts by order creation time: click twice to find the oldest order. **Promised arrival** sorts by the delivery deadline: click twice to find the earliest deadline. These are different priorities. Missing dates, such as an unreceived shipment or an unpaid invoice, stay below known values in both directions. Equal values retain the table's original order.

Sorting also covers inventory and incoming deliveries, suppliers, transport routes, sales offers, replenishment, purchases, shipments, finance, electricity, report values and instructor tables/dialogues. Number and date columns use their underlying values, including precision not visible in rounded amounts. Sorting respects existing filters and table limits (for example, the latest 100 journal entries).

Combined headings sort by a defined primary value; hover or keyboard-focus the heading for its description. Amount / capacity uses on-hand quantity; Quantity band uses the minimum; Lead / payment uses lead time; Available / lot uses stock; Component / freight CO₂e uses component carbon; Transport CO₂e uses fixed shipment carbon; electricity tariffs use the 00–08 rate; Switch fee / delay uses the fee. Audit timing uses simulation time, and ledger Postings sorts by the first listed account name. Finance Completion uses actual completion where available, or the scheduled maturity of a pending deposit; repayments without a completion date remain last. Unlabelled action columns are not sortable.
### Dispatch deadline guidance

The dispatch form shows the current simulation time and hours remaining until the accepted order deadline (or hours overdue). Every enabled transport route shows its estimated arrival margin in parentheses: green for hours before the deadline, red for hours after it, and neutral when exactly on the deadline. The comparison also shows the margin with the full listed carrier delay. These are estimates, not guarantees. Arrivals more than 24 hours early can still incur the model's early-delivery satisfaction penalty; the selected-route quote retains that warning. Guidance is calculated as of the simulation time displayed in the form and refreshes when the form is opened or a stale decision is reviewed. If the clock is running, reopen the form for the latest estimate; existing draft-preservation safeguards remain in effect.

## Sidebar selection and unified messages

Only the currently selected section is highlighted. Opening several workspace panels does not mark every sidebar button as selected. Clicking or focusing a panel selects its section; closing it selects a remaining panel. Orders belong to Sales even though Logistics offers an orders shortcut.

The Messages button opens **All messages**, combining instructor announcements, internal team messages and conversations with the instructor that the signed-in account is authorized to read. Each message identifies its conversation and sender. The **Show messages** filter narrows the feed; **Send to** independently selects the destination for a new message. Students cannot post announcements or read another company's internal messages. Instructor access to private team conversations is unchanged.

## Instructor decision timing review

Session control includes **Student decision timing**, with a summary for every student who has made an accepted business decision, a full per-student history and a CSV export. It uses the existing authoritative audit records, including historical decisions: student ID/name, company, command, result, real UTC acceptance timestamp with milliseconds, and simulation time. Shared classroom timestamps are recorded by the backend; temporary tests and solo rounds use browser time and are identified as test/demo data. Menu clicks, rejected attempts, chat messages and automatic simulation outcomes are not counted as student business decisions. A student with no accepted decisions has no row yet.

The potential-automation indicator flags a **rapid pattern for review** when one student has at least four accepted decisions within two seconds, or six within ten seconds. It also shows the shortest gap, number of gaps below one second and largest ten-second burst. Thresholds are transparent heuristics, not a validated AI detector. Fast human input, accessibility tools, shared accounts, network timing and generated test data can produce similar patterns; slower agents may not trigger the indicator. No grade, access restriction or automatic misconduct conclusion follows from the flag. Missing/invalid historical timestamps are excluded from timing calculations but retained in the decision list. Equal timestamps are retained as zero-second gaps. Exports contain student identities and are private classroom records; never commit them to the public repository.

## Team responsibilities and planning

Coordinate procurement, inventory, production, deliveries and sales around a shared demand plan. Plan purchases from projected orders and lead times; monitor safety stock; match shifts and capacity to materials; prioritize customer deadlines; and make market offers that operations can fulfil. Review competitor results, cash, profit and funding needs together, and communicate changes before advancing time.

The in-app Help & guide presents these responsibilities, a four-step decision cycle and expandable explanations of each decision area.

## US import tariffs in 2025

The importer assembles panels in the United States. The six existing supplier offers represent six manufacturing plants. Cells come from China or Malaysia, frames from Canada or the United Kingdom, and junction boxes from South Africa or the United States. These origins are scenario assignments. They do not identify real companies or establish the origin of actual goods.

The dated quotes replay selected **additional** US duties enacted in 2025. Assume ordinary commercial entries, no in-transit relief, covered unassembled photovoltaic cells (8541.42), covered electrical junction boxes and frames made entirely from covered aluminium extrusions. Canadian and UK opening frames qualify for their pre-March exemption or quota. Assume qualifying non-Russian smelt and cast. A US-made box purchased domestically has no US import duty. For frames, apply Section 232 to the covered aluminium value without a second reciprocal charge on that same value.

| US policy date | China cells | Malaysia cells | Canada frames | UK frames | South Africa boxes | US boxes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening comparison | 0% | 0% | 0% | 0% | 0% | 0% |
| 4 February | 10% | 0% | 0% | 0% | 0% | 0% |
| 4 March | 20% | 0% | 0% | 0% | 0% | 0% |
| 12 March | 20% | 0% | 25% | 25% | 0% | 0% |
| 5 April | 30% | 10% | 25% | 25% | 10% | 0% |
| 9 April | 104% | 24% | 25% | 25% | 30% | 0% |
| 10 April | 145% | 10% | 25% | 25% | 10% | 0% |
| 14 May | 30% | 10% | 25% | 25% | 10% | 0% |
| 4 June | 30% | 10% | 50% | 25% | 10% | 0% |
| 7 August | 30% | 19% | 50% | 25% | 30% | 0% |

The opening comparison removes the measures in this exercise. The China column adds the synthetic-opioid and reciprocal duties, calculated separately on the same customs value. On 9 April the two layers were 20% and 84%, and on 10 April they were 20% and 125%. The Malaysia and South Africa columns reflect covered reciprocal entries. The August column uses the final July order effective 7 August.

Previewing a date changes no quotes. Applying it sets each plant's unit quote to opening unit value times one plus the applicable rate, rounded to euro cents. Existing commitments keep their agreed price. The class calendar can compress months of policy into hours of play. Actual US duties attach at customs entry. The classroom fixes the duty-inclusive quote at purchase and assumes full pass-through. Baseline MFN duties, Section 301, photovoltaic safeguards, producer-specific antidumping and countervailing duties, currency movements and customs brokerage are outside the price calculation.

The February and March China measures are documented in the [CBP implementation notice](https://www.federalregister.gov/d/2025-02293) and [March increase](https://www.federalregister.gov/d/2025-03677). The aluminium treatment follows the [March change](https://www.whitehouse.gov/presidential-actions/2025/02/adjusting-imports-of-aluminum-into-the-united-states/) and [June change and UK exception](https://www.whitehouse.gov/presidential-actions/2025/06/adjusting-imports-of-aluminum-and-steel-into-the-united-states/).

The reciprocal tariff sequence follows [Executive Order 14257](https://www.whitehouse.gov/presidential-actions/2025/04/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices-that-contribute-to-large-and-persistent-annual-united-states-goods-trade-deficits/), its [country annex](https://www.whitehouse.gov/wp-content/uploads/2025/04/Annex-I.pdf), the [8 April order](https://www.whitehouse.gov/wp-content/uploads/2025/04/eo-14259.pdf), the [9 April order](https://www.whitehouse.gov/presidential-actions/2025/04/modifying-reciprocal-tariff-rates-to-reflect-trading-partner-retaliation-and-alignment/), the [product exceptions](https://www.whitehouse.gov/presidential-actions/2025/04/clarification-of-exceptions-under-executive-order-14257-of-april-2-2025-as-amended/), the [May reduction](https://www.whitehouse.gov/presidential-actions/2025/05/modifying-reciprocal-tariff-rates-to-reflect-discussions-with-the-peoples-republic-of-china/) and the [final July country schedule](https://www.whitehouse.gov/wp-content/uploads/2025/07/eo-14326.pdf).
