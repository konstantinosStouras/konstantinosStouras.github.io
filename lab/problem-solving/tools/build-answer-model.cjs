// Edit the reviewed JSON deliberately, then rebuild the browser catalogue.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),corpus=JSON.parse(fs.readFileSync(path.join(root,'answer-review.json'),'utf8'));
if(!corpus.version||!corpus.reviewedBy||!corpus.rubric)throw Error('Missing audit provenance');
for(const e of corpus.entries)if(!e.text||!e.reason||!['correct','incorrect','unclear','invalid'].includes(e.status))throw Error('Invalid reviewed entry');
fs.writeFileSync(path.join(root,'answer-model.js'),'/* Reviewed answer catalogue. Source and rubric: answer-review.json. */\n(function(root){\nconst corpus='+JSON.stringify(corpus)+';\nif(typeof module===\'object\'&&module.exports)module.exports=corpus;else root.ProblemAnswerCorpus=corpus;\n})(typeof globalThis!==\'undefined\'?globalThis:this);\n');
console.log('Built '+corpus.entries.length+' reviewed phrasings. Run the grader tests before publishing.');
