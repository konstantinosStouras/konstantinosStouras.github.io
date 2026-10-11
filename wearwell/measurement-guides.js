const guides={
 chest:['Chest circumference','Wrap the tape around the fullest part of your chest, under the armpits. Keep it level across your back; relax your arms and breathe normally.','around',158],
 waist:['Natural waist circumference','Wrap the tape around your natural waist, usually between the lowest rib and the top of your hip bones. Stand relaxed; do not suck in or pull the tape tight.','around',204],
 hips:['Hip circumference','Wrap the tape around the widest part of your hips and buttocks, with feet together. Keep the tape horizontal all the way around.','around',248],
 shoulders:['Shoulder width','Ask someone to measure across your upper back, from the bony tip of one shoulder to the bony tip of the other. This drawing shows the back view.','shoulders'],
 arm:['Upper-arm circumference','With your arm hanging relaxed, wrap the tape around the fullest part of your upper arm. Do not flex. Measure one arm.','arm'],
 inseam:['Inseam','Start at the crotch, where the inside leg meets the body. Measure down the inside of one leg to the ankle bone. Stand barefoot; a helper makes this easier.','inseam'],
 thigh:['Thigh circumference','Wrap the tape around the fullest part of one upper thigh, just below the crotch. Stand relaxed and keep the tape level.','thigh'],
 neck:['Neck circumference','Wrap the tape around the base of your neck, just below the Adam’s apple. Keep one finger comfortably under the tape; do not tighten it.','neck'],
 sleeve:['Sleeve length','Start at the shoulder tip, follow the outside of the arm over a slightly bent elbow, and finish at the wrist bone. Ask a helper to hold the tape.','sleeve'],
 height:['Height','Stand barefoot on a flat floor against a wall. Measure vertically from the floor to the top of your head, looking straight ahead.','height'],
 weight:['Weight','Stand on a scale on a firm, level floor, without shoes. Read your weight in kilograms. A tape measure is not used for this field.','weight']
};
const body=`<path class="sketch-body" d="M150 38 C126 38 121 61 126 79 Q130 91 137 95 L136 111 Q115 115 100 125 L79 190 L66 247 L80 252 L100 198 L114 157 L111 225 Q106 251 115 276 L119 397 L137 397 L150 288 L163 397 L181 397 L185 276 Q194 251 189 225 L186 157 L206 198 L221 251 L235 246 L221 190 L200 125 Q184 115 164 111 L163 95 Q173 87 175 76 C180 53 169 38 150 38 Z"/><path class="sketch-detail" d="M136 111 Q150 119 164 111 M115 276 Q150 263 185 276 M150 273 L150 288 M118 397 L113 411 L138 411 M163 397 L162 411 L188 411"/>`;
export function guideContent(id){
 const g=guides[id];if(!g)return '';
 const [title,instruction,type,y]=g;
 let mark='';
 if(type==='around')mark=`<ellipse cx="150" cy="${y}" rx="${id==='chest'?39:id==='waist'?36:42}" ry="12"/><path d="M111 ${y} L120 ${y-5} M111 ${y} L120 ${y+5}"/>`;
 if(type==='shoulders')mark='<path d="M101 128 L199 128"/><circle cx="101" cy="128" r="4"/><circle cx="199" cy="128" r="4"/>';
 if(type==='arm')mark='<ellipse cx="94" cy="173" rx="15" ry="7" transform="rotate(20 94 173)"/>';
 if(type==='inseam')mark='<path d="M151 281 L163 395"/><circle cx="151" cy="281" r="4"/><circle cx="163" cy="395" r="4"/>';
 if(type==='thigh')mark='<ellipse cx="132" cy="292" rx="17" ry="8"/>';
 if(type==='neck')mark='<ellipse cx="150" cy="105" rx="16" ry="6"/>';
 if(type==='sleeve')mark='<path d="M199 128 L220 190 L232 223 L222 246"/><circle cx="199" cy="128" r="4"/><circle cx="222" cy="246" r="4"/>';
 if(type==='height')mark='<path d="M49 38 L49 411 M40 38 L112 38 M40 411 L102 411"/><circle cx="49" cy="38" r="4"/><circle cx="49" cy="411" r="4"/>';
 if(type==='weight')mark='<rect x="100" y="412" width="100" height="28" rx="4"/><path d="M135 423 L165 423"/>';
 return `<p class="eyebrow">YOUR MEASUREMENT GUIDE</p><h2 id="measurement-title">${title}</h2><svg class="measurement-sketch" viewBox="0 0 300 455" role="img" aria-label="${title}: ${type==='around'||['arm','thigh','neck'].includes(type)?'highlighted tape wraps around the body':'highlighted measurement path'}">${body}<g class="tape-path">${mark}</g><text x="150" y="450" text-anchor="middle">${type==='shoulders'?'BACK VIEW':'FRONT VIEW'}</text></svg><p class="guide-instruction">${instruction}</p><p class="form-note">${type==='weight'?'Use kilograms.':'Teal shows the tape position. Dots mark the start and finish; loops mean measure all the way around. Use a soft tape and enter centimetres.'}</p><button type="button" data-close-guide class="primary">Got it</button>`;
}
export function installMeasurementGuides(){
 const dialog=document.createElement('dialog');dialog.className='measurement-guide';dialog.setAttribute('aria-labelledby','measurement-title');
 dialog.innerHTML='<button type="button" class="close" data-close-guide aria-label="Close measurement guide">×</button><div class="measurement-guide-content"></div>';document.body.append(dialog);
 document.addEventListener('click',e=>{const button=e.target.closest('[data-measure-guide]');if(button){dialog.querySelector('.measurement-guide-content').innerHTML=guideContent(button.dataset.measureGuide);dialog.showModal();}if(e.target.closest('[data-close-guide]'))dialog.close();});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
}
