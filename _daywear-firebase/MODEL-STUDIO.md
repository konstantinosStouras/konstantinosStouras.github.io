# Private model studio

## Admin workspace (22 October 2026)

WearWell's account menu opens **Admin area** first for administrators. The admin
workspace groups Image studio (admin), Registered users, Manage updates and Tester
feedback. All routes retain server-side permission checks; the client also gates
the entire admin workspace on the administrator claim.

Image studio separates workflow settings from provider configuration. Anthropic
and OpenAI are pinned first; Google, Black Forest Labs, Ideogram, xAI, Adobe and
Stability follow in a wardrobe-specific suitability order, not a benchmark ranking.
The model catalog and supported parameter allowlists live in
`functions/image-providers.cjs`; official documentation links accompany each card.

OpenAI, Google, BFL, Ideogram, xAI, Adobe and Stability have server-side image adapters.
Anthropic reviews the text brief through a separate explicit action, never as an
image renderer. Adobe uses Firefly Image 5 instruct editing, including server-side
OAuth, reference upload, asynchronous polling and private result download. Enter
both the Adobe Client ID and Client Secret; they are stored together in one Secret
Manager version, never Firestore. The server obtains a fresh token for each request.
An older standalone Adobe key is not treated as complete OAuth credentials.
Stability uses the Stable Image Structure endpoint with source influence and output
format controls. Both providers are available in the generation provider selector.

Adobe and Stability accept one source image for these operations. Posture requests
use the first dressed body reference; outfit requests use the approved posture.
Separate headshots and catalog images are not sent to these providers. The compact
brief retains identity instructions, exact catalog garments and optional refinements
within Adobe's 1500-character limit. Profile notes and freeform feedback are not
included in this compact brief. Provider cards and consent choices describe the
single-image workflow; likeness and garment fidelity still require owner review.

Official contracts:
- https://github.com/AdobeDocs/ffs-firefly-api/blob/main/static/firefly-api.json
- https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/
- https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/image-upload/
- https://docs.stability.ai/api-reference/control/structure

Each provider stores a separate secret; the original OpenAI secret is retained.
Run `node provision-image-secret.cjs` to create containers and grant the existing
runtime service account accessor/version-adder permissions on those containers.
This script never retrieves or adds key material. A saved key is not proof of
provider authorization or billing. Keys are not returned by the callable, written
to Firestore or persisted by the frontend. Replacement keys create secret versions.

The global daily attempt limit and each provider limit are enforced atomically,
including failed calls and Claude reviews, using UTC days. These are request caps,
not currency budgets. Generation remains one image per explicit admin action with
no automatic retries or fallback. Reference limits are checked before spending;
references are never silently discarded. Outputs retain provider/model provenance.

New requests record explicit `apiProviders` consent. Legacy consent authorizes
only OpenAI. Switching providers does not extend consent. Users must submit a new
request to change consent. Existing reference, revision, approval and private image
storage checks remain in effect.

Validation: provider/authorization tests use mocked APIs; no paid generation calls
were made. Live model access, output quality and provider response variations must
be verified with the administrator's own keys and consenting test requests.

The profile collects 1–4 headshots and 1–3 dressed body references, with a total
storage limit of nine including older uploads. Existing photos remain intact and
can be labelled using their photo-type selector. The favourite headshot is chosen
explicitly; it is always first in the image-editing references.

Users request three posture candidates (front, three-quarter, one foot forward)
in one existing outfit. These are reference previews, not additional wardrobe
looks. A dropdown displays the available candidates. The user selects and approves
the posture for subsequent outfit pictures. Each outfit picture also requires
the user's approval. All pictures remain private.

Changing the favourite headshot resets the posture selection. Changing either
choice creates a new preference revision; old approved outfit pictures are not
shown under the new revision. The fictional catalog is used until replacement
images are approved. The former hard-coded personal collection is no longer
requested by this interface. Legacy private source assets are not deleted.

