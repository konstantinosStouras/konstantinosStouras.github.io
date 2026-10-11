const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const project=JSON.parse(fs.readFileSync(path.join(__dirname,'.firebaserc'))).projects.default;
if(process.env.GCLOUD_PROJECT!==project)throw Error('Wrong Firebase project.');
const cwd=path.join(__dirname,'functions');
execFileSync(process.execPath,[path.join(cwd,'node_modules/firebase-functions/lib/bin/firebase-functions.js')],{cwd,env:{...process.env,FUNCTIONS_MANIFEST_OUTPUT_PATH:path.join(cwd,'functions.yaml')},stdio:'inherit',windowsHide:true});
