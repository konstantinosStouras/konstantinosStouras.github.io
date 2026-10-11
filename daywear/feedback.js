import {getAccountUser} from './auth.js?v=20261011-account-pages';
import {sendFeedback} from './account-data.js?v=20261011-account-pages';
import {translateText,getLanguage} from './i18n.js?v=20261011-account-pages';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let attachments=[],busy=false,uploading=false,attemptId=null,version=0;
export function feedbackPage(){
 const user=getAccountUser();
 return `<div class="page-head"><div><p class="eyebrow">HELP SHAPE DAYWEAR</p><h1>Send feedback</h1><p class="muted">Tell us what to improve.</p></div></div><section class="personal-card feedback-card"><p>Found something confusing, broken or missing? Tell us what you tried, what you expected and what happened. Short suggestions are welcome too.</p><form id="feedback-form"><label class="field">What should improve?<textarea name="message" rows="6" maxlength="6000" required aria-describedby="feedback-count"></textarea></label><p class="caption" id="feedback-count">0 / 6000</p><label class="field screenshot-drop" id="screenshot-drop">Add screenshots<span class="caption">Optional · up to 5 PNG or JPG images · 10 MB each</span><input id="feedback-files" type="file" accept="image/png,image/jpeg" multiple><span class="caption">Drop images here or choose files. Images are resized before sending.</span></label><div id="feedback-previews" class="feedback-previews"></div><div class="form-grid"><label class="field">Your name (optional)<input name="name" maxlength="80" autocomplete="name" value="${esc(user?.displayName||'')}"></label><label class="field">Reply email (your account)<input name="email" readonly type="email" maxlength="254" autocomplete="email" value="${esc(user?.email||'')}"></label></div><p class="form-note">Your message and screenshots are stored privately in Firebase for the DayWear team. Please remove personal or sensitive information from screenshots.</p>${user?'':'<p class="callout">Sign in to send feedback.</p><button type="button" data-open-signin>Sign in / Register</button>'}<p id="feedback-status" role="status" aria-live="polite"></p><button type="submit" class="primary" ${user?'':'disabled'}>Send feedback</button></form></section>`;
}
function status(text){const el=document.querySelector('#feedback-status');if(el)el.textContent=text;}
function previews(){const el=document.querySelector('#feedback-previews');if(el)el.innerHTML=attachments.map((a,i)=>`<figure><img src="${a.data}" alt="${esc('Screenshot preview')}"><figcaption data-i18n-skip>${esc(a.name)}</figcaption><button type="button" data-remove-screenshot="${i}" aria-label="${esc('Remove screenshot')}">×</button></figure>`).join('');}
export function resetFeedback(){version++;attachments=[];attemptId=null;busy=false;uploading=false;}
async function compress(file){
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose PNG or JPG images, no larger than 10 MB each.');
 const bitmap=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');let scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
  for(let i=0;i<7;i++){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const data=canvas.toDataURL('image/jpeg',.72);if(data.length<=140000)return {name:file.name.slice(0,120),data};scale*=.75;
  }
  throw Error('This image is too large to send. Try a smaller screenshot.');
 }finally{bitmap.close();}
}
async function addFiles(files){
 if(busy||uploading)return;
 if(attachments.length+files.length>5){status('You can attach up to 5 screenshots.');return;}
 const current=version;uploading=true;status('Preparing screenshots…');
 try{const next=await Promise.all(Array.from(files,compress));if(current===version){attachments.push(...next);attemptId=null;previews();status('Screenshots ready.');}}catch(error){if(current===version)status(error.message);}finally{if(current===version)uploading=false;}
}
document.addEventListener('change',e=>{if(e.target.id==='feedback-files'){addFiles(e.target.files);e.target.value='';}});
document.addEventListener('input',e=>{if(!e.target.closest('#feedback-form'))return;attemptId=null;if(e.target.name==='message')document.querySelector('#feedback-count').textContent=`${e.target.value.length} / 6000`;});
document.addEventListener('click',e=>{const button=e.target.closest('[data-remove-screenshot]');if(button&&!busy&&!uploading){attachments.splice(Number(button.dataset.removeScreenshot),1);attemptId=null;previews();}});
document.addEventListener('dragover',e=>{if(e.target.closest('#screenshot-drop'))e.preventDefault();});
document.addEventListener('drop',e=>{if(e.target.closest('#screenshot-drop')){e.preventDefault();addFiles(e.dataTransfer.files);}});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='feedback-form')return;e.preventDefault();if(busy)return;if(uploading){status('Please wait for the screenshots to finish.');return;}
 const form=e.target,data=new FormData(form),message=String(data.get('message')).trim();
 if(!message){status('Please describe your feedback.');return;}
 const user=getAccountUser();if(!user){status('Sign in to send feedback.');return;}
 const current=version;busy=true;attemptId ||= 'DW-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
 const payload={message,name:String(data.get('name')).trim(),language:getLanguage(),screenshots:JSON.stringify(attachments)};
 form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);status('Sending feedback…');
 try{
  const sentId=attemptId;await sendFeedback(payload,sentId);
  if(current!==version)return;
  form.reset();attachments=[];attemptId=null;previews();document.querySelector('#feedback-count').textContent='0 / 6000';status('Thank you. Your feedback has been sent. Ticket: '+sentId);
 }catch(error){if(current===version)status(error.code==='permission-denied'?'Feedback could not be sent. Wait one minute before trying again. Your message is still here.':'Could not send feedback. Check your connection and try again. Your message is still here.');}
 finally{if(current===version){busy=false;form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=false);}}
});
