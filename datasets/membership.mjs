import {firebaseConfig} from './firebase-config.mjs';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,GoogleAuthProvider,signInWithPopup,sendEmailVerification,sendPasswordResetEmail,signOut,reload} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,collection,doc,getDocs,setDoc,deleteDoc,addDoc,serverTimestamp,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let current=null,stopBookmarks=()=>{},listeners=[],bookmarks=[],privateData=new Map();
const $=id=>document.getElementById(id);
export const isMember=()=>!!current?.emailVerified;
export const session=()=>({user:current,verified:isMember(),bookmarks,links:privateData});
export function onSession(fn){listeners.push(fn);fn(session());}
const notify=()=>listeners.forEach(fn=>fn(session()));
function message(text){$('account-status').textContent=text;}
function errorText(error){const code=error.code||'';return ({'auth/invalid-credential':'The email or password is incorrect.','auth/email-already-in-use':'This email already has an account. Sign in or reset your password.','auth/weak-password':'Choose a password with at least 8 characters.','auth/popup-blocked':'Allow the Google sign-in popup and try again.','auth/popup-closed-by-user':'Google sign-in was closed.','auth/too-many-requests':'Please wait a little before trying again.','auth/invalid-email':'Enter a valid email address.','permission-denied':'Verify your email, then sign in again to continue.'})[code]||'Something went wrong. Please try again.';}
export function openAccount(mode='login'){
  $('account-mode').value=mode;$('account-title').textContent=mode==='register'?'Join the library':'Welcome back';$('account-submit').textContent=mode==='register'?'Create account':'Sign in';$('account-password').autocomplete=mode==='register'?'new-password':'current-password';message('');$('account-dialog').showModal();
}
export function requireMember(){if(isMember())return true;openAccount();if(current)message('Please verify your email to unlock member features.');return false;}
export async function toggleBookmark(id){
  if(!requireMember())return;
  const ref=doc(db,'users',current.uid,'bookmarks',id);
  try{if(bookmarks.includes(id))await deleteDoc(ref);else await setDoc(ref,{datasetId:id,createdAt:serverTimestamp()});}catch(e){openAccount();message(errorText(e));}
}
export function openContribution(entry=null){
  if(!requireMember())return;
  $('contribution-id').value=entry?.id||'';$('contribution-title').value=entry?.title||'';$('contribution-url').value=entry?.url||'';$('contribution-description').value=entry?.description||'';$('contribution-tags').value=(entry?.tags||[]).join(', ');$('contribution-heading').textContent=entry?'Suggest an edit':'Add a dataset';$('contribution-status').textContent='Submissions are reviewed before appearing in the public library.';$('contribution-dialog').showModal();
}
$('sign-in').onclick=()=>openAccount();$('register').onclick=()=>openAccount('register');$('sign-out').onclick=()=>signOut(auth);
$('account-switch').onclick=()=>openAccount($('account-mode').value==='register'?'login':'register');
for(const b of document.querySelectorAll('[data-close-dialog]'))b.onclick=()=>$(b.dataset.closeDialog).close();
async function verifyEmail(){await sendEmailVerification(current,{url:'https://www.stouras.com/datasets/'});message('Verification email sent. Click its link, then choose “I have verified my email”.');}
$('account-form').onsubmit=async event=>{
  event.preventDefault();$('account-submit').disabled=true;
  try{const email=$('account-email').value.trim(),password=$('account-password').value;
    if($('account-mode').value==='register'){const result=await createUserWithEmailAndPassword(auth,email,password);current=result.user;await verifyEmail();}
    else{await signInWithEmailAndPassword(auth,email,password);if(isMember())$('account-dialog').close();else message('Check your inbox and verify your email to unlock member features.');}
  }catch(e){message(errorText(e));}finally{$('account-submit').disabled=false;$('account-password').value='';}
};
$('google-sign-in').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());if(isMember())$('account-dialog').close();else await verifyEmail();}catch(e){message(errorText(e));}};
$('resend-verification').onclick=async()=>{try{if(current)await verifyEmail();else message('Sign in first to resend your verification email.');}catch(e){message(errorText(e));}};
$('refresh-verification').onclick=async()=>{try{if(!current)return message('Sign in first.');await reload(current);await current.getIdToken(true);await updateSession(current);if(isMember()){$('account-dialog').close();}else message('Your email is not verified yet. Open the link in your inbox first.');}catch(e){message(errorText(e));}};
$('reset-password').onclick=async()=>{try{await sendPasswordResetEmail(auth,$('account-email').value.trim(),{url:'https://www.stouras.com/datasets/'});message('If an account exists, a password reset email is on its way.');}catch(e){message(errorText(e));}};
$('contribution-form').onsubmit=async event=>{
  event.preventDefault();if(!requireMember())return;const button=$('contribution-submit');button.disabled=true;
  try{const datasetId=$('contribution-id').value;
    await addDoc(collection(db,'submissions'),{uid:current.uid,kind:datasetId?'edit':'addition',datasetId,title:$('contribution-title').value.trim(),url:$('contribution-url').value.trim(),description:$('contribution-description').value.trim(),tags:$('contribution-tags').value.trim(),status:'pending',createdAt:serverTimestamp()});
    $('contribution-status').textContent='Thank you. Your suggestion has been saved for review.';$('contribution-form').reset();
  }catch(e){$('contribution-status').textContent=errorText(e);}finally{button.disabled=false;}
};
let generation=0;
async function updateSession(user){
  const run=++generation;stopBookmarks();current=user;bookmarks=[];privateData=new Map();
  $('sign-in').hidden=!!user;$('register').hidden=!!user;$('sign-out').hidden=!user;$('member-name').hidden=!user;$('member-name').textContent=user?(user.displayName||user.email)+(user.emailVerified?'':' · verify email'):'';
  $('verification-tools').hidden=!user||user.emailVerified;notify();
  if(!isMember())return;
  stopBookmarks=onSnapshot(collection(db,'users',user.uid,'bookmarks'),snap=>{if(run!==generation)return;bookmarks=snap.docs.map(d=>d.id);notify();},()=>message('Your bookmarks could not be loaded. Please try signing in again.'));
  try{const records=await getDocs(collection(db,'datasetLinks'));if(run!==generation)return;privateData=new Map(records.docs.map(d=>[d.id,JSON.parse(d.data().payload)]));notify();}catch(e){message(errorText(e));}
}
onAuthStateChanged(auth,updateSession);
window.addEventListener('focus',()=>{if(current&&!current.emailVerified)reload(current).then(()=>current.getIdToken(true)).then(()=>updateSession(current)).catch(()=>{});});
