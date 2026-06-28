# The Ideation Challenge — How the Simulation Worked for Human Participants

> **Purpose of this document.** This is a plain-language briefing for a large
> language model (or any analyst) that needs to understand **what human subjects
> actually did** in the "Ideation Challenge" study, and **exactly what they
> experienced under the four key experimental conditions** (AI assistance present
> or absent in the Individual phase and/or the Group phase). It deliberately
> describes the **human experience, the decisions people made, and the rules they
> played under** — not the software, data model, or implementation. Where a number
> is given (durations, idea counts, group size), it is the **study default**; the
> instructor could change any of these per run, and one part of the brief (the
> product theme) was sometimes swapped, as noted.

---

## 1. What the study is, in one paragraph

The Ideation Challenge is a **structured product-brainstorming game** run as a
controlled experiment. Each participant is a subject who is asked to **invent new
product concepts** for a given design brief, first **alone** and then **as part of
a small group**, and finally to **vote with their group** on the best ideas. The
research question is about **how people generate their best ideas** — specifically
how working **individually vs. in a group**, and **with vs. without an AI
assistant**, changes the quantity and quality of the ideas produced. Idea quality
is judged afterwards by **external human reviewers**, and there is a **real
monetary incentive** tied to producing top-ranked ideas.

The experiment is a **2 × 2 design**: AI assistance is independently switched
**on or off** in the **Individual** phase and **on or off** in the **Group**
phase, giving the four conditions described in Section 7.

---

## 2. The design brief and the incentive (what subjects were trying to do)

**The creative task.** Participants were asked to **design a brand-new product**
for the **"smart materials and wearable technology" market**. The default concrete
brief was:

> *Design a completely new product using a **fabric that changes colour when it
> reaches 37 °C (body temperature)**. Consider what users currently have and what
> unmet needs remain.*

They were given a worked example so they understood the expected format and
ambition level, e.g.:

> **TITLE:** Body-Heat Reveal Tee
> **DESCRIPTION:** A t-shirt that reveals a hidden pattern wherever your body heat
> warms the fabric, shifting as you move — no electronics needed.

> **Note on the theme.** The product theme was instructor-configurable. The default
> shipped theme was the colour-changing/body-heat fabric above. Some runs used a
> **sleep-and-wellness** theme instead (the post-task survey still contains a
> "sleep wellness" section, and an example product image of a sleep mask exists),
> so when reading a given session's ideas, infer the theme from the brief that was
> actually shown. The **structure, decisions, and conditions below are identical
> regardless of theme.**

