import {getLanguage} from './i18n.js?v=20261009-public-languages';
import {accountIdentity,accountButtonMarkup} from './account-ui.js?v=20261009-public-languages';
import {firebaseConfig,enabledProviders} from './firebase-config.js?v=20261009-public-languages';
import {passwordProblem,authMessage} from './auth-policy.js?v=20261009-public-languages';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sdk,auth,user=null,ready=false,initializationError=false,busy=false,view='signin',notice='';
export async function getAccountToken(expectedUid){
 const current=user;
 if(!current||current.uid!==expectedUid)throw Error('Please sign in again.');
 const token=await current.getIdToken();
 if(user!==current)throw Error('Your account changed. Please retry.');
 return token;
}
const modal=document.createElement('dialog');
modal.id='account-modal';modal.className='account-modal';modal.setAttribute('aria-label','Your account');modal.tabIndex=-1;
document.body.append(modal);
const trigger=document.querySelector('#account-button');
let profileName='';
function renderAccountButton(){
 trigger.innerHTML=accountButtonMarkup(user,profileName);
 trigger.classList.toggle('signed-in',!!user);trigger.setAttribute('aria-haspopup','dialog');
 if(user)trigger.setAttribute('aria-label','Your account: '+accountIdentity(user,profileName).name);else trigger.removeAttribute('aria-label');
 trigger.querySelector('img')?.addEventListener('error',event=>event.target.remove(),{once:true});
}
document.addEventListener('wardrobe:profile',event=>{if(!user||event.detail.uid!==user.uid)return;profileName=event.detail.name;renderAccountButton();});
const providerNames={'google.com':'Google','facebook.com':'Facebook','apple.com':'Apple','microsoft.com':'Microsoft'};

