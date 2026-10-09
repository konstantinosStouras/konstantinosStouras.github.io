import {getLanguage} from './i18n.js?v=20261009-public-languages';
export function locationPreference(saved={}){
 return saved.locationMode==='travel'&&saved.location?'travel':'current';
}
export function rememberCity(cities,city){
 return [city,...cities.filter(c=>c.latitude!==city.latitude||c.longitude!==city.longitude)].slice(0,8);
}
export function locationError(error){
 if(error?.code===1)return 'This browser did not share your device location. Open Daywear in your usual browser and allow location access, or choose a city.';
 if(error?.code===3)return 'Finding your location took too long. Try again or choose a city.';
 return 'Your current location is unavailable. Try again or choose a city.';
}
export async function detectLocation({geolocation=globalThis.navigator?.geolocation,fetcher=globalThis.fetch}={}){
 let position;
 try{
  if(!geolocation)throw new Error('This browser cannot provide your location. Choose a city instead.');
  position=await new Promise((resolve,reject)=>{
   // Some embedded browsers never finish their location callback.
   const timer=setTimeout(()=>reject({code:3}),12500);
   const done=fn=>value=>{clearTimeout(timer);fn(value);};
   try{geolocation.getCurrentPosition(done(resolve),done(reject),{enableHighAccuracy:false,timeout:12000,maximumAge:300000});}catch(error){clearTimeout(timer);reject(error);}
  });
 }catch(deviceError){
  try{return await detectApproximateLocation(fetcher);}catch{throw new Error(locationError(deviceError)+' Automatic city detection is also unavailable.');}
 }
 const {latitude,longitude}=position.coords;
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Your device returned an invalid location. Choose a city instead.');
 // City-level coordinates are sufficient for a wardrobe forecast. Never store a precise fix.
 const location={latitude:Number(latitude.toFixed(2)),longitude:Number(longitude.toFixed(2)),name:'your current location',country:'',timezone:'auto',source:'device'};
 try{
  const query=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,localityLanguage:getLanguage()});
  const response=await fetcher(`https://api.bigdatacloud.net/data/reverse-geocode-client?${query}`,{signal:AbortSignal.timeout(6000)});
  if(response.ok){const city=await response.json();location.name=city.city||city.locality||location.name;location.country=city.countryName||'';}
 }catch{/* The coordinates still work for weather if the city-name service is unavailable. */}
 return location;
}
export async function detectApproximateLocation(fetcher=globalThis.fetch){
 // The provider's documented client-side fallback resolves the calling device's IP.
 // No device coordinates are sent and the result is never labelled as a GPS fix.
 const response=await fetcher(`https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=${getLanguage()}`,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Automatic city detection is unavailable. Choose a city.');
 const data=await response.json();
 const {latitude,longitude}=data,name=data.city||data.locality||data.localityName;
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||typeof name!=='string'||!name.trim())throw new Error('Automatic city detection returned no usable city. Choose a city.');
 return {latitude:Number(latitude.toFixed(2)),longitude:Number(longitude.toFixed(2)),name,country:data.countryName||'',timezone:'auto',source:'approximate'};
}
