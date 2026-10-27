import test from 'node:test';import assert from 'node:assert/strict';import {checkPinyin,escapeHtml,shuffled} from '../src/core.mjs';
import validation from '../_chinese-firebase/functions/validation.js';import {makeLesson} from '../src/curriculum.mjs';
test('pinyin accepts tone marks and numeric tones without giving wrong tones a pass',()=>{
 assert.equal(checkPinyin('wu3','wǔ'),'correct');assert.equal(checkPinyin('huan1 ying2','huān yíng'),'correct');assert.equal(checkPinyin('shang4','shàng'),'correct');assert.equal(checkPinyin('nü3','nǚ'),'correct');assert.equal(checkPinyin('nu:3','nǚ'),'correct');assert.equal(checkPinyin('wu','wǔ'),'tones');assert.equal(checkPinyin('wu4','wǔ'),'tones');assert.equal(checkPinyin('ma','mǎi'),'retry');assert.equal(checkPinyin('ma5','ma'),'correct');
});
test('curriculum validates publication and limits content',()=>{
 assert.equal(validation.validateLesson(makeLesson('beginner')).vocabulary.length,7);
 assert.throws(()=>validation.validateLesson({...makeLesson('beginner'),vocabulary:[],published:true}));
 assert.throws(()=>validation.validateLesson({...makeLesson('beginner'),week:13}));
 assert.throws(()=>validation.validateLesson({...makeLesson('beginner'),repetitions:0}));
 assert.throws(()=>validation.validateLesson({...makeLesson('beginner'),writing:false,speaking:false,pinyin:false}));
 assert.throws(()=>validation.validateLesson({...makeLesson('beginner'),vocabulary:[{hanzi:'<script>',pinyin:'x',meaning:'x',hint:''}]}));
});
test('owner requires verified Google sign-in',()=>{
 const token={email:'kstouras@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 assert.equal(validation.owner(token),true);assert.equal(validation.owner({...token,email_verified:false}),false);assert.equal(validation.owner({...token,firebase:{sign_in_provider:'password'}}),false);assert.equal(validation.owner({...token,email:'someone@gmail.com'}),false);
});
test('untrusted content is escaped and shuffling preserves the source',()=>{assert.equal(escapeHtml('<img onerror="bad">'),'&lt;img onerror=&quot;bad&quot;&gt;');const items=[1,2,3];assert.deepEqual(shuffled(items).sort(),items);assert.deepEqual(items,[1,2,3]);});
