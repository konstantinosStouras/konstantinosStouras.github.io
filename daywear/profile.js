const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const range=(start,end,step=1)=>Array.from({length:Math.round((end-start)/step)+1},(_,i)=>String(start+i*step));
export const measurements=[
 ['height','Height','cm',50,260,'Barefoot, from the floor to the top of your head.'],
 ['weight','Weight','kg',20,400,'Your current weight.'],
 ['chest','Chest','cm',30,250,'Around the fullest part, with arms relaxed.'],
 ['waist','Waist','cm',30,250,'Around your natural waist, without pulling the tape tight.'],
 ['hips','Hips','cm',30,250,'Around the fullest part of your hips and seat.'],
 ['shoulders','Shoulder width','cm',15,90,'Across your back, from one shoulder tip to the other.'],
 ['arm','Upper-arm circumference','cm',10,90,'Around the fullest part of your upper arm, relaxed.'],
 ['inseam','Inseam','cm',20,130,'From the crotch to your ankle along the inside leg.'],
 ['thigh','Thigh circumference','cm',15,150,'Around the fullest part of one thigh.'],
 ['neck','Neck','cm',15,80,'Around the base of your neck, with comfortable room.'],
 ['sleeve','Sleeve length','cm',20,110,'From your shoulder tip to your wrist, elbow slightly bent.']
];
function select(name,title,values,current=''){
 current=typeof current==='string'?current:'';
 const choices=['',...values];if(current&&!choices.includes(current))choices.push(current);
 return `<div><label class="field">${title}<select name="${name}" data-size-select>${choices.map(v=>`<option value="${esc(v)}"${v===current?' selected':''}>${esc(v||'Not specified')}</option>`).join('')}<option value="__custom">Other / custom size…</option></select></label><label class="field" data-custom-for="${name}" hidden>Custom ${title.toLowerCase()}<input name="${name}Custom" maxlength="60" disabled></label></div>`;
}
export function profileFields(sizes={}){
 const m=sizes.measurements||{};
 return `<div class="form-grid">${select('top','Top size',['XXS','XS','S','M','L','XL','XXL','3XL','4XL','5XL','6XL','7XL','8XL'],sizes.top)}${select('bottom','Trouser size',[...range(22,70),'XXS','XS','S','M','L','XL','XXL','3XL','4XL','5XL'],sizes.bottom)}${select('bottomSystem','Trouser sizing system',['Waist (inches)','EU','UK','US','International'],sizes.bottomSystem)}${select('shoe','Shoe size + sizing system',[...range(32,52,.5).map(v=>'EU '+v),...range(2,18,.5).map(v=>'UK '+v),...range(3,20,.5).map(v=>"US men’s "+v),...range(4,20,.5).map(v=>"US women’s "+v)],sizes.shoe)}</div><p class="form-note">Choose the size printed on your clothing. Sizes vary by brand; we never convert them automatically.</p><details class="measurement-details"${Object.keys(m).length||sizes.bodyNotes?' open':''}><summary>Optional body measurements & model notes</summary><p class="form-note">Leave anything you don’t know blank. Use a soft tape over light clothing. These are body measurements, not garment dimensions.</p><div class="form-grid">${measurements.map(([id,title,unit,min,max,help])=>`<label class="field">${title} (${unit})<input type="number" inputmode="decimal" name="measure_${id}" min="${min}" max="${max}" step="0.1" value="${esc(m[id]??'')}" aria-describedby="help-${id}"><small id="help-${id}">${help}</small></label>`).join('')}</div><label class="field">Face, body & fit notes (optional)<textarea name="bodyNotes" maxlength="1500" rows="4" placeholder="For example: slimmer arms, broad shoulders, black beard, preferred fit…">${esc(sizes.bodyNotes||'')}</textarea></label><p class="form-note">Measurements guide body proportions. Your own reference photos are needed for facial likeness. Saving this profile does not regenerate the current catalog images.</p></details><div class="profile-save"><button type="submit" class="primary">Save profile</button><p id="profile-status" role="status" aria-live="polite">Saved only in this browser, for your current account.</p></div>`;
}
export function readProfile(formData){
 const value=name=>String(formData.get(name)||'').trim();
 const size=name=>value(name)==='__custom'?value(name+'Custom'):value(name);
 const sizes={top:size('top'),bottom:size('bottom'),bottomSystem:size('bottomSystem'),shoe:size('shoe'),measurements:{},bodyNotes:value('bodyNotes').slice(0,1500)};
 for(const [id,title,,min,max] of measurements){
  const raw=value('measure_'+id);if(!raw)continue;
  const n=Number(raw);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Please check your ${title.toLowerCase()} measurement.`);
  sizes.measurements[id]=n;
 }
 return {name:value('name').slice(0,50),sizes};
}
export function modelBrief(name,sizes={}){
 const lines=[`Model reference brief for ${name||'my wardrobe'}`];
 for(const [id,title,unit] of measurements){const n=sizes.measurements?.[id];if(typeof n==='number'&&Number.isFinite(n))lines.push(`${title}: ${n} ${unit}`);}
 if(sizes.top)lines.push(`Top size: ${sizes.top}`);
 if(sizes.bottom)lines.push(`Trouser size: ${sizes.bottom}${sizes.bottomSystem?' ('+sizes.bottomSystem+')':''}`);
 if(sizes.shoe)lines.push(`Shoe size: ${sizes.shoe}`);
 if(sizes.bodyNotes)lines.push(`Appearance and fit notes: ${sizes.bodyNotes}`);
 lines.push('Use my supplied reference photos for facial likeness. Preserve my stated proportions. Do not invent missing measurements. This is a styling visualization, not a measured garment fitting.');
 return lines.join('\n');
}
// Commit the profile only after storage succeeds; failure leaves the form available to retry.
export function saveProfile(state,next,persist){
 const previous={name:state.name,sizes:state.sizes};
 Object.assign(state,next);
 try{if(persist()!==true)throw new Error('Storage unavailable');return true;}catch{Object.assign(state,previous);return false;}
}
