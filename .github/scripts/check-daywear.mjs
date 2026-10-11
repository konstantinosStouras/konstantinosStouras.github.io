// This check reads only DayWear. No other site's code, data or checks are loaded.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve('daywear');
for(const name of readdirSync(root).filter(name=>name.endsWith('.js'))) {
  const file=resolve(root,name),text=readFileSync(file,'utf8');
  execFileSync(process.execPath,['--check',file]);
  for(const [,relative] of text.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g)) {
    assert.ok(existsSync(resolve(dirname(file),relative.split('?')[0])),`${name}: missing ${relative}`);
  }
}
const {looks,pieces,seasons}=await import(pathToFileURL(resolve(root,'data.js')));
const {recommend}=await import(pathToFileURL(resolve(root,'weather.js')));
const {firebaseConfig}=await import(pathToFileURL(resolve(root,'firebase-config.js')));
assert.equal(firebaseConfig.projectId,'stouras-personal-wardrobe');
assert.equal(looks.length,30);assert.equal(pieces.length,40);
for(const season of seasons)assert.equal(looks.filter(l=>l.season===season).length,7);
for(const look of looks) {
  assert.ok(existsSync(resolve(root,look.image.split('?')[0])),`Missing image: ${look.id}`);
  assert.ok(look.pieces.every(id=>pieces.some(p=>p.id===id)));
}
for(const temp of [-5,12,18,25]) {
  const recommendation=recommend({temp,precip:2,dailyPrecip:2,wind:30});
  assert.ok(recommendation.look.rain);assert.ok(recommendation.look.layer);
}
const html=readFileSync(resolve(root,'index.html'),'utf8');
for(const [,relative] of html.matchAll(/(?:src|href)="([^"#][^"]*\.(?:js|css|ico|png|svg)(?:\?[^" ]*)?)"/g)) {
  if(!/^https?:/.test(relative))assert.ok(existsSync(resolve(root,relative.split('?')[0])),`Missing page asset: ${relative}`);
}
console.log('DayWear modules, page assets, 30 looks / 40 pieces, weather rules and Firebase project passed.');
