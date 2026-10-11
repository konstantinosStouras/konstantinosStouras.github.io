import {getAccountUser} from './auth.js?v=20261011-de-ru-v1';
import {getPhotos,savePhoto,removePhoto} from './account-data.js?v=20261011-de-ru-v1';
import {translateText} from './i18n.js?v=20261011-de-ru-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let loading=false,generation=0;
export const validPhoto=data=>typeof data==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data);
export function photosSection(){return `<section class="section"><h2>My reference photos</h2><p class="form-note">Add a clear face photo and full-body photos, up to 9 images. These are private: only you and Kostas, the WearWell administrator, can access them. With your permission below, he may review them with his AI assistant to improve your model and respond to feedback. They are never public catalog images.</p><label class="remember"><input id="photo-consent" type="checkbox"> I agree to this private review of my photos and measurements.</label><label class="field">Upload reference photos<input type="file" id="profile-photos" accept="image/png,image/jpeg" multiple></label><p class="caption">PNG or JPG · up to 10 MB each. Photos are resized for private review. Uploading does not generate a personal model automatically.</p><p id="photo-status" role="status" aria-live="polite"></p><div id="profile-photo-list" class="reference-photos"></div><button type="button" data-reload-photos>Refresh photos</button></section>`;}
function status(text){const el=document.querySelector('#photo-status');if(el)el.textContent=text;}
export async function refreshPhotos(){
 const uid=getAccountUser()?.uid,host=document.querySelector('#profile-photo-list'),v=++generation;if(!uid||!host)return;
 status('Loading photos…');
 try{const photos=await getPhotos(uid);if(v!==generation||getAccountUser()?.uid!==uid||!host.isConnected)return;
  host.innerHTML=photos.filter(p=>validPhoto(p.data)).map(p=>`<figure><a href="${p.data}" download="daywear-reference-${esc(p.id)}.jpg"><img src="${p.data}" alt="${esc('Private reference photo')}"></a><figcaption data-i18n-skip>${esc(p.name)}</figcaption><button type="button" data-delete-photo="${esc(p.id)}">Remove photo</button></figure>`).join('');status(photos.length?'Photos saved privately.':'No reference photos yet.');
 }catch{if(v===generation)status('Photos could not load. Please try again.');}
}
async function prepare(file){
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose PNG or JPG images, no larger than 10 MB each.');
 const image=await createImageBitmap(file);
 try{const canvas=document.createElement('canvas');let scale=Math.min(1,1800/Math.max(image.width,image.height));
  for(let i=0;i<8;i++){canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.84);if(data.length<=650000)return {name:file.name.slice(0,120),data};scale*=.8;}
  throw Error('This image is too large to send. Try a smaller screenshot.');
 }finally{image.close();}
}
document.addEventListener('change',async e=>{
 if(e.target.id!=='profile-photos'||loading)return;
 const input=e.target,files=Array.from(input.files),uid=getAccountUser()?.uid;
 if(!uid)return;if(!document.querySelector('#photo-consent')?.checked){status('Please agree to private review before uploading.');input.value='';return;}
 loading=true;input.disabled=true;status('Uploading photos…');
 try{const existing=await getPhotos(uid);if(files.length+existing.length>9)throw Error('You can save up to 9 reference photos. Remove a photo to add another.');
  const used=new Set(existing.map(p=>p.id));const slots=Array.from({length:9},(_,i)=>String(i+1)).filter(id=>!used.has(id));
  for(let i=0;i<files.length;i++){const photo=await prepare(files[i]);if(getAccountUser()?.uid!==uid)return;await savePhoto(uid,slots[i],photo);}
  if(getAccountUser()?.uid===uid)await refreshPhotos();
 }catch(error){if(getAccountUser()?.uid===uid)status(error.code?'Photos could not be saved. Please retry. Some photos may already be saved.':error.message);}
 finally{loading=false;input.value='';input.disabled=false;}
});
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-reload-photos]'))refreshPhotos();
 const button=e.target.closest('[data-delete-photo]'),uid=getAccountUser()?.uid;if(!button||!uid||loading)return;
 loading=true;button.disabled=true;
 try{await removePhoto(uid,button.dataset.deletePhoto);if(getAccountUser()?.uid===uid)await refreshPhotos();}catch{status('Could not remove the photo. Please retry.');}finally{loading=false;button.disabled=false;}
});
document.addEventListener('wardrobe:account',()=>{generation++;document.querySelector('#profile-photo-list')?.replaceChildren();});
