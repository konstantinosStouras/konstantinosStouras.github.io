// Private testing data is in Firebase. Ownership/checklists/rotation remain local.
import {getAccountUser} from './auth.js?v=20261011-news-v1';
let services;
export async function database(){
 if(!services)services=import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js').then(s=>({s,db:s.getFirestore()})).catch(e=>{services=null;throw e;});
 return services;
}
export async function sendFeedback(payload,id){
 const user=getAccountUser();if(!user)throw Error('Sign in to send feedback.');
 const {s,db}=await database();
 // A stable id makes a retry safe if the server saved a request but its reply was lost.
 const ref=s.doc(db,'daywearFeedback',id);
 const existing=await s.getDocFromServer(ref);
 if(existing.exists())return;
 if(getAccountUser()?.uid!==user.uid)throw Error('Your account changed. Please retry.');
 const batch=s.writeBatch(db);
 batch.set(ref,{...payload,uid:user.uid,email:user.email||'',emailVerified:user.emailVerified,status:'open',createdAt:s.serverTimestamp()});
 batch.set(s.doc(db,'daywearFeedbackLimits',user.uid),{lastSent:s.serverTimestamp(),feedbackId:id});
 await batch.commit();
}
export async function deleteAccountFeedback(uid){
 const {s,db}=await database();
 // Each batch is bounded; a failed cleanup is retried before Auth deletion.
 for(;;){
  if(getAccountUser()?.uid!==uid)throw Error('Your account changed. Please retry.');
  const records=await s.getDocsFromServer(s.query(s.collection(db,'daywearFeedback'),s.where('uid','==',uid),s.limit(100)));
  if(records.empty)break;
  const batch=s.writeBatch(db);records.forEach(record=>batch.delete(record.ref));await batch.commit();
 }
 await s.deleteDoc(s.doc(db,'daywearUpdateSubscriptions',uid));
 const photos=await s.getDocsFromServer(s.collection(db,'daywearProfiles',uid,'photos'));
 const batch=s.writeBatch(db);photos.forEach(photo=>batch.delete(photo.ref));batch.delete(s.doc(db,'daywearProfiles',uid));await batch.commit();
 // Keep the rate-limit receipt: it contains no profile, email, message or image.
}
export async function loadCloudProfile(uid){const {s,db}=await database();const doc=await s.getDocFromServer(s.doc(db,'daywearProfiles',uid));return doc.exists()?doc.data():null;}
export async function saveCloudProfile(uid,profile){
 const {s,db}=await database();if(getAccountUser()?.uid!==uid)throw Error('Your account changed. Please retry.');
 await s.setDoc(s.doc(db,'daywearProfiles',uid),{name:profile.name,sizes:JSON.stringify(profile.sizes),updatedAt:s.serverTimestamp()});
}
export async function getPhotos(uid){const {s,db}=await database();const docs=await s.getDocsFromServer(s.collection(db,'daywearProfiles',uid,'photos'));return docs.docs.map(d=>({id:d.id,...d.data()}));}
export async function savePhoto(uid,id,photo){const {s,db}=await database();if(getAccountUser()?.uid!==uid)throw Error('Your account changed. Please retry.');await s.setDoc(s.doc(db,'daywearProfiles',uid,'photos',id),{...photo,consentVersion:'daywear-testing-1',updatedAt:s.serverTimestamp()});}
export async function removePhoto(uid,id){const {s,db}=await database();if(getAccountUser()?.uid!==uid)throw Error('Your account changed. Please retry.');await s.deleteDoc(s.doc(db,'daywearProfiles',uid,'photos',id));}
