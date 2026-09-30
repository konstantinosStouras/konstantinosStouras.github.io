/* SEMFE Alumni Cloud Functions (see linkedin.js):
 *   linkedinSignIn      LinkedIn sign-in (HTTPS)
 *   cleanupDeletedUser  when a sign-in account is deleted, removes its
 *                       application, directory card and LinkedIn link
 *
 * Settings (asked for by the Firebase CLI on the first deploy, stored in
 * functions/.env.<project-id>; the secret goes to Google Secret Manager):
 *   LINKEDIN_CLIENT_ID      the LinkedIn app's Client ID (public)
 *   LINKEDIN_CLIENT_SECRET  the LinkedIn app's Primary Client Secret (SECRET):
 *                           firebase functions:secrets:set LINKEDIN_CLIENT_SECRET
 *   ALLOWED_ORIGINS         comma-separated site origins allowed to call it
 *   LINKEDIN_REDIRECT_URIS  comma-separated callback pages registered at LinkedIn
 *
 * Deploy (always name the project):
 *   cd functions && npm install && cd ..
 *   firebase deploy --only functions --project <your-project-id> */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { defineString, defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functionsV1 = require('firebase-functions/v1');
const { handle, cleanupUser, splitList } = require('./linkedin');

initializeApp();

const LINKEDIN_CLIENT_ID = defineString('LINKEDIN_CLIENT_ID', { description: 'LinkedIn app Client ID (Auth tab)' });
const LINKEDIN_CLIENT_SECRET = defineSecret('LINKEDIN_CLIENT_SECRET');
const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS', {
  default: 'https://www.stouras.com,https://stouras.com',
  description: 'Comma-separated origins of the site that may call this function'
});
const LINKEDIN_REDIRECT_URIS = defineString('LINKEDIN_REDIRECT_URIS', {
  default: 'https://www.stouras.com/semfealumni/auth/linkedin/',
  description: 'Comma-separated LinkedIn callback pages (must match the LinkedIn app Auth tab exactly)'
});

exports.linkedinSignIn = onRequest(
  { region: 'europe-west1', secrets: [LINKEDIN_CLIENT_SECRET], invoker: 'public', maxInstances: 5, timeoutSeconds: 30, memory: '256MiB' },
  (req, res) => handle(req, res, {
    fetch: globalThis.fetch,
    auth: getAuth(),
    db: getFirestore(),
    now: () => FieldValue.serverTimestamp(),
    log: e => logger.error('linkedinSignIn failed', e)
  }, {
    clientId: LINKEDIN_CLIENT_ID.value(),
    clientSecret: LINKEDIN_CLIENT_SECRET.value(),
    allowedOrigins: splitList(ALLOWED_ORIGINS.value()),
    redirectUris: splitList(LINKEDIN_REDIRECT_URIS.value())
  })
);

/* Firebase Auth has no 2nd-generation "user deleted" trigger, so this one is 1st generation. */
exports.cleanupDeletedUser = functionsV1.region('europe-west1').auth.user().onDelete(user =>
  cleanupUser({ db: getFirestore(), uid: user.uid }).then(n => logger.info('cleaned up ' + n + ' document(s) of deleted user'))
);
