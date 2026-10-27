let recorder,stream,timer,blob,url,started,context,generation=0;
export function supported(){return !!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder&&(window.AudioContext||window.webkitAudioContext));}
export async function startRecording(onStop){
 if(!supported())throw Error('Recording is not supported in this browser. Try a current version of Chrome, Safari, Firefox or Edge.');
 const current=++generation;
 const captured=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
 if(current!==generation){captured.getTracks().forEach(t=>t.stop());return false;}
 stream=captured;
 try{
 const type=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
 recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);const chunks=[];started=Date.now();
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 recorder.onstop=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);onStop({url,duration:(Date.now()-started)/1000});};
 recorder.start();timer=setTimeout(stopRecording,20000);return true;
 }catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
}
export function stopRecording(){if(recorder?.state==='recording')recorder.stop();}
export function disposeRecording(){generation++;clearTimeout(timer);if(recorder)recorder.onstop=null;stopRecording();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);blob=null;url=null;context?.close().catch(()=>{});context=null;}
export async function wavBase64(){
 if(!blob)throw Error('Record your voice first.');
 const AudioCtx=window.AudioContext||window.webkitAudioContext;
 context ||= new AudioCtx();
 const decoded=await context.decodeAudioData(await blob.arrayBuffer());
 const seconds=Math.min(decoded.duration,20),offline=new OfflineAudioContext(1,Math.ceil(seconds*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
 const rendered=await offline.startRendering(),samples=rendered.getChannelData(0),buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 const text=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
 samples.forEach((s,i)=>{s=Math.max(-1,Math.min(1,s));view.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);});
 let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
