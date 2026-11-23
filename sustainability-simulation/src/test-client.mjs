export function testClient(credentials = {}) {
  if (!globalThis.SharedWorker) throw new Error('Multi-tab test rounds need a browser with SharedWorker support. Open this page in a current desktop Chrome, Edge, Firefox or Safari browser.');
  const worker = new SharedWorker(new URL('./test-worker.mjs?v=dc55f1df16a9', import.meta.url), {type:'module',name:'sustainability-test-classrooms'});
  const pending = new Map(), listeners = new Set(); let failed = false;
  worker.port.onmessage = ({data}) => {
    if (data.event && data.roomId === credentials.roomId) { for (const listener of listeners) listener(data.event); return; }
    const request = pending.get(data.requestId); if (!request) return;
    pending.delete(data.requestId); clearTimeout(request.timeout);
    data.error ? request.reject(Object.assign(new Error(data.error),{status:data.status})) : request.resolve(data.result);
  };
  worker.onerror = () => { failed = true; for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('The saved test classroom could not start. Refresh and reopen your saved test session.')); } pending.clear(); };
  worker.port.start();
  const call = (action,payload) => new Promise((resolve,reject) => {
    if (failed) return reject(new Error('The saved test classroom is unavailable.'));
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {pending.delete(requestId);reject(new Error('The test round did not respond. Refresh and reopen the saved test session.'));},15000);
    pending.set(requestId,{resolve,reject,timeout}); worker.port.postMessage({requestId,action,payload,...credentials});
  });
  return {call,credentials,subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },async create(template,groups,metadata) { Object.assign(credentials,await call('create',{template,groups,metadata})); return credentials; },close() { listeners.clear(); worker.port.postMessage({action:'disconnect'}); worker.port.close(); for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('The test tab was closed.')); } pending.clear(); }};
}
