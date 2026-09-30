#!/usr/bin/env node
/* SEMFE Alumni · tools/rules-test/check-project.mjs
   This folder only runs the Firestore EMULATOR for the rules tests
   (npm test). It deploys nothing, ever. Its firebase.json still has a
   "firestore" section, so a stray `firebase deploy` run here would try to
   publish into whatever project the CLI remembers for this folder. This
   predeploy hook stops that: it names the project from .firebaserc (a demo-
   project, which exists only inside the emulator) and always exits 1.
   Deploy the real rules from the site folder instead:
     cd ../.. && firebase deploy --only firestore:rules --project <your-project-id> */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let want = '(unknown)';
try { want = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8')).projects.default; } catch (e) { /* reported below */ }
const got = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || '(not set)';
console.error('check-project: DEPLOY REFUSED. tools/rules-test is emulator-only (' + want + '); the CLI was about to deploy to ' + got + '.');
console.error('check-project: deploy from the site folder: firebase deploy --only firestore:rules --project <your-project-id>');
process.exit(1);
