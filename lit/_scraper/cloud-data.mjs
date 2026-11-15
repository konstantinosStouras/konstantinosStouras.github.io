import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {datasets}=JSON.parse(fs.readFileSync(path.join(root,'lit/data-storage.json'),'utf8'));
const [command,id]=process.argv.slice(2);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const repoDir=d=>path.join(root,'_lit-data',d.id);
function validateRepo(d){
 const dir=repoDir(d);
 if(path.resolve(git(dir,'rev-parse','--show-toplevel'))!==path.resolve(dir))throw Error('Data repository missing: '+d.id);
 const origin=git(dir,'remote','get-url','origin');
 if(![ `https://github.com/${d.repository}`,`https://github.com/${d.repository}.git`,`git@github.com:${d.repository}.git`].includes(origin))throw Error('Unexpected data remote: '+d.id);
 return dir;
}
function list(dir,prefix=''){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(e.isSymbolicLink())throw Error('Symlink inside published data: '+e.name);
  const p=path.join(dir,e.name),rel=prefix+e.name;
  return e.isDirectory()?list(p,rel+'/'):[{path:rel,size:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))}];
 });
}
function snapshot(d){
 const dir=validateRepo(d), files=list(path.join(dir,'data')).sort((a,b)=>a.path.localeCompare(b.path));
 if(!files.length)throw Error('Refusing empty dataset');
 if(files.some(f=>f.size>99*1024*1024))throw Error('A data file exceeds the GitHub file-size budget');
 if(files.reduce((sum,f)=>sum+f.size,0)>950*1024*1024)throw Error('Dataset is approaching the Pages 1 GB limit; split it before publishing');
 for(const f of files.filter(f=>f.path.endsWith('.json')))JSON.parse(fs.readFileSync(path.join(dir,'data',f.path),'utf8'));
 const value={version:1,dataset:d.id,sourceRepository:'konstantinosStouras/konstantinosStouras.github.io',sourceCommit:process.env.GITHUB_SHA||git(root,'rev-parse','HEAD'),files};
 fs.writeFileSync(path.join(dir,'snapshot.json'),JSON.stringify(value)+'\n');
 return value;
}
async function verify(d){
 const dir=validateRepo(d),expected=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
 const base='https://www.stouras.com'+d.base.replace(/data\/$/,'');
 const important=d.files||['sources.json','meta.json','manifest.json','recent.json'].filter(f=>expected.files.some(e=>e.path===f));
 const sample=expected.files.find(f=>/^papers-|^refs-/.test(f.path));if(sample)important.push(sample.path);
 for(let attempt=1;attempt<=10;attempt++){
  try{
   const r=await fetch(base+'snapshot.json?check='+Date.now(),{signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error('Snapshot HTTP '+r.status);
   const live=await r.json();
   if(JSON.stringify(live.files)!==JSON.stringify(expected.files))throw Error('Published snapshot differs');
   for(const file of important){const res=await fetch(base+'data/'+file+'?check='+Date.now(),{signal:AbortSignal.timeout(45000)});if(!res.ok||sha(Buffer.from(await res.arrayBuffer()))!==expected.files.find(f=>f.path===file)?.sha256)throw Error('Content mismatch: '+file);}
   console.log('Verified live '+d.id+' snapshot and '+important.length+' data files');return;
  }catch(error){console.log('Verification '+attempt+'/10: '+error.message);if(attempt===10)throw error;await new Promise(resolve=>setTimeout(resolve,30000));}
 }
}
if(command==='mount'){
 if(process.env.GITHUB_ACTIONS!=='true')throw Error('Data is materialized only on a temporary GitHub Actions runner.');
 const selected=(process.env.LIT_DATA_IDS||datasets.map(d=>d.id).join(' ')).split(/\s+/).filter(Boolean);
 if(selected.some(id=>!datasets.some(d=>d.id===id)))throw Error('Unknown dataset selection');
 for(const d of datasets.filter(d=>selected.includes(d.id))){
  const dir=validateRepo(d);if(!fs.existsSync(path.join(dir,'snapshot.json')))throw Error('Unseeded data repository '+d.id);
  if(d.files){
   for(const file of d.files){const dest=path.join(root,d.local,file);if(fs.existsSync(dest))throw Error('Refusing to replace existing '+dest);fs.symlinkSync(path.join(dir,'data',file),dest);}
  }else{
   const dest=path.join(root,d.local);if(fs.existsSync(dest))throw Error('Refusing to replace existing '+dest);fs.symlinkSync(path.join(dir,'data'),dest,'dir');
  }
 }
 console.log('Mounted cloud datasets for this runner only.');
}else{
 const d=datasets.find(d=>d.id===id);if(!d)throw Error('Choose a known dataset');
 const dir=validateRepo(d);
 if(command==='publish'){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/master')throw Error('Only the website master workflow may publish');
  // Current analytics writers follow these file links. Also support a writer
  // using atomic replacement, which replaces the link with a regular file.
  if(d.files)for(const file of d.files){const local=path.join(root,d.local,file);if(!fs.lstatSync(local).isSymbolicLink())fs.copyFileSync(local,path.join(dir,'data',file));}
  if(!git(dir,'status','--porcelain','--','data')){console.log('No data changes');process.exit(0);}
  snapshot(d);
  git(dir,'config','user.name','github-actions[bot]');git(dir,'config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  git(dir,'add','--','data','snapshot.json');git(dir,'commit','-m',`Refresh ${id} data from website workflow ${process.env.GITHUB_RUN_ID||''}`);
  // Never replay a stale directory over a newer snapshot. A rejected push
  // fails visibly; the workflow uploads its output as a recovery artifact.
  git(dir,'push','origin','HEAD:main');console.log('Published '+id);
 }else if(command==='verify')await verify(d);
 else if(command==='snapshot')snapshot(d);
 else throw Error('Usage: cloud-data.mjs mount | publish|verify|snapshot <dataset>');
}
