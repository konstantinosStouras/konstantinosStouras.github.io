import {greek} from './translations-el.js?v=20261009-public-languages';
const preferenceKey='daywear.language';
let language='en';
try{if(globalThis.localStorage?.getItem(preferenceKey)==='el')language='el';}catch{}
export const getLanguage=()=>language;
export const locale=()=>language==='el'?'el-GR':'en-GB';
const dictionary=new Map();
for(const [en,el] of Object.entries(greek)){
 dictionary.set(en,el);
 if(!dictionary.has(en.toLowerCase()))dictionary.set(en.toLowerCase(),el.toLocaleLowerCase('el-GR'));
 if(!dictionary.has(en.toUpperCase()))dictionary.set(en.toUpperCase(),el.toLocaleUpperCase('el-GR'));
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const phrasePattern=new RegExp('(?<![A-Za-z])(?:'+[...dictionary.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|')+')(?![A-Za-z])','g');
const seasonAdjectives={summer:'καλοκαιρινά',fall:'φθινοπωρινά',winter:'χειμερινά',spring:'ανοιξιάτικα'};
export function translateText(value,target=language){
 const text=String(value??'');if(target!=='el'||!text.trim())return text;
 const core=text.trim(),leading=text.slice(0,text.indexOf(core)),trailing=text.slice(text.indexOf(core)+core.length);
 if(dictionary.has(core))return leading+dictionary.get(core)+trailing;
 // Preserve interpolated personal names and city names verbatim.
 let match=core.match(/^Your account: (.*)$/s);if(match)return leading+'Ο λογαριασμός σου: '+match[1]+trailing;
 match=core.match(/^Welcome, (.*)\.$/s);if(match)return leading+'Καλώς ήρθες, '+match[1]+'.'+trailing;
 match=core.match(/^Today in (.*)$/s);if(match)return leading+'Σήμερα στην πόλη: '+match[1]+trailing;
 match=core.match(/^Travel city selected: (.*)$/s);if(match)return leading+'Επιλεγμένη πόλη ταξιδιού: '+match[1]+trailing;
 match=core.match(/^Decision for (.*)$/s);if(match)return leading+'Απόφαση για '+match[1]+trailing;
 match=core.match(/^Remove (.*)$/s);if(match)return leading+'Αφαίρεση '+match[1]+trailing;
 match=core.match(/^Model reference brief for (.*)$/s);if(match)return leading+'Οδηγίες αναφοράς μοντέλου για '+match[1]+trailing;
 match=core.match(/^Appearance and fit notes: (.*)$/s);if(match)return leading+'Σημειώσεις εμφάνισης και εφαρμογής: '+match[1]+trailing;
 match=core.match(/^← (Summer|Fall|Winter|Spring|Gym|Lounge) collection$/);if(match)return leading+'← Συλλογή: '+translateText(match[1],'el')+trailing;
 match=core.match(/^✓ Profile saved at ([\d:]+)\. Your sizes and measurements are saved in this browser(?: for (.*))?\.$/s);
 if(match)return leading+`✓ Το προφίλ αποθηκεύτηκε στις ${match[1]}. Τα μεγέθη και οι μετρήσεις αποθηκεύτηκαν σε αυτόν τον περιηγητή${match[2]?' για '+match[2]:''}.`+trailing;
 let result=text
  .replace(/Feels like ([\d.-]+)°C, so (summer|fall|winter|spring) is your temperature pool\./g,(_,temp,season)=>`Η αισθητή θερμοκρασία είναι ${temp}°C, οπότε επιλέγουμε ${seasonAdjectives[season]} σύνολα.`)
  .replace(/At ([\d.-]+)°C, add your /g,(_,temp)=>`Στους ${temp}°C, πρόσθεσε: `)
  .replace(/Please check your (.*?) measurement\./g,(_,field)=>`Έλεγξε τη μέτρηση: ${translateText(field,'el')}.`)
  .replace(/(\d+) pieces under review/g,'$1 κομμάτια προς έλεγχο')
  .replace(/(\d+) confirmed gaps/g,'$1 επιβεβαιωμένες ελλείψεις')
  .replace(/(\d+) shared pieces/g,'$1 κοινά κομμάτια')
  .replace(/Works in (\d+) looks/g,'Χρησιμοποιείται σε $1 σύνολα')
  .replace(/(\d+) look(?:s)?\b/gi,'$1 σύνολα')
  .replace(/(\d+) pieces\b/g,'$1 κομμάτια')
  .replace(/(\d+) owned\b/g,'$1 ήδη διαθέσιμα')
  .replace(/(\d+) to confirm\b/g,'$1 προς επιβεβαίωση')
  .replace(/(\d+) \/ (\d+) ready/g,'$1 / $2 έτοιμα')
  .replace(/OF 30/g,'ΑΠΟ 30')
  .replace(/How to measure /g,'Οδηγός μέτρησης: ')
  .replace(/Custom (.*?)(?=$|\n)/g,(_,field)=>'Δικό σου '+translateText(field,'el'));
 return result.replace(phrasePattern,en=>dictionary.get(en));
}

export function translateBrief(text,target=language){
 const lines=String(text).split('\n');
 const notesStart=lines.findIndex(line=>line.startsWith('Appearance and fit notes: '));
 return lines.map((line,i)=>{
  if(notesStart>=0&&i>notesStart&&i<lines.length-1)return line;
  if(/^(Top size|Trouser size|Shoe size): /.test(line)){const at=line.indexOf(': ');return translateText(line.slice(0,at+1),target)+line.slice(at+1);}
  return translateText(line,target);
 }).join('\n');
}
export const searchKey=value=>String(value).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();

// Translate UI text without rebuilding forms or changing stored values. Keep original
// English text per node so switching back is lossless, including async weather/auth updates.
export function installLanguages(){
 const originals=new WeakMap(),attributeOriginals=new WeakMap();
 const ignored='script,style,textarea,input,[data-i18n-skip],.account-avatar,.account-label strong';
 let scheduled=false;
 const updateText=node=>{
  if(!node.parentElement||node.parentElement.closest(ignored))return;
  let record=originals.get(node);if(!record||node.data!==record.output)record={source:node.data,output:node.data};
  const output=translateText(record.source);record.output=output;originals.set(node,record);if(node.data!==output)node.data=output;
 };
 const updateAttribute=(el,name)=>{
  let records=attributeOriginals.get(el);if(!records){records={};attributeOriginals.set(el,records);}
  const current=el.getAttribute(name);if(current===null)return;
  let record=records[name];if(!record||current!==record.output)record={source:current,output:current};
  record.output=translateText(record.source);records[name]=record;if(current!==record.output)el.setAttribute(name,record.output);
 };
 const refresh=()=>{
  scheduled=false;document.documentElement.lang=language;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))updateText(node);
  document.querySelectorAll('[aria-label],[placeholder],[title],[alt]').forEach(el=>{
   if(el.closest('[data-i18n-skip]'))return;
   for(const attr of ['aria-label','placeholder','title','alt'])updateAttribute(el,attr);
  });
  document.title=language==='el'?'Daywear — Η προσωπική σου γκαρνταρόμπα':'Daywear — Your personal wardrobe';
  document.querySelector('meta[name=description]')?.setAttribute('content',language==='el'?'Τριάντα προσεγμένα σύνολα. Μία προσωπική γκαρνταρόμπα. Ντύσου για την ημέρα με τον τρέχοντα καιρό και μια απλή εναλλαγή.':'Thirty considered looks. One personal wardrobe. Dress for the day with live weather, a shared capsule and a simple rotation.');
  document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)));
  // Only this generated, readonly preview is localized; editable user notes stay untouched.
  const brief=document.querySelector('#model-brief');if(brief&&brief.readOnly){let record=originals.get(brief);if(!record||brief.value!==record.output)record={source:brief.value,output:brief.value};record.output=translateBrief(record.source);originals.set(brief,record);if(brief.value!==record.output)brief.value=record.output;}
 };
 const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(refresh);}};
 const switchLanguage=value=>{
  if(!['en','el'].includes(value))return;language=value;try{localStorage.setItem(preferenceKey,language);}catch{}
  refresh();document.dispatchEvent(new CustomEvent('wardrobe:language',{detail:{language}}));
 };
 document.addEventListener('click',event=>{const button=event.target.closest('[data-language]');if(button)switchLanguage(button.dataset.language);});
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title','alt']});
 document.addEventListener('wardrobe:profile',schedule);
 refresh();
}
