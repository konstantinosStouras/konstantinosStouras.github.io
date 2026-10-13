/* Scoped deployment from an isolated Git index; never touches the user's index. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),artifacts=process.argv[2],repo=path.join(artifacts,'git-publication');
const git='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
function run(args,input){return cp.execFileSync(git,args,{cwd:repo,env,input,encoding:'utf8',maxBuffer:20000000}).trim();}
fs.mkdirSync(repo,{recursive:true});if(!fs.existsSync(path.join(repo,'.git')))run(['init']);
const remote='https://github.com/konstantinosStouras/konstantinosStouras.github.io.git';
let existing='';try{existing=run(['remote','get-url','origin']);}catch{}
if(existing&&existing!==remote)throw Error('Unexpected isolated repository');if(!existing)run(['remote','add','origin',remote]);
console.log('Fetching current website state into an isolated object store.');
run(['-c','credential.helper=!"C:/Program Files/GitHub CLI/gh.exe" auth git-credential','fetch','--depth=1','--filter=blob:none','origin','master']);
const head=run(['rev-parse','FETCH_HEAD']),html=run(['show',head+':lab/problem-solving/index.html']);
if(html.replace(/\r\n/g,'\n').trimEnd()!==fs.readFileSync(path.join(artifacts,'remote-current-index.html'),'utf8').replace(/\r\n/g,'\n').trimEnd())throw Error('Concurrent game edits; review before publishing');
run(['read-tree',head]);
const files=['analysis.js','analysis-ui.js','analysis.css','data-store.js','answer-grader.js','answer-model.js','answer-review.json','answer-review.html','ANALYSIS.md','assets/analysis-font-LICENSE.txt','assets/analysis-font.ttf','assets/guide-evidence.png','assets/guide-benchmarks.png','data/history.json','tools/analysis.test.cjs','tools/answer-grader.test.cjs','tools/storage.test.cjs','tools/analysis-browser.cjs','tools/build-answer-model.cjs','tools/import-history.py','tools/live-storage-smoke.cjs','tools/local-preview.cjs','_backend/admin.cjs','_backend/problem-solving.rules','_backend/publish.cjs'];
function stage(name,bytes){const sha=run(['hash-object','-w','--stdin'],bytes);run(['update-index','--add','--cacheinfo','100644,'+sha+',lab/problem-solving/'+name]);}
for(const file of files)stage(file,fs.readFileSync(path.join(root,file)));
stage('index.html',fs.readFileSync(path.join(artifacts,'publish-index.html')));
const oldDocs=run(['show',head+':lab/problem-solving/CLAUDE.md']);stage('CLAUDE.md',Buffer.from('# Current implementation\n\nSee [ANALYSIS.md](ANALYSIS.md) for the independent storage, reviewed answer grader, evidence benchmarks and shared screen/PDF model. The documentation below describes the retired Sheets implementation.\n\n'+oldDocs+'\n'));
run(['update-index','--force-remove','lab/problem-solving/apps-script.js']);
const tree=run(['write-tree']),commit=run(['-c','user.name=Konstantinos Stouras','-c','user.email=kstouras@gmail.com','commit-tree',tree,'-p',head,'-m','Make problem-solving game independent with audited grading and personalized reports']);
const changed=run(['diff','--name-only',head,commit]).split('\n');if(changed.some(x=>!x.startsWith('lab/problem-solving/')))throw Error('Unexpected files in deployment');
console.log('Publishing '+changed.length+' game files, retaining other website changes.');
run(['-c','credential.helper=!"C:/Program Files/GitHub CLI/gh.exe" auth git-credential','push','origin',commit+':refs/heads/master']);
fs.writeFileSync(path.join(artifacts,'deployment.json'),JSON.stringify({base:head,commit,files:changed,url:'https://github.com/konstantinosStouras/konstantinosStouras.github.io/commit/'+commit},null,2));
console.log(JSON.stringify({commit,files:changed.length,stagingAreaUnchanged:true}));
