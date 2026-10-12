import feedbackCopy from './style-feedback-languages.js?v=20261012-photo-guidance-v1';
import es from './translations-es.js';
import fr from './translations-fr.js';
import pt from './translations-pt.js';
import ar from './translations-ar.js';
import zh from './translations-zh-Hans.js';
import yue from './translations-yue.js';
import de from './translations-de.js?v=20261012-photo-guidance-v1';
import ru from './translations-ru.js?v=20261012-photo-guidance-v1';
export const translations={de,ru,es,fr,pt,ar,'zh-Hans':zh,yue};
for(const [code,copy] of Object.entries(feedbackCopy))Object.assign(translations[code],copy);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const maps={};
for(const [code,copy] of Object.entries(translations)){
 const map=new Map(Object.entries(copy));
 for(const [source,value] of Object.entries(copy)){
  if(!map.has(source.toLowerCase()))map.set(source.toLowerCase(),value);
  if(!map.has(source.toUpperCase()))map.set(source.toUpperCase(),value);
 }
 const pattern=new RegExp('(?<![A-Za-z])(?:'+[...map.keys()].filter(k=>!k.includes('{')).sort((a,b)=>b.length-a.length).map(escape).join('|')+')(?![A-Za-z])','g');
 maps[code]={map,pattern};
}
const protectedTemplates=[
 [/^Your account: (.*)$/s,'Your account: {name}'],[/^Welcome, (.*)\.$/s,'Welcome, {name}.'],
 [/^Today in (.*)$/s,'Today in {name}'],[/^Travel city selected: (.*)$/s,'Travel city selected: {name}'],
 [/^Decision for (.*)$/s,'Decision for {name}'],[/^Remove (.*)$/s,'Remove {name}'],
 [/^Model reference brief for (.*)$/s,'Model reference brief for {name}'],
 [/^Appearance and fit notes: (.*)$/s,'Appearance and fit notes: {name}'],[/^Size (.*)$/s,'Size {name}']
];
export function translateOther(value,target){
 const text=String(value??''),data=maps[target];if(!data||!text.trim())return text;
 const core=text.trim(),leading=text.slice(0,text.indexOf(core)),trailing=text.slice(text.indexOf(core)+core.length),{map,pattern}=data;
 if(map.has(core))return leading+map.get(core)+trailing;
 const format=(key,values)=>Object.entries(values).reduce((out,[name,v])=>out.replaceAll('{'+name+'}',String(v)),map.get(key)||key);
 for(const [regex,key] of protectedTemplates){const match=core.match(regex);if(match)return leading+format(key,{name:match[1]})+trailing;}
 let result=text.replace(/Feels like ([\d.-]+)°C, so (summer|fall|winter|spring) is your temperature pool\./g,(_,temp,season)=>format('Feels like {temp}°C, so {season} is your temperature pool.',{temp,season:translateOther(season,target)}))
  .replace(/At ([\d.-]+)°C, add your (.*?)\.(?=\s|$)/g,(_,temp,piece)=>format('At {temp}°C, add your {piece}.',{temp,piece:translateOther(piece,target)}))
  .replace(/Please check your (.*?) measurement\./g,(_,field)=>format('Please check your {field} measurement.',{field:translateOther(field,target)}))
  .replace(/How to measure (.*?)(?=$|\n)/g,(_,field)=>format('How to measure {field}',{field:translateOther(field,target)}))
  .replace(/Custom (.*?)(?=$|\n)/g,(_,field)=>format('Custom {field}',{field:translateOther(field,target)}))
  .replace(/Works in (\d+) looks/g,(_,n)=>format('Works in {n} looks',{n}))
  .replace(/(\d+) \/ (\d+) ready/g,(_,n,total)=>format('{n} / {total} ready',{n,total}));
 for(const suffix of ['pieces under review','confirmed gaps','shared pieces','pieces','owned','to confirm'])result=result.replace(new RegExp('(\\d+) '+suffix+'\\b','g'),(_,n)=>format('{n} '+suffix,{n}));
 result=result.replace(/(\d+) looks?\b/gi,(_,n)=>format('{n} looks',{n}));
 return result.replace(pattern,key=>map.get(key));
}
