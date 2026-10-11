import {readFileSync} from 'node:fs';
const expected=JSON.parse(readFileSync(new URL('.firebaserc',import.meta.url))).projects.default;
if(process.env.GCLOUD_PROJECT!==expected){console.error(`Wrong project. Deploy explicitly with --project ${expected}.`);process.exit(1);}
