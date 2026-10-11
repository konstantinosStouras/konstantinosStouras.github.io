import {installWeatherRefresh} from './weather-refresh.js?v=20261011-de-ru-v1';
import {usersPage,loadUsers} from './admin-users.js?v=20261011-de-ru-v1';
import {updatesPage,loadUpdates} from './updates.js?v=20261011-de-ru-v1';
import {welcomePage} from './welcome.js?v=20261011-de-ru-v1';
import {headerWeather,currentWeatherCard} from './weather-view.js?v=20261011-de-ru-v1';
import {cleanRatings,cleanPieceFeedback,dislikeReasons} from './preferences.js?v=20261011-de-ru-v1';
import {lookFeedbackControls} from './style-feedback.js?v=20261011-de-ru-v1';
import {purchasePage,installPurchase,clearPurchase} from './purchase-ui.js?v=20261011-de-ru-v1';
import {loadCloudProfile,saveCloudProfile} from './account-data.js?v=20261011-de-ru-v1';
import {photosSection,refreshPhotos} from './profile-photos.js?v=20261011-de-ru-v1';
import {adminPage,loadAdmin,clearAdmin} from './review.js?v=20261011-de-ru-v1';
import {installLanguages,getLanguage,serviceLanguage,getLanguagePreference,applyLocationLanguage,translateText,translateBrief,searchKey} from './i18n.js?v=20261011-de-ru-v1';
import {installMeasurementGuides} from './measurement-guides.js?v=20261011-de-ru-v1';
import {createPrivateCatalog} from './private-models.js?v=20261011-de-ru-v1';
import {feedbackPage,resetFeedback} from './feedback.js?v=20261011-de-ru-v1';
import {getAccountToken,getAccountUser} from './auth.js?v=20261011-de-ru-v1';
import {hasPersonalModel,modelImageSource,modelCaption,modelFitNotes} from './model-policy.js?v=20261011-de-ru-v1';
import {profileFields,styleFields,readProfile,saveProfile,modelBrief} from './profile.js?v=20261011-de-ru-v1';
import {accountStorageKey} from './auth-policy.js?v=20261011-de-ru-v1';
import {profile,pieces,looks,pieceById,lookById,seasons,label} from './data.js?v=20261011-de-ru-v1';
import {fetchWeather,recommend,condition} from './weather.js?v=20261011-de-ru-v1';
import {detectLocation,detectApproximateLocation,locationPreference,rememberCity,locationError} from './location.js?v=20261011-de-ru-v1';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let key=accountStorageKey(null),accountUid=null,cloudStatus='idle',profileSaving=false;
async function syncProfile(){const uid=accountUid;if(!uid)return;cloudStatus='loading';if(route().split('/')[0]==='profile')renderedRoute='';render();try{const cloud=await loadCloudProfile(uid);if(accountUid!==uid)return;if(cloud){state.name=cloud.name;state.sizes=JSON.parse(cloud.sizes);persist();notifyProfile();}cloudStatus='ready';}catch{if(accountUid!==uid)return;cloudStatus='error';}if(route().split('/')[0]==='profile')renderedRoute='';render();}
const privateCatalog=createPrivateCatalog();let modelState='default',modelError='',modelRequest=0;
async function loadPersonalModel(){const uid=accountUid;if(!hasPersonalModel(uid))return;const request=++modelRequest;modelState='loading';modelError='';render();try{const loaded=await privateCatalog.load(uid,()=>getAccountToken(uid),looks.map(l=>l.id));if(request!==modelRequest||accountUid!==uid)return;if(loaded)modelState='ready';}catch(error){if(request!==modelRequest||accountUid!==uid)return;modelState='error';modelError=error.message;}render();}

let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
const state={name:typeof saved.name==='string'?saved.name:'Your',location:locationPreference(saved)==='travel'?saved.location:null,locationMode:locationPreference(saved),travelCities:Array.isArray(saved.travelCities)?saved.travelCities:(saved.location?[saved.location]:[]),locating:false,locationError:null,ownership:saved.ownership||{},checks:saved.checks||{},purge:Array.isArray(saved.purge)?saved.purge:[],ratings:cleanRatings(saved.ratings),pieceFeedback:cleanPieceFeedback(saved.pieceFeedback,cleanRatings(saved.ratings)),sizes:saved.sizes||{},mode:'everyday',filter:'All',search:'',season:'fall',offset:0,weather:null,weatherError:null,loading:false};
let cities=[],weatherRequest=0,locationRequest=0,controller;
function persist(){try{localStorage.setItem(key,JSON.stringify({name:state.name,location:state.locationMode==='travel'?state.location:null,locationMode:state.locationMode,travelCities:state.travelCities,ownership:state.ownership,checks:state.checks,purge:state.purge,sizes:state.sizes,ratings:state.ratings,pieceFeedback:state.pieceFeedback}));return true;}catch{toast('Your browser could not save changes. Export a backup in your profile.');return false;}}
function notifyProfile(){document.dispatchEvent(new CustomEvent('wardrobe:profile',{detail:{uid:accountUid,name:state.name}}));}
function profileFeedback(kind,text){const message=$('#profile-status'),button=$('#profile-form button[type=submit]');if(!message||!button)return;message.textContent=text;message.dataset.saved=kind==='saved'?'true':kind==='error'?'false':'';message.closest('.profile-save').dataset.feedback=kind;button.textContent=kind==='saved'?'✓ Saved':'Save profile';}
function profileEdited(e){if(!e.target.closest('#profile-form'))return;profileFeedback('dirty','Unsaved changes — select Save profile to keep them.');}
document.addEventListener('change',profileEdited);
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function route(){return location.hash.slice(1)||(accountUid?'today':'home');}
function status(id){return ['owned','buy'].includes(state.ownership[id])?state.ownership[id]:'review';}
function statusLabel(id){return {owned:'Owned',buy:'Buy',review:'To confirm'}[status(id)];}
function fit(p){const size=p.category==='Shoes'?state.sizes.shoe:p.category==='Bottoms'?[state.sizes.bottom,state.sizes.bottomSystem].filter(Boolean).join(' · '):['Tops','Layers'].includes(p.category)?state.sizes.top:'';return size?`${size} · ${p.fit}`:p.fit;}
function image(l,cls='look-photo'){const src=modelImageSource(l,accountUid,privateCatalog);if(!src)return `<div class="${cls} model-placeholder" role="img" aria-label="Private model ${modelState==='error'?'unavailable':'loading'}"><span>${modelState==='error'?'Your private model is unavailable.':'Loading your private model…'}</span></div>`;return `<img class="${cls}" src="${src}" alt="${hasPersonalModel(accountUid)?'Your photo-based AI model':'WearWell slim male catalog model'} wearing ${esc(l.name)}" loading="lazy" width="800" height="1200">`;}

