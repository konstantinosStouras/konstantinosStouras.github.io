const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../answer-grader.js');
test('every collected response has an explicit reviewed classification',()=>{
 const rows=G.corpus.entries.flatMap(e=>e.rows);assert.equal(rows.length,386);assert.equal(new Set(rows).size,386);
 for(const e of G.corpus.entries){assert.ok(e.reason.length>20);assert.equal(G.grade(e.text).reviewStatus,e.status);assert.equal(G.grade(e.text.toUpperCase()+'  ').reviewStatus,e.status);}
});
// Independently written variations, separate from the catalogue. This is a
// regression set, not an empirical estimate of unseen-answer accuracy.
test('unseen correct paraphrases and equivalent inequalities',()=>{
 for(const s of ['Every value must exceed the previous value','The three values are strictly ascending','three numbers are arranged in ascending order','numbers sorted in strictly increasing order','The first value is smaller than the second value and the second value is smaller than the third value','c > b > a','a < b and b < c','n1 < n2 < n3','not doubling, just strictly increasing','The values must be increasing; the gaps do not matter','increasing; negatives and decimals are allowed','Each value must be greater than the one immediately before it'])assert.equal(G.grade(s).status,'correct',s);
});
test('wrong or qualified rules never pass because of a familiar keyword',()=>{
 for(const s of ['a <= b <= c','a > b > c','ascending with ties allowed','increasing or decreasing','not increasing','a < b < c and only positive values','numbers sorted in increasing order and must be even','each number is not greater than the previous','not doubling, just decreasing','strictly increasing except equal values are allowed','increasing numbers all below 100','all three numbers are increasing and prime','numbers increase by 2 each time'])assert.notEqual(G.grade(s).status,'correct',s);
});
test('known false negatives and false positives are repaired',()=>{
 for(const s of ['a<b<c','the number should list from small to big, and can\'t be repeated','the number are in incresing order.','THE MIDDLE NUMBER MUST BE MORE THAN THE LEFT NUMBER VALUE, AND LESS THAN THE RIGHT NUMBER VALUE'])assert.equal(G.grade(s).status,'correct');
 for(const s of ['It positive numbers and in increasing order','Three numbers increase by one each time.','even, sequential, ascending numbers'])assert.equal(G.grade(s).status,'incorrect');
 assert.equal(G.grade('number 2 should be greater than 1 and number 3 should be greater than number 3').status,'review');
});
