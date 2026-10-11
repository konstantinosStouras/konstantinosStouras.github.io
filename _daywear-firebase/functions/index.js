"use strict";
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const functionsV1=require('firebase-functions/v1');
initializeApp();const db=getFirestore();
// Also cleans up when an account is deleted in Firebase Console. No email is sent.
exports.cleanupDaywearAccount=functionsV1.region('europe-west1').runWith({maxInstances:1,timeoutSeconds:120,memory:'256MB',failurePolicy:true}).auth.user().onDelete(async user=>{
 await db.recursiveDelete(db.collection('daywearProfiles').doc(user.uid));
 for(;;){const docs=await db.collection('daywearFeedback').where('uid','==',user.uid).limit(100).get();if(docs.empty)break;const batch=db.batch();docs.forEach(doc=>batch.delete(doc.ref));await batch.commit();}
 await db.collection('daywearFeedbackLimits').doc(user.uid).delete();
});
