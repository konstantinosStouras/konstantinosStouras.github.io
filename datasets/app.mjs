import {parseCatalog, filterEntries, plain} from './catalog.mjs';
import {mergeResearch} from './research.mjs';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const filterKeys=['topic','access','geo','type','unit','design','year','period','tool','feature','paper','tag','journal'];
const filters = Object.fromEntries(['q',...filterKeys,'view','sort'].map(k=>[k,params.get(k)||({view:'all',sort:'source'}[k]||'')]));
if (!['all','topics','saved','research'].includes(filters.view)) filters.view='all';
let entries=[], visible=[], saved=[], research={datasets:[],papers:{}};
try { saved=JSON.parse(localStorage.getItem('dataset-library-saved') || '[]'); if (!Array.isArray(saved)) saved=[]; } catch {}
const bookmark = '<svg viewBox="0 0 18 23" aria-hidden="true"><path d="M3 2h12v18l-6-4-6 4z"/></svg>';
function el(tag, className, text) { const node=document.createElement(tag); if(className) node.className=className; if(text) node.textContent=text; return node; }
function link(text,url) { const a=el('a','',text); a.href=url; a.target='_blank';a.rel='noopener noreferrer';return a; }
function appendMarkdown(node,text) {
  let cursor=0;
  for(const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {node.append(document.createTextNode(text.slice(cursor,m.index).replace(/[*`]/g,'')),link(plain(m[1]),m[2]));cursor=m.index+m[0].length;}
  node.append(document.createTextNode(text.slice(cursor).replace(/[*`]/g,'')));
}
function persist() {
  const query=new URLSearchParams();for(const [k,v] of Object.entries(filters))if(v && !(k==='view'&&v==='all') && !(k==='sort'&&v==='source'))query.set(k,v);
  history.replaceState(null,'',`${location.pathname}${query.size?'?'+query:''}${location.hash}`);
}
function reset() { for(const k of ['q',...filterKeys])filters[k]='';filters.view='all';syncControls();render(); }
function syncControls(){for(const id of ['q',...filterKeys,'sort']){const control=$(id==='q'?'query':id);if(control)control.value=filters[id];}}
function card(e) {
  const article=el('article','card'); article.id=e.id;
  const top=el('div','card-top'),topic=el('button','topic-badge',e.topic),save=el('button','save');
  topic.onclick=()=>{filters.topic=e.topic;filters.view='all';syncControls();render();};
  save.innerHTML=bookmark;save.setAttribute('aria-label',`${saved.includes(e.id)?'Unsave':'Save'} ${e.title}`);save.setAttribute('aria-pressed',String(saved.includes(e.id)));
  save.onclick=()=>{saved=saved.includes(e.id)?saved.filter(id=>id!==e.id):[...saved,e.id];try{localStorage.setItem('dataset-library-saved',JSON.stringify(saved));}catch{}render();};
  top.append(topic,save);article.append(top);
  const heading=el('h3');heading.append(e.url?link(e.title,e.url):document.createTextNode(e.title));article.append(heading);
  const description=e.description || (e.details.length ? plain(e.details.find(d=>!/^years:|^access:/i.test(d))||e.details[0]) : 'Explore source links and notes for this dataset collection.');
  article.append(el('p','description',description));
  const meta=el('div','metadata'); if(e.years)meta.append(el('span','',e.years));meta.append(el('span','',e.access==='Not specified'?'Access not specified':e.access));if(e.tools.length)meta.append(el('span','',e.tools.join(' · ')));article.append(meta);
  const bottom=el('div','card-bottom'),details=el('details'),summary=el('summary','',`Source notes${e.details.length?' ('+e.details.length+')':''}`),list=el('ul');
  const notes=e.descriptionMarkdown?.includes('](')?[e.descriptionMarkdown,...e.details]:e.details;
  for(const d of notes){const li=el('li');appendMarkdown(li,d);list.append(li);}
  if(!notes.length)list.append(el('li','','No additional notes in the source collection. Check the provider for availability and terms.'));
  if(e.research){
    article.append(el('p','date-added',`Added ${new Date(e.dateAdded+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} · source checked ${e.verifiedAt}`));
    const tags=el('div','research-tags');for(const tag of e.tags){const b=el('button','',tag);b.onclick=()=>{filters.tag=tag;filters.view='research';syncControls();render();};tags.append(b);}article.append(tags);
    const citations=el('section','paper-citations');citations.append(el('h4','','Used in published research'));
    for(const paper of e.papers){const citation=el('div','paper-citation');citation.append(link(paper.title,paper.url),el('p','',`${paper.authors} · ${paper.journal} ${paper.volume||''}${paper.issue?'('+paper.issue+')':''} (${paper.year})`),el('p','evidence-note',`Dataset use verified: ${paper.evidenceSection}.`));citations.append(citation);}article.append(citations);
  }
  details.append(summary,list);bottom.append(details);if(e.url)bottom.append(link('Explore data ↗',e.url));article.append(bottom);return article;
}
function render(){
  visible=filterEntries(entries,filters,saved).filter(e=>(filters.view!=='research'||e.research)&&(!filters.tag||e.tags?.includes(filters.tag))&&(!filters.journal||e.papers?.some(p=>p.journal===filters.journal)));
  if(filters.sort==='az')visible.sort((a,b)=>a.title.localeCompare(b.title));
  if(filters.sort==='topic')visible.sort((a,b)=>a.topic.localeCompare(b.topic)||a.title.localeCompare(b.title));
  if(filters.sort==='added')visible.sort((a,b)=>(b.dateAdded||'').localeCompare(a.dateAdded||'')||a.title.localeCompare(b.title));
  $('saved-count').textContent=saved.filter(id=>entries.some(e=>e.id===id)).length;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===filters.view);if(b.dataset.view===filters.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('results-title').textContent=filters.view==='research'?'Verified research additions':filters.view==='saved'?'Your saved datasets':filters.view==='topics'?'Follow your curiosity':filters.topic||'All datasets';
  $('results-count').textContent=`${visible.length} of ${entries.length} dataset collections${filters.view==='saved'?' · saved on this browser':''}`;
  $('section-label').textContent=filters.view==='topics'?'RESEARCH TOPICS':filters.view==='saved'?'YOUR RESEARCH SHELF':'THE COLLECTION';
  const chips=$('active-filters');chips.replaceChildren();
  for(const key of ['q',...filterKeys])if(filters[key]){const label=key==='paper'?(filters[key]==='yes'?'Linked research paper':'No linked paper'):key==='year'?'Coverage: '+filters[key]:filters[key];const b=el('button','',`${label} ×`);b.setAttribute('aria-label',`Remove ${key} filter: ${label}`);b.onclick=()=>{filters[key]='';syncControls();render();};chips.append(b);}
  $('cards').replaceChildren(...(filters.view==='topics'?[]:visible.map(card)));
  $('cards').hidden=filters.view==='topics';$('topic-grid').hidden=filters.view!=='topics';$('empty').hidden=visible.length>0;
  $('empty').querySelector('h3').textContent=filters.view==='saved'&&!saved.length?'Your research shelf is waiting':'No datasets found';
  $('empty').querySelector('p').textContent=filters.view==='saved'&&!saved.length?'Use the bookmark icon on a dataset to keep it here.':'Try a broader search or remove a filter.';
  if(filters.view==='topics'){
    const groups=Map.groupBy(visible,e=>e.topic);$('topic-grid').replaceChildren(...[...groups].map(([topic,rows])=>{const b=el('button','topic-tile');b.append(el('span','',topic),el('small','',`${rows.length} collections  ↗`));b.onclick=()=>{filters.topic=topic;filters.view='all';syncControls();render();};return b;}));
  }
  $('export').disabled=!visible.length;persist();
}
function load(text){
  const parsed=parseCatalog(text);if(parsed.length<50)throw new Error('Source collection is incomplete.');
  entries=mergeResearch(parsed,research);const topics=[...new Set(entries.map(e=>e.topic))];
  $('research-count').textContent=entries.filter(e=>e.research).length;
  for(const [id,values]of [['tag',[...new Set(research.datasets.flatMap(d=>d.tags))]],['journal',[...new Set(Object.values(research.papers).map(p=>p.journal))]]])$(id).replaceChildren(new Option('Any',''),...values.sort().map(v=>new Option(v,v)));
  $('total').textContent=entries.length;$('all-count').textContent=entries.length;$('topics-total').textContent=topics.length;
  $('topic').replaceChildren(new Option('All topics',''),...topics.sort().map(t=>new Option(t,t)));
  syncControls();render();
}
$('query').value=filters.q;
$('query').oninput=e=>{filters.q=e.target.value;render();};
const advanced=el('details','advanced-filters');const advSummary=el('summary','','More filters');advanced.append(advSummary);
const advancedFields=[['tag','Research interest',[]],['journal','Paper journal',[]],['type','Dataset type',['Survey','Census','Administrative records','Geospatial data','Research & publications','Not specified']],['unit','Unit of observation',['Individuals','Households','Places & geographic areas','Firms & institutions','Not specified']],['design','Study design',['Panel / longitudinal','Repeated cross-section','Full count / universe','Not specified']],['year','Covers the year',null],['period','Time coverage',['Ongoing','Historical / fixed period','Not specified']],['tool','API & software',['API','R','Stata','Not specified']],['feature','Data features',['Geocoded / spatial','Demographics','Income / earnings','Names / addresses','Text / transcripts','Employment','Not specified']],['paper','Linked research paper',[['yes','Has linked paper'],['no','No linked paper']]]];
for(const [id,title,options]of advancedFields){const label=el('label','',title);label.htmlFor=id;let input;if(id==='year'){input=el('input');input.type='number';input.min='1000';input.max=String(new Date().getFullYear());input.placeholder='e.g. 2010';}else{input=el('select');input.append(new Option('Any',''),...options.map(v=>Array.isArray(v)?new Option(v[1],v[0]):new Option(v,v)));}input.id=id;advanced.append(label,input);}
if(advancedFields.some(([id])=>filters[id]))advanced.open=true;
document.querySelector('.filters').insertBefore(advanced,document.querySelector('.filter-help'));
for(const id of [...filterKeys,'sort'])$(id).onchange=e=>{filters[id]=e.target.value;render();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{filters.view=b.dataset.view;render();});
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{filters.q=b.dataset.query;filters.view='all';syncControls();render();});
$('clear').onclick=reset;$('empty-reset').onclick=reset;
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('query').focus();}});
$('export').onclick=()=>{
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'").replaceAll('"','""')+'"';
  const csv=[['Dataset','Topic','Description','Years','Access','Geographic focus (inferred)','Source URL'],...visible.map(e=>[e.title,e.topic,e.description,e.years,e.access,e.geography,e.url])].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=el('a');a.href=url;a.download='dataset-library.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
try{const response=await fetch('research-additions.json',{cache:'no-cache'});if(!response.ok)throw new Error();research=await response.json();}catch{
  document.querySelector('.source-note').textContent='Research additions unavailable; showing the base collection.';
}
try{const fallback=await fetch('source.md');if(!fallback.ok)throw new Error();load(await fallback.text());$('source-status').textContent='Saved collection';}catch{$('source-status').textContent='Loading live source…';}
try{
  const response=await fetch('https://raw.githubusercontent.com/konstantinosStouras/datasets/main/README.md',{cache:'no-cache',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error();load(await response.text());$('source-status').textContent='✓ Live GitHub collection';
}catch{if(entries.length)$('source-status').textContent='Saved collection · live source unavailable';else{$('results-count').textContent='The collection could not load. Please refresh or browse it on GitHub.';$('source-status').textContent='Source unavailable';}}
