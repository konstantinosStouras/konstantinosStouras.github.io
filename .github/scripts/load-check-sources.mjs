import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
const root=process.cwd();
for(const project of JSON.parse(readFileSync('.github/projects.json','utf8')).projects.filter(p=>p.checkDeployment)){
  const folder=resolve(project.path);
  if(!folder.startsWith(root+sep)||!/^https:\/\/github\.com\/konstantinosStouras\/[a-zA-Z0-9_-]+\.git$/.test(project.url))throw Error('Unexpected deployment-check source');
  if(!existsSync(folder))execFileSync('git',['clone','--depth','1','--single-branch',project.url,folder],{stdio:'inherit'});
}
