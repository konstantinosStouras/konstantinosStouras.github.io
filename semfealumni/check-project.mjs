#!/usr/bin/env node
/* ==========================================================================
   SEMFE Alumni · check-project.mjs
   A predeploy guard: refuse to deploy this project's rules or Functions into
   a Firebase project that is not this one.

   WHY: the owner's machines hold several unrelated Firebase projects. The
   Firebase CLI resolves the target from, in order: the --project flag, the
   FIREBASE_PROJECT env var, the "active project" it remembers PER DIRECTORY
   in its own global config, and only then the default alias in .firebaserc.
   The remembered one wins, is invisible in the repository, and survives
   between sessions, so `firebase deploy --only firestore:rules` can publish
   these rules into ANOTHER project's database and still print "Deploy
   complete!". It has happened twice in the sibling stouras.com repository.

   The CLI exports GCLOUD_PROJECT to every predeploy hook, so the target is
   knowable before anything is uploaded. This compares it with the default
   alias in .firebaserc and exits non-zero on a mismatch, which aborts the
   deploy.

   Run standalone to see what this directory would deploy to:
     node check-project.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

function expected() {
  const rc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
  const id = rc && rc.projects && rc.projects.default;
  if (!id) throw new Error('.firebaserc has no default project');
  if (/PASTE_/.test(id)) {
    console.error('check-project: .firebaserc still says ' + id + '. Put your Firebase project id there first (see FIREBASE-SETUP.md).');
    process.exit(1);
  }
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
  console.error('  Publishing here would overwrite another project\'s rules or functions.');
  console.error('  The CLI is remembering a different active project for this folder.');
  console.error('  Fix it, then deploy:');
  console.error('');
  console.error('      firebase use ' + want);
  console.error('      firebase deploy --only firestore:rules --project ' + want);
  console.error('');
  process.exit(1);
}

console.log('check-project: deploying to ' + got + ' ✓');
