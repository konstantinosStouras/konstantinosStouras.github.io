// Personal pixels live only in memory after the server verifies Firebase login.
export function createPrivateCatalog({fetcher=fetch,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
 let uid=null,urls=new Map(),controller=null,version=0;
 const clear=()=>{version++;controller?.abort();controller=null;for(const url of urls.values())revokeURL(url);urls.clear();uid=null;};
 return {
  clear,
  get:(id,account)=>account===uid?urls.get(id):undefined,
  async load(account,getToken,ids){
   clear();const current=version;controller=new AbortController();const signal=controller.signal;
   const token=await getToken();if(current!==version)return false;
   const response=await fetcher('https://personal-wardrobe-collection.glassylake4.chatgpt.site/api/personal-catalog',{
    headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])
   });
   if(!response.ok)throw new Error(response.status===403?'This account does not have a personal model.':'Your private model could not load. Please retry or sign in again.');
   const data=await response.json();if(current!==version)return false;
   const next=new Map();
   try{
    for(const id of ids){
     const encoded=data.images?.[id];if(typeof encoded!=='string')throw Error('Incomplete personal collection. Please retry.');
     const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
     if(bytes.length<12||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WEBP')throw Error('Invalid personal image. Please retry.');
     next.set(id,createURL(new Blob([bytes],{type:'image/webp'})));
    }
   }catch(error){for(const url of next.values())revokeURL(url);throw error;}
   if(current!==version){for(const url of next.values())revokeURL(url);return false;}
   urls=next;uid=account;return true;
  }
 };
}
