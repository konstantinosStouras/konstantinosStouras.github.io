# Chinese Practice — first SATLE prototype

Student website: https://www.stouras.com/chinese/
Teaching area: https://www.stouras.com/chinese/admin/
Firebase project: `stouras-chinese` (isolated from other simulations).

## What is included

Two main pathways with three independently editable cohorts: HSK1 beginner (15 students), Business Chinese HSK4–5 (8), and HSK5 (6). Each has 12 weeks. Week 1 contains clearly labelled demonstration content; other weeks start as unpublished drafts. Beginner samples use the seven characters in Lucy's handout. Advanced samples are original illustrative vocabulary, pending lecturer review.

Student practice includes stroke-order animation and guided drawing (Hanzi Writer), pinyin with tone checking, device speech playback when a Mandarin voice is installed, 20-second microphone recordings and local playback. Google accounts save practice records. Admins manage weekly vocabulary, repetitions, hints, activities, draft/publish status and student AI access. The owner can promote registered users and enable a shared `teacher` login by choosing a password.

Google sign-in automatically recognises only the verified `kstouras@gmail.com` Google account as owner. Email/password users cannot claim owner access simply by registering that address. Other admin roles and student approvals are stored in protected collections. Shared credentials never appear in source code.

AI keys are stored only in Google Secret Manager. The callable backend supports OpenAI `gpt-transcribe` for recognised-word feedback, and Azure Speech for pronunciation accuracy/fluency/completeness. OpenAI results are never represented as tone scores. Azure scores also need teacher calibration before assessment use. No provider key is preloaded. Raw recordings are not stored by this project; requested feedback and transcripts are saved. Daily limits: 40 requests per user and 300 globally. Max 2 backend instances, zero warm instances.

## Local development

Node 22 is required. Run `npm ci`, `npm test`, `npm run build` and `npm run serve`. Open http://localhost:4173/chinese/. Production assets are in `site/chinese/`. The build does not delete bundled character data. Run `node tools/assets.mjs` to refresh the 23 sample characters and their licence.

Firebase functions: run `npm ci` in `_chinese-firebase/functions`. Every deployment must explicitly pass `--project stouras-chinese`; the predeploy guard reads `.firebaserc` and refuses mismatched projects.

```
cd _chinese-firebase
firebase deploy --only firestore:rules,functions --project stouras-chinese
```

Source and production files are published into `_chinese-prototype/` and `chinese/` of the existing GitHub Pages repository. Publishing preserves every unrelated file and uses a normal fast-forward update to `master`. Local provisioning helpers are not published.

## Activation

The project needs an active Google Cloud billing account to deploy the secure functions. Secret Manager secrets `chinese-openai` and `chinese-azure` must be created in this project. The runtime service account needs secret-version access and addition permissions on those two secrets. No service-account private keys are created.

After backend deployment: sign in at the admin URL with the owner Google account, open Settings, choose a provider and save its API key. Azure additionally needs the Speech resource name. Set a shared password if that login is wanted. Lucy signs in with Google once; the owner can then appoint her in People & practice. Approve student accounts for metered AI feedback.

Before a classroom pilot: review vocabulary, calibrate pronunciation against Lucy's rubric, confirm university participant information and retention arrangements, and test real microphones and touch input on the actual student devices. No claims of universal browser compatibility or assessment validity are made.

## Dependencies and references

Hanzi Writer (MIT): https://hanziwriter.org/docs.html
Character data: Make Me a Hanzi, Arphic Public License (included in `site/chinese/characters/LICENSE.txt`).
OpenAI file transcription: https://developers.openai.com/api/docs/guides/speech-to-text
Azure pronunciation assessment: https://learn.microsoft.com/azure/ai-services/speech-service/how-to-pronunciation-assessment
Azure short-audio REST interface: https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short

Not included in this first version: automatic lesson generation, textbook ingestion, live classroom sessions, spaced repetition scheduling, paragraph polishing, exam timing and graded assessments.
