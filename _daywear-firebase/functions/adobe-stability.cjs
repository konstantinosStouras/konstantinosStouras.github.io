'use strict';
function failure(message){const e=new Error(message);e.publicMessage=message;return e;}
async function request(url,options,deadline){
 const remaining=deadline-Date.now();if(remaining<=0)throw failure('Generation timed out. The provider may still finish and bill this request; check its dashboard before retrying.');
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(Math.min(remaining,60000))});
 if(!response.ok){const messages={401:'Check this provider’s credentials.',402:'This provider’s API account has insufficient credits.',403:'The provider denied access. Check API entitlement and content restrictions.',429:'The provider rate limit was reached. Wait before retrying.'};throw failure(messages[response.status]||'The provider could not process this image. Check its model access and image requirements.');}
 return response;
}
async function renderAdobe(c,key,prompt,images,download){
 if(images.length!==1||prompt.length>1500)throw failure('Adobe requires one source image and a brief of at most 1500 characters.');
 let credentials;try{credentials=JSON.parse(key);}catch{throw failure('Save both the Adobe Client ID and Client Secret in provider settings.');}
 if(!credentials.clientId||!credentials.clientSecret)throw failure('Save both the Adobe Client ID and Client Secret in provider settings.');
 const deadline=Date.now()+420000;
 const auth=await request('https://ims-na1.adobelogin.com/ims/token/v3',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:credentials.clientId,client_secret:credentials.clientSecret,scope:'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis'})},deadline);
 const token=(await auth.json()).access_token;if(typeof token!=='string'||!token)throw failure('Adobe did not return an access token. Check your Firefly Services credentials.');
 const headers={'x-api-key':credentials.clientId,Authorization:`Bearer ${token}`};
 const source=images[0],upload=await request('https://firefly-api.adobe.io/v2/storage/image',{method:'POST',headers:{...headers,'Content-Type':source.slice(5,source.indexOf(';'))},body:Buffer.from(source.split(',')[1],'base64')},deadline);
 const uploadId=(await upload.json()).images?.[0]?.id;if(!uploadId)throw failure('Adobe could not upload the source image.');
 const body={modelId:c.model,prompt,numVariations:1,aspectRatio:'auto',resolutionLevel:c.parameters.resolutionLevel,modelSpecificPayload:{prompt_reasoner:c.parameters.promptReasoner},referenceBlobs:[{source:{uploadId},usage:'general'}]};
 const submission=await request('https://firefly-api.adobe.io/v4/images/generate-async',{method:'POST',headers:{...headers,'Content-Type':'application/json','x-model-version':'image5'},body:JSON.stringify(body)},deadline);
 let result=await submission.json();const location=result.links?.result?.href||result.statusUrl;
 let poll;try{poll=new URL(location);}catch{throw failure('Adobe returned an invalid job location.');}
 if(poll.origin!=='https://firefly-api.adobe.io'||poll.username||poll.password||!poll.pathname.startsWith('/v3/status/'))throw failure('Adobe returned an unexpected job location.');
 while(Date.now()<deadline){
  result=await (await request(poll.href,{headers},deadline)).json();
  const status=String(result.status||'').toLowerCase();
  if(['failed','cancelled','canceled'].includes(status)||result.error)throw failure('Adobe generation failed or was cancelled. Check Image 5 access and the reference photo.');
  const url=(result.result?.outputs||result.outputs)?.[0]?.image?.url;
  if(url&&(status==='succeeded'||!status))return download(url,['amazonaws.com','windows.net','storage.googleapis.com','frontdoor.prod.azure.cxp.adobe.com','adobe.io']);
  if(status==='succeeded')throw failure('Adobe completed without returning an image.');
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 throw failure('Adobe is still processing this request. Check its dashboard before retrying to avoid a second charge.');
}
async function renderStability(c,key,prompt,images){
 if(images.length!==1)throw failure('Stability requires exactly one source image.');
 const source=images[0],body=new FormData();body.set('prompt',prompt);body.set('control_strength',c.parameters.controlStrength);body.set('output_format',c.parameters.outputFormat);
 body.append('image',new Blob([Buffer.from(source.split(',')[1],'base64')],{type:source.slice(5,source.indexOf(';'))}),'source.jpg');
 const response=await request('https://api.stability.ai/v2beta/stable-image/control/structure',{method:'POST',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},body},Date.now()+420000);
 const result=await response.json();if(result.finish_reason==='CONTENT_FILTERED')throw failure('Stability filtered this image. Review the reference and brief before retrying.');
 if(result.finish_reason!=='SUCCESS'||typeof result.image!=='string'||!result.image||result.image.length>14000000||!/^[A-Za-z0-9+/=]+$/.test(result.image))throw failure('Stability did not return a valid image.');
 return `data:image/${c.parameters.outputFormat};base64,${result.image}`;
}
module.exports={renderAdobe,renderStability};