function notify(){document.dispatchEvent(new CustomEvent('wardrobe:account',{detail:{uid:user?.uid||null,name:user?.displayName||'',email:user?.email||''}}));}
function message(text){notice=text;const el=modal.querySelector('#auth-message');if(el)el.textContent=text;}
function render(){
 renderAccountButton();
 if(!modal.open)return;
 const intro='<p class="eyebrow">YOUR PERSONAL COLLECTION</p>';
 const close='<button type="button" class="close" data-account="close" aria-label="Close account dialog">×</button>';
 const status='<p id="auth-message" class="auth-message" role="status" aria-live="polite">'+esc(notice)+'</p>';
 if(!ready){modal.innerHTML=close+intro+'<h2>Your wardrobe, your account.</h2><p>'+(initializationError?'Sign-in could not load. Check your connection and try again.':'Connecting securely…')+'</p>'+(initializationError?'<button data-account="retry">Try again</button>':'');return;}
 if(user){
  const verified=user.emailVerified;
  modal.innerHTML=close+intro+'<h2>Welcome'+(user.displayName?', '+esc(user.displayName):' back')+'.</h2><p data-i18n-skip>'+esc(user.email)+'</p><span class="tag">'+(verified?'Email verified':'Email verification pending')+'</span>'+status+
   (!verified?'<div class="callout"><p>Check your inbox for a verification email.</p><div class="actions"><button data-account="verify">Resend email</button><button data-account="check-verification">I’ve verified my email</button></div></div>':'')+
   '<section class="section"><h3>Your account & data</h3><p class="form-note">Firebase securely manages your sign-in. Your wardrobe choices are saved separately for this account in this browser. Cross-device wardrobe sync is not enabled yet.</p><div class="actions"><button data-account="profile">Wardrobe profile</button><button data-account="signout">Sign out</button></div></section>'+
   '<details class="section"><summary>Delete account</summary><p class="form-note">Deletes your Firebase account and this account’s saved wardrobe on this device. Backups and data on other devices are not removed.</p><button data-account="delete-confirm">Delete my account…</button></details>';
  modal.scrollTop=0;return;
 }
 const register=view==='register',reset=view==='reset';
 modal.innerHTML=close+intro+'<h2>'+(reset?'A fresh start.':register?'Make room for better days.':'Welcome back.')+'</h2><p class="muted">'+(reset?'We’ll send a link to reset your password.':register?'Create your personal wardrobe account.':'Sign in to your wardrobe account.')+'</p>'+
  (!reset?'<div class="auth-providers">'+enabledProviders.map(id=>'<button type="button" class="social-button" data-provider="'+id+'">'+(id==='google.com'?'<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.8-2.5l-3.3-2.6c-.9.6-2.1 1-3.5 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10.2 10.2 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.7a6 6 0 0 1 0-3.4V7.6H3a10 10 0 0 0 0 8.8l3.4-2.7Z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10.2 10.2 0 0 0-9 5.6l3.4 2.7C7.2 7.9 9.4 6.1 12 6.1Z"/></svg>':'')+'Continue with '+providerNames[id]+'</button>').join('')+'</div><div class="auth-divider"><span>or use your email</span></div>':'')+
  '<form id="auth-form">'+(register?'<label class="field">Your name<input name="name" autocomplete="given-name" maxlength="50" required></label>':'')+
  '<label class="field">Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label>'+
  (!reset?'<div class="field"><label for="auth-password">Password</label><span class="password-field"><input id="auth-password" name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" '+(register?'minlength="10" maxlength="128"':'')+' required><button type="button" data-account="show-password" aria-label="Show password">Show</button></span></div>':'')+
  (register?'<p class="caption">Use 10–128 characters. A long, unique passphrase works well.</p><label class="field">Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>':'')+
  (!reset?'<label class="remember"><input name="remember" type="checkbox"> Keep me signed in on this device</label>':'')+status+
  '<button class="primary auth-submit">'+(reset?'Send reset link':register?'Create account':'Sign in')+'</button></form>'+
  (!register&&!reset?'<button class="text-button auth-forgot" data-account="reset">Forgot password?</button>':'')+
  '<div class="auth-switch">'+(reset?'<button class="text-button" data-account="signin">Back to sign in</button>':register?'Already have an account? <button class="text-button" data-account="signin">Sign in</button>':'New here? <button class="text-button" data-account="register">Create an account</button>')+'</div><p class="caption muted">Your name, email and sign-in details are processed by Firebase. Passwords are never saved by this website. Wardrobe preferences stay on this device.</p>';
 modal.scrollTop=0;modal.focus({preventScroll:true});
}
async function run(task,waitingText='Still connecting. Check your internet connection if this takes a while.'){
 if(busy)return;busy=true;modal.setAttribute('aria-busy','true');modal.querySelectorAll('button:not([data-account="close"]),input').forEach(el=>el.disabled=true);message('Please wait…');
 const waiting=setTimeout(()=>message(waitingText),12000);
 try{await task();}catch(error){message(authMessage(error));}finally{clearTimeout(waiting);busy=false;modal.removeAttribute('aria-busy');modal.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
}
async function persistence(remember){await sdk.setPersistence(auth,remember?sdk.browserLocalPersistence:sdk.browserSessionPersistence);}
function provider(id){if(!enabledProviders.includes(id))throw {code:'auth/operation-not-allowed'};if(id==='google.com'){const p=new sdk.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});return p;}if(id==='facebook.com')return new sdk.FacebookAuthProvider();return new sdk.OAuthProvider(id);}
async function initialize(){
 initializationError=false;render();
 try{
  const [app,authSdk]=await Promise.all([import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js')]);
  sdk=authSdk;auth=sdk.initializeAuth(app.initializeApp(firebaseConfig),{persistence:[sdk.browserSessionPersistence,sdk.browserLocalPersistence],popupRedirectResolver:sdk.browserPopupRedirectResolver});
  auth.languageCode=getLanguage();
  sdk.onAuthStateChanged(auth,next=>{user=next;profileName='';ready=true;notify();render();},()=>{initializationError=true;render();});
 }catch{initializationError=true;render();}
}
trigger.addEventListener('click',()=>{view='signin';notice='';modal.showModal();render();});
modal.addEventListener('click',e=>{
 const el=e.target.closest('button');if(!el)return;
 const action=el.dataset.account;
 if(action==='close'){modal.close();return;}
 if(action==='retry'){initialize();return;}
 if(['signin','register','reset'].includes(action)){view=action;notice='';render();return;}
 if(action==='show-password'){const field=modal.querySelector('[name=password]');field.type=field.type==='password'?'text':'password';el.textContent=field.type==='password'?'Show':'Hide';el.setAttribute('aria-label',field.type==='password'?'Show password':'Hide password');return;}
 if(action==='profile'){modal.close();document.querySelector('[data-action=settings]').click();return;}
 if(el.dataset.provider){const p=provider(el.dataset.provider),remember=!!modal.querySelector('[name=remember]')?.checked;run(async()=>{await persistence(remember);await sdk.signInWithPopup(auth,p);notice='';render();},'Complete sign-in in the Google window. If it did not open, allow pop-ups for this website or use email sign-in.');}
 if(action==='signout')run(async()=>{await sdk.signOut(auth);notice='You’re signed out.';view='signin';render();});
 if(action==='verify')run(async()=>{await sdk.sendEmailVerification(user);message('Verification email sent. Check your inbox and spam folder.');});
 if(action==='check-verification')run(async()=>{await sdk.reload(user);user=auth.currentUser;notice=user.emailVerified?'Your email is verified.':'Not verified yet. Open the link in your email, then try again.';render();});
 if(action==='delete-confirm'){notice='';modal.innerHTML='<h2>Delete your account?</h2><p>This permanently deletes your sign-in account and its wardrobe preferences on this device.</p><div class="actions"><button data-account="cancel-delete">Keep my account</button><button class="primary" data-account="delete">Permanently delete</button></div><p id="auth-message" role="status"></p>';}
 if(action==='cancel-delete')render();
 if(action==='delete')run(async()=>{const uid=user.uid;await sdk.deleteUser(user);localStorage.removeItem(`wardrobe.account.${uid}`);view='signin';notice='Your account has been deleted.';render();});
});
modal.addEventListener('submit',e=>{
 if(e.target.id!=='auth-form')return;e.preventDefault();
 const data=new FormData(e.target),email=String(data.get('email')).trim(),password=String(data.get('password')||'');
 if(view==='register'){const problem=passwordProblem(password,String(data.get('confirmation')));if(problem){message(problem);return;}}
 const action=view;
 run(async()=>{
  if(action==='reset'){try{await sdk.sendPasswordResetEmail(auth,email);}catch(err){if(err.code!=='auth/user-not-found')throw err;}message('If an account can be reset for that email, a reset link has been sent. Check your inbox.');return;}
  await persistence(data.get('remember')==='on');
  if(action==='register'){
   const result=await sdk.createUserWithEmailAndPassword(auth,email,password);
   await sdk.updateProfile(result.user,{displayName:String(data.get('name')).trim().slice(0,50)});user=result.user;notify();
   try{await sdk.sendEmailVerification(user);notice='Account created. Check your email to verify your address.';}catch{notice='Account created, but the verification email could not be sent. Use Resend email.';}
  }else{await sdk.signInWithEmailAndPassword(auth,email,password);notice='';}
  render();
 });
});
initialize();

document.addEventListener('wardrobe:language',()=>{if(auth)auth.languageCode=getLanguage();});
