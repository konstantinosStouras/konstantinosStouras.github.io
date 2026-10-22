'use strict';
const catalog=require('./model-catalog.json');
const ranges={height:[50,250],chest:[25,250],waist:[20,250],hips:[25,250],inseam:[15,130]};
function validate(data){
 if(!['man','woman','child'].includes(data.kind))throw Error('Choose a man, woman or child model.');
 if(!['cm','in'].includes(data.unit))throw Error('Choose centimetres or inches.');
 if(data.permission!==true)throw Error('Confirm that you have permission to use this person’s headshot.');
 const age=data.kind==='child'?Number(data.age):null;
 if(data.kind==='child'&&(!Number.isInteger(age)||age<1||age>17||data.guardian!==true))throw Error('For a child, enter an age from 1 to 17 and confirm you are their parent or legal guardian.');
 const measurements={};for(const [key,[min,max]] of Object.entries(ranges)){const n=Number(data.measurements?.[key])*(data.unit==='in'?2.54:1);if(!Number.isFinite(n)||n<min||n>max)throw Error(`Check ${key}: enter a measurement between ${min} and ${max} cm (or its inch equivalent).`);measurements[key]=Math.round(n*10)/10;}
 if(measurements.inseam>=measurements.height)throw Error('Inside leg must be shorter than height.');
 return {kind:data.kind,age,unit:data.unit,measurements,permission:true,guardian:data.kind==='child',consentVersion:'tryon-1'};
}
function prompt(profile,lookId,single=false){
 const look=lookId?catalog[lookId]:null;if(lookId&&!look)throw Error('Choose an outfit from the site.');
 const person=profile.kind==='child'?`a child aged ${profile.age}; preserve their actual age and childlike proportions`:`an adult ${profile.kind}`;
 return [
 `Create a natural, fully dressed full-body studio photograph of ${person}, head to shoes visible, on white.`,
 look?'Preserve the identity, face, body proportions, stance and camera angle of the FIRST reference: the owner-approved personal model.':'Use the supplied headshot as the facial authority. Build a full body from the supplied measurements; no full-body photo is required.',
 'Keep recognisable facial features, skin tone, hair, age and natural skin texture. No beauty filters, weight loss, idealised body, age changes or exaggerated muscles.',
 `Body measurements in centimetres: ${JSON.stringify(profile.measurements)}. Use these to guide proportions; do not claim exact size or garment fit.`,
 look?`Dress this person in this site outfit: ${look.name}. Garments: ${look.garments.join('; ')}. Preserve garment colours and details, adapt their cut to this person. ${single?'The clothing is described in text; only the approved model photo is attached.':'The LAST reference is clothing only. Never copy that catalog model’s face or body.'}`:'Wear a plain opaque crew-neck T-shirt, comfortable full-length trousers and flat shoes. Relaxed front-facing stance, arms at sides. No underwear, swimwear or exposed torso.',
 profile.kind==='child'?'Keep all clothing age-appropriate, opaque and comfortably fitted. No adult styling, makeup, sexualised pose or adult body proportions.':'Keep the styling natural and fully clothed.',
 'Return one private visual preview for owner approval. No text or watermark.'
 ].join('\n');
}
module.exports={validate,prompt,ranges};