function tags(l){return `<div class="tags"><span class="tag">${{summer:'warm',fall:'mild',winter:'cold',spring:'mild',gym:'training',lounge:'at home'}[l.season]}</span>${l.rain?'<span class="tag">rain-ready</span>':''}${l.layer?'<span class="tag">layered</span>':''}</div>`;}
function card(l){const owned=l.pieces.filter(id=>status(id)==='owned').length;return `<article class="card outfit-card"><a href="#look/${l.id}">${image(l)}<div class="row-between card-meta"><span>${label(l.season)} ${String(l.number).padStart(2,'0')}</span><span>${owned} / ${l.pieces.length} owned</span></div><h3>${l.name}</h3><p class="muted outfit-pieces">${l.pieces.map(id=>pieceById[id].name).join(' · ')}</p>${tags(l)}</a>${ratingControls(l,true)}</article>`;}
function head(eyebrow,title,aside=''){return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>${aside}</div>`;}
function currentDate(){return state.weather?.time?.slice(0,10)||new Date().toLocaleDateString('en-CA');}
function options(extra={}){const date=currentDate();return {mode:state.mode,month:Number(date.slice(5,7)),ratings:accountUid?state.ratings:{},pieceFeedback:accountUid?state.pieceFeedback:{},latitude:state.location?.latitude??51,day:Math.floor(Date.parse(date)/86400000),...extra};}
function checklist(l,extra=null){const ids=extra?[...l.pieces,extra]:l.pieces;return `<div class="checklist"><div class="row-between"><span>Wear this</span><span class="caption" id="ready-count">${ids.filter(id=>state.checks[`${currentDate()}:${l.id}:${id}`]).length} / ${ids.length} ready</span></div>${ids.map(id=>`<div class="piece-row"><input type="checkbox" id="check-${id}" data-check="${currentDate()}:${l.id}:${id}" ${state.checks[`${currentDate()}:${l.id}:${id}`]?'checked':''}><label for="check-${id}">${pieceById[id].name}<small>${id} · ${esc(fit(pieceById[id]))}</small></label><span class="status">${statusLabel(id)}</span></div>`).join('')}</div>`;}
function locationNotice(){if(state.location?.source==='approximate'&&!state.locationError)return '<div class="callout" role="status"><p>Using an approximate city from your internet connection.</p><p class="caption">Your browser did not share device location. VPNs and mobile networks can place you in another city.</p><button class="text-button" data-action="location">Correct city / travel ↗</button></div>';return state.locationError?'<div class="callout" role="status"><p>'+esc(state.locationError)+'</p><button class="text-button" data-action="location">Choose a city ↗</button></div>':'';}
function weatherStrip(){if(state.locating)return '<div class="weather" role="status"><div class="temperature">—<sup>°C</sup><small>FINDING YOUR LOCATION</small></div><div><p>Checking device location, then an approximate city if needed.</p><p class="caption">BigDataCloud resolves your city from device coordinates or, if unavailable, your internet connection. Open-Meteo receives city-level coordinates for weather.</p><button class="text-button" data-action="location">Choose a travel city instead ↗</button></div></div>';if(state.loading)return `<div class="weather"><div class="temperature">—<sup>°C</sup><small>FETCHING LIVE WEATHER</small></div><p>Checking today’s forecast…</p></div>`;
 if(!state.location)return `<div class="callout"><p>Make this morning yours.</p><p class="caption">Use your current location or choose a travel city for live weather and one matched look.</p><div class="actions"><button data-action="current-location">Use current location</button><button data-action="location">Choose a city ↗</button></div></div>`;
 if(!state.weather)return `<div class="callout" role="status"><p>Live weather is unavailable</p><p class="caption">${esc(state.weatherError||'Please refresh the forecast.')} Browse your collection while it reconnects.</p><button data-action="refresh">Try again</button></div>`;
 return currentWeatherCard(state.weather);}

function disclosure(){return `<details class="disclosure"><summary>About your fit, photographs & assumptions</summary><ul><li>${hasPersonalModel(accountUid)?'All outfits use your supplied photos as reference, with your requested slimmer face, smooth skin, dark hair and black beard. The body retains your agreed proportions.':'All outfits use WearWell’s slim male example model. Your profile measurements do not change these catalog images automatically.'}</li><li>AI likeness and garment fit can vary. Reference photos and actual body measurements guide future personal model updates.</li><li>The capsule uses navy, forest, ecru, charcoal, olive and tobacco. The suggested pieces begin as “To confirm”; no ownership or clothing size is assumed for new visitors.</li><li>Confirm garment measurements before buying. Your profile and measurements are private account data in Firebase. Checklists and purge plans stay in this browser. Export a backup from your profile to keep a copy.</li></ul></details>`;}
function today(){const title=state.location?`Today in ${esc(state.location.name)}`:'Today, considered.';const date=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:state.weather?.timezone||undefined}).format(new Date());let rec=state.weather?recommend(state.weather,options()):null;const l=rec?.look||lookById[state.mode==='everyday'?'fall-2':state.mode+'-1'];
 let swap='';if(rec){const rain=recommend({...state.weather,precip:1},options()),cool=recommend({...state.weather,temp:state.weather.temp-5},options());swap=`<div class="callout"><p class="eyebrow">${rec.wet?'IF IT DROPS 5°C':'IF RAIN STARTS'}</p><p class="caption">${state.mode==='everyday'?(rec.wet?`Switch within the collection to ${cool.look.name}.`:`${rain.look.id===l.id?'Keep':'Switch to'} ${rain.look.name}; a protective jacket and dark closed shoes cover the rain.`):(state.mode==='lounge'?'Your lounge uniform is intended for indoors.':'Keep the training uniform. Plan a dry journey to the gym.')} ${rec.layer?'The extra layer is already in your capsule.':''}</p><a href="#look/${rec.wet?cool.look.id:rain.look.id}" class="caption">View the look ↗</a></div>`;}
 return head(`<time data-local-date="${Date.now()}" data-date-format="full" data-time-zone="${esc(state.weather?.timezone||'')}" data-i18n-skip>${esc(date)}</time>`,title,`<div class="segments" aria-label="Day type">${['everyday','gym','lounge'].map(m=>`<button data-mode="${m}" aria-pressed="${state.mode===m}" class="${state.mode===m?'active-button':''}">${label(m)}</button>`).join('')}</div>`)+`<div class="row-between location-bar"><span class="caption">${state.locationMode==='travel'?'Travel city · '+esc(state.location?.name||''):(state.location?.source==='approximate'?'Approximate location · check the city is correct':'Current location · updates when you open the app')}</span><button class="text-button" data-action="location">Change city / travel ↗</button></div>`+locationNotice()+weatherStrip()+`<section class="hero"><div class="hero-photo">${image(l)}<span class="image-label">${label(l.season)} ${String(l.number).padStart(2,'0')}</span></div><div class="hero-copy"><p class="eyebrow">${rec?'YOUR LOOK FOR TODAY':'FROM YOUR COLLECTION'}</p><h2>${l.name}</h2>${tags(l)}<p class="rationale">${rec?rec.reason:'A considered starting point: strong blues, washed olive and easy layers. Set your city above to get a recommendation based on live weather.'}${rec?.layer?` At ${state.weather.temp.toFixed(1)}°C, add your ${pieceById[rec.layer].name.toLowerCase()}.`:''}</p>${ratingControls(l)}${checklist(l,rec?.layer)}<p class="caption">Your checkmarks and wardrobe choices stay on this device.</p>${swap}<div class="actions"><a class="button primary" href="#look/${l.id}">View full look</a><a class="button" href="#rotation">See rotation ↗</a></div></div></section><p class="caption" style="margin-top:15px">${modelCaption(accountUid)}</p><section class="section"><div class="page-head"><h2>Your collection</h2><a href="#pieces" class="caption">Explore the pieces</a></div><div class="grid">${seasons.map((s,i)=>`<article class="card"><a href="#${s}">${image(lookById[`${s}-${i===0?1:2}`])}<div class="row-between card-meta"><span>THE ${s.toUpperCase()} COLLECTION</span><span>07 LOOKS ↗</span></div><h3>${label(s)}</h3></a></article>`).join('')}</div></section>${disclosure()}`;
}
function collection(season){const pool=looks.filter(l=>l.season===season),count=new Set(pool.flatMap(l=>l.pieces)).size;return head(`THE ${season.toUpperCase()} COLLECTION`,label(season),`<span class="muted">${String(pool.length).padStart(2,'0')} looks · ${count} shared pieces</span>`)+(pool.length===1?`<p class="intro muted">One uniform. One less decision. ${season==='gym'?'Freedom through the shoulders, a comfortable rise and stable training shoes.':'Soft cotton, a generous fit and a quiet start to the day.'}</p>`:'')+`${collectionInvitation()}<div class="grid">${pool.map(card).join('')}</div><p class="caption" style="margin-top:28px">${modelCaption(accountUid)} Clothing and sizes remain proposals until confirmed.</p>`;}
function ownershipSelect(p){return `<select aria-label="Ownership of ${p.name}" data-own="${p.id}">${['review','owned','buy'].map(v=>`<option value="${v}" ${status(p.id)===v?'selected':''}>${{review:'To confirm',owned:'Owned',buy:'Buy'}[v]}</option>`).join('')}</select>`;}
function piecePage(){const filtered=pieces.filter(p=>(state.filter==='All'||state.filter===p.category||state.filter.toLowerCase()===status(p.id))&&(searchKey(p.name).includes(searchKey(state.search))||searchKey(translateText(p.name)).includes(searchKey(state.search))));return head('THE COMPLETE INVENTORY','The pieces',`<span class="muted">40 pieces · ${pieces.filter(p=>status(p.id)==='owned').length} owned · ${pieces.filter(p=>status(p.id)==='review').length} to confirm</span>`)+`<div class="filter-bar">${['All','Owned','Buy','Review','Tops','Bottoms','Layers','Shoes','Extras'].map(f=>`<button data-filter="${f}" class="${state.filter===f?'active-button':''}">${f==='Review'?'To confirm':f}</button>`).join('')}<input class="search" id="piece-search" placeholder="Find a piece…" aria-label="Find a piece" value="${esc(state.search)}"></div><div class="grid">${filtered.map(p=>{const ll=looks.filter(l=>l.pieces.includes(p.id)),l=ll[0];return `<article class="card outfit-card"><a href="#look/${l.id}">${image(l)}<div class="row-between card-meta"><span>${p.id} · ${p.category}</span><span>${statusLabel(p.id)}</span></div><h3>${p.name}</h3></a><p class="muted">${esc(fit(p))}</p><p class="caption">Shown in a full look · reused in ${ll.length} look${ll.length>1?'s':''}</p>${ownershipSelect(p)}</article>`;}).join('')}</div>${!filtered.length?'<div class="empty">No matching pieces. Try another filter or search.</div>':''}`;}
function rotation(){const start=new Date(currentDate()+'T12:00:00');start.setDate(start.getDate()-((start.getDay()+6)%7)+state.offset*28);const pool=looks.filter(l=>l.season===state.season);const now=currentDate();const fmt=d=>`<time data-local-date="${d.getTime()}" data-date-format="short" data-i18n-skip>${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(d)}</time>`;let cells='';for(let i=0;i<28;i++){const d=new Date(start);d.setDate(start.getDate()+i);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,isToday=iso===now;let l=pool[(i+Math.floor(i/7))%7];if(isToday&&state.weather)l=recommend(state.weather,options({mode:'everyday',season:state.season})).look;cells+=`<div class="calendar-day ${isToday?'today':''}"><div class="row-between"><span>${fmt(d)}</span>${isToday?'<span>Today</span>':''}</div><a href="#look/${l.id}">${image(l)}<span>${label(l.season)} 0${l.number}</span><strong>${l.name}</strong></a></div>`;}
 return head('A LITTLE PLANNING. EASIER MORNINGS.','The rotation',`<label>Season &nbsp; <select class="search" id="rotation-season">${seasons.map(s=>`<option ${state.season===s?'selected':''} value="${s}">${label(s)}</option>`).join('')}</select></label>`)+`<div class="calendar-controls"><button class="text-button" data-offset="-1">← Previous 4 weeks</button><span>${fmt(start)} ${start.getFullYear()}</span><button class="text-button" data-offset="1">Next 4 weeks →</button></div><div class="callout"><p>Good outfits, worth wearing again.</p><p class="caption">${state.weather?'Today’s weather may change the planned look within this selected season.':'Set your city for today’s live weather override.'} Future days are a rotation plan, not a weather forecast.</p></div><div class="calendar-scroll"><div class="calendar">${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d=>`<div class="weekday">${d}</div>`).join('')}${cells}</div></div>`;
}
function shopping(){const ranked=pieces.filter(p=>status(p.id)==='buy').map(p=>({...p,uses:looks.filter(l=>l.pieces.includes(p.id)).length})).sort((a,b)=>b.uses-a.uses||a.id.localeCompare(b.id));return '<div class="callout purchase-invitation"><div><p class="eyebrow">A MORE THOUGHTFUL PURCHASE</p><h2>Does it earn a place?</h2><p>Compare a clothing photo with the pieces you already own.</p></div><a class="button primary" href="#consider">Before you buy ↗</a></div>'+head('ONLY WHAT EARNS ITS PLACE','The shopping list',`<span class="muted">${ranked.length} confirmed gaps</span>`)+`<p class="intro muted">Ranked by how often each piece appears in the collection. Confirm what you already own in Pieces, then mark genuine gaps as Buy. Size, budget and product matches are yours to confirm.</p>`+(ranked.length?ranked.map((p,i)=>`<div class="shopping-row"><span class="rank">${String(i+1).padStart(2,'0')}</span>${image(looks.find(l=>l.pieces.includes(p.id)))}<div><h3>${p.name}</h3><p class="muted">Works in ${p.uses} looks · ${esc(fit(p))}</p><a class="caption" href="https://www.google.com/search?q=${encodeURIComponent('mens '+p.name+' tall broad chest')}" target="_blank" rel="noopener noreferrer">Search this piece ↗</a><p class="caption">Search link; availability and exact products unverified.</p></div>${ownershipSelect(p)}</div>`).join(''):`<div class="empty"><h2>Start with your own wardrobe.</h2><p>No purchases are assumed. Review the suggested pieces first.</p><a class="button primary" href="#pieces">Review your pieces</a></div>`);}
function purge(){return head('MAKE ROOM, THOUGHTFULLY','The edit',`<span class="muted">${state.purge.length} pieces under review</span>`)+`<p class="intro muted">Add items you already own that do not belong in your everyday wardrobe. Decide whether to sell, donate, recycle or keep reviewing. This list is a plan; it never disposes of anything.</p><form class="purge-form" id="purge-form"><input name="item" aria-label="Item to review" placeholder="e.g. The jacket I never reach for" required maxlength="100"><button class="primary">Add to review</button></form><ul class="purge-list">${state.purge.map(p=>`<li><span data-i18n-skip>${esc(p.name)}</span><select data-purge="${esc(p.id)}" aria-label="Decision for ${esc(p.name)}">${['Review','Sell','Donate','Recycle','Trash'].map(d=>`<option value="${d}" ${p.decision===d?'selected':''}>${d}</option>`).join('')}</select><button data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></li>`).join('')}</ul>${!state.purge.length?'<div class="empty"><p>Your review list is empty. Keep what fits, works and earns its place.</p><p class="caption">No closet photos were provided, so nothing has been assigned for removal.</p></div>':''}`;}
let renderedRoute='',renderedAccount;
function wardrobeToolbar(r){
 const pieceView=['pieces','purge'].includes(r);
 return `<div class="wardrobe-toolbar"><div class="wardrobe-tabs" aria-label="Wardrobe sections"><a href="#wardrobe" ${!pieceView?'aria-current="page"':''}>Looks</a><a href="#pieces" ${pieceView?'aria-current="page"':''}>Pieces</a></div>${pieceView?`<a class="caption" href="#${r==='purge'?'pieces':'purge'}">${r==='purge'?'← Back to pieces':'Review unused clothes ↗'}</a>`:`<label class="collection-picker">Collection<select id="collection-select">${[['wardrobe','All outfits'],...seasons.map(s=>[s,label(s)]),['gym','Gym'],['lounge','Lounge']].map(([value,text])=>`<option value="${value}" ${r===value?'selected':''}>${text}</option>`).join('')}</select></label>`}</div>`;
}
function collectionInvitation(){return accountUid?'':`<aside class="collection-invitation"><div><h2>Make these ideas your own.</h2><p>Sign in to save your likes and refine your recommendations.</p></div><button class="button primary" data-style-signin>Sign in</button></aside>`;}
function wardrobe(){return head('MORE WAYS TO WEAR WHAT YOU OWN','Your wardrobe')+'<p class="intro muted">Find a look for the season, or review the pieces you own.</p>'+collectionInvitation()+`<div class="grid">${looks.map(card).join('')}</div>`;}
function render(){
 const r=route().split('/')[0];
 const feedbackView=$('#main').dataset.feedbackRoute===route()&&renderedAccount===accountUid?captureFeedbackView():null;
 const keepAccount=['profile','feedback','review','users','whats-new','updates-admin'].includes(r)&&r===renderedRoute&&renderedAccount===accountUid&&$('#main').children.length;
 if(renderedRoute==='feedback'&&r!=='feedback')resetFeedback();
 const keepPurchase=r==='consider'&&renderedRoute===r&&renderedAccount===accountUid;
 if(renderedRoute==='consider'&&!keepPurchase)clearPurchase();
 renderedRoute=r;renderedAccount=accountUid;
 $('#brand').textContent='WearWell';document.title='WearWell — Your personal wardrobe';
 const wardrobeRoutes=['wardrobe',...seasons,'gym','lounge','pieces','purge','look'];
 const active=r==='whats-new'?'whats-new':r==='updates-admin'?'whats-new':wardrobeRoutes.includes(r)?'wardrobe':['shopping','consider'].includes(r)?'shopping':r==='rotation'?'rotation':r==='home'||!accountUid?'home':'today';
 $('#brand').closest('a').href=accountUid?'#today':'#home';
 $('#header-weather').innerHTML=headerWeather(state);
 $('#nav').innerHTML=[[accountUid?'today':'home',accountUid?'Today':'Discover'],['wardrobe','Wardrobe'],['rotation','Calendar'],['shopping','Shopping'],['whats-new',"What's new"]].map(([id,text])=>`<a href="#${id}" ${active===id?'class="active" aria-current="page"':''}>${text}</a>`).join('');
 if(keepPurchase||keepAccount)return;
 const page=r==='users'?usersPage():r==='whats-new'?updatesPage():r==='updates-admin'?updatesPage(true):r==='profile'?profilePage():r==='feedback'?feedbackPage():r==='review'?adminPage():r==='home'?welcomePage():r==='consider'?'<a class="section-back" href="#shopping">← Back to shopping</a>'+purchasePage(accountUid):r==='wardrobe'?wardrobe():r==='pieces'?piecePage():r==='rotation'?rotation():r==='shopping'?shopping():r==='purge'?purge():[...seasons,'gym','lounge'].includes(r)?collection(r):r==='look'?lookPage(route().split('/')[1]):today();
 $('#main').classList.toggle('welcome-page',r==='home');
 $('#main').innerHTML=(wardrobeRoutes.includes(r)&&r!=='look'?wardrobeToolbar(r):'')+page;
 $('#main').dataset.feedbackRoute=route();restoreFeedbackView(feedbackView);
 if(!['home','profile','feedback','review','whats-new','updates-admin','users'].includes(r)&&hasPersonalModel(accountUid)&&modelState!=='ready')$('#main').insertAdjacentHTML('afterbegin',`<div class="callout" role="status"><p>${modelState==='error'?esc(modelError):'Loading your private collection securely…'}</p>${modelState==='error'?'<button data-action="retry-model">Try again</button>':''}</div>`);
 if(r==='users')loadUsers();
 if(['whats-new','updates-admin'].includes(r))loadUpdates(r==='updates-admin');
 if(r==='profile'&&cloudStatus==='ready')refreshPhotos();if(r==='review')loadAdmin();
}

function lookPage(id){const l=lookById[id];if(!l)return head('THE COLLECTION','Look not found')+'<a href="#today">Return to today</a>';return head(`${label(l.season)} ${String(l.number).padStart(2,'0')}`,l.name,`<a href="#${l.season}" class="caption">← ${label(l.season)} collection</a>`)+`<section class="hero"><div class="hero-photo">${image(l)}</div><div class="hero-copy">${tags(l)}<p class="rationale"${state.sizes.bodyNotes?' data-i18n-skip':''}>${esc(modelFitNotes(accountUid,state.sizes))}</p>${ratingControls(l)}${checklist(l)}<p class="caption">Fit is a visual study. Check your actual measurements before buying.</p><div class="actions"><a class="button primary" href="#pieces">Review ownership</a><a class="button" href="#shopping">Shopping list ↗</a></div></div></section>${disclosure()}`;}
function settings(){location.hash='profile';}
function deleteSection(){const password=getAccountUser()?.providerData.some(p=>p.providerId==='password');return `<section class="danger-zone section"><h3>Delete account</h3><p class="form-note">Permanently deletes your sign-in account, cloud profile, uploaded reference photos, submitted feedback and screenshots, and wardrobe preferences in this browser. Exported backups and data on other devices are not removed. Private model source files are not deleted by this action.</p><details><summary>Delete account</summary><form id="delete-account-form"><label class="field">Type DELETE to confirm<input id="delete-confirmation" name="confirmation" autocomplete="off" spellcheck="false" required pattern="DELETE"></label>${password?'<label class="field">Current password<input name="password" type="password" autocomplete="current-password" required></label>':'<p class="form-note">Confirm your identity with Google to continue.</p>'}<p role="status" aria-live="polite"></p><button id="delete-permanently" type="submit" disabled>Delete permanently</button></form></details></section>`;}
function profilePage(){if(accountUid&&cloudStatus!=='ready')return head('MAKE IT YOURS','My Profile')+'<div class="empty"><p>'+(cloudStatus==='error'?'Your saved profile could not load. Please retry before editing.':'Loading your saved profile…')+'</p>'+(cloudStatus==='error'?'<button data-action="retry-profile">Try again</button>':'')+'</div>';if(!accountUid)return head('MAKE IT YOURS','My Profile')+'<div class="empty"><p>Sign in to edit your personal profile.</p><button type="button" data-open-signin>Sign in / Register</button></div>';return `${head('MAKE IT YOURS','My Profile')}<div class="profile-layout"><aside class="profile-aside"><p class="eyebrow">YOUR PERSONAL COLLECTION</p><p>One place for your sizes, style and everyday needs.</p><p class="form-note">Your profile and reference photos are saved privately to your account. Your wardrobe checklist and ownership choices still stay in this browser.</p><a href="#feedback">Send feedback ↗</a></aside><div class="personal-card"><p class="eyebrow">Account email</p><p data-i18n-skip>${esc(getAccountUser()?.email)}</p><button type="button" class="text-button" data-open-signin>Manage sign-in & verify email</button><form id="profile-form"><p class="form-note">During this test, Kostas and his AI assistant can review your saved measurements and style notes to improve WearWell and respond to your feedback. Save only details you want to share for this purpose.</p><label class="field">Your name<input name="name" maxlength="50" value="${esc(state.name)}" required></label>${styleFields(state.sizes)}${profileFields(state.sizes)}</form><section class="section"><h3>Current location & travel</h3><button type="button" data-action="location">Change city / travel ↗</button></section><section class="section"><h3>Your model brief</h3><p class="form-note">Your saved sizes, optional measurements and appearance notes, ready to use with your reference photos.</p><textarea id="model-brief" aria-label="Saved model brief" class="model-brief" rows="7" readonly>${esc(modelBrief(state.name,state.sizes))}</textarea><button type="button" data-action="model-brief">Download model brief</button><h3 style="margin-top:24px">Current catalog reference</h3><p class="form-note"${state.sizes.bodyNotes?' data-i18n-skip':''}>${esc(modelFitNotes(accountUid,state.sizes))}</p><p class="form-note">${modelCaption(accountUid)}</p></section><section class="section"><h3>Your private data</h3><p class="form-note">Your profile, measurements, reference photos and feedback are saved privately in Firebase. Only you and the WearWell administrator can access them. Ownership choices, checklists and purge plans stay in this browser, separately for each account. Private images are cleared from the page when you sign out. BigDataCloud receives city-level device coordinates for the city name, or uses your internet connection for an approximate city when device location is unavailable. Open-Meteo receives city-level coordinates for weather. Device coordinates are not saved; travel cities stay in this browser.</p><div class="actions"><button data-action="export">Export backup</button><label class="button">Import backup<input type="file" id="import" accept="application/json" hidden></label></div></section>${photosSection()}${deleteSection()}</div></div>`;}

function locationControls(){return `<h3>Current location & travel</h3><p class="caption">${state.locationMode==='travel'?'Travel city selected: '+esc(state.location?.name):'Current location is your default.'}</p><button class="primary" data-action="current-location">Use current location</button><p class="caption">Allow browser location access for a more accurate result. If it is blocked or unavailable, we try an approximate city automatically. BigDataCloud resolves your city from device coordinates or, if unavailable, your internet connection. Open-Meteo receives city-level coordinates for weather.</p>${state.locationError?'<p role="status">'+esc(state.locationError)+'</p>':''}<h3 style="margin-top:24px">Choose a city / travel</h3><p class="caption">Search any city, then select the right result. Its local weather stays selected until you switch back. This shows today’s weather, not a forecast for a future trip.</p><form id="city-form" class="purge-form"><input name="city" placeholder="Search a city, e.g. Paris" minlength="2" required aria-label="City name"><button>Find city</button></form><div id="city-results" aria-live="polite"></div>${state.travelCities.length?'<p class="eyebrow">RECENT TRAVEL CITIES</p>'+state.travelCities.map((c,i)=>'<button class="city-result" data-travel="'+i+'">'+esc([c.name,c.admin1,c.country].filter(Boolean).join(' · '))+'</button>').join(''):''}`;}
function locationSettings(){ $('#modal-body').innerHTML='<p class="eyebrow">DRESS FOR WHERE YOU ARE</p><h2>Your weather location</h2>'+locationControls();if(!$('#modal').open)$('#modal').showModal(); }
function chooseTravel(city){if(!city)return;++locationRequest;state.locating=false;state.locationError=null;state.locationMode='travel';state.location=city;state.travelCities=rememberCity(state.travelCities,city);persist();$('#modal').close();refresh();}
async function useCurrentLocation(){const request=++locationRequest;++weatherRequest;controller?.abort();state.loading=false;state.locating=true;state.locationError=null;state.locationMode='current';state.location=null;state.weather=null;persist();$('#modal').close();render();try{const place=await detectLocation();if(request!==locationRequest)return;state.location=place;applyLocationLanguage(place);state.locating=false;persist();await refresh();}catch(error){if(request!==locationRequest)return;state.locating=false;state.locationError=error.code?locationError(error):error.message;applyLocationLanguage(null);render();}}
function renderWeatherUpdate(){
 // Background weather must not replace forms, search fields or open checklists.
 // Keep the outfit being reviewed in place while feedback has focus; readings
 // continue to update, and the next ordinary render applies the new ranking.
 if(route().split('/')[0]==='today'&&document.activeElement?.closest('[data-feedback-look]')){
  $('#header-weather').innerHTML=headerWeather(state);
  const card=$('.weather-card');if(card)card.outerHTML=weatherStrip();
  return;
 }
 if(route().split('/')[0]==='today')render();
 else $('#header-weather').innerHTML=headerWeather(state);
}
async function refresh({background=false}={}){
 if(!state.location||background&&(state.loading||state.locating))return;
 weatherRefresh.markRequested();
 const request=++weatherRequest;controller?.abort();controller=new AbortController();
 const activeController=controller,signal=activeController.signal;
 if(!background)state.weather=null;
 state.loading=true;state.weatherError=null;
 if(!background)render();
 const timeout=setTimeout(()=>activeController.abort(),15000);
 try{const w=await fetchWeather(state.location,signal);if(request===weatherRequest)state.weather=w;}
 catch(e){if(request===weatherRequest){state.weather=null;state.weatherError=e.name==='AbortError'?'The request timed out. Please try again.':e.message;}}
 finally{clearTimeout(timeout);if(request===weatherRequest){state.loading=false;if(background)renderWeatherUpdate();else render();}}
}
const weatherRefresh=installWeatherRefresh({refresh:()=>refresh({background:true}),canRefresh:()=>!!state.location&&!state.loading&&!state.locating});

document.addEventListener('click',e=>{const el=e.target.closest('button,a');if(!el)return;const d=el.dataset;if(d.startRegister!==undefined)document.dispatchEvent(new CustomEvent('wardrobe:open-auth',{detail:{view:'register'}}));if(d.action==='retry-profile')syncProfile();if(d.action==='retry-model')loadPersonalModel();if(d.action==='settings')settings();if(d.action==='location')locationSettings();if(d.action==='current-location')useCurrentLocation();if(d.travel!==undefined)chooseTravel(state.travelCities[Number(d.travel)]);if(d.action==='close')$('#modal').close();if(d.action==='refresh'){if(state.location)refresh();else useCurrentLocation();}if(d.mode){state.mode=d.mode;render();}if(d.filter){state.filter=d.filter;render();}if(d.offset){state.offset+=Number(d.offset);render();}if(d.city!==undefined)chooseTravel(cities[Number(d.city)]);if(d.remove){state.purge=state.purge.filter(p=>p.id!==d.remove);persist();render();}if(d.action==='model-brief'){const blob=new Blob([translateBrief(modelBrief(state.name,state.sizes))],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='daywear-model-brief.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}if(d.action==='export'){const blob=new Blob([JSON.stringify({version:1,name:state.name,location:state.locationMode==='travel'?state.location:null,locationMode:state.locationMode,travelCities:state.travelCities,ownership:state.ownership,checks:state.checks,purge:state.purge,sizes:state.sizes,ratings:state.ratings,pieceFeedback:state.pieceFeedback},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='wardrobe-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
document.addEventListener('change',async e=>{const el=e.target,d=el.dataset;if(el.id==='collection-select'){location.hash=el.value;return;}if(el.matches('[data-size-select]')){const custom=el.closest('div').querySelector('[data-custom-for]');custom.hidden=el.value!=='__custom';custom.querySelector('input').disabled=custom.hidden;custom.querySelector('input').required=!custom.hidden;}if(d.check){state.checks[d.check]=el.checked;persist();const checks=[...document.querySelectorAll('[data-check]')];$('#ready-count').textContent=`${checks.filter(x=>x.checked).length} / ${checks.length} ready`;}if(d.own){state.ownership[d.own]=el.value;persist();render();toast('Wardrobe updated');}if(el.id==='rotation-season'){state.season=el.value;render();}if(d.purge){state.purge.find(p=>p.id===d.purge).decision=el.value;persist();}if(el.id==='import'&&el.files[0]){try{if(el.files[0].size>1000000)throw Error();const data=JSON.parse(await el.files[0].text());if(data.version!==1||typeof data.name!=='string'||!data.ownership||!Array.isArray(data.purge))throw Error();const loc=data.location;if(loc&&(!Number.isFinite(loc.latitude)||!Number.isFinite(loc.longitude)||Math.abs(loc.latitude)>90||Math.abs(loc.longitude)>180||typeof loc.name!=='string'))throw Error();++locationRequest;state.locating=false;state.locationError=null;state.name=data.name.slice(0,50);state.locationMode=locationPreference(data);state.location=state.locationMode==='travel'?loc:null;state.travelCities=(Array.isArray(data.travelCities)?data.travelCities:(loc?[loc]:[])).filter(c=>c&&typeof c.name==='string'&&Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)&&Math.abs(c.latitude)<=90&&Math.abs(c.longitude)<=180).slice(0,8);state.ownership=Object.fromEntries(pieces.map(p=>[p.id,['buy','owned'].includes(data.ownership[p.id])?data.ownership[p.id]:'review']));state.checks=data.checks&&typeof data.checks==='object'?data.checks:{};state.purge=data.purge.filter(p=>typeof p.name==='string'&&typeof p.id==='string').slice(0,500);state.sizes=data.sizes||{};state.ratings=cleanRatings(data.ratings);state.pieceFeedback=cleanPieceFeedback(data.pieceFeedback,state.ratings);clearPurchase();renderedRoute='';state.weather=null;persist();$('#modal').close();render();if(state.locationMode==='current')useCurrentLocation();else refresh();renderedRoute='';render();notifyProfile();toast('Backup restored');}catch{toast('That file is not a valid wardrobe backup.');}}});
document.addEventListener('input',e=>{profileEdited(e);if(e.target.id==='piece-search'){const start=e.target.selectionStart;state.search=e.target.value;render();$('#piece-search').focus();$('#piece-search').setSelectionRange(start,start);}});
document.addEventListener('submit',async e=>{const form=e.target;if(!['city-form','profile-form','purge-form'].includes(form.id))return;e.preventDefault();const data=new FormData(form);if(form.id==='profile-form'){
 if(profileSaving||!accountUid||cloudStatus!=='ready')return;
 const uid=accountUid,button=form.querySelector('button[type=submit]');profileSaving=true;button.disabled=true;profileFeedback('saving','Saving profile…');
 try{const next=readProfile(data);next.name=next.name||'Your';await saveCloudProfile(uid,next);if(accountUid!==uid)return;
  const local=saveProfile(state,next,persist);if(!local)Object.assign(state,next);notifyProfile();
  profileFeedback('saved',local?'Profile saved privately to your account.':'Profile saved to your account, but this browser could not keep a local copy.');
  $('#model-brief').value=modelBrief(state.name,state.sizes);
 }catch(error){if(accountUid===uid)profileFeedback('error',error.code?'Your profile could not be saved. Your entries are still here; please retry.':error.message);}
 finally{profileSaving=false;button.disabled=false;}
}if(form.id==='purge-form'){state.purge.push({id:crypto.randomUUID(),name:String(data.get('item')).trim(),decision:'Review'});persist();render();}if(form.id==='city-form'){const result=$('#city-results'),button=form.querySelector('button');button.disabled=true;result.textContent='Finding your city…';try{const res=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(data.get('city'))}&count=6&language=${serviceLanguage()}&format=json`,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error();const json=await res.json();cities=(json.results||[]).map(c=>({name:c.name,country:c.country||'',latitude:c.latitude,longitude:c.longitude,timezone:c.timezone||'auto',admin1:c.admin1||''}));result.innerHTML=cities.length?cities.map((c,i)=>`<button class="city-result" data-city="${i}">${esc(c.name)} · ${esc(c.admin1)} · ${esc(c.country)}</button>`).join(''):'No cities found. Try a nearby town or a different spelling.';}catch{result.textContent='City search is unavailable. Please try again.';}finally{button.disabled=false;}}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);$('#main').focus({preventScroll:true});});
render();if(state.locationMode==='current')useCurrentLocation();else refresh();




