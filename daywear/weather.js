import {looks} from './data.js?v=20261009-account-ui';
export function seasonPool(temp,month,latitude=51){
 if(!Number.isFinite(temp))throw new Error('A valid apparent temperature is required');
 const m=latitude<0?(month+5)%12+1:month;
 if(temp>=20)return 'summer';
 if(temp<8)return 'winter';
 if(temp<15)return 'fall';
 return m>=1&&m<=7?'spring':'fall';
}
export function recommend(weather,{mode='everyday',month=10,latitude=51,day=0,season}={}){
 const pool=mode==='everyday'?(season||seasonPool(weather.temp,month,latitude)):mode;
 const candidates=looks.filter(l=>l.season===pool);
 if(!candidates.length)throw new Error('Unknown look pool');
 const wet=weather.precip>0||weather.dailyPrecip>=1;
 if(mode!=='everyday')return {look:candidates[0],wet,layer:weather.temp<=10?(mode==='gym'?'P24':'P33'):null,reason:mode==='gym'?'Your one training uniform.':'Your one indoor lounge uniform.'};
 const eligible=wet?candidates.filter(l=>l.rain):candidates;
 const score=l=>(weather.wind>=25&&l.layer?8:0)+(weather.temp>=8&&weather.temp<15&&l.midlayer?5:0)+(!wet&&!l.rain?1:0);
 const ranked=[...(eligible.length?eligible:candidates)].sort((a,b)=>score(b)-score(a));
 const best=ranked.filter(l=>score(l)===score(ranked[0]));
 const look=best[((day%best.length)+best.length)%best.length];
 return {look,wet,layer:null,reason:`Feels like ${weather.temp.toFixed(1)}°C, so ${pool} is your temperature pool. ${wet?'Rain calls for a protective jacket and dark closed shoes. ':''}${weather.wind>=25?'A layer covers the wind. ':''}${weather.temp>=8&&weather.temp<15?'A mid-layer gets preference in cooler weather. ':''}A complete look from your existing thirty.`};
}
export function condition(code){if(code===0)return 'Clear sky';if(code<=3)return 'Partly cloudy';if(code<=48)return 'Fog';if(code<=57)return 'Drizzle';if(code<=67)return 'Rain';if(code<=77)return 'Snow';if(code<=82)return 'Rain showers';if(code<=86)return 'Snow showers';if(code>=95)return 'Thunderstorms';return 'Conditions unavailable';}
export async function fetchWeather(location,signal){
 const query=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,timezone:location.timezone||'auto',current:'apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min,precipitation_sum',forecast_days:'1'});
 const response=await fetch(`https://api.open-meteo.com/v1/forecast?${query}`,{signal});
 if(!response.ok)throw new Error('The weather service is unavailable. Please try again.');
 const d=await response.json(),c=d.current;
 if(!c||![c.apparent_temperature,c.precipitation,c.wind_speed_10m,c.weather_code,d.daily?.temperature_2m_max?.[0],d.daily?.temperature_2m_min?.[0],d.daily?.precipitation_sum?.[0]].every(Number.isFinite)||typeof c.time!=='string')throw new Error('The weather service returned incomplete data.');
 return {temp:c.apparent_temperature,precip:c.precipitation,wind:c.wind_speed_10m,code:c.weather_code,dailyPrecip:d.daily.precipitation_sum[0],high:d.daily.temperature_2m_max[0],low:d.daily.temperature_2m_min[0],time:c.time,timezone:d.timezone,received:Date.now()};
}

