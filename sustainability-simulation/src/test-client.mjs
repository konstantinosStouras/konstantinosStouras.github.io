export function testClient(credentials = {}) {
  if (!globalThis.SharedWorker) throw new Error('Multi-tab test rounds need a browser with SharedWorker support. Open this page in a current desktop Chrome, Edge, Firefox or Safari browser.');
  const worker = new SharedWorker(new URL('./test-worker.mjs?v=5366cc14c565', import.meta.url), {type:'module',name:'sustainability-test-classrooms'});
  const pending = new Map(), listeners = new Set(); let failed = false;
  worker.port.onmessage = ({data}) => {
    if (data.event && data.roomId === credentials.roomId) { for (const listener of listeners) listener(data.event); return; }
    const request = pending.get(data.requestId); if (!request) return;
    pending.delete(data.requestId); clearTimeout(request.timeout);
    data.error ? request.reject(Object.assign(new Error(data.error),{status:data.status})) : request.resolve(data.result);
  };
  worker.onerror = () => { failed = true; for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('The temporary classroom could not start. Refresh and start a new test round.')); } pending.clear(); };
  worker.port.start();
  const call = (action,payload) => new Promise((resolve,reject) => {
    if (failed) return reject(new Error('The temporary test classroom is unavailable.'));
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {pending.delete(requestId);reject(new Error('The test round did not respond. Keep a test tab open and try again.'));},15000);
    pending.set(requestId,{resolve,reject,timeout}); worker.port.postMessage({requestId,action,payload,...credentials});
  });
  return {call,credentials,subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },async create(template,groups) { Object.assign(credentials,await call('create',{template,groups})); return credentials; },close() { listeners.clear(); worker.port.postMessage({action:'disconnect'}); worker.port.close(); for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('The test tab was closed.')); } pending.clear(); }};
}
