import {getAccountUser,isAccountAdmin} from './auth.js?v=20261011-de-ru-v1';
import {database,loadCloudProfile,getPhotos} from './account-data.js?v=20261011-de-ru-v1';
import {validPhoto} from './profile-photos.js?v=20261011-de-ru-v1';
import {measurements} from './profile.js?v=20261011-de-ru-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0,records=[],profiles=[],active=null;
export function clearAdmin(){generation++;records=[];profiles=[];active=null;document.querySelector('#review-detail')?.replaceChildren();}
export function adminPage(){return `<div class="page-head"><div><p class="eyebrow">PRIVATE TESTING</p><h1>Tester feedback</h1><p class="muted">Profiles, reference photos and feedback in one private inbox.</p></div></div><section id="review-inbox"><p role="status">Checking access…</p></section><section id="review-detail"></section>`;}
const time=value=>value?.toDate?.().toLocaleString()||'';
function profileDetails(sizes){const rows=[['Top size',sizes.top],['Trouser size',sizes.bottom],['Trouser sizing system',sizes.bottomSystem],['Shoe size',sizes.shoe],...measurements.map(([key,title,unit])=>[title,sizes.measurements?.[key]===undefined?'':sizes.measurements[key]+' '+unit]),['Face, body & fit notes (optional)',sizes.bodyNotes],...[['city','Home city'],['work','Work dress code'],['weekend','Weekend activities'],['style','My style'],['fit','Preferred fit'],['colors','Colours I like'],['avoid','Colours or clothes I avoid'],['budget','Shopping budget and currency'],['constraints','Practical needs and constraints']].map(([key,title])=>[title,sizes.preferences?.[key]])];return '<dl class="profile-details">'+rows.filter(([,value])=>value!==undefined&&value!=='').map(([title,value])=>`<div><dt>${title}</dt><dd data-i18n-skip>${esc(value)}</dd></div>`).join('')+'</dl>';}
export async function loadAdmin(){
 const host=document.querySelector('#review-inbox'),current=++generation;if(!host)return;
 if(!getAccountUser()||!isAccountAdmin()){host.innerHTML='<p>Only the WearWell administrator can open this page.</p>';return;}
 host.innerHTML='<p role="status">Loading private feedback…</p>';
 try{const {s,db}=await database();const [tickets,people]=await Promise.all([s.getDocsFromServer(s.query(s.collection(db,'daywearFeedback'),s.orderBy('createdAt','desc'),s.limit(100))),s.getDocsFromServer(s.query(s.collection(db,'daywearProfiles'),s.limit(100)))]);
  if(current!==generation||!isAccountAdmin()||!host.isConnected)return;
  records=tickets.docs.map(d=>({id:d.id,...d.data()}));profiles=people.docs.map(d=>({uid:d.id,...d.data()}));
  host.innerHTML=`<div class="actions"><button data-refresh-review>Refresh inbox</button></div><p class="form-note">Showing the latest 100 tickets and up to 100 tester profiles.</p><div class="review-grid"><div><h2>Feedback inbox</h2>${records.length?records.map(t=>`<button class="review-ticket" data-review-ticket="${esc(t.id)}"><strong data-i18n-skip>${esc(t.id)}</strong><span data-i18n-skip>${esc(t.name||t.email)}</span><small>${esc(t.status)} · <span data-i18n-skip>${esc(time(t.createdAt))}</span></small><p data-i18n-skip>${esc(t.message.slice(0,150))}</p></button>`).join(''):'<p>No feedback yet.</p>'}</div><div><h2>Tester profiles</h2>${profiles.map(p=>`<button class="review-ticket" data-review-profile="${esc(p.uid)}"><strong data-i18n-skip>${esc(p.name)}</strong><small>View measurements & photos</small></button>`).join('')||'<p>No saved profiles yet.</p>'}</div></div>`;
 }catch{if(current===generation)host.innerHTML='<p role="status">The inbox could not load. Please retry.</p><button data-refresh-review>Try again</button>';}
}
async function showProfile(uid,container){
 const current=generation;
 container.innerHTML='<p>Loading private profile…</p>';
 try{const [profile,photos]=await Promise.all([loadCloudProfile(uid),getPhotos(uid)]);if(current!==generation||!isAccountAdmin()||!container.isConnected)return;
  const sizes=profile?JSON.parse(profile.sizes):{};
  container.innerHTML=`<h2 data-i18n-skip>${esc(profile?.name||'')}</h2>${profile?`<h3>Saved measurements & style</h3>${profileDetails(sizes)}`:'<p>This tester has not saved a cloud profile.</p>'}<div class="reference-photos">${photos.filter(p=>validPhoto(p.data)).map(p=>`<figure><a href="${p.data}" download="daywear-reference-${esc(p.id)}.jpg"><img src="${p.data}" alt="Private reference photo"></a><figcaption data-i18n-skip>${esc(p.name)}</figcaption></figure>`).join('')}</div>`;
 }catch{if(current===generation)container.innerHTML='<p>Private profile could not load. Please retry.</p>';}
}
function showTicket(id){
 const ticket=records.find(t=>t.id===id),host=document.querySelector('#review-detail');if(!ticket||!host||!isAccountAdmin())return;active=id;
 let shots=[];try{shots=JSON.parse(ticket.screenshots||'[]');if(!Array.isArray(shots))shots=[];}catch{}
 host.innerHTML=`<article class="personal-card section"><p class="eyebrow" data-i18n-skip>${esc(ticket.id)}</p><h2 data-i18n-skip>${esc(ticket.name||ticket.email)}</h2><p data-i18n-skip>${esc(ticket.email)}</p><p class="feedback-message" data-i18n-skip>${esc(ticket.message)}</p><div class="reference-photos">${shots.filter(a=>a&&validPhoto(a.data)).map((a,i)=>`<figure><a href="${a.data}" download="feedback-${i+1}.jpg"><img src="${a.data}" alt="Screenshot preview"></a></figure>`).join('')}</div><form id="review-reply-form"><label class="field">Ticket status<select name="status">${['open','in-progress','resolved'].map(v=>`<option value="${v}" ${ticket.status===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="field">Reply draft<textarea name="replyDraft" rows="6" maxlength="6000">${esc(ticket.replyDraft||'')}</textarea></label><p class="form-note">Save the draft here, then ask your assistant to send the approved reply from kstouras@gmail.com. Saving a draft does not send an email.</p><p class="form-note">Email delivery: <span data-i18n-skip>${esc(ticket.replySentAt?time(ticket.replySentAt):'Not sent')}</span></p><p id="review-save-status" role="status"></p><button type="submit" class="primary">Save review & reply draft</button></form><section class="section" id="review-profile"></section></article>`;
 showProfile(ticket.uid,host.querySelector('#review-profile'));host.scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('click',event=>{
 if(event.target.closest('[data-refresh-review]'))loadAdmin();
 const ticket=event.target.closest('[data-review-ticket]');if(ticket)showTicket(ticket.dataset.reviewTicket);
 const person=event.target.closest('[data-review-profile]');if(person&&isAccountAdmin()){const host=document.querySelector('#review-detail');host.innerHTML='<article class="personal-card section" id="review-profile"></article>';showProfile(person.dataset.reviewProfile,host.firstElementChild);host.scrollIntoView({behavior:'smooth'});}
});
document.addEventListener('submit',async event=>{
 if(event.target.id!=='review-reply-form')return;event.preventDefault();if(!isAccountAdmin()||!active)return;
 const form=event.target,data=new FormData(form),id=active,message=form.querySelector('#review-save-status'),button=form.querySelector('button');button.disabled=true;message.textContent='Saving review…';
 try{const {s,db}=await database();const update={status:String(data.get('status')),replyDraft:String(data.get('replyDraft')).trim(),reviewedAt:s.serverTimestamp()};await s.updateDoc(s.doc(db,'daywearFeedback',id),update);Object.assign(records.find(t=>t.id===id),update);message.textContent='Review saved. No email has been sent.';}catch{message.textContent='Review could not be saved. Please retry.';}finally{button.disabled=false;}
});
document.addEventListener('wardrobe:admin',()=>{if(location.hash==='#review')loadAdmin();});
