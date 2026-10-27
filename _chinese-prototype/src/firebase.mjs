import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,onAuthStateChanged,signOut} from 'firebase/auth';
import {getFirestore,collection,doc,getDoc,getDocs,setDoc,addDoc,deleteDoc,writeBatch,query,where,orderBy,limit,serverTimestamp} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import config from './firebase-config.json';
import validation from '../_chinese-firebase/functions/validation.js';
export const app=initializeApp(config),auth=getAuth(app),db=getFirestore(app);
const call=httpsCallable(getFunctions(app,'europe-west1'),'chineseApi',{timeout:90000});
export const api=async data=>{
 if(!auth.currentUser)throw Error('Sign in to continue.');
 if(data.action==='saveLesson'){
  const lesson=validation.validateLesson({...data.lesson,published:data.publish===true});
  const id=`${lesson.moduleId}-${String(lesson.week).padStart(2,'0')}`,value={...lesson,updatedBy:auth.currentUser.uid,updatedAt:serverTimestamp()},batch=writeBatch(db);
  batch.set(doc(db,'drafts',id),value);
  if(data.publish===true)batch.set(doc(db,'lessons',id),{...value,published:true});
  if(data.unpublish===true)batch.delete(doc(db,'lessons',id));
  await batch.commit();return {saved:true};
 }
 if(data.action==='approve'){await setDoc(doc(db,'access',data.uid),{approved:data.enabled===true,updatedAt:serverTimestamp()});return {saved:true};}
 if(data.action==='setAdmin'){
  if(data.enabled){const profile=await getDoc(doc(db,'users',data.uid));if(!profile.exists())throw Error('This person needs to register first.');await setDoc(doc(db,'admins',data.uid),{email:profile.data().email,createdBy:auth.currentUser.uid,updatedAt:serverTimestamp()});}
  else await deleteDoc(doc(db,'admins',data.uid));
  return {saved:true};
 }
 return (await call(data)).data;
};
export const googleLogin=()=>signInWithPopup(auth,new GoogleAuthProvider());
export const passwordLogin=(username,password)=>{
 if(username.trim().toLowerCase()!=='teacher')throw Error('The shared username is teacher.');
 return signInWithEmailAndPassword(auth,'shared-teacher@stouras-chinese.firebaseapp.com',password);
};
export {collection,doc,getDoc,getDocs,setDoc,addDoc,query,where,orderBy,limit,serverTimestamp,onAuthStateChanged,signOut};
