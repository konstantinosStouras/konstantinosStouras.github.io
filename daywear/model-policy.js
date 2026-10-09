// UI selection only. The private image server independently verifies Firebase login.
const personalAccountId='wqXod8mXlsZr0qCtKSN7A5Fwnl03';
export const hasPersonalModel=uid=>uid===personalAccountId;
export function modelImageSource(look,uid,catalog){
 return hasPersonalModel(uid)?catalog?.get(look.id,uid):`assets/${look.id}.webp?v=guest-v1`;
}
export function modelCaption(uid){
 return hasPersonalModel(uid)?'Your photo-based AI model · Visual styling study, not a measured fitting.':'Daywear’s slim male catalog model · Example styling, not your personal likeness.';
}
export function modelFitNotes(uid,sizes={}){
 if(sizes.bodyNotes)return sizes.bodyNotes;
 return hasPersonalModel(uid)?'Tall, broad through the chest and shoulders, with naturally slimmer arms and a natural waist. Allow comfortable room through the chest and abdomen.':'Use your saved sizes and optional measurements to guide fit. Check garment measurements before buying.';
}
