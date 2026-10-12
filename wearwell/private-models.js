// Personal pixels stay in memory, with authenticated reads and revocation on account changes.
export function createPrivateCatalog({fetcher=fetch,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
 let uid=null,urls=new Map(),controller=null,version=0;
 const clear=()=>{version++;controller?.abort();controller=null;for(const url of urls.values())revokeURL(url);urls.clear();uid=null;};
 return {clear,get:(id,account)=>account===uid?urls.get(id):undefined,
 async load(account,getToken,ids){
  clear();const current=version;controller=new AbortController();const signal=controller.signal,token=await getToken();if(current!==version)return false;
  const response=await fetcher(`https://firestore.googleapis.com/v1/projects/stouras-personal-wardrobe/databases/(default)/documents/daywearProfiles/${encodeURIComponent(account)}/models?pageSize=100`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  if(!response.ok)throw Error('Your approved images could not load. Please retry.');const data=await response.json();if(current!==version)return false;
  const preferences=await fetcher(`https://firestore.googleapis.com/v1/projects/stouras-personal-wardrobe/databases/(default)/documents/daywearProfiles/${encodeURIComponent(account)}/modelPreferences/current`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  if(!preferences.ok&&preferences.status!==404)throw Error('Your approved images could not load. Please retry.');const preference=preferences.ok?await preferences.json():{},revision=preference.fields?.revision?.stringValue;if(current!==version)return false;
  const next=new Map();try{for(const doc of data.documents||[]){const id=doc.name.split('/').pop(),fields=doc.fields||{},value=fields.data?.stringValue;if(!ids.includes(id)||!fields.approvedAt?.timestampValue||!revision||fields.revision?.stringValue!==revision)continue;if(typeof value!=='string'||value.length>650000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value))throw Error('Invalid approved image.');const bytes=Uint8Array.from(atob(value.split(',')[1]),c=>c.charCodeAt(0));if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid approved image.');next.set(id,createURL(new Blob([bytes],{type:'image/jpeg'})));}}catch(e){for(const url of next.values())revokeURL(url);throw e;}
  if(current!==version){for(const url of next.values())revokeURL(url);return false;}urls=next;uid=account;return true;
 }};
}
