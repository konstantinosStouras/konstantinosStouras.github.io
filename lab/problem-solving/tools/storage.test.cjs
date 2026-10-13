const test=require('node:test'),assert=require('node:assert/strict'),S=require('../data-store'),A=require('../analysis');
const payload={rule:'Each number exceeds its predecessor',confidence:4,events:[{index:1,nums:[-1,0,0.5],passes:true},{index:2,nums:[1,1,2],passes:false}]};
test('stored rounds derive counts and sequences from ordered evidence',()=>{
 const fields={rule:{stringValue:payload.rule},confidence:{integerValue:'4'},eventsJson:{stringValue:JSON.stringify(payload.events)}};
 const row=S.rowFromDocument({name:'responses/round-id',createTime:'2026-10-13T12:00:00Z',fields});
 assert.deepEqual(row.slice(1,4),[2,1,1]);assert.equal(row[6],'(-1, 0, 0.5)');assert.equal(row[11],'round-id');
 assert.equal(A.records([row],A.detectColumns(S.headers))[0].historyValid,true);
});
test('malformed or dishonest stored events cannot enter benchmarks',()=>{
 for(const bad of [null,'{}','[]','[{"index":1,"nums":[3,2,1],"passes":true}]','[{"index":2,"nums":[1,2,3],"passes":true}]','[{"index":1,"nums":["1",2,3],"passes":true}]']){
 assert.equal(S.rowFromDocument({name:'x',fields:{rule:{stringValue:'abc'},confidence:{integerValue:'4'},eventsJson:{stringValue:bad}}}),null);
 }
 assert.throws(()=>S.validate({...payload,confidence:5.5}));assert.throws(()=>S.validate({...payload,rule:' '.repeat(5)}));
});
test('older records retain attempts without fabricating missing test histories',()=>{
 const row=['2025-11-29T12:00:00','6','','','increasing','5','','','','','','legacy-id','Copy J:O:3'];
 const record=A.records([row],A.detectColumns(S.headers))[0];assert.equal(record.attempts,6);assert.equal(record.historyValid,false);assert.equal(record.coverage,null);assert.equal(record.conf,5);
});
