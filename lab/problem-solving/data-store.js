/* Independent Firebase storage. No Sheets or Apps Script requests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProblemStore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const project='simulation-platform-233cf';
  const base='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
  const headers=['Timestamp','Number of attempts','Yeses','Nos',"What's the rule?",'Confidence level','Yes sequences','No sequences','Notes','Got it right?','Creativity index (%)','Submission ID','Source'];
  const config={apiKey:'AIzaSyDAgP5OlgdqqN0m9t3WtUXNfeW9T6W3iYA',authDomain:project+'.firebaseapp.com',projectId:project,appId:'1:829779403130:web:b469add747d2ae3d25b6c3'};
  function validate(body){
    if(typeof body.rule!=='string'||!body.rule.trim()||body.rule.length>5000)throw Error('Enter a rule of up to 5,000 characters.');
    if(!Number.isInteger(body.confidence)||body.confidence<1||body.confidence>5)throw Error('Invalid confidence.');
    if(!Array.isArray(body.events)||!body.events.length||body.events.length>250)throw Error('A round must contain 1–250 tests.');
    body.events.forEach((e,i)=>{if(e.index!==i+1||!Array.isArray(e.nums)||e.nums.length!==3||!e.nums.every(Number.isFinite)||e.passes!==(e.nums[0]<e.nums[1]&&e.nums[1]<e.nums[2]))throw Error('Invalid test history.');});
    if(JSON.stringify(body.events).length>40000)throw Error('Test history is too large.');
    return body;
  }
  const fieldsToObject=fields=>Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,'integerValue' in v?Number(v.integerValue):v.stringValue]));
  function rowFromDocument(doc){
    try{
      const data=fieldsToObject(doc.fields);
      if(data.rowJson){const row=JSON.parse(data.rowJson);return Array.isArray(row)&&row.length===headers.length?row:null;}
      const events=JSON.parse(data.eventsJson),body=validate({rule:data.rule,confidence:data.confidence,events});
      const yes=events.filter(e=>e.passes),no=events.filter(e=>!e.passes),seq=xs=>xs.map(e=>'('+e.nums.join(', ')+')').join('; ')||'—';
      return [doc.createTime,events.length,yes.length,no.length,body.rule,body.confidence,seq(yes),seq(no),'','','',doc.name.split('/').pop(),'Independent game'];
    }catch{return null;}
  }
  async function collection(name){
    const documents=[];let token='';
    do{const url=base+'/'+name+'?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):'');const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!response.ok)throw Error('Response database is unavailable.');const data=await response.json();documents.push(...(data.documents||[]));token=data.nextPageToken||'';}while(token);
    return documents;
  }
  async function load(){
    const [history,docs]=await Promise.all([fetch('data/history.json',{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('Historical data is unavailable.');return r.json();}),collection('problemSolvingResponses')]);
    if(!Array.isArray(history.rows)||history.headers.join('|')!==headers.join('|'))throw Error('Unexpected historical data format.');
    const live=docs.map(rowFromDocument).filter(Boolean);
    return {headers,rows:[...history.rows,...live],excluded:docs.length-live.length,fetchedAt:new Date().toISOString()};
  }

  let userPromise;
  async function user(){
    if(!userPromise)userPromise=(async()=>{const sdk='https://www.gstatic.com/firebasejs/10.12.2/';const [appModule,authModule]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-auth.js')]);const app=appModule.getApps().find(a=>a.name==='problem-solving')||appModule.initializeApp(config,'problem-solving');const auth=authModule.getAuth(app);await authModule.setPersistence(auth,authModule.inMemoryPersistence);return (await authModule.signInAnonymously(auth)).user;})().catch(e=>{userPromise=null;throw e;});
    return userPromise;
  }
  async function save(body){
    validate(body);if(!/^[a-zA-Z0-9-]{20,80}$/.test(body.submissionId))throw Error('Invalid response identifier.');
    const player=await user(),token=await player.getIdToken();
    const values={owner:player.uid,rule:body.rule,confidence:body.confidence,eventsJson:JSON.stringify(body.events),analysisVersion:body.analysisVersion};
    const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]));
    let receipt;
    try{const response=await fetch(base+'/problemSolvingResponses?documentId='+encodeURIComponent(body.submissionId),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({fields}),signal:AbortSignal.timeout(30000)});if(response.ok)receipt=await response.json();}catch{}
    // A request can commit even when its response is lost. Verify by immutable
    // ID after any failure, including duplicate-create and permission responses.
    if(!receipt)receipt=await fetch(base+'/problemSolvingResponses/'+encodeURIComponent(body.submissionId),{signal:AbortSignal.timeout(12000)}).then(r=>{if(!r.ok)throw Error('Save could not be verified. Please retry.');return r.json();});
    const saved=fieldsToObject(receipt.fields);
    if(Object.keys(values).some(k=>saved[k]!==values[k]))throw Error('A different response already uses this identifier.');
    return {saved:true,id:body.submissionId,createdAt:receipt.createTime};
  }
  return {load,save,validate,rowFromDocument,headers,base};
});
