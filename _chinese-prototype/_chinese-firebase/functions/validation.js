const MODULES=['beginner','business','hsk5'];
function validateLesson(x){
 if(!x || !MODULES.includes(x.moduleId) || !Number.isInteger(x.week) || x.week<1 || x.week>12)throw Error('Choose a valid module and week.');
 if(typeof x.title!=='string'||!x.title.trim()||x.title.length>100)throw Error('Add a title of up to 100 characters.');
 if(typeof x.intro!=='string'||x.intro.length>2000)throw Error('Keep the introduction under 2,000 characters.');
 if(!Number.isInteger(x.repetitions)||x.repetitions<1||x.repetitions>10)throw Error('Choose 1–10 writing repetitions.');
 if(!Array.isArray(x.vocabulary)||x.vocabulary.length>80)throw Error('Use up to 80 vocabulary items per week.');
 for(const w of x.vocabulary){
  if(!w||typeof w.hanzi!=='string'||!/^[\p{Script=Han}]{1,12}$/u.test(w.hanzi))throw Error('Each vocabulary item needs 1–12 Chinese characters.');
  for(const [key,max] of [['pinyin',120],['meaning',200],['hint',500]]) if(typeof w[key]!=='string'||w[key].length>max)throw Error(`Check the ${key} field.`);
  if(!w.pinyin.trim()||!w.meaning.trim())throw Error('Add pinyin and a meaning for every item.');
 }
 if(x.published && (!x.vocabulary.length || !(x.writing||x.speaking||x.pinyin)))throw Error('Publishing needs vocabulary and at least one enabled activity.');
 const result={moduleId:x.moduleId,week:x.week,title:x.title.trim(),intro:x.intro.trim(),repetitions:x.repetitions,vocabulary:x.vocabulary.map((w,i)=>({id:`word-${i+1}`,hanzi:w.hanzi,pinyin:w.pinyin.trim(),meaning:w.meaning.trim(),hint:w.hint.trim()}))};
 for(const key of ['showPinyin','showMeaning','writing','speaking','pinyin','randomize','sample','published'])result[key]=x[key]===true;
 return result;
}
function owner(token){return token?.email==='kstouras@gmail.com'&&token.email_verified===true&&token.firebase?.sign_in_provider==='google.com';}
module.exports={validateLesson,owner,MODULES};
