import {database} from './account-data.js?v=20261022-admin-v4';
import {getAccountUser,isAccountAdmin} from './auth.js?v=20261022-admin-v4';
import {getLanguage,translateText,locale} from './i18n.js?v=20261022-admin-v4';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words={"What's new":"Τι νέο υπάρχει","What changed, newest first.":"Οι αλλαγές, από τις πιο πρόσφατες.","Only updates approved by the administrator appear here.":"Εδώ εμφανίζονται μόνο ενημερώσεις εγκεκριμένες από τον διαχειριστή.","Receive email alerts for approved website updates":"Να λαμβάνω ειδοποιήσεις email για εγκεκριμένες ενημερώσεις του ιστοτόπου","Sign in to manage email alerts.":"Συνδεθείτε για να διαχειριστείτε τις ειδοποιήσεις email.","Sign in / Register":"Σύνδεση / Εγγραφή","You can untick this at any time. Alerts use your account email.":"Μπορείτε να καταργήσετε την επιλογή οποτεδήποτε. Οι ειδοποιήσεις αποστέλλονται στο email του λογαριασμού σας.","Loading…":"Φόρτωση…","No approved updates yet.":"Δεν υπάρχουν ακόμη εγκεκριμένες ενημερώσεις.","Could not load updates. Please retry.":"Δεν ήταν δυνατή η φόρτωση. Δοκιμάστε ξανά.","Retry":"Δοκιμάστε ξανά","Manage updates":"Διαχείριση ενημερώσεων","Administrator approval":"Έγκριση διαχειριστή","Save private draft":"Αποθήκευση ιδιωτικού προσχεδίου","English title":"Τίτλος στα αγγλικά","English update":"Ενημέρωση στα αγγλικά","Greek title":"Τίτλος στα ελληνικά","Greek update":"Ενημέρωση στα ελληνικά","Drafts are private. Approval publishes this exact text and queues email alerts.":"Τα προσχέδια είναι ιδιωτικά. Η έγκριση δημοσιεύει αυτό το κείμενο και δημιουργεί ειδοποιήσεις email προς αποστολή.","Approve & publish":"Έγκριση και δημοσίευση","Saving…":"Αποθήκευση…","Saved.":"Αποθηκεύτηκε.","Could not save. Please retry.":"Δεν ήταν δυνατή η αποθήκευση. Δοκιμάστε ξανά.","Published":"Δημοσιεύτηκε","Private draft":"Ιδιωτικό προσχέδιο","Administrator access required.":"Απαιτείται πρόσβαση διαχειριστή.","Email alerts are sent through Gmail after administrator approval.":"Οι ειδοποιήσεις email αποστέλλονται μέσω Gmail μετά την έγκριση του διαχειριστή.","Back to updates":"Επιστροφή στις ενημερώσεις","No private drafts.":"Δεν υπάρχουν ιδιωτικά προσχέδια."};
const t=s=>getLanguage()==='el'?(words[s]||s):translateText(s);
const bilingual=d=>getLanguage()==='el'?{title:d.titleEl,body:d.bodyEl}:{title:d.titleEn,body:d.bodyEn};
let generation=0;
export function updatesPage(manage=false){return `<section class="updates-page" data-i18n-skip><p class="eyebrow">${esc(t(manage?'Administrator approval':"What's new"))}</p><h1>${esc(t(manage?'Manage updates':'What changed, newest first.'))}</h1><p class="muted">${esc(t(manage?'Drafts are private. Approval publishes this exact text and queues email alerts.':'Only updates approved by the administrator appear here.'))}</p>${manage?`<a href="#whats-new">← ${esc(t('Back to updates'))}</a><div id="updates-admin"></div>`:`<div class="personal-card" id="updates-preference"></div><div id="updates-manage">${isAccountAdmin()?`<p><a href="#updates-admin">${esc(t('Manage updates'))} ↗</a></p>`:''}</div>`}<p id="updates-status" role="status" aria-live="polite">${esc(t('Loading…'))}</p><div id="updates-list"></div></section>`;}
const current=(v,uid)=>v===generation&&getAccountUser()?.uid===uid&&document.querySelector('#updates-list');
function message(s){const el=document.querySelector('#updates-status');if(el)el.textContent=t(s);}
export async function loadUpdates(manage=false){
 const v=++generation,user=getAccountUser(),uid=user?.uid;
 try{
  if(manage&&!isAccountAdmin()){message('Administrator access required.');return;}
  const {s,db}=await database();
  const docs=await s.getDocsFromServer(s.query(s.collection(db,manage?'daywearUpdateDrafts':'daywearUpdates'),s.orderBy(manage?'updatedAt':'publishedAt','desc'),s.limit(100)));
  if(!current(v,uid))return;
  document.querySelector('#updates-list').innerHTML=docs.empty?`<p>${esc(t(manage?'No private drafts.':'No approved updates yet.'))}</p>`:`<ol class="updates-timeline">${docs.docs.map(doc=>{const d=doc.data(),copy=bilingual(d),date=(d.publishedAt||d.updatedAt)?.toDate();return `<li><time>${esc(date?.toLocaleDateString(locale(),{year:'numeric',month:'short',day:'numeric'})||'')}</time><h3>${esc(copy.title)}</h3><p class="update-body">${esc(copy.body)}</p>${manage?`<button class="primary" data-approve-update="${esc(doc.id)}">${esc(t('Approve & publish'))}</button>`:''}</li>`;}).join('')}</ol>`;
  message('');
  if(manage){document.querySelector('#updates-admin').innerHTML=`<form id="update-draft" class="personal-card">${[['titleEn','English title',120],['bodyEn','English update',4000],['titleEl','Greek title',120],['bodyEl','Greek update',4000]].map(([name,label,max])=>`<label class="field">${esc(t(label))}${name.startsWith('body')?`<textarea name="${name}" rows="4" maxlength="${max}" required></textarea>`:`<input name="${name}" maxlength="${max}" required>`}</label>`).join('')}<button class="primary">${esc(t('Save private draft'))}</button></form>`;return;}
  const box=document.querySelector('#updates-preference');
  if(!user){box.innerHTML=`<p>${esc(t('Sign in to manage email alerts.'))}</p><button data-open-signin>${esc(t('Sign in / Register'))}</button>`;return;}
  const pref=await s.getDocFromServer(s.doc(db,'daywearUpdateSubscriptions',uid));
  if(!current(v,uid))return;
  box.innerHTML=`<label class="updates-check"><input type="checkbox" id="updates-optin" ${pref.data()?.enabled?'checked':''}> <span>${esc(t('Receive email alerts for approved website updates'))}</span></label><p class="caption">${esc(t('You can untick this at any time. Alerts use your account email.'))}</p><p class="caption">${esc(t('Email delivery is awaiting configuration; your preference is saved.'))}</p>`;
 }catch{if(current(v,uid)){message('Could not load updates. Please retry.');document.querySelector('#updates-list').innerHTML=`<button data-updates-retry>${esc(t('Retry'))}</button>`;}}
}
document.addEventListener('change',async e=>{
 if(e.target.id!=='updates-optin')return;
 const input=e.target,user=getAccountUser(),value=input.checked,v=generation;if(!user)return;
 input.disabled=true;message('Saving…');
 try{const {s,db}=await database();if(!current(v,user.uid))return;await s.setDoc(s.doc(db,'daywearUpdateSubscriptions',user.uid),{enabled:value,email:user.email,language:getLanguage()==='el'?'el':'en',consentVersion:'daywear-updates-1',updatedAt:s.serverTimestamp()});if(current(v,user.uid))message('Saved.');}
 catch{if(current(v,user.uid)){input.checked=!value;message('Could not save. Please retry.');}}
 finally{input.disabled=false;}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='update-draft')return;e.preventDefault();if(!isAccountAdmin())return;
 const form=e.target,button=form.querySelector('button');button.disabled=true;message('Saving…');
 try{const {s,db}=await database();const data=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,v.trim()]));if(Object.values(data).some(v=>!v))throw Error('Empty draft');await s.addDoc(s.collection(db,'daywearUpdateDrafts'),{...data,updatedAt:s.serverTimestamp()});await loadUpdates(true);message('Saved.');}catch{message('Could not save. Please retry.');}finally{button.disabled=false;}
});
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-updates-retry]'))return loadUpdates(location.hash==='#updates-admin');
 const button=e.target.closest('[data-approve-update]');if(!button||!isAccountAdmin())return;
 button.disabled=true;message('Saving…');
 try{const f=await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js');await f.httpsCallable(f.getFunctions(undefined,'europe-west1'),'publishUpdate')({id:button.dataset.approveUpdate});await loadUpdates(true);message('Published');}catch{message('Could not save. Please retry.');}finally{button.disabled=false;}
});
for(const event of ['wardrobe:language'])document.addEventListener(event,()=>{if(['#whats-new','#updates-admin'].includes(location.hash)){document.querySelector('#main').innerHTML=updatesPage(location.hash==='#updates-admin');loadUpdates(location.hash==='#updates-admin');}});

document.addEventListener('wardrobe:admin',()=>{if(location.hash==='#whats-new'){const link=document.querySelector('#updates-manage');if(link)link.innerHTML=isAccountAdmin()?`<p><a href="#updates-admin">${esc(t('Manage updates'))} ↗</a></p>`:'';}else if(location.hash==='#updates-admin'){document.querySelector('#main').innerHTML=updatesPage(true);loadUpdates(true);}});
