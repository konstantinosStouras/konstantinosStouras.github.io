// Account identity and the person being dressed are deliberately separate.
import {accountStorageKey} from './auth-policy.js?v=20261022-admin-v4';
let member='self',epoch=0;
export const activeMemberId=()=>member;
export const contextVersion=()=>epoch;
export const isFamily=()=>member!=='self';
export function setMember(id){if(id!=='self'&&!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid profile');member=id;epoch++;}
export function profilePath(uid,id=member){if(!uid)throw Error('Sign in first.');if(id!=='self'&&!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid profile');return id==='self'?['daywearProfiles',uid]:['daywearProfiles',uid,'members',id];}
export function memberStorageKey(uid,id=member){return id==='self'?accountStorageKey(uid):`${accountStorageKey(uid)}.member.${id}`;}
export function clearFamilyStorage(uid,storage=localStorage){const prefix=accountStorageKey(uid)+'.member.';for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(prefix))storage.removeItem(key);}}
