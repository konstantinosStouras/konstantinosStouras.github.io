// Run locally with the Firebase CLI account. Credentials stay in process memory.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseCatalog} from '../catalog.mjs';
import {mergeResearch} from '../research.mjs';
const require=createRequire(import.meta.url);
let credentials;
if(process.env.GOOGLE_APPLICATION_CREDENTIALS){
  const {GoogleAuth}=require('google-auth-library');
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}).getClient();
  credentials={access_token:(await client.getAccessToken()).token};
}else{
  const root=process.env.APPDATA+'/npm/node_modules/firebase-tools/lib/',auth=require(root+'auth.js'),account=auth.getGlobalDefaultAccount();
  if(!account)throw new Error('Sign into the Firebase CLI first.');
  credentials=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase']);
}
const project='stouras-dataset-library';
async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+credentials.access_token,'Content-Type':'application/json',...(!process.env.GOOGLE_APPLICATION_CREDENTIALS?{'x-goog-user-project':project}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result.error||result));return result;
}
if(process.argv.includes('enable')){
  await api(`https://serviceusage.googleapis.com/v1/projects/${project}/services/firestore.googleapis.com:enable`,'POST',{});
  console.log('Firestore API enable requested.');
}
if(process.argv.includes('github')){
  const number='430353187364',sa=`dataset-publisher@${project}.iam.gserviceaccount.com`;
  const pool=`projects/${number}/locations/global/workloadIdentityPools/github-datasets`;
  await api(`https://serviceusage.googleapis.com/v1/projects/${project}/services:batchEnable`,'POST',{serviceIds:['iam.googleapis.com','iamcredentials.googleapis.com','sts.googleapis.com']});
  async function create(url,body){try{return await api(url,'POST',body);}catch(e){if(!/ALREADY_EXISTS/.test(e.message))throw e;}}
  await create(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`,{accountId:'dataset-publisher',serviceAccount:{displayName:'Dataset catalog publisher'}});
  await create(`https://iam.googleapis.com/v1/projects/${number}/locations/global/workloadIdentityPools?workloadIdentityPoolId=github-datasets`,{displayName:'Dataset repository workflows'});
  await create(`https://iam.googleapis.com/v1/${pool}/providers?workloadIdentityPoolProviderId=github`,{displayName:'Dataset catalog workflow',oidc:{issuerUri:'https://token.actions.githubusercontent.com'},attributeMapping:{'google.subject':'assertion.sub','attribute.repository':'assertion.repository'},attributeCondition:"assertion.repository == 'konstantinosStouras/datasets' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'konstantinosStouras/datasets/.github/workflows/publish-catalog.yml@refs/heads/main'"});
  await api(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${sa}:setIamPolicy`,'POST',{policy:{bindings:[{role:'roles/iam.workloadIdentityUser',members:[`principalSet://iam.googleapis.com/${pool}/attribute.repository/konstantinosStouras/datasets`]}]}});
  const policy=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,'POST',{});
  const member='serviceAccount:'+sa;let binding=policy.bindings.find(b=>b.role==='roles/datastore.user');if(!binding){binding={role:'roles/datastore.user',members:[]};policy.bindings.push(binding);}if(!binding.members.includes(member))binding.members.push(member);
  await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:setIamPolicy`,'POST',{policy});
  console.log('Keyless GitHub publisher configured for the main-branch catalog workflow only.');
}
if(process.argv.includes('configure')){
  const config=await api(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps/1:430353187364:web:87ae550fec264189ca8eb1/config`);
  writeFileSync(new URL('../firebase-config.mjs',import.meta.url),'export const firebaseConfig = '+JSON.stringify(config,null,2)+';\n');
  const url=`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  const current=await api(url);
  await api(url+'?updateMask=authorizedDomains','PATCH',{authorizedDomains:[...new Set([...(current.authorizedDomains||[]),'www.stouras.com','stouras.com'])]});
  console.log('Web configuration saved; production authentication domains authorized.');
}
export function publicEntry(entry){
  const clean=s=>String(s||'').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'[member link]');
  const allowed=['id','title','topic','description','years','access','geography','types','units','tools','designs','features','period','ranges','paper','research','tags','dateAdded','verifiedAt'];
  const out=Object.fromEntries(allowed.filter(k=>entry[k]!==undefined).map(k=>[k,entry[k]]));
  out.description=clean(out.description);out.details=entry.details.map(clean);
  out.papers=(entry.papers||[]).map(p=>({title:p.title,authors:p.authors,journal:p.journal,year:p.year,volume:p.volume,issue:p.issue,evidenceSection:p.evidenceSection}));
  out.search=clean([out.title,out.topic,out.description,...out.details,...(out.tags||[]),...out.papers.map(p=>`${p.title} ${p.authors} ${p.journal} ${p.year}`)].join(' ')).toLowerCase();return out;
}
if(process.argv.includes('import')){
  const source=readFileSync(process.env.DATASET_SOURCE_PATH||new URL('../_tools/source.md',import.meta.url),'utf8');
  const research=JSON.parse(readFileSync(process.env.DATASET_RESEARCH_PATH||new URL('../_tools/research-additions.json',import.meta.url)));
  const entries=mergeResearch(parseCatalog(source),research);
  const field=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(field)}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,field(x)]))}};
  const base=`projects/${project}/databases/(default)/documents`;
  const writes=entries.map(e=>({update:{name:base+'/datasetLinks/'+e.id,fields:{payload:field(JSON.stringify({url:e.url,details:e.details,descriptionMarkdown:e.descriptionMarkdown||e.description,papers:e.papers||[]}))}}}));
  await api(`https://firestore.googleapis.com/v1/${base}:commit`,'POST',{writes});
  writeFileSync(process.env.CATALOG_OUTPUT||new URL('../catalog-public.json',import.meta.url),JSON.stringify({updated:new Date().toISOString().slice(0,10),entries:entries.map(publicEntry)},null,2)+'\n');
  console.log(`Imported ${entries.length} protected dataset link records and generated public metadata.`);
}
