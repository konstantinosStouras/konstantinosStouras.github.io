'use strict';
const functions=require('firebase-functions/v1');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
exports.publishUpdate=functions.region('europe-west1').runWith({maxInstances:1,timeoutSeconds:120}).https.onCall(async(data,context)=>{
 if(context.auth?.token.daywearAdmin!==true)throw new functions.https.HttpsError('permission-denied','Administrator approval required.');
 const account=await getAuth().getUser(context.auth.uid).catch(()=>null);if(!account||account.disabled||account.customClaims?.daywearAdmin!==true)throw new functions.https.HttpsError('permission-denied','Administrator approval required.');
 const id=data?.id;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new functions.https.HttpsError('invalid-argument','Invalid update.');
 const db=getFirestore(),draft=db.collection('daywearUpdateDrafts').doc(id),published=db.collection('daywearUpdates').doc(id);
 await db.runTransaction(async tx=>{
  const [existing,source]=await Promise.all([tx.get(published),tx.get(draft)]);
  if(existing.exists)return;
  if(!source.exists)throw new functions.https.HttpsError('not-found','Draft not found.');
  const copy=source.data();for(const [key,max] of [['titleEn',120],['titleEl',120],['bodyEn',4000],['bodyEl',4000]])if(typeof copy[key]!=='string'||!copy[key].trim()||copy[key].length>max)throw new functions.https.HttpsError('invalid-argument','Complete both languages.');
  // Freeze the exact approved copy and subscriber eligibility in one transaction.
  const subscribers=await tx.get(db.collection('daywearUpdateSubscriptions').where('enabled','==',true));
  tx.create(published,{titleEn:copy.titleEn,titleEl:copy.titleEl,bodyEn:copy.bodyEn,bodyEl:copy.bodyEl,publishedAt:FieldValue.serverTimestamp()});
  for(const sub of subscribers.docs)tx.create(db.collection('daywearUpdateMail').doc(id+'_'+sub.id),{updateId:id,uid:sub.id,language:sub.data().language,status:'awaiting-approval',createdAt:FieldValue.serverTimestamp()});
  tx.delete(draft);
  tx.create(db.collection('daywearUpdateApprovals').doc(id),{approvedBy:context.auth.uid,approvedAt:FieldValue.serverTimestamp(),recipientCount:subscribers.size});
 });
 return {published:true};
});
