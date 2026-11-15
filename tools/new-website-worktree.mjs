#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [destination,branch,...directories]=process.argv.slice(2);
if(!destination || !branch || !branch.startsWith('codex/') || directories.length===0){
 console.error('Usage: node tools/new-website-worktree.mjs <destination> codex/<task> <directory> [...directories]\nUse @root for root files only. Example directories: images css js tools.');process.exit(1);
}
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(destination);
if(fs.existsSync(target))throw Error('Destination already exists; refusing to change an existing checkout.');
for(const dir of directories)if(dir!=='@root'&&(!/^[a-zA-Z0-9_.\/-]+$/.test(dir)||dir.startsWith('/')||dir.split('/').some(p=>p==='..'||p==='.git')))throw Error('Use repository-relative directory names.');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{stdio:'inherit'});
git(repo,'check-ref-format','--branch',branch);
// No initial checkout: select paths before Git materializes any files.
git(repo,'worktree','add','--no-checkout','-b',branch,target,'HEAD');
const patterns=['/*','!/*/',...directories.filter(x=>x!=='@root').map(x=>'/'+x.replace(/\/$/,'')+'/'),'!/lit/data/','!/lit/data-ft50/','!/lit/data-refs/','!/lit/data-workingpapers/','!/lit/analytics/*.json'];
execFileSync('git',['-C',target,'sparse-checkout','set','--no-cone','--stdin'],{input:patterns.join('\n')+'\n',stdio:['pipe','inherit','inherit']});
git(target,'read-tree','-mu','HEAD');
console.log('Created sparse working copy: '+target);
console.log('Add paths later with: git sparse-checkout add /<directory>/');