// Switch storage namespaces before accepting any wardrobe edits after an account change.
document.addEventListener('wardrobe:account',event=>{
 const {uid,name}=event.detail;
 resetFeedback();clearAdmin();
 if(uid===accountUid){if(uid&&name&&state.name==='Your'){state.name=name;persist();render();}notifyProfile();return;}
 ++locationRequest;++weatherRequest;controller?.abort();
 ++modelRequest;privateCatalog.clear();modelState=hasPersonalModel(uid)?'loading':'default';modelError='';
 clearPurchase();accountUid=uid;if(uid&&location.hash==='#home')location.hash='today';if(!uid)location.hash='home';key=accountStorageKey(uid);
 let data={};try{data=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
 Object.assign(state,{name:typeof data.name==='string'?data.name:(uid?(name||'Your'):'Your'),locationMode:locationPreference(data),location:locationPreference(data)==='travel'?data.location:null,travelCities:Array.isArray(data.travelCities)?data.travelCities:[],ownership:data.ownership||{},checks:data.checks||{},purge:Array.isArray(data.purge)?data.purge:[],ratings:cleanRatings(data.ratings),pieceFeedback:cleanPieceFeedback(data.pieceFeedback,cleanRatings(data.ratings)),sizes:data.sizes||{},mode:'everyday',filter:'All',search:'',offset:0,weather:null,weatherError:null,locationError:null,locating:false,loading:false});
 cloudStatus=uid?'loading':'idle';notifyProfile();$('#modal').close();render();if(uid)syncProfile();if(hasPersonalModel(uid))loadPersonalModel();
 if(state.locationMode==='travel')refresh();else useCurrentLocation();
});


function ratingControls(l,compact=false){if(compact&&!accountUid)return '';return lookFeedbackControls(l,{uid:accountUid,ratings:state.ratings,pieceFeedback:state.pieceFeedback},compact);}
function feedbackSelector(el){
 if(!el?.closest('[data-feedback-look]'))return null;
 return ['data-rate','data-piece-rate','data-value','data-piece-reason','data-look','data-piece'].filter(name=>el.hasAttribute(name)).map(name=>'['+name+'="'+el.getAttribute(name)+'"]').join('')||null;
}
function captureFeedbackView(){
 return {focus:feedbackSelector(document.activeElement),open:[...document.querySelectorAll('.reason-dropdown[open]')].map(details=>({selector:feedbackSelector(details.querySelector('input')),scroll:details.querySelector('.reason-options').scrollTop}))};
}
function restoreFeedbackView(view){
 if(!view)return;
 view.open.forEach(({selector,scroll})=>{const details=document.querySelector(selector)?.closest('details');if(details){details.open=true;details.querySelector('.reason-options').scrollTop=scroll;}});
 if(view.focus)document.querySelector(view.focus)?.focus({preventScroll:true});
}
function refreshRatingControls(id,focusSelector){
 const view=captureFeedbackView();
 document.querySelectorAll('[data-feedback-look="'+id+'"]').forEach(container=>{
  const compact=container.classList.contains('compact');
  const wrapper=document.createElement('div');wrapper.innerHTML=ratingControls(lookById[id],compact);
  container.replaceWith(wrapper.firstElementChild);
 });
 restoreFeedbackView(view);
 if(focusSelector)document.querySelector(focusSelector)?.focus({preventScroll:true});
}
document.addEventListener('click',event=>{
 if(event.target.closest('[data-style-signin]'))$('#account-button').click();
 const button=event.target.closest('[data-rate],[data-piece-rate]');
 if(!button||!accountUid)return;
 const id=button.dataset.rate||button.dataset.look,value=Number(button.dataset.value),piece=button.dataset.pieceRate;
 if(!lookById[id]||![1,-1].includes(value))return;
 if(piece&&(!lookById[id].pieces.includes(piece)||state.ratings[id]!==-1))return;
 const previousRatings={...state.ratings},previousFeedback=structuredClone(state.pieceFeedback);
 if(piece){
  const entries=state.pieceFeedback[id]||={};
  if(entries[piece]?.rating===value)delete entries[piece];else entries[piece]={rating:value,reasons:[]};
 }else{
  if(state.ratings[id]===value)delete state.ratings[id];else state.ratings[id]=value;
  delete state.pieceFeedback[id];
 }
 state.pieceFeedback=cleanPieceFeedback(state.pieceFeedback,state.ratings);
 if(!persist()){state.ratings=previousRatings;state.pieceFeedback=previousFeedback;return;}
 const selector=piece?'[data-piece-rate="'+piece+'"][data-look="'+id+'"][data-value="'+value+'"]':'[data-rate="'+id+'"][data-value="'+value+'"]';
 refreshRatingControls(id,selector);
 toast(piece?'Piece feedback saved.':state.ratings[id]?'Preference saved. It will shape your next recommendation.':'Preference removed.');
});
document.addEventListener('change',event=>{
 const input=event.target.closest('[data-piece-reason]');if(!input||!accountUid)return;
 const {look:id,piece,pieceReason:reason}=input.dataset,entry=state.pieceFeedback[id]?.[piece];
 if(state.ratings[id]!==-1||entry?.rating!==-1||!dislikeReasons.some(([key])=>key===reason))return;
 const previous=[...entry.reasons];
 entry.reasons=input.checked?[...new Set([...previous,reason])]:previous.filter(value=>value!==reason);
 if(!persist()){entry.reasons=previous;input.checked=previous.includes(reason);return;}
 document.querySelectorAll('[data-piece-reason][data-look="'+id+'"][data-piece="'+piece+'"]').forEach(el=>{
  el.checked=entry.reasons.includes(el.dataset.pieceReason);
  el.closest('details').querySelector('[data-reason-count]').textContent=entry.reasons.length;
 });
 toast('Piece feedback saved.');
});
installPurchase({uid:()=>accountUid,ownership:()=>state.ownership,image});

installMeasurementGuides();

installLanguages();

let languageLocationPending=false;
async function detectLanguageLocation(){
 if(getLanguagePreference()!=='auto'||languageLocationPending)return;
 if(state.locationMode==='current'&&state.location){applyLocationLanguage(state.location);return;}
 if(state.locating)return;
 languageLocationPending=true;
 try{applyLocationLanguage(await detectApproximateLocation());}catch{applyLocationLanguage(null);}finally{languageLocationPending=false;}
}
document.addEventListener('wardrobe:automatic-language',detectLanguageLocation);
if(state.locationMode==='travel')detectLanguageLocation();