**The evaluation criteria** participants were told to optimise for (shown in both
phases' task briefs):

- **Novelty** — Is the idea new, surprising, original?
- **Feasibility** — Can it be built with today's technology?
- **Financial Value** — Does it have market potential?
- **Overall Quality** — Is it well-structured and relevant?

**The incentive (a group-level prize).** Participants were told their ideas would
be **judged independently by external reviewers**, and that **if an idea their
group selected ranked among the top 5 ideas across roughly 50 groups, every member
of that group would win a €50 Amazon voucher.** This reward is **collective** (the
whole group wins or doesn't) and is attached to the **group's final chosen ideas**,
which is why the group voting/consensus step (Section 6) carried real stakes.

---

## 3. The participant journey, end to end

Every subject moved through the same sequence of screens. The decisions they made
at each step are called out in **bold**.

1. **Join** — The participant entered a **session code** given by the instructor.
   No prior account knowledge was needed.

2. **Welcome / consent to proceed** — A study overview explained the three phases
   and the €50 prize. **Decision: agree to take part and continue.** Crucially, the
   welcome screen (and any shareable link preview) **never mentioned AI** — the
   existence of an AI helper was deliberately not advertised here.

3. **Guided demo tour (optional)** — An auto-playing, skippable walkthrough showed,
   with mock screens, how each phase works (adding ideas, selecting, group chat,
   voting, the survey). It revealed the *mechanics* but not the real task brief or
   the survey questions. **Decision: watch, skip, or step through it.**

4. **Registration (demographics + consent)** — The participant filled in a short
   profile. The default fields were: **Student ID, Age band, Gender (optional),
   Nationality, Country of residence, Level of study, Years of work experience,
   Occupation, English fluency.** They also ticked **two consent checkboxes**
   (being 18+, and accepting anonymous research use of their data). **Decisions:
   all of the above self-reported answers and consents.**

5. **Lobby / waiting room** — The participant waited while the system formed groups.
   Groups were **3 people** by default; people were placed into groups in join
   order. **No decision** here — just waiting until their group was complete and the
   first phase began for everyone in the group together.

6. **Individual Ideation phase** — see Section 5.

7. **Group Ideation phase** — see Section 6 (ideation sub-phase).

8. **Group Voting phase** — see Section 6 (voting sub-phase).

9. **Post-task survey** — see Section 8.

10. **Done** — A completion screen thanked them; their responses were recorded.

> **Default phase order:** Individual first, then Group (ideation → voting), then
> survey. The instructor could reverse the order, or run only the Individual phase
> or only the Group phase; the default and the experimentally interesting case is
> **Individual → Group**.

**Anonymity throughout the social parts.** Inside a group, members were shown only
as **anonymous labels p1, p2, p3** — never by real name. Group chat, idea
authorship within the group, and votes were all under these anonymous labels.

**Timing.** Each phase had a countdown **timer** (per participant, starting when
that person pressed **Start**). Defaults: **Individual = 10 minutes**, **Group =
15 minutes** (the group's 15-minute clock covered *both* the group ideation and the
group voting sub-phases — there was a single group timer, not two). When a timer ran
out, the participant was **moved on automatically**, submitting whatever they had.
As the group clock wound down, **self-dismissing on-screen reminders** popped up
("5 minutes left… keep generating ideas and vote", "2 minutes left", and in voting
"1 minute left", "30 seconds left — place your votes").

---

## 4. The complete list of decisions a subject made

For quick reference, here is everything a human participant actually *chose* or
*produced* during a full Individual → Group run:

- **Registration:** their demographic answers and two consents.
- **Individual phase:**
  - **How many ideas to generate** (up to a cap, default **5**) and **whether to
    stop early**.
  - **The content of each idea** — a short **title** and a **description** of what
    it does, how it works, and why it's unique.
  - **Editing/deleting** their own ideas while time remained.
  - **Which of their ideas to "carry" forward** — they **selected their best 3**
    (default) to bring into the group phase.
  - **(AI conditions only) Whether and how to consult a private AI assistant** —
    what to ask it, and whether to act on its suggestions.
- **Group ideation sub-phase:**
  - **What to say in the group chat** — feedback, opinions, proposed combinations.
  - **Whether/what new group ideas to add** — the brief asked each member to
    contribute up to ~2 brand-new ideas created together as a team (on top of the
    up-to-9 carried-in ideas).
  - **How to evaluate and compare** all ideas against the four criteria.
  - **(AI conditions only) Whether and how to use the shared group AI assistant.**
  - **When to declare the group ready** and move to voting.
- **Group voting sub-phase:**
  - **Which ideas to vote for** — each member picked **3** ideas (default) from the
    combined list of all ideas (carried-in + group-generated).
  - **Whether to coordinate for consensus** — the group was urged to **converge on
    the same set** of ideas; spread-out votes triggered a "your group hasn't agreed"
    warning, and they could keep discussing or submit anyway.
  - **When to submit their votes** (locking them in).
- **Survey:** all self-report answers (Section 8).

---

## 5. The Individual Ideation phase (in detail)

**What the subject saw and did.** After a brief **instructions screen**, the
participant pressed **Start** and entered a workspace with:

- A **collapsible task brief** (the colour-changing-fabric prompt, the worked
  example, the four evaluation criteria, and the instruction to select their best
  ideas at the end).
- An **idea entry area** where they added ideas one at a time, each with a **title**
  and a **description**. They could **edit** or **delete** their own ideas.
- A **counter** showing how many of the allowed ideas (default **up to 5**) they had
  used.
- A **timer** (default **10 minutes**).

**The core individual decisions:**

1. **Generate ideas** — invent as many strong, original product concepts as they
   could, within the cap, framed by the brief and criteria. Working **alone** was
   explicitly required ("do not communicate or collaborate with others" in this
   phase).
2. **Select the ones to carry forward** — before finishing, they **chose their best
   3 ideas** (default) to take into the group phase. Only these carried-in ideas
   represented them in the group.

If the timer expired before they finished, the system **auto-submitted** whatever
existed and auto-selected the most recent ideas up to the carry limit, so no one
could stall their group by never finishing.

---

## 6. The Group phase (in detail)

The group phase had **two sub-phases the participants moved through themselves**:
**group ideation**, then **group voting**. Both ran under the **same single group
timer** (default 15 minutes total).

### 6a. Group ideation sub-phase

After a group **instructions screen** and pressing **Start**, each member saw a
shared workspace:

- **"Group Ideas so far"** — one combined list of **all the ideas in play**: the
  ideas **each member carried in** from the individual phase (up to **9 total** =
  3 members × 3 carried ideas) **plus** any **new ideas the group adds** during this
  phase. Each idea showed which anonymous member it came from.
- An **"Add a Group Idea"** area to contribute **brand-new team ideas** (the brief
  asked each member to add up to ~2). New group ideas appeared in the shared list
  for everyone.
- A **group chat** (anonymous, real-time) to discuss, give feedback, and propose
  combinations.

**The core group-ideation decisions:**

1. **Discuss and build on each other's ideas** via chat — what's strong, what could
   combine, what's missing.
2. **Create new group ideas together** — not just reuse the carried-in ones.
3. **Evaluate every idea** against Novelty / Feasibility / Financial Value /
   Overall Quality and form a shared sense of which stand out.
4. **Decide the group is ready** and click **Proceed to Voting**.

### 6b. Group voting sub-phase

When ready, members entered voting (the group could move at slightly different
moments; the shared timer kept ticking). Each member saw:

- The **full merged list of all ideas** (carried-in **and** group-generated),
  sortable by current vote tally, each tagged as an "individual" or "group" idea.
- A **vote counter** (e.g. 0/3).

**The core voting decisions:**

1. **Cast votes** — each member selected the **ideas that should represent the
   group** (default **3**; the required number adapted downward only if the group had
   fewer than 3 ideas total). Votes were visible as live tallies so members could see
   where the group was converging.
2. **Coordinate for consensus** — the group was strongly encouraged to **all vote
   for the same set**. They were warned: if the group's votes were **spread across
   different ideas** (no consensus), a reminder appeared, and they were told that
   **failing to reach consensus could result in ideas being selected effectively at
   random on the group's behalf, lowering their performance** — a deliberate push
   toward genuine agreement.
3. **Submit votes** — locking them in. Once **all members had submitted** (or the
   timer expired), the group's **top-voted ideas became its final selection** (the
   group's official entry, eligible for the €50 prize).

If the timer expired, whatever votes a member had at that moment were locked in for
them, so the group always finished on schedule.

---

## 7. The four key conditions (the 2 × 2 AI design) — exactly what each subject played

The single experimental manipulation was the **presence of an AI assistant**,
toggled **independently** for the Individual phase and the Group phase. A given
session was fixed to **one** of the four combinations, and **every participant in
that session experienced that same condition.** The AI was **never advertised** up
front — a participant only discovered it when they reached a phase where it was
switched on, at which point a line in that phase's task brief announced it and an
**AI chat panel appeared on the right-hand side of the workspace.**

**What the AI assistant was, from the human's point of view.** A conversational
helper the participant could chat with to **brainstorm, develop, refine, combine,
and choose ideas.** It did not submit ideas or vote for them — the human always
remained the one who wrote, selected, and voted. Its crucial property was **who
could see the conversation:**

- **Individual-phase AI = PRIVATE.** "Your conversation is yours alone — only you
  can see it." Each participant had their own separate AI chat.
- **Group-phase AI = SHARED.** "Everyone sees the same conversation — all messages
  and replies are shared across the group." It was a single team assistant in the
  group workspace, visible to all members like a participant in the chat.

The four conditions:

| # | Condition | Individual phase | Group phase | What the subject experienced |
|---|-----------|------------------|-------------|------------------------------|
| **1** | **No AI** | AI **off** | AI **off** | Pure human ideation throughout. They brainstormed alone unaided, then collaborated and voted with only their group-mates and the group chat. No AI panel ever appeared. This is the **control** condition. |
| **2** | **AI in Individual only** | AI **on** (private) | AI **off** | Alone, each subject could consult a **private** AI to help generate/refine the ideas they would carry forward. In the group phase the AI disappeared — collaboration and voting were **human-only**. Tests whether **AI-assisted individual ideation** changes the ideas brought into the group and the group's output. |
| **3** | **AI in Group only** | AI **off** | AI **on** (shared) | Each subject brainstormed **alone, unaided**, and carried in purely human ideas. Then in the group phase the team gained a **shared** AI assistant visible to everyone, used collectively to discuss, refine, and select. Tests whether **AI in the collaborative stage** changes group ideation and selection. |
| **4** | **AI in both** | AI **on** (private) | AI **on** (shared) | Subjects had a **private** AI while ideating alone **and** a **shared** AI while working as a group. AI support was available at every creative step. The **fully-assisted** condition. |

**Everything else was held constant across the four conditions:** the same brief,
the same criteria, the same number of ideas (up to 5 individual, carry 3), the same
group size (3), the same timers (10 min individual, 15 min group), the same chat,
the same voting rules and consensus pressure, the same prize, and the same survey.
The **only** thing that changed between conditions was **whether the AI panel was
present in each phase** (and, when present, whether it was private or shared, which
is fixed by the phase: individual→private, group→shared).

> **Reading a participant's behaviour by condition.** In conditions 2 and 4, a
> subject's carried-in ideas may reflect private AI brainstorming. In conditions 3
> and 4, the group's new ideas, chat, and final selection may reflect the shared AI.
> In condition 1, all ideas and decisions are unaided human output. The human always
> made the final calls (what to write, what to carry, what to vote for) in every
> condition; the AI, where present, was an **optional assistant**, not a decision
> maker.

---

## 8. The post-task survey (what subjects self-reported at the end)

After finishing, every participant answered a short survey reflecting on the
experience. The default questionnaire (questions tied to the group phase only
appeared when a group phase had been played):

**Section — Your Experience**
1. How **easy or difficult** was it to come up with new product ideas? *(1–5: very
   easy → very difficult)*
2. How **satisfied** are you with the ideas you/your group developed? *(1–5)*
3. **Rate your group's ideas** on **Novelty**, **Usefulness**, and **Overall
   quality** *(each 1–5)*. *(group runs only)*
4. How **comfortable** were you collaborating with group members? *(1–5)* *(group
   runs only)*

**Section — Creativity and Idea Generation**
5. How often did you **support others' ideas** during the group phase? *(1–5: never
   → always)* *(group runs only)*

**Section — Reflection (open text)**
6. If you repeated this task, **what would you do differently?**
7. Any **additional comments** about the idea-generation process in each phase.

**Section — Questions about sleep wellness** *(present in the shipped default survey;
relevant especially to the sleep-wellness theme variant)*
8. How **important** is sleeping well in your daily life? *(1–5)*
9. How often do you do **wellness activities** (exercise, meditation, sleep
   tracking, healthy eating)? *(1–5: never → daily)*
10. Have you **bought/used a sleep or wellness product** in the last six months?
    *(Yes/No; if Yes, name it)*
11. Are you **interested in trying new sleep/wellness products or tech**? *(1–5)*
12. Do you have **prior experience with innovation, marketing, or product
    development**? *(Yes/No/Unsure)*

Notably, **the survey did not ask whether the AI was helpful** by default and the
study never told participants that AI presence was the manipulation — consistent
with AI being kept low-profile/optional rather than the advertised focus.

---

## 9. Default parameters at a glance

These are the shipped defaults (each was instructor-adjustable per session):

| Parameter | Default | Meaning for the participant |
|-----------|---------|------------------------------|
| Phase order | Individual → Group | Brainstorm alone first, then collaborate. |
| Group size | 3 | Three anonymous members per group (p1, p2, p3). |
| Max individual ideas | 5 | Up to five ideas could be created alone. |
| Ideas carried to group | 3 | Each member brought their best 3 into the group. |
| Ideas visible at group start | up to 9 | 3 members × 3 carried ideas, shown to all. |
| New group ideas per member | ~2 (asked) | Each member contributed a couple of brand-new team ideas. |
| Votes per member | 3 | Each member voted for 3 final ideas (adapts down if fewer ideas exist). |
| Group's final picks | top-voted ideas | The most-voted ideas became the group's official entry. |
| Individual timer | 10 minutes | Per-participant countdown for solo ideation. |
| Group timer | 15 minutes | Single countdown covering group ideation **and** voting. |
| Individual AI | on/off per condition | Private assistant, if enabled. |
| Group AI | on/off per condition | Shared assistant, if enabled. |
| Prize | €50 Amazon voucher | To every member of a group whose idea ranks top-5 across ~50 groups. |

---

## 10. One-paragraph summary for fast grounding

A subject joins with a code, consents, gives demographics, and is placed in an
anonymous group of three. **Alone (default 10 min)** they invent up to five new
product concepts for a fixed design brief (default: a product using fabric that
changes colour at body temperature), then **pick their best three** to carry
forward. **As a group (default 15 min)** they pool those up-to-nine ideas, chat
anonymously, **invent new team ideas**, evaluate everything on novelty / feasibility
/ financial value / overall quality, and then **each vote for three ideas**, pushed
to reach **consensus**; the group's **top-voted ideas** become its official entry,
with a **€50-per-member prize** if it ranks top-five across all groups. The one
experimental lever is an **optional AI assistant**, switched on or off
**independently** for the solo phase (where it is **private to each person**) and the
group phase (where it is **shared by the whole team**), yielding **four conditions**:
**no AI, AI-individual-only, AI-group-only, and AI-in-both** — with everything else
held identical. Finally, everyone answers a short reflection-and-background survey.
