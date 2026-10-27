const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {SecretManagerServiceClient}=require('@google-cloud/secret-manager');
const {validateLesson,owner}=require('./validation');
initializeApp();
const db=getFirestore(),secrets=new SecretManagerServiceClient();
const project='stouras-chinese';
const stamp=()=>FieldValue.serverTimestamp();
const fail=(code,message)=>{throw new HttpsError(code,message);};
async function isAdmin(auth){return !!auth&&(owner(auth.token)||(await db.doc(`admins/${auth.uid}`).get()).exists);}
async function secret(provider){try{const [v]=await secrets.accessSecretVersion({name:`projects/${project}/secrets/chinese-${provider}/versions/latest`});return JSON.parse(v.payload.data.toString());}catch{fail('failed-precondition','Your lecturer has not connected this speech service yet.');}}
async function limits(uid){
 const day=new Date().toISOString().slice(0,10),refs=[db.doc(`usage/${day}-${uid}`),db.doc(`usage/${day}-total`)];
 await db.runTransaction(async t=>{const snapshots=await Promise.all(refs.map(r=>t.get(r)));if((snapshots[0].data()?.count||0)>=40||(snapshots[1].data()?.count||0)>=300)fail('resource-exhausted','Today’s speech practice limit has been reached. You can still practise writing and pinyin.');refs.forEach(r=>t.set(r,{count:FieldValue.increment(1),updatedAt:stamp()},{merge:true}));});
}
exports.chineseApi=onCall({region:'europe-west1',maxInstances:2,minInstances:0,memory:'256MiB',cpu:'gcf_gen1',timeoutSeconds:90,cors:['https://stouras.com','https://www.stouras.com','https://stouras-chinese.web.app',/^http:\/\/localhost(:\d+)?$/]},async req=>{
 if(!req.auth)fail('unauthenticated','Sign in to continue.');
 const d=req.data||{},admin=await isAdmin(req.auth);
 try{
  if(d.action==='role')return {admin,owner:owner(req.auth.token)};
  if(d.action==='saveLesson'){
   if(!admin)fail('permission-denied','Administrator access is required.');
   let lesson;try{lesson=validateLesson({...d.lesson,published:d.publish===true});}catch(e){fail('invalid-argument',e.message);}
   const id=`${lesson.moduleId}-${String(lesson.week).padStart(2,'0')}`,data={...lesson,updatedAt:stamp(),updatedBy:req.auth.uid};
   const batch=db.batch();batch.set(db.doc(`drafts/${id}`),data);
   if(d.publish===true)batch.set(db.doc(`lessons/${id}`),{...data,published:true});
   if(d.unpublish===true)batch.delete(db.doc(`lessons/${id}`));
   await batch.commit();return {saved:true};
  }
  if(d.action==='setAdmin'){
   if(!owner(req.auth.token))fail('permission-denied','Only the project owner can appoint administrators.');
   if(typeof d.uid!=='string'||d.uid.length>128||d.uid.includes('/'))fail('invalid-argument','Select a registered user.');
   const user=await getAuth().getUser(d.uid);
   if(user.email==='kstouras@gmail.com')fail('invalid-argument','The project owner always retains access.');
   if(!(await db.doc(`users/${d.uid}`).get()).exists)fail('invalid-argument','This person needs to register first.');
   if(d.enabled===true)await db.doc(`admins/${d.uid}`).set({email:user.email,createdAt:stamp(),createdBy:req.auth.uid});else await db.doc(`admins/${d.uid}`).delete();
   return {saved:true};
  }
  if(d.action==='approve'){
   if(!admin)fail('permission-denied','Administrator access is required.');
   if(typeof d.uid!=='string'||d.uid.length>128||d.uid.includes('/'))fail('invalid-argument','Select a registered student.');
   if(!(await db.doc(`users/${d.uid}`).get()).exists)fail('invalid-argument','The student must register first.');
   await db.doc(`access/${d.uid}`).set({approved:d.enabled===true,updatedAt:stamp()});return {saved:true};
  }
  if(d.action==='sharedLogin'){
   if(!owner(req.auth.token))fail('permission-denied','Only the project owner can change the shared login.');
   if(typeof d.password!=='string'||d.password.length<14||d.password.length>128)fail('invalid-argument','Use a password of 14–128 characters.');
   const uid='shared-teacher';
   try{await getAuth().updateUser(uid,{password:d.password,disabled:false});}catch(e){if(e.code!=='auth/user-not-found')throw e;await getAuth().createUser({uid,email:'shared-teacher@stouras-chinese.firebaseapp.com',displayName:'Shared teacher',password:d.password});}
   await getAuth().revokeRefreshTokens(uid);
   await db.doc(`admins/${uid}`).set({email:'shared-teacher@stouras-chinese.firebaseapp.com',createdBy:req.auth.uid,updatedAt:stamp()});
   await db.doc('settings/public').set({sharedLoginEnabled:true},{merge:true});return {saved:true,username:'teacher'};
  }
  if(d.action==='saveProvider'){
   if(!admin)fail('permission-denied','Administrator access is required.');
   if(!['openai','azure'].includes(d.provider))fail('invalid-argument','Choose a supported speech service.');
   if(typeof d.key!=='string'||d.key.length<16||d.key.length>500)fail('invalid-argument','Enter a valid API key.');
   const value={key:d.key};
   if(d.provider==='azure'){
    if(typeof d.resource!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}$/.test(d.resource))fail('invalid-argument','Enter your Azure Speech resource name (not a URL).');
    value.resource=d.resource;
   }
   await secrets.addSecretVersion({parent:`projects/${project}/secrets/chinese-${d.provider}`,payload:{data:Buffer.from(JSON.stringify(value))}});
   await db.doc('settings/public').set({[`${d.provider}Configured`]:true,speechProvider:d.provider,updatedAt:stamp()},{merge:true});return {saved:true};
  }
  if(d.action==='setProvider'){
   if(!admin)fail('permission-denied','Administrator access is required.');
   if(!['off','openai','azure'].includes(d.provider))fail('invalid-argument','Choose a supported speech service.');
   if(d.provider!=='off')await secret(d.provider);
   await db.doc('settings/public').set({speechProvider:d.provider},{merge:true});return {saved:true};
  }
  if(d.action==='speech'){
   if(!admin && !(req.auth.token.email_verified && (await db.doc(`access/${req.auth.uid}`).get()).data()?.approved))fail('permission-denied','Your lecturer needs to approve your account for AI speech feedback. Recording and playback are available now.');
   if(typeof d.lessonId!=='string'||!/^(beginner|business|hsk5)-\d{2}$/.test(d.lessonId))fail('invalid-argument','Choose a published lesson.');
   const lesson=(await db.doc(`lessons/${d.lessonId}`).get()).data();
   const word=lesson?.vocabulary?.find(w=>w.id===d.wordId);
   if(!lesson?.published||!lesson.speaking||!word)fail('failed-precondition','This speaking exercise is no longer available.');
   if(typeof d.audio!=='string'||d.audio.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(d.audio))fail('invalid-argument','Record a short clip of up to 20 seconds.');
   const wav=Buffer.from(d.audio,'base64');
   if(wav.length<1000||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.readUInt32LE(24)!==16000||wav.readUInt16LE(22)!==1||wav.readUInt16LE(34)!==16)fail('invalid-argument','Use a mono 16 kHz WAV recording.');
   const settings=(await db.doc('settings/public').get()).data()||{},provider=settings.speechProvider;
   if(!['azure','openai'].includes(provider))fail('failed-precondition','AI feedback is not connected yet. You can record, listen, and practise with the pronunciation guide.');
   const credentials=await secret(provider);await limits(req.auth.uid);
   let result;
   if(provider==='openai'){
    const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'practice.wav');form.append('model','gpt-transcribe');form.append('languages[]','zh');
    const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${credentials.key}`},body:form,signal:AbortSignal.timeout(55000)});
    if(!response.ok)fail('unavailable','The speech service could not process this recording. Ask your lecturer to check the API key and account credit.');
    const data=await response.json(),transcript=String(data.text||'').slice(0,500),clean=s=>s.replace(/[^\p{Script=Han}]/gu,'');
    const match=clean(transcript)===clean(word.hanzi);
    result={provider,transcript,matched:match,feedback:transcript?(match?'The recognised word matches. Listen to your recording and compare each syllable with the model.':'The recognised words differ. Try once more, slowly, with a clear pause before and after the word.'):'No speech was recognised. Move closer to the microphone and try again.',hint:word.hint,notice:'Speech recognition checks the words heard. It does not measure tone accuracy or provide a pronunciation grade.'};
   }else{
    const config=Buffer.from(JSON.stringify({ReferenceText:word.hanzi,GradingSystem:'HundredMark',Granularity:'Phoneme',Dimension:'Comprehensive',EnableMiscue:true})).toString('base64');
    const response=await fetch(`https://${credentials.resource}.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':credentials.key,'Pronunciation-Assessment':config,'Content-Type':'audio/wav; codecs=audio/pcm; samplerate=16000','Accept':'application/json'},body:wav,signal:AbortSignal.timeout(55000)});
    if(!response.ok)fail('unavailable','Pronunciation assessment is unavailable. Ask your lecturer to check the Azure resource and key.');
    const data=await response.json(),best=data.NBest?.[0];
    if(data.RecognitionStatus!=='Success'||!best)fail('failed-precondition','No clear speech was detected. Record the word again in a quiet place.');
    const assessment=best.PronunciationAssessment||best;
    result={provider,transcript:String(data.DisplayText||best.Display||''),accuracy:assessment.AccuracyScore??null,fluency:assessment.FluencyScore??null,completeness:assessment.CompletenessScore??null,words:(best.Words||[]).map(w=>({word:w.Word,accuracy:(w.PronunciationAssessment||w).AccuracyScore??null,error:(w.PronunciationAssessment||w).ErrorType||'None'})),hint:word.hint,notice:'Automated practice feedback, not an assessed grade. These scores do not isolate Mandarin tone accuracy; review tones with your lecturer.'};
   }
   await db.collection('speechFeedback').add({uid:req.auth.uid,lessonId:d.lessonId,hanzi:word.hanzi,provider,result,createdAt:stamp()});
   return result;
  }
  fail('invalid-argument','Unknown action.');
 }catch(e){if(e instanceof HttpsError)throw e;console.error('Chinese API failure',{action:d.action,code:e.code||'unknown'});fail('internal','The change could not be completed. Please try again.');}
});
