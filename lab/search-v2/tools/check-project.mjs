#!/usr/bin/env node
/* ==========================================================================
   search-v2 · tools/check-project.mjs
   A predeploy guard: refuse to deploy this study's rules or Functions into a
   Firebase project that is not this study's.

   WHY THIS EXISTS. This repository holds several unrelated Firebase projects
   (Answer Arena, PortfolioFit, the Ideation Challenge, Sustainable Supply
   Chains, The Lit, and this study). The Firebase CLI resolves the target
   project from, in order: the --project flag, the FIREBASE_PROJECT env var,
   the "active project" it remembers per directory in its own global config,
   and only then the default alias in .firebaserc. The remembered active
   project wins over .firebaserc, is invisible in the repository, and survives
   between sessions — so a `firebase deploy --only firestore:rules` run in
   THIS directory can publish THIS file set into ANOTHER project's database
   and report a clean success. It has happened: search-v2's rules were
   released to `stouras-answerarena`, which locked Answer Arena's own
   participants out until its rules were re-published.

   The CLI exports GCLOUD_PROJECT to every predeploy hook, so the target is
   knowable before anything is uploaded. This compares it with the default
   alias in .firebaserc and exits non-zero on a mismatch, which aborts the
   deploy. An older CLI that exports nothing is allowed through with a
   warning rather than blocking a legitimate deploy.

   Run standalone to see what this directory would deploy to:
     node tools/check-project.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function expected() {
  const rc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
  const id = rc && rc.projects && rc.projects.default;
  if (!id) throw new Error('.firebaserc has no default project');
  return id;
}

const want = expected();
const got = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || '';

if (!got) {
  console.warn('check-project: the CLI exported no project id, so the target could not be verified.');
  console.warn('check-project: expected "' + want + '" — pass --project ' + want + ' to be certain.');
  process.exit(0);
}

if (got !== want) {
  console.error('');
  console.error('  ✗ DEPLOY REFUSED — wrong Firebase project.');
  console.error('');
  console.error('      this directory belongs to : ' + want);
  console.error('      the deploy is targeting   : ' + got);
  console.error('');
  console.error('  Publishing here would overwrite another study\'s rules or functions.');
  console.error('  The CLI is remembering a different active project for this folder.');
  console.error('  Fix it, then deploy:');
  console.error('');
  console.error('      firebase use ' + want);
  console.error('      firebase deploy --only firestore:rules --project ' + want);
  console.error('');
  process.exit(1);
}

console.log('check-project: deploying to ' + got + ' ✓');
