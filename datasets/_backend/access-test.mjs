import {createRequire} from 'node:module';
import {firebaseConfig as config} from '../firebase-config.mjs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.env.APPDATA+'/npm/node_modules/firebase-tools/lib/';
const auth=require(root+'auth.js'),account=auth.getGlobalDefaultAccount();
const credential=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase']);
const project=config.projectId,base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const accounts=[];
async function request(url,method='GET',body,token){const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function user(){const email=`dataset-access-test-${crypto.randomUUID()}@example.invalid`,password=crypto.randomUUID()+'Aa1!';const r=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,'POST',{email,password,returnSecureToken:true});assert.equal(r.status,200);accounts.push(r.body.localId);return {...r.body,email,password};}
try{
  const anonymous=await request(base+'/datasetLinks/nber-patent-data-project');assert.equal(anonymous.status,403);
  const a=await user(),b=await user();
  assert.equal((await request(base+'/datasetLinks/nber-patent-data-project','GET',null,a.idToken)).status,403);
  const verified=await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,'POST',{localId:a.localId,emailVerified:true},credential.access_token);assert.equal(verified.status,200);
  const login=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`,'POST',{email:a.email,password:a.password,returnSecureToken:true});assert.equal(login.status,200);
  const token=login.body.idToken;assert.equal((await request(base+'/datasetLinks/nber-patent-data-project','GET',null,token)).status,200);
  const path=base+'/users/'+a.localId+'/bookmarks/nber-patent-data-project';
  const commit={writes:[{update:{name:`projects/${project}/databases/(default)/documents/users/${a.localId}/bookmarks/nber-patent-data-project`,fields:{datasetId:{stringValue:'nber-patent-data-project'}}},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]};
  assert.equal((await request(base+':commit','POST',commit,token)).status,200);
  assert.equal((await request(path,'GET',null,b.idToken)).status,403);
  assert.equal((await request(path,'GET',null,token)).status,200);
  const submissionId='access-test-'+crypto.randomUUID(),submissionPath=base+'/submissions/'+submissionId;
  const fields={uid:{stringValue:a.localId},kind:{stringValue:'addition'},datasetId:{stringValue:''},title:{stringValue:'Temporary access test'},url:{stringValue:'https://example.invalid/dataset'},description:{stringValue:'Temporary rules test'},tags:{stringValue:'Test'},status:{stringValue:'pending'}};
  const submission={writes:[{update:{name:`projects/${project}/databases/(default)/documents/submissions/${submissionId}`,fields},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]};
  assert.equal((await request(base+':commit','POST',submission,token)).status,200);
  assert.equal((await request(submissionPath,'GET',null,b.idToken)).status,403);
  fields.status.stringValue='approved';
  assert.equal((await request(base+':commit','POST',submission,token)).status,403);
  await request(submissionPath,'DELETE',null,credential.access_token);
  await request(path,'DELETE',null,credential.access_token);
  console.log('PASS: anonymous and unverified access denied; verified access allowed; bookmarks isolated; suggestions accepted privately; self-approval denied.');
}finally{
  for(const localId of accounts)await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:delete`,'POST',{localId},credential.access_token);
  console.log('Temporary test accounts removed. No test emails sent.');
}
