/* Deployment/migration helper. Uses the existing Firebase CLI login in memory.
   FIREBASE_TOOLS points to the installed firebase-tools package, not credentials.
   Commands: backup-rules DIR; deploy-rules DIR; import DIR; verify DIR.
   Never prints credentials, personal records or archive contents. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const project='simulation-platform-233cf',prefix=`projects/${project}/databases/(default)/documents`;
const packageDir=process.env.FIREBASE_TOOLS||'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/firebase-tools';
const auth=require(path.join(packageDir,'lib/auth')),{requireAuth}=require(path.join(packageDir,'lib/requireAuth')),{Client}=require(path.join(packageDir,'lib/apiv2'));
const [command,directory]=process.argv.slice(2),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 await requireAuth({...auth.getGlobalDefaultAccount(),project});
 const rules=new Client({urlPrefix:'https://firebaserules.googleapis.com',apiVersion:'v1'}),db=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
 const getRelease=async()=>(await rules.get(`/projects/${project}/releases/cloud.firestore`)).body;
 if(command==='backup-rules'||command==='deploy-rules'){
  const release=await getRelease(),old=(await rules.get('/'+release.rulesetName)).body;
  fs.writeFileSync(path.join(directory,'rules-before-independent-game.json'),JSON.stringify({release,ruleset:old},null,2));
  if(command==='backup-rules'){console.log('Active rules backed up.');return;}
  const original=old.source.files.find(f=>f.name==='firestore.rules').content;
  if(original.includes('match /problemSolvingResponses/'))throw Error('Game rules already exist; inspect before changing.');
  const pos=original.lastIndexOf('\n  }'),addition=fs.readFileSync(path.join(__dirname,'problem-solving.rules'),'utf8');
  if(pos<0)throw Error('Unexpected rules structure');
  const content=original.slice(0,pos)+'\n'+addition+'\n'+original.slice(pos);
  if(content.replace('\n'+addition+'\n','')!==original)throw Error('Existing rules changed');
  const source={files:old.source.files.map(f=>({...f,content:f.name==='firestore.rules'?content:f.content}))};
  const created=(await rules.post(`/projects/${project}/rulesets`,{source})).body;
  if((await getRelease()).rulesetName!==release.rulesetName)throw Error('Concurrent deployment; retry after review');
  await rules.patch(`/projects/${project}/releases/cloud.firestore`,{release:{name:release.name,rulesetName:created.name},updateMask:'rulesetName'});
  const verified=await getRelease();if(verified.rulesetName!==created.name)throw Error('Rule deployment did not verify');
  fs.writeFileSync(path.join(directory,'deployed-independent-game.rules'),content);
  console.log(JSON.stringify({ruleset:created.name,preservedExistingRules:true}));return;
 }
 const input=JSON.parse(fs.readFileSync(path.join(directory,'historical-import.json'),'utf8'));
 const fields=object=>Object.fromEntries(Object.entries(object).map(([k,v])=>[k,{stringValue:v}]));
 async function documents(collection){let token='',docs=[];do{const r=(await db.get('/'+prefix+'/'+collection,{queryParams:{pageSize:1000,...(token?{pageToken:token}:{})}})).body;docs.push(...(r.documents||[]));token=r.nextPageToken||'';}while(token);return docs;}
 if(command==='import'){
  const existing=new Map((await documents('problemSolvingLegacy')).map(d=>[d.name.split('/').pop(),d]));
  const writes=[];
  for(const item of input.records){const rowJson=JSON.stringify(item.row);if(existing.has(item.id)){if(existing.get(item.id).fields.rowJson.stringValue!==rowJson)throw Error('Existing import differs');continue;}writes.push({update:{name:prefix+'/problemSolvingLegacy/'+item.id,fields:fields({rowJson,source:item.row[12],sha256:hash(rowJson)})},currentDocument:{exists:false}});}
  for(let i=0;i<writes.length;i+=150)await db.post('/'+prefix+':commit',{writes:writes.slice(i,i+150)});
  const workbook=fs.readFileSync(path.join(directory,'historical-workbook.xlsx')),script=fs.readFileSync(path.join(directory,'apps-script-before-deployment.js'),'utf8');
  await db.patch('/'+prefix+'/problemSolvingPrivateArchive/migration-20261013',{fields:fields({workbookBase64:workbook.toString('base64'),workbookSha256:hash(workbook),appsScript:script,manifest:fs.readFileSync(path.join(directory,'migration-manifest.json'),'utf8')})});
  console.log(JSON.stringify({imported:writes.length,total:input.records.length,privateArchiveSaved:true}));
 }
 if(command==='import'||command==='verify'){
  const docs=await documents('problemSolvingLegacy');if(docs.length!==input.records.length)throw Error('Import count mismatch');
  const actual=new Map(docs.map(d=>[d.name.split('/').pop(),d.fields.rowJson.stringValue]));
  for(const item of input.records)if(actual.get(item.id)!==JSON.stringify(item.row))throw Error('Import readback mismatch');
  const archive=(await db.get('/'+prefix+'/problemSolvingPrivateArchive/migration-20261013')).body.fields;
  if(hash(Buffer.from(archive.workbookBase64.stringValue,'base64'))!==hash(fs.readFileSync(path.join(directory,'historical-workbook.xlsx'))))throw Error('Archive hash mismatch');
  console.log(JSON.stringify({verified:docs.length,archiveHashVerified:true}));return;
 }
 throw Error('Unknown command');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
