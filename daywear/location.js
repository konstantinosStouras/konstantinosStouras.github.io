export function locationPreference(saved={}){
 return saved.locationMode==='travel'&&saved.location?'travel':'current';
}
export function rememberCity(cities,city){
 return [city,...cities.filter(c=>c.latitude!==city.latitude||c.longitude!==city.longitude)].slice(0,8);
}
export function locationError(error){
 if(error?.code===1)return 'Location access is off. Allow it in your browser settings, or choose a city below.';
 if(error?.code===3)return 'Finding your location took too long. Try again or choose a city.';
 return 'Your current location is unavailable. Try again or choose a city.';
}
export async function detectLocation({geolocation=globalThis.navigator?.geolocation,fetcher=globalThis.fetch}={}){
 if(!geolocation)throw new Error('This browser cannot provide your location. Choose a city instead.');
 const position=await new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:12000,maximumAge:300000}));
 const {latitude,longitude}=position.coords;
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Your device returned an invalid location. Choose a city instead.');
 // City-level coordinates are sufficient for a wardrobe forecast. Never store a precise fix.
 const location={latitude:Number(latitude.toFixed(2)),longitude:Number(longitude.toFixed(2)),name:'your current location',country:'',timezone:'auto'};
 try{
  const query=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,localityLanguage:'en'});
  const response=await fetcher(`https://api.bigdatacloud.net/data/reverse-geocode-client?${query}`,{signal:AbortSignal.timeout(6000)});
  if(response.ok){const city=await response.json();location.name=city.city||city.locality||location.name;location.country=city.countryName||'';}
 }catch{/* The coordinates still work for weather if the city-name service is unavailable. */}
 return location;
}
