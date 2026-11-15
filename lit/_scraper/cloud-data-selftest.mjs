import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lit-cloud-test-'));
const script=path.join(root,'lit/_scraper/cloud-data.mjs');
fs.mkdirSync(path.dirname(script),{recursive:true});
fs.copyFileSync(fileURLToPath(new URL('./cloud-data.mjs',import.meta.url)),script);
const datasets=[{id:'core',local:'lit/data',repository:'konstantinosStouras/lit-data-core',base:'/lit-data-core/data/',files:null},{id:'analytics',local:'lit/analytics',repository:'konstantinosStouras/lit-data-analytics',base:'/lit-data-analytics/data/',files:['data.json']}];
fs.writeFileSync(path.join(root,'lit/data-storage.json'),JSON.stringify({datasets}));
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function init(dir,bare=false){fs.mkdirSync(dir,{recursive:true});git(dir,'init','-b','main',...(bare?['--bare']:[]));if(!bare){git(dir,'config','user.name','Storage Test');git(dir,'config','user.email','test@example.invalid');}}
init(root);fs.writeFileSync(path.join(root,'README.md'),'fixture');git(root,'add','README.md');git(root,'commit','-m','fixture');
const run=(args,extra={})=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/master',GITHUB_SHA:git(root,'rev-parse','HEAD'),...extra}});
for(const d of datasets){
 const dir=path.join(root,'_lit-data',d.id),bare=path.join(root,'remotes',d.id+'.git');init(bare,true);init(dir);fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data/data.json'),'{"value":1}');
 git(dir,'remote','add','origin','https://github.com/'+d.repository+'.git');git(dir,'config','remote.origin.pushurl',bare.replaceAll('\\','/'));
 const result=run(['snapshot',d.id]);assert.equal(result.status,0,result.stderr);
 git(dir,'add','.');git(dir,'commit','-m','initial');git(dir,'push','origin','HEAD:main');
 const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json')));assert.equal(snapshot.files.length,1);assert.equal(snapshot.files[0].size,11);
}
const core=path.join(root,'_lit-data/core');
fs.writeFileSync(path.join(core,'data/broken.json'),'{');assert.notEqual(run(['snapshot','core']).status,0,'Malformed JSON must fail');fs.unlinkSync(path.join(core,'data/broken.json'));
assert.notEqual(run(['publish','core'],{GITHUB_REF:'refs/heads/feature'}).status,0,'Feature branches must not publish');
assert.notEqual(run(['mount'],{GITHUB_ACTIONS:'false'}).status,0,'Laptop runs must not materialize data');
if(process.platform!=='win32'){
 fs.mkdirSync(path.join(root,'lit/analytics'));fs.writeFileSync(path.join(root,'lit/analytics/index.html'),'code');
 const mounted=run(['mount']);assert.equal(mounted.status,0,mounted.stderr);assert.equal(fs.readFileSync(path.join(root,'lit/analytics/index.html'),'utf8'),'code');
 assert.notEqual(run(['mount']).status,0,'Existing mounts must not be overwritten');
 fs.writeFileSync(path.join(root,'lit/data/new.tmp'),'{"value":2}');fs.renameSync(path.join(root,'lit/data/new.tmp'),path.join(root,'lit/data/data.json'));
 assert.equal(fs.readFileSync(path.join(core,'data/data.json'),'utf8'),'{"value":2}','Atomic writes through a directory mount must reach the data repo');
 fs.writeFileSync(path.join(root,'lit/analytics/new.tmp'),'{"value":3}');fs.renameSync(path.join(root,'lit/analytics/new.tmp'),path.join(root,'lit/analytics/data.json'));
 const result=run(['publish','analytics']);assert.equal(result.status,0,result.stderr);
 assert.equal(git(path.join(root,'remotes/analytics.git'),'show','main:data/data.json'),'{"value":3}','Atomic analytics replacement must be copied into the published repo');
}else console.log('Symlink/atomic-write checks run on the Linux CI runner.');
fs.writeFileSync(path.join(core,'data/data.json'),'{"value":4}');
const published=run(['publish','core']);assert.equal(published.status,0,published.stderr);
assert.equal(git(path.join(root,'remotes/core.git'),'show','main:data/data.json'),'{"value":4}');
const other=path.join(root,'concurrent-writer');git(root,'clone',path.join(root,'remotes/core.git'),other);git(other,'config','user.name','Test');git(other,'config','user.email','test@example.invalid');fs.writeFileSync(path.join(other,'data/data.json'),'{"value":5}');git(other,'add','.');git(other,'commit','-m','newer snapshot');git(other,'push');
fs.writeFileSync(path.join(core,'data/data.json'),'{"value":6}');assert.notEqual(run(['publish','core']).status,0,'Concurrent publication must fail rather than overwrite');
assert.equal(git(path.join(root,'remotes/core.git'),'show','main:data/data.json'),'{"value":5}');
console.log('Cloud storage checks passed: snapshots, invalid data, branch guards, publication, and concurrent-write protection.');
