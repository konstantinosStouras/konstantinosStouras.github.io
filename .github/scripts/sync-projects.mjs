import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:10_000_000}).trim();
const projects=JSON.parse(readFileSync('.github/projects.json','utf8')).projects.filter(project=>project.publishes!==false);
let changed=0;
for(const project of projects){
  if(!/^[a-zA-Z0-9_/-]+$/.test(project.path)||project.path.split('/').includes('..'))throw Error('Invalid project path');
  if(!/^https:\/\/github\.com\/konstantinosStouras\/[a-zA-Z0-9_-]+\.git$/.test(project.url))throw Error('Unexpected source repository');
  const result=git('ls-remote','--exit-code',project.url,`refs/heads/${project.branch}`);
  const revision=result.split(/\s/)[0];
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error(`Invalid source revision for ${project.path}`);
  const current=git('rev-parse',`HEAD:${project.path}`);
  if(current!==revision){git('update-index','--add','--cacheinfo',`160000,${revision},${project.path}`);changed++;console.log(`Updated publishing reference: ${project.path}`)}
}
if(changed){
  git('config','user.name','github-actions[bot]');git('config','user.email','41898231+github-actions[bot]@users.noreply.github.com');
  git('commit','-m',`Publish updates from ${changed} independent project repositories`);
  let pushed=false;for(let attempt=0;attempt<5;attempt++){try{git('push','origin','HEAD:master');pushed=true;break}catch{git('pull','--rebase','origin','master')}}
  if(!pushed)throw Error('Could not publish updated references; the existing website remains deployed.');
}
const output=`changed=${changed>0}\nrevision=${git('rev-parse','HEAD')}\n`;
if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);else console.log(output);
