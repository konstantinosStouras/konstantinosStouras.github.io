// Private directory data lives only in memory and expires after one minute.
export function createUserDirectory(fetchPage, identity, now=Date.now) {
 let owner=null,version=0,cached=null;
 const pending=new Map();
 function clear(){owner=null;cached=null;pending.clear();version++;}
 function scope(){
  const account=identity(),uid=account.admin?account.uid:null;
  if(uid!==owner){clear();owner=uid;}
  return uid;
 }
 function snapshot(){return scope()?cached:null;}
 async function load({more=false,force=false}={}){
  const uid=scope();
  if(!uid)return null;
  if(!more&&!force&&cached&&now()-cached.loadedAt<60000)return cached;
  const token=more?cached?.pageToken:null;
  if(more&&!token)return cached;
  const key=token||'',epoch=version;
  if(pending.has(key))return pending.get(key);
  const request=Promise.resolve().then(()=>fetchPage(token)).then(result=>{
   if(scope()!==uid||version!==epoch)return null;
   if(more&&cached?.pageToken!==token)return cached;
   cached={users:more?[...cached.users,...result.users]:result.users,pageToken:result.pageToken||null,loadedAt:more?cached.loadedAt:now()};
   return cached;
  }).finally(()=>{if(pending.get(key)===request)pending.delete(key);});
  pending.set(key,request);
  return request;
 }
 return {snapshot,load,clear};
}
