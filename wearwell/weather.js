import {preferenceScore} from './preferences.js?v=20261022-admin-v1';
import {looks} from './data.js?v=20261022-admin-v1';
export function seasonPool(temp,month,latitude=51){
 if(!Number.isFinite(temp))throw new Error('A valid apparent temperature is required');
 const m=latitude<0?(month+5)%12+1:month;
 if(temp>=20)return 'summer';
 if(temp<8)return 'winter';
 if(temp<15)return 'fall';
 return m>=1&&m<=7?'spring':'fall';
}
export function recommend(weather,{mode='everyday',month=10,latitude=51,day=0,season,ratings={},pieceFeedback={}}={}){
 const pool=mode==='everyday'?(season||seasonPool(weather.temp,month,latitude)):mode;
 const candidates=looks.filter(l=>l.season===pool);
 if(!candidates.length)throw new Error('Unknown look pool');
 const wet=weather.precip>0||weather.dailyPrecip>=1;
 if(mode!=='everyday')return {look:candidates[0],wet,layer:weather.temp<=10?(mode==='gym'?'P24':'P33'):null,reason:mode==='gym'?'Your one training uniform.':'Your one indoor lounge uniform.'};
 const eligible=wet?candidates.filter(l=>l.rain):candidates;
 const score=l=>(weather.wind>=25&&l.layer?8:0)+(weather.temp>=8&&weather.temp<15&&l.midlayer?5:0)+(!wet&&!l.rain?1:0);
 const ranked=[...(eligible.length?eligible:candidates)].sort((a,b)=>score(b)-score(a));
 const weatherBest=ranked.filter(l=>score(l)===score(ranked[0]));
 const preferred=[...weatherBest].sort((a,b)=>preferenceScore(b,ratings,pieceFeedback)-preferenceScore(a,ratings,pieceFeedback));
 const best=preferred.filter(l=>Math.abs(preferenceScore(l,ratings,pieceFeedback)-preferenceScore(preferred[0],ratings,pieceFeedback))<0.000001);
 const look=best[((day%best.length)+best.length)%best.length];
 return {look,wet,layer:null,reason:`Feels like ${weather.temp.toFixed(1)}°C, so ${pool} is your temperature pool. ${wet?'Rain calls for a protective jacket and dark closed shoes. ':''}${weather.wind>=25?'A layer covers the wind. ':''}${weather.temp>=8&&weather.temp<15?'A mid-layer gets preference in cooler weather. ':''}A complete look from your collection.`};
}
export function condition(code){if(code===0)return 'Clear sky';if(code===1)return 'Mainly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';if([45,48].includes(code))return 'Fog';if([51,53,55,56,57].includes(code))return 'Drizzle';if([61,63,65,66,67].includes(code))return 'Rain';if([71,73,75,77].includes(code))return 'Snow';if([80,81,82].includes(code))return 'Rain showers';if([85,86].includes(code))return 'Snow showers';if([95,96,99].includes(code))return 'Thunderstorms';return 'Conditions unavailable';}
export async function fetchWeather(location,signal){
 const query=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,timezone:location.timezone||'auto',current:'temperature_2m,relative_humidity_2m,is_day,apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min,precipitation_sum',forecast_days:'1'});
 const response=await fetch(`https://api.open-meteo.com/v1/forecast?${query}`,{signal,cache:'no-store'});
 if(!response.ok)throw new Error('The weather service is unavailable. Please try again.');
 const d=await response.json(),c=d.current;
 if(!c||![c.apparent_temperature,c.precipitation,c.wind_speed_10m,c.weather_code,d.daily?.temperature_2m_max?.[0],d.daily?.temperature_2m_min?.[0],d.daily?.precipitation_sum?.[0]].every(Number.isFinite)||typeof c.time!=='string')throw new Error('The weather service returned incomplete data.');
 return {temp:c.apparent_temperature,airTemp:Number.isFinite(c.temperature_2m)?c.temperature_2m:null,humidity:Number.isFinite(c.relative_humidity_2m)&&c.relative_humidity_2m>=0&&c.relative_humidity_2m<=100?c.relative_humidity_2m:null,isDay:[0,1].includes(c.is_day)?c.is_day===1:null,precip:c.precipitation,wind:c.wind_speed_10m,code:c.weather_code,dailyPrecip:d.daily.precipitation_sum[0],high:d.daily.temperature_2m_max[0],low:d.daily.temperature_2m_min[0],time:c.time,timezone:d.timezone,received:Date.now()};
}
