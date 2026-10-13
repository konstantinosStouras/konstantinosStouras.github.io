/* Explicit migration verification. Creates one labeled temporary response and
   anonymous account, then removes precisely those two resources in finally. */
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const S=require('../data-store'),project='simulation-platform-233cf',id=crypto.randomUUID();
const apiKey='AIzaSyDAgP5OlgdqqN0m9t3WtUXNfeW9T6W3iYA',base=S.base;
let account,created=false;
async function request(url,method='GET',body,token){return fetch(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});}
async function main(){
 try{
  const signup=await request('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+apiKey,'POST',{returnSecureToken:true});assert.equal(signup.status,200);account=await signup.json();
  const values={owner:account.localId,rule:'MIGRATION VERIFICATION '+id,confidence:4,analysisVersion:'evidence-2026-10-13',eventsJson:JSON.stringify([{index:1,nums:[1,2,3],passes:true}])};
  const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]));
  const url=base+'/problemSolvingResponses?documentId='+id;
  assert.equal((await request(url,'POST',{fields})).status,403,'unauthenticated create denied');
  assert.equal((await request(url,'POST',{fields:{...fields,confidence:{integerValue:'6'}}},account.idToken)).status,403,'invalid confidence denied');
  assert.equal((await request(url,'POST',{fields:{...fields,reviewedStatus:{stringValue:'correct'}}},account.idToken)).status,403,'self-certification denied');
  const saved=await request(url,'POST',{fields},account.idToken);assert.equal(saved.status,200,'real save');created=true;
  const doc=await saved.json();assert.ok(doc.createTime);assert.equal(S.rowFromDocument(doc)[1],1);
  assert.equal((await request(url,'POST',{fields},account.idToken)).status,409,'duplicate is not appended');
  const get=await request(base+'/problemSolvingResponses/'+id);assert.equal(get.status,200);assert.equal((await get.json()).fields.rule.stringValue,values.rule);
  assert.equal((await request(base+'/problemSolvingResponses/'+id,'PATCH',{fields},account.idToken)).status,403,'immutable response');
  assert.equal((await request(base+'/problemSolvingPrivateArchive/migration-20261013')).status,403,'private original archive');
  assert.equal((await request(base+'/simPlatformStudents')).status,403,'existing student roster stays private');
  console.log(JSON.stringify({saved:true,receipt:true,duplicateBlocked:true,invalidWritesDenied:true,archivePrivate:true,existingRosterPrivate:true}));
 }finally{
  if(created){const dir=process.env.FIREBASE_TOOLS||'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/firebase-tools';const auth=require(path.join(dir,'lib/auth')),{requireAuth}=require(path.join(dir,'lib/requireAuth')),{Client}=require(path.join(dir,'lib/apiv2'));await requireAuth({...auth.getGlobalDefaultAccount(),project});const db=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});const name=`/projects/${project}/databases/(default)/documents/problemSolvingResponses/${id}`;const doc=(await db.get(name)).body;if(doc.fields.rule.stringValue!=='MIGRATION VERIFICATION '+id)throw Error('Refusing unexpected cleanup');await db.delete(name);console.log('Removed the single verified temporary response.');}
  if(account){const deleted=await request('https://identitytoolkit.googleapis.com/v1/accounts:delete?key='+apiKey,'POST',{idToken:account.idToken});assert.equal(deleted.status,200);console.log('Removed the temporary anonymous account.');}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
