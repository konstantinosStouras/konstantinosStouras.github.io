const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountIdentity(user,profileName=''){
 const name=String(profileName||user?.displayName||user?.email?.split('@')[0]||'Your account').trim().slice(0,50);
 const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>[...part][0]).join('').toUpperCase();
 let photo='';try{const url=new URL(user?.photoURL||'');if(url.protocol==='https:'&&!url.username&&!url.password)photo=url.href;}catch{}
 return {name,initials,photo};
}
export function accountButtonMarkup(user,profileName=''){
 if(!user)return 'Sign in / Register';
 const {name,initials,photo}=accountIdentity(user,profileName);
 return `<span class="account-avatar" aria-hidden="true"><span>${esc(initials)}</span>${photo?`<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" width="34" height="34">`:''}</span><span class="account-label"><strong>${esc(name)}</strong><small>My account</small></span>`;
}
