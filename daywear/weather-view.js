import {condition} from './weather.js?v=20261011-piece-feedback-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(value)?Math.round(value):'—';

// WMO conditions control the illustration; is_day comes from the weather API.
export function weatherArt(code,isDay,wind=0){
 const known=[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(code);
 if(!known)return '<svg class="weather-art" viewBox="0 0 96 80" aria-hidden="true"><circle cx="48" cy="38" r="25" fill="#edf0eb"/><path d="M36 38h24" stroke="#99a29a" stroke-width="3" stroke-linecap="round"/></svg>';
 const rain=[51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code),snow=[71,73,75,77,85,86].includes(code),storm=code>=95,fog=[45,48].includes(code);
 const cloud=code>=2,clear=code<=2;
 const sun='<g fill="#f4bd54" stroke="#eeb348" stroke-width="3" stroke-linecap="round"><circle cx="38" cy="31" r="17" stroke="none"/><path d="M38 6v-4M38 56v4M13 31H9M63 31h4M20 13l-3-3M56 49l3 3M56 13l3-3M20 49l-3 3"/></g>';
 const moon='<path d="M51 9a25 25 0 1 0 10 40A27 27 0 0 1 51 9" fill="#83aada"/><path d="m70 13 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="#b5c7dc"/>';
 return `<svg class="weather-art" viewBox="0 0 96 80" aria-hidden="true">${clear?(isDay===false?moon:isDay===true?sun:'<circle cx="38" cy="31" r="18" fill="#e3e8eb"/>'):''}${cloud?`<path d="M25 55a15 15 0 0 1 1-30 23 23 0 0 1 43 5 14 14 0 1 1 7 25z" fill="${storm?'#9aabb8':'#dce5e9'}"/><path d="M25 55h51a14 14 0 0 0 12-6H16a15 15 0 0 0 9 6" fill="${storm?'#859ba8':'#cbd8de'}"/>`:''}${rain?'<path d="m32 63-4 8m22-8-4 8m22-8-4 8" stroke="#719ebe" stroke-width="4" stroke-linecap="round"/>':''}${snow?'<g fill="#87a8bd"><circle cx="30" cy="65" r="3"/><circle cx="47" cy="72" r="3"/><circle cx="65" cy="64" r="3"/></g>':''}${storm?'<path d="m47 48-9 17h10l-4 13 20-23H52l5-7z" fill="#e7b545"/>':''}${fog?'<path d="M17 63h60M25 70h44" stroke="#acbabd" stroke-width="3" stroke-linecap="round"/>':''}${wind>=25?'<path d="M7 60h13m-8 7h9" stroke="#799ca4" stroke-width="2.5" stroke-linecap="round"/>':''}</svg>`;
}

export function headerWeather(state){
 const w=state.weather;
 const city=`<button class="weather-city" data-action="location" title="Change city / travel" aria-label="Change city / travel"><span data-i18n-skip>${esc(state.location?.name||'')}</span>${state.location?' ↗':'Choose a city ↗'}</button>`;
 const locationLabel=state.location?.source==='approximate'?'<span class="weather-location-note">Approximate location</span>':state.locationMode==='travel'?'<span class="weather-location-note">Travel city</span>':'';
 if(!w){const message=state.locating?'Finding your location…':state.loading?'Updating weather…':'Weather unavailable';return `<div class="weather-mini-icon">${weatherArt(null)}</div><div class="weather-mini-copy">${city}<span class="weather-mini-condition">${message}</span>${locationLabel}</div>${!state.locating&&!state.loading?'<button class="text-button weather-retry" data-action="refresh">Retry</button>':''}`;}
 return `<div class="weather-mini-icon">${weatherArt(w.code,w.isDay,w.wind)}</div><div class="weather-mini-copy"><div class="weather-mini-top">${city}<strong class="weather-mini-temp">${number(w.airTemp)}<span>°C</span></strong></div><div class="weather-mini-condition">${condition(w.code)}${locationLabel}</div><div class="weather-mini-metrics"><span>Wind <strong>${number(w.wind)} <span>km/h</span></strong></span><span>Humidity <strong>${number(w.humidity)}%</strong></span></div></div>`;
}

export function currentWeatherCard(w){
 return `<section class="weather-card" aria-label="Current weather"><div class="weather-current">${weatherArt(w.code,w.isDay,w.wind)}<div class="weather-degrees">${number(w.airTemp)}<span>°C</span></div><div class="weather-description"><h3>${condition(w.code)}</h3><p><span>Feels like</span> ${w.temp.toFixed(1)}°C</p><p class="caption"><span>High</span> ${number(w.high)}° · <span>Low</span> ${number(w.low)}°</p></div></div><dl class="weather-details"><div><dt>Wind</dt><dd>${number(w.wind)} <small>km/h</small></dd></div><div><dt>Humidity</dt><dd>${number(w.humidity)}<small>%</small></dd></div><div><dt>Rain today</dt><dd>${w.dailyPrecip.toFixed(1)} <small>mm</small></dd></div></dl><div class="weather-card-footer"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer"><span class="live-dot"></span>Live · Open-Meteo</a><span>${esc(w.time.slice(11,16))} <span data-i18n-skip>${esc(w.timezone)}</span></span><button class="text-button" data-action="refresh">Refresh</button></div></section>`;
}
