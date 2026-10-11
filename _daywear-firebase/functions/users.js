'use strict';
const functions=require('firebase-functions/v1');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const admin=async context=>{if(context.auth?.token.daywearAdmin!==true)throw new functions.https.HttpsError('permission-denied','Administrator access required.');const user=await getAuth().getUser(context.auth.uid).catch(()=>null);if(!user||user.disabled||user.customClaims?.daywearAdmin!==true)throw new functions.https.HttpsError('permission-denied','Administrator access required.');};
exports.listUsers=functions.region('europe-west1').runWith({maxInstances:1}).https.onCall(async(data,context)=>{
 await admin(context);if(data?.pageToken!==undefined&&(typeof data.pageToken!=='string'||data.pageToken.length>2000))throw new functions.https.HttpsError('invalid-argument','Invalid page.');
 const result=await getAuth().listUsers(100,data?.pageToken||undefined),db=getFirestore();
 const users=await Promise.all(result.users.map(async user=>{const [profile,sub]=await Promise.all([db.collection('daywearProfiles').doc(user.uid).get(),db.collection('daywearUpdateSubscriptions').doc(user.uid).get()]);return {uid:user.uid,name:profile.data()?.name||user.displayName||'',email:user.email||'',emailVerified:user.emailVerified,disabled:user.disabled,admin:user.customClaims?.daywearAdmin===true,createdAt:user.metadata.creationTime,subscribed:sub.data()?.enabled===true};}));
 return {users,pageToken:result.pageToken||null};
});
exports.saveMessage=functions.region('europe-west1').runWith({maxInstances:1}).https.onCall(async(data,context)=>{
 await admin(context);
 if(typeof data?.uid!=='string'||data.uid.length>128||typeof data.subject!=='string'||!data.subject.trim()||data.subject.length>200||/[\r\n]/.test(data.subject)||typeof data.body!=='string'||!data.body.trim()||data.body.length>6000||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.id))throw new functions.https.HttpsError('invalid-argument','Invalid message.');
 const recipient=await getAuth().getUser(data.uid);if(!recipient.email||recipient.disabled)throw new functions.https.HttpsError('failed-precondition','This account cannot receive a message.');
 const ref=getFirestore().collection('daywearAdminMessages').doc(data.id),draft={uid:recipient.uid,to:recipient.email,subject:data.subject.trim(),body:data.body.trim(),status:'draft',createdBy:context.auth.uid};
 await getFirestore().runTransaction(async tx=>{const previous=await tx.get(ref);if(previous.exists){const old=previous.data();if(old.uid!==draft.uid||old.subject!==draft.subject||old.body!==draft.body)throw new functions.https.HttpsError('already-exists','Draft changed. Please retry.');return;}tx.create(ref,{...draft,createdAt:FieldValue.serverTimestamp()});});
 return {id:data.id,...draft};
});
exports.removeUser=functions.region('europe-west1').runWith({maxInstances:1}).https.onCall(async(data,context)=>{
 await admin(context);if(typeof data?.uid!=='string'||data.uid.length>128||typeof data.email!=='string')throw new functions.https.HttpsError('invalid-argument','Invalid account.');
 const user=await getAuth().getUser(data.uid);
 if(user.uid===context.auth.uid||user.customClaims?.daywearAdmin===true)throw new functions.https.HttpsError('failed-precondition','Administrator accounts cannot be removed here.');
 if(!user.email||data.email!==user.email)throw new functions.https.HttpsError('failed-precondition','Type the exact account email to confirm removal.');
 await getFirestore().collection('daywearRemovedUsers').doc(user.uid).set({removedAt:FieldValue.serverTimestamp()});
 await getAuth().revokeRefreshTokens(user.uid);
 await getAuth().deleteUser(user.uid);
 return {removed:true};
});
exports.prepareMail=functions.region('europe-west1').runWith({maxInstances:1}).https.onCall(async(data,context)=>{
 await admin(context);
 if(!['daywearAdminMessages','daywearUpdateMail'].includes(data?.collection)||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,250}$/.test(data.id))throw new functions.https.HttpsError('invalid-argument','Invalid message.');
 const db=getFirestore(),doc=await db.collection(data.collection).doc(data.id).get();if(!doc.exists)throw new functions.https.HttpsError('not-found','Message not found.');
 const d=doc.data(),user=await getAuth().getUser(d.uid).catch(()=>null);if(!user||user.disabled||!user.email)throw new functions.https.HttpsError('failed-precondition','Recipient unavailable.');
 if(data.collection==='daywearAdminMessages'){if(d.status!=='draft'||d.to!==user.email)throw new functions.https.HttpsError('failed-precondition','Draft unavailable.');return {to:user.email,subject:d.subject,body:d.body};}
 const [subscription,update]=await Promise.all([db.collection('daywearUpdateSubscriptions').doc(d.uid).get(),db.collection('daywearUpdates').doc(d.updateId).get()]);
 if(d.status!=='awaiting-approval'||!subscription.data()?.enabled||subscription.data().email!==user.email||!update.exists)throw new functions.https.HttpsError('failed-precondition','Subscription or update unavailable.');
 const p=update.data(),el=d.language==='el';return {to:user.email,subject:el?p.titleEl:p.titleEn,body:(el?p.bodyEl:p.bodyEn)+'\n\nhttps://www.stouras.com/daywear/#whats-new\n\n'+(el?'Για διακοπή των ειδοποιήσεων, καταργήστε την επιλογή email στη σελίδα ενημερώσεων.':'To stop alerts, untick email alerts on the updates page.')};
});
