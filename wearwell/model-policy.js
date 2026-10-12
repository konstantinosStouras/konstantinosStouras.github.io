// Every account starts with the fictional catalog. Only approved authenticated images replace it.
export const hasPersonalModel=uid=>typeof uid==='string'&&uid.length>0;
export function modelImageSource(look,uid,catalog){return (uid&&catalog?.get(look.id,uid))||`assets/${look.id}.webp?v=guest-v1`;}
export function modelCaption(uid){return uid?'Personal images appear only for looks you have approved. Other looks use the fictional catalog model.':'WearWell’s slim male catalog model · Example styling, not your personal likeness.';}
export function modelFitNotes(uid,sizes={}){return sizes.bodyNotes||'Use your saved sizes and optional measurements to guide fit. Check garment measurements before buying.';}
