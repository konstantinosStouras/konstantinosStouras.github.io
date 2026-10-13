# Analysis and grading, October 2026

The current analysis replaces the earlier creativity/bias dashboard documented
in the historical sections of CLAUDE.md.

## Files

- `analysis.js`: pure evidence calculations, strict parsing, per-metric eligibility,
  benchmarks, peer exclusions and the report model.
- `analysis-ui.js`: screen, charts, save status and PDF from that shared model.
- `analysis.css`: responsive analysis styles.
- `answer-review.json`: explicit semantic review of every historical answer.
- `answer-model.js`: generated browser catalogue; rebuild with
  `node tools/build-answer-model.cjs` after a deliberate review change.
- `answer-grader.js`: reviewed-phrase lookup and conservative rules for unseen
  paraphrases. No fuzzy-match auto-grading or external model calls.
- `answer-review.html`: searchable audit and a no-save grader playground.

## Reviewed answers

The 13 October 2026 snapshot contains 386 responses and 354 distinct phrasings.
Codex's semantic review gives 142 correct, 204 incorrect, 21 unclear and 19
invalid/no-rule responses. This is assistant review, not instructor certification.
All decisions have explanations and source row references. Ordinary increasing
or ascending wording is accepted as strict unless equality or another restriction
is explicitly stated. Ambiguous and invalid answers are excluded from accuracy.
The import includes 360 recent responses, seven earlier 2026 responses and 19
responses from 2025. All 26 additional answers were reviewed. Older records without
test histories retain confidence and attempt counts but cannot contribute to
evidence-coverage metrics. Names remain only in the private original archive.

Old column J labels are not used in the new analysis. Explicit `Reviewed status`,
`Reviewed by` and `Reviewed at` sheet metadata takes precedence when present.
Otherwise only audited catalogue matches enter accuracy charts, not novel
automatically parsed wording. This prevents future unreviewed labels silently
becoming benchmark ground truth. New wording still receives conservative automatic
feedback, or a clarification request.

The independent paraphrase regression cases are not a claim of general predictive
accuracy. Unseen negation, restrictions and compound prose should abstain when the
parser cannot establish the full rule. Add examples only after reviewing them.

## Evidence and comparisons

Evidence coverage counts six explicit alternative rules contradicted by observed
tests. It is a teaching checklist, not creativity or a psychological diagnosis.
The seed earns nothing. Repeats add no coverage. Numeric magnitude alone earns no
credit. The alternatives overlap and one test can refute several.

Snapshot is fetched from the independent response database before sending the
current response, and its UUID is also excluded. If a fresh fetch fails, only a
pre-write snapshot can be reused. Timestamp and eligibility counts are displayed;
no missing sequences or cross-outcome order are inferred for old rows. Historical
repeat participants cannot be identified. The game collects no names or identities.

Each metric uses its own eligible n. Confidence remains the original 1–5 rating.
Tails use ceil(0.05*n) values, require n>=100, and are flagged unstable below 200.
Percentile is 100*(lower + 0.5*tied)/n. Top/bottom refer to that metric, not overall
thinking quality. Accuracy uses 95% Wilson intervals and only assessable labels.

The PDF uses the same report model, eligible peer vectors and chart instances as
the screen. The bundled DejaVu font's license is in assets/analysis-font-LICENSE.txt.

## Independent storage and migration

`data-store.js` reads and saves responses in isolated Firebase collections in the
existing `simulation-platform-233cf` project. The verified anonymous historical dataset is also served as `data/history.json`
so page loads do not consume hundreds of historical Firestore document reads.
New responses are read from the live collection.
The frontend remains a static
JavaScript app at the same GitHub Pages path. No Sheets or Apps Script requests
remain in the application. Anonymous Auth is loaded only when saving a real round;
a no-save test makes no write and does not create an authentication account.

- `problemSolvingLegacy`: 386 imported, anonymized responses; clients cannot write.
- `problemSolvingResponses`: new immutable response documents with random IDs,
  answer, confidence and ordered tests. The server supplies creation timestamps.
  Only the authenticated owner may create a document. Clients cannot add reviewed
  grades or edit/delete records. Retries verify the existing document by ID.
- `problemSolvingPrivateArchive`: the complete original workbook (including names,
  all tabs and formulas), original script and migration manifest; no client access.

The proposed rules permit public reads of anonymous response data for benchmarks
and instructor exports. They do not grant access to the original workbook or
change the existing platform collections. The helper inserts only the dedicated
rules block and checks that the prior rules remain byte-for-byte unchanged.
Stored test histories undergo full validation before entering analyses; malformed
records are excluded. The rules also bound fields, confidence and document size.
This is not an identity-verified or cheat-proof sample.

The user explicitly approved this Firebase boundary. The rules are deployed,
all 386 historical records were imported and read back exactly, and the private
workbook archive's SHA-256 was verified. Live checks passed for saving, receipts,
duplicate prevention, invalid writes, private archives and the existing roster.
The single labeled verification response and anonymous account were removed.
The independent game was verified live on 13 October 2026. A final CSV check
matched the imported snapshot exactly. The old Sheet was moved to recoverable
Trash, and the bound Apps Script confirmed "Project is in the trash". The full
private workbook and original script archive remain preserved independently.

`tools/import-history.py` extracts all response-bearing blocks, excludes names
from analytical records, uses stable import IDs and writes a SHA-256 manifest.
`_backend/admin.cjs` preserves existing access rules, imports idempotently and
checks every imported row and the private workbook archive against the source.
It uses the existing Firebase CLI login without writing or printing credentials.
The private source workbook and migration artifacts are outside the public repo.

The public game shows 386 historical responses and 359 eligible test histories.
The same report code passed browser/PDF integration checks and all 17 unit tests.
Publishing used an isolated Git index and preserved unrelated website changes
and the user's local staging area.

## Tests and links

`node --test tools/analysis.test.cjs tools/answer-grader.test.cjs tools/storage.test.cjs`

`tools/analysis-browser.cjs` runs browser/PDF/mobile/no-save checks using offline
fixtures. Supply `PW` (Playwright path), `ANALYSIS_FIXTURES` (historical-import.json,
chart.js and jspdf.js), and `ANALYSIS_OUTPUT`. It mocks Firebase and rejects any request to Sheets or Apps Script.

Playable no-save test: `?preview=1&key=stouras`.
Completed example: `?preview`.
Instructor view: `#admin`.
