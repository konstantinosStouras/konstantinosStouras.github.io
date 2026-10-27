export const modules = [
  {id:'beginner',group:'beginner',name:'Chinese foundations',level:'HSK 1',cohort:'Beginner',description:'Build confidence, one character at a time.',students:15,icon:'初'},
  {id:'business',group:'advanced',name:'Chinese for business',level:'HSK 4–5',cohort:'Business Chinese',description:'Put your Chinese to work in real conversations.',students:8,icon:'商'},
  {id:'hsk5',group:'advanced',name:'Advanced Chinese',level:'HSK 5',cohort:'Advanced Chinese',description:'Find the right words. Express your ideas clearly.',students:6,icon:'进'}
];
const samples = {
  beginner:{title:'First strokes & familiar words',intro:'A small set of characters from Lucy’s writing handout. Watch the strokes, try them yourself, and say each word aloud.',vocabulary:[['午','wǔ','noon','Keep the third tone low.'],['上','shàng','up; above','Use a clear falling fourth tone.'],['商','shāng','commerce','Keep the first tone high and level.'],['店','diàn','shop','Use a clear falling fourth tone.'],['买','mǎi','to buy','Third tone: low, then rise when spoken alone.'],['杯','bēi','cup','Keep the first tone high and level.'],['这','zhè','this','Use a falling fourth tone.']]},
  business:{title:'Welcoming a visitor',intro:'A short demonstration set for business conversations. Lucy can replace these examples with the vocabulary taught in class.',vocabulary:[['欢迎','huān yíng','welcome','Connect the level first tone to the rising second tone.'],['公司','gōng sī','company','Keep both syllables high and level.'],['合作','hé zuò','cooperation','Rise on hé, then fall on zuò.'],['会议','huì yì','meeting','Both syllables have a falling fourth tone.']]},
  hsk5:{title:'Expressing your ideas',intro:'A short demonstration set for advanced learners. Practise the characters and pronunciation before using the words in your own sentences.',vocabulary:[['观点','guān diǎn','point of view','A level tone followed by a low third tone.'],['解释','jiě shì','to explain','Keep jiě low, then fall clearly on shì.'],['逻辑','luó jí','logic','Both syllables have rising tones.'],['文化','wén huà','culture','Rise on wén, then fall on huà.']]}
};
export function makeLesson(moduleId,week=1){
  const sample = week===1?samples[moduleId]:null;
  return {moduleId,week,title:sample?.title||`Week ${week}`,intro:sample?.intro||'',sample:week===1,published:week===1,showPinyin:true,showMeaning:true,writing:true,speaking:true,pinyin:true,repetitions:2,randomize:false,vocabulary:(sample?.vocabulary||[]).map(([hanzi,pinyin,meaning,hint],i)=>({id:`word-${i+1}`,hanzi,pinyin,meaning,hint}))};
}
export function lessonId(moduleId,week){return `${moduleId}-${String(week).padStart(2,'0')}`;}
