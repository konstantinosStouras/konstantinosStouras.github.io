#!/usr/bin/env node
// Private desktop workflow. No account token or reference pixels are printed.
const fs=require('node:fs'),path=require('node:path');
const policy=require('./functions/model-policy.cjs');
const root=process.env.FIREBASE_TOOLS_LIB||path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const auth=require(path.join(root,'auth.js')),{requireAuth}=require(path.join(root,'requireAuth.js')),{Client}=require(path.join(root,'apiv2.js'));
const project=JSON.parse(fs.readFileSync(path.join(__dirname,'.firebaserc'))).projects.default;
if(project!=='stouras-personal-wardrobe')throw Error('Wrong project');
const decode=v=>v.stringValue!==undefined?v.stringValue:v.booleanValue!==undefined?v.booleanValue:v.integerValue!==undefined?Number(v.integerValue):v.doubleValue!==undefined?v.doubleValue:v.timestampValue!==undefined?v.timestampValue:v.arrayValue?(v.arrayValue.values||[]).map(decode):v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,v])=>[k,decode(v)])):null;
const doc=d=>({id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))});
const fields=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{stringValue:v}]));
const privatePath=target=>{const resolved=path.resolve(target);let p=resolved;for(;;){if(fs.existsSync(path.join(p,'.git')))throw Error('Private files must stay outside Git checkouts.');const next=path.dirname(p);if(next===p)break;p=next;}return resolved;};
(async()=>{
 await requireAuth({project,...auth.getGlobalDefaultAccount()});const c=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'}),base=`projects/${project}/databases/(default)/documents`,route='/'+base;
 const get=async p=>{const response=(await c.get(route+'/'+p)).body;return {raw:response,data:doc(response)};};
 const list=async p=>{const result=[];let token;do{const {body}=await c.get(route+'/'+p,{queryParams:{pageSize:100,...(token?{pageToken:token}:{})}});result.push(...(body.documents||[]).map(doc));token=body.nextPageToken;}while(token);return result;};
 const [action,uid,slot,target]=process.argv.slice(2);
 if(action==='list'){console.log(JSON.stringify((await list('daywearModelRequests')).map(({id,uid,lookId,status,requestId,name})=>({id,uid,lookId,status,requestId,name})),null,2));return;}
 if(!policy.validUid(uid)||!(policy.validLook(slot)||/^pose-(front|turn|step)$/.test(slot||''))||!target)throw Error('Use list, export <uid> <look-or-pose-slot> <private-dir>, or import <uid> <look-or-pose-slot> <manifest.json>.');
 const requestPath=`daywearModelRequests/${uid}_${slot}`,{raw,data:r}=await get(requestPath);
 if(!['requested','failed'].includes(r.status)||r.consentVersion!=='natural-likeness-1')throw Error('This request is not awaiting a private preview.');
 let refs=policy.references(await list(`daywearProfiles/${uid}/photos`));if(policy.fingerprint(refs)!==r.referenceHash)throw Error('References changed. The user must submit a new request.');
 const preferenceRecord=await get(`daywearProfiles/${uid}/modelPreferences/current`),prefs=preferenceRecord.data;if(prefs.headshotId!==r.headshotId||(r.purpose!=='posture'&&prefs.revision!==r.revision))throw Error('Preferred headshot or posture changed. Request a new preview.');refs.sort((a,b)=>(a.id===r.headshotId?-1:b.id===r.headshotId?1:0));const lookId=r.lookId;
 if(action==='export'){
  const output=privatePath(target);fs.mkdirSync(output,{recursive:true});
  const files=refs.map((p,i)=>{const file=path.join(output,`${p.kind}-${i+1}.jpg`);fs.writeFileSync(file,Buffer.from(p.data.split(',')[1],'base64'));return file;});
  if(r.purpose!=='posture'){const pose=(await get(`daywearProfiles/${uid}/selectedPosture/current`)).data;const file=path.join(output,'selected-posture.jpg');fs.writeFileSync(file,Buffer.from(pose.data.split(',')[1],'base64'));files.push(file);}
  const outfit=await fetch(`https://www.stouras.com/wearwell/assets/${lookId}.webp`);if(!outfit.ok)throw Error('Could not download catalog reference');const outfitPath=path.join(output,'outfit-only.webp');fs.writeFileSync(outfitPath,Buffer.from(await outfit.arrayBuffer()));files.push(outfitPath);
  const manifest=path.join(output,'request.json');fs.writeFileSync(manifest,JSON.stringify({uid,lookId,slot,requestId:r.requestId,referenceHash:r.referenceHash,files,prompt:policy.promptFor(r),previewPath:''},null,2));console.log(JSON.stringify({manifest,files,note:'Use the image-generation tool with these references. Set previewPath in the private manifest, then import. Import never approves an image.'},null,2));return;
 }
 if(action==='import'){
  const manifest=JSON.parse(fs.readFileSync(privatePath(target),'utf8'));if(manifest.uid!==uid||manifest.slot!==slot||manifest.requestId!==r.requestId||manifest.referenceHash!==r.referenceHash)throw Error('Manifest does not match the current request.');
  const imagePath=privatePath(manifest.previewPath||'');if(!manifest.previewPath)throw Error('Set previewPath in the private manifest first.');const bytes=fs.readFileSync(imagePath);if(bytes.length>10*1024*1024)throw Error('Preview must be at most 10 MB.');const sharp=require('./functions/node_modules/sharp');let width=1200,image;
  for(let i=0;i<6;i++){image=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width,height:1800,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();if(image.length<=480000)break;width=Math.round(width*.8);}if(image.length>480000)throw Error('Image is too large.');
  const fresh=policy.references(await list(`daywearProfiles/${uid}/photos`));if(policy.fingerprint(fresh)!==r.referenceHash)throw Error('References changed.');
  await c.post(route+':commit',{writes:[{verify:base+`/daywearProfiles/${uid}/modelPreferences/current`,currentDocument:{updateTime:preferenceRecord.raw.updateTime}},{update:{name:base+`/daywearProfiles/${uid}/modelPreviews/${slot}`,fields:fields({data:'data:image/jpeg;base64,'+image.toString('base64'),source:'desktop',requestId:r.requestId,headshotId:r.headshotId,referenceHash:r.referenceHash,revision:r.revision,purpose:r.purpose,postureId:r.postureId,lookId:r.lookId})},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},{update:{name:base+'/'+requestPath,fields:fields({status:'preview',error:''})},updateMask:{fieldPaths:['status','error']},currentDocument:{updateTime:raw.updateTime},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]});console.log('Private preview imported. The account owner must approve it in My Profile.');return;
 }
 throw Error('Unknown command.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
