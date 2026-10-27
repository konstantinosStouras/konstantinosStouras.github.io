import {readFileSync} from 'node:fs';
const expected=JSON.parse(readFileSync(new URL('.firebaserc',import.meta.url))).projects.default;
const actual=process.env.GCLOUD_PROJECT||process.env.FIREBASE_PROJECT;
if(actual!==expected){console.error(`Deployment refused: expected ${expected}, received ${actual||'no explicit project'}.`);process.exit(1);}
console.log('Verified Firebase target: '+expected);
