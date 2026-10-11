"use strict";
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const functionsV1=require('firebase-functions/v1');
initializeApp();const db=getFirestore();
// Also cleans up when an account is deleted in Firebase Console. No email is sent.
exports.cleanupDaywearAccount=functionsV1.region('europe-west1').runWith({maxInstances:1,timeoutSeconds:120,memory:'256MB',failurePolicy:true}).auth.user().onDelete(async user=>{
 await db.collection('daywearRemovedUsers').doc(user.uid).set({removedAt:require('firebase-admin/firestore').FieldValue.serverTimestamp()});
 await db.recursiveDelete(db.collection('daywearProfiles').doc(user.uid));
 await db.collection('daywearUpdateSubscriptions').doc(user.uid).delete();
 for(;;){const queued=await db.collection('daywearUpdateMail').where('uid','==',user.uid).limit(100).get();if(queued.empty)break;const batch=db.batch();queued.forEach(d=>batch.delete(d.ref));await batch.commit();}
 for(;;){const docs=await db.collection('daywearFeedback').where('uid','==',user.uid).limit(100).get();if(docs.empty)break;const batch=db.batch();docs.forEach(doc=>batch.delete(doc.ref));await batch.commit();}
 for(;;){const messages=await db.collection('daywearAdminMessages').where('uid','==',user.uid).limit(100).get();if(messages.empty)break;const batch=db.batch();messages.forEach(d=>batch.delete(d.ref));await batch.commit();}
 await db.collection('daywearFeedbackLimits').doc(user.uid).delete();
});

exports.publishUpdate=require('./updates').publishUpdate;

const users=require('./users');exports.listUsers=users.listUsers;exports.saveMessage=users.saveMessage;exports.removeUser=users.removeUser;

exports.prepareMail=users.prepareMail;
