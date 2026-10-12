// This check reads only WearWell and its legacy redirect. No other site's code, data or checks are loaded.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve('wearwell');
const {languages}=await import(pathToFileURL(resolve(root,'language-policy.js')));
const {default:photoGuidance}=await import(pathToFileURL(resolve(root,'photo-guidance-languages.js')));
const {checkPhotoGuidance}=await import(pathToFileURL(resolve(root,'photo-guidance-coverage.js')));
checkPhotoGuidance(languages,photoGuidance,readFileSync(resolve(root,'profile-photos.js'),'utf8'));
console.log(`Photo guidance covers every registered language (${Object.keys(languages).length}).`);
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

assert.ok(html.includes('href="https://www.stouras.com/wearwell/"'));
assert.ok(!html.includes('https://www.stouras.com/daywear/'));
const redirect=readFileSync(resolve('daywear/index.html'),'utf8');
assert.ok(redirect.includes("location.replace('/wearwell/' + location.search + location.hash)"));
assert.ok(redirect.includes('noindex,follow'));
assert.ok(!redirect.includes('src="app.js'));
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.webmanifest'),'utf8'));
assert.equal(new URL(manifest.start_url,'https://www.stouras.com/wearwell/manifest.webmanifest').pathname,'/wearwell/');
assert.equal(new URL(manifest.scope,'https://www.stouras.com/wearwell/manifest.webmanifest').pathname,'/wearwell/');
console.log('WearWell URL, legacy query/hash redirect, and installed-app paths passed.');
