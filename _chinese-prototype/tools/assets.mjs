import {mkdir,writeFile} from 'node:fs/promises';import {makeLesson,modules} from '../src/curriculum.mjs';
await mkdir('site/chinese/characters',{recursive:true});
const chars=[...new Set(modules.flatMap(m=>makeLesson(m.id).vocabulary.flatMap(w=>[...w.hanzi])))];
for(const c of chars){const r=await fetch('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/'+encodeURIComponent(c)+'.json');if(!r.ok)throw Error('Missing stroke data: '+c);await writeFile('site/chinese/characters/'+c+'.json',await r.text());}
const r=await fetch('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/ARPHICPL.TXT');if(!r.ok)throw Error('Missing data license');await writeFile('site/chinese/characters/LICENSE.txt',await r.text());
console.log(`Saved stroke data for ${chars.length} characters and its licence.`);
