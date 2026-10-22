'use strict';
const policy=require('./model-policy.cjs');
const singleImage=id=>id==='adobe'||id==='stability';
function inputFor(request,refs,pose){
 const image=request.purpose==='posture'?refs.find(p=>p.kind==='body')?.data:pose?.data;
 if(!image)throw Error('A dressed body photo or approved posture is required.');
 const look=policy.catalog[request.lookId];if(!look)throw Error('Unknown outfit.');
 const choices=policy.preferences(request.preferences);
 const refinements=Object.entries({slimmerFace:'slightly refine facial fullness',skin:'gently improve blemishes',wrinkles:'gently soften wrinkles',hair:'restore natural darker hair',beard:'restore natural darker beard'}).filter(([k])=>choices[k]).map(([,v])=>v);
 const prompt=[
  'Edit the ONE supplied photo into a photorealistic full-body wardrobe preview of the SAME person. Preserve facial identity, age, ethnicity, body proportions and natural skin texture. Do not slim or idealise the body. Show head to shoes against a white studio background. Return one photograph, not a collage.',
  'Wear only: '+look.garments.join('; ')+'.',
  'Posture: '+(policy.postures[request.postureId]||policy.postures.front),
  refinements.length?'Only these optional refinements: '+refinements.join('; ')+'.':'No beauty retouching; preserve hair, skin and facial fullness.',
  'No separate headshot or catalog image is supplied. Use this photo for identity and the garment description for clothing. Private candidate for owner approval.'
 ].join('\n');
 // Adobe's Image5 prompt limit is 1500. Preserve all garment and identity instructions.
 if(prompt.length>1500)throw Error('The outfit brief exceeds this provider’s prompt limit.');
 return {images:[image],prompt,referenceMode:request.purpose==='posture'?'body-photo':'approved-posture'};
}
module.exports={singleImage,inputFor};