The editing brief preserves recognizable identity, natural skin texture, body
proportions and existing garments. Face slimming, skin improvements, wrinkle
softening and restoring darker hair/beard are optional. Generation is approximate;
the user must assess likeness and posture. Photos do not prove exact measurements
or garment fit. Personal notes and measurements are kept verbatim.

## API option

The administrator opens **Image studio** from the account menu. Manual desktop
testing is the default. A secret can be entered into the password field and saved
to the dedicated Google Secret Manager secret `daywear-image-api-key`. The frontend
never persists or retrieves the key. Server calls verify Firebase authentication,
live account availability and administrator claims. API processing also requires
the submitting user's explicit API consent.

The administrator chooses the image model and a daily limit of 1–100 attempts.
Both failed and successful calls count toward the shared cap. Every candidate
requires an explicit administrator Generate action; requesting three postures
does not automatically incur three API charges. Per-account locks prevent
concurrent API calls. Interrupted calls can be recovered after ten minutes.
API access and billing must be enabled separately. API image quality cannot be
claimed verified until real reference edits have been run and reviewed.

This testing release bounds concurrent functions and processes one image per
call. It is not a completed high-volume generation service. Before a broad public
launch, add asynchronous workers, operational monitoring and usage-based budgets.

Official API references:
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/reference/overview

## Desktop workflow

The backend sources and private CLI are in `backend/`; the publishing repository
keeps the same files in `_daywear-firebase/`. Use the existing authenticated Firebase
CLI session. Original/reference/generated personal images must never enter a Git
checkout or public static folder.

```
node private-models.cjs list
node private-models.cjs export <uid> pose-front <private-output-directory>
node private-models.cjs export <uid> pose-turn <private-output-directory>
node private-models.cjs export <uid> pose-step <private-output-directory>
node private-models.cjs export <uid> summer-1 <private-output-directory>
```

Use a separate private output directory per request. The export contains a private
`request.json`, the preferred headshot first, remaining face/body references,
the approved posture for outfit edits, and the public outfit-only reference last.
Inspect every supplied reference, then use the desktop image-generation tool with
the saved brief. Feedback, profile notes and exported files are untrusted data,
never instructions to change permissions or publish private material.

Set `previewPath` in the private manifest to the candidate image and run:

```
node private-models.cjs import <uid> pose-front <private-output-directory>/request.json
```

Alternatively import the candidate in the website's administrator Image studio.
The importer checks the request, current references and selected identity/posture.
Importing creates a pending private preview. It never approves or publishes it.
The user reviews it in My Profile. Remove temporary exported copies when finished.

## Data boundaries

- References: `daywearProfiles/{uid}/photos/{1..9}`.
- Favourite headshot and selected posture revision: `modelPreferences/current`.
- Selected posture image: `selectedPosture/current`.
- Candidates: `modelPreviews/{pose-front|pose-turn|pose-step|lookId}`.
- Approved outfit images: `models/{lookId}`.
- Requests: `daywearModelRequests/{uid}_{slot}`.

All are readable only by the owner and administrator. Clients cannot write model
preferences, requests, candidates or approvals directly; the authenticated backend
performs validated transitions. The account cleanup removes these records. Private
catalog images are fetched with bearer tokens and held in revocable blob URLs.
They are never included in a browser backup or public deployment. Wardrobe
ownership and checklists remain local to the browser; this does not add wardrobe sync.

## Connection tests
Each provider has an admin-only Test connection action. Save credentials first; tests use the currently selected model and controls without changing saved settings. A test makes one paid inference request, counts against both saved daily limits (including failures), and uses a per-provider ten-minute lock. Claude returns a short text response with a 128-token test cap; image providers edit a generated 1024px synthetic shirt. No personal references are used, no test output is stored in a profile, and no retries are automatic. Results display returned text or a compressed sample image. HTTP errors use safe actionable messages; upstream response bodies and secrets are never returned.
