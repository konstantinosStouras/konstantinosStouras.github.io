'use strict';
const crypto=require('node:crypto'),policy=require('./tryon-policy.cjs'),providers=require('./image-providers.cjs');
// All data access is through this callable, scoped to the authenticated account.
module.exports=async function tryOn(data,env){
 const {db,actor,isAdmin,error,stamp,settings,readKey,compress,adapters,sharp}=env;
 const member=data.member||'self';if(member!=='self'&&!/^[a-f0-9-]{36}$/.test(member))throw error('invalid-argument','Choose a valid family profile.');
 const root=db.doc(`daywearProfiles/${actor.uid}${member==='self'?'':'/members/'+member}`);
 const memberDoc=(await root.get()).data();if(member!=='self'&&!memberDoc)throw error('not-found','This family profile is no longer available.');
 if((await db.doc(`daywearRemovedUsers/${actor.uid}`).get()).exists)throw error('permission-denied','This account is unavailable.');
 const ref=name=>root.collection('tryOn').doc(name),profileRef=ref('profile'),modelRef=ref('model'),candidateRef=ref('candidate'),trialRef=ref('trial'),jobRef=ref('job');
 const c=await settings(),provider=c.provider,pc=c.providers[provider],definition=providers.definition(provider);
 const enabled=c.mode==='api'&&pc?.keyConfigured&&definition?.role==='renderer'&&(isAdmin||c.tryOnEnabled===true);
 const actions=['tryOnState','tryOnSave','tryOnGenerate','tryOnDecision','tryOnView','tryOnRemove','tryOnClear'];if(!actions.includes(data.action))throw error('invalid-argument','Unknown try-on action.');
 if(data.action==='tryOnState'){
  const values=await Promise.all([profileRef.get(),modelRef.get(),candidateRef.get(),trialRef.get(),jobRef.get(),root.collection('tryOnLooks').select('lookId','thumb','profileRevision','modelId').limit(30).get()]);
  const [profile,model,candidate,trial,job]=values.slice(0,5).map(s=>s.data()||null);
  const currentModel=model?.profileRevision===profile?.revision?model:null;
  return {profile,model:currentModel,candidate:candidate?.profileRevision===profile?.revision?candidate:null,trial:trial?.profileRevision===profile?.revision&&trial?.modelId===currentModel?.id?trial:null,job,looks:values[5].docs.map(d=>d.data()).filter(d=>d.profileRevision===profile?.revision&&d.modelId===currentModel?.id),provider:{id:provider,name:definition?.name||'',model:pc?.model||'',single:['adobe','stability'].includes(provider)},enabled,isAdmin,reason:enabled?'':!isAdmin&&c.tryOnEnabled!==true?'The administrator has not enabled personal image generation yet.':'An administrator needs to save image-provider credentials and enable API generation in Image studio.'};
 }
 const lock=db.doc(`daywearModelLimits/${actor.uid}`);
 if(data.action==='tryOnClear'){
  if(data.confirm!==true)throw error('failed-precondition','Confirm removal of this fitting room’s photos and previews.');
  if((await lock.get()).data()?.until>Date.now())throw error('failed-precondition','Wait for generation to finish before removing this fitting room.');
  await db.recursiveDelete(root.collection('tryOn'));await db.recursiveDelete(root.collection('tryOnLooks'));return {saved:true};
 }
 if(data.action==='tryOnSave'){
  let profile;try{profile=policy.validate(data);}catch(e){throw error('invalid-argument',e.message);}
  if(memberDoc?.relationship==='child'&&profile.kind!=='child')throw error('invalid-argument','This family profile belongs to a child. Choose the child model.');
  const old=(await profileRef.get()).data();const headshot=data.headshot?await compress(data.headshot):old?.headshot;if(!headshot)throw error('invalid-argument','Upload a clear headshot first.');
  await db.runTransaction(async tx=>{const [l,p]=await Promise.all([tx.get(lock),tx.get(profileRef)]);if(l.data()?.until>Date.now())throw error('failed-precondition','Wait for the current image to finish before changing the headshot or measurements.');if((p.data()?.revision||null)!==(data.revision||null))throw error('failed-precondition','This profile changed in another tab. Refresh before saving.');tx.set(profileRef,{...profile,headshot,revision:crypto.randomUUID(),updatedAt:stamp()});for(const r of [modelRef,candidateRef,trialRef,jobRef])tx.delete(r);});return {saved:true};
 }
 if(data.action==='tryOnView'){
  if(!require('./model-policy.cjs').validLook(data.lookId))throw error('invalid-argument','Choose a site outfit.');
  const [p,m,l]=await Promise.all([profileRef.get(),modelRef.get(),root.collection('tryOnLooks').doc(data.lookId).get()]);if(!l.exists||l.data().profileRevision!==p.data()?.revision||l.data().modelId!==m.data()?.id)throw error('failed-precondition','This outfit belongs to an older model. Generate a new preview.');return {image:l.data().image};
 }
 if(data.action==='tryOnRemove'){
  if(!require('./model-policy.cjs').validLook(data.lookId))throw error('invalid-argument','Choose a site outfit.');await root.collection('tryOnLooks').doc(data.lookId).delete();return {saved:true};
 }
 if(data.action==='tryOnDecision'){
  if(!['model','outfit'].includes(data.target)||!['approve','reject'].includes(data.decision))throw error('invalid-argument','Choose approve or reject.');
  const target=data.target==='model'?candidateRef:trialRef;
  await db.runTransaction(async tx=>{const [p,m,t,l]=await Promise.all([tx.get(profileRef),tx.get(modelRef),tx.get(target),tx.get(lock)]);const v=t.data();if(l.data()?.until>Date.now())throw error('failed-precondition','Wait for the current generation to finish.');if(!v||v.id!==data.id||v.profileRevision!==p.data()?.revision||(data.target==='outfit'&&v.modelId!==m.data()?.id))throw error('failed-precondition','This preview has changed. Refresh before approving.');if(data.decision==='approve'){if(data.target==='model'){tx.set(modelRef,{...v,approvedAt:stamp()});tx.delete(trialRef);}else tx.set(root.collection('tryOnLooks').doc(v.lookId),{...v,approvedAt:stamp()});}tx.delete(target);});return {saved:true};
 }
 if(!enabled)throw error('failed-precondition','Enable an image provider in Image studio before generating.');
 if(data.consent!==true||data.provider!==provider)throw error('failed-precondition','Confirm processing by the currently selected image provider before generating.');
 const outfit=data.target==='outfit';if(!outfit&&data.target!=='model')throw error('invalid-argument','Choose a model or outfit preview.');
 if(outfit&&!require('./model-policy.cjs').validLook(data.lookId))throw error('invalid-argument','Choose an outfit from the site.');
 const [p,m]=await Promise.all([profileRef.get(),modelRef.get()]);const profile=p.data(),model=m.data();if(!profile?.headshot)throw error('failed-precondition','Save a headshot and measurements first.');
 if(profile.revision!==data.revision)throw error('failed-precondition','Your measurements changed. Refresh first.');
 if(outfit&&(!model||model.profileRevision!==profile.revision||model.id!==data.modelId))throw error('failed-precondition','Create and approve your personal model first.');
 const single=['adobe','stability'].includes(provider),prompt=policy.prompt(profile,outfit?data.lookId:null,single);
 if(provider==='adobe'&&prompt.length>1500)throw error('failed-precondition','This brief is too long for Adobe. Select another provider.');
 const jobId=crypto.randomUUID(),day=new Date().toISOString().slice(0,10),budget=db.doc(`daywearGenerationUsage/${day}`),personal=db.doc(`daywearTryOnUsage/${actor.uid}_${day}`);
 await db.runTransaction(async tx=>{const [l,b,u,now,base]=await Promise.all([tx.get(lock),tx.get(budget),tx.get(personal),tx.get(profileRef),tx.get(modelRef)]);if(now.data()?.revision!==profile.revision||(outfit&&base.data()?.id!==model.id))throw error('failed-precondition','The model changed. Refresh first.');if(l.data()?.until>Date.now())throw error('resource-exhausted','An image is already being generated. Wait up to 10 minutes, then refresh.');if((b.data()?.count||0)>=c.dailyLimit||(b.data()?.[provider]||0)>=pc.dailyLimit||(!isAdmin&&(u.data()?.count||0)>=3))throw error('resource-exhausted','The daily generation limit has been reached. Try again after midnight UTC.');tx.set(lock,{until:Date.now()+600000,requestId:jobId});tx.set(budget,{...b.data(),count:(b.data()?.count||0)+1,[provider]:(b.data()?.[provider]||0)+1});tx.set(personal,{count:(u.data()?.count||0)+1});tx.set(jobRef,{id:jobId,status:'generating',target:data.target,until:Date.now()+600000,updatedAt:stamp()});});
 try{
  const images=[outfit?model.image:profile.headshot];
  if(outfit&&!single){images.push(profile.headshot);const response=await fetch(`https://www.stouras.com/wearwell/assets/${data.lookId}.webp`,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Catalog image unavailable');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>10000000)throw Error('Catalog image too large');images.push('data:image/webp;base64,'+bytes.toString('base64'));}
  const image=await compress(await adapters.render(provider,pc,await readKey(provider),prompt,images));
  const thumb='data:image/jpeg;base64,'+(await sharp(Buffer.from(image.split(',')[1],'base64')).resize({width:180,height:270,fit:'inside'}).jpeg({quality:65}).toBuffer()).toString('base64');
  await db.runTransaction(async tx=>{const [now,base,j,parent,removed]=await Promise.all([tx.get(profileRef),tx.get(modelRef),tx.get(jobRef),tx.get(root),tx.get(db.doc(`daywearRemovedUsers/${actor.uid}`))]);if(removed.exists||(member!=='self'&&!parent.exists)||j.data()?.id!==jobId||now.data()?.revision!==profile.revision||(outfit&&base.data()?.id!==model.id))throw error('failed-precondition','The profile changed while generating. This result was discarded.');tx.set(outfit?trialRef:candidateRef,{id:jobId,profileRevision:profile.revision,modelId:outfit?model.id:null,lookId:outfit?data.lookId:null,image,thumb,provider,model:pc.model,createdAt:stamp()});tx.set(jobRef,{id:jobId,status:'ready',updatedAt:stamp()});});return {saved:true};
 }catch(e){const message=e.publicMessage||'Generation did not finish. Check provider access, credits and the reference photo. The attempt may have been billed; refresh before retrying.';await db.runTransaction(async tx=>{const j=await tx.get(jobRef);if(j.data()?.id===jobId)tx.set(jobRef,{id:jobId,status:'failed',message,updatedAt:stamp()});});throw error('unavailable',message);}
 finally{await db.runTransaction(async tx=>{const l=await tx.get(lock);if(l.data()?.requestId===jobId)tx.delete(lock);});}
};
