export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tones = {ā:'a1',á:'a2',ǎ:'a3',à:'a4',ē:'e1',é:'e2',ě:'e3',è:'e4',ī:'i1',í:'i2',ǐ:'i3',ì:'i4',ō:'o1',ó:'o2',ǒ:'o3',ò:'o4',ū:'u1',ú:'u2',ǔ:'u3',ù:'u4',ǖ:'v1',ǘ:'v2',ǚ:'v3',ǜ:'v4'};
export function normalizePinyin(value){
 return String(value).toLowerCase().normalize('NFC').replace(/u:/g,'v').replace(/ü/g,'v').split(/[\s'’\-]+/).map(s=>{
   let tone=''; let text='';
   for(const c of s){if(tones[c]){text+=tones[c][0];tone=tones[c][1];}else{text+=c;}}
   return tone?text.replace(/[1-5]/g,'')+tone:text.replace(/5$/,'');
 }).join('').replace(/[^a-z1-4]/g,'');
}
export function checkPinyin(input,expected){
 const a=normalizePinyin(input),b=normalizePinyin(expected);
 if(!a)return 'empty';
 if(a===b)return 'correct';
 if(a.replace(/[1-4]/g,'')===b.replace(/[1-4]/g,''))return 'tones';
 return 'retry';
}
export function shuffled(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
